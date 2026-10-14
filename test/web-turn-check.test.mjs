import test from 'node:test';
import assert from 'node:assert/strict';
import { brainLine, chatLog, checkLine } from '../server/web/views.js';
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

test('the run line names the brain: model, level and why', () => {
  const brain = { phase: 'talk', why: 'talk' };
  assert.equal(brainLine(translator('pt-BR'), { model: 'Sonnet', effort: 'baixo' }, brain), 'Sonnet · baixo — conversa');
  assert.equal(brainLine(translator('en'), { model: 'Sonnet', effort: 'low' }, brain), 'Sonnet · low — a chat');
  assert.equal(brainLine(translator('en'), { model: 'Sonnet', effort: 'low' }, null), null);
});
