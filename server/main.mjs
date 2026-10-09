import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runAction } from './actions.mjs';
import { cleanTags, newUnit, normalizeUnit } from './ai/perceive.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { archiveAll, deleteArchived, readArchived, readIndex, searchIndex } from './archive.mjs';
import { authorize, cookieToken, loadToken, sameToken } from './auth.mjs';
import { UNSORTED, brainDir, readJsonFile, setOverride, writeUnits } from './brain/cells.mjs';
import { emptyNucleus, readNucleus, writeNucleus } from './brain/nucleus.mjs';
import { createChatHub } from './chat/hub.mjs';
import { collect } from './collect.mjs';
import { log } from './log.mjs';
import { fetchCatalog, filterCatalog, markInstalled } from './sources/catalog.mjs';
import { claudeDir } from './sources/claude.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(here, 'web');
const DEMO_STATE = join(here, '..', 'demo', 'state.json');
const STATE_TTL_MS = 3000;
const SWEEP_MS = 5 * 60_000;
const BODY_MAX = 64 * 1024;
const NAME_MAX = 40;
const LEVEL_RANK = { cell: 0, tissue: 1, organ: 2 };
const NUCLEUS_ITEMS_MAX = 50;
const NUCLEUS_TEXT_MAX = 1000;
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

const isText = (v, max) => typeof v === 'string' && v.length <= max;
const isTextList = (v) => Array.isArray(v) && v.length <= NUCLEUS_ITEMS_MAX && v.every((s) => isText(s, NUCLEUS_TEXT_MAX));
const cleanName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

// The page's own edits: whatever the person names, merges or creates is pinned, so the AI leaves it alone.
// Returns the new list, or null when the request does not fit the tree.
export function editUnits(units, op, now) {
  const next = units.map(normalizeUnit);
  const byId = new Map(next.map((u) => [u.id, u]));
  const editable = (id) => typeof id === 'string' && id !== UNSORTED && byId.has(id);
  switch (op?.op) {
    case 'rename': {
      const name = cleanName(op.name);
      if (!editable(op.id) || !name) return null;
      Object.assign(byId.get(op.id), { name, pinned: true });
      return next;
    }
    case 'pin':
      if (!editable(op.id) || typeof op.pinned !== 'boolean') return null;
      byId.get(op.id).pinned = op.pinned;
      return next;
    case 'merge': {
      const ids = Array.isArray(op.ids) ? [...new Set(op.ids)] : [];
      if (!editable(op.into) || !ids.length || ids.includes(op.into) || !ids.every(editable)) return null;
      const into = byId.get(op.into);
      for (const id of ids) {
        const gone = byId.get(id);
        into.chatIds = [...new Set([...into.chatIds, ...gone.chatIds])];
        into.paths = [...new Set([...into.paths, ...gone.paths])];
        into.tags = cleanTags([...into.tags, ...gone.tags]);
        for (const u of next) if (u.parentId === id) u.parentId = into.id;
      }
      into.pinned = true;
      return next.filter((u) => !ids.includes(u.id));
    }
    case 'move': {
      const { parentId } = op;
      if (!editable(op.id) || parentId === undefined || (parentId !== null && !editable(parentId))) return null;
      const unit = byId.get(op.id);
      // Levels stay strict: a unit only sits inside a higher level, which also rules out cycles.
      if (parentId !== null && LEVEL_RANK[byId.get(parentId).level] <= LEVEL_RANK[unit.level]) return null;
      Object.assign(unit, { parentId, pinned: true });
      return next;
    }
    case 'create': {
      const name = cleanName(op.name);
      const parentId = op.parentId ?? null;
      if (!name || (parentId !== null && !editable(parentId))) return null;
      return [...next, { ...newUnit(next, { name, purpose: '', tags: [], parentId }, now), origin: 'user', pinned: true }];
    }
    default:
      return null;
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
  collectFn = collect, ai, addressOf = (req) => req.socket.remoteAddress, chat = demo ? null : createChatHub({ smDir }),
  catalog = {},
} = {}) {
  let cached = null;
  const state = () => {
    if (!cached || Date.now() - cached.at > STATE_TTL_MS) {
      const promise = demo
        ? readFile(DEMO_STATE, 'utf8').then(JSON.parse)
        : Promise.resolve(collectFn({ dir, smDir, ...(ai ? { ai } : {}) }));
      cached = { at: Date.now(), promise };
      promise.catch(() => { cached = null; });
    }
    return cached.promise;
  };
  const fresh = () => { cached = null; };

  const projectOf = async (projectId) => {
    if (demo) throw new HttpError(403, 'demo');
    const project = (await state()).projects.find((p) => p.id === projectId);
    if (!project) throw new HttpError(404, 'unknown-project');
    return project;
  };
  const unitOf = (project, unitId) => {
    const unit = project.units.find((u) => u.id === unitId);
    if (!unit) throw new HttpError(404, 'unknown-unit');
    return unit;
  };

  // Runs code on this PC by design: even a local read of a chat needs the token (desenho-2 § 22).
  async function chatRoute(req, res, parts) {
    if (!chat) throw new HttpError(403, 'demo');
    if (!sameToken(cookieToken(req), token)) throw new HttpError(401, 'token-required');
    const [, , , key, verb] = parts;
    if (req.method === 'POST' && key === 'start' && parts.length === 4) {
      const result = await chat.start(await readBody(req), await state());
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
    if (req.method !== 'POST' || !['send', 'permission', 'stop'].includes(verb)) throw new HttpError(404, 'not-found');
    const body = await readBody(req);
    const result = verb === 'stop' ? chat.stop(key) : chat[verb](key, body);
    return send(res, result.status, result.body);
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
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, await state());
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
    if (parts[1] === 'api' && parts[2] === 'nucleus' && parts.length === 5 && (req.method === 'GET' || req.method === 'PUT')) {
      const project = await projectOf(parts[3]);
      const unit = unitOf(project, parts[4]);
      if (req.method === 'GET') return send(res, 200, readNucleus(smDir, project.id, unit.id) ?? unit.nucleus ?? emptyNucleus());
      const body = await readBody(req);
      if (!body || !isText(body.state, NUCLEUS_TEXT_MAX) || !isTextList(body.decided) || !isTextList(body.todo)) throw new HttpError(400, 'bad-nucleus');
      const current = readNucleus(smDir, project.id, unit.id) ?? unit.nucleus ?? emptyNucleus();
      writeNucleus(smDir, project.id, unit.id, { state: body.state, decided: body.decided, todo: body.todo, recent: current.recent ?? [] });
      fresh();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && parts[1] === 'api' && (parts[2] === 'units' || parts[2] === 'cells') && parts.length === 4) {
      const project = await projectOf(parts[3]);
      const body = await readBody(req);
      const file = join(brainDir(smDir, project.id), 'units.json');
      const stored = readJsonFile(file, null);
      const units = Array.isArray(stored) && stored.length ? stored : project.units.map(({ nucleus, workCellIds, work, status, ...u }) => u);
      const next = editUnits(units, body, new Date().toISOString());
      if (!next) throw new HttpError(400, 'bad-edit');
      writeUnits(smDir, project.id, next);
      fresh();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/override') {
      const body = await readBody(req);
      const project = await projectOf(body?.projectId);
      if (typeof body.sessionId !== 'string' || !project.chats.some((c) => c.sessionId === body.sessionId)) throw new HttpError(404, 'unknown-session');
      if (body.unitId !== null) unitOf(project, body.unitId);
      setOverride(smDir, project.id, body.sessionId, body.unitId);
      fresh();
      return send(res, 200, { ok: true });
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
    if (parts[1] === 'api' && parts[2] === 'chat') return chatRoute(req, res, parts);
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
      if (err instanceof URIError || /^invalid (project|unit) id/.test(err.message)) return send(res, 400, { ok: false, error: 'bad-path' });
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
