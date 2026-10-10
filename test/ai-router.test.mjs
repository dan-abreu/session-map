import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TABLE, ROUTE_KINDS, SENSITIVITIES, explainRoute, familyOf, loadStats, route, routeKindOf, routingFile, spread } from '../server/ai/router.mjs';

const ALL = ['claude', 'openai', 'gemini', 'deepseek', 'openrouter'];
const ids = (list) => list.map((c) => `${c.provider}:${c.model}`);

test('the kinds and privacy classes are the agreed ones, and old names map onto them', () => {
  assert.deepEqual([...ROUTE_KINDS], ['bulk', 'review', 'code', 'read', 'portuguese', 'reasoning']);
  assert.deepEqual([...SENSITIVITIES], ['public', 'internal', 'client']);
  assert.equal(routeKindOf('place'), 'bulk');
  assert.equal(routeKindOf('classify'), 'bulk');
  assert.equal(routeKindOf('pt'), 'portuguese');
  assert.equal(routeKindOf('code'), 'code');
  assert.equal(routeKindOf('nope'), null);
  for (const kind of ROUTE_KINDS) assert.ok(DEFAULT_TABLE[kind].length >= 2, kind);
});

test('familyOf names the company behind a model, OpenRouter by the model it reaches', () => {
  assert.equal(familyOf('claude', 'haiku'), 'anthropic');
  assert.equal(familyOf('openai', 'gpt-6.1-sol'), 'openai');
  assert.equal(familyOf('gemini', 'gemini-3.8-flash'), 'google');
  assert.equal(familyOf('deepseek', 'deepseek-flash'), 'deepseek');
  assert.equal(familyOf('openrouter', 'deepseek/deepseek-v4.1-flash'), 'deepseek');
  assert.equal(familyOf('openrouter', 'google/gemini-2.5-flash-lite'), 'google');
  assert.equal(familyOf('openrouter', 'anthropic/claude-haiku'), 'anthropic');
  assert.equal(familyOf('openrouter', 'meta-llama/llama-5'), 'meta-llama');
});

test('bulk work: Claude haiku first, then the cheap models of the others, in the agreed order', () => {
  assert.deepEqual(ids(route({ kind: 'bulk', sensitivity: 'public', available: ALL })), [
    'claude:haiku', 'openai:gpt-6-luna', 'gemini:gemini-3.1-flash-lite', 'deepseek:deepseek-flash', 'openrouter:deepseek/deepseek-v4.1-flash',
  ]);
  const luna = route({ kind: 'bulk', sensitivity: 'public', available: ['openai'] })[0];
  assert.match(luna.note, /guess/i, 'Luna guesses: its answers are always checked');
  assert.equal(typeof luna.why, 'string');
});

test('DeepSeek, direct or through OpenRouter, never gets internal or client data', () => {
  for (const kind of ROUTE_KINDS) {
    for (const sensitivity of ['internal', 'client']) {
      const got = route({ kind, sensitivity, available: ALL });
      assert.equal(got.some((c) => c.family === 'deepseek'), false, `${kind}/${sensitivity}`);
    }
  }
  assert.ok(route({ kind: 'code', sensitivity: 'public', available: ALL }).some((c) => c.provider === 'deepseek'));
  const { skipped } = explainRoute({ kind: 'bulk', sensitivity: 'client', available: ALL });
  assert.ok(skipped.some((s) => s.provider === 'deepseek' && s.why === 'sensitivity'));
});

test('an unknown privacy class is treated as the strictest one', () => {
  assert.equal(route({ kind: 'bulk', sensitivity: 'whatever', available: ALL }).some((c) => c.family === 'deepseek'), false);
  assert.equal(route({ kind: 'bulk', available: ALL }).some((c) => c.family === 'deepseek'), false);
});

test('a review comes from another family than the author: Sol for Claude\'s work, Opus for another AI\'s', () => {
  const ofClaude = route({ kind: 'review', sensitivity: 'internal', author: 'claude', available: ALL });
  assert.equal(ids(ofClaude)[0], 'openai:gpt-6.1-sol');
  assert.equal(ofClaude.some((c) => c.family === 'anthropic'), false);
  assert.deepEqual(ids(route({ kind: 'review', sensitivity: 'internal', available: ALL })), ids(ofClaude), 'no author: the conductor, Claude, wrote it');
  const ofOpenai = route({ kind: 'review', sensitivity: 'internal', author: 'openai', available: ALL });
  assert.equal(ids(ofOpenai)[0], 'claude:opus');
  assert.equal(ofOpenai.some((c) => c.family === 'openai'), false);
  assert.ok(ids(ofOpenai).includes('gemini:gemini-3.8-flash'));
  const ofGemini = route({ kind: 'review', sensitivity: 'public', author: 'openrouter:google/gemini-2.5-flash-lite', available: ALL });
  assert.equal(ofGemini.some((c) => c.family === 'google'), false);
  assert.ok(ids(ofGemini).includes('deepseek:deepseek-v4-pro'), 'public code may go to DeepSeek');
  const { skipped } = explainRoute({ kind: 'review', sensitivity: 'internal', author: 'claude', available: ALL });
  assert.ok(skipped.some((s) => s.provider === 'claude' && s.why === 'same-family'));
});

test('code, long reading, Portuguese and hard reasoning follow the research table', () => {
  assert.deepEqual(ids(route({ kind: 'code', sensitivity: 'public', available: ALL })), ['claude:sonnet', 'openai:gpt-6.1-sol', 'deepseek:deepseek-v4-pro']);
  assert.deepEqual(ids(route({ kind: 'code', sensitivity: 'client', available: ALL })), ['claude:sonnet', 'openai:gpt-6.1-sol']);
  const read = route({ kind: 'read', sensitivity: 'internal', available: ALL });
  assert.deepEqual(ids(read), ['claude:sonnet', 'openai:gpt-6.1-sol', 'gemini:gemini-3.8-flash']);
  assert.ok(read[2].maxPromptChars > 0, 'Gemini reads in pieces');
  assert.deepEqual(ids(route({ kind: 'portuguese', sensitivity: 'client', available: ALL })), ['claude:sonnet', 'claude:opus', 'openai:gpt-6.1-sol']);
  assert.deepEqual(ids(route({ kind: 'reasoning', sensitivity: 'internal', available: ALL })), ['claude:opus', 'openai:gpt-6-astra']);
});

test('only available providers are offered, and what is left out says why', () => {
  assert.deepEqual(ids(route({ kind: 'bulk', sensitivity: 'internal', available: ['gemini'] })), ['gemini:gemini-3.1-flash-lite']);
  assert.deepEqual(route({ kind: 'bulk', sensitivity: 'internal', available: [] }), []);
  assert.deepEqual(route({ kind: 'nope', sensitivity: 'internal', available: ALL }), []);
  const { skipped } = explainRoute({ kind: 'bulk', sensitivity: 'internal', available: ['gemini'] });
  assert.ok(skipped.some((s) => s.provider === 'openai' && s.why === 'not-available'));
  const set = route({ kind: 'bulk', sensitivity: 'internal', available: new Set(['openai']) });
  assert.deepEqual(ids(set), ['openai:gpt-6-luna'], 'a Set works as well as an array');
});

test('a model the owner pinned for a provider replaces the table\'s, and its family is checked again', () => {
  const pinned = route({ kind: 'bulk', sensitivity: 'internal', available: ['openrouter'], models: { openrouter: 'google/gemini-2.5-flash-lite' } });
  assert.deepEqual(ids(pinned), ['openrouter:google/gemini-2.5-flash-lite'], 'no longer a DeepSeek model: internal data may go');
  const toDeepseek = route({ kind: 'bulk', sensitivity: 'internal', available: ['openrouter'], models: { openrouter: 'deepseek/deepseek-v4.1-flash' } });
  assert.deepEqual(toDeepseek, []);
});

test('measured results reorder the candidates: the best, and among nearly-as-good the cheapest, first', () => {
  const stats = [
    { kind: 'bulk', contestant: 'claude:haiku', accuracy: 0.95, costPerCorrectUSD: 0.01, n: 50 },
    { kind: 'bulk', contestant: 'gemini:gemini-3.1-flash-lite', accuracy: 0.93, costPerCorrectUSD: 0.0002, n: 50 },
    { kind: 'bulk', contestant: 'openai:gpt-6-luna', accuracy: 0.7, costPerCorrectUSD: 0.0001, n: 50 },
  ];
  const got = route({ kind: 'bulk', sensitivity: 'internal', available: ALL, stats });
  assert.deepEqual(ids(got).slice(0, 3), ['gemini:gemini-3.1-flash-lite', 'claude:haiku', 'openai:gpt-6-luna']);
  assert.equal(got[0].measured.accuracy, 0.93);
  assert.match(got[0].why, /93%/);
  assert.equal(ids(got).includes('openrouter:deepseek/deepseek-v4.1-flash'), false, 'internal data');
  const review = route({ kind: 'review', sensitivity: 'internal', author: 'claude', available: ALL, stats: [
    { kind: 'review', contestant: 'gemini:gemini-3.8-flash', accuracy: 0.9, costPerCorrectUSD: 0.01, n: 30 },
    { kind: 'review', contestant: 'openai:gpt-6.1-sol', accuracy: 0.8, costPerCorrectUSD: 0.001, n: 30 },
    { kind: 'review', contestant: 'claude:opus', accuracy: 0.99, costPerCorrectUSD: 0.1, n: 30 },
  ] });
  assert.deepEqual(ids(review), ['gemini:gemini-3.8-flash', 'openai:gpt-6.1-sol'], 'measured or not, the author\'s family stays out');
});

test('a measured contestant missing from the table still competes, under the same privacy rules', () => {
  const stats = [{ kind: 'bulk', contestant: 'openai:gpt-6.1-sol', accuracy: 0.99, costPerCorrectUSD: 0.001, n: 40 }];
  assert.equal(ids(route({ kind: 'bulk', sensitivity: 'client', available: ['openai'], stats }))[0], 'openai:gpt-6.1-sol');
  const ds = [{ kind: 'bulk', contestant: 'deepseek:deepseek-v4-pro', accuracy: 0.99, costPerCorrectUSD: 0.001, n: 40 }];
  assert.equal(route({ kind: 'bulk', sensitivity: 'client', available: ['deepseek'], stats: ds }).length, 0);
});

test('spread splits a batch over every qualifying AI at once: evenly without data, by quality per dollar with it', () => {
  const candidates = route({ kind: 'bulk', sensitivity: 'internal', available: ['openai', 'gemini', 'openrouter'], models: { openrouter: 'google/gemini-2.5-flash-lite' } });
  const even = spread({ kind: 'bulk', candidates, n: 9 });
  assert.deepEqual(even.map((s) => s.n), [3, 3, 3]);
  assert.equal(even.reduce((a, s) => a + s.n, 0), 9);
  const odd = spread({ kind: 'bulk', candidates, n: 10 });
  assert.equal(odd.reduce((a, s) => a + s.n, 0), 10);
  assert.equal(odd[0].n, 4, 'the leftover goes to the first in line');

  const stats = [
    { kind: 'bulk', contestant: 'openai:gpt-6-luna', accuracy: 0.9, costPerCorrectUSD: 0.0001, n: 50 },
    { kind: 'bulk', contestant: 'gemini:gemini-3.1-flash-lite', accuracy: 0.9, costPerCorrectUSD: 0.0003, n: 50 },
  ];
  const measured = route({ kind: 'bulk', sensitivity: 'internal', available: ['openai', 'gemini'], stats });
  const weighted = spread({ kind: 'bulk', candidates: measured, n: 8 });
  assert.deepEqual(weighted.map((s) => [s.provider, s.n]), [['openai', 6], ['gemini', 2]], 'three times cheaper per right answer, three times the work');
  assert.deepEqual(spread({ kind: 'bulk', candidates: [], n: 5 }), []);
  assert.deepEqual(spread({ kind: 'bulk', candidates: measured, n: 0 }).map((s) => s.n), [0, 0]);
});

test('spread leaves out a measured AI far less accurate than the best', () => {
  const stats = [
    { kind: 'bulk', contestant: 'openai:gpt-6-luna', accuracy: 0.5, costPerCorrectUSD: 0.00001, n: 50 },
    { kind: 'bulk', contestant: 'gemini:gemini-3.1-flash-lite', accuracy: 0.95, costPerCorrectUSD: 0.0003, n: 50 },
  ];
  const got = spread({ kind: 'bulk', candidates: route({ kind: 'bulk', sensitivity: 'internal', available: ['openai', 'gemini'], stats }), n: 6 });
  assert.deepEqual(got.map((s) => [s.provider, s.n]), [['gemini', 6]]);
});

test('loadStats reads smDir/bench/routing.json, keeps entries measured at least 20 times, and is empty without it', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-router-'));
  try {
    assert.deepEqual(loadStats(smDir), []);
    assert.equal(routingFile(smDir), join(smDir, 'bench', 'routing.json'));
    mkdirSync(join(smDir, 'bench'));
    writeFileSync(routingFile(smDir), '{ broken');
    assert.deepEqual(loadStats(smDir), []);
    writeFileSync(routingFile(smDir), JSON.stringify({
      updatedAt: '2026-10-10T12:00:00Z',
      entries: [
        { kind: 'classify', contestant: 'openai:gpt-6-luna', accuracy: 0.9, costPerCorrectUSD: 0.0001, n: 40 },
        { kind: 'bulk', contestant: 'gemini:gemini-3.1-flash-lite', accuracy: 0.9, costPerCorrectUSD: 0.0002, n: 19 },
        { kind: 'pt', contestant: 'claude:sonnet', accuracy: 0.97, costPerCorrectUSD: 0.02, n: 20 },
        { kind: 'bulk', contestant: 'nobody', accuracy: 0.9, costPerCorrectUSD: 0.0002, n: 50 },
        { kind: 'bulk', contestant: 'gemini:x', accuracy: 'high', costPerCorrectUSD: 0.0002, n: 50 },
        { kind: 'bulk', contestant: 'acme:x', accuracy: 0.9, costPerCorrectUSD: 0.0002, n: 50 },
      ],
    }));
    assert.deepEqual(loadStats(smDir), [
      { kind: 'bulk', contestant: 'openai:gpt-6-luna', accuracy: 0.9, costPerCorrectUSD: 0.0001, n: 40 },
      { kind: 'portuguese', contestant: 'claude:sonnet', accuracy: 0.97, costPerCorrectUSD: 0.02, n: 20 },
    ]);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// Review fixes (2026-10-10).
test('a direct Gemini key never gets client data: the free tier may train on it', () => {
  for (const kind of ROUTE_KINDS) {
    assert.equal(route({ kind, sensitivity: 'client', available: ALL }).some((c) => c.provider === 'gemini'), false, kind);
  }
  assert.ok(route({ kind: 'bulk', sensitivity: 'internal', available: ALL }).some((c) => c.provider === 'gemini'), 'internal data still may');
  const { skipped } = explainRoute({ kind: 'review', sensitivity: 'client', available: ['gemini'] });
  assert.ok(skipped.some((s) => s.provider === 'gemini' && s.why === 'sensitivity'));
});

test('an OpenRouter model that may be DeepSeek counts as DeepSeek, however it is spelled', () => {
  for (const model of ['DeepSeek-V4', 'deepseek-ai/DeepSeek-V3', 'openrouter/auto', 'some/deepseek-r9']) {
    assert.equal(familyOf('openrouter', model), 'deepseek', model);
    assert.deepEqual(route({ kind: 'bulk', sensitivity: 'client', available: ['openrouter'], models: { openrouter: model } }), [], model);
  }
});

test('a pinned model only changes bulk work: reviews and reasoning keep the table\'s model', () => {
  const models = { openai: 'gpt-6.1-sol' };
  assert.deepEqual(ids(route({ kind: 'bulk', sensitivity: 'internal', available: ['openai'], models })), ['openai:gpt-6.1-sol']);
  assert.deepEqual(ids(route({ kind: 'reasoning', sensitivity: 'internal', available: ['openai'], models })), ['openai:gpt-6-astra']);
  assert.deepEqual(ids(route({ kind: 'review', sensitivity: 'internal', available: ['openai'], models: { openai: 'gpt-6-luna' } })), ['openai:gpt-6.1-sol']);
});
