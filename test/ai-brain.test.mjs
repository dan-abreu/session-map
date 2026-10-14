import test from 'node:test';
import assert from 'node:assert/strict';
import { weigh, wantsHaiku, haikuPrompt, haikuOf, levelRank, phaseNote, PHASE_DIRECTIVES } from '../server/ai/brain.mjs';
import { sizeRequest } from '../server/ai/size.mjs';
import { LANGS } from '../server/web/i18n.js';
import { firstPrompt, personsWords } from '../server/chat/prompt.mjs';
import { withRunNote } from '../server/chat/run.mjs';

// The entry brain (or31/or29): each message is weighed before it runs. Pure: no AI, no cost.
const w = (text, extra = {}) => weigh({ text, measured: sizeRequest({ text }), ...extra });
const at = (r) => `${r.phase} ${r.model}/${r.effort}`;

test('a greeting, thanks or one short command is trivial: Haiku at low', () => {
  for (const text of ['oi, tudo bem?', 'obrigado!', 'valeu', 'bom dia', 'thanks', 'hello', 'roda os testes', 'que horas são?']) {
    assert.equal(at(w(text)), 'trivial haiku/low', text);
  }
});

test('a question or an opinion with no work verb is talk: Sonnet at low', () => {
  for (const text of ['o que acha de usar Ollama?', 'por que o hub guarda os eventos?', 'como funciona o cache do conductor?', 'what do you think about Postgres?']) {
    assert.equal(at(w(text)), 'talk sonnet/low', text);
  }
  assert.equal(w('o que faz o hub?').phase, 'talk', '"faz" in "o que faz" is a question, not a go-ahead');
});

test('planning words, or a medium or large request with no go-ahead, are the plan phase: Sonnet at medium, by the bench (or30)', () => {
  for (const text of ['vamos planejar o login', 'tenho uma ideia para o painel', 'e se a gente guardasse o resumo?', 'como poderíamos mostrar o custo?', 'vamos pensar no onboarding', 'let us plan the export']) {
    assert.equal(at(w(text)), 'plan sonnet/medium', text);
  }
  assert.equal(at(w('um sistema novo de relatórios para o projeto inteiro')), 'plan sonnet/medium');
  assert.equal(at(w('mexer em server/a.mjs, server/b.mjs e server/c.mjs')), 'plan sonnet/medium', 'medium, no go-ahead');
});

test('a go-ahead or a small concrete change is the build phase: Sonnet at medium, high when it is medium or large', () => {
  assert.equal(at(w('pode construir')), 'build sonnet/medium');
  assert.equal(at(w('corrige o título cortado em header.js')), 'build sonnet/medium');
  assert.equal(at(w('fix the typo in README.md')), 'build sonnet/medium');
  assert.equal(at(w('implementa isso em server/a.mjs e server/b.mjs')), 'build sonnet/high');
  assert.equal(at(w('pode construir', { planned: 'large' })), 'build sonnet/high', 'a bare go-ahead after a large plan builds at the plan\'s size');
  assert.equal(at(w('ok, pode seguir', { planned: 'medium' })), 'build sonnet/high');
  assert.equal(at(w('pode construir', { planned: 'small' })), 'build sonnet/medium');
});

test('security, money and personal data go to Opus at high in the plan and build phases only', () => {
  assert.equal(at(w('corrige o bug do pagamento')), 'build opus/high');
  assert.equal(at(w('vamos planejar o login com senha')), 'plan opus/high');
  assert.equal(at(w('implementa o controle de dado pessoal (LGPD)')), 'build opus/high');
  assert.equal(w('corrige o bug do pagamento').why, 'money');
  assert.equal(at(w('o que acha de guardar a senha em texto?')), 'talk sonnet/low', 'talk stays cheap');
  // The kind is read from the measure, too.
  assert.equal(at(weigh({ text: 'faz isso', measured: { ok: true, kind: 'security', size: 'medium', confidence: 'high' } })), 'build opus/high');
});

test('never Fable, never xhigh or max on its own', () => {
  const texts = ['oi', 'o que acha?', 'vamos planejar o sistema novo de dinheiro do zero', 'construa tudo do zero em todo o projeto inteiro', 'corrige a senha do login'];
  for (const text of texts) for (const planned of [undefined, 'large']) {
    const r = w(text, { planned });
    assert.ok(['haiku', 'sonnet', 'opus'].includes(r.model), text);
    assert.ok(['low', 'medium', 'high'].includes(r.effort), text);
  }
});

test('why is a short key the page puts in the person\'s words', () => {
  assert.equal(w('oi').why, 'trivial');
  assert.equal(w('o que acha de usar Ollama?').why, 'talk');
  assert.equal(w('vamos planejar o login').why, 'plan');
  assert.equal(w('um sistema novo de relatórios para o projeto inteiro').why, 'plan-big');
  assert.equal(w('pode construir', { planned: 'large' }).why, 'build-big');
  assert.equal(w('corrige o título em header.js').why, 'build');
});

test('empty or odd input still weighs: one level up in doubt', () => {
  assert.equal(at(weigh({ text: '', measured: null })), 'talk sonnet/low');
  assert.equal(at(weigh({ text: 'oi' })), 'trivial haiku/low', 'works without a measure');
  assert.equal(weigh().model, 'sonnet');
});

// ---- the Haiku tie-break ----

const LONG = `Hoje o time conversou bastante sobre o jeito da pessoa escrever mensagens longas, cheias de contexto. ${'Eu queria registrar o que foi dito. '.repeat(6)}`;

test('Haiku is asked only when the rules are unsure and the text is long', () => {
  assert.equal(wantsHaiku({ text: LONG, measured: { confidence: 'low' } }), true);
  assert.equal(wantsHaiku({ text: LONG, measured: { confidence: 'high' } }), false);
  assert.equal(wantsHaiku({ text: 'texto curto', measured: { confidence: 'low' } }), false);
  assert.match(haikuPrompt(LONG), /untrusted|data/i);
  assert.ok(haikuPrompt('x'.repeat(20000)).length < 6000, 'the text is cut');
});

test('when Haiku disagrees with the rules the higher level wins; it is ignored when sure or invalid', () => {
  assert.ok(LONG.length > 200);
  const rules = w(LONG);
  assert.equal(rules.model, 'sonnet');
  const up = weigh({ text: LONG, measured: sizeRequest({ text: LONG }), haiku: { phase: 'build', size: 'large', sensitive: true } });
  assert.equal(at(up), 'build opus/high');
  const sameLevel = weigh({ text: LONG, measured: sizeRequest({ text: LONG }), haiku: { phase: 'plan', size: 'large', sensitive: false } });
  assert.equal(at(sameLevel), 'plan sonnet/medium');
  // Lower than the rules: the rules stay.
  const down = weigh({ text: LONG, measured: sizeRequest({ text: LONG }), haiku: { phase: 'trivial', size: 'trivial', sensitive: false } });
  assert.equal(at(down), at(rules));
  // Not used when the rules were sure.
  const sure = 'implementar o botão de salvar no header. '.repeat(6);
  const measured = sizeRequest({ text: sure });
  assert.equal(measured.confidence, 'high');
  assert.equal(at(weigh({ text: sure, measured, haiku: { phase: 'build', size: 'large', sensitive: true } })), at(weigh({ text: sure, measured })));
  // Junk from the model is no reason to move.
  for (const haiku of [null, 'build', { phase: 'turbo', size: 'large', sensitive: true }, { phase: 'build', size: 'huge' }, { phase: 'build', size: 'large', sensitive: 'yes' }]) {
    assert.equal(at(weigh({ text: LONG, measured: sizeRequest({ text: LONG }), haiku })), at(rules), JSON.stringify(haiku));
  }
});

test('haikuOf reads the reply of the cheap call and refuses anything outside the fixed lists', () => {
  assert.deepEqual(haikuOf({ ok: true, value: { phase: 'plan', size: 'medium', sensitive: false } }), { phase: 'plan', size: 'medium', sensitive: false });
  for (const bad of [null, { ok: false }, { ok: true, value: {} }, { ok: true, value: { phase: 'x', size: 'small', sensitive: false } }]) assert.equal(haikuOf(bad), null);
});

// ---- levels, and the phase directive ----

test('levelRank orders model first, then effort', () => {
  assert.ok(levelRank('haiku', 'low') < levelRank('sonnet', 'low'));
  assert.ok(levelRank('sonnet', 'low') < levelRank('sonnet', 'high'));
  assert.ok(levelRank('sonnet', 'high') < levelRank('opus', 'high'));
});

test('the plan and build directives are short English, carry no item code, and are stripped from the page\'s history', () => {
  assert.deepEqual(Object.keys(PHASE_DIRECTIVES), ['plan', 'build']);
  for (const text of Object.values(PHASE_DIRECTIVES)) {
    assert.ok(Buffer.byteLength(text, 'utf8') < 300, text);
    assert.doesNotMatch(text, /\b[a-z]{2}\d{2,3}\b/, 'no item code');
  }
  assert.match(PHASE_DIRECTIVES.plan, /Write no code until the person approves/);
  assert.match(PHASE_DIRECTIVES.build, /follow the approved plan/);
  assert.equal(phaseNote('talk', 'oi'), 'oi');
  assert.equal(phaseNote('trivial', 'oi'), 'oi');
  const planned = phaseNote('plan', 'vamos planejar');
  assert.ok(planned.includes(PHASE_DIRECTIVES.plan) && planned.endsWith('vamos planejar'));
  assert.equal(personsWords(planned), 'vamos planejar');
  // After the context block of a first message, and under the note of a changed way of working.
  const first = firstPrompt({ sections: ['Point on the map'], text: phaseNote('build', 'pode construir') });
  assert.equal(personsWords(first), 'pode construir');
  assert.equal(personsWords(withRunNote({ kind: 'maestro' }, planned)), 'vamos planejar');
});

test('every reason the brain can give has its words in both languages', () => {
  const texts = ['oi', 'o que acha?', 'vamos planejar o login', 'um sistema novo do zero', 'corrige o título em header.js', 'implementa isso em server/a.mjs e server/b.mjs',
    'corrige o pagamento', 'implementa o dado pessoal', 'implementa a senha', 'faz isso'];
  const whys = new Set(texts.map((text) => w(text).why));
  whys.add(weigh({ text: LONG, measured: sizeRequest({ text: LONG }), haiku: { phase: 'build', size: 'small', sensitive: true } }).why);
  assert.ok(whys.size >= 8, [...whys].join());
  for (const lang of Object.values(LANGS)) {
    for (const why of whys) assert.equal(typeof lang[`run.brain.${why}`], 'string', why);
  }
});
