// The conversation list as an inbox (mm49): Needs you · Working · Cut off · Recent · Archived, the one waiting count
// shared with the amber pill, the scope inside the search field, and the phone's Conversations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listConversations, needsEntries, shortWhen, bucketOf, SECTION_GROUPS } from '../server/web/convlist.js';
import { needsYou } from '../server/web/now.js';
import { LANGS } from '../server/web/i18n.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();
const QUIET = { strong: false, weak: false, items: [] };

// One conversation: its row in the list and its chat on the map (what needsYou reads). ask: the waiting signal.
function conv(sessionId, extra = {}, ask = null) {
  const row = {
    sessionId, title: `chat ${sessionId}`, origin: 'terminal', partId: null, itemCode: null, node: null, status: 'closed', waiting: Boolean(ask),
    lastStep: null, costUSD: 1, startedAt: ago(600), updatedAt: ago(60), archived: false, live: false, chattable: true, onMap: true, ...extra,
  };
  const chat = { sessionId, title: row.title, status: row.status, live: row.live, updatedAt: row.updatedAt, archived: row.archived, partId: row.partId, waiting: ask ?? QUIET, liveSteps: [] };
  return { row, chat };
}

function stateOf(shop, notes = []) {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  for (const [p, list] of [[state.projects[0], shop], [state.projects[1], notes]]) {
    p.conversations = list.map((c) => c.row);
    p.chats = list.map((c) => c.chat);
  }
  return state;
}

const SHOP = DEMO.projects[0].id;
const ids = (entries) => entries.map((e) => e.row.sessionId);

const mixed = () => stateOf([
  conv('q1', { status: 'idle', live: true, updatedAt: ago(12) }, { strong: true, weak: false, items: [] }),
  conv('q2', { updatedAt: ago(60) }, { strong: false, weak: false, items: ['Choose the email template'] }),
  conv('stale', { updatedAt: ago(60 * 24 * 3) }, { strong: false, weak: true, items: [] }),
  conv('ask-busy', { status: 'busy', live: true, updatedAt: ago(1) }, { strong: true, weak: false, items: [] }),
  conv('w', { status: 'busy', live: true, updatedAt: ago(2), lastStep: { kind: 'run', target: 'the tests' } }),
  conv('cut', { cutOff: true, updatedAt: ago(30) }),
  conv('done', { updatedAt: ago(90) }),
  conv('old', { archived: true, updatedAt: ago(500) }),
], [conv('n1', { status: 'idle', live: true, updatedAt: ago(5), title: 'Sync notes' }, { strong: false, weak: true, items: [] })]);

// ---- the pure part ----

test('needsEntries turns needsYou into inbox rows from every project: the same number as the amber pill', () => {
  const state = mixed();
  const needs = needsYou(state);
  const out = needsEntries(state, needs, { projectId: SHOP });
  assert.equal(out.length, needs.length, 'one fact, one number');
  assert.deepEqual(ids(out).sort(), ['ask-busy', 'n1', 'q1', 'q2']);
  assert.ok(!ids(out).includes('stale'), 'a question left days ago in a closed conversation is history, as in the pill');
  assert.equal(out.find((e) => e.row.sessionId === 'n1').project.name, 'notes-app', 'another project\'s conversation keeps its project');
  const need = (id) => out.find((e) => e.row.sessionId === id).need;
  assert.deepEqual(need('q2'), { text: 'Choose the email template' }, 'the item it waits on says what is needed');
  assert.deepEqual(need('q1'), { key: 'convs.need.question' });
  assert.deepEqual(need('n1'), { key: 'convs.need.asks' });
  assert.deepEqual(ids(out).slice(0, 2), ['ask-busy', 'q1'], 'a question first, newest first, like the list the pill opens');
});

test('needsEntries follows the search and the box filter, so the group shows what the person narrowed to', () => {
  const state = mixed();
  assert.deepEqual(ids(needsEntries(state, needsYou(state), { projectId: SHOP, query: 'sync' })), ['n1']);
  assert.deepEqual(ids(needsEntries(state, needsYou(state), { projectId: SHOP, query: 'notes-app' })), ['n1'], 'the project name is searched too');
  const boxed = stateOf([conv('a', { partId: 'orders' }, { strong: true, weak: false, items: [] }), conv('b', {}, { strong: true, weak: false, items: [] })]);
  boxed.projects[0].chats.forEach((c) => { c.live = true; });
  assert.deepEqual(ids(needsEntries(boxed, needsYou(boxed), { projectId: SHOP, nodeId: 'pt:orders' })), ['a']);
});

test('the sections are Working, Cut off, Also here and Recent: what needs you is skipped, a stale question is recent', () => {
  assert.deepEqual(SECTION_GROUPS, ['working', 'cutoff', 'visiting', 'recent']);
  const state = mixed();
  const skip = new Set(needsYou(state).map((n) => n.chat.sessionId));
  const out = listConversations(state, { projectId: SHOP, skip, showArchived: true });
  const [sec] = out.sections;
  assert.deepEqual(ids(sec.working), ['w']);
  assert.deepEqual(ids(sec.cutoff), ['cut']);
  assert.deepEqual(ids(sec.recent), ['done', 'stale']);
  assert.deepEqual(ids(out.archived), ['old'], 'archived rows wait apart, for the folded group at the bottom');
  assert.ok(![...sec.working, ...sec.cutoff, ...sec.recent].some((e) => e.row.archived));
  assert.ok(ids(out.waiting).includes('q1'), 'the flat lists the page looks rows up in keep every row');
});

test('bucketOf with the Needs you ids: what the pill counts is waiting, a stale question is finished, archived beats all', () => {
  const need = new Set(['q', 'b']);
  assert.equal(bucketOf({ sessionId: 'q', status: 'idle', waiting: true }, need), 'waiting');
  assert.equal(bucketOf({ sessionId: 'b', status: 'busy', waiting: true }, need), 'waiting', 'asking while it works is still Needs you');
  assert.equal(bucketOf({ sessionId: 's', status: 'closed', waiting: true }, need), 'finished', 'its flag alone does not make it wait');
  assert.equal(bucketOf({ sessionId: 'q', archived: true }, need), 'archived');
});

test('listConversations with a bucket keeps only that state, visitors out; counts stay whole', () => {
  const state = mixed();
  const skip = new Set(needsYou(state).map((n) => n.chat.sessionId));
  const only = (bucket) => listConversations(state, { projectId: SHOP, skip, showArchived: true, bucket });
  assert.deepEqual(ids(only('finished').sections[0].recent), ['done', 'stale']);
  assert.deepEqual(ids(only('archived').sections[0].archived), ['old']);
  assert.deepEqual(only('working').counts, only(null).counts);
  assert.deepEqual(only('working').sections[0].working.map((e) => e.row.sessionId), ['w']);
  assert.equal(only('waiting').sections.length, 0, 'Needs you holds them, not the sections');
});

const ORCH = 'orch-1';
const orch = (kidBusy, kidAsks = false) => stateOf([
  conv(ORCH, { node: { kind: 'orchestrator' }, updatedAt: ago(100) }),
  conv('k-done', { parentId: ORCH, itemCode: 'or01', runModel: 'haiku', updatedAt: ago(50) }),
  conv('k-busy', { parentId: ORCH, itemCode: 'or03', runModel: 'sonnet', status: kidBusy ? 'busy' : 'closed', live: kidBusy, updatedAt: ago(2) }),
  conv('k-asks', { parentId: ORCH, status: 'idle', live: true, updatedAt: ago(3) }, kidAsks ? { strong: true, weak: false, items: [] } : null),
  conv('alone', { updatedAt: ago(4) }),
]);

test('the orchestrator works while one of its chats works: first of Working, its chats under it', () => {
  const state = orch(true);
  const [sec] = listConversations(state, { projectId: SHOP }).sections;
  assert.deepEqual(ids(sec.working), [ORCH], 'its working chat is drawn under it, not a second time');
  assert.deepEqual(ids(sec.kids.get(ORCH)), ['k-busy', 'k-asks', 'k-done'], 'working first, then newest');
  assert.equal(sec.counts.working, 1, 'Working counts the conversations at work');
  const [idle] = listConversations(orch(false), { projectId: SHOP }).sections;
  assert.equal(idle.working.length, 0);
  assert.equal(idle.recent[0].row.sessionId, ORCH, 'resting, it still leads its group');
});

test('a chat of the orchestrator that needs you goes up to Needs you and leaves its place under the orchestrator', () => {
  const state = orch(true, true);
  const skip = new Set(needsYou(state).map((n) => n.chat.sessionId));
  assert.ok(skip.has('k-asks'));
  const [sec] = listConversations(state, { projectId: SHOP, skip }).sections;
  assert.deepEqual(ids(sec.kids.get(ORCH)), ['k-busy', 'k-done']);
});

test('shortWhen: now, minutes, hours, the clock, yesterday, then the day', () => {
  const at = Date.parse('2026-10-09T15:00:00');
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(shortWhen(iso(at - 20_000), at, 'en'), 'now');
  assert.equal(shortWhen(iso(at - 12 * 60_000), at, 'en'), '12 min');
  assert.match(shortWhen(iso(at - 3 * 3_600_000), at, 'pt-BR'), /^3 h$/);
  assert.match(shortWhen(iso(Date.parse('2026-10-09T01:15:00')), at, 'pt-BR'), /^01:15$/);
  assert.equal(shortWhen(iso(Date.parse('2026-10-08T10:00:00')), at, 'pt-BR'), 'ontem');
  assert.equal(shortWhen(iso(Date.parse('2026-10-08T10:00:00')), at, 'en'), 'yesterday');
  assert.equal(shortWhen('', at, 'en'), '');
});

// ---- the column ----

class El {
  constructor(tag = 'div', id = null) {
    Object.assign(this, { tag, id, attrs: {}, children: [], listeners: {}, textContent: '', hidden: false, scrollTop: 0, value: '', parent: null });
    const names = new Set();
    this.classList = { toggle: (c, on) => (on ?? !names.has(c) ? names.add(c) : names.delete(c)), contains: (c) => names.has(c), add: (c) => names.add(c), remove: (c) => names.delete(c) };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(c) { const n = typeof c === 'string' ? Object.assign(new El('#text'), { textContent: c }) : c; n.parent = this; this.children.push(n); }
  replaceChildren(...cs) { this.children = []; for (const c of cs) this.append(c); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ key: '', target: this, stopPropagation() {}, preventDefault() {}, ...ev }); }
  focus() {}
  closest() { return null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  contains() { return false; }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'hidden') el.hidden = true;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}
const walk = (el, out = []) => { out.push(el); el.children?.forEach((c) => walk(c, out)); return out; };
const withClass = (root, cls) => walk(root).filter((el) => new RegExp(`(^| )${cls}( |$)`).test(el.attrs?.class ?? ''));
const groups = (list) => withClass(list, 'cv-group').map((g) => g.attrs.class.match(/g-(\w+)/)[1]);
const rowIds = (root) => withClass(root, 'cv-row').map((r) => r.attrs['data-session']);

async function draw(state, { scope = 'project', onContinue = () => {}, saved = [] } = {}) {
  const { createConvList } = await import('../server/web/convlist.js');
  const els = new Map();
  const realDocument = globalThis.document;
  globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) };
  const t = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n) => `${key}:${n}` });
  const convs = createConvList({
    root: new El('aside'), h, icon: (name) => h('svg', { 'data-icon': name }), store: { get: (k) => (k === 'sm.convs.scope' ? scope : null), set: (k, v) => saved.push([k, v]) },
    t: () => t, lang: () => 'en', relative: () => '1h', money: (v) => `$${v}`, list: (xs) => xs.join(', '), phone: { matches: false },
    state: () => state, project: () => state.projects[0], showArchived: () => false, current: () => null, nodeLabel: () => null, unseen: () => new Set(),
    onOpen() {}, onMove() {}, onFilter() {}, onContinue,
  });
  const run = (fn) => { globalThis.document = { activeElement: null, getElementById: (id) => els.get(id) ?? els.set(id, new El('div', id)).get(id) }; try { return fn(); } finally { globalThis.document = realDocument; } };
  try { convs.render(); } finally { globalThis.document = realDocument; }
  return { list: els.get('convsList'), el: (id) => els.get(id), run, convs };
}

test('the inbox opens with Needs you, counted by the same needsYou as the pill, each row saying in one line what is needed', async () => {
  const state = mixed();
  const { list } = await draw(state);
  assert.deepEqual(groups(list), ['needs', 'working', 'cutoff', 'recent']);
  const [needs] = withClass(list, 'g-needs');
  assert.equal(withClass(needs, 'cv-group-n')[0].text, String(needsYou(state).length));
  assert.deepEqual(rowIds(needs), ['ask-busy', 'q1', 'q2', 'n1']);
  const lines = withClass(needs, 'cv-need').map((el) => el.text);
  assert.deepEqual(lines, ['convs.need.question', 'convs.need.question', 'Choose the email template', 'convs.need.asks']);
  const n1 = withClass(needs, 'cv-item').find((li) => rowIds(li)[0] === 'n1');
  assert.match(withClass(n1, 'cv-proj')[0]?.text ?? '', /notes-app/, 'a row of another project names it');
  const q1 = withClass(needs, 'cv-item').find((li) => rowIds(li)[0] === 'q1');
  assert.equal(withClass(q1, 'cv-proj').length, 0, 'the open project needs no name');
});

test('no Needs you group when nobody waits, and no Cut off group when nothing was cut', async () => {
  const { list } = await draw(stateOf([conv('a'), conv('b', { status: 'busy', live: true })]));
  assert.deepEqual(groups(list), ['working', 'recent']);
});

test('Working shows each one\'s current step; the orchestrator first with its chats indented under it', async () => {
  const { list } = await draw(orch(true));
  const [working] = withClass(list, 'g-working');
  assert.equal(rowIds(working)[0], ORCH);
  const [kids] = withClass(working, 'cv-kids');
  assert.deepEqual(rowIds(kids), ['k-busy', 'k-asks', 'k-done']);
  assert.equal(withClass(working, 'cv-group-n')[0].text, '1');
  const { list: other } = await draw(mixed());
  const [step] = withClass(withClass(other, 'g-working')[0], 'cv-step');
  assert.match(step.text, /live\.step\.run:the tests/);
});

test('Cut off rows carry Continue, which hands the row to the same continue as the Cut off panel', async () => {
  const seen = [];
  const { list } = await draw(mixed(), { onContinue: (e) => seen.push(e.row.sessionId) });
  const [cut] = withClass(list, 'g-cutoff');
  const [go] = withClass(cut, 'cv-continue');
  assert.match(go.text, /cut\.continue/);
  go.fire('click');
  assert.deepEqual(seen, ['cut']);
});

// A tree that answers closest, contains, querySelector and focus for real, for the focus kept across a redraw.
function realTree(run) {
  const saved = ['closest', 'contains', 'querySelector', 'focus'].map((k) => [k, El.prototype[k]]);
  const matches = (el, sel) => {
    const cls = /^\.([\w-]+)$/.exec(sel);
    if (cls) return new RegExp(`(^| )${cls[1]}( |$)`).test(el.attrs?.class ?? '');
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    return Boolean(attr) && el.attrs?.[attr[1]] != null && (attr[2] == null || el.attrs[attr[1]] === attr[2]);
  };
  Object.assign(El.prototype, {
    closest(sel) { for (let x = this; x; x = x.parent) if (matches(x, sel)) return x; return null; },
    contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; },
    querySelector(sel) { return walk(this).slice(1).find((x) => matches(x, sel)) ?? null; },
    focus() { globalThis.document.activeElement = this; },
  });
  Object.defineProperty(El.prototype, 'dataset', {
    configurable: true,
    get() { return Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v])); },
  });
  const css = globalThis.CSS;
  globalThis.CSS = { escape: (v) => v };
  try { return run(); } finally {
    for (const [k, fn] of saved) El.prototype[k] = fn;
    delete El.prototype.dataset;
    globalThis.CSS = css;
  }
}

test('Continue keeps the keyboard focus when the list draws again (each poll)', async () => {
  const { list, el, convs } = await draw(mixed());
  const real = globalThis.document;
  try {
    realTree(() => {
      const [go] = withClass(withClass(list, 'g-cutoff')[0], 'cv-continue');
      globalThis.document = { activeElement: go, getElementById: el };
      convs.render();
      const now = globalThis.document.activeElement;
      assert.notEqual(now, go, 'the list was drawn anew');
      assert.match(now?.attrs?.class ?? '', /cv-continue/, 'the new Continue holds the focus');
      assert.equal(withClass(now.closest('.cv-item'), 'cv-row')[0]?.attrs['data-session'], 'cut', 'of the same row');
    });
  } finally { globalThis.document = real; }
});

test('Archived · N waits folded at the bottom; a click opens its rows and a second click folds them', async () => {
  const { list, el, run } = await draw(mixed());
  const toggle = el('convsArchived');
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.attrs['aria-expanded'], 'false');
  assert.match(toggle.text, /convs\.group\.archived/);
  assert.equal(withClass(toggle, 'num')[0].text, '1');
  assert.ok(!rowIds(list).includes('old'), 'folded: no archived row in the list');
  run(() => toggle.fire('click'));
  assert.equal(toggle.attrs['aria-expanded'], 'true');
  assert.deepEqual(rowIds(withClass(list, 'g-archived')[0]), ['old']);
  run(() => toggle.fire('click'));
  assert.ok(!rowIds(list).includes('old'));
  const { el: none } = await draw(stateOf([conv('a')]));
  assert.equal(none('convsArchived').hidden, true, 'nothing archived: no footer');
});

test('cost and ⋯ wait in a box shown on hover or focus, in place of the time', async () => {
  const { list } = await draw(stateOf([conv('a', { costUSD: 3.1 })]));
  const [item] = withClass(list, 'cv-item');
  const [hov] = withClass(item, 'cv-hov');
  assert.match(withClass(hov, 'cv-cost')[0].text, /3\.1/);
  assert.ok(withClass(hov, 'cv-move').length, 'the ⋯ (move or rename) is in it');
  assert.ok(withClass(item, 'cv-when').length, 'the time shows until then');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-line:hover \.cv-hov, \.cv-line:has\(:focus-visible\) \.cv-hov \{[^}]*opacity: 1/, 'a keyboard focus shows them; a tap that opens the list does not');
  assert.match(css, /\.cv-line:hover \.cv-when, \.cv-line:has\(:focus-visible\) \.cv-when \{[^}]*visibility: hidden/);
  assert.match(css, /@media \(hover: none\) \{[^}]*\.cv-hov \{[^}]*opacity: 1/, 'a touch screen shows them always');
});

test('"All projects" keeps one card per project under Needs you, which stays one group for every project', async () => {
  const state = mixed();
  const notes = state.projects[1];
  notes.conversations.push(conv('n2', { status: 'busy', live: true, updatedAt: ago(30) }).row);
  const { list } = await draw(state, { scope: 'all' });
  const top = list.children.map((c) => c.attrs.class);
  assert.match(top[0], /\bg-needs\b/);
  const cards = withClass(list, 'cv-folder');
  assert.deepEqual(cards.map((c) => c.attrs['data-project']), [state.projects[0].id, state.projects[1].id]);
  assert.deepEqual(rowIds(cards[1]), ['n2'], 'n1 needs you: it shows once, at the top');
  const { list: one } = await draw(state);
  assert.equal(withClass(one, 'cv-folder').length, 0, '"This project" needs no card: the bar names the project');
});

// ---- the project switch and the state filters (mm49, brought back) ----

// More rows in the second project, so "this project" and "all projects" count differently.
const twoProjects = () => {
  const state = mixed();
  const more = [conv('n2', { status: 'busy', live: true, updatedAt: ago(30) }), conv('n3', { updatedAt: ago(80) }), conv('n4', { archived: true, updatedAt: ago(700) })];
  state.projects[1].conversations.push(...more.map((c) => c.row));
  state.projects[1].chats.push(...more.map((c) => c.chat));
  return state;
};
const tabs = (el) => el('convsScopeSeg').children;
const chips = (el) => el('convsStates').children;
const chipCounts = (el) => Object.fromEntries(chips(el).map((c) => [c.attrs['data-state'], Number(withClass(c, 'cv-sc-n')[0].text)]));
const pressed = (el) => chips(el).filter((c) => c.attrs['aria-pressed'] === 'true').map((c) => c.attrs['data-state']);
const chip = (el, name) => chips(el).find((c) => c.attrs['data-state'] === name);

test('the switch "This project | All projects" sits right under the search, not inside it, and the menu is gone', () => {
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  const tools = html.slice(html.indexOf('<div class="cv-tools">'), html.indexOf('<div class="cv-filter"'));
  const search = tools.slice(tools.indexOf('<div class="cv-search">'), tools.indexOf('id="convsScopeSeg"'));
  assert.match(search, /id="convsSearch"/);
  assert.doesNotMatch(search, /convsScopeBtn|menuitemradio/, 'nothing of the scope is left inside the field');
  assert.match(tools, /<div class="cv-seg" id="convsScopeSeg" role="tablist"/);
  assert.match(tools, /id="convsStates" role="group"/, 'the state chips follow the switch');
  assert.ok(tools.indexOf('id="convsScopeSeg"') < tools.indexOf('id="convsStates"'), 'switch first, chips under it');
  assert.doesNotMatch(html, /id="convsBtn"/, 'the phone reaches the inbox from its bottom bar');
});

test('the switch is two visible tabs; the open scope is the selected one and a click changes the scope and remembers it', async () => {
  const saved = [];
  const state = twoProjects();
  const { el, list, run } = await draw(state, { saved });
  const [here, all] = tabs(el);
  assert.equal(tabs(el).length, 2);
  assert.equal(here.attrs.role, 'tab');
  assert.equal(here.text, 'convs.scope.project');
  assert.equal(all.text, 'convs.scope.all');
  assert.deepEqual([here.attrs['aria-selected'], all.attrs['aria-selected']], ['true', 'false']);
  assert.deepEqual([here.attrs.tabindex, all.attrs.tabindex], ['0', '-1'], 'one stop in the tab order, arrows inside');
  assert.equal(withClass(list, 'cv-folder').length, 0);
  run(() => all.fire('click'));
  assert.deepEqual([here.attrs['aria-selected'], all.attrs['aria-selected']], ['false', 'true']);
  assert.deepEqual([here.attrs.tabindex, all.attrs.tabindex], ['-1', '0']);
  assert.deepEqual(saved.at(-1), ['sm.convs.scope', 'all']);
  assert.equal(withClass(list, 'cv-folder').length, 2, 'every project is a card again');
  run(() => here.fire('click'));
  assert.equal(here.attrs['aria-selected'], 'true');
  assert.equal(withClass(list, 'cv-folder').length, 0);
});

test('the switch opens on the saved scope and answers the arrow keys, Home and End', async () => {
  const { el, list, run } = await draw(twoProjects(), { scope: 'all' });
  const [here, all] = tabs(el);
  assert.equal(all.attrs['aria-selected'], 'true');
  assert.ok(withClass(list, 'cv-folder').length);
  run(() => all.fire('keydown', { key: 'ArrowLeft' }));
  assert.equal(here.attrs['aria-selected'], 'true', 'the arrow selects the neighbour, as a tablist does');
  run(() => here.fire('keydown', { key: 'ArrowRight' }));
  assert.equal(all.attrs['aria-selected'], 'true');
  run(() => all.fire('keydown', { key: 'Home' }));
  assert.equal(here.attrs['aria-selected'], 'true');
  run(() => here.fire('keydown', { key: 'End' }));
  assert.equal(all.attrs['aria-selected'], 'true');
  assert.equal(el('convsScopeSeg').attrs['aria-label'], 'convs.scope', 'named for a screen reader');
});

test('five state chips with their counts, and the counts follow the scope', async () => {
  const { el, run } = await draw(twoProjects());
  assert.deepEqual(chips(el).map((c) => c.attrs['data-state']), ['working', 'waiting', 'cutoff', 'finished', 'archived']);
  assert.deepEqual(chipCounts(el), { working: 1, waiting: 4, cutoff: 1, finished: 2, archived: 1 }, 'this project');
  assert.match(chip(el, 'waiting').text, /convs\.states\.waiting/);
  run(() => tabs(el)[1].fire('click'));
  assert.deepEqual(chipCounts(el), { working: 2, waiting: 4, cutoff: 1, finished: 3, archived: 2 }, 'all projects');
});

test('"Waiting for you" is the one number: the amber pill, the inbox group and the chip', async () => {
  for (const scope of ['project', 'all']) {
    const state = twoProjects();
    const pill = needsYou(state).length;
    const { el, list } = await draw(state, { scope });
    assert.equal(chipCounts(el).waiting, pill, scope);
    assert.equal(withClass(withClass(list, 'g-needs')[0], 'cv-group-n')[0].text, String(pill), scope);
  }
  const quiet = await draw(stateOf([conv('a'), conv('s', { updatedAt: ago(60 * 24 * 3) }, { strong: false, weak: true, items: [] })]));
  assert.equal(chipCounts(quiet.el).waiting, 0, 'a stale question is history: not counted, as in the pill');
  assert.equal(chipCounts(quiet.el).finished, 2, 'and it is a finished one');
});

test('a chip filters the inbox to its conversations; a second click clears it', async () => {
  const { el, list, run } = await draw(twoProjects());
  const before = groups(list);
  assert.deepEqual(before, ['needs', 'working', 'cutoff', 'recent']);
  assert.deepEqual(pressed(el), []);
  run(() => chip(el, 'working').fire('click'));
  assert.deepEqual(pressed(el), ['working']);
  assert.deepEqual(groups(list), ['working']);
  assert.deepEqual(rowIds(list), ['w']);
  run(() => chip(el, 'cutoff').fire('click'));
  assert.deepEqual([groups(list), rowIds(list)], [['cutoff'], ['cut']]);
  run(() => chip(el, 'finished').fire('click'));
  assert.deepEqual(rowIds(list).sort(), ['done', 'stale']);
  assert.ok(!withClass(list, 'g-needs').length);
  run(() => chip(el, 'finished').fire('click'));
  assert.deepEqual(pressed(el), [], 'the same chip again lets it go');
  assert.deepEqual(groups(list), before);
  assert.deepEqual(chipCounts(el), { working: 1, waiting: 4, cutoff: 1, finished: 2, archived: 1 }, 'the counts do not move with the filter');
});

test('the waiting chip shows exactly what Needs you holds, the archived chip the archived ones', async () => {
  const { el, list, run } = await draw(twoProjects());
  run(() => chip(el, 'waiting').fire('click'));
  assert.deepEqual(groups(list), ['needs']);
  assert.deepEqual(rowIds(list), ['ask-busy', 'q1', 'q2', 'n1']);
  run(() => chip(el, 'archived').fire('click'));
  assert.deepEqual(pressed(el), ['archived']);
  assert.deepEqual(groups(list), ['archived']);
  assert.deepEqual(rowIds(list), ['old']);
  assert.equal(withClass(list, 'cv-group-n')[0].text, '1');
});

test('in "All projects" a filter keeps the project cards, each with only its matching conversations', async () => {
  const twoIds = [DEMO.projects[0].id, DEMO.projects[1].id];
  const { el, list, run } = await draw(twoProjects(), { scope: 'all' });
  run(() => chip(el, 'finished').fire('click'));
  const card = (id) => withClass(list, 'cv-folder').find((c) => c.attrs['data-project'] === id);
  const [shop, notes] = twoIds;
  assert.equal(withClass(list, 'cv-folder').length, 2);
  assert.deepEqual(rowIds(card(shop)).sort(), ['done', 'stale']);
  assert.deepEqual(rowIds(card(notes)), ['n3'], 'a card closed by default opens while a filter is on');
  run(() => chip(el, 'archived').fire('click'));
  assert.deepEqual([rowIds(card(shop)), rowIds(card(notes))], [['old'], ['n4']]);
  assert.ok(withClass(card(shop), 'g-archived').length, 'under an Archived group');
  run(() => chip(el, 'cutoff').fire('click'));
  assert.deepEqual(withClass(list, 'cv-folder').map((c) => c.attrs['data-project']), [shop], 'a project with none of that state has no card');
});

test('a filter with nothing in it says so, and its chip shows zero', async () => {
  const { el, list, run } = await draw(stateOf([conv('a'), conv('b')]));
  assert.equal(chipCounts(el).working, 0);
  run(() => chip(el, 'working').fire('click'));
  assert.equal(rowIds(list).length, 0);
  assert.match(list.text, /convs\.stateEmpty/);
  assert.match(chip(el, 'working').attrs.class, /is-zero/);
});

test('the search narrows the chips\' counts like the list', async () => {
  const { el, run } = await draw(twoProjects());
  const search = el('convsSearch');
  search.value = 'chat done';
  run(() => search.fire('input'));
  assert.deepEqual(chipCounts(el), { working: 0, waiting: 0, cutoff: 0, finished: 1, archived: 0 });
});

test('the head is "Conversations" and Novo; the foot holds Archived and, on a phone, the way to Board and History', () => {
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  const head = html.slice(html.indexOf('<div class="cv-head">'), html.indexOf('<div class="cv-tools">'));
  assert.match(head, /<h2 id="convsTitle" data-help="convs"><span data-i18n="convs.title"><\/span><\/h2>/);
  assert.match(head, /id="newBtn"/);
  const foot = html.slice(html.indexOf('<div class="cv-foot">'), html.indexOf('</aside>', html.indexOf('<div class="cv-foot">')));
  assert.match(foot, /id="convsArchived"/);
  assert.match(foot, /id="convsBoardLink"[^>]*data-i18n="convs.boardLink"|id="convsBoardLink"/);
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-board \{ display: none; \}/, 'a computer reaches them from the bar');
});

test('on a phone the bottom bar\'s Conversations opens the inbox over the map, and the bar marks it while open', () => {
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /onPick: pickArea/);
  const fn = app.slice(app.indexOf('function pickArea'), app.indexOf('\n}\n', app.indexOf('function pickArea')));
  assert.match(fn, /area === 'convs' && PHONE\.matches/);
  assert.match(fn, /convs\.openDrawer\(\)/);
  assert.match(app, /onDrawer: \(on\) => navbar\.setCurrent\(on \? 'convs' : view\)/);
  assert.match(app, /onContinue: \(e\) => cutPanel\.continue\(e\)/, 'Continue in the inbox is the Cut off panel\'s own');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('.convs, .convs.is-collapsed {', css.indexOf('@media (max-width: 719px)')));
  assert.match(phone, /grid-row: 3/, 'it fills the space between the two bars');
  const tour = readFileSync(new URL('../server/web/tour.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tour, /convsBtn/);
});

test('every new word of the inbox is in both languages', () => {
  const keys = ['convs.group.needs', 'convs.group.archived', 'convs.need.question', 'convs.need.asks', 'convs.states', 'convs.states.cutoff', 'convs.stateEmpty', 'convs.stateEmptyText', 'convs.scope.project', 'convs.scope.all', 'convs.boardLink', 'convs.continueAria'];
  for (const lang of ['en', 'pt-BR']) for (const k of keys) assert.ok(LANGS[lang][k], `${lang}: ${k}`);
  assert.equal(LANGS['pt-BR']['convs.group.needs'], 'Precisa de você');
  assert.equal(LANGS['pt-BR']['convs.group.working'], 'Trabalhando');
  assert.equal(LANGS['pt-BR']['convs.group.cutoff'], 'Cortadas');
  assert.equal(LANGS['pt-BR']['convs.group.archived'], 'Arquivadas');
  assert.deepEqual(['working', 'waiting', 'cutoff', 'finished', 'archived'].map((k) => LANGS['pt-BR'][`convs.states.${k}`]), ['Trabalhando', 'Esperando você', 'Cortadas', 'Terminadas', 'Arquivadas']);
  assert.deepEqual([LANGS['pt-BR']['convs.scope.project'], LANGS['pt-BR']['convs.scope.all']], ['Este projeto', 'Todos os projetos']);
});
