import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedUnits, loadUnits, classify, setOverride, readOverrides } from '../server/brain/cells.mjs';
import { projectIdOf } from '../server/paths.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'sm-cells-'));
}
function spec(root, name, md) {
  const dir = join(root, 'openspec', 'specs', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spec.md'), md);
}

test('seedUnits turns each openspec spec into a unit with the paths its spec.md cites, plus unsorted', () => {
  const root = tmp();
  try {
    spec(root, 'auth', 'Login lives in `apps/web/src/login` and packages/core/auth/session.ts.\nSee https://example.com/a/b/c and GET /api/v1/x.\nAlso `apps/web/src/login` again.\n');
    spec(root, 'billing', 'No paths here, just words like and/or.\n');
    const units = seedUnits(root, { gitLog: [] });
    assert.deepEqual(units.map((u) => u.id), ['auth', 'billing', 'unsorted']);
    assert.deepEqual(units[0].paths, ['apps/web/src/login', 'packages/core/auth/session.ts']);
    assert.deepEqual(units[1].paths, []);
    assert.deepEqual(units[2].paths, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('seedUnits without openspec uses the 12 busiest first/second-level folders of the git log', () => {
  const root = tmp();
  try {
    const gitLog = [];
    for (let i = 0; i < 14; i++) for (let n = 0; n <= i; n++) gitLog.push(`packages/p${i}/src/f${n}.ts`);
    gitLog.push('README.md', 'src/index.ts', 'src/index.ts', 'src/index.ts');
    const units = seedUnits(root, { gitLog });
    assert.equal(units.length, 13, '12 folders + unsorted');
    assert.equal(units[0].id, 'packages-p13');
    assert.deepEqual(units[0].paths, ['packages/p13']);
    assert.ok(!units.some((u) => u.id === 'packages-p0'), 'least busy folders are cut');
    assert.equal(units.at(-1).id, 'unsorted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('seedUnits on an empty project still returns unsorted', () => {
  const root = tmp();
  try { assert.deepEqual(seedUnits(root, { gitLog: [] }).map((u) => u.id), ['unsorted']); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadUnits seeds once, persists units.json and then reads it back (edits survive)', () => {
  const root = tmp();
  const smDir = tmp();
  try {
    spec(root, 'auth', 'See `apps/web`.');
    const first = loadUnits(smDir, root, { gitLog: [] });
    const file = join(smDir, 'brain', projectIdOf(root), 'units.json');
    assert.ok(existsSync(file));
    const edited = JSON.parse(readFileSync(file, 'utf8'));
    edited[0].name = 'Renamed by the user';
    writeFileSync(file, JSON.stringify(edited));
    spec(root, 'later', 'new spec after the first run');
    const second = loadUnits(smDir, root, { gitLog: [] });
    assert.equal(first[0].name, 'auth');
    assert.equal(second[0].name, 'Renamed by the user');
    assert.ok(!second.some((u) => u.id === 'later'), 'no re-seeding once persisted');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

const units = [
  { id: 'auth', name: 'Autenticação', paths: ['apps/web/src/login', 'packages/core/auth'] },
  { id: 'payments', name: 'Pagamentos', paths: ['packages/core'] },
  { id: 'unsorted', name: 'Unsorted', paths: [] },
];
const summary = (editedFiles = [], mentionedPaths = [], extra = {}) => ({ sessionId: 's1', cwd: '/proj', editedFiles, mentionedPaths, ...extra });

test('classify: override wins, then card area (id or accent-free name), then files, then unsorted', () => {
  const files = ['apps/web/src/login/form.ts'];
  assert.deepEqual(classify(summary(files), { area: 'payments' }, units, { s1: 'payments' }), { unitId: 'payments', unitSource: 'override' });
  assert.deepEqual(classify(summary(files), { area: 'payments' }, units, {}), { unitId: 'payments', unitSource: 'card' });
  assert.deepEqual(classify(summary([]), { area: ' AUTENTICACAO ' }, units, {}), { unitId: 'auth', unitSource: 'card' });
  assert.deepEqual(classify(summary(files), null, units, {}), { unitId: 'auth', unitSource: 'files' });
  assert.deepEqual(classify(summary([]), null, units, {}), { unitId: 'unsorted', unitSource: 'none' });
});

test('classify ignores an override or card area that names no existing unit', () => {
  const files = ['apps/web/src/login/form.ts'];
  assert.deepEqual(classify(summary(files), { area: 'ghost' }, units, { s1: 'gone' }), { unitId: 'auth', unitSource: 'files' });
});

test('classify scores edited files 3 and mentioned paths 1, with a minimum of 3', () => {
  assert.equal(classify(summary([], ['packages/core/a.ts', 'packages/core/b.ts']), null, units, {}).unitSource, 'none', 'two mentions = 2 < 3');
  assert.equal(classify(summary([], ['packages/core/a.ts', 'packages/core/b.ts', 'packages/core/c.ts']), null, units, {}).unitId, 'payments', 'three mentions = 3');
  const mixed = classify(summary(['apps/web/src/login/a.ts'], ['packages/core/1', 'packages/core/2']), null, units, {});
  assert.equal(mixed.unitId, 'auth', 'one edit (3) beats two mentions (2)');
});

test('classify credits only the most specific unit for each file', () => {
  const nested = [{ id: 'core', name: 'Core', paths: ['packages/core'] }, { id: 'authcore', name: 'Auth core', paths: ['packages/core/auth'] }, units[2]];
  assert.equal(classify(summary(['packages/core/auth/x.ts']), null, nested, {}).unitId, 'authcore');
  assert.equal(classify(summary(['packages/core/other.ts']), null, nested, {}).unitId, 'core');
});

test('classify makes absolute paths relative to root or cwd and ignores paths outside both', () => {
  const abs = ['C:\\Dev\\Proj\\apps\\web\\src\\login\\form.ts'];
  assert.equal(classify(summary(abs), null, units, {}, { root: 'c:/dev/proj' }).unitId, 'auth');
  assert.equal(classify(summary(['/work/tree/apps/web/src/login/a.ts'], [], { cwd: '/work/tree' }), null, units, {}, { root: '/proj' }).unitId, 'auth');
  assert.equal(classify(summary(['/elsewhere/apps/web/src/login/a.ts']), null, units, {}, { root: '/proj' }).unitSource, 'none');
});

test('setOverride persists per project, readOverrides returns it, null clears it', () => {
  const smDir = tmp();
  try {
    assert.deepEqual(readOverrides(smDir, 'p-abc123'), {});
    setOverride(smDir, 'p-abc123', 's1', 'auth');
    setOverride(smDir, 'p-abc123', 's2', 'payments');
    assert.deepEqual(readOverrides(smDir, 'p-abc123'), { s1: 'auth', s2: 'payments' });
    setOverride(smDir, 'p-abc123', 's1', null);
    assert.deepEqual(readOverrides(smDir, 'p-abc123'), { s2: 'payments' });
    assert.throws(() => setOverride(smDir, '../escape', 's1', 'auth'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('seedUnits slugifies folder ids so dot and @ folders keep a nucleus file', async () => {
  const { readNucleus, writeNucleus } = await import('../server/brain/nucleus.mjs');
  const root = tmp();
  const smDir = tmp();
  try {
    const gitLog = ['.github/workflows/ci.yml', '.github/workflows/ci.yml', 'src/@types/a.d.ts', 'src_x/@types/b.d.ts'];
    const units = seedUnits(root, { gitLog });
    const byName = Object.fromEntries(units.map((u) => [u.name, u]));
    assert.equal(byName['.github/workflows'].id, 'github-workflows');
    assert.deepEqual(byName['.github/workflows'].paths, ['.github/workflows']);
    assert.equal(byName['src/@types'].id, 'src-types');
    assert.equal(byName['src_x/@types'].id, 'src-x-types');
    const ids = units.map((u) => u.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    const nucleus = { state: 'ci runs on push', decided: [], todo: ['cache deps'], recent: [] };
    writeNucleus(smDir, 'proj-abc123', 'github-workflows', nucleus);
    assert.equal(readNucleus(smDir, 'proj-abc123', 'github-workflows').state, 'ci runs on push');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('seedUnits de-duplicates slugs and slugifies OpenSpec folder ids too', () => {
  const root = tmp();
  try {
    spec(root, 'Billing_v2', 'Lives in `apps/billing/src`.\n');
    spec(root, 'billing-v2', 'Twin.\n');
    const units = seedUnits(root, { gitLog: [] });
    assert.deepEqual(units.map((u) => u.id), ['billing-v2', 'billing-v2-2', 'unsorted']);
    assert.equal(units[0].name, 'Billing_v2');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
