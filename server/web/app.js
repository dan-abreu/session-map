import { LANGS, pickLang, translator } from './i18n.js';
import {
  archTree, defaultOpen, nodeById, ancestorsOf, searchTree, changedNodes, branchMarks, clashMarks, clashChip, relationLinks, ownerHue, initial, countLabel, listsDone, isPerson,
  sizeOf, shareText, chatPointOf, noFiles,
} from './tree.js';
import { createMindmap } from './mindmap.js';
import { liveBadge } from './itemlive.js';
import { mapFileName, outlineOf, freeMindOf, xmindOf } from './mmexport.js';
import { saveBlob } from './flowexport.js';
import { createOutline } from './outline.js';
import { createDiscover } from './discover.js';
import { api } from './api.js';
import { createChat } from './chat.js';
import { createRunSettings } from './runsettings.js';
import { createTabs } from './tabs.js';
import { createFiles } from './files.js';
import { createRepoSide } from './reposide.js';
import { branchWhy, placedWhy } from './placedwhy.js';
import { createChangesView, freshFor } from './changes.js';
import { createRequestsView } from './requestsview.js';
import { createResizer, createSplit } from './resize.js';
import { createFlowView } from './flowview.js';
import { conversationsOf, createConvList, conversationCounts, listConversations, offMapNote, projectChats, projectHue, visitorsOf } from './convlist.js';
import { jobBadges, needsYou, nextUnseen, nowJobs, pendingCount } from './now.js';
import { createMenu } from './menu.js';
import { orchChip, orchSection, orchState } from './orchview.js';
import { budgetSection } from './budgetview.js';
import { createProjectPicker } from './picker.js';
import { createLivePanel, workingIn, livePaths, captionsAt, stepWords, placeWords, modelName } from './live.js';
import { agentDots, dotsAt, useTeamHues, workflowView } from './workflows.js';
import { createAlerts } from './alerts.js';
import { createAiHelpers } from './aihelpers.js';
import { applyLook, createLookShare } from './lookshare.js';
import { createCutPanel } from './cutoff.js';
import { visibleProject, chatButtons, waitingEntries, waitingSections, waitingCounts, waitingKind, clashWords, safeTunnel, pcModeOffer } from './views.js';
import { createRangePicker } from './rangepicker.js';
import { signalCard, kindBlock, kindMark, pointStrip } from './blocks.js';
import { emptyState } from './empty.js';
import { costWhyNote } from './costwhy.js';
import { createTour, tourWanted } from './tour.js';
import { AREAS, LOOK_AREAS, deepLinkParams, normalizeView } from './nav.js';
import { createNavbar } from './navbar.js';
import { createAreas, sectionOf } from './areas.js';
import { minuteOf, stateSigs } from './statesig.js';
import { createHelp } from './help.js';
import { clashSignal, waitingSignal, blocksSignal, relationSignal, costSignal, clashKey, signalWords } from './signals.js';
import { INFO_KINDS, CHAT_TAB, pointTabs, projectTabs, openingTab, kindDigest, lookTabs } from './kinds.js';
import { inRange, parseSel, resolveRange, serializeSel, spanWords } from './range.js';
import { repoNameOf } from './reponame.js';
import {
  declaredPairs, isDeclared, parseIgnored, relationKey, relationTip, relationWhy, serializeIgnored, sortRelations, splitIgnored, strengthOf,
} from './relations.js';

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 5000;
const PHONE = window.matchMedia('(max-width: 719px)');
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
let viewSub = null; // the sub-tab asked for with the area (Conversations > Board or History), handed to its view once
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
  renderChanged();
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
let waitingScope = store.get('sm.waiting.scope') === 'all' ? 'all' : 'project'; // the decisions on the map follow the open project unless asked
let query = '';
let marks = { live: new Set(), branches: new Map(), clashes: new Map() };
let convCounts = new Map();
let liveEntries = []; // the conversations working now in the open project (live.js workingIn)
// The helpers of every team at work on a box of the open project (workflows.js agentDots), and where the map shows them.
let agentMarks = new Map();
let dotsShown = new Map();
// Conversations that finished since the person last looked at them (mm10): kept across reloads until opened.
const UNSEEN_KEY = 'sm.unseen';
const UNSEEN_MAX = 200;
let unseen = new Set();
try { unseen = new Set((JSON.parse(store.get(UNSEEN_KEY) ?? '[]') ?? []).filter((id) => typeof id === 'string')); } catch { unseen = new Set(); }
let lastStatuses = null;
let jobs = null; // now.js nowJobs: every job on the PC, for the picker's marks and the tab title
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
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-checked', String(b.dataset.lang === lang));
  renderChanged();
  discover?.relabel();
  chat?.relabel();
  flow?.relabel();
  alerts?.relabel();
  aiHelpers?.relabel();
  runSettings?.relabel();
  picker?.relabel();
  navbar?.render();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// A real <dialog> for the irreversible actions (Stop a conversation, Delete from history). focus 'cancel': it opens on
// Cancel, for an action the page cannot undo (Delete from session-map), so a stray Enter does not confirm it.
function confirmAction(text, label, { focus } = {}) {
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
    dialog.querySelector(focus === 'cancel' ? '.btn:not(.danger)' : '.danger').focus();
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

// The status robot's badge on an item (sb13): working now, or built on main and not ticked.
function liveChip(i) {
  const b = liveBadge(i.live, t);
  return b ? h('span', { class: `bx-chip is-live-${b.kind}`, title: b.title }, b.text) : null;
}

function itemBody(node) {
  const i = node.item;
  return [
    h('span', { class: 'bx-head' }, h('span', { class: `bx-status st-${i.status}`, title: t(`item.status.${i.status}`) }, h('span', { class: 'visually-hidden' }, t(`item.status.${i.status}`))), h('span', { class: 'bx-title' }, node.label)),
    h('span', { class: 'bx-meta' },
      i.status === 'doing' ? h('span', { class: 'bx-chip is-doing' }, t('item.status.doing')) : null,
      liveChip(i),
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
  // The box is a button, so its "?" is a mark with the reason in the title and for screen readers; the sheet has the real one.
  if (noFiles(project.arch.sizes, node)) {
    return h('span', { class: 'bx-size is-none', title: t('help.nofiles') }, icon('file', 'bx-size-icon'), h('span', {}, t(`size.none.${node.kind}`)),
      h('span', { class: 'bx-q', 'aria-hidden': 'true' }, '?'), h('span', { class: 'visually-hidden' }, t('help.nofiles')));
  }
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
// openable: a click opens the file in the viewer (a binary file has nothing to read).
const pathList = (paths, n, { openable = true } = {}) => (paths.length ? h('ul', { class: 'plain rows pf-paths' },
  paths.slice(0, PATHS_SHOWN).map((path) => h('li', {}, openable ? files.pathRow(path) : h('code', { class: 'path' }, path))),
  n > PATHS_SHOWN ? h('li', { class: 'muted' }, t('files.morePaths', { n: numText(n - PATHS_SHOWN) })) : null) : null);

// The project panel's files: the whole program as a folder tree to open any file, the files no box owns (to give them
// one) and what was left out of the count, by reason.
function programFiles(sizes) {
  if (!sizes?.total) return null;
  const unowned = sizes.unowned.files;
  return kblock('files', { title: t('files.program'), from: t('files.programFrom') },
    h('p', { class: 'pf-lead num' }, t('files.programLead', { files: plural('size.files', sizes.total.files), lines: plural('size.lines', sizes.total.lines) })),
    files.tree({ all: true }),
    h('h4', { class: `pf-head${unowned ? ' is-unowned' : ''}` }, unowned ? plural('size.unowned', unowned) : t('files.allOwned')),
    unowned ? h('p', { class: 'muted small' }, t('files.unownedHint')) : null,
    pathList(sizes.unowned.paths, unowned),
    h('h4', { class: 'pf-head' }, t('files.left')),
    ['dep', 'generated', 'binary'].map((k) => (sizes.left[k].files
      ? h('details', { class: 'pf-left' }, h('summary', {}, t(`files.left.${k}`, { n: numText(sizes.left[k].files) })), pathList(sizes.left[k].paths, sizes.left[k].files, { openable: k !== 'binary' }))
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

// "+N files +M lines now" (mm30): what changed in the box in the last minutes, the way to the Changes tab.
function freshOfNode(node) {
  const partIds = node.kind === 'layer' ? node.children.filter((c) => c.kind === 'part').map((c) => c.partId) : undefined;
  return freshFor(project.fresh ?? null, { kind: node.kind, partId: node.partId, partIds });
}

// The root bubble opens the project chats: the chip says how many there are, or invites the first one.
function projectChatChip() {
  const n = projectChats(project).length;
  return h('span', { class: 'bx-chip is-projchat' }, icon('chat', 'bx-chip-icon'), n ? t.count('projchat.count', n) : t('projchat.start'));
}

function freshChip(node) {
  const fresh = freshOfNode(node);
  if (!fresh) return null;
  const files = plural('box.nowFiles', fresh.files);
  const lines = plural('box.nowLines', fresh.lines);
  // A rename moves no line: the chip says only the files then.
  const words = fresh.lines ? t('box.now', { files, lines }) : t('box.nowOnly', { files });
  return h('span', { class: 'bx-chip is-fresh', title: t('box.nowTitle', { files, lines }) }, h('span', { class: 'bx-fresh-dot', 'aria-hidden': 'true' }), words);
}

// One dot per helper at work on the box, in its team's colour (mm31); the tooltip says who, which team and its last step.
function agentDotsView(node) {
  const dots = dotsShown.get(node.id);
  if (!dots?.length) return null;
  const words = dots.map((d) => t('wf.dotTitle', { label: d.label || t('live.agentUnnamed'), team: d.workflowName, step: stepWords(t, d.step) || t('chat.busy') }));
  return h('span', { class: 'bx-agents', title: words.join('\n') },
    dots.slice(0, AGENT_DOTS_MAX).map((d) => h('span', { class: 'bx-agent', style: `--wf-h:${d.hue}`, 'aria-hidden': 'true' })),
    h('span', { class: 'bx-agents-n num', 'aria-hidden': 'true' }, t.count('wf.dotsShort', dots.length)),
    h('span', { class: 'visually-hidden' }, `${t.count('wf.dotsAria', dots.length)}: ${words.join('; ')}`));
}
const AGENT_DOTS_MAX = 6;
const dotsSig = (node) => (dotsShown.get(node.id) ?? []).map((d) => `${d.agentId}:${d.hue}:${d.step?.target ?? ''}`).join(',');

function boxContent(node) {
  const live = marks.live.has(node.id) ? liveDot() : null;
  const agents = agentDotsView(node);
  if (node.kind === 'item') return [...itemBody(node), agents, live].filter(Boolean);
  const c = node.counts;
  if (node.kind === 'project') {
    const sub = hasMap() ? countText(c) : t.count('summary.chats', shown.chats.length);
    return [h('span', { class: 'bx-title' }, node.label), h('span', { class: 'bx-meta' }, sub), projectChatChip(), orchChip({ h, icon, t }, orchState(project)), sizeLine(node), unownedChip(node), freshChip(node), agents, hasMap() ? progress(c) : null, live].filter(Boolean);
  }
  return [
    h('span', { class: 'bx-title' }, node.label),
    h('span', { class: 'bx-meta' }, h('span', { class: 'num' }, countText(c)), ...chipsOf(c), ...(node.kind === 'part' ? partBadges(node) : []), footChip(node)),
    sizeLine(node),
    freshChip(node),
    agents,
    c.total ? progress(c) : null,
    live,
  ].filter(Boolean);
}

function signature(node) {
  const part = node.kind === 'part' ? node.part.id : null;
  return JSON.stringify([lang, node.label, node.counts, node.item?.status, node.item?.who, node.item?.weight, node.item?.code, node.item?.live, marks.live.has(node.id),
    part && marks.branches.get(part), part && marks.clashes.get(part), node.kind === 'project' && shown.chats.length, node.kind === 'project' && projectChats(project).length, node.kind === 'project' && JSON.stringify(orchState(project)),
    sizeOf(project.arch?.sizes, node), node.kind === 'project' && project.arch?.sizes?.unowned?.files, part && footShares()?.get(part), freshOfNode(node), dotsSig(node)]);
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
  dotsShown = dotsAt((nodeId) => open.has(nodeId), agentMarks, tree);
  const range = activeRange();
  const selected = selectedNodeId();
  // A file or folder pointed at on the files side lights its parts, over what a period lights (mm40).
  const left = PHONE.matches ? null : repoSide?.view({ tree, selected, opens: selection?.type === 'node', working: liveEntries }) ?? null;
  const lit = left?.hoverLit ?? (range ? changedNodes(shown, tree, range.from, range.to) : null);
  const match = query ? new Set(searchTree(tree, query).map((m) => m.id)) : null;
  return { open, selected, live: marks.live, captions: liveCaptions(), lit, match, relations: relationsOn && !PHONE.matches ? splitIgnored(relationLinks(shown), ignoredRel).shown : null, relLit, left };
}

const activeMap = () => (PHONE.matches ? outline : mindmap);

function renderMap(opts) {
  if (!project) return;
  activeMap().render(tree, mapView(), opts);
  $('#relations').setAttribute('aria-checked', String(relationsOn));
  $('#relations').hidden = !relationLinks(shown).length;
  renderViewOn();
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

// "What changed" inside Vista (mm48): the three periods asked for most, one press each, and the period picker for the
// rest (its button names the period when it is none of the three).
const QUICK_RANGES = ['all', 'today', 'd7'];
function renderChanged() {
  if (!rangePicker) return;
  const slot = $('#changed');
  const focused = slot.contains(document.activeElement) ? document.activeElement.dataset.preset ?? 'more' : null;
  const quick = QUICK_RANGES.map((preset) => h('button', {
    type: 'button', role: 'menuitemradio', 'aria-checked': String(rangeSel.preset === preset), title: t('changed.hint'), 'data-preset': preset,
    onclick: () => { if (rangeSel.preset !== preset) setRange({ preset }); },
  }, t(`range.${preset}`)));
  const more = rangePicker.button('vm-range', { quick: QUICK_RANGES });
  more.setAttribute('role', 'menuitem');
  more.title = t('changed.hint');
  slot.replaceChildren(h('div', { class: 'vm-seg' }, quick), more);
  // A press on a period redraws the row: the focus stays on the same choice, so the arrows go on from there.
  if (focused) (focused === 'more' ? more : quick[QUICK_RANGES.indexOf(focused)])?.focus();
  renderViewOn();
}

// The Vista button says when the map is not showing everything plainly: a period or the relations are on (mm48).
function renderViewOn() {
  const on = rangeSel.preset !== 'all' || relationsOn;
  $('#viewOn').hidden = !on;
  $('#viewBtn').classList.toggle('is-on', on);
}

// ---- summary and the waiting list ------------------------------------------------------

// The quiet line over the map (mm48): the project, how much is done, and only when it applies "paused" or "organizing";
// who works now is the live button right after it. The parts are on the map and the cost of 30 days rides on the
// project's tooltip (Home and Costs show it in full).
function renderSummary() {
  const parts = [h('button', { type: 'button', class: 'summary-project', title: `${t('project.open')} · ${t('summary.cost', { v: money(project.cost.d30) })}`, onclick: () => select({ type: 'project' }) }, project.name)];
  if (hasMap()) parts.push(h('span', { class: 'num' }, listsDone(tree) ? t('summary.done', { done: tree.counts.done, total: tree.counts.total }) : t.count('summary.open', tree.counts.total)));
  if (project.background && !project.background.on) parts.push(h('span', { class: 'bg-paused', title: t('background.paused.hint') }, t('background.paused')));
  if (state.refreshing) parts.push(h('span', { class: 'organizing', role: 'status' }, t('state.refreshing')));
  $('#summary').replaceChildren(...joinDots(parts));
  renderKeep(project);
}

// The map's own work (the AI placing conversations, the count of the files) runs only where someone works now, or on a
// project the person keeps always up to date: "paused" in the summary says why nothing moves, the switch in Vista lets
// them choose and says that it costs (mm48).
function renderKeep(p) {
  const bg = p.background;
  $('#bgKeep').hidden = !bg;
  if (!bg) return;
  const btn = $('#bgSwitch');
  btn.setAttribute('aria-checked', String(bg.always));
  btn.title = t(bg.always ? 'background.always.hint' : 'background.keep.hint');
}

// While it saves the switch says it is busy but keeps the focus (a disabled button would drop it to the page).
async function setBackground(p, always, btn) {
  btn.setAttribute('aria-disabled', 'true');
  const res = await api.setProjectBackground(p.id, always);
  if (!res.ok) { btn.removeAttribute('aria-disabled'); return toast(errorText(res.error)); }
  toast(t(always ? 'background.saved.always' : 'background.saved.auto'));
  await poll();
  btn.removeAttribute('aria-disabled');
}

// ---- every job on the PC: the picker's marks and the tab title (the Now strip left the page, mm47) --------

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
  convs?.render();
}

function renderNow() {
  if (!state) return;
  jobs = nowJobs(state, { unseen });
  if (project) picker.update(state.projects.map((p) => ({ id: p.id, name: p.name, hue: projectHue(p) })), project.id, jobBadges(jobs));
  alerts.refreshTitle();
  cutPanel?.render(state);
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

// An activity of a request, opened from the Requests tab: the map of its project, on its item.
function openRequestItem(projectId, code) {
  goTo(projectId);
  const find = (n) => (n.kind === 'item' && n.item.code === code ? n : (n.children ?? []).map(find).find(Boolean) ?? null);
  const found = find(tree);
  if (found) requestAnimationFrame(() => openPoint(found));
}

// Whether a conversation waits for the person by the pill's rule, for the chat's dot; null when the state does not list it.
function chatWaits(sessionId) {
  if (!state?.projects.some((p) => p.chats.some((c) => c.sessionId === sessionId))) return null;
  return needsYou(state).some((n) => n.chat.sessionId === sessionId);
}

// The amber pill and the list it opens (mm47): the pill counts needsYou, the one count of the page, and the list starts
// with exactly those conversations, from every project; under them, the decisions on the map, of the open project unless
// the person asks for all.
function renderWaiting() {
  const needs = needsYou(state);
  const n = needs.length;
  $('#waitingLabel').textContent = n ? t.count('needs.pill', n) : t('needs.none');
  $('#waitingBtn').classList.toggle('is-zero', n === 0);
  // The chat's dot follows the same rule as the pill.
  chat?.refreshDot();
  const several = state.projects.length > 1;
  const scoped = waitingScope === 'project' && several && !!project;
  const decisionsOf = (projectId) => waitingSections(state, needs, { projectId, ignored: ignoredClash }).decisions;
  const { chats, decisions } = waitingSections(state, needs, { projectId: scoped ? project.id : null, ignored: ignoredClash });
  const scopeEl = $('#waitingScope');
  scopeEl.hidden = !several;
  for (const b of scopeEl.querySelectorAll('[data-scope]')) {
    const all = b.dataset.scope === 'all';
    b.setAttribute('aria-pressed', String(all !== scoped));
    b.textContent = t(all ? 'waiting.scope.all' : 'waiting.scope.project', { n: (all ? decisionsOf(null) : project ? decisionsOf(project.id) : []).length });
  }
  const entries = [...chats, ...decisions];
  $('#waitingCounts').replaceChildren(...waitingCounts(entries).map(({ kind, n: count }) => h('li', { class: `wc-${kind}` }, t.count(`waiting.count.${kind}`, count))));
  const where = (withProject) => (p, partId) => {
    const part = partId && p.arch.parts.find((x) => x.id === partId);
    return [withProject ? p.name : null, part ? part.name : null].filter(Boolean).join(' · ');
  };
  const group = (key, count, extra) => h('li', { class: 'wl-group' }, h('h3', {}, t(key), h('span', { class: 'wl-group-n num' }, String(count))), extra);
  const rows = [];
  if (chats.length) rows.push(group('waiting.group.chats', chats.length), ...chats.map((entry) => waitingRow(entry, { where: where(several) })));
  if (decisions.length || several) rows.push(group('waiting.group.decisions', decisions.length, several ? scopeEl : null));
  rows.push(...decisions.map((entry) => waitingRow(entry, { where: where(several && !scoped) })));
  if (!entries.length) {
    const elsewhere = scoped ? decisionsOf(null).length : 0;
    rows.push(h('li', { class: 'empty' }, emptyState({ h, icon }, { art: 'check', title: t('waiting.noneTitle'), text: elsewhere ? t('waiting.noneHere', { n: elsewhere }) : t('waiting.none') })));
  }
  $('#waitingItems').replaceChildren(...rows);
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
  convs.closeDrawer();
  if (view !== 'map') showView('map');
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
  convs.closeDrawer();
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
  const hit = [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === entry.chat.sessionId);
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

// Delete (mm43) takes a conversation out of session-map only: the server never touches Claude Code's own file for it. Always asks first.
async function deleteConversation(row) {
  if (row.status === 'busy') return toast(errorText('busy'));
  if (!(await confirmAction(t('action.deleteConfirm', { title: row.title || t('chat.untitled') }), t('action.delete'), { focus: 'cancel' }))) return false;
  const ok = await runAction({ action: 'delete', sessionId: row.sessionId }, t('action.deleted'));
  if (ok && chat.isOpen() && chat.current() === row.sessionId) chat.close();
  return ok;
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

// ---- a point of the map: its information in tabs by kind on top, the chat about it always under it (mm07) --------------

let pointNode = null;
let pointTab = 'summary'; // Summary, Tasks, Conversations, Changes, Files
// While the person talks the information folds to one line, so the chat gets the room. Folded or unfolded by hand since
// the box opened, it stays as the person left it.
let infoFolded = false;
let foldByHand = false;
// The conversation each box showed last on this page: it keeps running when another box opens, and comes back whole when
// its box is clicked again.
const boxChats = new Map();
const boxKey = (nodeId) => `${project.id}|${nodeId}`;
const keepBoxChat = () => {
  if (pointNode && chat.current()) boxChats.set(boxKey(pointNode), { sessionId: chat.current(), title: $('#chatTitle').textContent });
};

function setPointTab(tab) {
  pointTab = tab;
  renderPointDetails();
}

function showPoint(node, tab, { folded = false } = {}) {
  pointNode = node.id;
  pointTab = tab;
  infoFolded = folded;
  foldByHand = false;
  $('#pointInfo').hidden = false;
  $('#pointSplit').hidden = false;
  renderPointDetails();
}

function setFolded(folded, { byHand = false } = {}) {
  if (!pointNode) return;
  infoFolded = folded;
  if (byHand) foldByHand = true;
  renderFold(nodeById(tree, pointNode));
}

// Folded, the line keeps what matters at a glance (open items, how many wait for the person, what blocks); open, it is
// the title of the information and the way to fold it.
function renderFold(node) {
  if (!node) return;
  const c = node.counts;
  const glance = node.kind === 'item' ? t('point.info')
    : [countText(c), c.withUser ? t.count('box.withYou', c.withUser) : null, c.blocks ? t.count('box.blocks', c.blocks) : null].filter(Boolean).join(' · ');
  $('#pointInfo').toggleAttribute('data-folded', infoFolded);
  $('#pointFold').setAttribute('aria-expanded', String(!infoFolded));
  $('#pointFoldText').textContent = infoFolded ? glance : t('point.info');
  $('#pointFoldHint').textContent = t(infoFolded ? 'point.unfold' : 'point.fold');
  $('#pointSplitLabel').textContent = t('point.chatAbout', { name: node.kind === 'project' ? project.name : node.label });
}

// Sending a message folds the information, unless the person set it by hand since the box opened.
function foldForTalk() {
  if (pointNode && !foldByHand && !infoFolded) setFolded(true);
}

// The words of a chat about a box: what the empty box to write in says, and a few ready first messages.
function pointWords(node) {
  if (node.kind === 'item') return { placeholder: t('point.placeholder.item'), starters: [t('starter.item.explain'), t('starter.item.start')] };
  const name = node.kind === 'project' ? project.name : node.label;
  return { placeholder: t('point.placeholder', { name }), starters: ['missing', 'explain', 'next'].map((k) => t(`starter.${k}`, { name })) };
}

// A click on a box: its information on top (the Summary), the chat under it. The chat is the box's last conversation on
// this page if it had one, else a new one. tab=chat (a link, "New chat") opens with the information folded and the chat
// first; fresh starts a new conversation even where one was open. The root box holds the whole project and its project
// chats (orchestration or01).
function openPoint(node, { tab, fresh = false } = {}) {
  const chatFirst = tab === CHAT_TAB;
  const first = openingTab(tab);
  keepBoxChat();
  if (fresh) boxChats.delete(boxKey(node.id));
  const last = boxChats.get(boxKey(node.id));
  closePanel(false);
  closeLists();
  selection = { type: 'node', id: node.id };
  const own = node.kind === 'project'
    ? { title: project.name, intro: t('projchat.intro'), start: { node: { kind: 'project' } }, ...projectChatOf() }
    : { title: node.label, subtitle: crumbs(node), intro: t(`point.intro.${node.kind}`, { name: node.label }), start: { node: chatPointOf(node) }, newChat: () => openPoint(node, { tab: CHAT_TAB, fresh: true }) };
  chat.open({ projectId: project.id, ...own, ...pointWords(node), ...(last ? { intro: t('chat.introResume'), title: last.title || own.title, start: { sessionId: last.sessionId } } : {}) });
  showPoint(node, first, { folded: chatFirst || Boolean(last) });
  if (chatFirst) $('#chatInput')?.focus({ preventScroll: true });
  else (last ? $('#pointFold') : $(`#ptab-${first}`))?.focus({ preventScroll: true });
  revealNode(node.id, { center: true });
}

const openPartPoint = (partId, opts) => {
  const node = nodeById(tree, `pt:${partId}`);
  if (node) openPoint(node, opts);
};

// A chat that belongs to no box (an idea, the map's creation, a clash): the sheet is only that chat.
function plainPoint() {
  pointNode = null;
  $('#pointInfo').hidden = true;
  $('#pointSplit').hidden = true;
  $('#pointTabs').replaceChildren();
  $('#pointDetails').replaceChildren();
}

// The chats about the whole project, like a project's chats in Claude: the list and "New project chat" in the root box's
// information, the chat itself under it. The root box, the list and the map tools all open it.
const projectChatOf = () => ({ listTitle: t('projchat.list'), newChat: openProjectChat, retitle: true });

function openProjectChat() {
  if (!project || !tree) return;
  convs.closeDrawer();
  if (view !== 'map') showView('map');
  openPoint(tree, { tab: CHAT_TAB, fresh: true });
  renderMap();
}

// The project's orchestrator (or01): its one conversation, driven again if it was closed; with none yet, an empty chat that
// starts it with the person's first message (nothing is spent before).
async function openOrchestrator() {
  if (!project || !tree) return;
  convs.closeDrawer();
  if (view !== 'map') showView('map');
  const st = orchState(project);
  if (st.row) {
    const res = await api.orchestratorOpen({ projectId: project.id });
    if (!res.ok) return toast(errorText(res.error));
    const entry = listConversations(state, { projectId: project.id }).sections.flatMap((sec) => sec.pinned).find((e) => e.row.sessionId === st.row.sessionId);
    if (entry) return openConversation(entry);
  }
  closePanel(false);
  closeLists();
  selection = { type: 'node', id: tree.id };
  const resume = st.row ? { start: { sessionId: st.row.sessionId }, title: st.row.title || t('orch.chatTitle') } : { start: { node: { kind: 'orchestrator' } }, title: t('orch.chatTitle') };
  chat.open({ projectId: project.id, subtitle: project.name, intro: t('orch.intro'), placeholder: t('orch.placeholder'), orchestrator: true, ...resume });
  showPoint(tree, 'summary', { folded: true });
  renderMap();
  return undefined;
}

// "Organizar sozinho" (or18): the switch of the project; the state brings the new value on the next look.
// The project's monthly budget (or07): the field shows the owner's currency, the server keeps dollars.
const budgetCurrency = () => ({ label: state?.currency?.code === 'USD' ? 'US$' : (state?.currency?.code ?? 'US$'), rate: state?.currency?.rate ?? 1 });

async function setBudget(p, usd, field, button) {
  if (Number.isNaN(usd)) return toast(errorText('bad-budget'));
  button.disabled = true;
  const res = await api.setProjectBudget(p.id, usd);
  button.disabled = false;
  if (!res.ok) return toast(errorText(res.error));
  toast(usd === null ? t('budget.cleared') : t('budget.saved', { limit: money(usd) }));
  return poll();
}

async function continueBudget(p, button) {
  button.disabled = true;
  const res = await api.continueProjectBudget(p.id);
  button.disabled = false;
  if (!res.ok) return toast(errorText(res.error));
  toast(t('budget.continuedSaved'));
  return poll();
}

// The person's priority for a piece waiting in the orchestrator's line (or08), or 'drop' to take it out.
async function setPriority(p, code, value, select) {
  select.disabled = true;
  const res = await api.orchestratorPriority(p.id, code, value);
  select.disabled = false;
  if (!res.ok) return toast(errorText(res.error));
  toast(t(value === 'drop' ? 'orch.prio.dropped' : 'orch.prio.saved'));
  return poll();
}

async function setTidy(p, on, input) {
  input.disabled = true;
  const res = await api.setProjectTidy(p.id, on);
  input.disabled = false;
  if (!res.ok) {
    input.checked = !on;
    return toast(errorText(res.error));
  }
  toast(t(on ? 'orch.tidy.savedOn' : 'orch.tidy.savedOff'));
  return poll();
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
  keepBoxChat();
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
    where: row.origin === 'map' ? null : () => whereOf(row), placeholder: pointWords(node).placeholder,
    // "New conversation" in the ⋯ starts one on the same box (pc18).
    newChat: () => (node.kind === 'project' ? openProjectChat() : openPoint(node, { tab: CHAT_TAB, fresh: true })),
    ...(row.node?.kind === 'project' ? projectChatOf() : {}),
  });
  // The conversation opens under its box's information, folded to one line so the conversation reads first.
  showPoint(node, 'summary', { folded: true });
  revealNode(node.id, { center: true });
  requestAnimationFrame(() => requestAnimationFrame(() => activeMap().pulse(node.id)));
  convs.render();
}

// The ⋯ of the chat sheet's header, like the menu of a chat in Claude: rename or move it, archive it, open it where it
// lives (VS Code for one born there, a terminal otherwise, unless it is open in one already) and delete it. chat.js puts
// "About this part" and "Find" before them and "New conversation" after (pc18).
function chatMore(sessionId) {
  for (const p of state?.projects ?? []) {
    const row = conversationsOf(p).find((r) => r.sessionId === sessionId);
    if (!row) continue;
    const vscode = row.origin === 'vscode';
    const archive = row.archived ? 'unarchive' : 'archive';
    return [
      { id: 'rename', label: t('chat.moreRename'), icon: 'rename', run: () => openPlace({ row, project: p }) },
      { id: 'archive', label: t(`action.${archive}`), icon: 'archive', run: () => runAction({ action: archive, sessionId }, t(`action.${archive}d`)) },
      vscode || !row.live ? {
        id: 'open', label: vscode ? t('action.openVscode') : t('convs.openTerminal'), icon: vscode ? 'code' : 'terminal',
        run: () => runAction({ action: 'open', sessionId }, t(vscode ? 'action.openedVscode' : 'action.openedTerminal')),
      } : null,
      { id: 'delete', label: t('action.delete'), icon: 'trash', run: () => deleteConversation(row) },
    ].filter(Boolean);
  }
  return [];
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
  const archive = row.archived ? 'unarchive' : 'archive';
  const busy = row.status === 'busy';
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
      h('span', { class: 'pl-left' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { if (await runAction({ action: archive, sessionId: row.sessionId }, t(`action.${archive}d`))) dialog.close(); } }, icon('archive', 'btn-icon'), t(`action.${archive}`)),
        h('button', {
          type: 'button', class: 'btn danger-quiet', disabled: busy, title: busy ? t('err.busy') : null,
          onclick: async () => { if (await deleteConversation(row)) dialog.close(); },
        }, icon('trash', 'btn-icon'), t('action.delete'))),
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('confirm.cancel')),
      h('button', { type: 'submit', class: 'btn primary' }, t('place.save')))));
  dialog.showModal();
  nameInput.focus();
  nameInput.select();
}

// A new project (sv14, mm50): its name and where its folder goes; session-map creates the folder, the map opens on it and
// its project chat waits for the first message. Also on GitHub (sv15, mm51) only when the person picks it: private unless
// the public box is ticked, offered only when gh is logged in on this computer.
async function openNewProject() {
  const dialog = $('#newProjectDialog');
  const place = await api.newProjectPlace();
  if (!place.ok) return toast(errorText(place.error));
  const nameInput = h('input', { type: 'text', id: 'newProjectName', maxlength: '80', autocomplete: 'off', required: true, 'aria-describedby': 'newProjectPath' });
  const parentInput = h('input', { type: 'text', id: 'newProjectParent', value: place.parent ?? '', autocomplete: 'off', required: true, spellcheck: 'false', 'aria-describedby': 'newProjectParentHint' });
  const pathLine = h('p', { class: 'np-path', id: 'newProjectPath', 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, icon('plus', 'btn-icon'), t('newproject.create'));
  const gh = place.github ?? { ready: false, user: null };
  const where = (value, checked) => h('input', { type: 'radio', name: 'np-where', value, checked, disabled: value === 'github' && !gh.ready, onchange: showRepo });
  const onlyPc = where('pc', true);
  const alsoGh = where('github', false);
  const publicBox = h('input', { type: 'checkbox', id: 'newProjectPublic', onchange: showRepo });
  const publicRow = h('label', { class: 'np-public', hidden: true }, publicBox, h('span', {}, t('newproject.public')));
  const repoLine = h('p', { class: 'np-path', 'aria-live': 'polite', hidden: true });
  function showRepo() {
    const on = alsoGh.checked;
    publicRow.hidden = !on;
    repoLine.hidden = !on;
    const repo = repoNameOf(nameInput.value.trim());
    repoLine.textContent = on && repo ? t(publicBox.checked ? 'newproject.repoPublic' : 'newproject.repoPrivate', { repo: `${gh.user}/${repo}` }) : '';
  }
  const showPath = () => {
    const parent = parentInput.value.trim();
    const sep = parent.includes('\\') ? '\\' : '/';
    const name = nameInput.value.trim();
    pathLine.textContent = name && parent ? t('newproject.willBe', { path: `${parent.replace(/[\\/]+$/, '')}${sep}${name}` }) : '';
  };
  nameInput.addEventListener('input', () => { showPath(); showRepo(); });
  parentInput.addEventListener('input', showPath);
  const save = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const github = alsoGh.checked ? (publicBox.checked ? 'public' : 'private') : undefined;
    if (github) toast(t('newproject.githubWorking'));
    const res = await api.createProject({ parent: parentInput.value.trim(), name: nameInput.value.trim(), ...(github ? { github, githubUser: gh.user } : {}) });
    if (!res.ok) {
      submit.disabled = false;
      toast(errorText(res.error));
      return (res.error === 'bad-parent' ? parentInput : nameInput).focus();
    }
    dialog.close();
    // A GitHub step that failed after the folder was made: the project is there, and the toast says what GitHub answered.
    if (res.github && !res.github.ok) toast(t('newproject.githubFailed', { why: res.github.detail || errorText(res.error ?? res.github.error) }));
    else toast(t(res.github ? 'newproject.doneGithub' : 'newproject.done'));
    // The server reads the projects again: the new one shows within a few seconds.
    for (let i = 0; i < 30 && !state?.projects.some((p) => p.id === res.projectId); i++) {
      await poll();
      if (!state?.projects.some((p) => p.id === res.projectId)) await new Promise((r) => { setTimeout(r, 1000); });
    }
    if (!state?.projects.some((p) => p.id === res.projectId)) return toast(t('newproject.slow'));
    setProject(res.projectId);
    return openProjectChat();
  };
  dialog.replaceChildren(h('form', { class: 'confirm pl-form', onsubmit: save },
    h('h2', { id: 'newProjectTitle' }, t('newproject.title')),
    h('p', { class: 'pl-lede' }, t('newproject.lede')),
    h('div', { class: 'pl-field' }, h('label', { for: 'newProjectName' }, t('newproject.name')), nameInput, pathLine),
    h('div', { class: 'pl-field' }, h('label', { for: 'newProjectParent' }, t('newproject.parent')), parentInput,
      h('p', { class: 'pl-hint', id: 'newProjectParentHint' }, t('newproject.parentHint'))),
    h('fieldset', { class: 'care-opts np-where' },
      h('legend', { class: 'np-legend' }, t('newproject.where')),
      h('label', { class: 'care-opt' }, onlyPc, h('span', { class: 'care-opt-body' },
        h('span', { class: 'care-opt-name' }, t('newproject.onlyPc')), h('span', { class: 'care-opt-hint' }, t('newproject.onlyPcHint')))),
      h('label', { class: 'care-opt' }, alsoGh, h('span', { class: 'care-opt-body' },
        h('span', { class: 'care-opt-name' }, t('newproject.alsoGithub')),
        h('span', { class: 'care-opt-hint' }, gh.ready ? t('newproject.alsoGithubHint', { user: gh.user }) : t('newproject.githubNotReady')))),
      publicRow, repoLine),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('confirm.cancel')),
      submit)));
  dialog.showModal();
  return nameInput.focus();
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
    h('span', { class: 'ir-meta' }, [i.status === 'doing' ? t('item.status.doing') : null, liveBadge(i.live, t)?.text, i.status === 'done' ? t('item.status.done') : null, i.who, i.weight ? t(`item.weight.${i.weight}`) : null, tech ? i.code : null].filter(Boolean).join(' · '))));
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
  setFolded(true);
  $('#chatInput')?.focus();
}

// A row of the Summary: one kind, how much of it there is, and a click that opens its tab.
function digestRow(kind, counts, tab, title = t(`kind.${kind}.title`)) {
  return h('li', {}, h('button', { type: 'button', class: `kind-row kind-${kind}`, onclick: () => setPointTab(tab) },
    kmark(kind), h('span', { class: 'kr-title' }, title), h('span', { class: 'kr-digest' }, kindDigest(t, kind, counts)), icon('next', 'kr-next')));
}

// How much of the program a part or a layer holds, or, with no file linked yet, that sentence and a "?" that says why.
function sizeFacts(node) {
  const size = sizeOf(project.arch?.sizes, node);
  if (!size) return null;
  if (noFiles(project.arch.sizes, node)) return h('p', { class: 'note no-files' }, h('span', { 'data-help': 'nofiles' }, t(`size.none.${node.kind}`)));
  return h('p', { class: 'meta num' }, joinDots([plural('size.files', size.files), plural('size.lines', size.lines), t('size.share', { share: shareText(size.share) })].map((x) => h('span', {}, x))));
}

// The boxes under a layer or the project: each with what is open in it and one line about it.
const childRows = (children) => (children.length ? h('ul', { class: 'plain rows' }, children.map((c) => h('li', {},
  h('button', { type: 'button', class: 'link-row', onclick: () => openPoint(c) },
    h('span', { class: 'lr-title' }, c.label), h('span', { class: 'lr-date num' }, countText(c.counts)),
    c.part?.about ? h('span', { class: 'lr-line' }, c.part.about) : null)))) : null);

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
  const body = () => {
    if (pointTab === 'tasks') return [kblock('tasks', { vars: { file: part.file } }, itemList(node.children))];
    if (pointTab === 'chats') return [kblock('chats', { empty: t('kind.empty') }, chatRows(chats)), kblock('branches', {}, branchRows(cells))];
    if (pointTab === 'changes') return [activitySection(project.activity.filter((a) => (a.partIds ?? []).includes(part.id)))];
    if (pointTab === 'files') {
      return [sizeFacts(node), filesSection({ part: part.id }),
        part.codePaths.length ? section(t('point.where'), h('ul', { class: 'plain code-paths' }, part.codePaths.map((p) => h('li', {}, h('code', {}, p))))) : null];
    }
    return [
      part.about ? h('p', { class: 'lead' }, part.about) : null,
      h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(c)), ...chipsOf(c), linkTo(part.file, () => files.open(part.file), 'meta-link path')),
      sizeFacts(node),
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
  };
  return { tabs, body };
}

function itemDetails(node) {
  const i = node.item;
  const part = partById(node.partId);
  const tabs = pointTabs({ tasks: i.detail.length > 0, files: true });
  const body = () => {
    if (pointTab === 'tasks') return [kblock('tasks', { vars: { file: part.file } }, list(i.detail))];
    if (pointTab === 'files') return [filesSection({ part: part.id })];
    const person = isPerson(i.who) && i.status !== 'done' && !blocksSignal(i, part.name);
    const withYou = person ? sigCard(waitingSignal({ decision: { kind: 'item', text: node.label, who: i.who, code: i.code } }), { 'open-item': () => files.open(part.file, null, { line: i.line }) }) : null;
    return [
      h('p', { class: 'meta' },
        pill(i.status === 'done' ? 'active' : i.status === 'doing' ? 'waiting' : 'idle', t(`item.status.${i.status}`)),
        i.who ? h('span', { class: `bx-chip${isPerson(i.who) ? ' is-you' : ''}` }, i.who) : null,
        i.weight ? h('span', { class: `bx-chip${i.weight === 'blocks' ? ' is-blocks' : ''}` }, t(`item.weight.${i.weight}`)) : null,
        i.milestone ? h('span', {}, t('item.milestone', { n: i.milestone })) : null,
        liveChip(i),
        i.code ? h('code', { class: 'bx-code' }, i.code) : null),
      itemSign(i, part),
      withYou,
      i.detail.length ? kblock('tasks', { vars: { file: part.file } }, list(i.detail)) : null,
      h('div', { class: 'actions secondary' },
        button(t('point.openLine', { n: i.line }), () => files.open(part.file, null, { line: i.line })),
        button(t('point.openPart', { name: part.name }), () => openPartPoint(part.id))),
      mainBranchNote(),
      h('p', { class: 'note' }, t('point.itemRule')),
    ];
  };
  return { tabs, body };
}

// The chats about the whole project, newest first, as the list shows them (so a click opens them the same way).
function projectChatEntries() {
  const out = listConversations(state, { projectId: project.id });
  return [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].filter((e) => e.row.node?.kind === 'project')
    .sort((a, b) => String(b.row.updatedAt ?? '').localeCompare(String(a.row.updatedAt ?? '')));
}

const projectChatRows = (entries) => (entries.length ? h('ul', { class: 'plain rows' }, entries.map((e) => h('li', {},
  h('button', { type: 'button', class: 'link-row', onclick: () => openConversation(e) },
    h('span', { class: 'lr-title' }, h('span', { class: `dot-mini kind-${e.row.waiting ? 'waiting' : e.row.status}`, 'aria-hidden': 'true' }), e.row.title || t('chat.untitled')),
    h('span', { class: 'lr-date' }, e.row.status === 'busy' ? t('chat.running') : relative(e.row.updatedAt)),
    e.row.costUSD != null ? h('span', { class: 'lr-cost num' }, money(e.row.costUSD)) : null)))) : null);

const liveRows = (entries) => (entries.length ? h('ul', { class: 'plain rows' }, entries.map((e) => h('li', {},
  h('button', { type: 'button', class: 'link-row', onclick: () => openFromLive(e) },
    h('span', { class: 'lr-title' }, h('span', { class: 'dot-mini kind-busy', 'aria-hidden': 'true' }), e.chat.title || t('chat.untitled')),
    h('span', { class: 'lr-date' }, relative(e.lastStep?.ts ?? e.chat.updatedAt)),
    h('span', { class: 'lr-line' }, stepWords(t, e.lastStep) || placeWords(t, e.place)))))) : null);

const WAITING_SHOWN = 3;

// The root box: the whole project at a glance (what is open, how big it is, the files no box owns, what waits for the
// person, what works now, what changed), its chats about the whole project with "New project chat", and the chat.
function projectDetails(node) {
  const p = project;
  const sizes = p.arch?.sizes;
  const range = activeRange();
  const changes = p.activity.filter((a) => inRange(Date.parse(a.ts), range));
  const chats = projectChatEntries();
  const tabs = projectTabs({ changes: changes.length > 0 || Boolean(range), files: Boolean(sizes?.total) });
  const newChat = () => h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: openProjectChat }, icon('plus', 'btn-icon'), t('projchat.newLong')));
  const body = () => {
    if (pointTab === 'chats') return [newChat(), kblock('chats', { title: t('ptab.projectChats'), empty: t('projchat.none') }, projectChatRows(chats))];
    if (pointTab === 'changes') return [activitySection(p.activity)];
    if (pointTab === 'files') return [programFiles(sizes)];
    const waiting = waitingEntries(state, p.id, ignoredClash);
    const unowned = sizes?.unowned?.files ?? 0;
    return [
      h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(node.counts)), ...chipsOf(node.counts)),
      orchSection({ h, icon, t }, orchState(p), { onOpen: openOrchestrator, onTidy: (on, input) => setTidy(p, on, input), onPriority: (code, value, select) => setPriority(p, code, value, select) }),
      budgetSection({ h, t, money, currency: budgetCurrency() }, p.budget, { onSave: (usd, field, button) => setBudget(p, usd, field, button), onContinue: (button) => continueBudget(p, button) }),
      sizes?.total ? h('p', { class: 'meta num' }, joinDots([h('span', {}, plural('size.files', sizes.total.files)), h('span', {}, plural('size.lines', sizes.total.lines))]),
        unowned ? linkTo(plural('size.unowned', unowned), () => setPointTab('files'), 'meta-link is-unowned') : null) : null,
      waiting.length ? section(t('waiting.title'),
        h('ul', { class: 'plain rows wait-rows' }, waiting.slice(0, WAITING_SHOWN).map((e) => waitingRow(e, { where: (_, partId) => partById(partId)?.name ?? '' }))),
        waiting.length > WAITING_SHOWN ? linkTo(`${t('kind.seeAll')} (${waiting.length})`, openWaiting) : null) : null,
      section(t('live.title'), liveRows(liveEntries)),
      h('ul', { class: 'plain rows kind-rows' },
        digestRow('chats', { n: chats.length, waiting: chats.filter((e) => e.row.waiting).length }, 'chats', t('ptab.projectChats')),
        digestRow('changes', { n: changes.length }, 'changes'),
        sizes?.total ? digestRow('files', { n: sizes.total.files }, 'files') : null),
      section(t('point.layers'), childRows(node.children)),
      h('p', { class: 'meta' }, linkTo(t('project.open'), () => select({ type: 'project' }))),
    ];
  };
  return { tabs, labels: { chats: t('ptab.projectChats') }, body };
}

function detailsOf(node) {
  if (node.kind === 'project') return projectDetails(node);
  if (node.kind === 'part') return partDetails(node);
  if (node.kind === 'item') return itemDetails(node);
  const head = () => [h('p', { class: 'meta' }, h('span', { class: 'num' }, countText(node.counts)), ...chipsOf(node.counts))];
  if (node.kind === 'group') return { tabs: pointTabs({}), body: () => [...head(), kblock('tasks', {}, itemList(node.children))] };
  return { tabs: pointTabs({}), body: () => [...head(), sizeFacts(node), section(t('point.parts'), childRows(node.children))] };
}

// Draws the fold line, the strip and the open tab of the information (the chat under it is chat.js's). A strip that held
// the focus gets it back on the tab now open, so the arrows keep walking it.
function renderPointDetails() {
  const node = pointNode && nodeById(tree, pointNode);
  if (!node) return;
  const { tabs: all, labels, body } = detailsOf(node);
  const tabs = lookMode ? lookTabs(all) : all;
  if (!tabs.includes(pointTab)) pointTab = 'summary';
  renderFold(node);
  const strip = $('#pointTabs');
  const focused = strip.contains(document.activeElement);
  strip.replaceChildren(pointStrip({ h, icon, t }, tabs, pointTab, setPointTab, labels));
  if (focused) $(`#ptab-${pointTab}`)?.focus();
  $('#pointDetails').setAttribute('aria-labelledby', `ptab-${pointTab}`);
  $('#pointDetails').replaceChildren(...body().flat().filter(Boolean));
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
      h('p', { class: 'muted small' }, `${w.openspec.tool ? w.openspec.tool + ' · ' : ''}${w.openspec.change} · ${t('chat.openspec', w.openspec)}`)) : null,
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
    relationWhy(link) ? section(t('rel.aiWhy'), h('p', { class: 'rel-why' }, relationWhy(link)), h('p', { class: 'note' }, t('rel.aiWhyNote'))) : null,
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

// What the tree of a team needs from the page (mm31): words, places by name, and where its links lead.
function placeName(p) {
  const proj = state.projects.find((x) => x.id === p.projectId);
  const part = proj?.arch.parts.find((x) => x.id === p.partId);
  return [proj?.name ?? p.name, part?.name].filter(Boolean).join(' › ');
}
const wfCtx = () => ({
  h, t, icon, relative, modelName, list: listText, nowMs: Date.parse(state.generatedAt), placeWords: placeName,
  stepWords: (step) => stepWords(t, step),
  onItem: (item) => goTo(item.projectId, { type: 'node', id: item.code ? `i:${item.partId}:${item.code}` : `pt:${item.partId}` }),
  onFile: (f) => {
    if (f.projectId !== project.id) goTo(f.projectId);
    files.open(f.path);
  },
});
const newestWorkflow = (a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));

// Bytes in a few plain words: B under 1 KB, KB after.
const bytesText = (n) => ((n ?? 0) < 1024 ? `${n ?? 0} B` : `${Math.round(n / 1024)} KB`);

// The one small line of the skills a chat and its agents opened (mm52); a snowball (3+ agents) is in the warning color.
const SKILL_LINE_MAX = 3;
function skillUseLine(use) {
  if (!use?.skills?.length) return null;
  const shown = use.skills.slice(0, SKILL_LINE_MAX);
  const parts = shown.flatMap((s, i) => [
    i ? ', ' : null,
    s.snowball ? h('span', { class: 'skill-snow', title: t('chat.skills.snow', { n: s.agents }) }, `${s.name} ×${s.count}`) : `${s.name} ×${s.count}`,
  ]).filter(Boolean);
  if (use.skills.length > shown.length) parts.push(` ${t('chat.skills.more', { n: use.skills.length - shown.length })}`);
  const [before, after] = t('chat.skills', { list: '\u0000', size: bytesText(use.bytes) }).split('\u0000');
  return h('p', { class: 'muted small skill-use' }, before, ...parts, after);
}

function renderChatPanel(c) {
  const part = partById(c.partId);
  const wc = c.workCellId && workCellById(c.workCellId);
  const parent = c.parentId && chatById(c.parentId);
  const card = c.card || {};
  const offMap = offMapNote(c, project);
  panelHead(c.title, pill(chatTone(c), t(`chat.${c.status}`)), c.archived ? h('span', { class: 'level-badge' }, t('chat.archived')) : null, part ? partLink(part) : null);
  const waitingSig = waitingSignal({ chat: c });
  const waitingBlock = waitingSig ? sigCard(waitingSig, { answer: () => answerChat(c) }, c.waiting.items.length ? [list(c.waiting.items)] : []) : null;
  const facts = [
    [t('chat.cost'), h('span', { class: 'num' }, money(c.costUSD))],
    [t('chat.branch'), wc ? branchLink(wc) : h('span', { class: 'branch-name' }, project.mainBranch || '—')],
    [t('chat.placedWhy'), placedWhy(c, t, listText)],
    wc ? [t('chat.branchWhy'), branchWhy(c, t)] : null,
    [t('chat.started'), shortDate(Date.parse(c.startedAt))],
    [t('chat.updated'), relative(c.updatedAt)],
    parent ? [t('chat.from'), chatLink(parent)] : null,
  ].filter(Boolean);
  $('#panelBody').replaceChildren(...[
    waitingBlock,
    !part && hasMap() ? h('p', { class: 'note' }, t(offMap.key, { ...offMap.vars, where: listText(offMap.vars.where ?? []) })) : null,
    chatTools(c),
    section(t('chat.doing'), card.doing ? h('p', { class: 'lead' }, card.doing) : null),
    kblock('tasks', { from: t('kind.tasks.fromChat') }, list(card.todo)),
    skillUseLine(c.skillUse),
    c.workflows?.length ? section(t('wf.title'), h('div', { class: 'wf-list' }, [...c.workflows].sort(newestWorkflow).map((w) => workflowView(wfCtx(), w)))) : null,
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
  if (projectTab === 'plugins') {
    const plugins = p.plugins ?? [];
    body = plugins.length ? h('ul', { class: 'skills' }, plugins.map((pl) => {
      const skills = (p.skills ?? []).filter((k) => k.plugin === pl.name);
      return h('li', { class: `skill${pl.enabled ? '' : ' is-off'}` },
        h('div', { class: 'skill-head' },
          h('span', { class: 'skill-name' }, pl.name),
          pill(pl.enabled ? 'active' : 'idle', pl.enabled ? t('skills.on') : t('skills.off'))),
        h('p', { class: 'skill-desc' }, [t.count('plugins.skills', pl.skillCount ?? skills.length), pl.from ? t('plugins.from', { from: pl.from }) : null].filter(Boolean).join(' · ')),
        h('p', { class: 'skill-desc' }, t('plugins.weight', { size: bytesText(pl.listingBytes) }), ' · ', t('plugins.skillsFull', { size: bytesText(pl.skillBytes) })),
        h('p', { class: 'skill-desc' }, t(`plugins.week.${pl.week?.count === 1 ? 'one' : 'other'}`, { n: pl.week?.count ?? 0, size: bytesText(pl.week?.bytes) })),
        pl.installPath ? h('div', { class: 'skill-cmd' }, h('code', {}, pl.installPath)) : null);
    })) : h('p', { class: 'muted' }, t('plugins.none'));
  } else if (projectTab === 'skills') {
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
      // Money with no chat to show for it (sb06): say where it went.
      costWhyNote(p) ? h('div', { class: 'muted small' }, costWhyNote(p).map((l) => h('p', {}, t(l.key, { n: l.n })))) : null,
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
    h('div', { class: 'seg tabs-mini', role: 'tablist', 'aria-label': t('project.tabs') }, tab('overview', t('project.overview')), tab('skills', t.count('project.skills', p.skills.length)), tab('plugins', t.count('project.plugins', (p.plugins ?? []).length))),
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
  useTeamHues(state);
  agentMarks = agentDots(state, project, tree, Date.parse(state.generatedAt));
  marks = { live: livePaths(liveEntries).nodes, branches: branchMarks(shown), clashes: clashMarks(shown, ignoredClash) };
  convCounts = conversationCounts(project, tree, { showArchived });
}

function renderBanner() {
  const none = project.arch.source === 'none';
  $('#archBanner').hidden = !none;
  $('#newIdea').disabled = !hasMap();
  document.body.classList.toggle('no-map', !hasMap());
  $('#newIdea').title = hasMap() ? t('idea.hint') : t('idea.noMap');
  $('#newIdeaHint').textContent = hasMap() ? t('new.ideaHint') : t('idea.noMap');
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
  $('#notice').replaceChildren(h('strong', {}, t('state.noProjectsTitle')), h('span', {}, t('state.noProjects')),
    ...(lookMode ? [] : [h('button', { type: 'button', class: 'btn primary', onclick: openNewProject }, icon('plus', 'btn-icon'), t('project.new'))]));
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

// The signatures the screen was last drawn from (mm44): a poll redraws only the parts whose input moved.
let drawnSigs = null;

function applyState(next) {
  const before = project;
  const sigs = stateSigs(next, before?.id);
  const drawn = drawnSigs;
  drawnSigs = sigs;
  const openSame = !!before && drawn?.project === sigs.project;
  // The open project did not move: keep the object the map and the panel were drawn from.
  if (openSame) {
    const i = next.projects.findIndex((p) => p.id === before.id);
    if (i >= 0) next.projects[i] = before;
  }
  state = next;
  if (openSame && drawn.global === sigs.global && !document.body.classList.contains('is-empty')) return undefined;
  trackUnseen();
  renderWaiting();
  if (!state.projects.length) return renderNoProjects();
  if (!before || document.body.classList.contains('is-empty')) return renderAll();
  project = state.projects.find((p) => p.id === before.id) || state.projects[0];
  if (project.id !== before.id) return setProject(project.id);
  // Only another project moved: the map, the summary and the open panel stay as drawn.
  if (!openSame) {
    shown = visibleProject(project, showArchived);
    tree = archTree(shown);
    refreshMarks();
    renderSummary();
    renderBanner();
    renderMap();
  }
  convs.render();
  live.render();
  renderNow();
  if (!openSame && !editing) rerender();
  refreshView();
  return undefined;
}

let polling = null;
function poll() {
  if (polling) return polling;
  polling = (async () => {
    const res = await api.state();
    // The browser switched between the owner and the look-only link (sv11): only a fresh page shows the right areas.
    if (res.ok && Boolean(res.look) !== lookMode) return location.reload();
    if (res.ok && res.same) {
      // Nothing new (304): only a new minute redraws, so relative times and working marks still age.
      if (state && res.generatedAt && minuteOf(res.generatedAt) !== minuteOf(state.generatedAt)) applyState({ ...state, generatedAt: res.generatedAt });
    } else if (res.ok) {
      const { ok, status, error, look, ...next } = res;
      applyState(next);
      if (next.refreshing) setTimeout(poll, 2000);
    } else if (state) {
      toast(t('state.offline'));
    }
  })().finally(() => { polling = null; });
  return polling;
}

// Any name, old or new (board, history, a saved sm.view, ?view=), lands on an area of the table (nav.js).
// The bar's areas (navbar.js). On a phone, Conversations is the inbox over the map (mm49), as on a computer it is the column
// beside it; Board and History wait one tap further, at its foot.
function pickArea(area) {
  if (area === 'convs' && PHONE.matches && !lookMode) {
    if (view !== 'map') showView('map');
    convs.openDrawer();
    return;
  }
  convs.closeDrawer();
  showView(area);
}

function showView(name, sub = null) {
  const to = normalizeView(name, { look: lookMode });
  view = to.area;
  viewSub = sub ?? to.sub;
  navbar.setCurrent(view);
  document.body.dataset.view = view;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.id !== sectionOf(view);
  if (view !== 'discover') $('#view-discover').hidden = true;
  if (view !== 'map') { closePanel(false); chat.close(); closeLists(); }
  if (view !== 'flow') flow.hide();
  store.set('sm.view', view);
  refreshView(true);
}

// The open area draws itself through the registry (areas.js); an area with no view yet shows "being built".
function refreshView(first = false) {
  if (!state) return;
  if (!state.projects.length && AREAS.find((a) => a.id === view)?.scope !== 'global') return;
  const sub = first ? viewSub : null;
  if (first) viewSub = null;
  areas.draw(view, $(`#${sectionOf(view)}`), { first, sub });
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
let repoSide = null; // the project's folders and files on the left of the map (mm39)
let changesView = null;
let tabs = null;
let requestsView = null;
let mindmap = null;
let outline = null;
let flow = null;
let convs = null;
let live = null;
let alerts = null;
let aiHelpers = null;
let runSettings = null; // Configurações: the monthly limit, permissions and advanced ways (pc19)
let cutPanel = null;
let menus = []; // menu.js: "Novo" and "Vista" (mm47, mm48)
let picker = null;
let navbar = null;
let areas = null;
let demoMode = false; // learnt from the server's answer: the demo writes nothing, so Home stops offering "Read now"
let lookMode = false; // opened with the "look only" link (sv04, sv11): the map's reads only, so only the areas they draw
let homeRow = null; // the project of the Home row last clicked, for a heads-up button that leads into that project

// An area opened from somewhere else (Home's heads-up buttons): its project first, then the area and its sub-part.
function goArea(area, sub = null, projectId = null) {
  const id = projectId ?? homeRow;
  if (id && id !== project?.id && state?.projects.some((p) => p.id === id)) setProject(id);
  showView(area, sub);
}

// "Read now" on Home: the server reads the project's foundation; the next state brings the numbers.
async function readFoundation(id) {
  const res = await api.fdWrite(id, 'refresh', {});
  if (!res.ok) {
    if (res.error === 'demo') demoMode = true;
    toast(errorText(res.error));
    return;
  }
  setTimeout(poll, 1500);
}

// A click on an alert: its project, then its conversation (one alert) or the waiting list (a clash).
function openFromAlert(group) {
  const target = state?.projects.find((p) => p.id === group.projectId);
  if (!target) return;
  if (view !== 'map') showView('map');
  if (project?.id !== target.id) setProject(target.id);
  const [first] = group.alerts;
  if (group.kind === 'clash') return openWaiting();
  // A project's monthly budget (or07): its panel, where the budget and "Continuar este mês" are.
  if (group.kind === 'budget') return requestAnimationFrame(() => { if (tree) openPoint(tree); });
  if (group.alerts.length !== 1 || !first.sessionId) return undefined;
  const out = listConversations(state, { projectId: target.id, scope: 'all', showArchived: true });
  const hit = [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === first.sessionId);
  return hit ? openConversation(hit) : toast(t('alert.notFound'));
}

// The menus around the map (mm47, mm48): "Novo" at the head of the conversations, "Vista" over the map with its export
// list. One behaviour for both (menu.js); the period picker opened from Vista counts as Vista's own, so a press in it
// leaves Vista open. The ⋯ of the bar is the navbar's own menu (help and Configurações).
function wireMenus() {
  const exportMenu = $('#mapExportMenu');
  const exportBtn = $('#mapExportBtn');
  const setExport = (on) => {
    exportMenu.hidden = !on;
    exportBtn.setAttribute('aria-expanded', String(on));
    if (on) exportMenu.querySelector('button')?.focus();
  };
  menus = [
    createMenu({ button: $('#newBtn'), pop: $('#newMenu') }),
    createMenu({ button: $('#viewBtn'), pop: $('#viewMenu'), inside: (el) => Boolean(el.closest?.('.rp, .rp-scrim')), onOpen: renderChanged, onClose: () => setExport(false) }),
  ];
  exportBtn.addEventListener('click', () => setExport(exportMenu.hidden));
  exportBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setExport(true); } });
  // ArrowLeft or Esc closes only the export list and goes back to its item; Vista stays open.
  exportMenu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setExport(false);
    exportBtn.focus();
  });
  $('#bgSwitch').addEventListener('click', (e) => { if (project?.background && e.currentTarget.getAttribute('aria-disabled') !== 'true') setBackground(project, !project.background.always, e.currentTarget); });
  // "/" goes to the map's search, as the hint in the field says, unless the person is typing somewhere.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || view !== 'map') return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    e.preventDefault();
    $('#search').focus();
  });
}

// The language of the page, chosen in Configurações.
function setLanguage(code) {
  if (!LANGS[code] || code === lang) return;
  lang = code;
  t = translator(lang, { tech });
  store.set('sm.lang', lang);
  renderAll();
  refreshView(true);
}

// The Full switch of the ⋯ menu: every area on the bar, and the words programmers use.
function setTech(on) {
  tech = on;
  document.body.classList.toggle('is-tech', tech);
  store.set('sm.tech', on ? '1' : '0');
  t = translator(lang, { tech });
  renderAll();
  refreshView(true);
}

// What the ⋯ of the bar holds under the areas (navbar.js): help and Configurações, in the order a person looks for them. A
// look-only page gets no Configurações, no other AIs and no look link: the server refuses them anyway.
function moreEntries() {
  const entries = [{ id: 'tour', label: t('tour.replay'), icon: 'compass', onActivate: () => tour.start() }];
  if (!lookMode) entries.push({ id: 'ai', label: t('aih.open'), icon: 'connect', popup: true, onActivate: () => aiHelpers.open() });
  entries.push({ id: 'full', label: t('more.full'), desc: t('more.fullHint'), kind: 'switch', checked: tech, onActivate: () => setTech(!tech) });
  entries.push({ id: 'help', label: t('more.help'), icon: 'help', popup: true, onActivate: () => help.open() });
  // Configurações for the conversation on screen (the map's or the workshop's), or for none.
  if (!lookMode) entries.push({ id: 'settings', label: t('settings.title'), icon: 'sliders', popup: true, onActivate: () => runSettings.open(chat.isOpen() ? chat.settings() : flow.chatSettings(), $('#tab-more')) });
  return entries;
}

function wire() {
  document.body.classList.toggle('is-tech', tech);
  // The bar draws the table of areas (nav.js): Simple shows the five main areas and a "More" menu, Full shows them all.
  navbar = createNavbar({
    h, icon, root: $('#navbar'), t: () => t, tech: () => tech, phone: () => PHONE.matches, look: () => lookMode, current: view, onPick: pickArea, extras: moreEntries,
  });
  tour = createTour({ h, t: () => t, phone: () => PHONE.matches, onEnd: (how) => store.set('sm.tour', how) });
  help = createHelp({
    h, t: () => t, plain: () => translator(lang), tech: () => translator(lang, { tech: true }), anchor: () => $('#tab-more'),
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
    root: $('#view-discover'), h, t: () => t, lang: () => lang, toast, icon,
    project: () => (project ? { id: project.id, name: project.name } : null),
  });
  // Configurações (pc19): one sheet for the run menu of both chats and for the person's menu.
  runSettings = createRunSettings({
    dialog: $('#settingsDialog'), h, t: () => t, icon, money, toast, errorText, onPcMode: pcMode,
    lang: () => lang, setLang: setLanguage, openAlerts: () => alerts.openSettings(),
    limit: { read: () => api.reinforcedLimit(), save: (usd) => api.setReinforcedLimit(usd) },
  });
  chat = createChat({
    root: $('#chat'), h, t: () => t, toast, errorText, relative, money, lang: () => lang, icon, commands: chatCommands,
    onSession: () => { convs.render(); setTimeout(poll, 1200); },
    beforeSend: foldForTalk,
    more: chatMore,
    // The box's information, folded away while the person talks, comes back from the ⋯ (pc18).
    about: () => (pointNode && infoFolded ? () => { setFolded(false, { byHand: true }); $('#pointFold').focus({ preventScroll: true }); } : null),
    openSettings: (binding, opener) => runSettings.open(binding, opener),
    onRunChange: () => runSettings?.refresh(),
    waitingOf: chatWaits,
    onClose: () => {
      pointNode = null;
      if (selection?.type === 'node') selection = null;
      renderMap();
      convs.render();
    },
  });
  convs = createConvList({
    root: $('#convs'), h, t: () => t, lang: () => lang, icon, relative, money, list: listText, phone: PHONE, store,
    state: () => state, project: () => project, current: () => chat.current(), unseen: () => unseen,
    nodeLabel: (id) => (tree ? nodeById(tree, id)?.label ?? null : null),
    onOpen: openConversation,
    // A visitor (mm24) is moved and renamed from the project it was born in.
    onMove: (e) => openPlace({ ...e, project: e.home ?? e.project }),
    onFilter: () => renderMap(),
    // Continue on a cut-off row is the Cut off panel's own (one pending list, one message); the phone's bar marks the inbox.
    onContinue: (e) => cutPanel.continue(e),
    onDrawer: (on) => navbar.setCurrent(on ? 'convs' : view),
  });
  cutPanel = createCutPanel({
    root: $('#cutPanel'), h, t: (key, vars) => t(key, vars), icon, relative, phone: PHONE, toast, errorText,
    // Resumes it as a page conversation in its own folder; the server refuses a second run of the same one.
    onContinue: ({ row, project: p }) => api.chatStart({ projectId: p.id, sessionId: row.sessionId, text: t('cut.continueText'), cut: true }).then((res) => { setTimeout(poll, 1500); return res; }),
    onDismiss: ({ row }) => runAction({ action: 'dismiss-cut', sessionId: row.sessionId }, t('cut.dismissed')),
    onOpen: ({ row, project: p }) => {
      const out = listConversations(state, { projectId: p.id, showArchived: true });
      const hit = [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === row.sessionId);
      if (hit) openConversation(hit);
    },
  });
  picker = createProjectPicker({
    root: $('#projectPicker'), button: $('#project'), list: $('#projectList'), name: $('#projectName'), h, t: () => t, icon,
    onPick: (id) => setProject(id),
    onNew: openNewProject, canNew: () => !lookMode,
  });
  live = createLivePanel({
    root: $('#liveList'), button: $('#liveBtn'), h, t: () => t, icon, relative,
    state: () => state, project: () => project, onShow: showOnMap, onOpen: openFromLive,
    workflowView: (w, opts) => workflowView(wfCtx(), w, opts),
    onTeam: (entry) => { live.close(); goTo(entry.project.id, { type: 'chat', id: entry.chat.sessionId }); },
  });
  alerts = createAlerts({
    stack: $('#alertStack'), dialog: $('#alertsDialog'), h, t: () => t, lang: () => lang, icon, api, store, toast, errorText,
    projects: () => (state?.projects ?? []).map((p) => ({ id: p.id, name: p.name })),
    onOpen: openFromAlert,
    onAlerts: (fresh) => {
      // A job that finished while the page was closed or on another project is still "finished and not seen".
      for (const a of fresh) if (a.kind === 'finished' && a.sessionId && a.sessionId !== (chat.isOpen() ? chat.current() : null)) unseen.add(a.sessionId);
      saveUnseen();
      // The marks are the page's own: a poll that finds the server unchanged (304) would never draw them.
      renderNow();
      convs?.render();
      setTimeout(poll, 400);
    },
    pending: () => (jobs ? pendingCount(jobs) : 0),
  });
  createResizer({ sheet: $('#chat'), handle: $('#chatResize'), target: $('#stage'), cssVar: '--chat-w', storageKey: 'sm.chatWidth', defaultWidth: () => CHAT_WIDTH });
  createSplit({ handle: $('#pointSplit'), info: $('#pointInfo'), pane: $('#chatPane'), target: $('#chat'), cssVar: '--info-h', storageKey: 'sm.infoHeight', active: () => !infoFolded });
  $('#pointFold').addEventListener('click', () => setFolded(!infoFolded, { byHand: true }));
  flow = createFlowView({
    h, t: () => t, toast, errorText, relative, money, phone: PHONE, lang: () => lang, icon, commands: chatCommands,
    openSettings: (binding, opener) => runSettings.open(binding, opener), onRunChange: () => runSettings.refresh(), waitingOf: chatWaits,
    project: () => project, tree: () => tree, live: () => marks.live,
    onOpenPart: (partId) => openPartPoint(partId),
    onApplied: () => setTimeout(poll, 600),
  });
  files = createFiles({ dialog: $('#fileDialog'), h, t: () => t, toast, errorText, project: () => project, phone: () => PHONE.matches });
  repoSide = createRepoSide({
    h, t: () => t, lang: () => lang, store, project: () => project, files: () => files, toast, button: $('#filesSide'),
    visible: () => view === 'map' && !PHONE.matches,
    onChange: (opts) => { if (!PHONE.matches) renderMap(opts); },
    onFit: (first) => { if (project && !PHONE.matches && !(first && mindmap.touched())) requestAnimationFrame(() => mindmap.fit(true)); },
  });
  changesView = createChangesView({
    h, t: () => t, lang: () => lang, icon, state: () => state, project: () => project, range: () => activeRange(), rangeButton: () => rangePicker.button(),
    dialog: $('#fileDialog'), files, go: goTo, toast, errorText, number: numText, relative,
  });
  requestsView = createRequestsView({ h, t: () => t, icon, lang: () => lang, state: () => state, project: () => project, openItem: openRequestItem });
  aiHelpers = createAiHelpers({ dialog: $('#aiHelpersDialog'), h, t: () => t, lang: () => lang, api, toast, errorText, projects: () => (state?.projects ?? []).map((p) => ({ id: p.id, name: p.name, root: p.root })), openers: [] });
  // The look-only link (sv04), made and turned off by the owner from the help menu.
  const lookShare = createLookShare({
    box: $('#lookShareBox'), h, t: () => t, api, toast,
    // Off a secure address the clipboard may be shut: the link is selected so the owner copies it by hand.
    copy: async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { $('#lookShareBox .look-link')?.select(); return false; } },
  });
  $('#lookShareOpen').addEventListener('click', async () => {
    await lookShare.open();
    $('#lookShareOpen').setAttribute('aria-expanded', String(!$('#lookShareBox').hidden));
  });
  tabs = createTabs({
    h, t: () => t, lang: () => lang, fmt: { money, shortDate, relative }, icon, openAiHelpers: () => aiHelpers.open(),
    state: () => state, project: () => project, go: goTo, toast, errorText, confirm: confirmAction,
    prefs: { archived: () => showArchived, setArchived },
    range: () => activeRange(), rangeButton: () => rangePicker.button(),
  });
  areas = createAreas({
    h, icon, t: () => t,
    own: {
      map: { render() {}, refresh() {} }, // the map draws itself (renderMap) on every state
      flow: { render: () => flow.show(), refresh: () => flow.refresh() },
      requests: { render: () => requestsView.render($('#view-requests')), refresh: () => requestsView.refresh($('#view-requests')) },
      convs: { render: (root, sub) => tabs.render(sub ?? 'convs', root), refresh: (root) => tabs.refresh('convs', root) },
      changes: { render: (root) => changesView.render(root), refresh: (root) => changesView.refresh(root) },
      costs: { render: (root) => tabs.render('costs', root), refresh: (root) => tabs.refresh('costs', root) },
      discover: { render: () => discover.show(), refresh() {} },
    },
    home: {
      h, icon, t: (key, vars) => t(key, vars), fmt: { money, relative }, state: () => state, now: () => (state ? rangeNow() : Date.now()),
      ignored: () => ignoredClash, demo: () => demoMode,
      openProject: (id) => { if (id !== project?.id) setProject(id); showView('map'); },
      goTo: (area, sub, id) => goArea(area, sub, id),
      refreshFoundation: readFoundation,
      // The monthly limit for big work: the same value the run menu by Send sets, now in plain sight (mm46).
      limit: { read: () => api.reinforcedLimit(), save: (usd) => api.setReinforcedLimit(usd) },
      currency: () => ({ label: state?.currency?.code === 'USD' ? 'US$' : (state?.currency?.code ?? 'US$'), rate: state?.currency?.rate ?? 1 }),
      toast, errorText,
    },
  });
  navbar.setReady(areas.ready());
  $('#view-home').addEventListener('click', (e) => { homeRow = e.target.closest?.('[data-id]')?.dataset.id ?? null; }, true);
  $('#waitingBtn').addEventListener('click', () => ($('#waitingList').hidden ? openWaiting() : closeLists()));
  $('#liveBtn').addEventListener('click', () => (live.isOpen() ? closeLists() : openLive()));
  for (const b of document.querySelectorAll('[data-close="panel"], [data-close="waiting"], [data-close="live"], [data-close="rel"]')) {
    b.addEventListener('click', () => (b.dataset.close === 'panel' ? closePanel() : closeLists()));
  }
  // The box's strip is one tablist: the arrows, Home and End move along it and show the tab they land on.
  $('#pointTabs').addEventListener('keydown', (e) => {
    const tabs = [...$('#pointTabs').querySelectorAll('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (at < 0 || to === undefined) return;
    e.preventDefault();
    setPointTab(tabs[(to + tabs.length) % tabs.length].dataset.ptab);
  });
  $('#fit').addEventListener('click', () => mindmap.fit(true));
  $('#newIdea').addEventListener('click', openIdea);
  $('#newChat').addEventListener('click', openProjectChat);
  $('#openOrch').addEventListener('click', openOrchestrator);
  $('#convsBoardLink').addEventListener('click', () => { convs.closeDrawer(); showView('convs'); });
  wireMenus();
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
  // Export (mm16): the whole tree, open or folded, as a Markdown outline, a FreeMind file or an XMind file.
  $('#mapExport').addEventListener('click', (e) => {
    const kind = e.target.closest('[data-map-export]')?.dataset.mapExport;
    if (!kind || !tree) return;
    const name = mapFileName(project.name, kind);
    const file = {
      md: () => new Blob([outlineOf(tree)], { type: 'text/markdown;charset=utf-8' }),
      mm: () => new Blob([freeMindOf(tree)], { type: 'application/x-freemind' }),
      xmind: () => new Blob([xmindOf(tree)], { type: 'application/vnd.xmind.workbook' }),
    }[kind];
    saveBlob(file(), name);
    toast(t('mapexport.saved', { name }));
  });
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
    if (e.key !== 'Escape' || $('#confirmDialog').open || $('#installDialog').open || $('#fileDialog').open || $('#flowDialog').open || $('#alertsDialog').open || $('#aiHelpersDialog').open || $('#placeDialog').open) return;
    if (picker.isOpen()) picker.close();
    else if (menus.some((m) => m.isOpen())) menus.forEach((m) => m.close(false));
    else if (convs.isDrawerOpen()) convs.closeDrawer();
    else if (!$('#waitingList').hidden || live.isOpen() || !$('#relList').hidden) closeLists();
    else if (chat.isOpen()) chat.close();
    else closePanel();
  });
  PHONE.addEventListener('change', () => {
    if (!PHONE.matches) convs.closeDrawer();
    navbar.render();
    if (project) { renderMap(); activeMap().fit(false); }
  });
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
  const params = deepLinkParams(location.search, { look: lookMode });
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
      if (node) setTimeout(() => openPoint(node, { tab: params.get('tab') ?? undefined }), 60);
    } else setTimeout(() => select({ type, id }), 60);
  }
  if (params.get('idea') === '1') setTimeout(openIdea, 60);
  // &conv=<sessionId> opens a conversation as the list does; &convfilter=<box id> and &drawer=1 show the list's states.
  const conv = params.get('conv');
  if (conv) {
    const out = listConversations(state, { projectId: project.id, scope: 'all', showArchived: true });
    const hit = [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === conv);
    if (hit) setTimeout(() => openConversation(hit), 80);
  }
  if (params.get('convfilter')) setTimeout(() => convs.filterTo(params.get('convfilter')), 60);
  if (params.get('drawer') === '1') setTimeout(() => convs.openDrawer(), 60);
  if (params.get('live') === '1') setTimeout(openLive, 60);
  if (!lookMode && params.get('alerts') === '1') setTimeout(() => alerts.openSettings(), 200);
  // &place=<sessionId> opens "Move or rename"; &picker=1 opens the project list; &waiting=1 (and the old &nowopen=1)
  // open the list behind the amber pill; &menu=new|view|more opens one of the menus, for screenshots.
  const placeId = params.get('place');
  if (placeId) {
    const out = listConversations(state, { projectId: project.id, scope: 'all', showArchived: true });
    const hit = [...out.working, ...out.cutoff, ...out.waiting, ...out.recent].find((e) => e.row.sessionId === placeId);
    if (hit) setTimeout(() => openPlace(hit), 120);
  }
  if (params.get('picker') === '1') setTimeout(() => $('#project').click(), 120);
  if (params.get('nowopen') === '1' || params.get('waiting') === '1') setTimeout(openWaiting, 120);
  const menuBtn = { new: '#newBtn', view: '#viewBtn', more: '#tab-more' }[params.get('menu')];
  if (menuBtn) setTimeout(() => $(menuBtn).click(), 160);
  if (!lookMode && params.get('pcmode')) setTimeout(() => pcMode(params.get('pcmode')), 300);
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
  const { ok, status, error, look, ...first } = res;
  // Opened with the look-only link (sv04): the map only, no chat, no buttons, no alerts.
  applyLook(document.body, look);
  // ...and only the areas whose reads the server lets through (sv11): no Home, Conversations or foundation.
  lookMode = Boolean(look);
  // An area picked on the bar while the state was on its way is checked again (refreshView waits for the state).
  if (lookMode && !LOOK_AREAS.includes(view)) showView('map');
  navbar.render();
  state = first;
  trackUnseen();
  if (!look) alerts.start();
  notice.hidden = true;
  renderAll();
  if (state.projects.length) {
    const params = new URLSearchParams(location.search);
    const saved = normalizeView(store.get('sm.view'));
    if (saved.area !== 'map' && !params.get('view') && !params.get('select')) showView(saved.area, saved.sub);
    applyDeepLink();
    // A reload keeps the conversation that was open in the sheet.
    if (view === 'map' && !params.get('select') && !look) chat.restore(project.id);
    // The welcome tour plays once by itself on the first visit; the help menu plays it again.
    if (!look && tourWanted(store.get('sm.tour'))) setTimeout(() => tour.start(), 600);
  }
}

main();
