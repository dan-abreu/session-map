// The list of conversations (plano-v02, v0.2.2 item 0): a column on the left of the map, a drawer on a phone.
// The pure part on top is what node:test loads; createConvList below touches the DOM only when called.
import { archTree } from './tree.js';

const RECENT_PAGE = 50;
const SPECIAL = new Set(['idea', 'create-arch', 'flow']);
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const newest = (a, b) => String(b.row.updatedAt ?? '').localeCompare(String(a.row.updatedAt ?? ''));

function originOfChat(c) {
  if (c.entrypoint === 'claude-vscode') return 'vscode';
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

// opts: projectId, scope ('project' | 'all'), query, nodeId (only that box and below, in the open project), showArchived.
// Each entry: {row, project, nodeId, place}. Working now, then waiting for the person, then the rest, newest first in each.
export function listConversations(state, { projectId, scope = 'project', query = '', nodeId = null, showArchived = false } = {}) {
  const q = plain(query);
  const projects = scope === 'all' ? state.projects : state.projects.filter((p) => p.id === projectId);
  const entries = [];
  for (const project of projects) {
    const index = indexOf(archTree(project));
    for (const row of conversationsOf(project)) {
      if (!visible(row, showArchived)) continue;
      const at = nodeIn(index, row);
      if (nodeId && project.id === projectId && at !== nodeId && !index.get(at).path.includes(nodeId)) continue;
      const place = placeIn(index, row, at);
      if (q && !plain([row.title, ...place.path, scope === 'all' ? project.name : ''].join(' ')).includes(q)) continue;
      entries.push({ row, project, nodeId: at, place });
    }
  }
  const working = entries.filter((e) => e.row.status === 'busy').sort(newest);
  const waiting = entries.filter((e) => e.row.status !== 'busy' && e.row.waiting).sort(newest);
  const recent = entries.filter((e) => e.row.status !== 'busy' && !e.row.waiting).sort(newest);
  return { working, waiting, recent, total: entries.length };
}

// How many conversations each box holds, itself and below: the number on the box, which filters the list to it.
export function conversationCounts(project, tree, { showArchived = false } = {}) {
  const index = indexOf(tree);
  const counts = new Map();
  for (const row of conversationsOf(project)) {
    if (!visible(row, showArchived)) continue;
    const at = nodeIn(index, row);
    for (const id of [...index.get(at).path, at]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ---- the column ---------------------------------------------------------------------------------

const ORIGIN_ICON = { map: 'map', vscode: 'code', terminal: 'terminal', sdk: 'auto' };
const STEP_KINDS = new Set(['edit', 'read', 'run', 'search', 'web', 'agent', 'skill', 'plan', 'ask', 'think', 'tool']);
const GROUPS = ['working', 'waiting', 'recent'];

const toneOf = (row) => (row.status === 'busy' ? 'busy' : row.waiting ? 'waiting' : row.status === 'idle' ? 'idle' : 'closed');

// ctx: root (the column), h, t (translator getter), icon(name, cls), relative(iso), money(usd), phone (media query), state(),
// project(), showArchived(), current() (the conversation the chat sheet shows), nodeLabel(id), onOpen(entry), onFilter()
// (the box filter changed: the map redraws its pressed numbers), store {get, set}.
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
  let showAll = false;

  const placeWords = (e, full) => {
    const tt = ctx.t();
    if (e.place.special) return tt(`convs.place.${e.place.special}`);
    return (full ? e.place.path : e.place.path.slice(-2)).join(' › ');
  };
  const placeText = (e) => (scope === 'all' ? `${e.project.name} › ${placeWords(e)}` : placeWords(e));
  const stepText = (step) => (STEP_KINDS.has(step.kind) ? ctx.t()(`live.step.${step.kind}`, { target: step.target }) : '');

  function rowView(e) {
    const tt = ctx.t();
    const { row } = e;
    const tone = toneOf(row);
    const current = ctx.current() === row.sessionId;
    const step = row.status === 'busy' && row.lastStep ? stepText(row.lastStep) : '';
    const title = row.title || tt('chat.untitled');
    return h('li', {}, h('button', {
      type: 'button', class: `cv-row tone-${tone}${current ? ' is-current' : ''}`, 'data-session': row.sessionId, 'aria-current': current ? 'true' : null,
      title: `${title}\n${e.project.name} › ${placeWords(e, true)}`, onclick: () => ctx.onOpen(e),
    },
    h('span', { class: 'cv-dot', title: tt(`convs.dot.${tone}`) }, h('span', { class: 'visually-hidden' }, `${tt(`convs.dot.${tone}`)}: `)),
    h('span', { class: 'cv-title' }, title),
    h('span', { class: 'cv-when num' }, row.updatedAt ? ctx.relative(row.updatedAt) : ''),
    step ? h('span', { class: 'cv-step' }, step) : null,
    h('span', { class: `cv-where${e.place.special ? ` is-${e.place.special}` : ''}` }, placeText(e)),
    h('span', { class: 'cv-meta' },
      icon(ORIGIN_ICON[row.origin] ?? 'terminal', 'cv-origin'), tt(`convs.origin.${row.origin}`),
      row.costUSD != null ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), h('span', { class: 'num' }, ctx.money(row.costUSD))] : null)));
  }

  function groupView(name, entries) {
    if (!entries.length) return null;
    const tt = ctx.t();
    const shown = name === 'recent' && !showAll ? entries.slice(0, RECENT_PAGE) : entries;
    const rest = entries.length - shown.length;
    return h('section', { class: `cv-group g-${name}`, 'aria-labelledby': `cv-g-${name}` },
      h('h3', { id: `cv-g-${name}` }, h('span', { class: 'cv-group-dot', 'aria-hidden': 'true' }), tt(`convs.group.${name}`), h('span', { class: 'cv-group-n num' }, String(entries.length))),
      h('ul', { class: 'cv-rows' }, shown.map(rowView)),
      rest > 0 ? h('button', { type: 'button', class: 'btn small-btn cv-more', onclick: () => { showAll = true; render(); } }, tt('convs.more', { n: rest })) : null);
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
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset?.session : null;
    const top = list.scrollTop;
    let body = GROUPS.map((g) => groupView(g, out[g])).filter(Boolean);
    if (!body.length) {
      let empty = scope === 'all' ? tt('convs.emptyAll') : tt('convs.empty');
      if (filter) empty = tt('convs.filterEmpty', { name: ctx.nodeLabel(filter) });
      if (query.trim()) empty = tt('convs.noMatch', { q: query.trim() });
      body = [h('p', { class: 'cv-empty' }, empty)];
    }
    list.replaceChildren(...body);
    list.scrollTop = top;
    if (focused) list.querySelector(`[data-session="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
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
    showAll = false;
    if (nodeId) {
      scope = 'project';
      if (ctx.phone.matches) setDrawer(true);
      else if (collapsed) setCollapsed(false);
    }
    render();
    ctx.onFilter();
  }

  search.addEventListener('input', () => { query = search.value; showAll = false; render(); });
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
      showAll = false;
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
    projectChanged() { filter = null; showAll = false; },
  };
}
