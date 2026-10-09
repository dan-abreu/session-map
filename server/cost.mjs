import { readFileSync } from 'node:fs';

const PER_MILLION = 1_000_000;
const FIELDS = ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead'];

// Keys starting with "_" (_asOf, _note) are metadata, not models.
export function loadPrices(overrides = {}) {
  const shipped = JSON.parse(readFileSync(new URL('./prices.json', import.meta.url), 'utf8'));
  return Object.fromEntries(Object.entries({ ...shipped, ...overrides }).filter(([k]) => !k.startsWith('_')));
}

// "claude-opus-5-5-20261001" matches key "claude-opus-5-5"; the longest key wins over "claude-opus-5".
export function priceFor(model, prices) {
  let best = null;
  for (const key of Object.keys(prices)) {
    if ((model === key || model.startsWith(`${key}-`)) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? null : prices[best];
}

export function costOf(rows, prices) {
  let usd = 0;
  const unpriced = new Set();
  for (const row of rows) {
    const price = priceFor(row.model ?? '', prices);
    if (!price) {
      unpriced.add(row.model ?? 'unknown');
      continue;
    }
    for (const field of FIELDS) usd += ((row[field] ?? 0) * (price[field] ?? 0)) / PER_MILLION;
  }
  return { usd, unpriced: [...unpriced] };
}

// "Today" starts at local midnight; 7 and 30 days are rolling windows back from now.
export function windowed(rows, now, prices = loadPrices()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const cutoffs = { today: dayStart, d7: now.getTime() - 7 * DAY, d30: now.getTime() - 30 * DAY };
  const out = {};
  for (const [name, from] of Object.entries(cutoffs)) {
    out[name] = costOf(rows.filter((r) => Date.parse(r.ts) >= from), prices).usd;
  }
  return out;
}

// The cost of each local day ("YYYY-MM-DD"), so the page can add up any range the person picks (mm06). A day that costs
// nothing is left out.
export function dailyCost(rows, prices = loadPrices()) {
  const byDay = new Map();
  for (const r of rows) {
    const d = new Date(r.ts);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  }
  const out = {};
  for (const [day, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const usd = costOf(list, prices).usd;
    if (usd > 0) out[day] = Math.round(usd * 1e6) / 1e6;
  }
  return out;
}

export function toCurrency(usd, currency) {
  return currency ? usd * currency.rate : usd;
}

export function budgetStatus(usedUSD, monthlyUSD) {
  const ratio = usedUSD / monthlyUSD;
  return ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
}

export function estimateStatus(costUSD, estimateUSD) {
  const ratio = costUSD / estimateUSD;
  return ratio > 1.3 ? 'over' : ratio > 1 ? 'warn' : 'ok';
}
