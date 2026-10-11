// What git says about versions (fd09): the last release tag and the commits that came after it. Only `execFile`, no shell;
// any failure (no repository, no commit yet, git missing) is an empty answer, never an exception.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareSemver } from './versions-core.mjs';

const run = promisify(execFile);
const GIT = { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
const VERSIONY = /^v?\d+\.\d+/;
// A tag name is passed to git as part of a revision range: only the plain characters a version tag has.
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
export const COMMITS_MAX = 300;

async function git(root, args) {
  try {
    return (await run('git', args, { ...GIT, cwd: root })).stdout;
  } catch {
    return null;
  }
}

// The newest tag (by date) that looks like a version and is reachable from HEAD. Ties on the date go to the higher number,
// so two tags on the same commit give the bigger one. A tag that is not pure semver (`v0.10.1k`) can still be the answer:
// the readers then show the kind of change only.
export async function lastTag(root) {
  const out = await git(root, ['tag', '--merged', 'HEAD', '--format=%(creatordate:unix) %(refname:strip=2)']);
  if (!out) return null;
  const rows = out.split('\n').map((line) => /^(\d+) (\S+)$/.exec(line.trim())).filter(Boolean)
    .map((m) => ({ at: Number(m[1]), name: m[2] })).filter((r) => VERSIONY.test(r.name) && SAFE_TAG.test(r.name));
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => r.at));
  const tied = rows.filter((r) => r.at === top).map((r) => r.name);
  return tied.sort((a, b) => compareSemver(b, a) ?? (b < a ? -1 : b > a ? 1 : 0))[0];
}

// What came after the tag, newest first: { hash, subject, body }. An unknown or unsafe tag name = [].
export async function commitsSince(root, tag, max = COMMITS_MAX) {
  if (typeof tag !== 'string' || !SAFE_TAG.test(tag)) return [];
  const limit = Number.isInteger(max) && max > 0 ? Math.min(max, 5000) : COMMITS_MAX;
  const out = await git(root, ['log', `refs/tags/${tag}..HEAD`, '-n', String(limit), '--abbrev=7', '--format=%h%x1f%s%x1f%b%x1e']);
  if (!out) return [];
  return out.split('\x1e').map((chunk) => chunk.replace(/^\n+/, '')).filter(Boolean).map((chunk) => {
    const [hash, subject, body = ''] = chunk.split('\x1f');
    return { hash, subject, body: body.trim() };
  });
}


// Without a census: the files git knows (tracked, plus new ones it does not ignore), as slash paths. null = not a repository.
export async function listedFiles(root) {
  const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return out === null ? null : [...new Set(out.split('\0').filter(Boolean))];
}
