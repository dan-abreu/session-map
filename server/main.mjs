import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { logAction, runAction } from './actions.mjs';
import { createDelivery, toastCommand } from './alerts/deliver.mjs';
import { notifyPrefs, setNotifyPrefs } from './alerts/prefs.mjs';
import { createWatcher } from './alerts/watcher.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { changeDetailOf, changesOf } from './changes-state.mjs';
import { archiveAll, archivedPath, deleteArchived, readArchived, readIndex, searchIndex } from './archive.mjs';
import { readConversation, readImage } from './sources/claude-conversation.mjs';
import { applyImport, deleteDraft, exportMermaid, planImport, readDraft, writeDraft } from './arch/flow.mjs';
import { readArch } from './arch/detect.mjs';
import { authorize, cookieToken, loadToken, sameToken } from './auth.mjs';
import { createChatHub } from './chat/hub.mjs';
import { setUserMode, undoUserMode, userModeState } from './chat/mode.mjs';
import { reinforcedLimit, reinforcedSpend, setReinforcedLimit } from './chat/run.mjs';
import { collect } from './collect.mjs';
import { loadConfig } from './config.mjs';
import { findFiles, listFiles, mergeBaseOf, readFileForView } from './files.mjs';
import { linksOf } from './imports.mjs';
import { log } from './log.mjs';
import { fetchCatalog, filterCatalog, markInstalled } from './sources/catalog.mjs';
import { claudeDir } from './sources/claude.mjs';
import { countRepo } from './sources/count.mjs';
import { setPlacement } from './placements.mjs';
import { readJsonFile, writeAtomic } from './store.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(here, 'web');
const DEMO_STATE = join(here, '..', 'demo', 'state.json');
const STATE_TTL_MS = 3000;
const STATE_SAVE_MS = 60_000;
// Reading the transcripts holds the event loop for a while: the copy's bytes leave the socket first.
const COLLECT_AFTER_COPY_MS = 300;
const SWEEP_MS = 5 * 60_000;
// How often the watcher looks at every session on the PC, page open or not.
const WATCH_MS = 10_000;
const BODY_MAX = 64 * 1024;
// A chat message may carry pasted images (four of about 3.7 MB each).
const CHAT_BODY_MAX = 24 * 1024 * 1024;
const FILE_ERRORS = { 'bad-path': 400, sensitive: 403, 'not-found': 404, 'too-large': 413, binary: 415 };
const MODE_ERRORS = { 'bad-mode': 400, 'nothing-to-undo': 404, 'settings-unreadable': 409 };
const LIMIT_ERRORS = { 'bad-limit': 400, 'config-unreadable': 409 };
const NOTIFY_ERRORS = { 'bad-notify': 400, 'config-unreadable': 409 };
const FLOW_ERRORS = { 'not-flowchart': 400, 'empty-flowchart': 400, 'fence-in-drawing': 400, 'bad-path': 400, 'arch-not-here': 409, 'no-arch': 409 };
const FLOW_TEXT_MAX = 60_000;
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

// collectFn, ai, catalog ({token, fetchFn, exec, bin}) and deliver (the desktop and phone alerts) are replaceable for tests;
// addressOf stands in for the socket's remote address. baseUrl: where a click on a desktop alert opens the page.
// The demo never writes to the user's disk, so its token lives only in memory.
export function createApp({
  dir = claudeDir(), smDir, demo = false, token = demo ? randomBytes(32).toString('hex') : loadToken(smDir),
  collectFn = collect, ai, addressOf = (req) => req.socket.remoteAddress, chat: chatHub,
  catalog = {}, stateTtlMs = STATE_TTL_MS, baseUrl = 'http://127.0.0.1:4001', deliver = createDelivery({ baseUrl }),
} = {}) {
  let watcher = null;
  const chat = chatHub !== undefined ? chatHub : demo ? null : createChatHub({ smDir, dir, onAlert: (a) => watcher?.push([a]) });
  // The last good state on disk: a restart answers with it at once while the first collect (up to a minute) runs.
  const stateCopy = smDir ? join(smDir, 'state-cache.json') : null;
  let ready = false;
  let savedAt = 0;
  let cached = null;
  const state = () => {
    // A collect still running is shared, whatever its age: a second one would only slow both down.
    if (!cached || (cached.done && Date.now() - cached.at >= stateTtlMs)) {
      const promise = demo
        ? readFile(DEMO_STATE, 'utf8').then(JSON.parse)
        : Promise.resolve(collectFn({ dir, smDir, ...(ai ? { ai } : {}) }));
      const entry = { at: Date.now(), promise, done: false };
      cached = entry;
      promise.then((s) => {
        Object.assign(entry, { done: true, at: Date.now() });
        ready = true;
        if (!demo && stateCopy && Date.now() - savedAt >= STATE_SAVE_MS) {
          savedAt = Date.now();
          try { writeAtomic(stateCopy, JSON.stringify(s)); } catch (err) { log('warn', 'state-copy-failed', { error: err.message }); }
        }
      }, () => { if (cached === entry) cached = null; });
    }
    return cached.promise;
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
  const prefsNow = () => notifyPrefs(readJsonFile(join(smDir, 'config.json'), {}) ?? {});
  watcher = demo ? null : createWatcher({
    readState: state, deliver, prefs: prefsNow,
    skip: () => chat?.drivenIds?.() ?? new Set(),
    startup: (s) => chat?.interrupted?.(s) ?? [],
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
    if (req.method === 'GET' && key === 'list' && parts.length === 4) {
      const query = Object.fromEntries(['projectId', 'partId', 'workCellId', 'code', 'kind'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      const result = chat.list(query, await state());
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && key === 'history' && parts.length === 5) {
      const result = chat.history(verb, await state(), { since: url.searchParams.get('since') ?? undefined });
      return send(res, result.status, result.body);
    }
    // An image of a conversation (mm22): only the image kinds a browser shows, never anything it could run.
    if (req.method === 'GET' && key === 'image' && parts.length === 6) {
      const n = /^\d{1,6}$/.test(parts[5]) ? Number(parts[5]) : -1;
      const found = chat.image(verb, n, await state());
      if (!found || !IMAGE_TYPES.has(found.media)) throw new HttpError(404, 'not-found');
      res.writeHead(200, { 'content-type': found.media, 'cache-control': 'private, max-age=86400' });
      return res.end(found.data);
    }
    if (req.method === 'GET' && key === 'helper' && parts.length === 6) {
      const result = chat.helper(verb, parts[5], await state());
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

  // Reading project files is as sensitive as the chat: even a local read needs the token.
  async function filesRoute(req, res, parts, url) {
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const project = await projectOf(parts[3]);
    const param = (name) => url.searchParams.get(name);
    const cell = param('workCell') === null ? null : project.workCells.find((w) => w.id === param('workCell'));
    if (cell === undefined) throw new HttpError(404, 'unknown-front');
    if (parts[2] === 'files') {
      if (param('find') !== null) return send(res, 200, { ok: true, files: await findFiles(project.root, param('find').slice(0, 200)) });
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
  // its invented state and keeps drafts in memory; only apply writes to the project, inside its architecture folder.
  const demoDrafts = new Map();
  const flowText = (body) => {
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'bad-text');
    if (body.text.length > FLOW_TEXT_MAX) throw new HttpError(413, 'too-large');
    return body.text;
  };
  // The map as it is on disk now, with the relations collect found: the baseline both the preview and apply compare against.
  // A map the state read from the main branch stays refused even if a folder appeared since: apply never guesses.
  const currentArch = async (project) => (demo || project.arch.source === 'main-branch' ? project.arch : { ...(await readArch(project.root, loadConfig(project.root, smDir), { mainBranch: project.mainBranch ?? null })), links: project.arch.links ?? [] });
  async function flowRoute(req, res, parts) {
    // A read is open on this PC (authorize already let only a local or keyed one in); every write needs the key.
    if (req.method !== 'GET' && !demo && !sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    // The disk copy is enough here: the map itself is read from the folder, and only the project's root and name come from the state.
    const project = (await firstAnswer()).projects.find((p) => p.id === parts[3]);
    if (!project) throw new HttpError(404, 'unknown-project');
    const route = parts.slice(4).join('/');
    if (req.method === 'GET' && route === 'mermaid') return send(res, 200, { ok: true, text: exportMermaid(await currentArch(project)) });
    if (req.method === 'POST' && route === 'mermaid/preview') {
      const plan = planImport(await currentArch(project), flowText(await readBody(req)));
      return send(res, plan.ok ? 200 : FLOW_ERRORS[plan.error] ?? 400, plan);
    }
    if (req.method === 'POST' && route === 'mermaid/apply') {
      if (demo) throw new HttpError(403, 'demo');
      const body = await readBody(req);
      const skip = Array.isArray(body?.skip) ? body.skip.filter((x) => typeof x === 'string').slice(0, SKIP_MAX) : [];
      const out = applyImport({ root: project.root, arch: await currentArch(project), text: flowText(body), skip });
      const status = out.ok ? 200 : FLOW_ERRORS[out.error] ?? 400;
      logAction(smDir, { action: 'flow-apply', projectId: project.id, count: out.files?.length ?? 0 }, status);
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
  const loadCatalog = (force) => {
    catalogRun ??= fetchCatalog({ smDir, dir, force, ...catalog }).finally(() => { catalogRun = null; });
    return catalogRun;
  };

  async function route(req, res, url) {
    const path = url.pathname;
    const parts = path.split('/').map((p) => decodeURIComponent(p));
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, await firstAnswer());
    // As open as the state it is made from: titles and summaries, never a token or a file.
    if (req.method === 'GET' && path === '/api/alerts') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0;
      return send(res, 200, watcher ? watcher.since(since) : { boot: 'demo', lastId: 0, alerts: [] });
    }
    // The demo is for screenshots: the real archive stays out of it.
    if (req.method === 'GET' && path === '/api/history') {
      if (demo) return send(res, 200, { results: [] });
      const entries = readIndex(smDir).filter((e) => !isAiRunnerCwd(e.cwd, smDir));
      const ms = (name) => { const n = Number(url.searchParams.get(name)); return url.searchParams.get(name) && Number.isFinite(n) ? n : undefined; };
      return send(res, 200, { results: searchIndex(entries, url.searchParams.get('q') ?? '', { project: url.searchParams.get('project') ?? undefined, limit: 20, from: ms('from'), to: ms('to') }) });
    }
    if (req.method === 'POST' && parts[1] === 'api' && parts[2] === 'conversation' && parts[4] === 'place' && parts.length === 5) return placeRoute(req, res, parts[3]);
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
      const entry = readIndex(smDir).find((e) => e.sessionId === id);
      const messages = entry && !isAiRunnerCwd(entry.cwd, smDir) ? readArchived(smDir, id) : [];
      if (!messages.length) throw new HttpError(404, 'unknown-session');
      const { items, costUSD } = readConversation(archivedPath(smDir, id), { cwd: entry.cwd ?? '' });
      return send(res, 200, { sessionId: id, title: entry.title, messages, items, costUSD });
    }
    // An image of an archived conversation (mm22), also after Claude Code deleted it: as sensitive as the chat itself.
    if (req.method === 'GET' && parts[1] === 'api' && parts[2] === 'conversation' && parts[4] === 'image' && parts.length === 6) {
      if (demo) throw new HttpError(404, 'not-found');
      if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
      const file = UUID_RE.test(parts[3]) ? archivedPath(smDir, parts[3]) : null;
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
      const result = await runAction(await readBody(req), { state: await state(), dir, smDir, exec: catalog.exec, bin: catalog.bin });
      fresh();
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && parts[1] === 'api' && (parts[2] === 'files' || parts[2] === 'file') && parts.length === 4) return filesRoute(req, res, parts, url);
    if (req.method === 'GET' && parts[1] === 'api' && (parts[2] === 'changes' || (parts[2] === 'change' && parts[3] !== '*')) && parts.length === 4) return changesRoute(req, res, parts, url);
    if (parts[1] === 'api' && parts[2] === 'chat') return chatRoute(req, res, parts, url);
    if (parts[1] === 'api' && parts[2] === 'arch' && parts.length >= 5) return flowRoute(req, res, parts);
    if (path === '/api/settings/permission-mode') return settingsRoute(req, res);
    if (path === '/api/settings/reinforced-limit') return limitRoute(req, res);
    if (path === '/api/settings/notify' || path === '/api/settings/notify/test') return notifyRoute(req, res, path);
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
    const auth = authorize(req, url, { token, address: addressOf(req) });
    if (auth.status === 302) return send(res, 302, '', { location: auth.location, 'set-cookie': auth.cookie });
    if (auth.status !== 200) return send(res, auth.status, auth.status === 401 ? 'token required' : 'forbidden');
    try {
      await route(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      if (err instanceof URIError || /^invalid project id/.test(err.message)) return send(res, 400, { ok: false, error: 'bad-path' });
      log('error', 'request-failed', { path: url.pathname, error: err.message });
      if (!res.headersSent) send(res, 500, { ok: false, error: 'internal' });
    }
  });
  server.watcher = watcher;
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
  const app = createApp({ dir, smDir, demo: values.demo, token, baseUrl: `http://127.0.0.1:${port}` });
  const host = values.lan ? '0.0.0.0' : '127.0.0.1';
  app.listen(port, host, () => {
    // The person's own terminal: the links carry the token, the only way a page gets the cookie it needs to write.
    const links = { local: `http://127.0.0.1:${port}/?k=${token}` };
    const ip = values.lan && lanAddress();
    if (ip) links.lan = `http://${ip}:${port}/?k=${token}`;
    log('info', 'listening', links);
  });
  if (!values.demo) {
    const sweep = () => {
      try {
        archiveAll(dir, smDir);
      } catch (err) {
        log('warn', 'archive-sweep-failed', { error: err.message });
      }
    };
    setTimeout(sweep, 10_000).unref();
    setInterval(sweep, SWEEP_MS).unref();
    app.watcher.start(WATCH_MS);
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
