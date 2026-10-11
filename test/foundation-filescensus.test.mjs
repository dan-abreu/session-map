// The census fields the Files list gives the files side of the map (id77): code/comment/blank counts, why a file is left
// out, and "new" for a file git sees that no census has counted yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusFields, withCensus } from '../server/foundation/filescensus.mjs';
import { clearTreeCache } from '../server/foundation/repotree.mjs';

const row = (path, extra = {}) => ({
  path, type: 'js', kind: 'code', included: true, reason: null, bytes: 10, chars: 10, words: 2,
  lines: { total: 10, code: 6, comment: 3, blank: 1 }, owner: 'web', ...extra,
});
const census = {
  version: 1, rev: 3, excluded: {}, sums: { total: { files: 2, chars: 20, lines: { total: 15 } }, folders: {} },
  files: [
    row('src/a.js'),
    row('docs/guide.md', { kind: 'doc', lines: { total: 5, code: 5, comment: 0, blank: 0 } }),
    row('dist/out.js', { kind: 'generated', included: false, reason: 'generated', lines: null, chars: null }),
  ],
};

test('censusFields: a counted file carries code, comment and blank; not counted yet carries null', () => {
  const out = censusFields([{ path: 'src/a.js', lines: 10, owners: ['web'] }, { path: 'src/b.js', lines: 3 }], census, null);
  assert.deepEqual(out[0].census, { code: 6, comment: 3, blank: 1 });
  assert.equal(out[0].excluded, null);
  assert.equal(out[0].new, false);
  assert.deepEqual(out[0].owners, ['web'], 'what the row already said is kept');
  assert.equal(out[1].census, null, 'a file the census has not counted is "not read yet", not zero');
});

test('censusFields: a left-out file says why and has no counts', () => {
  const [f] = censusFields([{ path: 'dist/out.js', lines: 4 }], census, null);
  assert.deepEqual([f.census, f.excluded], [null, 'generated']);
});

test('censusFields: with no census at all, every file reads as not counted', () => {
  const [f] = censusFields([{ path: 'src/a.js', lines: 10 }], null, null);
  assert.deepEqual([f.census, f.excluded, f.new], [null, null, false]);
});

test('censusFields: the files the tree marks new are new', () => {
  const tree = { tree: { type: 'folder', path: '', children: [
    { type: 'folder', path: 'src', children: [{ type: 'file', path: 'src/a.js', new: false }, { type: 'file', path: 'src/b.js', new: true }] },
  ] } };
  const out = censusFields([{ path: 'src/a.js' }, { path: 'src/b.js' }], census, tree);
  assert.deepEqual(out.map((f) => f.new), [false, true]);
});

test('withCensus: a file made a moment ago shows up as new before any count, a left-out or secret one does not', async () => {
  clearTreeCache();
  const root = mkdtempSync(join(tmpdir(), 'sm-filescensus-'));
  try {
    mkdirSync(join(root, 'src'));
    for (const p of ['src/a.js', 'src/fresh.js', 'dist/out.js', '.env', 'logo.png']) {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), 'x\n');
    }
    const list = async () => ['src/a.js', 'src/fresh.js', 'dist/out.js', '.env', 'logo.png'];
    const out = await withCensus([{ path: 'src/a.js', lines: 10, kind: 'code', owners: ['web'] }], { root, census, list, nowMs: 1000 });
    const byPath = new Map(out.map((f) => [f.path, f]));
    assert.deepEqual([...byPath.keys()].sort(), ['src/a.js', 'src/fresh.js']);
    assert.equal(byPath.get('src/a.js').new, false);
    assert.deepEqual(byPath.get('src/a.js').census, { code: 6, comment: 3, blank: 1 });
    const fresh = byPath.get('src/fresh.js');
    assert.deepEqual([fresh.new, fresh.census, fresh.excluded, fresh.status, fresh.lines], [true, null, null, null, null]);
    assert.equal(fresh.owners, undefined, 'a file too new to be placed is not "with no box"');
  } finally {
    rmSync(root, { recursive: true, force: true });
    clearTreeCache();
  }
});

test('withCensus: without a census nothing is added and git is not asked', async () => {
  const files = [{ path: 'a.js', lines: 1 }];
  let asked = 0;
  const out = await withCensus(files, { root: '/nowhere', census: null, list: async () => { asked++; return []; } });
  assert.equal(asked, 0);
  assert.deepEqual(out.map((f) => [f.path, f.census, f.new]), [['a.js', null, false]]);
});

test('withCensus: when git cannot answer the list stays as it was, with the census fields', async () => {
  clearTreeCache();
  const out = await withCensus([{ path: 'src/a.js', lines: 10 }], { root: '/nowhere', census, list: async () => null, nowMs: 5000 });
  assert.deepEqual(out.map((f) => [f.path, f.new, f.census?.code]), [['src/a.js', false, 6]]);
});
