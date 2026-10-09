// The "Now" strip (mm09) and the project picker's badges (mm10): every job on the PC, whatever project the page has open.
// The pure part on top is what node:test loads; createNowStrip touches the DOM only when called.
import { archTree } from './tree.js';
import { nodeOfConversation, placeOf, projectHue, originIcon } from './convlist.js';
import { modelName, runningWorkflows, stepWords } from './live.js';
import { kindMark } from './blocks.js';

const DAY_MS = 86_400_000;
const KIND_ORDER = { waiting: 0, working: 1, finished: 2 };

const asksFor = (w) => Boolean(w.strong || w.weak || w.items.length);
const newest = (a, b) => String(b.chat.updatedAt ?? '').localeCompare(String(a.chat.updatedAt ?? ''));

// A question left in a closed conversation days ago is history, not a job: it waits only while open or for a day.
function kindOf(chat, unseen, nowMs) {
  if (chat.archived) return null;
  const fresh = chat.live || nowMs - Date.parse(chat.updatedAt ?? '') <= DAY_MS;
  if (fresh && (chat.status === 'busy' ? chat.waiting.strong : asksFor(chat.waiting))) return 'waiting';
  if (chat.status === 'busy') return 'working';
  return unseen.has(chat.sessionId) ? 'finished' : null;
}

// Never takes the open project: the strip reads the same with any project selected (mm09).
// Each card: {kind, project, hue, chat, nodeId, place, lastStep, origin, model, helpers {done, total} | null, since}.
export function nowJobs(state, { unseen = new Set(), nowMs = Date.parse(state.generatedAt) } = {}) {
  const cards = [];
  for (const project of state.projects) {
    let tree = null;
    const rows = new Map((project.conversations ?? []).map((r) => [r.sessionId, r]));
    for (const chat of project.chats) {
      const kind = kindOf(chat, unseen, nowMs);
      if (!kind) continue;
      tree ??= archTree(project);
      const listed = rows.get(chat.sessionId);
      const row = { partId: chat.partId, itemCode: chat.itemCode ?? null, node: listed?.node ?? null };
      const workflows = runningWorkflows(chat, nowMs);
      const lastStep = chat.liveSteps?.at(-1) ?? null;
      cards.push({
        kind, project, hue: projectHue(project), chat,
        nodeId: nodeOfConversation(tree, row),
        place: placeOf(tree, row),
        lastStep,
        origin: listed?.origin ?? null,
        model: chat.model ?? null,
        helpers: workflows.length ? { done: workflows.reduce((n, w) => n + w.done, 0), total: workflows.reduce((n, w) => n + w.started, 0) } : null,
        since: kind === 'working' ? chat.turnStartedAt ?? lastStep?.ts ?? chat.updatedAt : chat.updatedAt,
      });
    }
  }
  cards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || newest(a, b));
  const count = (kind) => cards.filter((c) => c.kind === kind).length;
  return { cards, counts: { working: count('working'), waiting: count('waiting'), finished: count('finished') } };
}

// projectId → {working, waiting, finished}: the marks next to each project in the picker.
export function jobBadges(jobs) {
  const out = new Map();
  for (const c of jobs.cards) {
    const b = out.get(c.project.id) ?? { working: 0, waiting: 0, finished: 0 };
    b[c.kind] += 1;
    out.set(c.project.id, b);
  }
  return out;
}

// What needs the person: the number in the tab title, like "(2) session-map".
export const pendingCount = (jobs) => jobs.counts.waiting + jobs.counts.finished;

// statuses: sessionId → status at the last look. A conversation that stopped working since then is "finished and not seen"
// until it is opened; one that works again drops the mark. The first look marks nothing.
export function nextUnseen(statuses, state, unseen) {
  const next = new Map();
  const out = new Set(unseen);
  for (const project of state.projects) {
    for (const c of project.chats) {
      next.set(c.sessionId, c.status);
      if (c.status === 'busy') out.delete(c.sessionId);
      else if (statuses.get(c.sessionId) === 'busy') out.add(c.sessionId);
    }
  }
  return { statuses: next, unseen: out };
}

// The strip folded to one line: "3 working · 2 waiting for you · 1 finished".
export function nowLine(t, counts) {
  const parts = ['working', 'waiting', 'finished'].filter((k) => counts[k] > 0).map((k) => t(`now.${k}`, { n: counts[k] }));
  return parts.length ? parts : [t('now.nothing')];
}

// ---- the strip ----------------------------------------------------------------------------------

const TEXT_MAX = 110;
const waitingWords = (w) => (w.strong ? 'waiting.question' : w.items.length ? 'waiting.item' : 'waiting.ends');

function shorten(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

// ctx: root (the strip), line (its one-line button), counts, cards (the list), h, t (translator getter), icon(name, cls),
// relative(iso), phone (media query), store {get, set}, onOpen(card). It is handed the jobs and never asks which project
// the page has open, so switching project, tab or scrolling leaves it as it is (mm09).
export function createNowStrip(ctx) {
  const { root, line, h, icon, store } = ctx;
  let folded = store.get('sm.now.folded') === '1';
  let jobs = { cards: [], counts: { working: 0, waiting: 0, finished: 0 } };

  function where(card) {
    const tt = ctx.t();
    const tail = card.place.special ? tt(`convs.place.${card.place.special}`) : card.place.path.slice(-2).join(' › ');
    return [h('span', { class: 'cv-proj' }, h('span', { class: 'cv-proj-dot', 'aria-hidden': 'true' }), h('span', { class: 'cv-proj-name' }, card.project.name)), tail ? h('span', { class: 'now-path' }, tail) : null];
  }

  function detail(card) {
    const tt = ctx.t();
    if (card.kind === 'waiting') return tt(waitingWords(card.chat.waiting));
    if (card.kind === 'finished') return shorten(card.chat.lastAssistantText, TEXT_MAX) || tt('now.kind.finished');
    return stepWords(tt, card.lastStep) || tt('chat.busy');
  }

  function cardView(card) {
    const tt = ctx.t();
    const title = card.chat.title || tt('chat.untitled');
    const when = card.since ? (card.kind === 'working' ? tt('now.started', { when: ctx.relative(card.since) }) : ctx.relative(card.since)) : '';
    const meta = [
      card.origin ? h('span', { class: `cv-origin-badge o-${card.origin}`, title: tt('convs.origin.title', { origin: tt(`convs.origin.${card.origin}`) }) }, icon(originIcon(card.origin), 'cv-origin'), tt(`convs.origin.${card.origin}`)) : null,
      card.model ? h('span', { class: 'now-model', title: tt('now.modelTitle') }, modelName(card.model)) : null,
      card.helpers ? h('span', { class: 'now-helpers num', title: tt('now.helpersTitle', card.helpers) }, icon('auto', 'now-helpers-icon'), tt('now.helpers', card.helpers)) : null,
    ].filter(Boolean);
    const open = () => {
      if (ctx.phone.matches) setOpen(false);
      ctx.onOpen(card);
    };
    return h('li', { class: `now-card k-${card.kind}`, style: `--p-h:${card.hue}`, 'data-session': card.chat.sessionId },
      h('button', { type: 'button', class: 'now-card-btn', 'aria-label': `${tt(`now.kind.${card.kind}`)}: ${tt('now.open', { title, project: card.project.name })}`, onclick: open },
        h('span', { class: 'now-top' },
          h('span', { class: 'now-kind' }, card.kind === 'finished' ? icon('check', 'now-kind-check') : h('span', { class: 'now-dot', 'aria-hidden': 'true' }), tt(`now.kind.${card.kind}`)),
          when ? h('span', { class: 'now-when num' }, when) : null),
        h('span', { class: 'now-card-title' }, kindMark({ h, icon, t: tt }, 'chats'), h('span', { class: 'now-card-name' }, title)),
        h('span', { class: 'now-where' }, where(card)),
        h('span', { class: 'now-detail' }, detail(card)),
        meta.length ? h('span', { class: 'now-meta' }, meta) : null));
  }

  function countsView() {
    const tt = ctx.t();
    const c = jobs.counts;
    const kinds = ['working', 'waiting', 'finished'].filter((k) => c[k] > 0);
    if (!kinds.length) return [h('span', { class: 'now-count is-none' }, tt('now.nothing'))];
    return kinds.map((k) => h('span', { class: `now-count k-${k}` },
      k === 'finished' ? icon('check', 'now-count-check') : h('span', { class: 'now-dot', 'aria-hidden': 'true' }),
      tt(`now.${k}`, { n: c[k] })));
  }

  const isOpen = () => root.classList.contains('is-open');
  function setOpen(on) {
    root.classList.toggle('is-open', on);
  }

  // A phone shows one line that opens the list over the page; a desktop shows the cards, folded to the line on request.
  function syncFold() {
    const phone = ctx.phone.matches;
    if (!phone) setOpen(false);
    root.classList.toggle('is-folded', !phone && folded);
    const shut = phone ? !isOpen() : folded;
    line.setAttribute('aria-expanded', String(jobs.cards.length > 0 && !shut));
    line.title = jobs.cards.length ? ctx.t()(shut ? 'now.unfold' : 'now.fold') : '';
  }

  function render(next) {
    if (next) jobs = next;
    const tt = ctx.t();
    root.classList.toggle('is-empty', jobs.cards.length === 0);
    ctx.counts.replaceChildren(...countsView());
    ctx.cards.setAttribute('aria-label', nowLine(tt, jobs.counts).join(' · '));
    const focused = ctx.cards.contains(document.activeElement) ? document.activeElement.closest('[data-session]')?.dataset.session : null;
    const left = ctx.cards.scrollLeft;
    ctx.cards.replaceChildren(...jobs.cards.map(cardView));
    ctx.cards.scrollLeft = left;
    if (focused) ctx.cards.querySelector(`[data-session="${CSS.escape(focused)}"] button`)?.focus({ preventScroll: true });
    syncFold();
  }

  line.addEventListener('click', () => {
    if (!jobs.cards.length) return;
    if (ctx.phone.matches) setOpen(!isOpen());
    else {
      folded = !folded;
      store.set('sm.now.folded', folded ? '1' : '0');
    }
    syncFold();
  });
  ctx.phone.addEventListener('change', syncFold);
  // The alert cards sit below the strip, whatever its height.
  new ResizeObserver(() => document.documentElement.style.setProperty('--now-h', `${root.offsetHeight}px`)).observe(root);
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !root.contains(e.target)) {
      setOpen(false);
      syncFold();
    }
  });

  return {
    render,
    isOpen,
    close() {
      if (!isOpen()) return;
      setOpen(false);
      syncFold();
      line.focus({ preventScroll: true });
    },
  };
}
