import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_CONFIDENCE, CHECKER_SCHEMA, MAX_CLIMBS, attemptsLeft, checkerPrompt, climbs, contractHint, contractOf,
  gradeAnswer, parseContract, pickChecker,
} from '../server/ai/contract.mjs';

// The worker's exit contract (or37): one shape for every AI, graded when a provider ignores the wrapper, two climbs
// per task at most, and a checker from another family for dubious bulk answers.

test('parseContract takes the wrapper and coerces confidence, refusing broken shapes', () => {
  assert.deepEqual(
    parseContract({ status: 'OK', confidence: '0.9', answer: { x: 1 }, reason: 'fine' }),
    { status: 'ok', confidence: 0.9, answer: { x: 1 }, reason: 'fine', skipped: '' },
  );
  assert.deepEqual(parseContract({ status: 'ok', confidence: 1, answer: 2, skipped: 'não chequei o import' }),
    { status: 'ok', confidence: 1, answer: 2, reason: '', skipped: 'não chequei o import' }, 'the ponytail closing line (id134)');
  assert.equal(parseContract({ status: 'uncertain', confidence: 2, answer: null }).confidence, 1, 'clamped to 1');
  assert.equal(parseContract({ status: 'uncertain', confidence: -3, answer: null }).confidence, 0, 'clamped to 0');
  assert.equal(parseContract({ status: 'error', confidence: 'maybe', answer: null }).confidence, null);
  assert.equal(parseContract({ status: 'ok', confidence: 0.9 }), null, 'no answer key: not a wrapper');
  assert.equal(parseContract({ status: 'meh', confidence: 0.9, answer: 1 }), null, 'unknown status');
  assert.equal(parseContract({ answer: 1 }), null);
  assert.equal(parseContract(null), null);
  assert.ok(parseContract({ status: 'error', confidence: 0.1, answer: null, reason: 'x'.repeat(999) }).reason.length <= 200);
});

test('gradeAnswer derives the contract from the signals around a bare answer', () => {
  assert.deepEqual(gradeAnswer({ value: { a: 1 } }), { status: 'ok', confidence: 0.6, answer: { a: 1 }, reason: 'no-contract', skipped: '' });
  assert.deepEqual(gradeAnswer({ value: 'x', cut: true }), { status: 'uncertain', confidence: 0.4, answer: 'x', reason: 'cut', skipped: '' });
  assert.deepEqual(gradeAnswer({ value: null, error: 'http-500' }), { status: 'error', confidence: 0, answer: null, reason: 'failed', skipped: '' });
  assert.deepEqual(contractOf({ value: { status: 'error', confidence: 0, answer: null, reason: 'x' } }),
    { status: 'error', confidence: 0, answer: null, reason: 'x', skipped: '' });
  assert.deepEqual(contractOf({ value: { ok: true } }), { status: 'ok', confidence: 0.6, answer: { ok: true }, reason: 'no-contract', skipped: '' });
});

test('only a failure or an uncertain answer climbs; low confidence alone does not', () => {
  assert.equal(climbs({ status: 'ok', confidence: 0.2 }), false);
  assert.equal(climbs({ status: 'uncertain', confidence: 0.2 }), true);
  assert.equal(climbs({ status: 'error', confidence: 0 }), true);
  assert.equal(MAX_CLIMBS, 2);
  assert.equal(attemptsLeft(0), true, 'the first try');
  assert.equal(attemptsLeft(2), true, 'the third try is the second climb');
  assert.equal(attemptsLeft(3), false, 'the third climb never happens');
});

test('contractHint wraps the asked schema in the same words for every provider', () => {
  const hint = contractHint('{"partId": "string"}');
  assert.ok(hint.includes('"status"'));
  assert.ok(hint.includes('"confidence"'));
  assert.ok(hint.includes('"answer"'));
  assert.ok(hint.includes('"partId"'));
  assert.ok(hint.includes('"reason"'));
  assert.ok(CHECK_CONFIDENCE > 0 && CHECK_CONFIDENCE < 1);
});

test('checkerPrompt asks one closed question and shows the answer as JSON', () => {
  const p = checkerPrompt('label these', { partId: 'map' });
  assert.ok(p.includes('label these'));
  assert.ok(p.includes('"partId":"map"'));
  assert.ok(p.includes(CHECKER_SCHEMA.slice(1, -1)));
  assert.equal(checkerPrompt('t', undefined), 'Check one answer. The task was:\nt\n\nThe answer:\nundefined\n\nDoes the answer follow the task? Reply with one JSON object only: {"ok": true | false, "why": "<one short line>"}');
});

test('pickChecker takes the cheapest AI of another family, never the worker or one already asked', () => {
  const candidates = [
    { provider: 'openai', model: 'gpt-6-luna', family: 'openai' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite', family: 'google' },
    { provider: 'deepseek', model: 'deepseek-flash', family: 'deepseek' },
  ];
  assert.equal(pickChecker(candidates, { worker: { family: 'openai' }, asked: ['openai'] }).provider, 'gemini');
  assert.equal(pickChecker(candidates, { worker: { family: 'google' }, asked: ['google'] }).provider, 'openai');
  assert.equal(pickChecker(candidates, { worker: { family: 'openai' }, asked: ['openai', 'gemini'] }).provider, 'deepseek');
  assert.equal(pickChecker(candidates, { worker: { family: 'openai' }, asked: ['openai', 'gemini', 'deepseek'] }), null);
  assert.equal(pickChecker([], { worker: { family: 'openai' } }), null);
  assert.equal(pickChecker(candidates, { worker: { family: undefined } }).provider, 'openai', 'unknown worker family: any other AI');
});
