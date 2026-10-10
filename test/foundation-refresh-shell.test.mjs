import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIN_GAP_MS, STEPS, refreshFoundation, startRefresh } from '../server/foundation/refresh.mjs';
import { PIECES, foundationSummary } from '../server/foundation/summary.mjs';
import { writeFd } from '../server/foundation/store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-fdrefresh-'));
const project = (id = 'acme-shop-8324f1') => ({ id, name: 'acme-shop', root: '/work/acme-shop' });

test('the shell has no steps and no summary pieces yet: each block adds its own', () => {
  assert.deepEqual(STEPS, []);
  assert.deepEqual(PIECES, []);
  assert.equal(MIN_GAP_MS, 30_000);
});

test('refresh runs the steps in order, hands each the earlier results, and one failure does not stop the rest', async () => {
  const smDir = tmp();
  try {
    const seen = [];
    const steps = [
      { name: 'census', run: (ctx) => { seen.push(['census', ctx.project.id, ctx.careMode]); return { rev: 7 }; } },
      { name: 'broken', run: async () => { throw new Error('boom'); } },
      { name: 'facts', run: async (ctx) => { seen.push(['facts', ctx.results.census.rev]); } },
    ];
    const out = await refreshFoundation(project(), smDir, { steps, careMode: 'look', now: () => 1_000_000 });
    assert.equal(out.ran, true);
    assert.deepEqual(seen, [['census', 'acme-shop-8324f1', 'look'], ['facts', 7]]);
    assert.deepEqual(out.steps.map((s) => [s.name, s.ok, s.error ?? null]), [['census', true, null], ['broken', false, 'boom'], ['facts', true, null]]);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('one refresh at a time per project, and at least 30 s between two', async () => {
  const smDir = tmp();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    let runs = 0;
    const steps = [{ name: 'slow', run: async () => { runs++; await gate; } }];
    let t = 5_000_000;
    const now = () => t;
    const first = refreshFoundation(project(), smDir, { steps, now });
    assert.deepEqual(await refreshFoundation(project(), smDir, { steps, now }), { ran: false, reason: 'running' });
    assert.deepEqual(startRefresh(project(), smDir, { steps, now }), { started: false, reason: 'running' });
    const other = await refreshFoundation(project('acme-lib-000001'), smDir, { steps: [], now });
    assert.equal(other.ran, true, 'another project is not held back');
    release();
    assert.equal((await first).ran, true);
    t += MIN_GAP_MS - 1;
    assert.deepEqual(await refreshFoundation(project(), smDir, { steps, now }), { ran: false, reason: 'too-soon' });
    t += 1;
    assert.deepEqual(startRefresh(project(), smDir, { steps, now }), { started: true });
    assert.equal(runs, 2);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a refresh with no steps writes nothing anywhere', async () => {
  const smDir = tmp();
  try {
    const out = await refreshFoundation(project(), smDir, { steps: [] });
    assert.deepEqual(out, { ran: true, steps: [] });
    assert.equal(existsSync(join(smDir, 'brain')), false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the summary is null while nothing was read, never zeros', () => {
  const smDir = tmp();
  try {
    assert.equal(foundationSummary(smDir, 'acme-shop-8324f1'), null, 'no folder yet');
    assert.equal(foundationSummary(undefined, 'acme-shop-8324f1'), null, 'no session-map folder');
    assert.equal(foundationSummary(smDir, '../bad'), null, 'an unsafe id never throws into collect');
    writeFd(smDir, 'acme-shop-8324f1', 'census.json', { version: 1, generatedAt: '2026-10-10T10:00:00.000Z', rev: 1 });
    assert.equal(foundationSummary(smDir, 'acme-shop-8324f1'), null, 'files but no piece that reads them');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('summary pieces fill only the keys of the contract, with the newest generatedAt as updatedAt', () => {
  const smDir = tmp();
  try {
    const id = 'acme-shop-8324f1';
    writeFd(smDir, id, 'census.json', { version: 1, generatedAt: '2026-10-10T10:00:00.000Z', rev: 42, files: [1, 2, 3] });
    writeFd(smDir, id, 'health.json', { version: 1, generatedAt: '2026-10-10T11:00:00.000Z', score: 72 });
    const pieces = [
      (read) => ({ census: { rev: read('census.json').rev, files: read('census.json').files.length, lines: 0, noOwner: 0 }, extra: 'dropped' }),
      (read) => ({ health: { score: read('health.json').score } }),
      () => { throw new Error('broken piece'); },
      (read) => ({ version: read('versions.json') }),
    ];
    assert.deepEqual(foundationSummary(smDir, id, { pieces }), {
      census: { rev: 42, files: 3, lines: 0, noOwner: 0 }, read: null, coverage: null, uptodate: null,
      health: { score: 72 }, version: null, care: null, updatedAt: '2026-10-10T11:00:00.000Z',
    });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
