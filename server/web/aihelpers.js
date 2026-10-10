// The "Other AIs" dialog (sb07): keys for cheaper AIs, which one takes the bulk work, and what they spent today.
// The pure part on top is what the Costs tab and node:test use; the DOM part only runs when the page calls it.

const PROVIDER_NAMES = { claude: 'Claude', openrouter: 'OpenRouter', deepseek: 'DeepSeek', gemini: 'Google Gemini', openai: 'OpenAI (GPT)' };
export const providerName = (id) => PROVIDER_NAMES[id] ?? String(id);

// Spend is a few thousandths of a dollar: two decimals would show $0.00 all day.
export function usdText(usd, lang = 'en') {
  const n = Number.isFinite(usd) ? usd : 0;
  return new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 }).format(n);
}

// What the Costs tab lists, one row per AI that asked something today. Both pieces are machine-wide and every project
// repeats them, so the first project that has them speaks for all: they must never be added up across projects.
export function providerSpend(state) {
  const host = (state?.projects ?? []).find((p) => p.ai?.spentByProviderToday);
  if (!host) return { rows: [], helper: null };
  const spent = host.ai.spentByProviderToday;
  const helper = host.ai.helper ?? null;
  const ids = ['claude', ...Object.keys(spent).filter((id) => id !== 'claude' && spent[id] > 0)];
  if (helper?.enabled && helper.provider && !ids.includes(helper.provider)) ids.push(helper.provider);
  return { rows: ids.map((id) => ({ id, name: providerName(id), usd: spent[id] ?? 0, isHelper: helper?.provider === id ? helper : null })), helper };
}

const ERROR_CODES = new Set(['no-key', 'http-400', 'http-401', 'http-402', 'http-403', 'http-404', 'http-429', 'timeout', 'network', 'bad-output', 'no-json', 'too-many-tests', 'invalid-key', 'unknown-provider', 'bad-helpers', 'encrypt-failed', 'config-unreadable', 'cap-reached']);
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

// ---- the page --------------------------------------------------------------------------------------------------

// ctx: dialog, h, t() (translator getter), lang(), api, toast, errorText, opener (optional buttons that open it).
export function createAiHelpers(ctx) {
  const { dialog, h, api } = ctx;
  let data = null;
  let canEdit = true;
  let draft = { provider: '', model: '', dailyUSD: '' };
  let notes = {};

  const tt = () => ctx.t();
  const why = (res) => {
    const key = whyKey(res.error, res.status);
    return key ? tt()(key) : ctx.errorText(res.error);
  };
  const keyOf = (id) => data?.keys?.find((k) => k.provider === id) ?? null;
  const catalogOf = (id) => data?.providers?.find((p) => p.id === id) ?? null;

  // The usual model is not worth pinning: an empty field follows the program's choice.
  const ownModel = (id, model) => (model && model !== catalogOf(id)?.defaultModel ? model : '');

  function resetDraft() {
    const helper = data?.helper ?? {};
    draft = {
      provider: helper.enabled && helper.provider ? helper.provider : '',
      model: helper.provider ? ownModel(helper.provider, helper.model) : '',
      dailyUSD: String(helper.dailyUSD ?? 0.5),
    };
  }

  async function load() {
    const res = await api.aiHelpers();
    canEdit = res.status !== 401;
    if (res.ok) data = res;
    else if (!data) data = { providers: [], keys: [], helper: { enabled: false }, status: {} };
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

  async function saveChoice() {
    const cap = Number(draft.dailyUSD);
    if (!Number.isFinite(cap) || cap < 0 || draft.dailyUSD === '') return note('choice', tt()('aih.capBad'), 'error');
    const provider = draft.provider || data.helper.provider || data.providers[0]?.id;
    // An empty model field is sent as '': the server drops an old pin and the usual model is used again.
    const body = { dailyUSD: cap, helper: { provider, enabled: Boolean(draft.provider), ...(draft.provider ? { model: draft.model.trim() } : {}) } };
    const res = await api.setAiHelper(body);
    if (res.ok) { apply(res); note('choice', tt()('aih.choiceSaved'), 'ok'); } else note('choice', why(res), 'error');
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
    return h('section', { class: 'al-section ah-provider', 'aria-labelledby': `ahName-${p.id}` },
      h('h3', { id: `ahName-${p.id}` }, p.name),
      h('p', { class: 'al-opt-hint' }, t(`aih.good.${p.id}`)),
      h('p', { class: 'ah-link' }, h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, t('aih.getKey', { name: p.name }))),
      h('p', { class: 'ah-privacy' }, h('strong', {}, t('aih.privacy')), ' ', t(`aih.privacy.${p.id}`)),
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

  function choiceSection() {
    const t = tt();
    const options = [{ id: '', name: t('aih.claudeOnly'), hint: t('aih.claudeOnlyHint') },
      ...data.providers.map((p) => ({ id: p.id, name: p.name, hint: keyOf(p.id) ? t(`aih.good.${p.id}`) : t('aih.needsKey'), off: !keyOf(p.id) }))];
    const chosen = catalogOf(draft.provider);
    const s = data.status?.helper;
    const info = [];
    if (s?.provider && (s.enabled || s.reviewed || s.spentUSDToday)) {
      info.push(t('aih.today', { spent: usdText(s.spentUSDToday, ctx.lang()), cap: usdText(s.capUSD, ctx.lang()) }));
      info.push(t('aih.reviewed', { n: s.reviewed, m: s.agreed }));
    }
    return h('section', { class: 'al-section ah-choice', 'aria-labelledby': 'ahChoice' },
      h('h3', { id: 'ahChoice' }, t('aih.bulk')),
      h('p', { class: 'al-opt-hint' }, t('aih.bulkHint')),
      h('div', { class: 'ah-radios', role: 'radiogroup', 'aria-labelledby': 'ahChoice' }, options.map((o) => h('div', { class: 'al-opt' },
        h('input', { type: 'radio', name: 'ahWho', id: `ahWho-${o.id || 'claude'}`, value: o.id, checked: draft.provider === o.id, disabled: !canEdit || o.off, onchange: () => { draft = { ...draft, provider: o.id, model: o.id && o.id === data.helper.provider ? ownModel(o.id, data.helper.model) : '' }; render('#ahModel'); } }),
        h('label', { for: `ahWho-${o.id || 'claude'}` }, h('span', { class: 'al-opt-name' }, o.name), h('span', { class: 'al-opt-hint' }, o.hint))))),
      draft.provider ? h('div', { class: 'dv-field ah-field' },
        h('label', { for: 'ahModel' }, t('aih.model')),
        h('input', { id: 'ahModel', type: 'text', value: draft.model, placeholder: chosen?.defaultModel ?? '', autocomplete: 'off', spellcheck: 'false', disabled: !canEdit, oninput: (e) => { draft = { ...draft, model: e.target.value }; } }),
        h('span', { class: 'al-opt-hint' }, t('aih.modelHint', { model: chosen?.defaultModel ?? '' }))) : null,
      chosen ? h('p', { class: 'ah-privacy' }, h('strong', {}, t('aih.choicePrivacy', { name: chosen.name })), ' ', t(`aih.privacy.${chosen.id}`)) : null,
      h('div', { class: 'dv-field ah-field' },
        h('label', { for: 'ahCap' }, t('aih.cap')),
        h('input', { id: 'ahCap', type: 'number', min: '0', step: '0.05', inputmode: 'decimal', class: 'num', value: draft.dailyUSD, disabled: !canEdit, oninput: (e) => { draft = { ...draft, dailyUSD: e.target.value }; } }),
        h('span', { class: 'al-opt-hint' }, t('aih.capHint'))),
      s?.paused ? h('p', { class: 'dv-warning', role: 'status' }, t('aih.paused', { disagreed: s.pausedWhy?.disagreed ?? 0, of: s.pausedWhy?.of ?? 0 })) : null,
      s?.enabled && s.capReached ? h('p', { class: 'al-opt-hint' }, t('aih.capReached')) : null,
      info.length ? h('p', { class: 'al-opt-hint ah-today' }, info.join(' · ')) : null,
      h('div', { class: 'ah-buttons' }, h('button', { type: 'button', class: 'btn small-btn', 'data-ah-choice': '1', disabled: !canEdit, onclick: async () => { await saveChoice(); render('[data-ah-choice]'); } }, t('aih.saveChoice'))),
      noteLine('choice'));
  }

  function render(focusSelector) {
    const t = tt();
    dialog.replaceChildren(...[
      h('h2', { id: 'aiHelpersTitle' }, t('aih.title')),
      h('p', { class: 'al-lede' }, t('aih.lede')),
      h('p', { class: 'al-lede' }, t('aih.ledeCost')),
      h('p', { class: 'al-opt-hint ah-redact' }, t('aih.redact')),
      h('p', { class: 'al-opt-hint ah-redact' }, t('aih.sent')),
      canEdit ? null : h('p', { class: 'dv-warning' }, t('notify.needKey')),
      ...data.providers.map(providerSection),
      choiceSection(),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, t('aih.close'))),
    ].filter(Boolean));
    if (focusSelector) dialog.querySelector(focusSelector)?.focus();
  }

  async function open() {
    notes = {};
    await load();
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
