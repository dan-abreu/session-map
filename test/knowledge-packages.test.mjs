import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, sharedKnowledgeDir } from '../server/foundation/library.mjs';

const dir = fileURLToPath(new URL('../knowledge/', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

test('the shared folder is the knowledge/ folder at the repository root', () => {
  assert.equal(resolve(sharedKnowledgeDir()), resolve(dir));
});

test('the README exists and states the fixed notice', () => {
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /not legal|não é parecer|guidance, not/i);
  assert.ok(readme.split('\n').length <= 300);
});

test('every knowledge/*.json is a valid package, named by its id, within 300 lines', () => {
  const lib = loadLibrary({ sharedDir: dir });
  assert.deepEqual(lib.invalid, [], 'invalid packages: ' + JSON.stringify(lib.invalid));
  assert.equal(lib.packages.length, files.length);
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.ok(text.split('\n').length <= 300, `${f} has more than 300 lines`);
  }
});

test('no shipped package claims a check date in the future', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const p of loadLibrary({ sharedDir: dir }).packages) assert.ok(p.checkedAt <= today, `${p.id} is dated after today`);
});
