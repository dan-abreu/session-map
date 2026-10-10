// The real footprint of a conversation (mm24): every project and part whose files it edited, its helpers and workflow agents
// included, and the ones it is only looking at. A project is the git repository a file lives in; a part, the one owning
// the file on that project's map.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LEFT_OUT, kindOfFile } from './sources/count.mjs';
import { normalizePath, relativeFiles, repoFiles, slash } from './paths.mjs';

const WORKTREE_RE = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/;
const ABSOLUTE_RE = /^([a-z]:)?\//i;
// \\host\share: looking one up makes Windows reach for that machine (seconds, and the user's sign-in sent to it).
const NETWORK_RE = /^[\\/]{2}/;

// ponytail: folders are remembered for the life of the server; a repository created later under a folder already
// seen is found after a restart.
const rootByDir = new Map();

function rootAt(dir) {
  const dotGit = join(dir, '.git');
  let st;
  try { st = statSync(dotGit, { throwIfNoEntry: false }); } catch { /* no access: not a repository we can read */ }
  if (!st) return undefined;
  if (st.isDirectory()) return dir;
  // A linked worktree's .git is a file pointing into the main checkout: its files are that project's.
  try {
    const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
    const main = gitdir && WORKTREE_RE.exec(gitdir)?.[1];
    if (main && statSync(main, { throwIfNoEntry: false })?.isDirectory()) return main;
  } catch { /* unreadable: the folder itself */ }
  return dir;
}

// The repository a file lives in, written or still to be written; null outside every repository.
export function gitRootOf(file) {
  if (NETWORK_RE.test(file)) return null;
  const start = dirname(slash(file));
  if (rootByDir.has(start)) return rootByDir.get(start);
  let found = null;
  for (let dir = start; ; dir = dirname(dir)) {
    const hit = rootAt(dir);
    if (hit !== undefined) { found = hit; break; }
    if (dirname(dir) === dir) break;
  }
  rootByDir.set(start, found);
  return found;
}

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

// root and cwd: where the conversation is listed and where it ran; edited: every file it and its helpers edited; seen:
// the paths its steps named. skip: folders whose files never count (the Claude folder, session-map's own).
// Returns rootKey → {root, edited: [repo path], seen: [repo path]}; seen leaves out folders, missing files and edited ones.
// The repository and repo path of a file a conversation named (file → {home, rel} | null): its own project first, then
// whichever repository the file lives in; never a skipped folder.
export function placer({ root, cwd, skip = [] }) {
  const skipped = skip.filter(Boolean).map((s) => normalizePath(s));
  return (file) => {
    const p = slash(file);
    if (NETWORK_RE.test(p)) return null;
    if (ABSOLUTE_RE.test(p) && skipped.some((s) => normalizePath(p).startsWith(`${s}/`))) return null;
    const own = repoFiles([p], root, cwd);
    if (own.length) return { home: root, rel: own[0] };
    if (!ABSOLUTE_RE.test(p)) return null;
    const other = gitRootOf(p);
    const rel = other && relativeFiles([p], [other])[0];
    return rel ? { home: other, rel } : null;
  };
}

export function touchesOf({ root, cwd, edited = [], seen = [], skip = [] }) {
  const out = new Map();
  const place = placer({ root, cwd, skip });
  const add = (hit, field) => {
    if (!hit || LEFT_OUT.includes(kindOfFile(hit.rel))) return;
    const key = normalizePath(hit.home);
    if (!out.has(key)) out.set(key, { root: hit.home, edited: new Set(), seen: new Set() });
    out.get(key)[field].add(hit.rel);
  };
  for (const f of edited) add(place(f), 'edited');
  for (const f of seen) {
    const hit = place(f);
    if (!hit || out.get(normalizePath(hit.home))?.edited.has(hit.rel)) continue;
    const abs = ABSOLUTE_RE.test(slash(f)) ? normalizePath(f) : join(cwd ?? root, f);
    if (isFile(abs)) add(hit, 'seen');
  }
  return new Map([...out].map(([key, t]) => [key, { root: t.root, edited: [...t.edited], seen: [...t.seen] }]));
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const byShare = (a, b) => b.share - a.share || b.edited - a.edited || b.seen - a.seen;

// touch: from touchesOf; homes: rootKey → {projectId, name, ownersOf(files) → [partId | null]} for the projects on the page.
// Shares are of every file the conversation edited (of what it looked at, when it edited nothing), so they add up to 1
// across projects; a file with no box counts for its project, not for a part. null when nothing lands on a known project.
export function footprintOf(touch, homes) {
  const places = [];
  for (const [key, t] of touch) {
    const home = homes.get(key);
    if (!home) continue;
    const parts = new Map();
    const tally = (files, field) => home.ownersOf(files).forEach((id) => {
      if (!id) return;
      const part = parts.get(id) ?? { partId: id, edited: 0, seen: 0 };
      part[field] += 1;
      parts.set(id, part);
    });
    tally(t.edited, 'edited');
    tally(t.seen, 'seen');
    places.push({ projectId: home.projectId, name: home.name, edited: t.edited.length, seen: t.seen.length, parts: [...parts.values()] });
  }
  const edited = places.reduce((n, p) => n + p.edited, 0);
  const field = edited ? 'edited' : 'seen';
  const total = places.reduce((n, p) => n + p[field], 0);
  if (!total) return null;
  const shared = places.map((p) => ({
    projectId: p.projectId, name: p.name, edited: p.edited, seen: p.seen, share: round3(p[field] / total),
    parts: p.parts.map((x) => ({ ...x, share: round3(x[field] / total) })).sort(byShare),
  }));
  return { edited, places: shared.sort(byShare) };
}
