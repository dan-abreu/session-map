import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetMeter, budgetSection, typedBudget } from '../server/web/budgetview.js';
import { LANGS } from '../server/web/i18n.js';
import { budgetOf } from '../server/budget.mjs';

// The project's monthly budget on the page (orchestration or07): the bar, the words, the field and "Continuar este mês".

const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs ?? {}, kids: kids.flat(Infinity).filter((k) => k != null && k !== false) });
const walk = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.kids?.forEach((k) => walk(k, out)); } return out; };
const text = (el) => walk(el).flatMap((e) => e.kids?.filter((k) => typeof k === 'string') ?? []).join(' ');
const find = (el, key) => walk(el).find((e) => e.attrs?.['data-budget'] === key) ?? null;
const t = (key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key);
const money = (usd) => `$${usd.toFixed(2)}`;
const ctx = { h, t, money, currency: { label: 'R$', rate: 5 } };
const month = (used, extra = {}) => budgetOf({ limitUSD: 10, claudeUSD: used, othersUSD: 0.5, month: '2026-10', ...extra });

test('typedBudget: the owner\'s currency back to dollars; empty removes it; anything else is a mistake', () => {
  assert.equal(typedBudget('50', 5), 10);
  assert.equal(typedBudget('12,5', 1), 12.5);
  assert.equal(typedBudget('  ', 5), null);
  assert.ok(Number.isNaN(typedBudget('-3', 1)));
  assert.ok(Number.isNaN(typedBudget('abc', 1)));
});

test('budgetMeter: the fill stops at 100% while the words keep the real share; 0 is full', () => {
  assert.deepEqual(budgetMeter(month(3)), { pct: 35, fill: 35, tone: 'ok' });
  assert.deepEqual(budgetMeter(month(8)), { pct: 85, fill: 85, tone: 'warn' });
  assert.deepEqual(budgetMeter(month(14)), { pct: 145, fill: 100, tone: 'over' });
  assert.deepEqual(budgetMeter(budgetOf({ limitUSD: 0, month: '2026-10' })), { pct: 100, fill: 100, tone: 'over' });
  assert.equal(budgetMeter(budgetOf({ limitUSD: null, month: '2026-10' })), null);
});

test('budgetSection: no budget says what the month cost and offers the field; an older server draws nothing', () => {
  const calls = [];
  const el = budgetSection(ctx, budgetOf({ limitUSD: null, claudeUSD: 2, month: '2026-10' }), { onSave: (...a) => calls.push(a), onContinue: () => {} });
  assert.match(text(el), /budget\.title/);
  assert.match(text(el), /budget\.none:\$2\.00/);
  assert.equal(find(el, 'field').attrs.value, '');
  assert.equal(find(el, 'continue'), null);
  find(el, 'field').value = '100';
  find(el, 'save').onclick();
  assert.deepEqual(calls.map((c) => c[0]), [20], 'R$ 100 at 5 to the dollar is US$ 20');
  assert.equal(budgetSection(ctx, undefined, { onSave() {}, onContinue() {} }), null);
});

test('budgetSection: the bar, the split, the warning past 80%, and at 100% the pause in words with "Continuar este mês"', () => {
  const warn = budgetSection(ctx, month(8), { onSave() {}, onContinue() {} });
  assert.match(warn.attrs.class, /tone-warn/);
  assert.match(text(warn), /budget\.used:\$8\.50\|\$10\.00\|85/);
  assert.match(text(warn), /budget\.split:\$8\.00\|\$0\.50/);
  assert.equal(text(find(warn, 'note')), 'budget.warn');
  assert.equal(find(warn, 'field').attrs.value, '50', 'the field shows the owner\'s currency');
  assert.equal(find(warn, 'continue'), null);

  const pressed = [];
  const over = budgetSection(ctx, month(10), { onSave() {}, onContinue: (b) => pressed.push(b) });
  assert.match(over.attrs.class, /tone-over/);
  assert.equal(text(find(over, 'note')), 'budget.paused');
  const button = find(over, 'continue');
  assert.equal(text(button), 'budget.continue');
  button.attrs.onclick({ currentTarget: 'btn' });
  assert.deepEqual(pressed, ['btn']);
  const bar = walk(over).find((e) => e.attrs?.class === 'br-track');
  assert.equal(bar.kids[0].attrs.style, 'width:100%');

  const continued = budgetSection(ctx, month(12, { continueMonth: '2026-10' }), { onSave() {}, onContinue() {} });
  assert.equal(text(find(continued, 'note')), 'budget.continued');
  assert.equal(find(continued, 'continue'), null);
});

test('every word of the budget block is there in English and Portuguese', () => {
  const keys = ['budget.title', 'budget.why', 'budget.used', 'budget.split', 'budget.none', 'budget.warn', 'budget.paused', 'budget.continued',
    'budget.continue', 'budget.label', 'budget.save', 'budget.saved', 'budget.cleared', 'budget.continuedSaved', 'err.bad-budget',
    'alert.what.budgetWarn', 'alert.why.budgetWarn', 'alert.do.budgetWarn', 'alert.what.budgetOver', 'alert.why.budgetOver', 'alert.do.budgetOver',
    'alert.many.budget', 'alert.openBudget'];
  for (const lang of ['en', 'pt-BR']) for (const key of keys) assert.ok(LANGS[lang][key], `${lang} ${key}`);
  assert.notEqual(LANGS['pt-BR']['budget.continue'], LANGS.en['budget.continue']);
});
