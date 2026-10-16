import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshBalances } from '../server/ai/balance-watch.mjs';
import { balanceOf, preflight, quotaFile, readQuota } from '../server/ai/quota.mjs';

// The balance is fetched, not only parsed (id156): DeepSeek's and OpenRouter's feeds, with their own key, kept where the
// pre-flight reads them.

const deepseekAnswer = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '3.40' }] };
const answerOf = (url) => (url.includes('deepseek') ? deepseekAnswer : { data: { total_credits: 10, total_usage: 2.5 } });
const withDir = (fn) => async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bal-'));
  try { await fn(smDir); } finally { rmSync(smDir, { recursive: true, force: true }); }
};

test('each feed is asked with its own key, at its own address, and the balance is saved for the pre-flight', withDir(async (smDir) => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, auth: opts.headers.authorization });
    return { ok: true, status: 200, json: async () => answerOf(url) };
  };
  const state = await refreshBalances({ smDir, keyOf: (p) => `key-${p}`, fetchFn, now: () => 1_000 });
  assert.deepEqual(calls.map((c) => c.url), ['https://api.deepseek.com/user/balance', 'https://openrouter.ai/api/v1/credits']);
  assert.equal(calls[0].auth, 'Bearer key-deepseek');
  assert.equal(balanceOf(state, 'deepseek'), 3.4);
  assert.equal(balanceOf(state, 'openrouter'), 7.5);
  assert.equal(balanceOf(readQuota(smDir), 'deepseek'), 3.4, 'written where the pre-flight reads it');
  assert.equal(preflight(readQuota(smDir), 'deepseek', 5).reason, 'no-balance', 'a call the balance cannot pay is now refused');
  assert.equal(preflight(readQuota(smDir), 'deepseek', 1).ok, true);
}));

test('a provider without a key is not asked, and a fresh reading is not asked again within five minutes', withDir(async (smDir) => {
  let n = 0;
  const fetchFn = async (url) => { n += 1; return { ok: true, status: 200, json: async () => answerOf(url) }; };
  await refreshBalances({ smDir, keyOf: (p) => (p === 'deepseek' ? 'k' : null), fetchFn, now: () => 1_000 });
  assert.equal(n, 1, 'only the one with a key');
  await refreshBalances({ smDir, keyOf: () => 'k', fetchFn, now: () => 1_000 + 60_000, providers: ['deepseek'] });
  assert.equal(n, 1, 'one minute later: the reading stands');
  await refreshBalances({ smDir, keyOf: () => 'k', fetchFn, now: () => 1_000 + 6 * 60_000, providers: ['deepseek'] });
  assert.equal(n, 2, 'after five minutes: asked again');
}));

test('a refusal or a broken answer keeps what was known and never throws or says the key', withDir(async (smDir) => {
  writeFileSync(quotaFile(smDir), JSON.stringify({ providers: { deepseek: { balanceUSD: 2, checkedAt: 1 } } }));
  const bad = await refreshBalances({ smDir, keyOf: () => 'secret-key', now: () => 10 * 60_000, providers: ['deepseek'], fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  assert.equal(balanceOf(bad, 'deepseek'), 2, 'the old reading stays');
  const boom = await refreshBalances({ smDir, keyOf: () => 'secret-key', now: () => 10 * 60_000, providers: ['deepseek'], fetchFn: async () => { throw new Error('secret-key leaked here'); } });
  assert.equal(balanceOf(boom, 'deepseek'), 2);
  assert.ok(!readFileSync(quotaFile(smDir), 'utf8').includes('secret-key'));
}));

test('the Cérebro route looks the balance up when the tab opens, and a slow or failed look never fails the page', withDir(async (smDir) => {
  const { createBrainRoutes } = await import('../server/ai/brainroute.mjs');
  const req = { method: 'GET', headers: { host: '127.0.0.1:4001', 'x-session-map-token': 'tok' } };
  const url = new URL('http://127.0.0.1:4001/api/ai/brain');
  const ok = createBrainRoutes({
    smDir, token: 'tok',
    balances: async () => { writeFileSync(quotaFile(smDir), JSON.stringify({ providers: { deepseek: { balanceUSD: 6.5, checkedAt: Date.now() } } })); },
  });
  const res = await ok.handle(req, url, '127.0.0.1');
  assert.equal(res.status, 200);
  assert.equal(res.body.matrix.find((m) => m.id === 'deepseek').balanceUSD, 6.5, 'the page shows the balance that was just read');
  const failing = createBrainRoutes({ smDir, token: 'tok', balances: async () => { throw new Error('network down'); } });
  const still = await failing.handle(req, url, '127.0.0.1');
  assert.equal(still.status, 200, 'a failed look: the page still opens');
  assert.equal(still.body.matrix.find((m) => m.id === 'deepseek').balanceUSD, 6.5, 'and shows what was known');
}));

test('the Cérebro\'s configure chat runs on the brain row\'s AI, model and level (id156)', withDir(async (smDir) => {
  const { createBrainRoutes } = await import('../server/ai/brainroute.mjs');
  const { setKey } = await import('../server/ai/keys.mjs');
  const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
  for (const p of ['deepseek', 'openai']) await setKey(smDir, p, `${p}-fake-key-0000000000000000`, { backend });
  const asked = [];
  const apiRun = async (prompt, o) => { asked.push({ provider: o.provider, model: o.model, effort: o.effort }); return { ok: true, value: { changes: [], why: 'nothing to change' }, costUSD: 0.0002 }; };
  const post = (routes) => routes.handle({ method: 'POST', headers: { host: '127.0.0.1:4001', 'x-session-map-token': 'tok' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text: 'só testando' })); } }, new URL('http://127.0.0.1:4001/api/ai/brain/configure'), '127.0.0.1');
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { brain: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } } } } }));
  const routes = createBrainRoutes({ smDir, token: 'tok', apiRun, keyOf: async () => 'sk-fake' });
  const res = await post(routes);
  assert.equal(res.status, 200);
  assert.deepEqual(asked, [{ provider: 'deepseek', model: 'deepseek-flash', effort: 'low' }], 'the row\'s level rides on the call');
  // A level the AI does not take is never forced.
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { brain: { provider: 'openai', model: 'gpt-6-luna', effort: 'low' } } } } }));
  asked.length = 0;
  await post(createBrainRoutes({ smDir, token: 'tok', apiRun, keyOf: async () => 'sk-fake' }));
  assert.equal(asked[0].effort, undefined, 'gpt-6-luna takes only "none": a real call refused "low" with a 400');
}));
