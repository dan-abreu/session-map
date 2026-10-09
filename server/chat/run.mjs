import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { readRunBlock } from '../web/chatfold.js';

export { readRunBlock };

// How a page conversation runs: which model, at which effort, and with which way of working (plano-v02 item 12).
//   auto      Opus at high sizes each request; large or sensitive work waits for the person's OK (or the monthly allowance).
//   maestro   Opus at high hands the parts to helpers with an explicit model and effort, without asking.
//   ultracode the documented `--effort ultracode`: a workflow for every substantive task, at xhigh.
//   fixed     one model at one effort, nothing added.
//   settings  no flags: whatever the person's own Claude settings say.
export const MODELS = ['haiku', 'sonnet', 'opus'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_RUN = Object.freeze({ kind: 'auto', selfReinforce: false });

const LIMIT_MAX = 100_000;
const SPEND_FILE = 'reinforced-spend.json';
const CONFIG_FILE = 'config.json';

// → the run as stored and passed on, or null for anything the page must not send to claude.
export function parseRun(value) {
  if (!value || typeof value !== 'object') return null;
  switch (value.kind) {
    case 'auto': return { kind: 'auto', selfReinforce: value.selfReinforce === true };
    case 'maestro':
    case 'ultracode':
    case 'settings': return { kind: value.kind };
    case 'fixed': return MODELS.includes(value.model) && EFFORTS.includes(value.effort) ? { kind: 'fixed', model: value.model, effort: value.effort } : null;
    default: return null;
  }
}

const BLOCK = [
  'End every reply with this fenced block, so session-map can show the person what is running and why:',
  '```session-map-run',
  '{"level": "direct" | "helpers" | "reinforced"__ASK__, "why": "a short reason in the person\'s language, at most 12 words"__EST__}',
  '```',
].join('\n');

const SIZING = [
  'Size each request before acting. When the person\'s CLAUDE.md has a rule for sizing work and picking models, follow it; otherwise:',
  '- trivial or small (a question, one command, a fix in one file): do it yourself, directly ("direct").',
  '- medium (a feature across a few files, a broad search): hand the parts to subagents, each with an explicit model and effort (haiku at low for searching and reading, sonnet at medium for mechanical code and text, opus at high for business rules, integrations and security), then review what they return ("helpers").',
];

const AUTO_PROMPT = [
  'You are the maestro of this conversation, started from session-map in Automatic mode. You run on Opus at high effort.',
  ...SIZING,
  '- large or sensitive (a new system, a change across layers, sign-in, security, personal data, money, production, deleting things, commit or push): this needs the reinforced way of working, in the style of ultracode: a planned workflow of agents with adversarial verification, which costs several times more. Do not start it on your own. First explain in plain words, in the person\'s language, why it needs reinforcing, what you will do and an estimated cost in US dollars, then end the reply with level "ask-reinforce" and the estimate, and wait.',
  'When the person answers that you may reinforce, work that way until the task is done and report "reinforced". When they say no, do it the normal way.',
  BLOCK.replace('__ASK__', ' | "ask-reinforce"').replace('__EST__', ', "estimateUSD": number (only with ask-reinforce)'),
].join('\n');

const MAESTRO_PROMPT = [
  'You are the maestro of this conversation, started from session-map in Maestro mode. You run on Opus at high effort.',
  ...SIZING,
  '- large or sensitive (a new system, a change across layers, sign-in, security, personal data, money, production): plan a workflow of subagents, each with an explicit model and effort, verify their work before you report it done ("reinforced").',
  BLOCK.replace('__ASK__', '').replace('__EST__', ''),
].join('\n');

export function runPrompt(run) {
  if (run.kind === 'auto') return AUTO_PROMPT;
  if (run.kind === 'maestro') return MAESTRO_PROMPT;
  return null;
}

// Flags from a fixed list only: nothing the page sends reaches the command line as text.
export function runArgs(run) {
  switch (run.kind) {
    case 'auto':
    case 'maestro': return ['--model', 'opus', '--effort', 'high', '--append-system-prompt', runPrompt(run)];
    case 'ultracode': return ['--model', 'opus', '--effort', 'ultracode'];
    case 'fixed': return ['--model', run.model, '--effort', run.effort];
    default: return [];
  }
}

// mine: settingsRun() of the conversation's folder, what "Same as my Claude" runs.
export function expectedRun(run, mine) {
  switch (run.kind) {
    case 'auto':
    case 'maestro': return { model: 'opus', effort: 'high', ultracode: false };
    case 'ultracode': return { model: 'opus', effort: 'xhigh', ultracode: true };
    case 'fixed': return { model: run.model, effort: run.effort, ultracode: false };
    default: return mine;
  }
}

const objectOr = (v, fallback) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fallback);

// A model name as Claude Code keys modelSettings: the canonical name, without [1m] or a date ("claude-opus-5-5"), or a bare
// alias ("opus"), which stands for the newest of its family. version: 5.5 for claude-opus-5-5, Infinity for an alias.
function modelKey(name) {
  const key = String(name).replace(/\[1m\]$/i, '').replace(/-\d{8}$/, '');
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(key);
  if (m) return { key, family: m[1], version: Number(`${m[2]}.${m[3] ?? 0}`) };
  return { key, family: key, version: Infinity };
}

// The level a file saved for this model: under its canonical name, or, for an alias, under the newest of its family.
function savedLevel(modelSettings, model) {
  const want = modelKey(model);
  const entries = Object.entries(objectOr(modelSettings, {})).map(([name, v]) => ({ ...modelKey(name), level: objectOr(v, {}).effortLevel }));
  const exact = entries.find((e) => e.key === want.key);
  if (exact) return exact.level;
  if (want.version !== Infinity) return undefined;
  return entries.filter((e) => e.family === want.family).sort((a, b) => b.version - a.version)[0]?.level;
}

// What "Same as my Claude" runs: model, ultracode and the effort for that model, as code.claude.com/docs/en/settings-reference
// resolves them: the more specific file wins; within a file a saved per-model level beats the top-level effortLevel, which
// in the user file no longer applies to Opus 5.5 and later (they start at their own default, shown as "default" here).
export function settingsRun(root, dir) {
  const userFile = join(dir, 'settings.json');
  const files = [userFile, join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')]
    .map((file) => ({ file, s: objectOr(readJsonFile(file, null), null) })).filter((f) => f.s);
  let model = null;
  let ultracode = false;
  for (const { s } of files) {
    if (typeof s.model === 'string' && s.model) model = s.model;
    if (typeof s.ultracode === 'boolean') ultracode = s.ultracode;
  }
  let effort = null;
  for (const { file, s } of files) {
    const own = model ? savedLevel(s.modelSettings, model) : undefined;
    const topApplies = file !== userFile || !model || modelKey(model).version < 5.5;
    const level = EFFORTS.includes(own) ? own : topApplies ? s.effortLevel : undefined;
    if (EFFORTS.includes(level)) effort = level;
  }
  return { model, effort, ultracode };
}

// "May reinforce on its own": allowed in the conversation, a monthly limit set, and the estimate still fits. Past it, ask again.
export function mayReinforce({ selfReinforce, limitUSD, spentUSD, estimateUSD }) {
  if (!selfReinforce || !(limitUSD > 0)) return false;
  return spentUSD + (Number.isFinite(estimateUSD) ? estimateUSD : 0) <= limitUSD && spentUSD < limitUSD;
}

const monthOf = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

export function reinforcedSpend(smDir, now = new Date()) {
  const usd = objectOr(readJsonFile(join(smDir, SPEND_FILE), {}), {})[monthOf(now)];
  return Number.isFinite(usd) ? usd : 0;
}

export function addReinforcedSpend(smDir, usd, now = new Date()) {
  if (!(Number.isFinite(usd) && usd > 0)) return;
  const month = monthOf(now);
  const all = objectOr(readJsonFile(join(smDir, SPEND_FILE), {}), {});
  // Only this month and the last few are kept: the file is a counter, not a ledger.
  const kept = Object.fromEntries(Object.entries(all).filter(([m]) => m >= monthOf(new Date(now.getFullYear(), now.getMonth() - 11, 1))));
  kept[month] = (Number.isFinite(kept[month]) ? kept[month] : 0) + usd;
  writeAtomic(join(smDir, SPEND_FILE), `${JSON.stringify(kept, null, 2)}\n`);
}

export function reinforcedLimit(smDir) {
  const usd = objectOr(objectOr(readJsonFile(join(smDir, CONFIG_FILE), {}), {}).budget, {}).reinforcedMonthlyUSD;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

// session-map's own config.json (budget.reinforcedMonthlyUSD), merged: every other key stays as the person wrote it.
export function setReinforcedLimit(smDir, usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > LIMIT_MAX) return { ok: false, error: 'bad-limit' };
  const file = join(smDir, CONFIG_FILE);
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  if (!objectOr(config, null) || (config.budget !== undefined && !objectOr(config.budget, null))) return { ok: false, error: 'config-unreadable' };
  writeAtomic(file, `${JSON.stringify({ ...config, budget: { ...config.budget, reinforcedMonthlyUSD: usd } }, null, 2)}\n`);
  return { ok: true, limitUSD: usd };
}

export const RUN_NOTE_HEAD = '[session-map: the way this conversation runs changed]';
export const RUN_NOTE_END = '[end of the session-map note; the person\'s message follows]';

const NOTE = {
  ultracode: 'From now on ultracode is on: plan a workflow for each substantive task.',
  fixed: 'From now on there is no session-map orchestration rule: work the way you normally would.',
  settings: 'From now on there is no session-map orchestration rule: work the way you normally would.',
};

// claude keeps the first system prompt of a conversation for good (--system-prompt-snapshot), so a change of way
// of working mid-conversation travels in the message instead.
export function withRunNote(run, text) {
  const note = runPrompt(run) ?? NOTE[run.kind];
  return `${RUN_NOTE_HEAD}\n${note}\n${RUN_NOTE_END}\n\n${text}`;
}
