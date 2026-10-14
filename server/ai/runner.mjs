import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { log } from '../log.mjs';
import { normalizePath } from '../paths.mjs';
import { HELPER_KINDS, emptyHelperState, helperStatus, pausedFor, providerReview, recordReview, resumeHelper, reviewPicks, sameAnswer } from './review.mjs';
import { PROVIDERS, estimateCostUSD, providerOf } from './providers.mjs';
import { bulkModelOf, laneWeights, pickLane, route } from './router.mjs';

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

// Models wrap JSON in prose or code fences despite being told not to. The helper providers reuse it.
export function extractJSON(text) {
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
  model = 'haiku', effort, cwd, schemaHint, bin = findClaude(), env = process.env, exec = spawnCapture, timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!bin) return { ok: false, error: 'claude-not-found' };
  mkdirSync(cwd, { recursive: true });
  // No tools: the digest quotes user prompts, and nothing in them may make the model act on the machine.
  // effort: only the bench sets it (planning at the level each model would plan at); everything else keeps the CLI's own.
  const args = ['-p', '--output-format', 'json', '--model', model, ...(effort ? ['--effort', effort] : []), '--tools', '', '--strict-mcp-config', '--no-session-persistence'];
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
// What a call is cached and sampled for review by; tests use it to pick asks Claude will or will not review.
export const aiKeyHash = hashOf;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Background calls to the user's own claude: one at a time, capped per hour, cached by content in smDir/ai-cache.json.
// others: () => othersSettings(...) ({enabled, dailyUSD, off, models, keys}), read on every call; with apiRun and keyOf
// the bulk kinds (HELPER_KINDS) go to every other AI with a key at once, in the order route() gives (or14): one call
// in flight per provider, Claude keeping its own single line for everything else, its reviews and the fallbacks.
// Whatever goes wrong outside, the call falls back to Claude. helper: the old single-helper settings, read only for
// the status's old `helper` field until the page moves to `others`.
export class AiQueue {
  #smDir;
  #run;
  #now;
  #max;
  #bin;
  #state;
  #tail = Promise.resolve();
  #pending = 0;
  #others;
  #helper;
  #apiRun;
  #keyOf;
  #stats;
  #onOutside;
  #lanes = new Map(); // provider -> {tail, load}: one call in flight per outside AI
  #reserved = new Map(); // provider -> dollars held for calls in flight

  constructor({
    smDir, enabled = true, model = 'haiku', maxCallsPerHour = 30, bin = findClaude(), run = runClaudeJSON, now = Date.now,
    others = null, helper = null, apiRun = null, keyOf = null, stats = () => [], onOutside = null,
  }) {
    this.#onOutside = onOutside;
    this.#others = others;
    this.#helper = helper;
    this.#apiRun = apiRun;
    this.#keyOf = keyOf;
    this.#stats = stats;
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
      // Named `helper` on disk since sb07: the review windows and pauses, per provider and kind.
      helper: emptyHelperState(stored?.helper),
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

  #today(now) {
    const day = localDay(now);
    if (this.#state.spent.day !== day) this.#state.spent = { day, usd: 0, byProject: {}, byProvider: {}, callsByProvider: {} };
    return this.#state.spent;
  }

  #spend(now, projectId, provider, costUSD = 0) {
    const spent = this.#today(now);
    const usd = Number.isFinite(costUSD) ? costUSD : 0;
    spent.usd += usd;
    spent.byProvider ??= {};
    spent.byProvider[provider] = (spent.byProvider[provider] ?? 0) + usd;
    if (projectId) {
      spent.byProject ??= {};
      spent.byProject[projectId] = (spent.byProject[projectId] ?? 0) + usd;
    }
  }

  #spentToday(provider, now) {
    const { day, byProvider } = this.#state.spent;
    return day === localDay(now) ? byProvider?.[provider] ?? 0 : 0;
  }

  // What every AI but Claude spent today: the one daily cap is for all of them together.
  #outsideSpent(now) {
    const { day, byProvider } = this.#state.spent;
    if (day !== localDay(now)) return 0;
    return Object.entries(byProvider ?? {}).reduce((sum, [p, usd]) => (p === 'claude' ? sum : sum + usd), 0);
  }

  #held(provider) {
    if (provider) return this.#reserved.get(provider) ?? 0;
    let sum = 0;
    for (const usd of this.#reserved.values()) sum += usd;
    return sum;
  }

  // Holds estimateUSD of the cap for one outside call, or null when it would not fit: what was spent today, plus what
  // calls in flight may still cost, plus this one, all together and for this provider (whose share is the whole cap).
  // The check and the hold happen at once, so calls running side by side can never pass the cap together.
  // ticket.settle(costUSD, projectId?) books what the call really cost and frees the hold; only the first settle counts.
  reserveOutside(provider, estimateUSD, capUSD) {
    if (!provider || provider === 'claude' || !(estimateUSD >= 0) || !(capUSD > 0)) return null;
    const now = this.#now();
    if (this.#outsideSpent(now) + this.#held() + estimateUSD > capUSD) return null;
    if (this.#spentToday(provider, now) + this.#held(provider) + estimateUSD > capUSD) return null;
    this.#reserved.set(provider, this.#held(provider) + estimateUSD);
    let open = true;
    return {
      settle: (costUSD = 0, projectId = null) => {
        if (!open) return;
        open = false;
        const left = this.#held(provider) - estimateUSD;
        if (left > 1e-12) this.#reserved.set(provider, left); else this.#reserved.delete(provider);
        const at = this.#now();
        this.#spend(at, projectId, provider, Number.isFinite(costUSD) && costUSD > 0 ? costUSD : 0);
        const spent = this.#today(at);
        spent.callsByProvider ??= {};
        spent.callsByProvider[provider] = (spent.callsByProvider[provider] ?? 0) + 1;
        this.#save();
      },
    };
  }

  // Claude's single line: everything for Claude waits its turn here.
  #onClaude(fn) {
    const job = this.#tail.then(fn);
    this.#tail = job.catch(() => {});
    return job;
  }

  #onLane(provider, fn) {
    const lane = this.#lanes.get(provider) ?? { tail: Promise.resolve(), load: 0 };
    this.#lanes.set(provider, lane);
    lane.load++;
    const job = lane.tail.then(fn).finally(() => { lane.load--; });
    lane.tail = job.catch(() => {});
    return job;
  }

  // Run directly: only from a job already in Claude's line.
  // Each of session-map's own Claude calls is also written to the activity file (sb11), like the other AIs': it leaves
  // no transcript (--no-session-persistence), so this line is the only trace of what it cost, for the statement.
  async #askClaude(prompt, schemaHint, now, projectId, kind = 'other') {
    const t0 = this.#now();
    const res = await this.#run(prompt, { model: this.model, cwd: aiRunnerDir(this.#smDir), schemaHint, bin: this.#bin });
    this.#spend(now, projectId, 'claude', res.costUSD);
    this.#noteOutside({ kind, sensitivity: 'client', provider: 'claude', model: this.model, ms: this.#now() - t0, costUSD: res.costUSD ?? 0, ok: Boolean(res.ok), ...(res.ok ? {} : { error: res.error }) });
    return res;
  }

  #settings() {
    if (!this.#others || !this.#apiRun || !this.#keyOf) return null;
    const s = this.#others();
    return s && s.enabled ? s : null;
  }

  // The outside AIs that may take this job right now: a key, switched on, not paused for it, room under the cap.
  #usable(s, kind, now) {
    if (this.#outsideSpent(now) + this.#held() >= s.dailyUSD) return [];
    return (s.keys ?? []).filter((p) => providerOf(p) && !(s.off ?? []).includes(p) && !pausedFor(this.#state.helper, p, kind)
      && this.#spentToday(p, now) + this.#held(p) < s.dailyUSD);
  }

  // Where a new job goes: {provider, model} of an outside AI, or null for Claude. Claude conducts: with any other AI
  // available the bulk goes to them, spread by quality per dollar and how busy each is; Claude checks and catches.
  #target(kind, sensitivity) {
    if (!HELPER_KINDS.has(kind)) return null;
    const s = this.#settings();
    if (!s) return null;
    const candidates = route({ kind, sensitivity, available: this.#usable(s, kind, this.#now()), stats: this.#stats(), models: s.models });
    if (!candidates.length) return null;
    const at = pickLane(laneWeights(candidates), candidates.map((c) => this.#lanes.get(c.provider)?.load ?? 0));
    return at < 0 ? null : candidates[at];
  }

  // The activity log (activity.mjs) hears of every outside call: who, how long, what it cost, never the request. A log
  // that fails must not fail the call it describes.
  #noteOutside(call) {
    try { this.#onOutside?.(call); } catch { /* the work goes on */ }
  }

  // A thrown error is not logged: its message could quote the request, key included.
  async #askOutside(target, key, prompt, schemaHint) {
    try {
      return await this.#apiRun(prompt, { provider: target.provider, model: target.model, key, schemaHint });
    } catch {
      return { ok: false, error: 'helper-threw' };
    }
  }

  // Claude conducts: it answers when the other AI cannot, and re-asks a sample of its answers, having the last word.
  // valid: the caller's check of an answer (place: a listed part id or null). An answer that fails it is a wrong
  // answer, not a success: Claude answers instead and the miss counts against that AI.
  async #answerOutside(target, hash, kind, prompt, schemaHint, now, projectId, valid, sensitivity) {
    const viaClaude = () => this.#onClaude(() => this.#askClaude(prompt, schemaHint, now, projectId, kind));
    const s = this.#settings();
    const { provider } = target;
    if (!s || !(s.keys ?? []).includes(provider) || (s.off ?? []).includes(provider) || pausedFor(this.#state.helper, provider, kind)) return viaClaude();
    const key = await Promise.resolve(this.#keyOf(provider)).catch(() => null);
    if (!key) return viaClaude();
    const estimateUSD = estimateCostUSD(provider, target.model, prompt, undefined, schemaHint);
    const ticket = this.reserveOutside(provider, estimateUSD, s.dailyUSD);
    if (!ticket) return viaClaude();
    const t0 = this.#now();
    const fromOther = await this.#askOutside(target, key, prompt, schemaHint);
    // A call that threw may have left: it costs the estimate. providers.mjs does the same for a timeout.
    const paid = Number.isFinite(fromOther.costUSD) ? fromOther.costUSD : fromOther.error === 'helper-threw' ? estimateUSD : 0;
    ticket.settle(paid, projectId);
    this.#noteOutside({ kind, sensitivity, provider, model: target.model, ms: this.#now() - t0, costUSD: paid, ok: Boolean(fromOther.ok), ...(fromOther.ok ? {} : { error: fromOther.error }) });
    const invalid = fromOther.ok && typeof valid === 'function' && !valid(fromOther.value);
    if (fromOther.ok && !invalid && !reviewPicks(hash)) return fromOther;
    if (!fromOther.ok) log('warn', 'ai-helper-fallback', { provider, error: fromOther.error });
    if (invalid) {
      log('warn', 'ai-helper-fallback', { provider, error: 'invalid-answer' });
      recordReview(this.#state.helper, provider, kind, false, now);
    }
    const fromClaude = await viaClaude();
    const costUSD = round6(paid + (fromClaude.costUSD ?? 0));
    if (!fromOther.ok || invalid) return { ...fromClaude, costUSD };
    if (!fromClaude.ok) return { ...fromOther, costUSD };
    recordReview(this.#state.helper, provider, kind, sameAnswer(fromOther.value, fromClaude.value, kind), now);
    return { ...fromClaude, costUSD, reviewed: true };
  }

  async #call(hash, kind, prompt, schemaHint, uncapped, projectId, valid, target, sensitivity) {
    const hit = this.#cached(hash);
    if (hit) return hit;
    const now = this.#now();
    this.#state.calls = this.#state.calls.filter((ts) => now - ts < HOUR);
    if (!uncapped) {
      if (this.#state.calls.length >= this.#max) return { ok: false, error: 'rate-limited' };
      this.#state.calls.push(now);
    }
    const res = target
      ? await this.#answerOutside(target, hash, kind, prompt, schemaHint, now, projectId, valid, sensitivity)
      : await this.#askClaude(prompt, schemaHint, now, projectId, kind);
    if (res.ok) this.#state.cache[hash] = { value: res.value, at: now };
    this.#save();
    return res;
  }

  // uncapped: the one-time bootstrap of a new project, which the hourly cap would stretch over hours.
  // sensitivity: what the prompt holds (router.mjs SENSITIVITIES). Unsaid is the strictest, 'client': a caller must say
  // 'internal' or 'public' (life.mjs passes the project's class) before a direct Gemini key or DeepSeek may take it.
  ask({ key, prompt, schemaHint, uncapped = false, projectId = null, valid = null, sensitivity = 'client' }) {
    if (!this.enabled) return Promise.resolve({ ok: false, error: 'ai-off' });
    const hash = hashOf(key);
    const hit = this.#cached(hash);
    if (hit) return Promise.resolve(hit);
    const kind = key?.kind;
    const target = this.#target(kind, sensitivity);
    const work = () => this.#call(hash, kind, prompt, schemaHint, uncapped, projectId, valid, target, sensitivity);
    this.#pending++;
    return (target ? this.#onLane(target.provider, work) : this.#onClaude(work)).finally(() => { this.#pending--; });
  }

  // How many capped calls this hour still allows (those in flight and not yet counted are the caller's to subtract).
  callsLeft() {
    const now = this.#now();
    return Math.max(0, this.#max - this.#state.calls.filter((ts) => now - ts < HOUR).length);
  }

  // Paused for a kind of work (review.mjs): ask.mjs skips it as the queue does.
  pausedFor(provider, kind) {
    return pausedFor(this.#state.helper, provider, kind);
  }

  // The owner turned a paused AI back on.
  resumeHelper(provider) {
    resumeHelper(this.#state.helper, provider);
    this.#save();
  }

  // A paid call made outside the queue (the page's Test button): it counts in the day's spend and the daily cap.
  recordSpend(provider, costUSD) {
    if (!Number.isFinite(costUSD) || costUSD <= 0) return;
    this.#spend(this.#now(), null, provider, costUSD);
    this.#save();
  }

  spentToday(provider) {
    return round6(this.#spentToday(provider, this.#now()));
  }

  outsideSpentToday() {
    return round6(this.#outsideSpent(this.#now()));
  }

  #othersStatus(s, spentByProviderToday, calls) {
    const outside = this.#outsideSpent(this.#now());
    return {
      enabled: Boolean(s.enabled),
      dailyUSD: s.dailyUSD,
      spentUSDToday: round6(outside),
      capReached: outside >= s.dailyUSD,
      providers: Object.keys(PROVIDERS).map((id) => {
        const r = providerReview(this.#state.helper, id);
        return {
          id,
          model: bulkModelOf(id, s.models),
          hasKey: (s.keys ?? []).includes(id),
          on: !(s.off ?? []).includes(id),
          paused: Boolean(r.pausedWhy),
          pausedWhy: r.pausedWhy,
          spentUSDToday: spentByProviderToday[id] ?? 0,
          reviewed: r.reviewed,
          agreed: r.agreed,
          calls: calls[id] ?? 0,
          busy: this.#lanes.get(id)?.load ?? 0,
        };
      }),
    };
  }

  // With a projectId, what the map spent on that project only; the page adds the projects up. With the others wired,
  // also today's spend per provider and each outside AI's state: machine-wide, the same for every project.
  status(projectId) {
    const { day, usd, byProject, byProvider, callsByProvider } = this.#state.spent;
    const today = day === localDay(this.#now());
    const amount = projectId === undefined ? usd : byProject?.[projectId] ?? 0;
    const base = { enabled: this.enabled, model: this.model, spentUSDToday: today ? round6(amount) : 0, queue: this.#pending };
    if (!this.#others) return base;
    const s = this.#others() ?? { enabled: false, dailyUSD: 0, off: [], models: {}, keys: [] };
    const spentByProviderToday = today ? Object.fromEntries(Object.entries(byProvider ?? {}).map(([k, v]) => [k, round6(v)])) : {};
    const out = { ...base, spentByProviderToday, others: this.#othersStatus(s, spentByProviderToday, today ? callsByProvider ?? {} : {}) };
    if (this.#helper) {
      const h = this.#helper();
      out.helper = helperStatus(this.#state.helper, h, spentByProviderToday[h.provider] ?? 0);
    }
    return out;
  }
}
