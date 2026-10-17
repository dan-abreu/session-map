import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELAY_PATH, createDeepseekRelay, relayBody } from '../server/ai/deepseek-relay.mjs';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { nativePick } from '../server/ai/native-levels.mjs';
import { parseRun } from '../server/chat/run.mjs';

// The DeepSeek relay (id180, pc42): Claude Code talks to DeepSeek through session-map, so DeepSeek's own non-thinking mode
// can be asked for; the real key never leaves session-map.

test('relayBody: thinking off sends DeepSeek {thinking: {type: "disabled"}} and drops the effort; on, the body is untouched', () => {
  const body = { model: 'deepseek-v4-pro', thinking: { type: 'adaptive', display: 'updates' }, output_config: { effort: 'max' }, messages: [] };
  assert.equal(relayBody(body, { thinkingOff: false }), body);
  assert.deepEqual(relayBody(body, { thinkingOff: true }), { model: 'deepseek-v4-pro', thinking: { type: 'disabled' }, messages: [] });
  assert.deepEqual(relayBody({ output_config: { effort: 'low', format: 'x' } }, { thinkingOff: true }), { output_config: { format: 'x' }, thinking: { type: 'disabled' } });
});

async function withRelay(fetchFn, fn) {
  const relay = createDeepseekRelay({ keyOf: async () => 'sk-real-deepseek', fetchFn });
  const server = createServer((req, res) => relay.handle(req, res, new URL(req.url, 'http://localhost'), req.socket.remoteAddress));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${RELAY_PATH}`;
  try { await fn({ relay, base }); } finally { await new Promise((r) => server.close(r)); }
}

test('the relay passes a conversation\'s request to DeepSeek with the real key, rewrites it when thinking is off, and streams the answer back', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(Buffer.from(init.body).toString('utf8')) });
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: message_start\n\n')); c.enqueue(new TextEncoder().encode('data: {"ok":1}\n\n')); c.close(); } });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  await withRelay(fetchFn, async ({ relay, base }) => {
    let off = false;
    const secret = relay.register(() => ({ thinkingOff: off }));
    assert.match(secret, /^smr-[0-9a-f]{48}$/);
    const call = (key) => fetch(`${base}/v1/messages?beta=true`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-stainless-os': 'Windows' },
      body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, messages: [{ role: 'user', content: 'oi' }] }) });

    const on = await call(secret);
    assert.equal(on.status, 200);
    assert.equal(on.headers.get('content-type'), 'text/event-stream');
    assert.equal(await on.text(), 'event: message_start\n\ndata: {"ok":1}\n\n', 'the stream comes back as DeepSeek sent it');
    assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/messages?beta=true');
    assert.equal(seen[0].headers['x-api-key'], 'sk-real-deepseek', 'the real key goes to DeepSeek');
    assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(seen[0].headers['x-stainless-os'], undefined, 'Claude Code\'s own client headers stay here');
    assert.deepEqual(seen[0].body.thinking, { type: 'adaptive' }, 'thinking on: untouched');

    off = true;
    await (await call(secret)).text();
    assert.deepEqual(seen[1].body.thinking, { type: 'disabled' }, 'the switch takes effect on the next request, no restart');
    assert.equal(seen[1].body.output_config, undefined);

    const stranger = await call('smr-guess');
    assert.equal(stranger.status, 401, 'a key the relay did not give is refused');
    assert.equal(seen.length, 2, 'and nothing reaches DeepSeek');
    relay.unregister(secret);
    assert.equal((await call(secret)).status, 401, 'an ended conversation\'s secret dies with it');
  });
});

test('the relay opens only a conversation\'s two calls, follows no redirect, and survives a request cut in the middle', async () => {
  const inits = [];
  let releaseUpstream;
  const fetchFn = (url, init) => {
    inits.push({ url, init });
    // An answer slower than the hang-up: its signal must be let go.
    return new Promise((resolve, reject) => {
      releaseUpstream = () => resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  await withRelay(fetchFn, async ({ relay, base }) => {
    const secret = relay.register(() => ({}));
    const auth = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/v1/models`, { headers: auth })).status, 404, 'no other DeepSeek route with the key');
    assert.equal((await fetch(`${base}/v1/files`, { method: 'POST', headers: auth, body: '{}' })).status, 404);
    assert.equal(inits.length, 0);

    // Claude Code stops before DeepSeek's first byte: the call to DeepSeek is aborted, not paid to the end.
    const stop = new AbortController();
    const pending = fetch(`${base}/v1/messages`, { method: 'POST', headers: auth, body: '{"model":"deepseek-flash"}', signal: stop.signal }).catch(() => null);
    for (let i = 0; i < 100 && !inits.length; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(inits[0].init.redirect, 'manual', 'a redirect would carry the key elsewhere');
    stop.abort();
    await pending;
    for (let i = 0; i < 100 && !inits[0].init.signal.aborted; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(inits[0].init.signal.aborted, true);
    releaseUpstream?.();

    // A body cut in the middle: the relay answers or lets go, the process lives on.
    const { request } = await import('node:http');
    await new Promise((resolve) => {
      const req = request(`${base}/v1/messages`, { method: 'POST', headers: { ...auth, 'content-length': '1000' } });
      req.on('error', () => resolve());
      req.write('{"model":');
      setTimeout(() => { req.destroy(); resolve(); }, 50);
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await fetch(`${base}/v1/models`, { headers: auth })).status, 404, 'still answering after the cut');
  });
});

test('the relay answers only this computer', async () => {
  const relay = createDeepseekRelay({ keyOf: async () => 'k', fetchFn: async () => { throw new Error('never'); } });
  const secret = relay.register(() => ({}));
  let status = 0;
  const res = { writeHead: (s) => { status = s; }, end: () => {} };
  await relay.handle({ headers: { host: 'evil.example', authorization: `Bearer ${secret}` }, method: 'POST' }, res, new URL('http://x/api/ds-relay/v1/messages'), '10.0.0.5');
  assert.equal(status, 403);
});

test('the pick: DeepSeek\'s thinking switch is DeepSeek\'s alone, and the run carries it', () => {
  assert.deepEqual(parseRun({ kind: 'talk', model: 'deepseek-flash', thinking: 'off' }), { kind: 'talk', model: 'deepseek-flash', thinking: 'off' });
  assert.equal(parseRun({ kind: 'talk', thinking: 'maybe' }), null);
  assert.equal(nativePick('deepseek', { model: 'deepseek-v4-pro', effort: 'high', thinking: 'off' }).thinking, 'off');
  assert.equal(nativePick('claude', { model: 'opus', effort: 'high', thinking: 'off' }), null, 'Claude Code\'s models do not turn thinking off');
});

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

test('a talk on DeepSeek is registered with the relay, reads the switch of its run, and lets go of it when it ends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-relay-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-relay-sm-'));
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: true } } }));
  const registered = [];
  const released = [];
  const dsRelay = { register: (get) => { registered.push(get); return `smr-${registered.length}`; }, unregister: (s) => released.push(s) };
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: join(smDir, 'argv.json') }, snapshot: async () => null, cliOf: () => null,
    keyOf: async (p) => (p === 'deepseek' ? 'sk-deepseek-test' : null), dsRelay, dsRelayBase: 'http://127.0.0.1:1/api/ds-relay' });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  try {
    const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'oi', ai: 'deepseek', run: { kind: 'talk', model: 'deepseek-flash', effort: 'high', thinking: 'off' } }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(registered.length, 1);
    assert.deepEqual(registered[0](), { thinkingOff: true });
    const events = [];
    hub.subscribe(res.body.chatKey, { write: (e) => events.push(e), end() {} });
    const until = async (pred) => { for (let i = 0; i < 500 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 20)); };
    await until(() => events.some((e) => e.type === 'turn-end'));
    assert.equal(hub.run(res.body.chatKey, { model: 'deepseek-flash', effort: 'high' }).status, 200);
    assert.deepEqual(registered[0](), { thinkingOff: false }, 'turned back on: the next request thinks again');
    await hub.close();
    assert.deepEqual(released, ['smr-1']);
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
