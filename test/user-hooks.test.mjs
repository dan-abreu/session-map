import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK_HOOK, GUARD_HOOK, NO_HIGH_LEVEL, guardStep, guardWorkflow } from '../server/chat/guard.mjs';
import { startDriver } from '../server/chat/driver.mjs';
import { addHooks, removeHooks, updateFile, wantedHooks } from '../scripts/install-user-hooks.mjs';

const wf = (script, extra = {}) => ({ tool_name: 'Workflow', tool_input: { script, ...extra } });
const denied = (a) => a?.hookSpecificOutput?.permissionDecision === 'deny';

test('--user skips at once with SESSION_MAP_PAGE_CHAT=1, and works without it', () => {
  const step = JSON.stringify({ tool_name: 'Agent', tool_input: { description: 'no tag here', prompt: 'x' } });
  // The strict guard (config.json "guard": {"strict": true}) denies the untagged agent; the open one (id154) lets it run.
  const strictDir = mkdtempSync(join(tmpdir(), 'sm-hooks-strict-'));
  writeFileSync(join(strictDir, 'config.json'), JSON.stringify({ guard: { strict: true } }));
  const openDir = mkdtempSync(join(tmpdir(), 'sm-hooks-open-'));
  const run = (hook, args, env, smDir = strictDir) => spawnSync(process.execPath, [hook, ...args], { input: step, env: { ...process.env, SESSION_MAP_PAGE_CHAT: '', SESSION_MAP_DIR: smDir, ...env }, encoding: 'utf8' });
  const skipped = run(GUARD_HOOK, ['--user'], { SESSION_MAP_PAGE_CHAT: '1' });
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout, '');
  assert.match(run(GUARD_HOOK, ['--user'], {}).stdout, /"deny"/);
  assert.match(run(GUARD_HOOK, [], { SESSION_MAP_PAGE_CHAT: '1' }).stdout, /"deny"/, 'without --user the env changes nothing');
  assert.equal(run(GUARD_HOOK, ['--user'], {}, openDir).stdout, '', 'open: the untagged agent runs as asked');
  const book = run(BOOK_HOOK, ['--compact', '--user'], { SESSION_MAP_PAGE_CHAT: '1' });
  assert.equal(book.status, 0);
  assert.equal(book.stdout, '');
});

test('a page chat process gets SESSION_MAP_PAGE_CHAT=1', () => {
  let seen;
  const child = { on() {}, stdin: { on() {} }, stderr: { resume() {} }, stdout: { on() {}, once() {}, resume() {}, [Symbol.asyncIterator]: async function* () {} } };
  try { startDriver({ bin: 'claude', args: [], cwd: '.', env: { A: '1' }, onEvent() {}, spawner: (_b, _a, o) => { seen = o.env; return child; } }); } catch { /* the fake child is thin */ }
  assert.deepEqual(seen, { A: '1', SESSION_MAP_PAGE_CHAT: '1' });
});

test('Workflow check: more than the limit of literal agent() calls is denied, the limit itself passes', async () => {
  const calls = (n) => `// plan: docs/superpowers/plans/2026-10-14-user-hooks-fixture.md\n${Array.from({ length: n }, (_, i) => `await agent({ label: 'a${i}', prompt: 'x' });`).join('\n')}`;
  assert.ok(denied(await guardStep(wf(calls(11)))));
  assert.match((await guardStep(wf(calls(11)))).hookSpecificOutput.permissionDecisionReason, /11 agents/);
  assert.equal(await guardStep(wf(calls(10))), null);
});

test('Workflow check: opus, fable, xhigh and max need a sensitive tag or a failure', () => {
  assert.equal(guardWorkflow(wf(`await agent({ label: 'x', model: 'opus', prompt: 'do it' })`)).hookSpecificOutput.permissionDecisionReason, NO_HIGH_LEVEL);
  assert.equal(guardWorkflow(wf(`await agent({ label: '[security] audit', model: 'opus', prompt: 'do it' })`)), null);
  assert.equal(guardWorkflow(wf(`await agent({ label: 'x', model: 'opus', prompt: 'the sonnet run failed twice' })`)), null);
  assert.equal(guardWorkflow(wf(`await agent({ label: 'x', model: 'opus', prompt: 'a falhou' })`)), null);
  assert.ok(denied(guardWorkflow(wf(`agent({ label: 'x', model: 'fable', prompt: 'p' })`))));
  assert.ok(denied(guardWorkflow(wf(`agent({ label: 'x', effort: 'max', prompt: 'p' })`))));
  assert.ok(denied(guardWorkflow(wf(`agent({ label: 'x', effort: "xhigh", prompt: 'p' })`))));
  // The tag of another call does not cover this one.
  assert.ok(denied(guardWorkflow(wf(`agent({ label: '[money] pay', prompt: 'p' })\nagent({ label: 'y', model: 'opus', prompt: 'p' })`))));
});

test('Workflow check: a normal workflow is allowed, loops are not guessed at, scriptPath is read', () => {
  assert.equal(guardWorkflow(wf(`await agent({ label: 'a', model: 'sonnet', effort: 'medium', prompt: 'p (with parens)' })`)), null);
  assert.equal(guardWorkflow(wf(`for (const f of files) await agent({ label: f, prompt: 'p' })`)), null);
  assert.equal(guardWorkflow({ tool_name: 'Workflow', tool_input: {} }), null);
  // A ${ } in a template is code: its quoted paren must not end the call early (review finding).
  const tpl = "agent({ prompt: `r: ${calc(')')}`, model: 'opus' })\nagent({ label: '[money] x', model: 'opus', prompt: 'p' })";
  assert.ok(denied(guardWorkflow(wf(tpl))));
  const read = () => `agent({ model: 'opus', prompt: 'p' })`;
  assert.ok(denied(guardWorkflow({ tool_name: 'Workflow', tool_input: { scriptPath: 'w.js' }, cwd: '.' }, { read })));
  assert.equal(guardWorkflow({ tool_name: 'Workflow', tool_input: { scriptPath: 'w.js' } }, { read: () => { throw new Error('no file'); } }), null);
});

test('hooks.json: guard, stop and compact with --user, the old SessionEnd kept, no shell matcher', () => {
  const h = JSON.parse(readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8')).hooks;
  const pre = h.PreToolUse[0];
  for (const t of ['Agent', 'Task', 'Skill', 'Edit', 'Write', 'MultiEdit', 'Workflow', 'Read']) assert.match(t, new RegExp(`^(?:${pre.matcher})$`), 'the guard sees the reads too (id150, or57)');
  for (const t of ['Bash', 'PowerShell']) assert.doesNotMatch(t, new RegExp(`^(?:${pre.matcher})$`));
  assert.equal(pre.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/server/chat/guard-hook.mjs" --user');
  assert.equal(h.Stop[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/server/chat/book-hook.mjs" --stop --user');
  assert.equal(h.SessionStart[0].matcher, 'compact');
  assert.equal(h.SessionStart[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/server/chat/book-hook.mjs" --compact --user');
  assert.match(h.SessionEnd[0].hooks[0].command, /archive-hook\.mjs/);
});

test('installer: adds, is idempotent, keeps other keys and indentation, and --remove takes only its own out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-hooks-'));
  try {
    const file = join(dir, 'settings.json');
    const mine = { type: 'command', command: 'echo mine' };
    const original = `${JSON.stringify({ model: 'sonnet', hooks: { Stop: [{ hooks: [mine] }], SessionEnd: [{ hooks: [mine] }] } }, null, '\t')}\n`;
    writeFileSync(file, original);
    assert.equal(updateFile(file), true);
    const after = readFileSync(file, 'utf8');
    assert.ok(after.startsWith('{\n\t"model"'), 'tab indentation kept');
    const s = JSON.parse(after);
    assert.equal(s.model, 'sonnet');
    assert.equal(s.hooks.Stop.length, 2);
    assert.deepEqual(s.hooks.Stop[0].hooks[0], mine);
    assert.match(s.hooks.PreToolUse[0].hooks[0].command, /guard-hook\.mjs" --user$/);
    assert.equal(s.hooks.SessionStart[0].matcher, 'compact');
    assert.equal(updateFile(file), false, 'a second run changes nothing');
    assert.equal(readFileSync(file, 'utf8'), after);
    assert.equal(updateFile(file, { remove: true }), true);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(updateFile(file, { remove: true }), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('installer: a missing file is created, a moved repo is repointed, remove empties our hooks key', () => {
  const a = addHooks({}, wantedHooks('C:/one'));
  const b = addHooks(a, wantedHooks('C:/two'));
  assert.equal(b.hooks.PreToolUse.length, 1);
  assert.match(b.hooks.PreToolUse[0].hooks[0].command, /C:\/two\/server\/chat\/guard-hook\.mjs/);
  assert.deepEqual(removeHooks(b), {});
});
