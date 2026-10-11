// The top bar keeps one amber count; help, the person's menu and every setting live inside the ⋯ (More) menu of the bar,
// and the Full switch (once "?"-menu's "Completo") puts every area on the bar again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNavbar } from '../server/web/navbar.js';
import { createRunSettings } from '../server/web/runsettings.js';
import { AREAS, tabsFor } from '../server/web/nav.js';
import { LANGS, translator } from '../server/web/i18n.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('server/web/index.html');

// ---- the page ----

test('the top bar keeps only the project, the areas and the amber count: no "?" and no person button', () => {
  const bar = html.slice(html.indexOf('<header class="bar">'), html.indexOf('</header>'));
  assert.match(bar, /id="waitingBtn"/);
  for (const gone of ['id="helpBtn"', 'id="personBtn"', 'id="personMenu"', 'class="me"', 'data-lang=', 'id="alertsBtn"', 'id="aiHelpersBar"', 'id="settingsOpen"', 'id="helpOpen"']) {
    assert.ok(!bar.includes(gone), `${gone} left the bar`);
  }
  const end = bar.slice(bar.indexOf('<div class="bar-end">'));
  assert.deepEqual([...end.matchAll(/<button[^>]*id="(\w+)"/g)].map((m) => m[1]), ['waitingBtn'], 'one button at the right end');
});

test('the help panel keeps what is read, not clicked: the glossary; the rest moved into ⋯', () => {
  const panel = html.slice(html.indexOf('id="helpMenu"'), html.indexOf('id="helpTip"'));
  assert.match(panel, /id="helpGlossary"/);
  for (const moved of ['id="tourReplay"', 'id="techToggle"', 'id="aiHelpersOpen"']) assert.ok(!panel.includes(moved), moved);
});

// ---- the Full switch ----

test('Full mode puts every area that has a page on the bar of a computer; Simple keeps the calm row; the phone is the same', () => {
  const simple = tabsFor({ tech: false });
  const full = tabsFor({ tech: true });
  assert.deepEqual([...simple.global, ...simple.project], ['home', 'map', 'convs']);
  assert.ok(simple.more.length > 0);
  assert.deepEqual(full.more, [], 'nothing waits under More in Full');
  const onBar = [...full.global, ...full.project];
  assert.deepEqual(onBar.sort(), AREAS.filter((a) => !a.waitsForPage).map((a) => a.id).sort(), 'every area but the two still waiting for a page');
  assert.ok(tabsFor({ tech: true, ready: { route: true, ideas: true } }).project.includes('route'), 'an area with its page joins the bar');
  assert.deepEqual(tabsFor({ tech: true, phone: true }), tabsFor({ tech: false, phone: true }), 'the bottom bar stays four and More');
});

// ---- the ⋯ menu ----

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.handlers = {}; this.className = ''; this.hidden = false; this.parent = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'object' ? k : Object.assign(new El('#text'), { _text: String(k) }); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  fire(ev, e = {}) { return this.handlers[ev]?.({ key: '', target: this, preventDefault() {}, stopPropagation() {}, ...e }); }
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

function setup({ tech = false, phone = false, look = false, lang = 'en', extras } = {}) {
  const listeners = {};
  globalThis.document = { activeElement: null, addEventListener: (ev, fn) => { (listeners[ev] ??= new Set()).add(fn); }, removeEventListener: (ev, fn) => listeners[ev]?.delete(fn) };
  const log = [];
  const state = { tech, full: tech };
  const tr = translator(lang);
  const root = h('div');
  const items = extras ?? (() => [
    { id: 'tour', label: 'Tour', icon: 'compass', onActivate: () => log.push('tour') },
    { id: 'ai', label: 'Other AIs', icon: 'connect', onActivate: () => log.push('ai') },
    { id: 'full', label: 'Full mode', desc: 'Every area', kind: 'switch', checked: state.full, onActivate: () => { state.full = !state.full; log.push(`full:${state.full}`); } },
    { id: 'help', label: 'Help', icon: 'help', onActivate: () => log.push('help') },
    { id: 'settings', label: 'Settings', icon: 'sliders', onActivate: () => log.push('settings') },
  ]);
  const bar = createNavbar({ h, icon, root, t: () => tr, tech: () => tech, phone: () => phone, look: () => look, current: 'map', onPick: (a) => log.push(`pick:${a}`), extras: items, doc: globalThis.document });
  bar.render();
  return { bar, root, log, state, tab: (id) => root.querySelector(`#tab-${id}`), menu: () => root.querySelector('.nav-menu') };
}
const open = (s) => s.tab('more').fire('click');
const menuItems = (s) => s.menu().querySelectorAll('button');

test('the ⋯ menu lists the areas, then a rule, then help and Configurações, in one list the arrows walk', () => {
  const s = setup();
  open(s);
  const items = menuItems(s);
  const areas = tabsFor({}).more.length;
  assert.deepEqual(items.slice(0, areas).map((b) => b.attrs.id), tabsFor({}).more.map((id) => `tab-${id}`));
  assert.deepEqual(items.slice(areas).map((b) => b.attrs['data-more']), ['tour', 'ai', 'full', 'help', 'settings']);
  assert.ok(s.menu().all().some((n) => n.attrs.role === 'separator'), 'a rule between the areas and the rest');
  assert.ok(items.every((b) => /^menuitem/.test(b.attrs.role)), 'every entry is a menu item');
  // Arrows walk across the rule, wrap at both ends.
  items[areas - 1].fire('keydown', { key: 'ArrowDown' });
  assert.equal(globalThis.document.activeElement, items[areas]);
  items[0].fire('keydown', { key: 'ArrowUp' });
  assert.equal(globalThis.document.activeElement, items.at(-1));
  items[0].fire('keydown', { key: 'Escape' });
  assert.equal(s.menu(), null, 'Esc closes it');
  assert.equal(globalThis.document.activeElement, s.tab('more'), 'and gives the focus back to the ⋯ button');
});

test('an entry does its job and closes the menu; the focus is then the entry\'s to place', () => {
  const s = setup();
  for (const id of ['tour', 'ai', 'help', 'settings']) {
    open(s);
    menuItems(s).find((b) => b.attrs['data-more'] === id).fire('click');
    assert.equal(s.menu(), null, `${id} closes the menu`);
  }
  assert.deepEqual(s.log, ['tour', 'ai', 'help', 'settings']);
});

test('the Full entry is a switch: it says whether it is on, flips on a click and keeps the menu open on it', () => {
  const s = setup();
  open(s);
  let full = menuItems(s).find((b) => b.attrs['data-more'] === 'full');
  assert.equal(full.attrs.role, 'menuitemcheckbox');
  assert.equal(full.attrs['aria-checked'], 'false');
  assert.match(full.text, /Every area/, 'its words say what it does');
  full.fire('click');
  assert.deepEqual(s.log, ['full:true']);
  assert.ok(s.menu(), 'still open');
  full = menuItems(s).find((b) => b.attrs['data-more'] === 'full');
  assert.equal(full.attrs['aria-checked'], 'true');
  assert.equal(globalThis.document.activeElement, full, 'the focus stays on the switch');
});

test('with every area on the bar (Full) the ⋯ is still there, holding help and Configurações only', () => {
  const s = setup({ tech: true });
  open(s);
  assert.deepEqual(menuItems(s).map((b) => b.attrs['data-more']), ['tour', 'ai', 'full', 'help', 'settings']);
  assert.ok(!s.menu().all().some((n) => n.attrs.role === 'separator'), 'no rule when nothing is above it');
  const bar = s.root.querySelectorAll('.nav-tab').filter((b) => b.attrs.id !== 'tab-more').map((b) => b.attrs.id);
  assert.ok(bar.includes('tab-flow') && bar.includes('tab-costs') && bar.includes('tab-discover'), 'the whole panel is on the bar');
});

test('on a phone the same ⋯ (Mais) of the bottom bar holds them', () => {
  const s = setup({ phone: true });
  open(s);
  assert.deepEqual(menuItems(s).slice(-5).map((b) => b.attrs['data-more']), ['tour', 'ai', 'full', 'help', 'settings']);
});

// ---- Configurações holds every setting ----

async function sheet(extra = {}) {
  const dialog = new El('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  const log = [];
  const tr = translator('en');
  const ctl = createRunSettings({
    dialog, h, t: () => tr, money: (v) => `$${v}`, toast() {}, errorText: (e) => e, icon,
    limit: { read: async () => ({ ok: true, limitUSD: 20, spentUSD: 3 }), save: async (usd) => ({ ok: true, limitUSD: usd }) },
    onPcMode() {},
    lang: () => 'pt-BR', setLang: (code) => log.push(`lang:${code}`), openAlerts: () => log.push('alerts'),
    ...extra,
  });
  globalThis.document = { activeElement: null };
  await ctl.open(null, null);
  return { dialog, ctl, log, set: (k) => dialog.all().find((n) => n.attrs['data-set'] === k) };
}

test('Configurações has the language (PT / EN, the open one chosen) and the alert settings, besides the limit and permissions', async () => {
  const { dialog, set, log } = await sheet();
  const group = dialog.all().find((n) => n.attrs.role === 'radiogroup');
  assert.ok(group, 'the language is a radio group');
  const [pt, en] = [set('lang-pt-BR'), set('lang-en')];
  assert.deepEqual([pt.attrs['aria-checked'], en.attrs['aria-checked']], ['true', 'false']);
  assert.equal(pt.attrs.lang, 'pt-BR');
  en.fire('click');
  assert.deepEqual(log, ['lang:en']);
  pt.fire('click');
  assert.deepEqual(log, ['lang:en'], 'the language that is open is not chosen again');
  set('alerts').fire('click');
  assert.deepEqual(log, ['lang:en', 'alerts']);
  assert.equal(dialog.open, false, 'the sheet gives way to the alerts');
  for (const k of ['limit', 'limit-save', 'mode', 'pcmode']) assert.ok(set(k), `${k} is still there`);
});

test('the words of the ⋯ menu, the Configurações sheet and the tour exist in both languages', () => {
  const keys = ['more.help', 'more.full', 'more.fullHint', 'settings.general', 'settings.alertsHint', 'tour.replay', 'aih.open', 'help.title', 'tour.help.text', 'tour.help.textPhone', 'lang.label', 'notify.button'];
  for (const lang of ['en', 'pt-BR']) for (const k of keys) assert.ok(LANGS[lang][k], `${lang}: ${k}`);
  assert.equal(LANGS['pt-BR']['more.full'], 'Modo completo');
  assert.match(LANGS['pt-BR']['tour.help.text'], /⋯/, 'the tour says where help lives now');
});
