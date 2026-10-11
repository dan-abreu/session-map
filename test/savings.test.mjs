// sb05: the savings report of the Costs tab. Deterministic rules over the usage rows already read, no AI call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adviceFor, modelDaily, LONG_CONTEXT, FRESH_CONTEXT, MIN_SAVING_USD } from '../server/savings.mjs';
import { costOf, priceKeyFor } from '../server/cost.mjs';
import { collect } from '../server/collect.mjs';
import { savingsReport } from '../server/web/views.js';
import { LANGS } from '../server/web/i18n.js';

const M = 1_000_000;
const prices = {
  'claude-opus-a': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-sonnet-a': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  'claude-sonnet-b': { input: 1.5, output: 7, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 0.15 },
  'claude-haiku-a': { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
};
const row = (over = {}) => ({ messageId: 'm', model: 'claude-opus-a', input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ts: '2026-10-09T12:00:00.000Z', ...over });
const many = (n, over) => Array.from({ length: n }, (_, i) => row({ messageId: `m${i}`, ...over }));

test('priceKeyFor names the price a model matches, the longest key winning', () => {
  assert.equal(priceKeyFor('claude-opus-a-20261001', prices), 'claude-opus-a');
  assert.equal(priceKeyFor('claude-unknown', prices), null);
});

test('a very long chat is told to start over, with what the long reads cost beyond a fresh start', () => {
  // 40 replies, each re-reading 200k of context at 0.5/M: only the part beyond a fresh start counts as saved.
  const rows = many(40, { input: 1_000, output: 2_000, cacheRead: 199_000 });
  const a = adviceFor(rows, prices);
  const tip = a.tips.find((x) => x.kind === 'newChat');
  assert.ok(tip, 'the long chat gets the new-chat tip');
  const excess = 200_000 - FRESH_CONTEXT;
  assert.ok(Math.abs(tip.savingUSD - (40 * excess * 0.5) / M) < 1e-9);
  assert.equal(a.replies, 40);
  assert.equal(a.context, 200_000);
  assert.ok(LONG_CONTEXT <= 200_000);
});

test('a chat that is long but has few replies, or short but has many, is left alone', () => {
  assert.deepEqual(adviceFor(many(5, { cacheRead: 400_000 }), prices).tips, []);
  assert.deepEqual(adviceFor(many(60, { input: 500, output: 3_000, cacheRead: 20_000 }), prices).tips, []);
});

test('short steps on a big model: a smaller one would do, with the difference it would have made', () => {
  const rows = many(30, { input: 2_000, output: 100, cacheRead: 18_000 });
  const a = adviceFor(rows, prices);
  const tip = a.tips.find((x) => x.kind === 'smallerModel');
  assert.ok(tip, 'the reading-and-listing chat gets the smaller-model tip');
  assert.equal(tip.from, 'claude-opus-a');
  assert.equal(tip.to, 'claude-sonnet-b', 'the newest of the next family down');
  const asSmall = costOf(rows.map((r) => ({ ...r, model: 'claude-sonnet-b' })), prices).usd;
  assert.ok(Math.abs(tip.savingUSD - (costOf(rows, prices).usd - asSmall)) < 1e-9);
  assert.equal(a.tips.some((x) => x.kind === 'newChat'), false);
});

test('a sonnet chat of short steps is pointed at haiku, and a haiku chat at nothing', () => {
  const heavy = { input: 2_000, output: 100, cacheRead: 98_000 };
  assert.equal(adviceFor(many(30, { model: 'claude-sonnet-a', ...heavy }), prices).tips.find((x) => x.kind === 'smallerModel')?.to, 'claude-haiku-a');
  assert.deepEqual(adviceFor(many(30, { model: 'claude-haiku-a', ...heavy }), prices).tips, []);
});

test('long replies (writing real text or code) are not a job for a smaller model', () => {
  assert.equal(adviceFor(many(30, { input: 2_000, output: 3_000, cacheRead: 18_000 }), prices).tips.find((x) => x.kind === 'smallerModel'), undefined);
});

test('a saving smaller than the floor is not worth a suggestion; an unpriced model never throws', () => {
  assert.ok(MIN_SAVING_USD > 0);
  assert.deepEqual(adviceFor(many(15, { input: 10, output: 10, cacheRead: 100 }), prices).tips, []);
  assert.deepEqual(adviceFor(many(40, { model: 'mystery', cacheRead: 300_000 }), prices).tips, []);
  assert.deepEqual(adviceFor([], prices), { replies: 0, context: 0, tips: [] });
});

test('modelDaily: the cost of each model on each local day, by the price the model matches', () => {
  const day = (d, h) => new Date(2026, 9, d, h, 0, 0).toISOString();
  const rows = [
    row({ input: M, ts: day(8, 1) }),
    row({ model: 'claude-opus-a-20261001', input: M, ts: day(8, 22) }),
    row({ model: 'claude-sonnet-a', input: M, ts: day(8, 5) }),
    row({ model: 'claude-sonnet-a', output: M, ts: day(3, 5) }),
    row({ model: 'mystery', input: M, ts: day(5, 5) }),
  ];
  assert.deepEqual(modelDaily(rows, prices), {
    '2026-10-03': { 'claude-sonnet-a': 10 },
    '2026-10-08': { 'claude-opus-a': 10, 'claude-sonnet-a': 2 },
  });
  assert.deepEqual(modelDaily([], prices), {});
});

const project = (over = {}) => ({
  id: 'p', name: 'Shop',
  costByModel: { '2026-10-03': { 'claude-opus-5-5': 3, 'claude-sonnet-5-5': 1 }, '2026-10-08': { 'claude-opus-5-5': 2 } },
  chats: [
    { sessionId: 'a', title: 'Long one', costUSD: 9, updatedAt: '2026-10-08T10:00:00.000Z', advice: { replies: 80, context: 300_000, tips: [{ kind: 'newChat', savingUSD: 2 }, { kind: 'smallerModel', from: 'claude-opus-5-5', to: 'claude-sonnet-5-5', savingUSD: 3 }] } },
    { sessionId: 'b', title: 'Old one', costUSD: 1, updatedAt: '2026-09-01T10:00:00.000Z', advice: { replies: 50, context: 200_000, tips: [{ kind: 'newChat', savingUSD: 1 }] } },
    { sessionId: 'c', title: 'Fine', costUSD: 4, updatedAt: '2026-10-08T11:00:00.000Z', advice: null },
  ],
  workCells: [
    { id: 'w1', branch: 'feat/x', costUSD: 5, chatIds: ['a'] },
    { id: 'w2', branch: 'feat/y', costUSD: 8, chatIds: ['b'] },
    { id: 'w3', branch: 'feat/z', costUSD: 0, chatIds: [] },
  ],
  ...over,
});
const at = (iso) => Date.parse(iso);

test('savingsReport sums models in the period, lists tips by size and counts the larger tip of each chat once', () => {
  const r = savingsReport({ projects: [project()] }, { from: at('2026-10-01T00:00:00'), to: at('2026-10-09T23:59:59') });
  assert.deepEqual(r.byModel, [{ model: 'claude-opus-5-5', usd: 5 }, { model: 'claude-sonnet-5-5', usd: 1 }]);
  assert.deepEqual(r.tips.map((x) => [x.chat.sessionId, x.tip.kind]), [['a', 'smallerModel'], ['a', 'newChat']]);
  assert.equal(r.totalSavingUSD, 3, 'the chat is counted once, by its larger tip, and the old chat is outside the period');
  assert.deepEqual(r.tasks.map((x) => [x.workCell.id, x.costUSD]), [['w1', 5]], 'only lines of work with a chat in the period');
});

test('savingsReport with no period takes everything, and a state from before this report still works', () => {
  const r = savingsReport({ projects: [project()] }, null);
  assert.equal(r.totalSavingUSD, 4);
  assert.deepEqual(r.tasks.map((x) => x.workCell.id), ['w2', 'w1'], 'most expensive first');
  const old = savingsReport({ projects: [{ id: 'q', name: 'Old', chats: [{ sessionId: 'z', updatedAt: '2026-10-08T10:00:00.000Z', costUSD: 1 }], workCells: [] }] }, null);
  assert.deepEqual(old, { byModel: [], tips: [], totalSavingUSD: 0, tasks: [] });
});

test('a chat split across two versions of a big model is judged as a whole: the parts add up past the floor', () => {
  const two = { ...prices, 'claude-opus-b': { ...prices['claude-opus-a'] } };
  const heavy = { input: 2_000, output: 100, cacheRead: 38_000 };
  const rows = [...many(8, { model: 'claude-opus-a', ...heavy }), ...many(7, { model: 'claude-opus-b', ...heavy })];
  const one = (list) => costOf(list, two).usd - costOf(list.map((r) => ({ ...r, model: 'claude-sonnet-b' })), two).usd;
  assert.ok(one(rows.slice(0, 8)) < MIN_SAVING_USD && one(rows.slice(8)) < MIN_SAVING_USD, 'each part alone is under the floor');
  const tip = adviceFor(rows, two).tips.find((x) => x.kind === 'smallerModel');
  assert.ok(tip, 'the whole chat is over the floor');
  assert.ok(Math.abs(tip.savingUSD - one(rows)) < 1e-9, 'the saving counts every part, not only the largest');
  assert.equal(tip.from, 'claude-opus-a', 'from/to are those of the largest part');
  assert.equal(tip.to, 'claude-sonnet-b');
});

test('the savings texts say they count the whole life of the conversations active in the period, not the period', () => {
  for (const [lang, words] of [['en', /whole life/i], ['pt-BR', /toda a vida/i]]) {
    assert.match(LANGS[lang]['costs.savingsTotal'], words, `${lang} total`);
    assert.match(LANGS[lang]['costs.savingsTotal'], /active|ativ/i, `${lang} total says active conversations`);
    assert.match(LANGS[lang]['costs.tipSave'], words, `${lang} tip`);
  }
});

test('savingsReport: an old chat with a big saving but a recent update is counted by its whole life (what the total says)', () => {
  const state = { projects: [{ id: 'p', name: 'Shop', chats: [{ sessionId: 'o', costUSD: 50, updatedAt: '2026-10-08T10:00:00.000Z', advice: { replies: 400, context: 300_000, tips: [{ kind: 'newChat', savingUSD: 40 }] } }], workCells: [] }] };
  const r = savingsReport(state, { from: at('2026-10-07T00:00:00'), to: at('2026-10-09T23:59:59') });
  assert.equal(r.totalSavingUSD, 40);
});

// ---- through collect: the numbers come from the usage already read ----------------------------------------------------

const NOW = new Date('2026-09-10T12:00:00Z');
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sm-savings-')));
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('collect puts the cost by model and a long chat\'s tip on the project, from the usage it already reads', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = join(tmp(), 'acme-shop');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  try {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ts = new Date(NOW.getTime() - 3_600_000).toISOString();
    const base = { sessionId: id, cwd: root, gitBranch: 'main', timestamp: ts };
    const lines = [{ ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'read it all' }] } }];
    for (let i = 0; i < 40; i++) {
      lines.push({ ...base, type: 'assistant', message: { id: `m${i}`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 299_000 }, stop_reason: 'end_turn' } });
    }
    const projDir = join(dir, 'projects', root.replace(/[^a-z0-9]/gi, '-'));
    mkdirSync(projDir, { recursive: true });
    const file = join(projDir, `${id}.jsonl`);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const t = (NOW.getTime() - 3_600_000) / 1000;
    utimesSync(file, t, t);
    const state = await collect({ dir, smDir, now: NOW, isAlive: () => true, ai: { bin: null } });
    const p = state.projects[0];
    const day = Object.keys(p.costByModel);
    assert.equal(day.length, 1);
    assert.ok(p.costByModel[day[0]]['claude-fake-1'] > 0);
    const chat = p.chats.find((c) => c.sessionId === id);
    assert.equal(chat.advice.replies, 40);
    assert.equal(chat.advice.context, 300_000);
    assert.ok(chat.advice.tips.some((x) => x.kind === 'newChat' && x.savingUSD > 0));
  } finally {
    for (const d of [dir, smDir, root]) rmSync(d, { recursive: true, force: true });
  }
});
