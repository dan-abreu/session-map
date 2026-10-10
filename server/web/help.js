// Help that sits where the question comes up (mm11): a "?" next to the title of every area with one sentence, and the
// help menu in the top bar with the welcome tour, the "Technical details" switch and a glossary of plain and technical words.
export const HELP_AREAS = ['now', 'convs', 'map', 'waiting', 'live', 'relations', 'chat', 'panel', 'flow', 'board', 'history', 'costs', 'changes', 'discover', 'alerts'];

// Plain words whose technical original sits in TECH: the glossary shows them side by side.
export const GLOSSARY = ['gloss.branch', 'gloss.commit', 'gloss.merge', 'gloss.push', 'gloss.helpers', 'gloss.team', 'gloss.readme', 'gloss.mermaid', 'gloss.cost', 'gloss.git', 'gloss.mcp', 'gloss.hook'];

// ctx: h, t() (translator of the moment), plain() and tech() (translators in each mode), tech flag get/set, onTour().
export function createHelp(ctx) {
  const tip = document.getElementById('helpTip');
  const menu = document.getElementById('helpMenu');
  const btn = document.getElementById('helpBtn');
  const toggle = document.getElementById('techToggle');
  let tipFor = null;
  let closed = { dot: null, at: 0 }; // a click on the same "?" that just light-dismissed its tip closes it for good

  function showTip(dot, area) {
    if (closed.dot === dot && performance.now() - closed.at < 400) return;
    tip.textContent = ctx.t()(`help.${area}`);
    tipFor?.setAttribute('aria-expanded', 'false');
    tipFor = dot;
    dot.setAttribute('aria-expanded', 'true');
    if (!tip.matches(':popover-open')) tip.showPopover();
    const r = dot.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = tip.offsetWidth;
    const below = r.bottom + 8 + tip.offsetHeight < document.documentElement.clientHeight;
    tip.style.left = `${Math.round(Math.min(Math.max(16, r.left + r.width / 2 - w / 2), vw - w - 16))}px`;
    tip.style.top = `${Math.round(below ? r.bottom + 8 : r.top - 8 - tip.offsetHeight)}px`;
  }

  // Puts a "?" right after every element marked data-help that has none yet, so a title refilled by the language switch
  // keeps its own text. Safe to call often.
  function decorate(root = document) {
    for (const el of root.querySelectorAll('[data-help]')) {
      if (el.nextElementSibling?.classList.contains('help-dot')) continue;
      const area = el.dataset.help;
      const dot = ctx.h('button', { type: 'button', class: 'help-dot', 'aria-label': ctx.t()('help.button'), title: ctx.t()('help.button'), 'aria-controls': 'helpTip' }, '?');
      dot.addEventListener('click', (e) => { e.stopPropagation(); showTip(dot, area); });
      el.after(dot);
    }
  }

  function relabel() {
    const t = ctx.t();
    for (const dot of document.querySelectorAll('.help-dot')) { dot.setAttribute('aria-label', t('help.button')); dot.title = t('help.button'); }
    toggle.checked = ctx.getTech();
    const plain = ctx.plain();
    const tech = ctx.tech();
    document.getElementById('helpGlossary').replaceChildren(...GLOSSARY.map((key) => ctx.h('li', {},
      ctx.h('span', { class: 'gl-plain' }, plain(key)), ctx.h('span', { class: 'gl-arrow', 'aria-hidden': 'true' }, '→'), ctx.h('span', { class: 'gl-tech' }, tech(key)))));
  }

  tip.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    tipFor?.setAttribute('aria-expanded', 'false');
    closed = { dot: tipFor, at: performance.now() };
  });
  menu.addEventListener('toggle', (e) => {
    btn.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState !== 'open') return;
    relabel();
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.min(Math.max(16, r.right - menu.offsetWidth), vw - menu.offsetWidth - 16))}px`;
  });
  toggle.addEventListener('change', () => { ctx.setTech(toggle.checked); relabel(); });
  document.getElementById('tourReplay').addEventListener('click', () => { menu.hidePopover(); ctx.onTour(); });
  new MutationObserver(() => decorate()).observe(document.body, { childList: true, subtree: true });
  decorate();

  return { decorate, relabel };
}
