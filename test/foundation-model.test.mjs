import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel, goldenRule } from '../server/foundation/model.mjs';
import { refreshFoundation, readStep } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { loadConfig } from '../server/config.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

// The single model (fd03), levels 1 to 3, built by the program from the readers' facts and the census, held to the
// answer keys written by other hands (test/fixtures/repos/<name>.model-answer.json).

const keyOf = (name) => JSON.parse(readFileSync(join(FIXTURE_REPOS, `${name}.model-answer.json`), 'utf8'));
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const hashOf = (evidence) => createHash('sha256').update(evidence.map((e) => e.sha).join('\n')).digest('hex').slice(0, 16);
const fileLines = (root) => (path) => {
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

// One reading round on a copy of the fixture: census, facts and the architecture, as the refresh will hand them over.
async function readFixture(name) {
  const root = copyFixtureRepo(name);
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdmodel-'));
  const id = `${name}-0a0b0c`;
  let t = Date.now();
  const read = async () => {
    const out = await refreshFoundation({ id, name, root }, smDir, { steps: [readStep()], now: () => (t += 60_000) });
    assert.ok(out.steps?.[0]?.ok, JSON.stringify(out));
    const arch = await readArch(root, loadConfig(root, smDir), { mainBranch: 'main' });
    return { census: readFd(smDir, id, 'census.json'), facts: readFd(smDir, id, 'facts.json'), arch };
  };
  return { root, smDir, name, read, ...(await read()), done: () => { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
}

// The tests that only read share one round per fixture; a test that edits the copy takes its own.
const shared = new Map();
function sharedFixture(name) {
  if (!shared.has(name)) shared.set(name, readFixture(name));
  return shared.get(name).then((fx) => ({ ...fx, done() {} }));
}
test.after(async () => { for (const p of shared.values()) (await p).done(); });

const build = (fx, over = {}) => buildModel(over.facts ?? fx.facts, over.census ?? fx.census, over.arch ?? fx.arch, {}, { name: fx.name, linesOf: fileLines(fx.root) });

const sameEvidence = (a, b) => a.file === b.file && a.line === b.line && (b.factId === undefined || a.factId === b.factId);

for (const name of ['acme-shop', 'acme-delivery']) {
  test(`${name}: the model is the answer key, all of it and nothing else (a)`, async () => {
    const fx = await sharedFixture(name);
    try {
      const key = keyOf(name);
      const model = build(fx);
      assert.deepEqual(model.nodes.map((n) => n.id), key.nodes.map((n) => n.id).sort(), 'the same nodes');
      assert.deepEqual(model.edges.map((e) => e.id), key.edges.map((e) => e.id).sort(), 'the same edges');
      const nodes = new Map(model.nodes.map((n) => [n.id, n]));
      for (const want of key.nodes) {
        const got = nodes.get(want.id);
        for (const k of ['level', 'kind', 'parentId', 'partId', 'tech', 'origin', 'files']) {
          if (k in want) assert.deepEqual(got[k], want[k], `${want.id}.${k}`);
        }
        if (want.id !== 'sys') assert.equal(got.name, want.name, `${want.id}.name`);
        for (const e of want.evidence ?? []) assert.ok(got.evidence.some((g) => sameEvidence(g, e)), `${want.id} lacks ${e.file}:${e.line}`);
      }
      const edges = new Map(model.edges.map((e) => [e.id, e]));
      for (const want of key.edges) {
        const got = edges.get(want.id);
        for (const k of ['from', 'to', 'kind', 'label', 'origin']) assert.deepEqual(got[k], want[k], `${want.id}.${k}`);
        for (const e of want.evidence) assert.ok(got.evidence.some((g) => sameEvidence(g, e)), `${want.id} lacks ${e.file}:${e.line}`);
      }
      for (const id of key.forbidden) assert.ok(!nodes.has(id) && !edges.has(id), `invented: ${id}`);
      assert.deepEqual(model.journeys, []);
      assert.deepEqual(model.stale, []);
      assert.deepEqual(model.draft, { nodes: [], edges: [] });
      assert.equal(model.version, 1);
      assert.equal(model.factsRev, fx.facts.censusRev);
    } finally { fx.done(); }
  });

  test(`${name}: every node but the system and every edge has an origin and evidence that resolves to a file, line and sha of now (b)`, async () => {
    const fx = await sharedFixture(name);
    try {
      const model = build(fx);
      const rows = new Map(fx.census.files.filter((f) => f.included).map((f) => [f.path, f]));
      const items = [...model.nodes.filter((n) => n.id !== 'sys'), ...model.edges];
      for (const item of items) {
        assert.ok(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'DECLARED'].includes(item.origin), `${item.id}: origin`);
        assert.ok(item.evidence.length > 0, `${item.id}: evidence`);
        for (const e of item.evidence) {
          assert.ok(rows.has(e.file), `${item.id}: ${e.file} is in the census`);
          const buf = readFileSync(join(fx.root, e.file));
          const lines = fileLines(fx.root)(e.file);
          assert.ok(Number.isInteger(e.line) && e.line >= 1 && e.line <= lines.length, `${item.id}: ${e.file}:${e.line} exists`);
          assert.equal(e.sha, sha16(buf), `${item.id}: ${e.file} sha is the current one`);
        }
        assert.equal(item.hash, hashOf(item.evidence), `${item.id}: hash of the evidence shas`);
      }
      // a component points at its files' first line that is not blank, a container at the line of its name
      for (const n of model.nodes.filter((x) => x.kind === 'component')) {
        for (const e of n.evidence) assert.notEqual(fileLines(fx.root)(e.file)[e.line - 1].trim(), '', `${n.id}: ${e.file}:${e.line}`);
      }
      for (const n of model.nodes.filter((x) => x.kind === 'container')) assert.match(fileLines(fx.root)(n.evidence[0].file)[n.evidence[0].line - 1], /name/);
    } finally { fx.done(); }
  });
}

test('same facts give the same model byte for byte, whatever order they come in (c)', async () => {
  const fx = await sharedFixture('acme-shop');
  try {
    const a = JSON.stringify(build(fx));
    const facts = { ...fx.facts, facts: [...fx.facts.facts].reverse() };
    const census = { ...fx.census, files: [...fx.census.files].reverse() };
    assert.equal(JSON.stringify(build(fx, { facts, census })), a);
    assert.equal(JSON.stringify(build(fx)), a);
  } finally { fx.done(); }
});

test('golden rule: acme-delivery has a node for every part and a part for every component (d)', async () => {
  const fx = await sharedFixture('acme-delivery');
  try {
    assert.deepEqual(goldenRule(build(fx), fx.arch), keyOf('acme-delivery').goldenRule);
  } finally { fx.done(); }
});

test('golden rule: in acme-shop only the admin pages have no part, and taking a part out of the map shows its component (d)', async () => {
  const fx = await readFixture('acme-shop');
  try {
    assert.deepEqual(goldenRule(build(fx), fx.arch), keyOf('acme-shop').goldenRule);
    // the part "db" leaves the architecture: its file and its line in the README go
    const readme = join(fx.root, 'docs/architecture/README.md');
    writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n## Data\n\n- \[Database\]\(db\.md\)\n?/, '\n'));
    rmSync(join(fx.root, 'docs/architecture/db.md'));
    const after = await fx.read();
    assert.ok(!after.arch.parts.some((p) => p.id === 'db'));
    const model = build(fx, after);
    assert.equal(model.nodes.find((n) => n.id === 'cmp:packages/db/prisma').partId, null);
    assert.deepEqual(goldenRule(model, after.arch), { partsWithoutNode: [], nodesWithoutPart: ['cmp:apps/admin/pages', 'cmp:packages/db/prisma'] });
  } finally { fx.done(); }
});

test('golden rule: a part of the map that holds no code is a part without a node', async () => {
  const fx = await sharedFixture('acme-shop');
  try {
    const arch = { ...fx.arch, parts: [...fx.arch.parts, { ...fx.arch.parts[0], id: 'billing', name: 'Billing', file: 'docs/architecture/billing.md', codePaths: [] }] };
    assert.deepEqual(goldenRule(build(fx, { arch }), arch), { partsWithoutNode: ['billing'], nodesWithoutPart: ['cmp:apps/admin/pages'] });
  } finally { fx.done(); }
});

// ---------- synthetic facts: what the fixtures do not have ----------

const SHA = (path) => sha16(Buffer.from(path));
function censusOfRows(rows) {
  return {
    version: 1, rev: 3,
    files: rows.map(([path, total, owner = null, kind = 'code']) => ({
      path, type: path.endsWith('.json') ? 'json' : 'ts', kind, included: true, lines: { total, code: total, comment: 0, blank: 0 }, sha: SHA(path), owner,
    })),
  };
}
const fact = (id, kind, file, line, attrs = {}, extra = {}) => ({ id, kind, name: id.slice(id.indexOf(':') + 1), file, line, sha: SHA(file), origin: 'EXTRACTED', attrs, refs: [], ...extra });
const factsOf = (list) => ({ version: 1, censusRev: 3, files: {}, facts: list });
const partsArch = (parts) => ({ parts: parts.map(([id, codePaths]) => ({ id, name: id, file: `docs/architecture/${id}.md`, codePaths })) });

test('a component whose files belong to two parts takes the part with more lines and says AMBIGUOUS with both parts', () => {
  const census = censusOfRows([
    ['apps/api/package.json', 5], ['apps/api/src/billing/charge.ts', 40], ['apps/api/src/billing/refund.ts', 10],
  ]);
  const arch = partsArch([['payments', ['apps/api/src/billing/charge.ts']], ['refunds', ['apps/api/src/billing/refund.ts']]]);
  const model = buildModel(factsOf([]), census, arch, {});
  const cmp = model.nodes.find((n) => n.id === 'cmp:apps/api/src/billing');
  assert.equal(cmp.partId, 'payments');
  assert.equal(cmp.origin, 'AMBIGUOUS');
  assert.deepEqual(cmp.attrs.parts, ['payments', 'refunds']);
  assert.deepEqual(goldenRule(model, arch), { partsWithoutNode: [], nodesWithoutPart: [] }, 'both parts have the node');
});

const httpWorld = (routes, call) => {
  const census = censusOfRows([
    ['apps/api/package.json', 5], ['apps/api/src/server.ts', 30], ['apps/web/package.json', 5], ['apps/web/lib/api.ts', 20],
  ]);
  const facts = factsOf([...routes, call].filter(Boolean));
  return buildModel(facts, census, null, {});
};
// a call of the project itself: a relative URL, no host (decision 4: "URL do próprio projeto")
const callTo = (path, method = 'GET') => fact(`integration:${path}`, 'integration', 'apps/web/lib/api.ts', 4, { via: 'url', path, method });
const route = (method, path, line, origin = 'EXTRACTED') => fact(`route:${method} ${path ?? '?X'}`, 'route', 'apps/api/src/server.ts', line, { method, path, framework: 'fastify' }, { origin });

test('an http arrow is drawn only when a call of the project names a route of another container, labeled by the program', () => {
  const model = httpWorld([route('GET', '/orders/:id', 10), route('POST', '/orders', 12)], callTo('/orders/42'));
  const edge = model.edges.find((e) => e.kind === 'http');
  assert.equal(edge.id, 'ctr:apps/web->ctr:apps/api:http');
  assert.equal(edge.origin, 'INFERRED');
  assert.deepEqual(edge.label, { msg: 'edge.http', params: { what: 'GET /orders/:id' } });
  assert.deepEqual(edge.evidence.map((e) => `${e.file}:${e.line}:${e.factId}`).sort(),
    ['apps/api/src/server.ts:10:route:GET /orders/:id', 'apps/web/lib/api.ts:4:integration:/orders/42']);
  assert.equal(httpWorld([route('GET', '/orders/:id', 10)], callTo('/customers')).edges.filter((e) => e.kind === 'http').length, 0, 'no route named, no arrow');
  assert.equal(httpWorld([route('GET', '/orders/:id', 10)], null).edges.filter((e) => e.kind === 'http').length, 0, 'no call, no arrow');
});

test('a route with a dynamic path stays AMBIGUOUS on the label of the arrow (e)', () => {
  const model = httpWorld([route('GET', '/orders/:id', 10), route('GET', null, 16, 'AMBIGUOUS')], callTo('/orders/42'));
  const edge = model.edges.find((e) => e.kind === 'http');
  assert.equal(edge.origin, 'AMBIGUOUS');
  assert.deepEqual(edge.label, { msg: 'edge.http', params: { what: 'GET /orders/:id', ambiguous: true } });
  assert.ok(edge.evidence.some((e) => e.factId === 'route:GET ?X'), 'the dynamic route is in the evidence');
  // a route defined twice (AMBIGUOUS fact) does not become certain on the arrow either
  const twice = httpWorld([route('GET', '/orders/:id', 10, 'AMBIGUOUS')], callTo('/orders/42')).edges.find((e) => e.kind === 'http');
  assert.equal(twice.origin, 'AMBIGUOUS');
  assert.equal(twice.label.params.ambiguous, true);
});

test('evidence that does not resolve is dropped, and an item left with none is not drawn', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/pay.ts', 10]]);
  const stale = fact('integration:stripe', 'integration', 'apps/api/src/pay.ts', 1, { via: 'sdk', package: 'stripe' }, { sha: 'ffffffffffffffff' });
  const past = fact('integration:mailer.example', 'integration', 'apps/api/src/pay.ts', 99, { via: 'url', host: 'mailer.example' });
  const gone = fact('integration:sms.example', 'integration', 'apps/api/src/old.ts', 1, { via: 'url', host: 'sms.example' });
  const model = buildModel(factsOf([stale, past, gone]), census, null, {});
  assert.deepEqual(model.nodes.filter((n) => n.kind === 'external').map((n) => n.id), [], 'old sha, a line past the end, a file out of the census');
  assert.deepEqual(model.edges, []);
});

test('facts in tests and docs make no node: the model is the code that runs', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/a.ts', 10], ['apps/api/test/a.test.ts', 10, null, 'test']]);
  const inTest = fact('integration:stripe', 'integration', 'apps/api/test/a.test.ts', 1, { via: 'sdk', package: 'stripe' });
  const model = buildModel(factsOf([inTest]), census, null, {});
  assert.deepEqual(model.nodes.map((n) => n.id), ['cmp:apps/api#root', 'ctr:apps/api', 'sys']);
});

test('a repository with no manifest is one container at the root, and the root takes the files no package holds', () => {
  const plain = buildModel(factsOf([]), censusOfRows([['server/main.ts', 10], ['cli.ts', 3]]), null, {}, { name: 'acme-tool' });
  assert.deepEqual(plain.nodes.map((n) => [n.id, n.parentId ?? null]), [['cmp:.#root', 'ctr:.'], ['cmp:server', 'ctr:.'], ['ctr:.', 'sys'], ['sys', null]]);
  assert.equal(plain.nodes.find((n) => n.id === 'ctr:.').name, 'acme-tool');
  assert.equal(plain.nodes.find((n) => n.id === 'sys').name, 'acme-tool');
  // a root package.json is a container only when some code lies outside the packages below it
  const mono = buildModel(factsOf([]), censusOfRows([['package.json', 5], ['apps/api/package.json', 5], ['apps/api/src/a.ts', 10]]), null, {});
  assert.ok(!mono.nodes.some((n) => n.id === 'ctr:.'));
  const mixed = buildModel(factsOf([]), censusOfRows([['package.json', 5], ['apps/api/package.json', 5], ['apps/api/src/a.ts', 10], ['scripts/build.ts', 4]]), null, {});
  assert.deepEqual(mixed.nodes.filter((n) => n.kind === 'container').map((n) => n.id), ['ctr:.', 'ctr:apps/api']);
  assert.deepEqual(mixed.nodes.find((n) => n.id === 'ctr:.').evidence.map((e) => `${e.file}:${e.line}`), ['package.json:1']);
});

test('imports between two containers make one container arrow that counts them', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/a.ts', 10], ['packages/db/package.json', 5], ['packages/db/src/client.ts', 8], ['packages/db/src/tx.ts', 8]]);
  const imp = (to, line) => fact(`import:apps/api/src/a.ts->${to}`, 'import', 'apps/api/src/a.ts', line, { spec: 'x', library: false });
  const model = buildModel(factsOf([imp('packages/db/src/client.ts', 1), imp('packages/db/src/tx.ts', 2)]), census, null, {});
  assert.deepEqual(model.edges.map((e) => [e.id, e.label.params.count, e.origin]), [['ctr:apps/api->ctr:packages/db:imports', 2, 'EXTRACTED']]);
});

test('a call to a host outside the project never becomes an http arrow, even when its path is a route of the project', () => {
  const outside = fact('integration:status.acme-partner.example', 'integration', 'apps/web/lib/api.ts', 4, { via: 'url', host: 'status.acme-partner.example', path: '/health', method: 'GET' });
  const model = httpWorld([route('GET', '/health', 10)], outside);
  assert.equal(model.edges.filter((e) => e.kind === 'http').length, 0, 'no invented arrow');
  assert.ok(model.nodes.some((n) => n.id === 'ext:status.acme-partner.example'), 'the outside host stays an external');
  assert.ok(model.edges.some((e) => e.id === 'ctr:apps/web->ext:status.acme-partner.example:uses'));
});

test('a relative call of the project is never an external, whether or not it names a route', () => {
  const named = httpWorld([route('GET', '/orders/:id', 10)], callTo('/orders/42'));
  const unnamed = httpWorld([route('GET', '/orders/:id', 10)], callTo('/customers'));
  for (const model of [named, unnamed]) assert.deepEqual(model.nodes.filter((n) => n.kind === 'external').map((n) => n.id), []);
});

test('a queue whose name is not written (dynamic) makes no external box', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/q.ts', 10]]);
  const dynamic = fact('queue:?QUEUE_NAME', 'queue', 'apps/api/src/q.ts', 2, { lib: 'bullmq', name: null }, { origin: 'AMBIGUOUS' });
  const named = fact('queue:emails', 'queue', 'apps/api/src/q.ts', 3, { lib: 'bullmq' });
  const model = buildModel(factsOf([dynamic, named]), census, null, {});
  assert.deepEqual(model.nodes.filter((n) => n.kind === 'external').map((n) => n.id), ['ext:queue:emails']);
});

test('a place of a fact in another file stands only when the facts say which version of that file was read', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/pay.ts', 10], ['apps/api/src/refund.ts', 10]]);
  const stripe = (files, extra = {}) => buildModel({ ...factsOf([fact('integration:stripe', 'integration', 'apps/api/src/pay.ts', 1, { via: 'sdk', package: 'stripe' },
    { refs: [{ file: 'apps/api/src/refund.ts', line: 2 }], ...extra })]), files }, census, null, {}).nodes.find((n) => n.id === 'ext:stripe');
  const where = (node) => node?.evidence.map((e) => `${e.file}:${e.line}`) ?? [];
  assert.deepEqual(where(stripe({})), ['apps/api/src/pay.ts:1'], 'a ref in a file the facts do not list is dropped');
  assert.deepEqual(where(stripe({ 'apps/api/src/refund.ts': { sha: SHA('apps/api/src/refund.ts') } })), ['apps/api/src/pay.ts:1', 'apps/api/src/refund.ts:2']);
  assert.deepEqual(where(stripe({ 'apps/api/src/refund.ts': {} })), ['apps/api/src/pay.ts:1'], 'listed without a sha');
  assert.equal(stripe({}, { sha: undefined }), undefined, 'a fact with no sha stands nowhere');
});

test('two apps with screens and the same folder name share one person, with the evidence of both', () => {
  const census = censusOfRows([['apps/web/package.json', 5], ['apps/web/src/home.tsx', 10, null, 'screen'], ['packages/web/package.json', 5], ['packages/web/src/list.tsx', 10, null, 'screen']]);
  const screen = (file) => fact(`screen:${file}`, 'screen', file, 1, { framework: 'next-app' });
  const model = buildModel(factsOf([screen('apps/web/src/home.tsx'), screen('packages/web/src/list.tsx')]), census, null, {});
  assert.deepEqual(model.nodes.find((n) => n.id === 'person:web').evidence.map((e) => e.file), ['apps/web/src/home.tsx', 'packages/web/src/list.tsx']);
  assert.deepEqual(model.edges.filter((e) => e.from === 'person:web').map((e) => e.to), ['ctr:apps/web', 'ctr:packages/web']);
});

test('an SDK called "db" does not take the place of the database', () => {
  const census = censusOfRows([['apps/api/package.json', 5], ['apps/api/src/a.ts', 10], ['apps/api/src/schema.ts', 10]]);
  const sdk = fact('integration:db', 'integration', 'apps/api/src/a.ts', 1, { via: 'sdk', package: 'db' });
  const table = fact('table:Order', 'table', 'apps/api/src/schema.ts', 2, { source: 'prisma', columns: [] });
  const model = buildModel(factsOf([sdk, table]), census, null, {});
  const db = model.nodes.find((n) => n.id === 'ext:db');
  assert.equal(db.name, 'database');
  assert.deepEqual(db.evidence.map((e) => e.file), ['apps/api/src/schema.ts']);
  assert.ok(model.nodes.some((n) => n.kind === 'external' && n.name === 'db' && n.id !== 'ext:db'), 'the SDK keeps its own box');
});
