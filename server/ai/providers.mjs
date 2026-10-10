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
    // The peak-hour price: off-peak is half, so the daily cap errs on the safe side.
    pricesUSDPerMTok: {
      'deepseek-flash': { in: 0.3, out: 1.2 },
      'deepseek-v4-flash': { in: 0.3, out: 1.2 },
      'deepseek-v4-pro': { in: 1.32, out: 3.96 },
    },
    priceSource: 'https://api-docs.deepseek.com/quick_start/pricing',
    priceCheckedOn: CHECKED_ON,
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
  },
});

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;

export const providerOf = (id) => (Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null);

// What the page may show: the catalog has no secrets, the copy keeps the frozen original out of reach.
export const publicCatalog = () => Object.values(PROVIDERS).map(({ extraBody, ...p }) => structuredClone(p));

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
function readAnswer(providerId, model, data) {
  const content = data?.choices?.[0]?.message?.content;
  const usage = data?.usage ?? {};
  const tokensIn = Number(usage.prompt_tokens) || 0;
  const tokensOut = Number(usage.completion_tokens) || 0;
  const costUSD = Number.isFinite(usage.cost) ? usage.cost : costOf(providerId, model, tokensIn, tokensOut);
  return { content, tokensIn, tokensOut, costUSD };
}

// Same shape as runClaudeJSON, plus who answered and the tokens. Errors are short codes: never the key, a header
// or the body of the reply, which some providers echo the key into.
export async function runApiJSON(prompt, { provider, model, key, schemaHint, fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const p = providerOf(provider);
  const fail = (error, extra = {}) => {
    log('warn', 'ai-api-failed', { provider: p?.id ?? 'unknown', error });
    return { ok: false, error, ...(p ? { provider: p.id } : {}), ...extra };
  };
  if (!p) return fail('unknown-provider');
  if (typeof key !== 'string' || !key) return fail('no-key');
  const usedModel = model || p.defaultModel;
  const body = {
    model: usedModel,
    messages: [{ role: 'user', content: redact(promptWithHint(prompt, schemaHint)) }],
    temperature: 0,
    max_tokens: MAX_TOKENS,
    ...(p.extraBody ?? {}),
  };
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
      return fail(`http-${res.status}`);
    }
    try { data = await res.json(); } catch (err) {
      return fail(controller.signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'bad-output');
    }
  } catch (err) {
    return fail(controller.signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  const { content, tokensIn, tokensOut, costUSD } = readAnswer(p.id, usedModel, data);
  const meta = { costUSD, provider: p.id, model: usedModel, tokensIn, tokensOut };
  if (typeof content !== 'string') return fail('bad-output', meta);
  const value = extractJSON(content);
  if (!value) return fail('no-json', meta);
  return { ok: true, value, ...meta };
}
