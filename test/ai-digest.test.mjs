import test from 'node:test';
import assert from 'node:assert/strict';
import { digestOf } from '../server/ai/digest.mjs';

const summary = (over = {}) => ({
  sessionId: '11111111-1111-4111-8111-111111111111',
  cwd: '/work/shop',
  title: 'Fix the checkout total',
  userPrompts: [],
  editedFiles: [],
  commits: [],
  ...over,
});

test('digestOf keeps the first 3 and last 5 prompts, each cut at 160 characters', () => {
  const prompts = Array.from({ length: 12 }, (_, i) => `p${i} ${'x'.repeat(300)}`);
  const d = digestOf(summary({ userPrompts: prompts }), null);
  assert.equal(d.prompts.length, 8);
  assert.deepEqual(d.prompts.map((p) => p.split(' ')[0]), ['p0', 'p1', 'p2', 'p7', 'p8', 'p9', 'p10', 'p11']);
  assert.ok(d.prompts.every((p) => p.length <= 160));
  assert.equal(d.title, 'Fix the checkout total');
});

test('digestOf caps files at 30 and commit subjects at the 10 most recent', () => {
  const editedFiles = Array.from({ length: 40 }, (_, i) => `/work/shop/src/f${i}.js`);
  const commits = Array.from({ length: 15 }, (_, i) => ({ hash: `h${i}`, subject: `c${i}` }));
  const d = digestOf(summary({ editedFiles, commits }), null);
  assert.equal(d.files.length, 30);
  assert.equal(d.files[0], 'src/f0.js');
  assert.deepEqual(d.commits, ['c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14']);
  assert.equal(d.branch, null);
});

test('digestOf adds the work cell branch, its files and last commit without repeating', () => {
  const workCell = {
    branch: 'feature/coupons', path: null,
    files: [{ path: 'src/cart.js', status: 'M' }, { path: 'src/coupon.js', status: 'A' }],
    lastCommit: { hash: 'h9', subject: 'add coupon field', ts: '2026-10-01T00:00:00Z' },
  };
  const d = digestOf(summary({ editedFiles: ['/work/shop/src/cart.js'], commits: [{ hash: 'h9', subject: 'add coupon field' }] }), workCell);
  assert.equal(d.branch, 'feature/coupons');
  assert.deepEqual(d.files, ['src/cart.js', 'src/coupon.js']);
  assert.deepEqual(d.commits, ['add coupon field']);
});

test('digestOf drops absolute files outside the conversation folder and tolerates a sparse summary', () => {
  const d = digestOf({ sessionId: 'x', cwd: '/work/shop', editedFiles: ['/elsewhere/secret.txt', 'rel/a.js'] }, null);
  assert.deepEqual(d.files, ['rel/a.js']);
  assert.deepEqual(d.prompts, []);
  assert.deepEqual(d.commits, []);
  assert.equal(d.title, '');
});
