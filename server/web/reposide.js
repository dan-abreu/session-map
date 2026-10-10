// The project's folders and files on the left of the mind map (mind-map-page mm39): the real tree of the project, mirrored
// from the root box, its folders opened one at a time, each file opened in the read-only viewer of the Files tab.
// The list is the one the Files tab reads (all files, with their lines); what is new, changed or removed and not saved yet
// comes from the Changes tab's rows of the folder, so a file made a moment ago shows up before the count knows it.
import { api } from './api.js';
import { fileTree } from './code.js';

const LIST_TTL_MS = 30_000; // like files.js: the server recounts at most this often anyway
const MARKS_TTL_MS = 8_000; // what changed in the folder: a new file appears within seconds
const MORE_AT = 40; // boxes in one folder before the rest folds into one "+N more" box
export const PREF_KEY = 'sm.filesSide';

// The server never lists a secrets file (files.mjs isSecretsFile): .env and .env.local, but not .env.example.
const SECRETS_RE = /^\.env(\..+)?$/i;
const TEMPLATE_RE = /\.(example|sample|template|dist)$/i;
const isSecrets = (path) => {
  const name = String(path).split('/').pop();
  return SECRETS_RE.test(name) && !TEMPLATE_RE.test(name);
};

// The folder's unsaved changes as the Files tab's letters (A new, M changed, D removed). A file the count does not list
// yet (too new, or gone) is added; its lines come from the folder's own row, else from the conversation's steps. The newest
// step decides: made then removed is not shown at all. A file only edited and not listed is one the count leaves out on
// purpose (dependencies, generated, binary), so it stays out; so does a secrets file, always. The old place of a moved file
// reads removed.
export function withStatus(files, rows) {
  const byPath = new Map();
  const put = (path, r) => {
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(r);
  };
  for (const r of rows) {
    if (r.state !== 'pending' || !r.inFolder || !r.path) continue;
    put(r.path, r);
  }
  for (const r of rows) if (r.state === 'pending' && r.inFolder && r.kind === 'rename' && r.from) put(r.from, { ...r, kind: 'delete', path: r.from });
  const newestFirst = (mine) => [...mine].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  // The count is kept for 30 s: a listed file can already be gone.
  const statusOf = (mine, listed) => {
    const made = mine.some((r) => r.kind === 'create' || r.kind === 'rename');
    if (newestFirst(mine)[0].kind === 'delete') return made ? null : 'D';
    if (made) return 'A';
    return listed ? 'M' : null;
  };
  const linesOf = (mine) => {
    const own = mine.find((r) => r.id?.startsWith('wt:') && r.kind === 'create');
    if (own) return own.added;
    let n;
    for (const r of [...mine].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
      if (r.kind === 'create') n = r.added;
      else if (n !== undefined && r.kind === 'edit') n = Math.max(0, n + r.added - r.removed);
    }
    return n;
  };
  const kept = files.filter((f) => !isSecrets(f.path));
  const listed = new Set(kept.map((f) => f.path));
  const out = kept.map((f) => (byPath.has(f.path) ? { ...f, status: statusOf(byPath.get(f.path), true) } : { ...f, status: f.status ?? null }));
  for (const [path, mine] of byPath) {
    if (listed.has(path) || isSecrets(path)) continue;
    const status = statusOf(mine, false);
    if (!status) continue;
    const lines = status === 'D' ? undefined : linesOf(mine);
    out.push({ path, status, ...(lines === undefined ? {} : { lines }) });
  }
  return out;
}

const fileNode = (f) => ({ id: `rf:${f.path}`, kind: 'file', side: 'left', label: f.name, path: f.path, lines: f.lines, status: f.status ?? null, children: [] });

// A big folder shows MORE_AT boxes, folders first, then the files marked new, changed or removed, then the rest, each kept in
// its place; one last box stands for the others until it is pressed (expanded holds its id).
function capped(path, children, expanded) {
  if (children.length <= MORE_AT || expanded.has(`rm:${path}`)) return children;
  const rank = (c) => (c.kind === 'folder' ? 0 : c.status ? 1 : 2);
  const shown = new Set(children.map((c, i) => [c, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).slice(0, MORE_AT).map(([c]) => c));
  const more = children.length - MORE_AT;
  return [...children.filter((c) => shown.has(c)), { id: `rm:${path}`, kind: 'more', side: 'left', label: `+${more}`, path, more, children: [] }];
}

// A folder counts the files in it, not the removed ones; its chip counts every mark, removed included.
function folderNode(dir, expanded) {
  const all = [...dir.dirs.map((d) => folderNode(d, expanded)), ...dir.files.map(fileNode)];
  const sum = (key, own) => all.reduce((n, c) => n + (c.kind === 'folder' ? c[key] : own(c) ? 1 : 0), 0);
  const count = sum('count', (c) => c.status !== 'D');
  const changed = sum('changed', (c) => c.status);
  return { id: `rd:${dir.path}`, kind: 'folder', side: 'left', label: dir.name, path: dir.path, count, changed, children: capped(dir.path, all, expanded) };
}

// The boxes hung on the left of the root: the project's first level, folders first, like the Files tab.
export function repoNodes(files, { expanded = new Set() } = {}) {
  const top = fileTree(files);
  return capped('', [...top.dirs.map((d) => folderNode(d, expanded)), ...top.files.map(fileNode)], expanded);
}

// The files side of the map: its data, kept per project and asked again when it gets old (each time the map is drawn, so
// every state the page receives can bring a new file), which folders are open while the page lives, and the boxes.
// ctx: h, t (translator getter), lang (getter), store, project (getter), files (the Files tab's viewer), toast, button
// (the toolbar's on/off), visible() when the map is on screen (nothing is read for a hidden map), onChange(opts) to draw the
// map again, onFit(first) to show it whole after the side is turned on/off (first: the files just arrived).
export function createRepoSide({ h, t, lang, store, project, files, toast, button, visible, onChange, onFit }) {
  let on = store.get(PREF_KEY) !== '0';
  const data = new Map(); // project id → {list, listAt, rows, rowsAt, busy, marked, nodes}
  const opened = new Map(); // project id → the folders open
  const expanded = new Map(); // project id → the "+N more" boxes pressed

  const paintButton = () => button?.setAttribute('aria-pressed', String(on));
  paintButton();
  button?.addEventListener('click', () => {
    on = !on;
    store.set(PREF_KEY, on ? '1' : '0');
    paintButton();
    onChange();
    onFit(false);
  });

  const entry = (id) => {
    if (!data.has(id)) data.set(id, { list: null, listAt: -Infinity, rows: [], rowsAt: -Infinity, busy: false, marked: null, nodes: null });
    return data.get(id);
  };
  const setOf = (map, id) => {
    if (!map.has(id)) map.set(id, new Set());
    return map.get(id);
  };
  const openOf = (id) => setOf(opened, id);
  const sigOf = (list) => JSON.stringify(list.map((x) => [x.path, x.lines, x.kind, x.added, x.removed]));

  // A failed read is not asked again before its time either: the side keeps what it had, or stays away.
  async function refresh(id, e) {
    const now = Date.now();
    const wantList = now - e.listAt > LIST_TTL_MS;
    const wantRows = now - e.rowsAt > MARKS_TTL_MS;
    if (e.busy || (!wantList && !wantRows)) return;
    e.busy = true;
    if (wantList) e.listAt = now;
    if (wantRows) e.rowsAt = now;
    const [list, marks] = await Promise.all([wantList ? api.files(id, { all: '1' }) : null, wantRows ? api.changes(id) : null]);
    e.busy = false;
    let changed = false;
    if (list?.ok) {
      changed = !e.list || sigOf(list.files) !== sigOf(e.list);
      e.list = list.files;
    }
    if (marks?.ok) {
      const rows = marks.rows.filter((r) => r.state === 'pending' && r.inFolder);
      changed ||= sigOf(rows) !== sigOf(e.rows);
      e.rows = rows;
    }
    if (!changed || !e.list) return;
    const first = !e.marked;
    e.marked = withStatus(e.list, e.rows);
    e.nodes = null;
    if (!on || project()?.id !== id) return;
    onChange();
    // The first time the side arrives the map is shown whole again, files included, unless the person moved it already.
    if (first) onFit(true);
  }

  // The rest of a big folder, once asked for.
  function showAll(node) {
    const id = project().id;
    setOf(expanded, id).add(node.id);
    entry(id).nodes = null;
    onChange({ anchor: node.path ? `rd:${node.path}` : null });
  }

  function toggle(node) {
    const set = openOf(project().id);
    if (set.has(node.id)) set.delete(node.id);
    else set.add(node.id);
    onChange({ anchor: node.id });
  }

  function content(node) {
    const tt = t();
    if (node.kind === 'more') return [h('span', { class: 'bx-title rs-more' }, tt.count('map.moreFiles', node.more))];
    if (node.kind === 'folder') {
      return [
        h('span', { class: 'bx-title rs-name' }, node.label),
        h('span', { class: 'bx-meta' }, h('span', { class: 'num' }, tt.count('size.files', node.count)),
          node.changed ? h('span', { class: 'bx-chip rs-changed', title: tt('map.folderChangedTitle') }, tt.count('map.folderChanged', node.changed)) : null),
      ];
    }
    const status = node.status
      ? [h('span', { class: `rs-status st-${node.status}`, 'aria-hidden': 'true' }, node.status), h('span', { class: 'visually-hidden' }, `${tt(`wc.status.${node.status}`)}: `)]
      : [];
    return [
      h('span', { class: 'bx-title rs-name', title: node.status === 'D' ? tt('map.fileGone') : tt('map.fileRead', { path: node.path }) }, ...status, node.label),
      node.lines !== undefined ? h('span', { class: 'bx-meta num' }, tt.count('files.lines', node.lines)) : null,
    ].filter(Boolean);
  }

  const ctx = {
    content,
    signature: (node) => JSON.stringify([lang(), node.label, node.count, node.changed, node.lines, node.status, node.more]),
    toggleLabel: (node, isOpen) => t()(isOpen ? 'map.collapse' : 'map.expand', { name: node.label }),
    onToggle: toggle,
    // A folder opens like its toggle; a file opens in the Files tab's viewer, read only.
    onPick: (node) => {
      if (node.kind === 'more') return showAll(node);
      if (node.kind === 'folder') return toggle(node);
      if (node.status === 'D') return toast(t()('map.fileGone'));
      return files().open(node.path);
    },
  };

  // What the map draws on the left of the root now, or null: turned off, or nothing read yet.
  function view() {
    const p = project();
    if (!on || !p) return null;
    const e = entry(p.id);
    if (visible()) refresh(p.id, e);
    if (e.marked && !e.nodes) e.nodes = repoNodes(e.marked, { expanded: setOf(expanded, p.id) });
    return e.nodes?.length ? { tree: { id: 'files', children: e.nodes }, open: openOf(p.id), ctx } : null;
  }

  return { view };
}
