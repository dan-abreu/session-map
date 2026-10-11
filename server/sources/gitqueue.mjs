// One door for every git process the server starts in the background. A git process costs 80-300 ms on Windows and a
// collect fired about 25 at once, so cheap calls queued inside the OS until their timeout killed them (git-too-slow).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.mjs';

export const GIT_LIMIT = 3;
// A folder git says is not a repository is believed this long instead of being asked on every pass.
export const NOT_REPO_TTL_MS = 60_000;
const NOT_REPO_RE = /not a git repository/i;
const COMMAND_MAX = 200;

const notRepoError = () => Object.assign(new Error('not a git repository (remembered)'), { code: 128 });

// run(cwd, args, opts) → {err, stdout}; never rejects. opts go to execFile; the timeout starts when the process does,
// not while it waits its turn. quiet: a too-big answer is expected there, not worth a warning.
export function createGitQueue({ limit = GIT_LIMIT, exec = execFile, notRepoTtlMs = NOT_REPO_TTL_MS, now = Date.now } = {}) {
  let running = 0;
  let spawned = 0;
  const waiting = [];
  const notRepo = new Map();

  const next = () => {
    if (running >= limit || !waiting.length) return;
    running++;
    waiting.shift()();
  };

  const knownNotRepo = (cwd) => {
    const until = notRepo.get(cwd);
    if (until === undefined) return false;
    // A folder that got a .git (git init) is asked again at once.
    if (until <= now() || existsSync(join(cwd, '.git'))) {
      notRepo.delete(cwd);
      return false;
    }
    return true;
  };

  function run(cwd, args, { quiet = false, ...opts } = {}) {
    const empty = opts.encoding === 'buffer' ? Buffer.alloc(0) : '';
    if (cwd && knownNotRepo(cwd)) return Promise.resolve({ err: notRepoError(), stdout: empty });
    return new Promise((resolve) => {
      waiting.push(() => {
        spawned++;
        const done = (err, stdout, stderr) => {
          running--;
          if (err && cwd && err.code === 128 && NOT_REPO_RE.test(String(stderr ?? ''))) notRepo.set(cwd, now() + notRepoTtlMs);
          const tooBig = err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          if (err && (tooBig ? !quiet : err.killed)) {
            log('warn', 'git-too-slow', { command: args.join(' ').slice(0, COMMAND_MAX), code: err.code ?? err.signal });
          }
          resolve({ err: err ?? null, stdout: err ? empty : stdout });
          next();
        };
        // A spawn that throws at once (bad cwd type) must still free its slot.
        try { exec('git', args, { cwd, windowsHide: true, ...opts }, done); } catch (err) { done(err, empty, ''); }
      });
      next();
    });
  }

  return { run, stats: () => ({ running, waiting: waiting.length, spawned }) };
}

const shared = createGitQueue();
export const runGit = shared.run;
// How many git processes the shared queue started so far: tests use it to see that a remembered answer spawns nothing.
export const gitStats = shared.stats;
