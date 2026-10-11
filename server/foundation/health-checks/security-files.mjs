// Health (fd08), the three security items that look at files and git: no secrets in the files or the history, a
// .gitignore that keeps them out, no executables in the repository. Answers are { state, evidence, reason, detail }.
// A secret's value never leaves this module: evidence is a path with a line or a commit, detail only counts. Secret
// files (.env) are never read; the history is searched by git itself (`log -G`), so its text never reaches us.
// The checks that need git return a promise; with no `ctx.root` (a context in memory) they answer from the census alone.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isSecretsFile } from '../../files.mjs';
import { log } from '../../log.mjs';
import { kindOfFile } from '../../sources/count.mjs';

const run = promisify(execFile);
const GIT = { timeout: 10_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true };
// ponytail: past 5000 commits or 20 s the history is "too big to check", never a guess either way.
const HISTORY_MAX_COMMITS = 5000;
const HISTORY_TIMEOUT_MS = 20_000;
// ponytail: the screen lists 20 places; the counts in `detail` stay whole.
const EVIDENCE_MAX = 20;
const MEMO_MAX = 32;
const PATHSPEC_CHUNK = 100;

// One list for both engines: JavaScript for the files, git's extended regex for the history (so no \b, no lookaround).
const KEY_PATTERNS = [
  'AKIA[0-9A-Z]{16}',
  'gh[pousr]_[A-Za-z0-9]{36}',
  'github_pat_[A-Za-z0-9_]{22,}',
  '[sr]k_live_[0-9A-Za-z]{20,}',
  'xox[baprs]-[0-9A-Za-z-]{10,}',
  'AIza[0-9A-Za-z_-]{35}',
  '-----BEGIN ([A-Z]+ )*PRIVATE KEY( BLOCK)?-----',
];
const KEY_RE = new RegExp(KEY_PATTERNS.join('|'));
const KEY_ERE = KEY_PATTERNS.join('|');

// A key in a test, a fixture or an example file is there on purpose (and usually fake).
const SAMPLE_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'fixture', 'fixtures', '__fixtures__', 'testdata', 'test-data', 'example', 'examples', 'sample', 'samples', 'mocks', '__mocks__']);
const SAMPLE_NAME = /\.(example|sample|dist|template|tpl)$|\.(example|sample)\./;

export function isSampleOrTest(path) {
  const parts = String(path).toLowerCase().split('/');
  const name = parts.pop();
  return parts.some((d) => SAMPLE_DIRS.has(d)) || SAMPLE_NAME.test(name) || kindOfFile(path) === 'test';
}

const result = (state, { evidence = [], reason = null, detail = {} } = {}) => ({ state, evidence, reason, detail });
const extOf = (p) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

async function git(root, args, opts = {}) {
  try {
    return { out: (await run('git', ['-c', 'core.quotepath=off', ...args], { ...GIT, ...opts, cwd: root })).stdout };
  } catch (err) {
    return { err };
  }
}

const gitFailure = (err) => (err.code === 'ENOENT' ? 'tool-missing' : 'error');

// The `paths` git tracks: { state: 'ok', paths } | { state: 'tool-missing' | 'error', paths: [] }. When git cannot
// answer (not installed, a folder that is no repository) nothing counts and the item is unverified, never a guess.
// Only a context in memory (no root, no folder) keeps every path: the census lists files git does not ignore.
async function keepTracked(root, paths) {
  if (!root || !paths.length) return { state: 'ok', paths };
  const tracked = new Set();
  for (let i = 0; i < paths.length; i += PATHSPEC_CHUNK) {
    const { out, err } = await git(root, ['--literal-pathspecs', 'ls-files', '-z', '--', ...paths.slice(i, i + PATHSPEC_CHUNK)]);
    if (err) return { state: gitFailure(err), paths: [] };
    for (const p of out.split('\0')) if (p) tracked.add(p);
  }
  return { state: 'ok', paths: paths.filter((p) => tracked.has(p)) };
}

// ---------- history ----------

// root + refs + limits -> answer: the history is searched again only when a branch or tag moved.
const memo = new Map();

// Commits whose diff adds or removes a key, by path: { state: 'ok', hits: [{commit, file}] } | { state: 'too-big' }
// | { state: 'tool-missing' | 'error' }. Only commit hashes and file names come back from git, never a diff line.
export async function scanHistory(root, { maxCommits = HISTORY_MAX_COMMITS, timeoutMs = HISTORY_TIMEOUT_MS } = {}) {
  const refs = await git(root, ['for-each-ref', '--format=%(objectname)']);
  if (refs.err) return { state: gitFailure(refs.err) };
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  const key = [root, head.out ?? '', refs.out, maxCommits, timeoutMs].join('\0');
  if (memo.has(key)) return memo.get(key);

  const answer = await searchHistory(root, maxCommits, timeoutMs);
  if (answer.state === 'ok' || answer.state === 'too-big') {
    memo.set(key, answer);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  return answer;
}

const tooBig = (err) => err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

// `-- .` with `--relative`: a project in a subfolder of a bigger repository sees only its own commits and files, with
// paths relative to its root (the census's paths), never the keys of the projects beside it.
async function searchHistory(root, maxCommits, timeoutMs) {
  const count = await git(root, ['rev-list', '--count', '--all', '--', '.'], { timeout: timeoutMs });
  if (count.err) return { state: tooBig(count.err) ? 'too-big' : gitFailure(count.err) };
  if (Number(count.out.trim()) > maxCommits) return { state: 'too-big' };
  const found = await git(root, ['log', '--all', '--no-textconv', '--no-ext-diff', '--relative', '--format=@@%H', '--name-only', `-G${KEY_ERE}`, '--', '.'], { timeout: timeoutMs });
  if (found.err) {
    if (tooBig(found.err)) {
      log('warn', 'health-history-too-big', { timeoutMs });
      return { state: 'too-big' };
    }
    return { state: gitFailure(found.err) };
  }
  const hits = [];
  const seen = new Set();
  let commit = null;
  for (const line of found.out.split(/\r?\n/)) {
    if (line.startsWith('@@')) commit = line.slice(2).trim();
    else if (line && commit && !isSampleOrTest(line) && !seen.has(`${commit}\0${line}`)) {
      seen.add(`${commit}\0${line}`);
      hits.push({ commit, file: line });
    }
  }
  return { state: 'ok', hits };
}

// ---------- security.no_secrets ----------

// file:line of every key in the included files of the census (never a secret file, never a test or example).
function keysInFiles(ctx) {
  const hits = [];
  const rows = ctx.files.filter((r) => r.included && r.kind !== 'secret' && !isSecretsFile(r.path) && !isSampleOrTest(r.path));
  for (const { path } of [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const text = ctx.read(path);
    if (typeof text !== 'string') continue;
    text.split('\n').forEach((line, i) => {
      if (KEY_RE.test(line)) hits.push({ file: path, line: i + 1 });
    });
  }
  return hits;
}

const UNVERIFIED_REASON = { 'too-big': 'too-big', 'tool-missing': 'tool-missing', error: 'error' };

async function noSecrets(ctx, opts = {}) {
  const inFiles = keysInFiles(ctx);
  const secretPaths = ctx.files.filter((r) => r.kind === 'secret' || isSecretsFile(r.path)).map((r) => r.path).sort();
  const { state: trackedState, paths: tracked } = await keepTracked(ctx.root, secretPaths);
  // A context in memory has no folder, so no history to search.
  const history = ctx.root ? await scanHistory(ctx.root, opts) : { state: 'ok', hits: [] };
  const inHistory = history.hits ?? [];
  const detail = { files: inFiles.length, tracked: tracked.length, commits: new Set(inHistory.map((h) => h.commit)).size, history: history.state };
  if (inFiles.length || tracked.length || inHistory.length) {
    const evidence = [...inFiles, ...tracked.map((file) => ({ file })), ...inHistory].slice(0, EVIDENCE_MAX);
    return result('fail', { evidence, reason: 'unsafe', detail });
  }
  const unchecked = [trackedState, history.state].find((s) => s !== 'ok');
  if (unchecked) return result('unverified', { reason: UNVERIFIED_REASON[unchecked] ?? 'error', detail });
  return result('pass', { detail });
}

// ---------- security.gitignore_secrets ----------

const escapeRe = (s) => s.replace(/[.+^${}()|\\]/g, '\\$&');

function globToRe(segment) {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '\\' && i + 1 < segment.length) out += escapeRe(segment[++i]);
    else if (c === '[') {
      const end = segment.indexOf(']', i + 2);
      if (end < 0) out += '\\[';
      else {
        out += `[${segment.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else out += escapeRe(c);
  }
  return out;
}

// The rules of one .gitignore, in order: { re, negate, dirOnly } (gitignore(5): '#' comment, '!' re-includes, a slash
// at the start or in the middle anchors to the file's folder, a trailing slash matches folders only, '**' any depth).
export function parseGitignore(text) {
  const rules = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.replace(/\/+$/, '');
    if (!line) continue;
    const anchored = line.includes('/');
    const segments = line.replace(/^\/+/, '').split('/');
    let body = '';
    segments.forEach((seg, i) => {
      const last = i === segments.length - 1;
      if (seg === '**') body += last ? '.*' : '(?:[^/]+/)*';
      else body += globToRe(seg) + (last ? '' : '/');
    });
    rules.push({ re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), negate, dirOnly });
  }
  return rules;
}

// files: [{ dir, rules }], shallow first. Git's own order: a deeper file wins, the last matching line wins, and nothing
// inside an ignored folder can be brought back.
function isIgnored(path, isDir, files) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) if (matches(parts.slice(0, i).join('/'), true, files)) return true;
  return matches(path, isDir, files);
}

function matches(path, isDir, files) {
  let ignored = false;
  for (const { dir, rules } of files) {
    if (dir && !path.startsWith(`${dir}/`)) continue;
    const rel = dir ? path.slice(dir.length + 1) : path;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(rel)) ignored = !rule.negate;
    }
  }
  return ignored;
}

const depsOf = (ctx, manifest) => {
  try {
    const data = JSON.parse(String(ctx.read(manifest) ?? '').replace(/^﻿/, ''));
    return { ...data?.dependencies, ...data?.devDependencies };
  } catch { return {}; }
};

// What must never be committed from one package folder: its secrets and the output of its stack.
function wantedIn(ctx, pkg) {
  const want = [['.env', false], ['x.pem', false, '*.pem'], ['x.key', false, '*.key']];
  if (pkg?.kind === 'node') {
    want.push(['node_modules', true]);
    if (Object.hasOwn(depsOf(ctx, pkg.manifest), 'next')) want.push(['.next', true]);
  }
  if (pkg?.kind === 'dart') want.push(['.dart_tool', true], ...(pkg.flutter ? [['build', true]] : []));
  if (pkg?.kind === 'php') want.push(['vendor', true]);
  return want;
}

async function gitignoreSecrets(ctx) {
  const ignoreFiles = ctx.files.filter((r) => r.kind !== 'dep' && baseOf(r.path) === '.gitignore')
    .map((r) => ({ path: r.path, dir: r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '' }))
    .sort((a, b) => a.dir.split('/').length - b.dir.split('/').length || (a.dir < b.dir ? -1 : 1))
    .map((f) => ({ ...f, rules: parseGitignore(ctx.read(f.path)) }));
  if (!ignoreFiles.length) return result('fail', { reason: 'missing', detail: { names: [] } });

  // A folder can hold two manifests (Laravel: composer.json and package.json): it needs the outputs of both.
  const dirs = new Map([['', [null]]]);
  for (const pkg of ctx.packages ?? []) dirs.set(pkg.dir, [...(dirs.get(pkg.dir) ?? []), pkg]);
  const names = new Set();
  for (const [dir, pkgs] of dirs) {
    for (const [name, isDir, label] of pkgs.flatMap((pkg) => wantedIn(ctx, pkg))) {
      const path = dir ? `${dir}/${name}` : name;
      if (!isIgnored(path, isDir, ignoreFiles)) {
        // `*.pem` and `*.key` stand for any file of that kind: shown once, without the folder.
        names.add(label ?? `${path}${isDir ? '/' : ''}`);
      }
    }
  }
  // Only the .gitignore files that rule over a checked folder (a fixture repository inside the project does not).
  const rules = (f) => f.dir === '' || [...dirs.keys()].some((d) => d === f.dir || d.startsWith(`${f.dir}/`));
  const evidence = ignoreFiles.filter(rules).map((f) => ({ file: f.path })).slice(0, EVIDENCE_MAX);
  if (names.size) return result('fail', { evidence, reason: 'missing', detail: { names: [...names].sort() } });
  return result('pass', { evidence });
}

// ---------- security.no_binaries ----------

// Executables and compiled code: a reviewer cannot read them. Images, fonts and archives are left to the other items.
const EXECUTABLE_EXT = new Set(['exe', 'dll', 'so', 'dylib', 'jar', 'war', 'class', 'pyc']);
// Every Android project commits this one on purpose (the Gradle wrapper); flagging it would only teach the owner to ignore the item.
const KNOWN_BINARIES = new Set(['gradle-wrapper.jar']);

async function noBinaries(ctx) {
  const candidates = ctx.files.map((r) => r.path)
    .filter((p) => EXECUTABLE_EXT.has(extOf(p)) && !KNOWN_BINARIES.has(baseOf(p).toLowerCase()))
    .sort();
  const { state, paths: found } = await keepTracked(ctx.root, candidates);
  if (state !== 'ok') return result('unverified', { reason: UNVERIFIED_REASON[state], detail: { candidates: candidates.length } });
  if (!found.length) return result('pass', { detail: { count: 0 } });
  return result('fail', { evidence: found.slice(0, EVIDENCE_MAX).map((file) => ({ file })), reason: 'unsafe', detail: { count: found.length } });
}

export const CHECKS = Object.freeze({
  'security.no_secrets': noSecrets,
  'security.gitignore_secrets': gitignoreSecrets,
  'security.no_binaries': noBinaries,
});
