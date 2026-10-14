// Interpreter (AI agent): authored this file; pending human review

import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeRequest, measureWork, directiveOf } from '../server/ai/size.mjs';

test('security is detected and never trivial', () => {
  const r = sizeRequest({ text: 'reseta a senha do usuario e muda a permissao' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'security');
  assert.notEqual(r.size, 'trivial');
  assert.equal(r.confidence, 'high');
});

test('money is detected and floored to at least medium', () => {
  const r = sizeRequest({ text: 'cria o fluxo de pagamento com cartao' });
  assert.equal(r.kind, 'money');
  assert.ok(['medium', 'large'].includes(r.size));
});

test('a small code fix is code + small', () => {
  const r = sizeRequest({ text: 'conserta o bug na funcao login.js' });
  assert.equal(r.kind, 'code');
  assert.equal(r.size, 'small');
});

test('a "finish everything" request is large', () => {
  const r = sizeRequest({ text: 'finaliza tudo que esta em aberto no projeto inteiro' });
  assert.equal(r.size, 'large');
});

test('a plain question is read + trivial', () => {
  const r = sizeRequest({ text: 'what is this?' });
  assert.equal(r.kind, 'read');
  assert.equal(r.size, 'trivial');
});

test('architecture words route to architecture', () => {
  const r = sizeRequest({ text: 'desenha o diagrama de arquitetura com as camadas' });
  assert.equal(r.kind, 'architecture');
});

test('search words route to search', () => {
  const r = sizeRequest({ text: 'procura onde esta a funcao de login' });
  assert.equal(r.kind, 'search');
});

test('unknown wording falls back to reasoning with low confidence', () => {
  const r = sizeRequest({ text: 'me ajuda a pensar melhor sobre um assunto' });
  assert.equal(r.kind, 'reasoning');
  assert.equal(r.confidence, 'low');
});

test('empty text is refused', () => {
  const r = sizeRequest({ text: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-text');
});

test('sensitivity is validated and defaults to client', () => {
  assert.equal(sizeRequest({ text: 'faz uma mudanca' }).sensitivity, 'client');
  assert.equal(sizeRequest({ text: 'faz uma mudanca', sensitivity: 'internal' }).sensitivity, 'internal');
  assert.equal(sizeRequest({ text: 'faz uma mudanca', sensitivity: 'bogus' }).sensitivity, 'client');
});

// --- measureWork: sizing + cheapest-capable-worker routing, in one call (Claude-only here) ---

test('measureWork routes a trivial question to a cheap Claude worker', () => {
  const r = measureWork({ text: 'what is this?', others: null });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'read');
  assert.equal(r.worker.provider, 'claude');
  assert.ok(['haiku', 'sonnet'].includes(r.worker.model), 'a trivial question never goes to Opus');
});

test('measureWork routes a security change to Opus', () => {
  const r = measureWork({ text: 'muda a senha e a permissao do usuario', others: null });
  assert.equal(r.kind, 'security');
  assert.equal(r.worker.provider, 'claude');
  assert.equal(r.worker.model, 'opus');
});

test('measureWork keeps a bad request as an error without throwing', () => {
  const r = measureWork({ text: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-text');
});


test('directiveOf names the measured worker and stays compact', () => {
  const m = measureWork({ text: 'conserta o bug na funcao login.js', others: null });
  const d = directiveOf(m);
  assert.match(d, /code\/small/);
  assert.match(d, /sonnet/);
  assert.match(d, /pick_worker/);
});

test('directiveOf is empty when there is nothing to say', () => {
  assert.equal(directiveOf(measureWork({ text: '   ' })), '');
});

test('everyday words do not inflate a request: cost talk, tokens, flow, e-mail and "tudo"', () => {
  assert.notEqual(sizeRequest({ text: 'reduce token usage in the hub' }).kind, 'security');
  assert.notEqual(sizeRequest({ text: 'reduza o custo dos agentes' }).kind, 'money');
  assert.notEqual(sizeRequest({ text: 'arruma o fluxo de login' }).kind, 'architecture');
  assert.notEqual(sizeRequest({ text: 'add an email field to the form' }).kind, 'portuguese');
  assert.equal(sizeRequest({ text: 'tudo certo, corrige o bug em a.js' }).size, 'small');
  assert.notEqual(sizeRequest({ text: 'what does the system prompt do?' }).size, 'large');
  assert.equal(sizeRequest({ text: 'cria um sistema novo de agenda do zero' }).size, 'large');
});

test('a dollar amount is money', () => {
  assert.equal(sizeRequest({ text: 'cobrar $5 por mes no plano' }).kind, 'money');
  assert.equal(sizeRequest({ text: 'o plano passa a custar US$ 30' }).kind, 'money');
});
