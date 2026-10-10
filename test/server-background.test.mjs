import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

const ROOT = join(tmpdir(), 'sm-bg-shop');
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: 'shop-123456', name: 'shop', root: ROOT, background: { always: false, working: false, on: false } }] };

async function withServer(fn, { demo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-bgsrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bgsrv-sm-'));
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, ...(demo ? { demo: true, token: 'x' } : {}) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = demo ? 'x' : loadToken(smDir);
  const call = (method, path, { auth = false, body } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, ...(auth ? { cookie: `sm_token=${token}` } : {}), ...(method !== 'GET' ? { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1', 'content-type': 'application/json' } : {}) };
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const PATH = '/api/settings/project-background';
const config = (smDir) => JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));

test('keeping a project always up to date needs the token, a known project and a yes or a no', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', PATH, { body: { projectId: 'shop-123456', always: true } })).status, 401);
    assert.equal((await call('POST', PATH, { auth: true, body: { projectId: 'nope', always: true } })).status, 404);
    assert.equal((await call('POST', PATH, { auth: true, body: { projectId: 'shop-123456', always: 'yes' } })).status, 400);
    assert.equal((await call('GET', PATH, { auth: true })).status, 404);
  });
});

test('the switch writes the choice in the person\'s config by the project\'s folder, and takes it away', async () => {
  await withServer(async ({ call, smDir }) => {
    const on = await call('POST', PATH, { auth: true, body: { projectId: 'shop-123456', always: true } });
    assert.deepEqual([on.status, on.json], [200, { ok: true, always: true }]);
    assert.deepEqual(Object.values(config(smDir).projects), [{ background: 'always' }]);
    const off = await call('POST', PATH, { auth: true, body: { projectId: 'shop-123456', always: false } });
    assert.deepEqual([off.status, off.json], [200, { ok: true, always: false }]);
    assert.deepEqual(config(smDir).projects, {});
  });
});

test('the demo never writes the switch', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', PATH, { auth: true, body: { projectId: 'shop-123456', always: true } })).status, 403);
  }, { demo: true });
});
