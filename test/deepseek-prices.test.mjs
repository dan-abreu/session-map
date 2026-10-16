import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { deepseekCostOf, deepseekPrices, deepseekWindowed, readConversation, readSummary } from '../server/sources/deepseek.mjs';

// The DeepSeek prices in the shape cost.mjs reads: peak rates from the official page (checked 2026-10-14),
// cache reads at the context-cache price. An unknown model anywhere refuses the whole sum (never a wrong number).

const row = (model, fields) => ({ model, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ts: '2026-10-14T12:00:00.000Z', ...fields });

test('the table covers the models the Harness names, with the official peak rates', () => {
  const p = deepseekPrices();
  assert.deepEqual(p['deepseek-flash'], { input: 0.3, output: 1.2, cacheWrite5m: 0.3, cacheWrite1h: 0.3, cacheRead: 0.006 });
  assert.deepEqual(p['deepseek-v4-flash'], { input: 0.3, output: 1.2, cacheWrite5m: 0.3, cacheWrite1h: 0.3, cacheRead: 0.006 });
  assert.deepEqual(p['deepseek-v4-pro'], { input: 1.32, output: 3.96, cacheWrite5m: 1.32, cacheWrite1h: 1.32, cacheRead: 0.044 });
});

test('deepseekCostOf prices input, output and cache reads, and refuses an unknown model', () => {
  const rows = [row('deepseek-v4-pro', { input: 1_000_000, output: 500_000 }), row('deepseek-v4-pro', { cacheRead: 1_000_000 })];
  assert.equal(deepseekCostOf(rows), 1.32 + 3.96 * 0.5 + 0.044);

  assert.equal(deepseekCostOf([row('deepseek-v4-pro', { input: 10 }), row('deepseek-unknown-x', { input: 10 })]), null, 'an unknown model refuses the whole sum');
  assert.equal(deepseekCostOf([]), 0);
});

test('deepseekWindowed splits the sum into today, 7 and 30 days, or refuses when a model is unknown', () => {
  const now = new Date('2026-10-14T15:00:00.000Z');
  const w = deepseekWindowed([row('deepseek-flash', { input: 1_000_000, ts: '2026-10-14T14:00:00.000Z' })], now);
  assert.equal(w.today, 0.3);
  assert.equal(w.d7, 0.3);
  assert.equal(w.d30, 0.3);

  assert.equal(deepseekWindowed([row('deepseek-v4-pro', { input: 10 }), row('some-other-model', { input: 10 })], now), null);
});

// The Harness log carries the model in request/context (the assistant messages have none): the readers pick it up and
// the cost follows at the official prices. A single zstd frame holds the lines, as a real container may.
const session = (id) => ({ type: 'session', version: 4, id, createdAt: Date.now(), cwd: 'C:/dev/shop', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' });
// zstd arrived in Node 22.15: on Node 20 the test that needs it is skipped, and the program says so (zstdAvailable).
const frameOf = (lines) => zlib.zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n')));

test('readSummary and readConversation take the model from request/context and price the usage', { skip: typeof zlib.zstdCompressSync !== 'function' && 'zstd needs Node 22.15' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-dsh-'));
  const path = join(dir, 'session.v4.jsonl.zstd');
  writeFileSync(path, frameOf([
    session('session-abc'),
    { type: 'request/context', time: Date.now(), data: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
    { type: 'assistant/message', time: Date.now(), data: { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 } } },
  ]));
  const s = readSummary(path);
  assert.equal(s.usage[0].model, 'deepseek-v4-pro', 'the model comes from request/context, not the assistant message');
  const expected = (1000 * 1.32 + 100 * 3.96 + 500 * 0.044) / 1e6;
  assert.ok(Math.abs(deepseekCostOf(s.usage) - expected) < 1e-9);
  assert.ok(Math.abs(readConversation(path).costUSD - expected) < 1e-9);
});
