import { api } from './api.js';
import { filesByFolder } from './tree.js';
import { changedLines } from './views.js';

const LIST_TTL_MS = 30_000;
// ponytail: a 1 MB file can have tens of thousands of lines; the page draws them in slices. Virtual scrolling when someone needs it.
const SLICE = 1500;

// Read-only files of a part or a branch (desenho-2 § 29): a folder tree in the panel and a viewer that marks the lines the branch changed.
// ctx: dialog (the viewer), h, t (translator getter), toast, errorText, project (getter of the current project).
export function createFiles({ dialog, h, t, toast, errorText, project }) {
  const lists = new Map();

  function rows(files, onOpen) {
    const tt = t();
    return h('div', { class: 'organelle-list' }, filesByFolder(files).map((group) => h('div', { class: 'folder' },
      h('span', { class: 'folder-name' }, group.folder || tt('wc.root')),
      h('ul', {}, group.files.map((f) => {
        const status = f.status ? [h('span', { class: 'file-status', 'aria-hidden': 'true' }, f.status), h('span', { class: 'visually-hidden' }, `${tt(`wc.status.${f.status}`)}: `)] : [];
        // A removed file has nothing left to read.
        if (f.status === 'D') return h('li', { class: 'file st-D', title: tt('files.removed') }, status, f.name);
        return h('li', { class: `file${f.status ? ` st-${f.status}` : ''}` },
          h('button', { type: 'button', class: 'file-open', onclick: () => onOpen(f) }, status, f.name));
      })))));
  }

  // scope: {workCell, files} (the branch's own list, already in the state) or {part} (asked from the server, kept for a while).
  function tree(scope) {
    const el = h('div', { class: 'files-tree' });
    const draw = (files) => el.replaceChildren(files.length ? rows(files, (f) => open(f.path, f.workCell ?? scope.workCell)) : h('p', { class: 'muted' }, t()('files.empty')));
    if (scope.files) {
      draw(scope.files);
      return el;
    }
    const key = `${project().id}|${scope.part}`;
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
    const res = await api.file(project().id, path, workCell);
    if (!res.ok) {
      toast(errorText(res.error));
      return;
    }
    view(path, workCell, line ? { ...res, changes: [{ from: line, to: line }], itemLine: line } : res);
  }

  function view(path, workCell, file) {
    const tt = t();
    const marks = changedLines(file.changes);
    const lines = file.text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const code = h('ol', { class: 'code' });
    let shown = 0;
    const more = h('button', { type: 'button', class: 'btn' }, '');
    const draw = (upTo) => {
      for (; shown < Math.min(upTo, lines.length); shown++) {
        const changed = marks.has(shown + 1);
        code.append(h('li', { class: changed ? 'ln is-changed' : 'ln' },
          changed ? h('span', { class: 'visually-hidden' }, `${tt('wc.status.M')}: `) : null, lines[shown] || ' '));
      }
      more.hidden = shown >= lines.length;
      more.textContent = `${tt('files.more', { n: lines.length - shown })}`;
    };
    more.addEventListener('click', () => draw(shown + SLICE));
    draw(Math.max(SLICE, (marks.first ?? 0) + 40));
    const openInVscode = async () => {
      const out = await api.action({ action: 'open-file', projectId: project().id, path, ...(workCell ? { workCell } : {}), line: marks.first ?? 1 });
      toast(out.ok ? tt('files.openVscodeDone') : errorText(out.error));
    };
    dialog.replaceChildren(
      h('div', { class: 'file-head' },
        h('div', {},
          h('h2', { id: 'fileTitle' }, h('code', {}, path)),
          h('p', { class: 'meta' }, `${tt('files.readOnly')} · ${tt('files.lines', { n: file.lines })} · ${file.itemLine ? tt('files.itemLine', { n: file.itemLine }) : file.changes.length ? tt('files.changes') : tt('files.noChanges')}`)),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', onclick: openInVscode, title: tt('files.fromPhone') }, tt('files.openVscode')),
          h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('files.close')))),
      h('div', { class: 'file-body' }, code, more));
    dialog.showModal();
    code.querySelector('.is-changed')?.scrollIntoView({ block: 'center' });
  }

  return { tree, open, close: () => dialog.close() };
}
