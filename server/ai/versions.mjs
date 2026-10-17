import { join } from 'node:path';
import { log } from '../log.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { DEFAULT_TABLE } from './router.mjs';
import { PROVIDERS, providerOf } from './providers.mjs';

// The version watch (orchestration or15). The AI companies rename, retire and replace their models without asking: a
// model the routing counts on may vanish, or be announced to retire, or have a newer sibling the catalog does not know.
// Once a day each provider that has a key is asked for its model list; what changed is written to smDir/ai-versions.json
// and shown in list_other_ais, the conductor's prompt, the "Other AIs" dialog and one alert per change.
//
// The list calls carry no tokens: the docs of the four providers give them no price (they say nothing), so this says
// "not billed per token", never "free". The key goes only in a request header, is read just for the call, and is never
// logged, saved or put in an error. A model name from a provider is data: only plain names are kept.

export const VERSIONS_FILE = 'ai-versions.json';
export const versionsFile = (smDir) => join(smDir, VERSIONS_FILE);

const DAY_MS = 24 * 3600 * 1000;
const RETRY_MS = 6 * 3600 * 1000; // after a failed look; a success waits a day
const FORCE_GAP_MS = 60_000; // "on demand" is never more often than this
const TIMEOUT_MS = 15_000;
const BODY_MAX_BYTES = 16 * 1024 * 1024;
const PAGES_MAX = 6;
const NEW_PER_PROVIDER = 3;
const NOTES_PER_PROVIDER = 5;
const SUSPICIOUS_FROM = 10; // a list this long that shrinks under half is doubted once
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
// Previews, experiments, "latest" aliases and dated or numbered snapshots are not a new model of the line.
const SNAPSHOT_RE = /preview|experimental|-exp(?:-|$)|latest|-\d{4}-\d{2}-\d{2}$|-\d{6,8}$|-0\d\d$/i;
// Names without a version number that stand for "the current one" (deepseek-flash): the line they follow.
const ALIAS_FAMILIES = Object.freeze({ 'deepseek-flash': 'deepseek-v#-flash', 'deepseek-pro': 'deepseek-v#-pro', 'deepseek/deepseek-flash': 'deepseek/deepseek-v#-flash' });

export const LISTS = Object.freeze({
  openai: { url: 'https://api.openai.com/v1/models', headers: (key) => ({ Authorization: `Bearer ${key}` }), read: 'data', retire: 'shutdown_date' },
  deepseek: { url: 'https://api.deepseek.com/models', headers: (key) => ({ Authorization: `Bearer ${key}` }), read: 'data' },
  openrouter: { url: 'https://openrouter.ai/api/v1/models', headers: (key) => ({ Authorization: `Bearer ${key}` }), read: 'data', retire: 'expiration_date' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: (key) => ({ 'x-goog-api-key': key }), read: 'models', paged: true },
});

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const plainName = (m) => typeof m === 'string' && MODEL_RE.test(m);
const isoOf = (ms) => new Date(ms).toISOString();

// The model with every version number swapped for a mark: gemini-3.8-flash -> gemini-#-flash. Two models of one line
// (a new generation of the same size) have one key; flash and flash-lite do not.
export const familyKey = (model) => String(model).replace(/\d+(?:\.\d+)*/g, '#');

// The models a provider is counted on for: its default, every row of the routing table, what the owner pinned.
export function modelsInUse(provider, pinned = {}) {
  const set = new Set();
  const p = providerOf(provider);
  if (p) set.add(p.defaultModel);
  for (const rows of Object.values(DEFAULT_TABLE)) for (const r of rows) if (r.provider === provider) set.add(r.model);
  if (plainName(pinned?.[provider])) set.add(pinned[provider]);
  return set;
}

const knownModels = (provider, pinned) => new Set([...modelsInUse(provider, pinned), ...Object.keys(providerOf(provider)?.pricesUSDPerMTok ?? {})]);

// Negative when x is the higher version, 0 for the same numbers: "the three newest" go first.
const numbersOf = (id) => id.match(/\d+/g)?.map(Number) ?? [];
function compareNumbers(x, y) {
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return 0;
}
const newerFirst = (a, b) => compareNumbers(numbersOf(a), numbersOf(b)) || (a < b ? -1 : 1);

// The answer of one list call -> {ids: Set, retiring: Map(id -> date), next} or null when it is not a model list.
function readPage(spec, body) {
  if (!isObject(body) || !Array.isArray(body[spec.read])) return null;
  const ids = new Set();
  const retiring = new Map();
  for (const entry of body[spec.read]) {
    if (!isObject(entry)) continue;
    const raw = spec.read === 'models' ? (typeof entry.name === 'string' ? entry.name.replace(/^models\//, '') : null) : entry.id;
    if (!plainName(raw)) continue;
    ids.add(raw);
    if (spec.read === 'data' && plainName(entry.canonical_slug)) ids.add(entry.canonical_slug);
    const date = spec.retire && typeof entry[spec.retire] === 'string' && DATE_RE.test(entry[spec.retire]) ? entry[spec.retire].slice(0, 10) : null;
    if (date) retiring.set(raw, date);
  }
  const next = spec.paged && typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
  return { ids, retiring, next };
}

// The body as text, read with a limit: a declared length over it is refused unread, a stream is cut off the moment it
// passes it (null). The tests' doubles may have only text().
export async function readBounded(res) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) {
    await res.body?.cancel?.().catch(() => {});
    return null;
  }
  if (typeof res.body?.getReader !== 'function') {
    const text = await res.text();
    return text.length > BODY_MAX_BYTES ? null : text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One provider's whole list -> {ok: true, ids, retiring} or {ok: false, error: short code}. Never a key, never a body.
async function fetchList(provider, key, fetchFn) {
  const spec = LISTS[provider];
  const ids = new Set();
  const retiring = new Map();
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
      // Never read: error bodies may quote the key.
      if (typeof res?.body?.cancel === 'function') await res.body.cancel().catch(() => {});
      else await res?.text?.().catch(() => {});
      return { ok: false, error: `http-${Number(res?.status) || 0}` };
    }
    let body;
    try {
      const text = await readBounded(res);
      if (text === null) return { ok: false, error: 'bad-output' };
      body = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'bad-output' };
    }
    const got = readPage(spec, body);
    if (!got) return { ok: false, error: 'bad-output' };
    for (const id of got.ids) ids.add(id);
    for (const [id, d] of got.retiring) retiring.set(id, d);
    if (!got.next) return ids.size ? { ok: true, ids, retiring } : { ok: false, error: 'bad-output' };
    if (tokens.has(got.next)) return { ok: false, error: 'bad-output' }; // the same page again: a loop
    tokens.add(got.next);
    token = got.next;
  }
  return { ok: false, error: 'bad-output' }; // never-ending: the list is not trusted
}

const cleanFinding = (f) => (isObject(f) && ['gone', 'retiring', 'new'].includes(f.type) && providerOf(f.provider) && plainName(f.model)
  ? { id: String(f.id ?? ''), provider: f.provider, model: f.model, type: f.type, ...(typeof f.date === 'string' && DATE_RE.test(f.date) ? { date: f.date.slice(0, 10) } : {}), ...(plainName(f.like) ? { like: f.like } : {}), firstSeen: typeof f.firstSeen === 'string' ? f.firstSeen : null }
  : null);

const idOf = (f) => `${f.provider}:${f.model}:${f.type}${f.date ? `:${f.date}` : ''}`;

function readFile(smDir) {
  const raw = readJsonFile(versionsFile(smDir), null);
  if (!isObject(raw)) return { providers: {}, findings: [] };
  const providers = {};
  for (const [id, v] of Object.entries(isObject(raw.providers) ? raw.providers : {})) {
    if (!providerOf(id) || !isObject(v)) continue;
    providers[id] = {
      checkedAt: Number.isFinite(Date.parse(v.checkedAt)) ? v.checkedAt : null, ok: v.ok === true,
      ...(typeof v.error === 'string' && /^[a-z0-9-]{1,30}$/.test(v.error) ? { error: v.error } : {}),
      count: Number.isInteger(v.count) ? v.count : 0,
      baselineAt: Number.isFinite(Date.parse(v.baselineAt)) ? v.baselineAt : null,
      ...(Number.isInteger(v.suspectCount) ? { suspectCount: v.suspectCount } : {}),
    };
  }
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).map(cleanFinding).filter(Boolean).map((f) => ({ ...f, id: idOf(f) }));
  return { providers, findings };
}

// What the page and the prompts show: per provider that was ever looked at {checkedAt, ok, error?, notes: [...]}.
export function versionView(smDir) {
  if (!smDir) return {};
  const { providers, findings } = readFile(smDir);
  const out = {};
  for (const [id, p] of Object.entries(providers)) {
    const notes = findings.filter((f) => f.provider === id).slice(0, NOTES_PER_PROVIDER)
      .map((f) => ({ type: f.type, model: f.model, ...(f.date ? { date: f.date } : {}), ...(f.like ? { like: f.like } : {}) }));
    out[id] = { checkedAt: p.checkedAt, ok: p.ok, ...(p.error ? { error: p.error } : {}), notes };
  }
  return out;
}

// -> {run({force}) : Promise<{findings, alerts, skipped, checked, forced}>}. keyOf(provider) -> the key or null;
// pinned() -> {provider: model} the owner chose; onAlerts(alerts) is called once per look, however many callers share it;
// fetchFn and now are the tests' doubles.
export function createVersionWatch({ smDir, keyOf, fetchFn = globalThis.fetch, now = Date.now, pinned = () => ({}), onAlerts = () => {} } = {}) {
  let running = null;
  let lastRunAt = -Infinity;

  async function look(force) {
    const at = now();
    const before = readFile(smDir);
    const pins = (() => { try { return pinned() ?? {}; } catch { return {}; } })();
    const providers = { ...before.providers };
    const skipped = [];
    const checked = [];
    const due = [];
    for (const id of Object.keys(PROVIDERS)) {
      let key = null;
      try { key = await keyOf(id); } catch { key = null; }
      if (typeof key !== 'string' || !key) { skipped.push({ provider: id, why: 'no-key' }); continue; }
      const prev = providers[id];
      const last = prev?.checkedAt ? Date.parse(prev.checkedAt) : -Infinity;
      if (!force && at - last < (prev?.ok === false ? RETRY_MS : DAY_MS)) { skipped.push({ provider: id, why: 'fresh' }); continue; }
      due.push([id, key]);
    }
    if (due.length) lastRunAt = at;
    const lists = await Promise.all(due.map(async ([id, key]) => [id, await fetchList(id, key, fetchFn)]));

    let findings = before.findings;
    const alerts = [];
    const stamp = isoOf(at);
    for (const [id, list] of lists) {
      checked.push(id);
      const prev = providers[id];
      let result = list;
      let suspectCount;
      // A long list (the last good one, even if a look failed since) that shrank to a fraction is doubted; the same short
      // size twice in a row is believed.
      if (result.ok && prev && prev.count >= SUSPICIOUS_FROM && result.ids.size < prev.count / 2 && prev.suspectCount !== result.ids.size) {
        result = { ok: false, error: 'suspicious-list' };
        suspectCount = list.ids.size;
      }
      if (!result.ok) {
        providers[id] = { ...(prev ?? { count: 0, baselineAt: null }), checkedAt: stamp, ok: false, error: result.error, ...(suspectCount !== undefined ? { suspectCount } : {}) };
        log('warn', 'ai-versions-failed', { provider: id, error: result.error });
        continue;
      }
      const baselined = Boolean(prev?.baselineAt);
      providers[id] = { checkedAt: stamp, ok: true, count: result.ids.size, baselineAt: prev?.baselineAt ?? stamp };
      const inUse = modelsInUse(id, pins);
      const known = knownModels(id, pins);
      // The line of each model in use with the newest one in use on it: only a newer one is "new" (an older sibling is not
      // news). A name with no version (deepseek-flash) follows its alias line: anything unknown on that line is new.
      const newest = new Map();
      const aliasLines = new Set();
      for (const m of inUse) {
        if (Object.hasOwn(ALIAS_FAMILIES, m)) { aliasLines.add(ALIAS_FAMILIES[m]); continue; }
        const k = familyKey(m);
        if (!newest.has(k) || compareNumbers(numbersOf(m), numbersOf(newest.get(k))) < 0) newest.set(k, m);
      }
      const isNewer = (m) => {
        const k = familyKey(m);
        return newest.has(k) ? compareNumbers(numbersOf(m), numbersOf(newest.get(k))) < 0 : aliasLines.has(k);
      };
      const likeOf = (m) => newest.get(familyKey(m)) ?? [...inUse].find((x) => ALIAS_FAMILIES[x] === familyKey(m));
      const mine = [];
      for (const m of inUse) {
        if (!result.ids.has(m)) mine.push({ provider: id, model: m, type: 'gone' });
        else if (result.retiring.has(m)) mine.push({ provider: id, model: m, type: 'retiring', date: result.retiring.get(m) });
      }
      const fresh = [...result.ids].filter((m) => !known.has(m) && !SNAPSHOT_RE.test(m) && isNewer(m)).sort(newerFirst).slice(0, NEW_PER_PROVIDER);
      for (const m of fresh) mine.push({ provider: id, model: m, type: 'new', like: likeOf(m) });
      const kept = findings.filter((f) => f.provider !== id);
      const old = new Map(findings.filter((f) => f.provider === id).map((f) => [f.id, f]));
      const next = mine.map((f) => ({ ...f, id: idOf(f), firstSeen: old.get(idOf(f))?.firstSeen ?? stamp }));
      for (const f of next) {
        if (old.has(f.id)) continue;
        // The first good look at a provider only tells what is there: its new models stay on the list, no alert.
        if (f.type === 'new' && !baselined) continue;
        alerts.push({ kind: 'aiversion', reason: `aiv-${f.type}`, projectId: null, projectName: '', sessionId: null, provider: f.provider, model: f.model, ...(f.date ? { date: f.date } : {}) });
      }
      findings = [...kept, ...next];
    }
    // Saved before anyone is told: a crash in between loses an alert rather than repeating it.
    if (due.length) writeAtomic(versionsFile(smDir), `${JSON.stringify({ version: 1, updatedAt: stamp, providers, findings }, null, 1)}\n`);
    if (alerts.length) {
      try { onAlerts(alerts); } catch (err) { log('warn', 'ai-versions-alert-failed', { error: err.message }); }
    }
    return { findings, alerts, skipped, checked, forced: force };
  }

  // A run asked while one is going shares it. "On demand" skips the wait of a day, never the minute between two looks.
  const run = (options = {}) => {
    if (running) return running;
    const gap = Number.isFinite(options.minForceMs) ? options.minForceMs : FORCE_GAP_MS;
    const force = options.force === true && now() - lastRunAt >= gap;
    running = look(force).finally(() => { running = null; });
    return running;
  };
  return { run };
}
