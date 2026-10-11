// The "look only" link hides every area whose reads the server refuses (server.md sv11): a visitor with the link sees
// the map (and Live on it) and the Requests, which draw from the map's state, and never an error from a refused read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREAS, LOOK_AREAS, LOOK_LINKS, deepLinkParams, normalizeView, tabsFor } from '../server/web/nav.js';
import { createNavbar } from '../server/web/navbar.js';
import { lookTabs, pointTabs, projectTabs } from '../server/web/kinds.js';
import { translator } from '../server/web/i18n.js';

test('a look-only visitor may open the map and the Requests, nothing else', () => {
  assert.deepEqual(LOOK_AREAS, ['map', 'requests']);
  for (const id of LOOK_AREAS) assert.ok(AREAS.some((a) => a.id === id), id);
  // Home and Conversations, the foundation's areas (Route, Health, Ideas, Library) and the rest read what the server refuses.
  for (const id of ['home', 'convs', 'route', 'health', 'ideas', 'library', 'changes', 'costs', 'discover', 'flow']) assert.equal(LOOK_AREAS.includes(id), false, id);
});

test('with the look-only link the bar holds only those areas, with no More menu, on desktop and phone, in both modes', () => {
  for (const tech of [false, true]) {
    assert.deepEqual(tabsFor({ tech, look: true }), { global: [], project: ['map', 'requests'], more: [], bottom: [] });
    assert.deepEqual(tabsFor({ tech, phone: true, look: true }), { global: [], project: [], more: [], bottom: ['map', 'requests'] });
  }
  assert.notDeepEqual(tabsFor({ tech: false, look: false }), tabsFor({ tech: false, look: true }), 'the owner keeps every area');
});

test('with the look-only link a saved or linked area the server refuses lands on the map', () => {
  for (const raw of ['home', 'convs', 'board', 'history', 'route', 'health', 'ideas', 'library', 'changes', 'costs', 'discover', 'flow', 'bogus', null]) {
    assert.deepEqual(normalizeView(raw, { look: true }), { area: 'map', sub: null }, String(raw));
  }
  assert.deepEqual(normalizeView('requests', { look: true }), { area: 'requests', sub: null });
  assert.deepEqual(normalizeView('map', { look: true }), { area: 'map', sub: null });
  assert.deepEqual(normalizeView('home'), { area: 'home', sub: null }, 'the owner still lands where asked');
  assert.deepEqual(normalizeView('board'), { area: 'convs', sub: 'board' });
});

// ---- the bar itself, on a tiny document ----------------------------------------------------------------------------
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.handlers = {}; this.className = ''; this.parent = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'object' ? k : Object.assign(new El('#text'), { _text: String(k) }); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  focus() {}
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  all() { return this.children.flatMap((c) => [c, ...(c.all?.() ?? [])]); }
  querySelector(sel) { return this.all().find((n) => n.tag === sel || (sel[0] === '.' && n.className?.split(/\s+/).includes(sel.slice(1)))) ?? null; }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

function barIds({ phone = false, tech = false, look }) {
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  const root = h('div');
  const tr = translator('en');
  const bar = createNavbar({ h, root, t: () => tr, tech: () => tech, phone: () => phone, look, current: 'map', doc });
  bar.render();
  return root.all().filter((n) => n.tag === 'button').map((b) => b.attrs.id);
}

test('the navigation bar opened with the look-only link shows Map and Requests and no More button', () => {
  for (const phone of [false, true]) {
    for (const tech of [false, true]) assert.deepEqual(barIds({ phone, tech, look: () => true }), ['tab-map', 'tab-requests'], `phone ${phone}, tech ${tech}`);
  }
  assert.ok(barIds({ look: () => false }).includes('tab-home'), 'the owner still sees Home');
  assert.ok(barIds({}).includes('tab-more'), 'and the More menu');
});

test('a box\'s details opened with the look-only link drop the Files tab, whose list the server refuses', () => {
  const all = pointTabs({ tasks: true, chats: true, changes: true, files: true });
  assert.deepEqual(lookTabs(all), ['summary', 'tasks', 'chats', 'changes']);
  assert.deepEqual(lookTabs(projectTabs({ changes: true, files: true })), ['summary', 'chats', 'changes']);
});

test('the page wires the look-only mode into the bar, the areas and the box details', () => {
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /look: \(\) => lookMode/, 'the bar asks the page whether it is in look mode');
  assert.match(app, /normalizeView\(name, \{ look: lookMode \}\)/, 'an area is opened only if the look mode allows it');
  assert.match(app, /lookMode \? lookTabs\(/, 'the box details drop what the server refuses');
  // What would read a refused route from a link (?pcmode=, ?alerts=1) waits for the owner.
  assert.match(app, /if \(!lookMode && params\.get\('pcmode'\)\)/);
  assert.match(app, /if \(!lookMode && params\.get\('alerts'\) === '1'\)/);
  // Links on the map that open a file or the Files tab read what the server refuses: the style hides them.
  const css = readFileSync(new URL('../server/web/css/look.css', import.meta.url), 'utf8');
  for (const sel of ['.kind-row.kind-files', '.meta-link.path', '.meta-link.is-unowned']) assert.match(css, new RegExp(`\\.is-look ${sel.replace(/[.#]/g, '\\$&')}\\b`), sel);
});

test('a link opened with the look-only link keeps only what draws the map, never a dialog, the chat or a list it hides', () => {
  const all = '?project=p&open=all&q=x&select=node:a&tab=details&live=1&view=map&relations=1&changed=d7'
    + '&place=s1&conv=s1&idea=1&drawer=1&convfilter=b&alerts=1&pcmode=work&picker=1&nowopen=1&flowmode=workshop';
  const kept = [...deepLinkParams(all, { look: true }).keys()];
  assert.deepEqual(kept, ['project', 'open', 'q', 'select', 'tab', 'live', 'view', 'relations', 'changed']);
  assert.deepEqual([...kept].sort(), [...LOOK_LINKS].sort());
  // "Move or rename" would leave the visitor in a dialog with no button out; the chat and its list read refused routes.
  for (const key of ['place', 'conv', 'idea', 'drawer', 'convfilter', 'alerts', 'pcmode']) assert.equal(deepLinkParams(all, { look: true }).has(key), false, key);
  // The owner keeps every key, exactly as given.
  assert.equal(deepLinkParams(all).toString(), new URLSearchParams(all).toString());
  assert.equal(deepLinkParams(all, { look: false }).get('place'), 's1');
});

test('the page reads its link through the look-only filter', () => {
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  const body = app.slice(app.indexOf('function applyDeepLink()'), app.indexOf('async function main()'));
  assert.match(body, /const params = deepLinkParams\(location\.search, \{ look: lookMode \}\);/);
  assert.doesNotMatch(body, /new URLSearchParams\(location\.search\)/, 'no second, unfiltered read of the link');
});

test('an area picked while the page loads is checked again once the server says the link is look-only', () => {
  // The bar is clickable before the first state: a visitor who picks Home then is sent to the map, nothing else is drawn.
  assert.deepEqual(normalizeView('home', { look: true }), { area: 'map', sub: null });
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  const main = app.slice(app.indexOf('async function main()'));
  const set = main.indexOf('lookMode = Boolean(look);');
  // Only a refused area is sent away: a saved "requests" (sm.view) stays saved for the lines that read it back.
  const check = main.indexOf("if (lookMode && !LOOK_AREAS.includes(view)) showView('map');");
  const draw = main.indexOf('renderAll();');
  assert.ok(set >= 0 && check > set && check < draw, 'the area is checked after the mode is known and before the first drawing');
});

test('a state answer that switches between owner and look-only reloads the page, so no tab keeps the wrong areas', () => {
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  const poll = app.slice(app.indexOf('function poll()'), app.indexOf('function showView('));
  const check = poll.indexOf('if (res.ok && Boolean(res.look) !== lookMode) return location.reload();');
  assert.ok(check >= 0, 'the poll compares the mode of every answer, a 304 included');
  assert.ok(check < poll.indexOf('applyState('), 'before the new state is drawn');
});
