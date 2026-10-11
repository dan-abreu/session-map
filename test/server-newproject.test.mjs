import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';

const PATH = '/api/projects/new';

async function withServer(fn, { demo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-npsrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-npsrv-sm-'));
  const parent = mkdtempSync(join(tmpdir(), 'sm-npsrv-p-'));
  const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: 'shop-123456', name: 'shop', root: join(parent, 'shop') }] };
  const ghCalls = [];
  // gh as a fake: logged in as ana, no repository taken; nothing reaches GitHub.
  const newProjectExec = async (file, args) => {
    ghCalls.push(`${file} ${args.join(' ')}`);
    if (args[0] === 'api') return { code: 0, stdout: 'ana\n', stderr: '' };
    if (args[0] === 'repo' && args[1] === 'view') return { code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a Repository' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, newProjectExec, ...(demo ? { demo: true, token: 'x' } : {}) });
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
    await fn({ call, smDir, parent, ghCalls });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [dir, smDir, parent]) rmSync(d, { recursive: true, force: true });
  }
}

test('a new project needs the token', async () => {
  await withServer(async ({ call, parent }) => {
    assert.equal((await call('GET', PATH)).status, 401);
    assert.equal((await call('POST', PATH, { body: { parent, name: 'a' } })).status, 401);
    assert.throws(() => statSync(join(parent, 'a')));
  });
});

test('the page is told where new projects usually go', async () => {
  await withServer(async ({ call, parent }) => {
    const out = await call('GET', PATH, { auth: true });
    assert.deepEqual([out.status, out.json], [200, { ok: true, parent, github: { ready: true, user: 'ana' } }]);
  });
});

test('creating a project makes its folder, remembers it and answers its id', async () => {
  await withServer(async ({ call, smDir, parent }) => {
    const out = await call('POST', PATH, { auth: true, body: { parent, name: 'loja' } });
    const root = join(parent, 'loja');
    assert.deepEqual([out.status, out.json], [200, { ok: true, root, projectId: projectIdOf(root) }]);
    assert.ok(statSync(root).isDirectory());
    assert.equal(JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')).projects[normalizePath(root)].created.root, root);
    const again = await call('POST', PATH, { auth: true, body: { parent, name: 'loja' } });
    assert.deepEqual([again.status, again.json.error], [409, 'folder-exists']);
    assert.equal((await call('POST', PATH, { auth: true, body: { parent, name: '../fora' } })).status, 400);
    assert.equal((await call('POST', PATH, { auth: true, body: { parent: join(parent, 'nao-ha'), name: 'b' } })).status, 400);
  });
});

test('a project can also go to GitHub; only when asked', async () => {
  await withServer(async ({ call, parent, ghCalls }) => {
    const local = await call('POST', PATH, { auth: true, body: { parent, name: 'so-pc' } });
    assert.equal(local.json.github, undefined);
    assert.equal(ghCalls.filter((c) => c.startsWith('gh repo create')).length, 0);
    const out = await call('POST', PATH, { auth: true, body: { parent, name: 'com-gh', github: 'private', githubUser: 'ana' } });
    assert.deepEqual([out.status, out.json.github], [200, { ok: true, url: 'https://github.com/ana/com-gh', private: true }]);
    assert.ok(ghCalls.includes('gh repo create ana/com-gh --private --source . --remote origin --push'));
    assert.equal((await call('POST', PATH, { auth: true, body: { parent, name: 'z', github: 'sim' } })).status, 400);
  });
});

test('the demo never creates a folder', async () => {
  await withServer(async ({ call, parent }) => {
    assert.equal((await call('POST', PATH, { auth: true, body: { parent, name: 'a' } })).status, 403);
    assert.throws(() => statSync(join(parent, 'a')));
  }, { demo: true });
});
