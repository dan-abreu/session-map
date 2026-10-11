import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS } from '../server/foundation/health-checks/hygiene-tools.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const pkg = (obj) => JSON.stringify(obj, null, 2);
const STATES = ['pass', 'fail', 'unverified', 'na'];
const run = (id, files, over) => CHECKS[id](fakeHealthCtx({ files, ...over }));
const failedDirs = (r) => (r.packages ?? []).map((p) => p.dir);

const MONO = {
  'package.json': pkg({ name: 'acme', private: true, workspaces: ['apps/*'], scripts: { test: 'turbo run test' } }),
  'turbo.json': pkg({ tasks: { test: {}, build: {} } }),
  'apps/web/package.json': pkg({ name: 'web', scripts: {} }),
  'apps/web/src/index.ts': 'export const a = 1;\n',
  'apps/api/package.json': pkg({ name: 'api', scripts: {} }),
  'apps/api/src/index.ts': 'export const b = 2;\n',
};
const BARE_ROOT = pkg({ name: 'acme', private: true, workspaces: ['apps/*'] });

test('the items of this file are exactly the nine hygiene tool items, each with a function', () => {
  const ids = Object.keys(CHECKS).sort();
  assert.deepEqual(ids, ['hygiene.build', 'hygiene.ci', 'hygiene.commitlint', 'hygiene.coverage', 'hygiene.formatter', 'hygiene.hooks', 'hygiene.lint', 'hygiene.tests', 'hygiene.typecheck']);
  const catalog = new Set(HEALTH_ITEMS.map((i) => i.id));
  for (const id of ids) assert.ok(catalog.has(id), id);
  assert.ok(Object.isFrozen(CHECKS));
});

test('every check answers with one of the four states and an evidence list, and survives broken input', () => {
  const broken = { 'package.json': '{ not json', 'src/a.ts': 'x', 'apps/z/package.json': '[]' };
  for (const id of Object.keys(CHECKS)) {
    const r = run(id, broken);
    assert.ok(STATES.includes(r.state), id);
    assert.ok(Array.isArray(r.evidence), id);
    assert.ok(!r.detail || typeof r.detail === 'object', id);
  }
});

test('without code every check is na/no-code', () => {
  for (const id of Object.keys(CHECKS)) {
    const r = run(id, { 'README.md': '# x\n' });
    assert.equal(r.state, 'na', id);
    assert.equal(r.reason, 'no-code', id);
  }
});

// ---- hygiene.tests ----

test('tests: a monorepo whose root orchestrates (turbo.json and a root test script) passes', () => {
  const r = run('hygiene.tests', MONO);
  assert.equal(r.state, 'pass');
  assert.equal(r.evidence[0].file, 'package.json');
});

test('tests: turbo.json alone, with no root script and no test in the packages, is not orchestration', () => {
  const r = run('hygiene.tests', { ...MONO, 'package.json': BARE_ROOT });
  assert.equal(r.state, 'fail');
  assert.deepEqual(failedDirs(r).sort(), ['apps/api', 'apps/web']);
});

test('tests: no orchestrator and apps/web without a test script fails and names the package', () => {
  const files = {
    ...MONO,
    'package.json': BARE_ROOT,
    'apps/api/package.json': pkg({ name: 'api', scripts: { test: 'node --test' } }),
  };
  delete files['turbo.json'];
  const r = run('hygiene.tests', files);
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
  assert.deepEqual(r.packages, [{ dir: 'apps/web', state: 'fail' }]);
});

test('tests: the npm placeholder script is not a test', () => {
  const files = { 'package.json': pkg({ name: 'x', scripts: { test: 'echo "Error: no test specified" && exit 1' } }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.tests', files).state, 'fail');
});

test('tests: a test folder plus a runner dependency passes even without a script', () => {
  const files = {
    'package.json': pkg({ name: 'x', devDependencies: { vitest: '^2.0.0' } }),
    'src/a.js': 'x', 'test/a.test.js': 'x',
  };
  assert.equal(run('hygiene.tests', files).state, 'pass');
  assert.equal(run('hygiene.tests', { ...files, 'package.json': pkg({ name: 'x' }) }).state, 'fail');
});

test('tests: Flutter with test/ is recognised, without it fails on the package', () => {
  const base = {
    'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n',
    'lib/main.dart': 'void main() {}\n', 'analysis_options.yaml': 'include: package:flutter_lints/flutter.yaml\n',
  };
  assert.equal(run('hygiene.tests', { ...base, 'test/widget_test.dart': 'void main() {}\n' }).state, 'pass');
  const r = run('hygiene.tests', base);
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.packages, [{ dir: '', state: 'fail' }]);
});

test('tests: Laravel is recognised by phpunit.xml', () => {
  const base = { 'composer.json': pkg({ name: 'acme/app', require: {} }), 'app/Http/Kernel.php': '<?php\n' };
  assert.equal(run('hygiene.tests', { ...base, 'phpunit.xml': '<phpunit/>' }).state, 'pass');
  assert.equal(run('hygiene.tests', base).state, 'fail');
});

test('tests: in a Flutter plus Laravel repo each gap points at the right package', () => {
  const files = {
    'apps/customer/pubspec.yaml': 'name: customer\ndependencies:\n  flutter:\n    sdk: flutter\n',
    'apps/customer/lib/main.dart': 'void main() {}\n',
    'apps/customer/test/a_test.dart': 'void main() {}\n',
    'backend/composer.json': pkg({ name: 'acme/backend' }),
    'backend/app/A.php': '<?php\n',
  };
  const r = run('hygiene.tests', files);
  assert.equal(r.state, 'fail');
  assert.deepEqual(failedDirs(r), ['backend']);
  assert.equal(run('hygiene.tests', { ...files, 'backend/phpunit.xml.dist': '<phpunit/>' }).state, 'pass');
});

// ---- hygiene.lint ----

test('lint: a root ESLint config covers every package, a script covers its own package', () => {
  const files = { ...MONO, 'package.json': BARE_ROOT };
  assert.equal(run('hygiene.lint', { ...files, 'eslint.config.mjs': 'export default [];\n' }).state, 'pass');
  const r = run('hygiene.lint', {
    ...files,
    'apps/api/package.json': pkg({ name: 'api', scripts: { lint: 'biome check' } }),
  });
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.packages, [{ dir: 'apps/web', state: 'fail' }]);
});

test('lint: Dart by analysis_options.yaml, PHP by phpcs or phpstan', () => {
  const dart = { 'pubspec.yaml': 'name: a\n', 'lib/a.dart': 'x' };
  assert.equal(run('hygiene.lint', dart).state, 'fail');
  assert.equal(run('hygiene.lint', { ...dart, 'analysis_options.yaml': 'include: x\n' }).state, 'pass');
  const php = { 'composer.json': pkg({ name: 'a/b' }), 'src/A.php': '<?php\n' };
  assert.equal(run('hygiene.lint', php).state, 'fail');
  assert.equal(run('hygiene.lint', { ...php, 'phpstan.neon': 'parameters:\n' }).state, 'pass');
});

test('lint: an eslintConfig field in package.json counts', () => {
  const files = { 'package.json': pkg({ name: 'x', eslintConfig: { root: true } }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.lint', files).state, 'pass');
});

// ---- hygiene.formatter ----

test('formatter: prettier or biome config, a prettier field, pint for Laravel', () => {
  const js = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.formatter', js).state, 'fail');
  assert.equal(run('hygiene.formatter', { ...js, '.prettierrc': '{}' }).state, 'pass');
  assert.equal(run('hygiene.formatter', { ...js, 'biome.json': '{}' }).state, 'pass');
  assert.equal(run('hygiene.formatter', { ...js, 'package.json': pkg({ name: 'x', prettier: { semi: false } }) }).state, 'pass');
  const laravel = { 'composer.json': pkg({ name: 'a/b' }), 'app/A.php': '<?php\n', 'pint.json': '{}' };
  assert.equal(run('hygiene.formatter', laravel).state, 'pass');
});

test('formatter: Dart passes when analysis_options sets a formatter or CI runs dart format', () => {
  const dart = { 'pubspec.yaml': 'name: a\n', 'lib/a.dart': 'x' };
  assert.equal(run('hygiene.formatter', dart).state, 'fail');
  assert.equal(run('hygiene.formatter', { ...dart, 'analysis_options.yaml': 'formatter:\n  page_width: 100\n' }).state, 'pass');
  const ci = 'jobs:\n  a:\n    steps:\n      - run: dart format --set-exit-if-changed .\n';
  assert.equal(run('hygiene.formatter', { ...dart, '.github/workflows/ci.yml': ci }).state, 'pass');
});

// ---- hygiene.typecheck ----

test('typecheck: a tsconfig without strict fails, with strict passes (comments tolerated)', () => {
  const ts = (cfg) => ({ 'package.json': pkg({ name: 'x' }), 'src/a.ts': 'x', 'tsconfig.json': cfg });
  const weak = run('hygiene.typecheck', ts('{ "compilerOptions": { "target": "es2022" } }'));
  assert.equal(weak.state, 'fail');
  assert.equal(weak.evidence[0].file, 'tsconfig.json');
  assert.equal(run('hygiene.typecheck', ts('{\n // strict on\n "compilerOptions": { "strict": true, },\n}')).state, 'pass');
  assert.equal(run('hygiene.typecheck', ts('{ "compilerOptions": { "strict": false } }')).state, 'fail');
});

test('typecheck: strict inherited through a relative extends', () => {
  const files = {
    'package.json': BARE_ROOT,
    'tsconfig.base.json': '{ "compilerOptions": { "strict": true } }',
    'apps/web/package.json': pkg({ name: 'web' }), 'apps/web/src/a.ts': 'x',
    'apps/web/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
  };
  assert.equal(run('hygiene.typecheck', files).state, 'pass');
});

test('typecheck: an extends the census cannot resolve is unverified, not a failure', () => {
  const files = {
    'package.json': pkg({ name: 'x' }), 'src/a.ts': 'x',
    'tsconfig.json': '{ "extends": "@vendor/config/base.json" }',
  };
  const r = run('hygiene.typecheck', files);
  assert.equal(r.state, 'unverified');
  assert.equal(r.reason, 'no-data');
});

test('typecheck: a tsc or typecheck script passes, plain JS without any check fails', () => {
  assert.equal(run('hygiene.typecheck', { 'package.json': pkg({ name: 'x', scripts: { typecheck: 'tsc --noEmit' } }), 'src/a.ts': 'x' }).state, 'pass');
  assert.equal(run('hygiene.typecheck', { 'package.json': pkg({ name: 'x', scripts: { check: 'vue-tsc --noEmit' } }), 'src/a.ts': 'x' }).state, 'pass');
  assert.equal(run('hygiene.typecheck', { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' }).state, 'fail');
  const checkJs = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x', 'jsconfig.json': '{ "compilerOptions": { "checkJs": true } }' };
  assert.equal(run('hygiene.typecheck', checkJs).state, 'pass');
});

test('typecheck: Dart needs analysis_options.yaml, PHP needs phpstan or psalm', () => {
  const dart = { 'pubspec.yaml': 'name: a\n', 'lib/a.dart': 'x' };
  assert.equal(run('hygiene.typecheck', dart).state, 'fail');
  assert.equal(run('hygiene.typecheck', { ...dart, 'analysis_options.yaml': 'include: x\n' }).state, 'pass');
  const php = { 'composer.json': pkg({ name: 'a/b', 'require-dev': { 'larastan/larastan': '^2' } }), 'src/A.php': '<?php\n' };
  assert.equal(run('hygiene.typecheck', php).state, 'pass');
});

// ---- hygiene.build ----

const WF = (steps) => ({ '.github/workflows/ci.yml': `name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}` });

test('build: a CI without a build step fails, with one passes', () => {
  const code = { 'package.json': pkg({ name: 'x', scripts: { build: 'tsc' } }), 'src/a.ts': 'x' };
  const noBuild = run('hygiene.build', { ...code, ...WF('      - run: npm test\n') });
  assert.equal(noBuild.state, 'fail');
  assert.equal(noBuild.reason, 'missing');
  assert.equal(noBuild.detail.ci, false);
  assert.equal(run('hygiene.build', { ...code, ...WF('      - run: npm test\n      - run: npm run build\n') }).state, 'pass');
  assert.equal(run('hygiene.build', { ...code, ...WF('      - run: |\n          npm ci\n          pnpm build\n') }).state, 'pass');
});

test('build: a build job name or step label alone is not a build step', () => {
  const code = { 'package.json': pkg({ name: 'x', scripts: { build: 'tsc' } }), 'src/a.ts': 'x' };
  const r = run('hygiene.build', { ...code, '.github/workflows/ci.yml': 'jobs:\n  build:\n    steps:\n      - name: Build it\n        run: npm test\n' });
  assert.equal(r.state, 'fail');
});

test('build: no CI at all fails; the package script is needed too', () => {
  const code = { 'package.json': pkg({ name: 'x', scripts: { build: 'tsc' } }), 'src/a.ts': 'x' };
  assert.equal(run('hygiene.build', code).state, 'fail');
  const noScript = run('hygiene.build', { 'package.json': pkg({ name: 'x' }), 'src/a.ts': 'x', ...WF('      - run: npm run build\n') });
  assert.equal(noScript.state, 'fail');
  assert.deepEqual(noScript.packages, [{ dir: '', state: 'fail' }]);
});

test('build: flutter build in a Codemagic file counts, root orchestration covers packages', () => {
  const dart = { 'pubspec.yaml': 'name: a\n', 'lib/a.dart': 'x' };
  const cm = 'workflows:\n  w:\n    scripts:\n      - name: build\n        script: flutter build apk\n';
  assert.equal(run('hygiene.build', { ...dart, 'codemagic.yaml': cm }).state, 'pass');
  const root = pkg({ name: 'acme', workspaces: ['apps/*'], scripts: { build: 'turbo run build' } });
  assert.equal(run('hygiene.build', { ...MONO, ...WF('      - run: turbo run build\n'), 'package.json': root }).state, 'pass');
  assert.equal(run('hygiene.build', { ...dart, '.gitlab-ci.yml': 'build:\n  script:\n    - echo hi\n' }).state, 'fail');
});

// ---- hygiene.ci ----

test('ci: workflows, GitLab, Codemagic and others count; none fails', () => {
  const code = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' };
  const r = run('hygiene.ci', { ...code, ...WF('      - run: ls\n') });
  assert.equal(r.state, 'pass');
  assert.equal(r.evidence[0].file, '.github/workflows/ci.yml');
  assert.equal(run('hygiene.ci', { ...code, '.gitlab-ci.yml': 'a: 1' }).state, 'pass');
  assert.equal(run('hygiene.ci', { ...code, 'codemagic.yaml': 'a: 1' }).state, 'pass');
  assert.equal(run('hygiene.ci', { ...code, '.circleci/config.yml': 'a: 1' }).state, 'pass');
  const none = run('hygiene.ci', code);
  assert.equal(none.state, 'fail');
  assert.equal(none.reason, 'missing');
});

// ---- hygiene.coverage ----

test('coverage: c8, nyc, --coverage in a script or in CI, a config key; none fails', () => {
  const code = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.coverage', code).state, 'fail');
  assert.equal(run('hygiene.coverage', { ...code, 'package.json': pkg({ name: 'x', scripts: { cov: 'c8 node --test' } }) }).state, 'pass');
  assert.equal(run('hygiene.coverage', { ...code, 'package.json': pkg({ name: 'x', scripts: { test: 'vitest run --coverage' } }) }).state, 'pass');
  assert.equal(run('hygiene.coverage', { ...code, ...WF('      - run: flutter test --coverage\n') }).state, 'pass');
  assert.equal(run('hygiene.coverage', { ...code, 'vitest.config.ts': 'export default { test: { coverage: { provider: "v8" } } }' }).state, 'pass');
  assert.equal(run('hygiene.coverage', { ...code, '.nycrc.json': '{}' }).state, 'pass');
  assert.equal(run('hygiene.coverage', { ...code, 'codecov.yml': 'a: 1' }).state, 'pass');
});

// ---- hygiene.hooks ----

test('hooks: husky, lefthook, pre-commit, lint-staged; none fails', () => {
  const code = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.hooks', code).state, 'fail');
  assert.equal(run('hygiene.hooks', { ...code, '.husky/pre-commit': 'npx lint-staged' }).state, 'pass');
  assert.equal(run('hygiene.hooks', { ...code, 'lefthook.yml': 'a: 1' }).state, 'pass');
  assert.equal(run('hygiene.hooks', { ...code, '.pre-commit-config.yaml': 'repos: []' }).state, 'pass');
  assert.equal(run('hygiene.hooks', { ...code, 'package.json': pkg({ name: 'x', 'lint-staged': { '*.js': 'eslint' } }) }).state, 'pass');
  assert.equal(run('hygiene.hooks', { ...code, 'package.json': pkg({ name: 'x', scripts: { prepare: 'git config core.hooksPath .githooks' } }) }).state, 'pass');
});

// ---- hygiene.commitlint ----

test('commitlint: a config file or a package.json field; none fails', () => {
  const code = { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x' };
  assert.equal(run('hygiene.commitlint', code).state, 'fail');
  assert.equal(run('hygiene.commitlint', { ...code, 'commitlint.config.js': 'export default {}' }).state, 'pass');
  assert.equal(run('hygiene.commitlint', { ...code, '.commitlintrc.json': '{}' }).state, 'pass');
  assert.equal(run('hygiene.commitlint', { ...code, 'package.json': pkg({ name: 'x', commitlint: { extends: ['x'] } }) }).state, 'pass');
});

// ---- evidence and safety ----

test('evidence of a script points at the line of the manifest', () => {
  const text = pkg({ name: 'x', scripts: { build: 'tsc', test: 'node --test' } });
  const r = run('hygiene.tests', { 'package.json': text, 'src/a.js': 'x' });
  const line = text.split('\n').findIndex((l) => l.includes('"test"')) + 1;
  assert.deepEqual(r.evidence[0], { file: 'package.json', line });
});

test('a .env file is never opened by any of these checks', () => {
  const reads = [];
  const ctx = fakeHealthCtx({ files: { 'package.json': pkg({ name: 'x' }), 'src/a.js': 'x', '.env': 'SECRET=1' } });
  const read = ctx.read;
  ctx.read = (p) => { reads.push(p); return read(p); };
  for (const id of Object.keys(CHECKS)) CHECKS[id](ctx);
  assert.ok(!reads.some((p) => p.includes('.env')));
});

// ---- the CI reader ----

test('commandLines: inline, block and list commands with their lines; labels and sibling keys are not commands', async () => {
  const { commandLines } = await import('../server/foundation/health-checks/hygiene-tools.mjs');
  const text = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - name: Build it',
    '        run: |',
    '          npm ci',
    '          # a comment',
    '          npm run build',
    '        env:',
    '          NODE_ENV: production',
    '      - uses: actions/checkout@v4',
    '      - run: npm test',
    'other:',
    '  script:',
    '    - name: label',
    '    - flutter build apk',
  ].join('\n');
  const cmds = commandLines(text, 'ci.yml').map((c) => [c.line, c.cmd]);
  assert.deepEqual(cmds, [
    [6, 'npm ci'], [8, 'npm run build'], [11, 'uses actions/checkout@v4'], [12, 'npm test'], [16, 'flutter build apk'],
  ]);
});
