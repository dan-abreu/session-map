import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { log } from '../log.mjs';

// The safety net of the Autonomous way (pc16): a recoverable snapshot of the working tree before work that may delete
// things, and the commands the hub must recognise (a force push is never let through, a destructive one is snapshotted).
export const SAFETY_REFS = 'refs/session-map/safety';
export const NO_FORCE_PUSH = 'session-map never lets a force push through (--force, -f, --force-with-lease or a +refspec). Push without forcing; if the remote moved, fetch and integrate first, or leave the push for the person.';
const KEEP = 20;
const GIT_TIMEOUT_MS = 60_000;
// Its own name on the snapshot commit: it is no one's work, and a repo without user.name must not make it fail.
const IDENTITY = { GIT_AUTHOR_NAME: 'session-map', GIT_AUTHOR_EMAIL: 'session-map@localhost', GIT_COMMITTER_NAME: 'session-map', GIT_COMMITTER_EMAIL: 'session-map@localhost' };

// Words, quoted strings and the separators between commands (;, &, &&, |, ||, a new line), quotes taken off.
const TOKEN_RE = /"([^"]*)"|'([^']*)'|(&&|\|\||[;&|\n])|([^\s;&|"']+)/g;

// A subshell or a substitution leaves its brackets on the word: (git, $(git, `git, -f), }.
const bare = (word) => word.replace(/^(?:\$\(|[({`])+/, '').replace(/[)}`]+$/, '');

// → the commands of one shell line, each as its words.
function split(line) {
  const out = [[]];
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m[3]) out.push([]);
    else if (m[4] === undefined) out.at(-1).push(m[1] ?? m[2]);
    else if (bare(m[4])) out.at(-1).push(bare(m[4]));
  }
  return out.filter((words) => words.length);
}

// "C:/Program Files/Git/bin/git.exe" → "git": the program a word names, whatever folder or extension it has.
const programOf = (word) => word.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

// bash -c "…", cmd /c "…", powershell -Command "…", eval "…": a shell handed a line as a string runs it too.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh']);
const LINE_FLAG = /^(?:-[a-z]*c|-co\w*|\/[ck])$/i;
const NEST_MAX = 3;
function shellLine(words) {
  const evaled = words.findIndex((w) => programOf(w) === 'eval');
  if (evaled >= 0) return words.slice(evaled + 1).join(' ');
  const at = words.findIndex((w) => SHELLS.has(programOf(w)));
  const flag = at < 0 ? -1 : words.findIndex((w, i) => i > at && LINE_FLAG.test(w));
  return flag < 0 ? '' : words.slice(flag + 1).join(' ');
}

// → the line and every line it hands a shell, a few levels deep.
function lines(line, depth = 0) {
  const inner = depth < NEST_MAX ? split(line).map(shellLine).filter(Boolean) : [];
  return [line, ...inner.flatMap((l) => lines(l, depth + 1))];
}

// → the commands of a shell line and of the lines it hands a shell, each as its words.
const commands = (line) => (typeof line === 'string' ? lines(line).flatMap(split) : []);

// The global options of git whose value is the next word.
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

// → { sub, args } of a git call in these words (its global options skipped), or null.
function gitCall(words) {
  const at = words.findIndex((w) => programOf(w) === 'git');
  if (at < 0) return null;
  let i = at + 1;
  while (i < words.length && words[i].startsWith('-')) i += GIT_VALUED.has(words[i]) ? 2 : 1;
  return i < words.length ? { sub: words[i], args: words.slice(i + 1) } : null;
}

// git takes any unambiguous start of a long option: --force-w is --force-with-lease, --mi is --mirror (which forces too).
const FORCE_FLAG = /^--(?:for|mi)/;
const SHORT_FORCE = /^-[a-zA-Z0-9]*f[a-zA-Z0-9]*$/;

export function isForcePush(line) {
  return commands(line).some((words) => {
    const call = gitCall(words);
    return call?.sub === 'push' && call.args.some((a) => FORCE_FLAG.test(a) || SHORT_FORCE.test(a) || a.startsWith('+'));
  });
}

// A move may land on a file that exists: it counts as a delete.
const DELETERS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'mv', 'move', 'move-item']);
const has = (args, ...flags) => args.some((a) => flags.includes(a));
const GIT_DESTRUCTIVE = {
  clean: () => true,
  reset: (args) => args.includes('--hard'),
  checkout: (args) => has(args, '--', '.', '-f', '--force'),
  switch: (args) => has(args, '-f', '--force', '--discard-changes'),
  restore: () => true,
  branch: (args) => args.includes('-D'),
  stash: (args) => args[0] === 'drop' || args[0] === 'clear',
};

// A > that empties a file first: not >>, 2>&1, => or a write into /dev/null or $null; quoted text is no redirect.
const TRUNCATE_RE = /(?<![>&=-])>(?![>&|])\s*([^\s;&|<>]+)/g;
const NOWHERE = /^(?:\/dev\/null|nul|\$null)$/i;
const truncates = (line) => [...line.replace(/"[^"]*"|'[^']*'/g, '""').matchAll(TRUNCATE_RE)].some((m) => !NOWHERE.test(m[1]));

// Any word that names a deleter counts (find -exec rm, xargs rm): a snapshot too many costs little, one too few a day's work.
export function isDestructive(line) {
  if (typeof line === 'string' && lines(line).some(truncates)) return true;
  return commands(line).some((words) => {
    if (words.some((w) => DELETERS.has(programOf(w)))) return true;
    if (words.some((w) => programOf(w) === 'find') && words.includes('-delete')) return true;
    const call = gitCall(words);
    return Boolean(call && GIT_DESTRUCTIVE[call.sub]?.(call.args));
  });
}

// The command line of a shell step; '' for any other tool.
export function commandOf(toolName, input) {
  return (toolName === 'Bash' || toolName === 'PowerShell') && typeof input?.command === 'string' ? input.command : '';
}

// input: what git reads on stdin (a --stdin list of paths).
function git(cwd, args, env = process.env, input = undefined) {
  return new Promise((done, fail) => {
    const child = execFile('git', args, { cwd, env, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? fail(err) : done(String(stdout).trim())));
    if (input !== undefined) child.stdin.end(input);
  });
}

// The copied index keeps the person's skip-worktree and assume-unchanged marks, and add -A would not look past them: the
// copy loses them, so the snapshot holds what is on disk. A sparse file that is not on disk keeps HEAD's blob.
async function unflag(top, env) {
  const entries = (await git(top, ['ls-files', '-v', '-z'], env)).split('\0').filter(Boolean).map((l) => ({ tag: l[0], path: l.slice(2) }));
  const assumed = entries.filter((e) => /[a-z]/.test(e.tag)).map((e) => e.path);
  const skipped = entries.filter((e) => /^[Ss]$/.test(e.tag) && existsSync(join(top, e.path))).map((e) => e.path);
  if (assumed.length) await git(top, ['update-index', '--no-assume-unchanged', '-z', '--stdin'], env, `${assumed.join('\0')}\0`);
  if (skipped.length) await git(top, ['update-index', '--no-skip-worktree', '-z', '--stdin'], env, `${skipped.join('\0')}\0`);
}

// 2026-10-10T12:00:00.000Z → 20261010T120000000Z: sorts by time and is a valid ref name.
const stampOf = (now) => now.toISOString().replace(/[-:.]/g, '');

// A commit of the whole working tree (tracked, changed and untracked, not ignored), built in a temporary index so the
// person's index, branch and files are never touched, kept under refs/session-map/safety/<time>; the newest `keep` stay.
// → { ref, commit }, or null outside a git repository or when it failed (only a warning: the work goes on).
export async function snapshot(cwd, { now = new Date(), keep = KEEP } = {}) {
  let top;
  try { top = await git(cwd, ['rev-parse', '--show-toplevel']); } catch { return null; }
  const scratch = mkdtempSync(join(tmpdir(), 'sm-safety-'));
  try {
    const index = join(scratch, 'index');
    // A copy of the real index lets git skip hashing the files that did not change.
    try { copyFileSync(resolve(top, await git(top, ['rev-parse', '--git-path', 'index'])), index); } catch { /* a repo with no index yet */ }
    const env = { ...process.env, ...IDENTITY, GIT_INDEX_FILE: index };
    await unflag(top, env);
    await git(top, ['add', '-A'], env);
    const tree = await git(top, ['write-tree'], env);
    const head = await git(top, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => null);
    const commit = await git(top, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'session-map safety snapshot'], env);
    const ref = `${SAFETY_REFS}/${stampOf(now)}`;
    await git(top, ['update-ref', ref, commit]);
    await prune(top, keep);
    return { ref, commit };
  } catch (err) {
    log('warn', 'safety-snapshot-failed', { error: err.message });
    return null;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

async function prune(top, keep) {
  const refs = (await git(top, ['for-each-ref', '--format=%(refname)', SAFETY_REFS])).split('\n').filter(Boolean).sort().reverse();
  for (const ref of refs.slice(keep)) await git(top, ['update-ref', '-d', ref]);
}
