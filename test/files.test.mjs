import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listFiles, mergeBaseOf, readFileForView, safeResolve } from '../server/files.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function makeRepo() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-files-')));
  const root = join(base, 'repo');
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, 'src', 'a.js'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'README.md'), 'hello\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'first');
  git(root, 'checkout', '-b', 'feature/x');
  writeFileSync(join(root, 'src', 'a.js'), 'one\nTWO\nthree\nfour\n');
  writeFileSync(join(root, 'src', 'new.js'), 'a\nb\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');
  return { base, root };
}

test('safeResolve keeps reads inside the root and out of .git', () => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'sm-safe-')));
  try {
    assert.equal(safeResolve(root, 'src/a.js'), join(root, 'src', 'a.js'));
    assert.equal(safeResolve(root, 'src\\a.js'), join(root, 'src', 'a.js'), 'Windows separators are the same file');
    for (const bad of [
      '../x', '..\\x', 'src/../../x', 'a/../../x', '/etc/passwd', '\\windows\\win.ini', 'C:/x', 'c:\\x', '//server/share/x',
      '%2e%2e/x', '%2E%2E%2fx', 'src/%2e%2e%5c..%5cx', '.git/config', 'src/.git/config', '.GIT/config', '.git./config', '.git /config', 'GIT~1/config',
      'a\0b', '', '.', 'file.txt:stream', 42, null,
    ]) assert.equal(safeResolve(root, bad), null, String(bad));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('safeResolve refuses a link that leads out of the root', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-link-')));
  const root = join(base, 'root');
  mkdirSync(join(root, 'in'), { recursive: true });
  mkdirSync(join(base, 'outside'));
  writeFileSync(join(base, 'outside', 'secret.txt'), 'x');
  writeFileSync(join(root, 'in', 'ok.txt'), 'x');
  try {
    symlinkSync(join(base, 'outside'), join(root, 'escape'), 'junction');
    assert.equal(safeResolve(root, 'escape/secret.txt'), null);
    try {
      symlinkSync(join(base, 'outside', 'secret.txt'), join(root, 'peek.txt'), 'file');
      assert.equal(safeResolve(root, 'peek.txt'), null);
    } catch (err) {
      // File links need a privilege on Windows; the folder junction above already covers the escape.
      if (err.code !== 'EPERM') throw err;
    }
    assert.equal(safeResolve(root, 'in/ok.txt'), join(root, 'in', 'ok.txt'));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('readFileForView marks the lines the branch changed', async () => {
  const { base, root } = makeRepo();
  try {
    const diffBase = await mergeBaseOf(root, 'main', 'feature/x');
    assert.match(diffBase, /^[0-9a-f]{40}$/);
    const edited = await readFileForView(root, 'src/a.js', { diffBase });
    assert.deepEqual(edited, { ok: true, text: 'one\nTWO\nthree\nfour\n', lines: 4, changes: [{ from: 2, to: 2 }, { from: 4, to: 4 }] });
    const added = await readFileForView(root, 'src/new.js', { diffBase });
    assert.deepEqual(added.changes, [{ from: 1, to: 2 }]);
    const untouched = await readFileForView(root, 'README.md', { diffBase });
    assert.deepEqual(untouched.changes, []);
    assert.deepEqual((await readFileForView(root, 'README.md')).changes, [], 'no base, no marks');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('readFileForView reads a branch that has no folder through its ref', async () => {
  const { base, root } = makeRepo();
  try {
    git(root, 'checkout', 'main');
    const diffBase = await mergeBaseOf(root, 'main', 'feature/x');
    const out = await readFileForView(root, 'src/a.js', { diffBase, ref: 'refs/heads/feature/x' });
    assert.equal(out.text, 'one\nTWO\nthree\nfour\n');
    assert.deepEqual(out.changes, [{ from: 2, to: 2 }, { from: 4, to: 4 }]);
    assert.equal((await readFileForView(root, 'src/gone.js', { ref: 'refs/heads/feature/x' })).error, 'not-found');
    assert.equal((await readFileForView(root, '.git/config', { ref: 'refs/heads/feature/x' })).error, 'bad-path');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('readFileForView refuses what it must not show', async () => {
  const { base, root } = makeRepo();
  try {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(1024 * 1024 + 1));
    writeFileSync(join(root, '.env'), 'KEY=1');
    writeFileSync(join(root, '.env.example'), 'KEY=');
    assert.equal((await readFileForView(root, 'bin.dat')).error, 'binary');
    assert.equal((await readFileForView(root, 'big.txt')).error, 'too-large');
    assert.equal((await readFileForView(root, 'nope.txt')).error, 'not-found');
    assert.equal((await readFileForView(root, 'src')).error, 'not-found', 'a folder is not a file');
    assert.equal((await readFileForView(root, '../x')).error, 'bad-path');
    assert.equal((await readFileForView(root, '.env')).error, 'sensitive');
    assert.equal((await readFileForView(root, 'sub/.env.local')).error, 'sensitive');
    assert.equal((await readFileForView(root, '.env.example')).ok, true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('listFiles expands folder hints into tracked files and ignores unsafe hints', async () => {
  const { base, root } = makeRepo();
  try {
    assert.deepEqual(await listFiles(root, ['src/']), ['src/a.js', 'src/new.js']);
    assert.deepEqual(await listFiles(root, ['src/a.js', 'README.md']), ['README.md', 'src/a.js']);
    assert.deepEqual(await listFiles(root, ['../x', ':(top)', '.git/', '*.js']), [], 'no escapes, no pathspec magic, no globs');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
