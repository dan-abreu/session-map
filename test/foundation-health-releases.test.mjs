import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS } from '../server/foundation/health-checks/releases.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const pkg = (version, extra = {}) => JSON.stringify({ name: 'acme-lib', version, ...extra });
const run = (id, over) => CHECKS[id](fakeHealthCtx(over));
const sr = (r) => [r.state, r.reason];
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
const PUBLIC = { visibility: 'public' };

test('one function per releases item, and no stray ones', () => {
  const ids = HEALTH_ITEMS.filter((i) => i.category === 'releases').map((i) => i.id).sort();
  assert.equal(ids.length, 7);
  assert.deepEqual(Object.keys(CHECKS).sort(), ids);
});

test('semver: VERSION 1.1.0 against package.json 1.2.0 fails', () => {
  const r = run('releases.semver', { files: { VERSION: '1.1.0\n', 'package.json': pkg('1.2.0') } });
  assert.deepEqual(sr(r), ['fail', 'invalid']);
  assert.ok(r.evidence.some((e) => e.file === 'VERSION'));
});

test('semver: one valid version passes, a broken one fails, none fails, unreadable is unverified', () => {
  assert.equal(run('releases.semver', { files: { 'package.json': pkg('1.2.0') } }).state, 'pass');
  assert.equal(run('releases.semver', { files: { VERSION: '1.2.0', 'package.json': pkg('1.2.0') } }).state, 'pass');
  assert.deepEqual(sr(run('releases.semver', { files: { 'package.json': pkg('1.2') } })), ['fail', 'invalid']);
  assert.deepEqual(sr(run('releases.semver', { files: { 'README.md': '# x' } })), ['fail', 'missing']);
  const big = run('releases.semver', { files: { 'package.json': pkg('1.2.0', { pad: 'x'.repeat(210 * 1024) }) } });
  assert.deepEqual(sr(big), ['unverified', 'too-big']);
});

test('tags: last tag different from the code fails; equal passes', () => {
  const files = { 'package.json': pkg('1.2.0') };
  const r = run('releases.tags', { files, git: { tags: ['v1.1.0', 'v1.0.0'], subjects: ['x'] } });
  assert.deepEqual(sr(r), ['fail', 'stale']);
  assert.equal(run('releases.tags', { files, git: { tags: ['v1.2.0', 'v1.1.0'], subjects: ['x'] } }).state, 'pass');
});

test('tags: reads ctx.versions first, and finds the highest tag when it is absent', () => {
  const files = { 'package.json': pkg('1.2.0') };
  const versions = { code: { version: '1.3.0' }, tag: 'v1.3.0' };
  assert.equal(run('releases.tags', { files, versions, git: { tags: ['v0.1.0'], subjects: ['x'] } }).state, 'pass');
  assert.equal(run('releases.tags', { files: { VERSION: '1.10.0' }, git: { tags: ['v1.9.0', 'v1.10.0'], subjects: ['x'] } }).state, 'pass');
});

test('tags: none fails, no git data is unverified, code not semver is unverified', () => {
  const files = { 'package.json': pkg('1.2.0') };
  assert.deepEqual(sr(run('releases.tags', { files, git: { remote: 'https://github.com/ana/acme', subjects: ['x'] } })), ['fail', 'missing']);
  assert.deepEqual(sr(run('releases.tags', { files })), ['unverified', 'no-data']);
  assert.deepEqual(sr(run('releases.tags', { files: { 'package.json': pkg('1.2') }, git: { tags: ['v1.0.0'], subjects: ['x'] } })), ['unverified', 'no-data']);
});

test('changelog: versions plus Unreleased in 10+ lines passes; short, missing, template fail', () => {
  const good = '# Changelog\n\n## [Unreleased]\n\n- thing\n\n## [1.2.0] - 2026-01-01\n\n- a\n- b\n- c\n\n## [1.1.0] - 2025-12-01\n- d\n- e\n- f';
  assert.equal(run('releases.changelog', { files: { 'CHANGELOG.md': good } }).state, 'pass');
  assert.equal(run('releases.changelog', { files: { 'changelog.md': good.replace('Unreleased', 'Não lançado') } }).state, 'pass');
  assert.deepEqual(sr(run('releases.changelog', { files: { 'CHANGELOG.md': '# Changelog\n## [Unreleased]' } })), ['fail', 'too-short']);
  assert.equal(run('releases.changelog', { files: { 'README.md': 'x' } }).reason, 'missing');
  assert.equal(run('releases.changelog', { files: { 'CHANGELOG.md': `${good}\nSee [INSERT LINK]` } }).reason, 'placeholder');
  assert.equal(run('releases.changelog', { files: { 'CHANGELOG.md': `# Changelog\n${lines(12)}\n## 1.0.0\n- a` } }).state, 'fail');
  const big = run('releases.changelog', { files: { 'CHANGELOG.md': `${good}\n${'x'.repeat(210 * 1024)}` } });
  assert.deepEqual(sr(big), ['unverified', 'too-big']);
});

test('gh_releases: no api data is unverified with the reason by mode; notes decide pass and fail', () => {
  const base = { ...PUBLIC, kinds: ['code'] };
  assert.deepEqual(sr(run('releases.gh_releases', { ...base, api: { mode: 'none', releases: null } })), ['unverified', 'no-token']);
  assert.equal(run('releases.gh_releases', { ...base, api: { mode: 'none', error: 'no-network', releases: null } }).reason, 'no-network');
  assert.equal(run('releases.gh_releases', { ...base, api: { mode: 'token', releases: null } }).reason, 'no-data');
  assert.equal(run('releases.gh_releases', { ...base }).reason, 'no-token');
  const ok = [{ tag: 'v1', hasNotes: true, assets: [] }];
  assert.equal(run('releases.gh_releases', { ...base, api: { mode: 'token', releases: ok } }).state, 'pass');
  const bad = run('releases.gh_releases', { ...base, api: { mode: 'token', releases: [...ok, { tag: 'v2', hasNotes: false, assets: [] }] } });
  assert.deepEqual(sr(bad), ['fail', 'missing']);
  assert.equal(run('releases.gh_releases', { ...base, api: { mode: 'token', releases: [] } }).state, 'fail');
  assert.deepEqual(sr(run('releases.gh_releases', { visibility: 'private', kinds: ['code'] })), ['na', 'private']);
});

test('conventional commits: 80% passes, 20% fails, no history is unverified', () => {
  const ok = Array.from({ length: 40 }, (_, i) => `feat(x): thing ${i}`).concat(Array.from({ length: 10 }, (_, i) => `update ${i}`));
  const files = { 'package.json': pkg('1.0.0'), 'src/a.js': 'x' };
  assert.equal(run('releases.conventional_commits', { files, git: { subjects: ok } }).state, 'pass');
  const bad = Array.from({ length: 10 }, () => 'fix: a').concat(Array.from({ length: 40 }, () => 'stuff'));
  assert.deepEqual(sr(run('releases.conventional_commits', { files, git: { subjects: bad } })), ['fail', 'invalid']);
  assert.equal(run('releases.conventional_commits', { files, git: { subjects: [] } }).state, 'unverified');
  const mixed = [...Array.from({ length: 50 }, () => 'fix: a'), ...Array.from({ length: 100 }, () => 'junk')];
  assert.equal(run('releases.conventional_commits', { files, git: { subjects: mixed } }).state, 'pass');
  assert.equal(run('releases.conventional_commits', { kinds: [], git: { subjects: ok } }).state, 'na');
});

test('automation: release-please, changesets, semantic-release or a workflow; nothing fails', () => {
  const lib = { kinds: ['library'], files: { 'package.json': pkg('1.0.0', { main: 'i.js' }) } };
  const withFiles = (f) => ({ kinds: ['library'], files: { ...lib.files, ...f } });
  assert.equal(run('releases.automation', withFiles({ 'release-please-config.json': '{}' })).state, 'pass');
  assert.equal(run('releases.automation', withFiles({ '.changeset/config.json': '{}' })).state, 'pass');
  assert.equal(run('releases.automation', withFiles({ '.releaserc.json': '{}' })).state, 'pass');
  assert.equal(run('releases.automation', withFiles({ '.github/workflows/r.yml': 'steps:\n - uses: googleapis/release-please-action@abc' })).state, 'pass');
  assert.deepEqual(sr(run('releases.automation', lib)), ['fail', 'missing']);
  assert.equal(run('releases.automation', { kinds: ['users'], files: {} }).state, 'na');
});

test('registry publish: a publish step passes, none fails, no publishable package is na', () => {
  const lib = { kinds: ['library'], files: { 'package.json': pkg('1.0.0', { main: 'i.js' }) } };
  const flow = { '.github/workflows/p.yml': 'jobs:\n  p:\n    steps:\n      - run: npm publish --provenance' };
  assert.equal(run('releases.registry_publish', { ...lib, files: { ...lib.files, ...flow } }).state, 'pass');
  assert.equal(run('releases.registry_publish', { ...lib, files: { ...lib.files, '.github/workflows/p.yml': 'steps:\n - run: npx changeset publish' } }).state, 'pass');
  const fail = run('releases.registry_publish', lib);
  assert.deepEqual(sr(fail), ['fail', 'missing']);
  assert.deepEqual(fail.packages, [{ dir: '', state: 'fail' }]);
  const priv = run('releases.registry_publish', { kinds: ['library'], files: { 'package.json': pkg('1.0.0', { private: true }) } });
  assert.deepEqual(sr(priv), ['na', 'not-library']);
  assert.equal(run('releases.registry_publish', { kinds: ['users'], files: {} }).state, 'na');
});
