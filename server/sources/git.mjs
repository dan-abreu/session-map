import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lineCount } from './count.mjs';
import { log } from '../log.mjs';

const TIMEOUT_MS = 5000;
const REC = '\x01';
const FLD = '\x1f';
const END = '\x02';
const CO_AUTHOR_RE = /^co-authored-by:\s*(.*?)\s*(?:<[^>]*>)?\s*$/im;

// Any failure (no git, not a repo, timeout) becomes '' so callers see "nothing" instead of an exception.
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) log('warn', 'git-too-slow', { command: args[0], code: err.code ?? err.signal });
      resolve(err ? '' : stdout);
    });
  });
}

const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const iso = (unixSeconds) => new Date(Number(unixSeconds) * 1000).toISOString();
const authorOf = (name, email) => ({ name, email });

export async function gitRoot(cwd) {
  const out = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  return out || null;
}

// A linked worktree belongs to the project of its main checkout: its chats are branch work there, under the same map.
export async function projectRoot(cwd) {
  const top = await gitRoot(cwd);
  if (!top) return null;
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim().replace(/[\\/]+$/, '');
  const main = /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : null;
  return main && existsSync(main) ? main : top;
}

export async function listWorktrees(root) {
  const out = await git(root, ['worktree', 'list', '--porcelain']);
  return out.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const field = (key) => block.split(/\r?\n/).find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? '';
    return { path: field('worktree'), branch: field('branch').replace(/^refs\/heads\//, '') || null, head: field('HEAD') };
  });
}

export async function mainBranch(root) {
  for (const name of ['main', 'master']) {
    if ((await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).trim()) return name;
  }
  const head = (await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
  return head ? head.replace(/^origin\//, '') : null;
}

export async function aheadOf(root, branch, base) {
  const n = Number.parseInt(await git(root, ['rev-list', '--count', `${base}..${branch}`]), 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function lastCommit(path) {
  const out = (await git(path, ['log', '-1', `--format=%H${FLD}%s${FLD}%at`])).trim();
  if (!out) return null;
  const [hash, subject, ts] = out.split(FLD);
  return { hash, subject, ts: iso(ts) };
}

async function commitsOf(root, since) {
  const format = `${REC}%H${FLD}%an${FLD}%ae${FLD}%at${FLD}%P${FLD}%S${FLD}%s${FLD}%b${END}`;
  const args = ['log', '--all', '--source', '--name-only', ...(since ? [`--since=${since}`] : []), `--format=${format}`];
  const out = await git(root, args);
  return out.split(REC).filter(Boolean).map((rec) => {
    const [head, filesText = ''] = rec.split(END);
    const [hash, name, email, at, parents, source, subject, body = ''] = head.split(FLD);
    const coAuthor = CO_AUTHOR_RE.exec(body)?.[1];
    const item = {
      kind: parents.trim().split(/\s+/).filter(Boolean).length > 1 ? 'merge' : 'commit',
      ts: iso(at),
      hash,
      subject,
      branch: source.replace(/^refs\/(heads|remotes)\//, ''),
      author: authorOf(name, email),
      files: lines(filesText),
    };
    if (coAuthor) item.coAuthor = coAuthor;
    return item;
  });
}

async function tagsOf(root) {
  const format = ['%(refname:short)', '%(objectname)', '%(*objectname)', '%(creator)'].join(FLD);
  const out = await git(root, ['for-each-ref', '--sort=-creatordate', `--format=${format}`, 'refs/tags']);
  return lines(out).map((line) => {
    const [tag, object, peeled, creator] = line.split(FLD);
    const m = /^(.*?) <(.*?)> (\d+) /.exec(creator);
    return {
      kind: 'tag',
      ts: m ? iso(m[3]) : '',
      hash: peeled || object,
      subject: tag,
      branch: '',
      author: authorOf(m?.[1] ?? '', m?.[2] ?? ''),
    };
  });
}

// "update by push" entries in the remote-tracking reflogs; a push from another machine only shows after a fetch.
async function pushesOf(root) {
  const refs = lines(await git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/']));
  const items = [];
  for (const ref of refs) {
    if (ref.endsWith('/HEAD')) continue;
    const out = await git(root, ['reflog', 'show', `--format=%H${FLD}%gs${FLD}%ct${FLD}%gn${FLD}%ge`, ref]);
    for (const line of lines(out)) {
      const [hash, message, ts, name, email] = line.split(FLD);
      if (!/update by push/i.test(message)) continue;
      items.push({
        kind: 'push',
        ts: iso(ts),
        hash,
        branch: ref.replace(/^refs\/remotes\/[^/]+\//, ''),
        author: authorOf(name, email),
      });
    }
  }
  return items;
}

export async function activityOf(root, { since } = {}) {
  const [commits, tags, pushes] = await Promise.all([commitsOf(root, since), tagsOf(root), pushesOf(root)]);
  const cutoff = since ? Date.parse(since) : null;
  const recent = (i) => cutoff === null || Number.isNaN(cutoff) || Date.parse(i.ts) >= cutoff;
  return [...commits.filter(recent), ...tags.filter(recent), ...pushes.filter(recent)].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

const WORKTREE_MAX = 500;
const UNTRACKED_MAX_BYTES = 1024 * 1024;
const HASH_RE = /^[0-9a-f]{7,40}$/i;

const kindOfStatus = (xy) => {
  if (xy.includes('?') || xy.includes('A')) return 'create';
  if (xy.includes('R')) return 'rename';
  if (xy.includes('D')) return 'delete';
  return 'edit';
};

// Lines added and removed per path against the last saved version; a rename is keyed by its new path.
function numstat(out) {
  const stats = new Map();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]);
    if (!m) continue;
    let path = m[3];
    if (!path) { path = fields[i + 2]; i += 2; }
    stats.set(path, { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return stats;
}

function untrackedLines(root, path) {
  try {
    const st = statSync(join(root, path));
    if (!st.isFile() || st.size > UNTRACKED_MAX_BYTES) return 0;
    const buf = readFileSync(join(root, path));
    return buf.subarray(0, 8000).includes(0) ? 0 : lineCount(buf);
  } catch {
    return 0;
  }
}

// What is not saved yet in the project's folder (mm30): every edited, new, removed or renamed file, with its lines.
export async function workingTree(root) {
  const status = await git(root, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!status) return [];
  const stats = numstat(await git(root, ['-c', 'core.quotepath=off', 'diff', 'HEAD', '--numstat', '-z', '-M']));
  const out = [];
  const fields = status.split('\0');
  for (let i = 0; i < fields.length && out.length < WORKTREE_MAX; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    const path = field.slice(3);
    const kind = kindOfStatus(xy);
    const entry = { path, kind, ...(stats.get(path) ?? { added: kind === 'create' ? untrackedLines(root, path) : 0, removed: 0 }) };
    if (xy.includes('R')) entry.from = fields[++i];
    out.push(entry);
  }
  return out;
}

// The first version (tag) whose history holds the saved change: where that change was released. Ties in date go to the
// lower version number.
export async function firstTagWith(root, hash) {
  if (!HASH_RE.test(String(hash))) return null;
  const out = await git(root, ['tag', '--contains', hash, '--sort=v:refname', '--sort=creatordate', '--format=%(refname:short)']);
  return lines(out)[0] ?? null;
}
