import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../actions.mjs';
import { exportMermaid, readDraft, writeDraft } from '../arch/flow.mjs';
import { cleanEnv, findClaude } from '../ai/runner.mjs';
import { sameToken } from '../auth.mjs';
import { recordLineage } from '../brain/lineage.mjs';
import { log } from '../log.mjs';
import { waitingFor } from '../parse/waiting.mjs';
import { archivedPath } from '../archive.mjs';
import { claudeDir, readFullTranscript } from '../sources/claude.mjs';
import { helperPath, maskSecrets, readConversation, readImage, toolDetails, versionOf } from '../sources/claude-conversation.mjs';
import { summaryOf } from '../web/alerts.js';
import { contextOf } from './context.mjs';
import { buildArgs, preview, startDriver } from './driver.mjs';
import { firstPrompt, personsWords } from './prompt.mjs';
import { pickMode, settingsMode } from './mode.mjs';
import {
  DEFAULT_RUN, addReinforcedSpend, expectedRun, mayReinforce, parseRun, readRunBlock, reinforcedLimit, reinforcedSpend, runArgs,
  settingsRun, withRunNote,
} from './run.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { lastMermaidBlock, parseFlow } from '../web/flow.js';

const PERMISSION_MCP = fileURLToPath(new URL('./permission-mcp.mjs', import.meta.url));
const KEY_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 20_000;
// Pasted images (mm22): what Claude Code itself accepts, a few per message.
const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGES_MAX = 4;
const IMAGE_DATA_MAX = 5_000_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TITLE_MAX = 200;
const EVENTS_MAX = 2000;
const CHATS_MAX = 6;
// A restart that cut a chat off is told for a day; older ones still show it when opened.
const CUT_OFF_ALERT_MS = 24 * 3600_000;
const RELAY_BODY_MAX = 4 * 1024 * 1024;
// The docs give the permission tool 30 s; answering first keeps the denial ours, with our message.
const PERMISSION_TIMEOUT_MS = 25_000;
const IDLE_MS = 30 * 60_000;
// An ended chat keeps its events a while, so a page that reconnects still sees how it ended.
const LINGER_MS = 5 * 60_000;
const DENIED = 'Denied by the person in session-map.';
const TIMED_OUT = 'No answer in session-map within 25 s; denied.';
// Sent for the person when they let Automatic reinforce on its own and the month's allowance still covers the estimate.
const AUTO_REINFORCE = 'OK, you may reinforce. (Answered by session-map: the person allows reinforcing on its own while the monthly limit holds.)';
// The instructions a conversation already carries: the system prompt of its first turn, or the last note sent.
const instructionsOf = (run) => (run.kind === 'fixed' || run.kind === 'settings' ? 'plain' : run.kind);
const round6 = (usd) => Math.round(usd * 1e6) / 1e6;

const reply = (status, body = {}) => ({ status, body: status < 300 ? { ok: true, ...body } : { ok: false, ...body } });
// → the images of a message, [] when it has none, null when they are not images we pass on.
const imagesOf = (v) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > IMAGES_MAX) return null;
  const ok = v.every((i) => i && IMAGE_MEDIA.has(i.media) && typeof i.data === 'string' && i.data.length <= IMAGE_DATA_MAX && BASE64_RE.test(i.data));
  return ok ? v.map((i) => ({ media: i.media, data: i.data })) : null;
};
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= TEXT_MAX;
const now = () => new Date().toISOString();
// What the page remembers of the point a chat was opened on: only the field its kind uses, which contextOf matched against the map.
const NODE_FIELD = { layer: 'layerId', group: 'group', item: 'code' };
const FENCE = '```';
const handEdited = (draft) => `The person changed the draft by hand since your last reply. Start from this version:\n${FENCE}mermaid\n${draft}\n${FENCE}`;
const nodeTag = (node) => {
  const field = NODE_FIELD[node.kind];
  return field && typeof node[field] === 'string' ? { kind: node.kind, [field]: node[field] } : { kind: node.kind };
};

// Chats the page drives through the user's own claude CLI. bin: undefined looks it up at start, null means not installed.
// onAlert(alert): the moment a chat finishes, asks or fails (watcher-and-alerts wa01); the watcher leaves these out of its diff.
export function createChatHub({
  smDir, dir = claudeDir(), bin, env = process.env, permissionTimeoutMs = PERMISSION_TIMEOUT_MS, idleMs = IDLE_MS, spawner, onAlert = () => {},
} = {}) {
  const chats = new Map();
  const bySession = new Map();
  const everDriven = new Set();
  let relay = null;

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
    const waits = waitingFor({ lastAssistantText: reply, pendingQuestion: false }, null, null);
    if (waits.strong || waits.weak) return alert(chat, 'waiting', waits.strong ? 'question' : 'asks');
    return alert(chat, 'finished', 'answer', { summary: summaryOf(reply) });
  }

  // Cut off: a turn was running when the process went away with the server, and nothing runs the conversation now.
  const cutOff = (sessionId, page, state) => page?.running === true && !drivenNow(sessionId)
    && !(state?.projects ?? []).some((p) => (p.conversations ?? []).some((c) => c.sessionId === sessionId && c.live));

  const emit = (chat, type, data) => {
    const evt = { id: ++chat.lastId, type, data };
    chat.events.push(evt);
    if (chat.events.length > EVENTS_MAX) chat.events.shift();
    for (const sink of chat.sinks) sink.write(evt);
  };

  function ask(chat, args) {
    const toolName = String(args?.tool_name ?? '');
    const input = args?.input && typeof args.input === 'object' ? args.input : {};
    if (chat.always.has(toolName)) return { behavior: 'allow', updatedInput: input };
    const requestId = randomBytes(8).toString('hex');
    // An edit asks with its before and after, so allowing it reads as accepting the change (mm22).
    const { diff } = toolDetails(toolName, input, chat.cwd);
    emit(chat, 'permission', { requestId, state: 'asked', toolName, toolUseId: args?.tool_use_id ?? null, input: maskSecrets(preview(input)), ...(diff ? { diff } : {}) });
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

  // The permission MCP is claude's child, not the page: it proves itself with the secret of its own chat.
  async function onRelay(req, res) {
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/permission') return answer(404, {});
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
    if (evt.type === 'session') {
      // The CLI repeats init every turn: only the first one is news, or a mode the header changed since.
      if (chat.announced) {
        if (evt.data.mode && evt.data.mode !== chat.reported) {
          chat.reported = evt.data.mode;
          emit(chat, 'mode', { mode: chat.reported });
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
      savePageChat(chat.sessionId, {
        projectId: chat.projectId, root: chat.root, cwd: chat.cwd, mode: chat.choice, run: chat.run, prompted: chat.prompted, running: chat.running, updatedAt: now(),
        ...(known ? {} : { partId: chat.partId, workCellId: chat.workCellId, ...(chat.node ? { node: chat.node } : {}), title: chat.title, startedAt: chat.startedAt }),
      });
      emit(chat, 'session', { sessionId: chat.sessionId, state: 'started', mode: chat.reported });
      return emitRun(chat);
    }
    if (evt.type === 'text' && !evt.data.partial) {
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
      chat.idleTimer = setTimeout(() => { chat.closing = true; chat.driver.end(); }, idleMs);
      chat.idleTimer.unref?.();
      if (chat.sessionId) savePageChat(chat.sessionId, { running: false, updatedAt: now() });
      const { processCostUSD, ...data } = evt.data;
      emit(chat, 'turn-end', { ...data, costUSD: chat.costUSD });
      emitRun(chat);
      alertTurnEnd(chat, data, chat.lastText, auto);
      chat.stopRequested = false;
      chat.lastText = '';
      if (chat.restart) {
        chat.closing = true;
        chat.driver.end();
      } else if (auto) sendTo(chat, AUTO_REINFORCE, AUTO_REINFORCE, 'reinforce');
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
    const expected = expectedRun(chat.run, settingsRun(chat.root, dir));
    emit(chat, 'run', {
      run: chat.run, model: chat.model ?? expected.model, effort: expected.effort, ultracode: expected.ultracode,
      level: chat.level?.level ?? null, why: chat.level?.why ?? null, estimateUSD: chat.level?.estimateUSD ?? null, costUSD: chat.costUSD,
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
    if (chat.run.kind !== 'auto' || block?.level !== 'ask-reinforce' || chat.restart || chat.autoAnswered) return false;
    return mayReinforce({ selfReinforce: chat.run.selfReinforce, limitUSD: reinforcedLimit(smDir), spentUSD: reinforcedSpend(smDir), estimateUSD: block.estimateUSD });
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
    chat.exited();
  }

  // A chat is one of the map's, or one only the list holds (older than the map's window).
  function find(project, kind, id) {
    if (kind === 'chat') return [...project.chats, ...(project.conversations ?? [])].find((c) => c.sessionId === id) ?? null;
    const items = { part: project.arch?.parts, workCell: project.workCells }[kind] ?? [];
    return items.find((x) => x.id === id) ?? null;
  }

  // shown: what the person wrote, for a page that opens the conversation later; prompt may carry the context block.
  function sendTo(chat, shown, prompt = shown, auto = undefined, images = []) {
    clearTimeout(chat.idleTimer);
    if (instructionsOf(chat.run) !== chat.prompted) {
      prompt = withRunNote(chat.run, prompt);
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
    chat.autoAnswered = Boolean(auto);
    chat.running = true;
    // On disk at once: a server that dies mid-turn leaves the mark the next one reads as "cut off" (page-chat pc06).
    // The first message is saved with the rest when claude announces the session.
    if (chat.sessionId && chat.announced) savePageChat(chat.sessionId, { running: true });
    emit(chat, 'user', auto ? { text: shown, auto } : { text: shown, ...(images.length ? { images: images.length } : {}) });
    chat.driver.send(prompt, images);
  }

  // body: {projectId, node? ({kind, partId?, layerId?, group?, code?, line?}: the point of the map), partId? (same as a part node),
  //        frontId|workCellId?, sessionId? (continue it), parentId? (the mother of a new chat), text}
  async function start(body, state) {
    if (!body || typeof body !== 'object') return reply(400, { error: 'bad-request' });
    if (!isText(body.text)) return reply(400, { error: 'bad-text' });
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
    const fromSettings = settingsMode(project.root, dir);

    let cwd;
    let prompt = body.text;
    let resume = null;
    let saved = null;
    let place = { partId: null, workCellId: null, title: body.text.trim().slice(0, TITLE_MAX) };
    let flow = null;
    if (body.sessionId) {
      const chat = find(project, 'chat', body.sessionId);
      const page = readPageChats()[body.sessionId];
      saved = page?.projectId === project.id ? page : null;
      // A page conversation older than the map's window is still resumable: the page remembers its folder.
      if (!chat && !saved) return reply(404, { error: 'unknown-session' });
      const driven = drivenNow(body.sessionId);
      if (driven) {
        if (driven.running) return reply(409, { error: 'busy', chatKey: driven.key });
        if (body.mode !== undefined) changeMode(driven, body.mode);
        if (asked) changeRun(driven, asked);
        if (driven.restart) return reply(409, { error: 'restarting' });
        sendTo(driven, body.text, body.text, undefined, images);
        return reply(200, { chatKey: driven.key, mode: driven.mode, downgraded: driven.choice === 'settings' && fromSettings.downgraded });
      }
      // A conversation open in VS Code or a terminal is someone else's: writing into it would interleave two drivers.
      if (chat && !chat.chattable) return reply(409, { error: 'live-chat' });
      cwd = state[INTERNALS]?.chats.get(body.sessionId)?.cwd ?? saved?.cwd;
      if (!cwd) return reply(409, { error: 'no-folder' });
      resume = body.sessionId;
      if (saved?.node?.kind === 'flow') flow = { seen: null, reply: '' };
      place = { ...place, title: chat?.title ?? saved?.title ?? place.title };
    } else {
      const mother = body.parentId ? find(project, 'chat', body.parentId) : null;
      if (body.parentId && !mother) return reply(404, { error: 'unknown-session' });
      let { node } = body;
      if (node === undefined && partId !== undefined) node = { kind: 'part', partId };
      if (node === undefined && mother && find(project, 'part', mother.partId)) node = { kind: 'part', partId: mother.partId };
      if (node?.kind === 'flow') flow = { seen: readDraft(smDir, project.id) ?? exportMermaid(project.arch ?? { layers: [], parts: [] }), reply: '' };
      const context = node === undefined ? { sections: [], part: null } : contextOf(project, node, { draft: flow?.seen });
      if (context.error) return reply(context.status, { error: context.error });
      const workCell = workCellId !== undefined ? find(project, 'workCell', workCellId) : null;
      if (workCellId !== undefined && !workCell) return reply(404, { error: 'unknown-front' });
      const board = (project.skills ?? []).some((s) => s.command === '/session-map:board' && s.enabled);
      prompt = firstPrompt({ sections: context.sections, mother, workCell, text: body.text, board });
      // An idea, a new map or a project chat is about the whole project: it starts at the root, whatever branch is picked.
      const atRoot = ['idea', 'create-arch', 'flow', 'project'].includes(node?.kind);
      cwd = atRoot ? project.root : workCell?.path ?? project.root;
      place = { ...place, partId: context.part?.id ?? null, workCellId: workCell?.id ?? null, ...(node ? { node: nodeTag(node) } : {}) };
    }
    const choice = body.mode ?? saved?.mode ?? 'settings';
    const mode = pickMode(choice, fromSettings);
    // A conversation that ran before without session-map's flags (elsewhere, or before they existed) keeps running that way.
    const run = asked ?? parseRun(saved?.run) ?? (resume ? { kind: 'settings' } : DEFAULT_RUN);
    const prompted = resume ? saved?.prompted ?? 'plain' : instructionsOf(run);
    const listed = resume ? (project.conversations ?? []).find((c) => c.sessionId === resume) ?? find(project, 'chat', resume) : null;
    const baseCostUSD = Number(listed?.costUSD) || 0;

    if ([...chats.values()].filter((c) => !c.ended).length >= CHATS_MAX) return reply(429, { error: 'too-many-chats' });
    const claude = bin !== undefined ? bin : findClaude();
    if (!claude) return reply(503, { error: 'claude-not-found' });

    const key = randomBytes(16).toString('hex');
    const chat = {
      key, sessionId: resume, parentId: body.sessionId ? null : body.parentId ?? null, secret: randomBytes(32).toString('hex'),
      projectId: project.id, projectName: project.name, root: project.root, cwd, ...place, choice, mode, startedAt: now(), reported: null,
      events: [], lastId: 0, sinks: new Set(), pending: new Map(), always: new Set(Array.isArray(saved?.always) ? saved.always : []),
      running: false, announced: false, ended: false, closing: false, idleTimer: null,
      configPath: join(smDir, 'chat', `${key}.json`), flow,
      run, prompted, model: null, level: null, turnText: '', baseCostUSD, processCostUSD: 0, costUSD: baseCostUSD, restart: false,
      reinforcing: false, autoAnswered: false,
    };
    chat.done = new Promise((resolve) => { chat.exited = resolve; });
    // By file, not by argument: a command line is readable by other users of the machine.
    const config = { mcpServers: { sessionmap: { command: process.execPath, args: [PERMISSION_MCP], env: { SM_PERMISSION_URL: await relayUrl(), SM_PERMISSION_SECRET: chat.secret } } } };
    mkdirSync(join(smDir, 'chat'), { recursive: true });
    writeFileSync(chat.configPath, JSON.stringify(config), { mode: 0o600 });
    chats.set(key, chat);
    if (resume) {
      bySession.set(resume, chat);
      everDriven.add(resume);
    }
    chat.driver = startDriver({
      bin: claude, args: buildArgs({ mcpConfigPath: chat.configPath, resume, mode, run: runArgs(run) }), cwd, env: cleanEnv(env),
      onEvent: (evt) => onDriverEvent(chat, evt), ...(spawner ? { spawner } : {}),
    });
    sendTo(chat, body.text, prompt, undefined, images);
    return reply(200, { chatKey: key, mode, downgraded: choice === 'settings' && fromSettings.downgraded });
  }

  function changeMode(chat, choice) {
    chat.choice = choice;
    chat.mode = pickMode(choice, settingsMode(chat.root, dir));
    chat.driver.setMode(chat.mode);
    if (chat.sessionId) savePageChat(chat.sessionId, { mode: choice });
  }

  // Model and effort are flags of the process: a change that touches them ends it (now, or after the running turn) and
  // the next message resumes the conversation with the new ones. "May reinforce on its own" alone needs no restart.
  function changeRun(chat, run) {
    const restart = JSON.stringify(runArgs(run)) !== JSON.stringify(runArgs(chat.run));
    chat.run = run;
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

  // The page conversations of a part (of one of its items with code), of a kind of point (idea, create-arch) or of a branch,
  // the one used last first, with the key of those still running.
  function listChats(query, state) {
    const project = state.projects.find((p) => p.id === query?.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const { partId, workCellId, code, kind } = query;
    const onPoint = (c) => (kind ? c.node?.kind === kind : partId ? c.partId === partId && (!code || c.node?.code === code) : Boolean(workCellId) && c.workCellId === workCellId);
    const belongs = (c) => c.projectId === project.id && onPoint(c);
    const rowOf = (sessionId) => (project.conversations ?? []).find((r) => r.sessionId === sessionId);
    const chats = Object.entries(readPageChats()).filter(([sessionId, c]) => belongs(c) && !rowOf(sessionId)?.archived).map(([sessionId, c]) => {
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
    const page = readPageChats()[sessionId];
    if (page) return { page, file: transcriptOf(sessionId), cwd: page.cwd ?? page.root ?? '' };
    const project = state?.projects.find((p) => p.conversations?.some((c) => c.sessionId === sessionId));
    if (!project) return null;
    const row = project.conversations.find((c) => c.sessionId === sessionId);
    const cwd = state[INTERNALS]?.chats.get(sessionId)?.cwd ?? project.root;
    return { project, row, file: transcriptOf(sessionId) ?? archivedPath(smDir, sessionId), cwd };
  }

  // The whole conversation as the chat screen shows it (mm22). since: the version the page already has.
  // The version is compared before anything is read: the live mirror asks every 3 s, mostly to hear "nothing new".
  function itemsOf(src, since, keep = () => true) {
    const version = src.file ? versionOf(src.file) : '0';
    if (since && since === version) return { same: true, version };
    const read = src.file ? readConversation(src.file, { cwd: src.cwd }) : { items: [], version };
    // The read is shared with the next ask: new objects, never edits to its items.
    const items = read.items.filter(keep).map((i) => (i.type === 'user' ? { ...i, text: personsWords(i.text) } : i));
    return { items, version: read.version };
  }

  // What a page that reopens a page conversation shows: the transcript, minus the turns a running process still
  // holds as events (those arrive by subscribing), with the first prompt as the person wrote it.
  function history(sessionId, state, { since } = {}) {
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return reply(400, { error: 'bad-session' });
    const page = readPageChats()[sessionId];
    if (!page) return listedHistory(sessionId, state, since);
    const driven = drivenNow(sessionId);
    const src = sourceOf(sessionId, state);
    const before = (m) => !driven || !m.ts || m.ts < driven.startedAt;
    const rich = itemsOf(src, since, before);
    if (rich.same) return reply(200, rich);
    const messages = (src.file ? readFullTranscript(src.file) : []).filter(before);
    for (const m of messages) if (m.role === 'user') m.text = personsWords(m.text);
    const folder = page.root ?? page.cwd;
    const row = state?.projects.find((p) => p.id === page.projectId)?.conversations?.find((c) => c.sessionId === sessionId);
    return reply(200, {
      sessionId, title: page.title ?? '', mode: page.mode ?? 'settings', settings: settingsMode(folder, dir), messages, ...rich, chatKey: driven?.key ?? null,
      run: driven?.run ?? parseRun(page.run) ?? { kind: 'settings' }, mine: settingsRun(folder, dir), reinforce: reinforceState(),
      costUSD: driven?.costUSD ?? (Number(row?.costUSD) || 0), interrupted: cutOff(sessionId, page, state), live: false,
    });
  }

  // A conversation of the list the page did not start (VS Code, a terminal): read here, written where it lives, unless
  // the person resumes a closed one, which makes it a page conversation. live: still running elsewhere, so the page
  // mirrors it by asking again with the version it has.
  function listedHistory(sessionId, state, since) {
    const src = sourceOf(sessionId, state);
    if (!src) return reply(404, { error: 'unknown-session' });
    const rich = itemsOf(src, since);
    if (rich.same) return reply(200, rich);
    const messages = src.file ? readFullTranscript(src.file) : [];
    return reply(200, {
      sessionId, title: src.row.title ?? '', mode: 'settings', settings: settingsMode(src.project.root, dir), messages, ...rich, chatKey: null, readOnly: true,
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

  function send(key, body) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (chat.ended) return reply(409, { error: 'ended' });
    if (chat.running) return reply(409, { error: 'busy' });
    if (!isText(body?.text)) return reply(400, { error: 'bad-text' });
    const images = imagesOf(body.images);
    if (!images) return reply(400, { error: 'bad-images' });
    sendTo(chat, body.text, body.text, undefined, images);
    return reply(200);
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

  async function close() {
    const live = [...chats.values()].filter((c) => !c.ended);
    for (const chat of live) {
      chat.closing = true;
      chat.driver.kill();
    }
    await Promise.all(live.map((c) => c.done));
    if (relay) {
      const { server } = await relay;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      relay = null;
    }
  }

  // The page conversations a restart cut off in the last day, as alerts for the watcher's first look.
  function interrupted(state) {
    const recent = Date.now() - CUT_OFF_ALERT_MS;
    return Object.entries(readPageChats())
      .filter(([sessionId, c]) => UUID_RE.test(sessionId) && cutOff(sessionId, c, state) && Date.parse(c.updatedAt ?? '') >= recent)
      .map(([sessionId, c]) => ({
        kind: 'error', reason: 'restart', projectId: c.projectId,
        projectName: state?.projects.find((p) => p.id === c.projectId)?.name ?? basename(String(c.root ?? '')),
        sessionId, title: c.title ?? '', origin: 'map',
      }));
  }

  return {
    start, send, permission, mode, run: setRun, stop, subscribe, list: listChats, history, image, helper, close, interrupted, drivenIds: () => everDriven,
  };
}
