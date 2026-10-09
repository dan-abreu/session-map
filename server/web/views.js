// Pure view logic for the page: no DOM, no fetch, so node:test can load it.

const LEVEL_RANK = { cell: 0, tissue: 1, organ: 2 };
const LIFE_KINDS = new Set(['born', 'fused', 'fused-by-meaning', 'grouped', 'renamed']);
const DAY = 864e5;
const RANGE_DAYS = { d7: 7, d30: 30 };

const isWaiting = (c) => c.waiting.strong || c.waiting.weak || c.waiting.items.length > 0;

// What forces the brain to lay itself out again. Status and waiting flags are left out: those repaint in place.
export function structureKey(project) {
  const units = project.units.map((u) => [u.id, u.level, u.parentId, u.name, u.pinned, u.chatIds.join(','), u.work?.chats, u.work?.commits, u.work?.decisions].join(':'));
  const chats = project.chats.map((c) => [c.sessionId, c.unitId, c.workCellId, c.parentId, c.startedAt, c.archived].join(':'));
  const cells = project.workCells.map((w) => [w.id, w.status, w.unitId, w.files.length, w.commits, w.clashWith.join(','), w.touches.join(',')].join(':'));
  const links = project.unitLinks.map((l) => `${l.a}|${l.b}|${l.weight}`);
  return JSON.stringify([units, chats, cells, links]);
}

const eventKey = (a) => `${a.kind}|${a.ts}|${a.workCellId ?? ''}|${(a.unitIds ?? []).join(',')}`;

// Births, fusions and the AI's own reorganisations that showed up since the previous poll.
export function lifeEventsSince(prev, next) {
  if (!prev) return [];
  const seen = new Set(prev.activity.map(eventKey));
  return next.activity.filter((a) => LIFE_KINDS.has(a.kind) && !seen.has(eventKey(a)));
}

// The server writes an AI rename as "before → after"; before the first one, the unit wore the old name.
export function nameAt(unit, activity, t) {
  const renames = activity
    .filter((a) => a.kind === 'renamed' && a.unitIds?.[0] === unit.id && typeof a.subject === 'string' && a.subject.includes(' → '))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const next = renames.find((a) => Date.parse(a.ts) > t);
  return next ? next.subject.split(' → ')[0] : unit.name;
}

export function visibleProject(project, showArchived) {
  if (showArchived) return project;
  const hidden = new Set(project.chats.filter((c) => c.archived).map((c) => c.sessionId));
  if (!hidden.size) return project;
  return {
    ...project,
    chats: project.chats.filter((c) => !hidden.has(c.sessionId)),
    units: project.units.map((u) => ({ ...u, chatIds: u.chatIds.filter((id) => !hidden.has(id)) })),
  };
}

const byStart = (a, b) => a.startedAt.localeCompare(b.startedAt);

// Roadmap → stage → branch → chats, plus the branches no stage claims and the chats on the main branch.
export function mapTree(project, { archived = false } = {}) {
  const chats = project.chats.filter((c) => archived || !c.archived);
  const chatsOf = (wcId) => chats.filter((c) => c.workCellId === wcId).sort(byStart);
  const cellById = new Map(project.workCells.map((w) => [w.id, w]));
  let phases = null;
  const claimed = new Set();
  if (project.roadmap) {
    phases = [];
    for (const m of project.roadmap) {
      let phase = phases.find((p) => p.name === m.branch);
      if (!phase) phases.push(phase = { name: m.branch, stages: [] });
      const workCell = (m.workCellId && cellById.get(m.workCellId)) || null;
      if (workCell) claimed.add(workCell.id);
      phase.stages.push({ milestone: m, workCell, chats: workCell ? chatsOf(workCell.id) : [] });
    }
  }
  const loose = project.workCells.filter((w) => !claimed.has(w.id))
    .sort((a, b) => (a.status === 'merged') - (b.status === 'merged') || b.bornAt.localeCompare(a.bornAt))
    .map((workCell) => ({ workCell, chats: chatsOf(workCell.id) }));
  return { phases, loose, main: chatsOf(null) };
}

export function boardColumns(project, now) {
  const cellById = new Map(project.workCells.map((w) => [w.id, w]));
  const milestones = project.roadmap ?? [];
  const todo = milestones.filter((m) => m.status === 'open' && !cellById.has(m.workCellId)).map((milestone) => ({ kind: 'milestone', milestone }));
  const doing = [
    ...project.workCells.filter((w) => w.status !== 'merged').map((workCell) => ({ kind: 'workcell', workCell, milestone: milestones.find((m) => m.workCellId === workCell.id) ?? null })),
    ...project.chats.filter((c) => !c.archived && c.live && !c.workCellId && !isWaiting(c)).map((chat) => ({ kind: 'chat', chat })),
  ];
  const waiting = [
    ...(project.decisions ?? []).map((decision) => ({ kind: 'decision', decision })),
    ...project.chats.filter((c) => !c.archived && isWaiting(c)).sort((a, b) => b.waiting.strong - a.waiting.strong || b.updatedAt.localeCompare(a.updatedAt)).map((chat) => ({ kind: 'chat', chat })),
  ];
  const done = [
    ...milestones.filter((m) => m.status === 'done').map((milestone) => ({ kind: 'milestone', milestone })),
    ...project.workCells.filter((w) => w.status === 'merged' && w.mergedAt && now - Date.parse(w.mergedAt) <= 7 * DAY)
      .map((workCell) => ({ kind: 'workcell', workCell, milestone: null })),
  ];
  return { todo, doing, waiting, done };
}

function rangeStart(range, now) {
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return now - RANGE_DAYS[range] * DAY;
}

// A conversation's cost is its whole life; the period picks which conversations were active in it.
export function costRows(state, range, now) {
  const from = rangeStart(range, now);
  return state.projects
    .flatMap((project) => project.chats.filter((c) => Date.parse(c.updatedAt) >= from).map((chat) => ({ project, chat })))
    .sort((a, b) => b.chat.costUSD - a.chat.costUSD);
}

export function estimateTone(costUSD, estimateUSD) {
  if (!estimateUSD) return null;
  const ratio = costUSD / estimateUSD;
  return ratio > 1.3 ? 'over' : ratio > 1 ? 'warn' : 'ok';
}

export function budgetTone(usedUSD, monthlyUSD) {
  const ratio = usedUSD / monthlyUSD;
  return ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
}

export function aiSpend(state) {
  const projects = state.projects.filter((p) => p.ai).map((project) => ({ project, ...project.ai }));
  return { todayUSD: projects.reduce((s, p) => s + (p.spentUSDToday || 0), 0), projects };
}

export function bootstrapOf(project) {
  const boot = project.ai?.bootstrap;
  return boot && boot.done < boot.total ? boot : null;
}

const safeBridge = (url) => (typeof url === 'string' && url.startsWith('https://claude.ai/') ? url : null);

// Which buttons a conversation offers (desenho-2 § 17, § 20, § 22). write: how to keep talking to it.
export function chatButtons(chat) {
  const vscode = chat.entrypoint === 'claude-vscode';
  const phone = safeBridge(chat.bridgeUrl);
  const open = vscode || !chat.live ? { enabled: true, reason: null } : { enabled: false, reason: 'already-open' };
  const close = chat.live ? (chat.status === 'idle' ? { enabled: true, reason: null } : { enabled: false, reason: 'busy' }) : null;
  let write = null;
  if (chat.chattable && !chat.live) write = 'page';
  else if (phone) write = 'phone';
  else if (vscode) write = 'vscode';
  return { open, close, archive: chat.archived ? 'unarchive' : 'archive', write, phone };
}

const EMPTY_LOG = { sessionId: null, running: false, ended: false, items: [] };

function closeStreaming(items) {
  const last = items.at(-1);
  return last?.type === 'assistant' && last.streaming ? [...items.slice(0, -1), { ...last, streaming: false }] : items;
}

// The page's chat, folded from SSE events plus the person's own sends ({type: 'local-send'}).
export function chatLog(log = EMPTY_LOG, evt) {
  const { type, data } = evt;
  const items = log.items;
  const last = items.at(-1);
  switch (type) {
    case 'local-send':
      return { ...log, running: true, items: [...closeStreaming(items), { type: 'user', text: data.text }] };
    case 'session':
      return data.state === 'ended'
        ? { ...log, running: false, ended: true, items: closeStreaming(items) }
        : { ...log, sessionId: data.sessionId };
    case 'text': {
      const streaming = last?.type === 'assistant' && last.streaming;
      if (data.partial) {
        return streaming
          ? { ...log, items: [...items.slice(0, -1), { ...last, text: last.text + data.text }] }
          : { ...log, items: [...items, { type: 'assistant', text: data.text, streaming: true }] };
      }
      const done = { type: 'assistant', text: data.text, streaming: false };
      return { ...log, items: streaming ? [...items.slice(0, -1), done] : [...items, done] };
    }
    case 'tool':
      if (data.phase === 'use') return { ...log, items: [...closeStreaming(items), { type: 'tool', id: data.id, name: data.name, input: data.input, result: null, isError: false }] };
      return { ...log, items: items.map((i) => (i.type === 'tool' && i.id === data.id ? { ...i, result: data.text, isError: data.isError } : i)) };
    case 'permission':
      if (data.state === 'asked') return { ...log, items: [...closeStreaming(items), { type: 'permission', requestId: data.requestId, toolName: data.toolName, input: data.input, state: 'asked' }] };
      return { ...log, items: items.map((i) => (i.type === 'permission' && i.requestId === data.requestId ? { ...i, state: data.state } : i)) };
    case 'turn-end':
      return { ...log, running: false, items: closeStreaming(items) };
    case 'error':
      return { ...log, running: false, items: [...closeStreaming(items), { type: 'error', error: data.error }] };
    default:
      return log;
  }
}

// Where a person may move a unit: the top level, or any higher-level unit that is not already its parent.
export function unitMoves(units, id) {
  const unit = units.find((u) => u.id === id);
  if (!unit || unit.id === 'unsorted') return [];
  const higher = units.filter((u) => LEVEL_RANK[u.level] > LEVEL_RANK[unit.level] && u.id !== unit.parentId);
  return [...(unit.parentId ? [null] : []), ...higher];
}
