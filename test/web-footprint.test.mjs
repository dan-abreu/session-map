import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree, kindCounts, nodeById, shareText, sizeOf } from '../server/web/tree.js';
import { conversationCounts, listConversations, workWords } from '../server/web/convlist.js';
import { workingIn } from '../server/web/live.js';
import { nowJobs } from '../server/web/now.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

const SIZES = {
  total: { files: 40, lines: 2000 },
  parts: { orders: { files: 6, lines: 500, kinds: { code: 4, screen: 1, test: 1, doc: 0 } }, payments: { files: 1, lines: 4, kinds: { code: 1, screen: 0, test: 0, doc: 0 } } },
  layers: { engine: { files: 7, lines: 504 } },
  unowned: { files: 3, lines: 90, paths: ['a.js'] },
  left: { dep: { files: 1, paths: [] }, generated: { files: 0, paths: [] }, binary: { files: 0, paths: [] } },
};

const footprint = (shop, notes) => ({
  edited: 4,
  places: [
    { projectId: notes.id, name: notes.name, edited: 3, seen: 0, share: 0.75, parts: [] },
    { projectId: shop.id, name: shop.name, edited: 1, seen: 0, share: 0.25, parts: [{ partId: 'orders', edited: 1, seen: 0, share: 0.25 }] },
  ],
});

function state2() {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  const [shop, notes] = state.projects;
  shop.arch.sizes = SIZES;
  shop.conversations = [];
  shop.chats = [];
  const fp = footprint(shop, notes);
  const base = { title: 'Cross work', origin: 'terminal', itemCode: null, node: null, waiting: false, lastStep: null, startedAt: ago(90), updatedAt: ago(2), archived: false, live: true, chattable: false, onMap: true };
  notes.conversations = [{ ...base, sessionId: 'x1', partId: null, status: 'busy', costUSD: 3, footprint: fp }];
  notes.chats = [];
  shop.visitors = [{ ...base, sessionId: 'x1', partId: 'orders', partSource: 'files', status: 'busy', costUSD: null, onMap: false, footprint: fp, bornIn: { projectId: notes.id, name: notes.name }, stepPartId: 'payments', liveSteps: [{ kind: 'edit', target: 'pay.ts', ts: ago(1) }], workflows: [] }];
  return state;
}

test('sizeOf reads the files and lines of the program, a layer and a part; groups and items have none', () => {
  const project = { ...clone(DEMO.projects[0]), arch: { ...clone(DEMO.projects[0].arch), sizes: SIZES } };
  const tree = archTree(project);
  assert.deepEqual(sizeOf(SIZES, tree), { files: 40, lines: 2000, share: 1 });
  assert.deepEqual(sizeOf(SIZES, nodeById(tree, 'l:engine')), { files: 7, lines: 504, share: 0.252 });
  assert.deepEqual(sizeOf(SIZES, nodeById(tree, 'pt:orders')), { files: 6, lines: 500, share: 0.25 });
  assert.deepEqual(sizeOf(SIZES, nodeById(tree, 'pt:search')), { files: 0, lines: 0, share: 0 }, 'a part with no file of its own counts zero');
  assert.equal(sizeOf(SIZES, nodeById(tree, 'g:orders:Checkout')), null);
  assert.equal(sizeOf(undefined, tree), null, 'a server older than the counts sends none');
});

test('shareText rounds to whole percents and never shows a real part as 0%', () => {
  assert.equal(shareText(0.252), '25%');
  assert.equal(shareText(0.002), '<1%');
  assert.equal(shareText(0), '0%');
  assert.equal(shareText(1), '100%');
});

test('workWords says where a conversation was born and where else it works, only when it works outside its home', () => {
  const state = state2();
  const [shop, notes] = state.projects;
  const row = notes.conversations[0];
  assert.deepEqual(workWords(row, notes), { born: 'notes-app', working: ['acme-shop'] });
  assert.deepEqual(workWords(shop.visitors[0], shop), { born: 'notes-app', working: ['acme-shop'] }, 'a visitor names its home from the row');
  assert.equal(workWords({ footprint: { edited: 1, places: [{ projectId: notes.id, name: notes.name, edited: 1, seen: 0, share: 1, parts: [] }] } }, notes), null);
  assert.equal(workWords({}, notes), null);
});

test('listConversations shows a visitor in the project it works in, in its own group, with its home to open it from', () => {
  const state = state2();
  const [shop, notes] = state.projects;
  const out = listConversations(state, { projectId: shop.id });
  const [sec] = out.sections;
  assert.equal(sec.project.id, shop.id);
  assert.deepEqual(sec.visiting.map((e) => [e.row.sessionId, e.nodeId, e.home.id]), [['x1', 'pt:orders', notes.id]]);
  assert.equal(sec.working.length, 0, 'it works for another project: its own group, not this project\'s working now');
  assert.equal(out.total, 1);
  const all = listConversations(state, { projectId: shop.id, scope: 'all' });
  assert.deepEqual(all.sections.map((s) => [s.project.name, s.visiting.length + s.working.length]).sort(), [['acme-shop', 1], ['notes-app', 1]], 'listed in both projects');
  assert.equal(listConversations(state, { projectId: shop.id, nodeId: 'pt:payments' }).total, 0, 'the box filter applies to visitors too');
  const counts = conversationCounts(shop, archTree(shop));
  assert.equal(counts.get('pt:orders'), 1, 'its box counts it');
});

test('workingIn lights a visitor on the map where its latest file is, only when asked for visitors', () => {
  const state = state2();
  const [shop] = state.projects;
  const tree = archTree(shop);
  assert.deepEqual(workingIn(shop, tree, Date.parse(NOW)).map((e) => e.chat.sessionId), []);
  const [entry] = workingIn(shop, tree, Date.parse(NOW), { visitors: true });
  assert.equal(entry.chat.sessionId, 'x1');
  assert.equal(entry.nodeId, 'pt:payments', 'the part of the file in its latest step');
});

test('workingIn: a chat\'s latest file in another part of its own project lights that part', () => {
  const state = clone(DEMO);
  const shop = state.projects[0];
  const chat = shop.chats.find((c) => c.status === 'busy' && !c.archived);
  chat.stepPartId = 'search';
  chat.itemCode = null;
  const entry = workingIn(shop, archTree(shop), Date.parse(state.generatedAt)).find((e) => e.chat.sessionId === chat.sessionId);
  assert.equal(entry.nodeId, 'pt:search');
});

test('nowJobs carries where a card was born and where it works', () => {
  const state = state2();
  const [shop, notes] = state.projects;
  notes.chats = [{ sessionId: 'x1', title: 'Cross work', partId: null, itemCode: null, status: 'busy', archived: false, live: true, waiting: { strong: false, weak: false, items: [] }, liveSteps: [], workflows: [], updatedAt: ago(2), footprint: footprint(shop, notes) }];
  const card = nowJobs(state).cards.find((c) => c.chat.sessionId === 'x1');
  assert.deepEqual(card.work, { born: 'notes-app', working: ['acme-shop'] });
  assert.equal(nowJobs(state).cards.filter((c) => c.chat.sessionId === 'x1').length, 1, 'one card, from its home');
});

test('kindCounts splits a box\'s counted files into screens, code, tests and docs, leaving out files with no count', () => {
  const files = [{ path: 'a.tsx', kind: 'screen', lines: 3 }, { path: 'b.js', kind: 'code', lines: 9 }, { path: 'c.test.js', kind: 'test', lines: 2 }, { path: 'd.js', kind: 'code', lines: 1 }, { path: 'gone.js', status: 'D' }];
  assert.deepEqual(kindCounts(files), [{ kind: 'screen', files: 1, lines: 3 }, { kind: 'code', files: 2, lines: 10 }, { kind: 'test', files: 1, lines: 2 }]);
  assert.deepEqual(kindCounts([]), []);
});
