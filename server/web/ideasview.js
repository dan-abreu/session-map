import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';
import { errorTextOf } from './compassview.js';
import { reasonKey } from './practicesview.js';

// The Ideas screen (fd15, the professional standard applied): the person writes an idea in plain words, the program guesses
// its size and the sensitive kinds it touches (money, login, personal data...), and the person can change the guess. Then
// the 14 stages of the standard that apply to that idea, the ones left out with the reason, and every check with one of the
// four states, the evidence or the reason, and an Attest button for what only a person can confirm. "Mark as ready" is off
// while an essential check fails, and asks for an explicit yes when the essentials are only "not verified" (the idea then
// stays provisional). Everything shown comes from the route (GET ideas); this file only sorts it and draws it.
//
// ctx: h, t (translator function), icon(name, cls), project() ({ id }), tech (bool or getter).

const SIZES = ['trivial', 'small', 'medium', 'large'];
const KINDS = ['security', 'auth', 'personal-data', 'money', 'production', 'publish', 'delete'];
const STATES = ['pass', 'fail', 'unverified', 'na'];
const SEVERITIES = ['E', 'R', 'A'];
const LEGAL_STAGES = ['12', '13'];
const VALID_DAYS = [30, 90, 180, 365];
const DEFAULT_DAYS = 90;
const MAX_NOTE = 300;
const MAX_TEXT = 2000;
// The reasons the standard gives (standard.mjs stagesFor), each with its own words; an unknown one falls to the general line.
const REASON_KEYS = {
  'std.reason.outOfSize': 'fdi.reason.outOfSize',
  'std.reason.size': 'fdi.reason.size',
  'std.reason.sensitive': 'fdi.reason.sensitive',
  'std.reason.profile': 'fdi.reason.profile',
};
const WHY = ['no-screen', 'no-running-service', 'personal-project'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const value = (x) => (typeof x === 'function' ? x() : x);
const emptyCounts = () => ({ pass: 0, fail: 0, unverified: 0, na: 0 });
const stateOf = (s) => (STATES.includes(s) ? s : 'unverified');

// ----- pure -----

// What stops "Mark as ready", the same rule as canMarkDone in the server (ideas.mjs): an essential check that failed always
// blocks; an essential one nobody verified blocks until the person accepted it.
export function doneBlockers(idea) {
  const checks = list(idea?.checks).filter(isObject);
  const accepted = new Set(list(idea?.acceptedUnverified));
  const failed = checks.filter((c) => c.state === 'fail' && c.severity === 'E').map((c) => c.id);
  const unverified = checks.filter((c) => c.state === 'unverified' && c.severity === 'E' && !accepted.has(c.id)).map((c) => c.id);
  return { ok: !failed.length && !unverified.length, failed, unverified };
}

// The idea in a few facts: size and kinds (with who decided them) and the level, counted from the checks. "Not verified" never
// counts as a failure: it makes the level provisional.
export function ideaSummary(idea) {
  if (!isObject(idea)) return null;
  const counts = emptyCounts();
  const checks = list(idea.checks).filter(isObject);
  for (const c of checks) counts[stateOf(c.state)]++;
  const essentialFail = checks.some((c) => c.state === 'fail' && c.severity === 'E');
  let level = 'complete';
  if (essentialFail) level = 'blocked';
  else if (counts.fail) level = 'open';
  else if (counts.unverified) level = 'provisional';
  const counted = counts.pass + counts.fail + counts.unverified;
  return {
    id: idea.id,
    text: text(idea.text) ?? '',
    size: SIZES.includes(idea.size) ? idea.size : 'small',
    sensitive: KINDS.filter((k) => list(idea.sensitive).includes(k)),
    sizeFrom: idea.origin?.size === 'owner' ? 'owner' : 'guessed',
    kindsFrom: idea.origin?.sensitive === 'owner' ? 'owner' : 'guessed',
    done: idea.status === 'done',
    level,
    provisional: counts.unverified > 0,
    percent: counted ? Math.floor((counts.pass * 100) / counted) : 100,
    counts,
  };
}

// The 14 stages as the route answers them: the ones that apply and the ones left out, each with the key of its reason.
export function stageRows(idea) {
  const applied = [];
  const hidden = [];
  for (const s of list(idea?.stages)) {
    if (!isObject(s) || !text(s.stage)) continue;
    const msg = isObject(s.reason) ? s.reason.msg : null;
    const row = { stage: s.stage, reason: { key: REASON_KEYS[msg] ?? 'fdi.reason.general', params: isObject(s.reason?.params) ? s.reason.params : {} } };
    (s.applies ? applied : hidden).push(row);
  }
  return { applied, hidden };
}

// One row per check: by stage, essential first, "does not apply" last in its stage. An unknown state is "not verified".
export function checkRows(idea) {
  const rows = list(idea?.checks).filter((c) => isObject(c) && text(c.id)).map((c, i) => ({
    i,
    id: c.id,
    stage: text(c.stage) ?? c.id.split('.')[0],
    severity: SEVERITIES.includes(c.severity) ? c.severity : null,
    state: stateOf(c.state),
    reason: text(c.reason),
    evidence: list(c.evidence).filter((e) => isObject(e) && text(e.file)).map((e) => ({ file: e.file, line: Number.isInteger(e.line) && e.line > 0 ? e.line : 1 })),
    attest: isObject(c.attest) ? c.attest : null,
    title: text(c.text) ?? c.id,
  }));
  const sev = (r) => (r.severity ? SEVERITIES.indexOf(r.severity) : SEVERITIES.length);
  return rows
    .sort((a, b) => a.stage.localeCompare(b.stage) || (a.state === 'na') - (b.state === 'na') || sev(a) - sev(b) || a.i - b.i)
    .map(({ i, ...r }) => r);
}

// ----- the view -----

export function createIdeasView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const state = {
    ideas: undefined, error: null, text: '', adding: false, addError: null,
    open: new Set(), openOnce: false, errors: new Map(), busy: new Set(),
    attest: null, resize: null, confirm: null,
  };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load() {
    const mine = ++run;
    const res = await api.fd(ctx.project().id, 'ideas');
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.ideas ??= null;
    } else {
      state.error = null;
      state.ideas = isObject(res.data) ? list(res.data.ideas).filter((i) => isObject(i) && text(i.id)) : [];
      if (!state.openOnce && state.ideas.length) { state.open.add(newestFirst(state.ideas)[0].id); state.openOnce = true; }
    }
    draw();
  }

  const newestFirst = (ideas) => [...ideas].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const sizeName = (s) => t(`fdi.size.${s}`);
  const kindName = (k) => t(`fdi.kind.${k}`);

  // ----- writes -----

  async function add() {
    const body = state.text.trim();
    if (!body || state.adding) return;
    if (body.length > MAX_TEXT) { state.addError = t('err.bad-idea'); draw(); return; }
    state.adding = true;
    state.addError = null;
    draw();
    const res = await api.fdWrite(ctx.project().id, 'idea', { text: body }, 'POST');
    state.adding = false;
    if (!res.ok) {
      state.addError = errorTextOf(ctx, res.error);
      draw();
      return;
    }
    state.text = '';
    if (els?.input) els.input.value = '';
    if (isObject(res.data) && text(res.data.id)) state.open.add(res.data.id);
    await load();
  }

  // One change to one idea; the screen is read again after it. A refusal is shown inside that idea, in words.
  async function act(id, body) {
    if (state.busy.has(id)) return false;
    state.busy.add(id);
    state.errors.delete(id);
    draw();
    const res = await api.fdWrite(ctx.project().id, `idea/${id}`, body, 'POST');
    state.busy.delete(id);
    if (!res.ok) {
      state.errors.set(id, errorTextOf(ctx, res.error));
      draw();
      return false;
    }
    await load();
    return true;
  }

  async function saveAttest(id) {
    const a = state.attest;
    if (!a || a.idea !== id) return;
    if (await act(id, { action: 'attest', checkId: a.check, note: a.note.trim(), days: a.days })) state.attest = null;
    draw();
  }

  async function saveResize(id) {
    const r = state.resize;
    if (!r || r.idea !== id) return;
    if (await act(id, { action: 'resize', size: r.size, sensitive: KINDS.filter((k) => r.kinds.has(k)) })) state.resize = null;
    draw();
  }

  function markReady(idea, blockers) {
    if (blockers.failed.length) return;
    if (blockers.unverified.length) { state.confirm = idea.id; draw(); return; }
    act(idea.id, { action: 'done' });
  }

  // ----- the box -----

  function buildBox() {
    els.input = h('textarea', {
      class: 'fdi-text', rows: '3', maxlength: String(MAX_TEXT), value: state.text, placeholder: t('fdi.box.hint'),
      'aria-label': t('fdi.box.label'), oninput: (e) => { state.text = e.target.value; },
    });
    els.actions = h('div', { class: 'fdg-actions' });
    return h('section', { class: 'fdi-box', 'aria-label': t('fdi.box.label') },
      h('label', { class: 'fdi-box-label' }, h('span', { class: 'fdi-box-title' }, t('fdi.box.label')), els.input),
      els.actions);
  }

  // ----- one idea -----

  function chips(s) {
    return h('span', { class: 'fdi-chips' },
      h('span', { class: 'fdi-chip fdi-size', title: t(`fdi.from.${s.sizeFrom}`) }, sizeName(s.size)),
      s.sensitive.map((k) => h('span', { class: 'fdi-chip fdi-kind', title: t(`fdi.from.${s.kindsFrom}`) }, kindName(k))));
  }

  function levelLine(s) {
    if (!s.counts.pass && !s.counts.fail && !s.counts.unverified) return t('fdi.level.none');
    return [t(`fdi.level.${s.level}`), s.provisional ? ` · ${t('fdi.level.unverified', { n: s.counts.unverified })}` : '', ` · ${t('fdi.level.percent', { percent: s.percent })}`].join('');
  }

  function resizeForm(idea, s) {
    const r = state.resize;
    return h('form', { class: 'fdi-resize', onsubmit: (e) => { e.preventDefault?.(); saveResize(idea.id); } },
      h('p', { class: 'fdp-attest-hint' }, t('fdi.resize.hint')),
      h('label', { class: 'fdp-field' }, h('span', { class: 'fdp-field-label' }, t('fdi.resize.size')),
        h('select', { class: 'fdp-days fdi-size-select', onchange: (e) => { r.size = e.target.value; } },
          SIZES.map((z) => h('option', { value: z, selected: z === r.size ? true : null }, sizeName(z))))),
      h('fieldset', { class: 'fdi-kinds' },
        h('legend', { class: 'fdp-field-label' }, t('fdi.resize.kinds')),
        h('div', { class: 'fdg-options' }, KINDS.map((k) => h('label', { class: 'fdg-option' },
          h('input', { type: 'checkbox', class: 'fdi-kind-box', 'data-kind': k, checked: r.kinds.has(k) ? true : null, onchange: (e) => { if (e.target.checked) r.kinds.add(k); else r.kinds.delete(k); } }),
          kindName(k))))),
      h('div', { class: 'fdg-actions' },
        h('button', { type: 'button', class: 'btn primary small-btn fdi-resize-save', disabled: state.busy.has(idea.id), onclick: () => saveResize(idea.id) }, t('fdi.resize.save')),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => { state.resize = null; draw(); } }, t('fdi.resize.cancel'))));
  }

  function reasonText(reason) {
    const p = { ...reason.params };
    if (p.size !== undefined) p.size = SIZES.includes(p.size) ? sizeName(p.size).toLowerCase() : String(p.size);
    if (p.kind !== undefined) p.kind = KINDS.includes(p.kind) ? kindName(p.kind).toLowerCase() : String(p.kind);
    if (p.why !== undefined) p.why = WHY.includes(p.why) ? t(`fdi.why.${p.why}`) : '';
    return t(reason.key, p);
  }

  function attestForm(idea, row) {
    const a = state.attest;
    const field = (label, control) => h('label', { class: 'fdp-field' }, h('span', { class: 'fdp-field-label' }, label), control);
    return h('form', { class: 'fdp-attest fdi-attest', onsubmit: (e) => { e.preventDefault?.(); saveAttest(idea.id); } },
      h('p', { class: 'fdp-attest-hint' }, t('prac.attest.hint')),
      field(t('prac.attest.note'), h('textarea', {
        class: 'fdp-note-input fdi-note-input', rows: '3', maxlength: String(MAX_NOTE), value: a.note, placeholder: t('prac.attest.note.hint'),
        oninput: (e) => { a.note = e.target.value; },
      })),
      field(t('prac.attest.days'), h('select', { class: 'fdp-days', onchange: (e) => { a.days = Number(e.target.value); } },
        VALID_DAYS.map((d) => h('option', { value: String(d), selected: d === a.days ? true : null }, t('prac.attest.days.n', { n: d }))))),
      h('div', { class: 'fdg-actions' },
        h('button', { type: 'button', class: 'btn primary small-btn fdi-save', disabled: state.busy.has(idea.id), onclick: () => saveAttest(idea.id) }, t(state.busy.has(idea.id) ? 'prac.attest.saving' : 'prac.attest.save')),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => { state.attest = null; draw(); } }, t('prac.attest.cancel'))));
  }

  function checkEl(idea, row, tech) {
    const key = row.state === 'unverified' || row.state === 'na' ? reasonKey(row) : null;
    const attesting = state.attest?.idea === idea.id && state.attest.check === row.id;
    const note = row.state === 'pass' && row.attest ? t('prac.attested.until', { date: String(row.attest.expiresAt ?? '').slice(0, 10) }) : null;
    return h('li', { class: `fdi-check is-${row.state}`, 'data-check': row.id },
      h('div', { class: 'fdi-check-line' },
        badgeNode(h, t, stateBadge(row.state)),
        h('span', { class: 'fdi-check-title' }, row.title),
        row.severity ? h('span', { class: 'fdp-chip', title: t('prac.sev.hint') }, t(`prac.sev.${row.severity}`)) : null),
      h('div', { class: 'fdi-check-more' },
        row.evidence.length ? h('span', { class: 'fdp-evidence' }, row.evidence.map((e) => h('code', { class: 'num' }, `${e.file}:${e.line}`))) : null,
        key ? h('span', { class: 'fdi-reason' }, t(key)) : null,
        note ? h('span', { class: 'fdi-reason' }, note) : null,
        tech ? h('code', { class: 'fdi-id' }, row.id) : null,
        row.state === 'unverified' && !attesting ? h('button', {
          type: 'button', class: 'btn small-btn fdi-attest-btn', title: t('prac.attest.hint'),
          onclick: () => { state.attest = { idea: idea.id, check: row.id, note: '', days: DEFAULT_DAYS }; draw(); },
        }, ctx.icon ? ctx.icon('check', 'btn-icon') : null, t('prac.attest')) : null),
      attesting ? attestForm(idea, row) : null);
  }

  function stageEl(idea, stage, rows, tech) {
    const mine = rows.filter((r) => r.stage === stage.stage);
    const counts = emptyCounts();
    for (const r of mine) counts[r.state]++;
    return h('details', { class: 'fdi-stage', 'data-stage': stage.stage },
      h('summary', { class: 'fdi-stage-sum' },
        h('span', { class: 'fdi-stage-name' }, t(`fdi.stage.${stage.stage}`)),
        h('span', { class: 'fdi-stage-why' }, reasonText(stage.reason)),
        h('span', { class: 'fdp-counts num' }, mine.length ? t('prac.counts', counts) : t('fdi.stage.empty'))),
      mine.length ? h('ul', { class: 'fdi-checks' }, mine.map((r) => checkEl(idea, r, tech))) : null);
  }

  function doneBar(idea, s, blockers) {
    const busy = state.busy.has(idea.id);
    if (s.done) {
      return h('div', { class: 'fdg-actions fdi-bar' },
        h('span', { class: 'fdi-ready' }, t('fdi.ready')),
        h('button', { type: 'button', class: 'btn small-btn fdi-reopen', disabled: busy, onclick: () => act(idea.id, { action: 'reopen' }) }, t('fdi.reopen')));
    }
    const blocked = blockers.failed.length > 0;
    const confirming = state.confirm === idea.id;
    return h('div', { class: 'fdi-bar' },
      h('div', { class: 'fdg-actions' },
        h('button', {
          type: 'button', class: 'btn primary small-btn fdi-done', disabled: blocked || busy, 'aria-describedby': blocked ? `fdi-blocked-${idea.id}` : null,
          onclick: () => markReady(idea, blockers),
        }, t('fdi.done')),
        blocked ? h('span', { class: 'fdi-blocked', id: `fdi-blocked-${idea.id}` }, t('fdi.blocked', { n: blockers.failed.length })) : null),
      confirming ? h('div', { class: 'fdi-confirm', role: 'alertdialog', 'aria-label': t('fdi.confirm.title') },
        h('p', {}, t('fdi.confirm.text', { n: blockers.unverified.length })),
        h('div', { class: 'fdg-actions' },
          h('button', { type: 'button', class: 'btn primary small-btn fdi-confirm-yes', disabled: busy, onclick: async () => { await act(idea.id, { action: 'done', acceptUnverified: true }); state.confirm = null; draw(); } }, t('fdi.confirm.yes')),
          h('button', { type: 'button', class: 'btn small-btn fdi-confirm-no', onclick: () => { state.confirm = null; draw(); } }, t('fdi.confirm.no')))) : null);
  }

  function ideaEl(idea) {
    const s = ideaSummary(idea);
    const rows = checkRows(idea);
    const { applied: given, hidden } = stageRows(idea);
    // A check whose stage the route did not list still shows: nothing the person has to answer may disappear.
    const known = new Set([...given, ...hidden].map((x) => x.stage));
    const extra = [...new Set(rows.map((r) => r.stage))].filter((x) => !known.has(x)).map((stage) => ({ stage, reason: { key: 'fdi.reason.general', params: {} } }));
    const applied = [...given, ...extra];
    const blockers = doneBlockers(idea);
    const tech = value(ctx.tech);
    const changing = state.resize?.idea === idea.id;
    const error = state.errors.get(idea.id);
    return h('details', {
      class: `fdi-idea is-${s.level}${s.done ? ' is-done' : ''}`, 'data-idea': idea.id, open: state.open.has(idea.id) ? true : null,
      ontoggle: (e) => { if (e.target.open) state.open.add(idea.id); else state.open.delete(idea.id); },
    },
    h('summary', { class: 'fdi-sum' }, h('span', { class: 'fdi-idea-text' }, s.text), chips(s)),
    h('div', { class: 'fdi-body' },
      h('p', { class: 'fdi-level' }, levelLine(s)),
      s.provisional ? h('p', { class: 'fdp-note' }, t('prac.level.provisional')) : null,
      h('p', { class: 'fdi-classified' },
        t('fdi.classified', { size: sizeName(s.size).toLowerCase(), kinds: s.sensitive.length ? s.sensitive.map((k) => kindName(k).toLowerCase()).join(', ') : t('fdi.kind.none') }),
        ' ', t(`fdi.from.${s.sizeFrom === 'owner' && s.kindsFrom === 'owner' ? 'owner' : 'guessed'}`), ' ',
        changing ? null : h('button', {
          type: 'button', class: 'btn small-btn fdi-change',
          onclick: () => { state.resize = { idea: idea.id, size: s.size, kinds: new Set(s.sensitive) }; state.open.add(idea.id); draw(); },
        }, t('fdi.change'))),
      changing ? resizeForm(idea, s) : null,
      applied.some((a) => LEGAL_STAGES.includes(a.stage)) ? h('div', { class: 'fdg-notice', role: 'note' }, h('p', {}, t('rota.notice'))) : null,
      applied.length ? h('div', { class: 'fdi-stages' }, applied.map((a) => stageEl(idea, a, rows, tech))) : null,
      rows.length ? null : h('p', { class: 'view-note' }, t('fdi.checks.none')),
      hidden.length ? h('details', { class: 'fdi-hidden' },
        h('summary', { class: 'fdi-hidden-sum' }, t('fdi.hidden', { n: hidden.length })),
        h('ul', { class: 'fdi-hidden-list' }, hidden.map((x) => h('li', { class: 'fdi-hidden-stage', 'data-stage': x.stage },
          h('span', { class: 'fdi-stage-name' }, t(`fdi.stage.${x.stage}`)), ' · ', h('span', { class: 'fdi-stage-why' }, reasonText(x.reason)))))) : null,
      error ? h('p', { class: 'fdg-error', role: 'alert' }, error) : null,
      doneBar(idea, s, blockers)));
  }

  // ----- the screen -----

  function list_() {
    if (state.ideas === undefined) return [h('p', { class: 'view-note' }, t('fdi.loading'))];
    if (state.error && !state.ideas) {
      return [h('p', { class: 'view-note fdg-failed', role: 'alert' }, errorTextOf(ctx, state.error)),
        h('button', { type: 'button', class: 'btn small-btn', onclick: load }, t('rota.retry'))];
    }
    if (!state.ideas?.length) return [emptyState({ h, icon: ctx.icon }, { art: 'check', title: t('fdi.empty.title'), text: t('fdi.empty.text'), compact: true })];
    return [h('div', { class: 'fdi-list' }, newestFirst(state.ideas).map(ideaEl))];
  }

  function draw() {
    if (!els) return;
    els.actions.replaceChildren(
      h('button', { type: 'button', class: 'btn primary fdi-add', disabled: state.adding, onclick: add }, t(state.adding ? 'fdi.adding' : 'fdi.add')),
      state.addError ? h('p', { class: 'fdg-error', role: 'alert' }, state.addError) : null);
    els.list.replaceChildren(...list_().flat().filter(Boolean));
  }

  function build(root) {
    els = { list: h('div', { class: 'fdg-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdg-view fdi-view' },
      h('div', { class: 'view-head' }, h('h2', {}, t('fdi.title'))),
      h('p', { class: 'view-lede' }, t('fdi.lede')),
      buildBox(),
      els.list));
  }

  return {
    render(root) {
      state.attest = null;
      state.resize = null;
      state.confirm = null;
      build(root);
      draw();
      return load();
    },
    // A poll must not wipe a note, a size change or a box that is being filled in.
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      if (state.attest || state.resize || state.confirm || state.text) return undefined;
      return load();
    },
  };
}
