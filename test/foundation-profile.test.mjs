import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import {
  detectProfile, effectiveProfile, questionsFor, applyOwner, lawsFor, profileHash,
  readProfile, writeProfile, mergeDetected, emptyProfile, OWNER_LISTS,
} from '../server/foundation/profile.mjs';

const detected = (over = {}) => ({
  types: ['web', 'api'],
  stacks: [{ name: 'fastify', version: '5.1.0', file: 'package.json', line: 9 }],
  signals: [{ kind: 'personal-data', evidence: [{ file: 'db/schema.prisma', line: 5, sha: 'aaa' }] }],
  team: { kind: 'solo', authors: 1 },
  deploy: [{ name: 'railway', evidence: [{ file: 'railway.json', line: 1, sha: 'bbb' }] }],
  ...over,
});
const profile = (over = {}, owner = {}) => ({ ...emptyProfile(), detected: detected(over), owner: { ...emptyProfile().owner, ...owner } });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('detectProfile joins stacks, types, signals, team and deploy with evidence from a real folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-prof-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme-shop', dependencies: { fastify: '^5.1.0', stripe: '^16.0.1' } }, null, 2));
    writeFileSync(join(root, 'railway.json'), '{}');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    const census = await censusOf(root, null);
    const d = await detectProfile({ root, census, facts: [], authors: [{ commits: 5, bot: false }, { commits: 2, bot: true }] });
    assert.ok(d.stacks.some((s) => s.name === 'fastify' && s.version === '5.1.0' && s.line > 0));
    assert.ok(d.signals.some((s) => s.kind === 'payments' && s.evidence.length));
    assert.deepEqual(d.team, { kind: 'solo', authors: 1 });
    assert.deepEqual(d.deploy.map((x) => x.name), ['railway']);
    assert.ok(Array.isArray(d.types));
    assert.ok(!JSON.stringify(d).includes('SECRET'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectProfile with no authors leaves the team unknown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-prof-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"acme-lib"}');
    const d = await detectProfile({ root, census: await censusOf(root, null), facts: [], authors: [] });
    assert.equal(d.team.kind, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyOwner refuses a value outside the closed lists with bad-owner', () => {
  const p = profile();
  assert.equal(code(() => applyOwner(p, { money: 'lottery' })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { audience: ['kids', 'aliens'] })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { stage: 'ipo' })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { country: 'BRA' })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { types: ['toaster'] })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { color: 'red' })), 'bad-owner');
  assert.equal(code(() => applyOwner(p, { laws: ['MADE-UP'] })), 'bad-owner');
});

test('applyOwner accepts valid answers, normalises the country and does not touch detected or the input', () => {
  const p = profile();
  const before = JSON.stringify(p);
  const next = applyOwner(p, { country: 'br', money: 'subscription', audience: ['business'], stage: 'prototype' }, '2026-01-01T00:00:00.000Z');
  assert.equal(next.owner.country, 'BR');
  assert.equal(next.owner.money, 'subscription');
  assert.deepEqual(next.owner.audience, ['business']);
  assert.equal(next.owner.stage, 'prototype');
  assert.equal(next.askedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(next.detected, p.detected);
  assert.equal(JSON.stringify(p), before);
});

test('the owner correcting types changes effective and keeps detected', () => {
  const p = applyOwner(profile(), { types: ['mobile', 'api'] });
  assert.deepEqual(effectiveProfile(p.detected, p.owner).types, ['mobile', 'api']);
  assert.deepEqual(p.detected.types, ['web', 'api']);
  const cleared = applyOwner(p, { types: null });
  assert.deepEqual(effectiveProfile(cleared.detected, cleared.owner).types, ['web', 'api']);
});

test('effectiveProfile: the owner wins on team and laws, and detected fills the rest', () => {
  const p = applyOwner(profile(), { team: 'team', country: 'DE', money: 'sale' });
  const e = effectiveProfile(p.detected, p.owner);
  assert.equal(e.team.kind, 'team');
  assert.deepEqual(e.laws, ['GDPR']);
  assert.equal(e.money, 'sale');
  assert.deepEqual(e.signals.map((s) => s.kind), ['personal-data']);
  assert.deepEqual(effectiveProfile(p.detected, { ...p.owner, laws: ['CCPA'] }).laws, ['CCPA']);
});

test('lawsFor: BR is LGPD, EU is GDPR, others are empty', () => {
  assert.deepEqual(lawsFor('BR'), ['LGPD']);
  assert.deepEqual(lawsFor('DE'), ['GDPR']);
  assert.deepEqual(lawsFor('FR'), ['GDPR']);
  assert.deepEqual(lawsFor('JP'), []);
  assert.deepEqual(lawsFor(null), []);
});

test('a personal project and a system in the EU get different laws', () => {
  const personal = applyOwner(profile(), { money: 'personal', country: 'BR' });
  const eu = applyOwner(profile(), { money: 'sale', country: 'DE' });
  assert.notDeepEqual(effectiveProfile(personal.detected, personal.owner).laws, effectiveProfile(eu.detected, eu.owner).laws);
  assert.equal(effectiveProfile(personal.detected, personal.owner).money, 'personal');
});

test('questionsFor asks only what has no answer, and asks for laws when the country has none', () => {
  const keys = (p) => questionsFor(p).map((q) => q.key);
  assert.deepEqual(keys(profile({ team: { kind: null, authors: 0 } })), ['country', 'money', 'audience', 'stage', 'team']);
  assert.deepEqual(keys(profile()), ['country', 'money', 'audience', 'stage']);
  const answered = applyOwner(profile(), { country: 'BR', money: 'free', audience: ['general'], stage: 'growth' });
  assert.deepEqual(keys(answered), []);
  const jp = applyOwner(answered, { country: 'JP' });
  assert.deepEqual(keys(jp), ['laws']);
  assert.deepEqual(questionsFor(profile()).find((q) => q.key === 'money').options, OWNER_LISTS.money);
});

test('profileHash is stable for the same profile, ignores evidence lines and changes with the country', () => {
  const a = profile();
  const b = profile({ stacks: [{ name: 'fastify', version: '5.1.0', file: 'package.json', line: 40 }] });
  assert.equal(profileHash(a), profileHash(b));
  assert.match(profileHash(a), /^[0-9a-f]{16}$/);
  assert.notEqual(profileHash(applyOwner(a, { country: 'BR' })), profileHash(applyOwner(a, { country: 'DE' })));
});

test('owner survives a new detection, and the new detection replaces detected', () => {
  const p = applyOwner(profile(), { country: 'BR', money: 'ads' });
  const next = mergeDetected(p, detected({ types: ['cli'] }));
  assert.deepEqual(next.owner, p.owner);
  assert.deepEqual(next.detected.types, ['cli']);
  assert.equal(next.askedAt, p.askedAt);
});

test('readProfile gives an empty profile when nothing is stored; write then read round-trips', () => {
  const sm = mkdtempSync(join(tmpdir(), 'sm-prof-sm-'));
  try {
    assert.deepEqual(readProfile(sm, 'p1').owner, emptyProfile().owner);
    assert.equal(readProfile(sm, 'p1').detected, null);
    const p = applyOwner(profile(), { country: 'BR' });
    writeProfile(sm, 'p1', p, '2026-01-01T00:00:00.000Z');
    const back = readProfile(sm, 'p1');
    assert.deepEqual(back.detected, p.detected);
    assert.equal(back.owner.country, 'BR');
    assert.equal(back.version, 1);
    assert.equal(back.generatedAt, '2026-01-01T00:00:00.000Z');
  } finally { rmSync(sm, { recursive: true, force: true }); }
});
