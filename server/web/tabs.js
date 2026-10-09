import { api } from './api.js';
import { ownerHue, initial } from './body.js';
import { mapTree, boardColumns, costRows, estimateTone, budgetTone, aiSpend } from './views.js';

const RANGES = ['today', 'd7', 'd30'];
const HISTORY_DEBOUNCE_MS = 250;
const TOOL_LINE = /^\[[A-Za-z][\w:-]*(?: .*)?\]$/;

// The list views beside the brain: Map, Board, History and Costs (desenho § 10, desenho-2 § 16 and § 18).
// ctx: h, t (getter), lang (getter), fmt {money, shortDate, relative}, state/project getters, go(projectId, sel),
// toast, errorText, confirm(text, label) → Promise<boolean>, prefs {archived, setArchived}.
export function createTabs(ctx) {
  const { h, fmt } = ctx;
  const t = () => ctx.t();
  const pick = { board: null, costs: 'd30', historyProject: '', historyQuery: '', reading: null };
  let historyTimer = 0;
  let historyRun = 0;

  const dotFor = (chat) => {
    const waiting = chat.waiting.strong || chat.waiting.items.length;
    const kind = waiting ? 'waiting' : chat.status;
    return h('span', { class: `dot-mini kind-${kind}${chat.waiting.weak ? ' weak' : ''}`, 'aria-hidden': 'true' });
  };
  const chatStatusText = (chat) => {
    if (chat.waiting.strong || chat.waiting.items.length) return t()('status.waiting');
    return chat.waiting.weak ? t()('waiting.ends') : t()(`chat.${chat.status}`);
  };
  const ownerChip = (person) => h('span', { class: 'owner', style: `--owner-h:${ownerHue(person.email)}` },
    h('span', { class: 'owner-dot', 'aria-hidden': 'true' }, initial(person.name)), person.name);
  const unitName = (p, id) => {
    const u = p.units.find((x) => x.id === id);
    return !u ? '' : u.id === 'unsorted' ? t()('unit.unsorted') : u.name;
  };
  const emptyNote = (text) => h('p', { class: 'view-empty' }, text);

  function chatRow(p, chat) {
    const tt = t();
    return h('li', {},
      h('button', { type: 'button', class: 'tree-row', onclick: () => ctx.go(p.id, { type: 'chat', id: chat.sessionId }) },
        dotFor(chat),
        h('span', { class: 'tr-title' }, chat.title),
        chat.archived ? h('span', { class: 'tr-tag' }, tt('chat.archived')) : null,
        chat.workCellSource === 'guess' ? h('span', { class: 'tr-tag', title: tt('legend.unsure') }, '?') : null,
        h('span', { class: 'tr-meta' }, `${chatStatusText(chat)} · ${unitName(p, chat.unitId)}`)));
  }

  function branchRow(p, workCell, chats) {
    const tt = t();
    return h('li', {},
      h('button', { type: 'button', class: 'tree-row branch', onclick: () => ctx.go(p.id, { type: 'workcell', id: workCell.id }) },
        h('span', { class: `dot-mini wc-${workCell.status}${workCell.clashWith.length ? ' is-clash' : ''}`, 'aria-hidden': 'true' }),
        h('span', { class: 'tr-title branch-name' }, workCell.branch),
        h('span', { class: 'tr-meta' }, ownerChip(workCell.owner), ' · ', workCell.status === 'merged' ? tt('wc.merged', { main: p.mainBranch }) : tt.count('wc.commitsCount', workCell.ahead))),
      chats.length ? h('ul', { class: 'tree' }, chats.map((c) => chatRow(p, c))) : null);
  }

  function renderMap(root) {
    const p = ctx.project();
    const tt = t();
    const tree = mapTree(p, { archived: ctx.prefs.archived() });
    const toggle = h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: ctx.prefs.archived(), onchange: (e) => ctx.prefs.setArchived(e.target.checked) }),
      h('span', {}, tt('map.showArchived')));
    const parts = [h('div', { class: 'view-head' }, h('h2', {}, tt('map.title', { name: p.name })), toggle)];
    if (!p.chats.length && !p.workCells.length) parts.push(emptyNote(tt('state.emptyProject')));
    if (tree.phases) {
      parts.push(...tree.phases.map((phase) => h('section', { class: 'tree-block' },
        h('h3', {}, phase.name),
        h('ul', { class: 'tree' }, phase.stages.map((s) => h('li', { class: `stage stage-${s.milestone.status}` },
          h('div', { class: 'stage-head' },
            h('span', { class: 'stage-mark', 'aria-hidden': 'true' }),
            h('span', { class: 'stage-title' }, s.milestone.title),
            h('span', { class: 'tr-meta' }, tt(`stage.${s.milestone.status}`))),
          s.workCell ? h('ul', { class: 'tree' }, branchRow(p, s.workCell, s.chats)) : null))))));
    } else {
      parts.push(h('p', { class: 'view-note' }, tt('map.noRoadmap')));
    }
    if (!p.mainBranch) parts.push(h('p', { class: 'view-note' }, tt('state.noGit')));
    if (tree.loose.length) {
      parts.push(h('section', { class: 'tree-block' }, h('h3', {}, tree.phases ? tt('map.offRoadmap') : tt('map.branches')),
        h('ul', { class: 'tree' }, tree.loose.map((l) => branchRow(p, l.workCell, l.chats)))));
    }
    if (tree.main.length) {
      parts.push(h('section', { class: 'tree-block' }, h('h3', {}, tt('map.onMain', { main: p.mainBranch || tt('map.noBranch') })),
        h('ul', { class: 'tree' }, tree.main.map((c) => chatRow(p, c)))));
    }
    root.replaceChildren(h('div', { class: 'view-wrap' }, parts));
  }

  function boardCard(p, item) {
    const tt = t();
    const open = (sel) => () => ctx.go(p.id, sel);
    if (item.kind === 'milestone') {
      const m = item.milestone;
      return h('li', { class: 'card' }, h('div', { class: 'card-static' },
        h('span', { class: 'card-kind' }, m.branch), h('span', { class: 'card-title' }, m.title)));
    }
    if (item.kind === 'workcell') {
      const w = item.workCell;
      const tone = estimateTone(w.costUSD, w.estimateUSD);
      return h('li', { class: 'card' }, h('button', { type: 'button', class: 'card-btn', onclick: open({ type: 'workcell', id: w.id }) },
        h('span', { class: 'card-kind branch-name' }, w.branch),
        h('span', { class: 'card-title' }, item.milestone?.title || w.nucleus.doing || unitName(p, w.unitId)),
        h('span', { class: 'card-meta' }, ownerChip(w.owner), w.clashWith.length ? h('span', { class: 'pill tone-clash' }, tt('wc.clashing')) : null),
        w.openspec ? h('span', { class: 'card-meta' }, tt('chat.openspec', w.openspec)) : null,
        tone ? estimateBar(w.costUSD, w.estimateUSD, tone) : null));
    }
    if (item.kind === 'decision') {
      const d = item.decision;
      const clash = d.kind === 'clash' ? p.workCells.find((w) => w.clashWith.length && w.status !== 'merged') : null;
      const sel = clash ? { type: 'workcell', id: clash.id } : d.sessionId ? { type: 'chat', id: d.sessionId } : null;
      const body = [h('span', { class: `card-kind${clash ? ' tone-clash' : ' tone-waiting'}` }, tt(`waiting.${d.kind}`)), h('span', { class: 'card-title' }, d.text)];
      return h('li', { class: 'card' }, sel ? h('button', { type: 'button', class: 'card-btn', onclick: open(sel) }, body) : h('div', { class: 'card-static' }, body));
    }
    const c = item.chat;
    return h('li', { class: 'card' }, h('button', { type: 'button', class: 'card-btn', onclick: open({ type: 'chat', id: c.sessionId }) },
      h('span', { class: 'card-kind' }, dotFor(c), chatStatusText(c)),
      h('span', { class: 'card-title' }, c.title),
      h('span', { class: 'card-meta' }, unitName(p, c.unitId)),
      c.waiting.items[0] ? h('span', { class: 'card-detail' }, c.waiting.items[0]) : null));
  }

  function renderBoard(root) {
    const tt = t();
    const state = ctx.state();
    const chosen = pick.board ?? ctx.project().id;
    const projects = chosen === '*' ? state.projects : state.projects.filter((p) => p.id === chosen);
    const now = Date.parse(state.generatedAt);
    const filter = h('label', { class: 'dv-field' }, h('span', {}, tt('board.filter')),
      h('select', { name: 'board-project', onchange: (e) => { pick.board = e.target.value; renderBoard(root); } },
        h('option', { value: '*' }, tt('board.all')),
        state.projects.map((p) => h('option', { value: p.id, selected: p.id === chosen }, p.name))));
    const columns = { todo: [], doing: [], waiting: [], done: [] };
    for (const p of projects) {
      const cols = boardColumns(p, now);
      for (const k of Object.keys(columns)) columns[k].push(...cols[k].map((item) => ({ p, item })));
    }
    const column = (k) => h('section', { class: `col col-${k}`, 'aria-labelledby': `col-${k}` },
      h('h3', { id: `col-${k}` }, tt(`board.${k}`), h('span', { class: 'col-count num' }, String(columns[k].length))),
      columns[k].length
        ? h('ul', { class: 'cards' }, columns[k].map(({ p, item }) => boardCard(p, item)))
        : h('p', { class: 'col-empty' }, tt(`board.${k}.empty`)));
    root.replaceChildren(h('div', { class: 'view-wrap wide' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('board.title')), filter),
      h('div', { class: 'board' }, ['todo', 'doing', 'waiting', 'done'].map(column))));
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
    const res = await api.history(pick.historyQuery, pick.historyProject);
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
      : [h('li', { class: 'view-empty' }, pick.historyQuery ? tt('history.noMatch') : tt('history.empty'))]));
  }

  function messageView(m) {
    const tt = t();
    const lines = m.text.split('\n');
    const tools = m.role === 'assistant' ? lines.filter((l) => TOOL_LINE.test(l.trim())) : [];
    const prose = tools.length ? lines.filter((l) => !TOOL_LINE.test(l.trim())).join('\n').trim() : m.text;
    return h('li', { class: `msg ${m.role === 'user' ? 'msg-user' : 'msg-claude'}` },
      h('span', { class: 'visually-hidden' }, `${m.role === 'user' ? tt('chat.you') : 'Claude'}: `),
      prose ? h('p', {}, prose) : null,
      tools.length ? h('details', { class: 'tool-steps' }, h('summary', {}, tt.count('history.tools', tools.length)), h('pre', {}, tools.join('\n'))) : null);
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
      h('ol', { class: 'transcript' }, res.messages.map(messageView)));
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
        h('div', { class: 'view-head' }, h('h2', {}, tt('history.title'))),
        h('p', { class: 'view-lede' }, tt('history.lede')),
        h('div', { class: 'dv-tools' },
          h('label', { class: 'dv-field grow' }, h('span', { class: 'visually-hidden' }, tt('history.search')), search),
          h('label', { class: 'dv-field' }, h('span', {}, tt('history.project')), project)),
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
    const range = pick.costs;
    const now = Date.parse(state.generatedAt);
    const rows = costRows(state, range, now);
    const ai = aiSpend(state);
    const ranges = h('div', { class: 'seg', role: 'group', 'aria-label': tt('costs.range') }, RANGES.map((r) => h('button', {
      type: 'button', 'aria-pressed': String(r === range), onclick: () => { pick.costs = r; renderCosts(root); },
    }, tt(`costs.range.${r}`))));
    const maxProject = Math.max(1e-9, ...state.projects.map((p) => p.cost[range]));
    const ledger = h('dl', { class: 'ledger' },
      h('div', {}, h('dt', {}, tt(`costs.total.${range}`)), h('dd', { class: 'num strong' }, fmt.money(state.totals[range]))),
      state.budget ? budgetRow(state.budget) : null,
      h('div', {}, h('dt', {}, tt('costs.ai')), h('dd', {}, h('span', { class: 'num' }, fmt.money(ai.todayUSD),
        h('span', { class: 'muted' }, ` · ${ai.projects.length ? tt('costs.aiModel', { model: ai.projects[0].model }) : tt('costs.aiOff')}`)))));
    const aiList = ai.projects.length ? h('ul', { class: 'plain rows bars' }, ai.projects.map((x) => h('li', { class: 'bar-row' },
      h('span', { class: 'br-name' }, x.project.name),
      h('span', { class: 'br-value num' }, fmt.money(x.spentUSDToday || 0)),
      h('span', { class: 'br-sub' }, [x.queue ? tt.count('costs.aiQueue', x.queue) : tt('costs.aiIdle'),
        x.bootstrap && x.bootstrap.done < x.bootstrap.total ? tt('costs.aiBootstrap', { done: x.bootstrap.done, total: x.bootstrap.total, cost: fmt.money(x.bootstrap.estimatedUSD) }) : null].filter(Boolean).join(' · '))))) : null;
    const estimates = state.projects.flatMap((p) => p.workCells.filter((w) => w.estimateUSD).map((w) => ({ p, w })));
    root.replaceChildren(h('div', { class: 'view-wrap' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('costs.title')), ranges),
      h('p', { class: 'view-lede' }, tt('costs.honest')),
      ledger,
      h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.byProject')),
        h('ul', { class: 'plain rows bars' }, state.projects.map((p) => h('li', { class: 'bar-row' },
          h('span', { class: 'br-name' }, p.name),
          h('span', { class: 'br-value num' }, fmt.money(p.cost[range])),
          h('span', { class: 'br-track', 'aria-hidden': 'true' }, h('span', { style: `width:${((p.cost[range] / maxProject) * 100).toFixed(1)}%` })))))),
      h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.aiTitle')), h('p', { class: 'view-note' }, tt('costs.aiLede')), aiList),
      estimates.length ? h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.estimates')),
        h('ul', { class: 'plain rows' }, estimates.map(({ p, w }) => h('li', {},
          h('button', { type: 'button', class: 'est-row', onclick: () => ctx.go(p.id, { type: 'workcell', id: w.id }) },
            h('span', { class: 'branch-name' }, w.branch), estimateBar(w.costUSD, w.estimateUSD, estimateTone(w.costUSD, w.estimateUSD))))))) : null,
      h('section', { class: 'tree-block' }, h('h3', {}, tt('costs.chats')), h('p', { class: 'view-note' }, tt('costs.chatsNote')),
        rows.length ? h('ol', { class: 'plain rows costs-list' }, rows.slice(0, 50).map(({ project, chat }) => h('li', {},
          h('button', { type: 'button', class: 'link-row', onclick: () => ctx.go(project.id, { type: 'chat', id: chat.sessionId }) },
            h('span', { class: 'lr-title' }, chat.title),
            h('span', { class: 'lr-date num strong' }, fmt.money(chat.costUSD)),
            h('span', { class: 'lr-line' }, [project.name, unitName(project, chat.unitId), fmt.relative(chat.updatedAt)].filter(Boolean).join(' · '))))))
          : emptyNote(tt('costs.none')))));
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

  const renderers = { map: renderMap, board: renderBoard, history: renderHistory, costs: renderCosts };
  return {
    render(name, root) { renderers[name]?.(root); },
    // Polling refreshes the open view, except History, which keeps the person's place.
    refresh(name, root) { if (name !== 'history' && !root.contains(document.activeElement)) renderers[name]?.(root); },
  };
}
