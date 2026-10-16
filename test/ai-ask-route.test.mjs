import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { setKey } from '../server/ai/keys.mjs';
import { forgetLife } from '../server/ai/life.mjs';

// POST /api/ai/ask and GET /api/ai/others (or14): Claude asks the other AIs through session-map, which holds the keys,
// the cap and the privacy rules. The token comes from the page's cookie or, for the stdio tool, the x-session-map-token
// header; loopback only, never in the demo, 30 asks a minute, and the actions log never holds a prompt or an answer.

const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const KEYS = { openai: 'sk-proj-OPENAISECRET0000000000001234', deepseek: 'sk-DEEPSEEKSECRET00000000000005678', gemini: 'AIzaGEMINISECRET000000000000000009999' };
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };
const PROMPT = 'Is this function correct? function add(a, b) { return a - b }';
const ANSWER = 'No: it subtracts. PRIVATE-ANSWER-WORDS';

const asJson = (textRun) => async (prompt, o) => {
  const r = await textRun(prompt, o);
  return r?.ok ? { ...r, value: { verdict: r.text } } : r;
};

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-ask-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-ask-sm-'));
  if (opts.seed) await opts.seed(smDir);
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state,
    // A review asks for the review shape (id142): without its own JSON fake, the text fake answers it, so no test reaches a real provider.
    helpers: { backend, ...(opts.textRun ? { textRun: opts.textRun } : {}), ...(opts.apiRun || opts.textRun ? { apiRun: opts.apiRun ?? asJson(opts.textRun) } : {}) },
    ...(opts.ask ? { askAi: { ask: opts.ask } } : {}),
    ...(opts.address ? { addressOf: () => opts.address } : {}),
    ...(opts.demo ? { demo: true, token: 'x'.repeat(64) } : {}),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = opts.demo ? 'x'.repeat(64) : loadToken(smDir);
  // auth: 'cookie' (the page), 'header' (the stdio tool), a wrong token string, or nothing.
  const call = (method, path, { auth, body, raw, host = `127.0.0.1:${port}` } = {}) => new Promise((resolve, reject) => {
    const headers = { host };
    if (auth === 'cookie') Object.assign(headers, { cookie: `sm_token=${token}` });
    if (auth === 'header') headers['x-session-map-token'] = token;
    if (typeof auth === 'object' && auth?.header) headers['x-session-map-token'] = auth.header;
    if (method !== 'GET' && auth !== 'header' && !(typeof auth === 'object')) Object.assign(headers, { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1' });
    if (method !== 'GET') headers['content-type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
  try {
    await fn({ call, smDir, token, base: `http://127.0.0.1:${port}` });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    forgetLife(smDir);
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const okAsk = (seen = []) => async (args) => {
  seen.push(args);
  return { ok: true, answers: [{ provider: 'openai', model: 'gpt-6.1-sol', text: ANSWER, costUSD: 0.0012, ms: 40 }], skipped: [{ provider: 'deepseek', why: 'sensitivity' }] };
};
const askBody = { kind: 'review', sensitivity: 'internal', prompt: PROMPT };
const actionsLog = (smDir) => { try { return readFileSync(join(smDir, 'actions.log'), 'utf8'); } catch { return ''; } };

test('asking needs the token: none, a wrong one, or a cross-site post are refused', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { body: askBody })).status, 401);
    assert.equal((await call('POST', '/api/ai/ask', { auth: { header: 'f'.repeat(64) }, body: askBody })).status, 401);
    assert.equal((await call('GET', '/api/ai/others')).status, 401);
    assert.equal((await call('GET', '/api/ai/others', { auth: { header: 'f'.repeat(64) } })).status, 401);
    assert.equal(seen.length, 0, 'no AI was asked');
  });
});

test('the page asks with its cookie and the stdio tool with the header token', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    const byCookie = await call('POST', '/api/ai/ask', { auth: 'cookie', body: askBody });
    assert.equal(byCookie.status, 200);
    const byHeader = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, fanout: 2, author: 'openai', schemaHint: '{"ok": boolean}' } });
    assert.equal(byHeader.status, 200);
    assert.equal(byHeader.json.ok, true);
    assert.deepEqual(byHeader.json.answers, [{ provider: 'openai', model: 'gpt-6.1-sol', text: ANSWER, costUSD: 0.0012, ms: 40 }]);
    assert.deepEqual(byHeader.json.skipped, [{ provider: 'deepseek', why: 'sensitivity' }]);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].kind, 'review');
    assert.equal(seen[1].sensitivity, 'internal');
    assert.equal(seen[1].prompt, PROMPT);
    assert.equal(seen[1].fanout, 2);
    assert.equal(seen[1].author, 'openai');
    assert.equal(seen[1].schemaHint, '{"ok": boolean}');
    assert.ok(seen[1].queue, 'the map\'s own queue, so the cap ledger is shared');
  });
});

test('the demo never asks anyone', async () => {
  const seen = [];
  await withServer({ demo: true, ask: okAsk(seen) }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'cookie', body: askBody })).status, 403);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: askBody })).status, 403);
    assert.equal((await call('GET', '/api/ai/others', { auth: 'header' })).status, 403);
    assert.equal(seen.length, 0);
  });
});

test('only this computer may ask: another address or a foreign Host name is refused', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen), address: '192.168.0.20' }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: askBody })).status, 403);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'cookie', body: askBody })).status, 403);
    assert.equal((await call('GET', '/api/ai/others', { auth: 'header' })).status, 403);
  });
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: askBody, host: 'evil.example:4001' })).status, 403);
  });
  assert.equal(seen.length, 0);
});

test('the header token opens only the AI routes, nothing else', async () => {
  await withServer({ ask: okAsk() }, async ({ call }) => {
    assert.equal((await call('POST', '/api/settings/notify', { auth: 'header', body: {} })).status, 403);
    assert.equal((await call('POST', '/api/action', { auth: 'header', body: {} })).status, 403);
  });
});

test('more than 30 asks in a minute are refused', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    for (let i = 0; i < 30; i++) assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: askBody })).status, 200);
    const over = await call('POST', '/api/ai/ask', { auth: 'header', body: askBody });
    assert.equal(over.status, 429);
    assert.equal(over.json.error, 'too-many-asks');
    assert.equal(seen.length, 30);
  });
});

test('a broken or oversized body is refused before any AI is asked', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', raw: '{not json' })).status, 400);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: ['a'] })).status, 400);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, author: 'x'.repeat(200) } })).status, 400);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, fanout: 'many' } })).status, 400);
    const huge = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, prompt: 'x'.repeat(2 * 1024 * 1024) } });
    assert.equal(huge.status, 413);
    assert.equal(seen.length, 0);
  });
});

test('each refusal of askOthers has its own status, with the reasons and no prompt', async () => {
  const cases = [['bad-kind', 400], ['bad-sensitivity', 400], ['no-prompt', 400], ['bad-schema', 400], ['prompt-too-big', 413], ['others-off', 409], ['no-ai-available', 503], ['all-failed', 502]];
  for (const [error, status] of cases) {
    await withServer({ ask: async () => ({ ok: false, error, answers: [], skipped: [{ provider: 'openai', why: 'cap' }] }) }, async ({ call }) => {
      const got = await call('POST', '/api/ai/ask', { auth: 'header', body: askBody });
      assert.equal(got.status, status, error);
      assert.equal(got.json.ok, false);
      assert.equal(got.json.error, error);
      assert.deepEqual(got.json.skipped, [{ provider: 'openai', why: 'cap' }]);
      assert.ok(!got.text.includes(PROMPT));
    });
  }
});

test('the actions log says who asked what kind, never the prompt or the answer', async () => {
  await withServer({ ask: okAsk() }, async ({ call, smDir }) => {
    await call('POST', '/api/ai/ask', { auth: 'header', body: askBody });
    const log = actionsLog(smDir);
    assert.match(log, /"action":"ai-ask"/);
    assert.match(log, /"mode":"review"/);
    assert.match(log, /"scope":"internal"/);
    assert.match(log, /"count":1/);
    assert.ok(!log.includes('subtracts') && !log.includes('PRIVATE-ANSWER') && !log.includes('function add'));
  });
});

// The real askOthers behind the route, with the keys locked by a fake lock and the providers' call replaced.
async function seedKeys(smDir, providers = ['openai', 'deepseek', 'gemini'], others = { enabled: true, dailyUSD: 1 }) {
  for (const p of providers) await setKey(smDir, p, KEYS[p], { backend });
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others } }));
}

test('end to end: the router picks another family, the answer comes back, and the spend shows in the list', async () => {
  const calls = [];
  const textRun = async (prompt, o) => { calls.push({ prompt, ...o }); return { ok: true, text: ANSWER, costUSD: 0.002, provider: o.provider, model: o.model }; };
  await withServer({ seed: (smDir) => seedKeys(smDir), textRun }, async ({ call, smDir }) => {
    const got = await call('POST', '/api/ai/ask', { auth: 'header', body: { kind: 'review', sensitivity: 'client', prompt: PROMPT } });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.json.answers.length, 1);
    assert.deepEqual(got.json.answers[0].value, { verdict: ANSWER }, 'a review comes back in the review shape (id142)');
    assert.equal(calls[0].key, KEYS[calls[0].provider], 'the key is fetched inside the server');
    assert.ok(!got.json.skipped.some((s) => s.why === 'sensitivity'), 'the data class keeps no AI from the work');
    for (const k of Object.values(KEYS)) {
      assert.ok(!got.text.includes(k), 'no key in the answer');
      assert.ok(!actionsLog(smDir).includes(k), 'no key in the log');
    }

    const list = await call('GET', '/api/ai/others', { auth: 'header' });
    assert.equal(list.status, 200);
    assert.equal(list.json.ok, true);
    assert.equal(list.json.enabled, true);
    assert.equal(list.json.dailyUSD, 1);
    assert.ok(list.json.spentUSDToday >= 0.002, 'the ask counts against the one daily cap');
    assert.deepEqual(list.json.providers.map((p) => p.id).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
    const openai = list.json.providers.find((p) => p.id === 'openai');
    assert.equal(openai.hasKey, true);
    assert.equal(openai.on, true);
    assert.equal(list.json.providers.find((p) => p.id === 'openrouter').hasKey, false);
    assert.deepEqual(list.json.kinds, ['review', 'bulk', 'code', 'read', 'portuguese', 'reasoning']);
    assert.deepEqual(list.json.sensitivities, ['public', 'internal', 'client']);
    for (const k of Object.values(KEYS)) assert.ok(!list.text.includes(k) && !list.text.includes(k.slice(-4)), 'no key, not even its end');
  });
});

test('end to end: with the other AIs switched off nobody is asked', async () => {
  const calls = [];
  const textRun = async (prompt, o) => { calls.push(o.provider); return { ok: true, text: 'x', costUSD: 0.001 }; };
  await withServer({ seed: (smDir) => seedKeys(smDir, ['openai'], { enabled: false, dailyUSD: 1 }), textRun }, async ({ call }) => {
    const got = await call('POST', '/api/ai/ask', { auth: 'header', body: askBody });
    assert.equal(got.status, 409);
    assert.equal(got.json.error, 'others-off');
    const list = await call('GET', '/api/ai/others', { auth: 'header' });
    assert.equal(list.json.enabled, false);
    assert.equal(calls.length, 0);
  });
});

test('end to end: the stdio tool, spawned for real, asks through the real server', async () => {
  const { spawn } = await import('node:child_process');
  const { createInterface } = await import('node:readline');
  const textRun = async (prompt, o) => ({ ok: true, text: `${o.provider} says hello`, costUSD: 0.001, provider: o.provider, model: o.model });
  await withServer({ seed: (smDir) => seedKeys(smDir, ['openai']), textRun }, async ({ smDir, base }) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'server', 'ai', 'arsenal-mcp.mjs')], { env: { ...process.env, SM_URL: base, SM_DIR: smDir }, stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = createInterface({ input: child.stdout });
    const answers = new Map();
    lines.on('line', (l) => { const m = JSON.parse(l); answers.get(m.id)?.(m); });
    const rpc = (id, method, params) => new Promise((resolve) => { answers.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
    try {
      await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      const got = await rpc(2, 'tools/call', { name: 'ask_other_ai', arguments: { kind: 'review', sensitivity: 'internal', prompt: 'Check this.' } });
      assert.equal(got.result.isError, false, got.result.content[0].text);
      assert.match(got.result.content[0].text, /openai says hello/);
      const list = await rpc(3, 'tools/call', { name: 'list_other_ais', arguments: {} });
      assert.match(list.result.content[0].text, /openai, model .*: ready \(spent today \$0\.00, 1 calls\)/);
    } finally {
      child.kill();
    }
  });
});

test('asks that arrive together cannot pass the 30-a-minute limit before any of them is counted', async () => {
  const { createAskRoutes, ASK_RATE_LIMIT } = await import('../server/ai/askroute.mjs');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-ask-rate-'));
  const token = 'b'.repeat(64);
  let asked = 0;
  const routes = createAskRoutes({ smDir, token, ask: async () => { asked++; return { ok: true, answers: [], skipped: [] }; } });
  const body = Buffer.from(JSON.stringify(askBody));
  const req = () => ({
    method: 'POST',
    headers: { host: '127.0.0.1:4001', 'x-session-map-token': token },
    async *[Symbol.asyncIterator]() { await new Promise((r) => setImmediate(r)); yield body; },
  });
  try {
    const url = new URL('http://127.0.0.1:4001/api/ai/ask');
    const got = await Promise.all(Array.from({ length: 100 }, () => routes.handle(req(), url, '127.0.0.1')));
    assert.equal(got.filter((r) => r.status === 200).length, ASK_RATE_LIMIT);
    assert.equal(got.filter((r) => r.status === 429).length, 100 - ASK_RATE_LIMIT);
    assert.equal(asked, ASK_RATE_LIMIT);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the server proves to the stdio tool that it knows the token, without giving it away', async () => {
  const { createHmac } = await import('node:crypto');
  await withServer({ ask: okAsk() }, async ({ call, token }) => {
    const nonce = 'ab'.repeat(32);
    const got = await call('GET', `/api/ai/hello?nonce=${nonce}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.proof, createHmac('sha256', token).update(`session-map-proof:${nonce}`).digest('hex'));
    assert.equal(got.text.includes(token), false);
    for (const bad of ['', 'xyz', 'ab'.repeat(8), 'ab'.repeat(200)]) assert.equal((await call('GET', `/api/ai/hello?nonce=${bad}`)).status, 400, bad);
  });
  await withServer({ ask: okAsk(), demo: true }, async ({ call }) => {
    assert.equal((await call('GET', `/api/ai/hello?nonce=${'ab'.repeat(32)}`)).status, 403);
  });
  await withServer({ ask: okAsk(), address: '192.168.0.9' }, async ({ call }) => {
    assert.notEqual((await call('GET', `/api/ai/hello?nonce=${'ab'.repeat(32)}`)).status, 200);
  });
});

test('exclude reaches askOthers as given, and a malformed one is refused before any AI is asked', async () => {
  const seen = [];
  await withServer({ ask: okAsk(seen) }, async ({ call }) => {
    const ok = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, exclude: ['openai:gpt-6.1-sol', 'deepseek'] } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(seen[0].exclude, ['openai:gpt-6.1-sol', 'deepseek']);
    for (const exclude of ['openai', [3], Array.from({ length: 21 }, (_, i) => `openai:m${i}`)]) {
      const bad = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, exclude } });
      assert.equal(bad.status, 400, JSON.stringify(exclude));
      assert.equal(bad.json.error, 'bad-exclude');
    }
    assert.equal(seen.length, 1);
  });
});
