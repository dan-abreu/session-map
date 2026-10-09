import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOpenSpec } from '../server/sources/openspec.mjs';

function change(root, name, md) {
  const dir = join(root, 'openspec', 'changes', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tasks.md'), md);
}

test('readOpenSpec counts done and open tasks, lists the first 8 open, ignores archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  try {
    const open = Array.from({ length: 10 }, (_, i) => `- [ ] open ${i + 1}`).join('\n');
    change(root, 'add-thing', `# Tasks\n- [x] one\n- [X] two\n${open}\n`);
    change(root, 'archive/old', '- [ ] stale\n');
    const out = readOpenSpec(root);
    assert.equal(out.length, 1);
    assert.equal(out[0].change, 'add-thing');
    assert.equal(out[0].done, 2);
    assert.equal(out[0].total, 12);
    assert.equal(out[0].todo.length, 8);
    assert.equal(out[0].todo[0], 'open 1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readOpenSpec returns [] without an openspec folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  try { assert.deepEqual(readOpenSpec(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});
