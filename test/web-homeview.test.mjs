// The Home screen (B6-T4, fd10): one row per project with its seven values, a click that opens the map, heads-up buttons
// that lead to the place that solves them. Drawn here on a tiny element tree, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHomeView } from '../server/web/homeview.js';
import { homeRows } from '../server/web/home.js';
import { waitingEntries } from '../server/web/views.js';
import { needsYou } from '../server/web/now.js';
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

test('"needs you" has the inbox\'s name and the amber pill\'s number; the decisions on the map are a quiet line of their own', () => {
  const { view, root, box } = make();
  view.render(root);
  const pill = needsYou(box.state);
  const t = translator('en');
  // The total on top is the pill's number, under the inbox group's name.
  const total = withClass(root, 'hm-totals')[0].children.find((c) => textOf(c).includes(t('convs.group.needs')));
  assert.ok(total, 'a total named like the inbox\'s group');
  assert.equal(textOf(withClass(total, 'hm-total-value')[0]), String(pill.length));
  assert.equal(textOf(root).includes('Waiting for you'), false, 'not the old name of a bigger count');
  assert.equal(t('home.col.waiting'), t('convs.group.needs'));
  // A row: as many conversations as the pill counts there, then its decisions on the map apart and quiet.
  const acme = box.state.projects.find((p) => (p.decisions ?? []).length && pill.some((e) => e.project.id === p.id));
  assert.ok(acme, 'the demo has a project with both');
  const needs = pill.filter((e) => e.project.id === acme.id).length;
  const decisions = waitingEntries(box.state, acme.id).filter((e) => e.decision).length;
  const cell = withClass(rowFor(root, acme.id), 'hm-waiting')[0];
  assert.equal(textOf(withClass(cell, 'hm-val')[0]).trim(), t.count('home.needsChats', needs));
  const sub = withClass(cell, 'hm-sub')[0];
  assert.ok(sub && textOf(sub).includes(t.count('home.mapDecisions', decisions)), 'the decisions on their own quiet line');
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

// ----- mm46: the card on top of Home with the monthly limit for big (reinforced) work -----
const tick = () => new Promise((resolve) => setImmediate(resolve));
function makeLimit({ limitUSD = 40, spentUSD = 12, rate = 1, fail = false, over = {} } = {}) {
  const box = { limitUSD, spentUSD, saved: [], toasts: [] };
  const limit = {
    read: async () => (fail ? { ok: false, error: 'boom' } : { ok: true, limitUSD: box.limitUSD, spentUSD: box.spentUSD }),
    save: async (usd) => { box.saved.push(usd); if (usd < 0) return { ok: false, error: 'bad-limit' }; box.limitUSD = usd; return { ok: true, limitUSD: usd }; },
  };
  const made = make({
    limit, currency: () => ({ label: 'US$', rate }), fmt: { money: (usd) => `$${(usd * rate).toFixed(2)}`, relative: (iso) => `ago ${iso.slice(0, 10)}` },
    toast: (m) => box.toasts.push(m), errorText: (code) => `err:${code}`, ...over,
  });
  return { ...made, box };
}
const cardOf = (root) => withClass(root, 'hm-limit')[0];
const fieldOf = (root) => walk(root).find((x) => x.tag === 'input' && x.attrs['data-hm'] === 'limit');
const saveOf = (root) => buttons(root).find((b) => b.attrs['data-hm'] === 'limit-save');

test('the card sits above the totals, with the question, the number, Save, the used line and a bar', async () => {
  const { view, root } = makeLimit();
  view.render(root);
  await tick();
  const card = cardOf(root);
  assert.ok(card, 'the card is there');
  const wrap = root.children[0];
  assert.ok(wrap.children.indexOf(card) < wrap.children.indexOf(withClass(root, 'hm-totals')[0]), 'above the totals');
  const text = textOf(card);
  assert.match(text, /How much the AI may spend per month on big jobs/);
  assert.match(text, /Used this month: \$12\.00 of \$40\.00/);
  assert.match(text, /counts only the big \(reinforced\) work/i);
  assert.equal(fieldOf(root).attrs.value, '40');
  assert.ok(saveOf(root));
  const bar = withClass(card, 'br-track')[0];
  assert.equal(bar.attrs.role, 'img');
  assert.equal(bar.children[0].attrs.style, 'width:30%');
});

test('the card speaks plain Portuguese for the owner', async () => {
  assert.equal(LANGS['pt-BR']['home.limit.title'], 'Quanto a IA pode gastar por mês em trabalhos grandes');
  assert.match(LANGS['pt-BR']['home.limit.used'], /^Usado este mês: \{used\} de \{limit\}$/);
});

test('with no limit it says the Autonomous way will stop to ask before each big job, and draws no bar', async () => {
  const { view, root } = makeLimit({ limitUSD: null });
  view.render(root);
  await tick();
  const card = cardOf(root);
  assert.match(textOf(card), /Autonomous way will stop to ask before each big job/);
  assert.equal(withClass(card, 'br-track').length, 0);
  assert.equal(fieldOf(root).attrs.value, '');
});

test('the bar warns near the limit and fills at most to the end', async () => {
  const warm = makeLimit({ limitUSD: 10, spentUSD: 9 });
  warm.view.render(warm.root);
  await tick();
  assert.match(withClass(cardOf(warm.root), 'hm-limit-status')[0].attrs.class, /tone-warn/);
  const over = makeLimit({ limitUSD: 10, spentUSD: 25 });
  over.view.render(over.root);
  await tick();
  assert.match(withClass(cardOf(over.root), 'hm-limit-status')[0].attrs.class, /tone-over/);
  assert.equal(withClass(cardOf(over.root), 'br-track')[0].children[0].attrs.style, 'width:100%');
});

test('Save sends the number the person typed and the card shows the new limit', async () => {
  const { view, root, box } = makeLimit();
  view.render(root);
  await tick();
  fieldOf(root).value = '55,5';
  saveOf(root).attrs.onclick();
  await tick();
  assert.deepEqual(box.saved, [55.5]);
  assert.match(textOf(cardOf(root)), /of \$55\.50/);
  assert.match(box.toasts.at(-1), /Limit saved: \$55\.50/);
});

test('an empty or wrong number is not saved: it says why', async () => {
  const { view, root, box } = makeLimit();
  view.render(root);
  await tick();
  for (const bad of ['', 'abc']) {
    fieldOf(root).value = bad;
    saveOf(root).attrs.onclick();
    await tick();
  }
  assert.deepEqual(box.saved, [], 'nothing was sent');
  assert.deepEqual(box.toasts, ['err:bad-limit', 'err:bad-limit']);
  const refused = makeLimit();
  refused.view.render(refused.root);
  await tick();
  fieldOf(refused.root).value = '-3';
  saveOf(refused.root).attrs.onclick();
  await tick();
  assert.deepEqual(refused.box.toasts, ['err:bad-limit'], 'the server answer is told as it came');
});

test('the field is in the owner\'s currency and Save converts back to dollars', async () => {
  const { view, root, box } = makeLimit({ limitUSD: 40, rate: 5 });
  view.render(root);
  await tick();
  assert.equal(fieldOf(root).attrs.value, '200');
  fieldOf(root).value = '100';
  saveOf(root).attrs.onclick();
  await tick();
  assert.deepEqual(box.saved, [20]);
});

test('a state update keeps the field the person is typing in', async () => {
  const { view, root, box } = makeLimit();
  view.render(root);
  await tick();
  const field = fieldOf(root);
  view.refresh(root);
  await tick();
  assert.equal(fieldOf(root), field, 'same element');
  box.spentUSD = 20;
  await view.refreshLimit();
  assert.equal(fieldOf(root), field, 'the field survives new numbers');
  assert.match(textOf(cardOf(root)), /Used this month: \$20\.00 of \$40\.00/);
});

test('no card in the demo, without the routes, or when the limit cannot be read it says so', async () => {
  const demoView = makeLimit({ over: { demo: true } });
  demoView.view.render(demoView.root);
  await tick();
  assert.equal(cardOf(demoView.root), undefined);
  const plain = make();
  plain.view.render(plain.root);
  await tick();
  assert.equal(cardOf(plain.root), undefined);
  const broken = makeLimit({ fail: true });
  broken.view.render(broken.root);
  await tick();
  assert.match(textOf(cardOf(broken.root)), /could not read/i);
  assert.equal(saveOf(broken.root), undefined);
});
