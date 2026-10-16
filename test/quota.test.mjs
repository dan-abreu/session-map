import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuotaError, isQuotaPaused, quotaPause, quotaState, markQuotaError, noteQuotaOk, balanceOf,
  parseDeepseekBalance, parseOpenRouterCredits, withBalance, preflight, planQuotaFallback, readQuota,
} from '../server/ai/quota.mjs';

// The credit failover state (2026-10-14): a provider out of credit is paused with a growing cooldown, a success
// clears it, and a real balance (where a feed exists) is checked before the call.

test('quotaState keeps only well-shaped entries', () => {
  const s = quotaState({
    providers: {
      deepseek: { pausedUntil: 1000, error: 'http-402', strikes: 2, balanceUSD: 1.5, checkedAt: 900 },
      gemini: { pausedUntil: 'soon', error: 'http-402' },
      openai: { strikes: -1 },
      'bad id!': { pausedUntil: 1000, error: 'http-402' },
      openrouter: { pausedUntil: 1000, error: 'no-key', strikes: 1 },
    },
  });
  assert.deepEqual(s.providers.deepseek, { pausedUntil: 1000, error: 'http-402', strikes: 2, balanceUSD: 1.5, checkedAt: 900 });
  assert.deepEqual(s.providers.gemini, undefined);
  assert.deepEqual(s.providers.openai, undefined);
  assert.deepEqual(s.providers['bad id!'], undefined);
  assert.deepEqual(s.providers.openrouter, undefined);
  assert.deepEqual(quotaState(null), { providers: {} });
});

test('a 402 pauses and repeats climb the ladder; after it clears, the pause starts over', () => {
  const t0 = 1_000_000;
  const first = markQuotaError({}, 'deepseek', 'http-402', t0);
  assert.equal(first.providers.deepseek.pausedUntil, t0 + 5 * 60_000);
  const again = markQuotaError(first, 'deepseek', 'http-402', t0 + 1000);
  assert.equal(again.providers.deepseek.pausedUntil, t0 + 1000 + 30 * 60_000);
  assert.equal(again.providers.deepseek.strikes, 2);
  // A repeat after the pause expired is a fresh first strike.
  const later = markQuotaError(again, 'deepseek', 'http-402', t0 + 2 * 3_600_000);
  assert.equal(later.providers.deepseek.strikes, 1);
  assert.equal(later.providers.deepseek.pausedUntil, t0 + 2 * 3_600_000 + 5 * 60_000);
});

test('a 429 pauses shorter, and unknown errors take the 429 ladder', () => {
  const t0 = 1_000_000;
  assert.equal(markQuotaError({}, 'gemini', 'http-429', t0).providers.gemini.pausedUntil, t0 + 60_000);
  const weird = markQuotaError({}, 'gemini', 'whatever', t0);
  assert.equal(weird.providers.gemini.error, 'http-429');
  assert.equal(weird.providers.gemini.pausedUntil, t0 + 60_000);
  assert.equal(isQuotaError('http-402'), true);
  assert.equal(isQuotaError('timeout'), false);
});

test('a success clears the pause and the strikes, and keeps the balance', () => {
  const s = { providers: { deepseek: { pausedUntil: 2_000_000, error: 'http-402', strikes: 3, balanceUSD: 2.5, checkedAt: 1_000_000 } } };
  const ok = noteQuotaOk(s, 'deepseek');
  assert.deepEqual(ok.providers.deepseek, { balanceUSD: 2.5, checkedAt: 1_000_000 });
  assert.deepEqual(noteQuotaOk(ok, 'gemini'), ok);
  assert.equal(isQuotaPaused(ok, 'deepseek', 3_000_000), false);
});

test('quotaPause reports while it lasts and nothing after', () => {
  const s = markQuotaError({}, 'deepseek', 'http-402', 1_000_000);
  assert.deepEqual(quotaPause(s, 'deepseek', 1_000_001), { until: 1_300_000, error: 'http-402', strikes: 1 });
  assert.equal(quotaPause(s, 'deepseek', 1_400_000), null);
  assert.equal(isQuotaPaused(s, 'deepseek', 1_400_000), false);
});

test('the balance parsers take the USD row and refuse everything else', () => {
  assert.equal(parseDeepseekBalance({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '1.23' }] }), 1.23);
  assert.equal(parseDeepseekBalance({ balance_infos: [{ currency: 'CNY', total_balance: '10' }] }), null, 'no exchange-rate guess');
  assert.equal(parseDeepseekBalance({ balance_infos: [{ currency: 'USD', total_balance: '-1' }] }), null);
  assert.equal(parseDeepseekBalance(null), null);
  assert.equal(parseOpenRouterCredits({ data: { total_credits: 9.99, total_usage: 1.23 } }), 8.76);
  assert.equal(parseOpenRouterCredits({ data: { total_credits: 5 } }), 5);
  assert.equal(parseOpenRouterCredits({ data: {} }), null);
  assert.equal(parseOpenRouterCredits(null), null);
});

test('withBalance sets and clears the reading without touching the pause', () => {
  const paused = markQuotaError({}, 'deepseek', 'http-402', 1_000_000);
  const set = withBalance(paused, 'deepseek', 4, 1_000_500);
  assert.equal(set.providers.deepseek.balanceUSD, 4);
  assert.equal(set.providers.deepseek.pausedUntil, 1_300_000);
  const cleared = withBalance(set, 'deepseek', null, 1_001_000);
  assert.equal(cleared.providers.deepseek.balanceUSD, undefined);
  assert.equal(cleared.providers.deepseek.pausedUntil, 1_300_000);
  assert.equal(balanceOf(set, 'deepseek'), 4);
  assert.equal(balanceOf(cleared, 'deepseek'), null);
});

test('preflight refuses a paused provider and a balance too small for the call', () => {
  const paused = markQuotaError({}, 'deepseek', 'http-402', 1_000_000);
  assert.deepEqual(preflight(paused, 'deepseek', 0.01, { at: 1_000_001 }), { ok: false, reason: 'paused' });
  const low = withBalance({}, 'deepseek', 0.1);
  assert.deepEqual(preflight(low, 'deepseek', 0.1), { ok: false, reason: 'no-balance' });
  assert.deepEqual(preflight(low, 'deepseek', 0.05), { ok: true, reason: 'ok' });
  assert.deepEqual(preflight({}, 'deepseek', 0.05), { ok: true, reason: 'unknown-balance' });
});

test('when every AI of a level is out of credit, only critical work climbs to Claude', () => {
  assert.equal(planQuotaFallback('bulk', true), 'wait');
  assert.equal(planQuotaFallback('review', true), 'wait', 'never a fake self-review');
  assert.equal(planQuotaFallback('money', true), 'claude');
  assert.equal(planQuotaFallback('security', true), 'claude');
  assert.equal(planQuotaFallback('bulk', false), 'route');
});

test('readQuota reads a broken or missing file as no knowledge', () => {
  assert.deepEqual(readQuota('Z:/no/such/dir/at/all'), { providers: {} });
});
