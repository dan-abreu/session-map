import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiQueue, aiRunnerDir, findClaude, isAiRunnerCwd, runClaudeJSON } from '../server/ai/runner.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-ai-'));
const touch = (path) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, ''); };
const envelope = (result, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.0012, ...extra });

test('findClaude prefers the PATH, then ~/.local/bin', () => {
  const home = tmp();
  try {
    const bin = join(home, 'somewhere', 'bin');
    touch(join(bin, EXE));
    touch(join(home, '.local', 'bin', EXE));
    assert.equal(findClaude({ env: { PATH: bin }, home }), join(bin, EXE));
    assert.equal(findClaude({ env: { PATH: join(home, 'empty') }, home }), join(home, '.local', 'bin', EXE));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('findClaude falls back to the npm global package', () => {
  const home = tmp();
  try {
    const prefix = join(home, 'npm-prefix');
    const modules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
    const cli = join(modules, '@anthropic-ai', 'claude-code', 'cli.js');
    touch(cli);
    assert.equal(findClaude({ env: { PATH: '', npm_config_prefix: prefix }, home }), cli);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('findClaude picks the newest VS Code extension by version number, not by text', () => {
  const home = tmp();
  try {
    const ext = join(home, '.vscode', 'extensions');
    for (const v of ['2.1.9', '2.1.10', '2.0.99']) touch(join(ext, `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary', EXE));
    mkdirSync(join(ext, 'anthropic.claude-code-2.1.11-win32-x64'), { recursive: true }); // half-installed, no binary
    assert.equal(findClaude({ env: { PATH: '', npm_config_prefix: join(home, 'npm') }, home }), join(ext, 'anthropic.claude-code-2.1.10-win32-x64', 'resources', 'native-binary', EXE));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('findClaude returns null when claude is nowhere', () => {
  const home = tmp();
  try {
    assert.equal(findClaude({ env: { PATH: '', npm_config_prefix: join(home, 'npm') }, home }), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runClaudeJSON runs claude with a clean env in its own folder and extracts the JSON reply', async () => {
  const dir = tmp();
  try {
    const log = join(dir, 'call.json');
    const cwd = join(dir, 'ai-runner');
    const env = {
      PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, KEEP_ME: '1',
      CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', MCP_CONNECTION_NONBLOCKING: 'true',
      FAKE_LOG: log, FAKE_REPLY: envelope('Sure:\n```json\n{"name": "Checkout", "tags": ["cart"]}\n```'),
    };
    const res = await runClaudeJSON('Describe this work.', { model: 'haiku', cwd, schemaHint: '{"name": string}', bin: FAKE, env });
    assert.deepEqual(res, { ok: true, value: { name: 'Checkout', tags: ['cart'] }, costUSD: 0.0012 });
    const call = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(call.argv.slice(0, 5), ['-p', '--output-format', 'json', '--model', 'haiku']);
    assert.ok(call.argv.includes('--tools'), 'tools are disabled');
    assert.equal(call.argv[call.argv.indexOf('--tools') + 1], '');
    assert.equal(realLower(call.cwd), realLower(cwd));
    assert.ok(call.envKeys.includes('KEEP_ME'));
    assert.ok(!call.envKeys.some((k) => /^CLAUDE|^MCP_CONNECTION_NONBLOCKING$/i.test(k)), call.envKeys.join(','));
    assert.match(call.stdin, /^Describe this work\./);
    assert.match(call.stdin, /\{"name": string\}/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const realLower = (p) => p.replaceAll('\\', '/').toLowerCase();

test('runClaudeJSON reports errors instead of throwing', async () => {
  const dir = tmp();
  const base = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT };
  try {
    const cwd = join(dir, 'r');
    assert.deepEqual(await runClaudeJSON('x', { cwd, bin: null }), { ok: false, error: 'claude-not-found' });
    const notJson = await runClaudeJSON('x', { cwd, bin: FAKE, env: { ...base, FAKE_REPLY: envelope('no json here') } });
    assert.equal(notJson.ok, false);
    assert.equal(notJson.error, 'no-json');
    assert.equal(notJson.costUSD, 0.0012);
    const failed = await runClaudeJSON('x', { cwd, bin: FAKE, env: { ...base, FAKE_REPLY: envelope('', { is_error: true, subtype: 'error_during_execution' }) } });
    assert.equal(failed.error, 'claude-error');
    const garbage = await runClaudeJSON('x', { cwd, bin: FAKE, env: { ...base, FAKE_REPLY: 'not an envelope' } });
    assert.equal(garbage.error, 'bad-output');
    const slow = await runClaudeJSON('x', { cwd, bin: FAKE, timeoutMs: 300, env: { ...base, FAKE_SLEEP_MS: '5000', FAKE_REPLY: envelope('{}') } });
    assert.deepEqual(slow, { ok: false, error: 'timeout' });
    const missing = await runClaudeJSON('x', { cwd, bin: join(dir, 'nope', EXE), env: base });
    assert.equal(missing.error, 'spawn-failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ai-runner folder is recognised whatever the spelling', () => {
  const smDir = join(tmpdir(), 'SM-Home');
  assert.equal(aiRunnerDir(smDir), join(smDir, 'ai-runner'));
  assert.equal(isAiRunnerCwd(join(smDir, 'ai-runner'), smDir), true);
  if (process.platform === 'win32') assert.equal(isAiRunnerCwd(join(smDir, 'AI-RUNNER').replaceAll('\\', '/'), smDir), true);
  assert.equal(isAiRunnerCwd(join(smDir, 'ai-runner', 'deep'), smDir), true);
  assert.equal(isAiRunnerCwd(join(smDir, 'ai-runner-other'), smDir), false);
  assert.equal(isAiRunnerCwd(null, smDir), false);
});

function fakeRun(replies) {
  const calls = [];
  const run = async (prompt, opts) => {
    calls.push({ prompt, opts });
    return replies.shift() ?? { ok: true, value: {}, costUSD: 0 };
  };
  return { run, calls };
}
const NOON = new Date(2026, 9, 9, 12, 0, 0).getTime();

test('AiQueue caches by content: the same key never calls claude twice, even after a restart', async () => {
  const smDir = tmp();
  try {
    const { run, calls } = fakeRun([{ ok: true, value: { name: 'A' }, costUSD: 0.01 }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, now: () => NOON });
    const first = await q.ask({ key: { kind: 'perceive', digest: { title: 't' } }, prompt: 'p', schemaHint: 'h' });
    const second = await q.ask({ key: { kind: 'perceive', digest: { title: 't' } }, prompt: 'p', schemaHint: 'h' });
    assert.deepEqual(first, { ok: true, value: { name: 'A' }, costUSD: 0.01 });
    assert.deepEqual(second, { ok: true, value: { name: 'A' }, costUSD: 0, cached: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.model, 'haiku');
    assert.equal(calls[0].opts.cwd, aiRunnerDir(smDir));
    assert.equal(calls[0].opts.bin, 'claude');
    assert.ok(existsSync(join(smDir, 'ai-cache.json')));
    const again = new AiQueue({ smDir, bin: 'claude', run, now: () => NOON });
    assert.equal((await again.ask({ key: { kind: 'perceive', digest: { title: 't' } }, prompt: 'p' })).cached, true);
    assert.equal(calls.length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('AiQueue refuses calls past maxCallsPerHour and lets them through an hour later; failures are not cached', async () => {
  const smDir = tmp();
  try {
    let now = NOON;
    const { run, calls } = fakeRun([{ ok: false, error: 'timeout' }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, maxCallsPerHour: 2, now: () => now });
    assert.equal((await q.ask({ key: 'a', prompt: 'p' })).ok, false);
    assert.equal((await q.ask({ key: 'a', prompt: 'p' })).ok, true, 'a failed answer is retried, not cached');
    assert.deepEqual(await q.ask({ key: 'c', prompt: 'p' }), { ok: false, error: 'rate-limited' });
    assert.equal(calls.length, 2);
    now += 60 * 60 * 1000 + 1;
    assert.equal((await q.ask({ key: 'c', prompt: 'p' })).ok, true);
    assert.equal(calls.length, 3);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('AiQueue sums today\'s spend from the replies and starts over the next day', async () => {
  const smDir = tmp();
  try {
    let now = NOON;
    const { run } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }, { ok: false, error: 'no-json', costUSD: 0.02 }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, model: 'sonnet', now: () => now });
    await q.ask({ key: 'a', prompt: 'p' });
    await q.ask({ key: 'b', prompt: 'p' });
    assert.deepEqual(q.status(), { enabled: true, model: 'sonnet', spentUSDToday: 0.03, queue: 0 });
    assert.equal(new AiQueue({ smDir, bin: 'claude', run, now: () => now }).status().spentUSDToday, 0.03);
    now += 24 * 60 * 60 * 1000;
    assert.equal(q.status().spentUSDToday, 0);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('AiQueue runs one call at a time and reports the queue length', async () => {
  const smDir = tmp();
  try {
    let running = 0;
    let peak = 0;
    const q = new AiQueue({
      smDir, bin: 'claude', now: () => NOON,
      run: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return { ok: true, value: {}, costUSD: 0 };
      },
    });
    const pending = [q.ask({ key: 1, prompt: 'p' }), q.ask({ key: 2, prompt: 'p' }), q.ask({ key: 3, prompt: 'p' })];
    assert.equal(q.status().queue, 3);
    await Promise.all(pending);
    assert.equal(peak, 1);
    assert.equal(q.status().queue, 0);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('AiQueue is off without claude or with ai.enabled false, and never calls it', async () => {
  const smDir = tmp();
  try {
    const { run, calls } = fakeRun([]);
    const missing = new AiQueue({ smDir, bin: null, run });
    const off = new AiQueue({ smDir, bin: 'claude', enabled: false, run });
    assert.equal(missing.enabled, false);
    assert.equal(off.enabled, false);
    assert.deepEqual(await missing.ask({ key: 'a', prompt: 'p' }), { ok: false, error: 'ai-off' });
    assert.deepEqual(await off.ask({ key: 'a', prompt: 'p' }), { ok: false, error: 'ai-off' });
    assert.equal(calls.length, 0);
    assert.equal(missing.status().enabled, false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
