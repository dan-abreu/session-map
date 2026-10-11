import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { loadLibrary, sharedKnowledgeDir } from '../server/foundation/library.mjs';
import { applyOwner, emptyProfile, readProfile, writeProfile } from '../server/foundation/profile.mjs';
import { attestPractice } from '../server/foundation/practices.mjs';
import { fdDir, readFd, writeFd } from '../server/foundation/store.mjs';
import { computeGuide, readGuideInputs, recomputeGuide } from '../server/foundation/guide.mjs';
import { copyFixtureRepo, removeFixtureRepo, ENV_FILE } from './fixtures/repo-copy.mjs';

const NOW = '2026-10-10T12:00:00.000Z';
const LATER = '2026-10-10T13:00:00.000Z';
const AUTHORS = [{ commits: 3, bot: false }];
const T = (en) => ({ en, 'pt-BR': `${en} (pt)` });

function tmp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
function tree(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(`${relative(dir, p).replaceAll('\\', '/')}:${statSync(p).size}`);
    }
  };
  walk(dir);
  return out.sort();
}

// A project whose census and facts were already written, as the reading round leaves them.
async function readProject(name = 'acme-shop') {
  const root = copyFixtureRepo(name);
  const smDir = tmp('sm-guide-');
  const project = { id: 'acme-shop-8324f1', root };
  const census = await censusOf(root, null);
  const facts = extractAll(root, census, null, {});
  writeFd(smDir, project.id, 'census.json', census);
  writeFd(smDir, project.id, 'facts.json', facts);
  return { root, smDir, project, census, facts, done() { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
}
const opts = (over = {}) => ({ now: NOW, authors: AUTHORS, ...over });

// ---- computeGuide: pure ---------------------------------------------------------------------------------------------

test('computeGuide chains profile -> practices -> compass from what it is given, and is repeatable', async () => {
  const p = await readProject();
  try {
    const inputs = await readGuideInputs(p.smDir, p.project, opts());
    const before = JSON.stringify({ ...inputs, readText: null });
    const a = computeGuide(inputs);
    const b = computeGuide(inputs);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'same input, same output');
    assert.equal(JSON.stringify({ ...inputs, readText: null }), before, 'the input is not changed');
    assert.deepEqual(Object.keys(a), ['profile', 'practices', 'compass']);
    assert.equal(a.practices.profileHash.length, 16);
    assert.equal(a.compass.generatedAt, NOW);
    assert.ok(a.practices.items.length > 25);
    assert.deepEqual(a.compass.next3.map((x) => x.itemId).every((id) => a.practices.items.some((i) => i.id === id)), true);
    assert.ok(a.profile.detected.types.length > 0, 'the profile carries what was detected');
  } finally { p.done(); }
});

// ---- readGuideInputs ------------------------------------------------------------------------------------------------

test('readGuideInputs reads only the foundation files and the project through readTextOf, and never opens .env', async () => {
  const p = await readProject();
  try {
    const inputs = await readGuideInputs(p.smDir, p.project, opts());
    assert.equal(inputs.census.files.length, p.census.files.length);
    assert.ok(Array.isArray(inputs.facts) && inputs.facts.length > 0);
    assert.equal(inputs.health, null, 'no health.json yet: null, not an error');
    assert.ok(inputs.packages.length >= 10, 'the shared library is loaded');
    assert.equal(inputs.readText('.env'), null);
    assert.ok(!JSON.stringify(computeGuide(inputs)).includes(ENV_FILE.trim()));
  } finally { p.done(); }
});

test('without health.json the guide still produces the compass', async () => {
  const p = await readProject();
  try {
    const out = await recomputeGuide(p.smDir, p.project, opts());
    assert.equal(out.compass.next3.length, 3);
    assert.equal(readFd(p.smDir, p.project.id, 'health.json', null), null);
  } finally { p.done(); }
});

test('a project not read yet (no census) still gets a compass, with nothing invented', async () => {
  const root = tmp('sm-guide-root-');
  const smDir = tmp('sm-guide-');
  try {
    const out = await recomputeGuide(smDir, { id: 'acme-new-111111', root }, opts());
    assert.equal(out.profile.detected, null, 'nothing detected without a census');
    assert.ok(out.practices.items.every((i) => i.state !== 'fail'), 'no data is unverified, never fail');
    assert.equal(out.compass.stage.origin, 'guessed');
    assert.ok(existsSync(join(fdDir(smDir, 'acme-new-111111'), 'compass.json')));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

// ---- recomputeGuide: what it writes ---------------------------------------------------------------------------------

test('recomputeGuide writes profile, practices and compass under brain/<id>/foundation/ and nowhere else', async () => {
  const p = await readProject();
  try {
    const projectBefore = tree(p.root);
    const smBefore = tree(p.smDir);
    const out = await recomputeGuide(p.smDir, p.project, opts());
    assert.deepEqual(tree(p.root), projectBefore, 'the project is not touched');
    const added = tree(p.smDir).filter((x) => !smBefore.includes(x)).map((x) => x.split(':')[0]);
    assert.deepEqual(added.sort(), [
      `brain/${p.project.id}/foundation/compass.json`,
      `brain/${p.project.id}/foundation/practices.json`,
      `brain/${p.project.id}/foundation/profile.json`,
    ]);
    assert.deepEqual(readFd(p.smDir, p.project.id, 'compass.json', null), out.compass);
    assert.deepEqual(readFd(p.smDir, p.project.id, 'practices.json', null), out.practices);
    assert.deepEqual(readProfile(p.smDir, p.project.id).detected, out.profile.detected);
  } finally { p.done(); }
});

test('recomputeGuide keeps what the owner answered, and the owner stage reaches the compass', async () => {
  const p = await readProject();
  try {
    writeProfile(p.smDir, p.project.id, applyOwner(emptyProfile(), { money: 'sale', country: 'BR', stage: 'growth' }, NOW), NOW);
    const out = await recomputeGuide(p.smDir, p.project, opts());
    const stored = readProfile(p.smDir, p.project.id);
    assert.equal(stored.owner.money, 'sale');
    assert.equal(stored.owner.country, 'BR');
    assert.equal(stored.owner.stage, 'growth');
    assert.equal(stored.askedAt, NOW);
    assert.ok(stored.detected, 'detection was added next to it');
    assert.deepEqual(out.compass.stage, { key: 'growth', origin: 'owner', reason: 'owner' });
    // and a second recompute does not lose it either
    await recomputeGuide(p.smDir, p.project, opts({ now: LATER }));
    assert.equal(readProfile(p.smDir, p.project.id).owner.stage, 'growth');
  } finally { p.done(); }
});

test('recomputeGuide keeps the attests of the previous practices.json', async () => {
  const p = await readProject();
  try {
    const first = await recomputeGuide(p.smDir, p.project, opts());
    const target = first.practices.items.find((i) => i.state === 'unverified' && i.reason === 'needs-human');
    assert.ok(target, 'the library has a manual item');
    const prev = readFd(p.smDir, p.project.id, 'practices.json', null);
    const attest = attestPractice({}, target.id, { note: 'checked by Ana', days: 30 }, NOW)[target.id];
    writeFd(p.smDir, p.project.id, 'practices.json', { ...prev, items: prev.items.map((i) => (i.id === target.id ? { ...i, attested: attest } : i)) });
    const again = await recomputeGuide(p.smDir, p.project, opts({ now: LATER }));
    const item = again.practices.items.find((i) => i.id === target.id);
    assert.equal(item.state, 'pass');
    assert.deepEqual(item.attested, attest);
  } finally { p.done(); }
});

test('nothing changed means nothing rewritten', async () => {
  const p = await readProject();
  try {
    await recomputeGuide(p.smDir, p.project, opts());
    const files = ['profile.json', 'practices.json', 'compass.json'].map((n) => join(fdDir(p.smDir, p.project.id), n));
    const before = files.map((f) => readFileSync(f, 'utf8'));
    await recomputeGuide(p.smDir, p.project, opts({ now: LATER }));
    assert.deepEqual(files.map((f) => readFileSync(f, 'utf8')), before);
    // a real change (a new file in the project, a new census) does rewrite
    writeFileSync(join(p.root, 'CLAUDE.md'), '# Instructions\n\nRun the tests before you finish.\n');
    writeFd(p.smDir, p.project.id, 'census.json', await censusOf(p.root, readFd(p.smDir, p.project.id, 'census.json', null)));
    await recomputeGuide(p.smDir, p.project, opts({ now: LATER }));
    assert.notDeepEqual(files.map((f) => readFileSync(f, 'utf8')), before);
  } finally { p.done(); }
});

test('an unsafe project id is refused before anything is written', async () => {
  const smDir = tmp('sm-guide-');
  try {
    await assert.rejects(() => recomputeGuide(smDir, { id: '../escape', root: smDir }, opts()));
    assert.deepEqual(readdirSync(smDir), []);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// ---- the "how to confirm" of the Compass ----------------------------------------------------------------------------

test('on a project with a README and neither tests nor CI the compass says prototype and lists 3 actions with an example of the project', async () => {
  const p = await readProject();
  const local = tmp('sm-guide-local-');
  try {
    // a local-layer package whose essential item fails here and whose example needs a real route of the project
    const item = {
      id: 'probe.route-limit', front: 'security', ladder: 'N0', severity: 'E', effort: 1,
      title: T('Limit requests'), what: T('Limit them.'), why: T('Bots hammer open routes.'), how: T('Add a limit.'), doneWhen: T('A limit exists.'),
      example: T('Start with {route}.'), detect: { kind: 'file', anyOf: ['rate-limit.config'] }, source: { name: 'owasp', url: 'https://owasp.org/', trust: 'V' },
    };
    writeFileSync(join(local, 'general-probe.json'), JSON.stringify({ version: 1, id: 'general-probe', kind: 'general', title: T('Probe'), checkedAt: '2026-10-01', status: 'confirmed', disclaimer: null, items: [item] }));
    const out = await recomputeGuide(p.smDir, p.project, opts({ localDir: local }));
    assert.equal(out.compass.stage.key, 'prototype');
    assert.equal(out.compass.stage.origin, 'guessed');
    assert.equal(out.compass.next3.length, 3);
    for (const a of out.compass.next3) {
      assert.match(a.ask.text['pt-BR'], /Por que importa/, 'each action carries its why');
      assert.ok(a.itemId && a.front);
    }
    // action 1 = the cheapest essential failure of the lowest rung that has failures
    const lib = loadLibrary({ sharedDir: sharedKnowledgeDir(), localDir: local });
    const effort = new Map(lib.packages.flatMap((pkg) => pkg.items.map((i) => [i.id, i.effort])));
    const rung = (i) => ['N0', 'N1', 'N2', 'N3', 'N4'].indexOf(i.ladder);
    const fails = out.practices.items.filter((i) => i.state === 'fail');
    const lowest = Math.min(...fails.map(rung));
    const essential = fails.filter((i) => rung(i) === lowest && i.severity === 'E');
    const cheapest = Math.min(...essential.map((i) => effort.get(i.id)));
    const allowed = essential.filter((i) => effort.get(i.id) === cheapest).map((i) => i.id);
    assert.ok(allowed.includes(out.compass.next3[0].itemId), `${out.compass.next3[0].itemId} is not in ${allowed}`);
    const probe = out.compass.next3.find((x) => x.itemId === item.id);
    assert.ok(probe, 'the probe is an essential cheap failure of N0');
    const route = p.facts.facts.filter((f) => f.kind === 'route' && f.origin !== 'AMBIGUOUS' && f.attrs?.path).map((f) => f.name).sort()[0];
    assert.ok(route, 'the fixture has routes');
    assert.deepEqual(probe.example, { params: { route } });
  } finally { p.done(); rmSync(local, { recursive: true, force: true }); }
});
