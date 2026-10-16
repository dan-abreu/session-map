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

// The review (mm27): the open requests one at a time. What can be closed comes first, then what has no work yet, then what is
// being done, then what was parked. rows: [{p, r}]; decided: the "project:code" keys already decided in this review.
const REVIEW_STATES = new Set(['planned', 'doing', 'later']);
const REVIEW_ORDER = (r) => (r.unconfirmed ? 0 : r.noActivity ? 1 : r.state === 'doing' ? 2 : r.state === 'planned' ? 3 : 4);
export const reviewKey = (p, r) => `${p.id}:${r.code}`;
export function reviewQueue(rows, decided = new Set()) {
  return rows
    .filter(({ p, r }) => (REVIEW_STATES.has(r.state) || r.unconfirmed) && !decided.has(reviewKey(p, r)))
    .map((row, at) => ({ ...row, at }))
    .sort((a, b) => REVIEW_ORDER(a.r) - REVIEW_ORDER(b.r) || a.at - b.at)
    .map(({ at, ...row }) => row);
}

// ctx: h, t (translator getter), icon, lang(), state(), project(), openItem(projectId, code), api, toast, errorText, look().
const QUOTE_SHORT = 160;

export function createRequestsView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const pick = { scope: null, filter: 'all', query: '', review: false, decided: new Set(), discarding: false, busy: false, reason: '' };

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
      w.status ? h('span', { class: 'req-act-state' }, tt(`requests.act.${w.status}`)) : null];
    return h('li', {}, w.status
      ? h('button', { type: 'button', class: 'req-act', onclick: () => ctx.openItem(p.id, w.code) }, label)
      : h('span', { class: 'req-act is-missing' }, label));
  }

  // The owner's words, two lines at first: a long quote opens with "Show more".
  function quote(words) {
    const box = h('blockquote', { class: 'req-quote' }, words);
    if (words.length <= QUOTE_SHORT) return box;
    const more = h('button', { type: 'button', class: 'req-quote-more', 'aria-expanded': 'false', onclick: () => {
      const open = box.classList.toggle('is-open');
      more.setAttribute('aria-expanded', String(open));
      more.hidden = open;
    } }, t()('requests.more'));
    return h('div', { class: 'req-quote-wrap' }, box, more);
  }

  function card(p, r, showProject) {
    const tt = t();
    const [first, ...more] = r.asked;
    const outcome = r.version ? tt('requests.version', { v: r.version.replace(/^v/, '') }) : r.unreleased ? tt('requests.unreleased') : r.unconfirmed ? tt('requests.unconfirmed') : null;
    return h('li', { class: `req-card st-${r.state}${r.noActivity ? ' is-bare' : ''}` },
      h('div', { class: 'req-top' },
        h('span', { class: `req-state st-${r.state}` }, tt(`requests.state.${r.state}`)),
        r.waiting ? h('span', { class: 'req-state is-waiting' }, tt('requests.f.waiting')) : null,
        showProject ? h('span', { class: 'req-project' }, p.name) : null,
        h('code', { class: 'code-chip req-code' }, r.code)),
      h('h3', { class: 'req-title' }, r.title),
      first ? h('div', { class: 'req-asked' },
        h('span', { class: 'req-when' }, tt('requests.asked', { when: when(first) })),
        quote(first.words),
        more.length ? h('details', { class: 'req-more' }, h('summary', {}, t().count('requests.askedMore', more.length)),
          more.map((a) => h('div', { class: 'req-asked' }, h('span', { class: 'req-when' }, when(a)), quote(a.words)))) : null) : null,
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

  // One decision: the server writes the registry through the project's care mode, and the request leaves the queue.
  async function decide(root, p, r, to, reason) {
    if (pick.busy) return;
    pick.busy = true;
    render(root);
    const res = await ctx.api.requestStatus(p.id, r.code, to, reason);
    pick.busy = false;
    if (!res.ok) {
      ctx.toast(res.error === 'look-only' ? t()('requests.review.look') : ctx.errorText(res.error));
      return render(root);
    }
    pick.decided.add(reviewKey(p, r));
    pick.discarding = false;
    pick.reason = '';
    ctx.toast(t()(`requests.review.saved.${to}`, { code: r.code }));
    render(root);
  }

  function renderReview(root, all, chosen, scope) {
    const tt = t();
    const queue = reviewQueue(all, pick.decided);
    const current = queue[0] ?? null;
    const leave = () => { pick.review = false; pick.discarding = false; pick.reason = ''; render(root); };
    const next = () => { pick.decided.add(reviewKey(current.p, current.r)); pick.discarding = false; pick.reason = ''; render(root); };
    const { p, r } = current ?? {};
    const button = (cls, label, onclick, extra = {}) => h('button', { type: 'button', class: `btn ${cls}`.trim(), disabled: pick.busy, onclick, ...extra }, label);
    const bar = current ? h('div', { class: 'req-review-bar', role: 'group', 'aria-label': tt('requests.review') },
      pick.discarding
        ? [h('label', { class: 'dv-field req-reason-field' }, h('span', {}, tt('requests.review.reason')),
          h('input', { type: 'text', class: 'req-reason', name: 'req-reason', maxlength: '300', value: pick.reason, 'aria-required': 'true',
            oninput: (e) => { pick.reason = e.target.value; go.disabled = pick.busy || !pick.reason.trim(); },
            onkeydown: (e) => { if (e.key === 'Enter' && pick.reason.trim()) decide(root, p, r, 'discarded', pick.reason); } })),
        button('danger', tt('requests.review.reasonGo'), () => decide(root, p, r, 'discarded', pick.reason), { disabled: pick.busy || !pick.reason.trim(), class: 'btn danger req-reason-go' }),
        button('', tt('requests.review.cancel'), () => { pick.discarding = false; pick.reason = ''; render(root); })]
        : [r.unconfirmed ? button('primary', tt('requests.review.close'), () => decide(root, p, r, 'done')) : null,
          button(r.unconfirmed ? '' : 'primary', tt('requests.review.keep'), next),
          r.state === 'later' ? null : button('', tt('requests.review.later'), () => decide(root, p, r, 'later')),
          button('danger-quiet', tt('requests.review.discard'), () => { pick.discarding = true; render(root); })]) : null;
    let go = null;
    root.replaceChildren(h('div', { class: 'view-wrap wide req-review' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('requests.review')), scope,
        h('button', { type: 'button', class: 'btn', onclick: leave }, tt('requests.review.exit'))),
      h('p', { class: 'view-lede' }, tt('requests.review.lede')),
      current
        ? h('div', { class: 'req-review-body' },
          h('p', { class: 'req-review-count num' }, tt('requests.review.count', { n: pick.decided.size + 1, total: pick.decided.size + queue.length })),
          h('ul', { class: 'plain req-cards' }, card(p, r, chosen === '*')),
          r.unconfirmed ? h('p', { class: 'req-review-can' }, tt('requests.review.canClose')) : null,
          bar)
        : emptyState({ h, icon: ctx.icon }, { art: 'check', title: tt('requests.review.empty.title'), text: tt('requests.review.empty.text') })));
    go = root.querySelector('.req-reason-go');
    if (pick.discarding) root.querySelector('.req-reason')?.focus();
  }

  function render(root) {
    const tt = t();
    const state = ctx.state();
    const chosen = pick.scope ?? ctx.project().id;
    const projects = chosen === '*' ? state.projects : state.projects.filter((p) => p.id === chosen);
    const all = projects.flatMap((p) => requestsOf(p, { lang: ctx.lang() }).list.map((r) => ({ p, r })));
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
    if (pick.review) return renderReview(root, all, chosen, scope);
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
      h('div', { class: 'view-head' }, h('h2', {}, tt('requests.title')), scope,
        list.length && !ctx.look?.() ? h('button', { type: 'button', class: 'btn req-review-open', onclick: () => { pick.review = true; pick.discarding = false; render(root); } }, tt('requests.review')) : null),
      h('p', { class: 'view-lede' }, tt('requests.lede')),
      h('p', { class: 'view-note req-outside' }, tt('requests.outside')),
      list.length ? h('div', { class: 'req-tools' }, chips, search) : null,
      body));
  }

  // A poll redraws the tab only when nothing is being typed in its search.
  const refresh = (root) => {
    if (root.contains(document.activeElement) && (document.activeElement?.classList.contains('req-search') || document.activeElement?.classList.contains('req-reason'))) return;
    if (pick.busy) return;
    render(root);
  };

  return { render, refresh };
}
