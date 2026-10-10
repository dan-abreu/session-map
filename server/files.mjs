import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const FILE_MAX = 1024 * 1024;
const LIST_MAX = 2000;
const TIMEOUT_MS = 5000;
const SHA_RE = /^[0-9a-f]{40}$/;
const GIT_NAME_RE = /^(\.git|git~\d+)$/i;
const DRIVE_RE = /^[a-z]:/i;
const GLOB_RE = /[*?[\]]/;
const ENV_RE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/i;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

// Path segments of a request, or null when any of them could leave the project or reach .git.
// Windows quietly drops trailing dots and spaces ("..", ".git.") and understands "name:stream" and 8.3 names, hence the extra checks.
function lexical(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  let decoded = rel;
  try { decoded = decodeURIComponent(rel); } catch { /* a literal % in a file name */ }
  let segments = null;
  for (const form of new Set([rel, decoded])) {
    const slashed = form.replaceAll('\\', '/');
    if (slashed.startsWith('/') || DRIVE_RE.test(slashed)) return null;
    const parts = slashed.split('/').filter(Boolean);
    for (const part of parts) {
      const bare = part.replace(/[. ]+$/, '');
      if (!bare || part.includes(':') || GIT_NAME_RE.test(bare)) return null;
    }
    segments ??= parts;
  }
  return segments.length ? segments : null;
}

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).some((s) => GIT_NAME_RE.test(s));
};

// The absolute path of a file under root, or null. A link that leads out of the root is refused by following it.
export function safeResolve(root, rel) {
  const segments = lexical(rel);
  if (!segments) return null;
  const abs = resolve(root, ...segments);
  if (!inside(root, abs)) return null;
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    return abs;
  }
  return inside(realpathSync(root), real) ? real : null;
}

function run(cwd, args, { buffer = false, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolveRun) => {
    execFile('git', ['--literal-pathspecs', ...args], { cwd, timeout: TIMEOUT_MS, maxBuffer, windowsHide: true, encoding: buffer ? 'buffer' : 'utf8' }, (err, stdout) => {
      resolveRun({ out: err ? null : stdout, tooBig: err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    });
  });
}

export async function mergeBaseOf(root, base, ref) {
  const { out } = await run(root, ['merge-base', base, ref]);
  const sha = out?.trim();
  return sha && SHA_RE.test(sha) ? sha : null;
}

// Tracked files under the folder or file hints of a part; anything that is not a plain relative path is skipped.
export async function listFiles(root, hints) {
  const paths = [...new Set((hints ?? []).filter((h) => typeof h === 'string' && !GLOB_RE.test(h)).map((h) => lexical(h)?.join('/')).filter(Boolean))];
  if (!paths.length) return [];
  const { out } = await run(root, ['ls-files', '-z', '--', ...paths]);
  return (out?.split('\0').filter(Boolean) ?? []).sort().slice(0, LIST_MAX);
}

const FOUND_MAX = 30;

// Files of the project whose path holds the query, for "@" in the chat (mm22): tracked and new ones (git's ignore rules
// apply), never a secrets file. A match in the file name ranks above a match in its folder.
export async function findFiles(root, query) {
  const { out } = await run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const q = String(query ?? '').toLowerCase();
  const paths = [...new Set(out?.split('\0').filter(Boolean) ?? [])]
    .filter((p) => !ENV_RE.test(p.split('/').pop()) || ENV_TEMPLATE_RE.test(p));
  const rank = (p) => {
    const name = p.split('/').pop().toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
  };
  return paths.filter((p) => p.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))
    .slice(0, FOUND_MAX);
}

export const isSecretsFile = (path) => {
  const name = String(path).replaceAll('\\', '/').split('/').pop();
  return ENV_RE.test(name) && !ENV_TEMPLATE_RE.test(name);
};

const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

function changesOf(diff) {
  const changes = [];
  for (const m of diff.matchAll(HUNK_RE)) {
    const from = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) changes.push({ from, to: from + count - 1 });
  }
  return changes;
}

const lineCount = (text) => (text.match(/\n/g)?.length ?? 0) + (text && !text.endsWith('\n') ? 1 : 0);

// ref: read the branch's copy through git (a branch with no folder on this machine); otherwise the folder under root.
// diffBase: marks the lines changed since that commit (a merge-base).
export async function readFileForView(root, rel, { diffBase, ref } = {}) {
  const segments = lexical(rel);
  if (!segments) return { ok: false, error: 'bad-path' };
  const name = segments.at(-1);
  if (ENV_RE.test(name) && !ENV_TEMPLATE_RE.test(name)) return { ok: false, error: 'sensitive' };
  let buf;
  if (ref) {
    const shown = await run(root, ['show', `${ref}:${segments.join('/')}`], { buffer: true, maxBuffer: FILE_MAX + 1 });
    if (shown.tooBig) return { ok: false, error: 'too-large' };
    if (!shown.out) return { ok: false, error: 'not-found' };
    buf = shown.out;
  } else {
    const abs = safeResolve(root, rel);
    if (!abs) return { ok: false, error: 'bad-path' };
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) return { ok: false, error: 'not-found' };
    if (info.size > FILE_MAX) return { ok: false, error: 'too-large' };
    buf = await readFile(abs);
  }
  if (looksBinary(buf)) return { ok: false, error: 'binary' };
  const text = buf.toString('utf8');
  let changes = [];
  if (diffBase && SHA_RE.test(diffBase)) {
    const { out } = await run(root, ['diff', '--unified=0', '--no-color', '--no-ext-diff', diffBase, ...(ref ? [ref] : []), '--', join(...segments)]);
    changes = changesOf(out ?? '');
  }
  return { ok: true, text, lines: lineCount(text), changes };
}

// Every segment is encoded, so the link has no space or quote for the Windows protocol handler to split on.
export function vscodeUrl(abs, line) {
  const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const parts = abs.replaceAll('\\', '/').split('/').map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encode(s)));
  return `vscode://file/${parts.join('/').replace(/^\//, '')}:${line}`;
}

const DIFF_LINES_MAX = 3000;
const HUNK_HEAD_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Unified diff text to hunks of lines that start with ' ', '+' or '-'.
function hunksOf(diff) {
  const hunks = [];
  let left = DIFF_LINES_MAX;
  for (const line of diff.split('\n')) {
    const head = HUNK_HEAD_RE.exec(line);
    if (head) hunks.push({ oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] });
    else if (hunks.length && left > 0 && /^[ +-]/.test(line)) {
      hunks.at(-1).lines.push(line.replace(/\r$/, ''));
      left--;
    }
  }
  return { hunks, cut: left <= 0 };
}

// The before and after of a file not saved yet (mm30), against the last saved version: an edit's changed lines with a
// little context, every line of a new file, and the previous content of a removed one.
export async function worktreeDiff(root, rel) {
  const segments = lexical(rel);
  if (!segments) return { ok: false, error: 'bad-path' };
  const name = segments.at(-1);
  if (ENV_RE.test(name) && !ENV_TEMPLATE_RE.test(name)) return { ok: false, error: 'sensitive' };
  const path = segments.join('/');
  const { out } = await run(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--unified=3', '--', path]);
  if (out && /^Binary files /m.test(out)) return { ok: false, error: 'binary' };
  if (out?.trim()) return { ok: true, ...hunksOf(out) };
  const file = await readFileForView(root, path);
  if (!file.ok) return file;
  const lines = file.text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return { ok: true, hunks: [{ oldStart: 0, newStart: 1, lines: lines.slice(0, DIFF_LINES_MAX).map((l) => `+${l.replace(/\r$/, '')}`) }], cut: lines.length > DIFF_LINES_MAX };
}
