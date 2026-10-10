// The project's folders and files on the left of the mind map (mind-map-page mm39): the list made into boxes, the marks
// of what is new or changed, and the layout mirrored to the left of the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree, edgePath, joinSides } from '../server/web/tree.js';
import { withStatus, repoNodes } from '../server/web/reposide.js';

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
