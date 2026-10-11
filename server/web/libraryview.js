import { api } from './api.js';
import { emptyState } from './empty.js';
import { errorTextOf, langOf, pick } from './compassview.js';

// The Library screen (fd biblioteca): the guides that apply to this project (title, kind, state, date of the last check and
// the fixed notice), the guides that are missing ("Research" opens a conversation that writes one), the ones that are out of
// date ("Recheck" opens a conversation that renews them) and the files that could not be read. Everything comes from
// GET /api/library; the program decides what applies and what is old, this file only draws it. An unknown state is shown as
// "recheck", never as confirmed. The pure function on top is tested on the route's own answer.
//
// ctx: h, t (translator function), icon(name, cls), project() ({ id }), openChat({ node, text }) (optional; without it the
// Research and Recheck buttons are not drawn), lang() (optional, as in compassview.js).

const STATUSES = new Set(['confirmed', 'recheck', 'stale-source']);
const KINDS = new Set(['general', 'stack', 'type', 'legal', 'finance', 'marketing', 'sales']);
const BUSINESS = new Set(['legal', 'finance']);

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const dayOf = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? '') ? iso.slice(0, 10) : null);
const days = (n) => (Number.isInteger(n) && n >= 0 ? n : null);

// ----- pure -----

// library: the answer of GET /api/library or null. A gap or a stale entry with no request cannot open a conversation, so it is
// left out; a package with an unknown state is "recheck".
export function libraryRows(library, lang = 'en') {
  if (!isObject(library)) return null;
  const packages = list(library.packages).filter((p) => isObject(p) && text(p.id)).map((p) => ({
    id: p.id,
    kind: KINDS.has(p.kind) ? p.kind : 'general',
    title: pick(p.title, lang) ?? p.id,
    status: STATUSES.has(p.status) ? p.status : 'recheck',
    checkedAt: dayOf(p.checkedAt),
    disclaimer: pick(p.disclaimer, lang),
    itemCount: Number.isInteger(p.itemCount) && p.itemCount > 0 ? p.itemCount : 0,
    local: p.source === 'local',
  }));
  const titles = new Map(packages.map((p) => [p.id, p.title]));
  const requestOf = (x) => text(x?.request?.text);
  return {
    packages,
    gaps: list(library.gaps).filter((g) => isObject(g) && text(g.name) && requestOf(g)).map((g) => ({ kind: g.kind === 'type' ? 'type' : 'stack', name: g.name, ask: requestOf(g) })),
    stale: list(library.stale).filter((s) => isObject(s) && text(s.id) && requestOf(s)).map((s) => ({ id: s.id, title: titles.get(s.id) ?? s.id, daysOld: days(s.daysOld), ask: requestOf(s) })),
    invalid: list(library.invalid).filter((i) => isObject(i) && text(i.file)).map((i) => ({ file: i.file, error: text(i.error) ?? '' })),
  };
}

// ----- the view -----

export function createLibraryView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const state = { library: undefined, error: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load() {
    const mine = ++run;
    const res = await api.fd(null, 'library', { project: ctx.project().id });
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.library ??= null;
    } else {
      state.error = null;
      state.library = res.data ?? null;
    }
    draw();
  }

  const ask = (label, hint, req) => (ctx.openChat
    ? h('button', {
      type: 'button', class: 'btn small-btn fdl-ask', title: t(hint),
      onclick: () => ctx.openChat({ node: { kind: 'project' }, text: req }),
    }, ctx.icon ? ctx.icon('chat', 'btn-icon') : null, t(label))
    : null);

  function packageEl(p) {
    const notice = p.disclaimer ?? (BUSINESS.has(p.kind) ? t('lib.notice') : null);
    return h('li', { class: `fdl-pkg is-${p.status}`, 'data-pkg': p.id },
      h('div', { class: 'fdl-pkg-head' },
        h('span', { class: 'fdl-pkg-title' }, p.title),
        h('span', { class: 'fdp-chip' }, t(`lib.kind.${p.kind}`)),
        p.local ? h('span', { class: 'fdp-chip', title: t('lib.local.hint') }, t('lib.local')) : null,
        h('span', { class: 'fdl-status' }, h('span', { class: 'fdl-dot', 'aria-hidden': 'true' }), t(`lib.status.${p.status}`))),
      h('p', { class: 'fdl-pkg-meta num' },
        p.checkedAt ? t('lib.checked', { date: p.checkedAt }) : t('lib.checked.none'),
        p.itemCount ? ` · ${t('lib.items', { n: p.itemCount })}` : null),
      notice ? h('p', { class: 'fdl-notice', role: 'note' }, notice) : null);
  }

  function section(key, items, render, extra = null) {
    if (!items.length) return null;
    return h('section', { class: 'fdg-section', 'aria-label': t(`lib.${key}.title`) },
      h('h3', { class: 'fdg-section-title' }, t(`lib.${key}.title`)),
      h('p', { class: 'fdg-note' }, t(`lib.${key}.lede`)),
      extra,
      h('ul', { class: 'fdl-list' }, items.map(render)));
  }

  const gapEl = (g) => h('li', { class: 'fdl-gap', 'data-name': g.name },
    h('span', { class: 'fdl-row-text' }, t(`lib.gap.${g.kind}`, { name: g.name })),
    ask('lib.research', 'lib.research.hint', g.ask));
  const staleEl = (s) => h('li', { class: 'fdl-stale', 'data-pkg': s.id },
    h('span', { class: 'fdl-row-text' }, s.title, s.daysOld === null ? null : [' · ', h('span', { class: 'num' }, t('lib.stale.age', { n: s.daysOld }))]),
    ask('lib.recheck', 'lib.recheck.hint', s.ask));
  const invalidEl = (i) => h('li', { class: 'fdl-invalid' },
    h('code', {}, i.file), i.error ? [' ', h('span', { class: 'fdl-row-text' }, i.error)] : null);

  function body() {
    if (state.library === undefined) return [h('p', { class: 'view-note' }, t('lib.loading'))];
    if (state.error && !state.library) {
      return [h('p', { class: 'view-note fdg-failed', role: 'alert' }, errorTextOf(ctx, state.error)),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => load() }, t('rota.retry'))];
    }
    if (state.library === null) return [emptyState({ h, icon: ctx.icon }, { art: 'book', title: t('lib.notRead.title'), text: t('lib.notRead.text') })];
    const rows = libraryRows(state.library, langOf(ctx));
    if (!rows.packages.length && !rows.gaps.length && !rows.stale.length && !rows.invalid.length) {
      return [emptyState({ h, icon: ctx.icon }, { art: 'book', title: t('lib.empty.title'), text: t('lib.empty.text') })];
    }
    return [
      section('packages', rows.packages, packageEl),
      section('gaps', rows.gaps, gapEl, ctx.openChat ? h('p', { class: 'fdg-note' }, t('lib.research.note')) : null),
      section('stale', rows.stale, staleEl),
      section('invalid', rows.invalid, invalidEl),
    ];
  }

  function draw() {
    if (!els) return;
    els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    els = { body: h('div', { class: 'fdg-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdg-view fdl-view' },
      h('div', { class: 'view-head' }, h('h2', {}, t('lib.title'))),
      h('p', { class: 'view-lede' }, t('lib.lede')),
      els.body));
  }

  return {
    render(root) {
      build(root);
      draw();
      return load();
    },
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      return load();
    },
  };
}
