import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitTree, packCircles, ownerHue, initial, workCellPhase, fusionGhosts, filesByFolder, dormantUnits, collapseBots, ellipsize, placeBoxes, BOTS_ID, wrapLabel,
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

const DAY_MS = 864e5;
const NOW_MS = Date.parse('2026-10-09T12:00:00Z');
const daysAgo = (n) => new Date(NOW_MS - n * DAY_MS).toISOString();

test('dormantUnits: no chats, no branches and no commit for 14 days; a group of only dormant units is dormant too', () => {
  const unit = (id, over = {}) => ({ id, level: 'cell', parentId: null, chatIds: [], workCellIds: [], pinned: false, ...over });
  const project = {
    units: [
      unit('talking', { chatIds: ['c1'] }), unit('branching', { workCellIds: ['feat/x'] }), unit('committed'), unit('old-commit'),
      unit('empty'), unit('pinned-empty', { pinned: true }), unit('sleepy-a', { parentId: 'sleepy' }), unit('sleepy-b', { parentId: 'sleepy' }),
      unit('sleepy', { level: 'tissue' }), unit('mixed', { level: 'tissue' }), unit('kid-awake', { parentId: 'mixed', chatIds: ['c2'] }), unit('kid-asleep', { parentId: 'mixed' }),
    ],
    activity: [
      { kind: 'commit', ts: daysAgo(3), unitIds: ['committed'] },
      { kind: 'commit', ts: daysAgo(20), unitIds: ['old-commit'] },
    ],
  };
  assert.deepEqual([...dormantUnits(project, NOW_MS)].sort(), ['empty', 'kid-asleep', 'old-commit', 'sleepy', 'sleepy-a', 'sleepy-b']);
});

test('collapseBots folds bot branches into one cell per project and keeps the people\'s branches', () => {
  const cell = (id, owner, over = {}) => ({
    id, branch: id.replace(/^origin\//, ''), remote: id.startsWith('origin/'), owner: { name: owner, email: `${owner}@x` }, authors: [], unitId: 'api', touches: [],
    files: [{ path: `${id}.txt`, status: 'M' }], commits: 1, ahead: 1, status: 'idle', bornAt: daysAgo(30), mergedAt: null, clashWith: [], chatIds: [], lastCommit: null, ...over,
  });
  const cells = [
    cell('feat/pay', 'Ana', { clashWith: ['origin/dependabot/npm/x'], status: 'active' }),
    cell('origin/dependabot/npm/x', 'dependabot[bot]', { clashWith: ['feat/pay'], bornAt: daysAgo(40) }),
    cell('origin/renovate/react', 'renovate-bot', { commits: 2 }),
  ];
  const out = collapseBots(cells);
  assert.deepEqual(out.map((w) => w.id), ['feat/pay', BOTS_ID]);
  const bots = out[1];
  assert.equal(bots.bots.length, 2);
  assert.equal(bots.commits, 3);
  assert.equal(bots.unitId, 'unsorted');
  assert.equal(bots.bornAt, daysAgo(40));
  assert.deepEqual(out[0].clashWith, [BOTS_ID]);
  assert.deepEqual(collapseBots([cells[0]]).map((w) => w.id), ['feat/pay'], 'no bots, no group');
});

test('ellipsize cuts long branch names with an ellipsis and leaves short ones alone', () => {
  assert.equal(ellipsize('feat/pay', 18), 'feat/pay');
  assert.equal(ellipsize('dependabot/npm_and_yarn/fastify/swagger-ui-5.2.6', 18), 'dependabot/npm_an…');
  assert.equal(ellipsize('dependabot/npm_and_yarn/fastify/swagger-ui-5.2.6', 18).length, 18);
});

test('placeBoxes keeps labels in priority order without overlap and slides them inside the view', () => {
  const box = (id, x0, x1, y0, y1) => ({ id, x0, x1, y0, y1 });
  const placed = placeBoxes([
    box('organ', 100, 200, 10, 30),
    box('overlaps-organ', 150, 260, 20, 40),
    box('below', 150, 260, 41, 60),
    box('off-right', 360, 440, 100, 120),
    box('too-wide', -10, 500, 200, 220),
  ], { width: 390, pad: 4 });
  assert.deepEqual(placed.get('organ'), { dx: 0 });
  assert.equal(placed.get('overlaps-organ'), null);
  assert.deepEqual(placed.get('below'), { dx: 0 });
  assert.deepEqual(placed.get('off-right'), { dx: -54 });
  assert.equal(placed.get('too-wide'), null);
});

test('wrapLabel keeps two lines and ends the second with an ellipsis, never repeating a line', () => {
  assert.deepEqual(wrapLabel('Roteiro de automação do Chrome', 16), ['Roteiro de', 'automação do…']);
  assert.deepEqual(wrapLabel('Motor da home', 16), ['Motor da home']);
  assert.deepEqual(wrapLabel('Artes e cores para redes', 16), ['Artes e cores', 'para redes']);
});

test('placeBoxes also keeps a label off the shapes it is told to avoid', () => {
  const placed = placeBoxes([
    { id: 'branch', x0: 10, x1: 90, y0: 50, y1: 62, avoid: [{ x0: 60, x1: 120, y0: 40, y1: 100 }] },
    { id: 'free', x0: 10, x1: 50, y0: 200, y1: 212, avoid: [{ x0: 60, x1: 120, y0: 40, y1: 100 }] },
  ], { width: 390 });
  assert.equal(placed.get('branch'), null);
  assert.deepEqual(placed.get('free'), { dx: 0 });
});
