// The Flow's general view laid out by session-map itself (flow.md fl08). mermaid laid it out as one long left-to-right
// chain, about 2.4 times wider than tall, so it fitted the screen at a third of its size and nobody could read it. Here
// it is drawn the way a C4 diagram is: who uses the program in the top band, one band per layer of parts below, and
// what it uses on this computer and on the internet side by side in the bottom band. Every arrow goes down through its
// label (a label is a slot in the space between two bands, so labels never overlap and always sit on their arrow);
// an arrow between two parts of the same layer dips into the space below (or above) its band and comes back up; arrows
// with the same words from one box, or into one box, share one label. The layout is pure, so node:test checks it; the
// drawing at the end of the file only runs in the page. Copy, Markdown and .mmd still hand out the mermaid text.

export const GRID = {
  font: 14, labelFont: 12.5, titleFont: 15,
  boxText: 150, boxPadX: 14, boxPadY: 9, boxLine: 18, minBoxW: 96,
  labelText: 132, labelPadX: 5, labelPadY: 3, labelLine: 15.5,
  boxGap: 28, groupGap: 64, portGap: 15, passW: 8, passGap: 10, labelGap: 14,
  bandPad: 16, lanePad: 10, titleH: 30, gapMin: 44, gapPad: 18, margin: 8, sweeps: 8, settle: 24,
};

// A rough measure for tests and for a page that cannot measure: the width of a line of text in pixels.
export const roughMeasure = (s, size) => String(s).length * size * 0.52;

// Words into lines no wider than max; a single word longer than max keeps a line of its own.
export function wrapText(text, max, measure) {
  const lines = [];
  let cur = '';
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || measure(next) <= max) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// The order of a list of numbers with a minimum distance between neighbours that moves them least from where they want
// to be (pool adjacent violators). want: wanted positions in order; gaps[i]: least distance between i and i + 1;
// weight[i]: how hard i holds to its place. → positions.
export function spread(want, gaps, weight = want.map(() => 1)) {
  const off = [0];
  for (let i = 1; i < want.length; i++) off.push(off[i - 1] + gaps[i - 1]);
  const blocks = [];
  want.forEach((d, i) => {
    blocks.push({ v: d - off[i], w: weight[i], n: 1 });
    while (blocks.length > 1 && blocks.at(-2).v > blocks.at(-1).v) {
      const b = blocks.pop();
      const a = blocks.at(-1);
      a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w);
      a.w += b.w;
      a.n += b.n;
    }
  });
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.v + off[out.length]);
  return out;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// scene: { rows: [{ groups: [{ id, title, cls }] }], nodes: [{ id, label, group, shape }], edges: [{ index, from, to,
// label, kind, headAtStart }] } with the rows top to bottom and each edge written from the upper box to the lower one
// (headAtStart: the arrow's head belongs at `from`). → { width, height, bands, boxes, labels, paths }.
export function gridLayout(scene, { measure = roughMeasure } = {}) {
  const G = GRID;
  const rows = scene.rows ?? [];
  const R = rows.length;
  const groupOf = new Map();
  rows.forEach((r, ri) => r.groups.forEach((g, gi) => groupOf.set(g.id, { row: ri, gi })));

  // ---- the boxes, the edges and the labels they share ----
  const boxes = new Map();
  for (const n of scene.nodes ?? []) {
    const at = groupOf.get(n.group ?? null);
    if (!at || boxes.has(n.id)) continue;
    const lines = wrapText(n.label, G.boxText, (s) => measure(s, G.font));
    const text = Math.max(0, ...lines.map((l) => measure(l, G.font)));
    const extra = n.shape === 'hex' ? 26 : n.shape === 'stadium' ? 18 : 0;
    boxes.set(n.id, {
      key: `b:${n.id}`, id: n.id, type: 'box', level: 3 * at.row, row: at.row, gi: at.gi, group: n.group ?? null, shape: n.shape ?? 'box', lines,
      w: Math.ceil(Math.max(G.minBoxW, text + 2 * G.boxPadX + extra)),
      h: Math.ceil(lines.length * G.boxLine + 2 * G.boxPadY + (n.shape === 'db' ? 14 : 0)),
    });
  }
  const members = [];
  for (const e of scene.edges ?? []) {
    let s = boxes.get(e.from);
    let t = boxes.get(e.to);
    if (!s || !t || s === t) continue;
    let headAtStart = Boolean(e.headAtStart);
    if (s.row > t.row) {
      [s, t] = [t, s];
      headAtStart = !headAtStart;
    }
    members.push({ index: e.index, s, t, inner: s.row === t.row, text: String(e.label ?? '').trim(), kind: e.kind ?? 'arrow', headAtStart, also: e.also ?? [] });
  }
  const sig = (m) => `${m.text}|${m.kind}|${m.headAtStart}`;
  const outKey = (m) => `o|${m.s.id}|${m.inner ? 'in' : m.t.row}|${sig(m)}`;
  const inKey = (m) => `i|${m.t.id}|${m.inner ? 'in' : m.s.row}|${sig(m)}`;
  const tally = new Map();
  const bump = (k) => tally.set(k, (tally.get(k) ?? 0) + 1);
  for (const m of members) if (m.text) { bump(outKey(m)); bump(inKey(m)); }
  const units = new Map();
  for (const m of members) {
    const o = m.text ? tally.get(outKey(m)) : 1;
    const i = m.text ? tally.get(inKey(m)) : 1;
    const [key, type] = o >= 2 && o >= i ? [outKey(m), 'out'] : i >= 2 ? [inKey(m), 'in'] : [`solo|${m.index}`, 'solo'];
    if (!units.has(key)) units.set(key, { type, members: [], text: m.text, inner: m.inner });
    units.get(key).members.push(m);
  }

  // ---- where each label goes: an arrow inside a layer in the lane under its boxes; any other in a space between two
  // bands, the one next to the box several arrows share, else the emptiest ----
  const load = Array.from({ length: Math.max(0, R - 1) }, () => 0);
  const labelSize = (text) => {
    if (!text) return { lines: [], w: G.passW, h: 0 };
    const lines = wrapText(text, G.labelText, (s) => measure(s, G.labelFont));
    return { lines, w: Math.ceil(Math.max(...lines.map((l) => measure(l, G.labelFont))) + 2 * G.labelPadX), h: Math.ceil(lines.length * G.labelLine + 2 * G.labelPadY) };
  };
  const all = [...units.values()];
  const rank = (u) => (u.type !== 'solo' && !u.inner ? 0 : u.inner ? 1 : 2);
  all.sort((a, b) => rank(a) - rank(b) || (a.members[0].t.row - a.members[0].s.row) - (b.members[0].t.row - b.members[0].s.row) || a.members[0].index - b.members[0].index);
  for (const u of all) {
    const m = u.members[0];
    Object.assign(u, labelSize(u.text));
    if (u.inner) {
      u.level = 3 * m.s.row + 1;
      continue;
    }
    let choices;
    if (u.type === 'out') choices = [m.s.row];
    else if (u.type === 'in') choices = [m.t.row - 1];
    else choices = Array.from({ length: m.t.row - m.s.row }, (_, k) => m.s.row + k);
    const gap = choices.reduce((best, g) => (load[g] < load[best] ? g : best), choices[0]);
    load[gap] += u.w;
    u.level = 3 * gap + 2;
  }

  // ---- the virtual graph, three levels a band: its boxes (3r), the lane under them (3r + 1) and the space down to
  // the next band (3r + 2); labels and pass-through slots sit on the levels between two boxes ----
  const L = Math.max(0, 3 * R - 1);
  const isBoxLevel = (lv) => lv % 3 === 0;
  const levels = Array.from({ length: L }, () => []);
  for (const b of [...boxes.values()].sort((a, c) => a.gi - c.gi)) levels[b.level].push(b);
  const link = (a, b) => {
    a.nb.push(b);
    b.nb.push(a);
  };
  for (const b of boxes.values()) b.nb = [];
  const virtual = (props) => {
    const v = { nb: [], ...props };
    levels[v.level].push(v);
    return v;
  };
  for (const u of all) {
    u.node = virtual({ key: `l:${u.members[0].index}`, type: 'label', level: u.level, w: u.w, h: u.h, unit: u });
    for (const m of u.members) {
      if (m.inner) {
        m.chain = [m.s, u.node, m.t];
      } else {
        m.chain = [m.s];
        for (let lv = 3 * m.s.row + 1; lv < 3 * m.t.row; lv++) {
          m.chain.push(lv === u.node.level ? u.node : virtual({ key: `p:${m.index}:${lv}`, type: 'pass', level: lv, w: G.passW, gi: 0 }));
        }
        m.chain.push(m.t);
      }
      for (let k = 1; k < m.chain.length; k++) link(m.chain[k - 1], m.chain[k]);
    }
  }

  // A box with many arrows on one side grows wide enough to keep their heads apart.
  for (const b of boxes.values()) {
    const above = new Set(b.nb.filter((v) => v.level < b.level).map((v) => v.key)).size;
    const below = new Set(b.nb.filter((v) => v.level > b.level).map((v) => v.key)).size;
    b.w = Math.max(b.w, Math.max(above, below) * G.portGap + 2 * 18);
  }

  // ---- order inside each level: barycentres, down and up, keeping the order with the fewest crossings ----
  const index = () => levels.forEach((lv) => lv.forEach((v, i) => { v.order = i; }));
  index();
  const crossings = () => {
    let n = 0;
    for (let lv = 0; lv + 1 < L; lv++) {
      const pairs = [];
      for (const v of levels[lv]) for (const w of v.nb) if (w.level === lv + 1) pairs.push([v.order, w.order]);
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
        if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) n++;
      }
    }
    return n;
  };
  const sortLevel = (lv, side) => {
    for (const v of levels[lv]) {
      const near = v.nb.filter((w) => (side === 0 ? Math.abs(w.level - lv) === 1 : w.level === lv + side));
      v.bary = near.length ? mean(near.map((w) => w.order)) : v.order;
    }
    levels[lv].sort((a, b) => (isBoxLevel(lv) ? (a.gi ?? 0) - (b.gi ?? 0) : 0) || a.bary - b.bary || a.order - b.order);
    levels[lv].forEach((v, i) => { v.order = i; });
  };
  // Two neighbours swap places when that crosses fewer arrows with the levels above and below.
  const pairCost = (u, v) => {
    let n = 0;
    for (const a of u.nb) for (const b of v.nb) if (a.level === b.level && a.level !== u.level && a.order > b.order) n++;
    return n;
  };
  const transpose = () => {
    for (let round = 0, moved = true; moved && round < 6; round++) {
      moved = false;
      for (const lv of levels) {
        for (let i = 0; i + 1 < lv.length; i++) {
          const u = lv[i];
          const v = lv[i + 1];
          if (isBoxLevel(u.level) && (u.gi ?? 0) !== (v.gi ?? 0)) continue;
          if (pairCost(v, u) < pairCost(u, v)) {
            lv[i] = v;
            lv[i + 1] = u;
            u.order = i + 1;
            v.order = i;
            moved = true;
          }
        }
      }
    }
  };
  for (let lv = 1; lv < L; lv++) if (!isBoxLevel(lv)) sortLevel(lv, 0);
  transpose();
  let best = levels.map((lv) => [...lv]);
  let fewest = crossings();
  for (let k = 0; k < G.sweeps && fewest > 0; k++) {
    for (let lv = 1; lv < L; lv++) sortLevel(lv, -1);
    for (let lv = L - 2; lv >= 0; lv--) sortLevel(lv, 1);
    transpose();
    const n = crossings();
    if (n < fewest) {
      fewest = n;
      best = levels.map((lv) => [...lv]);
    }
  }
  best.forEach((lv, i) => { levels[i] = lv; });
  index();

  // ---- across: each slot drawn toward what it links to, never closer to its neighbour than the gap between them ----
  const between = (a, b) => {
    if (a.type === 'box' && b.type === 'box') return a.gi !== b.gi ? G.groupGap : G.boxGap;
    if (a.type === 'pass' || b.type === 'pass') return G.passGap;
    return G.labelGap;
  };
  const gapsOf = (lv) => lv.slice(1).map((v, i) => (lv[i].w + v.w) / 2 + between(lv[i], v));
  for (const lv of levels) {
    const gaps = gapsOf(lv);
    let x = 0;
    lv.forEach((v, i) => {
      v.x = x;
      x += gaps[i] ?? 0;
    });
    lv.forEach((v) => { v.x -= x / 2; });
  }
  const weightOf = (v) => (v.type === 'box' ? 3 : v.type === 'label' ? 2 : 1);
  for (let k = 0; k < G.settle; k++) {
    const order = k % 2 === 0 ? levels.map((_, i) => i) : levels.map((_, i) => L - 1 - i);
    for (const i of order) {
      const lv = levels[i];
      if (!lv.length) continue;
      const want = lv.map((v) => (v.nb.length ? mean(v.nb.map((w) => w.x)) : v.x));
      const at = spread(want, gapsOf(lv), lv.map(weightOf));
      lv.forEach((v, j) => { v.x = at[j]; });
    }
  }
  let left = Infinity;
  let right = -Infinity;
  for (const lv of levels) for (const v of lv) {
    left = Math.min(left, v.x - v.w / 2);
    right = Math.max(right, v.x + v.w / 2);
  }
  if (!Number.isFinite(left)) { left = 0; right = 0; }
  const shift = G.margin + G.bandPad - left;
  for (const lv of levels) for (const v of lv) v.x += shift;
  const width = Math.ceil(right - left + 2 * (G.margin + G.bandPad));

  // ---- down: each band as tall as its title, its tallest box and its lane; each space as tall as its tallest label ----
  let y = G.margin;
  const bands = [];
  const rowAt = [];
  const tallest = (lv) => Math.max(0, ...lv.map((v) => v.h ?? 0));
  rows.forEach((r, ri) => {
    const inRow = levels[3 * ri].filter((v) => v.type === 'box');
    const tall = Math.max(36, ...inRow.map((b) => b.h));
    const top = y;
    for (const b of inRow) b.y = top + G.titleH + tall / 2;
    const boxBottom = top + G.titleH + tall + G.bandPad / 2;
    const lane = levels[3 * ri + 1] ?? [];
    const laneH = tallest(lane) ? tallest(lane) + 2 * G.lanePad : 0;
    for (const v of lane) v.y = boxBottom + laneH / 2;
    y = boxBottom + laneH + G.bandPad / 2;
    rowAt.push({ top, bottom: boxBottom });
    // A band per group: a row with two groups is split halfway between them.
    const cuts = [G.margin];
    for (let gi = 1; gi < r.groups.length; gi++) {
      const before = inRow.filter((b) => b.gi < gi);
      const after = inRow.filter((b) => b.gi >= gi);
      cuts.push(before.length && after.length ? (Math.max(...before.map((b) => b.x + b.w / 2)) + Math.min(...after.map((b) => b.x - b.w / 2))) / 2 : cuts.at(-1));
    }
    cuts.push(width - G.margin);
    r.groups.forEach((g, gi) => {
      const x0 = cuts[gi];
      const x1 = cuts[gi + 1];
      if (x1 - x0 > 1 && inRow.some((b) => b.gi === gi)) bands.push({ id: g.id, title: g.title ?? '', cls: g.cls ?? null, x: x0 + (gi ? 4 : 0), y: top, w: x1 - x0 - (gi ? 4 : 0) - (gi < r.groups.length - 1 ? 4 : 0), h: y - top });
    });
    if (ri < R - 1) {
      const inGap = levels[3 * ri + 2];
      const h = Math.max(G.gapMin, tallest(inGap) + 2 * G.gapPad);
      for (const v of inGap) v.y = y + h / 2;
      y += h;
    }
  });
  const height = Math.ceil(y + G.margin);

  // ---- the arrows: where each one leaves and enters its boxes, then its path through its slots ----
  const ends = new Map();
  const endKey = (box, side, via) => `${box.key}|${side}|${via.key}`;
  const want = (box, side, via) => {
    const k = `${box.key}|${side}`;
    if (!ends.has(k)) ends.set(k, { box, side, vias: new Map() });
    ends.get(k).vias.set(via.key, via);
  };
  for (const u of all) for (const m of u.members) {
    const c = m.chain;
    const n = c.length - 1;
    want(c[0], c[1].level > c[0].level ? 'bottom' : 'top', c[1]);
    want(c[n], c[n - 1].level < c[n].level ? 'top' : 'bottom', c[n - 1]);
  }
  const port = new Map();
  for (const { box, side, vias } of ends.values()) {
    const list = [...vias.values()].sort((a, b) => a.x - b.x);
    const inset = Math.min(18, box.w / 4);
    const span = box.w - 2 * inset;
    list.forEach((v, i) => {
      const x = list.length === 1 ? Math.max(box.x - span / 2, Math.min(box.x + span / 2, box.x + (v.x - box.x) * 0.25)) : box.x - span / 2 + (span * i) / (list.length - 1);
      port.set(endKey(box, side, v), { x, y: side === 'bottom' ? box.y + box.h / 2 : box.y - box.h / 2 });
    });
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const curve = (a, b) => {
    if (Math.abs(a.x - b.x) < 0.5) return `L${r1(b.x)},${r1(b.y)}`;
    const m = (b.y - a.y) / 2;
    return `C${r1(a.x)},${r1(a.y + m)} ${r1(b.x)},${r1(b.y - m)} ${r1(b.x)},${r1(b.y)}`;
  };
  const paths = [];
  for (const u of all) for (const m of u.members) {
    const c = m.chain;
    const n = c.length - 1;
    const start = port.get(endKey(c[0], c[1].level > c[0].level ? 'bottom' : 'top', c[1]));
    const end = port.get(endKey(c[n], c[n - 1].level < c[n].level ? 'top' : 'bottom', c[n - 1]));
    let d = `M${r1(start.x)},${r1(start.y)}`;
    if (m.inner) {
      // Down into the lane under the band, across through the label, and back up into the other box.
      const lb = u.node;
      d += `Q${r1(start.x)},${r1(lb.y)} ${r1(lb.x)},${r1(lb.y)}Q${r1(end.x)},${r1(lb.y)} ${r1(end.x)},${r1(end.y)}`;
    } else {
      let at = start;
      for (let k = 1; k < n; k++) {
        const v = c[k];
        if (v.type === 'pass' && isBoxLevel(v.level)) {
          const row = rowAt[v.level / 3];
          d += curve(at, { x: v.x, y: row.top });
          d += `L${r1(v.x)},${r1(row.bottom)}`;
          at = { x: v.x, y: row.bottom };
        } else {
          d += curve(at, { x: v.x, y: v.y });
          at = { x: v.x, y: v.y };
        }
      }
      d += curve(at, end);
    }
    paths.push({ index: m.index, d, kind: m.kind, head: m.kind === 'line' || m.kind === 'dotted-line' ? 'none' : m.headAtStart ? 'start' : 'end', from: m.s.id, to: m.t.id, text: m.text, also: m.also });
  }
  const labels = all.filter((u) => u.text).map((u) => ({ text: u.text, lines: u.lines, x: u.node.x, y: u.node.y, w: u.w, h: u.h, indexes: u.members.map((m) => m.index) }));
  const outBoxes = [...boxes.values()].map((b) => ({ id: b.id, group: b.group, shape: b.shape, lines: b.lines, x: b.x, y: b.y, w: b.w, h: b.h }));
  return { width, height, bands, boxes: outBoxes, labels, paths, crossings: fewest };
}

// ---- in the page only ------------------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
};

// Text measured in the page's own font, on a canvas that is never shown.
export function pageMeasure(fontFamily) {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  return (s, size) => {
    const k = `${size}|${s}`;
    if (!cache.has(k)) {
      ctx.font = `${size}px ${fontFamily}`;
      cache.set(k, ctx.measureText(String(s)).width);
    }
    return cache.get(k);
  };
}

const textLines = (lines, x, yTop, lineH, size, cls) => {
  const t = el('text', { x, y: yTop, 'text-anchor': 'middle', 'font-size': size, class: cls });
  lines.forEach((line, i) => {
    const span = el('tspan', { x, dy: i === 0 ? lineH * 0.78 : lineH });
    span.textContent = line;
    t.append(span);
  });
  return t;
};

function shapeOf(b) {
  const x0 = b.x - b.w / 2;
  const y0 = b.y - b.h / 2;
  if (b.shape === 'stadium') return el('rect', { x: x0, y: y0, width: b.w, height: b.h, rx: Math.min(b.h / 2, 22), class: 'fl-shape' });
  if (b.shape === 'hex') {
    const k = 13;
    const pts = [[x0 + k, y0], [x0 + b.w - k, y0], [x0 + b.w, b.y], [x0 + b.w - k, y0 + b.h], [x0 + k, y0 + b.h], [x0, b.y]];
    return el('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: 'fl-shape' });
  }
  if (b.shape === 'db') {
    const ry = 6;
    const d = `M${x0},${y0 + ry} a${b.w / 2},${ry} 0 0 0 ${b.w},0 a${b.w / 2},${ry} 0 0 0 ${-b.w},0 v${b.h - 2 * ry} a${b.w / 2},${ry} 0 0 0 ${b.w},0 v${-(b.h - 2 * ry)}`;
    return el('path', { d, class: 'fl-shape' });
  }
  return el('rect', { x: x0, y: y0, width: b.w, height: b.h, rx: 6, class: 'fl-shape' });
}

// The layout drawn as an svg with the same hooks as mermaid's (g.cluster, g.node[data-id], g.edgeLabel), so the page
// colours, titles, clicks and exports work on it unchanged. titleOf(path) → the hover words of an arrow, or ''.
export function drawGrid(layout, { idPrefix = 'flg', titleOf = () => '' } = {}) {
  const G = GRID;
  const svg = el('svg', { xmlns: SVG_NS, class: 'fl-grid', viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, role: 'img' });
  const marker = el('marker', { id: `${idPrefix}-head`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' },
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'fl-head' }));
  marker.setAttribute('markerWidth', '9');
  marker.setAttribute('markerHeight', '9');
  const root = el('g', {});
  svg.append(el('defs', {}, marker), root);
  const bandsG = el('g', { class: 'clusters' });
  for (const b of layout.bands) {
    const g = el('g', { class: `cluster fl-band fl-band-${b.cls ?? 'parts'}`, id: b.id ?? undefined },
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 }));
    if (b.title) {
      const t = el('text', { x: b.x + 14, y: b.y + 21, 'font-size': G.titleFont, class: 'fl-band-title' });
      t.textContent = b.title;
      g.append(t);
    }
    bandsG.append(g);
  }
  const edgesG = el('g', { class: 'edgePaths' });
  for (const p of layout.paths) {
    const path = el('path', { d: p.d, class: `flowchart-link fl-edge fl-edge-${p.kind}`, 'data-edge': p.index, fill: 'none' });
    if (p.head === 'end') path.setAttribute('marker-end', `url(#${idPrefix}-head)`);
    if (p.head === 'start') path.setAttribute('marker-start', `url(#${idPrefix}-head)`);
    const words = titleOf(p);
    if (words) path.append(el('title', {}, document.createTextNode(words)));
    edgesG.append(path);
  }
  const labelsG = el('g', { class: 'edgeLabels' });
  for (const l of layout.labels) {
    const g = el('g', { class: 'edgeLabel', 'data-edges': l.indexes.join(' ') },
      el('rect', { x: l.x - l.w / 2, y: l.y - l.h / 2, width: l.w, height: l.h, rx: 4, class: 'fl-label-bg' }),
      textLines(l.lines, l.x, l.y - l.h / 2 + G.labelPadY, G.labelLine, G.labelFont, 'fl-label-text'));
    labelsG.append(g);
  }
  const nodesG = el('g', { class: 'nodes' });
  for (const b of layout.boxes) {
    const g = el('g', { class: 'node', 'data-id': b.id }, shapeOf(b),
      textLines(b.lines, b.x, b.y - (b.lines.length * G.boxLine) / 2 + (b.shape === 'db' ? 5 : 0), G.boxLine, G.font, 'fl-box-text'));
    nodesG.append(g);
  }
  root.append(bandsG, edgesG, labelsG, nodesG);
  return svg;
}
