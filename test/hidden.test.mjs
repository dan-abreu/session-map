import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRemoved, dismissCut, readDismissed, readRemoved } from '../server/hidden.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function withSmDir(fn) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-hidden-'));
  try { return fn(smDir); } finally { rmSync(smDir, { recursive: true, force: true }); }
}

test('a removed conversation is remembered in removed.json, once', () => {
  withSmDir((smDir) => {
    assert.deepEqual(readRemoved(smDir), new Set());
    addRemoved(smDir, A);
    addRemoved(smDir, B);
    addRemoved(smDir, A);
    assert.deepEqual(readRemoved(smDir), new Set([A, B]));
    assert.deepEqual(JSON.parse(readFileSync(join(smDir, 'removed.json'), 'utf8')), [A, B]);
  });
});

test('a dismissed cut-off is remembered with the last activity it had then', () => {
  withSmDir((smDir) => {
    assert.deepEqual(readDismissed(smDir), {});
    dismissCut(smDir, A, '2026-10-09T10:00:00.000Z');
    dismissCut(smDir, B, null);
    dismissCut(smDir, A, '2026-10-09T11:00:00.000Z');
    assert.deepEqual(readDismissed(smDir), { [A]: '2026-10-09T11:00:00.000Z', [B]: null });
  });
});

test('corrupt or wrongly shaped files read as empty', () => {
  withSmDir((smDir) => {
    writeFileSync(join(smDir, 'removed.json'), '{not json');
    writeFileSync(join(smDir, 'cut-dismissed.json'), '[1,2]');
    assert.deepEqual(readRemoved(smDir), new Set());
    assert.deepEqual(readDismissed(smDir), {});
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([A, 42, null]));
    assert.deepEqual(readRemoved(smDir), new Set([A]));
    addRemoved(smDir, B);
    assert.deepEqual(readRemoved(smDir), new Set([A, B]));
  });
});
