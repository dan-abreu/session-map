import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// Out of credit must not stop the work (failover, owner's request 2026-10-14): when a provider answers http-402
// (no credits left) or http-429 (quota or rate limit), it is paused for a cooldown that grows with each repeat, so
// the next dispatch takes the next AI in line instead of hitting the empty one again. A successful call clears the
// pause: it proves there is credit again. The state is smDir/ai-quota.json, kept apart from ai-cache.json so the
// quality pause (review.mjs, "disagreed with Claude") and this credit pause never mix: a wrong answer and an empty
// balance are different problems with different fixes.
//
// Two providers expose a real balance; the rest are error signals only. Prices and estimates come from
// providers.mjs (costOf/estimateCostUSD); this file only decides whether a provider may take a call of that size.

// Where a real balance can be read (GET with the provider's key). The rest report only through errors.
export const BALANCE_FEEDS = Object.freeze({
  deepseek: { url: 'https://api.deepseek.com/user/balance', note: 'GET with the API key; USD row of balance_infos' },
  openrouter: { url: 'https://openrouter.ai/api/v1/credits', note: 'GET with the API key; total_credits - total_usage' },
});

// Cooldown ladders: 402 (no credits; refilling is manual) pauses longer than 429 (quota or rate; passes by itself).
export const QUOTA_LADDERS = Object.freeze({
  'http-402': Object.freeze([5 * 60_000, 30 * 60_000, 3 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000]),
  'http-429': Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000]),
});

export const QUOTA_ERRORS = Object.freeze(['http-402', 'http-429']);
export const isQuotaError = (error) => QUOTA_ERRORS.includes(error);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const PROVIDER_RE = /^[a-z0-9-]{1,20}$/;

// The clean state: {providers: {id: {pausedUntil, error, strikes, balanceUSD?, checkedAt?}}}. Anything that does not
// fit is dropped, so a broken file degrades to "no knowledge", never to a wrong pause.
export function quotaState(raw) {
  const providers = {};
  const entries = isObject(raw?.providers) ? raw.providers : {};
  for (const [id, p] of Object.entries(entries)) {
    if (!PROVIDER_RE.test(id) || !isObject(p)) continue;
    const entry = {};
    if (Number.isFinite(p.pausedUntil) && p.pausedUntil > 0 && QUOTA_ERRORS.includes(p.error)) {
      entry.pausedUntil = p.pausedUntil;
      entry.error = p.error;
      // Strikes only matter while the pause is on: an expired pause starts over at one.
      if (Number.isInteger(p.strikes) && p.strikes >= 0) entry.strikes = p.strikes;
    }
    if (Number.isFinite(p.balanceUSD) && p.balanceUSD >= 0) entry.balanceUSD = p.balanceUSD;
    if (Number.isFinite(p.checkedAt) && p.checkedAt > 0) entry.checkedAt = p.checkedAt;
    if (Object.keys(entry).length) providers[id] = entry;
  }
  return { providers };
}

// A quota error pauses the provider for the next rung of the ladder; a repeat before the pause cleared climbs one
// rung. Unknown errors are treated as 429: a short pause is safer than none.
export function markQuotaError(state, provider, error, at = Date.now()) {
  const clean = quotaState(state);
  const prev = clean.providers[provider];
  const fresh = !(prev?.pausedUntil > at);
  const strikes = fresh ? 1 : (prev?.strikes ?? 1) + 1;
  const rungs = QUOTA_LADDERS[QUOTA_ERRORS.includes(error) ? error : 'http-429'];
  const wait = rungs[Math.min(strikes - 1, rungs.length - 1)];
  clean.providers[provider] = { ...prev, pausedUntil: at + wait, error: QUOTA_ERRORS.includes(error) ? error : 'http-429', strikes };
  return clean;
}

// A successful call after a pause proves there is credit again: the pause and its strikes are cleared. A success
// while a balance is known keeps the balance (the provider billed it): the caller re-reads or lowers it itself.
export function noteQuotaOk(state, provider) {
  const clean = quotaState(state);
  const p = clean.providers[provider];
  if (!p) return clean;
  delete p.pausedUntil;
  delete p.error;
  delete p.strikes;
  if (!Object.keys(p).length) delete clean.providers[provider];
  return clean;
}

// -> null (not paused) or {until, error, strikes} (still paused).
export function quotaPause(state, provider, at = Date.now()) {
  const p = quotaState(state).providers[provider];
  if (!p || !(p.pausedUntil > at)) return null;
  return { until: p.pausedUntil, error: p.error, strikes: p.strikes ?? 0 };
}

export const isQuotaPaused = (state, provider, at = Date.now()) => Boolean(quotaPause(state, provider, at));

// The remaining balance of one provider, or null when it was never read. NaN or negative never escapes.
export function balanceOf(state, provider) {
  const p = quotaState(state).providers[provider];
  return Number.isFinite(p?.balanceUSD) && p.balanceUSD >= 0 ? p.balanceUSD : null;
}

// DeepSeek: {"is_available": true, "balance_infos": [{"currency": "USD", "total_balance": "1.23", ...}]}. The USD
// row wins; a CNY-only answer is left to null (no exchange-rate guess here).
export function parseDeepseekBalance(data) {
  const infos = isObject(data) ? data.balance_infos : null;
  if (!Array.isArray(infos)) return null;
  const usd = infos.find((i) => isObject(i) && i.currency === 'USD');
  const row = usd ?? infos.find((i) => isObject(i) && i.currency === 'CNY');
  const v = Number(row?.total_balance);
  return Number.isFinite(v) && v >= 0 ? (row === usd ? v : null) : null;
}

// OpenRouter: {"data": {"total_credits": 9.99, "total_usage": 1.23}}. Remaining = total - used.
export function parseOpenRouterCredits(data) {
  const d = isObject(data?.data) ? data.data : null;
  const total = Number(d?.total_credits);
  if (!Number.isFinite(total)) return null;
  const used = Number(d?.total_usage);
  return Number.isFinite(used) && used >= 0 ? total - used : total;
}

// The state with the provider's balance set (or the balance dropped when the feed has none: the reading is replaced,
// not merged).
export function withBalance(state, provider, balanceUSD, at = Date.now()) {
  const clean = quotaState(state);
  const p = { ...(clean.providers[provider] ?? {}) };
  if (Number.isFinite(balanceUSD) && balanceUSD >= 0) {
    p.balanceUSD = balanceUSD;
    p.checkedAt = at;
    clean.providers[provider] = p;
    return clean;
  }
  delete p.balanceUSD;
  delete p.checkedAt;
  if (Object.keys(p).length) clean.providers[provider] = p;
  else delete clean.providers[provider];
  return clean;
}

// Pre-flight, before a call: may this provider take a call of this estimated cost? The safety factor covers the
// estimate's pessimism (providers.mjs estimateCostUSD is deliberately rough) and any rounding. Without a balance
// reading the call goes ahead: errors are the fallback signal.
export function preflight(state, provider, estimateUSD, { at = Date.now(), safety = 1.1 } = {}) {
  if (isQuotaPaused(state, provider, at)) return { ok: false, reason: 'paused' };
  const balance = balanceOf(state, provider);
  if (balance === null) return { ok: true, reason: 'unknown-balance' };
  if (estimateUSD * safety > balance) return { ok: false, reason: 'no-balance' };
  return { ok: true, reason: 'ok' };
}

// When every AI of a level is out of credit, do not burn the dearest model on a cheap job: wait and tell the owner
// (queue for human review), unless the work is critical, which Claude takes instead. A review also waits: an
// independent reviewer with no credit left means no review at all, never a fake one by the writer itself.
export const CRITICAL_KINDS = Object.freeze(['money', 'security', 'personal-data', 'architecture']);

export function planQuotaFallback(kind, allExhausted) {
  if (!allExhausted) return 'route';
  return CRITICAL_KINDS.includes(kind) ? 'claude' : 'wait';
}

// File helpers, kept small: the caller (ask.mjs / runner.mjs) persists after each change. A broken or missing file
// reads as "no knowledge".
export const quotaFile = (smDir) => join(smDir, 'ai-quota.json');

export function readQuota(smDir) {
  try {
    return quotaState(JSON.parse(readFileSync(quotaFile(smDir), 'utf8')));
  } catch {
    return { providers: {} };
  }
}
