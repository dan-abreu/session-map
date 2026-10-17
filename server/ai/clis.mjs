import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { writeAtomic } from '../store.mjs';

// The official programs of OpenAI (Codex CLI) and Google (Gemini CLI), for the work the Cérebro gives their AIs (id171): the
// talk of the page and the work handed over in an isolated copy. Checked on 2026-10-17 with Codex CLI 0.163.0 and Gemini CLI
// 0.64.0, each run with the owner's key and a real file:
//   Codex  — `codex exec --json`: one turn per run, `exec resume <thread>` continues it; -m the model, -c
//            model_reasoning_effort the level; the key in CODEX_API_KEY; --approve-for-me runs commands under its own review
//            (with the plain sandbox every command was "blocked by policy" on Windows).
//   Gemini — `gemini -p … -o stream-json`: one turn per run, --resume <session id> continues it, --session-id names a new one;
//            -m the model; the level has no flag: a model alias of its settings sets thinkingLevel (thinkingBudget for 2.5);
//            the key in GEMINI_API_KEY; --approval-mode the permissions.
// Both are npm packages whose Windows launcher is a .cmd that Node cannot start without a shell (a shell would read the
// brief as commands): the program runs `node <its script>` instead. Each keeps its sessions in a home of its own under the
// map's folder, never the owner's own ~/.codex or ~/.gemini.

const PACKAGES = Object.freeze({
  openai: { pkg: ['@openai', 'codex'], script: ['bin', 'codex.js'], home: 'codex-home', keyEnv: 'CODEX_API_KEY', homeEnv: 'CODEX_HOME' },
  gemini: { pkg: ['@google', 'gemini-cli'], script: ['bundle', 'gemini.js'], home: 'gemini-home', keyEnv: 'GEMINI_API_KEY', homeEnv: 'GEMINI_CLI_HOME' },
});

// The npm folders a global package can be in: the configured prefix, Windows' AppData default, the Unix default.
function npmRoots(env) {
  const roots = [];
  if (env.npm_config_prefix) roots.push(process.platform === 'win32' ? join(env.npm_config_prefix, 'node_modules') : join(env.npm_config_prefix, 'lib', 'node_modules'));
  if (env.APPDATA) roots.push(join(env.APPDATA, 'npm', 'node_modules'));
  for (const d of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) roots.push(join(d, 'node_modules'), join(d, '..', 'lib', 'node_modules'));
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
  return roots;
}

// -> the script to run with node, or null when that AI's program is not installed.
export function findCli(provider, { env = process.env, exists = existsSync } = {}) {
  const p = PACKAGES[provider];
  if (!p) return null;
  for (const root of npmRoots(env)) {
    const script = join(root, ...p.pkg, ...p.script);
    if (exists(script)) return script;
  }
  return null;
}

export const cliHome = (smDir, provider) => join(smDir, PACKAGES[provider].home);

// What a run of that program needs: its own home and the key, which lives in this process's memory for the run only.
export function cliEnv(smDir, provider, key) {
  const p = PACKAGES[provider];
  const home = cliHome(smDir, provider);
  try { mkdirSync(home, { recursive: true }); } catch { /* the program says so when it cannot write */ }
  return { [p.homeEnv]: home, [p.keyEnv]: key };
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const plainModel = (m) => (typeof m === 'string' && MODEL_RE.test(m) ? m : null);

// Codex's words for the level (its config takes these five); a level it has no word for is left out.
export const CODEX_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
// Gemini's levels through the alias: LOW, MEDIUM and HIGH of Gemini 3; the 2.5 line thinks by a budget of tokens.
export const GEMINI_LEVELS = Object.freeze(['low', 'medium', 'high']);
const BUDGET_25 = Object.freeze({ low: 1024, medium: 8192, high: 24576 });

// The alias that carries a level to Gemini CLI: one per model and level, all kept in its settings file.
export const geminiAlias = (model, level) => `sm-${model}-${level}`;

function geminiAliasEntry(model, level) {
  const thinking = /^gemini-2\.5/.test(model) ? { thinkingBudget: BUDGET_25[level] } : { thinkingLevel: level.toUpperCase() };
  // A 2.5 model takes a budget and no level: its alias extends the 2.5 base (with Gemini 3's base the call carried both and
  // was refused, in the test of 2026-10-17).
  return { extends: /^gemini-2.5/.test(model) ? 'chat-base-2.5' : 'chat-base-3', modelConfig: { model, generateContentConfig: { thinkingConfig: { includeThoughts: true, ...thinking } } } };
}

// Writes the aliases for these models into Gemini CLI's settings (its home's .gemini/settings.json), keeping anything else
// the file holds. Called before a run that names a level; the same content writes nothing.
export function writeGeminiAliases(smDir, models) {
  const dir = join(cliHome(smDir, 'gemini'), '.gemini');
  const file = join(dir, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { settings = {}; }
  const aliases = { ...(settings.modelConfigs?.customAliases ?? {}) };
  for (const m of models.map(plainModel).filter(Boolean)) for (const l of GEMINI_LEVELS) aliases[geminiAlias(m, l)] = geminiAliasEntry(m, l);
  const next = { ...settings, modelConfigs: { ...(settings.modelConfigs ?? {}), customAliases: aliases } };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  try {
    if (readFileSync(file, 'utf8') === text) return file;
  } catch { /* first write */ }
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, text);
  return file;
}

// The model argument of one run: Gemini's alias when a level is named, the plain model otherwise.
export function modelArgs(provider, { model, effort } = {}) {
  const m = plainModel(model);
  if (provider === 'openai') {
    return [...(m ? ['-m', m] : []), ...(CODEX_LEVELS.includes(effort) ? ['-c', `model_reasoning_effort="${effort}"`] : [])];
  }
  if (provider === 'gemini') {
    if (!m) return [];
    return ['-m', GEMINI_LEVELS.includes(effort) ? geminiAlias(m, effort) : m];
  }
  return [];
}

// The permissions of a run, from the page's mode: plan reads only; everything else edits the folder. Codex reviews its own
// commands (what --approve-for-me sets, spelled as config so `exec resume`, which has no such flag, takes it too: checked
// on 2026-10-17, a resumed run without it had every command blocked); Gemini edits on its own and asks before a command,
// which a run with nobody to answer refuses.
export function permissionArgs(provider, mode) {
  if (provider === 'openai') {
    return ['-c', 'approvals_reviewer="auto_review"', '-c', 'approval_policy="on-request"', '-c', `sandbox_mode="${mode === 'plan' ? 'read-only' : 'workspace-write'}"`];
  }
  if (provider === 'gemini') return ['--approval-mode', mode === 'plan' ? 'plan' : mode === 'bypassPermissions' ? 'yolo' : 'auto_edit'];
  return [];
}

// One turn of a conversation: the arguments after `node <script>`. session: the thread to continue, or null for a new one
// (Gemini is given the id it will use, so the page knows it before the first line).
export function turnArgs(provider, { session = null, newSession = null, prompt, model, effort, mode }) {
  if (provider === 'openai') {
    const base = ['exec', '--json', '--skip-git-repo-check', ...modelArgs('openai', { model, effort }), ...permissionArgs('openai', mode)];
    return session ? ['exec', 'resume', session, ...base.slice(1), prompt] : [...base, prompt];
  }
  if (provider === 'gemini') {
    return ['-p', prompt, '-o', 'stream-json', '--skip-trust', ...modelArgs('gemini', { model, effort }), ...permissionArgs('gemini', mode),
      ...(session ? ['--resume', session] : newSession ? ['--session-id', newSession] : [])];
  }
  return null;
}

// The work handed over in an isolated copy (run_other_ai): one run, the brief as the prompt, edits allowed in the copy.
export function handoffArgs(provider, { brief, model, effort }) {
  if (provider === 'openai') return ['exec', '--skip-git-repo-check', ...modelArgs('openai', { model, effort }), ...permissionArgs('openai', 'acceptEdits'), brief];
  if (provider === 'gemini') return ['-p', brief, '--skip-trust', ...modelArgs('gemini', { model, effort }), '--approval-mode', 'yolo'];
  return null;
}
