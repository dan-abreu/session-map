import { UNSORTED, newUnitId } from '../brain/cells.mjs';
import { cleanUnitName, plain, readableName, sameName } from '../brain/names.mjs';
import { PERCEIVE_SCHEMA, perceivePrompt } from './prompts.mjs';

const PURPOSE_MAX = 160;
const TAG_MAX = 24;
const TAGS_MAX = 5;
const PATHS_MAX = 20;

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    const t = text(tag, TAG_MAX).toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, TAGS_MAX);
}

// units.json rows written before the AI existed have only {id, name, paths}.
export const normalizeUnit = (u) => ({
  level: 'cell', parentId: null, purpose: '', tags: [], origin: 'seed', pinned: false, paths: [], chatIds: [],
  ...u,
  tags: [...(u.tags ?? [])], paths: [...(u.paths ?? [])], chatIds: [...(u.chatIds ?? [])],
});

export const isEditable = (u) => u && u.id !== UNSORTED && !u.pinned;

export function newUnit(units, { name, purpose, tags, level = 'cell', parentId = null }, now) {
  return { id: newUnitId(name, units), level, parentId, name, purpose, tags, origin: 'ai', pinned: false, paths: [], chatIds: [], bornAt: now };
}

export async function perceive(digest, units, ask) {
  const res = await ask({ key: { kind: 'perceive', digest }, prompt: perceivePrompt(digest, units), schemaHint: PERCEIVE_SCHEMA });
  if (!res.ok) return null;
  const v = res.value;
  const name = cleanUnitName(v.name);
  if (!name) return null;
  const known = units.some((u) => u.id === v.unitId && u.id !== UNSORTED);
  return { unitId: known ? v.unitId : null, name, purpose: text(v.purpose, PURPOSE_MAX), tags: cleanTags(v.tags) };
}

export function applyPerception(units, chat, p, now = new Date().toISOString()) {
  const next = units.map(normalizeUnit);
  // A chat in a pinned unit was placed there by the person.
  if (!p || next.some((u) => u.pinned && u.chatIds.includes(chat.sessionId))) return next;
  for (const u of next) u.chatIds = u.chatIds.filter((id) => id !== chat.sessionId);
  // The AI sometimes answers "new" with the very name of a unit it made before (or a seeded one): that is the same unit.
  let target = next.find((u) => u.id === p.unitId && u.id !== UNSORTED)
    ?? next.find((u) => u.level === 'cell' && u.id !== UNSORTED && sameName(u.name, p.name));
  if (!target) {
    target = newUnit(next, p, now);
    next.push(target);
  }
  target.chatIds.push(chat.sessionId);
  // Work cells and commits find their unit by these folders; specs rarely cite code paths, so the chats teach them.
  const folders = (chat.files ?? []).filter((f) => f.includes('/')).map((f) => f.slice(0, f.lastIndexOf('/')));
  if (!target.pinned) target.paths = [...new Set([...target.paths, ...folders])].slice(0, PATHS_MAX);
  return next;
}

const union = (a, b) => [...new Set([...a, ...b])];

// One pass over a units.json written by older versions: folder names made readable, AI names cleaned, and units of
// one level that share a name merged into one (into the pinned one when there is one). Pinned units keep their name.
export function tidyUnits(units) {
  let next = units.map(normalizeUnit);
  for (const u of next) {
    if (u.pinned || u.id === UNSORTED) continue;
    if (u.origin === 'seed' && /^[a-z0-9._-]+$/.test(u.name)) u.name = readableName(u.name);
    else if (u.origin === 'ai') u.name = cleanUnitName(u.name) || u.name;
  }
  const groups = new Map();
  for (const u of next) {
    if (u.id === UNSORTED) continue;
    const key = `${u.level}|${plain(u.name).replace(/\s+/g, ' ')}`;
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const gone = new Set();
  for (const twins of groups.values()) {
    if (twins.length < 2) continue;
    const into = twins.find((u) => u.pinned) ?? twins[0];
    for (const u of twins) {
      if (u === into || u.pinned) continue;
      into.chatIds = union(into.chatIds, u.chatIds);
      into.paths = union(into.paths, u.paths);
      into.tags = cleanTags(union(into.tags, u.tags));
      for (const child of next) if (child.parentId === u.id) child.parentId = into.id;
      gone.add(u.id);
    }
  }
  next = next.filter((u) => !gone.has(u.id));
  return next;
}
