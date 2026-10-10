import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { readDocs } from '../server/foundation/docwatch.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { sectionsOf, ownerCheck, generatedBlock, replaceGenerated, generatedState, GENERATED_START, GENERATED_END } from '../server/foundation/sections.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const answerOf = (name) => JSON.parse(readFileSync(join(FIXTURE_REPOS, `${name}.answer.json`), 'utf8'));
const frac = (c) => (c.den === 0 ? null : c.num / c.den);

// The real chain the refresh runs: census (with the owners of the answer key) -> facts -> sections.
async function run(root, name, owners = new Map(Object.entries(answerOf(name).owners))) {
  const census = await censusOf(root, null, { owners });
  const facts = extractAll(root, census, null, { now: NOW });
  const arch = await readArch(root, {});
  const { docs } = readDocs(root, census);
  return { census, facts, arch, docs, sections: sectionsOf(facts, census, arch, { docs, now: NOW }) };
}
async function withFixture(name, fn) {
  const root = copyFixtureRepo(name);
  try { await fn(root); } finally { removeFixtureRepo(root); }
}

// ---------- the three answer keys ----------

for (const name of ['acme-shop', 'acme-delivery', 'acme-lib']) {
  test(`${name}: coverage equals the answer key counted by hand`, async () => {
    await withFixture(name, async (root) => {
      const { sections } = await run(root, name);
      const want = answerOf(name).coverage;
      for (const k of ['owned', 'routes', 'screens', 'tables']) {
        assert.equal(sections.coverage[k], want[k] === null ? null : frac(want[k]), k);
        assert.deepEqual(sections.counts[k], want[k], `${k} counts`);
      }
    });
  });

  test(`${name}: gaps equal the answer key`, async () => {
    await withFixture(name, async (root) => {
      const { sections } = await run(root, name);
      // The key lists its gaps in the order it was written; the program's order is by kind, file, line and id.
      const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert.deepEqual([...sections.gaps].sort(byId), [...answerOf(name).gaps].sort(byId));
    });
  });

  test(`${name}: ownerCheck equals the answer key`, async () => {
    await withFixture(name, async (root) => {
      const { census, facts, sections } = await run(root, name);
      const want = answerOf(name).ownerCheck;
      assert.deepEqual(ownerCheck(census, facts), want);
      assert.deepEqual(sections.ownerCheck, want);
    });
  });
}

test('acme-lib: nothing of the kind exists, so routes, screens and tables are null, never 0 or 1', async () => {
  await withFixture('acme-lib', async (root) => {
    const { sections } = await run(root, 'acme-lib');
    assert.equal(sections.coverage.routes, null);
    assert.equal(sections.coverage.screens, null);
    assert.equal(sections.coverage.tables, null);
    assert.equal(sections.coverage.owned, 0.25);
  });
});

test('sections.json carries version, time, census rev and every part of the map, empty ones too', async () => {
  await withFixture('acme-shop', async (root) => {
    const { census, arch, sections } = await run(root, 'acme-shop');
    assert.equal(sections.version, 1);
    assert.equal(sections.generatedAt, NOW.toISOString());
    assert.equal(sections.censusRev, census.rev);
    for (const p of arch.parts) assert.ok(sections.parts[p.id], p.id);
    assert.deepEqual(Object.keys(sections.parts.db).sort(), ['configs', 'integrations', 'jobs', 'routes', 'screens', 'tables']);
  });
});

test('acme-shop: each list holds the facts of the files the part owns, with id and file:line', async () => {
  await withFixture('acme-shop', async (root) => {
    const { facts, sections } = await run(root, 'acme-shop');
    const owners = answerOf('acme-shop').owners;
    const byFile = (kinds, part) => facts.facts.filter((f) => kinds.includes(f.kind) && owners[f.file] === part).map((f) => f.id).sort();
    const ids = (list) => list.map((i) => i.id).sort();
    assert.deepEqual(ids(sections.parts.orders.routes), byFile(['route'], 'orders'));
    assert.deepEqual(ids(sections.parts.web.screens), byFile(['screen'], 'web'));
    assert.deepEqual(ids(sections.parts.db.tables), byFile(['table'], 'db'));
    assert.deepEqual(ids(sections.parts.worker.jobs), byFile(['queue', 'job'], 'worker'));
    assert.deepEqual(ids(sections.parts.orders.integrations), byFile(['integration'], 'orders'));
    assert.ok(sections.parts.orders.routes.length >= 4);
    const first = sections.parts.orders.routes[0];
    assert.equal(first.at, `${first.file}:${first.line}`);
    assert.match(first.at, /^apps\/api\/.+:\d+$/);
  });
});

test('acme-shop: the facts of unowned files go to _none, and an owned part never holds them', async () => {
  await withFixture('acme-shop', async (root) => {
    const { sections } = await run(root, 'acme-shop');
    assert.deepEqual(sections.parts._none.routes.map((i) => i.id), ['route:ANY /api/users']);
    assert.deepEqual(sections.parts._none.screens.map((i) => i.id), ['screen:admin:/dashboard']);
    assert.ok(!sections.parts.orders.routes.some((i) => i.id === 'route:ANY /api/users'));
  });
});

test('the env facts are listed as configs and never carry a value', async () => {
  await withFixture('acme-shop', async (root) => {
    const { sections } = await run(root, 'acme-shop');
    const all = Object.values(sections.parts).flatMap((p) => p.configs);
    assert.ok(all.length >= 3);
    assert.ok(all.every((i) => i.id.startsWith('env:')));
    assert.ok(!JSON.stringify(sections).includes('do-not-read-42'));
  });
});

// ---------- owner check ----------

test('adding a route in a new file with no owning part makes the check fail and names the fact', async () => {
  await withFixture('acme-shop', async (root) => {
    // Everything the key leaves unowned gets an owner, so the baseline is clean.
    const owners = new Map(Object.entries(answerOf('acme-shop').owners).map(([p, o]) => [p, o ?? 'orders']));
    const clean = await run(root, 'acme-shop', owners);
    assert.deepEqual(clean.sections.ownerCheck, { ok: true, files: [], facts: [] });

    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'extra.ts'), "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/extra-tool', async () => ({ ok: true }));\n");
    const after = await run(root, 'acme-shop', owners);
    assert.equal(after.sections.ownerCheck.ok, false);
    assert.deepEqual(after.sections.ownerCheck.files, ['tools/extra.ts']);
    assert.deepEqual(after.sections.ownerCheck.facts, ['route:GET /extra-tool']);
    assert.ok(after.sections.gaps.some((g) => g.kind === 'folder' && g.id === 'tools' && g.reason === 'no-owner'));
  });
});

test('ownerCheck: tests, docs and excluded files do not need an owner; a fact in an owned file is fine', () => {
  const census = { files: [
    { path: 'a/x.ts', kind: 'code', included: true, owner: 'a' },
    { path: 'b/y.test.ts', kind: 'test', included: true, owner: null },
    { path: 'README.md', kind: 'doc', included: true, owner: null },
    { path: 'dist/z.js', kind: 'generated', included: false, owner: null },
    { path: 'left/out.js', kind: 'code', included: false, owner: null },
    { path: 'p/page.tsx', kind: 'screen', included: true, owner: '_none' },
  ] };
  const facts = [
    { id: 'route:GET /x', kind: 'route', file: 'a/x.ts', line: 1 },
    { id: 'env:A', kind: 'env', file: 'README.md', line: 1 },
    { id: 'table:T', kind: 'table', file: 'gone.prisma', line: 1 },
  ];
  assert.deepEqual(ownerCheck(census, facts), { ok: false, files: ['p/page.tsx'], facts: ['table:T'] });
});

// ---------- citation rules ----------

function tiny(docText, facts, extra = []) {
  const census = { rev: 1, files: [{ path: 'src/a.ts', kind: 'code', included: true, owner: 'p' }, ...extra] };
  const arch = { dir: 'docs/architecture', lang: 'en', parts: [{ id: 'p' }] };
  const docs = [{ path: 'docs/architecture/p.md', text: docText }];
  return sectionsOf({ facts }, census, arch, { docs, now: NOW });
}
const route = (method, path, line = 1) => ({ id: `route:${method} ${path}`, kind: 'route', file: 'src/a.ts', line, origin: 'EXTRACTED', attrs: { method, path } });

test('a route is cited by its path inside a code span; the method does not matter; prose without backticks does not count', () => {
  const s = tiny('`GET /orders` and POST /things in prose, and `/v2/orders`.', [route('POST', '/orders'), route('GET', '/things'), route('GET', '/orders/:id')]);
  assert.deepEqual(s.gaps.map((g) => g.id), ['route:GET /orders/:id', 'route:GET /things']);
  assert.deepEqual(s.counts.routes, { num: 1, den: 3 });
});

test('a path is cited as a whole: /orders is not cited by /v2/orders, nor by /orders/:id', () => {
  const s = tiny('`/v2/orders` and `/orders/:id`', [route('GET', '/orders')]);
  assert.equal(s.coverage.routes, 0);
});

test('a code block (fenced) is not a code span, and a document outside the architecture folder does not count', () => {
  const census = { rev: 1, files: [{ path: 'src/a.ts', kind: 'code', included: true, owner: 'p' }] };
  const arch = { dir: 'docs/architecture', lang: 'en', parts: [{ id: 'p' }] };
  const docs = [
    { path: 'docs/architecture/p.md', text: '```\n`GET /orders`\n```\n' },
    { path: 'README.md', text: '`/things`' },
  ];
  const s = sectionsOf({ facts: [route('GET', '/orders'), route('GET', '/things')] }, census, arch, { docs, now: NOW });
  assert.deepEqual(s.counts.routes, { num: 0, den: 2 });
});

test('a route with a null path can never be cited but still counts in the total', () => {
  const s = tiny('`ADMIN_PATH` and `null`', [{ ...route('GET', 'x'), id: 'route:GET ?ADMIN_PATH', origin: 'AMBIGUOUS', attrs: { method: 'GET', path: null } }]);
  assert.deepEqual(s.counts.routes, { num: 0, den: 1 });
  assert.equal(s.gaps[0].reason, 'not-cited');
});

test('a screen is cited by its route or by its widget name; a table by its name as a whole word', () => {
  const facts = [
    { id: 'screen:app:/cart', kind: 'screen', file: 'src/a.ts', line: 2, origin: 'EXTRACTED', attrs: { route: '/cart', widget: 'CartPage' } },
    { id: 'screen:app:/pay', kind: 'screen', file: 'src/a.ts', line: 3, origin: 'EXTRACTED', attrs: { route: '/pay', widget: 'PayPage' } },
    { id: 'screen:app:/x', kind: 'screen', file: 'src/a.ts', line: 4, origin: 'EXTRACTED', attrs: { route: '/x', widget: 'XPage' } },
    { id: 'table:Order', kind: 'table', file: 'src/a.ts', line: 5, origin: 'EXTRACTED', attrs: {} },
    { id: 'table:Item', kind: 'table', file: 'src/a.ts', line: 6, origin: 'EXTRACTED', attrs: {} },
  ];
  const s = tiny('`/cart` and `PayPage` and `OrderItem` and `Order`', facts);
  assert.deepEqual(s.counts.screens, { num: 2, den: 3 });
  assert.deepEqual(s.counts.tables, { num: 1, den: 2 });
  assert.deepEqual(s.gaps.map((g) => g.id), ['screen:app:/x', 'table:Item']);
});

test('a table is not cited by a path that ends with its name, nor by a dotted or dashed name', () => {
  const table = (name) => ({ id: `table:${name}`, kind: 'table', file: 'src/a.ts', line: 1, origin: 'EXTRACTED', attrs: {} });
  const s = tiny('`GET /api/orders` and `x.items` and `line-users` and `Order.id`', [table('orders'), table('items'), table('users'), table('Order')]);
  assert.deepEqual(s.gaps.map((g) => g.id), ['table:items', 'table:orders', 'table:users']);
});

test('without any document the cited counts are 0 of total, not null; without any fact of the kind they are null', () => {
  const census = { rev: 1, files: [{ path: 'src/a.ts', kind: 'code', included: true, owner: 'p' }] };
  const s = sectionsOf({ facts: [route('GET', '/a')] }, census, { dir: null, lang: 'en', parts: [{ id: 'p' }] }, { now: NOW });
  assert.equal(s.coverage.routes, 0);
  assert.equal(s.coverage.screens, null);
  assert.equal(s.coverage.owned, 1);
});

test('owned is null when the project has no code or screen file', () => {
  const s = sectionsOf({ facts: [] }, { rev: 3, files: [{ path: 'README.md', kind: 'doc', included: true, owner: null }] }, null, { now: NOW });
  assert.equal(s.coverage.owned, null);
  assert.equal(s.censusRev, 3);
});

test('an unowned folder is one gap, at the shallowest folder with no owned code in it; a loose file in an owned folder or in the root makes none', () => {
  const census = { rev: 1, files: [
    { path: 'apps/api/a.ts', kind: 'code', included: true, owner: 'p' },
    { path: 'apps/admin/pages/x.tsx', kind: 'screen', included: true, owner: null },
    { path: 'apps/admin/package.json', kind: 'code', included: true, owner: null },
    { path: 'apps/api/q.ts', kind: 'code', included: true, owner: null },
    { path: 'package.json', kind: 'code', included: true, owner: null },
  ] };
  const s = sectionsOf({ facts: [] }, census, { dir: null, lang: 'en', parts: [{ id: 'p' }] }, { now: NOW });
  assert.deepEqual(s.gaps, [{ kind: 'folder', id: 'apps/admin', file: 'apps/admin/', line: null, reason: 'no-owner' }]);
});

// ---------- the generated block ----------

const part = {
  routes: [{ id: 'route:GET /a', name: 'GET /a', file: 'src/a.ts', line: 3, at: 'src/a.ts:3', origin: 'EXTRACTED' },
    { id: 'route:GET ?P', name: 'GET ?P', file: 'src/a.ts', line: 9, at: 'src/a.ts:9', origin: 'AMBIGUOUS' }],
  screens: [], tables: [{ id: 'table:Order', name: 'Order', file: 'db/schema.prisma', line: 4, at: 'db/schema.prisma:4', origin: 'EXTRACTED' }],
  integrations: [], jobs: [{ id: 'queue:emails', name: 'emails', file: 'w.ts', line: 1, at: 'w.ts:1', origin: 'EXTRACTED' }],
  configs: [{ id: 'env:API_KEY', name: 'API_KEY', file: '.env.example', line: 2, at: '.env.example:2', origin: 'EXTRACTED' }],
};

test('generatedBlock in English sits between the markers and says it was written from the code, with the census rev', () => {
  const b = generatedBlock({ ...part, rev: 42 }, 'en');
  assert.ok(b.startsWith(`${GENERATED_START}\n`));
  assert.ok(b.endsWith(`\n${GENERATED_END}`));
  assert.ok(b.includes('Written from the code by session-map (census rev 42)'));
  assert.ok(b.includes('Routes') && b.includes('Tables') && b.includes('Jobs') && b.includes('Config'));
  assert.ok(!b.includes('Screens') && !b.includes('Integrations'), 'an empty list is not written');
  assert.ok(b.includes('`GET /a`') && b.includes('`src/a.ts:3`'));
  assert.ok(b.includes('`GET ?P`'));
});

test('generatedBlock in Portuguese uses the Portuguese line and titles', () => {
  const b = generatedBlock(part, 'pt', 7);
  assert.ok(b.includes('Escrito a partir do código pelo session-map (censo rev 7)'));
  assert.ok(b.includes('Rotas') && b.includes('Tabelas') && b.includes('Robôs') && b.includes('Configs'));
  assert.ok(!b.includes('Written from'));
});

test('an unknown language falls back to English; a part with nothing in it still gives a valid block', () => {
  const b = generatedBlock({ routes: [], screens: [], tables: [], integrations: [], jobs: [], configs: [] }, 'fr', 1);
  assert.ok(b.includes('Written from the code by session-map (census rev 1)'));
  assert.ok(b.includes('Nothing found in the code yet.'));
  assert.equal(generatedState(`x\n${b}\ny`), 'ok');
});

test('a name with a backtick still makes a valid code span', () => {
  const b = generatedBlock({ ...part, routes: [{ ...part.routes[0], name: 'GET /a`b' }] }, 'en', 1);
  assert.ok(b.includes('``GET /a`b``'));
});

test('replaceGenerated swaps only the block; the text outside the markers is untouched byte for byte', () => {
  const b1 = generatedBlock(part, 'en', 1);
  const b2 = generatedBlock({ ...part, routes: [] }, 'en', 2);
  const md = `# Orders\n\nIntro with $& and $1 signs.\n\n${b1}\n\n## Rules\n\n- keep me\n`;
  const out = replaceGenerated(md, b2);
  assert.ok(out.startsWith('# Orders\n\nIntro with $& and $1 signs.\n\n'));
  assert.ok(out.endsWith('\n\n## Rules\n\n- keep me\n'));
  assert.ok(out.includes('census rev 2') && !out.includes('census rev 1'));
  assert.ok(!out.includes('`GET /a`'));
});

test('replaceGenerated applied twice gives the same text as once', () => {
  const b = generatedBlock(part, 'en', 5);
  const md = '# T\n\ntext\n\n<!-- session-map:generated:start -->\nold\n<!-- session-map:generated:end -->\n\ntail\n';
  const once = replaceGenerated(md, b);
  assert.equal(replaceGenerated(once, b), once);
  const bare = '# T\n\ntext\n';
  const added = replaceGenerated(bare, b);
  assert.ok(added.startsWith('# T\n\ntext\n'));
  assert.equal(replaceGenerated(added, b), added);
  assert.equal(generatedState(added), 'ok');
  assert.equal(generatedState(bare), 'none');
});

test('replaceGenerated keeps the line breaks of a CRLF document', () => {
  const b = generatedBlock(part, 'en', 5);
  const md = 'a\r\n\r\n<!-- session-map:generated:start -->\r\nold\r\n<!-- session-map:generated:end -->\r\nz\r\n';
  const out = replaceGenerated(md, b);
  assert.ok(!/[^\r]\n/.test(out), 'every newline is CRLF');
  assert.ok(out.endsWith('\r\nz\r\n'));
});

test('a broken pair of markers is left alone and reported, never guessed at', () => {
  const b = generatedBlock(part, 'en', 5);
  for (const md of ['a\n<!-- session-map:generated:start -->\nnever closed\n', 'a\n<!-- session-map:generated:end -->\nb\n<!-- session-map:generated:start -->\n']) {
    assert.equal(generatedState(md), 'broken');
    assert.equal(replaceGenerated(md, b), md);
  }
});

test('a marker quoted in the middle of a sentence is not a marker', () => {
  const md = 'Use `<!-- session-map:generated:start -->` to open the block.\n';
  assert.equal(generatedState(md), 'none');
});

test('a name that looks like a marker cannot break the block it sits in', () => {
  const evil = generatedBlock({ ...part, routes: [{ ...part.routes[0], name: GENERATED_END }] }, 'en', 1);
  assert.equal(generatedState(`a\n${evil}\nb`), 'ok');
  const out = replaceGenerated(`a\n${evil}\nb`, generatedBlock(part, 'en', 2));
  assert.ok(out.startsWith('a\n') && out.endsWith('\nb'));
  assert.ok(out.includes('census rev 2'));
});
