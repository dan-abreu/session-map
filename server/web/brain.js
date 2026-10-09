import { hash, unitTree, packCircles, ownerHue, initial, workCellPhase, fusionGhosts, filesByFolder } from './body.js';

const d3 = window.d3;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const NEURON_R = 5.5;
const LEVEL_RANK = { cell: 0, tissue: 1, organ: 2 };
const PAD = { tissue: 9, organ: 14 };
const INSET = { tissue: 12, organ: 20 };
// Before its tissue or organ forms, a unit sits this much farther out: the group visibly gathers when it is born.
const SPREAD = 0.45;
const NEAR_ZOOM = 1.9;
// Screen pixels kept above (organ names) and below (cell names) whatever the fit frames.
const LABEL_TOP = 50;
const LABEL_BOTTOM = 40;
const LABEL_MARGIN = LABEL_TOP + LABEL_BOTTOM;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Size follows accumulated work (conversations + commits + decisions), on a square-root scale.
const cellRadius = (work) => 15 + 6.5 * Math.sqrt(work);
const budRadius = (wc) => 10 + 2.6 * Math.sqrt(wc.files.length + wc.commits);
const isWork = (item) => item.kind === 'commit' || item.kind === 'merge';
const lerp = (a, b, k) => a + (b - a) * k;

function wrapLabel(text, max = 18) {
  if (text.length <= max) return [text];
  const lines = [''];
  for (const w of text.split(/\s+/)) {
    const cur = lines[lines.length - 1];
    if (!cur || (cur + ' ' + w).length <= max) lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    else lines.push(w);
  }
  if (lines.length > 2) lines.splice(2, lines.length, `${lines[1]}…`);
  return lines;
}

// Smooth closed curve through wobbly points: a membrane, not a perfect circle.
function membranePath(r, seed, amp = 0.035) {
  if (r < 0.5) return '';
  const pts = [];
  const n = 30;
  const s1 = seed * 6.283, s2 = seed * 17.1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + amp * (0.6 * Math.sin(3 * a + s1) + 0.4 * Math.sin(5 * a + s2));
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}

function curve(x1, y1, x2, y2, bend) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  return `M${x1.toFixed(2)},${y1.toFixed(2)}Q${(mx - dy * bend).toFixed(2)},${(my + dx * bend).toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

// A pseudopod: a tapered arm from a work cell's membrane to the edge of a unit it also touches.
function podPath(x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `M${(x1 + nx).toFixed(2)},${(y1 + ny).toFixed(2)}Q${(mx + nx * 0.35).toFixed(2)},${(my + ny * 0.35).toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`
    + `Q${(mx - nx * 0.35).toFixed(2)},${(my - ny * 0.35).toFixed(2)} ${(x1 - nx).toFixed(2)},${(y1 - ny).toFixed(2)}Z`;
}

// Unit-circle offsets for neurons; scaled by the unit's current radius so they stay inside while it grows.
function neuronOffsets(chats, seed, container) {
  const n = chats.length;
  return chats.map((c, i) => {
    if (container) {
      const a = seed * Math.PI * 2 + (i / Math.max(1, n)) * Math.PI * 2;
      return { u: Math.cos(a) * 0.88, v: Math.sin(a) * 0.88 };
    }
    if (n <= 7) {
      const a = seed * Math.PI * 2 + (i / n) * Math.PI * 2;
      const rho = (n === 1 ? 0.56 : 0.6) + (hash(c.sessionId) - 0.5) * 0.1;
      return { u: Math.cos(a) * rho, v: Math.sin(a) * rho };
    }
    const rho = 0.34 + 0.5 * Math.sqrt((i + 0.5) / n);
    const a = seed * Math.PI * 2 + i * GOLDEN;
    return { u: Math.cos(a) * rho, v: Math.sin(a) * rho };
  });
}

// Organelles: one small cluster per folder on a ring, the files of that folder around its centre.
function organelleLayout(files) {
  const groups = filesByFolder(files);
  const out = [];
  groups.forEach((g, gi) => {
    const ga = (gi / groups.length) * Math.PI * 2 - Math.PI / 2;
    const ring = groups.length === 1 ? 0 : 0.5;
    const gx = Math.cos(ga) * ring, gy = Math.sin(ga) * ring;
    g.files.forEach((f, fi) => {
      const fa = (fi / g.files.length) * Math.PI * 2 + gi;
      const spread = g.files.length === 1 ? 0 : groups.length === 1 ? 0.5 : 0.2;
      out.push({ ...f, folder: g.folder, u: gx + Math.cos(fa) * spread, v: gy + Math.sin(fa) * spread });
    });
  });
  return out;
}

export function neuronKind(chat) {
  if (chat.waiting && (chat.waiting.strong || chat.waiting.items.length)) return 'waiting';
  return chat.status;
}

export function isUnsure(chat) {
  return chat.unitSource === 'none' || chat.workCellSource === 'guess';
}

function layout(project, area, labelFor) {
  const aspect = Math.min(2.2, Math.max(0.4, area.width / Math.max(1, area.height)));
  const tree = unitTree(project.units);
  const chatById = new Map(project.chats.map((c) => [c.sessionId, c]));
  const activity = project.activity || [];
  const nodes = new Map();

  for (const u of project.units) {
    const chats = u.chatIds.map((id) => chatById.get(id)).filter(Boolean).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const commitTimes = activity.filter((a) => isWork(a) && a.unitIds.includes(u.id)).map((a) => Date.parse(a.ts)).sort((a, b) => a - b);
    const decisions = u.level === 'cell' ? (u.work?.decisions ?? u.nucleus.decided.length) : 0;
    nodes.set(u.id, {
      id: u.id, data: u, level: u.level, chats, commitTimes, decisions,
      workTotal: chats.length + commitTimes.length + decisions,
      born: Date.parse(u.bornAt), seed: hash(u.id), lines: wrapLabel(labelFor(u), u.level === 'cell' ? 16 : 22),
      children: [], parent: null, buds: [], relX: 0, relY: 0, x: 0, y: 0, rNow: 0, rTarget: 0, gNow: 1, gTarget: 1,
    });
  }
  for (const n of nodes.values()) {
    const p = tree.parent(n.id);
    if (p) {
      n.parent = nodes.get(p.id);
      n.parent.children.push(n);
    }
  }
  const depthOf = (n) => (n.parent ? 1 + depthOf(n.parent) : 0);
  for (const n of nodes.values()) n.depth = depthOf(n);

  const buds = (project.workCells || []).filter((w) => nodes.has(w.unitId)).map((w) => {
    const unit = nodes.get(w.unitId);
    const bud = {
      id: w.id, data: w, unit, r: budRadius(w), hue: ownerHue(w.owner.email), letter: initial(w.owner.name),
      shown: 0, target: 0, phase: 'unborn', angle: 0,
      organelles: organelleLayout(w.files),
    };
    unit.buds.push(bud);
    return bud;
  });

  // Bottom-up: a cell's size comes from its work; a tissue or organ is exactly big enough for what it holds.
  const sizeOf = (n) => {
    for (const c of n.children) sizeOf(c);
    const budRoom = n.buds.reduce((m, b) => Math.max(m, b.r * 2.3), 0);
    if (!n.children.length) {
      n.rFull = n.level === 'cell' ? cellRadius(n.workTotal) : 34;
    } else {
      const packed = packCircles(n.children.map((c) => ({ id: c.id, r: c.packR })), PAD[n.level] ?? PAD.tissue);
      packed.items.forEach((it, i) => { n.children[i].relX = it.x; n.children[i].relY = it.y; });
      n.rFull = packed.r + (INSET[n.level] ?? INSET.tissue);
    }
    n.packR = n.rFull + budRoom + (n.level === 'cell' && n.parent ? 4 : 0);
  };
  const roots = [...nodes.values()].filter((n) => !n.parent);
  for (const r of roots) sizeOf(r);

  const ghosts = fusionGhosts(project).filter((g) => nodes.has(g.unitId)).map((g) => ({
    ...g, unit: nodes.get(g.unitId), r: cellRadius(1) * 0.9, shown: 0, target: 0, mode: 'unborn', seed: hash(g.id),
  }));
  const ghostOfChat = new Map(ghosts.map((g) => [g.sessionId, g]));

  const neurons = [];
  for (const n of nodes.values()) {
    neuronOffsets(n.chats, n.seed, n.level !== 'cell').forEach((off, i) => {
      const chat = n.chats[i];
      neurons.push({
        id: chat.sessionId, chat, unit: n, ghost: ghostOfChat.get(chat.sessionId) || null, ...off,
        bend: (hash(chat.sessionId + 'b') - 0.5) * 0.5, t: Date.parse(chat.startedAt), shown: 0, target: 0, x: 0, y: 0,
      });
    });
  }
  const neuronById = new Map(neurons.map((n) => [n.id, n]));
  const budById = new Map(buds.map((b) => [b.id, b]));
  for (const nr of neurons) nr.bud = nr.chat.workCellId ? budById.get(nr.chat.workCellId) || null : null;

  const synapses = [];
  for (const nr of neurons) {
    const parent = nr.chat.parentId && neuronById.get(nr.chat.parentId);
    if (parent) synapses.push({ id: `p:${nr.id}`, a: parent, b: nr, bend: 0.22 });
  }

  const links = (project.unitLinks || []).map((l) => ({
    id: `${l.a}|${l.b}`, data: l, a: nodes.get(l.a), b: nodes.get(l.b),
    weight: Math.min(4, Math.max(1, l.weight || 1)), t: Date.parse(l.since),
    bend: (hash(l.a + l.b) - 0.5) * 0.36, shown: 0, target: 0,
  })).filter((l) => l.a && l.b && l.a !== l.b);

  const rootOf = (n) => (n.parent ? rootOf(n.parent) : n);
  // Labels are drawn in screen pixels, so the room they need in the world grows as the view zooms out.
  const labelPx = (n) => (n.level === 'organ' ? 46 : n.level === 'tissue' ? 14 : 36 + 13 * (n.lines.length - 1));
  for (const r of roots) r.collide = r.packR + labelPx(r);
  const order = roots.slice().sort((a, b) => b.packR - a.packR);
  order.forEach((c, i) => {
    const rad = 70 * Math.sqrt(i + 0.5);
    c.x = Math.cos(i * GOLDEN) * rad * Math.sqrt(aspect);
    c.y = Math.sin(i * GOLDEN) * rad / Math.sqrt(aspect);
  });
  const rootLinks = [];
  for (const l of links) {
    const ra = rootOf(l.a), rb = rootOf(l.b);
    if (ra !== rb && !rootLinks.some((x) => (x.source === ra && x.target === rb) || (x.source === rb && x.target === ra))) {
      rootLinks.push({ source: ra, target: rb, weight: l.weight });
    }
  }
  const sim = d3.forceSimulation(roots)
    .force('collide', d3.forceCollide((d) => d.collide).strength(1).iterations(3))
    .force('x', d3.forceX(0).strength(aspect >= 1 ? 0.02 / aspect : 0.035 / aspect))
    .force('y', d3.forceY(0).strength(aspect >= 1 ? 0.0425 * aspect ** 1.3 : 0.035 * aspect))
    .force('link', d3.forceLink(rootLinks).distance((l) => l.source.collide + l.target.collide).strength((l) => 0.5 + 0.1 * l.weight))
    .stop();
  for (let i = 0; i < 360; i++) sim.tick();
  const span = (axis) => Math.max(1, Math.max(...roots.map((r) => r[axis] + r.packR)) - Math.min(...roots.map((r) => r[axis] - r.packR)));
  const k = Math.min(1.35, (area.width - 24) / span('x'), (area.height - 24 - LABEL_MARGIN) / span('y'));
  for (const r of roots) r.collide = r.packR + labelPx(r) / k;
  sim.force('collide').radius((d) => d.collide);
  sim.alpha(0.5);
  for (let i = 0; i < 300; i++) sim.tick();
  for (const r of roots) { r.rootX = r.x; r.rootY = r.y; }

  // Final positions decide where each bud leans: toward the units its branch also touches, else outward.
  const ordered = [...nodes.values()].sort((a, b) => a.depth - b.depth);
  for (const n of ordered) {
    if (n.parent) { n.x = n.parent.x + n.relX; n.y = n.parent.y + n.relY; }
  }
  for (const n of nodes.values()) {
    n.buds.forEach((b, i) => {
      const touched = b.data.touches.map((id) => nodes.get(id)).filter(Boolean);
      let ax, ay;
      if (touched.length) {
        ax = touched.reduce((s, t) => s + t.x, 0) / touched.length - n.x;
        ay = touched.reduce((s, t) => s + t.y, 0) / touched.length - n.y;
      } else if (n.parent) {
        ax = n.x - n.parent.x; ay = n.y - n.parent.y;
      } else {
        ax = Math.cos(n.seed * 6.283); ay = Math.sin(n.seed * 6.283);
      }
      if (Math.hypot(ax, ay) < 1e-6) { ax = Math.cos(n.seed * 6.283); ay = Math.sin(n.seed * 6.283); }
      b.angle = Math.atan2(ay, ax) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.75;
      b.touched = touched;
    });
  }
  const clashes = [];
  for (const b of buds) {
    for (const other of b.data.clashWith) {
      const o = budById.get(other);
      if (o && b.id < o.id) clashes.push({ id: `${b.id}|${o.id}`, a: b, b: o });
    }
  }
  for (const g of ghosts) {
    const n = g.unit;
    const out = n.parent ? Math.atan2(n.y - n.parent.y, n.x - n.parent.x) : n.seed * 6.283;
    g.angle = out + 2.2;
  }

  return {
    nodes, ordered, roots, neurons, synapses, links, buds, ghosts, clashes, neuronById, budById,
    linkById: new Map(links.map((l) => [l.id, l])),
  };
}

const ICON_BANG = 'M0,-3.6V0.6';
const ICON_ASK = 'M-1.9,-1.9a1.95,1.95 0 1 1 2.4,1.9c-0.5,0.15-0.5,0.5-0.5,1.1';
const ICON_PIN = 'M-2.6,-5.2h5.2M-1.7,-5.2l-0.5,3.6-1.7,1.6h7.8l-1.7-1.6-0.5-3.6M0,0v4.6';

export function createBrain(svgEl, { onSelect, labelFor, unitMeta, unitAria, budAria, linkLabel, freeArea }) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const world = svg.append('g').attr('class', 'world');
  const gUnits = world.append('g').attr('class', 'units');
  const gGhosts = world.append('g').attr('class', 'ghosts');
  const gLinks = world.append('g').attr('class', 'unit-links');
  const gPods = world.append('g').attr('class', 'pods');
  const gTethers = world.append('g').attr('class', 'tethers');
  const gSyn = world.append('g').attr('class', 'synapses');
  const gBuds = world.append('g').attr('class', 'buds');
  const gNeurons = world.append('g').attr('class', 'neurons');
  const gRipples = world.append('g').attr('class', 'ripples');
  const gLabels = svg.append('g').attr('class', 'labels').attr('aria-hidden', 'true');

  let model = null;
  let selection = null;
  let transform = d3.zoomIdentity;
  let frame = 0;
  let tNow = Infinity;

  const zoom = d3.zoom()
    .scaleExtent([0.25, 6])
    .on('zoom', (event) => {
      transform = event.transform;
      world.attr('transform', transform);
      svg.classed('is-near', transform.k >= NEAR_ZOOM);
      placeLabels();
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (event) => {
    if (event.target === svgEl) onSelect(null);
  });

  const activate = (sel) => (event) => {
    event.stopPropagation();
    onSelect(sel);
  };
  const keyActivate = (sel) => (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(sel);
    }
  };
  const interactive = (sel, toSel) => sel
    .attr('tabindex', 0).attr('role', 'button')
    .on('click', (event, d) => activate(toSel(d))(event))
    .on('keydown', (event, d) => keyActivate(toSel(d))(event));

  function build() {
    for (const g of [gUnits, gGhosts, gLinks, gPods, gTethers, gSyn, gBuds, gNeurons, gRipples, gLabels]) g.selectAll('*').remove();
    const unitsByLevel = model.ordered.slice().sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.depth - b.depth);

    const unitG = interactive(gUnits.selectAll('g.unit').data(unitsByLevel, (d) => d.id).join('g'), (d) => ({ type: 'unit', id: d.id }))
      .attr('class', (d) => `unit level-${d.level} status-${d.data.status}${d.data.pinned ? ' is-pinned' : ''}`)
      .attr('aria-label', (d) => unitAria(d.data));
    unitG.append('path').attr('class', 'membrane');
    unitG.append('path').attr('class', 'membrane-inner');
    const cellG = unitG.filter((d) => d.level === 'cell');
    cellG.append('g').attr('class', 'dendrites').selectAll('path')
      .data((d) => model.neurons.filter((n) => n.unit === d)).join('path').attr('class', 'dendrite');
    cellG.append('circle').attr('class', 'nucleus').attr('r', (d) => 5 + Math.min(3.5, d.chats.length * 0.6));
    cellG.append('circle').attr('class', 'nucleolus').attr('r', 1.8).attr('cx', 1.2).attr('cy', -1);

    gGhosts.selectAll('path.ghost').data(model.ghosts, (d) => d.id).join('path').attr('class', 'ghost');

    const linkG = interactive(gLinks.selectAll('g.unit-link').data(model.links, (d) => d.id).join('g'), (d) => ({ type: 'link', id: d.id }))
      .attr('class', (d) => `unit-link${d.data.reasons.some((r) => r.kind === 'meaning') ? ' by-meaning' : ''}`)
      .attr('aria-label', (d) => linkLabel(d.a.data, d.b.data));
    linkG.append('path').attr('class', 'link-hit');
    linkG.append('path').attr('class', 'link-axon').attr('stroke-width', (d) => 1 + d.weight * 0.75);
    linkG.append('circle').attr('class', 'link-bulb end-a').attr('r', (d) => 2 + d.weight * 0.5);
    linkG.append('circle').attr('class', 'link-bulb end-b').attr('r', (d) => 2 + d.weight * 0.5);

    gPods.selectAll('path.pod').data(model.buds.flatMap((b) => b.touched.map((t) => ({ id: `${b.id}>${t.id}`, bud: b, unit: t }))), (d) => d.id)
      .join('path').attr('class', 'pod').style('--owner-h', (d) => d.bud.hue);
    gPods.selectAll('path.clash-bridge').data(model.clashes, (d) => d.id).join('path').attr('class', 'clash-bridge');

    gTethers.selectAll('path.tether').data(model.neurons.filter((n) => n.bud), (d) => d.id).join('path').attr('class', 'tether');
    gSyn.selectAll('path').data(model.synapses, (d) => d.id).join('path')
      .attr('class', (d) => `synapse parent${d.a.unit === d.b.unit ? '' : ' cross'}`);

    const budG = interactive(gBuds.selectAll('g.bud').data(model.buds, (d) => d.id).join('g'), (d) => ({ type: 'workcell', id: d.id }))
      .attr('class', (d) => `bud${d.data.remote ? ' is-remote' : ''}${d.data.clashWith.length ? ' is-clash' : ''}`)
      .style('--owner-h', (d) => d.hue)
      .attr('aria-label', (d) => budAria(d.data));
    const budBody = budG.append('g').attr('class', 'bud-body');
    budBody.append('path').attr('class', 'bud-membrane');
    budBody.append('g').attr('class', 'organelles').selectAll('circle')
      .data((d) => d.organelles.map((o) => ({ ...o, bud: d }))).join('circle')
      .attr('class', (o) => `organelle st-${o.status}`)
      .attr('cx', (o) => (o.u * o.bud.r * 0.62).toFixed(2)).attr('cy', (o) => (o.v * o.bud.r * 0.62).toFixed(2))
      .attr('r', (o) => Math.max(1.1, o.bud.r * 0.085));
    budBody.append('text').attr('class', 'bud-initial').attr('dy', '0.35em').attr('text-anchor', 'middle')
      .style('font-size', (d) => `${(d.r * 0.95).toFixed(1)}px`).text((d) => d.letter);

    const nG = interactive(gNeurons.selectAll('g.neuron').data(model.neurons, (d) => d.id).join('g'), (d) => ({ type: 'chat', id: d.id }))
      .attr('class', (d) => `neuron kind-${neuronKind(d.chat)}${d.chat.waiting.weak ? ' weak' : ''}`)
      .attr('aria-label', (d) => d.chat.title);
    const body = nG.append('g').attr('class', 'neuron-body');
    body.append('circle').attr('class', 'hit').attr('r', 11);
    body.filter((d) => d.chat.status === 'busy').append('circle').attr('class', 'pulse').attr('r', NEURON_R);
    body.append('circle').attr('class', 'dot').attr('r', (d) => {
      const k = neuronKind(d.chat);
      return k === 'waiting' ? 7.5 : k === 'closed' ? 4.2 : NEURON_R;
    });
    const waitingBody = body.filter((d) => neuronKind(d.chat) === 'waiting');
    waitingBody.append('path').attr('class', 'glyph').attr('d', ICON_BANG);
    waitingBody.append('circle').attr('class', 'glyph-dot').attr('cy', 2.9).attr('r', 1.1);
    const unsure = body.filter((d) => isUnsure(d.chat)).append('g').attr('class', 'unsure').attr('transform', 'translate(8,-8)');
    unsure.append('circle').attr('r', 5.6);
    unsure.append('path').attr('d', ICON_ASK);
    unsure.append('circle').attr('class', 'ask-dot').attr('cy', 2.7).attr('r', 0.85);

    // Bigger units first: they claim label space before smaller ones (see placeLabels).
    const lab = gLabels.selectAll('g.label').data(unitsByLevel, (d) => d.id).join('g')
      .attr('class', (d) => `label level-${d.level} status-${d.data.status}`);
    const text = lab.append('text').attr('text-anchor', 'middle');
    text.each(function (d) {
      const el = d3.select(this);
      d.lines.forEach((line, i) => el.append('tspan').attr('class', 'name').attr('x', 0).attr('dy', i ? '1.15em' : 0).text(line));
      el.append('tspan').attr('class', 'meta').attr('x', 0).attr('dy', '1.3em').text(unitMeta(d.data, d.chats.length));
    });
    lab.filter((d) => d.data.pinned).append('path').attr('class', 'pin').attr('d', ICON_PIN);
    gLabels.selectAll('g.bud-label').data(model.buds, (d) => d.id).join('g')
      .attr('class', 'bud-label').style('--owner-h', (d) => d.hue)
      .append('text').attr('text-anchor', 'middle').text((d) => d.data.branch);
  }

  const spreadOf = (n) => (n.parent ? 1 + SPREAD * (1 - n.parent.gNow) : 1);

  function positions() {
    for (const n of model.ordered) {
      if (!n.parent) { n.x = n.rootX; n.y = n.rootY; continue; }
      const k = spreadOf(n);
      n.x = n.parent.x + n.relX * k;
      n.y = n.parent.y + n.relY * k;
    }
    for (const b of model.buds) {
      const u = b.unit;
      const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      const rim = u.rNow + b.r * 0.15;
      const home = b.phase === 'fused' ? 0 : Math.max(0, u.rNow - b.r * 0.3);
      const dist = lerp(home, rim, b.shown);
      b.x = u.x + cos * dist;
      b.y = u.y + sin * dist;
      b.rNow = b.r * b.shown;
    }
    for (const g of model.ghosts) {
      const u = g.unit;
      const away = u.rNow + g.r + 5;
      const dist = g.mode === 'fused' ? lerp(0, away, g.shown) : away;
      g.x = u.x + Math.cos(g.angle) * dist;
      g.y = u.y + Math.sin(g.angle) * dist;
      g.rNow = g.r * (g.mode === 'fused' ? Math.max(0.15, g.shown) : g.shown);
    }
    for (const nr of model.neurons) {
      const ux = nr.unit.x + nr.u * nr.unit.rNow, uy = nr.unit.y + nr.v * nr.unit.rNow;
      if (nr.ghost && nr.ghost.mode !== 'unborn') {
        const g = nr.ghost;
        const k = g.mode === 'alive' ? 1 : g.shown;
        nr.x = lerp(ux, g.x + 0.15 * g.rNow, k);
        nr.y = lerp(uy, g.y - 0.1 * g.rNow, k);
      } else {
        nr.x = ux; nr.y = uy;
      }
    }
  }

  function edgePoint(n, x, y, r) {
    const a = Math.atan2(y - n.y, x - n.x);
    return [n.x + Math.cos(a) * r, n.y + Math.sin(a) * r];
  }

  function draw() {
    positions();
    gUnits.selectAll('g.unit')
      .attr('transform', (d) => `translate(${d.x.toFixed(2)},${d.y.toFixed(2)})`)
      .attr('opacity', (d) => Math.min(1, (d.rNow / Math.max(1, d.rTarget || d.rFull)) * 1.4))
      .style('display', (d) => (d.rNow < 1 ? 'none' : null));
    gUnits.selectAll('path.membrane').attr('d', (d) => membranePath(d.rNow, d.seed, d.level === 'cell' ? 0.04 : 0.025));
    gUnits.selectAll('path.membrane-inner').attr('d', (d) => membranePath(Math.max(0, d.rNow - (d.level === 'organ' ? 6 : 3.5)), d.seed, 0.022));
    gUnits.selectAll('path.dendrite')
      .attr('d', (n) => curve(0, 0, n.x - n.unit.x, n.y - n.unit.y, n.bend))
      .attr('opacity', (n) => n.shown);

    gGhosts.selectAll('path.ghost')
      .attr('transform', (g) => `translate(${g.x.toFixed(2)},${g.y.toFixed(2)})`)
      .attr('d', (g) => membranePath(g.rNow, g.seed))
      .attr('opacity', (g) => g.shown)
      .style('display', (g) => (g.shown < 0.02 ? 'none' : null));

    gNeurons.selectAll('g.neuron')
      .attr('transform', (n) => `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`)
      .style('display', (n) => (n.shown < 0.02 ? 'none' : null))
      .select('.neuron-body')
      .attr('transform', (n) => `scale(${n.shown.toFixed(3)})`);

    gBuds.selectAll('g.bud')
      .attr('transform', (b) => `translate(${b.x.toFixed(2)},${b.y.toFixed(2)})`)
      .style('display', (b) => (b.shown < 0.02 ? 'none' : null))
      .select('.bud-body').attr('transform', (b) => `scale(${b.shown.toFixed(3)})`);
    gBuds.selectAll('path.bud-membrane').attr('d', (b) => membranePath(b.r, hash(b.id), 0.06));

    gPods.selectAll('path.pod').each(function (p) {
      const el = d3.select(this);
      const b = p.bud;
      const visible = b.shown > 0.6 && p.unit.rNow > 1;
      el.style('display', visible ? null : 'none');
      if (!visible) return;
      const [x1, y1] = edgePoint(b, p.unit.x, p.unit.y, b.rNow * 0.85);
      // A far unit gets a short arm pointing its way; a near one is actually touched.
      const [ex, ey] = edgePoint(p.unit, b.x, b.y, p.unit.rNow);
      const reach = Math.min(Math.hypot(ex - x1, ey - y1), b.rNow * 1.6);
      const a = Math.atan2(ey - y1, ex - x1);
      el.attr('d', podPath(x1, y1, x1 + Math.cos(a) * reach, y1 + Math.sin(a) * reach, Math.max(1.2, b.rNow * 0.2))).attr('opacity', (b.shown - 0.6) / 0.4);
    });
    gPods.selectAll('path.clash-bridge').each(function (c) {
      const el = d3.select(this);
      const visible = c.a.shown > 0.6 && c.b.shown > 0.6;
      el.style('display', visible ? null : 'none');
      if (!visible) return;
      const [x1, y1] = edgePoint(c.a, c.b.x, c.b.y, c.a.rNow);
      const [x2, y2] = edgePoint(c.b, c.a.x, c.a.y, c.b.rNow);
      el.attr('d', curve(x1, y1, x2, y2, 0.12));
    });

    gTethers.selectAll('path.tether')
      .attr('d', (n) => curve(n.x, n.y, n.bud.x, n.bud.y, -0.14))
      .style('display', (n) => (Math.min(n.shown, n.bud.shown) < 0.05 ? 'none' : null))
      .attr('opacity', (n) => Math.min(n.shown, n.bud.shown));

    gLinks.selectAll('g.unit-link').each(function (l) {
      const g = d3.select(this);
      const visible = l.shown > 0.02 && l.a.rNow > 1 && l.b.rNow > 1;
      g.style('display', visible ? null : 'none').attr('opacity', l.shown);
      if (!visible) return;
      const geo = linkGeometry(l);
      g.selectAll('path').attr('d', geo.d);
      g.select('.end-a').attr('cx', geo.x1).attr('cy', geo.y1);
      g.select('.end-b').attr('cx', geo.x2).attr('cy', geo.y2);
    });

    gSyn.selectAll('path.synapse')
      .attr('d', (s) => curve(s.a.x, s.a.y, s.b.x, s.b.y, s.bend))
      .attr('opacity', (s) => Math.min(s.a.shown, s.b.shown))
      .style('display', (s) => (Math.min(s.a.shown, s.b.shown) < 0.02 ? 'none' : null));
    placeLabels();
  }

  // Edge to edge: the axon leaves each membrane on the side its curve bows toward.
  function linkGeometry(l) {
    const theta = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
    const alpha = l.bend * 1.6;
    const x1 = l.a.x + Math.cos(theta + alpha) * (l.a.rNow - 1);
    const y1 = l.a.y + Math.sin(theta + alpha) * (l.a.rNow - 1);
    const x2 = l.b.x + Math.cos(theta + Math.PI - alpha) * (l.b.rNow - 1);
    const y2 = l.b.y + Math.sin(theta + Math.PI - alpha) * (l.b.rNow - 1);
    return { x1, y1, x2, y2, d: curve(x1, y1, x2, y2, l.bend) };
  }

  // Semantic zoom: organs always speak, tissues once they have room, small cells only up close.
  function labelVisible(d) {
    if (d.rNow < 1) return false;
    const screenR = d.rNow * transform.k;
    if (d.level === 'organ') return true;
    if (d.level === 'tissue') return screenR >= 46;
    // A cell whose tissue has not formed yet is still free-living: it keeps its name visible.
    return !d.parent || d.parent.rNow < 1 || screenR >= 32;
  }

  // Map-style label collision: when two names overlap, the bigger unit keeps its name and the smaller waits for zoom.
  function labelBox(d, x, y) {
    const chars = Math.max(...d.lines.map((l) => l.length), d.level === 'tissue' ? 0 : 14);
    const w = chars * (d.level === 'organ' ? 8 : 6.6);
    const h = (d.level === 'tissue' ? 0 : 14) + 15 * d.lines.length;
    return { x0: x - w / 2, x1: x + w / 2, y0: y - 12, y1: y - 12 + h };
  }

  function placeLabels() {
    if (!model) return;
    const kept = [];
    gLabels.selectAll('g.label').each(function (d) {
      const g = d3.select(this);
      let show = labelVisible(d);
      if (show) {
        const box = labelBox(d, transform.applyX(d.x), labelY(d));
        show = !kept.some((k) => k.x0 < box.x1 && box.x0 < k.x1 && k.y0 < box.y1 && box.y0 < k.y1);
        if (show) kept.push(box);
      }
      g.style('display', show ? null : 'none');
      if (!show) return;
      const x = transform.applyX(d.x);
      const y = labelY(d);
      g.attr('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`)
        .attr('opacity', Math.min(1, d.rNow / Math.max(1, d.rTarget || d.rFull)));
      if (d.data.pinned) {
        const w = Math.max(...d.lines.map((l) => l.length)) * (d.level === 'organ' ? 4.3 : 3.6);
        g.select('.pin').attr('transform', `translate(${(w + 9).toFixed(1)},-4)`);
      }
    });
    gLabels.selectAll('g.bud-label').each(function (b) {
      const g = d3.select(this);
      const show = b.shown > 0.5 && b.r * transform.k >= 15;
      g.style('display', show ? null : 'none');
      if (show) g.attr('transform', `translate(${transform.applyX(b.x).toFixed(1)},${(transform.applyY(b.y + b.rNow) + 13).toFixed(1)})`);
    });
  }

  function labelY(d) {
    if (d.level === 'cell') return transform.applyY(d.y + d.rNow) + 16;
    if (d.level === 'tissue') return transform.applyY(d.y - d.rNow) + 4;
    return transform.applyY(d.y - d.rNow) - 26 - 15 * (d.lines.length - 1);
  }

  function ripple(n) {
    if (reducedMotion()) return;
    const c = gRipples.append('circle').attr('class', 'ripple').attr('cx', n.x).attr('cy', n.y).attr('r', n.rNow);
    c.transition().duration(900).ease(d3.easeCubicOut).attr('r', n.rNow + 26).style('opacity', 0).remove();
  }

  const animated = () => [...model.neurons, ...model.links, ...model.buds, ...model.ghosts];

  function snap() {
    for (const n of model.ordered) { n.rNow = n.rTarget; n.gNow = n.gTarget; }
    for (const e of animated()) e.shown = e.target;
    draw();
  }

  function animate() {
    cancelAnimationFrame(frame);
    if (reducedMotion()) return snap();
    const step = () => {
      let moving = false;
      for (const n of model.ordered) {
        const d = n.rTarget - n.rNow;
        if (Math.abs(d) > 0.2) { n.rNow += d * 0.14; moving = true; } else n.rNow = n.rTarget;
        const g = n.gTarget - n.gNow;
        if (Math.abs(g) > 0.005) { n.gNow += g * 0.1; moving = true; } else n.gNow = n.gTarget;
      }
      for (const e of animated()) {
        const d = e.target - e.shown;
        if (Math.abs(d) > 0.01) { e.shown += d * 0.14; moving = true; } else e.shown = e.target;
      }
      draw();
      if (moving) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function setTime(t, { instant = false } = {}) {
    if (!model) return;
    const forward = t >= tNow;
    tNow = t;
    for (const n of model.neurons) n.target = n.t <= t ? 1 : 0;
    const visibleChats = (n) => model.neurons.filter((nr) => nr.unit === n && nr.target === 1).length;
    for (const n of model.ordered) {
      if (n.level === 'cell' && !n.children.length) {
        const visible = visibleChats(n);
        const commits = n.commitTimes.filter((ts) => ts <= t).length;
        // Decisions carry no date: they count once the unit has a conversation.
        const work = visible + commits + (visible > 0 ? n.decisions : 0);
        n.rTarget = (n.workTotal === 0 && n.born <= t) || work > 0 ? cellRadius(work) : 0;
        n.visible = visible;
      } else {
        n.rTarget = n.born <= t ? n.rFull : 0;
        n.visible = visibleChats(n);
      }
      n.gTarget = n.born <= t ? 1 : 0;
    }
    for (const b of model.buds) {
      const phase = workCellPhase(b.data, t);
      if (!instant && forward && b.phase === 'alive' && phase === 'fused') ripple(b.unit);
      b.phase = phase;
      b.target = phase === 'alive' && b.unit.rTarget > 0 ? 1 : 0;
    }
    for (const g of model.ghosts) {
      g.mode = t < g.from ? 'unborn' : t < g.until ? 'alive' : 'fused';
      if (!instant && forward && g.mode === 'fused' && g.target === 1) ripple(g.unit);
      g.target = g.mode === 'alive' && g.unit.rTarget > 0 ? 1 : 0;
    }
    for (const l of model.links) l.target = l.t <= t && l.a.rTarget > 0 && l.b.rTarget > 0 ? 1 : 0;
    gLabels.selectAll('tspan.meta').text((d) => unitMeta(d.data, d.visible));
    if (instant) snap();
    else animate();
  }

  function bounds(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of items) {
      const r = c.packR ?? c.r;
      x0 = Math.min(x0, c.x - r);
      x1 = Math.max(x1, c.x + r);
      y0 = Math.min(y0, c.y - r);
      y1 = Math.max(y1, c.y + r);
    }
    return { x0, y0, x1, y1 };
  }

  function transformFor(b, maxScale) {
    const area = freeArea();
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    const k = Math.min(maxScale, (area.width - 24) / w, (area.height - 24 - LABEL_MARGIN) / h);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const midY = area.top + area.height / 2 + (LABEL_TOP - LABEL_BOTTOM) / 2;
    return d3.zoomIdentity.translate(area.left + area.width / 2, midY).scale(k).translate(-cx, -cy);
  }

  function moveTo(target, animatedMove) {
    if (animatedMove && !reducedMotion()) svg.transition().duration(550).ease(d3.easeCubicOut).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  // Where a unit sits once everything has gathered, whatever moment the timeline shows.
  function fullPosition(n) {
    if (!n.parent) return { x: n.rootX, y: n.rootY };
    const p = fullPosition(n.parent);
    return { x: p.x + n.relX, y: p.y + n.relY };
  }
  const boxes = (items) => items.map((n) => ({ ...fullPosition(n), packR: n.packR, level: n.level }));

  function fit(animatedMove = false) {
    if (!model || !model.roots.length) return;
    moveTo(transformFor(bounds(boxes(model.roots)), 1.35), animatedMove);
  }

  function focusUnit(id) {
    const n = model?.nodes.get(id);
    if (n) moveTo(transformFor(bounds(boxes([n])), n.level === 'cell' ? 2.4 : 1.8), true);
  }

  function focusLink(id) {
    const l = model?.linkById.get(id);
    if (l) moveTo(transformFor(bounds(boxes([l.a, l.b])), 1.8), true);
  }

  function centreOn(x, y, k) {
    const area = freeArea();
    moveTo(d3.zoomIdentity.translate(area.left + area.width / 2, area.top + area.height / 2).scale(k).translate(-x, -y), true);
  }

  function focusChat(id) {
    const n = model?.neuronById.get(id);
    if (n) centreOn(n.x, n.y, Math.min(2.2, Math.max(transform.k, 1.5)));
  }

  // Close enough that the organelles (the branch's files) show.
  function focusWorkCell(id) {
    const b = model?.budById.get(id);
    if (!b) return;
    const here = b.shown > 0.02 ? b : b.unit;
    centreOn(here.x, here.y, Math.max(NEAR_ZOOM + 0.6, transform.k));
  }

  function select(sel) {
    selection = sel;
    if (!model) return;
    const units = new Set();
    const neurons = new Set();
    const buds = new Set();
    const withAncestors = (n) => { for (let p = n; p; p = p.parent) units.add(p.id); };
    const withDescendants = (n) => { units.add(n.id); n.children.forEach(withDescendants); };
    let link = null;
    if (sel?.type === 'unit') {
      const n = model.nodes.get(sel.id);
      if (n) { withAncestors(n); withDescendants(n); }
    } else if (sel?.type === 'chat') {
      const nr = model.neuronById.get(sel.id);
      if (nr) {
        neurons.add(nr.id);
        withAncestors(nr.unit);
        for (const s of model.synapses) {
          if (s.a === nr) neurons.add(s.b.id);
          if (s.b === nr) neurons.add(s.a.id);
        }
        if (nr.bud) buds.add(nr.bud.id);
      }
    } else if (sel?.type === 'workcell') {
      const b = model.budById.get(sel.id);
      if (b) {
        buds.add(b.id);
        withAncestors(b.unit);
        b.touched.forEach((t) => units.add(t.id));
        b.data.clashWith.forEach((id) => buds.add(id));
        for (const nr of model.neurons) if (nr.bud === b) neurons.add(nr.id);
      }
    } else if (sel?.type === 'link') {
      link = model.linkById.get(sel.id);
      if (link) { withDescendants(link.a); withDescendants(link.b); }
    }
    if (sel?.type === 'unit' || sel?.type === 'link') {
      for (const nr of model.neurons) if (units.has(nr.unit.id)) neurons.add(nr.id);
    }
    svg.classed('has-selection', !!sel);
    gUnits.selectAll('g.unit')
      .classed('is-selected', (d) => sel?.type === 'unit' && d.id === sel.id)
      .classed('is-related', (d) => units.has(d.id));
    gLabels.selectAll('g.label').classed('is-related', (d) => units.has(d.id));
    gBuds.selectAll('g.bud')
      .classed('is-selected', (d) => sel?.type === 'workcell' && d.id === sel.id)
      .classed('is-related', (d) => buds.has(d.id) || (sel?.type === 'unit' && units.has(d.unit.id)));
    gLinks.selectAll('g.unit-link')
      .classed('is-selected', (l) => l === link)
      .classed('is-related', (l) => l === link || (sel?.type === 'unit' && (units.has(l.a.id) || units.has(l.b.id)) && (l.a.id === sel.id || l.b.id === sel.id)));
    gNeurons.selectAll('g.neuron')
      .classed('is-selected', (n) => sel?.type === 'chat' && n.id === sel.id)
      .classed('is-related', (n) => neurons.has(n.id));
    gSyn.selectAll('path.synapse')
      .classed('is-related', (s) => sel?.type === 'chat' && (s.a.id === sel.id || s.b.id === sel.id));
    gTethers.selectAll('path.tether').classed('is-related', (n) => neurons.has(n.id) && buds.has(n.bud.id));
  }

  function setProject(project) {
    model = layout(project, freeArea(), labelFor);
    tNow = Infinity;
    build();
    select(selection);
  }

  return { setProject, setTime, select, fit, focusUnit, focusChat, focusLink, focusWorkCell };
}
