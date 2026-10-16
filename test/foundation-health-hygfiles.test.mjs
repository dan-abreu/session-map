// Health (fd08), the nine "hygiene - files" checks: .editorconfig, .gitignore, .gitattributes, .env.example,
// config doc, lockfile, runtime pin, devcontainer, license check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS } from '../server/foundation/health-checks/hygiene-files.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const run = (id, files, extra = {}) => {
  const ctx = fakeHealthCtx({ files, ...extra });
  if (extra.facts) ctx.facts = extra.facts;
  return CHECKS[id](ctx);
};
const env = (name, source = 'code') => ({ id: `env:${name}`, kind: 'env', name, attrs: { source } });
const PKG = JSON.stringify({ name: 'acme-app', scripts: {} });

test('every hygiene file item has one check and it always answers with a valid state', () => {
  const ids = ['editorconfig', 'gitignore', 'gitattributes', 'env_example', 'config_doc', 'lockfile', 'runtime_pin', 'devcontainer', 'license_check'].map((n) => `hygiene.${n}`);
  assert.deepEqual(Object.keys(CHECKS).sort(), [...ids].sort());
  for (const id of ids) assert.ok(HEALTH_ITEMS.some((i) => i.id === id), id);
  for (const id of ids) {
    const r = run(id, {});
    assert.ok(['pass', 'fail', 'unverified', 'na'].includes(r.state), id);
    assert.ok(Array.isArray(r.evidence), id);
  }
});

test('editorconfig: missing, without root = true, and good', () => {
  const miss = run('hygiene.editorconfig', {});
  assert.deepEqual([miss.state, miss.reason], ['fail', 'missing']);
  const bad = run('hygiene.editorconfig', { '.editorconfig': '[*]\nindent_size = 2\n' });
  assert.deepEqual([bad.state, bad.reason], ['fail', 'invalid']);
  const ok = run('hygiene.editorconfig', { '.editorconfig': '# top\nroot = true\n[*]\nindent_size = 2\n' });
  assert.equal(ok.state, 'pass');
  assert.deepEqual(ok.evidence, [{ file: '.editorconfig' }]);
});

test('gitignore: missing, too short, and with three patterns', () => {
  assert.equal(run('hygiene.gitignore', {}).reason, 'missing');
  assert.equal(run('hygiene.gitignore', { '.gitignore': '# only a comment\n\nnode_modules\n' }).reason, 'too-short');
  assert.equal(run('hygiene.gitignore', { '.gitignore': 'node_modules\ndist\n.env\n' }).state, 'pass');
});

test('gitattributes: needs text=auto or eol', () => {
  assert.equal(run('hygiene.gitattributes', {}).reason, 'missing');
  assert.equal(run('hygiene.gitattributes', { '.gitattributes': '*.png binary\n' }).reason, 'invalid');
  assert.equal(run('hygiene.gitattributes', { '.gitattributes': '* text=auto\n' }).state, 'pass');
  assert.equal(run('hygiene.gitattributes', { '.gitattributes': '*.sh text eol=lf\n' }).state, 'pass');
});

test('env_example: a real-looking value is unsafe and the value never leaves', () => {
  const secret = 'sk_live_51HxAbCdEfGhIjKlMnOp';
  const r = run('hygiene.env_example', { '.env.example': `PORT=3000\nSTRIPE_KEY=${secret}\n` });
  assert.deepEqual([r.state, r.reason], ['fail', 'unsafe']);
  assert.deepEqual(r.evidence, [{ file: '.env.example', line: 2 }]);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.ok(!JSON.stringify(r).includes('51HxAb'));
});

test('env_example: a secret-named variable with a plain value is unsafe, placeholders are fine', () => {
  const r = run('hygiene.env_example', { '.env.example': 'DB_PASSWORD=hunter2hunter2\n' });
  assert.equal(r.reason, 'unsafe');
  const ok = run('hygiene.env_example', { '.env.example': 'DB_PASSWORD=\nAPI_TOKEN=your-token-here\nJWT_SECRET=<change me>\nPORT=3000\nNODE_ENV=development\n# KEY=sk_live_abc\n' });
  assert.equal(ok.state, 'pass');
});

test('env_example: no example file fails; with no facts it only checks the file', () => {
  const miss = run('hygiene.env_example', {});
  assert.deepEqual([miss.state, miss.reason], ['fail', 'missing']);
  assert.equal(run('hygiene.env_example', { '.env.sample': 'PORT=3000\n' }).state, 'pass');
  assert.equal(run('hygiene.env_example', { '.env.dist': 'PORT=3000\n' }).state, 'pass');
});

test('env_example: a variable read in code and absent from the example fails listing only its name', () => {
  const files = { '.env.example': 'PORT=3000\n', '.env': 'HIDDEN=never-opened-value\n' };
  const r = run('hygiene.env_example', files, { facts: [env('PORT'), env('DATABASE_URL'), env('PORT', 'example')] });
  assert.deepEqual([r.state, r.reason], ['fail', 'missing']);
  assert.deepEqual(r.detail.names, ['DATABASE_URL']);
  assert.ok(!JSON.stringify(r).includes('never-opened-value'));
  assert.equal(run('hygiene.env_example', files, { facts: [env('PORT')] }).state, 'pass');
});

test('env_example and config_doc: what a test or a fixture repository reads or declares is the sample, not the project', () => {
  const at = (file, name, refs = []) => ({ ...env(name), file, refs: refs.map((r) => ({ file: r })) });
  const files = { '.env.example': 'PORT=3000\n', 'test/fixtures/repos/shop/.env.example': 'SHOP_SECRET=\n' };
  const facts = [at('src/server.js', 'PORT'), at('test/fixtures/repos/shop/api.ts', 'SHOP_URL'), at('test/run.test.mjs', 'TEST_KNOB')];
  const r = run('hygiene.env_example', files, { facts });
  assert.equal(r.state, 'pass', JSON.stringify(r));
  assert.deepEqual(r.evidence.map((e) => e.file), ['.env.example'], 'the example file of a fixture repository is not the project\'s');
  // A variable that real code also reads still counts, even when its first mention is in a test.
  const both = run('hygiene.env_example', files, { facts: [at('test/run.test.mjs', 'API_URL', ['src/api.js'])] });
  assert.deepEqual([both.state, both.detail.names], ['fail', ['API_URL']]);
  // The variables the operating system sets are read, not configured.
  assert.equal(run('hygiene.env_example', files, { facts: [at('src/a.js', 'HOME'), at('src/a.js', 'LOCALAPPDATA'), at('src/a.js', 'SystemRoot')] }).state, 'pass');
  // config_doc looks only at the real example file too.
  const doc = run('hygiene.config_doc', { ...files, 'README.md': 'PORT is where it listens.\n' });
  assert.equal(doc.state, 'pass', JSON.stringify(doc));
});

test('env_example: the real .env is never read', () => {
  const ctx = fakeHealthCtx({ files: { '.env.example': 'A=1\n', '.env': 'A=sk_live_zzzzzzzzzzzzzzzz\n' } });
  const seen = [];
  const read = ctx.read;
  ctx.read = (p) => { seen.push(p); return read(p); };
  CHECKS['hygiene.env_example'](ctx);
  CHECKS['hygiene.config_doc'](ctx);
  assert.ok(seen.length > 0);
  assert.ok(!seen.includes('.env'));
});

test('config_doc: names of the example listed in a doc pass, a missing one fails with its name', () => {
  const example = { '.env.example': 'PORT=3000\nDATABASE_URL=\n' };
  const ok = run('hygiene.config_doc', { ...example, 'README.md': '| Name | Use |\n|---|---|\n| PORT | port |\n| DATABASE_URL | db |\n' });
  assert.equal(ok.state, 'pass');
  const inDocs = run('hygiene.config_doc', { ...example, 'docs/config.md': '- `PORT`\n- `DATABASE_URL`\n' });
  assert.equal(inDocs.state, 'pass');
  const bad = run('hygiene.config_doc', { ...example, 'README.md': 'Set PORT to something. PORT_EXTRA too.\n' });
  assert.deepEqual([bad.state, bad.reason, bad.detail.names], ['fail', 'missing', ['DATABASE_URL']]);
  assert.equal(run('hygiene.config_doc', { 'README.md': '# x' }).state, 'unverified');
});

test('lockfile: at the root or in the package passes, none fails, no manifest is na', () => {
  assert.equal(run('hygiene.lockfile', { 'package.json': PKG, 'pnpm-lock.yaml': 'x' }).state, 'pass');
  assert.equal(run('hygiene.lockfile', { 'package.json': PKG, 'PACKAGE-LOCK.json': '{}' }).state, 'pass');
  const none = run('hygiene.lockfile', { 'package.json': PKG });
  assert.deepEqual([none.state, none.reason], ['fail', 'missing']);
  assert.equal(run('hygiene.lockfile', { 'README.md': '# x' }).state, 'na');
  const pkgs = { 'apps/web/package.json': PKG, 'apps/web/yarn.lock': 'x', 'apps/api/composer.json': '{"name":"acme/api"}' };
  const r = run('hygiene.lockfile', pkgs);
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.detail.names, ['apps/api']);
  assert.equal(run('hygiene.lockfile', { ...pkgs, 'apps/api/composer.lock': '{}' }).state, 'pass');
});

test('runtime_pin: .nvmrc, engines, per package, and which package lacks it', () => {
  assert.equal(run('hygiene.runtime_pin', { 'package.json': PKG, '.nvmrc': '22' }).state, 'pass');
  assert.equal(run('hygiene.runtime_pin', { 'package.json': JSON.stringify({ name: 'a', engines: { node: '>=22' } }) }).state, 'pass');
  assert.equal(run('hygiene.runtime_pin', { 'package.json': PKG, '.tool-versions': 'nodejs 22' }).state, 'pass');
  const none = run('hygiene.runtime_pin', { 'package.json': PKG });
  assert.deepEqual([none.state, none.reason], ['fail', 'missing']);
  const mono = {
    'apps/web/package.json': JSON.stringify({ name: 'w', engines: { node: '22' } }),
    'apps/api/composer.json': JSON.stringify({ name: 'acme/api', require: { laravel: '1' } }),
  };
  const r = run('hygiene.runtime_pin', mono);
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.packages, [{ dir: 'apps/api', state: 'fail' }, { dir: 'apps/web', state: 'pass' }]);
  const php = { ...mono, 'apps/api/composer.json': JSON.stringify({ name: 'acme/api', require: { php: '^8.3' } }) };
  assert.equal(run('hygiene.runtime_pin', php).state, 'pass');
  assert.equal(run('hygiene.runtime_pin', { README: 'x' }).state, 'na');
});

test('devcontainer: either spelling passes', () => {
  assert.equal(run('hygiene.devcontainer', {}).reason, 'missing');
  assert.equal(run('hygiene.devcontainer', { '.devcontainer/devcontainer.json': '{}' }).state, 'pass');
  assert.equal(run('hygiene.devcontainer', { '.devcontainer.json': '{}' }).state, 'pass');
});

test('license_check: a tool in a manifest, a licenses table, or a workflow passes', () => {
  assert.equal(run('hygiene.license_check', { 'package.json': PKG }).reason, 'missing');
  const tool = JSON.stringify({ name: 'a', scripts: { licenses: 'license-checker --production' } });
  assert.equal(run('hygiene.license_check', { 'package.json': tool }).state, 'pass');
  assert.equal(run('hygiene.license_check', { 'THIRD-PARTY-NOTICES.md': '| dep | MIT |' }).state, 'pass');
  assert.equal(run('hygiene.license_check', { LICENSE: 'MIT' }).state, 'fail');
  assert.equal(run('hygiene.license_check', { '.github/workflows/ci.yml': 'run: npx licensee detect\n' }).state, 'pass');
});
