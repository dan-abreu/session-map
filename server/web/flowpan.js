// Moving the Flow drawing with the hand (fl15): the small pure parts, so they can be tested without a browser.

// How far (in screen pixels) the pointer must travel before a press becomes a drag; below it, it is still a click.
export const DRAG_THRESHOLD = 5;
export const dragStarted = (dx, dy, threshold = DRAG_THRESHOLD) => Math.hypot(dx, dy) > threshold;

// How much one wheel turn (or one pinch step on a trackpad, which arrives as a wheel with ctrlKey) multiplies the zoom.
// deltaMode 1 is "lines", 2 is "pages"; the speed is capped so a hard flick on a free-spinning wheel does not jump.
export function wheelFactor({ deltaY = 0, deltaMode = 0, ctrlKey = false } = {}) {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const speed = ctrlKey ? 0.01 : 0.0015;
  return Math.exp(-Math.max(-120, Math.min(120, px)) * speed);
}

export const clampZoom = (z, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(z * 1000) / 1000));

// Where the drawing's left edge sits inside the scrolling area's content: the padding, plus half of what is left when
// the drawing is narrower than the room (it is centred). width: the drawing's width; roomW: the area inside its padding.
export const svgLeftIn = (width, roomW, padLeft = 0) => padLeft + Math.max(0, (roomW - width) / 2);

// How far the area must be scrolled so that the point of the drawing that was under the pointer stays under it after
// the drawing changed size. u, v: that point in drawing units (from the drawing's top left); scale: the new screen
// pixels per drawing unit; left, top: where the drawing's top left now is inside the area's content (see svgLeftIn);
// clientX, clientY: the pointer; canvasLeft, canvasTop: where the area itself is on screen. It is worked out from the
// numbers, not from a measure of the page, because the browser may not have laid the new size out yet.
export const anchoredScroll = ({ u, v, scale, left, top, clientX, clientY, canvasLeft, canvasTop }) => ({
  left: left + u * scale - (clientX - canvasLeft),
  top: top + v * scale - (clientY - canvasTop),
});

export const clampScroll = (value, max) => Math.min(Math.max(0, max), Math.max(0, value));

// Where the area scrolls to while dragging: where it was when the press began, minus how far the pointer went.
export const dragScroll = ({ startLeft, startTop, dx, dy, maxLeft, maxTop }) => ({
  left: clampScroll(startLeft - dx, maxLeft),
  top: clampScroll(startTop - dy, maxTop),
});
