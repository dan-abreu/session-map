import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from '../paths.mjs';
import { UNSORTED, assertSafeName, isBroadPath, plain, readJsonFile, relativeFiles, slash, unitsTouchedBy, writeAtomic } from './cells.mjs';

const MAX_WEIGHT = 4;
const SPEC_TERM_MIN = 4;
// One passing mention in a long spec is not a dependency.
const SPEC_MENTIONS_MIN = 2;
const SPEC_DEPTH_MAX = 3;
// A tag more units carry than this is the project's vocabulary, not a shared subject.
const RARE_TAG_UNITS = 3;
const CHAT_LINKS_MAX = 3;
// openspec/specs/<unit>/… and openspec/changes/<change>/specs/<unit>/…: the folder names the unit.
const SPEC_AREA_RE = /^openspec\/(?:changes\/(?:archive\/)?[^/]+\/)?specs\/([^/]+)\//;

const lineagePath = (smDir) => join(smDir, 'lineage.json');

export function readLineage(smDir) {
  const stored = readJsonFile(lineagePath(smDir), {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

// Written by the "continue here" action: the new chat (child) descends from the chat it was built from.
export function recordLineage(smDir, childId, parentId) {
  if (childId === parentId) throw new Error('a chat cannot descend from itself');
  writeAtomic(lineagePath(smDir), `${JSON.stringify({ ...readLineage(smDir), [childId]: parentId }, null, 2)}\n`);
}

// chatsOfCell: the chats of the same unit as `{sessionId, startedAt, editedFiles}`.
export function parentOf(sessionId, lineage, chatsOfCell) {
  const recorded = lineage?.[sessionId];
  if (typeof recorded === 'string' && recorded && recorded !== sessionId) return recorded;
  const chat = chatsOfCell.find((c) => c.sessionId === sessionId);
  if (!chat) return null;
  const mine = new Set(chat.editedFiles ?? []);
  const born = Date.parse(chat.startedAt);
  let best = null;
  for (const other of chatsOfCell) {
    const at = Date.parse(other.startedAt);
    if (other.sessionId === sessionId || !(at < born)) continue;
    if (!(other.editedFiles ?? []).some((f) => mine.has(f))) continue;
    if (!best || at > best.at) best = { id: other.sessionId, at };
  }
  return best?.id ?? null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Specs often sit one level down (openspec/specs/<area>/<capability>/spec.md).
function specFilesUnder(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    if (e.isFile() && e.name === 'spec.md') return [join(dir, e.name)];
    return e.isDirectory() && depth < SPEC_DEPTH_MAX ? specFilesUnder(join(dir, e.name), depth + 1) : [];
  });
}

// A unit's specs that name another unit (by id or name, as a whole word, at least twice) link the two.
export function specRefsOf(root, units) {
  const targets = units
    .filter((u) => u.id !== UNSORTED)
    .map((u) => ({ id: u.id, terms: [...new Set([u.id, u.name].map(plain))].filter((t) => t.length >= SPEC_TERM_MIN) }));
  const refs = [];
  for (const from of units) {
    let dir;
    try { dir = join(root, 'openspec', 'specs', assertSafeName(from.id, 'unit id')); } catch { continue; }
    const files = specFilesUnder(dir);
    if (!files.length) continue;
    const text = plain(files.map((f) => readFileSync(f, 'utf8')).join('\n'));
    const since = new Date(Math.max(...files.map((f) => statSync(f).mtimeMs))).toISOString();
    for (const to of targets) {
      if (to.id === from.id) continue;
      const mentions = to.terms.reduce((n, t) => n + (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'gu'))?.length ?? 0), 0);
      if (mentions >= SPEC_MENTIONS_MIN) refs.push({ from: from.id, to: to.id, since });
    }
  }
  return refs;
}

// Worktrees usually sit beside the repo (C:/dev/proj-feature for C:/dev/proj), and removed ones are not listed
// anywhere: a folder named that way is read as the same code checked out again.
function checkoutsOf(files, root) {
  if (!root) return [];
  const prefix = `${normalizePath(root)}-`;
  const found = new Set();
  for (const f of files) {
    const p = normalizePath(slash(f));
    const end = p.startsWith(prefix) ? p.indexOf('/', prefix.length) : -1;
    if (end > 0) found.add(p.slice(0, end));
  }
  return [...found];
}

// The edited files as repo paths, whichever checkout of the repo they were edited in.
export function repoFiles(files, root, cwd) {
  return relativeFiles(files, [root, cwd, ...checkoutsOf(files, root)]);
}

// A unit's broad paths (a whole app) count only when they are all it has: beside specific ones they match any work.
function linkableUnits(units) {
  return units.map((u) => {
    const paths = u.paths ?? [];
    const specific = paths.filter((p) => !isBroadPath(p));
    return { id: u.id, paths: specific.length ? specific : paths };
  });
}

// A chat that swept across many units (a cleanup, a round of fixes) links its own only to those it edited most.
function unitsEditedMost(files, linkable, known, own) {
  const count = new Map();
  for (const f of files) {
    const ids = new Set(unitsTouchedBy([f], linkable));
    const area = SPEC_AREA_RE.exec(f)?.[1];
    if (known.has(area)) ids.add(area);
    for (const id of ids) if (known.has(id) && id !== own) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return [...count].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).slice(0, CHAT_LINKS_MAX).map(([id]) => id);
}

// Tags two or three units share, never the ones most units carry.
function sharedTags(units, known) {
  const holders = new Map();
  for (const u of units) {
    if (!known.has(u.id)) continue;
    for (const tag of new Set((u.tags ?? []).map(plain).filter(Boolean))) holders.set(tag, [...(holders.get(tag) ?? []), u]);
  }
  const pairs = new Map();
  for (const [tag, us] of holders) {
    if (us.length < 2 || us.length > RARE_TAG_UNITS) continue;
    for (const x of us) for (const y of us) {
      if (x.id >= y.id) continue;
      const pair = pairs.get(`${x.id}\n${y.id}`) ?? { x, y, tags: [] };
      pair.tags.push(tag);
      pairs.set(`${x.id}\n${y.id}`, pair);
    }
  }
  return [...pairs.values()];
}

// Chats need `editedFiles`, `cwd` and `workCellId` besides the Chat fields; specRefs come from specRefsOf;
// related are the pairs the AI noticed ({a, b, text, since}).
export function linkUnits(chats, units, workCells, specRefs, { root, related = [] } = {}) {
  const known = new Set(units.map((u) => u.id).filter((id) => id !== UNSORTED));
  const nameOf = new Map(units.map((u) => [u.id, u.name]));
  const parentById = new Map(units.map((u) => [u.id, u.parentId ?? null]));
  const holds = (outer, inner) => {
    const seen = new Set();
    for (let p = parentById.get(inner); p != null && !seen.has(p); p = parentById.get(p)) {
      if (p === outer) return true;
      seen.add(p);
    }
    return false;
  };
  const linkable = linkableUnits(units);
  const links = new Map();
  // A cell and the tissue or organ holding it are already drawn one inside the other.
  const add = (x, y, since, reason) => {
    if (x === y || !known.has(x) || !known.has(y) || holds(x, y) || holds(y, x)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const link = links.get(`${a}\n${b}`) ?? { a, b, since, reasons: [] };
    if (Date.parse(since) < Date.parse(link.since) || Number.isNaN(Date.parse(link.since))) link.since = since;
    link.reasons.push(reason);
    links.set(`${a}\n${b}`, link);
  };
  const pairs = (ids, since, reason) => {
    for (const x of ids) for (const y of ids) if (x < y) add(x, y, since, reason);
  };

  // From the unit the work belongs to when it has one; otherwise every pair of the units it touched.
  const fan = (from, ids, since, reason) => {
    if (known.has(from)) for (const id of ids) add(from, id, since, reason);
    else pairs([...ids], since, reason);
  };

  const chatById = new Map(chats.map((c) => [c.sessionId, c]));
  for (const chat of chats) {
    const files = repoFiles(chat.editedFiles ?? [], root, chat.cwd);
    fan(chat.unitId, unitsEditedMost(files, linkable, known, chat.unitId), chat.startedAt, { kind: 'shared-chat', text: chat.title, sessionId: chat.sessionId });
    const parent = chatById.get(chat.parentId);
    if (parent) add(chat.unitId, parent.unitId, chat.startedAt, { kind: 'lineage', text: chat.title, sessionId: chat.sessionId });
  }
  for (const cell of workCells) {
    const ids = new Set([...(cell.touches ?? []), ...(cell.chatIds ?? []).map((id) => chatById.get(id)?.unitId)].filter((id) => known.has(id)));
    fan(cell.unitId, ids, cell.bornAt, { kind: 'shared-branch', text: cell.branch });
  }
  for (const ref of specRefs) {
    add(ref.from, ref.to, ref.since, { kind: 'spec-ref', text: `${nameOf.get(ref.from)} → ${nameOf.get(ref.to)}` });
  }
  for (const { x, y, tags } of sharedTags(units, known)) {
    // The link exists once both units do.
    add(x.id, y.id, [x.bornAt, y.bornAt].filter(Boolean).sort().at(-1), { kind: 'meaning', text: tags.map((t) => `#${t}`).join(' ') });
  }
  for (const r of related) add(r.a, r.b, r.since, { kind: 'meaning', text: r.text });

  return [...links.values()]
    .map((l) => ({ ...l, weight: Math.min(l.reasons.length, MAX_WEIGHT) }))
    .sort((p, q) => q.weight - p.weight || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}
