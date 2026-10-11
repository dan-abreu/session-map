// The spend statement in the Costs tab as guided bookkeeping (sb10, from id98): the period's total first, one line per
// chat; a chat opened shows who worked, the files it created or changed, what the money went on and its days, each
// adding up to the same total; anything opened there shows its replies. The server does the sums
// (statement-route.mjs, ledger.mjs); this section keeps its own element and place, so the tab redrawing keeps them.

const POLL_MS = 1500;
const REFRESH_MS = 60_000;
const PAGE = 100;
const CHATS_FIRST = 20;
const LIST_FIRST = 15;
const DAY = 86_400_000;

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

// deps: h, t (getter), lang (getter), errorText(code).
export function createStatement({ h, t, lang, errorText }) {
  const ui = { preset: '30', ...presetPeriod('30'), level: 'period', chatId: null, rowsFilter: null, rowsTitle: '', allChats: false, open: new Set() };
  let period = null;
  let book = null;
  let rows = [];
  let rowsTotal = 0;
  let reading = null;
  let error = null;
  let started = false;
  let lastTry = 0;
  let pollTimer = 0;
  let run = 0;
  const root = h('section', { class: 'tree-block stmt', id: 'statement', 'aria-labelledby': 'stmt-title' });

  const num = (n) => new Intl.NumberFormat(lang()).format(Math.round(n ?? 0));
  const usd = (n, digits = 2) => new Intl.NumberFormat(lang(), { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n ?? 0);
  const pct = (x) => new Intl.NumberFormat(lang(), { style: 'percent', maximumFractionDigits: 1 }).format(x ?? 0);
  const date = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);
  const when = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
  const dayName = (day) => new Intl.DateTimeFormat(lang(), { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${day}T12:00`));
  const range = () => `from=${ui.from}&to=${ui.to}`;
  const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();

  async function loadPeriod() {
    const mine = ++run;
    lastTry = Date.now();
    const res = await getJson(`/api/statement?${range()}`);
    if (mine !== run) return;
    clearTimeout(pollTimer);
    if (!res.ok) {
      error = res.error;
      draw();
      return;
    }
    error = res.failed && !res.period ? res.failed : null;
    reading = res.reading;
    if (res.period) period = res.period;
    // Asked again only while the server says it is reading, and only while the section is on the page.
    if (reading && root.isConnected !== false) pollTimer = setTimeout(loadPeriod, POLL_MS);
    draw();
  }

  async function openChat(id) {
    const res = await getJson(`/api/statement/chat?${qs({ id, from: ui.from, to: ui.to })}`);
    if (!res.ok) { error = res.error; draw(); return; }
    book = res;
    Object.assign(ui, { level: 'chat', chatId: id, open: new Set() });
    draw();
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function openRows(filter, title, more = false) {
    const offset = more ? rows.length : 0;
    const res = await getJson(`/api/statement/rows?${qs({ from: ui.from, to: ui.to, ...filter, offset, limit: PAGE })}`);
    if (!res.ok) { error = res.error; draw(); return; }
    rows = more ? rows.concat(res.rows) : res.rows;
    rowsTotal = res.total;
    Object.assign(ui, { level: 'rows', rowsFilter: filter, rowsTitle: title });
    draw();
    if (!more) root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function setPeriod(change) {
    Object.assign(ui, change, { level: 'period', chatId: null });
    period = null;
    book = null;
    draw();
    loadPeriod();
  }

  // ----- pieces -----

  const link = (text, onclick) => h('button', { type: 'button', class: 'stmt-link', onclick }, text);
  // A table of money: head, rows (arrays of cells), a total row; a row may open what it is about.
  function table(head, list, totalRow = null) {
    return h('div', { class: 'stmt-table-wrap' }, h('table', { class: 'stmt-table' },
      h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: i ? 'n' : null, scope: 'col' }, c)))),
      h('tbody', {}, list.map((cells) => h('tr', {}, cells.map((c, i) => h('td', { class: i ? 'n' : null }, c))))),
      totalRow ? h('tfoot', {}, h('tr', {}, totalRow.map((c, i) => h('td', { class: i ? 'n' : null }, c)))) : null));
  }
  const bar = (share) => h('span', { class: 'stmt-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.min(100, (share ?? 0) * 100).toFixed(1)}%` }));

  function crumbs(tt) {
    const items = [h('li', {}, ui.level === 'period' ? h('span', { 'aria-current': 'page' }, tt('stmt.crumb.period')) : link(tt('stmt.crumb.period'), () => { ui.level = 'period'; draw(); }))];
    if (ui.level !== 'period' && book && ui.chatId) {
      items.push(h('li', {}, ui.level === 'chat' ? h('span', { 'aria-current': 'page' }, book.title) : link(book.title, () => { ui.level = 'chat'; draw(); })));
    }
    if (ui.level === 'rows') items.push(h('li', {}, h('span', { 'aria-current': 'page' }, ui.rowsTitle)));
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

  function accountBox(tt) {
    const a = period?.account;
    if (!a) return null;
    const stopped = a.disabledReason === 'out_of_credits' ? tt('stmt.account.outOfCredits') : a.disabledReason;
    return h('details', { class: 'stmt-account' },
      h('summary', {}, h('strong', {}, tt('stmt.account.title')), ' — ', tt('stmt.account.short', { amount: a.extraUsed, why: stopped ?? tt('stmt.account.fine') })),
      h('ul', { class: 'plain' },
        h('li', {}, tt('stmt.account.plan', { plan: a.plan })),
        h('li', {}, tt(a.extraEnabled ? 'stmt.account.extraOn' : 'stmt.account.extraOff')),
        h('li', {}, tt('stmt.account.extraUsed', { amount: a.extraUsed })),
        h('li', {}, tt('stmt.account.weekly', { pct: a.weeklyPercent, start: a.weekStart, reset: a.weekReset }))),
      period.events?.length ? h('div', {}, h('h4', {}, tt('stmt.events')),
        h('ul', { class: 'plain' }, period.events.slice(-12).reverse().map((e) => h('li', {}, h('span', { class: 'num' }, when(e.at)), ` — ${e.text}`)))) : null,
      h('p', { class: 'view-note' }, tt('stmt.account.note')));
  }

  // ----- level 1: the period -----

  function periodView(tt) {
    const p = period;
    const t0 = p.total;
    const parts = [
      [tt('stmt.part.read'), t0.usdRead], [tt('stmt.part.keep'), t0.usdKeep], [tt('stmt.part.write'), t0.usdWrite],
      [tt('stmt.part.new'), t0.usdNew], [tt('stmt.part.search'), t0.usdSearch],
    ].filter(([, v]) => v > 0);
    const share = (v) => (t0.usd > 0 ? v / t0.usd : 0);
    const chats = ui.allChats ? p.chats : p.chats.slice(0, CHATS_FIRST);
    return [
      h('p', { class: 'stmt-guide' }, tt('stmt.guide.period')),
      h('div', { class: 'stmt-hero' },
        h('span', {}, tt('stmt.hero', { from: date(p.from), to: date(p.to - 1) })),
        h('strong', { class: 'num' }, usd(t0.usd)),
        h('span', { class: 'muted' }, tt('stmt.heroSub', { replies: num(t0.replies), chats: num(p.chats.length) }))),
      h('h4', {}, tt('stmt.split')),
      table([tt('stmt.col.what'), tt('stmt.col.cost'), tt('stmt.col.share')],
        parts.map(([label, v]) => [label, usd(v), pct(share(v))]),
        [h('strong', {}, tt('stmt.col.total')), h('strong', {}, usd(t0.usd)), pct(1)]),
      h('p', { class: 'view-note' }, tt('stmt.splitNote')),
      h('h4', {}, tt('stmt.byChat')),
      p.chats.length ? table([tt('stmt.col.chat'), tt('stmt.col.days'), tt('stmt.col.helpers'), tt('stmt.col.cost'), tt('stmt.col.share')],
        chats.map((c) => [
          h('span', {}, link(c.title, () => openChat(c.sessionId)), h('span', { class: 'stmt-sub' }, c.project)),
          `${date(c.first)} – ${date(c.last)}`,
          num(c.helpers),
          h('span', {}, usd(c.usd), c.allTimeUsd > c.usd + 0.005 ? h('span', { class: 'stmt-sub' }, tt('stmt.allTime', { usd: usd(c.allTimeUsd) })) : null),
          h('span', { class: 'stmt-share' }, pct(c.share), bar(c.share)),
        ]),
        [h('strong', {}, tt('stmt.col.total')), '', '', h('strong', {}, usd(t0.usd)), pct(1)])
        : h('p', { class: 'view-note' }, tt('stmt.none')),
      p.chats.length > CHATS_FIRST ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => { ui.allChats = !ui.allChats; draw(); } },
        ui.allChats ? tt('stmt.fewerChats') : tt('stmt.allChats', { n: num(p.chats.length) })) : null,
      h('details', { class: 'stmt-more' }, h('summary', {}, tt('stmt.byDay')),
        table([tt('stmt.col.day'), tt('stmt.col.replies'), tt('stmt.col.cost'), tt('stmt.col.share')],
          p.byDay.map((d) => [link(dayName(d.day), () => openRows({ day: d.day }, tt('stmt.rows.day', { day: dayName(d.day) }))), num(d.replies), usd(d.usd), pct(d.share)]))),
      h('details', { class: 'stmt-more' }, h('summary', {}, tt('stmt.byProject')),
        table([tt('stmt.col.project'), tt('stmt.col.replies'), tt('stmt.col.cost'), tt('stmt.col.share')], p.byProject.map((x) => [x.name, num(x.replies), usd(x.usd), pct(x.share)]))),
      h('details', { class: 'stmt-more' }, h('summary', {}, tt('stmt.byModel')),
        table([tt('stmt.col.model'), tt('stmt.col.replies'), tt('stmt.col.cost'), tt('stmt.col.share')], p.byModel.map((x) => [x.model, num(x.replies), usd(x.usd), pct(x.share)]))),
      accountBox(tt),
    ];
  }

  // ----- level 2: one chat -----

  // A chat with hundreds of helpers or files shows the most expensive first; the rest one click away.
  const firstOf = (key, list) => (ui.open.has(key) ? list : list.slice(0, LIST_FIRST));
  const showAll = (key, list, tt) => (list.length > LIST_FIRST ? h('button', {
    type: 'button', class: 'btn small-btn', onclick: () => { if (ui.open.has(key)) ui.open.delete(key); else ui.open.add(key); draw(); },
  }, ui.open.has(key) ? tt('stmt.showFewer') : tt('stmt.showAll', { n: num(list.length) })) : null);

  function chatView(tt) {
    const b = book;
    const total = b.total.usd;
    const share = (v) => (total > 0 ? v / total : 0);
    const f = b.files;
    const chatRows = (filter, title) => () => openRows({ chat: b.sessionId, ...filter }, title);
    const what = (x) => [x.created ? tt('stmt.file.created') : null, x.edits ? tt('stmt.file.edited', { n: num(x.edits) }) : null, x.reads ? tt('stmt.file.read', { n: num(x.reads) }) : null].filter(Boolean).join(', ');
    const lines = (x) => (x.add || x.del ? `+${num(x.add)} −${num(x.del)}` : '—');
    const ok = Math.abs(b.check.who - b.check.total) < 0.01 && Math.abs(b.check.kinds - b.check.total) < 0.01;
    return [
      h('p', { class: 'stmt-guide' }, tt('stmt.guide.chat')),
      h('h4', { class: 'stmt-chat-title' }, b.title, h('span', { class: 'stmt-sub' }, b.project)),
      h('dl', { class: 'ledger stmt-ledger' },
        h('div', {}, h('dt', {}, tt('stmt.chat.period', { from: date(b.from), to: date(b.to - 1) })), h('dd', { class: 'num strong' }, usd(total))),
        h('div', {}, h('dt', {}, tt('stmt.chat.allTime', { since: date(b.allTime.first) })), h('dd', { class: 'num' }, usd(b.allTime.usd))),
        h('div', {}, h('dt', {}, tt('stmt.chat.when')), h('dd', { class: 'num' }, `${when(b.total.first)} – ${when(b.total.last)}`)),
        h('div', {}, h('dt', {}, tt('stmt.chat.work')), h('dd', { class: 'num' }, tt('stmt.chat.workValue', { replies: num(b.total.replies), helpers: num(b.helpers) }))),
        h('div', {}, h('dt', {}, tt('stmt.chat.files')), h('dd', { class: 'num' }, tt('stmt.chat.filesValue', { created: num(f.created), edited: num(f.edited), add: num(f.add), del: num(f.del) })))),

      h('h4', {}, tt('stmt.sec.who')),
      table([tt('stmt.col.who'), tt('stmt.col.replies'), tt('stmt.col.read'), tt('stmt.col.wrote'), tt('stmt.col.cost'), tt('stmt.col.share')],
        firstOf('who', b.who).map((w) => [link(w.who, chatRows({ who: w.who }, w.who)), num(w.replies), usd(w.usdRead + w.usdKeep + w.usdNew), usd(w.usdWrite), usd(w.usd), pct(share(w.usd))]),
        [h('strong', {}, tt('stmt.col.total')), num(b.total.replies), '', '', h('strong', {}, usd(b.check.who)), pct(1)]),
      showAll('who', b.who, tt),

      h('h4', {}, tt('stmt.sec.files')),
      f.changed.length ? table([tt('stmt.col.file'), tt('stmt.col.did'), tt('stmt.col.lines'), tt('stmt.col.cost')],
        firstOf('changed', f.changed).map((x) => [link(x.name, chatRows({ file: x.file }, x.name)), what(x), lines(x), usd(x.usd)]))
        : h('p', { class: 'view-note' }, tt('stmt.files.none')),
      showAll('changed', f.changed, tt),
      f.onlyRead.length ? h('details', { class: 'stmt-more' }, h('summary', {}, tt('stmt.files.read', { n: num(f.onlyRead.length), usd: usd(f.readUsd) })),
        table([tt('stmt.col.file'), tt('stmt.col.did'), tt('stmt.col.cost')], firstOf('read', f.onlyRead).map((x) => [link(x.name, chatRows({ file: x.file }, x.name)), what(x), usd(x.usd)])),
        showAll('read', f.onlyRead, tt)) : null,
      h('p', { class: 'view-note' }, tt('stmt.files.note')),

      h('h4', {}, tt('stmt.sec.kinds')),
      table([tt('stmt.col.activity'), tt('stmt.col.times'), tt('stmt.col.cost'), tt('stmt.col.share')],
        b.kinds.map((k) => [link(tt(`stmt.kind.${k.kind}`), chatRows({ kind: k.kind }, tt(`stmt.kind.${k.kind}`))), num(k.count), usd(k.usd), pct(share(k.usd))]),
        [h('strong', {}, tt('stmt.col.total')), '', h('strong', {}, usd(b.check.kinds)), pct(1)]),
      h('p', { class: 'view-note' }, tt('stmt.kinds.note')),

      h('h4', {}, tt('stmt.sec.days')),
      table([tt('stmt.col.day'), tt('stmt.col.replies'), tt('stmt.col.cost'), tt('stmt.col.share')],
        b.byDay.map((d) => [link(dayName(d.day), chatRows({ day: d.day }, dayName(d.day))), num(d.replies), usd(d.usd), pct(share(d.usd))])),

      h('p', { class: `stmt-check${ok ? ' is-ok' : ''}` }, tt(ok ? 'stmt.check.ok' : 'stmt.check.off', { total: usd(b.check.total), who: usd(b.check.who), kinds: usd(b.check.kinds) })),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: chatRows({}, tt('stmt.rows.all')) }, tt('stmt.rows.all'))),
    ];
  }

  // ----- level 3: the replies -----

  function rowsView(tt) {
    const files = (r) => (r.acts ?? []).filter((a) => a.t && (a.k === 'create' || a.k === 'edit'))
      .map((a) => `${a.k === 'create' ? tt('stmt.row.created') : tt('stmt.row.edited')} ${a.t.split(/[\\/]/).pop()} (+${num(a.add)}${a.del ? ` −${num(a.del)}` : ''})`).join(' · ');
    return [
      h('p', { class: 'stmt-guide' }, tt('stmt.guide.rows')),
      h('div', { class: 'stmt-rows-head' },
        h('span', { class: 'muted num' }, tt('stmt.count', { shown: num(rows.length), total: num(rowsTotal) })),
        h('a', { class: 'btn small-btn', href: `/api/statement.csv?${qs({ from: ui.from, to: ui.to, ...ui.rowsFilter })}`, download: '' }, tt('stmt.download'))),
      h('ol', { class: 'plain rows stmt-rows' }, rows.map((r) => h('li', { class: 'stmt-row' },
        h('div', { class: 'stmt-row-head' },
          h('span', { class: 'num' }, when(r.ts)),
          h('span', { class: 'stmt-row-title' }, `${r.who} · ${r.model}`),
          h('strong', { class: 'num' }, usd(r.usd.total, 4))),
        h('div', { class: 'stmt-row-money num small' },
          tt('stmt.row.in', { usd: usd(r.usd.input + r.usd.cacheWrite + r.usd.cacheRead, 4), n: num(r.input + r.cacheWrite + r.cacheRead) }), ' · ',
          tt('stmt.row.out', { usd: usd(r.usd.output, 4), n: num(r.output) })),
        // The chat itself was asked by the person; a helper was handed its task by the chat or its team.
        r.ask ? h('div', { class: 'small' }, tt(r.who === 'conversa principal' ? 'stmt.row.ask' : 'stmt.row.task', { text: r.ask.text })) : null,
        r.readWords ? h('div', { class: 'small' }, tt('stmt.row.read', { n: num(r.readWords), what: r.readWhat })) : null,
        files(r) ? h('div', { class: 'small strong' }, files(r)) : null,
        h('div', { class: 'small muted' }, r.did ? tt('stmt.row.did', { what: r.did }) : tt('stmt.row.wrote', { n: num(r.wroteWords) }))))),
      rows.length < rowsTotal ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => openRows(ui.rowsFilter, ui.rowsTitle, true) }, tt('stmt.more')) : null,
    ];
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
    else if (ui.level === 'rows') body = rowsView(tt);
    else body = periodView(tt);
    // replaceChildren writes a null as the text "null": the parts that may be missing are left out first.
    root.replaceChildren(...[head, status, period && !error ? crumbs(tt) : null, ...body, h('p', { class: 'view-note' }, tt('stmt.how', { asOf: period?.pricesAsOf ?? '?' }))].filter(Boolean));
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
