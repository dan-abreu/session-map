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

// The page language ('en', 'pt-BR'), read from the dictionary itself so any translator works.
export const pageLang = (tt = english) => said(tt, 'flow.lang') || 'en';

// A box's name inside a sentence: the catalog's words are already in the page language; a name the README wrote is the
// owner's own name for the thing and keeps its words, in quotes, so "Você abre “Mind map page”" reads as one language.
export function ownName(node, tt = english) {
  if (!node) return '';
  const name = nodeName(node, tt);
  return said(tt, node.nameKey) || said(english, node.nameKey) ? name : `“${name}”`;
}

// The common names a README gives its layers, said in the page language. Only an exact name (or subgraph id) is
// translated; in English, and for any other name, the README's own words stay.
const LAYER_WORDS = {
  'what it reads': 'reads', sources: 'reads', inputs: 'reads', input: 'reads',
  'what it works out': 'works', engine: 'works', logic: 'works', processing: 'works',
  'what you touch': 'touch', surface: 'touch', 'user interface': 'ui', ui: 'ui', interface: 'ui',
  core: 'core', frontend: 'frontend', 'front end': 'frontend', 'front-end': 'frontend', backend: 'backend', 'back end': 'backend', 'back-end': 'backend',
  data: 'data', storage: 'storage', database: 'database', infrastructure: 'infra', infra: 'infra', services: 'services', api: 'api',
  domain: 'domain', presentation: 'presentation', persistence: 'persistence',
};
export function layerName(layer, tt = english) {
  if (!layer) return '';
  const catalog = said(tt, layer.nameKey) || said(english, layer.nameKey);
  if (catalog) return catalog;
  const own = layer.name || layer.id || '';
  if (pageLang(tt) === 'en') return own;
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const k = LAYER_WORDS[norm(layer.name)] ?? LAYER_WORDS[norm(layer.drawId)];
  return (k && said(tt, `flow.layer.${k}`)) || own;
}

// The language a short sentence is written in, by its little words: 'en', 'pt' or null when it cannot tell.
const EN_WORDS = new Set('the and of to is in for with from that it on as by its this are be or an which what when each every into one no not'.split(' '));
const PT_WORDS = new Set('o os as de do da dos das que para com em no na nos nas um uma é não se por ao pelo pela cada isso este esta onde quando como'.split(' '));
export function textLang(text) {
  let en = 0;
  let pt = 0;
  for (const w of String(text ?? '').toLowerCase().split(/[^a-zà-ú]+/)) {
    if (EN_WORDS.has(w)) en++;
    if (PT_WORDS.has(w)) pt++;
  }
  if (en >= 2 && en > pt * 1.5) return 'en';
  if (pt >= 2 && pt > en * 1.5) return 'pt';
  return null;
}
const sameLang = (text, tt) => {
  const l = textLang(text);
  return !l || pageLang(tt).startsWith(l);
};

// The words on an arrow: the README's (or, later, the AI's) as written, else the catalog's or the parts' in the page
// language. Never a placeholder: an arrow nobody described has no words, and the facts list counts it.
export function edgeLabel(edge, tt = english) {
  const label = edge.label ?? {};
  if (label.text) return label.text;
  return said(tt, label.key) || said(english, label.key) || '';
}

export const originWord = (origin, tt = english) => said(tt, `flow.l1.origin.${origin}`) || origin;

// What Copy, Markdown and .mmd hand out: the drawing on screen.
export const exportTextFor = (level, exportText, l1Text) => (level === '1' || level === '2' || level === 'journeys' ? l1Text : exportText);

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

// model: the JSON model. journey: a journey id (fl10): every box stays, and meta.journey says which boxes and arrows are
// on it ({ id, nodes: Set(draw ids), edges: Set(arrow indexes), steps: Map(index → [n]) }) so the page dims the rest;
// its arrows carry their step numbers ("1 · pages and clicks"), are never drawn once for several parts, and its boxes
// are never left out among the "more" services. An unknown journey is no journey. showHidden: also the "uses" and "related"
// arrows found only in the code, chats and branches. maxOutside: the outside services drawn; the busiest stay, the rest
// go to meta.more. → { flow (a flow.js model), meta, text (with the view marker), drawText }. text keeps every arrow in
// the direction the facts give and is what Copy and the exports hand out; drawText is the copy mermaid lays out, where
// an arrow pointing back (from a layer further right to one further left) is written the other way round so the
// drawing reads left to right; meta.edges[i].reversed tells the page to put its head back where the facts say.
export function level1Flow(model, { journey = null, showHidden = false, tt = english, maxOutside = 12 } = {}) {
  const chosen = journey ? (model.journeys ?? []).find((j) => j.id === journey) ?? null : null;
  const onNodes = new Set(chosen?.nodes ?? []);
  const stepsOf = new Map();
  for (const st of chosen?.steps ?? []) stepsOf.set(st.edgeId, [...(stepsOf.get(st.edgeId) ?? []), st.n]);
  for (const id of chosen?.edges ?? []) if (!stepsOf.has(id)) stepsOf.set(id, []);
  let nodes = model.nodes.filter((n) => (n.level ?? 1) === 1);
  let edges = model.edges.filter((e) => showHidden || !e.hidden || stepsOf.has(e.id));
  const outside = nodes.filter((n) => n.kind === 'service' && n.where !== 'this-pc');
  let more = [];
  if (outside.length > maxOutside) {
    const pinned = outside.filter((n) => onNodes.has(n.id)).length;
    const keep = new Set([...outside].sort((a, b) => Number(onNodes.has(b.id)) - Number(onNodes.has(a.id)) || rank(b) - rank(a) || a.id.localeCompare(b.id)).slice(0, Math.max(maxOutside, pinned)).map((n) => n.id));
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
    flow.layers.push({ id, name: layerName(l, tt) });
  }
  const order = new Map(story.map((id, i) => [id, i]));
  const placed = [...nodes].sort((a, b) => (order.get(a.layer) ?? 1e9) - (order.get(b.layer) ?? 1e9) || a.id.localeCompare(b.id));
  const drawOf = new Map();
  const meta = { nodes: new Map(), edges: [], missing: 0, more, layers: layerDraw, journey: chosen ? { id: chosen.id, nodes: new Set(), edges: new Set(), steps: new Map() } : null };
  for (const n of placed) {
    const own = n.drawId && SAFE_ID.test(n.drawId) && !flow.nodes.some((x) => x.id.toLowerCase() === n.drawId.toLowerCase()) && !taken.has(n.drawId.toLowerCase());
    const id = own ? n.drawId : newId(flow, nodeName(n, english));
    drawOf.set(n.id, id);
    if (onNodes.has(n.id)) meta.journey.nodes.add(id);
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
  const bundled = [...bundleEdges(edges.filter((e) => !stepsOf.has(e.id)), (id) => kindOf.get(id)), ...edges.filter((e) => stepsOf.has(e.id)).map((edge) => ({ edge, also: [] }))];
  for (const { edge: e, also } of bundled) {
    const missing = Boolean(e.label?.missing);
    if (missing) meta.missing++;
    const a = order.get(layerOfNode.get(e.from)), b = order.get(layerOfNode.get(e.to));
    const reversed = a != null && b != null && a > b;
    meta.edges.push({ index: flow.edges.length, edgeId: e.id, kind: e.kind, origin: e.origin, badges: e.badges ?? [], missing, hidden: Boolean(e.hidden), reversed, also });
    const ns = stepsOf.get(e.id);
    if (ns) {
      meta.journey.edges.add(flow.edges.length);
      meta.journey.steps.set(flow.edges.length, ns);
    }
    const words = edgeLabel(e, tt);
    const label = ns?.length ? [ns.join(', '), words].filter(Boolean).join(' · ') : words;
    const drawn = { from: drawOf.get(e.from), to: drawOf.get(e.to), label, kind: drawKindOf(e) };
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

// ---- level 2, inside a part (flow.md fl09) ----

export const partViewMarker = (partId) => `%% session-map:view part ${partId}`;
const PER_ROW = 5;
const isPiece = (n) => n.kind === 'component' || n.kind === 'group';

// A piece used by this many others of the same part is a shared helper: its "uses" arrows are not drawn one by one
// (they made a bundle of parallel lines into it); the box says how many use it and the facts list keeps every arrow.
export const HUB_MIN = 4;

// The words a piece of a part shows: its name, and under it what it is (the first sentence of the file's own opening
// comment, else the part file's words about it; for a folder, how many files it holds). A sentence in another language
// than the page (code comments are often English) moves to the hover title (quote), and the box says instead, in the
// page language, how many pieces of the part it uses and how many use it. links: { uses, usedBy, hub }.
export function pieceWords(n, tt = english, links = {}) {
  if (n.kind === 'group') return { label: tt.count('flow.l2.group', (n.fileCount ?? 0) + (n.other ?? 0)), sub: tt('flow.l2.groupIn', { folder: n.dir ?? '' }), quote: '' };
  const usedBy = links.usedBy ? tt.count('flow.l2.usedBy', links.usedBy) : '';
  const uses = links.uses ? tt.count('flow.l2.uses', links.uses) : '';
  const hub = links.hub ? usedBy : '';
  if (n.folder) return { label: n.name ?? n.path, sub: [hub, tt.count('flow.l2.files', (n.fileCount ?? 0) + (n.other ?? 0))].filter(Boolean).join(' · '), quote: '' };
  const about = n.head || n.about || '';
  const fits = Boolean(about) && sameLang(about, tt);
  const sub = fits ? [hub, about] : [usedBy, uses];
  return { label: n.name ?? n.path ?? n.id, sub: sub.filter(Boolean).join(' · '), quote: fits ? '' : about };
}

// view: the server's view inside one part (flowinner.mjs). live: { boxId: { tone, files, unsaved } } or null (without
// the key no piece is coloured). → the same shape as level1Flow, so the page draws, colours, lists and exports it the
// same way: { flow, meta, scene, text, drawText, model }. Rows top to bottom: what comes in (people, parts, services side
// by side), where it starts, what other parts call, the work, the pieces it leans on, and what it hands on to (parts,
// this computer and the internet side by side). A band of more than perRow pieces goes on in the row under it.
export function level2Flow(view, { tt = english, live = null, perRow = PER_ROW, showHidden = false, narrow = false } = {}) {
  const hiddenIds = new Set((view.nodes ?? []).filter((n) => !isPiece(n) && n.hidden && !showHidden).map((n) => n.id));
  const nodes = (view.nodes ?? []).filter((n) => !hiddenIds.has(n.id));
  const edgesIn = (view.edges ?? []).filter((e) => !hiddenIds.has(e.from) && !hiddenIds.has(e.to) && (showHidden || !e.hidden));
  const pieces = nodes.filter(isPiece);
  const around = nodes.filter((n) => !isPiece(n));
  const pieceIds = new Set(pieces.map((n) => n.id));
  const uses = new Map();
  const usedBy = new Map();
  const bump = (m, id) => m.set(id, (m.get(id) ?? 0) + 1);
  const between = edgesIn.filter((e) => e.kind === 'import' && pieceIds.has(e.from) && pieceIds.has(e.to));
  for (const e of between) { bump(uses, e.from); bump(usedBy, e.to); }
  const hubs = new Set([...usedBy].filter(([id, n]) => n >= HUB_MIN && nodes.find((x) => x.id === id)?.kind === 'component').map(([id]) => id));
  const folded = new Set(between.filter((e) => hubs.has(e.to)).map((e) => e.id));
  const degree = new Map();
  for (const e of edgesIn) if (!folded.has(e.id)) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const busiest = (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rows = [];
  const groups = [];
  const addRow = (list) => {
    const kept = list.filter((g) => g.members.length);
    if (!kept.length) return;
    rows.push({ groups: kept.map((g) => ({ id: g.id, title: g.title, cls: g.cls, ...(g.cont ? { cont: g.cont } : {}) })) });
    groups.push(...kept);
  };
  const sideRow = (side) => {
    const of = (pred) => around.filter((n) => n.side === side && pred(n)).sort(busiest);
    const people = { id: `${side}_people`, cls: 'actors', members: of((n) => n.kind === 'actor') };
    const parts = { id: `${side}_parts`, cls: 'parts', members: of((n) => n.kind !== 'actor' && n.kind !== 'service') };
    const pc = { id: `${side}_thispc`, cls: 'thispc', members: of((n) => n.kind === 'service' && n.where === 'this-pc') };
    const net = { id: `${side}_outside`, cls: 'outside', members: of((n) => n.kind === 'service' && n.where !== 'this-pc') };
    const list = (side === 'in' ? [people, parts, pc, net] : [parts, pc, net, people]).filter((g) => g.members.length);
    list.forEach((g, i) => { g.title = i === 0 ? tt(`flow.l2.band.${side}`) : ''; });
    return list;
  };
  // On a narrow screen each group of what is around the part gets rows of its own, perRow boxes at most.
  const addSide = (side) => {
    if (!narrow) return addRow(sideRow(side));
    for (const g of sideRow(side)) {
      for (let i = 0; i < g.members.length; i += perRow) addRow([{ ...g, id: i ? `${g.id}_${i / perRow}` : g.id, title: i ? '' : g.title, cont: i ? g.id : null, members: g.members.slice(i, i + perRow) }]);
    }
    return undefined;
  };
  addSide('in');
  for (const band of ['entry', 'shared', 'work', 'base']) {
    const members = pieces.filter((n) => n.band === band).sort((a, b) => (a.kind === 'group' ? 1 : 0) - (b.kind === 'group' ? 1 : 0) || busiest(a, b));
    for (let i = 0; i < members.length; i += perRow) {
      // A band that goes on in the row under it stays one band (cont), with its title once.
      addRow([{ id: i ? `${band}_${i / perRow}` : band, title: i ? '' : tt(`flow.l2.band.${band}`), cls: 'parts', cont: i ? band : null, members: members.slice(i, i + perRow) }]);
    }
  }
  addSide('out');

  const flow = { ok: true, direction: 'TB', layers: [], nodes: [], edges: [], extra: [], warnings: [] };
  const layerDraw = new Map();
  for (const g of groups) {
    const id = newId(flow, `band ${g.id}`);
    layerDraw.set(g.id, id);
    flow.layers.push({ id, name: g.title || '·' });
  }
  const meta = { nodes: new Map(), edges: [], folded: [], hubs: hubs.size, missing: 0, more: [], layers: layerDraw, hiddenNear: hiddenIds.size };
  const drawOf = new Map();
  const named = new Map();
  const sceneNodes = [];
  for (const g of groups) {
    for (const n of g.members) {
      const piece = isPiece(n);
      const words = piece ? pieceWords(n, tt, { uses: uses.get(n.id) ?? 0, usedBy: usedBy.get(n.id) ?? 0, hub: hubs.has(n.id) }) : { label: nodeName(n, tt), sub: '', quote: '' };
      named.set(n.id, words.label);
      const id = newId(flow, piece ? `p ${n.path ?? n.id}` : n.id.replace(/^[a-z]+:/, ''));
      drawOf.set(n.id, id);
      const shape = piece ? (n.kind === 'group' ? 'group' : n.folder ? 'folder' : 'box') : shapeOf(n);
      flow.nodes.push({ id, label: words.label, layer: layerDraw.get(g.id), shape: piece ? 'box' : shape });
      sceneNodes.push({ id, label: words.label, sub: words.sub, group: g.id, shape });
      const state = piece && live ? live[n.id] ?? null : null;
      meta.nodes.set(id, {
        nodeId: n.id, kind: n.kind, where: n.where ?? null, partId: n.partId ?? null, origin: n.origin, badges: n.badges ?? [],
        evidence: [...(n.declared ?? []), ...(n.detected ?? [])], name: words.label, sub: words.sub, quote: words.quote, hub: hubs.has(n.id), hidden: Boolean(n.hidden),
        tone: piece && live ? state?.tone ?? 'quiet' : null, unsaved: state?.unsaved ?? 0, changedFiles: state?.files ?? 0,
        files: piece ? (n.fileCount ?? 0) + (n.other ?? 0) : null,
      });
    }
  }
  const sceneEdges = [];
  for (const e of edgesIn) {
    if (!drawOf.has(e.from) || !drawOf.has(e.to)) continue;
    if (folded.has(e.id)) {
      meta.folded.push({ index: null, edgeId: e.id, kind: e.kind, origin: e.origin, badges: e.badges ?? [], missing: false, hidden: false, reversed: false, also: [], names: e.names ?? [], folded: true });
      continue;
    }
    const missing = Boolean(e.label?.missing);
    if (missing) meta.missing++;
    const index = flow.edges.length;
    meta.edges.push({ index, edgeId: e.id, kind: e.kind, origin: e.origin, badges: e.badges ?? [], missing, hidden: Boolean(e.hidden), reversed: false, also: [], names: e.names ?? [], readme: Boolean(e.readme), manifest: Boolean(e.manifest) });
    const drawn = { from: drawOf.get(e.from), to: drawOf.get(e.to), label: edgeLabel(e, tt), kind: drawKindOf(e) };
    flow.edges.push(drawn);
    sceneEdges.push({ index, from: drawn.from, to: drawn.to, label: drawn.label, kind: drawn.kind, headAtStart: false });
  }
  const text = `${partViewMarker(view.partId)}\n${printFlow(flow)}`;
  const model = { nodes: nodes.map((n) => ({ ...n, name: named.get(n.id) ?? nodeName(n, tt), nameKey: isPiece(n) ? null : n.nameKey })), edges: edgesIn };
  return { flow, meta, scene: { rows, nodes: sceneNodes, edges: sceneEdges }, text, drawText: text, model };
}

// What the view inside a part left out and why, in plain words. keyed: the page has this computer's key (else the
// pieces are not coloured, and a note says so).
export function innerNotes(view, tt = english, { live = null, keyed = false, hiddenNear = 0, showHidden = false, hubs = 0 } = {}) {
  const out = [];
  const nameOfItem = (x) => said(tt, x.nameKey) || said(english, x.nameKey) || x.name || x.id;
  for (const n of view?.notes ?? []) {
    if (n.key === 'notCode') out.push(tt('flow.l2.note.notCode', { paths: n.paths.join(', ') }));
    else if (n.key === 'otherFiles') out.push(tt('flow.l2.note.otherFiles', { n: n.n, paths: n.paths.map((p) => p.split('/').pop()).join(', ') + (n.n > n.paths.length ? ', …' : '') }));
    else if (n.key === 'moreNeighbours') {
      const items = n.items.filter((x) => showHidden || !x.hidden);
      if (items.length) out.push(tt('flow.l2.note.moreNeighbours', { names: items.map(nameOfItem).join(', ') }));
    }
    else if (n.key === 'declaredOnly') out.push(tt('flow.l2.note.declaredOnly'));
  }
  const c = view?.counts ?? {};
  if (c.grouped > 0) out.push(tt('flow.l2.note.grouped', { n: c.grouped }));
  if (c.cut > 0) out.push(tt('flow.l2.note.cut', { n: c.cut }));
  if (c.arrowsCut > 0) out.push(tt.count('flow.l2.note.arrowsCut', c.arrowsCut));
  if (c.groupLinks > 0) out.push(tt('flow.l2.note.groupLinks'));
  if (hubs > 0) out.push(tt.count('flow.l2.note.hubs', hubs));
  if (hiddenNear > 0) out.push(tt.count('flow.l2.note.hiddenNear', hiddenNear));
  if (c.boxes === 0) out.push(tt('flow.l2.note.empty'));
  if (!keyed) out.push(tt('flow.l2.note.noLive'));
  return out;
}

// ---- what the Flow tab shows around the drawing (legend, journey filter, facts list, hover title) ----

// The fixed legend: the general view always lists the same items, present in the drawing or not.
const L1_KEYS = ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'actor', 'svc', 'local', 'declared', 'detected'];
export const legendKeys = (level, { journey = false } = {}) => (level === '1'
  ? (journey ? [...L1_KEYS, 'dim'] : L1_KEYS)
  : level === 'journeys'
    ? ['step', 'live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'actor', 'svc', 'local']
  : level === '2'
    ? ['live', 'changed', 'quiet', 'unsaved', 'actor', 'svc', 'local', 'declared', 'detected']
    : ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'free']);

export const legendWords = (k, tt = english) => tt(['blocks', 'waiting'].includes(k) ? `flow.flag.${k}` : ['declared', 'detected'].includes(k) ? `flow.arrow.${k}` : `flow.tone.${k}`);

// A journey's name in the page language, filled with the boxes its path took ({start}, {via}, {end}, {node}).
export function journeyName(model, j, tt = english) {
  if (!j) return '';
  if (!said(tt, j.nameKey)) return j.name || j.id;
  const nameOf = (id) => ownName(id ? (model?.nodes ?? []).find((x) => x.id === id) : null, tt);
  const args = j.args ?? {};
  return tt(j.nameKey, { start: nameOf(args.start), via: nameOf(args.via), end: nameOf(args.end), node: nameOf(args.node) });
}

// The journey filter lists what the model holds; an empty list means the filter has nothing to offer yet.
export function journeyChoices(model, tt = english) {
  return (model?.journeys ?? []).map((j) => ({ id: j.id, label: journeyName(model, j, tt) }));
}

// The steps of one journey in plain words: who to whom and what goes along. A step against the arrow (the server asks
// the page chat) says who is asked and what comes back ("asks “Page chat”, which answers with: chats and replies"):
// the arrow's words are what flows back, so "Server → Page chat · answers with: …" would read as the server answering.
// A name the README wrote stays in quotes, so it never breaks a sentence in the page language. → [{ n, from, to,
// fromId, toId, words, back, partId, edgeId }]
export function journeySteps(model, journeyId, tt = english) {
  const j = (model?.journeys ?? []).find((x) => x.id === journeyId);
  if (!j) return [];
  const nodes = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const edges = new Map((model.edges ?? []).map((e) => [e.id, e]));
  const nameOf = (id) => (nodes.get(id) ? nodeName(nodes.get(id), tt) : id);
  return (j.steps ?? []).map((st) => {
    const label = edges.get(st.edgeId) ? edgeLabel(edges.get(st.edgeId), tt) : '';
    const asked = ownName(nodes.get(st.to), tt) || st.to;
    const words = st.back ? (label ? tt('flow.j.back', { label, to: asked }) : tt('flow.j.backPlain', { to: asked })) : label;
    return { n: st.n, from: nameOf(st.from), to: nameOf(st.to), fromId: st.from, toId: st.to, words, back: Boolean(st.back), partId: st.partId ?? null, edgeId: st.edgeId };
  });
}

export const journeyViewMarker = (key) => `%% session-map:view journey ${key}`;

// One journey drawn alone (the Journeys level, fl10): its boxes top to bottom in the order they are walked, one band
// each (the box's layer is the small line under its name, so no band title sits across an arrow), and one numbered arrow per step, pointing the way the journey goes; a step against
// the real arrow says so in its words, and the facts list keeps the real arrow. Same shape as level1Flow, so the page
// draws, colours, lists and exports it the same way; null for an unknown journey.
export function journeyFlow(model, journeyId, { tt = english } = {}) {
  const j = (model?.journeys ?? []).find((x) => x.id === journeyId);
  if (!j || !j.steps?.length) return null;
  const nodes = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const edges = new Map((model.edges ?? []).map((e) => [e.id, e]));
  const layers = new Map((model.layers ?? []).map((l) => [l.id, l]));
  const steps = journeySteps(model, journeyId, tt);
  const walk = [j.steps[0].from, ...j.steps.map((st) => st.to)].filter((id) => nodes.has(id));
  const flow = { ok: true, direction: 'TB', layers: [], nodes: [], edges: [], extra: [], warnings: [] };
  const meta = { nodes: new Map(), edges: [], missing: 0, more: [], layers: new Map(), journey: { id: j.id, nodes: new Set(), edges: new Set(), steps: new Map() } };
  const drawOf = new Map();
  const rows = [];
  const sceneNodes = [];
  walk.forEach((id, i) => {
    const n = nodes.get(id);
    const layer = layers.get(n.layer);
    const title = layer ? layerName(layer, tt) : '';
    const band = newId(flow, `step ${i + 1}`);
    flow.layers.push({ id: band, name: title || '·' });
    meta.layers.set(`step:${i}`, band);
    rows.push({ groups: [{ id: band, title: '', cls: n.kind === 'actor' ? 'actors' : n.kind === 'service' ? (n.where === 'this-pc' ? 'thispc' : 'outside') : 'parts' }] });
    const draw = newId(flow, nodeName(n, english));
    drawOf.set(id, draw);
    meta.journey.nodes.add(draw);
    flow.nodes.push({ id: draw, label: nodeName(n, tt), layer: band, shape: shapeOf(n) });
    sceneNodes.push({ id: draw, label: nodeName(n, tt), sub: title, group: band, shape: shapeOf(n) });
    meta.nodes.set(draw, {
      nodeId: n.id, kind: n.kind, where: n.where ?? null, partId: n.partId ?? null, origin: n.origin, badges: n.badges ?? [],
      evidence: [...(n.declared ?? []), ...(n.detected ?? [])],
    });
  });
  const sceneEdges = [];
  for (const st of steps) {
    const e = edges.get(st.edgeId);
    if (!e || !drawOf.has(st.fromId) || !drawOf.has(st.toId)) continue;
    const missing = Boolean(e.label?.missing) && !st.back;
    if (missing) meta.missing++;
    const index = flow.edges.length;
    meta.journey.edges.add(index);
    meta.journey.steps.set(index, [st.n]);
    meta.edges.push({ index, edgeId: e.id, kind: e.kind, origin: e.origin, badges: e.badges ?? [], missing, hidden: Boolean(e.hidden), reversed: false, also: [], back: st.back, step: st.n });
    const drawn = { from: drawOf.get(st.fromId), to: drawOf.get(st.toId), label: [String(st.n), st.words].filter(Boolean).join(' · '), kind: drawKindOf(e) };
    flow.edges.push(drawn);
    sceneEdges.push({ index, from: drawn.from, to: drawn.to, label: drawn.label, kind: drawn.kind, headAtStart: false });
  }
  const text = `${journeyViewMarker(j.key ?? j.id)}\n${printFlow(flow)}`;
  return { flow, meta, scene: { rows, nodes: sceneNodes, edges: sceneEdges }, text, drawText: text, model, journey: j };
}

const evidenceText = (ev) => (ev?.line ? `${ev.file}:${ev.line}` : ev?.file ?? '');
const badgesOf = (x, tt) => (x.badges?.length ? x.badges : x.origin ? [x.origin] : []).map((b) => originWord(b, tt));
const kindWord = (info, tt) => tt(`flow.l1.kind.${info.kind === 'service' ? (info.where === 'this-pc' ? 'local' : 'service') : ['actor', 'free', 'component', 'group'].includes(info.kind) ? info.kind : 'part'}`);

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
  // The arrows into a shared helper that are not drawn one by one are still listed, saying so.
  for (const m of [...meta.edges, ...(meta.folded ?? [])]) {
    const e = edges.get(m.edgeId);
    if (!e) continue;
    const words = edgeLabel(e, tt) || tt('flow.l1.lbl.missing');
    rows.push({
      type: 'arrow', text: `${nameOf(e.from)} → ${nameOf(e.to)}`, label: m.folded ? `${words} (${tt('flow.l2.folded')})` : words, badges: badgesOf(e, tt),
      evidence: [...(e.declared ?? []), ...(e.detected ?? [])].slice(0, 3).map(evidenceText), also: (m.also ?? []).map(nameOf),
    });
  }
  return rows;
}

export const levelNote = (meta, tt = english) => (meta?.missing > 0 ? tt.count('flow.l1.unlabeled', meta.missing) : '');
