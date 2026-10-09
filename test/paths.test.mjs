import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, projectIdOf } from '../server/paths.mjs';
import { join } from 'node:path';
import { folderWithShortName } from './short-name.mjs';

test('normalizePath: windows spellings of one folder collapse to one', () => {
  assert.equal(normalizePath('c:\\dev\\x'), 'c:/dev/x');
  assert.equal(normalizePath('C:/Dev/X/'), 'c:/dev/x');
  assert.equal(normalizePath('C:\\dev\\x\\'), 'c:/dev/x');
});

test('normalizePath: git-bash style /c/x only maps to a drive on windows', () => {
  if (process.platform === 'win32') assert.equal(normalizePath('/c/dev/x'), 'c:/dev/x');
  else assert.equal(normalizePath('/c/dev/x'), '/c/dev/x');
});

test('projectIdOf: slug of folder name plus 6 hex of the normalized path, stable across spellings', () => {
  const a = projectIdOf('C:\\dev\\My Project');
  assert.match(a, /^my-project-[0-9a-f]{6}$/);
  assert.equal(projectIdOf('c:/dev/my project/'), a);
  assert.notEqual(projectIdOf('c:/other/my project'), a);
});

// Windows hands out both spellings of one folder: git and the OS say C:\Users\runneradmin\..., while
// os.tmpdir() and old tools say C:\Users\RUNNER~1\... (8.3 short name).
test('normalizePath: a windows 8.3 short name and the long name are the same folder', { skip: process.platform !== 'win32' }, (t) => {
  const folder = folderWithShortName(t);
  if (!folder) return t.skip('8.3 short names are off on this volume');
  const { long, short } = folder;

  assert.equal(normalizePath(short), normalizePath(long));
  assert.equal(projectIdOf(short), projectIdOf(long));
  assert.equal(normalizePath(join(short, 'not-created-yet')), normalizePath(join(long, 'not-created-yet')));
});
