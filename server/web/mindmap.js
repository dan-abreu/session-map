import { layoutTree, edgePath } from './tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOGGLE = 30; // from a box's right side to the far side of its round toggle, where the curves start
const GAP_X = 74;
const GAP_Y = 12;
const TWEEN_MS = 300;
const FIT_PAD = 28;
const SCALE = [0.3, 1.6];
const READABLE = 0.85;

// The number of conversations on a box: a small button on its top edge, rebuilt only when it changes.
export function paintCount(el, count, memo) {
  const sig = count ? `${count.n}|${count.label}|${count.pressed}` : '';
  if (sig === memo.countSig) return;
  memo.countSig = sig;
  el.hidden = !count;
  if (!count) return;
  el.setAttribute('aria-label', count.label);
  el.setAttribute('aria-pressed', String(count.pressed));
  el.title = count.label;
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-chat');
  icon.append(use);
  const num = document.createElement('span');
  num.textContent = String(count.n);
  el.replaceChildren(icon, num);
}

const PULSE_MS = 1600;
export function pulseOn(el) {
  el.classList.remove('is-pulse');
  void el.offsetWidth;
  el.classList.add('is-pulse');
  clearTimeout(el.pulseTimer);
  el.pulseTimer = setTimeout(() => el.classList.remove('is-pulse'), PULSE_MS);
}

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const ease = (p) => 1 - (1 - p) ** 3;
const lerp = (a, b, p) => a + (b - a) * p;
const lerpBox = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });

// The horizontal mind map (desenho-3 § 2): rounded boxes per level, smooth curves, a round toggle beside each box,
// zoom and drag. The page hands it the tree and what lights each box; it owns only positions and motion.
// ctx: content(node) → DOM children of a box, signature(node) → string that changes when the content must be rebuilt,
// onPick(node), onToggle(node), onLink(link), toggleLabel(node, open), linkLabel(link), freeArea() → {left, top, width, height};
// count(node) → {n, label, pressed} or null: the number of conversations hung on the box, onCount(node) when it is pressed.
export function createMindmap(root, ctx) {
  const world = document.createElement('div');
  world.className = 'mm-world';
  const wires = svg('svg', { class: 'mm-wires', 'aria-hidden': 'true' });
  const edgeLayer = svg('g', { class: 'mm-edges' });
  const relLayer = svg('g', { class: 'mm-rels' });
  wires.append(edgeLayer, relLayer);
  world.append(wires);
  root.append(world);

  const nodes = new Map(); // id → {el, box, toggle, sig}
  let boxes = new Map(); // where each box is drawn now
  let edges = [];
  let rels = [];
  let tween = 0;
  let transform = { x: 0, y: 0, k: 1 };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const zoom = d3.zoom().scaleExtent(SCALE)
    .filter((e) => (e.type === 'wheel' || !e.button) && !e.target.closest?.('.mm-rel-hit'))
    .on('zoom', (e) => {
      transform = { x: e.transform.x, y: e.transform.y, k: e.transform.k };
      world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
    });
  const sel = d3.select(root).call(zoom).on('dblclick.zoom', null);

  function nodeEl(node) {
    let n = nodes.get(node.id);
    if (!n) {
      const el = document.createElement('div');
      el.className = `mm-node k-${node.kind}`;
      el.dataset.id = node.id;
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'mm-box';
      box.addEventListener('click', () => ctx.onPick(n.node));
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mm-toggle';
      toggle.append(svg('svg', { 'aria-hidden': 'true' }));
      toggle.firstChild.append(svg('use', { href: '#i-next' }));
      toggle.addEventListener('click', () => ctx.onToggle(n.node));
      const count = document.createElement('button');
      count.type = 'button';
      count.className = 'mm-count';
      count.hidden = true;
      count.addEventListener('click', () => ctx.onCount?.(n.node));
      el.append(box, toggle, count);
      world.append(el);
      n = { el, box, toggle, count, sig: null, countSig: null, node };
      nodes.set(node.id, n);
    }
    n.node = node;
    return n;
  }

  function paint(n, node, view) {
    const sig = ctx.signature(node);
    if (sig !== n.sig) {
      n.box.replaceChildren(...ctx.content(node));
      n.sig = sig;
    }
    paintCount(n.count, ctx.count?.(node) ?? null, n);
    const open = view.open.has(node.id);
    const has = node.children.length > 0;
    n.toggle.hidden = !has;
    if (has) {
      n.toggle.setAttribute('aria-expanded', String(open));
      n.toggle.setAttribute('aria-label', ctx.toggleLabel(node, open));
      n.toggle.title = ctx.toggleLabel(node, open);
    }
    const cls = n.el.classList;
    cls.toggle('is-open', open);
    cls.toggle('is-selected', view.selected === node.id);
    cls.toggle('is-live', view.live.has(node.id));
    cls.toggle('is-lit', Boolean(view.lit?.has(node.id)));
    cls.toggle('is-dim', Boolean(view.lit) && !view.lit.has(node.id));
    cls.toggle('is-match', Boolean(view.match?.has(node.id)));
    n.box.setAttribute('aria-current', view.selected === node.id ? 'true' : 'false');
  }

  function place(n, b, opacity) {
    n.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
    n.el.style.opacity = opacity;
  }

  function drawEdges(at) {
    edgeLayer.replaceChildren(...edges.map((e) => {
      const a = at.get(e.from), b = at.get(e.to);
      return a && b ? svg('path', { d: edgePath(a, b, TOGGLE), class: `mm-edge to-${e.kind}` }) : null;
    }).filter(Boolean));
    relLayer.replaceChildren(...rels.flatMap((l) => {
      const a = at.get(`pt:${l.a}`), b = at.get(`pt:${l.b}`);
      if (!a || !b) return [];
      const x1 = a.x + a.w + TOGGLE + 6, y1 = a.y + a.h / 2;
      const x2 = b.x + b.w + TOGGLE + 6, y2 = b.y + b.h / 2;
      const cx = Math.max(x1, x2) + 28 + Math.min(150, Math.abs(y2 - y1) * 0.2);
      const d = `M${x1},${y1}C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
      const hit = svg('path', { d, class: 'mm-rel-hit', tabindex: '0', role: 'button', 'aria-label': ctx.linkLabel(l) });
      const pick = () => ctx.onLink(l);
      hit.addEventListener('click', pick);
      hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      return [svg('path', { d, class: `mm-rel w-${l.weight}` }), hit];
    }));
  }

  // Lays the visible tree out again and moves every box from where it is to where it goes. anchor: the id of a box
  // that must stay still on screen (the one whose toggle was pressed), so the map does not jump under the pointer.
  function render(tree, view, { anchor = null } = {}) {
    const visible = [];
    const kindOf = new Map();
    const parentOf = new Map();
    const walk = (node, parent) => {
      visible.push(node);
      kindOf.set(node.id, node.kind);
      parentOf.set(node.id, parent);
      if (view.open.has(node.id)) for (const c of node.children) walk(c, node.id);
    };
    walk(tree, null);
    const ids = new Set(visible.map((n) => n.id));
    for (const [id, n] of nodes) {
      if (!ids.has(id)) {
        n.el.remove();
        nodes.delete(id);
      }
    }
    for (const node of visible) paint(nodeEl(node), node, view);
    const sizes = new Map(visible.map((node) => {
      const el = nodes.get(node.id).el;
      return [node.id, { w: el.offsetWidth, h: el.offsetHeight }];
    }));
    const next = layoutTree(tree, (id) => view.open.has(id), (node) => sizes.get(node.id), { gapX: GAP_X, gapY: GAP_Y });
    edges = next.edges.map((e) => ({ ...e, kind: kindOf.get(e.to) }));
    rels = view.relations ?? [];
    wires.setAttribute('width', String(next.width + 400));
    wires.setAttribute('height', String(next.height + 40));

    if (anchor && boxes.has(anchor) && next.boxes.has(anchor)) {
      const was = boxes.get(anchor), now = next.boxes.get(anchor);
      const dx = (was.x - now.x) * transform.k, dy = (was.y - now.y) * transform.k;
      if (dx || dy) sel.call(zoom.translateBy, dx / transform.k, dy / transform.k);
    }

    // A new box grows out of its parent; one that stays slides; all curves follow.
    const from = new Map();
    for (const [id, b] of next.boxes) {
      if (boxes.has(id)) from.set(id, boxes.get(id));
      else {
        const p = parentOf.get(id);
        const pb = (p && (boxes.get(p) ?? next.boxes.get(p))) || b;
        from.set(id, { x: pb.x + pb.w * 0.6, y: pb.y + pb.h / 2 - b.h / 2, w: b.w, h: b.h, fresh: true });
      }
    }
    cancelAnimationFrame(tween);
    const target = next.boxes;
    const instant = reduced.matches || !boxes.size;
    const start = performance.now();
    const frame = (now) => {
      const p = instant ? 1 : ease(Math.min(1, (now - start) / TWEEN_MS));
      const at = new Map();
      for (const [id, b] of target) {
        const f = from.get(id);
        const cur = p >= 1 ? b : lerpBox(f, b, p);
        at.set(id, cur);
        place(nodes.get(id), cur, f.fresh && p < 1 ? String(p) : '1');
      }
      drawEdges(at);
      boxes = at;
      if (p < 1) tween = requestAnimationFrame(frame);
    };
    if (instant) frame(start);
    else {
      for (const [id, f] of from) place(nodes.get(id), f, f.fresh ? '0' : '1');
      drawEdges(from);
      tween = requestAnimationFrame(frame);
    }
    boxes = instant ? boxes : new Map([...target].map(([id]) => [id, from.get(id)]));
    finalBoxes = target;
    size = { width: next.width, height: next.height };
  }

  let finalBoxes = new Map();
  let size = { width: 0, height: 0 };

  function moveTo(x, y, k, animate) {
    const t = d3.zoomIdentity.translate(x, y).scale(k);
    if (animate && !reduced.matches) sel.transition().duration(380).ease(d3.easeCubicOut).call(zoom.transform, t);
    else sel.call(zoom.transform, t);
  }

  // The whole map inside the free part of the stage. Readable text beats seeing every box at once: a map too tall keeps
  // at least READABLE, centred on the project box, and the rest is dragged into view.
  function fit(animate = false) {
    const area = ctx.freeArea();
    if (!size.width || area.width < 40) return;
    const k = Math.max(0.5, Math.min(1, (area.width - 2 * FIT_PAD) / (size.width + 120), Math.max(READABLE, (area.height - 2 * FIT_PAD) / size.height)));
    const w = size.width * k, hgt = size.height * k;
    const root = finalBoxes.values().next().value;
    const x = area.left + (w < area.width - 2 * FIT_PAD ? (area.width - w) / 2 : FIT_PAD);
    const y = hgt < area.height - 2 * FIT_PAD || !root
      ? area.top + (area.height - hgt) / 2
      : Math.min(area.top + FIT_PAD, Math.max(area.top + area.height - FIT_PAD - hgt, area.top + area.height / 2 - (root.y + root.h / 2) * k));
    moveTo(x, y, k, animate);
  }

  // Brings a box into the free area without changing the zoom, unless it is already in view.
  function reveal(id, { animate = true, center = false } = {}) {
    const b = finalBoxes.get(id);
    if (!b) return;
    const area = ctx.freeArea();
    const k = Math.max(transform.k, 0.75);
    const sx = transform.x + b.x * k, sy = transform.y + b.y * k;
    const inside = sx >= area.left + 12 && sy >= area.top + 12 && sx + b.w * k <= area.left + area.width - 12 && sy + b.h * k <= area.top + area.height - 12;
    if (inside && !center && k === transform.k) return;
    const x = area.left + area.width / 2 - (b.x + b.w / 2) * k;
    const y = area.top + area.height / 2 - (b.y + b.h / 2) * k;
    moveTo(x, y, k, animate);
  }

  function focus(id) {
    nodes.get(id)?.box.focus({ preventScroll: true });
  }

  // A short glow on the box a conversation of the list belongs to, once the map has brought it into view.
  function pulse(id) {
    const n = nodes.get(id);
    if (n) pulseOn(n.el);
  }

  return { render, fit, reveal, focus, pulse, zoomBy: (f) => sel.transition().duration(200).call(zoom.scaleBy, f) };
}
