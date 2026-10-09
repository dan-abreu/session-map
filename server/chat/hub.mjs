import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../actions.mjs';
import { cleanEnv, findClaude } from '../ai/runner.mjs';
import { sameToken } from '../auth.mjs';
import { recordLineage } from '../brain/lineage.mjs';
import { readNucleus } from '../brain/nucleus.mjs';
import { log } from '../log.mjs';
import { buildArgs, preview, startDriver } from './driver.mjs';

const PERMISSION_MCP = fileURLToPath(new URL('./permission-mcp.mjs', import.meta.url));
const KEY_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 20_000;
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
const list = (items) => items.map((i) => `- ${i}`).join('\n');

// Without the plugin there is no /session-map:board: the chat is told the card format itself.
const CARD_HINT = [
  'When you finish a step, end your reply with a short block like this, so session-map can show where the work stands:',
  '```session-map',
  '{"title": "what this conversation is about", "doing": "the step you are on", "todo": ["what is left"], "decided": ["what was settled"], "waiting": ["questions for the person"]}',
  '```',
  'Use only the fields that apply; keep each line short.',
].join('\n');

// What a new chat reads instead of the whole history (desenho-2 § 21, "Continuar aqui").
// board: the session-map plugin is installed and on, so its /session-map:board command exists.
export function firstPrompt({ unit, nucleus, mother, workCell, text, board = false }) {
  const parts = [];
  if (unit) {
    const lines = [`Area: ${unit.name}${unit.purpose ? ` (${unit.purpose})` : ''}`];
    if (nucleus?.state) lines.push(`State: ${nucleus.state}`);
    if (nucleus?.decided?.length) lines.push(`Decided:\n${list(nucleus.decided)}`);
    if (nucleus?.todo?.length) lines.push(`To do:\n${list(nucleus.todo)}`);
    parts.push(lines.join('\n'));
  }
  if (workCell) parts.push(`Branch: ${workCell.branch}`);
  const card = mother?.card;
  if (card) {
    const lines = [`Previous conversation: ${card.title || mother.title}`];
    if (card.doing) lines.push(`Doing: ${card.doing}`);
    if (card.todo?.length) lines.push(`To do:\n${list(card.todo)}`);
    if (card.waiting?.length) lines.push(`Waiting:\n${list(card.waiting)}`);
    if (card.decided?.length) lines.push(`Decided:\n${list(card.decided)}`);
    parts.push(lines.join('\n'));
  }
  if (!parts.length) return text;
  const hint = board ? 'When you finish a step, run /session-map:board.' : CARD_HINT;
  return `Context from session-map (this is all you need from earlier work):\n\n${parts.join('\n\n')}\n\n${hint}\n\n${text}`;
}

// Chats the page drives through the user's own claude CLI. bin: undefined looks it up at start, null means not installed.
export function createChatHub({ smDir, bin, env = process.env, permissionTimeoutMs = PERMISSION_TIMEOUT_MS, idleMs = IDLE_MS, spawner } = {}) {
  const chats = new Map();
  const bySession = new Map();
  let relay = null;

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
      // The CLI repeats init every turn: only the first one is news.
      if (chat.announced) return;
      chat.announced = true;
      chat.sessionId = evt.data.sessionId;
      bySession.set(chat.sessionId, chat);
      if (chat.parentId && chat.parentId !== chat.sessionId) {
        try { recordLineage(smDir, chat.sessionId, chat.parentId); } catch (err) { log('warn', 'lineage-failed', { error: err.message }); }
      }
      return emit(chat, 'session', { sessionId: chat.sessionId, state: 'started' });
    }
    if (evt.type === 'turn-end') {
      chat.running = false;
      clearTimeout(chat.idleTimer);
      chat.idleTimer = setTimeout(() => { chat.closing = true; chat.driver.end(); }, idleMs);
      chat.idleTimer.unref?.();
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
    const items = { unit: project.units, workCell: project.workCells, chat: project.chats }[kind] ?? [];
    return items.find((x) => (kind === 'chat' ? x.sessionId : x.id) === id) ?? null;
  }

  function sendTo(chat, text) {
    clearTimeout(chat.idleTimer);
    chat.running = true;
    chat.driver.send(text);
  }

  // body: {projectId, cellId|unitId?, frontId|workCellId?, sessionId? (continue it), parentId? (the mother of a new chat), text}
  async function start(body, state) {
    if (!body || typeof body !== 'object') return reply(400, { error: 'bad-request' });
    if (!isText(body.text)) return reply(400, { error: 'bad-text' });
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project) return reply(404, { error: 'unknown-project' });
    const unitId = body.cellId ?? body.unitId;
    const workCellId = body.frontId ?? body.workCellId;
    for (const id of [body.sessionId, body.parentId]) if (id !== undefined && !(typeof id === 'string' && UUID_RE.test(id))) return reply(400, { error: 'bad-session' });

    let cwd;
    let prompt = body.text;
    let resume = null;
    if (body.sessionId) {
      const chat = find(project, 'chat', body.sessionId);
      if (!chat) return reply(404, { error: 'unknown-session' });
      const driven = bySession.get(chat.sessionId);
      if (driven && !driven.ended) {
        if (driven.running) return reply(409, { error: 'busy', chatKey: driven.key });
        sendTo(driven, body.text);
        return reply(200, { chatKey: driven.key });
      }
      // A conversation open in VS Code or a terminal is someone else's: writing into it would interleave two drivers.
      if (!chat.chattable) return reply(409, { error: 'live-chat' });
      cwd = state[INTERNALS]?.chats.get(chat.sessionId)?.cwd;
      if (!cwd) return reply(409, { error: 'no-folder' });
      resume = chat.sessionId;
    } else {
      const mother = body.parentId ? find(project, 'chat', body.parentId) : null;
      if (body.parentId && !mother) return reply(404, { error: 'unknown-session' });
      const unit = unitId !== undefined ? find(project, 'unit', unitId) : mother && find(project, 'unit', mother.unitId);
      if (unitId !== undefined && !unit) return reply(404, { error: 'unknown-unit' });
      const workCell = workCellId !== undefined ? find(project, 'workCell', workCellId) : null;
      if (workCellId !== undefined && !workCell) return reply(404, { error: 'unknown-front' });
      const nucleus = unit ? readNucleus(smDir, project.id, unit.id) ?? unit.nucleus : null;
      const board = (project.skills ?? []).some((s) => s.command === '/session-map:board' && s.enabled);
      prompt = firstPrompt({ unit, nucleus, mother, workCell, text: body.text, board });
      cwd = workCell?.path ?? project.root;
    }

    if ([...chats.values()].filter((c) => !c.ended).length >= CHATS_MAX) return reply(429, { error: 'too-many-chats' });
    const claude = bin !== undefined ? bin : findClaude();
    if (!claude) return reply(503, { error: 'claude-not-found' });

    const key = randomBytes(16).toString('hex');
    const chat = {
      key, sessionId: resume, parentId: body.sessionId ? null : body.parentId ?? null, secret: randomBytes(32).toString('hex'),
      events: [], lastId: 0, sinks: new Set(), pending: new Map(), always: new Set(),
      running: false, announced: false, ended: false, closing: false, idleTimer: null,
      configPath: join(smDir, 'chat', `${key}.json`),
    };
    chat.done = new Promise((resolve) => { chat.exited = resolve; });
    // By file, not by argument: a command line is readable by other users of the machine.
    const config = { mcpServers: { sessionmap: { command: process.execPath, args: [PERMISSION_MCP], env: { SM_PERMISSION_URL: await relayUrl(), SM_PERMISSION_SECRET: chat.secret } } } };
    mkdirSync(join(smDir, 'chat'), { recursive: true });
    writeFileSync(chat.configPath, JSON.stringify(config), { mode: 0o600 });
    chats.set(key, chat);
    if (resume) bySession.set(resume, chat);
    chat.driver = startDriver({
      bin: claude, args: buildArgs({ mcpConfigPath: chat.configPath, resume }), cwd, env: cleanEnv(env),
      onEvent: (evt) => onDriverEvent(chat, evt), ...(spawner ? { spawner } : {}),
    });
    sendTo(chat, prompt);
    return reply(200, { chatKey: key });
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
    if (body.allow && body.always === true) chat.always.add(pending.toolName);
    if (body.allow) pending.finish('allowed', { behavior: 'allow', updatedInput: pending.input });
    else pending.finish('denied', { behavior: 'deny', message: DENIED });
    return reply(200);
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

  return { start, send, permission, stop, subscribe, close };
}
