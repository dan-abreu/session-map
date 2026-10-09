import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, isoDay, resolveRange, inRange, parseSel, serializeSel, spanWords, monthGrid, shiftMonth, pickDay, dayState, costInRange, validCustom,
} from '../server/web/range.js';

// Thursday 8 October 2026, 15:30 local time.
const NOW = new Date(2026, 9, 8, 15, 30).getTime();
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('the buttons of the statement: Today, 7, 15, 30, 60, 90 days, this month and last month', () => {
  assert.deepEqual(PRESETS, ['all', 'today', 'd7', 'd15', 'd30', 'd60', 'd90', 'month', 'lastMonth']);
});

test('isoDay: the local day as YYYY-MM-DD', () => {
  assert.equal(isoDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(isoDay(at(2026, 12, 31)), '2026-12-31');
});

test('resolveRange: whole days, today included; all has no limits', () => {
  assert.equal(resolveRange({ preset: 'all' }, NOW), null);
  assert.equal(resolveRange(null, NOW), null);
  const today = resolveRange({ preset: 'today' }, NOW);
  assert.equal(isoDay(today.from), '2026-10-08');
  assert.equal(isoDay(today.to), '2026-10-08');
  const week = resolveRange({ preset: 'd7' }, NOW);
  assert.equal(isoDay(week.from), '2026-10-02', '7 days = today and the 6 before');
  assert.equal(isoDay(week.to), '2026-10-08');
  assert.equal(new Date(week.from).getHours(), 0);
  assert.equal(new Date(week.to).getHours(), 23);
  assert.equal(isoDay(resolveRange({ preset: 'd90' }, NOW).from), '2026-07-11');
  const month = resolveRange({ preset: 'month' }, NOW);
  assert.deepEqual([isoDay(month.from), isoDay(month.to)], ['2026-10-01', '2026-10-08']);
  const last = resolveRange({ preset: 'lastMonth' }, NOW);
  assert.deepEqual([isoDay(last.from), isoDay(last.to)], ['2026-09-01', '2026-09-30']);
  const jan = resolveRange({ preset: 'lastMonth' }, at(2026, 1, 15));
  assert.deepEqual([isoDay(jan.from), isoDay(jan.to)], ['2025-12-01', '2025-12-31'], 'January looks back to December of last year');
});

test('resolveRange: a custom range is its two days, in either order; a broken one is everything', () => {
  const r = resolveRange({ preset: 'custom', from: '2026-10-03', to: '2026-10-09' }, NOW);
  assert.deepEqual([isoDay(r.from), isoDay(r.to)], ['2026-10-03', '2026-10-09']);
  const swapped = resolveRange({ preset: 'custom', from: '2026-10-09', to: '2026-10-03' }, NOW);
  assert.deepEqual([isoDay(swapped.from), isoDay(swapped.to)], ['2026-10-03', '2026-10-09']);
  assert.equal(resolveRange({ preset: 'custom', from: 'x', to: '2026-10-03' }, NOW), null);
  assert.equal(resolveRange({ preset: 'custom', from: '2026-02-31', to: '2026-03-02' }, NOW), null, 'a day that does not exist');
});

test('inRange: both edges count, the whole last day included', () => {
  const r = resolveRange({ preset: 'custom', from: '2026-10-03', to: '2026-10-09' }, NOW);
  assert.equal(inRange(at(2026, 10, 3, 0), r), true);
  assert.equal(inRange(new Date(2026, 9, 9, 23, 59, 59).getTime(), r), true);
  assert.equal(inRange(at(2026, 10, 10, 0), r), false);
  assert.equal(inRange(at(2026, 10, 2, 23), r), false);
  assert.equal(inRange(at(1999, 1, 1), null), true, 'no range = everything');
  assert.equal(inRange(Number.NaN, r), false);
});

test('parseSel and serializeSel: what the browser remembers per project, and nothing else', () => {
  for (const p of PRESETS) assert.deepEqual(parseSel(serializeSel({ preset: p })), { preset: p });
  const custom = { preset: 'custom', from: '2026-10-03', to: '2026-10-09' };
  assert.equal(serializeSel(custom), 'custom:2026-10-03:2026-10-09');
  assert.deepEqual(parseSel('custom:2026-10-03:2026-10-09'), custom);
  assert.deepEqual(parseSel('custom:2026-10-09:2026-10-03'), custom, 'stored in order');
  for (const bad of [null, undefined, '', 'd8', 'custom:2026-10-03', 'custom:a:b', '<script>']) assert.deepEqual(parseSel(bad), { preset: 'all' }, String(bad));
});

test('validCustom: two real days', () => {
  assert.equal(validCustom('2026-10-03', '2026-10-09'), true);
  assert.equal(validCustom('2026-10-03', ''), false);
  assert.equal(validCustom('2026-13-03', '2026-10-09'), false);
});

test('spanWords: the days on the button, short, in the language', () => {
  const r = resolveRange({ preset: 'custom', from: '2026-10-03', to: '2026-10-09' }, NOW);
  const en = spanWords(r, 'en-GB', NOW);
  assert.match(en, /3.{1,3}9 Oct/);
  assert.match(spanWords(r, 'pt-BR', NOW), /3.{1,5}9.*out/i);
  const one = resolveRange({ preset: 'today' }, NOW);
  assert.match(spanWords(one, 'en-GB', NOW), /^8 Oct$/);
  const old = resolveRange({ preset: 'custom', from: '2025-12-28', to: '2026-01-03' }, NOW);
  assert.match(spanWords(old, 'en-GB', NOW), /2025/, 'another year is said');
  assert.equal(spanWords(null, 'en', NOW), '');
});

test('monthGrid: weeks starting on Sunday, with the days of the neighbour months blank', () => {
  const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0].slice(0, 4), [null, null, null, null]);
  assert.equal(weeks[0][4], '2026-10-01');
  assert.equal(weeks.flat().filter(Boolean).length, 31);
  assert.equal(weeks.at(-1).filter(Boolean).at(-1), '2026-10-31');
  assert.equal(monthGrid(2026, 1).flat().filter(Boolean).length, 28);
});

test('shiftMonth: crosses the year both ways', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 5 }, 0), { year: 2026, month: 5 });
});

test('pickDay: the first click starts, the second ends, the third starts again; an earlier second click flips them', () => {
  let d = { from: null, to: null };
  d = pickDay(d, '2026-10-05');
  assert.deepEqual(d, { from: '2026-10-05', to: null });
  d = pickDay(d, '2026-10-09');
  assert.deepEqual(d, { from: '2026-10-05', to: '2026-10-09' });
  d = pickDay(d, '2026-10-20');
  assert.deepEqual(d, { from: '2026-10-20', to: null }, 'a third click starts over');
  d = pickDay(d, '2026-10-12');
  assert.deepEqual(d, { from: '2026-10-12', to: '2026-10-20' }, 'earlier than the start: the two swap');
  assert.deepEqual(pickDay({ from: '2026-10-05', to: null }, '2026-10-05'), { from: '2026-10-05', to: '2026-10-05' }, 'one day is a range');
});

test('dayState: the painted range, with a preview to the day under the pointer while the end is not chosen', () => {
  const full = { from: '2026-10-05', to: '2026-10-09' };
  assert.equal(dayState('2026-10-05', full), 'start');
  assert.equal(dayState('2026-10-07', full), 'between');
  assert.equal(dayState('2026-10-09', full), 'end');
  assert.equal(dayState('2026-10-10', full), null);
  assert.equal(dayState('2026-10-04', full), null);
  assert.equal(dayState('2026-10-05', { from: '2026-10-05', to: '2026-10-05' }), 'single');
  const open = { from: '2026-10-05', to: null };
  assert.equal(dayState('2026-10-05', open), 'single');
  assert.equal(dayState('2026-10-07', open, '2026-10-09'), 'between');
  assert.equal(dayState('2026-10-09', open, '2026-10-09'), 'end');
  assert.equal(dayState('2026-10-03', open, '2026-10-01'), 'between', 'a preview backwards');
  assert.equal(dayState('2026-10-07', open), null, 'no pointer, no preview');
  assert.equal(dayState('2026-10-07', { from: null, to: null }, '2026-10-09'), null);
});

test('costInRange: the days inside, edges included; no range is everything', () => {
  const byDay = { '2026-10-01': 1, '2026-10-03': 2, '2026-10-09': 4, '2026-10-10': 8 };
  const r = resolveRange({ preset: 'custom', from: '2026-10-03', to: '2026-10-09' }, NOW);
  assert.equal(costInRange(byDay, r), 6);
  assert.equal(costInRange(byDay, null), 15);
  assert.equal(costInRange(undefined, r), 0);
});
