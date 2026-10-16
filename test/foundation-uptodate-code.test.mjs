// "Everything up to date?" lines of group 1 (code <-> map <-> flow) and group 4 (variables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../server/foundation/uptodate-lines-code.mjs';

const IDS = [
  'g1.census-owners', 'g1.read-100', 'g1.golden-rule', 'g1.cov-routes', 'g1.cov-screens', 'g1.cov-tables', 'g1.cov-jobs',
  'g1.cov-integrations', 'g1.arch-paths', 'g1.links-imports', 'g4.env-documented', 'g4.env-unused',
];

const file = (path, owner, extra = {}) => ({ path, type: 'ts', kind: 'code', included: true, reason: null, bytes: 10, chars: 10, words: 1, lines: { total: 2, code: 2, comment: 0, blank: 0 }, mtime: 'm', sha: `sha-${path}`, owner, ...extra });
const fact = (id, kind, path, line, extra = {}) => ({ id, kind, name: id, file: path, line, sha: `sha-${path}`, origin: 'EXTRACTED', extractor: 'x@1', attrs: {}, refs: [], ...extra });
const ev = (path, line, factId) => ({ file: path, line, sha: `sha-${path}`, ...(factId ? { factId } : {}) });

// A project that is right in every line. Each test breaks exactly one entry of a fresh copy.
function okCtx() {
  const census = {
    version: 1, rev: 1,
    files: [
      file('api/src/orders.ts', 'orders'), file('api/src/pay.ts', 'payments'), file('api/src/queue.ts', 'orders'),
      file('web/app/page.tsx', 'storefront'), file('db/schema.prisma', 'orders', { type: 'prisma' }),
      file('.env.example', 'orders', { type: 'other' }),
      file('docs/architecture/orders.md', 'orders', { type: 'md', kind: 'doc' }),
      file('docs/architecture/payments.md', 'payments', { type: 'md', kind: 'doc' }),
      file('docs/architecture/storefront.md', 'storefront', { type: 'md', kind: 'doc' }),
      file('docs/architecture/README.md', 'orders', { type: 'md', kind: 'doc' }),
      file('pnpm-lock.yaml', null, { included: false, kind: 'generated', reason: 'generated', sha: null }),
    ],
  };
  const part = (id, name, codePaths) => ({ id, name, file: `docs/architecture/${id}.md`, codePaths, groups: [] });
  const arch = {
    source: 'worktree', dir: 'docs/architecture', lang: 'en',
    mermaid: 'flowchart LR\n  store[Storefront] --> ord[Orders]\n  ord --> pay[Payments]\n',
    layers: [],
    parts: [part('orders', 'Orders', ['api/src/']), part('payments', 'Payments', ['api/src/pay.ts']), part('storefront', 'Storefront', ['web/app/'])],
  };
  const facts = { version: 1, facts: [
    fact('route:GET /orders', 'route', 'api/src/orders.ts', 4, { attrs: { method: 'GET', path: '/orders' } }),
    fact('screen:web:/', 'screen', 'web/app/page.tsx', 1),
    fact('table:Order', 'table', 'db/schema.prisma', 3),
    fact('queue:emails', 'queue', 'api/src/queue.ts', 2),
    fact('job:emails/send', 'job', 'api/src/queue.ts', 5),
    fact('integration:stripe', 'integration', 'api/src/pay.ts', 1),
    fact('env:STRIPE_KEY', 'env', 'api/src/pay.ts', 3, { attrs: { source: 'code' }, refs: [{ file: '.env.example', line: 1 }] }),
  ] };
  const node = (id, partId, factId, path, line) => ({ id, level: 3, kind: 'component', parentId: 'ctr:api', partId, origin: 'EXTRACTED', evidence: [ev(path, line, factId)], hash: 'h' });
  const model = {
    version: 1,
    nodes: [
      { id: 'sys', level: 1, kind: 'system', name: 'acme-shop', parentId: null },
      node('cmp:orders', 'orders', 'route:GET /orders', 'api/src/orders.ts', 4),
      node('cmp:payments', 'payments', 'integration:stripe', 'api/src/pay.ts', 1),
      node('cmp:storefront', 'storefront', 'screen:web:/', 'web/app/page.tsx', 1),
      { id: 'ext:stripe', level: 1, kind: 'external', name: 'Stripe', origin: 'EXTRACTED', evidence: [ev('api/src/pay.ts', 1, 'integration:stripe')], hash: 'h' },
    ],
    edges: [
      { id: 'e1', from: 'cmp:storefront', to: 'cmp:orders', kind: 'imports', origin: 'EXTRACTED', evidence: [ev('web/app/page.tsx', 1)], hash: 'h' },
      { id: 'e2', from: 'cmp:orders', to: 'cmp:payments', kind: 'imports', origin: 'EXTRACTED', evidence: [ev('api/src/orders.ts', 1)], hash: 'h' },
    ],
  };
  const ledger = { version: 1, files: { 'api/src/orders.ts': { sha: 'sha-api/src/orders.ts', spans: [[1, 2]], reads: [] } }, summary: { readChars: 10, totalChars: 10, percent: 100, missing: [] } };
  const docs = [
    { path: 'docs/architecture/orders.md', text: '# Orders\n\n## Where in the code\n\n- `api/src/`\n' },
    { path: 'README.md', text: '# acme-shop\n\n## Configuration\n\n- `STRIPE_KEY`\n' },
  ];
  return { project: { id: 'acme-shop-1', arch }, census, ledger, facts, model, findings: [], docs, now: '2026-10-10T10:00:00Z' };
}

const run = (ctx) => Object.fromEntries(LINES.map((l) => [l.id, l.run(ctx)]));
const states = (ctx) => Object.fromEntries(Object.entries(run(ctx)).map(([id, r]) => [id, r.state]));
const only = (ctx, id) => {
  const s = states(ctx);
  return Object.entries(s).filter(([, v]) => v === 'warning').map(([k]) => k).join() === id;
};

test('the catalog has the 12 lines of groups 1 and 4, in order, each with a group and a run function', () => {
  assert.deepEqual(LINES.map((l) => l.id), IDS);
  assert.equal(new Set(LINES.map((l) => l.id)).size, 12);
  for (const l of LINES) {
    assert.equal(l.group, Number(l.id[1]));
    assert.equal(typeof l.run, 'function');
  }
});

test('a project that is right: every line confirmed, with something it checked', () => {
  const out = run(okCtx());
  for (const id of IDS) {
    assert.equal(out[id].state, 'confirmed', `${id}: ${JSON.stringify(out[id])}`);
    assert.ok(out[id].evidence.length > 0, `${id} has evidence`);
    assert.equal(out[id].reason, null);
    assert.deepEqual(out[id].findingIds, []);
    assert.equal(out[id].detail.msg, `uptodate.${id}.ok`);
  }
});

test('lines are pure: running twice gives the same answer and leaves the context untouched', () => {
  const ctx = okCtx();
  const before = JSON.stringify(ctx);
  assert.deepEqual(run(ctx), run(ctx));
  assert.equal(JSON.stringify(ctx), before);
});

test('a file without an owner breaks census-owners only, and cites the owner-missing finding', () => {
  const ctx = okCtx();
  ctx.census.files.push(file('scripts/lost.ts', null));
  ctx.findings = [{ id: 'f:1', rule: 'owner-missing', state: 'open' }, { id: 'f:2', rule: 'doc-size', state: 'open' }];
  assert.ok(only(ctx, 'g1.census-owners'));
  const r = run(ctx)['g1.census-owners'];
  assert.deepEqual(r.findingIds, ['f:1']);
  assert.equal(r.evidence[0].file, 'scripts/lost.ts');
  assert.equal(r.detail.params.count, 1);
});

test('excluded files never count as ownerless', () => {
  const ctx = okCtx();
  assert.equal(run(ctx)['g1.census-owners'].state, 'confirmed');
  ctx.census.files.push(file('dist/x.js', null, { included: false, kind: 'generated' }));
  assert.equal(run(ctx)['g1.census-owners'].state, 'confirmed');
});

test('a ledger below 100 percent breaks read-100 only; 99.9 percent does not round up', () => {
  const ctx = okCtx();
  ctx.ledger.summary = { readChars: 999, totalChars: 1000, percent: 100, missing: [{ path: 'api/src/pay.ts', spans: [[1, 2]] }] };
  assert.ok(only(ctx, 'g1.read-100'));
  assert.equal(run(ctx)['g1.read-100'].evidence[0].file, 'api/src/pay.ts');
});

test('a part with no node in the model breaks golden-rule only', () => {
  const ctx = okCtx();
  ctx.project.arch.parts.push({ id: 'shipping', name: 'Shipping', file: 'docs/architecture/orders.md', codePaths: [], groups: [] });
  assert.ok(only(ctx, 'g1.golden-rule'));
});

test('a level 3 node with no part breaks golden-rule; person and external nodes are exempt', () => {
  const ctx = okCtx();
  ctx.model.nodes.push({ id: 'person:customer', level: 1, kind: 'person', name: 'Customer', origin: 'INFERRED', evidence: [ev('web/app/page.tsx', 1)], hash: 'h' });
  assert.equal(run(ctx)['g1.golden-rule'].state, 'confirmed');
  ctx.model.nodes.push({ id: 'cmp:orphan', level: 3, kind: 'component', parentId: 'ctr:api', partId: null, origin: 'EXTRACTED', evidence: [ev('api/src/orders.ts', 1)], hash: 'h' });
  assert.equal(run(ctx)['g1.golden-rule'].state, 'warning');
});

const COVER = [
  ['g1.cov-routes', 'route:GET /gone', 'route'],
  ['g1.cov-screens', 'screen:web:/gone', 'screen'],
  ['g1.cov-tables', 'table:Gone', 'table'],
  ['g1.cov-jobs', 'job:emails/gone', 'job'],
  ['g1.cov-integrations', 'integration:gone', 'integration'],
];
for (const [id, factId] of COVER) {
  test(`${id}: a fact the model cites that no longer exists breaks that line only`, () => {
    const ctx = okCtx();
    ctx.model.nodes.find((n) => n.id === 'cmp:orders').evidence.push(ev('api/src/orders.ts', 4, factId));
    assert.ok(only(ctx, id), JSON.stringify(states(ctx)));
  });
  test(`${id}: a fact whose file belongs to no part with a node breaks that line only`, () => {
    const ctx = okCtx();
    const kind = factId.split(':')[0];
    ctx.census.files.push(file(`ghost/${kind}.ts`, 'ghost'));
    ctx.facts.facts.push(fact(`${kind}:ghost-fact`, kind, `ghost/${kind}.ts`, 7));
    assert.ok(only(ctx, id), JSON.stringify(states(ctx)));
    const r = run(ctx)[id];
    assert.equal(r.evidence[0].file, `ghost/${kind}.ts`);
    assert.equal(r.evidence[0].factId, `${kind}:ghost-fact`);
  });
}

test('a route in a file with no owner breaks cov-routes (and census-owners, which also sees the file)', () => {
  const ctx = okCtx();
  ctx.census.files.push(file('scripts/r.ts', null));
  ctx.facts.facts.push(fact('route:GET /lost', 'route', 'scripts/r.ts', 2));
  const s = states(ctx);
  assert.equal(s['g1.cov-routes'], 'warning');
  assert.equal(s['g1.census-owners'], 'warning');
});

test('a queue counts for jobs: a queue fact in an unmapped file breaks cov-jobs', () => {
  const ctx = okCtx();
  ctx.census.files.push(file('ghost/q.ts', 'ghost'));
  ctx.facts.facts.push(fact('queue:ghost', 'queue', 'ghost/q.ts', 1));
  assert.ok(only(ctx, 'g1.cov-jobs'));
});

test('a project with no routes: cov-routes is unverified/not-applicable, never a warning', () => {
  const ctx = okCtx();
  ctx.facts.facts = ctx.facts.facts.filter((f) => f.kind !== 'route');
  ctx.model.nodes.find((n) => n.id === 'cmp:orders').evidence = [ev('api/src/orders.ts', 4)];
  const r = run(ctx)['g1.cov-routes'];
  assert.equal(r.state, 'unverified');
  assert.equal(r.reason, 'not-applicable');
});

test('a path in "Where in the code" that is not in the census breaks arch-paths only', () => {
  const ctx = okCtx();
  ctx.project.arch.parts[0].codePaths.push('api/gone/');
  assert.ok(only(ctx, 'g1.arch-paths'));
  const r = run(ctx)['g1.arch-paths'];
  assert.equal(r.evidence[0].file, 'docs/architecture/orders.md');
  assert.equal(r.detail.params.count, 1);
});

test('arch-paths: the evidence line is where the part file says the path, when its text is there', () => {
  const ctx = okCtx();
  ctx.project.arch.parts[0].codePaths.push('api/gone/');
  ctx.docs[0].text += '- `api/gone/`\n';
  assert.equal(run(ctx)['g1.arch-paths'].evidence[0].line, 6);
});

test('arch-paths: a file path, a folder with or without the slash and a glob prefix all resolve', () => {
  const ctx = okCtx();
  ctx.project.arch.parts[0].codePaths = ['api/src/orders.ts', 'api/src', 'api/src/*.ts', './web/app/'];
  assert.equal(run(ctx)['g1.arch-paths'].state, 'confirmed');
});

test('arch-paths: no part names any code path = not-applicable', () => {
  const ctx = okCtx();
  for (const p of ctx.project.arch.parts) p.codePaths = [];
  assert.equal(run(ctx)['g1.arch-paths'].reason, 'not-applicable');
});

test('a drawn link with no import between the two parts breaks links-imports only', () => {
  const ctx = okCtx();
  ctx.project.arch.mermaid += '  store --> pay\n';
  assert.ok(only(ctx, 'g1.links-imports'), JSON.stringify(states(ctx)));
});

test('a strong import (3 or more pieces of evidence) with no drawn link breaks links-imports only', () => {
  const ctx = okCtx();
  ctx.model.edges.push({ id: 'e3', from: 'cmp:storefront', to: 'cmp:payments', kind: 'imports', origin: 'EXTRACTED', evidence: [ev('web/app/page.tsx', 1), ev('web/app/page.tsx', 2), ev('web/app/page.tsx', 3)], hash: 'h' });
  assert.ok(only(ctx, 'g1.links-imports'));
});

test('a weak undrawn import is not a warning', () => {
  const ctx = okCtx();
  ctx.model.edges.push({ id: 'e3', from: 'cmp:storefront', to: 'cmp:payments', kind: 'imports', origin: 'EXTRACTED', evidence: [ev('web/app/page.tsx', 1)], hash: 'h' });
  assert.equal(run(ctx)['g1.links-imports'].state, 'confirmed');
});

test('links-imports: without a drawing there is nothing to compare', () => {
  const ctx = okCtx();
  ctx.project.arch.mermaid = null;
  assert.equal(run(ctx)['g1.links-imports'].reason, 'not-applicable');
});

test('a variable read in code and named nowhere breaks env-documented only', () => {
  const ctx = okCtx();
  ctx.facts.facts.push(fact('env:SECRET_SALT', 'env', 'api/src/pay.ts', 9, { attrs: { source: 'code' } }));
  assert.ok(only(ctx, 'g4.env-documented'));
  const r = run(ctx)['g4.env-documented'];
  assert.equal(r.evidence[0].factId, 'env:SECRET_SALT');
  assert.equal(JSON.stringify(r).includes('='), false, 'names only, never values');
});

test('a variable named in .env.example counts as documented', () => {
  const ctx = okCtx();
  ctx.facts.facts.push(fact('env:API_URL', 'env', 'api/src/pay.ts', 9, { attrs: { source: 'code' }, refs: [{ file: '.env.example', line: 2 }] }));
  assert.equal(run(ctx)['g4.env-documented'].state, 'confirmed');
});

test('a variable named in any document counts as documented', () => {
  const ctx = okCtx();
  ctx.facts.facts.push(fact('env:API_URL', 'env', 'api/src/pay.ts', 9, { attrs: { source: 'code' } }));
  ctx.docs.push({ path: 'docs/setup.md', text: 'Set API_URL before starting.\n' });
  assert.equal(run(ctx)['g4.env-documented'].state, 'confirmed');
});

test('a name in .env.example that no code reads breaks env-unused only', () => {
  const ctx = okCtx();
  ctx.facts.facts.push(fact('env:OLD_TOKEN', 'env', '.env.example', 4, { attrs: { source: 'example' } }));
  assert.ok(only(ctx, 'g4.env-unused'));
  assert.equal(run(ctx)['g4.env-unused'].evidence[0].factId, 'env:OLD_TOKEN');
});

test('a name under a configuration heading of a doc that no code reads breaks env-unused', () => {
  const ctx = okCtx();
  ctx.docs[1].text += '- `LEGACY_FLAG` turns the old path on\n';
  assert.ok(only(ctx, 'g4.env-unused'));
  assert.equal(run(ctx)['g4.env-unused'].evidence[0].file, 'README.md');
});

test('capitalised words in a doc outside a configuration section are not variables', () => {
  const ctx = okCtx();
  ctx.docs.push({ path: 'docs/api.md', text: '# API\n\nSend `GET_ALL` or `JSON_BODY` here.\n' });
  assert.equal(run(ctx)['g4.env-unused'].state, 'confirmed');
});

test('a project that reads no variable: both env lines are not-applicable', () => {
  const ctx = okCtx();
  ctx.facts.facts = ctx.facts.facts.filter((f) => f.kind !== 'env');
  ctx.docs = [];
  assert.equal(run(ctx)['g4.env-documented'].reason, 'not-applicable');
  assert.equal(run(ctx)['g4.env-unused'].reason, 'not-applicable');
});

test('a missing input is unverified/no-data on exactly the lines that need it, never a warning', () => {
  const needs = {
    census: ['g1.census-owners', 'g1.cov-routes', 'g1.cov-screens', 'g1.cov-tables', 'g1.cov-jobs', 'g1.cov-integrations', 'g1.arch-paths'],
    ledger: ['g1.read-100'],
    model: ['g1.golden-rule', 'g1.cov-routes', 'g1.cov-screens', 'g1.cov-tables', 'g1.cov-jobs', 'g1.cov-integrations', 'g1.links-imports'],
    facts: ['g1.cov-routes', 'g1.cov-screens', 'g1.cov-tables', 'g1.cov-jobs', 'g1.cov-integrations', 'g4.env-documented', 'g4.env-unused'],
    docs: ['g4.env-documented', 'g4.env-unused'],
  };
  for (const [key, ids] of Object.entries(needs)) {
    const ctx = okCtx();
    ctx[key] = null;
    const out = run(ctx);
    for (const id of ids) {
      assert.equal(out[id].state, 'unverified', `${key} null -> ${id}`);
      assert.equal(out[id].reason, 'no-data', `${key} null -> ${id}`);
      assert.deepEqual(out[id].evidence, []);
    }
    for (const id of IDS) assert.notEqual(out[id].state, 'warning', `${key} null -> ${id} must not warn`);
  }
});

test('no architecture at all: lines that need the map are no-data', () => {
  const ctx = okCtx();
  ctx.project.arch = null;
  const out = run(ctx);
  for (const id of ['g1.golden-rule', 'g1.arch-paths', 'g1.links-imports']) assert.equal(out[id].reason, 'no-data', id);
  const none = okCtx();
  none.project.arch = { source: 'none', dir: null, mermaid: null, layers: [], parts: [] };
  assert.equal(run(none)['g1.golden-rule'].reason, 'no-data');
});

test('an empty context (project not read yet) answers every line, none with a warning or an exception', () => {
  const out = run({});
  assert.equal(Object.keys(out).length, 12);
  for (const r of Object.values(out)) assert.equal(r.state, 'unverified');
});

test('evidence is capped so a huge project does not bloat uptodate.json', () => {
  const ctx = okCtx();
  for (let i = 0; i < 40; i += 1) ctx.census.files.push(file(`lost/${i}.ts`, null));
  const r = run(ctx)['g1.census-owners'];
  assert.ok(r.evidence.length <= 5);
  assert.equal(r.detail.params.count, 40);
});

test('a variable only a test or a fixture reads or lists, and one the operating system sets, are not the project\'s', () => {
  const ctx = okCtx();
  const base = states(ctx);
  ctx.facts.facts.push(
    fact('env:SM_BENCH_PROBE', 'env', 'test/bench.test.mjs', 3, { attrs: { source: 'code' } }),
    fact('env:FAKE_REPLY', 'env', 'test/fixtures/fake-claude.mjs', 3, { attrs: { source: 'code' } }),
    fact('env:APP_KEY', 'env', 'test/fixtures/repos/shop/.env.example', 1, { attrs: { source: 'example' } }),
    fact('env:LOCALAPPDATA', 'env', 'api/src/pay.ts', 9, { attrs: { source: 'code' } }),
  );
  assert.deepEqual([states(ctx)['g4.env-documented'], states(ctx)['g4.env-unused']], [base['g4.env-documented'], base['g4.env-unused']]);
  ctx.facts.facts.push(fact('env:REAL_UNDOCUMENTED', 'env', 'api/src/pay.ts', 10, { attrs: { source: 'code' } }));
  assert.equal(states(ctx)['g4.env-documented'], 'warning', 'a real variable nobody names still breaks the line');
});
