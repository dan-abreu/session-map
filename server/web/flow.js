// The mermaid flowchart of the architecture as data (plano-v02 § v0.2.1): read, written back and edited by the Flow tab's
// tools. Pure, so the page draws with it and the server imports with the same rules. Only the flowchart subset the
// convention uses is understood: subgraphs, nodes `ID[Name]`/`ID(Name)` and kin, arrows `-->`, `---`, `-.->`, `|labels|`.
// Anything else is kept as it is for printing and reported as a warning.

const HEADER_RE = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?$/i;
const ID_RE = /^[A-Za-z0-9_]+(?:-(?![-.>])[A-Za-z0-9_]+)*/;
// Longest opener first: `([` before `(`.
const SHAPES = [['([', '])', 'stadium'], ['[[', ']]', 'sub'], ['[(', ')]', 'db'], ['((', '))', 'circle'], ['{{', '}}', 'hex'], ['[', ']', 'box'], ['(', ')', 'round'], ['{', '}', 'diamond'], ['>', ']', 'flag']];
const OPEN = Object.fromEntries(SHAPES.map(([o, c, s]) => [s, [o, c]]));
const OP_RE = /^\s*(?:(-\.+->)|(={2,}>)|(-{2,}>)|(-\.+-)|(-{3,}|={3,})|--\s+([^\s-][^>|]*?)\s+-{2,}>)(?:\s*\|([^|]*)\|)?\s*/;
const KIND_OP = { arrow: '-->', line: '---', dotted: '-.->', 'dotted-line': '-.-', thick: '==>' };
const RESERVED = new Set(['end', 'graph', 'subgraph', 'flowchart', 'style', 'class', 'classdef', 'click', 'linkstyle', 'direction', 'default', 'call', 'href']);
// Fences on their own lines only, as in markdown and as the server reads the README.
const FENCE_RE = /^[ \t]*```mermaid[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?=\r?$)/gm;

const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export const flowKey = (s) => plain(s).replace(/[^a-z0-9]/g, '');
const decode = (s) => s.replace(/#quot;/g, '"').replace(/#96;/g, '`').trim();
// A backtick printed as is could close the README's fence; mermaid draws #96; as the same character.
const encode = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/"/g, '#quot;').replace(/`/g, '#96;');

// The content of the last closed ```mermaid fence: what a chat reply that redraws the diagram holds.
export function lastMermaidBlock(text) {
  let last = null;
  for (const m of String(text ?? '').matchAll(FENCE_RE)) last = m[1].trim();
  return last;
}

function readNode(s, at) {
  const rest = s.slice(at);
  const lead = rest.length - rest.trimStart().length;
  const idm = ID_RE.exec(rest.slice(lead));
  if (!idm) return null;
  let pos = at + lead + idm[0].length;
  const node = { id: idm[0], label: null, shape: null };
  const shape = SHAPES.find(([o]) => s.startsWith(o, pos));
  if (shape) {
    const [open, close, name] = shape;
    pos += open.length;
    let label;
    const quoted = /^\s*"([^"]*)"\s*/.exec(s.slice(pos));
    if (quoted && s.startsWith(close, pos + quoted[0].length)) {
      label = quoted[1];
      pos += quoted[0].length;
    } else {
      const end = s.indexOf(close, pos);
      if (end < 0) return null;
      label = s.slice(pos, end);
      pos = end;
    }
    pos += close.length;
    node.label = decode(label);
    node.shape = name;
  }
  const cls = /^:::[\w-]+/.exec(s.slice(pos));
  if (cls) pos += cls[0].length;
  return { node, end: pos };
}

function readOp(s, at) {
  const m = OP_RE.exec(s.slice(at));
  if (!m) return null;
  const kind = m[1] ? 'dotted' : m[2] ? 'thick' : m[3] || m[6] ? 'arrow' : m[4] ? 'dotted-line' : 'line';
  const label = (m[7] ?? m[6] ?? '').trim();
  return { kind, label: label ? decode(label) : null, end: at + m[0].length };
}

// One statement: a node, or nodes joined by arrows. null when it is anything else.
function parseStatement(s) {
  const first = readNode(s, 0);
  if (!first) return null;
  const nodes = [first.node];
  const edges = [];
  let pos = first.end;
  while (s.slice(pos).trim()) {
    const op = readOp(s, pos);
    if (!op) return null;
    const next = readNode(s, op.end);
    if (!next) return null;
    edges.push({ from: nodes.at(-1).id, to: next.node.id, label: op.label, kind: op.kind });
    nodes.push(next.node);
    pos = next.end;
  }
  return { nodes, edges };
}

function subgraphOf(line, model) {
  const body = line.slice('subgraph'.length).trim();
  let m = /^([A-Za-z0-9_][\w-]*)\s*\[\s*"?(.*?)"?\s*\]$/.exec(body);
  if (m) return { id: m[1], name: decode(m[2]) || m[1] };
  m = /^"([^"]+)"$/.exec(body);
  if (m) return { id: newId(model, m[1]), name: decode(m[1]) };
  if (/^[A-Za-z0-9_][\w-]*$/.test(body)) return { id: body, name: body };
  return body ? { id: newId(model, body), name: decode(body) } : null;
}

export function parseFlow(text) {
  const source = lastMermaidBlock(text) ?? String(text ?? '');
  const lines = source.split(/\r?\n/);
  let i = 0;
  const skip = () => { while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith('%%'))) i++; };
  skip();
  // Front matter (---\ntitle: …\n---) comes before the header.
  if (lines[i]?.trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
    skip();
  }
  const header = HEADER_RE.exec(lines[i]?.trim() ?? '');
  if (!header) return { ok: false, error: 'not-flowchart' };
  const model = { ok: true, direction: (header[1] ?? 'TB').toUpperCase(), layers: [], nodes: [], edges: [], extra: [], warnings: [] };
  const byId = new Map();
  const stack = [];
  const see = (n) => {
    const known = byId.get(n.id);
    if (known) {
      if (n.label !== null && known.bare) {
        Object.assign(known.node, { label: n.label, shape: n.shape });
        known.bare = false;
      }
      return;
    }
    const node = { id: n.id, label: n.label ?? n.id, layer: stack.at(-1) ?? null, shape: n.shape ?? 'box' };
    byId.set(n.id, { node, bare: n.label === null });
    model.nodes.push(node);
  };
  for (i += 1; i < lines.length; i++) {
    const line = lines[i].trim().replace(/;+$/, '').trim();
    if (!line || line.startsWith('%%') || /^direction\s+\w+$/i.test(line)) continue;
    if (/^subgraph\b/.test(line)) {
      const layer = subgraphOf(line, model);
      if (layer) {
        if (!model.layers.some((l) => l.id === layer.id)) model.layers.push(layer);
        stack.push(layer.id);
        continue;
      }
    }
    if (line === 'end') { stack.pop(); continue; }
    const st = /^(classDef|class|style|linkStyle|click)\b/.test(line) ? null : parseStatement(line);
    if (!st) {
      model.extra.push(line);
      model.warnings.push({ line: i + 1, text: line });
      continue;
    }
    st.nodes.forEach(see);
    for (const e of st.edges) model.edges.push(e);
  }
  return model;
}

const nodeLine = (n) => {
  const [open, close] = OPEN[n.shape] ?? OPEN.box;
  return `${n.id}${open}"${encode(n.label)}"${close}`;
};

export function printFlow(model) {
  const out = [`flowchart ${model.direction ?? 'LR'}`];
  const layerIds = new Set(model.layers.map((l) => l.id));
  for (const l of model.layers) {
    out.push(`  subgraph ${l.id}["${encode(l.name)}"]`);
    for (const n of model.nodes.filter((x) => x.layer === l.id)) out.push(`    ${nodeLine(n)}`);
    out.push('  end');
  }
  for (const n of model.nodes.filter((x) => !layerIds.has(x.layer))) out.push(`  ${nodeLine(n)}`);
  for (const e of model.edges) out.push(`  ${e.from} ${KIND_OP[e.kind] ?? '-->'}${e.label ? `|${encode(e.label)}|` : ''} ${e.to}`);
  for (const x of model.extra ?? []) out.push(`  ${x}`);
  return out.join('\n');
}

// ---- the tools of the Flow workshop: each returns a new model -----------------------------

export function newId(model, label) {
  let base = plain(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'box';
  if (/^\d/.test(base)) base = `n_${base}`;
  if (RESERVED.has(base)) base = `${base}_box`;
  const taken = new Set([...model.nodes.map((n) => n.id), ...model.layers.map((l) => l.id)].map((id) => id.toLowerCase()));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

const copy = (model) => ({ ...model, layers: [...model.layers], nodes: [...model.nodes], edges: [...model.edges], extra: [...(model.extra ?? [])] });

export function addLayer(model, name) {
  const next = copy(model);
  next.layers.push({ id: newId(model, name), name: String(name).trim() });
  return next;
}

export function addBox(model, label, layerId = null) {
  const next = copy(model);
  const layer = model.layers.some((l) => l.id === layerId) ? layerId : null;
  next.nodes.push({ id: newId(model, label), label: String(label).trim(), layer, shape: 'box' });
  return next;
}

export function connect(model, from, to, label = null) {
  const known = (id) => model.nodes.some((n) => n.id === id);
  if (!known(from) || !known(to) || model.edges.some((e) => e.from === from && e.to === to)) return model;
  const next = copy(model);
  next.edges.push({ from, to, label: label ? String(label).trim() : null, kind: 'arrow' });
  return next;
}

export function rename(model, id, label) {
  const text = String(label).trim();
  if (!text) return model;
  const next = copy(model);
  next.nodes = next.nodes.map((n) => (n.id === id ? { ...n, label: text } : n));
  next.layers = next.layers.map((l) => (l.id === id ? { ...l, name: text } : l));
  return next;
}

// The moved box goes to the end of its new layer.
export function moveToLayer(model, nodeId, layerId) {
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return model;
  const next = copy(model);
  const layer = model.layers.some((l) => l.id === layerId) ? layerId : null;
  next.nodes = [...next.nodes.filter((n) => n.id !== nodeId), { ...node, layer }];
  return next;
}

export function removeNode(model, nodeId) {
  const next = copy(model);
  next.nodes = next.nodes.filter((n) => n.id !== nodeId);
  next.edges = next.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  return next;
}

export function removeEdge(model, index) {
  const next = copy(model);
  next.edges = next.edges.filter((_, i) => i !== index);
  return next;
}

// Which part each box stands for: the same name first, then the same id (a box `orders[Basket]` is still Orders).
export function matchParts(model, parts) {
  const byName = new Map();
  for (const p of parts) for (const k of [flowKey(p.name), flowKey(p.id)]) if (k && !byName.has(k)) byName.set(k, p.id);
  const out = new Map();
  for (const n of model.nodes) {
    const id = byName.get(flowKey(n.label)) ?? byName.get(flowKey(n.id));
    if (id) out.set(n.id, id);
  }
  return out;
}
