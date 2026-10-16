import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf, isVendored, vendoredPrefixes } from '../server/foundation/census.mjs';
import { loadConfig } from '../server/config.mjs';
import { refreshFoundation } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// Other people's code kept in the repository (`vendored` in the project's config): left out like node_modules, so the
// Foundation does not judge a vendored package (its README links, its package.json, its lockfile) as the project's own.

test('the prefixes are cleaned: slashes, a leading ./, a trailing /, nothing that climbs out, nothing that is not text', () => {
  assert.deepEqual(vendoredPrefixes(['server/disciplines/', './a\\b', '..', 'x/../y', '/z', 5, '', '  w  ']), ['server/disciplines', 'a/b', 'z', 'w']);
  assert.deepEqual(vendoredPrefixes(undefined), []);
  assert.equal(isVendored('server/disciplines/x.md', ['server/disciplines']), true);
  assert.equal(isVendored('server/disciplines-other/x.md', ['server/disciplines']), false, 'a longer name is not under the folder');
  assert.equal(isVendored('server/a.mjs', []), false);
});

test('a vendored folder is counted as a library, its files are not read, and the rest is counted as before', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-vendored-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'third', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
    writeFileSync(join(root, 'third', 'lib', 'b.js'), 'export const b = 2;\n');
    writeFileSync(join(root, 'third', 'package.json'), '{}\n');
    const plain = await censusOf(root, null, {});
    assert.equal(plain.files.filter((f) => f.included).length, 3);
    const census = await censusOf(root, null, { vendored: ['third'] });
    assert.deepEqual(census.files.filter((f) => f.included).map((f) => f.path), ['src/a.js']);
    assert.deepEqual(census.files.filter((f) => !f.included).map((f) => [f.path, f.kind]), [['third/lib/b.js', 'dep'], ['third/package.json', 'dep']]);
    assert.equal(census.excluded.dep, 2, 'they show in the count of what was left out');
    assert.equal(census.sums.total.files, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the config keeps a list of strings under vendored and drops anything else', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-vendored-cfg-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-vendored-sm-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ vendored: ['a', 'b'] }));
    assert.deepEqual(loadConfig(root, smDir).vendored, ['a', 'b']);
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ vendored: 'a' }));
    assert.equal(loadConfig(root, smDir).vendored, undefined);
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ vendored: ['a', 5] }));
    assert.equal(loadConfig(root, smDir).vendored, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the refresh round reads the project config: a vendored folder never reaches the census, and the blocks judge the rest', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-vendored-round-'));
  try {
    mkdirSync(join(root, 'vendor-ish', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'vendor-ish', 'pkg', 'package.json'), '{ "name": "someone-elses" }\n');
    writeFileSync(join(root, 'vendor-ish', 'README.md'), '# Theirs\n\n![logo](assets/logo.png)\n');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ vendored: ['vendor-ish'] }));
    const id = 'acme-shop-8324f1';
    const out = await refreshFoundation({ id, name: 'acme-shop', root }, smDir, { now: () => 1_000_000 });
    assert.equal(out.steps.every((s) => s.ok), true, JSON.stringify(out.steps));
    const census = readFd(smDir, id, 'census.json', null);
    assert.equal(census.files.some((f) => f.included && f.path.startsWith('vendor-ish/')), false);
    assert.ok(census.files.some((f) => !f.included && f.path === 'vendor-ish/README.md' && f.kind === 'dep'));
    const health = readFd(smDir, id, 'health.json', null);
    assert.ok(health, 'the health block ran after the census');
    const packages = JSON.stringify(health.items.map((i) => i.detail));
    assert.doesNotMatch(packages, /vendor-ish/, 'no health item names the vendored package');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
    removeFixtureRepo(root);
  }
});
