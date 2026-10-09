import { execFile } from 'node:child_process';
import { log } from '../log.mjs';
import { listWorktrees } from '../sources/git.mjs';
import { UNSORTED, covers, isBroadPath, slash } from './cells.mjs';

const TIMEOUT_MS = 10_000;
const IDLE_AFTER_MS = 7 * 86_400_000;
const FLD = '\x1f';

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) log('warn', 'git-too-slow', { command: args[0], code: err.code ?? err.signal });
      resolve({ ok: !err, out: err ? '' : stdout });
    });
  });
}

const git = async (cwd, args) => (await run(cwd, args)).out;
const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const toIso = (s) => new Date(s).toISOString();
const isAncestor = async (root, commit, of) => (await run(root, ['merge-base', '--is-ancestor', commit, of])).ok;

async function resolveRef(root, ref) {
  return (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || null;
}

// When origin/<main> is ahead of the local main (not pulled yet), it is the better picture of the body.
async function baseOf(root, main) {
  const local = `refs/heads/${main}`;
  if (!(await resolveRef(root, local))) return null;
  const remote = `refs/remotes/origin/${main}`;
  return (await resolveRef(root, remote)) && (await isAncestor(root, local, remote)) ? remote : local;
}

async function branchesOf(root, main, includeRemote) {
  const refs = lines(await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', ...(includeRemote ? ['refs/remotes/origin'] : [])]));
  const local = new Set(refs.filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice('refs/heads/'.length)));
  const out = [];
  for (const ref of refs) {
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.slice('refs/heads/'.length);
      if (branch !== main) out.push({ id: branch, branch, remote: false, ref });
      continue;
    }
    const branch = ref.slice('refs/remotes/origin/'.length);
    // The remote copy of a local branch is the same work: the local one represents it.
    if (branch !== 'HEAD' && branch !== main && !local.has(branch)) out.push({ id: `origin/${branch}`, branch, remote: true, ref });
  }
  return out;
}

async function filesOf(root, from, to) {
  const parts = (await git(root, ['diff', '--name-status', '--no-renames', '-z', from, to])).split('\0');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i] === 'A' || parts[i] === 'D' ? parts[i] : 'M';
    files.push({ path: parts[i + 1], status });
  }
  return files;
}

function ownerOf(commits) {
  const byEmail = new Map();
  for (const c of commits) {
    const entry = byEmail.get(c.email) ?? { author: { name: c.name, email: c.email }, count: 0 };
    entry.count += 1;
    byEmail.set(c.email, entry);
  }
  const authors = [...byEmail.values()];
  const owner = authors.reduce((best, a) => (a.count > best.count ? a : best)).author;
  return { owner, authors: authors.map((a) => a.author) };
}

// Each file votes for the unit whose path covers it most deeply. Votes through a broad path
// (apps/backend-api) count only when no file reached a specific one; a tie at the top leaves the branch unsorted.
export function placeWorkCell(files, units) {
  const specific = new Map();
  const broad = new Map();
  const add = (votes, id, w) => votes.set(id, (votes.get(id) ?? 0) + w);
  for (const { path } of files) {
    let best = null;
    for (const u of units) {
      for (const p of u.paths ?? []) {
        const prefix = slash(p).replace(/\/+$/, '');
        if (!prefix || !covers(path, prefix)) continue;
        const depth = prefix.split('/').length;
        if (!best || depth > best.depth) best = { depth, prefix, ids: new Set([u.id]) };
        else if (depth === best.depth) best.ids.add(u.id);
      }
    }
    if (!best) continue;
    for (const id of best.ids) add(isBroadPath(best.prefix) ? broad : specific, id, 1);
  }
  const votes = specific.size ? specific : broad;
  const top = Math.max(0, ...votes.values());
  const leaders = [...votes].filter(([, v]) => v === top).map(([id]) => id);
  const unitId = leaders.length === 1 ? leaders[0] : UNSORTED;
  const touched = new Set([...specific.keys(), ...broad.keys()]);
  return { unitId, touches: units.map((u) => u.id).filter((id) => id !== unitId && touched.has(id)) };
}

async function cellOf(root, base, branch, units, worktrees, now) {
  const format = ['%H', '%an', '%ae', '%aI', '%s'].join(FLD);
  const commits = lines(await git(root, ['log', `--format=${format}`, branch.ref, '--not', base])).map((line) => {
    const [hash, name, email, ts, subject] = line.split(FLD);
    return { hash, name, email, ts: toIso(ts), subject };
  });
  if (!commits.length) return null;
  const mergeBase = (await git(root, ['merge-base', base, branch.ref])).trim();
  const files = mergeBase ? await filesOf(root, mergeBase, branch.ref) : [];
  const [last] = commits;
  return {
    id: branch.id,
    branch: branch.branch,
    remote: branch.remote,
    path: branch.remote ? null : worktrees.get(branch.branch) ?? null,
    ...ownerOf(commits),
    ...placeWorkCell(files, units),
    ahead: commits.length,
    commits: commits.length,
    files,
    nucleus: { doing: null, todo: [] },
    openspec: null,
    chatIds: [],
    estimateUSD: null,
    costUSD: 0,
    lastCommit: { hash: last.hash, subject: last.subject, ts: last.ts },
    status: now - Date.parse(last.ts) > IDLE_AFTER_MS ? 'idle' : 'active',
    bornAt: commits.at(-1).ts,
    mergedAt: null,
    clashWith: [],
  };
}

// When `commit` reached the body: the first commit of base's first-parent line that contains it (merge),
// or its own commit time when it sits on that line (fast-forward, rebase). null when it is not in base.
async function mergedAtOf(root, commit, base) {
  const hash = await resolveRef(root, commit);
  if (!hash || !(await isAncestor(root, hash, base))) return null;
  const landing = lines(await git(root, ['log', '--first-parent', '--ancestry-path', `--format=%P${FLD}%cI`, `${hash}..${base}`])).at(-1);
  if (landing) {
    const [parents, ts] = landing.split(FLD);
    if (parents.split(' ')[0] !== hash) return toIso(ts);
  }
  return toIso((await git(root, ['log', '-1', '--format=%cI', hash])).trim());
}

// previous: the cells of the last call; one that stopped being ahead comes back once as 'merged' if its head reached the body.
export async function workCellsOf(root, units, { main, includeRemote = true, previous = [], now = Date.now() } = {}) {
  const base = main ? await baseOf(root, main) : null;
  if (!base) return [];
  const worktrees = new Map((await listWorktrees(root)).filter((t) => t.branch).map((t) => [t.branch, t.path]));
  const branches = await branchesOf(root, main, includeRemote);
  // One branch at a time: three git processes per branch, and a repo can have hundreds of branches.
  const alive = [];
  for (const branch of branches) {
    const cell = await cellOf(root, base, branch, units, worktrees, now);
    if (cell) alive.push(cell);
  }

  // A branch nobody touched for a week (an old bot update, an abandoned try) sharing a file is not news.
  for (const cell of alive) {
    const mine = new Set(cell.files.map((f) => f.path));
    cell.clashWith = cell.status !== 'active' ? [] : alive
      .filter((o) => o !== cell && o.status === 'active' && o.files.some((f) => mine.has(f.path)))
      .map((o) => o.id);
  }

  const aliveIds = new Set(alive.map((c) => c.id));
  const merged = [];
  for (const prev of previous) {
    if (prev.status === 'merged' || aliveIds.has(prev.id)) continue;
    const ref = prev.remote ? `refs/remotes/origin/${prev.branch}` : `refs/heads/${prev.branch}`;
    const head = (await resolveRef(root, ref)) ?? prev.lastCommit?.hash;
    const mergedAt = head ? await mergedAtOf(root, head, base) : null;
    if (mergedAt) merged.push({ ...prev, status: 'merged', ahead: 0, mergedAt, clashWith: [] });
  }
  return [...alive, ...merged];
}

export function detectTransitions(prev, next, now) {
  const before = new Map(prev.map((c) => [c.id, c]));
  const transitions = [];
  for (const cell of next) {
    const old = before.get(cell.id);
    if (cell.status === 'merged') {
      if (old && old.status !== 'merged') transitions.push({ kind: 'fused', workCellId: cell.id, ts: cell.mergedAt ?? now });
    } else if (!old) {
      transitions.push({ kind: 'born', workCellId: cell.id, ts: cell.bornAt ?? now });
    }
  }
  return transitions;
}

function branchNameOf(subject, secondParent) {
  const m = /^Merge branch '([^']+)'/.exec(subject)
    ?? /^Merge remote-tracking branch '(?:origin\/)?([^']+)'/.exec(subject)
    ?? /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  return m ? m[1] : `merge-${secondParent.slice(0, 7)}`;
}

// History from before installation: each merge commit on main's first-parent line is a cell born at its
// oldest merged commit and fused at the merge. A rebase-only flow leaves no trace here.
// since bounds the walk: one git call per merge would stall the first page load on a long history.
export async function backfillMerges(root, main, { since } = {}) {
  const window = since ? [`--since=${since}`] : [];
  const out = await git(root, ['log', '--merges', '--first-parent', ...window, `--format=%P${FLD}%cI${FLD}%s`, `refs/heads/${main}`]);
  const events = [];
  for (const line of lines(out)) {
    const [parents, mergedAt, subject] = line.split(FLD);
    const [first, second] = parents.split(' ');
    const workCellId = branchNameOf(subject, second);
    const bornAt = lines(await git(root, ['log', '--format=%aI', `${first}..${second}`])).at(-1);
    if (bornAt) events.push({ kind: 'born', workCellId, ts: toIso(bornAt) });
    events.push({ kind: 'fused', workCellId, ts: toIso(mergedAt) });
  }
  return events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (b.kind === 'born') - (a.kind === 'born'));
}
