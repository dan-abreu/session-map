import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askOthers } from '../server/ai/ask.mjs';

// The contract path of askOthers (or37): the wrapper unwrapped for every provider, the climb cap of two, and the
// one cheap check of another family for a dubious bulk answer. Everything is faked: no network, no keys.

const smDir = () => mkdtempSync(join(tmpdir(), 'sm-contract-'));
const queue = () => ({ pausedFor: () => null, reserveOutside: () => ({ settle: () => {} }) });
const settings = (extra = {}) => ({ enabled: true, dailyUSD: 10, off: [], models: {}, keys: ['openai', 'gemini', 'deepseek'], ...extra });
const ask = (s, fakes, opts = {}) => askOthers({
  smDir: s.dir, kind: 'bulk', sensitivity: 'public', prompt: 'label this', schemaHint: '{"partId": "string"}',
  queue: queue(), settings: settings(), keyOf: () => 'k', stats: () => [], apiRun: fakes.apiRun, ...opts,
});

const wrapper = (status, confidence, answer, reason = '') => ({ ok: true, value: { status, confidence, answer, reason }, costUSD: 0.001 });

test('a wrapper answer is unwrapped and its contract comes back', async () => {
  const calls = [];
  const s = { dir: smDir() };
  const apiRun = async (prompt, o) => { calls.push(o); return wrapper('ok', 0.9, { partId: 'map' }); };
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.ok, true);
  assert.deepEqual(got.answers[0].value, { partId: 'map' }, 'the caller sees the answer, never the wrapper');
  assert.deepEqual(got.answers[0].contract, { status: 'ok', confidence: 0.9, reason: '' });
  assert.equal(calls[0].schemaHint.includes('"confidence"'), true, 'the wrapper schema was asked for');
});

test('a bare JSON answer is graded, not failed', async () => {
  const s = { dir: smDir() };
  const apiRun = async () => ({ ok: true, value: { partId: 'map' }, costUSD: 0.001 });
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.ok, true);
  assert.deepEqual(got.answers[0].value, { partId: 'map' });
  assert.deepEqual(got.answers[0].contract, { status: 'ok', confidence: 0.6, reason: 'no-contract' });
});

test('an uncertain answer climbs, and the next AI in line takes over', async () => {
  const s = { dir: smDir() };
  const apiRun = async (prompt, o) => (o.provider === 'openai'
    ? wrapper('uncertain', 0.3, { partId: 'map?' }, 'not sure')
    : wrapper('ok', 0.9, { partId: 'map' }));
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.ok, true);
  assert.equal(got.answers.length, 2);
  assert.equal(got.answers[0].provider, 'openai');
  assert.equal(got.answers[0].contract.status, 'uncertain');
  assert.equal(got.answers[1].provider, 'gemini');
  assert.equal(got.stopped, undefined);
});

test('the third failure stops the task with max-climbs instead of burning every AI', async () => {
  const calls = [];
  const s = { dir: smDir() };
  const apiRun = async (prompt, o) => { calls.push(o.provider); return { ok: false, error: 'http-500', provider: o.provider }; };
  const got = await ask(s, { apiRun });
  assert.equal(got.ok, false);
  assert.equal(got.error, 'max-climbs');
  assert.equal(got.stopped, 'max-climbs');
  assert.deepEqual(calls, ['openai', 'gemini', 'deepseek'], 'one try plus two climbs, then stop');
});

test('a dubious bulk answer is checked once by another family, and a check that fails marks it uncertain', async () => {
  const calls = [];
  const s = { dir: smDir() };
  const apiRun = async (prompt, o) => {
    calls.push({ provider: o.provider, check: o.schemaHint.includes('"why"') });
    if (o.provider === 'openai') return wrapper('ok', 0.4, { partId: 'wrong?' });
    return wrapper('ok', 0.9, { ok: false, why: 'wrong part' });
  };
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.ok, true);
  const a = got.answers[0];
  assert.equal(a.checker.provider, 'gemini', 'the checker is another family');
  assert.equal(a.checker.ok, false);
  assert.equal(a.contract.status, 'uncertain');
  assert.ok(a.contract.reason.includes('checker disagreed'));
  assert.deepEqual(calls.map((c) => c.check), [false, true], 'the checker ran once, after the worker');
});

test('a confident bulk answer is never checked twice', async () => {
  const calls = [];
  const s = { dir: smDir() };
  const apiRun = async (prompt, o) => { calls.push(o.provider); return wrapper('ok', 0.9, { partId: 'map' }); };
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.ok, true);
  assert.equal(got.answers[0].checker, undefined);
  assert.equal(calls.length, 1);
});

test('the Cérebro\'s opinion row rides the checker call (id146)', async () => {
  const calls = [];
  const s = { dir: smDir() };
  writeFileSync(join(s.dir, 'config.json'), JSON.stringify({ ai: { others: { functions: { opinion: { provider: 'gemini', effort: 'low' } } } } }));
  const apiRun = async (prompt, o) => {
    calls.push({ provider: o.provider, effort: o.effort ?? null, check: o.schemaHint.includes('"why"') });
    if (o.provider === 'openai') return wrapper('ok', 0.4, { partId: 'wrong?' });
    return wrapper('ok', 0.9, { ok: false, why: 'wrong part' });
  };
  const got = await ask(s, { apiRun }, { contract: true });
  assert.equal(got.answers[0].checker.provider, 'gemini');
  const checkCall = calls.find((c) => c.check);
  assert.equal(checkCall.effort, 'low', 'the owner\'s level for the second opinion rides the checker');
});

test('without contract the old plain behavior stays', async () => {
  const s = { dir: smDir() };
  const apiRun = async () => ({ ok: true, value: { partId: 'map' }, costUSD: 0.001 });
  const got = await ask(s, { apiRun });
  assert.equal(got.ok, true);
  assert.deepEqual(got.answers[0].value, { partId: 'map' });
  assert.equal(got.answers[0].contract, undefined);
});

test('the function choice rides on the routed call: its model and its level, only for its engine', async () => {
  const dir = smDir();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ai: { others: { functions: { gather: { provider: 'openai', model: 'gpt-6-luna', effort: 'none' } } } } }));
  const calls = [];
  const apiRun = async (prompt, o) => { calls.push(o); return wrapper('ok', 0.9, { partId: 'map' }); };
  const got = await askOthers({ smDir: dir, kind: 'bulk', sensitivity: 'public', prompt: 'label', schemaHint: '{"partId":"string"}', queue: queue(), settings: settings(), keyOf: () => 'k', stats: () => [], apiRun });
  assert.equal(got.ok, true);
  assert.equal(calls[0].provider, 'openai');
  assert.equal(calls[0].model, 'gpt-6-luna');
  assert.equal(calls[0].effort, 'none');
});

test('a choice for another engine does not ride on this call', async () => {
  const dir = smDir();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ai: { others: { functions: { gather: { provider: 'deepseek', model: 'deepseek-flash', effort: 'off' } } } } }));
  const calls = [];
  const apiRun = async (prompt, o) => { calls.push(o); return wrapper('ok', 0.9, { partId: 'map' }); };
  const got = await askOthers({ smDir: dir, kind: 'bulk', sensitivity: 'public', prompt: 'label', schemaHint: '{"partId":"string"}', queue: queue(), settings: settings(), keyOf: () => 'k', stats: () => [], apiRun });
  assert.equal(got.ok, true);
  assert.equal(calls[0].provider, 'openai');
  assert.equal(calls[0].model, 'gpt-6-luna', 'the routed model stays');
  assert.equal(calls[0].effort, undefined, 'the other engine\'s level never rides');
});
