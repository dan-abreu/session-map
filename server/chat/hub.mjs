import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../actions.mjs';
import { exportMermaid, readDraft, writeDraft } from '../arch/flow.mjs';
import { cleanEnv, findClaude, runClaudeJSON } from '../ai/runner.mjs';
import { HAIKU_SCHEMA, haikuOf, haikuPrompt, levelRank, phaseNote, wantsHaiku, weigh } from '../ai/brain.mjs';
import { sameToken } from '../auth.mjs';
import { recordLineage } from '../brain/lineage.mjs';
import { log } from '../log.mjs';
import { waitingFor } from '../parse/waiting.mjs';
import { archivedPath } from '../archive.mjs';
import { bootTime, claudeDir, listLiveSessions, readTranscript } from '../sources/claude.mjs';
import { pageTurnCut } from '../collect.mjs';
import { readRemoved } from '../hidden.mjs';
import { helperPath, maskSecrets, readConversation, readImage, toolDetails, versionOf } from '../sources/claude-conversation.mjs';
import { summaryOf } from '../web/alerts.js';
import { contextOf } from './context.mjs';
import { FOCUS_KINDS, focusInputs } from '../foundation/practices-focus.mjs';
import { buildArgs, preview, startDriver } from './driver.mjs';
import { firstPrompt, personsWords } from './prompt.mjs';
import { pickMode, settingsMode } from './mode.mjs';
import {
  DEFAULT_RUN, addReinforcedSpend, budgetLine, expectedRun, mayReinforce, parseRun, readRunBlock, reinforcedLimit, reinforcedSpend, runArgs,
  isWeighed, settingsRun, withRunNote, withWeighed,
} from './run.mjs';
import { NO_FORCE_PUSH, commandOf, isDestructive, isForcePush, snapshot as takeSnapshot } from './safety.mjs';
import { guardSettings } from './guard.mjs';
import { cutTeams, hasCutTeams, teamsNote } from './teams.mjs';
import { ORCH_TOOL_NAMES } from './orch-tools.mjs';
import { ORCH_KIND, createOrchestra } from './orchestra.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { conductorTail } from '../ai/conductor.mjs';
import { projectBudgetLine } from '../budget.mjs';
import { loadStats } from '../ai/router.mjs';
import { measureWork, directiveOf, sizeRequest } from '../ai/size.mjs';
import { lastMermaidBlock, parseFlow } from '../web/flow.js';

const PERMISSION_MCP = fileURLToPath(new URL('./permission-mcp.mjs', import.meta.url));
const ARSENAL_MCP = fileURLToPath(new URL('../ai/arsenal-mcp.mjs', import.meta.url));
const KEY_RE = /^[0-9a-f]{32}$/;

// The MCP servers of an in-page chat (--strict-mcp-config: only these): the permission prompt, and the arsenal that
// asks the other AIs through session-map (or14). The arsenal reads the token from smDir itself: no secret in its env.
// orchestrator: the project's orchestrator, whose sessionmap server also lists its tools (orchestra.mjs).
// root: the folder the chat works in; the arsenal's skeleton tool (fd17) reads only under it (SM_ROOT, set here, never by the model).
export function chatMcpServers({ permissionUrl, secret, smDir, arsenalUrl, sessionId, root, orchestrator = false }) {
  return {
    sessionmap: { command: process.execPath, args: [PERMISSION_MCP], env: { SM_PERMISSION_URL: permissionUrl, SM_PERMISSION_SECRET: secret, ...(orchestrator ? { SM_ORCHESTRATOR: '1' } : {}) } },
    arsenal: { command: process.execPath, args: [ARSENAL_MCP], env: { SM_DIR: smDir, ...(root ? { SM_ROOT: root } : {}), ...(arsenalUrl ? { SM_URL: arsenalUrl } : {}), ...(sessionId ? { SM_SESSION_ID: sessionId } : {}) } },
  };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 20_000;
// Pasted images (mm22): ten per message (the owner's call on 2026-10-13; the API takes more). Each one costs about a
// thousand tokens on every later turn of the chat, so ten is a ceiling, not a target.
const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGES_MAX = 10;
const IMAGE_DATA_MAX = 5_000_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TITLE_MAX = 200;
const EVENTS_MAX = 2000;
const CHATS_MAX = 6;
// The orchestrator's own session-map tools, allowed up front by name: the relay never approves for the person.
const ORCH_ALLOWED = [...ORCH_TOOL_NAMES].map((name) => `mcp__sessionmap__${name}`);
// A restart that cut a chat off is told for a day; older ones still show it when opened.
const CUT_OFF_ALERT_MS = 24 * 3600_000;
const RELAY_BODY_MAX = 4 * 1024 * 1024;
// The docs give the permission tool 30 s; answering first keeps the denial ours, with our message.
const PERMISSION_TIMEOUT_MS = 25_000;
// A snapshot awaited inside the permission tool is given up after this, well within its 30 s (the guard hook took one too).
const ASK_SNAPSHOT_MS = 10_000;
const IDLE_MS = 30 * 60_000;
// The walk over a conversation's helper files only stats: a workflow can leave thousands, and the answer needs the newest one.
const HELPER_WALK_MAX = 5000;
const HELPER_DEPTH_MAX = 8;
// A walk that hit the cap has not seen every file, so it is no proof of quiet: the close is postponed this many more times.
const HELPER_CUT_RECHECKS = 2;
// A team cut in the background (sv16) is told when its conversation is next resumed, if it was launched within this.
const TEAMS_NEWS_MS = 24 * 3600_000;
// An ended chat keeps its events a while, so a page that reconnects still sees how it ended.
const LINGER_MS = 5 * 60_000;
// A conversation opens on its newest items and gives older ones a page at a time (pc15): a long one opens at once.
// The page is rounded back to where its first turn starts, unless that turn alone is longer than this much more.
const PAGE_ITEMS = 100;
const PAGE_ROUND_MAX = 50;
// A mirror asks again from the start of the last turn it has, since its last items may still change (a step's result,
// the reply's cost), but never more than this many items back.
const RESEND_MAX = 50;
const isIndex = (n) => Number.isInteger(n) && n >= 0;

// Where the page of items that ends before `end` starts.
function pageStart(items, end) {
  const start = Math.max(0, end - PAGE_ITEMS);
  for (let i = start; i >= Math.max(0, start - PAGE_ROUND_MAX); i--) if (items[i]?.type === 'user') return i;
  return start;
}

// Where a mirror that holds the items before `from` gets them again from.
function resendStart(items, from) {
  const floor = Math.max(0, from - RESEND_MAX);
  for (let i = from - 1; i >= floor; i--) if (items[i]?.type === 'user') return i;
  return floor;
}
// A piece of a streamed text, and the events that end the run of pieces a whole text replaces (page-chat pc13).
const isPiece = (evt) => evt.type === 'text' && evt.data?.partial === true;
const PIECE_BOUNDS = new Set(['user', 'text', 'tool', 'turn-end']);
// claude stamps its transcript with its own clock, a few ms off ours: times are compared with this much room (pc13).
const CLOCK_SLACK_MS = 1000;
const shiftIso = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
// Everything of a transcript (its items or its messages, in order) before the person's message of a turn sent at `at`:
// the first one stamped after the halfway point to the turn before, or to the process's start (prevAt), and at most
// CLOCK_SLACK_MS before `at`.
const beforeMessage = ({ at, prevAt }) => {
  const room = Math.min(CLOCK_SLACK_MS, Math.max(0, (Date.parse(at) - Date.parse(prevAt)) / 2));
  const from = shiftIso(at, -room);
  let past = false;
  return (m) => !(past ||= (m.type === 'user' || m.role === 'user') && Boolean(m.ts) && m.ts >= from);
};
const DENIED = 'Denied by the person in session-map.';
const TIMED_OUT = 'No answer in session-map within 25 s; denied.';
// Sent for the person when they let Automatic reinforce on its own and the month's allowance still covers the estimate.
const AUTO_REINFORCE = 'OK, you may reinforce. (Answered by session-map: the person allows reinforcing on its own while the monthly limit holds.)';
// The Autonomous way (pc16) never waits for a click: a question is decided by the conductor, and whatever Claude Code's own
// auto mode did not allow alone is left for the person's final list instead of stopping the conversation.
const DECIDE_YOURSELF = 'Autonomous way: decide yourself, take the option you would recommend, note it under \'Decisions I took\' and go on.';
const DEFERRED = 'Autonomous way: the person is not asked mid-task. Do not retry this action; reach the goal another way if there is a safe one, otherwise leave it and list it at the end under \'Left for you\' with the exact command or step.';
// The ways whose ask to reinforce session-map may answer within the monthly limit: Automatic when the person allows it,
// Autonomous always.
const SELF_REINFORCE_KINDS = new Set(['auto', 'autonomous']);
// By the way the live process started with (its prompt and permission mode), not one picked mid-turn for the next process.
const isAutonomous = (chat) => chat.processRun.kind === 'autonomous';
// The instructions a conversation already carries: the system prompt of its first turn, or the last note sent.
const instructionsOf = (run) => (run.kind === 'fixed' || run.kind === 'settings' ? 'plain' : run.kind);
const round6 = (usd) => Math.round(usd * 1e6) / 1e6;

// ---- the entry brain (or31/or29): each message of the person is weighed before it runs ----
// The one cheap Haiku call for a long text the rules cannot read runs in a folder of its own under the OS temp dir, with no tools.
const BRAIN_DIR = join(tmpdir(), 'session-map-brain');
const HAIKU_TIMEOUT_MS = 20_000;
const HAIKU_MAX = 2;
// What a conversation planned, kept so a bare "pode construir" later builds at the plan's size.
const PLANNED = new Set(['medium', 'large']);
const BIGGER = { medium: 1, large: 2 };
// The level the conversation moves to. Up at once; down only when the talk gets small (talk or trivial), never mid-turn
// (the caller only gives an idle chat's message). Otherwise the level stays and only the phase of the turn changes.
function settle(prev, next) {
  const same = prev && levelRank(next.model, next.effort) < levelRank(prev.model, prev.effort) && next.phase !== 'talk' && next.phase !== 'trivial';
  return same ? { ...next, model: prev.model, effort: prev.effort, why: prev.why } : next;
}
// The run as the process runs it: the person's choice with the brain's level on top.
const runOf = (chat) => withWeighed(chat.run, chat.weighed);
const flagsOf = (run) => JSON.stringify(runArgs(run));
// A process that was told to end for a change of level is killed after this, so the message that asked for it does not wait for ever.
const SWAP_KILL_MS = 8000;

const reply = (status, body = {}) => ({ status, body: status < 300 ? { ok: true, ...body } : { ok: false, ...body } });
// → the images of a message, [] when it has none, null when they are not images we pass on.
const imagesOf = (v) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > IMAGES_MAX) return null;
  const ok = v.every((i) => i && IMAGE_MEDIA.has(i.media) && typeof i.data === 'string' && i.data.length <= IMAGE_DATA_MAX && BASE64_RE.test(i.data));
  return ok ? v.map((i) => ({ media: i.media, data: i.data })) : null;
};
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= TEXT_MAX;
// Who sent a start's message (sendTo's from): the agreed restart's note, or how it shows.
const fromOf = (internal) => (internal.restart === true ? 'restart' : internal.auto);
const now = () => new Date().toISOString();
// What the page remembers of the point a chat was opened on: only the field its kind uses, which contextOf matched against the map.
const NODE_FIELD = { layer: 'layerId', group: 'group', item: 'code' };
const FENCE = '```';
const handEdited = (draft) => `The person changed the draft by hand since your last reply. Start from this version:\n${FENCE}mermaid\n${draft}\n${FENCE}`;
const nodeTag = (node) => {
  const field = NODE_FIELD[node.kind];
  return field && typeof node[field] === 'string' ? { kind: node.kind, [field]: node[field] } : { kind: node.kind };
};

// The conductor prompt's tail, built at each process start: who is ready today, the cap left, what the bench measured, and
// for Autonomous what the month still allows for reinforced work. Only the conductor modes get it; a failure leaves it out.
const CONDUCTORS = new Set(['auto', 'maestro', 'autonomous']);
// project: the line of the chat's project monthly budget (or07), or ''.
export function tailFor(run, smDir, facts, project = '') {
  if (!CONDUCTORS.has(run?.kind)) return '';
  let others = null;
  try { others = typeof facts === 'function' ? facts() : null; } catch { others = null; }
  let tail = '';
  try { tail = conductorTail({ others, stats: loadStats(smDir) }); } catch { tail = ''; }
  if (run.kind !== 'autonomous') return [tail, project].filter(Boolean).join('\n');
  let budget = '';
  try { budget = budgetLine({ limitUSD: reinforcedLimit(smDir), spentUSD: reinforcedSpend(smDir) }); } catch { budget = ''; }
  return [tail, budget, project].filter(Boolean).join('\n');
}

// An Autonomous chat always runs in Claude Code's own auto mode, whatever the header or the PC picked: its classifier
// decides, never session-map. Any other way runs in the chat's own mode.
const modeFor = (run, choice, fromSettings) => (run.kind === 'autonomous' ? 'auto' : pickMode(choice, fromSettings));

// Chats the page drives through the user's own claude CLI. bin: undefined looks it up at start, null means not installed.
// helperWrite(sessionId): when (ms) the conversation's background helpers last wrote, 0 for never; tests inject it.
// helperWalkMax: how many helper entries one look may list; tests make it small.
// eventsMax: how many events a chat keeps for a page that reconnects; tests make it small.
// onAlert(alert): the moment a chat finishes, asks or fails (watcher-and-alerts wa01); the watcher leaves these out of its diff.
// arsenalUrl: where the arsenal tool of a page chat finds this server (main.mjs's baseUrl); without it, its default port.
// conductorFacts(): the outside AIs right now (GET /api/ai/others' answer, main.mjs), for the conductor prompt's tail.
// snapshot(cwd): the safety snapshot of an Autonomous chat's folder (safety.mjs); tests inject a fake.
// askSnapshotMs: how long the permission tool waits for that snapshot; tests make it small.
// readState(): the newest state, for the orchestrator's tools and its scheduler; changed(): a write the next state must
// show; orchestra ({now, every, stopEvery, tickMs, namedMs}): the orchestrator's clock and timer (orchestra.mjs), for tests.
// chatsMax: how many chats may run at once; tests make it larger.
// projectBudget(projectId): that project's month against its budget (budget.mjs) from the newest finished state, or null.
// askHaiku(text): the one cheap call that helps the entry brain with a long text it cannot read (runClaudeJSON's answer); tests inject it.
export function createChatHub({
  smDir, dir = claudeDir(), bin, env = process.env, permissionTimeoutMs = PERMISSION_TIMEOUT_MS, idleMs = IDLE_MS, helperWrite, helperWalkMax = HELPER_WALK_MAX, eventsMax = EVENTS_MAX,
  spawner, onAlert = () => {}, arsenalUrl, conductorFacts, snapshot = takeSnapshot, askSnapshotMs = ASK_SNAPSHOT_MS,
  readState = null, changed = () => {}, orchestra: orchestraOptions = {}, chatsMax = CHATS_MAX, projectBudget = () => null, askHaiku = null,
} = {}) {
  const chats = new Map();
  const bySession = new Map();
  const everDriven = new Set();
  // The conversations a start is resuming right now, before bySession holds them: a double click starts one process (mm43).
  const resuming = new Set();
  let relay = null;
  // A restart another conversation asked for waits (sv13): no new turn starts, so the moment with none mid-turn comes.
  let holding = false;

  // The conversations the page started or wrote into, by sessionId: where they belong, the person's own words as title,
  // the folder to resume in, the permission mode picked in the header and the tools allowed for the whole conversation.
  // On disk, so closing the sheet, reloading the page or restarting the server loses none of it.
  const pageChatsPath = join(smDir, 'page-chats.json');
  const readPageChats = () => {
    const stored = readJsonFile(pageChatsPath, {});
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  };
  const savePageChat = (sessionId, patch) => {
    try {
      const all = readPageChats();
      all[sessionId] = { ...all[sessionId], ...patch };
      writeAtomic(pageChatsPath, `${JSON.stringify(all, null, 2)}\n`);
    } catch (err) { log('warn', 'page-chat-save-failed', { error: err.message }); }
  };
  const budgetLineOf = (projectId) => {
    try { return projectBudgetLine(projectBudget(projectId)); } catch { return ''; }
  };
  const drivenNow = (sessionId) => {
    const chat = bySession.get(sessionId);
    return chat && !chat.ended ? chat : null;
  };

  const alert = (chat, kind, reason, extra = {}) => {
    try {
      onAlert({ kind, reason, projectId: chat.projectId, projectName: chat.projectName, sessionId: chat.sessionId, title: chat.title, origin: 'map', ...extra });
    } catch (err) { log('warn', 'chat-alert-failed', { error: err.message }); }
  };

  // A turn that ended on its own: the final answer, a question for the person, or an error. A stop the person asked for,
  // or a turn session-map answers by itself, is no news.
  function alertTurnEnd(chat, data, reply, auto) {
    if (chat.stopRequested) return;
    if (data.isError) return alert(chat, 'error', 'failed');
    if (auto || chat.restart) return undefined;
    // The one stop of the Autonomous way: the next step would spend past the monthly limit.
    if (isAutonomous(chat) && readRunBlock(reply)?.level === 'ask-reinforce') return alert(chat, 'waiting', 'budget');
    const waits = waitingFor({ lastAssistantText: reply, pendingQuestion: false }, null, null);
    if (waits.strong || waits.weak) return alert(chat, 'waiting', waits.strong ? 'question' : 'asks');
    // An activity chat's end reaches the person through its orchestrator's summary, not as one alert per turn.
    if (orchestra.isActivity(chat)) return undefined;
    return alert(chat, 'finished', 'answer', { summary: summaryOf(reply) });
  }

  // Cut off: a turn was running when the process went away with the server, and nothing runs the conversation now. The
  // transcript is read last, only for those: a turn it shows closed after the page's last turn end finished elsewhere,
  // the rule collect's list follows (pageTurnCut).
  const cutOff = (sessionId, page, state) => page?.running === true && !drivenNow(sessionId)
    && !(state?.projects ?? []).some((p) => (p.conversations ?? []).some((c) => c.sessionId === sessionId && c.live))
    && pageTurnCut(page, ...lastTurnOf(sessionId));
  // [summary, when its last line was written] as collect dates a row: the last line's time, else the file's.
  const lastTurnOf = (sessionId) => {
    const file = transcriptOf(sessionId);
    const summary = file ? readTranscript(file) : null;
    if (!summary) return [null, null];
    return [summary, summary.endedAt ?? new Date(statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0).toISOString()];
  };

  // at: when the hub took it, where the history stops for a turn whose own message no longer fits (replayFrom).
  const emit = (chat, type, data) => {
    const evt = { id: ++chat.lastId, type, data, at: now() };
    chat.events.push(evt);
    if (chat.events.length > eventsMax) {
      // A long reply pushes out its own oldest piece first: its whole text replaces the pieces, a message has nothing to.
      const piece = chat.events.findIndex(isPiece);
      chat.events.splice(Math.max(piece, 0), 1);
    }
    for (const sink of chat.sinks) sink.write(evt);
  };

  // The pieces a text streamed in are worth nothing once the whole text arrives: a page that reconnects gets it once, and a
  // long reply no longer pushes the start of the conversation out of the events (page-chat pc13).
  function dropPieces(chat) {
    let start = chat.events.length;
    while (start > 0 && (isPiece(chat.events[start - 1]) || !PIECE_BOUNDS.has(chat.events[start - 1].type))) start--;
    if (start < chat.events.length) chat.events.splice(start, Infinity, ...chat.events.slice(start).filter((evt) => !isPiece(evt)));
  }

  // Where the history stops and the events take over (pc13). Normally at the message of the first turn the events still
  // hold, found by its place in the transcript, not its time: an automatic answer leaves in the millisecond the reply was
  // written. A turn so long that its own message went: at the oldest event kept, by time; a step on that line may show
  // twice, never not at all. Messages are never dropped as pieces, so a turn's mark is kept while its message is.
  function replayFrom(chat) {
    const oldest = chat.events[0];
    const kept = chat.turns.find((turn) => turn.eventId >= (oldest?.id ?? Infinity));
    if (kept) return { fromEventId: kept.eventId - 1, keep: () => beforeMessage(kept) };
    if (oldest && chat.turns.length) {
      const until = shiftIso(oldest.at, CLOCK_SLACK_MS);
      return { fromEventId: oldest.id - 1, keep: () => (m) => !m.ts || m.ts <= until };
    }
    return { fromEventId: 0, keep: () => beforeMessage({ at: chat.startedAt, prevAt: chat.startedAt }) };
  }

  // A snapshot never stops the work: a failure was already logged by safety.mjs, a throw from elsewhere is logged here.
  const safeSnapshot = (chat) => Promise.resolve().then(() => snapshot(chat.cwd)).catch((err) => log('warn', 'safety-snapshot-failed', { error: err.message }));
  // A slow one goes on in the background; the step does not wait past ms for it.
  const snapshotWithin = (chat, ms) => {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    return Promise.race([safeSnapshot(chat), late]).finally(() => clearTimeout(timer));
  };

  async function ask(chat, args) {
    const toolName = String(args?.tool_name ?? '');
    const input = args?.input && typeof args.input === 'object' ? args.input : {};
    const command = commandOf(toolName, input);
    // Whatever the way of running and whatever was allowed for the whole conversation.
    if (isForcePush(command)) return { behavior: 'deny', message: NO_FORCE_PUSH };
    if (isAutonomous(chat) && toolName === 'AskUserQuestion') return { behavior: 'deny', message: DECIDE_YOURSELF };
    if (chat.always.has(toolName)) {
      if (isAutonomous(chat) && isDestructive(command)) await snapshotWithin(chat, askSnapshotMs);
      return { behavior: 'allow', updatedInput: input };
    }
    const requestId = randomBytes(8).toString('hex');
    // An edit asks with its before and after, so allowing it reads as accepting the change (mm22).
    const { diff } = toolDetails(toolName, input, chat.cwd);
    const shown = (state) => ({ requestId, state, toolName, toolUseId: args?.tool_use_id ?? null, input: maskSecrets(preview(input)), ...(diff ? { diff } : {}) });
    if (isAutonomous(chat)) {
      emit(chat, 'permission', shown('deferred'));
      return { behavior: 'deny', message: DEFERRED };
    }
    emit(chat, 'permission', shown('asked'));
    alert(chat, 'waiting', 'permission', { tool: toolName });
    return new Promise((resolve) => {
      const finish = (state, decision) => {
        clearTimeout(timer);
        chat.pending.delete(requestId);
        emit(chat, 'permission', { requestId, state });
        resolve(decision);
      };
      const timer = setTimeout(() => finish('timeout', { behavior: 'deny', message: TIMED_OUT }), permissionTimeoutMs);
      chat.pending.set(requestId, { toolName, input, finish });
    });
  }

  // The permission MCP is claude's child, not the page: it proves itself with the secret of its own chat. /tool: a call
  // of the orchestrator's tools, answered for the chat that made it (orchestra.mjs).
  async function onRelay(req, res) {
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || (req.url !== '/permission' && req.url !== '/tool')) return answer(404, {});
    const secret = req.headers['x-session-map-secret'];
    const chat = [...chats.values()].find((c) => !c.ended && sameToken(secret, c.secret));
    if (!chat) return answer(403, {});
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > RELAY_BODY_MAX) return answer(413, {});
      chunks.push(chunk);
    }
    let args;
    try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return answer(400, {}); }
    if (req.url === '/tool') return answer(200, await orchestra.call(chat, args));
    return answer(200, await ask(chat, args));
  }

  function relayUrl() {
    relay ??= new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        onRelay(req, res).catch((err) => {
          log('warn', 'chat-relay-failed', { error: err.message });
          if (!res.headersSent) res.writeHead(500).end();
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        resolve({ server, url: `http://127.0.0.1:${server.address().port}/permission` });
      });
    });
    return relay.then((r) => r.url);
  }

  function onDriverEvent(chat, evt) {
    // The process the entry brain is replacing has gone: the new one takes its place (swapDriver).
    if (evt.type === 'exit' && chat.swapExit) {
      const next = chat.swapExit;
      chat.swapExit = null;
      if (!chat.closing) return next();
    }
    if (evt.type === 'session') {
      if (chat.moveMark) {
        chat.moveMark = false;
        if (chat.turns.length) chat.turns[chat.turns.length - 1].at = now();
      }
      // The CLI repeats init every turn: only the first one is news, or a mode the header changed since, or the model of a
      // process the entry brain swapped in.
      if (chat.announced) {
        if (evt.data.mode && evt.data.mode !== chat.reported) {
          chat.reported = evt.data.mode;
          emit(chat, 'mode', { mode: chat.reported });
        }
        if (evt.data.model && evt.data.model !== chat.model) {
          chat.model = evt.data.model;
          emitRun(chat);
        }
        return undefined;
      }
      chat.announced = true;
      chat.reported = evt.data.mode ?? null;
      chat.model = evt.data.model;
      chat.sessionId = evt.data.sessionId;
      bySession.set(chat.sessionId, chat);
      everDriven.add(chat.sessionId);
      if (chat.parentId && chat.parentId !== chat.sessionId) {
        try { recordLineage(smDir, chat.sessionId, chat.parentId); } catch (err) { log('warn', 'lineage-failed', { error: err.message }); }
      }
      const known = readPageChats()[chat.sessionId];
      // parentId: the mother, kept also for a conversation the orchestrator adopted (its list_chats reads it).
      savePageChat(chat.sessionId, {
        projectId: chat.projectId, root: chat.root, cwd: chat.cwd, mode: chat.choice, run: chat.run, prompted: chat.prompted, running: chat.running, updatedAt: now(),
        ...(chat.planned ? { planned: chat.planned } : {}),
        ...(chat.parentId && chat.parentId !== chat.sessionId ? { parentId: chat.parentId } : {}),
        ...(known ? {} : { partId: chat.partId, workCellId: chat.workCellId, ...(chat.node ? { node: chat.node } : {}), title: chat.title, startedAt: chat.startedAt }),
      });
      emit(chat, 'session', { sessionId: chat.sessionId, state: 'started', mode: chat.reported });
      return emitRun(chat);
    }
    if (evt.type === 'text' && !evt.data.partial) {
      dropPieces(chat);
      chat.turnText += `${evt.data.text}\n`;
      chat.lastText = evt.data.text;
    }
    if (evt.type === 'text' && chat.flow && !evt.data.partial) chat.flow.reply += `${evt.data.text}
`;
    if (evt.type === 'turn-end') {
      chat.running = false;
      if (chat.flow) saveFlowDraft(chat);
      const auto = endTurnRun(chat, evt.data.processCostUSD);
      clearTimeout(chat.idleTimer);
      armIdle(chat, idleMs);
      if (chat.sessionId) savePageChat(chat.sessionId, { running: false, updatedAt: now() });
      const { processCostUSD, ...data } = evt.data;
      emit(chat, 'turn-end', { ...data, costUSD: chat.costUSD });
      emitRun(chat);
      const ended = { isError: Boolean(data.isError), reply: chat.lastText, auto: Boolean(auto), stopped: Boolean(chat.stopRequested) };
      alertTurnEnd(chat, data, chat.lastText, auto);
      chat.stopRequested = false;
      chat.lastText = '';
      if (chat.restart) {
        chat.closing = true;
        chat.driver.end();
      } else if (auto && holding) chat.held = true;
      else if (auto) sendTo(chat, AUTO_REINFORCE, AUTO_REINFORCE, 'reinforce');
      // An activity chat's end goes to its orchestrator's inbox; the orchestrator's own end delivers what waits for it.
      orchestra.turnEnded(chat, ended);
      return undefined;
    }
    if (evt.type === 'exit') return onExit(chat, evt.data);
    if (evt.type === 'error' && evt.data.error === 'spawn-failed') {
      // A binary that cannot start never sends 'exit'.
      emit(chat, 'error', evt.data);
      chat.closing = true;
      return onExit(chat, { code: null, signal: null });
    }
    return emit(chat, evt.type, evt.data);
  }

  // What the header shows: the way it runs, the model claude reported (the alias until it does), the level the maestro
  // works at and why, and what the conversation has cost.
  function emitRun(chat) {
    const expected = expectedRun(runOf(chat), settingsRun(chat.root, dir));
    emit(chat, 'run', {
      run: chat.run, model: chat.model ?? expected.model, effort: expected.effort, ultracode: expected.ultracode,
      level: chat.level?.level ?? null, why: chat.level?.why ?? null, estimateUSD: chat.level?.estimateUSD ?? null, costUSD: chat.costUSD,
      // The entry brain's weight of the turn ("Sonnet · low: conversa"): its phase and the key of its reason (run.brain.<why>).
      brain: chat.weighed ? { phase: chat.weighed.phase, why: chat.weighed.why } : null,
    });
  }

  // The cost and level of the turn that ended. true: answer the maestro's ask to reinforce for the person.
  // Every turn after an answer to the ask counts against the month until one ends working the normal way: a turn that
  // did the reinforced work may still end asking for the next phase, and that must not slip past the limit.
  function endTurnRun(chat, processCostUSD) {
    const spent = Number.isFinite(processCostUSD) ? Math.max(0, processCostUSD - chat.processCostUSD) : 0;
    if (Number.isFinite(processCostUSD)) chat.processCostUSD = processCostUSD;
    chat.costUSD = round6(chat.baseCostUSD + chat.processCostUSD);
    const block = readRunBlock(chat.turnText);
    chat.turnText = '';
    if (block) chat.level = block;
    if (block?.level === 'direct' || block?.level === 'helpers') chat.reinforcing = false;
    if (block?.level === 'reinforced' || chat.reinforcing) {
      try { addReinforcedSpend(smDir, spent); } catch (err) { log('warn', 'reinforced-spend-failed', { error: err.message }); }
    }
    // One answer of session-map's per message of the person: a second ask in a row waits for the person's OK.
    if (!SELF_REINFORCE_KINDS.has(chat.run.kind) || block?.level !== 'ask-reinforce' || chat.restart || chat.autoAnswered) return false;
    const selfReinforce = isAutonomous(chat) || chat.run.selfReinforce;
    return mayReinforce({ selfReinforce, limitUSD: reinforcedLimit(smDir), spentUSD: reinforcedSpend(smDir), estimateUSD: block.estimateUSD });
  }

  // The workshop's reply ends with the whole draft in a mermaid fence: that block becomes the shared draft.
  function saveFlowDraft(chat) {
    const block = lastMermaidBlock(chat.flow.reply);
    chat.flow.reply = '';
    if (!block || !parseFlow(block).ok) return;
    try {
      writeDraft(smDir, chat.projectId, block);
      chat.flow.seen = block;
      emit(chat, 'draft', { text: block });
    } catch (err) { log('warn', 'flow-draft-save-failed', { error: err.message }); }
  }

  function onExit(chat, { code, signal }) {
    if (chat.ended) return;
    const wasRunning = chat.running;
    chat.ended = true;
    chat.running = false;
    clearTimeout(chat.idleTimer);
    for (const p of [...chat.pending.values()]) p.finish('denied', { behavior: 'deny', message: DENIED });
    if (chat.sessionId && bySession.get(chat.sessionId) === chat) bySession.delete(chat.sessionId);
    rmSync(chat.configPath, { force: true });
    if (code !== 0 && !chat.closing) {
      log('warn', 'chat-exited', { code, signal });
      emit(chat, 'error', { error: 'exited', code });
      alert(chat, 'error', 'exited');
    }
    emit(chat, 'session', { sessionId: chat.sessionId, state: 'ended' });
    for (const sink of chat.sinks) sink.end();
    chat.sinks.clear();
    setTimeout(() => chats.delete(chat.key), LINGER_MS).unref?.();
    orchestra.exited(chat, wasRunning);
    chat.exited();
  }

  // A chat is one of the map's, or one only the list holds (older than the map's window).
  function find(project, kind, id) {
    if (kind === 'chat') return [...project.chats, ...(project.conversations ?? [])].find((c) => c.sessionId === id) ?? null;
    const items = { part: project.arch?.parts, workCell: project.workCells }[kind] ?? [];
    return items.find((x) => x.id === id) ?? null;
  }

  // Ending stdin makes claude exit, and a workflow or background agent still running inside the session dies with it. So a
  // chat that went quiet stays open while those helpers still write (journals, agent transcripts) and is looked at again.
  function armIdle(chat, ms) {
    chat.idleTimer = setTimeout(() => {
      if (chat.ended) return;
      const { at, cut } = chat.sessionId ? helpersLook(chat.sessionId) : { at: 0, cut: false };
      let wait = chat.sessionId ? idleMs - (Date.now() - at) : 0;
      if (wait > 0) chat.cutRechecks = 0;
      else if (cut && (chat.cutRechecks ?? 0) < HELPER_CUT_RECHECKS) { chat.cutRechecks = (chat.cutRechecks ?? 0) + 1; wait = idleMs; }
      if (wait > 0) armIdle(chat, Math.min(wait, idleMs));
      else { chat.closing = true; chat.driver.end(); }
    }, ms);
    chat.idleTimer.unref?.();
  }

  // at: when the helpers last wrote; cut: the walk stopped at the cap, so a newer file may be unseen.
  function helpersLook(sessionId) {
    if (helperWrite) return { at: helperWrite(sessionId), cut: false };
    return newestHelperWrite(sessionId);
  }

  // A live chat's team at work (sv16, the agreed restart waits for it): its helpers wrote within quietMs, or a launch of
  // this process has not ended (an agent running a long command writes nothing meanwhile).
  function teamAtWork(chat, at, quietMs) {
    if (at - helpersLook(chat.sessionId).at < quietMs) return true;
    const file = transcriptOf(chat.sessionId);
    return Boolean(file) && hasCutTeams(cutTeams(file, { since: Date.parse(chat.startedAt) || 0 }));
  }

  // The teams a conversation whose process is gone started and that never finished (sv16), not yet told to it.
  function cutTeamsOf(sessionId) {
    const file = transcriptOf(sessionId);
    if (!file) return null;
    const told = Date.parse(readPageChats()[sessionId]?.teamsToldAt ?? '');
    const teams = cutTeams(file, { since: Math.max(Date.now() - TEAMS_NEWS_MS, Number.isFinite(told) ? told : 0) });
    return hasCutTeams(teams) ? teams : null;
  }

  // claude keeps what a conversation's background work writes under projects/<folder>/<sessionId>/subagents/.
  function newestHelperWrite(sessionId) {
    const file = transcriptOf(sessionId);
    if (!file) return { at: 0, cut: false };
    let newest = 0;
    let seen = 0;
    let cut = false;
    const walk = (folder, depth) => {
      let names = [];
      try { names = readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of names) {
        if (++seen > helperWalkMax) { cut = true; return; }
        const path = join(folder, entry.name);
        if (entry.isDirectory()) { if (depth < HELPER_DEPTH_MAX) walk(path, depth + 1); continue; }
        try { newest = Math.max(newest, statSync(path).mtimeMs); } catch { /* gone between the listing and the stat */ }
      }
    };
    walk(join(dirname(file), sessionId, 'subagents'), 0);
    return { at: newest, cut };
  }

  // ---- the entry brain (or31/or29) ----

  // The one cheap call; a failed one never blocks, the rules decide alone.
  // At most HAIKU_MAX calls at once, and none for a request the guards would refuse (a busy chat, the chat limit): the
  // chat limit then also bounds this subprocess work.
  let haikuBusy = 0;
  async function haikuFor(text, sessionId) {
    if (haikuBusy >= HAIKU_MAX || [...chats.values()].filter((c) => !c.ended).length >= chatsMax) return null;
    const driven = sessionId ? drivenNow(sessionId) : null;
    if (driven && (driven.running || driven.weighing || driven.restart)) return null;
    haikuBusy += 1;
    try {
      const claude = bin !== undefined ? bin : findClaude();
      if (!askHaiku && !claude) return null;
      const res = askHaiku ? await askHaiku(text) : await runClaudeJSON(haikuPrompt(text), { model: 'haiku', cwd: BRAIN_DIR, schemaHint: HAIKU_SCHEMA, bin: claude, env, timeoutMs: HAIKU_TIMEOUT_MS });
      return haikuOf(res);
    } catch { return null; } finally { haikuBusy -= 1; }
  }

  const wantsHaikuFor = (text) => wantsHaiku({ text, measured: sizeRequest({ text }) });
  const weighText = (text, { haiku = null, prev = null, planned = null } = {}) => settle(prev, weigh({ text, measured: sizeRequest({ text }), haiku, planned }));

  // A plan makes later "pode construir" build at its size; a build of a bigger size raises it.
  function rememberPlan(chat, turn) {
    let planned = chat.planned;
    if (turn.phase === 'plan') planned = turn.size === 'large' ? 'large' : 'medium';
    else if (turn.phase === 'build' && PLANNED.has(turn.size) && (BIGGER[turn.size] > (BIGGER[planned] ?? 0))) planned = turn.size;
    if (planned === chat.planned) return;
    chat.planned = planned;
    if (chat.sessionId) savePageChat(chat.sessionId, { planned });
  }

  // The process runs flags (model, effort, prompt) it cannot change: the idle one is ended and a new one resumes the same
  // conversation under the same key, so the page keeps its stream. The message that asked for the move waits for it.
  function launch(chat, resume) {
    const run = runOf(chat);
    const tail = [orchestra.prompt(chat), tailFor(run, smDir, conductorFacts, budgetLineOf(chat.projectId))].filter(Boolean).join('\n');
    return startDriver({
      bin: chat.bin,
      args: buildArgs({ mcpConfigPath: chat.configPath, resume, mode: chat.mode, run: runArgs(run, tail), settings: guardSettings({ snapshot: run.kind === 'autonomous' }), allowedTools: chat.orchestrator ? ORCH_ALLOWED : [] }),
      cwd: chat.cwd, env: cleanEnv(env),
      onEvent: (evt) => onDriverEvent(chat, evt), ...(spawner ? { spawner } : {}),
    });
  }

  function swapDriver(chat) {
    const old = chat.driver;
    const held = { message: null, stopped: false };
    chat.swapExit = () => {
      clearTimeout(chat.swapTimer);
      // The old process's cost joins the base; the new one counts from zero, and reports its own model.
      chat.baseCostUSD = chat.costUSD;
      chat.processCostUSD = 0;
      chat.model = null;
      chat.processRun = chat.run;
      chat.driver = launch(chat, chat.sessionId);
      if (held.stopped) return onDriverEvent(chat, { type: 'turn-end', data: { isError: false } });
      if (held.message) {
        // The transcript stamps the message when the new process reads it, seconds after it started: the turn's mark moves
        // to the process's first line (onDriverEvent), or the next turn's message would be read as this one (pc13).
        chat.moveMark = true;
        chat.driver.send(...held.message);
      }
      return undefined;
    };
    chat.driver = {
      send: (prompt, images) => { held.message = [prompt, images]; },
      interrupt: () => { held.message = null; held.stopped = true; },
      setMode: () => {},
      end: () => old.end(),
      kill: () => old.kill(),
    };
    // A process that does not leave on its own is killed: the person's message is waiting.
    chat.swapTimer = setTimeout(() => old.kill(), SWAP_KILL_MS);
    chat.swapTimer.unref?.();
    old.end();
  }

  // Put the turn's level on the chat: the same flags only change the header; others swap the process.
  function applyTurn(chat, turn) {
    const differs = flagsOf(withWeighed(chat.run, turn)) !== flagsOf(runOf(chat));
    // A process that never announced its session cannot be resumed: it keeps its level.
    const moves = differs && Boolean(chat.sessionId && chat.announced);
    const prev = chat.weighed;
    chat.weighed = differs && !moves && prev ? { ...turn, model: prev.model, effort: prev.effort, why: prev.why } : turn;
    rememberPlan(chat, turn);
    if (moves) swapDriver(chat);
    emitRun(chat);
  }

  // The message of the person into an idle live chat. In the run the brain weighs, the message is weighed first (Haiku once
  // when the rules are unsure and the text is long), the chat moves to the level it asks for and the turn opens with its
  // phase note. Any other message goes as it is. -> null when sent, or a Promise of null | a busy reply while Haiku was asked.
  // haiku: given when the caller asked already (null: it failed or was not needed).
  function deliver(chat, { text, prompt = text, images = [], auto, from = auto, quiet = false, haiku }) {
    if (quiet || auto !== undefined || !isWeighed(chat.run)) {
      sendTo(chat, text, prompt, auto, images, from);
      return null;
    }
    const go = (h) => {
      const turn = weighText(text, { haiku: h, prev: chat.weighed, planned: chat.planned });
      applyTurn(chat, turn);
      sendTo(chat, text, phaseNote(turn.phase, prompt), auto, images, from);
    };
    if (haiku !== undefined || !wantsHaikuFor(text)) {
      go(haiku ?? null);
      return null;
    }
    chat.weighing = true;
    return haikuFor(text).then((h) => {
      chat.weighing = false;
      if (chat.ended || chat.running || chat.restart || holding) return reply(409, { error: 'busy', chatKey: chat.key });
      go(h);
      return null;
    });
  }

  // shown: what the person wrote, for a page that opens the conversation later; prompt may carry the context block.
  // from: who sent it, for the orchestrator's count of turns in a row: auto, or 'restart' for the agreed restart's note,
  // which shows as the person's text but is session-map's.
  function sendTo(chat, shown, prompt = shown, auto = undefined, images = [], from = auto) {
    clearTimeout(chat.idleTimer);
    if (instructionsOf(chat.run) !== chat.prompted) {
      prompt = withRunNote(runOf(chat), prompt);
      chat.prompted = instructionsOf(chat.run);
      if (chat.sessionId) savePageChat(chat.sessionId, { prompted: chat.prompted });
    }
    if (chat.flow) {
      const draft = readDraft(smDir, chat.projectId);
      if (draft !== null && draft !== chat.flow.seen) prompt = `${handEdited(draft)}

${prompt}`;
      chat.flow.seen = draft ?? chat.flow.seen;
      chat.flow.reply = '';
    }
    // The answer to an ask is free text in the person's language: whichever it is, the level the next turns end on decides.
    if (chat.level?.level === 'ask-reinforce') chat.reinforcing = true;
    // Only session-map's own OK to reinforce counts as its one answer; an orchestrator's message is a new request.
    chat.autoAnswered = auto === 'reinforce';
    chat.held = false;
    orchestra.sent(chat, from);
    chat.running = true;
    // On disk at once: a server that dies mid-turn leaves the mark the next one reads as "cut off" (page-chat pc06).
    // The first message is saved with the rest when claude announces the session.
    if (chat.sessionId && chat.announced) savePageChat(chat.sessionId, { running: true });
    // Not awaited: claude needs seconds to start and think before its first step, and the git snapshot takes a fraction.
    if (isAutonomous(chat)) safeSnapshot(chat);
    emit(chat, 'user', auto ? { text: shown, auto } : { text: shown, ...(images.length ? { images: images.length } : {}) });
    // Only the marks whose message the events still hold matter, and the newest (replayFrom); each knows when the one
    // before it left (the first, when the process started), which bounds how far back its message may be stamped.
    const prevAt = chat.turns.at(-1)?.at ?? chat.startedAt;
    chat.turns = chat.turns.filter((turn) => turn.eventId >= chat.events[0].id);
    chat.turns.push({ eventId: chat.lastId, at: now(), prevAt });
    chat.driver.send(prompt, images);
  }

  // body: {projectId, node? ({kind, partId?, layerId?, group?, code?, line?}: the point of the map), partId? (same as a part node),
  //        frontId|workCellId?, sessionId? (continue it), parentId? (the mother of a new chat), cut? (a Continue from the
  //        cut-off panel, mm43), text, idle? (instead of text: a resume after the agreed restart, sv13, of a chat that was
  //        between turns; its process starts and waits for the next message)
  // internal (orchestra.mjs only, never the page's body): parentId (the orchestrator, mother of an activity chat, also on a
  //        resume), auto (how its first message shows: 'orchestrator', 'inbox', 'tidy', 'opening'), orchestrator (a new chat
  //        is the project's orchestrator: the project chat's context, node kind 'orchestrator'); restart (restart.mjs: the
  //        message is the agreed restart's note, session-map's and not the person's)
  async function start(body, state, internal = {}) {
    if (!body || typeof body !== 'object') return reply(400, { error: 'bad-request' });
    const idle = body.idle === true && body.sessionId !== undefined;
    if (!idle && !isText(body.text)) return reply(400, { error: 'bad-text' });
    if (holding) return reply(409, { error: 'server-restarting' });
    const images = imagesOf(body.images);
    if (!images) return reply(400, { error: 'bad-images' });
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const { partId } = body;
    const workCellId = body.frontId ?? body.workCellId;
    for (const id of [body.sessionId, body.parentId]) if (id !== undefined && !(typeof id === 'string' && UUID_RE.test(id))) return reply(400, { error: 'bad-session' });
    if (body.mode !== undefined && pickMode(body.mode, { mode: 'default' }) === null) return reply(400, { error: 'bad-mode' });
    const asked = body.run === undefined ? null : parseRun(body.run);
    if (body.run !== undefined && !asked) return reply(400, { error: 'bad-run' });
    // The entry brain weighs only the person's own words (not an orchestrator's message, the agreed restart's note or a
    // continue after a cut); the one Haiku call for a long text it cannot read comes before anything is checked or started.
    const mine = !idle && internal.auto === undefined && !internal.orchestrator && internal.restart !== true && body.cut !== true;
    const haiku = mine && (asked ? isWeighed(asked) : true) && wantsHaikuFor(body.text) ? await haikuFor(body.text, body.sessionId) : null;
    const fromSettings = settingsMode(project.root, dir);

    // The entry brain weighs the first message of a process (a fresh one has nothing to lose by starting low or high); the
    // phase note goes right before the person's words, after the context block.
    let turn = null;
    const planned = () => (PLANNED.has(saved?.planned) ? saved.planned : null);
    const weighFirst = (run) => {
      turn = mine && isWeighed(run) ? weighText(body.text, { haiku, planned: planned() }) : null;
      return phaseNote(turn?.phase, body.text);
    };
    let cwd;
    let prompt = body.text;
    let resume = null;
    let cutTold = null;
    let saved = null;
    let place = { partId: null, workCellId: null, title: String(body.text ?? '').trim().slice(0, TITLE_MAX) };
    let flow = null;
    if (body.sessionId) {
      const chat = find(project, 'chat', body.sessionId);
      const page = readPageChats()[body.sessionId];
      saved = page?.projectId === project.id ? page : null;
      // A page conversation older than the map's window is still resumable: the page remembers its folder. One removed
      // from session-map (mm43) is not.
      if ((!chat && !saved) || readRemoved(smDir).has(body.sessionId)) return reply(404, { error: 'unknown-session' });
      if (resuming.has(body.sessionId)) return reply(409, { error: 'busy' });
      const driven = drivenNow(body.sessionId);
      // A Continue from the cut-off panel is for a turn nothing finished: once the hub drives the conversation, or a page
      // conversation's turn is no longer running, another tab's older state must not start a second paid turn.
      if (body.cut === true && (driven || (page && page.running !== true))) return reply(409, { error: 'busy', ...(driven ? { chatKey: driven.key } : {}) });
      if (driven && idle) return reply(200, { chatKey: driven.key, mode: driven.mode, downgraded: false });
      if (driven) {
        if (driven.running || driven.weighing) return reply(409, { error: 'busy', chatKey: driven.key });
        if (body.mode !== undefined) changeMode(driven, body.mode);
        if (asked) changeRun(driven, asked);
        if (driven.restart) return reply(409, { error: 'restarting' });
        deliver(driven, { text: body.text, images, auto: internal.auto, from: fromOf(internal), quiet: !mine, haiku });
        return reply(200, { chatKey: driven.key, mode: driven.mode, downgraded: driven.choice === 'settings' && fromSettings.downgraded });
      }
      // A conversation open in VS Code or a terminal is someone else's: writing into it would interleave two drivers.
      if (chat && !chat.chattable) return reply(409, { error: 'live-chat' });
      // The state can be a whole collect old: its own process is looked for again, by the session files of this boot.
      if (listLiveSessions(dir, { bootMs: bootTime() }).some((s) => s.alive && s.sessionId === body.sessionId)) return reply(409, { error: 'live-chat' });
      cwd = state[INTERNALS]?.chats.get(body.sessionId)?.cwd ?? saved?.cwd;
      if (!cwd) return reply(409, { error: 'no-folder' });
      resume = body.sessionId;
      // Its process is gone: a team it ran in the background died with it. Claude reads which and how to resume it, after
      // the message; the page shows the message alone.
      cutTold = idle ? null : internal.teams ?? cutTeamsOf(resume);
      prompt = weighFirst(asked ?? parseRun(saved?.run) ?? { kind: 'settings' });
      if (cutTold) prompt = `${prompt}\n\n${teamsNote(cutTold)}`;
      if (saved?.node?.kind === 'flow') flow = { seen: null, reply: '' };
      // The point it was opened on comes back with it: a resumed orchestrator is still the project's orchestrator.
      place = { ...place, title: chat?.title ?? saved?.title ?? place.title, ...(saved?.node ? { node: saved.node } : {}) };
    } else {
      const mother = body.parentId ? find(project, 'chat', body.parentId) : null;
      if (body.parentId && !mother) return reply(404, { error: 'unknown-session' });
      let { node } = body;
      if (node === undefined && partId !== undefined) node = { kind: 'part', partId };
      if (node === undefined && mother && find(project, 'part', mother.partId)) node = { kind: 'part', partId: mother.partId };
      if (node?.kind === 'flow') flow = { seen: readDraft(smDir, project.id) ?? exportMermaid(project.arch ?? { layers: [], parts: [] }), reply: '' };
      // The good practices of the point are read once, here, when the conversation starts; nothing on disk means nothing added.
      const practices = FOCUS_KINDS.includes(node?.kind) ? focusInputs(smDir, project.id) : null;
      const context = node === undefined ? { sections: [], part: null } : contextOf(project, node, { draft: flow?.seen, practices, text: body.text });
      if (context.error) return reply(context.status, { error: context.error });
      const workCell = workCellId !== undefined ? find(project, 'workCell', workCellId) : null;
      if (workCellId !== undefined && !workCell) return reply(404, { error: 'unknown-front' });
      const board = (project.skills ?? []).some((s) => s.command === '/session-map:board' && s.enabled);

      // The economic gate (or14/id16): measure the request once, outside the LLM, and hand the conductor the
      // cheapest worker that can do it. A failed measure never blocks the chat.
      let sections = context.sections;
      if (sections.length && CONDUCTORS.has((asked ?? DEFAULT_RUN).kind)) {
        try {
          const directive = directiveOf(measureWork({ text: body.text, smDir, stats: loadStats(smDir), others: typeof conductorFacts === 'function' ? conductorFacts() : null }));
          if (directive) sections = [directive, ...sections];
        } catch { /* a failed measure never blocks the chat */ }
      }
      prompt = firstPrompt({ sections, mother, workCell, text: weighFirst(asked ?? DEFAULT_RUN), board });

      // An idea, a new map or a project chat is about the whole project: it starts at the root, whatever branch is picked.
      const atRoot = ['idea', 'create-arch', 'flow', 'project'].includes(node?.kind);
      cwd = atRoot ? project.root : workCell?.path ?? project.root;
      place = { ...place, partId: context.part?.id ?? null, workCellId: workCell?.id ?? null, ...(node ? { node: internal.orchestrator ? { kind: ORCH_KIND } : nodeTag(node) } : {}) };
    }
    const orchestrator = place.node?.kind === ORCH_KIND;
    const choice = body.mode ?? saved?.mode ?? 'settings';
    // A conversation that ran before without session-map's flags (elsewhere, or before they existed) keeps running that way.
    const run = asked ?? parseRun(saved?.run) ?? (resume ? { kind: 'settings' } : DEFAULT_RUN);
    const mode = modeFor(run, choice, fromSettings);
    const prompted = resume ? saved?.prompted ?? 'plain' : instructionsOf(run);
    const listed = resume ? (project.conversations ?? []).find((c) => c.sessionId === resume) ?? find(project, 'chat', resume) : null;
    const baseCostUSD = Number(listed?.costUSD) || 0;

    if ([...chats.values()].filter((c) => !c.ended).length >= chatsMax) return reply(429, { error: 'too-many-chats' });
    const claude = bin !== undefined ? bin : findClaude();
    if (!claude) return reply(503, { error: 'claude-not-found' });

    const key = randomBytes(16).toString('hex');
    const chat = {
      key, sessionId: resume, parentId: internal.parentId ?? (body.sessionId ? null : body.parentId ?? null), secret: randomBytes(32).toString('hex'),
      projectId: project.id, projectName: project.name, root: project.root, cwd, ...place, choice, mode, startedAt: now(), reported: null,
      events: [], lastId: 0, turns: [], sinks: new Set(), pending: new Map(), always: new Set(Array.isArray(saved?.always) ? saved.always : []),
      running: false, announced: false, ended: false, closing: false, idleTimer: null,
      configPath: join(smDir, 'chat', `${key}.json`), flow,
      run, processRun: run, prompted, model: null, level: null, turnText: '', baseCostUSD, processCostUSD: 0, costUSD: baseCostUSD, restart: false,
      reinforcing: false, autoAnswered: false,
      bin: claude, orchestrator, weighed: turn, planned: planned(), weighing: false, swapExit: null, swapTimer: null, moveMark: false,
    };
    if (turn) rememberPlan(chat, turn);
    chat.done = new Promise((resolve) => { chat.exited = resolve; });
    if (resume) resuming.add(resume);
    try {
      // By file, not by argument: a command line is readable by other users of the machine.
      const config = { mcpServers: chatMcpServers({ permissionUrl: await relayUrl(), secret: chat.secret, smDir, arsenalUrl, sessionId: key, root: cwd, orchestrator }) };
      mkdirSync(join(smDir, 'chat'), { recursive: true });
      writeFileSync(chat.configPath, JSON.stringify(config), { mode: 0o600 });
      chats.set(key, chat);
      if (resume) {
        bySession.set(resume, chat);
        everDriven.add(resume);
      }
    } finally {
      if (resume) resuming.delete(resume);
    }
    chat.driver = launch(chat, resume);
    // Waiting: closed as any quiet chat is, once idleMs passes with no message.
    if (idle) armIdle(chat, idleMs);
    else sendTo(chat, body.text, prompt, internal.auto, images, fromOf(internal));
    // Told once: the next resume names only the teams launched after this.
    if (cutTold) savePageChat(resume, { teamsToldAt: now() });
    return reply(200, { chatKey: key, mode, downgraded: choice === 'settings' && fromSettings.downgraded });
  }

  function changeMode(chat, choice) {
    chat.choice = choice;
    chat.mode = modeFor(chat.run, choice, settingsMode(chat.root, dir));
    chat.driver.setMode(chat.mode);
    if (chat.sessionId) savePageChat(chat.sessionId, { mode: choice });
  }

  // Model and effort are flags of the process: a change that touches them ends it (now, or after the running turn) and
  // the next message resumes the conversation with the new ones. "May reinforce on its own" alone needs no restart.
  // weighed: the entry brain's level for the new run (the same one by default); only a weighed run keeps one.
  function changeRun(chat, run, weighed = chat.weighed) {
    const level = isWeighed(run) ? weighed : null;
    const restart = flagsOf(withWeighed(run, level)) !== flagsOf(runOf(chat));
    chat.run = run;
    chat.weighed = level;
    // The same flags: the live process already runs this way.
    if (!restart) chat.processRun = run;
    if (chat.sessionId) savePageChat(chat.sessionId, { run });
    emitRun(chat);
    if (!restart || chat.ended) return;
    chat.restart = true;
    if (!chat.running) {
      chat.closing = true;
      chat.driver.end();
    }
  }

  function setRun(key, body) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (chat.ended) return reply(409, { error: 'ended' });
    const run = parseRun(body?.run);
    if (!run) return reply(400, { error: 'bad-run' });
    changeRun(chat, run);
    return reply(200, { run });
  }

  const reinforceState = () => ({ limitUSD: reinforcedLimit(smDir), spentUSD: round6(reinforcedSpend(smDir)) });

  // The page conversations of a part (of one of its items with code), of a kind of point (idea, create-arch, project) or of
  // a branch, the one used last first, with the key of those still running. An archived one is left out of every one of
  // these lists, as it leaves the map and the conversation list; "Show archived" there brings it back.
  function listChats(query, state) {
    const project = state.projects.find((p) => p.id === query?.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const { partId, workCellId, code, kind } = query;
    const onPoint = (c) => (kind ? c.node?.kind === kind : partId ? c.partId === partId && (!code || c.node?.code === code) : Boolean(workCellId) && c.workCellId === workCellId);
    const belongs = (c) => c.projectId === project.id && onPoint(c);
    const rowOf = (sessionId) => (project.conversations ?? []).find((r) => r.sessionId === sessionId);
    const removed = readRemoved(smDir);
    const chats = Object.entries(readPageChats()).filter(([sessionId, c]) => belongs(c) && !rowOf(sessionId)?.archived && !removed.has(sessionId)).map(([sessionId, c]) => {
      const driven = drivenNow(sessionId);
      const cost = driven?.costUSD ?? rowOf(sessionId)?.costUSD;
      return {
        sessionId, title: c.title ?? '', startedAt: c.startedAt ?? null, updatedAt: c.updatedAt ?? c.startedAt ?? null,
        mode: c.mode ?? 'settings', run: parseRun(c.run) ?? { kind: 'settings' }, chatKey: driven?.key ?? null, running: Boolean(driven?.running),
        interrupted: cutOff(sessionId, c, state), costUSD: Number.isFinite(cost) ? cost : null,
      };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.startedAt).localeCompare(String(a.startedAt)));
    return reply(200, { chats, settings: settingsMode(project.root, dir), mine: settingsRun(project.root, dir), reinforce: reinforceState() });
  }

  // claude keeps each conversation as projects/<folder>/<sessionId>.jsonl; the id is a checked UUID.
  function transcriptOf(sessionId) {
    let folders = [];
    try { folders = readdirSync(join(dir, 'projects')); } catch { return null; }
    for (const folder of folders) {
      const file = join(dir, 'projects', folder, `${sessionId}.jsonl`);
      if (existsSync(file)) return file;
    }
    return null;
  }

  // Where a conversation the page may show is written: a page conversation, or one of the list (VS Code, a terminal), whose
  // transcript Claude Code may already have deleted (the archive keeps a copy). null: not one the page knows.
  function sourceOf(sessionId, state) {
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return null;
    // One removed from session-map (mm43) shows nowhere: not its history, its images or its helpers.
    if (readRemoved(smDir).has(sessionId)) return null;
    const page = readPageChats()[sessionId];
    if (page) return { page, file: transcriptOf(sessionId), cwd: page.cwd ?? page.root ?? '' };
    const project = state?.projects.find((p) => p.conversations?.some((c) => c.sessionId === sessionId));
    if (!project) return null;
    const row = project.conversations.find((c) => c.sessionId === sessionId);
    const cwd = state[INTERNALS]?.chats.get(sessionId)?.cwd ?? project.root;
    return { project, row, file: transcriptOf(sessionId) ?? archivedPath(smDir, sessionId), cwd };
  }

  // The conversation as the chat screen shows it (mm22), a page of it (pc15). since: the version the page already has.
  // The version is compared before anything is read: the live mirror asks every 3 s, mostly to hear "nothing new".
  // before: the page that ends there (older items); from: what is new after the items the page holds (the mirror);
  // neither: the newest page. start and total place the page among all the items.
  function itemsOf(src, since, keep = () => true, { before, from } = {}) {
    const version = src.file ? versionOf(src.file) : '0';
    if (since && since === version) return { same: true, version };
    const read = src.file ? readConversation(src.file, { cwd: src.cwd }) : { items: [], version };
    const all = read.items.filter(keep);
    const total = all.length;
    const end = isIndex(before) ? Math.min(before, total) : total;
    const start = end === total && isIndex(from) && from > 0 && from <= total ? resendStart(all, from) : pageStart(all, end);
    // The read is shared with the next ask: new objects, never edits to its items.
    const items = all.slice(start, end).map((i) => (i.type === 'user' ? { ...i, text: personsWords(i.text) } : i));
    return { items, start, total, version: read.version };
  }

  // What a page that reopens a page conversation shows: the transcript, minus the turns a running process still
  // holds as events (those arrive by subscribing, after fromEventId), with the first prompt as the person wrote it.
  // The page reads items only: the transcript is read once, never a second time for plain messages (pc15).
  function history(sessionId, state, { since, before, from } = {}) {
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return reply(400, { error: 'bad-session' });
    if (readRemoved(smDir).has(sessionId)) return reply(404, { error: 'unknown-session' });
    const page = readPageChats()[sessionId];
    if (!page) return listedHistory(sessionId, state, since, { before, from });
    const driven = drivenNow(sessionId);
    const { fromEventId, keep } = driven ? replayFrom(driven) : { fromEventId: 0, keep: () => () => true };
    const src = sourceOf(sessionId, state);
    const rich = itemsOf(src, since, keep(), { before, from });
    if (rich.same) return reply(200, rich);
    const folder = page.root ?? page.cwd;
    const row = state?.projects.find((p) => p.id === page.projectId)?.conversations?.find((c) => c.sessionId === sessionId);
    return reply(200, {
      sessionId, title: page.title ?? '', mode: page.mode ?? 'settings', settings: settingsMode(folder, dir), ...rich, chatKey: driven?.key ?? null,
      fromEventId, running: Boolean(driven?.running),
      run: driven?.run ?? parseRun(page.run) ?? { kind: 'settings' }, mine: settingsRun(folder, dir), reinforce: reinforceState(),
      costUSD: driven?.costUSD ?? (Number(row?.costUSD) || 0), interrupted: cutOff(sessionId, page, state), live: false,
    });
  }

  // A conversation of the list the page did not start (VS Code, a terminal): read here, written where it lives, unless
  // the person resumes a closed one, which makes it a page conversation. live: still running elsewhere, so the page
  // mirrors it by asking again with the version it has.
  function listedHistory(sessionId, state, since, cursor) {
    const src = sourceOf(sessionId, state);
    if (!src) return reply(404, { error: 'unknown-session' });
    const rich = itemsOf(src, since, undefined, cursor);
    if (rich.same) return reply(200, rich);
    return reply(200, {
      sessionId, title: src.row.title ?? '', mode: 'settings', settings: settingsMode(src.project.root, dir), ...rich, chatKey: null, readOnly: true,
      run: { kind: 'settings' }, mine: settingsRun(src.project.root, dir), reinforce: reinforceState(), costUSD: Number(src.row.costUSD) || 0,
      live: Boolean(src.row.live),
    });
  }

  // An image pasted into a conversation or returned by one of its steps; null when there is none.
  function image(sessionId, n, state) {
    const src = sourceOf(sessionId, state);
    return src?.file ? readImage(src.file, n) : null;
  }

  // A helper agent's own conversation, opened from the step that started it.
  function helper(sessionId, agentId, state) {
    const src = sourceOf(sessionId, state);
    const file = src?.file ? helperPath(src.file, agentId) : null;
    if (!file) return reply(404, { error: 'unknown-helper' });
    const { items, version } = readConversation(file, { cwd: src.cwd });
    return reply(200, { items, version });
  }

  const chatOf = (key) => (typeof key === 'string' && KEY_RE.test(key) ? chats.get(key) ?? null : null);

  // -> the reply, or a Promise of it when the entry brain waited for its one Haiku call. quiet: not the person's own words
  // (the orchestrator speaking into a chat), so nothing is weighed.
  function send(key, body, quiet = false) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (chat.ended) return reply(409, { error: 'ended' });
    if (chat.running || chat.weighing) return reply(409, { error: 'busy' });
    if (!isText(body?.text)) return reply(400, { error: 'bad-text' });
    if (holding) return reply(409, { error: 'server-restarting' });
    const images = imagesOf(body.images);
    if (!images) return reply(400, { error: 'bad-images' });
    const waiting = deliver(chat, { text: body.text, images, quiet });
    return waiting ? waiting.then((busy) => busy ?? reply(200)) : reply(200);
  }

  function permission(key, body) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    const pending = typeof body?.requestId === 'string' ? chat.pending.get(body.requestId) : null;
    if (!pending) return reply(404, { error: 'unknown-request' });
    if (typeof body.allow !== 'boolean') return reply(400, { error: 'bad-permission' });
    if (body.allow && body.always === true) {
      chat.always.add(pending.toolName);
      // By sessionId, so a conversation resumed tomorrow still does not ask for it.
      if (chat.sessionId) savePageChat(chat.sessionId, { always: [...chat.always] });
    }
    if (body.allow) pending.finish('allowed', { behavior: 'allow', updatedInput: pending.input });
    else pending.finish('denied', { behavior: 'deny', message: DENIED });
    return reply(200);
  }

  function mode(key, body) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (chat.ended) return reply(409, { error: 'ended' });
    if (pickMode(body?.mode, { mode: 'default' }) === null) return reply(400, { error: 'bad-mode' });
    changeMode(chat, body.mode ?? 'settings');
    return reply(200, { mode: chat.mode });
  }

  function stop(key) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (!chat.running) return reply(200, { stopped: false });
    chat.stopRequested = true;
    chat.driver.interrupt();
    return reply(200, { stopped: true });
  }

  // sink: {write(evt), end()}. Replays what came after lastEventId, so a page that (re)connects late misses nothing.
  function subscribe(key, sink, lastEventId = 0) {
    const chat = chatOf(key);
    if (!chat) return null;
    for (const evt of chat.events) if (evt.id > lastEventId) sink.write(evt);
    if (chat.ended) {
      sink.end();
      return () => {};
    }
    chat.sinks.add(sink);
    return () => chat.sinks.delete(sink);
  }

  const endChat = (chat) => {
    chat.closing = true;
    chat.driver.kill();
    return chat.done;
  };

  async function close() {
    await orchestra.stop();
    const live = [...chats.values()].filter((c) => !c.ended);
    await Promise.all(live.map(endChat));
    if (relay) {
      const { server } = await relay;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      relay = null;
    }
  }

  // A Delete from session-map (mm43) of a conversation the hub keeps idle after its turn (up to idleMs): its process is
  // closed first, the way close() ends every chat. false: a turn runs, or a start is resuming it, so it is left alone.
  async function closeIdle(sessionId) {
    if (resuming.has(sessionId)) return false;
    const chat = drivenNow(sessionId);
    if (!chat) return true;
    if (chat.running) return false;
    await endChat(chat);
    return true;
  }

  // The page conversations a restart cut off in the last day, as alerts for the watcher's first look.
  function interrupted(state) {
    const recent = Date.now() - CUT_OFF_ALERT_MS;
    const removed = readRemoved(smDir);
    return Object.entries(readPageChats())
      .filter(([sessionId, c]) => UUID_RE.test(sessionId) && !removed.has(sessionId) && cutOff(sessionId, c, state) && Date.parse(c.updatedAt ?? '') >= recent)
      .map(([sessionId, c]) => ({
        kind: 'error', reason: 'restart', projectId: c.projectId,
        projectName: state?.projects.find((p) => p.id === c.projectId)?.name ?? basename(String(c.root ?? '')),
        sessionId, title: c.title ?? '', origin: 'map',
      }));
  }

  // The conversations the hub runs right now or is resuming: collect leaves them out of the cut-off panel (mm43).
  const drivingIds = () => new Set([...[...bySession].filter(([, c]) => !c.ended).map(([id]) => id), ...resuming]);

  // The project's orchestrator (orchestra.mjs) works through the hub's own chats; this is all it is lent.
  const orchestra = createOrchestra({
    smDir, readState, changed, ...orchestraOptions,
    hub: {
      live: () => [...chats.values()].filter((c) => !c.ended), byKey: chatOf, driven: drivenNow, start, holding: () => holding,
      send: (chat, text, auto) => sendTo(chat, text, text, auto), say: (key, text, images) => send(key, { text, images }, true),
      pageChats: readPageChats, closeIdle, emit, alert, transcript: transcriptOf, driving: drivingIds, chatsMax,
    },
  });

  return {
    start, send, permission, mode, run: setRun, stop, subscribe, list: listChats, history, image, helper, close, closeIdle, interrupted, drivenIds: () => everDriven,
    drivingIds,
    // The project root of the chat with that key (or07): its outside AI calls count in that project's budget.
    rootOf: (key) => chatOf(key)?.root ?? null,
    // The orchestrator (or01/or18): open or start a project's, what the page shows of it, a tool call as the chat with
    // that key would make it (the relay's path), one pass of the scheduler, and the scheduler itself (the real server).
    orchestra: {
      open: orchestra.open, info: orchestra.info, call: (key, name, args) => orchestra.call(chatOf(key), { name, arguments: args }),
      tick: orchestra.tick, start: orchestra.start,
      // The person's priority for one item of the line (or08).
      prioritize: orchestra.prioritize,
    },
    // The agreed restart (sv13, restart.mjs): hold new turns, how many chats are mid-turn, and what to resume after.
    hold: (on) => { holding = Boolean(on); },
    turning: () => [...chats.values()].filter((c) => !c.ended && c.running).length,
    // sv16: the chats whose team works in the background, and the teams a resumed conversation's old process left cut.
    teams: ({ now: at = Date.now(), quietMs }) => [...chats.values()].filter((c) => !c.ended && c.sessionId && teamAtWork(c, at, quietMs)).map((c) => c.sessionId),
    cutTeams: cutTeamsOf,
    restartList: () => [...chats.values()].filter((c) => !c.ended && c.sessionId).map((c) => ({
      sessionId: c.sessionId, key: c.key, projectId: c.projectId, run: c.run, running: c.running, held: Boolean(c.held),
    })),
  };
}
