import test from 'node:test';
import assert from 'node:assert/strict';
import { providerName, providerSpend, usdText, whyKey } from '../server/web/aihelpers.js';
import { LANGS } from '../server/web/i18n.js';

const helper = { provider: 'openrouter', model: 'm', enabled: true, spentUSDToday: 0.001, capUSD: 0.5, capReached: false, paused: false, pausedWhy: null, reviewed: 5, agreed: 4 };
const project = (id, extra) => ({ id, ai: { enabled: true, model: 'haiku', spentUSDToday: 0.01, queue: 0, ...extra } });

test('the Costs rows read the machine-wide spend once, never summed across projects', () => {
  const machine = { spentByProviderToday: { claude: 0.03, openrouter: 0.001 }, helper };
  const { rows } = providerSpend({ projects: [project('a', machine), project('b', machine)] });
  assert.deepEqual(rows.map((r) => [r.id, r.usd]), [['claude', 0.03], ['openrouter', 0.001]]);
  assert.equal(rows[1].isHelper, helper);
  assert.equal(rows[0].isHelper, null);
});

test('a helper that is on but spent nothing still has its row, and no helper data means no rows', () => {
  const { rows } = providerSpend({ projects: [project('a', { spentByProviderToday: {}, helper })] });
  assert.deepEqual(rows.map((r) => r.id), ['claude', 'openrouter']);
  assert.deepEqual(providerSpend({ projects: [project('a', {})] }).rows, []);
  assert.deepEqual(providerSpend({ projects: [] }).rows, []);
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
    assert.ok('aih.choicePrivacy' in lang, 'aih.choicePrivacy');
  }
  assert.match(LANGS.en['aih.sent'], /title/i);
  assert.match(LANGS.en['aih.sent'], /names/i);
  assert.match(LANGS['pt-BR']['aih.sent'], /nomes/i);
});
