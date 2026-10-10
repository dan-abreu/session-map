import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fdDir, fdPath, readFd, writeFd } from '../server/foundation/store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-fdstore-'));
const ID = 'acme-shop-8324f1';

test('fdDir is the foundation folder inside the project brain', () => {
  const smDir = tmp();
  try {
    assert.equal(fdDir(smDir, ID), join(smDir, 'brain', ID, 'foundation'));
    assert.equal(fdPath(smDir, ID, 'census.json'), join(smDir, 'brain', ID, 'foundation', 'census.json'));
    assert.equal(fdPath(smDir, ID, 'undo/op-1.json'), join(smDir, 'brain', ID, 'foundation', 'undo', 'op-1.json'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('writeFd then readFd gives the same data back, written atomically', () => {
  const smDir = tmp();
  try {
    const data = { version: 1, generatedAt: '2026-10-10T10:00:00.000Z', rev: 3, files: [{ path: 'src/a.ts' }] };
    writeFd(smDir, ID, 'census.json', data);
    assert.deepEqual(readFd(smDir, ID, 'census.json', null), data);
    assert.deepEqual(readdirSync(fdDir(smDir, ID)), ['census.json'], 'no temporary file is left behind');
    writeFd(smDir, ID, 'proposals/op-1.json', { id: 'op-1' });
    assert.deepEqual(readFd(smDir, ID, 'proposals/op-1.json', null), { id: 'op-1' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('readFd answers the fallback for a missing file, broken JSON or an unknown version', () => {
  const smDir = tmp();
  try {
    assert.equal(readFd(smDir, ID, 'model.json', null), null);
    mkdirSync(fdDir(smDir, ID), { recursive: true });
    writeFileSync(fdPath(smDir, ID, 'facts.json'), '{ not json');
    assert.equal(readFd(smDir, ID, 'facts.json', null), null);
    writeFd(smDir, ID, 'health.json', { version: 2, score: 10 });
    assert.equal(readFd(smDir, ID, 'health.json', 'redo'), 'redo', 'a version this reader does not know is redone from zero');
    writeFd(smDir, ID, 'care.json', { mode: 'look', askedAt: null });
    assert.deepEqual(readFd(smDir, ID, 'care.json', null), { mode: 'look', askedAt: null }, 'files without a version field are read as they are');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('names and ids that could leave the foundation folder are refused', () => {
  const smDir = tmp();
  try {
    for (const bad of ['../x.json', '..', 'a/../../b.json', '/etc/passwd', 'C:/x.json', 'a\\b.json', 'a/b/c.json', '', '.hidden.json']) {
      assert.throws(() => fdPath(smDir, ID, bad), /invalid/, bad);
      assert.throws(() => writeFd(smDir, ID, bad, {}), /invalid/, bad);
    }
    assert.throws(() => fdDir(smDir, '../other'), /invalid project id/);
    assert.equal(existsSync(join(smDir, 'brain')), false, 'nothing was written');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
