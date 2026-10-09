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
  '#chatStatus': 'status', '#chatMode': 'mode', '#chatList': 'list', '#chatNote': 'note', '#chatPcMode': 'pcmode', '[data-close="chat"]': 'close',
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
  assert.deepEqual(start.body, { projectId: 'acme-shop', sessionId: S1, mode: 'acceptEdits', text: 'And the retry' });
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
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body, { projectId: 'acme-shop', node: { kind: 'create-arch' }, mode: 'settings', text: 'Create the architecture map.' });
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
  assert.ok(shown.includes('Done.\n[d]'), 'the reply shows the folded diagram');
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
