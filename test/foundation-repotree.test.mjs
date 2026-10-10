import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { repoTree, clearTreeCache } from '../server/foundation/repotree.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const answer = JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-shop.answer.json'), 'utf8'));
const owners = new Map(Object.entries(answer.owners));

function find(node, path) {
  if (node.path === path) return node;
  for (const c of node.children ?? []) {
    if (path === c.path || path.startsWith(`${c.path}/`)) return find(c, path);
  }
  return null;
}
function walk(node, fn) { fn(node); for (const c of node.children ?? []) walk(c, fn); }

function withFixture(fn) {
  return async () => {
    clearTreeCache();
    const root = copyFixtureRepo('acme-shop');
    try { await fn(root); } finally { removeFixtureRepo(root); }
  };
}

test('folders carry the census sums and files their own counts and owner', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const t = await repoTree(root, census, { nowMs: 1000 });
  assert.equal(t.rev, census.rev);
  const api = find(t.tree, 'apps/api');
  assert.equal(api.type, 'folder');
  assert.equal(api.files, census.sums.folders['apps/api'].files);
  assert.equal(api.lines, census.sums.folders['apps/api'].lines.total);
  assert.equal(api.chars, census.sums.folders['apps/api'].chars);
  const f = find(t.tree, 'apps/api/src/server.ts');
  const row = census.files.find((x) => x.path === f.path);
  assert.deepEqual(
    { type: f.type, lines: f.lines, chars: f.chars, owner: f.owner, included: f.included },
    { type: 'file', lines: row.lines.total, chars: row.chars, owner: row.owner, included: true },
  );
  assert.equal(t.tree.files, census.sums.total.files);
  const kinds = t.tree.children.map((c) => c.type);
  assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a === 'folder' ? -1 : 1)), 'folders come before files');
}));

test('left-out files are grey and keep no counts; the secret is never opened', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const t = await repoTree(root, census, { nowMs: 1000 });
  const lock = find(t.tree, 'pnpm-lock.yaml');
  assert.equal(lock.grey, true);
  assert.equal(lock.included, false);
  assert.equal(lock.kind, 'generated');
  assert.equal(lock.lines, null);
  const env = find(t.tree, '.env');
  assert.equal(env.grey, true);
  assert.equal(env.kind, 'secret');
  assert.equal(find(t.tree, 'apps/web/public/logo.png').grey, true);
  assert.equal(find(t.tree, 'apps/api/src/server.ts').grey, false);
  assert.equal(t.excluded.dep, census.excluded.dep);
  assert.ok(!JSON.stringify(t).includes('do-not-read-42'));
}));

test('a folder of code nobody owns is marked, one with owned code is not', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const t = await repoTree(root, census, { nowMs: 1000 });
  assert.equal(find(t.tree, 'apps/admin').noOwner, true);
  assert.equal(find(t.tree, 'apps/admin/pages/dashboard.tsx').noOwner, true);
  assert.equal(find(t.tree, 'apps/api').noOwner, false);
  assert.equal(find(t.tree, 'apps').noOwner, false);
  assert.equal(find(t.tree, 'docs').noOwner, false);
  assert.equal(find(t.tree, 'apps/api/src/server.ts').noOwner, false);
  assert.equal(find(t.tree, 'README.md').noOwner, false);
}));

test('a new file shows on the first call after 2 s, as new, with null counts, without running the census', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  await repoTree(root, census, { nowMs: 10_000 });
  writeFileSync(join(root, 'apps', 'api', 'src', 'fresh.ts'), 'export const x = 1;\n');
  mkdirSync(join(root, 'apps', 'newapp'));
  writeFileSync(join(root, 'apps', 'newapp', 'a.ts'), 'export const y = 2;\n');
  const early = await repoTree(root, census, { nowMs: 11_500 });
  assert.equal(find(early.tree, 'apps/api/src/fresh.ts'), null, 'the listing is cached for 2 s');
  const t = await repoTree(root, census, { nowMs: 12_001 });
  const f = find(t.tree, 'apps/api/src/fresh.ts');
  assert.deepEqual(
    { new: f.new, lines: f.lines, chars: f.chars, grey: f.grey, type: f.type },
    { new: true, lines: null, chars: null, grey: false, type: 'file' },
  );
  assert.equal(find(t.tree, 'apps/api/src').new, true, 'the folder says something new is inside');
  assert.equal(find(t.tree, 'apps/api').new, true);
  assert.equal(find(t.tree, 'apps/api/src/server.ts').new, false);
  assert.equal(find(t.tree, 'apps/api/src/log.ts').new, false);
  const nf = find(t.tree, 'apps/newapp');
  assert.deepEqual({ new: nf.new, lines: nf.lines, files: nf.files }, { new: true, lines: null, files: null });
  assert.equal(t.rev, census.rev, 'the census was not run');
}));

test('a new file that is a secret or a binary is shown grey and unopened', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  await repoTree(root, census, { nowMs: 1 });
  writeFileSync(join(root, 'apps', 'api', '.env.local'), 'TOKEN=do-not-read-43\n');
  writeFileSync(join(root, 'apps', 'api', 'pic.png'), Buffer.from([0, 1, 2]));
  const t = await repoTree(root, census, { nowMs: 5000 });
  const s = find(t.tree, 'apps/api/.env.local');
  assert.deepEqual({ grey: s.grey, kind: s.kind, new: s.new }, { grey: true, kind: 'secret', new: true });
  assert.equal(find(t.tree, 'apps/api/pic.png').grey, true);
}));

test('since and the log mark what entered the statement later; fresh paths mark the rest', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const log = [
    { rev: 2, from: 1, added: [{ path: 'apps/api/src/log.ts' }], removed: [], changed: [{ path: 'apps/api/src/server.ts' }] },
    { rev: 3, from: 2, added: [{ path: 'apps/web/lib/api.ts' }], removed: [], changed: [] },
  ];
  const t = await repoTree(root, census, { nowMs: 1, since: 2, log, fresh: new Set(['README.md']) });
  assert.equal(find(t.tree, 'apps/web/lib/api.ts').new, true);
  assert.equal(find(t.tree, 'apps/api/src/log.ts').new, false, 'rev 2 is not after since 2');
  assert.equal(find(t.tree, 'apps/api/src/server.ts').new, false, 'changed is not new');
  assert.equal(find(t.tree, 'README.md').new, true);
  assert.equal(find(t.tree, 'apps/web').new, true);
  const none = await repoTree(root, census, { nowMs: 1, log });
  let any = false;
  walk(none.tree, (n) => { if (n.new) any = true; });
  assert.equal(any, false, 'without since nothing is new');
  const aggregate = await repoTree(root, census, { nowMs: 1, fresh: { files: 3, lines: 9, parts: {} } });
  assert.equal(find(aggregate.tree, 'README.md').new, false, 'the aggregate project.fresh has no paths');
}));

test('without git the census alone draws the tree', async () => {
  clearTreeCache();
  const root = copyFixtureRepo('acme-shop');
  try {
    const census = await censusOf(root, null, { owners });
    const t = await repoTree(root, census, { nowMs: 1, list: async () => null });
    assert.equal(t.listing, 'census');
    assert.ok(find(t.tree, 'apps/api/src/server.ts'));
  } finally { removeFixtureRepo(root); }
});

test('the answer comes in under 1 s on the fixture and on session-map itself', async () => {
  clearTreeCache();
  const root = copyFixtureRepo('acme-shop');
  try {
    const census = await censusOf(root, null, { owners });
    const t0 = performance.now();
    await repoTree(root, census, { nowMs: 1 });
    assert.ok(performance.now() - t0 < 1000);
  } finally { removeFixtureRepo(root); }
  const own = resolve(import.meta.dirname, '..');
  const census = await censusOf(own, null);
  clearTreeCache();
  const t0 = performance.now();
  const t = await repoTree(own, census, { nowMs: 1 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.ok(find(t.tree, 'server/foundation/census.mjs'));
});

test('a folder that holds no counted file keeps zero sums, not null', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const t = await repoTree(root, census, { nowMs: 1 });
  const pub = find(t.tree, 'apps/web/public');
  assert.equal(pub.files, 0);
  assert.equal(pub.grey, true);
}));
