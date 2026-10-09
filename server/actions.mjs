import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { readJsonFile, writeAtomic } from './brain/cells.mjs';
import { safeResolve, vscodeUrl } from './files.mjs';
import { installFromCatalog } from './sources/catalog.mjs';
import { killProcess, newTerminal, openUrl, processName as processNameDefault, processStart as processStartDefault } from './launch.mjs';
import { log } from './log.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['open', 'new', 'close', 'archive', 'unarchive', 'install', 'open-file']);
const CLAUDE_PROCESS_RE = /claude|node/i;
const PID_START_SLACK_MS = 5000;
const LINE_MAX = 10_000_000;

// The key collect uses to hand the actions what the page must not see (cwd, pid); Symbol.for so neither file imports the other.
export const INTERNALS = Symbol.for('session-map.internals');

const reply = (status, body = {}) => ({ status, body: status < 300 ? { ok: true, ...body } : { ok: false, ...body } });

function findChat(state, sessionId) {
  for (const project of state.projects) {
    const chat = project.chats.find((c) => c.sessionId === sessionId);
    if (chat) return chat;
  }
  return null;
}

function findWorkCell(state, frontId, projectId) {
  for (const project of state.projects) {
    if (projectId && project.id !== projectId) continue;
    const cell = project.workCells.find((w) => w.id === frontId);
    if (cell) return { project, cell };
  }
  return null;
}

// Only the session file the server itself knows about, by the pid it read: never a path from the request.
function sessionFile(dir, pid) {
  try {
    return JSON.parse(readFileSync(join(dir, 'sessions', `${pid}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function setArchived(smDir, sessionId, on) {
  const file = join(smDir, 'archived.json');
  const stored = readJsonFile(file, []);
  const ids = new Set(Array.isArray(stored) ? stored : []);
  if (on) ids.add(sessionId);
  else ids.delete(sessionId);
  writeAtomic(file, `${JSON.stringify([...ids])}\n`);
}

async function close(chat, info, { dir, processName, processStart, kill }) {
  if (chat.status === 'busy') return reply(409, { error: 'busy' });
  if (!chat.live || !Number.isInteger(info?.pid)) return reply(409, { error: 'not-running' });
  const session = sessionFile(dir, info.pid);
  if (session?.sessionId !== chat.sessionId || session.status === 'busy') return reply(409, { error: 'session-changed' });
  if (!CLAUDE_PROCESS_RE.test(await processName(info.pid))) return reply(409, { error: 'not-claude' });
  // A crashed session leaves its file behind; a process that started after it holds a reused pid.
  if (Number.isFinite(session.startedAt)) {
    const started = await processStart(info.pid);
    if (started === null || started > session.startedAt + PID_START_SLACK_MS) return reply(409, { error: 'session-changed' });
  }
  return (await kill(info.pid)) ? reply(200) : reply(409, { error: 'kill-refused' });
}

// The path comes from the page, so it is checked like a file read: inside the folder, never .git, a file that exists.
function openFile(body, state, launchOpts) {
  if (typeof body.projectId !== 'string' || typeof body.path !== 'string') return reply(400, { error: 'bad-path' });
  const project = state.projects.find((p) => p.id === body.projectId);
  if (!project) return reply(404, { error: 'unknown-project' });
  const line = body.line ?? 1;
  if (!Number.isInteger(line) || line < 1 || line > LINE_MAX) return reply(400, { error: 'bad-line' });
  const cell = body.workCell === undefined ? null : project.workCells.find((w) => w.id === body.workCell);
  if (cell === undefined) return reply(404, { error: 'unknown-front' });
  const abs = safeResolve(cell?.path ?? project.root, body.path);
  if (!abs) return reply(400, { error: 'bad-path' });
  if (!statSync(abs, { throwIfNoEntry: false })?.isFile()) return reply(404, { error: 'not-found' });
  openUrl(vscodeUrl(abs, line), launchOpts);
  return reply(200);
}

async function dispatch(body, deps) {
  const { state, platform, spawner, hasWt } = deps;
  const launchOpts = { platform, spawner, ...(hasWt ? { hasWt } : {}) };
  if (!body || typeof body !== 'object' || !ACTIONS.has(body.action)) return reply(400, { error: 'bad-action' });

  if (body.action === 'install') {
    const { status, ...rest } = await installFromCatalog(body, deps);
    return reply(status, rest);
  }

  if (body.action === 'open-file') return openFile(body, state, launchOpts);

  if (body.action === 'new' && body.bare === true) {
    const project = state.projects.find((p) => p.id === body.projectId);
    if (typeof body.projectId !== 'string') return reply(400, { error: 'bad-project' });
    if (!project) return reply(404, { error: 'unknown-project' });
    const cell = body.frontId === undefined ? null : project.workCells.find((w) => w.id === body.frontId);
    if (cell === undefined) return reply(404, { error: 'unknown-front' });
    newTerminal(cell?.path ?? project.root, [], launchOpts);
    return reply(200);
  }

  if (body.action === 'new') {
    if (typeof body.frontId !== 'string') return reply(400, { error: 'bad-front' });
    const found = findWorkCell(state, body.frontId, typeof body.projectId === 'string' ? body.projectId : null);
    if (!found) return reply(404, { error: 'unknown-front' });
    const name = found.cell.branch.replace(/[^\w./-]+/g, '-');
    newTerminal(found.cell.path ?? found.project.root, ['claude', '--remote-control', name], launchOpts);
    return reply(200);
  }

  if (typeof body.sessionId !== 'string' || !UUID_RE.test(body.sessionId)) return reply(400, { error: 'bad-session' });
  const chat = findChat(state, body.sessionId);
  if (!chat) return reply(404, { error: 'unknown-session' });
  const info = state[INTERNALS]?.chats.get(chat.sessionId);

  switch (body.action) {
    case 'open':
      if (chat.entrypoint === 'claude-vscode') {
        openUrl(`vscode://anthropic.claude-code/open?session=${chat.sessionId}`, launchOpts);
        return reply(200, { opened: 'vscode' });
      }
      if (chat.live) return reply(409, { error: 'already-open' });
      if (!info?.cwd) return reply(409, { error: 'no-folder' });
      newTerminal(info.cwd, ['claude', '--resume', chat.sessionId], launchOpts);
      return reply(200, { opened: 'terminal' });
    case 'close':
      return close(chat, info, deps);
    default:
      setArchived(deps.smDir, chat.sessionId, body.action === 'archive');
      return reply(200);
  }
}

function logAction(smDir, body, status) {
  const line = { ts: new Date().toISOString(), action: String(body?.action ?? '').slice(0, 20), status };
  if (typeof body?.sessionId === 'string') line.sessionId = body.sessionId.slice(0, 40);
  if (typeof body?.frontId === 'string') line.frontId = body.frontId.slice(0, 200);
  if (typeof body?.repo === 'string') line.repo = body.repo.slice(0, 100);
  if (typeof body?.scope === 'string') line.scope = body.scope.slice(0, 10);
  if (typeof body?.plugin === 'string') line.plugin = body.plugin.slice(0, 100);
  try {
    mkdirSync(smDir, { recursive: true });
    appendFileSync(join(smDir, 'actions.log'), `${JSON.stringify(line)}\n`);
  } catch (err) {
    log('warn', 'action-log-failed', { code: err.code });
  }
}

// deps: state (from collect), dir, smDir; spawner, processName, processStart, kill and platform are replaceable for tests.
export async function runAction(body, { processName = processNameDefault, processStart = processStartDefault, kill = killProcess, ...deps }) {
  const res = await dispatch(body, { processName, processStart, kill, ...deps });
  logAction(deps.smDir, body, res.status);
  return res;
}
