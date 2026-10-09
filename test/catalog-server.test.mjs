import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

const repoJson = (full, stars, over = {}) => ({
  full_name: full, name: full.split('/')[1], owner: { login: full.split('/')[0] }, stargazers_count: stars,
  description: 'Write clear docs', topics: ['claude-skills'], pushed_at: '2026-10-01T00:00:00Z', license: null, archived: false, ...over,
});

function fakeFetch(handler) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    const { status = 200, body = { items: [] } } = handler(String(url));
    return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
  };
  return { fetchFn, calls };
}

async function withServer({ fetchFn, exec, bin, demo = false }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-csrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-csrv-sm-'));
  const app = createApp({ dir, smDir, demo, ai: { bin: null }, collectFn: () => ({ projects: [], generatedAt: new Date().toISOString() }), catalog: { token: null, fetchFn, exec, bin } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const write = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  try {
    await fn({ call, dir, smDir, write, token });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const SEARCH = (url) => (url.includes('topic%3Aclaude-skills')
  ? { body: { items: [repoJson('a/low', 3), repoJson('b/high', 90, { description: 'Deploy with docker', topics: ['claude-skills'] })] } }
  : { body: { items: [] } });

test('GET /api/catalog fetches once, then filters and sorts the cache', async () => {
  const { fetchFn, calls } = fakeFetch(SEARCH);
  await withServer({ fetchFn }, async ({ call }) => {
    const all = JSON.parse((await call('GET', '/api/catalog')).text);
    assert.deepEqual(all.items.map((i) => i.repo), ['b/high', 'a/low']);
    assert.equal(all.total, 2);
    assert.equal(all.limited, false);
    assert.equal(typeof all.fetchedAt, 'string');
    const afterFirst = calls.length;
    const devops = JSON.parse((await call('GET', '/api/catalog?category=devops&sort=name&q=DOCKER')).text);
    assert.deepEqual(devops.items.map((i) => i.repo), ['b/high']);
    assert.equal(calls.length, afterFirst, 'served from the cache');
  });
});

test('refresh=1 refetches only with the token cookie', async () => {
  const { fetchFn, calls } = fakeFetch(SEARCH);
  await withServer({ fetchFn }, async ({ call, write }) => {
    await call('GET', '/api/catalog');
    const n = calls.length;
    await call('GET', '/api/catalog?refresh=1');
    assert.equal(calls.length, n);
    await call('GET', '/api/catalog?refresh=1', { headers: { cookie: write.cookie } });
    assert.ok(calls.length > n);
  });
});

test('when GitHub says rate limit and there is no cache the answer carries limited: true', async () => {
  const { fetchFn } = fakeFetch(() => ({ status: 429, body: { message: 'rate limit' } }));
  await withServer({ fetchFn }, async ({ call }) => {
    const res = JSON.parse((await call('GET', '/api/catalog')).text);
    assert.equal(res.limited, true);
    assert.deepEqual(res.items, []);
  });
});

test('installed repositories are flagged', async () => {
  const { fetchFn } = fakeFetch(SEARCH);
  await withServer({ fetchFn }, async ({ call, dir }) => {
    mkdirSync(join(dir, 'plugins'));
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ high: { source: { source: 'github', repo: 'b/high' } } }));
    writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'x@high': [{ installPath: 'p' }] } }));
    const res = JSON.parse((await call('GET', '/api/catalog')).text);
    assert.deepEqual(res.items.map((i) => [i.repo, i.installed]), [['b/high', true], ['a/low', false]]);
  });
});

test('install through POST /api/action needs the token and reaches the claude binary only for a cached marketplace', async () => {
  const { fetchFn } = fakeFetch(() => ({ body: { items: [] } }));
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    return { code: 1, stdout: '', stderr: 'stub: nothing really installed' };
  };
  await withServer({ fetchFn, exec, bin: 'C:/x/claude.exe' }, async ({ call, write, smDir }) => {
    const item = (repo, hasMarketplace) => ({ repo, name: repo.split('/')[1], owner: repo.split('/')[0], stars: 1, hasMarketplace, type: 'other', category: 'other' });
    writeFileSync(join(smDir, 'catalog.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), items: [item('b/market', true), item('b/plain', false)] }));
    const { cookie, ...noCookie } = write;
    const install = (repo) => ({ headers: write, body: { action: 'install', repo, scope: 'user' } });
    assert.equal((await call('POST', '/api/action', { headers: noCookie, body: install('b/market').body })).status, 401);
    assert.equal((await call('POST', '/api/action', install('b/plain'))).status, 409);
    assert.equal((await call('POST', '/api/action', install('x/unlisted'))).status, 404);
    assert.equal(calls.length, 0);
    const res = await call('POST', '/api/action', install('b/market'));
    assert.equal(res.status, 502);
    assert.deepEqual(calls, [['C:/x/claude.exe', 'plugin', 'marketplace', 'add', 'b/market', '--scope', 'user']]);
  });
});

test('the demo has no catalog and no install', async () => {
  await withServer({ demo: true, fetchFn: async () => { throw new Error('no network in the demo'); } }, async ({ call }) => {
    assert.equal((await call('GET', '/api/catalog')).status, 403);
  });
});
