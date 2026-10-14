import { log } from '../log.mjs';
import { redact } from './redact.mjs';
import { extractJSON } from './runner.mjs';

// Other AIs that take session-map's bulk work off Claude (sb07). All four speak the OpenAI chat-completions format,
// so one call fits them all. Prices are per million tokens, checked by hand on the date given: they change often.
const CHECKED_ON = '2026-10-10';

export const PROVIDERS = Object.freeze({
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    goodFor: 'One key that reaches many AIs; it reports the exact cost of each answer.',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    keyUrl: 'https://openrouter.ai/keys',
    privacyNote: 'Calls ask OpenRouter to use only providers that neither keep nor train on the data (data_collection: deny); a model no such provider serves fails instead of leaking.',
    pricesUSDPerMTok: {
      'deepseek/deepseek-v4.1-flash': { in: 0.3, out: 1.2 },
      'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
    },
    priceSource: 'https://openrouter.ai/api/v1/models',
    priceCheckedOn: CHECKED_ON,
    // usage.include: OpenRouter then reports what it charged, which the daily cap books instead of an estimate.
    extraBody: { provider: { data_collection: 'deny' }, usage: { include: true } },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    goodFor: 'Very cheap for sorting and classifying, straight from the maker.',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    privacyNote: 'Servers in China, and the policy does not rule out training on what is sent: never use it for personal or client data.',
    // The peak-hour price: off-peak is half, so the daily cap errs on the safe side. cacheHit: the context-cache price
    // per million input tokens (peak), for the usage rows the DeepSeek Harness writes (checked 2026-10-14 on the
    // official pricing page: flash $0.006, v4-pro $0.044). The legacy name deepseek-v4-flash is billed at the Flash price.
    pricesUSDPerMTok: {
      'deepseek-flash': { in: 0.3, out: 1.2, cacheHit: 0.006 },
      'deepseek-v4-flash': { in: 0.3, out: 1.2, cacheHit: 0.006 },
      'deepseek-v4-pro': { in: 1.32, out: 3.96, cacheHit: 0.044 },
    },
    priceSource: 'https://api-docs.deepseek.com/quick_start/pricing',
    priceCheckedOn: CHECKED_ON,
    // Thinking is on by default and its hidden reasoning ate the whole answer budget (bench of 2026-10-10): these
    // short JSON and text jobs ask for none (https://api-docs.deepseek.com/api/create-chat-completion).
    requestExtras: {
      'deepseek-flash': { body: { thinking: { type: 'disabled' } } },
      'deepseek-v4-flash': { body: { thinking: { type: 'disabled' } } },
      'deepseek-v4-pro': { body: { thinking: { type: 'disabled' } } },
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    goodFor: 'Google AI, fast and low-cost, for short and repetitive questions.',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.1-flash-lite',
    keyUrl: 'https://aistudio.google.com/apikey',
    privacyNote: 'On the free tier Google may use what is sent to improve its products: use a key from a project with billing turned on.',
    // Google says these prices double from 2027-01-01. The 2.5 family is only served to past users: not offered.
    pricesUSDPerMTok: {
      'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
      'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
      'gemini-3.8-flash': { in: 0.75, out: 3.75 },
    },
    priceSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    priceCheckedOn: CHECKED_ON,
    // Gemini 3 always thinks a little (https://ai.google.dev/gemini-api/docs/openai): the lowest level each model
    // accepts, and room for it on top of the answer. gemini-3.8-flash refuses 'minimal' with HTTP 400.
    requestExtras: {
      'gemini-3.1-flash-lite': { body: { reasoning_effort: 'minimal' }, reasoningRoomTokens: 1024 },
      'gemini-3.5-flash-lite': { body: { reasoning_effort: 'minimal' }, reasoningRoomTokens: 1024 },
      'gemini-3.8-flash': { body: { reasoning_effort: 'low' }, reasoningRoomTokens: 1024 },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT)',
    goodFor: 'Luna: cheap bulk labels from a fixed answer list (it guesses rather than say "I do not know", so Claude checks it). Sol: a second opinion from another AI family.',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-6-luna',
    keyUrl: 'https://platform.openai.com/api-keys',
    privacyNote: 'API data is not used for training unless you opt in, and is kept up to 30 days for abuse monitoring. Storage in Brazil is not offered.',
    // No cost comes back in the reply: it is worked out from the tokens used.
    pricesUSDPerMTok: {
      'gpt-6-luna': { in: 0.1, out: 0.5 },
      'gpt-6.1-sol': { in: 2, out: 10 },
      'gpt-6-astra': { in: 10, out: 50 },
    },
    priceSource: 'https://openai.com/api/pricing/',
    priceCheckedOn: CHECKED_ON,
    // Checked against the API on 2026-10-10: every gpt-6 model refuses max_tokens (HTTP 400), Luna takes reasoning
    // 'none', Sol and Astra start at 'low' and take only the default temperature. null: the field is left out.
    maxTokensField: 'max_completion_tokens',
    requestExtras: {
      'gpt-6-luna': { body: { reasoning_effort: 'none' } },
      'gpt-6.1-sol': { body: { reasoning_effort: 'low', temperature: null }, reasoningRoomTokens: 1024 },
      'gpt-6-astra': { body: { reasoning_effort: 'low', temperature: null }, reasoningRoomTokens: 1024 },
    },
  },
});

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;
const MAX_TOKENS_CEILING = 8192;
// The longest answer asked for: the caller's, within 1..8192, else 1024.
const outTokens = (n) => (Number.isInteger(n) && n > 0 ? Math.min(n, MAX_TOKENS_CEILING) : MAX_TOKENS);

export const providerOf = (id) => (Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null);

// What one model needs in its request ({ body, reasoningRoomTokens }), or nothing for a model not in the catalog:
// it gets no field it might refuse.
const extrasOf = (p, model) => (p?.requestExtras && Object.hasOwn(p.requestExtras, model) ? p.requestExtras[model] : {});

// The token budget a call asks for: the answer's, plus room for reasoning the model cannot skip.
export const maxAnswerTokens = (providerId, model, maxTokens) => {
  const p = providerOf(providerId);
  return outTokens(maxTokens) + (Number(extrasOf(p, model || p?.defaultModel).reasoningRoomTokens) || 0);
};

// What the page may show: the catalog has no secrets, the copy keeps the frozen original out of reach.
export const publicCatalog = () => Object.values(PROVIDERS).map(({ extraBody, requestExtras, maxTokensField, ...p }) => structuredClone(p));

// A model missing from the catalog could be any AI the owner typed, up to the dearest on the market: it is priced
// above those, so the daily cap stops early rather than late. OpenRouter's own reported cost wins over this anyway.
const UNKNOWN_MODEL_PRICE = Object.freeze({ in: 20, out: 100 });

export function costOf(providerId, model, tokensIn, tokensOut) {
  const prices = providerOf(providerId)?.pricesUSDPerMTok ?? {};
  const price = Object.hasOwn(prices, model) ? prices[model] : UNKNOWN_MODEL_PRICE;
  return ((tokensIn || 0) * price.in + (tokensOut || 0) * price.out) / 1e6;
}

const promptWithHint = (prompt, schemaHint) => (schemaHint ? `${prompt}\n\nReply with one JSON object only, no prose, shaped like:\n${schemaHint}\n` : prompt);

// The OpenAI-style answer: text and token counts; OpenRouter adds what it charged in usage.cost.
// A reply without token counts was still paid for: it costs the pessimistic estimate, never $0.
// Hidden thinking that only shows in total_tokens (Gemini leaves it out of completion_tokens) is billed as answer.
function readAnswer(providerId, model, data, estimateUSD) {
  const content = data?.choices?.[0]?.message?.content;
  const cut = data?.choices?.[0]?.finish_reason === 'length';
  const usage = data?.usage ?? {};
  const tokensIn = Number(usage.prompt_tokens) || 0;
  const tokensOut = Math.max(Number(usage.completion_tokens) || 0, (Number(usage.total_tokens) || 0) - tokensIn);
  const counted = Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens);
  const costUSD = Number.isFinite(usage.cost) ? usage.cost : counted ? costOf(providerId, model, tokensIn, tokensOut) : estimateUSD;
  return { content, cut, tokensIn, tokensOut, costUSD };
}

// Pessimistic on purpose: real text runs nearer 4 characters per token. Checked against the daily cap before a call.
const CHARS_PER_TOKEN = 2;
const HINT_TOKENS = 100;
export function estimateCostUSD(providerId, model, prompt, maxTokens = MAX_TOKENS, schemaHint = '') {
  const tokensIn = Math.ceil((String(prompt ?? '').length + String(schemaHint ?? '').length) / CHARS_PER_TOKEN) + HINT_TOKENS;
  const usedModel = model || providerOf(providerId)?.defaultModel;
  return costOf(providerId, usedModel, tokensIn, maxAnswerTokens(providerId, usedModel, maxTokens));
}

// Network errors that mean the request never reached the provider.
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

// One chat call -> {ok: true, content, meta} or a failure. Errors are short codes: never the key, a header or the
// body of the reply, which some providers echo the key into. Everything sent goes through redact().
async function callApi(text, { provider, model, key, fetchFn = fetch, timeoutMs = TIMEOUT_MS, maxTokens } = {}) {
  const p = providerOf(provider);
  const fail = (error, extra = {}) => {
    log('warn', 'ai-api-failed', { provider: p?.id ?? 'unknown', error });
    return { ok: false, error, ...(p ? { provider: p.id } : {}), ...extra };
  };
  if (!p) return { fail: fail('unknown-provider') };
  if (typeof key !== 'string' || !key) return { fail: fail('no-key') };
  const usedModel = model || p.defaultModel;
  const body = {
    model: usedModel,
    messages: [{ role: 'user', content: redact(text) }],
    temperature: 0,
    [p.maxTokensField ?? 'max_tokens']: maxAnswerTokens(p.id, usedModel, maxTokens),
    ...(p.extraBody ?? {}),
    ...(extrasOf(p, usedModel).body ?? {}),
  };
  for (const [field, value] of Object.entries(body)) if (value === null) delete body[field];
  // Once the request has left, the provider may bill it even if no answer or no cost comes back (a timeout, a dropped
  // socket): such a failure carries the pessimistic estimate, which the daily cap books. Refused before any answer
  // (HTTP errors, a connection that never opened) costs nothing.
  const estimateUSD = estimateCostUSD(p.id, usedModel, text, maxTokens);
  const sent = { costUSD: estimateUSD };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const res = await fetchFn(p.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'session-map' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text?.().catch(() => {}); // drained, never read: error bodies may quote the key
      return { fail: fail(`http-${res.status}`) };
    }
    try { data = await res.json(); } catch (err) {
      return { fail: fail(controller.signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'bad-output', sent) };
    }
  } catch (err) {
    if (controller.signal.aborted || err?.name === 'AbortError') return { fail: fail('timeout', sent) };
    return { fail: fail('network', NOT_SENT.has(err?.cause?.code) ? {} : sent) };
  } finally {
    clearTimeout(timer);
  }
  const { content, cut, tokensIn, tokensOut, costUSD } = readAnswer(p.id, usedModel, data, estimateUSD);
  const meta = { costUSD, provider: p.id, model: usedModel, tokensIn, tokensOut };
  // Stopped by the length limit with nothing to show (reasoning ate the budget): 'answer-cut', never a bad answer.
  if (cut && !(typeof content === 'string' && content.trim())) return { fail: fail('answer-cut', meta) };
  if (typeof content !== 'string') return { fail: fail('bad-output', meta) };
  return { content, cut, meta, fail: null, failWith: (error) => fail(error, meta) };
}

// Same shape as runClaudeJSON, plus who answered and the tokens.
export async function runApiJSON(prompt, { schemaHint, ...opts } = {}) {
  const r = await callApi(promptWithHint(prompt, schemaHint), opts);
  if (r.fail) return r.fail;
  const value = extractJSON(r.content);
  if (!value) return r.failWith(r.cut ? 'answer-cut' : 'no-json');
  return { ok: true, value, ...r.meta };
}

// A plain-text answer (a review, a summary, a draft): {ok, text, costUSD, provider, model, tokensIn, tokensOut}.
export async function runApiText(prompt, opts = {}) {
  const r = await callApi(prompt, opts);
  if (r.fail) return r.fail;
  const text = r.content.trim();
  if (!text) return r.failWith('empty');
  return { ok: true, text, ...r.meta };
}
