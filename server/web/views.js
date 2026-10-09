// Pure view logic for the page: no DOM, no fetch, so node:test can load it.
import { summaryOf } from './alerts.js';
import { modelName } from './live.js';
import { inRange } from './range.js';


// Everything that waits for the person, in the order the list shows it: strong questions first. With a project id, only
// that project's; without, every project's.
export function waitingEntries(state, projectId = null) {
  const out = [];
  for (const p of state.projects) {
    if (projectId && p.id !== projectId) continue;
    for (const d of p.decisions || []) out.push({ project: p, decision: d, rank: 1, ts: state.generatedAt });
    for (const c of p.chats) {
      if (!c.archived && (c.waiting.strong || c.waiting.weak || c.waiting.items.length)) {
        out.push({ project: p, chat: c, rank: c.waiting.strong ? 0 : c.waiting.items.length ? 1 : 3, ts: c.updatedAt });
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank || b.ts.localeCompare(a.ts));
}

const WAITING_ORDER = ['question', 'item', 'decision', 'clash', 'ends'];

export function waitingKind({ chat, decision }) {
  if (decision) return decision.kind === 'clash' || decision.kind === 'item' ? decision.kind : 'decision';
  return chat.waiting.strong ? 'question' : chat.waiting.items.length ? 'decision' : 'ends';
}

// The head of the waiting list: how many of each kind, so 19 items read as "2 questions · 14 decisions · 3 clashes".
export function waitingCounts(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(waitingKind(e), (counts.get(waitingKind(e)) ?? 0) + 1);
  return WAITING_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({ kind, n: counts.get(kind) }));
}

// A clash from a server that sends the branches is worded on the page, in the page's language.
export function clashWords(d) {
  if (!Array.isArray(d.branches) || d.branches.length < 2) return null;
  const [a, b] = d.branches;
  const [ownerA, ownerB] = d.owners ?? ['', ''];
  return { key: d.sameOwner ? 'waiting.clashMine' : 'waiting.clashOthers', vars: { a, b, ownerA, ownerB, files: (d.files ?? []).join(', ') } };
}

export function visibleProject(project, showArchived) {
  if (showArchived) return project;
  const hidden = new Set(project.chats.filter((c) => c.archived).map((c) => c.sessionId));
  if (!hidden.size) return project;
  return {
    ...project,
    chats: project.chats.filter((c) => !hidden.has(c.sessionId)),
    arch: { ...project.arch, parts: project.arch.parts.map((p) => ({ ...p, chatIds: p.chatIds.filter((id) => !hidden.has(id)) })) },
  };
}

// A conversation's cost is its whole life; the period picks which conversations were active in it.
export function costRows(state, range) {
  return state.projects
    .flatMap((project) => project.chats.filter((c) => inRange(Date.parse(c.updatedAt), range)).map((chat) => ({ project, chat })))
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

// The tunnel link goes into a href: only https passes.
export const safeTunnel = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

// Ranges {from, to} of changed lines (1-based) as a lookup, plus the first one to scroll to.
export function changedLines(changes) {
  return { has: (n) => changes.some((c) => n >= c.from && n <= c.to), first: changes.length ? Math.min(...changes.map((c) => c.from)) : null };
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

const EMPTY_LOG = { sessionId: null, running: false, ended: false, interrupted: false, mode: null, run: null, costUSD: null, items: [] };

function closeStreaming(items) {
  const last = items.at(-1);
  return last?.type === 'assistant' && last.streaming ? [...items.slice(0, -1), { ...last, streaming: false }] : items;
}

// What a history item may be (server/sources/claude-conversation.mjs): the chat screen draws each of these.
const HISTORY_TYPES = new Set(['user', 'assistant', 'thinking', 'tool', 'question']);

// The page's chat, folded from SSE events plus the person's own sends ({type: 'local-send'}) and the history of a
// reopened conversation ({type: 'history', data: {items}}, or only {messages} from an older server). evt.at: when the
// page got the event, the time a live item shows.
export function chatLog(log = EMPTY_LOG, evt) {
  const { type, data } = evt;
  const items = log.items;
  const last = items.at(-1);
  const ts = evt.at ?? null;
  switch (type) {
    case 'history':
      return {
        ...log, costUSD: Number.isFinite(data.costUSD) ? data.costUSD : log.costUSD, interrupted: data.interrupted === true,
        items: Array.isArray(data.items)
          ? data.items.filter((i) => HISTORY_TYPES.has(i?.type)).map((i) => (i.type === 'assistant' ? { ...i, streaming: false } : i))
          : data.messages.map((m) => ({ type: m.role === 'user' ? 'user' : 'assistant', text: m.text, streaming: false, ts: m.ts ?? null })),
      };
    case 'local-send':
      return { ...log, running: true, interrupted: false, items: [...closeStreaming(items), { type: 'user', text: data.text, local: true, ts, ...(data.images?.length ? { localImages: data.images } : {}) }] };
    case 'user': {
      // The server echoes every message it takes: the page's own send is already shown, one from elsewhere is not.
      const mine = items.findIndex((i) => i.type === 'user' && i.local && i.text === data.text);
      if (mine >= 0) {
        return { ...log, running: true, interrupted: false, items: items.map((i, n) => (n === mine ? { type: 'user', text: i.text, ts: i.ts ?? ts, ...(i.localImages ? { localImages: i.localImages } : {}) } : i)) };
      }
      // auto: an answer session-map gave for the person ("may reinforce on its own").
      return { ...log, running: true, interrupted: false, items: [...closeStreaming(items), { type: 'user', text: data.text, ts, ...(data.auto ? { auto: data.auto } : {}) }] };
    }
    case 'thinking':
      return { ...log, items: [...closeStreaming(items), { type: 'thinking', text: data.text ?? '', ms: null, ts }] };
    case 'mode':
      return { ...log, mode: data.mode };
    case 'run':
      return { ...log, run: data, costUSD: Number.isFinite(data.costUSD) ? data.costUSD : log.costUSD };
    case 'session':
      return data.state === 'ended'
        ? { ...log, running: false, ended: true, items: closeStreaming(items) }
        : { ...log, sessionId: data.sessionId, ended: false, mode: data.mode ?? log.mode };
    case 'text': {
      const streaming = last?.type === 'assistant' && last.streaming;
      if (data.partial) {
        return streaming
          ? { ...log, items: [...items.slice(0, -1), { ...last, text: last.text + data.text }] }
          : { ...log, items: [...items, { type: 'assistant', text: data.text, streaming: true, ts }] };
      }
      const done = { type: 'assistant', text: data.text, streaming: false, ts: streaming ? last.ts ?? ts : ts };
      return { ...log, items: streaming ? [...items.slice(0, -1), done] : [...items, done] };
    }
    case 'tool':
      if (data.phase === 'use') {
        const details = Object.fromEntries(['step', 'diff', 'todos'].filter((k) => data[k] !== undefined).map((k) => [k, data[k]]));
        return { ...log, items: [...closeStreaming(items), { type: 'tool', id: data.id, name: data.name, input: data.input, ...details, result: null, isError: false, ts }] };
      }
      return { ...log, items: items.map((i) => (i.type === 'tool' && i.id === data.id ? { ...i, result: data.text, isError: data.isError } : i)) };
    case 'permission':
      if (data.state === 'asked') {
        return { ...log, items: [...closeStreaming(items), { type: 'permission', requestId: data.requestId, toolName: data.toolName, input: data.input, state: 'asked', ts, ...(data.diff ? { diff: data.diff } : {}) }] };
      }
      return { ...log, items: items.map((i) => (i.type === 'permission' && i.requestId === data.requestId ? { ...i, state: data.state } : i)) };
    case 'turn-end':
      return { ...log, running: false, costUSD: Number.isFinite(data?.costUSD) ? data.costUSD : log.costUSD, items: closeStreaming(items) };
    case 'error':
      return { ...log, running: false, items: [...closeStreaming(items), { type: 'error', error: data.error, ts }] };
    default:
      return log;
  }
}

// The one state a page chat is in (page-chat pc05), so an ended chat never looks stuck: working, waiting for a permission,
// finished (with its summary), interrupted (a restart or a process that died; resumable once it has an id), error (a
// message refused), paused (the process ended with no reply to show), new.
export function chatState(log, { sessionId }) {
  if (!log) return { kind: 'new' };
  if (log.running) return { kind: log.items.some((i) => i.type === 'permission' && i.state === 'asked') ? 'permission' : 'working' };
  const last = log.items.at(-1);
  if (log.interrupted || (last?.type === 'error' && last.error === 'exited')) return { kind: 'interrupted', resumable: Boolean(sessionId) };
  if (last?.type === 'error') return { kind: 'error' };
  if (last?.type === 'assistant') return { kind: 'finished', summary: summaryOf(last.text) };
  if (log.ended) return { kind: 'paused' };
  return { kind: log.items.length ? 'idle' : 'new' };
}

// What the chat header says about how the conversation runs. choice: the run picked (run.mjs shapes); info: the last
// 'run' event of the server (null before the first); mine: what the person's own Claude settings run.
const EXPECTED = { auto: ['opus', 'high'], maestro: ['opus', 'high'], ultracode: ['opus', 'xhigh'] };
const LEVEL_TONE = { reinforced: 'reinforced', 'ask-reinforce': 'ask' };
// The same claude process flags: only 'may reinforce on its own' may differ.
const sameRun = (a, b) => a.kind === b.kind && a.model === b.model && a.effort === b.effort;
export function runWords(t, { choice, info: last, mine }) {
  // A run event of the way it ran before (the process ends on a change) speaks only for its cost.
  const info = last && (!last.run || sameRun(last.run, choice)) ? last : null;
  const [model, effort] = choice.kind === 'fixed' ? [choice.model, choice.effort] : choice.kind === 'settings' ? [mine?.model, mine?.effort] : EXPECTED[choice.kind];
  const shownModel = info?.model ?? model;
  const shownEffort = info?.effort ?? effort;
  const level = choice.kind === 'auto' || choice.kind === 'maestro' ? info?.level : null;
  let why = t(`run.why.${choice.kind}`);
  if (level) why = t(`run.level.${level}`, { why: info.why ?? t('run.level.noReason') });
  return {
    way: t(`run.way.${choice.kind}`),
    model: shownModel ? modelName(shownModel) : t('run.modelDefault'),
    effort: shownEffort ? t(`run.effort.${shownEffort}`) : null,
    why,
    tone: LEVEL_TONE[level] ?? (choice.kind === 'ultracode' ? 'ultracode' : choice.kind),
    cost: Number.isFinite(last?.costUSD) ? last.costUSD : null,
  };
}

const PC_MODES = new Set(['default', 'acceptEdits', 'auto']);

// "Use this mode in every Claude on this PC": only a mode the settings file may hold (never bypass), compared with the
// mode the file has now.
export function pcModeOffer(choice, current) {
  const mode = PC_MODES.has(choice) ? choice : null;
  return { mode, same: Boolean(mode) && mode === current };
}
