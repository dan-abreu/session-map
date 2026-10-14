// The spend statement in the Costs tab, laid out the way AI cost tools do their books (sb12, from id98): key figures,
// spend by day, a cost-center tree (project ▸ chat ▸ helper, plus session-map's own work and the other AIs) and the
// journal of entries with a running balance. A chat opens to its files and kinds of work; anything opens its entries.
// The server does the sums (statement-route.mjs, ledger.mjs); this section keeps its own element and place, so the tab
// redrawing keeps them.

const POLL_MS = 1500;
const REFRESH_MS = 60_000;
const PAGE = 50;
const LIST_FIRST = 15;
const TREE_WHO = 10;
const DAY = 86_400_000;
const MAIN = 'conversa principal';

async function getJson(path) {
  let res;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } });
  } catch {
    return { ok: false, error: 'network' };
  }
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok, error: res.ok ? undefined : data.error ?? `http-${res.status}` };
}

const ymd = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The quick periods, as "from" and "to" days (both included).
export function presetPeriod(id, now = Date.now()) {
  const today = ymd(now);
  const back = (n) => ymd(now - n * DAY);
  const d = new Date(now);
  if (id === 'today') return { from: today, to: today };
  if (id === '7') return { from: back(6), to: today };
  if (id === 'month') return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1).getTime()), to: today };
  if (id === '90') return { from: back(89), to: today };
  return { from: back(29), to: today };
}

// Every day of the period, oldest first, with its spend (0 when nothing ran), for the bars.
export function daysOf(period, byDay, now = Date.now()) {
  const spent = new Map(byDay.map((d) => [d.day, d]));
  const out = [];
  const end = Math.min(period.to, now + 1);
  for (let d = new Date(period.from); d.getTime() < end; d.setDate(d.getDate() + 1)) {
    const day = ymd(d.getTime());
    out.push({ day, usd: spent.get(day)?.usd ?? 0, replies: spent.get(day)?.replies ?? 0 });
  }
  return out;
}

// deps: h, t (getter), lang (getter), errorText(code).
export function createStatement({ h, t, lang, errorText }) {
  const ui = { preset: '30', ...presetPeriod('30'), level: 'period', chatId: null, outsideId: null, open: new Set(), expanded: new Set() };
  const journal = { filter: {}, title: '', rows: [], total: 0, sum: 0 };
  let period = null;
  let book = null;
  let reading = null;
  let error = null;
  let started = false;
  let lastTry = 0;
  let pollTimer = 0;
  let run = 0;
  const root = h('section', { class: 'tree-block stmt', id: 'statement', 'aria-labelledby': 'stmt-title' });

  const num = (n) => new Intl.NumberFormat(lang()).format(Math.round(n ?? 0));
  const usd = (n, digits = 2) => new Intl.NumberFormat(lang(), { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n ?? 0);
  // A share too small to show is "< 0.1 %", never "0 %": it did cost something.
  const pct = (x) => {
    const f = new Intl.NumberFormat(lang(), { style: 'percent', maximumFractionDigits: 1 });
    return x > 0 && x < 0.0005 ? `< ${f.format(0.001)}` : f.format(x ?? 0);
  };
  const date = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);
  const short = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit' }).format(ms);
  const hour = (ms) => new Intl.DateTimeFormat(lang(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ms);
  const when = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
  const dayName = (day) => new Intl.DateTimeFormat(lang(), { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${day}T12:00`));
  const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();
  const readUsd = (b) => (b.usdRead ?? 0) + (b.usdKeep ?? 0) + (b.usdNew ?? 0);

  // ----- loading -----

  async function loadPeriod() {
    const mine = ++run;
    lastTry = Date.now();
    const res = await getJson(`/api/statement?${qs({ from: ui.from, to: ui.to })}`);
    if (mine !== run) return;
    clearTimeout(pollTimer);
    if (!res.ok) {
      error = res.error;
      draw();
      return;
    }
    error = res.failed && !res.period ? res.failed : null;
    reading = res.reading;
    const fresh = res.period && res.builtAt !== period?.builtAt;
    if (res.period) period = { ...res.period, builtAt: res.builtAt };
    // Asked again only while the server says it is reading, and only while the section is on the page.
    if (reading && root.isConnected !== false) pollTimer = setTimeout(loadPeriod, POLL_MS);
    if (fresh) await loadJournal(false);
    draw();
  }

  async function loadJournal(more) {
    const offset = more ? journal.rows.length : 0;
    const res = await getJson(`/api/statement/rows?${qs({ from: ui.from, to: ui.to, ...journal.filter, offset, limit: PAGE })}`);
    if (!res.ok) return;
    journal.rows = more ? journal.rows.concat(res.rows) : res.rows;
    journal.total = res.total;
    journal.sum = res.sumUsd ?? 0;
  }

  // Shows the entries of whatever was picked: in the period's journal, or on their own page (from a chat).
  async function showEntries(filter, title, own = false) {
    Object.assign(journal, { filter, title });
    await loadJournal(false);
    if (own) ui.level = 'rows';
    draw();
    (own ? root : root.querySelector('#stmt-journal'))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function openChat(id) {
    const res = await getJson(`/api/statement/chat?${qs({ id, from: ui.from, to: ui.to })}`);
    if (!res.ok) { error = res.error; draw(); return; }
    book = res;
    Object.assign(ui, { level: 'chat', chatId: id, open: new Set() });
    draw();
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openOutside(id) {
    Object.assign(ui, { level: 'outside', outsideId: id, open: new Set() });
    draw();
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function setPeriod(change) {
    Object.assign(ui, change, { level: 'period', chatId: null });
    Object.assign(journal, { filter: {}, title: '' });
    period = null;
    book = null;
    draw();
    loadPeriod();
  }

  function backToPeriod() {
    ui.level = 'period';
    if (journal.filter.chat && !journal.filter.project) Object.assign(journal, { filter: {}, title: '' });
    loadJournal(false).then(draw);
    draw();
  }

  // ----- pieces -----

  const link = (text, onclick, title) => h('button', { type: 'button', class: 'stmt-link', onclick, title: title ?? null }, text);
  const cell = (c, cls) => h('td', { class: cls }, c);
  function table(head, list, totalRow = null, cls = '') {
    return h('div', { class: 'stmt-table-wrap' }, h('table', { class: `stmt-table ${cls}` },
      h('thead', {}, h('tr', {}, head.map((c, i) => (Array.isArray(c) ? h('th', { class: i ? 'n' : null, scope: 'col', title: c[1] }, c[0]) : h('th', { class: i ? 'n' : null, scope: 'col' }, c))))),
      h('tbody', {}, list.map((cells) => (!Array.isArray(cells) ? cells : h('tr', {}, cells.map((c, i) => cell(c, i ? 'n' : null)))))),
      totalRow ? h('tfoot', {}, h('tr', {}, totalRow.map((c, i) => cell(c, i ? 'n' : null)))) : null));
  }
  const firstOf = (key, list) => (ui.open.has(key) ? list : list.slice(0, LIST_FIRST));
  const showAll = (key, list, tt) => (list.length > LIST_FIRST ? h('button', {
    type: 'button', class: 'btn small-btn', onclick: () => { if (ui.open.has(key)) ui.open.delete(key); else ui.open.add(key); draw(); },
  }, ui.open.has(key) ? tt('stmt.showFewer') : tt('stmt.showAll', { n: num(list.length) })) : null);

  function crumbs(tt) {
    const items = [h('li', {}, ui.level === 'period' ? h('span', { 'aria-current': 'page' }, tt('stmt.crumb.period')) : link(tt('stmt.crumb.period'), backToPeriod))];
    if (ui.level === 'chat' || (ui.level === 'rows' && book && journal.filter.chat === book.sessionId)) {
      items.push(h('li', {}, ui.level === 'chat' ? h('span', { 'aria-current': 'page' }, book.title) : link(book.title, () => { ui.level = 'chat'; draw(); })));
    }
    if (ui.level === 'rows') items.push(h('li', {}, h('span', { 'aria-current': 'page' }, journal.title)));
    if (ui.level === 'outside') items.push(h('li', {}, h('span', { 'aria-current': 'page' }, tt(`stmt.spender.${ui.outsideId}`))));
    return h('nav', { class: 'stmt-crumbs', 'aria-label': tt('stmt.crumb.label') }, h('ol', {}, items));
  }

  function periodBar(tt) {
    const presets = [['today', tt('stmt.p.today')], ['7', tt('stmt.p.7')], ['30', tt('stmt.p.30')], ['month', tt('stmt.p.month')], ['90', tt('stmt.p.90')]];
    const from = h('input', { type: 'date', value: ui.from, 'aria-label': tt('stmt.p.from') });
    const to = h('input', { type: 'date', value: ui.to, 'aria-label': tt('stmt.p.to') });
    return h('div', { class: 'stmt-period' },
      h('div', { class: 'stmt-presets', role: 'group', 'aria-label': tt('stmt.p.label') }, presets.map(([id, text]) => h('button', {
        type: 'button', class: `btn small-btn${ui.preset === id ? ' is-on' : ''}`, 'aria-pressed': ui.preset === id ? 'true' : 'false',
        onclick: () => setPeriod({ preset: id, ...presetPeriod(id) }),
      }, text))),
      h('label', { class: 'stmt-date' }, h('span', {}, tt('stmt.p.from')), from),
      h('label', { class: 'stmt-date' }, h('span', {}, tt('stmt.p.to')), to),
      h('button', { type: 'button', class: 'btn small-btn', onclick: () => { if (from.value && to.value) setPeriod({ preset: '', from: from.value, to: to.value }); } }, tt('stmt.p.apply')));
  }

  // ----- the period: figures, bars, cost centers, journal -----

  function kpis(tt, grand) {
    const p = period;
    const days = daysOf(p, p.byDay);
    const last7 = days.slice(-7);
    const pace = last7.reduce((n, d) => n + d.usd, 0) / Math.max(1, last7.length);
    const chatsUsd = p.chats.reduce((n, c) => n + c.usd, 0);
    const a = p.account;
    const tile = (label, value, sub, tone = '', title = null) => h('div', { class: `stmt-kpi ${tone}`, title },
      h('span', { class: 'stmt-kpi-label' }, label), h('strong', { class: 'num' }, value), sub ? h('span', { class: 'stmt-kpi-sub num' }, sub) : null);
    return h('div', { class: 'stmt-kpis' },
      tile(tt('stmt.kpi.total'), usd(grand), `${short(p.from)} – ${short(p.to - 1)}`),
      tile(tt('stmt.kpi.perDay'), usd(grand / Math.max(1, days.length)), tt('stmt.kpi.perDaySub', { n: num(days.length) })),
      tile(tt('stmt.kpi.pace'), usd(pace), tt('stmt.kpi.paceSub', { usd: usd(pace * 30) })),
      tile(tt('stmt.kpi.perChat'), usd(p.chats.length ? chatsUsd / p.chats.length : 0), tt('stmt.kpi.perChatSub', { usd: usd(p.total.replies ? chatsUsd / p.total.replies : 0, 4) })),
      a ? tile(tt('stmt.kpi.extra'), a.extraUsed, a.disabledReason === 'out_of_credits' ? `⚠ ${tt('stmt.account.outOfCredits')}` : tt('stmt.kpi.weekly', { pct: a.weeklyPercent }), a.disabledReason ? 'is-warn' : '',
        // The limit notices of the period, on hover: when the plan ran out and the credits stopped.
        (p.events ?? []).slice(-8).reverse().map((e) => `${when(e.at)} — ${e.text}`).join('\n') || null) : null);
  }

  // One bar per day of the period, the day's total; a bar opens that day's entries.
  function dayBars(tt) {
    const days = daysOf(period, period.byDay);
    const max = Math.max(1e-9, ...days.map((d) => d.usd));
    const W = 100 / Math.max(1, days.length);
    const ticks = [max, max / 2];
    return h('figure', { class: 'stmt-chart' },
      h('figcaption', {}, tt('stmt.chart.title')),
      h('div', { class: 'stmt-plot' },
        h('div', { class: 'stmt-axis num', 'aria-hidden': 'true' }, ticks.map((v) => h('span', {}, usd(v, 0))), h('span', {}, usd(0, 0))),
        h('div', { class: 'stmt-bars', role: 'list' }, days.map((d) => {
          const label = tt('stmt.chart.bar', { day: dayName(d.day), usd: usd(d.usd), n: num(d.replies) });
          return h('button', {
            type: 'button', role: 'listitem', class: 'stmt-bar-day', style: `width:${W}%`, title: label, 'aria-label': label,
            onclick: () => showEntries({ day: d.day }, dayName(d.day)),
          }, h('span', { style: `height:${((d.usd / max) * 100).toFixed(1)}%` }));
        }))),
      h('div', { class: 'stmt-xaxis num', 'aria-hidden': 'true' }, h('span', {}, short(new Date(`${days[0]?.day}T12:00`))), h('span', {}, short(new Date(`${days.at(-1)?.day}T12:00`)))));
  }

  // The cost centers, as a tree: each project, its chats, each chat's helpers; then session-map's own work and the
  // other AIs. A ▸ opens a level; "Lançamentos" shows that center's entries in the journal below.
  function costTree(tt, grand) {
    const p = period;
    const projects = new Map();
    for (const c of p.chats) {
      if (!projects.has(c.project)) projects.set(c.project, { name: c.project, chats: [], usd: 0, replies: 0, usdRead: 0, usdKeep: 0, usdNew: 0, usdWrite: 0 });
      const g = projects.get(c.project);
      g.chats.push(c);
      for (const k of ['usd', 'replies', 'usdRead', 'usdKeep', 'usdNew', 'usdWrite']) g[k] += c[k] ?? 0;
    }
    const share = (v) => (grand > 0 ? v / grand : 0);
    const toggle = (key) => () => { if (ui.expanded.has(key)) ui.expanded.delete(key); else ui.expanded.add(key); draw(); };
    const arrow = (key) => h('button', { type: 'button', class: 'stmt-toggle', 'aria-expanded': ui.expanded.has(key) ? 'true' : 'false', 'aria-label': tt('stmt.tree.toggle'), onclick: toggle(key) }, ui.expanded.has(key) ? '▾' : '▸');
    const entries = (filter, title) => link(tt('stmt.col.journal'), () => showEntries(filter, title));
    const line = (level, name, count, b, action) => h('tr', { class: `lvl-${level}` },
      cell(h('span', { class: 'stmt-center' }, name)), cell(count, 'n'), cell(usd(readUsd(b)), 'n'), cell(usd(b.usdWrite ?? 0), 'n'),
      cell(h('strong', {}, usd(b.usd)), 'n'), cell(pct(share(b.usd)), 'n'), cell(action, 'n'));
    const rows = [];
    for (const g of [...projects.values()].sort((a, b) => b.usd - a.usd)) {
      const pk = `p:${g.name}`;
      rows.push(line(0, [arrow(pk), h('strong', {}, g.name)], tt('stmt.nChats', { n: num(g.chats.length) }), g, entries({ project: g.name }, g.name)));
      if (!ui.expanded.has(pk)) continue;
      for (const c of g.chats) {
        const ck = `c:${c.sessionId}`;
        rows.push(line(1, [arrow(ck), link(c.title, () => openChat(c.sessionId), tt('stmt.tree.details'))], tt('stmt.nReplies', { n: num(c.replies) }), c, entries({ chat: c.sessionId }, c.title)));
        if (!ui.expanded.has(ck)) continue;
        // The ten most expensive who-worked lines; the rest are on the chat's own page.
        const shown = (c.who ?? []).slice(0, TREE_WHO);
        for (const w of shown) {
          const name = w.main ? tt('stmt.tree.main') : w.who;
          rows.push(line(2, name, tt('stmt.nReplies', { n: num(w.replies) }), w, entries({ chat: c.sessionId, who: w.who }, `${c.title} · ${name}`)));
        }
        if (c.helpers + 1 > shown.length) rows.push(h('tr', { class: 'lvl-2' }, h('td', { colspan: '7' }, link(tt('stmt.tree.moreHelpers', { n: num(c.helpers + 1 - shown.length) }), () => openChat(c.sessionId)))));
      }
    }
    for (const g of p.outside?.groups ?? []) {
      if (!g.count) continue;
      rows.push(line(0, [h('span', { class: 'stmt-toggle-space' }), h('strong', {}, tt(`stmt.spender.${g.id}`))], tt('stmt.nCalls', { n: num(g.count) }),
        { usd: g.usd, usdWrite: 0 }, link(tt('stmt.tree.details'), () => openOutside(g.id))));
    }
    return h('div', { id: 'stmt-centers' },
      h('h4', {}, tt('stmt.tree.title')),
      table([tt('stmt.col.center'), tt('stmt.col.count'), [tt('stmt.col.read'), tt('stmt.tip.read')], [tt('stmt.col.wrote'), tt('stmt.tip.wrote')], tt('stmt.col.cost'), tt('stmt.col.share'), ''],
        rows, [h('strong', {}, tt('stmt.col.total')), '', '', '', h('strong', {}, usd(grand)), pct(1), ''], 'stmt-tree'));
  }

  // The journal: one line per reply, newest first, with what it cost and the running balance of what is shown.
  function journalTable(tt) {
    const base = (x) => x.split(/[\\/]/).pop();
    const desc = (r) => {
      const files = (r.acts ?? []).filter((a) => a.t && ['create', 'edit', 'read'].includes(a.k)).map((a) => (a.k === 'read'
        ? tt('stmt.row.readFile', { file: base(a.t), n: num(a.lines ?? 0) })
        : `${a.k === 'create' ? tt('stmt.row.created') : tt('stmt.row.edited')} ${base(a.t)} (+${num(a.add)}${a.del ? ` −${num(a.del)}` : ''})`));
      return files.length ? files.join(' · ') : r.did || tt('stmt.j.answered', { n: num(r.wroteWords) });
    };
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    return h('div', { id: 'stmt-journal' },
      h('div', { class: 'stmt-rows-head' },
        h('h4', {}, tt('stmt.j.title')),
        journal.title ? h('span', { class: 'stmt-chip' }, tt('stmt.j.filter', { name: clip(journal.title, 60) }),
          h('button', { type: 'button', class: 'stmt-chip-x', 'aria-label': tt('stmt.j.clear'), onclick: () => showEntries({}, '') }, '✕')) : null,
        h('span', { class: 'muted small num' }, tt('stmt.j.count', { shown: num(journal.rows.length), total: num(journal.total), sum: usd(journal.sum) })),
        h('a', { class: 'btn small-btn', href: `/api/statement.csv?${qs({ from: ui.from, to: ui.to, ...journal.filter })}`, download: '' }, tt('stmt.download'))),
      table([tt('stmt.col.date'), tt('stmt.col.center'), tt('stmt.col.desc'), tt('stmt.col.model'), [tt('stmt.col.read'), tt('stmt.tip.read')], [tt('stmt.col.wrote'), tt('stmt.tip.wrote')], tt('stmt.col.debit'), tt('stmt.col.balance')],
        journal.rows.map((r) => h('tr', {},
          cell(h('span', { class: 'num' }, `${short(r.ts)} ${hour(r.ts)}`)),
          cell(h('span', { title: `${r.title} · ${r.who}` }, clip(r.title, 40), h('span', { class: 'stmt-sub' }, r.who === MAIN ? tt('stmt.tree.main') : clip(r.who, 50)))),
          cell(h('span', { title: [r.ask?.text, desc(r), r.readWords ? tt('stmt.row.read', { n: num(r.readWords), what: r.readWhat }) : ''].filter(Boolean).join('\n') }, clip(desc(r), 90))),
          cell(r.model.replace(/^claude-/, ''), 'n'),
          cell(usd(r.usd.input + r.usd.cacheWrite + r.usd.cacheRead, 4), 'n'),
          cell(usd(r.usd.output, 4), 'n'),
          cell(h('strong', {}, usd(r.usd.total, 4)), 'n'),
          cell(usd(r.balance ?? 0), 'n'))), null, 'stmt-journal'),
      journal.rows.length < journal.total ? h('button', { type: 'button', class: 'btn small-btn', onclick: async () => { await loadJournal(true); draw(); } }, tt('stmt.j.more')) : null);
  }

  // The waste signals (or24): what the transcripts say about helpers, workflow runs, long chats and skills, with a
  // one-line warning for each thing past its limit. Counted by the server, no AI.
  function wasteView(tt) {
    const w = period.waste;
    if (!w) return null;
    const T = w.total;
    const name = (x) => x.title || x.chat?.slice(0, 8) || '?';
    const text = (x) => tt(`stmt.waste.warn.${x.kind}`, {
      chat: name(x), run: x.run ? x.run.slice(0, 11) : '', project: x.project || '?', agents: num(x.agents), heavy: num(x.heavy), share: pct(x.share),
      tokens: num(x.tokens), skill: x.name ?? '', usd: usd(x.usd),
    });
    const tile = (label, value, sub, tone = '') => h('div', { class: `stmt-kpi ${tone}` },
      h('span', { class: 'stmt-kpi-label' }, label), h('strong', { class: 'num' }, value), sub ? h('span', { class: 'stmt-kpi-sub num' }, sub) : null);
    const topModel = T.agents.byModel[0];
    const longest = T.chats.longest[0];
    const tiles = h('div', { class: 'stmt-kpis' },
      tile(tt('stmt.waste.agents'), num(T.agents.count), tt('stmt.waste.agentsSub', { usd: usd(T.agents.usd), share: pct(T.agents.share) })),
      tile(tt('stmt.waste.heavy'), pct(T.agents.heavyShare), tt('stmt.waste.heavySub', { usd: pct(T.agents.heavyUsdShare) }), T.agents.heavyShare > 1 / 3 ? 'is-warn' : ''),
      tile(tt('stmt.waste.runs'), num(T.runs.count), tt('stmt.waste.runsSub', { over: num(T.runs.over10), big: num(T.runs.top[0]?.agents ?? 0) }), T.runs.over10 ? 'is-warn' : ''),
      tile(tt('stmt.waste.chats'), pct(T.chats.share), longest ? tt('stmt.waste.chatsSub', { tokens: num(longest.maxContext) }) : null),
      tile(tt('stmt.waste.skills'), new Intl.NumberFormat(lang(), { maximumFractionDigits: 2 }).format(T.skills.perAgent), tt('stmt.waste.skillsSub', { n: num(T.skills.opened), snow: num(T.skills.snowball.length) }), T.skills.snowball.length ? 'is-warn' : ''),
      tile(tt('stmt.waste.first'), num(T.firstTurn.median), tt('stmt.waste.firstSub', { max: num(T.firstTurn.max), read: pct(T.firstTurn.readShare) })));
    const mix = T.agents.byModel.slice(0, 6).map((m) => `${m.model} ${m.effort}: ${num(m.count)} (${pct(m.share)}, ${usd(m.usd)})`).join(' · ');
    const projects = Object.entries(w.byProject).sort((a, b) => b[1].usd - a[1].usd);
    return h('div', { id: 'stmt-waste' },
      h('h4', {}, tt('stmt.waste.title')),
      h('p', { class: 'view-note small' }, tt('stmt.waste.note', { from: date(w.from), to: date(w.to - 1) })),
      w.warnings.length
        ? h('ul', { class: 'stmt-warnings', role: 'list' }, [...w.warnings.slice(0, 12).map((x) => h('li', {}, `⚠ ${text(x)}`)),
          w.warnings.length > 12 ? h('li', {}, tt('stmt.waste.more', { n: num(w.warnings.length - 12) })) : null].filter(Boolean))
        : h('p', { class: 'view-note', role: 'status' }, tt('stmt.waste.none')),
      tiles,
      topModel ? h('p', { class: 'view-note small' }, tt('stmt.waste.mix', { mix })) : null,
      table([tt('stmt.waste.col.project'), tt('stmt.waste.agents'), tt('stmt.waste.heavy'), tt('stmt.waste.runs'), tt('stmt.waste.col.spend')],
        projects.map(([p, f]) => [p || '?', num(f.agents.count), pct(f.agents.heavyShare), num(f.runs.count), usd(f.usd)])));
  }

  function periodView(tt) {
    const grand = period.total.usd + (period.outside?.usd ?? 0);
    return [kpis(tt, grand), dayBars(tt), wasteView(tt), costTree(tt, grand), journalTable(tt)].filter(Boolean);
  }

  // ----- one chat opened: who worked, files, kinds of work, days -----

  function chatView(tt) {
    const b = book;
    const total = b.total.usd;
    const share = (v) => (total > 0 ? v / total : 0);
    const f = b.files;
    const entries = (filter, title) => () => showEntries({ chat: b.sessionId, ...filter }, title, true);
    const what = (x) => [x.created ? tt('stmt.file.created') : null, x.edits ? tt('stmt.file.edited', { n: num(x.edits) }) : null, x.reads ? tt('stmt.file.read', { n: num(x.reads) }) : null].filter(Boolean).join(', ');
    const lines = (x) => (x.add || x.del ? `+${num(x.add)} −${num(x.del)}` : '—');
    const ok = Math.abs(b.check.who - b.check.total) < 0.01 && Math.abs(b.check.kinds - b.check.total) < 0.01;
    const tile = (label, value, sub) => h('div', { class: 'stmt-kpi' }, h('span', { class: 'stmt-kpi-label' }, label), h('strong', { class: 'num' }, value), sub ? h('span', { class: 'stmt-kpi-sub num' }, sub) : null);
    return [
      h('h4', { class: 'stmt-chat-title' }, b.title, h('span', { class: 'stmt-sub' }, b.project)),
      h('div', { class: 'stmt-kpis' },
        tile(tt('stmt.kpi.total'), usd(total), `${short(b.total.first)} – ${short(b.total.last)}`),
        tile(tt('stmt.chat.allTime', { since: short(b.allTime.first) }), usd(b.allTime.usd), tt('stmt.nReplies', { n: num(b.allTime.replies) })),
        tile(tt('stmt.chat.work'), tt('stmt.nReplies', { n: num(b.total.replies) }), tt('stmt.nHelpers', { n: num(b.helpers) })),
        tile(tt('stmt.chat.files'), `+${num(f.add)} −${num(f.del)}`, tt('stmt.kpi.filesSub', { created: num(f.created), edited: num(f.edited) })),
        tile(tt('stmt.chat.reading'), tt('stmt.nLines', { n: num(f.readLines ?? 0) }), tt('stmt.nFiles', { n: num(f.readFiles ?? 0) }))),

      h('h4', {}, tt('stmt.sec.who')),
      table([tt('stmt.col.who'), tt('stmt.col.replies'), [tt('stmt.col.read'), tt('stmt.tip.read')], [tt('stmt.col.wrote'), tt('stmt.tip.wrote')], tt('stmt.col.cost'), tt('stmt.col.share')],
        firstOf('who', b.who).map((w) => [link(w.main ? tt('stmt.tree.main') : w.who, entries({ who: w.who }, w.who)), num(w.replies), usd(readUsd(w)), usd(w.usdWrite), usd(w.usd), pct(share(w.usd))]),
        [h('strong', {}, tt('stmt.col.total')), num(b.total.replies), '', '', h('strong', {}, usd(b.check.who)), pct(1)]),
      showAll('who', b.who, tt),

      h('h4', {}, tt('stmt.sec.files')),
      f.changed.length ? table([tt('stmt.col.file'), tt('stmt.col.did'), tt('stmt.col.lines'), tt('stmt.col.linesRead'), [tt('stmt.col.cost'), tt('stmt.files.note')]],
        firstOf('changed', f.changed).map((x) => [link(x.name, entries({ file: x.file }, x.name)), what(x), lines(x), x.readLines ? num(x.readLines) : '—', usd(x.usd)]))
        : h('p', { class: 'view-note' }, tt('stmt.files.none')),
      showAll('changed', f.changed, tt),
      f.onlyRead.length ? h('details', { class: 'stmt-more' }, h('summary', {}, tt('stmt.files.read', { n: num(f.onlyRead.length), usd: usd(f.readUsd) })),
        table([tt('stmt.col.file'), tt('stmt.col.did'), tt('stmt.col.linesRead'), tt('stmt.col.cost')], firstOf('read', f.onlyRead).map((x) => [link(x.name, entries({ file: x.file }, x.name)), what(x), x.readLines ? num(x.readLines) : '—', usd(x.usd)])),
        showAll('read', f.onlyRead, tt)) : null,

      h('h4', {}, tt('stmt.sec.kinds')),
      table([tt('stmt.col.activity'), tt('stmt.col.times'), [tt('stmt.col.cost'), tt('stmt.kinds.note')], tt('stmt.col.share')],
        b.kinds.map((k) => [link(tt(`stmt.kind.${k.kind}`), entries({ kind: k.kind }, tt(`stmt.kind.${k.kind}`))), num(k.count), usd(k.usd), pct(share(k.usd))]),
        [h('strong', {}, tt('stmt.col.total')), '', h('strong', {}, usd(b.check.kinds)), pct(1)]),

      h('h4', {}, tt('stmt.sec.days')),
      table([tt('stmt.col.day'), tt('stmt.col.replies'), tt('stmt.col.cost'), tt('stmt.col.share')],
        b.byDay.map((d) => [link(dayName(d.day), entries({ day: d.day }, dayName(d.day))), num(d.replies), usd(d.usd), pct(share(d.usd))])),

      h('p', { class: `stmt-check${ok ? ' is-ok' : ''}` }, tt(ok ? 'stmt.check.ok' : 'stmt.check.off', { total: usd(b.check.total), who: usd(b.check.who), kinds: usd(b.check.kinds) })),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: entries({}, tt('stmt.rows.all')) }, tt('stmt.rows.all'))),
    ];
  }

  // ----- session-map's own work and the other AIs, opened -----

  const AI_NAMES = { openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek', claude: 'Claude', openrouter: 'OpenRouter' };
  const aiName = (ai) => ai.replace(/^(\w+)/, (p) => AI_NAMES[p] ?? p);
  const taskName = (tt, kind) => {
    const text = tt(`stmt.task.${kind}`);
    return text === `stmt.task.${kind}` ? tt('stmt.task.unknown', { kind }) : text;
  };

  function outsideView(tt) {
    const g = period.outside?.groups.find((x) => x.id === ui.outsideId) ?? { usd: 0, count: 0, byAi: [], byKind: [] };
    const calls = (period.outside?.calls ?? []).filter((c) => (ui.outsideId === 'auto' ? c.source === 'map' : c.source !== 'map'));
    const share = (v) => (g.usd > 0 ? v / g.usd : 0);
    const result = (c) => [c.ok ? tt('stmt.call.ok') : tt('stmt.call.failed'), c.accepted === true ? tt('stmt.call.accepted') : c.accepted === false ? tt('stmt.call.refused') : null].filter(Boolean).join(' · ');
    const tile = (label, value, sub) => h('div', { class: 'stmt-kpi' }, h('span', { class: 'stmt-kpi-label' }, label), h('strong', { class: 'num' }, value), sub ? h('span', { class: 'stmt-kpi-sub num' }, sub) : null);
    return [
      h('div', { class: 'stmt-kpis' },
        tile(tt('stmt.kpi.total'), usd(g.usd, 4), `${short(period.from)} – ${short(period.to - 1)}`),
        tile(tt('stmt.col.times'), tt('stmt.nCalls', { n: num(g.count) }), g.count ? tt('stmt.kpi.perCall', { usd: usd(g.usd / g.count, 4) }) : null)),
      g.count ? [
        h('h4', {}, tt('stmt.sec.byAi')),
        table([tt('stmt.col.ai'), tt('stmt.col.times'), tt('stmt.col.cost'), tt('stmt.col.share')],
          g.byAi.map((x) => [aiName(x.key), num(x.count), usd(x.usd, 4), pct(share(x.usd))]),
          [h('strong', {}, tt('stmt.col.total')), num(g.count), h('strong', {}, usd(g.usd, 4)), pct(1)]),
        h('h4', {}, tt('stmt.sec.byTask')),
        table([tt('stmt.col.task'), tt('stmt.col.times'), tt('stmt.col.cost'), tt('stmt.col.share')],
          g.byKind.map((x) => [taskName(tt, x.key), num(x.count), usd(x.usd, 4), pct(share(x.usd))])),
        h('h4', {}, tt('stmt.j.title')),
        table([tt('stmt.col.date'), tt('stmt.col.ai'), tt('stmt.col.task'), tt('stmt.col.result'), tt('stmt.col.debit')],
          firstOf('calls', calls).map((c) => [when(c.at), aiName(c.ai), taskName(tt, c.kind), result(c), usd(c.usd, 4)])),
        showAll('calls', calls, tt),
      ] : h('p', { class: 'view-note' }, tt('stmt.none')),
      h('p', { class: 'view-note' }, tt(`stmt.note.${ui.outsideId}`)),
    ].flat();
  }

  function draw() {
    const tt = t();
    const head = h('div', { class: 'stmt-head' }, h('h3', { id: 'stmt-title' }, tt('stmt.title')), periodBar(tt));
    const status = reading
      ? h('p', { class: 'stmt-status', role: 'status' }, reading.of ? tt('stmt.reading', { done: num(reading.done), of: num(reading.of) }) : tt('stmt.starting'),
        reading.of ? h('span', { class: 'br-track', 'aria-hidden': 'true' }, h('span', { style: `width:${((reading.done / reading.of) * 100).toFixed(1)}%` })) : null)
      : null;
    let body;
    if (error) body = [h('p', { class: 'view-note', role: 'status' }, error === 'token-required' || error === 'look-only' ? tt('stmt.private') : errorText(error))];
    else if (!period) body = [h('p', { class: 'stmt-status', role: 'status' }, tt('stmt.starting'))];
    else if (ui.level === 'chat' && book) body = chatView(tt);
    else if (ui.level === 'rows') body = [journalTable(tt)];
    else if (ui.level === 'outside') body = outsideView(tt);
    else body = periodView(tt);
    // replaceChildren writes a null as the text "null": the parts that may be missing are left out first.
    root.replaceChildren(...[head, status, period && !error ? crumbs(tt) : null, ...body,
      h('p', { class: 'view-note small' }, tt('stmt.how', { asOf: period?.pricesAsOf ?? '?' }))].filter(Boolean));
  }

  return {
    // The element to place in the tab; it keeps its place between redraws and asks the server again after a minute.
    el() {
      if (!started) {
        started = true;
        draw();
        loadPeriod();
      } else if (!reading && Date.now() - lastTry > REFRESH_MS) loadPeriod();
      return root;
    },
  };
}
