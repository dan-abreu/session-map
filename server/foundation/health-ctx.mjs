// The context every health check reads (fd08). Read-only: nothing is written, no .env is opened, nothing leaves the
// machine. `makeHealthCtx` is pure (rows and a text reader in, context out) so the checks can be tried on files in memory;
// `buildHealthCtx` is the one that touches the disk and git.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isSecretsFile, safeResolve } from '../files.mjs';
import { log } from '../log.mjs';
import { normalizePath } from '../paths.mjs';
import { readJsonFile } from '../store.mjs';
import { findDoc } from './health-find.mjs';
import { effectiveProfile } from './profile.mjs';

export const READ_MAX = 200 * 1024;

const run = promisify(execFile);
const GIT = { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
const TAGS_MAX = 500;
const SUBJECTS_MAX = 200;
const MANIFESTS = { 'package.json': 'node', 'composer.json': 'php', 'pubspec.yaml': 'dart' };
// A manifest under one of these is a sample or a test case, not a package of the project.
const SAMPLE_DIRS = new Set(['fixtures', '__fixtures__', 'testdata', 'test', 'tests', 'example', 'examples', 'templates', 'template', 'node_modules', 'vendor']);
const WORKSPACE_FILES = new Set(['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json']);
const NOT_CODE_TYPES = new Set(['json', 'yaml', 'md']);
// Types the census cannot name ('other') that are still source code.
const OTHER_CODE_EXT = new Set(['py', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'lua', 'ex', 'exs', 'scala', 'vue', 'svelte', 'astro']);
const USER_TYPES = new Set(['web', 'mobile', 'game', 'api']);
const USERS_PATH = /(^|\/)(pages|app|routes)\//;

const slashed = (p) => String(p).replaceAll('\\', '/');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// ---------- packages ----------

function parseNode(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const scripts = {};
  if (data.scripts && typeof data.scripts === 'object' && !Array.isArray(data.scripts)) {
    for (const [k, v] of Object.entries(data.scripts)) if (typeof v === 'string') scripts[k] = v;
  }
  const isPrivate = data.private === true;
  const entry = ['main', 'module', 'exports', 'bin', 'types', 'typings'].some((k) => data[k] != null);
  const name = typeof data.name === 'string' ? data.name : null;
  return { name, scripts, private: isPrivate, publishable: !isPrivate && Boolean(name) && entry, workspaces: data.workspaces != null };
}

function parseComposer(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const scripts = {};
  if (data.scripts && typeof data.scripts === 'object' && !Array.isArray(data.scripts)) {
    for (const [k, v] of Object.entries(data.scripts)) {
      if (typeof v === 'string') scripts[k] = v;
      else if (Array.isArray(v)) scripts[k] = v.filter((x) => typeof x === 'string').join(' && ');
    }
  }
  const name = typeof data.name === 'string' ? data.name : null;
  return { name, scripts, private: false, publishable: data.type === 'library' && Boolean(name), workspaces: false };
}

function parsePubspec(text) {
  const name = /^name:\s*([^\s#]+)/m.exec(text)?.[1] ?? null;
  const isPrivate = /^publish_to:\s*['"]?none['"]?\s*(#.*)?$/m.test(text);
  const flutter = /^\s*flutter:/m.test(text) || /sdk:\s*flutter/.test(text);
  return { name, scripts: {}, private: isPrivate, publishable: !isPrivate && !flutter && Boolean(name), flutter, workspaces: false };
}

const PARSERS = { node: parseNode, php: parseComposer, dart: parsePubspec };

// The root's manifest and every other one in the census (apps/*, packages/*, backend/...), except samples and fixtures.
// `dir` is '' for the root. A manifest that does not parse is left out: the checks then see one package fewer, not an error.
export function packagesOf(paths, readText) {
  const out = [];
  let workspaces = false;
  for (const path of [...paths].sort()) {
    const kind = MANIFESTS[baseOf(path)];
    if (!kind) continue;
    const dir = dirOf(path);
    if (dir.split('/').some((s) => SAMPLE_DIRS.has(s.toLowerCase()))) continue;
    const text = readText(path);
    if (typeof text !== 'string') continue;
    const parsed = PARSERS[kind](text);
    if (!parsed) continue;
    if (parsed.workspaces) workspaces = true;
    const { workspaces: _w, ...pkg } = parsed;
    out.push({ dir, manifest: path, kind, ...pkg });
  }
  return { packages: out, workspaces };
}

// ---------- kinds and visibility ----------

const isCodeRow = (r) => {
  if (!r.included || (r.kind !== 'code' && r.kind !== 'screen')) return false;
  if (NOT_CODE_TYPES.has(r.type)) return false;
  if (r.type === 'other' || r.type == null) return OTHER_CODE_EXT.has(baseOf(r.path).split('.').pop().toLowerCase());
  return true;
};

function kindsOf({ rows, packages, profile }) {
  const kinds = new Set();
  if (rows.some(isCodeRow)) kinds.add('code');
  const types = profile ? effectiveProfile(profile.detected, profile.owner).types : [];
  if (types.length) {
    if (types.some((t) => USER_TYPES.has(t))) kinds.add('users');
    if (types.includes('library')) kinds.add('library');
    return kinds;
  }
  const dartApp = packages.some((p) => p.kind === 'dart' && p.flutter);
  const screens = rows.some((r) => r.included && (r.kind === 'screen' || USERS_PATH.test(r.path)));
  if (screens || dartApp) kinds.add('users');
  if (!kinds.has('users') && packages.some((p) => p.publishable)) kinds.add('library');
  return kinds;
}

// Config in the user's own folder > the GitHub answer > no remote at all (local only, so private) > unknown.
function visibilityOf({ configVisibility, api, git }) {
  if (configVisibility === 'public' || configVisibility === 'private') return { visibility: configVisibility, source: 'config' };
  if (api?.visibility === 'public' || api?.visibility === 'private') return { visibility: api.visibility, source: 'api' };
  if (!git?.remote) return { visibility: 'private', source: 'no-remote' };
  return { visibility: 'unknown', source: null };
}

// ---------- the context ----------

const EMPTY_GIT = Object.freeze({ remote: null, tags: [], subjects: [], defaultBranch: null });

export function makeHealthCtx({ rows = [], readText = () => null, git = EMPTY_GIT, configVisibility = null, api = null, versions = null, profile = null, now = new Date().toISOString(), root = null } = {}) {
  const all = rows.filter((r) => r && typeof r.path === 'string').map((r) => ({ ...r, path: slashed(r.path) }));
  const secret = new Set(all.filter((r) => r.kind === 'secret').map((r) => r.path));
  const paths = all.filter((r) => r.kind !== 'dep').map((r) => r.path);
  const included = all.filter((r) => r.included).map((r) => r.path);
  const cache = new Map();

  // The one door to a file's text: never a secret file (by name or by census), never over the limit, never .git itself.
  const read = (path) => {
    const p = slashed(path);
    if (isSecretsFile(p) || secret.has(p) || p === '.git' || p.startsWith('.git/')) return null;
    if (cache.has(p)) return cache.get(p);
    let text = null;
    try {
      const raw = readText(p);
      if (typeof raw === 'string' && Buffer.byteLength(raw) <= READ_MAX) text = raw;
    } catch { text = null; }
    cache.set(p, text);
    return text;
  };

  const { packages, workspaces } = packagesOf(paths, read);
  const isMonorepo = workspaces || all.some((r) => !r.path.includes('/') && WORKSPACE_FILES.has(r.path))
    || new Set(packages.map((p) => p.dir)).size >= 2;
  const kinds = kindsOf({ rows: all, packages, profile });
  const { visibility, source } = visibilityOf({ configVisibility, api, git });
  return {
    root, now, files: all,
    has: (path) => paths.includes(slashed(path)),
    list: (prefix = '') => paths.filter((p) => p.startsWith(prefix)).sort(),
    find: (names, opts) => findDoc(included, names, opts),
    read, packages, isMonorepo, hasCode: kinds.has('code'), git,
    visibility, visibilitySource: source, kinds, api, versions, profile,
  };
}

// ---------- the disk and git ----------

async function gitOut(root, args) {
  try {
    return (await run('git', ['-c', 'core.quotepath=off', ...args], { ...GIT, cwd: root })).stdout;
  } catch (err) {
    // Most failures are plain answers ("no such remote", "no commits yet"); only a stuck git is worth a line.
    if (err.killed) log('warn', 'health-git-timeout', { command: args[0] });
    return null;
  }
}

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?$/;
const cleanPath = (p) => p.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');

// Any remote form to a plain https link, without the user and password part some people paste into the address.
// Anything that is not a server address (a folder on disk, file://) is null.
export function publicRemote(url) {
  const raw = String(url ?? '').trim();
  let host;
  let path;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(raw);
  const web = /^(?:https?|ssh|git):\/\/(?:[^@/\s]*@)?([^/\s]+)\/(.+)$/i.exec(raw);
  if (web) [, host, path] = web;
  else if (scp && !/^[A-Za-z]:[\\/]/.test(raw)) [, host, path] = scp;
  else return null;
  if (!HOST_RE.test(host) || /^(localhost|127\.|0\.0\.0\.0)/.test(host)) return null;
  const clean = cleanPath(path);
  return clean ? `https://${host.toLowerCase()}/${clean}` : null;
}

async function gitFacts(root) {
  const lines = (out) => String(out ?? '').split(/\r?\n/).filter(Boolean);
  const [remotes, tagOut, subjectOut, headRef, branch] = await Promise.all([
    gitOut(root, ['remote']),
    gitOut(root, ['tag', '--list', '--sort=-v:refname']),
    gitOut(root, ['log', '-n', String(SUBJECTS_MAX), '--format=%s']),
    gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    gitOut(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
  ]);
  const names = lines(remotes);
  const name = names.includes('origin') ? 'origin' : names[0];
  const url = name ? await gitOut(root, ['remote', 'get-url', name]) : null;
  const fromRemote = lines(headRef)[0]?.replace(/^[^/]+\//, '');
  return {
    remote: url ? publicRemote(url.trim()) : null,
    tags: lines(tagOut).slice(0, TAGS_MAX),
    subjects: lines(subjectOut).slice(0, SUBJECTS_MAX),
    defaultBranch: fromRemote || lines(branch)[0] || null,
  };
}

// The visibility the owner set for this project in the user's own config.json. A file inside the repository is never
// asked: a clone could claim to be private and skip every public-only item.
function configVisibilityOf(smDir, root) {
  const projects = readJsonFile(join(smDir, 'config.json'), {})?.projects;
  if (!projects || typeof projects !== 'object') return null;
  const key = normalizePath(root);
  return Object.hasOwn(projects, key) && typeof projects[key]?.visibility === 'string' ? projects[key].visibility : null;
}

function diskReader(root) {
  return (rel) => {
    const abs = safeResolve(root, rel);
    if (!abs) return null;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > READ_MAX) return null;
      return readFileSync(abs, 'utf8');
    } catch { return null; }
  };
}

export async function buildHealthCtx({ root, census, smDir, id, api = null, versions = null, profile = null, now = new Date().toISOString() } = {}) {
  const git = await gitFacts(root);
  return makeHealthCtx({
    rows: census?.files ?? [], readText: diskReader(root), git, api, versions, profile, now, root,
    configVisibility: smDir ? configVisibilityOf(smDir, root) : null,
  });
}
