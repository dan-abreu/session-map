// The one model of a project is the Flow's (fd25, flow.md fl07): the parts, actors and services the page draws, each fact
// with the lines of the README and of the code it rests on. The lines of "Tudo em dia?" that judge the architecture against
// the code (the golden rule, what the readers found against what is drawn, the drawn arrows against the real imports) read
// a smaller shape: a box per part with its evidence, and an arrow per pair of parts with the import lines behind it. This
// is that shape, made from the Flow's model on the spot, never kept: there is one model and one way to read it.
// Pure: no disk, no clock.

// → { version, nodes, edges, journeys, stale } or null when there is no model yet.
// census: the project's census, only for the sha of each file an evidence line points at (null when it has none).
export function linesModelOf(model, census = null) {
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) return null;
  const sha = new Map((census?.files ?? []).map((f) => [f.path, f.sha ?? null]));
  const evidence = (list) => (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e.file === 'string' && Number.isInteger(e.line))
    .map((e) => ({ file: e.file, line: e.line, sha: sha.get(e.file) ?? null }));
  const parts = model.nodes.filter((n) => n.kind === 'part' && typeof n.partId === 'string');
  const nodes = parts.map((n) => ({
    id: n.id, level: 3, kind: 'component', name: n.name ?? n.partId, partId: n.partId,
    origin: n.origin === 'declared' ? 'DECLARED' : 'EXTRACTED', evidence: evidence([...(n.declared ?? []), ...(n.detected ?? [])]),
  }));
  const isPart = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const e of model.edges) {
    if (!isPart.has(e.from) || !isPart.has(e.to)) continue;
    const imports = evidence((e.detected ?? []).filter((d) => d.via === 'import'));
    if (!imports.length) continue;
    edges.push({ id: e.id, from: e.from, to: e.to, kind: 'imports', origin: 'EXTRACTED', evidence: imports });
  }
  return { version: model.version ?? null, nodes, edges, journeys: [], stale: [] };
}
