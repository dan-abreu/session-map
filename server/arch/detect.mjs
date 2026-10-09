import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArch } from './parse.mjs';

const DEFAULT_DIRS = ['docs/arquitetura', 'docs/architecture', 'docs/arch'];
const MAX_FILE_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

// Same contract as git.mjs: any failure becomes '' so "no such folder" is just an empty answer.
function defaultExec(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// A configured folder is relative to the project and must stay inside it.
function safeRelative(path) {
  if (typeof path !== 'string') return null;
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!p || /^([a-z]:|\/)/i.test(p) || p.split('/').includes('..')) return null;
  return p;
}

function fromWorktree(root, dir) {
  let names;
  try {
    if (!statSync(join(root, dir)).isDirectory()) return null;
    names = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return null;
  }
  const files = {};
  for (const e of names) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const path = join(root, dir, e.name);
    if (statSync(path).size > MAX_FILE_BYTES) continue;
    files[e.name] = readFileSync(path, 'utf8');
  }
  return files;
}

async function mainBranchName(root, exec) {
  for (const name of ['main', 'master']) {
    if ((await exec(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).trim()) return name;
  }
  return null;
}

// Work on branches often leaves the local main behind origin/main: read origin/main unless the local one has commits it lacks.
async function branchHeads(root, branch, exec) {
  const out = await exec(root, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/${branch}`, `refs/remotes/origin/${branch}`]);
  const heads = { local: null, remote: null };
  for (const line of out.split(/\r?\n/)) {
    const [ref, hash] = line.trim().split(' ');
    if (ref === `refs/heads/${branch}`) heads.local = hash;
    if (ref === `refs/remotes/origin/${branch}`) heads.remote = hash;
  }
  return heads;
}

async function freshestRef(root, branch, exec, heads) {
  if (!heads.remote || heads.local === heads.remote) return branch;
  if (!heads.local) return `origin/${branch}`;
  const localOnly = Number.parseInt(await exec(root, ['rev-list', '--count', `origin/${branch}..${branch}`]), 10);
  return localOnly === 0 ? `origin/${branch}` : branch;
}

async function fromBranch(root, branch, dir, exec) {
  const listing = await exec(root, ['ls-tree', '-z', '--name-only', `${branch}:${dir}`]);
  const names = listing.split('\0').filter((n) => /\.md$/i.test(n));
  if (!names.length) return null;
  const files = {};
  for (const name of names) {
    const text = await exec(root, ['show', `${branch}:${dir}/${name}`]);
    if (text && text.length <= MAX_FILE_BYTES) files[name] = text;
  }
  return files;
}

// Finds the architecture folder: the configured one, else the first conventional name; work tree first, then main branch.
export async function detectArch(root, config = {}, { exec = defaultExec, mainBranch = null } = {}) {
  const candidates = candidatesOf(config);
  for (const dir of candidates) {
    const files = fromWorktree(root, dir);
    if (files) return { source: 'worktree', dir, files };
  }
  const branch = mainBranch ?? (await mainBranchName(root, exec));
  if (branch) {
    const ref = await freshestRef(root, branch, exec, await branchHeads(root, branch, exec));
    for (const dir of candidates) {
      const files = await fromBranch(root, ref, dir, exec);
      if (files) return { source: 'main-branch', dir, files };
    }
  }
  return { source: 'none', dir: null, files: {} };
}

function candidatesOf(config) {
  const configured = safeRelative(config?.architecture);
  return [...(configured ? [configured] : []), ...DEFAULT_DIRS.filter((d) => d !== configured)];
}

// Name, time and size of each markdown file: editing, adding or removing one changes it; null when the folder is missing.
function folderStamp(root, dir) {
  try {
    if (!statSync(join(root, dir)).isDirectory()) return null;
    return readdirSync(join(root, dir), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.md$/i.test(e.name))
      .map((e) => {
        const s = statSync(join(root, dir, e.name));
        return `${e.name}:${s.mtimeMs}:${s.size}`;
      }).sort().join('|');
  } catch {
    return null;
  }
}

const memo = new Map();

// What collect calls every few seconds: the files are read and parsed again only when the folder changed (desenho-3 § 3).
// On the main branch the stamp is the commits of main and origin/main: one git call per read instead of a show per file.
export async function readArch(root, config, opts = {}) {
  const exec = opts.exec ?? defaultExec;
  const candidates = candidatesOf(config);
  let stamp = null;
  for (const dir of candidates) {
    const s = folderStamp(root, dir);
    if (s !== null) { stamp = `worktree|${dir}|${s}`; break; }
  }
  let mainBranch = opts.mainBranch ?? null;
  if (stamp === null) {
    mainBranch ??= await mainBranchName(root, exec);
    const heads = mainBranch ? await branchHeads(root, mainBranch, exec) : {};
    stamp = `branch|${mainBranch}|${heads.local}|${heads.remote}`;
  }
  const key = `${root}|${candidates.join('|')}`;
  const hit = memo.get(key);
  if (hit?.stamp === stamp) return hit.arch;
  const { source, dir, files } = await detectArch(root, config, { exec, mainBranch });
  const arch = parseArch(dir, files, source);
  memo.set(key, { stamp, arch });
  return arch;
}
