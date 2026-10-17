import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_UNION, LEVELS_BY_PROVIDER, effortBody, levelsOf, topLevelOf } from '../server/ai/efforts.mjs';

// Each engine names its reasoning levels differently (or41): one mechanical table feeds the selectors, the validator
// and the API call of every provider. Ultracode is Claude Code's own setting, not max.

test('each engine names its own levels', () => {
  assert.deepEqual(LEVELS_BY_PROVIDER.claude, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(LEVELS_BY_PROVIDER.deepseek, ['off', 'low', 'high', 'max']);
  assert.deepEqual(LEVELS_BY_PROVIDER.openai, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(LEVELS_BY_PROVIDER.gemini, ['minimal', 'low', 'medium', 'high']);
  assert.ok(LEVEL_UNION.includes('off') && LEVEL_UNION.includes('xhigh') && LEVEL_UNION.includes('ultracode'));
});

test('levelsOf refines by model and falls back to the provider', () => {
  // id179: the docs give the 5.5 family and Fable 5.1 all five levels.
  assert.deepEqual(levelsOf('claude', 'haiku'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('claude', 'sonnet'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('claude', 'opus'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('claude', 'fable'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('deepseek', 'deepseek-v4-pro'), ['off', 'low', 'high', 'max']);
  assert.deepEqual(levelsOf('deepseek', 'deepseek-flash'), ['off', 'low', 'high', 'max'], 'DeepSeek\'s own /models gives its Flash max (id179)');
  assert.deepEqual(levelsOf('openai', 'gpt-6-luna'), ['none'], 'measured 2026-10-14: Luna refuses low');
  assert.deepEqual(levelsOf('openai', 'gpt-6.1-sol'), ['low', 'medium', 'high', 'xhigh'], 'measured: Sol refuses max');
  assert.deepEqual(levelsOf('openai', 'gpt-6-astra'), ['low', 'medium', 'high', 'xhigh'], 'measured: Astra refuses minimal');
  assert.deepEqual(levelsOf('gemini', 'gemini-3.1-flash-lite'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-3.8-flash'), ['low', 'medium', 'high'], '3.8 Flash refuses minimal');
  assert.deepEqual(levelsOf('openai', 'unknown-model'), LEVELS_BY_PROVIDER.openai);
  assert.deepEqual(levelsOf('openrouter', 'x'), ['auto']);
});

test("the separate switch is Claude's ultracode only: the maximum of any AI is one more level of its list (id168)", () => {
  assert.equal(topLevelOf('claude', 'sonnet'), 'ultracode');
  assert.equal(topLevelOf('claude', 'haiku'), 'ultracode', 'Haiku 5.5 reaches xhigh and runs ultracode (get_settings, 2026-10-17)');
  assert.equal(topLevelOf('deepseek', 'deepseek-v4-pro'), null, 'max is in the list of levels, not a button beside it');
  assert.ok(levelsOf('deepseek', 'deepseek-v4-pro').includes('max'));
  assert.equal(topLevelOf('openai', 'gpt-6.1-sol'), null, 'measured: Sol refuses max');
  assert.equal(topLevelOf('gemini', 'gemini-3.8-flash'), null, 'Gemini\'s top stays in the list');
});

test('effortBody maps each engine to its own request field', () => {
  assert.deepEqual(effortBody('deepseek', 'deepseek-v4-pro', 'off').body, { thinking: { type: 'disabled' } });
  assert.deepEqual(effortBody('deepseek', 'deepseek-v4-pro', 'high').body, { thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  assert.deepEqual(effortBody('deepseek', 'deepseek-v4-pro', 'max').body, { thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  assert.deepEqual(effortBody('openai', 'gpt-6.1-sol', 'none').body, { reasoning_effort: 'none' });
  assert.deepEqual(effortBody('openai', 'gpt-6.1-sol', 'minimal').body, { reasoning_effort: 'minimal' });
  assert.deepEqual(effortBody('openai', 'gpt-6.1-sol', 'xhigh').body, { reasoning_effort: 'xhigh' });
  assert.deepEqual(effortBody('gemini', 'gemini-3.8-flash', 'minimal'), { body: { reasoning_effort: 'minimal' }, reasoningRoomTokens: 1024 });
  assert.deepEqual(effortBody('gemini', 'gemini-3.8-flash', 'high'), { body: { reasoning_effort: 'high' }, reasoningRoomTokens: 4096 });
  assert.deepEqual(effortBody('claude', 'sonnet', 'xhigh'), {}, 'Claude levels go through its CLI, never here');
  assert.deepEqual(effortBody('deepseek', 'deepseek-v4-pro', 'nada'), {}, 'an unknown level never reaches a provider');
});
