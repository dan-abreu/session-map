import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree, ancestorsOf } from '../server/web/tree.js';
import { workingIn, liveWork, livePaths, captionsAt, modelName } from '../server/web/live.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

const chat = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, partId: null, itemCode: null, status: 'busy', archived: false, live: true, liveSteps: [], workflows: [],
  updatedAt: ago(5), waiting: { strong: false, weak: false, items: [] }, ...extra,
});

function shop(chats, { conversations = [], notes = [] } = {}) {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  state.projects[0].chats = chats;
  state.projects[0].conversations = conversations;
  state.projects[1].chats = notes;
  state.projects[1].conversations = [];
  return state;
}

test('workingIn: only busy, unarchived conversations, each on the item it works on, else its part, else the project', () => {
  const state = shop([
    chat('item', { partId: 'orders', itemCode: 'or03', updatedAt: ago(1) }),
    chat('part', { partId: 'payments', updatedAt: ago(2) }),
    chat('loose', { updatedAt: ago(3) }),
    chat('idle', { partId: 'orders', status: 'idle' }),
    chat('closed', { partId: 'orders', status: 'closed', live: false }),
    chat('archived', { partId: 'orders', archived: true }),
  ]);
  const p = state.projects[0];
  const entries = workingIn(p, archTree(p));
  assert.deepEqual(entries.map((e) => e.chat.sessionId), ['item', 'part', 'loose'], 'newest first');
  assert.deepEqual(entries.map((e) => e.nodeId), ['i:orders:or03', 'pt:payments', 'p']);
  assert.deepEqual(entries[0].pathIds, ['p', 'l:engine', 'pt:orders', 'g:orders:Checkout', 'i:orders:or03'], 'from the project down to the item');
  assert.deepEqual(entries[0].place.path, ['What makes it work', 'Orders and cart', 'Checkout', 'One-click checkout with a saved card']);
  assert.deepEqual(entries[2].pathIds, ['p']);
  assert.equal(entries[2].place.special, 'off');
});

test('workingIn: the point a page conversation was opened on places it when it cites no item', () => {
  const state = shop([chat('grp', { partId: 'orders' }), chat('idea', { partId: 'orders' })], {
    conversations: [{ sessionId: 'grp', node: { kind: 'group', group: 'Cart' } }, { sessionId: 'idea', node: { kind: 'idea' } }],
  });
  const p = state.projects[0];
  const by = Object.fromEntries(workingIn(p, archTree(p)).map((e) => [e.chat.sessionId, e]));
  assert.equal(by.grp.nodeId, 'g:orders:Cart');
  assert.equal(by.idea.nodeId, 'p');
  assert.equal(by.idea.place.special, 'idea');
});

test('workingIn: steps newest first, and only the workflows that still have agents running', () => {
  const steps = [{ kind: 'read', target: 'a.ts', ts: ago(4) }, { kind: 'edit', target: 'b.ts', ts: ago(2) }, { kind: 'run', target: 'Run the tests', ts: ago(1) }];
  const workflows = [
    { id: 'w1', name: 'build', started: 3, done: 1, lastLabel: 'Review', running: [{ label: 'Review', model: 'sonnet' }, { label: 'Docs', model: null }] },
    { id: 'w2', name: 'old', started: 2, done: 2, lastLabel: 'Only', running: [] },
    { id: 'w3', name: 'older-server', started: 4, done: 3, lastLabel: 'Last' },
  ];
  const state = shop([chat('a', { partId: 'orders', liveSteps: steps, workflows })]);
  const p = state.projects[0];
  const [e] = workingIn(p, archTree(p));
  assert.deepEqual(e.steps.map((s) => s.kind), ['run', 'edit', 'read']);
  assert.equal(e.lastStep.kind, 'run');
  assert.deepEqual(e.workflows.map((w) => w.id), ['w1', 'w3'], 'a finished workflow drops out; one from an older server counts by its numbers');
  assert.deepEqual(e.workflows[1].running, [], 'no agent list from an older server');
});

test('workingIn: a workflow agent silent for more than 30 minutes is left behind, not shown as running forever', () => {
  const workflows = [
    { id: 'fresh', name: 'fresh', started: 2, done: 0, running: [{ label: 'Now', model: null, activeAt: ago(3) }, { label: 'Stuck', model: null, activeAt: ago(120) }] },
    { id: 'dead', name: 'dead', started: 1, done: 0, running: [{ label: 'Killed', model: 'opus', activeAt: ago(300) }] },
  ];
  const state = shop([chat('a', { partId: 'orders', workflows })]);
  const p = state.projects[0];
  const [e] = workingIn(p, archTree(p), Date.parse(NOW));
  assert.deepEqual(e.workflows.map((w) => w.id), ['fresh']);
  assert.deepEqual(e.workflows[0].running.map((a) => a.label), ['Now']);
});

test('liveWork: every project, the open one first, with the total', () => {
  const state = shop([chat('a', { partId: 'orders' })], { notes: [chat('n', { title: 'Sync', updatedAt: ago(1) }), chat('n2', { status: 'idle' })] });
  const fromNotes = liveWork(state, { projectId: state.projects[1].id });
  assert.deepEqual(fromNotes.groups.map((g) => g.project.name), ['notes-app', 'acme-shop']);
  assert.equal(fromNotes.total, 2);
  const fromShop = liveWork(state, { projectId: state.projects[0].id });
  assert.deepEqual(fromShop.groups.map((g) => g.project.name), ['acme-shop', 'notes-app']);
  assert.deepEqual(liveWork(shop([]), { projectId: 'x' }), { groups: [], total: 0 });
});

test('livePaths: every box on the way to each tip lights, and each tip keeps its conversations', () => {
  const state = shop([
    chat('a', { partId: 'orders', itemCode: 'or03', updatedAt: ago(1) }),
    chat('b', { partId: 'orders', itemCode: 'or03', updatedAt: ago(9) }),
    chat('c', { partId: 'search' }),
  ]);
  const p = state.projects[0];
  const tree = archTree(p);
  const { nodes, tips } = livePaths(workingIn(p, tree));
  assert.deepEqual([...nodes].sort(), ['g:orders:Checkout', 'i:orders:or03', 'l:engine', 'p', 'pt:orders', 'pt:search'].sort());
  assert.deepEqual(tips.get('i:orders:or03').map((e) => e.chat.sessionId), ['a', 'b']);
  assert.deepEqual([...tips.keys()].sort(), ['i:orders:or03', 'pt:search']);
  assert.equal(livePaths([]).nodes.size, 0);
});

test('captionsAt: the caption sits on the deepest box the map shows on the way, the newest conversation first', () => {
  const state = shop([
    chat('a', { partId: 'orders', itemCode: 'or03', updatedAt: ago(1), title: 'Checkout' }),
    chat('b', { partId: 'orders', itemCode: 'or01', updatedAt: ago(3) }),
    chat('c', { partId: 'search' }),
  ]);
  const p = state.projects[0];
  const tree = archTree(p);
  const entries = workingIn(p, tree);
  const shut = captionsAt((id) => ['p', 'l:engine'].includes(id), entries);
  assert.deepEqual([...shut.keys()].sort(), ['pt:orders', 'pt:search'], 'the parts are the deepest boxes shown');
  const orders = shut.get('pt:orders');
  assert.equal(orders.entry.chat.sessionId, 'a');
  assert.equal(orders.more, 1, 'one more conversation works under the same box');
  assert.equal(orders.exact, false, 'the tip is further down, behind a closed box');
  assert.equal(shut.get('pt:search').exact, true);

  const all = (id) => ancestorsOf(tree, 'i:orders:or03').includes(id) || ancestorsOf(tree, 'i:orders:or01').includes(id);
  const opened = captionsAt(all, entries);
  assert.equal(opened.get('i:orders:or03').exact, true);
  assert.equal(opened.get('i:orders:or03').more, 0);
  assert.ok(opened.has('i:orders:or01'));
});

test('modelName: a bare alias gets a capital, a full id reads as a person says it, none stays none', () => {
  assert.equal(modelName('sonnet'), 'Sonnet');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName(null), null);
});
