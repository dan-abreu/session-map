import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelsOf } from './models.mjs';
import { levelsOf } from './efforts.mjs';
import { CODEX_LEVELS } from './clis.mjs';

// What each AI itself offers a conversation (id179, pc41): its models, its reasoning levels in its own words, the level a
// model starts on and its own extras. Read from the program that runs the talk wherever that program says it, never from
// one generic scale. Checked on 2026-10-17 against each maker's documentation, the installed programs and real calls:
//   Claude   Claude Code 2.1.301: "Effort" low, medium, high, xhigh, max (--effort); Opus 5.5, Sonnet 5.5 and Haiku 5.5
//            start on medium, Fable 5.1 on high (code.claude.com/docs/en/model-config). Ultracode is a setting, not a level:
//            --settings {"ultracode":true} turns it on at the level picked; get_settings showed it applied on all four.
//   DeepSeek through Claude Code (api.deepseek.com/anthropic): "Effort" low, high, max, sent as output_config.effort (seen
//            on the wire); medium and xhigh are only DeepSeek's aliases of high. Thinking cannot be turned off on this way:
//            Claude Code drops its thinking field, DeepSeek keeps thinking unless told {type: disabled}.
//   OpenAI   Codex CLI: its own catalog (codex-home/models_cache.json) lists the models it shows, each with its levels
//            ("Reasoning effort", up to max, and ultra: "Maximum reasoning with automatic task delegation"), their
//            descriptions and its default; -c model_reasoning_effort carries the level.
//   Gemini   Gemini CLI: "Thinking level" minimal (Flash-Lite only), low, medium, high (ai.google.dev/gemini-api/docs/
//            thinking); the level rides in a model alias as thinkingLevel, sent raw to the API (MINIMAL and MEDIUM
//            accepted on real calls, a wrong value refused with 400).

export const TERMS = Object.freeze({ claude: 'Effort', deepseek: 'Effort', openai: 'Reasoning effort', gemini: 'Thinking level' });

const CLAUDE_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
// The level each Claude model starts on (docs): medium on the 5.5 family, high on the others that take an effort.
const CLAUDE_START = Object.freeze({ opus: 'medium', sonnet: 'medium', haiku: 'medium', fable: 'high' });
// The models Claude Code runs ultracode on (get_settings: ultracodeAvailable true on all four; false on the 4.x ones).
const ULTRACODE = new Set(['opus', 'sonnet', 'haiku', 'fable']);
const DEEPSEEK_LEVELS = Object.freeze(['low', 'high', 'max']);
const GEMINI_WORDS = Object.freeze(['minimal', 'low', 'medium', 'high']);
// The level each Gemini model starts on, as its maker documents it (the CLI alone would ask HIGH of every 3.x model).
const GEMINI_START = Object.freeze({ 'gemini-3.1-flash-lite': 'minimal', 'gemini-3.5-flash-lite': 'minimal', 'gemini-3.8-flash': 'medium' });

const current = (provider) => modelsOf(provider).filter((m) => m.group === 'current' && !m.gone);
const startOf = (levels, wanted) => (levels.includes(wanted) ? wanted : levels.includes('high') ? 'high' : levels.at(-1) ?? null);

function claudeModels() {
  return current('claude').map((m) => {
    const levels = levelsOf('claude', m.id).filter((l) => CLAUDE_LEVELS.includes(l));
    return { id: m.id, name: m.name, note: { en: m.noteEn ?? null, pt: m.notePt ?? null }, levels: levels.map((id) => ({ id })), start: startOf(levels, CLAUDE_START[m.id]), ultracode: ULTRACODE.has(m.id) };
  });
}

function deepseekModels() {
  return current('deepseek').map((m) => {
    const levels = levelsOf('deepseek', m.id).filter((l) => DEEPSEEK_LEVELS.includes(l));
    return { id: m.id, name: m.name, note: null, levels: levels.map((id) => ({ id })), start: startOf(levels, 'high') };
  });
}

// Codex's own catalog, as it fetched it for this account: the models it lists, never the hidden ones.
export function codexCatalog(smDir) {
  try {
    const j = JSON.parse(readFileSync(join(smDir, 'codex-home', 'models_cache.json'), 'utf8'));
    return (Array.isArray(j?.models) ? j.models : []).filter((m) => m && typeof m.slug === 'string' && m.visibility === 'list').map((m) => {
      const levels = (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        // A word Codex might add one day is not offered until the program knows how to pass it.
        .filter((l) => typeof l?.effort === 'string' && CODEX_LEVELS.includes(l.effort)).map((l) => ({ id: l.effort, ...(typeof l.description === 'string' ? { about: l.description } : {}) }));
      const ids = levels.map((l) => l.id);
      return { id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug, note: typeof m.description === 'string' ? { en: m.description, pt: null } : null, levels, start: startOf(ids, m.default_reasoning_level) };
    });
  } catch {
    return null;
  }
}

function openaiModels(smDir) {
  const listed = smDir ? codexCatalog(smDir) : null;
  if (listed?.length) return listed;
  return current('openai').map((m) => {
    const levels = levelsOf('openai', m.id).filter((l) => l !== 'auto');
    return { id: m.id, name: m.name, note: null, levels: levels.map((id) => ({ id })), start: startOf(levels, 'medium') };
  });
}

function geminiModels() {
  return current('gemini').map((m) => {
    const levels = levelsOf('gemini', m.id).filter((l) => GEMINI_WORDS.includes(l));
    return { id: m.id, name: m.name, note: null, levels: levels.map((id) => ({ id })), start: startOf(levels, GEMINI_START[m.id] ?? 'high') };
  });
}

// -> { term, models: [{ id, name, note, levels: [{ id, about? }], start, ultracode? }] } for one AI.
export function nativeCatalog(ai, { smDir = null } = {}) {
  const models = ai === 'claude' ? claudeModels() : ai === 'deepseek' ? deepseekModels() : ai === 'openai' ? openaiModels(smDir) : ai === 'gemini' ? geminiModels() : [];
  return { term: TERMS[ai] ?? null, models };
}

// The person's pick checked against what that AI offers: -> { model, effort, ultracode } or null.
export function nativePick(ai, { model, effort, ultracode = false }, { smDir = null } = {}) {
  const m = nativeCatalog(ai, { smDir }).models.find((x) => x.id === model);
  if (!m) return null;
  const level = effort ?? m.start;
  if (level !== null && !m.levels.some((l) => l.id === level)) return null;
  if (ultracode && !m.ultracode) return null;
  return { model: m.id, effort: level, ultracode: Boolean(ultracode) };
}
