// The Flow tab (plano-v02 § v0.2.1): the architecture's mermaid diagram with its boxes tied to the parts, export and
// import, and the workshop where the person and the side chat draw one shared draft. The pure part on top is what
// node:test loads; createFlowView below touches the DOM only when called.
import { api } from './api.js';
import { createChat } from './chat.js';
import { addBox, addLayer, connect, matchParts, moveToLayer, parseFlow, printFlow, removeNode, rename } from './flow.js';
import { exportFileName, isAutoDraft, markdownOf, saveBlob, standaloneSvg, svgToPng } from './flowexport.js';
import { drawGrid, gridLayout, pageMeasure } from './flowgrid.js';
import { boxTitle, exportTextFor, factRows, journeyChoices, legendKeys, legendWords, level1Flow, levelNote, nodeName } from './flowlevel.js';
import { createResizer } from './resize.js';
import { nodeById } from './tree.js';

const HISTORY_MAX = 100;
const SAVE_MS = 500;
const EDIT_MS = 350;
const TEXT_MAX = 60_000;
const CHAT_WIDTH = 460;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MODEL_RECHECK_MS = 20_000;
const MODEL_WAIT_MS = 1500;
const MODEL_WAIT_MAX = 20;

// The tab opens on the general view; the person's last choice is kept on this browser.
export const levelOf = (saved) => (saved === 'parts' ? 'parts' : '1');

// What a part's box says at a glance: a chat working there now beats items in progress, then all done, then still to do.
export function partTone(counts, live) {
  if (live) return 'live';
  if (counts.doing > 0) return 'doing';
  return counts.total > 0 && counts.done === counts.total ? 'done' : 'todo';
}

export function partFlags(counts) {
  return [counts.blocks > 0 ? 'blocks' : null, counts.withUser > 0 ? 'waiting' : null].filter(Boolean);
}

export const historyStart = (text) => ({ past: [], now: text, future: [] });

export function historyPush(h, text) {
  if (text === h.now) return h;
  return { past: [...h.past, h.now].slice(-HISTORY_MAX), now: text, future: [] };
}

export function historyUndo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), now: h.past.at(-1), future: [h.now, ...h.future] };
}

export function historyRedo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) };
}

// A workshop reply ends with the whole draft: the chat shows a short mark there (also while the fence is still open).
export const foldMermaid = (text, label) => String(text ?? '').replace(/```mermaid[ \t]*\r?\n[\s\S]*?(?:```|$)/g, label);

// mermaid names a node's group "flowchart-<id>-<n>", with the render's own prefix in front in some versions.
export function svgNodeId(domId, ids) {
  const m = /flowchart-(.+)-\d+$/.exec(String(domId ?? ''));
  return m && ids.has(m[1]) ? m[1] : null;
}

export const mmdFileName = (projectName) => exportFileName(projectName, 'mmd');

// ---- mermaid: the vendored copy, loaded the first time the tab draws -------------------------

let mermaidLoad = null;
function loadMermaid() {
  mermaidLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/mermaid.min.js';
    script.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid-missing')));
    script.onerror = () => { mermaidLoad = null; reject(new Error('mermaid-load')); };
    document.head.append(script);
  });
  return mermaidLoad;
}

// The diagram in the page's own colours: quiet layers, so the colour of each part's situation is what stands out.
function themeVariables() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    darkMode: matchMedia('(prefers-color-scheme: dark)').matches,
    background: v('--canvas'),
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontSize: '14px',
    primaryColor: v('--bg-2'),
    primaryBorderColor: v('--wire'),
    primaryTextColor: v('--ink'),
    nodeTextColor: v('--ink'),
    secondaryColor: v('--bg-3'),
    tertiaryColor: v('--bg-2'),
    lineColor: v('--wire'),
    clusterBkg: v('--bg'),
    clusterBorder: v('--line'),
    titleColor: v('--ink-2'),
    edgeLabelBackground: v('--canvas'),
  };
}

let renderSeq = 0;
// On a phone a left-to-right drawing turns top-to-bottom, for the screen only: what is copied or saved stays as written.
const forScreen = (text, phone) => (phone ? text.replace(/^(\s*(?:flowchart|graph))\s+(LR|RL)\s*;?\s*$/im, '$1 TB') : text);

// mermaid 11 lays a subgraph with no arrow in or out apart from the rest and far away, which turns ten boxes into a
// drawing of 3000 px with an empty middle. An invisible link to the neighbouring layer keeps it in the layout; it is
// added for the drawing only, never to what is copied, saved or applied.
export function forLayout(text) {
  const m = parseFlow(text);
  if (!m.ok) return text;
  const groups = m.layers.map((l) => m.nodes.filter((n) => n.layer === l.id)).filter((g) => g.length);
  if (groups.length < 2) return text;
  const layerOf = new Map(m.nodes.map((n) => [n.id, n.layer]));
  const crossed = new Set();
  for (const e of m.edges) {
    const a = layerOf.get(e.from) ?? null, b = layerOf.get(e.to) ?? null;
    if (a !== b) crossed.add(a).add(b);
  }
  const alone = groups.map((g) => !crossed.has(g[0].layer));
  const ties = [];
  for (let i = 1; i < groups.length; i++) if (alone[i] || alone[i - 1]) ties.push(`  ${groups[i - 1].at(-1).id} ~~~ ${groups[i][0].id}`);
  return ties.length ? `${text}\n${ties.join('\n')}` : text;
}

// spacing: the general view is laid out a little tighter, so its six columns fit the screen at a larger size.
async function renderMermaid(el, text, phone, spacing = { nodeSpacing: 34, rankSpacing: 54 }) {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    flowchart: { curve: 'basis', htmlLabels: false, useMaxWidth: true, ...spacing, padding: 14, diagramPadding: 14 },
  });
  const id = `flow-svg-${++renderSeq}`;
  const mine = String(renderSeq);
  el.dataset.render = mine;
  try {
    const { svg } = await mermaid.render(id, forLayout(forScreen(text, phone)));
    if (el.dataset.render !== mine) return { ok: false, stale: true };
    // mermaid's own output, sanitized by it under securityLevel strict: no script, no click handlers, no raw HTML labels.
    el.innerHTML = svg;
    return { ok: true, svg: el.querySelector('svg') };
  } catch (err) {
    document.getElementById(`d${id}`)?.remove();
    return { ok: false, error: String(err?.message ?? err).split('\n').find((l) => l.trim()) ?? 'error' };
  }
}

// mermaid's viewBox can be far larger than what it drew, which shrinks the drawing into a corner: the box is measured
// again from the drawing itself, which then fills the width it has, up to ZOOM_MAX times its own size.
const ZOOM_MAX = 1.6;
const ZOOM_MIN = 0.8;
const FIT_PAD = 12;
// It grows only while the whole drawing still fits the height of the area; minZoom is how small it may get.
function fitWidth(svg, area, minZoom = ZOOM_MIN) {
  const content = svg?.querySelector(':scope > g');
  if (!content) return;
  const box = content.getBBox();
  if (!box.width || !box.height) return;
  const w = box.width + 2 * FIT_PAD;
  const h = box.height + 2 * FIT_PAD;
  svg.setAttribute('viewBox', [box.x - FIT_PAD, box.y - FIT_PAD, w, h].map((n) => Math.round(n)).join(' '));
  svg.setAttribute('width', '100%');
  svg.removeAttribute('height');
  const css = getComputedStyle(area);
  const room = area.clientHeight - Number.parseFloat(css.paddingTop) - Number.parseFloat(css.paddingBottom);
  const byHeight = room > 0 ? room * (w / h) : Number.POSITIVE_INFINITY;
  svg.style.maxWidth = `${Math.round(Math.min(w * ZOOM_MAX, byHeight))}px`;
  // A drawing wider than the area scrolls sideways instead of shrinking past reading size.
  svg.style.minWidth = minZoom ? `${Math.round(w * minZoom)}px` : '';
}

// The zoom of the view: null is "the whole drawing fits the area"; a number is how many screen pixels per drawing pixel.
export const ZOOM_STEP = 1.25;
export const ZOOM_RANGE = [0.15, 3];
export function nextZoom(current, dir) {
  const [lo, hi] = ZOOM_RANGE;
  const z = dir > 0 ? current * ZOOM_STEP : current / ZOOM_STEP;
  return Math.min(hi, Math.max(lo, Math.round(z * 1000) / 1000));
}

// mermaid names an arrow's path "L_<from>_<to>_<n>", n how many links between the same two boxes, in the same
// direction, come before it in the text. The layout copy of the general view writes a backward arrow the other way
// round; this is the path id to find it by.
export function edgePathId(edges, index) {
  const e = edges[index];
  const n = edges.slice(0, index).filter((x) => x.from === e.from && x.to === e.to).length;
  return `L_${e.from}_${e.to}_${n}`;
}

// Where a drawing wider than its area opens: on the first group written in the text (mermaid may lay it out far right).
// clusters: {id, left} with left measured from the drawing's left edge; max: how far the area can scroll.
export function startScroll(layerIds, clusters, { max, pad = FIT_PAD }) {
  const first = layerIds.map((id) => clusters.find((c) => c.id === id)).find(Boolean);
  return first ? Math.min(max, Math.max(0, Math.round(first.left - pad))) : 0;
}

const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: the choice just is not kept */ }
}

// ctx: h, t (translator getter), toast, errorText, relative, project(), tree(), live() (the lit node ids), phone
// (matchMedia), confirm, onOpenPart(partId), onApplied() (files were written), openSettings(binding, opener) and
// onRunChange() (Configurações, pc19), waitingOf(sessionId) (the pill's rule, for the chat's dot).
export function createFlowView(ctx) {
  const { h, toast, errorText } = ctx;
  const t = () => ctx.t();
  const root = document.getElementById('view-flow');
  const $ = (sel) => root.querySelector(sel);
  const canvas = $('#flowCanvas');
  const legend = $('#flowLegend');
  const form = $('#flowForm');
  const editor = $('#flowSourceText');
  const editorError = $('#flowEditorError');
  const savedEl = $('#flowSaved');
  const dialog = document.getElementById('flowDialog');
  const chatToggle = $('#flowChatToggle');

  let mode = 'view';
  let visible = false;
  let exportText = null;
  let exportKey = null;
  let exportError = null;
  let hist = null;
  let draftFor = null;
  let savedText = null;
  let saveTimer = 0;
  let editTimer = 0;
  let selected = null;
  let tool = null;
  let textOpen = false;
  let lastModel = null;
  let lastMeta = null;
  let level = levelOf(safeGet('sm.flowLevel'));
  let drawnLevel = 'parts';
  let flowModel = null;
  let modelKey = null;
  let modelAt = 0;
  let modelStamp = null;
  let modelWaitTimer = 0;
  let journey = '';
  let showHidden = false;
  let l1 = null;
  let failedNote = false;
  let zoom = null;
  let zoomKey = null;

  const project = () => ctx.project();
  const model = () => parseFlow(hist?.now ?? '');
  const archKey = (p) => JSON.stringify([p.id, p.arch.source, p.arch.mermaid, p.arch.layers, p.arch.parts.map((x) => [x.id, x.name]), p.arch.links?.map((l) => [l.a, l.b])]);

  const chat = createChat({
    root: $('#flowChat'), h, t, toast, errorText, relative: ctx.relative, money: ctx.money, savedKey: null,
    openSettings: ctx.openSettings, onRunChange: ctx.onRunChange, safety: 'flow.chatSafety', waitingOf: ctx.waitingOf,
    lang: ctx.lang, icon: ctx.icon, commands: ctx.commands,
    onDraft: (text) => {
      if (!hist || text === hist.now) return;
      hist = historyPush(hist, text);
      savedText = text;
      savedEl.textContent = t()('flow.redrawn');
      renderWorkshop();
    },
    beforeSend: () => flushSave(),
    showText: (text) => foldMermaid(text, t()('flow.chatDiagram')),
    onClose: () => chatToggle.setAttribute('aria-expanded', 'false'),
  });
  createResizer({ sheet: $('#flowChat'), handle: $('#flowChatResize'), target: root, cssVar: '--flow-chat-w', storageKey: 'sm.flowChatWidth', defaultWidth: () => CHAT_WIDTH });

  // ---- the header --------------------------------------------------------------------------

  function renderHead() {
    const tt = t();
    const p = project();
    $('#flowTitle').textContent = tt('flow.title', { name: p.name });
    const src = $('#flowSource');
    const arch = p.arch;
    let words;
    if (arch.source === 'none') words = tt('flow.source.none');
    else if (arch.mermaid) words = tt('flow.source.readme', { file: `${arch.dir}/README.md` });
    else words = tt('flow.source.layers');
    src.replaceChildren(words, arch.source === 'main-branch' ? ` ${tt('flow.source.main')}` : '');
    $('#flowAuto').hidden = mode !== 'view' || !isAutoDraft(arch);
    for (const b of root.querySelectorAll('.fl-levels button')) b.setAttribute('aria-pressed', String(b.dataset.level === level));
    for (const b of root.querySelectorAll('.fl-modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    root.dataset.mode = mode;
    $('#flowTools').hidden = mode !== 'workshop';
    const none = arch.source === 'none';
    const nothing = mode === 'view' && (none || !currentText());
    $('#flowCopy').disabled = nothing;
    $('#flowExportBtn').setAttribute('aria-disabled', String(nothing));
    if (nothing) $('#flowExport').open = false;
  }

  // ---- the diagram as the project has it ---------------------------------------------------

  async function loadExport(force = false) {
    const p = project();
    const key = archKey(p);
    if (!force && key === exportKey) return;
    exportKey = key;
    if (p.arch.source === 'none') {
      exportText = null;
      exportError = null;
      return;
    }
    const res = await api.flowExport(p.id);
    if (exportKey !== key) return;
    exportText = res.ok ? res.text : null;
    exportError = res.ok ? null : res.error;
  }

  // The single model behind the general view. It is built on the server; while it is still being worked out the page
  // asks again a few times and redraws only when the model really changed (its stamp).
  async function loadModel(force = false, attempt = 0) {
    const p = project();
    const key = archKey(p);
    if (!force && key === modelKey && flowModel) return;
    modelKey = key;
    clearTimeout(modelWaitTimer);
    if (p.arch.source === 'none') { flowModel = null; return; }
    const res = await api.flowModel(p.id);
    if (modelKey !== key) return;
    modelAt = Date.now();
    flowModel = res.ok && res.model?.nodes ? res.model : null;
    if (flowModel && res.building && attempt < MODEL_WAIT_MAX) {
      modelWaitTimer = setTimeout(async () => {
        if (!visible || modelKey !== key) return;
        const before = modelStamp;
        await loadModel(true, attempt + 1);
        if (visible && mode === 'view' && level === '1' && flowModel && flowModel.stamp !== before) renderView();
      }, MODEL_WAIT_MS);
    }
  }

  function emptyState() {
    const tt = t();
    return h('div', { class: 'fl-empty' },
      h('h3', {}, tt('flow.empty.title')),
      h('p', {}, tt('flow.empty.lede')),
      h('p', { class: 'muted' }, tt('flow.empty.safe')),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => askToDraw() }, tt('flow.ask'))));
  }

  function toneWords(tone, flags) {
    const tt = t();
    return [tt(`flow.tone.${tone}`), ...flags.map((f) => tt(`flow.flag.${f}`))].join(' · ');
  }

  // Ties each drawn box to its part: colour by situation, marks for blockers and people waiting, a title, and a click
  // (view: open the part beside the diagram; workshop: pick the box for the tools).
  function decorate(svg, drawn, meta = null) {
    const ids = new Set(drawn.nodes.map((n) => n.id));
    const p = project();
    const match = matchParts(drawn, p.arch.parts);
    const tt = t();
    const tree = ctx.tree();
    const live = ctx.live();
    const workshop = mode === 'workshop';
    for (const g of svg.querySelectorAll('g.node')) {
      const nodeId = g.dataset.id && ids.has(g.dataset.id) ? g.dataset.id : svgNodeId(g.id, ids);
      if (!nodeId) continue;
      const node = drawn.nodes.find((n) => n.id === nodeId);
      const info = meta?.nodes.get(nodeId) ?? null;
      const partId = meta ? info?.partId : match.get(nodeId);
      const outside = info && (info.kind === 'actor' || info.kind === 'service');
      const part = partId ? p.arch.parts.find((x) => x.id === partId) : null;
      g.dataset.flowNode = nodeId;
      g.classList.add(part ? 'fl-part' : outside ? (info.kind === 'actor' ? 'fl-actor' : info.where === 'this-pc' ? 'fl-local' : 'fl-svc') : 'fl-free');
      let label = node.label;
      if (part) {
        const counts = nodeById(tree, `pt:${partId}`)?.counts ?? { total: 0, done: 0, doing: 0, withUser: 0, blocks: 0 };
        const tone = partTone(counts, live.has(`pt:${partId}`));
        const flags = partFlags(counts);
        g.classList.add(`fl-${tone}`);
        label = `${part.name}: ${toneWords(tone, flags)}`;
        if (info) label = `${boxTitle(info, part.name, tt)} · ${toneWords(tone, flags)}`;
        const box = g.getBBox();
        flags.forEach((f, i) => g.append(svgEl('circle', { class: `fl-flag fl-flag-${f}`, cx: box.x + box.width - 2 - i * 13, cy: box.y + 2, r: 5.5 })));
      } else if (outside) label = boxTitle(info, node.label, tt);
      else label = `${node.label}: ${t()('flow.tone.free')}`;
      const title = svgEl('title', {});
      title.textContent = label;
      g.prepend(title);
      if (!workshop && !part) continue;
      if (outside) continue;
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', workshop ? t()('flow.pick', { name: node.label }) : t()('flow.open', { name: label }));
      if (part) g.dataset.partId = partId;
      if (workshop) {
        g.setAttribute('aria-pressed', String(selected === nodeId));
        g.classList.toggle('is-picked', selected === nodeId);
      }
    }
  }

  // One listener for every box, so a redraw or a recolour never stacks handlers.
  function actOn(target) {
    const g = target.closest?.('g.node[role="button"]');
    if (!g || !canvas.contains(g)) return false;
    if (mode === 'workshop') pick(g.dataset.flowNode);
    else if (g.dataset.partId) ctx.onOpenPart(g.dataset.partId);
    return true;
  }
  canvas.addEventListener('click', (e) => actOn(e.target));
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && actOn(e.target)) e.preventDefault();
  });

  function renderLegend() {
    const tt = t();
    const keys = mode === 'workshop' ? [] : legendKeys(level === '1' && flowModel && !failedNote ? '1' : 'parts');
    legend.replaceChildren(...keys.map((k) => h('li', { class: `lg lg-${k}` }, h('span', { class: 'lg-mark', 'aria-hidden': 'true' }), legendWords(k, tt))));
    legend.hidden = !keys.length;
  }

  // The size of the drawing: the workshop keeps reading size and scrolls; the view opens with the whole drawing in the
  // area, and the zoom buttons take it from there.
  function sizeDrawing(svg) {
    if (mode === 'workshop') return fitWidth(svg, canvas);
    fitWidth(svg, canvas, 0);
    if (zoom == null) return undefined;
    const w = svg.viewBox.baseVal?.width;
    if (!w) return undefined;
    svg.setAttribute('width', String(Math.round(w * zoom)));
    svg.style.maxWidth = 'none';
    svg.style.minWidth = '';
    return undefined;
  }

  function zoomBy(dir) {
    const svg = canvas.querySelector('svg');
    const w = svg?.viewBox.baseVal?.width;
    if (!w) return;
    const now = svg.getBoundingClientRect().width / w;
    const cx = (canvas.scrollLeft + canvas.clientWidth / 2) / Math.max(1, canvas.scrollWidth);
    const cy = (canvas.scrollTop + canvas.clientHeight / 2) / Math.max(1, canvas.scrollHeight);
    zoom = dir === 0 ? null : nextZoom(zoom ?? now, dir);
    sizeDrawing(svg);
    canvas.scrollLeft = dir === 0 ? 0 : cx * canvas.scrollWidth - canvas.clientWidth / 2;
    canvas.scrollTop = dir === 0 ? 0 : cy * canvas.scrollHeight - canvas.clientHeight / 2;
  }

  // The general view lays out a copy where backward arrows are written the other way round: their heads go back to
  // where the facts say. Arrows drawn once for several parts name the others on hover.
  function finishEdges(svg, drawn, meta) {
    const tt = t();
    const labels = [...svg.querySelectorAll('g.edgeLabel')];
    const squash = (s) => String(s ?? '').replace(/\s+/g, '');
    const inOrder = labels.length >= drawn.edges.length && drawn.edges.every((e, i) => squash(labels[i].textContent) === squash(e.label));
    drawn.edges.forEach((e, i) => {
      const m = meta.edges[i];
      if (!m) return;
      const path = svg.querySelector(`path[id="${CSS.escape(edgePathId(drawn.edges, i))}"]`);
      if (m.reversed && path) {
        const end = path.getAttribute('marker-end');
        if (end) {
          path.setAttribute('marker-start', end.replace(/End\)$/, 'Start)'));
          path.removeAttribute('marker-end');
        }
      }
      const names = (m.also ?? []).map((id) => nodeNameOf(id)).filter(Boolean);
      if (!names.length) return;
      const words = [e.label, tt('flow.l1.also', { names: names.join(', ') })].filter(Boolean).join(' · ');
      for (const el of [path, inOrder ? labels[i] : null]) {
        if (!el) continue;
        const title = svgEl('title', {});
        title.textContent = words;
        el.prepend(title);
      }
    });
  }
  const nodeNameOf = (id) => {
    const n = flowModel?.nodes?.find((x) => x.id === id);
    return n ? nodeName(n, t()) : null;
  };

  async function draw(text, meta = null) {
    const res = await renderMermaid(canvas, text, ctx.phone.matches, meta ? { nodeSpacing: 24, rankSpacing: 40 } : undefined);
    if (res.stale) return;
    if (!res.ok) {
      canvas.replaceChildren(h('div', { class: 'fl-error', role: 'alert' }, h('p', {}, t()('flow.drawFailed')), h('details', {}, h('summary', {}, t()('tech.details')), h('code', {}, res.error))));
      return;
    }
    sizeDrawing(res.svg);
    lastModel = parseFlow(text);
    lastMeta = meta;
    if (lastModel.ok) decorate(res.svg, lastModel, meta);
    if (lastModel.ok && meta?.edges) finishEdges(res.svg, lastModel, meta);
    // Only the diagram opens on its first group: the workshop redraws on every edit and keeps where the person scrolled.
    if (lastModel.ok && mode === 'view') {
      const left = canvas.getBoundingClientRect().left - canvas.scrollLeft;
      const clusters = [...res.svg.querySelectorAll('g.cluster')].map((g) => ({ id: g.id, left: g.getBoundingClientRect().left - left }));
      canvas.scrollLeft = startScroll(lastModel.layers.map((l) => l.id), clusters, { max: canvas.scrollWidth - canvas.clientWidth });
    }
  }

  // The general view is laid out by session-map itself (flowgrid.js), top to bottom like a C4 diagram; if that ever
  // fails, mermaid draws the same view as before.
  async function drawGeneral(view) {
    let svg = null;
    try {
      const layout = gridLayout(view.scene, { measure: pageMeasure(getComputedStyle(document.body).fontFamily) });
      svg = drawGrid(layout, { idPrefix: `flg${++renderSeq}`, titleOf: (p) => edgeWords(p, view.meta) });
    } catch {
      svg = null;
    }
    if (!svg) return draw(view.drawText, view.meta);
    canvas.dataset.render = String(renderSeq);
    canvas.replaceChildren(svg);
    sizeDrawing(svg);
    lastModel = { ...view.flow, ok: true };
    lastMeta = view.meta;
    decorate(svg, lastModel, view.meta);
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    return undefined;
  }

  // The hover words of an arrow: its label, and the other parts an arrow drawn once for several stands for.
  function edgeWords(p, meta) {
    const names = (meta.edges[p.index]?.also ?? []).map((id) => nodeNameOf(id)).filter(Boolean);
    return [p.text, names.length ? t()('flow.l1.also', { names: names.join(', ') }) : ''].filter(Boolean).join(' · ');
  }

  async function renderView() {
    if (mode !== 'view') return;
    renderHead();
    renderLegend();
    const p = project();
    if (p.arch.source === 'none') {
      canvas.replaceChildren(emptyState());
      legend.hidden = true;
      return;
    }
    failedNote = false;
    // A drawing opens whole: on a new project, level or mode the zoom goes back to "fit".
    const zk = `${p.id}|${level}|${mode}`;
    if (zk !== zoomKey) { zoomKey = zk; zoom = null; }
    if (level === '1') {
      if (!flowModel) canvas.replaceChildren(h('p', { class: 'fl-loading' }, t()('flow.loading')));
      await loadModel();
      if (mode !== 'view' || level !== '1') return;
      if (flowModel) {
        modelStamp = flowModel.stamp ?? null;
        if (journey && !journeyChoices(flowModel, t()).some((j) => j.id === journey)) journey = '';
        l1 = level1Flow(flowModel, { journey: journey || null, showHidden, tt: t() });
        drawnLevel = '1';
        renderLegend();
        renderFilters();
        await drawGeneral(l1);
        renderHead();
        return;
      }
      failedNote = true;
      await loadExport();
    }
    drawnLevel = 'parts';
    renderLegend();
    renderFilters();
    if (exportError) {
      canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, errorText(exportError)));
      return;
    }
    if (exportText === null) {
      canvas.replaceChildren(h('p', { class: 'fl-loading' }, t()('flow.loading')));
      return;
    }
    await draw(exportText);
    renderHead();
  }

  // Above the drawing in the general view: the journey filter, the links seen only in the code, a note, and the facts.
  function renderFilters() {
    const tt = t();
    const box = $('#flowFilters');
    const on = mode === 'view' && project().arch.source !== 'none' && (level === '1' || failedNote);
    box.hidden = !on;
    if (!on) return;
    const general = drawnLevel === '1' && Boolean(flowModel);
    for (const el of box.querySelectorAll('.fl-filter-row, .fl-facts')) el.hidden = !general;
    const select = $('#flowJourney');
    const choices = flowModel ? journeyChoices(flowModel, tt) : [];
    select.replaceChildren(h('option', { value: '' }, tt('flow.l1.journey.all')), ...choices.map((c) => h('option', { value: c.id, selected: c.id === journey }, c.label)));
    select.disabled = !choices.length;
    select.value = journey;
    $('#flowJourneyNote').textContent = general && !choices.length ? tt('flow.l1.journey.none') : '';
    $('#flowShowHidden').checked = showHidden;
    const notes = [];
    if (failedNote) notes.push(tt('flow.l1.failed'));
    if (l1 && general) {
      const missing = levelNote(l1.meta, tt);
      if (missing) notes.push(missing);
      if (l1.meta.more.length) notes.push(tt('flow.l1.more', { names: l1.meta.more.map((x) => x.name).join(', ') }));
      for (const n of flowModel.notes ?? []) {
        const key = 'flow.l1.note.' + (n.key ?? n);
        if (tt(key) !== key) notes.push(tt(key));
      }
    }
    $('#flowLevelNote').textContent = notes.join(' ');
    if (general && $('#flowFacts').open) fillFacts($('#flowFactsList'));
  }

  function fillFacts(list) {
    const rows = factRows(flowModel, l1.meta, t());
    list.replaceChildren(...rows.map((r) => h('li', {},
      h('div', { class: 'fl-fact-head' },
        h('span', { class: 'fl-fact-name' }, r.text),
        r.label ? h('span', { class: 'fl-fact-label' }, r.label) : null,
        ...r.badges.map((b) => h('span', { class: 'fl-badge' }, b))),
      r.also?.length ? h('p', { class: 'fl-fact-also' }, t()('flow.l1.also', { names: r.also.join(', ') })) : null,
      r.evidence.length ? h('code', { class: 'fl-fact-code' }, r.evidence.join('  ')) : null)));
  }

  // ---- the workshop ------------------------------------------------------------------------

  async function loadDraft() {
    const p = project();
    if (draftFor === p.id && hist) return;
    draftFor = p.id;
    hist = null;
    selected = null;
    const res = await api.flowDraft(p.id);
    if (draftFor !== p.id) return;
    if (!res.ok) {
      canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, errorText(res.error)));
      return;
    }
    hist = historyStart(res.text);
    savedText = res.saved ? res.text : null;
    savedEl.textContent = res.saved ? t()('flow.draftKept') : '';
  }

  function setDraft(text, { from = 'tool' } = {}) {
    if (!hist) return;
    hist = historyPush(hist, text);
    scheduleSave();
    renderWorkshop({ from });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    savedEl.textContent = t()('flow.saving');
    saveTimer = setTimeout(flushSave, SAVE_MS);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (!hist || hist.now === savedText) return { ok: true };
    const text = hist.now;
    const res = await api.flowSaveDraft(draftFor, text);
    if (res.ok) {
      savedText = text;
      if (hist.now === text) savedEl.textContent = t()('flow.saved');
    } else savedEl.textContent = errorText(res.error);
    return res;
  }

  // A relation from the map, drawn as a dotted "related" arrow between the two parts' boxes in the draft (mm05).
  async function putRelation(partA, partB) {
    await loadDraft();
    if (!hist) return { ok: false, error: 'network' };
    const m = model();
    if (!m.ok) return { ok: false, error: 'not-flowchart' };
    const boxOf = (partId) => [...matchParts(m, project().arch.parts)].find(([, id]) => id === partId)?.[0];
    const from = boxOf(partA), to = boxOf(partB);
    if (!from || !to) return { ok: false, error: 'no-box' };
    const next = connect(m, from, to, null, 'dotted');
    if (next === m) return { ok: true, already: true };
    hist = historyPush(hist, printFlow(next));
    const saved = await flushSave();
    return saved.ok ? { ok: true } : saved;
  }

  function pick(nodeId) {
    selected = selected === nodeId ? null : nodeId;
    for (const g of canvas.querySelectorAll('g.node[data-flow-node]')) {
      const on = g.dataset.flowNode === selected;
      g.classList.toggle('is-picked', on);
      g.setAttribute('aria-pressed', String(on));
    }
    if (tool) renderForm();
  }

  async function renderWorkshop({ from = null } = {}) {
    if (mode !== 'workshop') return;
    renderHead();
    renderLegend();
    $('#flowUndo').disabled = !hist?.past.length;
    $('#flowRedo').disabled = !hist?.future.length;
    $('#flowApply').disabled = !hist;
    $('#flowEditor').hidden = !textOpen;
    $('#flowText').setAttribute('aria-pressed', String(textOpen));
    if (!hist) return;
    const m = model();
    if (selected && !m.nodes?.some((n) => n.id === selected)) selected = null;
    if (from !== 'editor' && textOpen) {
      editor.value = hist.now;
      editorError.textContent = '';
    }
    if (tool) renderForm();
    if (!m.ok) {
      canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, t()('flow.err.not-flowchart')));
      return;
    }
    if (!m.nodes.length) {
      canvas.replaceChildren(h('div', { class: 'fl-empty' }, h('h3', {}, t()('flow.blank.title')), h('p', {}, t()('flow.blank.lede'))));
      return;
    }
    await draw(hist.now);
  }

  const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
  const nodeOptions = (m, value) => m.nodes.map((n) => h('option', { value: n.id, selected: n.id === value }, n.label));
  const layerOptions = (m, value) => [h('option', { value: '' }, t()('flow.noLayer')), ...m.layers.map((l) => h('option', { value: l.id, selected: l.id === value }, l.name))];

  // One small form under the toolbar for the open tool; each applies a pure edit of flow.js to the draft.
  function renderForm() {
    const tt = t();
    const m = model();
    for (const b of root.querySelectorAll('.fl-tool[data-tool]')) b.setAttribute('aria-expanded', String(b.dataset.tool === tool));
    if (!tool || !m.ok) {
      form.hidden = true;
      form.replaceChildren();
      return;
    }
    const pickedNode = m.nodes.find((n) => n.id === selected) ?? null;
    const needsBox = ['connect', 'rename', 'move', 'remove'].includes(tool) && !m.nodes.length;
    const submit = (label, { danger = false } = {}) => h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}`, disabled: needsBox }, label);
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => openTool(null) }, tt('confirm.cancel'));
    let fields = [];
    let run = null;
    if (tool === 'box') {
      const name = h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' });
      const layer = h('select', { name: 'layer' }, layerOptions(m, pickedNode?.layer ?? m.layers.at(-1)?.id ?? ''));
      fields = [field(tt('flow.f.name'), name), field(tt('flow.f.layer'), layer), submit(tt('flow.do.box'))];
      run = () => (name.value.trim() ? addBox(m, name.value, layer.value || null) : null);
    } else if (tool === 'connect') {
      const from = h('select', { name: 'from' }, nodeOptions(m, selected ?? m.nodes[0]?.id));
      const to = h('select', { name: 'to' }, nodeOptions(m, m.nodes.find((n) => n.id !== (selected ?? m.nodes[0]?.id))?.id));
      const what = h('input', { name: 'what', maxlength: 60, autocomplete: 'off', placeholder: tt('flow.f.whatHint') });
      fields = [field(tt('flow.f.from'), from), field(tt('flow.f.to'), to), field(tt('flow.f.what'), what), submit(tt('flow.do.connect'))];
      run = () => (from.value !== to.value ? connect(m, from.value, to.value, what.value.trim() || null) : null);
    } else if (tool === 'layer') {
      const name = h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' });
      fields = [field(tt('flow.f.layerName'), name), submit(tt('flow.do.layer'))];
      run = () => (name.value.trim() ? addLayer(m, name.value) : null);
    } else if (tool === 'rename') {
      const things = [...m.nodes.map((n) => ({ id: n.id, name: n.label })), ...m.layers.map((l) => ({ id: l.id, name: l.name, layer: true }))];
      const first = selected ?? things[0]?.id;
      const what = h('select', { name: 'what' }, things.map((x) => h('option', { value: x.id, selected: x.id === first }, x.layer ? tt('flow.layerOption', { name: x.name }) : x.name)));
      const name = h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off', value: things.find((x) => x.id === first)?.name ?? '' });
      what.addEventListener('change', () => { name.value = things.find((x) => x.id === what.value)?.name ?? ''; });
      fields = [field(tt('flow.f.which'), what), field(tt('flow.f.newName'), name), submit(tt('flow.do.rename'))];
      run = () => (name.value.trim() ? rename(m, what.value, name.value) : null);
    } else if (tool === 'move') {
      const box = h('select', { name: 'box' }, nodeOptions(m, selected ?? m.nodes[0]?.id));
      const layer = h('select', { name: 'layer' }, layerOptions(m, ''));
      fields = [field(tt('flow.f.box'), box), field(tt('flow.f.toLayer'), layer), submit(tt('flow.do.move'))];
      run = () => moveToLayer(m, box.value, layer.value || null);
    } else if (tool === 'remove') {
      const box = h('select', { name: 'box' }, nodeOptions(m, selected ?? m.nodes[0]?.id));
      fields = [field(tt('flow.f.box'), box), h('p', { class: 'fl-form-note' }, tt('flow.removeNote')), submit(tt('flow.do.remove'), { danger: true })];
      run = () => removeNode(m, box.value);
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      const next = run?.();
      if (!next || next === m) return;
      if (tool === 'remove' || tool === 'rename') selected = null;
      setDraft(printFlow(next));
      if (tool === 'box' || tool === 'layer') form.querySelector('input[name="name"]')?.focus();
    };
    form.replaceChildren(...fields, cancel, needsBox ? h('p', { class: 'fl-form-note' }, tt('flow.needBox')) : '');
    form.hidden = false;
  }

  function openTool(name) {
    tool = tool === name ? null : name;
    renderForm();
    if (tool) form.querySelector('input:not([type="hidden"]), select')?.focus();
  }

  function openChat() {
    const p = project();
    chat.open({ projectId: p.id, title: t()('flow.chatTitle'), subtitle: p.name, intro: t()('flow.chatIntro'), start: { node: { kind: 'flow' } } });
    chatToggle.setAttribute('aria-expanded', 'true');
  }

  // A project without a diagram: the workshop opens with the request to draw it ready in the chat.
  async function askToDraw() {
    await setMode('workshop');
    if (!chat.isOpen()) openChat();
    const input = $('#flowChatInput');
    input.value = t()('flow.askText');
    input.focus();
  }

  async function setMode(next) {
    mode = next === 'workshop' ? 'workshop' : 'view';
    selected = null;
    if (mode === 'view') {
      tool = null;
      renderForm();
      await flushSave();
      chat.close();
      ctx.onModeChange?.(mode);
      return renderView();
    }
    ctx.onModeChange?.(mode);
    renderHead();
    await loadDraft();
    if (!ctx.phone.matches && !chat.isOpen()) openChat();
    return renderWorkshop();
  }

  // ---- export --------------------------------------------------------------------------------

  const currentText = () => (mode === 'workshop' ? hist?.now : exportTextFor(drawnLevel, exportText, l1?.text));

  async function copyText() {
    const text = currentText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(t()('flow.copied'));
    } catch {
      toast(t()('flow.copyFailed'));
    }
  }

  // The drawing as it is on screen (SVG, PNG) or the mermaid text behind it (Markdown, .mmd). One click, one file.
  async function exportAs(kind) {
    const name = project().name;
    const text = currentText();
    const svg = canvas.querySelector('svg');
    const done = (file) => toast(t()('flow.exported', { name: file }));
    try {
      if (kind === 'mmd' || kind === 'md') {
        if (!text) return;
        const file = exportFileName(name, kind);
        const body = kind === 'md' ? markdownOf(name, text, t()('flow.mode.view')) : `${text}
`;
        saveBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), file);
        done(file);
        return;
      }
      if (!svg) return;
      const { markup, width, height } = standaloneSvg(svg, getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#ffffff');
      const file = exportFileName(name, kind);
      saveBlob(kind === 'svg' ? new Blob([markup], { type: 'image/svg+xml' }) : await svgToPng(markup, width, height), file);
      done(file);
    } catch {
      toast(t()('flow.exportFailed'));
    }
  }

  // ---- import: paste or a .mmd → preview → confirm → apply ----------------------------------

  const flowError = (code) => {
    const key = `flow.err.${code}`;
    const tt = t();
    return tt(key) !== key ? tt(key) : errorText(code);
  };

  function openImport({ text = '', fromDraft = false } = {}) {
    if (fromDraft) return showPreview(text, { fromDraft });
    const tt = t();
    const area = h('textarea', { id: 'flowImportText', rows: 10, spellcheck: 'false', maxlength: TEXT_MAX, placeholder: 'flowchart LR\n  a["…"] --> b["…"]' });
    area.value = text;
    const status = h('p', { class: 'fl-dialog-status', role: 'status' });
    const file = h('input', { type: 'file', accept: '.mmd,.md,.txt,text/plain', class: 'visually-hidden', id: 'flowImportFile' });
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      if (chosen.size > TEXT_MAX * 4) { status.textContent = tt('flow.err.too-large'); return; }
      area.value = (await chosen.text()).slice(0, TEXT_MAX);
      status.textContent = tt('flow.fileRead', { name: chosen.name });
    });
    dialog.replaceChildren(h('form', { method: 'dialog', class: 'fl-import' },
      h('h2', { id: 'flowDialogTitle' }, tt('flow.importTitle')),
      h('p', { class: 'fl-dialog-lede' }, tt('flow.importLede')),
      h('label', { class: 'field' }, h('span', {}, tt('flow.importPaste')), area),
      h('div', { class: 'fl-file' }, file, h('label', { class: 'btn', for: 'flowImportFile' }, h('span', {}, tt('flow.importFile'))), status),
      h('div', { class: 'actions' },
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('confirm.cancel')),
        h('button', { type: 'button', class: 'btn primary', onclick: () => (area.value.trim() ? showPreview(area.value) : (status.textContent = tt('flow.importEmpty'))) }, tt('flow.previewBtn')))));
    if (!dialog.open) dialog.showModal();
    area.focus();
    return undefined;
  }

  function changeList(title, rows, note) {
    if (!rows.length) return null;
    return h('section', { class: 'fl-change' }, h('h3', {}, title, h('span', { class: 'fl-count num' }, String(rows.length))), note ? h('p', { class: 'fl-change-note' }, note) : null, h('ul', {}, rows));
  }

  async function showPreview(text, { fromDraft = false } = {}) {
    const tt = t();
    const p = project();
    dialog.replaceChildren(h('div', { class: 'fl-import' }, h('h2', { id: 'flowDialogTitle' }, tt('flow.previewTitle')), h('p', { class: 'fl-loading' }, tt('flow.loading'))));
    if (!dialog.open) dialog.showModal();
    const plan = await api.flowPreview(p.id, text);
    const back = fromDraft ? null : h('button', { type: 'button', class: 'btn', onclick: () => openImport({ text }) }, tt('flow.back'));
    const close = h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt(plan.ok && plan.unchanged ? 'flow.close' : 'confirm.cancel'));
    if (!plan.ok) {
      dialog.replaceChildren(h('div', { class: 'fl-import' }, h('h2', { id: 'flowDialogTitle' }, tt('flow.previewTitle')), h('p', { class: 'dv-warning', role: 'alert' }, flowError(plan.error)), h('div', { class: 'actions' }, h('span', { class: 'grow' }), back, close)));
      return;
    }
    const arrow = (e) => h('li', {}, e.from, h('span', { class: 'fl-arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'visually-hidden' }, ` ${tt('flow.to')} `), e.to);
    const skip = new Set();
    const newRows = plan.partsNew.map((n) => {
      const box = h('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? skip.delete(n.nodeId) : skip.add(n.nodeId)) });
      return h('li', {}, h('label', { class: 'fl-check' }, box, h('span', {}, h('strong', {}, n.name), n.layer ? h('span', { class: 'muted' }, ` · ${n.layer}`) : null, h('code', { class: 'fl-path' }, n.file))));
    });
    const preview = h('div', { class: 'fl-preview', 'aria-label': tt('flow.previewDrawing'), role: 'img' });
    const mainBranch = p.arch.source === 'main-branch';
    const applyBtn = h('button', { type: 'button', class: 'btn primary', disabled: plan.unchanged || mainBranch }, tt('flow.applyBtn'));
    const status = h('p', { class: 'fl-dialog-status', role: 'status' });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      status.textContent = tt('flow.applying');
      const res = await api.flowApply(p.id, text, [...skip]);
      if (!res.ok) {
        status.textContent = flowError(res.error);
        applyBtn.disabled = false;
        return;
      }
      dialog.close();
      toast(res.files.length ? t().count('flow.applied', res.files.length) : tt('flow.appliedNone'));
      exportKey = null;
      ctx.onApplied?.();
      if (mode === 'view') { await loadExport(true); renderView(); }
    });
    const dir = p.arch.source === 'worktree' ? p.arch.dir : p.arch.lang === 'pt' ? 'docs/arquitetura' : 'docs/architecture';
    dialog.replaceChildren(h('div', { class: 'fl-import' },
      h('h2', { id: 'flowDialogTitle' }, tt('flow.previewTitle')),
      plan.unchanged
        ? h('p', { class: 'fl-dialog-lede' }, tt('flow.unchanged'))
        : h('p', { class: 'fl-dialog-lede' }, tt('flow.previewLede', { dir })),
      preview,
      h('div', { class: 'fl-changes' },
        changeList(tt('flow.ch.partsNew'), newRows, tt('flow.ch.partsNewNote')),
        changeList(tt('flow.ch.layersNew'), plan.layersNew.map((l) => h('li', {}, l.name))),
        changeList(tt('flow.ch.partsMoved'), plan.partsMoved.map((m) => h('li', {}, h('strong', {}, m.name), ' ', tt('flow.movedFromTo', { from: m.from ?? tt('flow.noLayer'), to: m.to ?? tt('flow.noLayer') })))),
        changeList(tt('flow.ch.partsMissing'), plan.partsMissing.map((m) => h('li', {}, m.name)), tt('flow.ch.partsMissingNote')),
        changeList(tt('flow.ch.edgesAdded'), plan.edgesAdded.map(arrow)),
        changeList(tt('flow.ch.edgesRemoved'), plan.edgesRemoved.map(arrow)),
        changeList(tt('flow.ch.edgesRelations'), (plan.edgesFromRelations ?? []).map(arrow), tt('flow.ch.edgesRelationsNote')),
        plan.diagramChanged ? h('section', { class: 'fl-change' }, h('h3', {}, tt('flow.ch.diagram')), h('p', { class: 'fl-change-note' }, tt('flow.ch.diagramNote'))) : null,
        changeList(tt('flow.ch.warnings'), plan.warnings.map((w) => h('li', {}, h('code', {}, w.text))), tt('flow.ch.warningsNote'))),
      mainBranch ? h('p', { class: 'dv-warning' }, tt('flow.err.arch-not-here')) : null,
      status,
      h('div', { class: 'actions' }, back, h('span', { class: 'grow' }), close, plan.unchanged ? null : applyBtn)));
    renderMermaid(preview, text, ctx.phone.matches).then((res) => {
      if (res.ok) fitWidth(res.svg, preview, 0);
      if (!res.ok && !res.stale) preview.replaceChildren(h('div', { class: 'fl-error' }, h('p', {}, t()('flow.drawFailed')), h('details', {}, h('summary', {}, t()('tech.details')), h('code', {}, res.error))));
    }).catch(() => preview.replaceChildren(h('p', { class: 'fl-error' }, t()('flow.mermaidFailed'))));
    (plan.unchanged ? close : applyBtn.disabled ? close : applyBtn).focus();
  }

  // ---- wiring --------------------------------------------------------------------------------

  for (const b of root.querySelectorAll('.fl-modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const b of root.querySelectorAll('.fl-tool[data-tool]')) b.addEventListener('click', () => openTool(b.dataset.tool));
  for (const b of root.querySelectorAll('.fl-levels button')) {
    b.addEventListener('click', () => {
      const next = levelOf(b.dataset.level);
      if (next === level) return;
      level = next;
      safeSet('sm.flowLevel', level);
      renderView();
    });
  }
  $('#flowZoomIn').addEventListener('click', () => zoomBy(1));
  $('#flowZoomOut').addEventListener('click', () => zoomBy(-1));
  $('#flowZoomFit').addEventListener('click', () => zoomBy(0));
  $('#flowJourney').addEventListener('change', (e) => { journey = e.target.value; renderView(); });
  $('#flowShowHidden').addEventListener('change', (e) => { showHidden = e.target.checked; renderView(); });
  $('#flowFacts').addEventListener('toggle', () => { if ($('#flowFacts').open && l1 && flowModel && drawnLevel === '1') fillFacts($('#flowFactsList')); });
  $('#flowCopy').addEventListener('click', copyText);
  const exportMenu = $('#flowExport');
  $('#flowExportBtn').addEventListener('click', (e) => { if ($('#flowExportBtn').getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  exportMenu.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-export]')?.dataset.export;
    if (!kind) return;
    exportMenu.open = false;
    exportAs(kind);
  });
  document.addEventListener('click', (e) => { if (exportMenu.open && !exportMenu.contains(e.target)) exportMenu.open = false; });
  exportMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && exportMenu.open) { exportMenu.open = false; $('#flowExportBtn').focus(); } });
  $('#flowAutoImprove').addEventListener('click', () => askToDraw());
  $('#flowAutoSave').addEventListener('click', () => { if (exportText) openImport({ text: exportText, fromDraft: true }); });
  $('#flowImport').addEventListener('click', () => openImport());
  $('#flowUndo').addEventListener('click', () => { if (hist?.past.length) { hist = historyUndo(hist); scheduleSave(); renderWorkshop(); } });
  $('#flowRedo').addEventListener('click', () => { if (hist?.future.length) { hist = historyRedo(hist); scheduleSave(); renderWorkshop(); } });
  $('#flowText').addEventListener('click', () => {
    textOpen = !textOpen;
    if (textOpen && hist) editor.value = hist.now;
    renderWorkshop();
    if (textOpen) editor.focus();
  });
  editor.addEventListener('input', () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      const parsed = parseFlow(editor.value);
      if (!parsed.ok) { editorError.textContent = t()('flow.err.not-flowchart'); return; }
      editorError.textContent = parsed.warnings.length ? t().count('flow.editorWarnings', parsed.warnings.length) : '';
      setDraft(editor.value, { from: 'editor' });
    }, EDIT_MS);
  });
  $('#flowReset').addEventListener('click', async () => {
    const res = await api.flowDiscard(draftFor);
    if (!res.ok) return toast(errorText(res.error));
    const fresh = await api.flowDraft(draftFor);
    if (!fresh.ok || !hist) return undefined;
    hist = historyPush(hist, fresh.text);
    savedText = null;
    savedEl.textContent = t()('flow.resetDone');
    return renderWorkshop();
  });
  $('#flowApply').addEventListener('click', async () => {
    if (!hist) return;
    await flushSave();
    openImport({ text: hist.now, fromDraft: true });
  });
  chatToggle.addEventListener('click', () => (chat.isOpen() ? chat.close() : openChat()));
  root.addEventListener('keydown', (e) => {
    if (mode !== 'workshop' || !(e.ctrlKey || e.metaKey) || e.target.closest('textarea, input')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); $('#flowUndo').click(); }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); $('#flowRedo').click(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => visible && rerender());
  ctx.phone.addEventListener('change', () => visible && rerender());
  let fitTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { const svg = canvas.querySelector('svg'); if (visible && svg) sizeDrawing(svg); }, 150);
  });

  function rerender() {
    if (mode === 'workshop') renderWorkshop();
    else renderView();
  }

  return {
    async show() {
      visible = true;
      renderHead();
      if (mode === 'view') {
        if (exportKey !== archKey(project())) canvas.replaceChildren(h('p', { class: 'fl-loading' }, t()('flow.loading')));
        await loadExport();
        if (level === '1') await loadModel(Date.now() - modelAt > MODEL_RECHECK_MS);
        return renderView();
      }
      await loadDraft();
      return renderWorkshop();
    },
    hide() {
      visible = false;
      flushSave();
      chat.close();
    },
    // A new state from the server: a changed map redraws, otherwise only the colours of the boxes follow.
    async refresh() {
      if (!visible) return;
      const p = project();
      if (draftFor && draftFor !== p.id) {
        await flushSave();
        chat.close();
        draftFor = null;
        hist = null;
      }
      if (mode === 'view') {
        const changed = exportKey !== archKey(p);
        await loadExport();
        if (level === '1') {
          const stale = Date.now() - modelAt > MODEL_RECHECK_MS;
          const before = flowModel?.stamp ?? null;
          await loadModel(stale);
          if (changed || (stale && (flowModel?.stamp ?? null) !== before)) return renderView();
        }
        if (changed) return renderView();
        const svg = canvas.querySelector('svg');
        if (svg && lastModel?.ok) {
          for (const el of svg.querySelectorAll('.fl-flag, g.node > title')) el.remove();
          for (const g of svg.querySelectorAll('g.node')) g.classList.remove('fl-live', 'fl-doing', 'fl-done', 'fl-todo');
          decorate(svg, lastModel, lastMeta);
        }
        return undefined;
      }
      if (!hist) {
        await loadDraft();
        return renderWorkshop();
      }
      return undefined;
    },
    relabel() { if (visible) rerender(); },
    // Configurações from the person's menu: the workshop's conversation, when it is the one on screen.
    chatSettings: () => (visible && chat.isOpen() ? chat.settings() : null),
    putRelation,
    isWorkshop: () => mode === 'workshop',
    setMode,
    openTool,
    openText: () => { if (!textOpen) $('#flowText').click(); },
    openImport,
  };
}
