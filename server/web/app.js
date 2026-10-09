import { LANGS, pickLang, translator } from './i18n.js';
import { createBrain, neuronKind, isUnsure } from './brain.js';

const $ = (sel) => document.querySelector(sel);
const PLAY_MS = 8000;
const PHONE = window.matchMedia('(max-width: 719px)');

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: preference just isn't remembered */ } },
};

let lang = pickLang(store.get('sm.lang'), navigator.language);
let t = translator(lang);
let state = null;
let project = null;
let selection = null;
let tMin = 0, tMax = 0, tNow = 0;
let playing = 0;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

const money = (usd) => new Intl.NumberFormat(lang, { style: 'currency', currency: state.currency.code, maximumFractionDigits: 2 })
  .format(usd * state.currency.rate);
const shortDate = (ms) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(ms);

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

const cellName = (cell) => (cell.id === 'unsorted' ? t('cell.unsorted') : cell.name);
const statusWord = (s) => t(`status.${s}`);

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
  let top = summary.height ? summary.bottom - stage.top + 4 : 8;
  let width = stage.width, height = stage.height - top - (PHONE.matches ? 64 : 56);
  const panel = $('#panel');
  if (!panel.hidden) {
    const p = panel.getBoundingClientRect();
    if (PHONE.matches) height = Math.max(160, p.top - stage.top - top - 8);
    else width = Math.max(240, p.left - stage.left - 8);
  }
  return { left: 0, top, width, height };
}

const brain = createBrain($('#brain'), {
  onSelect: (sel) => select(sel, { zoom: true }),
  labelFor: cellName,
  statusLabel: statusWord,
  chatsLabel: (n) => t.count('summary.chats', n),
  chatsShort: (n) => t.count('label.chats', n),
  linkLabel: (a, b) => t('link.aria', { a: cellName(a), b: cellName(b) }),
  freeArea,
});

function renderSummary() {
  const chats = project.chats;
  const busy = chats.filter((c) => c.status === 'busy').length;
  const parts = [
    h('strong', {}, project.name),
    h('span', {}, t.count('summary.areas', project.cells.length)),
    h('span', {}, t.count('summary.chats', chats.length)),
  ];
  if (busy) parts.push(h('span', { class: 'tone-active' }, t('summary.working', { n: busy })));
  parts.push(h('span', { class: 'num' }, t('summary.cost', { v: money(project.cost.d30) })));
  const el = $('#summary');
  el.replaceChildren(...parts.flatMap((p, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p])));
}

function waitingChats() {
  const out = [];
  for (const p of state.projects) {
    for (const c of p.chats) {
      if (c.waiting.strong || c.waiting.weak || c.waiting.items.length) out.push({ project: p, chat: c });
    }
  }
  const rank = ({ chat }) => (chat.waiting.strong ? 0 : chat.waiting.items.length ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.chat.updatedAt.localeCompare(a.chat.updatedAt));
}

function renderWaiting() {
  $('#waitingLabel').textContent = t('waiting.button', { n: state.waitingCount });
  $('#waitingBtn').classList.toggle('is-zero', state.waitingCount === 0);
  const items = waitingChats();
  const list = $('#waitingItems');
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'empty' }, t('waiting.none')));
    return;
  }
  list.replaceChildren(...items.map(({ project: p, chat }) => {
    const reason = chat.waiting.strong ? t('waiting.question') : chat.waiting.items.length ? t('waiting.item') : t('waiting.ends');
    const detail = chat.waiting.items[0] || tail(chat.lastAssistantText, 140);
    const cell = p.cells.find((c) => c.id === chat.cellId);
    return h('li', {},
      h('button', {
        type: 'button', class: `waiting-item${chat.waiting.strong ? ' strong' : ''}`,
        onclick: () => {
          closeWaiting();
          if (p !== project) setProject(p.id);
          select({ type: 'chat', id: chat.sessionId }, { zoom: true });
        },
      },
      h('span', { class: 'wi-reason' }, reason),
      h('span', { class: 'wi-title' }, chat.title),
      h('span', { class: 'wi-where' }, [state.projects.length > 1 ? p.name : null, cell ? cellName(cell) : null].filter(Boolean).join(' · ')),
      h('span', { class: 'wi-detail' }, detail)));
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

const isWork = (item) => item.kind === 'commit' || item.kind === 'merge';

function activityRow(item, { showChat }) {
  const chat = showChat && item.sessionId && project.chats.find((c) => c.sessionId === item.sessionId);
  const title = item.kind === 'push' ? t('activity.pushed', { branch: item.branch })
    : item.kind === 'tag' ? t('activity.tagged', { tag: item.subject })
      : item.subject;
  const icon = svgEl('svg', { class: 'act-icon', 'aria-hidden': 'true' });
  icon.append(svgEl('use', { href: `#i-${item.kind}` }));
  const who = [t('activity.by', { name: item.author.name }), item.coAuthor ? t('activity.with', { name: item.coAuthor }) : null].filter(Boolean).join(' · ');
  return h('li', { class: `act act-${item.kind}` },
    icon,
    h('div', { class: 'act-body' },
      h('span', { class: 'act-title' }, item.hash && isWork(item) ? h('code', { class: 'act-hash' }, item.hash.slice(0, 7)) : null, title),
      h('span', { class: 'act-meta' }, who,
        chat ? [' · ', `${t('activity.in')} `, h('button', { type: 'button', class: 'meta-link', onclick: () => select({ type: 'chat', id: chat.sessionId }, { zoom: true }) }, chat.title)] : null,
        ' · ', h('span', { class: 'num' }, relative(item.ts)))));
}

function activityList(items, opts) {
  return items.length ? h('ul', { class: 'activity' }, items.map((i) => activityRow(i, opts))) : null;
}

const newestFirst = (a, b) => b.ts.localeCompare(a.ts);

function renderCellPanel(cell) {
  const nucleus = cell.nucleus;
  const chatById = new Map(project.chats.map((c) => [c.sessionId, c]));
  $('#panelHead').replaceChildren(
    h('h2', { id: 'panelTitle' }, cellName(cell)),
    h('p', { class: 'meta' }, pill(cell.status, statusWord(cell.status)), h('span', {}, t.count('summary.chats', cell.chatIds.length))),
  );
  const recent = nucleus.recent.map((r) => h('li', {},
    h('button', { type: 'button', class: 'link-row', onclick: () => chatById.has(r.sessionId) && select({ type: 'chat', id: r.sessionId }, { zoom: true }) },
      h('span', { class: 'lr-title' }, r.title),
      h('span', { class: 'lr-date num' }, shortDate(Date.parse(r.date))),
      h('span', { class: 'lr-line' }, r.line))));
  $('#panelBody').replaceChildren(...[
    section(t('cell.state'), nucleus.state ? h('p', { class: 'lead' }, nucleus.state) : h('p', { class: 'muted' }, t('cell.empty'))),
    section(t('cell.decided'), list(nucleus.decided)),
    section(t('cell.todo'), list(nucleus.todo)),
    section(t('activity.title'), activityList((project.activity || []).filter((a) => a.cellIds.includes(cell.id)).sort(newestFirst).slice(0, 10), { showChat: true })),
    section(t('cell.recent'), recent.length ? h('ul', { class: 'plain rows' }, recent) : null),
    inertActions([t('action.continue')]),
  ].filter(Boolean));
}

function renderLinkPanel(link) {
  const a = project.cells.find((c) => c.id === link.a);
  const b = project.cells.find((c) => c.id === link.b);
  const chatById = new Map(project.chats.map((c) => [c.sessionId, c]));
  const cellButton = (cell) => h('button', { type: 'button', class: 'meta-link', onclick: () => select({ type: 'cell', id: cell.id }, { zoom: true }) }, cellName(cell));
  $('#panelHead').replaceChildren(
    h('h2', { id: 'panelTitle' }, `${cellName(a)} ↔ ${cellName(b)}`),
    h('p', { class: 'meta' },
      h('span', {}, t.count('link.reasons', link.reasons.length)),
      h('span', {}, t('link.since', { date: shortDate(Date.parse(link.since)) })),
      cellButton(a), cellButton(b)),
  );
  const reasons = link.reasons.map((r) => {
    const chat = r.sessionId && chatById.get(r.sessionId);
    const parts = [
      h('span', { class: 'lr-kind' }, t(`link.kind.${r.kind}`)),
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
  const cell = project.cells.find((c) => c.id === chat.cellId);
  const front = project.fronts.find((f) => f.id === chat.frontId);
  const parent = chat.parentId && project.chats.find((c) => c.sessionId === chat.parentId);
  const card = chat.card || {};
  $('#panelHead').replaceChildren(
    h('h2', { id: 'panelTitle' }, chat.title),
    h('p', { class: 'meta' },
      pill(chatTone(chat), t(`chat.${chat.status}`)),
      cell ? h('button', { type: 'button', class: 'meta-link', onclick: () => select({ type: 'cell', id: cell.id }, { zoom: true }) }, cellName(cell)) : null),
  );

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
    front ? [t('chat.branch'), h('span', {}, front.branch,
      front.openspec ? h('span', { class: 'muted' }, ` · ${t('chat.openspec', front.openspec)}`) : null)] : null,
    [t('chat.started'), shortDate(Date.parse(chat.startedAt))],
    [t('chat.updated'), relative(chat.updatedAt)],
    ...chat.workflows.map((w) => [t('chat.workflow'), `${w.name} · ${t('chat.workflowSteps', { done: w.done, started: w.started, label: w.lastLabel })}`]),
    parent ? [t('chat.from'), h('button', { type: 'button', class: 'meta-link', onclick: () => select({ type: 'chat', id: parent.sessionId }, { zoom: true }) }, parent.title)] : null,
  ].filter(Boolean);

  const actions = [t('action.continue'), t('action.open')];
  if (chat.live) actions.push(t('action.stop'));
  actions.push(t('action.archive'));

  $('#panelBody').replaceChildren(...[
    waitingBlock,
    isUnsure(chat) ? h('p', { class: 'note' }, chat.cellSource === 'none' ? t('chat.unsortedHint') : t('chat.guess')) : null,
    section(t('chat.doing'), card.doing ? h('p', { class: 'lead' }, card.doing) : null),
    section(t('chat.todo'), list(card.todo)),
    section(t('chat.lastPrompt'), chat.lastPrompt ? h('p', { class: 'quote' }, chat.lastPrompt) : null),
    section(t('chat.lastReply'), chat.lastAssistantText ? h('p', {}, chat.lastAssistantText) : null),
    section(t('chat.commits'), activityList((project.activity || []).filter((a) => isWork(a) && a.sessionId === chat.sessionId).sort(newestFirst), { showChat: false })),
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

function select(sel, { zoom = false } = {}) {
  if (!sel) {
    closePanel();
    return;
  }
  closeWaiting();
  selection = sel;
  if (sel.type === 'cell') {
    const cell = project.cells.find((c) => c.id === sel.id);
    if (!cell) return;
    renderCellPanel(cell);
  } else if (sel.type === 'link') {
    const link = (project.cellLinks || []).find((l) => `${l.a}|${l.b}` === sel.id);
    if (!link) return;
    if (Date.parse(link.since) > tNow) setTime(tMax, { instant: true });
    renderLinkPanel(link);
  } else {
    const chat = project.chats.find((c) => c.sessionId === sel.id);
    if (!chat) return;
    if (Date.parse(chat.startedAt) > tNow) setTime(tMax, { instant: true });
    renderChatPanel(chat);
  }
  openPanel();
  brain.select(sel);
  const focus = { cell: brain.focusCell, link: brain.focusLink, chat: brain.focusChat }[sel.type];
  if (zoom) requestAnimationFrame(() => focus(sel.id));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// Cumulative count of conversations: the project visibly gaining body over time.
function renderGrowth() {
  const starts = project.chats.map((c) => Date.parse(c.startedAt)).sort((a, b) => a - b);
  const span = Math.max(1, tMax - tMin);
  const total = Math.max(1, starts.length);
  const x = (ms) => (((ms - tMin) / span) * 1000).toFixed(1);
  const y = (n) => (100 - (n / total) * 92).toFixed(1);
  let line = `M0,100`;
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
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!project) return;
      const sel = selection;
      brain.setProject(project);
      brain.setTime(tNow, { instant: true });
      brain.fit(false);
      if (sel) brain.select(sel);
    }, 150);
  });
  if (!PHONE.matches) $('#legend').open = true;
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
}

main();
