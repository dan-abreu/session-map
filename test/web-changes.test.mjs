import test from 'node:test';
import assert from 'node:assert/strict';
import { changeDays, changeGroups, changeTotals, filterChanges, freshFor } from '../server/web/changes.js';
import { localDay } from '../server/web/transcript.js';

const at = (d, h) => new Date(2026, 9, d, h, 0, 0).toISOString();
const row = (over) => ({ id: Math.random().toString(36).slice(2), ts: at(9, 10), kind: 'edit', path: 'src/a.js', added: 2, removed: 1, partId: 'shop', sessionId: 's1', projectId: 'p1', state: 'pending', ...over });

const ROWS = [
  row({ id: 'a', ts: at(9, 11) }),
  row({ id: 'b', ts: at(9, 10), path: 'src/b.js', kind: 'create', added: 10, removed: 0, state: 'saved' }),
  row({ id: 'c', ts: at(8, 9), path: 'src/a.js', partId: 'billing', sessionId: 's2', state: 'released' }),
  row({ id: 'd', ts: at(7, 9), path: 'old.js', kind: 'delete', added: 0, removed: 5, partId: null, sessionId: null, projectId: 'p2' }),
];

test('the filters narrow the list by project, part, conversation, kind, period and day', () => {
  const ids = (f) => filterChanges(ROWS, f).map((r) => r.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ projectId: 'p2' }), ['d']);
  assert.deepEqual(ids({ partId: 'shop' }), ['a', 'b']);
  assert.deepEqual(ids({ partId: '' }), ['a', 'b', 'c', 'd'], 'an empty choice means every part');
  assert.deepEqual(ids({ partId: '-' }), ['d'], 'files with no box on the map');
  assert.deepEqual(ids({ sessionId: 's2' }), ['c']);
  assert.deepEqual(ids({ sessionId: '-' }), ['d'], 'made outside the conversations');
  assert.deepEqual(ids({ kind: 'create' }), ['b']);
  assert.deepEqual(ids({ range: { from: Date.parse(at(8, 0)), to: Date.parse(at(8, 23)) } }), ['c']);
  assert.deepEqual(ids({ day: localDay(at(9, 0)) }), ['a', 'b']);
});

test('the day by day line counts files, lines and changes of each day, oldest first', () => {
  assert.deepEqual(changeDays(ROWS), [
    { day: localDay(at(7, 9)), n: 1, files: 1, added: 0, removed: 5 },
    { day: localDay(at(8, 9)), n: 1, files: 1, added: 2, removed: 1 },
    { day: localDay(at(9, 9)), n: 2, files: 2, added: 12, removed: 1 },
  ]);
});

test('the totals say how many files and lines changed and how many are not saved, saved or released', () => {
  assert.deepEqual(changeTotals(ROWS), { n: 4, files: 3, added: 14, removed: 7, pending: 2, saved: 1, released: 1 });
  assert.deepEqual(changeTotals([]), { n: 0, files: 0, added: 0, removed: 0, pending: 0, saved: 0, released: 0 });
});

test('the list is cut into days, newest day first', () => {
  assert.deepEqual(changeGroups(ROWS).map((g) => [g.day, g.rows.map((r) => r.id)]), [
    [localDay(at(9, 0)), ['a', 'b']], [localDay(at(8, 0)), ['c']], [localDay(at(7, 0)), ['d']],
  ]);
});

test('a box lights with what changed in it in the last minutes; a layer and the project add up their parts', () => {
  const fresh = { files: 4, lines: 30, parts: { shop: { files: 1, lines: 6 }, billing: { files: 2, lines: 20 } } };
  assert.deepEqual(freshFor(fresh, { kind: 'part', partId: 'shop' }), { files: 1, lines: 6 });
  assert.deepEqual(freshFor(fresh, { kind: 'layer', partIds: ['shop', 'billing', 'other'] }), { files: 3, lines: 26 });
  assert.deepEqual(freshFor(fresh, { kind: 'project' }), { files: 4, lines: 30 });
  assert.equal(freshFor(fresh, { kind: 'part', partId: 'other' }), null);
  assert.equal(freshFor(null, { kind: 'project' }), null);
  assert.equal(freshFor(fresh, { kind: 'item' }), null);
});

test('each line of a before and after carries its number in the old file and in the new one', async () => {
  const { hunkRows } = await import('../server/web/changes.js');
  assert.deepEqual(hunkRows({ oldStart: 10, newStart: 10, lines: [' a', '-b', '+B', '+C', ' d'] }), [
    { sign: ' ', old: 10, new: 10, text: 'a' },
    { sign: '-', old: 11, new: null, text: 'b' },
    { sign: '+', old: null, new: 11, text: 'B' },
    { sign: '+', old: null, new: 12, text: 'C' },
    { sign: ' ', old: 12, new: 13, text: 'd' },
  ]);
  assert.deepEqual(hunkRows({ oldStart: 0, newStart: 0, lines: ['-x', '+y'] }).map((r) => [r.old, r.new]), [[null, null], [null, null]], 'replaced pieces with no place in the file have no numbers');
});

test('a change by a helper of a team says the helper and its team, and keeps the request that led to it (mm31)', async () => {
  const { whoWords } = await import('../server/web/changes.js');
  const t = (key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key);
  const base = { sessionId: 's1', title: 'Checkout', model: null };
  assert.equal(whoWords(t, { ...base, agent: { label: 'Write the tests', model: 'claude-haiku-4-5', workflow: { id: 'wf_a', name: 'trace' }, request: { text: 'do it', ts: null } } }),
    'changes.who.team:Write the tests|trace · Checkout · Haiku 4.5');
  assert.equal(whoWords(t, { ...base, agent: { label: 'Write the tests', model: 'haiku' } }), 'changes.who.helper:Write the tests · Checkout · Haiku');
  assert.equal(whoWords(t, { ...base, model: 'claude-opus-5-5' }), 'Checkout · Opus 5.5');
  assert.equal(whoWords(t, { sessionId: null }), 'changes.who.outside');
});
