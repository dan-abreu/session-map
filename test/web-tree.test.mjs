import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archTree, defaultOpen, layoutTree, edgePath, searchTree, ancestorsOf, branchMarks, clashMarks, changedNodes,
  boardItems, relationLinks, nodeById, ownerHue, initial, filesByFolder, countLabel, listsDone, clashChip,
} from '../server/web/tree.js';
import { translator } from '../server/web/i18n.js';

const item = (code, title, extra = {}) => ({ code, title, detail: [], status: 'todo', who: null, weight: null, milestone: null, line: 10, ...extra });
const part = (id, name, groups, extra = {}) => ({
  id, name, file: `docs/architecture/${id}.md`, about: `${name} about`, codePaths: [], groups, refs: [],
  counts: { todo: 0, doing: 0, done: 0, withUser: 0, blocks: 0 }, chatIds: [], workCellIds: [], ...extra,
});

function project() {
  return {
    id: 'p1', name: 'acme-shop', mainBranch: 'main',
    arch: {
      source: 'worktree', dir: 'docs/architecture', lang: 'en',
      layers: [{ id: 'front', name: 'Front', partIds: ['shop', 'courier'] }, { id: 'back', name: 'Back', partIds: ['pay'] }],
      parts: [
        part('courier', 'Courier app', []),
        part('pay', 'Payments', [{ name: 'Cards', items: [item('pa01', 'Retry failed charges', { status: 'doing', who: 'Ana and Claude', weight: 'blocks' }), item('pa02', 'Refunds', { status: 'done' })] }]),
        part('shop', 'Storefront', [
          { name: '', items: [item('sh01', 'Product photos', { who: 'with Ana' })] },
          { name: 'Search', items: [item(null, 'Typo tolerance', { line: 22 }), item('sh03', 'Filters', { who: 'Claude' })] },
        ]),
      ],
      links: [{ a: 'pay', b: 'shop', weight: 2, since: null, reasons: [] }, { a: 'courier', b: 'shop', weight: 1, since: null, reasons: [] }],
    },
    chats: [
      { sessionId: 's1', partId: 'pay', status: 'busy', updatedAt: '2026-10-09T09:00:00Z', archived: false },
      { sessionId: 's2', partId: 'shop', status: 'idle', updatedAt: '2026-09-20T09:00:00Z', archived: false },
      { sessionId: 's3', partId: null, status: 'busy', updatedAt: '2026-10-09T09:00:00Z', archived: false },
    ],
    workCells: [
      { id: 'feat/a', branch: 'feat/a', partId: 'shop', status: 'active', owner: { name: 'ana', email: 'ana@x.test' }, clashWith: ['feat/b'] },
      { id: 'feat/b', branch: 'feat/b', partId: 'pay', status: 'idle', owner: { name: 'Bruno', email: 'bruno@x.test' }, clashWith: ['feat/a'] },
      { id: 'feat/old', branch: 'feat/old', partId: 'shop', status: 'merged', owner: { name: 'Ana', email: 'ana@x.test' }, clashWith: [] },
    ],
    activity: [
      { kind: 'commit', ts: '2026-10-09T08:00:00Z', partIds: ['courier'] },
      { kind: 'commit', ts: '2026-09-01T08:00:00Z', partIds: ['pay'] },
    ],
  };
}

test('archTree: project, layers in map order, parts, named groups, items; items with no group hang on the part', () => {
  const root = archTree(project());
  assert.equal(root.id, 'p');
  assert.equal(root.kind, 'project');
  assert.deepEqual(root.children.map((n) => [n.id, n.label]), [['l:front', 'Front'], ['l:back', 'Back']]);
  const [front] = root.children;
  assert.deepEqual(front.children.map((n) => n.id), ['pt:shop', 'pt:courier']);
  const shop = front.children[0];
  assert.deepEqual(shop.children.map((n) => [n.kind, n.id]), [['item', 'i:shop:sh01'], ['group', 'g:shop:Search']]);
  assert.deepEqual(shop.children[1].children.map((n) => n.id), ['i:shop:L22', 'i:shop:sh03'], 'an item with no code is known by its line');
  assert.equal(shop.children[1].children[0].item.title, 'Typo tolerance');
  assert.deepEqual(front.children[1].children, [], 'a part with no items has no children');
});

test('archTree counts done/total, open items with a person and blockers at every level', () => {
  const root = archTree(project());
  const n = (id) => nodeById(root, id);
  assert.deepEqual(n('pt:shop').counts, { total: 3, done: 0, doing: 0, withUser: 1, blocks: 0 });
  assert.deepEqual(n('g:pay:Cards').counts, { total: 2, done: 1, doing: 1, withUser: 1, blocks: 1 });
  assert.deepEqual(n('l:back').counts, n('g:pay:Cards').counts);
  assert.deepEqual(root.counts, { total: 5, done: 1, doing: 1, withUser: 2, blocks: 1 });
});

test('archTree of a project with no map is only the project', () => {
  const p = project();
  p.arch = { source: 'none', dir: null, lang: 'en', layers: [], parts: [], links: [] };
  const root = archTree(p);
  assert.deepEqual(root.children, []);
  assert.deepEqual([...defaultOpen(root)], ['p']);
});

test('defaultOpen opens the project and its layers, so the map shows down to the parts', () => {
  assert.deepEqual([...defaultOpen(archTree(project()))], ['p', 'l:front', 'l:back']);
});

test('layoutTree: columns by depth, children stacked, a parent centred on its children, closed nodes hide their subtree', () => {
  const root = archTree(project());
  const open = new Set(['p', 'l:front', 'l:back']);
  const size = (node) => ({ w: node.kind === 'project' ? 120 : 100, h: 40 });
  const { boxes, edges, width, height } = layoutTree(root, (id) => open.has(id), size, { gapX: 50, gapY: 10 });
  assert.deepEqual([...boxes.keys()], ['p', 'l:front', 'pt:shop', 'pt:courier', 'l:back', 'pt:pay']);
  assert.equal(boxes.get('l:front').x, 170, 'a column starts after the widest box of the one before, plus the gap');
  assert.equal(boxes.get('pt:shop').x, 320);
  assert.deepEqual([boxes.get('pt:shop').y, boxes.get('pt:courier').y, boxes.get('pt:pay').y], [0, 50, 100]);
  assert.equal(boxes.get('l:front').y, 25, 'centred between its two parts');
  assert.equal(boxes.get('p').y, (25 + 100) / 2);
  assert.equal(edges.length, 5);
  assert.deepEqual(edges[0], { from: 'p', to: 'l:front' });
  assert.equal(width, 420);
  assert.equal(height, 140);
  assert.ok(!boxes.has('i:shop:sh01'), 'a closed part keeps its items hidden');
});

test('edgePath is a smooth curve from the right of one box to the left of the next', () => {
  assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 200, y: 100, w: 80, h: 20 }, 20), 'M120,20C160,20 160,110 200,110');
});

test('searchTree finds items, parts and codes without caring for accents or case, with the path to open', () => {
  const root = archTree(project());
  assert.deepEqual(searchTree(root, 'typo').map((m) => m.id), ['i:shop:L22']);
  assert.deepEqual(searchTree(root, 'PA01').map((m) => m.id), ['i:pay:pa01']);
  assert.deepEqual(searchTree(root, 'pãyments').map((m) => m.id), ['pt:pay']);
  assert.deepEqual(searchTree(root, ' '), []);
  assert.deepEqual(ancestorsOf(root, 'i:shop:L22'), ['p', 'l:front', 'pt:shop', 'g:shop:Search']);
});

test('branchMarks gives each part the initials and colour of who has a branch open there; merged ones are gone', () => {
  const marks = branchMarks(project());
  assert.deepEqual(marks.get('shop').map((m) => [m.branch, m.initial]), [['feat/a', 'A']]);
  assert.equal(marks.get('shop')[0].hue, ownerHue('ana@x.test'));
  assert.deepEqual(marks.get('pay').map((m) => m.branch), ['feat/b']);
});

test('clashMarks puts a clash on the parts of both branches, once per pair', () => {
  const clashes = clashMarks(project());
  assert.deepEqual(clashes.get('shop'), [['feat/a', 'feat/b']]);
  assert.deepEqual(clashes.get('pay'), [['feat/a', 'feat/b']]);
});

test('changedNodes lights the parts with commits or chats since a date, and the boxes above them', () => {
  const root = archTree(project());
  const since = Date.parse('2026-10-09T00:00:00Z');
  assert.deepEqual([...changedNodes(project(), root, since)].sort(), ['l:back', 'l:front', 'p', 'pt:courier', 'pt:pay']);
  assert.deepEqual([...changedNodes(project(), root, Date.parse('2026-08-01'))].sort(), ['l:back', 'l:front', 'p', 'pt:courier', 'pt:pay', 'pt:shop']);
  assert.equal(changedNodes(project(), root, Date.parse('2026-08-01'), Date.parse('2026-08-02')).size, 0, 'a period that ends before everything lights nothing (mm06)');
  assert.ok(changedNodes(project(), root, since, Date.parse('2999-01-01')).has('pt:pay'), 'a period that ends later keeps what is inside');
});

test('boardItems sorts every item into todo, doing and done, blockers and items with a person first', () => {
  const cols = boardItems(project());
  assert.deepEqual(cols.todo.map((x) => x.item.title), ['Product photos', 'Typo tolerance', 'Filters']);
  assert.deepEqual(cols.doing.map((x) => [x.part.id, x.item.code, x.nodeId]), [['pay', 'pa01', 'i:pay:pa01']]);
  assert.deepEqual(cols.done.map((x) => x.item.code), ['pa02']);
  assert.equal(cols.todo[1].group, 'Search');
});

test('relationLinks keeps the links between parts of different layers', () => {
  assert.deepEqual(relationLinks(project()).map((l) => [l.a, l.b]), [['pay', 'shop']]);
});

test('ownerHue, initial and filesByFolder keep working for the panels', () => {
  assert.equal(ownerHue('Ana@x.test '), ownerHue('ana@x.test'));
  assert.equal(initial('  ana'), 'A');
  assert.equal(initial(''), '?');
  assert.deepEqual(filesByFolder([{ path: 'b/z.ts' }, { path: 'a.md' }, { path: 'b/a.ts' }]).map((g) => [g.folder, g.files.map((f) => f.name)]), [['', ['a.md']], ['b', ['a.ts', 'z.ts']]]);
});

test('countLabel reads "N open" everywhere when the map lists no done items, and "done of total" when it does', () => {
  const openOnly = { total: 212, done: 0, doing: 3, withUser: 20, blocks: 4 };
  assert.deepEqual(countLabel(openOnly, false), { kind: 'open', open: 212 });
  assert.deepEqual(countLabel({ total: 5, done: 0, doing: 0, withUser: 0, blocks: 0 }, true), { kind: 'done', done: 0, total: 5 }, 'a map that ticks items keeps 0/5 on a box with none done yet');
  assert.deepEqual(countLabel({ total: 5, done: 2, doing: 0, withUser: 0, blocks: 0 }, true), { kind: 'done', done: 2, total: 5 });
  assert.deepEqual(countLabel({ total: 0, done: 0, doing: 0, withUser: 0, blocks: 0 }, false), { kind: 'empty' });
  assert.equal(listsDone(archTree(project())), true);
  const p = project();
  for (const part of p.arch.parts) for (const g of part.groups) for (const i of g.items) i.status = 'todo';
  assert.equal(listsDone(archTree(p)), false);
});

test('clashMarks leaves out the pairs the person chose to ignore', () => {
  assert.equal(clashMarks(project(), new Set(['feat/a|feat/b'])).size, 0);
  assert.equal(clashMarks(project(), new Set(['feat/a|other'])).size, 2);
});

test('a part with several clashes shows one chip with the count, and every pair in its hint', () => {
  const t = translator('pt-BR');
  assert.equal(clashChip([], t), null);
  assert.deepEqual(clashChip([['a', 'b']], t), { label: 'choque', title: 'As linhas de trabalho a e b mexem no mesmo arquivo' });
  const three = clashChip([['a', 'b'], ['a', 'c'], ['b', 'c']], t);
  assert.equal(three.label, '3 choques');
  assert.equal(three.title.split(String.fromCharCode(10)).length, 3);
  assert.equal(clashChip([['a', 'b'], ['a', 'c']], translator('en')).label, '2 clashes');
});
