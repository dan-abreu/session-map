import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { log } from '../log.mjs';
import { normalizePath, projectIdOf } from '../paths.mjs';
import { plain, readableName, sameName } from './names.mjs';

export { plain };

const SEED_FOLDERS_MAX = 12;
const EDITED_WEIGHT = 3;
const MENTIONED_WEIGHT = 1;
const MIN_SCORE = 3;
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const ID_MAX = 40;
export const UNSORTED = 'unsorted';

// Ids end up in file names, so anything but a plain slug is refused.
export function assertSafeName(name, what) {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid ${what}: ${name}`);
  return name;
}

export function brainDir(smDir, projectId) {
  return join(smDir, 'brain', assertSafeName(projectId, 'project id'));
}

export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function readJsonFile(path, fallback) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'brain-read-failed', { path, code: err.code });
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    log('warn', 'brain-invalid-json', { path });
    return fallback;
  }
}


// Ids become nucleus file names, so they stay plain slugs; once given they never change.
export function newUnitId(name, units) {
  const base = plain(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, ID_MAX).replace(/-+$/, '') || 'unit';
  const taken = new Set([UNSORTED, ...units.map((u) => u.id)]);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export const slash = (p) => String(p).replaceAll('\\', '/');
export const covers = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

const CONTAINERS = new Set(['apps', 'packages', 'services', 'libs', 'modules', 'crates', 'projects', 'plugins', 'tools']);
const SOURCE_ROOTS = new Set(['src', 'lib', 'app', 'source', 'sources', 'internal']);
// A top-level folder, or a whole app in a monorepo (apps/backend-api, and its src): true of almost any work, so it says little.
export function isBroadPath(path) {
  const parts = slash(path).split('/').filter(Boolean);
  while (parts.length > 1 && SOURCE_ROOTS.has(parts.at(-1).toLowerCase())) parts.pop();
  return parts.length <= 1 || (parts.length === 2 && CONTAINERS.has(parts[0].toLowerCase()));
}

// Backticked `a/b` or a bare token with at least two slashes; URLs and "/api/x" never match.
const CITED_PATH_RE = /`([^`\s]+)`|(?<![\w/:.@`-])([\w.@-]+(?:\/[\w.@-]+){2,})/g;
const PATH_SHAPE_RE = /^[\w@][\w.@-]*(?:\/[\w.@-]+)+$/;

// A spec's own title, unless it is only the generated "<folder> Specification".
function headingOf(markdown, slug) {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1].replace(/\s+spec(ification)?$/i, '').trim();
  return heading && !heading.includes('/') && !sameName(heading, slug) ? heading : null;
}

function pathsCitedIn(markdown) {
  const found = new Set();
  for (const m of markdown.matchAll(CITED_PATH_RE)) {
    const token = (m[1] ?? m[2]).replace(/[.,;:]+$/, '').replace(/^\.\//, '').replace(/\/+$/, '');
    if (PATH_SHAPE_RE.test(token)) found.add(token);
  }
  return [...found];
}

function foldersByActivity(gitLog) {
  const touches = new Map();
  for (const file of gitLog) {
    const parts = slash(file).split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const folder = parts.slice(0, Math.min(parts.length - 1, 2)).join('/');
    touches.set(folder, (touches.get(folder) ?? 0) + 1);
  }
  return [...touches].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SEED_FOLDERS_MAX).map(([folder]) => folder);
}

// gitLog: the file paths touched by the last ~500 commits, one entry per touch (`git log --name-only --format= -n 500`).
export function seedUnits(root, { gitLog = [] } = {}) {
  const specsDir = join(root, 'openspec', 'specs');
  let specs = [];
  try {
    specs = readdirSync(specsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== UNSORTED).map((e) => e.name).sort();
  } catch { /* no OpenSpec: fall back to the folders the git log touches most */ }
  const units = [];
  // Ids keep coming from the folder, as before readable names: nucleus files and older units.json rows use them.
  const add = (slug, name, paths) => {
    const taken = units.some((u) => sameName(u.name, name));
    units.push({ id: newUnitId(slug, units), name: taken ? `${name} (${slug})` : name, paths });
  };
  if (specs.length) {
    for (const slug of specs) {
      let text = '';
      try { text = readFileSync(join(specsDir, slug, 'spec.md'), 'utf8'); } catch { /* spec folder without spec.md */ }
      add(slug, headingOf(text, slug) ?? readableName(slug), pathsCitedIn(text));
    }
  } else {
    const folders = foldersByActivity(gitLog);
    const last = (f) => f.split('/').at(-1);
    for (const folder of folders) {
      const twin = folders.some((o) => o !== folder && sameName(readableName(last(o)), readableName(last(folder))));
      const parent = folder.split('/').at(-2);
      add(folder, twin && parent ? `${readableName(last(folder))} (${parent})` : readableName(last(folder)), [folder]);
    }
  }
  return [...units, { id: UNSORTED, name: 'Unsorted', paths: [] }];
}

export function writeUnits(smDir, projectId, units) {
  writeAtomic(join(brainDir(smDir, projectId), 'units.json'), `${JSON.stringify(units, null, 2)}\n`);
}

// The first call seeds and persists; after that units.json is the truth (the page edits it).
export function loadUnits(smDir, root, seed) {
  const projectId = projectIdOf(root);
  const file = join(brainDir(smDir, projectId), 'units.json');
  const stored = readJsonFile(file, null);
  if (Array.isArray(stored) && stored.length) return stored;
  const units = seedUnits(root, seed);
  if (stored === null) writeUnits(smDir, projectId, units);
  return units;
}

// Transcripts record absolute paths; units hold root-relative ones. Paths outside every base are dropped.
export function relativeFiles(files, bases) {
  const roots = bases.filter(Boolean).map((b) => normalizePath(b));
  const out = [];
  for (const file of files) {
    const p = slash(file);
    if (!/^([a-z]:)?\//i.test(p)) {
      out.push(p.replace(/^\.\//, ''));
      continue;
    }
    const np = normalizePath(p);
    const base = roots.find((r) => np.startsWith(`${r}/`));
    if (base) out.push(p.slice(base.length + 1));
  }
  return out;
}

// Each file counts for the unit(s) with the longest matching path prefix, so a nested unit is not swallowed by its parent folder.
function scoreFiles(weighted, units) {
  const prefixes = units.map((u) => ({ id: u.id, paths: (u.paths ?? []).map((p) => slash(p).replace(/\/+$/, '')).filter(Boolean) }));
  const scores = new Map();
  for (const [file, weight] of weighted) {
    let best = 0;
    let owners = [];
    for (const { id, paths } of prefixes) {
      const longest = Math.max(0, ...paths.filter((p) => covers(file, p)).map((p) => p.length));
      if (longest === 0 || longest < best) continue;
      if (longest > best) owners = [];
      best = longest;
      owners.push(id);
    }
    for (const id of owners) scores.set(id, (scores.get(id) ?? 0) + weight);
  }
  return scores;
}

export function unitsTouchedBy(files, units) {
  return [...scoreFiles(files.map((f) => [f, 1]), units).keys()];
}

export function classify(summary, card, units, overrides, { root } = {}) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const overridden = overrides?.[summary.sessionId];
  if (overridden && byId.has(overridden)) return { unitId: overridden, unitSource: 'override' };

  if (card?.area) {
    const wanted = plain(card.area);
    const hit = units.find((u) => plain(u.id) === wanted || plain(u.name) === wanted);
    if (hit) return { unitId: hit.id, unitSource: 'card' };
  }

  const bases = [root, summary.cwd];
  const weighted = [
    ...relativeFiles(summary.editedFiles ?? [], bases).map((f) => [f, EDITED_WEIGHT]),
    ...relativeFiles(summary.mentionedPaths ?? [], bases).map((f) => [f, MENTIONED_WEIGHT]),
  ];
  const scores = scoreFiles(weighted, units);
  let winner = null;
  for (const { id } of units) {
    const score = scores.get(id) ?? 0;
    if (score >= MIN_SCORE && (!winner || score > winner[1])) winner = [id, score];
  }
  return winner ? { unitId: winner[0], unitSource: 'files' } : { unitId: UNSORTED, unitSource: 'none' };
}

export function readOverrides(smDir, projectId) {
  const stored = readJsonFile(join(brainDir(smDir, projectId), 'overrides.json'), {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

// unitId null removes the correction and lets the automatic classification decide again.
export function setOverride(smDir, projectId, sessionId, unitId) {
  const overrides = readOverrides(smDir, projectId);
  if (unitId === null) delete overrides[sessionId];
  else overrides[sessionId] = unitId;
  writeAtomic(join(brainDir(smDir, projectId), 'overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`);
}
