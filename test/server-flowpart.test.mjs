// GET /api/arch/:projectId/model/part/:partId: level 2 of the Flow, inside a part (flow.md fl09). Read without a key on
// this PC like the model; the colours from what conversations changed need the key (server.md); nothing is written to
// the project, and nothing new to session-map's storage either: the view is made from the model build kept in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { createApp } from '../server/main.mjs';

const FIX = join(import.meta.dirname, 'fixtures', 'arch-pt');
const DIR = 'docs/arquitetura';
const folder = (root) => Object.fromEntries(readdirSync(join(root, DIR)).map((f) => [f, readFileSync(join(root, DIR, f), 'utf8')]));
const CODE = {
  'packages/core/src/pedido/total.ts': '// Soma o total do pedido, com o frete.\nexport const total = (x: number) => x;\n',
  'packages/core/src/pedido/cesta.ts': "import { total } from './total';\nexport const cesta = () => total(1);\n",
  'apps/api/src/rotas/pedidos.ts': "import { cesta } from '../../../../packages/core/src/pedido/cesta';\nexport const rota = () => cesta();\n",
  'apps/api/src/plugins/auth.ts': 'export const auth = 1;\n',
};
const INTERNALS = Symbol.for('session-map.internals');
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

async function withServer(fn, { demo = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-flowpart-root-'));
  mkdirSync(join(root, DIR), { recursive: true });
  cpSync(FIX, join(root, DIR), { recursive: true });
  for (const [path, text] of Object.entries(CODE)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const dir = mkdtempSync(join(tmpdir(), 'sm-flowpart-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-flowpart-sm-'));
  const arch = { ...parseArch(DIR, folder(root)), links: [] };
  const state = {
    projects: [
      { id: 'feira-abc123', name: 'feira', root, arch, workCells: [], chats: [{ sessionId: 's1', status: 'busy', title: 'Mexendo no total' }] },
      { id: 'far-def456', name: 'far', root, arch: { ...arch, source: 'main-branch' }, workCells: [], chats: [] },
    ],
    [INTERNALS]: {
      changes: new Map([['feira-abc123', { rows: [{ path: 'packages/core/src/pedido/total.ts', ts: minutesAgo(2), sessionId: 's1', state: 'pending', added: 3, removed: 1 }] }]]),
    },
  };
  const token = demo ? 'f'.repeat(64) : loadToken(smDir);
  const app = createApp({ dir, smDir, demo, chat: null, token, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const key = { cookie: `sm_token=${token}` };
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
  const settled = async (path, opts) => {
    for (let i = 0; i < 100; i++) {
      const res = await call('GET', path, opts);
      if (res.status !== 200 || !res.body.building) return res;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the view never finished');
  };
  try {
    await fn({ call, settled, key, write, root, smDir });
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
const PART = '/api/arch/feira-abc123/model/part/cesta-e-pedidos';
const carriesSide = (model) => ['owners', 'links', 'trace', 'side'].some((x) => x in model);

test('a part seen from the inside, on this PC without the key: its pieces, the arrows between them and its neighbours, no colours of changes', async () => {
  await withServer(async ({ settled }) => {
    const res = await settled(PART);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const { view } = res.body;
    assert.equal(view.partId, 'cesta-e-pedidos');
    const ids = view.nodes.map((n) => n.id);
    for (const id of ['c:packages/core/src/pedido/total.ts', 'c:packages/core/src/pedido/cesta.ts', 'c:apps/api/src/rotas/pedidos.ts']) assert.ok(ids.includes(id), id);
    assert.ok(view.edges.some((e) => e.id === 'c:packages/core/src/pedido/cesta.ts>c:packages/core/src/pedido/total.ts#import'), 'the basket uses the total');
    assert.equal(view.nodes.find((n) => n.id === 'part:vitrine').side, 'in');
    assert.equal(view.nodes.find((n) => n.id === 'part:pagamentos').side, 'out');
    assert.equal(view.nodes.find((n) => n.id === 'c:packages/core/src/pedido/total.ts').head, 'Soma o total do pedido, com o frete.');
    assert.equal(res.body.live, null, 'what conversations changed needs the key, even here');
    assert.equal(res.body.keyed, false);
    const general = (await settled('/api/arch/feira-abc123/model')).body;
    for (const k of ['owners', 'links', 'trace', 'side']) assert.equal(k in general, false, `the general model does not carry ${k}`);
    assert.equal(carriesSide(general.model), false);
  });
});

test('with the key the pieces get their colours; a recolour asks only for them', async () => {
  await withServer(async ({ settled, call, key }) => {
    const res = await settled(PART, { headers: key });
    assert.deepEqual(res.body.live['c:packages/core/src/pedido/total.ts'], { tone: 'live', files: 1, unsaved: 1 });
    assert.equal(res.body.keyed, true);
    assert.equal(JSON.stringify(res.body).includes('Mexendo no total'), false, 'no chat titles here');
    const again = await call('GET', `${PART}?only=live`, { headers: key });
    assert.equal(again.status, 200);
    assert.equal(again.body.key, res.body.view.key);
    assert.equal(again.body.view, undefined);
    assert.deepEqual(again.body.live, res.body.live);
    assert.equal((await call('GET', `${PART}?only=live`)).body.live, null);
  });
});

test('an unknown part or a strange id is 404; a write without the key is 401', async () => {
  await withServer(async ({ call, write }) => {
    assert.equal((await call('GET', '/api/arch/feira-abc123/model/part/nope')).status, 404);
    const odd = await call('GET', '/api/arch/feira-abc123/model/part/..%2F..%2Fx');
    assert.equal(odd.status, 404);
    assert.equal(odd.body.error, 'unknown-part');
    const { cookie, ...noKey } = write;
    assert.ok(cookie);
    assert.equal((await call('POST', PART, { headers: noKey, body: {} })).status, 401);
    assert.equal((await call('POST', PART, { headers: write, body: {} })).status, 404);
  });
});

test('nothing is written: the project stays the same and session-map keeps only the model', async () => {
  await withServer(async ({ settled, root, smDir }) => {
    const before = snapshot(root);
    await settled(PART);
    await settled('/api/arch/far-def456/model/part/cesta-e-pedidos');
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(readdirSync(join(smDir, 'brain', 'feira-abc123')).sort(), ['flow-model.json']);
  });
});

test('a map from the main branch shows the inside too, with the paths but not the lines of the part file', async () => {
  await withServer(async ({ settled }) => {
    const res = await settled('/api/arch/far-def456/model/part/cesta-e-pedidos');
    assert.equal(res.status, 200);
    const total = res.body.view.nodes.find((n) => n.id === 'c:packages/core/src/pedido/total.ts');
    assert.deepEqual(total.declared, [{ file: 'docs/arquitetura/cesta-e-pedidos.md', line: null, via: 'part-doc' }]);
    assert.equal(res.body.view.how, null);
  });
});

test('the demo answers from what the part file declares and writes nothing', async () => {
  await withServer(async ({ call, smDir }) => {
    const { projects } = (await call('GET', '/api/state')).body;
    const shop = projects.find((p) => p.arch.source === 'worktree' && p.arch.parts.some((x) => x.codePaths?.length));
    const part = shop.arch.parts.find((x) => x.codePaths?.length);
    const res = await call('GET', `/api/arch/${shop.id}/model/part/${part.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.view.notes.some((n) => n.key === 'declaredOnly'));
    assert.equal(res.body.view.nodes.filter((n) => n.kind === 'component').length, new Set(part.codePaths.map((p) => p.replace(/^\.\//, ''))).size);
    assert.equal(res.body.live, null);
    assert.equal(readdirSync(smDir).includes('brain'), false);
  }, { demo: true });
});
