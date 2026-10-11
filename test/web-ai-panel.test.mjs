import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiHelpers, panelModel, pctText, secondsText } from '../server/web/aihelpers.js';
import { LANGS } from '../server/web/i18n.js';

// The panel of the "Other AIs" dialog (or16): the other AIs measured by real use.
const usage = {
  ok: true,
  cap: { dailyUSD: 5, spentTodayUSD: 1.25 },
  byAi: [{ provider: 'openai', model: 'gpt-6.1-sol', calls: 10, ok: 9, failed: 1, accepted: 6, refused: 2, waiting: 1, acceptRate: 0.75, costUSD: 0.12, costPerAcceptedUSD: 0.02, avgMs: 1667,
    byKind: [], bench: [{ kind: 'review', accuracy: 0.9, n: 30 }], mapReview: { reviewed: 12, agreed: 10 } }],
  days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, byProvider: i === 13 ? { openai: 0.12, deepseek: 0.03 } : {} })),
};

test('the panel model: none without a key; a card per AI, also for one never used; bars per day', () => {
  assert.equal(panelModel(usage, []), null);
  const m = panelModel(usage, ['openai', 'gemini']);
  assert.deepEqual(m.cards.map((c) => c.provider), ['openai', 'gemini']);
  assert.equal(m.cards[1].calls, 0);
  assert.deepEqual(m.series, ['openai', 'deepseek']);
  assert.equal(m.bars.length, 14);
  assert.equal(Math.round(m.maxDayUSD * 100), 15);
  assert.equal(panelModel({ ok: false }, ['openai']).ok, false);
});

test('numbers in plain words', () => {
  assert.equal(pctText(0.75, 'pt-BR'), '75%');
  assert.equal(secondsText(1667, 'pt-BR'), '1,7 s');
});

test('every panel key exists in both languages with the same blanks', () => {
  const keys = Object.keys(LANGS.en).filter((k) => k.startsWith('aih.panel.'));
  assert.ok(keys.length >= 20);
  for (const k of keys) {
    assert.ok(LANGS['pt-BR'][k], `pt-BR ${k}`);
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    assert.deepEqual(vars(LANGS['pt-BR'][k]), vars(LANGS.en[k]), k);
  }
});

const el = (tag, props = {}, ...kids) => ({ tag, props, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false), focus() {} });
const textOf = (n) => (typeof n === 'string' ? n : (n.kids ?? []).map(textOf).join(' '));
const walk = (n, fn) => { if (typeof n === 'string') return; fn(n); for (const k of n.kids) walk(k, fn); };
const find = (root, pred) => { const hits = []; for (const c of root.kids) walk(c, (n) => { if (pred(n)) hits.push(n); }); return hits; };

async function open({ keys, usageRes, lang = 'pt-BR' }) {
  const dialog = { kids: [], open: false, replaceChildren(...k) { dialog.kids = k; }, addEventListener() {}, showModal() { dialog.open = true; }, close() {}, querySelector() { return null; } };
  const t = (key, vars = {}) => LANGS[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const view = { ok: true, status: 200, providers: [{ id: 'openai', name: 'OpenAI', keyUrl: 'https://x.test', defaultModel: 'm' }], keys, others: { enabled: true, dailyUSD: 5, off: [] }, status: { others: { providers: [] } } };
  const api = { aiHelpers: async () => view, aiActivity: async () => ({ ok: true, items: [] }), aiUsage: async () => usageRes };
  await createAiHelpers({ dialog, h: el, t: () => t, lang: () => lang, api, toast() {}, errorText: (e) => e, openers: [] }).open();
  return dialog;
}

test('with a key, the panel is the first section: meter, a card per AI, the chart', async () => {
  const d = await open({ keys: [{ provider: 'openai', last4: '1234' }, { provider: 'gemini', last4: '5678' }], usageRes: usage });
  const sections = find(d, (n) => n.tag === 'section');
  assert.equal(sections[0].props['data-ah-panel'], '1');
  const panel = sections[0];
  const text = textOf(panel);
  assert.match(text, /Hoje: US\$\s?1,25 de US\$\s?5,00/);
  assert.match(text, /75% do trabalho que ela entregou/);
  assert.match(text, /Na bancada: uma segunda opinião: 90% de acerto/);
  assert.match(text, /concordou com 10/);
  assert.match(text, /Ainda não foi usada no trabalho real\./);
  assert.equal(find(panel, (n) => n.props?.role === 'meter')[0].props['aria-valuenow'], '1.25');
  assert.ok(find(panel, (n) => n.props?.['data-ah-chart'])[0].props['aria-label'].includes('no total'));
});

test('empty data: plain empty states; no key: no panel; failed read: a warning', async () => {
  const empty = await open({ keys: [{ provider: 'openai', last4: '1' }], usageRes: { ok: true, cap: { dailyUSD: 5, spentTodayUSD: 0 }, byAi: [], days: [] } });
  const text = textOf(find(empty, (n) => n.props?.['data-ah-panel'])[0]);
  assert.match(text, /Ainda não foi usada no trabalho real\./);
  assert.match(text, /Nada foi gasto nesses dias\./);
  assert.equal(find(await open({ keys: [], usageRes: usage }), (n) => n.props?.['data-ah-panel']).length, 0);
  const bad = await open({ keys: [{ provider: 'openai', last4: '1' }], usageRes: { ok: false, error: 'x' } });
  assert.match(textOf(find(bad, (n) => n.props?.['data-ah-panel'])[0]), /não foi possível ler o painel/i);
});
