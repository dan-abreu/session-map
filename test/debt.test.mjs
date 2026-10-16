import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harvestDebts } from '../server/debt.mjs';

// The debt ledger (id134, or45): the deferred comments, harvested mechanically.

test('the harvest finds every deferred comment with its file, line and text', () => {
  const root = mkdtempSync(join(tmpdir(), 'debt-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.mjs'), 'export const x = 1; // shortcut: one round a minute is enough\nconst y = 2; // ponytail: rebuilds too often\n');
  writeFileSync(join(root, 'src', 'b.mjs'), 'export const z = 3; // nothing deferred here\n');
  const debts = harvestDebts(root);
  assert.deepEqual(debts.map((d) => [d.file, d.line, d.text]), [
    ['src/a.mjs', 1, 'one round a minute is enough'],
    ['src/a.mjs', 2, 'rebuilds too often'],
  ]);
  rmSync(root, { recursive: true, force: true });
});

test('folders that are not the program are skipped (vendor, .dev, dependencies, the vendored disciplines)', () => {
  const root = mkdtempSync(join(tmpdir(), 'debt-'));
  writeFileSync(join(root, 'a.mjs'), '// shortcut: kept\n');
  const vendor = join(root, 'vendor'); mkdirSync(vendor, { recursive: true });
  writeFileSync(join(vendor, 'v.mjs'), '// shortcut: skipped\n');
  const disc = join(root, 'disciplines'); mkdirSync(disc, { recursive: true });
  writeFileSync(join(disc, 'd.mjs'), '// shortcut: skipped too\n');
  assert.deepEqual(harvestDebts(root).map((d) => d.text), ['kept']);
  rmSync(root, { recursive: true, force: true });
});
