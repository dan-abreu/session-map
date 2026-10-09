import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWidth, dragWidth, keyWidth, widthBounds } from '../server/web/resize.js';

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
