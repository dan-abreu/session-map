// The spend statement in the Costs tab (sb09, from id98): every reply of every chat and agent, with what it read and
// did and what it cost, at Anthropic's list prices. The server builds it in the background (statement-route.mjs); this
// section keeps its own element, filters and pages, so the tab redrawing on every state does not lose them.

const PAGE = 100;
const POLL_MS = 1500;
const REFRESH_MS = 60_000;

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

// deps: h, t (getter), lang (getter), errorText(code).
export function createStatement({ h, t, lang, errorText }) {
  const ui = { days: 30, day: '', chat: '', who: '', q: '', showAllChats: false };
  let summary = null;
  let reading = null;
  let error = null;
  let rows = [];
  let rowsTotal = 0;
  let rowsError = null;
  let pollTimer = 0;
  let qTimer = 0;
  let run = 0;
  let started = false;
  let lastTry = 0;
  const root = h('section', { class: 'tree-block stmt', id: 'statement', 'aria-labelledby': 'stmt-title' });

  const num = (n) => new Intl.NumberFormat(lang()).format(Math.round(n ?? 0));
  const usd = (n, digits = 2) => new Intl.NumberFormat(lang(), { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n ?? 0);
  const when = (ms) => new Intl.DateTimeFormat(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ms);
  const dayName = (day) => new Intl.DateTimeFormat(lang(), { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${day}T12:00`));
  const inUsd = (b) => (b.usdInput ?? 0) + (b.usdCacheWrite ?? 0) + (b.usdCacheRead ?? 0);
  const inTokens = (b) => (b.input ?? 0) + (b.cacheWrite ?? 0) + (b.cacheRead ?? 0);
  const query = (extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries({ days: String(ui.days), day: ui.day, chat: ui.chat, who: ui.who, q: ui.q, ...extra }).filter(([, v]) => v !== ''))).toString();

  async function load() {
    const mine = ++run;
    lastTry = Date.now();
    const res = await getJson(`/api/statement?days=${ui.days}`);
    if (mine !== run) return;
    clearTimeout(pollTimer);
    if (!res.ok) {
      error = res.error;
      draw();
      return;
    }
    error = res.failed && !res.summary ? res.failed : null;
    reading = res.reading;
    const fresh = res.summary && res.builtAt !== summary?.builtAt;
    if (res.summary) {
      summary = { ...res.summary, builtAt: res.builtAt };
    }
    // Asked again only while the server says it is reading, and only while the section is on the page.
    if (reading && root.isConnected !== false) pollTimer = setTimeout(load, POLL_MS);
    if (fresh) await loadRows(true);
    draw();
  }

  async function loadRows(reset) {
    const offset = reset ? 0 : rows.length;
    const res = await getJson(`/api/statement/rows?${query({ offset: String(offset), limit: String(PAGE) })}`);
    if (!res.ok) {
      rowsError = res.error === 'statement-reading' ? null : res.error;
      if (reset) rows = [];
      return;
    }
    rowsError = null;
    rows = reset ? res.rows : rows.concat(res.rows);
    rowsTotal = res.total;
  }

  async function setFilter(change) {
    Object.assign(ui, change);
    await loadRows(true);
    draw();
    root.querySelector('#stmt-lines')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function accountBox(tt) {
    const a = summary?.account;
    if (!a) return null;
    const stopped = a.disabledReason === 'out_of_credits' ? tt('stmt.account.outOfCredits') : a.disabledReason;
    return h('div', { class: 'stmt-account' },
      h('h4', {}, tt('stmt.account.title')),
      h('ul', { class: 'plain' },
        h('li', {}, tt('stmt.account.plan', { plan: a.plan })),
        h('li', {}, tt(a.extraEnabled ? 'stmt.account.extraOn' : 'stmt.account.extraOff'), stopped ? h('strong', {}, ` ${tt('stmt.account.why', { why: stopped })}`) : null),
        h('li', {}, h('strong', {}, tt('stmt.account.extraUsed', { amount: a.extraUsed }))),
        h('li', {}, tt('stmt.account.weekly', { pct: a.weeklyPercent, start: a.weekStart, reset: a.weekReset }))),
      summary.events?.length ? h('div', {}, h('h4', {}, tt('stmt.events')),
        h('ul', { class: 'plain' }, summary.events.slice(-12).reverse().map((e) => h('li', {}, h('span', { class: 'num' }, when(e.at)), ` — ${e.text}`)))) : null,
      h('p', { class: 'view-note' }, tt('stmt.account.note')));
  }

  function totals(tt) {
    const b = summary.total;
    const cell = (label, tokens, money, note) => h('div', { class: 'stmt-cell' },
      h('span', { class: 'stmt-cell-label' }, label), h('strong', { class: 'num' }, money), h('span', { class: 'num muted' }, tokens), note ? h('span', { class: 'muted small' }, note) : null);
    return h('div', {},
      h('p', { class: 'stmt-total' }, h('span', {}, tt('stmt.total', { days: ui.days })), h('strong', { class: 'num' }, usd(b.usd))),
      h('p', { class: 'view-note' }, tt('stmt.totalNote', { replies: num(b.replies), chats: num(summary.chats.length) })),
      h('div', { class: 'stmt-cells' },
        cell(tt('stmt.input'), tt('stmt.tokens', { n: num(b.input) }), usd(b.usdInput), tt('stmt.inputNote')),
        cell(tt('stmt.cacheWrite'), tt('stmt.tokens', { n: num(b.cacheWrite) }), usd(b.usdCacheWrite), tt('stmt.cacheWriteNote')),
        cell(tt('stmt.cacheRead'), tt('stmt.tokens', { n: num(b.cacheRead) }), usd(b.usdCacheRead), tt('stmt.cacheReadNote')),
        cell(tt('stmt.output'), tt('stmt.tokens', { n: num(b.output) }), usd(b.usdOutput), tt('stmt.outputNote', { n: num(b.thinking) })),
        cell(tt('stmt.search'), tt('stmt.searches', { n: num(b.webSearch) }), usd(b.usdWebSearch))));
  }

  function bars(list, label, onPick, tt) {
    const max = Math.max(1e-9, ...list.map((x) => x.usd));
    return h('ul', { class: 'plain rows bars' }, list.map((x) => h('li', { class: 'bar-row' },
      onPick ? h('button', { type: 'button', class: 'br-name stmt-pick', onclick: () => onPick(x) }, label(x)) : h('span', { class: 'br-name' }, label(x)),
      h('span', { class: 'br-value num' }, usd(x.usd)),
      h('span', { class: 'br-track', 'aria-hidden': 'true' }, h('span', { style: `width:${((x.usd / max) * 100).toFixed(1)}%` })),
      h('span', { class: 'br-sub num' }, tt('stmt.barSub', { input: usd(inUsd(x)), output: usd(x.usdOutput), replies: num(x.replies) })))));
  }

  function chats(tt) {
    const list = ui.showAllChats ? summary.chats : summary.chats.slice(0, 15);
    return h('div', {},
      h('h4', {}, tt('stmt.byChat')),
      h('p', { class: 'view-note' }, tt('stmt.byChatNote')),
      h('ol', { class: 'plain rows stmt-chats' }, list.map((c) => h('li', {}, h('details', {},
        h('summary', {}, h('span', { class: 'lr-title' }, c.title), h('span', { class: 'num strong' }, ` ${usd(c.usd)}`),
          h('span', { class: 'lr-line' }, tt('stmt.chatLine', { project: c.project, replies: num(c.replies), agents: num(c.agents.length), from: when(c.first), to: when(c.last) }))),
        h('ul', { class: 'plain rows' }, c.agents.map((a) => h('li', { class: 'bar-row' },
          h('button', { type: 'button', class: 'br-name stmt-pick', onclick: () => setFilter({ day: '', chat: c.sessionId, who: a.who }) }, a.who),
          h('span', { class: 'br-value num' }, usd(a.usd)),
          h('span', { class: 'br-sub num' }, tt('stmt.agentLine', { replies: num(a.replies), inTokens: num(inTokens(a)), input: usd(inUsd(a)), outTokens: num(a.output), output: usd(a.usdOutput) }))))),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => setFilter({ day: '', chat: c.sessionId, who: '' }) }, tt('stmt.seeLines')))))),
      summary.chats.length > 15 ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => { ui.showAllChats = !ui.showAllChats; draw(); } },
        ui.showAllChats ? tt('stmt.fewerChats') : tt('stmt.allChats', { n: num(summary.chats.length) })) : null);
  }

  function select(label, value, options, onChange) {
    const box = h('select', { onchange: (e) => onChange(e.target.value) }, options.map(([v, text]) => h('option', { value: v }, text)));
    box.value = value;
    return h('label', { class: 'stmt-filter' }, h('span', {}, label), box);
  }

  function lines(tt) {
    const chat = summary.chats.find((c) => c.sessionId === ui.chat);
    const search = h('input', { type: 'search', value: ui.q, placeholder: tt('stmt.searchPlaceholder'), 'aria-label': tt('stmt.searchLabel') });
    search.oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => setFilter({ q: search.value }), 300); };
    const filtered = ui.day || ui.chat || ui.who || ui.q;
    return h('div', { id: 'stmt-lines' },
      h('h4', {}, tt('stmt.lines')),
      h('p', { class: 'view-note' }, tt('stmt.linesNote')),
      h('div', { class: 'stmt-filters' },
        select(tt('stmt.filterDay'), ui.day, [['', tt('stmt.allDays')], ...summary.byDay.map((d) => [d.day, `${dayName(d.day)} · ${usd(d.usd)}`])], (v) => setFilter({ day: v })),
        select(tt('stmt.filterChat'), ui.chat, [['', tt('stmt.allChatsOption')], ...summary.chats.map((c) => [c.sessionId, `${c.title.slice(0, 60)} · ${usd(c.usd)}`])], (v) => setFilter({ chat: v, who: '' })),
        chat ? select(tt('stmt.filterWho'), ui.who, [['', tt('stmt.everyone')], ...chat.agents.map((a) => [a.who, `${a.who.slice(0, 60)} · ${usd(a.usd)}`])], (v) => setFilter({ who: v })) : null,
        search,
        filtered ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => setFilter({ day: '', chat: '', who: '', q: '' }) }, tt('stmt.clear')) : null,
        h('a', { class: 'btn small-btn', href: `/api/statement.csv?${query()}`, download: '' }, tt('stmt.download'))),
      rowsError ? h('p', { class: 'view-note' }, errorText(rowsError)) : null,
      h('p', { class: 'muted small num' }, tt('stmt.count', { shown: num(rows.length), total: num(rowsTotal) })),
      h('ol', { class: 'plain rows stmt-rows' }, rows.map((r) => h('li', { class: 'stmt-row' },
        h('div', { class: 'stmt-row-head' },
          h('span', { class: 'num' }, when(r.ts)),
          h('span', { class: 'stmt-row-title' }, r.title),
          h('strong', { class: 'num' }, usd(r.usd.total, 4))),
        h('div', { class: 'stmt-row-who muted small' }, [r.who, r.model, r.effort ? tt('stmt.effort', { e: r.effort }) : null, r.speed === 'fast' ? tt('stmt.fast') : null, r.priced ? null : tt('stmt.unpriced')].filter(Boolean).join(' · ')),
        h('div', { class: 'stmt-row-money num small' },
          tt('stmt.rowIn', { tokens: num(r.input + r.cacheWrite + r.cacheRead), usd: usd(r.usd.input + r.usd.cacheWrite + r.usd.cacheRead, 4), read: num(r.cacheRead), readUsd: usd(r.usd.cacheRead, 4) }),
          ' · ',
          tt('stmt.rowOut', { tokens: num(r.output), usd: usd(r.usd.output, 4), thinking: num(r.thinking) })),
        r.ask ? h('div', { class: 'small' }, tt('stmt.rowAsk', { n: num(r.ask.words), text: r.ask.text })) : null,
        r.readWords ? h('div', { class: 'small' }, tt('stmt.rowRead', { n: num(r.readWords), what: r.readWhat })) : null,
        h('div', { class: 'small' }, r.did ? tt('stmt.rowDid', { what: r.did }) : tt('stmt.rowWrote', { n: num(r.wroteWords) }))))),
      rows.length < rowsTotal ? h('button', { type: 'button', class: 'btn small-btn', onclick: async () => { await loadRows(false); draw(); } }, tt('stmt.more')) : null);
  }

  function draw() {
    const tt = t();
    const head = h('div', { class: 'stmt-head' },
      h('h3', { id: 'stmt-title' }, tt('stmt.title')),
      select(tt('stmt.period'), String(ui.days), [['1', tt('stmt.days1')], ['7', tt('stmt.days7')], ['30', tt('stmt.days30')], ['90', tt('stmt.days90')]],
        (v) => { ui.days = Number(v); ui.day = ''; summary = null; rows = []; rowsTotal = 0; draw(); load(); }));
    const lede = h('p', { class: 'view-note' }, tt('stmt.lede'));
    const status = reading
      ? h('p', { class: 'stmt-status', role: 'status' }, reading.of ? tt('stmt.reading', { done: num(reading.done), of: num(reading.of) }) : tt('stmt.starting'),
        reading.of ? h('span', { class: 'br-track', 'aria-hidden': 'true' }, h('span', { style: `width:${((reading.done / reading.of) * 100).toFixed(1)}%` })) : null)
      : null;
    if (error) {
      root.replaceChildren(head, lede, h('p', { class: 'view-note', role: 'status' }, error === 'token-required' || error === 'look-only' ? tt('stmt.private') : errorText(error)));
      return;
    }
    if (!summary) {
      root.replaceChildren(head, lede, status ?? h('p', { class: 'stmt-status', role: 'status' }, tt('stmt.starting')));
      return;
    }
    root.replaceChildren(head, lede, status, accountBox(tt), totals(tt),
      h('h4', {}, tt('stmt.byDay')), bars(summary.byDay, (d) => dayName(d.day), (d) => setFilter({ day: d.day, chat: '', who: '' }), tt),
      summary.byHour.length ? h('details', {}, h('summary', {}, tt('stmt.byHour')), bars(summary.byHour, (x) => x.hour.split(' ').map((p, i) => (i === 0 ? dayName(p) : p)).join(' '), null, tt)) : null,
      h('h4', {}, tt('stmt.byProject')), bars(summary.byProject, (x) => x.name, null, tt),
      h('h4', {}, tt('stmt.byModel')), bars(summary.byModel, (x) => x.model, null, tt),
      chats(tt), lines(tt),
      h('p', { class: 'view-note' }, tt('stmt.how', { asOf: summary.pricesAsOf ?? '?' })));
  }

  return {
    // The element to place in the tab; it keeps its content between redraws and asks the server again after a minute.
    el() {
      if (!started) {
        started = true;
        draw();
        load();
      } else if (!reading && Date.now() - lastTry > REFRESH_MS) load();
      return root;
    },
  };
}
