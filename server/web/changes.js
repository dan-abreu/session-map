import { api } from './api.js';
import { langOf, tokenize } from './code.js';
import { emptyState } from './empty.js';
import { modelName } from './live.js';
import { inRange } from './range.js';
import { dayName, localDay, timeOf } from './transcript.js';
import { workflowHue } from './workflows.js';

// The Changes tab (mind-map-page mm30): every file the conversations and their helpers created, edited, removed or renamed,
// live, with who did it, where it sits on the map, its lines, whether it is saved and released, and its before and after.
// The pure functions on top are tested; the view below draws them.

export const CHANGE_KINDS = ['create', 'edit', 'delete', 'rename'];
const KIND_ICON = { create: 'plus', edit: 'code', delete: 'trash', rename: 'rename' };
const NONE = '-';

// f: {projectId, partId, sessionId, kind, range {from, to}, day}; '' or undefined is "every"; '-' is "none" (no box, no conversation).
export function filterChanges(rows, f = {}) {
  const pick = (value, wanted) => !wanted || (wanted === NONE ? value == null : value === wanted);
  return rows.filter((r) => pick(r.projectId, f.projectId) && pick(r.partId, f.partId) && pick(r.sessionId, f.sessionId)
    && (!f.kind || r.kind === f.kind) && inRange(Date.parse(r.ts), f.range ?? null) && (!f.day || localDay(r.ts) === f.day));
}

const tally = (list) => ({ n: list.length, files: new Set(list.map((r) => `${r.projectId}|${r.path}`)).size, added: list.reduce((s, r) => s + r.added, 0), removed: list.reduce((s, r) => s + r.removed, 0) });

// One entry per day with changes, oldest first: how many changes, distinct files and lines.
export function changeDays(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = localDay(r.ts);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, ...tally(list) }));
}

export function changeTotals(rows) {
  const by = (state) => rows.filter((r) => r.state === state).length;
  return { ...tally(rows), pending: by('pending'), saved: by('saved'), released: by('released') };
}

// The list cut into days, newest day first (rows arrive newest first).
export function changeGroups(rows) {
  const groups = [];
  for (const r of rows) {
    const day = localDay(r.ts);
    if (groups.at(-1)?.day !== day) groups.push({ day, rows: [] });
    groups.at(-1).rows.push(r);
  }
  return groups;
}

// What lights a box: the project's recent changes ({files, lines, parts}) for a part, a layer (its parts added up) or the project.
// Who made a change, in words: the conversation, or its helper (and the helper's team, mm31), and the model.
export function whoWords(tt, row) {
  if (!row.sessionId) return tt('changes.who.outside');
  const title = row.title || tt('chat.untitled');
  const model = modelName(row.agent?.model ?? row.model);
  if (!row.agent) return [title, model].filter(Boolean).join(' · ');
  const label = row.agent.label || tt('changes.who.helperUnnamed');
  const who = row.agent.workflow ? tt('changes.who.team', { label, team: row.agent.workflow.name }) : tt('changes.who.helper', { label });
  return [who, title, model].filter(Boolean).join(' · ');
}

export function freshFor(fresh, node) {
  if (!fresh) return null;
  if (node.kind === 'project') return { files: fresh.files, lines: fresh.lines };
  const ids = node.kind === 'part' ? [node.partId] : node.kind === 'layer' ? node.partIds ?? [] : [];
  const hits = ids.map((id) => fresh.parts[id]).filter(Boolean);
  return hits.length ? { files: hits.reduce((n, x) => n + x.files, 0), lines: hits.reduce((n, x) => n + x.lines, 0) } : null;
}

// The lines of one piece of a before and after, numbered in the old and the new file (no number when the piece has no place).
export function hunkRows(hunk) {
  let old = hunk.oldStart > 0 ? hunk.oldStart : null;
  let cur = hunk.newStart > 0 ? hunk.newStart : null;
  return hunk.lines.map((line) => {
    const sign = line[0] === '+' || line[0] === '-' ? line[0] : ' ';
    const row = { sign, old: sign === '+' ? null : old, new: sign === '-' ? null : cur, text: line.slice(1) };
    if (sign !== '+' && old !== null) old++;
    if (sign !== '-' && cur !== null) cur++;
    return row;
  });
}

const splitPath = (path) => {
  const cut = path.lastIndexOf('/');
  return { folder: cut < 0 ? '' : path.slice(0, cut + 1), name: path.slice(cut + 1) };
};

// ctx: h, t (getter), lang (getter), icon, state(), project(), range(), rangeButton(), dialog (the file dialog), files (the
// navigator: open(path)), go(projectId, sel), toast, errorText, relative(ts), number(n).
export function createChangesView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const pick = { scope: 'project', partId: '', sessionId: '', kind: '', day: '' };
  let rows = null;
  let rowsKey = null;
  let seen = new Set();
  let run = 0;
  let els = null;

  const projectById = (id) => ctx.state().projects.find((p) => p.id === id);
  const partName = (row) => projectById(row.projectId)?.arch.parts.find((x) => x.id === row.partId)?.name ?? null;
  const scopeId = () => (pick.scope === '*' ? '*' : ctx.project().id);

  function kindChip(kind) {
    return h('span', { class: `chg-kind ck-${kind}` }, ctx.icon(KIND_ICON[kind], 'chg-kind-icon'), t()(`changes.kind.${kind}`));
  }

  function stateChip(row) {
    const tt = t();
    const words = row.state === 'released' ? tt('changes.state.releasedIn', { tag: row.tag }) : tt(`changes.state.${row.state}`);
    return h('span', { class: `chg-state cs-${row.state}`, title: row.hash ? tt('changes.state.hashTitle', { hash: row.hash.slice(0, 7) }) : null }, words);
  }

  function linesChip(row) {
    if (row.kind === 'rename' && !row.added && !row.removed) return null;
    return h('span', { class: 'chg-lines num', 'aria-label': t()('changes.linesAria', { added: row.added, removed: row.removed }) },
      h('span', { class: 'add' }, `+${ctx.number(row.added)}`), h('span', { class: 'del' }, `−${ctx.number(row.removed)}`));
  }

  function rowEl(row) {
    const tt = t();
    const { folder, name } = splitPath(row.path);
    const where = [pick.scope === '*' ? projectById(row.projectId)?.name : null, partName(row) ?? tt('changes.noBox')].filter(Boolean).join(' › ');
    const fresh = rowsKey && !seen.has(row.id);
    return h('li', { class: `chg-row${fresh ? ' is-new' : ''}` }, h('button', { type: 'button', class: 'chg-btn', onclick: () => openChange(row) },
      kindChip(row.kind),
      h('span', { class: 'chg-file' },
        h('span', { class: 'chg-name' }, name),
        folder ? h('span', { class: 'chg-folder' }, folder) : null,
        row.from ? h('span', { class: 'chg-from' }, tt('changes.renamedFrom', { from: row.from })) : null),
      linesChip(row),
      h('span', { class: 'chg-meta' },
        h('span', { class: 'chg-where' }, where),
        h('span', { class: 'chg-who' }, whoWords(t(), row)),
        h('span', { class: 'chg-time num' }, timeOf(ctx.lang(), row.ts))),
      stateChip(row)));
  }

  function timeline(list) {
    const tt = t();
    const days = changeDays(list);
    if (!days.length) return null;
    const max = Math.max(...days.map((d) => d.files));
    const shown = days.slice(-31);
    return h('section', { class: 'chg-days', 'aria-labelledby': 'chgDaysTitle' },
      h('div', { class: 'chg-days-head' },
        h('h3', { id: 'chgDaysTitle' }, tt('changes.days')),
        pick.day ? h('button', { type: 'button', class: 'btn chg-all-days', onclick: () => { pick.day = ''; draw(); } }, tt('changes.allDays')) : null),
      h('ol', { class: 'chg-bars' }, shown.map((d) => {
        const label = dayName(tt, ctx.lang(), d.day);
        return h('li', {}, h('button', {
          type: 'button', class: `chg-bar${pick.day === d.day ? ' is-on' : ''}`, 'aria-pressed': String(pick.day === d.day),
          'aria-label': tt('changes.dayAria', { day: label, n: d.n, files: d.files }), title: `${label} · ${tt('changes.linesAria', { added: d.added, removed: d.removed })}`,
          onclick: () => { pick.day = pick.day === d.day ? '' : d.day; draw(); },
        },
        h('span', { class: 'chg-bar-n num', 'aria-hidden': 'true' }, String(d.files)),
        h('span', { class: 'chg-bar-track', 'aria-hidden': 'true' }, h('span', { class: 'chg-bar-fill', style: `height:${Math.max(6, Math.round((d.files / max) * 100))}%` })),
        h('span', { class: 'chg-bar-day', 'aria-hidden': 'true' }, shortDay(d.day))));
      })));
  }

  const shortDay = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Intl.DateTimeFormat(ctx.lang(), { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
  };

  function summary(list) {
    const tt = t();
    const total = changeTotals(list);
    const stat = (value, label, cls = '') => h('div', { class: `chg-stat ${cls}` }, h('dd', { class: 'num' }, value), h('dt', {}, label));
    return h('dl', { class: 'chg-summary' },
      stat(ctx.number(total.files), tt.count('changes.filesWord', total.files)),
      stat(h('span', {}, h('span', { class: 'add' }, `+${ctx.number(total.added)}`), ' ', h('span', { class: 'del' }, `−${ctx.number(total.removed)}`)), tt('changes.linesWord'), 'is-lines'),
      stat(ctx.number(total.pending), tt('changes.state.pending'), 'cs-pending'),
      stat(ctx.number(total.saved), tt('changes.state.saved'), 'cs-saved'),
      stat(ctx.number(total.released), tt('changes.state.released'), 'cs-released'));
  }

  function options(select, entries, all, none) {
    if (document.activeElement === select) return;
    const value = select.value;
    select.replaceChildren(h('option', { value: '' }, all), ...(none ? [h('option', { value: NONE }, none)] : []), ...entries.map(([v, label]) => h('option', { value: v }, label)));
    select.value = [...select.options].some((o) => o.value === value) ? value : '';
  }

  function filtered() {
    return filterChanges(rows ?? [], { partId: pick.partId, sessionId: pick.sessionId, kind: pick.kind, range: ctx.range(), day: pick.day });
  }

  function draw() {
    if (!els) return;
    const tt = t();
    if (!rows) {
      els.body.replaceChildren(h('p', { class: 'view-note' }, tt('changes.loading')));
      return;
    }
    const inPeriod = filterChanges(rows, { range: ctx.range() });
    const parts = new Map();
    const chats = new Map();
    for (const r of inPeriod) {
      if (r.partId) parts.set(r.partId, partName(r) ?? r.partId);
      if (r.sessionId) chats.set(r.sessionId, r.title || tt('chat.untitled'));
    }
    options(els.part, [...parts].sort((a, b) => a[1].localeCompare(b[1])), tt('changes.partAll'), tt('changes.noBox'));
    options(els.chat, [...chats], tt('changes.chatAll'), tt('changes.who.outsideShort'));
    const list = filtered();
    const noDay = filterChanges(rows, { partId: pick.partId, sessionId: pick.sessionId, kind: pick.kind, range: ctx.range() });
    els.body.replaceChildren(
      summary(list),
      timeline(noDay),
      list.length
        ? h('div', { class: 'chg-list' }, changeGroups(list.slice(0, 500)).map((g) => h('section', { class: 'chg-day' },
          h('h3', { class: 'chg-day-title' }, dayName(tt, ctx.lang(), g.day), h('span', { class: 'num chg-day-n' }, tt.count('changes.count', g.rows.length))),
          h('ul', { class: 'chg-rows' }, g.rows.map(rowEl)))),
          list.length > 500 ? h('p', { class: 'view-note' }, tt('changes.more', { n: ctx.number(list.length - 500) })) : null)
        : emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('changes.empty.title'), text: tt('changes.empty.text') }));
    seen = new Set(rows.map((r) => r.id));
  }

  async function load() {
    const mine = ++run;
    const key = scopeId();
    const res = await api.changes(key);
    if (mine !== run) return;
    if (!res.ok) {
      if (!rows) els?.body.replaceChildren(h('p', { class: 'view-note' }, ctx.errorText(res.error)));
      return;
    }
    if (rowsKey !== key) seen = new Set(res.rows.map((r) => r.id));
    rows = res.rows;
    rowsKey = key;
    draw();
  }

  function build(root) {
    const tt = t();
    const seg = h('div', { class: 'seg chg-kinds', role: 'group', 'aria-label': tt('changes.kind.label') },
      ['', ...CHANGE_KINDS].map((k) => h('button', {
        type: 'button', 'aria-pressed': String(pick.kind === k), 'data-kind': k,
        onclick: (e) => {
          pick.kind = k;
          for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.kind === k));
          draw();
        },
      }, k ? t()(`changes.kind.${k}`) : tt('changes.kind.all'))));
    const scope = h('select', { name: 'changes-scope', onchange: (e) => { pick.scope = e.target.value; pick.partId = ''; pick.sessionId = ''; pick.day = ''; rows = null; draw(); load(); } },
      h('option', { value: 'project', selected: pick.scope === 'project' }, tt('changes.scope.project')),
      h('option', { value: '*', selected: pick.scope === '*' }, tt('changes.scope.all')));
    const part = h('select', { name: 'changes-part', onchange: (e) => { pick.partId = e.target.value; draw(); } });
    const chat = h('select', { name: 'changes-chat', onchange: (e) => { pick.sessionId = e.target.value; draw(); } });
    const body = h('div', { class: 'chg-body', 'aria-live': 'polite', 'aria-busy': 'false' });
    els = { part, chat, body };
    root.replaceChildren(h('div', { class: 'view-wrap wide chg-view' },
      h('div', { class: 'view-head' },
        h('div', { class: 'chg-title' },
          h('h2', { 'data-help': 'changes' }, tt('changes.title')),
          h('span', { class: 'chg-live' }, h('span', { class: 'chg-live-dot', 'aria-hidden': 'true' }), tt('changes.live'))),
        ctx.rangeButton()),
      h('p', { class: 'view-lede' }, tt('changes.lede')),
      h('div', { class: 'dv-tools chg-tools' },
        h('label', { class: 'dv-field' }, h('span', {}, tt('changes.scope.label')), scope),
        h('label', { class: 'dv-field' }, h('span', {}, tt('changes.part')), part),
        h('label', { class: 'dv-field' }, h('span', {}, tt('changes.chat')), chat),
        h('div', { class: 'dv-field' }, h('span', {}, tt('changes.kind.label')), seg)),
      body));
  }

  // ----- one change: its before and after -----

  function diffView(hunks, path) {
    const tt = t();
    const lang = langOf(path);
    const colored = (text) => (text ? tokenize(text, lang)[0].map((p) => (p.c ? h('span', { class: `tk-${p.c}` }, p.s) : p.s)) : ' ');
    return h('div', { class: 'chg-diff', role: 'group', 'aria-label': tt('changes.diffLabel', { path }) }, hunks.map((hunk) => h('table', { class: 'chg-hunk' },
      h('tbody', {}, hunkRows(hunk).map((r) => h('tr', { class: r.sign === '+' ? 'diff-add' : r.sign === '-' ? 'diff-del' : '' },
        h('td', { class: 'hn num', 'aria-hidden': 'true' }, r.old ?? ''),
        h('td', { class: 'hn num', 'aria-hidden': 'true' }, r.new ?? ''),
        h('td', { class: 'hs', 'aria-hidden': 'true' }, r.sign === ' ' ? '' : r.sign === '-' ? '−' : '+'),
        h('td', { class: 'ht' }, r.sign === '+' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffAdded')} `) : r.sign === '-' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffRemoved')} `) : null, colored(r.text))))))));
  }

  async function openChange(row) {
    const tt = t();
    const dialog = ctx.dialog;
    const head = h('div', { class: 'file-head' },
      h('div', { class: 'file-title' },
        h('p', { class: 'chg-dialog-kind' }, kindChip(row.kind), stateChip(row)),
        h('h2', { id: 'fileTitle' }, h('code', {}, row.path)),
        h('p', { class: 'meta' }, [whoWords(t(), row), `${dayName(tt, ctx.lang(), localDay(row.ts))} ${timeOf(ctx.lang(), row.ts)}`, partName(row)].filter(Boolean).join(' · '))),
      h('div', { class: 'actions' },
        row.kind !== 'delete' && row.projectId === ctx.project().id ? h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.files.open(row.path) }, tt('changes.openFile')) : null,
        row.sessionId ? h('button', { type: 'button', class: 'btn', onclick: () => { dialog.close(); ctx.go(row.projectId, { type: 'chat', id: row.sessionId }); } }, tt('changes.openChat')) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('changes.close'))));
    const body = h('div', { class: 'file-body chg-detail' }, h('p', { class: 'view-note' }, tt('changes.loading')));
    dialog.replaceChildren(head, body);
    dialog.classList.add('is-change');
    if (!dialog.open) dialog.showModal();
    const res = await api.change(row.projectId, row.id);
    if (!res.ok) return body.replaceChildren(h('p', { class: 'view-note' }, ctx.errorText(res.error)));
    const parts = [];
    // The way back from a changed file to what the owner asked (mm31).
    const ask = row.agent?.request;
    if (ask?.text) {
      parts.push(h('div', { class: 'chg-ask', style: `--wf-h:${workflowHue(row.agent.workflow.id)}` },
        h('p', { class: 'chg-ask-head' }, ctx.icon('chat', 'chg-ask-icon'), tt('changes.asked'), ask.ts ? h('span', { class: 'chg-ask-when num' }, ctx.relative(ask.ts)) : null),
        h('p', { class: 'chg-ask-text' }, ask.text),
        h('p', { class: 'chg-ask-by' }, h('span', { class: 'chg-ask-swatch', 'aria-hidden': 'true' }), tt('changes.askedBy', { team: row.agent.workflow.name, label: row.agent.label || tt('changes.who.helperUnnamed') }))));
    }
    if (row.from) parts.push(h('p', { class: 'chg-note' }, tt('changes.renamedFrom', { from: row.from })));
    if (res.error === 'sensitive') parts.push(h('p', { class: 'chg-note' }, tt('changes.sensitive')));
    else if (typeof res.before === 'string') {
      parts.push(h('h3', { class: 'chg-before-title' }, tt('changes.before')), diffView([{ oldStart: 1, newStart: 0, lines: res.before.replace(/\n$/, '').split('\n').map((l) => `-${l}`) }], row.path));
    } else if (res.hunks?.length) parts.push(diffView(res.hunks, row.path));
    else if (!row.from) parts.push(h('p', { class: 'chg-note' }, res.error ? ctx.errorText(res.error) : tt('changes.noDetail')));
    if (res.cut) parts.push(h('p', { class: 'view-note' }, tt('changes.cut')));
    return body.replaceChildren(...parts);
  }

  return {
    render(root) {
      build(root);
      draw();
      load();
    },
    refresh(root) {
      if (!els || !root.contains(els.body)) return this.render(root);
      return load();
    },
    openChange,
  };
}
