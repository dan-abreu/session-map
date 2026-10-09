import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parentOf, readLineage, recordLineage } from '../server/brain/lineage.mjs';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

test('recordLineage/readLineage persist child -> parent in smDir/lineage.json; missing file reads as {}', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-lin-'));
  try {
    assert.deepEqual(readLineage(smDir), {});
    recordLineage(smDir, UUID_B, UUID_A);
    assert.deepEqual(readLineage(smDir), { [UUID_B]: UUID_A });
    assert.throws(() => recordLineage(smDir, UUID_A, UUID_A), /itself/);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

const inCell = [
  { sessionId: 'a', startedAt: '2026-10-01T10:00:00Z', editedFiles: ['x.ts', 'y.ts'] },
  { sessionId: 'b', startedAt: '2026-10-02T10:00:00Z', editedFiles: ['z.ts'] },
  { sessionId: 'c', startedAt: '2026-10-03T10:00:00Z', editedFiles: ['y.ts'] },
  { sessionId: 'd', startedAt: '2026-10-04T10:00:00Z', editedFiles: ['x.ts', 'y.ts'] },
];

test('parentOf: the recorded lineage wins', () => {
  assert.equal(parentOf('d', { d: 'elsewhere' }, inCell), 'elsewhere');
});

test('parentOf: otherwise the closest earlier chat of the unit that edited a common file', () => {
  assert.equal(parentOf('d', {}, inCell), 'c');
  assert.equal(parentOf('c', {}, inCell), 'a', 'b shares nothing with c');
});

test('parentOf: null without lineage, shared files, an earlier chat or a known session', () => {
  assert.equal(parentOf('a', {}, inCell), null, 'first chat');
  assert.equal(parentOf('b', {}, inCell), null, 'no common file');
  assert.equal(parentOf('ghost', {}, inCell), null);
  assert.equal(parentOf('d', { d: 'd' }, inCell.slice(0, 3)), null, 'a chat is never its own parent');
});
