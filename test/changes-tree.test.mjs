import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeFor } from '../server/changes-state.mjs';

// git status and diff ran for every project on every collect (every few seconds); the folder rarely changes that fast.
test('the files not saved yet are asked of git again only when the index moved, a chat edited, or the wait passed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-tree-'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'index'), 'a');
  let reads = 0;
  const read = async () => { reads++; return [{ path: `f${reads}`, kind: 'edit', added: 1, removed: 0 }]; };
  try {
    const first = await treeFor(root, { nowMs: 1_000_000, read });
    assert.equal(reads, 1);
    assert.equal(await treeFor(root, { nowMs: 1_002_000, read }), first, 'nothing moved: the last answer');
    assert.equal(reads, 1);
    await treeFor(root, { nowMs: 1_003_000, editedMs: 1_002_500, read });
    assert.equal(reads, 2, 'a conversation edited a file after the last look');
    await treeFor(root, { nowMs: 1_004_000, editedMs: 1_002_500, read });
    assert.equal(reads, 2, 'that edit was already seen');
    writeFileSync(join(root, '.git', 'index'), 'ab');
    utimesSync(join(root, '.git', 'index'), new Date(), new Date(Date.now() + 5000));
    await treeFor(root, { nowMs: 1_005_000, read });
    assert.equal(reads, 3, 'something was added or committed');
    await treeFor(root, { nowMs: 1_005_000 + 60_000, read });
    assert.equal(reads, 4, 'an edit made outside any conversation shows after the wait');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
