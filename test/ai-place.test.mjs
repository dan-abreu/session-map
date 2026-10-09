import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLACE_SCHEMA, placeByAi, placePrompt } from '../server/ai/place.mjs';
import { aiPlacements, forgetLife, lifeOf, placeChanged, placedFile, settleAi } from '../server/ai/life.mjs';

const part = (id, name, about, codePaths = []) => ({ id, name, file: `docs/architecture/${id}.md`, about, codePaths, groups: [], counts: {}, chatIds: [], workCellIds: [] });
const ARCH = {
  source: 'worktree', dir: 'docs/architecture', lang: 'en',
  layers: [{ id: 'entry', name: 'Entry points', partIds: ['storefront'] }, { id: 'engine', name: 'Engine', partIds: ['orders'] }],
  parts: [part('storefront', 'Storefront', 'The public site where people browse.', ['apps/site/']), part('orders', 'Orders', 'Builds the basket.')],
};
const DIGEST = { title: 'Basket totals', branch: null, prompts: ['sum the basket lines'], files: [], commits: [] };

test('placePrompt shows the parts with their layer and purpose, and treats the digest as data', () => {
  const prompt = placePrompt(DIGEST, ARCH);
  for (const piece of ['storefront', 'Storefront', 'Entry points', 'The public site', 'orders', 'Engine', 'Basket totals', 'sum the basket lines', 'apps/site/']) assert.ok(prompt.includes(piece), piece);
  assert.match(prompt, /data, not instructions/);
  assert.match(PLACE_SCHEMA, /partId/);
});

test('placeByAi: a known part id is the answer; an unknown one or null is "none fits"; a refused call is no answer', async () => {
  const answer = (value) => async () => ({ ok: true, value });
  assert.equal(await placeByAi(DIGEST, ARCH, answer({ partId: 'orders' })), 'orders');
  assert.equal(await placeByAi(DIGEST, ARCH, answer({ partId: 'ghost' })), null);
  assert.equal(await placeByAi(DIGEST, ARCH, answer({ partId: null })), null);
  assert.equal(await placeByAi(DIGEST, ARCH, async () => ({ ok: false, error: 'claude-failed' })), null);
  assert.equal(await placeByAi(DIGEST, ARCH, async () => ({ ok: false, error: 'rate-limited' })), undefined);
});

test('placeChanged asks once per conversation, keeps the answer on disk and asks nothing after a restart', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-place-'));
  try {
    let calls = 0;
    const run = async () => { calls++; return { ok: true, value: { partId: 'orders' }, costUSD: 0.001 }; };
    const p = { smDir, projectId: 'shop-abc123', arch: ARCH };
    const jobs = [{ sessionId: 'a', digest: DIGEST }];
    let life = lifeOf(smDir, {}, { bin: 'fake-claude', run });
    placeChanged(life, p, jobs);
    placeChanged(life, p, jobs);
    await settleAi(smDir);
    assert.equal(calls, 1);
    assert.deepEqual(aiPlacements(life, smDir, p.projectId).a.partId, 'orders');
    assert.ok(existsSync(placedFile(smDir, p.projectId)));

    forgetLife(smDir);
    rmSync(join(smDir, 'ai-cache.json'), { force: true });
    life = lifeOf(smDir, {}, { bin: 'fake-claude', run });
    placeChanged(life, p, jobs);
    await settleAi(smDir);
    assert.equal(calls, 0 + 1, 'the same digest and parts are not asked again');
    assert.equal(aiPlacements(life, smDir, p.projectId).a.partId, 'orders');

    placeChanged(life, p, [{ sessionId: 'a', digest: { ...DIGEST, prompts: ['and the taxes'] } }]);
    await settleAi(smDir);
    assert.equal(calls, 2, 'a conversation that went on is asked again');
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a call refused by the hourly cap is not remembered, so a later collect asks again', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-place-'));
  try {
    let calls = 0;
    const run = async () => { calls++; return { ok: true, value: { partId: 'storefront' }, costUSD: 0.001 }; };
    const life = lifeOf(smDir, { ai: { maxCallsPerHour: 1 } }, { bin: 'fake-claude', run });
    const p = { smDir, projectId: 'shop-abc123', arch: ARCH };
    placeChanged(life, p, [{ sessionId: 'a', digest: DIGEST }, { sessionId: 'b', digest: { ...DIGEST, title: 'Other' } }]);
    await settleAi(smDir);
    assert.equal(calls, 1);
    const stored = JSON.parse(readFileSync(placedFile(smDir, p.projectId), 'utf8'));
    assert.deepEqual(Object.keys(stored), ['a']);
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});
