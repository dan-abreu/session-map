import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';
import { readTextOf, scanManifests } from '../server/foundation/profile-stacks.mjs';
import { signalsOf, teamOf, gitAuthors, deployOf, SIGNAL_KINDS } from '../server/foundation/profile-signals.mjs';

const table = (name, columns, file = 'db/schema.prisma') => ({
  id: `table:${name}`, kind: 'table', name, file, line: 1, sha: 'aaa111', origin: 'EXTRACTED', attrs: { source: 'prisma', columns }, refs: [],
});
const col = (name, line) => ({ name, type: 'String', line });
const route = (path, file = 'api/routes.ts', line = 3) => ({ id: `route:GET ${path}`, kind: 'route', name: `GET ${path}`, file, line, sha: 'bbb222', origin: 'EXTRACTED', attrs: { method: 'GET', path, framework: 'fastify' }, refs: [] });
const integration = (id, attrs, file = 'src/pay.ts', line = 1) => ({ id: `integration:${id}`, kind: 'integration', file, line, sha: 'ccc333', origin: 'EXTRACTED', attrs, refs: [] });
const dep = (name, file = 'package.json', line = 5) => ({ name, version: '1.0.0', file, line, sha: 'ddd444', dev: false, eco: 'npm' });
const kindsOf = (signals) => signals.map((s) => s.kind);
const get = (signals, kind) => signals.find((s) => s.kind === kind);

// ---------- personal-data ----------

test('personal-data: a cpf column is the signal, with the evidence on the column line', () => {
  const signals = signalsOf({ facts: [table('Customer', [col('id', 4), col('cpf', 5)])], deps: [] });
  const s = get(signals, 'personal-data');
  assert.deepEqual(s.evidence, [{ file: 'db/schema.prisma', line: 5, sha: 'aaa111', factId: 'table:Customer' }]);
});

test('personal-data: a column called name alone is not personal data', () => {
  assert.deepEqual(signalsOf({ facts: [table('Product', [col('id', 2), col('name', 3), col('title', 4)])], deps: [] }), []);
});

test('personal-data: first/last/full name, email, phone, birth date and address count; camelCase and prefixes too', () => {
  const names = ['email', 'customerEmail', 'phone_number', 'birth_date', 'firstName', 'last_name', 'full_name', 'zip_code', 'street', 'ssn'];
  const columns = names.map((n, i) => col(n, i + 2));
  const s = get(signalsOf({ facts: [table('T', columns)], deps: [] }), 'personal-data');
  assert.deepEqual(s.evidence.map((e) => e.line), names.map((_, i) => i + 2));
});

test('personal-data: column names that only look alike do not count', () => {
  const columns = ['username_count', 'emailer_id', 'status', 'named', 'addressee_count'].map((n, i) => col(n, i + 2));
  assert.deepEqual(kindsOf(signalsOf({ facts: [table('T', columns)], deps: [] })), []);
});

test('personal-data: a table without columns gives nothing and does not crash', () => {
  assert.deepEqual(signalsOf({ facts: [{ ...table('T', []), attrs: { source: 'prisma' } }], deps: [] }), []);
});

// ---------- payments ----------

test('payments: stripe as a dependency is the signal, with the manifest line', () => {
  const s = get(signalsOf({ facts: [], deps: [dep('stripe', 'packages/adapters/package.json', 6)] }), 'payments');
  assert.deepEqual(s.evidence, [{ file: 'packages/adapters/package.json', line: 6, sha: 'ddd444' }]);
});

test('payments: an integration fact with a payment sdk or host is the signal', () => {
  const sdk = get(signalsOf({ facts: [integration('mercadopago', { via: 'sdk', package: 'mercadopago' })], deps: [] }), 'payments');
  assert.equal(sdk.evidence[0].factId, 'integration:mercadopago');
  const url = get(signalsOf({ facts: [integration('api.stripe.com', { via: 'url', host: 'api.stripe.com' })], deps: [] }), 'payments');
  assert.equal(url.evidence[0].file, 'src/pay.ts');
});

test('payments: a checkout or billing route is the signal; a plain orders route is not', () => {
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/v1/orders')], deps: [] })), []);
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/v1/checkout/session')], deps: [] })), ['payments']);
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/api/billing')], deps: [] })), ['payments']);
});

test('payments: the word only counts as a whole path segment', () => {
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/api/paymentsish'), route('/prepayment-notes')], deps: [] })), []);
});

// ---------- login, uploads, location ----------

test('login: an auth dependency, a login route or a password column', () => {
  assert.deepEqual(kindsOf(signalsOf({ facts: [], deps: [dep('next-auth')] })), ['login']);
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/auth/login')], deps: [] })), ['login']);
  assert.deepEqual(kindsOf(signalsOf({ facts: [table('User', [col('id', 2), col('passwordHash', 3)])], deps: [] })), ['login']);
});

test('uploads: a multipart or storage dependency, or an upload route', () => {
  assert.deepEqual(kindsOf(signalsOf({ facts: [], deps: [dep('multer')] })), ['uploads']);
  assert.deepEqual(kindsOf(signalsOf({ facts: [route('/v1/uploads')], deps: [] })), ['uploads']);
});

test('location: a geolocation package or latitude/longitude columns', () => {
  assert.deepEqual(kindsOf(signalsOf({ facts: [], deps: [{ ...dep('geolocator'), eco: 'pub' }] })), ['location']);
  assert.deepEqual(kindsOf(signalsOf({ facts: [table('Place', [col('latitude', 2), col('lng', 3)])], deps: [] })), ['location']);
});

test('signals come out in the contract order, once each, evidence sorted and capped', () => {
  const columns = Array.from({ length: 30 }, (_, i) => col(`email_${i}`, i + 2));
  const signals = signalsOf({ facts: [table('T', columns), route('/login')], deps: [dep('stripe'), dep('multer'), dep('leaflet')] });
  assert.deepEqual(kindsOf(signals), ['personal-data', 'payments', 'login', 'uploads', 'location']);
  assert.ok(SIGNAL_KINDS.join() === kindsOf(signals).join());
  assert.equal(get(signals, 'personal-data').evidence.length, 10);
});

test('signals: no facts and no deps means no signal', () => {
  assert.deepEqual(signalsOf({ facts: [], deps: [] }), []);
  assert.deepEqual(signalsOf({}), []);
});

// ---------- team ----------

test('teamOf: one human and dependabot[bot] is solo with 1 author', () => {
  assert.deepEqual(teamOf([{ name: 'Ana', commits: 40 }, { name: 'dependabot[bot]', commits: 12 }]), { kind: 'solo', authors: 1 });
});

test('teamOf: two humans is a team; bots never count', () => {
  assert.deepEqual(teamOf([{ name: 'Ana', commits: 4 }, { name: 'Bia', commits: 2 }, { name: 'renovate[bot]', commits: 9 }, { name: 'github-actions[bot]', commits: 3 }]), { kind: 'team', authors: 2 });
});

test('teamOf: plain name strings and anonymous entries work; nobody is named in the answer', () => {
  assert.deepEqual(teamOf(['Ana', 'dependabot[bot]']), { kind: 'solo', authors: 1 });
  assert.deepEqual(teamOf([{ commits: 3, bot: false }, { commits: 1, bot: true }]), { kind: 'solo', authors: 1 });
  const out = teamOf([{ name: 'Ana', email: 'ana@example.com', commits: 4 }]);
  assert.ok(!JSON.stringify(out).includes('Ana') && !JSON.stringify(out).includes('example'));
});

test('teamOf: nobody (empty history, git missing) is an unknown kind, not solo', () => {
  assert.deepEqual(teamOf([]), { kind: null, authors: 0 });
  assert.deepEqual(teamOf(null), { kind: null, authors: 0 });
});

// ---------- gitAuthors (the only I/O) ----------

function git(root, args, env = {}) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=none', ...args], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...env },
  });
}
function commit(root, name, email, file) {
  writeFileSync(join(root, file), `${file}\n`);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', `add ${file}`], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
}

test('gitAuthors: counts per author with bots marked, and never a name or an e-mail in the answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-authors-'));
  try {
    git(root, ['init', '-q']);
    commit(root, 'Ana', 'ana@example.com', 'a.txt');
    commit(root, 'Ana', 'ana@example.com', 'b.txt');
    commit(root, 'dependabot[bot]', 'bot@example.com', 'c.txt');
    const authors = await gitAuthors(root);
    assert.deepEqual(authors.map((a) => ({ commits: a.commits, bot: a.bot })).sort((x, y) => y.commits - x.commits), [{ commits: 2, bot: false }, { commits: 1, bot: true }]);
    const text = JSON.stringify(authors);
    assert.ok(!/Ana|dependabot|example\.com/.test(text), text);
    assert.deepEqual(teamOf(authors), { kind: 'solo', authors: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('gitAuthors: a folder that is not a repository gives an empty list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-authors-'));
  try {
    assert.deepEqual(await gitAuthors(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------- deployOf ----------

const censusOfPaths = (paths) => ({ files: paths.map((path) => ({ path, included: true, sha: 'eee555', lines: { total: 7, code: 7, comment: 0, blank: 0 } })) });

test('deployOf: the known deploy files name the service, with the file as evidence', () => {
  const found = deployOf({ census: censusOfPaths(['railway.json', 'Dockerfile', 'codemagic.yaml', 'vercel.json', 'fly.toml', 'netlify.toml', 'render.yaml', 'Procfile', 'firebase.json', 'eas.json', 'wrangler.toml', 'src/a.ts']) });
  assert.deepEqual(found.map((d) => d.name), ['cloudflare', 'codemagic', 'docker', 'eas', 'firebase', 'fly', 'heroku', 'netlify', 'railway', 'render', 'vercel']);
  const railway = found.find((d) => d.name === 'railway');
  assert.deepEqual(railway.evidence, [{ file: 'railway.json', line: 1, sha: 'eee555' }]);
});

test('deployOf: docker comes from Dockerfile variants and compose files, in any folder, listed once', () => {
  const found = deployOf({ census: censusOfPaths(['apps/api/Dockerfile', 'Dockerfile.prod', 'docker-compose.yml', 'compose.yaml']) });
  assert.deepEqual(found.map((d) => d.name), ['docker']);
  assert.equal(found[0].evidence.length, 4);
});

test('deployOf: a file that is not included is not evidence; no known file means nothing', () => {
  const census = { files: [{ path: 'vercel.json', included: false, sha: null }, { path: 'src/a.ts', included: true, sha: 'x' }] };
  assert.deepEqual(deployOf({ census }), []);
  assert.deepEqual(deployOf({ census: { files: [] } }), []);
  assert.deepEqual(deployOf({}), []);
});

// ---------- the three invented repositories ----------

async function onFixture(name, fn) {
  const root = copyFixtureRepo(name);
  try {
    const census = await censusOf(root, null);
    const facts = extractAll(root, census, null, {}).facts;
    const scan = scanManifests({ census, readText: readTextOf(root) });
    await fn({ root, census, facts, scan });
  } finally { removeFixtureRepo(root); }
}

test('acme-shop: personal-data from the email column and payments from stripe, every evidence line exists', async () => {
  await onFixture('acme-shop', async ({ root, facts, scan }) => {
    const signals = signalsOf({ facts, deps: scan.deps });
    assert.deepEqual(kindsOf(signals), ['personal-data', 'payments']);
    const email = get(signals, 'personal-data').evidence[0];
    assert.equal(email.file, 'packages/db/prisma/schema.prisma');
    assert.equal(email.line, 18);
    assert.equal(get(signals, 'payments').evidence[0].file, 'packages/adapters/package.json');
    const { readFileSync } = await import('node:fs');
    for (const s of signals) for (const e of s.evidence) {
      const lines = readFileSync(join(root, e.file), 'utf8').split('\n');
      assert.ok(e.line >= 1 && e.line <= lines.length, `${e.file}:${e.line}`);
    }
  });
});

test('acme-delivery and acme-lib: no signal, no deploy file', async () => {
  for (const name of ['acme-delivery', 'acme-lib']) {
    await onFixture(name, async ({ census, facts, scan }) => {
      assert.deepEqual(signalsOf({ facts, deps: scan.deps }), [], name);
      assert.deepEqual(deployOf({ census }), [], name);
    });
  }
});

test('no output of this file has an author name or an e-mail', async () => {
  await onFixture('acme-shop', async ({ census, facts, scan }) => {
    const all = JSON.stringify({ signals: signalsOf({ facts, deps: scan.deps }), deploy: deployOf({ census }), team: teamOf(await gitAuthors(process.cwd())) });
    assert.ok(!/@[a-z]+\.[a-z]+/.test(all), all);
  });
});
