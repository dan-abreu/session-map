import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../server/web/chat.js';
import { createRunSettings } from '../server/web/runsettings.js';

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
    this.style = {};
    this.classList = { toggle() {} };
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, evt = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...evt }); }
  replaceChildren(...cs) { this.children = cs; }
  append(...cs) { this.children.push(...cs); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  contains(other) { return walk(this).includes(other); }
  focus() { globalThis.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
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
  '#chatStatus': 'status', '#chatList': 'list', '#chatNote': 'note', '[data-close="chat"]': 'close', '#chatWhere': 'where', '#chatDot': 'dot', '#chatLive': 'live',
  '#chatBrain': 'brain', '#chatMore': 'more', '#chatMoreMenu': 'moremenu', '#chatModeBtn': 'modebtn', '#chatModeMenu': 'modemenu',
  '#chatModelBtn': 'modelbtn', '#chatModelMenu': 'modelmenu',
};
function sheet() {
  const parts = new Map(Object.keys(ROLES).map((s) => [s, new El()]));
  const byRole = new Map(Object.entries(ROLES).map(([s, role]) => [`[data-chat="${role}"]`, parts.get(s)]));
  // Stop sits in the working line.
  parts.get('#chatLive').children = [parts.get('#chatStatus'), parts.get('#chatStop')];
  const root = new El();
  root.hidden = true;
  root.querySelector = (sel) => byRole.get(sel);
  return { root, part: (sel) => parts.get(sel) };
}

// The page: a press anywhere reaches its listeners first (outside a menu, it closes the menu).
globalThis.document ??= { activeElement: null, contains: () => false, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } };
const pointerDown = (target) => { for (const fn of document.listeners.pointerdown ?? []) fn({ target }); };

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
  const picks = walk(part('#chatList')).filter((e) => e.tag === 'button' && String(e.attrs?.class ?? '').includes('link-row'));
  assert.equal(picks.length, 2);
  assert.ok(text(picks[0]).includes('Second question'), 'the one used last comes first');
  assert.ok(text(picks[1]).includes('First question'));

  picks[0].attrs.onclick();
  await settle();
  assert.equal(part('#chatList').hidden, true);
  assert.ok(text(part('#chatLog')).includes('Here it is.'));
  assert.equal(chat.settings().choice(), 'acceptEdits', 'the choice made for this conversation, as Configurações shows it');
  assert.equal(JSON.parse(storage.items.get('sm.chat')).sessionId, S1, 'a reload brings it back');

  part('#chatInput').value = 'And the retry';
  part('#chatForm').fire('submit');
  await settle();
  const start = calls.find((c) => c.path === '/api/chat/start');
  assert.deepEqual(start.body, { projectId: 'acme-shop', sessionId: S1, mode: 'acceptEdits', text: 'And the retry' });
});

test('the footer picks the permission mode like Claude Code, and the next new conversation starts in it', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part, storage } = makeChat();
  const start = { projectId: 'acme-shop', title: 'New chat', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } };
  chat.open(start);
  await settle();
  const btn = part('#chatModeBtn');
  assert.equal(btn.dataset.mode, 'default', 'the settings hold Manual, and the chip says so');
  assert.ok(text(btn).includes('chat.modeName.default'));
  const rows = walk(part('#chatModeMenu')).filter((e) => e.attrs?.role === 'menuitemradio');
  assert.deepEqual(rows.map((r) => r.attrs['data-mode']), ['default', 'acceptEdits', 'plan', 'auto'], 'the four modes, each with what it does');
  assert.ok(text(part('#chatModeMenu')).includes('chat.modeHint.auto'));
  assert.equal(rows.find((r) => r.attrs['data-mode'] === 'default').attrs['aria-checked'], 'true');

  rows.find((r) => r.attrs['data-mode'] === 'auto').attrs.onclick();
  await settle();
  assert.equal(btn.dataset.mode, 'auto');
  assert.equal(storage.items.get('sm.chat.mode'), 'auto', 'remembered for the next conversation');
  part('#chatInput').value = 'A long task';
  part('#chatForm').fire('submit');
  await settle();
  assert.equal(calls.find((c) => c.path === '/api/chat/start').body.mode, 'auto');

  chat.close();
  chat.open(start);
  await settle();
  assert.equal(chat.settings().choice(), 'auto', 'a new conversation starts in the mode picked last');
  assert.equal(part('#chatModeBtn').dataset.mode, 'auto');
});

// pc40: the model chip, like Claude Code's — Automático, or an AI's model and its level.
const ENGINES = { ok: true, standby: true, engines: [
  { ai: 'claude', start: { model: 'opus', effort: 'high' }, models: [{ id: 'opus', name: 'Opus 5.5', levels: ['low', 'medium', 'high', 'xhigh', 'max'] }, { id: 'sonnet', name: 'Sonnet 5.5', levels: ['low', 'medium', 'high'] }] },
  { ai: 'deepseek', start: { model: 'deepseek-v4-pro', effort: 'high' }, models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', levels: ['low', 'medium', 'high', 'max'] }] },
] };

test('the footer picks the AI, the model and the level like Claude Code; a new conversation starts on the pick and the next one too', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'GET /api/chat/engines': () => ENGINES, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part, storage } = makeChat();
  const start = { projectId: 'acme-shop', title: 'New chat', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } };
  chat.open(start);
  await settle();
  const btn = part('#chatModelBtn');
  assert.equal(btn.dataset.pick, 'auto', 'nothing picked yet: Automático');
  assert.ok(text(btn).includes('chat.model.auto'));
  const rows = () => walk(part('#chatModelMenu')).filter((e) => e.attrs?.role === 'menuitemradio');
  assert.deepEqual(rows().map((r) => text(r).split(' ')[0]), ['chat.model.auto', 'Opus', 'Sonnet', 'DeepSeek'], 'Automático, then each AI\'s models');
  assert.ok(text(part('#chatModelMenu')).includes('Claude') && text(part('#chatModelMenu')).includes('DeepSeek'), 'grouped by AI');

  rows().find((r) => text(r).includes('DeepSeek Flash')).attrs.onclick();
  await settle();
  assert.equal(btn.dataset.pick, 'fixed');
  assert.ok(text(btn).includes('DeepSeek Flash') && text(btn).includes('run.effort.high'), 'the AI\'s start level when the model has it');
  const levels = walk(part('#chatModelMenu')).filter((e) => e.attrs?.class === 'chat-level');
  assert.deepEqual(levels.map((l) => l.attrs['data-level']), ['low', 'medium', 'high', 'max'], 'the levels of the picked model');
  levels.find((l) => l.attrs['data-level'] === 'max').attrs.onclick();
  await settle();
  assert.deepEqual(JSON.parse(storage.items.get('sm.chat.pick')), { ai: 'deepseek', model: 'deepseek-flash', effort: 'max' }, 'kept for the next conversation');

  part('#chatInput').value = 'Oi';
  part('#chatForm').fire('submit');
  await settle();
  const body = calls.find((c) => c.path === '/api/chat/start').body;
  assert.equal(body.ai, 'deepseek');
  assert.deepEqual(body.run, { kind: 'talk', model: 'deepseek-flash', effort: 'max' });

  chat.close();
  chat.open(start);
  await settle();
  assert.ok(text(part('#chatModelBtn')).includes('DeepSeek Flash'), 'a new conversation starts on the pick made last');
});

test('a running conversation changes its model and level at once, keeps its AI, and Automático goes back', async () => {
  const { calls, streams } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'GET /api/chat/engines': () => ENGINES, 'POST /api/chat/start': () => ({ chatKey: KEY }), [`POST /api/chat/${KEY}/run`]: () => ({ run: { kind: 'talk' } }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'New chat', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  part('#chatInput').value = 'Oi';
  part('#chatForm').fire('submit');
  await settle();
  sse(streams.at(-1), 'session', { sessionId: S1, state: 'started' }, 1);
  sse(streams.at(-1), 'run', { run: { kind: 'talk' }, ai: 'claude', model: 'claude-opus-5-5', effort: 'high', brain: null, costUSD: 0 }, 2);
  await settle();
  const rows = walk(part('#chatModelMenu')).filter((e) => e.attrs?.role === 'menuitemradio');
  const flash = rows.find((r) => text(r).includes('DeepSeek Flash'));
  assert.equal(flash.attrs['aria-disabled'], 'true', 'a conversation keeps the AI it began on');
  assert.ok(text(flash).includes('chat.model.otherAi'));
  rows.find((r) => text(r).includes('Sonnet')).attrs.onclick();
  await settle();
  const sent = calls.filter((c) => c.path === `/api/chat/${KEY}/run`);
  assert.deepEqual(sent.at(-1).body, { model: 'sonnet', effort: 'high' });
  walk(part('#chatModelMenu')).filter((e) => e.attrs?.role === 'menuitemradio')[0].attrs.onclick();
  await settle();
  assert.deepEqual(calls.filter((c) => c.path === `/api/chat/${KEY}/run`).at(-1).body, {}, 'Automático');
  assert.equal(part('#chatModelBtn').dataset.pick, 'auto');
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

// Configurações (pc19) over a chat sheet, as the page wires it.
function makeSettings(extra = {}) {
  const dialog = new El('dialog');
  const sheetCtl = createRunSettings({
    dialog, h, t: tt, money: (usd) => `$${usd}`, toast() {}, errorText: (e) => e,
    limit: { read: async () => ({ ok: true, limitUSD: 20, spentUSD: 3 }), save: async (usd) => ({ ok: true, limitUSD: usd }) },
    ...extra,
  });
  return { sheetCtl, dialog };
}
const bySet = (el, name) => walk(el).find((e) => e.attrs?.['data-set'] === name);

test('a running conversation is watched again and Configurações switches its mode', async () => {
  const live = { ...HISTORY, chatKey: KEY, mode: 'settings' };
  const { calls, streams } = server({ [`GET /api/chat/history/${S1}`]: () => live, [`POST /api/chat/${KEY}/mode`]: () => ({ mode: 'default' }) });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat } = makeChat({ storage });
  chat.restore('acme-shop');
  await settle();
  assert.equal(streams.at(-1).url, `/api/chat/${KEY}/events`);
  const { sheetCtl, dialog } = makeSettings();
  await sheetCtl.open(chat.settings());
  const mode = bySet(dialog, 'mode');
  assert.equal(mode.value, 'settings');
  assert.ok(text(mode).includes('chat.mode.settings(chat.modeName.auto)'), 'the label says what the settings hold');
  mode.value = 'default';
  mode.fire('change');
  await settle();
  assert.deepEqual(calls.find((c) => c.path === `/api/chat/${KEY}/mode`).body, { mode: 'default' });
});

test('a reopened running conversation replays only the events after its history, so no turn shows twice (pc13)', async () => {
  const live = { ...HISTORY, chatKey: KEY, fromEventId: 5 };
  const { streams } = server({ [`GET /api/chat/history/${S1}`]: () => live });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat, part } = makeChat({ storage });
  chat.restore('acme-shop');
  await settle();
  sse(streams.at(-1), 'user', { text: 'Second question' }, 5);
  sse(streams.at(-1), 'user', { text: 'Third question' }, 6);
  const shown = text(part('#chatLog'));
  assert.equal(shown.split('Second question').length - 1, 1, 'the turn the history holds is not replayed');
  assert.ok(shown.includes('Third question'));
});

test('a reopened running conversation still takes the header events from before its history, and shows it is working (pc13)', async () => {
  const live = { ...HISTORY, chatKey: KEY, fromEventId: 5, running: true };
  const { streams } = server({ [`GET /api/chat/history/${S1}`]: () => live });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat, part } = makeChat({ storage });
  chat.restore('acme-shop');
  await settle();
  assert.equal(part('#chatStop').hidden, false, 'its turn is still running, though its message is in the history');
  assert.equal(part('#chatLive').hidden, false, 'the working line says so');
  assert.equal(part('#chatBrain').hidden, true, 'no run event yet: the brain\'s line is quiet');
  sse(streams.at(-1), 'run', { run: { kind: 'talk' }, model: 'claude-sonnet-5-5', effort: 'high', brain: { phase: 'build', why: 'money' }, costUSD: 1.5 }, 3);
  assert.equal(part('#chatBrain').hidden, false);
  const line = text(part('#chatBrain'));
  assert.ok(line.includes('Sonnet 5.5'), 'the model claude reported, from before the history\'s end');
  assert.ok(line.includes('run.effort.high') && !line.includes('run.brain.'), 'the reasoning, not the entry brain\'s why');
  assert.ok(part('#chatBrain').attrs.title.includes('run.brain.money'), 'the why rides in the tooltip');
});

test('events that arrive together are drawn once, on the next frame (pc13)', async () => {
  const frames = [];
  const { streams } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat({ frame: (fn) => frames.push(fn) });
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  part('#chatInput').value = 'Hello';
  part('#chatForm').fire('submit');
  await settle();
  frames.splice(0).forEach((fn) => fn());
  for (const [n, piece] of ['One ', 'two ', 'three'].entries()) sse(streams.at(-1), 'text', { text: piece, partial: true }, n + 2);
  assert.ok(!text(part('#chatLog')).includes('One'), 'nothing drawn before the frame');
  assert.equal(frames.length, 1, 'one drawing for the three pieces');
  frames.splice(0).forEach((fn) => fn());
  assert.ok(text(part('#chatLog')).includes('One two three'));

  // A message that arrives in the same frame as the events after it still brings the view down to it.
  const logEl = part('#chatLog');
  Object.assign(logEl, { scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
  sse(streams.at(-1), 'user', { text: 'An answer for the person', auto: 'reinforce' }, 5);
  sse(streams.at(-1), 'text', { text: 'More', partial: true }, 6);
  frames.splice(0).forEach((fn) => fn());
  assert.equal(logEl.scrollTop, 1000);
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

test('the project chats: the root lists the chats about the whole project, with their cost, under their own heading', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ ...LIST, chats: LIST.chats.map((c, n) => ({ ...c, costUSD: n ? 0.5 : 1.25 })) }) });
  const { chat, part } = makeChat({ money: (v) => `US$ ${v.toFixed(2)}` });
  chat.open({ projectId: 'acme-shop', title: 'New project chat', intro: 'intro', listTitle: 'Chats about the whole project', start: { node: { kind: 'project' } } });
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/chat/list?projectId=acme-shop&kind=project'));
  const list = text(part('#chatList'));
  assert.ok(list.includes('Chats about the whole project'));
  assert.ok(list.includes('US$ 1.25') && list.includes('US$ 0.50'), 'what each one cost');
});

test('"New conversation" is in the ⋯ once the sheet holds a conversation, and starts a fresh one', async () => {
  server({ 'GET /api/chat/list': () => LIST, [`GET /api/chat/history/${S1}`]: () => HISTORY });
  let fresh = 0;
  const { chat, part } = makeChat();
  const newChat = () => fresh++;
  const newRow = () => {
    part('#chatMore').fire('click');
    const row = walk(part('#chatMoreMenu')).find((e) => e.attrs['data-more'] === 'new');
    part('#chatMoreMenu').fire('keydown', { key: 'Escape', stopPropagation() {} });
    return row;
  };
  chat.open({ projectId: 'acme-shop', title: 'New project chat', intro: 'intro', newChat, start: { node: { kind: 'project' } } });
  await settle();
  assert.equal(part('#chatMore').hidden, true, 'already a new chat: nothing in the ⋯');
  chat.open({ projectId: 'acme-shop', title: 'Second question', intro: 'intro', newChat, start: { sessionId: S1 } });
  await settle();
  const row = newRow();
  assert.ok(row);
  assert.ok(text(row).includes('chat.moreNew'));
  row.attrs.onclick();
  assert.equal(fresh, 1);
  chat.open({ projectId: 'acme-shop', title: 'New project chat', intro: 'intro', newChat, start: { node: { kind: 'project' } } });
  await settle();
  walk(part('#chatList')).find((e) => e.tag === 'button' && String(e.attrs?.class ?? '').includes('link-row')).attrs.onclick();
  await settle();
  assert.ok(newRow(), 'one reopened from the panel list keeps it');
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', start: { sessionId: S1 } });
  await settle();
  assert.equal(newRow(), undefined, 'a bubble chat keeps its sheet as it was');
});

test('a new project chat takes its first message as its title, as the list shows it; a bubble chat keeps the bubble\'s name', async () => {
  server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'New project chat', intro: 'intro', newChat() {}, retitle: true, start: { node: { kind: 'project' } } });
  part('#chatInput').value = '  What is left\nin this project?  ';
  part('#chatForm').fire('submit');
  await settle();
  assert.equal(part('#chatTitle').textContent, 'What is left in this project?');
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', newChat() {}, start: { node: { kind: 'part', partId: 'checkout' } } });
  part('#chatInput').value = 'Show the card error';
  part('#chatForm').fire('submit');
  await settle();
  assert.equal(part('#chatTitle').textContent, 'Checkout');
});

test('a new chat about a box says what to ask in the box to write in, and its ready first messages fill the box without sending', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [], settings: { mode: 'default' } }), [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', placeholder: 'Ask about Checkout…', starters: ['What is missing in Checkout?', 'Explain Checkout'], start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  assert.equal(part('#chatInput').placeholder, 'Ask about Checkout…');
  const starters = walk(part('#chatLog')).filter((e) => e.tag === 'button');
  assert.deepEqual(starters.map(text), ['What is missing in Checkout?', 'Explain Checkout']);
  starters[1].attrs.onclick();
  assert.equal(part('#chatInput').value, 'Explain Checkout');
  assert.ok(!calls.some((c) => c.path === '/api/chat/start'), 'nothing is sent until the person presses Send');
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', starters: ['Explain Checkout'], start: { sessionId: S1 } });
  assert.equal(walk(part('#chatLog')).filter((e) => e.tag === 'button' && !String(e.attrs?.class ?? '').includes('act-btn')).length, 0, 'a conversation picked up again offers none');
  assert.equal(part('#chatInput').placeholder, 'chat.placeholder', 'and without its own words the box says the usual');
  await settle();
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
  const { chat } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  await settle();
  const { sheetCtl, dialog } = makeSettings({ onPcMode: (mode) => asked.push(mode) });
  await sheetCtl.open(chat.settings());
  assert.equal(bySet(dialog, 'pcmode').attrs.disabled, true, 'the settings choice is already what the PC uses');
  bySet(dialog, 'mode').value = 'acceptEdits';
  bySet(dialog, 'mode').fire('change');
  assert.ok(!bySet(dialog, 'pcmode').attrs.disabled);
  bySet(dialog, 'pcmode').attrs.onclick();
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

// ---- how the conversation runs (id146): the brain's line by Send ----

const byRun = (el, name) => walk(el).find((e) => e.attrs?.['data-run'] === name);
const LIST_RUN = { chats: [], settings: { mode: 'default', downgraded: false }, reinforce: { limitUSD: 20, spentUSD: 3 } };
const openPart = (chat) => chat.open({ projectId: 'acme-shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
const send = async (part, words) => {
  part('#chatInput').value = words;
  part('#chatForm').fire('submit');
  await settle();
};

test('a new conversation sends no run of its own: the Cérebro decides, and the first message carries only the words and the mode', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Fix the button');
  const body = calls.find((c) => c.path === '/api/chat/start').body;
  assert.equal('run' in body, false, 'no way, no model chips: the Cérebro routes (id146)');
  assert.equal(body.mode, 'settings');
  assert.equal(body.text, 'Fix the button');
});

test('the brain\'s line by Send is quiet until the run event, then says the model and the reasoning; the why is in the tooltip', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Change the sign in');
  assert.equal(part('#chatBrain').hidden, true);
  sse(streams.at(-1), 'run', { run: { kind: 'talk' }, model: 'claude-opus-5-5', effort: 'high', brain: { phase: 'build', why: 'money' }, costUSD: 0.1 }, 1);
  assert.equal(part('#chatBrain').hidden, false);
  const line = text(part('#chatBrain'));
  assert.ok(line.includes('Opus 5.5') && line.includes('run.effort.high') && !line.includes('run.brain.'), line);
  assert.equal(part('#chatBrain').attrs.title, 'chat.brainTitle\nchat.brainWhy(run.brain.money)', 'the why rides in the tooltip');
});

test('a run event without a brain weight still names the model and the reasoning, never a why', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Hi');
  sse(streams.at(-1), 'run', { run: { kind: 'autonomous', model: 'sonnet', effort: 'medium' }, model: 'claude-sonnet-5-5', effort: 'medium', brain: null, costUSD: 0 }, 1);
  const line = text(part('#chatBrain'));
  assert.ok(line.includes('Sonnet 5.5') && line.includes('run.effort.medium') && !line.includes('run.brain.'), line);
  assert.equal(part('#chatBrain').attrs.title, 'chat.brainTitle', 'no why to add');
});

test('the folded steps line names the specialists that worked (id148)', async () => {
  const agents = [
    { id: 'coder', label: 'Developer', labelPt: 'Desenvolvedor', kinds: ['code', 'test'] },
    { id: 'reviewer', label: 'Reviewer', labelPt: 'Revisor', kinds: ['review'] },
  ];
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }), 'GET /api/ai/brain': () => ({ ok: true, agents }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Fix the button');
  const stream = streams.at(-1);
  const at = new Date().toISOString();
  sse(stream, 'tool', { id: 't1', name: 'Agent', phase: 'use', step: { kind: 'agent', target: '[code] fix the header' }, input: '{"description":"[code] fix the header"}', ts: at }, 1);
  sse(stream, 'tool', { id: 't2', name: 'Agent', phase: 'use', step: { kind: 'agent', target: '[code] add tests' }, input: '{"description":"[code] add tests"}', ts: at }, 2);
  sse(stream, 'tool', { id: 't3', name: 'Agent', phase: 'use', step: { kind: 'agent', target: '[review] check it' }, input: '{"description":"[review] check it"}', ts: at }, 3);
  await settle();
  const line = text(part('#chatLog'));
  assert.ok(line.includes('chat.steps.role(2,Developer)'), line);
  assert.ok(line.includes('chat.steps.role(1,Reviewer)'), line);
});

test('a step the Autonomous way left for the person shows as a line without buttons, and the chat keeps working', async () => {
  const live = { ...HISTORY, chatKey: KEY, running: true };
  const { streams } = server({ [`GET /api/chat/history/${S1}`]: () => live });
  const storage = memoryStorage({ 'sm.chat': JSON.stringify({ projectId: 'acme-shop', sessionId: S1, title: 'Second question' }) });
  const { chat, part } = makeChat({ storage });
  chat.restore('acme-shop');
  await settle();
  sse(streams.at(-1), 'permission', { requestId: 'r1', state: 'deferred', toolName: 'Bash', input: '{"command":"npm publish"}' }, 1);
  const log = part('#chatLog');
  const line = walk(log).find((e) => /state-deferred/.test(e.attrs?.class ?? ''));
  assert.ok(line, 'a line for it');
  assert.ok(text(line).includes('chat.permDeferred(Bash)') && text(line).includes('chat.perm.deferred'));
  assert.equal(walk(line).filter((e) => e.tag === 'button').length, 0, 'nothing to click: it was not asked');
  assert.equal(part('#chatStatus').dataset.state, 'working', 'not waiting for a permission');
});

test('both sheets: nothing about how the chat runs sits above the conversation; the brain\'s line sits by Send, before it', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  for (const id of ['chat', 'flowChat']) {
    const from = html.indexOf(`<aside id="${id}"`);
    const sheetHtml = html.slice(from, html.indexOf('</aside>', from));
    const top = sheetHtml.slice(0, sheetHtml.indexOf('data-chat="log"'));
    for (const role of ['run', 'runpanel', 'menu']) assert.ok(!top.includes(`data-chat="${role}"`), `${id}: no ${role} above the conversation`);
    const bar = sheetHtml.slice(sheetHtml.indexOf('class="chat-bar"'), sheetHtml.indexOf('data-chat="send"'));
    assert.ok(bar.includes('data-chat="brain"'), `${id}: the brain's line sits in the bar, before Send`);
    for (const role of ['run', 'menu', 'runpanel']) assert.ok(!bar.includes(`data-chat="${role}"`), `${id}: no ${role} in the bar`);
  }
});

test('Configurações keeps the permissions, the limit and the alerts; nothing about the ways of working', async () => {
  server({ 'GET /api/chat/list': () => LIST_RUN });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  const { sheetCtl, dialog } = makeSettings();
  await sheetCtl.open(chat.settings());
  for (const tag of ['mode', 'pcmode', 'limit', 'limit-save']) assert.ok(bySet(dialog, tag), tag);
  assert.equal(bySet(dialog, 'self'), undefined, '"may reinforce on its own" left with the ways');
  assert.equal(text(dialog).includes('settings.permissions'), true, 'the permissions stay in Configurações');
});

test('the header is one line: the title, then ⋯ with rename, archive and open, once the conversation has an id', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  const head = html.slice(html.indexOf('<div class="sheet-head chat-head">'), html.indexOf('<section class="point-info"'));
  assert.ok(head.includes('data-chat="title"') && head.includes('data-chat="close"') && !head.includes('data-chat="new"'), 'New conversation lives in the ⋯');
  assert.match(head, /data-chat="more"[^>]*aria-haspopup="menu"/, 'the ⋯ button says it opens a menu');
  assert.match(head, /data-chat="moremenu"[^>]*role="menu"/);

  server({ 'GET /api/chat/list': () => LIST, [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const done = [];
  const more = (sessionId) => [{ label: 'Rename', run: () => done.push(['rename', sessionId]) }, { label: 'Archive', run: () => done.push(['archive', sessionId]) }];
  const { chat, part } = makeChat({ more });
  chat.open({ projectId: 'acme-shop', title: 'New project chat', intro: 'intro', start: { node: { kind: 'project' } } });
  await settle();
  assert.equal(part('#chatMore').hidden, true, 'nothing to rename before the first message');
  chat.open({ projectId: 'acme-shop', title: 'Second question', start: { sessionId: S1 } });
  await settle();
  assert.equal(part('#chatMore').hidden, false);
  part('#chatMore').fire('click');
  assert.equal(part('#chatMoreMenu').hidden, false);
  assert.equal(part('#chatMore').attrs['aria-expanded'], 'true');
  const items = walk(part('#chatMoreMenu')).filter((e) => e.attrs.role === 'menuitem');
  assert.deepEqual(items.map(text), ['Rename', 'Archive'], 'what the page offers (this sheet has no find)');
  items[1].attrs.onclick();
  assert.deepEqual(done, [['archive', S1]]);
  assert.equal(part('#chatMoreMenu').hidden, true, 'a choice closes it');
  assert.equal(part('#chatMore').attrs['aria-expanded'], 'false');
  part('#chatMore').fire('click');
  part('#chatMoreMenu').fire('keydown', { key: 'Escape', stopPropagation() {} });
  assert.equal(part('#chatMoreMenu').hidden, true);
  assert.equal(document.activeElement, part('#chatMore'));
  part('#chatMore').fire('click');
  pointerDown(new El());
  assert.equal(part('#chatMoreMenu').hidden, true, 'a press elsewhere closes it');
});

test('Configurações shows the monthly limit and what was used, from the same place as Home, and saves a new limit', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'GET /api/settings/reinforced-limit': () => ({ limitUSD: 20, spentUSD: 3 }), 'POST /api/settings/reinforced-limit': (body) => ({ limitUSD: body.usd }) });
  const toasts = [];
  const { api } = await import('../server/web/api.js');
  const { chat } = makeChat();
  openPart(chat);
  await settle();
  const { sheetCtl, dialog } = makeSettings({ toast: (m) => toasts.push(m), limit: { read: () => api.reinforcedLimit(), save: (usd) => api.setReinforcedLimit(usd) } });
  await sheetCtl.open(chat.settings());
  assert.ok(text(dialog).includes('run.limitUsed($3,$20)'));
  bySet(dialog, 'limit').value = '35';
  bySet(dialog, 'limit-save').attrs.onclick();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === '/api/settings/reinforced-limit' && c.method === 'POST').body, { usd: 35 });
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
  sse(stream, 'run', { run: { kind: 'talk' }, model: 'claude-opus-5-5', effort: 'high', level: 'ask-reinforce', why: 'sign in', estimateUSD: 4, costUSD: 0.1 }, 2);
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

test('each message session-map sends on its own says in words who sent it and why, and the notes can be opened', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Organize it');
  const NOTE = '[session-map: activity or03 (sonnet) ended - finished, cost US$ 1.20. Summary: done]';
  sse(streams.at(-1), 'user', { text: NOTE, auto: 'inbox' }, 1);
  sse(streams.at(-1), 'user', { text: '[session-map: tidy pass]', auto: 'tidy' }, 2);
  sse(streams.at(-1), 'user', { text: 'Go on with or03', auto: 'orchestrator' }, 3);
  sse(streams.at(-1), 'user', { text: '[session-map: the person opened the orchestrator]', auto: 'opening' }, 4);
  const shown = text(part('#chatLog'));
  for (const kind of ['inbox', 'tidy', 'orchestrator', 'opening']) assert.ok(shown.includes(`run.auto.${kind}`), kind);
  assert.ok(!shown.includes('run.autoAnswered'), 'those are not the answer to a reinforcing ask');
  assert.ok(shown.includes(NOTE), 'the note itself is there to read, folded under its words');
  const notes = walk(part('#chatLog')).filter((e) => e.tag === 'details' && /msg-auto/.test(e.attrs.class ?? ''));
  assert.equal(notes.length, 4);
});

test('the orchestrator: a first message starts it through its own route, and the list asked for is its own', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/orchestrator': () => ({ ok: true, chatKey: KEY, sessionId: null, started: true }), 'POST /api/chat/start': () => ({ chatKey: 'z'.repeat(32) }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Orchestrator', intro: 'intro', orchestrator: true, start: { node: { kind: 'orchestrator' } } });
  await settle();
  assert.ok(calls.some((c) => c.path.startsWith('/api/chat/list') && c.path.includes('kind=orchestrator')), 'its own list, not the whole project');
  await send(part, 'Tidy up the old chats');
  const start = calls.find((c) => c.path === '/api/chat/orchestrator');
  assert.deepEqual(start.body, { projectId: 'acme-shop', text: 'Tidy up the old chats' });
  assert.ok(!calls.some((c) => c.path === '/api/chat/start'), 'never as a plain chat');
});

test('a conversation a restart cut off says so, and Continue picks it up with one message; a finished one shows its summary', async () => {
  const { calls } = server({
    [`GET /api/chat/history/${S1}`]: () => ({ ...HISTORY, messages: [{ role: 'user', text: 'Second question' }], interrupted: true }),
    'POST /api/chat/start': () => ({ chatKey: KEY, mode: 'acceptEdits' }),
  });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'acme-shop', title: 'Second question', start: { sessionId: S1 } });
  await settle();
  assert.equal(part('#chatStatus').dataset.state, 'clash', 'the state line says so, in the cut-off colour');
  assert.equal(part('#chatDot').attrs['aria-label'], 'chat.state.interrupted', 'the header\'s dot says it');
  assert.equal(part('#chatDot').dataset.state, 'clash');
  const cont = walk(part('#chatLog')).find((e) => e.attrs['data-sig-act'] === 'continue');
  assert.ok(cont, 'the cut-off card offers Continue');
  cont.attrs.onclick();
  await settle();
  assert.deepEqual(calls.find((c) => c.path === '/api/chat/start').body.text, 'chat.continueText');
  assert.equal(part('#chatStatus').dataset.state, 'working');

  server({ [`GET /api/chat/history/${S2}`]: () => ({ ...HISTORY, sessionId: S2 }) });
  chat.open({ projectId: 'acme-shop', title: 'First', start: { sessionId: S2 } });
  await settle();
  assert.equal(part('#chatDot').attrs['aria-label'], 'chat.state.finished(Here it is.)');
});

test('a conversation from elsewhere leaves room for its messages on a 900 px screen', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const where = css.match(/\n\.chat-where \{([^}]*)\}/)?.[1] ?? '';
  assert.match(where, /display: flex/, 'the note and its button share one row');
});

test('on a phone a conversation opens tall, below the tabs, not squeezed under the map tools', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const phoneChat = [...css.matchAll(/@media \(max-width: 719px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n').match(/\n {2}\.chat \{([^}]*)\}/g)?.join(' ') ?? '';
  assert.match(phoneChat, /position: fixed/);
  assert.match(phoneChat, /top: 96px/, 'the same top as a conversation read in History');
});

test('the brain\'s line draws no stray empty child: a browser would write "null" there', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  await send(part, 'Fix it');
  sse(streams.at(-1), 'run', { run: { kind: 'talk' }, model: 'claude-opus-5-5', effort: 'high', brain: { phase: 'build', why: 'build' }, costUSD: 0 }, 1);
  for (const el of walk(part('#chatBrain'))) assert.ok(el.children.every((c) => c !== null && c !== undefined), `${el.tag}: no null child`);
});
