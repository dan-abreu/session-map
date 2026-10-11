// The page's shell (B6-T8, fd10): the new bar in place of the old tabs, one section per area, the registry that ties an
// area to its view (areas.js), and app.js reading the table of areas instead of a list of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREAS, iconsOf, normalizeView } from '../server/web/nav.js';
import { TOUR_STEPS } from '../server/web/tour.js';
import { translator } from '../server/web/i18n.js';
import { createAreas, sectionOf } from '../server/web/areas.js';

const WEB = new URL('../server/web/', import.meta.url);
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const app = readFileSync(new URL('app.js', WEB), 'utf8');
const css = readFileSync(new URL('style.css', WEB), 'utf8');

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({
  tag, attrs: attrs ?? {}, children: kids(children),
  get firstChild() { return this.children[0] ?? null; },
  replaceChildren(...c) { this.children = kids(c); },
  contains() { return false; },
});
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
const walk = (n, out = []) => { if (typeof n !== 'object' || !n) return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));

function spyView() {
  const calls = [];
  return { calls, render: (root, sub) => calls.push(['render', sub ?? null]), refresh: (root, sub) => calls.push(['refresh', sub ?? null]) };
}

test('every area has its section in the page, named view-<id>', () => {
  for (const a of AREAS) {
    assert.equal(sectionOf(a.id), `view-${a.id}`);
    assert.ok(html.includes(`id="view-${a.id}"`), `section view-${a.id}`);
  }
});

test('the old tabs are gone: one root for the new bar, no Board or History tab or section left', () => {
  assert.ok(html.includes('id="navbar"'), 'the bar has its root');
  assert.doesNotMatch(html, /<nav class="tabs"/);
  for (const old of ['tab-board', 'tab-history', 'view-board', 'view-history']) assert.ok(!html.includes(`id="${old}"`), old);
  assert.doesNotMatch(app, /\$\(`#tab-\$\{v\}`\)/, 'no tab is wired by hand any more');
});

test('every icon of the table has its symbol in the sprite', () => {
  for (const name of new Set([...Object.values(iconsOf()), 'more'])) assert.ok(html.includes(`<symbol id="i-${name}"`), `i-${name}`);
});

test('the page loads the foundation styles after its own', () => {
  const at = html.indexOf('href="style.css"');
  for (const f of ['model', 'care', 'health', 'guide', 'screens']) {
    const i = html.indexOf(`href="css/fd-${f}.css"`);
    assert.ok(i > at, `fd-${f}.css after style.css`);
  }
});

test('the tour points at tabs the bar draws and at elements the page has', () => {
  const ids = new Set([...AREAS.map((a) => `#tab-${a.id}`), '#tab-more']);
  for (const s of TOUR_STEPS) {
    for (const target of [s.target, s.phoneTarget].filter(Boolean)) {
      if (target.startsWith('#tab-')) assert.ok(ids.has(target), target);
      else assert.ok(html.includes(`id="${target.slice(1)}"`), target);
    }
  }
});

test('home and the page\'s own views are ready; Route, Health, Ideas and Library are still being built', () => {
  const own = Object.fromEntries(['map', 'flow', 'requests', 'convs', 'changes', 'costs', 'discover'].map((id) => [id, spyView()]));
  const areas = createAreas({ h, icon, t: () => translator('en'), own, home: { h, icon, t: translator('en'), fmt: { money: String, relative: String }, state: { projects: [] }, openProject() {}, goTo() {} } });
  const ready = areas.ready();
  assert.deepEqual(Object.keys(ready).sort(), AREAS.map((a) => a.id).sort());
  for (const id of ['home', 'map', 'flow', 'requests', 'convs', 'changes', 'costs', 'discover']) assert.equal(ready[id], true, id);
  for (const id of ['route', 'health', 'ideas', 'library']) assert.equal(ready[id], false, id);
});

test('an area without a view shows "being built" with its own words, never an empty page', () => {
  for (const lang of ['en', 'pt-BR']) {
    const tr = translator(lang);
    const areas = createAreas({ h, icon, t: () => tr, own: {} });
    const root = h('section');
    areas.draw('health', root, { first: true });
    const text = textOf(root);
    assert.ok(text.includes(tr('tab.health')), 'title');
    assert.ok(text.includes(tr('soon.health.what')), 'what it will hold');
    assert.ok(text.includes(tr('nav.soon')), 'when');
    assert.ok(walk(root).some((n) => n.attrs?.['data-icon'] === iconsOf().health), 'its icon');
  }
});

test('the registry renders first, refreshes after, and hands the sub-tab over', () => {
  const convs = spyView();
  const areas = createAreas({ h, icon, t: () => translator('en'), own: { convs } });
  const to = normalizeView('board');
  areas.draw(to.area, h('section'), { first: true, sub: to.sub });
  areas.draw('convs', h('section'));
  assert.deepEqual(convs.calls, [['render', 'board'], ['refresh', null]]);
});

test('the Home view comes from the registry and draws the projects of the state', () => {
  const state = { generatedAt: '2026-10-09T12:00:00.000Z', projects: [] };
  const areas = createAreas({ h, icon, t: () => translator('en'), own: {}, home: { h, icon, t: translator('en'), fmt: { money: String, relative: String }, state, openProject() {}, goTo() {} } });
  const root = h('section');
  areas.draw('home', root, { first: true });
  assert.ok(textOf(root).includes(translator('en')('home.empty.title')));
});

test('app.js reads the table: views by normalizeView, the bar by createNavbar, the sections by the registry', () => {
  assert.doesNotMatch(app, /const VIEWS = \[/, 'no list of views of its own');
  assert.match(app, /from '\.\/nav\.js'/);
  assert.match(app, /from '\.\/navbar\.js'/);
  assert.match(app, /from '\.\/areas\.js'/);
  assert.match(app, /function showView\([^)]*\) \{\s*const to = normalizeView\(/, 'showView passes every name through normalizeView');
  assert.match(app, /normalizeView\(store\.get\('sm\.view'\)\)/, 'the saved view too');
  assert.match(app, /tech: \(\) => tech,[^}]*extras: moreEntries/, 'the mode switch and the ⋯ entries reach the bar');
  assert.match(app, /navbar\.setReady\(areas\.ready\(\)\)/);
  assert.match(app, /areas\.draw\(/, 'refreshView goes through the registry');
  assert.match(app, /requestsView\.render\(/);
});

test('an old link ?view=board or history lands on Conversations with the right sub-tab', () => {
  assert.deepEqual(normalizeView('board'), { area: 'convs', sub: 'board' });
  assert.deepEqual(normalizeView('history'), { area: 'convs', sub: 'history' });
  assert.match(app, /const tab = params\.get\('view'\);\s*if \(tab\) showView\(tab\);/, 'the link goes through showView, so through normalizeView');
});

test('style.css makes room for the bar: the middle column grows, the phone keeps space under the bottom bar', () => {
  assert.match(css, /\.bar \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(css, /--navbar-h/);
  assert.doesNotMatch(css, /^\.tabs \{/m, 'the old tab styles left with the old tabs');
});

test('on the phone the page and everything fixed at the bottom stay above the bottom bar', () => {
  const phone = [...css.matchAll(/@media \(max-width: 719px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(phone, /\bbody \{[^}]*padding-bottom: var\(--navbar-space\)/, 'the page reserves the bar height');
  for (const sel of ['.hist-read', '.al-stack', '.tour-card', '.toast']) {
    const rule = phone.match(new RegExp(`^\\s*${sel.replace('.', '\\.')} \\{([^}]*)\\}`, 'm'));
    assert.ok(rule, `${sel} has a phone rule`);
    assert.match(rule[1], /var\(--navbar-space/, `${sel} sits above the bar, not under it`);
  }
});
