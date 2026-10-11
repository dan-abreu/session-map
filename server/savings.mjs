import { costOf, priceKeyFor } from './cost.mjs';

// The savings report of the Costs tab (sb05): plain rules over the usage rows already read, no AI call. A "context" is
// what Claude re-reads at each reply: the whole chat so far (input + cache, counted in tokens).
const PER_MILLION = 1_000_000;
// A chat this long, with this many replies, costs more on each reply: a new one opened from the map starts light.
export const LONG_CONTEXT = 150_000;
const MIN_REPLIES_LONG = 30;
// What a chat restarted on purpose would carry on its first replies: only the reading beyond it counts as saved.
export const FRESH_CONTEXT = 30_000;
// Reading, listing and running things make short replies; writing text or code makes long ones.
const SHORT_REPLY_OUTPUT = 250;
const MIN_REPLIES_SMALL = 15;
// The next model down must cost at most this share of the one used (by the price of what it writes).
const CHEAPER_THAN = 0.6;
// Below this a suggestion is noise.
export const MIN_SAVING_USD = 0.25;
// The family one step down: the big ones to Sonnet, Sonnet to Haiku.
const DOWN = [[/opus|fable|mythos/, 'sonnet'], [/sonnet/, 'haiku']];

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const contextOf = (r) => (r.input ?? 0) + (r.cacheWrite5m ?? 0) + (r.cacheWrite1h ?? 0) + (r.cacheRead ?? 0);
const dayOf = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The newest model of the family one step down that costs clearly less, as a key of prices; null when there is none.
function cheaperKey(key, prices) {
  const family = DOWN.find(([re]) => re.test(key))?.[1];
  if (!family) return null;
  const famRe = new RegExp(`-${family}(-|$)`);
  return Object.keys(prices)
    .filter((k) => famRe.test(k))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .find((k) => (prices[k].output ?? Infinity) <= (prices[key].output ?? 0) * CHEAPER_THAN) ?? null;
}

// → {replies, context, tips}: the replies of one conversation, the size of its context now, and what could be saved.
// A tip is {kind: 'newChat', savingUSD} or {kind: 'smallerModel', from, to, savingUSD}, the larger saving first.
export function adviceFor(usage, prices) {
  const rows = usage ?? [];
  const replies = rows.length;
  const context = replies ? contextOf(rows[replies - 1]) : 0;
  const tips = [];

  if (replies >= MIN_REPLIES_LONG && context >= LONG_CONTEXT) {
    let usd = 0;
    for (const r of rows) {
      const ctx = contextOf(r);
      const price = priceKeyFor(r.model ?? '', prices);
      if (ctx >= LONG_CONTEXT && price) usd += (Math.min(r.cacheRead ?? 0, ctx - FRESH_CONTEXT) * (prices[price].cacheRead ?? 0)) / PER_MILLION;
    }
    if (usd >= MIN_SAVING_USD) tips.push({ kind: 'newChat', savingUSD: round6(usd) });
  }

  if (replies >= MIN_REPLIES_SMALL && rows.reduce((n, r) => n + (r.output ?? 0), 0) / replies <= SHORT_REPLY_OUTPUT) {
    const byKey = new Map();
    for (const r of rows) {
      const key = priceKeyFor(r.model ?? '', prices);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), r]);
    }
    // A chat can be split across versions of a model: judge it as a whole (one saving, one floor), naming the largest part.
    let best = null;
    let total = 0;
    for (const [from, list] of byKey) {
      const to = cheaperKey(from, prices);
      if (!to) continue;
      const saving = costOf(list, prices).usd - costOf(list.map((r) => ({ ...r, model: to })), prices).usd;
      total += saving;
      if (!best || saving > best.savingUSD) best = { kind: 'smallerModel', from, to, savingUSD: saving };
    }
    if (best && total >= MIN_SAVING_USD) tips.push({ ...best, savingUSD: round6(total) });
  }
  return { replies, context, tips: tips.sort((a, b) => b.savingUSD - a.savingUSD) };
}

// The cost of each model on each local day: {"YYYY-MM-DD": {"claude-opus-5-5": usd}}, so the page can add up any period.
// A model without a price adds nothing, as in dailyCost.
export function modelDaily(rows, prices) {
  const out = {};
  for (const r of rows) {
    const day = dayOf(r.ts);
    const key = priceKeyFor(r.model ?? '', prices);
    if (!day || !key) continue;
    const usd = costOf([r], prices).usd;
    if (usd <= 0) continue;
    out[day] ??= {};
    out[day][key] = (out[day][key] ?? 0) + usd;
  }
  const sorted = {};
  for (const day of Object.keys(out).sort()) {
    sorted[day] = Object.fromEntries(Object.keys(out[day]).sort().map((k) => [k, round6(out[day][k])]));
  }
  return sorted;
}
