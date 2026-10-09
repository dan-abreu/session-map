// The five-step welcome tour (mm11): it starts once by itself on the first visit, can be skipped, and comes back from the
// help menu. Each step lights one place of the page and says in one or two sentences what it is for.
export const TOUR_STEPS = [
  { id: 'now', target: '#now' },
  { id: 'convs', target: '#convs', phoneTarget: '#convsBtn' },
  { id: 'map', target: '#mindmap', phoneTarget: '#outline' },
  { id: 'waiting', target: '#waitingBtn' },
  { id: 'help', target: '#helpBtn' },
];

export const tourWanted = (seen) => seen == null;
export const tourTarget = (step, phone) => (phone && step.phoneTarget) || step.target;

const GAP = 12;
const PAD = 6;

// ctx: h, t() (translator of the moment), phone() (true under 720 px), onEnd(how) with 'done' or 'skipped'.
export function createTour(ctx) {
  let root = null;
  let index = 0;
  let back = null;
  let restoreFocus = null;

  function place() {
    const step = TOUR_STEPS[index];
    const target = document.querySelector(tourTarget(step, ctx.phone()));
    const ring = root.querySelector('.tour-ring');
    const card = root.querySelector('.tour-card');
    const r = target?.getBoundingClientRect();
    const seen = r && r.width > 0 && r.height > 0;
    ring.hidden = !seen;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (seen) {
      const top = Math.max(r.top - PAD, 4);
      const left = Math.max(r.left - PAD, 4);
      Object.assign(ring.style, { top: `${top}px`, left: `${left}px`, width: `${Math.min(r.right + PAD, vw - 4) - left}px`, height: `${Math.min(r.bottom + PAD, vh - 4) - top}px` });
    }
    if (ctx.phone()) { card.style.cssText = ''; return; }
    const w = card.offsetWidth;
    const hgt = card.offsetHeight;
    // A big place (the map) keeps the card inside its top corner; a small one gets it just below, or above.
    const big = seen && r.height > vh * 0.5;
    let top = !seen ? (vh - hgt) / 2 : big ? r.top + 24 : r.bottom + PAD + GAP;
    if (seen && !big && top + hgt > vh - 16) top = Math.max(16, r.top - PAD - GAP - hgt);
    const left = !seen ? (vw - w) / 2 : Math.min(Math.max(16, r.left + (big ? 24 : 0)), vw - w - 16);
    card.style.cssText = `top:${Math.round(top)}px;left:${Math.round(left)}px`;
  }

  function draw() {
    const { h } = ctx;
    const t = ctx.t();
    const step = TOUR_STEPS[index];
    const last = index === TOUR_STEPS.length - 1;
    const next = h('button', { type: 'button', class: 'btn primary', 'data-tour': 'next', onclick: () => go(index + 1) }, t(last ? 'tour.done' : 'tour.next'));
    back = index ? h('button', { type: 'button', class: 'btn', 'data-tour': 'back', onclick: () => go(index - 1) }, t('tour.back')) : null;
    const card = root.querySelector('.tour-card');
    card.replaceChildren(
      h('div', { class: 'tour-top' },
        h('p', { class: 'tour-step' }, t('tour.step', { n: index + 1, total: TOUR_STEPS.length })),
        h('span', { class: 'tour-dots', 'aria-hidden': 'true' }, TOUR_STEPS.map((_, i) => h('span', { class: i === index ? 'is-on' : '' })))),
      h('h2', { id: 'tourTitle' }, t(`tour.${step.id}.title`)),
      h('p', { class: 'tour-text' }, t(`tour.${step.id}.text`)),
      h('div', { class: 'tour-actions' },
        last ? null : h('button', { type: 'button', class: 'meta-link tour-skip', 'data-tour': 'skip', onclick: () => end('skipped') }, t('tour.skip')),
        back, next));
    place();
    next.focus();
  }

  function go(n) {
    if (n >= TOUR_STEPS.length) return end('done');
    index = Math.max(0, n);
    return draw();
  }

  function onKey(e) {
    if (e.key === 'Tab') {
      // Focus stays on the card's buttons while the tour is open.
      const buttons = [...root.querySelectorAll('.tour-card button')];
      const at = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape') { e.preventDefault(); end('skipped'); } else if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft' && index) go(index - 1);
  }

  function end(how) {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    restoreFocus?.focus?.();
    ctx.onEnd(how);
  }

  function start() {
    if (root) return;
    const { h } = ctx;
    restoreFocus = document.activeElement;
    index = 0;
    root = h('div', { class: 'tour', id: 'tourDialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tourTitle', 'aria-label': ctx.t()('tour.label') },
      h('div', { class: 'tour-ring' }), h('div', { class: 'tour-card' }));
    document.body.append(root);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    draw();
  }

  return { start, isOpen: () => Boolean(root), redraw: () => root && draw() };
}
