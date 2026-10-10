// Who takes part in the bench (or12), what each may see, what a call may cost at worst, and how a call is made.
// No real model is ever called here: the runners are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { allowedFor, contestantsFor, estimateUSD, makeCaller, parseContestant, selectContestants } from '../server/bench/contestants.mjs';

test('the three Claude levels always take part, then each keyed provider with its default and mid model', () => {
  const ids = contestantsFor(['openai', 'gemini', 'deepseek', 'openrouter']).map((c) => c.id);
  assert.deepEqual(ids, [
    'claude:haiku', 'claude:sonnet', 'claude:opus',
    'deepseek:deepseek-flash', 'deepseek:deepseek-v4-pro',
    'gemini:gemini-3.1-flash-lite', 'gemini:gemini-3.8-flash',
    'openai:gpt-6-luna', 'openai:gpt-6.1-sol',
    'openrouter:deepseek/deepseek-v4.1-flash',
  ]);
  assert.deepEqual(contestantsFor([]).map((c) => c.id), ['claude:haiku', 'claude:sonnet', 'claude:opus']);
  assert.deepEqual(contestantsFor(['nobody']).length, 3);
});

test('a contestant id splits at the first colon, so OpenRouter models keep their slash', () => {
  assert.deepEqual(parseContestant('openrouter:google/gemini-2.5-flash-lite'), { id: 'openrouter:google/gemini-2.5-flash-lite', via: 'api', provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' });
  assert.deepEqual(parseContestant('claude:opus'), { id: 'claude:opus', via: 'claude', provider: 'claude', model: 'opus' });
  assert.equal(parseContestant('nonsense'), null);
});

test('--only keeps the order of the full list and names what it could not find', () => {
  const all = contestantsFor(['openai']);
  const { chosen, missing } = selectContestants(all, ['openai:gpt-6-luna', 'claude:haiku', 'gemini:gemini-3.8-flash']);
  assert.deepEqual(chosen.map((c) => c.id), ['claude:haiku', 'openai:gpt-6-luna']);
  assert.deepEqual(missing, ['gemini:gemini-3.8-flash']);
  assert.equal(selectContestants(all, null).chosen.length, all.length);
});

test('DeepSeek never sees the owner\'s own conversations unless asked for', () => {
  const ds = parseContestant('deepseek:deepseek-flash');
  assert.equal(allowedFor(ds, 'classify'), false);
  assert.equal(allowedFor(ds, 'classify', { allowDeepseekPersonal: true }), true);
  assert.equal(allowedFor(ds, 'code'), true);
  assert.equal(allowedFor(parseContestant('openrouter:deepseek/deepseek-v4.1-flash'), 'classify'), true);
  assert.equal(allowedFor(parseContestant('claude:haiku'), 'classify'), true);
});

test('the worst-case estimate covers the longest answer an outside AI may give', () => {
  const luna = parseContestant('openai:gpt-6-luna');
  const est = estimateUSD(luna, 'x'.repeat(4000));
  // 4000 characters read as up to 2000 tokens in, 1024 out at 0.1 / 0.5 per million.
  assert.ok(est >= (2000 * 0.1 + 1024 * 0.5) / 1e6, `too low: ${est}`);
  const unknown = estimateUSD(parseContestant('openai:some-future-model'), 'hi');
  assert.ok(unknown > est);
});

test('a Claude estimate starts from a cautious guess, then follows what calls really cost, with a margin', () => {
  const opus = parseContestant('claude:opus');
  const haiku = parseContestant('claude:haiku');
  assert.ok(estimateUSD(opus, 'hi') > estimateUSD(haiku, 'hi'));
  assert.equal(estimateUSD(haiku, 'hi', [0.01, 0.02]), 0.03);
  // An outside AI whose real bill came higher than the token estimate is estimated from that bill.
  assert.ok(estimateUSD(parseContestant('openai:gpt-6-luna'), 'hi', [1]) >= 1.5);
});

test('a Claude call goes through the hidden runner folder with the level as model', async () => {
  const seen = [];
  const runClaude = async (prompt, opts) => { seen.push({ prompt, ...opts }); return { ok: true, value: { partId: 'a' }, costUSD: 0.01 }; };
  const call = makeCaller({ smDir: '/sm', runClaude, runApi: () => assert.fail('no outside call'), getKeyFn: () => assert.fail('no key') });
  const r = await call(parseContestant('claude:sonnet'), 'the prompt', '{"partId": "..."}');
  assert.deepEqual(r, { ok: true, value: { partId: 'a' }, costUSD: 0.01, error: null });
  assert.equal(seen[0].model, 'sonnet');
  assert.equal(seen[0].cwd, join('/sm', 'ai-runner', 'bench'));
  assert.equal(seen[0].schemaHint, '{"partId": "..."}');
});

test('an outside call gets its key from the store, and the key never appears in the result', async () => {
  const seen = [];
  const runApi = async (prompt, opts) => { seen.push(opts); return { ok: false, error: 'http-401', provider: 'openai', costUSD: 0, echo: opts.key }; };
  const call = makeCaller({ smDir: '/sm', runClaude: () => assert.fail('no claude'), runApi, getKeyFn: async (dir, provider) => (provider === 'openai' ? 'sk-secret-123' : null) });
  const r = await call(parseContestant('openai:gpt-6.1-sol'), 'p', '{}');
  assert.equal(seen[0].key, 'sk-secret-123');
  assert.equal(seen[0].model, 'gpt-6.1-sol');
  assert.equal(seen[0].provider, 'openai');
  assert.ok(!JSON.stringify(r).includes('sk-secret'));
  assert.deepEqual(r, { ok: false, value: null, costUSD: 0, error: 'http-401' });
  const none = await call(parseContestant('gemini:gemini-3.8-flash'), 'p', '{}');
  assert.deepEqual(none, { ok: false, value: null, costUSD: 0, error: 'no-key' });
});

test('a runner that throws is a failed answer, not a crashed bench', async () => {
  const call = makeCaller({ smDir: '/sm', runClaude: async () => { throw new Error('boom'); } });
  assert.deepEqual(await call(parseContestant('claude:haiku'), 'p'), { ok: false, value: null, costUSD: 0, error: 'crashed' });
});

test('a longer prompt than the ones seen is estimated by the dearest cost per character, not by the last bill', () => {
  const haiku = parseContestant('claude:haiku');
  // A 100-character call cost 0.001: a 100,000-character prompt may cost a thousand times that.
  const est = estimateUSD(haiku, 'x'.repeat(100_000), [{ costUSD: 0.001, chars: 100 }]);
  assert.ok(est >= 1, `too low: ${est}`);
  // A prompt no longer than the ones seen keeps the old rule: the dearest bill with a margin.
  assert.equal(estimateUSD(haiku, 'x'.repeat(50), [{ costUSD: 0.01, chars: 100 }, { costUSD: 0.02, chars: 100 }]), 0.03);
  // A very long first prompt is not priced at the flat first guess.
  assert.ok(estimateUSD(haiku, 'x'.repeat(200_000)) > estimateUSD(haiku, 'hi') * 5);
});

test('an outside call asks for room enough for a whole module or hidden reasoning, and the estimate prices that room', async () => {
  const seen = [];
  const runApi = async (prompt, opts) => { seen.push(opts); return { ok: false, error: 'http-500', costUSD: 0 }; };
  const call = makeCaller({ smDir: '/sm', runClaude: () => assert.fail('no claude'), runApi, getKeyFn: async () => 'k' });
  await call(parseContestant('deepseek:deepseek-flash'), 'p', '{}');
  assert.equal(seen[0].maxTokens, 8192);
  const est = estimateUSD(parseContestant('openai:gpt-6.1-sol'), 'x'.repeat(4000));
  assert.ok(est >= (2000 * 0.1 + 8192 * 0.5) / 1e6, `too low: ${est}`);
  // Sol is also given room to reason on top of the answer: the estimate prices every token the call may bill.
  assert.ok(est >= (2000 * 2 + (8192 + 1024) * 10) / 1e6, `the reasoning room is left out: ${est}`);
});
