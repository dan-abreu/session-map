// The table of areas (B6-T1): one list drives the top bar, the "More" menu, the phone bar, the tour and the tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, tabsFor, modeOf, normalizeView, iconsOf } from '../server/web/nav.js';

const ids = AREAS.map((a) => a.id);

test('the table has twelve areas, each id once, each with a non-empty icon', () => {
  assert.equal(AREAS.length, 12);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of AREAS) {
    assert.ok(['global', 'project'].includes(a.scope), a.id);
    assert.equal(typeof a.icon, 'string', a.id);
    assert.ok(a.icon.length > 0, a.id);
    assert.equal(typeof a.simple, 'boolean', a.id);
  }
  assert.deepEqual(Object.keys(iconsOf()).sort(), [...ids].sort());
  for (const id of ids) assert.ok(iconsOf()[id].length > 0, id);
});

test('Simple mode shows Home, then Route, Map, Conversations and Ideas; the other seven sit under More', () => {
  const t = tabsFor({ tech: false });
  assert.deepEqual(t.global, ['home']);
  assert.deepEqual(t.project, ['route', 'map', 'convs', 'ideas']);
  assert.equal(t.more.length, 7);
  assert.deepEqual([...t.more].sort(), ['changes', 'costs', 'discover', 'flow', 'health', 'library', 'requests']);
  assert.deepEqual(t.bottom, []);
});

test('Full mode puts nine project areas and two more global ones on the bar, and More is empty', () => {
  const t = tabsFor({ tech: true });
  assert.deepEqual(t.global, ['home', 'library', 'discover']);
  assert.equal(t.project.length, 9);
  assert.deepEqual(t.project, ['route', 'map', 'flow', 'requests', 'convs', 'changes', 'health', 'ideas', 'costs']);
  assert.deepEqual(t.more, []);
});

test('on desktop, global + project + more is every area once, in both modes', () => {
  for (const tech of [false, true]) {
    const t = tabsFor({ tech });
    const all = [...t.global, ...t.project, ...t.more];
    assert.equal(all.length, 12);
    assert.deepEqual([...all].sort(), [...ids].sort());
  }
});

test('on a phone the bottom bar has five places and More covers every other area, in both modes', () => {
  for (const tech of [false, true]) {
    const t = tabsFor({ tech, phone: true });
    assert.deepEqual(t.bottom, ['home', 'route', 'map', 'convs', 'more']);
    assert.deepEqual([...t.more].sort(), ids.filter((id) => !['home', 'route', 'map', 'convs'].includes(id)).sort());
    const reachable = new Set([...t.bottom.filter((x) => x !== 'more'), ...t.more]);
    assert.deepEqual([...reachable].sort(), [...ids].sort());
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
