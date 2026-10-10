import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findingId, readFindings, writeFindings, mergeFindings, setFindingState } from '../server/foundation/findings.mjs';
import { fdPath } from '../server/foundation/store.mjs';

const ID = 'acme-shop-8324f1';
const T1 = '2026-10-10T10:00:00.000Z';
const T2 = '2026-10-10T11:00:00.000Z';
const withDir = (fn) => { const d = mkdtempSync(join(tmpdir(), 'sm-findings-')); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

function found(rule, file, line, params = { name: 'GET /orders' }, extra = {}) {
  return {
    id: findingId(rule, file, params), rule, severity: 'important', target: { file, line }, evidence: [],
    what: { msg: 'watch.x.what', params }, why: { msg: 'watch.x.why' }, todo: { msg: 'watch.x.todo' },
    fix: { kind: 'ai-update', opId: null }, ...extra,
  };
}

test('findingId is f: plus 12 hex, ignores param order and line', () => {
  const a = findingId('doc-cites-missing', 'docs/api.md', { name: 'GET /orders', kind: 'route' });
  assert.match(a, /^f:[0-9a-f]{12}$/);
  assert.equal(a, findingId('doc-cites-missing', 'docs/api.md', { kind: 'route', name: 'GET /orders' }));
  assert.notEqual(a, findingId('doc-cites-missing', 'README.md', { name: 'GET /orders', kind: 'route' }));
  assert.notEqual(a, findingId('pointer-broken', 'docs/api.md', { name: 'GET /orders', kind: 'route' }));
});

test('missing file reads as an empty list', () => withDir((d) => {
  assert.deepEqual(readFindings(d, ID), []);
}));

test('write then read gives the findings back', () => withDir((d) => {
  const list = [{ ...found('doc-size', 'README.md', 1, {}), state: 'open', firstSeen: T1, lastSeen: T1 }];
  writeFindings(d, ID, list);
  assert.deepEqual(readFindings(d, ID), list);
}));

test('a file with an unknown version is redone from zero', () => withDir((d) => {
  mkdirSync(join(d, 'brain', ID, 'foundation'), { recursive: true });
  writeFileSync(fdPath(d, ID, 'findings.json'), JSON.stringify({ version: 9, findings: [{ id: 'f:x' }] }));
  assert.deepEqual(readFindings(d, ID), []);
}));

test('a corrupt shape reads as an empty list', () => withDir((d) => {
  mkdirSync(join(d, 'brain', ID, 'foundation'), { recursive: true });
  writeFileSync(fdPath(d, ID, 'findings.json'), JSON.stringify({ version: 1, findings: 'nope' }));
  assert.deepEqual(readFindings(d, ID), []);
}));

test('same finding in two rounds does not duplicate, even if the line moves', () => {
  const r1 = mergeFindings([], [found('doc-cites-missing', 'docs/api.md', 33)], T1);
  const r2 = mergeFindings(r1, [found('doc-cites-missing', 'docs/api.md', 40)], T2);
  assert.equal(r2.length, 1);
  assert.equal(r2[0].state, 'open');
  assert.equal(r2[0].firstSeen, T1);
  assert.equal(r2[0].lastSeen, T2);
  assert.equal(r2[0].target.line, 40);
});

test('new findings enter open with firstSeen and lastSeen', () => {
  const [f] = mergeFindings([], [found('doc-size', 'README.md', 1, {})], T1);
  assert.deepEqual([f.state, f.firstSeen, f.lastSeen], ['open', T1, T1]);
});

test('never survives rounds, present or absent', () => {
  const base = mergeFindings([], [found('doc-cites-missing', 'docs/api.md', 3)], T1);
  const never = base.map((f) => ({ ...f, state: 'never' }));
  assert.equal(mergeFindings(never, [found('doc-cites-missing', 'docs/api.md', 3)], T2)[0].state, 'never');
  const gone = mergeFindings(never, [], T2);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].state, 'never');
});

test('later stays later while present and goes away when gone', () => {
  const later = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1).map((f) => ({ ...f, state: 'later' }));
  assert.equal(mergeFindings(later, [found('doc-size', 'a.md', 1, {})], T2)[0].state, 'later');
  assert.deepEqual(mergeFindings(later, [], T2), []);
});

test('accepted that disappears becomes applied; open that disappears is dropped', () => {
  const [a, b] = mergeFindings([], [found('doc-size', 'a.md', 1, {}), found('doc-size', 'b.md', 1, {})], T1);
  const out = mergeFindings([{ ...a, state: 'accepted' }, b], [], T2);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, a.id);
  assert.equal(out[0].state, 'applied');
});

test('applied that comes back is open again', () => {
  const [a] = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1);
  const out = mergeFindings([{ ...a, state: 'applied' }], [found('doc-size', 'a.md', 1, {})], T2);
  assert.equal(out[0].state, 'open');
});

test('at most 50 per rule, decisions kept first', () => {
  const many = Array.from({ length: 70 }, (_, i) => found('code-without-doc', `src/f${i}.ts`, 1, { i }));
  const first = mergeFindings([], many, T1);
  assert.equal(first.length, 50);
  const decided = { ...found('code-without-doc', 'src/zz.ts', 1, { i: 'zz' }), state: 'never', firstSeen: T1, lastSeen: T1 };
  const second = mergeFindings([decided], many, T2);
  assert.equal(second.length, 50);
  assert.ok(second.some((f) => f.id === decided.id), 'the never one is not pushed out');
  const other = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1);
  assert.equal(mergeFindings(other, [...many, found('doc-size', 'a.md', 1, {})], T2).length, 51, 'the cap is per rule');
});

test('setFindingState follows the state machine and persists', () => withDir((d) => {
  const list = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1);
  writeFindings(d, ID, list);
  const fid = list[0].id;
  assert.equal(setFindingState(d, ID, fid, 'never').ok, true);
  assert.equal(readFindings(d, ID)[0].state, 'never');
  assert.deepEqual(setFindingState(d, ID, fid, 'accepted'), { ok: false, error: 'bad-transition' });
  assert.equal(readFindings(d, ID)[0].state, 'never');
}));

test('full path open -> accepted -> undone -> open, with opId recorded', () => withDir((d) => {
  const list = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1);
  writeFindings(d, ID, list);
  const fid = list[0].id;
  assert.equal(setFindingState(d, ID, fid, 'accepted', 'op:1').ok, true);
  assert.equal(readFindings(d, ID)[0].fix.opId, 'op:1');
  assert.equal(setFindingState(d, ID, fid, 'undone').ok, true);
  assert.equal(setFindingState(d, ID, fid, 'open').ok, true);
  assert.equal(setFindingState(d, ID, fid, 'later').ok, true);
}));

test('open -> applied is refused; unknown id and unknown state are refused', () => withDir((d) => {
  const list = mergeFindings([], [found('doc-size', 'a.md', 1, {})], T1);
  writeFindings(d, ID, list);
  assert.equal(setFindingState(d, ID, list[0].id, 'applied').error, 'bad-transition');
  assert.equal(setFindingState(d, ID, 'f:000000000000', 'never').error, 'not-found');
  assert.equal(setFindingState(d, ID, list[0].id, 'bogus').error, 'bad-state');
}));
