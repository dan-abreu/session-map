import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

// Which engines can run a specialist today (id151, or62): each company's official agent, detected on the machine —
// plain data for the Cérebro. claude: the Agent tool, held by the guard's hooks. codex (OpenAI) and gemini (Google):
// their CLIs, run by the executor in an isolated copy (server/ai/agents-run.mjs, or61). deepseek: the DeepSeek Harness
// (`dsh headless`, id156), or else Claude Code pointed at DeepSeek's Anthropic-compatible endpoint. Everything else
// answers through the API only.

// The real detection: the command that names the binary on this system. A missing binary fails open: 'api'.
export const commandExists = (name, exec = execFileSync) => {
  try {
    exec(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

// The first path the system finds for a command, or null (a launcher on Windows is the .cmd, never the bare name).
const whereOf = (name, exec = execFileSync) => {
  try {
    const out = String(exec(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true }));
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return (process.platform === 'win32' ? lines.find((l) => /\.cmd$/i.test(l)) : null) ?? lines[0] ?? null;
  } catch {
    return null;
  }
};

// The DeepSeek Harness' own launcher (id156): {command, args, env} to run `dsh` with no shell, or null. On Windows the
// launcher is a .cmd, which Node cannot start without a shell, and a shell would read the brief as commands; so the
// program runs what the launcher itself names (its .exe, its arguments, its `set` lines), with %~dp0 as the launcher's
// folder. Anything the launcher does not say plainly gives null: the status then falls back to the other ways.
export function findDsh({ where = whereOf, read = (p) => readFileSync(p, 'utf8'), exists = existsSync, platform = process.platform } = {}) {
  const launcher = where('dsh');
  if (!launcher) return null;
  if (platform !== 'win32') return { command: launcher, args: [], env: {} };
  let text;
  try { text = read(launcher); } catch { return null; }
  // A Windows launcher is read with Windows paths whatever machine reads it (the tests do on any system).
  const base = win32.dirname(launcher) + win32.sep;
  const sub = (s) => (s.includes('%~dp0') ? win32.resolve(s.replaceAll('%~dp0', base)) : s);
  const line = text.split(/\r?\n/).find((l) => /^\s*"[^"]*%~dp0[^"]*\.exe"/i.test(l));
  const m = line?.match(/^\s*"([^"]+\.exe)"\s*(.*?)\s*%\*\s*$/i);
  if (!m) return null;
  const command = sub(m[1]);
  if (!exists(command)) return null;
  const args = [...m[2].matchAll(/"([^"]*)"|(\S+)/g)].map((x) => sub(x[1] ?? x[2]));
  const env = {};
  for (const l of text.split(/\r?\n/)) {
    const e = l.match(/^\s*set\s+"([A-Za-z_][A-Za-z0-9_]*)=([^"]*)"\s*$/i);
    if (e) env[e[1]] = e[2];
  }
  return { command, args, env };
}

// The overlay that gives one Harness run the model and level of the Cérebro's row (id156). The Harness takes both per run
// through --patch (its agent-default-model: provider, model, reasoningEffort); proved on 2026-10-15: an unknown model or a
// made-up level makes the run fail, the real ones run. The file holds no secret and its name is its content's hash, so the
// same choice is the same file. -> the path, or null when the row chose neither (the Harness keeps its own defaults).
const DSH_EFFORTS = new Set(['off', 'low', 'high', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function dshOverlay(choice, { dir = tmpdir(), write = writeFileSync } = {}) {
  const model = typeof choice?.model === 'string' && MODEL_RE.test(choice.model) ? choice.model : null;
  const effort = DSH_EFFORTS.has(choice?.effort) ? choice.effort : null;
  if (!model && !effort) return null;
  // The Harness asks for provider and model together; its own DeepSeek is the provider, deepseek-flash its default model.
  const text = ['- id: agent-default-model', '  config:', '    provider: deepseek-official', `    model: ${model ?? 'deepseek-flash'}`, ...(effort ? [`    reasoningEffort: ${effort}`] : [])].join('\n') + '\n';
  const file = join(dir, `session-map-dsh-${createHash('sha1').update(text).digest('hex').slice(0, 12)}.yml`);
  try { write(file, text); } catch { return null; }
  return file;
}

// -> {provider: {edits, note}}; edits: 'hooks' (inside Claude Code), 'worktree' (an isolated copy by the executor),
// 'claude-base' (Claude Code pointed at another family), or 'api' (answers only). bin injected for the tests.
export function enginesStatus({ bin = commandExists } = {}) {
  const deepseek = bin('dsh')
    ? { edits: 'worktree', note: 'DeepSeek Harness (dsh headless) in an isolated copy' }
    : bin('claude')
      ? { edits: 'claude-base', note: 'Claude Code pointed at DeepSeek, the same hooks hold it' }
      : { edits: 'api', note: 'answers through the API' };
  return {
    claude: { edits: 'hooks', note: 'the Agent tool, held by the guard' },
    openai: bin('codex') ? { edits: 'worktree', note: 'Codex CLI in an isolated copy' } : { edits: 'api', note: 'answers through the API' },
    gemini: bin('gemini') ? { edits: 'worktree', note: 'Gemini CLI in an isolated copy' } : { edits: 'api', note: 'answers through the API' },
    deepseek,
  };
}

// The engine descriptor the executor runs, per provider that has a worktree CLI today. deepseek runs the Harness when
// the caller found it (dsh: findDsh's answer, which signs in by itself, so no token), else Claude Code pointed at
// DeepSeek with the caller's token (the key never lives here).
const patchArgs = (choice) => {
  const file = dshOverlay(choice);
  return file ? ['--patch', file] : [];
};

// The model and level of the Cérebro's row ride on the other CLIs too (id168): Codex takes -m for the model and a config
// override for the reasoning effort, Gemini CLI takes -m (it has no level flag). The words are checked here, so a value the
// page sent can never become anything but one argument; a level Codex has no word for (none, max) is left out.
const CODEX_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const modelFlag = (choice) => (typeof choice?.model === 'string' && MODEL_RE.test(choice.model) ? ['-m', choice.model] : []);

export function engineCommands({ deepseekToken = '', dsh = null } = {}) {
  return {
    openai: {
      command: ({ brief, choice }) => ({
        command: 'codex',
        args: ['exec', ...modelFlag(choice), ...(CODEX_EFFORTS.has(choice?.effort) ? ['-c', `model_reasoning_effort="${choice.effort}"`] : []), '--full-auto', brief],
        env: {},
      }),
    },
    gemini: {
      command: ({ brief, choice }) => ({ command: 'gemini', args: [...modelFlag(choice), '-p', brief], env: {} }),
    },
    deepseek: {
      // choice: the Cérebro row's {model, effort} for this work: the Harness runs on them (dshOverlay).
      command: ({ brief, choice }) => (dsh
        ? { command: dsh.command, args: [...dsh.args, '--profile', 'headless', ...patchArgs(choice), brief], env: dsh.env ?? {} }
        : { command: 'claude', args: ['-p', brief, ...modelFlag(choice).map((x) => (x === '-m' ? '--model' : x)), '--dangerously-skip-permissions'], env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: deepseekToken } }),
    },
  };
}
