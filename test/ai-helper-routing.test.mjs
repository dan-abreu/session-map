import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiQueue, aiKeyHash } from '../server/ai/runner.mjs';
import { HELPER_KINDS, reviewPicks } from '../server/ai/helper.mjs';
import { estimateCostUSD } from '../server/ai/providers.mjs';
import { forgetLife, lifeOf, placeChanged, settleAi, aiStatus } from '../server/ai/life.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';

// The queue sends the bulk work (kind 'place') to every other AI with a key at once, as the router orders them;
// Claude keeps its one-at-a-time line, reviews a sample and answers whatever the others cannot (or14).

const NOON = new Date(2026, 9, 9, 12, 0, 0).getTime();
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-helper-'));
const others = (over = {}) => ({ enabled: true, dailyUSD: 1, off: [], models: {}, keys: ['openai'], ...over });
const OPENAI = others();
const TWO = others({ keys: ['gemini', 'openai'] });

// Place keys Claude will, or will not, be asked to review.
function placeKeys(reviewed, n, from = 0) {
  const out = [];
  for (let i = from; out.length < n; i++) {
    const key = { kind: 'place', n: i };
    if (reviewPicks(aiKeyHash(key)) === reviewed) out.push(key);
  }
  return out;
}

const pickOf = (provider) => ({ partId: `${provider}-pick` });

function fakes({
  claude = () => ({ ok: true, value: { partId: 'claude-pick' }, costUSD: 0.01 }),
  api = (prompt, opts) => ({ ok: true, value: pickOf(opts.provider), costUSD: 0.0001, provider: opts.provider }),
  key = (provider) => `sk-${provider}-0123456789abcdef`,
  delayMs = 0,
} = {}) {
  const calls = { claude: [], api: [], keyOf: [] };
  const live = { claude: 0, claudePeak: 0, total: 0, totalPeak: 0, by: {}, peak: {} };
  const wait = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : null);
  return {
    calls,
    live,
    run: async (prompt, opts) => {
      calls.claude.push({ prompt, opts });
      live.claudePeak = Math.max(live.claudePeak, ++live.claude);
      await wait();
      live.claude--;
      return claude(prompt, opts);
    },
    apiRun: async (prompt, opts) => {
      calls.api.push({ prompt, opts });
      const p = opts.provider;
      live.by[p] = (live.by[p] ?? 0) + 1;
      live.peak[p] = Math.max(live.peak[p] ?? 0, live.by[p]);
      live.totalPeak = Math.max(live.totalPeak, ++live.total);
      await wait();
      live.by[p]--;
      live.total--;
      return api(prompt, opts);
    },
    keyOf: async (provider) => { calls.keyOf.push(provider); return typeof key === 'function' ? key(provider) : key; },
  };
}

const queue = (smDir, f, settings = OPENAI, extra = {}) => new AiQueue({ smDir, bin: 'claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf, others: () => settings, now: () => NOON, ...extra });
const provider = (q, id) => q.status().others.providers.find((p) => p.id === id);

test('only bulk classification may leave Claude, and one answer in five is reviewed, the same ones every time', () => {
  assert.deepEqual([...HELPER_KINDS], ['place']);
  const picked = Array.from({ length: 1000 }, (_, i) => reviewPicks(aiKeyHash({ kind: 'place', n: i }))).filter(Boolean).length;
  assert.ok(picked > 150 && picked < 250, String(picked));
  assert.equal(reviewPicks(aiKeyHash('same')), reviewPicks(aiKeyHash('same')));
});

test('a place call goes to the AI the router picks, with its model and key; Claude is not asked', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    const [key] = placeKeys(false, 1);
    const res = await q.ask({ key, prompt: 'place it', schemaHint: '{"partId": string}', projectId: 'shop' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value, pickOf('openai'));
    assert.equal(f.calls.claude.length, 0);
    assert.equal(f.calls.api.length, 1);
    assert.deepEqual(f.calls.api[0].opts, { provider: 'openai', model: 'gpt-6-luna', key: 'sk-openai-0123456789abcdef', schemaHint: '{"partId": string}' });
    const s = q.status();
    assert.equal(s.spentByProviderToday.openai, 0.0001);
    assert.equal(s.spentUSDToday, 0.0001, 'the total counts every provider');
    assert.equal(q.status('shop').spentUSDToday, 0.0001);
    assert.equal(s.others.enabled, true);
    assert.equal(s.others.dailyUSD, 1);
    assert.equal(s.others.spentUSDToday, 0.0001);
    assert.equal(s.others.capReached, false);
    assert.deepEqual(s.others.providers.map((p) => p.id).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
    assert.deepEqual(provider(q, 'openai'), {
      id: 'openai', model: 'gpt-6-luna', hasKey: true, on: true, paused: false, pausedWhy: null, spentUSDToday: 0.0001, reviewed: 0, agreed: 0, calls: 1, busy: 0,
    });
    assert.equal(provider(q, 'gemini').hasKey, false);
    assert.ok(!JSON.stringify(s).includes('sk-openai'), 'the key is never in the status');
    assert.equal((await q.ask({ key, prompt: 'place it' })).cached, true, 'the cache still answers first');
    assert.equal(f.calls.api.length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('any other kind of call stays on Claude', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f, TWO);
    await q.ask({ key: { kind: 'perceive', n: 1 }, prompt: 'p' });
    await q.ask({ key: 'plain', prompt: 'p' });
    assert.equal(f.calls.api.length, 0);
    assert.equal(f.calls.claude.length, 2);
    assert.equal(q.status().spentByProviderToday.claude, 0.02);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the call falls back to Claude when the others are off, switched off one by one, keyless or failing', async () => {
  const smDir = tmp();
  try {
    const [k1, k2, k3, k4, k5] = placeKeys(false, 5);
    const off = fakes();
    assert.deepEqual((await queue(join(smDir, 'off'), off, others({ enabled: false })).ask({ key: k1, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(off.calls.api.length, 0);

    const each = fakes();
    assert.deepEqual((await queue(join(smDir, 'each'), each, others({ off: ['openai'] })).ask({ key: k2, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(each.calls.api.length, 0);

    const noKey = fakes({ key: null });
    assert.deepEqual((await queue(join(smDir, 'no-key'), noKey).ask({ key: k3, prompt: 'p' })).value, { partId: 'claude-pick' });
    assert.equal(noKey.calls.api.length, 0);
    assert.equal(noKey.calls.claude.length, 1);

    const failing = fakes({ api: () => ({ ok: false, error: 'http-429', provider: 'openai' }) });
    const res = await queue(join(smDir, 'failing'), failing).ask({ key: k4, prompt: 'p' });
    assert.deepEqual(res.value, { partId: 'claude-pick' });
    assert.equal(failing.calls.api.length, 1);
    assert.equal(failing.calls.claude.length, 1);

    const throwing = fakes({ api: () => { throw new Error('boom'); } });
    assert.equal((await queue(join(smDir, 'throwing'), throwing).ask({ key: k5, prompt: 'p' })).ok, true);
    assert.equal(throwing.calls.claude.length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('DeepSeek takes the bulk work whatever the class: unsaid, internal or public', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f, others({ keys: ['deepseek'] }));
    const [a, b] = placeKeys(false, 2);
    assert.deepEqual((await q.ask({ key: a, prompt: 'p' })).value, pickOf('deepseek'));
    assert.equal(f.calls.api.length, 1);
    assert.deepEqual((await q.ask({ key: b, prompt: 'p', sensitivity: 'public' })).value, pickOf('deepseek'));
    assert.equal(f.calls.api[0].opts.model, 'deepseek-flash');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a burst of bulk work runs on every AI at once, one call at a time on each, Claude still one at a time', async () => {
  const smDir = tmp();
  try {
    const f = fakes({ delayMs: 15 });
    const q = queue(smDir, f, TWO);
    const jobs = placeKeys(false, 6).map((key) => q.ask({ key, prompt: 'p', sensitivity: 'internal' }));
    assert.equal(q.status().queue, 6);
    assert.equal(provider(q, 'openai').busy + provider(q, 'gemini').busy, 6);
    const answers = await Promise.all(jobs);
    assert.ok(answers.every((r) => r.ok));
    assert.equal(f.live.totalPeak, 2, 'both AIs worked at the same time');
    assert.equal(f.live.peak.openai, 1);
    assert.equal(f.live.peak.gemini, 1);
    assert.deepEqual(answers.map((r) => r.value.partId).sort(), ['gemini-pick', 'gemini-pick', 'gemini-pick', 'openai-pick', 'openai-pick', 'openai-pick']);
    assert.equal(provider(q, 'openai').calls, 3);
    assert.equal(provider(q, 'gemini').calls, 3);
    assert.equal(q.status().queue, 0);

    // Reviews and fallbacks of a burst all wait in Claude's single line.
    const g = fakes({ delayMs: 10, api: () => ({ ok: false, error: 'http-500' }) });
    const q2 = queue(join(smDir, 'fallback'), g, TWO);
    await Promise.all(placeKeys(true, 4).map((key) => q2.ask({ key, prompt: 'p', sensitivity: 'internal' })));
    assert.equal(g.calls.claude.length, 4);
    assert.equal(g.live.claudePeak, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the one daily cap covers every outside AI together, also while they run at the same time', async () => {
  const smDir = tmp();
  try {
    const luna = estimateCostUSD('openai', 'gpt-6-luna', 'p');
    const lite = estimateCostUSD('gemini', 'gemini-3.1-flash-lite', 'p');
    // Each fits alone, both together do not: whichever reserves second must give way to Claude.
    const cap = Math.max(luna, lite) + Math.min(luna, lite) / 2;
    const f = fakes({ delayMs: 10, api: (prompt, opts) => ({ ok: true, value: pickOf(opts.provider), costUSD: estimateCostUSD(opts.provider, opts.model, prompt) }) });
    const q = queue(smDir, f, others({ keys: ['gemini', 'openai'], dailyUSD: cap }));
    const answers = await Promise.all(placeKeys(false, 2).map((key) => q.ask({ key, prompt: 'p', sensitivity: 'internal' })));
    assert.ok(answers.every((r) => r.ok));
    assert.equal(f.calls.api.length, 1, 'the second call would have gone over the cap');
    assert.equal(f.calls.claude.length, 1);
    const s = q.status().others;
    assert.ok(s.spentUSDToday <= cap, `${s.spentUSDToday} > ${cap}`);

    // Spent by one AI counts against all of them.
    const g = fakes({ api: (prompt, opts) => ({ ok: true, value: pickOf(opts.provider), costUSD: 0.3 }) });
    const q2 = queue(join(smDir, 'shared'), g, others({ keys: ['gemini', 'openai'], dailyUSD: 0.5 }));
    q2.recordSpend('gemini', 0.3);
    for (const key of placeKeys(false, 3)) await q2.ask({ key, prompt: 'p', sensitivity: 'internal' });
    assert.equal(g.calls.api.length, 1, '0.30 on Gemini + 0.30 on OpenAI reaches the 0.50 for all');
    assert.equal(g.calls.claude.length, 2);
    assert.equal(q2.status().others.capReached, true);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('reserveOutside holds money for a call in flight and books what it really cost', () => {
  const smDir = tmp();
  try {
    const q = queue(smDir, fakes());
    const a = q.reserveOutside('openai', 0.4, 1);
    const b = q.reserveOutside('gemini', 0.4, 1);
    assert.ok(a && b);
    assert.equal(q.reserveOutside('openai', 0.4, 1), null, '0.4 + 0.4 held, another 0.4 would pass 1.00');
    a.settle(0.1);
    a.settle(5);
    assert.equal(q.spentToday('openai'), 0.1, 'settled once');
    assert.ok(q.reserveOutside('openai', 0.4, 1), 'what a finished call did not use is free again');
    b.settle(0, 'shop');
    assert.equal(provider(q, 'openai').calls, 1);
    assert.equal(provider(q, 'gemini').calls, 1);
    assert.equal(q.reserveOutside('openai', 0.01, 0), null, 'a zero cap lets nothing out');
    assert.equal(q.reserveOutside('openai', Number.NaN, 1), null);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the hourly cap still counts calls to the other AIs', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f, OPENAI, { maxCallsPerHour: 1 });
    const [a, b] = placeKeys(false, 2);
    assert.equal((await q.ask({ key: a, prompt: 'p' })).ok, true);
    assert.deepEqual(await q.ask({ key: b, prompt: 'p' }), { ok: false, error: 'rate-limited' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('one answer in five is asked again to Claude; agreement is counted per AI and Claude has the last word', async () => {
  const smDir = tmp();
  try {
    let claudeSays = 'openai-pick';
    const f = fakes({ claude: () => ({ ok: true, value: { partId: claudeSays }, costUSD: 0.01 }) });
    const q = queue(smDir, f);
    const [same, differ] = placeKeys(true, 2);
    assert.deepEqual((await q.ask({ key: same, prompt: 'p' })).value, pickOf('openai'));
    assert.equal(f.calls.claude.length, 1);
    claudeSays = 'claude-pick';
    const disagreed = await q.ask({ key: differ, prompt: 'p' });
    assert.deepEqual(disagreed.value, { partId: 'claude-pick' }, 'Claude conducts');
    assert.equal(disagreed.costUSD, 0.0101, 'both answers were paid for');
    const o = provider(q, 'openai');
    assert.deepEqual([o.reviewed, o.agreed, o.paused], [2, 1, false]);
    const again = queue(smDir, f);
    assert.equal(provider(again, 'openai').reviewed, 2, 'the count survives a restart');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('an AI that disagrees with Claude too often is paused alone; the others keep working', async () => {
  const smDir = tmp();
  try {
    const f = fakes({ claude: () => ({ ok: true, value: pickOf('gemini'), costUSD: 0 }) });
    const q = queue(smDir, f, TWO);
    // One at a time: each goes to the first in line, OpenAI's Luna, until it is paused.
    for (const key of placeKeys(true, 10)) await q.ask({ key, prompt: 'p', sensitivity: 'internal' });
    const o = provider(q, 'openai');
    assert.equal(o.paused, true);
    assert.equal(o.pausedWhy.code, 'disagreed');
    assert.equal(o.pausedWhy.kind, 'place');
    assert.deepEqual([o.pausedWhy.disagreed, o.pausedWhy.of], [10, 10]);
    assert.equal(provider(q, 'gemini').paused, false);

    const before = f.calls.api.length;
    const [next] = placeKeys(false, 1);
    assert.deepEqual((await q.ask({ key: next, prompt: 'p', sensitivity: 'internal' })).value, pickOf('gemini'), 'Gemini takes over');
    assert.equal(f.calls.api.at(-1).opts.provider, 'gemini');
    assert.equal(f.calls.api.length, before + 1);

    const restarted = queue(smDir, f, TWO);
    assert.equal(provider(restarted, 'openai').paused, true, 'the pause survives a restart');
    restarted.resumeHelper('openai');
    assert.equal(provider(restarted, 'openai').paused, false);
    assert.equal(provider(restarted, 'openai').reviewed, 10, 'resuming keeps the history');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a few disagreements among many agreements do not pause an AI', async () => {
  const smDir = tmp();
  try {
    let n = 0;
    const f = fakes({ claude: () => ({ ok: true, value: { partId: n++ % 5 === 0 ? 'claude-pick' : 'openai-pick' }, costUSD: 0 }) });
    const q = queue(smDir, f);
    for (const key of placeKeys(true, 20)) await q.ask({ key, prompt: 'p' });
    const o = provider(q, 'openai');
    assert.deepEqual([o.reviewed, o.agreed, o.paused], [20, 16, false], '20% disagreement is under the 30% line');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the queue reports no others fields when no settings source is wired', () => {
  const smDir = tmp();
  try {
    const q = new AiQueue({ smDir, bin: 'claude', run: async () => ({ ok: true, value: {}, costUSD: 0 }), now: () => NOON });
    assert.deepEqual(Object.keys(q.status()).sort(), ['enabled', 'model', 'queue', 'spentUSDToday']);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
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
    assert.equal(provider(q, 'openai').agreed, 3);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('an answer that fails the caller\'s check goes to Claude, is never cached and counts against that AI', async () => {
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
    const o = provider(q, 'openai');
    assert.deepEqual([o.reviewed, o.agreed], [1, 0]);
    assert.equal(q.status().spentByProviderToday.openai, 0.0001, 'the outside call is still paid for');
    const cache = JSON.parse(readFileSync(join(smDir, 'ai-cache.json'), 'utf8')).cache;
    assert.deepEqual(Object.values(cache).map((c) => c.value), [{ partId: 'orders' }]);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('recordSpend books a cost outside the queue (the page\'s test call) against the one daily cap', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f);
    q.recordSpend('gemini', 1.2);
    assert.equal(q.status().spentByProviderToday.gemini, 1.2);
    assert.equal(q.status().others.capReached, true);
    assert.equal(q.spentToday('gemini'), 1.2);
    assert.equal(q.outsideSpentToday(), 1.2);
    const [key] = placeKeys(false, 1);
    await q.ask({ key, prompt: 'p' });
    assert.equal(f.calls.api.length, 0, 'Gemini\'s spend stops OpenAI too: one cap for all');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('lifeOf reads the settings and the saved keys on every call, so the page can switch the others without a restart', async () => {
  const smDir = tmp();
  const ARCH = { layers: [], parts: [{ id: 'orders', name: 'Orders', about: 'Builds the basket.', codePaths: [] }] };
  try {
    const f = fakes({ api: (prompt, opts) => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.0002, provider: opts.provider }) });
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: f.run, apiRun: f.apiRun, keyOf: f.keyOf });
    // An unclassified project is a client one and stays with Claude (ai-project-class.test.mjs): this one is the owner's own.
    const root = join(smDir, 'shop');
    const p = { smDir, projectId: projectIdOf(root), arch: ARCH };
    const own = { projectClass: { [normalizePath(root)]: 'internal' } };
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: own } }));
    // Digests whose place keys Claude will not review, so each call goes to one AI only.
    const digests = [];
    for (let i = 0; digests.length < 3; i++) {
      const digest = { title: `t${i}`, branch: null, prompts: [], files: [], commits: [] };
      if (!reviewPicks(aiKeyHash({ kind: 'place', digest, parts: [['orders', 'Orders', 'Builds the basket.']] }))) digests.push(digest);
    }
    placeChanged(life, p, [{ sessionId: 'a', digest: digests[0] }]);
    await settleAi(smDir);
    assert.equal(f.calls.claude.length, 1, 'no key saved: Claude does it');
    assert.equal(f.calls.api.length, 0);
    assert.equal(aiStatus(life, p.projectId).others.enabled, false);

    // A key saved from the page: on by default, no config needed.
    writeFileSync(join(smDir, 'ai-keys.json'), JSON.stringify({ version: 1, keys: { gemini: { scheme: 'fake', data: 'sealed', last4: 'cdef' } } }));
    placeChanged(life, p, [{ sessionId: 'b', digest: digests[1] }]);
    await settleAi(smDir);
    assert.equal(f.calls.api.length, 1);
    assert.equal(f.calls.api[0].opts.provider, 'gemini');
    assert.equal(f.calls.api[0].opts.model, 'gemini-3.1-flash-lite');
    assert.deepEqual(f.calls.keyOf, ['gemini']);
    const s = aiStatus(life, p.projectId);
    assert.equal(s.others.enabled, true);
    assert.equal(s.others.dailyUSD, 1);
    assert.equal(s.others.providers.find((x) => x.id === 'gemini').hasKey, true);
    assert.equal(s.helper.enabled, false, 'the old single-helper view is still there for the page until it moves');

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: false, ...own } } }));
    placeChanged(life, p, [{ sessionId: 'c', digest: digests[2] }]);
    await settleAi(smDir);
    assert.equal(f.calls.api.length, 1, 'switched off from the page');
    assert.equal(f.calls.claude.length, 2);
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a place call that times out after leaving is booked at its estimate, not at $0', async () => {
  const { runApiJSON } = await import('../server/ai/providers.mjs');
  const smDir = tmp();
  try {
    const hang = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const f = fakes();
    const q = queue(smDir, { ...f, apiRun: (prompt, opts) => runApiJSON(prompt, { ...opts, fetchFn: hang, timeoutMs: 10 }) });
    const [key] = placeKeys(false, 1);
    const res = await q.ask({ key, prompt: 'place it', schemaHint: '{"partId": string}' });
    assert.equal(res.ok, true, 'Claude answered instead');
    assert.ok(provider(q, 'openai').spentUSDToday > 0, 'the timed-out call is booked');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a place call whose helper threw is booked at its estimate: nobody knows whether it left', async () => {
  const smDir = tmp();
  try {
    const f = fakes({ api: () => { throw new Error('boom'); } });
    const q = queue(smDir, f);
    const [key] = placeKeys(false, 1);
    assert.equal((await q.ask({ key, prompt: 'place it' })).ok, true);
    assert.ok(provider(q, 'openai').spentUSDToday > 0);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a place ask that does not say how private it is is not kept from Gemini nor DeepSeek either', async () => {
  const smDir = tmp();
  try {
    const f = fakes();
    const q = queue(smDir, f, others({ keys: ['gemini', 'deepseek'] }));
    const [a, b] = placeKeys(false, 2);
    const first = (await q.ask({ key: a, prompt: 'digest' })).value;
    assert.ok([pickOf('gemini'), pickOf('deepseek')].some((p) => p.partId === first.partId), 'no sensitivity: an outside AI answers');
    assert.equal(f.calls.api.length, 1, 'the class is only a label');
    assert.ok((await q.ask({ key: b, prompt: 'digest', sensitivity: 'internal' })).value.partId !== 'claude-pick', 'said internal: an outside AI answers too');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
