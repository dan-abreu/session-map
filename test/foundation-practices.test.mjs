import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { loadLibrary, sharedKnowledgeDir } from '../server/foundation/library.mjs';
import { detectProfile, mergeDetected, emptyProfile, applyOwner } from '../server/foundation/profile.mjs';
import { readTextOf } from '../server/foundation/profile-stacks.mjs';
import { evaluatePractices, ladderOf, attestPractice, attestsOf } from '../server/foundation/practices.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

const NOW = '2026-10-10T12:00:00.000Z';
const T = (en) => ({ en, 'pt-BR': en });
const file = (path, over = {}) => ({ path, type: 'other', kind: 'code', included: true, reason: null, bytes: 10, ...over });
const census = (paths) => ({ version: 1, head: 'a'.repeat(40), files: paths.map((p) => file(p)) });
const reader = (texts) => (rel) => (Object.hasOwn(texts, rel) ? texts[rel] : null);

let n = 0;
function it(over = {}) {
  n += 1;
  return {
    id: `t.item${n}`, front: 'quality', ladder: 'N0', severity: 'R', effort: 1,
    title: T('t'), what: T('w'), why: T('y'), how: T('h'), doneWhen: T('d'),
    detect: { kind: 'file', anyOf: ['README.md'] }, source: { name: 's', url: null, trust: 'C' },
    ...over,
  };
}
const pkg = (id, items, over = {}) => ({ version: 1, id, kind: 'general', title: T(id), checkedAt: '2026-10-01', status: 'confirmed', disclaimer: null, items, ...over });
const detected = (over = {}) => ({ types: ['web'], stacks: [], signals: [], team: { kind: 'solo', authors: 1 }, deploy: [], ...over });
const profileOf = (d = {}, owner = {}) => ({ ...emptyProfile(), detected: detected(d), owner: { ...emptyProfile().owner, ...owner } });
const run = (over = {}) => evaluatePractices({ packages: [], profile: profileOf(), census: census(['README.md']), readText: reader({}), now: NOW, ...over });
const stateOf = (r, id) => r.items.find((x) => x.id === id);

test('the output has the contract shape: version, generatedAt, profileHash, items with no text, ladder', () => {
  const a = it();
  const r = run({ packages: [pkg('p', [a])] });
  assert.equal(r.version, 1);
  assert.equal(r.generatedAt, NOW);
  assert.match(r.profileHash, /^[0-9a-f]{16}$/);
  assert.deepEqual(Object.keys(r.items[0]), ['id', 'pkg', 'front', 'ladder', 'severity', 'state', 'reason', 'evidence', 'attested']);
  assert.deepEqual(r.items[0], { id: a.id, pkg: 'p', front: 'quality', ladder: 'N0', severity: 'R', state: 'pass', reason: null, evidence: [{ file: 'README.md', line: 1 }], attested: null });
  assert.ok(!JSON.stringify(r).includes('"title"'), 'texts stay in the packages');
  assert.deepEqual(Object.keys(r.ladder), ['level', 'provisional', 'nextPercent', 'byFront']);
});

test('four profiles give four different, expected sets of not-applicable items', () => {
  const mobileOnly = it({ appliesIf: { types: ['mobile'] } });
  const libOnly = it({ appliesIf: { types: ['library'] } });
  const earns = it({ appliesIf: { money: ['subscription', 'sale', 'marketplace'] } });
  const euOnly = it({ appliesIf: { countries: ['DE', 'FR'] } });
  const everyone = it();
  const packages = [pkg('p', [mobileOnly, libOnly, earns, euOnly, everyone])];
  const naIds = (profile) => run({ packages, profile }).items.filter((x) => x.state === 'na').map((x) => x.id).sort();
  const ids = (...xs) => xs.map((x) => x.id).sort();
  const app = profileOf({ types: ['mobile'] }, { money: 'subscription' });
  const lib = profileOf({ types: ['library'] }, { money: 'free' });
  const personal = profileOf({ types: ['cli'] }, { money: 'personal' });
  const eu = profileOf({ types: ['web', 'api'] }, { money: 'sale', country: 'DE' });
  assert.deepEqual(naIds(app), ids(libOnly, euOnly));
  assert.deepEqual(naIds(lib), ids(mobileOnly, earns, euOnly));
  assert.deepEqual(naIds(personal), ids(mobileOnly, libOnly, earns, euOnly));
  assert.deepEqual(naIds(eu), ids(mobileOnly, libOnly));
  const na = stateOf(run({ packages, profile: personal }), earns.id);
  assert.deepEqual([na.state, na.reason, na.evidence], ['na', 'not-applicable', []]);
});

test('a package that does not apply to the profile is left out; one that applies is evaluated', () => {
  const stackItem = it();
  const packages = [pkg('stack-next', [stackItem], { kind: 'stack', applies: { stacks: ['next'] } }), pkg('general', [it()])];
  const without = run({ packages, profile: profileOf({ stacks: [{ name: 'fastify', version: '5.0.0', file: 'package.json', line: 3 }] }) });
  assert.deepEqual(without.items.map((x) => x.pkg), ['general']);
  const withNext = run({ packages, profile: profileOf({ stacks: [{ name: 'next', version: '16.0.1', file: 'package.json', line: 3 }] }) });
  assert.deepEqual(withNext.items.map((x) => x.pkg).sort(), ['general', 'stack-next']);
});

test('the profile may be the stored one, the flat one, and the owner wins over the detected types', () => {
  const mobileOnly = it({ appliesIf: { types: ['mobile'] } });
  const packages = [pkg('p', [mobileOnly])];
  const stored = profileOf({ types: ['web'] }, { types: ['mobile'] });
  assert.equal(run({ packages, profile: stored }).items[0].state, 'pass');
  assert.equal(run({ packages, profile: { types: ['mobile'] } }).items[0].state, 'pass');
  assert.equal(run({ packages, profile: { types: ['web'] } }).items[0].state, 'na');
  assert.equal(run({ packages, profile: null }).items[0].state, 'na', 'a fact the profile does not have is not applicable (same rule as the package level)');
});

test('SECURITY.md: absent = fail, empty = fail, with a contact = pass', () => {
  const sec = it({ front: 'security', severity: 'E', detect: { kind: 'content', files: ['SECURITY.md'], matches: ['@|https?://'], minLines: 1 } });
  const packages = [pkg('p', [sec])];
  const at = (paths, texts) => stateOf(run({ packages, census: census(paths), readText: reader(texts) }), sec.id);
  assert.equal(at([], {}).state, 'fail');
  assert.equal(at(['SECURITY.md'], { 'SECURITY.md': '\n  \n' }).state, 'fail');
  assert.equal(at(['SECURITY.md'], { 'SECURITY.md': '# Security\n\nWrite to security@example.com\n' }).state, 'pass');
});

test('a missing health.json never turns a health practice into fail', () => {
  const h = it({ detect: { kind: 'health', id: 'security.branch_protection' } });
  for (const health of [undefined, null, {}, { items: [] }]) {
    const r = stateOf(run({ packages: [pkg('p', [h])], health }), h.id);
    assert.deepEqual([r.state, r.reason], ['unverified', 'no-data']);
  }
  const mirrored = stateOf(run({ packages: [pkg('p', [h])], health: { items: [{ id: 'security.branch_protection', state: 'fail', evidence: [] }] } }), h.id);
  assert.equal(mirrored.state, 'fail');
});

test('manual items wait for a person; a valid attest passes them; an expired one goes back to unverified/attest-expired', () => {
  const m = it({ detect: { kind: 'manual' } });
  const packages = [pkg('p', [m])];
  const none = stateOf(run({ packages }), m.id);
  assert.deepEqual([none.state, none.reason, none.attested], ['unverified', 'needs-human', null]);
  const attest = attestPractice(null, m.id, { note: 'checked the restore', days: 90 }, '2026-10-01T00:00:00.000Z');
  const valid = stateOf(run({ packages, attest }), m.id);
  assert.deepEqual([valid.state, valid.reason, valid.attested.note], ['pass', null, 'checked the restore']);
  const later = stateOf(run({ packages, attest, now: '2027-02-01T00:00:00.000Z' }), m.id);
  assert.deepEqual([later.state, later.reason], ['unverified', 'attest-expired']);
  assert.equal(later.attested.note, 'checked the restore', 'the old record stays visible');
});

test('an attest also settles an unverified item of another detector, but never overrides a fail or a pass', () => {
  const h = it({ detect: { kind: 'health', id: 'x.one' } });
  const failing = it({ detect: { kind: 'file', anyOf: ['NOPE.md'] } });
  const attest = {
    ...attestPractice(null, h.id, { note: 'n', days: 30 }, NOW),
    ...attestPractice(null, failing.id, { note: 'n', days: 30 }, NOW),
  };
  const r = run({ packages: [pkg('p', [h, failing])], attest });
  assert.equal(stateOf(r, h.id).state, 'pass');
  assert.equal(stateOf(r, failing.id).state, 'fail');
  const expired = run({ packages: [pkg('p', [h])], attest, now: '2027-03-01T00:00:00.000Z' });
  assert.deepEqual([stateOf(expired, h.id).state, stateOf(expired, h.id).reason], ['unverified', 'no-data'], 'the real reason is not hidden by an old attest');
});

test('attestPractice: default 90 days, bounds, note limit, immutable, and attestsOf reads them back', () => {
  const prev = Object.freeze({});
  const a = attestPractice(prev, 'x.id', { note: ' done ' }, NOW);
  assert.deepEqual(a['x.id'], { at: NOW, expiresAt: '2027-01-08T12:00:00.000Z', note: 'done' });
  assert.deepEqual(prev, {});
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => attestPractice(null, 'x', { days: 0 }, NOW)), 'bad-idea');
  assert.equal(code(() => attestPractice(null, 'x', { days: 366 }, NOW)), 'bad-idea');
  assert.equal(code(() => attestPractice(null, 'x', { days: 1.5 }, NOW)), 'bad-idea');
  assert.equal(code(() => attestPractice(null, 'x', { note: 'a'.repeat(301) }, NOW)), 'bad-idea');
  assert.equal(code(() => attestPractice(null, '', {}, NOW)), 'bad-idea');
  assert.equal(code(() => attestPractice(null, 'x', {}, 'not a date')), 'bad-idea');
  const m = it({ detect: { kind: 'manual' } });
  const r = run({ packages: [pkg('p', [m])], attest: attestPractice(null, m.id, { note: 'n' }, NOW) });
  assert.deepEqual(attestsOf(r), { [m.id]: r.items[0].attested });
  assert.deepEqual(attestsOf(null), {});
});

test('the same input gives the same output, byte for byte, whatever the order of the packages', () => {
  const a = pkg('a-pkg', [it(), it({ detect: { kind: 'manual' } })]);
  const b = pkg('b-pkg', [it({ detect: { kind: 'dep', name: 'zod' } })]);
  const deps = [{ name: 'zod', file: 'package.json', line: 4 }];
  const first = JSON.stringify(run({ packages: [a, b], deps }));
  assert.equal(first, JSON.stringify(run({ packages: [a, b], deps })));
  assert.equal(first, JSON.stringify(run({ packages: [b, a], deps })));
});

test('packages are ordered by code unit, not by the machine locale (a-b, a.b, a_b, B)', () => {
  const ids = ['a_b', 'B', 'a.b', 'a-b'];
  const r = run({ packages: ids.map((id) => pkg(id, [it()])) });
  assert.deepEqual(r.items.map((x) => x.pkg), ['B', 'a-b', 'a.b', 'a_b']);
});

test('ladderOf: the level is the highest rung whose items (and those below) all pass', () => {
  const row = (ladder, state, front = 'quality') => ({ id: `${ladder}.${state}.${Math.random()}`, ladder, state, front });
  const full = ladderOf([row('N0', 'pass'), row('N1', 'pass'), row('N2', 'pass'), row('N3', 'pass'), row('N4', 'pass')]);
  assert.deepEqual([full.level, full.provisional, full.nextPercent], ['N4', false, null]);
  const two = ladderOf([row('N0', 'pass'), row('N1', 'pass'), row('N2', 'fail'), row('N2', 'pass'), row('N3', 'pass')]);
  assert.equal(two.level, 'N1');
  assert.equal(two.nextPercent, 50);
  const none = ladderOf([row('N0', 'fail'), row('N0', 'pass')]);
  assert.equal(none.level, null);
  assert.deepEqual(ladderOf([]).level, 'N4', 'no applicable item blocks nothing');
});

test('ladderOf: only a fail locks the level; an unverified item never holds it back, it makes it provisional', () => {
  const row = (ladder, state) => ({ id: `${ladder}.${state}`, ladder, state, front: 'quality' });
  const provisional = ladderOf([row('N0', 'pass'), row('N1', 'unverified'), row('N2', 'pass')]);
  assert.deepEqual([provisional.level, provisional.provisional], ['N4', true]);
  const locked = ladderOf([row('N0', 'pass'), row('N1', 'fail'), row('N1', 'unverified')]);
  assert.deepEqual([locked.level, locked.provisional], ['N0', false]);
  const lockedHigher = ladderOf([row('N0', 'unverified'), row('N1', 'fail')]);
  assert.deepEqual([lockedHigher.level, lockedHigher.provisional], ['N0', true], 'an unverified N0 is not a failed N0');
  const onlyUnverified = ladderOf([row('N0', 'unverified'), row('N1', 'unverified')]);
  assert.deepEqual([onlyUnverified.level, onlyUnverified.provisional], ['N4', true], 'nothing proven wrong, nothing proven right');
  const below = ladderOf([row('N0', 'fail'), row('N0', 'unverified')]);
  assert.deepEqual([below.level, below.provisional], [null, false]);
  const above = ladderOf([row('N0', 'pass'), row('N1', 'fail'), row('N3', 'unverified')]);
  assert.equal(above.provisional, false, 'an unverified item above the lock changes nothing');
  const allDone = ladderOf([row('N0', 'pass'), row('N1', 'pass'), row('N3', 'unverified')]);
  assert.deepEqual([allDone.level, allDone.provisional], ['N4', true]);
  const na = ladderOf([row('N0', 'pass'), row('N1', 'na')]);
  assert.deepEqual([na.level, na.provisional], ['N4', false], 'na is outside the count');
});

test('ladderOf: nextPercent is the locked rung, rounds down (99.9 % is 99) and counts unverified as not yet done', () => {
  const rows = [];
  for (let i = 0; i < 999; i++) rows.push({ id: `a${i}`, ladder: 'N1', state: 'pass', front: 'quality' });
  rows.push({ id: 'b', ladder: 'N1', state: 'fail', front: 'quality' });
  const r = ladderOf([{ id: 'z', ladder: 'N0', state: 'pass', front: 'quality' }, ...rows]);
  assert.equal(r.level, 'N0');
  assert.equal(r.nextPercent, 99);
  const s = (id, state) => ({ id, ladder: 'N0', state });
  const withUnverified = ladderOf([s('p', 'pass'), s('u', 'unverified'), s('q', 'pass'), s('f', 'fail')]);
  assert.equal(withUnverified.nextPercent, 50);
  assert.equal(ladderOf([s('p', 'pass'), s('u', 'unverified')]).nextPercent, null, 'no fail: no rung left to climb');
});

test('ladderOf: byFront counts the four states for all eight fronts, na included', () => {
  const r = ladderOf([
    { id: 'a', ladder: 'N0', state: 'pass', front: 'security' },
    { id: 'b', ladder: 'N0', state: 'fail', front: 'security' },
    { id: 'c', ladder: 'N0', state: 'na', front: 'legal' },
    { id: 'd', ladder: 'N0', state: 'unverified', front: 'quality' },
  ]);
  assert.deepEqual(Object.keys(r.byFront), ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance']);
  assert.deepEqual(r.byFront.security, { pass: 1, fail: 1, unverified: 0, na: 0 });
  assert.deepEqual(r.byFront.legal, { pass: 0, fail: 0, unverified: 0, na: 1 });
  assert.deepEqual(r.byFront.finance, { pass: 0, fail: 0, unverified: 0, na: 0 });
});

test('evaluatePractices puts the ladder on the evaluated items', () => {
  const a = it({ ladder: 'N0' });
  const b = it({ ladder: 'N1', detect: { kind: 'file', anyOf: ['NOPE'] } });
  const r = run({ packages: [pkg('p', [a, b])] });
  assert.equal(r.ladder.level, 'N0');
  assert.equal(r.ladder.nextPercent, 0);
});

test('supported-version uses the package lifecycle and the profile stack with its manifest line', () => {
  const sv = it({ ladder: 'N1', severity: 'E', detect: { kind: 'supported-version', stack: 'next' } });
  const life = { product: 'next', cycles: [{ cycle: '14', supportUntil: '2025-10-26', securityUntil: '2025-10-26', source: 'https://example.com/x' }] };
  const packages = [pkg('stack-next', [sv], { kind: 'stack', checkedAt: '2026-09-01', lifecycle: life })];
  const r = run({ packages, profile: profileOf({ stacks: [{ name: 'next', version: '14.2.1', file: 'apps/web/package.json', line: 12 }] }) });
  const x = stateOf(r, sv.id);
  assert.deepEqual([x.state, x.evidence], ['fail', [{ file: 'apps/web/package.json', line: 12 }]]);
  const old = run({ packages: [{ ...packages[0], checkedAt: '2025-01-01' }], profile: profileOf({ stacks: [{ name: 'next', version: '14.2.1', file: 'p.json', line: 1 }] }) });
  assert.deepEqual([stateOf(old, sv.id).state, stateOf(old, sv.id).reason], ['unverified', 'stale-source']);
});

test('dep practices read the dependencies handed in and the facts', () => {
  const d = it({ detect: { kind: 'dep', name: '@fastify/helmet' } });
  const r = run({ packages: [pkg('p', [d])], deps: [{ name: 'fastify', file: 'package.json', line: 5 }] });
  assert.equal(stateOf(r, d.id).state, 'fail');
  const none = run({ packages: [pkg('p', [d])] });
  assert.equal(stateOf(none, d.id).state, 'unverified');
});

// ---- on a real folder: the acme-shop fixture -------------------------------------------------------------------------

test('on acme-shop a missing SECURITY.md appears once as fail; adding the file changes only that item and nextPercent', async () => {
  const root = copyFixtureRepo('acme-shop');
  try {
    const sec = it({ id: 'test.security-md', front: 'security', ladder: 'N0', severity: 'E', detect: { kind: 'content', files: ['SECURITY.md'], matches: ['@|https?://'], minLines: 1 } });
    const lib = loadLibrary({ sharedDir: sharedKnowledgeDir() });
    assert.deepEqual(lib.invalid, []);
    const packages = [...lib.packages, pkg('test-sec', [sec])];
    const evaluate = async (health = null) => {
      const c = await censusOf(root, null);
      const readText = readTextOf(root);
      const d = await detectProfile({ root, census: c, facts: [], readText, authors: [{ commits: 3, bot: false }] });
      const profile = mergeDetected(applyOwner(emptyProfile(), { money: 'sale' }), d);
      return evaluatePractices({ packages, profile, census: c, facts: [], readText, health, now: NOW });
    };
    const before = await evaluate();
    // The library's own SECURITY.md item is a health check: with no health.json it is unverified, and only a health
    // answer of fail turns it into fail.
    assert.equal(before.items.filter((x) => x.id === 'sec.security-md').length, 1);
    const real = stateOf(before, 'sec.security-md');
    assert.deepEqual([real.state, real.reason, real.front, real.severity], ['unverified', 'no-data', 'security', 'E']);
    const withHealth = await evaluate({ items: [{ id: 'community.security', state: 'fail', reason: null, evidence: [] }] });
    assert.deepEqual([stateOf(withHealth, 'sec.security-md').state, stateOf(withHealth, 'sec.security-md').reason], ['fail', null]);
    assert.equal(before.items.filter((x) => x.id === sec.id).length, 1);
    const one = stateOf(before, sec.id);
    assert.deepEqual([one.state, one.front, one.severity, one.pkg], ['fail', 'security', 'E', 'test-sec']);
    assert.ok(before.items.length > 25, 'the shared library applies to the fixture');
    assert.ok(!JSON.stringify(before).includes('do-not-read-42'), 'the .env is never read');

    writeFileSync(join(root, 'SECURITY.md'), '# Security\n\nReport to security@example.com\n');
    const after = await evaluate();
    const changed = after.items.filter((x, i) => JSON.stringify(x) !== JSON.stringify(before.items[i])).map((x) => x.id);
    assert.deepEqual(changed, [sec.id]);
    assert.equal(stateOf(after, sec.id).state, 'pass');
    assert.notEqual(after.ladder.nextPercent, before.ladder.nextPercent);
    assert.equal(after.ladder.level, before.ladder.level);
    assert.equal(after.ladder.provisional, before.ladder.provisional);
  } finally { removeFixtureRepo(root); }
});

test('a temp project without a census gives unverified, not fail, for every file or content practice', () => {
  const a = it({ detect: { kind: 'file', anyOf: ['LICENSE'] } });
  const b = it({ detect: { kind: 'content', files: ['README.md'], contains: ['x'] } });
  const r = run({ packages: [pkg('p', [a, b])], census: null });
  assert.deepEqual(r.items.map((x) => x.state), ['unverified', 'unverified']);
  assert.equal(r.ladder.level, 'N4', 'nothing could be checked, so nothing is failed');
  assert.equal(r.ladder.provisional, true);
});

test('evaluatePractices works from a folder made on the fly (no fixture): README only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-pract-'));
  try {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'SECURITY.md'), 'mail ana@example.com\n');
    writeFileSync(join(root, 'README.md'), '# acme\n');
    const c = await censusOf(root, null);
    const sec = it({ detect: { kind: 'content', files: ['SECURITY.md'], contains: ['@'] } });
    const r = evaluatePractices({ packages: [pkg('p', [sec])], profile: null, census: c, readText: readTextOf(root), now: NOW });
    assert.equal(r.items[0].state, 'pass');
    assert.deepEqual(r.items[0].evidence, [{ file: 'docs/SECURITY.md', line: 1 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
