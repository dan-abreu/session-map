// The architecture as a mind map (desenho-3 § 2): the tree, its layout and what lights its boxes. Pure: no DOM, so
// node:test can load it, and the desktop map and the phone outline share it.

const EMPTY_COUNTS = () => ({ total: 0, done: 0, doing: 0, withUser: 0, blocks: 0 });
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export const isPerson = (who) => Boolean(who) && plain(who) !== 'claude';

function itemCounts(item) {
  const open = item.status !== 'done';
  return {
    total: 1,
    done: open ? 0 : 1,
    doing: item.status === 'doing' ? 1 : 0,
    withUser: open && isPerson(item.who) ? 1 : 0,
    blocks: open && item.weight === 'blocks' ? 1 : 0,
  };
}

function sumCounts(nodes) {
  const out = EMPTY_COUNTS();
  for (const n of nodes) for (const k of Object.keys(out)) out[k] += n.counts[k];
  return out;
}

const itemId = (partId, item) => `i:${partId}:${item.code ?? `L${item.line}`}`;

function itemNode(part, group, item) {
  return { id: itemId(part.id, item), kind: 'item', label: item.title, partId: part.id, group, item, children: [], counts: itemCounts(item) };
}

function partNode(part) {
  // Items under no ### heading hang on the part itself; a named group is a box of its own.
  const children = part.groups.flatMap((g) => (g.name
    ? [{ id: `g:${part.id}:${g.name}`, kind: 'group', label: g.name, partId: part.id, group: g.name, children: g.items.map((i) => itemNode(part, g.name, i)) }]
    : g.items.map((i) => itemNode(part, '', i))));
  for (const c of children) if (c.kind === 'group') c.counts = sumCounts(c.children);
  return { id: `pt:${part.id}`, kind: 'part', label: part.name, partId: part.id, part, children, counts: sumCounts(children) };
}

export function archTree(project) {
  const arch = project.arch ?? { layers: [], parts: [] };
  const parts = new Map(arch.parts.map((p) => [p.id, p]));
  const layers = arch.layers.map((l) => {
    const children = l.partIds.filter((id) => parts.has(id)).map((id) => partNode(parts.get(id)));
    return { id: `l:${l.id}`, kind: 'layer', label: l.name, layerId: l.id, children, counts: sumCounts(children) };
  });
  return { id: 'p', kind: 'project', label: project.name, children: layers, counts: sumCounts(layers) };
}

function walk(node, fn, path = []) {
  fn(node, path);
  for (const c of node.children) walk(c, fn, [...path, node.id]);
}

export function nodeById(root, id) {
  let hit = null;
  walk(root, (n) => { if (n.id === id) hit = n; });
  return hit;
}

export function ancestorsOf(root, id) {
  let hit = null;
  walk(root, (n, path) => { if (n.id === id) hit = path; });
  return hit ?? [];
}

export const defaultOpen = (root) => new Set([root.id, ...root.children.map((c) => c.id)]);

// A tidy horizontal tree: one column per depth as wide as its widest box; leaves stacked; each parent centred on its
// children. size(node) → {w, h}. Returns the boxes (top-left corner) in reading order and the parent → child edges.
export function layoutTree(root, isOpen, size, { gapX = 56, gapY = 14 } = {}) {
  const visible = [];
  const colW = [];
  const collect = (node, depth) => {
    const s = size(node);
    const kids = isOpen(node.id) ? node.children : [];
    const entry = { node, depth, w: s.w, h: s.h, kids: [] };
    colW[depth] = Math.max(colW[depth] ?? 0, s.w);
    visible.push(entry);
    for (const k of kids) entry.kids.push(collect(k, depth + 1));
    return entry;
  };
  const top = collect(root, 0);
  const colX = [0];
  for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + gapX;
  const span = (e) => {
    if (e.span !== undefined) return e.span;
    const kids = e.kids.reduce((s, k) => s + span(k), 0) + gapY * Math.max(0, e.kids.length - 1);
    e.span = Math.max(e.h, kids);
    return e.span;
  };
  const boxes = new Map();
  const edges = [];
  const place = (e, y0) => {
    let cy;
    if (e.kids.length) {
      const kidsSpan = e.kids.reduce((s, k) => s + span(k), 0) + gapY * (e.kids.length - 1);
      let y = y0 + (span(e) - kidsSpan) / 2;
      const centres = e.kids.map((k) => {
        const c = place(k, y);
        y += span(k) + gapY;
        return c;
      });
      cy = (centres[0] + centres.at(-1)) / 2;
    } else {
      cy = y0 + span(e) / 2;
    }
    boxes.set(e.node.id, { x: colX[e.depth], y: cy - e.h / 2, w: e.w, h: e.h, depth: e.depth });
    for (const k of e.kids) edges.push({ from: e.node.id, to: k.node.id });
    return cy;
  };
  place(top, 0);
  const order = visible.map((e) => e.node.id);
  const sorted = new Map(order.map((id) => [id, boxes.get(id)]));
  const width = Math.max(...[...boxes.values()].map((b) => b.x + b.w));
  return { boxes: sorted, edges: order.flatMap((id) => edges.filter((e) => e.from === id)), width, height: span(top) };
}

// From the toggle on the right of a box to the middle of the left side of its child.
export function edgePath(a, b, toggle = 0) {
  const x1 = a.x + a.w + toggle, y1 = a.y + a.h / 2;
  const x2 = b.x, y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export function searchTree(root, query) {
  const q = plain(query);
  if (!q) return [];
  const out = [];
  walk(root, (n, path) => {
    if (n.kind === 'project') return;
    const hay = plain([n.label, n.item?.code, n.item?.who].filter(Boolean).join(' '));
    if (hay.includes(q)) out.push({ id: n.id, path });
  });
  return out;
}

function withAncestors(root, partIds, extra = []) {
  const lit = new Set(extra);
  walk(root, (n, path) => {
    if (n.kind === 'part' && partIds.has(n.partId)) for (const id of [...path, n.id]) lit.add(id);
  });
  return lit;
}

// "What changed": the parts with a commit, a branch event or a chat since `since` (ms). Items whose state changed
// are seen through the commits that edited the part's file, which counts as one of its paths.
export function changedNodes(project, root, since, until = Number.POSITIVE_INFINITY) {
  const parts = new Set();
  const inside = (iso) => { const ms = Date.parse(iso); return ms >= since && ms <= until; };
  for (const a of project.activity) if (inside(a.ts)) for (const id of a.partIds ?? []) parts.add(id);
  for (const c of project.chats) if (c.partId && inside(c.updatedAt)) parts.add(c.partId);
  return withAncestors(root, parts, parts.size ? [root.id] : []);
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export const ownerHue = (email) => Math.floor(hash(String(email).trim().toLowerCase()) * 360);

export function initial(name) {
  const first = [...String(name).trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

const alive = (w) => w.status !== 'merged' && w.partId;

export function branchMarks(project) {
  const out = new Map();
  for (const w of project.workCells.filter(alive)) {
    if (!out.has(w.partId)) out.set(w.partId, []);
    out.get(w.partId).push({ branch: w.branch, id: w.id, name: w.owner.name, initial: initial(w.owner.name), hue: ownerHue(w.owner.email) });
  }
  return out;
}

// ignored: the pairs the person chose to stop seeing, by the sorted ids of both branches (wa07).
export function clashMarks(project, ignored = new Set()) {
  const byId = new Map(project.workCells.map((w) => [w.id, w]));
  const out = new Map();
  const put = (partId, pair) => {
    if (!partId) return;
    const list = out.get(partId) ?? [];
    if (!list.some((p) => p[0] === pair[0] && p[1] === pair[1])) list.push(pair);
    out.set(partId, list);
  };
  for (const w of project.workCells) {
    if (w.status === 'merged') continue;
    for (const otherId of w.clashWith ?? []) {
      const o = byId.get(otherId);
      if (!o || o.status === 'merged' || ignored.has([w.id, o.id].sort().join('|'))) continue;
      const pair = [w.branch, o.branch].sort();
      put(w.partId, pair);
      put(o.partId, pair);
    }
  }
  return out;
}

// One chip per part, whatever the number of clashing pairs: "clash" or "3 clashes", with every pair in the hint.
export function clashChip(pairs, t) {
  if (!pairs.length) return null;
  return {
    label: pairs.length === 1 ? t('box.clashShort') : t.count('box.clashes', pairs.length),
    title: pairs.map(([a, b]) => t('box.clash', { a, b })).join('\n'),
  };
}

// The board's three columns, in map order; blockers and items waiting on a person rise to the top of each.
export function boardItems(project) {
  const cols = { todo: [], doing: [], done: [] };
  const root = archTree(project);
  walk(root, (n) => {
    if (n.kind !== 'item') return;
    const part = project.arch.parts.find((p) => p.id === n.partId);
    cols[n.item.status === 'done' ? 'done' : n.item.status].push({ nodeId: n.id, part, group: n.group, item: n.item });
  });
  const rank = (x) => (x.item.weight === 'blocks' ? 0 : 2) + (isPerson(x.item.who) ? 0 : 1);
  for (const k of ['todo', 'doing']) cols[k] = cols[k].map((x, i) => ({ x, i })).sort((p, q) => rank(p.x) - rank(q.x) || p.i - q.i).map(({ x }) => x);
  return cols;
}

// The dotted lines of "Show relations" join parts of different layers; parts side by side are already together.
export function relationLinks(project) {
  const layerOf = new Map();
  for (const l of project.arch?.layers ?? []) for (const id of l.partIds) layerOf.set(id, l.id);
  return (project.arch?.links ?? []).filter((l) => layerOf.has(l.a) && layerOf.has(l.b) && layerOf.get(l.a) !== layerOf.get(l.b));
}

export function filesByFolder(files) {
  const groups = new Map();
  for (const f of files) {
    const cut = f.path.lastIndexOf('/');
    const folder = cut < 0 ? '' : f.path.slice(0, cut);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ ...f, name: f.path.slice(cut + 1) });
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, list]) => ({ folder, files: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

// A map whose files keep only the open work (done items are deleted, not ticked) would read "0 of 212 done" everywhere:
// it reads "212 open" instead, at every level.
export const listsDone = (root) => root.counts.done > 0;

export function countLabel(counts, ticks) {
  if (!counts.total) return { kind: 'empty' };
  return ticks ? { kind: 'done', done: counts.done, total: counts.total } : { kind: 'open', open: counts.total - counts.done };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// The files and lines of a box (mm25) and its share of the program's lines: the program, a layer or a part; null for a
// group or an item, which own no files, and when the server sent no counts.
export function sizeOf(sizes, node) {
  if (!sizes?.total) return null;
  if (!['project', 'layer', 'part'].includes(node.kind)) return null;
  const own = node.kind === 'project' ? sizes.total : node.kind === 'layer' ? sizes.layers?.[node.layerId] : sizes.parts?.[node.partId];
  const files = own?.files ?? 0;
  const lines = own?.lines ?? 0;
  return { files, lines, share: sizes.total.lines ? round3(lines / sizes.total.lines) : 0 };
}

// A share as a whole percent; a box with something in it never reads 0%.
export const shareText = (share) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`);

const FILE_KINDS = ['screen', 'code', 'test', 'doc'];

// A box's files by kind (mm25), in a fixed order; only kinds it has, and only files the server counted.
export function kindCounts(files) {
  return FILE_KINDS.map((kind) => {
    const mine = files.filter((f) => f.kind === kind);
    return { kind, files: mine.length, lines: mine.reduce((n, f) => n + (f.lines ?? 0), 0) };
  }).filter((k) => k.files > 0);
}
