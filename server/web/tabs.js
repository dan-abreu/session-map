import { api } from './api.js';
import { boardItems } from './tree.js';
import { createTranscript, dayName, timeOf, withDays } from './transcript.js';
import { costRows, estimateTone, budgetTone, aiSpend } from './views.js';
import { costInRange } from './range.js';
import { signalCard } from './blocks.js';
import { costSignal } from './signals.js';
import { emptyState } from './empty.js';
import { requestsOf } from './requests.js';

const HISTORY_DEBOUNCE_MS = 250;

// The list views beside the mind map: Board, History and Costs (desenho-3 § 2, desenho-2 § 16 and § 18).
// ctx: h, t (getter), lang (getter), fmt {money, shortDate, relative}, state/project getters, go(projectId, sel),
// toast, errorText, confirm(text, label) → Promise<boolean>, prefs {archived, setArchived}, icon(name, cls)?.
export function createTabs(ctx) {
  const { h, fmt } = ctx;
  const t = () => ctx.t();
  const pick = { board: null, historyProject: '', historyQuery: '', reading: null };
  let historyTimer = 0;
  let historyRun = 0;

  const partName = (p, id) => p.arch.parts.find((x) => x.id === id)?.name ?? '';
  const empty = (art, title, text, compact = false) => emptyState({ h, icon: ctx.icon }, { art, title, text, compact });

  // origin: the owner's request the item came from, when the registry names it.
  function itemCard(p, { nodeId, part, group, item }, origin = null) {
    const tt = t();
    return h('li', { class: 'card' }, h('button', { type: 'button', class: 'card-btn', onclick: () => ctx.go(p.id, { type: 'node', id: nodeId }) },
      h('span', { class: 'card-kind' }, [part.name, group].filter(Boolean).join(' · ')),
      h('span', { class: 'card-title' }, item.title),
      origin ? h('span', { class: 'card-origin' }, tt('board.fromRequest', { title: origin.title })) : null,
      h('span', { class: 'card-meta' },
        item.who ? h('span', { class: `who${item.who.toLowerCase() === 'claude' ? '' : ' is-person'}` }, item.who) : null,
        item.weight ? h('span', { class: `weight w-${item.weight}` }, tt(`item.weight.${item.weight}`)) : null,
        item.milestone ? h('span', {}, tt('item.milestone', { n: item.milestone })) : null,
        item.code ? h('code', { class: 'code-chip' }, item.code) : null)));
  }

  function renderBoard(root) {
    const tt = t();
    const state = ctx.state();
    const chosen = pick.board ?? ctx.project().id;
    const projects = chosen === '*' ? state.projects : state.projects.filter((p) => p.id === chosen);
    const filter = h('label', { class: 'dv-field' }, h('span', {}, tt('board.filter')),
      h('select', { name: 'board-project', onchange: (e) => { pick.board = e.target.value; renderBoard(root); } },
        h('option', { value: '*' }, tt('board.all')),
        state.projects.map((p) => h('option', { value: p.id, selected: p.id === chosen }, p.name))));
    const columns = { todo: [], doing: [], done: [] };
    for (const p of projects) {
      const cols = boardItems(p);
      const origin = new Map();
      for (const r of requestsOf(p, { lang: ctx.lang() }).list) for (const w of r.went) if (!origin.has(w.code)) origin.set(w.code, r);
      for (const k of Object.keys(columns)) columns[k].push(...cols[k].map((entry) => ({ p, entry, origin: origin.get(entry.item.code) ?? null })));
    }
    const noMap = projects.filter((p) => !p.arch.parts.length);
    const column = (k) => h('section', { class: `col col-${k}`, 'aria-labelledby': `col-${k}` },
      h('h3', { id: `col-${k}` }, tt(`board.${k}`), h('span', { class: 'col-count num' }, String(columns[k].length))),
      columns[k].length
        ? h('ul', { class: 'cards' }, columns[k].map(({ p, entry, origin }) => itemCard(p, entry, origin)))
        : empty({ todo: 'check', doing: 'clock', done: 'check' }[k], tt(`board.${k}.empty`), null, true));
    root.replaceChildren(h('div', { class: 'view-wrap wide' },
      h('div', { class: 'view-head' }, h('h2', { 'data-help': 'board' }, tt('board.title')), filter),
      h('p', { class: 'view-lede' }, tt('board.lede')),
      noMap.length ? h('p', { class: 'view-note' }, tt('board.noMap', { names: noMap.map((p) => p.name).join(', ') })) : null,
      h('div', { class: 'board' }, ['todo', 'doing', 'done'].map(column))));
  }

  function estimateBar(cost, estimate, tone) {
    const pct = Math.round((cost / estimate) * 100);
    return h('span', { class: `est est-${tone}`, role: 'img', 'aria-label': t()('costs.estimateAria', { cost: fmt.money(cost), estimate: fmt.money(estimate), pct }) },
      h('span', { class: 'est-track' }, h('span', { class: 'est-fill', style: `width:${Math.min(100, (cost / estimate) * 100 / 1.5).toFixed(1)}%` }), h('span', { class: 'est-mark', style: `left:${(100 / 1.5).toFixed(1)}%` })),
      h('span', { class: 'est-text num' }, t()('wc.estimate', { cost: fmt.money(cost), estimate: fmt.money(estimate) })));
  }

  // ----- history -----

  const projectOfEntry = (e) => String(e.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || e.projectDir;

  async function loadHistory(root) {
    const run = ++historyRun;
    const list = root.querySelector('#historyList');
    const status = root.querySelector('#historyStatus');
    status.textContent = t()('history.loading');
    const range = ctx.range();
    const res = await api.history(pick.historyQuery, pick.historyProject, range);
    if (run !== historyRun) return;
    if (!res.ok) {
      status.textContent = ctx.errorText(res.error);
      return;
    }
    const tt = t();
    status.textContent = res.results.length ? tt.count('history.count', res.results.length) : '';
    list.replaceChildren(...(res.results.length ? res.results.map((e) => h('li', {},
      h('button', { type: 'button', 'data-id': e.sessionId, class: `hist-row${pick.reading === e.sessionId ? ' is-current' : ''}`, 'aria-current': pick.reading === e.sessionId ? 'true' : null, onclick: () => read(root, e) },
        h('span', { class: 'hr-title' }, e.title || tt('history.untitled')),
        h('span', { class: 'hr-meta num' }, [fmt.shortDate(Date.parse(e.startedAt || e.endedAt)), projectOfEntry(e), fmt.money(e.costUSD || 0)].join(' · ')),
        e.userPrompts?.[0] ? h('span', { class: 'hr-line' }, e.userPrompts[0]) : null)))
      : [h('li', { class: 'view-empty' }, pick.historyQuery ? empty('search', tt('history.noMatch'), tt('history.noMatchText')) : empty('clock', tt('history.emptyTitle'), tt('history.empty')))]));
  }

  // An archived conversation reads like the chat screen (mm22): every step, question, image and helper, with its times.
  function transcriptOf(sessionId) {
    const seg = encodeURIComponent(sessionId);
    const tv = createTranscript({
      h, t, money: fmt.money, icon: ctx.icon ?? null,
      time: (ts) => timeOf(ctx.lang(), ts),
      day: (key) => dayName(t(), ctx.lang(), key),
      imageUrl: (n) => `/api/conversation/${seg}/image/${n}`,
      onCopy: (text) => {
        const done = globalThis.navigator?.clipboard?.writeText?.(text);
        if (!done) return ctx.toast(t()('chat.copyFailed'));
        return done.then(() => ctx.toast(t()('chat.copied')), () => ctx.toast(t()('chat.copyFailed')));
      },
      onHelper: async (agent, box) => {
        box.replaceChildren(h('p', { class: 'helper-note' }, t()('chat.helperLoading')));
        const res = await api.chatHelper(sessionId, agent.id);
        if (!res.ok) return box.replaceChildren(h('p', { class: 'helper-note' }, t()('chat.helperMissing')));
        return box.replaceChildren(h('ol', { class: 'helper-items' }, (res.items ?? []).map((i) => tv.node(i))));
      },
    });
    return tv;
  }

  async function read(root, entry) {
    pick.reading = entry.sessionId;
    const pane = root.querySelector('#historyRead');
    const tt = t();
    for (const b of root.querySelectorAll('.hist-row')) {
      const current = b.dataset.id === entry.sessionId;
      b.classList.toggle('is-current', current);
      b.toggleAttribute('aria-current', current);
    }
    pane.hidden = false;
    pane.replaceChildren(h('p', { class: 'view-note' }, tt('history.opening')));
    const res = await api.conversation(entry.sessionId);
    if (pick.reading !== entry.sessionId) return;
    if (!res.ok) {
      pane.replaceChildren(h('p', { class: 'view-note' }, ctx.errorText(res.error)));
      return;
    }
    const del = h('button', { type: 'button', class: 'btn danger' }, tt('history.delete'));
    del.addEventListener('click', async () => {
      if (!(await ctx.confirm(tt('history.deleteConfirm', { title: res.title || tt('history.untitled') }), tt('history.delete')))) return;
      const out = await api.deleteConversation(entry.sessionId);
      if (!out.ok) return ctx.toast(ctx.errorText(out.error));
      ctx.toast(tt('history.deleted'));
      pick.reading = null;
      pane.hidden = true;
      loadHistory(root);
    });
    const back = h('button', { type: 'button', class: 'btn read-back', onclick: () => { pane.hidden = true; pick.reading = null; } }, tt('history.back'));
    pane.replaceChildren(
      h('div', { class: 'read-head' }, h('h3', { tabindex: '-1' }, res.title || tt('history.untitled')),
        h('p', { class: 'meta' }, [fmt.shortDate(Date.parse(entry.startedAt || entry.endedAt)), projectOfEntry(entry), fmt.money(entry.costUSD || 0)].join(' · ')),
        h('div', { class: 'actions' }, back, del)),
      h('ol', { class: 'transcript' }, withDays(res.items ?? []).map(transcriptOf(entry.sessionId).node)));
    pane.querySelector('h3').focus();
  }

  function renderHistory(root) {
    const tt = t();
    const state = ctx.state();
    if (root.dataset.built !== ctx.lang()) {
      root.dataset.built = ctx.lang();
      const search = h('input', { type: 'search', id: 'historySearch', autocomplete: 'off', value: pick.historyQuery, placeholder: tt('history.search') });
      search.addEventListener('input', () => {
        clearTimeout(historyTimer);
        historyTimer = setTimeout(() => { pick.historyQuery = search.value.trim(); loadHistory(root); }, HISTORY_DEBOUNCE_MS);
      });
      const project = h('select', { id: 'historyProject', onchange: (e) => { pick.historyProject = e.target.value; loadHistory(root); } },
        h('option', { value: '' }, tt('board.all')),
        state.projects.map((p) => h('option', { value: p.name, selected: p.name === pick.historyProject }, p.name)));
      root.replaceChildren(h('div', { class: 'view-wrap wide' },
        h('div', { class: 'view-head' }, h('h2', { 'data-help': 'history' }, tt('history.title'))),
        h('p', { class: 'view-lede' }, tt('history.lede')),
        h('div', { class: 'dv-tools' },
          h('label', { class: 'dv-field grow' }, h('span', { class: 'visually-hidden' }, tt('history.search')), search),
          h('label', { class: 'dv-field' }, h('span', {}, tt('history.project')), project),
          h('div', { class: 'dv-field' }, h('span', {}, tt('range.label')), ctx.rangeButton())),
        h('p', { class: 'dv-status', id: 'historyStatus', role: 'status' }),
        h('div', { class: 'history' },
          h('ul', { class: 'hist-list', id: 'historyList' }),
          h('section', { class: 'hist-read', id: 'historyRead', 'aria-live': 'polite', hidden: true }))));
    }
    loadHistory(root);
  }

  // ----- costs -----

  function renderCosts(root) {
    const tt = t();
    const state = ctx.state();
    const range = ctx.range();
    const rows = costRows(state, range);
    const spent = (p) => costInRange(p.costByDay, range);
    const total = state.projects.reduce((sum, p) => sum + spent(p), 0);
    const ai = aiSpend(state);
    const maxProject = Math.max(1e-9, ...state.projects.map(spent));
    const ledger = h('dl', { class: 'ledger' },
      h('div', {}, h('dt', {}, tt(range ? 'costs.total.range' : 'costs.total.all')), h('dd', { class: 'num strong' }, fmt.money(total))),
      state.budget ? budgetRow(state.budget) : null,
      h('div', {}, h('dt', {}, tt('costs.ai')), h('dd', {}, h('span', { class: 'num' }, fmt.money(ai.todayUSD),
        h('span', { class: 'muted' }, ` · ${ai.projects.length ? tt('costs.aiModel', { model: ai.projects[0].model }) : tt('costs.aiOff')}`)))));
    const aiList = ai.projects.length ? h('ul', { class: 'plain rows bars' }, ai.projects.map((x) => h('li', { class: 'bar-row' },
      h('span', { class: 'br-name' }, x.project.name),
      h('span', { class: 'br-value num' }, fmt.money(x.spentUSDToday || 0)),
      h('span', { class: 'br-sub' }, x.queue ? tt.count('costs.aiQueue', x.queue) : tt('costs.aiIdle'))))) : null;
    const estimates = state.projects.flatMap((p) => p.workCells.filter((w) => w.estimateUSD).map((w) => ({ p, w })));
    root.replaceChildren(h('div', { class: 'view-wrap' },
      h('div', { class: 'view-head' }, h('h2', { 'data-help': 'costs' }, tt('costs.title')), ctx.rangeButton()),
      h('p', { class: 'view-lede' }, tt('costs.honest')),
      budgetSign(root),
      ledger,
      h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.byProject')),
        h('ul', { class: 'plain rows bars' }, state.projects.map((p) => h('li', { class: 'bar-row' },
          h('span', { class: 'br-name' }, p.name),
          h('span', { class: 'br-value num' }, fmt.money(spent(p))),
          h('span', { class: 'br-track', 'aria-hidden': 'true' }, h('span', { style: `width:${((spent(p) / maxProject) * 100).toFixed(1)}%` })))))),
      h('section', { class: 'tree-block', id: 'aiCosts' }, h('h3', {}, tt('costs.aiTitle')), h('p', { class: 'view-note' }, tt('costs.aiLede')), aiList),
      estimates.length ? h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.estimates')),
        h('ul', { class: 'plain rows' }, estimates.map(({ p, w }) => h('li', {},
          h('button', { type: 'button', class: 'est-row', onclick: () => ctx.go(p.id, { type: 'workcell', id: w.id }) },
            h('span', { class: 'branch-name' }, w.branch), estimateBar(w.costUSD, w.estimateUSD, estimateTone(w.costUSD, w.estimateUSD))))))) : null,
      h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.chats')), h('p', { class: 'view-note' }, tt('costs.chatsNote')),
        rows.length ? h('ol', { class: 'plain rows costs-list' }, rows.slice(0, 50).map(({ project, chat }) => h('li', {},
          h('button', { type: 'button', class: 'link-row', onclick: () => ctx.go(project.id, { type: 'chat', id: chat.sessionId }) },
            h('span', { class: 'lr-title' }, chat.title),
            h('span', { class: 'lr-date num strong' }, fmt.money(chat.costUSD)),
            h('span', { class: 'lr-line' }, [project.name, partName(project, chat.partId), fmt.relative(chat.updatedAt)].filter(Boolean).join(' · '))))))
          : empty('chat', tt('costs.none'), tt('costs.noneText')))));
  }

  // The helpers' monthly budget nearly used is a sign: why, what to do, and the button that takes you to what they spent.
  function budgetSign(root) {
    const budget = ctx.state().budget;
    const sig = budget && costSignal({ usedUSD: budget.used, monthlyUSD: budget.monthlyUSD }, { money: fmt.money, kind: 'budget' });
    return sig ? signalCard({ h, icon: ctx.icon, t: t() }, sig, { 'see-costs': () => root.querySelector('#aiCosts')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }) : null;
  }

  function budgetRow(budget) {
    const tt = t();
    const tone = budgetTone(budget.used, budget.monthlyUSD);
    const pct = Math.round((budget.used / budget.monthlyUSD) * 100);
    return h('div', { class: `budget tone-${tone}` },
      h('dt', {}, tt('costs.budget')),
      h('dd', {},
        h('span', { class: 'num' }, tt('costs.budgetUsed', { used: fmt.money(budget.used), limit: fmt.money(budget.monthlyUSD), pct })),
        h('span', { class: 'br-track', role: 'img', 'aria-label': tt('costs.budgetUsed', { used: fmt.money(budget.used), limit: fmt.money(budget.monthlyUSD), pct }) },
          h('span', { style: `width:${Math.min(100, pct)}%` }))));
  }

  const renderers = { board: renderBoard, history: renderHistory, costs: renderCosts };
  return {
    render(name, root) { renderers[name]?.(root); },
    // Polling refreshes the open view, except History, which keeps the person's place.
    refresh(name, root) { if (name !== 'history' && !root.contains(document.activeElement)) renderers[name]?.(root); },
  };
}
