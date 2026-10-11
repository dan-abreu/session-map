import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompass, STAGE_KEYS } from '../server/foundation/compass.mjs';
import { ladderOf } from '../server/foundation/practices.mjs';
import { emptyProfile } from '../server/foundation/profile.mjs';

const NOW = '2026-10-10T12:00:00.000Z';
const T = (en, pt) => ({ en, 'pt-BR': pt ?? `${en} (pt)` });
const files = (n) => ({ version: 1, files: Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.js`, included: true })) });

let n = 0;
// one practice item as practices.json carries it
function row(over = {}) {
  n += 1;
  return { id: `t.item${n}`, pkg: 'p', front: 'quality', ladder: 'N0', severity: 'R', state: 'fail', reason: null, evidence: [], attested: null, ...over };
}
const practicesOf = (items) => ({ version: 1, generatedAt: NOW, profileHash: 'x', items, ladder: ladderOf(items) });
// the package side of an item (texts, effort, example)
function def(r, over = {}) {
  return { id: r.id, front: r.front, ladder: r.ladder, severity: r.severity, effort: 1, title: T(`Title ${r.id}`), what: T('what'), why: T('why'), how: T('how'), doneWhen: T('done'), ...over };
}
const pkgOf = (rows, over = {}, itemOver = () => ({})) => ({ id: 'p', kind: 'general', disclaimer: null, items: rows.map((r) => def(r, itemOver(r))), ...over });
const profile = (owner = {}, detected = {}) => ({ ...emptyProfile(), detected: { types: ['web'], stacks: [], signals: [], team: { kind: 'solo', authors: 1 }, deploy: [], ...detected }, owner: { ...emptyProfile().owner, ...owner } });
const build = (over = {}) => buildCompass({ practices: practicesOf([]), profile: profile(), census: files(30), now: NOW, ...over });
const ids = (c) => c.next3.map((x) => x.itemId);

test('the output has the contract shape', () => {
  const rows = [row({ state: 'pass' }), row()];
  const c = build({ practices: practicesOf(rows), packages: [pkgOf(rows)] });
  assert.equal(c.version, 1);
  assert.equal(c.generatedAt, NOW);
  assert.deepEqual(Object.keys(c), ['version', 'generatedAt', 'stage', 'stages', 'fronts', 'next3', 'disclaimers']);
  assert.deepEqual(c.stages, ['idea', 'prototype', 'first-client', 'growth', 'company']);
  assert.deepEqual(STAGE_KEYS, c.stages);
  assert.deepEqual(Object.keys(c.stage), ['key', 'origin', 'reason']);
  assert.equal(c.fronts.length, 8);
  assert.deepEqual(Object.keys(c.fronts[0]), ['front', 'state', 'pass', 'fail', 'unverified']);
  assert.deepEqual(Object.keys(c.next3[0]), ['itemId', 'front', 'example', 'ask']);
  assert.deepEqual(Object.keys(c.next3[0].ask), ['text', 'skills', 'role']);
});

test('the stage is guessed by written rules, with origin guessed and a reason', () => {
  const at = (level, nFiles = 30) => {
    // a ladder whose level is `level`: the rung above it has a failing item
    const rungs = ['N0', 'N1', 'N2', 'N3', 'N4'];
    const idx = rungs.indexOf(level);
    const rows = rungs.map((r, i) => row({ ladder: r, state: i < idx + 1 ? 'pass' : 'fail' }));
    return build({ practices: practicesOf(rows), census: files(nFiles) }).stage;
  };
  assert.deepEqual(at('N4'), { key: 'company', origin: 'guessed', reason: 'level-n4' });
  assert.deepEqual(at('N3'), { key: 'growth', origin: 'guessed', reason: 'level-n3' });
  assert.deepEqual(at('N2'), { key: 'first-client', origin: 'guessed', reason: 'level-n2' });
  assert.deepEqual(at('N1'), { key: 'prototype', origin: 'guessed', reason: 'level-below-n2' });
  assert.deepEqual(at('N0'), { key: 'prototype', origin: 'guessed', reason: 'level-below-n2' });
  assert.deepEqual(at('N4', 9), { key: 'idea', origin: 'guessed', reason: 'few-files' });
  assert.equal(at('N4', 10).key, 'company', 'ten files is not an idea any more');
});

test('a level of null (not even N0 complete) is a prototype, and no evaluated item at all says no-data', () => {
  const failing = practicesOf([row({ ladder: 'N0', state: 'fail' })]);
  assert.equal(failing.ladder.level, null);
  assert.deepEqual(build({ practices: failing }).stage, { key: 'prototype', origin: 'guessed', reason: 'level-below-n2' });
  assert.deepEqual(build({ practices: practicesOf([row({ state: 'na' })]) }).stage, { key: 'prototype', origin: 'guessed', reason: 'no-data' });
  assert.deepEqual(build({ practices: null }).stage, { key: 'prototype', origin: 'guessed', reason: 'no-data' });
});

test('owner.stage wins over the guess, even over few files', () => {
  const c = build({ profile: profile({ stage: 'growth' }), census: files(3), practices: practicesOf([row({ state: 'pass' })]) });
  assert.deepEqual(c.stage, { key: 'growth', origin: 'owner', reason: 'owner' });
});

test('a flat profile works too, and a missing census does not break the rule', () => {
  assert.equal(build({ profile: { types: ['web'], stage: 'company' } }).stage.key, 'company');
  const rows = [row({ ladder: 'N2', state: 'pass' }), row({ ladder: 'N3', state: 'fail' })];
  assert.equal(build({ census: null, practices: practicesOf(rows) }).stage.key, 'first-client');
});

test('fronts show the state of each of the eight fronts from the practices', () => {
  const rows = [
    row({ front: 'security', state: 'fail' }), row({ front: 'security', state: 'pass' }),
    row({ front: 'quality', state: 'unverified', reason: 'no-data' }), row({ front: 'quality', state: 'pass' }),
    row({ front: 'operation', state: 'pass' }),
    row({ front: 'organization', state: 'na', reason: 'not-applicable' }),
  ];
  const fronts = build({ practices: practicesOf(rows) }).fronts;
  const by = Object.fromEntries(fronts.map((f) => [f.front, f]));
  assert.deepEqual(fronts.map((f) => f.front), ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance']);
  assert.deepEqual(by.security, { front: 'security', state: 'warning', pass: 1, fail: 1, unverified: 0 });
  assert.deepEqual(by.quality, { front: 'quality', state: 'unverified', pass: 1, fail: 0, unverified: 1 });
  assert.equal(by.operation.state, 'ok');
  assert.equal(by.organization.state, 'na', 'a front where nothing applies is na');
  assert.equal(by.legal.state, 'na');
});

test('business fronts are na in a personal project, and in a library with no money answer', () => {
  const business = ['legal', 'product', 'marketing', 'finance'];
  const rows = [...business, 'security'].map((front) => row({ front }));
  const stateOfFronts = (p) => Object.fromEntries(build({ practices: practicesOf(rows), profile: p }).fronts.map((f) => [f.front, f.state]));
  const personal = stateOfFronts(profile({ money: 'personal' }));
  for (const f of business) assert.equal(personal[f], 'na', f);
  assert.equal(personal.security, 'warning');
  const lib = stateOfFronts(profile({}, { types: ['library'] }));
  for (const f of business) assert.equal(lib[f], 'na', f);
  const libWithMoney = stateOfFronts(profile({ money: 'sale' }, { types: ['library'] }));
  for (const f of business) assert.equal(libWithMoney[f], 'warning', f);
  const app = stateOfFronts(profile({}, { types: ['web'] }));
  for (const f of business) assert.equal(app[f], 'warning', f);
  const libWithApp = stateOfFronts(profile({}, { types: ['library', 'web'] }));
  assert.equal(libWithApp.marketing, 'warning', 'a library that also ships a web app is not only a library');
});

test('next3 takes fails before unverified from the lowest incomplete rung, essential first, then cheapest', () => {
  const a = row({ ladder: 'N1', severity: 'E', front: 'security' }); // lowest rung with a problem, essential, dear
  const b = row({ ladder: 'N1', severity: 'E', front: 'quality' }); // essential and cheap -> first
  const c = row({ ladder: 'N1', severity: 'A', front: 'operation' });
  const d = row({ ladder: 'N1', severity: 'R', front: 'organization', state: 'unverified', reason: 'needs-human' });
  const e = row({ ladder: 'N0', severity: 'E', front: 'quality', state: 'pass' });
  const f = row({ ladder: 'N2', severity: 'E', front: 'security' });
  const rows = [a, b, c, d, e, f];
  const effort = { [a.id]: 3, [b.id]: 1, [c.id]: 1, [d.id]: 1, [f.id]: 1 };
  const packages = [pkgOf(rows, {}, (r) => ({ effort: effort[r.id] ?? 1 }))];
  const out = build({ practices: practicesOf(rows), packages });
  assert.deepEqual(ids(out), [b.id, a.id, c.id], 'E cheap, E dear, then A; the unverified one waits behind the fails');
});

test('next3 spills into unverified and the next rung when the lowest one has too few', () => {
  const a = row({ ladder: 'N0', front: 'security' });
  const b = row({ ladder: 'N0', front: 'quality', state: 'unverified', reason: 'needs-human' });
  const c = row({ ladder: 'N1', front: 'operation', severity: 'E' });
  const d = row({ ladder: 'N1', front: 'organization', severity: 'E' });
  const rows = [a, b, c, d];
  assert.deepEqual(ids(build({ practices: practicesOf(rows), packages: [pkgOf(rows)] })), [a.id, b.id, c.id]);
});

test('next3 never repeats one front three times while other fronts have something to do', () => {
  const same = [1, 2, 3, 4].map(() => row({ front: 'security', severity: 'E' }));
  const other = row({ front: 'quality', severity: 'A' });
  const rows = [...same, other];
  const out = build({ practices: practicesOf(rows), packages: [pkgOf(rows)] });
  assert.deepEqual(ids(out), [same[0].id, same[1].id, other.id]);
  assert.ok(out.next3.filter((x) => x.front === 'security').length <= 2);
});

test('next3 fills with the same front when no other front has anything left', () => {
  const rows = [1, 2, 3, 4].map(() => row({ front: 'security', severity: 'E' }));
  assert.equal(build({ practices: practicesOf(rows), packages: [pkgOf(rows)] }).next3.length, 3);
});

test('next3 skips pass and na, and the business fronts that are na in this project', () => {
  const legal = row({ front: 'legal', severity: 'E', ladder: 'N0' });
  const sec = row({ front: 'security', severity: 'A', ladder: 'N1' });
  const done = row({ front: 'quality', state: 'pass', ladder: 'N0' });
  const na = row({ front: 'quality', state: 'na', reason: 'not-applicable', ladder: 'N0' });
  const rows = [legal, sec, done, na];
  assert.deepEqual(ids(build({ practices: practicesOf(rows), packages: [pkgOf(rows)] })), [legal.id, sec.id]);
  assert.deepEqual(ids(build({ practices: practicesOf(rows), packages: [pkgOf(rows)], profile: profile({ money: 'personal' }) })), [sec.id]);
  assert.deepEqual(build({ practices: practicesOf([done, na]) }).next3, []);
});

test('the example is filled only with facts of the project; with no fact it is left out', () => {
  const r = row({ front: 'security' });
  const packages = [pkgOf([r], {}, () => ({ example: T('Your route {route} and table {table} need it') }))];
  const facts = [
    { id: 'route:POST /orders', kind: 'route', name: 'POST /orders', file: 'a.js', line: 3, origin: 'EXTRACTED', attrs: { method: 'POST', path: '/orders' } },
    { id: 'route:GET /0dup', kind: 'route', name: 'GET /0dup', file: 'a.js', line: 2, origin: 'AMBIGUOUS', attrs: { method: 'GET', path: '/0dup' } },
    { id: 'route:GET /dyn', kind: 'route', name: 'GET /dyn', file: 'a.js', line: 9, origin: 'AMBIGUOUS', attrs: { method: 'GET', path: null } },
    { id: 'route:GET /a', kind: 'route', name: 'GET /a', file: 'a.js', line: 1, origin: 'EXTRACTED', attrs: { method: 'GET', path: '/a' } },
    { id: 'table:Order', kind: 'table', name: 'Order', file: 's.prisma', line: 1, origin: 'EXTRACTED', attrs: {} },
  ];
  const base = { practices: practicesOf([r]), packages };
  assert.deepEqual(build({ ...base, facts }).next3[0].example, { params: { route: 'GET /a', table: 'Order' } });
  assert.equal(build({ ...base, facts: facts.filter((f) => f.kind === 'route') }).next3[0].example, null, 'no table fact: no example at all');
  assert.equal(build({ ...base, facts: [] }).next3[0].example, null);
  assert.equal(build({ ...base }).next3[0].example, null);
});

test('integration and app placeholders come from facts; a text with none has empty params; no text means null', () => {
  const r = row();
  const withEx = (example) => [pkgOf([r], {}, () => (example ? { example } : {}))];
  const facts = [
    { id: 'integration:stripe', kind: 'integration', name: 'stripe', file: 'p.js', line: 1, origin: 'EXTRACTED', attrs: {} },
    { id: 'screen:web:/cart', kind: 'screen', name: '/cart', file: 'c.tsx', line: 1, origin: 'EXTRACTED', attrs: {} },
  ];
  const p = practicesOf([r]);
  assert.deepEqual(build({ practices: p, packages: withEx(T('{integration} in {app}')), facts }).next3[0].example, { params: { integration: 'stripe', app: 'web' } });
  assert.deepEqual(build({ practices: p, packages: withEx(T('Plain text')), facts: [] }).next3[0].example, { params: {} });
  assert.equal(build({ practices: p, packages: withEx(null), facts }).next3[0].example, null);
});

test('a fact name from the project is cleaned before it goes into params', () => {
  const r = row();
  const packages = [pkgOf([r], {}, () => ({ example: T('{route}') }))];
  const facts = [{ id: 'route:GET /x', kind: 'route', name: `GET /x\n${'y'.repeat(300)}`, file: 'a.js', line: 1, origin: 'EXTRACTED', attrs: { path: '/x' } }];
  const value = build({ practices: practicesOf([r]), packages, facts }).next3[0].example.params.route;
  assert.ok(value.length <= 80 && !/[\r\n]/.test(value));
});

test('ask carries a ready request in both languages, the role of the front and suggested skills', () => {
  const sec = row({ front: 'security' });
  const lgl = row({ front: 'legal' });
  const rows = [sec, lgl];
  const out = build({ practices: practicesOf(rows), packages: [pkgOf(rows)] });
  const askOf = (id) => out.next3.find((x) => x.itemId === id).ask;
  const s = askOf(sec.id);
  assert.match(s.text.en, new RegExp(`Title ${sec.id}`));
  assert.match(s.text['pt-BR'], new RegExp(`Title ${sec.id}`));
  assert.match(s.text.en, /before changing/i, 'the chat is told to show the plan first');
  assert.equal(s.role, 'security');
  assert.ok(Array.isArray(s.skills) && s.skills.length > 0 && s.skills.every((x) => typeof x === 'string'));
  assert.match(s.text.en, /if they exist/i, 'skills are suggestions');
  const l = askOf(lgl.id);
  assert.equal(l.role, 'board:legal', 'business fronts go to the board of the orchestration chat');
  assert.match(l.text.en, /not legal advice/i);
});

test('an item whose package is gone still produces an entry, without example and with its id as text', () => {
  const r = row();
  const out = build({ practices: practicesOf([r]), packages: [] });
  assert.equal(out.next3[0].example, null);
  assert.match(out.next3[0].ask.text.en, new RegExp(r.id));
});

test('disclaimers lists the packages in play that carry one', () => {
  const r1 = row({ pkg: 'legal-x', front: 'legal' });
  const r2 = row({ pkg: 'general-q' });
  const packages = [
    { id: 'legal-x', kind: 'legal', disclaimer: T('guidance, not a legal opinion'), items: [def(r1)] },
    { id: 'general-q', kind: 'general', disclaimer: null, items: [def(r2)] },
    { id: 'unused', kind: 'finance', disclaimer: T('x'), items: [] },
  ];
  assert.deepEqual(build({ practices: practicesOf([r1, r2]), packages }).disclaimers, ['legal-x']);
  assert.deepEqual(build({ practices: practicesOf([r2]), packages }).disclaimers, []);
});

test('the same input gives the same output byte for byte', () => {
  const rows = [row({ severity: 'E' }), row({ front: 'security' }), row({ front: 'legal', severity: 'A' })];
  const input = { practices: practicesOf(rows), packages: [pkgOf(rows)] };
  assert.equal(JSON.stringify(build(input)), JSON.stringify(build(input)));
});

test('the input is not changed', () => {
  const rows = [row(), row({ front: 'security' })];
  const input = { practices: practicesOf(rows), packages: [pkgOf(rows)], profile: profile(), facts: [] };
  const before = JSON.stringify(input);
  build(input);
  assert.equal(JSON.stringify(input), before);
});
