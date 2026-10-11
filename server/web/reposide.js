// The project's folders and files on the left of the mind map (mind-map-page mm39): the real tree of the project, mirrored
// from the root box, its folders opened one at a time, each file opened in the read-only viewer of the Files tab.
// The list is the one the Files tab reads (all files, with their lines); what is new, changed or removed and not saved yet
// comes from the Changes tab's rows of the folder, so a file made a moment ago shows up before the count knows it.
import { api } from './api.js';
import { fileTree } from './code.js';
import { ancestorsOf, nodeById } from './tree.js';
import { agentTone } from './workflows.js';

const LIST_TTL_MS = 30_000; // like files.js: the server recounts at most this often anyway
const MARKS_TTL_MS = 8_000; // what changed in the folder: a new file appears within seconds
const MORE_AT = 40; // boxes in one folder before the rest folds into one "+N more" box
const PICK_OPEN_MAX = 40; // a part picked with more files than this lights the way to them without opening it (mm40)
const HOVER_LEAVE_MS = 150; // a pointer passing from box to box keeps the light instead of flashing it off and on
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

// loose: a file the count read and no part of the map holds (owners: [], one of mm25's files with no box), drawn apart
// (mm42); a file too new for the count has no owners at all and is not one of them.
const fileNode = (f) => ({
  id: `rf:${f.path}`, kind: 'file', side: 'left', label: f.name, path: f.path, lines: f.lines, status: f.status ?? null,
  loose: Array.isArray(f.owners) && !f.owners.length, children: [],
});

// A big folder shows MORE_AT boxes, folders first, then the files marked new, changed or removed, then the rest, each kept in
// its place; one last box stands for the others until it is pressed (expanded holds its id).
function capped(path, children, expanded) {
  if (children.length <= MORE_AT || expanded.has(`rm:${path}`)) return children;
  const rank = (c) => (c.kind === 'folder' ? 0 : c.status ? 1 : 2);
  const shown = new Set(children.map((c, i) => [c, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).slice(0, MORE_AT).map(([c]) => c));
  const more = children.length - MORE_AT;
  return [...children.filter((c) => shown.has(c)), { id: `rm:${path}`, kind: 'more', side: 'left', label: `+${more}`, path, more, children: [] }];
}

// A folder counts the files in it, not the removed ones; its chip counts every mark, removed included; loose, the files in
// it with no box.
function folderNode(dir, expanded) {
  const all = [...dir.dirs.map((d) => folderNode(d, expanded)), ...dir.files.map(fileNode)];
  const sum = (key, own) => all.reduce((n, c) => n + (c.kind === 'folder' ? c[key] : own(c) ? 1 : 0), 0);
  const count = sum('count', (c) => c.status !== 'D');
  const changed = sum('changed', (c) => c.status);
  return { id: `rd:${dir.path}`, kind: 'folder', side: 'left', label: dir.name, path: dir.path, count, changed, loose: sum('loose', (c) => c.loose), children: capped(dir.path, all, expanded) };
}

// The boxes hung on the left of the root: the project's first level, folders first, like the Files tab.
export function repoNodes(files, { expanded = new Set() } = {}) {
  const top = fileTree(files);
  return capped('', [...top.dirs.map((d) => folderNode(d, expanded)), ...top.files.map(fileNode)], expanded);
}

// Who holds what (mm40), built once per list: file → its parts (as the server read them, the boxes' own counts), folder →
// the parts of every file inside it, part → its files. Every lookup after that is one step.
export function ownerIndex(files) {
  const index = { files: new Map(), folders: new Map(), parts: new Map() };
  for (const f of files) {
    if (!f.owners?.length) continue;
    index.files.set(f.path, f.owners);
    const segments = f.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const folder = segments.slice(0, i).join('/');
      if (!index.folders.has(folder)) index.folders.set(folder, new Set());
      for (const id of f.owners) index.folders.get(folder).add(id);
    }
    for (const id of f.owners) {
      if (!index.parts.has(id)) index.parts.set(id, []);
      index.parts.get(id).push(f.path);
    }
  }
  return index;
}

// The parts a file or a folder belongs to.
export function partsOf(node, index) {
  if (node.kind === 'file') return index.files.get(node.path) ?? [];
  if (node.kind === 'folder') return [...(index.folders.get(node.path) ?? [])];
  return [];
}

// The boxes on the way to some files as the side draws them now: lit (the folders, the files, and a "+N more" box that hides
// one), the folders to open to see them, and the "+N more" boxes to press.
export function reach(nodes, paths) {
  const lit = new Set();
  const open = new Set();
  const more = new Set();
  for (const path of paths) {
    let level = nodes;
    while (level) {
      const hit = level.find((c) => (c.kind === 'file' && c.path === path) || (c.kind === 'folder' && path.startsWith(`${c.path}/`)));
      if (!hit) {
        const box = level.find((c) => c.kind === 'more');
        if (box) {
          lit.add(box.id);
          more.add(box.id);
        }
        break;
      }
      lit.add(hit.id);
      if (hit.kind === 'file') break;
      open.add(hit.id);
      level = hit.children;
    }
  }
  return { lit, open, more };
}

// The files being edited now (mm41): a conversation at work whose last step (thinking aside) is an edit, and each of its
// helpers still running whose last step is one. A helper's place is already a path of its project; anything else is the
// step's own words, matched by matchPaths.
export function editTargets(entries, { projectId, nowMs = Date.now() } = {}) {
  const out = [];
  for (const e of entries) {
    const now = (e.steps ?? []).find((s) => s.kind !== 'think');
    if (now?.kind === 'edit' && now.target) out.push(now.target);
    for (const w of e.workflows ?? []) {
      for (const a of w.agents ?? []) {
        if (agentTone(a, nowMs) !== 'running' || a.step?.kind !== 'edit') continue;
        const target = a.place?.projectId === projectId && a.place.path ? a.place.path : a.step.target;
        if (target) out.push(target);
      }
    }
  }
  return out;
}

const ABSOLUTE_RE = /^(?:[a-z]:)?\//i;

// A step names a file from the conversation's own folder, its start cut with "…" when long: the project's file it means.
// Exactly, or else ending with it at a whole name (a conversation working inside server/ writes web/app.js; a cut name
// loses its broken first piece), and only when one file fits.
export function matchPaths(targets, paths) {
  const all = new Set(paths);
  const out = new Set();
  for (const target of targets) {
    if (all.has(target)) {
      out.add(target);
      continue;
    }
    let tail = target;
    if (tail.startsWith('…')) {
      tail = tail.slice(1);
      if (!tail.startsWith('/')) tail = tail.includes('/') ? tail.slice(tail.indexOf('/')) : '';
    } else if (ABSOLUTE_RE.test(tail)) tail = '';
    else tail = `/${tail}`;
    if (tail.length < 2) continue;
    const hits = paths.filter((p) => p.endsWith(tail));
    if (hits.length === 1) out.add(hits[0]);
  }
  return out;
}

// The files side of the map: its data, kept per project and asked again when it gets old (each time the map is drawn, so
// every state the page receives can bring a new file), which folders are open while the page lives, and the boxes.
// ctx: h, t (translator getter), lang (getter), store, project (getter), files (the Files tab's viewer), toast, button
// (the toolbar's on/off), visible() when the map is on screen (nothing is read for a hidden map), onChange(opts) to draw the
// map again, onFit(first) to show it whole after the side is turned on/off (first: the files just arrived).
export function createRepoSide({ h, t, lang, store, project, files, toast, button, visible, onChange, onFit }) {
  let on = store.get(PREF_KEY) !== '0';
  const data = new Map(); // project id → {list, listAt, rows, rowsAt, busy, marked, index, paths, nodes, byId, live}
  const opened = new Map(); // project id → the folders open
  const expanded = new Map(); // project id → the "+N more" boxes pressed
  let hovered = null; // {projectId, id}: the box of this side pointed at or focused now (mm40)
  let hoverKey = ''; // the parts it lights, so the map is drawn again only when they change
  let leaveTimer = 0;
  let pickedKey = null; // `${projectId}|${box id}`: the part picked whose folders were opened already

  const paintButton = () => button?.setAttribute('aria-checked', String(on));
  paintButton();
  button?.addEventListener('click', () => {
    on = !on;
    store.set(PREF_KEY, on ? '1' : '0');
    paintButton();
    onChange();
    onFit(false);
  });

  const entry = (id) => {
    if (!data.has(id)) {
      data.set(id, { list: null, listAt: -Infinity, rows: [], rowsAt: -Infinity, busy: false, marked: null, index: null, paths: [], nodes: null, byId: new Map(), live: new Set() });
    }
    return data.get(id);
  };
  const setOf = (map, id) => {
    if (!map.has(id)) map.set(id, new Set());
    return map.get(id);
  };
  const openOf = (id) => setOf(opened, id);
  const sigOf = (list) => JSON.stringify(list.map((x) => [x.path, x.lines, x.kind, x.added, x.removed, x.owners?.join(',')]));

  function buildNodes(p, e) {
    e.nodes = repoNodes(e.marked, { expanded: setOf(expanded, p.id) });
    e.byId = new Map();
    const walk = (n) => {
      e.byId.set(n.id, n);
      n.children.forEach(walk);
    };
    e.nodes.forEach(walk);
  }

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
    e.index = ownerIndex(e.marked);
    e.paths = e.marked.map((f) => f.path);
    e.nodes = null;
    if (!on || project()?.id !== id) return;
    onChange();
    // The first time the side arrives the map is shown whole again, files included, unless the person moved it already.
    if (first) onFit(true);
  }

  // ---- the two sides together (mm40) ----

  // The parts of the box pointed at, in the project shown now; a box that went away lights nothing.
  function hoverParts(p, e) {
    if (!hovered || !p || hovered.projectId !== p.id || !e.index) return [];
    const node = e.byId.get(hovered.id);
    if (!node) {
      hovered = null;
      return [];
    }
    return partsOf(node, e.index);
  }

  function relight() {
    const p = project();
    const key = p ? hoverParts(p, entry(p.id)).join(',') : '';
    if (key === hoverKey) return;
    hoverKey = key;
    onChange();
  }

  // Pointing at a box lights at once; leaving waits a moment, and the next box pointed at cancels the wait.
  function hover(node, isOn) {
    const p = project();
    if (!p) return;
    clearTimeout(leaveTimer);
    if (isOn) {
      hovered = { projectId: p.id, id: node.id };
      relight();
    } else if (hovered?.id === node.id) {
      leaveTimer = setTimeout(() => {
        hovered = null;
        relight();
      }, HOVER_LEAVE_MS);
    }
  }

  // The map's boxes the box pointed at belongs to, with every box on the way to them; null: nothing to light.
  function hoverLit(tree, p, e) {
    const ids = hoverParts(p, e).map((id) => `pt:${id}`).filter((id) => nodeById(tree, id));
    return ids.length ? new Set(ids.flatMap((id) => [...ancestorsOf(tree, id), id])) : null;
  }

  // A part picked on the right lights its files here. Picked as a box (not a conversation or a line of work standing for
  // it), a part with few files also opens the way to them, once per pick; a big one lights only the folders and the "+N more"
  // boxes that hold them, and opens nothing.
  function pickLit(p, e, selected, opens) {
    const partId = selected?.startsWith('pt:') ? selected.slice(3) : null;
    if (!partId) {
      pickedKey = null;
      return null;
    }
    const paths = e.index.parts.get(partId) ?? [];
    const key = `${p.id}|${selected}`;
    if (opens && pickedKey !== key) {
      pickedKey = key;
      for (let round = 0; paths.length <= PICK_OPEN_MAX && round < 8; round++) {
        const way = reach(e.nodes, paths);
        for (const id of way.open) openOf(p.id).add(id);
        if (!way.more.size) break;
        for (const id of way.more) setOf(expanded, p.id).add(id);
        buildNodes(p, e);
      }
    }
    return reach(e.nodes, paths).lit;
  }

  // ---- the boxes ----

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

  // What the box says without words of its own: the live dot (mm41), the parts it belongs to (mm40) and "not on the map yet"
  // (mm42) live in its title and in text only a screen reader reads.
  const isLive = (node) => entry(project().id).live.has(node.id);
  const namesOf = (node) => {
    const p = project();
    const e = entry(p.id);
    if (!e.index) return '';
    const mine = new Set(partsOf(node, e.index));
    return (p.arch?.parts ?? []).filter((x) => mine.has(x.id)).map((x) => x.name).join(', ');
  };
  const liveDot = (tt) => h('span', { class: 'bx-live', title: tt('box.live') }, h('span', { class: 'visually-hidden' }, tt('box.live')));

  function content(node) {
    const tt = t();
    const live = isLive(node) ? liveDot(tt) : null;
    if (node.kind === 'more') return [h('span', { class: 'bx-title rs-more' }, tt.count('map.moreFiles', node.more)), live].filter(Boolean);
    const names = namesOf(node);
    const placed = names ? tt('map.fileIn', { parts: names }) : null;
    if (node.kind === 'folder') {
      const loose = node.loose ? tt.count('map.folderLoose', node.loose) : null;
      return [
        h('span', { class: 'bx-title rs-name', title: placed ?? '' }, node.label),
        h('span', { class: 'bx-meta' }, h('span', { class: 'num' }, tt.count('size.files', node.count)),
          loose ? h('span', { class: 'rs-loose-dot', title: loose }, h('span', { class: 'visually-hidden' }, loose)) : null,
          node.changed ? h('span', { class: 'bx-chip rs-changed', title: tt('map.folderChangedTitle') }, tt.count('map.folderChanged', node.changed)) : null),
        placed ? h('span', { class: 'visually-hidden' }, placed) : null,
        live,
      ].filter(Boolean);
    }
    const status = node.status
      ? [h('span', { class: `rs-status st-${node.status}`, 'aria-hidden': 'true' }, node.status), h('span', { class: 'visually-hidden' }, `${tt(`wc.status.${node.status}`)}: `)]
      : [];
    const notes = [node.loose ? tt('map.fileLoose') : null, placed].filter(Boolean);
    const title = [node.status === 'D' ? tt('map.fileGone') : tt('map.fileRead', { path: node.path }), ...notes].join('\n');
    return [
      h('span', { class: 'bx-title rs-name', title }, ...status, node.label),
      node.lines !== undefined ? h('span', { class: 'bx-meta num' }, tt.count('files.lines', node.lines)) : null,
      notes.length ? h('span', { class: 'visually-hidden' }, notes.join('. ')) : null,
      live,
    ].filter(Boolean);
  }

  const ctx = {
    content,
    onHover: hover,
    classes: (node) => ({ 'is-loose': node.kind === 'file' && node.loose }),
    signature: (node) => JSON.stringify([lang(), node.label, node.count, node.changed, node.lines, node.status, node.more, node.loose, isLive(node), namesOf(node)]),
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

  // What the map draws on the left of the root now, or null: turned off, or nothing read yet. tree: the map's own tree;
  // selected: the id of the box picked on it; opens: it was picked as a box; working: the conversations at work now (live.js
  // workingIn). Besides the boxes: lit (this side's boxes a picked part lights), live (this side's boxes where work goes on)
  // and hoverLit (the map's boxes the box pointed at here belongs to, or null).
  function view({ tree, selected = null, opens = false, working = [] } = {}) {
    const p = project();
    if (!on || !p) return null;
    const e = entry(p.id);
    if (visible()) refresh(p.id, e);
    if (!e.marked) return null;
    if (!e.nodes) buildNodes(p, e);
    if (!e.nodes.length) return null;
    const lit = pickLit(p, e, selected, opens);
    e.live = reach(e.nodes, matchPaths(editTargets(working, { projectId: p.id }), e.paths)).lit;
    return { tree: { id: 'files', children: e.nodes }, open: openOf(p.id), ctx, lit, live: e.live, hoverLit: hoverLit(tree, p, e) };
  }

  return { view };
}
