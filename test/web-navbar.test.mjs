// The new navigation bar (B6-T5, fd10): two groups of areas, a "More" menu, a bottom bar on phones. It reads the table
// of areas (nav.js) and never keeps a list of its own. A tiny document is enough: build, find by #id, fire handlers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNavbar } from '../server/web/navbar.js';
import { AREAS, tabsFor } from '../server/web/nav.js';
import { translator } from '../server/web/i18n.js';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.handlers = {}; this.className = ''; this.hidden = false; this.parent = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'object' ? k : Object.assign(new El('#text'), { _text: String(k) }); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  focus() { globalThis.document.activeElement = this; }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  all() { return this.children.flatMap((c) => [c, ...(c.all?.() ?? [])]); }
  match(sel) {
    if (sel[0] === '#') return this.attrs.id === sel.slice(1);
    if (sel[0] === '.') return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tag === sel;
  }
  querySelector(sel) { return this.all().find((n) => n.match?.(sel)) ?? null; }
  querySelectorAll(sel) { return this.all().filter((n) => n.match?.(sel)); }
  get text() { return this._text ?? this.children.map((c) => c.text ?? '').join(''); }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'hidden') el.hidden = true;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });

function setup({ tech = false, phone = false, lang = 'en', current = 'map' } = {}) {
  const listeners = {};
  globalThis.document = { activeElement: null, addEventListener: (ev, fn) => { (listeners[ev] ??= new Set()).add(fn); }, removeEventListener: (ev, fn) => listeners[ev]?.delete(fn) };
  const picked = [];
  let isPhone = phone;
  const tr = translator(lang);
  const root = h('div');
  const bar = createNavbar({ h, icon, root, t: () => tr, tech: () => tech, phone: () => isPhone, current, onPick: (a) => picked.push(a), doc: globalThis.document });
  bar.render();
  const press = (el, key) => { let stopped = false; el.handlers.keydown({ key, preventDefault() { stopped = true; }, target: el }); return stopped; };
  return { bar, root, picked, tr, press, listeners, setPhone(v) { isPhone = v; bar.render(); } };
}
const buttons = (root) => root.querySelectorAll('button');
const idsOf = (root) => buttons(root).map((b) => b.attrs.id);
const byId = (root, id) => root.querySelector(`#tab-${id}`);
const focused = () => globalThis.document.activeElement;

test('Simple mode: Home, then Route, Map, Conversations and Ideas, then a More button; ids are tab-<area>', () => {
  const s = setup();
  assert.deepEqual(idsOf(s.root), ['tab-home', 'tab-route', 'tab-map', 'tab-convs', 'tab-ideas', 'tab-more']);
  const t = tabsFor({ tech: false });
  assert.deepEqual(idsOf(s.root).slice(0, -1), [...t.global, ...t.project].map((id) => `tab-${id}`));
  assert.equal(s.root.querySelector('nav').attrs['aria-label'], s.tr('nav.label'));
  assert.equal(byId(s.root, 'more').text, s.tr('nav.more'));
});

test('Full mode: every area on the bar in the order of tabsFor, and no More button', () => {
  const s = setup({ tech: true });
  const t = tabsFor({ tech: true });
  assert.deepEqual(idsOf(s.root), [...t.global, ...t.project].map((id) => `tab-${id}`));
  assert.equal(buttons(s.root).length, 12);
  assert.equal(byId(s.root, 'more'), null);
});

test('each tab carries the icon of the table and its text in both languages', () => {
  for (const lang of ['en', 'pt-BR']) {
    const s = setup({ tech: true, lang });
    for (const a of AREAS) {
      const b = byId(s.root, a.id);
      assert.equal(b.text, s.tr('tab.' + a.id), `${lang} ${a.id}`);
      assert.equal(b.querySelector('svg').attrs['data-icon'], a.icon, a.id);
    }
  }
});

test('the current area has aria-current="page" and no other tab has it; setCurrent moves it', () => {
  const s = setup({ current: 'route' });
  const marked = () => buttons(s.root).filter((b) => b.attrs['aria-current'] === 'page').map((b) => b.attrs.id);
  assert.deepEqual(marked(), ['tab-route']);
  s.bar.setCurrent('ideas');
  assert.deepEqual(marked(), ['tab-ideas']);
});

test('a click on a tab calls onPick(area)', () => {
  const s = setup();
  byId(s.root, 'convs').handlers.click({});
  assert.deepEqual(s.picked, ['convs']);
});

test('arrow keys, Home and End move the focus along the bar, and only one tab is in the tab order', () => {
  const s = setup({ current: 'map' });
  assert.deepEqual(buttons(s.root).filter((b) => b.attrs.tabindex === '0').map((b) => b.attrs.id), ['tab-map']);
  assert.equal(s.press(byId(s.root, 'map'), 'ArrowRight'), true, 'the key is taken');
  assert.equal(focused().attrs.id, 'tab-convs');
  s.press(focused(), 'ArrowLeft');
  assert.equal(focused().attrs.id, 'tab-map');
  s.press(focused(), 'End');
  assert.equal(focused().attrs.id, 'tab-more');
  s.press(focused(), 'ArrowRight');
  assert.equal(focused().attrs.id, 'tab-more', 'it stops at the end');
  s.press(focused(), 'Home');
  assert.equal(focused().attrs.id, 'tab-home');
  assert.equal(s.press(focused(), 'a'), false, 'other keys are left alone');
});

test('an area without a view says so in words for a screen reader and in the tooltip', () => {
  const s = setup();
  s.bar.setReady({ route: false, map: true });
  const route = byId(s.root, 'route');
  assert.ok(route.text.includes(s.tr('nav.soon')), 'the words are inside the button');
  assert.ok(route.querySelector('.nav-soon'), 'and there is the dot');
  assert.equal(route.attrs.title, s.tr('nav.soon'));
  assert.ok(!byId(s.root, 'map').text.includes(s.tr('nav.soon')));
  assert.equal(byId(s.root, 'home').querySelector('.nav-soon'), null, 'an area nobody mentioned counts as ready');
  s.bar.setReady({});
  assert.equal(byId(s.root, 'route').querySelector('.nav-soon'), null);
});

test('More opens a menu with the seven hidden areas, in table order; picking one calls onPick and closes it', () => {
  const s = setup();
  const more = byId(s.root, 'more');
  assert.equal(more.attrs['aria-expanded'], 'false');
  assert.equal(more.attrs['aria-haspopup'], 'menu');
  more.handlers.click({});
  assert.equal(byId(s.root, 'more').attrs['aria-expanded'], 'true');
  const menu = s.root.querySelector('.nav-menu');
  assert.equal(menu.attrs.role, 'menu');
  const items = menu.querySelectorAll('button');
  assert.deepEqual(items.map((b) => b.attrs.id), ['flow', 'requests', 'changes', 'health', 'costs', 'library', 'discover'].map((id) => `tab-${id}`));
  assert.ok(items.every((b) => b.attrs.role === 'menuitem'));
  assert.equal(focused(), items[0], 'the focus goes to the first item');
  items[3].handlers.click({});
  assert.deepEqual(s.picked, ['health']);
  assert.equal(s.root.querySelector('.nav-menu'), null);
});

test('the menu: arrows move, Escape closes and gives the focus back to More, a press outside closes', () => {
  const s = setup();
  byId(s.root, 'more').handlers.click({});
  const items = s.root.querySelector('.nav-menu').querySelectorAll('button');
  s.press(items[0], 'ArrowDown');
  assert.equal(focused(), items[1]);
  s.press(items[1], 'ArrowUp');
  s.press(items[0], 'ArrowUp');
  assert.equal(focused(), items[items.length - 1], 'it wraps');
  s.press(items[0], 'Escape');
  assert.equal(s.root.querySelector('.nav-menu'), null);
  assert.equal(focused().attrs.id, 'tab-more');
  byId(s.root, 'more').handlers.click({});
  assert.ok(s.root.querySelector('.nav-menu'));
  for (const fn of s.listeners.pointerdown) fn({ target: h('div') });
  assert.equal(s.root.querySelector('.nav-menu'), null, 'a press outside closes');
  assert.equal(s.listeners.pointerdown.size, 0, 'and the page listener is gone');
});

test('More shows as current when the current area sits inside it', () => {
  const s = setup({ current: 'costs' });
  assert.equal(byId(s.root, 'more').attrs['aria-current'], 'page');
  s.bar.setCurrent('map');
  assert.equal(byId(s.root, 'more').attrs['aria-current'], undefined);
});

test('setMode swaps Simple for Full without a reload, and keeps the focus where it was', () => {
  const s = setup();
  byId(s.root, 'map').focus();
  s.bar.setMode(true);
  assert.equal(buttons(s.root).length, 12);
  assert.equal(focused().attrs.id, 'tab-map', 'the new button got the focus back');
  s.bar.setMode(false);
  assert.ok(byId(s.root, 'more'));
});

test('on a phone the bottom bar has five buttons: Home, Route, Map, Conversations and More, whatever the mode', () => {
  for (const tech of [false, true]) {
    const s = setup({ phone: true, tech });
    assert.ok(s.root.querySelector('.is-bottom'), 'a bottom bar');
    assert.deepEqual(idsOf(s.root), ['tab-home', 'tab-route', 'tab-map', 'tab-convs', 'tab-more']);
    byId(s.root, 'more').handlers.click({});
    const items = s.root.querySelector('.nav-menu').querySelectorAll('button').map((b) => b.attrs.id.slice(4));
    assert.deepEqual(items, tabsFor({ phone: true }).more, 'More holds every other area');
    assert.ok(s.root.querySelector('.nav-scrim'), 'a scrim behind the sheet');
  }
});

test('going from phone to desktop rebuilds the bar', () => {
  const s = setup({ phone: true });
  s.setPhone(false);
  assert.equal(s.root.querySelector('.is-bottom'), null);
  assert.equal(buttons(s.root).length, 6);
});

test('the stylesheet keeps touch targets at 44 px on the phone bar, has the reader-only text class and respects reduced motion', () => {
  const css = readFileSync(new URL('../server/web/css/fd-nav.css', import.meta.url), 'utf8');
  assert.match(css, /\.navbar\.is-bottom[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.nav-sr\b/);
  assert.match(css, /prefers-reduced-motion/);
});
