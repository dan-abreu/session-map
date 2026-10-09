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
  const configured = safeRelative(config.architecture);
  const candidates = [...(configured ? [configured] : []), ...DEFAULT_DIRS.filter((d) => d !== configured)];
  for (const dir of candidates) {
    const files = fromWorktree(root, dir);
    if (files) return { source: 'worktree', dir, files };
  }
  const branch = mainBranch ?? (await mainBranchName(root, exec));
  if (branch) {
    for (const dir of candidates) {
      const files = await fromBranch(root, branch, dir, exec);
      if (files) return { source: 'main-branch', dir, files };
    }
  }
  return { source: 'none', dir: null, files: {} };
}

export async function readArch(root, config, opts) {
  const { source, dir, files } = await detectArch(root, config, opts);
  return parseArch(dir, files, source);
}
