import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAG_THRESHOLD, clampScroll, clampZoom, dragScroll, dragStarted, anchoredScroll, svgLeftIn, wheelFactor } from '../server/web/flowpan.js';

test('a press that moved only a little is still a click; past the threshold it is a drag', () => {
  assert.equal(dragStarted(0, 0), false);
  assert.equal(dragStarted(3, 3), false, 'about 4px');
  assert.equal(dragStarted(DRAG_THRESHOLD, 0), false, 'exactly the threshold is still a click');
  assert.equal(dragStarted(0, -6), true);
  assert.equal(dragStarted(4, 4), true, 'about 5.7px diagonally');
});

test('the wheel: up zooms in, down zooms out, a pinch is faster, a flick is capped', () => {
  assert.ok(wheelFactor({ deltaY: -100 }) > 1);
  assert.ok(wheelFactor({ deltaY: 100 }) < 1);
  assert.equal(wheelFactor({ deltaY: 0 }), 1);
  assert.ok(wheelFactor({ deltaY: -10, ctrlKey: true }) > wheelFactor({ deltaY: -10 }));
  assert.equal(wheelFactor({ deltaY: -100000 }), wheelFactor({ deltaY: -120 }));
  assert.ok(wheelFactor({ deltaY: -3, deltaMode: 1 }) > wheelFactor({ deltaY: -3 }), 'lines count for more than pixels');
  assert.ok(Math.abs(wheelFactor({ deltaY: -50 }) * wheelFactor({ deltaY: 50 }) - 1) < 1e-9, 'in and out cancel');
});

test('clampZoom keeps the zoom inside its range', () => {
  assert.equal(clampZoom(10, [0.15, 3]), 3);
  assert.equal(clampZoom(0.01, [0.15, 3]), 0.15);
  assert.equal(clampZoom(1.23456, [0.15, 3]), 1.235);
});

test('a drawing narrower than the area is centred; a wider one starts at the padding', () => {
  assert.equal(svgLeftIn(400, 1000, 28), 328);
  assert.equal(svgLeftIn(1000, 1000, 28), 28);
  assert.equal(svgLeftIn(2500, 1000, 28), 28);
});

test('zooming around the pointer: the drawing point under it stays under it', () => {
  // The area is at x=300 on screen; the pointer at x=700 is 400 into it. The point u=200 of a drawing that starts at
  // 28 in the content: at scale 2 it is 428 into the content, so the area scrolls 28 to the right.
  assert.deepEqual(anchoredScroll({ u: 200, v: 50, scale: 2, left: 28, top: 28, clientX: 700, clientY: 128, canvasLeft: 300, canvasTop: 100 }), { left: 28, top: 100 });
  // Zooming out to a centred drawing: the same point is further in, so no scroll is needed (negative means none).
  const out = anchoredScroll({ u: 200, v: 0, scale: 0.5, left: 450, top: 28, clientX: 700, clientY: 128, canvasLeft: 300, canvasTop: 100 });
  assert.equal(out.left, 150);
  // The pointer already over the same place: nothing to scroll from the origin.
  assert.deepEqual(anchoredScroll({ u: 10, v: 10, scale: 1, left: 0, top: 0, clientX: 10, clientY: 10, canvasLeft: 0, canvasTop: 0 }), { left: 0, top: 0 });
});

test('dragging scrolls the opposite way and never past the edges', () => {
  assert.deepEqual(dragScroll({ startLeft: 100, startTop: 100, dx: 30, dy: -20, maxLeft: 500, maxTop: 500 }), { left: 70, top: 120 });
  assert.deepEqual(dragScroll({ startLeft: 10, startTop: 480, dx: 50, dy: -50, maxLeft: 500, maxTop: 500 }), { left: 0, top: 500 });
  assert.equal(clampScroll(-5, 0), 0);
  assert.equal(clampScroll(5, -3), 0, 'a drawing smaller than the area cannot scroll');
});
