import { log } from '../log.mjs';
import { readFd, writeFd } from './store.mjs';

// GitHub facts for the repository health (fd08). Network only when the owner asks ("Verificar online").
// Every endpoint below was checked against the official docs (REST 2022-11-28) on 2026-10-10; what the docs
// do not confirm stays null (Projects: the classic REST API was sunset on 2025-04-01, v2 is GraphQL only).

const GITHUB_API = 'api.github.com';
const SCORECARD = 'api.securityscorecards.dev';
const BEST_PRACTICES = 'www.bestpractices.dev';
// The only hosts this module may reach; the token goes to GITHUB_API and nowhere else.
const HOSTS = new Set([GITHUB_API, SCORECARD, BEST_PRACTICES]);
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
export const BODY_MAX = 1024 * 1024;
// ponytail: one hour is enough for a health page; the owner can press "Verificar online" again after that.
export const TTL_MS = 60 * 60 * 1000;
const REVIEW_SAMPLE = 20;
// A pull request in the list weighs about 22 KB (measured live): pages of 30 stay well under BODY_MAX.
const PULL_PAGE = 30;
const PULL_PAGES = 3;
const TEXT_MAX = 1000;

export const API_FIELDS = Object.freeze([
  'version', 'generatedAt', 'fetchedAt', 'mode', 'error', 'repo', 'visibility', 'description', 'topics', 'homepage',
  'secretScanning', 'pushProtection', 'branchProtection', 'privateReporting', 'vulnAlerts', 'reviewRatio', 'releases',
  'labels', 'milestones', 'projects', 'webhooks', 'twoFactor', 'scorecard', 'openssfBadge',
]);
// Read only with a token: they need admin (or owner) rights on the repository or the organization.
export const PROTECTED_FIELDS = Object.freeze(['secretScanning', 'pushProtection', 'privateReporting', 'vulnAlerts', 'webhooks', 'twoFactor']);

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function parseRemote(url) {
  if (typeof url !== 'string' || !url) return null;
  let path = null;
  const scp = /^git@github\.com:(.+)$/.exec(url);
  if (scp) path = scp[1];
  else {
    let u;
    try { u = new URL(url); } catch { return null; }
    const okProto = u.protocol === 'https:' || (u.protocol === 'ssh:' && u.username === 'git');
    if (!okProto || u.hostname !== 'github.com' || u.port) return null;
    path = u.pathname.replace(/^\/+/, '');
  }
  const parts = path.replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  return { host: 'github.com', owner, name };
}

// The one place the token is read (the owner has not chosen yet how to hand it over; see bloco-4.md).
export function githubToken(env = process.env) {
  const t = typeof env?.SESSION_MAP_GITHUB_TOKEN === 'string' ? env.SESSION_MAP_GITHUB_TOKEN.trim() : '';
  return t || null;
}

async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body?.cancel(); } catch { /* already closed */ }
    return null;
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }
  const text = typeof res.text === 'function' ? await res.text() : '';
  return Buffer.byteLength(text) > max ? null : text;
}

function allowed(u) {
  return u.protocol === 'https:' && HOSTS.has(u.hostname) && !u.port && !u.username && !u.password;
}

// GET on a listed https host, no redirect off the list, 10 s, 1 MB. Never throws.
// -> { status, headers, data } | { error: 'refused' | 'no-network' | 'too-big', status? }
export async function safeGet(url, { token = null, fetchFn = globalThis.fetch } = {}) {
  let target;
  try { target = new URL(url); } catch { return { error: 'refused' }; }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(target)) return { error: 'refused' };
    const headers = { accept: 'application/json', 'user-agent': 'session-map' };
    if (target.hostname === GITHUB_API) {
      headers.accept = 'application/vnd.github+json';
      headers['x-github-api-version'] = '2022-11-28';
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetchFn(target.href, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return { error: 'no-network' };
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
    if (location) {
      try { await res.body?.cancel(); } catch { /* nothing to drain */ }
      try { target = new URL(location, target); } catch { return { error: 'refused' }; }
      continue;
    }
    let text;
    try { text = await readCapped(res, BODY_MAX); } catch { return { error: 'no-network' }; }
    if (text === null) return { status: res.status, error: 'too-big' };
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, headers: res.headers, data };
  }
  return { error: 'refused' };
}

function rateLimited(r) {
  if (r.status === 429) return true;
  if (r.status !== 403) return false;
  const h = (k) => r.headers?.get?.(k);
  return h('x-ratelimit-remaining') === '0' || h('retry-after') != null || /rate limit/i.test(String(r.data?.message ?? ''));
}

class Stop {
  constructor(error) { this.error = error; }
}

function emptyFacts(nowIso, mode, error, repo) {
  const facts = {};
  for (const f of API_FIELDS) facts[f] = null;
  return Object.assign(facts, { version: 1, generatedAt: nowIso, fetchedAt: nowIso, mode, error, repo });
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, TEXT_MAX) : null);
const list = (v) => (Array.isArray(v) ? v : null);
const names = (v) => {
  const a = list(v);
  return a && a.every((x) => typeof x?.name === 'string') ? a.map((x) => x.name.slice(0, TEXT_MAX)) : null;
};
const statusOn = (v) => (v?.status === 'enabled' ? true : v?.status === 'disabled' ? false : null);
const toMs = (now) => (now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now));
const sameRepo = (a, b) => !!a && !!b && a.host === b.host && a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
const repoUrlKey = (u) => String(u ?? '').trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');

// "internal" (enterprise) is not public: the public-only items must not be charged.
function visibilityOf(info) {
  if (info.visibility === 'public') return 'public';
  if (info.visibility === 'private' || info.visibility === 'internal') return 'private';
  if (typeof info.private === 'boolean') return info.private ? 'private' : 'public';
  return null;
}

function pick(facts) {
  const out = {};
  for (const f of API_FIELDS) out[f] = facts?.[f] ?? null;
  return out;
}

function freshCache(cached, repo, mode, nowMs) {
  if (!cached || cached.version !== 1 || cached.error || cached.mode !== mode || !sameRepo(cached.repo, repo)) return false;
  const age = nowMs - Date.parse(cached.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < TTL_MS;
}

export async function fetchApiFacts({ remote, token = null, fetchFn = globalThis.fetch, cached = null, now = Date.now() } = {}) {
  const nowMs = toMs(now);
  const nowIso = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const repo = parseRemote(remote);
  if (!repo) return emptyFacts(nowIso, 'none', 'no-remote', null);
  const mode = token ? 'token' : 'public';
  if (freshCache(cached, repo, mode, nowMs)) return pick(cached);

  const facts = emptyFacts(nowIso, mode, null, repo);
  const base = `https://${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  // A GitHub call: rate limit and network loss stop the whole run (what came before stays); anything else = no data.
  const gh = async (path) => {
    const r = await safeGet(`${base}${path}`, { token, fetchFn });
    if (r.error === 'no-network') throw new Stop('no-network');
    if (rateLimited(r)) throw new Stop('rate-limit');
    if (r.status === 401) throw new Stop('unauthorized');
    if (r.error || r.status !== 200) {
      if (r.status !== 404 && r.status !== 403) log('warn', 'github-api-failed', { endpoint: path.split('?')[0] || '/', status: r.status ?? null, error: r.error ?? null });
      return null;
    }
    return r.data;
  };
  // Scorecard and the Best Practices badge: no token, and their failure never stops the GitHub facts.
  const other = async (url) => {
    const r = await safeGet(url, { fetchFn });
    return !r.error && r.status === 200 ? r.data : null;
  };

  try {
    const info = await gh('');
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      // Hidden from this caller: with a token the token cannot see it; anonymous it may be private or gone.
      if (mode === 'token') facts.error = 'unauthorized';
      return facts;
    }
    facts.visibility = visibilityOf(info);
    facts.description = str(info.description);
    facts.homepage = str(info.homepage);
    facts.topics = Array.isArray(info.topics) && info.topics.every((t) => typeof t === 'string') ? info.topics.slice(0, 50) : null;
    if (mode === 'token') {
      facts.secretScanning = statusOn(info.security_and_analysis?.secret_scanning);
      facts.pushProtection = statusOn(info.security_and_analysis?.secret_scanning_push_protection);
    }

    const branch = str(info.default_branch);
    if (branch) {
      const b = await gh(`/branches/${encodeURIComponent(branch)}`);
      // "protected" = branch protection or rulesets (docs, List branches).
      facts.branchProtection = typeof b?.protected === 'boolean' ? b.protected : null;
    }

    const rel = list(await gh('/releases?per_page=30'));
    facts.releases = rel && rel.every((x) => typeof x?.tag_name === 'string')
      ? rel.filter((x) => x.draft !== true).map((x) => ({
        tag: x.tag_name.slice(0, TEXT_MAX),
        hasNotes: typeof x.body === 'string' && x.body.trim().length > 0,
        assets: names(x.assets) ?? [],
      }))
      : null;
    facts.labels = names(await gh('/labels?per_page=100'));
    const ms = list(await gh('/milestones?state=all&per_page=100'));
    facts.milestones = ms ? ms.length : null;

    const merged = [];
    for (let page = 1; page <= PULL_PAGES && merged.length < REVIEW_SAMPLE; page++) {
      const pulls = list(await gh(`/pulls?state=closed&sort=updated&direction=desc&per_page=${PULL_PAGE}&page=${page}`));
      if (!pulls) break;
      for (const p of pulls) if (p?.merged_at && Number.isInteger(p.number) && merged.length < REVIEW_SAMPLE) merged.push(p);
      if (pulls.length < PULL_PAGE) break;
    }
    if (merged.length) {
      let approved = 0;
      let known = 0;
      for (const p of merged) {
        const reviews = list(await gh(`/pulls/${p.number}/reviews?per_page=100`));
        if (!reviews) continue;
        known++;
        if (reviews.some((r) => r?.state === 'APPROVED')) approved++;
      }
      facts.reviewRatio = known ? approved / known : null;
    }

    if (mode === 'token') {
      const pvr = await gh('/private-vulnerability-reporting');
      facts.privateReporting = typeof pvr?.enabled === 'boolean' ? pvr.enabled : null;
      // ponytail: one page of 100 open alerts; the check only needs "any open?".
      const alerts = list(await gh('/dependabot/alerts?state=open&per_page=100'));
      facts.vulnAlerts = alerts ? { open: alerts.length } : null;
      const hooks = list(await gh('/hooks?per_page=100'));
      facts.webhooks = hooks ? hooks.map((h) => ({
        secure: /^https:\/\//i.test(String(h?.config?.url ?? '')) && String(h?.config?.insecure_ssl ?? '0') === '0',
      })) : null;
      if (info.owner?.type === 'Organization' && OWNER.test(String(info.owner?.login ?? ''))) {
        const r = await safeGet(`https://${GITHUB_API}/orgs/${encodeURIComponent(info.owner.login)}`, { token, fetchFn });
        if (r.error === 'no-network') throw new Stop('no-network');
        if (rateLimited(r)) throw new Stop('rate-limit');
        const v = r.status === 200 ? r.data?.two_factor_requirement_enabled : null;
        facts.twoFactor = typeof v === 'boolean' ? v : null;
      }
    }

    if (facts.visibility === 'public') {
      const sc = await other(`https://${SCORECARD}/projects/github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`);
      if (typeof sc?.score === 'number' && Array.isArray(sc.checks)) {
        const checks = {};
        // -1 = the check could not decide: left out, never read as a score.
        for (const c of sc.checks) if (typeof c?.name === 'string' && Number.isInteger(c.score) && c.score >= 0 && c.score <= 10) checks[c.name] = c.score;
        facts.scorecard = { score: sc.score, checks };
      }
      const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
      const bp = list(await other(`https://${BEST_PRACTICES}/en/projects.json?${new URLSearchParams({ url: repoUrl })}`));
      if (bp) {
        const mine = bp.find((p) => repoUrlKey(p?.repo_url) === repoUrlKey(repoUrl));
        facts.openssfBadge = ['passing', 'silver', 'gold'].includes(mine?.badge_level) ? mine.badge_level : false;
      }
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    facts.error = err.error;
  }
  return facts;
}

export function readApiFacts(smDir, projectId) {
  const data = readFd(smDir, projectId, 'health-api.json', null);
  return data && typeof data === 'object' ? pick(data) : null;
}

// Only the contract fields reach the disk, whatever the caller passes in.
export function writeApiFacts(smDir, projectId, facts) {
  writeFd(smDir, projectId, 'health-api.json', pick(facts));
}
