// The folder chooser (id164): walks the PC's folders the way VS Code's Open Folder does. The path can be typed or pasted
// (Enter goes there), the folders of the one open can be filtered by name, and a click walks in. Two uses:
//  - keeping (default): the folders picked become the places the projects live; session-map finds the git repositories under
//    each and lists them as projects. Only folder names travel: the server never sends a file here.
//  - picking (mode: 'pick'): one folder, handed back to onPick(path) and kept nowhere (the "Browse…" of New project).
// ctx: dialog, h, t (translator getter), icon(name, cls), api {folders, folderRepos, setProjectsRoot}, toast(text),
// errorText(code), roots() (the folders kept now), onSaved() (the page reads its projects again); picking: mode 'pick',
// start (a path to open on, when it is a folder), onPick(path).
const REPOS_SHOWN = 8;

export function openFolderPicker(ctx) {
  const { dialog, h, icon, api } = ctx;
  const picking = ctx.mode === 'pick';
  const tt = () => ctx.t();
  let chosen = picking ? [] : [...ctx.roots()];
  let at = null;
  let found = null;
  let busy = false;
  let seq = 0;
  let filter = '';
  let typing = false;

  // Built once and never replaced, so what is typed in them (and their focus) survives every redraw.
  const pathInput = h('input', {
    type: 'text', class: 'fp-path-input', spellcheck: 'false', autocomplete: 'off', 'aria-label': tt()('folders.pathLabel'), placeholder: tt()('folders.pathHint'),
    oninput: () => { typing = true; },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault?.(); go(pathInput.value.trim()); } },
  });
  const filterInput = h('input', {
    type: 'search', class: 'fp-filter', autocomplete: 'off', 'aria-label': tt()('folders.filterLabel'), placeholder: tt()('folders.filter'),
    oninput: () => { filter = filterInput.value; drawList(); },
  });
  const upBtn = h('button', { type: 'button', class: 'btn small-btn', disabled: true, 'aria-label': tt()('folders.up'), title: tt()('folders.up'), onclick: () => go(at.parent) }, icon('chevron', 'fp-up'));
  const useBtn = h('button', { type: 'button', class: 'btn primary', disabled: true, onclick: () => use() }, tt()('folders.use'));
  const chosenBox = h('section', { class: 'fp-chosen', 'aria-label': tt()('folders.chosen') });
  const listBox = h('ul', { class: 'fp-list', 'aria-busy': 'true' });
  const foundBox = h('p', { class: 'fp-found', 'aria-live': 'polite' });

  async function go(path, { quiet = false } = {}) {
    const mine = ++seq;
    busy = true;
    found = null;
    filter = '';
    filterInput.value = '';
    draw();
    const listing = await api.folders(path);
    if (mine !== seq) return;
    busy = false;
    if (!listing.ok) {
      if (!quiet) ctx.toast(ctx.errorText(listing.error));
      // A path that is not a folder leaves the chooser where it was; opening on one that is gone starts from the drives.
      return at || !path ? draw() : go('', { quiet: true });
    }
    at = listing;
    typing = false;
    draw();
    if (picking || !listing.path) return;
    const repos = await api.folderRepos(listing.path);
    if (mine !== seq || !repos.ok) return;
    found = repos;
    draw();
  }

  async function keep(next) {
    const res = await api.setProjectsRoot(next);
    if (!res.ok) {
      ctx.toast(ctx.errorText(res.error));
      return false;
    }
    chosen = res.roots;
    await ctx.onSaved();
    return true;
  }

  async function use() {
    if (!at?.path) return;
    if (picking) {
      dialog.close();
      return ctx.onPick(at.path);
    }
    if (!chosen.includes(at.path) && !(await keep([...chosen, at.path]))) return;
    ctx.toast(found ? tt().count('folders.saved', found.repos.length) : tt()('folders.savedPlain'));
    dialog.close();
  }

  const rowOf = (path, label, { repo = false } = {}) => h('li', {}, h('button', { type: 'button', class: 'fp-row', onclick: () => go(path) },
    icon('folder', 'fp-icon'), h('span', { class: 'fp-name' }, label),
    repo ? h('span', { class: 'fp-badge', title: tt()('folders.repoTitle') }, tt()('folders.repo')) : null));

  function drawList() {
    const start = !at?.path;
    const wanted = filter.trim().toLowerCase();
    const entries = (at?.entries ?? []).filter((e) => !wanted || e.name.toLowerCase().includes(wanted));
    const rows = [
      ...(start && at?.home && !wanted ? [rowOf(at.home, tt()('folders.home'))] : []),
      ...entries.map((e) => rowOf(e.path, e.name, { repo: e.repo })),
    ];
    const empty = busy && !at ? 'folders.loading' : wanted && at?.entries?.length ? 'folders.noMatch' : 'folders.empty';
    listBox.setAttribute('aria-busy', String(busy));
    listBox.replaceChildren(...(rows.length ? rows : [h('li', { class: 'pl-hint' }, tt()(empty))]));
  }

  function draw() {
    const start = !at?.path;
    if (!picking) {
      chosenBox.replaceChildren(
        h('h3', {}, tt()('folders.chosen')),
        chosen.length
          ? h('ul', { class: 'fp-chosen-list' }, chosen.map((p) => h('li', {},
            h('code', { class: 'fp-chosen-path' }, p),
            h('button', { type: 'button', class: 'btn small-btn', 'aria-label': tt()('folders.removeAria', { path: p }), onclick: async () => { await keep(chosen.filter((c) => c !== p)); draw(); } }, tt()('folders.remove')))))
          : h('p', { class: 'pl-hint' }, tt()('folders.none')));
      const names = found?.repos?.map((r) => r.split(/[\\/]/).filter(Boolean).pop()) ?? [];
      foundBox.replaceChildren(...(start || !found ? [] : [
        names.length ? tt().count('folders.found', names.length) : tt()('folders.foundNone'),
        names.length ? h('span', { class: 'fp-found-names' }, ` ${names.slice(0, REPOS_SHOWN).join(', ')}${names.length > REPOS_SHOWN ? `, ${tt()('folders.foundMore', { n: names.length - REPOS_SHOWN })}` : ''}`) : null,
        found.truncated ? h('span', { class: 'pl-hint fp-cut' }, ` ${tt()('folders.foundCut')}`) : null,
      ]));
    }
    upBtn.disabled = !at || start;
    useBtn.disabled = start || !at;
    // What is being typed is never overwritten.
    if (!typing) pathInput.value = start ? '' : at.path;
    drawList();
  }

  dialog.replaceChildren(h('div', { class: 'confirm pl-form fp' },
    h('h2', { id: 'folderTitle' }, tt()(picking ? 'folders.pickTitle' : 'folders.title')),
    h('p', { class: 'pl-lede' }, tt()(picking ? 'folders.pickLede' : 'folders.lede')),
    picking ? null : chosenBox,
    h('div', { class: 'fp-bar' }, upBtn, pathInput),
    filterInput,
    listBox,
    picking ? null : foundBox,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt()('folders.close')),
      useBtn)));
  draw();
  dialog.showModal();
  return go(picking ? (ctx.start ?? '') : (chosen.at(-1) ?? ''), { quiet: true });
}
