import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { emptyHelperState, recordReview } from '../server/ai/review.mjs';

// A lock that is not one (the real DPAPI takes a second): it only has to be reversible and not look like the key.
const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const KEY = 'sk-or-v1-SECRETSECRETSECRET1234';
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-aih-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-aih-sm-'));
  const calls = [];
  const apiRun = async (prompt, o) => { calls.push({ prompt, provider: o.provider, key: o.key, model: o.model }); return opts.reply ?? { ok: true, value: { ok: true }, costUSD: 0.00002, provider: o.provider }; };
  if (opts.seed) opts.seed(smDir);
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, helpers: { backend, apiRun }, ...(opts.demo ? { demo: true, token: 'x' } : {}) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = opts.demo ? 'x' : loadToken(smDir);
  const call = (method, path, { auth = false, body } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, ...(auth ? { cookie: `sm_token=${token}` } : {}), ...(method !== 'GET' ? { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1', 'content-type': 'application/json' } : {}) };
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, smDir, calls });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const everyFile = (smDir) => readdirSync(smDir).filter((f) => !f.endsWith('.secret')).map((f) => readFileSync(join(smDir, f), 'utf8')).join('\n');
const post = (call, body) => call('POST', '/api/settings/ai-helpers', { auth: true, body });

test('every route needs the token', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/settings/ai-helpers')).status, 401);
    assert.equal((await call('POST', '/api/settings/ai-helpers', { body: { provider: 'openrouter', key: KEY } })).status, 401);
    assert.equal((await call('DELETE', '/api/settings/ai-helpers?provider=openrouter')).status, 401);
    assert.equal((await call('POST', '/api/settings/ai-helpers/test', { body: { provider: 'openrouter' } })).status, 401);
  });
});

test('the demo never touches keys', async () => {
  await withServer({ demo: true }, async ({ call }) => {
    assert.equal((await call('GET', '/api/settings/ai-helpers', { auth: true })).status, 403);
    assert.equal((await post(call, { provider: 'openrouter', key: KEY })).status, 403);
    assert.equal((await call('DELETE', '/api/settings/ai-helpers?provider=openrouter', { auth: true })).status, 403);
    assert.equal((await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } })).status, 403);
  });
});


test('reading gives the catalog, the keys set, the one cap and each AI\'s state, and no secret', async () => {
  await withServer({}, async ({ call }) => {
    const got = await call('GET', '/api/settings/ai-helpers', { auth: true });
    assert.equal(got.status, 200);
    assert.deepEqual(got.json.providers.map((p) => p.id).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
    assert.deepEqual(got.json.keys, []);
    assert.equal(got.json.others.enabled, false, 'with no key there is nothing to use');
    assert.equal(got.json.others.dailyUSD, 1);
    assert.deepEqual(got.json.others.off, []);
    assert.equal('helper' in got.json, false, 'the single-helper choice is gone');
    assert.equal(got.json.status.others.dailyUSD, 1);
    assert.deepEqual(got.json.status.others.providers.map((p) => p.id).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
    assert.equal(got.json.providers.some((p) => 'extraBody' in p), false);
  });
});

test('a saved key is answered, listed, logged and stored without its text, and switches the others on by itself', async () => {
  await withServer({}, async ({ call, smDir }) => {
    const saved = await post(call, { provider: 'openrouter', key: KEY });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.keys[0].provider, 'openrouter');
    assert.equal(saved.json.keys[0].last4, KEY.slice(-4));
    assert.equal(saved.json.others.enabled, true);
    assert.equal(saved.json.status.others.providers.find((p) => p.id === 'openrouter').hasKey, true);
    const got = await call('GET', '/api/settings/ai-helpers', { auth: true });
    assert.equal(got.json.keys[0].last4, KEY.slice(-4));
    for (const r of [saved, got]) assert.equal(r.text.includes(KEY), false, 'the key is in a response');
    assert.equal(everyFile(smDir).includes(KEY), false, 'the key is in a file');
    assert.match(readFileSync(join(smDir, 'actions.log'), 'utf8'), /"action":"ai-helpers"/);
  });
});

test('a key that cannot be one is refused and nothing is stored', async () => {
  await withServer({}, async ({ call }) => {
    for (const body of [{ provider: 'nope', key: KEY }, { provider: 'openrouter', key: 'short' }, { provider: 'openrouter', key: 'has a space in the middle' }, { provider: 'openrouter', key: 12345678901234 }, null]) {
      const r = await post(call, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.text.includes('has a space'), false);
    }
    assert.deepEqual((await call('GET', '/api/settings/ai-helpers', { auth: true })).json.keys, []);
  });
});

test('switching an AI off and on, and the one cap, go to config.json in the new shape next to what the person wrote', async () => {
  const seed = (smDir) => writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: 5, ai: { maxCallsPerHour: 7 } }));
  await withServer({ seed }, async ({ call, smDir }) => {
    await post(call, { provider: 'deepseek', key: KEY });
    const off = await post(call, { provider: 'deepseek', on: false });
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.others.off, ['deepseek']);
    assert.equal(off.json.status.others.providers.find((p) => p.id === 'deepseek').on, false);
    const capped = await post(call, { dailyUSD: 0.25 });
    assert.equal(capped.json.others.dailyUSD, 0.25);
    assert.equal(capped.json.status.others.dailyUSD, 0.25);
    const config = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    assert.equal(config.budget, 5);
    assert.equal(config.ai.maxCallsPerHour, 7);
    assert.deepEqual(config.ai.others.off, ['deepseek']);
    assert.equal(config.ai.others.dailyUSD, 0.25);
    assert.equal('helper' in config.ai || 'helperDailyUSD' in config.ai, false);
    const on = await post(call, { provider: 'deepseek', on: true });
    assert.deepEqual(on.json.others.off, []);
    assert.equal(on.json.others.enabled, true);
  });
});

test('the old single-helper config is read as before and written away in the new shape on the first save', async () => {
  const old = { ai: { maxCallsPerHour: 7, helper: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', enabled: true }, helperDailyUSD: 0.25 } };
  await withServer({ seed: (smDir) => writeFileSync(join(smDir, 'config.json'), JSON.stringify(old)) }, async ({ call, smDir }) => {
    const got = await call('GET', '/api/settings/ai-helpers', { auth: true });
    assert.equal(got.json.others.dailyUSD, 0.25);
    assert.equal(got.json.others.enabled, true);
    assert.deepEqual(got.json.others.models, {}, 'the old model is not carried over: the router picks per kind of work');
    const saved = await post(call, { provider: 'gemini', on: false });
    assert.equal(saved.status, 200);
    const config = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    assert.equal('helper' in config.ai || 'helperDailyUSD' in config.ai, false);
    assert.equal(config.ai.others.dailyUSD, 0.25);
    assert.equal(config.ai.others.models, undefined);
    assert.equal(config.ai.maxCallsPerHour, 7);
  });
});

test('an AI cannot be switched on without a key, and wrong requests are refused', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await post(call, { provider: 'openrouter', on: true })).status, 409);
    assert.equal((await post(call, { provider: 'nope', on: false })).status, 400);
    assert.equal((await post(call, { provider: 'openrouter', on: 'yes' })).status, 400);
    assert.equal((await post(call, { enabled: 'yes' })).status, 400);
    assert.equal((await post(call, { dailyUSD: -1 })).status, 400);
    assert.equal((await post(call, { dailyUSD: 'a lot' })).status, 400);
    assert.equal((await post(call, { dailyUSD: 1e9 })).status, 400);
    assert.equal((await post(call, { helper: { provider: 'openrouter', enabled: true } })).status, 400, 'the old single choice is gone');
    assert.equal((await post(call, {})).status, 400);
  });
});

test('the master switch sends everything back to Claude and back', async () => {
  await withServer({}, async ({ call }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    const off = await post(call, { enabled: false });
    assert.equal(off.json.others.enabled, false);
    assert.equal(off.json.status.others.enabled, false);
    assert.equal((await post(call, { enabled: true })).json.others.enabled, true);
  });
});

test('removing a key keeps the switch as it was, and the AI is left out of the choosing', async () => {
  await withServer({}, async ({ call }) => {
    await post(call, { provider: 'gemini', key: KEY });
    const gone = await call('DELETE', '/api/settings/ai-helpers?provider=gemini', { auth: true });
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.json.keys, []);
    assert.equal(gone.json.status.others.providers.find((p) => p.id === 'gemini').hasKey, false);
    assert.equal((await call('DELETE', '/api/settings/ai-helpers?provider=nope', { auth: true })).status, 400);
  });
});

const pausedSeed = (config) => (smDir) => {
  const helper = emptyHelperState();
  for (let i = 0; i < 12; i++) recordReview(helper, 'openrouter', 'place', i % 2 === 0, '2026-10-10T10:00:00Z');
  writeFileSync(join(smDir, 'ai-cache.json'), JSON.stringify({ helper }));
  if (config) writeFileSync(join(smDir, 'config.json'), JSON.stringify(config));
};

test('pressing "on" again gives a paused AI another chance, as the page says', async () => {
  await withServer({ seed: pausedSeed({ ai: { others: { dailyUSD: 1 } } }) }, async ({ call }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    const row = (r) => r.json.status.others.providers.find((p) => p.id === 'openrouter');
    const before = await call('GET', '/api/settings/ai-helpers', { auth: true });
    assert.equal(row(before).paused, true);
    assert.equal(row(before).pausedWhy.kind, 'place');
    const again = await post(call, { provider: 'openrouter', on: true });
    assert.equal(again.status, 200);
    assert.equal(row(again).paused, false);
  });
});

test('switching an AI off and on clears an old pause too', async () => {
  await withServer({ seed: pausedSeed() }, async ({ call }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    await post(call, { provider: 'openrouter', on: false });
    const on = await post(call, { provider: 'openrouter', on: true });
    assert.equal(on.json.status.others.providers.find((p) => p.id === 'openrouter').paused, false);
  });
});

test('the test makes one tiny call with the stored key and answers only ok and the cost', async () => {
  await withServer({}, async ({ call, calls }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    const r = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, costUSD: 0.00002 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, KEY);
    assert.match(calls[0].prompt, /"ok": true/);
    assert.equal(r.text.includes(KEY), false);
  });
});

test('a test without a key, with a failing provider or with an unknown provider says so briefly', async () => {
  await withServer({ reply: { ok: false, error: 'http-401', provider: 'openrouter' } }, async ({ call, calls }) => {
    const none = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    assert.equal(none.status, 409);
    assert.deepEqual(none.json, { ok: false, error: 'no-key' });
    assert.equal(calls.length, 0, 'no call goes out without a key');
    await post(call, { provider: 'openrouter', key: KEY });
    const bad = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    assert.equal(bad.status, 502);
    assert.deepEqual(bad.json, { ok: false, error: 'http-401' });
    assert.equal((await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'nope' } })).status, 400);
  });
});

test('tests are limited to a few per minute', async () => {
  await withServer({}, async ({ call, calls }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429, 429]);
    assert.equal(calls.length, 5);
  });
});

test('a test call is booked in the spend of the day, uses the model in use and stops at the one daily cap', async () => {
  const config = { ai: { others: { dailyUSD: 0.00006, models: { openrouter: 'google/gemini-2.5-flash-lite' } } } };
  await withServer({ seed: (smDir) => writeFileSync(join(smDir, 'config.json'), JSON.stringify(config)) }, async ({ call, calls }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    const first = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    assert.equal(first.status, 200);
    assert.equal(calls[0].model, 'google/gemini-2.5-flash-lite');
    const got = await call('GET', '/api/settings/ai-helpers', { auth: true });
    assert.equal(got.json.status.spentByProviderToday.openrouter, 0.00002);
    const row = got.json.status.others.providers.find((p) => p.id === 'openrouter');
    assert.equal(row.spentUSDToday, 0.00002);
    assert.equal(row.calls, 1);
    assert.equal(got.json.status.others.spentUSDToday, 0.00002);
    assert.equal((await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } })).status, 200);
    const over = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    assert.equal(over.status, 429);
    assert.deepEqual(over.json, { ok: false, error: 'cap-reached' });
    assert.equal(calls.length, 2, 'no call goes out over the cap');
  });
});

test('the cap is for all the AIs together: what one spent leaves less for the test of another', async () => {
  const config = { ai: { others: { dailyUSD: 0.00006, models: { openrouter: 'google/gemini-2.5-flash-lite' } } } };
  await withServer({ seed: (smDir) => writeFileSync(join(smDir, 'config.json'), JSON.stringify(config)) }, async ({ call, calls }) => {
    await post(call, { provider: 'openrouter', key: KEY });
    await post(call, { provider: 'deepseek', key: KEY });
    await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'openrouter' } });
    const other = await call('POST', '/api/settings/ai-helpers/test', { auth: true, body: { provider: 'deepseek' } });
    assert.equal(other.status, 429, 'deepseek is stopped by what openrouter spent');
    assert.equal(calls.length, 2);
  });
});
