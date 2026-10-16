import { writeAtomic } from '../store.mjs';
import { log } from '../log.mjs';
import { getKey } from './keys.mjs';
import { BALANCE_FEEDS, parseDeepseekBalance, parseOpenRouterCredits, quotaFile, readQuota, withBalance } from './quota.mjs';

// The balance of the providers that publish one (id156): quota.mjs already knew how to read DeepSeek's and OpenRouter's
// answers and the pre-flight already refused a call a balance cannot pay, but nothing ever fetched a balance, so the
// check never worked and the Cérebro showed a dash. This fetches it, with the provider's own key and only to the
// provider's own address (BALANCE_FEEDS), at most once in five minutes each, and writes it where the pre-flight reads
// it. A failure keeps what was known and says only a code, never the key or the answer.

const PARSERS = { deepseek: parseDeepseekBalance, openrouter: parseOpenRouterCredits };
export const BALANCE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 5_000;

// -> the quota state after the look. Every effect is injectable for the tests.
export async function refreshBalances({
  smDir, keyOf = (provider) => getKey(smDir, provider), fetchFn = globalThis.fetch, now = Date.now, ttlMs = BALANCE_TTL_MS,
  providers = Object.keys(BALANCE_FEEDS),
} = {}) {
  let state = readQuota(smDir);
  let changed = false;
  for (const provider of providers) {
    const feed = BALANCE_FEEDS[provider];
    if (!feed) continue;
    const seen = state.providers[provider]?.checkedAt;
    if (Number.isFinite(seen) && now() - seen < ttlMs) continue;
    const key = await Promise.resolve(keyOf(provider)).catch(() => null);
    if (!key) continue;
    try {
      const res = await fetchFn(feed.url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        log('warn', 'ai-balance-failed', { provider, error: `http-${res.status}` });
        continue;
      }
      state = withBalance(state, provider, PARSERS[provider](await res.json()), now());
      changed = true;
    } catch (err) {
      log('warn', 'ai-balance-failed', { provider, error: String(err?.name ?? 'error').slice(0, 30) });
    }
  }
  if (changed) {
    try { writeAtomic(quotaFile(smDir), JSON.stringify(state)); } catch { /* the next look writes it */ }
  }
  return state;
}
