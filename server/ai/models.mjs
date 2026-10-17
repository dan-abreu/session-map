import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { loadPrices, priceFor } from '../cost.mjs';
import { LEVEL_UNION } from './efforts.mjs';
import { PROVIDERS, providerOf } from './providers.mjs';
import { LISTS, readBounded } from './versions.mjs';
import { aiRunnerDir, cleanEnv, findClaude, spawnCapture } from './runner.mjs';
import { CLAUDE_FALLBACK, CLAUDE_MODEL_RE, NOTE_PT, isAgentModel } from './claude-models.mjs';
import { listedAt, listedOf, listedVersion, setListed } from './model-registry.mjs';

// The model list of every AI, as its maker gives it (id168, or72). The Cérebro offers every model of every AI, with its real
// name, the way the VS Code picker lists Claude's: Claude Code is asked for its own list (the answer to its "initialize"
// request, the one that picker is drawn from) and each other AI is asked for its model list with the owner's key. What each
// maker lists is read, cleaned and kept in smDir/ai-models.json; the programs that validate a choice or name a model read it
// through model-registry.mjs. Without a list (no key, no network, the CLI missing) the built-in one stands: Claude's twelve
// models of 2026-10-16 and the models providers.mjs knows by name and price.
//
// Nothing here is trusted: a name from a maker is data, kept short and only if it is plain; the key goes only in a request
// header, is read just for the call, and is never logged, saved or put in an error.

export const MODELS_FILE = 'ai-models.json';
export const modelsFile = (smDir) => join(smDir, MODELS_FILE);

const DAY_MS = 24 * 3600 * 1000;
const RETRY_MS = 6 * 3600 * 1000; // after a failed look; a success waits a day
const FORCE_GAP_MS = 60_000; // "refresh" is never more often than this
const TIMEOUT_MS = 15_000;
const CLAUDE_TIMEOUT_MS = 30_000;
const PAGES_MAX = 6;
const ENTRIES_MAX = 1500;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const REQUEST_ID = 'sm-models';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);
const isLevel = (l) => LEVEL_UNION.includes(l) && l !== 'ultracode';

// ---- names ---------------------------------------------------------------------------

const WORDS = { gpt: 'GPT', deepseek: 'DeepSeek', gemini: 'Gemini', gemma: 'Gemma', openai: 'OpenAI', llama: 'Llama', glm: 'GLM', it: 'IT' };

// The name of a model whose maker gave none: gpt-6.1-sol -> GPT-6.1 Sol, deepseek-v4-pro -> DeepSeek V4 Pro,
// gemini-3.8-flash -> Gemini 3.8 Flash. The o series stays as OpenAI writes it (o4-mini).
export function humanName(id) {
  const base = String(id ?? '').split('/').pop();
  if (/^o\d/i.test(base)) return base.toLowerCase();
  const words = base.split('-').filter(Boolean).map((p) => {
    const low = p.toLowerCase();
    if (WORDS[low]) return WORDS[low];
    if (/^v\d/.test(low)) return low.toUpperCase();
    if (/^\d/.test(low)) return low;
    return low[0].toUpperCase() + low.slice(1);
  });
  return words.join(' ').replace(/^GPT (\d)/, 'GPT-$1') || String(id ?? '');
}

// A family (gemini, gemma, gpt, o) in alphabetical order; inside it 3.5 before 3.1 and 3.1 before 3: the newest version
// first, then the name.
const numbersOf = (id) => String(id).match(/\d+/g)?.map(Number) ?? [];
const familyOf = (id) => String(id).replace(/[\d.].*$/, '');
function newerFirst(a, b) {
  const fa = familyOf(a.id);
  const fb = familyOf(b.id);
  if (fa !== fb) return fa < fb ? -1 : 1;
  const x = numbersOf(a.id);
  const y = numbersOf(b.id);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return a.id < b.id ? -1 : 1;
}

// ---- what each maker's list becomes --------------------------------------------------

let prices = null;
const priceTable = () => (prices ??= (() => { try { return loadPrices(); } catch { return {}; } })());

// Claude Code's answer to "initialize" -> entries. `default` is left out: the Cérebro's "automatic" already means it.
export function claudeEntries(models) {
  const out = [];
  for (const m of Array.isArray(models) ? models : []) {
    if (!isObject(m) || typeof m.value !== 'string' || m.value === 'default' || !CLAUDE_MODEL_RE.test(m.value)) continue;
    const resolved = typeof m.resolvedModel === 'string' && CLAUDE_MODEL_RE.test(m.resolvedModel) ? m.resolvedModel : m.value;
    const price = priceFor(resolved, priceTable());
    const noteEn = text(m.description);
    out.push({
      id: m.value, name: text(m.displayName, 60) || m.value, resolved,
      ...(noteEn ? { noteEn, notePt: NOTE_PT[noteEn] ?? noteEn } : {}),
      levels: (Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels : []).filter(isLevel), levelsFrom: 'maker',
      ...(price ? { priceIn: price.input, priceOut: price.output } : {}),
    });
  }
  return out;
}

// What an old, an audio, an image, a search or an embedding model is called: not a model that answers a chat message. The
// "-pro" and "codex" lines of OpenAI answer only through its Responses API, which these calls do not use.
const OPENAI_SKIP = /embedding|moderation|tts|transcribe|whisper|audio|realtime|image|sora|dall-e|davinci|babbage|search|research|live|instruct|computer-use|codex|latest|(?:^|-)pro(?:-|$)/i;
const DATED = /-\d{4}-\d{2}-\d{2}$|-\d{4}$/;
// The reasoning models (the o series, gpt-5 and later) take the three levels every one of them accepts; an older model takes none.
const OPENAI_REASONS = /^(?:o\d|gpt-(?:[5-9]|\d{2,}))/i;

export function openaiEntries(body) {
  const out = [];
  for (const m of Array.isArray(body?.data) ? body.data : []) {
    const id = m?.id;
    if (typeof id !== 'string' || !MODEL_RE.test(id) || OPENAI_SKIP.test(id) || DATED.test(id)) continue;
    out.push({ id, name: humanName(id), levels: OPENAI_REASONS.test(id) ? ['low', 'medium', 'high'] : [], levelsFrom: 'guess' });
  }
  return out.sort(newerFirst);
}

// Gemini's list has every model Google serves, music, video, speech and embeddings among them: only the ones that answer a
// chat message through generateContent stay. The previews are real models and stay, with their name.
const GEMINI_SKIP = /tts|image|transcribe|live|native-audio|robotics|computer-use|embedding|customtools|antigravity|research|lyria|veo|banana|omni|latest/i;

export function geminiEntries(body) {
  const out = [];
  for (const m of Array.isArray(body?.models) ? body.models : []) {
    const id = typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : null;
    if (!id || !MODEL_RE.test(id) || !/^(?:gemini|gemma)-/.test(id) || GEMINI_SKIP.test(id)) continue;
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
    const context = num(m.inputTokenLimit);
    out.push({ id, name: text(m.displayName, 80) || humanName(id), ...(context ? { context } : {}), levels: id.startsWith('gemini-') ? ['low', 'medium', 'high'] : [], levelsFrom: 'guess' });
  }
  return out.sort(newerFirst);
}

// DeepSeek's list is short and says a lot: the name, the context window and the levels each model takes.
export function deepseekEntries(body) {
  const out = [];
  for (const m of Array.isArray(body?.data) ? body.data : []) {
    const id = m?.id;
    if (typeof id !== 'string' || !MODEL_RE.test(id)) continue;
    if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) continue;
    const supported = Array.isArray(m.effort?.supported_levels) ? m.effort.supported_levels.filter(isLevel) : null;
    const context = num(m.context_window);
    out.push({
      id, name: text(m.name, 80).replace(/-/g, ' ') || humanName(id), ...(context ? { context } : {}),
      // Thinking can be switched off whatever the levels are: "off" is the thinking switch, not a level of the list.
      ...(supported ? { levels: ['off', ...supported], levelsFrom: 'maker' } : {}),
    });
  }
  return out.sort(newerFirst);
}

// OpenRouter lists hundreds: the ones that answer in text, each with its maker (to group by), its price and its context.
export function openrouterEntries(body) {
  const out = [];
  for (const m of Array.isArray(body?.data) ? body.data : []) {
    const id = m?.id;
    if (typeof id !== 'string' || !MODEL_RE.test(id)) continue;
    const arch = m.architecture ?? {};
    if (Array.isArray(arch.output_modalities) && !arch.output_modalities.includes('text')) continue;
    if (Array.isArray(arch.input_modalities) && !arch.input_modalities.includes('text')) continue;
    const full = text(m.name, 120);
    const colon = full.indexOf(':');
    const maker = colon > 0 ? full.slice(0, colon).trim() : id.split('/')[0];
    const per = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined; };
    const priceIn = per(m.pricing?.prompt);
    const priceOut = per(m.pricing?.completion);
    const context = num(m.context_length);
    out.push({
      id, name: (colon > 0 ? full.slice(colon + 1).trim() : full) || humanName(id), maker,
      ...(context ? { context } : {}), ...(priceIn !== undefined ? { priceIn } : {}), ...(priceOut !== undefined ? { priceOut } : {}),
    });
  }
  return out.sort((a, b) => (a.maker < b.maker ? -1 : a.maker > b.maker ? 1 : a.name < b.name ? -1 : 1));
}

const NORMALIZERS = { openai: openaiEntries, gemini: geminiEntries, deepseek: deepseekEntries, openrouter: openrouterEntries };

// One entry read back from the file or from a list: only the shape the readers know, bounded.
export function cleanEntry(e, provider) {
  if (!isObject(e) || typeof e.id !== 'string') return null;
  if (!(provider === 'claude' ? CLAUDE_MODEL_RE : MODEL_RE).test(e.id)) return null;
  const name = text(e.name, 80);
  if (!name) return null;
  const out = { id: e.id, name };
  if (provider === 'claude' && typeof e.resolved === 'string' && CLAUDE_MODEL_RE.test(e.resolved)) out.resolved = e.resolved;
  if (text(e.noteEn)) out.noteEn = text(e.noteEn);
  if (text(e.notePt)) out.notePt = text(e.notePt);
  if (text(e.maker, 60)) out.maker = text(e.maker, 60);
  for (const k of ['context', 'priceIn', 'priceOut']) if (num(e[k]) !== undefined) out[k] = e[k];
  if (Array.isArray(e.levels) && (e.levelsFrom === 'maker' || e.levelsFrom === 'guess')) {
    out.levels = e.levels.filter(isLevel);
    out.levelsFrom = e.levelsFrom;
  }
  return out;
}

// ---- the lists, merged with what the program knows -----------------------------------

// Claude: the list of Claude Code, or the built-in one. The aliases the Agent tool accepts come first (they are the current
// ones) and are the only ones an agent can run; the explicit ids are older or sideways versions.
// The others: the models the program knows by name and price come first (verified: their request is checked), then
// whatever else the maker lists (called with the cautious request of providers.mjs). A known model the maker no longer lists
// stays, marked `gone`: a choice already made keeps working until the maker retires it.
function build(provider) {
  if (provider === 'claude') {
    const listed = listedOf('claude');
    const base = listed?.length ? listed : CLAUDE_FALLBACK;
    const entry = (e) => ({ ...e, group: isAgentModel(e.id) ? 'current' : 'other', agent: isAgentModel(e.id), verified: true });
    const mine = base.map(entry);
    return [...mine.filter((e) => e.group === 'current'), ...mine.filter((e) => e.group === 'other')];
  }
  const p = providerOf(provider);
  if (!p) return [];
  const listed = listedOf(provider);
  const known = p.pricesUSDPerMTok ?? {};
  const live = new Map((listed ?? []).map((e) => [e.id, e]));
  const out = Object.entries(known).map(([id, price]) => {
    const e = live.get(id);
    return { id, name: e?.name ?? humanName(id), priceIn: price.in, priceOut: price.out, ...(e?.context ? { context: e.context } : {}), group: 'current', verified: true, ...(listed && !e ? { gone: true } : {}) };
  });
  for (const e of listed ?? []) if (!Object.hasOwn(known, e.id)) out.push({ ...e, group: 'other', verified: false });
  return out;
}

const memo = new Map();
// The models of one AI, in the order the picker shows them: [{id, name, group, verified, ...}]. Cached until a list changes.
export function modelsOf(provider) {
  const ver = listedVersion();
  const hit = memo.get(provider);
  if (hit?.ver === ver) return hit.list;
  const list = build(provider);
  memo.set(provider, { ver, list, ids: new Set(list.map((e) => e.id)) });
  return list;
}

export function modelIdsOf(provider) {
  modelsOf(provider);
  return memo.get(provider)?.ids ?? new Set();
}

// The one test of a model choice: does this AI list it? An agent of Claude takes only what the Agent tool accepts.
export function modelFits(provider, model, { agent = false } = {}) {
  if (!modelIdsOf(provider).has(model)) return false;
  return !(agent && provider === 'claude') || isAgentModel(model);
}

export function modelNameOf(provider, id) {
  if (typeof id !== 'string' || !id) return null;
  return modelsOf(provider).find((e) => e.id === id)?.name ?? humanName(id);
}

// What the page draws for one AI: the list without the fields only the programs use.
export function pageModels(provider) {
  return modelsOf(provider).map((e) => ({
    id: e.id, name: e.name, group: e.group, verified: e.verified,
    ...(e.agent ? { agent: true } : {}), ...(e.gone ? { gone: true } : {}),
    ...(e.resolved && e.resolved !== e.id ? { resolved: e.resolved } : {}),
    ...(e.noteEn ? { noteEn: e.noteEn, notePt: e.notePt ?? e.noteEn } : {}),
    ...(e.maker ? { maker: e.maker } : {}), ...(e.context ? { context: e.context } : {}),
    ...(e.priceIn !== undefined ? { priceIn: e.priceIn } : {}), ...(e.priceOut !== undefined ? { priceOut: e.priceOut } : {}),
  }));
}

// ---- asking the makers ---------------------------------------------------------------

// Claude Code's own list: the CLI answers "initialize" with the models its picker shows, before any model is called, so the
// question costs no tokens. -> {ok: true, models: [entries]} or {ok: false, error: short code}.
export async function askClaudeModels({ smDir, bin = findClaude(), env = process.env, exec = spawnCapture, timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  if (!bin) return { ok: false, error: 'claude-not-found' };
  const cwd = aiRunnerDir(smDir);
  try { mkdirSync(cwd, { recursive: true }); } catch { return { ok: false, error: 'no-folder' }; }
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  const input = `${JSON.stringify({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'initialize' } })}\n`;
  const out = await exec(bin, args, { cwd, env: cleanEnv(env), input, timeoutMs });
  if (out.error) return { ok: false, error: 'spawn-failed' };
  for (const line of String(out.stdout ?? '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg?.type !== 'control_response' || msg.response?.request_id !== REQUEST_ID) continue;
    if (msg.response.subtype !== 'success') return { ok: false, error: 'refused' };
    const models = claudeEntries(msg.response.response?.models);
    return models.length ? { ok: true, models } : { ok: false, error: 'bad-output' };
  }
  return { ok: false, error: out.timedOut ? 'timeout' : 'bad-output' };
}

// One AI's whole list as the maker gives it (every page), -> {ok: true, body} or {ok: false, error}. Never a key, never a body in an error.
async function fetchBody(provider, key, fetchFn) {
  const spec = LISTS[provider];
  if (!spec) return { ok: false, error: 'no-list' };
  const items = [];
  const tokens = new Set();
  let token = null;
  for (let page = 0; page < PAGES_MAX; page++) {
    const url = token ? `${spec.url}&pageToken=${encodeURIComponent(token)}` : spec.url;
    let res;
    try {
      res = await fetchFn(url, { method: 'GET', headers: { ...spec.headers(key), Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network' };
    }
    if (!res?.ok) {
      if (typeof res?.body?.cancel === 'function') await res.body.cancel().catch(() => {});
      else await res?.text?.().catch(() => {});
      return { ok: false, error: `http-${Number(res?.status) || 0}` };
    }
    let body;
    try {
      const raw = await readBounded(res);
      if (raw === null) return { ok: false, error: 'bad-output' };
      body = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'bad-output' };
    }
    if (!isObject(body) || !Array.isArray(body[spec.read])) return { ok: false, error: 'bad-output' };
    items.push(...body[spec.read]);
    const next = spec.paged && typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
    if (!next) return { ok: true, body: { [spec.read]: items } };
    if (tokens.has(next)) return { ok: false, error: 'bad-output' };
    tokens.add(next);
    token = next;
  }
  return { ok: false, error: 'bad-output' };
}

// ---- the file --------------------------------------------------------------------------

function readFile(smDir) {
  const raw = smDir ? readJsonFile(modelsFile(smDir), null) : null;
  const providers = {};
  if (!isObject(raw?.providers)) return providers;
  for (const [id, v] of Object.entries(raw.providers)) {
    if ((id !== 'claude' && !providerOf(id)) || !isObject(v)) continue;
    const models = (Array.isArray(v.models) ? v.models : []).slice(0, ENTRIES_MAX).map((e) => cleanEntry(e, id)).filter(Boolean);
    providers[id] = {
      checkedAt: Number.isFinite(Date.parse(v.checkedAt)) ? v.checkedAt : null,
      ok: v.ok === true,
      ...(typeof v.error === 'string' && /^[a-z0-9-]{1,30}$/.test(v.error) ? { error: v.error } : {}),
      models,
    };
  }
  return providers;
}

// Puts what the file holds into the registry. Called when the program starts, and by whoever needs the lists before a look.
export function loadModels(smDir) {
  const providers = readFile(smDir);
  for (const [id, v] of Object.entries(providers)) if (v.models.length) setListed(id, v.models, v.checkedAt);
  return providers;
}

// What the page shows about the lists: per AI, when it was read and from where. An AI never read is "built-in".
export function modelsView(smDir) {
  const providers = readFile(smDir);
  const out = {};
  for (const id of ['claude', ...Object.keys(PROVIDERS)]) {
    const v = providers[id];
    const listed = listedOf(id);
    out[id] = {
      source: listed?.length ? (id === 'claude' ? 'claude-code' : 'maker') : 'built-in',
      count: listed?.length ?? 0,
      checkedAt: listedAt(id) ?? v?.checkedAt ?? null,
      ok: v ? v.ok : null,
      ...(v?.error ? { error: v.error } : {}),
    };
  }
  return out;
}

// -> {run({force, minForceMs}) : Promise<{checked, skipped, forced}>}. keyOf(provider) -> the key or null; askClaude, fetchFn
// and now are the tests' doubles. A look reads the AIs that are due (a day after a good look, six hours after a failed
// one), writes the file, then fills the registry. A failed look keeps the last good list.
export function createModelWatch({ smDir, keyOf, fetchFn = globalThis.fetch, askClaude = (o) => askClaudeModels(o), now = Date.now, claudeOptions = {} } = {}) {
  let running = null;
  let lastRunAt = -Infinity;

  async function look(force) {
    const at = now();
    const stamp = new Date(at).toISOString();
    const before = readFile(smDir);
    const providers = { ...before };
    const skipped = [];
    const due = [];
    for (const id of ['claude', ...Object.keys(PROVIDERS)]) {
      let key = null;
      if (id !== 'claude') {
        try { key = await keyOf(id); } catch { key = null; }
        if (typeof key !== 'string' || !key) { skipped.push({ provider: id, why: 'no-key' }); continue; }
      }
      const prev = providers[id];
      const last = prev?.checkedAt ? Date.parse(prev.checkedAt) : -Infinity;
      if (!force && at - last < (prev?.ok === false ? RETRY_MS : DAY_MS)) { skipped.push({ provider: id, why: 'fresh' }); continue; }
      due.push([id, key]);
    }
    if (due.length) lastRunAt = at;
    const results = await Promise.all(due.map(async ([id, key]) => {
      if (id === 'claude') return [id, await askClaude({ smDir, ...claudeOptions })];
      const got = await fetchBody(id, key, fetchFn);
      if (!got.ok) return [id, got];
      const models = NORMALIZERS[id](got.body).slice(0, ENTRIES_MAX);
      return [id, models.length ? { ok: true, models } : { ok: false, error: 'bad-output' }];
    }));
    const checked = [];
    for (const [id, res] of results) {
      checked.push(id);
      const prev = providers[id];
      if (res.ok) {
        providers[id] = { checkedAt: stamp, ok: true, models: res.models.map((e) => cleanEntry(e, id)).filter(Boolean) };
      } else {
        providers[id] = { models: [], ...(prev ?? {}), checkedAt: stamp, ok: false, error: res.error };
        log('warn', 'ai-models-failed', { provider: id, error: res.error });
      }
    }
    if (due.length) {
      try { writeAtomic(modelsFile(smDir), `${JSON.stringify({ version: 1, updatedAt: stamp, providers }, null, 1)}\n`); } catch (err) { log('warn', 'ai-models-save-failed', { error: err.message }); }
      for (const [id, v] of Object.entries(providers)) if (v.models.length) setListed(id, v.models, v.checkedAt);
    }
    return { checked, skipped, forced: force };
  }

  // A run asked while one is going shares it. "Refresh" skips the wait of a day, never the minute between two looks.
  const run = (options = {}) => {
    if (running) return running;
    const gap = Number.isFinite(options.minForceMs) ? options.minForceMs : FORCE_GAP_MS;
    const force = options.force === true && now() - lastRunAt >= gap;
    running = look(force).finally(() => { running = null; });
    return running;
  };
  return { run };
}
