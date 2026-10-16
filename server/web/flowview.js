// The Flow tab (plano-v02 § v0.2.1): the architecture's mermaid diagram with its boxes tied to the parts, export and
// import, and the workshop where the person and the side chat draw one shared draft. The pure part on top is what
// node:test loads; createFlowView below touches the DOM only when called.
import { api } from './api.js';
import { createChat } from './chat.js';
import { addBox, addLayer, connect, matchParts, moveToLayer, parseFlow, printFlow, removeNode, rename } from './flow.js';
import { drawioOf, exportFileName, isAutoDraft, markdownOf, plantumlDeploymentOf, plantumlOf, saveBlob, standaloneSvg, svgToPng } from './flowexport.js';
import { drawGrid, gridLayout, pageMeasure } from './flowgrid.js';
import { boxTitle, exportTextFor, factRows, innerNotes, journeyChoices, journeyFlow, journeyName, journeySteps, layerName, legendKeys, legendWords, level1Flow, level2Flow, levelNote, nodeName } from './flowlevel.js';
import { DRAG_THRESHOLD, clampZoom, dragScroll, dragStarted, anchoredScroll, svgLeftIn, wheelFactor } from './flowpan.js';
import { createResizer } from './resize.js';
import { nodeById } from './tree.js';
import { createProgramView } from './programview.js';

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
export const levelOf = (saved) => (['parts', 'journeys', 'functions', 'program'].includes(saved) ? saved : '1');
// The levels drawn from the single model (the general view, the journeys and the functions census); the Parts level draws the README.
export const usesModel = (level) => level === '1' || level === 'journeys' || level === 'functions';

// ---- the view inside a part (flow.md fl09) ----

// The way back: where the person came from (a button) and the part they are in. inner: { partId, from } or null.
export function crumbsOf(inner, partName, tt) {
  if (!inner) return [];
  const from = levelOf(inner.from);
  const key = { parts: 'flow.level.parts', journeys: 'flow.level.journeys', functions: 'flow.level.functions' }[from] ?? 'flow.level.one';
  return [{ label: tt(key), level: from }, { label: partName || inner.partId, level: null }];
}

// Only a part of the program opens from the inside (the requests registry and the operation part are drawn on the
// Parts level but hold no code), and only while looking: in the workshop a click picks a box.
export function canOpenInside({ mode, partId, project }) {
  if (mode !== 'view' || !partId) return false;
  const part = project?.arch?.parts?.find((p) => p.id === partId);
  return Boolean(part) && part.role !== 'requests' && part.role !== 'operation';
}

// The inside view stays open while the same project still has its part; another project or a part gone closes it.
export const keepInner = (inner, project) => (inner && project && inner.projectId === project.id && canOpenInside({ mode: 'view', partId: inner.partId, project }) ? inner : null);

// A drawing opens whole: each project, level, mode and part starts at "fit".
export const innerZoomKey = (projectId, level, mode, inner) => `${projectId}|${level}|${mode}|${inner?.partId ?? ''}`;

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

// How small the view may open and still be read: the boxes' 14px text stays at about 12px.
export const READ_MIN = 0.85;
// The whole drawing in the area (Fit to screen), never more than ZOOM_MAX times its own size. w, h: the drawing;
// roomW, roomH: the area inside its padding.
export const wholeScale = ({ w, h, roomW, roomH }) => Math.min(roomW / w, roomH / h, ZOOM_MAX);
// The size the view opens at: whole when that still reads; else as wide as the area, never past life size, and the
// story is scrolled down (the general view reads top to bottom). A drawing that fits the area whole at a third of its
// size is a grey map nobody can read.
export function openScale(size, { readMin = READ_MIN } = {}) {
  const whole = wholeScale(size);
  return whole >= readMin ? whole : Math.min(size.roomW / size.w, 1);
}

// Inside a part the drawing opens whole a little smaller than the general view would: its boxes are few and short,
// and seeing every band at once (what comes in down to where it hands on) matters more than the last pixel of size.
export const INNER_READ_MIN = 0.6;

// The general view with a journey picked opens on the journey, near life size, instead of the whole map at a size
// where the dimmed boxes become blots. box: what the journey covers, in drawing units; size: sizeOf (w, h, roomW,
// roomH) plus vx, vy (where the drawing's viewBox starts). → { scale, cx, cy, x0, x1 }: the zoom, the point (in screen
// pixels from the drawing's top left) to put in the middle of the area (a journey taller than the area shows from its
// top), and the journey's left and right edges with some room, so the page scrolls across only as far as it must and
// the band titles on the left stay in sight when they can.
export function journeyFrame(box, size, { min = 0.95, max = 1.25, pad = 36 } = {}) {
  const fit = Math.min(size.roomW / (box.w + 2 * pad), size.roomH / (box.h + 2 * pad));
  const scale = Math.max(Math.min(max, Math.max(min, fit)), Math.min(max, openScale(size)));
  const cx = (box.x + box.w / 2 - (size.vx ?? 0)) * scale;
  const tall = (box.h + 2 * pad) * scale > size.roomH;
  const cy = tall ? (box.y - pad - (size.vy ?? 0)) * scale + size.roomH / 2 : (box.y + box.h / 2 - (size.vy ?? 0)) * scale;
  const x0 = (box.x - pad - (size.vx ?? 0)) * scale;
  const x1 = (box.x + box.w + pad - (size.vx ?? 0)) * scale;
  return { scale: Math.round(scale * 1000) / 1000, cx, cy, x0, x1 };
}

// The zoom of the view: null is the opening size (openScale); a number is how many screen pixels per drawing pixel.
export const ZOOM_STEP = 1.25;
export const ZOOM_RANGE = [0.15, 3];
export function nextZoom(current, dir) {
  const [lo, hi] = ZOOM_RANGE;
  const z = dir > 0 ? current * ZOOM_STEP : current / ZOOM_STEP;
  return Math.min(hi, Math.max(lo, Math.round(z * 1000) / 1000));
}

// mermaid names an arrow's path "L_<from>_<to>_<n>": the first link between two boxes (in that direction) gets 0, and
// the next ones get how many came before plus one (mermaid 11 flowDb: counter length + 1), so 0, 2, 3, ... The layout
// copy of the general view writes a backward arrow the other way round; this is the path id to find it by.
export function edgePathId(edges, index) {
  const e = edges[index];
  const n = edges.slice(0, index).filter((x) => x.from === e.from && x.to === e.to).length;
  return `L_${e.from}_${e.to}_${n === 0 ? 0 : n + 1}`;
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
// (matchMedia), confirm, onOpenPart(partId), onApplied() (files were written), openSettings(binding, opener),
// waitingOf(sessionId) (the pill's rule, for the chat's dot).
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
  // The "The program" level (id130, mm57): the interface census the engine serves, drawn in this tab.
  const programView = createProgramView({ h, t, api });
  function renderProgram() { programView.render($('#flowProgram')); }

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
  // The journey open on the Journeys level (fl10), and whether the model is still being worked out on the server (a
  // journey picked then is kept by its id until the model settles).
  let route = '';
  let routeFor = null;
  // The Functions level's own pickers (fl17): which owner to show, whether the whole census (docs and tests too) joins
  // the functions, and the words typed in the search.
  let fnOwner = '';
  let fnQuery = '';
  let fnAll = false;
  let modelBuilding = false;
  let showHidden = false;
  let l1 = null;
  let failedNote = false;
  let zoom = null;
  let zoomKey = null;
  let framedZoom = null;
  // The view inside a part (fl09): which part and where the person came from; the server's view of it, its colours,
  // when its structure was last asked for, and the part last clicked (the "See inside" button names it).
  let inner = null;
  let innerView = null;
  let innerLive = null;
  let innerAt = 0;
  let innerWait = 0;
  let innerBuilding = false;
  let innerKeyed = false;
  let l2 = null;
  let picked = null;
  let clickTimer = 0;

  const project = () => ctx.project();
  const model = () => parseFlow(hist?.now ?? '');
  const archKey = (p) => JSON.stringify([p.id, p.arch.source, p.arch.mermaid, p.arch.layers, p.arch.parts.map((x) => [x.id, x.name]), p.arch.links?.map((l) => [l.a, l.b])]);

  const chat = createChat({
    root: $('#flowChat'), h, t, toast, errorText, relative: ctx.relative, money: ctx.money, savedKey: null,
    openSettings: ctx.openSettings, safety: 'flow.chatSafety', waitingOf: ctx.waitingOf,
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
    syncPan();
    if (mode !== 'view' || inner || level !== 'journeys' || arch.source === 'none') $('#flowJourneys').hidden = true;
    $('#flowFunctions').hidden = !(mode === 'view' && level === 'functions' && !inner && arch.source !== 'none');
    $('#flowProgram').hidden = !(mode === 'view' && level === 'program' && !inner);
    $('#flowTools').hidden = mode !== 'workshop';
    const none = arch.source === 'none';
    const nothing = mode === 'view' && (none || !currentText() || level === 'functions');
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
    modelBuilding = Boolean(flowModel && res.building && attempt < MODEL_WAIT_MAX);
    if (modelBuilding) {
      modelWaitTimer = setTimeout(async () => {
        if (!visible || modelKey !== key) return;
        const before = modelStamp;
        await loadModel(true, attempt + 1);
        if (visible && mode === 'view' && usesModel(level) && !inner && flowModel && (flowModel.stamp !== before || !modelBuilding)) renderView();
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
      // A piece inside a part: its colour is what changed in its files now (none without the key), its title says what
      // it is, how many files it holds and what changed.
      if (info && (info.kind === 'component' || info.kind === 'group')) {
        g.classList.add('fl-piece', `fl-piece-${info.kind === 'group' ? 'group' : 'file'}`);
        if (info.tone) g.classList.add(`fl-${info.tone}`);
        const words = [boxTitle(info, info.name, tt)];
        if (info.sub && info.sub !== info.name) words.splice(1, 0, info.sub);
        // A comment in another language than the page is not on the box; it is still one hover away, as written.
        if (info.quote) words.push(tt('flow.l2.quote', { text: info.quote }));
        if (info.changedFiles) words.push(t().count('flow.l2.changed', info.changedFiles));
        if (info.unsaved) words.push(t().count('flow.l2.unsaved', info.unsaved));
        // Who is responsible (fl16/fl17): the chip on the box, the words in the hover.
        if (info.owner) {
          words.push(tt('flow.owner.title', { owner: tt(`flow.owner.${info.owner}`), reasons: (info.ownerReasons ?? []).join(', ') }));
          // The chip sits top-left: the flags (unsaved) keep the top-right corner.
          const box = g.getBBox();
          const chip = svgEl('text', { class: `fl-owner fl-owner-${info.owner}`, x: box.x + 3, y: box.y + 3 });
          chip.textContent = tt(`flow.owner.short.${info.owner}`);
          g.append(chip);
        }
        const title = svgEl('title', {});
        title.textContent = words.join(' · ');
        g.prepend(title);
        if (info.unsaved) {
          const box = g.getBBox();
          g.append(svgEl('circle', { class: 'fl-flag fl-flag-unsaved', cx: box.x + box.width - 2, cy: box.y + 2, r: 5 }));
        }
        continue;
      }
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
      const opens = !workshop && part && canOpenInside({ mode, partId, project: p }) && !(inner && inner.partId === partId);
      if (opens) {
        label = `${label} · ${tt('flow.l2.openHint')}`;
        g.classList.add('fl-opens');
      }
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

  // One listener for every box, so a redraw or a recolour never stacks handlers. A click on a part opens it beside the
  // drawing; on a computer that click waits a moment, so a double click (see inside) does not open the panel first.
  const DOUBLE_MS = 260;
  const insideOf = (g) => (g && canOpenInside({ mode, partId: g.dataset.partId, project: project() }) ? g.dataset.partId : null);
  function actOn(target, { now = false } = {}) {
    const g = target.closest?.('g.node[role="button"]');
    if (!g || !canvas.contains(g)) return false;
    if (mode === 'workshop') pick(g.dataset.flowNode);
    else if (g.dataset.partId) {
      const partId = g.dataset.partId;
      picked = insideOf(g) ? partId : null;
      renderCrumbs();
      clearTimeout(clickTimer);
      if (now || ctx.phone.matches || !picked) ctx.onOpenPart(partId);
      else clickTimer = setTimeout(() => ctx.onOpenPart(partId), DOUBLE_MS);
    }
    return true;
  }
  canvas.addEventListener('click', (e) => { if (e.detail < 2) actOn(e.target); });
  canvas.addEventListener('dblclick', (e) => {
    const partId = insideOf(e.target.closest?.('g.node[data-part-id]'));
    if (!partId) return;
    clearTimeout(clickTimer);
    e.preventDefault();
    openInner(partId);
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      const partId = insideOf(e.target.closest?.('g.node[data-part-id]'));
      if (partId) { e.preventDefault(); openInner(partId); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && actOn(e.target, { now: true })) e.preventDefault();
  });

  function renderLegend() {
    const tt = t();
    const keys = mode === 'workshop' ? [] : legendKeys(inner ? '2' : drawnLevel === 'journeys' && level === 'journeys' ? 'journeys' : level === '1' && flowModel && !failedNote ? '1' : level === 'functions' ? 'functions' : 'parts', { journey: level === '1' && Boolean(journey) });
    legend.replaceChildren(...keys.map((k) => h('li', { class: `lg lg-${k}` }, h('span', { class: 'lg-mark', 'aria-hidden': 'true' }), legendWords(k, tt))));
    legend.hidden = !keys.length;
    // The legend floats over the bottom of the area: the drawing keeps that much room below it, so its last band can
    // always be scrolled clear of the legend and "fit" never puts boxes behind it.
    const floats = !legend.hidden && getComputedStyle(legend).position === 'absolute';
    canvas.style.paddingBottom = floats ? `${Math.ceil(legend.offsetHeight) + 30}px` : '';
  }

  // The drawing's size and the room the area gives it, inside its padding.
  function sizeOf(svg) {
    const vb = svg?.viewBox.baseVal;
    if (!vb?.width || !vb?.height) return null;
    const css = getComputedStyle(canvas);
    const px = (k) => Number.parseFloat(css[k]) || 0;
    return {
      w: vb.width, h: vb.height,
      roomW: Math.max(1, canvas.clientWidth - px('paddingLeft') - px('paddingRight')),
      roomH: Math.max(1, canvas.clientHeight - px('paddingTop') - px('paddingBottom')),
    };
  }

  // The size of the drawing: the workshop keeps reading size and scrolls; the view opens at a size that reads (whole
  // when it can, else as wide as the area), and the zoom buttons take it from there.
  function sizeDrawing(svg) {
    if (mode === 'workshop') return fitWidth(svg, canvas);
    fitWidth(svg, canvas, 0);
    const size = sizeOf(svg);
    if (!size) return undefined;
    svg.setAttribute('width', String(Math.round(size.w * (zoom ?? openScale(size, inner ? { readMin: INNER_READ_MIN } : undefined)))));
    svg.style.maxWidth = 'none';
    svg.style.minWidth = '';
    return undefined;
  }

  // dir: 1 in, -1 out, 0 the whole drawing in the area.
  function zoomBy(dir) {
    const svg = canvas.querySelector('svg');
    const size = sizeOf(svg);
    if (!size) return;
    const now = svg.getBoundingClientRect().width / size.w;
    const cx = (canvas.scrollLeft + canvas.clientWidth / 2) / Math.max(1, canvas.scrollWidth);
    const cy = (canvas.scrollTop + canvas.clientHeight / 2) / Math.max(1, canvas.scrollHeight);
    zoom = dir === 0 ? wholeScale(size) : nextZoom(zoom ?? now, dir);
    sizeDrawing(svg);
    canvas.scrollLeft = dir === 0 ? 0 : cx * canvas.scrollWidth - canvas.clientWidth / 2;
    canvas.scrollTop = dir === 0 ? 0 : cy * canvas.scrollHeight - canvas.clientHeight / 2;
  }

  // ---- the hand (fl15) ----
  // Like the mind map: the cursor over the drawing is a hand, dragging an empty spot or a box moves the whole drawing,
  // the wheel (or a trackpad pinch) zooms around the pointer. The workshop keeps its clicks while a drawing tool is
  // picked, and has no zoom (it keeps reading size and scrolls). A press that moves less than DRAG_THRESHOLD is still a
  // click, so picking and opening boxes works as before.
  const panOn = () => mode !== 'workshop' || !tool;
  function syncPan() {
    canvas.classList.toggle('can-pan', panOn());
  }
  let press = null; // { id, x, y, left, top, moved } while a button or finger is down on the drawing
  let swallowClick = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!panOn() || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
    if (e.target.closest?.('button, a, input, select, textarea, summary, label')) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved) {
      if (!dragStarted(dx, dy, DRAG_THRESHOLD)) return;
      press.moved = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      canvas.classList.add('is-panning');
      clearTimeout(clickTimer);
    }
    const to = dragScroll({
      startLeft: press.left, startTop: press.top, dx, dy,
      maxLeft: canvas.scrollWidth - canvas.clientWidth, maxTop: canvas.scrollHeight - canvas.clientHeight,
    });
    canvas.scrollLeft = to.left;
    canvas.scrollTop = to.top;
  });
  const endPress = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.moved) {
      // The click the browser sends after a drag must not open or pick the box the drag began on.
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    press = null;
    canvas.classList.remove('is-panning');
  };
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', endPress);
  const stopSwallowed = (e) => { if (swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); } };
  canvas.addEventListener('click', stopSwallowed, true);
  canvas.addEventListener('dblclick', stopSwallowed, true);

  // Zoom keeping the point under the pointer where it is. factor: 1.1 is ten percent closer. The new scroll is worked out
  // from the numbers and applied on the next frame (a browser may not have laid the new size out before that, and
  // would hold the scroll back to the old size); wheel turns that come in between build on the scroll still wanted.
  let wanted = null; // { left, top }: where the area is about to be scrolled
  let wantedFrame = 0;
  function zoomAt(factor, clientX, clientY) {
    const svg = canvas.querySelector('svg');
    const size = sizeOf(svg);
    if (!size) return;
    const attr = Number.parseFloat(svg.getAttribute('width'));
    const width = attr > 0 && !String(svg.getAttribute('width')).endsWith('%') ? attr : svg.getBoundingClientRect().width;
    const now = width / size.w;
    const next = clampZoom((zoom ?? now) * factor, ZOOM_RANGE);
    if (!(now > 0) || next === now) return;
    const css = getComputedStyle(canvas);
    const padLeft = Number.parseFloat(css.paddingLeft) || 0;
    const padTop = Number.parseFloat(css.paddingTop) || 0;
    const at = canvas.getBoundingClientRect();
    const sl = wanted?.left ?? canvas.scrollLeft;
    const st = wanted?.top ?? canvas.scrollTop;
    const u = (clientX - at.left + sl - svgLeftIn(width, size.roomW, padLeft)) / now;
    const v = (clientY - at.top + st - padTop) / now;
    const width2 = Math.round(size.w * next);
    zoom = next;
    svg.setAttribute('width', String(width2));
    svg.style.maxWidth = 'none';
    wanted = anchoredScroll({ u, v, scale: width2 / size.w, left: svgLeftIn(width2, size.roomW, padLeft), top: padTop, clientX, clientY, canvasLeft: at.left, canvasTop: at.top });
    cancelAnimationFrame(wantedFrame);
    let tries = 0;
    const apply = () => {
      if (!wanted) return;
      canvas.scrollLeft = wanted.left;
      canvas.scrollTop = wanted.top;
      // The scroll is held back while the new size is not laid out yet: ask again on the next frames, a few times.
      const short = Math.abs(canvas.scrollLeft - wanted.left) > 1 || Math.abs(canvas.scrollTop - wanted.top) > 1;
      if (short && ++tries < 30) { wantedFrame = requestAnimationFrame(apply); return; }
      wanted = null;
    };
    wantedFrame = requestAnimationFrame(apply);
  }
  canvas.addEventListener('wheel', (e) => {
    if (mode === 'workshop' || !canvas.querySelector('svg')) return;
    e.preventDefault();
    zoomAt(wheelFactor(e), e.clientX, e.clientY);
  }, { passive: false });
  syncPan();

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
    markJourney(svg, view.meta);
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    // Framed again on every redraw until the person zooms on their own.
    if ((zoom == null || zoom === framedZoom) && view.meta?.journey && drawnLevel === '1' && !inner) frameJourney(svg);
    return undefined;
  }

  // A journey picked on the general view: the drawing opens on the journey's boxes and labels, near life size.
  function frameJourney(svg) {
    const lit = [...svg.querySelectorAll('g.node.fl-on-path, g.edgeLabel.fl-on-path')].map((g) => g.getBBox()).filter((b) => b.width || b.height);
    const size = sizeOf(svg);
    if (!lit.length || !size) return;
    const x0 = Math.min(...lit.map((b) => b.x));
    const y0 = Math.min(...lit.map((b) => b.y));
    const x1 = Math.max(...lit.map((b) => b.x + b.width));
    const y1 = Math.max(...lit.map((b) => b.y + b.height));
    const vb = svg.viewBox.baseVal;
    const f = journeyFrame({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { ...size, vx: vb.x, vy: vb.y });
    zoom = f.scale;
    framedZoom = f.scale;
    sizeDrawing(svg);
    // The drawing is centred when narrower than the area; its left edge is then where the svg starts.
    const left = svg.getBoundingClientRect().left - canvas.getBoundingClientRect().left + canvas.scrollLeft;
    const top = svg.getBoundingClientRect().top - canvas.getBoundingClientRect().top + canvas.scrollTop;
    const css = getComputedStyle(canvas);
    const room = canvas.clientWidth - Number.parseFloat(css.paddingRight);
    canvas.scrollLeft = Math.max(0, Math.min(left + f.x0, left + f.x1 - room));
    canvas.scrollTop = Math.max(0, top + f.cy - Number.parseFloat(css.paddingTop) - size.roomH / 2);
  }

  // The hover words of an arrow: its label, the other parts an arrow drawn once for several stands for, and inside a
  // part what the code takes (the names it imports) or why an arrow has no file behind it.
  function edgeWords(p, meta) {
    const tt = t();
    const m = meta.edges[p.index] ?? {};
    const names = (m.also ?? []).map((id) => nodeNameOf(id)).filter(Boolean);
    const took = m.names?.length ? tt('flow.l2.names', { names: m.names.slice(0, 6).join(', ') + (m.names.length > 6 ? ', …' : '') }) : '';
    const real = m.back ? flowModel?.edges?.find((e) => e.id === m.edgeId) : null;
    const why = m.readme ? tt('flow.l2.fromReadme') : m.manifest ? tt('flow.l2.fromManifest') : real ? tt('flow.j.backNote', { to: nodeNameOf(real.from) ?? '', from: nodeNameOf(real.to) ?? '' }) : '';
    return [p.text, names.length ? tt('flow.l1.also', { names: names.join(', ') }) : '', took, why].filter(Boolean).join(' · ');
  }

  // ---- journeys (fl10) ----

  // A drawing with a journey on it: the journey's boxes, arrows and labels stand out, everything else steps back. Run
  // after every draw and recolour. A label shared by several arrows stays lit when any of them is on the journey. On
  // the mermaid fallback the arrows carry no index, so nothing is dimmed there.
  function markJourney(svg, meta) {
    const on = meta?.journey ?? null;
    for (const el of svg.querySelectorAll('.fl-dim, .fl-on-path, .fl-step-on')) el.classList.remove('fl-dim', 'fl-on-path', 'fl-step-on');
    svg.classList.toggle('fl-has-journey', Boolean(on));
    if (!on || !svg.querySelector('path[data-edge]')) return;
    for (const g of svg.querySelectorAll('g.node')) g.classList.add(on.nodes.has(g.dataset.flowNode ?? g.dataset.id) ? 'fl-on-path' : 'fl-dim');
    for (const path of svg.querySelectorAll('path[data-edge]')) path.classList.add(on.edges.has(Number(path.dataset.edge)) ? 'fl-on-path' : 'fl-dim');
    for (const g of svg.querySelectorAll('g.edgeLabel[data-edges]')) {
      const lit = g.dataset.edges.split(' ').some((i) => on.edges.has(Number(i)));
      g.classList.add(lit ? 'fl-on-path' : 'fl-dim');
    }
  }

  // One step pointed at in the list: its arrow, its label and its two boxes light up on the drawing.
  function lightStep(index) {
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    for (const el of svg.querySelectorAll('.fl-step-on')) el.classList.remove('fl-step-on');
    svg.classList.toggle('fl-stepping', index != null);
    if (index == null || !l1?.flow.edges[index]) return;
    const e = l1.flow.edges[index];
    svg.querySelector(`path[data-edge="${index}"]`)?.classList.add('fl-step-on');
    for (const g of svg.querySelectorAll('g.edgeLabel[data-edges]')) if (g.dataset.edges.split(' ').includes(String(index))) g.classList.add('fl-step-on');
    for (const id of [e.from, e.to]) svg.querySelector(`g.node[data-id="${CSS.escape(id)}"]`)?.classList.add('fl-step-on');
  }

  // The column beside the drawing on the Journeys level: the journeys found, then the steps of the one open, each tied
  // to its part (a button opens the part, as a click on its box does).
  function renderJourneys() {
    const tt = t();
    const panel = $('#flowJourneys');
    const list = flowModel?.journeys ?? [];
    panel.hidden = false;
    const head = h('header', { class: 'fl-j-head' },
      h('h3', { id: 'flowJourneysTitle', class: 'fl-j-title' }, tt('flow.j.list')),
      h('p', { class: 'fl-j-lede' }, tt('flow.j.lede')),
      modelBuilding ? h('p', { class: 'fl-j-note', role: 'status' }, tt('flow.j.building')) : '');
    if (!list.length) {
      panel.replaceChildren(head, h('p', { class: 'fl-j-none' }, tt('flow.j.none')));
      return;
    }
    const tabs = h('div', { class: 'fl-j-tabs', role: 'tablist', 'aria-orientation': 'vertical', 'aria-labelledby': 'flowJourneysTitle' },
      ...list.map((j, i) => {
        const on = j.id === route;
        return h('button', {
          type: 'button', role: 'tab', class: 'fl-j-tab', id: `flowJTab${i}`, 'aria-selected': String(on), 'aria-controls': 'flowSteps', tabindex: on ? '0' : '-1',
          'data-journey': j.id,
          onclick: () => pickRoute(j.id),
        },
        h('span', { class: 'fl-j-num num', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'fl-j-name' }, journeyName(flowModel, j, tt)),
        h('span', { class: 'fl-j-meta' }, tt.count('flow.j.stepCount', j.steps?.length ?? 0)));
      }));
    tabs.addEventListener('keydown', (e) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: -1e9, End: 1e9 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const at = list.findIndex((j) => j.id === route);
      const next = Math.max(0, Math.min(list.length - 1, at + keys[e.key]));
      pickRoute(list[next].id, { focus: true });
    });
    const j = list.find((x) => x.id === route);
    const steps = journeySteps(flowModel, route, tt);
    const indexOf = (n) => l1?.meta.edges.find((m) => m.step === n)?.index ?? null;
    const partsById = new Map(project().arch.parts.map((p) => [p.id, p]));
    const ol = h('ol', { class: 'fl-j-steps', id: 'flowSteps', role: 'tabpanel', 'aria-labelledby': `flowJTab${list.indexOf(j)}` },
      ...steps.map((st) => {
        const part = st.partId ? partsById.get(st.partId) : null;
        const li = h('li', { class: `fl-j-step${st.back ? ' is-back' : ''}`, tabindex: '0' },
          h('span', { class: 'fl-j-stepnum num', 'aria-hidden': 'true' }, String(st.n)),
          h('div', { class: 'fl-j-stepbody' },
            h('p', { class: 'fl-j-who' }, h('span', { class: 'visually-hidden' }, `${st.n}. `), st.from, h('span', { class: 'fl-j-arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'visually-hidden' }, ` ${tt('flow.to')} `), st.to),
            st.words ? h('p', { class: 'fl-j-words' }, st.words) : null,
            part ? h('button', { type: 'button', class: 'fl-j-chip', onclick: (e) => { e.stopPropagation(); ctx.onOpenPart(part.id); } }, tt('flow.j.openPart', { name: part.name })) : null));
        const index = indexOf(st.n);
        li.addEventListener('mouseenter', () => lightStep(index));
        li.addEventListener('mouseleave', () => lightStep(null));
        li.addEventListener('focusin', () => lightStep(index));
        li.addEventListener('focusout', () => lightStep(null));
        return li;
      }));
    const toMap = h('button', { type: 'button', class: 'btn fl-j-onmap', onclick: () => { journey = route; setLevel('1'); } }, h('span', {}, tt('flow.j.onMap')), ctx.icon('next', 'btn-icon'));
    panel.replaceChildren(head, tabs,
      h('section', { class: 'fl-j-detail', 'aria-label': tt('flow.j.steps', { name: journeyName(flowModel, j, tt) }) },
        h('h4', { class: 'fl-j-subtitle' }, tt('flow.j.steps', { name: journeyName(flowModel, j, tt) })), ol, toMap));
  }

  // The Functions level (fl16/fl17): every function of the program, grouped by the part that owns it, with what it is
  // for (its own opening comment), where it comes from and who is responsible — all mechanical facts of the census.
  function renderFunctions() {
    const tt = t();
    canvas.hidden = true;
    $('#flowZoom').hidden = true;
    const panel = $('#flowFunctions');
    panel.hidden = false;
    const files = flowModel?.files ?? [];
    // A "function" is code the program runs; docs, tests and assets are listed only when the person asks for everything,
    // and never count as orphans.
    const isFn = (f) => f.role === 'code' || f.role === 'hooks';
    const visible = fnAll ? files : files.filter(isFn);
    const counts = { ai: 0, bot: 0, script: 0, orphan: 0 };
    for (const f of visible) {
      if (f.owner === 'ai' || f.owner === 'bot' || f.owner === 'script') counts[f.owner]++;
      if (!(f.partIds ?? []).length && isFn(f)) counts.orphan++;
    }
    const layers = new Map((flowModel?.layers ?? []).map((l) => [l.id, l]));
    const head = h('header', { class: 'fl-j-head' },
      h('h3', { id: 'flowFunctionsTitle', class: 'fl-j-title' }, tt('flow.fn.list')),
      h('p', { class: 'fl-j-lede' }, tt('flow.fn.lede')),
      modelBuilding ? h('p', { class: 'fl-j-note', role: 'status' }, tt('flow.j.building')) : '');
    const chip = (value, key, n, on, action) => h('button', {
      type: 'button', class: `fl-fn-chip${on ? ' is-on' : ''}`, 'aria-pressed': String(on), onclick: action,
    }, tt(key), h('span', { class: 'fl-fn-count num', 'aria-hidden': 'true' }, String(n)));
    const chips = h('div', { class: 'fl-fn-chips', role: 'group', 'data-i18n-aria': 'flow.fn.owners' },
      chip('', 'flow.fn.all', visible.length, fnOwner === '', () => { fnOwner = ''; renderFunctions(); }),
      chip('ai', 'flow.owner.ai', counts.ai, fnOwner === 'ai', () => { fnOwner = fnOwner === 'ai' ? '' : 'ai'; renderFunctions(); }),
      chip('bot', 'flow.owner.bot', counts.bot, fnOwner === 'bot', () => { fnOwner = fnOwner === 'bot' ? '' : 'bot'; renderFunctions(); }),
      chip('script', 'flow.owner.script', counts.script, fnOwner === 'script', () => { fnOwner = fnOwner === 'script' ? '' : 'script'; renderFunctions(); }),
      chip('orphan', 'flow.fn.orphan', counts.orphan, fnOwner === 'orphan', () => { fnOwner = fnOwner === 'orphan' ? '' : 'orphan'; renderFunctions(); }),
      chip('everything', 'flow.fn.everything', files.length - files.filter(isFn).length, fnAll, () => { fnAll = !fnAll; renderFunctions(); }));
    const search = h('input', {
      type: 'search', class: 'fl-fn-search', 'data-i18n-aria': 'flow.fn.search', placeholder: tt('flow.fn.search'), value: fnQuery,
      oninput: (e) => { fnQuery = e.target.value; renderFunctions(); },
    });
    const partsById = new Map(project().arch.parts.map((p) => [p.id, p]));
    const q = fnQuery.trim().toLowerCase();
    const shown = visible.filter((f) => {
      if (fnOwner === 'orphan' ? (f.partIds ?? []).length || !isFn(f) : fnOwner && f.owner !== fnOwner) return false;
      if (!q) return true;
      const partName = (f.partIds ?? []).map((id) => partsById.get(id)?.name ?? id).join(' ');
      return `${f.path} ${f.purpose} ${f.about ?? ''} ${partName}`.toLowerCase().includes(q);
    });
    // Grouped by layer, then by part; a function no part claims goes under "No box" at the foot.
    const byLayer = new Map();
    for (const f of shown) {
      const layer = f.layer ?? 'orphan';
      if (!byLayer.has(layer)) byLayer.set(layer, new Map());
      const parts = byLayer.get(layer);
      const key = (f.partIds ?? [])[0] ?? 'orphan';
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(f);
    }
    const rows = [];
    const layerIds = [...byLayer.keys()].sort((a, b) => (a === 'orphan' ? 1 : 0) - (b === 'orphan' ? 1 : 0) || a.localeCompare(b));
    for (const layerId of layerIds) {
      const layer = layers.get(layerId);
      const layerTitle = layerId === 'orphan' ? null : h('h4', { class: 'fl-fn-layername' }, layerName(layer, tt));
      const partBlocks = [];
      for (const [partId, list] of [...byLayer.get(layerId).entries()].sort((a, b) => (a[0] === 'orphan' ? 1 : 0) - (b[0] === 'orphan' ? 1 : 0) || a[0].localeCompare(b[0]))) {
        const part = partsById.get(partId);
        partBlocks.push(h('div', { class: 'fl-fn-part' },
          part ? h('button', { type: 'button', class: 'fl-fn-partname', onclick: () => { ctx.onOpenPart(part.id); } },
            part.name, h('span', { class: 'fl-fn-partcount num' }, String(list.length)))
            : h('h4', { class: 'fl-fn-partname is-orphan' }, tt('flow.fn.orphanTitle'), h('span', { class: 'fl-fn-partcount num' }, String(list.length))),
          ...list.map((f) => {
            const owner = ['ai', 'bot', 'script'].includes(f.owner) ? f.owner : 'script';
            const how = f.about || f.how;
            return h('div', { class: 'fl-fn-row', title: (f.reasons ?? []).join(', ') },
              h('span', { class: `fl-fn-badge fl-owner-${owner}` }, tt(`flow.owner.short.${owner}`)),
              h('div', { class: 'fl-fn-body' },
                h('div', { class: 'fl-fn-line' },
                  h('code', { class: 'fl-fn-path' }, f.path),
                  !(f.partIds ?? []).length && isFn(f) ? h('span', { class: 'fl-fn-orphan', 'data-i18n': 'flow.fn.orphanMark' }, tt('flow.fn.orphanMark')) : null),
                f.purpose ? h('span', { class: 'fl-fn-purpose' }, f.purpose) : null,
                how ? h('span', { class: 'fl-fn-about' }, tt('flow.fn.how', { text: how })) : null));
          })));
      }
      rows.push(h('div', { class: 'fl-fn-layer' }, layerTitle, ...partBlocks));
    }
    panel.replaceChildren(head, chips, search,
      shown.length ? h('div', { class: 'fl-fn-list' }, rows) : h('p', { class: 'fl-j-none' }, tt('flow.fn.none')));
    renderHead();
  }

  function pickRoute(id, { focus = false } = {}) {
    if (id === route) return;
    route = id;
    renderView().then(() => { if (focus) $(`#flowJourneys [data-journey="${CSS.escape(id)}"]`)?.focus(); });
  }

  function setLevel(next) {
    level = levelOf(next);
    safeSet('sm.flowLevel', level);
    if (inner) { inner = null; innerView = null; l2 = null; clearTimeout(innerWait); }
    return renderView();
  }

  // ---- the view inside a part (fl09) ----

  const partName =(partId) => project().arch.parts.find((x) => x.id === partId)?.name ?? partId;

  // The line above the drawing: on the general view and the parts, how to see a part from the inside (and a button for
  // the part last clicked, which is the way in on a phone); inside, the way back.
  function renderCrumbs() {
    const tt = t();
    const nav = $('#flowCrumbs');
    const on = mode === 'view' && project().arch.source !== 'none';
    nav.hidden = !on;
    if (!on) return;
    if (inner) {
      const crumbs = crumbsOf(inner, partName(inner.partId), tt);
      nav.replaceChildren(h('ol', { class: 'fl-crumb-list' }, ...crumbs.map((c, i) => h('li', { class: 'fl-crumb' },
        c.level
          ? h('button', { type: 'button', class: 'fl-crumb-back', title: tt('flow.l2.back', { name: c.label }), onclick: () => closeInner() },
            ctx.icon('prev', 'fl-crumb-icon'), h('span', {}, c.label))
          : h('span', { class: 'fl-crumb-here', 'aria-current': 'location' }, c.label),
        i < crumbs.length - 1 ? h('span', { class: 'fl-crumb-sep', 'aria-hidden': 'true' }, '›') : ''))),
      innerBuilding ? h('span', { class: 'fl-crumb-note', role: 'status' }, tt('flow.l2.building')) : '');
      return;
    }
    const pickedName = picked && canOpenInside({ mode, partId: picked, project: project() }) ? partName(picked) : null;
    nav.replaceChildren(
      h('span', { class: 'fl-crumb-hint' }, tt(ctx.phone.matches ? 'flow.l2.hintPhone' : 'flow.l2.hint')),
      pickedName ? h('button', { type: 'button', class: 'btn fl-inside-btn', onclick: () => openInner(picked) }, h('span', {}, tt('flow.l2.open', { name: pickedName })), ctx.icon('next', 'btn-icon')) : '');
  }

  function openInner(partId) {
    if (!canOpenInside({ mode, partId, project: project() })) return;
    clearTimeout(clickTimer);
    inner = { partId, from: level, projectId: project().id };
    innerView = null;
    innerLive = null;
    innerAt = 0;
    picked = partId;
    renderView();
  }

  function closeInner() {
    if (!inner) return;
    const back = inner.partId;
    inner = null;
    innerView = null;
    l2 = null;
    clearTimeout(innerWait);
    renderView().then(() => canvas.querySelector(`g.node[data-part-id="${CSS.escape(back)}"]`)?.focus({ preventScroll: true }));
  }

  // Asks the server for the inside of the part: the whole view, or (only) the colours when the view is recent.
  async function loadInner({ onlyLive = false } = {}) {
    const p = project();
    const want = inner;
    const res = await api.flowPart(p.id, want.partId, onlyLive);
    if (inner !== want || project().id !== p.id) return 'stale';
    if (!res.ok) return res.error ?? 'network';
    if (onlyLive) {
      if (res.key !== innerView?.key) return loadInner();
      innerLive = res.live ?? null;
      innerKeyed = Boolean(res.keyed);
      return 'live';
    }
    const before = innerView?.key ?? null;
    innerView = res.view;
    innerLive = res.live ?? null;
    innerKeyed = Boolean(res.keyed);
    innerAt = Date.now();
    innerBuilding = Boolean(res.building);
    clearTimeout(innerWait);
    if (innerBuilding) innerWait = setTimeout(() => { if (visible && inner === want) refreshInner(true); }, MODEL_WAIT_MS);
    return before === innerView.key ? 'same' : 'new';
  }

  async function renderInner() {
    const tt = t();
    renderHead();
    renderCrumbs();
    renderLegend();
    if (!innerView || innerView.partId !== inner.partId) {
      canvas.replaceChildren(h('p', { class: 'fl-loading' }, tt('flow.l2.loading', { name: partName(inner.partId) })));
      $('#flowFilters').hidden = true;
      const got = await loadInner();
      if (got === 'stale') return;
      if (got === 'unknown-part') { toast(tt('flow.l2.unknown')); return closeInner(); }
      if (!['new', 'same'].includes(got)) {
        canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, errorText(got)));
        return;
      }
    }
    await drawInner();
  }

  async function drawInner() {
    l2 = level2Flow(innerView, { tt: t(), live: innerLive, showHidden, narrow: ctx.phone.matches, perRow: ctx.phone.matches ? 2 : 5 });
    drawnLevel = '2';
    renderCrumbs();
    renderLegend();
    renderFilters();
    await drawGeneral(l2);
    renderHead();
  }

  // A poll while inside: the colours every time, the structure again after a while (or while the code is still read).
  async function refreshInner(force = false) {
    const stale = force || innerBuilding || Date.now() - innerAt > MODEL_RECHECK_MS;
    const got = await loadInner({ onlyLive: !stale });
    if (got === 'stale') return;
    if (got === 'unknown-part') { toast(t()('flow.l2.unknown')); closeInner(); return; }
    if (got === 'new') { await drawInner(); return; }
    if (got !== 'same' && got !== 'live') return;
    l2 = level2Flow(innerView, { tt: t(), live: innerLive, showHidden, narrow: ctx.phone.matches, perRow: ctx.phone.matches ? 2 : 5 });
    recolour(l2.meta);
    renderFilters();
  }

  function recolour(meta) {
    const svg = canvas.querySelector('svg');
    if (!svg || !lastModel?.ok) return;
    for (const el of svg.querySelectorAll('.fl-flag, g.node > title')) el.remove();
    for (const g of svg.querySelectorAll('g.node')) g.classList.remove('fl-live', 'fl-doing', 'fl-done', 'fl-todo', 'fl-changed', 'fl-quiet', 'fl-opens', 'fl-piece', 'fl-piece-file', 'fl-piece-group');
    lastMeta = meta;
    decorate(svg, lastModel, meta);
    markJourney(svg, meta);
  }

  async function renderView() {
    if (mode !== 'view') return;
    renderHead();
    renderLegend();
    canvas.hidden = false;
    $('#flowZoom').hidden = false;
    if (level === 'program') {
      canvas.hidden = true;
      $('#flowZoom').hidden = true;
      $('#flowCopy').disabled = true;
      legend.hidden = true;
      return renderProgram();
    }
    const p = project();
    if (p.arch.source === 'none') {
      canvas.replaceChildren(emptyState());
      legend.hidden = true;
      return;
    }
    failedNote = false;
    inner = keepInner(inner, p);
    // A drawing opens whole: on a new project, level, mode or part the zoom goes back to "fit".
    // A journey picked on the general view is a drawing of its own: it opens framed on the journey (frameJourney).
    const zk = innerZoomKey(p.id, level === 'journeys' ? `journeys:${route}` : level === '1' && journey ? `1:${journey}` : level, mode, inner);
    if (zk !== zoomKey) { zoomKey = zk; zoom = null; }
    if (inner) return renderInner();
    l2 = null;
    renderCrumbs();
    if (usesModel(level)) {
      const want = level;
      if (!flowModel) canvas.replaceChildren(h('p', { class: 'fl-loading' }, t()('flow.loading')));
      await loadModel();
      if (mode !== 'view' || level !== want || inner) return;
      if (flowModel) {
        modelStamp = flowModel.stamp ?? null;
        const ids = (flowModel.journeys ?? []).map((j) => j.id);
        // While the model is still being worked out a journey may be missing for a moment: the pick is kept by its id.
        if (journey && !ids.includes(journey) && !modelBuilding) journey = '';
        if (level === 'journeys') return renderRoute(ids);
        if (level === 'functions') return renderFunctions();
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

  // The Journeys level: the list and steps beside, the open journey drawn alone.
  async function renderRoute(ids) {
    const tt = t();
    if (routeFor !== project().id) { routeFor = project().id; route = ''; }
    if (!ids.includes(route)) {
      if (route && !modelBuilding && ids.length) toast(tt('flow.j.gone'));
      if (!route || !modelBuilding || !ids.length) route = ids[0] ?? '';
    }
    const zk = innerZoomKey(project().id, `journeys:${route}`, mode, null);
    if (zk !== zoomKey) { zoomKey = zk; zoom = null; }
    l1 = route ? journeyFlow(flowModel, route, { tt }) : null;
    drawnLevel = 'journeys';
    renderJourneys();
    renderLegend();
    renderFilters();
    if (!l1) {
      canvas.replaceChildren(h('div', { class: 'fl-empty fl-j-empty' }, h('h3', {}, tt('flow.level.journeys')), h('p', {}, tt('flow.j.none'))));
      legend.hidden = true;
      return;
    }
    await drawGeneral(l1);
    renderHead();
  }

  // Above the drawing in the general view: the journey filter, the links seen only in the code, a note, and the facts.
  function renderFilters() {
    const tt = t();
    const box = $('#flowFilters');
    const inside = Boolean(inner && l2 && innerView);
    const alone = !inside && drawnLevel === 'journeys' && Boolean(l1);
    const on = mode === 'view' && project().arch.source !== 'none' && (inside || alone || level === '1' || failedNote);
    box.hidden = !on;
    if (!on) return;
    if (alone) {
      // A journey alone: no filter to pick, the facts behind its boxes and arrows stay one click away.
      box.querySelector('.fl-filter-row').hidden = true;
      box.querySelector('.fl-facts').hidden = false;
      $('#flowLevelNote').textContent = levelNote(l1.meta, tt);
      if ($('#flowFacts').open) fillFacts($('#flowFactsList'));
      return;
    }
    if (inside) {
      // Inside a part only the switch for the links seen only in the code stays; journeys belong to the general view.
      for (const el of box.querySelectorAll('.fl-filter-row, .fl-facts')) el.hidden = false;
      $('#flowJourney').closest('label').hidden = true;
      $('#flowJourneyNote').textContent = '';
      $('#flowShowHidden').checked = showHidden;
      const notes = innerNotes(innerView, tt, { live: innerLive, keyed: innerKeyed, hiddenNear: l2.meta.hiddenNear, showHidden, hubs: l2.meta.hubs });
      const missing = levelNote(l2.meta, tt);
      $('#flowLevelNote').textContent = [missing, ...notes].filter(Boolean).join(' ');
      if ($('#flowFacts').open) fillFacts($('#flowFactsList'));
      return;
    }
    $('#flowJourney').closest('label').hidden = false;
    const general = drawnLevel === '1' && Boolean(flowModel);
    for (const el of box.querySelectorAll('.fl-filter-row, .fl-facts')) el.hidden = !general;
    const select = $('#flowJourney');
    const choices = flowModel ? journeyChoices(flowModel, tt) : [];
    select.replaceChildren(h('option', { value: '' }, tt('flow.l1.journey.all')), ...choices.map((c) => h('option', { value: c.id, selected: c.id === journey }, c.label)));
    select.disabled = !choices.length;
    select.value = journey;
    $('#flowJourneyNote').textContent = general && !choices.length ? tt('flow.l1.journey.none') : general && journey && modelBuilding ? tt('flow.j.building') : '';
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
    const tt = t();
    const inside = drawnLevel === '2' && l2 && innerView;
    const rows = inside ? factRows(l2.model, l2.meta, tt) : factRows(flowModel, l1.meta, tt);
    const how = inside && innerView.how
      ? h('li', { class: 'fl-how' }, h('p', { class: 'fl-how-title' }, tt('flow.l2.how', { file: `${innerView.how.file}:${innerView.how.line}` })), h('p', { class: 'fl-how-text' }, innerView.how.text))
      : null;
    list.replaceChildren(...(how ? [how] : []), ...rows.map((r) => h('li', {},
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
    syncPan();
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

  const currentText = () => (mode === 'workshop' ? hist?.now : exportTextFor(drawnLevel, exportText, drawnLevel === '2' ? l2?.text : l1?.text));

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

  // The drawing as it is on screen (SVG, PNG), the mermaid text behind it (Markdown, .mmd) or that text turned into draw.io
  // and PlantUML (same layers, boxes and arrows). One click, one file.
  async function exportAs(kind) {
    const name = mode === 'view' && inner && drawnLevel === '2' ? `${project().name} ${inner.partId}` : mode === 'view' && drawnLevel === 'journeys' && l1?.journey ? `${project().name} ${l1.journey.key ?? 'journey'}` : project().name;
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
      if (kind === 'drawio' || kind === 'puml' || kind === 'pumld') {
        if (!text) return;
        const body = kind === 'drawio' ? drawioOf(text, name) : (kind === 'puml' ? plantumlOf : plantumlDeploymentOf)(text, name);
        if (!body) { toast(t()(kind === 'pumld' ? 'flow.exportNoDeploy' : 'flow.exportFailed')); return; }
        const file = exportFileName(kind === 'pumld' ? `${name} deployment` : name, kind === 'drawio' ? 'drawio' : 'puml');
        saveBlob(new Blob([body], { type: kind === 'drawio' ? 'application/vnd.jgraph.mxfile' : 'text/plain;charset=utf-8' }), file);
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
      if (next === level && !inner) return;
      setLevel(next);
    });
  }
  $('#flowZoomIn').addEventListener('click', () => zoomBy(1));
  $('#flowZoomOut').addEventListener('click', () => zoomBy(-1));
  $('#flowZoomFit').addEventListener('click', () => zoomBy(0));
  $('#flowJourney').addEventListener('change', (e) => { journey = e.target.value; renderView(); });
  $('#flowShowHidden').addEventListener('change', (e) => { showHidden = e.target.checked; renderView(); });
  $('#flowFacts').addEventListener('toggle', () => {
    if ($('#flowFacts').open && ((l1 && flowModel && usesModel(drawnLevel)) || (l2 && innerView && drawnLevel === '2'))) fillFacts($('#flowFactsList'));
  });
  // Escape leaves the inside of a part, when the keys are on the Flow and no dialog or field takes them.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !inner || mode !== 'view' || dialog.open || exportMenu.open || e.target.closest('input, textarea, select, details[open]')) return;
    e.preventDefault();
    closeInner();
  });
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
        if (usesModel(level)) await loadModel(Date.now() - modelAt > MODEL_RECHECK_MS);
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
      if (mode === 'view' && inner) {
        const kept = keepInner(inner, p);
        if (!kept) {
          inner = null;
          innerView = null;
          l2 = null;
          return renderView();
        }
        if (exportKey !== archKey(p)) await loadExport();
        return refreshInner();
      }
      if (mode === 'view') {
        const changed = exportKey !== archKey(p);
        await loadExport();
        if (usesModel(level)) {
          const stale = Date.now() - modelAt > MODEL_RECHECK_MS;
          const before = flowModel?.stamp ?? null;
          await loadModel(stale);
          if (changed || (stale && (flowModel?.stamp ?? null) !== before)) return renderView();
        }
        if (changed) return renderView();
        recolour(lastMeta);
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
