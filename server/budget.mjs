import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { budgetStatus } from './cost.mjs';
import { normalizePath } from './paths.mjs';
import { readJsonFile, writeAtomic } from './store.mjs';

// A monthly budget per project (orchestration or07): an alert at 80% and a polite pause at 100%. The limit lives with the
// other per-project keys of session-map's own config.json (projects[normalized root].budgetMonthlyUSD; none = no budget).
// A month's spend = the Claude cost rows collect already has for the project (its costByDay of this calendar month) + what
// the outside AIs cost for it. Those come from a small ledger kept here (project-spend.json), written at each outside call
// with the project root of the chat that asked: the activity log is cut at 2,000 lines, so it cannot hold a month.
// A soft limit: it is checked when new work starts, so a turn already running may end a little past it.

export const LEDGER_FILE = 'project-spend.json';
const LEDGER_MONTHS = 3;
const ROOT_MAX = 1000;
const LIMIT_MAX = 1_000_000;
export const WARN_AT = 0.8;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round2 = (usd) => Math.round((Number(usd) || 0) * 100) / 100;
const round6 = (usd) => Math.round((Number(usd) || 0) * 1e6) / 1e6;
const pad = (n) => String(n).padStart(2, '0');
const usd = (n) => `US$ ${round2(n).toFixed(2)}`;

// The local calendar month of a moment, "YYYY-MM": the same clock as costByDay's local days.
export const monthOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

// ---- the setting ----

const validLimit = (v) => Number.isFinite(v) && v >= 0 && v <= LIMIT_MAX;

// → {limitUSD: number | null, continueMonth: "YYYY-MM" | null}
export function budgetSetting(userConfig, root) {
  const entry = userConfig?.projects?.[normalizePath(root)];
  const limit = isObject(entry) ? entry.budgetMonthlyUSD : undefined;
  const month = isObject(entry) ? entry.budgetContinueMonth : undefined;
  return { limitUSD: validLimit(limit) ? limit : null, continueMonth: typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : null };
}

// The one read-modify-write of config.json, merged: every other key stays as the person wrote it.
function editProject(smDir, root, fn) {
  const file = join(smDir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  if (!isObject(config) || (config.projects !== undefined && !isObject(config.projects))) return { ok: false, error: 'config-unreadable' };
  const key = normalizePath(root);
  const projects = { ...config.projects };
  const next = fn(isObject(projects[key]) ? { ...projects[key] } : {});
  if (Object.keys(next).length) projects[key] = next;
  else delete projects[key];
  writeAtomic(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`);
  return { ok: true };
}

// usd: dollars a month (0 means nothing more may start), or null for no budget.
export function setProjectBudget(smDir, root, value) {
  if (value !== null && !validLimit(value)) return { ok: false, error: 'bad-budget' };
  const res = editProject(smDir, root, (entry) => {
    const { budgetMonthlyUSD: _, ...rest } = entry;
    return value === null ? rest : { ...rest, budgetMonthlyUSD: value };
  });
  return res.ok ? { ok: true, limitUSD: value } : res;
}

// "Continue this month": the pause lifts until the month ends; the next month starts paused again if it goes over.
export function continueProjectMonth(smDir, root, month) {
  const res = editProject(smDir, root, (entry) => ({ ...entry, budgetContinueMonth: month }));
  return res.ok ? { ok: true, continueMonth: month } : res;
}

// ---- the outside AIs' ledger ----

// A root a call may be filed under: a chat's project root (exact) or the asking program's own folder (absolute).
export function cleanRoot(value) {
  if (typeof value !== 'string' || !value || value.length > ROOT_MAX || /[\u0000-\u001f]/.test(value) || !isAbsolute(value)) return null;
  return normalizePath(value);
}

export function readLedger(smDir) {
  if (!smDir) return {};
  const stored = readJsonFile(join(smDir, LEDGER_FILE), {});
  return isObject(stored) && isObject(stored.months) ? stored.months : {};
}

// One outside call's cost, under its root and the month of `at` (ms). Only the last few months are kept.
export function addOthersSpend(smDir, root, costUSD, at = Date.now()) {
  const key = cleanRoot(root);
  if (!smDir || !key || !(Number.isFinite(costUSD) && costUSD > 0)) return false;
  const months = readLedger(smDir);
  const month = monthOf(at);
  const row = isObject(months[month]) ? months[month] : {};
  // Kept unrounded: a tiny call must still add up; rounding is for what is shown.
  row[key] = (Number(row[key]) || 0) + costUSD;
  months[month] = row;
  const kept = Object.fromEntries(Object.keys(months).sort().slice(-LEDGER_MONTHS).map((m) => [m, months[m]]));
  try {
    writeAtomic(join(smDir, LEDGER_FILE), `${JSON.stringify({ months: kept }, null, 2)}\n`);
  } catch {
    return false;
  }
  return true;
}

// Each root of the month goes to the project whose folder holds it (the deepest one): keys are normalized project roots.
export function othersByProject(monthRow, keys) {
  const out = new Map(keys.map((k) => [k, 0]));
  for (const [root, cost] of Object.entries(isObject(monthRow) ? monthRow : {})) {
    if (!(Number.isFinite(cost) && cost > 0)) continue;
    let best = null;
    for (const k of keys) {
      const inside = root === k || root.startsWith(k.endsWith('/') ? k : `${k}/`);
      if (inside && (best === null || k.length > best.length)) best = k;
    }
    if (best !== null) out.set(best, round6(out.get(best) + cost));
  }
  return out;
}

// ---- the month of one project ----

// The Claude cost of one month from the project's costByDay ("YYYY-MM-DD" → usd).
export function claudeMonthUSD(costByDay, month) {
  let sum = 0;
  for (const [day, cost] of Object.entries(isObject(costByDay) ? costByDay : {})) if (day.startsWith(`${month}-`)) sum += Number(cost) || 0;
  return round6(sum);
}

// level: ok, warn (80%) or over (100%); a budget of 0 is over at once. paused: over and not continued this month.
export function budgetOf({ limitUSD = null, claudeUSD = 0, othersUSD = 0, month, continueMonth = null }) {
  const usedUSD = round6(claudeUSD + othersUSD);
  const has = validLimit(limitUSD);
  const level = !has ? 'ok' : limitUSD === 0 ? 'over' : budgetStatus(usedUSD, limitUSD);
  const pct = !has ? null : limitUSD === 0 ? 100 : Math.round((100 * usedUSD) / limitUSD);
  const continued = has && continueMonth === month;
  return {
    month, limitUSD: has ? limitUSD : null, usedUSD, claudeUSD: round6(claudeUSD), othersUSD: round6(othersUSD), pct, level,
    continued, paused: level === 'over' && !continued,
  };
}

// Every project of the state gets its month: projects [{project, key}], the user's config, the ledger's months.
export function attachBudgets(built, userConfig, months, now) {
  const month = monthOf(now);
  const others = othersByProject(months?.[month], built.map((b) => b.key));
  for (const { project, key } of built) {
    const setting = budgetSetting(userConfig, project.root);
    project.budget = budgetOf({ ...setting, claudeUSD: claudeMonthUSD(project.costByDay, month), othersUSD: others.get(key) ?? 0, month });
  }
}

// ---- what the conductor reads ----

// One line for the conductor's prompt tail and the project chat's summary; '' with no budget. Plain words, no item codes.
export function projectBudgetLine(budget) {
  if (!budget || budget.limitUSD === null || budget.limitUSD === undefined) return '';
  const spent = `${usd(budget.usedUSD)} of its ${usd(budget.limitUSD)} monthly budget (${budget.pct}%)`;
  if (budget.paused) return `- This project used ${spent}: it is paused. Start nothing new that spends; ask the person whether to raise the budget or continue this month (they do it on the session-map page) and end with level "ask-reinforce".`;
  if (budget.continued) return `- This project used ${spent}; the person said to continue this month: go on, spending with care.`;
  if (budget.level === 'warn') return `- This project used ${spent}: past 80%, prefer the cheaper workers and say what each step will cost.`;
  return `- This project used ${spent}.`;
}

// What the orchestrator's tools answer while the project is paused.
export function pauseRefusal(budget) {
  return `budget: this project used ${usd(budget.usedUSD)} of its ${usd(budget.limitUSD)} monthly budget, so session-map starts nothing new. Ask the person whether to raise the budget or continue this month (they do it on the session-map page) and end your turn with level "ask-reinforce". Nothing running was stopped.`;
}
