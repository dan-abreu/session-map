import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findClaude } from '../ai/runner.mjs';
import { writeAtomic } from '../store.mjs';
import { CATEGORIES, TYPES, classifyRepo } from '../catalog-classify.mjs';
import { log } from '../log.mjs';

export const CACHE_TTL_MS = 24 * 3600_000;
const API = 'https://api.github.com';
const TOPICS = ['claude-code-plugin', 'claude-code-skills', 'claude-skills', 'agent-skills', 'claude-code'];
const MARKETPLACE_FILE = '.claude-plugin/marketplace.json';
const REPO_RE = /^\w[\w.-]*\/[\w.-]+$/;
const NAME_RE = /^\w[\w.-]*$/;
const MAX_EXTRA_REPOS = 40;
const MAX_KNOWN_REPOS = 20;
const MAX_FILE_LOOKUPS = 60;
const DESCRIPTION_MAX = 300;
const SORTS = {
  stars: (a, b) => b.stars - a.stars,
  updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
  name: (a, b) => a.name.localeCompare(b.name),
};

const TYPE_SET = new Set(TYPES);
const CATEGORY_SET = new Set(CATEGORIES);

class LimitReached extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function readCatalogCache(smDir) {
  const cache = readJson(join(smDir, 'catalog.json'));
  if (!Array.isArray(cache?.items) || typeof cache.fetchedAt !== 'string') return null;
  // The category needs only name, description and topics: a newer classifier applies to an older cache too.
  return { ...cache, items: cache.items.map((i) => ({ ...i, category: classifyRepo({ name: i.name, description: i.description, topics: i.topics }, []).category })) };
}

// What the caller gets from a child process; a missing binary is {code: null}, never a throw.
export function execCapture(file, args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

// The token never leaves this process: it goes into request headers and nowhere else.
export async function resolveToken({ env = process.env, exec = execCapture } = {}) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const out = await exec('gh', ['auth', 'token']);
    return out.code === 0 && out.stdout.trim() ? out.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function knownMarketplaces(dir) {
  const known = readJson(join(dir, 'plugins', 'known_marketplaces.json')) ?? {};
  return Object.entries(known).flatMap(([name, entry]) => (
    entry?.source?.source === 'github' && REPO_RE.test(entry.source.repo ?? '')
      ? [{ name, repo: entry.source.repo, installLocation: entry.installLocation ?? null }]
      : []
  ));
}

function toItem(raw, files) {
  const topics = Array.isArray(raw.topics) ? raw.topics : [];
  const { type, category } = classifyRepo({ name: raw.name, description: raw.description, topics }, files);
  return {
    repo: raw.full_name,
    name: raw.name,
    owner: raw.owner?.login ?? raw.full_name.split('/')[0],
    stars: raw.stargazers_count ?? 0,
    description: String(raw.description ?? '').slice(0, DESCRIPTION_MAX),
    topics,
    type,
    category,
    updatedAt: raw.pushed_at ?? raw.updated_at ?? null,
    license: raw.license?.spdx_id && raw.license.spdx_id !== 'NOASSERTION' ? raw.license.spdx_id : null,
    archived: raw.archived === true,
    url: raw.html_url ?? `https://github.com/${raw.full_name}`,
    hasMarketplace: files.includes(MARKETPLACE_FILE),
  };
}

function isRateLimit(res, body) {
  if (res.status === 429) return true;
  return res.status === 403 && (res.headers?.get?.('x-ratelimit-remaining') === '0' || /rate limit/i.test(body?.message ?? ''));
}

// → parsed JSON, or null when the request failed. The limit throws LimitReached; any other failure is counted so a broken
// fetch never replaces a good cache. A 404 is an answer (repository gone, folder missing), not a failure.
function githubClient({ token, fetchFn }) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'session-map',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const state = { failures: 0, networkFailures: 0, unauthorized: false };
  async function get(path) {
    let res;
    try {
      res = await fetchFn(`${API}${path}`, { headers });
    } catch {
      state.failures++;
      state.networkFailures++;
      return null;
    }
    const body = await res.json().catch(() => null);
    if (isRateLimit(res, body)) throw new LimitReached();
    if (res.ok) return body;
    if (res.status !== 404) {
      state.failures++;
      if (res.status === 401) state.unauthorized = true;
    }
    return null;
  }
  return { get, state };
}

async function gather({ token, fetchFn, dir }) {
  const api = githubClient({ token, fetchFn });
  const repos = new Map();
  const add = (raw, markets = false) => {
    if (!REPO_RE.test(raw?.full_name ?? '')) return;
    const key = raw.full_name.toLowerCase();
    const entry = repos.get(key) ?? { raw, files: new Set() };
    if (markets) entry.files.add(MARKETPLACE_FILE);
    repos.set(key, entry);
  };
  const addByName = async (full, markets) => {
    if (!REPO_RE.test(full)) return;
    const known = repos.get(full.toLowerCase());
    if (known) {
      if (markets) known.files.add(MARKETPLACE_FILE);
      return;
    }
    const raw = await api.get(`/repos/${full}`);
    if (raw) add(raw, markets);
  };

  try {
    for (const topic of TOPICS) {
      const found = await api.get(`/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}&sort=stars&per_page=50`);
      for (const raw of found?.items ?? []) add(raw);
    }
    if (token) {
      const found = await api.get(`/search/code?q=${encodeURIComponent('filename:marketplace.json path:.claude-plugin')}&per_page=50`);
      const names = [...new Set((found?.items ?? []).map((i) => i.repository?.full_name))].filter(Boolean);
      for (const full of names.slice(0, MAX_EXTRA_REPOS)) await addByName(full, true);
    }
    for (const { repo } of knownMarketplaces(dir).slice(0, MAX_KNOWN_REPOS)) await addByName(repo, true);
    if (token) {
      const byStars = [...repos.values()].filter((e) => !e.files.has(MARKETPLACE_FILE))
        .sort((a, b) => (b.raw.stargazers_count ?? 0) - (a.raw.stargazers_count ?? 0)).slice(0, MAX_FILE_LOOKUPS);
      for (const entry of byStars) {
        const root = await api.get(`/repos/${entry.raw.full_name}/contents`);
        for (const f of Array.isArray(root) ? root : []) entry.files.add(f.name);
        if ((Array.isArray(root) ? root : []).some((f) => f.name === '.claude-plugin' && f.type === 'dir')) {
          const inner = await api.get(`/repos/${entry.raw.full_name}/contents/.claude-plugin`);
          for (const f of Array.isArray(inner) ? inner : []) entry.files.add(`.claude-plugin/${f.name}`);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof LimitReached)) throw err;
    return { repos, limited: true, ...api.state };
  }
  return { repos, limited: false, ...api.state };
}

// token: undefined looks it up (GITHUB_TOKEN, then `gh auth token`); null stays anonymous (topic searches only).
export async function fetchCatalog({ token, exec = execCapture, fetchFn = fetch, smDir, dir, now = Date.now(), force = false }) {
  const cache = readCatalogCache(smDir);
  if (cache && !force && now - Date.parse(cache.fetchedAt) < CACHE_TTL_MS) {
    return { items: cache.items, fetchedAt: cache.fetchedAt, stale: false, limited: false };
  }
  const resolved = token === undefined ? await resolveToken({ exec }) : token;
  let result = await gather({ token: resolved, fetchFn, dir });
  // A rejected token (expired, revoked) would fail every Refresh the same way: fall back to the anonymous topic searches.
  if (resolved && result.unauthorized) result = await gather({ token: null, fetchFn, dir });
  const { repos, limited, failures, networkFailures } = result;
  const items = [...repos.values()].map((e) => toItem(e.raw, [...e.files]));
  if (limited) {
    log('warn', 'catalog-rate-limited', { cached: Boolean(cache) });
    return cache
      ? { items: cache.items, fetchedAt: cache.fetchedAt, stale: true, limited: true }
      : { items, fetchedAt: null, stale: true, limited: true };
  }
  if (failures) {
    const error = networkFailures ? 'network' : 'github';
    return cache
      ? { items: cache.items, fetchedAt: cache.fetchedAt, stale: true, limited: false, error }
      : { items, fetchedAt: null, stale: true, limited: false, error };
  }
  const fetchedAt = new Date(now).toISOString();
  writeAtomic(join(smDir, 'catalog.json'), `${JSON.stringify({ fetchedAt, items })}\n`);
  return { items, fetchedAt, stale: false, limited: false };
}

export function filterCatalog(items, { sort, type, category, q } = {}) {
  const needle = String(q ?? '').trim().toLowerCase();
  const order = SORTS[sort] ?? SORTS.stars;
  return items
    .filter((i) => (!type || !TYPE_SET.has(type) || i.type === type)
      && (!category || !CATEGORY_SET.has(category) || i.category === category)
      && (!needle || `${i.repo} ${i.description}`.toLowerCase().includes(needle)))
    .sort(order);
}

// The marketplace the item comes from is on this machine and one of its plugins is installed.
export function markInstalled(items, dir) {
  const plugins = readJson(join(dir, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  const withPlugins = new Set(Object.keys(plugins).map((id) => id.split('@')[1]));
  const markets = new Map();
  for (const m of knownMarketplaces(dir)) {
    const repo = m.repo.toLowerCase();
    markets.set(repo, (markets.get(repo) ?? false) || withPlugins.has(m.name));
  }
  return items.map((i) => ({ ...i, installed: markets.get(i.repo.toLowerCase()) === true }));
}

const claudeCommand = (bin, args) => (/\.(m?js|cjs)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]);
const detail = (out) => String(out.stderr || out.stdout).trim().slice(0, 200);

function pluginNames(market) {
  const manifest = market.installLocation && readJson(join(market.installLocation, '.claude-plugin', 'marketplace.json'));
  return (Array.isArray(manifest?.plugins) ? manifest.plugins : []).map((p) => p?.name).filter((n) => typeof n === 'string' && NAME_RE.test(n));
}

// The page names a repository, a scope and (maybe) a plugin; every value is checked against the cached catalog or the
// marketplace file `claude` itself wrote, so no request value ever becomes a command argument unchecked.
// → {status, error?, ...fields}; the action layer wraps it.
export async function installFromCatalog(body, { state, dir, smDir, exec = execCapture, bin }) {
  if (typeof body.repo !== 'string' || !REPO_RE.test(body.repo)) return { status: 400, error: 'bad-repo' };
  if (body.scope !== 'user' && body.scope !== 'project') return { status: 400, error: 'bad-scope' };
  if (body.plugin !== undefined && !(typeof body.plugin === 'string' && NAME_RE.test(body.plugin))) return { status: 400, error: 'bad-plugin' };
  const item = readCatalogCache(smDir)?.items.find((i) => i.repo.toLowerCase() === body.repo.toLowerCase());
  if (!item) return { status: 404, error: 'unknown-repo' };
  if (!item.hasMarketplace) return { status: 409, error: 'not-installable' };

  let cwd = homedir();
  if (body.scope === 'project') {
    if (typeof body.projectId !== 'string') return { status: 400, error: 'bad-project' };
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project) return { status: 404, error: 'unknown-project' };
    cwd = project.root;
  }
  const claude = bin !== undefined ? bin : findClaude();
  if (!claude) return { status: 409, error: 'no-claude' };
  const run = (args) => exec(...claudeCommand(claude, args), { cwd });
  const knownMarket = () => knownMarketplaces(dir).find((m) => m.repo.toLowerCase() === item.repo.toLowerCase());

  const added = await run(['plugin', 'marketplace', 'add', item.repo, '--scope', body.scope]);
  const market = knownMarket();
  if (added.code !== 0 && !market) return { status: 502, error: 'add-failed', detail: detail(added) };
  if (!market || !NAME_RE.test(market.name)) return { status: 502, error: 'marketplace-missing' };

  const plugins = pluginNames(market);
  if (!plugins.length) return { status: 502, error: 'no-plugins' };
  let plugin = body.plugin;
  if (plugin === undefined && plugins.length === 1) [plugin] = plugins;
  if (plugin === undefined) return { status: 409, error: 'choose-plugin', plugins };
  if (!plugins.includes(plugin)) return { status: 400, error: 'bad-plugin' };

  const id = `${plugin}@${market.name}`;
  const installed = await run(['plugin', 'install', id, '--scope', body.scope]);
  return installed.code === 0 ? { status: 200, installed: id } : { status: 502, error: 'install-failed', detail: detail(installed) };
}
