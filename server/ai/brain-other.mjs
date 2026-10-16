import { getKey, listKeys } from './keys.mjs';
import { lifeOf } from './life.mjs';
import { othersSettings } from './others.mjs';
import { PROVIDERS, estimateCostUSD, runApiJSON } from './providers.mjs';
import { levelsOf } from './efforts.mjs';
import { log } from '../log.mjs';

// The entry brain's one cheap call on another company's AI (id154): when the Cérebro's "brain" row names one, the
// weighing of a long message goes to its API, inside the owner's one daily cap for the other AIs. Anything that cannot
// run there (no key, switched off, the cap, a failure) answers null, and the caller's Claude call goes on as before.
// choice: {provider, model?, effort?} from functionsOf(config.ai).brain. Every effect is injectable for the tests.
export async function weighOutside(prompt, {
  smDir, config = {}, choice, schemaHint, timeoutMs,
  apiRun = runApiJSON, keyOf = (p) => getKey(smDir, p), queue = null, settings = null,
} = {}) {
  const provider = choice?.provider;
  if (!provider || provider === 'claude' || provider === 'auto' || !PROVIDERS[provider]) return null;
  const s = settings ?? othersSettings(config.ai, listKeys(smDir).map((k) => k.provider));
  if (!s.enabled || (s.off ?? []).includes(provider) || !(s.keys ?? []).includes(provider)) return null;
  const key = await Promise.resolve(keyOf(provider)).catch(() => null);
  if (!key) return null;
  const model = typeof choice.model === 'string' && choice.model && choice.model !== 'auto' ? choice.model : PROVIDERS[provider].defaultModel;
  const effort = typeof choice.effort === 'string' && levelsOf(provider, model).includes(choice.effort) ? choice.effort : null;
  const estimateUSD = estimateCostUSD(provider, model, prompt, undefined, schemaHint);
  const q = queue ?? lifeOf(smDir, config).queue;
  const ticket = q.reserveOutside(provider, estimateUSD, s.dailyUSD);
  if (!ticket) return null;
  let res;
  try {
    res = await apiRun(prompt, { provider, model, key, schemaHint, ...(effort ? { effort } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  } catch {
    res = { ok: false, error: 'threw', costUSD: estimateUSD }; // never the message: it could quote the request or the key
  }
  ticket.settle(Number.isFinite(res?.costUSD) ? res.costUSD : estimateUSD);
  log(res?.ok ? 'info' : 'warn', 'ai-brain-outside', { provider, model, ok: Boolean(res?.ok), ...(res?.ok ? {} : { error: String(res?.error ?? 'failed').slice(0, 30) }) });
  return res?.ok ? res : null;
}
