import { LANGS, pickLang, translator } from './i18n.js';
import {
  archTree, defaultOpen, nodeById, ancestorsOf, searchTree, changedNodes, branchMarks, clashMarks, clashChip, relationLinks, ownerHue, initial, countLabel, listsDone, isPerson,
  sizeOf, shareText,
} from './tree.js';
import { createMindmap } from './mindmap.js';
import { createOutline } from './outline.js';
import { createDiscover } from './discover.js';
import { api } from './api.js';
import { createChat } from './chat.js';
import { createTabs } from './tabs.js';
import { createFiles } from './files.js';
import { createResizer } from './resize.js';
import { createFlowView } from './flowview.js';
import { createConvList, conversationCounts, listConversations, projectHue, visitorsOf } from './convlist.js';
import { createNowStrip, jobBadges, nextUnseen, nowJobs, pendingCount } from './now.js';
import { createProjectPicker } from './picker.js';
import { createLivePanel, workingIn, livePaths, captionsAt, stepWords, placeWords } from './live.js';
import { createAlerts } from './alerts.js';
import { visibleProject, chatButtons, waitingEntries, waitingCounts, waitingKind, clashWords, safeTunnel, pcModeOffer } from './views.js';
import { createRangePicker } from './rangepicker.js';
import { signalCard, kindBlock, kindMark } from './blocks.js';
import { emptyState } from './empty.js';
import { createTour, tourWanted } from './tour.js';
import { createHelp } from './help.js';
import { clashSignal, waitingSignal, blocksSignal, relationSignal, costSignal, clashKey, signalWords } from './signals.js';
import { INFO_KINDS, pointTabs, kindDigest } from './kinds.js';
import { inRange, parseSel, resolveRange, serializeSel, spanWords } from './range.js';
import {
  declaredPairs, isDeclared, parseIgnored, relationKey, relationTip, serializeIgnored, sortRelations, splitIgnored, strengthOf,
} from './relations.js';

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 5000;
const PHONE = window.matchMedia('(max-width: 719px)');
const VIEWS = ['map', 'flow', 'board', 'history', 'costs', 'discover'];
const SEARCH_MAX = 8;
const CHAT_WIDTH = 460;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: preference just isn't remembered */ } },
};

let lang = pickLang(store.get('sm.lang'), navigator.language);
// "Technical details" (mm11): the original words (branch, commit, token…) in place of the plain ones, per browser.
let tech = store.get('sm.tech') === '1';
let t = translator(lang, { tech });
let help = null;
let tour = null;
let state = null;
let project = null; // the project as the server sent it
let shown = null; // the same, minus archived chats unless asked
let tree = null;
let open = new Set();
let selection = null;
let view = 'map';
let showArchived = store.get('sm.archived') === '1';
// The period of the open project (mm06), one for the map's "What changed", History, Costs and the activity lists.
let rangeSel = { preset: 'all' };
let rangePicker = null;
const rangeKey = (projectId) => `sm.range.${projectId}`;
const legacyRange = () => parseSel(['today', 'd7', 'd30'].includes(store.get('sm.changed')) ? store.get('sm.changed') : 'all');
const loadRange = (projectId) => { const raw = store.get(rangeKey(projectId)); rangeSel = raw === null ? legacyRange() : parseSel(raw); };
const rangeNow = () => Date.parse(state.generatedAt);
const activeRange = () => resolveRange(rangeSel, rangeNow());
function setRange(sel) {
  rangeSel = sel;
  store.set(rangeKey(project.id), serializeSel(sel));
  renderMap();
  rerender();
  refreshView(true);
}
let relationsOn = store.get('sm.relations') === '1';
// Relations the person asked to stop seeing (mm05): kept in this browser, per project.
let ignoredRel = new Set();
let relLit = null; // the relation (a|b) the Relations list lights on the map
const ignoredKey = (projectId) => `sm.relIgnored.${projectId}`;
const saveIgnored = () => store.set(ignoredKey(project.id), serializeIgnored(ignoredRel));
// Clashes the person chose to stop seeing (wa07): kept in this browser, per project, by the pair of branches.
let ignoredClash = new Set();
const clashIgnoredKey = (projectId) => `sm.clashIgnored.${projectId}`;
const saveClashIgnored = () => store.set(clashIgnoredKey(project.id), serializeIgnored(ignoredClash));
let waitingScope = store.get('sm.waiting.scope') === 'all' ? 'all' : 'project'; // the counter follows the open project unless asked
let query = '';
let marks = { live: new Set(), branches: new Map(), clashes: new Map() };
let convCounts = new Map();
let liveEntries = []; // the conversations working now in the open project (live.js workingIn)
// Conversations that finished since the person last looked at them (mm10): kept across reloads until opened.
const UNSEEN_KEY = 'sm.unseen';
const UNSEEN_MAX = 200;
let unseen = new Set();
try { unseen = new Set((JSON.parse(store.get(UNSEEN_KEY) ?? '[]') ?? []).filter((id) => typeof id === 'string')); } catch { unseen = new Set(); }
let lastStatuses = null;
let jobs = null; // now.js nowJobs: every job on the PC, for the Now strip, the picker's marks and the tab title
// While the person types in a panel, polling must not redraw it under their fingers.
let editing = false;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const icon = (name, cls) => {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  el.append(use);
  return el;
};

// The "/" list of the chat (mm22): the skills on in this project, by the command that calls each.
const chatCommands = () => (project?.skills ?? []).filter((k) => k.enabled !== false && typeof k.command === 'string')
  .map((k) => ({ name: k.command, description: k.description ?? '' }));

const money = (usd) => new Intl.NumberFormat(lang, { style: 'currency', currency: state.currency.code, maximumFractionDigits: 2 })
  .format(usd * state.currency.rate);
const shortDate = (ms) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(ms);
const clock = (iso) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(Date.parse(iso));

function relative(iso) {
  const diff = Date.parse(iso) - Date.parse(state.generatedAt);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

function tail(text, max) {
  if (text.length <= max) return text;
  const cut = text.indexOf(' ', text.length - max);
  return `…${text.slice(cut + 1)}`;
}

function errorText(code) {
  const key = `err.${code}`;
  return key in LANGS.en ? t(key) : t('err.generic');
}

const chatById = (id) => project.chats.find((c) => c.sessionId === id);
const workCellById = (id) => project.workCells.find((w) => w.id === id);
const partById = (id) => project.arch.parts.find((p) => p.id === id);
const hasMap = () => project.arch.parts.length > 0;
const itemNodeId = (partId, code) => `i:${partId}:${code}`;

function applyStaticText() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  help?.relabel();
  tour?.redraw();
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  renderChanged();
  discover?.relabel();
  chat?.relabel();
  flow?.relabel();
  alerts?.relabel();
  picker?.relabel();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// A real <dialog> for the irreversible actions (Stop a conversation, Delete from history).
function confirmAction(text, label) {
  const dialog = $('#confirmDialog');
  return new Promise((resolve) => {
    const done = (value) => () => { dialog.close(); resolve(value); };
    dialog.replaceChildren(h('form', { method: 'dialog', class: 'confirm' },
      h('p', {}, text),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: done(false) }, t('confirm.cancel')),
        h('button', { type: 'button', class: 'btn danger', onclick: done(true) }, label))));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    dialog.showModal();
    dialog.querySelector('.danger').focus();
  });
}

const joinDots = (parts) => parts.flatMap((p, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p]));
const pill = (tone, text) => h('span', { class: `pill tone-${tone}` }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), text);

// The shapes the panels share (blocks.js): a sign that explains itself, a block of one kind of information.
const sigCard = (sig, handlers, extra) => signalCard({ h, icon, t }, sig, handlers, extra);
const kblock = (kind, opts, ...content) => kindBlock({ h, icon, t }, kind, opts, ...content);
const kmark = (kind) => kindMark({ h, icon, t }, kind);

function section(title, ...content) {
  const body = content.flat().filter(Boolean);
  if (!body.length) return null;
  return h('section', { class: 'block' }, h('h3', {}, title), ...body);
}

const list = (items) => (items && items.length ? h('ul', { class: 'plain' }, items.map((i) => h('li', {}, i))) : null);
const button = (label, onclick, { primary = false, disabled = false, title = null, cls = '' } = {}) => h('button', {
  type: 'button', class: `btn${primary ? ' primary' : ''}${cls ? ` ${cls}` : ''}`, disabled, title, onclick,
}, label);

function chatTone(c) {
  if (c.waiting.strong || c.waiting.items.length || c.waiting.weak) return 'waiting';
  return c.status === 'busy' ? 'active' : 'idle';
}

function ownerChip(person) {
  return h('span', { class: 'owner', style: `--owner-h:${ownerHue(person.email)}` },
    h('span', { class: 'owner-dot', 'aria-hidden': 'true' }, initial(person.name)), person.name);
}

// ---- the boxes ---------------------------------------------------------------------

function countText(c) {
  const label = countLabel(c, listsDone(tree));
  if (label.kind === 'open') return t.count('box.open', label.open);
  return label.kind === 'done' ? t('box.done', label) : t('box.empty');
}

function progress(c) {
  if (!listsDone(tree)) return null;
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  return h('span', { class: 'bx-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` }));
}

function chipsOf(c) {
  return [
    c.withUser ? h('span', { class: 'bx-chip is-you' }, t.count('box.withYou', c.withUser)) : null,
    c.blocks ? h('span', { class: 'bx-chip is-blocks' }, t.count('box.blocks', c.blocks)) : null,
  ];
}

const liveDot = () => h('span', { class: 'bx-live', title: t('box.live') }, h('span', { class: 'visually-hidden' }, t('box.live')));

function partBadges(node) {
  const part = node.part;
  const branches = marks.branches.get(part.id) ?? [];
  const clashes = marks.clashes.get(part.id) ?? [];
  const out = [];
  if (branches.length) {
    out.push(h('span', { class: 'bx-people', title: branches.map((b) => `${b.branch} · ${b.name}`).join('\n') },
      branches.slice(0, 4).map((b) => h('span', { class: 'bx-person', style: `--owner-h:${b.hue}`, 'aria-hidden': 'true' }, b.initial)),
      h('span', { class: 'visually-hidden' }, t.count('box.branches', branches.length))));
  }
  const clash = clashChip(clashes, t);
  if (clash) out.push(h('span', { class: 'bx-clash', title: clash.title }, h('span', { class: 'bx-clash-dot', 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }, clash.label), h('span', { class: 'visually-hidden' }, clash.title)));
  return out;
}

function itemBody(node) {
  const i = node.item;
  return [
    h('span', { class: 'bx-head' }, h('span', { class: `bx-status st-${i.status}`, title: t(`item.status.${i.status}`) }, h('span', { class: 'visually-hidden' }, t(`item.status.${i.status}`))), h('span', { class: 'bx-title' }, node.label)),
    h('span', { class: 'bx-meta' },
      i.status === 'doing' ? h('span', { class: 'bx-chip is-doing' }, t('item.status.doing')) : null,
      i.who ? h('span', { class: `bx-chip${isPerson(i.who) ? ' is-you' : ''}` }, i.who) : null,
      i.weight === 'blocks' && i.status !== 'done' ? h('span', { class: 'bx-chip is-blocks' }, t('item.weight.blocks')) : null,
      i.code ? h('code', { class: 'bx-code' }, i.code) : null),
  ];
}

// ---- files, lines and share of the program in every box (mm25) ----------------------------------

const numText = (n) => n.toLocaleString(lang);
const listText = (names) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
const plural = (key, n) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n: numText(n) });

function sizeLine(node) {
  const size = sizeOf(project.arch?.sizes, node);
  if (!size) return null;
  const files = plural('size.files', size.files);
  const lines = plural('size.lines', size.lines);
  const share = shareText(size.share);
  return h('span', { class: 'bx-size num', title: t(node.kind === 'project' ? 'size.titleProgram' : 'size.title', { files, lines, share }) },
    h('span', { class: 'bx-size-count' }, icon('file', 'bx-size-icon'), joinDots([h('span', {}, files), h('span', {}, lines)])),
    node.kind === 'project' ? null : h('span', { class: 'bx-share' }, t('size.share', { share })));
}

function unownedChip(node) {
  const n = node.kind === 'project' ? project.arch?.sizes?.unowned?.files : 0;
  return n ? h('span', { class: 'bx-chip is-unowned', title: t('size.unownedTitle') }, plural('size.unowned', n)) : null;
}

const PATHS_SHOWN = 30;
const pathList = (paths, n) => (paths.length ? h('ul', { class: 'plain rows pf-paths' },
  paths.slice(0, PATHS_SHOWN).map((path) => h('li', {}, h('code', { class: 'path' }, path))),
  n > PATHS_SHOWN ? h('li', { class: 'muted' }, t('files.morePaths', { n: numText(n - PATHS_SHOWN) })) : null) : null);

// The project panel's count: the whole program, the files no box owns (to give them one) and what was left out, by reason.
function programFiles(sizes) {
  if (!sizes?.total) return null;
  const unowned = sizes.unowned.files;
  return kblock('files', { title: t('files.program'), from: t('files.programFrom') },
    h('p', { class: 'pf-lead num' }, t('files.programLead', { files: plural('size.files', sizes.total.files), lines: plural('size.lines', sizes.total.lines) })),
    h('h4', { class: `pf-head${unowned ? ' is-unowned' : ''}` }, unowned ? plural('size.unowned', unowned) : t('files.allOwned')),
    unowned ? h('p', { class: 'muted small' }, t('files.unownedHint')) : null,
    pathList(sizes.unowned.paths, unowned),
    h('h4', { class: 'pf-head' }, t('files.left')),
    ['dep', 'generated', 'binary'].map((k) => (sizes.left[k].files
      ? h('details', { class: 'pf-left' }, h('summary', {}, t(`files.left.${k}`, { n: numText(sizes.left[k].files) })), pathList(sizes.left[k].paths, sizes.left[k].files))
      : h('p', { class: 'pf-left muted small' }, t(`files.left.${k}`, { n: '0' })))));
}

// ---- the open conversation's footprint (mm24): its share of edits in each part of this map ------------------------------

function footShares() {
  const id = chat?.isOpen() ? chat.current() : null;
  if (!id) return null;
  const row = [...project.conversations ?? [], ...visitorsOf(project), ...project.chats].find((r) => r.sessionId === id && r.footprint);
  const place = row?.footprint.places.find((p) => p.projectId === project.id);
  return place ? new Map(place.parts.filter((x) => x.share > 0).map((x) => [x.partId, x.share])) : null;
}

function footChip(node) {
  const share = node.kind === 'part' ? footShares()?.get(node.partId) : undefined;
  return share ? h('span', { class: 'bx-chip is-foot', title: t('box.footTitle', { share: shareText(share) }) }, icon('chat', 'bx-foot-icon'), t('box.foot', { share: shareText(share) })) : null;
}

function boxContent(node) {
  const live = marks.live.has(node.id) ? liveDot() : null;
  if (node.kind === 'item') return [...itemBody(node), live].filter(Boolean);
  const c = node.counts;
  if (node.kind === 'project') {
    const sub = hasMap() ? countText(c) : t.count('summary.chats', shown.chats.length);
    return [h('span', { class: 'bx-title' }, node.label), h('span', { class: 'bx-meta' }, sub), sizeLine(node), unownedChip(node), hasMap() ? progress(c) : null, live].filter(Boolean);
  }
  return [
    h('span', { class: 'bx-title' }, node.label),
    h('span', { class: 'bx-meta' }, h('span', { class: 'num' }, countText(c)), ...chipsOf(c), ...(node.kind === 'part' ? partBadges(node) : []), footChip(node)),
    sizeLine(node),
    c.total ? progress(c) : null,
    live,
  ].filter(Boolean);
}

function signature(node) {
  const part = node.kind === 'part' ? node.part.id : null;
  return JSON.stringify([lang, node.label, node.counts, node.item?.status, node.item?.who, node.item?.weight, node.item?.code, marks.live.has(node.id),
    part && marks.branches.get(part), part && marks.clashes.get(part), node.kind === 'project' && shown.chats.length,
    sizeOf(project.arch?.sizes, node), node.kind === 'project' && project.arch?.sizes?.unowned?.files, part && footShares()?.get(part)]);
}

const toggleLabel = (node, isOpen) => t(isOpen ? 'map.collapse' : 'map.expand', { name: node.label });

function crumbs(node) {
  return [...ancestorsOf(tree, node.id).map((id) => nodeById(tree, id).label)].join(' › ');
}

// ---- the map ---------------------------------------------------------------------------

const openKey = () => `sm.open.${project.id}`;

function loadOpen() {
  try {
    const saved = JSON.parse(store.get(openKey()) ?? 'null');
    open = Array.isArray(saved) ? new Set(saved) : defaultOpen(tree);
  } catch {
    open = defaultOpen(tree);
  }
  open.add(tree.id);
}

const saveOpen = () => store.set(openKey(), JSON.stringify([...open]));

function selectedNodeId() {
  if (!selection) return null;
  if (selection.type === 'node') return selection.id;
  const partId = selection.type === 'chat' ? chatById(selection.id)?.partId : selection.type === 'workcell' ? workCellById(selection.id)?.partId : null;
  return partId ? `pt:${partId}` : null;
}

// The caption under each box where a conversation works now: its last step, then which conversation and how long ago.
function liveCaptions() {
  if (!liveEntries.length) return null;
  const out = new Map();
  for (const [id, { entry, more, exact }] of captionsAt((nodeId) => open.has(nodeId), liveEntries)) {
    const title = entry.chat.title || t('chat.untitled');
    const when = entry.lastStep?.ts ?? entry.chat.updatedAt;
    out.set(id, {
      step: stepWords(t, entry.lastStep) || t('chat.busy'),
      meta: [title, when ? relative(when) : null, more ? t('live.captionMore', { n: more }) : null].filter(Boolean).join(' · '),
      exact,
      hint: t('live.captionHint', { title, place: placeWords(t, entry.place) }),
    });
  }
  return out;
}

function mapView() {
  const range = activeRange();
  const lit = range ? changedNodes(shown, tree, range.from, range.to) : null;
  const match = query ? new Set(searchTree(tree, query).map((m) => m.id)) : null;
  return { open, selected: selectedNodeId(), live: marks.live, captions: liveCaptions(), lit, match, relations: relationsOn && !PHONE.matches ? splitIgnored(relationLinks(shown), ignoredRel).shown : null, relLit };
}

const activeMap = () => (PHONE.matches ? outline : mindmap);

function renderMap(opts) {
  if (!project) return;
  activeMap().render(tree, mapView(), opts);
  $('#relations').setAttribute('aria-pressed', String(relationsOn));
  $('#relations').hidden = !relationLinks(shown).length;
  if (!$('#relList').hidden) renderRelList();
}

function toggleNode(node) {
  if (open.has(node.id)) open.delete(node.id);
  else open.add(node.id);
  saveOpen();
  renderMap({ anchor: node.id });
}

function freeArea() {
  const mm = $('#mindmap').getBoundingClientRect();
  let width = mm.width;
  for (const sheet of [$('#panel'), $('#chat'), $('#waitingList'), $('#liveList'), $('#relList')]) {
    if (sheet.hidden) continue;
    const r = sheet.getBoundingClientRect();
    width = Math.min(width, Math.max(240, r.left - mm.left - 12));
  }
  return { left: 0, top: 0, width, height: mm.height };
}

function revealNode(id, opts) {
  for (const a of ancestorsOf(tree, id)) open.add(a);
  saveOpen();
  renderMap();
  requestAnimationFrame(() => activeMap().reveal(id, opts));
}

function renderChanged() {
  if (!rangePicker) return;
  const slot = $('#changed');
  const btn = rangePicker.button();
  btn.title = t('changed.hint');
  slot.replaceChildren(h('span', { class: 'mm-changed-label' }, t('changed.label')), btn);
}

// ---- summary and the waiting list ------------------------------------------------------

function renderSummary() {
  const parts = [h('button', { type: 'button', class: 'summary-project', title: t('project.open'), onclick: () => select({ type: 'project' }) }, project.name)];
  if (hasMap()) {
    parts.push(h('span', {}, t.count('summary.parts', project.arch.parts.length)));
    parts.push(h('span', { class: 'num' }, listsDone(tree) ? t('summary.done', { done: tree.counts.done, total: tree.counts.total }) : t.count('summary.open', tree.counts.total)));
  }
  const busy = shown.chats.filter((c) => c.status === 'busy').length;
  if (busy) parts.push(h('span', { class: 'tone-active' }, t('summary.working', { n: busy })));
  parts.push(h('span', { class: 'num' }, t('summary.cost', { v: money(project.cost.d30) })));
  if (state.refreshing) parts.push(h('span', { class: 'organizing', role: 'status' }, t('state.refreshing')));
  $('#summary').replaceChildren(...joinDots(parts));
}

// ---- Now: every job on the PC, the picker's marks, the tab title ---------------------------------

const saveUnseen = () => store.set(UNSEEN_KEY, JSON.stringify([...unseen].slice(-UNSEEN_MAX)));

// A poll: what stopped working since the last one is "finished and not seen"; the first look marks nothing new.
function trackUnseen() {
  const next = nextUnseen(lastStatuses ?? new Map(), state, unseen);
  if (lastStatuses) unseen = next.unseen;
  lastStatuses = next.statuses;
  // The conversation open in the chat sheet is being seen right now.
  const open = chat?.isOpen() ? chat.current() : null;
  if (open) unseen.delete(open);
  saveUnseen();
}

function markSeen(sessionId) {
  if (!unseen.delete(sessionId)) return;
  saveUnseen();
  renderNow();
}

function renderNow() {
  if (!state) return;
  jobs = nowJobs(state, { unseen });
  now.render(jobs);
  if (project) picker.update(state.projects.map((p) => ({ id: p.id, name: p.name, hue: projectHue(p) })), project.id, jobBadges(jobs));
  alerts.refreshTitle();
}

function goTo(projectId, sel) {
  closeLists();
  if (view !== 'map') showView('map');
  if (projectId !== project.id) setProject(projectId);
  if (!sel) return;
  if (sel.type === 'node') {
    const node = nodeById(tree, sel.id);
    if (node) requestAnimationFrame(() => openPoint(node));
  } else {
    requestAnimationFrame(() => select(sel));
  }
}

function renderWaiting() {
  const everyone = waitingEntries(state, null, ignoredClash);
  const several = state.projects.length > 1;
  const scoped = waitingScope === 'project' && several && !!project;
  const entries = scoped ? waitingEntries(state, project.id, ignoredClash) : everyone;
  $('#waitingLabel').textContent = t(scoped ? 'waiting.buttonHere' : 'waiting.button', { n: entries.length });
  $('#waitingBtn').classList.toggle('is-zero', entries.length === 0);
  $('#waitingBtn').title = scoped && everyone.length > entries.length ? t('waiting.elsewhere', { n: everyone.length - entries.length }) : '';
  $('#waitingScope').hidden = !several;
  for (const b of $('#waitingScope').querySelectorAll('[data-scope]')) {
    const all = b.dataset.scope === 'all';
    b.setAttribute('aria-pressed', String(all !== scoped));
    b.textContent = t(all ? 'waiting.scope.all' : 'waiting.scope.project', { n: all ? everyone.length : project ? waitingEntries(state, project.id, ignoredClash).length : 0 });
  }
  const listEl = $('#waitingItems');
  $('#waitingCounts').replaceChildren(...waitingCounts(entries).map(({ kind, n }) => h('li', { class: `wc-${kind}` }, t.count(`waiting.count.${kind}`, n))));
  if (!entries.length) {
    listEl.replaceChildren(h('li', { class: 'empty' }, emptyState({ h, icon }, { art: 'check', title: t('waiting.noneTitle'), text: scoped ? t('waiting.noneHere', { n: everyone.length }) : t('waiting.none') })));
    return;
  }
  const where = (p, partId) => {
    const part = partId && p.arch.parts.find((x) => x.id === partId);
    return [several && !scoped ? p.name : null, part ? part.name : null].filter(Boolean).join(' · ');
  };
  listEl.replaceChildren(...entries.map((entry) => waitingRow(entry, { where, scoped })));
}

// One row of "Waiting for you": the sign in three lines (what it is, why, what to do) and the button that does it.
function waitingRow(entry, { where }) {
  const { project: p, chat: c, decision } = entry;
  const kind = waitingKind(entry);
  const sig = decision?.kind === 'clash' ? clashSignal(decision) : waitingSignal({ chat: c, decision });
  const words = sig ? signalWords(t, sig) : null;
  const clashing = decision?.kind === 'clash' ? p.workCells.find((w) => w.id === decision.workCellIds?.[0]) : null;
  const other = clashing && p.workCells.find((w) => w.id === decision.workCellIds?.[1]);
  const clashText = decision?.kind === 'clash' ? clashWords(decision) : null;
  let target;
  if (decision) {
    target = decision.kind === 'item'
      ? { type: 'node', id: decision.code ? itemNodeId(decision.partId, decision.code) : `pt:${decision.partId}` }
      : clashing ? { type: 'workcell', id: clashing.id } : decision.sessionId ? { type: 'chat', id: decision.sessionId } : null;
  } else target = { type: 'chat', id: c.sessionId };
  const reason = decision
    ? (decision.kind === 'item' ? t('waiting.withYou') : t(`waiting.${decision.kind}`))
    : c.waiting.strong ? t('waiting.question') : c.waiting.items.length ? t('waiting.item') : t('waiting.ends');
  const title = clashText ? t(clashText.key, clashText.vars) : decision ? decision.text : c.title;
  const detail = clashText?.vars.files
    ? h('span', { class: 'wi-detail mono' }, clashText.vars.files)
    : decision ? (decision.kind === 'item' && decision.who ? h('span', { class: 'wi-detail' }, [decision.who, tech ? decision.code : null].filter(Boolean).join(' · ')) : null)
      : h('span', { class: 'wi-detail' }, c.waiting.items[0] || tail(c.lastAssistantText, 140));
  const main = h('button', { type: 'button', class: `waiting-item k-${kind}`, onclick: () => goTo(p.id, target) },
    h('span', { class: 'wi-reason' }, kmark(decision?.kind === 'clash' ? 'branches' : decision ? 'tasks' : 'chats'), reason),
    h('span', { class: 'wi-title' }, title),
    detail,
    h('span', { class: 'wi-where' }, where(p, decision?.partId ?? clashing?.partId ?? c?.partId)),
    words ? h('span', { class: 'wi-do' }, h('span', { class: 'wi-do-label' }, `${t('sig.label.todo')}: `), words.todo) : null,
    words && decision?.kind !== 'clash' ? h('span', { class: 'wi-go' }, words.actions[0].label) : null);
  // A clash is settled with the AI or ignored right from the list; the other rows open where the answer is.
  const buttons = decision?.kind === 'clash' && clashing && other ? h('div', { class: 'wi-actions' },
    h('button', { type: 'button', class: 'btn primary small-btn', onclick: () => startClashChat(p, clashing, other) }, t('sig.act.resolve-ai')),
    h('button', { type: 'button', class: 'btn small-btn', onclick: () => setClashIgnored(decision, true) }, t('sig.act.ignore'))) : null;
  return h('li', {}, main, buttons);
}

function openWaiting() {
  closePanel(false);
  chat.close();
  live.close();
  hideRelList();
  $('#waitingList').hidden = false;
  $('#waitingBtn').setAttribute('aria-expanded', 'true');
  $('#waitingList').querySelector('button')?.focus();
}
// The waiting list and the live list share the corner of the map: closing one closes both.
function closeLists() {
  $('#waitingList').hidden = true;
  $('#waitingBtn').setAttribute('aria-expanded', 'false');
  live.close();
  hideRelList();
}

// ---- live: what is being worked on now -----------------------------------------------------

function openLive() {
  closePanel(false);
  chat.close();
  hideRelList();
  $('#waitingList').hidden = true;
  $('#waitingBtn').setAttribute('aria-expanded', 'false');
  live.open();
}

// Opens the way to the box a conversation works on and makes it glow; on a desktop the list stays open beside the map.
function showOnMap(entry) {
  if (PHONE.matches) live.close();
  if (entry.project.id !== project.id) setProject(entry.project.id);
  revealNode(entry.nodeId, { center: true });
  requestAnimationFrame(() => requestAnimationFrame(() => activeMap().pulse(entry.nodeId)));
}

// From the Live panel or a card of the Now strip (same shape: project and chat).
function openFromLive(entry) {
  const out = listConversations(state, { projectId: entry.project.id, showArchived: true });
  const hit = [...out.working, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === entry.chat.sessionId);
  if (hit) openConversation(hit);
  else goTo(entry.project.id, { type: 'chat', id: entry.chat.sessionId });
}

// ---- activity --------------------------------------------------------------------------

const isWork = (item) => item.kind === 'commit' || item.kind === 'merge';
const ACT_ICON = { commit: 'commit', merge: 'merge', push: 'push', tag: 'tag', born: 'born', fused: 'merge' };

function activityTitle(item) {
  if (item.kind === 'push') return t('activity.pushed', { branch: item.branch });
  if (item.kind === 'tag') return t('activity.tagged', { tag: item.subject });
  if (item.kind === 'born') return t('activity.born', { branch: item.subject || item.branch });
  if (item.kind === 'fused') return t('activity.fused', { branch: item.subject || item.branch, main: project.mainBranch });
  return item.subject;
}

const linkTo = (label, onclick, cls = 'meta-link') => h('button', { type: 'button', class: cls, onclick }, label);
const chatLink = (c) => linkTo(c.title, () => select({ type: 'chat', id: c.sessionId }));
const partLink = (part) => linkTo(part.name, () => openPartPoint(part.id));
const branchLink = (w) => linkTo(w.branch, () => select({ type: 'workcell', id: w.id }), 'meta-link branch-name');

function activityRow(item, { showChat }) {
  const c = showChat && item.sessionId && chatById(item.sessionId);
  const who = [t('activity.by', { name: item.author.name }), item.coAuthor ? t('activity.with', { name: item.coAuthor }) : null].filter(Boolean).join(' · ');
  return h('li', { class: `act act-${item.kind}` },
    icon(ACT_ICON[item.kind] || 'commit', 'act-icon'),
    h('div', { class: 'act-body' },
      h('span', { class: 'act-title' }, item.hash && isWork(item) ? h('code', { class: 'act-hash' }, item.hash.slice(0, 7)) : null, activityTitle(item)),
      h('span', { class: 'act-meta' }, who, c ? [' · ', `${t('activity.in')} `, chatLink(c)] : null, ' · ', h('span', { class: 'num' }, relative(item.ts)))));
}

const activityList = (items, opts) => (items.length ? h('ul', { class: 'activity' }, items.map((i) => activityRow(i, opts))) : null);
const newestFirst = (a, b) => b.ts.localeCompare(a.ts);

// The recent activity of a part or a branch, inside the period picked at the top (mm06); with a period on, it says so.
function activitySection(items) {
  const range = activeRange();
  const inside = items.filter((a) => inRange(Date.parse(a.ts), range));
  const rows = activityList(inside.sort(newestFirst).slice(0, 10), { showChat: true });
  if (!range) return kblock('changes', {}, rows);
  return kblock('changes', { title: `${t('kind.changes.title')} · ${spanWords(range, lang, rangeNow())}` }, rows ?? h('p', { class: 'muted' }, t('range.none')));
}

async function runAction(body, okText) {
  const res = await api.action(body);
  if (!res.ok) {
    toast(errorText(res.error));
    return false;
  }
  if (okText) toast(okText);
  poll();
  return true;
}

// Files of a part or a branch, with the buttons that take them out of the page: a terminal here and the phone's VS Code.
function filesSection({ part, workCell, files: fileList, folder = true }) {
  const tunnel = safeTunnel(project.tunnelUrl);
  const terminal = () => runAction({ action: 'new', bare: true, projectId: project.id, ...(workCell ? { frontId: workCell } : {}) }, t('files.openTerminalDone'));
  const tools = folder || tunnel ? h('div', { class: 'actions secondary' },
    folder ? button(t('files.openTerminal'), terminal, { title: t('files.fromPhone') }) : null,
    tunnel ? h('a', { class: 'btn', href: tunnel, target: '_blank', rel: 'noopener noreferrer' }, t('files.phone')) : null) : null;
  return kblock('files', workCell ? { from: t('kind.files.fromBranch') } : {}, tools, files.tree({ part, workCell, files: fileList }));
}

// ---- a point of the map: the chat beside it and its details ------------------------------

function nodeRef(node) {
  if (node.kind === 'layer') return { kind: 'layer', layerId: node.layerId };
  if (node.kind === 'part') return { kind: 'part', partId: node.partId };
  if (node.kind === 'group') return { kind: 'group', partId: node.partId, group: node.group };
  return { kind: 'item', partId: node.partId, ...(node.item.code ? { code: node.item.code } : { line: node.item.line }) };
}

function setPointTab(tab) {
  const details = tab === 'details';
  $('#ptab-chat').setAttribute('aria-selected', String(!details));
  $('#ptab-details').setAttribute('aria-selected', String(details));
  $('#chatPane').hidden = details;
  $('#pointDetails').hidden = !details;
  $('#chat').dataset.tab = tab;
}

let pointNode = null;
let pointSub = 'summary'; // the tab of the details: Summary, Tasks, Conversations, Changes or Files (mm07)

function openPoint(node, { tab = 'chat' } = {}) {
  if (node.kind === 'project') return select({ type: 'project' });
  closePanel(false);
  closeLists();
  selection = { type: 'node', id: node.id };
  chat.open({
    projectId: project.id, title: node.label, subtitle: crumbs(node), intro: t(`point.intro.${node.kind}`, { name: node.label }), start: { node: nodeRef(node) },
  });
  if (pointNode !== node.id) pointSub = 'summary';
  pointNode = node.id;
  $('#pointTabs').hidden = false;
  setPointTab(tab);
  renderPointDetails();
  revealNode(node.id, { center: true });
}

const openPartPoint = (partId, opts) => {
  const node = nodeById(tree, `pt:${partId}`);
  if (node) openPoint(node, opts);
};

function plainPoint() {
  pointNode = null;
  $('#pointTabs').hidden = true;
  setPointTab('chat');
}

function openIdea() {
  if (!hasMap()) return;
  closePanel(false);
  closeLists();
  selection = null;
  chat.open({ projectId: project.id, title: t('idea.title'), subtitle: project.name, intro: t('idea.intro'), start: { node: { kind: 'idea' } } });
  plainPoint();
  renderMap();
}

function createArch() {
  closePanel(false);
  closeLists();
  chat.open({ projectId: project.id, title: t('arch.chatTitle'), subtitle: project.name, intro: t('arch.chatIntro'), draft: t('arch.createText'), start: { node: { kind: 'create-arch' } } });
  plainPoint();
}

// ---- the conversation list ------------------------------------------------------------------

// What the sheet says about a conversation that lives in VS Code or a terminal, and what it offers there.
function whereOf(row) {
  const open = (done) => () => runAction({ action: 'open', sessionId: row.sessionId }, done);
  const actions = [];
  if (row.origin === 'vscode') actions.push({ label: t('action.openVscode'), onclick: open(t('action.openedVscode')) });
  else if (!row.live) actions.push({ label: t('convs.openTerminal'), onclick: open(t('action.openedTerminal')) });
  let note = t('convs.readClosed', { origin: t(`convs.origin.${row.origin}`) });
  if (row.live) note = row.origin === 'vscode' ? t('convs.readVscode') : t('convs.readTerminal');
  return { note, actions, canWrite: row.chattable && !row.live };
}

// A row of the list: the map opens the way to its box, centres it and makes it glow, and the chat opens beside with the
// conversation (a page one resumes; one from VS Code or a terminal reads here, with where it lives).
// home: a visitor's own project (mm24); the map stays on the project it works in, the chat runs where it was born.
function openConversation({ row, project: p, nodeId, place, home }) {
  markSeen(row.sessionId);
  convs.closeDrawer();
  closeLists();
  if (view !== 'map') showView('map');
  if (p.id !== project.id) setProject(p.id);
  closePanel(false);
  const node = nodeById(tree, nodeId) ?? tree;
  selection = { type: 'node', id: node.id };
  const subtitle = [project.name, ...(place.special ? [t(`convs.place.${place.special}`)] : place.path)].join(' › ');
  chat.open({
    projectId: home?.id ?? project.id, mapProjectId: project.id, title: row.title || t('chat.untitled'), subtitle, intro: t(row.origin === 'map' ? 'chat.introResume' : 'convs.introRead'), start: { sessionId: row.sessionId },
    where: row.origin === 'map' ? null : () => whereOf(row),
  });
  if (node.kind === 'project') plainPoint();
  else {
    if (pointNode !== node.id) pointSub = 'summary';
    pointNode = node.id;
    $('#pointTabs').hidden = false;
    setPointTab('chat');
    renderPointDetails();
  }
  revealNode(node.id, { center: true });
  requestAnimationFrame(() => requestAnimationFrame(() => activeMap().pulse(node.id)));
  convs.render();
}

// ---- move or rename a conversation (mm21) ----------------------------------------------------------

const AUTO_PART = '';
const NO_PART = ' none';

function partOptions(target, selected) {
  const opts = [h('option', { value: AUTO_PART }, t('place.partAuto')), h('option', { value: NO_PART }, t('place.partNone'))];
  const named = new Set();
  for (const layer of target.arch.layers ?? []) {
    const parts = layer.partIds.map((id) => target.arch.parts.find((p) => p.id === id)).filter(Boolean);
    parts.forEach((p) => named.add(p.id));
    if (parts.length) opts.push(h('optgroup', { label: layer.name }, parts.map((p) => h('option', { value: p.id }, p.name))));
  }
  const rest = target.arch.parts.filter((p) => !named.has(p.id));
  opts.push(...rest.map((p) => h('option', { value: p.id }, p.name)));
  for (const o of opts.flatMap((x) => (x.tagName === 'OPTGROUP' ? [...x.children] : [x]))) o.selected = o.value === selected;
  return opts;
}

function openPlace({ row, project: home }) {
  const dialog = $('#placeDialog');
  const owned = row.partSource === 'owner';
  const startPart = owned ? (row.partId ?? NO_PART) : AUTO_PART;
  const nameInput = h('input', { type: 'text', id: 'placeName', value: row.title ?? '', maxlength: '120', autocomplete: 'off', 'aria-describedby': 'placeNameHint' });
  const projectSelect = h('select', { id: 'placeProject' }, state.projects.map((p) => h('option', { value: p.id, selected: p.id === home.id }, p.name)));
  const partSelect = h('select', { id: 'placePart' });
  const noMap = h('p', { class: 'pl-hint', id: 'placeNoMap' }, t('place.noMap'));
  const fillParts = () => {
    const target = state.projects.find((p) => p.id === projectSelect.value) ?? home;
    partSelect.replaceChildren(...partOptions(target, target.id === home.id ? startPart : AUTO_PART));
    const mapless = !target.arch.parts.length;
    partSelect.disabled = mapless;
    noMap.hidden = !mapless;
  };
  projectSelect.addEventListener('change', fillParts);
  fillParts();
  const save = async (e) => {
    e.preventDefault();
    const body = {};
    const name = nameInput.value.trim();
    if (name !== (row.title ?? '')) body.title = name;
    if (projectSelect.value !== home.id) body.projectId = projectSelect.value;
    const part = partSelect.disabled ? AUTO_PART : partSelect.value;
    const partStart = body.projectId ? AUTO_PART : startPart;
    if (part !== partStart) body.partId = part === NO_PART ? null : part;
    if (!Object.keys(body).length) return dialog.close();
    const res = await api.placeConversation(row.sessionId, body);
    if (!res.ok) return toast(errorText(res.error));
    dialog.close();
    toast(t('place.done'));
    return poll();
  };
  dialog.replaceChildren(h('form', { class: 'confirm pl-form', onsubmit: save },
    h('h2', { id: 'placeTitle' }, t('place.title')),
    h('p', { class: 'pl-lede' }, t('place.lede')),
    h('div', { class: 'pl-field' }, h('label', { for: 'placeName' }, t('place.name')), nameInput, h('p', { class: 'pl-hint', id: 'placeNameHint' }, t('place.nameHint'))),
    h('div', { class: 'pl-row' },
      h('div', { class: 'pl-field' }, h('label', { for: 'placeProject' }, t('place.project')), h('span', { class: 'pl-select' }, projectSelect, icon('chevron', 'select-chevron'))),
      h('div', { class: 'pl-field' }, h('label', { for: 'placePart' }, t('place.part')), h('span', { class: 'pl-select' }, partSelect, icon('chevron', 'select-chevron')), noMap)),
    h('p', { class: 'note pl-learns' }, t('place.learns')),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('confirm.cancel')),
      h('button', { type: 'submit', class: 'btn primary' }, t('place.save')))));
  dialog.showModal();
  nameInput.focus();
  nameInput.select();
}

function boxCount(node) {
  const n = convCounts.get(node.id);
  return n ? { n, label: t.count('convs.count', n), pressed: convs?.filterNode() === node.id } : null;
}

function itemRow(node) {
  const i = node.item;
  return h('li', {}, h('button', { type: 'button', class: `item-row st-${i.status}`, onclick: () => openPoint(node) },
    h('span', { class: `bx-status st-${i.status}`, 'aria-hidden': 'true' }),
    h('span', { class: 'ir-title' }, node.label),
    h('span', { class: 'ir-meta' }, [i.status === 'doing' ? t('item.status.doing') : null, i.status === 'done' ? t('item.status.done') : null, i.who, i.weight ? t(`item.weight.${i.weight}`) : null, tech ? i.code : null].filter(Boolean).join(' · '))));
}

function itemList(nodes) {
  const items = nodes.flatMap((n) => (n.kind === 'item' ? [n] : n.children));
  const openOnes = items.filter((n) => n.item.status !== 'done');
  const done = items.filter((n) => n.item.status === 'done');
  return [
    openOnes.length ? h('ul', { class: 'plain rows items' }, openOnes.map(itemRow)) : h('p', { class: 'muted' }, t('point.allDone')),
    done.length ? h('details', { class: 'done-items' }, h('summary', {}, t.count('point.doneItems', done.length)), h('ul', { class: 'plain rows items' }, done.map(itemRow))) : null,
  ];
}

function linkRows(partId) {
  const rows = (project.arch.links ?? []).filter((l) => l.a === partId || l.b === partId).map((l) => {
    const other = partById(l.a === partId ? l.b : l.a);
    return h('li', {}, h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'link', id: `${l.a}|${l.b}` }) },
      h('span', { class: 'lr-title' }, other?.name ?? ''),
      h('span', { class: 'lr-date' }, t.count('link.reasons', l.reasons.length)),
      h('span', { class: 'lr-line' }, [...new Set(l.reasons.map((r) => t(`link.kind.${r.kind}`)))].join(' · '))));
  });
  return rows.length ? h('ul', { class: 'plain rows' }, rows) : null;
}

function chatRows(chats) {
  return chats.length ? h('ul', { class: 'plain rows' }, chats.map((c) => h('li', {},
    h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'chat', id: c.sessionId }) },
      h('span', { class: 'lr-title' }, h('span', { class: `dot-mini kind-${chatTone(c) === 'waiting' ? 'waiting' : c.status}`, 'aria-hidden': 'true' }), c.title),
      h('span', { class: 'lr-date' }, relative(c.updatedAt)),
      c.lastAssistantText ? h('span', { class: 'lr-line' }, tail(c.lastAssistantText, 120)) : null)))) : null;
}

function branchRows(cells) {
  return cells.length ? h('ul', { class: 'plain rows' }, cells.map((w) => h('li', {},
    h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'workcell', id: w.id }) },
      h('span', { class: 'lr-title branch-name' }, w.branch),
      h('span', { class: 'lr-date' }, ownerChip(w.owner)),
      h('span', { class: `lr-line${w.clashWith.length ? ' tone-clash' : ''}` }, wcStatus(w)))))) : null;
}

function mainBranchNote() {
  return project.arch.source === 'main-branch' ? h('p', { class: 'note' }, t('point.mainBranch', { dir: project.arch.dir, main: project.mainBranch })) : null;
}

const itemsOf = (nodes) => nodes.flatMap((n) => (n.kind === 'item' ? [n] : n.children));

// The open lines of work that change this part's files, at home here or only passing through.
const linesOn = (part) => project.workCells.filter((w) => w.status !== 'merged' && (w.partId === part.id || (w.touches ?? []).includes(part.id)));

// Every sign of a part or item worth seeing at the top of its Summary: clashes, what blocks, who waits for the person.
function partSigns(part, items) {
  const pairs = new Map();
  for (const w of linesOn(part)) {
    for (const o of w.clashWith.map(workCellById).filter(Boolean)) pairs.set([w.id, o.id].sort().join('|'), [w, o]);
  }
  const clashes = [...pairs.values()].map(([w, o]) => clashCard(w, o));
  const blocking = items.filter((n) => blocksSignal(n.item, part.name)).slice(0, 2).map((n) => itemSign(n.item, part));
  const waiting = shown.chats.filter((c) => c.partId === part.id && waitingSignal({ chat: c })).slice(0, 2)
    .map((c) => sigCard(waitingSignal({ chat: c }), { answer: () => answerChat(c) }, [h('p', { class: 'sig-sub' }, c.title)]));
  return [...clashes, ...blocking, ...waiting];
}

// What an item that blocks the rest says, with the button that starts it.
function itemSign(i, part) {
  const blocks = blocksSignal(i, part.name);
  return blocks ? sigCard(blocks, { 'work-on': () => workOnPoint() }) : null;
}

function workOnPoint() {
  setPointTab('chat');
  $('#chatInput')?.focus();
}

const setPointSub = (tab) => {
  pointSub = tab;
  renderPointDetails();
};

// The strip Summary · Tasks · Conversations · Changes · Files (only the tabs with something in them).
function pointTabStrip(tabs) {
  if (!tabs.includes(pointSub)) pointSub = 'summary';
  const kindOf = { tasks: 'tasks', chats: 'chats', changes: 'changes', files: 'files' };
  return h('div', { class: 'seg ptabs', role: 'tablist', 'aria-label': t('ptab.label') }, tabs.map((tab) => h('button', {
    type: 'button', role: 'tab', 'data-ptab': tab, class: kindOf[tab] ? `kind-${kindOf[tab]}` : '', 'aria-selected': String(pointSub === tab), onclick: () => setPointSub(tab),
  }, kindOf[tab] ? kmark(kindOf[tab]) : null, t(`ptab.${tab}`))));
}

// A row of the Summary: one kind, how much of it there is, and a click that opens its tab.
function digestRow(kind, counts, tab) {
  return h('li', {}, h('button', { type: 'button', class: `kind-row kind-${kind}`, onclick: () => setPointSub(tab) },
    kmark(kind), h('span', { class: 'kr-title' }, t(`kind.${kind}.title`)), h('span', { class: 'kr-digest' }, kindDigest(t, kind, counts)), icon('next', 'kr-next')));
}

function partDetails(node) {
  const part = node.part;
  const c = node.counts;
  const items = itemsOf(node.children);
  const open = items.filter((n) => n.item.status !== 'done');
  const chats = shown.chats.filter((x) => x.partId === part.id);
  const cells = linesOn(part);
  const range = activeRange();
  const changes = project.activity.filter((a) => (a.partIds ?? []).includes(part.id) && inRange(Date.parse(a.ts), range));
  const tabs = pointTabs({ tasks: items.length > 0, chats: chats.length > 0 || cells.length > 0, changes: changes.length > 0 || Boolean(range), files: true });
  const strip = pointTabStrip(tabs);
  let body;
  if (pointSub === 'tasks') body = [kblock('tasks', { vars: { file: part.file } }, itemList(node.children))];
  else if (pointSub === 'chats') {
    body = [kblock('chats', { empty: t('kind.empty') }, chatRows(chats)), kblock('branches', {}, branchRows(cells))];
  } else if (pointSub === 'changes') body = [activitySection(project.activity.filter((a) => (a.partIds ?? []).includes(part.id)))];
  else if (pointSub === 'files') {
    body = [filesSection({ part: part.id }),
      part.codePaths.length ? section(t('point.where'), h('ul', { class: 'plain code-paths' }, part.codePaths.map((p) => h('li', {}, h('code', {}, p))))) : null];
  } else {
    body = [
      part.about ? h('p', { class: 'lead' }, part.about) : null,
      h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(c)), ...chipsOf(c), linkTo(part.file, () => files.open(part.file), 'meta-link path')),
      mainBranchNote(),
      ...partSigns(part, items),
      h('ul', { class: 'plain rows kind-rows' },
        digestRow('tasks', { open: open.length, blocks: c.blocks }, 'tasks'),
        digestRow('chats', { n: chats.length, waiting: chats.filter((x) => waitingSignal({ chat: x })).length }, 'chats'),
        digestRow('branches', { n: cells.length, clashing: cells.filter((w) => w.clashWith.length).length }, 'chats'),
        digestRow('changes', { n: changes.length }, 'changes'),
        digestRow('files', { n: part.codePaths.length }, 'files')),
      section(t('point.related'), linkRows(part.id)),
    ];
  }
  return [strip, ...body];
}

function itemDetails(node) {
  const i = node.item;
  const part = partById(node.partId);
  const tabs = pointTabs({ tasks: i.detail.length > 0, files: true });
  const strip = pointTabStrip(tabs);
  if (pointSub === 'tasks') return [strip, kblock('tasks', { vars: { file: part.file } }, list(i.detail))];
  if (pointSub === 'files') return [strip, filesSection({ part: part.id })];
  const person = isPerson(i.who) && i.status !== 'done' && !blocksSignal(i, part.name);
  const withYou = person ? sigCard(waitingSignal({ decision: { kind: 'item', text: node.label, who: i.who, code: i.code } }), { 'open-item': () => files.open(part.file, null, { line: i.line }) }) : null;
  return [
    strip,
    h('p', { class: 'meta' },
      pill(i.status === 'done' ? 'active' : i.status === 'doing' ? 'waiting' : 'idle', t(`item.status.${i.status}`)),
      i.who ? h('span', { class: `bx-chip${isPerson(i.who) ? ' is-you' : ''}` }, i.who) : null,
      i.weight ? h('span', { class: `bx-chip${i.weight === 'blocks' ? ' is-blocks' : ''}` }, t(`item.weight.${i.weight}`)) : null,
      i.milestone ? h('span', {}, t('item.milestone', { n: i.milestone })) : null,
      i.code ? h('code', { class: 'bx-code' }, i.code) : null),
    itemSign(i, part),
    withYou,
    i.detail.length ? kblock('tasks', { vars: { file: part.file } }, list(i.detail)) : null,
    h('div', { class: 'actions secondary' },
      button(t('point.openLine', { n: i.line }), () => files.open(part.file, null, { line: i.line })),
      button(t('point.openPart', { name: part.name }), () => openPartPoint(part.id, { tab: 'details' }))),
    mainBranchNote(),
    h('p', { class: 'note' }, t('point.itemRule')),
  ];
}

function renderPointDetails() {
  const node = pointNode && nodeById(tree, pointNode);
  if (!node) return;
  let body;
  if (node.kind === 'part') body = partDetails(node);
  else if (node.kind === 'item') body = itemDetails(node);
  else if (node.kind === 'group') body = [h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(node.counts)), ...chipsOf(node.counts)), kblock('tasks', {}, itemList(node.children))];
  else {
    body = [h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(node.counts)), ...chipsOf(node.counts)),
      section(t('point.parts'), h('ul', { class: 'plain rows' }, node.children.map((p) => h('li', {},
        h('button', { type: 'button', class: 'link-row', onclick: () => openPoint(p, { tab: 'details' }) },
          h('span', { class: 'lr-title' }, p.label), h('span', { class: 'lr-date num' }, countText(p.counts)),
          p.part.about ? h('span', { class: 'lr-line' }, p.part.about) : null)))))];
  }
  $('#pointDetails').replaceChildren(...body.flat().filter(Boolean));
}

// ---- the side panel: project, conversation, branch, relation -------------------------------

function wcStatus(w) {
  if (w.status === 'merged') return t('wc.merged', { main: project.mainBranch });
  return w.clashWith.length ? t('wc.clashing') : t('wc.alive');
}

function panelHead(title, ...meta) {
  $('#panelHead').replaceChildren(h('h2', { id: 'panelTitle', tabindex: '-1', 'data-help': 'panel' }, title), h('p', { class: 'meta' }, ...meta.flat().filter(Boolean)));
}

function startChat(title, subtitle, intro, start) {
  closePanel(false);
  chat.open({ projectId: project.id, title, subtitle, intro, start });
  plainPoint();
}

function setClashIgnored(d, on) {
  const key = clashKey(d);
  if (on) ignoredClash.add(key);
  else ignoredClash.delete(key);
  saveClashIgnored();
  refreshMarks();
  renderWaiting();
  renderMap();
  rerender();
}

// "Resolve with the AI": a conversation about the pair that studies both lines of work and asks for the OK before joining.
function startClashChat(p, a, b) {
  if (p.id !== project.id) setProject(p.id);
  closeLists();
  closePanel(false);
  chat.open({
    projectId: p.id, title: t('clash.chatTitle', { a: a.branch, b: b.branch }), subtitle: p.name, intro: t('clash.chatIntro'),
    draft: t('clash.chatDraft', { a: a.branch, b: b.branch }), start: { node: { kind: 'clash', workCellIds: [a.id, b.id] } },
  });
  plainPoint();
}

const SHARED_MAX = 4;
const sharedFiles = (w, o) => w.files.map((f) => f.path).filter((p) => o.files.some((f) => f.path === p));

// One clash as a sign: both lines of work, whose they are, the files they share, why it conflicts and the advice, with the
// buttons that do it. Ignored, it shrinks to a line that brings it back.
function clashCard(w, o) {
  const d = { workCellIds: [w.id, o.id] };
  if (ignoredClash.has(clashKey(d))) {
    return h('p', { class: 'note sig-ignored' }, t('clash.ignored', { a: w.branch, b: o.branch }), ' ', linkTo(t('clash.restore'), () => setClashIgnored(d, false)));
  }
  const shared = sharedFiles(w, o);
  const named = [...shared.slice(0, SHARED_MAX), ...(shared.length > SHARED_MAX ? [t('clash.facts.more', { n: shared.length - SHARED_MAX })] : [])];
  const sig = clashSignal({ ...d, branches: [w.branch, o.branch], owners: [w.owner.name, o.owner.name], files: named, sameOwner: w.owner.email === o.owner.email });
  const facts = h('dl', { class: 'facts sig-facts' },
    h('dt', {}, t('clash.facts.branches')), h('dd', {}, branchLink(w), ' ', branchLink(o)),
    h('dt', {}, t('clash.facts.owners')), h('dd', {}, ownerChip(w.owner), w.owner.email === o.owner.email ? null : ownerChip(o.owner)),
    h('dt', {}, t('clash.facts.ahead')), h('dd', {}, t('clash.facts.aheadValue', { a: w.branch, na: t.count('wc.commitsCount', w.ahead), b: o.branch, nb: t.count('wc.commitsCount', o.ahead) })),
    h('dt', {}, t('clash.facts.files')), h('dd', {}, h('ul', { class: 'plain code-paths' }, shared.slice(0, SHARED_MAX).map((p) => h('li', {}, h('code', {}, p))),
      shared.length > SHARED_MAX ? h('li', { class: 'muted' }, t('clash.facts.more', { n: shared.length - SHARED_MAX })) : null)));
  return sigCard(sig, {
    'resolve-ai': () => startClashChat(project, w, o),
    'see-files': () => $('#panelBody .kind-files, #pointDetails .kind-files')?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    ignore: () => setClashIgnored(d, true),
  }, [facts]);
}

// A branch past what it was expected to cost.
function costCard(w) {
  const sig = costSignal(w, { money, kind: 'estimate' });
  return sig ? sigCard(sig, { 'see-costs': () => showView('costs') }) : null;
}

function renderWorkCellPanel(w) {
  const home = partById(w.partId);
  panelHead(h('span', { class: 'branch-name' }, w.branch), ownerChip(w.owner),
    pill(w.status === 'merged' ? 'idle' : w.clashWith.length ? 'clash' : 'active', wcStatus(w)),
    home ? h('span', {}, `${t('wc.home')} `, partLink(home)) : null);
  const chats = w.chatIds.map(chatById).filter(Boolean);
  const facts = [
    [t('wc.ahead', { main: project.mainBranch }), h('span', { class: 'num' }, t.count('wc.commitsCount', w.ahead))],
    [t('chat.cost'), h('span', { class: 'num' }, w.estimateUSD ? t('wc.estimate', { cost: money(w.costUSD), estimate: money(w.estimateUSD) }) : money(w.costUSD))],
    w.lastCommit ? [t('wc.lastCommit'), [h('code', { class: 'act-hash' }, w.lastCommit.hash.slice(0, 7)), w.lastCommit.subject]] : null,
    [t('wc.born'), shortDate(Date.parse(w.bornAt))],
    w.mergedAt ? [t('wc.fusedAt'), shortDate(Date.parse(w.mergedAt))] : null,
    w.path ? [t('wc.path'), h('code', { class: 'path' }, w.path)] : null,
    w.touches.length ? [t('wc.touches'), joinDots(w.touches.map(partById).filter(Boolean).map(partLink))] : null,
  ].filter(Boolean);
  const alive = w.status !== 'merged';
  $('#panelBody').replaceChildren(...[
    ...w.clashWith.map(workCellById).filter(Boolean).map((o) => clashCard(w, o)),
    costCard(w),
    w.remote ? h('p', { class: 'note' }, t('wc.remote'), project.fetchedAt ? ` ${t('wc.fetched', { time: clock(project.fetchedAt) })}` : '') : null,
    alive && !w.remote ? h('div', { class: 'tools' }, h('div', { class: 'actions' },
      button(t('action.continue'), () => startChat(t('chat.newOn', { branch: w.branch }), home ? home.name : '', t('chat.introBranch', { branch: w.branch }), { workCellId: w.id, ...(home ? { partId: home.id } : {}) }), { primary: true }),
      button(t('action.newTerminal'), () => runAction({ action: 'new', frontId: w.id, projectId: project.id }, t('action.newTerminalDone')), { title: t('action.fromPhone') }))) : null,
    section(t('wc.doing'), w.nucleus.doing ? h('p', { class: 'lead' }, w.nucleus.doing) : null),
    w.openspec ? section(t('wc.plan'),
      h('div', { class: 'progress', role: 'img', 'aria-label': t('chat.openspec', w.openspec) },
        h('span', { style: `width:${Math.round((w.openspec.done / Math.max(1, w.openspec.total)) * 100)}%` })),
      h('p', { class: 'muted small' }, `${w.openspec.change} · ${t('chat.openspec', w.openspec)}`)) : null,
    kblock('tasks', { from: t('kind.tasks.fromBranch') }, list(w.nucleus.todo)),
    filesSection({ workCell: w.id, files: w.files, folder: Boolean(!w.remote || w.path) }),
    kblock('chats', { empty: t('wc.noChats') }, chatRows(chats)),
    activitySection(project.activity.filter((a) => a.workCellId === w.id)),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  ].filter(Boolean));
}

// ---- relations: the list beside the map and the panel of one line (mm05) -----------------------------

const partName = (id) => partById(id)?.name ?? id;
const linkOf = (key) => (project.arch.links ?? []).find((l) => relationKey(l) === key);

function strengthEl(weight) {
  const word = t(`rel.strength.${strengthOf(weight)}`);
  return h('span', { class: `rel-strength s-${strengthOf(weight)}`, role: 'img', 'aria-label': `${t('rel.strength')}: ${word}` },
    Array.from({ length: 4 }, (_, i) => h('i', { class: i < weight ? 'on' : '' })), h('span', { class: 'rel-strength-word' }, word));
}

function openRelList() {
  closePanel(false);
  chat.close();
  $('#waitingList').hidden = true;
  $('#waitingBtn').setAttribute('aria-expanded', 'false');
  live.close();
  renderRelList();
  $('#relList').hidden = false;
  requestAnimationFrame(() => mindmap.fit(true));
}

function hideRelList() {
  if ($('#relList').hidden) return;
  $('#relList').hidden = true;
  if (relLit !== null) {
    relLit = null;
    renderMap();
  }
}

function lightRelation(key) {
  relLit = relLit === key ? null : key;
  renderMap();
  const link = linkOf(key);
  if (relLit && link) revealNode(`pt:${link.a}`);
}

function renderRelList() {
  const { shown: visible, ignored } = splitIgnored(relationLinks(shown), ignoredRel);
  const pairs = declaredPairs(project.arch);
  const row = (l, { off = false } = {}) => {
    const key = relationKey(l);
    return h('li', { class: `rel-item${relLit === key ? ' is-lit' : ''}` },
      h('button', { type: 'button', class: 'rel-row', 'aria-pressed': String(relLit === key), disabled: off, onclick: () => lightRelation(key) },
        h('span', { class: 'rel-names' }, `${partName(l.a)} ↔ ${partName(l.b)}`),
        h('span', { class: 'rel-meta' }, strengthEl(l.weight), h('span', { class: `rel-kind ${isDeclared(l, pairs) ? 'is-declared' : 'is-detected'}` }, t(isDeclared(l, pairs) ? 'rel.declared' : 'rel.detected')),
          h('span', { class: 'num' }, t.count('link.reasons', l.reasons.length)))),
      off
        ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => setIgnored(l, false) }, t('rel.restore'))
        : h('button', { type: 'button', class: 'icon-btn rel-open', title: t('rel.details'), 'aria-label': `${t('rel.details')}: ${partName(l.a)} ↔ ${partName(l.b)}`, onclick: () => select({ type: 'link', id: key }) }, icon('next', '')));
  };
  $('#relSub').textContent = [t.count('rel.count', visible.length), ignored.length ? t.count('rel.ignoredCount', ignored.length) : null].filter(Boolean).join(' · ');
  $('#relBody').replaceChildren(...[
    visible.length ? h('ol', { class: 'rel-items' }, sortRelations(visible, partName).map((l) => row(l))) : emptyState({ h, icon }, { art: 'links', title: t('rel.emptyTitle'), text: t('rel.empty') }),
    ignored.length ? h('details', { class: 'rel-ignored' }, h('summary', {}, t.count('rel.ignoredSection', ignored.length)),
      h('ol', { class: 'rel-items' }, sortRelations(ignored, partName).map((l) => row(l, { off: true })))) : null,
  ].filter(Boolean));
}

function setIgnored(link, on) {
  const key = relationKey(link);
  if (on) ignoredRel.add(key);
  else ignoredRel.delete(key);
  saveIgnored();
  if (relLit === key) relLit = null;
  renderMap();
  if (selection?.type === 'link' && selection.id === key) renderLinkPanel(link);
}

// Draws the line as a dotted "related" arrow in the Flow draft (a write: it needs the key), then shows the workshop.
async function putOnFlow(link) {
  const res = await flow.putRelation(link.a, link.b);
  if (!res.ok) return toast(res.error === 'no-box' ? t('rel.flowNoBox') : errorText(res.error));
  toast(t(res.already ? 'rel.flowAlready' : 'rel.flowDone'));
  showView('flow');
  return flow.setMode('workshop');
}

function reasonEvidence(r) {
  const out = [];
  if (r.kind === 'shared-chat' && r.files?.length) out.push(h('span', { class: 'rel-ev' }, t('link.ev.files', { files: r.files.join(', ') })));
  if (r.kind === 'shared-branch') {
    if (r.commit) out.push(h('span', { class: 'rel-ev' }, t('link.ev.commit', { subject: r.commit })));
    if (r.spec) out.push(h('span', { class: 'rel-ev' }, t('link.ev.plan', r.spec)));
  }
  if (r.kind === 'lineage' && r.fromSessionId) {
    const from = chatById(r.fromSessionId);
    if (from) out.push(h('span', { class: 'rel-ev' }, t('link.ev.from', { title: from.title })));
  }
  if (r.kind === 'file-ref' && r.file) out.push(h('span', { class: 'rel-ev' }, t('link.ev.file', { file: r.file })));
  return out;
}

// A part has work open now: a line of work being changed, or a conversation running.
const partBusy = (id) => project.workCells.some((w) => w.partId === id && w.status === 'active') || project.chats.some((c) => c.partId === id && c.status === 'busy');

function renderLinkPanel(link) {
  const a = partById(link.a), b = partById(link.b);
  const key = relationKey(link);
  const declared = isDeclared(link, declaredPairs(project.arch));
  const off = ignoredRel.has(key);
  panelHead(`${a.name} ↔ ${b.name}`, strengthEl(link.weight), h('span', {}, t.count('link.reasons', link.reasons.length)),
    link.since ? h('span', {}, t('link.since', { date: shortDate(Date.parse(link.since)) })) : null,
    linkTo(t('rel.back'), () => { closePanel(); openRelList(); }));
  const reasons = link.reasons.map((r) => {
    const c = r.sessionId && chatById(r.sessionId);
    const w = r.workCellId && workCellById(r.workCellId);
    const parts = [h('span', { class: 'lr-kind' }, t(`link.kind.${r.kind}`)), h('span', { class: 'lr-line' }, r.text), ...reasonEvidence(r), c ? h('span', { class: 'lr-open' }, t('link.open', { title: c.title })) : null];
    const go = c ? () => select({ type: 'chat', id: c.sessionId }) : w ? () => select({ type: 'workcell', id: w.id }) : null;
    return h('li', {}, go ? h('button', { type: 'button', class: 'link-row reason', onclick: go }, parts) : h('div', { class: 'link-row reason static' }, parts));
  });
  const chatIds = [...new Set(link.reasons.flatMap((r) => [r.sessionId, r.fromSessionId]).filter(Boolean))].map(chatById).filter(Boolean)
    .sort((p, q) => q.updatedAt.localeCompare(p.updatedAt));
  $('#panelBody').replaceChildren(...[
    off ? h('p', { class: 'note' }, t('rel.ignoredNote')) : null,
    h('div', { class: `callout rel-kind-note ${declared ? 'is-declared' : 'is-detected'}` }, h('h3', {}, t(declared ? 'rel.declared' : 'rel.detected')), h('p', {}, t(declared ? 'rel.declaredWhy' : 'rel.detectedWhy'))),
    section(t('rel.parts'), h('div', { class: 'rel-pair' }, partLink(a), h('span', { 'aria-hidden': 'true' }, '↔'), partLink(b))),
    section(t('link.why'), h('ul', { class: 'plain rows' }, reasons)),
    chatIds.length ? kblock('chats', { title: t('rel.chats') }, chatRows(chatIds)) : null,
  ].filter(Boolean));
  $('#panelBody').prepend(sigCard(relationSignal(link, { nameOf: partName, bothBusy: partBusy(link.a) && partBusy(link.b), kindWord: (k) => t(`link.kind.${k}`) }), {
    'open-chats': chatIds.length ? { label: t('rel.openChats', { n: chatIds.length }), run: () => select({ type: 'chat', id: chatIds[0].sessionId }) } : null,
    'put-on-flow': () => putOnFlow(link),
    ignore: { label: t(off ? 'rel.unignore' : 'rel.ignore'), run: () => setIgnored(link, !off) },
  }));
}

// Answer a conversation that waits: here when the page may write in it, otherwise where it lives.
function answerChat(c) {
  if (chatButtons(c).write === 'page') startChat(c.title, t('chat.resuming'), t('chat.introResume'), { sessionId: c.sessionId });
  else select({ type: 'chat', id: c.sessionId });
}

function chatTools(c) {
  const can = chatButtons(c);
  const part = partById(c.partId);
  const actions = [];
  actions.push(button(t('action.continue'), () => startChat(t('chat.newFrom', { title: c.title }), part ? part.name : '', t('chat.introChild', { title: c.title }), { parentId: c.sessionId, ...(c.workCellId ? { workCellId: c.workCellId } : {}) }), { primary: true }));
  if (can.write === 'page') actions.push(button(t('action.writeHere'), () => startChat(c.title, t('chat.resuming'), t('chat.introResume'), { sessionId: c.sessionId })));
  if (can.phone) actions.push(h('a', { class: 'btn', href: can.phone, target: '_blank', rel: 'noopener noreferrer' }, t('action.phone')));
  actions.push(button(c.entrypoint === 'claude-vscode' ? t('action.openVscode') : t('action.open'),
    () => runAction({ action: 'open', sessionId: c.sessionId }, c.entrypoint === 'claude-vscode' ? t('action.openedVscode') : t('action.openedTerminal')),
    { disabled: !can.open.enabled, title: can.open.reason ? t(`action.why.${can.open.reason}`) : t('action.fromPhone') }));
  if (can.close) {
    actions.push(button(t('action.stop'), async () => {
      if (!(await confirmAction(t('action.stopConfirm', { title: c.title }), t('action.stop')))) return;
      runAction({ action: 'close', sessionId: c.sessionId }, t('action.stopped'));
    }, { disabled: !can.close.enabled, title: can.close.reason ? t(`action.why.${can.close.reason}`) : null, cls: 'danger-quiet' }));
  }
  actions.push(button(t(`action.${can.archive}`), () => runAction({ action: can.archive, sessionId: c.sessionId }, t(`action.${can.archive}d`))));
  const notes = [];
  if (!can.open.enabled && can.open.reason) notes.push(t(`action.why.${can.open.reason}`));
  if (c.live && c.entrypoint === 'claude-vscode') notes.push(t('action.vscodeFolder'));
  return h('div', { class: 'tools' }, h('div', { class: 'actions' }, actions), notes.length ? h('p', { class: 'muted small' }, notes.join(' ')) : null);
}

function renderChatPanel(c) {
  const part = partById(c.partId);
  const wc = c.workCellId && workCellById(c.workCellId);
  const parent = c.parentId && chatById(c.parentId);
  const card = c.card || {};
  panelHead(c.title, pill(chatTone(c), t(`chat.${c.status}`)), c.archived ? h('span', { class: 'level-badge' }, t('chat.archived')) : null, part ? partLink(part) : null);
  const waitingSig = waitingSignal({ chat: c });
  const waitingBlock = waitingSig ? sigCard(waitingSig, { answer: () => answerChat(c) }, c.waiting.items.length ? [list(c.waiting.items)] : []) : null;
  const facts = [
    [t('chat.cost'), h('span', { class: 'num' }, money(c.costUSD))],
    [t('chat.branch'), wc ? branchLink(wc) : h('span', { class: 'branch-name' }, project.mainBranch || '—')],
    [t('chat.placed'), t(`chat.placedBy.${c.partSource}`)],
    [t('chat.started'), shortDate(Date.parse(c.startedAt))],
    [t('chat.updated'), relative(c.updatedAt)],
    ...c.workflows.map((w) => [t('chat.workflow'), `${w.name} · ${t('chat.workflowSteps', { done: w.done, started: w.started, label: w.lastLabel })}`]),
    parent ? [t('chat.from'), chatLink(parent)] : null,
  ].filter(Boolean);
  $('#panelBody').replaceChildren(...[
    waitingBlock,
    !part && hasMap() ? h('p', { class: 'note' }, t('chat.offMap')) : null,
    chatTools(c),
    section(t('chat.doing'), card.doing ? h('p', { class: 'lead' }, card.doing) : null),
    kblock('tasks', { from: t('kind.tasks.fromChat') }, list(card.todo)),
    section(t('chat.lastPrompt'), c.lastPrompt ? h('p', { class: 'quote' }, c.lastPrompt) : null),
    section(t('chat.lastReply'), c.lastAssistantText ? h('p', {}, c.lastAssistantText) : null),
    kblock('changes', { title: t('chat.commits') }, activityList(project.activity.filter((a) => isWork(a) && a.sessionId === c.sessionId).sort(newestFirst), { showChat: false })),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  ].filter(Boolean));
}

let projectTab = 'overview';
function renderProjectPanel() {
  const p = project;
  panelHead(p.name, p.mainBranch ? h('span', { class: 'branch-name' }, p.mainBranch) : h('span', {}, t('project.noGit')),
    h('span', { class: 'num' }, t('summary.cost', { v: money(p.cost.d30) })));
  const tab = (id, label) => h('button', {
    type: 'button', role: 'tab', id: `ptab-${id}`, 'aria-selected': String(projectTab === id), 'aria-controls': 'ptab-panel',
    onclick: () => { projectTab = id; renderProjectPanel(); },
  }, label);
  const copy = async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      toast(t('skills.copied', { command }));
    } catch {
      toast(command);
    }
  };
  let body;
  if (projectTab === 'skills') {
    body = p.skills.length ? h('ul', { class: 'skills' }, p.skills.map((s) => h('li', { class: `skill${s.enabled ? '' : ' is-off'}` },
      h('div', { class: 'skill-head' },
        h('span', { class: 'skill-name' }, s.name),
        h('span', { class: 'level-badge' }, s.plugin ? t('skills.origin.plugin', { plugin: s.plugin }) : t(`skills.origin.${s.origin}`)),
        pill(s.enabled ? 'active' : 'idle', s.enabled ? t('skills.on') : t('skills.off'))),
      s.description ? h('p', { class: 'skill-desc' }, s.description) : null,
      h('div', { class: 'skill-cmd' }, h('code', {}, s.command),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => copy(s.command), 'aria-label': t('skills.copyAria', { command: s.command }) }, t('skills.copy'))))))
      : h('p', { class: 'muted' }, t('skills.none'));
  } else {
    const loose = shown.chats.filter((c) => !c.partId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    body = h('div', {},
      h('dl', { class: 'facts first' },
        h('dt', {}, t('project.root')), h('dd', {}, h('code', { class: 'path' }, p.root)),
        hasMap() ? [h('dt', {}, t('project.map')), h('dd', {}, h('code', { class: 'path' }, p.arch.dir), p.arch.source === 'main-branch' ? ` · ${t('project.fromMain', { main: p.mainBranch })}` : '')] : null,
        h('dt', {}, t('range.today')), h('dd', { class: 'num' }, money(p.cost.today)),
        h('dt', {}, t('range.d7')), h('dd', { class: 'num' }, money(p.cost.d7)),
        h('dt', {}, t('range.d30')), h('dd', { class: 'num' }, money(p.cost.d30)),
        p.fetchedAt ? [h('dt', {}, t('project.fetched')), h('dd', {}, clock(p.fetchedAt))] : null),
      programFiles(p.arch.sizes),
      section(hasMap() ? t('project.offMap') : t('project.chats'), chatRows(loose)),
      section(t('project.ai'), p.ai
        ? [h('p', {}, t('project.aiOn', { model: p.ai.model, cost: money(p.ai.spentUSDToday) })), p.ai.queue ? h('p', { class: 'muted small' }, t.count('costs.aiQueue', p.ai.queue)) : null]
        : h('p', { class: 'muted' }, t('project.aiOff'))),
      h('label', { class: 'switch block-switch' },
        h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => setArchived(e.target.checked) }),
        h('span', {}, t('map.showArchived'))));
  }
  $('#panelBody').replaceChildren(
    h('div', { class: 'seg tabs-mini', role: 'tablist', 'aria-label': t('project.tabs') }, tab('overview', t('project.overview')), tab('skills', t.count('project.skills', p.skills.length))),
    h('div', { id: 'ptab-panel', role: 'tabpanel', 'aria-labelledby': `ptab-${projectTab}` }, body));
}

let returnFocus = null;
function openPanel() {
  const panel = $('#panel');
  if (panel.hidden) returnFocus = document.activeElement;
  chat.close();
  closeLists();
  panel.hidden = false;
  panel.querySelector('.panel-body').scrollTop = 0;
}
function closePanel(restore = true) {
  if ($('#panel').hidden) return;
  $('#panel').hidden = true;
  if (selection && selection.type !== 'node') selection = null;
  editing = false;
  renderMap();
  if (restore && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

// Draws the open panel or point details again (after a poll) without moving the map.
function rerender() {
  if (selection && selection.type !== 'node' && !$('#panel').hidden) select(selection, { keep: true });
  if (pointNode && !$('#chat').hidden && !$('#pointDetails').contains(document.activeElement)) renderPointDetails();
}

function select(sel, { keep = false } = {}) {
  if (!sel) return closePanel();
  if (!keep) {
    openPanel();
    editing = false;
  }
  selection = sel;
  if (sel.type === 'project') renderProjectPanel();
  else if (sel.type === 'workcell') {
    const w = workCellById(sel.id);
    if (!w) return closePanel();
    renderWorkCellPanel(w);
  } else if (sel.type === 'link') {
    const link = (project.arch.links ?? []).find((l) => `${l.a}|${l.b}` === sel.id);
    if (!link) return closePanel();
    renderLinkPanel(link);
  } else {
    const c = chatById(sel.id);
    if (!c) return closePanel();
    if (c.archived && !showArchived) {
      if (keep) return closePanel();
      setArchived(true);
    }
    renderChatPanel(c);
  }
  if (keep) return undefined;
  const target = selectedNodeId();
  if (target) revealNode(target);
  else renderMap();
  return undefined;
}

// ---- "use this mode on the whole PC" ------------------------------------------------------

async function pcMode(mode) {
  let cur = await api.settingsMode();
  // The demo has no settings file: the dialog still shows what would change, and saving says it is a demo.
  if (!cur.ok && cur.error === 'demo') cur = { ok: true, mode: null, undo: false };
  if (!cur.ok) return toast(errorText(cur.error));
  const offer = pcModeOffer(mode, cur.mode);
  const name = (m) => t(`chat.modeName.${m}`);
  const dialog = $('#confirmDialog');
  const done = async (fn) => {
    const res = await fn();
    dialog.close();
    if (!res.ok) return toast(errorText(res.error));
    return toast(res.mode ? t('pcmode.done', { mode: name(res.mode) }) : t('pcmode.undone'));
  };
  dialog.replaceChildren(h('form', { method: 'dialog', class: 'confirm pc-mode' },
    h('h2', {}, t('pcmode.title', { mode: name(mode) })),
    h('p', {}, cur.mode ? t('pcmode.now', { mode: name(cur.mode) }) : t('pcmode.nowNone')),
    h('p', {}, t('pcmode.explain')),
    h('p', { class: 'muted' }, t('pcmode.safety')),
    offer.same ? h('p', { class: 'note' }, t('pcmode.same')) : null,
    h('div', { class: 'actions' },
      cur.undo ? h('button', { type: 'button', class: 'btn', onclick: () => done(() => api.undoSettingsMode()) }, t('pcmode.undo')) : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('confirm.cancel')),
      h('button', { type: 'button', class: 'btn primary', disabled: offer.same || !offer.mode, onclick: () => done(() => api.setSettingsMode(mode)) }, t('pcmode.confirm', { mode: name(mode) })))));
  dialog.showModal();
  dialog.querySelector('.primary:not(:disabled), .btn')?.focus();
  return undefined;
}

// ---- projects, polling, views ---------------------------------------------------------------

function refreshMarks() {
  liveEntries = workingIn(shown, tree, Date.parse(state.generatedAt), { visitors: true });
  marks = { live: livePaths(liveEntries).nodes, branches: branchMarks(shown), clashes: clashMarks(shown, ignoredClash) };
  convCounts = conversationCounts(project, tree, { showArchived });
}

function renderBanner() {
  const none = project.arch.source === 'none';
  $('#archBanner').hidden = !none;
  $('#newIdea').disabled = !hasMap();
  document.body.classList.toggle('no-map', !hasMap());
  $('#newIdea').title = hasMap() ? t('idea.hint') : t('idea.noMap');
  if (none) $('#archBannerList').replaceChildren(...['arch.bannerFolder', 'arch.bannerReadme', 'arch.bannerParts'].map((k) => h('li', {}, t(k))));
}

function setProject(id) {
  const before = project?.id;
  project = state.projects.find((p) => p.id === id) || state.projects[0];
  if (project.id !== before) convs.projectChanged();
  ignoredClash = parseIgnored(store.get(clashIgnoredKey(project.id)));
  shown = visibleProject(project, showArchived);
  tree = archTree(shown);
  refreshMarks();
  loadOpen();
  loadRange(project.id);
  renderChanged();
  ignoredRel = parseIgnored(store.get(ignoredKey(project.id)));
  relLit = null;
  store.set('sm.project', project.id);
  closePanel(false);
  chat.showProject(project.id);
  if (chat.isOpen() && pointNode && !nodeById(tree, pointNode)) chat.close();
  renderSummary();
  renderBanner();
  renderWaiting();
  $('#notice').hidden = true;
  renderMap();
  convs.render();
  live.render();
  renderNow();
  requestAnimationFrame(() => activeMap().fit(false));
  refreshView();
}

function setArchived(on) {
  showArchived = on;
  store.set('sm.archived', on ? '1' : '0');
  shown = visibleProject(project, showArchived);
  tree = archTree(shown);
  refreshMarks();
  renderSummary();
  renderMap();
  convs.render();
  refreshView();
  rerender();
}

function renderNoProjects() {
  $('#summary').replaceChildren();
  renderNow();
  $('#notice').replaceChildren(h('strong', {}, t('state.noProjectsTitle')), h('span', {}, t('state.noProjects')));
  $('#notice').hidden = false;
  document.body.classList.add('is-empty');
}

function renderAll() {
  applyStaticText();
  if (!state) return;
  renderWaiting();
  if (!state.projects.length) return renderNoProjects();
  document.body.classList.remove('is-empty');
  const sel = selection;
  setProject(project?.id || store.get('sm.project'));
  if (sel && sel.type !== 'node') select(sel);
  return undefined;
}

function applyState(next) {
  const before = project;
  state = next;
  trackUnseen();
  renderWaiting();
  if (!state.projects.length) return renderNoProjects();
  if (!before || document.body.classList.contains('is-empty')) return renderAll();
  project = state.projects.find((p) => p.id === before.id) || state.projects[0];
  if (project.id !== before.id) return setProject(project.id);
  shown = visibleProject(project, showArchived);
  tree = archTree(shown);
  refreshMarks();
  renderSummary();
  renderBanner();
  renderMap();
  convs.render();
  live.render();
  renderNow();
  if (!editing) rerender();
  refreshView();
  return undefined;
}

let polling = null;
function poll() {
  if (polling) return polling;
  polling = (async () => {
    const res = await api.state();
    if (res.ok) {
      const { ok, status, error, ...next } = res;
      applyState(next);
      if (next.refreshing) setTimeout(poll, 2000);
    } else if (state) {
      toast(t('state.offline'));
    }
  })().finally(() => { polling = null; });
  return polling;
}

function showView(name) {
  view = VIEWS.includes(name) ? name : 'map';
  for (const v of VIEWS) $(`#tab-${v}`).setAttribute('aria-current', v === view ? 'page' : 'false');
  document.body.dataset.view = view;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.id !== `view-${view}`;
  if (view === 'discover') discover.show();
  else $('#discover').hidden = true;
  if (view !== 'map') { closePanel(false); chat.close(); closeLists(); }
  if (view !== 'flow') flow.hide();
  store.set('sm.view', view);
  refreshView(true);
}

function refreshView(first = false) {
  if (!state?.projects.length) return;
  if (view === 'flow') {
    if (first) flow.show();
    else flow.refresh();
    return;
  }
  if (!['board', 'history', 'costs'].includes(view)) return;
  const root = $(`#view-${view}`);
  if (first) tabs.render(view, root);
  else tabs.refresh(view, root);
}

// ---- search ---------------------------------------------------------------------------------

function closeResults() {
  $('#searchResults').hidden = true;
  $('#search').setAttribute('aria-expanded', 'false');
}

function pickHit(id) {
  closeResults();
  revealNode(id, { center: true });
  requestAnimationFrame(() => activeMap().focus(id));
}

function renderResults() {
  const hits = searchTree(tree, query).slice(0, SEARCH_MAX);
  const box = $('#searchResults');
  if (!query) {
    closeResults();
    renderMap();
    return;
  }
  box.replaceChildren(...(hits.length ? hits.map((m, i) => {
    const node = nodeById(tree, m.id);
    return h('li', { role: 'option', id: `hit-${i}` }, h('button', { type: 'button', class: `hit k-${node.kind}`, tabindex: '-1', onclick: () => pickHit(m.id) },
      h('span', { class: 'hit-title' }, node.label),
      h('span', { class: 'hit-path' }, m.path.slice(1).map((id) => nodeById(tree, id).label).join(' › ') || project.name)));
  }) : [h('li', { class: 'hit-none' }, t('search.none'))]));
  box.hidden = false;
  $('#search').setAttribute('aria-expanded', 'true');
  renderMap();
}

// ---- wiring ---------------------------------------------------------------------------------

let discover = null;
let chat = null;
let files = null;
let tabs = null;
let mindmap = null;
let outline = null;
let flow = null;
let convs = null;
let live = null;
let alerts = null;
let now = null;
let picker = null;

// A click on an alert: its project, then its conversation (one alert) or the waiting list (a clash).
function openFromAlert(group) {
  const target = state?.projects.find((p) => p.id === group.projectId);
  if (!target) return;
  if (view !== 'map') showView('map');
  if (project?.id !== target.id) setProject(target.id);
  const [first] = group.alerts;
  if (group.kind === 'clash') return openWaiting();
  if (group.alerts.length !== 1 || !first.sessionId) return undefined;
  const out = listConversations(state, { projectId: target.id, scope: 'all', showArchived: true });
  const hit = [...out.working, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === first.sessionId);
  return hit ? openConversation(hit) : toast(t('alert.notFound'));
}

function wire() {
  for (const b of document.querySelectorAll('.lang button')) {
    b.addEventListener('click', () => {
      if (!LANGS[b.dataset.lang] || b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      t = translator(lang, { tech });
      store.set('sm.lang', lang);
      renderAll();
      refreshView(true);
    });
  }
  document.body.classList.toggle('is-tech', tech);
  tour = createTour({ h, t: () => t, phone: () => PHONE.matches, onEnd: (how) => store.set('sm.tour', how) });
  help = createHelp({
    h, t: () => t, plain: () => translator(lang), tech: () => translator(lang, { tech: true }), getTech: () => tech,
    setTech: (on) => {
      tech = on;
      document.body.classList.toggle('is-tech', tech);
      store.set('sm.tech', on ? '1' : '0');
      t = translator(lang, { tech });
      renderAll();
      refreshView(true);
    },
    onTour: () => tour.start(),
  });
  rangePicker = createRangePicker({ h, icon, t: () => t, lang: () => lang, phone: PHONE, now: () => (state ? rangeNow() : Date.now()), get: () => rangeSel, set: setRange });
  const mapCtx = {
    content: boxContent, signature, toggleLabel,
    onPick: (node) => openPoint(node),
    onToggle: toggleNode,
    count: boxCount,
    onCount: (node) => convs.filterTo(convs.filterNode() === node.id ? null : node.id),
    onLink: (l) => select({ type: 'link', id: `${l.a}|${l.b}` }),
    linkLabel: (l) => t('link.aria', { a: partById(l.a)?.name ?? l.a, b: partById(l.b)?.name ?? l.b }),
    linkTip: (l) => relationTip(l, partName, (n) => t.count('link.reasons', n)),
    freeArea,
  };
  mindmap = createMindmap($('#mindmap'), mapCtx);
  outline = createOutline($('#outline'), mapCtx);
  discover = createDiscover({
    root: $('#discover'), h, t: () => t, lang: () => lang, toast, icon,
    project: () => (project ? { id: project.id, name: project.name } : null),
  });
  chat = createChat({
    root: $('#chat'), h, t: () => t, toast, errorText, relative, money, lang: () => lang, icon, commands: chatCommands,
    onSession: () => { convs.render(); setTimeout(poll, 1200); },
    onPcMode: pcMode,
    onClose: () => {
      pointNode = null;
      if (selection?.type === 'node') selection = null;
      renderMap();
      convs.render();
    },
  });
  convs = createConvList({
    root: $('#convs'), h, t: () => t, icon, relative, money, list: listText, phone: PHONE, store,
    state: () => state, project: () => project, showArchived: () => showArchived, current: () => chat.current(),
    nodeLabel: (id) => (tree ? nodeById(tree, id)?.label ?? null : null),
    onOpen: openConversation,
    // A visitor (mm24) is moved and renamed from the project it was born in.
    onMove: (e) => openPlace({ ...e, project: e.home ?? e.project }),
    onFilter: () => renderMap(),
  });
  now = createNowStrip({
    root: $('#now'), line: $('#nowLine'), counts: $('#nowCounts'), cards: $('#nowCards'), h, t: () => t, icon, relative, list: listText, phone: PHONE, store,
    onOpen: openFromLive,
  });
  picker = createProjectPicker({
    root: $('#projectPicker'), button: $('#project'), list: $('#projectList'), name: $('#projectName'), marks: $('#projectMarks'), h, t: () => t, icon,
    onPick: (id) => setProject(id),
  });
  live = createLivePanel({
    root: $('#liveList'), button: $('#liveBtn'), h, t: () => t, icon, relative,
    state: () => state, project: () => project, onShow: showOnMap, onOpen: openFromLive,
  });
  alerts = createAlerts({
    stack: $('#alertStack'), bell: $('#alertsBtn'), dialog: $('#alertsDialog'), h, t: () => t, lang: () => lang, icon, api, store, toast, errorText,
    projects: () => (state?.projects ?? []).map((p) => ({ id: p.id, name: p.name })),
    onOpen: openFromAlert,
    onAlerts: (fresh) => {
      // A job that finished while the page was closed or on another project is still "finished and not seen".
      for (const a of fresh) if (a.kind === 'finished' && a.sessionId && a.sessionId !== (chat.isOpen() ? chat.current() : null)) unseen.add(a.sessionId);
      saveUnseen();
      setTimeout(poll, 400);
    },
    pending: () => (jobs ? pendingCount(jobs) : 0),
  });
  createResizer({ sheet: $('#chat'), handle: $('#chatResize'), target: $('#stage'), cssVar: '--chat-w', storageKey: 'sm.chatWidth', defaultWidth: () => CHAT_WIDTH });
  flow = createFlowView({
    h, t: () => t, toast, errorText, relative, money, phone: PHONE, onPcMode: pcMode, lang: () => lang, icon, commands: chatCommands,
    project: () => project, tree: () => tree, live: () => marks.live,
    onOpenPart: (partId) => openPartPoint(partId),
    onApplied: () => setTimeout(poll, 600),
  });
  files = createFiles({ dialog: $('#fileDialog'), h, t: () => t, toast, errorText, project: () => project });
  tabs = createTabs({
    h, t: () => t, lang: () => lang, fmt: { money, shortDate, relative }, icon,
    state: () => state, project: () => project, go: goTo, toast, errorText, confirm: confirmAction,
    prefs: { archived: () => showArchived, setArchived },
    range: () => activeRange(), rangeButton: () => rangePicker.button(),
  });
  for (const v of VIEWS) $(`#tab-${v}`).addEventListener('click', () => showView(v));
  $('#waitingBtn').addEventListener('click', () => ($('#waitingList').hidden ? openWaiting() : closeLists()));
  $('#liveBtn').addEventListener('click', () => (live.isOpen() ? closeLists() : openLive()));
  for (const b of document.querySelectorAll('[data-close="panel"], [data-close="waiting"], [data-close="live"], [data-close="rel"]')) {
    b.addEventListener('click', () => (b.dataset.close === 'panel' ? closePanel() : closeLists()));
  }
  $('#ptab-chat').addEventListener('click', () => setPointTab('chat'));
  $('#ptab-details').addEventListener('click', () => { setPointTab('details'); renderPointDetails(); });
  $('#pointTabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = $('#chat').dataset.tab === 'details' ? 'chat' : 'details';
    setPointTab(next);
    if (next === 'details') renderPointDetails();
    $(`#ptab-${next}`).focus();
  });
  $('#fit').addEventListener('click', () => mindmap.fit(true));
  $('#newIdea').addEventListener('click', openIdea);
  $('#createArch').addEventListener('click', createArch);
  for (const b of $('#waitingScope').querySelectorAll('[data-scope]')) {
    b.addEventListener('click', () => {
      waitingScope = b.dataset.scope === 'all' ? 'all' : 'project';
      store.set('sm.waiting.scope', waitingScope);
      renderWaiting();
    });
  }
  $('#relations').addEventListener('click', () => {
    // With the lines on and the list closed, the button brings the list back; a second press turns the lines off.
    const reopen = relationsOn && $('#relList').hidden && !PHONE.matches;
    relationsOn = reopen || !relationsOn;
    store.set('sm.relations', relationsOn ? '1' : '0');
    if (relationsOn && !PHONE.matches) openRelList();
    else hideRelList();
    renderMap();
  });
  $('#zoomIn').addEventListener('click', () => mindmap.zoomBy(1.4));
  $('#zoomOut').addEventListener('click', () => mindmap.zoomBy(1 / 1.4));
  const search = $('#search');
  search.addEventListener('input', () => { query = search.value.trim(); renderResults(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = searchTree(tree, query)[0];
      if (first) pickHit(first.id);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      search.value = '';
      query = '';
      renderResults();
    }
  });
  search.addEventListener('blur', () => setTimeout(() => { if (!$('#searchBox').contains(document.activeElement)) closeResults(); }, 150));
  search.addEventListener('focus', () => { if (query) renderResults(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#confirmDialog').open || $('#installDialog').open || $('#fileDialog').open || $('#flowDialog').open || $('#alertsDialog').open || $('#placeDialog').open) return;
    if (picker.isOpen()) picker.close();
    else if (now.isOpen()) now.close();
    else if (convs.isDrawerOpen()) convs.closeDrawer();
    else if (!$('#waitingList').hidden || live.isOpen() || !$('#relList').hidden) closeLists();
    else if (chat.isOpen()) chat.close();
    else closePanel();
  });
  PHONE.addEventListener('change', () => { if (project) { renderMap(); activeMap().fit(false); } });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (project && !PHONE.matches) mindmap.fit(false); }, 200);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) poll(); });
  setInterval(() => { if (!document.hidden && state) poll(); }, POLL_MS);
}

// Deep link for screenshots and sharing a view: ?view=<tab>&project=<id>&open=<ids|all>&select=node:<id> (or chat:, workcell:,
// link:, project:)&tab=details&relations=1&changed=d7&q=<search>&conv=<sessionId>&convfilter=<box id>&drawer=1&live=1&alerts=1.
function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('project')) setProject(params.get('project'));
  if (params.has('relations')) relationsOn = params.get('relations') === '1';
  if (params.has('changed')) { rangeSel = parseSel(params.get('changed')); store.set(rangeKey(project.id), serializeSel(rangeSel)); }
  const openParam = params.get('open');
  if (openParam === 'all') {
    const walk = (n) => { if (n.children.length) open.add(n.id); n.children.forEach(walk); };
    walk(tree);
  } else if (openParam) for (const id of openParam.split(',')) open.add(id);
  if (params.has('q')) {
    query = params.get('q');
    $('#search').value = query;
  }
  renderChanged();
  renderMap();
  requestAnimationFrame(() => activeMap().fit(false));
  const pick = params.get('select') || '';
  const cut = pick.indexOf(':');
  if (cut > 0) {
    const type = pick.slice(0, cut), id = pick.slice(cut + 1);
    if (type === 'node') {
      const node = nodeById(tree, id);
      if (node) setTimeout(() => openPoint(node, { tab: params.get('tab') === 'details' ? 'details' : 'chat' }), 60);
    } else setTimeout(() => select({ type, id }), 60);
  }
  if (params.get('idea') === '1') setTimeout(openIdea, 60);
  // &conv=<sessionId> opens a conversation as the list does; &convfilter=<box id> and &drawer=1 show the list's states.
  const conv = params.get('conv');
  if (conv) {
    const out = listConversations(state, { projectId: project.id, scope: 'all', showArchived: true });
    const hit = [...out.working, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === conv);
    if (hit) setTimeout(() => openConversation(hit), 80);
  }
  if (params.get('convfilter')) setTimeout(() => convs.filterTo(params.get('convfilter')), 60);
  if (params.get('drawer') === '1') setTimeout(() => convs.openDrawer(), 60);
  if (params.get('live') === '1') setTimeout(openLive, 60);
  if (params.get('alerts') === '1') setTimeout(() => alerts.openSettings(), 200);
  // &place=<sessionId> opens "Move or rename"; &picker=1 opens the project list; &nowopen=1 opens the Now list on a phone.
  const placeId = params.get('place');
  if (placeId) {
    const out = listConversations(state, { projectId: project.id, scope: 'all', showArchived: true });
    const hit = [...out.working, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === placeId);
    if (hit) setTimeout(() => openPlace(hit), 120);
  }
  if (params.get('picker') === '1') setTimeout(() => $('#project').click(), 120);
  if (params.get('nowopen') === '1') setTimeout(() => $('#nowLine').click(), 120);
  if (params.get('pcmode')) setTimeout(() => pcMode(params.get('pcmode')), 300);
  const tab = params.get('view');
  if (tab) showView(tab);
  // ?view=flow&flowmode=workshop&flowtool=box&flowtext=1, or &flowimport=1: the Flow tab's states, for screenshots.
  if (view === 'flow') {
    (async () => {
      if (params.get('flowmode') === 'workshop') await flow.setMode('workshop');
      if (params.get('flowtool')) flow.openTool(params.get('flowtool'));
      if (params.get('flowtext') === '1') flow.openText();
      if (params.get('flowimport') === '1') flow.openImport();
    })();
  }
}

async function main() {
  applyStaticText();
  wire();
  const notice = $('#notice');
  notice.textContent = t('state.loading');
  notice.hidden = false;
  const res = await api.state();
  for (const el of document.querySelectorAll('.skeleton')) el.remove();
  if (!res.ok) {
    notice.textContent = res.error === 'token-required' ? t('err.token-required') : t('state.error');
    notice.classList.add('is-error');
    return;
  }
  const { ok, status, error, ...first } = res;
  state = first;
  trackUnseen();
  alerts.start();
  notice.hidden = true;
  renderAll();
  if (state.projects.length) {
    const params = new URLSearchParams(location.search);
    const saved = store.get('sm.view');
    if (saved && saved !== 'map' && VIEWS.includes(saved) && !params.get('view') && !params.get('select')) showView(saved);
    applyDeepLink();
    // A reload keeps the conversation that was open in the sheet.
    if (view === 'map' && !params.get('select')) chat.restore(project.id);
    // The welcome tour plays once by itself on the first visit; the help menu plays it again.
    if (tourWanted(store.get('sm.tour'))) setTimeout(() => tour.start(), 600);
  }
}

main();
