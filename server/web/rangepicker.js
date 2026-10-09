// The period picker of a bank statement (mm06): one button that shows the period ("30 days · 9 Sep – 8 Oct", "3–9 Oct")
// and opens the presets, then for Custom the From and To fields with a two-month calendar (one month on a phone, in a
// bottom sheet). One popover serves every button on the page; the choice is the page's (get / set), the same in the
// map's "What changed", History, Costs and the activity lists. The days and the painting rules are range.js.
import {
  PRESETS, dayState, isoDay, monthGrid, pickDay, resolveRange, shiftMonth, spanWords, validCustom,
} from './range.js';

const dateOf = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoDay(d); };

// ctx: h, icon(name, cls), t (getter), lang (getter), phone (matchMedia), now() → ms, get() → sel, set(sel).
export function createRangePicker(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const buttons = new Set();
  let pop = null;
  let scrim = null;
  let opener = null;
  let draft = { from: null, to: null };
  let customOpen = false;
  let view = { year: 0, month: 0 };
  let hover = null;
  let cal = null;

  // ---- the button --------------------------------------------------------------------------

  function words(sel) {
    const tt = t();
    const range = resolveRange(sel, ctx.now());
    const dates = spanWords(range, ctx.lang(), ctx.now());
    return sel.preset === 'custom' ? { name: dates || tt('range.custom'), dates: '' } : { name: tt(`range.${sel.preset}`), dates: sel.preset === 'all' || sel.preset === 'today' ? '' : dates };
  }

  function paintButton(btn) {
    const sel = ctx.get();
    const { name, dates } = words(sel);
    btn.replaceChildren(ctx.icon('calendar', 'btn-icon'), h('span', { class: 'rp-name' }, name), ...(dates ? [h('span', { class: 'rp-dates' }, dates)] : []));
    btn.setAttribute('aria-label', `${t()('range.label')}: ${[name, dates].filter(Boolean).join(', ')}`);
    btn.classList.toggle('is-on', sel.preset !== 'all');
  }

  function button(extraClass = '') {
    const btn = h('button', { type: 'button', class: `btn rp-btn ${extraClass}`.trim(), 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    btn.addEventListener('click', () => (pop && !pop.hidden && opener === btn ? close() : open(btn)));
    paintButton(btn);
    buttons.add(btn);
    return btn;
  }

  function refresh() {
    for (const b of buttons) {
      if (!b.isConnected) buttons.delete(b);
      else paintButton(b);
    }
  }

  // ---- the popover -------------------------------------------------------------------------

  function build() {
    scrim = h('div', { class: 'rp-scrim', hidden: true, onclick: () => close() });
    pop = h('div', { class: 'rp', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rpTitle', hidden: true });
    document.body.append(scrim, pop);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); } }, true);
    document.addEventListener('pointerdown', (e) => {
      if (pop.hidden || ctx.phone.matches || pop.contains(e.target) || opener?.contains(e.target)) return;
      close(false);
    });
    ctx.phone.addEventListener('change', () => { if (!pop.hidden) place(); });
    window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  }

  function place() {
    if (ctx.phone.matches || !opener) {
      pop.style.top = '';
      pop.style.left = '';
      return;
    }
    const r = opener.getBoundingClientRect();
    const width = pop.offsetWidth;
    pop.style.left = `${Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))}px`;
    pop.style.top = `${r.bottom + 6}px`;
  }

  function open(btn) {
    if (!pop) build();
    opener = btn;
    for (const b of buttons) b.setAttribute('aria-expanded', String(b === btn));
    const sel = ctx.get();
    customOpen = sel.preset === 'custom';
    const range = resolveRange(sel, ctx.now());
    draft = range ? { from: isoDay(range.from), to: isoDay(range.to) } : { from: null, to: null };
    const first = draft.from ?? isoDay(ctx.now());
    view = { year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)) - 1 };
    hover = null;
    render();
    pop.hidden = false;
    scrim.hidden = !ctx.phone.matches;
    place();
    (pop.querySelector('.rp-presets [aria-pressed="true"]') ?? pop.querySelector('.rp-presets button')).focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    scrim.hidden = true;
    for (const b of buttons) b.setAttribute('aria-expanded', 'false');
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }

  function choose(sel) {
    ctx.set(sel);
    refresh();
    close();
  }

  function render() {
    const tt = t();
    const sel = ctx.get();
    const presets = PRESETS.map((p) => h('button', {
      type: 'button', class: 'rp-chip', 'aria-pressed': String(!customOpen && sel.preset === p), onclick: () => choose({ preset: p }),
    }, tt(`range.${p}`)));
    presets.push(h('button', { type: 'button', class: 'rp-chip', 'aria-pressed': String(customOpen), 'aria-expanded': String(customOpen), onclick: () => { customOpen = true; render(); focusFirstDay(); } }, tt('range.custom')));
    const applyBtn = h('button', { type: 'button', class: 'btn primary', onclick: apply }, tt('range.apply'));
    applyBtn.disabled = !draft.from;
    pop.replaceChildren(...[
      h('div', { class: 'rp-head' },
        h('h3', { id: 'rpTitle' }, tt('range.label')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': tt('panel.close'), onclick: () => close() }, ctx.icon('close', ''))),
      h('div', { class: 'rp-presets', role: 'group', 'aria-label': tt('range.presets') }, presets),
      customOpen ? customSection() : null,
      h('div', { class: 'rp-foot' },
        h('button', { type: 'button', class: 'btn', onclick: () => choose({ preset: 'all' }) }, tt('range.clear')),
        h('span', { class: 'grow' }),
        customOpen ? applyBtn : null),
    ].filter(Boolean));
    pop.dataset.custom = String(customOpen);
    place();
  }

  function customSection() {
    const tt = t();
    const from = h('input', { type: 'date', id: 'rpFrom', value: draft.from ?? '' });
    const to = h('input', { type: 'date', id: 'rpTo', value: draft.to ?? '' });
    const onField = () => {
      draft = { from: from.value || null, to: to.value || null };
      if (validCustom(draft.from, draft.to) && draft.from > draft.to) draft = { from: draft.to, to: draft.from };
      if (draft.from && validCustom(draft.from, draft.from)) view = { year: Number(draft.from.slice(0, 4)), month: Number(draft.from.slice(5, 7)) - 1 };
      renderCalendar();
      syncApply();
    };
    from.addEventListener('change', onField);
    to.addEventListener('change', onField);
    cal = h('div', { class: 'rp-cal' });
    queueMicrotask(renderCalendar);
    return h('div', { class: 'rp-custom' },
      h('div', { class: 'rp-fields' },
        h('label', { class: 'field' }, h('span', {}, tt('range.from')), from),
        h('label', { class: 'field' }, h('span', {}, tt('range.to')), to)),
      cal);
  }

  const syncApply = () => {
    const apply = pop.querySelector('.rp-foot .btn.primary');
    if (apply) apply.disabled = !draft.from;
    const f = pop.querySelector('#rpFrom'), e = pop.querySelector('#rpTo');
    if (f && f.value !== (draft.from ?? '')) f.value = draft.from ?? '';
    if (e && e.value !== (draft.to ?? '')) e.value = draft.to ?? '';
  };

  function apply() {
    if (!draft.from) return;
    const to = draft.to ?? draft.from;
    choose({ preset: 'custom', from: draft.from <= to ? draft.from : to, to: draft.from <= to ? to : draft.from });
  }

  // ---- the calendar ------------------------------------------------------------------------

  function monthEl(ym, idx) {
    const lang = ctx.lang();
    const long = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(ym.year, ym.month, 1));
    const title = long[0].toLocaleUpperCase(lang) + long.slice(1);
    const names = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(new Date(2026, 9, 4 + i)));
    const full = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const today = isoDay(ctx.now());
    return h('div', { class: `rp-month m${idx}` },
      h('h4', { class: 'rp-month-name' }, title),
      h('div', { class: 'rp-grid', role: 'grid', 'aria-label': title },
        names.map((n) => h('span', { class: 'rp-dow', 'aria-hidden': 'true' }, n)),
        monthGrid(ym.year, ym.month).flat().map((iso) => (iso === null
          ? h('span', { class: 'rp-pad', 'aria-hidden': 'true' })
          : h('button', {
            type: 'button', class: `rp-day${iso === today ? ' is-today' : ''}`, 'data-iso': iso, tabindex: '-1',
            'aria-label': full.format(dateOf(iso)),
            onclick: () => { draft = pickDay(draft, iso); hover = null; paintDays(); syncApply(); },
            onpointerenter: () => { if (draft.from && !draft.to) { hover = iso; paintDays(); } },
            onkeydown: (e) => keyDay(e, iso),
          }, String(Number(iso.slice(8)))))
      )));
  }

  function renderCalendar() {
    if (!cal?.isConnected) return;
    const tt = t();
    const next = shiftMonth(view, 1);
    const nav = (by, key, icon) => h('button', { type: 'button', class: 'icon-btn rp-nav', 'aria-label': tt(key), onclick: () => { view = shiftMonth(view, by); renderCalendar(); } }, ctx.icon(icon, ''));
    cal.replaceChildren(nav(-1, 'range.prev', 'prev'), monthEl(view, 0), monthEl(next, 1), nav(1, 'range.next', 'next'));
    cal.onpointerleave = () => { if (hover) { hover = null; paintDays(); } };
    paintDays();
  }

  function paintDays() {
    if (!cal) return;
    const anchor = draft.from ?? isoDay(ctx.now());
    for (const el of cal.querySelectorAll('.rp-day')) {
      const state = dayState(el.dataset.iso, draft, hover);
      el.dataset.state = state ?? '';
      el.setAttribute('aria-pressed', String(state === 'start' || state === 'end' || state === 'single'));
      el.tabIndex = el.dataset.iso === anchor || (!cal.querySelector(`[data-iso="${anchor}"]`) && el.dataset.iso.endsWith('-01')) ? 0 : -1;
    }
  }

  function keyDay(e, iso) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const target = addDays(iso, step);
    const [first, second] = [view, shiftMonth(view, 1)];
    const key = target.slice(0, 7);
    const shown = (ym) => `${ym.year}-${String(ym.month + 1).padStart(2, '0')}`;
    if (key < shown(first)) view = shiftMonth(view, -1);
    else if (key > shown(ctx.phone.matches ? first : second)) view = shiftMonth(view, 1);
    renderCalendar();
    cal.querySelector(`[data-iso="${target}"]`)?.focus();
  }

  function focusFirstDay() {
    requestAnimationFrame(() => (pop.querySelector('.rp-day[tabindex="0"]') ?? pop.querySelector('#rpFrom'))?.focus({ preventScroll: true }));
  }

  return { button, refresh, close };
}
