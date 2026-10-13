import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { listActionOn, logAction, runAction } from './actions.mjs';
import { createDelivery, toastCommand } from './alerts/deliver.mjs';
import { notifyPrefs, setNotifyPrefs } from './alerts/prefs.mjs';
import { createWatcher } from './alerts/watcher.mjs';
import { createAskRoutes, hasHeaderToken, headerAuth } from './ai/askroute.mjs';
import { createHelperRoutes } from './ai/helperroute.mjs';
import { getKey } from './ai/keys.mjs';
import { othersSettings } from './ai/others.mjs';
import { createVersionWatch } from './ai/versions.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { changeDetailOf, changesOf } from './changes-state.mjs';
import { archiveAll, archivedPath, deleteArchived, readArchived, readIndex, searchIndex } from './archive.mjs';
import { readConversation, readImage } from './sources/claude-conversation.mjs';
import { applyImport, deleteDraft, exportMermaid, planImport, programOnly, readDraft, writeDraft } from './arch/flow.mjs';
import { liveOf, partView, publicView } from './arch/flowinner.mjs';
import { versionText } from './web/statesig.js';
import { readArch } from './arch/detect.mjs';
import { MODEL_VERSION, buildFlowModel, readModelCache } from './arch/flowmodel.mjs';
import { authorize, cookieToken, dropLookKey, isLocal, loadLookKey, loadToken, lookAllows, newLookKey, sameToken } from './auth.mjs';
import { lookState } from './lookstate.mjs';
import { createCatalogRefresher, setBackground, setTidy, sweepable, tidyOn } from './background.mjs';
import { continueProjectMonth, monthOf, setProjectBudget } from './budget.mjs';
import { githubStatus, newProject, suggestParent } from './newproject.mjs';
import { projectIdOf } from './paths.mjs';
import { createChatHub } from './chat/hub.mjs';
import { setUserMode, undoUserMode, userModeState } from './chat/mode.mjs';
import { reinforcedLimit, reinforcedSpend, setReinforcedLimit } from './chat/run.mjs';
import { collect, topLevelOf } from './collect.mjs';
import { fileOwners } from './arch/fileowners.mjs';
import { loadConfig } from './config.mjs';
import { findFiles, isSecretsFile, listFiles, mergeBaseOf, readFileForView } from './files.mjs';
import { readRemoved } from './hidden.mjs';
import { createFoundationRoute } from './foundation/http/index.mjs';
import { refreshFoundation } from './foundation/refresh.mjs';
import { linksOf } from './imports.mjs';
import { log } from './log.mjs';
import { fetchCatalog, filterCatalog, markInstalled } from './sources/catalog.mjs';
import { claudeDir } from './sources/claude.mjs';
import { countRepo } from './sources/count.mjs';
import { setPlacement } from './placements.mjs';
import { addCard, moveCard, readCards, removeCard } from './cards.mjs';
import { readJsonFile, writeAtomic } from './store.mjs';
import { LISTEN_RETRY_MS, createRestarter, listenWithRetry, resumeAfterRestart } from './restart.mjs';
import { createStatementStore, isStatementPath, statementRoute } from './statement-route.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(here, 'web');
const DEMO_STATE = join(here, '..', 'demo', 'state.json');
const STATE_TTL_MS = 3000;
const STATE_SAVE_MS = 60_000;
// Reading the transcripts holds the event loop for a while: the copy's bytes leave the socket first.
const COLLECT_AFTER_COPY_MS = 300;
const SWEEP_MS = 5 * 60_000;
const VERSIONS_FIRST_MS = 30_000;
const VERSIONS_EVERY_MS = 60 * 60_000;
// How often the watcher looks at every session on the PC, page open or not.
const WATCH_MS = 10_000;
const BODY_MAX = 64 * 1024;
// A chat message may carry pasted images (ten of about 3.7 MB each, 5 MB once in base64).
const CHAT_BODY_MAX = 56 * 1024 * 1024;
const FILE_ERRORS = { 'bad-path': 400, sensitive: 403, 'not-found': 404, 'too-large': 413, binary: 415 };
const MODE_ERRORS = { 'bad-mode': 400, 'nothing-to-undo': 404, 'settings-unreadable': 409 };
const LIMIT_ERRORS = { 'bad-limit': 400, 'config-unreadable': 409 };
const NOTIFY_ERRORS = { 'bad-notify': 400, 'config-unreadable': 409 };
const BACKGROUND_ERRORS = { 'bad-background': 400, 'config-unreadable': 409 };
const TIDY_ERRORS = { 'bad-tidy': 400, 'config-unreadable': 409 };
const BUDGET_ERRORS = { 'bad-budget': 400, 'config-unreadable': 409 };
const NEW_PROJECT_ERRORS = {
  'bad-name': 400, 'bad-parent': 400, 'bad-github': 400, 'bad-repo-name': 400, 'folder-exists': 409, 'repo-exists': 409, 'github-not-ready': 409, 'github-user-changed': 409, 'github-unreachable': 502,
  'config-unreadable': 409, 'folder-failed': 500,
};
const FLOW_ERRORS = {
  'not-flowchart': 400, 'empty-flowchart': 400, 'fence-in-drawing': 400, 'view-not-importable': 400, 'bad-path': 400, 'arch-not-here': 409, 'no-arch': 409,
  // what care.applyOp may answer (fd14)
  'look-only': 409, 'needs-confirm': 409, 'already-applied': 409, 'changed-since': 409, 'too-big': 413, 'write-failed': 500,
};
const FLOW_TEXT_MAX = 60_000;
// The Flow's model (fl07): a build younger than this is answered as it is; a GET waits this long for a build before it
// answers with the last model it has, marked building.
const MODEL_FRESH_MS = 5000;
const MODEL_WAIT_MS = 1500;
const SKIP_MAX = 500;
const PLACE_TITLE_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

async function readBody(req, max = BODY_MAX) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'too-large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'bad-json');
  }
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'content-type': json ? TYPES['.json'] : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

// A state's version is its content without the time it was collected and the rolling costs that slide with it: a collect
// that found nothing new keeps it, and a poll that already has it gets a 304 with no body (sv09). Made once per state.
const stamps = new WeakMap();
function stampOf(s, mark = '') {
  let stamp = stamps.get(s);
  if (!stamp) {
    const body = JSON.stringify(s);
    stamp = { body, etag: `"${mark}${createHash('sha1').update(versionText(s)).digest('hex')}"` };
    stamps.set(s, stamp);
  }
  return stamp;
}

// The disk copy goes out without a tag, so the page never keeps it as current and asks again until the real one comes.
// look: the "look only" link (sv04) gets the map's part of the state only, under a tag of its own.
function sendState(req, res, s, look = false) {
  if (look) s = lookState(s);
  if (s.refreshing) return send(res, 200, s);
  const { body, etag } = stampOf(s, look ? 'look-' : '');
  const headers = { 'content-type': TYPES['.json'], 'cache-control': 'no-store', etag, ...(s.generatedAt ? { 'x-generated-at': String(s.generatedAt) } : {}) };
  const asked = String(req.headers['if-none-match'] ?? '').split(',').map((tag) => tag.trim());
  res.writeHead(asked.includes(etag) ? 304 : 200, headers);
  return res.end(asked.includes(etag) ? undefined : body);
}

async function serveFile(res, path) {
  const rel = path === '/' ? 'index.html' : path.replace(/^\/(static\/)?/, '');
  const file = normalize(join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + sep)) throw new HttpError(404, 'not-found');
  let body;
  try {
    body = await readFile(file);
  } catch (err) {
    throw new HttpError(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500, 'not-found');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}

// helpers ({backend, apiRun, textRun}): the lock for the other AIs' keys and their call, replaceable for tests; askAi ({ask}):
// askOthers behind POST /api/ai/ask (tests).
// collectFn, ai, catalog ({token, fetchFn, exec, bin}) and deliver (the desktop and phone alerts) are replaceable for tests;
// addressOf stands in for the socket's remote address. baseUrl: where a click on a desktop alert opens the page; lanUrl:
// the page's address on the network (--lan), which the look-only link carries. restart ({now, every, stopEvery, spawn,
// exit, execPath, argv, env}): the agreed restart's clock, check, spawn and exit (restart.mjs), fakes in tests.
// The demo never writes to the user's disk, so its token lives only in memory.
export function createApp({
  dir = claudeDir(), smDir, demo = false, token = demo ? randomBytes(32).toString('hex') : loadToken(smDir),
  collectFn = collect, ai, addressOf = (req) => req.socket.remoteAddress, chat: chatHub,
  catalog = {}, stateTtlMs = STATE_TTL_MS, baseUrl = 'http://127.0.0.1:4001', deliver = createDelivery({ baseUrl }), helpers = {}, askAi = {},
  lanUrl = null, restart = {}, newProjectExec, versions = {},
} = {}) {
  let watcher = null;
  // The look-only key (sv04): null while the owner has none; read once here, then changed only by lookRoute.
  let lookKey = demo || !smDir ? null : loadLookKey(smDir);
  // readState/changed: the orchestrator's tools read the newest state and drop it after an archive or a rename (or17).
  const chat = chatHub !== undefined ? chatHub : demo ? null : createChatHub({
    smDir, dir, arsenalUrl: baseUrl, conductorFacts: () => askRoutes.others(), onAlert: (a) => watcher?.push([a]), readState: () => quickState(), changed: () => fresh(),
    // The project's month against its own budget (or07), from the newest finished state: a chat start never waits a collect.
    projectBudget: (projectId) => newest?.projects?.find((p) => p.id === projectId)?.budget ?? null,
  });
  // The spend statement (sb09): built in the background from the transcripts, on the page's Costs tab.
  const statements = demo ? null : createStatementStore({ projectsDir: join(dir, 'projects'), smDir });
  // The last good state on disk: a restart answers with it at once while the first collect (up to a minute) runs.
  const stateCopy = smDir ? join(smDir, 'state-cache.json') : null;
  let ready = false;
  let savedAt = 0;
  let cached = null;
  let newest = null;
  const state = () => {
    // A collect still running is shared, whatever its age: a second one would only slow both down.
    if (!cached || (cached.done && Date.now() - cached.at >= stateTtlMs)) {
      const promise = demo
        ? readFile(DEMO_STATE, 'utf8').then(JSON.parse)
        : Promise.resolve(collectFn({ dir, smDir, driving: chat?.drivingIds?.() ?? new Set(), ...(ai ? { ai } : {}) }));
      const entry = { at: Date.now(), promise, done: false };
      cached = entry;
      promise.then((s) => {
        Object.assign(entry, { done: true, at: Date.now() });
        newest = s;
        ready = true;
        if (!demo && stateCopy && Date.now() - savedAt >= STATE_SAVE_MS) {
          savedAt = Date.now();
          try { writeAtomic(stateCopy, stampOf(s).body); } catch (err) { log('warn', 'state-copy-failed', { error: err.message }); }
        }
      }, () => { if (cached === entry) cached = null; });
    }
    return cached.promise;
  };
  // What the chat reads: the newest finished state at once, the next one collected meanwhile. A collect of every project
  // can take half a minute, and opening a conversation must not wait for it (page-chat pc14).
  const quickState = () => {
    const next = state();
    return newest ?? next;
  };
  const firstAnswer = async () => {
    if (ready || demo || !stateCopy) return state();
    // Until the first collect is done every poll gets the copy, so none waits a minute on it.
    const copy = readJsonFile(stateCopy, null);
    if (!copy || !Array.isArray(copy.projects)) return state();
    if (!cached) setTimeout(state, COLLECT_AFTER_COPY_MS).unref?.();
    return { ...copy, refreshing: true };
  };
  const fresh = () => { cached = null; };
  // A poll answers at once with the newest finished state and starts the next collect meanwhile, so "nothing new" (304)
  // never waits seconds for one. Only a state a write threw away (fresh) is waited for: the page must see its own change.
  const pollState = () => (ready && cached && newest ? quickState() : firstAnswer());
  const foundationRoute = createFoundationRoute({ smDir, demo, token, projects: async () => (await firstAnswer()).projects, fresh });
  const prefsNow = () => notifyPrefs(readJsonFile(join(smDir, 'config.json'), {}) ?? {});
  // The chats the restart before this one resumes (sv13): no news as cut off.
  const resumed = new Set();
  watcher = demo ? null : createWatcher({
    readState: state, deliver, prefs: prefsNow,
    skip: () => chat?.drivenIds?.() ?? new Set(),
    startup: (s) => (chat?.interrupted?.(s) ?? []).filter((a) => !resumed.has(a.sessionId)),
  });

  const projectOf = async (projectId) => {
    if (demo) throw new HttpError(403, 'demo');
    const project = (await state()).projects.find((p) => p.id === projectId);
    if (!project) throw new HttpError(404, 'unknown-project');
    return project;
  };

  // Runs code on this PC by design: even a local read of a chat needs the token (desenho-2 § 22).
  async function chatRoute(req, res, parts, url) {
    if (!chat) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const [, , , key, verb] = parts;
    if (req.method === 'POST' && key === 'start' && parts.length === 4) {
      const result = await chat.start(await readBody(req, CHAT_BODY_MAX), await state());
      return send(res, result.status, result.body);
    }
    if (key === 'orchestrator' && parts.length === 4) return orchestratorRoute(req, res, url);
    if (req.method === 'GET' && key === 'list' && parts.length === 4) {
      const query = Object.fromEntries(['projectId', 'partId', 'workCellId', 'code', 'kind'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      const result = chat.list(query, await quickState());
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && key === 'history' && parts.length === 5) {
      // before/from: a page of the history (pc15); anything but a plain index is left out.
      const index = (name) => (/^\d{1,7}$/.test(url.searchParams.get(name) ?? '') ? Number(url.searchParams.get(name)) : undefined);
      // The mirror asks every 3 s, mostly to hear "nothing new": the newest finished state answers it and no collect is
      // started from here; the watcher and the page's poll keep that state fresh.
      const result = chat.history(verb, newest ?? await quickState(), { since: url.searchParams.get('since') ?? undefined, before: index('before'), from: index('from') });
      return send(res, result.status, result.body);
    }
    // An image of a conversation (mm22): only the image kinds a browser shows, never anything it could run.
    if (req.method === 'GET' && key === 'image' && parts.length === 6) {
      const n = /^\d{1,6}$/.test(parts[5]) ? Number(parts[5]) : -1;
      const found = chat.image(verb, n, await quickState());
      if (!found || !IMAGE_TYPES.has(found.media)) throw new HttpError(404, 'not-found');
      res.writeHead(200, { 'content-type': found.media, 'cache-control': 'private, max-age=86400' });
      return res.end(found.data);
    }
    if (req.method === 'GET' && key === 'helper' && parts.length === 6) {
      const result = chat.helper(verb, parts[5], await quickState());
      return send(res, result.status, result.body);
    }
    if (parts.length !== 5) throw new HttpError(404, 'not-found');
    if (req.method === 'GET' && verb === 'events') {
      const lastId = Number.parseInt(req.headers['last-event-id'] ?? '0', 10) || 0;
      const sink = {
        write: (evt) => res.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`),
        end: () => res.end(),
      };
      // Headers wait in the response until the first write, so an unknown chat can still become a 404.
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      const unsubscribe = chat.subscribe(key, sink, lastId);
      if (!unsubscribe) throw new HttpError(404, 'unknown-chat');
      res.flushHeaders();
      req.on('close', unsubscribe);
      return undefined;
    }
    if (req.method !== 'POST' || !['send', 'permission', 'mode', 'run', 'stop'].includes(verb)) throw new HttpError(404, 'not-found');
    const body = await readBody(req, verb === 'send' ? CHAT_BODY_MAX : BODY_MAX);
    const result = verb === 'stop' ? chat.stop(key) : chat[verb](key, body);
    return send(res, result.status, result.body);
  }

  // The project's orchestrator (or01/or03): GET what the page shows of it (one project, or all for the Now strip); POST opens
  // it, resuming the same conversation, or starts it with the person's message (text, optional).
  async function orchestratorRoute(req, res, url) {
    if (req.method === 'GET') {
      const s = await quickState();
      const projectId = url.searchParams.get('projectId');
      if (projectId === null) return send(res, 200, { ok: true, orchestrators: s.projects.map((p) => chat.orchestra.info(p.id, s)) });
      if (!s.projects.some((p) => p.id === projectId)) throw new HttpError(404, 'unknown-project');
      return send(res, 200, { ok: true, ...chat.orchestra.info(projectId, s) });
    }
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = await readBody(req, CHAT_BODY_MAX);
    // The person's priority for one item of the orchestrator's line (or08): {projectId, code, priority}.
    if (body && typeof body === 'object' && 'priority' in body) {
      const set = chat.orchestra.prioritize(body, await state());
      return send(res, set.status, set.body);
    }
    const result = await chat.orchestra.open(body, await state());
    return send(res, result.status, result.body);
  }

  // The owner moves a conversation to another project or part, or renames it (mm21). Writes need the token (authorize).
  async function placeRoute(req, res, sessionId) {
    if (!UUID_RE.test(sessionId)) throw new HttpError(400, 'bad-session');
    if (demo) throw new HttpError(403, 'demo');
    const body = await readBody(req);
    const ok = body && typeof body === 'object' && !Array.isArray(body)
      && (!('title' in body) || (typeof body.title === 'string' && body.title.length <= PLACE_TITLE_MAX))
      && (!('projectId' in body) || typeof body.projectId === 'string')
      && (!('partId' in body) || body.partId === null || typeof body.partId === 'string');
    if (!ok) throw new HttpError(400, 'bad-place');
    const { projects } = await state();
    const home = projects.find((p) => (p.conversations ?? []).some((r) => r.sessionId === sessionId));
    if (!home) throw new HttpError(404, 'unknown-session');
    const target = 'projectId' in body ? projects.find((p) => p.id === body.projectId) : home;
    if (!target) throw new HttpError(404, 'unknown-project');
    if (body.partId && !target.arch.parts.some((p) => p.id === body.partId)) throw new HttpError(400, 'unknown-part');
    const patch = {};
    if ('title' in body) patch.title = body.title;
    if ('projectId' in body) patch.root = target.root;
    // '' hands the part back to the rules; null is the owner saying "no part".
    if ('partId' in body) patch.partId = body.partId === '' ? undefined : body.partId;
    // A part of the old project means nothing in the new one: the rules place it there until the owner picks one.
    else if (target !== home) patch.partId = undefined;
    const placement = setPlacement(smDir, sessionId, patch);
    logAction(smDir, { action: 'place', sessionId, projectId: target.id }, 200);
    fresh();
    return send(res, 200, { ok: true, placement });
  }

  // The cards made by hand in the Board (mm14), in session-map's own folder. A read is open like the state; a write needs the
  // token (route). The project's files are never written.
  async function cardsRoute(req, res, parts) {
    if (req.method === 'GET' && parts.length === 3) return send(res, 200, { ok: true, cards: demo ? {} : readCards(smDir) });
    if (demo) throw new HttpError(403, 'demo');
    const id = parts[3];
    if (req.method === 'POST' && parts.length === 3) {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.projectId !== 'string') throw new HttpError(400, 'bad-card');
      const { projects } = await state();
      const target = projects.find((p) => p.id === body.projectId);
      if (!target) throw new HttpError(404, 'unknown-project');
      if (body.partId && !target.arch.parts.some((p) => p.id === body.partId)) throw new HttpError(400, 'unknown-part');
      const made = addCard(smDir, target.id, body);
      if (!made.ok) throw new HttpError(400, made.error);
      logAction(smDir, { action: 'card-add', projectId: target.id }, 200);
      return send(res, 200, made);
    }
    if (req.method === 'POST' && parts[4] === 'move' && parts.length === 5) {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad-column');
      const moved = moveCard(smDir, id, body);
      if (!moved.ok) throw new HttpError(moved.error === 'unknown-card' ? 404 : 400, moved.error);
      logAction(smDir, { action: 'card-move', column: body.column }, 200);
      return send(res, 200, moved);
    }
    if (req.method === 'DELETE' && parts.length === 4) {
      if (!removeCard(smDir, id)) throw new HttpError(404, 'unknown-card');
      logAction(smDir, { action: 'card-delete' }, 200);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not-found');
  }

  // The permission mode in the user's own settings.json, which every Claude on this PC reads (desenho-3 § 3).
  async function settingsRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method === 'GET') return send(res, 200, { ok: true, ...userModeState(dir) });
    let result;
    let action;
    if (req.method === 'POST') {
      const body = await readBody(req);
      action = { action: 'permission-mode', mode: body?.mode };
      result = setUserMode(dir, body?.mode);
    } else if (req.method === 'DELETE') {
      action = { action: 'permission-mode-undo' };
      result = undoUserMode(dir);
    } else throw new HttpError(404, 'not-found');
    const status = result.ok ? 200 : MODE_ERRORS[result.error];
    logAction(smDir, action, status);
    return send(res, status, result);
  }

  // How much Automatic may spend a month reinforcing on its own (budget.reinforcedMonthlyUSD in session-map's own config).
  async function limitRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method === 'GET') return send(res, 200, { ok: true, limitUSD: reinforcedLimit(smDir), spentUSD: Math.round(reinforcedSpend(smDir) * 1e6) / 1e6 });
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const usd = (await readBody(req))?.usd;
    const result = setReinforcedLimit(smDir, usd);
    const status = result.ok ? 200 : LIMIT_ERRORS[result.error];
    logAction(smDir, { action: 'reinforced-limit', usd: typeof usd === 'number' ? usd : null }, status);
    return send(res, status, result);
  }

  // A project kept always up to date: the map's work (and the AI's tokens) goes on there though nobody works in it.
  async function backgroundRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    const project = (await state()).projects.find((p) => p.id === body?.projectId);
    if (!project) throw new HttpError(404, 'unknown-project');
    const result = setBackground(smDir, project.root, body.always);
    const status = result.ok ? 200 : BACKGROUND_ERRORS[result.error];
    if (result.ok) cached = null;
    logAction(smDir, { action: 'project-background', projectId: project.id, always: result.ok ? result.always : null }, status);
    return send(res, status, result);
  }

  // A new project (sv14): GET says where new projects usually go and who is logged in to GitHub here (sv15); POST
  // {parent, name, github?} creates its folder, and its GitHub repository when asked; the next read of the projects lists it.
  async function newProjectRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const opts = newProjectExec ? { exec: newProjectExec } : {};
    if (req.method === 'GET') {
      const parent = suggestParent((await quickState()).projects.map((p) => p.root));
      return send(res, 200, { ok: true, parent, github: await githubStatus(opts) });
    }
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    const result = await newProject(smDir, body, { ...opts, fresh: true });
    const status = result.ok ? 200 : NEW_PROJECT_ERRORS[result.error];
    if (result.ok) cached = null;
    logAction(smDir, { action: 'new-project', projectId: result.ok ? projectIdOf(result.root) : null, github: result.github ? (result.github.ok ? 'created' : result.github.error) : null }, status);
    return send(res, status, result.ok ? { ...result, projectId: projectIdOf(result.root) } : result);
  }

  // A project's monthly budget (or07): POST {projectId, usd} sets it (null removes it), {projectId, continue: true} lifts the
  // pause until the month ends. Merged into session-map's own config.json; the next state shows it.
  async function budgetRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    const project = (await quickState()).projects.find((p) => p.id === body?.projectId);
    if (!project) throw new HttpError(404, 'unknown-project');
    const keep = body.continue === true && body.usd === undefined;
    const result = keep ? continueProjectMonth(smDir, project.root, monthOf(Date.now()))
      : body.continue === undefined && body.usd !== undefined ? setProjectBudget(smDir, project.root, body.usd) : { ok: false, error: 'bad-budget' };
    const status = result.ok ? 200 : BUDGET_ERRORS[result.error];
    if (result.ok) cached = null;
    logAction(smDir, { action: keep ? 'budget-continue' : 'project-budget', projectId: project.id, usd: typeof body.usd === 'number' ? body.usd : null }, status);
    return send(res, status, result);
  }

  // "Organizar sozinho" (or18): the orchestrator's tidy pass on a project, on unless the person turns it off.
  async function tidyRoute(req, res, url) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = req.method === 'POST' ? await readBody(req) : null;
    const projectId = req.method === 'GET' ? url.searchParams.get('projectId') : body?.projectId;
    const project = (await quickState()).projects.find((p) => p.id === projectId);
    if (!project) throw new HttpError(404, 'unknown-project');
    if (req.method === 'GET') return send(res, 200, { ok: true, tidy: tidyOn(readJsonFile(join(smDir, 'config.json'), {}) ?? {}, project.root) });
    const result = setTidy(smDir, project.root, body.tidy);
    const status = result.ok ? 200 : TIDY_ERRORS[result.error];
    if (result.ok) cached = null;
    logAction(smDir, { action: 'project-tidy', projectId: project.id }, status);
    return send(res, status, result);
  }

  // How the person wants to be told (watcher-and-alerts wa05), and a test alert through every way that is on.
  async function notifyRoute(req, res, path) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (path.endsWith('/test')) {
      if (req.method !== 'POST') throw new HttpError(404, 'not-found');
      watcher.push([{ kind: 'finished', reason: 'test', projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '' }]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') return send(res, 200, { ok: true, notify: prefsNow(), desktopAvailable: toastCommand(process.platform, { title: '', body: '', action: '', url: '' }) !== null });
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const result = setNotifyPrefs(smDir, await readBody(req));
    const status = result.ok ? 200 : NOTIFY_ERRORS[result.error];
    logAction(smDir, { action: 'notify' }, status);
    return send(res, status, result);
  }

  // The "look only" link (sv04): the owner makes it (a new one replaces the old), sees it again, or turns it off.
  async function lookRoute(req, res) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (req.method === 'POST') lookKey = newLookKey(smDir);
    else if (req.method === 'DELETE') {
      dropLookKey(smDir);
      lookKey = null;
    } else if (req.method !== 'GET') throw new HttpError(404, 'not-found');
    if (req.method !== 'GET') logAction(smDir, { action: 'look-link', on: lookKey !== null }, 200);
    const base = lanUrl ?? `http://${req.headers.host}`;
    return send(res, 200, { ok: true, on: lookKey !== null, link: lookKey === null ? null : `${base}/?look=${lookKey}` });
  }

  // The agreed restart (sv13): a conversation asks for a fresh session-map instead of killing it. The arsenal's lock:
  // the stdio tool's header token or the page's cookie, from this computer only, never in the demo.
  async function restartRoute(req, res) {
    if (demo || !restarter) throw new HttpError(403, 'demo');
    if (!isLocal(addressOf(req), req.headers.host)) throw new HttpError(403, 'loopback-only');
    if (!sameToken(cookieToken(req), token) && !hasHeaderToken(req, token)) throw new HttpError(401, 'token-required');
    if (req.method !== 'POST') throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    if (typeof body?.reason !== 'string' || !body.reason.trim()) throw new HttpError(400, 'bad-reason');
    const answer = restarter.request({ reason: body.reason, chatKey: body.chatKey });
    logAction(smDir, { action: 'restart', mode: answer.already ? 'joined' : 'new' }, 200);
    return send(res, 200, { ok: true, ...answer });
  }

  // The other AIs for bulk work (sb07): keys, which one takes the bulk work, a test call. Nothing here ever answers a key.
  const helperRoutes =demo || !smDir ? null : createHelperRoutes({ smDir, ai, roots: async () => ((await quickState()).projects ?? []).map((p) => p.root), ...helpers });
  // Claude asks the other AIs itself (or14): the page's cookie or the stdio tool's header token, loopback only.
  // The outside AIs' versions (or15): each provider with a key is asked for its model list at most once a day, and every
  // change goes out as one alert. "Check now" (POST /api/ai/versions/check) skips the wait of a day, never the minute.
  const versionWatch = demo || !smDir ? null : createVersionWatch({
    smDir, ...versions, onAlerts: (alerts) => watcher?.push(alerts),
    keyOf: ai?.keyOf ?? ((provider) => getKey(smDir, provider, helpers.backend ? { backend: helpers.backend } : {})),
    pinned: () => othersSettings((readJsonFile(join(smDir, 'config.json'), {}) ?? {}).ai, []).models,
  });
  const checkVersions = (options) => versionWatch.run(options);
  const askRoutes = createAskRoutes({ smDir, demo, token, ai, checkVersions: versionWatch ? checkVersions : undefined, rootOf: (key) => chat?.rootOf?.(key) ?? null, ...helpers, ...askAi });
  async function helpersRoute(req, res, path, url) {
    if (demo) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    let action;
    let result;
    if (path.endsWith('/test')) {
      if (req.method !== 'POST') throw new HttpError(404, 'not-found');
      const provider = (await readBody(req))?.provider;
      action = 'test';
      result = await helperRoutes.test(provider);
    } else if (req.method === 'GET') {
      return send(res, 200, helperRoutes.view());
    } else if (req.method === 'POST') {
      const body = await readBody(req);
      action = body?.key === undefined ? 'choice' : 'key-save';
      result = await helperRoutes.save(body);
    } else if (req.method === 'DELETE') {
      action = 'key-remove';
      result = helperRoutes.remove(url.searchParams.get('provider'));
    } else throw new HttpError(404, 'not-found');
    logAction(smDir, { action: 'ai-helpers', mode: action }, result.status);
    return send(res, result.status, result.body);
  }

  // Reading project files is as sensitive as the chat: even a local read needs the token.
  async function filesRoute(req, res, parts, url) {
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const project = await projectOf(parts[3]);
    const param = (name) => url.searchParams.get(name);
    const cell = param('workCell') === null ? null : project.workCells.find((w) => w.id === param('workCell'));
    if (cell === undefined) throw new HttpError(404, 'unknown-front');
    if (parts[2] === 'files') {
      if (param('find') !== null) return send(res, 200, { ok: true, files: await findFiles(project.root, param('find').slice(0, 200)) });
      // The whole program as the count sees it (no dependencies, generated or binary files, never a secret).
      if (param('all') === '1') {
        const files = (await countRepo(project.root)).files.filter((f) => !isSecretsFile(f.path));
        // Each file's parts as the boxes' counts read them (mm40): none means one of the files with no box (mm42).
        const owners = fileOwners(files.map((f) => f.path), project.arch, { topLevel: topLevelOf(project.root) });
        return send(res, 200, { ok: true, files: files.map((f, i) => ({ path: f.path, status: null, lines: f.lines, kind: f.kind, owners: owners[i] })) });
      }
      if (param('part') !== null) {
        const part = project.arch.parts.find((p) => p.id === param('part'));
        if (!part) throw new HttpError(404, 'unknown-part');
        const marks = new Map(project.workCells.filter((w) => w.partId === part.id).flatMap((w) => w.files.map((f) => [f.path, { status: f.status, workCell: w.id }])));
        const paths = [...new Set([...await listFiles(project.root, [...part.codePaths, part.file]), ...marks.keys()])].sort();
        const counted = new Map((await countRepo(project.root)).files.map((f) => [f.path, { lines: f.lines, kind: f.kind }]));
        return send(res, 200, { ok: true, files: paths.map((path) => ({ path, status: null, ...marks.get(path), ...counted.get(path) })) });
      }
      if (!cell) throw new HttpError(400, 'bad-request');
      return send(res, 200, { ok: true, files: cell.files.map(({ path, status }) => ({ path, status })) });
    }
    let root = project.root;
    let ref;
    let diffBase = null;
    if (cell) {
      ref = cell.remote ? `refs/remotes/origin/${cell.branch}` : `refs/heads/${cell.branch}`;
      if (project.mainBranch) diffBase = await mergeBaseOf(project.root, project.mainBranch, ref);
      // A branch checked out in a folder is read from the folder, which holds the uncommitted lines too.
      if (cell.path) { root = cell.path; ref = undefined; }
    }
    const out = await readFileForView(root, param('path'), { diffBase, ref });
    if (!out.ok) throw new HttpError(FILE_ERRORS[out.error], out.error);
    // What it uses and what uses it (mm26), from the project folder's own files: a branch's copy has no graph of its own.
    if (param('links') === '1' && !cell) out.links = await linksOf(project.root, param('path').replaceAll('\\', '/'));
    return send(res, 200, out);
  }

  // The Changes tab (mm30): the rows of one project, or of every project with "*", and one change's before and after.
  // File names, who changed them and the lines themselves: as sensitive as the files, so even a local read needs the key.
  async function changesRoute(req, res, parts, url) {
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    if (demo) throw new HttpError(403, 'demo');
    const s = await state();
    const wanted = parts[3] === '*' ? s.projects : s.projects.filter((p) => p.id === parts[3]);
    if (!wanted.length) throw new HttpError(404, 'unknown-project');
    if (parts[2] === 'change') {
      const detail = await changeDetailOf(s, wanted[0].id, url.searchParams.get('id') ?? '');
      if (!detail) throw new HttpError(404, 'unknown-change');
      return send(res, 200, { ok: true, ...detail });
    }
    const rows = wanted.flatMap((p) => changesOf(s, p.id).map((r) => ({ ...r, projectId: p.id })));
    return send(res, 200, { ok: true, rows: rows.sort((a, b) => b.ts.localeCompare(a.ts)) });
  }

  // The Flow tab (plano-v02 § v0.2.1): export, the import preview and apply, and the workshop draft. The demo answers from
  // its invented state and keeps drafts in memory; only apply writes to the project, inside its architecture folder and
  // through the project's care mode (fd14).
  const demoDrafts = new Map();
  const flowText = (body) => {
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'bad-text');
    if (body.text.length > FLOW_TEXT_MAX) throw new HttpError(413, 'too-large');
    return body.text;
  };
  // The map as it is on disk now, with the relations collect found: the baseline both the preview and apply compare against.
  // A map the state read from the main branch stays refused even if a folder appeared since: apply never guesses.
  const currentArch = async (project) => (demo || project.arch.source === 'main-branch' ? project.arch : { ...(await readArch(project.root, loadConfig(project.root, smDir), { mainBranch: project.mainBranch ?? null })), links: project.arch.links ?? [] });
  // The single model of the Flow (fl07, fl08): one build per project at a time, in the background (the build yields to
  // the server as it reads), kept in session-map's storage only. The demo has no folder: what its README declares.
  const modelRuns = new Map();
  async function flowModelOf(project) {
    if (demo) return { model: await buildFlowModel({ root: null, arch: project.arch, source: 'demo', projectId: project.id }), building: false, stale: false };
    const arch = await currentArch(project);
    const run = modelRuns.get(project.id) ?? { at: 0, model: null, running: null };
    modelRuns.set(project.id, run);
    if (run.model && !run.running && Date.now() - run.at < MODEL_FRESH_MS) return { model: run.model, building: false, stale: false };
    // side: what the view inside a part needs (fl09), kept in memory with the model, never sent with it.
    const side = {};
    run.running ??= buildFlowModel({ root: project.root, arch, smDir, projectId: project.id, source: arch.source, side })
      .then((model) => Object.assign(run, { model, side, at: Date.now() }).model)
      .catch((err) => {
        log('warn', 'flow-model-failed', { projectId: project.id, error: err.message });
        return null;
      })
      .finally(() => { run.running = null; });
    let timer;
    const done = await Promise.race([run.running, new Promise((resolve) => { timer = setTimeout(resolve, MODEL_WAIT_MS, undefined); timer.unref?.(); })]);
    clearTimeout(timer);
    if (done) return { model: done, building: false, stale: false };
    const cached = readModelCache(smDir, project.id)?.model;
    const last = run.model ?? (cached?.version === MODEL_VERSION ? cached : null);
    if (last) return { model: last, building: done === undefined, stale: true };
    const declared = await buildFlowModel({ root: null, arch, source: arch.source, projectId: project.id });
    return { model: declared, building: done === undefined, stale: false };
  }
  // Level 2 of the Flow, inside a part (fl09): made on request from the model build kept in memory and remembered per
  // part until that build or the part file changes; nothing is written. Its key changes only when the view does, so a
  // page that already has it just recolours. The colours from what the conversations changed need the key, like the
  // Changes tab (server.md), and carry only counts: titles and sessions stay in the chat routes.
  const innerMemo = new Map();
  const partFileStamp = (project, part) => {
    if (!project.root || !part?.file) return '-';
    const st = statSync(join(project.root, part.file), { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : '-';
  };
  const keyed = (req) => !demo && sameToken(cookieToken(req), token);
  async function liveFor(req, projectId, view) {
    if (!view || !keyed(req)) return null;
    let s = newest;
    if (!s) {
      let timer;
      s = await Promise.race([state().catch(() => null), new Promise((resolve) => { timer = setTimeout(resolve, MODEL_WAIT_MS, null); timer.unref?.(); })]);
      clearTimeout(timer);
    }
    if (!s) return null;
    const p = s.projects?.find((x) => x.id === projectId);
    return liveOf(view, changesOf(s, projectId), p?.chats ?? [], Date.now());
  }
  async function partRoute(req, res, project, partId, url) {
    const arch = demo ? project.arch : await currentArch(project);
    const part = programOnly(arch).parts.find((p) => p.id === partId);
    if (!part) throw new HttpError(404, 'unknown-part');
    const memo = innerMemo.get(project.id) ?? new Map();
    innerMemo.set(project.id, memo);
    if (url.searchParams.get('only') === 'live' && memo.has(partId)) {
      const hit = memo.get(partId);
      return send(res, 200, { ok: true, key: hit.key, keyed: keyed(req), live: await liveFor(req, project.id, hit.view) });
    }
    const { model, building, stale } = await flowModelOf(project);
    const run = demo ? null : modelRuns.get(project.id);
    const side = run?.side?.ready ? run.side : null;
    const stamp = JSON.stringify([model.stamp ?? null, run?.at ?? 0, Boolean(side), partFileStamp(project, part), arch.source]);
    let hit = memo.get(partId);
    if (!hit || hit.stamp !== stamp) {
      const view = partView({ root: demo ? null : project.root, arch, partId, model, side });
      const key = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
      hit = { stamp, key, view };
      memo.set(partId, hit);
    }
    const live = await liveFor(req, project.id, hit.view);
    return send(res, 200, { ok: true, view: { ...publicView(hit.view), key: hit.key }, keyed: keyed(req), live, building: Boolean(building || run?.running), stale: Boolean(stale) });
  }

  async function flowRoute(req, res, parts, url) {
    // A read is open on this PC (authorize already let only a local or keyed one in); every write needs the key.
    if (req.method !== 'GET' && !demo && !sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    // The disk copy is enough here: the map itself is read from the folder, and only the project's root and name come from the state.
    const project = (await firstAnswer()).projects.find((p) => p.id === parts[3]);
    if (!project) throw new HttpError(404, 'unknown-project');
    const route = parts.slice(4).join('/');
    if (req.method === 'GET' && route === 'mermaid') return send(res, 200, { ok: true, text: exportMermaid(await currentArch(project)) });
    if (req.method === 'GET' && route === 'model') return send(res, 200, { ok: true, ...(await flowModelOf(project)) });
    if (req.method === 'GET' && parts[4] === 'model' && parts[5] === 'part' && parts.length === 7) return partRoute(req, res, project, parts[6], url);
    if (req.method === 'POST' && route === 'mermaid/preview') {
      const plan = planImport(await currentArch(project), flowText(await readBody(req)));
      return send(res, plan.ok ? 200 : FLOW_ERRORS[plan.error] ?? 400, plan);
    }
    if (req.method === 'POST' && route === 'mermaid/apply') {
      if (demo) throw new HttpError(403, 'demo');
      const body = await readBody(req);
      const skip = Array.isArray(body?.skip) ? body.skip.filter((x) => typeof x === 'string').slice(0, SKIP_MAX) : [];
      // The project's own care mode (care.json), never one from the body: the click is the accept, look writes nothing.
      const out = applyImport({ root: project.root, arch: await currentArch(project), text: flowText(body), skip, care: { id: project.id, smDir } });
      const status = out.ok ? 200 : FLOW_ERRORS[out.error] ?? 400;
      logAction(smDir, { action: 'flow-apply', projectId: project.id, count: out.changed ? out.files.length : 0, mode: out.status }, status);
      fresh();
      return send(res, status, out);
    }
    if (route !== 'draft') throw new HttpError(404, 'not-found');
    if (req.method === 'GET') {
      const saved = demo ? demoDrafts.get(project.id) ?? null : readDraft(smDir, project.id);
      return send(res, 200, { ok: true, saved: saved !== null, text: saved ?? exportMermaid(await currentArch(project)) });
    }
    if (req.method === 'PUT') {
      const text = flowText(await readBody(req));
      if (demo) demoDrafts.set(project.id, text);
      else writeDraft(smDir, project.id, text);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (demo) demoDrafts.delete(project.id);
      else deleteDraft(smDir, project.id);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not-found');
  }

  // One GitHub round at a time, however many tabs ask.
  let catalogRun = null;
  const loadCatalog = (force, deep = false) => {
    catalogRun ??= fetchCatalog({ smDir, dir, force, deep, ...catalog }).finally(() => { catalogRun = null; });
    return catalogRun;
  };

  // look: the request came with the look-only key (sv04); the gate already let only map reads through.
  async function route(req, res, url, look = false) {
    const path = url.pathname;
    const parts = path.split('/').map((p) => decodeURIComponent(p));
    if (req.method === 'GET' && path === '/api/state') return sendState(req, res, await pollState(), look);
    // As open as the state it is made from: titles and summaries, never a token or a file.
    if (req.method === 'GET' && path === '/api/alerts') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0;
      return send(res, 200, watcher ? watcher.since(since) : { boot: 'demo', lastId: 0, alerts: [] });
    }
    // The demo is for screenshots: the real archive stays out of it.
    if (req.method === 'GET' && path === '/api/history') {
      if (demo) return send(res, 200, { results: [] });
      // One removed from session-map (mm43) leaves the history too; its archive copy stays until "Delete from history".
      const removed = readRemoved(smDir);
      const entries = readIndex(smDir).filter((e) => !isAiRunnerCwd(e.cwd, smDir) && !removed.has(e.sessionId));
      const ms = (name) => { const n = Number(url.searchParams.get(name)); return url.searchParams.get(name) && Number.isFinite(n) ? n : undefined; };
      return send(res, 200, { results: searchIndex(entries, url.searchParams.get('q') ?? '', { project: url.searchParams.get('project') ?? undefined, limit: 20, from: ms('from'), to: ms('to') }) });
    }
    // Every reply with what it read and did is as private as the chats: the page's token only, never the look-only key.
    if (isStatementPath(path)) {
      const allowed = !statements ? { ok: false, status: 403, error: 'demo' } : look ? { ok: false, status: 403, error: 'look-only' }
        : sameToken(cookieToken(req), token) ? { ok: true } : { ok: false, status: 401, error: 'token-required' };
      return statementRoute({ store: statements, send, HttpError }, req, res, url, allowed);
    }
    if (req.method === 'POST' && parts[1] === 'api' && parts[2] === 'conversation' && parts[4] === 'place' && parts.length === 5) return placeRoute(req, res, parts[3]);
    if (parts[1] === 'api' && parts[2] === 'cards') {
      if (look) throw new HttpError(403, 'look-only');
      return cardsRoute(req, res, parts);
    }
    if (req.method === 'DELETE' && parts[1] === 'api' && parts[2] === 'conversation' && parts.length === 4) {
      if (!UUID_RE.test(parts[3])) throw new HttpError(400, 'bad-session');
      if (demo || !deleteArchived(smDir, parts[3])) throw new HttpError(404, 'unknown-session');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && parts[1] === 'api' && parts[2] === 'conversation' && parts.length === 4) {
      const id = parts[3];
      if (!UUID_RE.test(id)) throw new HttpError(400, 'bad-session');
      if (demo) throw new HttpError(404, 'unknown-session');
      // With every step's input and output (files it read, commands it ran) it is as sensitive as the chat: token only.
      if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
      const entry = readRemoved(smDir).has(id) ? null : readIndex(smDir).find((e) => e.sessionId === id);
      const messages = entry && !isAiRunnerCwd(entry.cwd, smDir) ? readArchived(smDir, id) : [];
      if (!messages.length) throw new HttpError(404, 'unknown-session');
      const { items, costUSD } = readConversation(archivedPath(smDir, id), { cwd: entry.cwd ?? '' });
      return send(res, 200, { sessionId: id, title: entry.title, messages, items, costUSD });
    }
    // An image of an archived conversation (mm22), also after Claude Code deleted it: as sensitive as the chat itself.
    if (req.method === 'GET' && parts[1] === 'api' && parts[2] === 'conversation' && parts[4] === 'image' && parts.length === 6) {
      if (demo) throw new HttpError(404, 'not-found');
      if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
      // One removed from session-map (mm43) shows nowhere, its images neither.
      const file = UUID_RE.test(parts[3]) && !readRemoved(smDir).has(parts[3]) ? archivedPath(smDir, parts[3]) : null;
      const found = file && /^\d{1,6}$/.test(parts[5]) ? readImage(file, Number(parts[5])) : null;
      if (!found || !IMAGE_TYPES.has(found.media)) throw new HttpError(404, 'not-found');
      res.writeHead(200, { 'content-type': found.media, 'cache-control': 'private, max-age=86400' });
      return res.end(found.data);
    }
    if (req.method === 'GET' && path === '/api/catalog') {
      if (demo) throw new HttpError(403, 'demo');
      // A refetch spends the user's GitHub quota: only a page that holds the token may ask for one.
      const refresh = url.searchParams.get('refresh') === '1' && sameToken(cookieToken(req), token);
      const { items, ...meta } = await loadCatalog(refresh);
      const query = Object.fromEntries(['sort', 'type', 'category', 'q'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      return send(res, 200, { ...meta, total: items.length, items: markInstalled(filterCatalog(items, query), dir) });
    }
    if (req.method === 'POST' && path === '/api/action') {
      if (demo) throw new HttpError(403, 'demo');
      const body = await readBody(req);
      // Archive or delete of a conversation the newest finished state already holds answers at once: they must not wait for
      // a collect of every project. One born since then, and open or close, wait for the next collect.
      const quick = await quickState();
      const current = listActionOn(quick, body) ? quick : await state();
      const result = await runAction(body, { state: current, dir, smDir, driving: chat?.drivingIds?.() ?? new Set(), closeIdle: chat?.closeIdle, exec: catalog.exec, bin: catalog.bin });
      fresh();
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && parts[1] === 'api' && (parts[2] === 'files' || parts[2] === 'file') && parts.length === 4) return filesRoute(req, res, parts, url);
    if (req.method === 'GET' && parts[1] === 'api' && (parts[2] === 'changes' || (parts[2] === 'change' && parts[3] !== '*')) && parts.length === 4) return changesRoute(req, res, parts, url);
    if (parts[1] === 'api' && parts[2] === 'chat') return chatRoute(req, res, parts, url);
    if (parts[1] === 'api' && parts[2] === 'arch' && parts.length >= 5) {
      // A second lock behind the gate: the look-only key reads the Flow's model, never the draft or the export.
      if (look && !(req.method === 'GET' && parts[4] === 'model' && (parts.length === 5 || (parts[5] === 'part' && parts.length === 7)))) throw new HttpError(403, 'look-only');
      return flowRoute(req, res, parts, url);
    }
    if (parts[1] === 'api' && (parts[2] === 'foundation' || (parts[2] === 'library' && parts.length === 3))) return foundationRoute(req, res, url);
    if (path === '/api/settings/permission-mode') return settingsRoute(req, res);
    if (path === '/api/settings/reinforced-limit') return limitRoute(req, res);
    if (path === '/api/settings/project-background') return backgroundRoute(req, res);
    if (path === '/api/settings/project-tidy') return tidyRoute(req, res, url);
    if (path === '/api/settings/project-budget') return budgetRoute(req, res);
    if (path === '/api/projects/new') return newProjectRoute(req, res);
    if (path === '/api/settings/notify' || path === '/api/settings/notify/test') return notifyRoute(req, res, path);
    if (path === '/api/settings/ai-helpers' || path === '/api/settings/ai-helpers/test') return helpersRoute(req, res, path, url);
    if (path === '/api/settings/look-key') return lookRoute(req, res);
    if (path === '/api/restart') return restartRoute(req, res);
    if (askRoutes.handles(path)) {
      const r = await askRoutes.handle(req, url, addressOf(req));
      return send(res, r.status, r.body, r.headers);
    }
    if (req.method === 'GET' && !path.startsWith('/api/')) return serveFile(res, path);
    throw new HttpError(404, 'not-found');
  }

  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    // The first link carries ?k=: it must not leak to other sites through the Referer.
    res.setHeader('referrer-policy', 'no-referrer');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, 'bad request');
    }
    const auth = askRoutes.authorizeHeader(req, url, addressOf(req))
      ?? (url.pathname === '/api/restart' ? headerAuth(req, addressOf(req), token) : null)
      ?? authorize(req, url, { token, look: lookKey, address: addressOf(req) });
    if (auth.status === 302) return send(res, 302, '', { location: auth.location, 'set-cookie': auth.cookie });
    if (auth.status !== 200) return send(res, auth.status, auth.status === 401 ? 'token required' : 'forbidden');
    // The look-only key (sv04) reads the map and nothing else, by an allow-list: a route not on it is refused here,
    // before any of them runs. The mark tells the page to hide the chat and the buttons.
    if (auth.look) {
      res.setHeader('x-look-only', '1');
      if (!lookAllows(req.method, url.pathname)) return send(res, 403, 'forbidden');
    }
    try {
      await route(req, res, url, Boolean(auth.look));
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      if (err instanceof URIError || /^invalid project id/.test(err.message)) return send(res, 400, { ok: false, error: 'bad-path' });
      log('error', 'request-failed', { path: url.pathname, error: err.message });
      if (!res.headersSent) send(res, 500, { ok: false, error: 'internal' });
    }
  });
  server.watcher = watcher;
  // The 5-minute sweep reads every project's code again (one round at a time per project); the demo reads nothing.
  // A sweep still running when the next one is due is shared, never doubled. It reads the newest state at once instead
  // of waiting for a new collect.
  let sweeping = null;
  server.refreshFoundations = () => {
    if (demo) return Promise.resolve();
    sweeping ??= (async () => {
      try {
        // Only where the person works now, or where they asked for it: a project nobody touches is left alone.
        for (const project of sweepable((await quickState()).projects)) await refreshFoundation(project, smDir);
      } catch (err) {
        log('warn', 'foundation-sweep-failed', { error: err.message });
      }
    })().finally(() => { sweeping = null; });
    return sweeping;
  };
  // Discover keeps itself up to date: the same sweep asks, the catalog's 24 h cache decides if GitHub is called. The demo has no network.
  const catalogRefresher = createCatalogRefresher({ load: loadCatalog });
  server.refreshCatalog = () => (demo ? Promise.resolve() : catalogRefresher.refresh());
  // The agreed restart (sv13). The port is let go for the copy: an open page's event stream would hold it, so every
  // connection is closed with it.
  const closeHttp = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  const restarter = demo || !chat || !smDir ? null : createRestarter({ hub: chat, smDir, closeServer: closeHttp, onAlert: (a) => watcher?.push([a]), ...restart });
  // after: the new server listens. Called once by start(), never in the demo.
  server.resumeAfterRestart = (after) => (restarter
    ? resumeAfterRestart({ smDir, hub: chat, readState: state, onAlert: (a) => watcher?.push([a]), resuming: resumed, after })
    : Promise.resolve(null));
  // The orchestrator's tidy scheduler (or18), every 5 minutes: started by start() only, never in a test's app.
  server.startOrchestra = () => chat?.orchestra?.start?.();
  // The version watch (or15), started by start() only: a look 30 s after the start, then every hour. The once-a-day rule
  // per provider decides whether a request is really made.
  server.startVersionWatch = () => {
    if (!versionWatch) return;
    const look = () => checkVersions().catch((err) => log('warn', 'ai-versions-failed', { error: err.message }));
    setTimeout(look, VERSIONS_FIRST_MS).unref();
    setInterval(look, VERSIONS_EVERY_MS).unref();
  };
  server.on('close', () => watcher?.stop());
  return server;
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

export function start(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '4001' }, lan: { type: 'boolean', default: false }, demo: { type: 'boolean', default: false }, dir: { type: 'string' } },
  });
  const port = Number.parseInt(values.port, 10);
  const dir = values.dir ?? claudeDir();
  const smDir = join(claudeDir(), 'session-map');
  const token = values.demo ? randomBytes(32).toString('hex') : loadToken(smDir);
  const ip = values.lan && lanAddress();
  const app = createApp({ dir, smDir, demo: values.demo, token, baseUrl: `http://127.0.0.1:${port}`, lanUrl: ip ? `http://${ip}:${port}` : null });
  const host = values.lan ? '0.0.0.0' : '127.0.0.1';
  // A copy started by the agreed restart (sv13) waits a moment for the old process to free the port. The mark is
  // dropped at once, so no claude this server starts inherits it.
  const restarted = process.env.SM_RESTARTED === '1';
  delete process.env.SM_RESTARTED;
  const listening = new Promise((resolve) => app.once('listening', resolve));
  app.once('listening', () => {
    // The person's own terminal: the links carry the token, the only way a page gets the cookie it needs to write.
    const links = { local: `http://127.0.0.1:${port}/?k=${token}` };
    if (ip) links.lan = `http://${ip}:${port}/?k=${token}`;
    log('info', 'listening', links);
  });
  listenWithRetry(app, { port, host, retryMs: restarted ? LISTEN_RETRY_MS : 0 });
  if (!values.demo) {
    app.resumeAfterRestart(listening).catch((err) => log('warn', 'restart-resume-failed', { error: err.message }));
    const sweep = () => {
      try {
        archiveAll(dir, smDir);
      } catch (err) {
        log('warn', 'archive-sweep-failed', { error: err.message });
      }
      app.refreshFoundations();
      app.refreshCatalog();
    };
    setTimeout(sweep, 10_000).unref();
    setInterval(sweep, SWEEP_MS).unref();
    app.watcher.start(WATCH_MS);
    app.startOrchestra();
    app.startVersionWatch();
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
