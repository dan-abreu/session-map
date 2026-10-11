// The version watch over HTTP (or15): POST /api/ai/versions/check ("check now"), the versions in GET /api/ai/others and in the
// dialog's view, and the alert that goes out through the watcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { setKey } from '../server/ai/keys.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { createHelperRoutes } from '../server/ai/helperroute.mjs';

const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const KEY = 'sk-proj-OPENAISECRET0000000000001234';
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };

async function withServer(fn, { list = [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-ver-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-ver-sm-'));
  await setKey(smDir, 'openai', KEY, { backend });
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: true, dailyUSD: 1 } } }));
  const seen = [];
  const clock = { t: Date.parse('2026-10-11T12:00:00Z') };
  const fetchFn = async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers });
    const body = { data: list };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, helpers: { backend }, versions: { fetchFn, now: () => clock.t },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, { auth = 'header' } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (auth === 'header') headers['x-session-map-token'] = token;
    if (auth === 'wrong') headers['x-session-map-token'] = 'f'.repeat(64);
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    await fn({ call, smDir, app, seen, clock });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    forgetLife(smDir);
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('"check now" needs the token', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', '/api/ai/versions/check', { auth: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/api/ai/versions/check', { auth: 'none' })).status, 403, 'no token and no same-origin mark');
  });
});

test('"check now" asks the providers with a key, shows what it found in the others list and the dialog, and raises one alert', async () => {
  await withServer(async ({ call, smDir, app, seen }) => {
    const r = await call('POST', '/api/ai/versions/check');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(seen.map((s) => new URL(s.url).host), ['api.openai.com'], 'only the provider with a key is asked');
    assert.deepEqual(r.json.versions.openai.notes.map((n) => [n.type, n.model]), [['gone', 'gpt-6-astra']]);
    assert.ok(!JSON.stringify(r.json).includes(KEY), 'no key in the answer');

    const others = await call('GET', '/api/ai/others');
    assert.deepEqual(others.json.versions.openai.notes.map((n) => n.model), ['gpt-6-astra']);

    const view = createHelperRoutes({ smDir, backend }).view();
    assert.deepEqual(view.versions.openai.notes.map((n) => n.model), ['gpt-6-astra']);

    const alerts = app.watcher.since(0).alerts.filter((a) => a.kind === 'aiversion');
    assert.deepEqual(alerts.map((a) => [a.reason, a.provider, a.model]), [['aiv-gone', 'openai', 'gpt-6-astra']]);

    const again = await call('POST', '/api/ai/versions/check');
    assert.equal(again.status, 200);
    assert.equal(seen.length, 1, 'a second press within a minute asks nobody');
    assert.equal(app.watcher.since(0).alerts.filter((a) => a.kind === 'aiversion').length, 1, 'and alerts nothing again');
  });
});

test('the demo has no version watch', async () => {
  const app = createApp({ demo: true, token: 'x'.repeat(64), chat: null });
  assert.equal(typeof app.startVersionWatch, 'function');
  app.startVersionWatch(); // does nothing, no timers
  await new Promise((resolve) => app.close(resolve));
});
