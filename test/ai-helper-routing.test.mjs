import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiQueue, aiKeyHash } from '../server/ai/runner.mjs';
import { HELPER_KINDS, helperSettings, reviewPicks } from '../server/ai/helper.mjs';
import { forgetLife, lifeOf, placeChanged, settleAi, aiStatus } from '../server/ai/life.mjs';

const NOON = new Date(2026, 9, 9, 12, 0, 0).getTime();
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-helper-'));
const ON = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', enabled: true, dailyUSD: 0.5 };

// Place keys Claude will, or will not, be asked to review.
function placeKeys(reviewed, n) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const key = { kind: 'place', n: i };
    if (reviewPicks(aiKeyHash(key)) === reviewed) out.push(key);
  }
  return out;
}

function fakes({ claude = () => ({ ok: true, value: { partId: 'claude-pick' }, costUSD: 0.01 }), api = () => ({ ok: true, value: { partId: 'helper-pick' }, costUSD: 0.0001 }), key = 'sk-or-v1-0123456789abcdef' } = {}) {
  const calls = { claude: [], api: [], keyOf: [] };
  return {
    calls,
    run: async (prompt, opts) => { calls.claude.push({ prompt, opts }); return claude(prompt, opts); },
    apiRun: async (prompt, opts) => { calls.api.push({ prompt, opts }); return api(prompt, opts); },
    keyOf: async (provider) => { calls.keyOf.push(provider); return key; },
  };
}

const queue = (smDir, f, helper = ON, extra = {}) => new AiQueue({ smDir, bin: 'claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf, helper: () => helper, now: () => NOON, ...extra });

test('helperSettings reads ai.helper and ai.helperDailyUSD with safe defaults', () => {
  assert.deepEqual(helperSettings(undefined), { provider: null, model: null, enabled: false, dailyUSD: 0.5 });
  assert.deepEqual(helperSettings({ helper: { provider: 'gemini', enabled: true } }), { provider: 'gemini', model: 'gemini-3.1-flash-lite', enabled: true, dailyUSD: 0.5 });
  assert.deepEqual(helperSettings({ helper: { provider: 'deepseek', model: 'deepseek-v4-pro', enabled: true }, helperDailyUSD: 2 }), { provider: 'deepseek', model: 'deepseek-v4-pro', enabled: true, dailyUSD: 2 });
  assert.equal(helperSettings({ helper: { provider: 'nope', enabled: true } }).enabled, false);
  assert.equal(helperSettings({ helper: { provider: 'gemini' } }).enabled, false, 'a helper is chosen on purpose, never by default');
  assert.equal(helperSettings({ helper: { provider: 'gemini', enabled: true }, helperDailyUSD: -1 }).dailyUSD, 0.5);
  assert.deepEqual([...HELPER_KINDS], ['place']);
});

test('reviewPicks takes one answer in five, the same ones every time', () => {
  const picked = Array.from({ length: 1000 }, (_, i) => reviewPicks(aiKeyHash({ kind: 'place', n: i }))).filter(Boolean).length;
  assert.ok(picked > 150 && picked < 250, String(picked));
  assert.equal(reviewPicks(aiKeyHash('same')), reviewPicks(aiKeyHash('same')));
});

test('a place call goes to the helper with its model and key; Claude is not asked', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    const [key] = placeKeys(false, 1);
    const res = await q.ask({ key, prompt: 'place it', schemaHint: '{"partId": string}', projectId: 'shop' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value, { partId: 'helper-pick' });
    assert.equal(f.calls.claude.length, 0);
    assert.equal(f.calls.api.length, 1);
    assert.deepEqual(f.calls.api[0].opts, { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', key: 'sk-or-v1-0123456789abcdef', schemaHint: '{"partId": string}' });
    const s = q.status();
    assert.equal(s.helper.provider, 'openrouter');
    assert.equal(s.helper.spentUSDToday, 0.0001);
    assert.equal(s.helper.capUSD, 0.5);
    assert.equal(s.spentByProviderToday.openrouter, 0.0001);
    assert.equal(s.spentUSDToday, 0.0001, 'the total counts every provider');
    assert.equal(q.status('shop').spentUSDToday, 0.0001);
    assert.ok(!JSON.stringify(s).includes('sk-or-v1'), 'the key is never in the status');
    assert.equal((await q.ask({ key, prompt: 'place it' })).cached, true, 'the cache still answers first');
    assert.equal(f.calls.api.length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('any other kind of call stays on Claude, helper or not', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    await q.ask({ key: { kind: 'perceive', n: 1 }, prompt: 'p' });
    await q.ask({ key: 'plain', prompt: 'p' });
    assert.equal(f.calls.api.length, 0);
    assert.equal(f.calls.claude.length, 2);
    assert.equal(q.status().spentByProviderToday.claude, 0.02);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the call falls back to Claude when the helper is off, has no key or fails', async () => {
  const smDir = tmp();
  try {
    const [k1, k2, k3] = placeKeys(false, 3);
    const off = fakes();
    assert.deepEqual((await queue(smDir, off, { ...ON, enabled: false }).ask({ key: k1, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(off.calls.api.length, 0);

    const noKey = fakes({ key: null });
    assert.deepEqual((await queue(join(smDir, 'no-key'), noKey).ask({ key: k2, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(noKey.calls.api.length, 0);
    assert.equal(noKey.calls.claude.length, 1);

    const failing = fakes({ api: () => ({ ok: false, error: 'http-429', provider: 'openrouter' }) });
    const q = queue(smDir, failing);
    const res = await q.ask({ key: k3, prompt: 'p' });
    assert.deepEqual(res.value, { partId: 'claude-pick' });
    assert.equal(failing.calls.api.length, 1);
    assert.equal(failing.calls.claude.length, 1);

    const throwing = fakes({ api: () => { throw new Error('boom'); } });
    assert.equal((await queue(join(smDir, 'throwing'), throwing).ask({ key: k3, prompt: 'p' })).ok, true);
    assert.equal(throwing.calls.claude.length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the helper stops for the day at its cap, and Claude takes over', async () => {
  const smDir = tmp();
  try {
    const f = fakes({ api: () => ({ ok: true, value: { partId: 'helper-pick' }, costUSD: 0.3 }) });
    const q = queue(smDir, f);
    const keys = placeKeys(false, 3);
    for (const key of keys) await q.ask({ key, prompt: 'p' });
    assert.equal(f.calls.api.length, 2, '0.30 + 0.30 reaches the 0.50 cap');
    assert.equal(f.calls.claude.length, 1);
    assert.equal(q.status().helper.capReached, true);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the hourly cap still counts helper calls', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f, ON, { maxCallsPerHour: 1 });
    const [a, b] = placeKeys(false, 2);
    assert.equal((await q.ask({ key: a, prompt: 'p' })).ok, true);
    assert.deepEqual(await q.ask({ key: b, prompt: 'p' }), { ok: false, error: 'rate-limited' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('one helper answer in five is asked again to Claude; agreement is counted and Claude has the last word', async () => {
  const smDir = tmp();
  try {
    let claudeSays = 'helper-pick';
    const f = fakes({ claude: () => ({ ok: true, value: { partId: claudeSays }, costUSD: 0.01 }) });
    const q = queue(smDir, f);
    const [same, differ] = placeKeys(true, 2);
    const agreed = await q.ask({ key: same, prompt: 'p' });
    assert.deepEqual(agreed.value, { partId: 'helper-pick' });
    assert.equal(f.calls.claude.length, 1);
    claudeSays = 'claude-pick';
    const disagreed = await q.ask({ key: differ, prompt: 'p' });
    assert.deepEqual(disagreed.value, { partId: 'claude-pick' }, 'Claude conducts');
    assert.equal(disagreed.costUSD, 0.0101, 'both answers were paid for');
    const h = q.status().helper;
    assert.equal(h.reviewed, 2);
    assert.equal(h.agreed, 1);
    assert.equal(h.paused, false);
    const again = new AiQueue({ smDir, bin: 'claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf, helper: () => ON, now: () => NOON });
    assert.equal(again.status().helper.reviewed, 2, 'the count survives a restart');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a helper that disagrees with Claude too often is paused for that kind of work, and the status says why', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    for (const key of placeKeys(true, 10)) await q.ask({ key, prompt: 'p' });
    const h = q.status().helper;
    assert.equal(h.paused, true);
    assert.equal(h.pausedWhy.code, 'disagreed');
    assert.equal(h.pausedWhy.kind, 'place');
    assert.equal(h.pausedWhy.disagreed, 10);
    assert.equal(h.pausedWhy.of, 10);

    const before = f.calls.api.length;
    const [next] = placeKeys(false, 1);
    assert.deepEqual((await q.ask({ key: next, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(f.calls.api.length, before, 'a paused helper is not called');

    const restarted = new AiQueue({ smDir, bin: 'claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf, helper: () => ON, now: () => NOON });
    assert.equal(restarted.status().helper.paused, true, 'the pause survives a restart');
    restarted.resumeHelper('openrouter');
    assert.equal(restarted.status().helper.paused, false);
    assert.equal(restarted.status().helper.reviewed, 10, 'resuming keeps the history');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a few disagreements among many agreements do not pause the helper', async () => {
  const smDir = tmp();
  try {
    let n = 0;
    const f = fakes({ claude: () => ({ ok: true, value: { partId: n++ % 5 === 0 ? 'claude-pick' : 'helper-pick' }, costUSD: 0 }) });
    const q = queue(smDir, f);
    for (const key of placeKeys(true, 20)) await q.ask({ key, prompt: 'p' });
    const h = q.status().helper;
    assert.equal(h.reviewed, 20);
    assert.equal(h.agreed, 16);
    assert.equal(h.paused, false, '20% disagreement is under the 30% line');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the queue reports no helper fields when no helper source is wired', () => {
  const smDir = tmp();
  try {
    const q = new AiQueue({ smDir, bin: 'claude', run: async () => ({ ok: true, value: {}, costUSD: 0 }), now: () => NOON });
    assert.deepEqual(Object.keys(q.status()).sort(), ['enabled', 'model', 'queue', 'spentUSDToday']);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('lifeOf reads the helper from session-map\'s config.json on every call, so the page can switch it without a restart', async () => {
  const smDir = tmp();
  const ARCH = { layers: [], parts: [{ id: 'orders', name: 'Orders', about: 'Builds the basket.', codePaths: [] }] };
  try {
    const f = fakes({ api: () => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.0002 }) });
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf });
    const p = { smDir, projectId: 'shop-abc123', arch: ARCH };
    // Digests whose place keys Claude will not review, so each call goes to one AI only.
    const digests = [];
    for (let i = 0; digests.length < 2; i++) {
      const digest = { title: `t${i}`, branch: null, prompts: [], files: [], commits: [] };
      if (!reviewPicks(aiKeyHash({ kind: 'place', digest, parts: [['orders', 'Orders', 'Builds the basket.']] }))) digests.push(digest);
    }
    placeChanged(life, p, [{ sessionId: 'a', digest: digests[0] }]);
    await settleAi(smDir);
    assert.equal(f.calls.claude.length, 1);
    assert.equal(f.calls.api.length, 0);
    assert.equal(aiStatus(life, p.projectId).helper.enabled, false);

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { helper: { provider: 'gemini', enabled: true }, helperDailyUSD: 1 } }));
    placeChanged(life, p, [{ sessionId: 'b', digest: digests[1] }]);
    await settleAi(smDir);
    assert.equal(f.calls.api.length, 1);
    assert.equal(f.calls.api[0].opts.provider, 'gemini');
    assert.equal(f.calls.api[0].opts.model, 'gemini-3.1-flash-lite');
    assert.deepEqual(f.calls.keyOf, ['gemini']);
    const h = aiStatus(life, p.projectId).helper;
    assert.equal(h.enabled, true);
    assert.equal(h.capUSD, 1);
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a review compares only the answer that matters: an extra field is not a disagreement', async () => {
  const { sameAnswer } = await import('../server/ai/review.mjs');
  assert.equal(sameAnswer({ partId: 'a', reason: 'x' }, { partId: 'a' }, 'place'), true);
  assert.equal(sameAnswer({ partId: 'a' }, { partId: 'b', confidence: 1 }, 'place'), false);
  assert.equal(sameAnswer({ partId: null }, {}, 'place'), true);
  const smDir = tmp();
  try {
    const f = fakes({
      api: () => ({ ok: true, value: { partId: 'orders', reason: 'the basket' }, costUSD: 0 }),
      claude: () => ({ ok: true, value: { partId: 'orders' }, costUSD: 0 }),
    });
    const q = queue(smDir, f);
    for (const key of placeKeys(true, 3)) await q.ask({ key, prompt: 'p' });
    assert.equal(q.status().helper.agreed, 3);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a helper answer that fails the caller\'s check goes to Claude, is never cached and counts against the helper', async () => {
  const smDir = tmp();
  try {
    const f = fakes({
      api: () => ({ ok: true, value: { partId: 'Orders part' }, costUSD: 0.0001 }),
      claude: () => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.01 }),
    });
    const q = queue(smDir, f);
    const valid = (v) => v?.partId === null || ['orders'].includes(v?.partId);
    const [key] = placeKeys(false, 1);
    const res = await q.ask({ key, prompt: 'p', valid });
    assert.deepEqual(res.value, { partId: 'orders' }, 'Claude answers instead');
    assert.equal(f.calls.api.length, 1);
    assert.equal(f.calls.claude.length, 1);
    const h = q.status().helper;
    assert.equal(h.reviewed, 1);
    assert.equal(h.agreed, 0);
    assert.equal(q.status().spentByProviderToday.openrouter, 0.0001, 'the helper call is still paid for');
    const cache = JSON.parse((await import('node:fs')).readFileSync(join(smDir, 'ai-cache.json'), 'utf8')).cache;
    assert.deepEqual(Object.values(cache).map((c) => c.value), [{ partId: 'orders' }]);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('recordSpend books a cost outside the queue (the page\'s test call) against the provider and its daily cap', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    q.recordSpend('openrouter', 0.6);
    assert.equal(q.status().spentByProviderToday.openrouter, 0.6);
    assert.equal(q.status().helper.capReached, true);
    assert.equal(q.spentToday('openrouter'), 0.6);
    const [key] = placeKeys(false, 1);
    await q.ask({ key, prompt: 'p' });
    assert.equal(f.calls.api.length, 0, 'the cap counts the booked cost');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
