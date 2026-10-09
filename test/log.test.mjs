import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../server/log.mjs';

test('log writes one JSON line with level, event and fields to stderr', () => {
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try { log('warn', 'read-failed', { path: 'x' }); } finally { process.stderr.write = original; }
  assert.equal(writes.length, 1);
  assert.ok(writes[0].endsWith('\n'));
  const row = JSON.parse(writes[0]);
  assert.deepEqual({ level: row.level, event: row.event, path: row.path }, { level: 'warn', event: 'read-failed', path: 'x' });
  assert.match(row.ts, /^\d{4}-\d\d-\d\dT/);
});
