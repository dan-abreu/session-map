import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, dailyCost, windowed, toCurrency, budgetStatus, estimateStatus, loadPrices, priceFor } from '../server/cost.mjs';

const M = 1_000_000;
const prices = {
  'claude-a': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-a-b': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
};
const row = (over = {}) => ({ messageId: 'm', model: 'claude-a', input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ts: '2026-10-09T12:00:00.000Z', ...over });

test('1M input tokens at $5 costs 5.00', () => {
  assert.deepEqual(costOf([row({ input: M })], prices), { usd: 5, unpriced: [] });
});

test('every token class is priced separately', () => {
  const r = row({ input: M, output: M, cacheWrite5m: M, cacheWrite1h: M, cacheRead: M });
  assert.equal(costOf([r], prices).usd, 5 + 25 + 6.25 + 10 + 0.5);
});

test('dated model ids match by prefix and the longest key wins', () => {
  assert.equal(costOf([row({ model: 'claude-a-20260101', input: M })], prices).usd, 5);
  assert.equal(costOf([row({ model: 'claude-a-b-20260101', input: M })], prices).usd, 4);
  assert.equal(priceFor('claude-ab', prices), null);
});

test('a model without a price is listed once and costs 0', () => {
  const rows = [row({ model: 'mystery', input: M }), row({ model: 'mystery', input: M }), row({ input: M })];
  assert.deepEqual(costOf(rows, prices), { usd: 5, unpriced: ['mystery'] });
});

test('windowed splits today, 7 and 30 days by local day', () => {
  const now = new Date(2026, 9, 9, 15, 0, 0);
  const at = (daysAgo, hour = 10) => new Date(2026, 9, 9 - daysAgo, hour, 0, 0).toISOString();
  const rows = [
    row({ input: M, ts: at(0) }),
    row({ input: M, ts: at(0, 0) }),
    row({ input: M, ts: at(3) }),
    row({ input: M, ts: at(20) }),
    row({ input: M, ts: at(40) }),
  ];
  assert.deepEqual(windowed(rows, now, prices), { today: 10, d7: 15, d30: 20 });
});

test('toCurrency applies the fixed rate, or keeps USD', () => {
  assert.equal(toCurrency(10, { code: 'BRL', rate: 5.5 }), 55);
  assert.equal(toCurrency(10, null), 10);
});

test('budgetStatus warns at 80% and flags at 100%', () => {
  assert.equal(budgetStatus(79, 100), 'ok');
  assert.equal(budgetStatus(80, 100), 'warn');
  assert.equal(budgetStatus(100, 100), 'over');
});

test('estimateStatus warns at 100% and flags at 130%', () => {
  assert.equal(estimateStatus(99, 100), 'ok');
  assert.equal(estimateStatus(100, 100), 'ok');
  assert.equal(estimateStatus(101, 100), 'warn');
  assert.equal(estimateStatus(130, 100), 'warn');
  assert.equal(estimateStatus(131, 100), 'over');
});

test('shipped prices cover the current models and the fixtures', () => {
  const p = loadPrices();
  assert.equal(typeof p._asOf, 'undefined');
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-fake-1', 'claude-fake-helper']) {
    assert.ok(priceFor(id, p), id);
  }
  assert.equal(costOf([row({ model: 'claude-opus-5-5-20261001', input: M })], p).usd, 4);
});

test('user overrides win over shipped prices', () => {
  const p = loadPrices({ 'claude-opus-5-5': { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 } });
  assert.equal(costOf([row({ model: 'claude-opus-5-5', input: M })], p).usd, 1);
});

test('dailyCost: the cost of each local day, so any range can be summed later (mm06)', () => {
  const day = (d, h) => new Date(2026, 9, d, h, 0, 0).toISOString();
  const rows = [
    row({ input: M, ts: day(8, 0) }),
    row({ input: M, ts: day(8, 23) }),
    row({ output: M, ts: day(3, 10) }),
    row({ model: 'mystery', input: M, ts: day(5, 10) }),
  ];
  assert.deepEqual(dailyCost(rows, prices), { '2026-10-03': 25, '2026-10-08': 10 }, 'an unpriced model adds no day');
  assert.deepEqual(dailyCost([], prices), {});
});
