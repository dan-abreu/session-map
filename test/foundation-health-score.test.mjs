import test from 'node:test';
import assert from 'node:assert/strict';
import { appliesTo, scoreOf, categoriesOf, coverageOf, sortGaps, WEIGHT } from '../server/foundation/health-score.mjs';

const it = (id, severity, state, extra = {}) => ({ id, category: id.split('.')[0], severity, state, ...extra });
const ctx = (over = {}) => ({ visibility: 'public', kinds: new Set(['code', 'users']), ...over });

test('weights are E 3, R 2, A 1', () => {
  assert.deepEqual({ ...WEIGHT }, { E: 3, R: 2, A: 1 });
});

test('score is round(100 * weight of pass / weight of pass + fail)', () => {
  // pass E(3) + fail R(2) + pass A(1) = 4 / 6 = 66.67 -> 67
  const items = [it('community.a', 'E', 'pass'), it('community.b', 'R', 'fail'), it('community.c', 'A', 'pass')];
  assert.equal(scoreOf(items), 67);
  assert.equal(scoreOf([it('a.x', 'E', 'pass')]), 100);
  assert.equal(scoreOf([it('a.x', 'E', 'fail')]), 0);
});

test('unverified and na stay out of the score', () => {
  const items = [it('a.x', 'E', 'pass'), it('a.y', 'E', 'fail'), it('a.z', 'E', 'unverified'), it('a.w', 'E', 'na')];
  assert.equal(scoreOf(items), 50);
});

test('nothing verified means no score, never zero', () => {
  assert.equal(scoreOf([]), null);
  assert.equal(scoreOf([it('a.x', 'E', 'unverified'), it('a.y', 'R', 'na')]), null);
  assert.equal(scoreOf(null), null);
});

test('categories carry their own score and the four counts', () => {
  const items = [
    it('community.a', 'E', 'pass'), it('community.b', 'E', 'fail'),
    it('security.a', 'E', 'unverified'), it('security.b', 'R', 'na'),
    it('hygiene.a', 'A', 'pass'),
  ];
  const c = categoriesOf(items);
  assert.deepEqual(c.community, { score: 50, pass: 1, fail: 1, unverified: 0, na: 0 });
  assert.deepEqual(c.security, { score: null, pass: 0, fail: 0, unverified: 1, na: 1 });
  assert.deepEqual(c.hygiene, { score: 100, pass: 1, fail: 0, unverified: 0, na: 0 });
});

test('coverage counts what was verified out of what applies', () => {
  const items = [it('a.x', 'E', 'pass'), it('a.y', 'E', 'fail'), it('a.z', 'E', 'unverified'), it('a.w', 'E', 'na')];
  assert.deepEqual(coverageOf(items), { verified: 2, applicable: 3 });
});

test('gaps come severity first (E, R, A), then category, then id, without touching the input', () => {
  const items = [
    it('security.z', 'A', 'fail'), it('community.b', 'R', 'fail'), it('security.a', 'E', 'fail'),
    it('community.a', 'E', 'fail'), it('community.a2', 'R', 'fail'),
  ];
  const before = items.map((x) => x.id);
  assert.deepEqual(sortGaps(items).map((x) => x.id), ['community.a', 'security.a', 'community.a2', 'community.b', 'security.z']);
  assert.deepEqual(items.map((x) => x.id), before);
});

test('T applies to everything', () => {
  assert.deepEqual(appliesTo({ applies: ['T'] }, ctx({ visibility: 'private', kinds: new Set() })), { applies: true });
});

test('what is only for public is not charged on a private repository', () => {
  assert.deepEqual(appliesTo({ applies: ['P'] }, ctx({ visibility: 'private' })), { applies: false, state: 'na', reason: 'private' });
  assert.deepEqual(appliesTo({ applies: ['P'] }, ctx()), { applies: true });
});

test('public-only with unknown visibility is not verified, not failed', () => {
  assert.deepEqual(appliesTo({ applies: ['P'] }, ctx({ visibility: 'unknown' })), { applies: false, state: 'unverified', reason: 'no-data' });
});

test('letters are OR: any one that holds makes the item apply', () => {
  // license is for public OR library: a private library still owes one
  assert.deepEqual(appliesTo({ applies: ['P', 'L'] }, ctx({ visibility: 'private', kinds: new Set(['code', 'library']) })), { applies: true });
  assert.deepEqual(appliesTo({ applies: ['P', 'L'] }, ctx({ visibility: 'private', kinds: new Set(['code']) })), { applies: false, state: 'na', reason: 'private' });
});

test('app with users, library and code each have their own not-applicable reason', () => {
  const none = ctx({ kinds: new Set() });
  assert.equal(appliesTo({ applies: ['U'] }, none).reason, 'no-users');
  assert.equal(appliesTo({ applies: ['L'] }, none).reason, 'not-library');
  assert.equal(appliesTo({ applies: ['C'] }, none).reason, 'no-code');
  assert.deepEqual(appliesTo({ applies: ['U'] }, ctx()), { applies: true });
  assert.deepEqual(appliesTo({ applies: ['L'] }, ctx({ kinds: new Set(['library']) })), { applies: true });
  assert.deepEqual(appliesTo({ applies: ['C'] }, ctx()), { applies: true });
});

test('a library is not charged what only an app with users owes', () => {
  assert.equal(appliesTo({ applies: ['P', 'U'] }, ctx({ visibility: 'private', kinds: new Set(['code', 'library']) })).state, 'na');
  assert.equal(appliesTo({ applies: ['U'] }, ctx({ kinds: new Set(['code', 'library']) })).reason, 'no-users');
});
