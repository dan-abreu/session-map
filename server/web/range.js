// The period picker of a bank statement (mm06): the days a range covers, how it is remembered, the calendar it is picked
// on, and what a range makes of a list of dates or costs. Pure, so node:test loads it; the page draws it (rangepicker.js).
// A range is {preset} or {preset: 'custom', from, to} with days as "YYYY-MM-DD" in the local time of whoever looks.

export const PRESETS = ['all', 'today', 'd7', 'd15', 'd30', 'd60', 'd90', 'month', 'lastMonth'];
const DAYS = { d7: 7, d15: 15, d30: 30, d60: 60, d90: 90 };
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A day that really exists (not 31 February), at local midnight; null otherwise.
function parseIso(iso) {
  const m = ISO_RE.exec(String(iso ?? ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoDay(d) === iso ? d : null;
}

export const validCustom = (from, to) => Boolean(parseIso(from) && parseIso(to));

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

// → {from, to} in ms, both days whole, or null for "all".
export function resolveRange(sel, now) {
  const today = new Date(now);
  const preset = sel?.preset ?? 'all';
  if (preset === 'today') return { from: startOfDay(today).getTime(), to: endOfDay(today).getTime() };
  if (DAYS[preset]) return { from: startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS[preset] - 1))).getTime(), to: endOfDay(today).getTime() };
  if (preset === 'month') return { from: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), to: endOfDay(today).getTime() };
  if (preset === 'lastMonth') {
    return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(), to: endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)).getTime() };
  }
  if (preset === 'custom') {
    const a = parseIso(sel.from), b = parseIso(sel.to);
    if (!a || !b) return null;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return { from: lo.getTime(), to: endOfDay(hi).getTime() };
  }
  return null;
}

export const inRange = (ms, range) => (range === null ? true : ms >= range.from && ms <= range.to);

export const serializeSel = (sel) => (sel?.preset === 'custom' ? `custom:${sel.from}:${sel.to}` : PRESETS.includes(sel?.preset) ? sel.preset : 'all');

export function parseSel(raw) {
  if (PRESETS.includes(raw)) return { preset: raw };
  const m = /^custom:([\d-]{10}):([\d-]{10})$/.exec(String(raw ?? ''));
  if (m && validCustom(m[1], m[2])) return { preset: 'custom', from: m[1] <= m[2] ? m[1] : m[2], to: m[1] <= m[2] ? m[2] : m[1] };
  return { preset: 'all' };
}

// "3–9 Oct" for the button; the year only when the days are not all in this year.
export function spanWords(range, lang, now) {
  if (!range) return '';
  const a = new Date(range.from), b = new Date(range.to);
  const year = new Date(now).getFullYear();
  const opts = { day: 'numeric', month: 'short', ...(a.getFullYear() !== year || b.getFullYear() !== year ? { year: 'numeric' } : {}) };
  const fmt = new Intl.DateTimeFormat(lang, opts);
  return isoDay(a) === isoDay(b) ? fmt.format(a) : fmt.formatRange(a, b);
}

// ---- the calendar -----------------------------------------------------------------------------

// Weeks of seven cells starting on Sunday; a cell is a day "YYYY-MM-DD", or null outside the month.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const count = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export function shiftMonth({ year, month }, by) {
  const d = new Date(year, month + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Click the start, click the end; a third click starts over; an end before the start swaps them.
export function pickDay(draft, iso) {
  if (!draft.from || draft.to) return { from: iso, to: null };
  return iso < draft.from ? { from: iso, to: draft.from } : { from: draft.from, to: iso };
}

// How a day is painted: 'start', 'between', 'end', 'single', or null. While the end is not chosen the range runs to the
// day under the pointer (hover).
export function dayState(iso, draft, hover = null) {
  if (!draft.from) return null;
  const other = draft.to ?? hover ?? draft.from;
  const [lo, hi] = draft.from <= other ? [draft.from, other] : [other, draft.from];
  if (iso < lo || iso > hi) return null;
  if (lo === hi) return 'single';
  return iso === lo ? 'start' : iso === hi ? 'end' : 'between';
}

// ---- what a range makes of the data -----------------------------------------------------------

// byDay: {"YYYY-MM-DD": usd}, the days as the server that counted them had them.
export function costInRange(byDay, range) {
  const lo = range ? isoDay(range.from) : '', hi = range ? isoDay(range.to) : '';
  let sum = 0;
  for (const [day, usd] of Object.entries(byDay ?? {})) if (!range || (day >= lo && day <= hi)) sum += usd;
  return sum;
}
