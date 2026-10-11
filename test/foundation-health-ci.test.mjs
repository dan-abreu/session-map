import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_CI_CHECKS as CHECKS, SECURITY_CI_IDS } from '../server/foundation/health-checks/security-ci.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const STATES = new Set(['pass', 'fail', 'unverified', 'na']);
const WF = '.github/workflows/ci.yml';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const code = { 'src/index.js': 'export const a = 1;\n' };
const wf = (body, name = WF) => fakeHealthCtx({ files: { ...code, [name]: body } });
const run = (id, ctx) => CHECKS[id](ctx);

const SAFE = `name: ci
on:
  pull_request:
  push:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v4
      - run: npm test
`;

test('the seven ids are exactly the security-ci items of the catalog', () => {
  assert.deepEqual(SECURITY_CI_IDS, [
    'security.workflows_safe', 'security.token_permissions', 'security.actions_pinned', 'security.update_bot',
    'security.sast', 'security.sbom', 'security.fuzzing',
  ]);
  for (const id of SECURITY_CI_IDS) {
    assert.equal(typeof CHECKS[id], 'function', id);
    assert.ok(HEALTH_ITEMS.some((i) => i.id === id), `${id} is in the catalog`);
  }
  assert.equal(Object.keys(CHECKS).length, 7);
});

test('every check answers with one of the four states and the full shape', () => {
  const ctxs = [wf(SAFE), fakeHealthCtx({ files: {} }), fakeHealthCtx({ files: code })];
  for (const ctx of ctxs) {
    for (const id of SECURITY_CI_IDS) {
      const r = run(id, ctx);
      assert.ok(STATES.has(r.state), `${id} -> ${r.state}`);
      assert.ok(Array.isArray(r.evidence), id);
      assert.ok('reason' in r && 'detail' in r, id);
    }
  }
});

// ---------- workflows_safe ----------

test('workflows_safe: a plain workflow passes', () => {
  const r = run('security.workflows_safe', wf(SAFE));
  assert.equal(r.state, 'pass');
  assert.equal(r.reason, null);
});

test('workflows_safe: pull_request_target that checks out the PR head fails with file and line', () => {
  const body = `on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm ci
`;
  const r = run('security.workflows_safe', wf(body));
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'unsafe');
  assert.deepEqual(r.evidence, [{ file: WF, line: 10 }]);
});

test('workflows_safe: pull_request_target with a checkout of the base is fine, and so is the PR head under plain pull_request', () => {
  const target = `on: pull_request_target
jobs:
  label:
    steps:
      - uses: actions/checkout@v4
      - run: echo hi
`;
  assert.equal(run('security.workflows_safe', wf(target)).state, 'pass');
  const plain = `on: pull_request
jobs:
  b:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`;
  assert.equal(run('security.workflows_safe', wf(plain)).state, 'pass');
});

test('workflows_safe: pull_request_target in an inline trigger list is seen too', () => {
  const body = `on: [push, pull_request_target]
jobs:
  b:
    steps:
      - uses: actions/checkout@v4
        with:
          repository: \${{ github.event.pull_request.head.repo.full_name }}
`;
  assert.equal(run('security.workflows_safe', wf(body)).state, 'fail');
});

test('workflows_safe: a github.event text inside run: fails, on one line or in a block', () => {
  const one = `on: pull_request
jobs:
  b:
    steps:
      - run: echo "\${{ github.event.pull_request.title }}"
`;
  const r1 = run('security.workflows_safe', wf(one));
  assert.equal(r1.state, 'fail');
  assert.deepEqual(r1.evidence, [{ file: WF, line: 5 }]);
  const block = `on: issues
jobs:
  b:
    steps:
      - name: x
        run: |
          echo start
          echo "\${{ github.event.issue.body }}"
`;
  const r2 = run('security.workflows_safe', wf(block));
  assert.equal(r2.state, 'fail');
  assert.deepEqual(r2.evidence, [{ file: WF, line: 8 }]);
});

test('workflows_safe: the same text passed through env: or used in if: is the safe way and passes', () => {
  const body = `on: pull_request
jobs:
  b:
    if: github.event.pull_request.draft == false
    steps:
      - run: echo "$TITLE"
        env:
          TITLE: \${{ github.event.pull_request.title }}
      - run: echo "pr \${{ github.event.number }}"
`;
  assert.equal(run('security.workflows_safe', wf(body)).state, 'pass');
});

test('workflows_safe: a commented line is not a finding', () => {
  const body = `on: pull_request
jobs:
  b:
    steps:
      # - run: echo "\${{ github.event.pull_request.title }}"
      - run: echo ok
`;
  assert.equal(run('security.workflows_safe', wf(body)).state, 'pass');
});

test('workflows_safe, token_permissions, actions_pinned, sast: no workflows is missing with code and no-code without', () => {
  for (const id of ['security.workflows_safe', 'security.token_permissions', 'security.actions_pinned', 'security.sast']) {
    const withCode = run(id, fakeHealthCtx({ files: code }));
    assert.equal(withCode.state, 'fail', id);
    assert.equal(withCode.reason, 'missing', id);
    const without = run(id, fakeHealthCtx({ files: { 'README.md': '# x\n' } }));
    assert.equal(without.state, 'na', id);
    assert.equal(without.reason, 'no-code', id);
  }
});

// ---------- token_permissions ----------

test('token_permissions: permissions at the top, or in every job, passes', () => {
  assert.equal(run('security.token_permissions', wf(SAFE)).state, 'pass');
  const perJob = `on: push
jobs:
  a:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: echo a
  b:
    permissions: read-all
    runs-on: ubuntu-latest
    steps:
      - run: echo b
`;
  assert.equal(run('security.token_permissions', wf(perJob)).state, 'pass');
});

test('token_permissions: a workflow with no permissions: fails and names the file', () => {
  const body = `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo a
`;
  const r = run('security.token_permissions', wf(body));
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
  assert.deepEqual(r.evidence.map((e) => e.file), [WF]);
});

test('token_permissions: one job without it fails even when another has it', () => {
  const body = `on: push
jobs:
  a:
    permissions:
      contents: read
    steps:
      - run: echo a
  b:
    steps:
      - run: echo b
`;
  const r = run('security.token_permissions', wf(body));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.evidence, [{ file: WF, line: 8 }]);
});

// ---------- actions_pinned ----------

test('actions_pinned: a tag fails with its line, a 40-hex sha passes', () => {
  const tag = `on: push
permissions: read-all
jobs:
  a:
    steps:
      - uses: x/y@v4
`;
  const r = run('security.actions_pinned', wf(tag));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.evidence, [{ file: WF, line: 6 }]);
  assert.equal(run('security.actions_pinned', wf(SAFE)).state, 'pass');
});

test('actions_pinned: a branch, a short sha and a quoted tag all fail', () => {
  const body = `jobs:
  a:
    steps:
      - uses: x/y@main
      - uses: "x/z@v1.2.3"
      - uses: x/w@0123456
`;
  const r = run('security.actions_pinned', wf(body));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.evidence.map((e) => e.line), [4, 5, 6]);
});

test('actions_pinned: docker:// and ./local are ignored, and a uses: word inside a run block is not a step', () => {
  const body = `jobs:
  a:
    steps:
      - uses: docker://alpine:3.19
      - uses: ./.github/actions/setup
      - run: |
          echo "uses: x/y@v4"
      - uses: x/y@${SHA}
`;
  assert.equal(run('security.actions_pinned', wf(body)).state, 'pass');
});

test('actions_pinned: a reusable workflow called by a tag fails', () => {
  const body = `jobs:
  call:
    uses: org/repo/.github/workflows/build.yml@v2
`;
  assert.equal(run('security.actions_pinned', wf(body)).state, 'fail');
});

// ---------- update_bot ----------

const monorepo = {
  'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
  'apps/web/package.json': JSON.stringify({ name: 'web', scripts: {} }),
  'backend/composer.json': JSON.stringify({ name: 'acme/api' }),
  'apps/web/src/a.js': 'export {};\n',
};
const dep = (...entries) => `version: 2
updates:
${entries.map(([eco, dir]) => `  - package-ecosystem: "${eco}"
    directory: "${dir}"
    schedule:
      interval: weekly
`).join('')}`;

test('update_bot: neither dependabot nor renovate is missing; renovate alone passes', () => {
  assert.equal(run('security.update_bot', fakeHealthCtx({ files: monorepo })).state, 'fail');
  assert.equal(run('security.update_bot', fakeHealthCtx({ files: monorepo })).reason, 'missing');
  for (const f of ['renovate.json', '.github/renovate.json']) {
    assert.equal(run('security.update_bot', fakeHealthCtx({ files: { ...monorepo, [f]: '{}' } })).state, 'pass', f);
  }
});

test('update_bot: dependabot that misses the ecosystem of a monorepo package fails listing that package', () => {
  const files = { ...monorepo, '.github/dependabot.yml': dep(['npm', '/'], ['npm', '/apps/web']) };
  const r = run('security.update_bot', fakeHealthCtx({ files }));
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
  assert.deepEqual(r.packages.filter((p) => p.state === 'fail'), [{ dir: 'backend', state: 'fail' }]);
  assert.deepEqual(r.packages.filter((p) => p.state === 'pass').map((p) => p.dir).sort(), ['', 'apps/web']);
});

test('update_bot: adding the missing ecosystem turns it into a pass', () => {
  const files = { ...monorepo, '.github/dependabot.yml': dep(['npm', '/'], ['npm', '/apps/web'], ['composer', '/backend']) };
  const r = run('security.update_bot', fakeHealthCtx({ files }));
  assert.equal(r.state, 'pass');
  assert.ok(r.packages.every((p) => p.state === 'pass'));
});

test('update_bot: the right ecosystem in the wrong directory does not count, and a directories glob does', () => {
  const wrong = { ...monorepo, '.github/dependabot.yml': dep(['npm', '/'], ['composer', '/other']) };
  const r = run('security.update_bot', fakeHealthCtx({ files: wrong }));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.packages.filter((p) => p.state === 'fail').map((p) => p.dir).sort(), ['apps/web', 'backend']);
  const globbed = `version: 2
updates:
  - package-ecosystem: npm
    directories:
      - "/"
      - "/apps/*"
    schedule:
      interval: weekly
  - package-ecosystem: composer
    directory: /backend
    schedule:
      interval: weekly
`;
  assert.equal(run('security.update_bot', fakeHealthCtx({ files: { ...monorepo, '.github/dependabot.yaml': globbed } })).state, 'pass');
});

test('update_bot: a repository with no code and no bot is na', () => {
  assert.equal(run('security.update_bot', fakeHealthCtx({ files: { 'README.md': '# x\n' } })).state, 'na');
});

// ---------- sast ----------

test('sast: codeql or semgrep in a workflow passes, a workflow without them fails', () => {
  const codeql = `on: push
jobs:
  a:
    steps:
      - uses: github/codeql-action/analyze@${SHA}
`;
  assert.equal(run('security.sast', wf(codeql)).state, 'pass');
  assert.equal(run('security.sast', wf('on: push\njobs:\n  a:\n    steps:\n      - run: pip install semgrep && semgrep ci\n', '.github/workflows/scan.yaml')).state, 'pass');
  const r = run('security.sast', wf(SAFE));
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
});

// ---------- sbom ----------

test('sbom: a file, a workflow step or a release asset passes; a known list without one fails', () => {
  assert.equal(run('security.sbom', fakeHealthCtx({ files: { ...code, 'sbom.spdx.json': '{}' } })).state, 'pass');
  assert.equal(run('security.sbom', fakeHealthCtx({ files: { ...code, 'docs/bom.json': '{}' } })).state, 'pass');
  const step = `on: push\njobs:\n  a:\n    steps:\n      - uses: anchore/sbom-action@${SHA}\n`;
  assert.equal(run('security.sbom', wf(step)).state, 'pass');
  const assets = fakeHealthCtx({ files: code, api: { mode: 'token', releases: [{ tag: 'v1', hasNotes: true, assets: ['app.cdx.json'] }] } });
  assert.equal(run('security.sbom', assets).state, 'pass');
  const known = fakeHealthCtx({ files: code, api: { mode: 'token', releases: [{ tag: 'v1', hasNotes: true, assets: ['app.zip'] }] } });
  const k = run('security.sbom', known);
  assert.equal(k.state, 'fail');
  assert.equal(k.reason, 'missing');
});

test('sbom: nothing local and no release data is not verified, never a fail', () => {
  const noApi = run('security.sbom', fakeHealthCtx({ files: code }));
  assert.equal(noApi.state, 'unverified');
  assert.equal(noApi.reason, 'no-token');
  const offline = run('security.sbom', fakeHealthCtx({ files: code, api: { mode: 'token', error: 'no-network', releases: null } }));
  assert.equal(offline.reason, 'no-network');
  const empty = run('security.sbom', fakeHealthCtx({ files: code, api: { mode: 'token', error: null, releases: null } }));
  assert.equal(empty.reason, 'no-data');
});

// ---------- fuzzing ----------

test('fuzzing: a fuzz library in the dependencies or a fuzz folder passes, none fails', () => {
  const dev = JSON.stringify({ name: 'lib', devDependencies: { 'fast-check': '^3.0.0' } });
  assert.equal(run('security.fuzzing', fakeHealthCtx({ files: { ...code, 'package.json': dev } })).state, 'pass');
  assert.equal(run('security.fuzzing', fakeHealthCtx({ files: { ...code, 'fuzz/parse.js': 'x\n' } })).state, 'pass');
  assert.equal(run('security.fuzzing', fakeHealthCtx({ files: { ...code, 'requirements.txt': 'atheris==2.3.0\n' } })).state, 'pass');
  const none = JSON.stringify({ name: 'lib', dependencies: { left: '1.0.0' } });
  const r = run('security.fuzzing', fakeHealthCtx({ files: { ...code, 'package.json': none } }));
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
});

test('fuzzing: the name of a fuzz library in a description is not a dependency', () => {
  const pkg = JSON.stringify({ name: 'lib', description: 'we never use fast-check here', dependencies: { left: '1.0.0' } });
  assert.equal(run('security.fuzzing', fakeHealthCtx({ files: { ...code, 'package.json': pkg } })).state, 'fail');
});

// ---------- the file that decides must change the state ----------

test('each of the seven flips state when the right file changes in the fake context', () => {
  const bad = { ...code, [WF]: 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.head_ref }}\n      - run: echo "${{ github.event.pull_request.title }}"\n' };
  const good = { ...code, [WF]: `${SAFE}      - uses: github/codeql-action/analyze@${SHA}\n`, 'renovate.json': '{}', 'sbom.spdx.json': '{}', 'fuzz/a.js': 'x\n' };
  for (const id of SECURITY_CI_IDS) {
    const a = run(id, fakeHealthCtx({ files: bad })).state;
    const b = run(id, fakeHealthCtx({ files: good })).state;
    assert.notEqual(a, b, `${id}: ${a} -> ${b}`);
    assert.equal(b, 'pass', id);
  }
});

test('a workflow too big to read is unverified, not a pass', () => {
  const big = `${SAFE}# ${'x'.repeat(210 * 1024)}\n`;
  const ctx = wf(big);
  for (const id of ['security.workflows_safe', 'security.token_permissions', 'security.actions_pinned']) {
    const r = run(id, ctx);
    assert.equal(r.state, 'unverified', id);
    assert.equal(r.reason, 'too-big', id);
  }
});

test('update_bot: an npm entry on a composer folder does not cover it', () => {
  const files = { ...monorepo, '.github/dependabot.yml': dep(['npm', '/'], ['npm', '/apps/web'], ['npm', '/backend']) };
  const r = run('security.update_bot', fakeHealthCtx({ files }));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.packages.filter((p) => p.state === 'fail'), [{ dir: 'backend', state: 'fail' }]);
});
