// The chat screen as Claude Code shows it (mind-map-page mm22): every step, search and jump, the live mirror and the full
// composer (images, @ files, / commands, Esc, plan mode, task list, edits to accept or reject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../server/web/chat.js';

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
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.dataset = {};
    this.classes = new Set(String(this.attrs.class ?? '').split(' ').filter(Boolean));
    this.classList = { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), contains: (c) => this.classes.has(c) };
    this.scrolled = 0;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, evt = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...evt }); }
  replaceChildren(...cs) { this.children = cs; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  getBoundingClientRect() { this.scrolled++; return { top: 100, height: 20 }; }
  focus() {}
  click() { this.fire('click'); }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const walk = (el, out = []) => {
  if (el instanceof El) { out.push(el); for (const c of el.children) walk(c, out); }
  return out;
};
const text = (el) => walk(el).flatMap((e) => e.children.filter((c) => typeof c === 'string')).join(' ');

const ROLES = ['log', 'form', 'input', 'send', 'stop', 'title', 'context', 'status', 'mode', 'list', 'note', 'pcmode', 'close', 'where', 'run', 'runpanel',
  'find', 'tasks', 'attach', 'filepick', 'pending', 'suggest'];
function sheet() {
  const parts = new Map(ROLES.map((r) => [r, new El()]));
  const root = new El();
  root.hidden = true;
  root.querySelector = (sel) => parts.get(/data-chat="(\w+)"/.exec(sel)?.[1]);
  return { root, part: (r) => parts.get(r) };
}

globalThis.document ??= { activeElement: null, contains: () => false };

const S1 = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(32);

function server(routes) {
  const calls = [];
  globalThis.fetch = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    const hit = Object.entries(routes).find(([prefix]) => `${init.method ?? 'GET'} ${path}`.startsWith(prefix));
    const data = hit ? hit[1](body, path) : { error: 'not-found' };
    // Through JSON, as a real response: every answer brings new objects.
    return { ok: !data.error, status: data.error ? 404 : 200, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  const streams = [];
  globalThis.EventSource = class { constructor(url) { this.url = url; this.listeners = {}; streams.push(this); } addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } close() { this.closed = true; } };
  return { calls, streams };
}
const emit = (stream, type, data, id) => { for (const fn of stream.listeners[type] ?? []) fn({ data: JSON.stringify(data), lastEventId: String(id) }); };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const tt = () => (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

function makeChat(extra = {}) {
  const s = sheet();
  const timers = [];
  const toasts = [];
  const chat = createChat({
    root: s.root, h, t: tt, toast: (m) => toasts.push(m), errorText: (e) => e, storage: null, savedKey: null, relative: () => 'now',
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    ...extra,
  });
  return { chat, ...s, timers, toasts };
}

const ITEMS = [
  { type: 'user', text: 'Fix the **checkout**', ts: '2026-10-08T10:00:00.000Z' },
  { type: 'tool', id: 't1', name: 'Bash', step: { kind: 'run', target: 'npm test' }, input: '{"command":"npm test"}', result: 'checkout ok', isError: false, ts: '2026-10-08T10:01:00.000Z' },
  { type: 'tool', id: 't2', name: 'TodoWrite', step: { kind: 'plan', target: '' }, input: '{}', result: 'ok', isError: false, todos: [{ text: 'Test', status: 'completed', active: 'Testing' }, { text: 'Ship', status: 'in_progress', active: 'Shipping' }], ts: '2026-10-09T09:00:00.000Z' },
  { type: 'assistant', text: 'All **green**.', ts: '2026-10-09T09:05:00.000Z', replyCostUSD: 0.25 },
];
const HISTORY = { sessionId: S1, title: 'Fix the checkout', mode: 'settings', chatKey: null, settings: { mode: 'default', downgraded: false }, messages: [], items: ITEMS, version: 'v1' };
const openOld = (chat) => chat.open({ projectId: 'shop', title: 'Fix the checkout', start: { sessionId: S1 } });

test('a reopened conversation shows every step with markdown, a line per day and the cost of the reply', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  const log = part('log');
  assert.ok(walk(log).some((e) => e.tag === 'strong' && e.children.includes('checkout')), 'markdown, not raw stars');
  assert.ok(walk(log).some((e) => e.tag === 'details' && text(e).includes('step.done.run(npm test)')), 'the step folds open');
  assert.equal(walk(log).filter((e) => e.attrs.role === 'separator').length, 2, 'one date line per day');
  assert.match(text(log), /chat\.replyCost/);
});

test('search finds inside the conversation and steps through the hits; the jump list goes to a day', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  const find = part('find');
  const search = walk(find).find((e) => e.tag === 'input');
  search.value = 'checkout';
  search.fire('input');
  assert.match(text(find), /chat\.findCount\(1,2\)/);
  const hits = walk(part('log')).filter((e) => e.tag === 'li' && e.classes.has('is-hit'));
  assert.equal(hits.length, 2);
  search.fire('keydown', { key: 'Enter' });
  assert.match(text(find), /chat\.findCount\(2,2\)/);
  const jump = walk(find).find((e) => e.tag === 'select');
  const dayOption = walk(jump).find((e) => e.tag === 'option' && e.attrs.value !== '');
  jump.value = dayOption.attrs.value;
  jump.fire('change');
  assert.ok(walk(part('log')).some((e) => e.attrs.role === 'separator' && e.scrolled > 0), 'scrolled to the day');
});

test('the task list of the conversation sits above the box, with the step being done now', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => HISTORY });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  assert.equal(part('tasks').hidden, false);
  assert.match(text(part('tasks')), /chat\.tasks\(1,2\)/);
  assert.match(text(part('tasks')), /Shipping/);
});

test('a conversation still running in VS Code is mirrored: new steps appear, and the mirror stops when it ends', async () => {
  let answer = { ...HISTORY, readOnly: true, live: true };
  const { calls } = server({ [`GET /api/chat/history/${S1}`]: () => answer });
  const { chat, part, timers } = makeChat();
  openOld(chat);
  await settle();
  assert.equal(timers.length, 1, 'asks again in a moment');
  assert.match(text(part('find')), /chat.mirrorShort/, 'says it is live');
  answer = { ok: true, same: true, version: 'v1' };
  await timers[0].fn();
  assert.ok(calls.at(-1).path.endsWith('?since=v1'), 'only what changed');
  assert.equal(timers.length, 2);
  const stepBefore = part('log').children.find((li) => li.classes.has('msg-tool'));
  answer = { ...HISTORY, readOnly: true, live: false, version: 'v2', costUSD: 0.75, items: [...ITEMS, { type: 'assistant', text: 'One more thing.', ts: '2026-10-09T09:06:00.000Z' }] };
  await timers[1].fn();
  assert.match(text(part('log')), /One more thing/);
  assert.ok(part('log').children.includes(stepBefore), 'a step that did not change keeps its node, so a step the person opened stays open');
  assert.equal(timers.length, 2, 'it ended: no more asking');
  assert.match(text(part('run')), /US\$ 0\.75/, 'the total at the top follows');
  assert.doesNotMatch(text(part('find')), /chat.mirrorShort/);
  chat.close();
});

test('closing the sheet stops the mirror', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => ({ ...HISTORY, readOnly: true, live: true }) });
  const { chat, timers } = makeChat();
  openOld(chat);
  await settle();
  chat.close();
  assert.equal(timers[0].cancelled, true);
});

test('pasted images go with the message, at most four', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [] }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part, toasts } = makeChat({ readImage: async (file) => ({ media: file.type, data: 'AAAA' }) });
  chat.open({ projectId: 'shop', title: 'New', start: { node: { kind: 'part', partId: 'cart' } } });
  await settle();
  const png = { kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 10 }) };
  part('input').fire('paste', { clipboardData: { items: [png] } });
  await settle();
  assert.equal(walk(part('pending')).filter((e) => e.tag === 'img').length, 1);
  part('input').fire('paste', { clipboardData: { items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => ({ type: 'application/pdf', size: 10 }) }] } });
  await settle();
  assert.equal(toasts.at(-1), 'chat.attachOnlyImages');
  part('input').value = 'What is wrong here?';
  part('form').fire('submit');
  await settle();
  const start = calls.find((c) => c.path === '/api/chat/start');
  assert.deepEqual(start.body.images, [{ media: 'image/png', data: 'AAAA' }]);
  assert.equal(walk(part('pending')).filter((e) => e.tag === 'img').length, 0, 'sent: the tray is empty again');
});

test('@ lists project files and / lists the commands; Enter puts the choice in the message', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => ({ chats: [] }), 'GET /api/files/shop': () => ({ files: ['src/checkout.ts', 'src/cart.ts'] }) });
  const { chat, part } = makeChat({ commands: () => [{ name: '/review', description: 'Review the diff' }, { name: '/plan', description: 'Plan' }], debounceMs: 0 });
  chat.open({ projectId: 'shop', title: 'New', start: { node: { kind: 'part', partId: 'cart' } } });
  await settle();
  const input = part('input');
  input.value = 'Look at @chec';
  input.selectionStart = input.selectionEnd = input.value.length;
  input.fire('input');
  await settle();
  await settle();
  assert.ok(calls.some((c) => c.path === '/api/files/shop?find=chec'));
  assert.equal(part('suggest').hidden, false);
  assert.match(text(part('suggest')), /src\/checkout\.ts/);
  input.fire('keydown', { key: 'Enter' });
  assert.equal(input.value, 'Look at @src/checkout.ts ');
  assert.equal(part('suggest').hidden, true);

  input.value = '/rev';
  input.selectionStart = input.selectionEnd = 4;
  input.fire('input');
  await settle();
  assert.match(text(part('suggest')), /\/review/);
  assert.doesNotMatch(text(part('suggest')), /\/plan/);
  input.fire('keydown', { key: 'Tab' });
  assert.equal(input.value, '/review ');
});

test('Esc stops a running reply; the arrow up brings back the last message; plan mode is offered', async () => {
  const { calls, streams } = server({ 'GET /api/chat/list': () => ({ chats: [] }), 'POST /api/chat/start': () => ({ chatKey: KEY }), [`POST /api/chat/${KEY}/stop`]: () => ({}) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'shop', title: 'New', start: { node: { kind: 'part', partId: 'cart' } } });
  await settle();
  assert.ok(walk(part('mode')).some((e) => e.tag === 'option' && e.attrs.value === 'plan'), 'plan mode in the picker');
  part('input').value = 'Do it';
  part('form').fire('submit');
  await settle();
  emit(streams[0], 'user', { text: 'Do it' }, 1);
  part('input').fire('keydown', { key: 'Escape' });
  await settle();
  assert.ok(calls.some((c) => c.path === `/api/chat/${KEY}/stop`));
  part('input').value = '';
  part('input').fire('keydown', { key: 'ArrowUp' });
  assert.equal(part('input').value, 'Do it');
});

test('an edit waiting for permission shows before and after, to accept or reject', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => ({ chats: [] }), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  chat.open({ projectId: 'shop', title: 'New', start: { node: { kind: 'part', partId: 'cart' } } });
  await settle();
  part('input').value = 'Rename it';
  part('form').fire('submit');
  await settle();
  emit(streams[0], 'user', { text: 'Rename it' }, 1);
  emit(streams[0], 'permission', { requestId: 'r1', state: 'asked', toolName: 'Edit', input: '{}', diff: { path: 'a.ts', hunks: [{ before: 'old', after: 'new' }] } }, 2);
  const card = walk(part('log')).find((e) => e.tag === 'li' && e.classes.has('msg-permission'));
  assert.ok(walk(card).some((e) => e.classes.has('diff-del')) && walk(card).some((e) => e.classes.has('diff-add')));
  const labels = walk(card).filter((e) => e.tag === 'button').map(text);
  assert.ok(labels.includes('chat.accept') && labels.includes('chat.reject'));
});
