// The Flow's general view (flow.md fl08), drawn from the single model (fl07): who uses the program, its parts, the outside
// services and what runs on this computer, with words on every arrow. Pure, so the page draws with it and node:test
// checks it. Mermaid is only the drawing layer: this module turns the model into a flow.js model and prints it. The
// text starts with a marker line, so the general view can be copied and downloaded but never imported back as parts.
import { newId, printFlow } from './flow.js';
import { translator } from './i18n.js';

export const VIEW_MARKER = '%% session-map:view general';
// Looked for in the raw text, before the flowchart is parsed (the parser drops %% lines), also inside a ```mermaid fence.
export const isViewText = (text) => /^[ \t]*%%[ \t]*session-map:view\b/m.test(String(text ?? ''));

const english = translator('en');
const said = (tt, key) => {
  const s = key ? tt(key) : '';
  return s && s !== key ? s : '';
};

// A box's name in the page language: the catalog's words for what session-map found, the README's own words as written.
export function nodeName(node, tt = english) {
  return said(tt, node.nameKey) || said(english, node.nameKey) || node.name || node.id;
}

// The words on an arrow: the README's (or, later, the AI's) as written, else the catalog's or the parts' in the page
// language. Never a placeholder: an arrow nobody described has no words, and the facts list counts it.
export function edgeLabel(edge, tt = english) {
  const label = edge.label ?? {};
  if (label.text) return label.text;
  return said(tt, label.key) || said(english, label.key) || '';
}

export const originWord = (origin, tt = english) => said(tt, `flow.l1.origin.${origin}`) || origin;

// What Copy, Markdown and .mmd hand out: the drawing on screen.
export const exportTextFor = (level, exportText, l1Text) => (level === '1' ? l1Text : exportText);

const SAFE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const rank = (n) => (n.declaredCount ? 1e6 : 0) + (n.detectedCount ?? 0);

function shapeOf(n) {
  if (n.kind === 'actor') return 'stadium';
  if (n.kind === 'service') return n.where === 'this-pc' ? 'db' : 'hex';
  return n.shape ?? 'box';
}

// A README arrow keeps its own kind; an arrow only session-map found is dashed, and a "related" line has no head.
function drawKindOf(e) {
  if (e.declaredCount || e.declared?.length) return e.drawKind ?? 'arrow';
  return e.kind === 'related' ? 'dotted-line' : 'dotted';
}

// What a layer holds: only actors, only services on this computer, only outside services, or parts (and free boxes).
function layerClass(nodes) {
  if (nodes.every((n) => n.kind === 'actor')) return 'actors';
  if (nodes.every((n) => n.kind === 'service')) return nodes.every((n) => n.where === 'this-pc') ? 'thispc' : 'outside';
  return 'parts';
}

// The layers in the order the general view tells the story, left to right: who uses the program, then its layers from
// the one they touch to the deepest (how many layers away from the people each one is, by the arrows always shown),
// then what it uses on this computer, then on the internet. Layers no arrow reaches keep the README's order, after the
// rest. The same model gives the same order whatever order the README wrote its layers in.
export function layerOrder(model) {
  const nodes = (model.nodes ?? []).filter((n) => (n.level ?? 1) === 1);
  const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));
  const layers = (model.layers ?? []).filter((l) => nodes.some((n) => n.layer === l.id));
  const cls = new Map(layers.map((l) => [l.id, layerClass(nodes.filter((n) => n.layer === l.id))]));
  const near = new Map();
  const link = (a, b) => near.set(a, new Set([...(near.get(a) ?? []), b]));
  for (const e of model.edges ?? []) {
    if (e.hidden) continue;
    const a = layerOf.get(e.from), b = layerOf.get(e.to);
    if (!a || !b || a === b || !cls.has(a) || !cls.has(b)) continue;
    if (['thispc', 'outside'].includes(cls.get(a)) || ['thispc', 'outside'].includes(cls.get(b))) continue;
    link(a, b);
    link(b, a);
  }
  const dist = new Map();
  let wave = layers.filter((l) => cls.get(l.id) === 'actors').map((l) => l.id);
  for (let d = 0; wave.length; d++) {
    for (const id of wave) dist.set(id, d);
    wave = [...new Set(wave.flatMap((id) => [...(near.get(id) ?? [])]))].filter((id) => !dist.has(id)).sort();
  }
  const group = { actors: 0, parts: 1, thispc: 2, outside: 3 };
  const readme = new Map(layers.map((l, i) => [l.id, i]));
  return [...layers].sort((a, b) => group[cls.get(a.id)] - group[cls.get(b.id)]
    || (dist.get(a.id) ?? 1e9) - (dist.get(b.id) ?? 1e9)
    || (readme.get(a.id) - readme.get(b.id))).map((l) => l.id);
}

// mermaid stacks two groups whose boxes fall in the same columns one above the other, which turns the story into a
// staircase. Invisible links from the last boxes of each layer (no arrow inside the layer leaves them) to the first
// boxes of the next (no arrow inside it reaches them) keep every layer in a column of its own; both service layers
// stand right of the deepest layer of parts. flow: the drawn flow.js model (layers in story order); edges: the arrows
// as laid out; classOf: drawn layer id → 'actors' | 'parts' | 'thispc' | 'outside'. → extra lines for printFlow.
function layoutTies(flow, edges, classOf) {
  const layerOf = new Map(flow.nodes.map((n) => [n.id, n.layer]));
  const inside = edges.filter((e) => layerOf.get(e.from) && layerOf.get(e.from) === layerOf.get(e.to));
  const groups = flow.layers.map((l) => ({ cls: classOf.get(l.id), ids: flow.nodes.filter((n) => n.layer === l.id).map((n) => n.id) })).filter((g) => g.ids.length);
  // Arrows inside a layer that go round in a circle leave no clear first or last box: then every box is tied.
  const circular = (g) => {
    const ids = new Set(g.ids);
    const next = (id) => inside.filter((e) => e.from === id && ids.has(e.to)).map((e) => e.to);
    const state = new Map();
    const visit = (id) => {
      if (state.get(id) === 1) return true;
      if (state.get(id) === 2) return false;
      state.set(id, 1);
      const found = next(id).some(visit);
      state.set(id, 2);
      return found;
    };
    return g.ids.some(visit);
  };
  const last = (g) => (circular(g) ? g.ids : g.ids.filter((id) => !inside.some((e) => e.from === id)));
  const first = (g) => (circular(g) ? g.ids : g.ids.filter((id) => !inside.some((e) => e.to === id)));
  const chain = groups.filter((g) => g.cls === 'actors' || g.cls === 'parts');
  const services = groups.filter((g) => g.cls === 'thispc' || g.cls === 'outside');
  const pairs = chain.slice(1).map((g, i) => [chain[i], g]);
  if (chain.length) for (const s of services) pairs.push([chain.at(-1), s]);
  return pairs.flatMap(([a, b]) => last(a).flatMap((x) => first(b).map((y) => `${x} ~~~ ${y}`)));
}

const weightOf = (e) => (e.declaredCount ?? e.declared?.length ?? 0) * 1000 + (e.detectedCount ?? e.detected?.length ?? 0);

// Arrows between the same service and different parts with the same words are drawn once, from the part with the most
// evidence; the others go to `also` (the facts list and the arrow's hover title name them). → [{ edge, also: [nodeId] }]
export function bundleEdges(edges, kindOf) {
  const groups = new Map();
  const out = [];
  for (const e of edges) {
    const toSvc = kindOf(e.to) === 'service';
    const fromSvc = kindOf(e.from) === 'service';
    if (toSvc === fromSvc) {
      out.push({ edge: e, also: [] });
      continue;
    }
    const k = JSON.stringify([toSvc ? e.to : e.from, toSvc ? 'in' : 'out', e.label?.text ?? e.label?.key ?? '']);
    if (!groups.has(k)) {
      groups.set(k, { edge: e, also: [], all: [] });
      out.push(groups.get(k));
    }
    groups.get(k).all.push(e);
  }
  for (const g of groups.values()) {
    const ranked = g.all.sort((a, b) => weightOf(b) - weightOf(a) || a.id.localeCompare(b.id));
    const svcEnd = (e) => (kindOf(e.to) === 'service' ? e.from : e.to);
    g.edge = ranked[0];
    g.also = ranked.slice(1).map(svcEnd);
    delete g.all;
  }
  return out;
}

// model: the JSON model. journey: a journey id (unknown ones draw everything). showHidden: also the "uses" and "related"
// arrows found only in the code, chats and branches. maxOutside: the outside services drawn; the busiest stay, the rest
// go to meta.more. → { flow (a flow.js model), meta, text (with the view marker), drawText }. text keeps every arrow in
// the direction the facts give and is what Copy and the exports hand out; drawText is the copy mermaid lays out, where
// an arrow pointing back (from a layer further right to one further left) is written the other way round so the
// drawing reads left to right; meta.edges[i].reversed tells the page to put its head back where the facts say.
export function level1Flow(model, { journey = null, showHidden = false, tt = english, maxOutside = 12 } = {}) {
  const chosen = journey ? (model.journeys ?? []).find((j) => j.id === journey) : null;
  let nodes = model.nodes.filter((n) => (n.level ?? 1) === 1);
  let edges = model.edges.filter((e) => showHidden || !e.hidden);
  if (chosen) {
    const ns = new Set(chosen.nodes ?? []);
    const es = new Set(chosen.edges ?? []);
    nodes = nodes.filter((n) => ns.has(n.id));
    edges = edges.filter((e) => es.has(e.id));
  }
  const outside = nodes.filter((n) => n.kind === 'service' && n.where !== 'this-pc');
  let more = [];
  if (outside.length > maxOutside) {
    const keep = new Set([...outside].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id)).slice(0, maxOutside).map((n) => n.id));
    more = outside.filter((n) => !keep.has(n.id)).sort((a, b) => a.id.localeCompare(b.id)).map((n) => ({ nodeId: n.id, name: nodeName(n, tt) }));
    const gone = new Set(more.map((x) => x.nodeId));
    nodes = nodes.filter((n) => !gone.has(n.id));
  }
  const here = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => here.has(e.from) && here.has(e.to));

  const flow = { ok: true, direction: 'LR', layers: [], nodes: [], edges: [], extra: [], warnings: [] };
  const layerDraw = new Map();
  const taken = new Set();
  const story = layerOrder(model);
  const byStory = (model.layers ?? []).filter((l) => story.includes(l.id)).sort((a, b) => story.indexOf(a.id) - story.indexOf(b.id));
  for (const l of byStory) {
    if (!nodes.some((n) => n.layer === l.id)) continue;
    let id = String(l.drawId ?? '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!SAFE_ID.test(id) || taken.has(id.toLowerCase())) id = newId(flow, l.name ?? l.id);
    taken.add(id.toLowerCase());
    layerDraw.set(l.id, id);
    flow.layers.push({ id, name: said(tt, l.nameKey) || said(english, l.nameKey) || l.name || l.id });
  }
  const order = new Map(story.map((id, i) => [id, i]));
  const placed = [...nodes].sort((a, b) => (order.get(a.layer) ?? 1e9) - (order.get(b.layer) ?? 1e9) || a.id.localeCompare(b.id));
  const drawOf = new Map();
  const meta = { nodes: new Map(), edges: [], missing: 0, more, layers: layerDraw };
  for (const n of placed) {
    const own = n.drawId && SAFE_ID.test(n.drawId) && !flow.nodes.some((x) => x.id.toLowerCase() === n.drawId.toLowerCase()) && !taken.has(n.drawId.toLowerCase());
    const id = own ? n.drawId : newId(flow, nodeName(n, english));
    drawOf.set(n.id, id);
    flow.nodes.push({ id, label: nodeName(n, tt), layer: layerDraw.get(n.layer) ?? null, shape: shapeOf(n) });
    meta.nodes.set(id, {
      nodeId: n.id, kind: n.kind, where: n.where ?? null, partId: n.partId ?? null, origin: n.origin, badges: n.badges ?? [],
      evidence: [...(n.declared ?? []), ...(n.detected ?? [])],
    });
  }
  const cls = (layerId) => layerClass(nodes.filter((n) => n.layer === layerId));
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const layerOfNode = new Map(nodes.map((n) => [n.id, n.layer]));
  const drawEdges = [];
  for (const { edge: e, also } of bundleEdges(edges, (id) => kindOf.get(id))) {
    const missing = Boolean(e.label?.missing);
    if (missing) meta.missing++;
    const a = order.get(layerOfNode.get(e.from)), b = order.get(layerOfNode.get(e.to));
    const reversed = a != null && b != null && a > b;
    meta.edges.push({ index: flow.edges.length, edgeId: e.id, kind: e.kind, origin: e.origin, badges: e.badges ?? [], missing, hidden: Boolean(e.hidden), reversed, also });
    const drawn = { from: drawOf.get(e.from), to: drawOf.get(e.to), label: edgeLabel(e, tt), kind: drawKindOf(e) };
    flow.edges.push(drawn);
    drawEdges.push(reversed ? { ...drawn, from: drawn.to, to: drawn.from } : drawn);
  }
  const classOf = new Map([...layerDraw].map(([id, draw]) => [draw, cls(id)]));
  const drawFlow = { ...flow, edges: drawEdges, extra: layoutTies(flow, drawEdges, classOf) };
  return { flow, meta, text: `${VIEW_MARKER}\n${printFlow(flow)}`, drawText: `${VIEW_MARKER}\n${printFlow(drawFlow)}`, scene: sceneOf(flow, drawEdges, meta, classOf) };
}

// What the page lays out itself (flowgrid.js): the bands top to bottom (who uses it; each layer of parts in story
// order; boxes with no layer; this computer and the internet side by side at the bottom) and the arrows as laid out.
function sceneOf(flow, drawEdges, meta, classOf) {
  const group = (l) => ({ id: l.id, title: l.name, cls: classOf.get(l.id) ?? 'parts' });
  const of = (...kinds) => flow.layers.filter((l) => kinds.includes(classOf.get(l.id) ?? 'parts')).map(group);
  const rows = [];
  if (of('actors').length) rows.push({ groups: of('actors') });
  for (const g of of('parts')) rows.push({ groups: [g] });
  if (flow.nodes.some((n) => !n.layer)) rows.push({ groups: [{ id: null, title: '', cls: 'parts' }] });
  if (of('thispc', 'outside').length) rows.push({ groups: of('thispc', 'outside') });
  return {
    rows,
    nodes: flow.nodes.map((n) => ({ id: n.id, label: n.label, group: n.layer ?? null, shape: n.shape })),
    edges: drawEdges.map((e, i) => ({ index: i, from: e.from, to: e.to, label: e.label, kind: e.kind, headAtStart: Boolean(meta.edges[i]?.reversed) })),
  };
}

// ---- what the Flow tab shows around the drawing (legend, journey filter, facts list, hover title) ----

// The fixed legend: the general view always lists the same items, present in the drawing or not.
export const legendKeys = (level) => (level === '1'
  ? ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'actor', 'svc', 'local', 'declared', 'detected']
  : ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'free']);

export const legendWords = (k, tt = english) => tt(['blocks', 'waiting'].includes(k) ? `flow.flag.${k}` : ['declared', 'detected'].includes(k) ? `flow.arrow.${k}` : `flow.tone.${k}`);

// The journey filter lists what the model holds; an empty list means the filter has nothing to offer yet.
export function journeyChoices(model, tt = english) {
  return (model?.journeys ?? []).map((j) => {
    const node = j.args?.node ? (model.nodes ?? []).find((n) => n.id === j.args.node) : null;
    const label = said(tt, j.nameKey) ? tt(j.nameKey, { node: node ? nodeName(node, tt) : '' }) : j.name || j.id;
    return { id: j.id, label };
  });
}

const evidenceText = (ev) => (ev?.line ? `${ev.file}:${ev.line}` : ev?.file ?? '');
const badgesOf = (x, tt) => (x.badges?.length ? x.badges : x.origin ? [x.origin] : []).map((b) => originWord(b, tt));
const kindWord = (info, tt) => tt(`flow.l1.kind.${info.kind === 'service' ? (info.where === 'this-pc' ? 'local' : 'service') : info.kind === 'actor' ? 'actor' : info.kind === 'free' ? 'free' : 'part'}`);

// The title a drawn box shows on hover: what it is, where it came from, and one place in the code to check.
export function boxTitle(info, name, tt = english) {
  const first = evidenceText(info.evidence?.[0]);
  return [name, kindWord(info, tt), ...badgesOf(info, tt), first].filter(Boolean).join(' · ');
}

// Everything on screen as plain rows, with the evidence the owner can check: boxes first, then arrows.
export function factRows(model, meta, tt = english) {
  const byId = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const nameOf = (id) => (byId.get(id) ? nodeName(byId.get(id), tt) : id);
  const rows = [];
  for (const info of meta.nodes.values()) {
    const n = byId.get(info.nodeId);
    if (!n) continue;
    rows.push({ type: 'box', text: nodeName(n, tt), label: kindWord(info, tt), badges: badgesOf(info, tt), evidence: (info.evidence ?? []).slice(0, 3).map(evidenceText) });
  }
  const edges = new Map((model.edges ?? []).map((e) => [e.id, e]));
  for (const m of meta.edges) {
    const e = edges.get(m.edgeId);
    if (!e) continue;
    rows.push({
      type: 'arrow', text: `${nameOf(e.from)} → ${nameOf(e.to)}`, label: edgeLabel(e, tt) || tt('flow.l1.lbl.missing'), badges: badgesOf(e, tt),
      evidence: [...(e.declared ?? []), ...(e.detected ?? [])].slice(0, 3).map(evidenceText), also: (m.also ?? []).map(nameOf),
    });
  }
  return rows;
}

export const levelNote = (meta, tt = english) => (meta?.missing > 0 ? tt.count('flow.l1.unlabeled', meta.missing) : '');
