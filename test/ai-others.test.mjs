import test from 'node:test';
import assert from 'node:assert/strict';
import { OTHERS_DAILY_USD_DEFAULT, othersConfig, othersSettings } from '../server/ai/others.mjs';

test('without any setting, the other AIs are on as soon as a key exists, with a one-dollar day for all of them', () => {
  assert.equal(OTHERS_DAILY_USD_DEFAULT, 1);
  assert.deepEqual(othersSettings(undefined, []), { enabled: false, dailyUSD: 1, off: [], models: {}, keys: [] });
  assert.deepEqual(othersSettings({}, ['gemini', 'openai']), { enabled: true, dailyUSD: 1, off: [], models: {}, keys: ['gemini', 'openai'] });
  assert.deepEqual(othersSettings({}, ['nope', 'gemini', 'gemini']).keys, ['gemini'], 'unknown and repeated providers are dropped');
});

test('ai.others is read as written, with bad values replaced by safe ones', () => {
  const ai = { others: { enabled: false, dailyUSD: 2.5, off: ['deepseek', 'nope', 'deepseek'], models: { openrouter: 'google/gemini-2.5-flash-lite', nope: 'x', openai: 'a b;c' } } };
  assert.deepEqual(othersSettings(ai, ['deepseek']), { enabled: false, dailyUSD: 2.5, off: ['deepseek'], models: { openrouter: 'google/gemini-2.5-flash-lite' }, keys: ['deepseek'] });
  assert.equal(othersSettings({ others: { dailyUSD: -1 } }, []).dailyUSD, 1);
  assert.equal(othersSettings({ others: { dailyUSD: 'a lot' } }, []).dailyUSD, 1);
  assert.equal(othersSettings({ others: { dailyUSD: 0 } }, []).dailyUSD, 0, 'zero is a real choice: nothing outside today');
  assert.equal(othersSettings({ others: {} }, ['gemini']).enabled, true, 'no explicit choice: on with a key');
  assert.equal(othersSettings({ others: 'yes' }, ['gemini']).enabled, true);
});

test('the old single-helper settings are still read: its switch and its cap', () => {
  const on = othersSettings({ helper: { provider: 'gemini', enabled: true }, helperDailyUSD: 1000 }, ['gemini', 'deepseek']);
  assert.deepEqual(on, { enabled: true, dailyUSD: 1000, off: [], models: {}, keys: ['deepseek', 'gemini'] }, 'every keyed AI is used now, not only the old helper');
  const off = othersSettings({ helper: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', enabled: false }, helperDailyUSD: 0.25 }, ['openrouter']);
  assert.deepEqual(off, { enabled: false, dailyUSD: 0.25, off: [], models: {}, keys: ['openrouter'] }, '"Claude only" stays a choice');
  assert.equal(othersSettings({ helper: { provider: 'nope', enabled: false } }, ['gemini']).enabled, true, 'a broken old choice is no choice');
  const both = othersSettings({ helper: { provider: 'gemini', enabled: false }, helperDailyUSD: 9, others: { enabled: true, dailyUSD: 3 } }, ['gemini']);
  assert.equal(both.enabled, true, 'ai.others wins');
  assert.equal(both.dailyUSD, 3);
});

test('othersConfig rewrites ai into the new shape and drops the old fields, keeping the rest', () => {
  const ai = { enabled: true, model: 'haiku', maxCallsPerHour: 30, helper: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', enabled: true }, helperDailyUSD: 1000 };
  assert.deepEqual(othersConfig(ai, ['openrouter']), {
    enabled: true, model: 'haiku', maxCallsPerHour: 30,
    others: { enabled: true, dailyUSD: 1000, off: [] },
  });
  assert.deepEqual(othersConfig(undefined, []), { others: { dailyUSD: 1, off: [] } }, 'no choice made: none written, so a key added later switches them on');
  assert.deepEqual(othersConfig({ others: { enabled: true, dailyUSD: 2 } }, [], { off: ['gemini'], dailyUSD: 0.5 }).others, { enabled: true, dailyUSD: 0.5, off: ['gemini'] }, 'a patch from the page goes on top');
});

test('a model pinned in the old single-helper dialog is not carried over: the router picks the models now', () => {
  assert.deepEqual(othersSettings({ helper: { provider: 'openai', model: 'gpt-6.1-sol', enabled: true }, helperDailyUSD: 0.5 }, ['openai']).models, {});
  assert.equal(othersConfig({ helper: { provider: 'openai', model: 'gpt-6.1-sol', enabled: true } }, ['openai']).others.models, undefined);
});
