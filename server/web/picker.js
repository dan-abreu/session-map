// The project picker (mm10): a button with the open project and a list of every project, each with its color and its
// marks: a pulsing green dot when something works there, an amber number waiting for the person, a check for finished and
// not seen yet. A native <select> cannot hold those marks, so this is a small listbox with the same keys.

// ctx: root, button, list, name (the name span), marks (the marks span), h, t (translator getter), icon(name, cls), onPick(id).
export function createProjectPicker(ctx) {
  const { root, button, list, h } = ctx;
  let projects = [];
  let current = null;
  let badges = new Map();

  function marksView(b, { quiet = false } = {}) {
    const tt = ctx.t();
    if (!b) return [];
    const out = [];
    if (b.working) out.push(h('span', { class: 'pp-mark is-working', title: quiet ? null : tt('project.markWorking') }, h('span', { class: 'visually-hidden' }, tt('project.markWorking'))));
    if (b.waiting) out.push(h('span', { class: 'pp-mark is-waiting num', title: quiet ? null : tt.count('project.markWaiting', b.waiting) }, String(b.waiting), h('span', { class: 'visually-hidden' }, ` ${tt.count('project.markWaiting', b.waiting)}`)));
    if (b.finished) out.push(h('span', { class: 'pp-mark is-finished', title: quiet ? null : tt.count('project.markFinished', b.finished) }, ctx.icon('check', 'pp-check'), h('span', { class: 'visually-hidden' }, tt.count('project.markFinished', b.finished))));
    return out;
  }

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
    close();
    if (id !== current) ctx.onPick(id);
  }

  function render() {
    const tt = ctx.t();
    const p = projects.find((x) => x.id === current);
    if (!p) return;
    root.style.setProperty('--p-h', String(p.hue));
    ctx.name.textContent = p.name;
    // The button shows the open project's own marks; the others' are one look away in the list.
    ctx.marks.replaceChildren(...marksView(badges.get(p.id), { quiet: true }));
    const b = badges.get(p.id);
    const words = b ? [b.working ? tt('project.markWorking') : null, b.waiting ? tt.count('project.markWaiting', b.waiting) : null, b.finished ? tt.count('project.markFinished', b.finished) : null] : [];
    button.setAttribute('aria-label', [tt('project.pick', { name: p.name }), ...words.filter(Boolean)].join(' · '));
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    list.replaceChildren(...projects.map((x) => h('li', {
      role: 'option', 'data-id': x.id, 'aria-selected': String(x.id === current), tabindex: '-1', class: 'pp-option', style: `--p-h:${x.hue}`,
      onclick: () => pick(x.id),
    }, h('span', { class: 'pp-swatch', 'aria-hidden': 'true' }), h('span', { class: 'pp-option-name' }, x.name), h('span', { class: 'pp-marks' }, marksView(badges.get(x.id))))));
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
