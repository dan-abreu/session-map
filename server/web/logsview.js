// The Logs tab (id159, mm61): what the program wrote down about itself, for a person who does not read JSON. Problems come
// first, grouped ("the same thing, 10 times") and said in plain words with when it last happened and whether it still does;
// then the routine; then the record of one project. Every line opens on a click into its technical form.
// It reads what already exists: GET /api/logs (sv19) and GET /api/logs/projects/<id> (wa11). The numbers come from logs.js.
//
// ctx: h, t (translator function), lang() (getter), icon(name, cls), api { logs(query), projectLog(id, query) },
// fmt { relative(iso) }, projects() → [{ id, name }], project() → the open project (or null), errorText(code),
// now() (optional, for the tests).
import { emptyState } from './empty.js';
import { groupProblems, routineRows, sinceOf, projectLine, providerName, PROBLEM_EVENTS, ROUTINE_EVENTS, rowsSignature } from './logs.js';

const STEP = 50;
const PROGRAM_LIMIT = 1000;
const PROJECT_LIMIT = 200;

export function createLogsView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const lang = () => (typeof ctx.lang === 'function' ? ctx.lang() : 'en');
  const now = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
  // ctx.t is a plain function, so the plural form is chosen here: logs.times.one / logs.times.other.
  const times = (n) => t(`logs.times.${n !== 0 && new Intl.PluralRules(lang()).select(n) === 'one' ? 'one' : 'other'}`, { n });

  const st = {
    program: null, // the rows, newest first; null until the first answer
    programError: null,
    project: null, // the id picked in "By project"
    projectRows: null,
    projectError: null,
    shown: { routine: STEP, project: STEP },
  };
  const open = new Set(); // the groups and lines the person opened: they stay open when the page is drawn again
  let rootEl = null;
  let programRun = 0;
  let projectRun = 0;

  const projects = () => (typeof ctx.projects === 'function' ? ctx.projects() : []) ?? [];
  const pickedProject = () => {
    const list = projects();
    if (st.project && list.some((p) => p.id === st.project)) return st.project;
    const current = typeof ctx.project === 'function' ? ctx.project()?.id : null;
    return list.find((p) => p.id === current)?.id ?? list[0]?.id ?? null;
  };

  const absolute = (ts) => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms) : '';
  };
  const day = (ts) => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'long' }).format(ms) : '';
  };
  const ago = (ts) => (ts && ctx.fmt?.relative ? ctx.fmt.relative(ts) : absolute(ts));

  // A <details> that remembers whether the person opened it.
  function fold(key, className, summary, body) {
    return h('details', { class: className, open: open.has(key) ? true : null, 'data-key': key, ontoggle: (e) => {
      if (e.target.open) open.add(key); else open.delete(key);
    } }, h('summary', {}, summary), body);
  }

  const rawLine = (row) => h('pre', { class: 'lg-raw' }, JSON.stringify(row));

  function problemTitle(g) {
    if (!PROBLEM_EVENTS[g.event]) return t('logs.event.other', { event: g.event });
    return t(`logs.event.${g.event}`, { provider: providerName(g.provider) || t('logs.someAi') });
  }

  function groupItem(g) {
    const tone = g.level === 'error' ? 'is-error' : 'is-warn';
    const summary = [
      h('span', { class: `lg-level ${tone}` }, t(`logs.level.${g.level}`)),
      h('span', { class: 'lg-title' }, problemTitle(g)),
      h('span', { class: 'lg-count num' }, times(g.count)),
      h('span', { class: 'lg-when' }, t('logs.last', { when: ago(g.last) })),
    ];
    const body = h('div', { class: 'lg-body' },
      g.reason ? h('p', { class: 'lg-why' }, t('logs.why', { why: t(g.reason.key, g.reason.vars) })) : null,
      h('p', { class: `lg-state ${g.recent ? 'is-now' : 'is-quiet'}` }, g.recent ? t('logs.active') : t('logs.stopped')),
      h('p', { class: 'lg-meta' }, t('logs.first', { when: absolute(g.first) }), ' · ', t('logs.last', { when: absolute(g.last) })),
      h('p', { class: 'lg-rawhead' }, t('logs.raw')),
      g.raw.map(rawLine));
    return h('li', { class: `lg-group ${tone}` }, fold(`g:${g.key}`, 'lg-fold', summary, body));
  }

  function routineItem(row, i) {
    const name = ROUTINE_EVENTS.includes(row.event) ? t(`logs.event.${row.event}`) : t('logs.event.other', { event: row.event });
    return h('li', { class: 'lg-line' }, fold(`r:${row.ts}:${row.event}:${i}`, 'lg-fold lg-fold-line',
      [h('span', { class: 'lg-time num' }, absolute(row.ts)), h('span', { class: 'lg-name' }, name)], h('div', { class: 'lg-body' }, rawLine(row))));
  }

  function projectItem(row, i) {
    const line = projectLine(row);
    const name = line.known ? t(`logs.kind.${line.kind}`) : t('logs.event.other', { event: line.kind || '—' });
    return h('li', { class: 'lg-line' }, fold(`p:${row.ts}:${line.kind}:${i}`, 'lg-fold lg-fold-line',
      [h('span', { class: 'lg-time num' }, absolute(row.ts)), h('span', { class: 'lg-name' }, name), line.said ? h('span', { class: 'lg-said' }, line.said) : null],
      h('div', { class: 'lg-body' }, rawLine(row))));
  }

  const more = (key, total) => (st.shown[key] < total
    ? h('button', { type: 'button', class: 'btn lg-more-btn', onclick: () => { st.shown[key] += STEP; draw(); } }, t('logs.more', { n: Math.min(STEP, total - st.shown[key]) }))
    : null);

  function problemsSection(rows) {
    const groups = groupProblems(rows, { now: now() });
    const since = sinceOf(rows);
    return h('section', { class: 'lg-sec', 'aria-labelledby': 'lg-problems' },
      h('h3', { id: 'lg-problems' }, t('logs.problems'), groups.length ? h('span', { class: 'lg-sec-count num' }, String(groups.length)) : null),
      groups.length
        ? h('ul', { class: 'lg-list' }, groups.map(groupItem))
        : emptyState({ h, icon: ctx.icon }, { art: 'check', title: t('logs.none.title'), text: t('logs.none.text', { date: since ? day(since) : '—' }), compact: true }));
  }

  function routineSection(rows) {
    const list = routineRows(rows);
    if (!list.length) return null;
    return h('details', { class: 'lg-routine', open: open.has('routine') ? true : null, ontoggle: (e) => {
      if (e.target.open) open.add('routine'); else open.delete('routine');
    } },
    h('summary', {}, t('logs.routine'), h('span', { class: 'lg-sec-count num' }, String(list.length))),
    h('p', { class: 'lg-hint' }, t('logs.routine.hint')),
    h('ul', { class: 'lg-list' }, list.slice(0, st.shown.routine).map(routineItem)),
    more('routine', list.length));
  }

  function projectSection() {
    const list = projects();
    if (!list.length) return null;
    const id = pickedProject();
    const rows = st.projectRows;
    return h('section', { class: 'lg-sec', 'aria-labelledby': 'lg-project' },
      h('h3', { id: 'lg-project' }, t('logs.project')),
      h('p', { class: 'lg-hint' }, t('logs.project.lede')),
      h('label', { class: 'dv-field' }, h('span', {}, t('logs.project.pick')),
        h('select', { name: 'logs-project', onchange: (e) => pick(e.target.value) },
          list.map((p) => h('option', { value: p.id, selected: p.id === id }, p.name)))),
      st.projectError ? h('p', { class: 'notice is-error' }, ctx.errorText(st.projectError))
        : rows === null ? h('p', { class: 'muted' }, t('logs.loading'))
          : rows.length ? [h('ul', { class: 'lg-list' }, rows.slice(0, st.shown.project).map(projectItem)), more('project', rows.length)]
            : h('p', { class: 'muted' }, t('logs.project.none')));
  }

  function draw() {
    if (!rootEl) return;
    const rows = st.program;
    const since = rows ? sinceOf(rows) : null;
    rootEl.replaceChildren(h('div', { class: 'view-wrap lg-view' },
      h('div', { class: 'view-head' },
        h('h2', {}, t('logs.title')),
        h('button', { type: 'button', class: 'btn', onclick: () => reload() }, t('logs.reload'))),
      h('p', { class: 'view-lede' }, t('logs.lede')),
      st.programError ? h('p', { class: 'notice is-error' }, ctx.errorText(st.programError))
        : rows === null ? h('p', { class: 'muted' }, t('logs.loading'))
          : [
            h('p', { class: 'lg-since' }, since ? t('logs.since', { date: day(since), n: rows.length }) : t('logs.empty')),
            problemsSection(rows),
            routineSection(rows),
          ],
      projectSection()));
  }

  async function loadProgram() {
    const run = ++programRun;
    const res = await ctx.api.logs({ limit: PROGRAM_LIMIT });
    if (run !== programRun) return false;
    const rows = res.ok && Array.isArray(res.rows) ? res.rows : null;
    const changed = rowsSignature(rows) !== rowsSignature(st.program) || (res.ok ? null : res.error) !== st.programError;
    st.programError = res.ok ? null : res.error ?? 'generic';
    st.program = rows;
    return changed;
  }

  async function loadProject() {
    const id = pickedProject();
    if (!id) { st.projectRows = null; st.projectError = null; return false; }
    const run = ++projectRun;
    const res = await ctx.api.projectLog(id, { limit: PROJECT_LIMIT });
    if (run !== projectRun || id !== pickedProject()) return false;
    const rows = res.ok && Array.isArray(res.rows) ? res.rows : null;
    const changed = rowsSignature(rows) !== rowsSignature(st.projectRows) || (res.ok ? null : res.error) !== st.projectError;
    st.projectError = res.ok ? null : res.error ?? 'generic';
    st.projectRows = rows;
    return changed;
  }

  async function pick(id) {
    st.project = id;
    st.projectRows = null;
    st.projectError = null;
    st.shown.project = STEP;
    draw();
    if (await loadProject()) draw();
  }

  async function reload() {
    await Promise.all([loadProgram(), loadProject()]);
    draw();
  }

  return {
    // The area was just opened (or the language changed): draw at once, then fill in.
    async render(root) {
      rootEl = root;
      draw();
      await reload();
    },
    // The state was polled: read again, and draw only when a new line arrived.
    async refresh(root) {
      rootEl = root;
      const [a, b] = await Promise.all([loadProgram(), loadProject()]);
      if (a || b) draw();
    },
  };
}
