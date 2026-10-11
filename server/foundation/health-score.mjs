// Health score (fd08): which items an item owes, the 0-100 note and the gap order. Pure: items in, numbers out.
// The note is arithmetic over states the checks decided; no model ever touches it.
import { WEIGHT } from './health-items.mjs';

export { WEIGHT };

const SEVERITY_ORDER = { E: 0, R: 1, A: 2 };
const rankOf = (sev) => SEVERITY_ORDER[sev] ?? 3;
const weightOf = (sev) => WEIGHT[sev] ?? WEIGHT.A;

// round(100 * weight(pass) / weight(pass + fail)). `unverified` and `na` are not in the sum. Nothing counted = null,
// because "no note yet" is not the same thing as 0.
export function scoreOf(items) {
  let pass = 0;
  let total = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (it?.state !== 'pass' && it?.state !== 'fail') continue;
    const w = weightOf(it.severity);
    total += w;
    if (it.state === 'pass') pass += w;
  }
  return total === 0 ? null : Math.round((100 * pass) / total);
}

export function categoriesOf(items) {
  const by = {};
  for (const it of Array.isArray(items) ? items : []) {
    const key = it.category ?? String(it.id).split('.')[0];
    (by[key] ??= []).push(it);
  }
  const out = {};
  for (const [key, list] of Object.entries(by)) {
    const count = (state) => list.filter((x) => x.state === state).length;
    out[key] = { score: scoreOf(list), pass: count('pass'), fail: count('fail'), unverified: count('unverified'), na: count('na') };
  }
  return out;
}

// "Score over 62 of 74 items verified": verified = pass + fail, applicable = those plus what could not be checked.
export function coverageOf(items) {
  let verified = 0;
  let applicable = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (it?.state === 'pass' || it?.state === 'fail') { verified++; applicable++; } else if (it?.state === 'unverified') applicable++;
  }
  return { verified, applicable };
}

// Severity E before R before A, then category, then id. A new array: the caller keeps its own order.
export function sortGaps(items) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...(Array.isArray(items) ? items : [])].sort((a, b) =>
    rankOf(a.severity) - rankOf(b.severity)
    || cmp(a.category ?? '', b.category ?? '')
    || cmp(a.id, b.id));
}

const NOT_APPLICABLE = { P: 'private', U: 'no-users', L: 'not-library', C: 'no-code' };

// One letter of `applies` (T all, P public, U app with users, L library, C has code) against the context.
function holds(letter, ctx) {
  if (letter === 'T') return true;
  if (letter === 'P') return ctx?.visibility === 'public';
  if (letter === 'U') return Boolean(ctx?.kinds?.has('users'));
  if (letter === 'L') return Boolean(ctx?.kinds?.has('library'));
  if (letter === 'C') return Boolean(ctx?.kinds?.has('code'));
  return false;
}

// The letters are OR. Not applying is never a failure: `na` with the reason of the first letter, or, when the only thing
// missing is knowing whether the repository is public, `unverified` (we cannot say it does not owe it).
export function appliesTo(item, ctx) {
  const letters = Array.isArray(item?.applies) && item.applies.length ? item.applies : ['T'];
  if (letters.some((l) => holds(l, ctx))) return { applies: true };
  if (ctx?.visibility === 'unknown' && letters.includes('P')) return { applies: false, state: 'unverified', reason: 'no-data' };
  return { applies: false, state: 'na', reason: NOT_APPLICABLE[letters[0]] ?? 'no-code' };
}
