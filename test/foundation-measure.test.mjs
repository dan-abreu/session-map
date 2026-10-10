import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { measure, formatTable, FIXTURES } from '../scripts/measure-foundation.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';

const NAMES = ['acme-shop', 'acme-delivery', 'acme-lib'];
const withExtra = (mutate) => (root, census, prev, opts) => {
  const out = extractAll(root, census, prev, opts);
  return mutate(out);
};

test('the three answer keys score accuracy 1 and invention 0, overall and per kind', async () => {
  const r = await measure();
  assert.deepEqual(FIXTURES, NAMES);
  assert.equal(r.ok, true, r.failures.join('\n'));
  assert.deepEqual(r.failures, []);
  for (const name of NAMES) {
    const fx = r.fixtures[name];
    assert.equal(fx.total.accuracy, 1, name);
    assert.equal(fx.total.invention, 0, name);
    assert.ok(fx.total.expected > 0);
    for (const [kind, row] of Object.entries(fx.kinds)) {
      assert.equal(row.accuracy, 1, `${name} ${kind}`);
      assert.equal(row.invention, 0, `${name} ${kind}`);
    }
  }
});

test('an invented fact makes measure() fail the invention limit', async () => {
  const r = await measure({
    fixtures: ['acme-lib'],
    extract: withExtra((out) => ({ ...out, facts: [...out.facts, { kind: 'route', id: 'route:GET /ghost', file: 'src/index.js', line: 1, origin: 'EXTRACTED', refs: [] }] })),
  });
  assert.equal(r.ok, false);
  assert.ok(r.fixtures['acme-lib'].kinds.route.invention > 0);
  assert.ok(r.failures.some((f) => f.includes('acme-lib') && f.includes('route') && f.includes('invention')));
});

test('a fact on the wrong line counts as a miss and as an invention', async () => {
  const r = await measure({
    fixtures: ['acme-lib'],
    extract: withExtra((out) => {
      const facts = out.facts.map((f, i) => (i === 0 ? { ...f, line: f.line + 1 } : f));
      return { ...out, facts };
    }),
  });
  const total = r.fixtures['acme-lib'].total;
  assert.equal(r.ok, false);
  assert.ok(total.accuracy < 1);
  assert.ok(total.invention > 0);
  assert.equal(total.invented, 1);
  assert.equal(total.expected - total.found, 1);
});

test('a missing fact fails the accuracy limit', async () => {
  const r = await measure({ fixtures: ['acme-lib'], extract: withExtra((out) => ({ ...out, facts: out.facts.slice(1) })) });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.includes('accuracy')));
});

test('the table shows percentages and the script exits 0 on the real fixtures', () => {
  const text = formatTable({ fixtures: { x: { kinds: { route: { expected: 2, found: 2, extracted: 2, invented: 0, accuracy: 1, invention: 0 } }, total: { expected: 2, found: 2, extracted: 2, invented: 0, accuracy: 1, invention: 0 } } }, ok: true, failures: [] });
  assert.match(text, /100(\.0)? ?%/);
  const out = execFileSync(process.execPath, ['scripts/measure-foundation.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  assert.match(out, /acme-shop/);
  assert.match(out, /100/);
});
