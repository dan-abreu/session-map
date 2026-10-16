import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { refreshFoundation, readStep } from '../server/foundation/refresh.mjs';
import { foundationSummary } from '../server/foundation/summary.mjs';
import { fdDir, readFd, writeFd } from '../server/foundation/store.mjs';
import { emptyLedger, ledgerDocument, recordRead } from '../server/foundation/ledger.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const ID = 'acme-shop-8324f1';
const answerOf = (name) => JSON.parse(readFileSync(join(FIXTURE_REPOS, `${name}.answer.json`), 'utf8'));
const answer = answerOf('acme-shop');
const frac = (c) => (c.den === 0 ? null : c.num / c.den);
const T0 = new Date('2026-10-10T12:00:00.000Z');

async function withProject(fn, { name = 'acme-shop', id = ID } = {}) {
  const root = copyFixtureRepo(name);
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdreadround-'));
  const project = { id, name, root };
  let t = T0.getTime();
  // each round is a new moment, and the 30 s gap between rounds is the shell's business, not these tests'
  const round = (opts = {}) => {
    t += 60_000;
    return refreshFoundation(project, smDir, { steps: [readStep({ now: () => new Date(t), ...opts })], now: () => t });
  };
  try { await fn({ root, smDir, project, round }); } finally {
    removeFixtureRepo(root);
    rmSync(smDir, { recursive: true, force: true });
  }
}

const gitStatus = (root) => execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: root, encoding: 'utf8', windowsHide: true });
const logLines = (smDir) => readFileSync(join(fdDir(smDir, ID), 'census-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rawOf = (smDir, name, id = ID) => readFileSync(join(fdDir(smDir, id), name), 'utf8');

test('a first round writes the four files and project.foundation carries the numbers of the answer key', async () => {
  await withProject(async ({ smDir, round }) => {
    const out = await round();
    assert.deepEqual(out.steps.map((s) => [s.name, s.ok]), [['read', true]], JSON.stringify(out));
    for (const name of ['census.json', 'census-log.jsonl', 'facts.json', 'sections.json']) assert.ok(existsSync(join(fdDir(smDir, ID), name)), name);
    const summary = foundationSummary(smDir, ID);
    const owned = Object.values(answer.owners);
    assert.equal(summary.census.rev, 1);
    assert.equal(summary.census.files, owned.length);
    assert.equal(summary.census.noOwner, owned.filter((o) => o === null).length);
    assert.equal(summary.census.lines, readFd(smDir, ID, 'census.json').sums.total.lines.total);
    for (const k of ['owned', 'routes', 'screens', 'tables']) assert.equal(summary.coverage[k], frac(answer.coverage[k]), k);
    assert.equal(summary.read, null, 'no AI read it yet: the page says "not read", not 0 %');
    assert.equal(summary.uptodate, null);
    assert.equal(summary.updatedAt, new Date(T0.getTime() + 60_000).toISOString());
  });
});

test('the owners worked out by the round are the answer key\'s, and the first statement lists every file as added', async () => {
  await withProject(async ({ smDir, round }) => {
    await round();
    const census = readFd(smDir, ID, 'census.json');
    for (const f of census.files) if (f.included) assert.equal(f.owner, answer.owners[f.path] ?? null, f.path);
    const [line, ...more] = logLines(smDir);
    assert.equal(more.length, 0);
    assert.equal(line.rev, 1);
    assert.equal(line.from, 0);
    assert.equal(line.added.length, census.sums.total.files);
    assert.deepEqual(line.removed, []);
    assert.deepEqual(line.changed, []);
  });
});

test('the facts and the sections are the readers\' output on the copy', async () => {
  await withProject(async ({ smDir, round }) => {
    await round();
    const facts = readFd(smDir, ID, 'facts.json');
    assert.equal(facts.censusRev, 1);
    const ids = new Set(facts.facts.map((f) => f.id));
    for (const f of answer.facts) assert.ok(ids.has(f.id), f.id);
    const sections = readFd(smDir, ID, 'sections.json');
    assert.equal(sections.censusRev, 1);
    assert.deepEqual(sections.counts.routes, answer.coverage.routes);
  });
});

test('a second round with no change keeps the same rev, writes nothing and adds no line to the statement', async () => {
  await withProject(async ({ smDir, round }) => {
    await round();
    const before = Object.fromEntries(['census.json', 'census-log.jsonl', 'facts.json', 'sections.json'].map((n) => [n, rawOf(smDir, n)]));
    const out = await round();
    assert.equal(out.steps[0].ok, true);
    for (const [name, text] of Object.entries(before)) assert.equal(rawOf(smDir, name), text, `${name} is the same bytes`);
    assert.equal(readFd(smDir, ID, 'census.json').rev, 1);
    assert.equal(logLines(smDir).length, 1);
  });
});

test('editing one file moves the rev, adds one statement line naming only that file, and rereads only that file', async () => {
  await withProject(async ({ root, smDir, round }) => {
    await round();
    const target = 'apps/api/src/services/notify.ts';
    const reads = [];
    const first = readFd(smDir, ID, 'census.json');
    writeFileSync(join(root, target), `${readFileSync(join(root, target), 'utf8')}\nexport const added = 1;\n`);
    const out = await round({ readText: (path) => { reads.push(path); return readFileSync(join(root, path), 'utf8'); } });
    assert.equal(out.steps[0].ok, true);
    assert.deepEqual(reads, [target], 'only the edited file is read again by the readers');
    const census = readFd(smDir, ID, 'census.json');
    assert.equal(census.rev, 2);
    const lines = logLines(smDir);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].rev, 2);
    assert.equal(lines[1].from, 1);
    assert.deepEqual(lines[1].changed.map((c) => c.path), [target]);
    assert.deepEqual([lines[1].added, lines[1].removed], [[], []]);
    const before = first.files.find((f) => f.path === target);
    const after = census.files.find((f) => f.path === target);
    assert.equal(lines[1].changed[0].before.sha, before.sha);
    assert.equal(lines[1].changed[0].after.sha, after.sha);
    assert.equal(lines[1].totals.after.lines - lines[1].totals.before.lines, 2);
    assert.equal(readFd(smDir, ID, 'facts.json').censusRev, 2);
  });
});

test('a new file shows in the statement as added and the round after it is quiet again', async () => {
  await withProject(async ({ root, smDir, round }) => {
    await round();
    writeFileSync(join(root, 'apps/api/src/extra.ts'), 'export const extra = 1;\n');
    await round();
    assert.deepEqual(logLines(smDir)[1].added.map((a) => a.path), ['apps/api/src/extra.ts']);
    await round();
    assert.equal(logLines(smDir).length, 2);
    assert.equal(readFd(smDir, ID, 'census.json').rev, 2);
  });
});

test('a statement line left by a round that died before census.json is replaced, not repeated', async () => {
  await withProject(async ({ root, smDir, round }) => {
    await round();
    const path = join(fdDir(smDir, ID), 'census-log.jsonl');
    writeFileSync(path, `${readFileSync(path, 'utf8')}${JSON.stringify({ rev: 2, from: 1, added: [{ path: 'ghost.ts', lines: 1, chars: 1 }], removed: [], changed: [] })}\n{torn\n`);
    writeFileSync(join(root, 'apps/api/src/extra.ts'), 'export const extra = 1;\n');
    await round();
    const lines = logLines(smDir);
    assert.deepEqual(lines.map((l) => l.rev), [1, 2]);
    assert.deepEqual(lines[1].added.map((a) => a.path), ['apps/api/src/extra.ts']);
  });
});

test('nothing is written outside smDir: the copy\'s git status is the same after the rounds', async () => {
  await withProject(async ({ root, smDir, round }) => {
    const before = gitStatus(root);
    const listing = readdirSync(root).sort();
    await round();
    await round();
    assert.equal(gitStatus(root), before);
    assert.deepEqual(readdirSync(root).sort(), listing);
    assert.ok(existsSync(fdDir(smDir, ID)));
  });
});

test('the .env of the copy is never opened', async () => {
  await withProject(async ({ smDir, round }) => {
    await round();
    for (const name of readdirSync(fdDir(smDir, ID))) assert.ok(!rawOf(smDir, name).includes('do-not-read-42'), name);
  });
});

test('a ledger written by an AI round is kept up to date: whole at first, then the edited file counts as unread', async () => {
  await withProject(async ({ root, smDir, round }) => {
    await round();
    const census = readFd(smDir, ID, 'census.json');
    let ledger = emptyLedger();
    for (const f of census.files) if (f.included) ledger = recordRead(ledger, f.path, f.sha, [[1, f.lines.total]], { run: 'r1', model: 'sonnet', at: T0.toISOString() });
    writeFd(smDir, ID, 'read-ledger.json', ledgerDocument(ledger, census, { now: T0 }));
    assert.equal(foundationSummary(smDir, ID).read.percent, 100);
    await round();
    assert.equal(foundationSummary(smDir, ID).read.percent, 100, 'a quiet round keeps it');
    const target = 'apps/api/src/server.ts';
    writeFileSync(join(root, target), `${readFileSync(join(root, target), 'utf8')}// more\n`);
    await round();
    const summary = foundationSummary(smDir, ID);
    assert.ok(summary.read.percent < 100, 'the edited file is unread again');
    assert.deepEqual(readFd(smDir, ID, 'read-ledger.json').summary.missing.map((m) => m.path), [target]);
  });
});

function listSources(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', windowsHide: true })
    .split('\n').filter((p) => /\.(ts|tsx|js)$/.test(p));
}

test('without the optional tools no fact is marked AMBIGUOUS by a cross-check', async () => {
  await withProject(async ({ smDir, round }) => {
    await round({ optional: { which: () => null } });
    const own = readFd(smDir, ID, 'facts.json').facts.filter((f) => f.kind === 'import' && !f.attrs?.library);
    assert.ok(own.length > 0);
    assert.ok(own.every((f) => f.origin !== 'AMBIGUOUS'));
  });
});

test('optional tools are asked only by name (scc, depcruise), never npx, and a divergence turns our import into AMBIGUOUS', async () => {
  await withProject(async ({ root, smDir, round }) => {
    const asked = [];
    const which = (name) => { asked.push(name); return name === 'depcruise' ? '/fake/depcruise' : null; };
    // the tool "analysed" every source file of the copy and found no dependency anywhere
    const exec = async () => ({ stdout: JSON.stringify({ modules: listSources(root).map((source) => ({ source, dependencies: [] })) }) });
    await round({ optional: { which, exec } });
    assert.ok(asked.includes('scc') && asked.includes('depcruise'));
    assert.ok(asked.every((n) => n === 'scc' || n === 'depcruise'), `asked: ${asked}`);
    const facts = readFd(smDir, ID, 'facts.json').facts;
    const imports = facts.filter((f) => f.kind === 'import' && !f.attrs?.library);
    assert.ok(imports.length > 0);
    assert.ok(imports.every((f) => f.origin === 'AMBIGUOUS'), 'our own reading stays, marked, never replaced');
    assert.ok(facts.some((f) => f.kind === 'route' && f.origin !== 'AMBIGUOUS'), 'only imports are marked');
  });
});

test('a project whose folder is gone fails the step with a name and writes nothing', async () => {
  await withProject(async ({ smDir, round, project }) => {
    project.root = join(tmpdir(), 'sm-fdreadround-does-not-exist');
    const out = await round();
    assert.deepEqual([out.steps[0].ok, out.steps[0].error], [false, 'no-root']);
    assert.equal(existsSync(fdDir(smDir, ID)), false);
  });
});

test('the home folder and a disk root are not a project to count: the step fails with a name and reads nothing', async () => {
  for (const wide of [homedir(), parse(homedir()).root]) {
    const smDir = mkdtempSync(join(tmpdir(), 'sm-fdreadround-'));
    try {
      const out = await refreshFoundation({ id: 'home-000001', name: 'home', root: wide }, smDir, { steps: [readStep()] });
      assert.deepEqual([out.steps[0].ok, out.steps[0].error], [false, 'too-wide'], wide);
      assert.ok(out.steps[0].ms < 2000, `${wide} took ${out.steps[0].ms} ms`);
      assert.equal(existsSync(fdDir(smDir, 'home-000001')), false);
    } finally { rmSync(smDir, { recursive: true, force: true }); }
  }
});

test('the default round runs the reading first, then the blocks (fd20)', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdreadround-'));
  try {
    const out = await refreshFoundation({ id: 'acme-lib-000001', name: 'acme-lib', root: join(tmpdir(), 'sm-nope') }, smDir);
    assert.deepEqual(out.steps.map((s) => s.name), ['read', 'model', 'versions', 'guide', 'health', 'uptodate']);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the summary of a project never read is null, never zeros', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdreadround-'));
  try { assert.equal(foundationSummary(smDir, ID), null); } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('acme-lib (a library, no screens, routes or tables): coverage nulls, not zeros', async () => {
  const lib = 'acme-lib-000001';
  await withProject(async ({ smDir, round }) => {
    await round();
    const summary = foundationSummary(smDir, lib);
    const want = answerOf('acme-lib').coverage;
    for (const k of ['routes', 'screens', 'tables']) assert.equal(summary.coverage[k], null, k);
    assert.equal(summary.coverage.owned, frac(want.owned));
    assert.ok(rawOf(smDir, 'census.json', lib).length > 0);
  }, { name: 'acme-lib', id: lib });
});
