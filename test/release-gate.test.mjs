import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_IDS, main, runGate } from '../scripts/release-gate.mjs';
import { buildManifest, sha256Of } from '../scripts/shots-manifest.mjs';

const REAL = fileURLToPath(new URL('..', import.meta.url));
const GATE = join(REAL, 'scripts', 'release-gate.mjs');
const TODAY = '2026-10-10';
const NL = '\n';
const okMeasure =async () => ({ ok: true, failures: [] });
const okTests = async () => ({ ok: true });

// A copy of the real repository, so each test breaks one thing in it and nothing else.
const COPY = ['README.md', 'README.pt-BR.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'LICENSE', 'package.json', '.claude-plugin', 'skills', 'docs', 'server', 'hooks', 'scripts/release-features.json'];
const made = [];
function copyRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sm-gate-'));
  made.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const rel of COPY) if (existsSync(join(REAL, rel))) cpSync(join(REAL, rel), join(root, rel), { recursive: true, filter: (src) => !src.includes('node_modules') });
  // The live architecture folder changes with the work in progress; the copy gets a small calm one of its own.
  rmSync(join(root, 'docs', 'architecture'), { recursive: true, force: true });
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  writeFileSync(join(root, 'docs', 'architecture', 'README.md'), ['# Architecture', '', '```mermaid', 'flowchart TD', '  subgraph Core', '    core[Core]', '  end', '```', ''].join(NL));
  writeFileSync(join(root, 'docs', 'architecture', 'core.md'), ['# Core', '', '## What is missing', '', '- [x] The core works `co01`', ''].join(NL));
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test', 'placeholder.test.mjs'), '');
  return root;
}
test.after(() => { for (const r of made) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const write = (root, rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
const edit = (root, rel, fn) => write(root, rel, fn(read(root, rel)));
const ids = (res) => [...new Set(res.failures.map((f) => f.id))].sort();
const check = (root, extra = {}) => runGate({ root, mode: 'check', measure: okMeasure, today: TODAY, ...extra });
const publish = (root, extra = {}) => runGate({ root, mode: 'publish', measure: okMeasure, runTests: okTests, today: TODAY, ...extra });

// The shots manifest as the real script would write it, for the copy's own version.
function withManifest(root, date = TODAY) {
  const version = JSON.parse(read(root, 'package.json')).version;
  const images = {};
  for (const name of ['en-map.webp', 'pt-map.webp']) {
    const bytes = readFileSync(join(root, 'docs', 'images', name));
    images[name] = { sha: sha256Of(bytes), width: 1440, height: 900, lang: name.startsWith('pt') ? 'pt-BR' : 'en' };
  }
  write(root, 'docs/images/shots.json', JSON.stringify(buildManifest({ version, date, images })));
}

test('the real repository passes --check, with the real measure', async () => {
  const res = await runGate({ root: REAL, mode: 'check', today: TODAY });
  assert.deepEqual(res.failures, []);
  assert.equal(res.ok, true);
});

test('a copy of the real repository passes --check and --publish with a fresh manifest', async () => {
  const root = copyRepo();
  withManifest(root);
  assert.deepEqual((await check(root)).failures, []);
  assert.deepEqual((await publish(root)).failures, []);
});

test('the checks have the documented ids', () => {
  assert.deepEqual(CHECK_IDS, ['versions', 'changelog', 'features', 'links', 'shots', 'invention', 'shots-date', 'ticked', 'tests']);
});

test('versions: changing the version in package.json only fails, and says which files disagree', async () => {
  const root = copyRepo();
  edit(root, 'package.json', (t) => t.replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
  const res = await check(root);
  assert.ok(ids(res).includes('versions'));
  const text = res.failures.filter((f) => f.id === 'versions').map((f) => f.message).join('\n');
  assert.match(text, /plugin\.json/);
  assert.match(text, /CHANGELOG/);
  assert.match(text, /README\.md/);
  assert.match(text, /README\.pt-BR\.md/);
});

test('versions: the version of plugin.json alone is enough to fail', async () => {
  const root = copyRepo();
  edit(root, '.claude-plugin/plugin.json', (t) => t.replace(/"version": "[^"]+"/, '"version": "0.0.1"'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['versions']);
});

test('versions: a README without the version comment fails; one with a different number fails', async () => {
  const root = copyRepo();
  edit(root, 'README.pt-BR.md', (t) => t.replace(/<!-- session-map:version [^>]*-->\r?\n/, ''));
  assert.deepEqual(ids(await check(root)), ['versions']);
  const root2 = copyRepo();
  edit(root2, 'README.md', (t) => t.replace(/<!-- session-map:version [^ ]+ -->/, '<!-- session-map:version 0.0.1 -->'));
  assert.deepEqual(ids(await check(root2)), ['versions']);
});

test('versions: a marketplace.json that carries a version must agree too', async () => {
  const root = copyRepo();
  edit(root, '.claude-plugin/marketplace.json', (t) => t.replace('"name": "session-map",', '"name": "session-map",\n  "version": "0.0.1",'));
  assert.deepEqual(ids(await check(root)), ['versions']);
});

test('versions: "## Unreleased" on top of the CHANGELOG does not fail', async () => {
  const root = copyRepo();
  edit(root, 'CHANGELOG.md', (t) => t.replace('# Changelog\n', '# Changelog\n\n## Unreleased\n\n- Coming soon.\n'));
  assert.deepEqual((await check(root)).failures, []);
});

test('changelog: a missing file, an empty section and versions out of order each fail', async () => {
  const version = JSON.parse(read(REAL, 'package.json')).version;
  const root = copyRepo();
  rmSync(join(root, 'CHANGELOG.md'));
  assert.ok(ids(await check(root)).includes('changelog'));

  const empty = copyRepo();
  write(empty, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n\nNo list here.\n\n## 0.0.1\n\n- Old.\n`);
  const resEmpty = await check(empty);
  assert.deepEqual(ids(resEmpty), ['changelog']);
  assert.match(resEmpty.failures[0].message, new RegExp(version.replaceAll('.', '\\.')));

  const order = copyRepo();
  write(order, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n\n- A.\n\n## 0.0.1\n\n- B.\n\n## 0.1.0\n\n- C.\n`);
  assert.deepEqual(ids(await check(order)), ['changelog']);
});

test('features: a README sentence about a tab that does not exist fails', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', 'The Weather tab shows rain.\n\n## For people who code'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures[0].message, /Weather/);
});

test('features: "the Flow tab" and "the **Changes** tab" are tabs that exist', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', 'Open the Flow tab, then the **Changes** tab.\n\n## For people who code'));
  assert.deepEqual((await check(root)).failures, []);
});

test('features: a new heading with no entry in the feature map fails in both READMEs', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', '## Brand new thing\n\nText.\n\n## For people who code'));
  edit(root, 'README.pt-BR.md', (t) => t.replace('## Para quem programa', '## Coisa nova\n\nTexto.\n\n## Para quem programa'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures.map((f) => f.message).join('\n'), /Brand new thing/);
});

test('features: headings in the English README without a twin in the Portuguese one fail', async () => {
  const root = copyRepo();
  const map = JSON.parse(read(root, 'scripts/release-features.json'));
  map.skip.push('Brand new thing');
  write(root, 'scripts/release-features.json', JSON.stringify(map));
  edit(root, 'README.md', (t) => t.replace('## For people who code', '## Brand new thing\n\nText.\n\n## For people who code'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures[0].message, /title/);
});

test('features: a pointer in the feature map to code that is gone fails', async () => {
  const root = copyRepo();
  const map = JSON.parse(read(root, 'scripts/release-features.json'));
  map.features[0].code.push('server/arch/parse.mjs#noSuchFunction');
  write(root, 'scripts/release-features.json', JSON.stringify(map));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures[0].message, /noSuchFunction/);
});

test('features: a slash command with no skill fails', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', 'Try `/session-map:nada` now.\n\n## For people who code'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures[0].message, /session-map:nada/);
});

test('features: a command-line flag the server does not know fails', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', 'Use `--teleport` to jump.\n\n## For people who code'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.match(res.failures[0].message, /--teleport/);
});

test('features: a path in backticks that does not exist fails; folders and user-side paths do not', async () => {
  const root = copyRepo();
  edit(root, 'README.md', (t) => t.replace('## For people who code', 'The code is in `server/gone-for-good.mjs`, `~/.claude/x.json` and `docs/arch`.\n\n## For people who code'));
  const res = await check(root);
  assert.deepEqual(ids(res), ['features']);
  assert.equal(res.failures.length, 1);
  assert.match(res.failures[0].message, /gone-for-good/);
});

test('links: a broken relative link or anchor fails; an external one is not fetched', async () => {
  const root = copyRepo();
  edit(root, 'CONTRIBUTING.md', (t) => `${t}\nSee [nothing](docs/not-here.md) and [the web](https://example.invalid/x).\n`);
  const res = await check(root);
  assert.deepEqual(ids(res), ['links']);
  assert.equal(res.failures.length, 1);
  assert.match(res.failures[0].message, /CONTRIBUTING\.md:\d+/);

  const anchor = copyRepo();
  edit(anchor, 'CHANGELOG.md', (t) => `${t}\nSee [here](#no-such-heading).\n`);
  assert.deepEqual(ids(await check(anchor)), ['links']);

  const docs = copyRepo();
  write(docs, 'docs/extra/page.md', '# Page\n\n[gone](../missing.md)\n');
  assert.deepEqual(ids(await check(docs)), ['links']);
});

test('shots: a README image that is not there fails', async () => {
  const root = copyRepo();
  rmSync(join(root, 'docs/images/en-map.webp'));
  assert.deepEqual(ids(await check(root)), ['shots']);
});

test('shots: a retouched image or a manifest of another version fails in --check', async () => {
  const root = copyRepo();
  withManifest(root);
  writeFileSync(join(root, 'docs/images/en-map.webp'), Buffer.from('retouched'));
  const res = await check(root);
  assert.ok(ids(res).includes('shots'));
  assert.match(res.failures.find((f) => f.id === 'shots').message, /en-map\.webp/);

  const old = copyRepo();
  withManifest(old);
  edit(old, 'docs/images/shots.json', (t) => t.replace(/"version":"[^"]+"/, '"version":"0.0.1"'));
  assert.deepEqual(ids(await check(old)), ['shots']);

  const junk = copyRepo();
  write(junk, 'docs/images/shots.json', '{ not json');
  assert.deepEqual(ids(await check(junk)), ['shots']);
});

test('shots-date: a manifest from yesterday fails only in --publish; no manifest is a note in --check and a failure in --publish', async () => {
  const root = copyRepo();
  withManifest(root, '2026-10-09');
  assert.deepEqual((await check(root)).failures, []);
  assert.deepEqual(ids(await publish(root)), ['shots-date']);

  const none = copyRepo();
  rmSync(join(none, 'docs', 'images', 'shots.json'), { force: true });
  const res = await check(none);
  assert.deepEqual(res.failures, []);
  assert.ok(res.notes.some((n) => /shots\.json/.test(n)));
  assert.deepEqual(ids(await publish(none)), ['shots-date']);
});

test('invention: the measure over the limit fails in --check, once per line, and a crash fails too', async () => {
  const root = copyRepo();
  const bad = async () => ({ ok: false, failures: ['acme-shop route: invention 12.5% is above 0.0%', 'acme-lib all: accuracy 50.0% is below 100.0%'] });
  const res = await check(root, { measure: bad });
  assert.deepEqual(ids(res), ['invention']);
  assert.equal(res.failures.length, 2);
  assert.match(res.failures[0].message, /acme-shop route/);

  const boom = await check(root, { measure: async () => { throw new Error('no fixtures'); } });
  assert.deepEqual(ids(boom), ['invention']);
});

test('ticked: an unticked item whose detail says Status: done fails in --publish only', async () => {
  const root = copyRepo();
  withManifest(root);
  write(root, 'docs/architecture/zz-extra.md', '# Extra\n\n## What is missing\n\n- [ ] **important:** Something finished `zz01`\n  - Status: done (released in v0.1.0).\n');
  assert.deepEqual((await check(root)).failures, []);
  const res = await publish(root);
  assert.deepEqual(ids(res), ['ticked']);
  assert.match(res.failures[0].message, /zz01/);
});

test('ticked: a request the registry still shows as unconfirmed fails in --publish', async () => {
  const root = copyRepo();
  withManifest(root);
  write(root, 'docs/architecture/zz-requests.md', [
    '# Requests', '', '## What is missing', '',
    '- [ ] **in progress:** Add the thing `rq01`',
    '  - Asked: 2026-10-01 "please add the thing"',
    '  - Where it went: `zz02`', '  - Status: accepted.', '',
    '- [x] The thing itself `zz02`', '',
  ].join('\n'));
  const res = await publish(root);
  assert.deepEqual(ids(res), ['ticked']);
  assert.match(res.failures[0].message, /rq01/);
});

test('tests: --publish runs the test files of test/ and fails when they do', async () => {
  const root = copyRepo();
  withManifest(root);
  write(root, 'test/a.test.mjs', '');
  write(root, 'test/b.test.mjs', '');
  write(root, 'test/helper.mjs', '');
  let seen = null;
  const pass = await publish(root, { runTests: async (args) => { seen = args; return { ok: true }; } });
  assert.deepEqual(pass.failures, []);
  assert.deepEqual(seen.files, ['test/a.test.mjs', 'test/b.test.mjs', 'test/placeholder.test.mjs']);
  assert.equal(seen.root, root);
  const fail = await publish(root, { runTests: async () => ({ ok: false }) });
  assert.deepEqual(ids(fail), ['tests']);
  let ran = false;
  await check(root, { runTests: async () => { ran = true; return { ok: true }; } });
  assert.equal(ran, false);
});

test('--pre-push: a branch push runs nothing and exits 0; a v* tag push runs --publish', async () => {
  const calls = [];
  const fake = async (opts) => { calls.push(opts.mode); return { ok: true, failures: [], notes: [] }; };
  const io = (input) => ({ stdin: async () => input, runGate: fake, out: () => {}, err: () => {} });
  const branch = 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n';
  assert.equal(await main(['--pre-push', 'origin', 'git@example.invalid:x/y.git'], io(branch)), 0);
  assert.deepEqual(calls, []);
  const tag = `${branch}refs/tags/v0.3.0 2222222222222222222222222222222222222222 refs/tags/v0.3.0 0000000000000000000000000000000000000000\n`;
  assert.equal(await main(['--pre-push'], io(tag)), 0);
  assert.deepEqual(calls, ['publish']);
  const other = 'refs/tags/nightly 3333333333333333333333333333333333333333 refs/tags/nightly 0000000000000000000000000000000000000000\n';
  assert.equal(await main(['--pre-push'], io(other)), 0);
  assert.deepEqual(calls, ['publish']);
});

test('main: failures print one line each to stderr and exit 1; ok exits 0; bad usage exits 2', async () => {
  const errs = [];
  const bad = async () => ({ ok: false, failures: [{ id: 'versions', message: 'package.json says 1.0.0 — fix it' }, { id: 'links', message: 'README.md:3 — fix it' }], notes: [] });
  const code = await main(['--check', '--root', REAL], { runGate: bad, out: () => {}, err: (s) => errs.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(errs, ['versions: package.json says 1.0.0 — fix it', 'links: README.md:3 — fix it']);
  assert.equal(await main(['--check'], { runGate: async () => ({ ok: true, failures: [], notes: [] }), out: () => {}, err: () => {} }), 0);
  assert.equal(await main(['--root', join(tmpdir(), 'sm-gate-no-such-folder')], { runGate: bad, out: () => {}, err: () => {} }), 2);
  assert.equal(await main(['--frobnicate'], { runGate: bad, out: () => {}, err: () => {} }), 2);
});

test('as a script: a broken copy exits 1 and names the failure on stderr', () => {
  const root = copyRepo();
  edit(root, 'package.json', (t) => t.replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
  const run = spawnSync(process.execPath, [GATE, '--check', '--root', root], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^versions: /m);
});

test('as a script: a branch push through --pre-push exits 0 without running anything', () => {
  const run = spawnSync(process.execPath, [GATE, '--pre-push', 'origin', 'url'], {
    input: 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n',
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
});
