import { createHash } from 'node:crypto';

const DRIVE_RE = /^[a-z]:\//i;

// One spelling per folder: c:\dev\x, C:/dev/x/ and (on Windows) /c/dev/x all become c:/dev/x.
export function normalizePath(p) {
  let out = String(p).replaceAll('\\', '/');
  if (process.platform === 'win32') out = out.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
  out = out.replace(/\/+$/, '') || '/';
  if (/^[a-z]:$/i.test(out)) out += '/';
  return DRIVE_RE.test(out) || process.platform === 'win32' ? out.toLowerCase() : out;
}

export function projectIdOf(root) {
  const normalized = normalizePath(root);
  const name = normalized.split('/').filter(Boolean).pop() || 'root';
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
  return `${slug}-${createHash('sha1').update(normalized).digest('hex').slice(0, 6)}`;
}
