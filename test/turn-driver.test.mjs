import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorPath, startTurnDriver, translateCodex, translateGemini, usageOf } from '../server/chat/turn-driver.mjs';
import { findCli, geminiAlias, handoffArgs, permissionArgs, turnArgs } from '../server/ai/clis.mjs';
import { readConversation } from '../server/sources/claude-conversation.mjs';

// The talk on OpenAI and Gemini (id171): their own programs, one process per message, read into the hub's events, with a
// mirror the page reopens the conversation from. The lines here are the ones Codex CLI 0.163.0 and Gemini CLI 0.64.0
// printed on 2026-10-17.

const CODEX = [
  { type: 'thread.started', thread_id: '01a1482c-726e-7252-acfd-e69f7d31baa3' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Vou ler o arquivo.' } },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'powershell -Command "Get-Content hello.txt"', status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'powershell -Command "Get-Content hello.txt"', aggregated_output: 'segredo-777\r\n', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'segredo-777' } },
  { type: 'turn.completed', usage: { input_tokens: 49257, cached_input_tokens: 34944, output_tokens: 443, reasoning_output_tokens: 58 } },
];
const GEMINI = [
  { type: 'init', session_id: '12392970-bc4d-44b5-93e2-d25c3596a074', model: 'sm-gemini-3.8-flash-low' },
  { type: 'message', role: 'user', content: 'Read hello.txt' },
  { type: 'tool_use', tool_name: 'read_file', tool_id: 'read_file__1', parameters: { file_path: 'hello.txt' } },
  { type: 'tool_result', tool_id: 'read_file__1', status: 'success', output: '' },
  { type: 'message', role: 'assistant', content: 'seg', delta: true },
  { type: 'message', role: 'assistant', content: 'redo-777', delta: true },
  { type: 'result', status: 'success', stats: { total_tokens: 19094, input_tokens: 18677, output_tokens: 26, cached: 0, models: { 'gemini-3.8-flash': { total_tokens: 19094, input_tokens: 18677, output_tokens: 26, cached: 0 } } } },
];

test('Codex lines become the hub\'s events: the thread, its words, its commands with their output, and the tokens', () => {
  const events = CODEX.flatMap((m) => translateCodex(m, 'C:/p'));
  assert.deepEqual(events[0], { type: 'session', data: { sessionId: '01a1482c-726e-7252-acfd-e69f7d31baa3' } });
  assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => e.data.text), ['Vou ler o arquivo.', 'segredo-777']);
  const tools = events.filter((e) => e.type === 'tool');
  assert.deepEqual(tools.map((e) => [e.data.phase, e.data.name ?? null]), [['use', 'Bash'], ['result', null]]);
  assert.equal(tools[1].data.text.trim(), 'segredo-777');
  assert.equal(tools[1].data.isError, false);
  assert.deepEqual(usageOf('openai', CODEX.at(-1), 'gpt-5.5'), { 'gpt-5.5': { inputTokens: 14313, cacheReadInputTokens: 34944, outputTokens: 501 } }, 'the cached part apart; reasoning is billed as output');
  const change = translateCodex({ type: 'item.completed', item: { id: 'i9', type: 'file_change', changes: [{ path: 'C:/p/a.txt', kind: 'add' }], status: 'completed' } }, 'C:/p');
  assert.deepEqual(change.map((e) => [e.data.phase, e.data.name ?? null]), [['use', 'Write'], ['result', null]]);
});

test('Gemini lines become the hub\'s events: the session, its tools named as Claude Code\'s, the answer in pieces, the tokens', () => {
  const events = GEMINI.flatMap((m) => translateGemini(m, 'C:/p'));
  assert.equal(events[0].data.sessionId, '12392970-bc4d-44b5-93e2-d25c3596a074');
  assert.deepEqual(events.filter((e) => e.type === 'tool').map((e) => [e.data.phase, e.data.name ?? null]), [['use', 'Read'], ['result', null]]);
  assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => [e.data.text, e.data.partial]), [['seg', true], ['redo-777', true]], 'the person\'s own line is not an answer');
  assert.deepEqual(usageOf('gemini', GEMINI.at(-1)), { 'gemini-3.8-flash': { inputTokens: 18677, cacheReadInputTokens: 0, outputTokens: 417 } }, 'the thinking (total minus input) is billed as output');
});

// A program that prints the given lines and exits.
function fakeSpawner(linesFor, calls) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 0;
    child.kill = () => {};
    setImmediate(() => {
      for (const l of linesFor(calls.length)) child.stdout.write(`${JSON.stringify(l)}\n`);
      child.stdout.end();
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
}
const until = (events, pred) => new Promise((resolve) => {
  const t = setInterval(() => { if (events.some(pred)) { clearInterval(t); resolve(); } }, 5);
});

test('the driver runs one process per message, continues the same thread, prices the turns and writes the mirror the page reads', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-turn-'));
  const calls = [];
  const events = [];
  const d = startTurnDriver({
    provider: 'openai', script: 'C:/npm/codex.js', cwd: 'C:/p', env: { CODEX_API_KEY: 'k' }, onEvent: (e) => events.push(e), model: 'gpt-6.1-sol', effort: 'high', mode: 'acceptEdits',
    stance: 'Agree or disagree on evidence.', smDir, spawner: fakeSpawner(() => CODEX, calls),
  });
  assert.equal(d.send('Leia hello.txt'), true);
  assert.equal(d.send('again'), false, 'one turn at a time');
  await until(events, (e) => e.type === 'turn-end');
  assert.equal(calls[0].cmd, process.execPath, 'node runs the program: no shell ever reads the message');
  assert.equal(calls[0].args[0], 'C:/npm/codex.js');
  assert.deepEqual(calls[0].args.slice(1, 4), ['exec', '--json', '--skip-git-repo-check']);
  assert.ok(calls[0].args.at(-1).startsWith('Agree or disagree on evidence.\n\nLeia hello.txt'), 'the stance rides the first message of a new conversation');
  const end = events.find((e) => e.type === 'turn-end').data;
  assert.equal(end.isError, false);
  assert.equal(end.sessionId, '01a1482c-726e-7252-acfd-e69f7d31baa3');
  assert.ok(end.processCostUSD > 0, 'priced at OpenAI\'s price');
  assert.equal(d.send('E o outro?'), true);
  await until(events, (e) => e.type === 'turn-end' && events.filter((x) => x.type === 'turn-end').length === 2);
  assert.deepEqual(calls[1].args.slice(1, 4), ['exec', 'resume', '01a1482c-726e-7252-acfd-e69f7d31baa3'], 'the next message continues the thread');
  assert.equal(calls[1].args.at(-1), 'E o outro?', 'the stance only once');
  // The mirror reads as a Claude Code transcript: the person's words, the answer, the step with its result.
  const read = readConversation(mirrorPath(smDir, '01a1482c-726e-7252-acfd-e69f7d31baa3'), { cwd: 'C:/p' });
  assert.deepEqual(read.items.filter((i) => i.type === 'user').map((i) => i.text), ['Leia hello.txt', 'E o outro?']);
  assert.ok(read.items.some((i) => i.type === 'assistant' && i.text === 'segredo-777'));
  assert.ok(read.items.some((i) => i.type === 'tool' && i.name === 'Bash' && /segredo-777/.test(i.result)));
  d.end();
  await until(events, (e) => e.type === 'exit');
});

test('Gemini: a new conversation gets its id before the first line, and the pieces of the answer make one message', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-turn-'));
  const calls = [];
  const events = [];
  const d = startTurnDriver({ provider: 'gemini', script: 'C:/npm/gemini.js', cwd: 'C:/p', env: {}, onEvent: (e) => events.push(e), model: 'gemini-3.8-flash', effort: 'low', mode: 'default', smDir, spawner: fakeSpawner(() => GEMINI, calls) });
  d.send('Read hello.txt');
  await until(events, (e) => e.type === 'turn-end');
  const sid = calls[0].args[calls[0].args.indexOf('--session-id') + 1];
  assert.match(sid, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0].args.slice(1, 9), ['-p', 'Read hello.txt', '-o', 'stream-json', '--skip-trust', '-m', geminiAlias('gemini-3.8-flash', 'low'), '--approval-mode']);
  assert.ok(events.some((e) => e.type === 'text' && !e.data.partial && e.data.text === 'segredo-777'));
  d.send('more');
  await until(events, (e) => events.filter((x) => x.type === 'turn-end').length === 2);
  assert.deepEqual(calls[1].args.slice(-2), ['--resume', '12392970-bc4d-44b5-93e2-d25c3596a074'], 'the id the program itself reports wins');
});

test('a program that fails says so as the end of a failed turn, never a silent one', async () => {
  const events = [];
  const d = startTurnDriver({ provider: 'openai', script: 's', cwd: '.', env: {}, onEvent: (e) => events.push(e), model: 'gpt-5.5', spawner: fakeSpawner(() => [{ type: 'thread.started', thread_id: 't1' }, { type: 'turn.failed', error: { message: 'model not found' } }], []) });
  d.send('oi');
  await until(events, (e) => e.type === 'turn-end');
  assert.equal(events.find((e) => e.type === 'turn-end').data.isError, true);
  assert.ok(events.some((e) => e.type === 'text' && /model not found/.test(e.data.text)));
});

test('the programs\' arguments: the mode becomes their permissions, the level their own word, and a resume keeps both', () => {
  assert.deepEqual(permissionArgs('openai', 'plan'), ['-c', 'approvals_reviewer="auto_review"', '-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="read-only"']);
  assert.deepEqual(permissionArgs('gemini', 'plan'), ['--approval-mode', 'plan']);
  assert.deepEqual(permissionArgs('gemini', 'bypassPermissions'), ['--approval-mode', 'yolo']);
  assert.deepEqual(permissionArgs('gemini', 'default'), ['--approval-mode', 'auto_edit']);
  const resumed = turnArgs('openai', { session: 't1', prompt: 'p', model: 'gpt-5.5', effort: 'max', mode: 'default' });
  assert.deepEqual(resumed.slice(0, 5), ['exec', 'resume', 't1', '--json', '--skip-git-repo-check']);
  assert.ok(resumed.includes('model_reasoning_effort="max"'), 'the catalog of Codex gives max (id179: accepted on a real call)');
  assert.ok(resumed.includes('sandbox_mode="workspace-write"'), 'the resume keeps the permissions: `exec resume` has no flag for them');
  assert.deepEqual(handoffArgs('gemini', { brief: 'b', model: 'gemini-3.8-flash' }), ['-p', 'b', '--skip-trust', '-m', 'gemini-3.8-flash', '--approval-mode', 'yolo'], 'no level: the plain model');
  assert.equal(turnArgs('claude', { prompt: 'x' }), null);
});

test('findCli finds the npm script of each program, and says null when it is not installed', () => {
  const seen = [];
  const exists = (p) => { seen.push(p); return p.replaceAll('\\', '/').endsWith('/npm/node_modules/@openai/codex/bin/codex.js'); };
  assert.match(findCli('openai', { env: { APPDATA: 'C:/Users/x/AppData/Roaming', PATH: '' }, exists }).replaceAll('\\', '/'), /npm\/node_modules\/@openai\/codex\/bin\/codex\.js$/);
  assert.equal(findCli('gemini', { env: { APPDATA: 'C:/Users/x/AppData/Roaming', PATH: '' }, exists }), null);
  assert.equal(findCli('deepseek', { env: {}, exists }), null);
});
