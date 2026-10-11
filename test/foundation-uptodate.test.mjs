import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readArch } from '../server/arch/detect.mjs';
import { loadConfig } from '../server/config.mjs';
import { runDocwatch } from '../server/foundation/docwatch.mjs';
import { healthOf } from '../server/foundation/health.mjs';
import { buildModel } from '../server/foundation/model.mjs';
import { readStep, refreshFoundation } from '../server/foundation/refresh.mjs';
import { readFd, writeFd } from '../server/foundation/store.mjs';
import { LINES, runLine } from '../server/foundation/uptodate-lines.mjs';
import { buildCtx, buildUptodate, readUptodate, runUptodate } from '../server/foundation/uptodate.mjs';
import { versionsOf } from '../server/foundation/versions.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// The "Everything up to date?" panel (fd07): the catalogue of 35 lines, the guard that keeps a line from claiming what it
// cannot prove, the document of contract 7 and, on a copy of the invented acme-shop, the proof of the eight groups.

const NOW = '2026-10-10T12:00:00.000Z';
const STATES = new Set(['confirmed', 'warning', 'unverified']);
const REASONS = new Set(['no-token', 'no-network', 'tool-missing', 'no-data', 'not-applicable']);

test('the catalogue has 35 lines with unique ids, in the order of the groups 1 to 8', () => {
  assert.equal(LINES.length, 35);
  assert.equal(new Set(LINES.map((l) => l.id)).size, 35);
  const perGroup = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const l of LINES) {
    assert.ok(Number.isInteger(l.group) && l.group >= 1 && l.group <= 8, l.id);
    assert.ok(l.id.startsWith(`g${l.group}.`), l.id);
    assert.equal(typeof l.run, 'function', l.id);
    perGroup[l.group]++;
  }
  assert.deepEqual(perGroup.slice(1), [10, 5, 3, 2, 4, 3, 6, 2]);
  assert.deepEqual(LINES.map((l) => l.group), [...LINES.map((l) => l.group)].sort((a, b) => a - b), 'groups in order');
});

test('runLine never lets a confirmed line through without evidence', () => {
  const line = { id: 'g9.x', group: 9, run: () => ({ state: 'confirmed', evidence: [], reason: null, findingIds: [], detail: null }) };
  const out = runLine(line, {});
  assert.equal(out.state, 'unverified');
  assert.equal(out.reason, 'no-data');
  assert.deepEqual(out.evidence, []);
});

test('runLine never lets an unverified line through without a known reason', () => {
  for (const reason of [null, undefined, '', 'because']) {
    const line = { id: 'g9.x', group: 9, run: () => ({ state: 'unverified', evidence: [], reason, findingIds: [] }) };
    const out = runLine(line, {});
    assert.equal(out.state, 'unverified');
    assert.equal(out.reason, 'no-data', String(reason));
  }
  const keep = runLine({ id: 'g9.x', group: 9, run: () => ({ state: 'unverified', evidence: [], reason: 'no-token', findingIds: [] }) }, {});
  assert.equal(keep.reason, 'no-token');
});

test('runLine reads the reason of the versions step "no-source" as no-data without a warning in the log', () => {
  const seen = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk) => { seen.push(String(chunk)); return true; };
  let out;
  try {
    out = runLine({ id: 'g6.x', group: 6, run: () => ({ state: 'unverified', evidence: [], reason: 'no-source', findingIds: [] }) }, {});
  } finally {
    process.stderr.write = write;
  }
  assert.equal(out.state, 'unverified');
  assert.equal(out.reason, 'no-data');
  assert.deepEqual(seen, []);
});

test('runLine turns an unknown state or an answer that is not an object into unverified/no-data', () => {
  for (const answer of [{ state: 'ok' }, null, 'confirmed', undefined, { evidence: [{ file: 'a', line: 1 }] }]) {
    const out = runLine({ id: 'g9.x', group: 9, run: () => answer }, {});
    assert.equal(out.state, 'unverified');
    assert.equal(out.reason, 'no-data');
  }
});

test('runLine keeps a good confirmed and a good warning as they are and fills the shape', () => {
  const ev = [{ file: 'a.ts', line: 1, sha: 'x' }];
  const ok = runLine({ id: 'g9.x', group: 9, run: () => ({ state: 'confirmed', evidence: ev, detail: { msg: 'm' } }) }, {});
  assert.deepEqual(ok, { state: 'confirmed', evidence: ev, reason: null, findingIds: [], detail: { msg: 'm', params: {} } });
  const warn = runLine({ id: 'g9.x', group: 9, run: () => ({ state: 'warning', evidence: ev, findingIds: ['f:1'] }) }, {});
  assert.equal(warn.state, 'warning');
  assert.deepEqual(warn.findingIds, ['f:1']);
  assert.equal(warn.reason, null);
});

test('a line that throws becomes unverified/no-data and the others still run (e)', () => {
  const lines = [
    { id: 'g1.a', group: 1, run: () => { throw new Error('boom'); } },
    { id: 'g1.b', group: 1, run: () => ({ state: 'confirmed', evidence: [{ file: 'a', line: 1 }], reason: null, findingIds: [] }) },
    { id: 'g2.c', group: 2, run: () => ({ state: 'warning', evidence: [], reason: null, findingIds: [] }) },
  ];
  const doc = buildUptodate({ now: NOW }, { lines });
  assert.deepEqual(doc.lines.map((l) => [l.id, l.state]), [['g1.a', 'unverified'], ['g1.b', 'confirmed'], ['g2.c', 'warning']]);
  assert.equal(doc.lines[0].reason, 'no-data');
});

test('buildUptodate answers the document of contract 7: version, generatedAt and a checkedAt on every line', () => {
  const doc = buildUptodate({ now: NOW });
  assert.equal(doc.version, 1);
  assert.equal(doc.generatedAt, NOW);
  assert.equal(doc.lines.length, 35);
  for (const l of doc.lines) {
    assert.deepEqual(Object.keys(l).sort(), ['checkedAt', 'detail', 'evidence', 'findingIds', 'group', 'id', 'reason', 'state']);
    assert.equal(l.checkedAt, NOW);
    assert.ok(STATES.has(l.state), l.id);
    if (l.state === 'unverified') assert.ok(REASONS.has(l.reason), `${l.id} ${l.reason}`);
    if (l.state === 'confirmed') assert.ok(l.evidence.length > 0, l.id);
  }
});

test('with nothing read yet (no census, health, versions) no line is a warning and every one says why (c)', () => {
  const doc = buildUptodate({ now: NOW, project: { id: 'p' } });
  assert.deepEqual(doc.lines.filter((l) => l.state === 'warning').map((l) => l.id), []);
  assert.deepEqual(doc.lines.filter((l) => l.state === 'confirmed').map((l) => l.id), []);
});

test('readUptodate gives null when nothing was written, never an error', () => {
  assert.equal(readUptodate('C:/does/not/exist', 'nope'), null);
});

test('runLine writes the detail in the shape of the contract whatever the line gave: text, nothing or an object', () => {
  const ev = [{ file: 'a.ts', line: 1 }];
  const of = (state, detail) => runLine({ id: 'g7.x', group: 7, run: () => ({ state, evidence: state === 'unverified' ? [] : ev, reason: state === 'unverified' ? 'no-data' : null, detail }) }, {}).detail;
  assert.deepEqual(of('warning', '3'), { msg: 'uptodate.g7.x.warn', params: { detail: '3' } });
  assert.deepEqual(of('confirmed', null), { msg: 'uptodate.g7.x.ok', params: {} });
  assert.deepEqual(of('unverified', undefined), { msg: 'uptodate.g7.x.unverified', params: {} });
  assert.deepEqual(of('warning', { msg: 'uptodate.g7.x.warn', params: { count: 2 } }), { msg: 'uptodate.g7.x.warn', params: { count: 2 } });
});

// ---------- the proof of fd07, on a copy of the invented acme-shop ----------
// The fixture keeps planted gaps for the other tests (a folder no part owns, a citation of a route that is gone, names of
// variables nobody reads). The proof needs a project that is up to date first, so the copy is repaired and committed, and
// then ONE thing per group is broken.

const WHEN = '2026-10-10T12:00:00.000Z';
const NAME = 'acme-shop';
const ID = 'acme-shop-0a0b0c';
const TEST_FILE = "import { test } from 'node:test';\ntest('ok', () => {});\n";

const sh = (root, args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const edit = (root, path, fn) => put(root, path, fn(readFileSync(join(root, path), 'utf8')));
const commit = (root, message) => { sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', message]); };

function repair(root) {
  put(root, 'docs/architecture/admin.md', '# Admin\n\nThe back office the team uses.\n\n## Where in the code\n\n- `apps/admin/`\n');
  edit(root, 'docs/architecture/orders.md', (x) => x.replace('- `apps/api/` and `packages/adapters/`', '- `apps/api/`, `packages/adapters/` and the files at the root: `./README.md`, `./LICENSE`, `./.gitignore`, `./.env.example`, `./package.json`, `./pnpm-workspace.yaml`, `./turbo.json`, `docs/architecture/` and `test/`'));
  edit(root, 'docs/architecture/README.md', (t) => t.replace('- [Web](web.md) — the storefront.', '- [Web](web.md) — the storefront.\n- [Admin](admin.md) — the back office.'));
  edit(root, 'docs/architecture/orders.md', (t) => t.replace(/^- `DELETE \/v1\/orders\/:id`.*\r?\n/m, ''));
  edit(root, 'README.md', (t) => t.replace(/^\| `(DATABASE_URL|REDIS_URL|SESSION_SECRET)`.*\r?\n/gm, ''));
  edit(root, 'docs/architecture/db.md', (t) => t.replace('each order belongs to one customer.', 'each order belongs to one customer. `Tag` labels orders.'));
  put(root, '.env.example', '# Names only, never values.\nPORT=\nAPI_BASE_URL=\nWORKER_CONCURRENCY=\nPAYMENTS_API_KEY=\n');
  for (const dir of ['apps/admin', 'apps/api', 'apps/web', 'apps/worker', 'packages/adapters', 'packages/db', '']) put(root, `${dir ? `${dir}/` : ''}test/smoke.test.ts`, TEST_FILE);
  edit(root, 'docs/architecture/orders.md', (x) => `${x.trimEnd()}

${REQUEST}`);
  commit(root, 'repair the planted gaps');
}

// A request lives in the architecture document, as an item with an "Asked" line; "Where it went" is the item it became.
const REQUEST = [
  '### Receipts',
  '',
  '- [ ] **with Ana:** Receipts by e-mail `or03`',
  '  - Asked: 2026-10-10 10:00 — "send a receipt after each order"',
  '  - Where it went: `or01`',
  '',
].join('\n');

// One reading round as the refresh does it (census, facts), then the steps of the other blocks that the panel reads.
async function readAll(fx) {
  const { root, smDir } = fx;
  const out = await refreshFoundation({ id: ID, name: NAME, root }, smDir, { steps: [readStep()], now: () => (fx.clock += 60_000) });
  assert.ok(out.steps?.[0]?.ok, JSON.stringify(out));
  const census = readFd(smDir, ID, 'census.json');
  const facts = readFd(smDir, ID, 'facts.json');
  const config = loadConfig(root, smDir);
  const arch = await readArch(root, config, { mainBranch: 'main' });
  const linesOf = (path) => { const rows = readFileSync(join(root, path), 'utf8').split('\n'); if (rows.at(-1) === '') rows.pop(); return rows; };
  const model = buildModel(facts, census, arch, {}, { name: NAME, linesOf, level4: true });
  writeFd(smDir, ID, 'model.json', model);
  const versions = await versionsOf({ root, census, smDir, id: ID, now: new Date(WHEN) });
  await healthOf({ root, smDir, id: ID, now: new Date(WHEN) });
  const found = await runDocwatch({ root, smDir, id: ID, census, facts, model, arch, versions, config, now: () => Date.parse(WHEN) });
  assert.ok(found.ok, JSON.stringify(found));
  return { arch };
}

const cell = (extra = {}) => ({ id: 'feature-refunds', branch: 'feature/refunds', status: 'active', mergedAt: null, clashWith: [], lastCommit: { ts: '2026-10-09T12:00:00.000Z' }, ...extra });

// The state's project item: what the app hands over besides the files (work cells, chats, decisions).
async function panel(fx, { workCells = [cell()] } = {}) {
  const { arch } = await readAll(fx);
  const project = { id: ID, name: NAME, root: fx.root, arch, workCells, chats: [], decisions: [] };
  const doc = await runUptodate(project, fx.smDir, { now: () => Date.parse(WHEN) });
  assert.ok(doc, 'the panel was built');
  return { doc, project };
}

const byId = (doc) => new Map(doc.lines.map((l) => [l.id, l]));
const warnings = (doc) => doc.lines.filter((l) => l.state === 'warning').map((l) => l.id);

function shop() {
  const root = copyFixtureRepo(NAME, { env: false });
  const smDir = mkdtempSync(join(tmpdir(), 'sm-uptodate-'));
  const fx = { root, smDir, clock: Date.parse(WHEN), done: () => { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
  repair(root);
  return fx;
}

// One shop per round, all started together the first time a test asks: each has its own folder and its own data folder.
const rounds = new Map();
function round(name, make) {
  if (!rounds.has(name)) {
    rounds.set(name, (async () => {
      const fx = shop();
      try {
        const before = await make(fx);
        return { fx, ...before };
      } catch (err) {
        fx.done();
        throw err;
      }
    })());
  }
  return rounds.get(name);
}
test.after(async () => { for (const p of rounds.values()) { try { (await p).fx.done(); } catch { /* the test already failed */ } } });

const clean = () => round('clean', async (fx) => panel(fx));

test('a project that is up to date: the eight groups are there and every line is in one of the three states (a)', async () => {
  const { doc } = await clean();
  assert.equal(doc.lines.length, 35);
  assert.deepEqual([...new Set(doc.lines.map((l) => l.group))], [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const l of doc.lines) {
    assert.ok(STATES.has(l.state), l.id);
    if (l.state === 'confirmed') assert.ok(l.evidence.length > 0, `${l.id} says "confirmed" with nothing checked`);
    if (l.state === 'unverified') assert.ok(REASONS.has(l.reason), `${l.id} lacks a reason`);
  }
  assert.deepEqual(warnings(doc), [], 'nothing is out of date yet');
  assert.ok(doc.lines.filter((l) => l.state === 'confirmed').length >= 20, 'most lines were really checked');
});

test('the panel is stored in uptodate.json and read back whole', async () => {
  const { fx, doc } = await clean();
  assert.deepEqual(readUptodate(fx.smDir, ID), doc);
  assert.equal(readFd(fx.smDir, ID, 'uptodate.json').version, 1);
});

test('group 6 with no versions or no health file is unverified/no-data on every line, never a warning (c)', async () => {
  const { fx, project } = await clean();
  const ctx = await buildCtx(fx.root, fx.smDir, ID, project, { now: () => Date.parse(WHEN) });
  const doc = buildUptodate({ ...ctx, versions: null, health: null });
  for (const l of doc.lines.filter((x) => x.group === 6)) {
    assert.equal(l.state, 'unverified', l.id);
    assert.equal(l.reason, 'no-data', l.id);
  }
});

// The eight breaks: one thing per group; the expected line, and only that line, turns into a warning.
const BREAKS = [
  { name: 'a file no part owns', line: 'g1.census-owners', run: (fx) => { put(fx.root, 'notes/plan.txt', 'nothing planned yet\n'); commit(fx.root, 'a note nobody owns'); } },
  { name: 'a document that cites a route that does not exist', line: 'g2.cites', run: (fx) => { edit(fx.root, 'docs/architecture/orders.md', (t) => t.replace('## What\'s missing', '- `DELETE /v1/refunds/:id` cancels a refund.\n\n## What\'s missing')); commit(fx.root, 'cite a route that is gone'); } },
  { name: 'a version that differs from the tag', line: 'g3.versions', run: (fx) => { sh(fx.root, ['tag', 'v0.3.0']); } },
  { name: 'a variable the code reads and no document names', line: 'g4.env-documented', run: (fx) => { put(fx.root, 'apps/api/src/mail.ts', "export const smtp = process.env.SMTP_HOST ?? '';\n"); commit(fx.root, 'read a new variable'); } },
  { name: 'a part without a test', line: 'g5.tests-exist', run: (fx) => { sh(fx.root, ['rm', '-q', 'apps/worker/test/smoke.test.ts']); commit(fx.root, 'drop the worker test'); } },
  { name: 'a file git has not saved', line: 'g7.uncommitted', run: (fx) => { edit(fx.root, 'apps/api/src/log.ts', (t) => `${t}// unsaved\n`); } },
  { name: 'a branch already merged', line: 'g7.branches', workCells: [cell({ status: 'merged', mergedAt: '2026-10-09T18:00:00.000Z' })], run: () => {} },
  { name: 'a request with no item', line: 'g8.requests-no-item', run: (fx) => { edit(fx.root, 'docs/architecture/orders.md', (t) => t.replace(/^ {2}- Where it went:.*\r?\n/m, '')); commit(fx.root, 'a request that became nothing'); } },
];

for (const b of BREAKS) {
  test(`break: ${b.name} turns exactly ${b.line} into a warning (b)`, async () => {
    const base = (await clean()).doc;
    const got = await round(b.line, async (fx) => {
      await panel(fx, b.workCells ? { workCells: [cell()] } : {});
      b.run(fx);
      fx.clock += 120_000;
      return panel(fx, b.workCells ? { workCells: b.workCells } : {});
    });
    assert.deepEqual(warnings(got.doc), [b.line]);
    const line = byId(got.doc).get(b.line);
    assert.ok(line.evidence.length > 0, 'the warning points at what is wrong');
    assert.equal(line.detail.msg, `uptodate.${b.line}.warn`);
    const before = byId(base);
    for (const l of got.doc.lines) if (l.id !== b.line) assert.equal(l.state, before.get(l.id).state, `${l.id} moved by a break of ${b.line}`);
  });
}
