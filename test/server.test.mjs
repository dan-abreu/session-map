import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, editUnits } from '../server/main.mjs';
import { loadToken, sameToken } from '../server/auth.mjs';
import { archiveTranscript } from '../server/archive.mjs';
import { listTranscripts } from '../server/sources/claude.mjs';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-srv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-srv-sm-'));
  const app = createApp({ dir, smDir, ai: { bin: null }, ...opts });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, token, port, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const REMOTE = { addressOf: () => '10.0.0.50' };

test('loadToken creates a 32-byte hex token once and keeps it; sameToken compares safely', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-tok-'));
  try {
    const t = loadToken(smDir);
    assert.match(t, /^[0-9a-f]{64}$/);
    assert.equal(loadToken(smDir), t);
    if (process.platform !== 'win32') assert.equal(statSync(join(smDir, 'token')).mode & 0o077, 0);
    assert.equal(sameToken(t, t), true);
    assert.equal(sameToken(t, t.slice(1)), false);
    assert.equal(sameToken(undefined, t), false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('locally the page and an empty state open without a token', async () => {
  await withServer({}, async ({ call }) => {
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    const state = await call('GET', '/api/state');
    assert.equal(state.status, 200);
    const body = JSON.parse(state.text);
    assert.deepEqual(body.projects, []);
    assert.equal(body.waitingCount, 0);
    assert.equal((await call('GET', '/vendor/d3-force.min.js')).status, 200);
    assert.equal((await call('GET', '/static/app.js')).status, 200);
    assert.equal((await call('GET', '/../package.json')).status, 404);
  });
});

test('from the network: no token is 401 and leaks nothing; ?k= sets the cookie and drops the k', async () => {
  await withServer(REMOTE, async ({ call, token }) => {
    const denied = await call('GET', '/api/state');
    assert.equal(denied.status, 401);
    assert.doesNotMatch(denied.text, /projects/);
    assert.equal((await call('GET', '/')).status, 401);
    assert.equal((await call('GET', '/?k=wrong')).status, 401);
    const ok = await call('GET', `/?k=${token}`);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.location, '/');
    assert.match(ok.headers['set-cookie'][0], new RegExp(`^sm_token=${token}; `));
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_token=${token}` } })).status, 200);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: 'sm_token=nope' } })).status, 401);
  });
});

test('a plain local GET never hands out the token cookie; only the ?k= link does', async () => {
  await withServer({}, async ({ call, token, port }) => {
    for (const path of ['/', '/api/state', '/app.js']) {
      const res = await call('GET', path);
      assert.equal(res.status, 200);
      assert.equal(res.headers['set-cookie'], undefined, path);
    }
    const write = { 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
    const body = { action: 'open', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    assert.equal((await call('POST', '/api/action', { headers: write, body })).status, 401);
    const link = await call('GET', `/?k=${token}`);
    assert.equal(link.status, 302);
    assert.match(link.headers['set-cookie'][0], /^sm_token=[0-9a-f]{64}; .*HttpOnly.*SameSite=Strict/);
  });
});

test('a loopback request with a foreign Host (DNS rebinding) is treated as remote', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/state', { headers: { host: 'evil.example:4001' } })).status, 401);
  });
});

test('writes need the custom header, a same-origin Origin and the token, even locally', async () => {
  await withServer({}, async ({ call, token, port }) => {
    const good = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
    const body = { action: 'open', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const without = (key) => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
    assert.equal((await call('POST', '/api/action', { headers: without('x-session-map'), body })).status, 403);
    assert.equal((await call('POST', '/api/action', { headers: without('origin'), body })).status, 403);
    assert.equal((await call('POST', '/api/action', { headers: { ...good, origin: 'http://evil.example' }, body })).status, 403);
    assert.equal((await call('POST', '/api/action', { headers: without('cookie'), body })).status, 401);
    assert.equal((await call('POST', '/api/action', { headers: { ...good, cookie: 'sm_token=bad' }, body })).status, 401);
    assert.equal((await call('POST', '/api/action', { headers: good, body })).status, 404, 'passes the guard; the session is not in the state');
    assert.equal((await call('POST', '/api/action', { headers: good, body: { action: 'open', sessionId: 'x' } })).status, 400);
    assert.equal((await call('PUT', '/api/units/nope-123456', { headers: good, body: { op: 'create', name: 'X' } })).status, 404);
  });
});

test('--demo serves demo/state.json without touching the user disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-srv-demo-'));
  const dir = join(root, 'claude');
  const smDir = join(root, 'sm');
  cpSync(new URL('./fixtures/claude/', import.meta.url), dir, { recursive: true });
  const S1 = '11111111-1111-4111-8111-111111111111';
  assert.equal(archiveTranscript(listTranscripts(dir).find((r) => r.sessionId === S1), smDir), 'archived');
  try {
    await withServer({ demo: true, dir, smDir }, async ({ call }) => {
      const res = await call('GET', '/api/state');
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), DEMO);
      const history = await call('GET', '/api/history?q=checkout');
      assert.equal(history.status, 200);
      assert.deepEqual(JSON.parse(history.text).results, []);
      assert.doesNotMatch(history.text, /Checkout page work/);
      const conv = await call('GET', `/api/conversation/${S1}`);
      assert.equal(conv.status, 404);
      assert.doesNotMatch(conv.text, /Checkout/);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('history search and archived conversation routes validate their input', async () => {
  await withServer({}, async ({ call }) => {
    const res = await call('GET', '/api/history?q=cart');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text).results, []);
    assert.equal((await call('GET', '/api/conversation/not-a-uuid')).status, 400);
    assert.equal((await call('GET', '/api/conversation/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).status, 404);
    assert.equal((await call('GET', '/api/nucleus/x-123456/..%2F..')).status, 404);
  });
});

test('editUnits: rename and create pin the unit, merge joins chats, bad input is refused', () => {
  const units = [
    { id: 'a', name: 'A', chatIds: ['1'], paths: ['x'], tags: ['t'], pinned: false, parentId: null, level: 'cell' },
    { id: 'b', name: 'B', chatIds: ['2'], paths: ['y'], tags: ['u'], pinned: false, parentId: null, level: 'cell' },
    { id: 'c', name: 'C', chatIds: [], paths: [], tags: [], pinned: false, parentId: 'b', level: 'cell' },
    { id: 'unsorted', name: 'Unsorted', chatIds: [], paths: [], tags: [], pinned: false, parentId: null, level: 'cell' },
  ];
  const renamed = editUnits(units, { op: 'rename', id: 'a', name: 'Checkout' }, 'T');
  assert.deepEqual([renamed.find((u) => u.id === 'a').name, renamed.find((u) => u.id === 'a').pinned], ['Checkout', true]);
  const merged = editUnits(units, { op: 'merge', ids: ['b'], into: 'a' }, 'T');
  const a = merged.find((u) => u.id === 'a');
  assert.deepEqual([a.chatIds, a.paths, a.pinned], [['1', '2'], ['x', 'y'], true]);
  assert.equal(merged.find((u) => u.id === 'c').parentId, 'a');
  assert.equal(merged.some((u) => u.id === 'b'), false);
  const created = editUnits(units, { op: 'create', name: 'New area' }, 'T').at(-1);
  assert.deepEqual([created.id, created.origin, created.pinned, created.bornAt], ['new-area', 'user', true, 'T']);
  assert.equal(editUnits(units, { op: 'rename', id: 'unsorted', name: 'X' }, 'T'), null);
  assert.equal(editUnits(units, { op: 'merge', ids: ['a'], into: 'a' }, 'T'), null);
  assert.equal(editUnits(units, { op: 'create', name: '' }, 'T'), null);
  assert.equal(editUnits(units, { op: 'drop' }, 'T'), null);
});

test('nucleus edit, override and unit edits write only for a project and unit in the state', async () => {
  const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fakeState = (smDir) => ({
    generatedAt: '', waitingCount: 0, projects: [{
      id: 'shop-abc123', root: '/work/shop', workCells: [],
      units: [{ id: 'cart', name: 'Cart', nucleus: { state: '', decided: [], todo: [], recent: [] } }],
      chats: [{ sessionId: UUID, unitId: 'cart' }],
    }],
  });
  let smDirSeen;
  await withServer({ collectFn: ({ smDir }) => { smDirSeen = smDir; return fakeState(smDir); } }, async ({ call, token, port, smDir }) => {
    const headers = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}` };
    const nucleus = { state: 'paying', decided: ['no coupons'], todo: ['tests'] };
    assert.equal((await call('PUT', '/api/nucleus/shop-abc123/cart', { headers, body: nucleus })).status, 200);
    assert.match(readFileSync(join(smDir, 'brain', 'shop-abc123', 'cart.md'), 'utf8'), /## State\npaying/);
    assert.equal((await call('PUT', '/api/nucleus/shop-abc123/ghost', { headers, body: nucleus })).status, 404);
    assert.equal((await call('PUT', '/api/nucleus/shop-abc123/cart', { headers, body: { state: 3 } })).status, 400);
    const got = JSON.parse((await call('GET', '/api/nucleus/shop-abc123/cart')).text);
    assert.equal(got.state, 'paying');

    assert.equal((await call('POST', '/api/override', { headers, body: { projectId: 'shop-abc123', sessionId: UUID, unitId: 'cart' } })).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(smDir, 'brain', 'shop-abc123', 'overrides.json'), 'utf8')), { [UUID]: 'cart' });
    assert.equal((await call('POST', '/api/override', { headers, body: { projectId: 'shop-abc123', sessionId: UUID, unitId: 'ghost' } })).status, 404);

    assert.equal((await call('PUT', '/api/units/shop-abc123', { headers, body: { op: 'create', name: 'Coupons' } })).status, 200);
    const stored = JSON.parse(readFileSync(join(smDir, 'brain', 'shop-abc123', 'units.json'), 'utf8'));
    assert.ok(stored.some((u) => u.id === 'coupons' && u.pinned));
    assert.equal(smDirSeen, smDir);
  });
});

test('the first /api/state answers from the disk copy at once, marked refreshing, while the fresh collect runs', { timeout: 10_000 }, async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const fresh = { ...DEMO, generatedAt: '2026-10-09T12:00:00.000Z' };
  await withServer({ collectFn: () => slow }, async ({ call, smDir }) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(smDir, 'state-cache.json'), JSON.stringify({ ...DEMO, generatedAt: '2026-10-08T09:00:00.000Z' }));
    const started = Date.now();
    const first = await call('GET', '/api/state');
    assert.ok(Date.now() - started < 2000);
    const body = JSON.parse(first.text);
    assert.equal(body.refreshing, true);
    assert.equal(body.generatedAt, '2026-10-08T09:00:00.000Z');
    release(fresh);
    let second = { refreshing: true };
    for (let i = 0; i < 30 && second.refreshing; i++) {
      await new Promise((r) => setTimeout(r, 100));
      second = JSON.parse((await call('GET', '/api/state')).text);
    }
    assert.equal(second.generatedAt, '2026-10-09T12:00:00.000Z');
    assert.equal(second.refreshing, undefined);
    const saved = JSON.parse(readFileSync(join(smDir, 'state-cache.json'), 'utf8'));
    assert.equal(saved.generatedAt, '2026-10-09T12:00:00.000Z', 'the fresh state is the next start\'s copy');
  });
});

test('a collect still running is shared by every request, even past the state lifetime', { timeout: 10_000 }, async () => {
  let runs = 0;
  let release;
  const collectFn = () => { runs++; return new Promise((resolve) => { release = () => resolve(DEMO); }); };
  await withServer({ collectFn, stateTtlMs: 10 }, async ({ call }) => {
    const a = call('GET', '/api/state');
    await new Promise((r) => setTimeout(r, 50));
    const b = call('GET', '/api/state');
    await new Promise((r) => setTimeout(r, 50));
    release();
    await Promise.all([a, b]);
    assert.equal(runs, 1);
  });
});

test('the disk copy goes out before a collect that holds the event loop starts', { timeout: 20_000 }, async () => {
  const collectFn = () => {
    const end = Date.now() + 2500;
    while (Date.now() < end) { /* reading every transcript synchronously */ }
    return Promise.resolve(DEMO);
  };
  await withServer({ collectFn }, async ({ call, smDir }) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(smDir, 'state-cache.json'), JSON.stringify(DEMO));
    const started = Date.now();
    const first = JSON.parse((await call('GET', '/api/state')).text);
    assert.equal(first.refreshing, true);
    assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
  });
});
