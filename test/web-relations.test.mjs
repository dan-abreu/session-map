import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relationKey, strengthOf, declaredPairs, isDeclared, sortRelations, parseIgnored, serializeIgnored, splitIgnored, relationTip,
} from '../server/web/relations.js';

const link = (a, b, weight, kinds = ['shared-chat']) => ({ a, b, weight, since: null, reasons: kinds.map((kind) => ({ kind, text: kind })) });

test('relationKey: the two parts, the same for either order of reading', () => {
  assert.equal(relationKey({ a: 'api', b: 'web' }), 'api|web');
});

test('strengthOf: one reason is weak, two fair, three or more strong', () => {
  assert.deepEqual([1, 2, 3, 4].map(strengthOf), ['weak', 'fair', 'strong', 'strong']);
  assert.equal(strengthOf(0), 'weak');
});

test('declaredPairs: the arrows the README draws, between the parts they stand for', () => {
  const arch = {
    mermaid: 'flowchart LR\n  subgraph l["Layer"]\n    W["Web"]\n    A["Api"]\n    D["Database"]\n  end\n  W --> A\n  A --> D\n  W --> Ghost',
    parts: [{ id: 'web', name: 'Web' }, { id: 'api', name: 'Api' }, { id: 'db', name: 'Database' }],
  };
  assert.deepEqual([...declaredPairs(arch)].sort(), ['api|db', 'api|web']);
  assert.deepEqual([...declaredPairs({ mermaid: null, parts: arch.parts })], []);
  assert.deepEqual([...declaredPairs({ mermaid: 'not a flowchart', parts: arch.parts })], []);
});

test('isDeclared: written by the people (a part file pointing to the other, or a README arrow) versus only seen in the work', () => {
  const pairs = new Set(['api|db']);
  assert.equal(isDeclared(link('api', 'web', 1, ['file-ref']), pairs), true);
  assert.equal(isDeclared(link('api', 'db', 1), pairs), true);
  assert.equal(isDeclared(link('api', 'web', 3, ['shared-chat', 'shared-branch']), pairs), false);
});

test('sortRelations: strongest first, then more reasons, then by name; the input is left alone', () => {
  const links = [link('b', 'c', 1), link('a', 'c', 3), link('a', 'b', 3, ['shared-chat', 'lineage', 'shared-branch', 'file-ref']), link('a', 'd', 3)];
  const before = JSON.stringify(links);
  const name = (id) => id.toUpperCase();
  assert.deepEqual(sortRelations(links, name).map(relationKey), ['a|b', 'a|c', 'a|d', 'b|c']);
  assert.equal(JSON.stringify(links), before);
});

test('ignored relations are kept per project as a list of keys, and a damaged one is nothing', () => {
  const set = new Set(['a|b', 'c|d']);
  assert.deepEqual([...parseIgnored(serializeIgnored(set))].sort(), ['a|b', 'c|d']);
  for (const bad of [null, '', 'x', '{"a":1}', '[1,2]']) assert.deepEqual([...parseIgnored(bad)], [], String(bad));
  assert.deepEqual([...parseIgnored('["a|b",5,"c|d"]')].sort(), ['a|b', 'c|d'], 'only text keys are kept');
});

test('splitIgnored: what stays on the map, and what the person asked to stop seeing', () => {
  const links = [link('a', 'b', 1), link('a', 'c', 2)];
  const { shown, ignored } = splitIgnored(links, new Set(['a|c']));
  assert.deepEqual(shown.map(relationKey), ['a|b']);
  assert.deepEqual(ignored.map(relationKey), ['a|c']);
});

test('relationTip: "A ↔ B · 3 reasons" for the hover', () => {
  const tip = relationTip(link('a', 'b', 3, ['shared-chat', 'shared-branch', 'lineage']), (id) => id.toUpperCase(), (n) => `${n} reasons`);
  assert.equal(tip, 'A ↔ B · 3 reasons');
});
