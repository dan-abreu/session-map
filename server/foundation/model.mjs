// The single model of a project (fd03, contracts § 4): system, people, externals, containers, components and (level 4,
// for the zoom) functions, with the arrows between them, the journeys over those arrows and the owner's drawing. Pure: it
// is recalculated from the readers' facts, the census and the architecture, never edited (decision 1 of block 2). The
// program builds every node and arrow; the AI only adds claims.
import { createHash } from 'node:crypto';
import { ownersOf } from '../arch/attach.mjs';

const SOURCE_TYPES = new Set(['ts', 'tsx', 'js', 'jsx', 'dart', 'php', 'blade', 'prisma']);
const SOURCE_KINDS = new Set(['code', 'screen']);
const MANIFESTS = new Set(['package.json', 'pubspec.yaml', 'composer.json']);
// decision 6: the code root of a container, taken off once before the folder that names the component
const CODE_ROOTS = new Set(['src', 'lib', 'app', 'routes']);
const ORIGIN_ORDER = ['DECLARED', 'EXTRACTED', 'INFERRED', 'AMBIGUOUS'];

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const ctrId = (dir) => (dir ? `ctr:${dir}` : 'ctr:.');
const edgeId = (from, to, kind) => `${from}->${to}:${kind}`;
// An arrow resting on several facts is as sure as its surest fact: one certain import is enough for the arrow to exist.
const strongest = (origins) => ORIGIN_ORDER.find((o) => origins.includes(o)) ?? 'INFERRED';
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function evidenceList(list) {
  const seen = new Map();
  for (const e of list) if (e) seen.set(`${e.file}\n${e.line}\n${e.factId ?? ''}`, e);
  return [...seen.values()].sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || byCodeUnit(a.factId ?? '', b.factId ?? ''));
}
const hashOf = (evidence) => createHash('sha256').update(evidence.map((e) => e.sha).join('\n')).digest('hex').slice(0, 16);

// Route paths compared segment by segment; a parameter (:id, [id], {order}, ${x}, *) matches any one segment.
const isParam = (seg) => /^[:{[$*]/.test(seg);
const segmentsOf = (path) => String(path).split(/[?#]/)[0].replace(/\/+$/, '').split('/').filter(Boolean);
function samePath(a, b) {
  const x = segmentsOf(a);
  const y = segmentsOf(b);
  return x.length === y.length && x.every((s, i) => s === y[i] || isParam(s) || isParam(y[i]));
}
const sameMethod = (call, route) => !call || !route || call === route || route === 'ANY' || call === 'ANY';

// opts: { name: the project's name for the system box, linesOf(path) -> lines | null (to point at a real line of a
// manifest, a component or a part's .md; without it, line 1), topLevel: top folders of the repository for ownersOf,
// now: Date, level4: also the functions and the calls (the zoom; off, the model is levels 1 to 3), journeys: the
// journeys to keep when all their steps exist, claims: the approved claims, whose out-of-date ids go to `stale` }.
// overrides: the owner's drawing (model-overrides.json), laid over by applyOverrides.
export function buildModel(facts, census, arch, overrides = {}, opts = {}) {
  const rows = new Map();
  for (const f of census?.files ?? []) if (f.included && f.sha && typeof f.path === 'string') rows.set(f.path, f);
  const paths = [...rows.keys()].sort(byCodeUnit);
  const linesOf = (path) => {
    if (!opts.linesOf || !rows.has(path)) return null;
    try { return opts.linesOf(path) ?? null; } catch { return null; }
  };

  // ---------- evidence: only a file of the census, a line it has and its sha of now ----------
  const at = (file, line, factId, expectSha) => {
    const row = rows.get(file);
    if (!row || !Number.isInteger(line) || line < 1 || line > (row.lines?.total ?? 0)) return null;
    if (expectSha !== undefined && expectSha !== row.sha) return null;
    return { file, line, sha: row.sha, ...(factId ? { factId } : {}) };
  };
  const firstLine = (path, test = (l) => l.trim() !== '') => {
    const i = (linesOf(path) ?? []).findIndex(test);
    return i >= 0 ? i + 1 : 1;
  };

  // ---------- owners, containers and components ----------
  const sources = paths.filter((p) => SOURCE_TYPES.has(rows.get(p).type) && SOURCE_KINDS.has(rows.get(p).kind));
  const sourceSet = new Set(sources);
  let ownerOf = (p) => rows.get(p).owner ?? null;
  if (Array.isArray(arch?.parts)) {
    const topLevel = opts.topLevel ?? new Set((census?.files ?? []).map((f) => String(f.path).split('/')[0].toLowerCase()));
    const owners = ownersOf(paths, arch, { topLevel });
    const map = new Map(paths.map((p, i) => [p, owners[i] ?? null]));
    ownerOf = (p) => map.get(p) ?? null;
  }

  const manifests = paths.filter((p) => MANIFESTS.has(baseOf(p)) && SOURCE_KINDS.has(rows.get(p).kind));
  const below = [...new Set(manifests.map(dirOf).filter(Boolean))].sort((a, b) => b.length - a.length || byCodeUnit(a, b));
  const inBelow = (path) => below.find((d) => path.startsWith(`${d}/`)) ?? null;
  // The root is a container when some code lies outside every package below it (or there is no package at all).
  const withRoot = sources.some((p) => inBelow(p) === null);
  const containerOf = (path) => inBelow(path) ?? (withRoot ? '' : null);

  const sorted = [...(facts?.facts ?? [])].sort((a, b) => byCodeUnit(String(a.file), String(b.file)) || a.line - b.line || byCodeUnit(String(a.id), String(b.id)));
  // The places of a fact the model may stand on: in a source file (tests and docs are not the running code), resolvable,
  // and read from the version of the file the census has now (no sha known for the place = no proof of that).
  const placeEv = (f, p) => {
    if (!sourceSet.has(p.file)) return null;
    const expectSha = p.file === f.file ? f.sha : facts?.files?.[p.file]?.sha;
    return expectSha ? at(p.file, p.line, f.id, expectSha) : null;
  };
  const placesOf = (f) => [{ file: f.file, line: f.line }, ...(f.refs ?? [])].map((p) => ({ ...p, ev: placeEv(f, p) })).filter((p) => p.ev);
  const defOf = (f) => placeEv(f, { file: f.file, line: f.line });
  const ofKind = (kind) => sorted.filter((f) => f.kind === kind && placesOf(f).length);

  const nodes = new Map();
  const edges = new Map();
  // two apps with the same folder name give the same person: one node with the evidence of both
  const addNode = (node, evidence) => {
    const ev = evidenceList([...(nodes.get(node.id)?.evidence ?? []), ...evidence]);
    if (!ev.length) return;
    nodes.set(node.id, { ...(nodes.get(node.id) ?? node), evidence: ev, hash: hashOf(ev) });
  };
  // edges gather facts first and are made at the end, once both ends are known
  const pending = new Map();
  const touch = (from, to, kind, init) => {
    const id = edgeId(from, to, kind);
    if (!pending.has(id)) pending.set(id, { id, from, to, kind, origins: [], evidence: [], ...init() });
    return pending.get(id);
  };

  const containerDirs = [...new Set(sources.map(containerOf).filter((d) => d !== null))];
  const firstOf = (dir, kind, pick) => {
    const f = sorted.find((x) => x.kind === kind && sourceSet.has(x.file) && containerOf(x.file) === dir);
    return f ? pick(f.attrs ?? {}) ?? null : null;
  };
  const ownManifests = new Map(below.map((d) => [d, []]));
  if (withRoot) ownManifests.set('', []);
  for (const m of manifests) ownManifests.get(dirOf(m))?.push(m);

  for (const dir of containerDirs) {
    const own = ownManifests.get(dir) ?? [];
    const evidence = own.map((m) => at(m, firstLine(m, (l) => /^\s*"?name"?\s*:/.test(l)), null));
    // a root with no manifest stands on its first file of code
    if (!own.length) {
      const first = sources.find((p) => containerOf(p) === dir);
      if (first) evidence.push(at(first, firstLine(first), null));
    }
    const tech = firstOf(dir, 'route', (a) => a.framework) ?? firstOf(dir, 'screen', (a) => a.framework)
      ?? firstOf(dir, 'queue', (a) => a.lib) ?? firstOf(dir, 'table', (a) => a.source) ?? null;
    addNode({
      id: ctrId(dir), level: 2, kind: 'container', name: dir ? baseOf(dir) : (opts.name ?? 'app'), parentId: 'sys', tech,
      files: [dir ? `${dir}/` : './'], origin: own.length ? 'EXTRACTED' : 'INFERRED',
    }, evidence);
  }

  const componentOf = new Map();
  const members = new Map();
  for (const p of sources) {
    const dir = containerOf(p);
    if (dir === null) continue;
    const segs = (dir ? p.slice(dir.length + 1) : p).split('/');
    let base = '';
    if (segs.length > 1 && CODE_ROOTS.has(segs[0])) base = `${segs.shift()}/`;
    const id = segs.length === 1 ? `cmp:${dir || '.'}#root` : `cmp:${dir ? `${dir}/` : ''}${base}${segs[0]}`;
    componentOf.set(p, id);
    if (!members.has(id)) members.set(id, { dir, name: segs.length === 1 ? '(root)' : segs[0], files: [] });
    members.get(id).files.push(p);
  }
  for (const [id, { dir, name, files }] of members) {
    const lines = new Map();
    for (const p of files) {
      const owner = ownerOf(p);
      if (owner) lines.set(owner, (lines.get(owner) ?? 0) + (rows.get(p).lines?.total ?? 0));
    }
    const ranked = [...lines].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).map(([part]) => part);
    const node = { id, level: 3, kind: 'component', name, parentId: ctrId(dir), partId: ranked[0] ?? null, origin: ranked.length > 1 ? 'AMBIGUOUS' : 'INFERRED' };
    if (ranked.length > 1) node.attrs = { parts: [...ranked].sort(byCodeUnit) };
    addNode(node, files.map((p) => at(p, firstLine(p), null)));
  }

  // ---------- people: whoever opens an app with screens (a Blade view is the server's, not an app) ----------
  for (const dir of containerDirs) {
    const screens = ofKind('screen').filter((f) => f.attrs?.framework !== 'blade' && sourceSet.has(f.file) && containerOf(f.file) === dir);
    if (!screens.length) continue;
    const folder = dir ? baseOf(dir) : (opts.name ?? 'app');
    const evidence = screens.map(defOf);
    addNode({ id: `person:${folder}`, level: 1, kind: 'person', name: capitalize(folder), parentId: null, origin: 'INFERRED' }, evidence);
    const e = touch(`person:${folder}`, ctrId(dir), 'uses', () => ({ params: { via: 'screens', count: 0 } }));
    e.params.count += screens.length;
    e.origins.push('INFERRED');
    e.evidence.push(...evidence);
  }

  // ---------- http: a call of the project that names a route of another container (decision 4) ----------
  // Only a URL with no host is surely the project's own: a host outside it with the same path is another system.
  const ownCall = (f) => f.attrs?.via === 'url' && !f.attrs?.host && !f.attrs?.package;
  const routes = ofKind('route');
  for (const call of ofKind('integration').filter((f) => ownCall(f) && typeof f.attrs?.path === 'string')) {
    for (const place of placesOf(call)) {
      const from = containerOf(place.file);
      if (from === null) continue;
      const others = routes.filter((r) => containerOf(r.file) !== from && sameMethod(call.attrs.method, r.attrs?.method));
      for (const to of [...new Set(others.map((r) => containerOf(r.file)))].sort(byCodeUnit)) {
        const there = others.filter((r) => containerOf(r.file) === to);
        const hits = there.filter((r) => typeof r.attrs?.path === 'string' && samePath(call.attrs.path, r.attrs.path));
        if (!hits.length) continue;
        const dynamic = there.filter((r) => r.attrs?.path === null || r.attrs?.path === undefined);
        const e = touch(ctrId(from), ctrId(to), 'http', () => ({ names: new Set(), ambiguous: false }));
        for (const r of hits) e.names.add(r.name);
        e.ambiguous ||= hits.length > 1 || dynamic.length > 0 || hits.some((r) => r.origin === 'AMBIGUOUS');
        e.origins.push('INFERRED');
        e.evidence.push(place.ev, ...[...hits, ...dynamic].map(defOf));
      }
    }
  }

  // ---------- externals: integrations, queues, the database ----------
  // the database and the queues keep their ids: an integration named like them gets a box of its own
  const extIdOf = (name) => (name === 'db' || name.startsWith('queue:') ? `ext:integration:${name}` : `ext:${name}`);
  for (const f of ofKind('integration')) {
    if (ownCall(f)) continue;
    const name = f.attrs?.package ?? f.attrs?.host ?? f.name;
    const extId = extIdOf(name);
    const places = placesOf(f);
    addNode({ id: extId, level: 1, kind: 'external', name, parentId: null, origin: strongest([f.origin]) }, places.map((p) => p.ev));
    for (const p of places) {
      const dir = containerOf(p.file);
      if (dir === null) continue;
      const e = touch(ctrId(dir), extId, 'uses', () => ({ params: { via: f.attrs?.via ?? 'sdk', name } }));
      e.origins.push(f.origin);
      e.evidence.push(p.ev);
    }
  }

  const queueEdge = (dir, queue, kind, origin, ev) => {
    if (dir === null || !ev) return;
    const e = touch(ctrId(dir), `ext:queue:${queue}`, kind, () => ({ params: { queue } }));
    e.origins.push(origin);
    e.evidence.push(ev);
  };
  // a queue whose name is not written (attrs.name null, id "queue:?expr") is not a known queue: no box for a variable
  for (const q of ofKind('queue')) {
    const name = q.id.slice('queue:'.length);
    if (q.attrs?.name === null || name.startsWith('?')) continue;
    const def = defOf(q);
    addNode({ id: `ext:queue:${name}`, level: 1, kind: 'external', name, parentId: null, origin: strongest([q.origin]) }, def ? [def] : placesOf(q).map((p) => p.ev));
    // the other places of a queue are the workers that take from it
    for (const p of placesOf(q)) if (p.file !== q.file || p.line !== q.line) queueEdge(containerOf(p.file), name, 'consumes', q.origin, p.ev);
  }
  for (const j of ofKind('job')) {
    const queue = j.attrs?.queue;
    if (!queue) continue;
    const def = defOf(j);
    const role = j.attrs?.role;
    if (def) queueEdge(containerOf(j.file), queue, role === 'consumer' ? 'consumes' : 'enqueues', j.origin, def);
    // the other places of a job are where it is dispatched
    for (const p of placesOf(j)) if (p.file !== j.file || p.line !== j.line) queueEdge(containerOf(p.file), queue, 'enqueues', j.origin, p.ev);
  }

  const tables = ofKind('table');
  if (tables.length) {
    addNode({ id: 'ext:db', level: 1, kind: 'external', name: 'database', parentId: null, origin: 'INFERRED' }, tables.map(defOf));
    for (const t of tables) {
      const dir = containerOf(t.file);
      if (dir === null) continue;
      const e = touch(ctrId(dir), 'ext:db', 'uses', () => ({ params: { via: 'db' } }));
      e.origins.push('INFERRED');
      e.evidence.push(defOf(t));
    }
  }

  // ---------- imports: between components, or between containers when they cross one ----------
  for (const f of ofKind('import')) {
    const target = f.id.slice(f.id.indexOf('->') + 2);
    const from = componentOf.get(f.file);
    const to = componentOf.get(target);
    if (!from || !to || from === to) continue;
    const [a, b] = containerOf(f.file) === containerOf(target) ? [from, to] : [ctrId(containerOf(f.file)), ctrId(containerOf(target))];
    const e = touch(a, b, 'imports', () => ({ params: { count: 0 } }));
    e.params.count += 1;
    e.origins.push(f.origin);
    e.evidence.push(defOf(f));
  }

  // ---------- level 4, only for the zoom: functions under the component of their file, the calls with one target ----------
  if (opts.level4) {
    // tested (INFERRED by the program): a test file, read at its sha of now, imports the function's file
    const testedBy = new Map();
    for (const f of sorted) {
      if (f.kind !== 'import' || rows.get(f.file)?.kind !== 'test' || !f.sha) continue;
      const ev = at(f.file, f.line, null, f.sha);
      const target = f.id.slice(f.id.indexOf('->') + 2);
      if (!ev) continue;
      if (!testedBy.has(target)) testedBy.set(target, []);
      testedBy.get(target).push({ file: ev.file, line: ev.line });
    }
    // a call with more than one candidate is not drawn: it stays on its caller, for the screen to say "one of these"
    const ambiguousCalls = new Map();
    const sureCalls = [];
    for (const c of ofKind('call')) {
      const m = /^call:(fn:.+?)->(fn:.+|\?.*)$/.exec(c.id);
      if (!m) continue;
      if (c.origin === 'AMBIGUOUS' || m[2].startsWith('?')) {
        const def = defOf(c);
        if (!def) continue;
        if (!ambiguousCalls.has(m[1])) ambiguousCalls.set(m[1], []);
        ambiguousCalls.get(m[1]).push({ callee: c.attrs?.callee ?? null, line: def.line, candidates: [...(c.attrs?.candidates ?? [])].sort(byCodeUnit) });
      } else sureCalls.push({ c, from: m[1], to: m[2] });
    }
    for (const f of ofKind('function')) {
      const parentId = componentOf.get(f.file);
      // a function nested in another (fd17) is for the skeleton of a file, not a node of the map
      if (!parentId || f.attrs?.parent) continue;
      const prefix = `fn:${f.file}#`;
      const a = f.attrs ?? {};
      const attrs = {};
      for (const k of ['exported', 'async', 'params', 'endLine']) if (a[k] !== undefined) attrs[k] = a[k];
      const tests = [...new Map((testedBy.get(f.file) ?? []).map((t) => [`${t.file}\n${t.line}`, t])).values()]
        .sort((x, y) => byCodeUnit(x.file, y.file) || x.line - y.line);
      attrs.tested = tests.length > 0;
      if (tests.length) attrs.testedBy = tests;
      const calls = ambiguousCalls.get(f.id);
      if (calls) attrs.ambiguousCalls = calls.sort((x, y) => x.line - y.line || byCodeUnit(String(x.callee), String(y.callee)));
      addNode({
        id: f.id, level: 4, kind: 'function', name: f.id.startsWith(prefix) ? f.id.slice(prefix.length) : f.name,
        parentId, origin: f.origin ?? 'EXTRACTED', attrs,
      }, placesOf(f).map((p) => p.ev));
    }
    for (const { c, from, to } of sureCalls) {
      const e = touch(from, to, 'calls', () => ({ params: { callee: c.attrs?.callee ?? null } }));
      e.origins.push(c.origin);
      e.evidence.push(...placesOf(c).map((p) => p.ev));
    }
  }

  for (const e of pending.values()) {
    if (e.from === e.to || !nodes.has(e.from) || !nodes.has(e.to)) continue;
    const evidence = evidenceList(e.evidence);
    if (!evidence.length) continue;
    let params = e.params;
    let origin = strongest(e.origins);
    if (e.kind === 'http') {
      const names = [...e.names].sort(byCodeUnit);
      params = { what: names[0], ...(names.length > 1 ? { count: names.length } : {}), ...(e.ambiguous ? { ambiguous: true } : {}) };
      if (e.ambiguous) origin = 'AMBIGUOUS';
    }
    edges.set(e.id, { id: e.id, from: e.from, to: e.to, kind: e.kind, label: { msg: `edge.${e.kind}`, params }, origin, evidence, hash: hashOf(evidence) });
  }

  nodes.set('sys', { id: 'sys', level: 1, kind: 'system', name: opts.name ?? 'project', parentId: null });
  const built = {
    version: 1,
    generatedAt: opts.now ? new Date(opts.now).toISOString() : (facts?.generatedAt ?? null),
    factsRev: facts?.censusRev ?? null,
    nodes: [...nodes.values()].sort((a, b) => byCodeUnit(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => byCodeUnit(a.id, b.id)),
    journeys: [],
    draft: { nodes: [], edges: [] },
    stale: [],
  };
  // the owner's drawing, then the journeys (on the edges that exist), then the claims whose evidence moved
  const model = applyOverrides(built, overrides, arch, { census, linesOf });
  if (opts.journeys) model.journeys = validateJourneys(model, opts.journeys).journeys;
  if (opts.claims) model.stale = markStale(model, opts.claims, { census, facts });
  return model;
}

// ---------- the owner's drawing (model-overrides.json) ----------

const NAME_MAX = 120;
const NOTE_MAX = 500;
const DRAWN_KINDS = new Set(['part', 'person', 'db', 'external', 'note']);
const DRAWN_ID = /^dn:[a-z0-9][a-z0-9-]*$/;
const nameOk = (s) => typeof s === 'string' && s.trim() !== '' && s.length <= NAME_MAX;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The owner's drawing over a model, without touching the model it gets (decision 3 of block 2). A new name or layer is
 * DECLARED on a component whose part is written in the architecture's .md (evidence: the title line of that .md, so the
 * node keeps standing on a real file); anything else the owner drew (a new box, a new arrow, a name for a node with no
 * part, a layer the README does not have) waits in `draft` until it is written to the .md. `hidden` leaves the drawing,
 * not the model. `{ census, linesOf }` give the sha and the lines of the .md.
 */
export function applyOverrides(model, overrides, arch, { census, linesOf } = {}) {
  const o = isPlain(overrides) ? overrides : {};
  const nodes = new Map((model?.nodes ?? []).map((n) => [n.id, n]));
  const edges = new Map((model?.edges ?? []).map((e) => [e.id, e]));
  const parts = new Map((arch?.parts ?? []).map((p) => [p.id, p]));
  const layers = new Set((arch?.layers ?? []).map((l) => l.id));
  const rows = new Map((census?.files ?? []).filter((f) => f.included && f.sha).map((f) => [f.path, f]));
  const draftNodes = new Map();
  const draftEdges = new Map();

  const mdEvidence = (part) => {
    const row = rows.get(part?.file);
    if (!row) return null;
    let lines = null;
    try { lines = linesOf?.(part.file) ?? null; } catch { lines = null; }
    const i = Array.isArray(lines) ? lines.findIndex((l) => /^#\s/.test(l)) : -1;
    const line = i >= 0 ? i + 1 : 1;
    return line <= (row.lines?.total ?? 0) ? { file: part.file, line, sha: row.sha } : null;
  };

  for (const id of Object.keys(isPlain(o.nodes) ? o.nodes : {}).sort(byCodeUnit)) {
    const ov = o.nodes[id];
    const node = nodes.get(id);
    if (!node || !isPlain(ov)) continue;
    if (ov.name !== undefined && !nameOk(ov.name)) continue;
    if (ov.layerId !== undefined && !nameOk(ov.layerId)) continue;
    if (ov.name === undefined && ov.layerId === undefined) continue;
    const change = { ...(ov.name !== undefined ? { name: ov.name.trim() } : {}), ...(ov.layerId !== undefined ? { layerId: ov.layerId } : {}) };
    const part = node.kind === 'component' ? parts.get(node.partId) : null;
    const ev = part && (ov.layerId === undefined || layers.has(ov.layerId)) ? mdEvidence(part) : null;
    if (ev) {
      const evidence = evidenceList([...(node.evidence ?? []), ev]);
      nodes.set(id, { ...node, ...change, origin: 'DECLARED', evidence, hash: hashOf(evidence) });
    } else draftNodes.set(id, { id, kind: 'override', ...change, origin: 'DECLARED' });
  }

  for (const a of Array.isArray(o.added) ? o.added : []) {
    if (!isPlain(a) || typeof a.id !== 'string' || !DRAWN_ID.test(a.id) || !DRAWN_KINDS.has(a.kind) || !nameOk(a.name)) continue;
    if (a.layerId !== undefined && !nameOk(a.layerId)) continue;
    // a box already written to the .md is a part now, no longer a drawing
    if (parts.has(a.id.slice('dn:'.length))) continue;
    draftNodes.set(a.id, { id: a.id, kind: a.kind, name: a.name.trim(), ...(a.layerId !== undefined ? { layerId: a.layerId } : {}), origin: 'DECLARED' });
  }

  const known = (id) => typeof id === 'string' && (nodes.has(id) || draftNodes.has(id));
  for (const e of Array.isArray(o.edges) ? o.edges : []) {
    if (!isPlain(e) || !known(e.from) || !known(e.to) || e.from === e.to) continue;
    if (e.label !== undefined && e.label !== null && !nameOk(e.label)) continue;
    const id = `de:${e.from}->${e.to}`;
    draftEdges.set(id, { id, from: e.from, to: e.to, label: typeof e.label === 'string' ? e.label.trim() : null, origin: 'DECLARED' });
  }

  for (const id of Array.isArray(o.hidden) ? o.hidden : []) {
    if (typeof id !== 'string') continue;
    if (nodes.has(id)) nodes.set(id, { ...nodes.get(id), hidden: true });
    if (edges.has(id)) edges.set(id, { ...edges.get(id), hidden: true });
    draftNodes.delete(id);
    draftEdges.delete(id);
  }
  for (const [id, e] of draftEdges) if (!known(e.from) || !known(e.to)) draftEdges.delete(id);

  const byId = (a, b) => byCodeUnit(a.id, b.id);
  return {
    ...model,
    nodes: [...nodes.values()].sort(byId),
    edges: [...edges.values()].sort(byId),
    draft: { nodes: [...draftNodes.values()].sort(byId), edges: [...draftEdges.values()].sort(byId) },
  };
}

// ---------- journeys ----------

const JOURNEY_ORIGINS = new Set(['INFERRED', 'DECLARED']);

/**
 * A journey is ordered steps over edges that EXIST in the model (contracts § 4). One step on an edge that is not there
 * rejects the whole journey, with the reason and the step: a half journey would be a story the code does not tell.
 * Returns `{ journeys, rejected: [{ id, reason, step? }] }`; reasons: bad-shape, bad-origin, duplicate-id, bad-step,
 * unknown-edge. Only the program (EXTRACTED) or nobody (AMBIGUOUS) cannot have written a journey, so those are refused.
 */
export function validateJourneys(model, journeys) {
  const edgeIds = new Set((model?.edges ?? []).map((e) => e.id));
  const ok = [];
  const rejected = [];
  const seen = new Set();
  for (const j of Array.isArray(journeys) ? journeys : []) {
    const id = isPlain(j) && typeof j.id === 'string' ? j.id : null;
    const no = (reason, step) => rejected.push({ id, reason, ...(step ? { step } : {}) });
    if (!id || !id.startsWith('j:') || !nameOk(j.name) || !Array.isArray(j.steps) || !j.steps.length) { no('bad-shape'); continue; }
    if (j.origin !== undefined && !JOURNEY_ORIGINS.has(j.origin)) { no('bad-origin'); continue; }
    if (seen.has(id)) { no('duplicate-id'); continue; }
    let bad = null;
    for (let i = 0; i < j.steps.length && !bad; i++) {
      const s = j.steps[i];
      const noteOk = !isPlain(s) ? false : s.note === undefined || s.note === null || (typeof s.note === 'string' && s.note.length <= NOTE_MAX);
      if (!noteOk || s.n !== i + 1 || typeof s.edgeId !== 'string') bad = ['bad-step', i + 1];
      else if (!edgeIds.has(s.edgeId)) bad = ['unknown-edge', s.n];
    }
    if (bad) { no(...bad); continue; }
    seen.add(id);
    ok.push({ id, name: j.name.trim(), origin: j.origin ?? 'INFERRED', steps: j.steps.map((s) => ({ n: s.n, edgeId: s.edgeId, note: s.note ?? null })) });
  }
  return { journeys: ok.sort((a, b) => byCodeUnit(a.id, b.id)), rejected };
}

// ---------- out of date by hash (decision 7) ----------

// The checker's hash of what a claim about a fact cites (sha256 of the cited shas sorted by file and line, 16 hex).
function citesHash(cites) {
  const seen = new Map();
  for (const c of cites) if (isPlain(c)) seen.set(`${c.file}\n${c.line}`, c);
  const list = [...seen.values()].sort((a, b) => byCodeUnit(String(a.file), String(b.file)) || a.line - b.line);
  return list.length ? hashOf(list) : null;
}

/**
 * The ids of the claims that are out of date: the node or edge they are about has another hash than at check time (or
 * is gone), the fact they are about is gone, or a file they cite has another sha now (or left the census). So editing a
 * file makes stale only the claims whose evidence is in it. `{ census }` gives the shas of now (without it, the shas the
 * model's evidence carries; a file known to neither is not proof of anything, so it is stale); `{ facts }` the fact ids.
 */
export function markStale(model, claims, { census, facts } = {}) {
  const hashes = new Map();
  for (const key of ['nodes', 'edges']) for (const x of model?.[key] ?? []) hashes.set(x.id, x.hash ?? null);
  const journeys = new Set((model?.journeys ?? []).map((j) => j.id));
  const shaOf = new Map();
  if (census) {
    for (const f of census.files ?? []) if (f.included && f.sha) shaOf.set(f.path, f.sha);
  } else {
    for (const key of ['nodes', 'edges']) for (const x of model?.[key] ?? []) for (const e of x.evidence ?? []) shaOf.set(e.file, e.sha);
  }
  const factIds = facts ? new Set((Array.isArray(facts) ? facts : facts.facts ?? []).map((f) => f?.id)) : null;
  const out = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!isPlain(c) || typeof c.id !== 'string') continue;
    const cites = Array.isArray(c.cites) ? c.cites : [];
    let stale;
    if (hashes.has(c.about)) stale = hashes.get(c.about) !== (c.hashAtCheck ?? null);
    else if (journeys.has(c.about)) stale = false;
    // about a fact: it must still be a fact (without the list, the hash says it was stamped from what it cites)
    else if (factIds) stale = !factIds.has(c.about);
    else stale = c.hashAtCheck == null || c.hashAtCheck !== citesHash(cites);
    stale ||= cites.some((x) => !isPlain(x) || typeof x.sha !== 'string' || shaOf.get(x.file) !== x.sha);
    if (stale) out.push(c.id);
  }
  return [...new Set(out)].sort(byCodeUnit);
}

// The golden rule (item 23): every part of the map has a node, every component has a part. People and externals are not
// parts of anyone's map, so they are never in the second list.
export function goldenRule(model, arch) {
  const components = (model?.nodes ?? []).filter((n) => n.kind === 'component');
  const covered = new Set(components.flatMap((n) => [n.partId, ...(n.attrs?.parts ?? [])]).filter(Boolean));
  return {
    partsWithoutNode: (arch?.parts ?? []).map((p) => p.id).filter((id) => !covered.has(id)),
    nodesWithoutPart: components.filter((n) => !n.partId).map((n) => n.id).sort(byCodeUnit),
  };
}
