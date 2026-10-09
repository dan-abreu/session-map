const d3 = window.d3;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const NEURON_R = 5.5;
const LABEL_GAP = 18;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Size follows accumulated work (conversations + commits + decisions), on a square-root scale.
const radiusFor = (work) => 28 + 12 * Math.sqrt(work);
const isWork = (item) => item.kind === 'commit' || item.kind === 'merge';

// Labels live outside the zoomed group so they stay readable at any zoom; the layout reserves room for them.
function wrapLabel(text, max = 16) {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur || (cur + ' ' + w).length <= max) lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    else lines.push(w);
  }
  if (lines.length > 2) lines.splice(2, lines.length, `${lines[1]}…`);
  return lines.map((l) => (l.length > max + 4 ? `${l.slice(0, max + 3)}…` : l));
}

// Smooth closed curve through wobbly points: a membrane, not a perfect circle.
function membranePath(r, seed, amp = 0.035) {
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
  const cx = mx - dy * bend, cy = my + dx * bend;
  return `M${x1.toFixed(2)},${y1.toFixed(2)}Q${cx.toFixed(2)},${cy.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

// Unit-circle offsets for a cell's neurons; scaled by the cell's current radius so neurons stay inside while it grows.
function neuronOffsets(chats, seed) {
  const n = chats.length;
  return chats.map((c, i) => {
    if (n <= 7) {
      const a = seed * Math.PI * 2 + (i / n) * Math.PI * 2;
      const rho = (n === 1 ? 0.58 : 0.62) + (hash(c.sessionId) - 0.5) * 0.12;
      return { u: Math.cos(a) * rho, v: Math.sin(a) * rho };
    }
    const rho = 0.34 + 0.52 * Math.sqrt((i + 0.5) / n);
    const a = seed * Math.PI * 2 + i * GOLDEN;
    return { u: Math.cos(a) * rho, v: Math.sin(a) * rho };
  });
}

export function neuronKind(chat) {
  if (chat.waiting && (chat.waiting.strong || chat.waiting.items.length)) return 'waiting';
  return chat.status;
}

export function isUnsure(chat) {
  return chat.cellSource === 'none' || chat.frontSource === 'guess';
}

function layout(project, aspect, labelFor, metaFor) {
  const chatById = new Map(project.chats.map((c) => [c.sessionId, c]));
  const mainFront = project.fronts.find((f) => f.path === project.root);

  const cells = project.cells.map((cell, idx) => {
    const chats = cell.chatIds.map((id) => chatById.get(id)).filter(Boolean)
      .sort((a, b) => (a.frontId || '').localeCompare(b.frontId || '') || a.startedAt.localeCompare(b.startedAt));
    const commitTimes = (project.activity || []).filter((a) => isWork(a) && a.cellIds.includes(cell.id))
      .map((a) => Date.parse(a.ts)).sort((a, b) => a - b);
    const decisions = cell.work?.decisions ?? cell.nucleus.decided.length;
    const workTotal = chats.length + commitTimes.length + decisions;
    const rFull = radiusFor(workTotal);
    const lines = wrapLabel(labelFor(cell));
    const labelHalf = Math.max(Math.max(...lines.map((l) => l.length)) * 3.9, metaFor(cell, chats.length).length * 3.3);
    const seed = hash(cell.id);
    return {
      id: cell.id, data: cell, chats, commitTimes, decisions, workTotal, rFull, rNow: 0, rTarget: 0, lines, seed, idx,
      labelHalf, collide: Math.max(rFull + 40 + 14 * (lines.length - 1), labelHalf + 20),
    };
  });

  const cellOfChat = new Map();
  for (const cell of cells) for (const c of cell.chats) cellOfChat.set(c.sessionId, cell);

  const neurons = [];
  for (const cell of cells) {
    neuronOffsets(cell.chats, cell.seed).forEach((off, i) => {
      const chat = cell.chats[i];
      neurons.push({
        id: chat.sessionId, chat, cell, ...off,
        bend: (hash(chat.sessionId + 'b') - 0.5) * 0.5,
        t: Date.parse(chat.startedAt), shown: 0, target: 0,
      });
    });
  }
  const neuronById = new Map(neurons.map((n) => [n.id, n]));

  const synapses = [];
  for (const n of neurons) {
    const parent = n.chat.parentId && neuronById.get(n.chat.parentId);
    if (parent) synapses.push({ kind: 'parent', id: `p:${n.id}`, a: parent, b: n, bend: 0.22 });
  }
  for (const front of project.fronts) {
    if (front === mainFront) continue;
    const members = front.chatIds.map((id) => neuronById.get(id)).filter(Boolean).sort((a, b) => a.t - b.t);
    for (let i = 1; i < members.length; i++) {
      synapses.push({ kind: 'front', id: `f:${front.id}:${i}`, a: members[i - 1], b: members[i], bend: -0.16, front });
    }
  }

  const cellById = new Map(cells.map((c) => [c.id, c]));
  const links = (project.cellLinks || []).map((l) => ({
    id: `${l.a}|${l.b}`, data: l, a: cellById.get(l.a), b: cellById.get(l.b),
    weight: Math.min(4, Math.max(1, l.weight || 1)), t: Date.parse(l.since),
    bend: (hash(l.a + l.b) - 0.5) * 0.36, shown: 0, target: 0,
  })).filter((l) => l.a && l.b && l.a !== l.b);

  const order = cells.slice().sort((a, b) => b.chats.length - a.chats.length);
  order.forEach((c, i) => {
    const rad = 60 * Math.sqrt(i + 0.5);
    c.x = Math.cos(i * GOLDEN) * rad * Math.sqrt(aspect);
    c.y = Math.sin(i * GOLDEN) * rad / Math.sqrt(aspect);
  });
  const sim = d3.forceSimulation(cells)
    .force('collide', d3.forceCollide((d) => d.collide).strength(1).iterations(3))
    .force('x', d3.forceX(0).strength(aspect >= 1 ? 0.02 / aspect : 0.035 / aspect))
    .force('y', d3.forceY(0).strength(aspect >= 1 ? 0.0425 * aspect ** 1.3 : 0.035 * aspect))
    .force('link', d3.forceLink(links.map((l) => ({ source: l.a, target: l.b, weight: l.weight })))
      .distance((l) => l.source.collide + l.target.collide).strength((l) => 0.6 + 0.1 * l.weight))
    .stop();
  for (let i = 0; i < 360; i++) sim.tick();

  return { cells, neurons, synapses, links, neuronById, cellById, linkById: new Map(links.map((l) => [l.id, l])) };
}

const ICON_BANG = 'M0,-3.6V0.6';
const ICON_ASK = 'M-1.9,-1.9a1.95,1.95 0 1 1 2.4,1.9c-0.5,0.15-0.5,0.5-0.5,1.1';

export function createBrain(svgEl, { onSelect, labelFor, statusLabel, chatsLabel, chatsShort, linkLabel, freeArea }) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const world = svg.append('g').attr('class', 'world');
  const gCells = world.append('g').attr('class', 'cells');
  const gLinks = world.append('g').attr('class', 'cell-links');
  const gSyn = world.append('g').attr('class', 'synapses');
  const gNeurons = world.append('g').attr('class', 'neurons');
  const gLabels = svg.append('g').attr('class', 'labels').attr('aria-hidden', 'true');

  let model = null;
  const metaFor = (cell, n) => `${statusLabel(cell.status)} · ${chatsShort(n)}`;
  let selection = null;
  let transform = d3.zoomIdentity;
  let frame = 0;

  const zoom = d3.zoom()
    .scaleExtent([0.25, 4])
    .on('zoom', (event) => {
      transform = event.transform;
      world.attr('transform', transform);
      placeLabels();
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (event) => {
    if (event.target === svgEl) onSelect(null);
  });

  function activate(sel) {
    return (event) => {
      event.stopPropagation();
      onSelect(sel);
    };
  }
  function keyActivate(sel) {
    return (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(sel);
      }
    };
  }

  function build() {
    gCells.selectAll('*').remove();
    gLinks.selectAll('*').remove();
    gSyn.selectAll('*').remove();
    gNeurons.selectAll('*').remove();
    gLabels.selectAll('*').remove();

    const cellG = gCells.selectAll('g.cell').data(model.cells, (d) => d.id).join('g')
      .attr('class', (d) => `cell status-${d.data.status}`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => `${labelFor(d.data)}, ${statusLabel(d.data.status)}, ${chatsLabel(d.chats.length)}`)
      .on('click', (event, d) => activate({ type: 'cell', id: d.id })(event))
      .on('keydown', (event, d) => keyActivate({ type: 'cell', id: d.id })(event));
    cellG.append('path').attr('class', 'membrane');
    cellG.append('path').attr('class', 'membrane-inner');
    cellG.append('g').attr('class', 'dendrites').selectAll('path')
      .data((d) => model.neurons.filter((n) => n.cell === d)).join('path').attr('class', 'dendrite');
    cellG.append('circle').attr('class', 'nucleus').attr('r', (d) => 6.5 + Math.min(4, d.chats.length * 0.5));
    cellG.append('circle').attr('class', 'nucleolus').attr('r', 2.2).attr('cx', 1.4).attr('cy', -1.2);

    const linkG = gLinks.selectAll('g.cell-link').data(model.links, (d) => d.id).join('g')
      .attr('class', 'cell-link')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => linkLabel(d.a.data, d.b.data))
      .on('click', (event, d) => activate({ type: 'link', id: d.id })(event))
      .on('keydown', (event, d) => keyActivate({ type: 'link', id: d.id })(event));
    linkG.append('path').attr('class', 'link-hit');
    linkG.append('path').attr('class', 'link-axon').attr('stroke-width', (d) => 1.1 + d.weight * 0.85);
    linkG.append('circle').attr('class', 'link-bulb end-a').attr('r', (d) => 2.2 + d.weight * 0.55);
    linkG.append('circle').attr('class', 'link-bulb end-b').attr('r', (d) => 2.2 + d.weight * 0.55);

    gSyn.selectAll('path').data(model.synapses, (d) => d.id).join('path')
      .attr('class', (d) => `synapse ${d.kind}${d.a.cell === d.b.cell ? '' : ' cross'}`);

    const nG = gNeurons.selectAll('g.neuron').data(model.neurons, (d) => d.id).join('g')
      .attr('class', (d) => `neuron kind-${neuronKind(d.chat)}${d.chat.waiting.weak ? ' weak' : ''}`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => d.chat.title)
      .on('click', (event, d) => activate({ type: 'chat', id: d.id })(event))
      .on('keydown', (event, d) => keyActivate({ type: 'chat', id: d.id })(event));
    const body = nG.append('g').attr('class', 'neuron-body');
    body.append('circle').attr('class', 'hit').attr('r', 13);
    body.filter((d) => d.chat.status === 'busy').append('circle').attr('class', 'pulse').attr('r', NEURON_R);
    body.append('circle').attr('class', 'dot').attr('r', (d) => {
      const k = neuronKind(d.chat);
      return k === 'waiting' ? 7.5 : k === 'closed' ? 4.2 : NEURON_R;
    });
    body.filter((d) => neuronKind(d.chat) === 'waiting').append('path').attr('class', 'glyph').attr('d', ICON_BANG);
    body.filter((d) => neuronKind(d.chat) === 'waiting').append('circle').attr('class', 'glyph-dot').attr('cy', 2.9).attr('r', 1.1);
    const unsure = body.filter((d) => isUnsure(d.chat)).append('g').attr('class', 'unsure').attr('transform', 'translate(8,-8)');
    unsure.append('circle').attr('r', 5.6);
    unsure.append('path').attr('d', ICON_ASK);
    unsure.append('circle').attr('class', 'ask-dot').attr('cy', 2.7).attr('r', 0.85);

    const lab = gLabels.selectAll('g.label').data(model.cells, (d) => d.id).join('g')
      .attr('class', (d) => `label status-${d.data.status}`);
    const text = lab.append('text').attr('text-anchor', 'middle');
    text.each(function (d) {
      const el = d3.select(this);
      d.lines.forEach((line, i) => el.append('tspan').attr('class', 'name').attr('x', 0).attr('dy', i ? '1.15em' : 0).text(line));
      el.append('tspan').attr('class', 'meta').attr('x', 0).attr('dy', '1.3em')
        .text(metaFor(d.data, d.chats.length));
    });
  }

  function draw() {
    gCells.selectAll('g.cell')
      .attr('transform', (d) => `translate(${d.x.toFixed(2)},${d.y.toFixed(2)})`)
      .attr('opacity', (d) => Math.min(1, d.rNow / Math.max(1, d.rTarget || d.rFull) * 1.4))
      .style('display', (d) => (d.rNow < 1 ? 'none' : null));
    gCells.selectAll('path.membrane').attr('d', (d) => membranePath(d.rNow, d.seed));
    gCells.selectAll('path.membrane-inner').attr('d', (d) => membranePath(Math.max(0, d.rNow - 4.5), d.seed, 0.03));
    gCells.selectAll('path.dendrite')
      .attr('d', (n) => curve(0, 0, n.u * n.cell.rNow, n.v * n.cell.rNow, n.bend))
      .attr('opacity', (n) => n.shown);

    gNeurons.selectAll('g.neuron')
      .attr('transform', (n) => `translate(${(n.cell.x + n.u * n.cell.rNow).toFixed(2)},${(n.cell.y + n.v * n.cell.rNow).toFixed(2)})`)
      .style('display', (n) => (n.shown < 0.02 ? 'none' : null))
      .select('.neuron-body')
      .attr('transform', (n) => `scale(${n.shown.toFixed(3)})`);

    gLinks.selectAll('g.cell-link').each(function (l) {
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
      .attr('d', (s) => curve(
        s.a.cell.x + s.a.u * s.a.cell.rNow, s.a.cell.y + s.a.v * s.a.cell.rNow,
        s.b.cell.x + s.b.u * s.b.cell.rNow, s.b.cell.y + s.b.v * s.b.cell.rNow, s.bend))
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

  function placeLabels() {
    if (!model) return;
    gLabels.selectAll('g.label')
      .attr('transform', (d) => `translate(${transform.applyX(d.x).toFixed(1)},${(transform.applyY(d.y + d.rNow) + LABEL_GAP).toFixed(1)})`)
      .style('display', (d) => (d.rNow < 1 ? 'none' : null))
      .attr('opacity', (d) => Math.min(1, d.rNow / Math.max(1, d.rTarget || d.rFull)));
  }

  function animate() {
    cancelAnimationFrame(frame);
    if (reducedMotion()) {
      for (const c of model.cells) c.rNow = c.rTarget;
      for (const n of [...model.neurons, ...model.links]) n.shown = n.target;
      draw();
      return;
    }
    const step = () => {
      let moving = false;
      for (const c of model.cells) {
        const d = c.rTarget - c.rNow;
        if (Math.abs(d) > 0.2) { c.rNow += d * 0.16; moving = true; } else c.rNow = c.rTarget;
      }
      for (const n of [...model.neurons, ...model.links]) {
        const d = n.target - n.shown;
        if (Math.abs(d) > 0.01) { n.shown += d * 0.2; moving = true; } else n.shown = n.target;
      }
      draw();
      if (moving) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function setTime(t, { instant = false } = {}) {
    if (!model) return;
    for (const n of model.neurons) n.target = n.t <= t ? 1 : 0;
    for (const c of model.cells) {
      const visible = model.neurons.filter((n) => n.cell === c && n.target === 1).length;
      const commits = c.commitTimes.filter((ts) => ts <= t).length;
      // Decisions carry no date: they count once the area has a conversation.
      const work = visible + commits + (visible > 0 ? c.decisions : 0);
      c.rTarget = c.workTotal === 0 || work > 0 ? radiusFor(work) : 0;
      c.visible = visible;
    }
    for (const l of model.links) l.target = l.t <= t && l.a.rTarget > 0 && l.b.rTarget > 0 ? 1 : 0;
    gLabels.selectAll('tspan.meta').text((d) => metaFor(d.data, d.visible));
    if (instant) {
      for (const c of model.cells) c.rNow = c.rTarget;
      for (const n of [...model.neurons, ...model.links]) n.shown = n.target;
      draw();
    } else animate();
  }

  function bounds(cells) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) {
      const half = Math.max(c.rFull, c.labelHalf * 1.15);
      x0 = Math.min(x0, c.x - half);
      x1 = Math.max(x1, c.x + half);
      y0 = Math.min(y0, c.y - c.rFull);
      y1 = Math.max(y1, c.y + c.rFull + 52);
    }
    return { x0, y0, x1, y1 };
  }

  function transformFor(b, maxScale) {
    const area = freeArea();
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    const k = Math.min(maxScale, (area.width - 24) / w, (area.height - 24) / h);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return d3.zoomIdentity
      .translate(area.left + area.width / 2, area.top + area.height / 2)
      .scale(k)
      .translate(-cx, -cy);
  }

  function moveTo(target, animated) {
    if (animated && !reducedMotion()) svg.transition().duration(550).ease(d3.easeCubicOut).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  function fit(animated = false) {
    if (!model || !model.cells.length) return;
    moveTo(transformFor(bounds(model.cells), 1.35), animated);
  }

  function focusCell(id) {
    const cell = model && model.cellById.get(id);
    if (!cell) return;
    moveTo(transformFor(bounds([cell]), 1.7), true);
  }

  function focusLink(id) {
    const l = model && model.linkById.get(id);
    if (l) moveTo(transformFor(bounds([l.a, l.b]), 1.5), true);
  }

  function focusChat(id) {
    const n = model && model.neuronById.get(id);
    if (!n) return;
    const area = freeArea();
    const x = n.cell.x + n.u * n.cell.rFull, y = n.cell.y + n.v * n.cell.rFull;
    const k = Math.min(1.6, Math.max(transform.k, 1.25));
    moveTo(d3.zoomIdentity.translate(area.left + area.width / 2, area.top + area.height / 2).scale(k).translate(-x, -y), true);
  }

  function select(sel) {
    selection = sel;
    if (!model) return;
    const related = new Set();
    let relatedCell = null;
    if (sel && sel.type === 'chat') {
      const n = model.neuronById.get(sel.id);
      if (n) {
        related.add(n.id);
        relatedCell = n.cell.id;
        for (const s of model.synapses) {
          if (s.a === n) related.add(s.b.id);
          if (s.b === n) related.add(s.a.id);
        }
      }
    }
    if (sel && sel.type === 'cell') relatedCell = sel.id;
    const link = sel && sel.type === 'link' ? model.linkById.get(sel.id) : null;
    const linkCells = new Set(link ? [link.a.id, link.b.id] : []);
    svg.classed('has-selection', !!sel);
    const cellRelated = (d) => d.id === relatedCell || linkCells.has(d.id) || model.neurons.some((n) => n.cell === d && related.has(n.id));
    gCells.selectAll('g.cell')
      .classed('is-selected', (d) => sel && sel.type === 'cell' && d.id === sel.id)
      .classed('is-related', cellRelated);
    gLabels.selectAll('g.label').classed('is-related', cellRelated);
    gLinks.selectAll('g.cell-link')
      .classed('is-selected', (l) => l === link)
      .classed('is-related', (l) => l === link || (sel?.type === 'cell' && (l.a.id === sel.id || l.b.id === sel.id)));
    gNeurons.selectAll('g.neuron')
      .classed('is-selected', (n) => sel && sel.type === 'chat' && n.id === sel.id)
      .classed('is-related', (n) => related.has(n.id) || n.cell.id === relatedCell || linkCells.has(n.cell.id));
    gSyn.selectAll('path.synapse')
      .classed('is-related', (s) => related.has(s.a.id) && related.has(s.b.id) && (s.a.id === sel?.id || s.b.id === sel?.id));
  }

  function setProject(project) {
    const rect = svgEl.getBoundingClientRect();
    const aspect = Math.min(2.2, Math.max(0.4, rect.width / Math.max(1, rect.height)));
    model = layout(project, aspect, labelFor, metaFor);
    build();
    select(selection);
  }

  return {
    setProject, setTime, select, fit, focusCell, focusChat, focusLink,
    hasCell: (id) => !!model?.cellById.get(id),
  };
}
