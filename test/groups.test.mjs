import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_IDS, activeGroupOf, mergeGroups, applyGroup, publicGroups } from '../server/ai/groups.mjs';

// Working groups (2026-10-14): the owner picks how the arsenal behaves; the group re-orders the router's candidates
// without breaking its rules (same-family review, sensitivity, measured accuracy).

const cand = (provider, model, family = provider) => ({ provider, model, family, why: 'test' });

test('activeGroupOf reads the choice and refuses unknown ids', () => {
  assert.equal(activeGroupOf({ others: { groups: { active: 'economia' } } }), 'economia');
  assert.equal(activeGroupOf({ others: { groups: { active: 'nada' } } }), null);
  assert.equal(activeGroupOf({ others: {} }), null);
  assert.equal(activeGroupOf(null), null);
});

test('mergeGroups writes and removes the choice, and keeps the rest of ai.others', () => {
  const ai = { others: { enabled: true, dailyUSD: 5, groups: { active: 'qualidade' } } };
  assert.deepEqual(mergeGroups(ai, { active: 'economia' }).others, { enabled: true, dailyUSD: 5, groups: { active: 'economia' } });
  assert.deepEqual(mergeGroups(ai, { active: null }).others, { enabled: true, dailyUSD: 5 });
  assert.deepEqual(mergeGroups(ai, { nope: 1 }).others, { enabled: true, dailyUSD: 5, groups: { active: 'qualidade' } });
  assert.deepEqual(mergeGroups(null, { active: 'lgpd' }).others, { groups: { active: 'lgpd' } });
});

test('economia puts the cheap providers first, the routed rest last', () => {
  const list = [cand('claude', 'haiku'), cand('openai', 'gpt-6-luna'), cand('deepseek', 'deepseek-flash'), cand('gemini', 'gemini-3.1-flash-lite'), cand('openrouter', 'deepseek/deepseek-v4.1-flash')];
  const { candidates, skipped } = applyGroup(list, 'economia', { kind: 'bulk' });
  assert.deepEqual(candidates.map((c) => c.provider), ['deepseek', 'openrouter', 'openai', 'gemini', 'claude']);
  assert.deepEqual(skipped, []);
  // A provider the group does not know keeps its routed place at the end.
  const withNew = applyGroup([...list, cand('openai', 'gpt-6-luna'), cand('novo', 'x')], 'economia', { kind: 'bulk' });
  assert.equal(withNew.candidates.at(-1).provider, 'novo');
});

test('lgpd drops DeepSeek and reports it', () => {
  const { candidates, skipped } = applyGroup([cand('claude', 'sonnet'), cand('deepseek', 'deepseek-v4-pro'), cand('openai', 'gpt-6.1-sol')], 'lgpd', { kind: 'code' });
  assert.deepEqual(candidates.map((c) => c.provider), ['claude', 'openai']);
  assert.deepEqual(skipped, [{ provider: 'deepseek', model: 'deepseek-v4-pro', why: 'group-lgpd' }]);
});

test('a review keeps the other family first, ordered by the group within each bucket', () => {
  const list = [cand('claude', 'opus', 'anthropic'), cand('openai', 'gpt-6.1-sol', 'openai'), cand('gemini', 'gemini-3.8-flash', 'google'), cand('deepseek', 'deepseek-v4-pro', 'deepseek')];
  const { candidates } = applyGroup(list, 'economia', { kind: 'review', authorFamily: 'anthropic' });
  assert.deepEqual(candidates.map((c) => c.provider), ['openai', 'gemini', 'deepseek', 'claude']);
  // Without a known author, the plain group order decides.
  const plain = applyGroup(list, 'economia', { kind: 'review' });
  assert.deepEqual(plain.candidates.map((c) => c.provider), ['openai', 'gemini', 'deepseek', 'claude']);
});

test('qualidade and sobrevivencia keep the routed order; an unknown group keeps it too', () => {
  const list = [cand('claude', 'sonnet'), cand('openai', 'gpt-6.1-sol'), cand('gemini', 'gemini-3.8-flash')];
  assert.deepEqual(applyGroup(list, 'qualidade', { kind: 'code' }).candidates, list);
  assert.deepEqual(applyGroup(list, 'sobrevivencia', { kind: 'bulk' }).candidates, list);
  assert.deepEqual(applyGroup(list, 'nada', { kind: 'bulk' }).candidates, list);
  assert.deepEqual(applyGroup(null, 'economia', {}).candidates, []);
});

test('publicGroups exposes the four ids with a line each', () => {
  const groups = publicGroups();
  assert.deepEqual(groups.map((g) => g.id), GROUP_IDS);
  for (const g of groups) assert.ok(g.why.length > 3);
});
