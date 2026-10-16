import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, FIXED, FOUNDATION } from '../scripts/smoke.mjs';

// The smoke test of the running program (finish plan): what a change must not do is lose a page, a route or a key.

const run = (assets, routes) => ({ assets, routes });

test('nothing lost: a new key, a new route and a new page are not regressions', () => {
  const before = run({ '/app.js': { status: 200 } }, { '/api/a': { status: 200, keys: ['x', 'y'] } });
  const after = run({ '/app.js': { status: 200 }, '/new.js': { status: 200 } }, { '/api/a': { status: 200, keys: ['x', 'y', 'z'] }, '/api/b': { status: 200, keys: ['q'] } });
  assert.deepEqual(compare(before, after), []);
});

test('a lost page, a route that stopped answering, a route gone from the run and a key taken out are each named', () => {
  const before = run(
    { '/app.js': { status: 200 }, '/gone.js': { status: 200 } },
    { '/api/a': { status: 200, keys: ['x', 'y'] }, '/api/b': { status: 200, keys: ['q'] }, '/api/c': { status: 200, keys: ['k'] } },
  );
  const after = run({ '/app.js': { status: 200 } }, { '/api/a': { status: 200, keys: ['x'] }, '/api/b': { status: 500, keys: null, error: 'boom' } });
  assert.deepEqual(compare(before, after), [
    'asset /gone.js: 200 -> gone',
    'route /api/a: lost y',
    'route /api/b: 200 -> 500 (boom)',
    'route /api/c: gone from the run',
  ]);
});

test('a route that was empty before is not held to keys, and an array answer is not compared key by key', () => {
  const before = run({}, { '/api/f': { status: 404, keys: null }, '/api/list': { status: 200, keys: ['[array:full]'] } });
  const after = run({}, { '/api/f': { status: 200, keys: ['a'] }, '/api/list': { status: 200, keys: ['[array:empty]'] } });
  assert.deepEqual(compare(before, after), []);
});

test('the lists the smoke reads are only reads of the page', () => {
  for (const p of FIXED) assert.match(p, /^\/api\//);
  assert.ok(FOUNDATION.includes('uptodate') && FOUNDATION.includes('health'), 'the blocks of fd24 are watched');
});
