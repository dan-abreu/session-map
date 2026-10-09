import { execFile } from 'node:child_process';
import { log } from '../log.mjs';
import { normalizePath } from '../paths.mjs';

const FETCH_TIMEOUT_MS = 30_000;

// Per repository: the running fetch (never two at once), the last attempt and the last success.
const repos = new Map();

function git(root, args) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: root,
      timeout: FETCH_TIMEOUT_MS,
      windowsHide: true,
      // A remote asking for credentials must fail, not hang waiting for a prompt nobody sees.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// 'none' when there is nothing to fetch from: `git fetch` alone exits 0 there and would claim fresh data.
async function gitFetch(root) {
  if (!(await git(root, ['remote']))?.trim()) return 'none';
  return (await git(root, ['fetch', '--prune', '--quiet'])) === null ? 'failed' : 'ok';
}

// minutes 0/absent = off (the public default). Returns the time of the last successful fetch, or null.
export function autoFetch(root, minutes, { now = Date.now() } = {}) {
  if (!(minutes > 0)) return Promise.resolve(null);
  const key = normalizePath(root);
  const repo = repos.get(key) ?? { running: null, triedAt: -Infinity, fetchedAt: null };
  repos.set(key, repo);
  if (repo.running) return repo.running;
  if (now - repo.triedAt < minutes * 60_000) return Promise.resolve(repo.fetchedAt);
  repo.triedAt = now;
  repo.running = gitFetch(root).then((outcome) => {
    repo.running = null;
    if (outcome === 'ok') repo.fetchedAt = new Date(now).toISOString();
    if (outcome === 'failed') log('warn', 'auto-fetch-failed', { root });
    return repo.fetchedAt;
  });
  return repo.running;
}
