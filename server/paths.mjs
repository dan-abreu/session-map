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
