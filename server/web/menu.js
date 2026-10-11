// One small menu around the map (mm47, mm48): "Novo" at the head of the conversations, "Vista" over the map and the
// person's menu in the bar. A button opens a list under it; the arrows walk its items, Esc or a press outside closes it,
// Tab leaves it. An item marked data-close closes it after its own click and gives the focus back to the button; a
// switch or a choice keeps it open.
// ctx: button, pop (the list, hidden while closed), doc (the document; defaults to the page's), inside(el) (what else
// counts as the menu's own, like the period picker it opens), onOpen(), onClose().
export function createMenu(ctx) {
  const { button, pop } = ctx;
  const doc = ctx.doc ?? globalThis.document;
  let outside = null;

  // What the person can reach: not disabled, not hidden, and drawn (a phone-only item takes no room on a computer).
  const items = () => [...pop.querySelectorAll('[role^="menuitem"]')]
    .filter((el) => !el.disabled && !el.hidden && !el.closest('[hidden]') && (el.getClientRects?.().length ?? 1) > 0);
  const isOpen = () => !pop.hidden;

  function open() {
    if (isOpen()) return;
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    ctx.onOpen?.();
    outside = (e) => { if (!pop.contains(e.target) && !button.contains(e.target) && !ctx.inside?.(e.target)) close(false); };
    doc?.addEventListener?.('pointerdown', outside);
    items()[0]?.focus();
  }

  function close(restore = false) {
    if (outside) doc?.removeEventListener?.('pointerdown', outside);
    outside = null;
    if (!isOpen()) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    ctx.onClose?.();
    if (restore) button.focus();
  }

  button.addEventListener('click', () => (isOpen() ? close(false) : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !isOpen()) { e.preventDefault(); open(); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    const list = items();
    const at = list.indexOf(doc?.activeElement);
    const n = list.length;
    const to = { ArrowDown: (at + 1) % n, ArrowUp: (at - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined || !n) return;
    e.preventDefault();
    list[to].focus();
  });
  // After its own click (which runs first): the focus goes back to the button, unless the item sent it somewhere else
  // (a dialog, a panel); a hidden item must not drop it to the page.
  pop.addEventListener('click', (e) => {
    if (!e.target.closest('[data-close]')) return;
    const at = doc?.activeElement;
    const lost = !at || at === doc?.body || pop.contains(at);
    close(false);
    if (lost) button.focus();
  });

  return { open, close, isOpen };
}
