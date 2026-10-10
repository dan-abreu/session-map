import { emptyState } from './empty.js';
import { REQUEST_STATES, requestsOf } from './requests.js';

// The Requests tab (id76): everything the owner asked for, in his words, grouped by where it stands, each with the work
// it became and how much of it is done. The filter on top is pure and tested; the view below draws it.

// f: {state, waiting, noActivity, query}; a request matches every filter given.
export function filterRequests(list, f = {}) {
  const words = String(f.query ?? '').trim().toLowerCase();
  return list.filter((r) => (!f.state || r.state === f.state) && (!f.waiting || r.waiting) && (!f.noActivity || r.noActivity)
    && (!words || [r.code, r.title, r.meaning, ...r.asked.map((a) => a.words), ...r.went.map((w) => w.title)].join(' ').toLowerCase().includes(words)));
}

// ctx: h, t (translator getter), icon, lang(), state(), project(), openItem(projectId, code).
export function createRequestsView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const pick = { scope: null, filter: 'all', query: '' };

  const when = ({ date, time }) => {
    if (!date) return '';
    const day = new Intl.DateTimeFormat(ctx.lang(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    return time ? `${day} ${time.replace('~', '')}` : day;
  };

  function activity(p, w) {
    const tt = t();
    const status = w.status ?? 'missing';
    const label = [h('span', { class: `req-dot s-${status}`, 'aria-hidden': 'true' }), h('code', { class: 'code-chip' }, w.code),
      h('span', { class: 'req-act-title' }, w.title ?? tt('requests.notOnMap')),
      w.status ? h('span', { class: 'req-act-state' }, tt(`board.${w.status}`)) : null];
    return h('li', {}, w.status
      ? h('button', { type: 'button', class: 'req-act', onclick: () => ctx.openItem(p.id, w.code) }, label)
      : h('span', { class: 'req-act is-missing' }, label));
  }

  function card(p, r, showProject) {
    const tt = t();
    const [first, ...more] = r.asked;
    const outcome = r.version ? tt('requests.version', { v: r.version }) : r.unreleased ? tt('requests.unreleased') : null;
    return h('li', { class: `req-card st-${r.state}${r.noActivity ? ' is-bare' : ''}` },
      h('div', { class: 'req-top' },
        h('span', { class: `req-state st-${r.state}` }, tt(`requests.state.${r.state}`)),
        r.waiting ? h('span', { class: 'req-state is-waiting' }, tt('requests.f.waiting')) : null,
        showProject ? h('span', { class: 'req-project' }, p.name) : null,
        h('code', { class: 'code-chip req-code' }, r.code)),
      h('h3', { class: 'req-title' }, r.title),
      first ? h('div', { class: 'req-asked' },
        h('span', { class: 'req-when' }, tt('requests.asked', { when: when(first) })),
        h('blockquote', {}, first.words),
        more.length ? h('details', { class: 'req-more' }, h('summary', {}, t().count('requests.askedMore', more.length)),
          more.map((a) => h('div', { class: 'req-asked' }, h('span', { class: 'req-when' }, when(a)), h('blockquote', {}, a.words)))) : null) : null,
      r.meaning ? h('p', { class: 'req-meaning' }, r.meaning) : null,
      r.went.length
        ? h('div', { class: 'req-work' },
          h('div', { class: 'req-work-head' }, h('h4', {}, tt('requests.work')),
            r.progress.total ? h('span', { class: 'req-progress num' }, tt('requests.progress', r.progress)) : null),
          r.progress.total ? h('span', { class: 'req-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((r.progress.done / r.progress.total) * 100)}%` })) : null,
          h('ul', { class: 'plain req-acts' }, r.went.map((w) => activity(p, w))))
        : r.noActivity ? h('p', { class: 'req-none' }, tt('requests.noActivity')) : null,
      outcome || r.note || r.confirm ? h('div', { class: 'req-foot' },
        outcome ? h('span', { class: 'req-outcome' }, outcome) : null,
        r.note && !outcome ? h('span', { class: 'req-note' }, r.note) : null,
        r.confirm ? h('details', { class: 'req-confirm' }, h('summary', {}, tt('requests.confirm')), h('p', {}, r.confirm)) : null) : null);
  }

  function render(root) {
    const tt = t();
    const state = ctx.state();
    const chosen = pick.scope ?? ctx.project().id;
    const projects = chosen === '*' ? state.projects : state.projects.filter((p) => p.id === chosen);
    const all = projects.flatMap((p) => requestsOf(p).list.map((r) => ({ p, r })));
    const list = all.map((x) => x.r);
    const counts = {
      all: list.length, ...Object.fromEntries(REQUEST_STATES.map((s) => [s, list.filter((r) => r.state === s).length])),
      waiting: list.filter((r) => r.waiting).length, noActivity: list.filter((r) => r.noActivity).length,
    };
    const f = pick.filter;
    const scope = h('label', { class: 'dv-field' }, h('span', {}, tt('requests.filter')),
      h('select', { name: 'requests-project', onchange: (e) => { pick.scope = e.target.value; render(root); } },
        h('option', { value: '*' }, tt('requests.all')),
        state.projects.map((p) => h('option', { value: p.id, selected: p.id === chosen }, p.name))));
    const chip = (key, label) => h('button', { type: 'button', class: `req-chip f-${key}`, 'aria-pressed': String(f === key), onclick: () => { pick.filter = key; render(root); } },
      label, h('span', { class: 'num' }, String(counts[key])));
    const chips = h('div', { class: 'req-chips', role: 'group', 'aria-label': tt('requests.filters') },
      chip('all', tt('requests.f.all')), chip('doing', tt('requests.state.doing')), chip('planned', tt('requests.state.planned')),
      chip('waiting', tt('requests.f.waiting')), counts.noActivity ? chip('noActivity', tt('requests.f.noActivity')) : null,
      chip('later', tt('requests.state.later')), chip('done', tt('requests.state.done')), chip('dropped', tt('requests.state.dropped')));
    const search = h('input', { type: 'search', class: 'req-search', placeholder: tt('requests.search'), 'aria-label': tt('requests.search'), value: pick.query,
      oninput: (e) => { pick.query = e.target.value; drawList(); } });
    const body = h('div', { class: 'req-groups' });
    function drawList() {
      const shown = new Set(filterRequests(list, {
        state: REQUEST_STATES.includes(f) ? f : null, waiting: f === 'waiting', noActivity: f === 'noActivity', query: pick.query,
      }));
      const groups = REQUEST_STATES.map((s) => ({ s, rows: all.filter(({ r }) => r.state === s && shown.has(r)) })).filter((g) => g.rows.length);
      body.replaceChildren(...(groups.length
        ? groups.map(({ s, rows }) => h('section', { class: `req-group st-${s}`, 'aria-labelledby': `req-${s}` },
          h('h3', { id: `req-${s}`, class: 'req-group-title' }, tt(`requests.state.${s}`), h('span', { class: 'col-count num' }, String(rows.length))),
          h('ul', { class: 'plain req-cards' }, rows.map(({ p, r }) => card(p, r, chosen === '*')))))
        : [emptyState({ h, icon: ctx.icon }, list.length
          ? { art: 'search', title: tt('requests.nothing'), compact: true }
          : { art: 'check', title: tt('requests.none.title'), text: tt('requests.none.text') })]));
    }
    drawList();
    root.replaceChildren(h('div', { class: 'view-wrap wide' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('requests.title')), scope),
      h('p', { class: 'view-lede' }, tt('requests.lede')),
      list.length ? h('div', { class: 'req-tools' }, chips, search) : null,
      body));
  }

  // A poll redraws the tab only when nothing is being typed in its search.
  const refresh = (root) => {
    if (root.contains(document.activeElement) && document.activeElement?.classList.contains('req-search')) return;
    render(root);
  };

  return { render, refresh };
}
