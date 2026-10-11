// The single model behind every view of the Flow (flow.md fl07): parts, actors and outside services as nodes, labeled
// arrows between them, room for journeys (fl10) and for levels inside a part (fl09), and a hash of each node's files.
// Two sides are kept apart: what the README and the part files declare, and what session-map detects in the code, the
// chats and the branches; every fact carries both lists of evidence (file and line, never content), and the badge a page
// shows is derived from them. Deterministic, with no AI: the `ai` and `ownerConfirmed` fields exist for later and stay
// null here. The pure functions come first; the I/O at the bottom only reads the project and writes one cache file in
// session-map's own storage, never in the project.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { isSecretsFile, safeResolve } from '../files.mjs';
import { lineAt } from '../foundation/lex.mjs';
import { projectContext, resolveSpec } from '../imports.mjs';
import { kindOfFile } from '../sources/count.mjs';
import { brainDir, readJsonFile, writeAtomic } from '../store.mjs';
import { flowKey, matchParts, parseFlow } from '../web/flow.js';
import { ownersAllOf } from './attach.mjs';
import { programOnly } from './flow.mjs';
import { ACTORS, CATALOG_VERSION, actorOfApp, catalogOfLabel, linkLabelKey, serviceById, serviceOf } from './flowcatalog.mjs';
import { detectJourneys } from './flowjourneys.mjs';
import { EXTRACTORS, VERSION as SCANNER, scanFile, scanHooks, scanManifest, scanPackageJson } from './flowscan.mjs';
import { MERMAID_FENCE_RE, slug } from './parse.mjs';

export const MODEL_VERSION = 1;
export const LIMITS = { nodes: 200, edges: 600, evidence: 5, label: 60 };

const sha16 = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);

// The hash of a set of files: the same files with the same contents give the same 16 hex, in any order.
export function hashOfFiles(list) {
  const lines = list.map((f) => `${f.path}\0${f.sha}\n`).sort();
  return sha16(lines.join(''));
}

const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const ACTOR_LAYER_RE = /^(actors?|atores?|quem usa|who uses( it)?|users?|usuarios?|pessoas|people)$/;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idRe = (id) => `(?<![\\w-])${escRe(id)}(?![\\w-])`;

function blockLines(block) {
  const lines = block ? block.split('\n') : [];
  const find = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    return i < 0 ? null : i + 1;
  };
  return {
    subgraph: (id) => find(new RegExp(`^\\s*subgraph\\s+${idRe(id)}`)),
    node: (id) => find(new RegExp(`${idRe(id)}\\s*(?:\\[|\\(|\\{|>)`)),
    edge: (from, to) => find(new RegExp(`${idRe(from)}[^\\n]*?(?:--|==|-\\.)[^\\n]*?${idRe(to)}`)),
  };
}

const newFact = (extra) => ({ declared: [], detected: [], ai: null, ownerConfirmed: null, ...extra });

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const catalogLabel = (id) => (id.startsWith('actor:') ? ACTORS[id]?.labelKey : id.startsWith('svc:') ? serviceById(id)?.labelKey : null) ?? null;
const labelOf = ({ text = null, key = null, from }) => (text ? { from, text, key: null, missing: false } : key ? { from, text: null, key, missing: false } : { from: 'none', text: null, key: null, missing: true });

// The declared side: the README's layers, boxes and arrows, and the parts the map holds. readmeText (the README as it is
// in the folder) turns a place in the mermaid block into a line of the file; without it the line inside the block is kept.
export function declaredModel(archIn, { readmeText = null, labelMax = LIMITS.label } = {}) {
  const arch = programOnly(archIn);
  const readmePath = `${arch.dir ?? 'docs/architecture'}/README.md`;
  const block = arch.mermaid ?? null;
  const at = blockLines(block);
  const fence = readmeText ? MERMAID_FENCE_RE.exec(readmeText) : null;
  const fenceLine = fence ? lineAt(readmeText, fence.index) : null;
  const where = (blockLine) => {
    if (blockLine == null) return [];
    return [fenceLine != null ? { file: readmePath, line: fenceLine + blockLine, via: 'readme' } : { file: readmePath, line: null, blockLine, via: 'readme' }];
  };
  const parsed = block ? parseFlow(block) : null;
  const drawn = parsed?.ok ? parsed : null;
  const match = drawn ? matchParts(drawn, arch.parts) : new Map();
  // A box of a part the Flow leaves out (the requests registry, the operation part) is neither drawn nor free.
  const left = new Set(archIn.parts.filter((p) => !arch.parts.includes(p)).map((p) => p.id));
  const leftOut = new Set([...(drawn ? matchParts(drawn, archIn.parts) : new Map())].filter(([, id]) => left.has(id)).map(([boxId]) => boxId));

  // Layers: the README's subgraphs in its order (also those holding no part, like an "Actors" one), then the map's others.
  const layers = [];
  const layerOfReadme = new Map();
  for (const l of drawn?.layers ?? []) {
    const id = `l:${slug(l.id) || flowKey(l.name)}`;
    layerOfReadme.set(l.id, id);
    if (!layers.some((x) => x.id === id)) layers.push(newFact({ id, drawId: l.id, name: l.name, nameKey: null, declared: where(at.subgraph(l.id)) }));
  }
  for (const l of arch.layers) {
    const id = `l:${l.id}`;
    if (!layers.some((x) => x.id === id)) layers.push(newFact({ id, drawId: l.id.replace(/[^A-Za-z0-9_]/g, '_'), name: l.name, nameKey: null, declared: [] }));
  }
  const layerOfPart = new Map(arch.layers.flatMap((l) => l.partIds.map((p) => [p, `l:${l.id}`])));

  const nodes = new Map();
  const idOfDrawn = new Map();
  for (const p of arch.parts) {
    const own = drawn?.nodes.find((n) => match.get(n.id) === p.id);
    const id = `part:${p.id}`;
    nodes.set(id, newFact({
      id, kind: 'part', where: null, name: p.name, nameKey: null, layer: layerOfPart.get(p.id) ?? null, partId: p.id,
      drawId: own?.id ?? null, shape: own?.shape ?? null, level: 1, parent: null,
      declared: [{ file: p.file, line: 1, via: 'part-doc' }, ...(own ? where(at.node(own.id)) : [])],
    }));
  }
  for (const n of drawn?.nodes ?? []) {
    if (match.has(n.id)) { idOfDrawn.set(n.id, `part:${match.get(n.id)}`); continue; }
    if (leftOut.has(n.id)) continue;
    const layerName = drawn.layers.find((l) => l.id === n.layer)?.name;
    const cat = catalogOfLabel(n.label);
    const actor = n.shape === 'stadium' || ACTOR_LAYER_RE.test(plain(layerName)) || cat?.kind === 'actor';
    let kind;
    let id;
    let whereTo = null;
    if (actor) {
      kind = 'actor';
      id = cat?.kind === 'actor' ? cat.id : `actor:x-${flowKey(n.label) || n.id.toLowerCase()}`;
    } else if (cat?.kind === 'service') {
      kind = 'service';
      id = cat.id;
      whereTo = serviceById(id).where;
    } else {
      kind = 'free';
      id = `free:${flowKey(n.label) || n.id.toLowerCase()}`;
    }
    idOfDrawn.set(n.id, id);
    if (nodes.has(id)) continue;
    nodes.set(id, newFact({
      id, kind, where: whereTo, name: n.label, nameKey: null, layer: n.layer ? layerOfReadme.get(n.layer) ?? null : null, partId: null,
      drawId: n.id, shape: n.shape, level: 1, parent: null, declared: where(at.node(n.id)),
    }));
  }

  const edges = new Map();
  for (const e of drawn?.edges ?? []) {
    const from = idOfDrawn.get(e.from);
    const to = idOfDrawn.get(e.to);
    if (!from || !to || from === to) continue;
    const ends = [nodes.get(from).kind, nodes.get(to).kind];
    const kind = ends.includes('actor') ? 'actor' : ends.includes('service') ? 'service' : 'flow';
    const other = kind === 'actor' ? [from, to].find((x) => x.startsWith('actor:')) : kind === 'service' ? [from, to].find((x) => x.startsWith('svc:')) : null;
    const label = e.label ? labelOf({ from: 'readme', text: clip(e.label, labelMax) }) : labelOf({ from: 'catalog', key: other ? catalogLabel(other) : null });
    let id = `${from}>${to}#${kind}`;
    for (let n = 2; edges.has(id); n++) id = `${from}>${to}#${kind}~${n}`;
    edges.set(id, newFact({ id, from, to, kind, drawKind: e.kind, label, names: [], weight: 1, hidden: false, declared: where(at.edge(e.from, e.to)) }));
  }
  const badged = (f) => ({ ...f, origin: originOf(f), badges: badgesOf(f) });
  return { readmePath, layers: layers.map(badged), nodes: [...nodes.values()].map(badged), edges: [...edges.values()].map(badged) };
}

const evidenceOf = (file, line, via, extra = {}) => ({ file, line, via, ...extra });

function reasonEvidence(r) {
  if (r.kind === 'shared-chat' || r.kind === 'lineage') return { file: r.files?.[0] ?? null, line: null, via: 'chat', ref: r.sessionId ?? null };
  if (r.kind === 'shared-branch') return { file: null, line: null, via: 'branch', ref: r.text ?? null };
  return { file: r.file ?? null, line: null, via: 'file-ref' };
}

// The badges a fact has, and the one shown first: the owner's word, then the README, then the code, then the AI.
function badgesOf(f) {
  return [f.declared.length ? 'declared' : null, f.detected.length ? 'detected' : null, f.ai ? 'ai' : null, f.ownerConfirmed ? 'confirmed' : null].filter(Boolean);
}
function originOf(f) {
  if (f.ownerConfirmed) return 'confirmed';
  if (f.declared.length) return 'declared';
  if (f.detected.length) return 'detected';
  return f.ai ? 'ai' : 'declared';
}

const SYNTH_LAYERS = { 'l:actors': ['actors', 'flow.l1.layer.actors', 'Who uses it'], 'l:outside': ['outside', 'flow.l1.layer.outside', 'Outside services'], 'l:thispc': ['this_pc', 'flow.l1.layer.thispc', 'On this computer'] };

// The whole model from the two sides. scans: { path: { signals, imports } } (files of no interest left out by the
// caller); owners: Map(path → [partId]); resolve(from, spec) → path | null; packageJson: { path, name, bin, deps };
// hooks: { path, scripts }; plugin: { path } | null; manifests: [{ path, deps }]; hosting: [path]; shas: Map(path → sha)
// for the file hashes. trace: a Map the caller may pass to learn, for each arrow, the files behind it (level 2, fl09):
// edgeId → [{ file, other, line, via }], file being the code on the part's side (and other the file it imports, for an
// import between parts); it changes nothing in the model. Pure.
export function assembleModel({
  arch: archIn, readmeText = null, scans = {}, owners = new Map(), resolve = () => null, packageJson = null, hooks = null, plugin = null,
  manifests = [], hosting = [], shas = null, source = archIn?.source ?? 'none', projectId = null, notes = [], limits: limitsIn = {}, trace = null,
}) {
  const limits = { ...LIMITS, ...limitsIn };
  const arch = programOnly(archIn);
  const decl = declaredModel(archIn, { readmeText, labelMax: limits.label });
  const partIds = new Set(arch.parts.map((p) => p.id));
  const nodes = new Map(decl.nodes.map((n) => [n.id, { ...n, _files: new Set() }]));
  const edges = new Map(decl.edges.map((e) => [e.id, e]));
  const layers = [...decl.layers];
  const ownerOf = (file) => (owners.get(file) ?? []).filter((id) => partIds.has(id));
  const ownName = packageJson?.name ?? null;

  const ensure = (id, kind) => {
    if (nodes.has(id)) return nodes.get(id);
    const entry = kind === 'actor' ? ACTORS[id] : serviceById(id);
    const n = newFact({
      id, kind, where: kind === 'service' ? entry.where : null, name: entry.name, nameKey: entry.nameKey ?? null, layer: null, partId: null,
      drawId: null, shape: null, level: 1, parent: null, _files: new Set(),
    });
    nodes.set(id, n);
    return n;
  };
  const between = (a, b, kinds) => [...edges.values()].find((e) => kinds.includes(e.kind) && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
  // An arrow to or from an actor or service: the README's own when it drew one, else a new one with the catalog's words.
  const traced = (e, file, other, evidence) => {
    if (!trace || !file) return;
    if (!trace.has(e.id)) trace.set(e.id, []);
    trace.get(e.id).push({ file, other, line: evidence.line ?? null, via: evidence.via });
  };
  const link = (from, to, kind, evidence, file = null) => {
    const other = kind === 'actor' ? from : from.startsWith('svc:') ? from : to;
    let e = between(from, to, [kind, 'flow']);
    if (!e) {
      e = newFact({ id: `${from}>${to}#${kind}`, from, to, kind, drawKind: null, label: labelOf({ from: 'catalog', key: catalogLabel(other) }), names: [], weight: 1, hidden: false });
      edges.set(e.id, e);
    } else if (e.label.missing && catalogLabel(other)) e.label = labelOf({ from: 'catalog', key: catalogLabel(other) });
    e.detected.push(evidence);
    traced(e, file, null, evidence);
  };
  const touch = (node, file, evidence) => {
    node.detected.push(evidence);
    if (file) node._files.add(file);
  };
  const serviceFrom = (svc, file, evidence) => {
    const n = ensure(svc.id, 'service');
    touch(n, file, evidence);
    return n;
  };
  const partsOfFile = (file) => ownerOf(file).map((p) => `part:${p}`);
  const serviceEdges = (svc, file, evidence) => {
    for (const part of partsOfFile(file)) (svc.dir === 'in' ? link(svc.id, part, 'service', evidence, file) : link(part, svc.id, 'service', evidence, file));
  };
  const actorFrom = (actorId, files, evidence) => {
    const n = ensure(actorId, 'actor');
    touch(n, evidence.file, evidence);
    for (const f of files) for (const part of partsOfFile(f)) link(actorId, part, 'actor', evidence, f);
  };

  // Services and actors seen in the code, file by file in path order.
  const paths = Object.keys(scans).sort();
  for (const path of paths) {
    const own = ownerOf(path);
    const extra = own.length > 1 ? { shared: true } : {};
    const signals = scans[path].signals ?? [];
    for (const s of signals) {
      if (s.type === 'literal' && s.value === 'claude-home' && ownName && s.next === ownName) continue; // the program's own storage
      if (s.type === 'screen') {
        actorFrom(actorOfApp(s.app, s.route), [path], evidenceOf(path, s.line, 'screen', extra));
        continue;
      }
      const svc = serviceOf(s);
      if (!svc) continue;
      const evidence = evidenceOf(path, s.line, s.via ?? s.type, extra);
      serviceFrom(svc, path, evidence);
      serviceEdges(svc, path, evidence);
    }
    const listen = signals.find((s) => s.type === 'listen');
    if (listen && signals.some((s) => s.type === 'html')) actorFrom('actor:browser', [path], evidenceOf(path, listen.line, 'listen', extra));
    const all = signals.find((s) => s.type === 'bind-all');
    if (listen && all) actorFrom('actor:lan', [path], evidenceOf(path, all.line, 'literal', extra));
  }
  for (const b of packageJson?.bin ?? []) actorFrom('actor:terminal', [b.file], evidenceOf(packageJson.path, b.line, 'bin'));
  for (const h of hooks?.scripts ?? []) actorFrom('actor:claude-code', [h.file], evidenceOf(hooks.path, h.line, 'hooks'));
  if (plugin) actorFrom('actor:claude-code', hooks?.scripts?.length ? [] : [plugin.path], evidenceOf(plugin.path, 1, 'plugin'));
  // A dependency only proves the service is there; it draws an arrow (from the part holding the manifest) only when no
  // code of the project showed who calls it.
  const fromManifest = [];
  for (const m of [...manifests].sort((a, b) => a.path.localeCompare(b.path))) {
    for (const d of m.deps ?? []) {
      const svc = serviceOf({ type: 'dep', value: d.name });
      if (!svc) continue;
      const evidence = evidenceOf(m.path, d.line, 'dependency');
      serviceFrom(svc, m.path, evidence);
      fromManifest.push([svc, m.path, evidence]);
    }
  }
  for (const [svc, path, evidence] of fromManifest) {
    if (![...edges.values()].some((e) => (e.from === svc.id || e.to === svc.id) && e.detected.some((x) => x.via !== 'dependency'))) serviceEdges(svc, path, evidence);
  }
  for (const path of [...hosting].sort()) {
    const svc = serviceOf({ type: 'file', value: path });
    if (svc) serviceFrom(svc, path, evidenceOf(path, 1, 'hosting'));
  }

  // Imports between parts: the README's arrow between them when there is one, else a hidden "uses" arrow from the part
  // that provides to the part that uses.
  const pairs = new Map();
  for (const path of paths) {
    for (const imp of scans[path].imports ?? []) {
      const target = resolve(path, imp.spec);
      if (!target || target === path) continue;
      const consumers = ownerOf(path);
      for (const provider of ownerOf(target)) {
        for (const consumer of consumers) {
          if (provider === consumer || consumers.includes(provider)) continue;
          const k = `${provider}>${consumer}`;
          const pair = pairs.get(k) ?? { provider, consumer, names: new Set(), evidence: [], files: [] };
          for (const n of imp.names ?? []) pair.names.add(n);
          pair.evidence.push(evidenceOf(path, imp.line, 'import'));
          pair.files.push([path, target]);
          pairs.set(k, pair);
        }
      }
    }
  }
  for (const { provider, consumer, names, evidence, files } of [...pairs.values()].sort((a, b) => `${a.provider}>${a.consumer}`.localeCompare(`${b.provider}>${b.consumer}`))) {
    const from = `part:${provider}`;
    const to = `part:${consumer}`;
    let e = between(from, to, ['flow']) ?? between(from, to, ['uses']);
    if (!e) {
      e = newFact({ id: `${from}>${to}#uses`, from, to, kind: 'uses', drawKind: null, label: labelOf({ from: 'catalog', key: 'flow.l1.lbl.uses' }), names: [], weight: 1, hidden: true });
      edges.set(e.id, e);
    }
    e.detected.push(...evidence);
    e.names = [...new Set([...e.names, ...names])];
    files.forEach(([file, target], i) => traced(e, file, target, evidence[i]));
  }

  // Relations from chats, branches and file links: a hidden "related" line where nothing else joins the two parts.
  for (const l of archIn.links ?? []) {
    if (!partIds.has(l.a) || !partIds.has(l.b)) continue;
    const from = `part:${l.a}`;
    const to = `part:${l.b}`;
    if (between(from, to, ['flow', 'uses', 'related', 'actor', 'service'])) continue;
    const e = newFact({ id: `${from}>${to}#related`, from, to, kind: 'related', drawKind: null, label: labelOf({ from: 'relation', key: 'flow.l1.lbl.related' }), names: [], weight: 1, hidden: true });
    e.detected.push(...(l.reasons ?? []).map(reasonEvidence));
    edges.set(e.id, e);
  }

  // Words for the README arrows between parts that have none: what the two parts are (the catalog's role table), else
  // "code it shares" when the code shows one using the other, else the AI's words when it gave some. With nothing
  // known the arrow stays without words and is counted.
  for (const e of edges.values()) {
    if (!e.label.missing) continue;
    const key = linkLabelKey(nodes.get(e.from), nodes.get(e.to));
    if (key) e.label = labelOf({ from: 'role', key });
    else if (e.detected.some((x) => x.via === 'import')) e.label = labelOf({ from: 'code', key: 'flow.l1.lbl.uses' });
    else if (typeof e.ai?.label === 'string' && e.ai.label.trim()) e.label = labelOf({ from: 'ai', text: clip(e.ai.label.trim(), limits.label) });
  }

  // Layers of their own for what the README did not place.
  const taken = new Set([...layers.map((l) => l.drawId), ...[...nodes.values()].map((n) => n.drawId)].filter(Boolean).map((x) => x.toLowerCase()));
  const addLayer = (id) => {
    if (layers.some((l) => l.id === id)) return;
    const [base, nameKey, name] = SYNTH_LAYERS[id];
    let drawId = base;
    for (let n = 2; taken.has(drawId.toLowerCase()); n++) drawId = `${base}_${n}`;
    taken.add(drawId.toLowerCase());
    const layer = newFact({ id, drawId, name, nameKey });
    if (id === 'l:actors') layers.unshift(layer);
    else layers.push(layer);
  };
  for (const n of [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (n.layer) continue;
    if (n.kind === 'actor') n.layer = 'l:actors';
    else if (n.kind === 'service') n.layer = n.where === 'this-pc' ? 'l:thispc' : 'l:outside';
    else continue;
    addLayer(n.layer);
  }

  // Hashes: a part's files are the code it owns; an actor's or a service's are the files its evidence comes from.
  if (shas) {
    const owned = new Map();
    for (const [path, ids] of owners) {
      if (!shas.has(path) || !scans[path]) continue;
      for (const id of ids) owned.set(id, [...(owned.get(id) ?? []), { path, sha: shas.get(path) }]);
    }
    for (const n of nodes.values()) {
      const list = n.kind === 'part' ? owned.get(n.partId) ?? [] : [...n._files].filter((p) => shas.has(p)).map((path) => ({ path, sha: shas.get(path) }));
      n.files = list.length;
      n.filesHash = hashOfFiles(list);
    }
  } else {
    for (const n of nodes.values()) Object.assign(n, { files: 0, filesHash: null });
  }

  // Caps, counts and the badges, in a fixed order.
  const finish = (f) => {
    const out = { ...f, origin: originOf(f), badges: badgesOf(f), declaredCount: f.declared.length, detectedCount: f.detected.length, declared: f.declared.slice(0, limits.evidence), detected: f.detected.slice(0, limits.evidence) };
    delete out._files;
    return out;
  };
  const cut = { nodes: 0, edges: 0 };
  let nodeList = [...nodes.values()];
  if (nodeList.length > limits.nodes) {
    const rank = (n) => (n.kind === 'part' ? 1e9 : 0) + n.detected.length + n.declared.length * 1000;
    const keep = new Set([...nodeList].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id)).slice(0, limits.nodes).map((n) => n.id));
    cut.nodes = nodeList.length - keep.size;
    nodeList = nodeList.filter((n) => keep.has(n.id));
  }
  const kept = new Set(nodeList.map((n) => n.id));
  let edgeList = [...edges.values()].filter((e) => kept.has(e.from) && kept.has(e.to));
  for (const e of edgeList) e.weight = Math.max(1, Math.min(9, e.declared.length + e.detected.length));
  if (edgeList.length > limits.edges) {
    const rank = (e) => (e.hidden ? 0 : 100) + e.weight;
    const keep = new Set([...edgeList].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id)).slice(0, limits.edges).map((e) => e.id));
    edgeList = edgeList.filter((e) => keep.has(e.id));
  }
  cut.edges = edges.size - edgeList.length;
  const outNodes = nodeList.map(finish).sort((a, b) => a.id.localeCompare(b.id));
  const outEdges = edgeList.map(finish).sort((a, b) => a.id.localeCompare(b.id));
  const outLayers = layers.map((l) => {
    // A layer session-map added (who uses it, outside services, this computer) is its own finding, not the README's.
    return { ...l, origin: l.declared.length ? originOf(l) : 'detected', badges: badgesOf(l) };
  }).filter((l) => outNodes.some((n) => n.layer === l.id));
  return {
    version: MODEL_VERSION, scanner: SCANNER, catalog: CATALOG_VERSION, extractors: { ...EXTRACTORS }, projectId, source, generatedAt: null,
    layers: outLayers, nodes: outNodes, edges: outEdges, journeys: detectJourneys({ nodes: outNodes, edges: outEdges }),
    counts: { nodes: outNodes.length, edges: outEdges.length, unlabeled: outEdges.filter((e) => e.label.missing).length, hidden: outEdges.filter((e) => e.hidden).length, cut },
    notes: [...notes],
  };
}

// ---- I/O: the project is only read; the cache lives in session-map's storage ------------------------------------

const FILES_MAX = 20_000;
const BYTES_MAX = 512 * 1024;
const YIELD_EVERY = 64;
const CODE_TYPES = { js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', jsx: 'jsx', dart: 'dart', php: 'php' };
const MANIFESTS = new Set(['package.json', 'pubspec.yaml', 'composer.json', 'tsconfig.json', 'jsconfig.json']);
const HOSTING = new Set(['vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml']);
const run = promisify(execFile);
const pause = () => new Promise((resolve) => setImmediate(resolve));
const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

export const modelCachePath = (smDir, projectId) => join(brainDir(smDir, projectId), 'flow-model.json');
export const readModelCache = (smDir, projectId) => readJsonFile(modelCachePath(smDir, projectId), null);

const usable = (c) => (c && c.version === MODEL_VERSION && c.scanner === SCANNER && c.catalog === CATALOG_VERSION
  && JSON.stringify(c.extractors) === JSON.stringify(EXTRACTORS) && c.files && c.scans && c.nodes ? c : null);

function codeTypeOf(path) {
  const name = path.split('/').pop().toLowerCase();
  if (name.endsWith('.blade.php')) return 'blade';
  if (name.endsWith('.d.ts')) return null;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? CODE_TYPES[name.slice(dot + 1)] ?? null : null;
}

// What the Flow reads: code and screens (never a test, a fixture, a library, a generated file or a secret), and the
// few manifests that say what the program is.
function roleOf(path) {
  if (isSecretsFile(path)) return null;
  const kind = kindOfFile(path);
  if (kind === 'dep' || kind === 'generated' || kind === 'binary' || kind === 'test' || kind === 'doc') return null;
  const lower = path.toLowerCase();
  const name = lower.split('/').pop();
  if (lower === 'hooks/hooks.json') return 'hooks';
  if (lower === '.claude-plugin/plugin.json') return 'plugin';
  if (MANIFESTS.has(name)) return 'manifest';
  if (HOSTING.has(name)) return 'hosting';
  return codeTypeOf(path) ? 'code' : null;
}

async function git(root, args) {
  try {
    return (await run('git', args, { cwd: root, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true })).stdout;
  } catch {
    return null;
  }
}

// The project's files: tracked and untracked (not ignored) when it is a git folder, else a walk that skips .git and
// library and generated folders. Yields to the server as it goes.
async function listPaths(root, max) {
  const tracked = await git(root, ['-c', 'core.quotepath=off', 'ls-files', '-z']);
  if (tracked !== null) {
    const others = (await git(root, ['-c', 'core.quotepath=off', 'ls-files', '-z', '-o', '--exclude-standard'])) ?? '';
    return [...new Set([...tracked.split('\0'), ...others.split('\0')].filter(Boolean))];
  }
  const out = [];
  const stack = [''];
  let n = 0;
  while (stack.length && out.length < max * 2) {
    const rel = stack.pop();
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const kind = kindOfFile(`${path}/x`);
        if (e.name !== '.git' && kind !== 'dep' && kind !== 'generated') stack.push(path);
      } else if (e.isFile()) out.push(path);
    }
    if (++n % YIELD_EVERY === 0) await pause();
  }
  return out;
}

const parseJson = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

// tsconfig/jsconfig paths: [{ prefix, targets: [dir] }] read as data (comments and trailing commas tolerated).
function aliasesOf(path, text) {
  const json = parseJson(text) ?? parseJson(text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/[^\n]*/g, '$1').replace(/,(\s*[}\]])/g, '$1'));
  const opts = json?.compilerOptions;
  if (!opts?.paths || typeof opts.paths !== 'object') return [];
  const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
  const base = posix.join(dir, typeof opts.baseUrl === 'string' ? opts.baseUrl : '.');
  const out = [];
  for (const [pattern, targets] of Object.entries(opts.paths)) {
    if (!Array.isArray(targets)) continue;
    out.push({ prefix: pattern.replace(/\*$/, ''), star: pattern.endsWith('*'), targets: targets.filter((t) => typeof t === 'string').map((t) => posix.join(base, t)) });
  }
  return out;
}

function workspaceOf(path, workspaces) {
  let best = null;
  for (const w of workspaces) {
    if ((w.dir === '' || path.startsWith(`${w.dir}/`)) && (!best || w.dir.length > best.dir.length)) best = w;
  }
  return best;
}

// Reads the project (only reads it) and builds the model, reusing every file whose size and time did not change and
// every scan whose file content did not change. The merge is redone each time: it is pure and cheap, and import arrows
// depend on files of other parts. The cache is written only when something in it changed. root null (the demo, a
// project with no folder) gives the declared side only and writes nothing. side: an object the caller may pass to get
// what level 2 (fl09) needs and the model does not carry, kept in memory only: { ready, owners: Map(path → [partId]),
// links: Map(path → [{ target, line, names }]) (imports that reach a file the Flow read), trace (see assembleModel),
// paths (every file of the project), topLevel, entries (what the program itself runs), program, shas }.
export async function buildFlowModel({
  root, arch, smDir = null, projectId = null, source = arch?.source ?? 'worktree', readFile = readFileSync,
  now = () => new Date(), maxFiles = FILES_MAX, maxBytes = BYTES_MAX, side = null,
}) {
  const notes = source === 'main-branch' ? ['code-from-folder'] : [];
  const bare = (extraNotes) => {
    const model = assembleModel({ arch, source, projectId, notes: extraNotes });
    return { ...model, generatedAt: now().toISOString(), stamp: sha16(JSON.stringify(model)), stats: { files: 0, scanned: 0, reused: 0, recomputed: [], wrote: false } };
  };
  if (!root) return bare(notes);
  let isDir = false;
  try { isDir = statSync(root).isDirectory(); } catch { /* gone */ }
  if (!isDir) return bare(['no-folder']);

  let readmeText = null;
  if (source === 'worktree' && arch.dir) {
    const abs = safeResolve(root, `${arch.dir}/README.md`);
    try { readmeText = abs ? readFile(abs, 'utf8') : null; } catch { readmeText = null; }
  }
  const cache = smDir && projectId ? usable(readModelCache(smDir, projectId)) : null;
  const all = await listPaths(root, maxFiles);
  const fileSet = new Set(all);
  let wanted = all.map((path) => ({ path, role: roleOf(path) })).filter((x) => x.role).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (wanted.length > maxFiles) {
    notes.push('too-many-files');
    wanted = [...wanted.filter((x) => x.role !== 'code'), ...wanted.filter((x) => x.role === 'code')].slice(0, maxFiles);
  }

  const rows = {};
  const scans = {};
  let scanned = 0;
  let reused = 0;
  let seen = 0;
  // read(path, scanText, stamp): the scan of a file, from the cache when its bytes, time, content and context are the same.
  const read = async (path, scanText, stamp) => {
    if (++seen % YIELD_EVERY === 0) await pause();
    const abs = join(root, path);
    let st;
    try { st = lstatSync(abs); } catch { return; }
    if (!st.isFile() || st.size > maxBytes) return;
    const prevRow = cache?.files[path];
    const prevScan = cache?.scans[path];
    if (prevRow && prevScan && prevRow.bytes === st.size && prevRow.mtime === st.mtimeMs && prevScan.sha === prevRow.sha && prevScan.stamp === stamp) {
      rows[path] = prevRow;
      scans[path] = prevScan;
      reused++;
      return;
    }
    let buf;
    try { buf = readFile(abs); } catch { return; }
    if (looksBinary(buf)) return;
    const sha = sha16(buf);
    rows[path] = { bytes: st.size, mtime: st.mtimeMs, sha };
    if (prevScan && prevScan.sha === sha && prevScan.stamp === stamp) {
      scans[path] = prevScan;
      reused++;
      return;
    }
    scans[path] = { sha, stamp, ...scanText(buf.toString('utf8')) };
    scanned++;
  };

  // First the manifests: they say which workspace (package) each code file is in, and what the program is.
  for (const { path, role } of wanted.filter((x) => x.role !== 'code')) {
    await read(path, (text) => {
      if (role === 'hooks') return { hooks: scanHooks(text) };
      if (role === 'plugin') return { plugin: true };
      if (role === 'hosting') return { hosting: true };
      const name = path.split('/').pop().toLowerCase();
      if (name === 'tsconfig.json' || name === 'jsconfig.json') return { aliases: aliasesOf(path, text) };
      return { manifest: name === 'package.json' ? scanPackageJson(text) : scanManifest(path, text) };
    }, '');
  }
  const workspaces = Object.entries(scans).filter(([, s]) => s.manifest && s.manifest.deps).map(([path, s]) => {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
    return { dir, name: dir ? dir.split('/').pop() : s.manifest.name ?? '', deps: path.endsWith('package.json') ? s.manifest.deps.map((d) => d.name) : undefined, sha: s.sha };
  });
  const rootPkg = scans['package.json']?.manifest ?? null;
  const hooksScan = scans['hooks/hooks.json']?.hooks ?? [];
  // Dev tooling under scripts/ is left out, except what the program itself runs (its bin and its hooks).
  const entries = new Set([...(rootPkg?.bin ?? []).map((b) => b.file), ...hooksScan.map((h) => h.file)]);
  const code = wanted.filter((x) => x.role === 'code' && (x.path.split('/')[0].toLowerCase() !== 'scripts' || entries.has(x.path)));
  const allPaths = [...fileSet];
  for (const { path } of code) {
    const ws = workspaceOf(path, workspaces);
    const workspace = ws ? { dir: ws.dir, name: ws.name, ...(ws.deps ? { deps: ws.deps } : {}) } : undefined;
    await read(path, (text) => scanFile({ path, type: codeTypeOf(path), text, workspace, files: allPaths }), ws ? `${ws.dir}:${ws.sha}` : '');
  }

  // Ownership: every part holding a file's deepest path (a shared folder belongs to all its parts).
  const program = programOnly(arch);
  const owned = Object.keys(scans);
  const topLevel = new Set(all.map((p) => p.split('/')[0].toLowerCase()));
  const extraPaths = [...entries, '.claude-plugin/plugin.json'];
  const ownerPaths = [...new Set([...owned, ...extraPaths])];
  const ownerLists = ownersAllOf(ownerPaths, program, { topLevel });
  const owners = new Map(ownerPaths.map((p, i) => [p, ownerLists[i]]));

  const ctx = projectContext(root, fileSet);
  const aliases = Object.values(scans).flatMap((s) => s.aliases ?? []).sort((a, b) => b.prefix.length - a.prefix.length);
  const resolve = (from, spec) => {
    const direct = resolveSpec(from, spec, fileSet, ctx);
    if (direct) return direct;
    for (const a of aliases) {
      if (a.star ? !spec.startsWith(a.prefix) : spec !== a.prefix) continue;
      for (const t of a.targets) {
        const target = posix.normalize(a.star ? t.replace(/\*$/, '') + spec.slice(a.prefix.length) : t);
        const hit = resolveSpec('index.ts', `./${target}`, fileSet);
        if (hit) return hit;
      }
    }
    return null;
  };
  const codeScans = Object.fromEntries(code.filter((x) => scans[x.path]).map((x) => [x.path, scans[x.path]]));
  const manifests = Object.entries(scans).filter(([, s]) => s.manifest?.deps).map(([path, s]) => ({ path, deps: s.manifest.deps }));
  const shas = new Map(Object.entries(rows).map(([p, r]) => [p, r.sha]));
  const trace = side ? new Map() : null;
  const model = assembleModel({
    arch, readmeText, scans: codeScans, owners, resolve, source, projectId, notes, shas, manifests, trace,
    packageJson: rootPkg ? { path: 'package.json', ...rootPkg } : null,
    hooks: hooksScan.length ? { path: 'hooks/hooks.json', scripts: hooksScan } : null,
    plugin: scans['.claude-plugin/plugin.json'] ? { path: '.claude-plugin/plugin.json' } : null,
    hosting: Object.entries(scans).filter(([, s]) => s.hosting).map(([p]) => p),
  });

  if (side) {
    const links = new Map();
    for (const [path, scan] of Object.entries(codeScans)) {
      const out = [];
      for (const imp of scan.imports ?? []) {
        const target = resolve(path, imp.spec);
        if (target && target !== path && codeScans[target]) out.push({ target, line: imp.line ?? null, names: [...(imp.names ?? [])] });
      }
      if (out.length) links.set(path, out);
    }
    Object.assign(side, { ready: true, owners, links, trace, paths: all, topLevel, entries, program, shas, scanned: Object.keys(codeScans) });
  }
  const recomputed = model.nodes.filter((n) => cache?.nodes[n.id]?.filesHash !== n.filesHash).map((n) => n.id).sort();
  const nodeHashes = Object.fromEntries(model.nodes.map((n) => [n.id, { filesHash: n.filesHash }]));
  const digest = sha16(JSON.stringify({ rows, scans, model }));
  // What a page compares to know the drawing changed: the model alone, not the times of the files.
  const stamp = sha16(JSON.stringify(model));
  let wrote = false;
  let generatedAt = now().toISOString();
  if (cache?.digest === digest) generatedAt = cache.model?.generatedAt ?? generatedAt;
  else if (smDir && projectId) {
    writeAtomic(modelCachePath(smDir, projectId), JSON.stringify({
      version: MODEL_VERSION, scanner: SCANNER, catalog: CATALOG_VERSION, extractors: EXTRACTORS, digest,
      files: rows, scans, nodes: nodeHashes, model: { ...model, generatedAt, stamp },
    }));
    wrote = true;
  }
  return { ...model, generatedAt, stamp, stats: { files: wanted.length, scanned, reused, recomputed, wrote } };
}
