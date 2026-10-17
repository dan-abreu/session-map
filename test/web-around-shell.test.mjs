// Around the map (mm47, mm48): one row of top bar with one amber count and the person's menu, one quiet row over the map
// with the "Vista" menu, the "Novo" menu where the inbox starts, and no Now strip. The count of what needs the person is
// one function, so the pill, the waiting list it opens and (next) the inbox read the same number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsYou, nowJobs } from '../server/web/now.js';
import { waitingSections, waitingEntries } from '../server/web/views.js';
import { LANGS, translator } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const app = readFileSync(new URL('app.js', WEB), 'utf8');
const css = readFileSync(new URL('style.css', WEB), 'utf8');
const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const ago = (min) => new Date(NOW_MS - min * 60_000).toISOString();
const chat = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, partId: null, itemCode: null, status: 'idle', archived: false, live: true, liveSteps: [], workflows: [],
  model: null, turnStartedAt: null, updatedAt: ago(5), waiting: { strong: false, weak: false, items: [] }, ...extra,
});
const asks = { strong: true, weak: false, items: [] };
const ends = { strong: false, weak: true, items: [] };

function two(shopChats, notesChats) {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  state.projects[0].chats = shopChats;
  state.projects[0].conversations = [];
  state.projects[1].chats = notesChats;
  state.projects[1].conversations = [];
  return state;
}

// The part of the page between two ids: an element's own markup up to the next sibling landmark.
const between = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + 1);
  assert.ok(a >= 0, `${from} is on the page`);
  assert.ok(b > a, `${to} comes after ${from}`);
  return html.slice(a, b);
};

// ---- one fact, one number --------------------------------------------------------------------------------------------

test('needsYou lists the conversations that need the person, in every project, and leaves out what is not a job', () => {
  const state = two(
    [
      chat('ask', { waiting: asks, updatedAt: ago(3) }),
      chat('busy-ends', { status: 'busy', waiting: ends }),
      chat('stale', { live: false, status: 'closed', waiting: ends, updatedAt: ago(60 * 30) }),
      chat('gone', { archived: true, waiting: asks }),
      chat('quiet'),
    ],
    [chat('notes-ends', { waiting: ends, updatedAt: ago(9) })],
  );
  const out = needsYou(state);
  assert.deepEqual(out.map((e) => e.chat.sessionId).sort(), ['ask', 'notes-ends']);
  for (const e of out) assert.ok(state.projects.includes(e.project), 'each entry carries its project');
});

test('the pill and the jobs of the page count the same: needsYou is the waiting kind of nowJobs', () => {
  const state = two(
    [chat('a', { waiting: asks }), chat('b', { status: 'busy', waiting: asks }), chat('c', { status: 'busy' }), chat('d')],
    [chat('e', { waiting: { strong: false, weak: false, items: ['Pick a name'] } })],
  );
  const jobs = nowJobs(state, { unseen: new Set(['d']), nowMs: NOW_MS });
  assert.equal(needsYou(state, { nowMs: NOW_MS }).length, jobs.counts.waiting);
  assert.deepEqual(needsYou(state, { nowMs: NOW_MS }).map((e) => e.chat.sessionId).sort(), jobs.cards.filter((c) => c.kind === 'waiting').map((c) => c.chat.sessionId).sort());
  assert.equal(needsYou(state).length, 3, 'without a clock it reads the state\'s own time');
});

test('the waiting list the pill opens starts with exactly the pill\'s conversations, whatever project is open', () => {
  const state = two([chat('a', { waiting: asks }), chat('old', { live: false, waiting: ends, updatedAt: ago(60 * 40) })], [chat('b', { waiting: ends })]);
  state.projects[0].decisions = [{ kind: 'item', partId: 'orders', code: 'or01', text: 'Choose the payment provider' }];
  const needs = needsYou(state);
  for (const projectId of [state.projects[0].id, state.projects[1].id, null]) {
    const { chats } = waitingSections(state, needs, { projectId });
    assert.deepEqual(chats.map((e) => e.chat.sessionId), needs.map((e) => e.chat.sessionId), `${projectId}: the same list as the pill`);
  }
  assert.equal(waitingSections(state, needs, { projectId: state.projects[0].id }).decisions.length, 1, 'decisions of the open project');
  assert.equal(waitingSections(state, needs, { projectId: state.projects[1].id }).decisions.length, 0);
  assert.equal(waitingSections(state, needs, { projectId: null }).decisions.length, 1, 'every project when the scope is All');
  assert.ok(waitingSections(state, needs, {}).decisions.every((e) => e.decision), 'the second part holds decisions only');
});

test('Home and the project box count a conversation as waiting by the pill\'s own rule, so the three never disagree', () => {
  const state = two([
    chat('asks', { waiting: asks }),
    // Closed two days ago with a loose "ended on a question": history, not a job.
    chat('stale', { live: false, waiting: ends, updatedAt: ago(60 * 48) }),
    // At work and only the loose signal: it is working, not waiting.
    chat('busy', { status: 'busy', waiting: ends }),
    chat('gone', { archived: true, waiting: asks }),
  ], [chat('b', { waiting: ends })]);
  state.projects[0].decisions = [{ kind: 'item', partId: 'orders', code: 'or01', text: 'Choose the payment provider' }];
  const needs = needsYou(state);
  for (const p of state.projects) {
    const entries = waitingEntries(state, p.id);
    assert.deepEqual(entries.filter((e) => e.chat).map((e) => e.chat.sessionId).sort(),
      needs.filter((n) => n.project.id === p.id).map((n) => n.chat.sessionId).sort(), p.id);
  }
  assert.equal(waitingEntries(state, state.projects[0].id).filter((e) => e.decision).length, 1, 'the decisions of the map stay');
  assert.equal(waitingEntries(state).filter((e) => e.chat).length, needs.length, 'every project');
});

test('a strong question comes before a conversation that only ended, in the pill\'s list', () => {
  const state = two([chat('ends', { waiting: ends, updatedAt: ago(1) }), chat('asks', { waiting: asks, updatedAt: ago(20) })], []);
  assert.deepEqual(waitingSections(state, needsYou(state), {}).chats.map((e) => e.chat.sessionId), ['asks', 'ends']);
});

test('app.js counts what needs the person through needsYou, once, for the pill and the list', () => {
  assert.match(app, /needsYou\(state\)/);
  assert.match(app, /waitingSections\(/);
  assert.doesNotMatch(app, /waiting\.buttonHere/, 'no second, scoped count on a second button');
});

// ---- the top bar (mm47) ----------------------------------------------------------------------------------------------

test('the Now strip is gone from the page, and the code that counts the jobs stays', () => {
  assert.doesNotMatch(html, /id="now"|id="nowLine"|id="nowCards"/);
  assert.doesNotMatch(app, /createNowStrip/);
  assert.match(app, /nowJobs\(/, 'the jobs still feed the picker\'s marks and the tab title');
});

test('the bar is one row: mark, project, the areas (with the ⋯), then the amber pill alone', () => {
  const bar = between('<header class="bar">', '</header>');
  const order = ['id="projectPicker"', 'id="navbar"', 'id="waitingBtn"'].map((s) => bar.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'all three are in the bar');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  assert.doesNotMatch(bar, /id="helpBtn"|id="personBtn"|id="aiHelpersBar"/, 'help, the person and Other AIs left the bar for the ⋯');
});

test('the project button names the project only: its amber count is the pill\'s, its marks wait in the list', async () => {
  const { createProjectPicker } = await import('../server/web/picker.js');
  const el = (tag) => ({
    tag, attrs: {}, kids: [], hidden: tag === 'list', style: { setProperty() {} }, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, contains: () => false, querySelectorAll: () => [],
    replaceChildren(...kids) { this.kids = kids; },
  });
  const h = (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat(Infinity) });
  const real = globalThis.document;
  globalThis.document = { activeElement: null, addEventListener() {} };
  try {
    const parts = { root: el('root'), button: el('button'), list: el('list'), name: el('name') };
    const t = Object.assign((k) => k, { count: (k, n) => `${k}:${n}` });
    const picker = createProjectPicker({ ...parts, h, t: () => t, icon: () => null, onPick() {} });
    picker.update([{ id: 'a', name: 'acme-shop', hue: 160 }, { id: 'b', name: 'notes', hue: 40 }], 'a', new Map([['a', { working: 3, waiting: 3 }], ['b', { waiting: 1 }]]));
    assert.equal(parts.name.textContent, 'acme-shop');
    const marksIn = (node) => (node?.kids ?? []).flatMap((k) => (typeof k === 'object' && k ? [k, ...marksIn(k)] : [])).filter((k) => /(^| )pp-mark( |$)/.test(k.attrs?.class ?? ''));
    assert.deepEqual(marksIn(parts.button), [], 'no second amber number beside the pill');
    assert.equal(marksIn(parts.list).length, 3, 'each project keeps its marks in the list');
  } finally { globalThis.document = real; }
  assert.doesNotMatch(between('id="projectPicker"', 'id="navbar"'), /id="projectMarks"/);
});

test('the folders that are not projects the owner keeps wait behind one row, with their marks, and open to say why (id161)', async () => {
  const { createProjectPicker } = await import('../server/web/picker.js');
  const el = (tag) => ({
    tag, attrs: {}, kids: [], hidden: tag === 'list', style: { setProperty() {} }, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, contains: () => false, querySelectorAll: () => [],
    replaceChildren(...kids) { this.kids = kids; },
  });
  const h = (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat(Infinity) });
  const real = globalThis.document;
  globalThis.document = { activeElement: null, addEventListener() {} };
  try {
    const parts = { root: el('root'), button: el('button'), list: el('list'), name: el('name') };
    const t = Object.assign((k) => k, { count: (k, n) => `${k}:${n}` });
    const picker = createProjectPicker({ ...parts, h, t: () => t, icon: () => null, onPick() {} });
    const projects = [
      { id: 'a', name: 'acme-shop', hue: 160 }, { id: 'x', name: 'agent-x', hue: 10, scratch: 'gone' },
      { id: 'w', name: 'work', hue: 20, scratch: 'temp' }, { id: 'n', name: 'notes', hue: 40 },
    ];
    const names = () => parts.list.kids.map((k) => k.kids.find((c) => /pp-option-name/.test(c.attrs?.class ?? '')).kids[0]);
    const textOf = (node) => (node.kids ?? []).map((k) => (typeof k === 'object' && k ? textOf(k) : String(k))).join('');
    picker.update(projects, 'a', new Map([['w', { waiting: 2 }], ['x', { working: true }]]));
    assert.deepEqual(names(), ['acme-shop', 'notes', 'project.others:2'], 'two projects and one row for the two folders');
    const row = parts.list.kids[2];
    assert.equal(row.attrs['data-id'], ':others');
    const marks = row.kids.at(-1).kids;
    assert.equal(marks.length, 2, 'what works and what waits in them is never out of sight');
    assert.equal(textOf(row.kids.at(-1)).includes('2'), true, 'the waiting counted once, added up');
    row.attrs.onclick();
    assert.deepEqual(names(), ['acme-shop', 'notes', 'project.othersHide', 'agent-x', 'work'], 'opened: each folder, with its reason');
    assert.match(textOf(parts.list.kids[3]), /project\.scratch\.gone/);
    assert.match(textOf(parts.list.kids[4]), /project\.scratch\.temp/);
    // The open project stays in the main list whatever it is.
    picker.update(projects, 'x', new Map());
    assert.deepEqual(names().slice(0, 3), ['acme-shop', 'agent-x', 'notes']);
    // No such folder: no row.
    picker.update(projects.filter((p) => !p.scratch), 'a', new Map());
    assert.deepEqual(names(), ['acme-shop', 'notes']);
  } finally { globalThis.document = real; }
  for (const lang of ['en', 'pt-BR']) {
    const t = translator(lang);
    for (const key of ['project.othersHide', 'project.scratch.gone', 'project.scratch.temp', 'project.scratch.tool', 'project.scratch.outside']) assert.notEqual(t(key), key, `${lang}: ${key} is written`);
    assert.match(t.count('project.others', 2), /^2 /, lang);
  }
});

test('the pill carries the bell, says how many need the person and opens the waiting list', () => {
  const pill = html.match(/<button[^>]*id="waitingBtn"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(pill, /class="[^"]*needs-pill/);
  assert.match(pill, /aria-controls="waitingList"/);
  assert.match(pill, /#i-bell/);
  assert.match(pill, /id="waitingLabel"/);
  assert.match(app, /\$\('#waitingBtn'\)\.addEventListener\('click'/);
  for (const lang of ['en', 'pt-BR']) {
    const t = translator(lang);
    assert.notEqual(t.count('needs.pill', 1), t.count('needs.pill', 3).replace('3', '1'), `${lang}: one and many read differently`);
    assert.match(t.count('needs.pill', 3), /^3 /);
  }
  assert.equal(translator('pt-BR').count('needs.pill', 3), '3 precisam de você');
});

test('the language and the alerts moved into Configurações, which the ⋯ of the bar opens', () => {
  assert.doesNotMatch(html, /id="personMenu"|class="lang"|data-lang=/);
  const sheet = readFileSync(new URL('runsettings.js', WEB), 'utf8');
  assert.ok(sheet.includes("'data-set': `lang-${code}`"));
  assert.ok(sheet.includes("'data-set': 'alerts'"));
  assert.ok(app.includes('lang: () => lang, setLang: setLanguage, openAlerts: () => alerts.openSettings()'));
});

// ---- the map header and its menus (mm48) -----------------------------------------------------------------------------

test('the map header is one quiet row: the summary with who works, then search and the Vista menu', () => {
  const tools = between('id="tools"', 'id="archBanner"');
  for (const id of ['summary', 'liveBtn', 'search', 'viewBtn', 'viewMenu']) assert.match(tools, new RegExp(`id="${id}"`), id);
  for (const gone of ['newChat', 'openOrch', 'newIdea', 'waitingBtn']) assert.doesNotMatch(tools, new RegExp(`id="${gone}"`), `${gone} left the map's toolbar`);
  assert.equal(translator('pt-BR')('search.placeholder'), 'Buscar no mapa');
});

test('Vista holds what changed, files, relations, the export and keeping the map up to date', () => {
  const menu = between('id="viewMenu"', 'id="archBanner"');
  for (const id of ['changed', 'filesSide', 'relations', 'mapExport', 'bgSwitch']) assert.match(menu, new RegExp(`id="${id}"`), id);
  for (const kind of ['md', 'mm', 'xmind']) assert.match(menu, new RegExp(`data-map-export="${kind}"`), kind);
  const pt = translator('pt-BR');
  assert.equal(pt('view.keep'), 'Manter o mapa em dia sozinho');
  assert.match(pt('view.keepCost'), /Isso gasta/);
});

test('Novo sits at the head of the conversations and holds a conversation, an idea and the orchestrator', () => {
  const head = between('class="cv-head"', 'class="cv-tools"');
  assert.match(head, /id="newBtn"[^>]*aria-haspopup="menu"/);
  const order = ['id="newChat"', 'id="newIdea"', 'id="openOrch"'].map((s) => head.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'all three in the menu');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(html, /id="convsNewChat"/, 'one way to start a conversation, not two');
  const pt = translator('pt-BR');
  assert.deepEqual(['new.chat', 'new.idea', 'new.orch'].map((k) => pt(k)), ['Nova conversa', 'Nova ideia', 'Orquestrador do projeto']);
});

// ---- the finish: what a phone tap and a keyboard meet ----------------------------------------------------------------

// A top-level function of app.js, from its line to its closing brace.
const fnOf = (name) => {
  const from = app.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.ok(from >= 0, `${name} is in app.js`);
  return app.slice(from, app.indexOf('\n}\n', from) + 2);
};

test('on a phone the amber pill and "who works" close the Conversas drawer first, so their list is not under it', () => {
  for (const name of ['openWaiting', 'openLive']) assert.match(fnOf(name), /convs\.closeDrawer\(\);/, name);
});

test('Esc in the export list closes only that list and goes back to "Exportar o mapa"', () => {
  const wire = fnOf('wireMenus');
  const handler = wire.slice(wire.indexOf("exportMenu.addEventListener('keydown'"));
  assert.match(handler.slice(0, handler.indexOf('});')), /'Escape'/);
});

test('both chats read their dot from the pill\'s rule, and the dot follows each new count', () => {
  assert.match(fnOf('chatWaits'), /needsYou\(state\)/);
  assert.equal(app.match(/waitingOf: chatWaits/g)?.length, 2, 'the map\'s chat and the workshop\'s');
  assert.match(fnOf('renderWaiting'), /chat\?\.refreshDot\(\)/);
});

test('the switches of Vista say their state with aria-checked from the start, never with aria-pressed', () => {
  const menu = between('id="viewMenu"', 'id="archBanner"');
  assert.doesNotMatch(menu, /role="menuitemcheckbox"[^>]*aria-pressed/);
  for (const [id, on] of [['filesSide', 'true'], ['relations', 'false'], ['bgSwitch', 'false']]) {
    assert.match(menu, new RegExp(`id="${id}"[^>]*aria-checked="${on}"|aria-checked="${on}"[^>]*id="${id}"`), id);
  }
});

test('"keep the map up to date" stays focusable while it saves: aria-disabled, not disabled', () => {
  const save = fnOf('setBackground');
  assert.doesNotMatch(save, /\.disabled = /);
  assert.match(save, /setAttribute\('aria-disabled', 'true'\)/);
  assert.match(app, /\$\('#bgSwitch'\)\.addEventListener\('click', \(e\) => \{[^\n]*aria-disabled/);
});

// ---- what the captures showed --------------------------------------------------------------------------------------

test('the Cut off card steps aside for an open menu, as it does for a sheet, so it never covers the person\'s menu', () => {
  assert.match(css, /body:has\(\.pop-menu:not\(\[hidden\]\), \.pp-list:not\(\[hidden\]\)\) \.cut \{ display: none; \}/);
});

test('the composer never grows past its sheet: a long way name or the hints give way, Send stays in view', () => {
  assert.match(css, /\.chat-form \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.chat-box \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.chat-part \{[^}]*display: inline-block;[^}]*text-overflow: ellipsis/, 'the part chip ends with an ellipsis');
});

test('beside an open chat the map header stays one line: search folds to its icon, then the name the bar already shows leaves', () => {
  assert.match(css, /\.mm-tools \{ container-type: inline-size; \}/);
  assert.match(css, /@container \(max-width: 780px\) \{[^@]*\.mm-search:focus-within input \{ width: 220px;/);
  assert.match(css, /@container \(max-width: 560px\) \{\s*\.summary-project, \.summary-project \+ \.sep \{ display: none; \}/);
});

test('every new word exists in both languages', () => {
  const keys = [
    'needs.pill.one', 'needs.pill.other', 'needs.none', 'needs.title', 'view.menu', 'view.files', 'view.relations',
    'view.rangeMore', 'view.keep', 'view.keepHint', 'view.keepCost', 'new.button', 'new.menu', 'new.chat', 'new.chatHint', 'new.idea',
    'new.ideaHint', 'new.orch', 'new.orchHint', 'live.working',
  ];
  for (const lang of ['en', 'pt-BR']) for (const k of keys) assert.ok(LANGS[lang][k]?.trim(), `${lang} ${k}`);
});
