// Who takes part in the measuring bench (or12) and how each is called. The three Claude levels always run, through
// the owner's own `claude -p` with no tools; each outside provider with a saved key adds its default and its mid model.
import { join } from 'node:path';
import { aiRunnerDir, runClaudeJSON } from '../ai/runner.mjs';
import { PROVIDERS, costOf, maxAnswerTokens, providerOf, runApiJSON } from '../ai/providers.mjs';
import { getKey } from '../ai/keys.mjs';

export const CLAUDE_LEVELS = Object.freeze(['haiku', 'sonnet', 'opus']);

// The next step up from each provider's default: the one a routing decision would weigh against it.
export const MID_MODELS = Object.freeze({ openai: 'gpt-6.1-sol', gemini: 'gemini-3.8-flash', deepseek: 'deepseek-v4-pro' });

// A first Claude call is priced before any real bill is known: high on purpose (the CLI adds its own instructions
// to every prompt). After that the estimate follows the dearest real call so far.
const CLAUDE_FIRST_GUESS_USD = Object.freeze({ haiku: 0.08, sonnet: 0.3, opus: 0.8 });
const UNKNOWN_CLAUDE_GUESS_USD = 1;
const MARGIN = 1.5;
// Pessimistic on purpose: real text runs nearer 4 characters per token. The answer is capped by runApiJSON.
const CHARS_PER_TOKEN = 2;
// Room for a whole module or a thinking model's hidden reasoning: at 1024 and at 4096 the answers of DeepSeek and Gemini 3.8 were cut
// off before the JSON closed (error no-json) in the first real run.
const API_MAX_OUT_TOKENS = 8192; // the most runApiJSON allows
const SCHEMA_TOKENS = 100;

const CLAUDE_TIMEOUT_MS = 300_000;
const API_TIMEOUT_MS = 120_000;

export function parseContestant(id) {
  const at = String(id ?? '').indexOf(':');
  if (at <= 0 || at === id.length - 1) return null;
  const provider = id.slice(0, at);
  const model = id.slice(at + 1);
  return { id, via: provider === 'claude' ? 'claude' : 'api', provider, model };
}

// Dearer models that take part only when named in --only (GPT-6 Astra costs five times Sol): measured on purpose, never by
// accident in a full run.
export const OPT_IN_MODELS = Object.freeze({ openai: ['gpt-6-astra'] });

export function contestantsFor(keyedProviders = []) {
  const list = CLAUDE_LEVELS.map((level) => parseContestant(`claude:${level}`));
  const keyed = [...new Set(keyedProviders)].filter((p) => providerOf(p)).sort();
  for (const provider of keyed) {
    const models = [PROVIDERS[provider].defaultModel, MID_MODELS[provider]].filter(Boolean);
    for (const model of [...new Set(models)]) list.push(parseContestant(`${provider}:${model}`));
    for (const model of OPT_IN_MODELS[provider] ?? []) list.push({ ...parseContestant(`${provider}:${model}`), optIn: true });
  }
  return list;
}

// --only: the full list's order is kept, so a run reads the same however the names were typed.
export function selectContestants(all, only) {
  if (!only?.length) return { chosen: all.filter((c) => !c.optIn), missing: [] };
  const wanted = new Set(only);
  return { chosen: all.filter((c) => wanted.has(c.id)), missing: only.filter((id) => !all.some((c) => c.id === id)) };
}

// DeepSeek keeps what it is sent in China and may train on it: the owner's own conversations stay away from it.
export function allowedFor(contestant, kind, { allowDeepseekPersonal = false } = {}) {
  if (kind === 'classify' && contestant.provider === 'deepseek') return allowDeepseekPersonal;
  return true;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// The first guesses above hold for a prompt up to this size; a longer first prompt is scaled up by its length.
const FIRST_GUESS_CHARS = 20_000;

// The most one call may cost, checked against the caps before the call is made. seen: what earlier calls of this
// contestant on this kind of task really cost, as numbers or as { costUSD, chars } (chars: the prompt's length).
// A bill grows with the prompt, so a longer prompt than the ones seen is scaled up by the dearest cost per character
// so far: a call's fixed part makes that rate an over-estimate, never an under-estimate.
export function estimateUSD(contestant, prompt, seen = []) {
  const chars = String(prompt ?? '').length;
  const bills = seen.map((s) => (typeof s === 'number' ? { costUSD: s, chars: 0 } : { costUSD: Number(s?.costUSD) || 0, chars: Number(s?.chars) || 0 }));
  const dearest = bills.length ? Math.max(...bills.map((b) => b.costUSD)) : 0;
  const perChar = Math.max(0, ...bills.filter((b) => b.chars > 0).map((b) => b.costUSD / b.chars));
  const fromBills = Math.max(dearest, perChar * chars) * MARGIN;
  if (contestant.via === 'claude') {
    if (bills.length) return round6(fromBills);
    const guess = Object.hasOwn(CLAUDE_FIRST_GUESS_USD, contestant.model) ? CLAUDE_FIRST_GUESS_USD[contestant.model] : UNKNOWN_CLAUDE_GUESS_USD;
    return round6(guess * Math.max(1, chars / FIRST_GUESS_CHARS));
  }
  const tokensIn = Math.ceil(String(prompt ?? '').length / CHARS_PER_TOKEN) + SCHEMA_TOKENS;
  const tokensOut = maxAnswerTokens(contestant.provider, contestant.model, API_MAX_OUT_TOKENS); // plus any reasoning room
  return round6(Math.max(costOf(contestant.provider, contestant.model, tokensIn, tokensOut), fromBills));
}

// One shape back whoever answered: { ok, value, costUSD, error }. Errors are short codes; a key never travels back.
export function makeCaller({ smDir, runClaude = runClaudeJSON, runApi = runApiJSON, getKeyFn = getKey } = {}) {
  const cwd = join(aiRunnerDir(smDir), 'bench');
  const shape = (res) => ({
    ok: Boolean(res?.ok),
    value: res?.ok ? res.value : null,
    costUSD: Number(res?.costUSD) || 0,
    error: res?.ok ? null : String(res?.error ?? 'failed'),
  });
  return async function call(contestant, prompt, schemaHint) {
    try {
      if (contestant.via === 'claude') {
        return shape(await runClaude(prompt, { model: contestant.model, cwd, schemaHint, timeoutMs: CLAUDE_TIMEOUT_MS }));
      }
      const key = await getKeyFn(smDir, contestant.provider);
      if (!key) return shape({ ok: false, error: 'no-key' });
      return shape(await runApi(prompt, { provider: contestant.provider, model: contestant.model, key, schemaHint, maxTokens: API_MAX_OUT_TOKENS, timeoutMs: API_TIMEOUT_MS }));
    } catch {
      return shape({ ok: false, error: 'crashed' });
    }
  };
}
