import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestsView, reviewKey, reviewQueue } from '../server/web/requestsview.js';
import { requestsOf } from '../server/web/requests.js';
import { translator } from '../server/web/i18n.js';

// mm27: the Requests tab's review, one request at a time with Keep, Later, Discard and Close. Drawn on a tiny element tree,
// without a browser (scripts/smoke-browser.mjs looks at the real page).

const item = (code, title, detail, status = 'todo') => ({ code, title, detail, status });
const registry = {
  id: 'ideas', name: 'Ideas', groups: [{ name: 'All', items: [
    item('id01', 'Parked one', ['Asked: 2026-10-01 10:00 — "a"', 'Where it went: `al01`.', 'Status: later (waiting).']),
    item('id02', 'Being done', ['Asked: 2026-10-02 10:00 — "b"', 'Where it went: `al02`.', 'Status: in progress.']),
    item('id03', 'Finished work', ['Asked: 2026-10-03 10:00 — "c"', 'Where it went: `al03`.', 'Status: accepted.']),
    item('id04', 'No item yet', ['Asked: 2026-10-04 10:00 — "d"', 'Status: new.']),
    item('id05', 'Closed long ago', ['Asked: 2026-10-05 10:00 — "e"', 'Status: done.'], 'done'),
  ] }],
};
const alpha = { id: 'alpha', name: 'Alpha', groups: [{ name: '', items: [item('al01', 'One', [], 'todo'), item('al02', 'Two', [], 'doing'), item('al03', 'Three', [], 'done')] }] };
const project = { id: 'p1', name: 'P', arch: { parts: [registry, alpha] } };
const rowsOf = (p = project) => requestsOf(p).list.map((r) => ({ p, r }));

test('the queue puts what can be closed first, then what has no work, then what is being done, then what was parked', () => {
  assert.deepEqual(reviewQueue(rowsOf()).map(({ r }) => r.code), ['id03', 'id04', 'id02', 'id01']);
  assert.ok(!reviewQueue(rowsOf()).some(({ r }) => r.code === 'id05'), 'a closed request is not reviewed');
  const decided = new Set([reviewKey(project, { code: 'id03' }), reviewKey(project, { code: 'id02' })]);
  assert.deepEqual(reviewQueue(rowsOf(), decided).map(({ r }) => r.code), ['id04', 'id01']);
  assert.deepEqual(reviewQueue([]), []);
});

// ---- the view on a tiny element tree ----
const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({
  tag, attrs: attrs ?? {}, children: kids(children), classList: { toggle() {}, contains: () => false },
  replaceChildren(...c) { this.children = kids(c); },
  querySelector(sel) { return walk(this).find((n) => n.attrs.class?.split(' ').includes(sel.slice(1))) ?? null; },
  focus() {},
});
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const buttons = (root) => walk(root).filter((n) => n.tag === 'button');
const button = (root, label) => buttons(root).find((b) => textOf(b).trim() === label);

function setup({ api, look = false } = {}) {
  const toasts = [];
  const calls = [];
  globalThis.document = { activeElement: null };
  const view = createRequestsView({
    h, icon: () => h('svg'), t: () => translator('en'), lang: () => 'en', state: () => ({ projects: [project] }), project: () => project,
    openItem: () => {}, look: () => look, toast: (m) => toasts.push(m), errorText: (code) => `error:${code}`,
    api: { requestStatus: async (...args) => { calls.push(args); return (api ?? (() => ({ ok: true, changed: true })))(...args); } },
  });
  const root = h('div');
  view.render(root);
  return { root, view, toasts, calls };
}

test('the review opens from the list, shows the request that can be closed first and offers Close, Keep, Later and Discard', () => {
  const { root } = setup();
  assert.ok(button(root, 'Review one by one'));
  button(root, 'Review one by one').attrs.onclick();
  assert.match(textOf(root), /1 of 4/);
  assert.match(textOf(root), /Finished work/);
  assert.match(textOf(root), /Everything it became is done: it can be closed\./);
  assert.deepEqual(['Close it', 'Keep', 'Later', 'Discard'].map((l) => Boolean(button(root, l))), [true, true, true, true]);
  button(root, 'Back to the list').attrs.onclick();
  assert.ok(button(root, 'Review one by one'), 'the list is back');
});

test('Keep moves on without writing; Later and Close ask the server and move on; the count follows', async () => {
  const { root, calls, toasts } = setup();
  button(root, 'Review one by one').attrs.onclick();
  button(root, 'Close it').attrs.onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [['p1', 'id03', 'done', undefined]]);
  assert.deepEqual(toasts, ['id03 was closed.']);
  assert.match(textOf(root), /2 of 4/);
  assert.match(textOf(root), /No item yet/);
  assert.ok(!button(root, 'Close it'), 'Close appears only when the work is done');
  button(root, 'Keep').attrs.onclick();
  assert.equal(calls.length, 1, 'Keep writes nothing');
  assert.match(textOf(root), /3 of 4/);
  assert.match(textOf(root), /Being done/);
  button(root, 'Later').attrs.onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls[1], ['p1', 'id02', 'later', undefined]);
  assert.match(textOf(root), /Parked one/);
  assert.ok(!button(root, 'Later'), 'a parked request is not offered Later again');
  button(root, 'Keep').attrs.onclick();
  assert.match(textOf(root), /Nothing left to review/);
});

test('Discard asks for a reason first: the button waits for words, then sends them; Cancel changes nothing', async () => {
  const { root, calls } = setup();
  button(root, 'Review one by one').attrs.onclick();
  button(root, 'Discard').attrs.onclick();
  const input = walk(root).find((n) => n.attrs.name === 'req-reason');
  assert.ok(input);
  const go = button(root, 'Discard it');
  assert.equal(go.attrs.disabled, true, 'no reason, no discard');
  input.attrs.oninput({ target: { value: '  ' } });
  input.attrs.oninput({ target: { value: 'replaced by the mind map' } });
  button(root, 'Discard it').attrs.onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [['p1', 'id03', 'discarded', 'replaced by the mind map']]);
  assert.ok(!walk(root).some((n) => n.attrs.name === 'req-reason'), 'the box is gone after the decision');
  button(root, 'Discard').attrs.onclick();
  button(root, 'Cancel').attrs.onclick();
  assert.equal(calls.length, 1);
  assert.ok(button(root, 'Keep'));
});

test('a refusal is said in plain words and the request stays; look-only says where to change it; a look-only link has no review', async () => {
  const refused = setup({ api: () => ({ ok: false, error: 'busy' }) });
  button(refused.root, 'Review one by one').attrs.onclick();
  button(refused.root, 'Later').attrs.onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(refused.toasts, ['error:busy']);
  assert.match(textOf(refused.root), /1 of 4/, 'still the first one');
  const looked = setup({ api: () => ({ ok: false, error: 'look-only' }) });
  button(looked.root, 'Review one by one').attrs.onclick();
  button(looked.root, 'Later').attrs.onclick();
  await new Promise((r) => setImmediate(r));
  assert.match(looked.toasts[0], /Nothing was written: this project is on “look only”/);
  assert.equal(button(setup({ look: true }).root, 'Review one by one'), undefined, 'the look-only link only reads');
});
