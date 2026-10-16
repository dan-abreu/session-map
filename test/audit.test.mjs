import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAudit } from '../server/audit.mjs';

// The audit as an engine run (id142, or47 task 3): failing suites first, deferred markers after.

test('the ranking puts the failing suites first and the deferred markers after', () => {
  const findings = rankAudit({ failing: ['x.test.mjs'], debts: [{ file: 'a.mjs', line: 3, text: 'one round a minute' }] });
  assert.equal(findings[0].rank, 'must');
  assert.equal(findings[1].rank, 'should');
  assert.match(findings[0].what, /x\.test\.mjs/);
  assert.match(findings[1].where, /a\.mjs:3/);
  assert.ok(findings.every((f) => f.fix && f.skip), 'each finding says how to fix and what happens if not');
});

test('nothing failing means only the deferred markers', () => {
  assert.deepEqual(rankAudit({ failing: [], debts: [] }), []);
});
