import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const DRIVE_RE = /^[a-z]:\//i;

const SHORT_NAME_RE = /(^|\/)[^/]*~\d[^/]*(?=\/|$)/;

// Windows spells one folder twice: git and the OS say C:/Users/runneradmin, os.tmpdir() says C:/Users/RUNNER~1 (8.3 short name).
// Only paths with a ~N segment pay the lookup, so symlinks and junctions elsewhere keep the spelling the user gave.
function expandShortNames(path) {
  if (process.platform !== 'win32' || !SHORT_NAME_RE.test(path)) return path;
  const tail = [];
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      return [realpathSync.native(dir).replaceAll('\\', '/').replace(/\/+$/, ''), ...tail].join('/');
    } catch { /* this part does not exist yet: resolve the nearest folder that does */ }
    if (dirname(dir) === dir) return path;
    tail.unshift(basename(dir));
  }
}

// One spelling per folder: c:\dev\x, C:/dev/x/ and (on Windows) /c/dev/x all become c:/dev/x.
export function normalizePath(p) {
  let out = String(p).replaceAll('\\', '/');
  if (process.platform === 'win32') out = out.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
  out = out.replace(/\/+$/, '') || '/';
  if (/^[a-z]:$/i.test(out)) out += '/';
  out = expandShortNames(out);
  return DRIVE_RE.test(out) || process.platform === 'win32' ? out.toLowerCase() : out;
}

export function projectIdOf(root) {
  const normalized = normalizePath(root);
  const name = normalized.split('/').filter(Boolean).pop() || 'root';
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
  return `${slug}-${createHash('sha1').update(normalized).digest('hex').slice(0, 6)}`;
}

export const slash = (p) => String(p).replaceAll('\\', '/');

// Transcripts record absolute paths; the map works with root-relative ones. Paths outside every base are dropped.
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
    // Count the segments below the base on the normalized path and take that many from the original: it keeps the case and survives 8.3 short names, which change the length.
    if (base) out.push(p.split('/').slice(-np.slice(base.length + 1).split('/').length).join('/'));
  }
  return out;
}

// Worktrees usually sit beside the repo (C:/dev/proj-feature for C:/dev/proj), and removed ones are not listed
// anywhere: a folder named that way is read as the same code checked out again.
function checkoutsOf(files, root) {
  if (!root) return [];
  const prefix = `${normalizePath(root)}-`;
  const found = new Set();
  for (const f of files) {
    const p = normalizePath(slash(f));
    const end = p.startsWith(prefix) ? p.indexOf('/', prefix.length) : -1;
    if (end > 0) found.add(p.slice(0, end));
  }
  return [...found];
}

// The edited files as repo paths, whichever checkout of the repo they were edited in.
export function repoFiles(files, root, cwd) {
  return relativeFiles(files, [root, cwd, ...checkoutsOf(files, root)]);
}
