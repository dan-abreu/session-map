import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { censusOf, typeOf } from '../server/foundation/census.mjs';
import { extractAll, EXTRACTORS } from '../server/foundation/extract/index.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS, ENV_FILE } from './fixtures/repo-copy.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const answerOf = (name) => JSON.parse(readFileSync(join(FIXTURE_REPOS, `${name}.answer.json`), 'utf8'));
const expectedOf = (name) => {
  const a = answerOf(name);
  return [...a.facts, ...(a.extraFacts ?? [])];
};
const keyOf = (f) => `${f.kind} | ${f.id} | ${f.file}:${f.line} | ${f.origin}`;
const sorted = (list) => [...list].sort();
const refsOf = (f) => sorted((f.refs ?? []).map((r) => `${r.file}:${r.line}`));

function spyRead(root) {
  const reads = [];
  const readText = (path) => { reads.push(path); return readFileSync(join(root, path), 'utf8'); };
  return { reads, readText };
}

async function withFixture(name, fn) {
  const root = copyFixtureRepo(name);
  try { await fn(root); } finally { removeFixtureRepo(root); }
}

// ---------- the three answer keys ----------

for (const name of ['acme-shop', 'acme-delivery', 'acme-lib']) {
  test(`${name}: the joined facts are exactly the answer key (id, kind, file, line, origin) and nothing more`, async () => {
    await withFixture(name, async (root) => {
      const census = await censusOf(root, null);
      const out = extractAll(root, census, null, { now: NOW });
      assert.deepEqual(sorted(out.facts.map(keyOf)), sorted(expectedOf(name).map(keyOf)));
    });
  });

  test(`${name}: the places a fact is also seen at (refs) are the key's`, async () => {
    await withFixture(name, async (root) => {
      const census = await censusOf(root, null);
      const out = extractAll(root, census, null, { now: NOW });
      const got = new Map(out.facts.map((f) => [f.id, refsOf(f)]));
      for (const want of expectedOf(name)) assert.deepEqual(got.get(want.id), sorted((want.refs ?? []).map((r) => `${r.file}:${r.line}`)), want.id);
    });
  });
}

test('acme-shop: the route registered with a prefix is INFERRED and keeps the file and line of its declaration', async () => {
  await withFixture('acme-shop', async (root) => {
    const out = extractAll(root, await censusOf(root, null), null, { now: NOW });
    const byId = new Map(out.facts.map((f) => [f.id, f]));
    const route = byId.get('route:GET /v1/orders/:id');
    assert.equal(route.origin, 'INFERRED');
    assert.equal(route.file, 'apps/api/src/routes/orders.ts');
    assert.equal(route.line, 6);
    assert.equal(route.attrs.path, '/v1/orders/:id');
    assert.equal(byId.has('route:GET /orders/:id'), false, 'the unprefixed twin must not exist');
    assert.equal(byId.get('route:GET ?ADMIN_PATH').origin, 'AMBIGUOUS');
    assert.equal(byId.get('route:GET ?ADMIN_PATH').attrs.path, null);
  });
});

test('acme-shop: queue:emails is one fact (the Queue) and the Worker is a ref, without the internal "use" mark', async () => {
  await withFixture('acme-shop', async (root) => {
    const out = extractAll(root, await censusOf(root, null), null, { now: NOW });
    const queues = out.facts.filter((f) => f.id === 'queue:emails');
    assert.equal(queues.length, 1);
    assert.equal(queues[0].origin, 'EXTRACTED');
    assert.equal(queues[0].file, 'apps/worker/src/queues.ts');
    assert.deepEqual(queues[0].refs.map((r) => `${r.file}:${r.line}`), ['apps/worker/src/worker.ts:10']);
    assert.equal('use' in queues[0].attrs, false);
  });
});

test('acme-delivery: the dispatch call is a ref of the job, and the screens come from the routes', async () => {
  await withFixture('acme-delivery', async (root) => {
    const out = extractAll(root, await censusOf(root, null), null, { now: NOW });
    const job = out.facts.find((f) => f.id === 'job:mail/SendReceipt');
    assert.deepEqual(job.refs.map((r) => `${r.file}:${r.line}`), ['backend/app/Http/Controllers/OrderController.php:18']);
    assert.ok(out.facts.some((f) => f.id === 'screen:customer:/orders/:id'));
  });
});

// ---------- the shape of facts.json ----------

test('facts.json: version, generatedAt, censusRev, one entry per read file, and every fact carries the sha and the extractor', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const out = extractAll(root, census, null, { now: NOW });
    assert.equal(out.version, 1);
    assert.equal(out.generatedAt, NOW.toISOString());
    assert.equal(out.censusRev, census.rev);
    const shaOf = new Map(census.files.map((f) => [f.path, f.sha]));
    for (const f of out.facts) {
      assert.equal(f.sha, shaOf.get(f.file), `${f.id} sha`);
      assert.match(f.extractor, /^[a-z]+@\d+$/);
      assert.ok(['EXTRACTED', 'INFERRED', 'AMBIGUOUS'].includes(f.origin));
      assert.equal(typeof f.name, 'string');
    }
    const orders = out.files['apps/api/src/routes/orders.ts'];
    assert.equal(orders.sha, shaOf.get('apps/api/src/routes/orders.ts'));
    assert.match(orders.extractor, /js@1/);
    assert.ok(orders.factIds.includes('route:GET /v1/orders/:id'));
    for (const [path, entry] of Object.entries(out.files)) {
      for (const id of entry.factIds) assert.equal(out.facts.find((f) => f.id === id).file, path);
    }
  });
});

test('nothing in the output is a value: the .env content never shows and the .env is never read', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const { reads, readText } = spyRead(root);
    const out = extractAll(root, census, null, { readText, now: NOW });
    assert.equal(reads.includes('.env'), false);
    assert.equal(JSON.stringify(out).includes('do-not-read-42'), false);
    assert.ok(ENV_FILE.includes('do-not-read-42'));
    // even when a census wrongly lists the secret as included, it is not opened
    const tampered = { ...census, files: census.files.map((f) => (f.path === '.env' ? { ...f, included: true, sha: 'a'.repeat(16) } : f)) };
    const spy = spyRead(root);
    extractAll(root, tampered, null, { readText: spy.readText, now: NOW });
    assert.equal(spy.reads.includes('.env'), false);
  });
});

test('a file the census left out (included: false) is never read', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const left = new Set(census.files.filter((f) => !f.included).map((f) => f.path));
    assert.ok(left.size >= 3);
    const { reads, readText } = spyRead(root);
    extractAll(root, census, null, { readText, now: NOW });
    assert.ok(reads.length > 20);
    for (const p of reads) assert.equal(left.has(p), false, p);
  });
});

// ---------- incremental ----------

test('second run with the same census reads nothing and gives the same facts', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const first = extractAll(root, census, null, { now: NOW });
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census, first, { readText, now: NOW });
    assert.deepEqual(reads, []);
    assert.deepEqual(second, first);
  });
});

test('the previous facts survive a JSON round trip (the disk copy is what the next run gets)', async () => {
  await withFixture('acme-delivery', async (root) => {
    const census = await censusOf(root, null);
    const first = extractAll(root, census, null, { now: NOW });
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census, JSON.parse(JSON.stringify(first)), { readText, now: NOW });
    assert.deepEqual(reads, []);
    assert.deepEqual(second, first);
  });
});

test('editing one file reads and re-extracts only that file', async () => {
  await withFixture('acme-shop', async (root) => {
    const census1 = await censusOf(root, null);
    const first = extractAll(root, census1, null, { now: NOW });
    appendFileSync(join(root, 'apps/api/src/services/orders.ts'), '\nexport function extraHelper() { return 1; }\n');
    const census2 = await censusOf(root, census1);
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census2, first, { readText, now: NOW });
    assert.deepEqual(reads, ['apps/api/src/services/orders.ts']);
    const ids = new Set(second.facts.map((f) => f.id));
    assert.ok(ids.has('fn:apps/api/src/services/orders.ts#extraHelper'));
    assert.ok(ids.has('export:apps/api/src/services/orders.ts#extraHelper'));
    const before = new Set(first.facts.map((f) => f.id));
    for (const id of before) assert.ok(ids.has(id), `${id} lost`);
    assert.equal(second.facts.length, first.facts.length + 2);
    // the same result as a run from nothing
    const fresh = extractAll(root, census2, null, { now: NOW });
    assert.deepEqual(second, fresh);
  });
});

test('editing the registered file keeps the prefix that the untouched server file gave it (the whole file runs under it)', async () => {
  await withFixture('acme-shop', async (root) => {
    const census1 = await censusOf(root, null);
    const first = extractAll(root, census1, null, { now: NOW });
    appendFileSync(join(root, 'apps/api/src/routes/orders.ts'), "\nexport async function more(app: FastifyInstance) {\n  app.get('/more', async () => 1);\n}\n");
    const census2 = await censusOf(root, census1);
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census2, first, { readText, now: NOW });
    assert.deepEqual(reads, ['apps/api/src/routes/orders.ts']);
    assert.ok(second.facts.some((f) => f.id === 'route:GET /v1/orders/:id'));
    assert.ok(second.facts.some((f) => f.id === 'route:GET /v1/more'), 'the whole file runs under the prefix its registrar gave it');
  });
});

test('a removed file takes its facts and its entry with it, without reading anything', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const first = extractAll(root, census, null, { now: NOW });
    const smaller = { ...census, rev: census.rev + 1, files: census.files.filter((f) => f.path !== 'apps/worker/src/templates.ts') };
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, smaller, first, { readText, now: NOW });
    assert.deepEqual(reads, []);
    assert.equal('apps/worker/src/templates.ts' in second.files, false);
    assert.equal(second.facts.some((f) => f.file === 'apps/worker/src/templates.ts'), false);
    assert.equal(second.facts.some((f) => f.id.includes('renderWelcome') && f.kind === 'call'), false);
  });
});

test('raising the version of one extractor re-reads only the files of its types', async () => {
  await withFixture('acme-shop', async (root) => {
    const census = await censusOf(root, null);
    const first = extractAll(root, census, null, { now: NOW });
    const bumped = EXTRACTORS.map((e) => (e.VERSION === 'prisma@1' ? { ...e, VERSION: 'prisma@2' } : e));
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census, first, { readText, now: NOW, extractors: bumped });
    assert.deepEqual(reads, ['packages/db/prisma/schema.prisma']);
    assert.match(second.files['packages/db/prisma/schema.prisma'].extractor, /prisma@2/);
    assert.deepEqual(second.facts, first.facts);

    const jsBumped = EXTRACTORS.map((e) => (e.VERSION === 'js@1' ? { ...e, VERSION: 'js@2' } : e));
    const spy = spyRead(root);
    extractAll(root, census, first, { readText: spy.readText, now: NOW, extractors: jsBumped });
    const jsFiles = census.files.filter((f) => f.included && ['js', 'ts', 'tsx', 'jsx'].includes(f.type)).map((f) => f.path);
    assert.deepEqual(sorted(spy.reads), sorted(jsFiles));
  });
});

test('a facts.json of another version is ignored: everything is read again', async () => {
  await withFixture('acme-lib', async (root) => {
    const census = await censusOf(root, null);
    const first = extractAll(root, census, null, { now: NOW });
    const { reads, readText } = spyRead(root);
    const second = extractAll(root, census, { ...first, version: 2 }, { readText, now: NOW });
    assert.ok(reads.includes('src/index.js'));
    assert.deepEqual(second.facts, first.facts);
  });
});

// ---------- joins on small invented projects ----------

function project(files, { included = {}, readFails = [] } = {}) {
  const text = new Map(Object.entries(files));
  const census = {
    version: 1, rev: 1,
    files: [...text.keys()].map((path) => ({
      path, type: typeOf(path), kind: 'code', included: included[path] ?? true, reason: null, bytes: text.get(path).length,
      sha: createHash('sha256').update(text.get(path)).digest('hex').slice(0, 16), owner: null,
    })),
  };
  const reads = [];
  const readText = (path) => {
    reads.push(path);
    if (readFails.includes(path)) throw new Error('unreadable');
    return text.get(path);
  };
  return { root: 'C:/nowhere/acme-demo', census, reads, readText };
}
const FASTIFY_PKG = JSON.stringify({ name: 'api', dependencies: { fastify: '^5' } });
const idsOf = (out, kind) => out.facts.filter((f) => f.kind === kind).map((f) => f.id).sort();
const run = (p, prev = null, extra = {}) => extractAll(p.root, p.census, prev, { readText: p.readText, now: NOW, ...extra });

test('a rule repeated in two files is one AMBIGUOUS fact with both places in refs', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'a.ts': "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/ping', h);\n",
    'b.ts': "import Fastify from 'fastify';\nconst app = Fastify();\n\napp.get('/ping', h);\napp.get('/solo', h);\n",
  });
  const out = run(p);
  const ping = out.facts.filter((f) => f.id === 'route:GET /ping');
  assert.equal(ping.length, 1);
  assert.equal(ping[0].origin, 'AMBIGUOUS');
  assert.equal(`${ping[0].file}:${ping[0].line}`, 'a.ts:3');
  assert.deepEqual(ping[0].refs, [{ file: 'a.ts', line: 3 }, { file: 'b.ts', line: 4 }]);
  assert.equal(out.facts.find((f) => f.id === 'route:GET /solo').origin, 'EXTRACTED');
});

test('the same rule twice at the same place is one EXTRACTED fact, not AMBIGUOUS', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'a.ts': "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/ping', h); app.get('/ping', h);\n",
  });
  const ping = run(p).facts.filter((f) => f.id === 'route:GET /ping');
  assert.equal(ping.length, 1);
  assert.equal(ping[0].origin, 'EXTRACTED');
  assert.equal(`${ping[0].file}:${ping[0].line}`, 'a.ts:3');
  assert.deepEqual(ping[0].refs, []);
});

test('two Queue definitions of one name put both places in refs too', () => {
  const p = project({
    'package.json': JSON.stringify({ name: 'w', dependencies: { bullmq: '^5' } }),
    'a.ts': "import { Queue } from 'bullmq';\nexport const q = new Queue('mail');\n",
    'b.ts': "import { Queue } from 'bullmq';\n\nexport const q = new Queue('mail');\n",
  });
  const q = run(p).facts.find((f) => f.id === 'queue:mail');
  assert.equal(q.origin, 'AMBIGUOUS');
  assert.deepEqual(q.refs, [{ file: 'a.ts', line: 2 }, { file: 'b.ts', line: 3 }]);
});

test('the same name read in many places (env, integration) stays EXTRACTED: the .env.example line is the definition', () => {
  const p = project({
    'package.json': JSON.stringify({ name: 'app' }),
    'src/a.ts': 'export const url = process.env.DATABASE_URL;\n',
    'src/b.ts': 'export const again = process.env.DATABASE_URL;\n',
    '.env.example': 'DATABASE_URL=\nOTHER=\n',
  });
  const out = run(p);
  const env = out.facts.filter((f) => f.id === 'env:DATABASE_URL');
  assert.equal(env.length, 1);
  assert.equal(env[0].origin, 'EXTRACTED');
  assert.equal(`${env[0].file}:${env[0].line}`, '.env.example:1');
  assert.equal(env[0].attrs.source, 'example');
  assert.deepEqual(env[0].refs, [{ file: 'src/a.ts', line: 1 }, { file: 'src/b.ts', line: 1 }]);
});

test('prefixes join across files, outermost first, and a registered file keeps only the prefixed routes', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'server.ts': "import Fastify from 'fastify';\nimport { api } from './api';\nconst app = Fastify();\napp.register(api, { prefix: '/api' });\n",
    'api.ts': "import { orders } from './orders';\nexport async function api(app) {\n  app.register(orders, { prefix: '/orders' });\n}\n",
    'orders.ts': "export async function orders(app) {\n  app.get('/:id', h);\n  app.get('/', h);\n}\n",
  });
  const out = run(p);
  assert.deepEqual(idsOf(out, 'route'), ['route:GET /api/orders', 'route:GET /api/orders/:id']);
  for (const f of out.facts.filter((x) => x.kind === 'route')) {
    assert.equal(f.origin, 'INFERRED');
    assert.equal(f.file, 'orders.ts');
    assert.equal(f.attrs.path.startsWith('/api/orders'), true);
  }
});

test('a file registered under two prefixes gives its routes under both', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'server.ts': "import Fastify from 'fastify';\nimport { users } from './users';\nconst app = Fastify();\napp.register(users, { prefix: '/v1' });\napp.register(users, { prefix: '/v2' });\n",
    'users.ts': "export async function users(app) {\n  app.get('/u', h);\n}\n",
  });
  assert.deepEqual(idsOf(run(p), 'route'), ['route:GET /v1/u', 'route:GET /v2/u']);
});

test('a prefix the program cannot read makes the routes AMBIGUOUS with a null path, not a guess', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'server.ts': "import Fastify from 'fastify';\nimport { users } from './users';\nconst app = Fastify();\napp.register(users, { prefix: PREFIX });\n",
    'users.ts': "export async function users(app) {\n  app.get('/u', h);\n}\n",
  });
  const routes = run(p).facts.filter((f) => f.kind === 'route');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].origin, 'AMBIGUOUS');
  assert.equal(routes[0].attrs.path, null);
  assert.equal(routes[0].id.startsWith('route:GET ?'), true);
});

test('a prefix on an AMBIGUOUS route (a path in a variable) keeps it AMBIGUOUS and names the prefix', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'server.ts': "import Fastify from 'fastify';\nimport { users } from './users';\nconst app = Fastify();\napp.register(users, { prefix: '/v1' });\n",
    'users.ts': "export async function users(app) {\n  app.get(WHERE, h);\n}\n",
  });
  const routes = run(p).facts.filter((f) => f.kind === 'route');
  assert.deepEqual(routes.map((f) => f.id), ['route:GET ?/v1${WHERE}']);
  assert.equal(routes[0].origin, 'AMBIGUOUS');
});

test('two files that register each other do not hang: with no root there is no known prefix, so the routes are AMBIGUOUS', () => {
  const p = project({
    'package.json': FASTIFY_PKG,
    'a.ts': "import { b } from './b';\nexport async function a(app) {\n  app.get('/a', h);\n  app.register(b, { prefix: '/b' });\n}\n",
    'b.ts': "import { a } from './a';\nexport async function b(app) {\n  app.get('/b', h);\n  app.register(a, { prefix: '/a' });\n}\n",
  });
  const routes = run(p).facts.filter((f) => f.kind === 'route');
  assert.ok(routes.length >= 2);
  assert.ok(routes.every((f) => f.origin === 'AMBIGUOUS' && f.attrs.path === null));
});

test('a chain of registrations deeper than the program follows is AMBIGUOUS with a null path, not a guess without the outer prefixes', () => {
  const files = { 'package.json': FASTIFY_PKG };
  const N = 20;
  for (let i = 0; i < N; i++) {
    files[`r${i}.ts`] = `import { r${i + 1} } from './r${i + 1}';\nexport async function r${i}(app) {\n  app.register(r${i + 1}, { prefix: '/p${i + 1}' });\n}\n`;
  }
  files[`r${N}.ts`] = `export async function r${N}(app) {\n  app.get('/leaf', h);\n}\n`;
  const routes = run(project(files)).facts.filter((f) => f.kind === 'route');
  assert.ok(routes.length >= 1);
  assert.ok(routes.every((f) => f.origin === 'AMBIGUOUS' && f.attrs.path === null), JSON.stringify(routes.map((f) => [f.id, f.origin])));
});

test('a worker with no Queue of its own in the project: the first use becomes the definition', () => {
  const p = project({
    'package.json': JSON.stringify({ name: 'w', dependencies: { bullmq: '^5' } }),
    'w.ts': "import { Worker } from 'bullmq';\nnew Worker('mail', async () => {});\n",
  });
  const q = run(p).facts.filter((f) => f.kind === 'queue');
  assert.equal(q.length, 1);
  assert.equal(q[0].origin, 'EXTRACTED');
  assert.equal('use' in q[0].attrs, false);
});

test('two Queue definitions of one name in different files are AMBIGUOUS', () => {
  const p = project({
    'package.json': JSON.stringify({ name: 'w', dependencies: { bullmq: '^5' } }),
    'a.ts': "import { Queue } from 'bullmq';\nexport const q = new Queue('mail');\n",
    'b.ts': "import { Queue } from 'bullmq';\nexport const q = new Queue('mail');\n",
  });
  const q = run(p).facts.filter((f) => f.kind === 'queue');
  assert.equal(q.length, 1);
  assert.equal(q[0].origin, 'AMBIGUOUS');
  assert.equal(q[0].refs.length, 2);
});

test('a project with no manifest still works: the workspace is the root, named after the folder', () => {
  const p = project({ 'src/a.ts': 'export const port = process.env.PORT;\n' });
  assert.deepEqual(idsOf(run(p), 'env'), ['env:PORT']);
});

test('changing a package.json re-reads the files of that package (its dependencies decide what is a route)', () => {
  const files = {
    'package.json': JSON.stringify({ name: 'api' }),
    'src/s.ts': "const app = make();\napp.get('/x', h);\n",
    'other/o.ts': 'export const o = 1;\n',
  };
  const first = run(project(files));
  assert.deepEqual(idsOf(first, 'route'), []);
  const changed = project({ ...files, 'package.json': FASTIFY_PKG });
  const second = run(changed, first);
  assert.deepEqual(idsOf(second, 'route'), ['route:GET /x']);
  assert.ok(changed.reads.includes('src/s.ts'));
  assert.ok(changed.reads.includes('other/o.ts'), 'both files belong to the root package');
});

test('a file that cannot be read is skipped and tried again next time; the rest is fine', () => {
  const files = { 'a.ts': 'export function a() {}\n', 'b.ts': 'export function b() {}\n' };
  const broken = project(files, { readFails: ['b.ts'] });
  const first = run(broken);
  assert.deepEqual(idsOf(first, 'function'), ['fn:a.ts#a']);
  const healthy = project(files);
  const second = run(healthy, first);
  assert.deepEqual(healthy.reads, ['b.ts']);
  assert.deepEqual(idsOf(second, 'function'), ['fn:a.ts#a', 'fn:b.ts#b']);
});

test('an extractor that throws on one file loses only that file for that extractor', () => {
  const boom = { VERSION: 'boom@1', TYPES: ['ts'], extract({ path }) { if (path === 'a.ts') throw new Error('bug'); return { facts: [], hints: [] }; } };
  const p = project({ 'a.ts': 'export function a() {}\n', 'b.ts': 'export function b() {}\n' });
  const out = run(p, null, { extractors: [...EXTRACTORS, boom] });
  assert.deepEqual(idsOf(out, 'function'), ['fn:a.ts#a', 'fn:b.ts#b']);
});

test('Dart package: names and PHP psr-4 names resolve from the manifests the run read (not from the disk under root)', () => {
  const p = project({
    'app/pubspec.yaml': 'name: acme_app\n',
    'app/lib/main.dart': "import 'package:acme_app/home.dart';\nvoid main() {}\n",
    'app/lib/home.dart': 'class Home {}\n',
    'composer.json': JSON.stringify({ name: 'acme/api', autoload: { 'psr-4': { 'App\\': 'app/' } } }),
    'app/Http/Kernel.php': '<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nclass Kernel {}\n',
    'app/Models/User.php': '<?php\nnamespace App\\Models;\nclass User {}\n',
  });
  const ids = idsOf(run(p), 'import');
  assert.ok(ids.includes('import:app/lib/main.dart->app/lib/home.dart'), ids.join('\n'));
  assert.ok(ids.includes('import:app/Http/Kernel.php->app/Models/User.php'), ids.join('\n'));
});

test('a second run resolves Dart names from the kept manifests, reading nothing', () => {
  const files = {
    'pubspec.yaml': 'name: acme_app\n',
    'lib/main.dart': "import 'package:acme_app/home.dart';\nvoid main() {}\n",
    'lib/home.dart': 'class Home {}\n',
  };
  const first = run(project(files));
  const again = project(files);
  const second = run(again, JSON.parse(JSON.stringify(first)));
  assert.deepEqual(again.reads, []);
  assert.ok(idsOf(second, 'import').includes('import:lib/main.dart->lib/home.dart'));
});

test('a manifest kept by an older workspace version is read again, not trusted because its sha is the same', () => {
  const files = { 'package.json': FASTIFY_PKG, 'src/s.ts': "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/x', h);\n" };
  const first = run(project(files));
  const stale = JSON.parse(JSON.stringify(first));
  stale.files['package.json'].extractor = 'workspace@0';
  stale.files['package.json'].raw.manifest = { kind: 'js', dir: '', name: 'old', deps: [] };
  const again = project(files);
  const second = run(again, stale);
  assert.ok(again.reads.includes('package.json'));
  assert.equal(second.files['package.json'].raw.manifest.name, 'api');
  assert.deepEqual(second.files['package.json'].raw.manifest.deps, ['fastify']);
  assert.deepEqual(idsOf(second, 'route'), ['route:GET /x']);
});

test('imports between project files become import facts; a library does not', () => {
  const p = project({
    'a.ts': "import { b } from './b';\nimport express from 'express';\nimport { b2 } from './b';\nexport const a = b;\n",
    'b.ts': 'export const b = 1;\nexport const b2 = 2;\n',
  });
  const imports = run(p).facts.filter((f) => f.kind === 'import');
  assert.equal(imports.length, 1);
  assert.equal(imports[0].id, 'import:a.ts->b.ts');
  assert.equal(imports[0].line, 1);
  assert.deepEqual(imports[0].refs, [{ file: 'a.ts', line: 3 }]);
  assert.equal(imports[0].origin, 'EXTRACTED');
});

test('a secrets file the census wrongly lists as included is still never opened (even with a language the readers know)', () => {
  const p = project({ '.env.local.ts': 'export const k = process.env.LEAKED_NAME;\n', 'src/a.ts': 'export function a() {}\n' });
  const out = run(p);
  assert.deepEqual(p.reads, ['src/a.ts']);
  assert.equal(JSON.stringify(out).includes('LEAKED_NAME'), false);
});

test('an empty census gives an empty, well-formed result', () => {
  const out = extractAll('C:/nowhere/acme-demo', { version: 1, rev: 3, files: [] }, null, { readText: () => { throw new Error('no reads'); }, now: NOW });
  assert.deepEqual(out, { version: 1, generatedAt: NOW.toISOString(), censusRev: 3, files: {}, facts: [] });
});

test('the output is stable: the same census gives the same JSON twice, whatever the order of the census rows', async () => {
  await withFixture('acme-delivery', async (root) => {
    const census = await censusOf(root, null);
    const a = extractAll(root, census, null, { now: NOW });
    const shuffled = { ...census, files: [...census.files].reverse() };
    const b = extractAll(root, shuffled, null, { now: NOW });
    assert.equal(JSON.stringify(a.facts), JSON.stringify(b.facts));
  });
});
