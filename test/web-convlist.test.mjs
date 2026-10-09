import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree } from '../server/web/tree.js';
import { conversationsOf, nodeOfConversation, placeOf, listConversations, conversationCounts, dateGroup, projectHue } from '../server/web/convlist.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

const row = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, origin: 'terminal', partId: null, itemCode: null, node: null, status: 'closed', waiting: false,
  lastStep: null, costUSD: 1, startedAt: ago(600), updatedAt: ago(60), archived: false, live: false, chattable: true, onMap: true, ...extra,
});

function shop(conversations) {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  state.projects[0].conversations = conversations;
  state.projects[1].conversations = [row('n1', { title: 'Sync notes offline', updatedAt: ago(5) })];
  return state;
}

test('nodeOfConversation: the item it works on, else its part, layer or group, and the project for an idea, a new map or none', () => {
  const tree = archTree(DEMO.projects[0]);
  assert.equal(nodeOfConversation(tree, row('a', { partId: 'orders', itemCode: 'or03' })), 'i:orders:or03');
  assert.equal(nodeOfConversation(tree, row('b', { partId: 'orders', itemCode: 'zz99' })), 'pt:orders', 'a code the map no longer has falls back to the part');
  assert.equal(nodeOfConversation(tree, row('c', { partId: 'orders' })), 'pt:orders');
  assert.equal(nodeOfConversation(tree, row('d', { node: { kind: 'layer', layerId: 'engine' } })), 'l:engine');
  assert.equal(nodeOfConversation(tree, row('e', { partId: 'orders', node: { kind: 'group', group: 'Checkout' } })), 'g:orders:Checkout');
  for (const kind of ['idea', 'create-arch', 'flow']) assert.equal(nodeOfConversation(tree, row('f', { partId: 'orders', node: { kind } })), 'p', kind);
  assert.equal(nodeOfConversation(tree, row('g')), 'p');
  assert.equal(nodeOfConversation(tree, row('h', { partId: 'gone' })), 'p');
});

test('placeOf names the way down the map, and marks the points that are not boxes', () => {
  const tree = archTree(DEMO.projects[0]);
  assert.deepEqual(placeOf(tree, row('a', { partId: 'orders', itemCode: 'or03' })), { path: ['What makes it work', 'Orders and cart', 'Checkout', 'One-click checkout with a saved card'], special: null });
  assert.deepEqual(placeOf(tree, row('b', { partId: 'payments' })).path, ['What makes it work', 'Payments']);
  assert.deepEqual(placeOf(tree, row('c', { node: { kind: 'idea' } })), { path: [], special: 'idea' });
  assert.deepEqual(placeOf(tree, row('d', { node: { kind: 'create-arch' } })), { path: [], special: 'create-arch' });
  assert.deepEqual(placeOf(tree, row('e')), { path: [], special: 'off' });
});

test('listConversations: working now first, then waiting for you, then the rest newest first', () => {
  const state = shop([
    row('old', { updatedAt: ago(3000) }),
    row('busy', { status: 'busy', partId: 'orders', updatedAt: ago(2) }),
    row('asks', { waiting: true, updatedAt: ago(30) }),
    row('busyAsks', { status: 'busy', waiting: true, updatedAt: ago(1) }),
    row('new', { updatedAt: ago(10) }),
  ]);
  const out = listConversations(state, { projectId: state.projects[0].id });
  assert.deepEqual(out.working.map((x) => x.row.sessionId), ['busyAsks', 'busy']);
  assert.deepEqual(out.waiting.map((x) => x.row.sessionId), ['asks']);
  assert.deepEqual(out.recent.map((x) => x.row.sessionId), ['new', 'old']);
  assert.equal(out.total, 5);
  assert.equal(out.working[1].nodeId, 'pt:orders');
  assert.deepEqual(out.working[1].place.path, ['What makes it work', 'Orders and cart']);
  assert.equal(out.working[1].project.id, state.projects[0].id);
});

test('listConversations hides archived rows unless asked, and the toggle "all projects" merges every project', () => {
  const state = shop([row('kept'), row('gone', { archived: true })]);
  const id = state.projects[0].id;
  assert.deepEqual(listConversations(state, { projectId: id }).recent.map((x) => x.row.sessionId), ['kept']);
  assert.deepEqual(listConversations(state, { projectId: id, showArchived: true }).recent.map((x) => x.row.sessionId).sort(), ['gone', 'kept']);
  const all = listConversations(state, { projectId: id, scope: 'all' });
  assert.deepEqual(all.recent.map((x) => [x.row.sessionId, x.project.name]), [['n1', 'notes-app'], ['kept', 'acme-shop']]);
});

test('listConversations searches the title and the place, ignoring accents and case', () => {
  const state = shop([row('a', { title: 'Revisão do carrinho' }), row('b', { title: 'Pay button', partId: 'payments' }), row('c', { title: 'Other' })]);
  const id = state.projects[0].id;
  const ids = (query) => listConversations(state, { projectId: id, query }).recent.map((x) => x.row.sessionId);
  assert.deepEqual(ids('REVISAO'), ['a']);
  assert.deepEqual(ids('payments'), ['b'], 'the part name is searched too');
  assert.deepEqual(ids('  '), ['a', 'b', 'c']);
});

test('listConversations filtered on a box keeps the conversations at that box and below it', () => {
  const state = shop([
    row('item', { partId: 'orders', itemCode: 'or03' }),
    row('part', { partId: 'orders', updatedAt: ago(70) }),
    row('other', { partId: 'payments', updatedAt: ago(80) }),
    row('idea', { node: { kind: 'idea' }, updatedAt: ago(90) }),
  ]);
  const id = state.projects[0].id;
  const ids = (nodeId) => listConversations(state, { projectId: id, nodeId }).recent.map((x) => x.row.sessionId);
  assert.deepEqual(ids('pt:orders'), ['item', 'part']);
  assert.deepEqual(ids('i:orders:or03'), ['item']);
  assert.deepEqual(ids('l:engine'), ['item', 'part', 'other']);
  assert.deepEqual(ids('p'), ['item', 'part', 'other', 'idea']);
});

test('conversationCounts gives each box the conversations at it and below, up to the project', () => {
  const state = shop([
    row('item', { partId: 'orders', itemCode: 'or03' }),
    row('part', { partId: 'orders' }),
    row('other', { partId: 'payments' }),
    row('loose'),
    row('hidden', { partId: 'orders', archived: true }),
  ]);
  const project = state.projects[0];
  const counts = conversationCounts(project, archTree(project));
  assert.equal(counts.get('i:orders:or03'), 1);
  assert.equal(counts.get('g:orders:Checkout'), 1);
  assert.equal(counts.get('pt:orders'), 2);
  assert.equal(counts.get('pt:payments'), 1);
  assert.equal(counts.get('l:engine'), 3);
  assert.equal(counts.get('p'), 4);
  assert.equal(counts.get('pt:search'), undefined);
  assert.equal(conversationCounts(project, archTree(project), { showArchived: true }).get('pt:orders'), 3);
});

test('conversationsOf falls back to the map\'s chats for a state from an older server', () => {
  const project = clone(DEMO.projects[0]);
  delete project.conversations;
  const rows = conversationsOf(project);
  assert.equal(rows.length, project.chats.length);
  const vs = rows.find((r) => r.sessionId === project.chats.find((c) => c.entrypoint === 'claude-vscode').sessionId);
  assert.equal(vs.origin, 'vscode');
  const busy = project.chats.find((c) => c.status === 'busy');
  const busyRow = rows.find((r) => r.sessionId === busy.sessionId);
  assert.deepEqual([busyRow.status, busyRow.partId, busyRow.costUSD, busyRow.onMap], ['busy', busy.partId, busy.costUSD, true]);
  assert.equal(conversationsOf({ ...project, conversations: [row('x')] }).length, 1);
});

test('dateGroup splits by calendar day like Claude and ChatGPT: today, yesterday, the last 7 days, older', () => {
  const now = new Date(2026, 9, 9, 15, 0).getTime();
  const at = (d, h = 10) => new Date(2026, 9, d, h, 0).toISOString();
  assert.equal(dateGroup(at(9, 0), now), 'today', 'just after midnight is still today');
  assert.equal(dateGroup(at(8, 23), now), 'yesterday', 'late last night is yesterday, though less than a day ago');
  assert.equal(dateGroup(at(3), now), 'week');
  assert.equal(dateGroup(at(2), now), 'older');
  assert.equal(dateGroup(null, now), 'older');
});

test('listConversations gives one section per project: pinned orchestration, working, waiting, then by date', () => {
  const now = Date.parse(NOW);
  const state = shop([
    row('orch', { node: { kind: 'orchestration' }, status: 'busy', updatedAt: ago(1) }),
    row('busy', { status: 'busy', updatedAt: ago(2) }),
    row('asks', { waiting: true, updatedAt: ago(3) }),
    row('today', { updatedAt: ago(4) }),
    row('old', { updatedAt: ago(60 * 24 * 20) }),
  ]);
  const [sec] = listConversations(state, { projectId: state.projects[0].id }).sections;
  assert.equal(sec.project.name, 'acme-shop');
  assert.equal(sec.hue, projectHue(state.projects[0]));
  const ids = (k) => sec[k].map((e) => e.row.sessionId);
  assert.deepEqual(ids('pinned'), ['orch'], 'the orchestration chat sits on top whatever it is doing');
  assert.deepEqual(ids('working'), ['busy']);
  assert.deepEqual(ids('waiting'), ['asks']);
  assert.deepEqual(ids(dateGroup(ago(4), now)), ['today']);
  assert.deepEqual(ids('older'), ['old']);
  assert.deepEqual(sec.counts, { working: 2, waiting: 1, total: 5 });
});

test('in "All projects" every row carries its project, and the projects with work going on come first', () => {
  const state = shop([row('a', { updatedAt: ago(500) }), row('b', { updatedAt: ago(600) })]);
  state.projects[1].conversations = [row('n1', { title: 'Sync notes offline', updatedAt: ago(900), waiting: true })];
  const out = listConversations(state, { projectId: state.projects[0].id, scope: 'all' });
  assert.deepEqual(out.sections.map((s) => s.project.name), ['notes-app', 'acme-shop'], 'waiting for you pulls a project up');
  const rows = out.sections.flatMap((s) => ['pinned', 'working', 'waiting', 'today', 'yesterday', 'week', 'older'].flatMap((k) => s[k]));
  assert.equal(rows.length, out.total);
  for (const e of rows) assert.ok(e.project.name, `${e.row.sessionId} has no project name`);
  assert.notEqual(projectHue(state.projects[0]), projectHue(state.projects[1]), 'each project has its own color');
});

// Just enough DOM for createConvList to draw into: elements with children, text, listeners and a class list.
class El {
  constructor(tag = 'div', id = null) { Object.assign(this, { tag, id, attrs: {}, children: [], listeners: {}, textContent: '', hidden: false, scrollTop: 0, value: '' }); this.classList = { toggle() {}, contains: () => false }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(c) { this.children.push(typeof c === 'string' ? Object.assign(new El('#text'), { textContent: c }) : c); }
  replaceChildren(...cs) { this.children = []; for (const c of cs) this.append(c); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] ?? []) fn({ key: '', stopPropagation() {} }); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  contains() { return false; }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
}
function fakeH(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false && !k.startsWith('on')) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

test('the column draws the "nothing matches" screen for a search with no result, instead of throwing', async () => {
  const { createConvList } = await import('../server/web/convlist.js');
  const els = new Map();
  const realDocument = globalThis.document;
  globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) };
  try {
    const state = shop([row('a'), row('b')]);
    const convs = createConvList({
      root: new El('aside'), h: fakeH, icon: (name) => fakeH('svg', { 'data-icon': name }), store: { get: () => null, set() {} },
      t: () => (key, vars) => (vars?.q ? `${key}:${vars.q}` : key), relative: () => '1h', money: (v) => `$${v}`, phone: { matches: false },
      state: () => state, project: () => state.projects[0], showArchived: () => false, current: () => null, nodeLabel: () => null,
      onOpen() {}, onMove() {}, onFilter() {},
    });
    convs.render();
    const list = els.get('convsList');
    assert.equal(list.children.length > 0 && list.text.includes('chat a'), true, 'first the two rows');
    const search = els.get('convsSearch');
    search.value = 'zzqqxxnomatch';
    search.fire('input');
    assert.equal(list.text.includes('chat a'), false, 'the old rows go away');
    assert.match(list.text, /convs\.noMatch:zzqqxxnomatch/, 'and the empty screen says nothing matches the word');
  } finally {
    globalThis.document = realDocument;
  }
});

test('the project badge on a row is never cut: it keeps its size and only a very long name ends in "…"', async () => {
  const { createConvList } = await import('../server/web/convlist.js');
  const els = new Map();
  const realDocument = globalThis.document;
  globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) };
  try {
    const state = shop([row('a')]);
    createConvList({
      root: new El('aside'), h: fakeH, icon: (name) => fakeH('svg', { 'data-icon': name }), store: { get: () => null, set() {} },
      t: () => (key) => key, relative: () => '1h', money: (v) => `$${v}`, phone: { matches: false },
      state: () => state, project: () => state.projects[0], showArchived: () => false, current: () => null, nodeLabel: () => null,
      onOpen() {}, onMove() {}, onFilter() {},
    }).render();
    const found = [];
    const walk = (el) => { if (/\bcv-proj\b/.test(el.attrs?.class ?? '')) found.push(el); el.children?.forEach(walk); };
    walk(els.get('convsList'));
    assert.ok(found.length, 'the row shows its project');
    const name = found[0].children.find((c) => c.attrs?.class === 'cv-proj-name');
    assert.equal(name?.text, state.projects[0].name, 'the name sits in its own element, so it can end in "…"');
  } finally {
    globalThis.document = realDocument;
  }
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const rule = (sel) => css.match(new RegExp(`\n${sel.replace('.', '\.')} \{([^}]*)\}`))?.[1] ?? '';
  assert.match(rule('.cv-proj'), /flex: none/, 'the badge does not shrink when the place beside it is long');
  assert.match(rule('.cv-proj-name'), /text-overflow: ellipsis/);
});
