import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../actions.mjs';
import { exportMermaid, readDraft, writeDraft } from '../arch/flow.mjs';
import { cleanEnv, findClaude } from '../ai/runner.mjs';
import { sameToken } from '../auth.mjs';
import { recordLineage } from '../brain/lineage.mjs';
import { log } from '../log.mjs';
import { claudeDir, readFullTranscript } from '../sources/claude.mjs';
import { contextOf } from './context.mjs';
import { buildArgs, preview, startDriver } from './driver.mjs';
import { firstPrompt, personsWords } from './prompt.mjs';
import { pickMode, settingsMode } from './mode.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { lastMermaidBlock, parseFlow } from '../web/flow.js';

const PERMISSION_MCP = fileURLToPath(new URL('./permission-mcp.mjs', import.meta.url));
const KEY_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 20_000;
const TITLE_MAX = 200;
const EVENTS_MAX = 2000;
const CHATS_MAX = 6;
const RELAY_BODY_MAX = 4 * 1024 * 1024;
// The docs give the permission tool 30 s; answering first keeps the denial ours, with our message.
const PERMISSION_TIMEOUT_MS = 25_000;
const IDLE_MS = 30 * 60_000;
// An ended chat keeps its events a while, so a page that reconnects still sees how it ended.
const LINGER_MS = 5 * 60_000;
const DENIED = 'Denied by the person in session-map.';
const TIMED_OUT = 'No answer in session-map within 25 s; denied.';

const reply = (status, body = {}) => ({ status, body: status < 300 ? { ok: true, ...body } : { ok: false, ...body } });
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
export function createChatHub({ smDir, dir = claudeDir(), bin, env = process.env, permissionTimeoutMs = PERMISSION_TIMEOUT_MS, idleMs = IDLE_MS, spawner } = {}) {
  const chats = new Map();
  const bySession = new Map();
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
    emit(chat, 'permission', { requestId, state: 'asked', toolName, toolUseId: args?.tool_use_id ?? null, input: preview(input) });
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
      chat.sessionId = evt.data.sessionId;
      bySession.set(chat.sessionId, chat);
      if (chat.parentId && chat.parentId !== chat.sessionId) {
        try { recordLineage(smDir, chat.sessionId, chat.parentId); } catch (err) { log('warn', 'lineage-failed', { error: err.message }); }
      }
      const known = readPageChats()[chat.sessionId];
      savePageChat(chat.sessionId, {
        projectId: chat.projectId, root: chat.root, cwd: chat.cwd, mode: chat.choice, updatedAt: now(),
        ...(known ? {} : { partId: chat.partId, workCellId: chat.workCellId, ...(chat.node ? { node: chat.node } : {}), title: chat.title, startedAt: chat.startedAt }),
      });
      return emit(chat, 'session', { sessionId: chat.sessionId, state: 'started', mode: chat.reported });
    }
    if (evt.type === 'text' && chat.flow && !evt.data.partial) chat.flow.reply += `${evt.data.text}
`;
    if (evt.type === 'turn-end') {
      chat.running = false;
      if (chat.flow) saveFlowDraft(chat);
      clearTimeout(chat.idleTimer);
      chat.idleTimer = setTimeout(() => { chat.closing = true; chat.driver.end(); }, idleMs);
      chat.idleTimer.unref?.();
      if (chat.sessionId) savePageChat(chat.sessionId, { updatedAt: now() });
      return emit(chat, 'turn-end', evt.data);
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
    }
    emit(chat, 'session', { sessionId: chat.sessionId, state: 'ended' });
    for (const sink of chat.sinks) sink.end();
    chat.sinks.clear();
    setTimeout(() => chats.delete(chat.key), LINGER_MS).unref?.();
    chat.exited();
  }

  function find(project, kind, id) {
    const items = { part: project.arch?.parts, workCell: project.workCells, chat: project.chats }[kind] ?? [];
    return items.find((x) => (kind === 'chat' ? x.sessionId : x.id) === id) ?? null;
  }

  // shown: what the person wrote, for a page that opens the conversation later; prompt may carry the context block.
  function sendTo(chat, shown, prompt = shown) {
    clearTimeout(chat.idleTimer);
    if (chat.flow) {
      const draft = readDraft(smDir, chat.projectId);
      if (draft !== null && draft !== chat.flow.seen) prompt = `${handEdited(draft)}

${prompt}`;
      chat.flow.seen = draft ?? chat.flow.seen;
      chat.flow.reply = '';
    }
    chat.running = true;
    emit(chat, 'user', { text: shown });
    chat.driver.send(prompt);
  }

  // body: {projectId, node? ({kind, partId?, layerId?, group?, code?, line?}: the point of the map), partId? (same as a part node),
  //        frontId|workCellId?, sessionId? (continue it), parentId? (the mother of a new chat), text}
  async function start(body, state) {
    if (!body || typeof body !== 'object') return reply(400, { error: 'bad-request' });
    if (!isText(body.text)) return reply(400, { error: 'bad-text' });
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const { partId } = body;
    const workCellId = body.frontId ?? body.workCellId;
    for (const id of [body.sessionId, body.parentId]) if (id !== undefined && !(typeof id === 'string' && UUID_RE.test(id))) return reply(400, { error: 'bad-session' });
    if (body.mode !== undefined && pickMode(body.mode, { mode: 'default' }) === null) return reply(400, { error: 'bad-mode' });
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
        sendTo(driven, body.text);
        return reply(200, { chatKey: driven.key, mode: driven.mode, downgraded: driven.choice === 'settings' && fromSettings.downgraded });
      }
      // A conversation open in VS Code or a terminal is someone else's: writing into it would interleave two drivers.
      if (chat && !chat.chattable) return reply(409, { error: 'live-chat' });
      cwd = state[INTERNALS]?.chats.get(body.sessionId)?.cwd ?? saved?.cwd;
      if (!cwd) return reply(409, { error: 'no-folder' });
      resume = body.sessionId;
      if (saved?.node?.kind === 'flow') flow = { seen: null, reply: '' };
      if (chat) place = { ...place, title: chat.title };
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
      // An idea or a new map is about the whole project: it starts at the root, whatever branch is picked.
      const atRoot = node?.kind === 'idea' || node?.kind === 'create-arch' || node?.kind === 'flow';
      cwd = atRoot ? project.root : workCell?.path ?? project.root;
      place = { ...place, partId: context.part?.id ?? null, workCellId: workCell?.id ?? null, ...(node ? { node: nodeTag(node) } : {}) };
    }
    const choice = body.mode ?? saved?.mode ?? 'settings';
    const mode = pickMode(choice, fromSettings);

    if ([...chats.values()].filter((c) => !c.ended).length >= CHATS_MAX) return reply(429, { error: 'too-many-chats' });
    const claude = bin !== undefined ? bin : findClaude();
    if (!claude) return reply(503, { error: 'claude-not-found' });

    const key = randomBytes(16).toString('hex');
    const chat = {
      key, sessionId: resume, parentId: body.sessionId ? null : body.parentId ?? null, secret: randomBytes(32).toString('hex'),
      projectId: project.id, root: project.root, cwd, ...place, choice, mode, startedAt: now(), reported: null,
      events: [], lastId: 0, sinks: new Set(), pending: new Map(), always: new Set(Array.isArray(saved?.always) ? saved.always : []),
      running: false, announced: false, ended: false, closing: false, idleTimer: null,
      configPath: join(smDir, 'chat', `${key}.json`), flow,
    };
    chat.done = new Promise((resolve) => { chat.exited = resolve; });
    // By file, not by argument: a command line is readable by other users of the machine.
    const config = { mcpServers: { sessionmap: { command: process.execPath, args: [PERMISSION_MCP], env: { SM_PERMISSION_URL: await relayUrl(), SM_PERMISSION_SECRET: chat.secret } } } };
    mkdirSync(join(smDir, 'chat'), { recursive: true });
    writeFileSync(chat.configPath, JSON.stringify(config), { mode: 0o600 });
    chats.set(key, chat);
    if (resume) bySession.set(resume, chat);
    chat.driver = startDriver({
      bin: claude, args: buildArgs({ mcpConfigPath: chat.configPath, resume, mode }), cwd, env: cleanEnv(env),
      onEvent: (evt) => onDriverEvent(chat, evt), ...(spawner ? { spawner } : {}),
    });
    sendTo(chat, body.text, prompt);
    return reply(200, { chatKey: key, mode, downgraded: choice === 'settings' && fromSettings.downgraded });
  }

  function changeMode(chat, choice) {
    chat.choice = choice;
    chat.mode = pickMode(choice, settingsMode(chat.root, dir));
    chat.driver.setMode(chat.mode);
    if (chat.sessionId) savePageChat(chat.sessionId, { mode: choice });
  }

  // The page conversations of a part (of one of its items with code), of a kind of point (idea, create-arch) or of a branch,
  // the one used last first, with the key of those still running.
  function listChats(query, state) {
    const project = state.projects.find((p) => p.id === query?.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const { partId, workCellId, code, kind } = query;
    const onPoint = (c) => (kind ? c.node?.kind === kind : partId ? c.partId === partId && (!code || c.node?.code === code) : Boolean(workCellId) && c.workCellId === workCellId);
    const belongs = (c) => c.projectId === project.id && onPoint(c);
    const chats = Object.entries(readPageChats()).filter(([, c]) => belongs(c)).map(([sessionId, c]) => {
      const driven = drivenNow(sessionId);
      return {
        sessionId, title: c.title ?? '', startedAt: c.startedAt ?? null, updatedAt: c.updatedAt ?? c.startedAt ?? null,
        mode: c.mode ?? 'settings', chatKey: driven?.key ?? null, running: Boolean(driven?.running),
      };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.startedAt).localeCompare(String(a.startedAt)));
    return reply(200, { chats, settings: settingsMode(project.root, dir) });
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

  // What a page that reopens a page conversation shows: the transcript, minus the turns a running process still
  // holds as events (those arrive by subscribing), with the first prompt as the person wrote it.
  function history(sessionId) {
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return reply(400, { error: 'bad-session' });
    const page = readPageChats()[sessionId];
    if (!page) return reply(404, { error: 'unknown-session' });
    const driven = drivenNow(sessionId);
    const file = transcriptOf(sessionId);
    const messages = (file ? readFullTranscript(file) : []).filter((m) => !driven || !m.ts || m.ts < driven.startedAt);
    const first = messages.find((m) => m.role === 'user');
    if (first) first.text = personsWords(first.text);
    const settings = settingsMode(page.root ?? page.cwd, dir);
    return reply(200, { sessionId, title: page.title ?? '', mode: page.mode ?? 'settings', settings, messages, chatKey: driven?.key ?? null });
  }

  const chatOf = (key) => (typeof key === 'string' && KEY_RE.test(key) ? chats.get(key) ?? null : null);

  function send(key, body) {
    const chat = chatOf(key);
    if (!chat) return reply(404, { error: 'unknown-chat' });
    if (chat.ended) return reply(409, { error: 'ended' });
    if (chat.running) return reply(409, { error: 'busy' });
    if (!isText(body?.text)) return reply(400, { error: 'bad-text' });
    sendTo(chat, body.text);
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

  return { start, send, permission, mode, stop, subscribe, list: listChats, history, close };
}
