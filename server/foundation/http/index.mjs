import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookieToken, sameToken } from '../../auth.mjs';
import { log } from '../../log.mjs';
import { assertSafeName, readJsonFile } from '../../store.mjs';
import { fdDir, fdParts, readFd, writeFd } from '../store.mjs';
import { FdHttpError, fail } from './common.mjs';
import * as read from './read.mjs';
import * as model from './model.mjs';
import * as care from './care.mjs';
import * as health from './health.mjs';
import * as guide from './guide.mjs';

// Every /api/foundation/:projectId/<what> route, and /api/library, behind the same gates as the Files route (index § 3).
//
// Contract of a route file (read, model, care, health, guide): `export const routes = [{ method, path, run, global? }]`.
// - path: the <what> after the project id, '/'-separated, with ':name' parts (`findings/:fid`, `op/:opId/undo`).
//   global: true puts it at /api/<path> with no project (only `library`).
// - run(ctx) returns the JSON answer (undefined/null -> 200 null, "not generated yet"); fail(status, code) from
//   common.mjs answers an error. ctx = { project, params, query (URLSearchParams), body (writes only), read(name,
//   fallback), readFor(projectId, name, fallback), write(name, data), dir, demo, smDir, projectOf(id), fresh(), req }.
//   read() serves demo/foundation/<id>/ under --demo, the brain folder otherwise; write() refuses under --demo.
// Gates here, before any route runs: the token cookie on every request (file names and code), the x-session-map header
// on writes, --demo refuses writes with 403, bodies up to 64 KB, unknown project 404 unknown-project.
export const MODULES = [read, model, care, health, guide];
const DEMO_DIR = fileURLToPath(new URL('../../../demo/foundation/', import.meta.url));
const BODY_MAX = 64 * 1024;

function compile(modules) {
  const table = [];
  const seen = new Set();
  for (const m of modules) {
    for (const r of m.routes) {
      const id = `${r.method} ${r.global ? '/api/' : ''}${r.path}`;
      if (seen.has(id)) throw new Error(`foundation route twice: ${id}`);
      seen.add(id);
      table.push({ ...r, segs: r.path.split('/') });
    }
  }
  return table;
}

function match(table, method, global, rest) {
  for (const route of table) {
    if (route.method !== method || Boolean(route.global) !== global || route.segs.length !== rest.length) continue;
    const params = {};
    const fits = route.segs.every((s, i) => {
      if (!s.startsWith(':')) return s === rest[i];
      params[s.slice(1)] = rest[i];
      return rest[i] !== '';
    });
    if (fits) return { route, params };
  }
  return null;
}

// Read to the end even when too large, so the answer is not cut off by a half-read request.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_MAX) chunks = null;
      else chunks?.push(c);
    });
    req.on('end', () => {
      if (!chunks) return reject(new FdHttpError(413, 'too-large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new FdHttpError(400, 'bad-json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// projects(): the projects of the state (the disk copy is enough: only id and root are needed).
export function createFoundationRoute({ smDir, demo = false, token, projects, demoDir = DEMO_DIR, modules = MODULES, fresh = () => {} }) {
  const table = compile(modules);
  const projectOf = async (id) => {
    const project = (await projects()).find((p) => p.id === id);
    if (!project) fail(404, 'unknown-project');
    return project;
  };
  const readFor = (projectId, name, fallback = null) => (demo
    ? readJsonFile(join(demoDir, assertSafeName(projectId, 'project id'), ...fdParts(name)), fallback)
    : readFd(smDir, projectId, name, fallback));

  return async function foundationRoute(req, res, url) {
    try {
      const parts = url.pathname.split('/').slice(1).map((p) => decodeURIComponent(p));
      const global = parts[1] === 'library';
      const write = req.method !== 'GET';
      if (!sameToken(cookieToken(req), token)) fail(401, 'token-required');
      if (write && req.headers['x-session-map'] !== '1') fail(403, 'forbidden');
      if (write && demo) fail(403, 'demo');
      const project = global ? null : await projectOf(parts[2]);
      const found = match(table, req.method, global, global ? parts.slice(1) : parts.slice(3));
      if (!found) fail(404, 'not-found');
      const ctx = {
        req, project, params: found.params, query: url.searchParams, demo, smDir, projectOf, fresh, readFor,
        body: write ? await readBody(req) : undefined,
        dir: project && (demo ? join(demoDir, project.id) : fdDir(smDir, project.id)),
        read: (name, fallback) => readFor(project.id, name, fallback),
        write: (name, data) => (demo ? fail(403, 'demo') : writeFd(smDir, project.id, name, data)),
      };
      return send(res, 200, (await found.route.run(ctx)) ?? null);
    } catch (err) {
      if (res.headersSent) return undefined;
      if (err instanceof FdHttpError) return send(res, err.status, { ok: false, error: err.message });
      if (err instanceof URIError || /^invalid (project id|foundation file)/.test(err.message)) return send(res, 400, { ok: false, error: 'bad-path' });
      log('error', 'foundation-request-failed', { path: url.pathname, error: err.message });
      return send(res, 500, { ok: false, error: 'internal' });
    }
  };
}
