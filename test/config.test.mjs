import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { normalizePath } from '../server/paths.mjs';

function dirs() {
  return [mkdtempSync(join(tmpdir(), 'sm-cfg-r-')), mkdtempSync(join(tmpdir(), 'sm-cfg-s-'))];
}

test('loadConfig merges project file, user per-project entry and global keys', () => {
  const [root, sm] = dirs();
  try {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ roadmap: 'a.md', decisions: { heading: 'D', pendingWhen: 'x' } }));
    writeFileSync(join(sm, 'config.json'), JSON.stringify({
      budget: { monthlyUSD: 50 }, currency: { code: 'BRL', rate: 5 }, prices: { m: 1 },
      projects: { [normalizePath(root)]: { roadmap: 'b.md' } },
    }));
    const cfg = loadConfig(root, sm);
    assert.equal(cfg.roadmap, 'b.md');
    assert.deepEqual(cfg.decisions, { heading: 'D', pendingWhen: 'x' });
    assert.deepEqual(cfg.budget, { monthlyUSD: 50 });
    assert.equal(cfg.currency.code, 'BRL');
    assert.deepEqual(cfg.prices, { m: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(sm, { recursive: true, force: true }); }
});

test('loadConfig survives missing and malformed files', () => {
  const [root, sm] = dirs();
  try {
    assert.deepEqual(loadConfig(root, sm), {});
    writeFileSync(join(sm, 'config.json'), '{ not json');
    assert.deepEqual(loadConfig(root, sm), {});
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(sm, { recursive: true, force: true }); }
});
