import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToken } from '../server/auth.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { createApp } from '../server/main.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const NO_ARCH = { source: 'none', dir: null, lang: 'en', layers: [], parts: [] };
const WITH_ARCH = { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [{ id: 'auth', name: 'Auth', file: 'docs/architecture/auth.md', about: '', codePaths: [], groups: [] }] };

async function withServer(fn, { demo = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-arch-root-'));
  const dir = mkdtempSync(join(tmpdir(), 'sm-arch-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-arch-sm-'));
  const state = {
    projects: [
      { id: 'bare-abc123', name: 'bare', root, arch: NO_ARCH, workCells: [], chats: [] },
      { id: 'shop-def456', name: 'shop', root, arch: WITH_ARCH, workCells: [], chats: [] },
    ],
  };
  const chat = demo ? null : createChatHub({ smDir, dir, bin: FAKE });
  const app = createApp({ dir, smDir, demo, chat, collectFn: () => state, ...(demo ? {} : { token: loadToken(smDir) }) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const token = demo ? 'x' : loadToken(smDir);
  const write = { origin: `http://${host}`, 'x-session-map': '1', cookie: `sm_token=${token}`, 'content-type': 'application/json' };
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text.startsWith('{') ? JSON.parse(text) : text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, write, token, dir, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await chat?.close();
    for (const d of [root, dir, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const CREATE = { node: { kind: 'create-arch' }, text: 'Create the architecture map.' };

test('the "create the map" chat starts through /api/chat/start at the root, only with the token and only when there is no map; no second route', async () => {
  await withServer(async ({ call, write, smDir }) => {
    assert.equal((await call('POST', '/api/arch/create', { headers: write, body: { projectId: 'bare-abc123' } })).status, 404, 'one path only: the page uses /api/chat/start');
    assert.equal((await call('POST', '/api/chat/start', { body: { projectId: 'bare-abc123', ...CREATE } })).status, 403, 'no header, no origin');
    assert.equal((await call('POST', '/api/chat/start', { headers: { ...write, cookie: '' }, body: { projectId: 'bare-abc123', ...CREATE } })).status, 401);
    const exists = await call('POST', '/api/chat/start', { headers: write, body: { projectId: 'shop-def456', ...CREATE } });
    assert.deepEqual([exists.status, exists.body.error], [409, 'arch-exists']);
    assert.equal((await call('POST', '/api/chat/start', { headers: write, body: { projectId: 'nope', ...CREATE } })).status, 404);
    const made = await call('POST', '/api/chat/start', { headers: write, body: { projectId: 'bare-abc123', ...CREATE, mode: 'acceptEdits' } });
    assert.equal(made.status, 200);
    assert.match(made.body.chatKey, /^[0-9a-f]{32}$/);
    assert.equal(made.body.mode, 'acceptEdits', 'the chat runs in the mode the person picked');
    await waitFor(() => readFileSync(join(smDir, 'page-chats.json'), 'utf8'));
    const [saved] = Object.values(JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8')));
    assert.deepEqual(saved.node, { kind: 'create-arch' });
    assert.ok(saved.title.length > 0, 'a title the page can show');
  });
});

test('the permission mode for every Claude on this PC: read, set, refuse a bypass, undo; logged in actions.log', async () => {
  await withServer(async ({ call, write, token, dir, smDir }) => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus', permissions: { defaultMode: 'default' } }, null, 2));
    const path = '/api/settings/permission-mode';
    assert.equal((await call('GET', path)).status, 401, 'reading the user settings needs the token');
    assert.deepEqual((await call('GET', path, { headers: { cookie: `sm_token=${token}` } })).body, { ok: true, mode: 'default', previous: null, undo: false });
    assert.equal((await call('POST', path, { body: { mode: 'auto' } })).status, 403);
    assert.deepEqual((await call('POST', path, { headers: write, body: { mode: 'bypassPermissions' } })).body, { ok: false, error: 'bad-mode' });
    assert.equal((await call('POST', path, { headers: write, body: { mode: 'auto' } })).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), { model: 'opus', permissions: { defaultMode: 'auto' } });
    assert.deepEqual((await call('GET', path, { headers: { cookie: `sm_token=${token}` } })).body, { ok: true, mode: 'auto', previous: 'default', undo: true });
    assert.equal((await call('DELETE', path, { headers: write })).status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).permissions.defaultMode, 'default');
    assert.equal((await call('DELETE', path, { headers: write })).status, 404);
    writeFileSync(join(dir, 'settings.json'), '{ // mine\n}');
    assert.equal((await call('POST', path, { headers: write, body: { mode: 'auto' } })).status, 409);
    const logged = readFileSync(join(smDir, 'actions.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(logged.map((l) => [l.action, l.mode ?? null, l.status]), [
      ['permission-mode', 'bypassPermissions', 400], ['permission-mode', 'auto', 200], ['permission-mode-undo', null, 200], ['permission-mode-undo', null, 404], ['permission-mode', 'auto', 409],
    ]);
  });
});

test('the demo never touches the settings nor starts a map', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/settings/permission-mode')).status, 403);
  }, { demo: true });
});

async function waitFor(read, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    try { return read(); } catch (err) { if (Date.now() > until) throw err; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
