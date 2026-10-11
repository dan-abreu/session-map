// The views of the single model (block 2): the cut of one level under a focus, the Mermaid text for export, a journey as
// a sequence diagram and the tree the Map shows. Pure: they only read the model (contracts § 4, decisions 5 and 6 of
// block 2) and never touch it. The program chose every box and arrow already; here we only choose which ones to show.
import { createHash } from 'node:crypto';
import { printFlow } from '../web/flow.js';

const MAX_PER_PARENT = 12;
const FOUND_MAX = 20;
const ORIGIN_ORDER = ['DECLARED', 'EXTRACTED', 'INFERRED', 'AMBIGUOUS'];

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const crumb = (n) => ({ id: n.id, name: n.name, level: n.level });
const hashOf = (evidence) => createHash('sha256').update(evidence.map((e) => e.sha).join('\n')).digest('hex').slice(0, 16);

function evidenceList(list) {
  const seen = new Map();
  for (const e of list) if (e) seen.set(`${e.file}\n${e.line}\n${e.factId ?? ''}`, e);
  return [...seen.values()].sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || byCodeUnit(a.factId ?? '', b.factId ?? ''));
}

// What the model knows of its tree, without trusting the order of its lists.
function treeOf(model) {
  const byId = new Map((model?.nodes ?? []).map((n) => [n.id, n]));
  const up = (id) => {
    const chain = [];
    for (let n = byId.get(id), guard = 0; n && guard < 8; n = byId.get(n.parentId), guard++) chain.push(n);
    return chain;
  };
  // a box is out of the drawing when it, or any box above it, is hidden by the owner
  const hidden = new Set((model?.nodes ?? []).filter((n) => up(n.id).some((x) => x.hidden)).map((n) => n.id));
  return { byId, up, hidden };
}

const emptySlice = (level, focus, breadcrumb, model) => ({
  level, focus, breadcrumb, nodes: [], edges: [], more: {}, found: [], claims: [], stale: [], journeys: [], draft: model?.draft ?? { nodes: [], edges: [] },
});

/**
 * The cut of the model that the screen draws (§4b of block 2): only the boxes of `level` under `focus` (without a level,
 * the one below the focus), at most `max` per parent with the rest counted in `more`, the arrows between them, and the
 * arrows that leave the cut gathered on the parent of the other end (that box comes with `outside: true`). An arrow
 * that is the sum of several (a lifted one) says so with `lifted` and `members`. `search` also gives, in `found`, the
 * way to every box below the focus that matches, and keeps those boxes among the shown ones. `claims` are the approved
 * claims of the project; the ones about the cut come back, with the out-of-date ones named in `stale`.
 */
export function sliceOf(model, { level, focus = null, max = MAX_PER_PARENT, search = '', claims = [] } = {}) {
  const { byId, up, hidden } = treeOf(model);
  const focusNode = focus ? byId.get(focus) : null;
  const L = Number.isInteger(level) ? Math.min(Math.max(level, 1), 4) : focusNode ? Math.min(focusNode.level + 1, 4) : 1;
  const root = byId.get('sys');
  const path = focusNode ? up(focusNode.id).reverse() : root ? [root] : [];
  const breadcrumb = (focus && !focusNode ? [] : path).map(crumb);
  if (focus && !focusNode) return emptySlice(L, focus, [], model);
  const base = L === 1 ? null : focusNode;
  const cap = Number.isInteger(max) && max > 0 ? max : MAX_PER_PARENT;

  const live = (model?.nodes ?? []).filter((n) => !hidden.has(n.id));
  const sliceAll = new Set(live.filter((n) => n.level === L && (!base || n.parentId === base.id)).map((n) => n.id));
  const focusChain = new Set(focusNode ? up(focusNode.id).map((n) => n.id) : []);
  const liveEdges = (model?.edges ?? []).filter((e) => !e.hidden && !hidden.has(e.from) && !hidden.has(e.to) && byId.has(e.from) && byId.has(e.to));

  // how connected each box is, counting the arrows of everything below it: the ones to keep when there are too many
  const degree = new Map();
  for (const e of liveEdges) for (const end of new Set([...up(e.from), ...up(e.to)].map((n) => n.id))) degree.set(end, (degree.get(end) ?? 0) + 1);

  // the search: every live box below the focus that matches, with the way to it
  const needle = plain(search).trim();
  const found = [];
  if (needle) {
    for (const n of live) {
      if (n.id === 'sys' || (focusNode && !up(n.id).some((x) => x.id === focusNode.id)) || n.id === focus) continue;
      if (plain(n.name).includes(needle) || plain(n.id).includes(needle)) found.push(n);
    }
    found.sort((a, b) => a.level - b.level || byCodeUnit(String(a.name), String(b.name)) || byCodeUnit(a.id, b.id));
  }
  const foundNodes = found.slice(0, FOUND_MAX);
  const wanted = new Set(foundNodes.flatMap((n) => up(n.id).map((x) => x.id)).filter((id) => sliceAll.has(id)));

  const rank = (a, b) => (wanted.has(b.id) - wanted.has(a.id)) || ((b.kind === 'system') - (a.kind === 'system')) || ((degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)) || byCodeUnit(a.id, b.id);
  const groups = new Map();
  for (const n of live.filter((x) => sliceAll.has(x.id))) groups.set(n.parentId ?? '', [...(groups.get(n.parentId ?? '') ?? []), n]);
  const kept = new Set();
  const more = {};
  for (const [parent, list] of groups) {
    const ranked = [...list].sort(rank);
    for (const n of ranked.slice(0, cap)) kept.add(n.id);
    if (ranked.length > cap) more[parent || base?.id || 'sys'] = ranked.length - cap;
  }

  // which end of an arrow stands in the cut: the box itself or the one above it; otherwise its parent container
  const repOf = (id) => {
    const chain = up(id);
    const inside = chain.find((n) => sliceAll.has(n.id));
    if (inside) return { id: inside.id, inside: true };
    const node = chain[0];
    const outer = node.level >= L ? chain.find((n) => n.level === L - 1) ?? node : node;
    return { id: outer.id, inside: false };
  };
  const groupsOfEdges = new Map();
  const outsiders = new Set();
  for (const e of liveEdges) {
    const a = repOf(e.from);
    const b = repOf(e.to);
    if (a.id === b.id || (!a.inside && !b.inside)) continue;
    if ((a.inside && !kept.has(a.id)) || (b.inside && !kept.has(b.id))) continue;
    if ((!a.inside && focusChain.has(a.id)) || (!b.inside && focusChain.has(b.id))) continue;
    const key = `${a.id}->${b.id}:${e.kind}`;
    if (!groupsOfEdges.has(key)) groupsOfEdges.set(key, { id: key, from: a.id, to: b.id, kind: e.kind, members: [] });
    groupsOfEdges.get(key).members.push(e);
    if (!a.inside) outsiders.add(a.id);
    if (!b.inside) outsiders.add(b.id);
  }
  const edges = [...groupsOfEdges.values()].map((g) => {
    const [only] = g.members;
    if (g.members.length === 1 && only.from === g.from && only.to === g.to) return { ...only };
    const evidence = evidenceList(g.members.flatMap((m) => m.evidence ?? []));
    const label = g.kind === 'imports'
      ? { msg: 'edge.imports', params: { count: g.members.reduce((sum, m) => sum + (Number.isInteger(m.label?.params?.count) ? m.label.params.count : 1), 0) } }
      : g.members.length === 1 ? only.label : { msg: 'edge.group', params: { kind: g.kind, count: g.members.length } };
    const origin = ORIGIN_ORDER.find((o) => g.members.some((m) => m.origin === o)) ?? 'INFERRED';
    return { id: g.id, from: g.from, to: g.to, kind: g.kind, label, origin, evidence, hash: hashOf(evidence), lifted: true, members: g.members.map((m) => m.id).sort(byCodeUnit) };
  }).sort((a, b) => byCodeUnit(a.id, b.id));

  const nodes = [
    ...live.filter((n) => kept.has(n.id)).map((n) => ({ ...n })),
    ...[...outsiders].map((id) => ({ ...byId.get(id), outside: true })),
  ].sort((a, b) => byCodeUnit(a.id, b.id));

  // claims, journeys and out-of-date marks of what is on the screen
  const edgeIds = new Set(edges.flatMap((e) => [e.id, ...(e.members ?? [])]));
  const shown = new Set([...nodes.filter((n) => !n.outside).map((n) => n.id), ...edges.map((e) => e.id), ...edges.flatMap((e) => e.members ?? [])]);
  const factIds = new Set([...nodes.filter((n) => !n.outside), ...edges].flatMap((x) => (x.evidence ?? []).map((v) => v.factId).filter(Boolean)));
  const journeys = (model?.journeys ?? []).filter((j) => (j.steps ?? []).some((s) => edgeIds.has(s.edgeId)));
  for (const j of journeys) shown.add(j.id);
  const mine = (Array.isArray(claims) ? claims : []).filter((c) => c && (shown.has(c.about) || factIds.has(c.about)));
  const stale = (model?.stale ?? []).filter((id) => mine.some((c) => c.id === id)).sort(byCodeUnit);

  return {
    level: L,
    focus: focusNode?.id ?? null,
    breadcrumb,
    nodes,
    edges,
    more,
    found: foundNodes.map((n) => ({
      id: n.id, name: n.name, level: n.level, kind: n.kind,
      breadcrumb: up(n.id).reverse().slice(0, -1).map(crumb),
      jump: { level: n.level, focus: n.parentId ?? null },
    })),
    claims: mine,
    stale,
    journeys,
    draft: model?.draft ?? { nodes: [], edges: [] },
  };
}

// ---------- Mermaid ----------

const SHAPE_OF = { person: 'round', external: 'stadium', function: 'round' };
// the Flow tab's parser reads `|label|` and quoted names; a bar inside a label would cut it
const barless = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const textOf = (t, label) => barless((t ?? ((msg) => msg))(label?.msg ?? '', label?.params ?? {}));

/**
 * The slice as a Mermaid flowchart, only to export: the ids are numbered (`n1`...), the names are the boxes' and the
 * arrows' words come through `t(msg, params)`. What it prints is read back by `parseFlow` of the Flow tab box for box.
 */
export function mermaidOf(slice, t) {
  const nodes = slice?.nodes ?? [];
  const idOf = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const flow = {
    direction: 'LR',
    layers: [],
    nodes: nodes.map((n) => ({ id: idOf.get(n.id), label: String(n.name ?? n.id), layer: null, shape: n.id === 'ext:db' ? 'db' : SHAPE_OF[n.kind] ?? 'box' })),
    edges: (slice?.edges ?? []).filter((e) => idOf.has(e.from) && idOf.has(e.to)).map((e) => ({
      from: idOf.get(e.from), to: idOf.get(e.to), label: textOf(t, e.label) || null, kind: e.kind === 'imports' ? 'dotted' : 'arrow',
    })),
    extra: [],
  };
  return printFlow(flow);
}

// Mermaid reads `;` as the end of a line and `#` as the start of an entity: neither goes into a sequence diagram text
const seqText = (s) => String(s ?? '').replace(/;/g, ',').replace(/#/g, '').replace(/\s+/g, ' ').trim();

/** A journey as a `sequenceDiagram`: one arrow per step, numbered as the journey numbers them. null if there is no such journey. */
export function journeyMermaid(model, journeyId, t) {
  const journey = (model?.journeys ?? []).find((j) => j.id === journeyId);
  if (!journey) return null;
  const { byId } = treeOf(model);
  const edgesById = new Map((model.edges ?? []).map((e) => [e.id, e]));
  const steps = (journey.steps ?? []).map((s) => ({ s, e: edgesById.get(s.edgeId) })).filter((x) => x.e);
  const alias = new Map();
  const note = (id) => {
    if (!alias.has(id)) alias.set(id, `p${alias.size + 1}`);
    return alias.get(id);
  };
  for (const { e } of steps) { note(e.from); note(e.to); }
  const out = ['sequenceDiagram', `  %% ${seqText(journey.name)}`];
  for (const [id, p] of alias) out.push(`  participant ${p} as ${seqText(byId.get(id)?.name ?? id)}`);
  for (const { s, e } of steps) {
    out.push(`  ${alias.get(e.from)}->>${alias.get(e.to)}: ${s.n}. ${seqText(textOf(t, e.label))}`);
    if (s.note) out.push(`  Note right of ${alias.get(e.to)}: ${seqText(s.note)}`);
  }
  return out.join('\n');
}

// ---------- the Map's tree ----------

/**
 * Parts, then the components that belong to each, for the Map in the complete mode. With the architecture (`arch.parts`)
 * every part is there, even with no component (the golden rule, item 23, made visible) and carries its name; a
 * component with no part goes to `unowned`. A component shared by two parts sits under the first and names the others.
 */
export function mapTreeOf(model, arch) {
  const { byId, hidden } = treeOf(model);
  const live = (model?.nodes ?? []).filter((n) => !hidden.has(n.id));
  const functions = new Map();
  for (const n of live) if (n.level === 4 && n.parentId) functions.set(n.parentId, (functions.get(n.parentId) ?? 0) + 1);
  const row = (n) => {
    const box = byId.get(n.parentId);
    const also = (n.attrs?.parts ?? []).filter((p) => p !== n.partId);
    return {
      id: n.id, name: n.name, containerId: n.parentId, containerName: box?.name ?? null, tech: box?.tech ?? null, functions: functions.get(n.id) ?? 0,
      ...(also.length ? { alsoParts: [...also].sort(byCodeUnit) } : {}),
    };
  };
  const parts = new Map();
  for (const p of arch?.parts ?? []) parts.set(p.id, { id: p.id, ...(p.name !== undefined ? { name: p.name } : {}), components: [] });
  const unowned = [];
  for (const n of live.filter((x) => x.kind === 'component').sort((a, b) => byCodeUnit(a.id, b.id))) {
    if (!n.partId) { unowned.push(row(n)); continue; }
    if (!parts.has(n.partId)) parts.set(n.partId, { id: n.partId, components: [] });
    parts.get(n.partId).components.push(row(n));
  }
  return { parts: [...parts.values()].sort((a, b) => byCodeUnit(a.id, b.id)), unowned };
}
