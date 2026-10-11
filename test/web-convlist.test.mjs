import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree } from '../server/web/tree.js';
import { conversationsOf, nodeOfConversation, placeOf, listConversations, conversationCounts, dateGroup, projectHue, SECTION_GROUPS, projectChats, STATE_FILTERS, bucketOf, stateOf, orchestratorOf, activityOf } from '../server/web/convlist.js';

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
  // The map's chats are what "Needs you" reads (web-convlist-inbox.test.mjs): none here, so these tests see the groups below it.
  for (const p of state.projects) p.chats = [];
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

test('listConversations gives one section per project: working, then the rest newest first; a project chat sits by its state', () => {
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
  assert.deepEqual(ids('working'), ['proj', 'busy']);
  assert.deepEqual(ids('recent'), ['asks', 'today', 'proj2', 'old'], 'a question nobody waits on any more (not in Needs you) is recent');
  assert.deepEqual(sec.counts, { working: 2, cutoff: 0, total: 6 });
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
  state.projects[1].conversations = [row('n1', { title: 'Sync notes offline', updatedAt: ago(900), status: 'busy' })];
  const out = listConversations(state, { projectId: state.projects[0].id, scope: 'all' });
  assert.deepEqual(out.sections.map((s) => s.project.name), ['notes-app', 'acme-shop'], 'work going on pulls a project up');
  const rows = out.sections.flatMap((s) => SECTION_GROUPS.flatMap((k) => s[k]));
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

test('every row says its state in a word to a screen reader, and finished not seen yet stands out', async () => {
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
  const bySession = Object.fromEntries(rows.map((r) => [r.attrs['data-session'], r]));
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.attrs['data-session'], word(r)])), {
    busy: 'convs.state.busy', asks: 'convs.state.waiting', idle: 'convs.state.idle', gone: 'convs.state.closed', fresh: 'convs.state.unseen',
  });
  assert.match(bySession.fresh.attrs.class, /\bis-unseen\b/, 'finished and not opened yet is highlighted');
  assert.ok(withClass(bySession.fresh, 'cv-unseen-dot').length, 'with its dot');
  assert.doesNotMatch(bySession.idle.attrs.class, /\bis-unseen\b/);
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-row \.cv-state \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\)/, 'the group says it on screen');
});

test('a row puts where it runs and its box on the line under the title, the time on the right', async () => {
  const state = shop([row('a', { partId: 'orders', origin: 'vscode', costUSD: 2 })]);
  const list = await drawList(state);
  const [r] = withClass(list, 'cv-row');
  const [meta] = withClass(r, 'cv-meta');
  assert.match(meta.text, /Orders and cart/);
  assert.equal(withClass(r, 'cv-path')[0].text, 'Orders and cart', 'the box it hangs on; the way down the map is in its tooltip');
  assert.match(r.attrs.title, /What makes it work › Orders and cart/);
  const [origin] = withClass(meta, 'cv-origin-mark');
  assert.match(origin.text, /convs\.origin\.vscode/, 'where it runs is read out');
  assert.match(origin.attrs.title, /convs\.origin\.title:convs\.origin\.vscode/);
  assert.ok(walkAll(origin).some((el) => el.attrs?.['data-icon'] === 'code'), 'the origin has its icon');
  assert.equal(withClass(r, 'cv-when').length, 1, 'the time stands on the right');
});

test('in "All projects" each project is a card with its colour band and name; "This project" needs none', async () => {
  const state = shop([row('a'), row('b', { status: 'busy', live: true })]);
  const list = await drawList(state, { scope: 'all' });
  const cards = withClass(list, 'cv-folder');
  const card = cards.find((c) => c.attrs['data-project'] === state.projects[0].id);
  assert.match(card.attrs.style, /--p-h:\d+/, 'the card carries the project colour');
  assert.equal(withClass(card, 'cv-folder-name')[0].text, state.projects[0].name);
  assert.equal(withClass(card, 'cv-proj').length, 0, 'no row repeats the project inside its own card');
  assert.equal(withClass(await drawList(state), 'cv-folder').length, 0);
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const rule = (sel) => css.match(new RegExp(`\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.cv-folder-name'), /text-overflow: ellipsis/, 'a very long name ends in "…" instead of pushing the counts out');
  assert.match(css, /\.cv-proj \{[^}]*flex: none/, 'the project tag keeps its size');
});

test('the groups are titled sections with a dot, a colour, a count and a title that stays on top while its rows scroll', async () => {
  const state = shop([row('w', { status: 'busy', live: true }), row('c', { cutOff: true }), row('t', { updatedAt: ago(10) })]);
  const list = await drawList(state);
  const heads = withClass(list, 'cv-group-head');
  assert.deepEqual(withClass(list, 'cv-group').map((g) => g.attrs.class.match(/g-(\w+)/)[1]), ['working', 'cutoff', 'recent']);
  for (const head of heads) assert.ok(withClass(head, 'cv-group-dot').length, `${head.text}: has its dot`);
  assert.deepEqual(heads.map((hd) => withClass(hd, 'cv-group-n')[0]?.text ?? null), ['1', '1', null], 'Recent is the quiet rest: no count');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\n\.cv-group-head \{[^}]*position: sticky/, 'the group title stays on top');
  assert.match(css, /\.g-working \{ --g: var\(--active\); --g-ink: var\(--active-ink\); \}/);
  assert.match(css, /\.g-needs \{ --g: var\(--waiting\); --g-ink: var\(--waiting-ink\); \}/);
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

// ---- the state filters and the "Cut off" group (mm43) ----

test('bucketOf: archived beats working, working beats cut off, cut off beats waiting, and the rest is finished', () => {
  assert.deepEqual(STATE_FILTERS, ['working', 'waiting', 'cutoff', 'finished', 'archived']);
  assert.equal(bucketOf(row('a', { archived: true, status: 'busy', cutOff: true, waiting: true })), 'archived');
  assert.equal(bucketOf(row('b', { status: 'busy', cutOff: true, waiting: true })), 'working');
  assert.equal(bucketOf(row('c', { cutOff: true, waiting: true })), 'cutoff');
  assert.equal(bucketOf(row('d', { waiting: true })), 'waiting');
  assert.equal(bucketOf(row('e')), 'finished');
  assert.equal(bucketOf(row('f', { status: 'idle' })), 'finished');
});

const mixed = () => shop([
  row('w', { status: 'busy', updatedAt: ago(1) }),
  row('q', { waiting: true, updatedAt: ago(2) }),
  row('c1', { cutOff: true, updatedAt: ago(3) }),
  row('c2', { cutOff: true, waiting: true, updatedAt: ago(4) }),
  row('f', { updatedAt: ago(5) }),
  row('z', { archived: true, cutOff: true, updatedAt: ago(6) }),
]);

test('listConversations counts each state, archived included, and the counts add up to the rows the box and the search leave', () => {
  const state = mixed();
  const out = listConversations(state, { projectId: state.projects[0].id });
  assert.deepEqual(out.counts, { working: 1, waiting: 1, cutoff: 2, finished: 1, archived: 1 });
  assert.equal(Object.values(out.counts).reduce((a, b) => a + b, 0), 6, 'archived rows count even while the list hides them');
  assert.equal(out.total, 5, 'the list itself still hides archived rows');
  const searched = listConversations(state, { projectId: state.projects[0].id, query: 'chat z' });
  assert.deepEqual(searched.counts, { working: 0, waiting: 0, cutoff: 0, finished: 0, archived: 1 }, 'the search narrows the counts too');
});

test('the sections never hold an archived row; the flat lists and "archived" do, with showArchived', () => {
  const state = mixed();
  const out = listConversations(state, { projectId: state.projects[0].id, showArchived: true });
  const inSections = out.sections.flatMap((sec) => SECTION_GROUPS.flatMap((g) => sec[g])).map((e) => e.row.sessionId).sort();
  assert.deepEqual(inSections, ['c1', 'c2', 'f', 'q', 'w']);
  assert.deepEqual(out.archived.map((e) => e.row.sessionId), ['z']);
  assert.ok([...out.working, ...out.cutoff, ...out.waiting, ...out.recent].some((e) => e.row.sessionId === 'z'), 'the page still finds an archived row by its id');
  assert.deepEqual(listConversations(state, { projectId: state.projects[0].id }).archived, [], 'hidden unless asked');
});

test('a cut-off row sits in its own group after working, and says "Cut off" in its state word', () => {
  const state = mixed();
  const [sec] = listConversations(state, { projectId: state.projects[0].id }).sections;
  assert.equal(SECTION_GROUPS.indexOf('cutoff'), SECTION_GROUPS.indexOf('working') + 1);
  assert.deepEqual(sec.cutoff.map((e) => e.row.sessionId), ['c1', 'c2']);
  assert.deepEqual(sec.counts, { working: 1, cutoff: 2, total: 5 });
  assert.equal(stateOf(row('c', { cutOff: true })), 'cutoff');
  assert.equal(stateOf(row('w', { cutOff: true, status: 'busy' })), 'busy', 'a conversation working again is not cut off');
});

test('the column draws the cut-off group and the state word on its rows', async () => {
  const list = await drawList(mixed());
  assert.deepEqual(withClass(list, 'cv-group').map((g) => g.attrs.class.match(/g-(\w+)/)[1]), ['working', 'cutoff', 'recent']);
  const cut = withClass(list, 'cv-row').find((r) => r.attrs['data-session'] === 'c1');
  assert.equal(withClass(cut, 'cv-state')[0].text.trim(), 'convs.state.cutoff');
});

test('the groups replace the five state chips: each state still has its place and count, archived folded at the foot', async () => {
  const state = mixed();
  const { createConvList } = await import('../server/web/convlist.js');
  const els = new Map();
  const realDocument = globalThis.document;
  globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) };
  try {
    const t = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n) => `${key}:${n}` });
    createConvList({
      root: new El('aside'), h: fakeH, icon: (name) => fakeH('svg', { 'data-icon': name }), store: { get: () => null, set() {} },
      t: () => t, relative: () => '1h', money: (v) => `$${v}`, list: (xs) => xs.join(', '), phone: { matches: false },
      state: () => state, project: () => state.projects[0], current: () => null, nodeLabel: () => null, unseen: () => new Set(),
      onOpen() {}, onMove() {}, onFilter() {},
    }).render();
    const list = els.get('convsList');
    const group = (name) => withClass(list, `g-${name}`)[0];
    assert.deepEqual(withClass(group('working'), 'cv-row').map((r) => r.attrs['data-session']), ['w']);
    assert.deepEqual(withClass(group('cutoff'), 'cv-row').map((r) => r.attrs['data-session']), ['c1', 'c2']);
    assert.deepEqual(withClass(group('recent'), 'cv-row').map((r) => r.attrs['data-session']), ['q', 'f']);
    assert.equal(withClass(els.get('convsArchived'), 'num')[0].text, '1');
    assert.equal(STATE_FILTERS.length, 5, 'every state still has its name');
  } finally {
    globalThis.document = realDocument;
  }
});

// ---- the orchestrator and its activity chats (or03) ----

const ORCH = 'orch-1';
const orchShop = (extra = []) => shop([
  row('proj', { node: { kind: 'project' }, updatedAt: ago(1) }),
  row(ORCH, { node: { kind: 'orchestrator' }, updatedAt: ago(100) }),
  row('k-old', { parentId: ORCH, itemCode: 'or01', node: { kind: 'item', code: 'or01' }, runModel: 'haiku', updatedAt: ago(50), costUSD: 0.5 }),
  row('k-busy', { parentId: ORCH, itemCode: 'or03', node: { kind: 'item', code: 'or03' }, runModel: 'sonnet', status: 'busy', live: true, updatedAt: ago(2), costUSD: 1.25 }),
  row('lone', { parentId: 'nobody-here', updatedAt: ago(4) }),
  ...extra,
]);

test('the orchestrator leads its group, and its activity chats nest under it, working first, never a second time', () => {
  const [sec] = listConversations(orchShop(), { projectId: DEMO.projects[0].id }).sections;
  const ids = (k) => sec[k].map((e) => e.row.sessionId);
  assert.deepEqual(ids('working'), [ORCH], 'one of its chats works: so does it');
  assert.deepEqual(sec.kids.get(ORCH).map((e) => e.row.sessionId), ['k-busy', 'k-old']);
  assert.ok(!ids('recent').some((id) => id.startsWith('k-')));
  assert.ok(ids('recent').includes('lone'), 'a chat whose mother is not here stays in its group: nothing is guessed');
  assert.deepEqual(sec.counts, { working: 1, cutoff: 0, total: 5 }, 'they still count');
});

test('a nested chat shows flat when its orchestrator is filtered out (a search)', () => {
  const [bySearch] = listConversations(orchShop(), { projectId: DEMO.projects[0].id, query: 'k-busy' }).sections;
  assert.deepEqual(bySearch.working.map((e) => e.row.sessionId), ['k-busy']);
  assert.equal(bySearch.kids.size, 0);
});

test('the orchestrator row has its own place, is not a project chat, and the helpers find it and its working chats', () => {
  const state = orchShop();
  const project = state.projects[0];
  const tree = archTree(project);
  assert.deepEqual(placeOf(tree, project.conversations.find((r) => r.sessionId === ORCH)), { path: [], special: 'orchestrator' });
  assert.deepEqual(projectChats(project).map((r) => r.sessionId), ['proj'], 'the root bubble counts the person\'s own project chats');
  assert.equal(orchestratorOf(project).sessionId, ORCH);
  assert.deepEqual(activityOf(project, orchestratorOf(project)).map((r) => r.sessionId).sort(), ['k-busy', 'k-old']);
  assert.equal(orchestratorOf(state.projects[1]), null);
  const archived = clone(project);
  archived.conversations.find((r) => r.sessionId === ORCH).archived = true;
  assert.equal(orchestratorOf(archived), null, 'an archived one is not the project\'s orchestrator');
});

test('the column draws the orchestrator first, its activity chats indented under it, one line each with item and model in reach', async () => {
  const list = await drawList(orchShop());
  const rows = withClass(list, 'cv-row').map((r) => r.attrs['data-session']);
  assert.equal(rows[0], ORCH, 'first of the project');
  const orch = withClass(list, 'cv-item').find((li) => withClass(li, 'cv-row')[0]?.attrs['data-session'] === ORCH);
  assert.match(withClass(withClass(orch, 'cv-row')[0], 'cv-origin-mark')[0].text, /convs\.orchestrator/, 'named as the orchestrator, not as an origin');
  const [kids] = withClass(orch, 'cv-kids');
  assert.ok(kids, 'a nested list inside its own item');
  const kidRows = withClass(kids, 'cv-row');
  assert.deepEqual(kidRows.map((r) => r.attrs['data-session']), ['k-busy', 'k-old']);
  const [busy] = kidRows;
  assert.match(busy.attrs.title, /or03 · Sonnet/, 'item and model in its tooltip');
  assert.match(busy.text, /or03 · Sonnet/, 'and read out');
  assert.match(withClass(busy, 'cv-state')[0].text, /convs\.state\.busy/);
  const busyItem = withClass(kids, 'cv-item')[0];
  assert.match(withClass(busyItem, 'cv-cost')[0].text, /1\.25/, 'its cost on hover');
  assert.equal(withClass(withClass(list, 'cv-kids')[0], 'cv-item').length, 2);
  assert.equal(withClass(kids, 'cv-origin-mark').length, 0, 'an activity chat says its job, not where it runs');
});
