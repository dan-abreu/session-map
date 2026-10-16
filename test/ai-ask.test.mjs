import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_KINDS, ASK_MAX_OUT_TOKENS, FANOUT_MAX, PROMPT_MAX_BYTES, askOthers } from '../server/ai/ask.mjs';
import { AiQueue } from '../server/ai/runner.mjs';
import { emptyHelperState, recordReview } from '../server/ai/review.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { STANCE } from '../server/ai/stance.mjs';
import { REVIEW_SCHEMA } from '../server/ai/contract.mjs';

const NOON = new Date(2026, 9, 9, 12, 0, 0).getTime();
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-ask-'));
const settingsOf = (over = {}) => ({ enabled: true, dailyUSD: 1, off: [], models: {}, keys: ['gemini', 'openai'], ...over });
const keyOf = async (provider) => `sk-${provider}-SECRET0123456789`;

function fakes({ text = (prompt, o) => ({ ok: true, text: `${o.provider} says fine`, costUSD: 0.002, provider: o.provider, model: o.model }), json, delayMs = 0 } = {}) {
  const calls = [];
  const live = { now: 0, peak: 0 };
  const wrap = (answer) => async (prompt, o) => {
    calls.push({ prompt, ...o });
    live.peak = Math.max(live.peak, ++live.now);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    live.now--;
    return answer(prompt, o);
  };
  return {
    calls, live,
    textRun: wrap(text),
    apiRun: wrap(json ?? ((prompt, o) => ({ ok: true, value: { verdict: 'ok' }, costUSD: 0.001, provider: o.provider, model: o.model }))),
  };
}

function setup(over = {}) {
  const smDir = tmp();
  const queue = new AiQueue({ smDir, bin: 'claude', run: async () => ({ ok: true, value: {}, costUSD: 0 }), now: () => NOON });
  const f = fakes(over.fakes);
  const base = { smDir, queue, settings: settingsOf(over.settings), keyOf, stats: [], textRun: f.textRun, apiRun: f.apiRun };
  return { smDir, queue, f, ask: (args) => askOthers({ ...base, ...args }), done: () => rmSync(smDir, { recursive: true, force: true }) };
}

test('the kinds and limits are the agreed ones', () => {
  assert.deepEqual([...ASK_KINDS], ['review', 'bulk', 'code', 'read', 'portuguese', 'reasoning']);
  assert.equal(PROMPT_MAX_BYTES, 200 * 1024);
  assert.ok(ASK_MAX_OUT_TOKENS >= 1024 && ASK_MAX_OUT_TOKENS <= 8192);
  assert.equal(FANOUT_MAX, 4);
});

test('bad asks are refused before any call: kind, privacy class, empty or oversized prompt', async () => {
  const s = setup();
  try {
    assert.deepEqual(await s.ask({ kind: 'poetry', sensitivity: 'public', prompt: 'p' }), { ok: false, error: 'bad-kind', answers: [], skipped: [] });
    assert.equal((await s.ask({ kind: 'review', prompt: 'p' })).error, 'bad-sensitivity', 'the caller must say what the text holds');
    assert.equal((await s.ask({ kind: 'review', sensitivity: 'secret', prompt: 'p' })).error, 'bad-sensitivity');
    assert.equal((await s.ask({ kind: 'review', sensitivity: 'public', prompt: '   ' })).error, 'no-prompt');
    assert.equal((await s.ask({ kind: 'review', sensitivity: 'public', prompt: 42 })).error, 'no-prompt');
    assert.equal((await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'é'.repeat(PROMPT_MAX_BYTES / 2 + 1) })).error, 'prompt-too-big', 'bytes, not characters');
    assert.equal((await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'p', schemaHint: 'x'.repeat(5000) })).error, 'bad-schema');
    assert.equal(s.f.calls.length, 0);
  } finally { s.done(); }
});

test('nothing leaves when the owner switched the other AIs off', async () => {
  const s = setup({ settings: { enabled: false } });
  try {
    assert.deepEqual(await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'p' }), { ok: false, error: 'others-off', answers: [], skipped: [] });
    assert.equal(s.f.calls.length, 0);
  } finally { s.done(); }
});

test('a review of Claude\'s work goes to another family in the review shape (id142), and the answer says who, which model, cost and time', async () => {
  const s = setup();
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'Review this diff' });
    assert.equal(got.ok, true);
    assert.equal(got.answers.length, 1);
    const [a] = got.answers;
    assert.deepEqual({ ...a, ms: 0 }, { provider: 'openai', model: 'gpt-6.1-sol', value: { verdict: 'ok' }, costUSD: 0.001, ms: 0 });
    assert.ok(Number.isFinite(a.ms) && a.ms >= 0);
    assert.equal(s.f.calls[0].prompt, `${STANCE}\n\nReview this diff`, 'a review takes a stance on the facts (or27)');
    assert.equal(s.f.calls[0].key, 'sk-openai-SECRET0123456789');
    assert.equal(s.f.calls[0].maxTokens, ASK_MAX_OUT_TOKENS);
    assert.equal(s.f.calls[0].schemaHint, REVIEW_SCHEMA, 'a review asks for the findings shape unless the caller gave one');
    assert.equal(s.queue.outsideSpentToday(), 0.001, 'booked in the same day\'s spend as the map\'s own work');
    assert.equal(JSON.stringify(got).includes('SECRET'), false, 'never the key');
    assert.ok(got.skipped.some((x) => x.provider === 'deepseek' && x.why === 'no-key'));
  } finally { s.done(); }
});

test('an answer to a JSON shape comes back as a value', async () => {
  const s = setup();
  try {
    const got = await s.ask({ kind: 'bulk', sensitivity: 'internal', prompt: 'label it', schemaHint: '{"verdict": string}' });
    assert.deepEqual(got.answers.map((a) => [a.provider, a.value]), [['openai', { verdict: 'ok' }]]);
    assert.equal(s.f.calls[0].schemaHint, '{"verdict": string}');
    assert.equal('text' in got.answers[0], false);
  } finally { s.done(); }
});

test('any data class may go to DeepSeek: client, internal and public alike', async () => {
  const s = setup({ settings: { keys: ['deepseek'] } });
  try {
    for (const sensitivity of ['client', 'internal', 'public']) {
      const got = await s.ask({ kind: 'code', sensitivity, prompt: `write it ${sensitivity}` });
      assert.equal(got.ok, true, sensitivity);
      assert.deepEqual(got.answers.map((a) => [a.provider, a.model]), [['deepseek', 'deepseek-v4-pro']], sensitivity);
      assert.ok(!got.skipped.some((x) => x.why === 'sensitivity'), sensitivity);
    }
    assert.equal(s.f.calls.length, 3);
  } finally { s.done(); }
});

test('fanout asks several AIs at once, each a different one, for a second opinion or a consensus', async () => {
  const s = setup({ settings: { keys: ['gemini', 'openai', 'deepseek'] }, fakes: { delayMs: 15 } });
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'p', fanout: 3 });
    assert.deepEqual(got.answers.map((a) => a.provider), ['openai', 'gemini', 'deepseek']);
    assert.equal(s.f.live.peak, 3, 'all at the same time');
    const big = await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'q', fanout: 99 });
    assert.equal(big.answers.length, 3, 'never more than there are AIs, nor more than FANOUT_MAX');
  } finally { s.done(); }
});

test('a failed AI is reported by a short code, and the next one in line takes its place', async () => {
  const s = setup({ fakes: { json: (prompt, o) => (o.provider === 'openai' ? { ok: false, error: 'http-500', provider: 'openai' } : { ok: true, value: { verdict: 'fine' }, costUSD: 0.001 }) } });
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'p' });
    assert.deepEqual(got.answers.map((a) => a.provider), ['gemini']);
    assert.ok(got.skipped.some((x) => x.provider === 'openai' && x.why === 'http-500'));
    const thrower = setup({ fakes: { text: () => { throw new Error('the body quoted sk-openai-SECRET0123456789'); } } });
    try {
      const bad = await thrower.ask({ kind: 'reasoning', sensitivity: 'internal', prompt: 'p' });
      assert.equal(bad.ok, false);
      assert.equal(bad.error, 'all-failed');
      assert.equal(JSON.stringify(bad).includes('SECRET'), false);
    } finally { thrower.done(); }
  } finally { s.done(); }
});

test('the one daily cap is checked before each call, with a pessimistic estimate, against the map\'s own spend too', async () => {
  const s = setup({ settings: { dailyUSD: 0.01 } });
  try {
    s.queue.recordSpend('gemini', 0.0099);
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'x'.repeat(10_000) });
    assert.equal(got.ok, false);
    assert.equal(got.error, 'no-ai-available');
    assert.ok(got.skipped.some((x) => x.provider === 'openai' && x.why === 'cap'));
    assert.equal(s.f.calls.length, 0, 'refused before the call, not after');
  } finally { s.done(); }
});

test('an AI the owner switched off, or one paused for disagreeing, is skipped and says why', async () => {
  const s = setup({ settings: { off: ['openai'] } });
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'p' });
    assert.deepEqual(got.answers.map((a) => a.provider), ['gemini']);
    assert.ok(got.skipped.some((x) => x.provider === 'openai' && x.why === 'off'));
  } finally { s.done(); }
  const smDir = tmp();
  try {
    const helper = emptyHelperState();
    for (let i = 0; i < 12; i++) recordReview(helper, 'openai', 'place', false, 'then');
    writeFileSync(join(smDir, 'ai-cache.json'), JSON.stringify({ helper }));
    const queue = new AiQueue({ smDir, bin: 'claude', run: async () => ({ ok: true, value: {}, costUSD: 0 }), now: () => NOON });
    const f = fakes();
    const got = await askOthers({ smDir, queue, settings: settingsOf(), keyOf, stats: [], textRun: f.textRun, apiRun: f.apiRun, kind: 'bulk', sensitivity: 'internal', prompt: 'p' });
    assert.deepEqual(got.answers.map((a) => a.provider), ['gemini'], 'paused on the map\'s bulk work: paused for bulk asks too');
    assert.ok(got.skipped.some((x) => x.provider === 'openai' && x.why === 'paused'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the log says who was asked and what it cost, never the prompt or the answer', async () => {
  const s = setup();
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return typeof rest.at(-1) === 'function' ? (rest.at(-1)(), true) : true; };
  try {
    await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'PROMPT-TEXT-123' });
  } finally { process.stderr.write = original; s.done(); }
  const text = lines.join('');
  assert.match(text, /"event":"ai-ask"/);
  assert.equal(text.includes('PROMPT-TEXT-123'), false);
  assert.equal(text.includes('openai says fine'), false);
});

test('with only smDir it reads session-map\'s own config, saved keys and queue', async () => {
  const smDir = tmp();
  try {
    writeFileSync(join(smDir, 'ai-keys.json'), JSON.stringify({ version: 1, keys: { openai: { scheme: 'fake', data: 'sealed', last4: '6789' } } }));
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { dailyUSD: 0.5 } } }));
    const f = fakes();
    const got = await askOthers({ smDir, keyOf, textRun: f.textRun, apiRun: f.apiRun, kind: 'reasoning', sensitivity: 'internal', prompt: 'think' });
    assert.deepEqual(got.answers.map((a) => [a.provider, a.model]), [['openai', 'gpt-6-astra']]);
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: false } } }));
    assert.equal((await askOthers({ smDir, keyOf, textRun: f.textRun, kind: 'reasoning', sensitivity: 'internal', prompt: 'think' })).error, 'others-off');
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('an ask that times out after leaving is booked against the cap at its estimate, so timeouts cannot spend past it', async () => {
  const { runApiText, estimateCostUSD } = await import('../server/ai/providers.mjs');
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const prompt = 'word '.repeat(30_000);
  const est = estimateCostUSD('openai', 'gpt-6-astra', prompt, ASK_MAX_OUT_TOKENS);
  const s = setup({ settings: { keys: ['openai'], dailyUSD: 1 } });
  let sent = 0;
  const textRun = (p, o) => { sent++; return runApiText(p, { ...o, fetchFn: hang, timeoutMs: 10 }); };
  try {
    for (let i = 0; i < 5; i++) await s.ask({ kind: 'reasoning', sensitivity: 'internal', prompt, textRun });
    assert.equal(sent, Math.floor(1 / est), `only what fits under the $1 cap leaves (estimate $${est})`);
    assert.ok(s.queue.spentToday('openai') >= sent * est - 1e-9);
  } finally { s.done(); }
});

test('an ask whose call threw is booked at its estimate: nobody knows whether it left', async () => {
  const s = setup({ settings: { keys: ['openai'] }, fakes: { json: () => { throw new Error('boom'); } } });
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'x'.repeat(1000) });
    assert.equal(got.ok, false);
    assert.ok(s.queue.spentToday('openai') > 0);
  } finally { s.done(); }
});

test('exclude leaves out the AIs that already failed this work, so the next in line answers, as pick_worker said', async () => {
  const s = setup({ settings: { keys: ['gemini', 'openai'] } });
  try {
    const got = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'p', exclude: ['openai:gpt-6.1-sol'] });
    assert.equal(got.ok, true);
    assert.deepEqual(s.f.calls.map((c) => `${c.provider}:${c.model}`), ['gemini:gemini-3.8-flash'], 'the failed model is not asked again');
    assert.ok(got.skipped.some((x) => x.provider === 'openai' && x.why === 'excluded'));
    const byProvider = await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'q', exclude: ['openai', 'gemini'] });
    assert.equal(byProvider.ok, false);
    assert.equal(byProvider.error, 'no-ai-available');
    assert.equal(s.f.calls.length, 1, 'a provider id leaves out all of its models');
    for (const bad of ['openai', [1], ['x y'], Array.from({ length: 21 }, (_, i) => `openai:m${i}`)]) {
      assert.equal((await s.ask({ kind: 'review', sensitivity: 'internal', prompt: 'p', exclude: bad })).error, 'bad-exclude', JSON.stringify(bad));
    }
    assert.equal(s.f.calls.length, 1);
  } finally { s.done(); }
});

// or27/id107: an outside AI that judges is told to take a stance on the facts, never to please; a draft goes as written.
test('a review or a reasoning ask carries the stance rule before the prompt; a code draft goes as written', async () => {
  const s = setup();
  try {
    await s.ask({ kind: 'review', sensitivity: 'public', prompt: 'Check this diff' });
    assert.ok(s.f.calls[0].prompt.startsWith(STANCE));
    assert.ok(s.f.calls[0].prompt.endsWith('\n\nCheck this diff'));
    await s.ask({ kind: 'reasoning', sensitivity: 'public', prompt: 'Is it sound?' });
    assert.ok(s.f.calls.at(-1).prompt.startsWith(STANCE));
    await s.ask({ kind: 'code', sensitivity: 'public', prompt: 'Write a sum' });
    assert.equal(s.f.calls.at(-1).prompt, 'Write a sum');
  } finally { s.done(); }
});
