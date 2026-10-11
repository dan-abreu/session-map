// Fluid Flow (fl05, fl06, fl13): what the Flow tab says about a map with no diagram of its own, and the ways to take the
// drawing out of the page: SVG and PNG of what is on screen, Markdown with the mermaid block, draw.io and PlantUML. The
// pure helpers come first (what node:test loads); the DOM ones below only run in the page.

import { parseFlow } from './flow.js';

const PNG_SCALE = 2;
const PNG_SIDE_MAX = 8192;

// A map with parts whose README has no diagram: the page shows the one session-map drew from the layers and relations.
export const isAutoDraft = (arch) => arch.source !== 'none' && !arch.mermaid && arch.parts.length > 0;

export function exportFileName(projectName, ext) {
  const base = String(projectName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base ? `${base}-flow.${ext}` : `flow.${ext}`;
}

// The README's own fence is the only thing that may close the block, so a ``` inside the drawing is written as mermaid draws it.
export function markdownOf(projectName, text, flowWord) {
  return `# ${projectName} · ${flowWord}\n\n\`\`\`mermaid\n${text.replace(/```/g, '#96;#96;#96;')}\n\`\`\`\n`;
}

export function pngSize(width, height) {
  const w = Math.max(1, Number(width) || 0), h = Math.max(1, Number(height) || 0);
  const scale = Math.min(PNG_SCALE, PNG_SIDE_MAX / w, PNG_SIDE_MAX / h);
  return { width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)), scale: PNG_SCALE };
}

// A stand-alone .svg from the markup of the drawing on screen: its own size instead of "fill the area", the namespace a
// file needs, and a background so it reads on a white page or a dark one.
export function svgDocument(markup, { width, height, background }) {
  const open = /^<svg\b([^>]*)>/.exec(markup);
  if (!open) return markup;
  const attrs = open[1].replace(/\s(?:width|height|style|xmlns|tabindex|role)="[^"]*"/g, '');
  const body = markup.slice(open[0].length);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${attrs} width="${Math.round(width)}" height="${Math.round(height)}"><rect width="100%" height="100%" fill="${background}"/>${body}`;
}

// ---- draw.io and PlantUML (fl13) -------------------------------------------------------------
// Both are written from the same parsed diagram as the mermaid text (parseFlow), so the layers, the boxes and the arrows
// are the ones the mermaid export holds. Deterministic: no clock, no random id, the same text gives the same file.

const modelOf = (text) => {
  const m = text ? parseFlow(String(text)) : null;
  return m?.ok ? m : null;
};

// XML text for an attribute: the five markup characters, control characters XML cannot carry dropped, a line break kept.
const xml = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/\r?\n/g, '&#xa;');

const BOX_W = 160, BOX_H = 56, GAP = 40, PAD = 30, HEAD = 36;
const DRAWIO_BOX = {
  box: 'rounded=0', round: 'rounded=1', stadium: 'rounded=1;arcSize=50', sub: 'shape=process', db: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12',
  circle: 'ellipse', hex: 'shape=hexagon;perimeter=hexagonPerimeter2', diamond: 'rhombus', flag: 'shape=document',
};
const DRAWIO_EDGE = { arrow: '', line: 'endArrow=none;', dotted: 'dashed=1;', 'dotted-line': 'dashed=1;endArrow=none;', thick: 'strokeWidth=3;' };

// A .drawio file (mxGraph XML) for diagrams.net. Layers are containers laid out in the direction of the flowchart (columns
// for LR and RL, rows for TB and BT, reversed for RL and BT); boxes with no layer stand last, on the page itself.
export function drawioOf(text, name) {
  const model = modelOf(text);
  if (!model) return null;
  const across = model.direction === 'LR' || model.direction === 'RL';
  const groups = model.layers.map((l, i) => ({ layer: l, cell: `layer-${i + 1}`, nodes: model.nodes.filter((n) => n.layer === l.id) }));
  if (model.direction === 'RL' || model.direction === 'BT') groups.reverse();
  const known = new Set(model.layers.map((l) => l.id));
  const loose = model.nodes.filter((n) => !known.has(n.layer));
  if (loose.length) groups.push({ layer: null, cell: '1', nodes: loose });
  const cellOf = new Map(model.nodes.map((n, i) => [n.id, `box-${i + 1}`]));
  const out = [];
  let at = 0;
  const boxXml = (n, parent, x, y) => `        <mxCell id="${cellOf.get(n.id)}" value="${xml(n.label).trim() || xml(n.id)}" style="${DRAWIO_BOX[n.shape] ?? 'rounded=0'};whiteSpace=wrap;html=0;" vertex="1" parent="${parent}">\n          <mxGeometry x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" as="geometry"/>\n        </mxCell>`;
  for (const g of groups) {
    const count = g.nodes.length;
    const long = count * (across ? BOX_H : BOX_W) + Math.max(0, count - 1) * GAP;
    const w = across ? BOX_W + 2 * PAD : Math.max(BOX_W, long) + 2 * PAD;
    const hgt = across ? HEAD + Math.max(BOX_H, long) + PAD : HEAD + BOX_H + PAD;
    const place = (i) => (across ? [PAD, HEAD + i * (BOX_H + GAP)] : [PAD + i * (BOX_W + GAP), HEAD]);
    if (g.layer) {
      const [lx, ly] = across ? [at, 0] : [0, at];
      out.push(`        <mxCell id="${g.cell}" value="${xml(g.layer.name).trim() || xml(g.layer.id)}" style="swimlane;startSize=${HEAD - 6};horizontal=1;rounded=1;whiteSpace=wrap;html=0;fontStyle=1;fillColor=#f5f5f5;strokeColor=#666666;" vertex="1" parent="1">\n          <mxGeometry x="${lx}" y="${ly}" width="${w}" height="${hgt}" as="geometry"/>\n        </mxCell>`);
      g.nodes.forEach((n, i) => out.push(boxXml(n, g.cell, ...place(i))));
    } else {
      g.nodes.forEach((n, i) => out.push(boxXml(n, '1', ...(across ? [at + PAD, HEAD + i * (BOX_H + GAP)] : [PAD + i * (BOX_W + GAP), at + HEAD]))));
    }
    at += (across ? w : hgt) + GAP;
  }
  model.edges.forEach((e, i) => {
    if (!cellOf.has(e.from) || !cellOf.has(e.to)) return;
    out.push(`        <mxCell id="edge-${i + 1}" value="${xml(e.label ?? '')}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;${DRAWIO_EDGE[e.kind] ?? ''}" edge="1" parent="1" source="${cellOf.get(e.from)}" target="${cellOf.get(e.to)}">\n          <mxGeometry relative="1" as="geometry"/>\n        </mxCell>`);
  });
  return `<mxfile host="session-map" version="1">\n  <diagram id="flow" name="${xml(name || 'Flow')}">\n    <mxGraphModel grid="1" gridSize="10" page="1" pageScale="1" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n${out.join('\n')}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
}

// A name PlantUML reads as plain words: one line, no quote or backslash, and the characters its text markup would act on
// (< for tags, % for functions, ~ for escapes) written as the unicode escape it understands.
const uml = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, "'").replace(/\\/g, '/')
  .replace(/[<%~]/g, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`);

const UML_SHAPE = { stadium: 'actor', db: 'database', hex: 'cloud' };
const UML_ARROW = { arrow: '-->', line: '--', dotted: '..>', 'dotted-line': '..', thick: '-[bold]->' };

// Aliases are made of letters, digits and _ with a prefix, so no id of the diagram can hit a PlantUML keyword.
function aliasesOf(model) {
  const taken = new Set();
  const make = (prefix, id) => {
    const base = `${prefix}_${String(id).replace(/\W/g, '_')}`;
    let a = base;
    for (let n = 2; taken.has(a); n++) a = `${base}_${n}`;
    taken.add(a);
    return a;
  };
  return { layer: new Map(model.layers.map((l) => [l.id, make('p', l.id)])), node: new Map(model.nodes.map((n) => [n.id, make('c', n.id)])) };
}

function plantuml(model, title, wrapper) {
  const alias = aliasesOf(model);
  const lines = ['@startuml'];
  if (title) lines.push(`title ${uml(title)}`);
  if (model.direction === 'LR' || model.direction === 'RL') lines.push('left to right direction');
  const box = (n, pad) => `${pad}${UML_SHAPE[n.shape] ?? 'component'} "${uml(n.label) || uml(n.id)}" as ${alias.node.get(n.id)}`;
  for (const l of model.layers) {
    lines.push(`${wrapper} "${uml(l.name) || uml(l.id)}" as ${alias.layer.get(l.id)} {`);
    for (const n of model.nodes.filter((x) => x.layer === l.id)) lines.push(box(n, '  '));
    lines.push('}');
  }
  for (const n of model.nodes.filter((x) => !alias.layer.has(x.layer))) lines.push(box(n, ''));
  for (const e of model.edges) {
    if (!alias.node.has(e.from) || !alias.node.has(e.to)) continue;
    lines.push(`${alias.node.get(e.from)} ${UML_ARROW[e.kind] ?? '-->'} ${alias.node.get(e.to)}${e.label ? ` : ${uml(e.label)}` : ''}`);
  }
  lines.push('@enduml');
  return `${lines.join('\n')}\n`;
}

// A component diagram: a package per layer.
export const plantumlOf = (text, title) => {
  const model = modelOf(text);
  return model ? plantuml(model, title, 'package') : null;
};

// A deployment diagram: a node per layer, a database for what lives on this computer, a cloud for what is outside. Only
// when the diagram says where something runs (a database or an outside service box); null otherwise.
export const plantumlDeploymentOf = (text, title) => {
  const model = modelOf(text);
  return model?.nodes.some((n) => n.shape === 'db' || n.shape === 'hex') ? plantuml(model, title, 'node') : null;
};

// ---- in the page only ------------------------------------------------------------------------

// What the page's own stylesheet paints on the drawing (the colour of each part, the flags) is not inside the svg, so a
// copy taken out of the page would lose it: each element carries its computed look as inline style.
const LOOK = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];
const SHAPES = 'rect, path, polygon, polyline, circle, ellipse, line, text, tspan';

export function standaloneSvg(live, background) {
  const box = live.viewBox.baseVal;
  const copy = live.cloneNode(true);
  const from = live.querySelectorAll(SHAPES);
  const to = copy.querySelectorAll(SHAPES);
  from.forEach((el, i) => {
    const css = getComputedStyle(el);
    to[i].setAttribute('style', LOOK.map((p) => `${p}:${css.getPropertyValue(p)}`).join(';'));
  });
  for (const el of copy.querySelectorAll('[tabindex], [role], [aria-pressed]')) {
    for (const a of ['tabindex', 'role', 'aria-pressed']) el.removeAttribute(a);
  }
  return { markup: svgDocument(copy.outerHTML, { width: box.width, height: box.height, background }), width: box.width, height: box.height };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A data: address, not a blob one, so the canvas is not marked as tainted by what it drew.
export function svgToPng(markup, width, height) {
  const size = pngSize(width, height);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png-failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('png-failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}
