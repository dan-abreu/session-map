// The orchestrator (id90 → or01, or02, or06, or17, or18): one page chat per project, node kind 'orchestrator', that opens
// the activity chats (one item each, the model it picks), sends them their next step and follows them through the tools
// of its own sessionmap MCP (orch-tools.mjs). The relay hands each call over with the chat that made it, so only the
// orchestrator is answered. Results come back by themselves through an inbox kept on disk; limits keep it from running
// away; the tidy scheduler sends it a pass when a project is quiet. The hub lends what it needs (hub below); the clock and
// the timer are injected, so tests never wait for them.
import { join } from 'node:path';
import { logAction, runAction } from '../actions.mjs';
import { setTidy, tidyOn } from '../background.mjs';
import { readRemoved } from '../hidden.mjs';
import { log } from '../log.mjs';
import { waitingFor } from '../parse/waiting.mjs';
import { setPlacement } from '../placements.mjs';
import { readConversation } from '../sources/claude-conversation.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { summaryOf } from '../web/alerts.js';
import { foldReply } from '../web/chatfold.js';
import { ORCH_TOOL_NAMES } from './orch-tools.mjs';
import { parseRun, readRunBlock } from './run.mjs';

export const ORCH_KIND = 'orchestrator';
// At once per orchestrator, and the places of CHATS_MAX the orchestrators leave to the person.
const WORKING_MAX = 3;
const RESERVE = 2;
const DAY_MAX = 30;
// Automatic turns in a row (inbox and tidy passes) before it stops and waits for the person.
const CHAIN_MAX = 20;
const LIST_MAX = 50;
const READ_MAX = 5;
const REPLY_BYTES = 4096;
const NOTES_MAX = 50;
const QUEUED_MAX = 20;
const OUTCOMES_MAX = 300;
const TEXT_MAX = 20_000;
const TITLE_MAX = 200;
const REASON_MAX = 300;
const TICK_MS = 5 * 60_000;
const TIDY_EVERY_MS = 24 * 3600_000;
const TIDY_NEW = 5;
// How long start_chat waits for claude to name the new chat's session, the key the orchestrator keeps.
const NAMED_MS = 20_000;
const NAMED_STEP_MS = 50;
const INBOX_FILE = 'orch-inbox.json';
const STATE_FILE = 'orchestra.json';

// Appended to the Autonomous prompt of the orchestrator only. Compact: with the tail it stays under 5 KB. Keep
// code-shaped tokens out of it: the transcript reader counts them as item codes.
export const ORCH_PROMPT = [
  'You are also this project\'s orchestrator: you open the right chats, give them clear instructions and follow them, so the work goes on cheaply and in plain sight. The work itself is done in the activity chats.',
  '- start_chat: one chat per item code, with only that item\'s context, on the cheapest model and effort that do it well (pick_worker helps).',
  '- Results arrive by themselves as "[session-map: activity ...]" notes: while chats work, end your turn, never poll. read_chat, send_to_chat and list_chats follow them.',
  '- Limits: 3 working at once, 30 a day. An answer starting with "limit": end your turn and wait for your inbox.',
  '- Older conversations (list_conversations): tie each to its item, continue_conversation those with work left, archive_conversation the finished (say why), rename_conversation unclear titles; leave the person what only they can do. End with a table: conversation, item, what you did.',
  '- The chats tick their own items and move the requests along.',
].join('\n');

// The pass of "Organize on its own" (or18): fixed text from session-map.
export const TIDY_TEXT = '[session-map: tidy pass] Organize this project on your own: tie each conversation that is not live to its item, give unclear titles a clear name (rename_conversation), archive the finished ones, continue the cut-off ones that still have work left, tick the items that are done and move the requests along. Same tools and limits as always. End with one short note: "Organized: ...".';
// The first message when the person opens an orchestrator that does not exist yet without writing one.
export const OPENING_TEXT = '[session-map: the person opened the orchestrator] Look at the project, your activity chats and the older conversations; say in a few lines what is under way, what waits for the person and what you will drive next, then drive it.';

const ONLY = 'only the orchestrator opens and drives chats';
const LIMIT = 'limit: wait for one to finish (your inbox tells you)';
const DAY_LIMIT = 'limit: 30 activity chats opened or continued today; go on tomorrow';
const LIVE = 'live in another window: leave it to the person';
const QUEUE_FULL = `limit: it already has ${QUEUED_MAX} instructions waiting; send more once it took them`;
const START_ERRORS = {
  'too-many-chats': LIMIT, 'server-restarting': 'session-map is restarting: end your turn, your inbox goes on after it',
  'live-chat': LIVE, busy: 'busy: it is starting or working now', 'claude-not-found': 'claude is not installed on this computer',
  'unknown-session': 'unknown conversation', 'no-folder': 'its folder is unknown: leave it to the person',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const objectOr = (v) => (isObject(v) ? v : {});
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= TEXT_MAX;
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round2 = (usd) => Math.round((Number(usd) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const reply = (status, body = {}) => ({ status, body: status < 300 ? { ok: true, ...body } : { ok: false, ...body } });
const ok = (value) => ({ ok: true, text: JSON.stringify(value) });
const fail = (error) => ({ ok: false, error });
const startError = (res) => START_ERRORS[res.body?.error] ?? `could not start: ${res.body?.error ?? res.status}`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// At most max bytes of UTF-8, cut with an ellipsis.
function capBytes(text, max) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= max) return text;
  return `${bytes.subarray(0, max - 3).toString('utf8').replace(/\uFFFD$/, '')}…`;
}

// ---- "Organize on its own" (or18): the switch and the rule ----

// The switch lives with the other per-project keys of session-map's config.json (background.mjs).
export { setTidy };
export const readTidy = (smDir, root) => tidyOn(objectOr(readJsonFile(join(smDir, 'config.json'), {})), root);

// A pass is due when the switch is on, nothing of the project works, something changed since the last pass (never two in
// a row on the same picture), and that pass is a day old or five conversations appeared since. rows: the project's
// conversations without the orchestrator's own; lastAt: ISO of the last pass, or none.
export function tidyDue({ on, working, rows, lastAt, now }) {
  if (!on || working) return false;
  const last = Date.parse(lastAt ?? '');
  if (!Number.isFinite(last)) return rows.length > 0;
  const changed = rows.some((r) => Date.parse(r.updatedAt ?? '') > last);
  const fresh = rows.filter((r) => Date.parse(r.startedAt ?? '') > last).length;
  return changed && (now - last >= TIDY_EVERY_MS || fresh >= TIDY_NEW);
}

// ---- the inbox note ----

// How an activity chat's turn ended, in the words of the inbox and list_chats. A stop by the person waits for the next step.
export function outcomeOf({ isError, reply: text, stopped }) {
  if (stopped) return 'waiting';
  if (isError) return 'error';
  if (readRunBlock(text)?.level === 'ask-reinforce') return 'waiting';
  const waits = waitingFor({ lastAssistantText: text, pendingQuestion: false }, null, null);
  return waits.strong || waits.weak ? 'waiting' : 'finished';
}

export function noteOf({ code, title, model, outcome, stopped = false, closed = false, costUSD, summary }) {
  const how = stopped ? `${outcome} (stopped by the person)` : closed ? `${outcome} (claude closed by itself)` : outcome;
  return `[session-map: activity ${code ?? `"${oneLine(title, 80)}"`} (${model}) ended — ${how}, cost US$ ${round2(costUSD).toFixed(2)}. Summary: ${summary || '(no words)'}]`;
}

const modelOf = (run, chat) => (run?.kind === 'autonomous' ? run.model ?? 'opus' : chat?.model ?? 'opus');

// hub: what the chat hub lends, all of it its own (hub.mjs):
//   live() the chats not ended; byKey(key); driven(sessionId) the one it drives now; start(body, state, internal);
//   send(chat, text, auto) a message from session-map; say(key, text, images) one from the person; holding(); pageChats();
//   closeIdle(sessionId); emit(chat, type, data); alert(chat, kind, reason, extra); transcript(sessionId); driving();
//   chatsMax.
// readState(): the newest state (main.mjs's quickState); changed(): a write the next state must show.
export function createOrchestra({
  smDir, hub, readState = null, changed = () => {}, now = Date.now, every = setInterval, stopEvery = clearInterval, tickMs = TICK_MS, namedMs = NAMED_MS,
}) {
  const inboxPath = join(smDir, INBOX_FILE);
  const statePath = join(smDir, STATE_FILE);
  const save = (path, value) => {
    try { writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`); } catch (err) { log('warn', 'orchestra-save-failed', { error: err.message }); }
  };
  const readInbox = () => {
    const stored = objectOr(readJsonFile(inboxPath, {}));
    return { notes: objectOr(stored.notes), queued: objectOr(stored.queued) };
  };
  // Its own counters: the day's starts, the automatic turns in a row, the last tidy pass, how each activity chat ended.
  const readMine = () => {
    const stored = objectOr(readJsonFile(statePath, {}));
    return { day: objectOr(stored.day), chain: objectOr(stored.chain), tidy: objectOr(stored.tidy), outcomes: objectOr(stored.outcomes) };
  };
  const update = (fn) => { const mine = readMine(); fn(mine); save(statePath, mine); };
  const iso = () => new Date(now()).toISOString();
  const opening = new Set();
  const delivering = new Set();
  let timer = null;
  let ticking = false;
  // Every chat it starts goes through here: once the hub closes none starts, and close waits for the ones under way, so
  // no claude is left behind it.
  let stopped = false;
  const inflight = new Set();
  const starting = (body, state, internal) => {
    if (stopped) return Promise.resolve(reply(409, { error: 'server-restarting' }));
    const run = hub.start(body, state, internal);
    inflight.add(run);
    run.then(() => inflight.delete(run), () => inflight.delete(run));
    return run;
  };
  // The calls that take a place run one at a time: two parallel start_chat calls must not both see a free place.
  let line = Promise.resolve();
  const serially = (fn) => {
    const run = line.then(fn, fn);
    line = run.catch(() => {});
    return run;
  };

  const isOrchestrator = (chat) => chat?.node?.kind === ORCH_KIND;
  // The person's archive, as the conversation list reads it: an archived orchestrator is no longer the project's.
  const readArchived = () => {
    const stored = readJsonFile(join(smDir, 'archived.json'), []);
    return new Set(Array.isArray(stored) ? stored : []);
  };
  // The project's orchestrator: the one the hub drives (also before claude named it), else the newest on disk; never one
  // the person archived or removed, the same rule as the page's list.
  function orchestratorOf(projectId) {
    const aside = new Set([...readRemoved(smDir), ...readArchived()]);
    const chat = hub.live().find((c) => c.projectId === projectId && isOrchestrator(c) && !aside.has(c.sessionId));
    if (chat) return { sessionId: chat.sessionId ?? null, chat };
    const [found] = Object.entries(hub.pageChats())
      .filter(([id, c]) => c?.projectId === projectId && c.node?.kind === ORCH_KIND && !aside.has(id))
      .sort((a, b) => String(b[1].startedAt ?? '').localeCompare(String(a[1].startedAt ?? '')));
    return found ? { sessionId: found[0], chat: hub.driven(found[0]) } : null;
  }
  const isChildOf = (chat, orchId, pages) => chat.parentId === orchId || (Boolean(chat.sessionId) && pages[chat.sessionId]?.parentId === orchId);
  // The orchestrator an activity chat answers to, or null (also once the person removed it from session-map).
  function motherOf(chat) {
    const pages = hub.pageChats();
    const id = chat.parentId ?? (chat.sessionId ? pages[chat.sessionId]?.parentId : null);
    return id && pages[id]?.node?.kind === ORCH_KIND && !readRemoved(smDir).has(id) ? id : null;
  }
  // One of its activity chats by the key list_chats gave (its session id) or the hub's own key.
  function childOf(orchId, key) {
    const pages = hub.pageChats();
    if (typeof key !== 'string') return null;
    if (pages[key]?.parentId === orchId) return { sessionId: key, chat: hub.driven(key) };
    const chat = hub.byKey(key);
    return chat && !chat.ended && isChildOf(chat, orchId, pages) ? { sessionId: chat.sessionId ?? null, chat } : null;
  }

  // ---- limits ----

  const dayCount = (orchId) => {
    const entry = readMine().day[orchId];
    return entry?.date === dayOf(now()) ? entry.count : 0;
  };
  const countDay = (orchId) => update((mine) => { mine.day[orchId] = { date: dayOf(now()), count: dayCount(orchId) + 1 }; });

  // Why one more activity chat cannot run now, or null. counted: one more of the day (a start or a continue); resuming one
  // of its own for its next step is not. Its own idle chats give their place to a new one: send_to_chat resumes them.
  const working = (orchId) => {
    const pages = hub.pageChats();
    return hub.live().filter((c) => c.running && isChildOf(c, orchId, pages)).length;
  };
  async function refusal(orchId, counted) {
    const pages = hub.pageChats();
    const mine = hub.live().filter((c) => isChildOf(c, orchId, pages));
    if (working(orchId) >= WORKING_MAX) return LIMIT;
    if (counted && dayCount(orchId) >= DAY_MAX) return DAY_LIMIT;
    if (hub.live().length < hub.chatsMax - RESERVE) return null;
    const lastTurn = (c) => String(c.turns?.at(-1)?.at ?? c.startedAt);
    const [idle] = mine.filter((c) => !c.running && c.sessionId).sort((a, b) => lastTurn(a).localeCompare(lastTurn(b)));
    if (idle && await hub.closeIdle(idle.sessionId)) return null;
    return LIMIT;
  }

  // claude names a new chat's session at its first turn: that id is the key the orchestrator keeps.
  async function named(key) {
    for (let waited = 0; waited < namedMs; waited += NAMED_STEP_MS) {
      const chat = hub.byKey(key);
      if (chat?.sessionId) return chat.sessionId;
      if (!chat || chat.ended) return null;
      await sleep(NAMED_STEP_MS);
    }
    return null;
  }

  // ---- the tools ----

  function itemOf(project, code) {
    if (typeof code !== 'string' || !code.trim()) return null;
    const want = code.trim().toLowerCase();
    for (const part of project.arch?.parts ?? []) {
      for (const item of (part.groups ?? []).flatMap((g) => g.items)) if (item.code && item.code.toLowerCase() === want) return { part, code: item.code };
    }
    return null;
  }
  const runOf = (args) => parseRun({ kind: 'autonomous', model: args.model, effort: args.effort });
  const BAD_RUN = 'model is haiku, sonnet, opus or fable; effort is low, medium, high, xhigh or max';
  const stateOf = (page, driven, outcome) => (driven?.running ? 'working' : !driven && page?.running === true ? 'cut off' : outcome?.state ?? 'finished');

  function listChats({ chat: me, orchId, project }) {
    const pages = hub.pageChats();
    const rows = new Map((project.conversations ?? []).map((r) => [r.sessionId, r]));
    const { outcomes } = readMine();
    const chats = Object.entries(pages).filter(([, c]) => c?.parentId === orchId).map(([sessionId, c]) => {
      const driven = hub.driven(sessionId);
      const run = parseRun(c.run);
      return {
        key: sessionId, code: c.node?.code ?? rows.get(sessionId)?.itemCode ?? null, title: c.title ?? '', model: modelOf(run, driven),
        state: stateOf(c, driven, outcomes[sessionId]), costUSD: round2(driven?.costUSD ?? rows.get(sessionId)?.costUSD ?? outcomes[sessionId]?.costUSD),
        summary: outcomes[sessionId]?.summary ?? null,
      };
    });
    const unnamed = hub.live().filter((c) => !c.sessionId && c.parentId === orchId)
      .map((c) => ({ key: c.key, code: c.node?.code ?? null, title: c.title ?? '', model: modelOf(c.run, c), state: 'working', costUSD: 0, summary: null }));
    const all = [...chats, ...unnamed];
    return ok({ chats: all, totalUSD: round2(all.reduce((sum, c) => sum + c.costUSD, Number(me.costUSD) || 0)) });
  }

  async function startChat({ orchId, project, state }, args) {
    if (!isText(args.instructions)) return fail('instructions: say what the chat must do');
    const found = itemOf(project, args.code);
    if (!found) return fail(`unknown code: ${oneLine(args.code, 40)} is not an item of this project's map`);
    const run = runOf(args);
    if (!run) return fail(BAD_RUN);
    const opened = await serially(async () => {
      const refused = await refusal(orchId, true);
      if (refused) return fail(refused);
      const node = { kind: 'item', partId: found.part.id, code: found.code };
      const res = await starting({ projectId: project.id, node, text: args.instructions, run }, state, { parentId: orchId, auto: 'orchestrator' });
      if (res.status !== 200) return fail(startError(res));
      countDay(orchId);
      return { key: res.body.chatKey };
    });
    if (!opened.key) return opened;
    const sessionId = await named(opened.key);
    return ok({ key: sessionId ?? opened.key, code: found.code, model: run.model ?? 'opus', effort: run.effort ?? 'high', state: 'working' });
  }

  // Instructions for a chat mid-turn (or while a restart waits) wait on disk for its turn end; past QUEUED_MAX the
  // orchestrator is told, the oldest are never dropped.
  function queue(sessionId, text) {
    const inbox = readInbox();
    const queued = inbox.queued[sessionId] ?? [];
    if (queued.length >= QUEUED_MAX) return fail(QUEUE_FULL);
    inbox.queued[sessionId] = [...queued, { at: iso(), text }];
    save(inboxPath, inbox);
    return ok({ key: sessionId, state: 'queued' });
  }
  const busy = (chat) => chat.running || chat.restart || chat.closing || hub.holding();

  async function sendToChat({ orchId, project, state }, args) {
    if (!isText(args.instructions)) return fail('instructions: say what the chat must do next');
    const target = childOf(orchId, args.key);
    if (!target) return fail('unknown key: not one of your chats (see list_chats)');
    const sessionId = target.sessionId ?? (target.chat ? await named(target.chat.key) : null);
    if (!sessionId) return fail('not ready yet: try again');
    const { chat } = target;
    if (chat && !chat.ended && busy(chat)) return queue(sessionId, args.instructions);
    // Open and idle it still holds its place, but back at work it is one of the 3 working. What waited for it (held
    // after a stop by the person) goes first, in the same message: the orchestrator asked, knowing of the stop.
    if (chat && !chat.ended) {
      return serially(() => {
        if (chat.ended || busy(chat)) return queue(sessionId, args.instructions);
        if (working(orchId) >= WORKING_MAX) return fail(LIMIT);
        hub.send(chat, [...takeQueued(sessionId), args.instructions].join('\n\n'), 'orchestrator');
        return ok({ key: sessionId, state: 'working' });
      });
    }
    // Its process was closed: resumed with the instructions, as one of its own (not one more of the day).
    return serially(async () => {
      const refused = await refusal(orchId, false);
      if (refused) return fail(refused);
      const queued = queuedFor(sessionId);
      const res = await starting({ projectId: project.id, sessionId, text: [...queued, args.instructions].join('\n\n') }, state, { parentId: orchId, auto: 'orchestrator' });
      if (res.status !== 200) return fail(startError(res));
      dropQueued(sessionId, queued.length);
      return ok({ key: sessionId, state: 'working' });
    });
  }

  function readChat({ orchId }, args) {
    const target = childOf(orchId, args.key);
    if (!target) return fail('unknown key: not one of your chats (see list_chats)');
    const last = Math.min(READ_MAX, Math.max(1, Number.isInteger(args.last) ? args.last : 1));
    const file = target.sessionId ? hub.transcript(target.sessionId) : null;
    if (!file) return ok({ key: target.sessionId ?? args.key, replies: [] });
    // One reply per turn: the assistant's words after each message, folded to plain text.
    const turns = [];
    for (const item of readConversation(file, { cwd: '' }).items) {
      if (item.type === 'user') turns.push([]);
      else if (item.type === 'assistant' && item.text) (turns.at(-1) ?? turns[turns.push([]) - 1]).push(item.text);
    }
    const replies = turns.filter((t) => t.length).slice(-last).map((t) => capBytes(foldReply(t.join('\n')).text, REPLY_BYTES));
    return ok({ key: target.sessionId, replies });
  }

  // The project's conversations it may look after: not live, not driven by the hub, not archived, not its own.
  function olderOf(orchId, project) {
    const driving = hub.driving();
    const pages = hub.pageChats();
    return (project.conversations ?? []).filter((r) => !r.live && !r.archived && !driving.has(r.sessionId) && r.sessionId !== orchId
      && r.node?.kind !== ORCH_KIND && r.parentId !== orchId && pages[r.sessionId]?.parentId !== orchId);
  }
  const rowOf = (project, sessionId) => (typeof sessionId === 'string' ? (project.conversations ?? []).find((r) => r.sessionId === sessionId) ?? null : null);
  const cardOf = (card) => (isObject(card) ? {
    title: card.title ?? null, doing: card.doing ?? null,
    todo: Array.isArray(card.todo) ? card.todo.slice(0, 5) : [], waiting: Array.isArray(card.waiting) ? card.waiting.slice(0, 5) : [],
  } : null);

  function listConversations({ orchId, project }) {
    const cards = new Map((project.chats ?? []).map((c) => [c.sessionId, c.card]));
    const conversations = olderOf(orchId, project)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      .slice(0, LIST_MAX)
      .map((r) => ({
        sessionId: r.sessionId, title: r.title ?? '', origin: r.origin ?? null, itemCode: r.itemCode ?? null,
        state: r.cutOff ? 'cut off' : r.waiting ? 'waiting' : 'closed', lastStep: r.lastStep ? { kind: r.lastStep.kind ?? null, target: r.lastStep.target ?? null } : null,
        card: cardOf(cards.get(r.sessionId)), updatedAt: r.updatedAt ?? null, costUSD: round2(r.costUSD),
      }));
    return ok({ conversations });
  }

  // Refusals shared by continue and archive; null when the conversation may be taken.
  function untouchable(orchId, project, sessionId) {
    const target = rowOf(project, sessionId);
    if (!target) return 'unknown conversation: not one of this project\'s (see list_conversations)';
    if (sessionId === orchId || target.node?.kind === ORCH_KIND) return 'that is an orchestrator';
    if (target.live) return LIVE;
    if (hub.driven(sessionId)) return 'open in session-map now: leave it to the person';
    return null;
  }

  async function continueConversation({ orchId, project, state }, args) {
    if (!isText(args.instructions)) return fail('instructions: say what it must do');
    const run = runOf(args);
    if (!run) return fail(BAD_RUN);
    return serially(async () => {
      const refused = untouchable(orchId, project, args.sessionId) ?? await refusal(orchId, true);
      if (refused) return fail(refused);
      const res = await starting({ projectId: project.id, sessionId: args.sessionId, text: args.instructions, run }, state, { parentId: orchId, auto: 'orchestrator' });
      if (res.status !== 200) return fail(startError(res));
      countDay(orchId);
      return ok({ key: args.sessionId, model: run.model ?? 'opus', effort: run.effort ?? 'high', state: 'working' });
    });
  }

  async function archiveConversation({ orchId, project, state }, args) {
    const reason = oneLine(args.reason, REASON_MAX);
    if (!reason) return fail('reason: say why it is finished');
    const refused = untouchable(orchId, project, args.sessionId);
    if (refused) return fail(refused);
    const res = await runAction({ action: 'archive', sessionId: args.sessionId }, { state, smDir, driving: hub.driving() });
    if (res.status !== 200) return fail(`could not archive: ${res.body.error}`);
    log('info', 'orchestra-archived', { sessionId: args.sessionId, reason });
    changed();
    return ok({ sessionId: args.sessionId, archived: true });
  }

  // The rename the list does by hand (mm21): session-map's own placements, never the transcript.
  function renameConversation({ project }, args) {
    const title = typeof args.title === 'string' ? oneLine(args.title, TITLE_MAX + 1) : '';
    if (!title || title.length > TITLE_MAX) return fail('title: one line, at most 200 characters');
    if (!rowOf(project, args.sessionId)) return fail('unknown conversation: not one of this project\'s (see list_conversations)');
    setPlacement(smDir, args.sessionId, { title });
    logAction(smDir, { action: 'place', sessionId: args.sessionId, projectId: project.id }, 200);
    changed();
    return ok({ sessionId: args.sessionId, title });
  }

  const TOOLS = {
    list_chats: listChats, start_chat: startChat, send_to_chat: sendToChat, read_chat: readChat, list_conversations: listConversations,
    continue_conversation: continueConversation, archive_conversation: archiveConversation, rename_conversation: renameConversation,
  };

  // A call that came through the relay with the chat that made it. → {ok, text} or {ok: false, error}.
  async function call(chat, request) {
    const name = String(request?.name ?? '');
    if (!ORCH_TOOL_NAMES.has(name)) return fail(`unknown tool: ${name.slice(0, 40)}`);
    if (!isOrchestrator(chat)) return fail(ONLY);
    if (!chat.sessionId) return fail('not ready yet: try again');
    const state = readState ? await readState() : null;
    const project = state?.projects?.find((p) => p.id === chat.projectId);
    if (!project) return fail('session-map has not read this project yet: try again in a minute');
    try {
      return await TOOLS[name]({ chat, orchId: chat.sessionId, project, state }, objectOr(request.arguments));
    } catch (err) {
      log('warn', 'orchestra-tool-failed', { tool: name, error: err.message });
      return fail('session-map failed on this call');
    }
  }

  // ---- the inbox and the chain ----

  const chainOf = (orchId) => ({ n: 0, said: false, paused: false, ...objectOr(readMine().chain[orchId]) });
  const setChain = (orchId, value) => update((mine) => { mine.chain[orchId] = value; });

  // Every message the hub sends a chat. To the orchestrator: an inbox or tidy turn is one more in a row; the person's
  // own message starts the count again; the others (its own opening, the agreed restart's note) leave it as it is. A new
  // one is counted at its first turn end, once claude named it.
  function sent(chat, auto) {
    if (!isOrchestrator(chat)) return;
    const automatic = auto === 'inbox' || auto === 'tidy';
    if (auto && !automatic) return;
    if (!chat.sessionId) {
      chat.chainFirst = automatic;
      return;
    }
    setChain(chat.sessionId, automatic ? { ...chainOf(chat.sessionId), n: chainOf(chat.sessionId).n + 1 } : { n: 0 });
  }

  // Past CHAIN_MAX it stops and says so, once: on its chat, and to the person.
  function stopChain(orchId, chat, state) {
    if (chainOf(orchId).said) return;
    setChain(orchId, { ...chainOf(orchId), said: true });
    if (chat) hub.emit(chat, 'orchestra', { stopped: 'chain', turns: CHAIN_MAX });
    const page = hub.pageChats()[orchId] ?? {};
    const who = chat ?? { projectId: page.projectId, projectName: state?.projects?.find((p) => p.id === page.projectId)?.name ?? '', sessionId: orchId, title: page.title ?? '' };
    hub.alert(who, 'waiting', 'chain', { turns: CHAIN_MAX });
  }

  // One automatic message to the orchestrator (its inbox, a tidy pass): never mid-turn, never past CHAIN_MAX in a row,
  // never to one stopped by the person, waiting for the person's OK to spend or archived, never while a restart waits (one
  // that would have had it is marked held, so the restart resumes it). A closed one is resumed with it, within the places
  // the person keeps. → sent or not.
  async function push(orchId, text, auto, state) {
    if (readArchived().has(orchId)) return false;
    const chat = hub.driven(orchId);
    if (chat && (chat.running || chat.restart || chat.closing)) return false;
    const chain = chainOf(orchId);
    if (chain.paused || chain.waits) return false;
    if (chain.n >= CHAIN_MAX) {
      stopChain(orchId, chat, state);
      return false;
    }
    if (hub.holding()) {
      if (chat) chat.held = true;
      return false;
    }
    if (chat) {
      hub.send(chat, text, auto);
      return true;
    }
    const page = hub.pageChats()[orchId];
    if (!page || delivering.has(orchId) || hub.live().length >= hub.chatsMax - RESERVE) return false;
    delivering.add(orchId);
    try {
      const current = state ?? (readState ? await readState() : null);
      if (!current) return false;
      const res = await starting({ projectId: page.projectId, sessionId: orchId, text }, current, { auto });
      if (res.status !== 200) log('warn', 'orchestra-resume-failed', { error: res.body?.error ?? res.status });
      return res.status === 200;
    } finally { delivering.delete(orchId); }
  }

  // The notes waiting for one orchestrator, in one message; they leave the disk once sent.
  async function deliver(orchId, state) {
    const notes = readInbox().notes[orchId] ?? [];
    if (!notes.length || !(await push(orchId, notes.map((n) => n.text).join('\n'), 'inbox', state))) return false;
    const inbox = readInbox();
    inbox.notes[orchId] = (inbox.notes[orchId] ?? []).slice(notes.length);
    if (!inbox.notes[orchId].length) delete inbox.notes[orchId];
    save(inboxPath, inbox);
    return true;
  }

  // Past NOTES_MAX the oldest are folded into one, without their summaries (read_chat still has the replies): none is lost.
  // Not while a delivery is on its way (deliver takes the ones it sent off the front): folding would mix in the new one.
  function addNote(orchId, text) {
    const inbox = readInbox();
    const notes = [...(inbox.notes[orchId] ?? []), { at: iso(), text }];
    if (notes.length > NOTES_MAX && !delivering.has(orchId)) {
      const old = notes.splice(0, notes.length - NOTES_MAX + 1);
      notes.unshift({ at: old[0].at, text: old.map((n) => String(n.text).replace(/\. Summary: .*\]$/s, ']')).join('\n') });
    }
    inbox.notes[orchId] = notes;
    save(inboxPath, inbox);
  }

  // The texts waiting for a chat; dropQueued takes the first n off the disk once they went.
  const queuedFor = (sessionId) => (readInbox().queued[sessionId] ?? []).map((q) => q.text);
  function dropQueued(sessionId, n) {
    if (!n) return;
    const inbox = readInbox();
    inbox.queued[sessionId] = (inbox.queued[sessionId] ?? []).slice(n);
    if (!inbox.queued[sessionId].length) delete inbox.queued[sessionId];
    save(inboxPath, inbox);
  }
  const takeQueued = (sessionId) => {
    const queued = queuedFor(sessionId);
    dropQueued(sessionId, queued.length);
    return queued;
  };
  // The person stopped that chat's last turn: nothing session-map holds for it starts it again, only the orchestrator's
  // next step or the person's own message (the next turn end clears it).
  const stoppedByPerson = (sessionId) => readMine().outcomes[sessionId]?.stopped === true;

  // The instructions send_to_chat left for a chat, sent as one message once it is free.
  function sendQueued(chat) {
    const queued = queuedFor(chat.sessionId);
    if (!queued.length || chat.running || chat.ended || chat.closing || chat.restart || stoppedByPerson(chat.sessionId)) return false;
    if (hub.holding()) {
      chat.held = true;
      return false;
    }
    dropQueued(chat.sessionId, queued.length);
    hub.send(chat, queued.join('\n\n'), 'orchestrator');
    return true;
  }

  function remember(sessionId, outcome) {
    update((mine) => {
      mine.outcomes[sessionId] = { ...outcome, at: iso() };
      const ids = Object.keys(mine.outcomes).sort((a, b) => String(mine.outcomes[a].at).localeCompare(String(mine.outcomes[b].at)));
      for (const id of ids.slice(0, Math.max(0, ids.length - OUTCOMES_MAX))) delete mine.outcomes[id];
    });
  }

  function noteFor(chat, orchId, outcome, extra) {
    const page = hub.pageChats()[chat.sessionId] ?? {};
    const summary = extra.summary ?? '';
    remember(chat.sessionId, { state: outcome, summary, costUSD: round2(chat.costUSD), stopped: extra.stopped === true });
    addNote(orchId, noteOf({ code: chat.node?.code ?? page.node?.code ?? null, title: chat.title ?? page.title, model: modelOf(chat.run, chat), outcome, costUSD: chat.costUSD, ...extra, summary }));
    deliver(orchId).catch((err) => log('warn', 'orchestra-deliver-failed', { error: err.message }));
  }

  // The hub, at every turn end. end: {isError, reply, auto (session-map answered it and it goes on), stopped}.
  function turnEnded(chat, end) {
    if (isOrchestrator(chat)) return orchestratorEnded(chat, end);
    const orchId = chat.sessionId ? motherOf(chat) : null;
    if (!orchId || end.auto) return undefined;
    noteFor(chat, orchId, outcomeOf(end), { stopped: end.stopped, summary: summaryOf(end.reply) });
    return sendQueued(chat);
  }

  // On disk with the chain, so a closed orchestrator keeps them: a stop by the person holds the inbox until the person
  // writes again (paused); a turn that ended asking the person's OK to spend waits for it (waits).
  function orchestratorEnded(chat, end) {
    if (!chat.sessionId) return undefined;
    const first = chat.chainFirst === true;
    delete chat.chainFirst;
    const chain = chainOf(chat.sessionId);
    delete chain.waits;
    const waits = !end.auto && readRunBlock(end.reply)?.level === 'ask-reinforce';
    setChain(chat.sessionId, { ...chain, n: chain.n + (first ? 1 : 0), ...(waits ? { waits } : {}), paused: chain.paused || end.stopped });
    if (end.stopped || end.auto) return undefined;
    return deliver(chat.sessionId).catch((err) => log('warn', 'orchestra-deliver-failed', { error: err.message }));
  }

  // The hub, when a chat's process went away. An activity chat that died mid-turn is news for its orchestrator.
  function exited(chat, wasRunning) {
    if (!wasRunning || chat.closing || !chat.sessionId || isOrchestrator(chat)) return;
    const orchId = motherOf(chat);
    if (orchId) noteFor(chat, orchId, 'error', { closed: true });
  }

  // ---- opening it, and the tidy scheduler ----

  // A new orchestrator: the project chat's context at the root, the Autonomous way, its own prompt and tools.
  async function startOrchestrator(project, state, text, internal, images = {}) {
    opening.add(project.id);
    try {
      return await starting({ projectId: project.id, node: { kind: 'project' }, text, run: { kind: 'autonomous' }, ...images }, state, { orchestrator: true, ...internal });
    } finally { opening.delete(project.id); }
  }

  // The page's "Orquestrador": the project's one orchestrator, driven again if it was closed, started if there is none.
  // text: the person's message (optional); images: the ones attached to it, checked by the hub as any message's.
  async function open(body, state) {
    const project = state?.projects?.find((p) => p.id === body?.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    if (body.text !== undefined && !isText(body.text)) return reply(400, { error: 'bad-text' });
    if (body.images !== undefined && body.text === undefined) return reply(400, { error: 'bad-images' });
    if (opening.has(project.id)) return reply(409, { error: 'busy' });
    const images = body.images === undefined ? {} : { images: body.images };
    const orch = orchestratorOf(project.id);
    if (orch?.chat) {
      const answer = { chatKey: orch.chat.key, sessionId: orch.sessionId, started: false };
      if (body.text === undefined) return reply(200, answer);
      const res = hub.say(orch.chat.key, body.text, body.images);
      return res.status === 200 ? reply(200, answer) : res;
    }
    if (orch) {
      const res = await starting({ projectId: project.id, sessionId: orch.sessionId, ...(body.text === undefined ? { idle: true } : { text: body.text, ...images }) }, state);
      if (res.status !== 200) return res;
      // Driven again and idle: what waited in its inbox goes now (with a message, at that turn's end).
      if (body.text === undefined) deliver(orch.sessionId, state).catch((err) => log('warn', 'orchestra-deliver-failed', { error: err.message }));
      return reply(200, { ...res.body, sessionId: orch.sessionId, started: false });
    }
    const res = await startOrchestrator(project, state, body.text ?? OPENING_TEXT, body.text === undefined ? { auto: 'opening' } : {}, images);
    return res.status === 200 ? reply(200, { ...res.body, sessionId: null, started: true }) : res;
  }

  // What the page shows of one project's orchestrator.
  function info(projectId, state) {
    const project = state?.projects?.find((p) => p.id === projectId);
    const orch = orchestratorOf(projectId);
    const sessionId = orch?.sessionId ?? null;
    const pages = hub.pageChats();
    const working = sessionId ? hub.live().filter((c) => c.running && isChildOf(c, sessionId, pages)).length : 0;
    return {
      projectId, sessionId, chatKey: orch?.chat?.key ?? null, running: Boolean(orch?.chat?.running), working,
      tidy: project ? readTidy(smDir, project.root) : true, lastTidyAt: readMine().tidy[projectId]?.at ?? null,
    };
  }

  // One project: a pass when it is due, starting the orchestrator when there is none. → a pass went.
  async function tidy(project, state) {
    if (opening.has(project.id)) return false;
    const orch = orchestratorOf(project.id);
    const orchId = orch?.sessionId ?? null;
    const pages = hub.pageChats();
    const rows = (project.conversations ?? []).filter((r) => !r.archived && r.node?.kind !== ORCH_KIND && r.sessionId !== orchId
      && !(orchId && (r.parentId === orchId || pages[r.sessionId]?.parentId === orchId)));
    const working = hub.live().some((c) => c.projectId === project.id && c.running) || (project.conversations ?? []).some((r) => r.status === 'busy');
    if (!tidyDue({ on: readTidy(smDir, project.root), working, rows, lastAt: readMine().tidy[project.id]?.at, now: now() })) return false;
    let went;
    if (orchId) went = await push(orchId, TIDY_TEXT, 'tidy', state);
    else if (orch || hub.live().length >= hub.chatsMax - RESERVE) went = false;
    else went = (await startOrchestrator(project, state, TIDY_TEXT, { auto: 'tidy' })).status === 200;
    if (went) update((mine) => { mine.tidy[project.id] = { at: iso() }; });
    return went;
  }

  // Instructions left for an activity chat whose process closed since: it is resumed with them, as one of its own.
  function resumeQueued(sessionId, state) {
    const page = hub.pageChats()[sessionId];
    const orchId = page ? motherOf({ parentId: page.parentId }) : null;
    if (!orchId) return null;
    return serially(async () => {
      const queued = queuedFor(sessionId);
      if (!queued.length || hub.driven(sessionId) || stoppedByPerson(sessionId) || await refusal(orchId, false)) return;
      const res = await starting({ projectId: page.projectId, sessionId, text: queued.join('\n\n') }, state, { parentId: orchId, auto: 'orchestrator' });
      if (res.status === 200) dropQueued(sessionId, queued.length);
    });
  }

  // An idle one sent its instructions goes back to work: within the 3 working of its orchestrator.
  function sendQueuedIdle(chat) {
    const orchId = motherOf(chat);
    return serially(() => (orchId && working(orchId) >= WORKING_MAX ? false : sendQueued(chat)));
  }

  // Notes and instructions still on disk (a restart, a closed chat) go out when they can.
  async function flush(state) {
    const inbox = readInbox();
    for (const orchId of Object.keys(inbox.notes)) await deliver(orchId, state);
    for (const sessionId of Object.keys(inbox.queued)) {
      const chat = hub.driven(sessionId);
      if (chat) await sendQueuedIdle(chat);
      else await resumeQueued(sessionId, state);
    }
  }

  // Every tickMs: the inbox first, then at most one tidy pass (projects take turns, never a burst of new chats).
  async function tick() {
    if (ticking || hub.holding() || !readState) return;
    ticking = true;
    try {
      const state = await readState();
      await flush(state);
      for (const project of state?.projects ?? []) if (await tidy(project, state)) break;
    } catch (err) {
      log('warn', 'orchestra-tick-failed', { error: err.message });
    } finally { ticking = false; }
  }

  return {
    call, sent, turnEnded, exited, open, info, tick, prompt: (chat) => (isOrchestrator(chat) ? ORCH_PROMPT : ''),
    // An activity chat (it answers to an orchestrator), whose "finished" the orchestrator tells instead of an alert.
    isActivity: (chat) => motherOf(chat) !== null,
    // The scheduler runs only in the real server (main.mjs start); tests call tick() themselves.
    start: () => {
      if (timer) return;
      timer = every(() => { tick(); }, tickMs);
      timer?.unref?.();
    },
    // The hub closes: no new chat, and the starts under way finish first, so the hub ends them with the rest.
    stop: async () => {
      stopped = true;
      if (timer) stopEvery(timer);
      timer = null;
      await Promise.allSettled([...inflight]);
    },
  };
}
