import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, costOf, providerOf, publicCatalog, runApiJSON } from '../server/ai/providers.mjs';

const KEY = 'sk-or-v1-THISISTHESECRETKEY0123456789abcdef';

const reply = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const chat = (content, usage = { prompt_tokens: 1000, completion_tokens: 100 }) => ({ choices: [{ message: { role: 'assistant', content } }], usage });

function fakeFetch(response) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return typeof response === 'function' ? response(url, init) : response;
  };
  return { fetchFn, calls };
}

// Every line written to stderr while fn runs: the key must never be in one.
async function captureStderr(fn) {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return typeof rest.at(-1) === 'function' ? (rest.at(-1)(), true) : true; };
  try { return { result: await fn(), lines }; } finally { process.stderr.write = original; }
}

test('the catalog has the four providers, each with an endpoint, a default model, a key page, a privacy note and a dated price', () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
  for (const p of Object.values(PROVIDERS)) {
    assert.match(p.endpoint, /^https:\/\//);
    assert.ok(p.name && p.defaultModel && p.privacyNote && p.priceSource, p.id);
    assert.match(p.keyUrl, /^https:\/\//);
    assert.match(p.priceCheckedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.pricesUSDPerMTok[p.defaultModel], `${p.id} prices its default model`);
  }
  assert.equal(PROVIDERS.openrouter.endpoint, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(PROVIDERS.deepseek.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(PROVIDERS.gemini.endpoint, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(PROVIDERS.openai.endpoint, 'https://api.openai.com/v1/chat/completions');
  assert.equal(PROVIDERS.openai.keyUrl, 'https://platform.openai.com/api-keys');
  assert.equal(PROVIDERS.openai.name, 'OpenAI (GPT)');
  assert.equal(providerOf('nope'), null);
  assert.equal(providerOf('gemini').id, 'gemini');
  assert.deepEqual(publicCatalog().map((p) => p.id).sort(), ['deepseek', 'gemini', 'openai', 'openrouter']);
});

test('costOf prices tokens with the catalog, and an unknown model above any real price, so the daily cap never lets more through', () => {
  assert.equal(costOf('gemini', 'gemini-3.1-flash-lite', 1_000_000, 1_000_000), 1.75);
  // Real list prices of dear models the owner could type: an unknown model must never be booked for less.
  assert.ok(costOf('gemini', 'gemini-2.5-pro', 4000, 500) >= (4000 * 1.25 + 500 * 10) / 1e6);
  assert.ok(costOf('openrouter', 'anthropic/claude-opus-4.1', 4000, 500) >= (4000 * 15 + 500 * 75) / 1e6);
  assert.ok(costOf('deepseek', 'deepseek-reasoner-max', 4000, 500) >= costOf('deepseek', 'deepseek-v4-pro', 4000, 500));
});

test('runApiJSON speaks the OpenAI chat format, refuses OpenRouter providers that keep data, and takes the cost OpenRouter reports', async () => {
  const { fetchFn, calls } = fakeFetch(reply(chat('```json\n{"partId": "orders"}\n```', { prompt_tokens: 1200, completion_tokens: 30, cost: 0.00042 })));
  const res = await runApiJSON('Place this work.', { provider: 'openrouter', key: KEY, schemaHint: '{"partId": string}', fetchFn });
  assert.deepEqual(res, { ok: true, value: { partId: 'orders' }, costUSD: 0.00042, provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', tokensIn: 1200, tokensOut: 30 });
  const [call] = calls;
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(call.body.provider, { data_collection: 'deny' });
  assert.deepEqual(call.body.usage, { include: true }, 'OpenRouter is asked for the exact cost');
  assert.equal(call.body.model, 'deepseek/deepseek-v4.1-flash');
  const text = call.body.messages.map((m) => m.content).join('\n');
  assert.match(text, /Place this work\./);
  assert.match(text, /\{"partId": string\}/);
  assert.ok(call.init.signal, 'the call can be cut by the timeout');
});

test('runApiJSON prices the tokens when the provider reports no cost, and sends no OpenRouter-only field elsewhere', async () => {
  const { fetchFn, calls } = fakeFetch(reply(chat('{"partId": null}', { prompt_tokens: 2_000_000, completion_tokens: 500_000 })));
  const res = await runApiJSON('x', { provider: 'gemini', model: 'gemini-3.1-flash-lite', key: 'AIzaKEYKEYKEYKEYKEY', fetchFn });
  assert.equal(res.ok, true);
  assert.equal(res.costUSD, 1.25);
  assert.equal(res.tokensIn, 2_000_000);
  assert.equal(calls[0].body.provider, undefined);
  assert.equal(calls[0].body.usage, undefined);
});

test('the default models are the current cheap ones, never a retired or only-for-past-users name', () => {
  assert.equal(PROVIDERS.gemini.defaultModel, 'gemini-3.1-flash-lite');
  assert.equal(PROVIDERS.deepseek.defaultModel, 'deepseek-flash');
  assert.equal(PROVIDERS.openai.defaultModel, 'gpt-6-luna');
  for (const p of Object.values(PROVIDERS)) {
    assert.ok(!/deepseek-(chat|reasoner)$/.test(p.defaultModel) && !/gemini-2.5/.test(p.defaultModel), p.id);
    assert.ok(!Object.keys(p.pricesUSDPerMTok).some((m) => /^(gemini-2.5|deepseek-(chat|reasoner)$)/.test(m)), `${p.id} lists no retired model`);
  }
  assert.deepEqual(PROVIDERS.gemini.pricesUSDPerMTok['gemini-3.1-flash-lite'], { in: 0.25, out: 1.5 });
  assert.deepEqual(PROVIDERS.gemini.pricesUSDPerMTok['gemini-3.5-flash-lite'], { in: 0.3, out: 2.5 });
  assert.deepEqual(PROVIDERS.gemini.pricesUSDPerMTok['gemini-3.8-flash'], { in: 0.75, out: 3.75 });
  assert.deepEqual(PROVIDERS.deepseek.pricesUSDPerMTok['deepseek-v4-pro'], { in: 1.32, out: 3.96 });
  for (const id of ['gemini', 'deepseek', 'openai']) assert.equal(PROVIDERS[id].priceCheckedOn, '2026-10-10');
});

test('OpenAI: prices per model, the request goes to the OpenAI endpoint with a Bearer key, and the key stays out of the result', async () => {
  assert.deepEqual(PROVIDERS.openai.pricesUSDPerMTok, { 'gpt-6-luna': { in: 0.1, out: 0.5 }, 'gpt-6.1-sol': { in: 2, out: 10 }, 'gpt-6-astra': { in: 10, out: 50 } });
  assert.equal(PROVIDERS.openai.priceSource, 'https://openai.com/api/pricing/');
  assert.equal(costOf('openai', 'gpt-6-luna', 1_000_000, 1_000_000), 0.6);
  assert.equal(costOf('openai', 'gpt-6.1-sol', 1_000_000, 1_000_000), 12);
  assert.equal(costOf('openai', 'gpt-6-astra', 1_000_000, 1_000_000), 60);
  const openaiKey = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefSECRET';
  const { fetchFn, calls } = fakeFetch(reply(chat('{"partId": "orders"}', { prompt_tokens: 2_000_000, completion_tokens: 1_000_000 })));
  const { result, lines } = await captureStderr(() => runApiJSON('Place this.', { provider: 'openai', key: openaiKey, fetchFn }));
  assert.deepEqual(result, { ok: true, value: { partId: 'orders' }, costUSD: 0.7, provider: 'openai', model: 'gpt-6-luna', tokensIn: 2_000_000, tokensOut: 1_000_000 });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${openaiKey}`);
  assert.equal(calls[0].body.model, 'gpt-6-luna');
  assert.equal(calls[0].body.provider, undefined);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  for (const line of lines) assert.ok(!line.includes('SECRET'), line);
  const failed = await runApiJSON('x', { provider: 'openai', key: openaiKey, fetchFn: fakeFetch(reply({ error: { message: `bad ${openaiKey}` } }, { status: 401 })).fetchFn });
  assert.deepEqual(failed, { ok: false, error: 'http-401', provider: 'openai' });
});

test('runApiJSON masks personal data and secrets before the prompt leaves the PC', async () => {
  const { fetchFn, calls } = fakeFetch(reply(chat('{}')));
  await runApiJSON('mail maria@exemplo.com, key sk-ant-api03-abcdefghijklmnopQRST', { provider: 'deepseek', key: 'sk-deepseekkey0123456789', fetchFn });
  const text = JSON.stringify(calls[0].body);
  assert.ok(!text.includes('maria@exemplo.com'));
  assert.ok(!text.includes('abcdefghijklmnopQRST'));
});

test('runApiJSON answers with short error codes instead of throwing', async () => {
  const base = { provider: 'openrouter', key: KEY };
  assert.deepEqual(await runApiJSON('x', { ...base, key: '' }), { ok: false, error: 'no-key', provider: 'openrouter' });
  assert.equal((await runApiJSON('x', { ...base, provider: 'nope' })).error, 'unknown-provider');
  assert.equal((await runApiJSON('x', { ...base, fetchFn: fakeFetch(reply({ error: { message: 'bad key' } }, { status: 401 })).fetchFn })).error, 'http-401');
  assert.equal((await runApiJSON('x', { ...base, fetchFn: fakeFetch(reply({}, { status: 429 })).fetchFn })).error, 'http-429');
  const broken = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); }, text: async () => '<html>' };
  assert.equal((await runApiJSON('x', { ...base, fetchFn: fakeFetch(broken).fetchFn })).error, 'bad-output');
  assert.equal((await runApiJSON('x', { ...base, fetchFn: fakeFetch(reply({ choices: [] })).fetchFn })).error, 'bad-output');
  const prose = await runApiJSON('x', { ...base, fetchFn: fakeFetch(reply(chat('no json here', { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }))).fetchFn });
  assert.equal(prose.error, 'no-json');
  assert.equal(prose.costUSD, 0.001, 'a reply without JSON was still paid for');
  const offline = await runApiJSON('x', { ...base, fetchFn: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(offline.error, 'network');
});

test('runApiJSON gives up after timeoutMs', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const started = Date.now();
  const res = await runApiJSON('x', { provider: 'deepseek', key: 'sk-deepseekkey0123456789', fetchFn: hang, timeoutMs: 50 });
  assert.deepEqual({ ...res, costUSD: undefined }, { ok: false, error: 'timeout', provider: 'deepseek', costUSD: undefined });
  assert.ok(res.costUSD > 0, 'the request left: booked at the estimate');
  assert.ok(Date.now() - started < 2000);
});

test('the key never shows in a result or a log line, whatever goes wrong', async () => {
  const echoKey = (url, init) => reply({ error: { message: `invalid key ${init.headers.Authorization}` } }, { status: 401 });
  const scenarios = [
    fakeFetch(echoKey).fetchFn,
    fakeFetch(reply({}, { status: 429 })).fetchFn,
    fakeFetch(reply(chat(`no json, your key was ${KEY}`))).fetchFn,
    async () => { throw new Error(`socket closed while sending Bearer ${KEY}`); },
    fakeFetch(reply(chat('{"ok": true}'))).fetchFn,
  ];
  for (const fetchFn of scenarios) {
    const { result, lines } = await captureStderr(() => runApiJSON('x', { provider: 'openrouter', key: KEY, fetchFn }));
    assert.ok(!JSON.stringify(result).includes(KEY), JSON.stringify(result));
    for (const line of lines) assert.ok(!line.includes(KEY), line);
    assert.ok(!JSON.stringify(result).includes('THISISTHESECRET'));
  }
});

test('runApiText returns the plain answer, redacted on the way out and capped in length, with the same failures as runApiJSON', async () => {
  const { runApiText } = await import('../server/ai/providers.mjs');
  const { fetchFn, calls } = fakeFetch(reply(chat('  Looks fine, but line 3 divides by zero.  ')));
  const got = await runApiText(`Review this. token=${KEY}`, { provider: 'openai', model: 'gpt-6.1-sol', key: KEY, maxTokens: 2048, fetchFn });
  assert.equal(got.ok, true);
  assert.equal(got.text, 'Looks fine, but line 3 divides by zero.');
  assert.equal(got.provider, 'openai');
  assert.equal(got.model, 'gpt-6.1-sol');
  assert.equal(got.costUSD, costOf('openai', 'gpt-6.1-sol', 1000, 100));
  assert.ok(calls[0].body.max_completion_tokens >= 2048, 'the asked length, plus room for reasoning');
  assert.equal(calls[0].body.messages[0].content.includes(KEY), false, 'the key is redacted before it leaves');
  assert.equal(calls[0].body.messages[0].content.includes('Reply with one JSON'), false, 'plain text: no JSON instruction');

  const empty = await runApiText('x', { provider: 'openai', key: KEY, fetchFn: fakeFetch(reply(chat('   '))).fetchFn });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'empty');
  const http = await runApiText('x', { provider: 'openai', key: KEY, fetchFn: fakeFetch(reply('nope', { status: 401 })).fetchFn });
  assert.deepEqual([http.ok, http.error], [false, 'http-401']);
  assert.equal((await runApiText('x', { provider: 'nope', key: KEY })).error, 'unknown-provider');
  assert.equal((await runApiText('x', { provider: 'openai' })).error, 'no-key');
});

test('maxTokens is clamped, and runApiJSON keeps its usual 1024 when none is given', async () => {
  const { fetchFn, calls } = fakeFetch(reply(chat('{"ok": true}')));
  await runApiJSON('x', { provider: 'openrouter', key: KEY, fetchFn });
  await runApiJSON('x', { provider: 'openrouter', key: KEY, fetchFn, maxTokens: 1e9 });
  await runApiJSON('x', { provider: 'openrouter', key: KEY, fetchFn, maxTokens: -5 });
  assert.deepEqual(calls.map((c) => c.body.max_tokens), [1024, 8192, 1024]);
});

// Thinking models spend hidden reasoning out of the same token budget as the answer: with nothing set, DeepSeek and
// Gemini 3.8 used it all and the answer came back empty (bench run 2026-10-10-21-43-44). Each model gets what it needs.
async function bodyFor(provider, model, opts = {}) {
  const { fetchFn, calls } = fakeFetch(reply(chat('{"ok": true}')));
  const res = await runApiJSON('x', { provider, model, key: KEY, fetchFn, ...opts });
  assert.equal(res.ok, true, `${provider}:${model}`);
  return calls[0].body;
}

test('DeepSeek: thinking is turned off, so the whole budget goes to the answer', async () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
    const body = await bodyFor('deepseek', model);
    assert.deepEqual(body.thinking, { type: 'disabled' }, model);
    assert.equal(body.max_tokens, 1024, model);
    assert.equal(body.temperature, 0, model);
    assert.equal(body.reasoning_effort, undefined, model);
  }
  assert.equal((await bodyFor('deepseek', 'deepseek-some-new-model')).thinking, undefined, 'a model not in the catalog gets no field it may refuse');
});

test('Gemini 3: the lowest thinking level each model accepts, and room for it on top of the answer', async () => {
  const lite = await bodyFor('gemini', 'gemini-3.1-flash-lite');
  assert.equal(lite.reasoning_effort, 'minimal');
  assert.equal((await bodyFor('gemini', 'gemini-3.5-flash-lite')).reasoning_effort, 'minimal');
  // gemini-3.8-flash answers HTTP 400 to 'minimal' (checked 2026-10-10): 'low' is its lowest.
  const flash = await bodyFor('gemini', 'gemini-3.8-flash');
  assert.equal(flash.reasoning_effort, 'low');
  assert.ok(flash.max_tokens > 1024, 'thinking cannot be turned off on Gemini 3: the answer keeps its 1024');
  assert.equal(flash.temperature, 0);
  assert.equal(flash.thinking, undefined);
});

test('OpenAI gpt-6: max_completion_tokens, the lowest reasoning each model accepts, and no temperature where only 1 is allowed', async () => {
  const luna = await bodyFor('openai', 'gpt-6-luna');
  assert.equal(luna.max_tokens, undefined, "OpenAI answers HTTP 400 to 'max_tokens'");
  assert.equal(luna.max_completion_tokens, 1024);
  assert.equal(luna.reasoning_effort, 'none');
  assert.equal(luna.temperature, 0);
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    const body = await bodyFor('openai', model);
    assert.equal(body.reasoning_effort, 'low', model);
    assert.ok(!('temperature' in body), `${model} refuses temperature 0`);
    assert.ok(body.max_completion_tokens > 1024, `${model} reasons a little: the answer keeps its 1024`);
    assert.equal(body.max_tokens, undefined);
  }
  const typed = await bodyFor('openai', 'gpt-7-new', { maxTokens: 300 });
  assert.equal(typed.max_completion_tokens, 300, 'any OpenAI model takes max_completion_tokens');
  assert.equal(typed.reasoning_effort, undefined);
});

test('OpenRouter keeps its plain request, and the catalog page does not show the request fields', async () => {
  const body = await bodyFor('openrouter', undefined);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'provider', 'temperature', 'usage']);
  for (const p of publicCatalog()) assert.equal(p.requestExtras, undefined, p.id);
});

test('an answer the length limit cut off is answer-cut, so callers can tell it from a reply without JSON', async () => {
  const cut = (content) => fakeFetch(reply({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 1024 } })).fetchFn;
  for (const content of ['', null, '{"code": "export function f(']) {
    const res = await runApiJSON('x', { provider: 'deepseek', key: KEY, fetchFn: cut(content) });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'answer-cut', JSON.stringify(content));
    assert.equal(res.costUSD, costOf('deepseek', 'deepseek-flash', 100, 1024), 'the cut answer was paid for');
  }
  const { runApiText } = await import('../server/ai/providers.mjs');
  assert.equal((await runApiText('x', { provider: 'deepseek', key: KEY, fetchFn: cut('') })).error, 'answer-cut');
  const stopped = fakeFetch(reply({ choices: [{ message: { content: 'no json' }, finish_reason: 'stop' }] })).fetchFn;
  assert.equal((await runApiJSON('x', { provider: 'deepseek', key: KEY, fetchFn: stopped })).error, 'no-json', 'a finished reply without JSON stays no-json');
});

test('hidden thinking that only shows in total_tokens is billed as answer tokens', async () => {
  // Gemini's OpenAI-style usage leaves thinking out of completion_tokens (seen 2026-10-10: 45 in, 11 out, 1054 total).
  const { fetchFn } = fakeFetch(reply(chat('{"ok": true}', { prompt_tokens: 45, completion_tokens: 11, total_tokens: 1054 })));
  const res = await runApiJSON('x', { provider: 'gemini', model: 'gemini-3.8-flash', key: KEY, fetchFn });
  assert.equal(res.tokensOut, 1009);
  assert.equal(res.costUSD, costOf('gemini', 'gemini-3.8-flash', 45, 1009));
});

test('estimateCostUSD is pessimistic: more tokens than the text has, and the full answer length', async () => {
  const { estimateCostUSD } = await import('../server/ai/providers.mjs');
  const prompt = 'x'.repeat(4000);
  const est = estimateCostUSD('openai', 'gpt-6.1-sol', prompt, 1024);
  assert.ok(est >= costOf('openai', 'gpt-6.1-sol', 1000, 1024), String(est));
  assert.equal(estimateCostUSD('openai', 'gpt-6.1-sol', prompt), est, '1024 answer tokens by default');
  assert.ok(estimateCostUSD('openrouter', 'some/unknown-model', 'x', 10) >= costOf('openrouter', 'some/unknown-model', 1, 10));
});

test('a call that left but whose cost is unknown is booked at the pessimistic estimate, never at $0', async () => {
  const { estimateCostUSD, runApiText } = await import('../server/ai/providers.mjs');
  const prompt = 'y'.repeat(30_000);
  const est = estimateCostUSD('openai', 'gpt-6-astra', prompt, 2048);
  assert.ok(est > 0.05, String(est));
  const base = { provider: 'openai', model: 'gpt-6-astra', key: KEY, maxTokens: 2048 };
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const timedOut = await runApiText(prompt, { ...base, fetchFn: hang, timeoutMs: 20 });
  assert.equal(timedOut.error, 'timeout');
  assert.equal(timedOut.costUSD, est, 'the request was sent: the provider may still bill it');
  const noUsage = await runApiText(prompt, { ...base, fetchFn: fakeFetch(reply({ choices: [{ message: { content: 'fine' } }] })).fetchFn });
  assert.equal(noUsage.ok, true);
  assert.equal(noUsage.costUSD, est, 'a reply without token counts is not free');
  const dropped = await runApiText(prompt, { ...base, fetchFn: async () => { throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }); } });
  assert.deepEqual([dropped.error, dropped.costUSD], ['network', est], 'the socket closed after sending');
  const refused = await runApiText(prompt, { ...base, fetchFn: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } });
  assert.deepEqual([refused.error, refused.costUSD ?? 0], ['network', 0], 'nothing left the PC');
  const http = await runApiText(prompt, { ...base, fetchFn: fakeFetch(reply({}, { status: 401 })).fetchFn });
  assert.equal(http.costUSD ?? 0, 0, 'refused before any answer was made');
});
