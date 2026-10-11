// Cards the owner makes by hand in the Board (mm14): what a card may hold and how a drag reorders the list. Pure, so the
// page and the server (server/cards.mjs) apply the very same rules.
export const COLUMNS = ['todo', 'doing', 'done'];
export const TITLE_MAX = 120;
export const NOTE_MAX = 1000;

// The form's fields → the card to keep: the title is needed, the part ('' or null: none) and the note are not.
export function cleanDraft(draft) {
  const d = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  if (d.partId != null && typeof d.partId !== 'string') return { ok: false, error: 'bad-card' };
  if (d.note != null && typeof d.note !== 'string') return { ok: false, error: 'bad-card' };
  if (d.title != null && typeof d.title !== 'string') return { ok: false, error: 'bad-card' };
  const title = (d.title ?? '').trim().slice(0, TITLE_MAX);
  if (!title) return { ok: false, error: 'title-required' };
  return { ok: true, card: { title, partId: d.partId || null, note: (d.note ?? '').trim().slice(0, NOTE_MAX) } };
}

// The cards of one project in each column, in the order the list holds them; a column nobody knows reads as "to do".
export function columnsOf(list) {
  const cols = { todo: [], doing: [], done: [] };
  for (const c of list) cols[COLUMNS.includes(c.column) ? c.column : 'todo'].push(c);
  return cols;
}

// The list after a card is dropped in `column`: before the card `beforeId` when that one is in the column, else at its end.
// A new list, or null for a card or a column that does not exist.
export function moveInList(list, id, column, beforeId = null) {
  const from = list.findIndex((c) => c.id === id);
  if (from < 0 || !COLUMNS.includes(column)) return null;
  if (beforeId === id) return list.map((c) => ({ ...c }));
  const moved = { ...list[from], column };
  const rest = list.filter((c) => c.id !== id).map((c) => ({ ...c }));
  const at = beforeId == null ? -1 : rest.findIndex((c) => c.id === beforeId && c.column === column);
  rest.splice(at < 0 ? rest.length : at, 0, moved);
  return rest;
}
