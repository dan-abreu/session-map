import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../server/web/chat.js';

// Just enough DOM for chat.js: the sheet's fixed parts, found by selector, with listeners and children.
class El {
  constructor(tag = 'div', attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs ?? {};
    this.children = children;
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.dataset = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, evt = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...evt }); }
  replaceChildren(...cs) { this.children = cs; }
  focus() {}
}
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const walk = (el, out = []) => {
  if (el instanceof El) { out.push(el); for (const c of el.children) walk(c, out); }
  return out;
};
const text = (el) => walk(el).flatMap((e) => e.children.filter((c) => typeof c === 'string')).join(' ');

// chat.js finds each part by its data-chat role; the tests name them by the map sheet's ids.
const ROLES = {
  '#chatLog': 'log', '#chatForm': 'form', '#chatInput': 'input', '#chatSend': 'send', '#chatStop': 'stop', '#chatTitle': 'title', '#chatContext': 'context',
  '#chatStatus': 'status', '#chatMode': 'mode', '#chatList': 'list', '#chatNote': 'note', '#chatPcMode': 'pcmode', '[data-close="chat"]': 'close', '#chatWhere': 'where',
  '#chatRun': 'run', '#chatRunPanel': 'runpanel',
};
function sheet() {
  const parts = new Map(Object.keys(ROLES).map((s) => [s, new El()]));
  const byRole = new Map(Object.entries(ROLES).map(([s, role]) => [`[data-chat="${role}"]`, parts.get(s)]));
  const root = new El();
  root.hidden = true;
  root.querySelector = (sel) => byRole.get(sel);
  return { root, part: (sel) => parts.get(sel) };
}

globalThis.document ??= { activeElement: null, contains: () => false };

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const KEY = 'a'.repeat(32);

// The server as chat.js sees it through fetch, answering from `routes` and keeping every call.
function server(routes) {
  const calls = [];
  globalThis.fetch = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    const hit = Object.entries(routes).find(([prefix]) => `${init.method ?? 'GET'} ${path}`.startsWith(prefix));
    const data = hit ? hit[1](body) : { error: 'not-found' };
    return { ok: !data.error, status: data.error ? 404 : 200, json: async () => data };
  };
  const streams = [];
  globalThis.EventSource = class { constructor(url) { this.url = url; this.listeners = {}; streams.push(this); } addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } close() { this.closed = true; } };
  return { calls, streams };
}

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k), items };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const tt = () => (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

function makeChat({ storage = memoryStorage(), onClose = () => {}, onPcMode = () => {}, ...extra } = {}) {
  const s = sheet();
  const chat = createChat({ root: s.root, h, t: tt, toast() {}, errorText: (e) => e, onClose, onPcMode, storage, relative: () => 'just now', ...extra });
  return { chat, ...s, storage };
}

const LIST = {
  chats: [
    { sessionId: S1, title: 'Second question', updatedAt: '2026-10-09T12:00:00Z', mode: 'acceptEdits', chatKey: null, running: false },
    { sessionId: S2, title: 'First question', updatedAt: '2026-10-09T11:00:00Z', mode: 'settings', chatKey: null, running: false },
  ],
  settings: { mode: 'auto', downgraded: false },
};
const HISTORY = { sessionId: S1, title: 'Second question', mode: 'acceptEdits', chatKey: null, settings: { mode: 'auto', downgraded: false },
  messages: [{ role: 'user', text: 'Second question' }, { role: 'assistant', text: 'Here it is.' }] };

test('a chat sheet closes when the page moves to another project', () => {
  server({ 'GET /api/chat/list': () => LIST });
  let closed = 0;
  const { chat } = makeChat({ onClose: () => closed++ });
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  chat.showProject('notes-app');
  assert.equal(chat.isOpen(), false);
  assert.equal(closed, 1);
});

test('a chat sheet stays open while its own project is shown again (language switch, poll)', () => {
  server({ 'GET /api/chat/list': () => LIST });
  const { chat } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  chat.showProject('acme-shop');
  assert.equal(chat.isOpen(), true);
});

test('opening a part lists the conversations the page opened there, and picking one shows its history and continues it', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST, [`GET /api/chat/history/${S1}`]: () => HISTORY, 'POST /api/chat/start': () => ({ chatKey: KEY, mode: 'acceptEdits' }) });
  const { chat, part, storage } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/chat/list?projectId=acme-shop&partId=checkout'));
  const picks = walk(part('#chatList')).filter((e) => e.tag === 'button' && e.attrs.onclick);
  assert.equal(picks.length, 2);
  assert.ok(text(picks[0]).includes('Second question'), 'the one used last comes first');
  assert.ok(text(picks[1]).includes('First question'));

  picks[0].attrs.onclick();
  await settle();
  assert.equal(part('#chatList').hidden, true);
  assert.ok(text(part('#chatLog')).includes('Here it is.'));
  assert.equal(part('#chatMode').value, 'acceptEdits', 'the choice made for this conversation');
  assert.equal(JSON.parse(storage.items.get('sm.chat')).sessionId, S1, 'a reload brings it back');

  part('#chatInput').value = 'And the retry';
  part('#chatForm').fire('submit');
  await settle();
  const start = calls.find((c) => c.path === '/api/chat/start');
  assert.deepEqual(start.body, { projectId: 'acme-shop', sessionId: S1, mode: 'acceptEdits', run: { kind: 'settings' }, text: 'And the retry' });
});

test('a reload reopens the saved conversation of this project; closing the sheet forgets it', async () => {
  const { calls } = server({ [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question', subtitle: 'Checkout' }) });
  const { chat, part } = makeChat({ storage });
  chat.restore('notes-app');
  assert.equal(chat.isOpen(), false, 'another project keeps its own page');
  chat.restore('acme-shop');
  await settle();
  assert.equal(chat.isOpen(), true);
  assert.ok(calls.some((c) => c.path === `/api/chat/history/${S1}`));
  assert.ok(text(part('#chatLog')).includes('Here it is.'));
  chat.close();
  assert.equal(storage.items.has('sm.chat'), false);
});

test('a running conversation is watched again and the header selector switches its mode', async () => {
  const live = { ...HISTORY, chatKey: KEY, mode: 'settings' };
  const { calls, streams } = server({ [`GET /api/chat/history/${S1}`]: () => live, [`POST /api/chat/${KEY}/mode`]: () => ({ mode: 'default' }) });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat, part } = makeChat({ storage });
  chat.restore('acme-shop');
  await settle();
  assert.equal(streams.at(-1).url, `/api/chat/${KEY}/events`);
  const mode = part('#chatMode');
  assert.equal(mode.value, 'settings');
  assert.ok(text(mode).includes('chat.mode.settings(chat.modeName.auto)'), 'the label says what the settings hold');
  mode.value = 'default';
  mode.fire('change');
  await settle();
  assert.deepEqual(calls.find((c) => c.path === `/api/chat/${KEY}/mode`).body, { mode: 'default' });
});

test('a bypassPermissions setting shows the note that the page runs it as auto', async () => {
  server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'auto', downgraded: true } }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  assert.equal(part('#chatNote').hidden, false);
  assert.equal(part('#chatNote').textContent, 'chat.downgraded');
  assert.equal(part('#chatList').hidden, true, 'nothing to list');
});

test('an item lists the chats opened on it, and an idea those at the project root', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST });
  const { chat } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Refunds', intro: 'intro', start: { node: { kind: 'item', partId: 'pay', code: 'pa04' } } });
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/chat/list?projectId=acme-shop&partId=pay&code=pa04'));
  chat.open({ projectId: 'acme-shop', title: 'New idea', intro: 'intro', start: { node: { kind: 'idea' } } });
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/chat/list?projectId=acme-shop&kind=idea'));
});

test('a ready request fills the box and goes with the point in the first message', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Create the map', intro: 'intro', draft: 'Create the architecture map.', start: { node: { kind: 'create-arch' } } });
  assert.equal(part('#chatInput').value, 'Create the architecture map.');
  part('#chatForm').fire('submit');
  await settle();
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body, { projectId: 'acme-shop', node: { kind: 'create-arch' }, mode: 'settings', run: { kind: 'auto', selfReinforce: false }, text: 'Create the architecture map.' });
});

test('"use this mode on the whole PC" waits for a real mode, then hands it to the page', async () => {
  server({ 'GET /api/chat/list': () => LIST });
  const asked = [];
  const { chat, part } = makeChat({ onPcMode: (mode) => asked.push(mode) });
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  const btn = part('#chatPcMode');
  assert.equal(btn.disabled, true, 'the settings choice is already what the PC uses');
  part('#chatMode').value = 'acceptEdits';
  part('#chatMode').fire('change');
  assert.equal(btn.disabled, false);
  btn.fire('click');
  assert.deepEqual(asked, ['acceptEdits']);
});

// ---- the flow workshop's sheet --------------------------------------------------------------

const sse = (stream, type, data, id) => { for (const fn of stream.listeners[type] ?? []) fn({ data: JSON.stringify(data), lastEventId: String(id) }); };

test('the workshop sheet: its chats are listed by kind, a draft event redraws instead of joining the log, and a reply shows its diagram folded', async () => {
  const { calls, streams } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const drafts = [];
  const { chat, part } = makeChat({ onDraft: (text) => drafts.push(text), showText: (text) => text.replace(/```mermaid[\s\S]*?```/g, '[d]') });
  chat.open({ projectId: 'acme-shop', title: 'Flow workshop', intro: 'intro', start: { node: { kind: 'flow' } } });
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/chat/list?projectId=acme-shop&kind=flow'));
  part('#chatInput').value = 'Add billing';
  part('#chatForm').fire('submit');
  await settle();
  const stream = streams.at(-1);
  sse(stream, 'text', { text: 'Done.\n```mermaid\nflowchart LR\n  a --> b\n```', partial: false }, 1);
  sse(stream, 'draft', { text: 'flowchart LR\n  a --> b' }, 2);
  assert.deepEqual(drafts, ['flowchart LR\n  a --> b']);
  const shown = text(part('#chatLog'));
  assert.ok(shown.includes('Done.') && shown.includes('[d]'), 'the reply shows the folded diagram');
  assert.ok(!shown.includes('a --> b'), 'neither the reply nor the draft event prints the mermaid');
});

test('the workshop sheet saves the draft before a message leaves, and remembers no conversation for a reload', async () => {
  const order = [];
  const { streams } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => { order.push('start'); return { chatKey: KEY }; } });
  const storage = memoryStorage();
  const { chat, part } = makeChat({ storage, savedKey: null, beforeSend: async () => { await settle(); order.push('saved'); } });
  chat.open({ projectId: 'acme-shop', title: 'Flow workshop', intro: 'intro', start: { node: { kind: 'flow' } } });
  part('#chatInput').value = 'Draw it';
  part('#chatForm').fire('submit');
  await settle();
  await settle();
  assert.deepEqual(order, ['saved', 'start']);
  sse(streams.at(-1), 'session', { sessionId: S1, state: 'started' }, 1);
  assert.equal(storage.items.size, 0, 'nothing kept for a reload');
});

test('a conversation that lives in VS Code reads here with its note and buttons; the box to write shows only when it may be written here', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => ({ ...HISTORY, mode: 'settings', readOnly: true }) });
  const { chat, part } = makeChat();
  let opened = 0;
  let canWrite = false;
  chat.open({
    projectId: 'acme-shop', title: 'Second question', intro: 'intro', start: { sessionId: S1 },
    where: () => ({ note: 'Open in VS Code: read it here.', actions: [{ label: 'Open in VS Code', onclick: () => opened++ }], canWrite }),
  });
  await settle();
  assert.ok(text(part('#chatLog')).includes('Here it is.'), 'the history reads');
  assert.equal(part('#chatForm').hidden, true, 'open elsewhere: nothing to write here');
  assert.equal(part('#chatWhere').hidden, false);
  assert.ok(text(part('#chatWhere')).includes('Open in VS Code: read it here.'));
  walk(part('#chatWhere')).find((e) => e.tag === 'button').attrs.onclick();
  assert.equal(opened, 1);
  assert.equal(chat.current(), S1, 'the list can mark the conversation the sheet shows');

  canWrite = true;
  chat.relabel();
  assert.equal(part('#chatForm').hidden, false, 'closed: written here, it resumes');

  chat.open({ projectId: 'acme-shop', title: 'x', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  assert.equal(part('#chatWhere').hidden, true, 'a page conversation has no such note');
  assert.equal(part('#chatForm').hidden, false);
  chat.close();
  assert.equal(chat.current(), null);
});

// ---- how the conversation runs: header, Automatic / Manual, folded blocks (plano-v02 item 12) ----

const byRun = (el, name) => walk(el).find((e) => e.attrs?.['data-run'] === name);
const MINE = { model: 'opus[1m]', effort: 'xhigh', ultracode: false };
const LIST_RUN = { chats: [], settings: { mode: 'default', downgraded: false }, mine: MINE, reinforce: { limitUSD: 20, spentUSD: 3 } };
const openPart = (chat) => chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
const send = async (part, words) => {
  part('#chatInput').value = words;
  part('#chatForm').fire('submit');
  await settle();
};

test('a new conversation shows Automatic in its header, says what runs and why, and the first message carries that choice', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  const head = text(part('#chatRun'));
  for (const words of ['run.way.auto', 'Opus', 'run.effort.high', 'run.why.auto']) assert.ok(head.includes(words), words);
  await send(part, 'Fix the button');
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body.run, { kind: 'auto', selfReinforce: false });
});

test('Manual: each way says when to use it; a fixed model and effort go with the first message and show in the header', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  byRun(part('#chatRun'), 'toggle').attrs.onclick();
  assert.equal(part('#chatRunPanel').hidden, false);
  byRun(part('#chatRunPanel'), 'path-manual').attrs.onclick();
  const panel = text(part('#chatRunPanel'));
  for (const hint of ['run.hint.maestro', 'run.hint.ultracode', 'run.hint.fixed', 'run.hint.settings(Opus 1M,run.effort.xhigh)']) assert.ok(panel.includes(hint), hint);
  byRun(part('#chatRunPanel'), 'way-fixed').attrs.onchange();
  byRun(part('#chatRunPanel'), 'model-haiku').attrs.onchange();
  byRun(part('#chatRunPanel'), 'effort-low').attrs.onclick();
  assert.ok(text(part('#chatRunPanel')).includes('run.effortHint.low'));
  const head = text(part('#chatRun'));
  assert.ok(head.includes('Haiku') && head.includes('run.effort.low') && head.includes('run.way.fixed'));
  await send(part, 'Rename it');
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body.run, { kind: 'fixed', model: 'haiku', effort: 'low' });
});

test('Ultracode waits for a confirmation that warns about the cost; cancelling keeps the way it was', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  byRun(part('#chatRun'), 'toggle').attrs.onclick();
  byRun(part('#chatRunPanel'), 'path-manual').attrs.onclick();
  byRun(part('#chatRunPanel'), 'way-ultracode').attrs.onchange();
  assert.ok(text(part('#chatRunPanel')).includes('run.ultra.warn'));
  assert.ok(text(part('#chatRun')).includes('run.way.maestro'), 'not applied before the OK');
  byRun(part('#chatRunPanel'), 'ultra-no').attrs.onclick();
  assert.ok(!text(part('#chatRunPanel')).includes('run.ultra.warn'));
  byRun(part('#chatRunPanel'), 'way-ultracode').attrs.onchange();
  byRun(part('#chatRunPanel'), 'ultra-yes').attrs.onclick();
  assert.ok(text(part('#chatRun')).includes('run.way.ultracode'));
  await send(part, 'Rebuild the sign in');
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body.run, { kind: 'ultracode' });
});

test('on a running conversation a new choice goes to the server at once, and the header follows the run events with the cost', async () => {
  const live = { ...HISTORY, chatKey: KEY, run: { kind: 'auto', selfReinforce: false }, mine: MINE, reinforce: { limitUSD: null, spentUSD: 0 }, costUSD: 0.2 };
  const { calls, streams } = server({ [`GET /api/chat/history/${S1}`]: () => live, [`POST /api/chat/${KEY}/run`]: (body) => ({ run: body.run }) });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat, part } = makeChat({ storage, money: (usd) => `$${usd.toFixed(2)}` });
  chat.restore('acme-shop');
  await settle();
  assert.ok(text(part('#chatRun')).includes('$0.20'), 'the cost so far, before any event');
  sse(streams.at(-1), 'run', { run: { kind: 'auto', selfReinforce: false }, model: 'claude-opus-5-5', effort: 'high', level: 'reinforced', why: 'mexe no login', costUSD: 1.5 }, 1);
  const head = text(part('#chatRun'));
  assert.ok(head.includes('Opus 5.5') && head.includes('run.level.reinforced(mexe no login)') && head.includes('$1.50'));
  byRun(part('#chatRun'), 'toggle').attrs.onclick();
  byRun(part('#chatRunPanel'), 'self').attrs.onchange();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === `/api/chat/${KEY}/run`).body, { run: { kind: 'auto', selfReinforce: true } });
});

test('Automatic\'s "may reinforce on its own" shows the monthly limit and what was used, and saves a new limit', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/settings/reinforced-limit': (body) => ({ limitUSD: body.usd }) });
  const toasts = [];
  const { chat, part } = makeChat({ money: (usd) => `$${usd}`, toast: (m) => toasts.push(m) });
  openPart(chat);
  await settle();
  byRun(part('#chatRun'), 'toggle').attrs.onclick();
  const panel = part('#chatRunPanel');
  assert.ok(text(panel).includes('run.limitUsed($3,$20)'));
  byRun(panel, 'limit').value = '35';
  byRun(panel, 'limit-save').attrs.onclick();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === '/api/settings/reinforced-limit').body, { usd: 35 });
  assert.ok(toasts.some((m) => m.startsWith('run.limitSaved')));
});

test('a reply folds its status line and session-map card into chips; an ask to reinforce gets buttons that answer for the person', async () => {
  const { calls, streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }), [`POST /api/chat/${KEY}/send`]: () => ({}) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Change the sign in');
  const stream = streams.at(-1);
  const reply = '**Skills:** none · **Agentes:** none\n\nThis touches the sign in.\n\n```session-map\n{"title":"Sign in","doing":"Waiting for the OK"}\n```\n\n```session-map-run\n{"level":"ask-reinforce","why":"sign in","estimateUSD":4}\n```';
  sse(stream, 'text', { text: reply, partial: false }, 1);
  sse(stream, 'run', { run: { kind: 'auto', selfReinforce: false }, model: 'claude-opus-5-5', effort: 'high', level: 'ask-reinforce', why: 'sign in', estimateUSD: 4, costUSD: 0.1 }, 2);
  sse(stream, 'turn-end', { costUSD: 0.1 }, 3);
  const log = part('#chatLog');
  const shown = text(log);
  assert.ok(shown.includes('This touches the sign in.'));
  assert.ok(!shown.includes('**Skills:**') && !shown.includes('"doing"') && !shown.includes('session-map-run'), 'no raw blocks');
  assert.ok(walk(log).some((e) => e.tag === 'details' && e.attrs.class?.includes('fold-chip')), 'folded into chips');
  assert.ok(shown.includes('Waiting for the OK'), 'the card reads as words inside its chip');
  byRun(log, 'ask-yes').attrs.onclick();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === `/api/chat/${KEY}/send`).body, { text: 'run.ask.yesText' });
});

test('the answer session-map gave for the person shows as its own note, not as the person\'s bubble', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Change the sign in');
  sse(streams.at(-1), 'user', { text: 'OK, you may reinforce.', auto: 'reinforce' }, 1);
  const shown = text(part('#chatLog'));
  assert.ok(shown.includes('run.autoAnswered'));
  assert.ok(!shown.includes('OK, you may reinforce.'));
});

test('a conversation a restart cut off says so, and Continue picks it up with one message; a finished one shows its summary', async () => {
  const { calls } = server({
    [`GET /api/chat/history/${S1}`]: () => ({ ...HISTORY, messages: [{ role: 'user', text: 'Second question' }], interrupted: true }),
    'POST /api/chat/start': () => ({ chatKey: KEY, mode: 'acceptEdits' }),
  });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Second question', start: { sessionId: S1 } });
  await settle();
  assert.equal(part('#chatStatus').dataset.state, 'interrupted');
  assert.equal(part('#chatStatus').textContent, 'chat.state.interrupted');
  const cont = walk(part('#chatLog')).find((e) => e.attrs['data-sig-act'] === 'continue');
  assert.ok(cont, 'the cut-off card offers Continue');
  cont.attrs.onclick();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body.text, 'chat.continueText');
  assert.equal(part('#chatStatus').dataset.state, 'working');

  server({ [`GET /api/chat/history/${S2}`]: () => ({ ...HISTORY, sessionId: S2 }) });
  chat.open({ projectId: 'acme-shop', title: 'First', start: { sessionId: S2 } });
  await settle();
  assert.equal(part('#chatStatus').textContent, 'chat.state.finished(Here it is.)');
});
