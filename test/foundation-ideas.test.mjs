import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyIdea, newIdea, evaluateIdea, levelOf, canMarkDone, attestCheck, acceptUnverified, resizeIdea, markDone, reopenIdea,
} from '../server/foundation/ideas.mjs';
import { loadStandard, stagesFor } from '../server/foundation/standard.mjs';

const STD = loadStandard(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'standard'));
const NOW = '2026-10-10T12:00:00.000Z';
const day = (n) => new Date(Date.parse(NOW) + n * 86400000).toISOString();

// A tiny standard so each state is easy to point at.
const MINI = [
  { id: '03.a', stage: '03', text: 'A', detect: 'x', severity: 'E', when: null, whenText: null, raise: null },
  { id: '03.b', stage: '03', text: 'B', detect: 'x', severity: 'E', when: null, whenText: null, raise: null },
  { id: '03.c', stage: '03', text: 'C', detect: 'x', severity: 'R', when: null, whenText: null, raise: null },
  { id: '03.web', stage: '03', text: 'W', detect: 'x', severity: 'E', when: { types: ['web'] }, whenText: 'web', raise: null },
  { id: '05.out', stage: '05', text: 'S', detect: 'x', severity: 'E', when: null, whenText: null, raise: null },
];
const small = (over = {}) => ({ ...newIdea('ajustar o botao', { now: NOW }), ...over });

test('classifyIdea: fixing a text is trivial', () => {
  const c = classifyIdea('corrigir um texto');
  assert.equal(c.size, 'trivial');
  assert.deepEqual(c.sensitive, []);
  assert.deepEqual(c.origin, { size: 'guessed', sensitive: 'guessed' });
  assert.equal(classifyIdea('fix a typo in the footer').size, 'trivial');
});

test('classifyIdea: charging for a subscription is large and sensitive to money', () => {
  const c = classifyIdea('cobrar por assinatura');
  assert.equal(c.size, 'large');
  assert.ok(c.sensitive.includes('money'));
  const en = classifyIdea('charge users a monthly subscription');
  assert.equal(en.size, 'large');
  assert.ok(en.sensitive.includes('money'));
});

test('classifyIdea: login with Google is sensitive to auth and at least medium', () => {
  const c = classifyIdea('login com Google');
  assert.ok(c.sensitive.includes('auth'));
  assert.ok(['medium', 'large'].includes(c.size));
  assert.ok(classifyIdea('sign in with Google').sensitive.includes('auth'));
});

test('classifyIdea: other sensitive kinds, with and without accents', () => {
  assert.ok(classifyIdea('guardar o CPF e o telefone do cliente').sensitive.includes('personal-data'));
  assert.ok(classifyIdea('apagar a conta do usuário').sensitive.includes('delete'));
  assert.ok(classifyIdea('apagar a conta do usuario').sensitive.includes('delete'));
  assert.ok(classifyIdea('publicar o app na loja').sensitive.includes('publish'));
  assert.ok(classifyIdea('migração do banco em produção').sensitive.includes('production'));
  assert.ok(classifyIdea('corrigir falha de segurança').sensitive.includes('security'));
});

test('classifyIdea: a sensitive idea is never trivial, and a plain feature is not sensitive', () => {
  assert.notEqual(classifyIdea('corrigir o texto do login').size, 'trivial');
  const c = classifyIdea('adicionar um filtro por data na lista de pedidos');
  assert.deepEqual(c.sensitive, []);
  assert.ok(['small', 'medium'].includes(c.size));
});

test('classifyIdea: a whole new system is large', () => {
  assert.equal(classifyIdea('construir uma plataforma de reservas do zero').size, 'large');
});

test('classifyIdea: empty text is refused', () => {
  assert.throws(() => classifyIdea('   '), (e) => e.code === 'bad-idea');
});

test('newIdea: shape, deterministic id, guessed origin, owner overrides win and are validated', () => {
  const a = newIdea('cobrar por assinatura', { now: NOW });
  assert.match(a.id, /^idea:[0-9a-f]{8}$/);
  assert.equal(a.id, newIdea('cobrar por assinatura', { now: NOW }).id);
  assert.notEqual(a.id, newIdea('cobrar por assinatura', { now: day(1) }).id);
  assert.equal(a.createdAt, NOW);
  assert.equal(a.status, 'open');
  assert.equal(a.doneAt, null);
  assert.deepEqual(a.acceptedUnverified, []);
  assert.deepEqual(a.checks, []);
  assert.deepEqual(a.origin, { size: 'guessed', sensitive: 'guessed' });
  const o = newIdea('cobrar por assinatura', { now: NOW, size: 'small', sensitive: ['delete'] });
  assert.equal(o.size, 'small');
  assert.deepEqual(o.sensitive, ['delete']);
  assert.deepEqual(o.origin, { size: 'owner', sensitive: 'owner' });
  assert.throws(() => newIdea('x', { now: NOW, size: 'giant' }), (e) => e.code === 'bad-idea');
  assert.throws(() => newIdea('x', { now: NOW, sensitive: ['gossip'] }), (e) => e.code === 'bad-idea');
  assert.throws(() => newIdea('', { now: NOW }), (e) => e.code === 'bad-idea');
  assert.throws(() => newIdea('x'.repeat(2001), { now: NOW }), (e) => e.code === 'bad-idea');
});

test('evaluateIdea: medium + sensitive lists checks only of applicable stages; every check ends in one of the 4 states', () => {
  const idea = newIdea('login com Google', { now: NOW, size: 'medium', sensitive: ['auth'] });
  const profile = { types: ['web'] };
  const out = evaluateIdea(idea, { standard: STD, profile, now: NOW });
  const applicable = new Set(stagesFor({ size: 'medium', sensitive: ['auth'], profile }).filter((s) => s.applies).map((s) => s.stage));
  assert.ok(out.checks.length > 10);
  for (const c of out.checks) {
    assert.ok(applicable.has(c.stage), `check ${c.id} is from a hidden stage`);
    assert.ok(['pass', 'fail', 'unverified', 'na'].includes(c.state));
    assert.ok(['E', 'R', 'A'].includes(c.severity));
    assert.ok(Array.isArray(c.evidence));
    assert.ok(c.state !== 'unverified' || c.reason, 'unverified always carries a reason');
  }
  assert.equal(idea.checks.length, 0, 'the input idea is not mutated');
});

test('evaluateIdea: no linked practice means unverified / needs-human (never fail)', () => {
  const out = evaluateIdea(small(), { standard: MINI, profile: { types: ['web'] }, now: NOW });
  const a = out.checks.find((c) => c.id === '03.a');
  assert.deepEqual([a.state, a.reason, a.attest], ['unverified', 'needs-human', null]);
  assert.ok(!out.checks.some((c) => c.state === 'fail'));
});

test('evaluateIdea: a check from a hidden stage is absent; a profile-excluded check is na / not-applicable', () => {
  const lib = evaluateIdea(small({ size: 'small' }), { standard: MINI, profile: { types: ['library'] }, now: NOW });
  assert.ok(!lib.checks.some((c) => c.stage === '05'), 'stage 05 is outside a small idea');
  const w = lib.checks.find((c) => c.id === '03.web');
  assert.deepEqual([w.state, w.reason], ['na', 'not-applicable']);
});

test('evaluateIdea: states come from the practices linked by `standard` (fail beats unverified beats pass)', () => {
  const practices = { items: [
    { id: 'p1', standard: ['03.a'], state: 'pass', reason: null, evidence: [{ file: 'SECURITY.md', line: 3 }] },
    { id: 'p2', standard: ['03.b'], state: 'pass', reason: null, evidence: [] },
    { id: 'p3', standard: ['03.b'], state: 'fail', reason: null, evidence: [{ file: 'a.md', line: 1 }] },
    { id: 'p4', standard: ['03.c'], state: 'unverified', reason: 'no-token', evidence: [] },
    { id: 'p5', standard: ['03.c'], state: 'pass', reason: null, evidence: [] },
  ] };
  const out = evaluateIdea(small(), { standard: MINI, profile: {}, practices, now: NOW });
  const get = (id) => out.checks.find((c) => c.id === id);
  assert.deepEqual([get('03.a').state, get('03.a').evidence], ['pass', [{ file: 'SECURITY.md', line: 3 }]]);
  assert.equal(get('03.b').state, 'fail');
  assert.deepEqual([get('03.c').state, get('03.c').reason], ['unverified', 'no-token']);
});

test('evaluateIdea: a linked practice that is na makes the check na', () => {
  const practices = { items: [{ id: 'p1', standard: ['03.a'], state: 'na', reason: 'not-applicable', evidence: [] }] };
  const out = evaluateIdea(small(), { standard: MINI, profile: {}, practices, now: NOW });
  assert.equal(out.checks.find((c) => c.id === '03.a').state, 'na');
});

test('evaluateIdea: a valid attest passes an unlinked check; an expired one goes back to unverified / attest-expired', () => {
  let idea = evaluateIdea(small(), { standard: MINI, profile: {}, now: NOW });
  idea = attestCheck(idea, '03.a', { note: 'restore tested', days: 90, now: NOW });
  const ok = evaluateIdea(idea, { standard: MINI, profile: {}, now: day(30) });
  const a = ok.checks.find((c) => c.id === '03.a');
  assert.equal(a.state, 'pass');
  assert.equal(a.attest.note, 'restore tested');
  assert.equal(a.attest.at, NOW);
  assert.equal(a.attest.expiresAt, day(90));
  const old = evaluateIdea(idea, { standard: MINI, profile: {}, now: day(91) });
  const b = old.checks.find((c) => c.id === '03.a');
  assert.deepEqual([b.state, b.reason], ['unverified', 'attest-expired']);
});

test('attestCheck: unknown check, bad days and long notes are refused', () => {
  const idea = evaluateIdea(small(), { standard: MINI, profile: {}, now: NOW });
  assert.throws(() => attestCheck(idea, '03.zzz', { note: 'x', days: 90, now: NOW }), (e) => e.code === 'unknown-check');
  assert.throws(() => attestCheck(idea, '03.a', { note: 'x', days: 0, now: NOW }), (e) => e.code === 'bad-idea');
  assert.throws(() => attestCheck(idea, '03.a', { note: 'x', days: 366, now: NOW }), (e) => e.code === 'bad-idea');
  assert.throws(() => attestCheck(idea, '03.a', { note: 'x'.repeat(301), days: 90, now: NOW }), (e) => e.code === 'bad-idea');
});

test('evaluateIdea: severity is raised by the idea (a recommended check becomes essential when the idea is sensitive)', () => {
  const std = [{ id: '03.r', stage: '03', text: 'R', detect: 'x', severity: 'R', when: null, whenText: null, raise: { to: 'E', when: { sensitive: true } } }];
  const calm = evaluateIdea(small(), { standard: std, profile: {}, now: NOW });
  const hot = evaluateIdea(small({ sensitive: ['money'] }), { standard: std, profile: {}, now: NOW });
  assert.equal(calm.checks[0].severity, 'R');
  assert.equal(hot.checks[0].severity, 'E');
});

test('evaluateIdea is deterministic: same input, same bytes', () => {
  const idea = newIdea('login com Google', { now: NOW });
  const a = JSON.stringify(evaluateIdea(idea, { standard: STD, profile: { types: ['web'] }, now: NOW }));
  const b = JSON.stringify(evaluateIdea(idea, { standard: STD, profile: { types: ['web'] }, now: NOW }));
  assert.equal(a, b);
});

test('levelOf: unverified makes it provisional instead of failing; an essential fail blocks', () => {
  const none = levelOf({ checks: [] });
  assert.equal(none.level, 'complete');
  assert.equal(none.percent, 100);
  const prov = levelOf({ checks: [
    { state: 'pass', severity: 'E' }, { state: 'unverified', severity: 'E' }, { state: 'na', severity: 'E' },
  ] });
  assert.equal(prov.level, 'provisional');
  assert.equal(prov.provisional, true);
  assert.equal(prov.percent, 50);
  assert.deepEqual([prov.pass, prov.fail, prov.unverified, prov.na], [1, 0, 1, 1]);
  const blocked = levelOf({ checks: [{ state: 'fail', severity: 'E' }, { state: 'unverified', severity: 'R' }] });
  assert.equal(blocked.level, 'blocked');
  assert.equal(blocked.provisional, true);
  const open = levelOf({ checks: [{ state: 'fail', severity: 'R' }, { state: 'pass', severity: 'E' }] });
  assert.equal(open.level, 'open');
  assert.equal(levelOf({ checks: [{ state: 'pass', severity: 'E' }, { state: 'na', severity: 'R' }] }).level, 'complete');
});

test('canMarkDone: false with an essential fail', () => {
  const idea = { checks: [{ id: 'a', state: 'fail', severity: 'E' }, { id: 'b', state: 'pass', severity: 'E' }], acceptedUnverified: [] };
  const r = canMarkDone(idea);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, ['a']);
});

test('canMarkDone: false with an essential unverified unless it was accepted; non-essential never blocks', () => {
  const idea = { checks: [
    { id: 'a', state: 'unverified', severity: 'E' }, { id: 'b', state: 'unverified', severity: 'R' }, { id: 'c', state: 'fail', severity: 'R' },
  ], acceptedUnverified: [] };
  const r = canMarkDone(idea);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unverified, ['a']);
  assert.deepEqual(r.failed, []);
  const accepted = canMarkDone({ ...idea, acceptedUnverified: ['a'] });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.unverified, []);
});

test('acceptUnverified: only for an existing unverified check; idempotent', () => {
  let idea = evaluateIdea(small(), { standard: MINI, profile: {}, now: NOW });
  idea = acceptUnverified(idea, '03.a');
  idea = acceptUnverified(idea, '03.a');
  assert.deepEqual(idea.acceptedUnverified, ['03.a']);
  assert.throws(() => acceptUnverified(idea, '03.zzz'), (e) => e.code === 'unknown-check');
});

test('markDone / reopenIdea: done is refused with an essential fail; a provisional done needs the accepted risk', () => {
  const failing = { ...small(), checks: [{ id: 'a', state: 'fail', severity: 'E', stage: '03', reason: null, evidence: [], attest: null }] };
  assert.throws(() => markDone(failing, NOW), (e) => e.code === 'essential-failed');
  const open = { ...small(), checks: [{ id: 'a', state: 'unverified', severity: 'E', stage: '03', reason: 'needs-human', evidence: [], attest: null }] };
  assert.throws(() => markDone(open, NOW), (e) => e.code === 'essential-failed');
  const done = markDone(acceptUnverified(open, 'a'), NOW);
  assert.equal(done.status, 'done');
  assert.equal(done.doneAt, NOW);
  const back = reopenIdea(done);
  assert.equal(back.status, 'open');
  assert.equal(back.doneAt, null);
});

test('resizeIdea: the owner changes size and sensitive kinds; origin becomes owner; bad values refused', () => {
  const idea = newIdea('cobrar por assinatura', { now: NOW });
  const r = resizeIdea(idea, { size: 'medium', sensitive: ['money', 'auth'] });
  assert.equal(r.size, 'medium');
  assert.deepEqual(r.sensitive, ['auth', 'money']);
  assert.deepEqual(r.origin, { size: 'owner', sensitive: 'owner' });
  const onlySize = resizeIdea(idea, { size: 'small' });
  assert.deepEqual(onlySize.origin, { size: 'owner', sensitive: 'guessed' });
  assert.throws(() => resizeIdea(idea, { size: 'giant' }), (e) => e.code === 'bad-idea');
  assert.throws(() => resizeIdea(idea, {}), (e) => e.code === 'bad-idea');
});
