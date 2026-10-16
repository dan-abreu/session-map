import test from 'node:test';
import assert from 'node:assert/strict';
import { agentCallsOfLine, summarizeAgentCalls } from '../server/ai/agent-usage.mjs';

// The number the specialist work has to push down (id158, or68): the share of agent calls that went to the generic agent.

const line = (...inputs) => JSON.stringify({ message: { content: inputs.map((input) => ({ type: 'tool_use', name: 'Agent', input })) } });

test('the calls of a transcript line, and nothing from lines that are not agent calls', () => {
  const calls = agentCallsOfLine(line({ subagent_type: 'general-purpose', description: '[debug] x', model: 'sonnet' }, { description: 'no type' }));
  assert.deepEqual(calls, [{ type: 'general-purpose', description: '[debug] x', model: 'sonnet' }, { type: '', description: 'no type', model: null }]);
  assert.deepEqual(agentCallsOfLine('{"message":{"content":"hi"}}'), []);
  assert.deepEqual(agentCallsOfLine('not json "Agent"'), []);
});

test('the shares: generic, specialist and tagged, with the types and models behind them', () => {
  const s = summarizeAgentCalls([
    { type: 'general-purpose', description: '[code] a', model: 'sonnet' },
    { type: '', description: 'plain', model: null },
    { type: 'sm-flow', description: '[code] b', model: null },
    { type: 'Plan', description: 'plan', model: 'opus' },
  ]);
  assert.deepEqual([s.total, s.generic, s.genericPct, s.specialist, s.specialistPct, s.tagged, s.taggedPct], [4, 2, 50, 1, 25, 2, 50]);
  assert.deepEqual(s.byType, { 'general-purpose': 2, 'sm-flow': 1, Plan: 1 });
  assert.deepEqual(s.byModel, { sonnet: 1, inherit: 2, opus: 1 });
  assert.equal(summarizeAgentCalls([]).genericPct, 0);
});
