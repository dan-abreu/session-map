import { LANGS, pickLang, translator } from './i18n.js';
import { createBrain, neuronKind, isUnsure } from './brain.js';
import { unitTree, ownerHue, initial } from './body.js';
import { createDiscover } from './discover.js';
import { api } from './api.js';
import { createChat } from './chat.js';
import { createTabs } from './tabs.js';
import { createFiles } from './files.js';
import { structureKey, lifeEventsSince, nameAt, visibleProject, chatButtons, bootstrapOf, unitMoves, waitingEntries, safeTunnel } from './views.js';

const $ = (sel) => document.querySelector(sel);
const PLAY_MS = 9000;
const POLL_MS = 5000;
const PHONE = window.matchMedia('(max-width: 719px)');
const MARK_KINDS = ['born', 'fused', 'grouped', 'fused-by-meaning', 'renamed'];
const AI_KINDS = new Set(['grouped', 'fused-by-meaning', 'renamed']);
const VIEWS = ['brain', 'map', 'board', 'history', 'costs', 'discover'];

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: preference just isn't remembered */ } },
};

let lang = pickLang(store.get('sm.lang'), navigator.language);
let t = translator(lang);
let state = null;
let project = null; // the project as the server sent it
let shown = null; // the same, minus archived chats unless asked: what the brain draws
let tree = null;
let selection = null;
let view = 'brain';
let tMin = 0, tMax = 0, tNow = 0;
let playing = 0;
let showArchived = store.get('sm.archived') === '1';
// While the person types in a panel form, polling must not redraw it under their fingers.
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

function errorText(code) {
  const key = `err.${code}`;
  return key in LANGS.en ? t(key) : t('err.generic');
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
  discover?.relabel();
  chat?.relabel();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// A real <dialog> for the two irreversible actions (Stop a conversation, Delete from history).
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

function freeArea() {
  const stage = $('#stage').getBoundingClientRect();
  const summary = $('#summary').getBoundingClientRect();
  const top = summary.height ? summary.bottom - stage.top + 4 : 8;
  let width = stage.width, height = stage.height - top - (PHONE.matches ? 64 : 56);
  for (const sheet of [$('#panel'), $('#chat')]) {
    if (sheet.hidden) continue;
    const p = sheet.getBoundingClientRect();
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

async function moveChat(sessionId, unitId) {
  const res = await api.override(project.id, sessionId, unitId);
  if (!res.ok) return toast(errorText(res.error));
  toast(t('chat.moved', { name: unitName(unitById(unitId)) }));
  poll();
}

async function editUnits(op, okText) {
  const res = await api.editUnits(project.id, op);
  if (!res.ok) {
    toast(errorText(res.error));
    return false;
  }
  if (okText) toast(okText);
  await poll();
  return true;
}

const brain = createBrain($('#brain'), {
  onSelect: (sel) => select(sel, { zoom: true }),
  labelFor: unitName,
  labelAt: (u, time) => (u.id === 'unsorted' ? t('unit.unsorted') : nameAt(u, project.activity, time)),
  unitMeta,
  unitAria: (u) => t('unit.aria', { name: unitName(u), level: t(`level.${u.level}`), status: statusWord(u.status), chats: t.count('summary.chats', u.work.chats) }),
  budAria: (w) => t('wc.aria', { branch: w.branch, owner: w.owner.name, status: wcStatus(w) }),
  linkLabel: (a, b) => t('link.aria', { a: unitName(a), b: unitName(b) }),
  freeArea,
  onMoveChat: (sessionId, unitId) => moveChat(sessionId, unitId),
  onMoveUnit: (id, parentId) => editUnits({ op: 'move', id, parentId },
    parentId ? t('unit.movedInto', { name: unitName(unitById(id)), into: unitName(unitById(parentId)) }) : t('unit.movedTop', { name: unitName(unitById(id)) })),
});

function joinDots(parts) {
  return parts.flatMap((p, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p]));
}

function renderSummary() {
  const chats = shown.chats;
  const busy = chats.filter((c) => c.status === 'busy').length;
  const organs = project.units.filter((u) => u.level === 'organ').length;
  const cells = project.units.filter((u) => u.level === 'cell').length;
  const growing = project.workCells.filter((w) => w.status !== 'merged').length;
  const parts = [h('button', { type: 'button', class: 'summary-project', title: t('project.open'), onclick: () => select({ type: 'project', id: project.id }) }, project.name)];
  if (organs) parts.push(h('span', {}, t.count('summary.organs', organs)));
  parts.push(h('span', {}, t.count('summary.cells', cells)));
  if (growing) parts.push(h('span', {}, t.count('summary.branches', growing)));
  parts.push(h('span', {}, t.count('summary.chats', chats.length)));
  if (busy) parts.push(h('span', { class: 'tone-active' }, t('summary.working', { n: busy })));
  parts.push(h('span', { class: 'num' }, t('summary.cost', { v: money(project.cost.d30) })));
  const boot = bootstrapOf(project);
  if (boot) {
    parts.push(h('span', { class: 'organizing', role: 'status' },
      icon('spark', 'organizing-icon'), t('ai.organizing', { done: boot.done, total: boot.total })));
  }
  $('#summary').replaceChildren(...joinDots(parts));
}

function goTo(projectId, sel) {
  closeWaiting();
  if (view !== 'brain') showView('brain');
  if (projectId !== project.id) setProject(projectId);
  if (sel) requestAnimationFrame(() => select(sel, { zoom: true }));
}

function renderWaiting() {
  $('#waitingLabel').textContent = t('waiting.button', { n: state.waitingCount });
  $('#waitingBtn').classList.toggle('is-zero', state.waitingCount === 0);
  const entries = waitingEntries(state);
  const listEl = $('#waitingItems');
  if (!entries.length) {
    listEl.replaceChildren(h('li', { class: 'empty' }, t('waiting.none')));
    return;
  }
  const where = (p, unitId) => {
    const unit = unitId && p.units.find((u) => u.id === unitId);
    return [state.projects.length > 1 ? p.name : null, unit ? (unit.id === 'unsorted' ? t('unit.unsorted') : unit.name) : null].filter(Boolean).join(' · ');
  };
  listEl.replaceChildren(...entries.map(({ project: p, chat: c, decision }) => {
    if (decision) {
      const clashing = decision.kind === 'clash' ? p.workCells.find((w) => w.clashWith.length && w.status !== 'merged') : null;
      return h('li', {}, h('button', {
        type: 'button', class: `waiting-item${decision.kind === 'clash' ? ' clash' : ''}`,
        onclick: () => goTo(p.id, clashing ? { type: 'workcell', id: clashing.id } : decision.sessionId ? { type: 'chat', id: decision.sessionId } : null),
      },
      h('span', { class: 'wi-reason' }, t(`waiting.${decision.kind}`)),
      h('span', { class: 'wi-title' }, decision.text),
      h('span', { class: 'wi-where' }, where(p, clashing?.unitId))));
    }
    const reason = c.waiting.strong ? t('waiting.question') : c.waiting.items.length ? t('waiting.item') : t('waiting.ends');
    return h('li', {}, h('button', {
      type: 'button', class: `waiting-item${c.waiting.strong ? ' strong' : ''}`,
      onclick: () => goTo(p.id, { type: 'chat', id: c.sessionId }),
    },
    h('span', { class: 'wi-reason' }, reason),
    h('span', { class: 'wi-title' }, c.title),
    h('span', { class: 'wi-where' }, where(p, c.unitId)),
    h('span', { class: 'wi-detail' }, c.waiting.items[0] || tail(c.lastAssistantText, 140))));
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

const button = (label, onclick, { primary = false, disabled = false, title = null, cls = '' } = {}) => h('button', {
  type: 'button', class: `btn${primary ? ' primary' : ''}${cls ? ` ${cls}` : ''}`, disabled, title, onclick,
}, label);

function chatTone(c) {
  const k = neuronKind(c);
  if (k === 'waiting' || c.waiting.weak) return 'waiting';
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
  if (item.kind === 'fused') return t('activity.fused', { branch: item.subject || item.branch, main: project.mainBranch });
  if (AI_KINDS.has(item.kind) && !item.subject) return t(`activity.${item.kind}`);
  return item.subject;
}

const ACT_ICON = { commit: 'commit', merge: 'merge', push: 'push', tag: 'tag', born: 'born', fused: 'merge', 'fused-by-meaning': 'fuse', grouped: 'group', renamed: 'rename' };

function activityRow(item, { showChat }) {
  const c = showChat && item.sessionId && item.kind !== 'fused-by-meaning' && chatById(item.sessionId);
  const who = [t('activity.by', { name: item.author.name }), item.coAuthor ? t('activity.with', { name: item.coAuthor }) : null].filter(Boolean).join(' · ');
  return h('li', { class: `act act-${item.kind}${AI_KINDS.has(item.kind) ? ' act-ai' : ''}` },
    icon(ACT_ICON[item.kind] || 'commit', 'act-icon'),
    h('div', { class: 'act-body' },
      h('span', { class: 'act-title' }, item.hash && isWork(item) ? h('code', { class: 'act-hash' }, item.hash.slice(0, 7)) : null, activityTitle(item)),
      h('span', { class: 'act-meta' }, who,
        c ? [' · ', `${t('activity.in')} `, linkTo(c.title, { type: 'chat', id: c.sessionId })] : null,
        ' · ', h('span', { class: 'num' }, relative(item.ts)))));
}

function activityList(items, opts) {
  return items.length ? h('ul', { class: 'activity' }, items.map((i) => activityRow(i, opts))) : null;
}

const newestFirst = (a, b) => b.ts.localeCompare(a.ts);

function panelHead(title, ...meta) {
  $('#panelHead').replaceChildren(h('h2', { id: 'panelTitle', tabindex: '-1' }, title), h('p', { class: 'meta' }, ...meta.flat().filter(Boolean)));
}

function recentRows(recent) {
  const rows = recent.map((r) => h('li', {},
    h('button', { type: 'button', class: 'link-row', onclick: () => chatById(r.sessionId) && select({ type: 'chat', id: r.sessionId }, { zoom: true }) },
      h('span', { class: 'lr-title' }, r.title),
      h('span', { class: 'lr-date num' }, shortDate(Date.parse(r.date))),
      h('span', { class: 'lr-line' }, r.line))));
  return rows.length ? h('ul', { class: 'plain rows' }, rows) : null;
}

// An inline form inside the panel; while it is open, polling leaves the panel alone.
function inlineForm({ fields, submitLabel, onSubmit, onCancel }) {
  editing = true;
  const form = h('form', { class: 'inline-form' }, fields,
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'btn primary' }, submitLabel),
      button(t('confirm.cancel'), () => { editing = false; onCancel(); })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const ok = await onSubmit(new FormData(form));
    submit.disabled = false;
    if (ok !== false) { editing = false; rerender(); }
  });
  requestAnimationFrame(() => form.querySelector('input, textarea, select')?.focus());
  return form;
}

const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
const lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);

function startChat(title, subtitle, intro, start) {
  closePanel(false);
  chat.open({ projectId: project.id, title, subtitle, intro, start });
  brain.fit(true);
}

function unitTools(u, slot) {
  const pinBtn = button(u.pinned ? t('action.unpin') : t('action.pin'),
    () => editUnits({ op: 'pin', id: u.id, pinned: !u.pinned }, u.pinned ? t('unit.unpinnedToast') : t('unit.pinnedToast')),
    { title: t('unit.pinHint') });
  const show = (form) => slot.replaceChildren(form);
  const reset = () => { slot.replaceChildren(); };
  const rename = () => show(inlineForm({
    fields: field(t('unit.newName'), h('input', { name: 'name', value: unitName(u), maxlength: '40', required: true, autocomplete: 'off' })),
    submitLabel: t('action.save'), onCancel: reset,
    onSubmit: (data) => editUnits({ op: 'rename', id: u.id, name: data.get('name') }, t('unit.renamedToast')),
  }));
  const editNucleus = async () => {
    const res = await api.nucleus(project.id, u.id);
    const n = res.ok ? res : u.nucleus;
    show(inlineForm({
      fields: [
        field(t('unit.state'), h('textarea', { name: 'state', rows: '2', maxlength: '1000' }, n.state || '')),
        field(t('unit.decidedHint'), h('textarea', { name: 'decided', rows: '4' }, (n.decided || []).join('\n'))),
        field(t('unit.todoHint'), h('textarea', { name: 'todo', rows: '4' }, (n.todo || []).join('\n'))),
      ],
      submitLabel: t('action.save'), onCancel: reset,
      onSubmit: async (data) => {
        const out = await api.saveNucleus(project.id, u.id, { state: data.get('state').trim(), decided: lines(data.get('decided')), todo: lines(data.get('todo')) });
        if (!out.ok) { toast(errorText(out.error)); return false; }
        toast(t('unit.nucleusSaved'));
        await poll();
        return true;
      },
    }));
  };
  const moves = unitMoves(project.units, u.id);
  const move = () => show(inlineForm({
    fields: field(t('unit.moveInto'), h('select', { name: 'parent' }, moves.map((m) => h('option', { value: m ? m.id : '' }, m ? `${unitName(m)} · ${t(`level.${m.level}`)}` : t('unit.topLevel'))))),
    submitLabel: t('action.move'), onCancel: reset,
    onSubmit: (data) => {
      const parentId = data.get('parent') || null;
      return editUnits({ op: 'move', id: u.id, parentId }, parentId ? t('unit.movedInto', { name: unitName(u), into: unitName(unitById(parentId)) }) : t('unit.movedTop', { name: unitName(u) }));
    },
  }));
  const peers = project.units.filter((x) => x.level === u.level && x.id !== u.id && x.id !== 'unsorted');
  const merge = () => show(inlineForm({
    fields: [field(t('unit.mergeInto'), h('select', { name: 'into' }, peers.map((x) => h('option', { value: x.id }, unitName(x))))),
      h('p', { class: 'muted small' }, t('unit.mergeHint', { name: unitName(u) }))],
    submitLabel: t('action.merge'), onCancel: reset,
    onSubmit: async (data) => {
      const into = data.get('into');
      const ok = await editUnits({ op: 'merge', ids: [u.id], into }, t('unit.mergedToast', { name: unitName(u), into: unitName(unitById(into)) }));
      if (ok) select({ type: 'unit', id: into });
      return ok;
    },
  }));
  const create = () => show(inlineForm({
    fields: field(t('unit.newCellName'), h('input', { name: 'name', maxlength: '40', required: true, autocomplete: 'off' })),
    submitLabel: t('action.create'), onCancel: reset,
    onSubmit: (data) => editUnits({ op: 'create', name: data.get('name'), parentId: u.id }, t('unit.createdToast', { name: data.get('name') })),
  }));
  const editable = u.id !== 'unsorted';
  return h('div', { class: 'tools' },
    h('div', { class: 'actions' },
      button(t('action.continue'), () => startChat(t('chat.newIn', { name: unitName(u) }), t(`level.${u.level}`), t('chat.introUnit', { name: unitName(u) }), { unitId: u.id }), { primary: true }),
      editable ? pinBtn : null,
      editable ? button(t('action.rename'), rename) : null,
      button(t('action.editNucleus'), editNucleus)),
    editable ? h('div', { class: 'actions secondary' },
      moves.length ? button(t('action.move'), move) : null,
      peers.length ? button(t('action.merge'), merge) : null,
      u.level !== 'cell' ? button(t('action.newCell'), create) : null) : null,
    u.level !== 'organ' && editable ? h('p', { class: 'muted small' }, t('unit.dragHint')) : null);
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
  const slot = h('div', { class: 'form-slot' });
  $('#panelBody').replaceChildren(...[
    h('div', { class: 'purpose' },
      u.purpose ? h('p', { class: 'lead' }, u.purpose) : null,
      h('p', { class: 'origin' }, icon(u.origin === 'ai' ? 'spark' : u.origin === 'user' ? 'rename' : 'seed', 'origin-icon'), t(`origin.${u.origin}`)),
      u.tags.length ? h('ul', { class: 'tags', 'aria-label': t('unit.tags') }, u.tags.map((tag) => h('li', {}, tag))) : null),
    unitTools(u, slot),
    slot,
    section(t('unit.state'), u.nucleus.state ? h('p', {}, u.nucleus.state) : h('p', { class: 'muted' }, t('unit.empty'))),
    section(t('unit.decided'), list(u.nucleus.decided)),
    section(t('unit.todo'), list(u.nucleus.todo)),
    section(t('unit.inside'), kids.length ? h('ul', { class: 'plain rows' }, kids.map((k) => h('li', {},
      h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'unit', id: k.id }, { zoom: true }) },
        h('span', { class: 'lr-title' }, h('span', { class: `level-dot status-${k.status}`, 'aria-hidden': 'true' }), unitName(k)),
        h('span', { class: 'lr-date' }, k.level === 'cell' ? t.count('label.chats', k.work.chats) : t(`level.${k.level}`)),
        h('span', { class: 'lr-line' }, k.purpose))))) : null),
    filesSection({ unit: u.id }),
    section(t('unit.branches'), branches.length ? h('ul', { class: 'plain rows' }, branches.map((w) => h('li', {},
      h('button', { type: 'button', class: 'link-row', onclick: () => select({ type: 'workcell', id: w.id }, { zoom: true }) },
        h('span', { class: 'lr-title branch-name' }, w.branch),
        h('span', { class: 'lr-date' }, ownerChip(w.owner)),
        h('span', { class: `lr-line${w.clashWith.length ? ' tone-clash' : ''}` }, wcStatus(w)))))) : null),
    section(t('activity.title'), activityList(project.activity.filter((a) => a.unitIds.some((id) => ids.has(id))).sort(newestFirst).slice(0, 10), { showChat: true })),
    section(t('unit.recent'), recentRows(u.nucleus.recent)),
  ].filter(Boolean));
}

function clashLines(w) {
  return w.clashWith.map(workCellById).filter(Boolean).map((o) => {
    const shared = w.files.map((f) => f.path).filter((p) => o.files.some((f) => f.path === p));
    return h('p', {}, t('wc.clashText', { a: w.owner.name, b: o.owner.name, files: shared.join(', ') }), ' ', branchLink(o));
  });
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

// Files of a unit or a branch, with the buttons that take them out of the page: a terminal here and the phone's VS Code (desenho-2 § 29).
function filesSection({ unit, workCell, files: list, folder = true }) {
  const tunnel = safeTunnel(project.tunnelUrl);
  const terminal = () => runAction({ action: 'new', bare: true, projectId: project.id, ...(workCell ? { frontId: workCell } : {}) }, t('files.openTerminalDone'));
  const tools = folder || tunnel ? h('div', { class: 'actions secondary' },
    folder ? button(t('files.openTerminal'), terminal, { title: t('files.fromPhone') }) : null,
    tunnel ? h('a', { class: 'btn', href: tunnel, target: '_blank', rel: 'noopener noreferrer' }, t('files.phone')) : null) : null;
  return section(t('files.title'), tools, files.tree({ unit, workCell, files: list }));
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
  const alive = w.status !== 'merged';
  $('#panelBody').replaceChildren(...[
    w.clashWith.length ? h('div', { class: 'callout clash' }, h('h3', {}, t('wc.clash')), clashLines(w)) : null,
    w.remote ? h('p', { class: 'note' }, t('wc.remote'), project.fetchedAt ? ` ${t('wc.fetched', { time: clock(project.fetchedAt) })}` : '') : null,
    alive && !w.remote ? h('div', { class: 'tools' }, h('div', { class: 'actions' },
      button(t('action.continue'), () => startChat(t('chat.newOn', { branch: w.branch }), home ? unitName(home) : '', t('chat.introBranch', { branch: w.branch }), { workCellId: w.id, ...(home ? { unitId: home.id } : {}) }), { primary: true }),
      button(t('action.newTerminal'), () => runAction({ action: 'new', frontId: w.id, projectId: project.id }, t('action.newTerminalDone')), { title: t('action.fromPhone') }))) : null,
    section(t('wc.doing'), w.nucleus.doing ? h('p', { class: 'lead' }, w.nucleus.doing) : null),
    w.openspec ? section(t('wc.plan'),
      h('div', { class: 'progress', role: 'img', 'aria-label': t('chat.openspec', w.openspec) },
        h('span', { style: `width:${Math.round((w.openspec.done / Math.max(1, w.openspec.total)) * 100)}%` })),
      h('p', { class: 'muted small' }, `${w.openspec.change} · ${t('chat.openspec', w.openspec)}`)) : null,
    section(t('wc.todo'), list(w.nucleus.todo)),
    filesSection({ workCell: w.id, files: w.files, folder: Boolean(!w.remote || w.path) }),
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
    const c = r.sessionId && chatById(r.sessionId);
    const parts = [
      h('span', { class: `lr-kind${r.kind === 'meaning' ? ' by-meaning' : ''}` }, t(`link.kind.${r.kind}`)),
      h('span', { class: 'lr-line' }, r.text),
      c ? h('span', { class: 'lr-open' }, t('link.open', { title: c.title })) : null,
    ];
    return h('li', {}, c
      ? h('button', { type: 'button', class: 'link-row reason', onclick: () => select({ type: 'chat', id: c.sessionId }, { zoom: true }) }, parts)
      : h('div', { class: 'link-row reason static' }, parts));
  });
  $('#panelBody').replaceChildren(section(t('link.why'), h('ul', { class: 'plain rows' }, reasons)));
}

function chatTools(c, slot) {
  const can = chatButtons(c);
  const unit = unitById(c.unitId);
  const actions = [];
  actions.push(button(t('action.continue'), () => startChat(t('chat.newFrom', { title: c.title }), unit ? unitName(unit) : '', t('chat.introChild', { title: c.title }), { parentId: c.sessionId, ...(c.workCellId ? { workCellId: c.workCellId } : {}) }), { primary: true }));
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
  const targets = project.units.filter((u) => u.id !== c.unitId);
  const move = () => slot.replaceChildren(inlineForm({
    fields: field(t('chat.moveTo'), h('select', { name: 'unit' }, targets.map((u) => h('option', { value: u.id }, `${unitName(u)} · ${t(`level.${u.level}`)}`)))),
    submitLabel: t('action.move'), onCancel: () => slot.replaceChildren(),
    onSubmit: async (data) => { await moveChat(c.sessionId, data.get('unit')); },
  }));
  const notes = [];
  if (!can.open.enabled && can.open.reason) notes.push(t(`action.why.${can.open.reason}`));
  if (c.live && c.entrypoint === 'claude-vscode') notes.push(t('action.vscodeFolder'));
  return h('div', { class: 'tools' },
    h('div', { class: 'actions' }, actions),
    h('div', { class: 'actions secondary' }, button(t('action.moveChat'), move)),
    notes.length ? h('p', { class: 'muted small' }, notes.join(' ')) : null,
    h('p', { class: 'muted small' }, t('chat.dragHint')));
}

function renderChatPanel(c) {
  const unit = unitById(c.unitId);
  const wc = c.workCellId && workCellById(c.workCellId);
  const parent = c.parentId && chatById(c.parentId);
  const card = c.card || {};
  panelHead(c.title, pill(chatTone(c), t(`chat.${c.status}`)), c.archived ? h('span', { class: 'level-badge' }, t('chat.archived')) : null, unit ? unitLink(unit) : null);

  let waitingBlock = null;
  if (c.waiting.strong || c.waiting.items.length || c.waiting.weak) {
    waitingBlock = h('div', { class: 'callout' },
      h('h3', {}, t('chat.waitingFor')),
      c.waiting.strong ? h('p', {}, t('chat.question')) : null,
      !c.waiting.strong && c.waiting.weak ? h('p', {}, t('chat.endsWithQuestion')) : null,
      list(c.waiting.items));
  }

  const facts = [
    [t('chat.cost'), h('span', { class: 'num' }, money(c.costUSD))],
    [t('chat.branch'), wc ? branchLink(wc) : h('span', { class: 'branch-name' }, project.mainBranch || '—')],
    [t('chat.started'), shortDate(Date.parse(c.startedAt))],
    [t('chat.updated'), relative(c.updatedAt)],
    ...c.workflows.map((w) => [t('chat.workflow'), `${w.name} · ${t('chat.workflowSteps', { done: w.done, started: w.started, label: w.lastLabel })}`]),
    parent ? [t('chat.from'), linkTo(parent.title, { type: 'chat', id: parent.sessionId })] : null,
  ].filter(Boolean);

  const slot = h('div', { class: 'form-slot' });
  $('#panelBody').replaceChildren(...[
    waitingBlock,
    isUnsure(c) ? h('p', { class: 'note' }, c.unitSource === 'none' ? t('chat.unsortedHint') : t('chat.guess')) : null,
    chatTools(c, slot),
    slot,
    section(t('chat.doing'), card.doing ? h('p', { class: 'lead' }, card.doing) : null),
    section(t('chat.todo'), list(card.todo)),
    section(t('chat.lastPrompt'), c.lastPrompt ? h('p', { class: 'quote' }, c.lastPrompt) : null),
    section(t('chat.lastReply'), c.lastAssistantText ? h('p', {}, c.lastAssistantText) : null),
    section(t('chat.commits'), activityList(project.activity.filter((a) => isWork(a) && a.sessionId === c.sessionId).sort(newestFirst), { showChat: false })),
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
        h('span', { class: `pill tone-${s.enabled ? 'active' : 'idle'}` }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), s.enabled ? t('skills.on') : t('skills.off'))),
      s.description ? h('p', { class: 'skill-desc' }, s.description) : null,
      h('div', { class: 'skill-cmd' }, h('code', {}, s.command),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => copy(s.command), 'aria-label': t('skills.copyAria', { command: s.command }) }, t('skills.copy'))))))
      : h('p', { class: 'muted' }, t('skills.none'));
  } else {
    const ai = p.ai;
    const boot = bootstrapOf(p);
    body = h('div', {},
      h('dl', { class: 'facts first' },
        h('dt', {}, t('project.root')), h('dd', {}, h('code', { class: 'path' }, p.root)),
        h('dt', {}, t('costs.range.today')), h('dd', { class: 'num' }, money(p.cost.today)),
        h('dt', {}, t('costs.range.d7')), h('dd', { class: 'num' }, money(p.cost.d7)),
        h('dt', {}, t('costs.range.d30')), h('dd', { class: 'num' }, money(p.cost.d30)),
        p.fetchedAt ? [h('dt', {}, t('project.fetched')), h('dd', {}, clock(p.fetchedAt))] : null),
      section(t('project.ai'), ai
        ? [h('p', {}, t('project.aiOn', { model: ai.model, cost: money(ai.spentUSDToday) })),
          ai.queue ? h('p', { class: 'muted small' }, t.count('costs.aiQueue', ai.queue)) : null,
          boot ? h('div', { class: 'progress', role: 'img', 'aria-label': t('ai.organizing', boot) }, h('span', { style: `width:${Math.round((boot.done / Math.max(1, boot.total)) * 100)}%` })) : null,
          boot ? h('p', { class: 'muted small' }, t('ai.organizingCost', { cost: money(boot.estimatedUSD) })) : null]
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
  panel.hidden = false;
  panel.querySelector('.panel-body').scrollTop = 0;
}
function closePanel(restore = true) {
  if ($('#panel').hidden) return;
  $('#panel').hidden = true;
  selection = null;
  editing = false;
  brain.select(null);
  if (restore && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

function showAt(iso) {
  if (Date.parse(iso) > tNow) setTime(tMax, { instant: true });
}

// Draws the panel for the current selection again (after a poll or an edit) without moving the map.
function rerender() {
  if (selection && !$('#panel').hidden) select(selection, { keep: true });
}

function select(sel, { zoom = false, keep = false } = {}) {
  if (!sel) {
    closePanel();
    return;
  }
  closeWaiting();
  if (!keep) editing = false;
  selection = sel;
  if (sel.type === 'project') {
    renderProjectPanel();
    brain.select(null);
    if (!keep) {
      openPanel();
      requestAnimationFrame(() => brain.fit(true));
    }
    return;
  }
  if (sel.type === 'unit') {
    const u = unitById(sel.id);
    if (!u) return closePanel();
    if (!keep) showAt(u.bornAt);
    renderUnitPanel(u);
  } else if (sel.type === 'workcell') {
    const w = workCellById(sel.id);
    if (!w) return closePanel();
    // A fused branch only exists in the past: travel to its last hour alive.
    if (!keep && w.mergedAt && tNow >= Date.parse(w.mergedAt)) setTime(Date.parse(w.mergedAt) - 3600e3, { instant: true });
    else if (!keep) showAt(w.bornAt);
    renderWorkCellPanel(w);
  } else if (sel.type === 'link') {
    const link = project.unitLinks.find((l) => `${l.a}|${l.b}` === sel.id);
    if (!link) return closePanel();
    if (!keep) showAt(link.since);
    renderLinkPanel(link);
  } else {
    const c = chatById(sel.id);
    if (!c) return closePanel();
    // Opening an archived conversation shows the archived ones; archiving the open one lets it leave the map.
    if (c.archived && !showArchived) {
      if (keep) return closePanel();
      setArchived(true);
    }
    if (!keep) showAt(c.startedAt);
    renderChatPanel(c);
  }
  if (!keep) openPanel();
  brain.select(sel);
  const focus = { unit: brain.focusUnit, workcell: brain.focusWorkCell, link: brain.focusLink, chat: brain.focusChat }[sel.type];
  if (zoom) requestAnimationFrame(() => focus(sel.id));
}

// Cumulative count of conversations: the project visibly gaining body over time.
function renderGrowth() {
  const starts = shown.chats.map((c) => Date.parse(c.startedAt)).sort((a, b) => a - b);
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

  // Births, fusions, groupings and renames as marks on the track: where the body divided, came together or learned a name.
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
  for (const m of document.querySelectorAll('.mark-event')) {
    const past = Number(m.dataset.pos) <= pos / 10;
    // A mark the play head just crossed lights up once: the event happening, not only its trace.
    m.classList.toggle('is-crossed', past && !instant && !m.classList.contains('is-past'));
    m.classList.toggle('is-past', past);
  }
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

function timeBounds() {
  tMax = Date.parse(state.generatedAt);
  const starts = shown.chats.map((c) => Date.parse(c.startedAt));
  tMin = starts.length ? Math.min(...starts) - 864e5 / 2 : tMax - 864e5;
}

function setProject(id) {
  project = state.projects.find((p) => p.id === id) || state.projects[0];
  shown = visibleProject(project, showArchived);
  tree = unitTree(project.units);
  store.set('sm.project', project.id);
  $('#project').value = project.id;
  stopPlay();
  closePanel(false);
  timeBounds();
  renderSummary();
  const empty = project.chats.length === 0;
  $('#notice').textContent = empty ? t('state.emptyProject') : '';
  $('#notice').hidden = !empty;
  brain.setProject(shown);
  renderGrowth();
  setTime(tMax, { instant: true });
  brain.fit(false);
  refreshView();
}

function setArchived(on) {
  showArchived = on;
  store.set('sm.archived', on ? '1' : '0');
  shown = visibleProject(project, showArchived);
  brain.setProject(shown);
  renderGrowth();
  setTime(tNow, { instant: true });
  renderSummary();
  refreshView();
  rerender();
}

function renderProjects() {
  $('#project').replaceChildren(...state.projects.map((p) => h('option', { value: p.id }, p.name)));
}

function renderNoProjects() {
  $('#summary').replaceChildren();
  $('#project').replaceChildren();
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
  renderProjects();
  const sel = selection;
  setProject(project?.id || store.get('sm.project'));
  if (sel) select(sel);
}

// A new state from the poll: the graph is laid out again only when its shape changed, otherwise repainted by id.
function applyState(next) {
  const before = project;
  const wasAtEnd = tNow >= tMax;
  state = next;
  renderWaiting();
  if (!state.projects.length) return renderNoProjects();
  if (!before || document.body.classList.contains('is-empty')) return renderAll();
  renderProjects();
  project = state.projects.find((p) => p.id === before.id) || state.projects[0];
  $('#project').value = project.id;
  if (project.id !== before.id) return setProject(project.id);
  const old = shown;
  shown = visibleProject(project, showArchived);
  tree = unitTree(project.units);
  timeBounds();
  renderSummary();
  $('#notice').hidden = project.chats.length > 0;
  if (structureKey(old) !== structureKey(shown)) {
    brain.setProject(shown);
    renderGrowth();
  } else {
    brain.update(shown);
    renderGrowth();
  }
  setTime(wasAtEnd ? tMax : tNow, { instant: true });
  for (const e of lifeEventsSince(before, project)) {
    brain.pulse(e.unitIds, e.kind);
    if (AI_KINDS.has(e.kind)) toast(t('ai.noticed', { what: activityTitle(e) }));
  }
  if (!editing) rerender();
  refreshView();
}

let polling = null;
function poll() {
  if (polling) return polling;
  polling = (async () => {
    const res = await api.state();
    if (res.ok) {
      const { ok, status, error, ...next } = res;
      applyState(next);
    } else if (state) {
      toast(t('state.offline'));
    }
  })().finally(() => { polling = null; });
  return polling;
}

function showView(name) {
  view = VIEWS.includes(name) ? name : 'brain';
  for (const v of VIEWS) $(`#tab-${v}`).setAttribute('aria-current', v === view ? 'page' : 'false');
  document.body.dataset.view = view;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.id !== `view-${view}`;
  if (view === 'discover') discover.show();
  else $('#discover').hidden = true;
  if (view !== 'brain') { closePanel(false); chat.close(); stopPlay(); closeWaiting(); }
  store.set('sm.view', view);
  refreshView(true);
}

function refreshView(first = false) {
  if (!state?.projects.length || !['map', 'board', 'history', 'costs'].includes(view)) return;
  const root = $(`#view-${view}`);
  if (first) tabs.render(view, root);
  else tabs.refresh(view, root);
}

let discover = null;
let chat = null;
let files = null;
let tabs = null;

function wire() {
  $('#project').addEventListener('change', (e) => setProject(e.target.value));
  for (const b of document.querySelectorAll('.lang button')) {
    b.addEventListener('click', () => {
      if (!LANGS[b.dataset.lang] || b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      t = translator(lang);
      store.set('sm.lang', lang);
      renderAll();
      refreshView(true);
    });
  }
  discover = createDiscover({
    root: $('#discover'), h, t: () => t, lang: () => lang, toast,
    project: () => (project ? { id: project.id, name: project.name } : null),
  });
  chat = createChat({
    root: $('#chat'), h, t: () => t, toast, errorText,
    onSession: () => setTimeout(poll, 1200),
    onClose: () => brain.fit(true),
  });
  files = createFiles({ dialog: $('#fileDialog'), h, t: () => t, toast, errorText, project: () => project });
  tabs = createTabs({
    h, t: () => t, lang: () => lang, fmt: { money, shortDate, relative },
    state: () => state, project: () => project, go: goTo, toast, errorText, confirm: confirmAction,
    prefs: { archived: () => showArchived, setArchived },
  });
  for (const v of VIEWS) $(`#tab-${v}`).addEventListener('click', () => showView(v));
  $('#waitingBtn').addEventListener('click', () => ($('#waitingList').hidden ? openWaiting() : closeWaiting()));
  for (const b of document.querySelectorAll('[data-close="panel"], [data-close="waiting"]')) {
    b.addEventListener('click', () => (b.dataset.close === 'panel' ? closePanel() : closeWaiting()));
  }
  $('#fit').addEventListener('click', () => brain.fit(true));
  $('#play').addEventListener('click', togglePlay);
  $('#time').addEventListener('input', (e) => {
    stopPlay();
    setTime(tMin + (Number(e.target.value) / 1000) * (tMax - tMin));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#confirmDialog').open || $('#installDialog').open || $('#fileDialog').open) return;
    if (!$('#waitingList').hidden) closeWaiting();
    else if (chat.isOpen()) chat.close();
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
      brain.setProject(shown);
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) poll(); });
  setInterval(() => { if (!document.hidden && state && !playing) poll(); }, POLL_MS);
}

// Deep link used for screenshots and sharing a view: ?view=<tab>&project=<id>&at=<ISO date>&select=unit:<id> (or workcell:, chat:, link:, project:).
function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('project')) setProject(params.get('project'));
  const at = Date.parse(params.get('at') || '');
  if (!Number.isNaN(at)) setTime(at, { instant: true });
  const pick = params.get('select') || '';
  const cut = pick.indexOf(':');
  if (cut > 0) select({ type: pick.slice(0, cut), id: pick.slice(cut + 1) }, { zoom: true });
  const tab = params.get('view');
  if (tab) showView(tab);
}

async function main() {
  applyStaticText();
  wire();
  const notice = $('#notice');
  notice.textContent = t('state.loading');
  notice.hidden = false;
  const res = await api.state();
  if (!res.ok) {
    notice.textContent = res.error === 'token-required' ? t('err.token-required') : t('state.error');
    notice.classList.add('is-error');
    return;
  }
  const { ok, status, error, ...first } = res;
  state = first;
  notice.hidden = true;
  renderAll();
  if (state.projects.length) {
    const params = new URLSearchParams(location.search);
    const saved = store.get('sm.view');
    if (saved && saved !== 'brain' && !params.get('view') && !params.get('select')) showView(saved);
    applyDeepLink();
  }
}

main();
