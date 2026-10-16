// Pure view logic for the page: no DOM, no fetch, so node:test can load it.
import { summaryOf } from './alerts.js';
import { inRange, isoDay } from './range.js';
import { clashKey } from './signals.js';
import { needsYou } from './now.js';


// Everything that waits for the person, in the order the list shows it: strong questions first. With a project id, only
// that project's; without, every project's. ignored: the clashes the person chose to stop seeing (wa07), by clashKey.
// The conversations are needsYou's, the pill's one rule (fresh, not archived, a busy one only on a real question); this
// adds the decisions of the map.
export function waitingEntries(state, projectId = null, ignored = new Set()) {
  const out = [];
  for (const p of state.projects) {
    if (projectId && p.id !== projectId) continue;
    for (const d of p.decisions || []) if (d.kind !== 'clash' || !ignored.has(clashKey(d))) out.push({ project: p, decision: d, rank: 1, ts: state.generatedAt });
  }
  for (const { project, chat: c } of needsYou(state)) {
    if (projectId && project.id !== projectId) continue;
    out.push({ project, chat: c, rank: c.waiting.strong ? 0 : c.waiting.items.length ? 1 : 3, ts: c.updatedAt ?? '' });
  }
  return out.sort((a, b) => a.rank - b.rank || b.ts.localeCompare(a.ts));
}

// The waiting list the amber pill opens (mm47): first the conversations of the pill, exactly those (needs: now.js
// needsYou, every project), then the decisions on the map of the open project, or of every project without a project id.
export function waitingSections(state, needs, { projectId = null, ignored = new Set() } = {}) {
  const rank = (c) => (c.waiting.strong ? 0 : c.waiting.items.length ? 1 : 3);
  const chats = needs.map(({ project, chat }) => ({ project, chat, rank: rank(chat), ts: chat.updatedAt ?? '' }))
    .sort((a, b) => a.rank - b.rank || b.ts.localeCompare(a.ts));
  return { chats, decisions: waitingEntries(state, projectId, ignored).filter((e) => e.decision) };
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

// The savings report of the Costs tab (sb05), from what the server already worked out. byModel: what each model cost in the
// period; tips: the suggestions of the conversations active in it, larger first; totalSavingUSD counts each conversation
// once (its larger tip, since the two suggestions overlap); tasks: the lines of work with a conversation in the period.
export function savingsReport(state, range) {
  const modelUSD = new Map();
  const tips = [];
  const tasks = [];
  let total = 0;
  for (const project of state.projects) {
    const lo = range ? isoDay(range.from) : '', hi = range ? isoDay(range.to) : '';
    for (const [day, models] of Object.entries(project.costByModel ?? {})) {
      if (range && (day < lo || day > hi)) continue;
      for (const [model, usd] of Object.entries(models)) modelUSD.set(model, (modelUSD.get(model) ?? 0) + usd);
    }
    const active = new Set(project.chats.filter((c) => inRange(Date.parse(c.updatedAt), range)).map((c) => c.sessionId));
    for (const chat of project.chats) {
      if (!active.has(chat.sessionId) || !chat.advice?.tips?.length) continue;
      for (const tip of chat.advice.tips) tips.push({ project, chat, tip });
      total += Math.max(...chat.advice.tips.map((x) => x.savingUSD));
    }
    for (const workCell of project.workCells ?? []) {
      if (workCell.costUSD > 0 && (workCell.chatIds ?? []).some((id) => active.has(id))) tasks.push({ project, workCell, costUSD: workCell.costUSD });
    }
  }
  return {
    byModel: [...modelUSD].map(([model, usd]) => ({ model, usd })).sort((a, b) => b.usd - a.usd),
    tips: tips.sort((a, b) => b.tip.savingUSD - a.tip.savingUSD),
    totalSavingUSD: total,
    tasks: tasks.sort((a, b) => b.costUSD - a.costUSD),
  };
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
  // A DeepSeek conversation runs in the DeepSeek Harness app: it is read here and opened there, never driven from the page.
  if (chat.engine === 'deepseek') return { open: { enabled: true, reason: null }, close: null, archive: chat.archived ? 'unarchive' : 'archive', write: 'deepseek', phone: false };
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

const EMPTY_LOG = { sessionId: null, running: false, ended: false, interrupted: false, mode: null, run: null, costUSD: null, context: null, check: null, items: [] };

function closeStreaming(items) {
  const last = items.at(-1);
  return last?.type === 'assistant' && last.streaming ? [...items.slice(0, -1), { ...last, streaming: false }] : items;
}

// What a history item may be (server/sources/claude-conversation.mjs): the chat screen draws each of these.
const HISTORY_TYPES = new Set(['user', 'assistant', 'thinking', 'tool', 'question']);

// The history does not mark what session-map wrote on its own: the notes the orchestrator gets start with a fixed tag.
const AUTO_TAGS = [['[session-map: activity', 'inbox'], ['[session-map: tidy pass]', 'tidy'], ['[session-map: the person opened the orchestrator]', 'opening']];
const marked = (i) => {
  const auto = i.type === 'user' && !i.auto ? AUTO_TAGS.find(([tag]) => String(i.text).startsWith(tag))?.[1] : null;
  return auto ? { ...i, auto } : i;
};

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
        // running: a turn still under way whose message the history shows, so no replayed message says so (pc13).
        ...log, costUSD: Number.isFinite(data.costUSD) ? data.costUSD : log.costUSD, context: data.context ?? log.context, interrupted: data.interrupted === true, running: data.running === true,
        items: Array.isArray(data.items)
          ? data.items.filter((i) => HISTORY_TYPES.has(i?.type)).map((i) => (i.type === 'assistant' ? { ...i, streaming: false } : marked(i)))
          : data.messages.map((m) => marked({ type: m.role === 'user' ? 'user' : 'assistant', text: m.text, streaming: false, ts: m.ts ?? null })),
      };
    case 'local-send':
      return { ...log, running: true, interrupted: false, check: null, items: [...closeStreaming(items), { type: 'user', text: data.text, local: true, ts, ...(data.images?.length ? { localImages: data.images } : {}) }] };
    case 'user': {
      // The server echoes every message it takes: the page's own send is already shown, one from elsewhere is not.
      const mine = items.findIndex((i) => i.type === 'user' && i.local && i.text === data.text);
      if (mine >= 0) {
        return { ...log, running: true, interrupted: false, items: items.map((i, n) => (n === mine ? { type: 'user', text: i.text, ts: i.ts ?? ts, ...(i.localImages ? { localImages: i.localImages } : {}) } : i)) };
      }
      // auto: an answer session-map gave for the person ("may reinforce on its own").
      return { ...log, running: true, interrupted: false, check: null, items: [...closeStreaming(items), { type: 'user', text: data.text, ts, ...(data.auto ? { auto: data.auto } : {}) }] };
    }
    case 'thinking':
      return { ...log, items: [...closeStreaming(items), { type: 'thinking', text: data.text ?? '', ms: null, ts }] };
    case 'mode':
      return { ...log, mode: data.mode };
    case 'run':
      return { ...log, run: data, costUSD: Number.isFinite(data.costUSD) ? data.costUSD : log.costUSD, context: data.context ?? log.context };
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
      // deferred: the Autonomous way denied it at once and left it for the person's final list; a line, never a card.
      if (data.state === 'asked' || data.state === 'deferred') {
        return { ...log, items: [...closeStreaming(items), { type: 'permission', requestId: data.requestId, toolName: data.toolName, input: data.input, state: data.state, ts, ...(data.diff ? { diff: data.diff } : {}) }] };
      }
      return { ...log, items: items.map((i) => (i.type === 'permission' && i.requestId === data.requestId ? { ...i, state: data.state } : i)) };
    case 'turn-end':
      return { ...log, running: false, costUSD: Number.isFinite(data?.costUSD) ? data.costUSD : log.costUSD, check: data?.check ?? null, items: closeStreaming(items) };
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
  if (log.interrupted || (last?.type === 'error' && last.error === 'exited')) return { kind: 'interrupted', resumable: Boolean(sessionId), reason: log.interrupted ? 'restart' : 'exited' };
  if (last?.type === 'error') return { kind: 'error' };
  if (last?.type === 'assistant') return { kind: 'finished', summary: summaryOf(last.text) };
  if (log.ended) return { kind: 'paused' };
  return { kind: log.items.length ? 'idle' : 'new' };
}

// The OK under a reply (or26), from the check the server made at the turn's end: what was checked, or what is missing,
// and what the request cost. A turn that only talked shows its cost alone; no check shows nothing.
export function checkLine(t, check, money) {
  if (!check) return '';
  const cost = Number.isFinite(check.costUSD) && check.costUSD > 0 ? money(check.costUSD) : null;
  let parts;
  if (check.missing?.length) {
    const list = check.missing.map((reason) => t(`check.missing.${reason}`, { n: check.tests?.failed ?? 0 })).join(', ');
    parts = [t('check.missing', { list })];
  } else if (check.tests || check.ticked?.length || check.saved?.length) {
    const passed = check.tests ? (Number.isFinite(check.tests.passed) ? t('check.testsPassed', { n: check.tests.passed }) : t('check.testsPassedNoCount')) : null;
    parts = [t('check.ok'), passed, ...(check.ticked ?? []).map((code) => t('check.ticked', { code })), ...(check.saved ?? []).map((hash) => t('check.saved', { hash }))];
  } else parts = [];
  return [...parts, cost].filter(Boolean).join(' · ');
}

// The run line by Send (id146): "Sonnet · low"; why is the entry brain's reason for the turn ("a chat", run.brain.<why>),
// kept for the tooltip, and null when the brain did not weigh it.
export function brainLine(t, { model, effort }, brain) {
  return { line: [model, effort].filter(Boolean).join(' · '), why: brain?.why ? t(`run.brain.${brain.why}`) : null };
}

// The memory chip by Send (pc37): what the conversation carries against the program's mark of a heavy one, "48k / 200k",
// amber from 70 % and red from 90 %. null without a number (another engine, a conversation not read yet).
const kilo = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`);
export function contextMeter(context) {
  const tokens = Number(context?.tokens);
  const max = Number(context?.max);
  if (!(tokens > 0) || !(max > 0)) return null;
  const pct = Math.round((tokens / max) * 100);
  return { used: kilo(tokens), max: kilo(max), label: `${kilo(tokens)} / ${kilo(max)}`, pct, tone: pct >= 90 ? 'high' : pct >= 70 ? 'warn' : 'ok' };
}

const PC_MODES = new Set(['default', 'acceptEdits', 'auto']);

// "Use this mode in every Claude on this PC": only a mode the settings file may hold (never bypass), compared with the
// mode the file has now.
export function pcModeOffer(choice, current) {
  const mode = PC_MODES.has(choice) ? choice : null;
  return { mode, same: Boolean(mode) && mode === current };
}

// The chat input (mm08): one line when empty, growing with the text up to about 40% of the panel, then it scrolls.
export function composerSize({ scrollHeight, paneHeight, minHeight }) {
  const max = Math.max(minHeight, Math.round(paneHeight * 0.4));
  return { height: Math.max(minHeight, Math.min(scrollHeight, max)), scroll: scrollHeight > max };
}

// A turn's steps (pc18): each stretch of tool and thinking rows with at least one tool folds into one line. A reply, a
// permission, a question or a day line between them starts a new stretch. → [{start, end}] (end not included).
const STEP_ROWS = new Set(['tool', 'thinking']);
export function stepRuns(items) {
  const runs = [];
  let start = -1;
  const close = (end) => {
    if (start >= 0 && items.slice(start, end).some((i) => i.type === 'tool')) runs.push({ start, end });
    start = -1;
  };
  items.forEach((item, n) => {
    if (STEP_ROWS.has(item?.type)) { if (start < 0) start = n; } else close(n);
  });
  close(items.length);
  return runs;
}

// What a stretch did, for its one line: the steps, and how many files it read and changed (each file once).
export function stepCounts(items) {
  const tools = items.filter((i) => i.type === 'tool');
  const files = (kind) => new Set(tools.filter((i) => i.step?.kind === kind).map((i) => i.step.target || i.diff?.path).filter(Boolean)).size;
  return { steps: tools.length, read: files('read'), changed: files('edit') };
}

// The kind tag a specialist's words open with, or null ("[code] fix the header" → 'code'). Pure (id148, or55): the role
// itself comes from the catalog the page holds (the brain model's agents).
export function kindTagOf(text) {
  return /^\s*\[([a-z-]+)\]/.exec(String(text ?? ''))?.[1] ?? null;
}

// The specialist roles a stretch called on (id148, or55): each Agent step names its kind tag in the description, and the
// page's role map (the brain model's agents, api.brain) maps the kind to the role. Pure and free: nothing reads the AI.
// → [{id, n}] sorted by count, roles the map does not know left out (the steps stay plain without the catalog).
export function stepRoles(items, byKind) {
  const counts = new Map();
  for (const i of items) {
    if (i.type !== 'tool' || (i.name !== 'Agent' && i.step?.kind !== 'agent')) continue;
    let text = String(i.step?.target ?? '');
    try {
      const description = JSON.parse(String(i.input ?? '{}'))?.description;
      if (typeof description === 'string' && description.trim()) text = description;
    } catch { /* not JSON: the target already holds the words */ }
    const role = kindTagOf(text) ? byKind.get(kindTagOf(text)) : null;
    if (role) counts.set(role.id, (counts.get(role.id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }));
}
