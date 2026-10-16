import test from 'node:test';
import assert from 'node:assert/strict';
import { providerName, providerSpend, usdText, whyKey } from '../server/web/aihelpers.js';
import { LANGS } from '../server/web/i18n.js';

const others = {
  enabled: true, dailyUSD: 1, spentUSDToday: 0.001, capReached: false,
  providers: [
    { id: 'openai', model: 'gpt-6-luna', hasKey: true, on: true, paused: false, pausedWhy: null, spentUSDToday: 0.001, reviewed: 5, agreed: 4, calls: 7, busy: 0 },
    { id: 'gemini', model: 'gemini-3.1-flash-lite', hasKey: true, on: false, paused: false, pausedWhy: null, spentUSDToday: 0, reviewed: 0, agreed: 0, calls: 0, busy: 0 },
    { id: 'deepseek', model: 'deepseek-flash', hasKey: false, on: true, paused: false, pausedWhy: null, spentUSDToday: 0, reviewed: 0, agreed: 0, calls: 0, busy: 0 },
  ],
};
const project = (id, extra) => ({ id, ai: { enabled: true, model: 'haiku', spentUSDToday: 0.01, queue: 0, ...extra } });

test('the Costs rows read the machine-wide spend once, never summed across projects', () => {
  const machine = { spentByProviderToday: { claude: 0.03, openai: 0.001 }, others };
  const { rows } = providerSpend({ projects: [project('a', machine), project('b', machine)] });
  assert.deepEqual(rows.map((r) => [r.id, r.usd]), [['claude', 0.03], ['openai', 0.001]]);
  assert.equal(rows[1].other, others.providers[0]);
  assert.equal(rows[0].other, null);
});

test('an AI that is on and has a key but spent nothing still has its row; one without a key or off does not', () => {
  const { rows } = providerSpend({ projects: [project('a', { spentByProviderToday: {}, others })] });
  assert.deepEqual(rows.map((r) => r.id), ['claude', 'openai']);
  assert.deepEqual(providerSpend({ projects: [project('a', {})] }).rows, []);
  assert.deepEqual(providerSpend({ projects: [] }).rows, []);
});

test('an AI that spent today keeps its row even after it was switched off, and all the others off means only Claude', () => {
  const { rows } = providerSpend({ projects: [project('a', { spentByProviderToday: { gemini: 0.002 }, others })] });
  assert.deepEqual(rows.map((r) => r.id), ['claude', 'openai', 'gemini']);
  assert.equal(rows[2].other.on, false);
  const none = providerSpend({ projects: [project('a', { spentByProviderToday: {}, others: { ...others, enabled: false } })] });
  assert.deepEqual(none.rows.map((r) => r.id), ['claude']);
});

test('small amounts show their cents of a cent', () => {
  assert.equal(usdText(0.0012, 'en'), '$0.0012');
  assert.equal(usdText(0.5, 'en'), '$0.50');
  assert.equal(usdText(0, 'en'), '$0.00');
  assert.equal(providerName('gemini'), 'Google Gemini');
});

test('every error code the dialog words exists in both languages', () => {
  for (const code of ['no-key', 'http-401', 'http-402', 'http-403', 'http-404', 'http-429', 'http-503', 'timeout', 'network', 'bad-output', 'no-json', 'too-many-tests', 'invalid-key', 'unknown-provider', 'bad-helpers', 'encrypt-failed', 'http-400', 'http-422', 'config-unreadable', 'cap-reached']) {
    const key = whyKey(code, 502);
    assert.ok(key, code);
    for (const lang of Object.values(LANGS)) assert.ok(key in lang, `${key} missing`);
  }
  assert.equal(whyKey('network', 0), null, 'the page\'s own network failure keeps the generic words');
  assert.equal(whyKey('something-else', 500), null);
});

test('every provider of the catalog has its words in both languages', async () => {
  const { PROVIDERS } = await import('../server/ai/providers.mjs');
  for (const id of Object.keys(PROVIDERS)) for (const lang of Object.values(LANGS)) {
    assert.ok(`aih.good.${id}` in lang, `aih.good.${id}`);
    assert.ok(`aih.privacy.${id}` in lang, `aih.privacy.${id}`);
  }
});

test('the lede says honestly that Claude Haiku costs about the same, in both languages', () => {
  for (const lang of Object.values(LANGS)) assert.ok('aih.ledeCost' in lang, 'aih.ledeCost');
  assert.match(LANGS.en['aih.ledeCost'], /Haiku/);
  assert.match(LANGS.en['aih.ledeCost'], /not to save money/i);
  assert.match(LANGS['pt-BR']['aih.ledeCost'], /Haiku/);
  assert.match(LANGS['pt-BR']['aih.ledeCost'], /não para economizar/i);
});

test('the dialog knows the OpenAI name', () => {
  assert.equal(providerName('openai'), 'OpenAI (GPT)');
});

test('a refused request (wrong model or key) gets its own plain words, not the generic "reload the page"', () => {
  assert.equal(whyKey('http-400', 502), 'aih.err.http-400');
  assert.equal(whyKey('http-422', 502), 'aih.err.http-400');
  for (const lang of Object.values(LANGS)) assert.match(lang['aih.err.http-400'], /model|modelo/i);
});

test('the dialog says what is sent and that names are not hidden, in both languages', () => {
  for (const lang of Object.values(LANGS)) {
    assert.ok('aih.sent' in lang, 'aih.sent');
  }
  assert.match(LANGS.en['aih.sent'], /title/i);
  assert.match(LANGS.en['aih.sent'], /names/i);
  assert.match(LANGS['pt-BR']['aih.sent'], /nomes/i);
});

test('the single-helper choice is gone from both languages and the new words exist in both', () => {
  for (const lang of Object.values(LANGS)) {
    for (const old of ['aih.bulk', 'aih.bulkHint', 'aih.claudeOnly', 'aih.claudeOnlyHint', 'aih.needsKey', 'aih.model', 'aih.modelHint', 'aih.saveChoice', 'aih.today']) assert.equal(old in lang, false, old);
    for (const key of ['aih.lede', 'aih.ledeClaude', 'aih.on', 'aih.onNeedsKey', 'aih.usesModel', 'aih.spent', 'aih.resume', 'aih.capTitle', 'aih.master', 'aih.saveCap', 'aih.todayAll', 'costs.aiSwitchedOff']) assert.ok(key in lang, key);
  }
  assert.match(LANGS['pt-BR']['aih.lede'], /escolhe sozinho qual IA usa em cada tarefa e pode usar várias ao mesmo tempo\. Você só cola as chaves e diz quanto pode gastar por dia\./);
});

// ---- the dialog itself, on a tiny fake page ------------------------------------------------------------------------
const el = (tag, props = {}, ...kids) => ({ tag, props, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false), focus() {} });
const textOf = (n) => (typeof n === 'string' ? n : (n.kids ?? []).map(textOf).join(' '));
const walk = (n, fn) => { if (typeof n === 'string') return; fn(n); for (const k of n.kids) walk(k, fn); };
const find = (root, pred) => { const hits = []; for (const c of root.kids) walk(c, (n) => { if (pred(n)) hits.push(n); }); return hits; };

function fakeDialog() {
  const d = { kids: [], open: false, listeners: {}, replaceChildren(...k) { d.kids = k; }, addEventListener(e, f) { d.listeners[e] = f; }, showModal() { d.open = true; }, close() { d.open = false; }, querySelector() { return null; } };
  return d;
}

async function openDialog({ view, posts }) {
  const { createAiHelpers } = await import('../server/web/aihelpers.js');
  const dialog = fakeDialog();
  const t = (key, vars = {}) => LANGS.en[key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const ok = { ok: true, status: 200, ...view };
  const api = {
    aiHelpers: async () => ok,
    aiActivity: async () => ({ ok: true, items: [] }),
    setAiHelper: async (body) => { posts.push(body); return ok; },
    setAiKey: async (provider, key) => { posts.push({ provider, key }); return ok; },
    removeAiKey: async () => ok,
    testAiKey: async () => ({ ok: true, status: 200, costUSD: 0.00002 }),
  };
  await createAiHelpers({ dialog, h: el, t: () => t, lang: () => 'en', api, toast() {}, errorText: (e) => e, openers: [] }).open();
  return dialog;
}

const catalog = ['openai', 'gemini', 'deepseek', 'openrouter'].map((id) => ({ id, name: id, keyUrl: `https://example.com/${id}`, defaultModel: `${id}-model` }));
const baseView = (patch = {}) => ({
  providers: catalog,
  keys: [{ provider: 'openai', last4: '1234' }, { provider: 'gemini', last4: '5678' }],
  others: { enabled: true, dailyUSD: 1, off: ['gemini'], models: {}, keys: ['gemini', 'openai'] },
  status: { others },
  ...patch,
});

test('the dialog has one block per AI with a switch, ONE daily limit, and no "use for bulk work" choice', async () => {
  const dialog = await openDialog({ view: baseView(), posts: [] });
  assert.equal(find(dialog, (n) => n.props['data-ah-on'] !== undefined).length, 4);
  assert.equal(find(dialog, (n) => n.props.id === 'ahCap').length, 1, 'one cap');
  assert.equal(find(dialog, (n) => n.props.type === 'radio').length, 0, 'no radio choice');
  assert.equal(find(dialog, (n) => n.props.id === 'ahModel').length, 0, 'no model to type');
  const text = textOf(dialog);
  assert.match(text, /picks by itself which AI does each task/);
  assert.match(text, /Spent today: \$0\.001 /);
  assert.match(text, /Reviewed by Claude: 5, agreed: 4/);
  const sw = (id) => find(dialog, (n) => n.props['data-ah-on'] === id)[0].props;
  assert.equal(sw('openai').checked, true);
  assert.equal(sw('gemini').checked, false, 'switched off by the owner');
  assert.equal(sw('deepseek').disabled, true, 'no key, no switch');
  assert.equal(sw('deepseek').checked, false);
});

test('flipping a switch asks the server for that AI only, and the limit is one number for all', async () => {
  const posts = [];
  const dialog = await openDialog({ view: baseView(), posts });
  await find(dialog, (n) => n.props['data-ah-on'] === 'gemini')[0].props.onchange({ target: { checked: true } });
  assert.deepEqual(posts.at(-1), { provider: 'gemini', on: true });
  find(dialog, (n) => n.props.id === 'ahCap')[0].props.oninput({ target: { value: '2.5' } });
  await find(dialog, (n) => n.props['data-ah-cap'] === '1')[0].props.onclick();
  assert.deepEqual(posts.at(-1), { dailyUSD: 2.5 });
  await find(dialog, (n) => n.props['data-ah-all'] === '1')[0].props.onchange({ target: { checked: false } });
  assert.deepEqual(posts.at(-1), { enabled: false });
});

test('a bad limit is not sent, and a paused AI shows why with a button to give it another chance', async () => {
  const posts = [];
  const paused = { ...others, providers: others.providers.map((p) => (p.id === 'openai' ? { ...p, paused: true, pausedWhy: { code: 'disagreed', kind: 'place', disagreed: 7, of: 12, at: 'x' } } : p)) };
  const dialog = await openDialog({ view: baseView({ status: { others: paused } }), posts });
  find(dialog, (n) => n.props.id === 'ahCap')[0].props.oninput({ target: { value: '' } });
  await find(dialog, (n) => n.props['data-ah-cap'] === '1')[0].props.onclick();
  assert.equal(posts.length, 0);
  assert.match(textOf(dialog), /Paused by itself: it disagreed with Claude on 7 of the last 12/);
  await find(dialog, (n) => n.props['data-ah-resume'] === 'openai')[0].props.onclick();
  assert.deepEqual(posts.at(-1), { provider: 'openai', on: true });
});

test('a high limit gets a gentle warning', async () => {
  const dialog = await openDialog({ view: baseView({ others: { enabled: true, dailyUSD: 1000, off: [], models: {}, keys: [] } }), posts: [] });
  assert.match(textOf(dialog), /This limit is high/);
});

test('every AI, DeepSeek included, says it does the map\'s routine sorting: nothing is public-only any more', async () => {
  const view = baseView({
    keys: [{ provider: 'openai', last4: '1234' }, { provider: 'deepseek', last4: '0000' }, { provider: 'openrouter', last4: '9999' }],
    others: { enabled: true, dailyUSD: 1, off: [], models: {}, keys: ['deepseek', 'openai', 'openrouter'] },
    status: { others: { ...others, providers: [...others.providers, { id: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', hasKey: true, on: true, paused: false, pausedWhy: null, spentUSDToday: 0, reviewed: 0, agreed: 0, calls: 0, busy: 0 }] } },
  });
  const dialog = await openDialog({ view, posts: [] });
  const blockOf = (id) => textOf(find(dialog, (n) => n.props.for === `ahOn-${id}`)[0]);
  for (const id of ['deepseek', 'openrouter', 'openai']) {
    assert.match(blockOf(id), /routine sorting/, id);
    assert.doesNotMatch(blockOf(id), /only gets public/i, id);
  }
  for (const lang of Object.values(LANGS)) {
    assert.ok(!('aih.publicOnly' in lang));
    assert.doesNotMatch(lang['aih.privacy.deepseek'], /only sends it public|só manda para ela coisas públicas/i);
    assert.doesNotMatch(lang['aih.privacy.openrouter'], /only gets public|só recebe material público/i);
  }
});

test('the dialog says Claude may also send pieces of code or text from chats, and that the switch stops it', async () => {
  for (const lang of Object.values(LANGS)) assert.ok('aih.chatUse' in lang, 'aih.chatUse');
  assert.match(LANGS.en['aih.chatUse'], /chat/i);
  assert.match(LANGS.en['aih.chatUse'], /DeepSeek/);
  assert.match(LANGS['pt-BR']['aih.chatUse'], /conversa/i);
  assert.match(LANGS.en['aih.masterHint'], /second opinion/i);
  assert.match(LANGS['pt-BR']['aih.masterHint'], /segunda/i);
  assert.match(LANGS.en['aih.privacy.gemini'], /client/i);
  const dialog = await openDialog({ view: baseView(), posts: [] });
  assert.ok(textOf(dialog).includes(LANGS.en['aih.chatUse']));
});

// ---- the versions line of each AI (or15) ----

test('each AI\'s versions line: nothing before the first check, "all good", a failed check, or the warnings', async () => {
  const { versionLine } = await import('../server/web/aihelpers.js');
  assert.equal(versionLine(undefined), null);
  assert.deepEqual(versionLine({ checkedAt: '2026-10-11T12:00:00.000Z', ok: true, notes: [] }), { state: 'ok', day: '2026-10-11', notes: [] });
  assert.deepEqual(versionLine({ checkedAt: '2026-10-11T12:00:00.000Z', ok: false, error: 'http-503', notes: [] }), { state: 'failed', day: '2026-10-11', error: 'http-503', notes: [] });
  const warn = versionLine({ checkedAt: '2026-10-11T12:00:00.000Z', ok: true, notes: [{ type: 'new', model: 'gpt-6.2-sol' }, { type: 'gone', model: 'gpt-6-astra' }, { type: 'retiring', model: 'x\ny', date: '2027-01-01' }, { type: 'retiring', model: 'gpt-6-luna', date: 'later' }] });
  assert.equal(warn.state, 'warn');
  assert.deepEqual(warn.notes.map((n) => n.model), ['gpt-6-astra', 'gpt-6.2-sol'], 'gone first; a bad name or date is left out');
});

test('the dialog shows one short versions line under each AI that was checked, in plain words', async () => {
  const versions = {
    openai: { checkedAt: '2026-10-11T12:00:00.000Z', ok: true, notes: [{ type: 'gone', model: 'gpt-6-astra' }, { type: 'retiring', model: 'gpt-6-luna', date: '2027-02-01' }] },
    gemini: { checkedAt: '2026-10-11T12:00:00.000Z', ok: true, notes: [] },
    deepseek: { checkedAt: '2026-10-10T12:00:00.000Z', ok: false, error: 'http-503', notes: [] },
  };
  const dialog = await openDialog({ view: baseView({ versions }), posts: [] });
  const line = (id) => find(dialog, (n) => n.props['data-ah-versions'] === id)[0];
  assert.match(textOf(line('openai')), /Versions/);
  assert.match(textOf(line('openai')), /gpt-6-astra is no longer on the company’s list/);
  assert.match(textOf(line('openai')), /gpt-6-luna will be switched off on 2027-02-01/);
  assert.match(textOf(line('gemini')), /checked 2026-10-11, nothing to warn about/);
  assert.match(textOf(line('deepseek')), /did not work/);
  assert.equal(find(dialog, (n) => n.props['data-ah-versions'] === 'openrouter').length, 0, 'never checked: no line');
  const none = await openDialog({ view: baseView(), posts: [] });
  assert.equal(find(none, (n) => n.props['data-ah-versions'] !== undefined).length, 0, 'an older server sends none');
});

test('the words of the versions line and of the model alerts exist in both languages', () => {
  for (const lang of Object.values(LANGS)) {
    for (const key of ['aih.ver.label', 'aih.ver.ok', 'aih.ver.failed', 'aih.ver.gone', 'aih.ver.retiring', 'aih.ver.new',
      'alert.what.aiv-gone', 'alert.why.aiv-gone', 'alert.do.aiv-gone', 'alert.what.aiv-retiring', 'alert.why.aiv-retiring', 'alert.do.aiv-retiring',
      'alert.what.aiv-new', 'alert.why.aiv-new', 'alert.do.aiv-new', 'alert.many.aiversion']) assert.ok(key in lang, key);
  }
});
