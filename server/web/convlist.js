// The list of conversations (plano-v02, v0.2.2 item 0): a column on the left of the map, a drawer on a phone.
// The pure part on top is what node:test loads; createConvList below touches the DOM only when called.
import { archTree, ownerHue } from './tree.js';
import { emptyState } from './empty.js';

const RECENT_PAGE = 50;
const SPECIAL = new Set(['idea', 'create-arch', 'flow']);
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const newest = (a, b) => String(b.row.updatedAt ?? '').localeCompare(String(a.row.updatedAt ?? ''));

function originOfChat(c) {
  if (c.entrypoint === 'claude-vscode') return 'vscode';
  if (c.entrypoint === 'claude-desktop') return 'desktop';
  return String(c.entrypoint ?? '').startsWith('sdk') ? 'sdk' : 'terminal';
}

// A server older than the list sends only the map's chats: they make the rows, without the older conversations.
export function conversationsOf(project) {
  if (Array.isArray(project.conversations)) return project.conversations;
  return project.chats.map((c) => ({
    sessionId: c.sessionId, title: c.title, origin: originOfChat(c), partId: c.partId, itemCode: c.itemCode ?? null, node: null,
    status: c.status, waiting: Boolean(c.waiting.strong || c.waiting.weak || c.waiting.items.length), lastStep: c.liveSteps?.at(-1) ?? null,
    costUSD: c.costUSD, startedAt: c.startedAt, updatedAt: c.updatedAt, archived: c.archived, live: c.live, chattable: c.chattable, onMap: true,
  }));
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
// The groups of a project's section, top to bottom (mm04).
export const SECTION_GROUPS = ['pinned', 'working', 'waiting', 'visiting', ...DATE_GROUPS];

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

// Each project's own color, the same everywhere a project shows (list, picker, Now strip).
export const projectHue = (project) => ownerHue(project.id);

const isPinned = (row) => row.node?.kind === 'orchestration';

function sectionOf(project, entries, nowMs) {
  const sec = { project, hue: projectHue(project), pinned: [], working: [], waiting: [], visiting: [], today: [], yesterday: [], week: [], older: [] };
  const own = entries.filter((e) => !e.home);
  for (const e of [...entries].sort(newest)) {
    if (e.home) sec.visiting.push(e);
    else if (isPinned(e.row)) sec.pinned.push(e);
    else if (e.row.status === 'busy') sec.working.push(e);
    else if (e.row.waiting) sec.waiting.push(e);
    else sec[dateGroup(e.row.updatedAt, nowMs)].push(e);
  }
  sec.counts = {
    working: own.filter((e) => e.row.status === 'busy').length,
    waiting: own.filter((e) => e.row.status !== 'busy' && e.row.waiting).length,
    total: entries.length,
  };
  sec.newest = entries.reduce((m, e) => (String(e.row.updatedAt ?? '') > m ? String(e.row.updatedAt) : m), '');
  return sec;
}

// Projects with something working, then waiting for the person, then the most recently active.
const bySection = (a, b) => (b.counts.working > 0) - (a.counts.working > 0) || (b.counts.waiting > 0) - (a.counts.waiting > 0) || b.newest.localeCompare(a.newest);

// opts: projectId, scope ('project' | 'all'), query, nodeId (only that box and below, in the open project), showArchived.
// Each entry: {row, project, nodeId, place, home (a visitor's own project, mm24)}. Working now, then waiting for the person,
// then the rest, newest first in each; visitors apart; sections: the same entries per project, in SECTION_GROUPS (mm04).
export function listConversations(state, { projectId, scope = 'project', query = '', nodeId = null, showArchived = false } = {}) {
  const q = plain(query);
  const projects = scope === 'all' ? state.projects : state.projects.filter((p) => p.id === projectId);
  const entries = [];
  const sections = [];
  const nowMs = Date.parse(state.generatedAt) || Date.now();
  for (const project of projects) {
    const mine = [];
    const index = indexOf(archTree(project));
    const homeOf = (row) => state.projects.find((p) => p.id === row.bornIn.projectId) ?? { id: row.bornIn.projectId, name: row.bornIn.name };
    const rows = [...conversationsOf(project).map((row) => ({ row })), ...visitorsOf(project).map((row) => ({ row, home: homeOf(row) }))];
    for (const { row, home } of rows) {
      if (!visible(row, showArchived)) continue;
      const at = nodeIn(index, row);
      if (nodeId && project.id === projectId && at !== nodeId && !index.get(at).path.includes(nodeId)) continue;
      const place = placeIn(index, row, at);
      if (q && !plain([row.title, ...place.path, scope === 'all' ? project.name : ''].join(' ')).includes(q)) continue;
      mine.push(home ? { row, project, nodeId: at, place, home } : { row, project, nodeId: at, place });
    }
    entries.push(...mine);
    if (mine.length) sections.push(sectionOf(project, mine, nowMs));
  }
  const own = entries.filter((e) => !e.home);
  const working = own.filter((e) => e.row.status === 'busy').sort(newest);
  const waiting = own.filter((e) => e.row.status !== 'busy' && e.row.waiting).sort(newest);
  const recent = own.filter((e) => e.row.status !== 'busy' && !e.row.waiting).sort(newest);
  const visiting = entries.filter((e) => e.home).sort(newest);
  return { working, waiting, recent, visiting, total: entries.length, sections: sections.sort(bySection) };
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
const ORIGIN_ICON = { map: 'map', vscode: 'code', desktop: 'desktop', terminal: 'terminal', remote: 'phone', claudeai: 'globe', sdk: 'auto' };
export const originIcon = (origin) => ORIGIN_ICON[origin] ?? 'terminal';
const STEP_KINDS = new Set(['edit', 'read', 'run', 'search', 'web', 'agent', 'team', 'skill', 'plan', 'ask', 'think', 'tool']);
const DATED = new Set(DATE_GROUPS);

const toneOf = (row) => (row.status === 'busy' ? 'busy' : row.waiting ? 'waiting' : row.status === 'idle' ? 'idle' : 'closed');
// The word on every row (mm33): its state, and "finished, not seen yet" until the person opens it.
export const stateOf = (row, unseen) => (row.status !== 'busy' && !row.waiting && unseen?.has(row.sessionId) ? 'unseen' : toneOf(row));
// Each group's own icon; its colour comes from the g-<name> class.
const GROUP_ICON = { pinned: 'compass', working: 'auto', waiting: 'bell', visiting: 'connect', today: 'clock', yesterday: 'clock', week: 'clock', older: 'calendar' };

// ctx: root (the column), h, t (translator getter), icon(name, cls), relative(iso), money(usd), list(names) (joined in the
// page's language), phone (media query), state(),
// project(), showArchived(), current() (the conversation the chat sheet shows), unseen() (the ids finished and not seen yet),
// nodeLabel(id), onOpen(entry), onMove(entry)
// (move or rename it), onFilter() (the box filter changed: the map redraws its pressed numbers), store {get, set}.
export function createConvList(ctx) {
  const { root, h, icon, store } = ctx;
  const byId = (id) => document.getElementById(id);
  const list = byId('convsList');
  const search = byId('convsSearch');
  const filterEl = byId('convsFilter');
  const barBtn = byId('convsBtn');
  const scrim = byId('convsScrim');
  let scope = store.get('sm.convs.scope') === 'all' ? 'all' : 'project';
  let collapsed = store.get('sm.convs.collapsed') === '1';
  let query = '';
  let filter = null;
  // "<projectId>:<group>" of the date groups showing every row, past the first page.
  let showAll = new Set();
  // projectId → true (open) | false (closed), as the person left each project folder in "All projects".
  let folders = {};
  try { folders = JSON.parse(store.get('sm.convs.folders') ?? '{}') ?? {}; } catch { folders = {}; }

  const placeWords = (e, full) => {
    const tt = ctx.t();
    if (e.place.special) return tt(`convs.place.${e.place.special}`);
    return (full ? e.place.path : e.place.path.slice(-2)).join(' › ');
  };
  const stepText = (step) => (STEP_KINDS.has(step.kind) ? ctx.t()(`live.step.${step.kind}`, { target: step.target }) : '');
  const workText = (work) => (work ? ctx.t()('convs.work', { born: work.born, where: ctx.list(work.working) }) : '');

  function originBadge(origin) {
    const tt = ctx.t();
    const word = tt(`convs.origin.${origin}`);
    return h('span', { class: `cv-origin-badge o-${origin}`, title: tt('convs.origin.title', { origin: word }) }, icon(originIcon(origin), 'cv-origin'), word);
  }

  // Title and time on top, then the state in a word and where it runs (cost on the right), then its place on the map on a
  // line of its own. The project is the card the row sits in, so the row does not repeat it.
  function rowView(e) {
    const tt = ctx.t();
    const { row } = e;
    const tone = toneOf(row);
    const state = stateOf(row, ctx.unseen?.());
    const current = ctx.current() === row.sessionId;
    const step = row.status === 'busy' && row.lastStep ? stepText(row.lastStep) : '';
    const title = row.title || tt('chat.untitled');
    const where = placeWords(e);
    const work = workText(workWords(row, e.project));
    return h('li', { class: `cv-item${e.home ? ' is-visitor' : ''}` },
      h('button', {
        type: 'button', class: `cv-row tone-${tone}${state === 'unseen' ? ' is-unseen' : ''}${current ? ' is-current' : ''}`, 'data-session': row.sessionId, 'aria-current': current ? 'true' : null,
        title: `${title}\n${e.project.name} › ${placeWords(e, true)}`, onclick: () => ctx.onOpen(e),
      },
      h('span', { class: 'cv-title' }, title),
      h('span', { class: 'cv-side' },
        h('span', { class: 'cv-when num' }, row.updatedAt ? ctx.relative(row.updatedAt) : ''),
        row.costUSD != null ? h('span', { class: 'num cv-cost' }, ctx.money(row.costUSD)) : null),
      h('span', { class: 'cv-badges' },
        h('span', { class: `cv-state s-${state}` }, h('span', { class: 'cv-state-dot', 'aria-hidden': 'true' }), tt(`convs.state.${state}`)),
        originBadge(row.origin)),
      step ? h('span', { class: 'cv-step' }, step) : null,
      where ? h('span', { class: `cv-place${e.place.special ? ` is-${e.place.special}` : ''}` }, icon(e.place.special === 'idea' ? 'idea' : 'map', 'cv-place-icon'), h('span', { class: 'cv-path' }, where)) : null,
      work ? h('span', { class: 'cv-work', title: tt('convs.workTitle') }, icon('connect', 'cv-work-icon'), h('span', { class: 'cv-work-text' }, work)) : null),
      h('button', {
        type: 'button', class: 'cv-move', 'aria-label': tt('convs.moveAria', { title }), title: tt('convs.move'), 'aria-haspopup': 'dialog',
        onclick: () => ctx.onMove(e),
      }, icon('more', 'cv-move-icon')));
  }

  function groupView(sec, name, heading) {
    const entries = sec[name];
    if (!entries.length) return null;
    const tt = ctx.t();
    const key = `${sec.project.id}:${name}`;
    const shown = DATED.has(name) && !showAll.has(key) ? entries.slice(0, RECENT_PAGE) : entries;
    const rest = entries.length - shown.length;
    const id = `cv-g-${sec.project.id}-${name}`;
    return h('section', { class: `cv-group g-${name}`, 'aria-labelledby': id },
      h(heading, { id, class: 'cv-group-head' },
        h('span', { class: 'cv-group-mark', 'aria-hidden': 'true' }, icon(GROUP_ICON[name], 'cv-group-icon')),
        h('span', { class: 'cv-group-name' }, tt(`convs.group.${name}`)), h('span', { class: 'cv-group-n num' }, String(entries.length))),
      h('ul', { class: 'cv-rows' }, shown.map(rowView)),
      rest > 0 ? h('button', { type: 'button', class: 'btn small-btn cv-more', onclick: () => { showAll.add(key); render(); } }, tt('convs.more', { n: rest })) : null);
  }

  const groupsOf = (sec, heading) => SECTION_GROUPS.map((g) => groupView(sec, g, heading)).filter(Boolean);

  // Open unless the person closed it; a project with work going on, the open one and a search show open by default.
  const isFolderOpen = (sec, openId) => (query.trim() ? true : folders[sec.project.id] ?? (sec.project.id === openId || sec.counts.working > 0 || sec.counts.waiting > 0));

  function folderView(sec, openId, { collapsible = true } = {}) {
    const tt = ctx.t();
    const opened = !collapsible || isFolderOpen(sec, openId);
    const bodyId = `cv-p-${sec.project.id}`;
    const counters = [
      sec.counts.working ? h('span', { class: 'cv-pc is-working num', title: tt('convs.projectWorking', { n: sec.counts.working }) }, h('span', { class: 'cv-pc-dot', 'aria-hidden': 'true' }), String(sec.counts.working), h('span', { class: 'visually-hidden' }, ` ${tt('convs.projectWorking', { n: sec.counts.working })}`)) : null,
      sec.counts.waiting ? h('span', { class: 'cv-pc is-waiting num', title: tt('convs.projectWaiting', { n: sec.counts.waiting }) }, h('span', { class: 'cv-pc-dot', 'aria-hidden': 'true' }), String(sec.counts.waiting), h('span', { class: 'visually-hidden' }, ` ${tt('convs.projectWaiting', { n: sec.counts.waiting })}`)) : null,
    ];
    const inside = [h('span', { class: 'cv-proj-dot cv-folder-dot', 'aria-hidden': 'true' }), h('span', { class: 'cv-folder-name' }, sec.project.name),
      h('span', { class: 'cv-folder-counts' }, counters, h('span', { class: 'cv-folder-n num' }, String(sec.counts.total)))];
    if (!collapsible) {
      return h('section', { class: 'cv-folder is-open is-fixed', style: `--p-h:${sec.hue}`, 'data-project': sec.project.id, 'aria-labelledby': `${bodyId}-name` },
        h('h3', { class: 'cv-folder-head', id: `${bodyId}-name` }, h('span', { class: 'cv-folder-btn' }, inside)),
        h('div', { class: 'cv-folder-body', id: bodyId }, groupsOf(sec, 'h4')));
    }
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

  function render() {
    const s = ctx.state();
    const p = ctx.project();
    if (!s || !p) return;
    const tt = ctx.t();
    renderFilter();
    for (const b of root.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    const out = listConversations(s, { projectId: p.id, scope, query, nodeId: filter, showArchived: ctx.showArchived() });
    const mine = conversationsOf(p).filter((r) => ctx.showArchived() || !r.archived);
    byId('convsTotal').textContent = String(out.total);
    byId('convsRailCount').textContent = String(mine.length);
    byId('convsBtnCount').textContent = String(mine.length);
    byId('convsRailLive').hidden = !mine.some((r) => r.status === 'busy');
    root.classList.toggle('is-all', scope === 'all');
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const keep = focused ? { session: focused.closest('[data-session]')?.dataset.session ?? focused.closest('.cv-item')?.querySelector('[data-session]')?.dataset.session, move: focused.classList.contains('cv-move'), project: focused.closest('.cv-folder-btn') ? focused.closest('[data-project]')?.dataset.project : null } : null;
    const top = list.scrollTop;
    let body = out.sections.map((sec) => folderView(sec, p.id, { collapsible: scope === 'all' }));
    if (!body.length) {
      let empty = { art: 'chat', title: tt('convs.emptyTitle'), text: scope === 'all' ? tt('convs.emptyAll') : tt('convs.empty') };
      if (filter) empty = { art: 'map', title: tt('convs.filterEmpty', { name: ctx.nodeLabel(filter) }), text: tt('convs.filterEmptyText') };
      if (query.trim()) empty = { art: 'search', title: tt('convs.noMatch', { q: query.trim() }), text: tt('convs.noMatchText') };
      body = [emptyState({ h, icon: ctx.icon }, { ...empty, compact: true })];
    }
    list.replaceChildren(...body);
    list.scrollTop = top;
    if (keep?.project) list.querySelector(`[data-project="${CSS.escape(keep.project)}"] .cv-folder-btn`)?.focus({ preventScroll: true });
    else if (keep?.session) {
      const row = list.querySelector(`[data-session="${CSS.escape(keep.session)}"]`);
      (keep.move ? row?.closest('.cv-item')?.querySelector('.cv-move') : row)?.focus({ preventScroll: true });
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

  // On a phone the column is a drawer from the left, over the page.
  const isDrawerOpen = () => root.classList.contains('is-open');
  function setDrawer(on) {
    root.classList.toggle('is-open', on);
    scrim.hidden = !on;
    barBtn.setAttribute('aria-expanded', String(on));
    if (on) requestAnimationFrame(() => (list.querySelector('.cv-row') ?? search).focus({ preventScroll: true }));
    else if (root.contains(document.activeElement)) barBtn.focus({ preventScroll: true });
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
  for (const b of root.querySelectorAll('[data-scope]')) {
    b.addEventListener('click', () => {
      scope = b.dataset.scope === 'all' ? 'all' : 'project';
      store.set('sm.convs.scope', scope);
      if (scope === 'all' && filter) { filter = null; ctx.onFilter(); }
      showAll = new Set();
      render();
    });
  }
  byId('convsCollapse').addEventListener('click', () => (ctx.phone.matches ? setDrawer(false) : setCollapsed(true)));
  byId('convsExpand').addEventListener('click', () => setCollapsed(false));
  barBtn.addEventListener('click', () => setDrawer(!isDrawerOpen()));
  scrim.addEventListener('click', () => setDrawer(false));
  syncCollapsed();

  return {
    render,
    filterTo,
    filterNode: () => filter,
    isDrawerOpen,
    openDrawer: () => setDrawer(true),
    closeDrawer: () => { if (isDrawerOpen()) setDrawer(false); },
    // Box ids repeat across projects ("pt:orders"): a filter never follows the page to another project.
    projectChanged() { filter = null; showAll = new Set(); },
  };
}
