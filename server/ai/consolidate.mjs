import { CONSOLIDATE_SCHEMA, consolidatePrompt } from './prompts.mjs';
import { cleanUnitName, sameName } from '../brain/names.mjs';
import { cleanTags, isEditable, newUnit, normalizeUnit } from './perceive.mjs';

const LEVELS = ['cell', 'tissue', 'organ'];
const PURPOSE_MAX = 160;
const PERCEPTIONS_PER_PASS = 5;
const DAY = 24 * 60 * 60 * 1000;
const AI_AUTHOR = { name: 'AI', email: '' };

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((id) => typeof id === 'string'))] : []);
const rank = (u) => LEVELS.indexOf(u.level ?? 'cell');

// Walks up from a unit; the seen set stops on a loop an older units.json may already hold.
function hasAncestor(byId, id, ancestors) {
  const seen = new Set();
  for (let p = byId.get(id)?.parentId; p != null && !seen.has(p); p = byId.get(p)?.parentId) {
    if (ancestors.includes(p)) return true;
    seen.add(p);
  }
  return false;
}

export const shouldConsolidate = (perceptionsSince, lastAtMs, now) =>
  perceptionsSince >= PERCEPTIONS_PER_PASS || (perceptionsSince > 0 && (lastAtMs == null || now - lastAtMs >= DAY));

// Keeps only the four known shapes, with the fields each one needs.
function shapeOf(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.kind === 'fuse') return { kind: 'fuse', ids: ids(c.ids), into: c.into };
  if (c.kind === 'group') return { kind: 'group', ids: ids(c.ids), name: cleanUnitName(c.name), purpose: text(c.purpose, PURPOSE_MAX), tags: cleanTags(c.tags) };
  if (c.kind === 'rename') return { kind: 'rename', id: c.id, name: cleanUnitName(c.name), purpose: text(c.purpose, PURPOSE_MAX) || null };
  if (c.kind === 'move') return { kind: 'move', id: c.id, parentId: c.parentId ?? null };
  return null;
}

// Every unit a change touches, including the parent it leaves, must exist and be free to change.
function isValid(units, c) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const free = (id) => isEditable(byId.get(id));
  const leftParentFree = (id) => byId.get(id).parentId == null || free(byId.get(id).parentId);
  switch (c.kind) {
    case 'fuse':
      return c.ids.length > 0 && !c.ids.includes(c.into) && free(c.into) && c.ids.every(free)
        && c.ids.every((id) => rank(byId.get(id)) === rank(byId.get(c.into)))
        // Same level should rule this out, but a tree saved before the level rule may not follow it.
        && !hasAncestor(byId, c.into, c.ids);
    case 'group': {
      if (c.ids.length < 2 || !c.name || !c.ids.every(free) || !c.ids.every(leftParentFree)) return false;
      const level = rank(byId.get(c.ids[0]));
      return level < LEVELS.length - 1 && c.ids.every((id) => rank(byId.get(id)) === level);
    }
    case 'rename':
      // Two units of one level with one name read as one on the map.
      return Boolean(c.name) && free(c.id)
        && !units.some((u) => u.id !== c.id && u.level === byId.get(c.id).level && sameName(u.name, c.name));
    case 'move':
      if (!free(c.id) || !leftParentFree(c.id)) return false;
      // Parents always sit at a higher level, so a move can never close a loop.
      return c.parentId === null || (free(c.parentId) && rank(byId.get(c.parentId)) > rank(byId.get(c.id)));
    default:
      return false;
  }
}

export async function consolidate(units, recentEvents, ask) {
  const prompt = consolidatePrompt(units, recentEvents);
  const res = await ask({ key: { kind: 'consolidate', prompt }, prompt, schemaHint: CONSOLIDATE_SCHEMA });
  if (!res.ok || !Array.isArray(res.value.changes)) return [];
  return res.value.changes.map(shapeOf).filter((c) => c && isValid(units, c));
}

const event = (kind, now, unitIds, subject) => ({ kind, ts: now, branch: null, author: AI_AUTHOR, unitIds, subject });
const union = (a, b) => [...new Set([...a, ...b])];

// Changes apply in order, each checked against the tree the previous ones left.
export function applyChanges(units, changes, now = new Date().toISOString()) {
  let next = units.map(normalizeUnit);
  const events = [];
  for (const c of changes) {
    if (!isValid(next, c)) continue;
    const byId = new Map(next.map((u) => [u.id, u]));
    if (c.kind === 'fuse') {
      const into = byId.get(c.into);
      for (const id of c.ids) {
        const gone = byId.get(id);
        into.chatIds = union(into.chatIds, gone.chatIds);
        into.paths = union(into.paths, gone.paths);
        into.tags = cleanTags(union(into.tags, gone.tags));
        for (const child of next) if (child.parentId === id) child.parentId = into.id;
      }
      next = next.filter((u) => !c.ids.includes(u.id));
      events.push(event('fused-by-meaning', now, [into.id, ...c.ids], into.name));
    } else if (c.kind === 'group') {
      const children = c.ids.map((id) => byId.get(id));
      const parents = new Set(children.map((u) => u.parentId));
      const level = rank(children[0]) + 1;
      const shared = parents.size === 1 ? byId.get(children[0].parentId) : null;
      const parentId = shared && rank(shared) > level ? shared.id : null;
      const named = (u) => u.level === LEVELS[level] && sameName(u.name, c.name) && isEditable(u);
      const parent = next.find(named) ?? newUnit(next, { ...c, level: LEVELS[level], parentId }, now);
      for (const child of children) child.parentId = parent.id;
      if (!next.includes(parent)) next.push(parent);
      events.push(event('grouped', now, [parent.id, ...c.ids], parent.name));
    } else if (c.kind === 'rename') {
      const u = byId.get(c.id);
      const before = u.name;
      u.name = c.name;
      if (c.purpose) u.purpose = c.purpose;
      events.push(event('renamed', now, [u.id], `${before} → ${u.name}`));
    } else {
      const u = byId.get(c.id);
      u.parentId = c.parentId;
      events.push(event('grouped', now, c.parentId ? [c.parentId, u.id] : [u.id], u.name));
    }
  }
  return { units: withoutEmptyGroups(next), events };
}


// A tissue or organ the AI made is only its members; once they all left, it is noise on the map.
function withoutEmptyGroups(units) {
  let next = units;
  for (;;) {
    const kept = next.filter((u) => u.level === 'cell' || u.pinned || u.origin !== 'ai' || u.chatIds.length || next.some((c) => c.parentId === u.id));
    if (kept.length === next.length) return next;
    next = kept;
  }
}
