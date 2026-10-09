const MAX_TEXT = 200;
const MAX_ITEMS = 10;

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : undefined);
const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean).slice(0, MAX_ITEMS) : undefined);

export function parseCard(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  const known = {
    area: text(data.area),
    front: text(data.front),
    milestone: text(typeof data.milestone === 'number' ? String(data.milestone) : data.milestone),
    doing: text(data.doing),
    todo: list(data.todo),
    waiting: list(data.waiting),
    decided: list(data.decided),
    estimateUSD: Number.isFinite(data.estimateUSD) && data.estimateUSD >= 0 ? data.estimateUSD : undefined,
  };
  const title = text(data.title) ?? '';
  const kept = Object.entries(known).filter(([, v]) => v !== undefined);
  if (!title && kept.length === 0) return null;
  return { title, ...Object.fromEntries(kept) };
}
