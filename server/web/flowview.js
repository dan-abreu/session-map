// The Flow tab (plano-v02 § v0.2.1): the architecture's mermaid diagram with its boxes tied to the parts, export and
// import, and the workshop where the person and the side chat draw one shared draft. The pure part on top is what
// node:test loads; createFlowView below touches the DOM only when called.
import { api } from './api.js';
import { createChat } from './chat.js';
import { addBox, addLayer, connect, matchParts, moveToLayer, parseFlow, printFlow, removeNode, rename } from './flow.js';
import { createResizer } from './resize.js';
import { nodeById } from './tree.js';

const HISTORY_MAX = 100;
const SAVE_MS = 500;
const EDIT_MS = 350;
const TEXT_MAX = 60_000;
const CHAT_WIDTH = 460;
const SVG_NS = 'http://www.w3.org/2000/svg';

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

export function mmdFileName(projectName) {
  const base = String(projectName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base ? `${base}-flow.mmd` : 'flow.mmd';
}

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

async function renderMermaid(el, text, phone) {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    flowchart: { curve: 'basis', htmlLabels: false, useMaxWidth: true, nodeSpacing: 34, rankSpacing: 54, padding: 14, diagramPadding: 14 },
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

const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// ctx: h, t (translator getter), toast, errorText, relative, project(), tree(), live() (the lit node ids), phone
// (matchMedia), confirm, onOpenPart(partId), onApplied() (files were written), onPcMode.
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

  const project = () => ctx.project();
  const model = () => parseFlow(hist?.now ?? '');
  const archKey = (p) => JSON.stringify([p.id, p.arch.source, p.arch.mermaid, p.arch.layers, p.arch.parts.map((x) => [x.id, x.name]), p.arch.links?.map((l) => [l.a, l.b])]);

  const chat = createChat({
    root: $('#flowChat'), h, t, toast, errorText, relative: ctx.relative, money: ctx.money, savedKey: null, onPcMode: ctx.onPcMode,
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
    const ask = arch.source !== 'none' && !arch.mermaid
      ? h('button', { type: 'button', class: 'meta-link', onclick: () => askToDraw() }, tt('flow.ask'))
      : null;
    src.replaceChildren(words, arch.source === 'main-branch' ? ` ${tt('flow.source.main')}` : '', ask ? ' ' : '', ask ?? '');
    for (const b of root.querySelectorAll('.fl-modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    root.dataset.mode = mode;
    $('#flowTools').hidden = mode !== 'workshop';
    const none = arch.source === 'none';
    for (const id of ['#flowCopy', '#flowDownload']) $(id).disabled = mode === 'view' && (none || !exportText);
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
  function decorate(svg, flowModel) {
    const ids = new Set(flowModel.nodes.map((n) => n.id));
    const p = project();
    const match = matchParts(flowModel, p.arch.parts);
    const tree = ctx.tree();
    const live = ctx.live();
    const workshop = mode === 'workshop';
    for (const g of svg.querySelectorAll('g.node')) {
      const nodeId = g.dataset.id && ids.has(g.dataset.id) ? g.dataset.id : svgNodeId(g.id, ids);
      if (!nodeId) continue;
      const node = flowModel.nodes.find((n) => n.id === nodeId);
      const partId = match.get(nodeId);
      const part = partId ? p.arch.parts.find((x) => x.id === partId) : null;
      g.dataset.flowNode = nodeId;
      g.classList.add(part ? 'fl-part' : 'fl-free');
      let label = node.label;
      if (part) {
        const counts = nodeById(tree, `pt:${partId}`)?.counts ?? { total: 0, done: 0, doing: 0, withUser: 0, blocks: 0 };
        const tone = partTone(counts, live.has(`pt:${partId}`));
        const flags = partFlags(counts);
        g.classList.add(`fl-${tone}`);
        label = `${part.name}: ${toneWords(tone, flags)}`;
        const box = g.getBBox();
        flags.forEach((f, i) => g.append(svgEl('circle', { class: `fl-flag fl-flag-${f}`, cx: box.x + box.width - 2 - i * 13, cy: box.y + 2, r: 5.5 })));
      } else label = `${node.label}: ${t()('flow.tone.free')}`;
      const title = svgEl('title', {});
      title.textContent = label;
      g.prepend(title);
      if (!workshop && !part) continue;
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
    const keys = mode === 'workshop' ? [] : ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'free'];
    legend.replaceChildren(...keys.map((k) => h('li', { class: `lg lg-${k}` }, h('span', { class: 'lg-mark', 'aria-hidden': 'true' }), tt(['blocks', 'waiting'].includes(k) ? `flow.flag.${k}` : `flow.tone.${k}`))));
    legend.hidden = !keys.length;
  }

  async function draw(text) {
    const res = await renderMermaid(canvas, text, ctx.phone.matches);
    if (res.stale) return;
    if (!res.ok) {
      canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, t()('flow.drawFailed'), h('code', {}, res.error)));
      return;
    }
    fitWidth(res.svg, canvas);
    lastModel = parseFlow(text);
    if (lastModel.ok) decorate(res.svg, lastModel);
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
    if (exportError) {
      canvas.replaceChildren(h('p', { class: 'fl-error', role: 'alert' }, errorText(exportError)));
      return;
    }
    if (exportText === null) {
      canvas.replaceChildren(h('p', { class: 'fl-loading' }, t()('flow.loading')));
      return;
    }
    await draw(exportText);
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
    if (!hist || hist.now === savedText) return;
    const text = hist.now;
    const res = await api.flowSaveDraft(draftFor, text);
    if (res.ok) {
      savedText = text;
      if (hist.now === text) savedEl.textContent = t()('flow.saved');
    } else savedEl.textContent = errorText(res.error);
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

  const currentText = () => (mode === 'workshop' ? hist?.now : exportText);

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

  function download() {
    const text = currentText();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' }));
    const a = h('a', { href: url, download: mmdFileName(project().name) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      if (!res.ok && !res.stale) preview.replaceChildren(h('p', { class: 'fl-error' }, t()('flow.drawFailed'), h('code', {}, res.error)));
    }).catch(() => preview.replaceChildren(h('p', { class: 'fl-error' }, t()('flow.mermaidFailed'))));
    (plan.unchanged ? close : applyBtn.disabled ? close : applyBtn).focus();
  }

  // ---- wiring --------------------------------------------------------------------------------

  for (const b of root.querySelectorAll('.fl-modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const b of root.querySelectorAll('.fl-tool[data-tool]')) b.addEventListener('click', () => openTool(b.dataset.tool));
  $('#flowCopy').addEventListener('click', copyText);
  $('#flowDownload').addEventListener('click', download);
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
    fitTimer = setTimeout(() => { const svg = canvas.querySelector('svg'); if (visible && svg) fitWidth(svg, canvas); }, 150);
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
        if (changed) return renderView();
        const svg = canvas.querySelector('svg');
        if (svg && lastModel?.ok) {
          for (const el of svg.querySelectorAll('.fl-flag, g.node > title')) el.remove();
          for (const g of svg.querySelectorAll('g.node')) g.classList.remove('fl-live', 'fl-doing', 'fl-done', 'fl-todo');
          decorate(svg, lastModel);
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
    isWorkshop: () => mode === 'workshop',
    setMode,
    openTool,
    openText: () => { if (!textOpen) $('#flowText').click(); },
    openImport,
  };
}
