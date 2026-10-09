import { execFile } from 'node:child_process';
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
      unitIds: [],
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
      unitIds: [],
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
        unitIds: [],
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
