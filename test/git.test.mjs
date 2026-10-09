import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityOf, aheadOf, gitRoot, lastCommit, listWorktrees, mainBranch } from '../server/sources/git.mjs';
import { normalizePath } from '../server/paths.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function makeRepo() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-git-')));
  const root = join(base, 'repo');
  const remote = join(base, 'remote.git');
  mkdirSync(root);
  git(base, 'init', '--bare', '-b', 'main', remote);
  git(root, 'init', '-b', 'main');
  git(root, 'remote', 'add', 'origin', remote);
  writeFileSync(join(root, 'a.txt'), '1');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-m', 'first');
  writeFileSync(join(root, 'b.txt'), '2');
  git(root, 'add', 'b.txt');
  git(root, 'commit', '-m', 'second', '-m', 'Co-Authored-By: Claude Sonnet <noreply@anthropic.com>');
  git(root, 'push', 'origin', 'main');
  git(root, 'tag', '-a', 'v1', '-m', 'release one');
  git(root, 'branch', 'feature/x');
  git(root, 'worktree', 'add', join(base, 'wt'), 'feature/x');
  writeFileSync(join(base, 'wt', 'c.txt'), '3');
  git(join(base, 'wt'), 'add', 'c.txt');
  git(join(base, 'wt'), 'commit', '-m', 'feature work');
  return { base, root, wt: join(base, 'wt') };
}

test('git helpers read a real repository', async () => {
  const { base, root, wt } = makeRepo();
  try {
    assert.equal(normalizePath(await gitRoot(root)), normalizePath(root));
    assert.equal(await gitRoot(base), null);
    assert.equal(await mainBranch(root), 'main');
    assert.equal(await aheadOf(root, 'feature/x', 'main'), 1);
    assert.equal(await aheadOf(root, 'nope', 'main'), 0);
    const trees = await listWorktrees(root);
    assert.equal(trees.length, 2);
    const feature = trees.find((t) => t.branch === 'feature/x');
    assert.equal(normalizePath(feature.path), normalizePath(wt));
    assert.match(feature.head, /^[0-9a-f]{40}$/);
    const last = await lastCommit(wt);
    assert.equal(last.subject, 'feature work');
    assert.equal(await lastCommit(base), null);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('mainBranch falls back to master', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-git-')));
  try {
    git(base, 'init', '-b', 'master');
    writeFileSync(join(base, 'a'), '1');
    git(base, 'add', 'a');
    git(base, 'commit', '-m', 'x');
    assert.equal(await mainBranch(base), 'master');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('activityOf reports commits, co-author, files, tags and pushes', async () => {
  const { base, root } = makeRepo();
  try {
    const items = await activityOf(root, {});
    const second = items.find((i) => i.kind === 'commit' && i.subject === 'second');
    assert.equal(second.author.email, 'ana@example.com');
    assert.equal(second.coAuthor, 'Claude Sonnet');
    assert.deepEqual(second.files, ['b.txt']);
    assert.equal(second.branch, 'main');
    assert.ok(items.some((i) => i.subject === 'feature work' && i.branch === 'feature/x'));
    const tag = items.find((i) => i.kind === 'tag');
    assert.equal(tag.subject, 'v1');
    assert.equal(tag.hash, second.hash);
    const push = items.find((i) => i.kind === 'push');
    assert.equal(push.branch, 'main');
    assert.ok(!Number.isNaN(Date.parse(push.ts)));
    assert.deepEqual(await activityOf(root, { since: '2999-01-01' }), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('activityOf marks commits with two parents as merges', async () => {
  const { base, root } = makeRepo();
  try {
    git(root, 'merge', '--no-ff', 'feature/x', '-m', 'merge feature');
    const items = await activityOf(root, {});
    const merge = items.find((i) => i.subject === 'merge feature');
    assert.equal(merge.kind, 'merge');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('git functions return empty values outside a repository', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sm-nogit-')));
  try {
    assert.deepEqual(await activityOf(dir, {}), []);
    assert.deepEqual(await listWorktrees(dir), []);
    assert.equal(await mainBranch(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
