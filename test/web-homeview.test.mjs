// The Home screen (B6-T4, fd10): one row per project with its seven values, a click that opens the map, heads-up buttons
// that lead to the place that solves them. Drawn here on a tiny element tree, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHomeView } from '../server/web/homeview.js';
import { homeRows } from '../server/web/home.js';
import { waitingEntries } from '../server/web/views.js';
import { LANGS, translator } from '../server/web/i18n.js';

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const demo = () => JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const read = (over = {}) => ({
  census: { rev: 3, files: 40, lines: 900, noOwner: 0 }, read: { percent: 100 }, uptodate: { confirmed: 8, warning: 0, unverified: 1 },
  health: { score: 90 }, version: { code: '1.0.0', mismatch: false }, care: 'suggest', updatedAt: '2026-10-09T10:00:00.000Z', ...over,
});
const chat = (sessionId, status, updatedAt, waiting = {}) => ({
  sessionId, status, archived: false, updatedAt, waiting: { strong: false, weak: false, items: [], ...waiting },
});
const MINE = 'garden-planner-aa11bb';
function handmade() {
  return {
    id: MINE, name: 'Garden planner', decisions: [], activity: [{ kind: 'commit', ts: '2026-10-08T08:00:00.000Z' }],
    chats: [chat('a', 'busy', '2026-10-09T09:30:00.000Z'), chat('c', 'idle', '2026-10-09T11:15:00.000Z', { strong: true })],
    costByDay: { '2026-09-30': 9, '2026-10-01': 1.25, '2026-10-05': 0.5, '2026-10-09': 2.25 },
    foundation: read({ version: { code: '0.4.0', mismatch: true }, health: { score: 90 } }),
  };
}
function threeProjects() {
  const state = demo();
  state.projects.forEach((p, i) => { p.foundation = i === 0 ? read({ health: { score: 72 } }) : null; });
  state.projects.push(handmade());
  return state;
}

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const buttons = (n) => walk(n).filter((x) => x.tag === 'button');
const withClass = (n, cls) => walk(n).filter((x) => (x.attrs.class ?? '').split(/\s+/).includes(cls));
const rowsOf = (root) => withClass(root, 'hm-item');
const rowFor = (root, id) => rowsOf(root).find((r) => r.attrs['data-id'] === id);

function make(over = {}) {
  const calls = { open: [], go: [], read: [] };
  const box = { state: threeProjects() };
  const ctx = {
    h, icon, t: translator('en'), fmt: { money: (usd) => `$${usd.toFixed(2)}`, relative: (iso) => `ago ${iso.slice(0, 10)}` },
    state: () => box.state, now: () => NOW,
    openProject: (id) => calls.open.push(id), goTo: (area, sub) => calls.go.push([area, sub ?? null]),
    refreshFoundation: (id) => calls.read.push(id), demo: false, ...over,
  };
  return { view: createHomeView(ctx), root: h('div'), calls, box, ctx };
}

test('three projects give three rows, each with its seven values in the text', () => {
  const { view, root, box } = make();
  view.render(root);
  assert.equal(rowsOf(root).length, 3);
  const mine = rowFor(root, MINE);
  const text = textOf(mine);
  assert.match(text, /Garden planner/);
  assert.match(text, /0\.4\.0/, 'version');
  assert.match(text, /90/, 'health score');
  assert.match(text, /8 confirmed/, 'up to date');
  assert.match(text, /\$4\.00/, 'month cost: 1.25 + 0.5 + 2.25 written by hand');
  assert.match(text, /ago 2026-10-09/, 'last activity');
  const waiting = waitingEntries(box.state, MINE).length;
  assert.ok(waiting > 0);
  assert.match(textOf(withClass(mine, 'hm-waiting')[0]), new RegExp(`\\b${waiting}\\b`), 'waiting for you');
  assert.match(textOf(withClass(mine, 'hm-working')[0]), /\b1\b/, 'one conversation working');
  const order = homeRows(box.state, { nowMs: NOW }).map((r) => r.id);
  assert.deepEqual(rowsOf(root).map((r) => r.attrs['data-id']), order, 'same order as homeRows');
});

test('a click on the project opens its map, and the row has one target only', () => {
  const { view, root, calls } = make();
  view.render(root);
  const opens = buttons(rowFor(root, MINE)).filter((b) => b.attrs['data-hm'] === 'open');
  assert.equal(opens.length, 1);
  assert.ok(textOf(opens[0]).includes('Garden planner'));
  opens[0].attrs.onclick();
  assert.deepEqual(calls.open, [MINE]);
  for (const b of buttons(root)) assert.equal(buttons(b).length, 1, 'no button inside a button');
});

test('a project not read yet says so, never a zero, and offers Read now', () => {
  const { view, root, calls, box } = make();
  view.render(root);
  const unread = box.state.projects.find((p) => p.foundation === null);
  const row = rowFor(root, unread.id);
  const text = textOf(row);
  assert.match(text, /Not read yet/);
  assert.doesNotMatch(text, /\/100|0 confirmed/, 'no invented numbers');
  const now = buttons(row).find((b) => /Read now/.test(textOf(b)));
  assert.ok(now);
  now.attrs.onclick();
  assert.deepEqual(calls.read, [unread.id]);
});

test('in the demo the Read now button is not offered', () => {
  const { view, root } = make({ demo: true });
  view.render(root);
  assert.equal(buttons(root).filter((b) => /Read now/.test(textOf(b))).length, 0);
  assert.match(textOf(root), /Not read yet/);
});

test('a heads-up button takes the person to the place that solves it', () => {
  const { view, root, calls } = make();
  view.render(root);
  const go = buttons(rowFor(root, MINE)).find((b) => /See versions/.test(textOf(b)));
  assert.ok(go, 'the version clash has its button');
  go.attrs.onclick();
  assert.deepEqual(calls.go, [['health', 'versions']]);
  assert.deepEqual(calls.open, [], 'the heads-up is not the row target');
});

test('refresh keeps the rows that did not change and redraws only the one that did', () => {
  const { view, root, box } = make();
  view.render(root);
  const before = new Map(rowsOf(root).map((r) => [r.attrs['data-id'], r]));
  view.refresh(root);
  for (const r of rowsOf(root)) assert.equal(r, before.get(r.attrs['data-id']), 'same element');
  box.state.projects.find((p) => p.id === MINE).costByDay['2026-10-09'] = 5;
  view.refresh(root);
  const after = new Map(rowsOf(root).map((r) => [r.attrs['data-id'], r]));
  assert.notEqual(after.get(MINE), before.get(MINE));
  assert.match(textOf(after.get(MINE)), /\$6\.75/);
  for (const [id, r] of before) if (id !== MINE) assert.equal(after.get(id), r);
});

test('no projects shows what to do; no state yet shows skeleton rows', () => {
  const empty = make();
  empty.box.state = { ...threeProjects(), projects: [] };
  empty.view.render(empty.root);
  assert.match(textOf(empty.root), /Open Claude Code in a folder of your project and it shows up here/);
  assert.equal(rowsOf(empty.root).length, 0);
  const loading = make();
  loading.box.state = null;
  loading.view.render(loading.root);
  assert.ok(withClass(loading.root, 'skeleton').length > 0);
  assert.equal(rowsOf(loading.root).length, 0);
});

test('the header carries the totals', () => {
  const { view, root, box } = make();
  view.render(root);
  const head = withClass(root, 'hm-totals')[0];
  assert.ok(head);
  const text = textOf(head);
  assert.match(text, /\b3\b/, 'projects');
  const month = homeRows(box.state, { nowMs: NOW }).reduce((s, r) => s + r.monthCost.usd, 0);
  assert.ok(text.includes(`$${month.toFixed(2)}`), 'month cost');
});

test('the words the screen asks for exist in both languages with the same blanks', () => {
  const source = readFileSync(new URL('../server/web/homeview.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/\bt\(\s*'([\w.-]+)'/g)].map((m) => m[1]));
  assert.ok(keys.size >= 15);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of keys) {
    assert.ok(k in LANGS.en && k in LANGS['pt-BR'], k);
    assert.deepEqual(vars(LANGS['pt-BR'][k]), vars(LANGS.en[k]), k);
  }
  assert.doesNotMatch(source, /\bdocument\./, 'the view works on the root it is given');
});
