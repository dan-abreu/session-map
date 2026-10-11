// The project's folders and files on the left of the mind map (mind-map-page mm39): the list made into boxes, the marks
// of what is new or changed, and the layout mirrored to the left of the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree, edgePath, joinSides } from '../server/web/tree.js';
import { withStatus, repoNodes, ownerIndex, partsOf, reach, editTargets, matchPaths, censusLine, listSig } from '../server/web/reposide.js';
import { settledOpacity } from '../server/web/mindmap.js';

const pending = (path, kind, extra = {}) => ({ id: `x:${path}:${kind}`, path, kind, state: 'pending', inFolder: true, added: 0, removed: 0, ts: '2026-10-10T10:00:00Z', ...extra });

test('withStatus marks what the folder holds unsaved: changed, new (even before the count knows it) and removed', () => {
  const files = [{ path: 'a.js', lines: 10, status: null, kind: 'code' }, { path: 'b.js', lines: 5, status: null, kind: 'code' }, { path: 'staged.js', lines: 3, status: null, kind: 'code' }];
  const rows = [
    pending('a.js', 'edit', { added: 2, removed: 1 }),
    pending('new.js', 'create', { id: 'wt:new.js', added: 7 }),
    pending('gone.js', 'delete', { removed: 9 }),
    pending('staged.js', 'create', { added: 3 }),
    { ...pending('b.js', 'edit'), state: 'saved' },
    { ...pending('c.js', 'edit'), inFolder: false },
  ];
  const out = new Map(withStatus(files, rows).map((f) => [f.path, f]));
  assert.equal(out.get('a.js').status, 'M');
  assert.equal(out.get('a.js').lines, 10, 'a counted file keeps the count');
  assert.equal(out.get('b.js').status, null, 'a saved change is no longer marked');
  assert.equal(out.get('staged.js').status, 'A', 'a new file already known to the count is new');
  assert.deepEqual([out.get('new.js').status, out.get('new.js').lines], ['A', 7], 'a file too new for the count shows up, with its lines');
  assert.equal(out.get('gone.js').status, 'D');
  assert.equal(out.get('gone.js').lines, undefined, 'a removed file has no lines');
  assert.ok(!out.has('c.js'), 'a change no longer in the folder adds nothing');
});

test('withStatus counts a new file\'s lines from the conversation\'s steps when the folder gave none', () => {
  const rows = [pending('n.js', 'edit', { added: 2, removed: 1, ts: '2026-10-10T10:05:00Z' }), pending('n.js', 'create', { added: 7, ts: '2026-10-10T10:00:00Z' })];
  const [f] = withStatus([], rows);
  assert.deepEqual([f.path, f.status, f.lines], ['n.js', 'A', 8]);
});

test('withStatus reads a moved file as new where it is now', () => {
  const [f] = withStatus([], [pending('lib/b.js', 'rename', { from: 'b.js' })]);
  assert.deepEqual([f.path, f.status], ['lib/b.js', 'A']);
});

test('repoNodes: the first level of the project as boxes, folders first with their file count, files with lines and marks', () => {
  const files = withStatus([
    { path: 'server/web/app.js', lines: 2000 }, { path: 'server/cli.mjs', lines: 80 }, { path: 'README.md', lines: 120 }, { path: 'docs/a/b.md', lines: 9 },
  ], [pending('server/web/app.js', 'edit'), pending('server/new.mjs', 'create', { added: 4 })]);
  const nodes = repoNodes(files);
  assert.deepEqual(nodes.map((n) => [n.kind, n.id, n.label]), [['folder', 'rd:docs/a', 'docs/a'], ['folder', 'rd:server', 'server'], ['file', 'rf:README.md', 'README.md']]);
  assert.ok(nodes.every((n) => n.side === 'left'), 'every box knows it grows to the left');
  const server = nodes[1];
  assert.equal(server.count, 3, 'a folder counts the files inside it, the new one too');
  assert.equal(server.changed, 2, 'a folder says how many files inside it are new or changed');
  assert.deepEqual(server.children.map((n) => n.id), ['rd:server/web', 'rf:server/cli.mjs', 'rf:server/new.mjs']);
  const fresh = server.children[2];
  assert.deepEqual([fresh.kind, fresh.path, fresh.lines, fresh.status, fresh.children], ['file', 'server/new.mjs', 4, 'A', []]);
  assert.equal(nodes[2].lines, 120);
  assert.equal(nodes[2].status, null);
  assert.equal(nodes[0].changed, 0);
});

test('edgePath mirrored runs from the toggle on the left of a box to the right side of its child', () => {
  assert.equal(edgePath({ x: 200, y: 0, w: 100, h: 40 }, { x: 0, y: 100, w: 80, h: 20 }, 20, { left: true }), 'M180,20C130,20 130,110 80,110');
});

test('joinSides hangs the left tree on the same root, mirrored: boxes right-aligned toward the root, centred on it', () => {
  const size = (node) => ({ w: { p: 120, a: 90, b: 60, a1: 80 }[node.id] ?? 100, h: 40 });
  const right = layoutTree({ id: 'p', children: [{ id: 'c1', children: [] }] }, () => true, size, { gapX: 50, gapY: 10 });
  const leftTree = { id: 'p', children: [{ id: 'a', children: [{ id: 'a1', children: [] }] }, { id: 'b', children: [] }] };
  const left = layoutTree(leftTree, (id) => id === 'p', size, { gapX: 50, gapY: 10 });
  const out = joinSides(right, left);
  assert.deepEqual([...out.boxes.keys()], ['p', 'c1', 'a', 'b'], 'the root stays first, the left boxes come after');
  const p = out.boxes.get('p');
  const a = out.boxes.get('a');
  const b = out.boxes.get('b');
  assert.equal(a.x + a.w, p.x - 50, 'a left box ends one gap before the root');
  assert.equal(b.x + b.w, p.x - 50, 'boxes of a column line up on the side facing the root');
  assert.equal((a.y + b.y + b.h) / 2, p.y + p.h / 2, 'the left side is centred on the root');
  assert.equal(out.boxes.get('c1').x, p.x + 120 + 50, 'the right side is untouched, only moved');
  assert.ok([...out.boxes.values()].every((x) => x.x >= 0 && x.y >= 0), 'everything is moved into view from the top-left corner');
  assert.equal(Math.min(...[...out.boxes.values()].map((x) => x.x)), 0);
  assert.equal(out.width, Math.max(...[...out.boxes.values()].map((x) => x.x + x.w)));
  assert.equal(out.height, Math.max(...[...out.boxes.values()].map((x) => x.y + x.h)));
  assert.deepEqual(out.edges, [{ from: 'p', to: 'c1' }, { from: 'p', to: 'a', side: 'left' }, { from: 'p', to: 'b', side: 'left' }]);
});

test('joinSides: a deeper left column sits one gap to the left of its parent', () => {
  const size = (node) => ({ w: { p: 120, a: 90, a1: 80 }[node.id] ?? 100, h: 40 });
  const right = layoutTree({ id: 'p', children: [] }, () => true, size, { gapX: 50, gapY: 10 });
  const left = layoutTree({ id: 'p', children: [{ id: 'a', children: [{ id: 'a1', children: [] }] }] }, () => true, size, { gapX: 50, gapY: 10 });
  const out = joinSides(right, left);
  const a = out.boxes.get('a');
  const a1 = out.boxes.get('a1');
  assert.equal(a1.x + a1.w, a.x - 50);
  assert.equal(a1.y, a.y);
});

test('withStatus leaves out what the count leaves out: a file only edited and not in the list, and secrets always', () => {
  const rows = [pending('package-lock.json', 'edit', { added: 40 }), pending('.env', 'create', { added: 2 }), pending('config/.env.local', 'edit'), pending('.env.example', 'create', { added: 3 })];
  const files = [{ path: '.env.production', lines: 4 }];
  assert.deepEqual(withStatus(files, rows).map((f) => [f.path, f.status]), [['.env.example', 'A']], 'only the template of a secrets file shows');
});

test('withStatus decides by the newest step: a file made and then removed is not shown at all', () => {
  const rows = [pending('tmp.txt', 'delete', { ts: '2026-10-10T10:05:00Z' }), pending('tmp.txt', 'create', { added: 3, ts: '2026-10-10T10:00:00Z' })];
  assert.deepEqual(withStatus([], rows), []);
  const back = [pending('b.txt', 'create', { added: 1, ts: '2026-10-10T10:09:00Z' }), pending('b.txt', 'delete', { ts: '2026-10-10T10:05:00Z' })];
  assert.deepEqual(withStatus([], back).map((f) => [f.path, f.status]), [['b.txt', 'A']], 'removed and made again is new');
});

test('withStatus marks the old place of a moved file as removed', () => {
  const out = withStatus([], [pending('lib/b.js', 'rename', { from: 'b.js' })]);
  assert.deepEqual(out.map((f) => [f.path, f.status]).sort(), [['b.js', 'D'], ['lib/b.js', 'A']]);
});

test('repoNodes: a removed file is marked but not counted in its folder', () => {
  const [docs] = repoNodes(withStatus([{ path: 'docs/a.md', lines: 1 }], [pending('docs/old.md', 'delete')]));
  assert.equal(docs.count, 1);
  assert.equal(docs.changed, 1);
  assert.deepEqual(docs.children.map((c) => [c.id, c.status]), [['rf:docs/a.md', null], ['rf:docs/old.md', 'D']]);
});

test('repoNodes shows at most 40 boxes in a folder, folders and marked files first, then one box for the rest', () => {
  const files = [
    ...Array.from({ length: 3 }, (_, i) => ({ path: `big/sub${i}/x.js`, lines: 1 })),
    ...Array.from({ length: 50 }, (_, i) => ({ path: `big/f${String(i).padStart(2, '0')}.js`, lines: 1, status: i >= 48 ? 'M' : null })),
  ];
  const [big] = repoNodes(files);
  assert.equal(big.children.length, 41);
  const more = big.children.at(-1);
  assert.deepEqual(more, { id: 'rm:big', kind: 'more', side: 'left', label: '+13', path: 'big', more: 13, children: [] });
  const ids = big.children.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 3), ['rd:big/sub0', 'rd:big/sub1', 'rd:big/sub2']);
  assert.ok(ids.includes('rf:big/f48.js') && ids.includes('rf:big/f49.js'), 'a marked file is never hidden');
  assert.deepEqual(ids.slice(3, 6), ['rf:big/f00.js', 'rf:big/f01.js', 'rf:big/f02.js'], 'the rest keep their order');
  assert.ok(!ids.includes('rf:big/f47.js'));
  const [all] = repoNodes(files, { expanded: new Set(['rm:big']) });
  assert.equal(all.children.length, 53, 'a folder asked whole shows everything');
});

// ---- the two sides together (mm40), work going on (mm41), files with no box (mm42) ----

const sample = () => repoNodes(withStatus([
  { path: 'server/web/app.js', lines: 10 }, { path: 'server/web/tree.js', lines: 5 }, { path: 'server/main.mjs', lines: 9 },
  { path: 'docs/a/b.md', lines: 2 }, { path: 'README.md', lines: 3 },
], []));

test('ownerIndex and partsOf: a file belongs to the parts the server read for it; a folder to the parts of every file inside', () => {
  const index = ownerIndex([
    { path: 'server/web/app.js', owners: ['web'] }, { path: 'server/web/tree.js', owners: ['web', 'map'] }, { path: 'server/main.mjs', owners: ['srv'] },
    { path: 'misc/x.js', owners: [] }, { path: 'new.js', status: 'A' },
  ]);
  assert.deepEqual(partsOf({ kind: 'file', path: 'server/web/tree.js' }, index), ['web', 'map']);
  assert.deepEqual(partsOf({ kind: 'folder', path: 'server' }, index).sort(), ['map', 'srv', 'web']);
  assert.deepEqual(partsOf({ kind: 'folder', path: 'serv' }, index), [], 'a folder is a whole name, not a beginning');
  assert.deepEqual(partsOf({ kind: 'file', path: 'new.js' }, index), []);
  assert.deepEqual(partsOf({ kind: 'more', path: 'server' }, index), []);
  assert.deepEqual(index.parts.get('web'), ['server/web/app.js', 'server/web/tree.js']);
});

test('reach: the boxes on the way to some files, the folders to open and the "+N more" boxes that hide them', () => {
  const out = reach(sample(), ['server/web/tree.js', 'README.md']);
  assert.deepEqual([...out.lit].sort(), ['rd:server', 'rd:server/web', 'rf:README.md', 'rf:server/web/tree.js']);
  assert.deepEqual([...out.open].sort(), ['rd:server', 'rd:server/web']);
  assert.deepEqual([...out.more], []);
  const files = Array.from({ length: 45 }, (_, i) => ({ path: `big/f${String(i).padStart(2, '0')}.js`, lines: 1 }));
  const hidden = reach(repoNodes(files), ['big/f44.js']);
  assert.deepEqual([...hidden.more], ['rm:big'], 'a file folded into "+N more" names that box');
  assert.ok(hidden.lit.has('rm:big') && hidden.lit.has('rd:big'));
  assert.deepEqual([...reach(repoNodes(files, { expanded: hidden.more }), ['big/f44.js']).more], [], 'once shown whole the file is reached');
});

test('editTargets: what each conversation at work does now, when it is editing a file; its running helpers the same way', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const entries = [
    { steps: [{ kind: 'think', target: '' }, { kind: 'edit', target: 'server/web/app.js' }, { kind: 'edit', target: 'old.js' }], workflows: [] },
    { steps: [{ kind: 'run', target: 'npm test' }, { kind: 'edit', target: 'before.js' }], workflows: [] },
    { steps: [], workflows: [{ agents: [
      { state: 'running', activeAt: '2026-10-10T11:59:00Z', step: { kind: 'edit', target: '…/web/tree.js' }, place: { projectId: 'p1', path: 'server/web/tree.js' } },
      { state: 'running', activeAt: '2026-10-10T11:59:00Z', step: { kind: 'edit', target: 'elsewhere.js' }, place: { projectId: 'other', path: 'elsewhere.js' } },
      { state: 'running', activeAt: '2026-10-10T11:59:00Z', step: { kind: 'read', target: 'x.js' }, place: { projectId: 'p1', path: 'x.js' } },
      { state: 'done', step: { kind: 'edit', target: 'done.js' }, place: { projectId: 'p1', path: 'done.js' } },
    ] }] },
  ];
  assert.deepEqual(editTargets(entries, { projectId: 'p1', nowMs: now }), ['server/web/app.js', 'server/web/tree.js', 'elsewhere.js']);
});

test('matchPaths: a step\'s path in the project, cut at its start or written from a folder inside it; only at a whole name, only when one fits', () => {
  const paths = ['server/web/app.js', 'server/web/tree.js', 'docs/tree.js', 'README.md'];
  const found = (targets) => [...matchPaths(targets, paths)].sort();
  assert.deepEqual(found(['server/web/app.js']), ['server/web/app.js']);
  assert.deepEqual(found(['…/web/tree.js']), ['server/web/tree.js']);
  assert.deepEqual(found(['…eb/app.js']), ['server/web/app.js'], 'a name cut in the middle is dropped, the rest must fit at a whole name');
  assert.deepEqual(found(['web/app.js']), ['server/web/app.js'], 'a conversation working inside server/ names web/app.js');
  assert.deepEqual(found(['pp.js', 'tree.js', '…eb/tree.js', 'nowhere.js', 'C:/dev/other/README.md', '/abs/README.md']), []);
});

test('repoNodes marks the files no part of the map counts (owners read and empty), and how many each folder holds', () => {
  const nodes = repoNodes(withStatus([
    { path: 'test/a.test.mjs', lines: 1, owners: [] }, { path: 'test/b.test.mjs', lines: 1, owners: ['t'] }, { path: 'README.md', lines: 1, owners: [] },
  ], [{ id: 'wt:test/new.mjs', path: 'test/new.mjs', kind: 'create', state: 'pending', inFolder: true, added: 2, removed: 0, ts: '' }]));
  const [test, readme] = nodes;
  assert.equal(readme.loose, true);
  assert.equal(test.loose, 1, 'a file too new for the count is not one of its files with no box');
  assert.deepEqual(test.children.map((c) => [c.id, c.loose]), [['rf:test/a.test.mjs', true], ['rf:test/b.test.mjs', false], ['rf:test/new.mjs', false]]);
});

test('a box that settled leaves its opacity to the stylesheet, so a dimmed box can fade; one growing in keeps its own', () => {
  assert.equal(settledOpacity('1'), '');
  assert.equal(settledOpacity('0.4'), '0.4');
});

// ---- the census on the files side (id77): counts, left-out files in grey, new files ----

const counted = (path, extra = {}) => ({ path, lines: 10, kind: 'code', owners: ['w'], census: { code: 6, comment: 3, blank: 1 }, excluded: null, new: false, ...extra });

test('repoNodes: a file carries its census counts, its reason for being left out and whether it is new', () => {
  const nodes = repoNodes(withStatus([
    counted('src/a.js'), counted('src/fresh.js', { lines: null, census: null, new: true }), counted('dist/out.js', { census: null, excluded: 'generated' }),
  ], []));
  const [src, dist] = [nodes.find((n) => n.path === 'src'), nodes.find((n) => n.path === 'dist')];
  const [a, fresh] = src.children;
  assert.deepEqual(a.census, { code: 6, comment: 3, blank: 1 });
  assert.equal(a.excluded, null);
  assert.deepEqual([fresh.status, fresh.census], ['A', null], 'a file git sees and no count has read yet is new, with no counts (not zero)');
  assert.equal(dist.children[0].excluded, 'generated');
});

test('repoNodes: a folder sums the counts of its files, turns grey when everything in it is left out, and counts what is new', () => {
  const nodes = repoNodes(withStatus([
    counted('src/a.js'), counted('src/sub/b.js', { census: { code: 1, comment: 2, blank: 3 } }), counted('src/fresh.js', { census: null, new: true }),
    counted('dist/o1.js', { census: null, excluded: 'generated' }), counted('dist/o2.js', { census: null, excluded: 'generated' }),
    counted('mix/x.js', { census: null, excluded: 'dep' }), counted('mix/y.js'),
  ], []));
  const by = Object.fromEntries(nodes.map((n) => [n.path, n]));
  assert.deepEqual(by.src.census, { code: 7, comment: 5, blank: 4 });
  assert.equal(by.src.changed, 1, 'the new file counts among what is new, changed or removed');
  assert.deepEqual([by.src.excluded, by.dist.excluded, by.mix.excluded], [false, true, false]);
  assert.equal(by.dist.census, null, 'a folder with nothing counted has no counts');
});

test('censusLine: code, comments and blank, in the words the census table uses; nothing when not counted', () => {
  const tt = (key) => ({ 'census.col.code': 'Code', 'census.col.comment': 'Comments', 'census.col.blank': 'Blank' })[key];
  assert.equal(censusLine({ code: 6, comment: 3, blank: 1 }, tt), 'Code: 6 · Comments: 3 · Blank: 1');
  assert.equal(censusLine(null, tt), '');
});

test('listSig changes when the census fields of a row do, so the side is drawn again', () => {
  const base = [counted('a.js')];
  assert.notEqual(listSig(base), listSig([counted('a.js', { census: { code: 7, comment: 3, blank: 1 } })]));
  assert.notEqual(listSig(base), listSig([counted('a.js', { new: true })]));
  assert.notEqual(listSig(base), listSig([counted('a.js', { census: null, excluded: 'dep' })]));
  assert.equal(listSig(base), listSig([counted('a.js')]));
});
