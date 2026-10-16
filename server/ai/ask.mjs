import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { withStance } from './stance.mjs';
import { log } from '../log.mjs';
import { readJsonFile } from '../store.mjs';
import { getKey, listKeys } from './keys.mjs';
import { lifeOf } from './life.mjs';
import { othersSettings } from './others.mjs';
import { PROVIDERS, estimateCostUSD, runApiJSON, runApiText } from './providers.mjs';
import { SENSITIVITIES, explainRoute, familyOf, loadStats, routeKindOf } from './router.mjs';
import { activeGroupOf, applyGroup } from './groups.mjs';
import { isQuotaError, isQuotaPaused, markQuotaError, noteQuotaOk, preflight, quotaFile, quotaPause, readQuota } from './quota.mjs';
import { CHECK_CONFIDENCE, CHECKER_SCHEMA, MAX_CLIMBS, REVIEW_SCHEMA, attemptsLeft, checkerPrompt, climbs, contractHint, contractOf, pickChecker } from './contract.mjs';
import { AI_FUNCTIONS, functionsOf } from './brainpanel.mjs';
import { levelsOf } from './efforts.mjs';

// Claude, as conductor, asks the other AIs directly (or14): a second opinion from another family, a bulk label, a
// draft. The router picks who; this enforces the rules on the way out: the owner's switch, the one daily cap checked BEFORE each call with a pessimistic estimate, a size
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
  smDir, kind, sensitivity, prompt, schemaHint, fanout = 1, author, exclude, contract = false,
  queue, settings, keyOf, apiRun = runApiJSON, textRun = runApiText, stats, now = Date.now, onCall,
} = {}) {
  const refuse = (error, skipped = []) => ({ ok: false, error, answers: [], skipped });
  if (!ASK_KINDS.includes(kind)) return refuse('bad-kind');
  if (!SENSITIVITIES.includes(sensitivity)) return refuse('bad-sensitivity');
  if (typeof prompt !== 'string' || !prompt.trim()) return refuse('no-prompt');
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_MAX_BYTES) return refuse('prompt-too-big');
  if (schemaHint != null && (typeof schemaHint !== 'string' || schemaHint.length > SCHEMA_MAX)) return refuse('bad-schema');
  // The review kind asks with the vendored senior-dev method (id142): the whole review shape, by default.
  schemaHint = schemaHint ?? (kind === 'review' ? REVIEW_SCHEMA : null);
  if (exclude != null && !(Array.isArray(exclude) && exclude.length <= EXCLUDE_MAX && exclude.every((x) => typeof x === 'string' && EXCLUDE_RE.test(x)))) return refuse('bad-exclude');
  const left = new Set(exclude ?? []);
  // What leaves: the prompt, with the stance rule before it when the AI is asked to judge (or27).
  const sent = withStance(kind, prompt);
  // The exit contract (or37): the asked JSON wrapped in {status, confidence, answer, reason} for every provider, so
  // the conductor switches AIs without reconfiguring anything. Text tasks have no schema: no wrapper.
  const contractOn = contract === true && schemaHint != null;
  const askHint = contractOn ? contractHint(schemaHint) : schemaHint;

  const cfg = readConfig(smDir);
  const s = settings ?? othersSettings(cfg.ai, listKeys(smDir).map((k) => k.provider));
  if (!s.enabled) return refuse('others-off');
  const q = queue ?? lifeOf(smDir, cfg).queue;
  const keyFor = keyOf ?? ((provider) => getKey(smDir, provider));
  // The credit state and the owner's group: the failover pieces (or36). A state write that fails is never worth
  // failing the ask: the next call re-learns from the provider's errors.
  const group = activeGroupOf(cfg.ai);
  let qstate = readQuota(smDir);
  const saveQuota = () => { try { writeFileSync(quotaFile(smDir), JSON.stringify(qstate)); } catch { /* the ask goes on */ } };
  // The Cérebro's function choices (or39/or41): the model and level of a function apply when the routed candidate
  // matches the chosen engine, and the level is one that engine really accepts (efforts.mjs) — never forced.
  const fnChoices = functionsOf(cfg.ai);
  const fnChoiceOf = (k) => {
    const row = AI_FUNCTIONS.find((f) => (f.kinds ?? []).includes(routeKindOf(k)));
    return row ? fnChoices[row.id] ?? null : null;
  };

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
    else if (isQuotaPaused(qstate, id)) skip(id, 'quota');
    else available.push(id);
  }
  const routed = explainRoute({ kind, sensitivity, author, available, stats: stats ?? loadStats(smDir), models: s.models });
  for (const r of routed.skipped) if (r.provider !== 'claude' && r.why !== 'not-available') skip(r.provider, r.why);
  const grouped = applyGroup(routed.candidates, group, { kind, authorFamily: author ? familyOf(author) : null });
  for (const r of grouped.skipped) skip(r.provider, r.why);
  const candidates = grouped.candidates.filter((c) => {
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
  const one = async (c, key, ticket, estimateUSD, prompt = sent, jsonHint = askHint, fnc = fnChoiceOf(kind)) => {
    const t0 = now();
    let res;
    try {
      // The function's own choice rides along when this candidate is the chosen engine (or39/or41).
      const match = fnc && (fnc.provider === undefined || fnc.provider === c.provider);
      const useModel = match && fnc?.model ? fnc.model : c.model;
      const useEffort = match && fnc?.effort && fnc.effort !== 'auto' && levelsOf(c.provider, useModel).includes(fnc.effort) ? fnc.effort : null;
      const opts = { provider: c.provider, model: useModel, key, maxTokens: ASK_MAX_OUT_TOKENS, ...(useEffort ? { effort: useEffort } : {}) };
      res = jsonHint ? await apiRun(prompt, { ...opts, schemaHint: jsonHint }) : await textRun(prompt, opts);
    } catch {
      res = { ok: false, error: 'threw', costUSD: estimateUSD }; // never the message: it could quote the request or the key
    }
    const costUSD = Number.isFinite(res?.costUSD) && res.costUSD > 0 ? res.costUSD : 0;
    ticket.settle(costUSD);
    const ms = Math.max(0, now() - t0);
    const error = typeof res?.error === 'string' && ERROR_RE.test(res.error) ? res.error : 'failed';
    // Credit signals learn across calls: an empty provider is paused for the cooldown, a success clears the pause.
    if (isQuotaError(error)) { qstate = markQuotaError(qstate, c.provider, error, now()); saveQuota(); }
    else if (res?.ok && quotaPause(qstate, c.provider, now())) { qstate = noteQuotaOk(qstate, c.provider); saveQuota(); }
    // onCall (the activity log): who, what it cost and whether it worked, never the prompt or the answer. It returns the
    // id of the line, which goes back with the answer so Claude can say whether it accepted it.
    const id = typeof onCall === 'function' ? onCall({
      provider: c.provider, model: c.model, ms, costUSD, ok: Boolean(res?.ok), ...(res?.ok ? {} : { error }),
      ...(Number.isFinite(res?.tokensIn) && res.tokensIn > 0 ? { tokensIn: res.tokensIn } : {}),
      ...(Number.isFinite(res?.tokensOut) && res.tokensOut > 0 ? { tokensOut: res.tokensOut } : {}),
      ...(Number.isFinite(res?.tokensCacheHit) && res.tokensCacheHit > 0 ? { cacheHit: res.tokensCacheHit } : {}),
    }) : null;
    if (!res?.ok) return { provider: c.provider, why: error, climbs: true };
    // The contract (or37): unwrap {status, confidence, answer, reason}; a bare answer is graded instead of failing.
    if (contractOn && jsonHint != null) {
      const ct = contractOf({ value: res.value, error: null });
      const body = { provider: c.provider, model: c.model, value: ct.answer, costUSD: round6(costUSD), ms, contract: { status: ct.status, confidence: ct.confidence, reason: ct.reason } };
      if (id) body.id = id;
      return { answer: body, climbs: climbs(ct) };
    }
    const body = jsonHint ? { value: res.value } : { text: res.text };
    return { answer: { provider: c.provider, model: c.model, ...body, costUSD: round6(costUSD), ms, ...(id ? { id } : {}) }, climbs: false };
  };
  // Rounds: launch as many as still wanted at once; a failure or an uncertain answer lets the next in line take its
  // place. A task climbs at most MAX_CLIMBS times (N1->N2->N3): the third failure stops and tells the owner.
  let climbsSoFar = 0;
  let certain = 0;
  while (certain < want && next < candidates.length && attemptsLeft(climbsSoFar)) {
    const batch = [];
    while (certain + batch.length < want && next < candidates.length) {
      const c = candidates[next++];
      if (asked.has(c.provider)) continue;
      const key = await Promise.resolve(keyFor(c.provider)).catch(() => null);
      if (!key) { skip(c.provider, 'no-key'); continue; }
      const estimateUSD = estimateCostUSD(c.provider, c.model, sent, ASK_MAX_OUT_TOKENS, askHint ?? '');
      const flight = preflight(qstate, c.provider, estimateUSD);
      if (!flight.ok) { skip(c.provider, flight.reason); continue; }
      const ticket = q.reserveOutside(c.provider, estimateUSD, s.dailyUSD);
      if (!ticket) { skip(c.provider, 'cap'); continue; }
      asked.add(c.provider);
      called++;
      batch.push(one(c, key, ticket, estimateUSD));
    }
    for (const r of await Promise.all(batch)) {
      if (r.answer) {
        answers.push(r.answer);
        if (r.climbs) climbsSoFar++;
        else certain++;
      } else {
        skip(r.provider, r.why);
        if (r.climbs) climbsSoFar++;
      }
    }
  }
  const stopped = climbsSoFar > MAX_CLIMBS ? 'max-climbs' : null;

  // The cheap checker (or37): one dubious bulk answer is checked once by the cheapest AI of another family, so the
  // gross error is caught before the ladder climbs. Never a fake self-check: the checker is another family or none.
  if (contractOn && kind === 'bulk' && answers.length) {
    const dubious = answers.find((a) => a.contract && (a.contract.status !== 'ok' || a.contract.confidence === null || a.contract.confidence < CHECK_CONFIDENCE));
    const checker = dubious ? pickChecker(grouped.candidates, { worker: { family: familyOf(dubious.provider, dubious.model) }, asked: [...asked] }) : null;
    if (dubious && checker) {
      const key = await Promise.resolve(keyFor(checker.provider)).catch(() => null);
      if (key) {
        const checkPrompt = checkerPrompt(sent, dubious.value);
        const estimateUSD = estimateCostUSD(checker.provider, checker.model, checkPrompt, ASK_MAX_OUT_TOKENS, CHECKER_SCHEMA);
        const flight = preflight(qstate, checker.provider, estimateUSD);
        const ticket = flight.ok ? q.reserveOutside(checker.provider, estimateUSD, s.dailyUSD) : null;
        if (ticket) {
          asked.add(checker.provider);
          called++;
          // The checker is the Cérebro's "opinion" row (id146): its choice rides this call, never the bulk kind's.
          const r = await one(checker, key, ticket, estimateUSD, checkPrompt, CHECKER_SCHEMA, fnChoices.opinion ?? null);
          const ok = r.answer?.value?.ok !== false;
          dubious.checker = { provider: checker.provider, model: checker.model, ok, ...(Number.isFinite(r.answer?.costUSD) ? { costUSD: r.answer.costUSD } : {}) };
          if (!ok) dubious.contract = { ...dubious.contract, status: 'uncertain', reason: `checker disagreed: ${typeof r.answer?.value?.why === 'string' ? r.answer.value.why.slice(0, 120) : 'no reason'}` };
        }
      }
    }
  }

  const costUSD = round6(answers.reduce((sum, a) => sum + a.costUSD + (a.checker?.costUSD ?? 0), 0));
  log('info', 'ai-ask', { kind, sensitivity, fanout: want, asked: [...asked], answered: answers.map((a) => a.provider), climbs: climbsSoFar, stopped: stopped ?? undefined, costUSD });
  if (!answers.length) return { ok: false, error: stopped ?? (called ? 'all-failed' : 'no-ai-available'), answers, skipped, ...(stopped ? { stopped } : {}) };
  return { ok: true, answers, skipped, ...(stopped ? { stopped } : {}) };
}
