// The Claude models as Claude Code itself lists them (id168, or72). The model picker of the VS Code extension is drawn from
// the answer of the CLI to its own "initialize" request ({value, displayName, description, supportedEffortLevels}); the
// Cérebro asks the same question (models.mjs), so both show the same list. This file holds what needs no question: the
// words, the shape of a valid value and the list as it was on 2026-10-16 (Claude Code 2.1.301), kept for the day the CLI
// cannot be asked. Imports nothing: the hooks and the book program read it too.

// The four aliases the Agent tool accepts (its `model` field is exactly this list): a Claude agent can run on these and on
// nothing else, so a row run by agents offers no other Claude model.
export const AGENT_MODELS = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);

// What `claude --model` takes: an alias or a full model id. Nothing else ever reaches the command line.
export const CLAUDE_MODEL_RE = /^(?:haiku|sonnet|opus|fable|claude-[a-z0-9.-]+)$/;
export const isClaudeModel = (m) => typeof m === 'string' && CLAUDE_MODEL_RE.test(m);
export const isAgentModel = (m) => AGENT_MODELS.includes(m);

// The maker's one-line descriptions in Portuguese (the CLI answers in English); a description not here stays as it came.
export const NOTE_PT = Object.freeze({
  'For complex work and everyday tasks': 'Para trabalho complexo e tarefas do dia a dia',
  'For your toughest challenges': 'Para os desafios mais difíceis',
  'Most efficient for simpler tasks': 'O mais eficiente para tarefas mais simples',
  'Fastest for quick answers': 'O mais rápido para respostas curtas',
  'Efficient for routine tasks': 'Eficiente para tarefas de rotina',
  'Best for everyday, complex tasks': 'O melhor para tarefas complexas do dia a dia',
  'Most capable for your hardest and longest-running tasks': 'O mais capaz para as tarefas mais difíceis e mais longas',
});

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];
const entry = (id, name, resolved, noteEn, levels = ALL) => Object.freeze({ id, name, resolved, noteEn, notePt: NOTE_PT[noteEn] ?? noteEn, levels: Object.freeze([...levels]), levelsFrom: 'maker' });

// The list of Claude Code 2.1.301, without its "Default (recommended)" line: the Cérebro's own "automatic" already means the
// default, and it would only repeat Opus 5.5.
export const CLAUDE_FALLBACK = Object.freeze([
  entry('opus', 'Opus 5.5', 'claude-opus-5-5', 'For complex work and everyday tasks'),
  entry('fable', 'Fable 5.1', 'claude-fable-5-1', 'For your toughest challenges'),
  entry('sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5', 'Most efficient for simpler tasks'),
  entry('haiku', 'Haiku 5.5', 'claude-haiku-5-5', 'Fastest for quick answers'),
  entry('claude-haiku-4-5-20251001', 'Haiku 4.5', 'claude-haiku-4-5-20251001', 'Fastest for quick answers', []),
  entry('claude-sonnet-5', 'Sonnet 5', 'claude-sonnet-5', 'Efficient for routine tasks'),
  entry('claude-opus-5', 'Opus 5', 'claude-opus-5', 'Best for everyday, complex tasks'),
  entry('claude-fable-5', 'Fable 5', 'claude-fable-5', 'Most capable for your hardest and longest-running tasks'),
  entry('claude-opus-4-8', 'Opus 4.8', 'claude-opus-4-8', 'Best for everyday, complex tasks'),
  entry('claude-opus-4-7', 'Opus 4.7', 'claude-opus-4-7', 'Best for everyday, complex tasks'),
  entry('claude-opus-4-6', 'Opus 4.6', 'claude-opus-4-6', 'Best for everyday, complex tasks', ['low', 'medium', 'high', 'max']),
  entry('claude-sonnet-4-6', 'Sonnet 4.6', 'claude-sonnet-4-6', 'Efficient for routine tasks', ['low', 'medium', 'high', 'max']),
]);
