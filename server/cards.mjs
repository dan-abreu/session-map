// The cards the owner makes by hand in the Board (mm14), with their column and their place in it. They live only in
// session-map's own folder (cards.json), never in the project: {projectId: [{id, title, partId, note, column, createdAt}]},
// the list's order being the order inside each column.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readJsonFile, writeAtomic } from './store.mjs';
import { COLUMNS, NOTE_MAX, TITLE_MAX, cleanDraft, moveInList } from './web/handcards.js';

export const MAX_PER_PROJECT = 200;
const PROJECT_MAX = 120;

const fileOf = (smDir) => join(smDir, 'cards.json');
const goodProject = (id) => typeof id === 'string' && id.length > 0 && id.length <= PROJECT_MAX;

function clean(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || typeof c.title !== 'string' || !c.title.trim()) return null;
  return {
    id: c.id,
    title: c.title.trim().slice(0, TITLE_MAX),
    partId: typeof c.partId === 'string' && c.partId ? c.partId : null,
    note: typeof c.note === 'string' ? c.note.slice(0, NOTE_MAX) : '',
    column: COLUMNS.includes(c.column) ? c.column : 'todo',
    createdAt: Number.isFinite(c.createdAt) ? c.createdAt : 0,
  };
}

export function readCards(smDir) {
  const stored = readJsonFile(fileOf(smDir), {});
  const out = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [projectId, list] of Object.entries(stored)) {
    if (!goodProject(projectId) || !Array.isArray(list)) continue;
    const cards = list.map(clean).filter(Boolean);
    if (cards.length) out[projectId] = cards;
  }
  return out;
}

function save(smDir, all) {
  writeAtomic(fileOf(smDir), `${JSON.stringify(all)}\n`);
}

// A new card goes to the end of "to do". draft: {title, partId?, note?}.
export function addCard(smDir, projectId, draft, { now = Date.now() } = {}) {
  if (!goodProject(projectId)) return { ok: false, error: 'bad-project' };
  const made = cleanDraft(draft);
  if (!made.ok) return made;
  const all = readCards(smDir);
  const list = all[projectId] ?? [];
  if (list.length >= MAX_PER_PROJECT) return { ok: false, error: 'too-many' };
  const card = { id: randomUUID(), ...made.card, column: 'todo', createdAt: now };
  all[projectId] = [...list, card];
  save(smDir, all);
  return { ok: true, card };
}

// Drops a card in `column`, before the card `before` when it is one of that column's, else at its end.
export function moveCard(smDir, id, { column, before = null } = {}) {
  if (!COLUMNS.includes(column) || (before != null && typeof before !== 'string')) return { ok: false, error: 'bad-column' };
  const all = readCards(smDir);
  const projectId = Object.keys(all).find((p) => all[p].some((c) => c.id === id));
  if (!projectId) return { ok: false, error: 'unknown-card' };
  all[projectId] = moveInList(all[projectId], id, column, before);
  save(smDir, all);
  return { ok: true, card: all[projectId].find((c) => c.id === id) };
}

export function removeCard(smDir, id) {
  const all = readCards(smDir);
  const projectId = Object.keys(all).find((p) => all[p].some((c) => c.id === id));
  if (!projectId) return false;
  all[projectId] = all[projectId].filter((c) => c.id !== id);
  if (!all[projectId].length) delete all[projectId];
  save(smDir, all);
  return true;
}
