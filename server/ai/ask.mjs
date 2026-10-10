import { join } from 'node:path';
import { log } from '../log.mjs';
import { readJsonFile } from '../store.mjs';
import { getKey, listKeys } from './keys.mjs';
import { lifeOf } from './life.mjs';
import { othersSettings } from './others.mjs';
import { PROVIDERS, estimateCostUSD, runApiJSON, runApiText } from './providers.mjs';
import { SENSITIVITIES, explainRoute, loadStats, routeKindOf } from './router.mjs';

// Claude, as conductor, asks the other AIs directly (or14): a second opinion from another family, a bulk label, a
// draft. The router picks who; this enforces the rules on the way out: the owner's switch, the privacy class
// (DeepSeek only for public data), the one daily cap checked BEFORE each call with a pessimistic estimate, a size
// limit, and redact() (in providers.mjs) on everything sent. Answers are data from another company's model.

export const ASK_KINDS = Object.freeze(['review', 'bulk', 'code', 'read', 'portuguese', 'reasoning']);
export const PROMPT_MAX_BYTES = 200 * 1024;
export const ASK_MAX_OUT_TOKENS = 2048;
export const FANOUT_MAX = 4;
const SCHEMA_MAX = 4000;
const ERROR_RE = /^[a-z0-9-]{1,30}$/;
export const EXCLUDE_MAX = 20;
// 'openai' or 'openai:gpt-6.1-sol': a provider id, or one of its models.
const EXCLUDE_RE = /^[a-z]{1,20}(?::[A-Za-z0-9][A-Za-z0-9._/-]{0,99})?$/;

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const readConfig = (smDir) => readJsonFile(join(smDir, 'config.json'), {}) ?? {};

// -> {ok, answers: [{provider, model, text | value, costUSD, ms}], skipped: [{provider, why}], error?}
// fanout > 1 asks that many different AIs at once. author: who wrote what a review is about (router.mjs).
// exclude: AIs that already failed this work ('openai' or 'openai:gpt-6.1-sol'), left out of the routed order, so the
// next one asked is the one pick_worker recommended. It only removes: the router's rules still pick among the rest.
// queue, settings, keyOf, apiRun, textRun, stats, now: replaceable for tests; by default session-map's own.
export async function askOthers({
  smDir, kind, sensitivity, prompt, schemaHint, fanout = 1, author, exclude,
  queue, settings, keyOf, apiRun = runApiJSON, textRun = runApiText, stats, now = Date.now, onCall,
} = {}) {
  const refuse = (error, skipped = []) => ({ ok: false, error, answers: [], skipped });
  if (!ASK_KINDS.includes(kind)) return refuse('bad-kind');
  if (!SENSITIVITIES.includes(sensitivity)) return refuse('bad-sensitivity');
  if (typeof prompt !== 'string' || !prompt.trim()) return refuse('no-prompt');
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_MAX_BYTES) return refuse('prompt-too-big');
  if (schemaHint != null && (typeof schemaHint !== 'string' || schemaHint.length > SCHEMA_MAX)) return refuse('bad-schema');
  if (exclude != null && !(Array.isArray(exclude) && exclude.length <= EXCLUDE_MAX && exclude.every((x) => typeof x === 'string' && EXCLUDE_RE.test(x)))) return refuse('bad-exclude');
  const left = new Set(exclude ?? []);

  const s = settings ?? othersSettings(readConfig(smDir).ai, listKeys(smDir).map((k) => k.provider));
  if (!s.enabled) return refuse('others-off');
  const q = queue ?? lifeOf(smDir, readConfig(smDir)).queue;
  const keyFor = keyOf ?? ((provider) => getKey(smDir, provider));

  const skipped = [];
  const skip = (provider, why) => {
    if (!skipped.some((x) => x.provider === provider && x.why === why)) skipped.push({ provider, why });
  };
  // The map's bulk work pauses an AI for kind 'place': the same AI is paused for bulk asks.
  const pauseKind = routeKindOf(kind) === 'bulk' ? 'place' : kind;
  const available = [];
  for (const id of Object.keys(PROVIDERS)) {
    if (!(s.keys ?? []).includes(id)) skip(id, 'no-key');
    else if ((s.off ?? []).includes(id)) skip(id, 'off');
    else if (q.pausedFor(id, pauseKind)) skip(id, 'paused');
    else available.push(id);
  }
  const routed = explainRoute({ kind, sensitivity, author, available, stats: stats ?? loadStats(smDir), models: s.models });
  for (const r of routed.skipped) if (r.provider !== 'claude' && r.why !== 'not-available') skip(r.provider, r.why);
  const candidates = routed.candidates.filter((c) => {
    if (!left.has(c.provider) && !left.has(`${c.provider}:${c.model}`)) return true;
    skip(c.provider, 'excluded');
    return false;
  });

  const want = Math.min(FANOUT_MAX, Math.max(1, Number.isInteger(fanout) ? fanout : 1));
  const answers = [];
  const asked = new Set();
  let called = 0;
  let next = 0;
  // estimateUSD: what the ticket holds; booked when the call threw, since nobody knows whether it left.
  const one = async (c, key, ticket, estimateUSD) => {
    const t0 = now();
    let res;
    try {
      const opts = { provider: c.provider, model: c.model, key, maxTokens: ASK_MAX_OUT_TOKENS };
      res = schemaHint ? await apiRun(prompt, { ...opts, schemaHint }) : await textRun(prompt, opts);
    } catch {
      res = { ok: false, error: 'threw', costUSD: estimateUSD }; // never the message: it could quote the request or the key
    }
    const costUSD = Number.isFinite(res?.costUSD) && res.costUSD > 0 ? res.costUSD : 0;
    ticket.settle(costUSD);
    const ms = Math.max(0, now() - t0);
    const error = typeof res?.error === 'string' && ERROR_RE.test(res.error) ? res.error : 'failed';
    // onCall (the activity log): who, what it cost and whether it worked, never the prompt or the answer. It returns the
    // id of the line, which goes back with the answer so Claude can say whether it accepted it.
    const id = typeof onCall === 'function' ? onCall({ provider: c.provider, model: c.model, ms, costUSD, ok: Boolean(res?.ok), ...(res?.ok ? {} : { error }) }) : null;
    if (!res?.ok) return { provider: c.provider, why: error };
    const body = schemaHint ? { value: res.value } : { text: res.text };
    return { answer: { provider: c.provider, model: c.model, ...body, costUSD: round6(costUSD), ms, ...(id ? { id } : {}) } };
  };
  // Rounds: launch as many as still wanted at once; a failure lets the next in line take its place.
  while (answers.length < want && next < candidates.length) {
    const batch = [];
    while (answers.length + batch.length < want && next < candidates.length) {
      const c = candidates[next++];
      if (asked.has(c.provider)) continue;
      const key = await Promise.resolve(keyFor(c.provider)).catch(() => null);
      if (!key) { skip(c.provider, 'no-key'); continue; }
      const estimateUSD = estimateCostUSD(c.provider, c.model, prompt, ASK_MAX_OUT_TOKENS, schemaHint ?? '');
      const ticket = q.reserveOutside(c.provider, estimateUSD, s.dailyUSD);
      if (!ticket) { skip(c.provider, 'cap'); continue; }
      asked.add(c.provider);
      called++;
      batch.push(one(c, key, ticket, estimateUSD));
    }
    for (const r of await Promise.all(batch)) {
      if (r.answer) answers.push(r.answer);
      else skip(r.provider, r.why);
    }
  }

  const costUSD = round6(answers.reduce((sum, a) => sum + a.costUSD, 0));
  log('info', 'ai-ask', { kind, sensitivity, fanout: want, asked: [...asked], answered: answers.map((a) => a.provider), costUSD });
  if (!answers.length) return { ok: false, error: called ? 'all-failed' : 'no-ai-available', answers, skipped };
  return { ok: true, answers, skipped };
}
