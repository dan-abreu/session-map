// The "Cut off" panel (mm43): the conversations that were working when session-map fell or the computer restarted, with
// Continue on each and Continue all. The server works out the flag (cutOff on a conversation row); this page only lists the rows
// it owns and calls the same start that resumes any page conversation. The pure part on top is what node:test loads.
import { conversationsOf, originIcon, projectHue } from './convlist.js';

export const SHOWN_MAX = 5;
// A Continue's row stays out of the panel until a state says it is no longer cut off, or this long has passed.
export const PENDING_MS = 120_000;

// [{row, project}] for the cut-off rows the projects own (never a visitor's, which belongs to its home project), not archived,
// not in pending, newest first, an id once.
export function cutOffEntries(state, { pending = new Set() } = {}) {
  const seen = new Map();
  for (const project of state?.projects ?? []) {
    for (const row of conversationsOf(project)) {
      if (!row.cutOff || row.archived || pending.has(row.sessionId)) continue;
      const have = seen.get(row.sessionId);
      if (!have || String(row.updatedAt ?? '') > String(have.row.updatedAt ?? '')) seen.set(row.sessionId, { row, project });
    }
  }
  return [...seen.values()].sort((a, b) => String(b.row.updatedAt ?? '').localeCompare(String(a.row.updatedAt ?? '')));
}

// Continues the entries one after the other, never together, and stops at the first "too many conversations" answer: the rest
// wait in the panel. run(entry) → {ok, error}. Returns how many started, how many wait, and the first other error.
export async function continueAll(entries, run) {
  let done = 0;
  let error = null;
  for (let i = 0; i < entries.length; i += 1) {
    const res = await run(entries[i]);
    if (res.ok) done += 1;
    else if (res.error === 'too-many-chats') return { done, left: entries.length - i, limit: true, error };
    else error ??= res.error;
  }
  return { done, left: 0, limit: false, error };
}

// ctx: root (#cutPanel), h, t (translator of the moment), icon(name, cls), relative(iso), phone (media query), now() (ms),
// toast(msg), errorText(code), onContinue(entry) → Promise<{ok, error}>, onDismiss(entry), onOpen(entry).
export function createCutPanel(ctx) {
  const { root, h, icon } = ctx;
  const now = ctx.now ?? Date.now;
  let last = null;
  let drawn = '';
  let folded = false;
  let showAll = false;
  let running = false;
  // id → when it was handed to Continue (or Dismiss): out of the panel at once, though the state may still say cut off.
  const pending = new Map();
  // Every id the panel has shown: a new one opens a folded panel again.
  const known = new Set();

  const entries = () => cutOffEntries(last, { pending: new Set(pending.keys()) });

  // A state arrived: ids whose row is no longer cut off (or gone) are done; the others wait for the 2 minutes.
  function settle() {
    const rows = new Map((last?.projects ?? []).flatMap((p) => conversationsOf(p).map((r) => [r.sessionId, r])));
    for (const [id, at] of pending) {
      if (!rows.get(id)?.cutOff || now() - at > PENDING_MS) pending.delete(id);
    }
  }

  async function continueOne(entry, { quiet = false } = {}) {
    const id = entry.row.sessionId;
    if (pending.has(id)) return { ok: true };
    pending.set(id, now());
    draw();
    const res = await ctx.onContinue(entry);
    // Already running or being picked up (409 busy) is what was asked for.
    const ok = Boolean(res?.ok) || res?.error === 'busy';
    if (!ok) {
      pending.delete(id);
      draw();
      if (!quiet) ctx.toast(ctx.errorText(res?.error));
    } else if (!quiet) ctx.toast(ctx.t('cut.continued', { title: entry.row.title || ctx.t('chat.untitled') }));
    return { ok, error: ok ? undefined : res?.error };
  }

  async function continueEvery() {
    if (running) return;
    running = true;
    draw();
    try {
      const out = await continueAll(entries(), (e) => continueOne(e, { quiet: true }));
      if (out.limit) ctx.toast(ctx.t('cut.limit', { done: out.done, left: out.left }));
      else if (out.error && !out.done) ctx.toast(ctx.errorText(out.error));
      else ctx.toast(ctx.t('cut.continuedAll', { n: out.done }));
    } finally {
      running = false;
      draw();
    }
  }

  async function dismiss(entry) {
    const id = entry.row.sessionId;
    if (pending.has(id)) return;
    pending.set(id, now());
    draw();
    if ((await ctx.onDismiss(entry)) === false) { pending.delete(id); draw(); }
  }

  const act = (name, id) => ({ type: 'button', 'data-act': name, ...(id ? { 'data-session': id } : {}) });

  function rowView(entry) {
    const tt = ctx.t;
    const { row, project } = entry;
    const title = row.title || tt('chat.untitled');
    const origin = tt(`convs.origin.${row.origin}`);
    return h('li', { class: 'cut-item' },
      h('button', { ...act('open', row.sessionId), class: 'cut-title', title: `${title}\n${project.name}`, onclick: () => ctx.onOpen(entry) }, title),
      h('span', { class: 'cut-meta' },
        h('span', { class: 'cut-proj', style: `--p-h:${projectHue(project)}` }, h('span', { class: 'cv-proj-dot', 'aria-hidden': 'true' }), h('span', { class: 'cut-proj-name' }, project.name)),
        h('span', { class: `cv-origin-badge o-${row.origin}`, title: tt('convs.origin.title', { origin }) }, icon(originIcon(row.origin), 'cv-origin'), origin),
        row.updatedAt ? h('span', { class: 'cut-when' }, tt('cut.when', { when: ctx.relative(row.updatedAt) })) : null),
      h('span', { class: 'cut-actions' },
        h('button', { ...act('continue', row.sessionId), class: 'btn small-btn cut-go', disabled: running ? '' : null, onclick: (e) => { if (e.currentTarget) e.currentTarget.disabled = true; return continueOne(entry); } },
          icon('next', 'btn-icon'), tt('cut.continue')),
        h('button', { ...act('dismiss', row.sessionId), class: 'icon-btn cut-x', 'aria-label': `${tt('cut.dismiss')}: ${title}`, title: tt('cut.dismiss'), onclick: () => dismiss(entry) }, icon('close', 'cut-x-icon'))));
  }

  function draw() {
    const list = entries();
    root.hidden = list.length === 0;
    if (!list.length) { drawn = ''; return root.replaceChildren(); }
    if (list.some((e) => !known.has(e.row.sessionId))) folded = false;
    for (const e of list) known.add(e.row.sessionId);
    const tt = ctx.t;
    const shown = showAll ? list : list.slice(0, SHOWN_MAX);
    const sign = JSON.stringify([tt('cut.title'), folded, showAll, running, list.map((e) => [e.row.sessionId, e.row.title, e.row.updatedAt, e.row.origin, e.project.name])]);
    if (sign === drawn) return undefined;
    drawn = sign;
    const focus = root.ownerDocument?.activeElement;
    const keep = focus && root.contains?.(focus) ? { act: focus.dataset?.act, id: focus.dataset?.session } : null;
    root.classList?.toggle('is-folded', folded);
    if (folded) {
      root.replaceChildren(h('button', { ...act('unfold'), class: 'cut-chip', onclick: () => { folded = false; draw(); } },
        icon('stop', 'cut-chip-icon'), h('span', {}, tt('cut.folded', { n: list.length }))));
    } else {
      root.replaceChildren(...[
        h('div', { class: 'cut-head' },
          icon('stop', 'cut-icon'),
          h('h2', { id: 'cutTitle', class: 'cut-name', 'data-help': 'cut' }, tt('cut.title')),
          h('span', { class: 'cut-n num' }, String(list.length)),
          h('button', { ...act('later'), class: 'btn small-btn cut-later', onclick: () => { folded = true; draw(); } }, tt('cut.later'))),
        h('p', { class: 'cut-lede' }, tt('cut.lede')),
        list.length > 1 ? h('button', { ...act('continue-all'), class: 'btn primary cut-all', disabled: running ? '' : null, onclick: continueEvery }, icon('next', 'btn-icon'), tt('cut.continueAll')) : null,
        h('ul', { class: 'cut-rows' }, shown.map(rowView)),
        list.length > shown.length ? h('button', { ...act('more'), class: 'btn small-btn cut-more', onclick: () => { showAll = true; draw(); } }, tt('cut.more', { n: list.length - shown.length })) : null].filter(Boolean));
    }
    if (keep?.act) root.querySelector?.(`[data-act="${keep.act}"]${keep.id ? `[data-session="${CSS.escape(keep.id)}"]` : ''}`)?.focus({ preventScroll: true });
    return undefined;
  }

  return {
    render(state) {
      last = state;
      settle();
      draw();
    },
    // The sentence of the "?" and the buttons are redrawn in the new language.
    relabel: () => { drawn = ''; draw(); },
  };
}
