// Hangs the project's work on the parts of its architecture (desenho-3 § 2): conversations by the item codes they
// cite or the files they edit, branches and commits by the files they change. Pure: no disk, no git.
import { isUserWho, key } from './parse.mjs';

const GLOB_RE = /[*?[{]/;
const CONTAINERS = new Set(['apps', 'packages', 'services', 'libs', 'modules', 'crates', 'projects', 'plugins', 'tools']);
const SOURCE_ROOTS = new Set(['src', 'lib', 'app', 'source', 'sources', 'internal']);

// A top-level folder, or a whole app in a monorepo (apps/backend-api, and its src): true of almost any work, so it says little.
function isBroad(segments) {
  const parts = [...segments];
  while (parts.length > 1 && SOURCE_ROOTS.has(parts.at(-1).toLowerCase())) parts.pop();
  return parts.length <= 1 || (parts.length === 2 && CONTAINERS.has(parts[0].toLowerCase()));
}

// "Where in the code" mixes repo paths, paths relative to an app named a line above, globs and page routes ("/panel/*").
function segmentsOf(path) {
  let p = String(path).trim().replaceAll('\\', '/').toLowerCase().replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.includes('://')) return null;
  const glob = p.search(GLOB_RE);
  if (glob >= 0) p = p.slice(0, glob).replace(/[^/]*$/, '');
  p = p.replace(/[#:].*$/, '').replace(/\/+$/, '');
  const segments = p.split('/').filter(Boolean);
  return segments.length ? segments : null;
}

// Candidates per part: {segments, anchored, broad}. A path is anchored when it starts at a top-level folder of the repo
// (all are, when the folders are not known); one that does not is read under each of the part's own anchored folders,
// and anywhere in the repo as well.
function candidatesOf(part, topLevel) {
  const paths = [...part.codePaths, part.file].map(segmentsOf).filter(Boolean);
  const isAnchored = (s) => !topLevel || topLevel.has(s[0]);
  const roots = paths.filter((s) => isAnchored(s) && !s.at(-1).includes('.'));
  const out = [];
  for (const s of paths) {
    if (isAnchored(s)) {
      out.push({ segments: s, anchored: true, broad: isBroad(s) });
      continue;
    }
    for (const r of roots) out.push({ segments: [...r, ...s], anchored: true, broad: false });
    out.push({ segments: s, anchored: false, broad: s.length <= 1 });
  }
  return out;
}

function depthIn(file, c) {
  const n = c.segments.length;
  const eq = (offset) => c.segments.every((seg, i) => file[offset + i] === seg);
  if (c.anchored) return file.length >= n && eq(0) ? n : 0;
  for (let offset = 0; offset + n <= file.length; offset++) if (eq(offset)) return n;
  return 0;
}

// For each file, the parts holding its deepest matching path (several on a tie) and whether that path is broad.
function bestByFile(files, arch, topLevel) {
  const cands = arch.parts.map((p) => ({ id: p.id, list: candidatesOf(p, topLevel) }));
  return files.map((f) => {
    const file = String(f).replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean);
    let best = null;
    for (const { id, list } of cands) {
      for (const c of list) {
        const depth = depthIn(file, c);
        if (!depth) continue;
        if (!best || depth > best.depth) best = { depth, broad: c.broad, ids: new Set([id]) };
        else if (depth === best.depth) {
          best.ids.add(id);
          best.broad &&= c.broad;
        }
      }
    }
    return best;
  }).filter(Boolean);
}

const inPartOrder = (arch, ids) => arch.parts.map((p) => p.id).filter((id) => ids.has(id));

// files: paths relative to the project root. A tie at the top places nothing; votes through a broad path count only
// when no file reached a specific one.
export function partOfFiles(files, arch, { topLevel } = {}) {
  const specific = new Map();
  const broad = new Map();
  const touched = new Set();
  for (const best of bestByFile(files, arch, topLevel)) {
    for (const id of best.ids) {
      const votes = best.broad ? broad : specific;
      votes.set(id, (votes.get(id) ?? 0) + 1);
      touched.add(id);
    }
  }
  const votes = specific.size ? specific : broad;
  const top = Math.max(0, ...votes.values());
  const leaders = [...votes].filter(([, v]) => v === top).map(([id]) => id);
  const partId = leaders.length === 1 ? leaders[0] : null;
  touched.delete(partId);
  return { partId, touches: inPartOrder(arch, touched) };
}

export function partsTouched(files, arch, { topLevel } = {}) {
  return inPartOrder(arch, new Set(bestByFile(files, arch, topLevel).flatMap((b) => [...b.ids])));
}

// mentions: [{code, n}] in the order of their last mention. A tie goes to the part cited last.
export function partByCodes(mentions, arch) {
  const owner = new Map();
  for (const p of arch.parts) for (const g of p.groups) for (const i of g.items) if (i.code) owner.set(key(i.code), p.id);
  const score = new Map();
  (mentions ?? []).forEach(({ code, n }, at) => {
    const id = owner.get(key(String(code)));
    if (!id) return;
    const s = score.get(id) ?? { n: 0, at };
    score.set(id, { n: s.n + n, at });
  });
  let best = null;
  for (const [id, s] of score) if (!best || s.n > best.n || (s.n === best.n && s.at > best.at)) best = { id, ...s };
  return best?.id ?? null;
}

export function attachToParts(arch, chats, workCells) {
  return {
    ...arch,
    parts: arch.parts.map((p) => ({
      ...p,
      chatIds: chats.filter((c) => c.partId === p.id).map((c) => c.sessionId),
      workCellIds: workCells.filter((w) => w.partId === p.id && w.status !== 'merged').map((w) => w.id),
    })),
  };
}

// "Waiting for you": open items whose owner is a person, not Claude alone.
export function waitingItems(arch, projectId) {
  return arch.parts.flatMap((p) => p.groups.flatMap((g) => g.items
    .filter((i) => i.status !== 'done' && isUserWho(i.who))
    .map((i) => ({ kind: 'item', text: i.title, projectId, sessionId: null, partId: p.id, code: i.code, status: i.status, who: i.who, weight: i.weight, milestone: i.milestone }))));
}
