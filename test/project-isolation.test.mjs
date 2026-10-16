import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { applyRequestStatus, requestStatusOp } from '../server/arch/requestops.mjs';
import { applyOp, writeCare } from '../server/foundation/care.mjs';
import { refreshFoundation, sweepProjects } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// Each project is its own world. session-map reads a project's folder and writes in two places only: its own folder of state,
// under the project's id, and the project's own repository through one guarded door (the care mode). Nothing a round, a review or
// an operation does for one project reaches another project, and a round does not write in the repository it reads at all.

// Every file of a folder with a hash of its content (the .git folder aside): a change anywhere shows.
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out.set(relative(root, path).split('\\').join('/'), createHash('sha1').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(root);
  return out;
}
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const filesUnder = (dir) => [...snapshot(dir).keys()];

test('a round for one project writes nothing in any repository, and only under that project\'s id in the state folder', async () => {
  const a = copyFixtureRepo('acme-shop');
  const b = copyFixtureRepo('acme-lib');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-isolation-'));
  try {
    const beforeA = snapshot(a);
    const beforeB = snapshot(b);
    const out = await refreshFoundation({ id: 'shop-aaaaaa', name: 'shop', root: a }, smDir, { now: () => 1_000_000 });
    assert.equal(out.ran, true);
    assert.ok(same(snapshot(a), beforeA), 'the repository the round read is as it was');
    assert.ok(same(snapshot(b), beforeB), 'the other repository was not touched');
    const written = filesUnder(smDir);
    assert.ok(written.length > 5, 'the round wrote its files');
    assert.ok(written.every((p) => p.startsWith('brain/shop-aaaaaa/')), `everything is under the project's own folder: ${written.filter((p) => !p.startsWith('brain/shop-aaaaaa/')).join(', ')}`);
    // The second project has its own folder and its own files; the first one's are not touched by it.
    const firstFiles = new Map([...snapshot(join(smDir, 'brain', 'shop-aaaaaa'))].filter(([k]) => !/census-log|generatedAt/.test(k)));
    await refreshFoundation({ id: 'lib-bbbbbb', name: 'lib', root: b }, smDir, { now: () => 2_000_000 });
    assert.ok(filesUnder(smDir).some((p) => p.startsWith('brain/lib-bbbbbb/')), 'the second project has its own folder');
    const afterFirst = snapshot(join(smDir, 'brain', 'shop-aaaaaa'));
    for (const [k, v] of firstFiles) assert.equal(afterFirst.get(k), v, `${k} of the first project is as the second round found it`);
    assert.ok(same(snapshot(a), beforeA) && same(snapshot(b), beforeB), 'and still no repository changed');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
    removeFixtureRepo(a);
    removeFixtureRepo(b);
  }
});

const REGISTRY = [
  '# Ideas', '', '## Where in the code', '', '- `docs/architecture/ideas.md`', '', "## What's missing", '',
  '- [ ] A flow you draw `id01`', '  - Asked: 2026-10-09 16:20 — "x"', '  - Where it went: `al01`.', '  - Status: accepted.', '',
].join('\n');
const ALPHA = ['# Alpha', '', '## Where in the code', '', '- `server/alpha/`', '', "## What's missing", '', '- [ ] Open work `al01`', ''].join('\n');
const FILES = { 'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Ideas](ideas.md)\n', 'alpha.md': ALPHA, 'ideas.md': REGISTRY };

function twoProjects() {
  const base = mkdtempSync(join(tmpdir(), 'sm-isolation-two-'));
  const make = (name) => {
    const root = join(base, name);
    mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
    const old = new Date(Date.now() - 60_000);
    for (const [file, text] of Object.entries(FILES)) { writeFileSync(join(root, 'docs', 'architecture', file), text); utimesSync(join(root, 'docs', 'architecture', file), old, old); }
    return root;
  };
  return { base, a: make('a'), b: make('b'), arch: () => parseArch('docs/architecture', FILES, 'worktree') };
}

test('a decision on a request of one project changes that project\'s registry and nothing of another with the very same codes', () => {
  const { base, a, b, arch } = twoProjects();
  const smDir = mkdtempSync(join(tmpdir(), 'sm-isolation-sm-'));
  try {
    const beforeA = snapshot(a);
    const beforeB = snapshot(b);
    writeCare(smDir, 'a-111111', 'auto');
    writeCare(smDir, 'b-222222', 'auto');
    const done = applyRequestStatus({ root: a, arch: arch(), code: 'id01', to: 'later', reason: 'wait', care: { id: 'a-111111', smDir } });
    assert.equal(done.changed, true, JSON.stringify(done));
    assert.ok(!same(snapshot(a), beforeA), 'the registry of the project it was asked for changed');
    assert.ok(same(snapshot(b), beforeB), 'the other project, with the same request code, did not');
    assert.deepEqual(done.files, ['docs/architecture/ideas.md']);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a registry the map points at outside the project folder is never read or written, and the one door refuses a path that climbs out', () => {
  const { base, a, b, arch } = twoProjects();
  const smDir = mkdtempSync(join(tmpdir(), 'sm-isolation-door-'));
  try {
    const climbing = arch();
    climbing.parts.find((p) => p.id === 'ideas').file = '../b/docs/architecture/ideas.md';
    assert.deepEqual(requestStatusOp({ root: a, arch: climbing, code: 'id01', to: 'later', reason: 'x' }), { ok: false, error: 'bad-path' });
    const absolute = arch();
    absolute.parts.find((p) => p.id === 'ideas').file = resolve(b, 'docs', 'architecture', 'ideas.md');
    assert.deepEqual(requestStatusOp({ root: a, arch: absolute, code: 'id01', to: 'later', reason: 'x' }), { ok: false, error: 'bad-path' });
    // Even a hand-made operation, through the one door, cannot leave the folder it was given.
    const beforeB = snapshot(b);
    writeCare(smDir, 'a-111111', 'auto');
    for (const path of ['../b/docs/architecture/ideas.md', resolve(b, 'docs', 'architecture', 'ideas.md'), 'docs/../../b/docs/architecture/ideas.md']) {
      const out = applyOp({ id: 'a-111111', root: a }, { kind: 'x', files: [{ path, after: 'overwritten\n' }] }, { smDir, accept: true });
      assert.equal(out.ok, false, path);
      assert.match(out.error ?? out.status, /outside-root|bad-path/, path);
    }
    assert.ok(same(snapshot(b), beforeB), 'nothing of the other project was written');
    assert.ok(statSync(join(b, 'docs', 'architecture', 'ideas.md')).isFile());
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

// "Tudo em dia?" looks at one project at a time. What it says about a project is the same whether the others exist or not, and it cites
// only that project's own files.
test('the lines of a project are the same with another project around, and cite only its own files', async () => {
  const a = copyFixtureRepo('acme-shop');
  const b = copyFixtureRepo('acme-delivery');
  const alone = mkdtempSync(join(tmpdir(), 'sm-isolation-alone-'));
  const together = mkdtempSync(join(tmpdir(), 'sm-isolation-together-'));
  const lines = (smDir, id) => readFd(smDir, id, 'uptodate.json', null).lines.map((l) => [l.id, l.state, l.reason ?? null, JSON.stringify(l.detail ?? null)]);
  const cited = (smDir, id) => {
    const out = new Set();
    const walk = (node) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') { if (typeof node.file === 'string') out.add(node.file); Object.values(node).forEach(walk); }
    };
    walk(readFd(smDir, id, 'uptodate.json', null).lines);
    return out;
  };
  try {
    const project = (id, root) => ({ id, name: id, root });
    await refreshFoundation(project('shop-aaaaaa', a), alone, { now: () => 1_000_000 });
    // The other project is read first, and again after, in the same state folder.
    await refreshFoundation(project('delivery-bbbbbb', b), together, { now: () => 1_000_000 });
    await refreshFoundation(project('shop-aaaaaa', a), together, { now: () => 2_000_000 });
    await refreshFoundation(project('delivery-bbbbbb', b), together, { now: () => 3_000_000 });
    assert.deepEqual(lines(together, 'shop-aaaaaa'), lines(alone, 'shop-aaaaaa'), 'what is said of one project does not depend on the other');
    for (const [id, root] of [['shop-aaaaaa', a], ['delivery-bbbbbb', b]]) {
      const stray = [...cited(together, id)].filter((file) => file && file !== '.git' && !statExists(join(root, file)));
      assert.deepEqual(stray, [], `${id} cites only files of its own folder`);
    }
    assert.ok(![...cited(together, 'shop-aaaaaa')].some((file) => /delivery|backend\/app/.test(file) && !statExists(join(a, file))), 'nothing of the other project shows in this one');
  } finally {
    rmSync(alone, { recursive: true, force: true });
    rmSync(together, { recursive: true, force: true });
    removeFixtureRepo(a);
    removeFixtureRepo(b);
  }
});

const statExists = (path) => { try { statSync(path); return true; } catch { return false; } };

test('the sweep reads each project in a try of its own: one that fails does not stop the next', async () => {
  const seen = [];
  const refresh = async (project) => {
    seen.push(project.id);
    if (project.id === 'broken-222222') throw new Error('a folder that is gone');
    return { ran: true, steps: [] };
  };
  const done = await sweepProjects([{ id: 'first-111111' }, { id: 'broken-222222' }, { id: 'third-333333' }], '/state', refresh);
  assert.deepEqual(seen, ['first-111111', 'broken-222222', 'third-333333'], 'the project after the broken one is still read');
  assert.deepEqual(done.map((d) => [d.id, d.error ?? 'ok']), [['first-111111', 'ok'], ['broken-222222', 'a folder that is gone'], ['third-333333', 'ok']]);
  assert.deepEqual(await sweepProjects([], '/state', refresh), []);
});
