// The orchestration's priority queue (or08): each piece of work the orchestrator asks for has a priority, urgent first,
// the finishing touches in the gaps. Pure rules on top, the line kept on disk below; orchestra.mjs starts the pieces.
//
// Where a priority comes from, the first that says: the owner's choice on the page for that item, the orchestrator's
// (it says "urgent" only when the person did), then the item's mark in the architecture (blocks → urgent,
// important → important, detail → polish, none → normal).
// What may start: near a limit (the project's budget past 80% or continued past 100%, or the plan's weekly allowance
// hit or almost used up, wa09) only urgent and important start; polish only when the project is quiet and nothing else
// waits. Priority never stops a chat already working: it decides who takes the next free place.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeAtomic } from '../store.mjs';

export const PRIORITIES = ['urgent', 'important', 'normal', 'polish'];
export const QUEUE_FILE = 'orch-queue.json';
// The plan's weekly allowance counts as near from this share used.
export const WEEK_NEAR_PCT = 90;
// Older than this, the account's cached weekly figure is not trusted: Claude Code refreshes it while it is used.
const WEEK_FRESH_MS = 24 * 3600_000;
const WAITING_MAX = 50;
const TEXT_MAX = 20_000;
const TITLE_MAX = 200;
const OWNER_MAX = 500;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isPriority = (v) => PRIORITIES.includes(v);
export const rankOf = (p) => (isPriority(p) ? PRIORITIES.indexOf(p) : PRIORITIES.indexOf('normal'));
const WEIGHT = { blocks: 'urgent', important: 'important', detail: 'polish' };
export const priorityOfWeight = (weight) => WEIGHT[weight] ?? 'normal';

// The priority a piece has now: the owner's choice wins, then the orchestrator's, then the item's mark.
export function priorityOf(piece, owner = {}) {
  const chosen = owner?.[piece.code];
  if (isPriority(chosen)) return chosen;
  if (isPriority(piece.asked)) return piece.asked;
  return priorityOfWeight(piece.weight);
}

// Highest first, then the oldest; a stable order for equal ones.
export function ordered(waiting, owner = {}) {
  return waiting
    .map((piece, n) => ({ piece, n, rank: rankOf(priorityOf(piece, owner)) }))
    .sort((a, b) => a.rank - b.rank || String(a.piece.at).localeCompare(String(b.piece.at)) || a.n - b.n)
    .map((x) => x.piece);
}

// ---- the weekly allowance (wa09) ----

// What Claude Code keeps of the account's use in ~/.claude.json: the share of the week used (0 to 100) and when it renews.
// → {pct, resetsAt, fetchedAt} or null when it is missing, malformed, stale or already renewed.
export function weekUseOf(account, nowMs) {
  const cached = isObject(account) ? account.cachedUsageUtilization : null;
  const week = isObject(cached) && isObject(cached.utilization) ? cached.utilization.seven_day : null;
  if (!isObject(week)) return null;
  const pct = Number(week.utilization);
  if (!Number.isFinite(pct) || pct < 0) return null;
  // A figure of unknown age is not trusted either: it could hold the line for good.
  const fetchedAt = Number(cached.fetchedAtMs);
  if (!Number.isFinite(fetchedAt) || nowMs - fetchedAt > WEEK_FRESH_MS) return null;
  const resets = Date.parse(week.resets_at ?? '');
  if (Number.isFinite(resets) && resets <= nowMs) return null;
  return { pct: Math.min(100, Math.round(pct)), resetsAt: Number.isFinite(resets) ? new Date(resets).toISOString() : null, fetchedAt };
}

// Read from the file, parsed again only when it changed. Only the weekly figure leaves this function.
let weekCache = { file: null, mtimeMs: -1, account: null };
export function readWeekUse(file, nowMs = Date.now()) {
  try {
    const { mtimeMs } = statSync(file);
    if (weekCache.file !== file || weekCache.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      weekCache = { file, mtimeMs, account: { cachedUsageUtilization: parsed?.cachedUsageUtilization ?? null } };
    }
    return weekUseOf(weekCache.account, nowMs);
  } catch {
    return null;
  }
}

// ---- what may start ----

// Why only urgent and important may start now, or null: 'near-budget' or 'near-weekly'.
export function nearOf({ budget = null, limits = null, weekUse = null, now = Date.now() } = {}) {
  if (budget && (budget.level === 'warn' || (budget.level === 'over' && budget.continued))) return 'near-budget';
  if (limits?.weekly?.hit) return 'near-weekly';
  if (weekUse && weekUse.pct >= WEEK_NEAR_PCT && (!weekUse.resetsAt || Date.parse(weekUse.resetsAt) > now)) return 'near-weekly';
  return null;
}

// Why a piece of that priority may not start now, places aside, or null. near: nearOf's answer; quiet: no chat of the
// project works (its orchestrator aside); othersWait: a piece that is not polish waits in the line.
export function heldOf(priority, { near = null, quiet = true, othersWait = false } = {}) {
  if (near && rankOf(priority) > rankOf('important')) return near;
  if (priority === 'polish' && (!quiet || othersWait)) return 'polish';
  return null;
}

// ---- the line on disk ----

const fileOf = (smDir) => join(smDir, QUEUE_FILE);
function readAll(smDir) {
  const stored = readJsonFile(fileOf(smDir), {});
  return isObject(stored) && isObject(stored.projects) ? stored.projects : {};
}
const clean = (entry) => ({
  waiting: Array.isArray(entry?.waiting) ? entry.waiting.filter((p) => isObject(p) && typeof p.code === 'string' && typeof p.id === 'string') : [],
  owner: isObject(entry?.owner) ? Object.fromEntries(Object.entries(entry.owner).filter(([, p]) => isPriority(p))) : {},
});

// One project's line: {waiting: [piece], owner: {code: priority}}.
export const readQueue = (smDir, projectId) => clean(readAll(smDir)[projectId]);

// The one read-modify-write: fn gets the project's line and changes it in place.
export function editQueue(smDir, projectId, fn) {
  const all = readAll(smDir);
  const entry = clean(all[projectId]);
  const out = fn(entry);
  if (entry.waiting.length || Object.keys(entry.owner).length) all[projectId] = entry;
  else delete all[projectId];
  writeAtomic(fileOf(smDir), `${JSON.stringify({ projects: all }, null, 2)}\n`);
  return out;
}

// A new piece, or the same item's waiting piece brought up to date (its place in the line is kept). → the piece, or
// null when the line is full.
export function addPiece(smDir, projectId, { code, partId, title, weight, instructions, run, asked, at }, newId) {
  return editQueue(smDir, projectId, (entry) => {
    const same = entry.waiting.find((p) => p.code === code);
    if (same) {
      Object.assign(same, { instructions: String(instructions).slice(0, TEXT_MAX), run, title: String(title ?? '').slice(0, TITLE_MAX), weight: weight ?? null });
      if (isPriority(asked)) same.asked = asked;
      return { ...same };
    }
    if (entry.waiting.length >= WAITING_MAX) return null;
    const piece = {
      id: newId(), code, partId, title: String(title ?? '').slice(0, TITLE_MAX), weight: weight ?? null,
      instructions: String(instructions).slice(0, TEXT_MAX), run, asked: isPriority(asked) ? asked : null, at,
    };
    entry.waiting.push(piece);
    return { ...piece };
  });
}

// The owner's choice for an item: a priority, null to give it back to the rules, or 'drop' to take it out of the line.
// → the piece taken out, if any.
export function setOwnerPriority(smDir, projectId, code, priority) {
  return editQueue(smDir, projectId, (entry) => {
    if (priority === 'drop') {
      const gone = entry.waiting.find((p) => p.code === code) ?? null;
      entry.waiting = entry.waiting.filter((p) => p.code !== code);
      return gone;
    }
    if (priority === null) delete entry.owner[code];
    else {
      entry.owner[code] = priority;
      const codes = Object.keys(entry.owner);
      for (const old of codes.slice(0, Math.max(0, codes.length - OWNER_MAX))) delete entry.owner[old];
    }
    return null;
  });
}

// What the page shows of a project's line, highest first: code, title, priority, why it waits, whether the owner chose.
export function queueView(smDir, projectId) {
  if (!smDir) return [];
  const { waiting, owner } = readQueue(smDir, projectId);
  return ordered(waiting, owner).map((p) => ({
    code: p.code, title: p.title ?? '', priority: priorityOf(p, owner), why: typeof p.why === 'string' ? p.why : null,
    chosen: isPriority(owner[p.code]), at: p.at ?? null,
  }));
}
