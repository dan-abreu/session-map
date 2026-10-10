import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree } from '../server/web/tree.js';
import { conversationsOf, nodeOfConversation, placeOf, listConversations, conversationCounts, dateGroup, projectHue, SECTION_GROUPS, projectChats } from '../server/web/convlist.js';

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
  for (const kind of ['idea', 'create-arch', 'flow', 'project']) assert.equal(nodeOfConversation(tree, row('f', { partId: 'orders', node: { kind } })), 'p', kind);
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
  assert.deepEqual(placeOf(tree, row('f', { partId: 'orders', node: { kind: 'project' } })), { path: [], special: 'project' }, 'a project chat is about the whole project');
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

test('listConversations gives one section per project: the project chats pinned on top, working, waiting, then by date', () => {
  const now = Date.parse(NOW);
  const state = shop([
    row('proj', { node: { kind: 'project' }, status: 'busy', updatedAt: ago(1) }),
    row('proj2', { node: { kind: 'project' }, updatedAt: ago(60 * 24 * 20) }),
    row('busy', { status: 'busy', updatedAt: ago(2) }),
    row('asks', { waiting: true, updatedAt: ago(3) }),
    row('today', { updatedAt: ago(4) }),
    row('old', { updatedAt: ago(60 * 24 * 20) }),
  ]);
  const [sec] = listConversations(state, { projectId: state.projects[0].id }).sections;
  assert.equal(sec.project.name, 'acme-shop');
  assert.equal(sec.hue, projectHue(state.projects[0]));
  const ids = (k) => sec[k].map((e) => e.row.sessionId);
  assert.deepEqual(ids('pinned'), ['proj', 'proj2'], 'the project chats sit on top whatever they are doing, newest first');
  assert.equal(SECTION_GROUPS[0], 'pinned', 'their group is the first of the card');
  assert.deepEqual(ids('working'), ['busy']);
  assert.deepEqual(ids('waiting'), ['asks']);
  assert.deepEqual(ids(dateGroup(ago(4), now)), ['today']);
  assert.deepEqual(ids('older'), ['old']);
  assert.deepEqual(sec.counts, { working: 2, waiting: 1, total: 6 });
});

test('projectChats: the chats about the whole project that are not archived, newest first, for the root bubble', () => {
  const state = shop([
    row('a', { node: { kind: 'project' }, updatedAt: ago(30) }),
    row('b', { node: { kind: 'project' }, updatedAt: ago(5) }),
    row('c', { node: { kind: 'project' }, archived: true }),
    row('d', { node: { kind: 'idea' } }),
  ]);
  assert.deepEqual(projectChats(state.projects[0]).map((r) => r.sessionId), ['b', 'a']);
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

// ---- a list whose divisions show at a glance (mm33) ----

const walkAll = (el, out = []) => { out.push(el); el.children?.forEach((c) => walkAll(c, out)); return out; };
const withClass = (root, cls) => walkAll(root).filter((el) => new RegExp(`(^| )${cls}( |$)`).test(el.attrs?.class ?? ''));

// Draws the column for a state and returns the list element. t answers "key" or "key:var|var".
async function drawList(state, { scope = 'project', unseen = new Set() } = {}) {
  const { createConvList } = await import('../server/web/convlist.js');
  const els = new Map();
  const realDocument = globalThis.document;
  globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) };
  try {
    const t = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n) => `${key}:${n}` });
    createConvList({
      root: new El('aside'), h: fakeH, icon: (name) => fakeH('svg', { 'data-icon': name }), store: { get: (k) => (k === 'sm.convs.scope' ? scope : null), set() {} },
      t: () => t, relative: () => '1h', money: (v) => `$${v}`, list: (xs) => xs.join(', '), phone: { matches: false },
      state: () => state, project: () => state.projects[0], showArchived: () => false, current: () => null, nodeLabel: () => null, unseen: () => unseen,
      onOpen() {}, onMove() {}, onFilter() {},
    }).render();
    return els.get('convsList');
  } finally {
    globalThis.document = realDocument;
  }
}

test('every row says its state in a word: working, waiting for you, finished, closed, and finished not seen yet stands out', async () => {
  const state = shop([
    row('busy', { status: 'busy', live: true }),
    row('asks', { waiting: true, live: true, status: 'idle' }),
    row('idle', { status: 'idle', live: true }),
    row('gone'),
    row('fresh', { status: 'idle', live: true }),
  ]);
  const list = await drawList(state, { unseen: new Set(['fresh']) });
  const rows = withClass(list, 'cv-row');
  assert.equal(rows.length, 5);
  const word = (r) => withClass(r, 'cv-state')[0]?.text.trim();
  for (const r of rows) assert.ok(word(r), `${r.attrs['data-session']} has no state word`);
  const bySession = Object.fromEntries(rows.map((r) => [r.attrs['data-session'], r]));
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.attrs['data-session'], word(r)])), {
    busy: 'convs.state.busy', asks: 'convs.state.waiting', idle: 'convs.state.idle', gone: 'convs.state.closed', fresh: 'convs.state.unseen',
  });
  assert.match(bySession.fresh.attrs.class, /\bis-unseen\b/, 'finished and not opened yet is highlighted');
  assert.doesNotMatch(bySession.idle.attrs.class, /\bis-unseen\b/);
});

test('a row puts its place on the map on a line of its own, the origin in icon and word, and time and cost on the right', async () => {
  const state = shop([row('a', { partId: 'orders', origin: 'vscode', costUSD: 2 })]);
  const list = await drawList(state);
  const [r] = withClass(list, 'cv-row');
  const place = withClass(r, 'cv-place')[0];
  assert.match(place.text, /What makes it work › Orders and cart/);
  assert.equal(withClass(place, 'cv-origin-badge').length, 0, 'nothing else shares the place line');
  const origin = withClass(r, 'cv-origin-badge')[0];
  assert.match(origin.text, /convs\.origin\.vscode/);
  assert.ok(walkAll(origin).some((el) => el.attrs?.['data-icon']), 'the origin has its icon');
  const side = withClass(r, 'cv-side')[0];
  assert.ok(side, 'a right column');
  assert.equal(withClass(side, 'cv-when').length + withClass(side, 'cv-cost').length, 2, 'time and cost stand on the right');
});

test('each project is a card with its colour band and name, in "This project" too, and its rows do not repeat it', async () => {
  for (const scope of ['project', 'all']) {
    const state = shop([row('a'), row('b', { status: 'busy', live: true })]);
    const list = await drawList(state, { scope });
    const cards = withClass(list, 'cv-folder');
    assert.ok(cards.length >= 1, `${scope}: one card per project`);
    const card = cards.find((c) => c.attrs['data-project'] === state.projects[0].id);
    assert.match(card.attrs.style, /--p-h:\d+/, `${scope}: the card carries the project colour`);
    assert.equal(withClass(card, 'cv-folder-name')[0].text, state.projects[0].name);
    assert.equal(withClass(card, 'cv-proj').length, 0, `${scope}: no row repeats the project inside its own card`);
  }
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const rule = (sel) => css.match(new RegExp(`\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.cv-folder-name'), /text-overflow: ellipsis/, 'a very long name ends in "…" instead of pushing the counts out');
  assert.match(rule('.cv-proj'), /flex: none/, 'the badge of the Now cards keeps its size');
});

test('the groups are titled sections with an icon, a colour, a count and a title that stays on top while its rows scroll', async () => {
  const state = shop([row('w', { status: 'busy', live: true }), row('q', { waiting: true }), row('t', { updatedAt: ago(10) })]);
  const list = await drawList(state);
  const heads = withClass(list, 'cv-group-head');
  assert.equal(heads.length, 3);
  for (const head of heads) {
    assert.ok(walkAll(head).some((el) => el.attrs?.['data-icon']), `${head.text}: has an icon`);
    assert.equal(withClass(head, 'cv-group-n')[0]?.text, '1', `${head.text}: has its count`);
  }
  assert.deepEqual(withClass(list, 'cv-group').map((g) => g.attrs.class.match(/g-(\w+)/)[1]), ['working', 'waiting', 'today']);
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const rule = (sel) => css.match(new RegExp(`\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.cv-group-head'), /position: sticky/, 'the group title stays on top');
});

test('on a computer the conversation sheet takes the whole height of the stage, beside the map tools', () => {
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  const between = html.slice(html.indexOf('id="notice"'), html.indexOf('<aside id="chat"'));
  assert.ok(between.includes('</div>'), 'the box under the map tools closes before the chat sheet: the sheet is not boxed in it');
  const stage = html.slice(html.indexOf('<main class="stage"'), html.indexOf('</main>'));
  assert.ok(stage.includes('<aside id="chat"'), 'it still lives in the stage');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.stage:has\(\.chat:not\(\[hidden\]\)\) \.mm-tools \{[^}]*padding-right: calc\(var\(--chat-w/, 'the map tools make room beside it');
});
