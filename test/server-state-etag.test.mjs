import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-etag-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-etag-sm-'));
  const app = createApp({ dir, smDir, ai: { bin: null }, ...opts });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const call = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    await fn({ call, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('/api/state carries an ETag; asking again with it answers 304 with no body (sv09)', async () => {
  await withServer({ collectFn: () => DEMO }, async ({ call }) => {
    const first = await call('/api/state');
    assert.equal(first.status, 200);
    assert.match(first.headers.etag ?? '', /^"[0-9a-f]+"$/);
    const again = await call('/api/state', { 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.text, '');
    assert.equal(again.headers.etag, first.headers.etag);
    assert.equal(again.headers['x-generated-at'], DEMO.generatedAt, 'the page still learns how fresh the state is');
  });
});

test('a new collect with the same content keeps the ETag; a changed one gets a new ETag and the body', async () => {
  let runs = 0;
  let waiting = DEMO.waitingCount;
  const collectFn = () => ({ ...DEMO, generatedAt: new Date(Date.UTC(2026, 9, 10, 0, 0, ++runs)).toISOString(), waitingCount: waiting });
  await withServer({ collectFn, stateTtlMs: 10 }, async ({ call }) => {
    const first = await call('/api/state');
    await wait(30);
    await call('/api/state');
    await wait(30);
    const same = await call('/api/state', { 'if-none-match': first.headers.etag });
    assert.ok(runs >= 2, 'the state was collected again');
    assert.equal(same.status, 304, 'only the time moved');
    assert.notEqual(same.headers['x-generated-at'], JSON.parse(first.text).generatedAt);
    waiting += 7;
    await wait(30);
    await call('/api/state');
    await wait(30);
    const changed = await call('/api/state', { 'if-none-match': first.headers.etag });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.etag, first.headers.etag);
    assert.equal(JSON.parse(changed.text).waitingCount, waiting);
  });
});

test('the disk copy answered while refreshing has no ETag, so the page always asks again for the real state', { timeout: 10_000 }, async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  await withServer({ collectFn: () => slow }, async ({ call, smDir }) => {
    writeFileSync(join(smDir, 'state-cache.json'), JSON.stringify(DEMO));
    const copy = await call('/api/state', { 'if-none-match': '"anything"' });
    assert.equal(copy.status, 200);
    assert.equal(JSON.parse(copy.text).refreshing, true);
    assert.equal(copy.headers.etag, undefined);
    release(DEMO);
  });
});

test('a poll never waits for a collect: it gets the newest finished state at once while the next one runs', { timeout: 10_000 }, async () => {
  let runs = 0;
  let release;
  const collectFn = () => {
    runs += 1;
    if (runs === 1) return DEMO;
    return new Promise((resolve) => { release = () => resolve(DEMO); });
  };
  await withServer({ collectFn, stateTtlMs: 10 }, async ({ call }) => {
    const first = await call('/api/state');
    await wait(30);
    const started = Date.now();
    // The slow collect is let go after 2 s whatever happens, so a server that waits on it still closes.
    setTimeout(() => release?.(), 2000);
    const again = await call('/api/state', { 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.ok(Date.now() - started < 1500, 'answered from the state it has, not after the slow collect');
    assert.equal(runs, 2, 'the next collect was started meanwhile');
  });
});

test('rolling 7- and 30-day costs moving alone keep the ETag: the window slides with the clock, nothing new happened', async () => {
  let runs = 0;
  const collectFn = () => {
    runs += 1;
    const slide = runs * 0.01;
    return {
      ...DEMO,
      totals: { ...DEMO.totals, d7: DEMO.totals.d7 - slide, d30: DEMO.totals.d30 - slide },
      projects: DEMO.projects.map((p) => ({ ...p, cost: { ...p.cost, d7: p.cost.d7 - slide, d30: p.cost.d30 - slide } })),
    };
  };
  await withServer({ collectFn, stateTtlMs: 10 }, async ({ call }) => {
    const first = await call('/api/state');
    await wait(30);
    await call('/api/state');
    await wait(30);
    const again = await call('/api/state', { 'if-none-match': first.headers.etag });
    assert.ok(runs >= 2, 'the state was collected again');
    assert.equal(again.status, 304);
  });
});

test('the chat history never starts a collect: the mirror asks every 3 s and the newest finished state answers it', async () => {
  let runs = 0;
  const collectFn = () => { runs += 1; return DEMO; };
  const seen = [];
  const chat = { history: (id, s) => { seen.push(s); return { status: 200, body: { same: true, version: 'v1' } }; } };
  const token = 'a'.repeat(64);
  await withServer({ collectFn, stateTtlMs: 10, chat, token }, async ({ call }) => {
    await call('/api/state');
    await wait(30);
    const before = runs;
    const res = await call('/api/chat/history/11111111-1111-4111-8111-111111111111?since=v1', { cookie: `sm_token=${token}` });
    assert.equal(res.status, 200);
    await wait(30);
    assert.equal(runs, before, 'no collect was started for a "nothing new" answer');
    assert.equal(seen[0], DEMO);
  });
});
