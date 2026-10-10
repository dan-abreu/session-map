// Every file's parts for the files side of the map (mind-map-page mm40, mm42): the same reading as the counts of the boxes
// (mm25), so a file with no part here is exactly one of the root's "files with no box on the map".
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as attach from '../server/arch/attach.mjs';
import { fileOwners } from '../server/arch/fileowners.mjs';
import { sizesOf } from '../server/arch/sizes.mjs';
import { topLevelOf } from '../server/collect.mjs';
import { countRepo } from '../server/sources/count.mjs';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

// Parts tied at a path and a test's part come with flow fl08 and foundation fd16; before them a tie names the first part in
// map order and a test no part names has none. Either way the rows with no part are the root's files with no box.
const LATER = Boolean(attach.ownersAllOf);

const part = (id, codePaths) => ({ id, name: id, file: `docs/architecture/${id}.md`, about: '', codePaths, groups: [], workCellIds: [], chatIds: [] });
const ARCH = {
  layers: [{ id: 'all', name: 'All', partIds: ['web', 'api', 'twin'] }],
  parts: [part('web', ['apps/web/', './README.md']), part('api', ['apps/api/', 'shared/']), part('twin', ['shared/'])],
};

test('fileOwners: every part holding a file\'s deepest path, a test the part of what it tests, none for a file no part names', () => {
  const files = ['apps/web/page.js', 'shared/x.js', 'README.md', 'test/apps-web-page.test.js', 'misc/tool.js', 'docs/architecture/twin.md'];
  assert.deepEqual(fileOwners(files, ARCH, { topLevel: new Set(['apps', 'shared', 'readme.md', 'test', 'misc', 'docs']) }), [
    ['web'], LATER ? ['api', 'twin'] : ['api'], ['web'], LATER ? ['web'] : [], [], ['twin'],
  ]);
});

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

function makeRepo() {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'sm-fo-'))), 'repo');
  for (const dir of ['apps/web', 'apps/api', 'shared', 'test', 'misc']) mkdirSync(join(root, dir), { recursive: true });
  const files = {
    'apps/web/page.js': 'a\nb\n', 'apps/api/route.js': 'a\n', 'shared/x.js': 'x\n', 'README.md': '# r\n',
    'test/page.test.js': 't\n', 'test/nothing.test.js': 't\n', 'misc/tool.js': 'm\n', 'misc/more.js': 'm\n',
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  git(root, 'init', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'first');
  return root;
}

test('GET /api/files/:project?all=1 gives each row its parts, and the rows with none are exactly the root\'s files with no box', async () => {
  const root = makeRepo();
  const arch = { source: 'worktree', dir: 'docs/architecture', lang: 'en', ...ARCH };
  const state = { generatedAt: '', waitingCount: 0, projects: [{ id: 'fo-abc123', root, mainBranch: 'main', arch, workCells: [], chats: [] }] };
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fo-sm-'));
  const app = createApp({ dir: mkdtempSync(join(tmpdir(), 'sm-fo-dir-')), smDir, ai: { bin: null }, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = app.address();
    const body = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/files/fo-abc123?all=1', headers: { host: `127.0.0.1:${port}`, cookie: `sm_token=${loadToken(smDir)}` } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve(JSON.parse(text)));
      });
      req.on('error', reject);
      req.end();
    });
    const owners = Object.fromEntries(body.files.map((f) => [f.path, f.owners]));
    assert.deepEqual(owners['shared/x.js'], LATER ? ['api', 'twin'] : ['api']);
    assert.deepEqual(owners['README.md'], ['web'], 'a root file named "./README.md" belongs to its part');
    if (LATER) assert.deepEqual(owners['test/page.test.js'], ['web'], 'a test belongs to the part of the file it tests');
    const loose = body.files.filter((f) => !f.owners.length).map((f) => f.path).sort();
    assert.deepEqual(loose, ['misc/more.js', 'misc/tool.js', 'test/nothing.test.js', ...(LATER ? [] : ['test/page.test.js'])]);
    const sizes = sizesOf(await countRepo(root), arch, { topLevel: topLevelOf(root) });
    assert.equal(loose.length, sizes.unowned.files);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});
