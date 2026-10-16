import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { writeCare } from '../server/foundation/care.mjs';
import { createApp } from '../server/main.mjs';

// mm27: the Requests tab's decisions reach the registry through POST /api/arch/<project>/request.

const DIR = 'docs/architecture';
const REGISTRY = [
  '# Ideas', '', '## Where in the code', '', '- `docs/architecture/ideas.md`', '', "## What's missing", '',
  '- [ ] A flow you draw `id01`', '  - Asked: 2026-10-09 16:20 — "x"', '  - Where it went: `al01`.', '  - Status: accepted.',
  '- [ ] Everything built `id02`', '  - Asked: 2026-10-10 10:00 — "y"', '  - Where it went: `al02`.', '  - Status: in progress.', '',
].join('\n');
const ALPHA = ['# Alpha', '', '## Where in the code', '', '- `server/alpha/`', '', "## What's missing", '', '- [ ] Open work `al01`', '- [x] Done work `al02`', ''].join('\n');
const FILES = { 'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Ideas](ideas.md)\n', 'alpha.md': ALPHA, 'ideas.md': REGISTRY };

async function withServer(fn, { demo = false, age = 60_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-reqsrv-root-'));
  const dir = mkdtempSync(join(tmpdir(), 'sm-reqsrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-reqsrv-sm-'));
  mkdirSync(join(root, DIR), { recursive: true });
  const old = new Date(Date.now() - age);
  for (const [name, text] of Object.entries(FILES)) { writeFileSync(join(root, DIR, name), text); utimesSync(join(root, DIR, name), old, old); }
  const state = { projects: [{ id: 'feira-abc123', name: 'feira', root, arch: parseArch(DIR, FILES, 'worktree'), workCells: [], chats: [] }] };
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
  try {
    await fn({ call, write, smDir, file: join(root, DIR, 'ideas.md') });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [root, dir, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const URL_ = '/api/arch/feira-abc123/request';
// A write makes the registry recent (a chat may be writing it); the test waits as if the seconds had passed.
const settle = (file) => { const old = new Date(Date.now() - 60_000); utimesSync(file, old, old); };

test('Later and Discard write the registry in auto mode; the answer says what happened and the file keeps every other line', async () => {
  await withServer(async ({ call, write, smDir, file }) => {
    writeCare(smDir, 'feira-abc123', 'auto');
    const later = await call('POST', URL_, { headers: write, body: { code: 'id01', to: 'later', reason: 'wait for the release' } });
    assert.equal(later.status, 200, JSON.stringify(later.body));
    assert.equal(later.body.changed, true);
    assert.match(readFileSync(file, 'utf8'), /- Status: later \(parked in the review of \d{4}-\d{2}-\d{2}: wait for the release\)\. Before: accepted\./);
    settle(file);
    const noReason = await call('POST', URL_, { headers: write, body: { code: 'id02', to: 'discarded' } });
    assert.deepEqual([noReason.status, noReason.body.error], [400, 'reason-needed']);
    const notDone = await call('POST', URL_, { headers: write, body: { code: 'id01', to: 'done' } });
    assert.deepEqual([notDone.status, notDone.body.error], [409, 'not-finished']);
    settle(file);
    const closed = await call('POST', URL_, { headers: write, body: { code: 'id02', to: 'done' } });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.match(readFileSync(file, 'utf8'), /- \[x\] Everything built `id02`/);
    settle(file);
    assert.deepEqual((await call('POST', URL_, { headers: write, body: { code: 'id77', to: 'later' } })).body, { ok: false, error: 'unknown-request' });
  });
});

test('in look-only mode nothing is written, and a bad body or a missing key never reaches the registry', async () => {
  await withServer(async ({ call, write, smDir, file }) => {
    const before = readFileSync(file, 'utf8');
    writeCare(smDir, 'feira-abc123', 'look');
    const looked = await call('POST', URL_, { headers: write, body: { code: 'id01', to: 'later', reason: 'x' } });
    assert.equal(looked.body.changed, false);
    assert.equal(readFileSync(file, 'utf8'), before);
    writeCare(smDir, 'feira-abc123', 'auto');
    for (const body of [{ code: '../x', to: 'later' }, { code: 'id01', to: 'dropped' }, { code: 'id01', to: 'later', reason: 5 }, {}]) {
      assert.equal((await call('POST', URL_, { headers: write, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await call('POST', URL_, { headers: { ...write, cookie: '' }, body: { code: 'id01', to: 'later' } })).status, 401, 'a write needs the key');
    assert.equal(readFileSync(file, 'utf8'), before);
  });
});

test('a registry written in the last seconds answers busy and the demo never writes', async () => {
  await withServer(async ({ call, write, smDir, file }) => {
    writeCare(smDir, 'feira-abc123', 'auto');
    const before = readFileSync(file, 'utf8');
    assert.deepEqual([(await call('POST', URL_, { headers: write, body: { code: 'id01', to: 'later' } })).status], [409]);
    assert.equal(readFileSync(file, 'utf8'), before);
  }, { age: 300 });
  await withServer(async ({ call, write }) => {
    const { projects } = (await call('GET', '/api/state')).body;
    const shop = projects.find((p) => p.arch.source === 'worktree');
    assert.equal((await call('POST', `/api/arch/${shop.id}/request`, { headers: write, body: { code: 'id01', to: 'later' } })).status, 403);
  }, { demo: true });
});
