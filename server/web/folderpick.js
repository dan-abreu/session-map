// The folder chooser (id164): walks the PC's folders the way VS Code's Open Folder does and keeps the ones the person
// picks as the places his projects live. session-map finds the git repositories under each and lists them as projects.
// Only folder names travel: the server never sends a file here.
// ctx: dialog, h, t (translator getter), icon(name, cls), api {folders, folderRepos, setProjectsRoot}, toast(text), errorText(code),
// roots() (the folders kept now), onSaved() (the page reads its projects again).
const REPOS_SHOWN = 8;

export function openFolderPicker(ctx) {
  const { dialog, h, icon, api } = ctx;
  let chosen = [...ctx.roots()];
  let at = null;
  let found = null;
  let busy = false;
  let seq = 0;

  async function go(path) {
    const mine = ++seq;
    busy = true;
    found = null;
    draw();
    const listing = await api.folders(path);
    if (mine !== seq) return;
    busy = false;
    if (!listing.ok) {
      ctx.toast(ctx.errorText(listing.error));
      // A folder that went away since the last pick: start over from the drives.
      return path ? go('') : draw();
    }
    at = listing;
    draw();
    if (!listing.path) return;
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
    if (!chosen.includes(at.path) && !(await keep([...chosen, at.path]))) return;
    ctx.toast(found ? ctx.t().count('folders.saved', found.repos.length) : ctx.t()('folders.savedPlain'));
    dialog.close();
  }

  const rowOf = (entry, label, { repo = false } = {}) => h('li', {}, h('button', { type: 'button', class: 'fp-row', onclick: () => go(entry.path) },
    icon('folder', 'fp-icon'), h('span', { class: 'fp-name' }, label ?? entry.name),
    repo ? h('span', { class: 'fp-badge', title: ctx.t()('folders.repoTitle') }, ctx.t()('folders.repo')) : null));

  function draw() {
    const tt = ctx.t();
    const start = !at?.path;
    const places = start && at ? (at.home ? [rowOf({ path: at.home }, tt('folders.home'))] : []) : [];
    const list = at ? [...places, ...at.entries.map((e) => rowOf(e, e.name, { repo: e.repo }))] : [];
    const names = found?.repos?.map((r) => r.split(/[\\/]/).filter(Boolean).pop()) ?? [];
    dialog.replaceChildren(h('div', { class: 'confirm pl-form fp' },
      h('h2', { id: 'folderTitle' }, tt('folders.title')),
      h('p', { class: 'pl-lede' }, tt('folders.lede')),
      h('section', { class: 'fp-chosen', 'aria-label': tt('folders.chosen') },
        h('h3', {}, tt('folders.chosen')),
        chosen.length
          ? h('ul', { class: 'fp-chosen-list' }, chosen.map((p) => h('li', {},
            h('code', { class: 'fp-chosen-path' }, p),
            h('button', { type: 'button', class: 'btn small-btn', 'aria-label': tt('folders.removeAria', { path: p }), onclick: async () => { await keep(chosen.filter((c) => c !== p)); draw(); } }, tt('folders.remove')))))
          : h('p', { class: 'pl-hint' }, tt('folders.none'))),
      h('div', { class: 'fp-bar' },
        h('button', { type: 'button', class: 'btn small-btn', disabled: !at || start, 'aria-label': tt('folders.up'), title: tt('folders.up'), onclick: () => go(at.parent) }, icon('chevron', 'fp-up')),
        h('code', { class: 'fp-path', 'aria-live': 'polite' }, start ? tt('folders.here') : at.path)),
      h('ul', { class: 'fp-list', 'aria-busy': String(busy) }, busy && !at ? [h('li', { class: 'pl-hint' }, tt('folders.loading'))] : list.length ? list : [h('li', { class: 'pl-hint' }, tt('folders.empty'))]),
      start || !found ? null : h('p', { class: 'fp-found', 'aria-live': 'polite' },
        names.length ? tt.count('folders.found', names.length) : tt('folders.foundNone'),
        names.length ? h('span', { class: 'fp-found-names' }, ` ${names.slice(0, REPOS_SHOWN).join(', ')}${names.length > REPOS_SHOWN ? `, ${tt('folders.foundMore', { n: names.length - REPOS_SHOWN })}` : ''}`) : null,
        found.truncated ? h('span', { class: 'pl-hint fp-cut' }, ` ${tt('folders.foundCut')}`) : null),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('folders.close')),
        h('button', { type: 'button', class: 'btn primary', disabled: start || !at, onclick: use }, tt('folders.use')))));
  }

  draw();
  dialog.showModal();
  return go(chosen.at(-1) ?? '');
}
