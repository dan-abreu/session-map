import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemver, compareSemver, floorOfRange, relationOf, mismatchOf, classifyCommit, nextVersion, pieceKey, warningOf, MAIN_PIECES,
} from '../server/foundation/versions-core.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');

// ---------- parseSemver / compareSemver ----------
test('parseSemver reads x.y.z with an optional v and keeps the pre-release', () => {
  assert.deepEqual(parseSemver('1.2.0'), { major: 1, minor: 2, patch: 0, pre: null });
  assert.deepEqual(parseSemver('v0.10.1'), { major: 0, minor: 10, patch: 1, pre: null });
  assert.deepEqual(parseSemver(' 2.0.0-rc.1+build5 '), { major: 2, minor: 0, patch: 0, pre: 'rc.1' });
});

test('parseSemver refuses anything that is not pure semver', () => {
  for (const bad of ['v0.10.1k', '1.2', '1', '1.2.3.4', '01.2.3', '^1.2.3', '', null, undefined, 12, 'latest']) {
    assert.equal(parseSemver(bad), null, String(bad));
  }
});

test('compareSemver orders numbers as numbers and a pre-release before its release', () => {
  assert.equal(compareSemver('1.2.0', '1.1.0'), 1);
  assert.equal(compareSemver('1.1.0', '1.2.0'), -1);
  assert.equal(compareSemver('v1.2.0', '1.2.0'), 0);
  assert.equal(compareSemver('0.10.0', '0.9.0'), 1);
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-1'), 1);
  assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
});

test('compareSemver returns null when a side is not semver', () => {
  assert.equal(compareSemver('1.2.0', 'v0.10.1k'), null);
  assert.equal(compareSemver(null, '1.0.0'), null);
});

// ---------- floorOfRange ----------
test('floorOfRange takes the lowest version a range allows', () => {
  const cases = {
    '^16.0.1': '16.0.1',
    '~1.2': '1.2.0',
    '>=20': '20.0.0',
    '16.0.1': '16.0.1',
    'v20.11.0': '20.11.0',
    '20.x': '20.0.0',
    '>=18 <22': '18.0.0',
    '>= 3.0.0 < 4.0.0': '3.0.0',
    '^1.2.0 || ^2.0.0': '1.2.0',
    '^2.0.0 || ^1.2.0': '1.2.0',
    '=1.4.2': '1.4.2',
    '~>3.1': '3.1.0',
    '^5.0.0-beta.2': '5.0.0-beta.2',
  };
  for (const [range, floor] of Object.entries(cases)) assert.equal(floorOfRange(range), floor, range);
});

test('floorOfRange answers null when a range has no lower bound or points elsewhere', () => {
  for (const r of ['*', 'latest', '', '<5', 'workspace:*', 'github:acme/x', 'file:../x', 'npm:other@1', 'x', null, undefined, 3]) {
    assert.equal(floorOfRange(r), null, String(r));
  }
});

// ---------- relationOf (fd09: 1.2.0 in code, tag v1.1.0) ----------
test('relationOf: code 1.2.0 against tag v1.1.0 is ahead and a mismatch', () => {
  assert.equal(relationOf('1.2.0', 'v1.1.0'), 'ahead');
  assert.equal(mismatchOf('ahead'), true);
});

test('relationOf: equal ignores the v, behind is the other way, anything unreadable is unknown', () => {
  assert.equal(relationOf('0.2.5', 'v0.2.5'), 'equal');
  assert.equal(mismatchOf('equal'), false);
  assert.equal(relationOf('1.0.0', 'v1.1.0'), 'behind');
  assert.equal(mismatchOf('behind'), true);
  assert.equal(relationOf('1.0.0', null), 'unknown');
  assert.equal(relationOf(null, 'v1.0.0'), 'unknown');
  assert.equal(relationOf('1.0.0', 'v0.10.1k'), 'unknown');
  assert.equal(mismatchOf('unknown'), false);
});

// ---------- classifyCommit ----------
test('classifyCommit: feat is minor, fix and perf are patch', () => {
  assert.deepEqual(classifyCommit('feat: add export'), { type: 'feat', scope: null, breaking: false, bump: 'minor' });
  assert.deepEqual(classifyCommit('fix(api): stop the crash'), { type: 'fix', scope: 'api', breaking: false, bump: 'patch' });
  assert.equal(classifyCommit('perf: faster census').bump, 'patch');
});

test('classifyCommit: a bang or a BREAKING CHANGE footer is major', () => {
  assert.deepEqual(classifyCommit('feat!: new format'), { type: 'feat', scope: null, breaking: true, bump: 'major' });
  assert.equal(classifyCommit('refactor(core)!: rename').bump, 'major');
  assert.equal(classifyCommit('fix: x', 'Details.\n\nBREAKING CHANGE: the file moved').bump, 'major');
  assert.equal(classifyCommit('fix: x', 'BREAKING-CHANGE: moved').breaking, true);
});

test('classifyCommit: docs, chore and the like publish nothing', () => {
  for (const t of ['docs', 'chore', 'style', 'test', 'ci', 'build', 'refactor']) {
    assert.equal(classifyCommit(`${t}: something`).bump, null, t);
  }
});

test('classifyCommit: a subject that is not Conventional has no type and no bump', () => {
  assert.deepEqual(classifyCommit('Merge branch main'), { type: null, scope: null, breaking: false, bump: null });
  assert.equal(classifyCommit('Feat: capital letters are read as feat').type, 'feat');
  assert.equal(classifyCommit('feature: not a type').type, null);
  assert.equal(classifyCommit('', '').bump, null);
  assert.equal(classifyCommit(null).bump, null);
});

test('classifyCommit: the text "breaking change" in a normal sentence does not count', () => {
  assert.equal(classifyCommit('fix: x', 'this is not a breaking change').bump, 'patch');
});

// ---------- nextVersion (fd09: after a feat commit the suggestion is a minor bump) ----------
const c = (subject, hash = 'a1b2c3', body = '') => ({ hash, subject, body });

test('nextVersion: after a feat commit the suggestion is a minor bump', () => {
  assert.deepEqual(nextVersion('v1.1.0', [c('feat: x', 'a1b2c3')], '1.1.0'), {
    version: '1.2.0', because: 'feat', commits: ['a1b2c3'], alreadyInCode: false, nonSemver: false,
  });
});

test('nextVersion: fix is a patch bump and feat beats fix', () => {
  assert.equal(nextVersion('1.1.0', [c('fix: x')], '1.1.0').version, '1.1.1');
  const both = nextVersion('1.1.0', [c('fix: x', 'f1'), c('feat: y', 'f2')], '1.1.0');
  assert.equal(both.version, '1.2.0');
  assert.equal(both.because, 'feat');
  assert.deepEqual(both.commits, ['f2']);
});

test('nextVersion: feat! is major, but in 0.x it is a minor bump (still because breaking)', () => {
  const major = nextVersion('v1.4.2', [c('feat!: x')], '1.4.2');
  assert.equal(major.version, '2.0.0');
  assert.equal(major.because, 'breaking');
  const zero = nextVersion('v0.2.5', [c('feat!: x')], '0.2.5');
  assert.equal(zero.version, '0.3.0');
  assert.equal(zero.because, 'breaking');
});

test('nextVersion: only docs and chore means nothing to publish', () => {
  assert.equal(nextVersion('v1.1.0', [c('docs: a'), c('chore: b'), c('Merge branch')], '1.1.0'), null);
  assert.equal(nextVersion('v1.1.0', [], '1.1.0'), null);
});

test('nextVersion: the tag v0.10.1k is not semver, so only the kind comes back', () => {
  assert.deepEqual(nextVersion('v0.10.1k', [c('feat: x', 'h1')], '0.10.1'), {
    version: null, because: 'feat', commits: ['h1'], alreadyInCode: false, nonSemver: true,
  });
});

test('nextVersion: a pre-release tag is not guessed either', () => {
  assert.equal(nextVersion('v1.0.0-rc.1', [c('fix: x')], '1.0.0-rc.1').nonSemver, true);
});

test('nextVersion: a suggestion the code already carries is marked alreadyInCode', () => {
  const r = nextVersion('v1.1.0', [c('feat: x')], '1.2.0');
  assert.equal(r.version, '1.2.0');
  assert.equal(r.alreadyInCode, true);
  assert.equal(nextVersion('v1.1.0', [c('feat: x')], '1.3.0').alreadyInCode, true);
  assert.equal(nextVersion('v1.1.0', [c('feat: x')], null).alreadyInCode, false);
});

test('nextVersion: with no tag the code version is the base; with neither there is no suggestion', () => {
  assert.equal(nextVersion(null, [c('fix: x')], '0.4.0').version, '0.4.1');
  assert.equal(nextVersion(null, [c('fix: x')], null), null);
  assert.equal(nextVersion(null, [c('fix: x')], 'weird'), null);
});

test('nextVersion: a commit with no hash still counts but is not listed', () => {
  assert.equal(nextVersion('1.0.0', [{ subject: 'feat: x' }], '1.0.0').commits.length, 0);
  assert.equal(nextVersion('1.0.0', [{ subject: 'feat: x' }], '1.0.0').version, '1.1.0');
});

// ---------- warningOf ----------
const next16 = { name: 'next', ecosystem: 'npm', version: '16.0.1' };

test('warningOf: an advisory from OSV makes the piece vulnerable and verified', () => {
  const sources = { vulns: { [pieceKey(next16)]: [{ id: 'GHSA-xxxx-0001' }, 'CVE-2026-0002'] }, now: NOW };
  const r = warningOf(next16, sources);
  assert.equal(r.verified, true);
  assert.equal(r.reason, null);
  assert.deepEqual(r.warning, { kind: 'vulnerable', ids: ['GHSA-xxxx-0001', 'CVE-2026-0002'], detail: '2 advisories' });
});

test('warningOf: OSV answered with an empty list means verified and no warning', () => {
  const r = warningOf(next16, { vulns: { [pieceKey(next16)]: [] }, now: NOW });
  assert.deepEqual({ verified: r.verified, warning: r.warning }, { verified: true, warning: null });
});

test('warningOf: the end of life of Node gives eol', () => {
  const node = { name: 'node', ecosystem: 'runtime', version: '18.19.0' };
  const eol = { node: [{ cycle: '20', eol: '2026-04-30' }, { cycle: '18', eol: '2025-04-30' }] };
  const r = warningOf(node, { eol, now: NOW });
  assert.equal(r.verified, true);
  assert.deepEqual(r.warning, { kind: 'eol', ids: [], detail: 'ended 2025-04-30' });
});

test('warningOf: a cycle with a future end date, or eol false, is fine', () => {
  const node = { name: 'node', ecosystem: 'runtime', version: '24.1.0' };
  assert.equal(warningOf(node, { eol: { node: [{ cycle: '24', eol: '2028-04-30' }] }, now: NOW }).warning, null);
  assert.equal(warningOf(node, { eol: { node: [{ cycle: '24', eol: false }] }, now: NOW }).warning, null);
  assert.equal(warningOf(node, { eol: { node: [{ cycle: '24', eol: true }] }, now: NOW }).warning.kind, 'eol');
});

test('warningOf: the cycle is matched by major.minor first, then by major', () => {
  const php = { name: 'php', ecosystem: 'runtime', version: '8.1.2' };
  const eol = { php: [{ cycle: '8.1', eol: '2025-12-31' }, { cycle: '8', eol: '2099-01-01' }] };
  assert.equal(warningOf(php, { eol, now: NOW }).warning.kind, 'eol');
});

test('warningOf: a piece a whole major behind the latest is behind; a minor behind is not a warning', () => {
  const sources = { latest: { 'npm:next': '18.2.0' }, now: NOW };
  const r = warningOf(next16, sources);
  assert.equal(r.latest, '18.2.0');
  assert.deepEqual(r.warning, { kind: 'behind', ids: [], detail: 'latest 18.2.0' });
  const near = warningOf({ ...next16, version: '18.0.0' }, sources);
  assert.equal(near.warning, null);
  assert.equal(near.verified, true);
  assert.equal(near.latest, '18.2.0');
});

test('warningOf: vulnerable wins over eol, and eol wins over behind', () => {
  const node = { name: 'node', ecosystem: 'runtime', version: '18.0.0' };
  const sources = {
    vulns: { [pieceKey(node)]: ['GHSA-x'] },
    eol: { node: [{ cycle: '18', eol: '2025-04-30' }] },
    latest: { 'runtime:node': '24.0.0' },
    now: NOW,
  };
  assert.equal(warningOf(node, sources).warning.kind, 'vulnerable');
  delete sources.vulns;
  assert.equal(warningOf(node, sources).warning.kind, 'eol');
  delete sources.eol;
  assert.equal(warningOf(node, sources).warning.kind, 'behind');
});

test('warningOf: without any source the piece is unverified with the reason, never a clean bill', () => {
  assert.deepEqual(warningOf(next16, null), { warning: null, verified: false, reason: 'no-source', latest: null });
  assert.deepEqual(warningOf(next16, { reason: 'no-network' }), { warning: null, verified: false, reason: 'no-network', latest: null });
  // sources that answered for other pieces say nothing about this one
  const other = warningOf(next16, { vulns: { 'npm:react@19.0.0': [] }, eol: { node: [] }, now: NOW });
  assert.equal(other.verified, false);
  assert.equal(other.reason, 'no-source');
});

test('warningOf: a piece with no readable version cannot be checked', () => {
  const r = warningOf({ name: 'next', ecosystem: 'npm', version: null }, { vulns: {}, now: NOW });
  assert.deepEqual(r, { warning: null, verified: false, reason: 'no-version', latest: null });
});

// ---------- the table ----------
test('MAIN_PIECES lists the main pieces of the contract, each with an ecosystem', () => {
  const names = MAIN_PIECES.map((p) => p.name);
  for (const n of ['node', 'php', 'dart', 'flutter', 'next', 'react', 'fastify', 'express', '@nestjs/core', 'vue', 'nuxt',
    'svelte', 'astro', 'vite', 'prisma', 'typescript', 'laravel/framework', 'symfony/framework-bundle']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(MAIN_PIECES.find((p) => p.name === 'laravel/framework').ecosystem, 'packagist');
  assert.equal(MAIN_PIECES.find((p) => p.name === 'next').ecosystem, 'npm');
  assert.equal(MAIN_PIECES.find((p) => p.name === 'node').ecosystem, 'runtime');
  assert.ok(Object.isFrozen(MAIN_PIECES));
});
