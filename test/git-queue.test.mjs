import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitQueue } from '../server/sources/gitqueue.mjs';

// A fake execFile: each call waits until the test lets it finish, so the test sees how many run at once.
function fakeExec(answer = () => ({ err: null, stdout: 'ok' })) {
  const calls = [];
  let now = 0;
  let peak = 0;
  const exec = (file, args, opts, cb) => {
    now++;
    peak = Math.max(peak, now);
    const call = { file, args, opts, finish: () => { now--; const a = answer(opts.cwd, args); cb(a.err, a.stdout ?? '', a.stderr ?? ''); } };
    calls.push(call);
  };
  return { exec, calls, peak: () => peak, running: () => now };
}

const tick = () => new Promise((r) => setImmediate(r));

test('no more than the limit of git processes run at once; the rest wait their turn and all answer', async () => {
  const fake = fakeExec();
  const q = createGitQueue({ limit: 2, exec: fake.exec });
  const answers = Array.from({ length: 5 }, (_, i) => q.run(`/r${i}`, ['status']));
  await tick();
  assert.equal(fake.calls.length, 2, 'only two started');
  while (fake.calls.some((c) => !c.done)) {
    const c = fake.calls.find((x) => !x.done);
    c.done = true;
    c.finish();
    await tick();
  }
  assert.equal(fake.calls.length, 5);
  assert.equal(fake.peak(), 2);
  assert.deepEqual((await Promise.all(answers)).map((a) => a.stdout), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('a folder git calls not a repository is not asked again until the wait is over or it gets a .git', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-gq-'));
  let nowMs = 1000;
  const notRepo = Object.assign(new Error('fail'), { code: 128 });
  const fake = fakeExec(() => ({ err: notRepo, stderr: 'fatal: not a git repository (or any of the parent directories): .git' }));
  const q = createGitQueue({ limit: 2, exec: fake.exec, notRepoTtlMs: 60_000, now: () => nowMs });
  const ask = async () => { const p = q.run(dir, ['rev-parse', '--show-toplevel']); await tick(); fake.calls.filter((c) => !c.done).forEach((c) => { c.done = true; c.finish(); }); return p; };
  try {
    assert.ok((await ask()).err);
    const second = await ask();
    assert.ok(second.err, 'still an error to the caller');
    assert.equal(second.stdout, '');
    assert.equal(fake.calls.length, 1, 'the second ask spawned nothing');
    nowMs += 60_001;
    await ask();
    assert.equal(fake.calls.length, 2, 'asked again after the wait');
    await ask();
    assert.equal(fake.calls.length, 2);
    mkdirSync(join(dir, '.git'));
    await ask();
    assert.equal(fake.calls.length, 3, 'a folder that became a repository is asked at once');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failure that is not "not a repository" is never remembered', async () => {
  const fake = fakeExec(() => ({ err: Object.assign(new Error('x'), { code: 1 }), stderr: '' }));
  const q = createGitQueue({ limit: 2, exec: fake.exec });
  for (let i = 0; i < 2; i++) {
    const p = q.run('/repo', ['rev-parse', '--verify', '--quiet', 'refs/heads/main']);
    await tick();
    fake.calls.at(-1).finish();
    await p;
  }
  assert.equal(fake.calls.length, 2);
});

test('a git call that ran out of time is logged with its whole command, not just the first word', async () => {
  const killed = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
  const fake = fakeExec(() => ({ err: killed }));
  const q = createGitQueue({ limit: 1, exec: fake.exec });
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try {
    const p = q.run('/repo', ['-c', 'core.quotepath=off', 'status', '--porcelain=v1']);
    await tick();
    fake.calls[0].finish();
    await p;
  } finally { process.stderr.write = write; }
  const entry = JSON.parse(lines.find((l) => l.includes('git-too-slow')));
  assert.equal(entry.command, '-c core.quotepath=off status --porcelain=v1');
  assert.equal(entry.code, 'SIGTERM');
});
