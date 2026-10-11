import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logAction } from '../actions.mjs';
import { cookieToken, isLocal, sameToken } from '../auth.mjs';
import { ASK_KINDS, askOthers } from './ask.mjs';
import { ID_RE, SESSION_RE, readActivity, recordActivity, setResult } from './activity.mjs';
import { addOthersSpend, cleanRoot } from '../budget.mjs';
import { recommend, recordDecision } from './conductor.mjs';
import { getKey, listKeys } from './keys.mjs';
import { lifeOf } from './life.mjs';
import { othersSettings } from './others.mjs';
import { HELPER_KINDS } from './review.mjs';
import { PROVIDERS } from './providers.mjs';
import { SENSITIVITIES, bulkModelOf } from './router.mjs';
import { usageSummary } from './usage.mjs';

// The other AIs as Claude's arsenal (or14), over HTTP: POST /api/ai/ask and GET /api/ai/others. The stdio tool
// (arsenal-mcp.mjs) has no cookie, so these two routes also take the token in the x-session-map-token header; a
// browser page cannot send that header to another origin without a preflight this server never answers. Loopback
// only, never in the demo, a few asks a minute. Nothing answered or logged here holds a key; the log holds no prompt
// and no answer either. GET /api/ai/hello?nonce= needs no token: it proves to the stdio tool, before the tool sends
// the token or a prompt, that this really is session-map (another program could hold the port while it is down).

// GET or POST /api/ai/recommend: the conductor's recommendation (conductor.mjs), same token and loopback rules.
export const ASK_PATHS = Object.freeze(['/api/ai/ask', '/api/ai/others', '/api/ai/hello', '/api/ai/recommend', '/api/ai/activity', '/api/ai/usage']);
// GET /api/ai/usage -> the other AIs measured by real use (usage.mjs): the panel of the "Other AIs" dialog.
// GET /api/ai/activity?limit= lists what the other AIs did (activity.mjs); POST /api/ai/activity/<id> {accepted, why} is Claude
// saying whether it accepted that work. Same token and loopback rules.
const ACTIVITY_ONE = /^\/api\/ai\/activity\/([^/]+)$/;
const FAILED_MAX = 20;
const NONCE_RE = /^[0-9a-f]{32,128}$/;
// HMAC-SHA256(token, 'session-map-proof:' + nonce): only who holds the token can make it, and it gives nothing away.
export const proofOf = (token, nonce) => createHmac('sha256', String(token)).update(`session-map-proof:${nonce}`).digest('hex');
export const ASK_RATE_LIMIT = 30;
const ASK_RATE_WINDOW_MS = 60_000;
// The prompt itself is capped at 200 KB by askOthers; JSON escaping may make the body bigger than the prompt.
const ASK_BODY_MAX = 1024 * 1024;
// An oversized body is read to its end without being kept, up to this, so the 413 reaches the client; past it the
// connection is closed instead.
const ASK_DRAIN_MAX = 16 * 1024 * 1024;
const HEADER = 'x-session-map-token';
const AUTHOR_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const ERRORS = {
  'bad-kind': 400, 'bad-sensitivity': 400, 'no-prompt': 400, 'bad-schema': 400, 'bad-exclude': 400, 'prompt-too-big': 413,
  'others-off': 409, 'no-ai-available': 503, 'all-failed': 502,
};

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fail = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });

// The stdio tools' lock: a request that carries the header token is judged by it alone, loopback only. -> null (no
// header: the usual rules apply) or {status: 200 | 401 | 403}. The agreed restart (POST /api/restart) uses it too.
export function headerAuth(req, address, token) {
  if (req.headers[HEADER] === undefined) return null;
  if (!isLocal(address, req.headers.host)) return { status: 403 };
  return sameToken(String(req.headers[HEADER]), token) ? { status: 200 } : { status: 401 };
}
export const hasHeaderToken = (req, token) => sameToken(String(req.headers[HEADER] ?? ''), token);

function readConfig(smDir) {
  try {
    const config = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    return isObject(config) ? config : {};
  } catch {
    return {};
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > ASK_DRAIN_MAX) return { error: 'too-large', close: true };
    if (size <= ASK_BODY_MAX) chunks.push(chunk);
  }
  if (size > ASK_BODY_MAX) return { error: 'too-large' };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
  } catch {
    return { error: 'bad-json' };
  }
}

// ai: the test doubles collect also gets ({bin, run, apiRun, keyOf}); backend: the keys' lock; apiRun/textRun: the
// providers' call (tests); ask: askOthers itself (tests). rootOf(sessionId): the project root of the page chat with that
// key, or null (the hub's), so an outside call's cost counts in that project's monthly budget (or07).
export function createAskRoutes({ smDir, demo = false, token, ai = {}, backend, apiRun, textRun, ask = askOthers, now = Date.now, rootOf = () => null } = {}) {
  const asks = [];
  const keyOf = ai.keyOf ?? (backend ? (provider) => getKey(smDir, provider, { backend }) : undefined);
  const queue = () => lifeOf(smDir, readConfig(smDir), ai).queue;

  const handles = (path) => ASK_PATHS.includes(path) || ACTIVITY_ONE.test(path);

  // Before the server's own authorize: a request to these routes that carries the header token is judged here, whole.
  // -> null (not ours: the usual rules apply) or {status: 200 | 401 | 403}.
  function authorizeHeader(req, url, address) {
    return handles(url.pathname) ? headerAuth(req, address, token) : null;
  }

  function others() {
    const s = othersSettings(readConfig(smDir).ai, listKeys(smDir).map((k) => k.provider));
    const q = demo || !smDir ? null : queue();
    const st = q ? q.status()?.others : null;
    const byId = new Map((st?.providers ?? []).map((p) => [p.id, p]));
    const providers = Object.keys(PROVIDERS).map((id) => {
      const p = byId.get(id) ?? {};
      return {
        id,
        model: typeof p.model === 'string' ? p.model : bulkModelOf(id, s.models),
        hasKey: s.keys.includes(id),
        on: !s.off.includes(id),
        paused: Boolean(p.paused),
        pausedWhy: p.pausedWhy ?? null,
        // Every kind of work it is paused for ('place': the map's bulk work): a pause for one kind leaves the others.
        pausedKinds: q ? [...HELPER_KINDS].filter((k) => q.pausedFor(id, k)) : [],
        spentUSDToday: Number(p.spentUSDToday) || 0,
        calls: Number(p.calls) || 0,
      };
    });
    const spent = Number(st?.spentUSDToday) || 0;
    return {
      ok: true, enabled: s.enabled, dailyUSD: s.dailyUSD, spentUSDToday: spent, capReached: st?.capReached ?? spent >= s.dailyUSD,
      providers, kinds: [...ASK_KINDS], sensitivities: [...SENSITIVITIES],
    };
  }

  async function askRoute(req) {
    const t = now();
    while (asks.length && t - asks[0] >= ASK_RATE_WINDOW_MS) asks.shift();
    if (asks.length >= ASK_RATE_LIMIT) return fail(429, 'too-many-asks');
    // Counted before the first await: asks that arrive together cannot all pass the check before any is counted. A
    // refused body counts too: it was an ask.
    asks.push(t);
    const read = await readJson(req);
    if (read.error === 'too-large') return { ...fail(413, read.error), ...(read.close ? { headers: { connection: 'close' } } : {}) };
    if (read.error) return fail(400, read.error);
    const b = read.value;
    if (!isObject(b)) return fail(400, 'bad-ask');
    if (b.author !== undefined && !(typeof b.author === 'string' && AUTHOR_RE.test(b.author))) return fail(400, 'bad-author');
    if (b.fanout !== undefined && !Number.isInteger(b.fanout)) return fail(400, 'bad-fanout');
    if (b.sessionId !== undefined && !(typeof b.sessionId === 'string' && SESSION_RE.test(b.sessionId))) return fail(400, 'bad-session');
    if (b.why !== undefined && typeof b.why !== 'string') return fail(400, 'bad-why');
    // cwd: the folder the asking program runs in (the arsenal tool sends it); only files the cost under a project.
    if (b.cwd !== undefined && cleanRoot(b.cwd) === null) return fail(400, 'bad-cwd');
    // exclude: the AIs that failed this work before; askOthers checks its shape and only removes them from the order.
    if (b.exclude !== undefined && !(Array.isArray(b.exclude) && b.exclude.length <= FAILED_MAX && b.exclude.every((x) => typeof x === 'string' && AUTHOR_RE.test(x)))) return fail(400, 'bad-exclude');
    // Every outside call, answered or not, is one line of the activity log: no prompt, no answer, no key.
    // The page chat's own project first; a terminal chat by the folder it runs in (or07).
    let root = null;
    try { root = (b.sessionId !== undefined ? rootOf(b.sessionId) : null) ?? (b.cwd !== undefined ? b.cwd : null); } catch { root = null; }
    const onCall = (call) => {
      if (root && Number(call?.costUSD) > 0) addOthersSpend(smDir, root, Number(call.costUSD), now());
      return recordActivity(smDir, {
        ...call, source: 'chat', kind: b.kind, sensitivity: b.sensitivity,
        ...(b.sessionId !== undefined ? { sessionId: b.sessionId } : {}), ...(b.why ? { recommendedBy: b.why } : {}),
      });
    };
    const result = await ask({
      smDir, queue: queue(), kind: b.kind, sensitivity: b.sensitivity, prompt: b.prompt,
      ...(b.schemaHint !== undefined ? { schemaHint: b.schemaHint } : {}),
      ...(b.fanout !== undefined ? { fanout: b.fanout } : {}),
      ...(b.author !== undefined ? { author: b.author } : {}),
      ...(b.exclude !== undefined ? { exclude: b.exclude } : {}),
      ...(keyOf ? { keyOf } : {}), ...(apiRun ? { apiRun } : {}), ...(textRun ? { textRun } : {}), onCall,
    });
    const answers = Array.isArray(result?.answers) ? result.answers : [];
    const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
    const costUSD = answers.reduce((sum, a) => sum + (Number(a.costUSD) || 0), 0);
    const status = result?.ok ? 200 : ERRORS[result?.error] ?? 500;
    logAction(smDir, { action: 'ai-ask', mode: typeof b.kind === 'string' ? b.kind : '', scope: typeof b.sensitivity === 'string' ? b.sensitivity : '', count: answers.length, usd: Math.round(costUSD * 1e6) / 1e6 }, status);
    if (result?.ok) return { status, body: { ok: true, answers, skipped } };
    return fail(status, typeof result?.error === 'string' ? result.error : 'failed', { answers: [], skipped });
  }

  // GET /api/ai/activity?limit=50 -> {ok, items} newest first.
  function activityList(url) {
    const raw = url.searchParams.get('limit');
    return { status: 200, body: { ok: true, items: readActivity(smDir, raw === null ? undefined : Number(raw)) } };
  }

  // POST /api/ai/activity/<id> {accepted, why}: Claude says whether it accepted that work.
  async function activityResult(req, id) {
    if (!ID_RE.test(id)) return fail(400, 'bad-id');
    const read = await readJson(req);
    if (read.error === 'too-large') return { ...fail(413, read.error), ...(read.close ? { headers: { connection: 'close' } } : {}) };
    if (read.error) return fail(400, read.error);
    const done = setResult(smDir, id, read.value);
    if (done.ok) return { status: 200, body: { ok: true } };
    return fail(done.error === 'unknown-activity' ? 404 : done.error === 'not-saved' ? 500 : 400, done.error);
  }

  // The conductor's recommendation: the request's fields from the JSON body (POST) or the query (GET). It costs nothing
  // and calls nobody; the decision and its reason go to smDir/conductor.log.
  async function recommendRoute(req, url) {
    let b;
    if (req.method === 'POST') {
      const read = await readJson(req);
      if (read.error === 'too-large') return { ...fail(413, read.error), ...(read.close ? { headers: { connection: 'close' } } : {}) };
      if (read.error) return fail(400, read.error);
      b = read.value;
      if (!isObject(b)) return fail(400, 'bad-request');
    } else {
      const q = url.searchParams;
      const flag = (k) => (q.has(k) ? q.get(k) === 'true' || q.get(k) === '1' : undefined);
      b = { kind: q.get('kind') ?? undefined, size: q.get('size') ?? undefined, sensitivity: q.get('sensitivity') ?? undefined, critical: flag('critical'), longRun: flag('longRun'), author: q.get('author') ?? undefined, failedBefore: q.has('failedBefore') ? q.get('failedBefore').split(',').filter(Boolean) : undefined };
    }
    if (b.author !== undefined && !(typeof b.author === 'string' && AUTHOR_RE.test(b.author))) return fail(400, 'bad-author');
    if (b.failedBefore !== undefined && !(Array.isArray(b.failedBefore) && b.failedBefore.length <= FAILED_MAX && b.failedBefore.every((f) => typeof f === 'string' && AUTHOR_RE.test(f)))) return fail(400, 'bad-failed');
    const input = {
      kind: b.kind, size: b.size, sensitivity: b.sensitivity, critical: b.critical === true, longRun: b.longRun === true,
      ...(b.author !== undefined ? { author: b.author } : {}), ...(b.failedBefore !== undefined ? { failedBefore: b.failedBefore } : {}),
    };
    let rec;
    try {
      rec = recommend({ ...input, smDir, others: others() });
    } catch (err) {
      if (err?.code === 'bad-kind' || err?.code === 'bad-size') return fail(400, err.code);
      throw err;
    }
    recordDecision(smDir, input, rec);
    return { status: 200, body: { ok: true, ...rec } };
  }

  // -> {status, body}. The token: the page's cookie or the header, judged by authorizeHeader before this.
  async function handle(req, url, address) {
    if (demo) return fail(403, 'demo');
    if (!isLocal(address, req.headers.host)) return fail(403, 'loopback-only');
    if (url.pathname === '/api/ai/hello') {
      if (req.method !== 'GET') return fail(404, 'not-found');
      const nonce = url.searchParams.get('nonce') ?? '';
      return NONCE_RE.test(nonce) ? { status: 200, body: { ok: true, proof: proofOf(token, nonce) } } : fail(400, 'bad-nonce');
    }
    if (!sameToken(cookieToken(req), token) && !sameToken(String(req.headers[HEADER] ?? ''), token)) return fail(401, 'token-required');
    if (url.pathname === '/api/ai/others' && req.method === 'GET') return { status: 200, body: others() };
    if (url.pathname === '/api/ai/ask' && req.method === 'POST') return askRoute(req);
    if (url.pathname === '/api/ai/recommend' && (req.method === 'GET' || req.method === 'POST')) return recommendRoute(req, url);
    if (url.pathname === '/api/ai/activity' && req.method === 'GET') return activityList(url);
    if (url.pathname === '/api/ai/usage' && req.method === 'GET') return { status: 200, body: { ok: true, ...usageSummary({ smDir, now: now() }) } };
    const one = ACTIVITY_ONE.exec(url.pathname);
    if (one && req.method === 'POST') return activityResult(req, one[1]);
    return fail(404, 'not-found');
  }

  return { handles, authorizeHeader, handle, others };
}
