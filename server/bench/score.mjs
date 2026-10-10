// The measuring bench's scorers (or12): one pure function per kind of task. Each takes the set's item and the model's
// answer and returns { score: 0 | 1, answer, ...details }. Nothing here calls a model or touches the disk.
import { checkPt } from './pt-checks.mjs';

const NEAR_LINES = 2;
const ANSWER_MAX = 80;

const NONE = new Set(['', 'none', 'null', 'nenhum', 'nenhuma']);
const noPart = (v) => v === null || v === undefined || (typeof v === 'string' && NONE.has(v.trim().toLowerCase()));

// The classify set is built from the owner's own conversations: only the part id the model chose is kept, never
// anything else it wrote back, which could quote the prompt.
export function scoreClassify(item, value) {
  const gold = item.gold?.partId ?? null;
  const said = value && typeof value === 'object' ? value.partId : undefined;
  const right = gold === null ? noPart(said) : typeof said === 'string' && said.trim() === gold;
  return { score: right ? 1 : 0, answer: noPart(said) ? null : String(said).slice(0, ANSWER_MAX) };
}

// The sandbox result of running the set's tests against the model's module: all green or nothing.
export function scoreCode(item, run) {
  const total = Number(run?.total) || 0;
  const passed = Number(run?.passed) || 0;
  const right = Boolean(run?.ok) && total > 0 && passed === total;
  return { score: right ? 1 : 0, partial: total ? passed / total : 0, passed, total, timedOut: Boolean(run?.timedOut) };
}

const linesOf = (value) => (Array.isArray(value?.bugs) ? value.bugs : [])
  .map((b) => Number(b?.line))
  .filter((n) => Number.isFinite(n));

// A hit is a report within two lines of a planted bug line; any other report is a false alarm.
export function scoreReview(item, value) {
  const reported = linesOf(value);
  const bugLines = item.clean ? [] : (item.bugLines ?? []).map(Number);
  const near = (line) => bugLines.some((b) => Math.abs(b - line) <= NEAR_LINES);
  const hits = reported.filter(near).length;
  const falseAlarms = reported.length - hits;
  const right = item.clean ? reported.length === 0 : hits > 0;
  return { score: right ? 1 : 0, hits, falseAlarms, answer: reported };
}

// Portuguese, the right size, no jargon: the automatic half. The owner's blind rating is the other half.
export function scorePt(item, value) {
  const text = typeof value?.text === 'string' ? value.text : '';
  const bounds = item.minWords || item.maxWords ? { min: item.minWords ?? 0, max: item.maxWords ?? Infinity } : undefined;
  const r = checkPt(text, bounds);
  return {
    score: r.ok ? 1 : 0,
    checks: { language: r.language, lengthOk: r.lengthOk, noJargon: r.noJargon },
    words: r.words,
    jargon: r.jargon,
    answer: text,
  };
}

const SCORERS = { classify: scoreClassify, code: scoreCode, review: scoreReview, pt: scorePt };
export const KINDS = Object.freeze(Object.keys(SCORERS));

export function scoreAnswer(kind, item, value) {
  if (!Object.hasOwn(SCORERS, kind)) throw new Error(`unknown kind: ${kind}`);
  return SCORERS[kind](item, value);
}
