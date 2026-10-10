import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';
import { findingWords } from './findingsview.js';

// The "Everything up to date?" screen (fd07): eight groups, 35 lines, each one checked and in order, needing a look, or
// not verifiable, and always with what was checked. The pure functions on top are tested; the view below draws them.
// Nothing disappears when data is missing: a line the file does not hold is shown as "not read yet", and a line never
// shows as confirmed without proof, whatever the file says. The screen only reads; it writes nothing.

// The catalog of server/foundation/uptodate-lines-*.mjs, in order (a test keeps both lists equal).
const IDS = {
  1: ['census-owners', 'read-100', 'golden-rule', 'cov-routes', 'cov-screens', 'cov-tables', 'cov-jobs', 'cov-integrations', 'arch-paths', 'links-imports'],
  2: ['cites', 'links', 'images', 'api-docs', 'db-docs'],
  3: ['versions', 'numbers', 'done-ticked'],
  4: ['env-documented', 'env-unused'],
  5: ['tests-exist', 'tests-passing', 'inspection', 'i18n'],
  6: ['dep-versions', 'dep-vulns', 'dep-licenses'],
  7: ['uncommitted', 'unpushed', 'branches', 'clashes', 'board-items', 'issues'],
  8: ['decisions-unwritten', 'requests-no-item'],
};
export const GROUPS = Object.keys(IDS).map(Number);
export const CATALOG = GROUPS.flatMap((group) => IDS[group].map((name) => ({ id: `g${group}.${name}`, group })));
export const REASONS = ['no-token', 'no-network', 'tool-missing', 'no-data', 'not-applicable'];

const STATES = new Set(['confirmed', 'warning', 'unverified']);
const WORDS = { confirmed: 'ok', warning: 'warn', unverified: 'unverified' };
const NOTES = new Set(['findings', 'links', 'items', 'tag', 'route-not-in-spec', 'spec-route-not-in-code', 'ticked-missing', 'request-unconfirmed']);
const SHOWN = 20;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const word = (t, key) => {
  const text = t(key);
  return text === key ? null : text;
};

// One line as the screen trusts it: an unknown state or a confirmation without proof falls to "not verified".
function normal(raw, group) {
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).filter(isObject);
  const asked = STATES.has(raw.state) ? raw.state : 'unverified';
  const state = asked === 'confirmed' && !evidence.length ? 'unverified' : asked;
  const reason = state !== 'unverified' ? null : asked === 'unverified' && REASONS.includes(raw.reason) ? raw.reason : 'no-data';
  return {
    id: String(raw.id), group, state, evidence, reason,
    findingIds: Array.isArray(raw.findingIds) ? raw.findingIds.filter((x) => typeof x === 'string') : [],
    checkedAt: raw.checkedAt ?? null, detail: raw.detail ?? null, missing: raw.missing === true,
  };
}

const groupOf = (raw) => {
  const known = CATALOG.find((c) => c.id === raw.id);
  const g = known ? known.group : Number(raw.group);
  return GROUPS.includes(g) ? g : null;
};

// The eight groups, every catalog line in its place (a line the data does not hold says "not read yet"), the lines
// the catalog does not know after the known ones, and the count of each state. data: uptodate.json or null.
export function groupsOf(data) {
  const given = new Map();
  for (const raw of Array.isArray(data?.lines) ? data.lines : []) {
    if (isObject(raw) && typeof raw.id === 'string') given.set(raw.id, raw);
  }
  const known = new Set(CATALOG.map((c) => c.id));
  return GROUPS.map((group) => {
    const own = CATALOG.filter((c) => c.group === group).map((c) => (given.has(c.id)
      ? normal(given.get(c.id), group)
      : normal({ id: c.id, state: 'unverified', reason: 'no-data', missing: true }, group)));
    const extra = [...given.values()].filter((raw) => !known.has(raw.id) && groupOf(raw) === group).map((raw) => normal(raw, group));
    const lines = [...own, ...extra];
    const counts = { confirmed: 0, warning: 0, unverified: 0 };
    for (const l of lines) counts[l.state] += 1;
    return { group, lines, counts };
  });
}

// For the Home and the Route (simple mode): the three counts, whether anything was read, the worst state and the
// groups that need a look.
export function summaryOf(data) {
  const groups = groupsOf(data);
  const counts = { confirmed: 0, warning: 0, unverified: 0 };
  for (const g of groups) for (const s of Object.keys(counts)) counts[s] += g.counts[s];
  const total = counts.confirmed + counts.warning + counts.unverified;
  const read = groups.some((g) => g.lines.some((l) => !l.missing));
  const headline = counts.warning ? 'warning' : counts.confirmed === total ? 'confirmed' : 'unverified';
  return { ...counts, total, read, headline, warningGroups: groups.filter((g) => g.counts.warning).map((g) => g.group) };
}

export const summaryWords = (summary, t) => (summary.read ? t('uptodate.summary.line', summary) : t('uptodate.summary.unread'));

function noteOf(e, t) {
  if (NOTES.has(e.note)) return t(`uptodate.evidence.${e.note}`, { count: e.count ?? 0, tag: e.tag ?? '', name: e.name ?? '', code: e.code ?? '' });
  return typeof e.target === 'string' ? e.target : null;
}

// What was checked, as places to open (file and line) or, when there is no file to open, as words. A file of the
// repository can be opened; the git state and the like cannot.
export function evidenceRows(evidence, t) {
  const rows = [];
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (!isObject(e)) continue;
    const note = noteOf(e, t);
    const line = Number.isInteger(e.line) && e.line >= 1 ? e.line : null;
    if (typeof e.file === 'string' && e.file && !e.file.startsWith('.git')) {
      rows.push({ label: line ? `${e.file}:${line}` : e.file, open: { file: e.file, line }, note });
    } else if (typeof e.factId === 'string' && e.factId) {
      rows.push({ label: e.factId, open: null, note });
    } else if (e.readChars !== undefined && e.totalChars !== undefined) {
      rows.push({ label: t('uptodate.evidence.read', { read: e.readChars, total: e.totalChars }), open: null, note: null });
    } else if (note) {
      rows.push({ label: note, open: null, note: null });
    }
  }
  return rows;
}

// One line ready to draw. findings: the list of findings.json (or null), to name the ones this line points to.
export function lineView(line, t, findings = null) {
  const l = normal(line, Number(line.group) || Number(String(line.id)[1]));
  const list = Array.isArray(findings) ? findings : Array.isArray(findings?.findings) ? findings.findings : [];
  const linked = l.findingIds.map((id) => list.find((f) => f?.id === id)).filter(Boolean)
    .map((f) => ({ id: f.id, severity: f.severity, where: f.target?.file ?? null, what: findingWords(f, t).what }));
  return {
    id: l.id, group: l.group, state: l.state, missing: l.missing, checkedAt: l.checkedAt,
    name: word(t, `uptodate.${l.id}.name`) ?? l.id,
    words: word(t, `uptodate.${l.id}.${WORDS[l.state]}`) ?? t(`mark.${l.state}.hint`),
    reasonText: l.reason ? t(`uptodate.reason.${l.reason}`) : null,
    badge: stateBadge(l.state),
    evidence: evidenceRows(l.evidence, t),
    findingIds: l.findingIds,
    findings: linked,
  };
}

export function createUptodateView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const state = { data: undefined, findings: null, error: null, opened: new Set() };
  let run = 0;
  let els = null;

  const projectId = () => ctx.project().id;

  async function load() {
    const mine = ++run;
    const [data, found] = await Promise.all([api.fd(projectId(), 'uptodate'), api.fd(projectId(), 'findings')]);
    if (mine !== run) return;
    state.error = data.ok ? null : data.error;
    state.data = data.ok ? data.data : null;
    state.findings = found.ok && found.data ? found.data : null;
    draw();
  }

  function evidenceEl(v) {
    const tt = t();
    if (!v.evidence.length) return h('p', { class: 'fdu-none' }, tt('uptodate.evidence.none'));
    return h('ul', { class: 'fdu-proof' },
      v.evidence.slice(0, SHOWN).map((r) => h('li', {},
        r.open && ctx.openFile
          ? h('button', { type: 'button', class: 'fdu-where', title: tt('uptodate.evidence.open', { where: r.label }), onclick: () => ctx.openFile(r.open.file, r.open.line) }, h('code', {}, r.label))
          : h('code', { class: 'fdu-where' }, r.label),
        r.note ? h('span', { class: 'fdu-note' }, r.note) : null)),
      v.evidence.length > SHOWN ? h('li', { class: 'fdu-more' }, tt('uptodate.evidence.more', { n: v.evidence.length - SHOWN })) : null);
  }

  function lineEl(raw) {
    const tt = t();
    const v = lineView(raw, tt, state.findings);
    const toggle = (ev) => {
      if (ev.target?.open) state.opened.add(v.id);
      else state.opened.delete(v.id);
    };
    return h('li', { class: 'fdu-item' },
      h('details', { class: `fdu-line is-${v.state === 'warning' ? 'warning' : v.state}${v.missing ? ' is-missing' : ''}`, 'data-id': v.id, open: state.opened.has(v.id), ontoggle: toggle },
        h('summary', {},
          badgeNode(h, tt, v.badge),
          h('span', { class: 'fdu-name' }, v.name),
          h('span', { class: 'fdu-words' }, v.words)),
        h('div', { class: 'fdu-body' },
          v.reasonText ? h('p', { class: 'fdu-reason' }, h('strong', {}, `${tt('uptodate.why')}: `), v.reasonText) : null,
          v.state === 'unverified' ? null : h('div', {}, h('h4', { class: 'fdu-sub' }, tt('uptodate.checked')), evidenceEl(v)),
          v.findings.length ? h('div', { class: 'fdu-findings' },
            h('h4', { class: 'fdu-sub' }, tt('uptodate.findings')),
            h('ul', {}, v.findings.map((f) => h('li', {}, f.what))),
            ctx.openFindings ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => ctx.openFindings() }, tt('uptodate.findings.open')) : null) : null)));
  }

  function groupEl(g) {
    const tt = t();
    const title = tt(`uptodate.group.${g.group}`);
    const counts = tt('uptodate.group.count', g.counts);
    return h('section', { class: 'fdu-group', 'aria-label': title },
      h('h3', { class: 'fdu-group-title' }, title,
        h('span', { class: 'fdu-counts num', title: counts, 'aria-label': counts },
          ...['confirmed', 'warning', 'unverified'].flatMap((s) => [
            h('span', { class: `fdu-count fdu-count--${s}` }, h('span', { 'aria-hidden': 'true' }, stateBadge(s).mark), ' ', String(g.counts[s])), ' ']))),
      h('ul', { class: 'fdu-list' }, g.lines.map(lineEl)));
  }

  function body() {
    const tt = t();
    if (state.data === undefined) return [h('p', { class: 'view-note' }, tt('uptodate.loading'))];
    const summary = summaryOf(state.data);
    return [
      state.error ? h('p', { class: 'view-note fdu-error' }, ctx.errorText(state.error)) : null,
      !state.error && !summary.read
        ? emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('uptodate.unread.title'), text: tt('uptodate.unread.text'), compact: true })
        : h('p', { class: `fdu-summary is-${summary.headline}` }, badgeNode(h, tt, stateBadge(summary.headline)), ' ', summaryWords(summary, tt)),
      ...groupsOf(state.data).map(groupEl),
    ];
  }

  function draw() {
    if (els) els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    const tt = t();
    els = { body: h('div', { class: 'fdu-body-wrap', 'aria-live': 'polite' }) };
    root.replaceChildren(h('div', { class: 'view-wrap fdu-view' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('uptodate.title'))),
      h('p', { class: 'view-lede' }, tt('uptodate.lede')),
      els.body));
  }

  let rootEl = null;
  return {
    render(root) {
      rootEl = root;
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
