// The online side of "versions always in sight" (fd09): who answers about the pieces of a project. endoflife.date (end of
// life of Node and PHP), OSV querybatch (known advisories, npm/Packagist/Pub), the registries (latest version), the tags of
// session-map itself on GitHub and the project's own live endpoint. It only runs when the owner clicks "Verificar online";
// the answers are handed to versions-core.warningOf in the `sources` shape it reads, never judged here. Network rules
// (block 4b § 3): injected fetchFn, https only, a fixed list of hosts, 10 s, 1 MB, no redirect, a failure is null and never
// an exception. Only the name, the ecosystem and the version of a package leave the machine; no token is ever sent.
import { readFileSync } from 'node:fs';
import { log } from '../log.mjs';
import { parseSemver, compareSemver, floorOfRange, pieceKey } from './versions-core.mjs';

export const ONLINE_HOSTS = Object.freeze(['endoflife.date', 'api.osv.dev', 'registry.npmjs.org', 'repo.packagist.org', 'pub.dev', 'api.github.com']);
const HOSTS = new Set(ONLINE_HOSTS);
// ponytail: answers are kept 24 h; a click inside that window only asks for what the cache does not have yet.
export const VERSIONS_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
// ponytail: a version endpoint answers a number, not a page; anything larger than 4 KB is not one.
const LIVE_MAX_BYTES = 4 * 1024;

const OSV_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_ECOSYSTEM = { npm: 'npm', packagist: 'Packagist', pub: 'Pub' };
const EOL_PRODUCT = { node: 'nodejs', php: 'php' };
// Registry names exactly as each registry allows them, so a name read from a manifest can never bend a URL.
const VALID_NAME = {
  npm: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
  packagist: /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/,
  pub: /^[a-z_][a-z0-9_]*$/,
};
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const textOf = (p) => `${p.major}.${p.minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}`;
const semverText = (v) => {
  const p = parseSemver(typeof v === 'string' ? v : '');
  return p ? textOf(p) : null;
};

// ---------- one request ----------
function listedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '' || !HOSTS.has(u.hostname)) return null;
  return u;
}

// Reads at most `max` bytes; past that the body is cancelled and refused (no half answer is ever parsed). Cancels are not
// awaited: a stream shared with a clone only settles its cancel when every branch is cancelled.
async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    res.body?.cancel?.().catch(() => {});
    return null;
  }
  if (!res.body?.getReader) {
    const text = await res.text();
    return Buffer.byteLength(text) > max ? null : text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

// { text, error }: error = no-network (thrown, timeout) | redirect | status | too-big. The URL is already checked.
async function request(u, { fetchFn, method = 'GET', body, headers = {}, maxBytes, timeoutMs }) {
  try {
    const res = await fetchFn(u.href, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!res || typeof res.status !== 'number') return { error: 'no-network' };
    const movedAway = res.url ? new URL(res.url).origin !== u.origin : false;
    if (res.type === 'opaqueredirect' || res.redirected || movedAway || (res.status >= 300 && res.status < 400)) {
      res.body?.cancel?.().catch(() => {});
      return { error: 'redirect' };
    }
    if (res.status < 200 || res.status > 299) {
      res.body?.cancel?.().catch(() => {});
      return { error: 'status' };
    }
    const text = await readCapped(res, maxBytes);
    return text === null ? { error: 'too-big' } : { text };
  } catch {
    return { error: 'no-network' };
  }
}

async function getJsonFrom(url, opts = {}) {
  const u = listedUrl(url);
  if (!u) return { error: 'refused' };
  const { text, error } = await request(u, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, ...opts });
  if (error) return { error };
  try { return { data: JSON.parse(text) }; } catch { return { error: 'bad-answer' }; }
}

// A JSON answer from one of the listed hosts, or null (refused host, network, redirect, status, size or not JSON).
export async function fetchJson(url, opts = {}) {
  return (await getJsonFrom(url, opts)).data ?? null;
}

// ---------- the live endpoint ----------
// The URL only ever comes from the GLOBAL config (block 4b § 5); still: https, or http on this machine, no credentials.
export function liveUrlProblem(url) {
  let u;
  try { u = new URL(url); } catch { return 'invalid'; }
  if (u.username || u.password) return 'credentials';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return null;
  return 'insecure';
}

function liveVersionOf(text) {
  let value = text.trim();
  try {
    const parsed = JSON.parse(value);
    value = typeof parsed === 'string' ? parsed : typeof parsed?.version === 'string' ? parsed.version : '';
  } catch { /* plain text answer */ }
  return semverText(value);
}

async function checkLive(liveUrl, codeVersion, { fetchFn, timeoutMs, checkedAt }) {
  const failed = (error) => ({ url: liveUrl, version: null, match: null, checkedAt, error });
  const problem = liveUrlProblem(liveUrl);
  if (problem) return failed(problem);
  const { text, error } = await request(new URL(liveUrl), {
    fetchFn, headers: { accept: 'application/json, text/plain' }, maxBytes: LIVE_MAX_BYTES, timeoutMs,
  });
  if (error) return failed(error);
  const version = liveVersionOf(text);
  if (!version) return failed('bad-answer');
  const code = semverText(codeVersion);
  return { url: liveUrl, version, match: code ? compareSemver(version, code) === 0 : null, checkedAt };
}

// ---------- the sources ----------
async function askOsv(queries, ctx) {
  if (!queries.length) return {};
  const body = JSON.stringify({ queries: queries.map((q) => ({ package: { name: q.name, ecosystem: OSV_ECOSYSTEM[q.ecosystem] }, version: q.version })) });
  const { data, error } = await getJsonFrom(OSV_URL, { ...ctx, method: 'POST', body, headers: { 'content-type': 'application/json' } });
  const results = data?.results;
  if (error || !Array.isArray(results) || results.length !== queries.length) return ctx.fail(error ?? 'bad-answer', OSV_URL), {};
  const out = {};
  queries.forEach((q, i) => {
    const vulns = Array.isArray(results[i]?.vulns) ? results[i].vulns : [];
    out[q.key] = [...new Set(vulns.map((v) => v?.id).filter((id) => typeof id === 'string' && id))];
  });
  return out;
}

function latestUrl(ecosystem, name) {
  if (ecosystem === 'npm') return `https://registry.npmjs.org/-/package/${name}/dist-tags`;
  if (ecosystem === 'packagist') return `https://repo.packagist.org/p2/${name}.json`;
  return `https://pub.dev/api/packages/${name}`;
}

// The highest stable release: Packagist p2 lists every tagged release (minified, not promised in order).
function highestStable(versions) {
  let best = null;
  for (const v of versions) {
    const p = parseSemver(typeof v === 'string' ? v : '');
    if (p && p.pre === null && (best === null || compareSemver(p, best) > 0)) best = p;
  }
  return best ? textOf(best) : null;
}

function latestOf(ecosystem, name, data) {
  if (ecosystem === 'npm') return semverText(data?.latest);
  if (ecosystem === 'pub') return semverText(data?.latest?.version);
  const list = data?.packages?.[name];
  return Array.isArray(list) ? highestStable(list.map((x) => x?.version)) : null;
}

async function askLatest(ecosystem, name, ctx) {
  const url = latestUrl(ecosystem, name);
  const headers = ecosystem === 'pub' ? { accept: 'application/vnd.pub.v2+json' } : { accept: 'application/json' };
  const { data, error } = await getJsonFrom(url, { ...ctx, headers });
  const latest = error ? null : latestOf(ecosystem, name, data);
  if (!latest) ctx.fail(error ?? 'bad-answer', url);
  return latest;
}

async function askEol(product, ctx) {
  const url = `https://endoflife.date/api/${product}.json`;
  const { data, error } = await getJsonFrom(url, { ...ctx, headers: { accept: 'application/json' } });
  if (error || !Array.isArray(data)) return ctx.fail(error ?? 'bad-answer', url), null;
  const cycles = data
    .filter((c) => (typeof c?.cycle === 'string' || typeof c?.cycle === 'number') && (typeof c.eol === 'string' || typeof c.eol === 'boolean'))
    .map((c) => ({ cycle: String(c.cycle), eol: c.eol }));
  return cycles.length ? cycles : (ctx.fail('bad-answer', url), null);
}

// Anonymous on purpose: the token is never needed for a public list of tags (60 calls an hour, cached 24 h).
async function askSelf(current, repo, ctx) {
  const base = { current, latest: null, newer: null, verified: false };
  if (!REPO.test(repo ?? '')) return base;
  const url = `https://api.github.com/repos/${repo}/tags?per_page=100`;
  const { data, error } = await getJsonFrom(url, { ...ctx, headers: { accept: 'application/vnd.github+json', 'user-agent': 'session-map' } });
  if (error || !Array.isArray(data)) return ctx.fail(error ?? 'bad-answer', url), base;
  const latest = highestStable(data.map((t) => t?.name));
  if (!latest) return ctx.fail('bad-answer', url), base;
  const cur = semverText(current);
  return { current, latest, newer: cur ? compareSemver(latest, cur) > 0 : null, verified: true };
}

// `owner/name` of session-map from its package.json (`git+https://github.com/<o>/<n>.git` or `github:<o>/<n>`).
export function repoOfPackage(pkg) {
  const raw = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url;
  if (typeof raw !== 'string') return null;
  const m = /^(?:github:([^/]+\/[^/#]+)|(?:git\+)?https:\/\/github\.com\/([^/]+\/[^/#]+?))(?:\.git)?\/?$/.exec(raw.trim());
  const repo = m ? m[1] ?? m[2] : null;
  return repo && REPO.test(repo) ? repo : null;
}

function ownRepo() {
  try { return repoOfPackage(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))); } catch { return null; }
}

const msOf = (now) => (now instanceof Date ? now.getTime() : typeof now === 'number' ? now : now ? Date.parse(now) : Date.now());

// pieces = [{ name, ecosystem: npm|packagist|pub|runtime, version (or range) }] (other fields never leave the machine);
// node = { running, required } asks Node's end of life; selfVersion = session-map's version (its tags are compared);
// liveUrl + codeVersion = the version running live against the code; cached = the previous result.
// Returns the `sources` versions-core.warningOf reads ({ vulns, eol, latest, reason }) plus self, live and fetchedAt.
// Without network every map is empty and reason is 'no-network': no piece is ever verified by default.
export async function fetchSources({
  pieces = [], node = null, selfVersion = null, selfRepo, liveUrl = null, codeVersion = null,
  fetchFn = globalThis.fetch, cached = null, now = Date.now(), timeoutMs = TIMEOUT_MS,
} = {}) {
  const at = msOf(now);
  const checkedAt = new Date(at).toISOString();
  const cachedAt = Date.parse(cached?.fetchedAt ?? '');
  const fresh = Number.isFinite(cachedAt) && at - cachedAt >= 0 && at - cachedAt < VERSIONS_TTL_MS;
  const keep = fresh ? cached : {};
  const errors = [];
  const ctx = {
    fetchFn, timeoutMs,
    fail(error, url) { errors.push({ error, host: new URL(url).hostname }); },
  };

  const queries = new Map();
  const latestAsk = new Map();
  const eolAsk = new Set(node ? ['node'] : []);
  for (const p of Array.isArray(pieces) ? pieces : []) {
    if (!p || typeof p.name !== 'string') continue;
    if (p.ecosystem === 'runtime') {
      if (EOL_PRODUCT[p.name]) eolAsk.add(p.name);
      continue;
    }
    if (!VALID_NAME[p.ecosystem]?.test(p.name)) continue;
    latestAsk.set(`${p.ecosystem}:${p.name}`, p);
    const version = floorOfRange(p.version);
    if (!version) continue;
    const key = pieceKey({ ecosystem: p.ecosystem, name: p.name, version });
    queries.set(key, { key, name: p.name, ecosystem: p.ecosystem, version });
  }

  const vulns = {};
  const latest = {};
  const eol = {};
  for (const key of queries.keys()) if (Array.isArray(keep.vulns?.[key])) vulns[key] = keep.vulns[key];
  for (const key of latestAsk.keys()) if (typeof keep.latest?.[key] === 'string') latest[key] = keep.latest[key];
  for (const name of eolAsk) if (Array.isArray(keep.eol?.[name])) eol[name] = keep.eol[name];
  const reused = Object.keys(vulns).length + Object.keys(latest).length + Object.keys(eol).length > 0;

  const keptSelf = keep.self?.verified && keep.self.current === selfVersion ? keep.self : null;
  const repo = selfRepo === undefined ? ownRepo() : selfRepo;
  const [osv, latestPairs, eolPairs, self, live] = await Promise.all([
    askOsv([...queries.values()].filter((q) => !Object.hasOwn(vulns, q.key)), ctx),
    Promise.all([...latestAsk.entries()].filter(([key]) => !Object.hasOwn(latest, key))
      .map(async ([key, p]) => [key, await askLatest(p.ecosystem, p.name, ctx)])),
    Promise.all([...eolAsk].filter((name) => !Object.hasOwn(eol, name))
      .map(async (name) => [name, await askEol(EOL_PRODUCT[name], ctx)])),
    selfVersion ? keptSelf ?? askSelf(selfVersion, repo, ctx) : null,
    liveUrl ? checkLive(liveUrl, codeVersion, { fetchFn, timeoutMs, checkedAt }) : null,
  ]);
  Object.assign(vulns, osv);
  for (const [key, value] of latestPairs) if (value) latest[key] = value;
  for (const [name, value] of eolPairs) if (value) eol[name] = value;

  if (errors.length) log('warn', 'versions-online-failed', { failures: errors.length, hosts: [...new Set(errors.map((e) => e.host))] });
  const reason = errors.some((e) => e.error === 'no-network') ? 'no-network' : errors.length ? 'no-data' : null;
  return {
    version: 1,
    fetchedAt: fresh && (reused || keptSelf) ? cached.fetchedAt : checkedAt,
    vulns, eol, latest, self, live, reason,
  };
}
