import { api } from './api.js';
import { emptyState } from './empty.js';

// The census screen (fd01, "Census"): the table of counted files by folder or by part, what the count left out, the
// statement of each count (in, out, changed, balance before and after) and the line about how much was read. The pure
// functions on top are tested; the view below draws them and is hung on the repository panel by block B2. A piece of
// data the program has not produced yet is shown as "not read yet", never as zero. The screen only reads.

const REASONS = ['dep', 'generated', 'binary', 'secret'];
const SHOWN = 20;
const NONE = '_none';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const count = (x) => (Number.isFinite(x) ? x : 0);
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const cellOf = (s) => ({
  files: count(s?.files), bytes: count(s?.bytes), chars: count(s?.chars), words: count(s?.words),
  lines: { total: count(s?.lines?.total), code: count(s?.lines?.code), comment: count(s?.lines?.comment), blank: count(s?.lines?.blank) },
});

function minus(a, b) {
  return {
    files: a.files - b.files, bytes: a.bytes - b.bytes, chars: a.chars - b.chars, words: a.words - b.words,
    lines: { total: a.lines.total - b.lines.total, code: a.lines.code - b.lines.code, comment: a.lines.comment - b.lines.comment, blank: a.lines.blank - b.lines.blank },
  };
}

function plus(a, b) {
  return {
    files: a.files + b.files, bytes: a.bytes + b.bytes, chars: a.chars + b.chars, words: a.words + b.words,
    lines: { total: a.lines.total + b.lines.total, code: a.lines.code + b.lines.code, comment: a.lines.comment + b.lines.comment, blank: a.lines.blank + b.lines.blank },
  };
}

const usable = (census) => isObject(census) && isObject(census.sums) && isObject(census.sums.total);

// Counted files nobody owns, per folder (with its subfolders) and per directory (only the files sitting in it).
function orphansOf(census) {
  const within = new Map();
  const direct = new Map();
  for (const f of Array.isArray(census.files) ? census.files : []) {
    if (!f?.included || f.owner || typeof f.path !== 'string') continue;
    let dir = parentOf(f.path);
    direct.set(dir, (direct.get(dir) ?? 0) + 1);
    for (;;) {
      within.set(dir, (within.get(dir) ?? 0) + 1);
      if (!dir) break;
      dir = parentOf(dir);
    }
  }
  return { within, direct };
}

function withShare(rows, total) {
  const whole = total.lines.total;
  return rows.map((r) => ({ ...r, percent: whole > 0 ? Math.round((r.lines.total / whole) * 1000) / 10 : null }));
}

// The rows of the table. by 'folder' (default): the subfolders of `folder` ('' = the whole project) plus one row for the
// files sitting directly in it, so the rows always add up to the folder. by 'part': one row per part of the map, the
// ownerless files last and marked. Each row: kind, id, name, path, files, bytes, chars, words, lines, percent (of the
// table's lines), noOwner (all its files are ownerless) and noOwnerFiles. null when there is no census yet.
export function censusRows(census, { by = 'folder', folder = '' } = {}) {
  if (!usable(census)) return null;
  const { sums } = census;
  const orphans = orphansOf(census);
  if (by === 'part') {
    const parts = isObject(sums.parts) ? sums.parts : {};
    const rows = Object.keys(parts).filter((id) => id !== NONE).map((id) => {
      const cell = cellOf(parts[id]);
      return { kind: 'part', id, name: id, path: '', ...cell, noOwner: false, noOwnerFiles: 0 };
    }).sort((a, b) => b.lines.total - a.lines.total || byCodeUnit(a.name, b.name));
    const none = cellOf(parts[NONE]);
    if (none.files > 0) rows.push({ kind: 'part', id: NONE, name: NONE, path: '', ...none, noOwner: true, noOwnerFiles: none.files });
    return withShare(rows, cellOf(sums.total));
  }
  const folders = isObject(sums.folders) ? sums.folders : {};
  const base = folder ? folders[folder] : sums.total;
  if (!base) return [];
  const whole = cellOf(base);
  const subs = Object.keys(folders).filter((key) => parentOf(key) === folder);
  const rows = subs.map((path) => {
    const cell = cellOf(folders[path]);
    const lost = orphans.within.get(path) ?? 0;
    return { kind: 'folder', id: path, name: path.slice(path.lastIndexOf('/') + 1), path, ...cell, noOwner: cell.files > 0 && lost === cell.files, noOwnerFiles: lost };
  }).sort((a, b) => b.lines.total - a.lines.total || byCodeUnit(a.name, b.name));
  const here = minus(whole, subs.reduce((acc, key) => plus(acc, cellOf(folders[key])), cellOf(null)));
  if (here.files > 0) {
    const lost = orphans.direct.get(folder) ?? 0;
    rows.push({ kind: 'here', id: '__here', name: '', path: folder, ...here, noOwner: lost === here.files, noOwnerFiles: lost });
  }
  return withShare(rows, whole);
}

// What the count left out, by reason: the total the census holds (it also counts what it does not list, like installed
// libraries) and the files it names, with their size. null when there is no census yet.
export function excludedRows(census) {
  if (!isObject(census)) return null;
  const files = (Array.isArray(census.files) ? census.files : []).filter((f) => f && f.included === false && typeof f.path === 'string');
  const totals = isObject(census.excluded) ? census.excluded : {};
  const seen = new Set(files.map((f) => f.reason ?? f.kind));
  const reasons = [...REASONS, ...[...seen, ...Object.keys(totals)].filter((r) => r && !REASONS.includes(r)).sort()];
  const rows = [];
  for (const reason of [...new Set(reasons)]) {
    const listed = files.filter((f) => (f.reason ?? f.kind) === reason).map((f) => ({ path: f.path, bytes: count(f.bytes) }));
    const n = Math.max(count(totals[reason]), listed.length);
    if (n > 0) rows.push({ reason, count: n, files: listed });
  }
  return rows;
}

const delta = (list, key) => list.reduce((n, f) => n + count(f.after?.[key]) - count(f.before?.[key]), 0);
const sumOf = (list, key) => list.reduce((n, f) => n + count(f[key]), 0);

// The lines of census-log.jsonl as a bank statement, the newest first: what came in, went out and changed, with the
// balance (files, lines, characters) before and after. `balanced` says whether the lines add up. A line that moved nothing
// or that is not a statement line is left out.
export function statementRows(log) {
  const rows = [];
  for (const raw of Array.isArray(log) ? log : []) {
    if (!isObject(raw) || !Number.isInteger(raw.rev) || !isObject(raw.totals?.before) || !isObject(raw.totals?.after)) continue;
    const added = Array.isArray(raw.added) ? raw.added.filter(isObject) : [];
    const removed = Array.isArray(raw.removed) ? raw.removed.filter(isObject) : [];
    const changed = Array.isArray(raw.changed) ? raw.changed.filter(isObject) : [];
    if (!added.length && !removed.length && !changed.length) continue;
    const side = (s) => ({ files: count(s.files), lines: count(s.lines), chars: count(s.chars) });
    const before = side(raw.totals.before);
    const after = side(raw.totals.after);
    const entered = { files: added.length, lines: sumOf(added, 'lines'), chars: sumOf(added, 'chars') };
    const left = { files: removed.length, lines: sumOf(removed, 'lines'), chars: sumOf(removed, 'chars') };
    const moved = { files: changed.length, lines: delta(changed, 'lines'), chars: delta(changed, 'chars') };
    rows.push({
      rev: raw.rev, from: Number.isInteger(raw.from) ? raw.from : 0, at: typeof raw.at === 'string' ? raw.at : null,
      entered, left, changed: moved, before, after,
      balanced: before.lines + entered.lines - left.lines + moved.lines === after.lines && before.files + entered.files - left.files === after.files,
      details: [
        ...added.map((f) => ({ kind: 'added', path: String(f.path), lines: count(f.lines), chars: count(f.chars) })),
        ...removed.map((f) => ({ kind: 'removed', path: String(f.path), lines: count(f.lines), chars: count(f.chars) })),
        ...changed.map((f) => ({ kind: 'changed', path: String(f.path), lines: count(f.after?.lines) - count(f.before?.lines), chars: count(f.after?.chars) - count(f.before?.chars) })),
      ],
    });
  }
  return rows.sort((a, b) => b.rev - a.rev);
}

const spanText = ([from, to]) => (from === to ? String(from) : `${from}-${to}`);
const spansOf = (spans) => (Array.isArray(spans) ? spans.filter((s) => Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1])) : []);

// The line about reading ("Read X of Y characters (Z %)") and, when it is not all, what is still to read. summary is the
// `summary` of read-ledger.json; fmt writes a number. A missing summary, or one with nothing to read, is "not read yet".
export function readLine(summary, t, fmt = String) {
  const ok = isObject(summary) && Number.isFinite(summary.readChars) && Number.isFinite(summary.totalChars) && summary.totalChars > 0;
  if (!ok) return { unread: true, complete: false, text: t('census.read.unread'), missing: [] };
  const missing = (Array.isArray(summary.missing) ? summary.missing : []).filter((m) => isObject(m) && typeof m.path === 'string').map((m) => {
    const spans = spansOf(m.spans);
    return {
      path: m.path, spans, open: { file: m.path, line: spans.length ? spans[0][0] : null },
      label: t('census.read.missingAt', { path: m.path, spans: spans.map(spanText).join(', ') }),
    };
  });
  const percent = Number.isFinite(summary.percent) ? summary.percent : Math.floor((summary.readChars / summary.totalChars) * 100);
  return {
    unread: false, complete: percent >= 100 && !missing.length,
    text: t('census.read.line', { read: fmt(summary.readChars), total: fmt(summary.totalChars), percent: fmt(percent) }),
    missing,
  };
}

const NUMBER_COLUMNS = ['files', 'lines', 'code', 'comment', 'blank', 'chars', 'words', 'share'];
const valueOf = (row, col) => {
  if (col === 'files') return row.files;
  if (col === 'chars') return row.chars;
  if (col === 'words') return row.words;
  if (col === 'share') return row.percent;
  return col === 'lines' ? row.lines.total : row.lines[col];
};
const totalOf = (rows) => {
  const sum = rows.reduce((acc, r) => plus(acc, r), cellOf(null));
  return { ...sum, percent: sum.lines.total > 0 ? 100 : null };
};
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

export function createCensusView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const lang = () => (typeof ctx.lang === 'function' ? ctx.lang() : 'en');
  const state = { census: undefined, log: [], ledger: null, error: null, by: 'folder', folder: '' };
  let run = 0;
  let els = null;

  const projectId = () => ctx.project().id;
  const num = (n) => count(n).toLocaleString(lang());
  const stamp = (iso) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '';
  };

  async function load() {
    const mine = ++run;
    const id = projectId();
    const [census, log, ledger] = await Promise.all([api.fd(id, 'census'), api.fd(id, 'census/log'), api.fd(id, 'ledger')]);
    if (mine !== run) return;
    state.error = [census, log, ledger].find((r) => !r.ok)?.error ?? null;
    state.census = census.ok ? census.data : null;
    state.log = log.ok && Array.isArray(log.data) ? log.data : [];
    state.ledger = ledger.ok ? ledger.data : null;
    if (state.folder && !state.census?.sums?.folders?.[state.folder]) state.folder = '';
    draw();
  }

  function setBy(by) {
    state.by = by;
    state.folder = '';
    draw();
  }

  function openFolder(path) {
    state.folder = path;
    draw();
  }

  function rowEl(row, tt) {
    const label = row.kind === 'here' ? tt('census.row.here') : row.id === NONE ? tt('census.row.noOwner') : row.name;
    const name = row.kind === 'folder'
      ? h('button', { type: 'button', class: 'fdc-folder', onclick: () => openFolder(row.path) }, row.name)
      : h('span', {}, label);
    return h('tr', { class: `fdc-row fdc-${row.kind}${row.noOwner ? ' is-noowner' : ''}`, 'data-row': row.kind === 'here' ? '__here' : row.id },
      h('th', { scope: 'row', class: 'fdc-name' }, name,
        row.noOwner && row.id !== NONE ? h('span', { class: 'fdc-tag' }, ` ${tt('census.row.noOwner')}`)
          : row.noOwnerFiles > 0 && row.id !== NONE ? h('span', { class: 'fdc-tag' }, ` ${tt('census.noOwner.tag', { n: num(row.noOwnerFiles) })}`) : null),
      NUMBER_COLUMNS.map((col) => {
        const v = valueOf(row, col);
        return h('td', { class: 'num' }, v === null ? '' : col === 'share' ? `${v.toLocaleString(lang(), { maximumFractionDigits: 1 })} %` : num(v));
      }));
  }

  function tableEl(rows, tt) {
    const total = totalOf(rows);
    return h('div', { class: 'al-table-wrap fdc-table-wrap' }, h('table', { class: 'al-table fdc-table', 'aria-label': tt('census.table.label') },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, tt('census.col.name')), NUMBER_COLUMNS.map((col) => h('th', { scope: 'col', class: 'num' }, tt(`census.col.${col}`))))),
      h('tbody', {}, rows.map((r) => rowEl(r, tt))),
      h('tfoot', {}, h('tr', { class: 'fdc-total', 'data-row': '__total' },
        h('th', { scope: 'row' }, tt('census.total')),
        NUMBER_COLUMNS.map((col) => {
          const v = valueOf(total, col);
          return h('td', { class: 'num' }, v === null ? '' : col === 'share' ? `${v} %` : num(v));
        })))));
  }

  function controlsEl(tt) {
    const seg = (by) => h('button', { type: 'button', 'aria-pressed': String(state.by === by), onclick: () => setBy(by) }, tt(`census.by.${by}`));
    const crumb = state.by === 'folder' && state.folder
      ? h('div', { class: 'fdc-crumb' },
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => openFolder(state.folder.includes('/') ? state.folder.slice(0, state.folder.lastIndexOf('/')) : '') }, tt('census.up')),
        h('span', { class: 'fdc-where' }, ` ${tt('census.crumb.root')} / ${state.folder}`))
      : null;
    return h('div', { class: 'fdc-controls' }, h('div', { class: 'seg', role: 'group', 'aria-label': tt('census.by.label') }, seg('folder'), seg('part')), crumb);
  }

  function excludedEl(tt) {
    const rows = excludedRows(state.census);
    if (!rows?.length) return null;
    const listed = (r) => r.files.slice(0, SHOWN);
    return h('details', { class: 'fdc-excluded' },
      h('summary', {}, h('strong', {}, tt('census.excluded.title'))),
      h('p', { class: 'view-note' }, tt('census.excluded.lede')),
      rows.map((r) => h('section', { class: 'fdc-reason', 'data-reason': r.reason },
        h('h4', { class: 'fdc-sub' }, tt(`census.excluded.${r.reason}`), ' ', h('span', { class: 'num' }, tt.count('census.files', r.count))),
        h('ul', { class: 'fdc-files' }, listed(r).map((f) => h('li', {}, h('code', {}, f.path))),
          r.count > listed(r).length ? h('li', { class: 'fdc-more' }, tt('census.excluded.more', { n: num(r.count - listed(r).length) })) : null))));
  }

  function detailEl(d, tt) {
    const word = d.kind === 'added' ? 'in' : d.kind === 'removed' ? 'out' : 'changed';
    return h('li', {},
      h('span', { class: `fdc-kind fdc-kind--${d.kind}` }, tt(`census.statement.${word}`)), ' ',
      h('code', {}, d.path), ' ',
      h('span', { class: 'num' }, signed(d.kind === 'removed' ? -d.lines : d.lines)));
  }

  function statementLineEl(r, tt) {
    const cell = (label, value) => h('span', { class: 'fdc-cell' }, h('small', {}, label), ' ', h('span', { class: 'num' }, value));
    const more = r.details.length > SHOWN ? h('li', { class: 'fdc-more' }, tt('census.excluded.more', { n: num(r.details.length - SHOWN) })) : null;
    return h('li', { class: 'fdc-item' },
      h('details', { class: `fdc-line${r.balanced ? '' : ' is-off'}`, 'data-rev': String(r.rev) },
        h('summary', {},
          h('span', { class: 'fdc-rev' }, tt('census.statement.count', { rev: r.rev }), r.at ? ` · ${stamp(r.at)}` : ''),
          cell(tt('census.statement.before'), num(r.before.lines)),
          cell(tt('census.statement.in'), signed(r.entered.lines)),
          cell(tt('census.statement.out'), signed(-r.left.lines)),
          cell(tt('census.statement.changed'), signed(r.changed.lines)),
          cell(tt('census.statement.after'), num(r.after.lines))),
        r.balanced ? null : h('p', { class: 'fdc-off' }, tt('census.statement.off')),
        h('ul', { class: 'fdc-files' }, r.details.slice(0, SHOWN).map((d) => detailEl(d, tt)), more)));
  }

  function statementEl(tt) {
    const rows = statementRows(state.log);
    return h('section', { class: 'fdc-statement' },
      h('h3', {}, tt('census.statement.title')),
      h('p', { class: 'view-note' }, rows.length ? tt('census.statement.unit') : tt('census.statement.empty')),
      h('ol', { class: 'fdc-lines' }, rows.slice(0, SHOWN).map((r) => statementLineEl(r, tt))),
      rows.length > SHOWN ? h('p', { class: 'view-note' }, tt('census.statement.more', { n: num(rows.length - SHOWN) })) : null);
  }

  function readEl(tt) {
    const line = readLine(state.ledger?.summary, tt, num);
    const where = (m) => (m.open && ctx.openFile
      ? h('button', { type: 'button', class: 'fdc-where', title: tt('census.read.open', { path: m.path }), onclick: () => ctx.openFile(m.open.file, m.open.line) }, m.label)
      : h('code', { class: 'fdc-where' }, m.label));
    return h('section', { class: `fdc-read${line.complete ? ' is-complete' : ''}${line.unread ? ' is-unread' : ''}` },
      h('h3', {}, tt('census.read.title')),
      h('p', { class: 'fdc-read-line' }, line.text),
      line.missing.length ? h('div', {},
        h('h4', { class: 'fdc-sub' }, tt('census.read.missing')),
        h('ul', { class: 'fdc-files' }, line.missing.slice(0, SHOWN).map((m) => h('li', {}, where(m))),
          line.missing.length > SHOWN ? h('li', { class: 'fdc-more' }, tt('census.read.more', { n: num(line.missing.length - SHOWN) })) : null)) : null);
  }

  function body() {
    const tt = t();
    if (state.census === undefined) return [h('p', { class: 'view-note' }, tt('census.loading'))];
    const rows = censusRows(state.census, { by: state.by, folder: state.folder });
    return [
      state.error ? h('p', { class: 'view-note fdc-error' }, ctx.errorText(state.error)) : null,
      readEl(tt),
      rows === null
        ? emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('census.unread.title'), text: tt('census.unread.text'), compact: true })
        : h('section', { class: 'fdc-table-section' },
          controlsEl(tt), tableEl(rows, tt),
          rows.some((r) => r.noOwner || r.noOwnerFiles) ? h('p', { class: 'view-note fdc-noowner-note' }, tt('census.noOwner.note')) : null),
      rows === null ? null : excludedEl(tt),
      statementEl(tt),
    ];
  }

  function draw() {
    if (els) els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    const tt = t();
    els = { body: h('div', { class: 'fdc-body', 'aria-live': 'polite' }) };
    root.replaceChildren(h('div', { class: 'view-wrap wide fdc-view' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('census.title'))),
      h('p', { class: 'view-lede' }, tt('census.lede')),
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
