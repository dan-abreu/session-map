// The project picker (mm10): a button with the open project and a list of every project, each with its color and its
// marks: a pulsing green dot when something works there, an amber number waiting for the person, a check for finished and
// not seen yet. A native <select> cannot hold those marks, so this is a small listbox with the same keys.

// No project id holds a ':' (paths.mjs projectIdOf), so these never meet a project.
const NEW = ':new';
const OTHERS = ':others';
const FOLDERS = ':folders';

// The button names the open project only (mm47): its amber count is the pill's and its work the map header's, so the marks
// wait in the list, one look away; its label still says them.
// The folders that are not projects the owner keeps (id161: gone, temporary, a tool's) wait behind one row, "N other
// folders", with the marks of all of them (so a helper working in one is never out of sight) and each one's reason when it
// is opened; the open project stays in the main list whatever it is.
// The list ends with "New project" (sv14, mm50) when the page may create one: ctx.onNew opens its dialog.
// Before it, "Project folders" (id164) when the page may: ctx.onFolders opens the folder chooser.
// ctx: root, button, list, name (the name span), h, t (translator getter), icon(name, cls), onPick(id), onNew() (optional),
// onFolders() (optional), canNew() (optional: false hides "New project" and "Project folders", as with the look-only link).
export function createProjectPicker(ctx) {
  const { root, button, list, h } = ctx;
  let projects = [];
  let current = null;
  let badges = new Map();
  let showOthers = false;

  function marksView(b) {
    const tt = ctx.t();
    if (!b) return [];
    const out = [];
    if (b.working) out.push(h('span', { class: 'pp-mark is-working', title: tt('project.markWorking') }, h('span', { class: 'visually-hidden' }, tt('project.markWorking'))));
    if (b.waiting) out.push(h('span', { class: 'pp-mark is-waiting num', title: tt.count('project.markWaiting', b.waiting) }, String(b.waiting), h('span', { class: 'visually-hidden' }, ` ${tt.count('project.markWaiting', b.waiting)}`)));
    if (b.finished) out.push(h('span', { class: 'pp-mark is-finished', title: tt.count('project.markFinished', b.finished) }, ctx.icon('check', 'pp-check'), h('span', { class: 'visually-hidden' }, tt.count('project.markFinished', b.finished))));
    return out;
  }

  // The marks of several projects as one: working if any works, the waiting and the finished added up.
  const sumMarks = (all) => all.reduce((s, b) => ({ working: s.working || Boolean(b?.working), waiting: s.waiting + (b?.waiting ?? 0), finished: s.finished + (b?.finished ?? 0) }), { working: false, waiting: 0, finished: 0 });

  const options = () => [...list.querySelectorAll('[role="option"]')];
  const isOpen = () => !list.hidden;

  function focusOption(el) {
    if (!el) return;
    for (const o of options()) o.tabIndex = o === el ? 0 : -1;
    el.focus({ preventScroll: false });
  }

  function open() {
    if (isOpen()) return;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    focusOption(options().find((o) => o.dataset.id === current) ?? options()[0]);
  }

  function close({ focus = true } = {}) {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  }

  function pick(id) {
    if (id === OTHERS) {
      showOthers = !showOthers;
      render();
      return;
    }
    close();
    if (id === NEW) ctx.onNew();
    else if (id === FOLDERS) ctx.onFolders();
    else if (id !== current) ctx.onPick(id);
  }

  function render() {
    const tt = ctx.t();
    const p = projects.find((x) => x.id === current);
    if (!p) return;
    root.style.setProperty('--p-h', String(p.hue));
    ctx.name.textContent = p.name;
    const b = badges.get(p.id);
    const words = b ? [b.working ? tt('project.markWorking') : null, b.waiting ? tt.count('project.markWaiting', b.waiting) : null, b.finished ? tt.count('project.markFinished', b.finished) : null] : [];
    button.setAttribute('aria-label', [tt('project.pick', { name: p.name }), ...words.filter(Boolean)].join(' · '));
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const kept = projects.filter((x) => !x.scratch || x.id === current);
    const others = projects.filter((x) => x.scratch && x.id !== current);
    const optionOf = (x) => h('li', {
      role: 'option', 'data-id': x.id, 'aria-selected': String(x.id === current), tabindex: '-1', class: `pp-option${x.scratch ? ' is-scratch' : ''}`, style: `--p-h:${x.hue}`,
      onclick: () => pick(x.id),
    }, h('span', { class: 'pp-swatch', 'aria-hidden': 'true' }),
    h('span', { class: 'pp-option-name' }, x.name, x.scratch ? h('small', { class: 'pp-why' }, tt(`project.scratch.${x.scratch}`)) : null),
    h('span', { class: 'pp-marks' }, marksView(badges.get(x.id))));
    list.replaceChildren(...kept.map(optionOf),
    ...(others.length ? [h('li', {
      role: 'option', 'data-id': OTHERS, 'aria-selected': 'false', tabindex: '-1', class: 'pp-option pp-others', onclick: () => pick(OTHERS),
    }, h('span', { class: 'pp-option-name' }, showOthers ? tt('project.othersHide') : tt.count('project.others', others.length)),
    h('span', { class: 'pp-marks' }, showOthers ? [] : marksView(sumMarks(others.map((x) => badges.get(x.id))))))] : []),
    ...(showOthers ? others.map(optionOf) : []),
    ...(ctx.onFolders && ctx.canNew?.() !== false ? [h('li', {
      role: 'option', 'data-id': FOLDERS, 'aria-selected': 'false', tabindex: '-1', class: 'pp-option pp-new', onclick: () => pick(FOLDERS),
    }, ctx.icon('folder', 'pp-new-icon'), h('span', { class: 'pp-option-name' }, tt('folders.open')))] : []),
    ...(ctx.onNew && ctx.canNew?.() !== false ? [h('li', {
      role: 'option', 'data-id': NEW, 'aria-selected': 'false', tabindex: '-1', class: 'pp-option pp-new', onclick: () => pick(NEW),
    }, ctx.icon('plus', 'pp-new-icon'), h('span', { class: 'pp-option-name' }, tt('project.new')))] : []));
    if (focusedId) focusOption(options().find((o) => o.dataset.id === focusedId));
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  list.addEventListener('keydown', (e) => {
    const all = options();
    const at = all.indexOf(document.activeElement);
    const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (go !== undefined) {
      e.preventDefault();
      focusOption(all[Math.max(0, Math.min(all.length - 1, go))]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (all[at]) pick(all[at].dataset.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close({ focus: false });
    }
  });
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !root.contains(e.target)) close({ focus: false }); });

  return {
    // list: [{id, name, hue}]; marks: projectId → {working, waiting, finished}.
    update(list_, id, marks) {
      projects = list_;
      current = id;
      badges = marks;
      render();
    },
    relabel: render,
    isOpen,
    close,
  };
}
