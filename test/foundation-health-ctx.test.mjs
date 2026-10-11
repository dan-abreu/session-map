import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDoc, docStats } from '../server/foundation/health-find.mjs';
import { buildHealthCtx, makeHealthCtx, publicRemote, READ_MAX } from '../server/foundation/health-ctx.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { normalizePath } from '../server/paths.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// ---------- health-find: where a document lives ----------

test('a document is found in the root, .github and docs, but not in a subfolder', () => {
  const paths = ['README.md', '.github/SECURITY.md', 'docs/CONTRIBUTING.md', 'apps/web/CODE_OF_CONDUCT.md', 'src/a.js'];
  assert.equal(findDoc(paths, ['security']), '.github/SECURITY.md');
  assert.equal(findDoc(paths, ['contributing']), 'docs/CONTRIBUTING.md');
  assert.equal(findDoc(paths, ['readme']), 'README.md');
  assert.equal(findDoc(paths, ['code_of_conduct']), null);
});

test('case and extension do not matter: SECURITY.MD and security.txt are both found', () => {
  assert.equal(findDoc(['SECURITY.MD'], ['security']), 'SECURITY.MD');
  assert.equal(findDoc(['security.txt'], ['security']), 'security.txt');
  assert.equal(findDoc(['Security.rst'], ['SECURITY']), 'Security.rst');
});

test('the root wins over .github and .github over docs', () => {
  assert.equal(findDoc(['docs/SECURITY.md', '.github/SECURITY.md', 'SECURITY.md'], ['security']), 'SECURITY.md');
  assert.equal(findDoc(['docs/SECURITY.md', '.github/SECURITY.md'], ['security']), '.github/SECURITY.md');
});

test('dirs and exts narrow the search (FUNDING only in .github, LICENSE only at the root)', () => {
  assert.equal(findDoc(['FUNDING.yml'], ['funding'], { dirs: ['.github'], exts: ['.yml'] }), null);
  assert.equal(findDoc(['.github/FUNDING.yml'], ['funding'], { dirs: ['.github'], exts: ['.yml'] }), '.github/FUNDING.yml');
  assert.equal(findDoc(['docs/LICENSE'], ['license', 'copying'], { dirs: [''] }), null);
  assert.equal(findDoc(['COPYING'], ['license', 'copying'], { dirs: [''] }), 'COPYING');
});

test('a name that already has its extension is matched whole', () => {
  assert.equal(findDoc(['.github/pull_request_template.md'], ['pull_request_template.md']), '.github/pull_request_template.md');
});

// ---------- health-find: what a document holds ----------

test('stats count useful lines and titles', () => {
  const s = docStats('# Title\n\nSome text.\n\n## Part\n- one\n- two\n');
  assert.equal(s.lines, 5);
  assert.equal(s.titles, 2);
  assert.deepEqual(s.markers, []);
});

test('a # inside a code fence is not a title; setext titles count', () => {
  const s = docStats('Intro\n=====\n\n```sh\n# comment\n```\n\nSub\n---\n');
  assert.equal(s.titles, 2);
});

test('template markers are found with their line, real html tags are not', () => {
  const s = docStats('Report to <CONTACT EMAIL>.\n<br>\n<img src="x.png">\nSee [INSERT LINK]\nmail your-email@example.com\n');
  assert.deepEqual(s.markers.map((m) => m.line), [1, 4, 5]);
  assert.equal(s.markers[0].text, '<CONTACT EMAIL>');
});

test('a single-line html comment is not a useful line', () => {
  assert.equal(docStats('<!-- template -->\ntext\n').lines, 1);
});

test('empty and missing text give zeros', () => {
  assert.deepEqual(docStats(''), { lines: 0, titles: 0, markers: [] });
  assert.deepEqual(docStats(null), { lines: 0, titles: 0, markers: [] });
});

// ---------- health-ctx on files in memory ----------

test('read gives null for a secret file, a missing file and one over the limit', () => {
  const big = 'x'.repeat(READ_MAX + 1);
  const ctx = fakeHealthCtx({ files: { '.env': 'TOKEN=abc', 'README.md': 'hi', 'big.txt': big } });
  assert.equal(ctx.read('.env'), null);
  assert.equal(ctx.read('nope.md'), null);
  assert.equal(ctx.read('big.txt'), null);
  assert.equal(ctx.read('README.md'), 'hi');
});

test('read never even asks for a secret file', () => {
  const asked = [];
  const ctx = makeHealthCtx({
    rows: [{ path: '.env', included: false, kind: 'secret' }, { path: 'a.md', included: true, kind: 'doc' }],
    readText: (p) => { asked.push(p); return 'text'; },
  });
  assert.equal(ctx.read('.env'), null);
  assert.equal(ctx.read('.env.local'), null);
  assert.equal(ctx.read('config/.env'), null);
  ctx.read('a.md');
  assert.deepEqual(asked, ['a.md']);
});

test('read is cached', () => {
  let n = 0;
  const ctx = makeHealthCtx({ rows: [{ path: 'a.md', included: true, kind: 'doc' }], readText: () => { n++; return 'x'; } });
  ctx.read('a.md'); ctx.read('a.md');
  assert.equal(n, 1);
});

test('has, list and find work over the census rows', () => {
  const ctx = fakeHealthCtx({ files: { 'README.md': 'x', 'src/a.js': 'x', 'src/b.js': 'x', '.github/SECURITY.md': 'x' } });
  assert.equal(ctx.has('src/a.js'), true);
  assert.equal(ctx.has('src/z.js'), false);
  assert.deepEqual(ctx.list('src/'), ['src/a.js', 'src/b.js']);
  assert.equal(ctx.find(['security']), '.github/SECURITY.md');
  assert.equal(ctx.find(['security'], { dirs: [''] }), null);
});

test('a single package at the root is not a monorepo', () => {
  const ctx = fakeHealthCtx({ files: { 'package.json': JSON.stringify({ name: 'solo', scripts: { test: 'x' } }), 'src/a.js': 'x' } });
  assert.equal(ctx.isMonorepo, false);
  assert.deepEqual(ctx.packages.map((p) => [p.dir, p.name, p.kind]), [['', 'solo', 'node']]);
  assert.deepEqual(ctx.packages[0].scripts, { test: 'x' });
});

test('a monorepo lists the root and the workspace packages, node php and dart', () => {
  const ctx = fakeHealthCtx({ files: {
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
    'apps/web/package.json': JSON.stringify({ name: 'web', private: true }),
    'apps/api/package.json': JSON.stringify({ name: 'api' }),
    'backend/composer.json': JSON.stringify({ name: 'acme/backend', scripts: { test: 'phpunit' } }),
    'apps/mobile/pubspec.yaml': 'name: mobile\npublish_to: none\n',
  } });
  assert.equal(ctx.isMonorepo, true);
  const by = Object.fromEntries(ctx.packages.map((p) => [p.dir, p]));
  assert.deepEqual(Object.keys(by).sort(), ['', 'apps/api', 'apps/mobile', 'apps/web', 'backend']);
  assert.equal(by['apps/web'].private, true);
  assert.equal(by['apps/api'].private, false);
  assert.equal(by.backend.kind, 'php');
  assert.equal(by.backend.name, 'acme/backend');
  assert.equal(by['apps/mobile'].kind, 'dart');
  assert.equal(by['apps/mobile'].private, true);
  assert.equal(by.backend.manifest, 'backend/composer.json');
});

test('a manifest inside fixtures or examples is not a package of the project', () => {
  const ctx = fakeHealthCtx({ files: { 'package.json': '{"name":"root"}', 'test/fixtures/x/package.json': '{"name":"x"}', 'examples/a/package.json': '{"name":"a"}' } });
  assert.deepEqual(ctx.packages.map((p) => p.dir), ['']);
});

test('a broken manifest is skipped, not thrown', () => {
  const ctx = fakeHealthCtx({ files: { 'package.json': '{oops' } });
  assert.deepEqual(ctx.packages, []);
});

// ---------- visibility ----------

const REMOTE = { remote: 'https://github.com/ana/acme', tags: [], subjects: [], defaultBranch: 'main' };

test('visibility: the global config wins over the api, the api over the remote, no remote means private', () => {
  const a = fakeHealthCtx({ git: REMOTE, configVisibility: 'private', api: { visibility: 'public' } });
  assert.deepEqual([a.visibility, a.visibilitySource], ['private', 'config']);
  const b = fakeHealthCtx({ git: REMOTE, api: { visibility: 'public' } });
  assert.deepEqual([b.visibility, b.visibilitySource], ['public', 'api']);
  const c = fakeHealthCtx({ git: { ...REMOTE, remote: null } });
  assert.deepEqual([c.visibility, c.visibilitySource], ['private', 'no-remote']);
  const d = fakeHealthCtx({ git: REMOTE });
  assert.deepEqual([d.visibility, d.visibilitySource], ['unknown', null]);
});

test('visibility: garbage in the config is ignored', () => {
  assert.equal(fakeHealthCtx({ git: REMOTE, configVisibility: 'maybe' }).visibility, 'unknown');
});

// ---------- kinds ----------

test('kinds by heuristic: code, users (screens, pages, routes) and library (publishable, no screens)', () => {
  const code = fakeHealthCtx({ files: { 'src/a.js': 'x' } });
  assert.deepEqual([...code.kinds].sort(), ['code']);
  assert.equal(code.hasCode, true);
  const docsOnly = fakeHealthCtx({ files: { 'README.md': 'x' } });
  assert.equal(docsOnly.kinds.size, 0);
  assert.equal(docsOnly.hasCode, false);
  const next = fakeHealthCtx({ files: { 'app/page.tsx': 'x', 'package.json': '{"name":"web","private":true}' } });
  assert.equal(next.kinds.has('users'), true);
  const lib = fakeHealthCtx({ files: { 'src/index.js': 'x', 'package.json': '{"name":"slug","main":"./src/index.js"}' } });
  assert.equal(lib.kinds.has('library'), true);
  assert.equal(lib.kinds.has('users'), false);
});

test('a private app with a main field is not a library', () => {
  const ctx = fakeHealthCtx({ files: { 'src/index.js': 'x', 'package.json': '{"name":"x","private":true,"main":"a.js"}' } });
  assert.equal(ctx.kinds.has('library'), false);
});

test('the profile decides the kinds when it exists, and the owner wins over what was detected', () => {
  const files = { 'src/index.js': 'x', 'package.json': '{"name":"slug","main":"./src/index.js"}' };
  const detected = { detected: { types: ['library'], stacks: [], signals: [], team: {}, deploy: [] }, owner: {} };
  const a = fakeHealthCtx({ files, profile: detected });
  assert.equal(a.kinds.has('library'), true);
  const b = fakeHealthCtx({ files, profile: { ...detected, owner: { types: ['web'] } } });
  assert.equal(b.kinds.has('users'), true);
  assert.equal(b.kinds.has('library'), false);
  assert.equal(b.kinds.has('code'), true);
});

test('explicit kinds and visibility in the fake override the computation', () => {
  const ctx = fakeHealthCtx({ kinds: ['library'], visibility: 'private' });
  assert.deepEqual([...ctx.kinds], ['library']);
  assert.equal(ctx.visibility, 'private');
});

test('the fake passes api, versions and now through', () => {
  const api = { mode: 'none' };
  const ctx = fakeHealthCtx({ api, versions: { code: null }, now: '2026-10-10T00:00:00.000Z' });
  assert.equal(ctx.api, api);
  assert.deepEqual(ctx.versions, { code: null });
  assert.equal(ctx.now, '2026-10-10T00:00:00.000Z');
  assert.equal(fakeHealthCtx().api, null);
});

// ---------- the real thing, on a real repository ----------

function gitIn(root, args) {
  return execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=none', ...args],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 }).toString();
}

const tmp = (tag) => mkdtempSync(join(tmpdir(), `sm-hc-${tag}-`));
const clean = (...dirs) => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); };

test('on the monorepo fixture: packages, root docs, a .env that is never read', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = tmp('sm');
  try {
    const census = await censusOf(root, null, { owners: new Map() });
    const ctx = await buildHealthCtx({ root, census, smDir, id: 'acme-shop-1' });
    assert.equal(ctx.isMonorepo, true);
    assert.ok(ctx.packages.length >= 6, `packages: ${ctx.packages.map((p) => p.dir)}`);
    assert.ok(ctx.packages.some((p) => p.dir === ''));
    assert.ok(ctx.packages.some((p) => p.dir === 'apps/api'));
    assert.equal(ctx.find(['readme']), 'README.md');
    assert.equal(ctx.has('.env'), true);
    assert.equal(ctx.read('.env'), null);
    assert.equal(ctx.hasCode, true);
    assert.equal(ctx.kinds.has('users'), true);
    assert.equal(ctx.visibility, 'private');
    assert.equal(ctx.visibilitySource, 'no-remote');
    assert.equal(ctx.git.remote, null);
    assert.ok(ctx.git.subjects.length >= 1);
    assert.equal(ctx.git.defaultBranch, 'main');
  } finally { removeFixtureRepo(root); clean(smDir); }
});

test('on the library fixture: a library, not an app with users', async () => {
  const root = copyFixtureRepo('acme-lib');
  const smDir = tmp('sm');
  try {
    const census = await censusOf(root, null, { owners: new Map() });
    const ctx = await buildHealthCtx({ root, census, smDir, id: 'acme-lib-1' });
    assert.equal(ctx.kinds.has('library'), true);
    assert.equal(ctx.kinds.has('users'), false);
    assert.equal(ctx.isMonorepo, false);
  } finally { removeFixtureRepo(root); clean(smDir); }
});

test('git facts: remote without credentials, tags, subjects, default branch; visibility from the global config only', async () => {
  const root = tmp('git');
  const smDir = tmp('sm');
  try {
    gitIn(root, ['init', '-q', '-b', 'trunk']);
    writeFileSync(join(root, 'a.js'), 'x\n');
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'feat: first']);
    gitIn(root, ['tag', 'v0.1.0']);
    writeFileSync(join(root, 'b.js'), 'x\n');
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'fix: second']);
    gitIn(root, ['tag', 'v0.2.0']);
    gitIn(root, ['remote', 'add', 'origin', 'https://ana:ghp_notarealtoken@github.com/ana/acme.git']);
    const census = await censusOf(root, null, { owners: new Map() });
    const first = await buildHealthCtx({ root, census, smDir, id: 'x-1' });
    assert.equal(first.git.remote, 'https://github.com/ana/acme');
    assert.ok(!JSON.stringify(first.git).includes('ghp_'));
    assert.deepEqual(first.git.tags, ['v0.2.0', 'v0.1.0']);
    assert.deepEqual(first.git.subjects, ['fix: second', 'feat: first']);
    assert.equal(first.git.defaultBranch, 'trunk');
    assert.equal(first.visibility, 'unknown');
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projects: { [normalizePath(root)]: { visibility: 'public' } } }));
    const second = await buildHealthCtx({ root, census, smDir, id: 'x-1' });
    assert.deepEqual([second.visibility, second.visibilitySource], ['public', 'config']);
    // A repository's own file cannot claim to be private (a clone could say anything).
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify({ visibility: 'private' }));
    writeFileSync(join(smDir, 'config.json'), '{}');
    const third = await buildHealthCtx({ root, census, smDir, id: 'x-1' });
    assert.equal(third.visibility, 'unknown');
  } finally { clean(root, smDir); }
});

test('a folder that is not a repository still gives a context', async () => {
  const root = tmp('nogit');
  const smDir = tmp('sm');
  try {
    writeFileSync(join(root, 'README.md'), '# x\n');
    const ctx = await buildHealthCtx({ root, census: { files: [{ path: 'README.md', included: true, kind: 'doc' }] }, smDir, id: 'x-2' });
    assert.deepEqual(ctx.git.tags, []);
    assert.equal(ctx.git.remote, null);
    assert.equal(ctx.read('README.md'), '# x\n');
  } finally { clean(root, smDir); }
});

test('a file read from disk over the limit is null', async () => {
  const root = tmp('big');
  const smDir = tmp('sm');
  try {
    writeFileSync(join(root, 'big.md'), 'x'.repeat(READ_MAX + 1));
    writeFileSync(join(root, 'ok.md'), 'ok');
    const census = { files: [{ path: 'big.md', included: true, kind: 'doc' }, { path: 'ok.md', included: true, kind: 'doc' }] };
    const ctx = await buildHealthCtx({ root, census, smDir, id: 'x-3' });
    assert.equal(ctx.read('big.md'), null);
    assert.equal(ctx.read('ok.md'), 'ok');
  } finally { clean(root, smDir); }
});

test('a remote becomes a plain https link, without user or password, or null when it is not a server', () => {
  assert.equal(publicRemote('https://ana:tok@github.com/ana/acme.git'), 'https://github.com/ana/acme');
  assert.equal(publicRemote('git@github.com:ana/acme.git'), 'https://github.com/ana/acme');
  assert.equal(publicRemote('ssh://git@gitlab.example.org:2222/ana/acme.git'), 'https://gitlab.example.org:2222/ana/acme');
  assert.equal(publicRemote('https://github.com/ana/acme/'), 'https://github.com/ana/acme');
  assert.equal(publicRemote('C:/work/acme.git'), null);
  assert.equal(publicRemote('/srv/git/acme.git'), null);
  assert.equal(publicRemote('file:///srv/git/acme.git'), null);
  assert.equal(publicRemote('http://localhost/acme'), null);
  assert.equal(publicRemote(''), null);
});
