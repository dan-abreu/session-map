import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countRepo, kindOfFile, lineCount } from '../server/sources/count.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

test('kindOfFile leaves out what nobody on the project wrote: libraries, generated files and binaries', () => {
  for (const path of ['node_modules/x/index.js', 'server/web/vendor/d3.min.js', 'third_party/lib.c', 'app/.venv/lib/site.py']) assert.equal(kindOfFile(path), 'dep', path);
  for (const path of ['dist/app.js', 'web/build/main.js', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'src/app.min.js', 'src/app.js.map', '.next/server.js', 'coverage/lcov.info', 'src/__snapshots__/a.snap']) assert.equal(kindOfFile(path), 'generated', path);
  for (const path of ['docs/shot.PNG', 'assets/logo.svg', 'fonts/a.woff2', 'demo/clip.mp4', 'tools/x.exe', 'data.sqlite', 'brief.pdf']) assert.equal(kindOfFile(path), 'binary', path);
});

test('kindOfFile sorts the program\'s own files into screens, tests, docs and code', () => {
  for (const path of ['test/a.test.mjs', 'src/cart.spec.ts', 'pkg/x_test.go', 'tests/test_cart.py', 'src/__tests__/a.js']) assert.equal(kindOfFile(path), 'test', path);
  for (const path of ['README.md', 'docs/setup.txt', 'docs/architecture/x.md', 'CHANGELOG.md']) assert.equal(kindOfFile(path), 'doc', path);
  for (const path of ['server/web/app.js', 'src/components/Cart.tsx', 'web/style.css', 'index.html', 'src/App.vue']) assert.equal(kindOfFile(path), 'screen', path);
  for (const path of ['server/collect.mjs', 'package.json', 'scripts/build.sh', 'src/lib/money.ts']) assert.equal(kindOfFile(path), 'code', path);
});

test('lineCount counts a last line with no newline and an empty file as none', () => {
  assert.equal(lineCount(Buffer.from('')), 0);
  assert.equal(lineCount(Buffer.from('a')), 1);
  assert.equal(lineCount(Buffer.from('a\n')), 1);
  assert.equal(lineCount(Buffer.from('a\r\nb\r\n')), 2);
  assert.equal(lineCount(Buffer.from('a\n\nb')), 3);
});

test('countRepo counts the tracked files line by line and lists the ones it left out, by reason', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-count-')));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'src', 'a.js'), 'one\ntwo\nthree\n');
    writeFileSync(join(root, 'README.md'), 'hello\n');
    writeFileSync(join(root, 'package-lock.json'), '{}\n');
    writeFileSync(join(root, 'node_modules', 'x', 'i.js'), 'x\n');
    writeFileSync(join(root, 'src', 'blob.dat'), Buffer.from([1, 0, 2, 10]));
    writeFileSync(join(root, 'untracked.js'), 'not counted\n');
    git(root, 'add', 'src', 'README.md', 'package-lock.json');
    git(root, 'add', '-f', 'node_modules');
    git(root, 'commit', '-q', '-m', 'first');
    const out = await countRepo(root, { ttlMs: 0 });
    assert.deepEqual(out.files, [
      { path: 'README.md', kind: 'doc', lines: 1 },
      { path: 'src/a.js', kind: 'code', lines: 3 },
    ]);
    assert.deepEqual(out.left, { dep: ['node_modules/x/i.js'], generated: ['package-lock.json'], binary: ['src/blob.dat'] });

    writeFileSync(join(root, 'src', 'a.js'), 'one\n');
    const again = await countRepo(root, { ttlMs: 0 });
    assert.equal(again.files.find((f) => f.path === 'src/a.js').lines, 1, 'an edited file is counted again');
    writeFileSync(join(root, 'src', 'a.js'), 'one\ntwo\n');
    const cached = await countRepo(root, { ttlMs: 60_000 });
    assert.equal(cached, again, 'within the wait the last count is answered as it was');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('countRepo answers an empty count outside a git repository', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-count-none-')));
  try {
    assert.deepEqual(await countRepo(root, { ttlMs: 0 }), { files: [], left: { dep: [], generated: [], binary: [] } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
