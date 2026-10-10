import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';
import { readTextOf, scanManifests, stacksOf, depsOf, typesOf, versionOf } from '../server/foundation/profile-stacks.mjs';

// A hand-made census and a map of file texts: the manifests are read through the injected readText, like the real one.
const censusFor = (paths) => ({ files: paths.map((path) => ({ path, included: true, sha: 'abc123', kind: 'code' })) });
const readerFor = (files) => {
  const reads = [];
  return { reads, readText: (p) => { reads.push(p); return files[p] ?? null; } };
};
const pkgJson = (o) => JSON.stringify(o, null, 2) + '\n';

// ---------- versionOf ----------

test('versionOf: the version as written in the manifest, without the operator', () => {
  assert.equal(versionOf('^16.0.1'), '16.0.1');
  assert.equal(versionOf('~5.1'), '5.1');
  assert.equal(versionOf('>=3.0.0 <4.0.0'), '3.0.0');
  assert.equal(versionOf('==5.0.1'), '5.0.1');
  assert.equal(versionOf('v20.11.0'), '20.11.0');
  assert.equal(versionOf('16.0.1-canary.3'), '16.0.1-canary.3');
  assert.equal(versionOf('>=4.2,<5'), '4.2');
  assert.equal(versionOf('^8.2 || ^8.3'), '8.2');
});

test('versionOf: a spec that is not a version gives null, never a guess', () => {
  for (const spec of ['*', 'latest', 'workspace:*', 'workspace:^1.0.0', 'file:../x', 'git+https://example.com/a.git', 'npm:other@1', 'any', '', null, undefined, 5]) {
    assert.equal(versionOf(spec), null, String(spec));
  }
});

// ---------- stacksOf: package.json ----------

test('stacksOf: ^16.0.1 becomes 16.0.1 and the line is the dependency line in the manifest', () => {
  const text = pkgJson({ name: 'web', version: '0.1.0', dependencies: { next: '^16.0.1', react: '^19.0.0' } });
  const lines = text.split('\n');
  const { readText } = readerFor({ 'apps/web/package.json': text });
  const stacks = stacksOf({ census: censusFor(['apps/web/package.json']), readText });
  const next = stacks.find((s) => s.name === 'next');
  assert.deepEqual(next, { name: 'next', version: '16.0.1', file: 'apps/web/package.json', line: lines.findIndex((l) => l.includes('"next"')) + 1 });
  assert.match(lines[next.line - 1], /"next": "\^16\.0\.1"/);
  assert.ok(stacks.some((s) => s.name === 'react' && s.version === '19.0.0'));
});

test('stacksOf: a package that is not in the table of known stacks is not a stack', () => {
  const text = pkgJson({ name: 'a', dependencies: { 'left-pad': '^1.0.0', next: '15.0.0' } });
  const stacks = stacksOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  assert.deepEqual(stacks.map((s) => s.name), ['next']);
});

test('stacksOf: devDependencies count, and the line points into that section', () => {
  const text = pkgJson({ name: 'a', dependencies: { zod: '^3.0.0' }, devDependencies: { typescript: '~5.6.2' } });
  const [ts] = stacksOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  assert.equal(ts.name, 'typescript');
  assert.equal(ts.version, '5.6.2');
  assert.match(text.split('\n')[ts.line - 1], /"typescript"/);
});

test('stacksOf: the same name in dependencies and devDependencies points at the right section line', () => {
  const text = pkgJson({ name: 'a', dependencies: { zod: '1.0.0' }, devDependencies: { zod: '2.0.0', next: '16.0.0' }, peerDependencies: { next: '^15.0.0' } });
  const deps = depsOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  const lines = text.split('\n');
  const dev = deps.find((d) => d.name === 'zod' && d.dev);
  assert.match(lines[dev.line - 1], /"zod": "2\.0\.0"/);
  const prod = deps.find((d) => d.name === 'zod' && !d.dev);
  assert.match(lines[prod.line - 1], /"zod": "1\.0\.0"/);
});

test('stacksOf: the same stack with the same version in two packages is one entry; another version is another', () => {
  const a = pkgJson({ name: 'a', dependencies: { next: '^16.0.1' } });
  const b = pkgJson({ name: 'b', dependencies: { next: '^16.0.1' } });
  const c = pkgJson({ name: 'c', dependencies: { next: '^14.2.0' } });
  const stacks = stacksOf({
    census: censusFor(['apps/b/package.json', 'apps/a/package.json', 'apps/c/package.json']),
    readText: readerFor({ 'apps/a/package.json': a, 'apps/b/package.json': b, 'apps/c/package.json': c }).readText,
  });
  const nexts = stacks.filter((s) => s.name === 'next');
  assert.deepEqual(nexts.map((s) => `${s.version}@${s.file}`), ['14.2.0@apps/c/package.json', '16.0.1@apps/a/package.json']);
});

test('stacksOf: a dependency with a spec that is no version keeps the stack with version null', () => {
  const text = pkgJson({ name: 'a', dependencies: { fastify: 'workspace:*' } });
  const [f] = stacksOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  assert.equal(f.name, 'fastify');
  assert.equal(f.version, null);
});

test('stacksOf: a manifest that is not valid JSON is skipped and the rest still reads', () => {
  const ok = pkgJson({ name: 'a', dependencies: { next: '15.1.0' } });
  const stacks = stacksOf({ census: censusFor(['bad/package.json', 'ok/package.json']), readText: readerFor({ 'bad/package.json': '{ nope', 'ok/package.json': ok }).readText });
  assert.deepEqual(stacks.map((s) => s.name), ['next']);
});

test('stacksOf: a minified manifest still gives a line that exists', () => {
  const text = '{"name":"a","dependencies":{"next":"16.0.0"}}';
  const [n] = stacksOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  assert.equal(n.line, 1);
});

test('stacksOf: only included manifests are read, and a file that is not a manifest is never opened', () => {
  const { reads, readText } = readerFor({ 'package.json': pkgJson({ name: 'a' }), 'src/a.ts': 'x', 'node_modules/x/package.json': pkgJson({ name: 'x', dependencies: { next: '1.0.0' } }) });
  const census = { files: [
    { path: 'package.json', included: true, sha: 'a' },
    { path: 'src/a.ts', included: true, sha: 'b' },
    { path: 'node_modules/x/package.json', included: false, reason: 'dep', sha: null },
  ] };
  const stacks = stacksOf({ census, readText });
  assert.deepEqual(stacks, []);
  assert.deepEqual(reads, ['package.json']);
});

// ---------- stacksOf: other ecosystems ----------

test('stacksOf: pubspec.yaml gives flutter (version from environment when written) and dart, with their lines', () => {
  const text = [
    'name: acme_app', 'environment:', '  sdk: ">=3.0.0 <4.0.0"', '  flutter: ">=3.19.0"', 'dependencies:', '  flutter:', '    sdk: flutter',
    '  go_router: ^14.0.0', '  flutter_riverpod: ^2.5.1 # state', 'dev_dependencies:', '  flutter_test:', '    sdk: flutter', '',
  ].join('\n');
  const lines = text.split('\n');
  const stacks = stacksOf({ census: censusFor(['app/pubspec.yaml']), readText: readerFor({ 'app/pubspec.yaml': text }).readText });
  const by = Object.fromEntries(stacks.map((s) => [s.name, s]));
  assert.equal(by.flutter.version, '3.19.0');
  assert.match(lines[by.flutter.line - 1], /flutter: ">=3\.19\.0"/);
  assert.equal(by.dart.version, '3.0.0');
  assert.match(lines[by.dart.line - 1], /sdk: ">=3\.0\.0/);
  assert.equal(by.riverpod.version, '2.5.1');
  assert.match(lines[by.riverpod.line - 1], /flutter_riverpod/);
});

test('stacksOf: a flutter dependency without a version in environment is flutter with version null at the dependency line', () => {
  const text = ['name: a', 'dependencies:', '  flutter:', '    sdk: flutter', ''].join('\n');
  const [f] = stacksOf({ census: censusFor(['pubspec.yaml']), readText: readerFor({ 'pubspec.yaml': text }).readText });
  assert.deepEqual(f, { name: 'flutter', version: null, file: 'pubspec.yaml', line: 3 });
});

test('stacksOf: composer.json gives laravel and php, ext-* is not a dependency', () => {
  const text = pkgJson({ name: 'acme/api', require: { php: '^8.2', 'laravel/framework': '^11.0', 'ext-json': '*' }, 'require-dev': { 'phpunit/phpunit': '^11.0' } });
  const lines = text.split('\n');
  const stacks = stacksOf({ census: censusFor(['backend/composer.json']), readText: readerFor({ 'backend/composer.json': text }).readText });
  const by = Object.fromEntries(stacks.map((s) => [s.name, s]));
  assert.equal(by.laravel.version, '11.0');
  assert.match(lines[by.laravel.line - 1], /laravel\/framework/);
  assert.equal(by.php.version, '8.2');
  assert.equal(stacks.length, 2);
});

test('stacksOf: requirements.txt gives python stacks with the pinned version and the line', () => {
  const text = ['# deps', 'Django==5.0.1', 'fastapi>=0.110,<1', 'requests', '-r other.txt', 'pandas[excel]~=2.2', ''].join('\n');
  const stacks = stacksOf({ census: censusFor(['requirements.txt']), readText: readerFor({ 'requirements.txt': text }).readText });
  const by = Object.fromEntries(stacks.map((s) => [s.name, s]));
  assert.deepEqual(by.django, { name: 'django', version: '5.0.1', file: 'requirements.txt', line: 2 });
  assert.equal(by.fastapi.version, '0.110');
  assert.equal(by.pandas.version, '2.2');
  assert.equal(by.pandas.line, 6);
  assert.equal(stacks.length, 3);
});

test('stacksOf: .nvmrc gives node with its version at line 1; lts/* gives null', () => {
  const one = stacksOf({ census: censusFor(['.nvmrc']), readText: readerFor({ '.nvmrc': 'v20.11.0\n' }).readText });
  assert.deepEqual(one, [{ name: 'node', version: '20.11.0', file: '.nvmrc', line: 1 }]);
  const lts = stacksOf({ census: censusFor(['.nvmrc']), readText: readerFor({ '.nvmrc': 'lts/*\n' }).readText });
  assert.deepEqual(lts, [{ name: 'node', version: null, file: '.nvmrc', line: 1 }]);
});

// ---------- depsOf ----------

test('depsOf: every dependency, known stack or not, with file, line and dev', () => {
  const text = pkgJson({ name: 'a', dependencies: { stripe: '^17.0.0', 'left-pad': '1.3.0' }, devDependencies: { vitest: '^2.0.0' } });
  const lines = text.split('\n');
  const deps = depsOf({ census: censusFor(['package.json']), readText: readerFor({ 'package.json': text }).readText });
  assert.deepEqual(deps.map((d) => d.name), ['left-pad', 'stripe', 'vitest']);
  const stripe = deps.find((d) => d.name === 'stripe');
  assert.equal(stripe.version, '17.0.0');
  assert.equal(stripe.dev, false);
  assert.equal(stripe.sha, 'abc123');
  assert.match(lines[stripe.line - 1], /"stripe"/);
  assert.equal(deps.find((d) => d.name === 'vitest').dev, true);
});

test('depsOf and stacksOf can share one scan, so the manifests are read once', () => {
  const text = pkgJson({ name: 'a', dependencies: { next: '16.0.0' } });
  const { reads, readText } = readerFor({ 'package.json': text });
  const census = censusFor(['package.json']);
  const scan = scanManifests({ census, readText });
  const noRead = () => { throw new Error('no read'); };
  assert.equal(stacksOf({ census, readText: noRead, scan })[0].name, 'next');
  assert.ok(depsOf({ census, readText: noRead, scan }).length >= 1);
  assert.deepEqual(reads, ['package.json']);
});

// ---------- the secret guard ----------

test('a .env in the census is never opened, even if the census says it is included', () => {
  const { reads, readText } = readerFor({ '.env': 'SECRET=1', 'package.json': pkgJson({ name: 'a' }) });
  const census = censusFor(['.env', 'package.json', 'apps/api/.env.local']);
  scanManifests({ census, readText });
  assert.ok(!reads.some((p) => /\.env/.test(p)), reads.join(','));
});

test('readTextOf: reads a file under the root, refuses .env, outside paths and missing files with null', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-profile-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"a"}');
    writeFileSync(join(root, '.env'), 'SECRET_TOKEN=do-not-read-42\n');
    writeFileSync(join(root, '.env.example'), 'A=\n');
    const read = readTextOf(root);
    assert.equal(read('package.json'), '{"name":"a"}');
    assert.equal(read('.env'), null);
    assert.equal(read('.env.production'), null);
    assert.equal(read('.env.example'), 'A=\n');
    assert.equal(read('../outside.txt'), null);
    assert.equal(read('missing.json'), null);
    assert.equal(read('/etc/passwd'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readTextOf: a link that leads out of the root is refused', (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'sm-profile-out-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-profile-in-'));
  try {
    writeFileSync(join(outer, 'secret.txt'), 'outside');
    try { symlinkSync(join(outer, 'secret.txt'), join(root, 'link.txt')); } catch { t.skip('cannot create symlinks here'); return; }
    assert.equal(readTextOf(root)('link.txt'), null);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outer, { recursive: true, force: true }); }
});

test('readTextOf: a file bigger than 1 MB is not read', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-profile-'));
  try {
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'big.json'), 'x'.repeat(1024 * 1024 + 1));
    assert.equal(readTextOf(root)('a/big.json'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------- typesOf ----------

const typesFrom = (files, { facts = [], paths = [] } = {}) => {
  const census = censusFor([...Object.keys(files), ...paths]);
  const scan = scanManifests({ census, readText: readerFor(files).readText });
  return typesOf({ census, facts, stacks: scan.stacks, deps: scan.deps, packages: scan.packages });
};

test('typesOf: a web framework is web', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', dependencies: { vue: '^3.4.0' } }) }), ['web']);
});

test('typesOf: react together with react-native is mobile, not web', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', dependencies: { react: '^18.0.0', 'react-native': '^0.74.0' } }) }), ['mobile']);
});

test('typesOf: a route fact makes it an api; a server framework without routes found makes it one too', () => {
  const route = { kind: 'route', id: 'route:GET /x', file: 'a.ts', line: 1 };
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a' }) }, { facts: [route] }), ['api']);
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', dependencies: { express: '^4.19.0' } }) }), ['api']);
});

test('typesOf: a blade view alone does not make a laravel backend web', () => {
  const screen = { kind: 'screen', id: 'screen:backend:receipt', file: 'r.blade.php', line: 1, attrs: { framework: 'blade' } };
  const composer = pkgJson({ name: 'acme/b', require: { 'laravel/framework': '^11.0' } });
  assert.deepEqual(typesFrom({ 'composer.json': composer }, { facts: [screen] }), ['api']);
});

test('typesOf: an index.html makes it web, unless the project is mobile (flutter web/ folder)', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a' }) }, { paths: ['public/index.html'] }), ['web']);
  const pubspec = ['name: a', 'dependencies:', '  flutter:', '    sdk: flutter', ''].join('\n');
  assert.deepEqual(typesFrom({ 'pubspec.yaml': pubspec }, { paths: ['web/index.html'] }), ['mobile']);
});

test('typesOf: a publishable package with an entry point and nothing else is a library; a private one is not', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'acme-slug', main: './src/index.js' }) }), ['library']);
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'acme-slug', private: true, main: './src/index.js' }) }), []);
  assert.deepEqual(typesFrom({ 'composer.json': pkgJson({ name: 'acme/lib', type: 'library' }) }), ['library']);
});

test('typesOf: an app that also has a main field is not a library', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', main: 'dist/index.js', dependencies: { fastify: '^5.0.0' } }) }), ['api']);
});

test('typesOf: bin or a CLI toolkit is cli', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', bin: { acme: './bin/acme.js' }, main: 'x.js' }) }), ['cli']);
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', dependencies: { commander: '^12.0.0' } }) }), ['cli']);
});

test('typesOf: a game engine or project file is game; a data stack or notebook is data', () => {
  assert.deepEqual(typesFrom({ 'package.json': pkgJson({ name: 'a', dependencies: { phaser: '^3.80.0' } }) }), ['game']);
  assert.deepEqual(typesFrom({}, { paths: ['project.godot'] }), ['game']);
  assert.deepEqual(typesFrom({ 'requirements.txt': 'pandas==2.2.0\n' }), ['data']);
  assert.deepEqual(typesFrom({}, { paths: ['notebooks/eda.ipynb'] }), ['data']);
});

test('typesOf: the output follows the contract order and has no repeats', () => {
  const files = { 'package.json': pkgJson({ name: 'a', dependencies: { next: '16.0.0', fastify: '5.0.0', commander: '12.0.0' } }) };
  assert.deepEqual(typesFrom(files), ['web', 'api', 'cli']);
});

test('typesOf: an empty project has no type (no guess)', () => {
  assert.deepEqual(typesFrom({}), []);
});

// ---------- the three invented repositories ----------

async function onFixture(name, fn) {
  const root = copyFixtureRepo(name);
  try {
    const census = await censusOf(root, null);
    const facts = extractAll(root, census, null, {}).facts;
    const readText = readTextOf(root);
    const scan = scanManifests({ census, readText });
    await fn({ root, census, facts, readText, scan });
  } finally { removeFixtureRepo(root); }
}

const fixtureTypes = ({ census, facts, scan }) => typesOf({ census, facts, stacks: scan.stacks, deps: scan.deps, packages: scan.packages });

test('acme-shop: web + api, with fastify 5.1.0 and next once, every line real', async () => {
  await onFixture('acme-shop', async (ctx) => {
    assert.deepEqual(fixtureTypes(ctx), ['web', 'api']);
    const stacks = stacksOf({ census: ctx.census, readText: ctx.readText, scan: ctx.scan });
    const fastify = stacks.find((s) => s.name === 'fastify');
    assert.equal(fastify.version, '5.1.0');
    assert.equal(fastify.file, 'apps/api/package.json');
    assert.equal(stacks.filter((s) => s.name === 'next').length, 1);
    assert.ok(stacks.some((s) => s.name === 'bullmq'));
    for (const s of stacks) {
      const lines = readFileSync(join(ctx.root, s.file), 'utf8').split('\n');
      assert.ok(s.line >= 1 && s.line <= lines.length, `${s.name} line ${s.line}`);
    }
  });
});

test('acme-delivery: mobile + api, with flutter, dart, laravel 11.0 and php 8.2', async () => {
  await onFixture('acme-delivery', async (ctx) => {
    assert.deepEqual([...fixtureTypes(ctx)].sort(), ['api', 'mobile']);
    const names = Object.fromEntries(ctx.scan.stacks.map((s) => [s.name, s]));
    assert.equal(names.laravel.version, '11.0');
    assert.equal(names.php.version, '8.2');
    assert.ok(names.flutter);
    assert.ok(names.dart);
  });
});

test('acme-lib: library', async () => {
  await onFixture('acme-lib', async (ctx) => {
    assert.deepEqual(fixtureTypes(ctx), ['library']);
  });
});

test('the output never carries an author name or an e-mail', async () => {
  await onFixture('acme-lib', async (ctx) => {
    const all = JSON.stringify({ stacks: ctx.scan.stacks, deps: ctx.scan.deps, packages: ctx.scan.packages, types: fixtureTypes(ctx) });
    assert.ok(!/Ana|@example\.com/.test(all), all);
  });
});
