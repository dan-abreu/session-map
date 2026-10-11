import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';
import { errorTextOf, langOf, pick } from './compassview.js';

// The Good practices screen (fd boas-praticas): the project's level on the N0-N4 ladder, how far the next step is, and every
// practice by area with one of the four states (in place, missing, not verified, does not apply). An open practice says what
// it is, why, how, when it is done, the evidence found and the source with its trust mark and date. Two actions: ask for help
// (opens a conversation with the request already written) and attest (the person confirms what no program can check).
// Everything shown comes from the server's practices.json; this file only sorts it and draws it. What it does not understand
// falls to "not verified", never to "in place" or "missing", and a missing file is "not read yet", never zero.
// The pure functions on top are tested on the --demo files; the view below draws them.
//
// ctx: h, t (translator function), icon(name, cls), project() ({ id }), tech (bool or getter), openChat({ node, text })
// (optional; without it the help button is not drawn), lang() (optional, as in compassview.js).

const RUNGS = ['N0', 'N1', 'N2', 'N3', 'N4'];
const FRONTS = ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance'];
const STATES = ['fail', 'unverified', 'pass', 'na'];
const FILTERS = ['all', ...STATES];
const REASONS = new Set(['no-data', 'needs-human', 'stale-source', 'attest-expired', 'no-token', 'no-network', 'tool-missing', 'not-applicable']);
const SEVERITIES = new Set(['E', 'R', 'A']);
const TRUST = new Set(['V', 'F', 'C', 'NV']);
const BUSINESS = new Set(['legal', 'finance']);
const VALID_DAYS = [30, 90, 180, 365];
const DEFAULT_DAYS = 90;
const MAX_NOTE = 300;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
const value = (x) => (typeof x === 'function' ? x() : x);
const dayOf = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? '') ? iso.slice(0, 10) : null);
const emptyCounts = () => ({ pass: 0, fail: 0, unverified: 0, na: 0 });

// ----- pure -----

// practices: practices.json (with the texts the route joined) or null. The level, whether it is provisional, the step ahead and
// how much of it is done. `next` is the step the person is working towards: the one after the level reached.
export function ladderHeader(practices) {
  const ladder = practices?.ladder;
  if (!isObject(ladder)) return null;
  const rung = RUNGS.indexOf(ladder.level);
  if (ladder.level !== null && rung < 0) return null;
  const provisional = ladder.provisional === true;
  const counts = emptyCounts();
  for (const it of list(practices.items)) if (isObject(it) && counts[it.state] !== undefined) counts[it.state]++;
  return {
    level: ladder.level,
    provisional,
    label: ladder.level === null ? null : `${ladder.level}${provisional ? '*' : ''}`,
    next: RUNGS[rung + 1] ?? null,
    nextPercent: Number.isInteger(ladder.nextPercent) && ladder.nextPercent >= 0 && ladder.nextPercent <= 100 ? ladder.nextPercent : null,
    counts,
    total: counts.pass + counts.fail + counts.unverified + counts.na,
  };
}

// The words for the reason a practice is not "in place" or "missing"; null when there is nothing to explain.
export function reasonKey({ state, reason } = {}) {
  if (state === 'na') return REASONS.has(reason) ? `guide.reason.${reason}` : 'guide.reason.not-applicable';
  if (state !== 'unverified') return null;
  return REASONS.has(reason) ? `guide.reason.${reason}` : 'guide.reason.unknown';
}

function sourceOf(source, checkedAt) {
  if (!isObject(source)) return null;
  const url = typeof source.url === 'string' && /^https:\/\/\S+$/.test(source.url) ? source.url : null;
  return { name: text(source.name), url, trust: TRUST.has(source.trust) ? source.trust : 'NV', checkedAt: checkedAt ?? null };
}

// One row per practice, in the language asked. A practice whose texts did not come from the library still shows, with its id as
// the title. dates: { "<package id>": "YYYY-MM-DD" } from the library, for the date of the source's check.
export function practiceRows(practices, lang = 'en', { dates = {} } = {}) {
  return list(practices?.items).filter((it) => isObject(it) && text(it.id)).map((it) => {
    const body = isObject(it.text) ? it.text : {};
    const state = STATES.includes(it.state) ? it.state : 'unverified';
    const attested = isObject(it.attested) && dayOf(it.attested.expiresAt) ? it.attested : null;
    return {
      id: it.id,
      pkg: text(it.pkg),
      front: text(it.front),
      ladder: RUNGS.includes(it.ladder) ? it.ladder : null,
      severity: SEVERITIES.has(it.severity) ? it.severity : null,
      state,
      reason: state === 'unverified' || state === 'na' ? text(it.reason) : null,
      evidence: list(it.evidence).filter((e) => isObject(e) && text(e.file)).map((e) => ({ file: e.file, line: Number.isInteger(e.line) && e.line > 0 ? e.line : 1 })),
      attested,
      title: pick(body.title, lang) ?? it.id,
      what: pick(body.what, lang),
      why: pick(body.why, lang),
      how: pick(body.how, lang),
      doneWhen: pick(body.doneWhen, lang),
      source: sourceOf(it.source, dayOf(dates?.[it.pkg])),
      standard: list(it.standard).filter((s) => typeof s === 'string'),
    };
  });
}

// By area, in a fixed order (unknown areas last, as "other"); inside, the lower rung first because that is the order of work,
// then what needs attention before what is in order. "Does not apply" is counted apart and is never a failure.
export function groupByFront(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = FRONTS.includes(r.front) ? r.front : 'other';
    if (!groups.has(key)) groups.set(key, { front: key, rows: [], counts: emptyCounts() });
    const g = groups.get(key);
    g.rows.push(r);
    g.counts[r.state]++;
  }
  const rung = (r) => (r.ladder ? RUNGS.indexOf(r.ladder) : RUNGS.length);
  const order = [...FRONTS, 'other'];
  return order.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k);
    g.rows = g.rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => rung(a) - rung(b) || STATES.indexOf(a.state) - STATES.indexOf(b.state) || i - j).map(([r]) => r);
    return g;
  });
}

// One state at a time, or all. A filter nobody knows shows everything, never nothing.
export function filterByState(rows, state) {
  return STATES.includes(state) ? rows.filter((r) => r.state === state) : rows;
}

// The practice as a request for the chat, in the language of the page. It asks for a plan first: nothing is changed unasked.
export function askText(row, t) {
  const line = (key, body) => (body ? `${t(key)}: ${body}` : null);
  return [
    `${t('prac.ask.intro')}: "${row.title}".`,
    line('prac.ask.what', row.what), line('prac.ask.why', row.why), line('prac.ask.how', row.how), line('prac.ask.done', row.doneWhen),
    t('prac.ask.plan'),
  ].filter(Boolean).join('\n');
}

// ----- the view -----

export function createPracticesView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const state = { practices: undefined, error: null, dates: {}, filter: 'all', open: new Set(), attest: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load({ withLibrary = false } = {}) {
    const mine = ++run;
    const id = ctx.project().id;
    const [res, lib] = await Promise.all([api.fd(id, 'practices'), withLibrary ? api.fd(null, 'library', { project: id }) : null]);
    if (mine !== run) return;
    if (lib?.ok && isObject(lib.data)) state.dates = Object.fromEntries(list(lib.data.packages).filter((p) => isObject(p) && text(p.id) && dayOf(p.checkedAt)).map((p) => [p.id, dayOf(p.checkedAt)]));
    if (!res.ok) {
      state.error = res.error;
      state.practices ??= null;
    } else {
      state.error = null;
      state.practices = res.data ?? null;
    }
    draw();
  }

  const frontName = (front) => (FRONTS.includes(front) ? t(`rota.front.${front}`) : t('prac.front.other'));
  const seal = (s) => badgeNode(h, t, stateBadge(s));
  const countsText = (c) => [t('prac.counts', { pass: c.pass, fail: c.fail, unverified: c.unverified }), c.na ? t('prac.counts.na', { na: c.na }) : null].filter(Boolean).join(' · ');

  // ----- the level -----

  function headSection(head) {
    const level = head.label
      ? [t('prac.level'), ' ', h('strong', { class: 'fdp-level-n num' }, head.label)]
      : [t('prac.level.none')];
    let ahead = null;
    if (head.next === null) ahead = t('prac.level.top');
    else if (head.nextPercent !== null) ahead = t('prac.level.next', { percent: head.nextPercent, next: head.next });
    return h('section', { class: 'fdp-head', 'aria-label': t('prac.level.label') },
      h('p', { class: 'fdp-level' }, level, ahead ? [' · ', h('span', { class: 'fdp-ahead' }, ahead)] : null),
      head.next !== null && head.nextPercent !== null
        ? h('progress', { class: 'fdp-bar', value: head.nextPercent, max: 100, 'aria-label': t('prac.level.next', { percent: head.nextPercent, next: head.next }) })
        : null,
      head.provisional ? h('p', { class: 'fdp-note' }, t('prac.level.provisional')) : null);
  }

  // ----- the filter -----

  function filterBar(rows) {
    const total = { all: rows.length, ...emptyCounts() };
    for (const r of rows) total[r.state]++;
    return h('div', { class: 'fdp-filters', role: 'group', 'aria-label': t('prac.filter.label') }, FILTERS.map((f) => {
      const on = state.filter === f;
      return h('button', {
        type: 'button', class: `btn small-btn fdp-filter${on ? ' is-on' : ''}`, 'data-state': f, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => { state.filter = f; draw(); },
      }, t(`prac.filter.${f}`), ' ', h('span', { class: 'num' }, String(total[f])));
    }));
  }

  // ----- attest -----

  async function saveAttest(row) {
    const a = state.attest;
    if (!a || a.id !== row.id || a.saving) return;
    a.saving = true;
    a.error = null;
    draw();
    const res = await api.fdWrite(ctx.project().id, `practice/${row.id}`, { action: 'attest', note: a.note.trim(), days: a.days }, 'POST');
    if (!res.ok) {
      a.saving = false;
      a.error = errorTextOf(ctx, res.error);
      draw();
      return;
    }
    state.attest = null;
    if (isObject(res.data) && Array.isArray(res.data.items)) {
      state.practices = res.data;
      state.error = null;
      draw();
    } else await load();
  }

  function attestForm(row) {
    const a = state.attest;
    const field = (label, control) => h('label', { class: 'fdp-field' }, h('span', { class: 'fdp-field-label' }, label), control);
    return h('form', { class: 'fdp-attest', onsubmit: (e) => { e.preventDefault?.(); saveAttest(row); } },
      h('p', { class: 'fdp-attest-hint' }, t('prac.attest.hint')),
      field(t('prac.attest.note'), h('textarea', {
        class: 'fdp-note-input', rows: '3', maxlength: String(MAX_NOTE), value: a.note, placeholder: t('prac.attest.note.hint'),
        oninput: (e) => { a.note = e.target.value; },
      })),
      field(t('prac.attest.days'), h('select', { class: 'fdp-days', onchange: (e) => { a.days = Number(e.target.value); } },
        VALID_DAYS.map((d) => h('option', { value: String(d), selected: d === a.days ? true : null }, t('prac.attest.days.n', { n: d }))))),
      a.error ? h('p', { class: 'fdg-error', role: 'alert' }, a.error) : null,
      h('div', { class: 'fdg-actions' },
        h('button', { type: 'button', class: 'btn primary small-btn fdp-save', disabled: a.saving, onclick: () => saveAttest(row) }, t(a.saving ? 'prac.attest.saving' : 'prac.attest.save')),
        h('button', { type: 'button', class: 'btn small-btn', disabled: a.saving, onclick: () => { state.attest = null; draw(); } }, t('prac.attest.cancel'))));
  }

  // ----- one practice -----

  function reasonLine(row) {
    if (row.state === 'pass' && row.attested) return t('prac.attested.until', { date: dayOf(row.attested.expiresAt) });
    const key = reasonKey(row);
    return key ? t(key) : null;
  }

  function sourceEl(src) {
    const name = src.name ?? t('prac.source.unnamed');
    return h('span', { class: 'fdp-source' },
      src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, name) : name,
      ' ', h('span', { class: `fdp-trust is-${src.trust.toLowerCase()}`, title: t(`prac.trust.${src.trust}.hint`) }, t(`prac.trust.${src.trust}`)),
      src.checkedAt ? [' · ', h('span', { class: 'num' }, t('prac.source.checked', { date: src.checkedAt }))] : null);
  }

  function itemEl(row) {
    const fact = (key, body) => (body ? [h('dt', {}, typeof key === 'string' ? t(key) : key), h('dd', {}, body)] : null);
    const tech = value(ctx.tech);
    const reason = reasonLine(row);
    const attesting = state.attest?.id === row.id;
    const canAsk = ctx.openChat && (row.state === 'fail' || row.state === 'unverified');
    return h('details', {
      class: `fdp-item is-${row.state}`, 'data-item': row.id, open: state.open.has(row.id) || attesting ? true : null,
      ontoggle: (e) => { if (e.target.open) state.open.add(row.id); else state.open.delete(row.id); },
    },
    h('summary', { class: 'fdp-sum' },
      seal(row.state),
      h('span', { class: 'fdp-title' }, row.title),
      row.ladder ? h('span', { class: 'fdp-chip num', title: t('prac.rung.hint') }, row.ladder) : null,
      row.severity ? h('span', { class: 'fdp-chip', title: t('prac.sev.hint') }, t(`prac.sev.${row.severity}`)) : null,
      reason ? h('span', { class: 'fdp-reason' }, reason) : null),
    h('div', { class: 'fdp-body' },
      row.what ? h('p', { class: 'fdg-card-what' }, row.what) : null,
      h('dl', { class: 'fdg-facts' },
        fact('rota.card.why', row.why), fact('rota.card.how', row.how), fact('rota.card.done', row.doneWhen),
        fact('prac.fact.evidence', row.evidence.length ? h('span', { class: 'fdp-evidence' }, row.evidence.map((e) => h('code', { class: 'num' }, `${e.file}:${e.line}`))) : null),
        fact('prac.fact.source', row.source ? sourceEl(row.source) : null),
        tech ? fact('prac.fact.id', h('code', {}, [row.id, row.pkg ? ` · ${row.pkg}` : '', row.standard.length ? ` · ${row.standard.join(', ')}` : ''].join(''))) : null),
      attesting ? attestForm(row) : null,
      h('div', { class: 'fdg-actions' },
        canAsk ? h('button', {
          type: 'button', class: 'btn small-btn fdp-help', title: t('rota.card.help.hint'),
          onclick: () => ctx.openChat({ node: { kind: 'project' }, text: askText(row, t) }),
        }, ctx.icon ? ctx.icon('chat', 'btn-icon') : null, t('rota.card.help')) : null,
        row.state === 'unverified' && !attesting ? h('button', {
          type: 'button', class: 'btn small-btn fdp-attest-btn', title: t('prac.attest.hint'),
          onclick: () => { state.attest = { id: row.id, note: '', days: DEFAULT_DAYS, saving: false, error: null }; state.open.add(row.id); draw(); },
        }, ctx.icon ? ctx.icon('check', 'btn-icon') : null, t('prac.attest')) : null)));
  }

  function frontSection(g) {
    return h('section', { class: 'fdp-front', 'data-front': g.front, 'aria-label': frontName(g.front) },
      h('h3', { class: 'fdp-front-head' }, h('span', { class: 'fdp-front-name' }, frontName(g.front)), h('span', { class: 'fdp-counts num' }, countsText(g.counts))),
      h('div', { class: 'fdp-list' }, g.rows.map(itemEl)));
  }

  function noticeEl(rows) {
    if (!rows.some((r) => BUSINESS.has(r.front) && r.state !== 'na')) return null;
    return h('div', { class: 'fdg-notice', role: 'note' }, h('p', {}, t('rota.notice')));
  }

  function body() {
    if (state.practices === undefined) return [h('p', { class: 'view-note' }, t('prac.loading'))];
    if (state.error && !state.practices) {
      return [h('p', { class: 'view-note fdg-failed', role: 'alert' }, errorTextOf(ctx, state.error)),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => load({ withLibrary: true }) }, t('rota.retry'))];
    }
    if (state.practices === null) return [emptyState({ h, icon: ctx.icon }, { art: 'check', title: t('prac.notRead.title'), text: t('prac.notRead.text') })];
    const rows = practiceRows(state.practices, langOf(ctx), { dates: state.dates });
    if (!rows.length) return [h('p', { class: 'view-note' }, t('prac.empty'))];
    const head = ladderHeader(state.practices);
    const shown = filterByState(rows, state.filter);
    const groups = groupByFront(shown);
    return [
      head ? headSection(head) : null,
      noticeEl(rows),
      filterBar(rows),
      groups.length ? groups.map(frontSection) : h('p', { class: 'view-note' }, t('prac.filter.none')),
    ];
  }

  function draw() {
    if (!els) return;
    els.body.replaceChildren(...body().flat().filter(Boolean));
  }

  function build(root) {
    els = { body: h('div', { class: 'fdg-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdg-view fdp-view' },
      h('div', { class: 'view-head' }, h('h2', {}, t('prac.title'))),
      h('p', { class: 'view-lede' }, t('prac.lede')),
      els.body));
  }

  return {
    render(root) {
      state.attest = null;
      build(root);
      draw();
      return load({ withLibrary: true });
    },
    // A poll must not wipe a note that is being typed.
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      if (state.attest) return undefined;
      return load();
    },
  };
}
