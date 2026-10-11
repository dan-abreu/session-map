// The journeys of the Flow (flow.md fl10): three to six numbered end-to-end paths over the general view's arrows ("You
// open the map", "An alert reaches your phone"), each step one visible arrow of the model, tied to a part. Found with no
// AI (origin "detected"): the catalog (flowcatalog.mjs JOURNEYS) says where a journey starts, what it passes through and
// where it ends; the path between is the cheapest walk over the arrows, a step along an arrow costing 1 and a step
// against one 1.5 (at most one such step: "the server asks the chat, which answers"). People and services are only
// ever the first or the last box. The same model in any order gives the same journeys. Pure: no file is read here.
import { JOURNEYS, JOURNEY_PATH, roleOfPart, serviceById } from './flowcatalog.mjs';

export const JOURNEY_LIMITS = { min: 3, max: 6, maxSteps: 6, maxBack: 1 };
const BACK_COST = 1.5;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const inner = (n) => n && (n.kind === 'part' || n.kind === 'free');

// The visible arrows as a graph that can be walked both ways: from each box, the steps it can take.
export function journeyGraph(model) {
  const nodes = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const out = new Map([...nodes.keys()].map((id) => [id, []]));
  const edges = [...(model.edges ?? [])].filter((e) => !e.hidden && e.from !== e.to && nodes.has(e.from) && nodes.has(e.to)).sort((a, b) => cmp(a.id, b.id));
  for (const e of edges) {
    out.get(e.from).push({ to: e.to, edge: e, back: false });
    // Against an arrow only between two parts: a person or a service never "answers" a step.
    if (inner(nodes.get(e.from)) && inner(nodes.get(e.to))) out.get(e.to).push({ to: e.from, edge: e, back: true });
  }
  return { nodes, out };
}

// The cheapest path from `from` to any box of `targets`, never through `avoid`, within the steps and steps against an
// arrow left. Ties go to the boxes' ids in order, then the arrows'. → { nodes, steps: [{ from, to, edgeId, back }] } | null
export function pathBetween(graph, from, targets, { avoid = new Set(), steps = JOURNEY_LIMITS.maxSteps, backs = JOURNEY_LIMITS.maxBack } = {}) {
  if (!targets.size || steps <= 0) return null;
  const queue = [{ cost: 0, key: [from], node: from, backs: 0, path: [] }];
  const done = new Set();
  const less = (a, b) => a.cost - b.cost || cmpSeq(a.key, b.key);
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (less(queue[i], queue[best]) < 0) best = i;
    const cur = queue.splice(best, 1)[0];
    const seen = `${cur.node}\0${cur.backs}`;
    if (done.has(seen)) continue;
    done.add(seen);
    if (cur.node !== from && targets.has(cur.node)) return { nodes: cur.key.filter((_, i) => i % 2 === 0), steps: cur.path };
    if (cur.node !== from && !inner(graph.nodes.get(cur.node))) continue;
    if (cur.path.length >= steps) continue;
    for (const s of graph.out.get(cur.node) ?? []) {
      if (s.to === from || avoid.has(s.to) || cur.key.includes(s.to)) continue;
      if (!inner(graph.nodes.get(s.to)) && !targets.has(s.to)) continue;
      const nb = cur.backs + (s.back ? 1 : 0);
      if (nb > backs) continue;
      queue.push({
        cost: cur.cost + (s.back ? BACK_COST : 1), key: [...cur.key, s.edge.id, s.to], node: s.to, backs: nb,
        path: [...cur.path, { from: cur.node, to: s.to, edgeId: s.edge.id, back: s.back }],
      });
    }
  }
  return null;
}

// Two walks compared box by box (the arrows between them only when the boxes are the same).
function cmpSeq(a, b) {
  const boxes = (k) => k.filter((_, i) => i % 2 === 0);
  const [x, y] = [boxes(a), boxes(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return cmp(x[i], y[i]);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return cmp(a[i], b[i]);
  return 0;
}

// The boxes a matcher stands for, in id order.
function matching(model, m) {
  const list = [...(model.nodes ?? [])].sort((a, b) => cmp(a.id, b.id));
  if (m.id) return list.filter((n) => n.id === m.id);
  if (m.role) return list.filter((n) => inner(n) && roleOfPart({ id: String(n.id).replace(/^(part|free):/, ''), partId: n.partId, name: n.name }) === m.role);
  if (m.label) return list.filter((n) => n.kind === 'service' && serviceById(n.id)?.labelKey === `flow.l1.lbl.${m.label}`);
  return [];
}

// One catalog entry walked from one start: the path through its boxes, or null.
function walkTemplate(model, graph, t, start, limits) {
  const used = new Set([start]);
  const steps = [];
  let cur = start;
  let via = null;
  const leg = (m) => {
    const targets = new Set(matching(model, m).map((n) => n.id).filter((id) => !used.has(id)));
    return pathBetween(graph, cur, targets, { avoid: used, steps: limits.maxSteps - steps.length, backs: limits.maxBack - steps.filter((s) => s.back).length });
  };
  const take = (p) => {
    for (const s of p.steps) { steps.push(s); used.add(s.to); }
    cur = p.steps.at(-1).to;
  };
  for (const m of t.via) {
    const p = leg(m);
    if (!p) {
      if (m.optional) continue;
      return null;
    }
    take(p);
    if (!m.optional && !via) via = cur;
  }
  for (const m of t.end) {
    const p = leg(m);
    if (!p) continue;
    take(p);
    return { steps, start, end: cur, via };
  }
  return null;
}

const nameOf = (model, id) => (model.nodes ?? []).find((n) => n.id === id)?.name ?? id;
const fill = (model, text, args) => text.replace(/\{(start|end|via)\}/g, (_, k) => (args[k] ? nameOf(model, args[k]) : ''));

function journeyOf(model, { id, key, nameKey, name, walk }) {
  const nodes = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const args = { start: walk.start, end: walk.end, ...(walk.via ? { via: walk.via } : {}) };
  const partOf = (nodeId) => (nodes.get(nodeId)?.kind === 'part' ? nodes.get(nodeId).partId ?? null : null);
  const steps = walk.steps.map((s, i) => ({ n: i + 1, from: s.from, to: s.to, edgeId: s.edgeId, back: s.back, partId: partOf(s.to) ?? partOf(s.from), note: null }));
  return {
    id, key, kind: 'journey', nameKey, name: fill(model, name, args), args, origin: 'detected', ai: null, ownerConfirmed: null, badges: ['detected'],
    nodes: [walk.start, ...steps.map((s) => s.to)], edges: steps.map((s) => s.edgeId), steps,
  };
}

// From a person or a service that sends something in, forward along the arrows as far as they go (at most maxSteps):
// the farthest box by steps, then the heaviest arrows, then the ids in order. → walk | null
function farthest(graph, start, maxSteps) {
  const best = new Map([[start, { steps: [], weight: 0, key: [start] }]]);
  let layer = [start];
  for (let d = 0; d < maxSteps && layer.length; d++) {
    const next = new Map();
    for (const u of layer) {
      if (u !== start && !inner(graph.nodes.get(u))) continue;
      const bu = best.get(u);
      for (const s of graph.out.get(u) ?? []) {
        if (s.back || best.has(s.to) || bu.key.includes(s.to)) continue;
        const cand = { steps: [...bu.steps, { from: u, to: s.to, edgeId: s.edge.id, back: false }], weight: bu.weight + (s.edge.weight ?? 1), key: [...bu.key, s.edge.id, s.to] };
        const have = next.get(s.to);
        if (!have || cand.weight > have.weight || (cand.weight === have.weight && cmpSeq(cand.key, have.key) < 0)) next.set(s.to, cand);
      }
    }
    for (const [id, b] of next) best.set(id, b);
    layer = [...next.keys()].sort(cmp);
  }
  const ends = [...best.entries()].filter(([id]) => id !== start && !graph.nodes.get(id)?.id.startsWith('actor:'));
  if (!ends.length) return null;
  ends.sort(([, a], [, b]) => b.steps.length - a.steps.length || b.weight - a.weight || cmpSeq(a.key, b.key));
  const [end, b] = ends[0];
  return { steps: b.steps, start, end, via: null };
}

// model: { nodes, edges } (the general view's). → journeys in the catalog's order, then the plain "From … to …" ones.
export function detectJourneys(model, opts = {}) {
  const limits = { ...JOURNEY_LIMITS, ...opts };
  const graph = journeyGraph(model);
  const out = [];
  const seen = new Set();
  const add = (j) => {
    const sig = j.edges.join('\n');
    if (j.steps.length < 2 || seen.has(sig) || out.length >= limits.max) return;
    seen.add(sig);
    out.push(j);
  };
  for (const t of JOURNEYS) {
    let walk = null;
    for (const m of t.start) {
      for (const n of matching(model, m)) {
        walk = walkTemplate(model, graph, t, n.id, limits);
        if (walk) break;
      }
      if (walk) break;
    }
    if (walk) add(journeyOf(model, { id: `j:${t.key}`, key: t.key, nameKey: t.nameKey, name: t.name, walk }));
  }
  if (out.length < limits.min) {
    const usedBoxes = new Set(out.flatMap((j) => j.nodes));
    const starts = [...graph.nodes.values()]
      .filter((n) => !usedBoxes.has(n.id) && (n.kind === 'actor' || (n.kind === 'service' && graph.out.get(n.id).some((s) => !s.back && inner(graph.nodes.get(s.to))))))
      .map((n) => n.id).sort(cmp);
    for (const start of starts) {
      if (out.length >= limits.min) break;
      const walk = farthest(graph, start, limits.maxSteps);
      if (walk) add(journeyOf(model, { id: `j:from:${start}`, key: `from:${start}`, nameKey: JOURNEY_PATH.nameKey, name: JOURNEY_PATH.name, walk }));
    }
  }
  return out;
}
