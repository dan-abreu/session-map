import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_HOOK, guardSettings, guardStep } from '../server/chat/guard.mjs';
import { SAFETY_REFS } from '../server/chat/safety.mjs';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';

// The guard of every page chat (pc16): a PreToolUse hook Claude Code runs before its own permission check, in every
// permission mode, so a step its auto mode allows alone still passes it. It only ever denies a force push or takes a
// snapshot first; it never allows anything.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const bash = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() });

// Runs the hook as Claude Code does: the step as JSON on stdin, the answer on stdout.
function runHook(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GUARD_HOOK, ...args], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('guardStep denies a force push however it is written, lets anything else go to the permission check, and never allows', async () => {
  for (const command of ['git push -f', 'bash -c "git push --force"', 'git --git-dir .git push -f', '$(git push -f)']) {
    const out = await guardStep(bash(command));
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', command);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /never lets a force push through/);
  }
  assert.equal(await guardStep(bash('git push origin main')), null);
  assert.equal(await guardStep({ tool_name: 'Write', tool_input: { file_path: 'x' } }), null);
  assert.equal(await guardStep(null), null);
});

test('guardStep snapshots before a destructive step only when asked to, and a slow snapshot does not hold the step past its wait', async () => {
  const taken = [];
  const snapshot = async (cwd) => { taken.push(cwd); return null; };
  assert.equal(await guardStep(bash('rm -rf build'), { snapshot }), null);
  assert.deepEqual(taken, [], 'no snapshot outside the Autonomous way');
  assert.equal(await guardStep({ ...bash('rm -rf build'), cwd: '/repo' }, { snapshotOn: true, snapshot }), null);
  assert.equal(await guardStep({ ...bash('ls'), cwd: '/repo' }, { snapshotOn: true, snapshot }), null);
  assert.deepEqual(taken, ['/repo']);
  const started = Date.now();
  assert.equal(await guardStep(bash('rm x'), { snapshotOn: true, snapshot: () => new Promise(() => {}), waitMs: 50 }), null);
  assert.ok(Date.now() - started < 2000);
});

test('guardSettings: a PreToolUse hook on the shell steps that runs this guard, with the snapshot only for the Autonomous way', () => {
  const plain = JSON.parse(guardSettings({ snapshot: false }));
  const [entry] = plain.hooks.PreToolUse;
  assert.match('Bash', new RegExp(`^(?:${entry.matcher})$`));
  assert.match('PowerShell', new RegExp(`^(?:${entry.matcher})$`));
  assert.equal(entry.hooks[0].type, 'command');
  assert.ok(entry.hooks[0].command.includes(GUARD_HOOK.replace(/\\/g, '/')), entry.hooks[0].command);
  assert.ok(!entry.hooks[0].command.includes('--snapshot'));
  assert.ok(entry.hooks[0].timeout > 0);
  assert.ok(JSON.parse(guardSettings({ snapshot: true })).hooks.PreToolUse[0].hooks[0].command.endsWith('--snapshot'));
  assert.ok(!/allow/.test(guardSettings({ snapshot: true })), 'it never allows anything');
});

test('the hook as a process: a force push handed to bash is denied on stdout; an ordinary step gets no answer', async () => {
  const denied = await runHook([], bash('bash -c "git push -f"'));
  assert.equal(denied.code, 0);
  assert.equal(JSON.parse(denied.out).hookSpecificOutput.permissionDecision, 'deny');
  const plain = await runHook([], bash('npm test'));
  assert.deepEqual([plain.code, plain.out], [0, '']);
  const junk = await runHook([], 'not json');
  assert.deepEqual([junk.code, junk.out], [0, '']);
});

test('the hook as a process with --snapshot keeps a file made and deleted in the same turn before the rm runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-guard-repo-'));
  try {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'made-this-turn.txt'), 'new work\n');
    const { code, out } = await runHook(['--snapshot'], { ...bash('rm made-this-turn.txt'), cwd: root });
    assert.deepEqual([code, out], [0, '']);
    const [ref] = git(root, 'for-each-ref', '--format=%(refname)', SAFETY_REFS).split('\n');
    assert.ok(ref, 'a snapshot ref');
    assert.equal(git(root, 'show', `${ref}:made-this-turn.txt`), 'new work');
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

test('every page chat starts with the guard in its settings; the Autonomous way with the snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-guard-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-guard-sm-'));
  const log = join(smDir, 'argv.json');
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: log }, snapshot: async () => null });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  const settingsOf = () => {
    const { argv } = JSON.parse(readFileSync(log, 'utf8'));
    return JSON.parse(argv[argv.indexOf('--settings') + 1]);
  };
  const started = async (run) => {
    const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'hi', ...(run ? { run } : {}) }, state);
    assert.equal(res.status, 200);
    for (let i = 0; i < 100; i++) { try { return settingsOf(); } catch { await new Promise((r) => setTimeout(r, 30)); } }
    return settingsOf();
  };
  try {
    const autonomous = await started();
    assert.ok(autonomous.hooks.PreToolUse[0].hooks[0].command.endsWith('--snapshot'));
    await hub.close();
    writeFileSync(log, '');
    const manual = await started({ kind: 'auto', selfReinforce: false });
    assert.ok(manual.hooks.PreToolUse[0].hooks[0].command.includes('guard-hook.mjs'));
    assert.ok(!manual.hooks.PreToolUse[0].hooks[0].command.includes('--snapshot'));
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
