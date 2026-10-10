import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

const INTERNALS = Symbol.for('session-map.internals');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

function fakeState(root) {
  const rows = [
    { id: 'wt:a.js', ts: '2026-10-09T10:00:00.000Z', kind: 'edit', path: 'a.js', added: 1, removed: 1, sessionId: null, title: null, agent: null, model: null, state: 'pending', inFolder: true, partId: null },
  ];
  const state = {
    generatedAt: '2026-10-09T10:00:00.000Z', waitingCount: 0,
    projects: [
      { id: 'shop-abc123', name: 'shop', root, arch: { parts: [], layers: [] }, workCells: [], chats: [] },
      { id: 'blog-def456', name: 'blog', root, arch: { parts: [], layers: [] }, workCells: [], chats: [] },
    ],
  };
  const changes = new Map([
    ['shop-abc123', { root, rows, refs: new Map([['wt:a.js', { wt: 'a.js' }]]) }],
    ['blog-def456', { root, rows: [{ ...rows[0], id: 'wt:b.js', path: 'b.js', ts: '2026-10-09T11:00:00.000Z' }], refs: new Map() }],
  ]);
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map(), changes }, enumerable: false });
  return state;
}

async function withServer(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-sc-')));
  writeFileSync(join(root, 'a.js'), 'one\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');
  writeFileSync(join(root, 'a.js'), 'ONE\n');
  const dir = mkdtempSync(join(tmpdir(), 'sm-sc-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-sc-sm-'));
  const app = createApp({ dir, smDir, ai: { bin: null }, chat: null, collectFn: () => fakeState(root) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (path, { cookie = true } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}`, ...(cookie ? { cookie: `sm_token=${token}` } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text.startsWith('{') ? JSON.parse(text) : text }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    await fn({ call });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    app.watcher?.stop();
    for (const d of [root, dir, smDir]) rmSync(d, { recursive: true, force: true });
  }
}

test('the Changes tab asks for the rows of one project or of all, only with the key', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/api/changes/shop-abc123', { cookie: false })).status, 401, 'file names and who changed them need the key, even from this PC');
    const one = await call('/api/changes/shop-abc123');
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.rows.map((r) => [r.projectId, r.path]), [['shop-abc123', 'a.js']]);
    const all = await call('/api/changes/*');
    assert.deepEqual(all.body.rows.map((r) => [r.projectId, r.path]), [['blog-def456', 'b.js'], ['shop-abc123', 'a.js']], 'every project, newest first');
    assert.equal((await call('/api/changes/nope')).status, 404);
  });
});

test('one change opens with its before and after', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/api/change/shop-abc123?id=wt%3Aa.js', { cookie: false })).status, 401);
    const res = await call('/api/change/shop-abc123?id=wt%3Aa.js');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hunks[0].lines, ['-one', '+ONE']);
    assert.equal((await call('/api/change/shop-abc123?id=unknown')).status, 404);
  });
});
