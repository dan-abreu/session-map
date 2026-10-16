import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabbedArea, createHealthArea, createRouteArea } from '../server/web/foundationareas.js';
import { createAreas } from '../server/web/areas.js';
import { AREAS } from '../server/web/nav.js';
import { translator } from '../server/web/i18n.js';

// The Foundation's screens on the page (fd22): Route, Health, Ideas and Library had views and no place in the registry, so
// the page said "It arrives in the next version". Drawn here on a tiny element tree, without a browser (the browser smoke,
// scripts/smoke-browser.mjs, looks at the real thing).

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const tabsOf = (root) => walk(root).filter((x) => x.attrs.role === 'tab');
const bodyOf = (root) => walk(root).find((x) => x.attrs.role === 'tabpanel');
const t = translator('en');

function probe(name) {
  const calls = [];
  return { calls, view: { render: (body, sub) => { calls.push(['render', name, body, sub]); }, refresh: (body) => { calls.push(['refresh', name, body]); } } };
}

test('the strip opens the first sub-page, or the one asked for, and ignores a name it does not have', () => {
  const a = probe('a');
  const b = probe('b');
  const area = createTabbedArea({ h, t, name: 'health', tabs: [{ id: 'health', view: a.view }, { id: 'versions', view: b.view }] });
  const root = h('div');
  area.render(root);
  assert.equal(area.current(), 'health');
  assert.deepEqual(a.calls.map((c) => c[0]), ['render']);
  assert.deepEqual(tabsOf(root).map((x) => x.attrs['aria-selected']), ['true', 'false']);
  area.render(h('div'), 'versions');
  assert.equal(area.current(), 'versions');
  area.render(h('div'), 'nope');
  assert.equal(area.current(), 'versions', 'an unknown sub-page keeps the open one');
});

test('a click on a tab draws that sub-page in the body; a poll refreshes only the open one; another root starts over', () => {
  const a = probe('a');
  const b = probe('b');
  const area = createTabbedArea({ h, t, name: 'health', tabs: [{ id: 'health', view: a.view }, { id: 'versions', view: b.view }] });
  const root = h('div');
  area.render(root);
  tabsOf(root)[1].attrs.onclick();
  assert.equal(area.current(), 'versions');
  assert.equal(b.calls.at(-1)[0], 'render');
  assert.equal(b.calls.at(-1)[2], bodyOf(root), 'it draws in the strip\'s body');
  area.refresh(root);
  assert.deepEqual([a.calls.at(-1)[0], b.calls.at(-1)[0]], ['render', 'refresh']);
  const other = h('div');
  area.refresh(other);
  assert.equal(b.calls.at(-1)[0], 'render', 'a new root is drawn from scratch');
  assert.equal(other.children.length, 2, 'the strip and its body');
});

test('the arrows, Home and End move along the strip and wrap', () => {
  const views = ['a', 'b', 'c'].map(probe);
  const area = createTabbedArea({ h, t, name: 'route', tabs: ['route', 'profile', 'practices'].map((id, i) => ({ id, view: views[i].view })) });
  const root = h('div');
  area.render(root);
  const press = (key) => walk(root).find((x) => x.attrs.role === 'tablist').attrs.onkeydown({ key });
  press('ArrowRight');
  assert.equal(area.current(), 'profile');
  press('End');
  assert.equal(area.current(), 'practices');
  press('ArrowRight');
  assert.equal(area.current(), 'route', 'wraps to the first');
  press('ArrowLeft');
  assert.equal(area.current(), 'practices', 'and back to the last');
  press('x');
  assert.equal(area.current(), 'practices', 'another key does nothing');
});

test('every sub-page has a name and a label in both languages', () => {
  const sub = ['health', 'uptodate', 'versions', 'findings', 'care', 'route', 'profile', 'practices', 'aria.health', 'aria.route'];
  for (const lang of ['en', 'pt-BR']) for (const id of sub) assert.notEqual(translator(lang)(`fd.sub.${id}`), `fd.sub.${id}`, `${lang} ${id}`);
});

test('Health has the five sub-pages the Home sends people to, and Route has its three', () => {
  const base = {
    h, icon: () => h('svg'), t: (k, v) => t(k, v), tr: () => t, project: () => ({ id: 'p' }), tech: () => false, lang: () => 'en',
    errorText: (c) => c, toast: () => {}, dialog: h('dialog'), careMode: () => null, openFile: () => {}, openChat: () => {}, openFindings: () => {}, onMode: () => {},
  };
  const health = createHealthArea(base);
  const route = createRouteArea(base);
  const root = h('div');
  health.render(root, 'care');
  assert.deepEqual(tabsOf(root).map((x) => x.attrs['data-sub']), ['health', 'uptodate', 'versions', 'findings', 'care']);
  assert.equal(health.current(), 'care', 'the Home opens health/care when the care mode is not chosen');
  const r2 = h('div');
  route.render(r2);
  assert.deepEqual(tabsOf(r2).map((x) => x.attrs['data-sub']), ['route', 'profile', 'practices']);
});

test('the registry has a view for Route, Health, Ideas and Library once their context is given, and for no area fewer than before', () => {
  const base = {
    h, icon: () => h('svg'), t: (k, v) => t(k, v), tr: () => t, project: () => ({ id: 'p' }), tech: () => false, lang: () => 'en',
    errorText: (c) => c, toast: () => {}, dialog: h('dialog'), careMode: () => null, openFile: () => {}, openChat: () => {}, openFindings: () => {}, onMode: () => {},
  };
  const own = Object.fromEntries(['map', 'flow', 'requests', 'convs', 'changes', 'costs', 'discover'].map((id) => [id, { render() {}, refresh() {} }]));
  const areas = createAreas({ h, icon: () => h('svg'), t: () => t, own, health: base, route: base, ideas: base, library: base, home: { ...base, state: () => ({ projects: [] }), fmt: {}, now: () => 0 }, brain: base, logs: { ...base, projects: () => [], fmt: {} } });
  const ready = areas.ready();
  for (const id of ['route', 'health', 'ideas', 'library']) assert.equal(ready[id], true, `${id} has its view`);
  assert.equal(AREAS.filter((a) => !ready[a.id]).length, 0, 'no area is left with "arrives in the next version"');
});
