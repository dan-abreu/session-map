import test from 'node:test';
import assert from 'node:assert/strict';
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
  const c = engineCommands({ deepseekToken: 'dk-secret' });
  assert.equal(c.openai.command({ brief: 'x' }).command, 'codex');
  assert.equal(c.gemini.command({ brief: 'x' }).command, 'gemini');
  const ds = c.deepseek.command({ brief: 'x' });
  assert.equal(ds.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(ds.env.ANTHROPIC_AUTH_TOKEN, 'dk-secret');
  assert.equal(engineCommands().deepseek.command({ brief: 'x' }).env.ANTHROPIC_AUTH_TOKEN, '', 'no token by default');
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
