import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

const chat = (status) => ({ sessionId: 'a', title: 'Fix it', status, archived: false, lastAssistantText: 'All done.', waiting: { strong: false, weak: false, items: [] } });
const stateOf = (status) => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: 'shop-1', name: 'shop', chats: [chat(status)], decisions: [], conversations: [], workCells: [], arch: { parts: [] } }] });

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-al-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-al-sm-'));
  const delivered = [];
  const states = [stateOf('busy'), stateOf('idle')];
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => states.shift() ?? stateOf('idle'), deliver: async (alerts, prefs) => { delivered.push({ alerts, prefs }); }, ...opts });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
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
    await fn({ app, call, smDir, delivered });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('the watcher runs on the server\'s own state and the page reads its feed without the token, like the state', async () => {
  await withServer({}, async ({ app, call, delivered }) => {
    await app.watcher.tick();
    await app.watcher.tick();
    const feed = await call('GET', '/api/alerts?since=0');
    assert.equal(feed.status, 200);
    assert.deepEqual(feed.json.alerts.map((a) => [a.kind, a.sessionId, a.summary]), [['finished', 'a', 'All done.']]);
    assert.equal((await call('GET', `/api/alerts?since=${feed.json.lastId}`)).json.alerts.length, 0);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].prefs.desktop, true, 'delivery gets the saved choices');
  });
});

test('alert choices: reading and saving need the token; saved choices reach delivery and the feed', async () => {
  await withServer({}, async ({ call, smDir }) => {
    assert.equal((await call('GET', '/api/settings/notify')).status, 401);
    const got = await call('GET', '/api/settings/notify', { auth: true });
    assert.equal(got.json.notify.desktop, true);
    assert.equal(typeof got.json.desktopAvailable, 'boolean');
    assert.equal((await call('POST', '/api/settings/notify', { body: { desktop: false } })).status, 401);
    const saved = await call('POST', '/api/settings/notify', { auth: true, body: { desktop: false, perProject: { 'shop-1': { finished: false } } } });
    assert.equal(saved.status, 200);
    assert.equal(JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')).notify.desktop, false);
    assert.equal((await call('POST', '/api/settings/notify', { auth: true, body: { desktop: 'x' } })).status, 400);
    const log = readFileSync(join(smDir, 'actions.log'), 'utf8');
    assert.match(log, /"action":"notify"/);
  });
});

test('a test alert goes through every way that is on, and shows in the page\'s feed', async () => {
  await withServer({}, async ({ call, delivered }) => {
    assert.equal((await call('POST', '/api/settings/notify/test', {})).status, 401);
    assert.equal((await call('POST', '/api/settings/notify/test', { auth: true, body: {} })).status, 200);
    await new Promise((r) => setImmediate(r));
    assert.equal(delivered.at(-1).alerts[0].reason, 'test');
    assert.equal((await call('GET', '/api/alerts?since=0')).json.alerts[0].reason, 'test');
  });
});

test('the demo has an empty feed and no alert settings', async () => {
  await withServer({ demo: true }, async ({ app, call }) => {
    assert.equal(app.watcher, null);
    assert.deepEqual((await call('GET', '/api/alerts?since=0')).json.alerts, []);
    assert.equal((await call('GET', '/api/settings/notify', { auth: true })).status, 403);
  });
});
