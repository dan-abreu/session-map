import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { log } from '../log.mjs';
import { normalizePath } from '../paths.mjs';

const TIMEOUT_MS = 90_000;
const OUTPUT_MAX = 1_000_000;
const HOUR = 60 * 60 * 1000;
const CACHE_MAX = 1000;
const VSCODE_EXT_RE = /^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)/;

export const aiRunnerDir = (smDir) => join(smDir, 'ai-runner');

// collect and the archive hide conversations started here: they are the map's own AI calls.
export function isAiRunnerCwd(cwd, smDir) {
  if (!cwd) return false;
  const runner = normalizePath(aiRunnerDir(smDir));
  const dir = normalizePath(cwd);
  return dir === runner || dir.startsWith(`${runner}/`);
}

const isFile = (path) => {
  try { return statSync(path).isFile(); } catch { return false; }
};

function newestVsCodeBinary(home, exe) {
  const found = [];
  for (const root of ['.vscode', '.vscode-insiders', '.vscode-server']) {
    const dir = join(home, root, 'extensions');
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = VSCODE_EXT_RE.exec(name);
      const bin = join(dir, name, 'resources', 'native-binary', exe);
      if (m && isFile(bin)) found.push({ version: m.slice(1).map(Number), bin });
    }
  }
  found.sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2]);
  return found[0]?.bin ?? null;
}

// Order from the chat spike: PATH, the native installer, npm global, then the newest VS Code extension.
// A Windows .cmd shim is skipped on purpose: spawn without a shell cannot run it.
export function findClaude({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const win = platform === 'win32';
  const exe = win ? 'claude.exe' : 'claude';
  const pathDirs = String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const prefixes = [env.npm_config_prefix ?? (win ? env.APPDATA && join(env.APPDATA, 'npm') : '/usr/local')].filter(Boolean);
  const npmPackages = prefixes.map((p) => join(p, ...(win ? [] : ['lib']), 'node_modules', '@anthropic-ai', 'claude-code'));
  const candidates = [
    ...pathDirs.map((d) => join(d, exe)),
    join(home, '.local', 'bin', exe),
    ...npmPackages.flatMap((pkg) => [join(pkg, 'bin', exe), join(pkg, 'cli.js')]),
  ];
  return candidates.find(isFile) ?? newestVsCodeBinary(home, exe);
}

// Inherited CLAUDE* variables would tag the child as a VS Code conversation of the parent session.
export const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|MCP_CONNECTION_NONBLOCKING$)/i.test(k)));

function spawnCapture(bin, args, { cwd, env, input, timeoutMs }) {
  const script = /\.(m?js|cjs)$/i.test(bin);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(script ? process.execPath : bin, script ? [bin, ...args] : args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ error: err.code ?? 'spawn' });
      return;
    }
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { if (stdout.length < OUTPUT_MAX) stdout += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => { /* child died before reading the prompt; 'close' reports it */ });
    child.on('error', (err) => { clearTimeout(timer); resolve({ error: err.code ?? 'spawn' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, timedOut }); });
    child.stdin.end(input);
  });
}

function parseEnvelope(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  for (const text of [stdout.trim(), lines.at(-1)]) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'result' in parsed) return parsed;
    } catch { /* try the last line: some builds print warnings first */ }
  }
  return null;
}

// Models wrap JSON in prose or code fences despite being told not to.
function extractJSON(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  for (const candidate of [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === 'object') return value;
    } catch { /* next candidate */ }
  }
  return null;
}

export async function runClaudeJSON(prompt, {
  model = 'haiku', cwd, schemaHint, bin = findClaude(), env = process.env, exec = spawnCapture, timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!bin) return { ok: false, error: 'claude-not-found' };
  mkdirSync(cwd, { recursive: true });
  // No tools: the digest quotes user prompts, and nothing in them may make the model act on the machine.
  const args = ['-p', '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence'];
  const input = schemaHint ? `${prompt}\n\nReply with one JSON object only, no prose, shaped like:\n${schemaHint}\n` : prompt;
  const out = await exec(bin, args, { cwd, env: cleanEnv(env), input, timeoutMs });
  const fail = (error, extra = {}) => {
    log('warn', 'ai-call-failed', { error, code: out.code ?? null });
    return { ok: false, error, ...extra };
  };
  if (out.error) return fail('spawn-failed');
  if (out.timedOut) return fail('timeout');
  const envelope = parseEnvelope(out.stdout ?? '');
  if (!envelope) return fail('bad-output');
  const costUSD = Number(envelope.total_cost_usd) || 0;
  if (envelope.is_error) return fail('claude-error', { costUSD });
  const value = extractJSON(String(envelope.result ?? ''));
  if (!value) return fail('no-json', { costUSD });
  return { ok: true, value, costUSD };
}

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hashOf = (key) => createHash('sha1').update(JSON.stringify(key)).digest('hex');

// Background calls to the user's own claude: one at a time, capped per hour, cached by content in smDir/ai-cache.json.
export class AiQueue {
  #smDir;
  #run;
  #now;
  #max;
  #bin;
  #state;
  #tail = Promise.resolve();
  #pending = 0;

  constructor({ smDir, enabled = true, model = 'haiku', maxCallsPerHour = 30, bin = findClaude(), run = runClaudeJSON, now = Date.now }) {
    this.#smDir = smDir;
    this.#run = run;
    this.#now = now;
    this.#max = maxCallsPerHour;
    this.#bin = bin;
    this.model = model;
    this.enabled = Boolean(enabled && bin);
    const stored = readJsonFile(join(smDir, 'ai-cache.json'), null);
    this.#state = {
      cache: stored?.cache && typeof stored.cache === 'object' ? stored.cache : {},
      spent: stored?.spent ?? { day: '', usd: 0 },
      calls: Array.isArray(stored?.calls) ? stored.calls : [],
    };
  }

  #save() {
    const entries = Object.entries(this.#state.cache);
    if (entries.length > CACHE_MAX) {
      entries.sort((a, b) => b[1].at - a[1].at);
      this.#state.cache = Object.fromEntries(entries.slice(0, CACHE_MAX));
    }
    writeAtomic(join(this.#smDir, 'ai-cache.json'), JSON.stringify(this.#state));
  }

  #cached(hash) {
    const hit = this.#state.cache[hash];
    return hit ? { ok: true, value: hit.value, costUSD: 0, cached: true } : null;
  }

  async #call(hash, prompt, schemaHint, uncapped, projectId) {
    const hit = this.#cached(hash);
    if (hit) return hit;
    const now = this.#now();
    this.#state.calls = this.#state.calls.filter((ts) => now - ts < HOUR);
    if (!uncapped) {
      if (this.#state.calls.length >= this.#max) return { ok: false, error: 'rate-limited' };
      this.#state.calls.push(now);
    }
    const res = await this.#run(prompt, { model: this.model, cwd: aiRunnerDir(this.#smDir), schemaHint, bin: this.#bin });
    const day = localDay(now);
    if (this.#state.spent.day !== day) this.#state.spent = { day, usd: 0, byProject: {} };
    const spent = this.#state.spent;
    spent.usd += res.costUSD ?? 0;
    if (projectId) {
      spent.byProject ??= {};
      spent.byProject[projectId] = (spent.byProject[projectId] ?? 0) + (res.costUSD ?? 0);
    }
    if (res.ok) this.#state.cache[hash] = { value: res.value, at: now };
    this.#save();
    return res;
  }

  // uncapped: the one-time bootstrap of a new project, which the hourly cap would stretch over hours.
  ask({ key, prompt, schemaHint, uncapped = false, projectId = null }) {
    if (!this.enabled) return Promise.resolve({ ok: false, error: 'ai-off' });
    const hash = hashOf(key);
    const hit = this.#cached(hash);
    if (hit) return Promise.resolve(hit);
    this.#pending++;
    const job = this.#tail.then(() => this.#call(hash, prompt, schemaHint, uncapped, projectId)).finally(() => { this.#pending--; });
    this.#tail = job.catch(() => {});
    return job;
  }

  // With a projectId, what the map spent on that project only; the page adds the projects up.
  status(projectId) {
    const { day, usd, byProject } = this.#state.spent;
    const amount = projectId === undefined ? usd : byProject?.[projectId] ?? 0;
    const spentUSDToday = day === localDay(this.#now()) ? Math.round(amount * 1e6) / 1e6 : 0;
    return { enabled: this.enabled, model: this.model, spentUSDToday, queue: this.#pending };
  }
}
