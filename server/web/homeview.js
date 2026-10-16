import { emptyState } from './empty.js';
import { homeRows, homeTotals } from './home.js';
import { budgetTone } from './views.js';

// The Home screen (fd10): a list that reads at a glance, one row per project with its seven values, and under a row at most
// two heads-up lines, each with the button that goes to the place that solves it. The whole row opens the project's map
// through ONE button (the name, stretched over the row in CSS), so no button ever sits inside another.
// The numbers come from home.js (pure); this file only draws them. Drawing never reads the page: it works on the root it
// is given, so it runs on a tiny element tree in the tests.
//
// ctx: h, t (translator function), icon(name, cls), fmt {money(usd), relative(iso)}, state (object or getter),
// openProject(id), goTo(area, sub), refreshFoundation(id) (optional; may return a promise), demo (bool or getter, optional),
// now() and ignored() (optional getters).
// The limit card (mm46) needs limit { read(), save(usd) } (the routes of the monthly limit for big work), and may take
// currency() ({ label, rate }), toast(text) and errorText(code); without limit, or in the demo, there is no card.

const COLUMNS = ['project', 'health', 'uptodate', 'working', 'waiting', 'cost', 'last'];
const COLUMN_ICON = { health: 'check', uptodate: 'file', working: 'auto', waiting: 'bell', cost: 'coin', last: 'clock' };
// The bell means "waiting for you" everywhere, so a low score gets the cross.
const TONE_ICON = { good: 'check', ok: 'clock', low: 'close' };
const SKELETON_ROWS = 3;
const LIMIT_REFRESH_MS = 15000;
const roundTo = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

const value = (x) => (typeof x === 'function' ? x() : x);

export function createHomeView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const reading = new Set();
  const cache = new Map(); // project id -> { sig, el }
  let frame = null; // what the last render built, for the root it was built in

  const canRead = () => !value(ctx.demo) && typeof ctx.refreshFoundation === 'function';
  const icon = (name, cls = 'hm-icon') => (ctx.icon ? ctx.icon(name, cls) : null);

  async function readNow(id) {
    if (reading.has(id)) return;
    reading.add(id);
    redraw();
    try {
      await ctx.refreshFoundation(id);
    } finally {
      reading.delete(id);
      redraw();
    }
  }

  const label = (key) => h('span', { class: 'visually-hidden' }, `${t(key)}: `);
  const cell = (column, extra, ...children) => h('div', { class: `hm-cell hm-${column}${extra ? ` ${extra}` : ''}` }, ...children);

  function healthCell(row) {
    if (!row.read) return null;
    if (!row.health) return cell('health', 'is-none', label('home.col.health'), h('span', { class: 'hm-val' }, t('home.unmeasured')));
    const words = t('home.health.value', { score: row.health.score, tone: t(`home.tone.${row.health.tone}`) });
    return cell('health', `is-${row.health.tone}`, label('home.col.health'), h('span', { class: 'hm-val num', title: words }, icon(TONE_ICON[row.health.tone]), words));
  }

  function uptodateCell(row) {
    if (!row.read) return null;
    const u = row.uptodate;
    const parts = u ? [
      u.warning > 0 ? t('home.uptodate.warning', { n: u.warning }) : null,
      u.confirmed > 0 ? t('home.uptodate.confirmed', { n: u.confirmed }) : null,
      u.unverified > 0 ? t('home.uptodate.unverified', { n: u.unverified }) : null,
    ].filter(Boolean) : [];
    if (!parts.length) return cell('uptodate', 'is-none', label('home.col.uptodate'), h('span', { class: 'hm-val' }, t('home.unmeasured')));
    const words = parts.join(' · ');
    return cell('uptodate', u.warning > 0 ? 'is-warn' : '', label('home.col.uptodate'),
      h('span', { class: 'hm-val num', title: words }, icon('file'), words));
  }

  // A project not read yet has no numbers to show: one cell says so (never a zero) and offers the reading.
  function unreadCell(row) {
    const busy = reading.has(row.id);
    return cell('unread', '', h('span', { class: 'hm-val' }, icon('clock'), t('home.unread')),
      h('span', { class: 'hm-why' }, t('home.unread.why')),
      canRead() ? h('button', { type: 'button', class: 'btn small-btn hm-readnow', 'data-hm': 'read', disabled: busy, 'aria-busy': busy ? 'true' : null, onclick: () => readNow(row.id) },
        busy ? t('home.reading') : t('home.readnow')) : null);
  }

  function projectCell(row) {
    const v = row.version?.code ? row.version : null;
    return cell('project', '',
      h('button', { type: 'button', class: 'hm-open', 'data-hm': 'open', title: t('home.open.title', { name: row.name }), onclick: () => ctx.openProject(row.id) }, row.name),
      v ? h('span', { class: `hm-version num${v.mismatch ? ' is-warn' : ''}` }, t('home.version', { code: v.code }),
        v.mismatch ? h('span', { class: 'hm-differs' }, ' · ', t('home.version.differs')) : null) : null);
  }

  const countCell = (column, n, key, tone) => cell(column, n > 0 ? `is-${tone}` : 'is-zero', label(`home.col.${column}`),
    h('span', { class: 'hm-val num' }, icon(COLUMN_ICON[column]), n > 0 ? t(key, { n }) : t('home.nothing')));
  const count = (key, n) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n });

  // What needs the person, under the column of the inbox's own name: the conversations, as many as the amber pill counts for
  // the project (one fact, one number, mm47), then the decisions waiting on its map, quiet, on their own line.
  function needsCell(row) {
    const sub = row.decisions > 0 ? h('span', { class: 'hm-sub num' }, count('home.mapDecisions', row.decisions)) : null;
    if (row.needs > 0) return cell('waiting', 'is-waiting', label('home.col.waiting'), h('span', { class: 'hm-val num' }, icon(COLUMN_ICON.waiting), count('home.needsChats', row.needs)), sub);
    return cell('waiting', 'is-zero', label('home.col.waiting'), sub
      ? h('span', { class: 'hm-val num' }, icon(COLUMN_ICON.waiting), count('home.mapDecisions', row.decisions))
      : h('span', { class: 'hm-val' }, icon(COLUMN_ICON.waiting), t('home.nothing')));
  }

  function costCell(row) {
    const money = ctx.fmt.money(row.monthCost.usd);
    return cell('cost', '', label('home.col.cost'), h('span', { class: 'hm-val num', title: t('home.col.cost') }, icon(COLUMN_ICON.cost), money));
  }

  function lastCell(row) {
    return cell('last', row.lastActivity ? '' : 'is-none', label('home.col.last'),
      h('span', { class: 'hm-val' }, icon(COLUMN_ICON.last), row.lastActivity ? ctx.fmt.relative(row.lastActivity) : t('home.last.none')));
  }

  function attentionEl(row) {
    // "Not read yet" is already said by its own cell, with the button; the strip keeps the other heads-ups.
    const items = row.attention.filter((a) => a.kind !== 'unread');
    if (!items.length) return null;
    return h('ul', { class: 'hm-attn', 'aria-label': t('home.attn.aria', { name: row.name }) }, items.map((a) => h('li', { class: 'hm-attn-item' },
      icon('bell', 'hm-icon hm-attn-icon'),
      h('span', { class: 'hm-attn-text' }, t(`home.attn.${a.kind}`, a.params)),
      h('button', { type: 'button', class: 'btn small-btn hm-go', 'data-hm': `go-${a.kind}`, onclick: () => ctx.goTo(a.goes.area, a.goes.sub) }, t(`home.attn.${a.kind}.go`)))));
  }

  function rowEl(row) {
    const unread = !row.read;
    const cls = `hm-item${unread ? ' is-unread' : ''}${row.needs > 0 ? ' has-waiting' : ''}`;
    return h('li', { class: cls, 'data-id': row.id },
      h('div', { class: 'hm-row' },
        projectCell(row),
        unread ? unreadCell(row) : [healthCell(row), uptodateCell(row)],
        countCell('working', row.working, 'home.working.n', 'working'),
        needsCell(row),
        costCell(row),
        lastCell(row)),
      attentionEl(row));
  }

  // What would change what the row looks like: its numbers, the words already formatted, the language and the reading state.
  const signature = (row) => JSON.stringify([row, ctx.fmt.money(row.monthCost.usd), row.lastActivity ? ctx.fmt.relative(row.lastActivity) : null,
    t('home.unread'), canRead(), reading.has(row.id)]);

  function totalsEl(rows) {
    const totals = homeTotals(rows);
    const one = (key, shown, art, cls = '') => h('p', { class: `hm-total ${cls}`.trim() }, icon(art), h('span', { class: 'hm-total-label' }, t(key)), h('strong', { class: 'hm-total-value num' }, shown));
    return [
      one('home.total.projects', String(totals.projects), 'box'),
      one('home.total.working', String(totals.working), 'auto', totals.working > 0 ? 'is-working' : ''),
      one('home.total.waiting', String(totals.needs), 'bell', totals.needs > 0 ? 'is-waiting' : ''),
      one('home.total.month', ctx.fmt.money(totals.monthUsd), 'coin'),
      totals.unread > 0 ? one('home.total.unread', String(totals.unread), 'clock') : null,
    ];
  }

  // ----- the monthly limit for big (reinforced) work (mm46): the same value Configurações sets -----

  const canLimit = () => !value(ctx.demo) && Boolean(ctx.limit);
  const currency = () => ({ label: 'US$', rate: 1, ...value(ctx.currency) });
  const shown = (usd) => roundTo(usd * currency().rate, 2); // what the field says: the owner's currency
  const tell = (msg) => ctx.toast?.(msg);
  let limitData = null; // what the route answered ({ ok, limitUSD, spentUSD }), kept so a new frame draws at once
  let limitAt = 0;
  let saving = false;

  async function loadLimit() {
    limitAt = Date.now();
    let res = null;
    try { res = await ctx.limit.read(); } catch { /* shown as "could not read" below */ }
    // A failed re-read keeps the numbers already there; only the very first failure says so.
    if (res?.ok || !limitData?.ok) limitData = res?.ok ? res : { ok: false };
    drawLimit();
  }

  async function saveLimit() {
    const part = frame?.limit;
    if (!part?.field || saving) return;
    const raw = String(part.field.value ?? '').trim().replace(',', '.');
    const typed = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(typed)) return tell(ctx.errorText?.('bad-limit'));
    saving = true;
    try {
      const res = await ctx.limit.save(roundTo(typed / currency().rate, 6));
      if (!res?.ok) return tell(ctx.errorText?.(res?.error));
      limitData = { ...limitData, ok: true, limitUSD: res.limitUSD };
      part.field.value = String(shown(res.limitUSD));
      drawLimit();
      tell(t('home.limit.saved', { limit: ctx.fmt.money(res.limitUSD) }));
    } finally {
      saving = false;
    }
  }

  function buildLimit() {
    if (!canLimit()) return null;
    const part = { field: null, form: h('div', { class: 'hm-limit-form' }), status: h('div', { class: 'hm-limit-slot', 'aria-live': 'polite' }) };
    part.card = h('section', { class: 'hm-limit', 'aria-labelledby': 'hm-limit-title' },
      h('h3', { class: 'hm-limit-title', id: 'hm-limit-title' }, t('home.limit.title')),
      h('p', { class: 'hm-limit-why' }, t('home.limit.why')),
      part.form, part.status);
    return part;
  }

  // The field and Save are built once: a redraw with new numbers never takes away the number the person is typing.
  function limitForm(part) {
    const limit = limitData.limitUSD;
    part.field = h('input', {
      id: 'hm-limit-field', type: 'number', min: '0', step: 'any', inputmode: 'decimal', class: 'num', 'data-hm': 'limit',
      value: limit === null || limit === undefined ? '' : String(shown(limit)),
      onkeydown: (e) => { if (e.key === 'Enter') saveLimit(); },
    });
    part.form.replaceChildren(
      h('label', { for: 'hm-limit-field' }, t('home.limit.label', { currency: currency().label })),
      h('div', { class: 'hm-limit-row' }, part.field,
        h('button', { type: 'button', class: 'btn small-btn', 'data-hm': 'limit-save', onclick: saveLimit }, t('home.limit.save'))));
  }

  function limitStatus() {
    const limit = limitData.limitUSD ?? null;
    const spent = limitData.spentUSD ?? 0;
    if (limit === null) {
      return h('div', { class: 'hm-limit-status' },
        spent > 0 ? h('p', { class: 'hm-limit-used num' }, t('home.limit.usedOnly', { used: ctx.fmt.money(spent) })) : null,
        h('p', { class: 'hm-limit-note' }, icon('bell', 'hm-icon'), t('home.limit.none')));
    }
    const words = t('home.limit.used', { used: ctx.fmt.money(spent), limit: ctx.fmt.money(limit) });
    const pct = limit > 0 ? Math.min(100, Math.round((100 * spent) / limit)) : (spent > 0 ? 100 : 0);
    const tone = limit > 0 ? budgetTone(spent, limit) : (spent > 0 ? 'over' : 'ok');
    return h('div', { class: `hm-limit-status tone-${tone}` },
      h('p', { class: 'hm-limit-used num' }, words),
      h('span', { class: 'br-track', role: 'img', 'aria-label': words }, h('span', { style: `width:${pct}%` })));
  }

  function drawLimit() {
    const part = frame?.limit;
    if (!part || !limitData) return; // still reading: the card shows its question and nothing else
    if (!limitData.ok) {
      part.field = null;
      part.form.replaceChildren();
      part.status.replaceChildren(h('p', { class: 'hm-limit-note' }, t('home.limit.error')));
      return;
    }
    if (!part.field) limitForm(part);
    part.status.replaceChildren(limitStatus());
  }

  const skeleton = () => h('div', { class: 'skeleton hm-skeleton', role: 'status', 'aria-busy': 'true', 'aria-label': t('home.loading') },
    Array.from({ length: SKELETON_ROWS }, () => h('span', { class: 'sk-bar is-wide' })));

  function build(root) {
    const list = h('ul', { class: 'hm-list' });
    frame = {
      root, list, mode: null, empty: null,
      totals: h('div', { class: 'hm-totals', role: 'group', 'aria-label': t('home.totals.aria') }),
      head: h('div', { class: 'hm-head', 'aria-hidden': 'true' }, COLUMNS.map((c) => h('span', { class: `hm-col hm-col-${c}` }, t(`home.col.${c}`)))),
      body: h('div', { class: 'hm-body', 'aria-live': 'polite' }),
      title: h('h2', { 'data-help': 'home' }, t('home.title')),
      lede: h('p', { class: 'view-lede' }, t('home.lede')),
      limit: buildLimit(),
    };
    root.replaceChildren(h('div', { class: 'view-wrap wide hm-view' },
      h('div', { class: 'view-head' }, frame.title), frame.lede, frame.limit?.card, frame.totals, frame.head, frame.body));
  }

  // Keeps the rows whose signature did not change (same element, so focus and selection survive), builds the others,
  // and touches the list only when its order or its members changed.
  function draw() {
    const state = value(ctx.state);
    const f = frame;
    if (!state?.projects) {
      f.mode = 'loading';
      f.totals.replaceChildren();
      f.body.replaceChildren(skeleton());
      return;
    }
    const rows = homeRows(state, { nowMs: value(ctx.now) ?? Date.now(), ignored: value(ctx.ignored) ?? new Set() });
    f.totals.replaceChildren(...totalsEl(rows).filter(Boolean));
    if (!rows.length) {
      f.mode = 'empty';
      f.body.replaceChildren(emptyState({ h, icon: ctx.icon }, { art: 'home', title: t('home.empty.title'), text: t('home.empty.text') }));
      return;
    }
    const doc = f.root.ownerDocument;
    const active = doc?.activeElement;
    const focus = f.root.contains?.(active) ? { id: active.closest?.('[data-id]')?.getAttribute('data-id'), hm: active.getAttribute?.('data-hm') } : null;
    const next = rows.map((row) => {
      const sig = signature(row);
      const hit = cache.get(row.id);
      if (hit && hit.sig === sig) return hit.el;
      const el = rowEl(row);
      cache.set(row.id, { sig, el });
      return el;
    });
    for (const id of [...cache.keys()]) if (!rows.some((r) => r.id === id)) cache.delete(id);
    const same = f.mode === 'list' && [...f.list.children].length === next.length && [...f.list.children].every((el, i) => el === next[i]);
    if (!same) f.list.replaceChildren(...next);
    if (f.mode !== 'list') f.body.replaceChildren(f.list);
    f.mode = 'list';
    if (focus?.id && doc && !f.root.contains(doc.activeElement)) {
      next.find((el) => el.getAttribute?.('data-id') === focus.id)?.querySelector?.(`[data-hm="${focus.hm}"]`)?.focus?.();
    }
  }

  function redraw() {
    if (frame) draw();
  }

  return {
    render(root) {
      build(root);
      draw();
      if (frame.limit) {
        drawLimit();
        loadLimit();
      }
    },
    // Called on every state update: redraws only what changed, and builds the frame if the root is a new one.
    refresh(root) {
      if (!frame || frame.root !== root) this.render(root);
      else draw();
      if (frame.limit && Date.now() - limitAt > LIMIT_REFRESH_MS) loadLimit();
    },
    // Reads the limit and what was used again (the card keeps the number being typed).
    refreshLimit() {
      return frame?.limit ? loadLimit() : Promise.resolve();
    },
    // The language changed: the frame has words in it, so it is built again (the rows follow by their signature).
    relabel() {
      if (frame) this.render(frame.root);
    },
  };
}
