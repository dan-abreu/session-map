import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize } from '../server/auth.mjs';
import { modelCachePath } from '../server/arch/flowmodel.mjs';
import { createFoundationRoute } from '../server/foundation/http/index.mjs';
import * as model from '../server/foundation/http/model.mjs';
import { writeAtomic } from '../server/store.mjs';

// fd25: the Foundation's route of the model serves the one model, the Flow's, as the last build kept it.

const ID = 'acme-shop-8324f1';
const TOKEN = 'c'.repeat(64);

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}`, cookie: `sm_token=${TOKEN}` } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the route answers null before the first build, then the Flow model the build kept', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdmodel-'));
  const handle = createFoundationRoute({ smDir, demo: false, token: TOKEN, projects: async () => [{ id: ID, name: 'acme-shop', root: '/work/acme-shop', arch: { lang: 'en' } }], modules: [model] });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = authorize(req, url, { token: TOKEN, address: '127.0.0.1' });
    if (auth.status !== 200) { res.writeHead(auth.status); return res.end(); }
    await handle(req, res, url);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.deepEqual(await get(port, `/api/foundation/${ID}/model`), { status: 200, body: null });
    const kept = { version: 2, nodes: [{ id: 'part:web', kind: 'part', partId: 'web' }], edges: [] };
    writeAtomic(modelCachePath(smDir, ID), JSON.stringify({ version: 2, files: {}, scans: {}, nodes: {}, model: kept }));
    assert.deepEqual(await get(port, `/api/foundation/${ID}/model`), { status: 200, body: kept });
    assert.equal((await get(port, `/api/foundation/${ID}/model/layout`)).status, 404, 'the owner\'s drawing of the old block has no route: the drawing is the Flow\'s draft');
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(smDir, { recursive: true, force: true });
  }
});
