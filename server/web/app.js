import { LANGS, pickLang, translator } from './i18n.js';
import { createBrain, neuronKind, isUnsure } from './brain.js';
import { unitTree, ownerHue, initial, filesByFolder } from './body.js';

const $ = (sel) => document.querySelector(sel);
const PLAY_MS = 9000;
const PHONE = window.matchMedia('(max-width: 719px)');
const MARK_KINDS = ['born', 'fused', 'grouped', 'fused-by-meaning'];

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: preference just isn't remembered */ } },
};

let lang = pickLang(store.get('sm.lang'), navigator.language);
let t = translator(lang);
let state = null;
let project = null;
let tree = null;
let selection = null;
let tMin = 0, tMax = 0, tNow = 0;
let playing = 0;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const icon = (name, cls) => {
  const el = svgEl('svg', { class: cls, 'aria-hidden': 'true' });
  el.append(svgEl('use', { href: `#i-${name}` }));
  return el;
};

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

const unitName = (u) => (u.id === 'unsorted' ? t('unit.unsorted') : u.name);
const statusWord = (s) => t(`status.${s}`);
const unitById = (id) => tree?.byId.get(id);
const workCellById = (id) => project.workCells.find((w) => w.id === id);
const chatById = (id) => project.chats.find((c) => c.sessionId === id);
const subtree = (u) => [u, ...tree.descendants(u.id)];

function applyStaticText() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  setPlayIcon();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function freeArea() {
  const stage = $('#stage').getBoundingClientRect();
  const summary = $('#summary').getBoundingClientRect();
  const top = summary.height ? summary.bottom - stage.top + 4 : 8;
  let width = stage.width, height = stage.height - top - (PHONE.matches ? 64 : 56);
  const panel = $('#panel');
  if (!panel.hidden) {
    const p = panel.getBoundingClientRect();
    if (PHONE.matches) height = Math.max(160, p.top - stage.top - top - 8);
    else width = Math.max(240, p.left - stage.left - 8);
  }
  // The open legend is an obstacle on wide screens: the map fits beside it, not under it.
  const legend = $('#legend');
  let left = 0;
  if (!PHONE.matches && legend.open) {
    left = legend.getBoundingClientRect().right - stage.left + 8;
    width -= left;
  }
  return { left, top, width, height };
}

const cellsInside = (u) => tree.descendants(u.id).filter((x) => x.level === 'cell').length;

function unitMeta(u, chats) {
  if (u.level === 'cell') return `${statusWord(u.status)} · ${t.count('label.chats', chats)}`;
  return `${statusWord(u.status)} · ${t.count('label.cells', cellsInside(u))}`;
}

function wcStatus(w) {
  if (w.status === 'merged') return t('wc.merged', { main: project.mainBranch });
  return w.clashWith.length ? t('wc.clashing') : t('wc.alive');
}

const brain = createBrain($('#brain'), {
  onSelect: (sel) => select(sel, { zoom: true }),
  labelFor: unitName,
  unitMeta,
  unitAria: (u) => t('unit.aria', { name: unitName(u), level: t(`level.${u.level}`), status: statusWord(u.status), chats: t.count('summary.chats', u.work.chats) }),
  budAria: (w) => t('wc.aria', { branch: w.branch, owner: w.owner.name, status: wcStatus(w) }),
  linkLabel: (a, b) => t('link.aria', { a: unitName(a), b: unitName(b) }),
  freeArea,
});

function joinDots(parts) {
  return parts.flatMap((p, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p]));
}

function renderSummary() {
  const chats = project.chats;
  const busy = chats.filter((c) => c.status === 'busy').length;
  const organs = project.units.filter((u) => u.level === 'organ').length;
  const cells = project.units.filter((u) => u.level === 'cell').length;
  const growing = project.workCells.filter((w) => w.status !== 'merged').length;
  const parts = [h('strong', {}, project.name)];
  if (organs) parts.push(h('span', {}, t.count('summary.organs', organs)));
  parts.push(h('span', {}, t.count('summary.cells', cells)));
  if (growing) parts.push(h('span', {}, t.count('summary.branches', growing)));
  parts.push(h('span', {}, t.count('summary.chats', chats.length)));
  if (busy) parts.push(h('span', { class: 'tone-active' }, t('summary.working', { n: busy })));
  parts.push(h('span', { class: 'num' }, t('summary.cost', { v: money(project.cost.d30) })));
  $('#summary').replaceChildren(...joinDots(parts));
}

function waitingEntries() {
  const out = [];
  for (const p of state.projects) {
    for (const d of p.decisions || []) out.push({ project: p, decision: d, rank: 1, ts: state.generatedAt });
    for (const c of p.chats) {
      if (c.waiting.strong || c.waiting.weak || c.waiting.items.length) {
        out.push({ project: p, chat: c, rank: c.waiting.strong ? 0 : c.waiting.items.length ? 1 : 3, ts: c.updatedAt });
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank || b.ts.localeCompare(a.ts));
}

function goTo(p, sel) {
  closeWaiting();
  if (p !== project) setProject(p.id);
  if (sel) select(sel, { zoom: true });
}

function renderWaiting() {
  $('#waitingLabel').textContent = t('waiting.button', { n: state.waitingCount });
  $('#waitingBtn').classList.toggle('is-zero', state.waitingCount === 0);
  const entries = waitingEntries();
  const listEl = $('#waitingItems');
  if (!entries.length) {
    listEl.replaceChildren(h('li', { class: 'empty' }, t('waiting.none')));
    return;
  }
  const where = (p, unitId) => {
    const unit = unitId && p.units.find((u) => u.id === unitId);
    return [state.projects.length > 1 ? p.name : null, unit ? (unit.id === 'unsorted' ? t('unit.unsorted') : unit.name) : null].filter(Boolean).join(' · ');
  };
  listEl.replaceChildren(...entries.map(({ project: p, chat, decision }) => {
    if (decision) {
      const clashing = decision.kind === 'clash' ? p.workCells.find((w) => w.clashWith.length && w.status !== 'merged') : null;
      return h('li', {}, h('button', {
        type: 'button', class: `waiting-item${decision.kind === 'clash' ? ' clash' : ''}`,
        onclick: () => goTo(p, clashing ? { type: 'workcell', id: clashing.id } : decision.sessionId ? { type: 'chat', id: decision.sessionId } : null),
      },
      h('span', { class: 'wi-reason' }, t(`waiting.${decision.kind}`)),
      h('span', { class: 'wi-title' }, decision.text),
      h('span', { class: 'wi-where' }, where(p, clashing?.unitId))));
    }
    const reason = chat.waiting.strong ? t('waiting.question') : chat.waiting.items.length ? t('waiting.item') : t('waiting.ends');
    return h('li', {}, h('button', {
      type: 'button', class: `waiting-item${chat.waiting.strong ? ' strong' : ''}`,
      onclick: () => goTo(p, { type: 'chat', id: chat.sessionId }),
    },
    h('span', { class: 'wi-reason' }, reason),
    h('span', { class: 'wi-title' }, chat.title),
    h('span', { class: 'wi-where' }, where(p, chat.unitId)),
    h('span', { class: 'wi-detail' }, chat.waiting.items[0] || tail(chat.lastAssistantText, 140))));
  }));
}

function openWaiting() {
  closePanel(false);
  $('#waitingList').hidden = false;
  $('#waitingBtn').setAttribute('aria-expanded', 'true');
  $('#waitingList').querySelector('button')?.focus();
}
function closeWaiting() {
  $('#waitingList').hidden = true;
  $('#waitingBtn').setAttribute('aria-expanded', 'false');
}

function pill(status, text) {
  return h('span', { class: `pill tone-${status}` }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), text);
}

function section(title, ...content) {
  const body = content.flat().filter(Boolean);
  if (!body.length) return null;
  return h('section', { class: 'block' }, h('h3', {}, title), ...body);
}

const list = (items) => (items && items.length ? h('ul', { class: 'plain' }, items.map((i) => h('li', {}, i))) : null);

function inertActions(labels) {
  return h('div', { class: 'actions' }, labels.map((label, i) => h('button', {
    type: 'button', class: i === 0 ? 'btn primary' : 'btn', 'aria-disabled': 'true',
    onclick: () => toast(t('action.soon')),
  }, label)));
}

function chatTone(chat) {
  const k = neuronKind(chat);
  if (k === 'waiting' || chat.waiting.weak) return 'waiting';
  return k === 'busy' ? 'active' : 'idle';
}

function ownerChip(person) {
  return h('span', { class: 'owner', style: `--owner-h:${ownerHue(person.email)}` },
    h('span', { class: 'owner-dot', 'aria-hidden': 'true' }, initial(person.name)), person.name);
}

const linkTo = (label, sel, cls = 'meta-link') => h('button', { type: 'button', class: cls, onclick: () => select(sel, { zoom: true }) }, label);
const unitLink = (u) => linkTo(unitName(u), { type: 'unit', id: u.id });
const branchLink = (w) => linkTo(w.branch, { type: 'workcell', id: w.id }, 'meta-link branch-name');

const isWork = (item) => item.kind === 'commit' || item.kind === 'merge';

function activityTitle(item) {
  if (item.kind === 'push') return t('activity.pushed', { branch: item.branch });
  if (item.kind === 'tag') return t('activity.tagged', { tag: item.subject });
  if (item.kind === 'born') return t('activity.born', { branch: item.subject || item.branch });
  if (item.kind === 'fused') return t('activity.fused', { branch: item.subject, main: project.mainBranch });
  return item.subject;
}

const ACT_ICON = { commit: 'commit', merge: 'merge', push: 'push', tag: 'tag', born: 'born', fused: 'merge', 'fused-by-meaning': 'fuse', grouped: 'group', renamed: 'rename' };

function activityRow(item, { showChat }) {
  const chat = showChat && item.sessionId && item.kind !== 'fused-by-meaning' && chatById(item.sessionId);
  const who = [t('activity.by', { name: item.author.name }), item.coAuthor ? t('activity.with', { name: item.coAuthor }) : null].filter(Boolean).join(' · ');
  return h('li', { class: `act act-${item.kind}` },
    icon(ACT_ICON[item.kind] || 'commit', 'act-icon'),
    h('div', { class: 'act-body' },
      h('span', { class: 'act-title' }, item.hash && isWork(item) ? h('code', { class: 'act-hash' }, item.hash.slice(0, 7)) : null, activityTitle(item)),
      h('span', { class: 'act-meta' }, who,
        chat ? [' · ', `${t('activity.in')} `, linkTo(chat.title, { type: 'chat', id: chat.sessionId })] : null,
        ' · ', h('span', { class: 'num' }, relative(item.ts)))));
}

function activityList(items, opts) {
  return items.length ? h('ul', { class: 'activity' }, items.map((i) => activityRow(i, opts))) : null;
}

const newestFirst = (a, b) => b.ts.localeCompare(a.ts);

function panelHead(title, ...meta) {
  $('#panelHead').replaceChildren(h('h2', { id: 'panelTitle' }, title), h('p', { class: 'meta' }, ...meta.flat().filter(Boolean)));
}

function recentRows(recent) {
  const rows = recent.map((r) => h('li', {},
    h('button', { type: 'button', class: 'link-row', onclick: () => chatById(r.sessionId) && select({ type: 'chat', id: r.sessionId }, { zoom: true }) },
      h('span', { class: 'lr-title' }, r.title),
      h('span', { class: 'lr-date num' }, shortDate(Date.parse(r.date))),
      h('span', { class: 'lr-line' }, r.line))));
  return rows.length ? h('ul', { class: 'plain rows' }, rows) : null;
}

function renderUnitPanel(u) {
  const ids = new Set(subtree(u).map((x) => x.id));
  const parent = tree.parent(u.id);
  panelHead([unitName(u), u.pinned ? h('span', { class: 'pinned', title: t('unit.pinned') }, icon('pin', 'pin-icon'), h('span', { class: 'visually-hidden' }, t('unit.pinned'))) : null],
    h('span', { class: `level-badge level-${u.level}` }, t(`level.${u.level}`)),
    pill(u.status, statusWord(u.status)),
    h('span', {}, t.count('summary.chats', u.work.chats)),
    parent ? h('span', {}, `${t('unit.in')} `, unitLink(parent)) : null);
  const kids = tree.children(u.id);
  const branches = project.workCells.filter((w) => ids.has(w.unitId))
    .sort((a, b) => (a.status === 'merged') - (b.status === 'merged') || b.bornAt.localeCompare(a.bornAt));
  $('#panelBody').replaceChildren(...[
    h('div', { class: 'purpose' },
      u.purpose ? h('p', { class: 'lead' }, u.purpose) : null,
      h('p', { class: 'origin' }, icon(u.origin === 'ai' ? 'spark' : u.origin === 'user' ? 'rename' : 'seed', 'origin-icon'), t(`origin.${u.origin}`)),
      u.tags.length ? h('ul', { class: 'tags', 'aria-label': t('unit.tags') }, u.tags.map((tag) => h('li', {}, tag))) : null),
    section(t('unit.state'), u.nucleus.state ? h('p', {}, u.nucleus.state) : h('p', { class: 'muted' }, t('unit.empty'))),
    section(t('unit.decided'), list(u.nucleus.decided)),
    section(t('unit.todo'), list(u.nucleus.todo)),
    section(t('unit.inside'), kids.length ? h('ul', { class: 'plain rows' }, kids.map((k) => h('li', {},
      h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'unit', id: k.id }, { zoom: true }) },
        h('span', { class: 'lr-title' }, h('span', { class: `level-dot status-${k.status}`, 'aria-hidden': 'true' }), unitName(k)),
        h('span', { class: 'lr-date' }, k.level === 'cell' ? t.count('label.chats', k.work.chats) : t(`level.${k.level}`)),
        h('span', { class: 'lr-line' }, k.purpose))))) : null),
    section(t('unit.branches'), branches.length ? h('ul', { class: 'plain rows' }, branches.map((w) => h('li', {},
      h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'workcell', id: w.id }, { zoom: true }) },
        h('span', { class: 'lr-title branch-name' }, w.branch),
        h('span', { class: 'lr-date' }, ownerChip(w.owner)),
        h('span', { class: `lr-line${w.clashWith.length ? ' tone-clash' : ''}` }, wcStatus(w)))))) : null),
    section(t('activity.title'), activityList(project.activity.filter((a) => a.unitIds.some((id) => ids.has(id))).sort(newestFirst).slice(0, 10), { showChat: true })),
    section(t('unit.recent'), recentRows(u.nucleus.recent)),
    inertActions([t('action.continue'), u.pinned ? t('action.unpin') : t('action.pin'), t('action.rename')]),
  ].filter(Boolean));
}

function clashLines(w) {
  return w.clashWith.map(workCellById).filter(Boolean).map((o) => {
    const shared = w.files.map((f) => f.path).filter((p) => o.files.some((f) => f.path === p));
    return h('p', {}, t('wc.clashText', { a: w.owner.name, b: o.owner.name, files: shared.join(', ') }), ' ', branchLink(o));
  });
}

function renderWorkCellPanel(w) {
  const home = unitById(w.unitId);
  panelHead(h('span', { class: 'branch-name' }, w.branch),
    ownerChip(w.owner),
    pill(w.status === 'merged' ? 'idle' : w.clashWith.length ? 'clash' : 'active', wcStatus(w)),
    home ? h('span', {}, `${t('wc.home')} `, unitLink(home)) : null);
  const chats = w.chatIds.map(chatById).filter(Boolean);
  const facts = [
    [t('wc.ahead', { main: project.mainBranch }), h('span', { class: 'num' }, t.count('wc.commitsCount', w.ahead))],
    [t('chat.cost'), h('span', { class: 'num' }, w.estimateUSD ? t('wc.estimate', { cost: money(w.costUSD), estimate: money(w.estimateUSD) }) : money(w.costUSD))],
    w.lastCommit ? [t('wc.lastCommit'), [h('code', { class: 'act-hash' }, w.lastCommit.hash.slice(0, 7)), w.lastCommit.subject]] : null,
    [t('wc.born'), shortDate(Date.parse(w.bornAt))],
    w.mergedAt ? [t('wc.fusedAt'), shortDate(Date.parse(w.mergedAt))] : null,
    w.path ? [t('wc.path'), h('code', { class: 'path' }, w.path)] : null,
    w.touches.length ? [t('wc.touches'), joinDots(w.touches.map(unitById).filter(Boolean).map(unitLink))] : null,
  ].filter(Boolean);
  $('#panelBody').replaceChildren(...[
    w.clashWith.length ? h('div', { class: 'callout clash' }, h('h3', {}, t('wc.clash')), clashLines(w)) : null,
    w.remote ? h('p', { class: 'note' }, t('wc.remote'), project.fetchedAt ? ` ${t('wc.fetched', { time: clock(project.fetchedAt) })}` : '') : null,
    section(t('wc.doing'), w.nucleus.doing ? h('p', { class: 'lead' }, w.nucleus.doing) : null),
    w.openspec ? section(t('wc.plan'),
      h('div', { class: 'progress', role: 'img', 'aria-label': t('chat.openspec', w.openspec) },
        h('span', { style: `width:${Math.round((w.openspec.done / Math.max(1, w.openspec.total)) * 100)}%` })),
      h('p', { class: 'muted small' }, `${w.openspec.change} · ${t('chat.openspec', w.openspec)}`)) : null,
    section(t('wc.todo'), list(w.nucleus.todo)),
    section(t('wc.files'), h('div', { class: 'organelle-list' }, filesByFolder(w.files).map((g) => h('div', { class: 'folder' },
      h('span', { class: 'folder-name' }, g.folder || t('wc.root')),
      h('ul', {}, g.files.map((f) => h('li', { class: `file st-${f.status}` },
        h('span', { class: 'file-status', 'aria-hidden': 'true' }, f.status),
        h('span', { class: 'visually-hidden' }, `${t(`wc.status.${f.status}`)}: `), f.name))))))),
    section(t('wc.chats'), chats.length ? h('ul', { class: 'plain rows' }, chats.map((c) => h('li', {},
      h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'chat', id: c.sessionId }, { zoom: true }) },
        h('span', { class: 'lr-title' }, c.title), h('span', { class: 'lr-date num' }, shortDate(Date.parse(c.startedAt))))))) : h('p', { class: 'muted' }, t('wc.noChats'))),
    section(t('activity.title'), activityList(project.activity.filter((a) => a.workCellId === w.id).sort(newestFirst).slice(0, 10), { showChat: true })),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  ].filter(Boolean));
}

function renderLinkPanel(link) {
  const a = unitById(link.a), b = unitById(link.b);
  panelHead(`${unitName(a)} ↔ ${unitName(b)}`,
    h('span', {}, t.count('link.reasons', link.reasons.length)),
    h('span', {}, t('link.since', { date: shortDate(Date.parse(link.since)) })),
    unitLink(a), unitLink(b));
  const reasons = link.reasons.map((r) => {
    const chat = r.sessionId && chatById(r.sessionId);
    const parts = [
      h('span', { class: `lr-kind${r.kind === 'meaning' ? ' by-meaning' : ''}` }, t(`link.kind.${r.kind}`)),
      h('span', { class: 'lr-line' }, r.text),
      chat ? h('span', { class: 'lr-open' }, t('link.open', { title: chat.title })) : null,
    ];
    return h('li', {}, chat
      ? h('button', { type: 'button', class: 'link-row reason', onclick: () => select({ type: 'chat', id: chat.sessionId }, { zoom: true }) }, parts)
      : h('div', { class: 'link-row reason static' }, parts));
  });
  $('#panelBody').replaceChildren(section(t('link.why'), h('ul', { class: 'plain rows' }, reasons)));
}

function renderChatPanel(chat) {
  const unit = unitById(chat.unitId);
  const wc = chat.workCellId && workCellById(chat.workCellId);
  const parent = chat.parentId && chatById(chat.parentId);
  const card = chat.card || {};
  panelHead(chat.title, pill(chatTone(chat), t(`chat.${chat.status}`)), unit ? unitLink(unit) : null);

  let waitingBlock = null;
  if (chat.waiting.strong || chat.waiting.items.length || chat.waiting.weak) {
    waitingBlock = h('div', { class: 'callout' },
      h('h3', {}, t('chat.waitingFor')),
      chat.waiting.strong ? h('p', {}, t('chat.question')) : null,
      !chat.waiting.strong && chat.waiting.weak ? h('p', {}, t('chat.endsWithQuestion')) : null,
      list(chat.waiting.items));
  }

  const facts = [
    [t('chat.cost'), h('span', { class: 'num' }, money(chat.costUSD))],
    [t('chat.branch'), wc ? branchLink(wc) : h('span', { class: 'branch-name' }, project.mainBranch)],
    [t('chat.started'), shortDate(Date.parse(chat.startedAt))],
    [t('chat.updated'), relative(chat.updatedAt)],
    ...chat.workflows.map((w) => [t('chat.workflow'), `${w.name} · ${t('chat.workflowSteps', { done: w.done, started: w.started, label: w.lastLabel })}`]),
    parent ? [t('chat.from'), linkTo(parent.title, { type: 'chat', id: parent.sessionId })] : null,
  ].filter(Boolean);

  const actions = [t('action.continue'), t('action.open')];
  if (chat.live) actions.push(t('action.stop'));
  actions.push(t('action.archive'));

  $('#panelBody').replaceChildren(...[
    waitingBlock,
    isUnsure(chat) ? h('p', { class: 'note' }, chat.unitSource === 'none' ? t('chat.unsortedHint') : t('chat.guess')) : null,
    section(t('chat.doing'), card.doing ? h('p', { class: 'lead' }, card.doing) : null),
    section(t('chat.todo'), list(card.todo)),
    section(t('chat.lastPrompt'), chat.lastPrompt ? h('p', { class: 'quote' }, chat.lastPrompt) : null),
    section(t('chat.lastReply'), chat.lastAssistantText ? h('p', {}, chat.lastAssistantText) : null),
    section(t('chat.commits'), activityList(project.activity.filter((a) => isWork(a) && a.sessionId === chat.sessionId).sort(newestFirst), { showChat: false })),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    inertActions(actions),
  ].filter(Boolean));
}

let returnFocus = null;
function openPanel() {
  const panel = $('#panel');
  if (panel.hidden) returnFocus = document.activeElement;
  panel.hidden = false;
  panel.querySelector('.panel-body').scrollTop = 0;
}
function closePanel(restore = true) {
  if ($('#panel').hidden) return;
  $('#panel').hidden = true;
  selection = null;
  brain.select(null);
  if (restore && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

function showAt(iso) {
  if (Date.parse(iso) > tNow) setTime(tMax, { instant: true });
}

function select(sel, { zoom = false } = {}) {
  if (!sel) {
    closePanel();
    return;
  }
  closeWaiting();
  selection = sel;
  if (sel.type === 'unit') {
    const u = unitById(sel.id);
    if (!u) return;
    showAt(u.bornAt);
    renderUnitPanel(u);
  } else if (sel.type === 'workcell') {
    const w = workCellById(sel.id);
    if (!w) return;
    // A fused branch only exists in the past: travel to its last hour alive.
    if (w.mergedAt && tNow >= Date.parse(w.mergedAt)) setTime(Date.parse(w.mergedAt) - 3600e3, { instant: true });
    else showAt(w.bornAt);
    renderWorkCellPanel(w);
  } else if (sel.type === 'link') {
    const link = project.unitLinks.find((l) => `${l.a}|${l.b}` === sel.id);
    if (!link) return;
    showAt(link.since);
    renderLinkPanel(link);
  } else {
    const chat = chatById(sel.id);
    if (!chat) return;
    showAt(chat.startedAt);
    renderChatPanel(chat);
  }
  openPanel();
  brain.select(sel);
  const focus = { unit: brain.focusUnit, workcell: brain.focusWorkCell, link: brain.focusLink, chat: brain.focusChat }[sel.type];
  if (zoom) requestAnimationFrame(() => focus(sel.id));
}

// Cumulative count of conversations: the project visibly gaining body over time.
function renderGrowth() {
  const starts = project.chats.map((c) => Date.parse(c.startedAt)).sort((a, b) => a - b);
  const span = Math.max(1, tMax - tMin);
  const total = Math.max(1, starts.length);
  const x = (ms) => (((ms - tMin) / span) * 1000).toFixed(1);
  const y = (n) => (100 - (n / total) * 92).toFixed(1);
  let line = 'M0,100';
  starts.forEach((ms, i) => { line += `H${x(ms)}V${y(i + 1)}`; });
  line += 'H1000';
  const area = `${line}V100Z`;
  $('#growth').setAttribute('viewBox', '0 0 1000 100');
  $('#growth').replaceChildren(
    svgEl('clipPath', { id: 'growth-past' }),
    svgEl('path', { d: area, class: 'body-future' }),
    svgEl('path', { d: area, class: 'body-past', 'clip-path': 'url(#growth-past)' }),
    svgEl('path', { d: line, class: 'body-edge', 'clip-path': 'url(#growth-past)' }),
  );
  $('#growth-past').append(svgEl('rect', { x: 0, y: 0, width: 1000, height: 100 }));

  // Births, fusions and groupings as marks on the track: where the body divided or came together.
  $('#marks').replaceChildren(...project.activity.filter((a) => MARK_KINDS.includes(a.kind)).map((a) => {
    const wc = a.workCellId && workCellById(a.workCellId);
    const pos = ((Date.parse(a.ts) - tMin) / span) * 100;
    return h('span', {
      class: `mark-event mk-${a.kind}`, 'data-pos': pos.toFixed(2), title: `${shortDate(Date.parse(a.ts))} · ${activityTitle(a)}`,
      style: `left:${pos.toFixed(2)}%${wc ? `;--owner-h:${ownerHue(wc.owner.email)}` : ''}`,
    });
  }));
}

function setTime(time, { instant = false } = {}) {
  tNow = Math.min(tMax, Math.max(tMin, time));
  const pos = tMax > tMin ? Math.round(((tNow - tMin) / (tMax - tMin)) * 1000) : 1000;
  $('#time').value = String(pos);
  $('#time').style.setProperty('--pos', `${pos / 10}%`);
  const atEnd = tNow >= tMax;
  $('#timeLabel').textContent = atEnd ? t('timeline.now') : shortDate(tNow);
  $('#time').setAttribute('aria-valuetext', atEnd ? t('timeline.now') : shortDate(tNow));
  $('#growth-past rect')?.setAttribute('width', String(pos));
  for (const m of document.querySelectorAll('.mark-event')) m.classList.toggle('is-past', Number(m.dataset.pos) <= pos / 10);
  brain.setTime(tNow, { instant });
}

function setPlayIcon() {
  const btn = $('#play');
  btn.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  btn.setAttribute('aria-label', playing ? t('timeline.pause') : t('timeline.play'));
  btn.setAttribute('title', playing ? t('timeline.pause') : t('timeline.play'));
}

function stopPlay() {
  cancelAnimationFrame(playing);
  playing = 0;
  setPlayIcon();
}

function togglePlay() {
  if (playing) return stopPlay();
  closePanel(false);
  const from = tNow >= tMax ? tMin : tNow;
  const start = performance.now() - ((from - tMin) / Math.max(1, tMax - tMin)) * PLAY_MS;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / PLAY_MS);
    setTime(tMin + p * (tMax - tMin));
    if (p < 1) playing = requestAnimationFrame(tick);
    else stopPlay();
  };
  playing = requestAnimationFrame(tick);
  setPlayIcon();
}

function setProject(id) {
  project = state.projects.find((p) => p.id === id) || state.projects[0];
  tree = unitTree(project.units);
  store.set('sm.project', project.id);
  $('#project').value = project.id;
  stopPlay();
  closePanel(false);
  tMax = Date.parse(state.generatedAt);
  const starts = project.chats.map((c) => Date.parse(c.startedAt));
  tMin = starts.length ? Math.min(...starts) - 864e5 / 2 : tMax - 864e5;
  renderSummary();
  const empty = project.chats.length === 0;
  $('#notice').textContent = empty ? t('state.emptyProject') : '';
  $('#notice').hidden = !empty;
  brain.setProject(project);
  renderGrowth();
  setTime(tMax, { instant: true });
  brain.fit(false);
}

function renderProjects() {
  $('#project').replaceChildren(...state.projects.map((p) => h('option', { value: p.id }, p.name)));
}

function renderAll() {
  applyStaticText();
  if (!state) return;
  renderProjects();
  renderWaiting();
  const sel = selection;
  setProject(project?.id || store.get('sm.project'));
  if (sel) select(sel);
}

function wire() {
  $('#project').addEventListener('change', (e) => setProject(e.target.value));
  for (const b of document.querySelectorAll('.lang button')) {
    b.addEventListener('click', () => {
      if (!LANGS[b.dataset.lang] || b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      t = translator(lang);
      store.set('sm.lang', lang);
      renderAll();
    });
  }
  for (const tab of document.querySelectorAll('[data-soon]')) tab.addEventListener('click', () => toast(t('tab.soon')));
  $('#waitingBtn').addEventListener('click', () => ($('#waitingList').hidden ? openWaiting() : closeWaiting()));
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => (b.dataset.close === 'panel' ? closePanel() : closeWaiting()));
  }
  $('#fit').addEventListener('click', () => brain.fit(true));
  $('#play').addEventListener('click', togglePlay);
  $('#time').addEventListener('input', (e) => {
    stopPlay();
    setTime(tMin + (Number(e.target.value) / 1000) * (tMax - tMin));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#waitingList').hidden) closeWaiting();
    else closePanel();
  });
  let resizeTimer = 0;
  let stageSize = '';
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rect = $('#stage').getBoundingClientRect();
      const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (!project || size === stageSize) return;
      stageSize = size;
      const sel = selection;
      brain.setProject(project);
      brain.setTime(tNow, { instant: true });
      brain.fit(false);
      if (sel) brain.select(sel);
    }, 150);
  });
  const legend = $('#legend');
  legend.open = !PHONE.matches && store.get('sm.legend') !== 'closed';
  // Only a person opening or closing it re-fits the map; setting it on load must not undo a deep link's zoom.
  legend.querySelector('summary').addEventListener('click', () => {
    legend.addEventListener('toggle', () => {
      store.set('sm.legend', legend.open ? 'open' : 'closed');
      if (project && !PHONE.matches) brain.fit(true);
    }, { once: true });
  });
}

// Deep link used for screenshots and sharing a view: ?project=<id>&at=<ISO date>&select=unit:<id> (or workcell:, chat:, link:).
function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('project')) setProject(params.get('project'));
  const at = Date.parse(params.get('at') || '');
  if (!Number.isNaN(at)) setTime(at, { instant: true });
  const pick = params.get('select') || '';
  const cut = pick.indexOf(':');
  if (cut > 0) select({ type: pick.slice(0, cut), id: pick.slice(cut + 1) }, { zoom: true });
}

async function main() {
  applyStaticText();
  wire();
  const notice = $('#notice');
  notice.textContent = t('state.loading');
  notice.hidden = false;
  try {
    const res = await fetch('/api/state', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state = await res.json();
  } catch {
    notice.textContent = t('state.error');
    notice.classList.add('is-error');
    return;
  }
  notice.hidden = true;
  renderAll();
  applyDeepLink();
}

main();
