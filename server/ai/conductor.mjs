import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY, levelFor, rungsOfModel } from './policy.mjs';
import { PROVIDERS } from './providers.mjs';
import { redact } from './redact.mjs';
import { SENSITIVITIES, explainRoute, familyOf, loadStats, routeKindOf } from './router.mjs';

// The conductor (orchestration or04/or11/or14): Claude decides the level and the worker of each piece; recommend()
// helps with a recommendation computed from the rules below and the bench's measured results, with its reason. The
// rules that protect money and privacy are not advice: assertWorker() throws, and nothing it refuses is ever offered.
//
// One arsenal: Claude's four models are workers like the outside AIs (provider 'claude', model haiku|sonnet|opus|fable).
// The levels come from server/ai/policy.json (or33), the one table; the numbers are not repeated here. In short: Haiku
// reads, Sonnet writes, Opus decides (and reviews critical work or what another AI wrote); Fable is the worker only for
// large work that Opus already failed, and the last word on a large critical delivery, after the other family's review.
// Never a default; long autonomous work alone does not call it; max is never automatic.
// Outside AIs come from router.explainRoute when the kind of work fits theirs and they are ready (key, switched on,
// not paused for that kind of work, cap left). The reviewer is always from another family than the worker.

export const CONDUCTOR_KINDS = Object.freeze([
  'search', 'read', 'bulk', 'code', 'text', 'portuguese', 'review', 'reasoning', 'business', 'security', 'money', 'architecture',
]);

// The owner's per-function choice of the Cérebro (or42/id146), read raw like the runner does: the heavy brainpanel chain
// is the tab's, never a call site's. null when absent or unreadable — the policy holds.
const functionChoice = (smDir, id) => {
  try {
    const f = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'))?.ai?.others?.functions?.[id];
    return f && typeof f === 'object' ? f : null;
  } catch { return null; }
};
export const SIZES = Object.freeze(['trivial', 'small', 'medium', 'large']);
const LADDER = ['haiku', 'sonnet', 'opus', 'fable'];
const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// The Cérebro row of each policy kind (functions.json, the first row that lists it), for cerebroFirst.
const ROW_OF_KIND = (() => {
  try {
    const byKind = new Map();
    for (const f of JSON.parse(readFileSync(new URL('./functions.json', import.meta.url), 'utf8')).functions) {
      for (const k of f.kinds ?? []) if (!byKind.has(k)) byKind.set(k, f.id);
    }
    return byKind;
  } catch { return new Map(); }
})();

// The Cérebro drives the work (id155): the owner's choice for the row of this kind of work comes first, whatever the
// size or the measures say. A Claude row sets Claude's model and level and puts Claude first; another company's AI
// leads when the hard gate lets it (key, switched on, not paused, cap left) and has not failed this task. A row with
// only a model or a level sets Claude's, in its place. A failed level is never forced back.
function cerebroFirst(list, { smDir, kind, failed, models = {}, permitted, forKind }) {
  const rowId = ROW_OF_KIND.get(POLICY_KIND[kind]);
  const pick = rowId ? functionChoice(smDir, rowId) : null;
  if (!pick) return list;
  const provider = typeof pick.provider === 'string' && pick.provider !== 'auto' ? pick.provider : null;
  const why = `the Cérebro puts ${rowId} on ${provider && provider !== 'claude' ? provider : 'Claude'}`;
  if (!provider || provider === 'claude') {
    const model = LADDER.includes(pick.model) && !failed.has(`claude:${pick.model}`) ? pick.model : null;
    const effort = CLAUDE_EFFORTS.has(pick.effort) ? pick.effort : null;
    let next = model || effort ? list.map((w) => (w.provider === 'claude' ? claudeAt(model ?? w.model, effort ?? w.effort, why) : w)) : list;
    if (provider === 'claude') next = [...next.filter((w) => w.provider === 'claude'), ...next.filter((w) => w.provider !== 'claude')];
    return next;
  }
  if (!Object.hasOwn(PROVIDERS, provider)) return list;
  const model = typeof pick.model === 'string' && pick.model !== 'auto' && cleanModel(pick.model) ? pick.model
    : (typeof models[provider] === 'string' && models[provider]) || PROVIDERS[provider].defaultModel;
  const chosen = { provider, model, why };
  if (failed.has(idOf(chosen)) || !permitted(chosen, forKind)) return list;
  return [chosen, ...list.filter((w) => idOf(w) !== idOf(chosen))];
}
const NAME = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
// The conductor's kinds, read as the policy's kinds (portuguese is prose to read by a person: docs).
const POLICY_KIND = Object.freeze({
  search: 'search', read: 'read', bulk: 'bulk', code: 'code', text: 'text', portuguese: 'docs', review: 'review',
  reasoning: 'architecture', business: 'architecture', security: 'security', money: 'money', architecture: 'architecture',
});
const DECIDING = new Set(['business', 'security', 'money', 'architecture', 'reasoning']);
const WRITING = new Set(['code', 'text', 'portuguese']);
// What Fable may take as long autonomous work, and what is a delivery that gets its last word when critical.
const LONG_FITS = new Set(['code', ...DECIDING]);
const DELIVERY = new Set([...WRITING, ...DECIDING]);
// Claude checks these itself as it uses them: an outside AI sees only the prompt and cannot check a code search, so
// no paid reviewer unless the work is critical (search: never).
const SELF_CHECKED = new Set(['search', 'read', 'bulk']);
// The kinds an outside AI can take (the router's kinds). Searching the code, and the deciding kinds other than
// reasoning, need Claude's tools and judgement.
const ROUTE_OF = Object.freeze({ read: 'read', bulk: 'bulk', code: 'code', portuguese: 'portuguese', review: 'review', reasoning: 'reasoning' });
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const FAILED_MAX = 20;
const TAIL_PER_KIND = 2;
const TAIL_MEASURED_MAX = 12;
// The router's near-best margin (router.mjs NEAR_BEST): a level measured this much better than the chosen one wins.
const nearBestOf = (routeKind) => (routeKind === 'bulk' ? 0.05 : 0.02);
// The map's bulk work pauses an AI for kind 'place' (review.mjs), as ask.mjs reads it.
const pauseKindOf = (routeKind) => (routeKind === 'bulk' ? 'place' : routeKind);
const KIND_WORD_RE = /^[a-z]{1,20}$/;

export class ConductorBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConductorBlocked';
    this.code = code;
  }
}

const refused = (code, message) => Object.assign(new Error(message), { code });
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// A model name only when it is a plain name: never something that looks like a key.
const cleanModel = (m) => (typeof m === 'string' && MODEL_RE.test(m) && redact(m) === m ? m : null);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const pct = (x) => `${Math.round(x * 100)}%`;
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const idOf = (w) => `${w.provider}:${w.model}`;

// The kinds of work a paused provider is paused for: pausedKinds (GET /api/ai/others), else the kind of its first
// pause; null when that is not known, and then it is not ready for anything.
function pausedKindsOf(p) {
  const list = Array.isArray(p.pausedKinds) ? p.pausedKinds.filter((k) => typeof k === 'string' && KIND_WORD_RE.test(k)) : [];
  if (list.length) return list;
  return typeof p.pausedWhy?.kind === 'string' && KIND_WORD_RE.test(p.pausedWhy.kind) ? [p.pausedWhy.kind] : null;
}

// What the outside AIs may do right now, from GET /api/ai/others' answer. -> {open, why: 'ok'|'off'|'cap'|'unknown',
// ready: [provider ids not paused at all], pausedOnly: {provider: [kinds it is paused for]}, models: {provider: model},
// capLeftUSD, dailyUSD}
export function outsideState(others) {
  const closed = (why) => ({ open: false, why, ready: [], pausedOnly: {}, models: {}, capLeftUSD: 0, dailyUSD: Number(others?.dailyUSD) || 0 });
  if (!isObject(others)) return closed('unknown');
  if (others.enabled !== true) return closed('off');
  const daily = Number(others.dailyUSD);
  const capLeftUSD = Number.isFinite(daily) ? Math.max(0, round6(daily - (Number(others.spentUSDToday) || 0))) : 0;
  if (others.capReached === true || !(capLeftUSD > 0)) return closed('cap');
  const ready = [];
  const pausedOnly = {};
  const models = {};
  for (const p of Array.isArray(others.providers) ? others.providers : []) {
    if (!isObject(p) || !Object.hasOwn(PROVIDERS, p.id) || ready.includes(p.id) || Object.hasOwn(pausedOnly, p.id)) continue;
    if (p.hasKey !== true || p.on === false) continue;
    if (p.paused) {
      const kinds = pausedKindsOf(p);
      if (!kinds) continue;
      pausedOnly[p.id] = kinds;
    } else ready.push(p.id);
    const m = cleanModel(p.model);
    if (m) models[p.id] = m;
  }
  return { open: true, why: 'ok', ready, pausedOnly, models, capLeftUSD, dailyUSD: daily };
}

// The providers ready for one kind of work (a router kind): a pause for the map's bulk work does not stop a review.
// Without a kind, only those not paused at all.
export function readyFor(st, routeKind) {
  if (!routeKind) return [...st.ready];
  const pk = pauseKindOf(routeKind);
  return [...st.ready, ...Object.keys(st.pausedOnly ?? {}).filter((p) => !st.pausedOnly[p].includes(pk))];
}

// The hard rules, as code: throws ConductorBlocked when this worker must not get this work. Claude always may.
// kind: the kind of work (a router or conductor kind), for pauses; without it, any pause counts.
export function assertWorker(worker, { others, kind } = {}) {
  const provider = worker?.provider;
  if (provider === 'claude') return;
  if (!Object.hasOwn(PROVIDERS, provider)) throw new ConductorBlocked('blocked-unknown', 'not a known AI');
  // The model the call would really use: providers.mjs sends the provider's default when none is given.
  const model = typeof worker.model === 'string' && worker.model ? worker.model : PROVIDERS[provider].defaultModel;
  if (typeof model !== 'string' || !model) throw new ConductorBlocked('blocked-unknown', 'no model to judge');
  const st = outsideState(others);
  if (st.why === 'cap') throw new ConductorBlocked('blocked-cap', 'the daily cap for the outside AIs is reached');
  if (!st.open) throw new ConductorBlocked('blocked-others-off', 'the outside AIs are off or not reachable');
  if (!readyFor(st, ROUTE_OF[kind] ?? routeKindOf(kind)).includes(provider)) throw new ConductorBlocked('blocked-not-ready', 'no key, switched off or paused');
}

// 'claude:opus', 'opus' or {provider, model} -> 'provider:model'
function failedIds(list) {
  return new Set((Array.isArray(list) ? list : []).slice(0, FAILED_MAX).map((f) => {
    if (isObject(f) && typeof f.provider === 'string' && typeof f.model === 'string') return `${f.provider}:${f.model}`;
    const s = String(f ?? '');
    return LADDER.includes(s) ? `claude:${s}` : s;
  }).filter(Boolean));
}

const claudeAt = (model, effort, why) => ({ provider: 'claude', model, effort, why });

// Whether Claude wrote what a review is about: 'claude', 'claude:opus' or 'anthropic'; anything else is another AI.
function claudeWrote(author) {
  const a = String(author ?? 'claude');
  const at = a.indexOf(':');
  if (at > 0) return familyOf(a.slice(0, at), a.slice(at + 1)) === 'anthropic';
  return a === 'claude' || a.toLowerCase() === 'anthropic';
}

// The level the kind of work asks for, before Fable and before failures: the policy's row, with Opus (high; xhigh when
// large) for what is critical, and for a review of what another AI wrote.
function baseLevel(kind, size, critical, outsideAuthor) {
  const row = levelFor(POLICY_KIND[kind]);
  const opus = rungsOfModel('opus');
  const opusAt = (xhigh) => opus[xhigh ? opus.length - 1 : 0];
  const at = (lv, why) => claudeAt(lv.model, lv.effort, why);
  if (DECIDING.has(kind)) return at(size === 'large' || critical ? opusAt(true) : row, `${kind} work is decided by Opus`);
  if (kind === 'review') {
    if (outsideAuthor) return at(opusAt(critical), 'another AI wrote it, so Opus reviews it');
    return critical ? at(opusAt(true), 'a review of critical work goes to Opus') : at(row, 'an ordinary review');
  }
  if (WRITING.has(kind)) {
    if (critical) return at(opusAt(size === 'large'), `critical ${kind} goes to Opus`);
    return at(row, `ordinary ${kind} is ${row.model === 'haiku' ? "Haiku's" : "Sonnet's"}`);
  }
  if (kind === 'read' && (size === 'large' || critical)) return at(levelFor('read', critical ? 2 : 1), 'long or critical reading');
  return at(row, `${kind} is Haiku's: fast and cheap`);
}

// The Claude worker: the base level, Fable when its rule holds, one rung up past what failed. Critical alone is not
// Fable's: large critical work stays on Opus at xhigh, and Fable has the last word on it (recommend's finalCheck).
function claudeWorker({ kind, size, critical, longRun, failed, outsideAuthor }) {
  const w = baseLevel(kind, size, critical, outsideAuthor);
  // Fable only after Opus failed the large work (the routing rule); long autonomous work alone is not enough.
  if (size === 'large' && !failed.has('claude:fable') && w.model === 'opus' && failed.has('claude:opus')) {
    return claudeAt('fable', 'high', 'Fable: large, and Opus failed it before');
  }
  // Large, critical and long: Opus at high, not Fable; the other family reviews and Fable has the last word (finalCheck).
  if (size === 'large' && critical && longRun && LONG_FITS.has(kind) && w.model === 'opus' && !failed.has('claude:opus')) {
    return claudeAt('opus', 'high', `large, critical, long ${kind} work stays on Opus at high: Fable is kept for what Opus failed`);
  }
  if (!failed.has(`claude:${w.model}`)) return w;
  const from = w.model;
  // The next rung of the ladder whose model has not failed.
  const here = POLICY.ladder.findLastIndex((r) => r.model === from);
  const rung = POLICY.ladder.slice(here + 1).find((r) => !failed.has(`claude:${r.model}`));
  if (rung && rung.model !== 'fable') return claudeAt(rung.model, rung.effort, `${NAME[from]} failed this before: one level up`);
  if (rung && size === 'large') return claudeAt(rung.model, rung.effort, `Fable: ${NAME[from]} failed this large work before`);
  // Fable is only for large work: Opus again, at its highest level, and the task split smaller.
  return claudeAt('opus', 'xhigh', `${NAME[from]} failed this before; Fable is kept for large work, so Opus at xhigh, in smaller pieces`);
}

// The bench's results move the Claude level up, never down: a higher level measured better than the chosen one on
// this kind by more than the near-best margin takes it, and the reason says so. Fable is never measured.
function measuredStep(claude, { routeKind, measured, failed, critical }) {
  const accuracyOf = (model) => measured.find((e) => isObject(e) && routeKindOf(e.kind) === routeKind && e.contestant === `claude:${model}` && Number.isFinite(e.accuracy))?.accuracy;
  const mine = accuracyOf(claude.model);
  if (mine === undefined) return claude;
  let best = null;
  for (const m of LADDER.slice(LADDER.indexOf(claude.model) + 1)) {
    if (m === 'fable' || failed.has(`claude:${m}`)) continue;
    const a = accuracyOf(m);
    if (a !== undefined && a > mine + nearBestOf(routeKind) && (!best || a > best.a)) best = { m, a };
  }
  if (!best) return claude;
  const levels = rungsOfModel(best.m);
  const at = levels[critical ? levels.length - 1 : 0];
  return claudeAt(best.m, at.effort, `${claude.why}, but the bench measured ${NAME[best.m]} at ${pct(best.a)} against ${pct(mine)} for ${NAME[claude.model]}: one level up`);
}

const label = (w) => (w.provider === 'claude' ? `Claude ${NAME[w.model] ?? w.model} at ${w.effort}` : `${w.provider} ${w.model}`);
const publicWorker = ({ provider, model, effort }) => ({ provider, model, ...(effort ? { effort } : {}) });

// -> {worker: {provider, model, effort?}, alternatives: [{provider, model, effort?, why}], reviewer: {provider, model,
// effort?} | null, finalCheck: {provider: 'claude', model: 'fable', effort} | null, why, blocked: [{provider, model?, why}]}.
// Throws {code: 'bad-kind' | 'bad-size'} for a bad request.
// others: GET /api/ai/others' answer (none: Claude only). stats: loadStats() entries, by default read from smDir.
// longRun: the task is long autonomous work. failedBefore: workers that already failed this task.
export function recommend({ kind, size, sensitivity, critical = false, longRun = false, author = 'claude', failedBefore = [], smDir, stats, others } = {}) {
  if (!CONDUCTOR_KINDS.includes(kind)) throw refused('bad-kind', 'unknown kind of work');
  if (!SIZES.includes(size)) throw refused('bad-size', 'unknown size');
  const sens = SENSITIVITIES.includes(sensitivity) ? sensitivity : 'client';
  const crit = critical === true;
  const failed = failedIds(failedBefore);
  const measured = Array.isArray(stats) ? stats : smDir ? loadStats(smDir) : [];
  const out = outsideState(others);
  const routeKind = ROUTE_OF[kind];
  let claude = claudeWorker({ kind, size, critical: crit, longRun: longRun === true, failed, outsideAuthor: kind === 'review' && !claudeWrote(author) });
  if (routeKind) claude = measuredStep(claude, { routeKind, measured, failed, critical: crit });
  const blocked = [];
  if (!out.open) blocked.push({ provider: 'outside', why: out.why === 'cap' ? 'cap' : out.why === 'off' ? 'others-off' : 'unknown' });
  // Every outside candidate passes the hard rules here, the one gate: what it refuses is listed, never offered.
  const permitted = (w, forKind) => {
    try {
      assertWorker(w, { others, kind: forKind });
      return true;
    } catch (err) {
      if (!(err instanceof ConductorBlocked)) throw err;
      blocked.push({ provider: w.provider, model: w.model, why: err.code === 'blocked-sensitivity' ? 'sensitivity' : err.code.replace(/^blocked-/, '') });
      return false;
    }
  };
  const availableFor = (rk) => ['claude', ...readyFor(out, rk)];

  let list = [claude];
  if (routeKind) {
    // A measured result is credited only to the Claude level it measured: the others' entries are left out, so the
    // chosen level sits where its own measure (or, unmeasured, the research order) puts it.
    const own = `claude:${claude.model}`;
    const stats = measured.filter((e) => !(isObject(e) && typeof e.contestant === 'string' && e.contestant.startsWith('claude:') && e.contestant !== own));
    const routed = explainRoute({ kind: routeKind, sensitivity: sens, author, available: availableFor(routeKind), stats, models: out.models });
    for (const s of routed.skipped) if (s.provider !== 'claude' && s.why === 'sensitivity') blocked.push({ provider: s.provider, model: s.model, why: 'sensitivity' });
    const exact = routed.candidates.some((c) => c.provider === 'claude' && c.model === claude.model);
    list = [];
    let withClaude = false;
    for (const c of routed.candidates) {
      if (c.provider === 'claude') {
        if (withClaude || (exact && c.model !== claude.model)) continue;
        withClaude = true;
        list.push(c.measured && c.model === claude.model ? { ...claude, why: `${claude.why}; ${c.why}` } : claude);
      } else if (!failed.has(idOf(c)) && permitted(c, routeKind)) {
        list.push({ provider: c.provider, model: c.model, why: c.why });
      }
    }
    if (!withClaude) list.push({ ...claude, why: `${claude.why}; same family as the author, so only when no other family can do it` });
    // An outside AI answers without tools and gives a draft: critical work, and large work other than bulk, stay with Claude.
    // A review keeps the router's order: another family than the author's comes first, however critical.
    const outsideMayLead = routeKind === 'review' || (!crit && (routeKind === 'bulk' || size !== 'large'));
    if (!outsideMayLead) list = [...list.filter((w) => w.provider === 'claude'), ...list.filter((w) => w.provider !== 'claude')];
  }
  if (smDir) list = cerebroFirst(list, { smDir, kind, failed, models: out.models, permitted, forKind: routeKind ?? kind });
  const worker = list[0];
  const alternatives = list.slice(1);

  // The reviewer: another family than the worker's; when the worker is outside, Claude's Opus. Search, reading and
  // bulk work Claude checks itself as it uses them, unless critical (search always): no paid reviewer for them.
  let reviewer = null;
  const outsideWorker = worker.provider !== 'claude';
  const selfChecked = SELF_CHECKED.has(kind) && !outsideWorker && (kind === 'search' || !crit);
  let reviewWhy = kind === 'review' ? 'this is the review itself'
    : selfChecked ? `Claude checks ${kind} work itself as it uses it, no paid reviewer` : 'no separate review needed for small ordinary work';
  const needsReview = kind !== 'review' && !selfChecked && (outsideWorker || crit || DECIDING.has(kind) || size === 'medium' || size === 'large');
  if (needsReview) {
    const routed = explainRoute({ kind: 'review', sensitivity: sens, author: idOf(worker), available: availableFor('review'), stats: measured });
    const pick = routed.candidates.find((c) => !failed.has(idOf(c)) && (c.provider === 'claude' || permitted(c, 'review')));
    if (pick?.provider === 'claude') {
      // The review row of the Cérebro (id146): the owner's choice for it rides, the policy's review row is the default.
      const base = POLICY.tasks.review;
      const choice = smDir ? functionChoice(smDir, 'review') : null;
      reviewer = { provider: 'claude', model: choice?.model ?? base.model, effort: choice?.effort ?? base.effort };
      reviewWhy = `reviewed by ${label(reviewer)}, another family than the author`;
    } else if (pick) {
      reviewer = { provider: pick.provider, model: pick.model };
      reviewWhy = `reviewed by ${label(reviewer)}, another family than the author`;
    } else {
      reviewWhy = 'no other family is ready to review: run the tests and check it yourself with a fresh Opus subagent';
    }
  }

  // Fable's last word (or04): a large critical delivery, after the other family's review; not when Fable did the work.
  // The ladder's top rung, read from the one table (or33), never repeated here.
  let finalCheck = null;
  let finalWhy = '';
  const top = POLICY.ladder[POLICY.ladder.length - 1] ?? { model: 'fable', effort: 'high' };
  if (crit && size === 'large' && DELIVERY.has(kind) && !(worker.provider === 'claude' && worker.model === 'fable') && !failed.has('claude:fable')) {
    finalCheck = { provider: 'claude', model: top.model, effort: top.effort };
    finalWhy = `; then ${label(finalCheck)} has the last word on this critical delivery`;
  }

  const head = `${kind}, ${size}${crit ? ', critical' : ''}, ${sens} data`;
  const why = `${head}: ${label(worker)} (${worker.why}); ${reviewWhy}${finalWhy}.`;
  return {
    worker: publicWorker(worker),
    alternatives: alternatives.map((w) => ({ ...publicWorker(w), why: w.why })),
    reviewer,
    finalCheck,
    why,
    blocked: blocked.filter((b, i) => blocked.findIndex((x) => x.provider === b.provider && x.model === b.model && x.why === b.why) === i),
  };
}

const DECISIONS_FILE = 'conductor.log';
// Only plain worker names reach the log: anything shaped like a key or a token (redact() changes it) is dropped.
const cleanFailed = (list) => (Array.isArray(list) ? list : []).slice(0, FAILED_MAX)
  .map((f) => (isObject(f) && typeof f.provider === 'string' && typeof f.model === 'string' ? `${f.provider}:${f.model}` : f))
  .filter((f) => typeof f === 'string' && MODEL_RE.test(f) && redact(f) === f);
const DECISIONS_MAX_BYTES = 512 * 1024;

// The reason recorded (or14): one JSON line per recommendation in smDir/conductor.log, with what was asked (kind, size,
// sensitivity, flags), who was recommended and why. Never a prompt, never a key. Past 512 KB the older half goes.
export function recordDecision(smDir, input, rec) {
  if (!smDir || !rec?.worker) return;
  const file = join(smDir, DECISIONS_FILE);
  const line = {
    ts: new Date().toISOString(), kind: input.kind, size: input.size,
    sensitivity: SENSITIVITIES.includes(input.sensitivity) ? input.sensitivity : 'client',
    critical: input.critical === true, longRun: input.longRun === true,
    ...(cleanFailed(input.failedBefore).length ? { failedBefore: cleanFailed(input.failedBefore) } : {}),
    worker: idOf(rec.worker), effort: rec.worker.effort ?? null, reviewer: rec.reviewer ? idOf(rec.reviewer) : null,
    ...(rec.finalCheck ? { finalCheck: idOf(rec.finalCheck) } : {}), why: redact(rec.why),
  };
  try {
    mkdirSync(smDir, { recursive: true });
    let size = 0;
    try { size = statSync(file).size; } catch { /* no file yet */ }
    if (size > DECISIONS_MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`);
    }
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  } catch {
    // A full disk or a locked file must not stop the recommendation.
  }
}

const CONTESTANT_RE = /^[a-z]+:[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

// The version watch's warnings (versions.mjs, or15) as one short line: a model in use that is gone, one announced to
// retire, a new one of the same line. Only plain names and dates get in (they come from a provider's list); more than
// four are counted, not listed. A failed check is not a warning here. '' when nothing is wrong.
const VERSION_ORDER = { gone: 0, retiring: 1, new: 2 };
const VERSION_NOTES_MAX = 4;
function versionLine(versions) {
  if (!isObject(versions)) return '';
  const notes = [];
  for (const [provider, v] of Object.entries(versions)) {
    if (!Object.hasOwn(PROVIDERS, provider) || !isObject(v) || !Array.isArray(v.notes)) continue;
    for (const n of v.notes) {
      if (!isObject(n) || !Object.hasOwn(VERSION_ORDER, n.type) || !cleanModel(n.model)) continue;
      const date = typeof n.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : null;
      if (n.type === 'retiring' && !date) continue;
      notes.push({ type: n.type, order: VERSION_ORDER[n.type], text: n.type === 'gone' ? `${provider} ${n.model} is no longer listed` : n.type === 'retiring' ? `${provider} ${n.model} retires ${date}` : `${provider} has a new ${n.model}` });
    }
  }
  if (!notes.length) return '';
  notes.sort((a, b) => a.order - b.order);
  const shown = notes.slice(0, VERSION_NOTES_MAX).map((n) => n.text);
  const rest = notes.length - shown.length;
  return `- Model versions (check before routing to them): ${shown.join('; ')}${rest > 0 ? `; and ${rest} more (list_other_ais)` : ''}.`;
}

// The day's facts, appended to the conductor prompt at chat start: who is ready, the cap left, and per measured kind
// the best Claude level and the best outside AI (up to 12 lines).
// Pure, and built from named fields only: nothing else of its inputs (a key, say) can reach the prompt.
export function conductorTail({ others, stats = [] } = {}) {
  const st = outsideState(others);
  const lines = ['Today, as session-map saw it when this chat started:'];
  if (st.why === 'unknown') lines.push('- Outside AIs: not known right now; call list_other_ais before counting on them.');
  else if (st.why === 'off') lines.push('- Outside AIs: switched off by the owner. Work with Claude only.');
  else if (st.why === 'cap') lines.push(`- Outside AIs: daily cap reached (${usd(st.dailyUSD)}). Work with Claude only until tomorrow.`);
  else if (!st.ready.length && !Object.keys(st.pausedOnly).length) lines.push('- Outside AIs: none ready (no key, switched off or paused). Work with Claude only.');
  else {
    const pausedWord = (k) => (k === 'place' ? 'bulk' : k);
    const who = [
      ...st.ready.map((p) => (st.models[p] ? `${p} (${st.models[p]})` : p)),
      ...Object.entries(st.pausedOnly).map(([p, kinds]) => `${p} (${st.models[p] ? `${st.models[p]}, ` : ''}paused for ${kinds.map(pausedWord).join(' and ')} work only)`),
    ].join(', ');
    lines.push(`- Outside AIs ready: ${who}. Cap left today: ${usd(st.capLeftUSD)} of ${usd(st.dailyUSD)}.`);
  }
  const versions = versionLine(others?.versions);
  if (versions) lines.push(versions);
  const good = (Array.isArray(stats) ? stats : []).filter((e) => isObject(e) && typeof e.kind === 'string' && /^[a-z]{1,20}$/.test(e.kind)
    && typeof e.contestant === 'string' && CONTESTANT_RE.test(e.contestant) && redact(e.contestant) === e.contestant
    && Number.isFinite(e.accuracy) && Number.isFinite(e.costPerCorrectUSD) && Number.isInteger(e.n));
  if (!good.length) lines.push('- Measured results: not measured yet; follow the rules above.');
  else {
    lines.push('- Measured by the bench (per kind: the best Claude level and the best outside AI, better first):');
    const byKind = new Map();
    for (const e of good) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
    const better = (a, b) => b.accuracy - a.accuracy || a.costPerCorrectUSD - b.costPerCorrectUSD;
    const top = [];
    for (const k of [...byKind.keys()].sort()) {
      const all = byKind.get(k).sort(better);
      const picks = [all.find((e) => e.contestant.startsWith('claude:')), all.find((e) => !e.contestant.startsWith('claude:'))].filter(Boolean);
      top.push(...picks.sort(better).slice(0, TAIL_PER_KIND));
    }
    for (const e of top.slice(0, TAIL_MEASURED_MAX)) lines.push(`  - ${e.kind}: ${e.contestant} ${Math.round(e.accuracy * 100)}% right, $${e.costPerCorrectUSD.toFixed(4)} per right answer (n=${e.n})`);
  }
  return redact(lines.join('\n'));
}
