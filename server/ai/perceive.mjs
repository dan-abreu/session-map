import { UNSORTED, newUnitId } from '../brain/cells.mjs';
import { PERCEIVE_SCHEMA, perceivePrompt } from './prompts.mjs';

const NAME_MAX = 40;
const PURPOSE_MAX = 160;
const TAG_MAX = 24;
const TAGS_MAX = 5;

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
  const name = text(v.name, NAME_MAX);
  if (!name) return null;
  const known = units.some((u) => u.id === v.unitId && u.id !== UNSORTED);
  return { unitId: known ? v.unitId : null, name, purpose: text(v.purpose, PURPOSE_MAX), tags: cleanTags(v.tags) };
}

export function applyPerception(units, chat, p, now = new Date().toISOString()) {
  const next = units.map(normalizeUnit);
  // A chat in a pinned unit was placed there by the person.
  if (!p || next.some((u) => u.pinned && u.chatIds.includes(chat.sessionId))) return next;
  for (const u of next) u.chatIds = u.chatIds.filter((id) => id !== chat.sessionId);
  let target = next.find((u) => u.id === p.unitId && u.id !== UNSORTED);
  if (!target) {
    target = newUnit(next, p, now);
    next.push(target);
  }
  target.chatIds.push(chat.sessionId);
  return next;
}
