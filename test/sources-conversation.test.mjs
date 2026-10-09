import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { helperPath, maskSecrets, readConversation, readImage, toolDetails } from '../server/sources/claude-conversation.mjs';

const S = '11111111-1111-4111-8111-111111111111';
const PRICES = { 'claude-opus-5-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 } };

function withTranscript(entries, fn, extra = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-conv-'));
  try {
    const path = join(dir, `${S}.jsonl`);
    writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
    extra(dir);
    return fn(path, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const at = (min) => `2026-10-09T10:${String(min).padStart(2, '0')}:00.000Z`;
const human = (min, content) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content } });
const assistant = (min, id, content, usage = { input_tokens: 1000, output_tokens: 100 }) => ({
  type: 'assistant', timestamp: at(min), message: { id, model: 'claude-opus-5-5', role: 'assistant', content, usage },
});
const result = (min, toolUseId, content, toolUseResult, isError = false) => ({
  type: 'user', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] },
  ...(toolUseResult ? { toolUseResult } : {}),
});

test('readConversation keeps every message with its time, in order', () => {
  withTranscript([
    human(0, 'Add the **checkout** page'),
    assistant(1, 'm1', [{ type: 'text', text: 'On it.' }]),
    { type: 'user', timestamp: at(2), message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>injected</system-reminder>' }] } },
    assistant(3, 'm2', [{ type: 'text', text: 'Done.' }]),
  ], (path) => {
    const { items } = readConversation(path, { prices: PRICES });
    assert.deepEqual(items.map((i) => [i.type, i.text, i.ts]), [
      ['user', 'Add the **checkout** page', at(0)],
      ['assistant', 'On it.', at(1)],
      ['assistant', 'Done.', at(3)],
    ]);
  });
});

test('readConversation puts the cost of each reply on its last message, and the total', () => {
  withTranscript([
    human(0, 'First'),
    assistant(1, 'm1', [{ type: 'text', text: 'a' }]),
    assistant(1, 'm1', [{ type: 'text', text: 'b' }]),
    human(2, 'Second'),
    assistant(3, 'm2', [{ type: 'text', text: 'c' }], { input_tokens: 2000, output_tokens: 0 }),
  ], (path) => {
    const { items, costUSD } = readConversation(path, { prices: PRICES });
    const replies = items.filter((i) => i.type === 'assistant');
    // m1 counted once (repeated lines of one message carry the same usage): 1000 in × 5 + 100 out × 25 per million.
    assert.equal(replies[0].replyCostUSD, undefined);
    assert.equal(replies[1].replyCostUSD, 0.0075);
    assert.equal(replies[2].replyCostUSD, 0.01);
    assert.equal(costUSD, 0.0175);
  });
});

test('readConversation folds a tool step with its input, its result and the kind of step', () => {
  withTranscript([
    human(0, 'Run the tests'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]),
    result(2, 't1', 'all 12 passed'),
    assistant(3, 'm2', [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/work/shop/src/a.ts' } }]),
    result(4, 't2', [{ type: 'text', text: 'no such file' }], null, true),
  ], (path) => {
    const tools = readConversation(path, { prices: PRICES, cwd: '/work/shop' }).items.filter((i) => i.type === 'tool');
    assert.equal(tools.length, 2);
    assert.deepEqual(tools[0].step, { kind: 'run', target: 'Run the tests' });
    assert.match(tools[0].input, /"command": "npm test"/);
    assert.equal(tools[0].result, 'all 12 passed');
    assert.equal(tools[0].isError, false);
    assert.deepEqual(tools[1].step, { kind: 'read', target: 'src/a.ts' });
    assert.equal(tools[1].result, 'no such file');
    assert.equal(tools[1].isError, true);
  });
});

test('readConversation masks secrets in tool inputs and results', () => {
  withTranscript([
    human(0, 'Deploy'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abc.def.ghi" https://x' } }]),
    result(2, 't1', 'API_KEY=sk-live-123456 ok\nghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'),
  ], (path) => {
    const [tool] = readConversation(path, { prices: PRICES }).items.filter((i) => i.type === 'tool');
    assert.ok(!tool.input.includes('abc.def.ghi'), tool.input);
    assert.ok(!tool.result.includes('sk-live-123456'), tool.result);
    assert.ok(!tool.result.includes('ghp_AbCdEf'), tool.result);
  });
});

test('maskSecrets keeps paths, commit hashes and uuids readable', () => {
  const plain = 'C:/Users/Someone/Projects/MyApp2/src/CheckoutPage.tsx 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39 11111111-1111-4111-8111-111111111111';
  assert.equal(maskSecrets(plain), plain);
  assert.equal(maskSecrets('password: hunter2'), 'password: …');
  assert.equal(maskSecrets('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123'), 'token …');
  assert.match(maskSecrets('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'), /^…$/);
});

test('maskSecrets masks the .env and config shapes: a prefixed key, a YAML colon, a password in a URL', () => {
  assert.equal(maskSecrets('DB_PASSWORD=hunter2'), 'DB_PASSWORD=…');
  assert.equal(maskSecrets('JWT_SECRET=mysecretvalue'), 'JWT_SECRET=…');
  assert.equal(maskSecrets('API_TOKEN=abc123def'), 'API_TOKEN=…');
  assert.equal(maskSecrets('  POSTGRES_PASSWORD: s3cr3t'), '  POSTGRES_PASSWORD: …');
  assert.equal(maskSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'), 'AWS_SECRET_ACCESS_KEY=…');
  assert.equal(maskSecrets('"dbPassword": "hunter2"'), '"dbPassword": "…"');
  assert.equal(maskSecrets('DATABASE_URL=postgres://user:Sup3rS3cret@db:5432/app'), 'DATABASE_URL=postgres://user:…@db:5432/app');
  assert.equal(maskSecrets('open https://x.test/cb?state=1&access_token=abc123 now'), 'open https://x.test/cb?state=1&access_token=… now');
});

test('maskSecrets leaves look-alike words and ports alone', () => {
  const plain = 'max_tokens: 4096 tokenizer=bpe https://example.com:8080/path user: ana';
  assert.equal(maskSecrets(plain), plain);
});

test('toolDetails masks a value by its key, nested ones too', () => {
  const { input } = toolDetails('Bash', { command: 'run', env: { password: 'hunter2', apiKey: 'k-123', nested: { DB_PASSWORD: 'p4ss' }, retries: 3 } }, '');
  for (const leaked of ['hunter2', 'k-123', 'p4ss']) assert.ok(!input.includes(leaked), input);
  assert.match(input, /"retries": 3/);
});

test('maskSecrets stays linear on long runs that are almost secrets', () => {
  for (const run of ['a1'.repeat(16_000), '0123456789abcdef'.repeat(2_000), 'ab-'.repeat(11_000), `${'k'.repeat(30_000)}=`]) {
    const started = performance.now();
    maskSecrets(run);
    assert.ok(performance.now() - started < 100, `${run.slice(0, 6)}… took ${Math.round(performance.now() - started)} ms`);
  }
});

test('maskSecrets masks a giant token whole instead of overflowing the stack (a huge Write goes uncut into its diff)', () => {
  const giant = 'aB3x'.repeat(2_000_000);
  for (const prefix of ['', 'AIza', 'ghp_', 'sk-', 'github_pat_', 'xoxb-']) assert.equal(maskSecrets(`${prefix}${giant}`), '…', prefix || 'no prefix');
});

test('readConversation shows an edit as before and after', () => {
  withTranscript([
    human(0, 'Rename it'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/work/shop/a.ts', old_string: 'const a = 1;', new_string: 'const total = 1;' } }]),
    result(2, 't1', 'The file was updated.'),
    assistant(3, 'm2', [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/work/shop/b.ts', content: 'export {};\n' } }]),
    result(4, 't2', 'File created.'),
  ], (path) => {
    const tools = readConversation(path, { prices: PRICES, cwd: '/work/shop' }).items.filter((i) => i.type === 'tool');
    assert.deepEqual(tools[0].diff, { path: 'a.ts', hunks: [{ before: 'const a = 1;', after: 'const total = 1;' }] });
    assert.deepEqual(tools[1].diff, { path: 'b.ts', hunks: [{ before: '', after: 'export {};\n' }] });
    assert.equal(tools[0].input, '{}', 'the path and the text are in the diff already: nothing else went in');
  });
});

test('readConversation turns the question tool into a question with the answer given', () => {
  const questions = [{ question: 'Which phone number?', header: 'Phone', multiSelect: false, options: [{ label: 'The new one', description: 'From the site' }, { label: 'Keep it', description: '' }] }];
  withTranscript([
    human(0, 'Fix the links'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions } }]),
    result(2, 't1', 'User answered', { questions, answers: { 'Which phone number?': 'The new one' } }),
  ], (path) => {
    const { items } = readConversation(path, { prices: PRICES });
    const q = items.find((i) => i.type === 'question');
    assert.deepEqual(q.questions, [{ header: 'Phone', question: 'Which phone number?', multiSelect: false, options: [{ label: 'The new one', description: 'From the site' }, { label: 'Keep it', description: '' }] }]);
    assert.deepEqual(q.answers, { 'Which phone number?': 'The new one' });
    assert.ok(!items.some((i) => i.type === 'tool'), 'the question is not shown twice');
  });
});

test('readConversation keeps the task list of the todo tool', () => {
  withTranscript([
    human(0, 'Plan'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Write test', status: 'completed', activeForm: 'Writing test' }, { content: 'Ship', status: 'in_progress', activeForm: 'Shipping' }] } }]),
    result(2, 't1', 'ok'),
  ], (path) => {
    const tool = readConversation(path, { prices: PRICES }).items.find((i) => i.type === 'tool');
    assert.deepEqual(tool.todos, [{ text: 'Write test', status: 'completed', active: 'Writing test' }, { text: 'Ship', status: 'in_progress', active: 'Shipping' }]);
  });
});

test('readConversation shows thinking, slash commands and pasted images', () => {
  withTranscript([
    human(0, [{ type: 'text', text: 'Look at this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]),
    human(1, '<command-name>/review</command-name>\n<command-args>the diff</command-args>'),
    { type: 'assistant', timestamp: at(2), thinkingDurationMs: 4200, message: { id: 'm1', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking the layout.' }] } },
  ], (path) => {
    const { items } = readConversation(path, { prices: PRICES });
    assert.deepEqual(items[0], { type: 'user', text: 'Look at this', ts: at(0), images: [{ n: 0, media: 'image/png' }] });
    assert.equal(items[1].text, '/review the diff');
    assert.deepEqual(items[2], { type: 'thinking', text: 'Checking the layout.', ms: 4200, ts: at(2) });
    assert.deepEqual(readImage(path, 0), { media: 'image/png', data: Buffer.from('iVBORw0KGgo=', 'base64') });
    assert.equal(readImage(path, 1), null);
  });
});

test('readConversation links a helper agent to its own transcript, which reads the same way', () => {
  withTranscript([
    human(0, 'Look around'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Find the routes', subagent_type: 'Explore', model: 'haiku', prompt: 'Find them' } }]),
    result(2, 't1', [{ type: 'text', text: 'Found 3 routes' }], { status: 'completed', agentId: 'a1b2c3', agentType: 'Explore', totalToolUseCount: 4 }),
  ], (path, dir) => {
    const { items } = readConversation(path, { prices: PRICES });
    const tool = items.find((i) => i.type === 'tool');
    assert.deepEqual(tool.agent, { id: 'a1b2c3', kind: 'Explore', description: 'Find the routes', model: 'haiku', status: 'completed', steps: 4, prompt: 'Find them' });
    assert.equal(helperPath(path, 'a1b2c3'), join(dir, S, 'subagents', 'agent-a1b2c3.jsonl'));
    assert.equal(helperPath(path, 'w9'), join(dir, S, 'subagents', 'workflows', 'wf_1', 'agent-w9.jsonl'), 'a workflow helper');
    assert.equal(helperPath(path, '../a1b2c3'), null);
    assert.equal(helperPath(path, 'nobody'), null);
    const helper = readConversation(helperPath(path, 'a1b2c3'), { prices: PRICES });
    assert.deepEqual(helper.items.map((i) => i.type), ['user', 'assistant']);
  }, (dir) => {
    mkdirSync(join(dir, S, 'subagents', 'workflows', 'wf_1'), { recursive: true });
    writeFileSync(join(dir, S, 'subagents', 'workflows', 'wf_1', 'agent-w9.jsonl'), '');
    writeFileSync(join(dir, S, 'subagents', 'agent-a1b2c3.jsonl'), [
      { type: 'user', isSidechain: true, timestamp: at(1), message: { role: 'user', content: 'Find them' } },
      { type: 'assistant', isSidechain: true, timestamp: at(2), message: { id: 'h1', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'Found 3 routes' }] } },
    ].map((e) => JSON.stringify(e)).join('\n'));
  });
});

test('readConversation cuts a huge result and says so', () => {
  withTranscript([
    human(0, 'Read it'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }]),
    result(2, 't1', 'x'.repeat(50_000)),
  ], (path) => {
    const tool = readConversation(path, { prices: PRICES }).items.find((i) => i.type === 'tool');
    assert.ok(tool.result.length < 20_000);
    assert.equal(tool.cut, true);
  });
});

test('readConversation reports a version that changes when the file grows', () => {
  withTranscript([human(0, 'Hi')], (path) => {
    const first = readConversation(path, { prices: PRICES }).version;
    writeFileSync(path, `${JSON.stringify(human(0, 'Hi'))}\n${JSON.stringify(assistant(1, 'm1', [{ type: 'text', text: 'Hello' }]))}\n`);
    assert.notEqual(readConversation(path, { prices: PRICES }).version, first);
  });
});

test('an unchanged transcript is not read again: the live mirror asks every 3 s', () => {
  withTranscript([human(0, 'Hi'), assistant(1, 'm1', [{ type: 'text', text: 'Hello' }])], (path) => {
    const first = readConversation(path, { prices: PRICES });
    assert.equal(readConversation(path, { prices: PRICES }).items, first.items, 'same version: the read already made');
    writeFileSync(path, `${JSON.stringify(human(0, 'Hi'))}\n${JSON.stringify(assistant(1, 'm1', [{ type: 'text', text: 'Hello again' }]))}\n`);
    const grown = readConversation(path, { prices: PRICES });
    assert.notEqual(grown.items, first.items);
    assert.equal(grown.items.at(-1).text, 'Hello again');
  });
});

test('a huge step result is cut before it is masked, so reading it stays quick', () => {
  const huge = `DB_PASSWORD=hunter2 ${'aB3x'.repeat(2_000_000)}`;
  withTranscript([
    human(0, 'Dump it'),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat dump' } }]),
    result(2, 't1', huge),
  ], (path) => {
    const started = performance.now();
    const [tool] = readConversation(path, { prices: PRICES }).items.filter((i) => i.type === 'tool');
    const ms = performance.now() - started;
    assert.ok(tool.result.startsWith('DB_PASSWORD=…'), tool.result.slice(0, 40));
    assert.equal(tool.cut, true);
    assert.ok(tool.result.length <= 12_001);
    assert.ok(ms < 250, `took ${Math.round(ms)} ms`);
  });
});

test('toolDetails gives the live chat the same step, diff and task list', () => {
  const edit = toolDetails('Edit', { file_path: '/work/shop/a.ts', old_string: 'a', new_string: 'b' }, '/work/shop');
  assert.deepEqual(edit.step, { kind: 'edit', target: 'a.ts' });
  assert.deepEqual(edit.diff, { path: 'a.ts', hunks: [{ before: 'a', after: 'b' }] });
  const multi = toolDetails('MultiEdit', { file_path: '/x/b.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] }, '/x');
  assert.equal(multi.diff.hunks.length, 2);
  assert.equal(toolDetails('Bash', { command: 'ls' }, '').diff, undefined);
});
