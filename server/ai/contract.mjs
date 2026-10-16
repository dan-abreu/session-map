// The worker's exit contract (or37): every AI of the arsenal answers in the same shape, so the conductor switches
// providers without reconfiguring anything. A JSON task asked with `contract` wraps its schema:
//
//   { "status": "ok" | "uncertain" | "error", "confidence": 0..1, "answer": <the asked JSON>, "reason": "<one line>",
//     "skipped": "<one line, only when something was skipped or not checked>" }
//
// The skipped line is ponytail's closing rule (id134): every reply ends saying what it did not do or check.
//
// A provider that ignores the wrapper (a bare JSON answer) is graded from the signals around the answer instead of
// failing the job: a wrong shape must never cost an answer that was actually good. The climb cap and the cheap
// checker of another family live here too: quality climbs, credit switches (quota.mjs), and never more than two
// climbs per task.

export const STATUS = Object.freeze(['ok', 'uncertain', 'error']);
// One task climbs at most twice (N1 -> N2 -> N3): the first try plus two climbs, then it stops and tells the owner.
export const MAX_CLIMBS = 2;
// A bulk answer with a confidence below this bar (or no confidence) is dubious: one cheap check from another family
// decides before the ladder climbs.
export const CHECK_CONFIDENCE = 0.8;
// The one question the checker answers about a dubious answer.
export const CHECKER_SCHEMA = '{"ok": true | false, "why": "<one short line>"}';
// The full senior-dev review (id142, or47 task 4): the vendored ponytail-review shape — what the code does, what goes
// wrong, how to fix, what happens if not. The [review] kind asks with it, so the review gate's agent sees the whole method.
export const REVIEW_SCHEMA = '{"findings": [{"what": "<what the code does>", "problem": "<what goes wrong>", "fix": "<how to fix it>", "skip": "<what happens if you do not>"}], "cut": ["<what to delete>"], "verdict": "<one line>"}';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The wrapper's schema hint, around the asked one: the same words for every provider (or37's "same options").
export function contractHint(schemaHint) {
  return `{ "status": "ok" | "uncertain" | "error", "confidence": <a number 0 to 1, how sure you are>, "answer": ${schemaHint}, "reason": "<one short line, only when not ok>", "skipped": "<one short line, only when you skipped or did not check something>" }`;
}

function statusOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return STATUS.includes(s) ? s : null;
}

// The wrapper when the parsed answer really is one, else null. Confidence is coerced and clamped to 0..1; a broken
// confidence is null, never a wrong number. The reason is cut short: it is data from another company's model.
export function parseContract(value) {
  if (!isObject(value) || !statusOf(value.status) || !Object.hasOwn(value, 'answer')) return null;
  const conf = Number(value.confidence);
  const confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null;
  const reason = typeof value.reason === 'string' ? value.reason.slice(0, 200) : '';
  const skipped = typeof value.skipped === 'string' ? value.skipped.slice(0, 200) : '';
  return { status: statusOf(value.status), confidence, answer: value.answer, reason, skipped };
}

// The contract from the signals when the provider answered without the wrapper: a failed call is an error, a cut
// answer is uncertain (it may be right in its first part), a parsed answer is ok with the base confidence.
export function gradeAnswer({ value, error, cut }) {
  if (error) return { status: 'error', confidence: 0, answer: value ?? null, reason: 'failed', skipped: '' };
  if (cut) return { status: 'uncertain', confidence: 0.4, answer: value, reason: 'cut', skipped: '' };
  return { status: 'ok', confidence: 0.6, answer: value, reason: 'no-contract', skipped: '' };
}

// The contract of one call result: the wrapper when it came back, the graded signals otherwise.
export function contractOf({ value, error, cut }) {
  return parseContract(value) ?? gradeAnswer({ value, error, cut });
}

// A climb is a quality failure: the call failed, or the worker itself said it was not sure. A low confidence alone
// never climbs — the checker decides on dubious bulk answers.
export const climbs = (contract) => contract.status !== 'ok';

// may the task try one more candidate before it owes the owner a stop? The first try needs none, then one per climb.
export const attemptsLeft = (climbsSoFar, max = MAX_CLIMBS) => climbsSoFar <= max;

// The one cheap question another family answers about a dubious bulk answer. The answer is shown as JSON when it
// can be; nothing of it leaves this machine beyond what the checker provider already saw in the ask itself.
export function checkerPrompt(task, answer) {
  const show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  return `Check one answer. The task was:\n${task}\n\nThe answer:\n${show(answer)}\n\nDoes the answer follow the task? Reply with one JSON object only: {"ok": true | false, "why": "<one short line>"}`;
}

// The cheapest AI of another family that may check this answer, from the routed candidates in order: never the same
// family as the worker, never one already asked for the task itself. Without a candidate there is no checker — a
// dubious answer then stands as it is, marked uncertain.
export function pickChecker(candidates, { worker, asked = [] } = {}) {
  const family = worker?.family;
  const used = new Set(Array.isArray(asked) ? asked : []);
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c?.provider || used.has(c.provider)) continue;
    if (!c.family || c.family === family) continue;
    return c;
  }
  return null;
}
