// The census of a project (fd01): every file, counted letter by letter by the program (no AI, no dependency), with sums
// per folder, per part of the map and in total, what was left out apart, and the difference since the last round.
// Contract: .dev/fundacao/00-contratos.md section 1. `censusOf` only reads the disk; the refresh writes census.json.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isSecretsFile } from '../files.mjs';
import { log } from '../log.mjs';
import { kindOfFile, lineCount } from '../sources/count.mjs';
import { lex } from './lex.mjs';

const run = promisify(execFile);
const GIT = { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
const DEP_DIRS = new Set(['node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'bower_components', '.venv', 'venv', 'site-packages', 'pods', '.yarn', '.pnpm-store']);
// A library folder is only counted, never listed, and counting stops here: a number, not a walk of a whole disk.
const DEP_WALK_MAX = 200_000;
const BREATHE_EVERY = 200;
// Files a package manager rewrites on every install: a change deep inside a library folder shows on one of them.
const DEP_MARKERS = ['.package-lock.json', '.modules.yaml', '.yarn-state.yml', '.yarn-integrity', '.pnpm/lock.yaml'];
// absolute library folder -> { sig, n }: the count is redone only when the folder or its install marker changes.
const depMemo = new Map();
const SUM_KEYS = ['bytes', 'chars', 'words'];
const LINE_KEYS = ['total', 'code', 'comment', 'blank'];
const TYPE_BY_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', jsx: 'jsx', dart: 'dart', php: 'php',
  prisma: 'prisma', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'md', markdown: 'md', mdx: 'md', css: 'css',
  html: 'html', htm: 'html', sql: 'sql', sh: 'sh', bash: 'sh', zsh: 'sh',
};

export function typeOf(path) {
  const name = String(path).split('/').pop().toLowerCase();
  if (name.endsWith('.blade.php')) return 'blade';
  const dot = name.lastIndexOf('.');
  return (dot > 0 && Object.hasOwn(TYPE_BY_EXT, name.slice(dot + 1)) && TYPE_BY_EXT[name.slice(dot + 1)]) || 'other';
}

const iso = (ms) => new Date(ms).toISOString();
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const looksBinary = (buf) => buf.subarray(0, 8192).includes(0);
const byCodeUnit = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function codePoints(text) {
  let n = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}

function wordCount(text) {
  const re = /\S+/g;
  let n = 0;
  while (re.exec(text)) n++;
  return n;
}

async function git(root, args) {
  try {
    return (await run('git', args, { ...GIT, cwd: root })).stdout;
  } catch (err) {
    if (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') log('warn', 'git-too-slow', { command: args.join(' '), code: err.code ?? err.signal });
    return null;
  }
}

const split0 = (out) => out.split('\0').filter(Boolean);

const mtimeOf = async (path) => (await stat(path).catch(() => null))?.mtimeMs ?? null;

async function depSignature(dir) {
  const own = await mtimeOf(dir);
  if (own === null) return null;
  const marks = await Promise.all(DEP_MARKERS.map((m) => mtimeOf(join(dir, m))));
  return JSON.stringify([own, ...marks]);
}

// How many files a library folder holds, without listing them. Links are not followed. Walked without blocking the
// server, and only again when the folder or its install marker changed: a node_modules can hold tens of thousands.
async function countFilesIn(dir, readDir) {
  const sig = await depSignature(dir);
  const memo = depMemo.get(dir);
  if (sig !== null && memo?.sig === sig) return memo.n;
  let n = 0;
  const stack = [dir];
  while (stack.length && n < DEP_WALK_MAX) {
    const here = stack.pop();
    let entries;
    try { entries = await readDir(here, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(join(here, e.name));
      else if (e.isFile()) n++;
    }
  }
  if (sig === null) depMemo.delete(dir);
  else depMemo.set(dir, { sig, n });
  return n;
}

// The list of files to count: [paths to count], plus how many files sit in library folders that are not listed.
async function listFiles(root, readDir) {
  const tracked = await git(root, ['ls-files', '-z']);
  if (tracked === null) return walkFolder(root, readDir);
  const others = (await git(root, ['ls-files', '-z', '-o', '--exclude-standard'])) ?? '';
  const ignored = (await git(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory'])) ?? '';
  let hiddenDep = 0;
  for (const entry of split0(ignored)) {
    const isDir = entry.endsWith('/');
    // A folder entry has no file name, so the check looks at a file inside it.
    if (kindOfFile(isDir ? `${entry}x` : entry) !== 'dep') continue;
    hiddenDep += isDir ? await countFilesIn(join(root, entry), readDir) : 1;
  }
  return { paths: [...new Set([...split0(tracked), ...split0(others)])], hiddenDep };
}

// No git: every file under the folder, except .git; a library folder is only counted.
async function walkFolder(root, readDir) {
  const paths = [];
  let hiddenDep = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = await readDir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        if (DEP_DIRS.has(e.name.toLowerCase())) hiddenDep += await countFilesIn(join(root, path), readDir);
        else stack.push(path);
      } else if (e.isFile()) paths.push(path);
    }
  }
  return { paths, hiddenDep };
}

// A file that is not opened (a library, a generated file, a binary, a secret): size and time only.
const leftOut = (path, kind, st) => ({
  path, type: typeOf(path), kind, included: false, reason: kind, bytes: st.size, chars: null, words: null, lines: null,
  mtime: iso(st.mtimeMs), sha: null, owner: null,
});

function countedRow(path, type, kind, buf, st, owner) {
  const text = buf.toString('utf8');
  const total = lineCount(buf);
  let blank = 0;
  let comment = 0;
  for (const l of lex(text, type).lines) {
    if (l.blank) blank++;
    else if (l.comment) comment++;
  }
  return {
    path, type, kind, included: true, reason: null, bytes: buf.length, chars: codePoints(text), words: wordCount(text),
    lines: { total, code: total - blank - comment, comment, blank }, mtime: iso(st.mtimeMs), sha: sha16(buf), owner,
  };
}

function rowOf(root, path, prevRow, owner, readFile) {
  const abs = join(root, path);
  let st;
  try { st = lstatSync(abs); } catch { return null; }
  // A link could point outside the project and a folder is a submodule: neither is a file of this project.
  if (!st.isFile()) return null;
  if (isSecretsFile(path)) return leftOut(path, 'secret', st);
  const kind = kindOfFile(path);
  if (kind === 'dep' || kind === 'generated' || kind === 'binary') return leftOut(path, kind, st);
  if (prevRow && prevRow.bytes === st.size && prevRow.mtime === iso(st.mtimeMs) && (prevRow.included || prevRow.reason === 'binary')) {
    return prevRow.included ? { ...prevRow, kind, owner } : leftOut(path, 'binary', st);
  }
  let buf;
  try { buf = readFile(abs); } catch (err) {
    log('warn', 'census-unreadable', { path, code: err.code ?? null });
    return null;
  }
  if (looksBinary(buf)) return leftOut(path, 'binary', st);
  return countedRow(path, typeOf(path), kind, buf, st, owner);
}

const zero = () => ({ files: 0, bytes: 0, chars: 0, words: 0, lines: { total: 0, code: 0, comment: 0, blank: 0 } });

function addTo(sum, f) {
  sum.files++;
  for (const k of SUM_KEYS) sum[k] += f[k];
  for (const k of LINE_KEYS) sum.lines[k] += f.lines[k];
}

// Sums of the counted files: each folder with its subfolders, each part of the map by `owner` (`_none` = no owner) and
// the total. Left-out files are not in any of them.
export function sumsOf(files) {
  const total = zero();
  const folders = new Map();
  const parts = new Map([['_none', zero()]]);
  for (const f of files) {
    if (!f.included) continue;
    addTo(total, f);
    const dirs = f.path.split('/').slice(0, -1);
    for (let i = 1; i <= dirs.length; i++) {
      const key = dirs.slice(0, i).join('/');
      if (!folders.has(key)) folders.set(key, zero());
      addTo(folders.get(key), f);
    }
    const part = f.owner ?? '_none';
    if (!parts.has(part)) parts.set(part, zero());
    addTo(parts.get(part), f);
  }
  return { total, folders: Object.fromEntries(folders), parts: Object.fromEntries(parts) };
}

const countsOf = (files, hiddenDep) => {
  const excluded = { dep: hiddenDep, generated: 0, binary: 0, secret: 0 };
  for (const f of files) if (!f.included) excluded[f.kind]++;
  return excluded;
};

const rowKey = (f) => JSON.stringify([f.path, f.type, f.kind, f.included, f.reason, f.bytes, f.chars, f.words, f.lines, f.sha, f.owner]);

function sameCensus(a, b) {
  if (a.files.length !== b.files.length || JSON.stringify(a.excluded) !== JSON.stringify(b.excluded)) return false;
  return a.files.every((f, i) => rowKey(f) === rowKey(b.files[i]));
}

const usable = (prev) => (prev && prev.version === 1 && Array.isArray(prev.files) && Number.isInteger(prev.rev) ? prev : null);

// root: the project folder. prev: the last census (or null). owners: Map<path, partId|null> from the caller.
// readFile and readDir are injectable so a test can prove which files were opened and which folders were walked.
export async function censusOf(root, prev, { owners = new Map(), readFile = readFileSync, readDir = readdir, now = new Date() } = {}) {
  const before = usable(prev);
  const was = new Map((before?.files ?? []).map((f) => [f.path, f]));
  const { paths, hiddenDep } = await listFiles(root, readDir);
  const files = [];
  for (const [i, path] of paths.entries()) {
    // Every file is read in one go; between batches the server answers the page, or a big project freezes it.
    if (i > 0 && i % BREATHE_EVERY === 0) await new Promise((r) => setImmediate(r));
    const row = rowOf(root, path, was.get(path), owners.get(path) ?? null, readFile);
    if (row) files.push(row);
  }
  files.sort(byCodeUnit);
  const head = ((await git(root, ['rev-parse', 'HEAD'])) ?? '').trim();
  const census = {
    version: 1, generatedAt: now.toISOString(), rev: 1, head: /^[0-9a-f]{40}$/.test(head) ? head : null, tool: 'own',
    files, sums: sumsOf(files), excluded: countsOf(files, hiddenDep),
  };
  if (before) census.rev = sameCensus(before, census) ? before.rev : before.rev + 1;
  return census;
}

const small = (f) => ({ lines: f.lines.total, chars: f.chars });
const totalsOf = (census) => (census
  ? { files: census.sums.total.files, lines: census.sums.total.lines.total, chars: census.sums.total.chars }
  : { files: 0, lines: 0, chars: 0 });

// The line of census-log.jsonl for the step from `prev` to `next`: only counted files are listed.
export function diffCensus(prev, next) {
  const was = new Map((usable(prev)?.files ?? []).filter((f) => f.included).map((f) => [f.path, f]));
  const now = new Map(next.files.filter((f) => f.included).map((f) => [f.path, f]));
  const added = [];
  const changed = [];
  for (const [path, f] of now) {
    const old = was.get(path);
    if (!old) added.push({ path, ...small(f) });
    else if (old.sha !== f.sha || old.lines.total !== f.lines.total || old.chars !== f.chars) {
      changed.push({ path, before: { ...small(old), sha: old.sha }, after: { ...small(f), sha: f.sha } });
    }
  }
  const removed = [...was].filter(([path]) => !now.has(path)).map(([path, f]) => ({ path, ...small(f) }));
  for (const list of [added, removed, changed]) list.sort(byCodeUnit);
  return {
    rev: next.rev, from: usable(prev)?.rev ?? 0, at: next.generatedAt, added, removed, changed,
    totals: { before: totalsOf(usable(prev)), after: totalsOf(next) },
  };
}

// ponytail: deliberate ceiling of 500 lines in census-log.jsonl; the oldest go first.
export function trimLog(lines, max = 500) {
  return lines.length > max ? lines.slice(lines.length - max) : lines;
}
