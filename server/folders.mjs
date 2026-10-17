// The folders of the PC and the repositories inside the one the owner picks (id164): the page walks the folders the way
// VS Code's Open Folder does, picks one, and session-map finds the git repositories under it and lists each as a project,
// whether or not a conversation ever ran there. Only folder names are read, never a file; the routes that use this ask for
// the page's token.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readJsonFile, writeAtomic } from './store.mjs';
import { normalizePath } from './paths.mjs';

// \\host\share: looking one up makes Windows reach for that machine (seconds, and the user's sign-in sent to it).
const NETWORK_RE = /^[\\/]{2}/;
// eslint-disable-next-line no-control-regex
const NUL_RE = /\u0000/;

const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// A folder the page may name: an absolute local path that exists and is a folder.
export function folderError(path) {
  if (typeof path !== 'string' || !path.trim() || NUL_RE.test(path) || NETWORK_RE.test(path.trim()) || !isAbsolute(path.trim())) return 'bad-folder';
  return isDir(resolve(path.trim())) ? null : 'not-a-folder';
}

// A repository is a folder with its own .git folder. A .git file is a linked worktree or a submodule: the code of another
// project, never a project of its own.
export const isRepo = (dir) => statSync(join(dir, '.git'), { throwIfNoEntry: false })?.isDirectory() ?? false;
const isLinked = (dir) => statSync(join(dir, '.git'), { throwIfNoEntry: false })?.isFile() ?? false;

const hiddenName = (name) => name.startsWith('.') || name.startsWith('$');

const DRIVES = 'CDEFGHIJKLMNOPQRSTUVWXYZ';

// Where the walk starts: the drives of a Windows PC (the root of any other), and the person's home folder.
function startingPlaces(home) {
  const entries = process.platform === 'win32'
    ? [...DRIVES].map((l) => `${l}:\\`).filter((p) => existsSync(p)).map((p) => ({ name: p, path: p, repo: false }))
    : [{ name: '/', path: '/', repo: false }];
  return { ok: true, path: '', parent: null, sep: process.platform === 'win32' ? '\\' : '/', home, entries };
}

const ENTRIES_MAX = 1000;

// The folders inside `path` (none given: the places to start from). {ok, path, parent, entries: [{name, path, repo}]};
// parent is '' for the root of a drive (the list of drives) and null at the start.
export function listFolders(path, { home = homedir() } = {}) {
  if (path === undefined || path === null || path === '') return startingPlaces(home);
  const error = folderError(path);
  if (error) return { ok: false, error };
  const here = resolve(path.trim());
  let found;
  try {
    found = readdirSync(here, { withFileTypes: true });
  } catch {
    return { ok: false, error: 'no-access' };
  }
  const entries = found
    .filter((e) => e.isDirectory() && !hiddenName(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, ENTRIES_MAX)
    .map((e) => ({ name: e.name, path: join(here, e.name), repo: isRepo(join(here, e.name)) }));
  const up = dirname(here);
  return { ok: true, path: here, parent: up === here ? '' : up, sep: process.platform === 'win32' ? '\\' : '/', repo: isRepo(here), entries, truncated: found.length > ENTRIES_MAX };
}

// Folders that hold other people's code, the system's or a program's cache: never walked looking for repositories.
const SKIP = new Set(['node_modules', 'appdata', 'application data', 'library', 'windows', 'program files', 'program files (x86)', 'programdata', 'system volume information', 'dist', 'build', 'target', '__pycache__']);

const DEPTH_MAX = 4;
const REPOS_MAX = 80;
const READS_MAX = 5000;

// The repositories under `root`, itself included: {repos: [folder], truncated}. A repository is a project and is not
// walked into (what sits inside it belongs to it); a folder with a .git file is somebody's worktree and is passed by.
// Four levels, 80 repositories and 5000 folder reads at most, so choosing the wrong folder (a whole drive) costs seconds, not minutes.
export function findRepos(root, { maxDepth = DEPTH_MAX, maxRepos = REPOS_MAX, maxReads = READS_MAX } = {}) {
  const repos = [];
  let reads = 0;
  let truncated = false;
  const walk = (dir, depth) => {
    if (repos.length >= maxRepos || reads >= maxReads) {
      truncated = true;
      return;
    }
    if (isRepo(dir)) {
      repos.push(dir);
      return;
    }
    if (depth >= maxDepth || isLinked(dir)) return;
    reads++;
    let found;
    try {
      found = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))) {
      if (e.isDirectory() && !hiddenName(e.name) && !SKIP.has(e.name.toLowerCase())) walk(join(dir, e.name), depth + 1);
    }
  };
  if (!folderError(root)) walk(resolve(root.trim()), 0);
  return { repos, truncated };
}

// The collect asks every few seconds: the walk of each folder is kept for a minute, and forgotten when the choice changes.
const SCAN_TTL_MS = 60_000;
const scans = new Map();

export function reposIn(roots, { now = Date.now() } = {}) {
  const repos = [];
  let truncated = false;
  for (const root of roots) {
    const key = normalizePath(root);
    let scan = scans.get(key);
    if (!scan || now - scan.at >= SCAN_TTL_MS) {
      scan = { at: now, ...findRepos(root) };
      scans.set(key, scan);
    }
    repos.push(...scan.repos);
    truncated ||= scan.truncated;
  }
  return { repos, truncated };
}

export const forgetScans = () => scans.clear();

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ROOTS_MAX = 10;

// body.roots: the whole list, replacing the last one ([] goes back to "anywhere"). → {ok, roots} or {ok: false, error}.
export function setProjectsRoot(smDir, body) {
  const roots = body?.roots;
  if (!Array.isArray(roots) || roots.length > ROOTS_MAX) return { ok: false, error: 'bad-roots' };
  const clean = [];
  for (const r of roots) {
    const error = folderError(r);
    if (error) return { ok: false, error };
    const path = resolve(r.trim());
    if (!clean.some((c) => normalizePath(c) === normalizePath(path))) clean.push(path);
  }
  const file = join(smDir, 'config.json');
  const config = existsSync(file) ? readJsonFile(file, null) : {};
  // A config.json session-map cannot read whole is never written over: the person's other settings would be lost.
  if (!isObject(config)) return { ok: false, error: 'config-unreadable' };
  const { projectsRoot: _old, ...rest } = config;
  try {
    writeAtomic(file, `${JSON.stringify(clean.length ? { ...rest, projectsRoot: clean } : rest, null, 2)}\n`);
  } catch {
    return { ok: false, error: 'config-unreadable' };
  }
  forgetScans();
  return { ok: true, roots: clean };
}

