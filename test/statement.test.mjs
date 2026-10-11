import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildStatement, chatsCsv, detailCsv, ownWords, planName, priceReply, statementHtml, toolLabel, usageOf } from '../server/statement.mjs';
import { costOf, loadPrices } from '../server/cost.mjs';

const M = 1_000_000;
const prices = {
  'claude-a': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  'claude-h': { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01,
    over100k: { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } },
};
const reply = (over = {}) => ({ model: 'claude-a', input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, webSearch: 0, speed: 'standard', geo: 'global', ...over });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('a reply is priced per part: input, cache write 5m and 1h, cache read, output and web searches', () => {
  const c = priceReply(reply({ input: M, cacheWrite5m: M, cacheWrite1h: M, cacheRead: M, output: M, webSearch: 3 }), prices);
  close(c.input, 4); close(c.cacheWrite, 13); close(c.cacheRead, 0.2); close(c.output, 20); close(c.webSearch, 0.03);
  close(c.total, 37.23);
});

test('fast mode doubles every rate and US-only inference adds 10 %', () => {
  close(priceReply(reply({ output: M, speed: 'fast' }), prices).total, 40);
  close(priceReply(reply({ output: M, geo: 'us' }), prices).total, 22);
});

test('Haiku 5.5 switches to its higher prices only above a 100,000-token prompt', () => {
  close(priceReply(reply({ model: 'claude-h', input: 100_000, output: M }), prices).total, 0.01 + 0.5);
  close(priceReply(reply({ model: 'claude-h', input: 1000, cacheRead: 100_000, output: M }), prices).total, 0.0005 + 0.005 + 2.5);
  close(costOf([{ model: 'claude-h', input: 1000, cacheRead: 100_000, output: M }], prices).usd, 0.0005 + 0.005 + 2.5);
});

test('an unknown model is not priced at zero silently', () => {
  assert.equal(priceReply(reply({ model: 'gpt-x' }), prices), null);
});

test('usage is read from the 5m/1h split when present, else all cache writes count as 5m', () => {
  assert.deepEqual(usageOf({ input_tokens: 2, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 }, cache_read_input_tokens: 7, output_tokens: 5, output_tokens_details: { thinking_tokens: 3 }, server_tool_use: { web_search_requests: 1 } }),
    { input: 2, cacheWrite5m: 0, cacheWrite1h: 10, cacheRead: 7, output: 5, thinking: 3, webSearch: 1 });
  assert.equal(usageOf({ cache_creation_input_tokens: 9 }).cacheWrite5m, 9);
});

test('tool labels name the file or the command', () => {
  assert.equal(toolLabel({ name: 'Read', input: { file_path: 'C:\\dev\\x\\server\\cost.mjs' } }), 'Read …/server\\cost.mjs');
  assert.equal(toolLabel({ name: 'Bash', input: { command: 'ls', description: 'List files' } }), 'Bash List files');
});

test('the shipped prices match the official table checked on 2026-10-11', () => {
  const p = loadPrices();
  assert.equal(p['claude-sonnet-5-5'].cacheRead, 0.1);
  assert.equal(p['claude-opus-5-5'].cacheRead, 0.2);
  assert.equal(p['claude-haiku-5-5'].over100k.input, 0.5);
});

function line(o) { return `${JSON.stringify(o)}\n`; }

test('a statement counts each reply once, keeps what it read and did, and splits the chat from its agents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stmt-'));
  const proj = join(root, 'C--dev-demo');
  mkdirSync(join(proj, 's1', 'subagents'), { recursive: true });
  const at = '2026-10-11T12:00:00.000Z';
  const usage = { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 1000, cache_creation_input_tokens: 0 };
  const main = [
    { type: 'user', cwd: 'C:\\dev\\demo', sessionId: 's1', timestamp: at, message: { role: 'user', content: 'Quanto custou?' } },
    { type: 'assistant', sessionId: 's1', timestamp: at, requestId: 'r1', message: { id: 'm1', model: 'claude-a', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } }], usage } },
    // the same reply again (a second content block), must not count twice
    { type: 'assistant', sessionId: 's1', timestamp: at, requestId: 'r1', message: { id: 'm1', model: 'claude-a', content: [{ type: 'text', text: 'lendo' }], usage } },
    { type: 'user', sessionId: 's1', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'um dois três quatro' }] } },
    { type: 'assistant', sessionId: 's1', timestamp: at, requestId: 'r2', message: { id: 'm2', model: 'claude-a', content: [{ type: 'text', text: 'pronto' }], usage } },
    { type: 'ai-title', aiTitle: 'Conversa de teste', sessionId: 's1' },
  ];
  writeFileSync(join(proj, 's1.jsonl'), main.map(line).join(''));
  writeFileSync(join(proj, 's1', 'subagents', 'agent-x.jsonl'), line({ type: 'assistant', sessionId: 's1', timestamp: at, requestId: 'r3', message: { id: 'm3', model: 'claude-a', content: [], usage } }));
  writeFileSync(join(proj, 's1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Ler o código', model: 'haiku' }));

  const st = await buildStatement({ projectsDir: root, since: 0, prices });
  assert.equal(st.rows.length, 3);
  close(st.total.usd, 3 * (10 * 4 + 1000 * 20) / M);
  const second = st.rows.find((r) => r.key === 'm2');
  assert.equal(second.readWords, 4);
  assert.match(second.readWhat, /Read a\.txt \(4 palavras\)/);
  const chat = st.byChat.get('s1');
  assert.equal(chat.title, 'Conversa de teste');
  assert.equal(chat.project, 'demo');
  assert.deepEqual([...chat.agents.keys()].sort(), ['ajudante: Ler o código', 'conversa principal']);

  const csv = detailCsv(st);
  assert.ok(csv.startsWith('\uFEFFdata;hora;projeto'));
  assert.equal(csv.trim().split('\r\n').length, 4);
  assert.match(chatsCsv(st), /ajudante: Ler o código/);
  assert.match(statementHtml(st, { since: 0, pricesAsOf: '2026-10-11' }), /Extrato de gastos com Claude/);
});

test('a reply written over several lines takes the final counts and a speed given only on a later line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stmt-'));
  const proj = join(root, 'C--dev-demo');
  mkdirSync(proj, { recursive: true });
  const at = '2026-10-11T12:00:00.000Z';
  const first = { type: 'assistant', sessionId: 's2', timestamp: at, message: { id: 'm9', model: 'claude-a', content: [], usage: { input_tokens: 2, output_tokens: 5 } } };
  const last = { type: 'assistant', sessionId: 's2', timestamp: at, requestId: 'r9', message: { id: 'm9', model: 'claude-a', content: [], usage: { input_tokens: 2, output_tokens: 500, speed: 'fast' } } };
  writeFileSync(join(proj, 's2.jsonl'), line(first) + line(last));
  // the same reply copied, partly, into a resumed chat
  writeFileSync(join(proj, 's3.jsonl'), line({ ...first, sessionId: 's3' }));
  const st = await buildStatement({ projectsDir: root, since: 0, prices });
  assert.equal(st.rows.length, 1);
  assert.equal(st.rows[0].output, 500);
  assert.equal(st.rows[0].speed, 'fast');
  close(st.total.usd, 2 * (2 * 4 + 500 * 20) / M);
});

test('a chat opened by session-map is named by the words of the person, not by the context block', () => {
  assert.equal(ownWords('Context from session-map (x)\nWhen you finish a step, run /session-map:board.\n\nquero um extrato'), 'quero um extrato');
  assert.equal(ownWords('quero um extrato'), 'quero um extrato');
});

test('the plan is named the way the person knows it', () => {
  assert.equal(planName('claude_max', 'default_claude_max_20x'), 'Max 20x');
  assert.equal(planName('claude_pro', 'default_claude_pro'), 'Pro');
  assert.equal(planName('something_new', 'tier_x'), 'something_new tier_x');
});
