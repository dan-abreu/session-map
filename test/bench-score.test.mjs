// The bench's scorers (or12): pure functions, one per kind of task, that turn one answer into a score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreClassify, scoreCode, scoreReview, scorePt, scoreAnswer } from '../server/bench/score.mjs';

test('classify: right when the part matches the gold part', () => {
  const item = { id: 'c1', gold: { partId: 'map' } };
  assert.equal(scoreClassify(item, { partId: 'map' }).score, 1);
  assert.equal(scoreClassify(item, { partId: 'chat' }).score, 0);
  assert.equal(scoreClassify(item, { partId: null }).score, 0);
});

test('classify: a gold of null means "none fits", and only a null-like answer is right', () => {
  const item = { id: 'c2', gold: { partId: null } };
  assert.equal(scoreClassify(item, { partId: null }).score, 1);
  assert.equal(scoreClassify(item, { partId: '' }).score, 1);
  assert.equal(scoreClassify(item, { partId: 'none' }).score, 1);
  assert.equal(scoreClassify(item, { partId: 'map' }).score, 0);
  assert.equal(scoreClassify({ id: 'c3', gold: null }, { partId: null }).score, 1);
});

test('classify: the stored answer is only the part id, cut short', () => {
  const r = scoreClassify({ id: 'c1', gold: { partId: 'map' } }, { partId: 'x'.repeat(500), why: 'secret prompt text' });
  assert.ok(r.answer.length <= 80);
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('code: full marks only when every test passes', () => {
  assert.equal(scoreCode({ id: 'k' }, { ok: true, passed: 4, failed: 0, total: 4 }).score, 1);
  const half = scoreCode({ id: 'k' }, { ok: false, passed: 2, failed: 2, total: 4 });
  assert.equal(half.score, 0);
  assert.equal(half.partial, 0.5);
  assert.equal(scoreCode({ id: 'k' }, { ok: false, timedOut: true, passed: 0, failed: 0, total: 0 }).score, 0);
});

test('review: a report within two lines of the bug is a hit', () => {
  const item = { id: 'r1', clean: false, bugLines: [10] };
  const r = scoreReview(item, { bugs: [{ line: 12, why: 'off by one' }] });
  assert.equal(r.score, 1);
  assert.equal(r.falseAlarms, 0);
  assert.equal(scoreReview(item, { bugs: [{ line: 13, why: 'x' }] }).score, 0);
});

test('review: a report far from every bug line is a false alarm, even when the bug is found', () => {
  const item = { id: 'r1', clean: false, bugLines: [10, 11] };
  const r = scoreReview(item, { bugs: [{ line: 9, why: 'x' }, { line: 40, why: 'y' }] });
  assert.equal(r.score, 1);
  assert.equal(r.falseAlarms, 1);
});

test('review: on a clean item, no reports is right and every report is a false alarm', () => {
  const item = { id: 'r2', clean: true, bugLines: [] };
  assert.deepEqual([scoreReview(item, { bugs: [] }).score, scoreReview(item, { bugs: [] }).falseAlarms], [1, 0]);
  const r = scoreReview(item, { bugs: [{ line: 1, why: 'a' }, { line: '5', why: 'b' }] });
  assert.equal(r.score, 0);
  assert.equal(r.falseAlarms, 2);
});

test('review: a missed bug scores zero; a malformed answer is a bad shape, never "no reports"', () => {
  const item = { id: 'r1', clean: false, bugLines: [10] };
  assert.equal(scoreReview(item, { bugs: [] }).score, 0);
  assert.equal(scoreReview(item, { bugs: 'none' }).score, 0);
  assert.equal(scoreReview(item, null).falseAlarms, 0);
  assert.equal(scoreReview(item, null).badShape, true);
});

test('an answer that ignores the asked shape never wins a "no bug" or "no part" item', () => {
  const clean = { id: 'r2', clean: true, bugLines: [] };
  for (const v of [{}, { issues: [{ line: 3 }] }, null, 'none']) {
    const r = scoreReview(clean, v);
    assert.deepEqual([r.score, r.badShape], [0, true], JSON.stringify(v));
  }
  const none = { id: 'c2', gold: { partId: null } };
  for (const v of [{}, { part: 'server' }, { partId: 7 }, null]) {
    const r = scoreClassify(none, v);
    assert.deepEqual([r.score, r.badShape], [0, true], JSON.stringify(v));
  }
  assert.equal(scoreClassify(none, { partId: null }).badShape, undefined);
});

test('review: a report with no usable line is a false alarm, never a hit', () => {
  const early = { id: 'r3', clean: false, bugLines: [1] };
  for (const line of [null, '', 0, 1.5, 'abc', undefined]) {
    const r = scoreReview(early, { bugs: [{ line, why: 'x' }] });
    assert.deepEqual([r.score, r.hits, r.falseAlarms], [0, 0, 1], String(line));
  }
  assert.equal(scoreReview(early, { bugs: [{ line: '2' }] }).score, 1);
  const clean = { id: 'r2', clean: true, bugLines: [] };
  assert.equal(scoreReview(clean, { bugs: [{ line: null, why: 'something' }] }).score, 0);
});

const GOOD_PT = 'Agora a lista de conversas tem uma caixa de busca. Quando você digita uma palavra, aparecem só as conversas que falam dela. Funciona com as suas 214 conversas em menos de um segundo, e nada foi perdido ou apagado. Para experimentar, abra a lista, clique na caixa no alto e digite uma palavra que você lembra de alguma conversa. Se quiser ver tudo de novo, é só apagar o que digitou. Assim fica mais fácil achar aquela conversa antiga sem precisar rolar a tela inteira.';

test('pt: a plain Portuguese text of the right size passes', () => {
  const r = scorePt({ id: 'p1' }, { text: GOOD_PT });
  assert.equal(r.score, 1);
  assert.equal(r.checks.language, true);
  assert.equal(r.answer, GOOD_PT);
});

test('pt: jargon, English or a wrong size fails the automatic checks', () => {
  assert.equal(scorePt({ id: 'p1' }, { text: `${GOOD_PT} Fiz um commit no repositório.` }).score, 0);
  assert.equal(scorePt({ id: 'p1' }, { text: 'The search box is now on the list and you can type a word to see only the chats that mention it, which is fast and safe for everyone who uses it every day.' }).score, 0);
  assert.equal(scorePt({ id: 'p1' }, { text: 'Pronto, está feito.' }).score, 0);
  assert.equal(scorePt({ id: 'p1' }, { text: 42 }).score, 0);
  assert.equal(scorePt({ id: 'p1' }, { text: 42 }).badShape, true);
});

test('scoreAnswer sends each kind to its scorer and refuses an unknown kind', () => {
  assert.equal(scoreAnswer('classify', { id: 'c', gold: { partId: 'a' } }, { partId: 'a' }).score, 1);
  assert.throws(() => scoreAnswer('poetry', {}, {}), /unknown kind/);
});
