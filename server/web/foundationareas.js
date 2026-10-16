import { createCareView } from './careview.js';
import { createCompassView } from './compassview.js';
import { createFindingsView } from './findingsview.js';
import { createHealthView } from './healthview.js';
import { createIdeasView } from './ideasview.js';
import { createLibraryView } from './libraryview.js';
import { createPracticesView } from './practicesview.js';
import { createProfileView } from './profileview.js';
import { createUptodateView } from './uptodateview.js';
import { createVersionsView } from './versionsview.js';

// The Foundation's screens on the page (fd22). Blocks B3 to B6 built and tested ten views — health, "Tudo em dia?", versions,
// findings, care, route, profile, good practices, ideas, library — and none was hung on the registry (areas.js), so the Route,
// Health, Ideas and Library tabs said "It arrives in the next version". This file hangs them: Health and Route are a strip of
// sub-pages (the Home sends people to `health/versions`, `health/uptodate` and `health/care`), Ideas and Library are one page each.
//
// Two views want the text function itself, got by calling ctx.t(), and the others a function (ctx.t(key, vars)); `base` carries both:
//   base.t(key, vars), base.tr() -> the text function, which also has .count, base.project() -> { id }, base.tech(), base.lang(),
//   base.errorText(code), base.toast(msg), base.dialog (a <dialog> for the care questions), base.careMode(),
//   base.openFile(file, line), base.openChat({ node, text }), base.openFindings(), base.onMode(care).

// A strip of sub-pages: tabs = [{ id, view }]; the first one is the default. render(root, sub) opens `sub` when it is one of them.
export function createTabbedArea({ h, t, name, tabs }) {
  let rootEl = null;
  let bar = null;
  let body = null;
  let current = tabs[0].id;
  const find = (id) => tabs.find((x) => x.id === id) ?? null;

  function drawBar() {
    bar.replaceChildren(...tabs.map((tab) => h('button', {
      type: 'button', role: 'tab', id: `fd-sub-${name}-${tab.id}`, 'aria-selected': String(tab.id === current), tabindex: tab.id === current ? '0' : '-1',
      'aria-controls': `fd-body-${name}`, 'data-sub': tab.id,
      onclick: () => open(tab.id),
    }, t(`fd.sub.${tab.id}`))));
  }

  function open(id) {
    if (!find(id)) return undefined;
    current = id;
    drawBar();
    body.replaceChildren();
    return find(id).view.render(body, null);
  }

  // The strip is one tablist: the arrows, Home and End move along it.
  function onKey(e) {
    const at = tabs.findIndex((x) => x.id === current);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault?.();
    const next = tabs[(to + tabs.length) % tabs.length];
    open(next.id);
    bar.querySelector?.(`[data-sub="${next.id}"]`)?.focus?.();
  }

  return {
    render(root, sub) {
      rootEl = root;
      if (sub && find(sub)) current = sub;
      else if (!find(current)) current = tabs[0].id;
      bar = h('div', { class: 'fd-subtabs seg', role: 'tablist', 'aria-label': t(`fd.sub.aria.${name}`), onkeydown: onKey });
      body = h('div', { class: 'fd-subbody', role: 'tabpanel', id: `fd-body-${name}` });
      root.replaceChildren(bar, body);
      drawBar();
      return find(current).view.render(body, null);
    },
    refresh(root, sub) {
      if (!body || rootEl !== root) return this.render(root, sub);
      return find(current).view.refresh(body, null);
    },
    // Which sub-page is open: the tests and the Home read it.
    current: () => current,
  };
}

// The care sub-page: the mode of the project, changed with the picker, and the fixes waiting for an Accept. The pieces are the
// care view's; this only puts them on a page.
function createCareScreen({ h, base, care }) {
  let rootEl = null;
  let gen = 0;
  async function paint(root) {
    const mine = ++gen;
    const tt = base.tr();
    const projectId = base.project().id;
    const { care: doc } = await care.load(projectId);
    if (mine !== gen) return;
    const proposals = h('div', { class: 'care-proposals' });
    root.replaceChildren(h('div', { class: 'view-wrap' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('care.mode.label'))),
      h('div', { class: 'care-mode-box' }, h('p', { class: 'care-mode-now' }, doc?.mode ? tt(`care.mode.${doc.mode}`) : tt('care.mode.unset')), care.picker(projectId, doc, () => paint(root))),
      proposals));
    await care.renderProposals(proposals, projectId, () => paint(root));
  }
  return {
    render(root) { rootEl = root; return paint(root); },
    refresh(root) { return rootEl === root ? paint(root) : this.render(root); },
  };
}

export function createHealthArea(base) {
  const getter = { ...base, t: base.tr };
  const care = createCareView({ h: base.h, t: base.tr, dialog: base.dialog, toast: base.toast, errorText: base.errorText, onMode: base.onMode });
  return createTabbedArea({
    h: base.h, t: base.t, name: 'health',
    tabs: [
      { id: 'health', view: createHealthView(getter) },
      { id: 'uptodate', view: createUptodateView(getter) },
      { id: 'versions', view: createVersionsView(getter) },
      { id: 'findings', view: createFindingsView(getter) },
      { id: 'care', view: createCareScreen({ h: base.h, base, care }) },
    ],
  });
}

export function createRouteArea(base) {
  return createTabbedArea({
    h: base.h, t: base.t, name: 'route',
    tabs: [
      { id: 'route', view: createCompassView(base) },
      { id: 'profile', view: createProfileView(base) },
      { id: 'practices', view: createPracticesView(base) },
    ],
  });
}

export const createIdeasArea = (base) => createIdeasView(base);
export const createLibraryArea = (base) => createLibraryView(base);
