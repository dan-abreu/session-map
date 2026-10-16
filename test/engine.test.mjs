import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_PREFERENCE, BRAIN_PREFERENCE, ENGINE_FUNCTIONS, enginesOf, mergeEngines, resolveEngine } from '../server/ai/engine.mjs';

// The per-function engine choice (id123): 'auto' or one of the person's AIs, decided by scripts, never by a prompt.

test('enginesOf reads the choices and refuses broken values', () => {
  assert.deepEqual(enginesOf(null), { brain: 'auto', background: 'auto' });
  assert.deepEqual(enginesOf({ others: {} }), { brain: 'auto', background: 'auto' });
  assert.deepEqual(enginesOf({ others: { engines: { brain: 'openai', background: 'deepseek' } } }), { brain: 'openai', background: 'deepseek' });
  assert.deepEqual(enginesOf({ others: { engines: { brain: 'nada', background: 3 } } }), { brain: 'auto', background: 'auto' });
});

test('mergeEngines writes, keeps and removes the choices', () => {
  const ai = { others: { enabled: true, engines: { brain: 'claude' } } };
  assert.deepEqual(mergeEngines(ai, { background: 'gemini' }).others.engines, { brain: 'claude', background: 'gemini' });
  assert.deepEqual(mergeEngines(ai, { brain: 'auto' }).others.engines, undefined);
  assert.deepEqual(mergeEngines(ai, {}).others.engines, { brain: 'claude' });
  assert.deepEqual(mergeEngines(null, { brain: 'deepseek' }).others.engines, { brain: 'deepseek' });
});

test('an explicit choice wins when available and falls back with a reason when not', () => {
  const available = ['claude', 'openai', 'gemini'];
  assert.deepEqual(resolveEngine('gemini', { available, preference: BRAIN_PREFERENCE }), { id: 'gemini', why: 'choice' });
  assert.deepEqual(resolveEngine('deepseek', { available, preference: BRAIN_PREFERENCE }), { id: 'claude', why: 'choice-unavailable' });
  assert.deepEqual(resolveEngine('deepseek', { available: [], preference: BRAIN_PREFERENCE }), { id: null, why: 'none' });
  assert.deepEqual(resolveEngine('deepseek', { available: [], preference: BRAIN_PREFERENCE, fallback: 'claude' }), { id: 'claude', why: 'none' });
});

test('auto takes the preference: the measured first, swapping by itself when it is gone', () => {
  const all = ['claude', 'openai', 'gemini', 'deepseek'];
  assert.deepEqual(resolveEngine('auto', { available: all, preference: BRAIN_PREFERENCE }), { id: 'claude', why: 'auto' });
  assert.deepEqual(resolveEngine('auto', { available: all, preference: BACKGROUND_PREFERENCE }), { id: 'claude', why: 'auto' });
  assert.deepEqual(resolveEngine('auto', { available: ['gemini'], preference: BACKGROUND_PREFERENCE }), { id: 'gemini', why: 'auto' });
  assert.deepEqual(resolveEngine('auto', { available: [], preference: BACKGROUND_PREFERENCE }), { id: null, why: 'none' });
});

test('the preferences cover every provider and both functions are known', () => {
  assert.deepEqual(ENGINE_FUNCTIONS, ['brain', 'background']);
  for (const p of [...BRAIN_PREFERENCE, ...BACKGROUND_PREFERENCE]) assert.ok(p === 'claude' || ['openai', 'gemini', 'deepseek', 'openrouter'].includes(p), p);
});
