import { providerOf } from './providers.mjs';

// Which helper AI takes session-map's bulk work, read from its own config.json (sb07). The review rules are in review.mjs.
export { HELPER_KINDS, reviewPicks } from './review.mjs';

const DAILY_USD_DEFAULT = 0.5;

// ai.helper = {provider, model?, enabled} and ai.helperDailyUSD from session-map's own config.json.
export function helperSettings(ai) {
  const h = ai?.helper && typeof ai.helper === 'object' ? ai.helper : {};
  const p = providerOf(h.provider);
  const cap = Number(ai?.helperDailyUSD);
  return {
    provider: p?.id ?? null,
    model: p ? (typeof h.model === 'string' && h.model.trim() ? h.model.trim() : p.defaultModel) : null,
    enabled: Boolean(p && h.enabled === true),
    dailyUSD: ai?.helperDailyUSD !== undefined && Number.isFinite(cap) && cap >= 0 ? cap : DAILY_USD_DEFAULT,
  };
}
