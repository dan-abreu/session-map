import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { versionsOf } from '../server/foundation/versions.mjs';
import { commitsSince, lastTag } from '../server/foundation/versions-git.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { readFd, writeFd } from '../server/foundation/store.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// A real git repository in a temporary folder; nothing here touches the network or a real project.
let clock = Date.parse('2026-01-01T00:00:00Z');
function git(root, args) {
  clock += 60_000;
  const when = new Date(clock).toISOString();
  return execFileSync('git', [
    '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=none', '-c', 'init.defaultBranch=main', ...args,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
}

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}
function commit(root, subject, body = '') {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])]);
}
function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-versions-'));
  git(root, ['init', '-q']);
  write(root, files);
  if (Object.keys(files).length) commit(root, 'chore: start');
  return root;
}
const tag = (root, name) => git(root, ['tag', name]);
const gone = (root) => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const pkg = (extra = {}) => `${JSON.stringify({ name: 'acme-app', version: '1.2.0', ...extra }, null, 2)}\n`;
const NOW = new Date('2026-06-01T00:00:00Z');

function withRepo(files, fn) {
  return async () => {
    const root = repo(files);
    try { await fn(root); } finally { gone(root); }
  };
}

test('package.json 1.2.0 with tag v1.1.0 shows both, ahead, and where the code number is', withRepo({ 'package.json': pkg() }, async (root) => {
  tag(root, 'v1.1.0');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.version, 1);
  assert.deepEqual(
    { version: v.code.version, source: v.code.source, file: v.code.file, line: v.code.line, others: v.code.others },
    { version: '1.2.0', source: 'package.json', file: 'package.json', line: 3, others: [] },
  );
  assert.equal(v.tag, 'v1.1.0');
  assert.equal(v.relation, 'ahead');
  assert.equal(v.mismatch, true);
  assert.equal(v.live, null);
}));

test('code and tag with the same number are equal and not a mismatch', withRepo({ 'package.json': pkg() }, async (root) => {
  tag(root, 'v1.2.0');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.relation, 'equal');
  assert.equal(v.mismatch, false);
}));

test('VERSION wins over package.json and the disagreeing package.json is listed in others', withRepo({ VERSION: '1.3.0\n', 'package.json': pkg() }, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.code.version, '1.3.0');
  assert.equal(v.code.source, 'VERSION');
  assert.equal(v.code.file, 'VERSION');
  assert.equal(v.code.line, 1);
  assert.deepEqual(v.code.others, [{ source: 'package.json', version: '1.2.0', file: 'package.json', line: 3 }]);
}));

test('a declaration that agrees with the code number is not listed in others', withRepo({ VERSION: '1.2.0\n', 'package.json': pkg() }, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  assert.deepEqual(v.code.others, []);
}));

test('a monorepo without a version at the root uses the first manifest that has one', withRepo({
  'package.json': JSON.stringify({ name: 'root', private: true }),
  'apps/b/package.json': pkg({ name: 'b', version: '3.0.0' }),
  'apps/a/package.json': pkg({ name: 'a', version: '2.0.0' }),
}, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.code.version, '2.0.0');
  assert.equal(v.code.file, 'apps/a/package.json');
  assert.deepEqual(v.code.others.map((o) => o.file), ['apps/b/package.json']);
}));

test('with no tag the tag is null, nothing is a mismatch and there is no next number', withRepo({ 'package.json': pkg() }, async (root) => {
  commit(root, 'feat: something new');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.tag, null);
  assert.equal(v.relation, 'unknown');
  assert.equal(v.mismatch, false);
  assert.equal(v.next, null);
}));

test('without a number in any file the last semver tag is the code version', withRepo({ 'README.md': '# Acme\n' }, async (root) => {
  tag(root, 'v0.4.0');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.code.version, '0.4.0');
  assert.equal(v.code.source, 'tag');
  assert.equal(v.relation, 'equal');
}));

test('a feat commit after the tag makes the next number a minor one, with its hash', withRepo({ 'package.json': pkg({ version: '1.1.0' }) }, async (root) => {
  tag(root, 'v1.1.0');
  commit(root, 'docs: explain the thing');
  commit(root, 'feat: invoices', 'A longer explanation.');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.next.version, '1.2.0');
  assert.equal(v.next.because, 'feat');
  assert.equal(v.next.alreadyInCode, false);
  assert.equal(v.next.commits.length, 1);
  assert.match(v.next.commits[0], /^[0-9a-f]{7,}$/);
}));

test('a breaking footer in the body counts, and moving the tag forward clears the suggestion', withRepo({ 'package.json': pkg({ version: '1.2.0' }) }, async (root) => {
  tag(root, 'v1.1.0');
  commit(root, 'feat: invoices', 'BREAKING CHANGE: the old format is gone');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.next.version, '2.0.0');
  assert.equal(v.next.because, 'breaking');
  commit(root, 'chore: nothing else');
  tag(root, 'v1.2.0');
  assert.equal((await versionsOf({ root, now: NOW })).next, null);
}));

test('a suggestion the code already carries is marked alreadyInCode', withRepo({ 'package.json': pkg({ version: '1.2.0' }) }, async (root) => {
  tag(root, 'v1.1.0');
  commit(root, 'feat: invoices');
  assert.equal((await versionsOf({ root, now: NOW })).next.alreadyInCode, true);
}));

test('only docs and chores after the tag mean nothing to publish', withRepo({ 'package.json': pkg() }, async (root) => {
  tag(root, 'v1.2.0');
  commit(root, 'docs: more words');
  commit(root, 'chore: tidy');
  assert.equal((await versionsOf({ root, now: NOW })).next, null);
}));

test('a tag that is not pure semver gives the kind only, never a made-up number', withRepo({ 'package.json': pkg() }, async (root) => {
  tag(root, 'v0.10.1k');
  commit(root, 'fix: a bug');
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.tag, 'v0.10.1k');
  assert.equal(v.relation, 'unknown');
  assert.equal(v.next.nonSemver, true);
  assert.equal(v.next.version, null);
}));

test('pieces carry the floor of the range, the range, the file and the line, and nothing is verified without a source', withRepo({
  'package.json': pkg({ dependencies: { next: '^16.0.1', 'left-pad': '1.0.0' }, devDependencies: { typescript: '~5.4.2' } }),
}, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  const next = v.pieces.find((p) => p.name === 'next');
  assert.deepEqual(
    { version: next.version, range: next.range, ecosystem: next.ecosystem, file: next.file, line: next.line, warning: next.warning, verified: next.verified },
    { version: '16.0.1', range: '^16.0.1', ecosystem: 'npm', file: 'package.json', line: 5, warning: null, verified: false },
  );
  assert.ok(next.reason);
  assert.equal(v.pieces.find((p) => p.name === 'typescript').version, '5.4.2');
  assert.equal(v.pieces.some((p) => p.name === 'left-pad'), false, 'only the main pieces');
}));

test('a piece with no readable version is kept, with the reason', withRepo({
  'package.json': pkg({ dependencies: { react: 'workspace:*' } }),
}, async (root) => {
  const react = (await versionsOf({ root, now: NOW })).pieces.find((p) => p.name === 'react');
  assert.equal(react.version, null);
  assert.equal(react.range, 'workspace:*');
  assert.equal(react.verified, false);
  assert.equal(react.reason, 'no-version');
}));

test('the online sources, when handed in, give warnings and latest versions; a piece with no answer stays unverified', withRepo({
  'package.json': pkg({ dependencies: { next: '^16.0.1', react: '^19.0.0' } }),
}, async (root) => {
  const sources = { vulns: { 'npm:next@16.0.1': ['GHSA-aaaa-bbbb-cccc'] }, latest: { 'npm:next': '16.2.0' }, now: NOW.toISOString() };
  const v = await versionsOf({ root, now: NOW, cache: { version: 1, sources } });
  const next = v.pieces.find((p) => p.name === 'next');
  assert.equal(next.verified, true);
  assert.equal(next.warning.kind, 'vulnerable');
  assert.deepEqual(next.warning.ids, ['GHSA-aaaa-bbbb-cccc']);
  assert.equal(next.latest, '16.2.0');
  const react = v.pieces.find((p) => p.name === 'react');
  assert.equal(react.verified, false);
  assert.equal(react.warning, null);
}));

test('versions-online.json saved under the project is merged when it is there', withRepo({ 'package.json': pkg({ dependencies: { next: '^16.0.1' } }) }, async (root) => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-versions-home-'));
  try {
    writeFd(smDir, 'p1', 'versions-online.json', {
      version: 1, generatedAt: NOW.toISOString(),
      sources: { vulns: { 'npm:next@16.0.1': ['GHSA-x'] }, now: NOW.toISOString() },
      live: { url: 'https://app.example.com/version', version: '1.1.0', match: false, checkedAt: NOW.toISOString() },
      selfVersion: { latest: '9.9.9' },
    });
    const v = await versionsOf({ root, smDir, id: 'p1', now: NOW, selfVersion: '0.2.5' });
    assert.equal(v.pieces[0].warning.kind, 'vulnerable');
    assert.equal(v.live.match, false);
    assert.deepEqual(v.selfVersion, { current: '0.2.5', latest: '9.9.9', newer: true, verified: true });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
}));

test('without any online cache nothing is verified: pieces, node and the session-map itself', withRepo({
  'package.json': pkg({ engines: { node: '>=20' }, dependencies: { react: '^19.0.0' } }),
}, async (root) => {
  const v = await versionsOf({ root, now: NOW, selfVersion: '0.2.5', nodeRunning: '24.1.0' });
  assert.equal(v.pieces.length > 0 && v.pieces.every((p) => p.verified === false && p.reason), true);
  assert.deepEqual(v.node, { running: '24.1.0', required: '>=20', source: 'package.json', eol: null, verified: false });
  assert.deepEqual(v.selfVersion, { current: '0.2.5', latest: null, newer: null, verified: false });
  assert.equal(v.live, null);
}));

test('node required comes from engines, else .nvmrc, else it is null', async () => {
  const a = repo({ '.nvmrc': 'v22.3.0\n', 'package.json': pkg() });
  const b = repo({ 'package.json': pkg() });
  try {
    const withNvm = await versionsOf({ root: a, now: NOW, nodeRunning: '24.0.0' });
    assert.equal(withNvm.node.required, 'v22.3.0');
    assert.equal(withNvm.node.source, '.nvmrc');
    const none = await versionsOf({ root: b, now: NOW, nodeRunning: '24.0.0' });
    assert.equal(none.node.required, null);
    assert.equal(none.node.source, null);
  } finally {
    gone(a);
    gone(b);
  }
});

test('node eol follows the required floor from the sources', withRepo({
  'package.json': pkg({ engines: { node: '>=16' } }),
}, async (root) => {
  const sources = { eol: { node: [{ cycle: '16', eol: '2023-09-11' }, { cycle: '24', eol: '2028-04-30' }] }, now: NOW.toISOString() };
  const v = await versionsOf({ root, now: NOW, cache: { sources }, nodeRunning: '24.0.0' });
  assert.deepEqual(v.node, { running: '24.0.0', required: '>=16', source: 'package.json', eol: true, verified: true });
}));

test('with nothing required, node eol follows the node that is running', withRepo({ 'package.json': pkg() }, async (root) => {
  const sources = { eol: { node: [{ cycle: '18', eol: '2025-04-30' }] }, now: NOW.toISOString() };
  const v = await versionsOf({ root, now: NOW, cache: { sources }, nodeRunning: '18.19.0' });
  assert.equal(v.node.eol, true);
  assert.equal(v.node.verified, true);
}));

test('php and dart come from composer.json and pubspec.yaml, with their lines', withRepo({
  'backend/composer.json': `${JSON.stringify({ name: 'acme/backend', require: { php: '^8.2', 'laravel/framework': '^11.0' } }, null, 2)}\n`,
  'app/pubspec.yaml': 'name: acme_app\nversion: 1.0.0+4\n\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n  flutter: ">=3.10.0"\n\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n',
}, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  const by = Object.fromEntries(v.pieces.map((p) => [p.name, p]));
  assert.deepEqual(
    { version: by.php.version, range: by.php.range, ecosystem: by.php.ecosystem, file: by.php.file, line: by.php.line },
    { version: '8.2.0', range: '^8.2', ecosystem: 'runtime', file: 'backend/composer.json', line: 4 },
  );
  assert.deepEqual(
    { version: by['laravel/framework'].version, ecosystem: by['laravel/framework'].ecosystem, line: by['laravel/framework'].line },
    { version: '11.0.0', ecosystem: 'packagist', line: 5 },
  );
  assert.deepEqual(
    { version: by.dart.version, ecosystem: by.dart.ecosystem, file: by.dart.file, line: by.dart.line },
    { version: '3.0.0', ecosystem: 'runtime', file: 'app/pubspec.yaml', line: 5 },
  );
  assert.equal(by.flutter.version, '3.10.0');
  assert.equal(by.flutter.line, 6);
  assert.equal(v.code.version, '1.0.0+4');
  assert.equal(v.code.source, 'pubspec.yaml');
  assert.equal(v.code.line, 2);
}));

test('given the census, files the census left out are not read', async () => {
  const root = copyFixtureRepo('acme-shop', { env: false });
  try {
    writeFileSync(join(root, 'node_modules', 'x', 'package.json'), pkg({ name: 'x', version: '9.9.9', dependencies: { next: '^1.0.0' } }));
    const census = await censusOf(root, null, {});
    const opened = [];
    const v = await versionsOf({ root, census, now: NOW, readFile: (p, enc) => { opened.push(p.replaceAll('\\', '/')); return readFileSync(p, enc); } });
    assert.equal(v.code.version, '0.1.0');
    assert.equal(v.code.file, 'package.json');
    assert.equal(opened.some((p) => p.includes('node_modules')), false);
    assert.deepEqual([...new Set(v.pieces.map((p) => p.name))].sort(), ['fastify', 'next', 'react']);
    assert.equal(v.pieces.filter((p) => p.name === 'next').length, 2);
  } finally { removeFixtureRepo(root); }
});

test('manifests inside library folders are never the project code, even when git tracks them', withRepo({
  'package.json': pkg({ version: '0.5.0' }),
  'node_modules/x/package.json': pkg({ name: 'x', version: '9.9.9', dependencies: { next: '^1.0.0' } }),
  'vendor/y/composer.json': JSON.stringify({ name: 'y/y', version: '8.8.8' }),
}, async (root) => {
  const v = await versionsOf({ root, now: NOW });
  assert.equal(v.code.version, '0.5.0');
  assert.deepEqual(v.code.others, []);
  assert.deepEqual(v.pieces, []);
}));

test('the .env is never opened, with or without the census', async () => {
  const root = copyFixtureRepo('acme-shop');
  try {
    const census = await censusOf(root, null, {});
    for (const c of [census, undefined]) {
      const opened = [];
      await versionsOf({ root, census: c, now: NOW, readFile: (p, enc) => { opened.push(p.replaceAll('\\', '/')); return readFileSync(p, enc); } });
      assert.equal(opened.some((p) => /\/\.env$/.test(p)), false);
    }
  } finally { removeFixtureRepo(root); }
});

test('versions.json is written under the project, and a second run with nothing new keeps the same file', withRepo({ 'package.json': pkg() }, async (root) => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-versions-home-'));
  try {
    tag(root, 'v1.2.0');
    const first = await versionsOf({ root, smDir, id: 'p1', now: new Date('2026-06-01T00:00:00Z') });
    assert.deepEqual(readFd(smDir, 'p1', 'versions.json', null), first);
    const second = await versionsOf({ root, smDir, id: 'p1', now: new Date('2026-06-02T00:00:00Z') });
    assert.equal(second.generatedAt, first.generatedAt);
    commit(root, 'feat: new thing');
    const third = await versionsOf({ root, smDir, id: 'p1', now: new Date('2026-06-03T00:00:00Z') });
    assert.equal(third.generatedAt, '2026-06-03T00:00:00.000Z');
    assert.equal(readFd(smDir, 'p1', 'versions.json', null).next.version, '1.3.0');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
}));

test('without smDir nothing is written anywhere', withRepo({ 'package.json': pkg() }, async (root) => {
  await versionsOf({ root, now: NOW });
  assert.equal(existsSync(join(root, 'versions.json')), false);
}));

test('a folder that is not a git repository still reads the files, with no tag', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-versions-nogit-'));
  try {
    write(root, { 'package.json': pkg() });
    const v = await versionsOf({ root, now: NOW });
    assert.equal(v.code.version, '1.2.0');
    assert.equal(v.tag, null);
    assert.equal(v.next, null);
  } finally { gone(root); }
});

test('an empty folder gives an empty answer, not an exception', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-versions-empty-'));
  try {
    const v = await versionsOf({ root, now: NOW });
    assert.equal(v.code, null);
    assert.equal(v.tag, null);
    assert.deepEqual(v.pieces, []);
    assert.equal(v.next, null);
  } finally { gone(root); }
});

test('the session-map itself: package.json and its latest release tag agree', async () => {
  const root = join(import.meta.dirname, '..');
  const v = await versionsOf({ root, now: NOW });
  const mine = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.equal(v.code.version, mine);
  assert.match(v.tag, /^v\d+\.\d+\.\d+$/);
  assert.ok(['equal', 'ahead'].includes(v.relation), `relation was ${v.relation}`);
});

// ---------- versions-git ----------
test('lastTag takes the newest version-like tag, ignores other names, and breaks a tie by the higher number', async () => {
  const root = repo({ 'a.txt': 'a' });
  try {
    tag(root, 'v1.0.0');
    commit(root, 'feat: x');
    tag(root, 'latest');
    tag(root, 'v1.1.0');
    tag(root, 'v1.2.0');
    assert.equal(await lastTag(root), 'v1.2.0');
  } finally { gone(root); }
});

test('lastTag only looks at tags reachable from HEAD and is null with no tags or no repository', async () => {
  const root = repo({ 'a.txt': 'a' });
  const plain = mkdtempSync(join(tmpdir(), 'sm-versions-plain-'));
  try {
    assert.equal(await lastTag(root), null);
    assert.equal(await lastTag(plain), null);
    git(root, ['checkout', '-q', '-b', 'side']);
    commit(root, 'feat: side');
    tag(root, 'v9.0.0');
    git(root, ['checkout', '-q', 'main']);
    assert.equal(await lastTag(root), null);
  } finally {
    gone(root);
    gone(plain);
  }
});

test('commitsSince lists subject and body of what came after the tag, newest first, capped', async () => {
  const root = repo({ 'a.txt': 'a' });
  try {
    tag(root, 'v1.0.0');
    commit(root, 'fix: one', 'because of two');
    commit(root, 'feat: two');
    const all = await commitsSince(root, 'v1.0.0');
    assert.deepEqual(all.map((c) => c.subject), ['feat: two', 'fix: one']);
    assert.match(all[1].body, /because of two/);
    assert.match(all[0].hash, /^[0-9a-f]{7,}$/);
    assert.equal((await commitsSince(root, 'v1.0.0', 1)).length, 1);
    assert.deepEqual(await commitsSince(root, 'nope'), []);
    assert.deepEqual(await commitsSince(root, '--all'), [], 'a tag name never becomes an option');
  } finally { gone(root); }
});
