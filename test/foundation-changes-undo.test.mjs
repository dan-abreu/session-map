// B3-T20 (fd14): what the session-map itself wrote through applyOp shows in Changes, with Undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachChanges, changeDetailOf, changesOf } from '../server/changes-state.mjs';
import { applyOp, undoOp } from '../server/foundation/care.mjs';
import { normalizePath } from '../server/paths.mjs';

const NOW = new Date('2026-10-09T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const INTERNALS = Symbol.for('session-map.internals');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// A token shaped like a real key, built in pieces so no scanner mistakes the test for a leak.
const TOKEN = ['sk', 'ant', 'api03', 'Zq8Xw2Lm4Np6Rt0Yv'].join('-');

function setup(files) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-undo-')));
  const root = join(base, 'shop');
  const smDir = join(base, 'sm');
  mkdirSync(smDir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  const project = { id: 'shop', root };
  const apply = (op, opts = {}) => applyOp(project, op, { smDir, mode: 'auto', now: () => NOW.getTime() - 5 * MIN, ...opts });
  const attach = async () => {
    const built = [{ project: { ...project, conversations: [] }, key: normalizePath(root), ownersOf: (paths) => paths.map((p) => (p.startsWith('docs/') ? 'docs' : null)), commits: [] }];
    const store = await attachChanges({ dir: join(base, 'claude'), smDir, now: NOW, windowMs: 30 * DAY, liveById: new Map() }, built, []);
    return { state: { [INTERNALS]: { changes: store } }, project: built[0].project };
  };
  return { base, root, smDir, project, apply, attach, done: () => rmSync(base, { recursive: true, force: true }) };
}

const FIX = { id: 'op:fix-1', kind: 'doc-fix', files: [{ path: 'docs/a.md', after: 'one\nTWO\nthree\nfour\n' }, { path: 'docs/new.md', after: 'fresh\n' }] };

test('an applied operation becomes a Changes row of the session-map with the lines it changed', async () => {
  const t = setup({ 'docs/a.md': 'one\ntwo\nthree\n' });
  try {
    assert.equal(t.apply(FIX).status, 'applied');
    const { state } = await t.attach();
    const row = changesOf(state, 'shop').find((r) => r.id === 'op:fix-1');
    assert.ok(row, 'the operation has a row');
    assert.deepEqual(
      [row.origin, row.opId, row.mode, row.state, row.sessionId, row.title, row.agent, row.undoable, row.undone],
      ['session-map', 'op:fix-1', 'auto', 'pending', null, null, null, true, false],
    );
    assert.deepEqual([...row.files].sort(), ['docs/a.md', 'docs/new.md']);
    assert.equal(row.ts, new Date(NOW.getTime() - 5 * MIN).toISOString());
    assert.deepEqual([row.kind, row.added, row.removed, row.partId], ['edit', 3, 1, 'docs']);
    assert.ok(!changesOf(state, 'shop').some((r) => r.id.startsWith('wt:')), 'the folder rows of the same change are not listed twice');
  } finally { t.done(); }
});

test('undoable turns false once the operation is undone, and when a file moved on', async () => {
  const t = setup({ 'docs/a.md': 'one\ntwo\nthree\n' });
  try {
    t.apply(FIX);
    t.apply({ id: 'op:fix-2', kind: 'doc-fix', files: [{ path: 'docs/b.md', after: 'b\n' }] });
    assert.equal(undoOp(t.project, 'op:fix-2', { smDir: t.smDir, confirm: true, now: () => NOW.getTime() - MIN }).ok, true);
    writeFileSync(join(t.root, 'docs', 'a.md'), 'edited by hand\n');
    const { state } = await t.attach();
    const rows = Object.fromEntries(changesOf(state, 'shop').filter((r) => r.origin === 'session-map').map((r) => [r.opId, r]));
    assert.deepEqual([rows['op:fix-2'].undone, rows['op:fix-2'].undoable], [true, false]);
    assert.deepEqual([rows['op:fix-1'].undone, rows['op:fix-1'].undoable], [false, false], 'the file changed after the operation');
  } finally { t.done(); }
});

test('the detail of op:<id> shows the Undo record against the file now, secrets masked', async () => {
  const t = setup({ 'docs/a.md': 'one\ntwo\nthree\n' });
  try {
    t.apply({ id: 'op:fix-1', kind: 'doc-fix', files: [{ path: 'docs/a.md', after: `one\nTWO\nthree\nkey ${TOKEN}\n` }, { path: 'docs/new.md', after: 'fresh\n' }] });
    const { state } = await t.attach();
    const d = await changeDetailOf(state, 'shop', 'op:fix-1');
    const a = d.hunks.filter((h) => h.path === 'docs/a.md').flatMap((h) => h.lines);
    assert.deepEqual(a.slice(0, 4), [' one', '-two', '+TWO', ' three']);
    assert.match(a[4], /^\+key /);
    assert.ok(!JSON.stringify(d).includes(TOKEN), 'the secret never leaves');
    assert.deepEqual(d.hunks.filter((h) => h.path === 'docs/new.md').flatMap((h) => h.lines), ['+fresh']);
    assert.deepEqual([d.undoable, d.undone], [true, false]);
    assert.equal(await changeDetailOf(state, 'shop', 'op:nope'), null);
  } finally { t.done(); }
});

test('a deletion shows as a removal row and its detail holds the removed lines', async () => {
  const t = setup({ 'docs/a.md': 'one\ntwo\n', 'docs/old.md': 'gone\nsoon\n' });
  try {
    assert.equal(t.apply({ id: 'op:rm', kind: 'delete', files: [{ path: 'docs/old.md', after: null }] }, { confirm: true }).status, 'applied');
    const { state } = await t.attach();
    const row = changesOf(state, 'shop').find((r) => r.opId === 'op:rm');
    assert.deepEqual([row.kind, row.added, row.removed, row.path], ['delete', 0, 2, 'docs/old.md']);
    const d = await changeDetailOf(state, 'shop', 'op:rm');
    assert.deepEqual(d.hunks.flatMap((h) => h.lines), ['-gone', '-soon']);
  } finally { t.done(); }
});

test('rows without operations stay as they were, and operations do not light the boxes', async () => {
  const t = setup({ 'docs/a.md': 'one\ntwo\nthree\n', 'src/x.js': 'x\n' });
  try {
    writeFileSync(join(t.root, 'src', 'x.js'), 'x\ny\n');
    const before = await t.attach();
    const plain = changesOf(before.state, 'shop');
    assert.ok(plain.length && plain.every((r) => r.origin === undefined), 'old rows carry no origin');
    t.apply(FIX);
    t.apply({ id: 'op:ancient', kind: 'doc-fix', files: [{ path: 'docs/c.md', after: 'c\n' }] }, { now: () => NOW.getTime() - 40 * DAY });
    const after = await t.attach();
    const rows = changesOf(after.state, 'shop');
    assert.deepEqual(rows.filter((r) => r.origin === undefined && r.path === 'src/x.js'), plain.filter((r) => r.path === 'src/x.js'), 'an earlier row is unchanged');
    assert.ok(!rows.some((r) => r.opId === 'op:ancient'), 'outside the window it does not show');
    assert.deepEqual(after.project.fresh, before.project.fresh);
    assert.deepEqual(rows.map((r) => r.ts), rows.map((r) => r.ts).sort().reverse(), 'newest first');
  } finally { t.done(); }
});
