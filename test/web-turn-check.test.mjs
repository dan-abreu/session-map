import test from 'node:test';
import assert from 'node:assert/strict';
import { brainLine, chatLog, checkLine, contextMeter } from '../server/web/views.js';
import { translator } from '../server/web/i18n.js';

// The page side of the OK at the end of a request (or26) and the brain's line (or31).

const money = (lang) => (v) => (lang === 'pt-BR' ? `US$ ${v.toFixed(2).replace('.', ',')}` : `US$ ${v.toFixed(2)}`);
const say = (lang, check) => checkLine(translator(lang), check, money(lang));

const done = { tests: { ran: 12, passed: 12, failed: 0, command: 'npm test' }, ticked: ['or26'], saved: ['a1b2c3d'], costUSD: 0.42, missing: [] };
const lacking = { tests: null, ticked: [], saved: [], costUSD: 0.42, missing: ['no-tests'] };
const talk = { tests: null, ticked: [], saved: [], costUSD: 0.42, missing: [] };

test('a finished request reads OK with what was checked, in both languages', () => {
  assert.equal(say('pt-BR', done), 'OK · testes passaram (12) · or26 marcado · salvo a1b2c3d · US$ 0,42');
  assert.equal(say('en', done), 'OK · tests passed (12) · or26 ticked · saved a1b2c3d · US$ 0.42');
});

test('what is missing is said first', () => {
  assert.equal(say('pt-BR', lacking), 'Falta: testes não rodaram · US$ 0,42');
  assert.equal(say('en', lacking), 'Missing: tests did not run · US$ 0.42');
  const bad = { ...lacking, tests: { ran: 12, passed: 10, failed: 2, command: 'npm test' }, missing: ['tests-failed', 'not-saved'] };
  assert.equal(say('en', bad), 'Missing: tests failed (2), work not saved · US$ 0.42');
});

test('a turn that only talked shows only the cost, and no check shows nothing', () => {
  assert.equal(say('pt-BR', talk), 'US$ 0,42');
  assert.equal(say('en', null), '');
});

test('the log keeps the check of the last request and drops it when a new one starts', () => {
  let log = chatLog(undefined, { type: 'turn-end', data: { costUSD: 1, check: done } });
  assert.deepEqual(log.check, done);
  log = chatLog(log, { type: 'local-send', data: { text: 'mais' } });
  assert.equal(log.check, null);
});

test('the run line is the model and the level; the brain\'s why rides apart, for the tooltip', () => {
  const brain = { phase: 'talk', why: 'talk' };
  assert.deepEqual(brainLine(translator('pt-BR'), { model: 'Sonnet', effort: 'baixo' }, brain), { line: 'Sonnet · baixo', why: 'conversa' });
  assert.deepEqual(brainLine(translator('en'), { model: 'Sonnet', effort: 'low' }, brain), { line: 'Sonnet · low', why: 'a chat' });
  assert.deepEqual(brainLine(translator('en'), { model: 'Sonnet', effort: 'low' }, null), { line: 'Sonnet · low', why: null });
  assert.deepEqual(brainLine(translator('en'), { model: null, effort: null }, null), { line: '', why: null });
});

test('the memory chip reads "48k / 200k", amber from 70 % and red from 90 %, and nothing without a number', () => {
  assert.deepEqual(contextMeter({ tokens: 48_200, max: 200_000 }), { used: '48k', max: '200k', label: '48k / 200k', pct: 24, tone: 'ok' });
  assert.equal(contextMeter({ tokens: 138_000, max: 200_000 }).tone, 'ok');
  assert.equal(contextMeter({ tokens: 140_000, max: 200_000 }).tone, 'warn');
  assert.equal(contextMeter({ tokens: 180_000, max: 200_000 }).tone, 'high');
  assert.equal(contextMeter({ tokens: 240_000, max: 200_000 }).tone, 'high', 'past the mark it stays red');
  assert.equal(contextMeter({ tokens: 4_400, max: 200_000 }).label, '4.4k / 200k');
  for (const none of [null, undefined, {}, { tokens: 0, max: 200_000 }, { tokens: 5, max: 0 }, { tokens: 'x', max: 1 }]) assert.equal(contextMeter(none), null);
});

test('the log keeps the memory from the history and from the run event, and keeps the last when one has none', () => {
  let log = chatLog(undefined, { type: 'history', data: { items: [], context: { tokens: 50_000, max: 200_000 } } });
  assert.deepEqual(log.context, { tokens: 50_000, max: 200_000 });
  log = chatLog(log, { type: 'run', data: { costUSD: 1, context: null } });
  assert.deepEqual(log.context, { tokens: 50_000, max: 200_000 }, 'a run event that has no number leaves the chip as it was');
  log = chatLog(log, { type: 'run', data: { costUSD: 1, context: { tokens: 70_000, max: 200_000 } } });
  assert.equal(log.context.tokens, 70_000);
});
