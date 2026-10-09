import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitTree, packCircles, ownerHue, initial, workCellPhase, fusionGhosts, filesByFolder,
} from '../server/web/body.js';

const units = [
  { id: 'organ', level: 'organ', parentId: null },
  { id: 'tissue', level: 'tissue', parentId: 'organ' },
  { id: 'a', level: 'cell', parentId: 'tissue' },
  { id: 'b', level: 'cell', parentId: 'tissue' },
  { id: 'free', level: 'cell', parentId: null },
  { id: 'lost', level: 'cell', parentId: 'gone' },
];

test('unitTree finds children, roots and the root ancestor', () => {
  const tree = unitTree(units);
  assert.deepEqual(tree.children('tissue').map((u) => u.id), ['a', 'b']);
  assert.deepEqual(tree.roots.map((u) => u.id), ['organ', 'free', 'lost'], 'a missing parent makes the unit a root');
  assert.equal(tree.rootOf('a').id, 'organ');
  assert.deepEqual(tree.ancestors('a').map((u) => u.id), ['tissue', 'organ']);
  assert.deepEqual(tree.descendants('organ').map((u) => u.id).sort(), ['a', 'b', 'tissue']);
});

test('packCircles keeps circles apart and inside the enclosing circle', () => {
  const items = [30, 22, 18, 18, 12, 9, 40].map((r, i) => ({ id: `c${i}`, r }));
  const pad = 6;
  const out = packCircles(items, pad);
  assert.equal(out.items.length, items.length);
  for (let i = 0; i < out.items.length; i++) {
    const p = out.items[i];
    assert.ok(Math.hypot(p.x, p.y) + p.r <= out.r + 1e-6, `${p.id} inside`);
    for (let j = i + 1; j < out.items.length; j++) {
      const q = out.items[j];
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r + pad - 0.5, `${p.id} and ${q.id} apart`);
    }
  }
  assert.deepEqual(packCircles(items, pad), out, 'deterministic');
});

test('packCircles with one child centres it', () => {
  const out = packCircles([{ id: 'x', r: 10 }], 4);
  assert.deepEqual([out.items[0].x, out.items[0].y], [0, 0]);
  assert.equal(out.r, 10);
  assert.equal(packCircles([], 4).r, 0);
});

test('ownerHue is stable per e-mail and initial reads the first letter', () => {
  assert.equal(ownerHue('ana@example.com'), ownerHue('ANA@example.com '));
  assert.notEqual(ownerHue('ana@example.com'), ownerHue('rui@example.com'));
  const hue = ownerHue('x@y.z');
  assert.ok(hue >= 0 && hue < 360);
  assert.equal(initial('Ana Lima'), 'A');
  assert.equal(initial('  émile'), 'É');
  assert.equal(initial(''), '?');
});

test('workCellPhase: absent before birth, alive until merged', () => {
  const wc = { bornAt: '2026-09-01T00:00:00Z', mergedAt: '2026-09-05T00:00:00Z' };
  assert.equal(workCellPhase(wc, Date.parse('2026-08-31')), 'unborn');
  assert.equal(workCellPhase(wc, Date.parse('2026-09-02')), 'alive');
  assert.equal(workCellPhase(wc, Date.parse('2026-09-05')), 'fused');
  assert.equal(workCellPhase({ bornAt: wc.bornAt, mergedAt: null }, Date.parse('2027-01-01')), 'alive');
});

test('fusionGhosts turns fused-by-meaning events into a cell that lived until the fusion', () => {
  const project = {
    chats: [{ sessionId: 's1', startedAt: '2026-10-05T10:00:00Z' }],
    activity: [
      { kind: 'fused-by-meaning', ts: '2026-10-06T09:00:00Z', unitIds: ['typo'], sessionId: 's1', subject: 'x' },
      { kind: 'fused-by-meaning', ts: '2026-10-06T09:00:00Z', unitIds: ['typo'], subject: 'no conversation' },
      { kind: 'grouped', ts: '2026-10-06T09:00:00Z', unitIds: ['t', 'a'] },
    ],
  };
  assert.deepEqual(fusionGhosts(project), [{
    id: 'ghost:s1', unitId: 'typo', sessionId: 's1', from: Date.parse('2026-10-05T10:00:00Z'), until: Date.parse('2026-10-06T09:00:00Z'),
  }]);
});

test('filesByFolder groups organelles by folder, folders sorted', () => {
  const groups = filesByFolder([
    { path: 'src/search/index.ts', status: 'M' },
    { path: 'README.md', status: 'M' },
    { path: 'src/search/trigram.ts', status: 'A' },
    { path: 'src/products/query.ts', status: 'M' },
  ]);
  assert.deepEqual(groups.map((g) => g.folder), ['', 'src/products', 'src/search']);
  assert.deepEqual(groups[2].files.map((f) => f.name), ['index.ts', 'trigram.ts']);
});
