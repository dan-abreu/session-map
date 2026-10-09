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

  function apply(width, { persist = false } = {}) {
    const viewport = window.innerWidth;
    const w = clampWidth(width, viewport);
    const { min, max } = widthBounds(viewport);
    target.style.setProperty(cssVar, `${w}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(w));
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
    const w = keyWidth(e.key, sheet.getBoundingClientRect().width || current(), window.innerWidth);
    if (w === null) return;
    e.preventDefault();
    apply(w, { persist: true });
  });
  window.addEventListener('resize', () => apply(current()));
  apply(current());
  return { relabel(text) { handle.setAttribute('aria-label', text); }, refresh: () => apply(current()) };
}
