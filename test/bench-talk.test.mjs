import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARMS, JUDGE_ORDER, armSummary, estimateRunUSD, judgeOf, judgePromptOf, labelsOf, parseJudge, runTalkBench } from '../server/bench/talk.mjs';

// The talk bench (or35): pure helpers and a dry-run. The real run spends money and waits for the owner's OK.

test('labelsOf shuffles the three letters, covering all of them once', () => {
  for (let seed = 0; seed < 50; seed++) {
    const labels = labelsOf(() => (seed * 2654435761 % 4294967296) / 4294967296);
    assert.deepEqual([...labels].sort(), ['A', 'B', 'C']);
  }
});

test('judgeOf keeps only the fixed shape, with a short why', () => {
  assert.deepEqual(judgeOf({ best: 'A', why: 'clear and short' }), { best: 'A', why: 'clear and short', ok: true });
  assert.deepEqual(judgeOf({ best: 'none', why: 'tie' }), { best: 'none', why: 'tie', ok: true });
  assert.equal(judgeOf({ best: 'D', why: 'x' }), null);
  assert.equal(judgeOf({ why: 'x' }), null);
  assert.equal(judgeOf(null), null);
  assert.equal(judgeOf({ best: 'A', why: { } }).why, '', 'a non-string why is dropped, not kept');
});

test('armSummary counts tried and good, and never divides by zero', () => {
  const rows = [
    { ok: true, good: true, costUSD: 0.01 },
    { ok: true, good: false, costUSD: 0.02 },
    { ok: false, good: false, costUSD: 0.03 },
  ];
  const s = armSummary(rows);
  assert.equal(s.tried, 2);
  assert.equal(s.good, 1);
  assert.equal(s.costUSD, 0.06, 'a failed call still cost the arm');
  assert.equal(s.costPerGood, 0.06);
  assert.equal(armSummary([]).costPerGood, null);
  assert.equal(armSummary([{ ok: true, good: false, costUSD: 0 }]).costPerGood, null);
});

test('the judge never comes from DeepSeek or OpenRouter: the messages are the owner\'s own words', () => {
  assert.deepEqual(parseJudge('openai:gpt-6.1-sol'), { provider: 'openai', model: 'gpt-6.1-sol' });
  assert.deepEqual(parseJudge('gemini:gemini-3.8-flash'), { provider: 'gemini', model: 'gemini-3.8-flash' });
  assert.equal(parseJudge('deepseek:deepseek-v4-pro'), null);
  assert.equal(parseJudge('openrouter:deepseek/deepseek-v4.1-flash'), null);
  assert.equal(parseJudge('bad'), null);
  for (const id of JUDGE_ORDER) assert.ok(!['deepseek', 'openrouter'].includes(parseJudge(id).provider), id);
});

test('the judge prompt carries the message and the labeled replies', () => {
  const p = judgePromptOf('uma mensagem', 'A. reply one\n\nB. reply two');
  assert.match(p, /uma mensagem/);
  assert.match(p, /A\. reply one/);
  assert.match(p, /B\. reply two/);
});

test('dry-run plans the calls without asking anyone: 13 items x arms + judges', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-talk-'));
  try {
    const out = await runTalkBench({ smDir, dryRun: true, only: ['sonnet-low', 'split'] }, { keyedProviders: ['openai'] });
    assert.equal(out.dryRun, true);
    assert.equal(out.calls, 13 * 3 + 13, 'two arms, split counts twice, one judge per item');
    assert.equal(out.results.length, 0);
    assert.ok(out.worstUSD > 0, 'the dry-run names the worst the run would cost');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('estimateRunUSD is positive, grows with the arms, and the split arm is the dear one', () => {
  const items = [{ id: 'a', request: 'uma mensagem média do dono sobre o programa, com algumas palavras a mais para medir' }];
  const one = estimateRunUSD(items, ['sonnet-low']);
  const two = estimateRunUSD(items, ['sonnet-low', 'sonnet-medium']);
  const all = estimateRunUSD(items, ARMS);
  assert.ok(one > 0 && two > one && all > two);
  const split = estimateRunUSD(items, ['split']) - estimateRunUSD(items, []);
  assert.ok(split > estimateRunUSD(items, ['sonnet-low']) - estimateRunUSD(items, []), 'the two-call arm costs more than one call');
});

test('the arms are the three agreed ones', () => {
  assert.deepEqual([...ARMS], ['sonnet-low', 'sonnet-medium', 'split']);
});
