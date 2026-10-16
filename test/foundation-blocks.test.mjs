import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_GAP_MS, blockSteps, carePiece, healthPiece, uptodatePiece, versionPiece } from '../server/foundation/blocks.mjs';
import { MIN_GAP_MS, readStep, refreshFoundation } from '../server/foundation/refresh.mjs';
import { foundationSummary } from '../server/foundation/summary.mjs';
import { fdPath } from '../server/foundation/store.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// The blocks after the reading step (fd24): the round writes every file the page and "Tudo em dia?" read, in order, and the
// summary of the page is drawn from them. Before this, the round only read: nothing ran the other blocks.

const ID = 'acme-shop-8324f1';
const NAMES = ['model.json', 'versions.json', 'profile.json', 'practices.json', 'compass.json', 'health.json', 'uptodate.json'];

test('a round writes the files of every block, in order, and the page summary has them', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-blocks-'));
  try {
    const out = await refreshFoundation({ id: ID, name: 'acme-shop', root }, smDir, { now: () => 1_000_000 });
    assert.equal(out.ran, true);
    assert.deepEqual(out.steps.map((s) => [s.name, s.ok]), [['read', true], ['model', true], ['versions', true], ['guide', true], ['health', true], ['uptodate', true]]);
    for (const name of ['census.json', 'facts.json', 'sections.json', ...NAMES]) assert.ok(existsSync(fdPath(smDir, ID, name)), `${name} was written`);
    const summary = foundationSummary(smDir, ID);
    assert.ok(Number.isFinite(summary.health.score), 'health score');
    assert.deepEqual(Object.keys(summary.uptodate).sort(), ['confirmed', 'unverified', 'warning']);
    assert.ok(Object.values(summary.uptodate).reduce((a, b) => a + b, 0) > 0, 'the checklist has lines');
    assert.equal(typeof summary.version.mismatch, 'boolean');
    assert.equal(summary.care, null, 'no care mode until the owner answers');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
    removeFixtureRepo(root);
  }
});

test('a project the reading step could not read is skipped by the blocks, not failed', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-blocks-'));
  try {
    const out = await refreshFoundation({ id: ID, name: 'gone', root: join(tmpdir(), 'sm-no-such-folder-xyz') }, smDir, { now: () => 1_000_000 });
    assert.deepEqual(out.steps.map((s) => [s.name, s.ok]), [['read', false], ['model', true], ['versions', true], ['guide', true], ['health', true], ['uptodate', true]]);
    for (const name of NAMES) assert.ok(!existsSync(fdPath(smDir, ID, name)), `${name} is not invented`);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('health is not run again within a quarter of an hour when nothing moved; the cheap blocks always run', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-blocks-'));
  try {
    let clock = 5_000_000;
    const project = { id: ID, name: 'acme-shop', root };
    const steps = () => [readStep(), ...blockSteps({ clock: () => clock })];
    const first = await refreshFoundation(project, smDir, { steps: steps(), now: () => clock });
    assert.equal(first.steps.find((s) => s.name === 'health').ok, true);
    clock += MIN_GAP_MS;
    const results = [];
    const probe = { name: 'probe', run: (ctx) => results.push(ctx.results.health) };
    await refreshFoundation(project, smDir, { steps: [...steps(), probe], now: () => clock });
    assert.deepEqual(results[0], { skipped: 'fresh' });
    clock += HEALTH_GAP_MS;
    const later = [];
    await refreshFoundation(project, smDir, { steps: [...steps(), { name: 'probe', run: (ctx) => later.push(ctx.results.health) }], now: () => clock });
    assert.ok(Number.isFinite(later[0].score), 'after the gap it is judged again');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
    removeFixtureRepo(root);
  }
});

test('the summary pieces read the saved files, give nothing for a missing or odd file, and care only for a known mode', () => {
  const files = {
    'uptodate.json': { lines: [{ state: 'confirmed' }, { state: 'warning' }, { state: 'warning' }, { state: 'unverified' }, { state: 'other' }] },
    'health.json': { score: 61 },
    'versions.json': { code: { version: '1.2.3' }, mismatch: true },
    'care.json': { mode: 'suggest' },
  };
  const read = (name) => files[name] ?? null;
  assert.deepEqual(uptodatePiece(read), { uptodate: { confirmed: 1, warning: 2, unverified: 1 } });
  assert.deepEqual(healthPiece(read), { health: { score: 61 } });
  assert.deepEqual(versionPiece(read), { version: { code: '1.2.3', mismatch: true } });
  assert.deepEqual(carePiece(read), { care: 'suggest' });
  const none = () => null;
  for (const piece of [uptodatePiece, healthPiece, versionPiece, carePiece]) assert.deepEqual(piece(none), {});
  assert.deepEqual(carePiece(() => ({ mode: 'bogus' })), {});
});
