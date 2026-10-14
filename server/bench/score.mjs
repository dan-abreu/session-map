// The measuring bench's scorers (or12): one pure function per kind of task. Each takes the set's item and the model's
// answer and returns { score: 0 | 1, answer, ...details }. Nothing here calls a model or touches the disk.
import { checkPt } from './pt-checks.mjs';

const NEAR_LINES = 2;
const ANSWER_MAX = 80;

const NONE = new Set(['', 'none', 'null', 'nenhum', 'nenhuma']);
const noPart = (v) => v === null || v === undefined || (typeof v === 'string' && NONE.has(v.trim().toLowerCase()));

// The classify set is built from the owner's own conversations: only the part id the model chose is kept, never
// anything else it wrote back, which could quote the prompt.
// An answer without the asked field is not "none": it did not follow the shape, and it scores 0 with badShape set
// (the engine counts it as a failure), so ignoring the schema can never win the "no part" / "no bug" items.
export function scoreClassify(item, value) {
  const gold = item.gold?.partId ?? null;
  const shaped = Boolean(value) && typeof value === 'object' && Object.hasOwn(value, 'partId')
    && (value.partId === null || typeof value.partId === 'string');
  if (!shaped) return { score: 0, answer: null, badShape: true };
  const said = value.partId;
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

// A line is a whole number from 1 up; "12" is read as 12, but null, "", 0 or 3.5 point nowhere: such a report is
// still a claim of a bug, so it is a false alarm that can never be a hit.
const lineOf = (b) => {
  const v = b?.line;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
};

// A hit is a report within two lines of a planted bug line; any other report is a false alarm.
export function scoreReview(item, value) {
  if (!Array.isArray(value?.bugs)) return { score: 0, hits: 0, falseAlarms: 0, answer: [], badShape: true };
  const reported = value.bugs.map(lineOf).filter((n) => n !== null);
  const unplaced = value.bugs.length - reported.length;
  const bugLines = item.clean ? [] : (item.bugLines ?? []).map(Number);
  const near = (line) => bugLines.some((b) => Math.abs(b - line) <= NEAR_LINES);
  const hits = reported.filter(near).length;
  const falseAlarms = reported.length - hits + unplaced;
  const right = item.clean ? value.bugs.length === 0 : hits > 0;
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
    ...(typeof value?.text === 'string' ? {} : { badShape: true }),
  };
}

// Planning (or30), scored with no judge model: the share of criteria a plan meets. Always: the work is split into tasks,
// each task has a known model and effort, at most 10 agents, and the plan waits for the owner's approval. In a sensitive
// item (money or security) one more: a task on a strong model, and none of the guarding work on a weak one. Then the item's
// own points, each a list of groups of regexes in Portuguese and English: every group needs one match in the plan's text.
export const PLAN_RIGHT_AT = 0.8;
const PLAN_MAX_AGENTS = 10;
const PLAN_ANSWER_MAX = 12;
const MODEL_RX = /\b(haiku|sonnet|opus|fable)\b/;
const EFFORT_RX = /\b(low|medium|high|xhigh|max)\b/;
const APPROVAL_RX = /approv|aprova|confirm|your ok|seu ok|go-?ahead|sign-?off|before (building|build|starting|start|implementing)|antes de (construir|implementar|comecar|executar)|waiting for you|wait(s|ing)? for you|aguard|espera/;
// A plan that says it will not wait is not waiting ("do not wait for approval", "nao precisa esperar a aprovacao").
const NO_APPROVAL_RX = /(do not|don't|no need to|nao (vou |precisa |ha necessidade de )?)\s*(wait|ask|need|require|aguard|esper|pedir|precis)/;

// Lower case without accents, so "capítulo" and "capitulo" are the same word.
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const OFF_TEXT = new Set(['model', 'effort', 'level']);
// Every string in the value except the model and effort names: "haiku" in a model field is not a point made in words.
const wordsOf = (v) => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(wordsOf);
  if (v && typeof v === 'object') return Object.entries(v).filter(([k]) => !OFF_TEXT.has(k)).flatMap(([, x]) => wordsOf(x));
  return [];
};
const taskList = (value) => [value?.tasks, value?.steps, value?.plan?.tasks, value?.plan].find(Array.isArray) ?? null;
const taskModel = (t) => MODEL_RX.exec(plain(t?.model))?.[1] ?? null;
const taskEffort = (t) => EFFORT_RX.exec(plain(t?.effort ?? t?.level))?.[1] ?? null;
const isStrong = (t) => ['opus', 'fable'].includes(taskModel(t)) || (taskModel(t) === 'sonnet' && ['high', 'xhigh', 'max'].includes(taskEffort(t)));
const isWeak = (t) => taskModel(t) === 'haiku' || taskEffort(t) === 'low';

export function scorePlan(item, value) {
  const tasks = value && typeof value === 'object' ? taskList(value) : null;
  if (!tasks) return { score: 0, share: 0, met: [], missed: [], answer: [], badShape: true };
  const taskText = (t) => plain(wordsOf(t).join(' '));
  const all = plain(wordsOf(value.summary).concat(tasks.flatMap((t) => wordsOf(t)), wordsOf(value.questions)).join('\n'));
  const waits = value.waitsForApproval === true || value.waitsForApproval === 'true' ? true
    : value.waitsForApproval === false || value.waitsForApproval === 'false' ? false : null;
  const agents = Number(value.agents);
  const said = plain(wordsOf(value.summary).concat(wordsOf(value.questions)).join('\n'));
  const checks = [
    ['split', tasks.length >= 2 && tasks.every((t) => taskText(t).trim() !== '')],
    ['model-effort', tasks.length > 0 && tasks.every((t) => taskModel(t) && taskEffort(t))],
  ];
  if (item.sensitive) {
    const guard = new RegExp(item.sensitiveRx, 'i');
    checks.push(['strong-on-sensitive', tasks.some(isStrong) && !tasks.some((t) => guard.test(taskText(t)) && isWeak(t))]);
  }
  checks.push(
    // Infinity is over the limit too; a missing or unreadable count (NaN) is judged by the task list alone.
    ['max-agents', tasks.length <= PLAN_MAX_AGENTS && !(agents > PLAN_MAX_AGENTS)],
    ['approval', waits ?? (APPROVAL_RX.test(said) && !NO_APPROVAL_RX.test(said))],
  );
  for (const point of item.points ?? []) {
    checks.push([point.id, point.all.every((group) => group.some((rx) => new RegExp(rx, 'i').test(all)))]);
  }
  const met = checks.filter(([, ok]) => ok).map(([id]) => id);
  const share = met.length / checks.length;
  return {
    score: share >= PLAN_RIGHT_AT - 1e-9 ? 1 : 0,
    share: Math.round(share * 1000) / 1000,
    met,
    missed: checks.filter(([, ok]) => !ok).map(([id]) => id),
    answer: tasks.slice(0, PLAN_ANSWER_MAX).map((t) => `${taskModel(t) ?? '?'}:${taskEffort(t) ?? '?'}`),
  };
}

const SCORERS = { classify: scoreClassify, code: scoreCode, review: scoreReview, pt: scorePt, plan: scorePlan };
export const KINDS = Object.freeze(Object.keys(SCORERS));

export function scoreAnswer(kind, item, value) {
  if (!Object.hasOwn(SCORERS, kind)) throw new Error(`unknown kind: ${kind}`);
  return SCORERS[kind](item, value);
}
