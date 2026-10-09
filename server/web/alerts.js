// Alerts (watcher-and-alerts wa02, wa05): the words and the grouping the page and the server's own desktop and phone
// alerts share. The pure part on top is what node:test and the server load; the DOM part only runs when the page calls it.
import { foldReply } from './chatfold.js';

const SUMMARY_MAX = 200;

// The reply's own words on one line, without the blocks the chat folds away, cut at a whole word.
export function summaryOf(reply) {
  const text = foldReply(reply).text.replace(/\s+/g, ' ').trim();
  if (text.length <= SUMMARY_MAX) return text;
  return `${text.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, '')}…`;
}

// Alerts of the same kind in the same project collapse into one ("3 jobs finished in shop"), in the order they came.
export function groupAlerts(alerts) {
  const groups = new Map();
  for (const a of alerts) {
    const key = `${a.kind}|${a.projectId}`;
    if (!groups.has(key)) groups.set(key, { kind: a.kind, projectId: a.projectId, projectName: a.projectName, alerts: [] });
    groups.get(key).alerts.push(a);
  }
  return [...groups.values()];
}

// Every project and every kind is on until the person turns it off.
export const wantsAlert = (prefs, alert) => prefs?.perProject?.[alert.projectId]?.[alert.kind] !== false;

const LIST_MAX = 3;

// The words of a group: what it is, why, what to do now, and the button; title and body for a notification.
// content false (the phone, through an outside service): the project and the situation only.
export function alertText(t, group, { content = true } = {}) {
  const [first] = group.alerts;
  const many = group.alerts.length > 1;
  const vars = { tool: first.tool ?? '', a: first.branches?.[0] ?? '', b: first.branches?.[1] ?? '', files: (first.files ?? []).join(', ') };
  const what = many ? t(`alert.many.${group.kind}`, { n: group.alerts.length }) : t(`alert.what.${first.reason}`);
  const why = many ? t('alert.why.many') : t(`alert.why.${first.reason}`, vars);
  const todo = many ? t('alert.do.many') : t(`alert.do.${first.reason}`);
  const action = group.kind === 'clash' ? t('alert.openMap') : t('alert.open');
  if (!content) return { what, why, todo, action, title: `session-map · ${group.projectName}`, body: what };
  const named = (a) => a.title || t('chat.untitled');
  const where = !many && first.origin ? ` · ${t(`convs.origin.${first.origin}`)}` : '';
  let body;
  if (many) body = group.alerts.slice(0, LIST_MAX).map(named).join(' · ') + (group.alerts.length > LIST_MAX ? ' …' : '');
  else body = first.sessionId ? `${named(first)} — ${first.summary || why}` : why;
  return { what, why, todo, action, title: `${what} · ${group.projectName}${where}`, body };
}

export const tabTitle = (base, unseen) => (unseen > 0 ? `(${unseen}) ${base}` : base);

// ---- the page: cards, browser notifications, sound, tab title and the settings dialog -----------------------------

const POLL_MS = 5000;
const CARD_MS = 14_000;
const CARDS_MAX = 3;
// A page opened on a server it has not seen yet shows only what happened in the last minutes.
const FRESH_MS = 10 * 60_000;
const SEEN_KEY = 'sm.alerts.seen';
const KINDS = ['finished', 'waiting', 'error', 'clash'];
const TONE = { finished: 'active', waiting: 'waiting', error: 'clash', clash: 'clash' };
const DEFAULTS = { browser: true, desktop: true, sound: false, ntfy: { enabled: false, topic: null }, perProject: {} };
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

// ctx: stack (the cards' list), bell (toolbar button), dialog, h, t (translator getter), lang(), icon(name, cls), api,
// store, toast, errorText, projects() → [{id, name}], onOpen(group), onAlerts(alerts) (something changed: refresh the state),
// pending() (what still needs the person: waiting for them plus finished and not seen, mm10).
export function createAlerts(ctx) {
  const { stack, dialog, h, api, store } = ctx;
  const baseTitle = document.title;
  const onThisPc = LOOPBACK.test(location.hostname);
  let prefs = null;
  let canEdit = false;
  let desktopAvailable = true;
  let boot = null;
  let since = 0;
  let unseen = 0;
  let audio = null;

  const readSeen = () => { try { return JSON.parse(store.get(SEEN_KEY) ?? 'null'); } catch { return null; } };
  const current = () => prefs ?? DEFAULTS;

  // Never fewer than what still needs the person, even with the page in front of them: "(2) session-map".
  function renderTitle() { document.title = tabTitle(baseTitle, Math.max(unseen, ctx.pending?.() ?? 0)); }

  function beep() {
    if (!current().sound) return;
    try {
      audio ??= new AudioContext();
      const at = audio.currentTime;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(880, at);
      tone.frequency.exponentialRampToValueAtTime(620, at + 0.2);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.34);
    } catch { /* no sound on this browser */ }
  }

  // The PC already shows its own desktop alert: the browser's is for another device, or when that one is off.
  function notify(groups) {
    const p = current();
    if (!document.hidden || !p.browser || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (p.desktop && desktopAvailable && onThisPc) return;
    const tt = ctx.t();
    for (const g of groups) {
      const words = alertText(tt, g);
      try {
        const n = new Notification(words.title, { body: words.body, tag: `sm-${boot}-${g.alerts[0].id}` });
        n.onclick = () => { window.focus(); n.close(); ctx.onOpen(g); };
      } catch { /* the browser refused this one */ }
    }
  }

  function dismiss(el) {
    clearTimeout(el.timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  }

  function arm(el) {
    clearTimeout(el.timer);
    el.timer = setTimeout(() => dismiss(el), CARD_MS);
  }

  function card(g) {
    const tt = ctx.t();
    const words = alertText(tt, g);
    const test = g.alerts[0].reason === 'test';
    const el = h('li', { class: `al-card tone-${TONE[g.kind] ?? 'active'}`, role: 'group', 'aria-label': words.title },
      h('span', { class: 'al-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'al-text' },
        h('p', { class: 'al-title' }, words.title),
        h('p', { class: 'al-body' }, words.body),
        h('p', { class: 'al-todo' }, words.todo),
        test ? null : h('div', { class: 'al-actions' },
          h('button', { type: 'button', class: 'btn small-btn primary', onclick: () => { dismiss(el); ctx.onOpen(g); } }, words.action))),
      h('button', { type: 'button', class: 'al-close', 'aria-label': tt('panel.close'), title: tt('panel.close'), onclick: () => dismiss(el) }, ctx.icon('close', 'al-close-icon')));
    // Reading it holds it on the screen.
    el.addEventListener('mouseenter', () => clearTimeout(el.timer));
    el.addEventListener('mouseleave', () => arm(el));
    el.addEventListener('focusin', () => clearTimeout(el.timer));
    el.addEventListener('focusout', () => { if (!el.contains(document.activeElement)) arm(el); });
    arm(el);
    return el;
  }

  function announce(alerts) {
    const groups = groupAlerts(alerts);
    for (const g of groups) stack.prepend(card(g));
    for (const extra of [...stack.children].slice(CARDS_MAX)) extra.remove();
    if (document.hidden) {
      unseen += groups.length;
      renderTitle();
    }
    notify(groups);
    beep();
    ctx.onAlerts?.(alerts);
  }

  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const res = await api.alerts(boot ? since : 0);
      if (!res.ok || !Array.isArray(res.alerts)) return;
      // The server restarted while the page was open: its ids start over.
      if (boot && res.boot !== boot) { boot = null; since = 0; polling = false; await poll(); return; }
      let fresh = res.alerts;
      if (!boot) {
        const seen = readSeen();
        fresh = seen?.boot === res.boot ? fresh.filter((a) => a.id > seen.id) : fresh.filter((a) => Date.now() - Date.parse(a.ts) <= FRESH_MS);
      }
      boot = res.boot;
      since = res.lastId;
      store.set(SEEN_KEY, JSON.stringify({ boot, id: since }));
      if (fresh.length) announce(fresh);
    } finally {
      polling = false;
    }
  }

  async function loadPrefs() {
    const res = await api.notifyPrefs();
    canEdit = res.ok;
    if (res.ok) {
      prefs = res.notify;
      desktopAvailable = res.desktopAvailable !== false;
      if (prefs.lang !== ctx.lang()) save({ lang: ctx.lang() }, { quiet: true });
    }
  }

  async function save(patch, { quiet = false } = {}) {
    if (!canEdit) return;
    const res = await api.setNotify(patch);
    if (!res.ok) {
      if (!quiet) ctx.toast(ctx.errorText(res.error));
      return;
    }
    prefs = res.notify;
    if (!quiet && dialog.open) renderDialog();
  }

  // ---- the settings dialog ----

  function check({ id, title, hint, checked, disabled, onchange, extra }) {
    return h('div', { class: 'al-opt' },
      h('input', { type: 'checkbox', id, checked, disabled: disabled || !canEdit, onchange: (e) => onchange(e.target.checked) }),
      h('label', { for: id }, h('span', { class: 'al-opt-name' }, title), h('span', { class: 'al-opt-hint' }, hint)),
      extra ?? null);
  }

  function permissionLine(tt) {
    if (typeof Notification === 'undefined') return h('p', { class: 'al-perm' }, tt('notify.perm.none'));
    const state = Notification.permission;
    const ask = async () => { await Notification.requestPermission(); renderDialog(); };
    return h('p', { class: `al-perm is-${state}` }, tt(`notify.perm.${state}`),
      state === 'default' ? h('button', { type: 'button', class: 'btn small-btn', onclick: ask }, tt('notify.perm.ask')) : null);
  }

  function projectTable(tt, p) {
    const list = ctx.projects();
    if (!list.length) return h('p', { class: 'al-opt-hint' }, tt('notify.noProjects'));
    return h('div', { class: 'al-table-wrap' }, h('table', { class: 'al-table' },
      h('caption', { class: 'visually-hidden' }, tt('notify.perProject')),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, tt('notify.project')), KINDS.map((k) => h('th', { scope: 'col' }, tt(`notify.kind.${k}`))))),
      h('tbody', {}, list.map((proj) => h('tr', {},
        h('th', { scope: 'row' }, proj.name),
        KINDS.map((k) => h('td', {}, h('input', {
          type: 'checkbox', checked: p.perProject?.[proj.id]?.[k] !== false, disabled: !canEdit,
          'aria-label': `${proj.name}: ${tt(`notify.kind.${k}`)}`,
          onchange: (e) => save({ perProject: { [proj.id]: { [k]: e.target.checked } } }),
        }))))))));
  }

  function ntfyPart(tt, p) {
    const topic = p.ntfy?.topic;
    const copy = async () => {
      try { await navigator.clipboard.writeText(topic); ctx.toast(tt('notify.ntfy.copied')); } catch { ctx.toast(tt('notify.ntfy.copyFailed')); }
    };
    return [
      check({
        id: 'alNtfy', title: tt('notify.ntfy.title'), hint: tt('notify.ntfy.hint'), checked: Boolean(p.ntfy?.enabled),
        onchange: (on) => save({ ntfy: { enabled: on } }),
      }),
      p.ntfy?.enabled && topic ? h('div', { class: 'al-topic' },
        h('p', {}, tt('notify.ntfy.how')),
        h('div', { class: 'al-topic-row' }, h('code', {}, topic),
          h('button', { type: 'button', class: 'btn small-btn', onclick: copy }, ctx.icon('copy', 'btn-icon'), tt('notify.ntfy.copy')))) : null,
    ];
  }

  function renderDialog() {
    const tt = ctx.t();
    const p = current();
    const test = async () => {
      const res = await api.notifyTest();
      ctx.toast(res.ok ? tt('notify.testSent') : ctx.errorText(res.error));
    };
    dialog.replaceChildren(...[
      h('h2', { id: 'alertsTitle' }, tt('notify.title')),
      h('p', { class: 'al-lede' }, tt('notify.lede')),
      canEdit ? null : h('p', { class: 'dv-warning' }, tt('notify.needKey')),
      h('section', { class: 'al-section', 'aria-labelledby': 'alHow' },
        h('h3', { id: 'alHow' }, tt('notify.how')),
        check({ id: 'alDesktop', title: tt('notify.desktop'), hint: tt(desktopAvailable ? 'notify.desktopHint' : 'notify.desktopNone'), checked: p.desktop && desktopAvailable, disabled: !desktopAvailable, onchange: (on) => save({ desktop: on }) }),
        check({
          id: 'alBrowser', title: tt('notify.browser'), hint: tt('notify.browserHint'), checked: p.browser, extra: p.browser ? permissionLine(tt) : null,
          onchange: async (on) => {
            if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
            save({ browser: on });
          },
        }),
        check({ id: 'alSound', title: tt('notify.sound'), hint: tt('notify.soundHint'), checked: p.sound, onchange: (on) => { save({ sound: on }); if (on) { prefs = { ...current(), sound: true }; beep(); } } })),
      h('section', { class: 'al-section', 'aria-labelledby': 'alPhone' }, h('h3', { id: 'alPhone' }, tt('notify.phone')), ...ntfyPart(tt, p)),
      h('section', { class: 'al-section', 'aria-labelledby': 'alProjects' },
        h('h3', { id: 'alProjects' }, tt('notify.perProject')),
        h('p', { class: 'al-opt-hint' }, tt('notify.perProjectHint')),
        projectTable(tt, p)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', disabled: !canEdit, onclick: test }, tt('notify.test')),
        h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, tt('notify.close'))),
    ].filter(Boolean));
  }

  async function openSettings() {
    await loadPrefs();
    renderDialog();
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    unseen = 0;
    renderTitle();
  });
  // A browser plays sound only after the person touched the page once.
  document.addEventListener('pointerdown', () => { audio?.resume?.(); }, { passive: true });
  ctx.bell.addEventListener('click', openSettings);

  return {
    start() {
      loadPrefs();
      poll();
      setInterval(poll, POLL_MS);
    },
    relabel() { if (dialog.open) renderDialog(); if (canEdit) save({ lang: ctx.lang() }, { quiet: true }); },
    isOpen: () => dialog.open,
    openSettings,
    refreshTitle: renderTitle,
  };
}
