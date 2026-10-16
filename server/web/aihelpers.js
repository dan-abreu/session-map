// The "Other AIs" dialog (or14): the owner pastes keys, switches an AI on or off and sets ONE daily limit for all of
// them; session-map picks which AI does which task, and may use several at once.
// The pure part on top is what the Costs tab and node:test use; the DOM part only runs when the page calls it.

const PROVIDER_NAMES = { claude: 'Claude', openrouter: 'OpenRouter', deepseek: 'DeepSeek', gemini: 'Google Gemini', openai: 'OpenAI (GPT)' };
export const providerName = (id) => PROVIDER_NAMES[id] ?? String(id);

// Spend is a few thousandths of a dollar: two decimals would show $0.00 all day.
export function usdText(usd, lang = 'en') {
  const n = Number.isFinite(usd) ? usd : 0;
  return new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 }).format(n);
}

// What the Costs tab lists, one row per AI that asked something today, plus every outside AI that is on and ready.
// Both pieces are machine-wide and every project repeats them, so the first project that has them speaks for all:
// they must never be added up across projects.
export function providerSpend(state) {
  const host = (state?.projects ?? []).find((p) => p.ai?.spentByProviderToday);
  if (!host) return { rows: [], others: null };
  const spent = host.ai.spentByProviderToday;
  const others = host.ai.others ?? null;
  const mine = new Map((others?.providers ?? []).map((p) => [p.id, p]));
  const ready = (p) => Boolean(others?.enabled && p.hasKey && p.on);
  const ids = ['claude', ...[...mine.values()].filter((p) => (spent[p.id] ?? 0) > 0 || ready(p)).map((p) => p.id)];
  for (const id of Object.keys(spent)) if (spent[id] > 0 && !ids.includes(id)) ids.push(id);
  return { rows: ids.map((id) => ({ id, name: providerName(id), usd: spent[id] ?? 0, other: mine.get(id) ?? null })), others };
}

const ERROR_CODES = new Set(['no-key', 'http-400', 'http-401', 'http-402', 'http-403', 'http-404', 'http-429', 'timeout', 'network', 'bad-output', 'no-json', 'too-many-tests', 'invalid-key', 'unknown-provider', 'bad-helpers', 'encrypt-failed', 'config-unreadable', 'cap-reached', 'unknown-project', 'bad-project-class']);
// Both mean "they did not accept the request": usually a wrong model name or a malformed key.
const SAME_AS = { 'http-422': 'http-400' };

// A code from a provider (or from the server about one) in plain words; null leaves it to the page's generic error.
export function whyKey(code, status) {
  if (code === 'network' && status === 0) return null;
  const known = SAME_AS[code] ?? code;
  if (ERROR_CODES.has(known)) return `aih.err.${known}`;
  if (/^http-5\d\d$/.test(String(code))) return 'aih.err.http-5xx';
  return null;
}

// ---- what the other AIs did, and how private each project is (pure) -------------------------------------------

export const PROJECT_CLASS_ORDER = Object.freeze(['client', 'internal', 'public']);
const ACTIVITY_KINDS = new Set(['review', 'bulk', 'code', 'read', 'portuguese', 'reasoning', 'place']);

// A folder written the way the server writes it (server/paths.mjs normalizePath), so a project's saved class is found
// by its root: slashes forward, no trailing one. The server's rule (pathRule, from its settings answer) decides the rest:
// a Windows server reads /c/x as c:/x and ignores case; any other keeps both and lowers only a drive-letter path.
// No rule given: the Windows one. (Windows short names are the server's own.)
export function normalizeRoot(p, rule = 'windows') {
  const windows = rule !== 'posix';
  let out = String(p ?? '').replaceAll('\\', '/');
  if (windows) out = out.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
  out = out.replace(/\/+$/, '') || '/';
  if (/^[a-z]:$/i.test(out)) out += '/';
  return windows || /^[a-z]:\//i.test(out) ? out.toLowerCase() : out;
}

// The class of a project: what the owner chose for its folder, otherwise the strictest. The lookup follows the server's
// folder rule (case ignored on a Windows server).
export function projectClassFor(classes, root, rule) {
  const want = normalizeRoot(root, rule);
  for (const [key, value] of Object.entries(classes ?? {})) {
    if (normalizeRoot(key, rule) === want) return PROJECT_CLASS_ORDER.includes(value) ? value : 'client';
  }
  return 'client';
}

// waiting: Claude has not said yet whether it used the work. routine: the map's own sorting, which Claude re-checks by
// sampling and never reports one by one.
export function activityStatus(it) {
  if (it?.ok !== true) return 'failed';
  if (it.result) return it.result.accepted === true ? 'accepted' : 'refused';
  return it.source === 'map' ? 'routine' : 'waiting';
}

export function activityRows(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object' && typeof it.id === 'string').map((it) => {
    const picked = typeof it.recommendedBy === 'string' ? it.recommendedBy : '';
    const verdict = typeof it.result?.why === 'string' ? it.result.why : '';
    return {
      id: it.id,
      at: it.at,
      source: it.source === 'map' ? 'map' : 'chat',
      kind: ACTIVITY_KINDS.has(it.kind) ? it.kind : 'other',
      sensitivity: ['public', 'internal', 'client'].includes(it.sensitivity) ? it.sensitivity : 'client',
      provider: String(it.provider ?? ''),
      model: String(it.model ?? ''),
      costUSD: Number(it.costUSD) || 0,
      ok: it.ok === true,
      error: typeof it.error === 'string' ? it.error : null,
      status: activityStatus(it),
      pickedBecause: picked,
      verdict,
      reason: verdict || picked,
    };
  });
}

// "5 minutes ago" for the last day, a short date after that. '' when the date cannot be read.
export function whenText(iso, lang = 'en', now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.round((now - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(0, 'second');
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
}

// ---- the versions line of each AI (pure) -----------------------------------------------------------------------

const VERSION_ORDER = { gone: 0, retiring: 1, new: 2 };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// One AI's entry of the version watch (GET /api/settings/ai-helpers' versions) -> what its line says, or null when it was
// never checked (or the server is older). Warnings come gone first; a name or a date that is not plain is left out.
export function versionLine(v) {
  if (!v || typeof v !== 'object') return null;
  const day = String(v.checkedAt ?? '').slice(0, 10);
  if (!DAY_RE.test(day)) return null;
  const notes = (Array.isArray(v.notes) ? v.notes : []).filter((n) => n && Object.hasOwn(VERSION_ORDER, n.type) && NAME_RE.test(String(n.model))
    && (n.type !== 'retiring' || DAY_RE.test(String(n.date))))
    .map((n) => ({ type: n.type, model: n.model, ...(n.type === 'retiring' ? { date: n.date } : {}) }))
    .sort((a, b) => VERSION_ORDER[a.type] - VERSION_ORDER[b.type]);
  if (notes.length) return { state: 'warn', day, notes };
  if (v.ok === false) return { state: 'failed', day, error: typeof v.error === 'string' ? v.error : '', notes: [] };
  return { state: 'ok', day, notes: [] };
}

// ---- the panel: the AIs measured by real use (pure) ------------------------------------------------------------

export const pctText = (x, lang = 'en') => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(Number.isFinite(x) ? x : 0);

export function secondsText(ms, lang = 'en') {
  const s = (Number(ms) || 0) / 1000;
  return `${new Intl.NumberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: s < 10 ? 1 : 0 }).format(s)} s`;
}

// usage: the body of GET /api/ai/usage. keyProviders: the providers that have a key. -> what the panel shows, or null
// when no key exists (nothing to measure). One card per AI that worked, plus one per provider with a key that did not.
export function panelModel(usage, keyProviders = []) {
  if (!keyProviders.length) return null;
  const ok = usage?.ok === true;
  const cards = (ok && Array.isArray(usage.byAi) ? usage.byAi : []).filter((a) => a && typeof a.provider === 'string' && a.provider !== 'claude').map((a) => ({
    provider: a.provider,
    model: String(a.model ?? ''),
    calls: Number(a.calls) || 0,
    failed: Number(a.failed) || 0,
    waiting: Number(a.waiting) || 0,
    acceptRate: Number.isFinite(a.acceptRate) ? a.acceptRate : null,
    costPerAcceptedUSD: Number.isFinite(a.costPerAcceptedUSD) ? a.costPerAcceptedUSD : null,
    avgMs: Number(a.avgMs) || 0,
    bench: (Array.isArray(a.bench) ? a.bench : []).filter((b) => Number.isFinite(b?.accuracy)),
    mapReview: a.mapReview && a.mapReview.reviewed > 0 ? { reviewed: a.mapReview.reviewed, agreed: a.mapReview.agreed } : null,
  }));
  const seen = new Set(cards.map((c) => c.provider));
  for (const p of keyProviders) {
    if (!seen.has(p)) cards.push({ provider: p, model: '', calls: 0, failed: 0, waiting: 0, acceptRate: null, costPerAcceptedUSD: null, avgMs: 0, bench: [], mapReview: null });
  }
  const days = ok && Array.isArray(usage.days) ? usage.days : [];
  const series = [...new Set(days.flatMap((d) => Object.keys(d.byProvider ?? {})))].filter((p) => days.some((d) => d.byProvider[p] > 0));
  const bars = days.map((d) => ({ day: d.day, parts: series.map((p, i) => ({ provider: p, slot: i % 5, usd: Number(d.byProvider?.[p]) || 0 })).filter((x) => x.usd > 0), total: series.reduce((n, p) => n + (Number(d.byProvider?.[p]) || 0), 0) }));
  return {
    ok,
    capUSD: Number(usage?.cap?.dailyUSD) || 0,
    spentUSD: Number(usage?.cap?.spentTodayUSD) || 0,
    cards,
    series,
    bars,
    maxDayUSD: Math.max(0, ...bars.map((b) => b.total)),
    totalUSD: bars.reduce((n, b) => n + b.total, 0),
  };
}

// ---- the page --------------------------------------------------------------------------------------------------

// ctx: dialog, h, t() (translator getter), lang(), api, toast, errorText, opener (optional buttons that open it).
export function createAiHelpers(ctx) {
  const { dialog, h, api } = ctx;
  let data = null;
  let canEdit = true;
  let draft = { dailyUSD: '' };
  let notes = {};
  let activity = { ok: true, items: [] };
  let usage = null;

  const tt = () => ctx.t();
  const why = (res) => {
    const key = whyKey(res.error, res.status);
    return key ? tt()(key) : ctx.errorText(res.error);
  };
  const keyOf = (id) => data?.keys?.find((k) => k.provider === id) ?? null;
  const stateOf = (id) => data?.status?.others?.providers?.find((p) => p.id === id) ?? null;

  // One short line under each AI that was checked: all good, the check failed, or what to look at.
  function versionsPart(id) {
    const line = versionLine(data?.versions?.[id]);
    if (!line) return null;
    const t = tt();
    if (line.state === 'warn') {
      return h('p', { class: 'dv-warning ah-versions', role: 'status', 'data-ah-versions': id }, h('strong', {}, `${t('aih.ver.label')}: `),
        line.notes.map((n) => t(`aih.ver.${n.type}`, { model: n.model, date: n.date ?? '' })).join(' '));
    }
    if (line.state === 'failed') {
      const key = whyKey(line.error, 502);
      return h('p', { class: 'al-opt-hint ah-versions', 'data-ah-versions': id }, t('aih.ver.failed', { day: line.day, why: key ? t(key) : t('aih.act.failedGeneric') }));
    }
    return h('p', { class: 'al-opt-hint ah-versions', 'data-ah-versions': id }, t('aih.ver.ok', { day: line.day }));
  }

  const now = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now());

  async function loadActivity() {
    const res = await api.aiActivity(50);
    activity = res.ok ? { ok: true, items: activityRows(res.items) } : { ok: false, items: [] };
  }

  async function loadUsage() {
    try { usage = typeof api.aiUsage === 'function' ? await api.aiUsage() : null; } catch { usage = null; }
  }

  // A project's class is saved the moment it is chosen. What the page shows afterwards is what the server kept.
  async function saveClass(root, value) {
    const res = await api.setAiHelper({ projectClass: { [root]: value } });
    if (res.ok) { apply(res); note('class', tt()('aih.pc.saved'), 'ok'); } else note('class', why(res), 'error');
  }

  function resetDraft() {
    draft = { dailyUSD: String(data?.others?.dailyUSD ?? 1) };
  }

  async function load() {
    const res = await api.aiHelpers();
    canEdit = res.status !== 401;
    if (res.ok) data = res;
    else if (!data) data = { providers: [], keys: [], others: { enabled: false, dailyUSD: 1, off: [] }, status: {} };
    if (res.ok) resetDraft();
    return res;
  }

  const apply = (res) => { if (res.ok) { data = res; resetDraft(); } };
  const note = (id, text, tone = 'info') => { notes = { ...notes, [id]: { text, tone } }; };

  async function saveKey(id, field) {
    const key = field.value.trim();
    field.value = '';
    if (!key) return note(id, tt()('aih.keyEmpty'), 'error');
    const res = await api.setAiKey(id, key);
    if (res.ok) { apply(res); note(id, tt()('aih.keySaved')); } else note(id, why(res), 'error');
    return undefined;
  }

  async function removeKey(id) {
    const res = await api.removeAiKey(id);
    if (res.ok) { apply(res); note(id, tt()('aih.keyRemoved')); } else note(id, why(res), 'error');
  }

  async function testKey(id) {
    note(id, tt()('aih.testing'));
    render(`[data-ah-test="${id}"]`);
    const res = await api.testAiKey(id);
    if (res.ok) note(id, tt()('aih.testOk', { cost: usdText(res.costUSD, ctx.lang()) }), 'ok');
    else note(id, tt()('aih.testFail', { why: why(res) }), 'error');
  }

  // A switch applies at once; the daily limit has its own Save.
  async function switchProvider(id, on) {
    const res = await api.setAiHelper({ provider: id, on });
    if (res.ok) { apply(res); note(id, tt()(on ? 'aih.switchedOn' : 'aih.switchedOff'), 'ok'); } else note(id, why(res), 'error');
  }

  async function giveAnotherChance(id) {
    const res = await api.setAiHelper({ provider: id, on: true });
    if (res.ok) { apply(res); note(id, tt()('aih.resumed'), 'ok'); } else note(id, why(res), 'error');
  }

  async function switchAll(enabled) {
    const res = await api.setAiHelper({ enabled });
    if (res.ok) { apply(res); note('cap', tt()('aih.choiceSaved'), 'ok'); } else note('cap', why(res), 'error');
  }

  async function saveCap() {
    const cap = Number(draft.dailyUSD);
    if (!Number.isFinite(cap) || cap < 0 || draft.dailyUSD === '') return note('cap', tt()('aih.capBad'), 'error');
    const res = await api.setAiHelper({ dailyUSD: cap });
    if (res.ok) { apply(res); note('cap', tt()('aih.choiceSaved'), 'ok'); } else note('cap', why(res), 'error');
    return undefined;
  }

  function noteLine(id) {
    const n = notes[id];
    return h('p', { class: `ah-note${n ? ` is-${n.tone}` : ''}`, role: 'status', 'aria-live': 'polite' }, n?.text ?? '');
  }

  function providerSection(p) {
    const t = tt();
    const saved = keyOf(p.id);
    const fieldId = `ahKey-${p.id}`;
    const field = h('input', { id: fieldId, type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', disabled: !canEdit, placeholder: saved ? '' : t('aih.keyPlaceholder'), 'data-ah-key': p.id });
    const st = stateOf(p.id);
    const lang = ctx.lang();
    const spentLine = [
      st && (st.spentUSDToday > 0 || st.reviewed) ? t('aih.spent', { spent: usdText(st.spentUSDToday, lang) }) : null,
      st?.reviewed ? t('aih.reviewed', { n: st.reviewed, m: st.agreed }) : null,
    ].filter(Boolean).join(' · ');
    const on = Boolean(saved) && !(data.others?.off ?? []).includes(p.id);
    return h('section', { class: 'al-section ah-provider', 'aria-labelledby': `ahName-${p.id}` },
      h('h3', { id: `ahName-${p.id}` }, p.name),
      h('p', { class: 'al-opt-hint' }, t(`aih.good.${p.id}`)),
      h('p', { class: 'ah-link' }, h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, t('aih.getKey', { name: p.name }))),
      h('p', { class: 'ah-privacy' }, h('strong', {}, t('aih.privacy')), ' ', t(`aih.privacy.${p.id}`)),
      h('div', { class: 'al-opt ah-switch' },
        h('input', { type: 'checkbox', id: `ahOn-${p.id}`, 'data-ah-on': p.id, checked: on, disabled: !canEdit || !saved, onchange: async (e) => { await switchProvider(p.id, e.target.checked); render(`[data-ah-on="${p.id}"]`); } }),
        h('label', { for: `ahOn-${p.id}` }, h('span', { class: 'al-opt-name' }, t('aih.on', { name: p.name })), h('span', { class: 'al-opt-hint' }, saved ? t('aih.usesModel', { model: st?.model ?? p.defaultModel }) : t('aih.onNeedsKey')))),
      st?.paused ? h('p', { class: 'dv-warning', role: 'status' }, `${t('aih.paused', { disagreed: st.pausedWhy?.disagreed ?? 0, of: st.pausedWhy?.of ?? 0 })} `,
        h('button', { type: 'button', class: 'btn small-btn', 'data-ah-resume': p.id, disabled: !canEdit, onclick: async () => { await giveAnotherChance(p.id); render(`[data-ah-on="${p.id}"]`); } }, t('aih.resume'))) : null,
      spentLine ? h('p', { class: 'al-opt-hint ah-today', 'data-ah-spent': p.id }, spentLine) : null,
      versionsPart(p.id),
      h('div', { class: 'dv-field ah-field' },
        h('label', { for: fieldId }, saved ? t('aih.keyReplace') : t('aih.keyLabel')),
        h('div', { class: 'ah-key-row' },
          field,
          saved ? h('span', { class: 'ah-saved', 'data-ah-saved': p.id }, t('aih.keyKept', { last4: saved.last4 })) : null)),
      h('div', { class: 'ah-buttons' },
        h('button', { type: 'button', class: 'btn small-btn', 'data-ah-save': p.id, disabled: !canEdit, onclick: async () => { await saveKey(p.id, field); render(`[data-ah-key="${p.id}"]`); } }, t('aih.save')),
        h('button', { type: 'button', class: 'btn small-btn', 'data-ah-test': p.id, disabled: !canEdit || !saved, onclick: async () => { await testKey(p.id); render(`[data-ah-test="${p.id}"]`); } }, t('aih.test')),
        h('button', { type: 'button', class: 'btn small-btn', 'data-ah-remove': p.id, disabled: !canEdit || !saved, onclick: async () => { await removeKey(p.id); render(`[data-ah-key="${p.id}"]`); } }, t('aih.remove'))),
      noteLine(p.id));
  }

  // ONE limit for all the outside AIs together, and the switch that sends everything back to Claude.
  function capSection() {
    const t = tt();
    const o = data.status?.others;
    const cap = Number(draft.dailyUSD);
    return h('section', { class: 'al-section ah-cap', 'aria-labelledby': 'ahCapTitle' },
      h('h3', { id: 'ahCapTitle' }, t('aih.capTitle')),
      h('div', { class: 'al-opt ah-switch' },
        h('input', { type: 'checkbox', id: 'ahAll', 'data-ah-all': '1', checked: data.others?.enabled !== false, disabled: !canEdit, onchange: async (e) => { await switchAll(e.target.checked); render('#ahAll'); } }),
        h('label', { for: 'ahAll' }, h('span', { class: 'al-opt-name' }, t('aih.master')), h('span', { class: 'al-opt-hint' }, t('aih.masterHint')))),
      h('div', { class: 'dv-field ah-field' },
        h('label', { for: 'ahCap' }, t('aih.cap')),
        h('input', { id: 'ahCap', type: 'number', min: '0', step: '0.05', inputmode: 'decimal', class: 'num', value: draft.dailyUSD, disabled: !canEdit, oninput: (e) => { draft = { ...draft, dailyUSD: e.target.value }; } }),
        h('span', { class: 'al-opt-hint' }, t('aih.capHint'))),
      Number.isFinite(cap) && cap >= 50 ? h('p', { class: 'al-opt-hint' }, t('aih.capHigh')) : null,
      o ? h('p', { class: 'al-opt-hint ah-today', 'data-ah-total': '1' }, t('aih.todayAll', { spent: usdText(o.spentUSDToday, ctx.lang()), cap: usdText(o.dailyUSD, ctx.lang()) })) : null,
      o?.enabled && o.capReached ? h('p', { class: 'al-opt-hint' }, t('aih.capReached')) : null,
      h('div', { class: 'ah-buttons' }, h('button', { type: 'button', class: 'btn small-btn', 'data-ah-cap': '1', disabled: !canEdit, onclick: async () => { await saveCap(); render('[data-ah-cap]'); } }, t('aih.saveCap'))),
      noteLine('cap'));
  }

  async function saveEngine(fn, value) {
    const res = await api.setAiHelper({ engines: { [fn]: value } });
    if (res.ok) { apply(res); note('engines', tt()('aih.engines.saved'), 'ok'); } else note('engines', why(res), 'error');
  }

  // The per-function engine choice (id123): which AI runs the map's own work, or 'auto'. Mechanical: the server holds
  // the choice in the config; this only writes it.
  function enginesSection() {
    const t = tt();
    const engines = data?.engines ?? { brain: 'auto', background: 'auto' };
    const options = Array.isArray(data?.engineOptions) && data.engineOptions.length ? data.engineOptions : ['auto'];
    const nameOf = (id) => (id === 'auto' ? t('aih.engines.auto') : id === 'claude' ? 'Claude' : providerName(id));
    const select = (fn, id) => h('div', { class: 'dv-field ah-field' },
      h('label', { for: id }, t(`aih.engines.${fn}`)),
      h('select', { id, 'data-ah-engine': fn, disabled: !canEdit, onchange: async (e) => { await saveEngine(fn, e.target.value); render('#' + id); } },
        options.map((v) => h('option', { value: v, selected: v === engines[fn] }, nameOf(v)))));
    return h('section', { class: 'al-section ah-engines', 'data-ah-engines': '1', 'aria-labelledby': 'ahEnginesTitle' },
      h('h3', { id: 'ahEnginesTitle' }, t('aih.engines.title')),
      h('p', { class: 'al-opt-hint' }, t('aih.engines.hint')),
      select('brain', 'ahEngBrain'), select('background', 'ahEngBackground'),
      noteLine('engines'));
  }

  function classesSection() {
    const t = tt();
    const projects = (typeof ctx.projects === 'function' ? ctx.projects() : []).filter((p) => p && typeof p.root === 'string' && p.root);
    return h('section', { class: 'al-section ah-classes', 'data-ah-classes': '1', 'aria-labelledby': 'ahClassTitle' },
      h('h3', { id: 'ahClassTitle' }, t('aih.pc.title')),
      h('p', { class: 'al-opt-hint' }, t('aih.pc.lede')),
      h('dl', { class: 'ah-class-help' }, PROJECT_CLASS_ORDER.flatMap((c) => [h('dt', {}, t(`aih.pc.${c}`)), h('dd', {}, t(`aih.pc.${c}.hint`))])),
      projects.length ? h('div', { class: 'ah-class-list' }, projects.map((p) => {
        const current = projectClassFor(data.projectClass, p.root, data.pathRule);
        const id = 'ahClass-' + String(p.id ?? p.root).replace(/[^\w-]/g, '');
        return h('div', { class: 'dv-field ah-class-row' },
          h('label', { for: id }, p.name ?? p.root),
          h('select', { id, 'data-ah-class': p.root, disabled: !canEdit, onchange: async (e) => { await saveClass(p.root, e.target.value); render('#' + id); } },
            PROJECT_CLASS_ORDER.map((c) => h('option', { value: c, selected: c === current }, t(`aih.pc.${c}`)))));
      })) : h('p', { class: 'al-opt-hint', 'data-ah-noproject': '1' }, t('aih.pc.none')),
      noteLine('class'));
  }

  function activityItem(r) {
    const t = tt();
    const lang = ctx.lang();
    const failedKey = r.status === 'failed' && r.error ? whyKey(r.error, 0) : null;
    const answered = r.status === 'accepted' || r.status === 'refused';
    return h('li', { class: 'ah-act', 'data-ah-act': r.id, 'data-status': r.status },
      h('div', { class: 'ah-act-head' },
        h('strong', {}, providerName(r.provider)),
        r.model ? h('span', { class: 'ah-act-model' }, r.model) : null,
        h('span', { class: 'ah-act-when' }, whenText(r.at, lang, now()))),
      h('p', { class: 'ah-act-what' }, [t(`aih.act.kind.${r.kind}`), t(`aih.act.sens.${r.sensitivity}`), t(`aih.act.by.${r.source}`), t('aih.act.cost', { cost: usdText(r.costUSD, lang) })].join(' · ')),
      h('p', { class: 'ah-act-state' }, h('span', { class: 'ah-badge is-' + r.status }, t(`aih.act.status.${r.status}`))),
      r.status === 'failed' ? h('p', { class: 'ah-act-why' }, t('aih.act.failedWhy', { why: failedKey ? t(failedKey) : t('aih.act.failedGeneric') })) : null,
      answered && r.verdict ? h('p', { class: 'ah-act-why' }, t('aih.act.verdictLabel', { why: r.verdict })) : null,
      r.pickedBecause ? h('p', { class: 'ah-act-why' }, t('aih.act.pickedBecause', { why: r.pickedBecause })) : null);
  }

  function activitySection() {
    const t = tt();
    return h('section', { class: 'al-section ah-activity', 'data-ah-activity': '1', 'aria-labelledby': 'ahActTitle' },
      h('h3', { id: 'ahActTitle' }, t('aih.act.title')),
      h('p', { class: 'al-opt-hint' }, t('aih.act.lede')),
      !activity.ok ? h('p', { class: 'dv-warning', role: 'status' }, t('aih.act.loadFail'))
        : activity.items.length ? h('ol', { class: 'ah-act-list' }, activity.items.map(activityItem))
          : h('p', { class: 'al-opt-hint', 'data-ah-actempty': '1' }, t('aih.act.empty')),
      h('div', { class: 'ah-buttons' }, h('button', { type: 'button', class: 'btn small-btn', 'data-ah-refresh': '1', onclick: async () => { await Promise.all([loadActivity(), loadUsage()]); render('[data-ah-refresh]'); } }, t('aih.act.refresh'))));
  }

  function panelCard(c) {
    const t = tt();
    const lang = ctx.lang();
    const used = c.calls > 0;
    const benchList = c.bench.map((b) => t('aih.panel.benchItem', { kind: t(`aih.act.kind.${ACTIVITY_KINDS.has(b.kind) ? b.kind : 'other'}`), pct: pctText(b.accuracy, lang) })).join('; ');
    return h('li', { class: 'ah-card', 'data-ah-card': c.provider },
      h('div', { class: 'ah-act-head' }, h('strong', {}, providerName(c.provider)), c.model ? h('span', { class: 'ah-act-model' }, c.model) : null),
      used ? h('p', {}, t('aih.panel.calls', { n: c.calls, failed: c.failed })) : h('p', { class: 'al-opt-hint', 'data-ah-unused': c.provider }, t('aih.panel.unused')),
      used ? h('p', { 'data-ah-used': c.provider }, c.acceptRate === null ? t('aih.panel.usedNone') : t('aih.panel.used', { pct: pctText(c.acceptRate, lang) }),
        c.waiting ? ` (${t('aih.panel.waiting', { n: c.waiting })})` : '') : null,
      used ? h('p', {}, c.costPerAcceptedUSD === null ? t('aih.panel.costNone') : t('aih.panel.costPer', { cost: usdText(c.costPerAcceptedUSD, lang) })) : null,
      used && c.avgMs ? h('p', {}, t('aih.panel.time', { time: secondsText(c.avgMs, lang) })) : null,
      h('p', { 'data-ah-bench': c.provider }, benchList ? t('aih.panel.bench', { list: benchList }) : t('aih.panel.benchNone')),
      c.mapReview ? h('p', {}, t('aih.panel.review', { n: c.mapReview.reviewed, m: c.mapReview.agreed })) : null);
  }

  // Spending per day: one column per day, stacked by AI (each part has a text label too, and a list for reading aloud).
  function panelChart(m) {
    const t = tt();
    const lang = ctx.lang();
    if (!m.series.length) return h('p', { class: 'al-opt-hint', 'data-ah-chartempty': '1' }, t('aih.panel.chartNone'));
    return h('div', { class: 'ah-chart-wrap' },
      h('div', { class: 'ah-chart', role: 'img', 'data-ah-chart': '1', 'aria-label': t('aih.panel.chartLabel', { n: m.bars.length, total: usdText(m.totalUSD, lang) }) },
        m.bars.map((b) => h('div', { class: 'ah-col', title: t('aih.panel.dayTip', { day: b.day, total: usdText(b.total, lang) }) },
          h('div', { class: 'ah-stack', style: `height:${Math.max(b.total > 0 ? 2 : 0, Math.round((b.total / m.maxDayUSD) * 100))}%` },
            b.parts.map((p) => h('span', { class: `ah-part ah-s${p.slot}`, style: `flex-grow:${p.usd}` }))),
          h('span', { class: 'ah-day' }, b.day.slice(8))))),
      h('ul', { class: 'ah-legend' }, m.series.map((p, i) => h('li', {}, h('span', { class: `ah-swatch ah-s${i % 5}`, 'aria-hidden': 'true' }), providerName(p)))),
      h('ul', { class: 'ah-sr', 'data-ah-days': '1' }, m.bars.filter((b) => b.total > 0).map((b) => h('li', {}, t('aih.panel.dayTip', { day: b.day, total: usdText(b.total, lang) })))));
  }

  function panelSection() {
    const m = panelModel(usage, (data.keys ?? []).map((k) => k.provider));
    if (!m) return null;
    const t = tt();
    const lang = ctx.lang();
    const ratio = m.capUSD > 0 ? Math.min(1, m.spentUSD / m.capUSD) : (m.spentUSD > 0 ? 1 : 0);
    return h('section', { class: 'al-section ah-panel', 'data-ah-panel': '1', 'aria-labelledby': 'ahPanelTitle' },
      h('h3', { id: 'ahPanelTitle' }, t('aih.panel.title')),
      h('p', { class: 'al-opt-hint' }, t('aih.panel.lede')),
      !m.ok ? h('p', { class: 'dv-warning', role: 'status' }, t('aih.panel.loadFail')) : [
        h('div', { class: 'ah-meter-wrap' },
          h('p', { class: 'ah-meter-text', id: 'ahMeterText' }, t('aih.panel.meter', { spent: usdText(m.spentUSD, lang), cap: usdText(m.capUSD, lang) })),
          h('div', { class: `ah-meter${ratio >= 1 ? ' is-full' : ''}`, role: 'meter', 'aria-labelledby': 'ahMeterText', 'aria-valuemin': '0', 'aria-valuemax': String(m.capUSD), 'aria-valuenow': String(m.spentUSD), 'data-ah-meter': '1' },
            h('span', { class: 'ah-meter-fill', style: `width:${Math.round(ratio * 100)}%` })),
          ratio >= 1 && m.capUSD > 0 ? h('p', { class: 'al-opt-hint' }, t('aih.panel.meterFull')) : null),
        h('ul', { class: 'ah-cards' }, m.cards.map(panelCard)),
        h('h4', { class: 'ah-chart-title' }, t('aih.panel.chartTitle', { n: m.bars.length })),
        panelChart(m),
      ]);
  }

  function render(focusSelector) {
    const t = tt();
    dialog.replaceChildren(...[
      h('h2', { id: 'aiHelpersTitle' }, t('aih.title')),
      h('p', { class: 'al-lede' }, t('aih.lede')),
      h('p', { class: 'al-opt-hint' }, t('aih.ledeClaude')),
      h('p', { class: 'al-opt-hint ah-chat-use' }, t('aih.chatUse')),
      h('p', { class: 'al-lede' }, t('aih.ledeCost')),
      h('p', { class: 'al-opt-hint ah-redact' }, t('aih.redact')),
      h('p', { class: 'al-opt-hint ah-redact' }, t('aih.sent')),
      canEdit ? null : h('p', { class: 'dv-warning' }, t('notify.needKey')),
      panelSection(),
      ...data.providers.map(providerSection),
      capSection(),
      enginesSection(),
      classesSection(),
      activitySection(),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, t('aih.close'))),
    ].filter(Boolean));
    if (focusSelector) dialog.querySelector(focusSelector)?.focus();
  }

  async function open() {
    notes = {};
    await Promise.all([load(), loadActivity(), loadUsage()]);
    render();
    if (!dialog.open) dialog.showModal();
  }

  // Closing wipes what was typed: a key never waits in the page.
  dialog.addEventListener('close', () => { dialog.replaceChildren(); });
  for (const el of ctx.openers ?? []) el.addEventListener('click', () => { el.closest?.('[popover]')?.hidePopover?.(); open(); });

  return {
    open,
    isOpen: () => dialog.open,
    relabel() { if (dialog.open && data) render(); },
  };
}
