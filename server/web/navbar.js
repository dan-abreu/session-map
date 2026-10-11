// The navigation bar (fd10, mm47). It draws whatever nav.js says: Home, Map and Conversations, a "More" menu with the
// other areas that have a page, and on a phone a bottom bar of four. It keeps no list of areas of its own.
// ctx: h, icon(name, cls)?, root (the element it fills), t (getter of the translator), onPick(area), phone()
// getter, tech() getter (the Full switch), extras() (what the ⋯ holds under the areas, after a rule: help,
// Configurações. Each {id, label, icon, desc?, kind: 'item' | 'switch', checked?, onActivate()}), current (area id at
// the start), doc (the document; defaults to the page's).
// The page calls render() when the language or the width changes; setCurrent / setMode / setReady redraw by themselves.
import { AREAS, tabsFor } from './nav.js';

const ICONS = Object.fromEntries(AREAS.map((a) => [a.id, a.icon]));

export function createNavbar(ctx) {
  const { h, root } = ctx;
  const doc = ctx.doc ?? globalThis.document;
  let current = ctx.current ?? 'map';
  let ready = {};
  let open = false;
  let moreWrap = null;
  let outside = null;

  const ids = new WeakMap(); // button -> its id, so the focus survives a redraw without asking the page's DOM
  const byId = new Map();
  let barButtons = [];

  const icon = (name) => (ctx.icon ? ctx.icon(name, 'nav-icon') : null);

  function tabButton(id, label, iconName, extra = {}) {
    const tt = ctx.t();
    const soon = ready[id] === false;
    const isCurrent = extra.current ?? id === current;
    const el = h('button', {
      type: 'button', id: `tab-${id}`, class: `nav-tab${isCurrent ? ' is-current' : ''}${soon ? ' is-soon' : ''}`,
      'aria-current': isCurrent ? 'page' : null, title: soon ? tt('nav.soon') : id === 'more' ? tt('nav.more') : ctx.tech?.() && !extra.role ? label : null, tabindex: extra.tabindex ?? -1,
      role: extra.role ?? null, 'aria-haspopup': extra.popup ? 'menu' : null, 'aria-expanded': extra.popup ? String(open) : null,
      onclick: extra.onclick, onkeydown: extra.onkeydown,
    }, icon(iconName), h('span', { class: 'nav-label' }, label),
    soon ? [h('span', { class: 'nav-soon', 'aria-hidden': 'true' }), h('span', { class: 'nav-sr' }, ` ${tt('nav.soon')}`)] : null);
    ids.set(el, `tab-${id}`);
    byId.set(`tab-${id}`, el);
    return el;
  }

  const focusBar = (i) => {
    barButtons.forEach((b, k) => b.setAttribute('tabindex', k === i ? '0' : '-1'));
    barButtons[i].focus();
  };

  function barKey(i) {
    return (e) => {
      const last = barButtons.length - 1;
      const to = { ArrowRight: Math.min(i + 1, last), ArrowLeft: Math.max(i - 1, 0), Home: 0, End: last }[e.key];
      if (to !== undefined) { e.preventDefault(); focusBar(to); return; }
      if (e.key === 'ArrowDown' && barButtons[i] === byId.get('tab-more')) { e.preventDefault(); openMenu(); }
      if (e.key === 'Escape' && open) { e.preventDefault(); closeMenu(true); }
    };
  }

  function itemKey(items, i) {
    return (e) => {
      const n = items.length;
      const to = { ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); items[to].focus(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'Tab') closeMenu(false);
    };
  }

  // One entry of the part under the rule: a plain item (closes the menu, then does its job) or a switch (flips, and the
  // menu stays open with the focus on it).
  function extraButton(x, items, i) {
    const sw = x.kind === 'switch';
    const el = h('button', {
      type: 'button', class: `nav-tab nav-extra${x.desc ? ' is-two' : ''}`, 'data-more': x.id, role: sw ? 'menuitemcheckbox' : 'menuitem', tabindex: -1,
      'aria-checked': sw ? String(Boolean(x.checked)) : null, 'aria-haspopup': x.popup ? 'dialog' : null,
      onclick: () => {
        if (!sw) { closeMenu(false); x.onActivate?.(); return; }
        x.onActivate?.();
        render();
        byId.get(`more-${x.id}`)?.focus();
      },
      onkeydown: (e) => itemKey(items, i)(e),
    }, x.icon ? icon(x.icon) : null,
    h('span', { class: 'nav-label' }, x.label, x.desc ? h('small', { class: 'nav-desc' }, x.desc) : null),
    sw ? h('span', { class: 'nav-check', 'aria-hidden': 'true' }) : null);
    ids.set(el, `more-${x.id}`);
    byId.set(`more-${x.id}`, el);
    return el;
  }

  function menuOf(moreIds, extras) {
    const tt = ctx.t();
    const items = [];
    const list = h('div', { class: 'nav-menu', role: 'menu', 'aria-label': tt('nav.more') });
    moreIds.forEach((id, i) => {
      const item = tabButton(id, tt(`tab.${id}`), ICONS[id], {
        role: 'menuitem', tabindex: -1,
        onclick: () => { closeMenu(false); ctx.onPick?.(id); },
        onkeydown: (e) => itemKey(items, i)(e),
      });
      items.push(item);
      list.append(item);
    });
    if (moreIds.length && extras.length) list.append(h('hr', { class: 'nav-sep', role: 'separator' }));
    extras.forEach((x, k) => {
      const item = extraButton(x, items, moreIds.length + k);
      items.push(item);
      list.append(item);
    });
    return { list, items };
  }

  function render() {
    const tt = ctx.t();
    const phone = Boolean(ctx.phone?.());
    const focusId = doc?.activeElement && root.contains(doc.activeElement) ? ids.get(doc.activeElement) : null;
    byId.clear();
    barButtons = [];
    const t = tabsFor({ tech: Boolean(ctx.tech?.()), phone, ready });
    const onBar = phone ? t.bottom.filter((id) => id !== 'more') : [...t.global, ...t.project];
    const extras = ctx.extras?.() ?? [];
    const hasMore = t.bottom.includes('more') || t.more.length > 0 || extras.length > 0;
    const moreCurrent = t.more.includes(current);
    const tabStop = onBar.includes(current) ? current : moreCurrent && hasMore ? 'more' : onBar[0];

    const bar = (id) => {
      const el = tabButton(id, tt(`tab.${id}`), ICONS[id], { tabindex: id === tabStop ? 0 : -1, onclick: () => ctx.onPick?.(id) });
      barButtons.push(el);
      return el;
    };
    const wireKeys = () => barButtons.forEach((b, i) => b.addEventListener('keydown', barKey(i)));

    let more = null;
    let menu = null;
    if (hasMore) {
      const m = tabButton('more', tt('nav.more'), 'more', {
        tabindex: tabStop === 'more' ? 0 : -1, current: moreCurrent, popup: true, onclick: () => (open ? closeMenu(true) : openMenu()),
      });
      menu = open ? menuOf(t.more, extras) : null;
      moreWrap = h('div', { class: 'nav-more' }, m, menu?.list);
      more = { m, wrap: moreWrap };
    }

    let nav;
    if (phone) {
      nav = h('nav', { class: 'navbar is-bottom', 'aria-label': tt('nav.label') }, onBar.map(bar));
    } else {
      const global = h('div', { class: 'nav-group is-global' }, t.global.map(bar));
      const project = h('div', { class: 'nav-group is-project' }, t.project.map(bar));
      nav = h('nav', { class: 'navbar', 'aria-label': tt('nav.label') }, global, project);
      if (more) project.append(more.wrap);
    }
    if (more) {
      barButtons.push(more.m);
      if (phone) nav.append(more.wrap);
    }
    wireKeys();

    const scrim = phone && open ? h('div', { class: 'nav-scrim', 'aria-hidden': 'true' }) : null;
    root.replaceChildren(...(scrim ? [nav, scrim] : [nav]));
    if (focusId && byId.has(focusId)) byId.get(focusId).focus();
  }

  function openMenu() {
    open = true;
    outside = (e) => { if (!moreWrap?.contains(e.target)) closeMenu(false); };
    doc?.addEventListener?.('pointerdown', outside);
    render();
    root.querySelector('.nav-menu')?.querySelector('button')?.focus();
  }

  function closeMenu(restore) {
    if (outside) doc?.removeEventListener?.('pointerdown', outside);
    outside = null;
    if (!open) return;
    open = false;
    render();
    if (restore) byId.get('tab-more')?.focus();
  }

  return {
    render,
    setCurrent(area) { current = area; render(); },
    // The technical switch changes the words of the tabs, not which tabs there are (mm47).
    setMode() { closeMenu(false); render(); },
    setReady(map) { ready = map ?? {}; render(); },
  };
}
