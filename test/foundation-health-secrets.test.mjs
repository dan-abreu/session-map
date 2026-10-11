// fd08, B4-T4: the three security items that read files and git: no secrets, .gitignore covers them, no binaries.
// The planted keys are built by joining pieces so this file never holds one whole.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { isSecretsFile } from '../server/files.mjs';
import { typeOf } from '../server/foundation/census.mjs';
import { makeHealthCtx } from '../server/foundation/health-ctx.mjs';
import { CHECKS, scanHistory } from '../server/foundation/health-checks/security-files.mjs';
import { kindOfFile } from '../server/sources/count.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const AWS = ['AK', 'IA', 'Q7ZXCVBNMLKJHGF2'].join('');
const GH = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const PEM = ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join('');
const STATES = new Set(['pass', 'fail', 'unverified', 'na']);
const IDS = ['security.gitignore_secrets', 'security.no_binaries', 'security.no_secrets'];
const GOOD_IGNORE = '.env\n*.pem\n*.key\nnode_modules/\n';

// Everything a check could print: its answer and every log() line written while it ran.
async function capture(fn) {
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return true; };
  try {
    const result = await fn();
    return { result, out: JSON.stringify(result) + lines.join('') };
  } finally {
    process.stderr.write = write;
  }
}

function rowsOf(paths) {
  return paths.map((path) => {
    const secret = isSecretsFile(path);
    return { path, type: typeOf(path), kind: secret ? 'secret' : kindOfFile(path), included: !secret && !['binary', 'dep', 'generated'].includes(kindOfFile(path)) };
  });
}

function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sm-secrets-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Ana');
  git('config', 'user.email', 'ana@acme.test');
  git('config', 'core.autocrlf', 'false');
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return { root, git, put };
}

const diskCtx = (root, paths, readSpy = []) => makeHealthCtx({
  root, rows: rowsOf(paths),
  readText: (p) => {
    readSpy.push(p);
    try { return execFileSync('git', ['show', `:${p}`], { cwd: root, encoding: 'utf8', windowsHide: true }); } catch { return null; }
  },
});

test('the module answers exactly the three items of security-files, each with one of the four states', async () => {
  assert.deepEqual(Object.keys(CHECKS).sort(), IDS);
  const ctx = fakeHealthCtx({ files: { 'README.md': '# acme' } });
  for (const id of IDS) {
    const r = await CHECKS[id](ctx);
    assert.ok(STATES.has(r.state), `${id} -> ${r.state}`);
    assert.ok(Array.isArray(r.evidence));
  }
});

test('a planted key in an included file fails with file and line, and its value is printed nowhere', async () => {
  const ctx = fakeHealthCtx({ files: { 'src/config.js': `const a = 1;\nconst b = 2;\nexport const key = '${AWS}';\n`, 'README.md': `see ${GH}\n` } });
  const { result, out } = await capture(() => CHECKS['security.no_secrets'](ctx));
  assert.equal(result.state, 'fail');
  assert.equal(result.reason, 'unsafe');
  assert.deepEqual(result.evidence.filter((e) => e.line), [{ file: 'README.md', line: 1 }, { file: 'src/config.js', line: 3 }]);
  assert.equal(result.detail.files, 2);
  assert.ok(!out.includes(AWS) && !out.includes(GH), 'the key value leaked into the answer or the log');
  assert.ok(!out.includes('Q7ZXCVBNMLKJHGF2'));
});

test('a private key block is a secret too', async () => {
  const ctx = fakeHealthCtx({ files: { 'deploy/id_rsa.txt': `${PEM}\nMIIEow\n` } });
  const r = await CHECKS['security.no_secrets'](ctx);
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.evidence, [{ file: 'deploy/id_rsa.txt', line: 1 }]);
});

test('a key inside tests, fixtures and example files is ignored', async () => {
  const files = {
    'test/api.test.js': `const k = '${AWS}';\n`,
    'src/orders.spec.ts': `const k = '${AWS}';\n`,
    'packages/db/fixtures/keys.js': `const k = '${AWS}';\n`,
    'config.example.js': `const k = '${AWS}';\n`,
    '.env.example': `AWS_KEY=${AWS}\n`,
    'src/app.js': 'export const ok = true;\n',
  };
  const r = await CHECKS['security.no_secrets'](fakeHealthCtx({ files }));
  assert.equal(r.state, 'pass');
  assert.deepEqual(r.evidence, []);
});

test('a tracked .env fails without ever being read', async () => {
  const asked = [];
  const ctx = makeHealthCtx({
    rows: rowsOf(['.env', 'apps/api/.env.production', 'src/app.js']),
    readText: (p) => { asked.push(p); return p === 'src/app.js' ? 'export {};\n' : 'DB_PASSWORD=hunter2\n'; },
  });
  const read = ctx.read;
  ctx.read = (p) => { asked.push(p); return read(p); };
  const { result, out } = await capture(() => CHECKS['security.no_secrets'](ctx));
  assert.equal(result.state, 'fail');
  assert.equal(result.detail.tracked, 2);
  assert.deepEqual(result.evidence.map((e) => e.file).sort(), ['.env', 'apps/api/.env.production']);
  assert.ok(!asked.some((p) => isSecretsFile(p)), `a secret file was asked for: ${asked}`);
  assert.ok(!out.includes('hunter2'));
});

test('real git: a key added and removed later still fails with the commit, never the value', async () => {
  const { root, git, put } = gitRepo();
  try {
    put('src/a.js', `export const key = '${AWS}';\n`);
    git('add', '.');
    git('commit', '-qm', 'add key');
    const bad = git('rev-parse', 'HEAD');
    put('src/a.js', 'export const key = process.env.KEY;\n');
    git('commit', '-qam', 'remove key');
    put('test/a.test.js', `const k = '${AWS}';\n`);
    git('add', '.');
    git('commit', '-qm', 'test key');
    const { result, out } = await capture(() => CHECKS['security.no_secrets'](diskCtx(root, ['src/a.js', 'test/a.test.js'])));
    assert.equal(result.state, 'fail');
    assert.equal(result.reason, 'unsafe');
    assert.equal(result.detail.files, 0);
    assert.equal(result.detail.history, 'ok');
    const commits = result.evidence.filter((e) => e.commit);
    assert.ok(commits.some((e) => e.commit === bad && e.file === 'src/a.js'), JSON.stringify(result.evidence));
    assert.ok(!commits.some((e) => e.file === 'test/a.test.js'), 'a key in a test file of the history counted');
    assert.ok(!out.includes(AWS));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real git: a clean history passes; too many commits or a timeout is unverified too-big, never fail', async () => {
  const { root, git, put } = gitRepo();
  try {
    for (const n of [1, 2, 3]) {
      put('src/a.js', `export const n = ${n};\n`);
      git('add', '.');
      git('commit', '-qm', `c${n}`);
    }
    const ctx = () => diskCtx(root, ['src/a.js']);
    assert.equal((await CHECKS['security.no_secrets'](ctx())).state, 'pass');
    const big = await CHECKS['security.no_secrets'](ctx(), { maxCommits: 2 });
    assert.deepEqual([big.state, big.reason], ['unverified', 'too-big']);
    const slow = await scanHistory(root, { timeoutMs: 1 });
    assert.equal(slow.state, 'too-big');
    const late = await CHECKS['security.no_secrets'](ctx(), { timeoutMs: 1 });
    assert.deepEqual([late.state, late.reason], ['unverified', 'too-big']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real git: only a tracked .env counts; one that git ignores or never saw is the .gitignore item', async () => {
  const { root, git, put } = gitRepo();
  try {
    put('src/a.js', 'export {};\n');
    put('.env', 'DB_PASSWORD=hunter2\n');
    git('add', 'src/a.js');
    git('commit', '-qm', 'init');
    const untracked = await CHECKS['security.no_secrets'](diskCtx(root, ['src/a.js', '.env']));
    assert.equal(untracked.state, 'pass');
    git('add', '.env');
    git('commit', '-qm', 'oops');
    const { result, out } = await capture(() => CHECKS['security.no_secrets'](diskCtx(root, ['src/a.js', '.env'])));
    assert.equal(result.state, 'fail');
    assert.ok(result.evidence.some((e) => e.file === '.env' && !e.commit));
    assert.ok(!out.includes('hunter2'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('.gitignore: missing fails, without .env fails naming it, complete passes', async () => {
  const run = (files) => CHECKS['security.gitignore_secrets'](fakeHealthCtx({ files: { 'src/a.js': 'export {};\n', ...files } }));
  const none = await run({});
  assert.deepEqual([none.state, none.reason], ['fail', 'missing']);
  const noEnv = await run({ '.gitignore': '*.pem\n*.key\nnode_modules/\n' });
  assert.equal(noEnv.state, 'fail');
  assert.deepEqual(noEnv.detail.names, ['.env']);
  assert.deepEqual(noEnv.evidence, [{ file: '.gitignore' }]);
  assert.equal((await run({ '.gitignore': GOOD_IGNORE })).state, 'pass');
  assert.equal((await run({ '.gitignore': '# local\n.env*\n**/*.pem\n*.key\n' })).state, 'pass');
});

test('.gitignore: negation, anchoring and comments are read the way git reads them', async () => {
  const run = (ignore) => CHECKS['security.gitignore_secrets'](fakeHealthCtx({ files: { '.gitignore': ignore } }));
  assert.deepEqual((await run('.env\n!.env\n*.pem\n*.key\n')).detail.names, ['.env']);
  assert.deepEqual((await run('#.env\n*.pem\n*.key\n')).detail.names, ['.env']);
  assert.deepEqual((await run('/config/.env\n*.pem\n*.key\n')).detail.names, ['.env']);
  assert.deepEqual((await run('.env\n*.pem\n')).detail.names, ['*.key']);
  assert.equal((await run('/.env\n*.pem\n*.key\n')).state, 'pass');
});

test('.gitignore: each package needs its own stack output ignored, by the root file or its own', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'acme-shop', private: true, workspaces: ['apps/*'] }),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { next: '16.0.1', react: '19.0.0' } }),
    'apps/web/app/page.tsx': 'export default function Page() { return null; }\n',
    'apps/mobile/pubspec.yaml': 'name: acme_mobile\ndependencies:\n  flutter:\n    sdk: flutter\n',
    'backend/composer.json': JSON.stringify({ name: 'acme/backend' }),
  };
  const run = (extra) => CHECKS['security.gitignore_secrets'](fakeHealthCtx({ files: { ...files, ...extra } }));
  const bare = await run({ '.gitignore': GOOD_IGNORE });
  assert.equal(bare.state, 'fail');
  assert.deepEqual(bare.detail.names, ['apps/mobile/.dart_tool/', 'apps/mobile/build/', 'apps/web/.next/', 'backend/vendor/']);
  const fixed = await run({
    '.gitignore': `${GOOD_IGNORE}.next/\n`,
    'apps/mobile/.gitignore': '.dart_tool/\n/build/\n',
    'backend/.gitignore': '/vendor\n',
  });
  assert.equal(fixed.state, 'pass', JSON.stringify(fixed.detail));
});

test('.gitignore: a folder with two manifests (Laravel with npm) needs the outputs of both', async () => {
  const files = {
    'composer.json': JSON.stringify({ name: 'acme/app' }),
    'package.json': JSON.stringify({ name: 'app', private: true }),
    '.gitignore': '.env\n*.pem\n*.key\n/node_modules\n',
  };
  const r = await CHECKS['security.gitignore_secrets'](fakeHealthCtx({ files }));
  assert.deepEqual(r.detail.names, ['vendor/']);
});

test('.gitignore: a fixture repository inside the project is not shown as evidence', async () => {
  const files = { '.gitignore': '*.pem\n*.key\n', 'test/fixtures/repos/acme-lib/.gitignore': '.env\n' };
  const r = await CHECKS['security.gitignore_secrets'](fakeHealthCtx({ files }));
  assert.deepEqual(r.detail.names, ['.env']);
  assert.deepEqual(r.evidence, [{ file: '.gitignore' }]);
});

test('binaries: a tracked .exe or .dll fails with the file; images and the gradle wrapper do not', async () => {
  const run = (paths) => CHECKS['security.no_binaries'](fakeHealthCtx({ files: Object.fromEntries(paths.map((p) => [p, 'x'])) }));
  const bad = await run(['tools/setup.exe', 'lib/native.dll', 'src/a.js']);
  assert.deepEqual([bad.state, bad.reason], ['fail', 'unsafe']);
  assert.deepEqual(bad.evidence, [{ file: 'lib/native.dll' }, { file: 'tools/setup.exe' }]);
  assert.equal(bad.detail.count, 2);
  const ok = await run(['logo.png', 'android/gradle/wrapper/gradle-wrapper.jar', 'src/a.js']);
  assert.equal(ok.state, 'pass');
});

test('real git: an untracked binary is not charged, a tracked one is', async () => {
  const { root, git, put } = gitRepo();
  try {
    put('src/a.js', 'export {};\n');
    put('bin/tool.exe', 'MZ');
    git('add', 'src/a.js');
    git('commit', '-qm', 'init');
    const ctx = () => makeHealthCtx({ root, rows: rowsOf(['src/a.js', 'bin/tool.exe']), readText: () => null });
    assert.equal((await CHECKS['security.no_binaries'](ctx())).state, 'pass');
    git('add', 'bin/tool.exe');
    git('commit', '-qm', 'tool');
    const r = await CHECKS['security.no_binaries'](ctx());
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.evidence, [{ file: 'bin/tool.exe' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A folder without git (or a machine without git) cannot say what is tracked: never a fail, always "not checked".
function plainFolder(files) {
  const root = mkdtempSync(join(tmpdir(), 'sm-nogit-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const ctx = makeHealthCtx({ root, rows: rowsOf(Object.keys(files)), readText: (p) => (p === 'src/a.js' ? files[p] : null) });
  return { root, ctx };
}

test('no git in the folder: a .env never committed is unverified, never fail', async () => {
  const { root, ctx } = plainFolder({ '.env': 'DB_PASSWORD=hunter2\n', 'src/a.js': 'export {};\n' });
  try {
    const r = await CHECKS['security.no_secrets'](ctx);
    assert.equal(r.state, 'unverified', JSON.stringify(r));
    assert.ok(['tool-missing', 'error'].includes(r.reason));
    assert.deepEqual(r.evidence, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no git in the folder: a loose .exe is unverified, never fail', async () => {
  const { root, ctx } = plainFolder({ 'bin/x.exe': 'MZ', 'src/a.js': 'export {};\n' });
  try {
    const r = await CHECKS['security.no_binaries'](ctx);
    assert.equal(r.state, 'unverified', JSON.stringify(r));
    assert.ok(['tool-missing', 'error'].includes(r.reason));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('git not installed: both items say tool-missing', async () => {
  const { root, ctx } = plainFolder({ '.env': 'X=1\n', 'bin/x.exe': 'MZ', 'src/a.js': 'export {};\n' });
  const path = process.env.PATH;
  process.env.PATH = '';
  try {
    const secrets = await CHECKS['security.no_secrets'](ctx);
    const bins = await CHECKS['security.no_binaries'](ctx);
    assert.deepEqual([secrets.state, secrets.reason], ['unverified', 'tool-missing']);
    assert.deepEqual([bins.state, bins.reason], ['unverified', 'tool-missing']);
  } finally {
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});

test('real git: a project in a subfolder only sees its own history, with paths relative to it', async () => {
  const { root, git, put } = gitRepo();
  try {
    put('apps/api/src/a.js', `export const key = '${AWS}';\n`);
    put('other/b.js', `export const key = '${GH}';\n`);
    git('add', '.');
    git('commit', '-qm', 'keys');
    const sub = join(root, 'apps', 'api');
    const h = await scanHistory(sub);
    assert.equal(h.state, 'ok');
    assert.deepEqual(h.hits.map((x) => x.file), ['src/a.js']);
    for (let n = 0; n < 3; n++) {
      put('other/c.js', `export const n = ${n};\n`);
      git('add', '.');
      git('commit', '-qm', `other ${n}`);
    }
    assert.equal((await scanHistory(sub, { maxCommits: 2 })).state, 'ok', 'commits outside the subfolder were counted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
