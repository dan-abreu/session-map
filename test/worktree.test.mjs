import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstTagWith, workingTree } from '../server/sources/git.mjs';
import { worktreeDiff } from '../server/files.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-wt-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'src', 'gone.js'), 'bye\nbye\n');
  writeFileSync(join(root, 'src', 'old.js'), 'moved\n');
  writeFileSync(join(root, '.env'), 'TOKEN=abc\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-f', '.');
  git(root, 'commit', '-q', '-m', 'first');
  return root;
}

test('the working tree lists what is not saved yet: edited, new, removed and renamed files with their lines', async () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'src', 'a.js'), 'one\nTWO\nthree\nfour\n');
    writeFileSync(join(root, 'src', 'new.js'), 'x\ny\n');
    unlinkSync(join(root, 'src', 'gone.js'));
    git(root, 'mv', 'src/old.js', 'src/moved.js');
    const tree = await workingTree(root);
    const byPath = Object.fromEntries(tree.map((e) => [e.path, e]));
    assert.deepEqual(byPath['src/a.js'], { path: 'src/a.js', kind: 'edit', added: 2, removed: 1 });
    assert.deepEqual(byPath['src/new.js'], { path: 'src/new.js', kind: 'create', added: 2, removed: 0 });
    assert.deepEqual(byPath['src/gone.js'], { path: 'src/gone.js', kind: 'delete', added: 0, removed: 2 });
    assert.equal(byPath['src/moved.js'].kind, 'rename');
    assert.equal(byPath['src/moved.js'].from, 'src/old.js');
    assert.equal(tree.length, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a clean folder or one that is not a project has nothing waiting', async () => {
  const root = repo();
  const bare = mkdtempSync(join(tmpdir(), 'sm-wt-none-'));
  try {
    assert.deepEqual(await workingTree(root), []);
    assert.deepEqual(await workingTree(bare), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test('the first version that carries a saved change is its release', async () => {
  const root = repo();
  try {
    const first = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'src', 'a.js'), 'later\n');
    git(root, 'commit', '-q', '-am', 'second');
    const second = git(root, 'rev-parse', 'HEAD').trim();
    assert.equal(await firstTagWith(root, second), null, 'nothing released yet');
    git(root, 'tag', '-a', 'v1.0.0', '-m', 'one', first);
    git(root, 'tag', '-a', 'v1.1.0', '-m', 'two', second);
    assert.equal(await firstTagWith(root, first), 'v1.0.0');
    assert.equal(await firstTagWith(root, second), 'v1.1.0');
    assert.equal(await firstTagWith(root, 'not-a-hash'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the before and after of a file not saved yet comes from the version history, never for a secrets file', async () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'src', 'a.js'), 'one\nTWO\nthree\n');
    writeFileSync(join(root, 'src', 'new.js'), 'x\n');
    unlinkSync(join(root, 'src', 'gone.js'));
    writeFileSync(join(root, '.env'), 'TOKEN=changed\n');
    const edited = await worktreeDiff(root, 'src/a.js');
    assert.ok(edited.ok);
    assert.deepEqual(edited.hunks[0].lines, [' one', '-two', '+TWO', ' three']);
    assert.deepEqual((await worktreeDiff(root, 'src/new.js')).hunks[0].lines, ['+x']);
    const gone = await worktreeDiff(root, 'src/gone.js');
    assert.deepEqual(gone.hunks[0].lines, ['-bye', '-bye'], 'a removed file keeps its previous content');
    assert.equal((await worktreeDiff(root, '.env')).error, 'sensitive');
    assert.equal((await worktreeDiff(root, '../outside.js')).error, 'bad-path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
