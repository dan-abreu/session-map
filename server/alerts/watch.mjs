// The watcher's eyes (watcher-and-alerts wa01): two looks at the state, one after the other, become the changes worth
// telling the person about. Pure: the state comes in, plain events go out; delivering them is someone else's job.
import { summaryOf } from '../web/alerts.js';

const waitingOf = (w) => (w?.strong ? 'question' : w?.weak ? 'asks' : null);
const clashKey = (projectId, d) => `${projectId}|${[...(d.workCellIds ?? [])].sort().join('|')}`;

// The plan limits that are hit now (wa09), by kind and reset time: the same hit stays one key until its reset changes.
const limitsOf = (limits) => new Map(Object.entries(limits ?? {}).filter(([, l]) => l?.hit)
  .map(([kind, l]) => [`${kind}|${l.resetsAt ?? l.resetsText ?? ''}`, { kind, resetsAt: l.resetsAt ?? null, resetsText: l.resetsText ?? null }]));

// A project's monthly budget (orchestration or07): ok, then 80% (warn), then 100% (over), within one calendar month.
const BUDGET_RANK = { ok: 0, warn: 1, over: 2 };

// Every conversation of every project (whatever tool runs it), every open clash between branches, by key, the plan limits
// hit, and each project's budget level.
export function snapshotOf(state) {
  const chats = new Map();
  const clashes = new Map();
  const budgets = new Map();
  for (const p of state?.projects ?? []) {
    const b = p.budget;
    if (b && b.limitUSD !== null && b.limitUSD !== undefined && BUDGET_RANK[b.level] !== undefined) {
      budgets.set(p.id, { projectId: p.id, projectName: p.name, month: b.month, level: b.level, pct: b.pct, usedUSD: b.usedUSD, limitUSD: b.limitUSD });
    }
    const origins = new Map((p.conversations ?? []).map((r) => [r.sessionId, r.origin]));
    for (const c of p.chats ?? []) {
      if (c.archived) continue;
      chats.set(c.sessionId, {
        projectId: p.id, projectName: p.name, sessionId: c.sessionId, title: c.title ?? '', status: c.status,
        waiting: waitingOf(c.waiting), origin: origins.get(c.sessionId) ?? 'terminal', reply: c.lastAssistantText ?? '',
      });
    }
    for (const d of p.decisions ?? []) {
      if (d.kind === 'clash') clashes.set(clashKey(p.id, d), { projectId: p.id, projectName: p.name, branches: d.branches ?? [], files: d.files ?? [] });
    }
  }
  return { chats, clashes, limits: limitsOf(state?.limits), budgets };
}

// What changed from one look to the next. prev null is the first look: what is already so is no news.
// skip: the conversations the page drives itself, which it reports the moment they change.
export function transitionsOf(prev, next, { skip = new Set() } = {}) {
  if (!prev) return [];
  const events = [];
  for (const [id, n] of next.chats) {
    const p = prev.chats.get(id);
    if (!p || skip.has(id)) continue;
    const base = { projectId: n.projectId, projectName: n.projectName, sessionId: id, title: n.title, origin: n.origin };
    if (n.waiting && n.waiting !== p.waiting && (p.status === 'busy' || n.waiting === 'question')) events.push({ kind: 'waiting', reason: n.waiting, ...base });
    else if (p.status === 'busy' && n.status === 'idle') events.push({ kind: 'finished', reason: 'answer', ...base, summary: summaryOf(n.reply) });
    else if (p.status === 'busy' && n.status === 'closed') events.push({ kind: 'error', reason: 'stopped', ...base });
  }
  for (const [key, c] of next.clashes) {
    if (!prev.clashes.has(key)) events.push({ kind: 'clash', reason: 'clash', projectId: c.projectId, projectName: c.projectName, sessionId: null, branches: c.branches, files: c.files });
  }
  // A limit belongs to the account, not to a project: no project, no conversation.
  for (const [key, l] of next.limits) {
    if (!prev.limits.has(key)) events.push({ kind: 'limit', reason: l.kind, projectId: null, projectName: '', sessionId: null, resetsAt: l.resetsAt, resetsText: l.resetsText });
  }
  // One alert each time a project's budget level rises within a month; a budget just set counts from ok, a new month from ok.
  for (const [id, b] of next.budgets ?? new Map()) {
    const p = prev.budgets?.get(id);
    const before = p && p.month === b.month ? BUDGET_RANK[p.level] : 0;
    if (BUDGET_RANK[b.level] > before) {
      events.push({ kind: 'budget', reason: b.level === 'over' ? 'budgetOver' : 'budgetWarn', projectId: id, projectName: b.projectName, sessionId: null, pct: b.pct, usedUSD: b.usedUSD, limitUSD: b.limitUSD });
    }
  }
  return events;
}
