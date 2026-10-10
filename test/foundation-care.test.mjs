import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyOp, isGitName, listProposals, listUndo, pruneUndo, readCare, resolveProposal, undoOp, writeCare,
} from '../server/foundation/care.mjs';
import { fdDir, fdPath, readFd } from '../server/foundation/store.mjs';

const ID = 'acme-shop-8324f1';
const CRLF_BOM = '\uFEFF# Orders\r\n\r\nGET /orders\r\n';
const ORIGINAL = {
  'README.md': '# acme-shop\n\nA shop by Ana.\n',
  'docs/api.md': CRLF_BOM,
  'docs/old.md': 'old notes\n',
  'src/index.js': 'export const x = 1;\n',
};

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

// One committed repository made once; every test works on its own copy (git is slow to start on some machines).
let template = null;
function makeTemplate() {
  const root = mkdtempSync(join(tmpdir(), 'sm-care-tpl-'));
  for (const [path, text] of Object.entries(ORIGINAL)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=Ana', '-c', 'user.email=ana@acme.example', 'commit', '-q', '-m', 'init');
  return root;
}

function makeRepo() {
  template ??= makeTemplate();
  const root = mkdtempSync(join(tmpdir(), 'sm-care-repo-'));
  cpSync(template, root, { recursive: true });
  const smDir = mkdtempSync(join(tmpdir(), 'sm-care-sm-'));
  return { root, smDir, project: { id: ID, root } };
}

after(() => { if (template) cleanup(template); });

function cleanup(...dirs) {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

// Every path and every byte under the root (minus .git), folders included: "byte-identical" means this hash is equal.
function treeHash(root) {
  const hash = createHash('sha256');
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir, { withFileTypes: true }).map((d) => d).sort((a, b) => a.name.localeCompare(b.name))) {
      if (name.name === '.git') continue;
      const relPath = rel ? `${rel}/${name.name}` : name.name;
      const abs = join(dir, name.name);
      if (name.isDirectory()) { hash.update(`d:${relPath}\0`); walk(abs, relPath); }
      else if (name.isSymbolicLink()) hash.update(`l:${relPath}\0`);
      else { hash.update(`f:${relPath}\0`); hash.update(readFileSync(abs)); }
    }
  };
  walk(root, '');
  return hash.digest('hex');
}

const gitClean = (root) => git(root, 'status', '--porcelain', '--untracked-files=all') === '';
const read = (root, path) => readFileSync(join(root, path), 'utf8');

const docOp = (id = 'op:doc-1') => ({
  id, kind: 'doc-update', sensitive: false, findingId: 'f:3b1',
  files: [
    { path: 'docs/api.md', after: '# Orders\r\n\r\nGET /orders/:id\r\n' },
    { path: 'docs/guides/new.md', after: '# New guide\n' },
  ],
  why: { msg: 'watch.citesMissing.todo' },
});

const deleteOp = (id = 'op:del-1') => ({ id, kind: 'delete', files: [{ path: 'docs/old.md', after: null }], why: { msg: 'x' } });

test('readCare starts as never asked; writeCare survives a fresh read and keeps the first askedAt', () => {
  const { root, smDir } = makeRepo();
  try {
    assert.deepEqual(readCare(smDir, ID), { mode: null, askedAt: null });
    const first = writeCare(smDir, ID, 'suggest', { now: () => Date.parse('2026-10-10T10:00:00Z') });
    assert.equal(first.mode, 'suggest');
    assert.equal(first.askedAt, '2026-10-10T10:00:00.000Z');
    // A restart is a fresh read of the file.
    assert.deepEqual(readCare(smDir, ID), { mode: 'suggest', askedAt: '2026-10-10T10:00:00.000Z' });
    writeCare(smDir, ID, 'auto', { now: () => Date.parse('2026-10-11T09:00:00Z') });
    assert.deepEqual(readCare(smDir, ID), { mode: 'auto', askedAt: '2026-10-10T10:00:00.000Z' }, 'askedAt is written once');
    const onDisk = readFd(smDir, ID, 'care.json', null);
    assert.equal(onDisk.version, 1);
    assert.ok(onDisk.generatedAt);
    assert.throws(() => writeCare(smDir, ID, 'yolo'), /invalid care mode/);
    assert.throws(() => writeCare(smDir, ID, null), /invalid care mode/);
  } finally { cleanup(root, smDir); }
});

test('suggest leaves the repository byte-identical until the proposal is accepted', () => {
  const { root, smDir, project } = makeRepo();
  try {
    writeCare(smDir, ID, 'suggest');
    const before = treeHash(root);
    const res = applyOp(project, docOp(), { smDir });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'proposed');
    assert.equal(res.opId, 'op:doc-1');
    assert.deepEqual(res.files, ['docs/api.md', 'docs/guides/new.md']);
    assert.equal(treeHash(root), before, 'tree byte-identical');
    assert.ok(gitClean(root), 'git status clean');
    assert.deepEqual(listUndo(smDir, ID), [], 'nothing applied, nothing to undo');

    const [proposal] = listProposals(smDir, ID);
    assert.equal(proposal.state, 'open');
    assert.equal(proposal.mode, 'suggest');
    assert.equal(proposal.op.id, 'op:doc-1');
    assert.deepEqual(proposal.diff, [
      { path: 'docs/api.md', before: CRLF_BOM, after: '# Orders\r\n\r\nGET /orders/:id\r\n' },
      { path: 'docs/guides/new.md', before: null, after: '# New guide\n' },
    ]);

    const accepted = resolveProposal(project, 'op:doc-1', 'accept', { smDir });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, 'applied');
    assert.equal(read(root, 'docs/api.md'), '# Orders\r\n\r\nGET /orders/:id\r\n');
    assert.equal(read(root, 'docs/guides/new.md'), '# New guide\n');
    assert.equal(listProposals(smDir, ID)[0].state, 'accepted');
    assert.equal(listUndo(smDir, ID).length, 1);
  } finally { cleanup(root, smDir); }
});

test('accepting a proposal whose file changed since it was made is refused and writes nothing', () => {
  const { root, smDir, project } = makeRepo();
  try {
    applyOp(project, docOp(), { smDir, mode: 'suggest' });
    writeFileSync(join(root, 'docs/api.md'), 'Ana edited this by hand\n');
    const before = treeHash(root);
    const res = resolveProposal(project, 'op:doc-1', 'accept', { smDir, mode: 'suggest' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'refused');
    assert.equal(res.error, 'changed-since');
    assert.equal(treeHash(root), before);
    assert.equal(listProposals(smDir, ID)[0].state, 'open');
  } finally { cleanup(root, smDir); }
});

test('a proposal can be dismissed or marked never; unknown or forged ids are not found', () => {
  const { root, smDir, project } = makeRepo();
  try {
    applyOp(project, docOp('op:a'), { smDir, mode: 'suggest' });
    applyOp(project, docOp('op:b'), { smDir, mode: 'suggest' });
    assert.equal(resolveProposal(project, 'op:a', 'dismiss', { smDir }).ok, true);
    assert.equal(resolveProposal(project, 'b', 'never', { smDir }).ok, true, 'the id without the op: prefix names the same operation');
    const states = Object.fromEntries(listProposals(smDir, ID).map((p) => [p.op.id, p.state]));
    assert.deepEqual(states, { 'op:a': 'dismissed', 'op:b': 'never' });
    assert.deepEqual(listProposals(smDir, ID, { state: 'open' }), []);
    assert.deepEqual(resolveProposal(project, 'op:zzz', 'accept', { smDir }), { ok: false, error: 'not-found' });
    assert.deepEqual(resolveProposal(project, 'op:../../care', 'accept', { smDir }), { ok: false, error: 'not-found' });
    assert.deepEqual(resolveProposal(project, 'op:a', 'explode', { smDir }), { ok: false, error: 'bad-action' });
    assert.ok(gitClean(root));
  } finally { cleanup(root, smDir); }
});

test('automatic writes, records undo first, and undo gives every byte back', () => {
  const { root, smDir, project } = makeRepo();
  try {
    writeCare(smDir, ID, 'auto');
    const before = treeHash(root);
    const res = applyOp(project, docOp(), { smDir, now: () => Date.parse('2026-10-10T12:00:00Z') });
    assert.deepEqual(res, { ok: true, status: 'applied', opId: 'op:doc-1', files: ['docs/api.md', 'docs/guides/new.md'] });
    assert.equal(read(root, 'docs/guides/new.md'), '# New guide\n');
    assert.deepEqual(listProposals(smDir, ID), [], 'automatic does not leave proposals');

    const [record] = listUndo(smDir, ID, { root });
    assert.equal(record.id, 'op:doc-1');
    assert.equal(record.at, '2026-10-10T12:00:00.000Z');
    assert.equal(record.mode, 'auto');
    assert.equal(record.undone, false);
    assert.equal(record.undoable, true);
    assert.equal(record.files[0].path, 'docs/api.md');
    assert.equal(record.files[0].before, CRLF_BOM);
    assert.match(record.files[0].afterSha, /^[0-9a-f]{16}$/);
    assert.equal(record.files[1].before, null);

    // Undo removes a file the operation created: deleting asks for confirmation, and nothing moves until it is given.
    const asked = undoOp(project, 'op:doc-1', { smDir });
    assert.deepEqual(asked, { ok: false, error: 'needs-confirm' });
    assert.equal(read(root, 'docs/guides/new.md'), '# New guide\n');

    const undone = undoOp(project, 'op:doc-1', { smDir, confirm: true });
    assert.deepEqual(undone, { ok: true, restored: ['docs/api.md', 'docs/guides/new.md'] });
    assert.equal(treeHash(root), before, 'byte-identical again, created folder removed too');
    assert.ok(gitClean(root));
    assert.equal(listUndo(smDir, ID, { root })[0].undone, true);
    assert.equal(listUndo(smDir, ID, { root })[0].undoable, false);
    assert.deepEqual(undoOp(project, 'op:doc-1', { smDir, confirm: true }), { ok: false, error: 'already-undone' });
    assert.deepEqual(undoOp(project, 'op:nope', { smDir }), { ok: false, error: 'not-found' });
    assert.deepEqual(undoOp(project, '../care', { smDir }), { ok: false, error: 'not-found' });
  } finally { cleanup(root, smDir); }
});

test('the same operation is not applied twice while its undo is pending; after undo it can be applied again', () => {
  const { root, smDir, project } = makeRepo();
  try {
    const op = { id: 'op:readme', kind: 'doc-update', files: [{ path: 'README.md', after: '# acme-shop v2\n' }] };
    assert.equal(applyOp(project, op, { smDir, mode: 'auto' }).status, 'applied');
    const again = applyOp(project, op, { smDir, mode: 'auto' });
    assert.deepEqual(again, { ok: false, status: 'refused', opId: 'op:readme', files: ['README.md'], error: 'already-applied' });
    assert.equal(undoOp(project, 'op:readme', { smDir }).ok, true, 'restoring an existing file needs no confirmation');
    assert.equal(read(root, 'README.md'), ORIGINAL['README.md']);
    assert.equal(applyOp(project, op, { smDir, mode: 'auto' }).status, 'applied');
    assert.equal(listUndo(smDir, ID)[0].files[0].before, ORIGINAL['README.md']);
  } finally { cleanup(root, smDir); }
});

test('an operation without id gets one, safe for a file name', () => {
  const { root, smDir, project } = makeRepo();
  try {
    const res = applyOp(project, { kind: 'doc-update', files: [{ path: 'README.md', after: 'x\n' }] }, { smDir, mode: 'auto' });
    assert.equal(res.status, 'applied');
    assert.match(res.opId, /^op:[a-z0-9][a-z0-9._-]*$/);
    assert.equal(listUndo(smDir, ID)[0].id, res.opId);
  } finally { cleanup(root, smDir); }
});

test('look only writes nothing, not even with confirm and accept', () => {
  const { root, smDir, project } = makeRepo();
  try {
    writeCare(smDir, ID, 'look');
    const before = treeHash(root);
    for (const op of [docOp(), deleteOp()]) {
      const res = applyOp(project, op, { smDir, confirm: true, accept: true });
      assert.equal(res.ok, false);
      assert.equal(res.status, 'look-only');
    }
    assert.equal(treeHash(root), before);
    assert.deepEqual(listProposals(smDir, ID), []);
    assert.deepEqual(listUndo(smDir, ID), []);
  } finally { cleanup(root, smDir); }
});

test('a care mode never asked (null) behaves as look only, from the file or given in memory', () => {
  const { root, smDir, project } = makeRepo();
  try {
    const before = treeHash(root);
    assert.equal(applyOp(project, docOp(), { smDir, accept: true }).status, 'look-only', 'no care.json yet');
    assert.equal(applyOp(project, docOp(), { smDir, mode: null, accept: true }).status, 'look-only');
    assert.equal(applyOp(project, docOp(), { smDir, mode: 'bogus', accept: true }).status, 'look-only');
    assert.equal(treeHash(root), before);
    assert.equal(existsSync(fdPath(smDir, ID, 'care.json')), false, 'a mode given in memory is not written');
    // A mode given in memory wins over the file without touching it (the B7 proof runs this way).
    writeCare(smDir, ID, 'look');
    assert.equal(applyOp(project, docOp(), { smDir, mode: 'suggest' }).status, 'proposed');
    assert.equal(readCare(smDir, ID).mode, 'look');
  } finally { cleanup(root, smDir); }
});

test('deleting asks for confirmation in all three modes; with confirm it deletes in auto and in suggest + accept', () => {
  const { root, smDir, project } = makeRepo();
  try {
    const before = treeHash(root);
    for (const mode of ['auto', 'suggest', 'look']) {
      for (const op of [deleteOp(), { ...docOp(), kind: 'delete' }, { ...docOp(), sensitive: true }, { ...docOp(), kind: 'publish' }]) {
        const res = applyOp(project, op, { smDir, mode, accept: true });
        assert.equal(res.status, 'needs-confirm', `${mode} ${op.kind} ${op.sensitive}`);
        assert.equal(res.ok, false);
      }
    }
    assert.equal(treeHash(root), before);
    assert.deepEqual(listProposals(smDir, ID), []);

    assert.equal(applyOp(project, deleteOp('op:del-auto'), { smDir, mode: 'auto', confirm: true }).status, 'applied');
    assert.equal(existsSync(join(root, 'docs/old.md')), false);
    assert.equal(undoOp(project, 'op:del-auto', { smDir }).ok, true, 'bringing a file back is not a delete');
    assert.equal(read(root, 'docs/old.md'), ORIGINAL['docs/old.md']);

    assert.equal(applyOp(project, deleteOp('op:del-sug'), { smDir, mode: 'suggest', confirm: true }).status, 'proposed');
    assert.equal(existsSync(join(root, 'docs/old.md')), true);
    assert.equal(resolveProposal(project, 'op:del-sug', 'accept', { smDir, mode: 'suggest' }).status, 'needs-confirm');
    assert.equal(existsSync(join(root, 'docs/old.md')), true);
    assert.equal(resolveProposal(project, 'op:del-sug', 'accept', { smDir, mode: 'suggest', confirm: true }).status, 'applied');
    assert.equal(existsSync(join(root, 'docs/old.md')), false);
    assert.equal(applyOp(project, deleteOp('op:del-look'), { smDir, mode: 'look', confirm: true }).status, 'look-only');
  } finally { cleanup(root, smDir); }
});

test('paths that leave the root, reach .git or a secret, or carry too much are refused before anything is written', () => {
  const { root, smDir, project } = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), 'sm-care-out-'));
  try {
    const before = treeHash(root);
    const cases = [
      ['../x.md', 'outside-root'],
      ['docs/../../x.md', 'outside-root'],
      [resolve(outside, 'x.md'), 'outside-root'],
      ['C:/Windows/x.md', 'outside-root'],
      ['/etc/x.md', 'outside-root'],
      ['.env', 'secret-file'],
      ['config/.env.local', 'secret-file'],
      ['.git/config', 'bad-path'],
      ['docs/a:stream.md', 'bad-path'],
      ['', 'bad-path'],
    ];
    for (const [path, error] of cases) {
      const res = applyOp(project, { id: 'op:evil', kind: 'doc-update', files: [{ path: 'README.md', after: 'ok\n' }, { path, after: 'pwned\n' }] }, { smDir, mode: 'auto', accept: true, confirm: true });
      assert.equal(res.ok, false, path);
      assert.equal(res.status, 'refused', path);
      assert.equal(res.error, error, path);
    }
    const huge = 'x'.repeat(1024 * 1024 + 1);
    assert.equal(applyOp(project, { id: 'op:big', kind: 'doc-update', files: [{ path: 'README.md', after: huge }] }, { smDir, mode: 'auto' }).error, 'too-big');
    assert.equal(applyOp(project, { id: 'op:dup', kind: 'doc-update', files: [{ path: 'README.md', after: 'a' }, { path: './README.md', after: 'b' }] }, { smDir, mode: 'auto' }).error, 'bad-path');
    for (const bad of [
      { id: 'op:../../care', kind: 'doc-update', files: [{ path: 'README.md', after: 'x' }] },
      { id: 'op:ok', kind: 'doc-update', files: [] },
      { id: 'op:ok', kind: 'doc-update', files: [{ path: 'README.md' }] },
      { id: 'op:ok', kind: 'doc-update', files: [{ path: 'README.md', after: 42 }] },
      { id: 'op:ok', kind: 42, files: [{ path: 'README.md', after: 'x' }] },
      null,
    ]) {
      assert.equal(applyOp(project, bad, { smDir, mode: 'auto' }).error, 'bad-op', JSON.stringify(bad));
    }
    assert.equal(treeHash(root), before);
    assert.deepEqual(listUndo(smDir, ID), []);
    assert.deepEqual(readdirSync(outside), [], 'nothing reached the outside folder');
  } finally { cleanup(root, smDir, outside); }
});

test('a link inside the root that points outside is refused, for existing and new files alike', (t) => {
  const { root, smDir, project } = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), 'sm-care-out-'));
  try {
    writeFileSync(join(outside, 'target.md'), 'outside\n');
    try {
      symlinkSync(outside, join(root, 'escape'), 'junction');
    } catch {
      t.skip('this machine cannot create links');
      return;
    }
    for (const path of ['escape/target.md', 'escape/new.md', 'escape/deep/new.md']) {
      const res = applyOp(project, { id: 'op:link', kind: 'doc-update', files: [{ path, after: 'pwned\n' }] }, { smDir, mode: 'auto' });
      assert.equal(res.error, 'outside-root', path);
    }
    assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), 'outside\n');
    assert.deepEqual(readdirSync(outside), ['target.md']);
  } finally { cleanup(root, smDir, outside); }
});

test('a file that is not text cannot be rewritten, since undo could not give its bytes back', () => {
  const { root, smDir, project } = makeRepo();
  try {
    writeFileSync(join(root, 'logo.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x81, 0x41]));
    const res = applyOp(project, { id: 'op:bin', kind: 'doc-update', files: [{ path: 'logo.bin', after: 'x' }] }, { smDir, mode: 'auto' });
    assert.equal(res.error, 'not-text');
    assert.deepEqual([...readFileSync(join(root, 'logo.bin'))], [0xff, 0xfe, 0x00, 0x81, 0x41]);
  } finally { cleanup(root, smDir); }
});

test('undo refuses with changed-since when the file moved on after the operation, and touches nothing', () => {
  const { root, smDir, project } = makeRepo();
  try {
    applyOp(project, docOp(), { smDir, mode: 'auto' });
    writeFileSync(join(root, 'docs/api.md'), 'Ana kept writing\n');
    const before = treeHash(root);
    assert.equal(listUndo(smDir, ID, { root })[0].undoable, false);
    assert.deepEqual(undoOp(project, 'op:doc-1', { smDir, confirm: true }), { ok: false, error: 'changed-since' });
    assert.equal(treeHash(root), before);
    assert.equal(listUndo(smDir, ID)[0].undone, false);
    // A file the operation deleted that came back also counts as changed.
    applyOp(project, deleteOp(), { smDir, mode: 'auto', confirm: true });
    writeFileSync(join(root, 'docs/old.md'), 'back by hand\n');
    assert.deepEqual(undoOp(project, 'op:del-1', { smDir }), { ok: false, error: 'changed-since' });
    assert.equal(read(root, 'docs/old.md'), 'back by hand\n');
  } finally { cleanup(root, smDir); }
});

test('a failure on the second file puts the first one back: all or nothing', () => {
  const { root, smDir, project } = makeRepo();
  try {
    // "blocker" is a file, so a folder cannot be made under it: the write of the second file fails on every system.
    writeFileSync(join(root, 'blocker'), 'a file, not a folder\n');
    const before = treeHash(root);
    const res = applyOp(project, {
      id: 'op:half', kind: 'doc-update',
      files: [{ path: 'README.md', after: 'changed\n' }, { path: 'docs/fresh/one.md', after: 'one\n' }, { path: 'blocker/x.md', after: 'x\n' }],
    }, { smDir, mode: 'auto' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'refused');
    assert.equal(res.error, 'write-failed');
    assert.equal(read(root, 'README.md'), ORIGINAL['README.md']);
    assert.equal(treeHash(root), before, 'first files back, created folder gone');
    assert.deepEqual(listUndo(smDir, ID), [], 'the undo record of a failed operation is dropped');
  } finally { cleanup(root, smDir); }
});

test('the undo folder keeps the newest 500 records', () => {
  const { root, smDir, project } = makeRepo();
  try {
    for (let i = 0; i < 5; i += 1) {
      applyOp(project, { id: `op:n${i}`, kind: 'doc-update', files: [{ path: `notes/${i}.md`, after: `${i}\n` }] }, { smDir, mode: 'auto', now: () => 1_000_000 + i * 1000 });
    }
    pruneUndo(smDir, ID, 3);
    assert.deepEqual(listUndo(smDir, ID).map((r) => r.id), ['op:n4', 'op:n3', 'op:n2'], 'newest first, the oldest dropped');
    assert.deepEqual(readdirSync(join(fdDir(smDir, ID), 'undo')).sort(), ['n2.json', 'n3.json', 'n4.json']);
  } finally { cleanup(root, smDir); }
});

test('the project root itself must be a real folder', () => {
  const { root, smDir } = makeRepo();
  try {
    const res = applyOp({ id: ID, root: join(root, 'missing') }, docOp(), { smDir, mode: 'auto' });
    assert.equal(res.status, 'refused');
    assert.equal(res.error, 'bad-path');
  } finally { cleanup(root, smDir); }
});

test('a link inside the root that points at .git is refused, for existing and new files alike', (t) => {
  const { root, smDir, project } = makeRepo();
  try {
    try {
      symlinkSync(join(root, '.git'), join(root, 'gl'), 'junction');
    } catch {
      t.skip('this machine cannot create links');
      return;
    }
    const hooks = readdirSync(join(root, '.git', 'hooks')).sort();
    const top = readdirSync(join(root, '.git')).sort();
    for (const path of ['gl/hooks/pre-push', 'gl/newfile', 'gl/config', 'gl/deep/new.md']) {
      for (const mode of ['auto', 'suggest']) {
        const res = applyOp(project, { id: 'op:gitlink', kind: 'doc-update', files: [{ path, after: '#!/bin/sh\necho pwn\n' }] }, { smDir, mode });
        assert.equal(res.status, 'refused', `${mode} ${path}`);
        assert.equal(res.error, 'bad-path', `${mode} ${path}`);
      }
    }
    assert.deepEqual(readdirSync(join(root, '.git', 'hooks')).sort(), hooks);
    assert.deepEqual(readdirSync(join(root, '.git')).sort(), top);
    assert.deepEqual(listProposals(smDir, ID), []);
    assert.deepEqual(listUndo(smDir, ID), []);
  } finally { cleanup(root, smDir); }
});

test('a secret reached by another spelling (trailing dot or space, 8.3 short name) is refused and never read', (t) => {
  const { root, smDir, project } = makeRepo();
  try {
    writeFileSync(join(root, '.env'), 'SECRET=abc\n');
    const spellings = ['.env.', '.env ', 'config/.env.local.', '.env. . '];
    let short = false;
    try { short = realpathSync.native(join(root, 'ENV~1')).endsWith('.env'); } catch { /* 8.3 names are off here */ }
    if (short) spellings.push('ENV~1', 'env~1');
    for (const path of spellings) {
      for (const mode of ['auto', 'suggest']) {
        const res = applyOp(project, { id: 'op:sneak', kind: 'doc-update', files: [{ path, after: 'SECRET=pwned\n' }] }, { smDir, mode });
        assert.equal(res.status, 'refused', `${mode} ${JSON.stringify(path)}`);
        assert.equal(res.error, 'secret-file', `${mode} ${JSON.stringify(path)}`);
      }
    }
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'SECRET=abc\n');
    assert.deepEqual(listProposals(smDir, ID), []);
    assert.deepEqual(listUndo(smDir, ID), []);
    if (!short) t.diagnostic('8.3 short names are off on this volume: the ENV~1 case was not exercised');
  } finally { cleanup(root, smDir); }
});

test('a proposal already dismissed or marked never cannot be accepted later', () => {
  const { root, smDir, project } = makeRepo();
  try {
    applyOp(project, docOp('op:a'), { smDir, mode: 'suggest' });
    applyOp(project, docOp('op:b'), { smDir, mode: 'suggest' });
    resolveProposal(project, 'op:a', 'dismiss', { smDir });
    resolveProposal(project, 'op:b', 'never', { smDir });
    const before = treeHash(root);
    for (const id of ['op:a', 'op:b']) {
      assert.deepEqual(resolveProposal(project, id, 'accept', { smDir, mode: 'suggest' }), { ok: false, error: 'not-open' }, id);
    }
    assert.equal(treeHash(root), before);
    assert.deepEqual(listUndo(smDir, ID), []);
    const states = Object.fromEntries(listProposals(smDir, ID).map((p) => [p.op.id, p.state]));
    assert.deepEqual(states, { 'op:a': 'dismissed', 'op:b': 'never' });
  } finally { cleanup(root, smDir); }
});

test('an ordinary folder whose name merely ends in "git" is written like any other', () => {
  const { root, smDir, project } = makeRepo();
  try {
    for (const [i, dir] of ['_git', '-git', 'agit'].entries()) {
      mkdirSync(join(root, dir));
      const res = applyOp(project, { id: `op:near-${i}`, kind: 'doc-update', files: [{ path: `${dir}/new.md`, after: '# ok\n' }] }, { smDir, mode: 'auto' });
      assert.equal(res.status, 'applied', dir);
      assert.equal(read(root, `${dir}/new.md`), '# ok\n');
    }
  } finally { cleanup(root, smDir); }
});

// The JS realpath keeps 8.3 short names, so the rule itself must know "GIT~1" when the native realpath is unavailable.
test('the .git name rule knows .git and its short names, and nothing else', () => {
  for (const name of ['.git', '.GIT', 'GIT~1', 'git~12']) assert.equal(isGitName(name), true, name);
  for (const name of ['_git', '-git', 'agit', 'git~d', 'git~', 'git', '.gitignore', 'GIT~1x']) assert.equal(isGitName(name), false, name);
});

test('a project without id or root is refused instead of throwing', () => {
  const { root, smDir } = makeRepo();
  try {
    for (const project of [null, undefined, {}, { root }, { id: ID }, { id: '../x', root }]) {
      const label = JSON.stringify(project);
      const res = applyOp(project, docOp(), { smDir, mode: 'auto' });
      assert.equal(res.status, 'refused', label);
      assert.equal(res.error, 'bad-path', label);
      assert.deepEqual(resolveProposal(project, 'op:doc-1', 'accept', { smDir, mode: 'suggest' }), { ok: false, error: 'bad-path' }, label);
      assert.deepEqual(undoOp(project, 'op:doc-1', { smDir, confirm: true }), { ok: false, error: 'bad-path' }, label);
    }
    assert.equal(read(root, 'docs/api.md'), CRLF_BOM);
  } finally { cleanup(root, smDir); }
});

// A hard link needs no special rights, and like a symlink it would carry the write to another file.
test('a file planted under the old predictable temporary name is never written through', () => {
  const { root, smDir, project } = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), 'sm-care-out-'));
  try {
    writeFileSync(join(outside, 'victim.txt'), 'untouched\n');
    linkSync(join(outside, 'victim.txt'), join(root, 'docs', `api.md.sm-${process.pid}.tmp`));
    const res = applyOp(project, docOp(), { smDir, mode: 'auto' });
    assert.equal(res.status, 'applied');
    assert.equal(readFileSync(join(outside, 'victim.txt'), 'utf8'), 'untouched\n');
  } finally { cleanup(root, smDir, outside); }
});
