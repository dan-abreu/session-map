import test from 'node:test';
import assert from 'node:assert/strict';
import { ponytailMeasure } from '../server/bench/ponytail.mjs';

// The vendored measurements feed the bench (id142, or47 task 2): the real numbers, read from the vendored results.

test('the ponytail benchmark numbers are read from the vendored results, not from memory', () => {
  const m = ponytailMeasure();
  assert.ok(m, 'the vendored results file is there');
  assert.equal(m.date, '2026-10-07');
  assert.equal(m.codePct, 53);
  assert.equal(m.tokensPct, 45);
  assert.equal(m.costPct, 26);
  assert.equal(m.testsPct, 98);
  assert.equal(m.baselineTestsPct, 68);
});

test('a missing results file reads as null, never a wrong number', () => {
  assert.equal(ponytailMeasure({ read: () => { throw new Error('gone'); } }), null);
});
