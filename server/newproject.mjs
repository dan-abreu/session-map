import { mkdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { normalizePath } from './paths.mjs';
import { writeAtomic } from './store.mjs';

// A new project (sv14): the page creates its folder, and session-map lists it as a project before any conversation runs
// there. The folder is remembered in the person's config.json; its first conversation makes it a project like the others.

const NAME_MAX = 80;
// Names Windows cannot hold, on any computer: a project folder may be copied to one.
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// One plain folder name: never a path, never a name a disk refuses.
export function nameError(name) {
  if (typeof name !== 'string') return 'bad-name';
  const n = name.trim();
  if (!n || n.length > NAME_MAX || n === '.' || n === '..' || BAD_CHARS.test(n) || /[. ]$/.test(n) || RESERVED.test(n)) return 'bad-name';
  return null;
}

// body: {parent (an absolute folder that exists), name}. → {ok, root} or {ok: false, error}.
export function createProject(smDir, body, { now = new Date() } = {}) {
  const error = nameError(body?.name);
  if (error) return { ok: false, error };
  const { parent } = body;
  if (typeof parent !== 'string' || !parent.trim() || !isAbsolute(parent.trim()) || !isDir(parent.trim())) return { ok: false, error: 'bad-parent' };
  const root = join(resolve(parent.trim()), body.name.trim());
  const file = join(smDir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  // A config.json session-map cannot read whole is never written over: the person's other settings would be lost.
  if (!isObject(config) || (config.projects !== undefined && !isObject(config.projects))) return { ok: false, error: 'config-unreadable' };
  try {
    // Not recursive: an existing folder (or file) answers EEXIST and is never touched.
    mkdirSync(root);
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'folder-exists' };
    return { ok: false, error: 'folder-failed' };
  }
  const key = normalizePath(root);
  const projects = { ...(config.projects ?? {}) };
  projects[key] = { ...(isObject(projects[key]) ? projects[key] : {}), created: { at: now.toISOString(), root } };
  try {
    writeAtomic(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`);
  } catch {
    // Not remembered, the folder would be lost to the map and a retry would find it taken: the empty folder goes away.
    rmdirSync(root);
    return { ok: false, error: 'config-unreadable' };
  }
  return { ok: true, root };
}

// The folders session-map created, as they were typed: the collect shows each one that still exists as a project.
export function createdRoots(userConfig) {
  const projects = isObject(userConfig?.projects) ? userConfig.projects : {};
  return Object.values(projects).map((p) => p?.created?.root).filter((r) => typeof r === 'string' && r);
}

// Where a new project goes by default: the folder most of the person's projects live in, else their home folder.
export function suggestParent(roots, { home = homedir() } = {}) {
  const count = new Map();
  for (const r of roots) {
    const up = dirname(r);
    if (up === r) continue;
    count.set(up, (count.get(up) ?? 0) + 1);
  }
  let best = null;
  for (const [dir, n] of count) if (!best || n > best.n) best = { dir, n };
  return best?.dir ?? home;
}
