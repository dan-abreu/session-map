// The side sheets (the chat of the map, the ateliê of the flow, the panel) are as wide as the person drags them.
// The pure part on top is what node:test loads; createResizer below touches the DOM only when called.

const MIN = 320;
const MAX_RATIO = 0.7;
// The map keeps at least this much beside the sheet, even in a window narrower than MIN / MAX_RATIO.
const MAP_KEEP = 120;
const STEP = 24;

export function widthBounds(viewport) {
  const max = Math.round(Math.min(viewport * MAX_RATIO, viewport - MAP_KEEP));
  return { min: Math.min(MIN, max), max };
}

export function clampWidth(width, viewport) {
  const { min, max } = widthBounds(viewport);
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.min(Math.max(width, min), max));
}

// The handle is on the sheet's left edge: moving it left makes the sheet wider.
export const dragWidth = (startWidth, startX, x, viewport) => clampWidth(startWidth + (startX - x), viewport);

export function keyWidth(key, width, viewport) {
  const { min, max } = widthBounds(viewport);
  if (key === 'ArrowLeft') return clampWidth(width + STEP, viewport);
  if (key === 'ArrowRight') return clampWidth(width - STEP, viewport);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}

// handle: the separator on the sheet's left edge; target + cssVar: where the width is written (the sheet and the map read it);
// storageKey: where the chosen width is remembered; defaultWidth(): the width a double click goes back to.
export function createResizer({ sheet, handle, target, cssVar, storageKey, defaultWidth, label, onChange = () => {} }) {
  const phone = window.matchMedia('(max-width: 719px)');
  const read = () => {
    try { return Number.parseFloat(localStorage.getItem(storageKey) ?? ''); } catch { return Number.NaN; }
  };
  const save = (w) => {
    try {
      if (w === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(w));
    } catch { /* storage blocked: the width is just not remembered */ }
  };
  let chosen = read();
  // The width last written: the page can take a few frames to show it, and a held arrow key must not step from a stale size.
  let shown;

  function apply(width, { persist = false } = {}) {
    const viewport = window.innerWidth;
    const w = clampWidth(width, viewport);
    const { min, max } = widthBounds(viewport);
    target.style.setProperty(cssVar, `${w}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(w));
    shown = w;
    if (persist) { chosen = w; save(w); }
    onChange(w);
    return w;
  }
  const current = () => (Number.isFinite(chosen) ? chosen : defaultWidth());

  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('tabindex', '0');
  if (label) handle.setAttribute('aria-label', label);

  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || phone.matches) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: sheet.getBoundingClientRect().width };
    document.body.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (drag) apply(dragWidth(drag.w, drag.x, e.clientX, window.innerWidth));
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('is-resizing');
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    apply(sheet.getBoundingClientRect().width, { persist: true });
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    chosen = Number.NaN;
    save(null);
    apply(defaultWidth());
  });
  handle.addEventListener('keydown', (e) => {
    const w = keyWidth(e.key, shown, window.innerWidth);
    if (w === null) return;
    e.preventDefault();
    apply(w, { persist: true });
  });
  window.addEventListener('resize', () => apply(current()));
  apply(current());
  return { relabel(text) { handle.setAttribute('aria-label', text); }, refresh: () => apply(current()) };
}

// The split inside a box's sheet, between its information on top and its chat under it: the information keeps a line or
// two, the chat keeps room for a few messages and the box to write in. room: the height the two share.
const INFO_MIN = 72;
const CHAT_KEEP = 200;

export function clampSplit(height, room) {
  const max = Math.max(INFO_MIN, room - CHAT_KEEP);
  if (!Number.isFinite(height)) return INFO_MIN;
  return Math.round(Math.min(Math.max(height, INFO_MIN), max));
}

// The handle sits between the two: ArrowDown gives the information more, ArrowUp gives the chat more.
export function keySplit(key, height, room) {
  if (key === 'ArrowDown') return clampSplit(height + STEP, room);
  if (key === 'ArrowUp') return clampSplit(height - STEP, room);
  if (key === 'Home') return clampSplit(INFO_MIN, room);
  if (key === 'End') return clampSplit(room, room);
  return null;
}

// handle: the line between them; info and pane: the information and the chat; target + cssVar: where the information's
// height is written (the stylesheet caps it there); active(): false while the information is folded to one line.
export function createSplit({ handle, info, pane, target, cssVar, storageKey, active }) {
  const room = () => info.getBoundingClientRect().height + pane.getBoundingClientRect().height;
  const save = (px) => {
    try {
      if (px === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(px));
    } catch { /* storage blocked: the split is just not remembered */ }
  };
  function apply(height, { persist = false } = {}) {
    const total = room();
    const px = clampSplit(height, total);
    target.style.setProperty(cssVar, `${px}px`);
    handle.setAttribute('aria-valuenow', String(total ? Math.round((px / total) * 100) : 0));
    if (persist) save(px);
  }
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');
  try {
    const kept = Number.parseFloat(localStorage.getItem(storageKey) ?? '');
    if (Number.isFinite(kept)) target.style.setProperty(cssVar, `${kept}px`);
  } catch { /* storage blocked: the usual share */ }

  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !active()) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: info.getBoundingClientRect().height };
    document.body.classList.add('is-splitting');
  });
  handle.addEventListener('pointermove', (e) => {
    if (drag) apply(drag.h + (e.clientY - drag.y));
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('is-splitting');
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    apply(info.getBoundingClientRect().height, { persist: true });
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    target.style.removeProperty(cssVar);
    save(null);
  });
  handle.addEventListener('keydown', (e) => {
    if (!active()) return;
    const px = keySplit(e.key, info.getBoundingClientRect().height, room());
    if (px === null) return;
    e.preventDefault();
    apply(px, { persist: true });
  });
}
