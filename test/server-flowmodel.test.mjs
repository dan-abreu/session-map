// GET /api/arch/:projectId/model: the Flow's single model (flow.md fl07, fl08), read without a key on this PC (fl04),
// built in the background and kept only in session-map's storage, never in the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { createApp } from '../server/main.mjs';

const FIX = join(import.meta.dirname, 'fixtures', 'arch-pt');
const DIR = 'docs/arquitetura';
const folder = (root) => Object.fromEntries(readdirSync(join(root, DIR)).map((f) => [f, readFileSync(join(root, DIR, f), 'utf8')]));

async function withServer(fn, { demo = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-flowmodel-srv-root-'));
  mkdirSync(join(root, DIR), { recursive: true });
  cpSync(FIX, join(root, DIR), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'pay.mjs'), "import Stripe from 'stripe';\nexport const s = new Stripe('k');\n");
  const dir = mkdtempSync(join(tmpdir(), 'sm-flowmodel-srv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-flowmodel-srv-sm-'));
  const arch = { ...parseArch(DIR, folder(root)), links: [] };
  const state = {
    projects: [
      { id: 'feira-abc123', name: 'feira', root, arch, workCells: [], chats: [] },
      { id: 'far-def456', name: 'far', root, arch: { ...arch, source: 'main-branch' }, workCells: [], chats: [] },
    ],
  };
  const token = demo ? 'f'.repeat(64) : loadToken(smDir);
  const app = createApp({ dir, smDir, demo, chat: null, token, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
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
  // The first answer may come while the code is still being read (building: true): ask again until it is done.
  const settled = async (path) => {
    for (let i = 0; i < 100; i++) {
      const res = await call('GET', path);
      if (res.status !== 200 || !res.body.building) return res;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the model never finished');
  };
  try {
    await fn({ call, settled, write, root, smDir, arch });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [root, dir, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const snapshot = (root) => {
  const out = {};
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else out[path] = [readFileSync(join(root, path), 'utf8'), statSync(join(root, path)).mtimeMs];
    }
  };
  walk('');
  return out;
};

test('the model is read on this PC without the key: every part, the services in the code, room for journeys', async () => {
  await withServer(async ({ call, settled, arch }) => {
    const res = await settled('/api/arch/feira-abc123/model');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const { model } = res.body;
    assert.equal(model.version, 1);
    assert.equal(model.source, 'worktree');
    const parts = model.nodes.filter((n) => n.kind === 'part').map((n) => n.partId).sort();
    assert.deepEqual(parts, arch.parts.map((p) => p.id).sort());
    assert.ok(Array.isArray(model.journeys));
    assert.ok(model.nodes.some((n) => n.id === 'svc:stripe'), 'the SDK the code imports');
    assert.ok(model.edges.every((e) => e.label.text || e.label.key || e.label.missing));
    assert.equal((await call('GET', '/api/arch/feira-abc123/model', { headers: { host: 'evil.example:80' } })).status, 401, 'a foreign Host is not local');
  });
});

test('an unknown project is 404; the model is read only: a write without the key is 401, with it 404', async () => {
  await withServer(async ({ call, write }) => {
    assert.equal((await call('GET', '/api/arch/nope/model')).status, 404);
    const { cookie, ...noKey } = write;
    assert.ok(cookie);
    assert.equal((await call('POST', '/api/arch/feira-abc123/model', { headers: noKey, body: {} })).status, 401);
    const res = await call('POST', '/api/arch/feira-abc123/model', { headers: write, body: {} });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not-found');
  });
});

test('a map from the main branch: the model says so, the project is never written, the cache lives in session-map storage', async () => {
  await withServer(async ({ settled, root, smDir }) => {
    const before = snapshot(root);
    const res = await settled('/api/arch/far-def456/model');
    assert.equal(res.status, 200);
    assert.equal(res.body.model.source, 'main-branch');
    assert.deepEqual(res.body.model.notes, ['code-from-folder']);
    assert.deepEqual(snapshot(root), before);
    assert.ok(existsSync(join(smDir, 'brain', 'far-def456', 'flow-model.json')));
  });
});

test('the general view refuses to be imported as parts', async () => {
  await withServer(async ({ call, write }) => {
    const text = '%% session-map:view general\nflowchart LR\n  A(["You, in the browser"]) -.->|pages| B[Vitrine]\n';
    const res = await call('POST', '/api/arch/feira-abc123/mermaid/preview', { headers: write, body: { text } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'view-not-importable');
  });
});

test('the demo answers with what the README declares and writes nothing', async () => {
  await withServer(async ({ call, smDir }) => {
    const { projects } = (await call('GET', '/api/state')).body;
    const shop = projects.find((p) => p.arch.source === 'worktree');
    const res = await call('GET', `/api/arch/${shop.id}/model`);
    assert.equal(res.status, 200);
    assert.equal(res.body.model.source, 'demo');
    assert.ok(res.body.model.nodes.some((n) => n.kind === 'part'));
    assert.ok(res.body.model.nodes.every((n) => n.detected.length === 0), 'nothing detected: the demo reads no code');
    assert.equal(existsSync(join(smDir, 'brain')), false);
  }, { demo: true });
});
