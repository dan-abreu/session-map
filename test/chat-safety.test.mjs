import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAFETY_REFS, commandOf, isDestructive, isForcePush, snapshot } from '../server/chat/safety.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

async function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-safety-repo-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'core.autocrlf', 'false');
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    writeFileSync(join(root, 'kept.txt'), 'one\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'first');
    await fn(root);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
}

test('isForcePush: --force, -f in any short group, --force-with-lease and a +refspec; a plain push is not one', () => {
  for (const cmd of ['git push --force', 'git push -f origin main', 'git push -uf origin main', 'git push --force-with-lease',
    'git push --force-with-lease=main:abc origin', 'git push origin +main', 'cd x && git -C repo push --force', 'git.exe push -f',
    '"C:/Program Files/Git/bin/git.exe" push --force', 'echo ok; git push origin +HEAD:main']) assert.equal(isForcePush(cmd), true, cmd);
  for (const cmd of ['git push', 'git push origin main', 'git push --follow-tags', 'git push -u origin feature', 'git commit -m "push --force"',
    'git fetch --force', 'echo git', '', null, undefined]) assert.equal(isForcePush(cmd), false, String(cmd));
});

test('isDestructive: deleting files and throwing work away in git; reading and ordinary git are not', () => {
  for (const cmd of ['rm -rf build', 'rmdir old', 'del /q x.txt', 'Remove-Item -Recurse .\\dist', 'git clean -fdx', 'git reset --hard HEAD~1',
    'git checkout -- src/a.js', 'git restore src/a.js', 'git branch -D feature', 'git stash drop', 'git stash clear', 'find . -name "*.tmp" -exec rm {} \\;',
    'npm test && rm out.txt', '/bin/rm x']) assert.equal(isDestructive(cmd), true, cmd);
  for (const cmd of ['ls -la', 'git status', 'git checkout main', 'git branch -d merged', 'git reset HEAD a.js', 'git stash', 'git stash pop',
    'npm run format', 'echo removed', '', null]) assert.equal(isDestructive(cmd), false, String(cmd));
});

test('commandOf reads the command of a shell step and nothing else', () => {
  assert.equal(commandOf('Bash', { command: 'rm x' }), 'rm x');
  assert.equal(commandOf('PowerShell', { command: 'Remove-Item x' }), 'Remove-Item x');
  assert.equal(commandOf('Write', { command: 'rm x' }), '');
  assert.equal(commandOf('Bash', { command: 42 }), '');
});

test('snapshot keeps the whole working tree (tracked, changed and untracked, not ignored) under a ref, without touching index, branch or files', async () => {
  await withRepo(async (root) => {
    writeFileSync(join(root, 'kept.txt'), 'two\n');
    writeFileSync(join(root, 'staged.txt'), 'staged\n');
    git(root, 'add', 'staged.txt');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    mkdirSync(join(root, 'build'));
    writeFileSync(join(root, 'build', 'out.bin'), 'ignored\n');
    const before = { status: git(root, 'status', '--porcelain'), head: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'branch', '--show-current'), index: readFileSync(join(root, '.git', 'index')) };

    const snap = await snapshot(join(root), { now: new Date('2026-10-10T12:00:00.000Z') });
    assert.ok(snap, 'a snapshot inside a git repository');
    assert.match(snap.ref, new RegExp(`^${SAFETY_REFS}/`));
    assert.equal(git(root, 'rev-parse', snap.ref), snap.commit);
    assert.equal(git(root, 'show', `${snap.ref}:kept.txt`), 'two');
    assert.equal(git(root, 'show', `${snap.ref}:staged.txt`), 'staged');
    assert.equal(git(root, 'show', `${snap.ref}:new.txt`), 'untracked');
    assert.throws(() => execFileSync('git', ['cat-file', '-e', `${snap.ref}:build/out.bin`], { cwd: root, stdio: 'ignore' }), 'ignored files stay out');
    assert.equal(git(root, 'rev-parse', `${snap.ref}^`), before.head, 'its parent is HEAD, so it reads as a diff');

    assert.equal(git(root, 'status', '--porcelain'), before.status);
    assert.equal(git(root, 'rev-parse', 'HEAD'), before.head);
    assert.equal(git(root, 'branch', '--show-current'), before.branch);
    assert.deepEqual(readFileSync(join(root, '.git', 'index')), before.index, 'the person\'s index is untouched');
    assert.equal(readFileSync(join(root, 'kept.txt'), 'utf8'), 'two\n');
  });
});

test('snapshot from a subfolder, in a repository with no commit yet, and only the newest refs are kept', async () => {
  await withRepo(async (root) => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'a.txt'), 'a\n');
    for (let i = 0; i < 4; i++) await snapshot(join(root, 'sub'), { now: new Date(Date.UTC(2026, 9, 10, 12, 0, i)), keep: 3 });
    const refs = git(root, 'for-each-ref', '--format=%(refname)', SAFETY_REFS).split('\n');
    assert.equal(refs.length, 3);
    assert.ok(!refs.some((r) => r.includes('120000')), `the oldest went: ${refs}`);
  });
  const fresh = mkdtempSync(join(tmpdir(), 'sm-safety-fresh-'));
  try {
    git(fresh, 'init', '-q');
    writeFileSync(join(fresh, 'only.txt'), 'x\n');
    const snap = await snapshot(fresh);
    assert.ok(snap);
    assert.equal(git(fresh, 'show', `${snap.ref}:only.txt`), 'x');
  } finally { await rm(fresh, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

test('snapshot outside a git repository takes nothing and does not throw', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'sm-safety-plain-'));
  try {
    assert.equal(await snapshot(plain), null);
    assert.equal(await snapshot(join(plain, 'missing')), null);
  } finally { await rm(plain, { recursive: true, force: true }); }
});

test('isForcePush sees through git global options, a shell given the line as a string, a subshell and git\'s abbreviations', () => {
  for (const cmd of ['git --git-dir .git push -f', 'git --work-tree . --git-dir .git push --force', 'git --namespace x push -f', 'git --exec-path /x push -f',
    'bash -c "git push -f"', 'sh -c \'git push --force\'', 'powershell -Command "git push -f"', 'pwsh -NoProfile -c "git push -f"', 'cmd /c "git push -f"',
    '(git push -f)', '$(git push -f)', '`git push -f`', 'git push --force-w', 'git push --force-with', 'git push --mirror', 'git push --mi origin',
    'bash -c "cd x && git push -f"', 'eval "git push -f"', 'eval git push --force']) assert.equal(isForcePush(cmd), true, cmd);
  for (const cmd of ['git --git-dir .git push origin main', 'bash -c "git push origin main"', 'powershell -Command "git status"', 'echo "git push -f"',
    'git push --follow-tags', '(git push)']) assert.equal(isForcePush(cmd), false, cmd);
});

test('isDestructive: a checkout or switch that throws changes away, find -delete, mv, a > truncation and a shell given rm as a string', () => {
  for (const cmd of ['git checkout .', 'git checkout -f', 'git checkout -f main', 'git switch -f main', 'git switch --discard-changes main', 'find . -name x -delete',
    'mv a b', 'Move-Item a b', 'echo hi > notes.md', 'cat x >out.txt', 'bash -c "rm -rf x"', 'powershell -Command "Remove-Item x"', '$(rm x)'])
    assert.equal(isDestructive(cmd), true, cmd);
  for (const cmd of ['git checkout main', 'git switch main', 'find . -name x', 'echo hi >> log.txt', 'npm test 2>&1', 'npm test 2>/dev/null', 'npm test > /dev/null',
    'dir > $null', 'echo "a > b"', 'bash -c "ls"']) assert.equal(isDestructive(cmd), false, cmd);
});

test('snapshot keeps the current contents of files marked skip-worktree or assume-unchanged, and a sparse file missing from disk stays as HEAD has it', async () => {
  await withRepo(async (root) => {
    for (const name of ['a.txt', 'b.txt', 'gone.txt']) writeFileSync(join(root, name), 'one\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'three');
    git(root, 'update-index', '--skip-worktree', 'a.txt');
    git(root, 'update-index', '--assume-unchanged', 'b.txt');
    git(root, 'update-index', '--skip-worktree', 'gone.txt');
    writeFileSync(join(root, 'a.txt'), 'CHANGED\n');
    writeFileSync(join(root, 'b.txt'), 'CHANGED\n');
    await rm(join(root, 'gone.txt'));
    const index = readFileSync(join(root, '.git', 'index'));

    const snap = await snapshot(root);
    assert.equal(git(root, 'show', `${snap.ref}:a.txt`), 'CHANGED');
    assert.equal(git(root, 'show', `${snap.ref}:b.txt`), 'CHANGED');
    assert.equal(git(root, 'show', `${snap.ref}:gone.txt`), 'one', 'not on disk because of the sparse checkout, not deleted');
    assert.deepEqual(readFileSync(join(root, '.git', 'index')), index, 'the person\'s flags stay as they were');
  });
});
