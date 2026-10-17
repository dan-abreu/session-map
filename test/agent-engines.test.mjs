import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dshOverlay, engineCommands, enginesStatus, findDsh } from '../server/ai/agent-engines.mjs';

// Which engines edit files today (id151, or62): each company's official agent, detected on the machine.

test('installed CLIs edit files; the rest answer through the API', () => {
  const none = enginesStatus({ bin: () => false });
  assert.equal(none.claude.edits, 'hooks');
  assert.equal(none.openai.edits, 'api');
  assert.equal(none.gemini.edits, 'api');
  assert.equal(none.deepseek.edits, 'api');
  const some = enginesStatus({ bin: (n) => n === 'codex' || n === 'claude' });
  assert.equal(some.openai.edits, 'worktree');
  assert.equal(some.deepseek.edits, 'claude-base');
  assert.equal(some.gemini.edits, 'api');
});

test('the engine commands name each official agent; the DeepSeek token never lives in the module', () => {
  const c = engineCommands({ deepseekToken: 'dk-secret', cli: (p) => `C:/npm/${p}.js` });
  // Codex and Gemini CLI are npm scripts: node runs them, never a shell with the brief in it (id171).
  assert.equal(c.openai.command({ brief: 'x' }).command, process.execPath);
  assert.equal(c.openai.command({ brief: 'x' }).args[0], 'C:/npm/openai.js');
  assert.equal(c.gemini.command({ brief: 'x' }).args[0], 'C:/npm/gemini.js');
  const ds = c.deepseek.command({ brief: 'x' });
  assert.equal(ds.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(ds.env.ANTHROPIC_AUTH_TOKEN, 'dk-secret');
  assert.equal(engineCommands().deepseek.command({ brief: 'x' }).env.ANTHROPIC_AUTH_TOKEN, '', 'no token by default');
});

test("the model and level of the Cérebro's row ride on every engine's command, as single checked arguments (id168, id171)", () => {
  const sm = mkdtempSync(join(tmpdir(), 'sm-eng-'));
  const c = engineCommands({ deepseekToken: 'dk', keys: { openai: 'sk-open-1234', gemini: 'gm-key-1234' }, smDir: sm, cli: (p) => `C:/npm/${p}.js` });
  const args = (p, choice) => c[p].command({ brief: 'do it', choice }).args.slice(1);
  // Codex (checked on 0.163.0): -m, the effort as config, and its own review of each command in the copy.
  const review = ['-c', 'approvals_reviewer="auto_review"', '-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"'];
  assert.deepEqual(args('openai', { model: 'gpt-5.5', effort: 'high' }), ['exec', '--skip-git-repo-check', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort="high"', ...review, 'do it']);
  assert.deepEqual(args('openai', { model: 'gpt-6-luna', effort: 'none' }), ['exec', '--skip-git-repo-check', '-m', 'gpt-6-luna', ...review, 'do it'], 'a level Codex has no word for is left out');
  assert.deepEqual(args('openai'), ['exec', '--skip-git-repo-check', ...review, 'do it'], 'nothing chosen: the CLI keeps its own');
  const env = c.openai.command({ brief: 'x' }).env;
  assert.equal(env.CODEX_API_KEY, 'sk-open-1234');
  assert.equal(env.CODEX_HOME, join(sm, 'codex-home'), "its own home in the map's folder, never the owner's ~/.codex");
  // Gemini CLI (checked on 0.64.0): the level rides an alias of its settings, written before the run.
  assert.deepEqual(args('gemini', { model: 'gemini-2.5-pro', effort: 'high' }), ['-p', 'do it', '--skip-trust', '-m', 'sm-gemini-2.5-pro-high', '--approval-mode', 'yolo']);
  const settings = JSON.parse(readFileSync(join(sm, 'gemini-home', '.gemini', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.modelConfigs.customAliases['sm-gemini-2.5-pro-high'].modelConfig, { model: 'gemini-2.5-pro', generateContentConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } } }, '2.5 thinks by a budget');
  assert.equal(c.gemini.command({ brief: 'x', choice: { model: 'gemini-3.8-flash', effort: 'low' } }).env.GEMINI_API_KEY, 'gm-key-1234');
  assert.equal(JSON.parse(readFileSync(join(sm, 'gemini-home', '.gemini', 'settings.json'), 'utf8')).modelConfigs.customAliases['sm-gemini-3.8-flash-low'].modelConfig.generateContentConfig.thinkingConfig.thinkingLevel, 'LOW');
  // Claude Code pointed at DeepSeek: --model.
  assert.deepEqual(c.deepseek.command({ brief: 'do it', choice: { model: 'deepseek-v4-pro' } }).args, ['-p', 'do it', '--model', 'deepseek-v4-pro', '--dangerously-skip-permissions']);
  // A value that is not a plain model name never becomes an argument.
  assert.deepEqual(args('openai', { model: '--yolo; rm -rf', effort: 'high; x' }), ['exec', '--skip-git-repo-check', ...review, 'do it']);
  assert.deepEqual(args('gemini', { model: '-m evil' }), ['-p', 'do it', '--skip-trust', '--approval-mode', 'yolo']);
});

test('the DeepSeek Harness is the DeepSeek engine when it is installed, before Claude Code pointed at it (id156)', () => {
  const dsh = enginesStatus({ bin: (n) => n === 'dsh' || n === 'claude' });
  assert.equal(dsh.deepseek.edits, 'worktree');
  assert.match(dsh.deepseek.note, /DeepSeek Harness/);
  const found = { command: 'C:/h/Harness.exe', args: ['--expose-internals', 'C:/h/cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const ds = engineCommands({ dsh: found }).deepseek.command({ brief: 'do it' });
  assert.equal(ds.command, 'C:/h/Harness.exe');
  assert.deepEqual(ds.args, ['--expose-internals', 'C:/h/cli.js', '--profile', 'headless', 'do it']);
  assert.deepEqual(ds.env, { ELECTRON_RUN_AS_NODE: '1' }, 'no token: it signs in by itself');
});

test('findDsh runs what the Windows launcher names, with no shell, and says null when it cannot tell', () => {
  const BS = String.fromCharCode(92);
  const win = (s) => s.split('/').join(BS);
  const launcher = win('C:/Apps/H/resources/runtime/cli/bin/dsh.cmd');
  const text = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"%~dp0${win('../../../../Harness.exe')}" --expose-internals "%~dp0${win('../../../app.asar/dsh/cli.js')}" %*`,
    'exit /b %errorlevel%',
  ].join('\r\n');
  const got = findDsh({ where: () => launcher, read: () => text, exists: () => true, platform: 'win32' });
  assert.ok(got.command.endsWith(`Apps${BS}H${BS}Harness.exe`), got.command);
  assert.equal(got.args[0], '--expose-internals');
  assert.ok(got.args[1].endsWith(`app.asar${BS}dsh${BS}cli.js`), got.args[1]);
  assert.deepEqual(got.env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(findDsh({ where: () => null }), null, 'not installed');
  assert.equal(findDsh({ where: () => launcher, read: () => 'echo hi', exists: () => true, platform: 'win32' }), null, 'a launcher that names no program');
  assert.equal(findDsh({ where: () => launcher, read: () => text, exists: () => false, platform: 'win32' }), null, 'the program is gone');
  assert.deepEqual(findDsh({ where: () => '/usr/bin/dsh', platform: 'linux' }), { command: '/usr/bin/dsh', args: [], env: {} });
});

test('the row\'s model and level ride on a DeepSeek Harness run as a per-run overlay, and nothing else reaches it (id156)', () => {
  const written = [];
  const write = (file, text) => written.push({ file, text });
  const file = dshOverlay({ model: 'deepseek-v4-pro', effort: 'high' }, { dir: '/tmp', write });
  assert.ok(file.endsWith('.yml') && file.includes('session-map-dsh-'));
  assert.equal(written[0].text, '- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-v4-pro\n    reasoningEffort: high\n');
  assert.equal(dshOverlay({ model: 'deepseek-v4-pro', effort: 'high' }, { dir: '/tmp', write }), file, 'the same choice is the same file');
  // Only a level: the Harness keeps its own default model name; only a model: no level line.
  assert.match(dshOverlay({ effort: 'off' }, { dir: '/tmp', write }) && written.at(-1).text, /model: deepseek-flash\n    reasoningEffort: off\n$/);
  assert.doesNotMatch((dshOverlay({ model: 'deepseek-flash' }, { dir: '/tmp', write }), written.at(-1).text), /reasoningEffort/);
  // Neither chosen, or values that are not a model name or a DeepSeek level: no overlay, and no line is ever built from them.
  assert.equal(dshOverlay({}, { write }), null);
  assert.equal(dshOverlay(null, { write }), null);
  assert.equal(dshOverlay({ model: 'x\n    provider: evil', effort: 'turbo' }, { write }), null, 'a model with a line break or a made-up level is dropped');
  const before = written.length;
  assert.equal(dshOverlay({ model: 'ok-model', effort: 'bogus\n- id: evil' }, { dir: '/tmp', write }) !== null, true);
  assert.ok(!written.slice(before).some((w) => w.text.includes('evil')), 'nothing from a bad level reaches the file');
  assert.equal(dshOverlay({ model: 'deepseek-v4-pro' }, { write: () => { throw new Error('disk full'); } }), null, 'a write that fails: the Harness runs on its defaults');
});

test('the Harness command carries --patch before the brief only when the row chose something', () => {
  const found = { command: 'C:/h/Harness.exe', args: ['--expose-internals', 'C:/h/cli.js'], env: {} };
  const none = engineCommands({ dsh: found }).deepseek.command({ brief: 'do it', choice: null });
  assert.deepEqual(none.args, ['--expose-internals', 'C:/h/cli.js', '--profile', 'headless', 'do it']);
  const chosen = engineCommands({ dsh: found }).deepseek.command({ brief: 'do it', choice: { model: 'deepseek-flash', effort: 'low' } });
  const at = chosen.args.indexOf('--patch');
  assert.ok(at > 0 && chosen.args[at + 1].endsWith('.yml'), 'the overlay file follows --patch');
  assert.equal(chosen.args.at(-1), 'do it', 'the brief stays last');
  assert.ok(at < chosen.args.length - 1);
});
