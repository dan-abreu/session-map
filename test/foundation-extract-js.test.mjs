import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../server/foundation/lex.mjs';
import { extract, VERSION, TYPES } from '../server/foundation/extract/js.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOS = join(HERE, 'fixtures', 'repos');
const SHOP = join(REPOS, 'acme-shop');
const answer = JSON.parse(readFileSync(join(REPOS, 'acme-shop.answer.json'), 'utf8'));

function run(text, path = 'src/a.ts', workspace = { dir: '', name: 'x' }, type, files = []) {
  const t = type ?? (path.split('.').pop() === 'js' ? 'js' : path.endsWith('.tsx') ? 'tsx' : 'ts');
  return extract({ path, type: t, text, masked: lex(text, t).masked, workspace, files });
}
const ids = (r) => r.facts.map((f) => f.id);
const one = (r, id) => r.facts.find((f) => f.id === id);

// The workspace of a fixture file: its nearest package.json, as the index hands it to the extractor (with the names of
// its dependencies and devDependencies).
function workspaceOf(path) {
  let dir = posix.dirname(path);
  for (;;) {
    const pkg = dir === '.' ? 'package.json' : `${dir}/package.json`;
    if (existsSync(join(SHOP, pkg))) {
      const json = JSON.parse(readFileSync(join(SHOP, pkg), 'utf8'));
      const deps = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
      return { dir: dir === '.' ? '' : dir, name: json.name, deps };
    }
    if (dir === '.') return { dir: '', name: 'acme-shop' };
    dir = posix.dirname(dir);
  }
}

const JS_FILES = [
  'apps/api/src/server.ts', 'apps/api/src/routes/orders.ts', 'apps/api/src/services/notify.ts',
  'apps/api/src/services/orders.ts', 'apps/api/src/log.ts', 'apps/web/app/page.tsx',
  'apps/web/app/(shop)/cart/page.tsx', 'apps/web/app/api/health/route.ts', 'apps/web/app/orders/[id]/page.tsx',
  'apps/web/lib/api.ts', 'apps/admin/pages/api/users.ts', 'apps/admin/pages/dashboard.tsx',
  'apps/worker/src/queues.ts', 'apps/worker/src/templates.ts', 'apps/worker/src/worker.ts',
  'packages/adapters/src/mailer.ts', 'packages/adapters/src/payments.ts',
];
const KINDS = new Set(['route', 'screen', 'queue', 'job', 'integration', 'env']);

function fixtureRun(path) {
  const text = readFileSync(join(SHOP, path), 'utf8');
  const type = path.endsWith('.tsx') ? 'tsx' : 'ts';
  return extract({ path, type, text, masked: lex(text, type).masked, workspace: workspaceOf(path), files: JS_FILES });
}
// The key leaves `name` out (null): it is the id without its kind. Refs are compared for the file itself only; refs to
// other files are the index's join.
const nameOf = (id) => id.slice(id.indexOf(':') + 1);
const shape = (f) => ({
  id: f.id, kind: f.kind, name: f.name ?? nameOf(f.id), file: f.file, line: f.line, origin: f.origin, attrs: f.attrs,
  refs: (f.refs ?? []).filter((r) => r.file === f.file).map((r) => ({ file: r.file, line: r.line })),
});
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// What the answer key says this one file must give. The key holds the joined result (prefix applied, one queue fact
// with the worker as a ref); a single file gives the pieces: the route without the prefix, the worker as its own use.
function expectedFor(path) {
  const out = [];
  for (const f of answer.facts) {
    if (!KINDS.has(f.kind)) continue;
    if (f.kind === 'env' && f.attrs.source !== 'code') continue;
    if (f.file === path) {
      const e = shape(f);
      if (f.kind === 'route' && f.origin === 'INFERRED') {
        const stripped = f.attrs.path.replace(/^\/v1/, '');
        e.id = `route:${f.attrs.method} ${stripped}`;
        e.name = nameOf(e.id);
        e.origin = 'EXTRACTED';
        e.attrs = { ...f.attrs, path: stripped };
      }
      out.push(e);
    }
    for (const r of f.refs ?? []) {
      if (r.file === path && f.kind === 'queue') {
        out.push({ id: f.id, kind: 'queue', name: nameOf(f.id), file: path, line: r.line, origin: 'EXTRACTED', attrs: { lib: 'bullmq', use: 'worker' }, refs: [] });
      }
    }
  }
  return out;
}

test('declares its version and the js types', () => {
  assert.equal(VERSION, 'js@1');
  assert.deepEqual(TYPES, ['js', 'ts', 'tsx', 'jsx']);
});

for (const path of JS_FILES) {
  test(`acme-shop ${path} gives exactly what the answer key lists for it`, () => {
    const { facts } = fixtureRun(path);
    assert.deepEqual(facts.map(shape).sort(byId), expectedFor(path).sort(byId));
  });
}

test('acme-shop: every js fact of the key is found, in some file', () => {
  const want = answer.facts.filter((f) => KINDS.has(f.kind) && !(f.kind === 'env' && f.attrs.source !== 'code') && /\.(tsx?|jsx?)$/.test(f.file));
  assert.ok(want.length >= 20);
  const got = JS_FILES.flatMap((p) => fixtureRun(p).facts);
  for (const w of want) assert.ok(got.some((g) => g.kind === w.kind && g.file === w.file && g.line === w.line), `${w.id} not found`);
});

test('acme-shop: no trap becomes a fact', () => {
  for (const trap of answer.traps) {
    if (!/\.(tsx?|jsx?)$/.test(trap.file)) continue;
    const { facts, hints } = fixtureRun(trap.file);
    for (const f of facts) {
      assert.notEqual(f.line, trap.line, `${f.id} sits on the trap ${trap.file}:${trap.line}`);
      for (const r of f.refs ?? []) assert.notEqual(r.line, trap.line);
    }
    for (const h of hints) assert.notEqual(h.line, trap.line);
  }
});

test('acme-shop: the register call leaves a hint for the index', () => {
  const { hints } = fixtureRun('apps/api/src/server.ts');
  assert.deepEqual(hints, [{ kind: 'fastify-register', spec: './routes/orders', prefix: '/v1', line: 11 }]);
});

test('output has no sha, file equals path and the extractor is the version', () => {
  const f = run("app.get('/a', h); const k = process.env.K;\n", 'x/y.ts', { dir: '', name: 'x' }).facts;
  assert.ok(f.length >= 1);
  for (const x of f) {
    assert.equal(x.file, 'x/y.ts');
    assert.equal('sha' in x, false);
    assert.equal(x.extractor, 'js@1');
    assert.ok(Array.isArray(x.refs));
  }
});

test('the extractor reads nothing by itself: no fs, no child process, no network', () => {
  const src = readFileSync(join(HERE, '..', 'server', 'foundation', 'extract', 'js.mjs'), 'utf8');
  assert.doesNotMatch(src, /node:fs|node:child_process|execFile|readFile|node:http|node:net|\.env['"]/);
});

// ---------- Fastify ----------

const FASTIFY = "import Fastify from 'fastify';\n";

test('fastify: every verb, a literal path, one fact each', () => {
  const r = run(`${FASTIFY}app.get('/a', h);\napp.post('/b', h);\napp.put('/c', h);\napp.patch('/d', h);\napp.delete('/e', h);\napp.head('/f', h);\napp.options('/g', h);\n`);
  assert.deepEqual(ids(r), ['route:GET /a', 'route:POST /b', 'route:PUT /c', 'route:PATCH /d', 'route:DELETE /e', 'route:HEAD /f', 'route:OPTIONS /g']);
  assert.deepEqual(r.facts.map((f) => f.line), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(one(r, 'route:GET /a').attrs.framework, 'fastify');
  assert.equal(one(r, 'route:GET /a').origin, 'EXTRACTED');
});

test('fastify: app, fastify, server and router are the receivers; other names and this.x are not', () => {
  const r = run(`${FASTIFY}fastify.get('/1', h);\nserver.get('/2', h);\nrouter.get('/3', h);\ncache.get('/4');\nthis.app.get('/5', h);\n`);
  assert.deepEqual(ids(r), ['route:GET /1', 'route:GET /2', 'route:GET /3']);
});

test('fastify: a non-literal path is AMBIGUOUS with the written expression and a null path', () => {
  const r = run(`${FASTIFY}const P = '/x';\napp.get(P, async () => 1);\napp.get(BASE + '/y', h);\napp.get(\`/t/\${id}\`, h);\n`);
  assert.deepEqual(ids(r), ['route:GET ?P', "route:GET ?BASE + '/y'", 'route:GET ?`/t/${id}`']);
  for (const f of r.facts) {
    assert.equal(f.origin, 'AMBIGUOUS');
    assert.equal(f.attrs.path, null);
    assert.equal(f.attrs.method, 'GET');
  }
});

test('fastify: a plain template with no ${} is a literal', () => {
  const r = run(`${FASTIFY}app.get(\`/plain\`, h);\n`);
  assert.deepEqual(ids(r), ['route:GET /plain']);
  assert.equal(r.facts[0].origin, 'EXTRACTED');
});

test('fastify: a literal that is not a path, or a call with one non-path argument, is not a route', () => {
  const r = run(`${FASTIFY}app.get('title');\napp.get(key);\nconst v = router.get('x');\n`);
  assert.deepEqual(r.facts, []);
});

test('fastify: routes in comments, strings and templates are not facts', () => {
  const r = run(`${FASTIFY}// app.get('/c1', h)\n/* app.get('/c2', h) */\nconst s = "app.get('/c3', h)";\nconst t = \`app.get('/c4', h) \${'/x'}\`;\napp.get('/real', h);\n`);
  assert.deepEqual(ids(r), ['route:GET /real']);
});

test('fastify: app.route with a method and a url, the line is the call', () => {
  const r = run(`${FASTIFY}app.route({\n  method: 'PUT',\n  url: '/n/:id',\n  handler: async () => 1,\n});\n`);
  assert.deepEqual(ids(r), ['route:PUT /n/:id']);
  assert.equal(r.facts[0].line, 2);
  assert.equal(r.facts[0].origin, 'EXTRACTED');
});

test('fastify: app.route with an array of methods gives one fact per method', () => {
  const r = run(`${FASTIFY}app.route({ method: ['GET', 'POST'], url: '/m', handler });\n`);
  assert.deepEqual(ids(r), ['route:GET /m', 'route:POST /m']);
});

test('fastify: app.route reads only the top-level keys, not a nested method or url', () => {
  const r = run(`${FASTIFY}app.route({\n  schema: { method: 'DELETE', url: '/wrong' },\n  url: '/right',\n  method: 'GET',\n  handler,\n});\n`);
  assert.deepEqual(ids(r), ['route:GET /right']);
});

test('fastify: app.route with a dynamic url is AMBIGUOUS; without a url it is not a route', () => {
  const r = run(`${FASTIFY}app.route({ method: 'GET', url: PATH, handler });\napp.route({ method: 'GET', handler });\n`);
  assert.deepEqual(ids(r), ['route:GET ?PATH']);
  assert.equal(r.facts[0].origin, 'AMBIGUOUS');
});

test('fastify: a method that is not a literal makes the route ANY and AMBIGUOUS', () => {
  const r = run(`${FASTIFY}app.route({ method: verbs, url: '/v', handler });\n`);
  assert.deepEqual(ids(r), ['route:ANY /v']);
  assert.equal(r.facts[0].origin, 'AMBIGUOUS');
});

test('fastify: register with a prefix leaves a hint with the import spec, and the routes stay unprefixed', () => {
  const r = run(`import { users } from './users';\nimport posts from "../posts";\nimport * as tags from './tags';\n${FASTIFY}app.register(users, { prefix: '/u' });\nawait app.register(posts, { prefix: '/p', other: 1 });\napp.register(tags.plugin, { prefix: '/t' });\n`);
  assert.deepEqual(r.hints, [
    { kind: 'fastify-register', spec: './users', prefix: '/u', line: 5 },
    { kind: 'fastify-register', spec: '../posts', prefix: '/p', line: 6 },
    { kind: 'fastify-register', spec: './tags', prefix: '/t', line: 7 },
  ]);
  assert.deepEqual(r.facts, []);
});

test('fastify: register by import() or require() and an aliased import', () => {
  const r = run(`import { real as alias } from './real';\n${FASTIFY}app.register(import('./lazy'), { prefix: '/l' });\napp.register(require('./cjs'), { prefix: '/c' });\napp.register(alias, { prefix: '/a' });\n`);
  assert.deepEqual(r.hints.map((h) => [h.spec, h.prefix]), [['./lazy', '/l'], ['./cjs', '/c'], ['./real', '/a']]);
});

test('fastify: register with a dynamic prefix keeps the hint with a null prefix; without a prefix there is no hint', () => {
  const r = run(`import { users } from './users';\n${FASTIFY}app.register(users, { prefix: P });\napp.register(users);\napp.register(users, { logLevel: 'info' });\napp.register(local, { prefix: '/x' });\n`);
  assert.deepEqual(r.hints, [{ kind: 'fastify-register', spec: './users', prefix: null, line: 3 }]);
});

test('fastify: register of a function written in the call applies the prefix to its routes (INFERRED, no hint)', () => {
  const r = run(`${FASTIFY}app.register(async (app) => {\n  app.get('/x', h);\n  app.route({ method: 'POST', url: '/y', handler });\n  app.get('/', h);\n}, { prefix: '/v1' });\napp.get('/out', h);\n`);
  assert.deepEqual(ids(r), ['route:GET /v1/x', 'route:POST /v1/y', 'route:GET /v1', 'route:GET /out']);
  assert.deepEqual(r.facts.map((f) => f.origin), ['INFERRED', 'INFERRED', 'INFERRED', 'EXTRACTED']);
  assert.deepEqual(one(r, 'route:GET /v1/x').attrs, { method: 'GET', path: '/v1/x', framework: 'fastify' });
  assert.equal(one(r, 'route:GET /v1/x').line, 3);
  assert.deepEqual(r.hints, []);
  const fn = run(`${FASTIFY}app.register(function (app, opts, done) {\n  app.get('/f', h);\n  done();\n}, { prefix: '/fn' });\n`);
  assert.deepEqual(ids(fn), ['route:GET /fn/f']);
});

test('fastify: register of a function declared in the same file applies the prefix to its routes', () => {
  const r = run(`${FASTIFY}async function routes(app) {\n  app.get('/a', h);\n}\nconst more = async (app: FastifyInstance) => {\n  app.post('/b', h);\n};\nconst one1 = app => app.get('/c', h);\napp.register(routes, { prefix: '/v2' });\napp.register(more, { prefix: '/v3' });\napp.register(one1, { prefix: '/v4' });\n`);
  assert.deepEqual(ids(r), ['route:GET /v2/a', 'route:POST /v3/b', 'route:GET /v4/c']);
  assert.ok(r.facts.every((f) => f.origin === 'INFERRED'));
  assert.deepEqual(r.hints, []);
});

test('fastify: a local function registered under two prefixes gives its routes under both', () => {
  const r = run(`${FASTIFY}function routes(app) {\n  app.get('/a', h);\n}\napp.register(routes, { prefix: '/v1' });\napp.register(routes, { prefix: '/v2' });\n`);
  assert.deepEqual(ids(r).sort(), ['route:GET /v1/a', 'route:GET /v2/a']);
});

test('fastify: a dynamic prefix on a local function makes its routes AMBIGUOUS with a null path', () => {
  const r = run(`${FASTIFY}app.register(async (app) => {\n  app.get('/x', h);\n}, { prefix: P });\n`);
  assert.deepEqual(ids(r), ['route:GET ?${P}/x']);
  assert.equal(r.facts[0].origin, 'AMBIGUOUS');
  assert.equal(r.facts[0].attrs.path, null);
});

test('fastify: nested prefixes join, and a plugin registered inside a prefixed function carries the outer prefix', () => {
  const r = run(`import { users } from './users';\n${FASTIFY}app.register(async (app) => {\n  app.register(async (app) => {\n    app.get('/x', h);\n  }, { prefix: '/b' });\n  app.register(users, { prefix: '/u' });\n  app.register(users);\n}, { prefix: '/a' });\n`);
  assert.deepEqual(ids(r), ['route:GET /a/b/x']);
  assert.equal(r.facts[0].origin, 'INFERRED');
  assert.deepEqual(r.hints, [
    { kind: 'fastify-register', spec: './users', prefix: '/a/u', line: 7 },
    { kind: 'fastify-register', spec: './users', prefix: '/a', line: 8 },
  ]);
});

test('fastify: without dependencies, a variable named fastify does not make an express file fastify', () => {
  assert.deepEqual(run("const fastify = require('express')();\nfastify.get('/z', h);\n").facts, []);
});


test('fastify: a register call inside a comment leaves no hint', () => {
  const r = run(`import { users } from './users';\n${FASTIFY}// app.register(users, { prefix: '/z' });\n`);
  assert.deepEqual(r.hints, []);
});

test('fastify: express-style code (no fastify anywhere in the file) gives no routes', () => {
  const r = run("const app = express();\napp.get('/e', (req, res) => res.send('x'));\n");
  assert.deepEqual(r.facts, []);
});

test('fastify: a literal path alone, with no handler and no options, is not a route', () => {
  assert.deepEqual(run(`${FASTIFY}const v = app.get('/only');\n`).facts, []);
});

test('fastify: the word fastify in a comment or a string does not make an express file fastify', () => {
  assert.deepEqual(run("// built on fastify\nconst app = express();\napp.get('/e', h);\n").facts, []);
  assert.deepEqual(run("const s = 'fastify';\napp.get('/e', h);\n").facts, []);
});

test('fastify: without dependencies, an import of fastify or @fastify/*, or a Fastify type name, marks the file', () => {
  assert.deepEqual(ids(run("import cors from '@fastify/cors';\napp.get('/c', h);\n")), ['route:GET /c']);
  assert.deepEqual(ids(run("export async function r(app: FastifyInstance) {\n  app.get('/t', h);\n}\n")), ['route:GET /t']);
});

test('fastify: with the workspace dependencies given, only fastify packages give routes', () => {
  const code = "app.get('/d', h);\n";
  assert.deepEqual(ids(run(code, 'src/a.ts', { dir: '', name: 'x', deps: ['fastify'] })), ['route:GET /d']);
  assert.deepEqual(run(code, 'src/a.ts', { dir: '', name: 'x', deps: ['express'] }).facts, []);
});

// ---------- Next App Router ----------

const NEXT = ['next', 'react'];

test('next app: page.tsx gives a screen named by the folders, groups dropped, [id] kept', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: NEXT };
  const page = (p, body = 'export default function P() { return null; }\n') => run(body, p, ws);
  assert.deepEqual(ids(page('apps/web/app/page.tsx')), ['screen:web:/']);
  assert.deepEqual(ids(page('apps/web/app/(shop)/cart/page.tsx')), ['screen:web:/cart']);
  assert.deepEqual(ids(page('apps/web/app/orders/[id]/page.tsx')), ['screen:web:/orders/[id]']);
  assert.deepEqual(ids(page('apps/web/src/app/a/[...slug]/page.jsx')), ['screen:web:/a/[...slug]']);
  const f = page('apps/web/app/x/page.tsx').facts[0];
  assert.equal(f.attrs.framework, 'next-app');
  assert.equal(f.attrs.route, '/x');
  assert.equal(f.attrs.widget, 'P');
});

test('next app: a page without a default export is not a screen; slots, private folders and intercepts are not either', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: NEXT };
  const body = 'export default function P() { return null; }\n';
  assert.deepEqual(run('export const x = 1;\n', 'apps/web/app/page.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'apps/web/app/@modal/page.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'apps/web/app/_parts/page.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'apps/web/app/feed/(.)photo/[id]/page.tsx', ws).facts, []);
});

test('next app: the widget is the default export name and the line its declaration', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: NEXT };
  const a = run('import x from "x";\n\nfunction Home() {\n  return null;\n}\n\nexport default Home;\n', 'apps/web/app/page.tsx', ws).facts[0];
  assert.deepEqual([a.attrs.widget, a.line], ['Home', 3]);
  const b = run('const Home = () => null;\nexport { Home as default };\n', 'apps/web/app/page.tsx', ws).facts[0];
  assert.deepEqual([b.attrs.widget, b.line], ['Home', 1]);
  const c = run('\nexport default async function () { return null; }\n', 'apps/web/app/page.tsx', ws).facts[0];
  assert.deepEqual([c.attrs.widget, c.line], [null, 2]);
  const d = run('export default class Settings {}\n', 'apps/web/app/page.tsx', ws).facts[0];
  assert.equal(d.attrs.widget, 'Settings');
  const e = run('export default memo(Page);\n', 'apps/web/app/page.tsx', ws).facts[0];
  assert.deepEqual([e.attrs.widget, e.line], [null, 1]);
});

test('next app: the screen app name is the workspace folder, or the package name at the root', () => {
  assert.deepEqual(ids(run('export default function P() {}\n', 'app/page.tsx', { dir: '', name: 'shop', deps: NEXT })), ['screen:shop:/']);
  assert.deepEqual(ids(run('export default function P() {}\n', 'apps/site/app/page.tsx', { dir: 'apps/site', name: '@acme/site', deps: NEXT })), ['screen:site:/']);
});

test('next app: route.ts gives one route per exported verb, on the export line', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: NEXT };
  const r = run("export async function GET() {}\n\nexport const POST = async () => {};\nexport function helper() {}\nconst DELETE = 1;\nexport { handler as PATCH, PUT };\n", 'apps/web/app/api/items/[id]/route.ts', ws);
  assert.deepEqual(ids(r), ['route:GET /api/items/[id]', 'route:POST /api/items/[id]', 'route:PATCH /api/items/[id]', 'route:PUT /api/items/[id]']);
  assert.deepEqual(r.facts.map((f) => f.line), [1, 3, 6, 6]);
  assert.equal(r.facts[0].attrs.framework, 'next-app');
  assert.equal(r.facts[0].origin, 'EXTRACTED');
});

test('next app: a route.ts with no verb gives nothing; an exported verb inside a comment is ignored', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: NEXT };
  assert.deepEqual(run('export function other() {}\n', 'apps/web/app/x/route.ts', ws).facts, []);
  assert.deepEqual(run('// export async function GET() {}\n', 'apps/web/app/x/route.ts', ws).facts, []);
});

test('next: with the workspace dependencies given and no next, nothing is read as a Next file', () => {
  const ws = { dir: 'apps/web', name: 'web', deps: ['react', 'vite'] };
  assert.deepEqual(run('export default function P() {}\n', 'apps/web/src/pages/Home.tsx', ws).facts, []);
  assert.deepEqual(run('export default function P() {}\n', 'apps/web/app/page.tsx', ws).facts, []);
});

test('next: without dependencies, a vite or react file under pages/ or app/ with no sign of Next gives nothing', () => {
  const ws = { dir: '', name: 'vite-app' };
  const body = 'export default function Home() { return null; }\n';
  assert.deepEqual(run(body, 'src/pages/Home.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'src/app/page.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'pages/api/users.ts', ws).facts, []);
  assert.deepEqual(run('export async function GET() {}\n', 'app/api/x/route.ts', ws).facts, []);
});

test('next: without dependencies, a next.config in the workspace or an import of next counts as the sign', () => {
  const body = 'export default function Home() { return null; }\n';
  const ws = { dir: 'apps/site', name: 'site' };
  for (const cfg of ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts']) {
    assert.deepEqual(ids(run(body, 'apps/site/pages/Home.tsx', ws, 'tsx', [`apps/site/${cfg}`])), ['screen:site:/Home'], cfg);
  }
  assert.deepEqual(ids(run(body, 'app/page.tsx', { dir: '', name: 'shop' }, 'tsx', ['next.config.js'])), ['screen:shop:/']);
  assert.deepEqual(run(body, 'apps/site/pages/Home.tsx', ws, 'tsx', ['apps/other/next.config.js', 'next.config.js']).facts, []);
  assert.deepEqual(ids(run(`import Link from 'next/link';\n${body}`, 'apps/site/pages/Home.tsx', ws)), ['screen:site:/Home']);
  assert.deepEqual(ids(run("import { NextResponse } from 'next/server';\nexport async function GET() {}\n", 'apps/site/app/x/route.ts', ws)), ['route:GET /x']);
  assert.deepEqual(run(`import x from 'nextra';\n${body}`, 'apps/site/pages/Home.tsx', ws).facts, []);
});

// ---------- Next Pages Router ----------

test('next pages: pages/** is a screen, index folds into its folder, _app and tests are not screens', () => {
  const ws = { dir: 'apps/admin', name: 'admin', deps: NEXT };
  const body = 'export default function P() { return null; }\n';
  assert.deepEqual(ids(run(body, 'apps/admin/pages/index.tsx', ws)), ['screen:admin:/']);
  assert.deepEqual(ids(run(body, 'apps/admin/pages/users/index.tsx', ws)), ['screen:admin:/users']);
  assert.deepEqual(ids(run(body, 'apps/admin/src/pages/users/[id]/edit.js', ws)), ['screen:admin:/users/[id]/edit']);
  assert.deepEqual(run(body, 'apps/admin/pages/_app.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'apps/admin/pages/_document.tsx', ws).facts, []);
  assert.deepEqual(run(body, 'apps/admin/pages/a.test.tsx', ws).facts, []);
  assert.deepEqual(run('export const x = 1;\n', 'apps/admin/pages/helper.ts', ws).facts, []);
  assert.equal(run(body, 'apps/admin/pages/x.tsx', ws).facts[0].attrs.framework, 'next-pages');
});

test('next pages: pages/api/** is a route with the method ANY on the export default line', () => {
  const ws = { dir: 'apps/admin', name: 'admin', deps: NEXT };
  const r = run('import x from "x";\nconst h = 1;\nexport default h;\n', 'apps/admin/pages/api/v1/[id].ts', ws);
  assert.deepEqual(ids(r), ['route:ANY /api/v1/[id]']);
  assert.equal(r.facts[0].line, 3);
  assert.equal(r.facts[0].attrs.framework, 'next-pages');
  assert.equal(r.facts[0].origin, 'EXTRACTED');
  assert.deepEqual(run('export const x = 1;\n', 'apps/admin/pages/api/none.ts', ws).facts, []);
});

// ---------- BullMQ ----------

const BULL = "import { Queue, Worker, QueueScheduler } from 'bullmq';\n";

test('bullmq: new Queue is the queue; .add on its variable is a producer job; repeat is a cron', () => {
  const r = run(`${BULL}const q = new Queue('mail', { connection });\nq.add('a', {});\nq.add('b', {}, { repeat: { pattern: '* * * * *' } });\nq.add('c', {}, { delay: 5 });\n`);
  assert.deepEqual(ids(r), ['queue:mail', 'job:mail/a', 'job:mail/b', 'job:mail/c']);
  assert.deepEqual(r.facts.map((f) => f.line), [2, 3, 4, 5]);
  assert.deepEqual(r.facts[0].attrs, { lib: 'bullmq' });
  assert.deepEqual(r.facts.slice(1).map((f) => f.attrs.role), ['producer', 'cron', 'producer']);
  assert.deepEqual(one(r, 'job:mail/a').attrs, { queue: 'mail', lib: 'bullmq', role: 'producer' });
});

test('bullmq: a Worker or a QueueScheduler is a use of the queue, not its definition', () => {
  const r = run(`${BULL}const w = new Worker('mail', proc);\nnew QueueScheduler('mail');\n`);
  assert.deepEqual(r.facts.map((f) => [f.id, f.attrs.use, f.line]), [['queue:mail', 'worker', 2], ['queue:mail', 'scheduler', 3]]);
});

test('bullmq: generics, this.field and exported consts all bind the queue variable', () => {
  const r = run(`${BULL}export const a = new Queue<Data>('qa');\nclass S {\n  private qb: Queue = new Queue('qb');\n  go() { this.qb.add('j', {}); a.add('k', {}); }\n}\n`);
  assert.deepEqual(ids(r), ['queue:qa', 'queue:qb', 'job:qb/j', 'job:qa/k']);
});

test('bullmq: a queue named by a variable is AMBIGUOUS, and so are its jobs', () => {
  const r = run(`${BULL}const q = new Queue(NAME);\nq.add('j', {});\nnew Worker(NAME, p);\n`);
  assert.deepEqual(ids(r), ['queue:?NAME', 'job:?NAME/j', 'queue:?NAME']);
  assert.deepEqual(r.facts.map((f) => f.origin), ['AMBIGUOUS', 'AMBIGUOUS', 'AMBIGUOUS']);
  assert.equal(r.facts[0].attrs.name, null);
  assert.equal(r.facts[1].attrs.queue, null);
});

test('bullmq: a job name that is not a literal is AMBIGUOUS', () => {
  const r = run(`${BULL}const q = new Queue('m');\nq.add(name, {});\n`);
  assert.deepEqual(ids(r), ['queue:m', 'job:m/?name']);
  assert.equal(r.facts[1].origin, 'AMBIGUOUS');
});

test('bullmq: .add on a queue imported from another file is a job of an unknown queue (AMBIGUOUS)', () => {
  const r = run("import { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n", 'src/a.ts', { dir: '', name: 'x', deps: ['bullmq'] });
  assert.deepEqual(ids(r), ['job:?mailQueue/welcome']);
  assert.equal(r.facts[0].origin, 'AMBIGUOUS');
  assert.equal(r.facts[0].attrs.queue, null);
  const bull = run("import { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n", 'src/a.ts', { dir: '', name: 'x', deps: ['bull'] });
  assert.deepEqual(ids(bull), ['job:?mailQueue/welcome']);
  const typed = run("import type { Job } from 'bullmq';\nimport { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n");
  assert.deepEqual(ids(typed), ['job:?mailQueue/welcome']);
});

test('bullmq: .add on an imported queue is not a job when nothing says the project uses bullmq', () => {
  const code = "import { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n";
  assert.deepEqual(run(code).facts, []);
  assert.deepEqual(run(code, 'src/a.ts', { dir: '', name: 'x', deps: ['p-queue'] }).facts, []);
});

test('bullmq: p-queue and async queues are not jobs, even in a project that has bullmq', () => {
  const ws = { dir: '', name: 'x', deps: ['bullmq', 'p-queue', 'async'] };
  assert.deepEqual(run("import { queue } from 'async';\nqueue.add(x);\n", 'src/a.ts', ws).facts, []);
  assert.deepEqual(run("import { queue } from './lib/queue';\nqueue.add(async () => fetch('/x'));\n", 'src/a.ts', ws).facts, []);
  assert.deepEqual(run("import { queue } from './lib/queue';\nqueue.add(() => work(), { priority: 1 });\n", 'src/a.ts', ws).facts, []);
  assert.deepEqual(run("import { queue } from './lib/queue';\nqueue.add(makeTask(a, b), { priority: 1 });\n", 'src/a.ts', ws).facts, []);
});

test('bullmq: the job name must be a string or a plain name, with the data after it', () => {
  const ws = { dir: '', name: 'x', deps: ['bullmq'] };
  const r = run(`${BULL}const q = new Queue('m');\nq.add(JOBS.welcome, {});\nq.add(() => 1, {});\nq.add('alone');\n`, 'src/a.ts', ws);
  assert.deepEqual(ids(r), ['queue:m', 'job:m/?JOBS.welcome']);
});

test('bullmq: .add on a set, a list or a name that is not a queue is not a job', () => {
  const r = run(`${BULL}const q = new Queue('m');\nconst seen = new Set();\nseen.add('x');\nitems.add('y');\n`);
  assert.deepEqual(ids(r), ['queue:m']);
});

test('bullmq: a Queue class that does not come from bullmq is not read', () => {
  const r = run("import { Queue } from './my-queue';\nconst q = new Queue('local');\nq.add('x');\n");
  assert.deepEqual(r.facts, []);
});

test('bullmq: calls in comments and strings are not facts', () => {
  const r = run(`${BULL}// const q = new Queue('ghost');\nconst s = "new Queue('ghost2')";\nconst q = new Queue('real');\n// q.add('nope');\n`);
  assert.deepEqual(ids(r), ['queue:real']);
});

test('bullmq: the require form also counts as the import', () => {
  const r = run("const { Queue } = require('bullmq');\nconst q = new Queue('r');\nq.add('x', {});\n", 'src/a.js');
  assert.deepEqual(ids(r), ['queue:r', 'job:r/x']);
});

// ---------- environment variables ----------

test('env: process.env.X and process.env["X"] give the name, never a value', () => {
  const r = run("const a = process.env.API_KEY;\nconst b = process.env['DB_URL'];\nconst c = process.env[\"CACHE\"];\nprocess.env.FLAG = 'secret-value';\n");
  assert.deepEqual(ids(r), ['env:API_KEY', 'env:DB_URL', 'env:CACHE', 'env:FLAG']);
  assert.deepEqual(r.facts.map((f) => f.line), [1, 2, 3, 4]);
  assert.deepEqual(r.facts[0].attrs, { source: 'code' });
  assert.doesNotMatch(JSON.stringify(r), /secret-value/);
});

test('env: a dynamic key or a bare process.env is not a fact', () => {
  const r = run("const a = process.env[name];\nconst b = process.env;\nconst c = process.env['A' + b];\nconst d = process.environment.X;\n");
  assert.deepEqual(r.facts, []);
});

test('env: destructuring process.env gives every name, with defaults and renames, and skips the rest', () => {
  const r = run("const {\n  HOST,\n  PORT: port = 3000,\n  MODE = 'dev',\n  ...rest\n} = process.env;\n");
  assert.deepEqual(ids(r), ['env:HOST', 'env:PORT', 'env:MODE']);
  assert.deepEqual(r.facts.map((f) => f.line), [2, 3, 4]);
});

test('env: the same name twice in a file is one fact with the later place in refs', () => {
  const r = run("const a = process.env.X;\nconst b = process.env.X;\nconst c = process.env.Y;\n");
  assert.deepEqual(ids(r), ['env:X', 'env:Y']);
  assert.deepEqual(one(r, 'env:X').refs, [{ file: 'src/a.ts', line: 2 }]);
});

test('env: names in comments and strings are not facts', () => {
  const r = run("// process.env.GHOST\nconst s = 'process.env.GHOST2';\n/* process.env.GHOST3 */\n");
  assert.deepEqual(r.facts, []);
});

// ---------- integrations ----------

test('integration: an import or require of a known SDK gives integration:<package>', () => {
  const r = run("import Stripe from 'stripe';\nimport { S3Client } from '@aws-sdk/client-s3';\nconst tw = require('twilio');\nimport * as Sentry from '@sentry/node';\nimport OpenAI from 'openai';\nimport Anthropic from '@anthropic-ai/sdk';\nimport { Resend } from 'resend';\nimport nm from 'nodemailer';\nimport sg from '@sendgrid/mail';\nimport fb from 'firebase-admin';\nimport Redis from 'ioredis';\n");
  assert.deepEqual(ids(r), [
    'integration:stripe', 'integration:@aws-sdk/client-s3', 'integration:twilio', 'integration:@sentry/node', 'integration:openai',
    'integration:@anthropic-ai/sdk', 'integration:resend', 'integration:nodemailer', 'integration:@sendgrid/mail',
    'integration:firebase-admin', 'integration:ioredis',
  ]);
  assert.deepEqual(r.facts[0].attrs, { via: 'sdk', package: 'stripe' });
  assert.equal(r.facts[0].line, 1);
});

test('integration: a subpath import and a dynamic import name the package', () => {
  const r = run("import { x } from 'stripe/lib/x';\nconst m = await import('resend');\n");
  assert.deepEqual(ids(r), ['integration:stripe', 'integration:resend']);
});

test('integration: other packages, relative paths and look-alike names are not integrations', () => {
  const r = run("import a from 'react';\nimport b from './stripe';\nimport c from 'stripe-mock-helper';\nimport d from '@aws/other';\n");
  assert.deepEqual(r.facts, []);
});

// A type-only import is erased when the code is built: the file never calls the service, so it is not an integration.
test('integration: an import or re-export of types only is not an integration', () => {
  assert.deepEqual(run("import type Stripe from 'stripe';\nimport type { Charge } from 'stripe';\nexport type { Customer } from 'stripe';\n").facts, []);
  assert.deepEqual(ids(run("import type Stripe from 'stripe';\nimport { default as S } from 'stripe';\n")), ['integration:stripe']);
  assert.equal(run("import type Stripe from 'stripe';\nimport { default as S } from 'stripe';\n").facts[0].line, 2);
});

test('integration: the same SDK twice is one fact, the later import in refs', () => {
  const r = run("import a from 'stripe';\nconst b = require('stripe');\n");
  assert.deepEqual(ids(r), ['integration:stripe']);
  assert.deepEqual(r.facts[0].refs, [{ file: 'src/a.ts', line: 2 }]);
});

test('integration: a literal https URL in fetch, axios, got or new URL gives the host', () => {
  const r = run("await fetch('https://api.one.example/v1');\naxios.get(\"https://two.example/x\");\naxios('https://three.example');\nawait got.post('https://four.example/y', {});\nnew URL('https://five.example/z');\n");
  assert.deepEqual(ids(r), ['integration:api.one.example', 'integration:two.example', 'integration:three.example', 'integration:four.example', 'integration:five.example']);
  assert.deepEqual(r.facts[0].attrs, { via: 'url', host: 'api.one.example' });
  assert.deepEqual(r.facts.map((f) => f.line), [1, 2, 3, 4, 5]);
});

test('integration: the host is read when the rest of the URL is built (template or concatenation), but not when the host itself is', () => {
  const r = run("fetch(`https://good.example/items/${id}`);\nfetch('https://also.example/a/' + id);\nfetch(`https://${host}/x`);\nfetch('https://api-' + env + '.example/x');\nfetch(`https://glued.example${path}`);\n");
  assert.deepEqual(ids(r), ['integration:good.example', 'integration:also.example']);
});

test('integration: a port, user info and upper case are cleaned off the host', () => {
  const r = run("fetch('https://User:pw@Api.Example.com:8443/x');\n");
  assert.deepEqual(ids(r), ['integration:api.example.com']);
});

test('integration: localhost, loopback, private addresses and bare hostnames stay out', () => {
  const r = run("fetch('http://localhost:3000/x');\nfetch('http://127.0.0.1/x');\nfetch('http://10.0.0.5/x');\nfetch('http://192.168.1.2/x');\nfetch('http://172.20.0.1/x');\nfetch('http://0.0.0.0/x');\nfetch('http://api/x');\nfetch('http://my.local/x');\nfetch('http://[::1]/x');\nfetch('http://169.254.1.1/x');\nfetch('http://app.localhost/x');\n");
  assert.deepEqual(r.facts, []);
});

test('integration: a URL that is not an argument of those calls, or sits in a comment, is not a fact', () => {
  const r = run("const u = 'https://plain.example/x';\nlogger.info('https://log.example/x');\n// fetch('https://ghost.example/x')\nfetch(url);\nfetch('/relative');\nfoo.fetch('https://method.example');\n");
  assert.deepEqual(r.facts, []);
});

test('integration: axios.create with a literal baseURL gives the host', () => {
  const r = run("const api = axios.create({ baseURL: 'https://base.example/v2', timeout: 5 });\n");
  assert.deepEqual(ids(r), ['integration:base.example']);
});

test('integration: a public ip host is kept', () => {
  assert.deepEqual(ids(run("fetch('http://8.8.8.8/x');\n")), ['integration:8.8.8.8']);
});

// ---------- general ----------

test('facts come in line order and an empty file gives nothing', () => {
  assert.deepEqual(run('').facts, []);
  assert.deepEqual(run('').hints, []);
  const r = run("const k = process.env.A;\napp.get('/z', h);\nimport s from 'stripe';\nfastify;\n");
  const lines = r.facts.map((f) => f.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test('a jsx file is read like the others', () => {
  const r = run("export default function P() { return null; }\n", 'apps/web/app/page.jsx', { dir: 'apps/web', name: 'web', deps: ['next'] }, 'jsx');
  assert.deepEqual(ids(r), ['screen:web:/']);
});

test('a big file is read in well under a second', () => {
  const body = FASTIFY + Array.from({ length: 4000 }, (_, i) => `app.get('/r${i}', h); const v${i} = process.env.V${i % 50};\n`).join('');
  const t0 = Date.now();
  const r = run(body);
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(r.facts.filter((f) => f.kind === 'route').length, 4000);
});

test('bullmq: a queue from bull (v3) keeps bull as its lib', () => {
  const r = run("import Queue from 'bull';\nconst q = new Queue('m');\nq.add('a', {});\n");
  assert.deepEqual(r.facts.map((f) => [f.id, f.attrs.lib]), [['queue:m', 'bull'], ['job:m/a', 'bull']]);
  const imported = run("import { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n", 'src/a.ts', { dir: '', name: 'x', deps: ['bull'] });
  assert.equal(imported.facts[0].attrs.lib, 'bull');
});

// ---------- review 2: the package list only adds proof, never takes it away ----------

test('fastify: a package list without fastify still gives the routes of a file that imports fastify', () => {
  const r = run("import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/a', h);\n", 'src/a.ts', { dir: '', name: 'x', deps: ['zod'] });
  assert.deepEqual(ids(r), ['route:GET /a']);
});

test('next: a package list without next still gives the screen of a file that imports next', () => {
  const r = run("import Link from 'next/link';\nexport default function P() { return null; }\n", 'apps/web/app/page.tsx', { dir: 'apps/web', name: 'web', deps: ['react'] });
  assert.deepEqual(ids(r), ['screen:web:/']);
});

test('next: a package list without next still gives the screen when next.config sits in the package folder', () => {
  const r = run('export default function P() { return null; }\n', 'apps/web/app/page.tsx', { dir: 'apps/web', name: 'web', deps: ['react'] }, undefined, ['apps/web/next.config.js', 'apps/web/app/page.tsx']);
  assert.deepEqual(ids(r), ['screen:web:/']);
});

test('bullmq: a package list without bullmq still makes .add a job when the file imports bullmq', () => {
  const r = run("import { Job } from 'bullmq';\nimport { mailQueue } from './queues';\nmailQueue.add('welcome', {});\n", 'src/a.ts', { dir: '', name: 'x', deps: ['zod'] });
  assert.deepEqual(ids(r), ['job:?mailQueue/welcome']);
});

test('next: a workspace dir of "." takes the app name from the package name', () => {
  const r = run('export default function P() { return null; }\n', 'app/page.tsx', { dir: '.', name: '@acme/shop', deps: NEXT });
  assert.deepEqual(ids(r), ['screen:shop:/']);
});

test('env: optional chaining on process.env still gives the name', () => {
  const r = run("const a = process.env?.API_KEY;\nconst b = process.env?.['DB_URL'];\n");
  assert.deepEqual(ids(r), ['env:API_KEY', 'env:DB_URL']);
});

test('integration: a public IPv6 host is kept; loopback, unique-local and link-local ones stay out', () => {
  const r = run("fetch('http://[2001:4860:4860::8888]/x');\nfetch('http://[::1]:3000/x');\nfetch('http://[fd00::1]/x');\nfetch('http://[fc00::2]/x');\nfetch('http://[fe80::1]/x');\n");
  assert.deepEqual(ids(r), ['integration:[2001:4860:4860::8888]']);
});

test('env: destructuring from a property of process.env reached with ?. gives that property, not the destructured name', () => {
  assert.deepEqual(ids(run('const { X } = process.env?.inner;\n')), ['env:inner']);
});
