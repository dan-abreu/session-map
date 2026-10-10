import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { setKey } from '../server/ai/keys.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { INTERNALS } from '../server/actions.mjs';

// The conductor's recommendation over HTTP (GET or POST /api/ai/recommend), the arsenal's pick_worker tool, and the
// day's tail that the chat hub appends to the conductor prompt.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MCP = join(ROOT, 'server', 'ai', 'arsenal-mcp.mjs');
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const KEYS = { openai: 'sk-proj-OPENAISECRET0000000000001234', deepseek: 'sk-DEEPSEEKSECRET00000000000005678', gemini: 'AIzaGEMINISECRET000000000000000009999' };
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };

async function seedKeys(smDir, providers = ['openai', 'deepseek', 'gemini'], others = { enabled: true, dailyUSD: 1 }) {
  for (const p of providers) await setKey(smDir, p, KEYS[p], { backend });
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others } }));
}

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-rec-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-rec-sm-'));
  if (opts.seed) await opts.seed(smDir);
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, helpers: { backend },
    ...(opts.address ? { addressOf: () => opts.address } : {}),
    ...(opts.demo ? { demo: true, token: 'x'.repeat(64) } : {}),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = opts.demo ? 'x'.repeat(64) : loadToken(smDir);
  const call = (method, path, { auth, body } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (auth === 'cookie') headers.cookie = `sm_token=${token}`;
    // A same-site page's post, so the server's own cross-site check does not answer first.
    if (method !== 'GET' && (auth === 'cookie' || auth === undefined)) Object.assign(headers, { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1' });
    if (auth === 'header') headers['x-session-map-token'] = token;
    if (typeof auth === 'object' && auth?.header) headers['x-session-map-token'] = auth.header;
    if (body !== undefined) headers['content-type'] = 'application/json';
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
    await fn({ call, smDir, base: `http://127.0.0.1:${port}` });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    forgetLife(smDir);
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const body = { kind: 'code', size: 'medium', sensitivity: 'internal' };

test('the recommendation needs the token and this computer, like asking', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/recommend', { body })).status, 401);
    assert.equal((await call('POST', '/api/ai/recommend', { auth: { header: 'f'.repeat(64) }, body })).status, 401);
    assert.equal((await call('GET', '/api/ai/recommend?kind=code&size=small&sensitivity=public')).status, 401);
    const ok = await call('POST', '/api/ai/recommend', { auth: 'header', body });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.worker.provider, 'claude');
    assert.equal(typeof ok.json.why, 'string');
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'cookie', body })).status, 200);
    const get = await call('GET', '/api/ai/recommend?kind=security&size=large&sensitivity=client&critical=true', { auth: 'header' });
    assert.equal(get.status, 200, get.text);
    assert.deepEqual(get.json.worker, { provider: 'claude', model: 'opus', effort: 'xhigh' }, 'large critical work: Opus does it');
    assert.deepEqual(get.json.finalCheck, { provider: 'claude', model: 'fable', effort: 'high' }, 'and Fable has the last word');
  });
  await withServer({ address: '192.168.0.20' }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body })).status, 403);
  });
  await withServer({ demo: true }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body })).status, 403);
  });
});

test('a bad request is refused with its reason', async () => {
  await withServer({}, async ({ call }) => {
    const kind = await call('POST', '/api/ai/recommend', { auth: 'header', body: { ...body, kind: 'dance' } });
    assert.equal(kind.status, 400);
    assert.equal(kind.json.error, 'bad-kind');
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body: { ...body, size: 'huge' } })).json.error, 'bad-size');
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body: { ...body, failedBefore: 'opus' } })).json.error, 'bad-failed');
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body: { ...body, author: 'x y' } })).json.error, 'bad-author');
    assert.equal((await call('POST', '/api/ai/recommend', { auth: 'header', body: [] })).status, 400);
  });
});

test('with real keys the outside AIs are offered, client data never to DeepSeek, keys never shown, and the reason is recorded', async () => {
  await withServer({ seed: (smDir) => seedKeys(smDir) }, async ({ call, smDir }) => {
    const r = await call('POST', '/api/ai/recommend', { auth: 'header', body: { kind: 'review', size: 'medium', sensitivity: 'client' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.worker.provider, 'openai');
    const all = [r.json.worker, ...r.json.alternatives, ...(r.json.reviewer ? [r.json.reviewer] : [])];
    assert.ok(all.every((w) => w.provider !== 'deepseek'));
    assert.ok(r.json.blocked.some((b) => b.provider === 'deepseek' && b.why === 'sensitivity'));
    for (const k of Object.values(KEYS)) assert.ok(!r.text.includes(k) && !r.text.includes(k.slice(-4)));
    const log = readFileSync(join(smDir, 'conductor.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log.at(-1).kind, 'review');
    assert.equal(log.at(-1).worker, 'openai:gpt-6.1-sol');
    assert.match(log.at(-1).why, /review/);
  });
  await withServer({ seed: (smDir) => seedKeys(smDir, ['openai'], { enabled: false, dailyUSD: 1 }) }, async ({ call }) => {
    const r = await call('POST', '/api/ai/recommend', { auth: 'header', body: { kind: 'review', size: 'medium', sensitivity: 'public' } });
    assert.equal(r.json.worker.provider, 'claude', 'others off: Claude only');
  });
});

// ---- pick_worker in the arsenal MCP ----

const TOKEN = 'a'.repeat(64);
const proofOf = (token, nonce) => createHmac('sha256', token).update(`session-map-proof:${nonce}`).digest('hex');

async function fakeServer(reply) {
  const seen = [];
  const server = createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { text += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      res.writeHead(200, { 'content-type': 'application/json' });
      if (u.pathname === '/api/ai/hello') return res.end(JSON.stringify({ ok: true, proof: proofOf(TOKEN, u.searchParams.get('nonce')) }));
      seen.push({ method: req.method, path: u.pathname, headers: req.headers, body: text ? JSON.parse(text) : null });
      const [status, json] = u.pathname === '/api/ai/recommend' ? reply(text ? JSON.parse(text) : null) : [404, { ok: false, error: 'not-found' }];
      res.statusCode = status;
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withMcp(reply, fn) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-pick-'));
  writeFileSync(join(smDir, 'token'), `${TOKEN}\n`);
  const fake = await fakeServer(reply);
  const child = spawn(process.execPath, [MCP], { env: { ...process.env, SM_URL: fake.url, SM_DIR: smDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); waiting.get(m.id)?.(m); });
  let next = 1;
  const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    await fn({ rpc, seen: fake.seen });
  } finally {
    child.kill();
    await fake.close();
    rmSync(smDir, { recursive: true, force: true });
  }
}

const REC = {
  ok: true,
  worker: { provider: 'claude', model: 'opus', effort: 'high' },
  alternatives: [{ provider: 'openai', model: 'gpt-6-astra', why: 'independent check' }],
  reviewer: { provider: 'openai', model: 'gpt-6.1-sol' },
  why: 'business, medium, internal data: Claude Opus at high (business work is decided by Opus)',
  blocked: [{ provider: 'deepseek', model: 'deepseek-v4-pro', why: 'sensitivity' }],
};

test('pick_worker is listed with its inputs, asks the server and reads the recommendation and its reason', async () => {
  await withMcp(() => [200, REC], async ({ rpc, seen }) => {
    const { tools } = (await rpc('tools/list', {})).result;
    const pick = tools.find((t) => t.name === 'pick_worker');
    assert.ok(pick, 'pick_worker is offered');
    assert.deepEqual(pick.inputSchema.required.sort(), ['kind', 'sensitivity', 'size']);
    assert.deepEqual(pick.inputSchema.properties.size.enum, ['trivial', 'small', 'medium', 'large']);
    assert.ok(pick.inputSchema.properties.kind.enum.includes('security'));
    assert.equal(pick.inputSchema.properties.critical.type, 'boolean');
    assert.equal(pick.inputSchema.properties.failedBefore.type, 'array');
    const got = (await rpc('tools/call', { name: 'pick_worker', arguments: { kind: 'business', size: 'medium', sensitivity: 'internal', critical: false, failedBefore: ['claude:sonnet'] } })).result;
    assert.equal(got.isError, false, got.content[0].text);
    const text = got.content[0].text;
    assert.match(text, /Claude Opus at high/);
    assert.match(text, /openai gpt-6\.1-sol/);
    assert.match(text, /business work is decided by Opus/);
    assert.match(text, /deepseek/);
    assert.match(text, /choice is yours/i);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].headers['x-session-map-token'], TOKEN);
    assert.deepEqual(seen[0].body, { kind: 'business', size: 'medium', sensitivity: 'internal', critical: false, failedBefore: ['claude:sonnet'] });
  });
});

test('pick_worker reads a refusal plainly', async () => {
  await withMcp(() => [400, { ok: false, error: 'bad-size' }], async ({ rpc }) => {
    const got = (await rpc('tools/call', { name: 'pick_worker', arguments: { kind: 'code', size: 'huge', sensitivity: 'public' } })).result;
    assert.equal(got.isError, true);
    assert.match(got.content[0].text, /bad-size/);
  });
});

test('end to end: pick_worker through the real server', async () => {
  await withServer({}, async ({ smDir, base }) => {
    const child = spawn(process.execPath, [MCP], { env: { ...process.env, SM_URL: base, SM_DIR: smDir }, stdio: ['pipe', 'pipe', 'inherit'] });
    const waiting = new Map();
    createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
    const rpc = (id, method, params) => new Promise((resolve) => { waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
    try {
      await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      const got = await rpc(2, 'tools/call', { name: 'pick_worker', arguments: { kind: 'architecture', size: 'large', sensitivity: 'internal', critical: true } });
      assert.equal(got.result.isError, false, got.result.content[0].text);
      assert.match(got.result.content[0].text, /Recommended worker: Claude Opus at xhigh/);
      assert.match(got.result.content[0].text, /Last word, after that review: Claude Fable at high/);
    } finally {
      child.kill();
    }
  });
});

// ---- the day's tail on the conductor prompt, at chat start ----

function makeState(root) {
  const s = { projects: [{ id: 'demo-abc123', name: 'demo', root, arch: { source: 'none', layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(s, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  return s;
}

test('a conductor chat starts with the day\'s tail after its prompt; the facts come from session-map, never a key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-tail-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-tail-sm-'));
  const log = join(mkdtempSync(join(tmpdir(), 'sm-tail-log-')), 'fake.json');
  const facts = {
    ok: true, enabled: true, dailyUSD: 2, spentUSDToday: 0.5, capReached: false, secret: KEYS.openai,
    providers: [{ id: 'openai', model: 'gpt-6-luna', hasKey: true, on: true, paused: false }],
  };
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: log }, conductorFacts: () => facts });
  try {
    const res = await hub.start({ projectId: 'demo-abc123', text: 'hi' }, makeState(root));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    let argv = null;
    for (let i = 0; i < 100 && !argv; i++) {
      try { argv = JSON.parse(readFileSync(log, 'utf8')).argv; } catch { await new Promise((r) => setTimeout(r, 50)); }
    }
    const prompt = argv[argv.indexOf('--append-system-prompt') + 1];
    assert.match(prompt, /pick_worker/);
    assert.match(prompt, /Outside AIs ready: openai \(gpt-6-luna\)/);
    assert.match(prompt, /\$1\.50 of \$2\.00/);
    assert.match(prompt, /not measured yet/);
    assert.ok(!prompt.includes(KEYS.openai));
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('an AI paused for the map bulk work is listed with the kinds it is paused for, and still recommended for a review', async () => {
  const seed = async (smDir) => {
    await seedKeys(smDir, ['openai']);
    writeFileSync(join(smDir, 'ai-cache.json'), JSON.stringify({ helper: { reviews: {}, paused: { 'openai:place': { code: 'disagreed', kind: 'place', disagreed: 10, of: 10, at: Date.now() } } } }));
  };
  await withServer({ seed }, async ({ call }) => {
    const list = await call('GET', '/api/ai/others', { auth: 'header' });
    const openai = list.json.providers.find((p) => p.id === 'openai');
    assert.equal(openai.paused, true);
    assert.deepEqual(openai.pausedKinds, ['place']);
    assert.deepEqual(list.json.providers.find((p) => p.id === 'gemini').pausedKinds, []);
    const r = await call('POST', '/api/ai/recommend', { auth: 'header', body: { kind: 'review', size: 'medium', sensitivity: 'internal' } });
    assert.equal(r.json.worker.provider, 'openai', r.text);
    const bulk = await call('POST', '/api/ai/recommend', { auth: 'header', body: { kind: 'bulk', size: 'medium', sensitivity: 'internal' } });
    assert.ok([bulk.json.worker, ...bulk.json.alternatives].every((w) => w.provider !== 'openai'), 'not for bulk work');
  });
});

test('pick_worker shows the last word, and how to reach an outside worker after another one failed', async () => {
  const reply = { ...REC, worker: { provider: 'gemini', model: 'gemini-3.8-flash' }, finalCheck: { provider: 'claude', model: 'fable', effort: 'high' } };
  await withMcp(() => [200, reply], async ({ rpc }) => {
    const got = (await rpc('tools/call', { name: 'pick_worker', arguments: { kind: 'review', size: 'large', sensitivity: 'internal', failedBefore: ['openai:gpt-6.1-sol', 'claude:opus', 'sonnet'] } })).result;
    const text = got.content[0].text;
    assert.match(text, /Last word, after that review: Claude Fable at high/);
    assert.match(text, /pass exclude: \["openai:gpt-6\.1-sol"\]/);
  });
});
