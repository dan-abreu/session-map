// The reasoning-level vocabulary of each engine (id124, or41): every AI names its levels differently, and the Cérebro
// shows each one in its own words. Verified against each maker's own documentation on 2026-10-14:
//   Claude  — code.claude.com/docs/en/model-config: effort levels low, medium, high, xhigh, max (defaults: medium on
//             Opus 5.5, Sonnet 5.5 and Haiku 5.5; high on the others; a level a model does not support falls back to
//             the highest supported one at or below it). "ultracode" is NOT max: it is a Claude Code SETTING that
//             plans a dynamic workflow per task, available only when the model supports xhigh (--effort ultracode).
//   DeepSeek — api-docs.deepseek.com/guides/thinking_mode: thinking {type: enabled|disabled} (enabled is the default,
//             effort high) and reasoning_effort low|high|max (minimal→low, medium→high, xhigh→high, max→max, ultra→max).
//   OpenAI  — developers.openai.com/api/docs/guides/reasoning: none, minimal, low, medium, high, xhigh, max
//             (model-dependent); GPT-6 Astra refuses none; GPT-6.1 Sol refuses none and minimal (defaults medium).
//   Gemini  — ai.google.dev/gemini-api/docs/gemini-3: thinking levels minimal, low, medium, high (default high);
//             Gemini 3.1 Pro does not support minimal; 3.1/3.5 Flash-Lite supports minimal (its default);
//             3.8 Flash refuses minimal (the repo's own 2026-10-10 check). session-map calls the OpenAI-compatible
//             endpoint, so the field is reasoning_effort.
// One mechanical table: the selectors draw from it, the validator checks against it, and the API call maps it to
// each provider's own field (effortBody). A level that does not fit the resolved engine is never applied.

import { listedEntry } from './model-registry.mjs';

// The union of every level word, for tolerant reading: a stored choice survives a provider change.
export const LEVEL_UNION = Object.freeze(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);

// Per provider: the levels its models accept. Model-specific lists refine it.
export const LEVELS_BY_PROVIDER = Object.freeze({
  claude: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  deepseek: Object.freeze(['off', 'low', 'high', 'max']),
  openai: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  gemini: Object.freeze(['minimal', 'low', 'medium', 'high']),
  openrouter: Object.freeze(['auto']),
});

// Per model, from the sources above PLUS the real cent-by-cent validation of 2026-10-14
// (.dev/execucao/validate-levels.mjs → smDir/bench/levels.json): Luna refuses low (400), Sol refuses max (400),
// Astra refuses minimal (400). A model not listed takes its provider's.
const LEVELS_BY_MODEL = Object.freeze({
  haiku: Object.freeze(['low', 'medium', 'high']),
  sonnet: Object.freeze(['low', 'medium', 'high', 'xhigh']),
  opus: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  fable: Object.freeze(['high', 'xhigh', 'max']),
  'deepseek-flash': Object.freeze(['off', 'low', 'high']),
  'deepseek-v4-flash': Object.freeze(['off', 'low', 'high']),
  'deepseek-v4-pro': Object.freeze(['off', 'low', 'high', 'max']),
  'gpt-6-luna': Object.freeze(['none']),
  'gpt-6.1-sol': Object.freeze(['low', 'medium', 'high', 'xhigh']),
  'gpt-6-astra': Object.freeze(['low', 'medium', 'high', 'xhigh']),
  'gemini-3.1-flash-lite': Object.freeze(['minimal', 'low', 'medium', 'high']),
  'gemini-3.5-flash-lite': Object.freeze(['minimal', 'low', 'medium', 'high']),
  'gemini-3.8-flash': Object.freeze(['low', 'medium', 'high']),
});

// What the maker's own list says (id168): Claude Code names the levels of each model it serves and DeepSeek's /models does
// too, and what the maker says today wins over the table above. For the rest the table wins, and a list read from the
// maker gives the model it does not know the cautious set (low, medium, high) or none at all (an old model), never the
// provider's whole vocabulary: a field the model refuses would make the call fail.
const NO_LEVELS = Object.freeze(['auto']);

// The levels a (provider, model) accepts: the maker's list, else the model's own, else the provider's. openrouter has no
// vocabulary of its own: the routed model decides at call time.
export function levelsOf(provider, model) {
  const listed = model ? listedEntry(provider, model) : null;
  if (listed?.levelsFrom === 'maker' && Array.isArray(listed.levels)) return listed.levels.length ? Object.freeze([...listed.levels]) : NO_LEVELS;
  const byModel = model && LEVELS_BY_MODEL[model];
  if (byModel) return byModel;
  if (listed?.levelsFrom === 'guess' && Array.isArray(listed.levels)) return listed.levels.length ? Object.freeze([...listed.levels]) : NO_LEVELS;
  const byProvider = LEVELS_BY_PROVIDER[provider];
  if (byProvider) return byProvider;
  return LEVELS_BY_PROVIDER.openrouter;
}

// The separate top button of a (provider, model): Claude's own is ultracode (a dynamic-workflow setting, only where
// the model supports xhigh); the others' top is max, where the model accepts it. Never part of the select list.
export function topLevelOf(provider, model) {
  if (provider === 'claude') {
    return levelsOf(provider, model).includes('xhigh') ? 'ultracode' : null;
  }
  if (provider === 'deepseek' || provider === 'openai') {
    return levelsOf(provider, model).includes('max') ? 'max' : null;
  }
  return null;
}

// The request body that applies one level to one provider's API, and the reasoning room it needs. The fields are each
// provider's own (sources above): Claude goes through its CLI (--effort), never here — ultracode included.
export function effortBody(provider, model, effort) {
  const e = String(effort ?? '');
  if (!LEVEL_UNION.includes(e)) return {};
  if (e === 'ultracode') return {}; // a Claude Code setting, sent through its CLI only
  if (provider === 'deepseek') {
    if (e === 'off') return { body: { thinking: { type: 'disabled' } } };
    return { body: { thinking: { type: 'enabled' }, reasoning_effort: e } };
  }
  if (provider === 'openai') {
    return { body: { reasoning_effort: e } };
  }
  if (provider === 'gemini') {
    const room = e === 'medium' ? 2048 : e === 'high' ? 4096 : 1024;
    return { body: { reasoning_effort: e }, reasoningRoomTokens: room };
  }
  return {};
}
