import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTabs } from '../server/web/tabs.js';
import { translator } from '../server/web/i18n.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));

// A tiny document: enough for the views to build, find by #id / .class / tag and fire handlers.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.handlers = {}; this.className = ''; this.hidden = false; this.value = ''; this.parent = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'object' ? k : Object.assign(new El('#text'), { text: String(k) }); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; }
  toggleAttribute() {}
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  focus() {}
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  get classList() { return { toggle() {}, add() {}, remove() {} }; }
  all() { return this.children.flatMap((c) => [c, ...(c.all?.() ?? [])]); }
  match(sel) {
    if (sel[0] === '#') return this.attrs.id === sel.slice(1);
    if (sel[0] === '.') return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tag === sel;
  }
  querySelector(sel) { return this.all().find((n) => n.match?.(sel)) ?? null; }
  querySelectorAll(sel) { return this.all().filter((n) => n.match?.(sel)); }
  get text() { return this._text ?? this.children.map((c) => c.text ?? '').join(''); }
  set text(v) { this._text = v; }
  set textContent(v) { this._text = v; }
  get textContent() { return this.text; }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'hidden') el.hidden = true;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

function setup({ saved = null, state = DEMO } = {}) {
  const calls = [];
  globalThis.document = { activeElement: null };
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ results: [] }) }; };
  const store = new Map(saved ? [['sm.convsTab', saved]] : []);
  const t = translator('en');
  const tabs = createTabs({
    h, t: () => t, lang: () => 'en', fmt: { money: String, shortDate: String, relative: String },
    state: () => state, project: () => state.projects[0], go() {}, toast() {}, errorText: String, confirm: async () => true,
    prefs: { archived: () => false, setArchived() {} }, range: () => null, rangeButton: () => h('button'),
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) },
  });
  return { tabs, calls, store, root: h('div'), t };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const paneOf = (root, id) => root.querySelector(`#${id}`);
const visible = (root) => ['convsBoard', 'convsHistory'].filter((id) => !paneOf(root, id).hidden);

test('render("convs") opens the saved sub-tab, and the board when nothing was saved', async () => {
  const a = setup();
  a.tabs.render('convs', a.root);
  assert.deepEqual(visible(a.root), ['convsBoard']);
  const b = setup({ saved: 'history' });
  b.tabs.render('convs', b.root);
  await tick();
  assert.deepEqual(visible(b.root), ['convsHistory']);
  const c = setup({ saved: 'nonsense' });
  c.tabs.render('convs', c.root);
  assert.deepEqual(visible(c.root), ['convsBoard'], 'an unknown saved value falls back to the board');
});

test('the old names board and history open the right sub-tab and remember it', async () => {
  const a = setup({ saved: 'history' });
  a.tabs.render('board', a.root);
  assert.deepEqual(visible(a.root), ['convsBoard']);
  assert.equal(a.store.get('sm.convsTab'), 'board');
  const b = setup();
  b.tabs.render('history', b.root);
  await tick();
  assert.deepEqual(visible(b.root), ['convsHistory']);
  assert.equal(b.store.get('sm.convsTab'), 'history');
});

test('the sub-tabs are labelled with the existing board and history words', () => {
  const a = setup();
  a.tabs.render('convs', a.root);
  const labels = a.root.querySelectorAll('.sub-tab').map((b) => b.text);
  assert.deepEqual(labels, [a.t('tab.board'), a.t('tab.history')]);
  assert.equal(a.root.querySelector('.convs-tabs').attrs.role, 'tablist');
});

test('switching sub-tabs does not fetch the history again', async () => {
  const a = setup();
  a.tabs.render('convs', a.root);
  assert.equal(a.calls.filter((u) => u.includes('/api/history')).length, 0, 'the board needs no search');
  const [board, history] = a.root.querySelectorAll('.sub-tab');
  history.handlers.click();
  await tick();
  assert.equal(a.calls.filter((u) => u.includes('/api/history')).length, 1);
  board.handlers.click();
  history.handlers.click();
  board.handlers.click();
  await tick();
  assert.equal(a.calls.filter((u) => u.includes('/api/history')).length, 1, 'coming back reuses the list');
  assert.deepEqual(visible(a.root), ['convsBoard']);
  assert.equal(a.store.get('sm.convsTab'), 'board');
});

test('the board project filter still works inside the sub-tab', () => {
  const a = setup();
  a.tabs.render('convs', a.root);
  const select = a.root.querySelector('select');
  assert.ok(select, 'the filter is there');
  const countBefore = a.root.querySelectorAll('.card').length;
  select.handlers.change({ target: { value: '*' } });
  assert.ok(a.root.querySelectorAll('.card').length >= countBefore);
  assert.ok(paneOf(a.root, 'convsBoard').querySelector('.board'), 'the board is redrawn in place');
  const sub = a.root.querySelectorAll('.sub-tab');
  assert.equal(sub.length, 2, 'the sub-tabs survive the redraw');
});

test('polling refreshes the board but leaves the history alone', async () => {
  const a = setup();
  a.tabs.render('convs', a.root);
  const before = paneOf(a.root, 'convsBoard').children[0];
  a.tabs.refresh('convs', a.root);
  assert.notEqual(paneOf(a.root, 'convsBoard').children[0], before, 'the board is redrawn');
  a.root.querySelectorAll('.sub-tab')[1].handlers.click();
  await tick();
  const n = a.calls.length;
  a.tabs.refresh('convs', a.root);
  a.tabs.refresh('history', a.root);
  await tick();
  assert.equal(a.calls.length, n, 'refresh never searches again');
});

test('costs still renders on its own', () => {
  const a = setup();
  a.tabs.render('costs', a.root);
  assert.ok(a.root.querySelector('.ledger'));
});

// sb05: the savings report in the Costs tab.
test('costs shows the cost by model and the savings tips in plain words, and says so when there are none', () => {
  const state = JSON.parse(JSON.stringify(DEMO));
  const p = state.projects[0];
  p.costByModel = { '2026-10-08': { 'claude-opus-5-5': 7, 'claude-sonnet-5-5': 1 } };
  p.chats[0].updatedAt = '2026-10-08T10:00:00.000Z';
  p.chats[0].advice = { replies: 80, context: 300000, tips: [
    { kind: 'newChat', savingUSD: 2 },
    { kind: 'smallerModel', from: 'claude-opus-5-5', to: 'claude-sonnet-5-5', savingUSD: 3 },
  ] };
  const a = setup({ state });
  a.tabs.render('costs', a.root);
  const box = a.root.querySelector('#savings');
  assert.ok(box, 'the savings section exists');
  assert.equal(box.querySelectorAll('.tip-row').length, 2);
  assert.match(box.text, /Opus 5\.5/);
  assert.match(box.text, /Sonnet 5\.5/);
  assert.match(box.text, /new one/i);
  assert.equal(a.root.querySelectorAll('.model-row').length, 2);
  assert.doesNotMatch(box.text, /undefined|\{\w+\}/);
  const bare = JSON.parse(JSON.stringify(DEMO));
  for (const q of bare.projects) for (const c of q.chats) delete c.advice;
  const b = setup({ state: bare });
  b.tabs.render('costs', b.root);
  assert.equal(b.root.querySelectorAll('.tip-row').length, 0);
  assert.match(b.root.querySelector('#savings').text, /Nothing to suggest/);
});

test('costs labels the savings total as the whole life of the conversations active in the period', () => {
  const state = JSON.parse(JSON.stringify(DEMO));
  const c = state.projects[0].chats[0];
  c.updatedAt = '2026-10-08T10:00:00.000Z';
  c.advice = { replies: 400, context: 300000, tips: [{ kind: 'newChat', savingUSD: 40 }] };
  const a = setup({ state });
  a.tabs.render('costs', a.root);
  const box = a.root.querySelector('#savings');
  assert.match(box.text, /active in this period/i);
  assert.match(box.text, /whole life/i);
});
