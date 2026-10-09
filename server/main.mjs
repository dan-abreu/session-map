import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { logAction, runAction } from './actions.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { archiveAll, deleteArchived, readArchived, readIndex, searchIndex } from './archive.mjs';
import { authorize, cookieToken, loadToken, sameToken } from './auth.mjs';
import { createChatHub } from './chat/hub.mjs';
import { setUserMode, undoUserMode, userModeState } from './chat/mode.mjs';
import { collect } from './collect.mjs';
import { listFiles, mergeBaseOf, readFileForView } from './files.mjs';
import { log } from './log.mjs';
import { fetchCatalog, filterCatalog, markInstalled } from './sources/catalog.mjs';
import { claudeDir } from './sources/claude.mjs';
import { readJsonFile, writeAtomic } from './store.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(here, 'web');
const DEMO_STATE = join(here, '..', 'demo', 'state.json');
const STATE_TTL_MS = 3000;
const STATE_SAVE_MS = 60_000;
// Reading the transcripts holds the event loop for a while: the copy's bytes leave the socket first.
const COLLECT_AFTER_COPY_MS = 300;
const SWEEP_MS = 5 * 60_000;
const BODY_MAX = 64 * 1024;
const FILE_ERRORS = { 'bad-path': 400, sensitive: 403, 'not-found': 404, 'too-large': 413, binary: 415 };
const MODE_ERRORS = { 'bad-mode': 400, 'nothing-to-undo': 404, 'settings-unreadable': 409 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX) throw new HttpError(413, 'too-large');
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

// collectFn, ai and catalog ({token, fetchFn, exec, bin}) are replaceable for tests; addressOf stands in for the socket's remote address.
// The demo never writes to the user's disk, so its token lives only in memory.
export function createApp({
  dir = claudeDir(), smDir, demo = false, token = demo ? randomBytes(32).toString('hex') : loadToken(smDir),
  collectFn = collect, ai, addressOf = (req) => req.socket.remoteAddress, chat = demo ? null : createChatHub({ smDir, dir }),
  catalog = {}, stateTtlMs = STATE_TTL_MS,
} = {}) {
  // The last good state on disk: a restart answers with it at once while the first collect (up to a minute) runs.
  const stateCopy = smDir ? join(smDir, 'state-cache.json') : null;
  let ready = false;
  let savedAt = 0;
  let cached = null;
  const state = () => {
    // A collect still running is shared, whatever its age: a second one would only slow both down.
    if (!cached || (cached.done && Date.now() - cached.at > stateTtlMs)) {
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
      const result = await chat.start(await readBody(req), await state());
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && key === 'list' && parts.length === 4) {
      const query = Object.fromEntries(['projectId', 'partId', 'workCellId', 'code', 'kind'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      const result = chat.list(query, await state());
      return send(res, result.status, result.body);
    }
    if (req.method === 'GET' && key === 'history' && parts.length === 5) {
      const result = chat.history(verb);
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
    if (req.method !== 'POST' || !['send', 'permission', 'mode', 'stop'].includes(verb)) throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    const result = verb === 'stop' ? chat.stop(key) : chat[verb](key, body);
    return send(res, result.status, result.body);
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

  // Reading project files is as sensitive as the chat: even a local read needs the token.
  async function filesRoute(req, res, parts, url) {
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const project = await projectOf(parts[3]);
    const param = (name) => url.searchParams.get(name);
    const cell = param('workCell') === null ? null : project.workCells.find((w) => w.id === param('workCell'));
    if (cell === undefined) throw new HttpError(404, 'unknown-front');
    if (parts[2] === 'files') {
      if (param('part') !== null) {
        const part = project.arch.parts.find((p) => p.id === param('part'));
        if (!part) throw new HttpError(404, 'unknown-part');
        const marks = new Map(project.workCells.filter((w) => w.partId === part.id).flatMap((w) => w.files.map((f) => [f.path, { status: f.status, workCell: w.id }])));
        const paths = [...new Set([...await listFiles(project.root, [...part.codePaths, part.file]), ...marks.keys()])].sort();
        return send(res, 200, { ok: true, files: paths.map((path) => ({ path, status: null, ...marks.get(path) })) });
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
    return send(res, 200, out);
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
    // The demo is for screenshots: the real archive stays out of it.
    if (req.method === 'GET' && path === '/api/history') {
      if (demo) return send(res, 200, { results: [] });
      const entries = readIndex(smDir).filter((e) => !isAiRunnerCwd(e.cwd, smDir));
      return send(res, 200, { results: searchIndex(entries, url.searchParams.get('q') ?? '', { project: url.searchParams.get('project') ?? undefined, limit: 20 }) });
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
      const entry = readIndex(smDir).find((e) => e.sessionId === id);
      const messages = entry && !isAiRunnerCwd(entry.cwd, smDir) ? readArchived(smDir, id) : [];
      if (!messages.length) throw new HttpError(404, 'unknown-session');
      return send(res, 200, { sessionId: id, title: entry.title, messages });
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
    if (parts[1] === 'api' && parts[2] === 'chat') return chatRoute(req, res, parts, url);
    if (path === '/api/settings/permission-mode') return settingsRoute(req, res);
    if (req.method === 'GET' && !path.startsWith('/api/')) return serveFile(res, path);
    throw new HttpError(404, 'not-found');
  }

  return createServer(async (req, res) => {
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
  const app = createApp({ dir, smDir, demo: values.demo, token });
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
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
