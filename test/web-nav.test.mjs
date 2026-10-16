// The table of areas (B6-T1): one list drives the top bar, the "More" menu, the phone bar, the tour and the tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, tabsFor, modeOf, normalizeView, iconsOf } from '../server/web/nav.js';

const ids = AREAS.map((a) => a.id);

test('the table has fourteen areas, each id once, each with a non-empty icon', () => {
  assert.equal(AREAS.length, 14);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of AREAS) {
    assert.ok(['global', 'project'].includes(a.scope), a.id);
    assert.equal(typeof a.icon, 'string', a.id);
    assert.ok(a.icon.length > 0, a.id);
    assert.equal(typeof a.bar, 'boolean', a.id);
  }
  assert.deepEqual(Object.keys(iconsOf()).sort(), [...ids].sort());
  for (const id of ids) assert.ok(iconsOf()[id].length > 0, id);
});

// Around the map (mm47): one row, Home · Map · Conversations · More; Full puts every area on the bar of a computer.
const MORE = ['flow', 'requests', 'changes', 'health', 'costs', 'brain', 'library', 'discover', 'logs'];

test('Simple: the bar shows Home, then Map and Conversations; the other areas sit under More', () => {
  const t = tabsFor({ tech: false });
  assert.deepEqual(t.global, ['home']);
  assert.deepEqual(t.project, ['map', 'convs']);
  assert.deepEqual(t.more, MORE, 'in table order');
  assert.deepEqual(t.bottom, []);
});

test('Full: every area with a page is on the bar, in table order, and nothing waits under More', () => {
  const t = tabsFor({ tech: true });
  assert.deepEqual(t.global, ['home', 'library', 'discover', 'logs']);
  assert.deepEqual(t.project, ['map', 'flow', 'requests', 'convs', 'changes', 'health', 'costs', 'brain']);
  assert.deepEqual(t.more, []);
});

test('Route and Ideas stay out of the bar and of More until they have a page', () => {
  for (const phone of [false, true]) {
    const shown = (t) => [...t.global, ...t.project, ...t.more, ...t.bottom];
    assert.ok(!shown(tabsFor({ phone })).includes('route'), `phone ${phone}: no Route`);
    assert.ok(!shown(tabsFor({ phone })).includes('ideas'), `phone ${phone}: no Ideas`);
    assert.ok(!shown(tabsFor({ phone, ready: { route: false, ideas: false } })).includes('route'));
    const ready = tabsFor({ phone, ready: { route: true, ideas: true } });
    assert.ok(ready.more.includes('route') && ready.more.includes('ideas'), 'once they have a page they wait in More');
  }
});

test('on desktop, global + project + more is every area once but the two waiting for a page', () => {
  for (const tech of [false, true]) {
    const t = tabsFor({ tech });
    const all = [...t.global, ...t.project, ...t.more];
    assert.equal(all.length, 12);
    assert.deepEqual([...all].sort(), ids.filter((id) => !['route', 'ideas'].includes(id)).sort());
  }
});

test('on a phone the bottom bar has Home, Map, Conversations and More, and More covers every other area', () => {
  for (const tech of [false, true]) {
    const t = tabsFor({ tech, phone: true });
    assert.deepEqual(t.bottom, ['home', 'map', 'convs', 'more']);
    assert.deepEqual(t.more, MORE);
    const reachable = new Set([...t.bottom.filter((x) => x !== 'more'), ...t.more]);
    assert.deepEqual([...reachable].sort(), ids.filter((id) => !['route', 'ideas'].includes(id)).sort());
  }
});

test('tabsFor with no argument is Simple on desktop', () => {
  assert.deepEqual(tabsFor(), tabsFor({ tech: false, phone: false }));
});

test('modeOf turns the technical switch into the two mode names', () => {
  assert.equal(modeOf(true), 'full');
  assert.equal(modeOf(false), 'simple');
  assert.equal(modeOf(undefined), 'simple');
});

test('normalizeView keeps real areas, maps the old board and history names to Conversations, and falls back to the map', () => {
  assert.deepEqual(normalizeView('board'), { area: 'convs', sub: 'board' });
  assert.deepEqual(normalizeView('history'), { area: 'convs', sub: 'history' });
  for (const id of ids) assert.equal(normalizeView(id).area, id);
  assert.deepEqual(normalizeView('map'), { area: 'map', sub: null });
  assert.deepEqual(normalizeView('nonsense'), { area: 'map', sub: null });
  assert.deepEqual(normalizeView(null), { area: 'map', sub: null });
  assert.deepEqual(normalizeView(undefined), { area: 'map', sub: null });
  assert.deepEqual(normalizeView('__proto__'), { area: 'map', sub: null });
});
