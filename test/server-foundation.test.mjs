import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';
import { STEPS } from '../server/foundation/refresh.mjs';
import { writeFd } from '../server/foundation/store.mjs';
import { createFoundationRoute, MODULES } from '../server/foundation/http/index.mjs';
import { fail, pathParam } from '../server/foundation/http/common.mjs';

const ID = 'acme-shop-8324f1';
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const TOKEN = 'a'.repeat(64);

function call(port, method, path, { cookie = TOKEN, body, header = true, raw } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (cookie) headers.cookie = `sm_token=${cookie}`;
    if (method !== 'GET') Object.assign(headers, { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', ...(header ? { 'x-session-map': '1' } : {}) });
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* plain text answer */ }
        resolve({ status: res.statusCode, body: parsed, type: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}

// The same gate main.mjs puts in front of every route, then the foundation dispatcher alone.
async function withDispatcher({ demo = false, modules, demoDir }, fn) {
  const smDir = tmp('sm-fdhttp-');
  const projects = [{ id: ID, name: 'acme-shop', root: '/work/acme-shop' }];
  const handle = createFoundationRoute({ smDir, demo, token: TOKEN, projects: async () => projects, modules, demoDir });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = authorize(req, url, { token: TOKEN, address: '127.0.0.1' });
    if (auth.status !== 200) { res.writeHead(auth.status); return res.end(); }
    await handle(req, res, url);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn({ port: server.address().port, smDir });
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(smDir, { recursive: true, force: true });
  }
}

const echo = {
  routes: [
    { method: 'GET', path: 'census', run: (ctx) => ctx.read('census.json') },
    { method: 'GET', path: 'facts', run: (ctx) => ({ kind: ctx.query.get('kind'), file: pathParam(ctx.query.get('file')) }) },
    { method: 'GET', path: 'findings/:fid', run: (ctx) => ({ fid: ctx.params.fid, project: ctx.project.id }) },
    { method: 'POST', path: 'op/:opId/undo', run: (ctx) => ({ opId: ctx.params.opId, body: ctx.body }) },
    { method: 'POST', path: 'health/fix', run: () => fail(409, 'no-draft') },
    { method: 'GET', path: 'crash', run: () => { throw new Error('secret detail'); } },
    { method: 'GET', path: 'library', global: true, run: async (ctx) => ({ project: (await ctx.projectOf(ctx.query.get('project'))).id }) },
  ],
};

test('the five route files of the blocks exist, start empty and never repeat a route', () => {
  assert.equal(MODULES.length, 5);
  for (const m of MODULES) assert.ok(Array.isArray(m.routes));
  assert.throws(() => createFoundationRoute({ smDir: '.', projects: async () => [], modules: [echo, echo] }), /twice: GET census/);
});

test('reads go through the token, find the project and answer the stored file, or null before it exists', async () => {
  await withDispatcher({ modules: [echo] }, async ({ port, smDir }) => {
    assert.equal((await call(port, 'GET', `/api/foundation/${ID}/census`, { cookie: null })).status, 401, 'no key, no file names');
    const before = await call(port, 'GET', `/api/foundation/${ID}/census`);
    assert.equal(before.status, 200);
    assert.equal(before.body, null, 'not generated yet is 200 null, never 500');
    writeFd(smDir, ID, 'census.json', { version: 1, generatedAt: 'x', rev: 4 });
    assert.deepEqual((await call(port, 'GET', `/api/foundation/${ID}/census`)).body, { version: 1, generatedAt: 'x', rev: 4 });
    assert.deepEqual((await call(port, 'GET', `/api/foundation/nobody-000000/census`)).body, { ok: false, error: 'unknown-project' });
    assert.equal((await call(port, 'GET', `/api/foundation/nobody-000000/census`)).status, 404);
    assert.deepEqual((await call(port, 'GET', `/api/foundation/${ID}/nothing`)).body, { ok: false, error: 'not-found' });
    assert.deepEqual((await call(port, 'GET', `/api/foundation/${ID}/findings/f%3A3b`)).body, { fid: 'f:3b', project: ID });
    assert.deepEqual((await call(port, 'GET', `/api/foundation/${ID}/facts?kind=route&file=apps/api/a.ts`)).body, { kind: 'route', file: 'apps/api/a.ts' });
    assert.deepEqual((await call(port, 'GET', '/api/library?project=' + ID)).body, { project: ID });
    assert.equal((await call(port, 'GET', '/api/library?project=' + ID, { cookie: null })).status, 401);
  });
});

test('a path parameter that could leave the project is refused with 400', async () => {
  for (const bad of ['../x', 'a/../../b', '/etc', 'C:/x', 'a\\b']) assert.throws(() => pathParam(bad), (err) => err.status === 400 && err.message === 'bad-path', bad);
  assert.equal(pathParam(null), null);
  assert.equal(pathParam('apps/api/src'), 'apps/api/src');
  await withDispatcher({ modules: [echo] }, async ({ port }) => {
    const res = await call(port, 'GET', `/api/foundation/${ID}/facts?file=..%2F..%2Fsecret`);
    assert.deepEqual([res.status, res.body], [400, { ok: false, error: 'bad-path' }]);
  });
});

test('writes need the header, take a JSON body up to 64 KB and pass the route errors on', async () => {
  await withDispatcher({ modules: [echo] }, async ({ port }) => {
    assert.equal((await call(port, 'POST', `/api/foundation/${ID}/op/op-1/undo`, { body: { confirm: true }, header: false })).status, 403);
    assert.deepEqual((await call(port, 'POST', `/api/foundation/${ID}/op/op-1/undo`, { body: { confirm: true } })).body, { opId: 'op-1', body: { confirm: true } });
    const big = await call(port, 'POST', `/api/foundation/${ID}/op/op-1/undo`, { body: { text: 'x'.repeat(70 * 1024) } });
    assert.deepEqual([big.status, big.body], [413, { ok: false, error: 'too-large' }]);
    const bad = await call(port, 'POST', `/api/foundation/${ID}/op/op-1/undo`, { raw: '{ nope' });
    assert.deepEqual([bad.status, bad.body], [400, { ok: false, error: 'bad-json' }]);
    const draft = await call(port, 'POST', `/api/foundation/${ID}/health/fix`, { body: {} });
    assert.deepEqual([draft.status, draft.body], [409, { ok: false, error: 'no-draft' }]);
    assert.equal((await call(port, 'GET', `/api/foundation/${ID}/op/op-1/undo`)).status, 404, 'a GET does not reach a POST route');
    const crash = await call(port, 'GET', `/api/foundation/${ID}/crash`);
    assert.deepEqual([crash.status, crash.body], [500, { ok: false, error: 'internal' }], 'the inner message never reaches the page');
  });
});

test('--demo reads the invented files of demo/foundation and refuses every write', async () => {
  const demoDir = tmp('sm-fddemo-');
  try {
    mkdirSync(join(demoDir, ID), { recursive: true });
    writeFileSync(join(demoDir, ID, 'census.json'), JSON.stringify({ version: 1, generatedAt: 'demo', rev: 9 }));
    await withDispatcher({ demo: true, modules: [echo], demoDir }, async ({ port }) => {
      assert.deepEqual((await call(port, 'GET', `/api/foundation/${ID}/census`)).body, { version: 1, generatedAt: 'demo', rev: 9 });
      const write = await call(port, 'POST', `/api/foundation/${ID}/op/op-1/undo`, { body: {} });
      assert.deepEqual([write.status, write.body], [403, { ok: false, error: 'demo' }]);
    });
  } finally { rmSync(demoDir, { recursive: true, force: true }); }
});

// ---- the line in main.mjs ----------------------------------------------------------

const fakeState = () => ({ generatedAt: '', waitingCount: 0, projects: [{ id: ID, name: 'acme-shop', root: '/work/acme-shop', arch: { parts: [] }, workCells: [], chats: [] }] });

async function withApp(opts, fn) {
  const dir = tmp('sm-fdapp-dir-');
  const smDir = tmp('sm-fdapp-sm-');
  const app = createApp({ dir, smDir, ai: { bin: null }, collectFn: fakeState, chat: null, ...opts });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  try {
    await fn({ app, port: app.address().port, token: opts.token ?? loadToken(smDir), smDir });
  } finally {
    await new Promise((r) => app.close(r));
    for (const d of [dir, smDir]) rmSync(d, { recursive: true, force: true });
  }
}

test('main.mjs hands /api/foundation/* to the dispatcher, with its gates', async () => {
  await withApp({}, async ({ port, token }) => {
    assert.equal((await call(port, 'GET', `/api/foundation/${ID}/census`, { cookie: null })).status, 401);
    assert.deepEqual((await call(port, 'GET', `/api/foundation/nobody-000000/census`, { cookie: token })).body, { ok: false, error: 'unknown-project' });
    const none = await call(port, 'GET', `/api/foundation/${ID}/nothing-yet`, { cookie: token });
    assert.deepEqual([none.status, none.body], [404, { ok: false, error: 'not-found' }]);
    assert.equal((await call(port, 'GET', '/api/state', { cookie: token })).status, 200, 'the other routes are untouched');
  });
  await withApp({ demo: true, token: TOKEN }, async ({ port }) => {
    const write = await call(port, 'POST', `/api/foundation/${ID}/refresh`, { body: {} });
    assert.deepEqual([write.status, write.body], [403, { ok: false, error: 'demo' }]);
  });
});

test('the 5-minute sweep refreshes only the projects worked on now or kept always up to date, never in --demo', async () => {
  const seen = [];
  const step = { name: 'probe', run: (ctx) => { seen.push(ctx.project.id); } };
  const project = (id, background) => ({ id, name: id, root: `/work/${id}`, arch: { parts: [] }, workCells: [], chats: [], background });
  const mixed = () => ({ generatedAt: '', waitingCount: 0, projects: [
    project(ID, { always: false, working: true, on: true }),
    project('quiet-000001', { always: false, working: false, on: false }),
    project('kept-000002', { always: true, working: false, on: true }),
  ] });
  STEPS.push(step);
  try {
    await withApp({ collectFn: mixed }, async ({ app }) => { await app.refreshFoundations(); });
    assert.deepEqual(seen, [ID, 'kept-000002'], 'the quiet project is left alone');
    await withApp({ demo: true, token: TOKEN, collectFn: mixed }, async ({ app }) => { await app.refreshFoundations(); });
    assert.deepEqual(seen, [ID, 'kept-000002']);
  } finally { STEPS.splice(STEPS.indexOf(step), 1); }
});
