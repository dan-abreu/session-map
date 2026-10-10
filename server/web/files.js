import { api } from './api.js';
import { fileTree, findInLines, langOf, markTokens, tokenize } from './code.js';
import { kindCounts } from './tree.js';
import { changedLines } from './views.js';

const LIST_TTL_MS = 30_000;
// ponytail: a 1 MB file can have tens of thousands of lines; the page draws them in slices. Virtual scrolling when someone needs it.
const SLICE = 1500;
// Small trees open whole, like the editor with few files; bigger ones open their first level.
const OPEN_ALL_MAX = 40;
const SEARCH_MS = 120;

// Read-only files of a part or a branch (desenho-2 § 29, mm26): a folder tree like the editor's explorer and a viewer with the
// code in colors, line numbers, search in the file, the files it uses and that use it, and Open in VS Code at the line.
// ctx: dialog (the viewer), h, t (translator getter), toast, errorText, project (getter of the current project).
export function createFiles({ dialog, h, t, toast, errorText, project }) {
  const lists = new Map();
  // Folders the person opened or closed, kept while the page lives, so a refresh of the panel keeps the tree as it was.
  const folded = new Map();

  // The box's files by kind (mm25): "Screens 3 · Code 12 · Tests 4".
  function kinds(files) {
    const tt = t();
    const list = kindCounts(files);
    return list.length ? h('p', { class: 'files-kinds' }, list.map((k) => h('span', { class: `files-kind fk-${k.kind}`, title: tt('files.lines', { n: k.lines }) }, tt(`files.kind.${k.kind}`), h('span', { class: 'num' }, String(k.files))))) : null;
  }

  function fileRow(f, onOpen) {
    const tt = t();
    const status = f.status ? [h('span', { class: 'file-status', 'aria-hidden': 'true' }, f.status), h('span', { class: 'visually-hidden' }, `${tt(`wc.status.${f.status}`)}: `)] : [];
    // A removed file has nothing left to read.
    if (f.status === 'D') return h('li', { class: 'file st-D', title: tt('files.removed') }, status, f.name);
    const lines = f.lines !== undefined ? h('span', { class: 'file-lines num' }, tt('files.lines', { n: f.lines })) : null;
    return h('li', { class: `file${f.status ? ` st-${f.status}` : ''}` },
      h('button', { type: 'button', class: 'file-open', onclick: () => onOpen(f) }, status, h('span', { class: 'file-name' }, f.name), lines));
  }

  function folder(dir, key, onOpen, openAll, depth) {
    const tt = t();
    const id = `${key}|${dir.path}`;
    const isOpen = folded.has(id) ? folded.get(id) : openAll || depth === 0;
    const el = h('details', { class: 'ft-dir', open: isOpen },
      h('summary', { class: 'ft-summary' }, h('span', { class: 'ft-name' }, dir.name), h('span', { class: 'ft-count num', title: tt('files.inFolder', { n: dir.count }) }, String(dir.count))),
      branch(dir, key, onOpen, openAll, depth + 1));
    el.addEventListener('toggle', () => folded.set(id, el.open));
    return h('li', { class: 'ft-item' }, el);
  }

  function branch(node, key, onOpen, openAll, depth) {
    return h('ul', { class: 'ft-list' }, node.dirs.map((d) => folder(d, key, onOpen, openAll, depth)), node.files.map((f) => fileRow(f, onOpen)));
  }

  function rows(files, key, onOpen) {
    return h('div', { class: 'organelle-list' }, kinds(files), h('div', { class: 'ftree' }, branch(fileTree(files), key, onOpen, files.length <= OPEN_ALL_MAX, 0)));
  }

  // scope: {workCell, files} (the branch's own list, already in the state) or {part} (asked from the server, kept for a while).
  function tree(scope) {
    const el = h('div', { class: 'files-tree' });
    const key = `${project().id}|${scope.part ?? scope.workCell}`;
    const draw = (files) => el.replaceChildren(files.length ? rows(files, key, (f) => open(f.path, f.workCell ?? scope.workCell)) : h('p', { class: 'muted' }, t()('files.empty')));
    if (scope.files) {
      draw(scope.files);
      return el;
    }
    const hit = lists.get(key);
    if (hit) draw(hit.files);
    else el.replaceChildren(h('p', { class: 'muted' }, t()('files.loading')));
    if (!hit || Date.now() - hit.at > LIST_TTL_MS) {
      api.files(project().id, { part: scope.part }).then((res) => {
        if (!res.ok) return hit ? undefined : el.replaceChildren(h('p', { class: 'muted' }, errorText(res.error)));
        lists.set(key, { at: Date.now(), files: res.files });
        return draw(res.files);
      });
    }
    return el;
  }

  // line: an item's line in its part file, shown and marked like a changed one.
  async function open(path, workCell, { line = null } = {}) {
    const res = await api.file(project().id, path, workCell, !workCell);
    if (!res.ok) {
      toast(errorText(res.error));
      return;
    }
    view(path, workCell, line ? { ...res, changes: [{ from: line, to: line }], itemLine: line } : res);
  }

  function linksPanel(links, workCell) {
    const tt = t();
    if (!links?.graph) return null;
    const list = (title, items, empty) => h('div', { class: 'fl-group' },
      h('h3', { class: 'fl-title' }, title, h('span', { class: 'num ft-count' }, String(items.length))),
      items.length
        ? h('ul', { class: 'fl-list' }, items.map((x) => h('li', {}, h('button', { type: 'button', class: 'fl-link', onclick: () => open(x.path, workCell) },
          h('span', { class: 'fl-path' }, x.path), h('span', { class: 'fl-line num' }, tt('files.atLine', { n: x.line }))))))
        : h('p', { class: 'muted small' }, empty));
    return h('details', { class: 'file-links', open: links.uses.length + links.usedBy.length <= 12 },
      h('summary', {}, tt('files.links', { uses: links.uses.length, usedBy: links.usedBy.length })),
      h('div', { class: 'fl-groups' },
        list(tt('files.uses'), links.uses, tt('files.usesNone')),
        list(tt('files.usedBy'), links.usedBy, tt('files.usedByNone'))),
      links.libraries.length ? h('p', { class: 'fl-libs' }, h('span', { class: 'muted' }, tt('files.libraries')), links.libraries.map((l) => h('code', { class: 'fl-lib' }, l))) : null);
  }

  function view(path, workCell, file) {
    const tt = t();
    const marks = changedLines(file.changes);
    const lines = file.text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const tokens = tokenize(lines.join('\n'), langOf(path));
    const code = h('ol', { class: 'code', 'aria-label': tt('files.codeLabel', { path }) });
    let shown = 0;
    let current = marks.first ?? 1;
    let hits = [];
    let at = -1;
    const more = h('button', { type: 'button', class: 'btn' }, '');
    const vscodeLabel = h('span', {}, '');
    const setCurrent = (n) => {
      current = n;
      vscodeLabel.textContent = tt('files.openVscodeAt', { n });
      for (const li of code.querySelectorAll('.ln.is-current')) li.classList.remove('is-current');
      code.children[n - 1]?.classList.add('is-current');
    };
    const paint = (i) => {
      const li = code.children[i];
      if (!li) return;
      const mine = hits.map((x, n) => ({ ...x, n })).filter((x) => x.line === i);
      const pieces = markTokens(tokens[i] ?? [], mine);
      li.replaceChildren(
        ...(marks.has(i + 1) ? [h('span', { class: 'visually-hidden' }, `${tt('wc.status.M')}: `)] : []),
        ...(pieces.length ? pieces.map((p) => {
          const cls = p.c ? `tk-${p.c}` : '';
          if (p.hit) return h('mark', { class: `fs-hit${cls ? ` ${cls}` : ''}`, 'data-hit': String(mine[p.k].n) }, p.s);
          return cls ? h('span', { class: cls }, p.s) : p.s;
        }) : [' ']));
    };
    const draw = (upTo) => {
      for (; shown < Math.min(upTo, lines.length); shown++) {
        code.append(h('li', { class: marks.has(shown + 1) ? 'ln is-changed' : 'ln', 'data-n': String(shown + 1) }));
        paint(shown);
      }
      more.hidden = shown >= lines.length;
      more.textContent = `${tt('files.more', { n: lines.length - shown })}`;
    };
    more.addEventListener('click', () => draw(shown + SLICE));
    // A click on a line picks it for Open in VS Code.
    code.addEventListener('click', (e) => {
      const li = e.target.closest?.('.ln');
      if (li) setCurrent(Number(li.dataset.n));
    });
    draw(Math.max(SLICE, (marks.first ?? 0) + 40));

    const count = h('span', { class: 'fs-count num', role: 'status' }, '');
    const goTo = (i) => {
      if (!hits.length) return;
      at = (i + hits.length) % hits.length;
      const hit = hits[at];
      if (hit.line >= shown) draw(hit.line + 40);
      for (const m of code.querySelectorAll('.fs-hit.is-current')) m.classList.remove('is-current');
      for (const m of code.querySelectorAll(`mark[data-hit="${at}"]`)) m.classList.add('is-current');
      code.children[hit.line]?.scrollIntoView({ block: 'center' });
      setCurrent(hit.line + 1);
      count.textContent = tt('files.found', { i: at + 1, n: hits.length });
    };
    let searchTimer = 0;
    const search = h('input', { type: 'search', class: 'fs-input', placeholder: tt('files.search'), 'aria-label': tt('files.search'), autocomplete: 'off' });
    const runSearch = () => {
      const before = new Set(hits.map((x) => x.line));
      hits = findInLines(lines, search.value);
      at = -1;
      for (const i of new Set([...before, ...hits.map((x) => x.line)])) if (i < shown) paint(i);
      count.textContent = search.value && !hits.length ? tt('files.notFound') : '';
      if (hits.length) goTo(0);
    };
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, SEARCH_MS); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimer);
        if (at === -1) runSearch();
        else goTo(at + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape' && search.value) {
        e.preventDefault();
        e.stopPropagation();
        search.value = '';
        runSearch();
      }
    });
    const prev = h('button', { type: 'button', class: 'btn fs-step', 'aria-label': tt('files.prev'), title: tt('files.prev'), onclick: () => goTo(at - 1) }, '↑');
    const next = h('button', { type: 'button', class: 'btn fs-step', 'aria-label': tt('files.next'), title: tt('files.next'), onclick: () => goTo(at + 1) }, '↓');

    const openInVscode = async () => {
      const out = await api.action({ action: 'open-file', projectId: project().id, path, ...(workCell ? { workCell } : {}), line: current });
      toast(out.ok ? tt('files.openVscodeDone') : errorText(out.error));
    };
    dialog.replaceChildren(
      h('div', { class: 'file-head' },
        h('div', { class: 'file-title' },
          h('h2', { id: 'fileTitle' }, h('code', {}, path)),
          h('p', { class: 'meta' }, `${tt('files.readOnly')} · ${tt('files.lines', { n: file.lines })} · ${file.itemLine ? tt('files.itemLine', { n: file.itemLine }) : file.changes.length ? tt('files.changes') : tt('files.noChanges')}`)),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', onclick: openInVscode, title: tt('files.fromPhone') }, vscodeLabel),
          h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('files.close')))),
      h('div', { class: 'file-tools' }, h('label', { class: 'fs-field' }, search), count, prev, next),
      linksPanel(file.links, workCell),
      h('div', { class: 'file-body' }, code, more));
    setCurrent(current);
    dialog.classList.remove('is-change');
    if (!dialog.open) dialog.showModal();
    code.querySelector('.is-changed')?.scrollIntoView({ block: 'center' });
  }

  return { tree, open, close: () => dialog.close() };
}
