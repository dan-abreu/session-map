import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { configureLog, log, recordProject } from '../server/log.mjs';

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-logs-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-logs-sm-'));
  const app = createApp({ dir, smDir, chat: null, ai: { bin: null }, collectFn: () => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] }), ...opts });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, { headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    await fn({ call, token, port, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('the log routes need the key, even locally', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/logs')).status, 401);
    assert.equal((await call('GET', '/api/logs/projects/shop-1')).status, 401);
  });
});

test('GET /api/logs answers the program log newest first, with the filters', async () => {
  await withServer({}, async ({ call, smDir, token }) => {
    configureLog({ dir: smDir });
    try {
      log('info', 'boot', {});
      log('warn', 'read-failed', { path: 'x' });
      log('info', 'listening', { local: 'http://127.0.0.1:4001/?k=abc123def456abc123def456abc123def456' });
      const key = { cookie: `sm_token=${token}` };
      const all = await call('GET', '/api/logs', { headers: key });
      assert.equal(all.status, 200);
      const rows = JSON.parse(all.text).rows;
      assert.deepEqual(rows.map((r) => r.event), ['listening', 'read-failed', 'boot']);
      assert.ok(!JSON.stringify(rows).includes('abc123'), 'the token never leaves through the route');
      const warn = await call('GET', '/api/logs?level=warn', { headers: key });
      assert.deepEqual(JSON.parse(warn.text).rows.map((r) => r.event), ['read-failed']);
      const one = await call('GET', '/api/logs?event=boot', { headers: key });
      assert.deepEqual(JSON.parse(one.text).rows.map((r) => r.event), ['boot']);
      const two = await call('GET', '/api/logs?limit=2', { headers: key });
      assert.equal(JSON.parse(two.text).rows.length, 2);
    } finally {
      configureLog({ dir: null });
    }
  });
});

test('GET /api/logs/projects/<id> answers one project\'s record and refuses bad ids', async () => {
  await withServer({}, async ({ call, smDir, token }) => {
    recordProject(smDir, 'shop-1', 'finished', { sessionId: 's1' });
    recordProject(smDir, 'shop-1', 'waiting', { reason: 'question' });
    const key = { cookie: `sm_token=${token}` };
    const res = await call('GET', '/api/logs/projects/shop-1', { headers: key });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text).rows.map((r) => r.event), ['waiting', 'finished']);
    const empty = await call('GET', '/api/logs/projects/nobody', { headers: key });
    assert.deepEqual(JSON.parse(empty.text).rows, []);
    assert.equal((await call('GET', '/api/logs/projects/-bad', { headers: key })).status, 400);
  });
});

test('the demo serves no log and writes nothing', async () => {
  await withServer({ demo: true }, async ({ call, smDir }) => {
    assert.equal((await call('GET', '/api/logs')).status, 403);
    const files = await import('node:fs').then((fs) => { try { return fs.readdirSync(join(smDir, 'logs')); } catch { return []; } });
    assert.deepEqual(files, []);
  });
});
