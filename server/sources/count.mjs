// The size of a program, counted by session-map itself (mm25): every tracked file, line by line, with no dependency.
// Libraries, generated files and binaries are left out of the sums and listed apart, so a number on the map is code a
// person wrote. The census of the foundation (fd01) refines this later.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.mjs';

const TTL_MS = 30_000;
const DEP_DIRS = new Set(['node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'bower_components', '.venv', 'venv', 'site-packages', 'pods', '.yarn', '.pnpm-store']);
const GENERATED_DIRS = new Set(['dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', 'target', '__pycache__', '__snapshots__', '.parcel-cache']);
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'cargo.lock', 'poetry.lock', 'pipfile.lock', 'composer.lock', 'gemfile.lock', 'go.sum', 'uv.lock']);
const GENERATED_RE = /\.(min\.(js|css)|map|snap)$/;
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff', 'svg', 'psd', 'ai', 'sketch', 'fig',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'm4a', 'wav', 'ogg', 'webm', 'mov', 'avi', 'mkv', 'flac',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class',
  'pyc', 'o', 'a', 'lib', 'db', 'sqlite', 'sqlite3', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'keystore', 'p12',
]);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e']);
const TEST_RE = /(\.(test|spec)\.[a-z0-9]+|_test\.[a-z0-9]+)$|^test_[^/]*\.py$/;
const DOC_EXT = new Set(['md', 'mdx', 'markdown', 'txt', 'rst', 'adoc']);
const DOC_DIRS = new Set(['docs', 'doc']);
const SCREEN_EXT = new Set(['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'jsx', 'tsx', 'astro']);
const SCREEN_DIRS = new Set(['web', 'ui', 'components', 'pages', 'views', 'screens', 'styles', 'frontend', 'public']);

export const LEFT_OUT = ['dep', 'generated', 'binary'];

// What a tracked file is, from its path alone: 'dep' | 'generated' | 'binary' (left out of the sums), or 'test' | 'doc' |
// 'screen' | 'code'.
export function kindOfFile(path) {
  const segments = String(path).replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean);
  const name = segments.at(-1) ?? '';
  const dirs = segments.slice(0, -1);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (dirs.some((d) => DEP_DIRS.has(d))) return 'dep';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || LOCKFILES.has(name) || GENERATED_RE.test(name)) return 'generated';
  if (BINARY_EXT.has(ext)) return 'binary';
  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_RE.test(name)) return 'test';
  if (DOC_EXT.has(ext) || DOC_DIRS.has(dirs[0])) return 'doc';
  if (SCREEN_EXT.has(ext) || dirs.some((d) => SCREEN_DIRS.has(d))) return 'screen';
  return 'code';
}

export function lineCount(buf) {
  let n = 0;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
}

const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

function trackedFiles(root) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', 'ls-files', '-z'], { cwd: root, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) log('warn', 'git-too-slow', { command: 'ls-files', code: err.code ?? err.signal });
      resolve(err ? [] : stdout.split('\0').filter(Boolean));
    });
  });
}

// root → {at, value, pending, seen: path → {sig, kind, lines}}: a file is read again only when its size or time changes.
const memos = new Map();

async function count(root, memo) {
  const files = [];
  const left = { dep: [], generated: [], binary: [] };
  const seen = new Map();
  for (const path of (await trackedFiles(root)).sort()) {
    let kind = kindOfFile(path);
    if (LEFT_OUT.includes(kind)) {
      left[kind].push(path);
      continue;
    }
    const st = statSync(join(root, path), { throwIfNoEntry: false });
    // Tracked but deleted on disk, or a folder (a submodule): nothing to count.
    if (!st?.isFile()) continue;
    const sig = `${st.mtimeMs}:${st.size}`;
    let entry = memo.seen.get(path);
    if (entry?.sig !== sig) {
      let buf;
      try { buf = readFileSync(join(root, path)); } catch { continue; }
      entry = looksBinary(buf) ? { sig, kind: 'binary', lines: 0 } : { sig, kind, lines: lineCount(buf) };
    }
    seen.set(path, entry);
    kind = entry.kind;
    if (kind === 'binary') left.binary.push(path);
    else files.push({ path, kind, lines: entry.lines });
  }
  memo.seen = seen;
  return { files, left };
}

// {files: [{path, kind, lines}], left: {dep, generated, binary: [path]}}, recounted at most once per ttlMs per repository.
export async function countRepo(root, { ttlMs = TTL_MS, nowMs = Date.now() } = {}) {
  const memo = memos.get(root) ?? { at: -Infinity, value: null, pending: null, seen: new Map() };
  memos.set(root, memo);
  if (memo.value && nowMs - memo.at < ttlMs) return memo.value;
  memo.pending ??= count(root, memo).then((value) => {
    memo.value = value;
    memo.at = nowMs;
    return value;
  }).finally(() => { memo.pending = null; });
  return memo.pending;
}
