import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK_HOOK, GUARD_HOOK, NO_FAILED, NO_KIND, NO_MAP_EDIT, NO_SKILL, guardAgent, guardSettings, guardStep, readBrief } from '../server/chat/guard.mjs';
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

test('guardAgent: an agent needs a kind tag and gets its model and effort from the policy; a skill needs a brief that names it', async () => {
  const agent = (ti, tool_name = 'Agent') => ({ tool_name, tool_input: ti });
  const why = (out) => out?.hookSpecificOutput.permissionDecisionReason;
  const set = (out) => out.hookSpecificOutput.updatedInput;
  assert.equal(why(guardAgent(agent({ description: 'fix the header' }))), NO_KIND);
  assert.equal(why(guardAgent(agent({ model: 'opus', description: 'Revisão de segurança do login' }))), NO_KIND, 'a model chosen by the AI is no kind');
  assert.equal(why(guardAgent(agent({ description: '[dance] fix' }))), NO_KIND, 'an unknown kind');
  assert.equal(why(await guardStep(agent({}))), NO_KIND);
  const ok = guardAgent(agent({ description: '[code] fix the header', prompt: 'p', model: 'opus', effort: 'max', run_in_background: true }));
  assert.equal(ok.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(set(ok), { description: '[code] fix the header', prompt: 'p', model: 'sonnet', effort: 'medium', run_in_background: true }, 'the AIs own model is overwritten, the other fields stay');
  assert.deepEqual(set(guardAgent(agent({ description: '[search] where is x', prompt: 'p' }, 'Task'))), { description: '[search] where is x', prompt: 'p', model: 'haiku', effort: 'low' });
  assert.deepEqual(set(guardAgent(agent({ description: '[security] review login' }))).model, 'opus');
  // One rung up needs the word "failed" in the prompt.
  assert.equal(why(guardAgent(agent({ description: '[code^1] again', prompt: 'redo it' }))), NO_FAILED);
  const up = guardAgent(agent({ description: '[code^1] again', prompt: 'The first try failed: tests red.' }));
  assert.deepEqual([set(up).model, set(up).effort], ['sonnet', 'high']);
  const up2 = guardAgent(agent({ description: '[code^2] again', prompt: 'Two tries failed.' }));
  assert.deepEqual([set(up2).model, set(up2).effort], ['opus', 'high']);
  assert.equal(why(guardAgent(agent({ description: '[code^3] x', prompt: 'failed' }))), NO_KIND, 'only ^1 and ^2');

  const skill = { tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } };
  assert.equal(guardAgent(skill), null, 'the chat itself may open skills');
  assert.equal(await guardStep(skill), null, 'also through the hook entry, with no brief read');
  const sub = { ...skill, agent_id: 'a1' };
  assert.equal(guardAgent(sub, { brief: () => 'Use the skill superpowers:brainstorming' }), null);
  assert.equal(why(guardAgent(sub, { brief: () => 'Just fix the typo' })), NO_SKILL);
  assert.equal(guardAgent(sub, { brief: () => null }), null);
  const commit = { ...sub, tool_input: { skill: 'commit' } };
  assert.equal(why(guardAgent(commit, { brief: () => 'Review the commitment to compatibility' })), NO_SKILL, 'a word that only contains the name is not naming it');
  assert.equal(guardAgent(commit, { brief: () => 'Run the commit skill, then stop.' }), null);
  assert.equal(guardAgent(sub, { brief: () => 'use brainstorming first' }), null, 'the name after the colon is enough');
});

test('readBrief returns the first user line of the agent transcript', () => {
  const read = () => `${JSON.stringify({ type: 'system' })}\n${JSON.stringify({ type: 'user', message: { content: 'Use the skill x' } })}\n`;
  const input = { transcript_path: '/a/b.jsonl', session_id: 's', agent_id: 'a1' };
  assert.equal(readBrief(input, { read }), 'Use the skill x');
  assert.equal(readBrief(input, { read: () => { throw new Error('no'); } }), null);
});

// am04: a page chat does not edit the map's files itself; the clerk (the map_* tools) writes them in a fixed order.
function mapProject() {
  const root = mkdtempSync(join(tmpdir(), 'sm-guard-map-'));
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  writeFileSync(join(root, 'docs', 'architecture', 'orders.md'), '# Orders\n');
  return root;
}

test('guardStep denies an Edit, Write or MultiEdit of a file in the map folder and points to the map_* tools', async () => {
  const root = mapProject();
  try {
    for (const tool_name of ['Edit', 'Write', 'MultiEdit']) {
      for (const file_path of [join(root, 'docs', 'architecture', 'orders.md'), 'docs/architecture/orders.md', join(root, 'docs', 'architecture', 'new-part.md'), join(root, 'docs', 'architecture', 'README.md').replaceAll('\\', '/')]) {
        const out = await guardStep({ tool_name, tool_input: { file_path }, cwd: root }, { env: {} });
        assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', `${tool_name} ${file_path}`);
        assert.equal(out.hookSpecificOutput.permissionDecisionReason, NO_MAP_EDIT);
      }
    }
    assert.match(NO_MAP_EDIT, /^session-map: the map is written by its clerk; use the map_\* tools \(map_add_item, map_start_item, map_finish_item\.\.\.\)$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('guardStep lets the other files through, and the map folder when the way out is on', async () => {
  const root = mapProject();
  try {
    for (const file_path of [join(root, 'src', 'a.mjs'), 'docs/notes.md', join(root, 'docs', 'architecture', 'diagram.png'), join(root, 'docs', 'architecture', 'sub', 'deep.md'), join(root, 'docs', 'architecturex', 'a.md'), join(root, 'docs', 'arch', 'orders.md')]) {
      assert.equal(await guardStep({ tool_name: 'Edit', tool_input: { file_path }, cwd: root }, { env: {} }), null, file_path);
    }
    const map = { tool_name: 'Write', tool_input: { file_path: join(root, 'docs', 'architecture', 'orders.md') }, cwd: root };
    assert.equal(await guardStep(map, { env: { SESSION_MAP_CLERK: 'off' } }), null, 'the way out');
    assert.notEqual(await guardStep(map, { env: { SESSION_MAP_CLERK: 'on' } }), null);
    // or34: outside a page chat (the plugin or user-settings copy) the clerk tools may not exist yet, so the map stays writable.
    assert.equal(await guardStep(map, { mapEdit: false, env: { SESSION_MAP_CLERK: 'on' } }), null, 'not where the clerk is missing');
    assert.equal(await guardStep({ tool_name: 'Edit', tool_input: {}, cwd: root }, { env: {} }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the hook as a process denies a map edit on stdout and says nothing for another file', async () => {
  const root = mapProject();
  try {
    const denied = await runHook([], { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/orders.md' }, cwd: root });
    assert.equal(JSON.parse(denied.out).hookSpecificOutput.permissionDecision, 'deny');
    const other = await runHook([], { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/a.mjs' }, cwd: root });
    assert.equal(other.out, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('guardSettings also holds agents and skills, wires the book hooks and sets no compact window (pc32)', () => {
  const s = JSON.parse(guardSettings({ snapshot: false }));
  const second = s.hooks.PreToolUse[1];
  for (const name of ['Agent', 'Task', 'Skill', 'Edit', 'Write', 'MultiEdit', 'Workflow']) assert.match(name, new RegExp(`^(?:${second.matcher})$`));
  assert.doesNotMatch('Read', new RegExp(`^(?:${second.matcher})$`));
  const bookCmd = BOOK_HOOK.replaceAll('\\', '/');
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes(bookCmd));
  assert.ok(s.hooks.Stop[0].hooks[0].command.endsWith('--stop'));
  assert.equal(s.hooks.SessionStart[0].matcher, 'compact');
  assert.ok(s.hooks.SessionStart[0].hooks[0].command.includes(bookCmd));
  assert.ok(s.hooks.SessionStart[0].hooks[0].command.endsWith('--compact'));
  assert.equal(s.autoCompactWindow, undefined);
});
