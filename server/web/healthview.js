import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';

// The repository health screen (fd08): a score from 0 to 100 (or "no score yet"), the categories with their own
// score, the gaps worst first with what they are, why they matter and what to do, a draft button for the items that
// have one, and, apart, what could not be verified (with the reason) and what does not apply. The pure functions on
// top are tested; the view below draws them. The score and every state come from the server's health.json: the screen
// only sorts and shows, it never invents a state, and what it does not understand falls to "not verified".

export const CATEGORY_IDS = ['community', 'security', 'releases', 'docs', 'hygiene', 'product', 'management', 'extras'];
export const REASONS = {
  fail: ['missing', 'placeholder', 'too-short', 'no-contact', 'invalid', 'unsafe', 'stale'],
  unverified: ['no-token', 'no-network', 'tool-missing', 'no-data', 'too-big', 'error'],
  na: ['private', 'no-users', 'not-library', 'no-code'],
};
const SEVERITIES = ['E', 'R', 'A'];
const WEIGHT = { E: 3, R: 2, A: 1 };
const STATES = new Set(['pass', 'fail', 'unverified', 'na']);
const FIX_ERRORS = { 'look-only': 'lookOnly', 'needs-confirm': 'needsConfirm', refused: 'refused', 'bad-path': 'refused', 'secret-file': 'refused', 'outside-root': 'refused' };

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
const percent = (n) => (Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null);

// One item as the screen trusts it: an unknown state is "not verified", and a reason that the contract does not list
// for that state is dropped (a missing item with no known reason still shows as missing, just without a reason).
function normal(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const asked = STATES.has(raw.state) ? raw.state : 'unverified';
  const prefix = raw.id.split('.')[0];
  const known = (list) => (list.includes(raw.reason) ? raw.reason : null);
  const reason = asked === 'fail' ? known(REASONS.fail)
    : asked === 'unverified' ? (STATES.has(raw.state) ? known(REASONS.unverified) : null) ?? 'no-data'
      : asked === 'na' ? known(REASONS.na) : null;
  const fix = isObject(raw.fix) ? raw.fix : {};
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).filter((e) => isObject(e) && typeof e.file === 'string');
  const packages = (Array.isArray(raw.packages) ? raw.packages : []).filter((p) => isObject(p) && typeof p.dir === 'string' && p.state === 'fail');
  return {
    id: raw.id, state: asked, reason,
    category: typeof raw.category === 'string' && raw.category ? raw.category : prefix,
    severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'A',
    detail: isObject(raw.detail) ? raw.detail : null, evidence, packages,
    fill: asked === 'fail' && reason === 'placeholder',
    canDraft: asked === 'fail' && fix.kind === 'draft' && !fix.opId && (reason === null || reason === 'missing'),
  };
}

const rankOf = (id) => {
  const at = CATEGORY_IDS.indexOf(id);
  return at < 0 ? CATEGORY_IDS.length : at;
};
// Worst first (essential, recommended, nice to have), then catalog category order, then id.
const worstFirst = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
  || rankOf(a.category) - rankOf(b.category) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);

// Same formula as the server (contract 8): round(100 * Σpeso(pass) / Σpeso(pass + fail)); null with nothing checked.
function scoreOf(items) {
  let pass = 0;
  let all = 0;
  for (const i of items) {
    if (i.state === 'pass') { pass += WEIGHT[i.severity]; all += WEIGHT[i.severity]; } else if (i.state === 'fail') all += WEIGHT[i.severity];
  }
  return all ? Math.round((100 * pass) / all) : null;
}
const countsOf = (items) => ({
  pass: items.filter((i) => i.state === 'pass').length, fail: items.filter((i) => i.state === 'fail').length,
  unverified: items.filter((i) => i.state === 'unverified').length, na: items.filter((i) => i.state === 'na').length,
});

// health: health.json or null. Everything the view draws is in the answer; nothing is read from anywhere else.
export function healthModel(health) {
  const read = isObject(health);
  const items = (read && Array.isArray(health.items) ? health.items : []).map(normal).filter(Boolean);
  const gaps = items.filter((i) => i.state === 'fail').sort(worstFirst);
  const unverified = items.filter((i) => i.state === 'unverified').sort(worstFirst);
  const na = items.filter((i) => i.state === 'na').sort(worstFirst);
  const counts = countsOf(items);
  const checked = counts.pass + counts.fail;

  const fileScore = read ? health.score : null;
  const score = checked === 0 ? null : fileScore == null ? scoreOf(items) : percent(fileScore);

  const cov = read && isObject(health.coverage) ? health.coverage : null;
  const coverage = cov && Number.isInteger(cov.verified) && Number.isInteger(cov.applicable)
    ? { verified: cov.verified, applicable: cov.applicable }
    : { verified: checked, applicable: items.length - counts.na };

  const given = read && isObject(health.categories) ? health.categories : {};
  const ids = [...new Set([...items.map((i) => i.category), ...Object.keys(given)])]
    .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  const categories = ids.map((id) => {
    const mine = items.filter((i) => i.category === id);
    const c = isObject(given[id]) ? given[id] : null;
    const own = countsOf(mine);
    const n = c ? { pass: count(c.pass), fail: count(c.fail), unverified: count(c.unverified), na: count(c.na) } : own;
    const s = c ? (c.score == null ? null : percent(c.score)) : scoreOf(mine);
    return { id, score: n.pass + n.fail === 0 ? null : s, ...n };
  });

  const net = read && isObject(health.api) ? health.api : {};
  return {
    read, score, coverage, categories, gaps, unverified, na, passed: counts.pass,
    visibility: read && ['public', 'private'].includes(health.visibility) ? health.visibility : 'unknown',
    mode: ['token', 'public'].includes(net.mode) ? net.mode : 'none',
    fetchedAt: typeof net.fetchedAt === 'string' ? net.fetchedAt : null,
  };
}

// The three texts of an item, by key (health.item.<id>.what|why|todo) filled with the details the check left. A
// missing key falls to the id, never to a sentence made up here.
export function itemWords(item, t) {
  const params = { ...item.detail };
  for (const [k, v] of Object.entries(params)) if (Array.isArray(v)) params[k] = v.join(', ');
  const say = (part) => {
    const key = `health.item.${item.id}.${part}`;
    const text = t(key, params);
    return text === key ? item.id : text;
  };
  return { what: say('what'), why: say('why'), todo: say('todo') };
}

const whenWords = (iso) => (typeof iso === 'string' ? iso.slice(0, 16).replace('T', ' ') : '');

export function createHealthView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const state = { health: undefined, error: null, notice: null, busy: new Set(), online: false, focus: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  const projectId = () => ctx.project().id;
  const mode = () => ctx.careMode?.() ?? null;
  const canWrite = () => mode() === 'auto' || mode() === 'suggest';

  async function load() {
    const mine = ++run;
    const res = await api.fd(projectId(), 'health');
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.health ??= null;
    } else {
      state.error = null;
      state.health = res.data ?? null;
    }
    draw();
  }

  function say(tone, key, vars) {
    state.notice = { tone, text: t()(key, vars) };
  }

  // The answer of the draft route in words: nothing is shown as written unless the server says it was.
  function answer(res) {
    const code = FIX_ERRORS[res.error];
    if (!res.ok && code) return say('warn', `health.fix.${code}`);
    if (!res.ok) { state.notice = { tone: 'warn', text: ctx.errorText(res.error) }; return undefined; }
    const data = res.data ?? {};
    if (data.status === 'applied') return say('ok', 'health.fix.applied');
    if (data.status === 'proposed') return say('ok', 'health.fix.proposed');
    if (FIX_ERRORS[data.status]) return say('warn', `health.fix.${FIX_ERRORS[data.status]}`);
    if (data.ok === false) { state.notice = { tone: 'warn', text: ctx.errorText(data.error) }; return undefined; }
    state.notice = null;
    return undefined;
  }

  async function makeDraft(item) {
    if (state.busy.has(item.id)) return;
    state.busy.add(item.id);
    try {
      answer(await api.fdWrite(projectId(), 'health/fix', { itemId: item.id }));
    } finally {
      state.busy.delete(item.id);
    }
    state.focus = 'notice';
    await load();
  }

  async function checkOnline() {
    if (state.online) return;
    state.online = true;
    state.notice = null;
    draw();
    try {
      const res = await api.fdWrite(projectId(), 'online', {});
      if (res.status === 429) say('warn', 'health.online.wait');
      else if (!res.ok) state.notice = { tone: 'warn', text: ctx.errorText(res.error) };
      else say('ok', 'health.online.done');
    } finally {
      state.online = false;
    }
    state.focus = 'notice';
    await load();
  }

  // ----- drawing -----

  function fileButton(e) {
    const where = e.line ? `${e.file}:${e.line}` : e.file;
    return ctx.openFile
      ? h('button', { type: 'button', class: 'fdh-where', title: t()('health.openFile', { where }), onclick: () => ctx.openFile(e.file, e.line ?? null) }, h('code', {}, where))
      : h('code', { class: 'fdh-where' }, where);
  }

  function gapEl(g) {
    const tt = t();
    const words = itemWords(g, tt);
    const busy = state.busy.has(g.id);
    return h('li', { class: `fdh-gap sev-${g.severity}`, 'data-id': g.id },
      h('div', { class: 'fdh-head' },
        h('span', { class: 'fdh-sev' }, tt(`health.sev.${g.severity}`)),
        h('span', { class: 'fdh-cat' }, tt(`health.category.${g.category}`)),
        badgeNode(h, tt, stateBadge('fail')),
        g.reason ? h('span', { class: 'fdh-reason' }, tt(`health.reason.${g.reason}`)) : null,
        g.evidence.map(fileButton)),
      h('dl', { class: 'fdh-facts' },
        h('div', {}, h('dt', {}, tt('health.what')), h('dd', {}, words.what)),
        h('div', {}, h('dt', {}, tt('health.why')), h('dd', {}, words.why)),
        h('div', {}, h('dt', {}, tt('health.todo')), h('dd', {}, words.todo))),
      g.packages.length ? h('p', { class: 'fdh-packages' }, tt('health.packages', { list: g.packages.map((p) => p.dir || '.').join(', ') })) : null,
      g.fill ? h('p', { class: 'fdh-fill' }, tt('health.fill')) : null,
      g.canDraft ? h('div', { class: 'fdh-actions' },
        h('button', {
          type: 'button', class: 'btn primary small-btn', 'data-key': `${g.id}:draft`, disabled: !canWrite() || busy,
          title: tt('health.draft.hint'), onclick: () => makeDraft(g),
        }, tt('health.draft.make'))) : null);
  }

  function summaryEl(m) {
    const tt = t();
    return h('section', { class: 'fdh-summary', 'aria-label': tt('health.score.label') },
      h('div', { class: 'fdh-score' },
        h('span', { class: 'fdh-score-label' }, tt('health.score.label')),
        m.score == null
          ? h('span', { class: 'fdh-score-none' }, tt('health.score.none'))
          : h('span', { class: 'fdh-score-line' }, h('span', { class: 'fdh-score-num num' }, String(m.score)), ' ', h('span', { class: 'fdh-score-of' }, tt('health.score.of')))),
      m.score == null ? h('p', { class: 'view-note' }, tt('health.score.noneHint')) : null,
      h('p', { class: 'fdh-coverage num' }, tt('health.coverage', { verified: m.coverage.verified, applicable: m.coverage.applicable })),
      h('p', { class: 'fdh-visibility' }, tt('health.visibility.label'), ': ', tt(`health.visibility.${m.visibility}`)));
  }

  function categoriesEl(m) {
    const tt = t();
    if (!m.categories.length) return null;
    return h('section', { class: 'fdh-section', 'aria-label': tt('health.categories') },
      h('h3', { class: 'fdh-section-title' }, tt('health.categories')),
      h('ul', { class: 'fdh-cats' }, m.categories.map((c) => h('li', { class: 'fdh-catrow', 'data-id': c.id },
        h('span', { class: 'fdh-catname' }, tt(`health.category.${c.id}`)),
        c.score == null ? h('span', { class: 'fdh-catscore is-none' }, tt('health.cat.noScore')) : h('span', { class: 'fdh-catscore num' }, String(c.score)),
        h('span', { class: 'fdh-catcounts num' }, tt('health.cat.counts', { pass: c.pass, fail: c.fail }))))));
  }

  function gapsEl(m) {
    const tt = t();
    return h('section', { class: 'fdh-section fdh-gaps', 'aria-label': tt('health.gaps.title') },
      h('h3', { class: 'fdh-section-title' }, tt('health.gaps.title'), h('span', { class: 'fdh-count num' }, String(m.gaps.length))),
      m.gaps.length
        ? h('ul', { class: 'fdh-list' }, m.gaps.map(gapEl))
        : emptyState({ h, icon: ctx.icon }, { art: 'check', title: tt('health.gaps.empty.title'), text: tt('health.gaps.empty.text'), compact: true }));
  }

  function plainRow(i) {
    const tt = t();
    return h('li', { class: 'fdh-plain-row', 'data-id': i.id },
      h('span', { class: 'fdh-cat' }, tt(`health.category.${i.category}`)),
      h('span', { class: 'fdh-plain-what' }, itemWords(i, tt).what),
      i.reason ? h('span', { class: 'fdh-reason' }, tt(`health.reason.${i.reason}`)) : null);
  }

  function unverifiedEl(m) {
    const tt = t();
    if (!m.unverified.length) return null;
    return h('section', { class: 'fdh-section fdh-unverified', 'aria-label': tt('health.unverified.title') },
      h('h3', { class: 'fdh-section-title' }, badgeNode(h, tt, stateBadge('unverified')), h('span', { class: 'fdh-count num' }, String(m.unverified.length))),
      h('p', { class: 'view-note' }, tt('health.unverified.lede')),
      h('ul', { class: 'fdh-plain' }, m.unverified.map(plainRow)));
  }

  function naEl(m) {
    const tt = t();
    if (!m.na.length) return null;
    return h('details', { class: 'fdh-na' },
      h('summary', {}, tt('health.na.title'), ' ', h('span', { class: 'fdh-count num' }, tt('health.na.count', { n: m.na.length }))),
      h('p', { class: 'view-note' }, tt('health.na.lede')),
      h('ul', { class: 'fdh-plain' }, m.na.map(plainRow)));
  }

  function body() {
    const tt = t();
    if (state.health === undefined) return [h('p', { class: 'view-note' }, tt('health.loading'))];
    if (state.error && !state.health) return [h('p', { class: 'view-note' }, ctx.errorText(state.error))];
    if (state.health === null) return [emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('health.notRead.title'), text: tt('health.notRead.text') })];
    const m = healthModel(state.health);
    const note = mode() === 'look' ? 'health.mode.look' : mode() == null ? 'health.mode.unset' : null;
    const draftable = m.gaps.some((g) => g.canDraft);
    return [
      summaryEl(m), categoriesEl(m),
      draftable && note ? h('p', { class: 'fdh-mode view-note' }, tt(note)) : null,
      gapsEl(m), unverifiedEl(m), naEl(m),
    ];
  }

  function onlineLine() {
    const tt = t();
    const m = healthModel(state.health);
    return h('p', { class: 'fdh-online-status' },
      tt(`health.online.mode.${m.mode}`), m.fetchedAt ? [' · ', tt('health.online.at', { when: whenWords(m.fetchedAt) })] : null);
  }

  function draw() {
    if (!els) return;
    const tt = t();
    els.notice.replaceChildren(...(state.notice ? [h('p', { class: `fdh-notice is-${state.notice.tone}` }, state.notice.text)] : []));
    els.online.replaceChildren(
      h('button', { type: 'button', class: 'btn small-btn', disabled: state.online, onclick: checkOnline }, tt(state.online ? 'health.online.busy' : 'health.online.button')),
      h('p', { class: 'view-note' }, tt('health.online.hint')),
      state.health ? onlineLine() : null);
    els.body.replaceChildren(...body().filter(Boolean));
    if (state.focus) {
      const key = state.focus;
      state.focus = null;
      if (key === 'notice') els.notice.focus?.();
    }
  }

  function build(root) {
    const tt = t();
    els = {
      notice: h('div', { class: 'fdh-live', role: 'status', tabindex: '-1' }),
      online: h('div', { class: 'fdh-online' }),
      body: h('div', { class: 'fdh-body', 'aria-live': 'polite' }),
    };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdh-view' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('health.title'))),
      h('p', { class: 'view-lede' }, tt('health.lede')),
      els.online, els.notice, els.body));
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
