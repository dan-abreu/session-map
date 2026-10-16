// The list of conversations (plano-v02, v0.2.2 item 0): a column on the left of the map, a drawer on a phone.
// The pure part on top is what node:test loads; createConvList below touches the DOM only when called.
import { archTree, ownerHue } from './tree.js';
import { emptyState } from './empty.js';
import { modelName } from './live.js';
import { needsYou } from './now.js';
import { waitingSignal } from './signals.js';

const RECENT_PAGE = 50;
const SPECIAL = new Set(['idea', 'create-arch', 'flow', 'project', 'orchestrator']);
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const newest = (a, b) => String(b.row.updatedAt ?? '').localeCompare(String(a.row.updatedAt ?? ''));

function originOfChat(c) {
  if (c.engine === 'deepseek') return 'deepseek';
  if (c.entrypoint === 'claude-vscode') return 'vscode';
  if (c.entrypoint === 'claude-desktop') return 'desktop';
  return String(c.entrypoint ?? '').startsWith('sdk') ? 'sdk' : 'terminal';
}

// A map chat as a row of the list.
const rowOfChat = (c) => ({
  sessionId: c.sessionId, title: c.title, origin: originOfChat(c), partId: c.partId, itemCode: c.itemCode ?? null, node: null,
  status: c.status, waiting: Boolean(c.waiting.strong || c.waiting.weak || c.waiting.items.length), lastStep: c.liveSteps?.at(-1) ?? null,
  costUSD: c.costUSD, startedAt: c.startedAt, updatedAt: c.updatedAt, archived: c.archived, live: c.live, chattable: c.chattable, onMap: true,
});

// A server older than the list sends only the map's chats: they make the rows, without the older conversations.
export function conversationsOf(project) {
  if (Array.isArray(project.conversations)) return project.conversations;
  return project.chats.map(rowOfChat);
}

// The conversations born in another project that work in this one (mm24); a server older than them sends none.
export const visitorsOf = (project) => (Array.isArray(project.visitors) ? project.visitors : []);

// "Born in X · working in Y" (mm24): the project a conversation is listed in first and the other projects where it edits
// (or looks, before its first edit), biggest share first. null when it works only at home.
export function workWords(row, project) {
  const born = row.bornIn ?? { projectId: project.id, name: project.name };
  const working = (row.footprint?.places ?? []).filter((p) => p.projectId !== born.projectId && p.share > 0).map((p) => p.name);
  return working.length ? { born: born.name, working } : null;
}

// The note of a conversation off this project's map: where it does work, when that is in other projects.
export function offMapNote(row, project) {
  const work = workWords(row, project);
  return work ? { key: 'chat.offMapWorking', vars: { where: work.working } } : { key: 'chat.offMap', vars: {} };
}

// id → {node, path (the ids above it, the project first)}, built once per list.
function indexOf(tree) {
  const index = new Map();
  const walk = (node, path) => {
    index.set(node.id, { node, path });
    for (const c of node.children) walk(c, [...path, node.id]);
  };
  walk(tree, []);
  return index;
}

function nodeIn(index, row) {
  const n = row.node;
  if (n && SPECIAL.has(n.kind)) return 'p';
  const candidates = [
    row.itemCode && row.partId ? `i:${row.partId}:${row.itemCode}` : null,
    n?.kind === 'group' && row.partId ? `g:${row.partId}:${n.group}` : null,
    n?.kind === 'layer' ? `l:${n.layerId}` : null,
    row.partId ? `pt:${row.partId}` : null,
  ];
  return candidates.find((id) => id && index.has(id)) ?? 'p';
}

function placeIn(index, row, nodeId) {
  if (row.node && SPECIAL.has(row.node.kind)) return { path: [], special: row.node.kind };
  if (nodeId === 'p') return { path: [], special: 'off' };
  const { node, path } = index.get(nodeId);
  return { path: [...path.slice(1).map((id) => index.get(id).node.label), node.label], special: null };
}

// The box of the map a conversation belongs to: the item it works on, else the point the page opened it on, else its part.
export const nodeOfConversation = (tree, row) => nodeIn(indexOf(tree), row);

// The way down the map to that box, without the project; special names a point that is not a box (idea, new map, flow) or
// a conversation the map could not place ('off').
export function placeOf(tree, row) {
  const index = indexOf(tree);
  return placeIn(index, row, nodeIn(index, row));
}

const visible = (row, showArchived) => showArchived || !row.archived;

const DAY_MS = 86_400_000;
export const DATE_GROUPS = ['today', 'yesterday', 'week', 'older'];
// The groups of a project in the inbox (mm49), top to bottom, under "Needs you" (which spans every project, needsEntries)
// and over "Archived" (folded at the bottom): at work now, cut off by a restart, born elsewhere and working here, the rest.
export const SECTION_GROUPS = ['working', 'cutoff', 'visiting', 'recent'];

// The states a conversation can be in (mm43), counted over the rows the scope, the search and the box leave. One state
// each: archived beats everything; what "Needs you" holds is waiting (need: the ids it holds, by the shared needsYou rule,
// so a question left days ago is just finished); then working beats cut off (it was picked up again), and cut off beats
// waiting. Without need, the row's own waiting flag says waiting.
export const STATE_FILTERS = ['working', 'waiting', 'cutoff', 'finished', 'archived'];
export function bucketOf(row, need = null) {
  if (row.archived) return 'archived';
  if (need?.has(row.sessionId)) return 'waiting';
  if (row.status === 'busy') return 'working';
  if (row.cutOff) return 'cutoff';
  return !need && row.waiting ? 'waiting' : 'finished';
}
const isCut = (row) => bucketOf(row) === 'cutoff';

// By calendar day on this device, like Claude and ChatGPT: late last night is yesterday though less than a day ago.
export function dateGroup(iso, nowMs) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return 'older';
  const midnight = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  // Rounded: a day with a clock change is 23 or 25 hours long.
  const days = Math.round((midnight(nowMs) - midnight(at)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 7 ? 'week' : 'older';
}

// The time on a row, short like a mail inbox: "now", "12 min", "3 h", then the clock today, "yesterday", the weekday this
// week and the date before. lang: the page's language.
export function shortWhen(iso, nowMs, lang = 'en') {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return '';
  const mins = Math.max(0, Math.round((nowMs - at) / 60_000));
  const rtf = () => new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (mins < 1) return rtf().format(0, 'second');
  if (mins < 60) return new Intl.NumberFormat(lang, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(mins);
  if (mins < 6 * 60) return `${Math.round(mins / 60)} h`;
  const group = dateGroup(iso, nowMs);
  if (group === 'today') return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(at);
  if (group === 'yesterday') return rtf().format(-1, 'day');
  if (group === 'week') return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(at);
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(at);
}

// Each project's own color, the same everywhere a project shows (list, picker, Now strip).
export const projectHue = (project) => ownerHue(project.id);

// The chats about the whole project sit on top of its card, like the chats of a project in Claude, and so does the
// project's orchestrator (or01), first of them.
export const isOrchestrator = (row) => row.node?.kind === 'orchestrator';
const byUpdated = (a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));

// Those chats, not archived, newest first: what the root bubble counts. The orchestrator has its own chip.
export const projectChats = (project) => conversationsOf(project).filter((r) => r.node?.kind === 'project' && !r.archived).sort(byUpdated);

// The project's orchestrator (the newest one that is not archived) and the chats it opened or took over (or03): the
// ones whose recorded mother is it, never guessed.
export const orchestratorOf = (project) => conversationsOf(project).filter((r) => isOrchestrator(r) && !r.archived).sort(byUpdated)[0] ?? null;
export const activityOf = (project, orch) => (orch ? conversationsOf(project).filter((r) => r.parentId === orch.sessionId && !r.archived) : []);

function sectionOf(project, entries) {
  const sec = { project, hue: projectHue(project), working: [], cutoff: [], visiting: [], recent: [], archived: [], kids: new Map() };
  const own = entries.filter((e) => !e.home);
  // The activity chats of an orchestrator in the list hang under it; if it is not here (a search), they stand alone. An
  // orchestrator is at work while one of its chats is.
  const mothers = new Set(own.filter((e) => isOrchestrator(e.row)).map((e) => e.row.sessionId));
  const busyMothers = new Set(own.filter((e) => e.row.status === 'busy' && mothers.has(e.row.parentId)).map((e) => e.row.parentId));
  for (const e of [...entries].sort(newest)) {
    if (e.row.archived) sec.archived.push(e);
    else if (e.home) sec.visiting.push(e);
    else if (mothers.has(e.row.parentId)) sec.kids.set(e.row.parentId, [...(sec.kids.get(e.row.parentId) ?? []), e]);
    else if (e.row.status === 'busy' || busyMothers.has(e.row.sessionId)) sec.working.push(e);
    else if (isCut(e.row)) sec.cutoff.push(e);
    else sec.recent.push(e);
  }
  // The project's orchestrator leads whatever group it is in (sort keeps the rest newest first).
  for (const g of SECTION_GROUPS) sec[g].sort((a, b) => isOrchestrator(b.row) - isOrchestrator(a.row));
  for (const list of sec.kids.values()) list.sort((a, b) => (b.row.status === 'busy') - (a.row.status === 'busy'));
  sec.counts = {
    working: own.filter((e) => e.row.status === 'busy').length,
    cutoff: own.filter((e) => isCut(e.row)).length,
    total: entries.length,
  };
  sec.newest = entries.reduce((m, e) => (String(e.row.updatedAt ?? '') > m ? String(e.row.updatedAt) : m), '');
  return sec;
}

// Projects with something working, then the most recently active.
const bySection = (a, b) => (b.counts.working > 0) - (a.counts.working > 0) || b.newest.localeCompare(a.newest);

// opts: projectId, scope ('project' | 'all'), query, nodeId (only that box and below, in the open project), showArchived,
// skip (the ids "Needs you" shows: kept out of the sections, so no row shows twice, and the rows of the waiting state),
// bucket (one of STATE_FILTERS, the chip picked: only that state's rows, visitors out; archived ones go in sec.archived).
// Each entry: {row, project, nodeId, place, home (a visitor's own project, mm24)}. The flat lists (working now, cut off,
// waiting for the person, the rest, newest first in each; visitors apart) hold every visible row, archived ones with
// showArchived, for the page to look rows up. sections: one per project, in SECTION_GROUPS (mm49), never an archived row;
// archived: the visible archived rows, for the folded group at the bottom. counts has every state over the rows the scope,
// the search and the box leave, archived included (its waiting is the open scope's own: the page counts Needs you whole).
export function listConversations(state, { projectId, scope = 'project', query = '', nodeId = null, showArchived = false, skip = null, bucket = null } = {}) {
  const q = plain(query);
  const projects = scope === 'all' ? state.projects : state.projects.filter((p) => p.id === projectId);
  const entries = [];
  const sections = [];
  const counts = Object.fromEntries(STATE_FILTERS.map((b) => [b, 0]));
  for (const project of projects) {
    const mine = [];
    const index = indexOf(archTree(project));
    const homeOf = (row) => state.projects.find((p) => p.id === row.bornIn.projectId) ?? { id: row.bornIn.projectId, name: row.bornIn.name };
    const rows = [...conversationsOf(project).map((row) => ({ row })), ...visitorsOf(project).map((row) => ({ row, home: homeOf(row) }))];
    for (const { row, home } of rows) {
      const at = nodeIn(index, row);
      if (nodeId && project.id === projectId && at !== nodeId && !index.get(at).path.includes(nodeId)) continue;
      const place = placeIn(index, row, at);
      if (q && !plain([row.title, ...place.path, scope === 'all' ? project.name : ''].join(' ')).includes(q)) continue;
      if (!home) counts[bucketOf(row, skip)] += 1;
      if (!visible(row, showArchived)) continue;
      if (bucket && (home || bucketOf(row, skip) !== bucket)) continue;
      mine.push(home ? { row, project, nodeId: at, place, home } : { row, project, nodeId: at, place });
    }
    entries.push(...mine);
    const grouped = mine.filter((e) => (bucket === 'archived' ? e.row.archived : !e.row.archived && !skip?.has(e.row.sessionId)));
    if (grouped.length) sections.push(sectionOf(project, grouped));
  }
  const own = entries.filter((e) => !e.home);
  const working = own.filter((e) => e.row.status === 'busy').sort(newest);
  const cutoff = own.filter((e) => isCut(e.row)).sort(newest);
  const waiting = own.filter((e) => e.row.status !== 'busy' && !isCut(e.row) && e.row.waiting).sort(newest);
  const recent = own.filter((e) => e.row.status !== 'busy' && !isCut(e.row) && !e.row.waiting).sort(newest);
  const visiting = entries.filter((e) => e.home).sort(newest);
  const archived = own.filter((e) => e.row.archived).sort(newest);
  return { working, cutoff, waiting, recent, visiting, archived, total: entries.length, counts, sections: sections.sort(bySection) };
}

// What a conversation waiting for the person needs from them, in one line (mm49): the item it waits on when it names one,
// else the kind of its waiting signal (a question, or a reply that ends asking).
export function needOf(chat) {
  const item = chat.waiting?.items?.[0];
  if (item) return { text: item };
  return { key: waitingSignal({ chat })?.reason === 'question' ? 'convs.need.question' : 'convs.need.asks' };
}

// "Needs you" (mm49): needs is now.js needsYou(state), the one count of the page that the amber pill reads too, made into
// rows of the list for every project whatever the scope: a question first, then newest. The search and the box filter
// narrow it like the rest of the list; with neither, it holds exactly needs. Each entry: {row, project, nodeId, place,
// chat, need}.
export function needsEntries(state, needs, { projectId = null, query = '', nodeId = null } = {}) {
  const q = plain(query);
  const indexes = new Map();
  const out = [];
  for (const { project, chat } of needs) {
    if (!indexes.has(project.id)) indexes.set(project.id, indexOf(archTree(project)));
    const index = indexes.get(project.id);
    const row = conversationsOf(project).find((r) => r.sessionId === chat.sessionId) ?? rowOfChat(chat);
    const at = nodeIn(index, row);
    if (nodeId && (project.id !== projectId || (at !== nodeId && !index.get(at).path.includes(nodeId)))) continue;
    const place = placeIn(index, row, at);
    if (q && !plain([row.title, ...place.path, project.name].join(' ')).includes(q)) continue;
    out.push({ row, project, nodeId: at, place, chat, need: needOf(chat) });
  }
  const rank = (e) => (e.chat.waiting.strong ? 0 : e.chat.waiting.items.length ? 1 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || newest(a, b));
}

// How many conversations each box holds, itself and below: the number on the box, which filters the list to it.
export function conversationCounts(project, tree, { showArchived = false } = {}) {
  const index = indexOf(tree);
  const counts = new Map();
  for (const row of [...conversationsOf(project), ...visitorsOf(project)]) {
    if (!visible(row, showArchived)) continue;
    const at = nodeIn(index, row);
    for (const id of [...index.get(at).path, at]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ---- the column ---------------------------------------------------------------------------------

// Every origin has its own drawn icon and word, so a row never leaves "where does this run?" open.
const ORIGIN_ICON = { map: 'map', vscode: 'code', desktop: 'desktop', terminal: 'terminal', remote: 'phone', claudeai: 'globe', sdk: 'auto', deepseek: 'spark' };
export const originIcon = (origin) => ORIGIN_ICON[origin] ?? 'terminal';
const STEP_KINDS = new Set(['edit', 'read', 'run', 'search', 'web', 'agent', 'team', 'skill', 'plan', 'ask', 'think', 'tool']);
// The groups that show how many they hold (Recent is the quiet rest), and the one that pages its rows.
const COUNTED = new Set(['needs', 'working', 'cutoff', 'visiting', 'archived']);
const PAGED = new Set(['recent', 'archived']);

const toneOf = (row) => (row.status === 'busy' ? 'busy' : isCut(row) ? 'cutoff' : row.waiting ? 'waiting' : row.status === 'idle' ? 'idle' : 'closed');
// The word on every row (mm33): its state, and "finished, not seen yet" until the person opens it.
export const stateOf = (row, unseen) => (row.status !== 'busy' && !isCut(row) && !row.waiting && unseen?.has(row.sessionId) ? 'unseen' : toneOf(row));
// The small mark of an orchestrator's chat (one line, no place): done, at work, cut off.
const KID_ICON = { cutoff: 'stop', waiting: 'bell' };

// ctx: root (the column), h, t (translator getter), lang() (the page's language), icon(name, cls), relative(iso),
// money(usd), list(names) (joined in the page's language), phone (media query), state(), project(), current() (the
// conversation the chat sheet shows), unseen() (the ids finished and not seen yet), nodeLabel(id), onOpen(entry),
// onMove(entry) (move or rename it), onContinue(entry) (a cut-off one, as the Cut off panel does), onFilter() (the box
// filter changed: the map redraws its pressed numbers), onDrawer(open) (the phone's drawer opened or closed), store {get, set}.
export function createConvList(ctx) {
  const { root, h, icon, store } = ctx;
  const byId = (id) => document.getElementById(id);
  const list = byId('convsList');
  const search = byId('convsSearch');
  const filterEl = byId('convsFilter');
  const scrim = byId('convsScrim');
  const archivedBtn = byId('convsArchived');
  const scopeEl = byId('convsScopeSeg');
  const statesEl = byId('convsStates');
  let scope = store.get('sm.convs.scope') === 'all' ? 'all' : 'project';
  let collapsed = store.get('sm.convs.collapsed') === '1';
  let query = '';
  let filter = null;
  // The state chip picked under the switch (mm43): not saved; a change of project or of scope keeps it.
  let picked = null;
  // "Archived · N" at the bottom: folded until the person opens it, and folded again on the next visit.
  let archivedOpen = false;
  // "<projectId>:<group>" of the groups showing every row, past the first page.
  let showAll = new Set();
  // projectId → true (open) | false (closed), as the person left each project folder in "All projects".
  let folders = {};
  try { folders = JSON.parse(store.get('sm.convs.folders') ?? '{}') ?? {}; } catch { folders = {}; }
  // What had the focus when the phone's drawer opened: it gets it back when the drawer closes.
  let opener = null;

  const placeWords = (e, full) => {
    const tt = ctx.t();
    if (e.place.special) return tt(`convs.place.${e.place.special}`);
    // On the row, the part it works on (the item would repeat the title); the whole way down in its tooltip.
    return full ? e.place.path.join(' › ') : e.place.path.slice(0, 2).at(-1);
  };
  const stepText = (step) => (STEP_KINDS.has(step.kind) ? ctx.t()(`live.step.${step.kind}`, { target: step.target }) : '');
  const workText = (work) => (work ? ctx.t()('convs.work', { born: work.born, where: ctx.list(work.working) }) : '');
  const nowMs = () => Date.parse(ctx.state()?.generatedAt ?? '') || Date.now();
  const when = (iso) => shortWhen(iso, nowMs(), ctx.lang?.() ?? 'en');

  // The project of a row that is not the open one ("Needs you" spans them all; "All projects" names them in that group).
  const projectTag = (project) => h('span', { class: 'cv-proj', style: `--p-h:${projectHue(project)}` },
    h('span', { class: 'cv-proj-dot', 'aria-hidden': 'true' }), h('span', { class: 'cv-proj-name' }, project.name));

  // Where it runs, as a quiet icon; the word is its tooltip and is read out.
  function originMark(row) {
    const tt = ctx.t();
    if (isOrchestrator(row)) return h('span', { class: 'cv-origin-mark is-orch', title: tt('convs.orchestratorTitle') }, icon('auto', 'cv-title-icon'), h('span', { class: 'visually-hidden' }, `${tt('convs.orchestrator')}: `));
    const word = tt(`convs.origin.${row.origin}`);
    return h('span', { class: `cv-origin-mark o-${row.origin}`, title: tt('convs.origin.title', { origin: word }) }, icon(originIcon(row.origin), 'cv-origin'), h('span', { class: 'visually-hidden' }, word));
  }

  // Cost and ⋯ (move or rename): shown on hover and on focus, where the time was.
  function hoverBox(e, title) {
    const tt = ctx.t();
    return h('div', { class: 'cv-hov' },
      e.row.costUSD != null ? h('span', { class: 'num cv-cost' }, ctx.money(e.row.costUSD)) : null,
      h('button', {
        type: 'button', class: 'cv-move', 'aria-label': tt('convs.moveAria', { title }), title: tt('convs.move'), 'aria-haspopup': 'dialog',
        onclick: () => ctx.onMove(e),
      }, icon('more', 'cv-move-icon')));
  }

  // An activity chat of the orchestrator: one line under it, its mark, title and time; item and model in its tooltip.
  function kidView(e) {
    const tt = ctx.t();
    const { row } = e;
    const title = row.title || tt('chat.untitled');
    const state = stateOf(row, ctx.unseen?.());
    const current = ctx.current() === row.sessionId;
    const job = [row.itemCode, row.runModel ? modelName(row.runModel) : null].filter(Boolean).join(' · ');
    const tone = toneOf(row);
    const mark = tone === 'busy' ? null : KID_ICON[tone] ?? 'check';
    return h('li', { class: 'cv-item cv-kid' },
      h('div', { class: 'cv-line' },
        h('button', {
          type: 'button', class: `cv-row tone-${tone}${state === 'unseen' ? ' is-unseen' : ''}${current ? ' is-current' : ''}`, 'data-session': row.sessionId,
          'aria-current': current ? 'true' : null, title: [title, job].filter(Boolean).join('\n'), onclick: () => ctx.onOpen(e),
        },
        mark ? icon(mark, 'cv-kid-icon') : h('span', { class: 'cv-kid-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'cv-title' }, title),
        h('span', { class: 'cv-when num' }, when(row.updatedAt)),
        h('span', { class: `cv-state s-${state}` }, tt(`convs.state.${state}`)),
        job ? h('span', { class: 'visually-hidden' }, ` · ${job}`) : null),
        hoverBox(e, title)));
  }

  // Title and time; where it runs and its place on the map; then one line by group: what is needed, the step it is on, or
  // where else it works. The state word is read out (the group says it on screen). An orchestrator carries its activity
  // chats indented under it.
  function rowView(e, { kids = [], group }) {
    const tt = ctx.t();
    const { row } = e;
    const state = group === 'needs' ? 'waiting' : stateOf(row, ctx.unseen?.());
    const current = ctx.current() === row.sessionId;
    const title = row.title || tt('chat.untitled');
    const step = row.status === 'busy' && row.lastStep ? stepText(row.lastStep) : '';
    const work = workText(workWords(row, e.project));
    const other = e.home ?? (group === 'needs' && (scope === 'all' || e.project.id !== ctx.project()?.id) ? e.project : null);
    const need = e.need ? (e.need.text ?? tt(e.need.key)) : '';
    const orch = isOrchestrator(row);
    const line = h('div', { class: 'cv-line' },
      h('button', {
        type: 'button', class: `cv-row tone-${group === 'needs' ? 'waiting' : toneOf(row)}${state === 'unseen' ? ' is-unseen' : ''}${current ? ' is-current' : ''}`,
        'data-session': row.sessionId, 'aria-current': current ? 'true' : null,
        title: `${title}\n${e.project.name} › ${placeWords(e, true)}`, onclick: () => ctx.onOpen(e),
      },
      h('span', { class: 'cv-title' }, state === 'unseen' ? h('span', { class: 'cv-unseen-dot', 'aria-hidden': 'true' }) : null, orch ? originMark(row) : null, title),
      h('span', { class: 'cv-when num' }, when(row.updatedAt)),
      // The orchestrator's place is always the whole project: its icon says what it is, its step line what it does.
      orch && !other ? null : h('span', { class: 'cv-meta' }, orch ? null : originMark(row), other ? projectTag(other) : null, orch ? null : h('span', { class: `cv-path${e.place.special ? ` is-${e.place.special}` : ''}` }, placeWords(e))),
      need ? h('span', { class: 'cv-need' }, icon('next', 'cv-need-icon'), h('span', { class: 'cv-need-text' }, need)) : null,
      step ? h('span', { class: 'cv-step' }, h('span', { class: 'cv-step-dot', 'aria-hidden': 'true' }), h('span', { class: 'cv-step-text' }, step)) : null,
      work ? h('span', { class: 'cv-work', title: tt('convs.workTitle') }, icon('connect', 'cv-work-icon'), h('span', { class: 'cv-work-text' }, work)) : null,
      h('span', { class: `cv-state s-${state}` }, tt(`convs.state.${state}`))),
      hoverBox(e, title));
    const go = group === 'cutoff' ? h('button', {
      type: 'button', class: 'btn small-btn cv-continue', 'aria-label': tt('convs.continueAria', { title }), onclick: () => ctx.onContinue?.(e),
    }, icon('send', 'btn-icon'), tt('cut.continue')) : null;
    const cls = `cv-item${e.home ? ' is-visitor' : ''}`;
    if (!kids.length) return h('li', { class: cls }, line, go);
    return h('li', { class: `${cls} has-kids` }, line, go,
      h('ul', { class: 'cv-kids', 'aria-label': tt('convs.kidsAria', { n: kids.length }) }, kids.map(kidView)));
  }

  // A group: its dot, name and "· N", then its rows; Recent and Archived page theirs.
  function groupView(name, entries, { key, heading = 'h3', kids = new Map() }) {
    if (!entries.length) return null;
    const tt = ctx.t();
    const shown = PAGED.has(name) && !showAll.has(key) ? entries.slice(0, RECENT_PAGE) : entries;
    const rest = entries.length - shown.length;
    const id = `cv-g-${key.replace(/[^\w-]/g, '-')}`;
    const n = name === 'working' ? entries.filter((e) => e.row.status === 'busy').length + entries.reduce((m, e) => m + (kids.get(e.row.sessionId) ?? []).filter((k) => k.row.status === 'busy').length, 0) : entries.length;
    return h('section', { class: `cv-group g-${name}`, 'aria-labelledby': id },
      h(heading, { id, class: 'cv-group-head' },
        h('span', { class: 'cv-group-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'cv-group-name' }, tt(`convs.group.${name}`)),
        COUNTED.has(name) ? h('span', { class: 'cv-group-n num' }, String(n)) : null),
      h('ul', { class: 'cv-rows' }, shown.map((e) => rowView(e, { kids: kids.get(e.row.sessionId) ?? [], group: name }))),
      rest > 0 ? h('button', { type: 'button', class: 'btn small-btn cv-more', onclick: () => { showAll.add(key); render(); } }, tt('convs.more', { n: rest })) : null);
  }

  const groupsOf = (sec, heading) => (picked === 'archived' ? ['archived'] : SECTION_GROUPS).map((g) => groupView(g, sec[g], { key: `${sec.project.id}:${g}`, heading, kids: sec.kids })).filter(Boolean);

  // Open unless the person closed it; a project with work going on, the open one, a search and a state chip show open by default.
  const isFolderOpen = (sec, openId) => (query.trim() || picked ? true : folders[sec.project.id] ?? (sec.project.id === openId || sec.counts.working > 0 || sec.counts.cutoff > 0));

  // "All projects": one card per project, its colour band and name, how many work and wait in it, and its groups.
  function folderView(sec, openId, waiting) {
    const tt = ctx.t();
    const opened = isFolderOpen(sec, openId);
    const bodyId = `cv-p-${sec.project.id}`;
    const counters = [
      sec.counts.working ? h('span', { class: 'cv-pc is-working num', title: tt('convs.projectWorking', { n: sec.counts.working }) }, h('span', { class: 'cv-pc-dot', 'aria-hidden': 'true' }), String(sec.counts.working), h('span', { class: 'visually-hidden' }, ` ${tt('convs.projectWorking', { n: sec.counts.working })}`)) : null,
      waiting ? h('span', { class: 'cv-pc is-waiting num', title: tt('convs.projectWaiting', { n: waiting }) }, h('span', { class: 'cv-pc-dot', 'aria-hidden': 'true' }), String(waiting), h('span', { class: 'visually-hidden' }, ` ${tt('convs.projectWaiting', { n: waiting })}`)) : null,
    ];
    const inside = [h('span', { class: 'cv-proj-dot cv-folder-dot', 'aria-hidden': 'true' }), h('span', { class: 'cv-folder-name' }, sec.project.name),
      h('span', { class: 'cv-folder-counts' }, counters, h('span', { class: 'cv-folder-n num' }, String(sec.counts.total)))];
    return h('section', { class: `cv-folder${opened ? ' is-open' : ''}`, style: `--p-h:${sec.hue}`, 'data-project': sec.project.id },
      h('h3', { class: 'cv-folder-head' }, h('button', {
        type: 'button', class: 'cv-folder-btn', 'aria-expanded': String(opened), 'aria-controls': bodyId, title: tt('convs.projectToggle', { name: sec.project.name }),
        onclick: () => {
          folders[sec.project.id] = !opened;
          store.set('sm.convs.folders', JSON.stringify(folders));
          render();
        },
      }, icon('chevron', 'cv-folder-chevron'), inside)),
      h('div', { class: 'cv-folder-body', id: bodyId, hidden: !opened }, opened ? groupsOf(sec, 'h4') : null));
  }

  function renderFilter() {
    const name = filter ? ctx.nodeLabel(filter) : null;
    if (filter && !name) filter = null;
    filterEl.hidden = !filter;
    if (!filter) return filterEl.replaceChildren();
    const tt = ctx.t();
    return filterEl.replaceChildren(
      h('span', { class: 'cv-filter-text' }, tt('convs.filter', { name })),
      h('button', { type: 'button', class: 'cv-filter-clear', 'aria-label': tt('convs.filterClear'), title: tt('convs.filterClear'), onclick: () => filterTo(null) }, icon('close', 'cv-filter-icon')));
  }

  // The switch under the search, "This project | All projects": a tablist of two, the open one selected and the only stop
  // of the Tab key; the arrows, Home and End move inside it and choose as they go.
  const SCOPES = ['project', 'all'];
  const scopeTabs = SCOPES.map((value) => h('button', {
    type: 'button', role: 'tab', class: 'cv-seg-btn', 'data-scope': value, 'aria-controls': 'convsList',
    onclick: () => setScope(value),
    onkeydown: (e) => {
      const at = SCOPES.indexOf(scope);
      const to = e.key === 'ArrowLeft' ? SCOPES[(at + SCOPES.length - 1) % SCOPES.length] : e.key === 'ArrowRight' ? SCOPES[(at + 1) % SCOPES.length]
        : e.key === 'Home' ? SCOPES[0] : e.key === 'End' ? SCOPES.at(-1) : null;
      if (!to) return;
      e.preventDefault();
      setScope(to);
      scopeTabs[SCOPES.indexOf(to)].focus({ preventScroll: true });
    },
  }));
  scopeEl.replaceChildren(...scopeTabs);
  function renderScope() {
    const tt = ctx.t();
    scopeEl.setAttribute('aria-label', tt('convs.scope'));
    scopeTabs.forEach((b, i) => {
      const on = SCOPES[i] === scope;
      b.textContent = tt(`convs.scope.${SCOPES[i]}`);
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
  }
  function setScope(next) {
    if (next === scope) return;
    scope = next;
    store.set('sm.convs.scope', scope);
    if (scope === 'all' && filter) { filter = null; ctx.onFilter(); }
    showAll = new Set();
    render();
  }

  // The five state chips under the switch, each with its dot, word and how many: built once, so the focus stays on one
  // while the list is drawn again. One stays pressed; a second click lets it go.
  const stateChips = STATE_FILTERS.map((b) => {
    const word = h('span', { class: 'cv-sc-word' });
    const n = h('span', { class: 'cv-sc-n num' });
    const btn = h('button', {
      type: 'button', class: `cv-sc c-${b}`, 'data-state': b, 'aria-pressed': 'false',
      onclick: () => { picked = picked === b ? null : b; showAll = new Set(); render(); },
    }, h('span', { class: 'cv-sc-dot', 'aria-hidden': 'true' }), word, n);
    return { b, btn, word, n };
  });
  statesEl.replaceChildren(...stateChips.map((c) => c.btn));
  function renderStates(counts) {
    const tt = ctx.t();
    statesEl.setAttribute('aria-label', tt('convs.states'));
    for (const { b, btn, word, n } of stateChips) {
      word.textContent = tt(`convs.states.${b}`);
      n.textContent = String(counts[b] ?? 0);
      btn.setAttribute('aria-pressed', String(picked === b));
      btn.setAttribute('class', `cv-sc c-${b}${counts[b] ? '' : ' is-zero'}`);
    }
  }

  // "Archived · N" at the foot of the column, folded or open.
  function renderArchived(n) {
    const tt = ctx.t();
    archivedBtn.hidden = n === 0;
    archivedBtn.setAttribute('aria-expanded', String(archivedOpen && n > 0));
    archivedBtn.replaceChildren(icon('next', 'cv-archived-chevron'), h('span', { class: 'cv-archived-name' }, tt('convs.group.archived')), h('span', { class: 'cv-archived-n num' }, String(n)));
  }

  function render() {
    renderScope();
    const s = ctx.state();
    const p = ctx.project();
    if (!s || !p) return;
    const tt = ctx.t();
    renderFilter();
    // One count of what needs the person (mm47, mm49): the amber pill's own needsYou, rows from every project.
    const all = needsYou(s);
    const needs = needsEntries(s, all, { projectId: p.id, query, nodeId: filter });
    const out = listConversations(s, { projectId: p.id, scope, query, nodeId: filter, showArchived: true, skip: new Set(all.map((n) => n.chat.sessionId)), bucket: picked });
    // The chips count the rows the search and the box leave, "Waiting for you" being Needs you whole, as the pill counts it.
    const counts = picked ? listConversations(s, { projectId: p.id, scope, query, nodeId: filter, showArchived: true, skip: new Set(all.map((n) => n.chat.sessionId)) }).counts : out.counts;
    renderStates({ ...counts, waiting: needs.length });
    const mine = conversationsOf(p).filter((r) => !r.archived);
    byId('convsRailCount').textContent = String(mine.length);
    byId('convsRailLive').hidden = !mine.some((r) => r.status === 'busy');
    root.classList.toggle('is-all', scope === 'all');
    renderArchived(counts.archived);
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    // The row's item, not only its line: Continue sits beside the line, and keeps the focus at each poll too.
    const keep = focused ? {
      session: focused.closest('.cv-item')?.querySelector('[data-session]')?.dataset.session,
      move: focused.classList.contains('cv-move'),
      go: Boolean(focused.closest('.cv-continue')),
      project: focused.closest('.cv-folder-btn') ? focused.closest('[data-project]')?.dataset.project : null,
    } : null;
    const top = list.scrollTop;
    const waitingIn = (id) => needs.filter((e) => e.project.id === id).length;
    // A chip narrows the inbox to its state: Waiting for you is the Needs you group alone, the others keep the project cards.
    const sections = picked === 'waiting' ? [] : scope === 'all' ? out.sections.map((sec) => folderView(sec, p.id, waitingIn(sec.project.id))) : out.sections.flatMap((sec) => groupsOf(sec, 'h3'));
    let body = [
      !picked || picked === 'waiting' ? groupView('needs', needs, { key: 'needs' }) : null,
      ...sections,
      archivedOpen && !picked ? groupView('archived', out.archived, { key: 'archived' }) : null,
    ].filter(Boolean);
    if (!body.length) {
      let empty = { art: 'chat', title: tt('convs.emptyTitle'), text: scope === 'all' ? tt('convs.emptyAll') : tt('convs.empty') };
      if (picked) empty = { art: 'chat', title: tt('convs.stateEmpty', { name: tt(`convs.states.${picked}`) }), text: tt('convs.stateEmptyText') };
      if (filter) empty = { art: 'map', title: tt('convs.filterEmpty', { name: ctx.nodeLabel(filter) }), text: tt('convs.filterEmptyText') };
      if (query.trim()) empty = { art: 'search', title: tt('convs.noMatch', { q: query.trim() }), text: tt('convs.noMatchText') };
      body = [emptyState({ h, icon: ctx.icon }, { ...empty, compact: true })];
    }
    list.replaceChildren(...body);
    list.scrollTop = top;
    if (keep?.project) list.querySelector(`[data-project="${CSS.escape(keep.project)}"] .cv-folder-btn`)?.focus({ preventScroll: true });
    else if (keep?.session) {
      const row = list.querySelector(`[data-session="${CSS.escape(keep.session)}"]`);
      const to = keep.go ? row?.closest('.cv-item')?.querySelector('.cv-continue') : keep.move ? row?.closest('.cv-line')?.querySelector('.cv-move') : row;
      to?.focus({ preventScroll: true });
    }
  }

  function syncCollapsed() {
    root.classList.toggle('is-collapsed', collapsed);
    byId('convsCollapse').setAttribute('aria-expanded', String(!collapsed));
    byId('convsExpand').setAttribute('aria-expanded', String(!collapsed));
  }
  function setCollapsed(on) {
    collapsed = on;
    store.set('sm.convs.collapsed', on ? '1' : '0');
    syncCollapsed();
    requestAnimationFrame(() => (on ? byId('convsExpand') : search).focus({ preventScroll: true }));
  }

  // On a phone the column is the bottom bar's Conversations: it covers the map between the two bars.
  const isDrawerOpen = () => root.classList.contains('is-open');
  function setDrawer(on) {
    if (on === isDrawerOpen()) return;
    if (on) opener = document.activeElement;
    root.classList.toggle('is-open', on);
    scrim.hidden = !on;
    ctx.onDrawer?.(on);
    if (on) requestAnimationFrame(() => (list.querySelector('.cv-row') ?? search).focus({ preventScroll: true }));
    else if (root.contains(document.activeElement)) opener?.focus?.({ preventScroll: true });
  }

  function filterTo(nodeId) {
    filter = nodeId;
    showAll = new Set();
    if (nodeId) {
      scope = 'project';
      if (ctx.phone.matches) setDrawer(true);
      else if (collapsed) setCollapsed(false);
    }
    render();
    ctx.onFilter();
  }

  search.addEventListener('input', () => { query = search.value; showAll = new Set(); render(); });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !search.value) return;
    e.stopPropagation();
    search.value = '';
    query = '';
    render();
  });
  archivedBtn.addEventListener('click', () => {
    archivedOpen = !archivedOpen;
    render();
    if (archivedOpen) list.querySelector?.('.g-archived')?.scrollIntoView?.({ block: 'nearest' });
  });
  byId('convsCollapse').addEventListener('click', () => (ctx.phone.matches ? setDrawer(false) : setCollapsed(true)));
  byId('convsExpand').addEventListener('click', () => setCollapsed(false));
  scrim.addEventListener('click', () => setDrawer(false));
  syncCollapsed();
  renderScope();
  renderStates({});

  return {
    render,
    filterTo,
    filterNode: () => filter,
    isDrawerOpen,
    openDrawer: () => setDrawer(true),
    closeDrawer: () => setDrawer(false),
    // Box ids repeat across projects ("pt:orders"): a filter never follows the page to another project.
    projectChanged() { filter = null; showAll = new Set(); },
  };
}
