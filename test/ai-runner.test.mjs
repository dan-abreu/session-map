import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiQueue, aiRunnerDir, findClaude, isAiRunnerCwd, runClaudeJSON } from '../server/ai/runner.mjs';
import { readLedger } from '../server/budget.mjs';
import { normalizePath } from '../server/paths.mjs';

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

test('the Cérebro\'s background row rides the map\'s own Claude calls; the legacy model stays the fallback (id146)', async () => {
  const smDir = tmp();
  try {
    const { run, calls } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, now: () => NOON });
    await q.ask({ key: 'a', prompt: 'p' });
    assert.equal(calls.at(-1).opts.model, 'haiku', 'the default');
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { background: { model: 'sonnet', effort: 'low' } } } } }));
    await q.ask({ key: 'b', prompt: 'p' });
    assert.equal(calls.at(-1).opts.model, 'sonnet', 'the owner\'s choice');
    assert.equal(calls.at(-1).opts.effort, 'low');
    // A choice for another engine never touches the Claude call.
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { background: { provider: 'gemini', model: 'gemini-3.1-flash-lite', effort: 'low' } } } } }));
    await q.ask({ key: 'c', prompt: 'p' });
    assert.equal(calls.at(-1).opts.model, 'haiku', 'another engine\'s choice leaves Claude alone');
    assert.equal('effort' in calls.at(-1).opts, false);
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

test('AiQueue keeps today\'s spend per project as well as in total, also after a restart', async () => {
  const smDir = tmp();
  try {
    const { run } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }, { ok: true, value: {}, costUSD: 0.02 }, { ok: true, value: {}, costUSD: 0.04 }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, now: () => NOON });
    await q.ask({ key: 'a', prompt: 'p', projectId: 'shop' });
    await q.ask({ key: 'b', prompt: 'p', projectId: 'blog' });
    await q.ask({ key: 'c', prompt: 'p', projectId: 'shop' });
    assert.equal(q.status('shop').spentUSDToday, 0.05);
    assert.equal(q.status('blog').spentUSDToday, 0.02);
    assert.equal(q.status('none').spentUSDToday, 0);
    assert.equal(q.status().spentUSDToday, 0.07);
    assert.equal(new AiQueue({ smDir, bin: 'claude', run, now: () => NOON }).status('shop').spentUSDToday, 0.05);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('each of session-map\'s own Claude calls is noted with its task and cost, for the statement (sb11)', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-note-'));
  try {
    const noted = [];
    const run = async () => ({ ok: true, value: { part: 'x' }, costUSD: 0.0123 });
    const q = new AiQueue({ smDir, bin: 'claude', run, onOutside: (call) => noted.push(call) });
    await q.ask({ key: { kind: 'place', id: 'one' }, prompt: 'where?' });
    assert.equal(noted.length, 1);
    assert.equal(noted[0].provider, 'claude');
    assert.equal(noted[0].kind, 'place');
    assert.equal(noted[0].costUSD, 0.0123);
    assert.equal(noted[0].ok, true);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the map\'s own outside call books the project month too, so the budget bar sees it (or50)', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-month-'));
  const root = join(tmpdir(), 'proj-shop');
  try {
    const others = () => ({ enabled: true, dailyUSD: 5, off: [], keys: ['openai'], models: {} });
    const apiRun = async () => ({ ok: true, value: { partId: 'orders' }, costUSD: 0.01, provider: 'openai', model: 'gpt-6-luna' });
    const q = new AiQueue({ smDir, bin: 'claude', apiRun, keyOf: () => 'sk-x', others, now: () => Date.now() });
    const got = await q.ask({ key: { kind: 'place', id: 'one' }, prompt: 'where?', projectId: 'shop', root, sensitivity: 'internal' });
    assert.equal(got.ok, true);
    const months = readLedger(smDir);
    assert.equal(Object.keys(months).length, 1);
    const month = Object.values(months)[0];
    assert.equal(month[normalizePath(root)], 0.01, 'the outside call of the map counts in the monthly budget');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the Cérebro\'s background row names the AI of the map\'s own work (id155); with no key for it, Claude does it', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-row-'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { background: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } } }));
    const asked = [];
    const apiRun = async (prompt, o) => { asked.push(`${o.provider}:${o.model}`); return { ok: true, value: { done: true }, costUSD: 0.001 }; };
    const { run, calls } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }]);
    const withKey = new AiQueue({ smDir, bin: 'claude', run, apiRun, keyOf: () => 'sk-x', others: () => ({ enabled: true, dailyUSD: 5, off: [], keys: ['deepseek'], models: {} }), now: () => Date.now() });
    assert.deepEqual((await withKey.ask({ key: 'row-a', prompt: 'p', sensitivity: 'internal' })).value, { done: true });
    assert.deepEqual(asked, ['deepseek:deepseek-v4-pro'], 'the row\'s AI and model, not the old engine switch');
    assert.equal(calls.length, 0);
    const noKey = new AiQueue({ smDir, bin: 'claude', run, apiRun, keyOf: () => null, others: () => ({ enabled: true, dailyUSD: 5, off: [], keys: [], models: {} }), now: () => Date.now() });
    await noKey.ask({ key: 'row-b', prompt: 'p', sensitivity: 'internal' });
    assert.equal(calls.length, 1, 'Claude took it');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a call can ride the book row instead of the background row, and can refuse the Claude fallback (id156)', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-book-'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: {
      background: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      book: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' },
    } } } }));
    const asked = [];
    const apiRun = async (prompt, o) => { asked.push(`${o.provider}:${o.model}:${o.effort ?? '-'}`); return { ok: true, value: { titled: true }, costUSD: 0.0004 }; };
    const { run, calls } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }]);
    const opts = { smDir, bin: 'claude', run, apiRun, keyOf: () => 'sk-x', others: () => ({ enabled: true, dailyUSD: 5, off: [], keys: ['deepseek', 'gemini'], models: {} }), now: () => Date.now() };
    const q = new AiQueue(opts);
    const book = await q.ask({ key: { kind: 'book', n: 1 }, prompt: 'titles', functionId: 'book', outsideOnly: true, uncapped: true, sensitivity: 'internal' });
    assert.deepEqual(book.value, { titled: true });
    assert.deepEqual(asked, ['deepseek:deepseek-flash:low'], 'the book row\'s AI, not the background row\'s Gemini');
    assert.equal(calls.length, 0);

    // The book row on Claude (or on nothing): nothing outside takes it, and outsideOnly says so instead of calling Claude.
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { background: { provider: 'gemini', model: 'gemini-3.1-flash-lite' } } } } }));
    const none = await new AiQueue(opts).ask({ key: { kind: 'book', n: 2 }, prompt: 'titles', functionId: 'book', outsideOnly: true, uncapped: true, sensitivity: 'internal' });
    assert.deepEqual([none.ok, none.error], [false, 'no-outside']);
    assert.equal(calls.length, 0, 'the caller has its own Claude call');
    assert.equal(asked.length, 1, 'the background row\'s Gemini was not borrowed for the book');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// The book's titles and summaries for six chapters do not fit the default 1024 tokens: asked of DeepSeek they came back cut
// ("answer-cut") every time, were paid, and Claude did the work after it. The book gets room; a short job keeps the default.
test('the book job asks for room for its answer, and a background job keeps the default', async () => {
  const { ANSWER_TOKENS } = await import('../server/ai/runner.mjs');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-room-'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: {
      background: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      book: { provider: 'deepseek', model: 'deepseek-flash' },
    } } } }));
    const sizes = [];
    const apiRun = async (prompt, o) => { sizes.push([o.provider, o.maxTokens ?? null]); return { ok: true, value: { ok: 1 }, costUSD: 0.0004 }; };
    const { run } = fakeRun([{ ok: true, value: {}, costUSD: 0.01 }]);
    const q = new AiQueue({ smDir, bin: 'claude', run, apiRun, keyOf: () => 'sk-x', others: () => ({ enabled: true, dailyUSD: 5, off: [], keys: ['deepseek', 'gemini'], models: {} }), now: () => Date.now() });
    await q.ask({ key: { kind: 'book', n: 1 }, prompt: 'titles', functionId: 'book', outsideOnly: true, uncapped: true, sensitivity: 'internal' });
    await q.ask({ key: { kind: 'place', n: 1 }, prompt: 'where', sensitivity: 'internal' });
    assert.deepEqual(sizes, [['deepseek', ANSWER_TOKENS.book], ['gemini', null]]);
    assert.ok(ANSWER_TOKENS.book >= 2048);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// 2026-10-17, watched live: the Cérebro's background row said DeepSeek flash, yet "where does this idea go" (kind 'place')
// went to Gemini, OpenAI or DeepSeek as the old router spread it (81 OpenAI, 40 Gemini, 3 DeepSeek in the log). The row
// is the owner's order for the map's bulk work too (id174, or76): its AI, model and level, with room for the thinking.
test('the map\'s bulk work (place) obeys the Cérebro\'s background row: its AI, model and level; on Claude, Claude does it', async () => {
  const { ANSWER_TOKENS, REASONING_ROOM, aiKeyHash } = await import('../server/ai/runner.mjs');
  const { reviewPicks } = await import('../server/ai/review.mjs');
  const keys = [];
  for (let i = 0; keys.length < 3; i++) if (!reviewPicks(aiKeyHash({ kind: 'place', n: i }))) keys.push({ kind: 'place', n: i });
  const smDir = mkdtempSync(join(tmpdir(), 'sm-runner-place-'));
  try {
    const write = (background) => writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { background } } } }));
    const asked = [];
    const apiRun = async (prompt, o) => { asked.push([o.provider, o.model, o.effort ?? null, o.maxTokens ?? null]); return { ok: true, value: { partId: 'p' }, costUSD: 0.0006 }; };
    const { run, calls } = fakeRun([{ ok: true, value: { partId: 'c' }, costUSD: 0.001 }]);
    // Every AI has a key and the old router would rather pick another: the row still wins.
    const opts = { smDir, bin: 'claude', run, apiRun, keyOf: () => 'sk-x', others: () => ({ enabled: true, dailyUSD: 5, off: [], keys: ['openai', 'gemini', 'deepseek'], models: {} }), now: () => Date.now() };

    write({ provider: 'deepseek', model: 'deepseek-flash', effort: 'high' });
    assert.deepEqual((await new AiQueue(opts).ask({ key: keys[0], prompt: 'where', sensitivity: 'internal' })).value, { partId: 'p' });
    assert.deepEqual(asked, [['deepseek', 'deepseek-flash', 'high', REASONING_ROOM]], 'the row\'s AI, model and level, with room to think');
    assert.ok(REASONING_ROOM >= 4096 && ANSWER_TOKENS.book > 4096, 'a thinking level ate 4096 tokens in the live book calls');

    write({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
    await new AiQueue(opts).ask({ key: keys[1], prompt: 'where', sensitivity: 'internal' });
    assert.deepEqual(asked[1], ['gemini', 'gemini-3.1-flash-lite', null, null], 'no level asked: no extra room, the default answer size');

    write({ provider: 'claude', model: 'haiku' });
    await new AiQueue(opts).ask({ key: keys[2], prompt: 'where', sensitivity: 'internal' });
    assert.equal(asked.length, 2, 'no outside AI for a row on Claude');
    assert.equal(calls.length, 1, 'Claude did it');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
