import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { collect } from '../server/collect.mjs';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { findRepos, folderError, forgetScans, listFolders, reposIn, setProjectsRoot } from '../server/folders.mjs';

// The folder browser and the repositories found under the folder the owner picks (id164).
const mk = (...parts) => { const p = join(...parts); mkdirSync(p, { recursive: true }); return p; };
const repoAt = (...parts) => { const p = mk(...parts); mkdirSync(join(p, '.git')); return p; };

// A tree like a developer's disk: repositories at different depths, a repository inside one, a dependency folder with a
// repository in it, a linked worktree (.git is a file), a hidden folder, a plain folder, a file.
function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-folders-')));
  repoAt(root, 'shop');
  repoAt(root, 'shop', 'tools', 'inner');
  repoAt(root, 'work', 'api');
  mk(root, 'work', 'notes');
  repoAt(root, 'node_modules', 'lib');
  repoAt(root, '.hidden', 'secret');
  mk(root, 'wt');
  writeFileSync(join(root, 'wt', '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  mk(root, 'empty');
  writeFileSync(join(root, 'file.txt'), 'x');
  return root;
}
const names = (list) => list.map((p) => basename(p));

test('a folder is listed with its subfolders only, hidden ones left out, the repositories marked', () => {
  const root = tree();
  try {
    const out = listFolders(root);
    assert.equal(out.ok, true);
    assert.deepEqual(out.entries.map((e) => [e.name, e.repo]), [['empty', false], ['node_modules', false], ['shop', true], ['work', false], ['wt', false]]);
    assert.equal(out.entries[2].path, join(root, 'shop'));
    assert.equal(out.parent, dirname(root), 'it knows where up is');
    assert.equal(listFolders(join(root, 'shop')).repo, true, 'the folder itself says it is a repository');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the start lists the places to begin from, and a bad or missing path is refused with a reason', () => {
  const start = listFolders('');
  assert.equal(start.ok, true);
  assert.equal(start.path, '');
  assert.ok(start.entries.length > 0, 'the drives, or the root');
  assert.ok(start.home, 'and the home folder');
  assert.equal(folderError('relative/path'), 'bad-folder');
  assert.equal(folderError('\\\\server\\share\\x'), 'bad-folder', 'a network share is never looked up');
  assert.equal(folderError('//server/share'), 'bad-folder');
  assert.equal(folderError(''), 'bad-folder');
  assert.equal(folderError(7), 'bad-folder');
  assert.equal(folderError(join(tmpdir(), 'sm-folders-does-not-exist-123')), 'not-a-folder');
  assert.deepEqual(listFolders(join(tmpdir(), 'sm-folders-does-not-exist-123')), { ok: false, error: 'not-a-folder' });
});

test('the repositories under a folder: any depth up to four, never inside a repository, a dependency folder or a hidden one', () => {
  const root = tree();
  try {
    const { repos, truncated } = findRepos(root);
    assert.deepEqual(names(repos), ['shop', 'api'], 'shop and work/api; not its inner one, node_modules/lib, .hidden/secret or the worktree');
    assert.equal(truncated, false);
    assert.deepEqual(names(findRepos(join(root, 'shop')).repos), ['shop'], 'a repository picked itself is the one project');
    assert.deepEqual(findRepos(join(root, 'empty')).repos, []);
    assert.deepEqual(names(findRepos(root, { maxDepth: 1 }).repos), ['shop'], 'work/api is two levels down');
    const capped = findRepos(root, { maxRepos: 1 });
    assert.deepEqual([names(capped.repos), capped.truncated], [['shop'], true], 'a wrong pick (a whole drive) stops, and says it stopped');
    assert.equal(findRepos(root, { maxReads: 1 }).truncated, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the walk of a folder is kept for a minute, and forgotten when the choice changes', () => {
  const root = tree();
  try {
    forgetScans();
    const t0 = 1_000_000;
    assert.equal(reposIn([root], { now: t0 }).repos.length, 2);
    repoAt(root, 'empty', 'newrepo');
    assert.equal(reposIn([root], { now: t0 + 30_000 }).repos.length, 2, 'still the walk of a moment ago');
    assert.equal(reposIn([root], { now: t0 + 61_000 }).repos.length, 3, 'a minute later it looks again');
    repoAt(root, 'empty', 'another');
    forgetScans();
    assert.equal(reposIn([root], { now: t0 + 62_000 }).repos.length, 4, 'a change of choice looks again at once');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the folders he picked are kept in config.json next to his other settings, never over a file it cannot read', () => {
  const root = tree();
  const smDir = mkdtempSync(join(tmpdir(), 'sm-folders-sm-'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ currency: { code: 'BRL', rate: 5 }, projectsRoot: 'C:/old' }));
    const set = setProjectsRoot(smDir, { roots: [join(root, 'work'), join(root, 'work'), join(root, 'shop')] });
    assert.deepEqual(set, { ok: true, roots: [join(root, 'work'), join(root, 'shop')] }, 'the same folder twice is one');
    const saved = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    assert.deepEqual(saved.currency, { code: 'BRL', rate: 5 }, 'his other settings stay');
    assert.deepEqual(saved.projectsRoot, [join(root, 'work'), join(root, 'shop')]);
    assert.deepEqual(setProjectsRoot(smDir, { roots: [] }), { ok: true, roots: [] });
    assert.equal('projectsRoot' in JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')), false, 'none goes back to anywhere');
    for (const bad of [undefined, 'x', { roots: 'x' }, { roots: [join(root, 'file.txt')] }, { roots: ['relative'] }, { roots: Array(11).fill(root) }]) {
      assert.equal(setProjectsRoot(smDir, bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(setProjectsRoot(smDir, { roots: [join(root, 'nope')] }).error, 'not-a-folder');
    writeFileSync(join(smDir, 'config.json'), '{ not json');
    assert.deepEqual(setProjectsRoot(smDir, { roots: [root] }), { ok: false, error: 'config-unreadable' });
    assert.equal(readFileSync(join(smDir, 'config.json'), 'utf8'), '{ not json', 'what it could not read is left as it was');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

test('the projects of the page: every repository under the picked folder, with no conversation needed, and the rest put away', async () => {
  const root = tree();
  const dir = mkdtempSync(join(tmpdir(), 'sm-folders-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-folders-state-'));
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', ...args], { cwd, stdio: 'ignore' });
  try {
    // Real repositories this time, so the collect can read them.
    rmSync(join(root, 'shop', '.git'), { recursive: true });
    rmSync(join(root, 'work', 'api', '.git'), { recursive: true });
    for (const r of [join(root, 'shop'), join(root, 'work', 'api')]) {
      git(r, 'init', '-q', '-b', 'main');
      writeFileSync(join(r, 'a.txt'), 'a\n');
      git(r, 'add', '.');
      git(r, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    }
    forgetScans();
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projectsRoot: root }));
    const state = await collect({ dir, smDir, now: new Date(), isAlive: () => false });
    assert.deepEqual(state.projectsRoot, [root]);
    assert.deepEqual(state.projects.map((p) => p.name).sort(), ['api', 'shop']);
    assert.ok(state.projects.every((p) => p.scratch === null), 'both are inside the folder he picked');
    forgetScans();
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({}));
    assert.deepEqual((await collect({ dir, smDir, now: new Date(), isAlive: () => false })).projects, [], 'no pick, no conversation: nothing to list, as always');
  } finally { for (const d of [root, dir, smDir]) rmSync(d, { recursive: true, force: true }); }
});

// ---- the routes: the page's token, nothing for the look-only key or the demo ----------------------------------------

async function withServer(fn, { demo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-fsrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fsrv-sm-'));
  const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, ...(demo ? { demo: true, token: 'x' } : {}) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = demo ? 'x' : loadToken(smDir);
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
    await fn({ call, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [dir, smDir]) rmSync(d, { recursive: true, force: true });
  }
}

test('the folder routes need the token and answer folders, repositories and the saved choice', async () => {
  const root = tree();
  try {
    await withServer(async ({ call, smDir }) => {
      const q = (p) => `?path=${encodeURIComponent(p)}`;
      for (const [method, path] of [['GET', `/api/folders${q(root)}`], ['GET', `/api/folders/repos${q(root)}`], ['GET', '/api/settings/projects-root'], ['POST', '/api/settings/projects-root']]) {
        assert.equal((await call(method, path, method === 'POST' ? { body: { roots: [root] } } : {})).status, 401, `${method} ${path} without the token`);
      }
      const list = await call('GET', `/api/folders${q(root)}`, { auth: true });
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.entries.map((e) => e.name), ['empty', 'node_modules', 'shop', 'work', 'wt']);
      assert.equal((await call('GET', `/api/folders${q('relative')}`, { auth: true })).status, 400);
      assert.equal((await call('GET', `/api/folders${q(join(root, 'nope'))}`, { auth: true })).status, 404);
      assert.equal((await call('GET', '/api/folders', { auth: true })).json.path, '', 'no path: where to start');
      const repos = await call('GET', `/api/folders/repos${q(root)}`, { auth: true });
      assert.deepEqual([repos.status, names(repos.json.repos), repos.json.truncated], [200, ['shop', 'api'], false]);
      assert.equal((await call('GET', `/api/folders/repos${q('relative')}`, { auth: true })).status, 400);
      assert.deepEqual((await call('GET', '/api/settings/projects-root', { auth: true })).json, { ok: true, roots: [] });
      const saved = await call('POST', '/api/settings/projects-root', { auth: true, body: { roots: [root] } });
      assert.deepEqual([saved.status, saved.json.roots], [200, [root]]);
      assert.deepEqual((await call('GET', '/api/settings/projects-root', { auth: true })).json.roots, [root]);
      assert.deepEqual(JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')).projectsRoot, [root]);
      assert.equal((await call('POST', '/api/settings/projects-root', { auth: true, body: { roots: ['relative'] } })).status, 400);
      assert.equal((await call('POST', '/api/settings/projects-root', { auth: true, body: { roots: [join(root, 'nope')] } })).status, 404);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the demo browses nothing: it serves invented data and never touches the disk', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/folders', { auth: true })).status, 403);
    assert.equal((await call('POST', '/api/settings/projects-root', { auth: true, body: { roots: [] } })).status, 403);
  }, { demo: true });
});
