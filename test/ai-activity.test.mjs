import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { setKey } from '../server/ai/keys.mjs';
import { forgetLife, lifeOf, placeChanged, settleAi } from '../server/ai/life.mjs';
import { MAX_LINES, RESULT_WHY_MAX, readActivity, recordActivity, setResult } from '../server/ai/activity.mjs';
import { chatMcpServers } from '../server/chat/hub.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';
import { reviewPicks } from '../server/ai/helper.mjs';
import { aiKeyHash } from '../server/ai/runner.mjs';

// The activity log of the other AIs (or14): every outside call appends one line to smDir/ai-activity.jsonl (who, what
// kind, how private, cost, ok), never the prompt, the answer or a key; Claude records afterwards whether it accepted
// or refused the work (report_result); the page lists it newest first.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MCP = join(ROOT, 'server', 'ai', 'arsenal-mcp.mjs');
const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const KEYS = { openai: 'sk-proj-OPENAISECRET0000000000001234', deepseek: 'sk-DEEPSEEKSECRET00000000000005678', gemini: 'AIzaGEMINISECRET000000000000000009999' };
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };
const PROMPT = 'Is this function correct? function add(a, b) { return a - b } PRIVATE-PROMPT-WORDS';
const ANSWER = 'No: it subtracts. PRIVATE-ANSWER-WORDS';
const tmp = (name) => mkdtempSync(join(tmpdir(), `sm-act-${name}-`));
const linesOf = (smDir) => readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8').split('\n').filter(Boolean);

const entry = (extra = {}) => ({ source: 'chat', kind: 'review', sensitivity: 'internal', provider: 'openai', model: 'gpt-6.1-sol', ms: 1234, costUSD: 0.0012, ok: true, ...extra });

// ---- the log itself ---------------------------------------------------------------------------------------------

test('a call is one line with only the known fields: never a prompt, an answer or a key', () => {
  const smDir = tmp('rec');
  try {
    const id = recordActivity(smDir, entry({ sessionId: 'abc-123', recommendedBy: 'second opinion from another family', prompt: PROMPT, text: ANSWER, key: KEYS.openai, secret: 'x' }));
    assert.match(id, /^[0-9a-f]{12}$/);
    const lines = linesOf(smDir);
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(line).sort(), ['at', 'costUSD', 'id', 'kind', 'model', 'ms', 'ok', 'provider', 'recommendedBy', 'sensitivity', 'sessionId', 'source']);
    assert.equal(line.id, id);
    assert.ok(Number.isFinite(Date.parse(line.at)));
    assert.equal(line.provider, 'openai');
    assert.equal(line.costUSD, 0.0012);
    assert.ok(!lines[0].includes('PRIVATE') && !lines[0].includes('OPENAISECRET'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a bad sensitivity is the strictest, a bad source is a chat, a made-up error text is dropped, a key-looking reason is hidden', () => {
  const smDir = tmp('clean');
  try {
    recordActivity(smDir, entry({ sensitivity: 'secret', source: 'robot', ok: false, error: `It said: my key is ${KEYS.openai}`, recommendedBy: `because ${KEYS.openai} said so`, model: KEYS.gemini }));
    recordActivity(smDir, entry({ ok: false, error: 'http-429' }));
    const [a, b] = linesOf(smDir).map((l) => JSON.parse(l));
    assert.equal(a.sensitivity, 'client');
    assert.equal(a.source, 'chat');
    assert.equal(a.error, undefined);
    assert.ok(!JSON.stringify(a).includes('OPENAISECRET') && !JSON.stringify(a).includes('GEMINISECRET'));
    assert.equal(b.error, 'http-429');
    assert.equal(b.ok, false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the file stays bounded: the oldest lines go, the newest stay', () => {
  const smDir = tmp('bound');
  try {
    let last;
    for (let i = 0; i < MAX_LINES + 450; i++) last = recordActivity(smDir, entry({ ms: i }));
    const lines = linesOf(smDir);
    assert.ok(lines.length >= MAX_LINES && lines.length <= MAX_LINES + 250, `${lines.length} lines`);
    assert.equal(JSON.parse(lines.at(-1)).id, last);
    assert.equal(JSON.parse(lines.at(-1)).ms, MAX_LINES + 449);
    assert.ok(JSON.parse(lines[0]).ms > 100, 'the first ones are gone');
    assert.equal(readActivity(smDir, 5)[0].id, last);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the list is newest first, limited, and ignores a damaged line', () => {
  const smDir = tmp('list');
  try {
    assert.deepEqual(readActivity(smDir), [], 'no file yet');
    const ids = [1, 2, 3].map((ms) => recordActivity(smDir, entry({ ms })));
    writeFileSync(join(smDir, 'ai-activity.jsonl'), `${readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8')}{not json\n`);
    assert.deepEqual(readActivity(smDir).map((x) => x.id), [...ids].reverse());
    assert.deepEqual(readActivity(smDir, 2).map((x) => x.id), [ids[2], ids[1]]);
    assert.equal(readActivity(smDir, 0).length, 3, 'a silly limit falls back to the default');
    assert.equal(readActivity(smDir, 'x').length, 3);
    assert.equal(readActivity(smDir, 100000).length, 3);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('Claude records whether it accepted the work: the list shows the result, the last word wins', () => {
  const smDir = tmp('result');
  try {
    const id = recordActivity(smDir, entry());
    assert.equal(readActivity(smDir)[0].result, undefined, 'waiting');
    assert.deepEqual(setResult(smDir, id, { accepted: false, why: 'It missed the null case.' }), { ok: true });
    let item = readActivity(smDir)[0];
    assert.equal(item.result.accepted, false);
    assert.equal(item.result.why, 'It missed the null case.');
    assert.ok(Number.isFinite(Date.parse(item.result.at)));
    setResult(smDir, id, { accepted: true, why: 'After a second look it was right.' });
    item = readActivity(smDir)[0];
    assert.equal(item.result.accepted, true);
    assert.equal(readActivity(smDir).length, 1, 'a result is not a second entry');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a result needs a known id, a true or false, and a short reason without keys', () => {
  const smDir = tmp('badresult');
  try {
    const id = recordActivity(smDir, entry());
    assert.deepEqual(setResult(smDir, 'aaaaaaaaaaaa', { accepted: true, why: 'x' }), { ok: false, error: 'unknown-activity' });
    assert.deepEqual(setResult(smDir, '../etc', { accepted: true, why: 'x' }), { ok: false, error: 'bad-id' });
    assert.deepEqual(setResult(smDir, id, { accepted: 'yes', why: 'x' }), { ok: false, error: 'bad-result' });
    assert.deepEqual(setResult(smDir, id, { accepted: true, why: 7 }), { ok: false, error: 'bad-result' });
    assert.deepEqual(setResult(smDir, id, null), { ok: false, error: 'bad-result' });
    assert.equal(readActivity(smDir)[0].result, undefined);
    setResult(smDir, id, { accepted: true, why: `${KEYS.openai} ${'y'.repeat(2000)}` });
    const why = readActivity(smDir)[0].result.why;
    assert.ok(why.length <= RESULT_WHY_MAX + 20 && !why.includes('OPENAISECRET'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// ---- the routes -------------------------------------------------------------------------------------------------

async function seedKeys(smDir, providers = ['openai', 'deepseek', 'gemini'], others = { enabled: true, dailyUSD: 1 }) {
  for (const p of providers) await setKey(smDir, p, KEYS[p], { backend });
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others } }));
}

async function withServer(opts, fn) {
  const dir = tmp('dir');
  const smDir = tmp('sm');
  if (opts.seed) await opts.seed(smDir);
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state,
    helpers: { backend, ...(opts.textRun ? { textRun: opts.textRun } : {}) },
    ...(opts.address ? { addressOf: () => opts.address } : {}),
    ...(opts.demo ? { demo: true, token: 'x'.repeat(64) } : {}),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = opts.demo ? 'x'.repeat(64) : loadToken(smDir);
  const call = (method, path, { auth, body, raw } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (auth === 'cookie') headers.cookie = `sm_token=${token}`;
    if (method !== 'GET' && (auth === 'cookie' || auth === undefined)) Object.assign(headers, { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1' });
    if (auth === 'header') headers['x-session-map-token'] = token;
    if (typeof auth === 'object' && auth?.header) headers['x-session-map-token'] = auth.header;
    if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
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
    await fn({ call, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    forgetLife(smDir);
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const okRun = async (prompt, o) => ({ ok: true, text: ANSWER, costUSD: 0.002, provider: o.provider, model: o.model });
const askBody = { kind: 'review', sensitivity: 'client', prompt: PROMPT };

test('an ask is logged: who, what kind, how private, cost; the answer carries the activity id; no prompt, answer or key is stored', async () => {
  await withServer({ seed: (s) => seedKeys(s), textRun: okRun }, async ({ call, smDir }) => {
    const got = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, sessionId: 'chat-77', why: 'Opus wrote it, so ask another family.' } });
    assert.equal(got.status, 200, got.text);
    const id = got.json.answers[0].id;
    assert.match(id, /^[0-9a-f]{12}$/);
    const [line] = linesOf(smDir).map((l) => JSON.parse(l));
    assert.equal(line.id, id);
    assert.equal(line.source, 'chat');
    assert.equal(line.sessionId, 'chat-77');
    assert.equal(line.kind, 'review');
    assert.equal(line.sensitivity, 'client');
    assert.equal(line.provider, got.json.answers[0].provider);
    assert.equal(line.ok, true);
    assert.equal(line.costUSD, 0.002);
    assert.equal(line.recommendedBy, 'Opus wrote it, so ask another family.');
    const raw = readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8');
    for (const secret of ['PRIVATE-PROMPT', 'PRIVATE-ANSWER', 'subtracts', ...Object.values(KEYS)]) assert.ok(!raw.includes(secret), secret);
  });
});

test('a failed outside call is logged too, with its plain code', async () => {
  const textRun = async () => ({ ok: false, error: 'http-429', costUSD: 0 });
  await withServer({ seed: (s) => seedKeys(s, ['openai']), textRun }, async ({ call, smDir }) => {
    const got = await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, sensitivity: 'public' } });
    assert.equal(got.status, 502);
    const [line] = linesOf(smDir).map((l) => JSON.parse(l));
    assert.equal(line.ok, false);
    assert.equal(line.error, 'http-429');
    assert.equal(line.provider, 'openai');
  });
});

test('a bad session id or reason in the ask is refused before anyone is asked', async () => {
  const calls = [];
  const textRun = async (p, o) => { calls.push(o); return okRun(p, o); };
  await withServer({ seed: (s) => seedKeys(s), textRun }, async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, sessionId: 'x y/../z' } })).status, 400);
    assert.equal((await call('POST', '/api/ai/ask', { auth: 'header', body: { ...askBody, why: 5 } })).status, 400);
    assert.equal(calls.length, 0);
  });
});

test('the list needs the token and this computer, is never in the demo, and gives newest first', async () => {
  await withServer({ seed: (s) => seedKeys(s), textRun: okRun }, async ({ call, smDir }) => {
    assert.equal((await call('GET', '/api/ai/activity')).status, 401);
    assert.equal((await call('GET', '/api/ai/activity', { auth: { header: 'f'.repeat(64) } })).status, 401);
    const a = recordActivity(smDir, entry({ ms: 1 }));
    const b = recordActivity(smDir, entry({ ms: 2 }));
    const c = recordActivity(smDir, entry({ ms: 3 }));
    const all = await call('GET', '/api/ai/activity', { auth: 'cookie' });
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.items.map((x) => x.id), [c, b, a]);
    const two = await call('GET', '/api/ai/activity?limit=2', { auth: 'header' });
    assert.deepEqual(two.json.items.map((x) => x.id), [c, b]);
  });
  await withServer({ demo: true }, async ({ call }) => {
    assert.equal((await call('GET', '/api/ai/activity', { auth: 'header' })).status, 403);
    assert.equal((await call('POST', '/api/ai/activity/aaaaaaaaaaaa', { auth: 'header', body: { accepted: true, why: 'x' } })).status, 403);
  });
  await withServer({ address: '192.168.0.20' }, async ({ call }) => {
    assert.equal((await call('GET', '/api/ai/activity', { auth: 'header' })).status, 403);
  });
});

test('Claude reports its verdict over HTTP, with the same token rules; unknown ids and bad bodies are refused', async () => {
  await withServer({}, async ({ call, smDir }) => {
    const id = recordActivity(smDir, entry());
    const url = `/api/ai/activity/${id}`;
    assert.equal((await call('POST', url, { body: { accepted: true, why: 'ok' } })).status, 401, 'no token at all');
    assert.equal((await call('POST', url, { auth: { header: 'f'.repeat(64) }, body: { accepted: true, why: 'ok' } })).status, 401);
    assert.equal((await call('POST', '/api/ai/activity/aaaaaaaaaaaa', { auth: 'header', body: { accepted: true, why: 'ok' } })).status, 404);
    assert.equal((await call('POST', '/api/ai/activity/not-an-id', { auth: 'header', body: { accepted: true, why: 'ok' } })).status, 400);
    assert.equal((await call('POST', url, { auth: 'header', body: { accepted: 'yes', why: 'ok' } })).status, 400);
    assert.equal((await call('POST', url, { auth: 'header', body: [] })).status, 400);
    assert.equal((await call('POST', url, { auth: 'header', raw: '{nope' })).status, 400);
    assert.equal((await call('GET', url, { auth: 'header' })).status, 404, 'the single entry has no GET');
    const ok = await call('POST', url, { auth: 'header', body: { accepted: false, why: 'It missed the null case.' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.ok, true);
    const list = await call('GET', '/api/ai/activity', { auth: 'header' });
    assert.equal(list.json.items[0].result.accepted, false);
    assert.equal(list.json.items[0].result.why, 'It missed the null case.');
    // the page, with its cookie, may also say it
    assert.equal((await call('POST', url, { auth: 'cookie', body: { accepted: true, why: 'On a second look it was fine.' } })).status, 200);
  });
});

test('end to end over HTTP: ask, then report, and the list shows both', async () => {
  await withServer({ seed: (s) => seedKeys(s), textRun: okRun }, async ({ call, smDir }) => {
    const got = await call('POST', '/api/ai/ask', { auth: 'header', body: askBody });
    const id = got.json.answers[0].id;
    const rep = await call('POST', `/api/ai/activity/${id}`, { auth: 'header', body: { accepted: true, why: 'Checked against the code: right.' } });
    assert.equal(rep.status, 200);
    const list = await call('GET', '/api/ai/activity', { auth: 'header' });
    assert.equal(list.json.items[0].id, id);
    assert.equal(list.json.items[0].result.accepted, true);
    assert.ok(existsSync(join(smDir, 'ai-activity.jsonl')));
  });
});

// ---- the map's own (bulk) outside calls ---------------------------------------------------------------------------

const ROOT_B = 'C:\\mine\\Tool';
const PARTS = { layers: [], parts: [{ id: 'orders', name: 'Orders', about: 'Builds the basket.', codePaths: [] }] };

test('the map\'s own outside calls are logged as the map\'s: kind, privacy class, cost, never the digest text', async () => {
  const smDir = tmp('bulk');
  const apiRun = async (prompt, opts) => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.0001, provider: opts.provider });
  writeFileSync(join(smDir, 'ai-keys.json'), JSON.stringify({ version: 1, keys: { gemini: { scheme: 'fake', data: 'sealed', last4: 'cdef' } } }));
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { projectClass: { [normalizePath(ROOT_B)]: 'public' } } } }));
  try {
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.01 }), apiRun, keyOf: async () => 'sk-gemini-0123456789abcdef' });
    let digest;
    for (let i = 0; !digest; i++) {
      const d = { title: `SECRET-TITLE-${i}`, branch: null, prompts: [], files: [], commits: [] };
      if (!reviewPicks(aiKeyHash({ kind: 'place', digest: d, parts: [['orders', 'Orders', 'Builds the basket.']] }))) digest = d;
    }
    placeChanged(life, { smDir, projectId: projectIdOf(ROOT_B), arch: PARTS }, [{ sessionId: 's1', digest }]);
    await settleAi(smDir);
    const lines = linesOf(smDir).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].source, 'map');
    assert.equal(lines[0].kind, 'place');
    assert.equal(lines[0].provider, 'gemini');
    assert.equal(lines[0].sensitivity, 'public');
    assert.equal(lines[0].ok, true);
    assert.equal(lines[0].costUSD, 0.0001);
    assert.equal(lines[0].sessionId, undefined);
    assert.ok(!readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8').includes('SECRET-TITLE'));
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

// ---- the arsenal tools --------------------------------------------------------------------------------------------

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
      if (u.pathname === '/api/ai/hello') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, proof: proofOf(TOKEN, u.searchParams.get('nonce')) }));
      }
      const body = text ? JSON.parse(text) : null;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const [status, json] = reply(req.method, req.url, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withMcp(reply, env, fn) {
  const smDir = tmp('mcp');
  writeFileSync(join(smDir, 'token'), `${TOKEN}\n`);
  const fake = await fakeServer(reply);
  const child = spawn(process.execPath, [MCP], { env: { ...process.env, SM_URL: fake.url, SM_DIR: smDir, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); waiting.get(m.id)?.(m); });
  let next = 1;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 15_000);
    waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    await fn({ rpc, call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result, seen: fake.seen });
  } finally {
    await new Promise((resolve) => { child.once('exit', resolve); child.stdin.end(); child.kill(); });
    await fake.close();
    rmSync(smDir, { recursive: true, force: true });
  }
}

const textOf = (r) => r.content.map((c) => c.text).join('\n');

test('report_result is listed with its inputs and sends the verdict with the header token', async () => {
  const reply = (method, url) => (url === '/api/ai/activity/0123456789ab' ? [200, { ok: true }] : [404, { ok: false, error: 'unknown-activity' }]);
  await withMcp(reply, {}, async ({ rpc, call, seen }) => {
    const { tools } = (await rpc('tools/list', {})).result;
    const t = tools.find((x) => x.name === 'report_result');
    assert.ok(t, 'report_result is a tool');
    assert.deepEqual([...t.inputSchema.required].sort(), ['accepted', 'id', 'why']);
    assert.equal(t.inputSchema.properties.accepted.type, 'boolean');
    assert.match(t.description, /accepted|refused/i);
    const ok = await call('report_result', { id: '0123456789ab', accepted: false, why: 'It missed the null case.' });
    assert.ok(!ok.isError, textOf(ok));
    assert.match(textOf(ok), /refused/i);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.deepEqual(seen[0].body, { accepted: false, why: 'It missed the null case.' });
    assert.equal(seen[0].headers['x-session-map-token'], TOKEN);
    const unknown = await call('report_result', { id: 'aaaaaaaaaaaa', accepted: true, why: 'fine' });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /unknown|not found|no such/i);
  });
});

test('report_result refuses a malformed id or verdict on its side, sending nothing', async () => {
  await withMcp(() => [200, { ok: true }], {}, async ({ call, seen }) => {
    const bad = await call('report_result', { id: '../../etc', accepted: true, why: 'x' });
    assert.equal(bad.isError, true);
    const notBool = await call('report_result', { id: '0123456789ab', accepted: 'yes', why: 'x' });
    assert.equal(notBool.isError, true);
    assert.equal(seen.length, 0);
  });
});

test('ask_other_ai passes the session id from its environment and the reason, and shows the activity id to report on', async () => {
  const reply = () => [200, { ok: true, answers: [{ provider: 'openai', model: 'gpt-6.1-sol', text: 'fine', costUSD: 0.001, ms: 30, id: '0123456789ab' }], skipped: [] }];
  await withMcp(reply, { SM_SESSION_ID: 'chat-77' }, async ({ call, seen }) => {
    const got = await call('ask_other_ai', { kind: 'review', sensitivity: 'internal', prompt: 'p', why: 'second opinion from another family' });
    assert.equal(seen[0].body.sessionId, 'chat-77');
    assert.equal(seen[0].body.why, 'second opinion from another family');
    assert.match(textOf(got), /0123456789ab/);
    assert.match(textOf(got), /report_result/);
  });
  await withMcp(reply, { SM_SESSION_ID: '' }, async ({ call, seen }) => {
    await call('ask_other_ai', { kind: 'review', sensitivity: 'internal', prompt: 'p' });
    assert.equal('sessionId' in seen[0].body, false);
    assert.equal('why' in seen[0].body, false);
  });
});

test('in-page chats tell the arsenal which conversation it works for', () => {
  const servers = chatMcpServers({ permissionUrl: 'u', secret: 's', smDir: 'C:/sm', arsenalUrl: 'http://127.0.0.1:4002', sessionId: 'abc123' });
  assert.deepEqual(servers.arsenal.env, { SM_DIR: 'C:/sm', SM_URL: 'http://127.0.0.1:4002', SM_SESSION_ID: 'abc123' });
  assert.equal('SM_SESSION_ID' in chatMcpServers({ permissionUrl: 'u', secret: 's', smDir: 'C:/sm' }).arsenal.env, false);
});
