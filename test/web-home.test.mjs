// The rows of the Home (B6-T3, fd10): one per project with seven values, plus at most two heads-ups. Pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeRows, attentionOf, homeTotals, healthTone } from '../server/web/home.js';
import { waitingEntries } from '../server/web/views.js';
import { clashKey } from '../server/web/signals.js';
import { LANGS } from '../server/web/i18n.js';

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const demo = () => JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const read = (over = {}) => ({
  census: { rev: 3, files: 40, lines: 900, noOwner: 0 }, read: { percent: 100 }, uptodate: { confirmed: 8, warning: 0, unverified: 1 },
  health: { score: 90 }, version: { code: '1.0.0', mismatch: false }, care: 'suggest', updatedAt: '2026-10-09T10:00:00.000Z', ...over,
});
const quietChat = (sessionId, status, updatedAt, waiting = {}) => ({
  sessionId, status, archived: false, updatedAt, waiting: { strong: false, weak: false, items: [], ...waiting },
});

// A project written by hand, so the expected numbers come from this file and not from the code under test.
function handmade() {
  return {
    id: 'garden-planner-aa11bb', name: 'Garden planner', decisions: [], activity: [{ kind: 'commit', ts: '2026-10-08T08:00:00.000Z' }],
    chats: [
      quietChat('a', 'busy', '2026-10-09T09:30:00.000Z'),
      { ...quietChat('b', 'busy', '2026-10-09T09:31:00.000Z'), archived: true },
      quietChat('c', 'idle', '2026-10-09T11:15:00.000Z', { strong: true }),
      quietChat('d', 'idle', '2026-10-07T11:15:00.000Z', { weak: true }),
    ],
    costByDay: { '2026-09-30': 9, '2026-10-01': 1.25, '2026-10-05': 0.5, '2026-10-09': 2.25 },
    foundation: read({ version: { code: '0.4.0', mismatch: true } }),
  };
}
function threeProjects() {
  const state = demo();
  state.projects.forEach((p, i) => { p.foundation = i === 0 ? read({ health: { score: 72 } }) : null; });
  state.projects.push(handmade());
  return state;
}
const rowOf = (rows, id) => rows.find((r) => r.id === id);

test('three projects give three rows, each with the seven values of fd10', () => {
  const rows = homeRows(threeProjects(), { nowMs: NOW });
  assert.equal(rows.length, 3);
  for (const r of rows) {
    for (const key of ['version', 'health', 'uptodate', 'working', 'waiting', 'monthCost', 'lastActivity']) assert.ok(key in r, `${r.id} lacks ${key}`);
    assert.equal(typeof r.name, 'string');
  }
  const h = rowOf(rows, 'garden-planner-aa11bb');
  assert.deepEqual(h.version, { code: '0.4.0', mismatch: true });
  assert.deepEqual(h.health, { score: 90, tone: 'good' });
  assert.deepEqual(h.uptodate, { confirmed: 8, warning: 0, unverified: 1 });
});

test('a project not read yet has no version, health or up-to-date numbers, and says so instead of showing zero', () => {
  const state = threeProjects();
  const id = state.projects[1].id;
  const notes = rowOf(homeRows(state, { nowMs: NOW }), id);
  assert.equal(notes.version, null);
  assert.equal(notes.health, null);
  assert.equal(notes.uptodate, null);
  assert.deepEqual(notes.attention.map((a) => a.kind), ['unread']);
  // A project with no foundation field at all (an older server) reads the same.
  delete state.projects[1].foundation;
  assert.equal(rowOf(homeRows(state, { nowMs: NOW }), id).health, null);
});

test('the month cost is the sum of the days of the current month, counted by hand', () => {
  const rows = homeRows(threeProjects(), { nowMs: NOW });
  assert.equal(rowOf(rows, 'garden-planner-aa11bb').monthCost.usd, 1.25 + 0.5 + 2.25);
  const state = demo();
  for (const p of state.projects) {
    const byHand = Object.entries(p.costByDay).filter(([day]) => day.startsWith('2026-10-')).reduce((s, [, usd]) => s + usd, 0);
    assert.ok(byHand > 0);
    assert.ok(Math.abs(rowOf(homeRows(state, { nowMs: NOW }), p.id).monthCost.usd - byHand) < 1e-9, p.id);
  }
});

test('waiting is what the waiting list holds for that project; working counts live conversations that are not archived', () => {
  const state = threeProjects();
  const rows = homeRows(state, { nowMs: NOW });
  for (const p of state.projects) assert.equal(rowOf(rows, p.id).waiting, waitingEntries(state, p.id).length, p.id);
  assert.equal(rowOf(rows, 'garden-planner-aa11bb').waiting, 2);
  assert.equal(rowOf(rows, 'garden-planner-aa11bb').working, 1);
  assert.equal(rowOf(rows, state.projects[0].id).working, state.projects[0].chats.filter((c) => c.status === 'busy' && !c.archived).length);
});

test('a clash the person chose to stop seeing leaves the count, like it leaves the list', () => {
  const state = demo();
  const p = state.projects.find((x) => x.decisions.some((d) => d.kind === 'clash'));
  assert.ok(p, 'the demo has a clash');
  const ignored = new Set(p.decisions.filter((d) => d.kind === 'clash').map(clashKey));
  const before = rowOf(homeRows(state, { nowMs: NOW }), p.id).waiting;
  const after = rowOf(homeRows(state, { nowMs: NOW, ignored }), p.id).waiting;
  assert.ok(after < before);
  assert.equal(after, waitingEntries(state, p.id, ignored).length);
});

test('last activity is the newest of the latest commit and every conversation', () => {
  const rows = homeRows(threeProjects(), { nowMs: NOW });
  assert.equal(rowOf(rows, 'garden-planner-aa11bb').lastActivity, '2026-10-09T11:15:00.000Z');
  const quiet = handmade();
  quiet.chats = [];
  assert.equal(homeRows({ ...demo(), projects: [quiet] }, { nowMs: NOW })[0].lastActivity, '2026-10-08T08:00:00.000Z');
  const empty = handmade();
  empty.chats = [];
  empty.activity = [];
  assert.equal(homeRows({ ...demo(), projects: [empty] }, { nowMs: NOW })[0].lastActivity, null);
});

test('rows come waiting first, then working, then the most recent; ties keep a stable order', () => {
  const state = demo();
  const calm = (id, ts, status = 'closed') => ({ ...handmade(), id, name: id, chats: [quietChat(id, status, ts)], activity: [] });
  state.projects = [
    calm('older', '2026-10-01T00:00:00.000Z'), calm('newer', '2026-10-08T00:00:00.000Z'), calm('working', '2026-09-01T00:00:00.000Z', 'busy'),
    { ...calm('asks', '2026-08-01T00:00:00.000Z'), chats: [quietChat('q', 'idle', '2026-08-01T00:00:00.000Z', { strong: true })] },
    calm('also-older', '2026-10-01T00:00:00.000Z'),
  ];
  const order = homeRows(state, { nowMs: NOW }).map((r) => r.id);
  assert.deepEqual(order, ['asks', 'working', 'newer', 'also-older', 'older']);
  assert.deepEqual(homeRows({ ...state, projects: [...state.projects].reverse() }, { nowMs: NOW }).map((r) => r.id), order);
});

test('health tone: low under 60, good from 80', () => {
  assert.equal(healthTone(59), 'low');
  assert.equal(healthTone(60), 'ok');
  assert.equal(healthTone(79), 'ok');
  assert.equal(healthTone(80), 'good');
});

test('each heads-up has a kind, plain parameters and a place to go', () => {
  const at = (over) => attentionOf({ foundation: read(over) });
  assert.deepEqual(at({ version: { code: '0.4.0', mismatch: true } }), [{ kind: 'version-mismatch', params: { code: '0.4.0' }, goes: { area: 'health', sub: 'versions' } }]);
  assert.deepEqual(at({ uptodate: { confirmed: 5, warning: 3, unverified: 0 } }), [{ kind: 'uptodate-warning', params: { n: 3 }, goes: { area: 'health', sub: 'uptodate' } }]);
  assert.deepEqual(at({ health: { score: 59 } }), [{ kind: 'health-low', params: { score: 59 }, goes: { area: 'health' } }]);
  assert.deepEqual(at({ health: { score: 60 } }), []);
  assert.deepEqual(at({ census: { rev: 1, files: 9, lines: 9, noOwner: 7 } }), [{ kind: 'no-owner', params: { n: 7 }, goes: { area: 'map' } }]);
  assert.deepEqual(at({ care: null }), [{ kind: 'care-unset', params: {}, goes: { area: 'health', sub: 'care' } }]);
  assert.deepEqual(at({}), []);
  assert.deepEqual(attentionOf({ foundation: null }), [{ kind: 'unread', params: {}, goes: { area: 'map' } }]);
  assert.deepEqual(attentionOf({}), [{ kind: 'unread', params: {}, goes: { area: 'map' } }]);
  assert.deepEqual(
    attentionOf({ foundation: read({ health: { score: 70 } }) }, { budget: { pct: 130, tone: 'over' } }),
    [{ kind: 'budget', params: { pct: 130 }, goes: { area: 'costs' } }],
  );
});

test('never more than two heads-ups, the most serious first', () => {
  const bad = attentionOf({ foundation: read({
    version: { code: '0.4.0', mismatch: true }, uptodate: { confirmed: 1, warning: 4, unverified: 0 }, health: { score: 40 },
    census: { rev: 1, files: 9, lines: 9, noOwner: 2 }, care: null,
  }) }, { budget: { pct: 90, tone: 'warn' } });
  assert.equal(bad.length, 2);
  assert.deepEqual(bad.map((a) => a.kind), ['health-low', 'uptodate-warning']);
  const over = attentionOf({ foundation: null }, { budget: { pct: 120, tone: 'over' } });
  assert.deepEqual(over.map((a) => a.kind), ['budget', 'unread']);
});

test('a budget warning goes only to the project that spends most this month, and only when the budget is near or over', () => {
  const state = threeProjects();
  state.budget = { monthlyUSD: 100, used: 85 };
  const rows = homeRows(state, { nowMs: NOW });
  const top = rows.reduce((a, b) => (b.monthCost.usd > a.monthCost.usd ? b : a));
  const withBudget = rows.filter((r) => r.attention.some((a) => a.kind === 'budget'));
  assert.deepEqual(withBudget.map((r) => r.id), [top.id]);
  assert.equal(withBudget[0].attention.find((a) => a.kind === 'budget').params.pct, 85);
  const count = () => homeRows(state, { nowMs: NOW }).filter((r) => r.attention.some((a) => a.kind === 'budget')).length;
  state.budget = { monthlyUSD: 150, used: 57 };
  assert.equal(count(), 0);
  state.budget = null;
  assert.equal(count(), 0);
});

test('the totals add up the rows', () => {
  const rows = homeRows(threeProjects(), { nowMs: NOW });
  const totals = homeTotals(rows);
  assert.equal(totals.projects, 3);
  assert.equal(totals.working, rows.reduce((s, r) => s + r.working, 0));
  assert.equal(totals.waiting, rows.reduce((s, r) => s + r.waiting, 0));
  assert.ok(Math.abs(totals.monthUsd - rows.reduce((s, r) => s + r.monthCost.usd, 0)) < 1e-9);
  assert.equal(totals.unread, 1);
  assert.deepEqual(homeTotals([]), { projects: 0, working: 0, waiting: 0, monthUsd: 0, unread: 0 });
});

test('every heads-up and tone has a text in both languages, with the same blanks', () => {
  const kinds = ['unread', 'version-mismatch', 'uptodate-warning', 'health-low', 'no-owner', 'care-unset', 'budget'];
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const lang of ['en', 'pt-BR']) {
    for (const k of kinds) for (const key of [`home.attn.${k}`, `home.attn.${k}.go`]) assert.ok(LANGS[lang][key], `${lang} ${key}`);
    for (const k of ['good', 'ok', 'low']) assert.ok(LANGS[lang][`home.tone.${k}`], `${lang} home.tone.${k}`);
    assert.ok(LANGS[lang]['home.unread'], `${lang} home.unread`);
  }
  for (const key of Object.keys(LANGS.en).filter((k) => k.startsWith('home.'))) assert.deepEqual(vars(LANGS['pt-BR'][key]), vars(LANGS.en[key]), key);
  assert.deepEqual(vars(LANGS.en['home.attn.version-mismatch']), ['code']);
  assert.deepEqual(vars(LANGS.en['home.attn.uptodate-warning']), ['n']);
  assert.deepEqual(vars(LANGS.en['home.attn.health-low']), ['score']);
  assert.deepEqual(vars(LANGS.en['home.attn.no-owner']), ['n']);
  assert.deepEqual(vars(LANGS.en['home.attn.budget']), ['pct']);
});

test('home.js is pure: no DOM, no fetch', () => {
  const src = readFileSync(new URL('../server/web/home.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(document|window|fetch|localStorage)\b/);
});
