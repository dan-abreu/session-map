import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

function makeRepo() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-sf-')));
  const root = join(base, 'repo');
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, 'src', 'a.js'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  git(root, 'add', '-f', '.');
  git(root, 'commit', '-m', 'first');
  git(root, 'checkout', '-b', 'feature/x');
  writeFileSync(join(root, 'src', 'a.js'), 'one\nTWO\nthree\n');
  writeFileSync(join(root, 'src', 'new.js'), 'a\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');
  git(root, 'checkout', 'main');
  return { base, root };
}

const fakeState = (root) => ({
  generatedAt: '', waitingCount: 0, projects: [{
    id: 'shop-abc123', root, mainBranch: 'main',
    arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [
      { id: 'src', name: 'Src', file: 'docs/architecture/src.md', about: '', codePaths: ['src/'], groups: [], workCellIds: ['feature/x'], chatIds: [] },
      { id: 'empty', name: 'Empty', file: 'docs/architecture/empty.md', about: '', codePaths: [], groups: [], workCellIds: [], chatIds: [] },
    ] },
    workCells: [{ id: 'feature/x', branch: 'feature/x', remote: false, path: null, partId: 'src', files: [{ path: 'src/a.js', status: 'M' }, { path: 'src/new.js', status: 'A' }, { path: 'src/gone.js', status: 'D' }] }],
    chats: [],
  }],
});

async function withServer(fn) {
  const { base, root } = makeRepo();
  const dir = mkdtempSync(join(tmpdir(), 'sm-sf-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-sf-sm-'));
  const app = createApp({ dir, smDir, ai: { bin: null }, collectFn: () => fakeState(root) });
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
    await fn({ call, root });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [base, dir, smDir]) rmSync(d, { recursive: true, force: true });
  }
}

const enc = encodeURIComponent;

test('the file list of a branch is its diff, of a part the tracked files under its code paths', async () => {
  await withServer(async ({ call }) => {
    const cell = await call('/api/files/shop-abc123?workCell=feature%2Fx');
    assert.equal(cell.status, 200);
    assert.deepEqual(cell.body.files.map((f) => `${f.status} ${f.path}`), ['M src/a.js', 'A src/new.js', 'D src/gone.js']);
    const part = await call('/api/files/shop-abc123?part=src');
    assert.deepEqual(part.body.files, [
      { path: 'src/a.js', status: 'M', workCell: 'feature/x', lines: 3, kind: 'code' }, { path: 'src/gone.js', status: 'D', workCell: 'feature/x' }, { path: 'src/new.js', status: 'A', workCell: 'feature/x' },
    ], 'the branch files show up even where the folder on disk does not have them yet; a counted file says its lines and kind (mm25)');
    assert.deepEqual((await call('/api/files/shop-abc123?part=empty')).body.files, []);
    assert.equal((await call('/api/files/shop-abc123?part=ghost')).status, 404);
    assert.equal((await call('/api/files/shop-abc123?workCell=ghost')).status, 404);
    assert.equal((await call('/api/files/shop-abc123')).status, 400);
    assert.equal((await call('/api/files/ghost?part=src')).status, 404);
  });
});

test('a file opens read-only with the branch changes marked, even for a branch with no folder', async () => {
  await withServer(async ({ call }) => {
    const out = await call(`/api/file/shop-abc123?workCell=${enc('feature/x')}&path=${enc('src/a.js')}`);
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { ok: true, text: 'one\nTWO\nthree\n', lines: 3, changes: [{ from: 2, to: 2 }] });
    const plain = await call(`/api/file/shop-abc123?path=${enc('src/a.js')}`);
    assert.equal(plain.body.text, 'one\ntwo\nthree\n', 'with no branch it is the project folder');
    assert.deepEqual(plain.body.changes, []);
  });
});

test('file routes refuse escapes, secrets, missing files and callers without the token', async () => {
  await withServer(async ({ call }) => {
    const get = (path) => call(`/api/file/shop-abc123?path=${enc(path)}`);
    for (const bad of ['../x', '..\\x', '%2e%2e/x', '/etc/passwd', '.git/config']) assert.equal((await get(bad)).status, 400, bad);
    assert.equal((await call('/api/file/shop-abc123?path=..%2Fx')).status, 400, 'encoded once by the client');
    assert.equal((await call('/api/file/shop-abc123?path=%252e%252e%2Fx')).status, 400, 'double-encoded dots');
    assert.equal((await get('.env')).status, 403);
    assert.equal((await get('src/nope.js')).status, 404);
    assert.equal((await get('src')).status, 404);
    assert.equal((await call('/api/file/shop-abc123')).status, 400);
    assert.equal((await call('/api/file/shop-abc123?path=src%2Fa.js', { cookie: false })).status, 401);
    assert.equal((await call('/api/files/shop-abc123?part=src', { cookie: false })).status, 401);
  });
});

test('GET /api/files/:project?find= lists files for an @ mention, only with the token (mm22)', async () => {
  await withServer(async ({ call }) => {
    const found = await call('/api/files/shop-abc123?find=a.js');
    assert.equal(found.status, 200);
    assert.deepEqual(found.body.files, ['src/a.js']);
    assert.equal((await call('/api/files/shop-abc123?find=env')).body.files.length, 0, 'never the secrets file');
    assert.equal((await call('/api/files/shop-abc123?find=a', { cookie: false })).status, 401);
  });
});

test('a file opens with the files it uses and the files that use it, when asked (mm26)', async () => {
  await withServer(async ({ call, root }) => {
    writeFileSync(join(root, 'src', 'b.js'), "import { one } from './a.js';\n");
    git(root, 'add', 'src/b.js');
    const a = await call(`/api/file/shop-abc123?path=${enc('src/a.js')}&links=1`);
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.links, { graph: true, uses: [], usedBy: [{ path: 'src/b.js', line: 1 }], libraries: [] });
    const plain = await call(`/api/file/shop-abc123?path=${enc('src/a.js')}`);
    assert.equal(plain.body.links, undefined, 'only when asked: the graph costs a read of the project');
  });
});

test('GET /api/files/:project?all=1 lists every counted file of the program, with its lines and kind, never a secret (the project Files tab)', async () => {
  await withServer(async ({ call }) => {
    const all = await call('/api/files/shop-abc123?all=1');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.files, [{ path: 'src/a.js', status: null, lines: 3, kind: 'code' }]);
    assert.equal((await call('/api/files/shop-abc123?all=1', { cookie: false })).status, 401);
  });
});
