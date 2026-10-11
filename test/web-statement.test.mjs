import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysOf, presetPeriod } from '../server/web/statementview.js';

test('the bars have one day for every day of the period, with nothing spent as zero', () => {
  const from = Date.parse('2026-10-09T00:00:00');
  const days = daysOf({ from, to: Date.parse('2026-10-12T00:00:00') }, [{ day: '2026-10-10', usd: 5, replies: 2 }], Date.parse('2026-10-11T12:00:00'));
  assert.deepEqual(days.map((d) => [d.day, d.usd]), [['2026-10-09', 0], ['2026-10-10', 5], ['2026-10-11', 0]]);
});

test('the quick periods give their first and last day', () => {
  const now = Date.parse('2026-10-11T12:00:00');
  assert.deepEqual(presetPeriod('today', now), { from: '2026-10-11', to: '2026-10-11' });
  assert.deepEqual(presetPeriod('7', now), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(presetPeriod('month', now), { from: '2026-10-01', to: '2026-10-11' });
});
