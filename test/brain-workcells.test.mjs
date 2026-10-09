import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backfillMerges, detectTransitions, placeWorkCell, workCellsOf } from '../server/brain/workcells.mjs';
import { appendEvents, eventsPath, readEvents } from '../server/brain/events.mjs';
import { autoFetch } from '../server/sources/fetch.mjs';
import { normalizePath } from '../server/paths.mjs';

const PEOPLE = {
  ana: ['Ana', 'ana@example.com'],
  rui: ['Rui', 'rui@example.com'],
  zoe: ['Zoe', 'zoe@example.com'],
};
let clock = Date.parse('2026-09-01T10:00:00Z');

function git(cwd, args, who = 'ana') {
  const [name, email] = PEOPLE[who];
  const date = new Date((clock += 60_000)).toISOString();
  return execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function commit(cwd, files, subject, who = 'ana') {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    if (text === null) git(cwd, ['rm', '-q', path], who);
    else {
      writeFileSync(join(cwd, path), text);
      git(cwd, ['add', path], who);
    }
  }
  git(cwd, ['commit', '-q', '-m', subject], who);
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

const UNITS = [
  { id: 'web', name: 'Web', paths: ['apps/web'] },
  { id: 'api', name: 'API', paths: ['apps/api'] },
  { id: 'unsorted', name: 'Unsorted', paths: [] },
];

function makeRepo() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-wc-')));
  const root = join(base, 'repo');
  mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  commit(root, { 'apps/web/page.js': 'p1', 'apps/web/old.js': 'o1', 'apps/api/route.js': 'r1', 'README.md': 'x' }, 'init');
  return { base, root };
}

// Ana works on the web (and touches the api route); Rui works on the api route: one clash on apps/api/route.js.
function twoBranches(root) {
  git(root, ['checkout', '-q', '-b', 'feature/ana']);
  commit(root, { 'apps/web/page.js': 'p2', 'apps/web/new.js': 'n1' }, 'web page', 'ana');
  commit(root, { 'apps/web/old.js': null, 'apps/api/route.js': 'r-ana' }, 'drop old, tweak route', 'ana');
  commit(root, { 'apps/web/page.js': 'p3' }, 'polish from rui', 'rui');
  git(root, ['checkout', '-q', 'main']);
  git(root, ['checkout', '-q', '-b', 'feature/rui']);
  commit(root, { 'apps/api/route.js': 'r-rui' }, 'route v2', 'rui');
  git(root, ['checkout', '-q', 'main']);
  git(root, ['branch', 'idle-copy']);
}

test('workCellsOf: two branches by different authors become work cells', async () => {
  const { base, root } = makeRepo();
  try {
    twoBranches(root);
    const wt = join(base, 'wt-rui');
    git(root, ['worktree', 'add', '-q', wt, 'feature/rui']);
    const cells = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    assert.deepEqual(cells.map((c) => c.id).sort(), ['feature/ana', 'feature/rui'], 'branches with nothing ahead are not cells');

    const ana = cells.find((c) => c.id === 'feature/ana');
    assert.equal(ana.branch, 'feature/ana');
    assert.equal(ana.remote, false);
    assert.equal(ana.path, null);
    assert.equal(ana.ahead, 3);
    assert.equal(ana.commits, 3);
    assert.deepEqual(ana.owner, { name: 'Ana', email: 'ana@example.com' });
    assert.deepEqual(ana.authors.map((a) => a.name).sort(), ['Ana', 'Rui']);
    assert.deepEqual(
      [...ana.files].sort((a, b) => a.path.localeCompare(b.path)),
      [
        { path: 'apps/api/route.js', status: 'M' },
        { path: 'apps/web/new.js', status: 'A' },
        { path: 'apps/web/old.js', status: 'D' },
        { path: 'apps/web/page.js', status: 'M' },
      ],
    );
    assert.equal(ana.unitId, 'web');
    assert.deepEqual(ana.touches, ['api']);
    assert.equal(ana.lastCommit.subject, 'polish from rui');
    assert.match(ana.lastCommit.hash, /^[0-9a-f]{40}$/);
    assert.ok(Date.parse(ana.bornAt) < Date.parse(ana.lastCommit.ts));
    assert.equal(ana.status, 'active');
    assert.equal(ana.mergedAt, null);
    assert.deepEqual(ana.chatIds, []);

    const rui = cells.find((c) => c.id === 'feature/rui');
    assert.deepEqual(rui.owner, { name: 'Rui', email: 'rui@example.com' });
    assert.equal(rui.unitId, 'api');
    assert.deepEqual(rui.touches, []);
    assert.equal(normalizePath(rui.path), normalizePath(wt));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('workCellsOf: cells sharing a file clash with each other', async () => {
  const { base, root } = makeRepo();
  try {
    twoBranches(root);
    const cells = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    assert.deepEqual(cells.find((c) => c.id === 'feature/ana').clashWith, ['feature/rui']);
    assert.deepEqual(cells.find((c) => c.id === 'feature/rui').clashWith, ['feature/ana']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('workCellsOf: a cell without commits for a week is idle and one outside every unit is unsorted', async () => {
  const { base, root } = makeRepo();
  try {
    git(root, ['checkout', '-q', '-b', 'docs']);
    commit(root, { 'README.md': 'y' }, 'docs');
    git(root, ['checkout', '-q', 'main']);
    const [cell] = await workCellsOf(root, UNITS, { main: 'main', now: clock + 8 * 86_400_000 });
    assert.equal(cell.status, 'idle');
    assert.equal(cell.unitId, 'unsorted');
    assert.deepEqual(cell.touches, []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('workCellsOf: remote branches of other people are cells; a remote copy of a local branch is not repeated', async () => {
  const { base, root } = makeRepo();
  try {
    const remote = join(base, 'remote.git');
    git(base, ['init', '-q', '--bare', '-b', 'main', remote]);
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-q', 'origin', 'main']);
    git(root, ['checkout', '-q', '-b', 'feature/ana']);
    commit(root, { 'apps/web/page.js': 'p2' }, 'web', 'ana');
    git(root, ['push', '-q', 'origin', 'feature/ana']);
    git(root, ['checkout', '-q', 'main']);

    const other = join(base, 'other');
    git(base, ['clone', '-q', remote, other]);
    git(other, ['checkout', '-q', '-b', 'feature/zoe']);
    commit(other, { 'apps/api/zoe.js': 'z' }, 'zoe api', 'zoe');
    git(other, ['push', '-q', 'origin', 'feature/zoe'], 'zoe');
    git(root, ['fetch', '-q', 'origin']);

    const cells = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    assert.deepEqual(cells.map((c) => c.id).sort(), ['feature/ana', 'origin/feature/zoe']);
    const zoe = cells.find((c) => c.id === 'origin/feature/zoe');
    assert.equal(zoe.remote, true);
    assert.equal(zoe.branch, 'feature/zoe');
    assert.deepEqual(zoe.owner, { name: 'Zoe', email: 'zoe@example.com' });
    assert.equal(zoe.unitId, 'api');

    const localOnly = await workCellsOf(root, UNITS, { main: 'main', includeRemote: false, now: clock });
    assert.deepEqual(localOnly.map((c) => c.id), ['feature/ana']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('detectTransitions: new cells are born, merged cells fuse, nothing repeats', () => {
  const now = '2026-09-02T00:00:00.000Z';
  const a = { id: 'feature/a', status: 'active', bornAt: '2026-09-01T10:00:00.000Z', mergedAt: null };
  const b = { id: 'feature/b', status: 'active', bornAt: '2026-09-01T11:00:00.000Z', mergedAt: null };
  assert.deepEqual(detectTransitions([], [a], now), [{ kind: 'born', workCellId: 'feature/a', ts: a.bornAt }]);
  assert.deepEqual(detectTransitions([a], [a, b], now), [{ kind: 'born', workCellId: 'feature/b', ts: b.bornAt }]);
  const aMerged = { ...a, status: 'merged', mergedAt: '2026-09-01T20:00:00.000Z' };
  assert.deepEqual(detectTransitions([a, b], [aMerged, b], now), [{ kind: 'fused', workCellId: 'feature/a', ts: aMerged.mergedAt }]);
  assert.deepEqual(detectTransitions([aMerged, b], [aMerged, b], now), []);
  assert.deepEqual(detectTransitions([a], [], now), [], 'a branch that vanished without merging is not a fusion');
  assert.deepEqual(detectTransitions([], [{ ...b, bornAt: undefined }], now), [{ kind: 'born', workCellId: 'feature/b', ts: now }]);
});

test('fusion by merge commit: the previous cell comes back as merged at the merge time', async () => {
  const { base, root } = makeRepo();
  try {
    twoBranches(root);
    const before = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/rui'", 'feature/rui'], 'rui');
    const mergeTs = git(root, ['log', '-1', '--format=%cI']).trim();
    const after = await workCellsOf(root, UNITS, { main: 'main', previous: before, now: clock });
    const rui = after.find((c) => c.id === 'feature/rui');
    assert.equal(rui.status, 'merged');
    assert.equal(Date.parse(rui.mergedAt), Date.parse(mergeTs));
    assert.equal(rui.ahead, 0);
    assert.deepEqual(after.find((c) => c.id === 'feature/ana').clashWith, [], 'a merged cell no longer clashes');
    assert.deepEqual(detectTransitions(before, after, new Date(clock).toISOString()), [{ kind: 'fused', workCellId: 'feature/rui', ts: rui.mergedAt }]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('fusion by rebase and fast-forward is detected, even after the branch is deleted', async () => {
  const { base, root } = makeRepo();
  try {
    twoBranches(root);
    commit(root, { 'apps/web/other.js': 'o' }, 'main moves on');
    const before = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    git(root, ['checkout', '-q', 'feature/rui']);
    git(root, ['rebase', '-q', 'main'], 'rui');
    const rebased = await workCellsOf(root, UNITS, { main: 'main', previous: before, now: clock });
    assert.equal(rebased.find((c) => c.id === 'feature/rui').status, 'active', 'rebased but not merged yet');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--ff-only', 'feature/rui']);
    git(root, ['branch', '-q', '-d', 'feature/rui']);
    const after = await workCellsOf(root, UNITS, { main: 'main', previous: rebased, now: clock });
    const rui = after.find((c) => c.id === 'feature/rui');
    assert.equal(rui.status, 'merged');
    assert.ok(rui.mergedAt);
    assert.deepEqual(detectTransitions(rebased, after, new Date(clock).toISOString()).map((t) => t.kind), ['fused']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('backfillMerges rebuilds birth and fusion of old merges from the first-parent history', async () => {
  const { base, root } = makeRepo();
  try {
    git(root, ['checkout', '-q', '-b', 'feature/rui']);
    commit(root, { 'apps/api/route.js': 'r-rui' }, 'route v2', 'rui');
    const ruiBorn = git(root, ['log', '-1', '--format=%aI']).trim();
    commit(root, { 'apps/api/more.js': 'm' }, 'more api', 'rui');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['checkout', '-q', '-b', 'feature/ana']);
    commit(root, { 'apps/web/page.js': 'p2' }, 'web page', 'ana');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/rui'", 'feature/rui']);
    git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from ana/feature/ana', 'feature/ana']);
    git(root, ['checkout', '-q', '-b', 'side']);
    commit(root, { 'x.txt': '1' }, 'side work');
    git(root, ['checkout', '-q', 'main']);
    const events = await backfillMerges(root, 'main');
    const rui = events.filter((e) => e.workCellId === 'feature/rui');
    assert.deepEqual(rui.map((e) => e.kind), ['born', 'fused']);
    assert.equal(Date.parse(rui[0].ts), Date.parse(ruiBorn));
    assert.ok(events.some((e) => e.kind === 'fused' && e.workCellId === 'feature/ana'), 'pull request merges name the branch without the fork owner');
    assert.equal(events.length, 4);
    assert.ok(events.every((e, i) => i === 0 || Date.parse(events[i - 1].ts) <= Date.parse(e.ts)), 'oldest first');
    assert.deepEqual(await backfillMerges(join(base, 'nowhere'), 'main'), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('appendEvents/readEvents keep one line per event and skip a truncated line', () => {
  const smDir = realpathSync(mkdtempSync(join(tmpdir(), 'sm-ev-')));
  try {
    assert.deepEqual(readEvents(smDir, 'proj-abc123'), []);
    const born = { kind: 'born', workCellId: 'feature/a', ts: '2026-09-01T10:00:00.000Z' };
    const fused = { kind: 'fused', workCellId: 'feature/a', ts: '2026-09-02T10:00:00.000Z' };
    assert.equal(appendEvents(smDir, 'proj-abc123', [born]), 1);
    assert.equal(appendEvents(smDir, 'proj-abc123', [born, fused, fused]), 1);
    appendFileSync(eventsPath(smDir, 'proj-abc123'), '{"kind":"born","workCe');
    assert.deepEqual(readEvents(smDir, 'proj-abc123'), [born, fused]);
    assert.equal(appendEvents(smDir, 'proj-abc123', [{ ...born, ts: '2026-09-05T00:00:00.000Z' }]), 1, 'a reused branch name is born again');
    assert.equal(readEvents(smDir, 'proj-abc123').length, 3);
    assert.throws(() => appendEvents(smDir, '../escape', [born]));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('autoFetch: off by default, harmless without a remote', async () => {
  const { base, root } = makeRepo();
  try {
    assert.equal(await autoFetch(root, 0), null);
    assert.equal(await autoFetch(root, 10), null);
    assert.equal(await autoFetch(join(base, 'nowhere'), 10), null);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('autoFetch fetches new remote branches, shares one run per repo and waits the interval', async () => {
  const { base, root } = makeRepo();
  try {
    const remote = join(base, 'remote.git');
    git(base, ['init', '-q', '--bare', '-b', 'main', remote]);
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-q', 'origin', 'main']);
    const other = join(base, 'other');
    git(base, ['clone', '-q', remote, other]);
    const pushBranch = (name) => {
      git(other, ['checkout', '-q', '-b', name, 'origin/main']);
      commit(other, { [`${name}.txt`]: name }, name, 'zoe');
      git(other, ['push', '-q', 'origin', name], 'zoe');
    };
    pushBranch('zoe1');

    const first = autoFetch(root, 10);
    assert.equal(autoFetch(root, 10), first, 'a second call while fetching joins the running fetch');
    const fetchedAt = await first;
    assert.ok(Date.parse(fetchedAt) <= Date.now());
    assert.match(git(root, ['branch', '-r']), /origin\/zoe1/);

    pushBranch('zoe2');
    assert.equal(await autoFetch(root, 10), fetchedAt, 'within the interval nothing runs');
    assert.doesNotMatch(git(root, ['branch', '-r']), /origin\/zoe2/);
    const later = await autoFetch(root, 10, { now: Date.now() + 11 * 60_000 });
    assert.notEqual(later, fetchedAt);
    assert.match(git(root, ['branch', '-r']), /origin\/zoe2/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('backfillMerges with since only reads merges inside the window', async () => {
  const { base, root } = makeRepo();
  try {
    git(root, ['checkout', '-q', '-b', 'feature/old']);
    commit(root, { 'apps/api/old.js': 'o' }, 'old work');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/old'", 'feature/old']);
    const since = new Date(clock + 30_000).toISOString();
    git(root, ['checkout', '-q', '-b', 'feature/new']);
    commit(root, { 'apps/api/new.js': 'n' }, 'new work');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/new'", 'feature/new']);
    const events = await backfillMerges(root, 'main', { since });
    assert.deepEqual([...new Set(events.map((e) => e.workCellId))], ['feature/new']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('workCellsOf: a branch idle for a week clashes with nobody, only two active ones do', async () => {
  const { base, root } = makeRepo();
  try {
    twoBranches(root);
    clock += 8 * 86_400_000;
    git(root, ['checkout', '-q', '-b', 'feature/zoe']);
    commit(root, { 'apps/api/route.js': 'r-zoe' }, 'route v3', 'zoe');
    git(root, ['checkout', '-q', 'main']);
    const cells = await workCellsOf(root, UNITS, { main: 'main', now: clock });
    const of = (id) => cells.find((c) => c.id === id).clashWith.sort();
    assert.deepEqual(of('feature/ana'), []);
    assert.deepEqual(of('feature/rui'), []);
    assert.deepEqual(of('feature/zoe'), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

const files = (...paths) => paths.map((path) => ({ path, status: 'M' }));
const DEEP_UNITS = [
  { id: 'comms', paths: ['apps/backend-api', 'packages/core/src/whatsapp'] },
  { id: 'providers', paths: ['apps/backend-api/src/routes/admin'] },
  { id: 'billing', paths: ['apps/backend-api/src/billing'] },
  { id: 'unsorted', paths: [] },
];

test('placeWorkCell: the deepest specific path wins over a broad app folder, however many files the broad one covers', () => {
  const many = Array.from({ length: 30 }, (_, i) => `apps/backend-api/src/services/s${i}.ts`);
  const place = placeWorkCell(files(...many, 'apps/backend-api/src/routes/admin/a.ts', 'apps/backend-api/src/routes/admin/b.ts'), DEEP_UNITS);
  assert.equal(place.unitId, 'providers');
  assert.deepEqual(place.touches, ['comms']);
});

test('placeWorkCell: a tie between specific paths goes to unsorted and touches both', () => {
  const place = placeWorkCell(files('apps/backend-api/src/routes/admin/a.ts', 'apps/backend-api/src/billing/b.ts'), DEEP_UNITS);
  assert.equal(place.unitId, 'unsorted');
  assert.deepEqual(place.touches.sort(), ['billing', 'providers']);
});

test('placeWorkCell: only broad matches still place the branch, and nothing matching leaves it unsorted', () => {
  assert.equal(placeWorkCell(files('apps/backend-api/package.json', 'apps/backend-api/src/x.ts'), DEEP_UNITS).unitId, 'comms');
  assert.deepEqual(placeWorkCell(files('README.md'), DEEP_UNITS), { unitId: 'unsorted', touches: [] });
});
