import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSplit, clampWidth, createResizer, dragWidth, keySplit, keyWidth, widthBounds } from '../server/web/resize.js';

test('the side sheet stays between 320 px and 70% of the window, and a narrow window wins over the minimum', () => {
  assert.deepEqual(widthBounds(1440), { min: 320, max: 1008 });
  assert.equal(clampWidth(200, 1440), 320);
  assert.equal(clampWidth(1200, 1440), 1008);
  assert.equal(clampWidth(500.6, 1440), 501);
  assert.equal(clampWidth(900, 1000), 700, 'a window that shrank pulls a remembered width back in');
  assert.deepEqual(widthBounds(400), { min: 280, max: 280 }, 'never wider than the window minus a gutter');
  assert.ok(Number.isNaN(clampWidth(Number.NaN, 1440)) === false && clampWidth(Number.NaN, 1440) === 320, 'junk from storage falls back to the minimum');
});

test('dragging the left edge to the left widens the sheet', () => {
  assert.equal(dragWidth(460, 1000, 900, 1440), 560);
  assert.equal(dragWidth(460, 1000, 1300, 1440), 320);
  assert.equal(dragWidth(460, 1000, 0, 1440), 1008);
});

test('keyboard: arrows move 24 px (left widens), Home and End go to the minimum and the maximum, other keys do nothing', () => {
  assert.equal(keyWidth('ArrowLeft', 460, 1440), 484);
  assert.equal(keyWidth('ArrowRight', 460, 1440), 436);
  assert.equal(keyWidth('ArrowRight', 330, 1440), 320);
  assert.equal(keyWidth('Home', 460, 1440), 320);
  assert.equal(keyWidth('End', 460, 1440), 1008);
  assert.equal(keyWidth('Enter', 460, 1440), null);
});

test('keyboard: each press steps from the width last set, even while the page still shows the old one', () => {
  const listeners = {};
  const attrs = {};
  const props = {};
  const handle = { addEventListener: (type, fn) => { listeners[type] = fn; }, setAttribute: (k, v) => { attrs[k] = v; } };
  const sheet = { getBoundingClientRect: () => ({ width: 460 }) };
  const target = { style: { setProperty: (k, v) => { props[k] = v; } } };
  const saved = globalThis.window;
  globalThis.window = { innerWidth: 1440, matchMedia: () => ({ matches: false }), addEventListener: () => {} };
  try {
    createResizer({ sheet, handle, target, cssVar: '--w', storageKey: 'test.w', defaultWidth: () => 460 });
    const press = (key) => listeners.keydown({ key, preventDefault: () => {} });
    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowLeft');
    assert.equal(props['--w'], '532px');
    assert.equal(attrs['aria-valuenow'], '532');
    press('ArrowRight');
    assert.equal(props['--w'], '508px');
  } finally {
    globalThis.window = saved;
  }
});

test('the split of a box sheet keeps a line or two of information and room for the chat to write in', () => {
  assert.equal(clampSplit(20, 700), 72, 'the information never goes below a line or two');
  assert.equal(clampSplit(650, 700), 500, 'the chat keeps 200 px');
  assert.equal(clampSplit(300.4, 700), 300);
  assert.equal(clampSplit(Number.NaN, 700), 72);
  assert.equal(clampSplit(300, 150), 72, 'a sheet too short for both still shows the information line');
});

test('the split moves with the arrows: down gives the information more, up gives the chat more, Home and End go to the ends', () => {
  assert.equal(keySplit('ArrowDown', 300, 700), 324);
  assert.equal(keySplit('ArrowUp', 300, 700), 276);
  assert.equal(keySplit('Home', 300, 700), 72);
  assert.equal(keySplit('End', 300, 700), 500);
  assert.equal(keySplit('a', 300, 700), null);
});
