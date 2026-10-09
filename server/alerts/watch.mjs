// The watcher's eyes (watcher-and-alerts wa01): two looks at the state, one after the other, become the changes worth
// telling the person about. Pure: the state comes in, plain events go out; delivering them is someone else's job.
import { summaryOf } from '../web/alerts.js';

const waitingOf = (w) => (w?.strong ? 'question' : w?.weak ? 'asks' : null);
const clashKey = (projectId, d) => `${projectId}|${[...(d.workCellIds ?? [])].sort().join('|')}`;

// Every conversation of every project (whatever tool runs it) and every open clash between branches, by key.
export function snapshotOf(state) {
  const chats = new Map();
  const clashes = new Map();
  for (const p of state?.projects ?? []) {
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
  return { chats, clashes };
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
  return events;
}
