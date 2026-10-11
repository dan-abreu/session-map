// The project's monthly budget on the page (orchestration or07): the block in the project's panel, next to the
// orchestrator's, with what this month cost against the limit (a bar), the field to set it and, once it is used up,
// "Continuar este mês". Pure builders (they take h and t), so node:test loads them.

const LIMIT_FIELD = 'budget-field';
const round2 = (n) => Math.round(n * 100) / 100;

// The bar's fill and its tone: a budget of 0 is full at once.
export function budgetMeter(budget) {
  if (!budget || budget.limitUSD === null || budget.limitUSD === undefined) return null;
  const pct = budget.limitUSD > 0 ? Math.round((100 * budget.usedUSD) / budget.limitUSD) : 100;
  return { pct, fill: Math.max(0, Math.min(100, pct)), tone: budget.level === 'over' ? 'over' : budget.level === 'warn' ? 'warn' : 'ok' };
}

// What the person typed, in their currency, back to dollars: null clears the budget; NaN is a mistake.
export function typedBudget(raw, rate = 1) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round((n / (rate > 0 ? rate : 1)) * 1e6) / 1e6 : NaN;
}

// ctx: {h, t, money(usd), currency: {label, rate}}. budget: the state's project.budget (absent on an older server: no block).
// handlers: onSave(usdOrNull, field, button), onContinue(button).
export function budgetSection({ h, t, money, currency = { label: 'US$', rate: 1 } }, budget, { onSave, onContinue }) {
  if (!budget) return null;
  const meter = budgetMeter(budget);
  const field = h('input', {
    id: LIMIT_FIELD, type: 'number', min: '0', step: 'any', inputmode: 'decimal', class: 'num', 'data-budget': 'field',
    value: meter ? String(round2(budget.limitUSD * (currency.rate || 1))) : '',
  });
  const save = h('button', { type: 'button', class: 'btn small-btn', 'data-budget': 'save' }, t('budget.save'));
  const submit = () => onSave(typedBudget(field.value, currency.rate), field, save);
  save.onclick = submit;
  field.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  const used = meter ? t('budget.used', { used: money(budget.usedUSD), limit: money(budget.limitUSD), pct: meter.pct }) : null;
  const status = !meter ? null : budget.paused ? 'budget.paused' : budget.continued ? 'budget.continued' : budget.level === 'warn' ? 'budget.warn' : null;
  return h('section', { class: `budget-block tone-${meter?.tone ?? 'ok'}`, 'aria-labelledby': 'budget-title' },
    h('h3', { class: 'orch-title', id: 'budget-title' }, t('budget.title')),
    h('p', { class: 'orch-lede' }, t('budget.why')),
    meter
      ? h('div', { class: 'budget-status', 'aria-live': 'polite' },
        h('p', { class: 'budget-used num' }, used),
        h('span', { class: 'br-track', role: 'img', 'aria-label': used }, h('span', { style: `width:${meter.fill}%` })),
        h('p', { class: 'budget-split num' }, t('budget.split', { claude: money(budget.claudeUSD), others: money(budget.othersUSD) })),
        status ? h('p', { class: 'budget-note', 'data-budget': 'note' }, t(status)) : null,
        budget.paused ? h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', 'data-budget': 'continue', onclick: (e) => onContinue(e.currentTarget) }, t('budget.continue'))) : null)
      : h('p', { class: 'budget-used num' }, t('budget.none', { used: money(budget.usedUSD ?? 0) })),
    h('label', { for: LIMIT_FIELD, class: 'budget-label' }, t('budget.label', { currency: currency.label })),
    h('div', { class: 'budget-row' }, field, save));
}
