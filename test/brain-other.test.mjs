import test from 'node:test';
import assert from 'node:assert/strict';
import { weighOutside } from '../server/ai/brain-other.mjs';

// The entry brain on another company's AI (id154): the Cérebro's row decides, the daily cap holds, and anything that
// cannot run there answers null so the Claude call goes on.

const settings = (over = {}) => ({ enabled: true, dailyUSD: 1, off: [], keys: ['deepseek', 'openai'], ...over });
const queue = (allow = true) => {
  const settled = [];
  return { settled, reserveOutside: (p, est, cap) => (allow ? { settle: (c) => settled.push([p, c, cap]) } : null) };
};

test('the row\'s AI, model and a level it accepts go to the API; the spend is booked on the ticket', async () => {
  const calls = [];
  const q = queue();
  const apiRun = async (prompt, o) => { calls.push(o); return { ok: true, value: { phase: 'plan' }, costUSD: 0.0004 }; };
  const res = await weighOutside('weigh this', { choice: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'not-a-level' }, schemaHint: '{}', apiRun, keyOf: async () => 'k', queue: q, settings: settings() });
  assert.deepEqual(res.value, { phase: 'plan' });
  assert.equal(calls[0].provider, 'deepseek');
  assert.equal(calls[0].model, 'deepseek-v4-pro');
  assert.equal(calls[0].key, 'k');
  assert.equal('effort' in calls[0], false, 'a level the model does not accept is not sent');
  assert.deepEqual(q.settled, [['deepseek', 0.0004, 1]]);
});

test('Claude, auto, no key, switched off, the cap or a failure: null, and the caller keeps its Claude call', async () => {
  const ok = async () => ({ ok: true, value: {} });
  const base = { apiRun: ok, keyOf: async () => 'k', queue: queue(), settings: settings() };
  assert.equal(await weighOutside('p', { ...base, choice: { provider: 'claude' } }), null);
  assert.equal(await weighOutside('p', { ...base, choice: { provider: 'auto' } }), null);
  assert.equal(await weighOutside('p', { ...base, choice: null }), null);
  assert.equal(await weighOutside('p', { ...base, choice: { provider: 'gemini' } }), null, 'no key saved for it');
  assert.equal(await weighOutside('p', { ...base, settings: settings({ off: ['deepseek'] }), choice: { provider: 'deepseek' } }), null);
  assert.equal(await weighOutside('p', { ...base, settings: settings({ enabled: false }), choice: { provider: 'deepseek' } }), null);
  assert.equal(await weighOutside('p', { ...base, keyOf: async () => null, choice: { provider: 'deepseek' } }), null);
  assert.equal(await weighOutside('p', { ...base, queue: queue(false), choice: { provider: 'deepseek' } }), null, 'over the daily cap');
  const q = queue();
  assert.equal(await weighOutside('p', { ...base, queue: q, apiRun: async () => { throw new Error('sk-SECRET'); }, choice: { provider: 'deepseek' } }), null);
  assert.equal(q.settled.length, 1, 'a call that threw is booked at its estimate');
  assert.equal(await weighOutside('p', { ...base, apiRun: async () => ({ ok: false, error: 'http-500' }), choice: { provider: 'deepseek' } }), null);
});
