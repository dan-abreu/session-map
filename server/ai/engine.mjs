import { PROVIDERS } from './providers.mjs';

// The functions of the map that today run on Claude alone (the id123 levantamento): the person picks, for each one,
// 'auto' or one of the AIs he has a key for — mechanical, in the config, never in a prompt. The choice is engine-held
// like the model policy (or33): the AI never decides which engine it is.
//
// Config: ai.others.engines = { brain: 'auto' | provider id, background: 'auto' | provider id }.
//   brain:      the weighing and planning calls (the map's triage; quality matters).
//   background: the map's own bulk work (digests, labels, book tidies; cost matters).
// 'auto' resolves by a fixed preference, never by asking anyone: the brain wants the strongest available, the
// background the cheapest. An explicit choice that is unavailable (no key, switched off) falls back the same way,
// and says why, so the page can show it.

export const ENGINE_FUNCTIONS = Object.freeze(['brain', 'background']);
// Quality first for both: 'auto' keeps the measured behavior (Claude when it is there) and swaps by itself down the
// line when an engine is gone. The economia group already puts the cheap first for the routed bulk; the person's
// explicit choice is what forces one engine. openrouter last: one more hop and a fee.
export const BRAIN_PREFERENCE = Object.freeze(['claude', 'openai', 'gemini', 'deepseek', 'openrouter']);
export const BACKGROUND_PREFERENCE = Object.freeze(['claude', 'deepseek', 'openai', 'gemini', 'openrouter']);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const knownProvider = (p) => p === 'claude' || Boolean(PROVIDERS[p]);
const validChoice = (v) => v === 'auto' || (typeof v === 'string' && knownProvider(v));

// The clean choices: {brain, background}, each 'auto' (the default) or a provider. Broken values mean 'auto': a wrong
// guess here costs money, the safe default is the measured behavior.
export function enginesOf(ai) {
  const raw = isObject(ai?.others?.engines) ? ai.others.engines : {};
  const one = (k) => (validChoice(raw[k]) ? raw[k] : 'auto');
  return { brain: one('brain'), background: one('background') };
}

// The ai part of config.json with the engine choices written: {brain, background} set the keys; a key set to 'auto'
// is removed (the default needs no line).
export function mergeEngines(ai, patch = {}) {
  const { others, ...rest } = isObject(ai) ? ai : {};
  const { engines, ...o } = isObject(others) ? others : {};
  const merged = { ...o };
  const next = { ...(isObject(engines) ? engines : {}) };
  for (const k of ENGINE_FUNCTIONS) {
    if (patch[k] === 'auto') delete next[k];
    else if (validChoice(patch[k])) next[k] = patch[k];
  }
  if (Object.keys(next).length) merged.engines = next;
  return { ...rest, others: merged };
}

// -> {id, why}. available: the provider ids usable right now (key, switched on, credit ok; 'claude' only when its CLI
// is there). An explicit choice that is not available falls back along the preference, and says so; 'auto' is the
// preference alone. Nothing available -> {id: null, why: 'none'} and the caller keeps its own Claude fallback.
export function resolveEngine(choice, { available = [], preference = [], fallback = null } = {}) {
  const avail = new Set((Array.isArray(available) ? available : []).filter((p) => typeof p === 'string'));
  const pref = Array.isArray(preference) ? preference : [];
  const first = () => pref.find((p) => avail.has(p)) ?? null;
  const chosen = validChoice(choice) ? choice : 'auto';
  if (chosen !== 'auto' && avail.has(chosen)) return { id: chosen, why: 'choice' };
  const byPref = first();
  if (byPref) return { id: byPref, why: chosen === 'auto' ? 'auto' : 'choice-unavailable' };
  return { id: fallback ?? null, why: 'none' };
}
