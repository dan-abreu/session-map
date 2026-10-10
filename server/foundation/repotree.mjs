// The repository as a tree (id77), the base of the side panel that looks like the VS Code explorer. It is drawn from the
// census (counts, owners, what was left out) plus the file list git gives right now, so a file created a moment ago shows
// up before the next census, marked new and with null counts. It never reads file content: only names and `lstat`.
import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isSecretsFile } from '../files.mjs';
import { log } from '../log.mjs';
import { kindOfFile } from '../sources/count.mjs';

const run = promisify(execFile);
const GIT = { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
const LISTING_TTL_MS = 2000;
const OWNABLE = new Set(['code', 'screen']);
// absolute root -> { at, listing: Promise<string[]|null> }: the git listing, shared by every caller for 2 s.
const listings = new Map();

export function clearTreeCache() {
  listings.clear();
}

async function git(root, args) {
  try {
    return (await run('git', ['-c', 'core.quotepath=off', ...args], { ...GIT, cwd: root })).stdout;
  } catch (err) {
    log('warn', 'repotree-git', { command: args.join(' '), code: err.code ?? err.signal ?? null });
    return null;
  }
}

const split0 = (out) => out.split('\0').filter(Boolean);

// Tracked files plus those not yet tracked and not ignored. null when git cannot answer (not a repository, too slow).
async function gitList(root) {
  // Side by side: the two answers do not depend on each other.
  const [tracked, others = ''] = await Promise.all([git(root, ['ls-files', '-z']), git(root, ['ls-files', '-z', '-o', '--exclude-standard'])]);
  if (tracked === null) return null;
  return [...new Set([...split0(tracked), ...split0(others ?? '')])];
}

function listingOf(root, nowMs, list) {
  const hit = listings.get(root);
  if (hit && nowMs >= hit.at && nowMs - hit.at < LISTING_TTL_MS) return hit.listing;
  const listing = list(root);
  listings.set(root, { at: nowMs, listing });
  // A failed listing is not kept: the next call asks again.
  listing.then((v) => { if (v === null && listings.get(root)?.listing === listing) listings.delete(root); }, () => listings.delete(root));
  return listing;
}

const folderNode = (path) => ({
  type: 'folder', name: path.split('/').pop(), path, files: 0, lines: 0, chars: 0, grey: true, noOwner: false, new: false, children: [],
});

function fileNode(path, row) {
  const base = { type: 'file', name: path.split('/').pop(), path, new: false, noOwner: false };
  if (!row) return base;
  const counted = row.included;
  return {
    ...base, fileType: row.type, kind: row.kind, included: counted, reason: row.reason, grey: !counted, owner: row.owner ?? null,
    lines: counted ? row.lines.total : null, chars: counted ? row.chars : null,
    noOwner: counted && OWNABLE.has(row.kind) && !row.owner,
  };
}

// A file git sees that the census has not counted yet: size unknown, so counts are null. Names tell a left-out file.
function pendingNode(path) {
  const kind = isSecretsFile(path) ? 'secret' : kindOfFile(path);
  const out = kind === 'dep' || kind === 'generated' || kind === 'binary' || kind === 'secret';
  return {
    ...fileNode(path, null), fileType: null, kind, included: out ? false : null, reason: out ? kind : null,
    grey: out, owner: null, lines: null, chars: null, new: true,
  };
}

const isFile = (root, path) => {
  try { return lstatSync(join(root, path)).isFile(); } catch { return false; }
};

const byName = (a, b) => {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

// paths added to the statement after `since`; nothing is new without `since`.
function newByLog(log, since) {
  const set = new Set();
  if (!Number.isInteger(since)) return set;
  for (const line of Array.isArray(log) ? log : []) {
    if (line?.rev > since) for (const a of line.added ?? []) set.add(a.path);
  }
  return set;
}

// `project.fresh` is only totals; the paths come as an array or Set from whoever has the change rows.
const freshPaths = (fresh) => (fresh instanceof Set || Array.isArray(fresh) ? new Set(fresh) : new Set());

// root: the project folder. census: the last census.json. Options: since (a census rev), log (census-log lines),
// fresh (paths changed in the last minutes), nowMs (clock, for the 2 s listing cache), list (replaces the git listing).
export async function repoTree(root, census, { since, log: logLines, fresh, nowMs = Date.now(), list = gitList } = {}) {
  const rows = new Map(census.files.map((f) => [f.path, f]));
  const listed = await listingOf(root, nowMs, list);
  const nodes = new Map();
  for (const [path, row] of rows) {
    if (listed && !listedSet(listed).has(path)) continue;
    nodes.set(path, fileNode(path, row));
  }
  if (listed) {
    for (const path of listedSet(listed)) {
      if (!nodes.has(path) && isFile(root, path)) nodes.set(path, pendingNode(path));
    }
  }
  const marked = new Set([...newByLog(logLines, since), ...freshPaths(fresh)]);
  for (const path of marked) if (nodes.has(path)) nodes.get(path).new = true;

  const top = folderNode('');
  top.name = '';
  const folders = new Map([['', top]]);
  const folderOf = (dir) => {
    if (folders.has(dir)) return folders.get(dir);
    const node = folderNode(dir);
    folders.set(dir, node);
    folderOf(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '').children.push(node);
    return node;
  };
  for (const node of nodes.values()) folderOf(node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '').children.push(node);

  const finish = (folder) => {
    let owned = 0;
    let unowned = 0;
    let pending = false;
    let allGrey = true;
    let anyNew = false;
    for (const c of folder.children) {
      if (c.type === 'folder') {
        const r = finish(c);
        owned += r.owned; unowned += r.unowned; pending ||= r.pending; allGrey &&= c.grey; anyNew ||= c.new;
      } else {
        if (c.included && OWNABLE.has(c.kind)) { if (c.owner) owned++; else unowned++; }
        pending ||= c.included === null && !c.grey;
        allGrey &&= c.grey; anyNew ||= c.new;
      }
    }
    folder.children.sort(byName);
    const sums = folder.path === '' ? census.sums.total : census.sums.folders[folder.path];
    if (sums) { folder.files = sums.files; folder.lines = sums.lines.total; folder.chars = sums.chars; }
    else if (pending) { folder.files = null; folder.lines = null; folder.chars = null; }
    folder.grey = folder.children.length > 0 && allGrey;
    folder.noOwner = unowned > 0 && owned === 0;
    folder.new = anyNew;
    return { owned, unowned, pending };
  };
  finish(top);

  return {
    version: 1, generatedAt: new Date(nowMs).toISOString(), rev: census.rev, since: Number.isInteger(since) ? since : null,
    listing: listed ? 'git' : 'census', excluded: census.excluded, tree: top,
  };
}

// listed paths as a Set, built once per array.
const sets = new WeakMap();
function listedSet(listed) {
  let s = sets.get(listed);
  if (!s) { s = new Set(listed); sets.set(listed, s); }
  return s;
}
