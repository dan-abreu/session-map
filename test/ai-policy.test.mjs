import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EFFORTS, KINDS, MODELS, PAGE_FILE, POLICY, chatLevel, hasKind, levelFor, nextRung, policyPage, rungsOfModel, validatePolicy } from '../server/ai/policy.mjs';
import { weigh } from '../server/ai/brain.mjs';
import { recommend } from '../server/ai/conductor.mjs';

// The one routing policy (or33): loaded once, checked at load, read by the brain, recommend() and the guard.
const raw = () => structuredClone(JSON.parse(readFileSync(new URL('../server/ai/policy.json', import.meta.url), 'utf8')));

test('the policy loads with every kind, a reason and its evidence', () => {
  assert.deepEqual(KINDS, ['search', 'read', 'bulk', 'text', 'commit', 'docs', 'code', 'test', 'screen', 'debug', 'plan', 'review', 'architecture', 'security', 'money', 'personal-data']);
  for (const k of KINDS) {
    const t = POLICY.tasks[k];
    assert.ok(MODELS.includes(t.model) && EFFORTS.includes(t.effort), k);
    assert.ok(t.why && t.whyPt && t.evidence, k);
  }
  assert.equal(POLICY.tasks.plan.evidence, 'bench 2026-10-13 plan 8/8 (or30)');
  assert.equal(POLICY.limits.agentsPerWorkflow, 10);
  assert.ok(Object.isFrozen(POLICY) && Object.isFrozen(POLICY.tasks.code));
});

test('an unknown model or effort, a max rung, a missing reason or a fable with no opus before it stop the load', () => {
  assert.doesNotThrow(() => validatePolicy(raw()));
  const bad = (edit, re) => { const p = raw(); edit(p); assert.throws(() => validatePolicy(p), re); };
  bad((p) => { p.tasks.code.model = 'gpt'; }, /unknown model "gpt"/);
  bad((p) => { p.tasks.code.effort = 'turbo'; }, /unknown effort "turbo"/);
  bad((p) => { p.ladder[1].effort = 'max'; }, /max is never automatic/);
  bad((p) => { delete p.tasks.code.evidence; }, /no evidence/);
  bad((p) => { p.phases.talk.model = 'sonnet'; }, /phase talk names a level/);
  bad((p) => { delete p.phases.build; }, /phase build/);
  bad((p) => { p.ladder.reverse(); }, /does not climb|fable needs/);
  bad((p) => { p.ladder = p.ladder.filter((r) => r.model !== 'opus'); }, /fable needs an opus rung/);
  bad((p) => { p.limits.agentsPerWorkflow = 0; }, /agentsPerWorkflow/);
  assert.throws(() => validatePolicy(null), /not an object/);
});

test('levelFor gives the row, and climbs one rung per failure up to Fable', () => {
  assert.deepEqual(levelFor('search'), { model: 'haiku', effort: 'low' });
  assert.deepEqual(levelFor('docs'), { model: 'sonnet', effort: 'low' });
  assert.deepEqual(levelFor('code'), { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(levelFor('security'), { model: 'opus', effort: 'high' });
  assert.deepEqual(levelFor('code', 1), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(levelFor('code', 2), { model: 'opus', effort: 'high' });
  assert.deepEqual(levelFor('code', 3), { model: 'opus', effort: 'xhigh' });
  assert.deepEqual(levelFor('code', 4), { model: 'fable', effort: 'high' });
  assert.deepEqual(levelFor('code', 99), { model: 'fable', effort: 'high' }, 'clamped at the top; max is never reached');
  assert.deepEqual(levelFor('search', 1), { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(levelFor('docs', 1), { model: 'sonnet', effort: 'medium' }, 'docs sits between two rungs');
  assert.deepEqual(levelFor('security', 1), { model: 'opus', effort: 'xhigh' });
  assert.deepEqual(levelFor('code', -2), levelFor('code'));
  assert.equal(levelFor('dance'), null);
  assert.equal(hasKind('code'), true);
  assert.equal(hasKind('constructor'), false);
  for (const k of KINDS) for (let up = 0; up < 8; up++) assert.notEqual(levelFor(k, up).effort, 'max', k);
});

test('ladder helpers: the next rung and the rungs of a model', () => {
  assert.deepEqual(nextRung('sonnet', 'medium'), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(nextRung('opus', 'xhigh'), { model: 'fable', effort: 'high' });
  assert.equal(nextRung('fable', 'high'), null);
  assert.deepEqual(rungsOfModel('opus').map((r) => r.effort), ['high', 'xhigh']);
  assert.deepEqual(rungsOfModel('haiku').length, 1);
});

test('chatLevel: the chat keeps one level, whatever the phase, size or subject (or35)', () => {
  assert.deepEqual(chatLevel(), { model: POLICY.chat.model, effort: POLICY.chat.effort });
  assert.deepEqual(chatLevel(), { model: 'opus', effort: 'high' });
});

test('the brain and recommend() read the policy, not a table of their own', () => {
  for (const [text, size] of [['pode construir', 'large'], ['corrige o bug do pagamento', 'small']]) {
    const w = weigh({ text, measured: { ok: true, kind: 'code', size, confidence: 'high' } });
    assert.deepEqual({ model: w.model, effort: w.effort }, chatLevel(), text);
  }
  const rec = (args) => recommend({ ...args, others: { keys: {} }, stats: [] });
  for (const kind of ['search', 'bulk', 'code', 'security', 'money']) {
    const r = rec({ kind, size: 'small' }).worker;
    assert.deepEqual({ model: r.model, effort: r.effort }, levelFor(kind), kind);
  }
  assert.deepEqual(rec({ kind: 'code', size: 'small', failedBefore: ['claude:sonnet'] }).worker.model, 'opus');
  assert.equal(rec({ kind: 'text', size: 'small' }).worker.model, 'haiku');
});

test('the page in docs/standard is exactly what policyPage() generates', () => {
  assert.equal(readFileSync(PAGE_FILE, 'utf8'), policyPage(), 'run: node server/ai/policy.mjs --write');
  const page = policyPage();
  assert.match(page, /^# Política de modelos/);
  for (const k of KINDS) assert.match(page, new RegExp(`\`${k}\``));
  assert.match(page, /medido em 2026-10-13: plan 8\/8 \(or30\)/);
  assert.match(page, /Escada de falhas/);
  assert.match(page, /Fases da conversa/);
  assert.match(page, /1\. Haiku, nível baixo/);
  assert.match(page, /6\. Fable, nível alto/);
});
