// The Flow tab's export and import (plano-v02 § v0.2.1): the map as a mermaid flowchart, the preview of what an imported
// drawing changes, and the one write it makes: the README's mermaid block plus a skeleton file per new part. Nothing is
// ever deleted, and every write stays inside the architecture folder.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeResolve } from '../files.mjs';
import { brainDir, writeAtomic } from '../store.mjs';
import { flowKey, matchParts, newId, parseFlow, printFlow } from '../web/flow.js';
import { MERMAID_FENCE_RE as FENCE_RE, readmeMermaid, slug } from './parse.mjs';

const DEFAULT_DIR = { en: 'docs/architecture', pt: 'docs/arquitetura' };

const SKELETON = {
  en: (name) => `# ${name}\n\nPart added from the flow drawing. Say here, in a sentence or two, what it does.\n\n## How it works\n\n## Where in the code\n\n## Rules that must not break\n\n## What's missing\n`,
  pt: (name) => `# ${name}\n\nParte criada pelo desenho do fluxo. Diga aqui, em uma ou duas frases, o que ela faz.\n\n## Como funciona\n\n## Onde está no código\n\n## Regras que não podem quebrar\n\n## O que falta\n`,
};
const README_TITLE = { en: 'Architecture', pt: 'Arquitetura' };

// The map as one flowchart: a subgraph per layer, a box per part (with the README's own id and shape when it drew the
// part), the README's other boxes and arrows, or, when it drew none, the relations session-map found as dotted arrows.
export function archFlow(arch) {
  const readme = arch.mermaid ? parseFlow(arch.mermaid) : null;
  const drawn = readme?.ok ? readme : null;
  const drawnPart = drawn ? matchParts(drawn, arch.parts) : new Map();
  const model = { ok: true, direction: 'LR', layers: [], nodes: [], edges: [], extra: drawn ? [...drawn.extra] : [], warnings: [] };
  const idOf = new Map(); // README node id → export id
  const partNode = new Map(); // part id → export id
  const layerFor = new Map();
  for (const l of arch.layers) {
    const id = newId(model, l.id);
    model.layers.push({ id, name: l.name });
    for (const partId of l.partIds) layerFor.set(partId, id);
  }
  for (const l of arch.layers) {
    for (const partId of l.partIds) {
      const part = arch.parts.find((p) => p.id === partId);
      if (!part || partNode.has(partId)) continue;
      const own = drawn?.nodes.find((n) => drawnPart.get(n.id) === partId && !idOf.has(n.id));
      const taken = own && model.nodes.some((n) => n.id === own.id);
      const id = own && !taken ? own.id : newId(model, part.id);
      if (own) idOf.set(own.id, id);
      partNode.set(partId, id);
      model.nodes.push({ id, label: part.name, layer: layerFor.get(partId), shape: own?.shape ?? 'box' });
    }
  }
  for (const part of arch.parts) {
    if (partNode.has(part.id)) continue;
    const id = newId(model, part.id);
    partNode.set(part.id, id);
    model.nodes.push({ id, label: part.name, layer: null, shape: 'box' });
  }
  for (const n of drawn?.nodes ?? []) {
    if (drawnPart.has(n.id)) {
      if (!idOf.has(n.id) && partNode.has(drawnPart.get(n.id))) idOf.set(n.id, partNode.get(drawnPart.get(n.id)));
      continue;
    }
    const layerName = drawn.layers.find((l) => l.id === n.layer)?.name;
    const layer = model.layers.find((l) => layerName && flowKey(l.name) === flowKey(layerName))?.id ?? null;
    const id = model.nodes.some((x) => x.id === n.id) ? newId(model, n.label) : n.id;
    idOf.set(n.id, id);
    model.nodes.push({ id, label: n.label, layer, shape: n.shape });
  }
  const joined = (a, b) => model.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  for (const e of drawn?.edges ?? []) {
    const from = idOf.get(e.from), to = idOf.get(e.to);
    if (from && to) model.edges.push({ ...e, from, to });
  }
  // The README's arrows are the drawing someone made; relations (shared branches, chats, file mentions) join nearly
  // every pair on a real project, so they only fill in a drawing with no arrows of its own.
  for (const l of drawn?.edges.length ? [] : arch.links ?? []) {
    const from = partNode.get(l.a), to = partNode.get(l.b);
    if (from && to && !joined(from, to)) model.edges.push({ from, to, label: null, kind: 'dotted' });
  }
  return model;
}

export const exportMermaid = (arch) => printFlow(archFlow(arch));

// What a box stands for, the same in both drawings: a part, or a free box known by its name.
function entities(model, parts) {
  const match = matchParts(model, parts);
  const of = new Map(model.nodes.map((n) => [n.id, match.has(n.id) ? `p:${match.get(n.id)}` : `n:${flowKey(n.label)}`]));
  return { match, of };
}

function fileFor(name, dir, used) {
  let base = slug(name) || 'part';
  if (base === 'readme') base = 'readme-part';
  let file = `${base}.md`;
  for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base}-${n}.md`;
  used.add(file.toLowerCase());
  return `${dir}/${file}`;
}

// The preview of an import: what the drawing adds, moves, leaves out, and which arrows change, against the map as the
// export draws it, so exporting and importing again changes nothing. taken(file) says a file already exists.
export function planImport(arch, text, { dir = arch.dir ?? DEFAULT_DIR[arch.lang] ?? DEFAULT_DIR.en, taken = () => false } = {}) {
  const next = parseFlow(text);
  if (!next.ok) return { ok: false, error: next.error };
  if (!next.nodes.length) return { ok: false, error: 'empty-flowchart' };
  // Labels print backticks as #96;, so only a line kept as it is can hold a fence, and a fence would end the README block.
  const printed = printFlow(next);
  if (printed.includes('```')) return { ok: false, error: 'fence-in-drawing' };
  const base = archFlow(arch);
  const was = entities(base, arch.parts);
  const now = entities(next, arch.parts);
  const layerName = (model, node) => model.layers.find((l) => l.id === node.layer)?.name ?? null;
  const nameOf = new Map(arch.parts.map((p) => [p.id, p.name]));
  const label = (model, ents, id) => {
    const partId = ents.match.get(id);
    return partId ? nameOf.get(partId) : model.nodes.find((n) => n.id === id)?.label ?? id;
  };

  const layersNew = next.layers.filter((l) => !base.layers.some((b) => flowKey(b.name) === flowKey(l.name))).map(({ id, name }) => ({ id, name }));
  const baseFree = new Set(base.nodes.filter((n) => !was.match.has(n.id)).map((n) => was.of.get(n.id)));
  const used = new Set([...arch.parts.map((p) => p.file.split('/').pop().toLowerCase()), 'readme.md']);
  const seen = new Set();
  const partsNew = [];
  const partsMoved = [];
  for (const n of next.nodes) {
    const ent = now.of.get(n.id);
    if (seen.has(ent)) continue;
    seen.add(ent);
    const partId = now.match.get(n.id);
    if (!partId) {
      if (baseFree.has(ent)) continue;
      let file = fileFor(n.label, dir, used);
      while (taken(file)) file = fileFor(n.label, dir, used);
      partsNew.push({ nodeId: n.id, name: n.label, layer: layerName(next, n), file });
      continue;
    }
    const before = base.nodes.find((b) => was.match.get(b.id) === partId);
    const from = before ? layerName(base, before) : null;
    const to = layerName(next, n);
    if (flowKey(from ?? '') !== flowKey(to ?? '')) partsMoved.push({ partId, name: nameOf.get(partId), from, to });
  }
  const placed = new Set(now.match.values());
  const partsMissing = arch.parts.filter((p) => !placed.has(p.id)).map((p) => ({ partId: p.id, name: p.name }));

  const edgeSet = (model, ents) => new Map(model.edges.map((e) => [`${ents.of.get(e.from)}>${ents.of.get(e.to)}`, { from: label(model, ents, e.from), to: label(model, ents, e.to) }]));
  const before = edgeSet(base, was);
  const after = edgeSet(next, now);
  const edgesAdded = [...after].filter(([k]) => !before.has(k)).map(([, e]) => e);
  const edgesRemoved = [...before].filter(([k]) => !after.has(k)).map(([, e]) => e);

  // Direction, labels, arrow kinds, shapes and kept lines live only in the diagram: any of them changing rewrites it.
  const diagramChanged = printed !== printFlow(base) && printed !== arch.mermaid;
  const unchanged = !diagramChanged && ![layersNew, partsNew, partsMoved, partsMissing, edgesAdded, edgesRemoved].some((list) => list.length);
  return { ok: true, unchanged, diagramChanged, warnings: next.warnings, layersNew, partsNew, partsMoved, partsMissing, edgesAdded, edgesRemoved };
}

function withBlock(readme, block) {
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const fenced = ['```mermaid', ...block.split('\n'), '```'].join(eol);
  if (FENCE_RE.test(readme)) return readme.replace(FENCE_RE, () => fenced);
  return `${readme.replace(/\s*$/, '')}${eol}${eol}${fenced}${eol}`;
}

// Writes what planImport showed: the README's mermaid block (and nothing else of it) and a skeleton for each new part
// not in `skip`. A map read from the main branch is not in this folder, so it is refused.
export function applyImport({ root, arch, text, skip = [] }) {
  if (arch.source === 'main-branch') return { ok: false, error: 'arch-not-here' };
  const lang = arch.lang === 'pt' ? 'pt' : 'en';
  const dir = arch.source === 'worktree' ? arch.dir : DEFAULT_DIR[lang];
  const readmePath = safeResolve(root, `${dir}/README.md`);
  if (!readmePath) return { ok: false, error: 'bad-path' };
  const plan = planImport(arch, text, { dir, taken: (file) => existsSync(safeResolve(root, file) ?? join(root, file)) });
  if (!plan.ok) return plan;
  if (plan.unchanged) return { ok: true, changed: false, files: [] };
  const block = printFlow(parseFlow(text));
  const creating = plan.partsNew.filter((p) => !skip.includes(p.nodeId)).map((p) => ({ ...p, abs: safeResolve(root, p.file) }));
  if (creating.some((p) => !p.abs)) return { ok: false, error: 'bad-path' };
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : `# ${README_TITLE[lang]}\n`;
  // The README's diagram keeps the person's own layout when the drawing is the same; otherwise the new one is written.
  const files = [];
  if (readmeMermaid(readme) !== block) {
    writeAtomic(readmePath, withBlock(readme, block));
    files.push(`${dir}/README.md`);
  }
  for (const p of creating) {
    mkdirSync(dirname(p.abs), { recursive: true });
    writeFileSync(p.abs, SKELETON[lang](p.name), { flag: 'wx' });
    files.push(p.file);
  }
  return { ok: true, changed: files.length > 0, files };
}

// ---- the workshop draft: one per project, beside the project's other brain files ------------

export const draftPath = (smDir, projectId) => join(brainDir(smDir, projectId), 'flow-draft.mmd');

export function readDraft(smDir, projectId) {
  try {
    return readFileSync(draftPath(smDir, projectId), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export const writeDraft = (smDir, projectId, text) => writeAtomic(draftPath(smDir, projectId), text);
export const deleteDraft = (smDir, projectId) => rmSync(draftPath(smDir, projectId), { force: true });
