import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildRuleInput, commitDatesOf, imagesOf, readDocs, runDocwatch,
} from '../server/foundation/docwatch.mjs';
import { readFindings, setFindingState } from '../server/foundation/findings.mjs';
import { readFd } from '../server/foundation/store.mjs';

const ID = 'acme-shop-8324f1';
const NOW = () => Date.parse('2026-10-10T12:00:00Z');

const tmp = [];
const dir = (name) => { const d = mkdtempSync(join(tmpdir(), `sm-dw-${name}-`)); tmp.push(d); return d; };
test.after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function git(root, args, date) {
  const env = { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  return execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@acme.example', '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=none', ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true });
}
function commit(root, message, date) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message], date);
}
function repo(files, date = '2026-01-10T10:00:00Z') {
  const root = dir('repo');
  git(root, ['init', '-q']);
  put(root, files);
  commit(root, 'init', date);
  return root;
}

const row = (path, extra = {}) => ({
  path, type: path.split('.').pop(), kind: path.endsWith('.md') ? 'doc' : 'code', included: true, reason: null,
  bytes: 10, sha: `sha-${path}`, owner: 'p', lines: { total: 3, code: 3, comment: 0, blank: 0 }, ...extra,
});
const censusOf = (...paths) => ({ version: 1, files: paths.map((p) => (typeof p === 'string' ? row(p) : p)) });
const route = (method, path, file = 'apps/api/src/orders.ts') => ({
  id: `route:${method} ${path}`, kind: 'route', name: `${method} ${path}`, file, line: 3, sha: 'a1', origin: 'EXTRACTED',
  attrs: { method, path, framework: 'fastify' }, refs: [],
});
const factsOf = (...list) => ({ version: 1, facts: list });

// ---------- readDocs ----------

test('readDocs reads only the included Markdown files, never a secret or an oversize one', () => {
  const root = dir('read');
  put(root, { 'README.md': '# Shop\n', 'docs/a.md': 'a\n', 'docs/huge.md': 'x'.repeat(300), 'docs/off.md': 'off\n', '.env': 'TOKEN=abc\n', 'src/a.ts': 'x\n' });
  const census = censusOf('README.md', 'docs/a.md', 'docs/huge.md', row('docs/off.md', { included: false, reason: 'generated' }),
    row('.env', { kind: 'secret', included: false, reason: 'secret' }), 'src/a.ts');
  const { docs, truncated } = readDocs(root, census, { maxBytes: 200 });
  assert.deepEqual(docs.map((d) => d.path), ['README.md', 'docs/a.md']);
  assert.equal(docs[0].text, '# Shop\n');
  assert.equal(truncated, false);
});

test('readDocs stops at the cap and says so', () => {
  const root = dir('cap');
  put(root, { 'a.md': '1', 'b.md': '2', 'c.md': '3' });
  const { docs, truncated } = readDocs(root, censusOf('a.md', 'b.md', 'c.md'), { maxFiles: 2 });
  assert.equal(docs.length, 2);
  assert.equal(truncated, true);
});

test('readDocs skips a file that left the repository by a link', () => {
  const root = dir('gone');
  const { docs } = readDocs(root, censusOf('docs/missing.md', '../outside.md'));
  assert.deepEqual(docs, []);
});

// ---------- imagesOf ----------

test('imagesOf finds images, takes the shows marker from the line above or the same line, and skips outside links', () => {
  const docs = [{
    path: 'docs/guide.md',
    text: [
      '# Guide', '',
      '<!-- shows: apps/web/app/page.tsx -->',
      '![Home](img/home.png)', '',
      '![Orders](img/orders.png?raw=1)', '',
      '<!-- shows: apps/web/app/cart/page.tsx --> ![Cart](img/cart.png)', '',
      '![Remote](https://example.com/x.png)', '',
      '[a page](other.md)', '',
      '```', '![Code](img/in-code.png)', '```', '',
      '<img src="img/logo.svg" alt="logo">', '',
    ].join('\n'),
  }];
  const images = imagesOf(docs);
  assert.deepEqual(images.map((i) => [i.image, i.shows, i.line, i.doc]), [
    ['img/home.png', 'apps/web/app/page.tsx', 4, 'docs/guide.md'],
    ['img/orders.png', null, 6, 'docs/guide.md'],
    ['img/cart.png', 'apps/web/app/cart/page.tsx', 8, 'docs/guide.md'],
    ['img/logo.svg', null, 18, 'docs/guide.md'],
  ]);
});

// ---------- commitDatesOf ----------

test('commitDatesOf gives the date of the last commit that touched each file', async () => {
  const root = repo({ 'a.txt': '1', 'b.txt': '1' }, '2026-01-10T10:00:00Z');
  put(root, { 'a.txt': '2', 'sub dir/c.txt': 'new' });
  commit(root, 'second', '2026-03-05T10:00:00Z');
  const dates = await commitDatesOf(root);
  assert.ok(dates instanceof Map);
  assert.equal(new Date(dates.get('a.txt')).toISOString().slice(0, 10), '2026-03-05');
  assert.equal(new Date(dates.get('b.txt')).toISOString().slice(0, 10), '2026-01-10');
  assert.equal(new Date(dates.get('sub dir/c.txt')).toISOString().slice(0, 10), '2026-03-05');
});

test('commitDatesOf reads only as many commits as the cap and survives a folder with no git', async () => {
  const root = repo({ 'a.txt': '1' }, '2026-01-10T10:00:00Z');
  put(root, { 'b.txt': '1' });
  commit(root, 'second', '2026-02-10T10:00:00Z');
  const dates = await commitDatesOf(root, { maxCommits: 1 });
  assert.equal(dates.has('b.txt'), true);
  assert.equal(dates.has('a.txt'), false);
  assert.equal((await commitDatesOf(dir('nogit'))).size, 0);
});

// ---------- runDocwatch ----------

function shop() {
  return repo({
    'README.md': '# Shop\n\nList orders with `GET /orders`.\n',
    'docs/api.md': '# API\n\n- `GET /orders` lists them\n',
    'docs/other.md': 'Use `GET /purchases` instead.\n',
    'apps/api/src/orders.ts': 'export const x = 1;\n',
  });
}
const shopArgs = (root, smDir, extra = {}) => ({
  root, smDir, id: ID, now: NOW,
  census: censusOf('README.md', 'docs/api.md', 'docs/other.md', 'apps/api/src/orders.ts'),
  facts: factsOf(route('GET', '/purchases')),
  ...extra,
});

test('after a route is renamed every document that still cites the old one becomes a finding, and only those', async () => {
  const root = shop();
  const smDir = dir('sm');
  const res = await runDocwatch(shopArgs(root, smDir));
  assert.equal(res.ok, true);
  const cites = res.findings.filter((f) => f.rule === 'doc-cites-missing');
  assert.deepEqual(cites.map((f) => f.target.file).sort(), ['README.md', 'docs/api.md']);
  assert.ok(cites.every((f) => f.state === 'open' && f.firstSeen === '2026-10-10T12:00:00.000Z'));
  assert.deepEqual(readFindings(smDir, ID).map((f) => f.id).sort(), res.findings.map((f) => f.id).sort());
});

test('a second identical round gives the same ids and keeps firstSeen', async () => {
  const root = shop();
  const smDir = dir('sm');
  const first = await runDocwatch(shopArgs(root, smDir));
  const later = await runDocwatch(shopArgs(root, smDir, { now: () => NOW() + 3_600_000 }));
  assert.deepEqual(later.findings.map((f) => f.id).sort(), first.findings.map((f) => f.id).sort());
  const one = later.findings.find((f) => f.rule === 'doc-cites-missing');
  assert.equal(one.firstSeen, '2026-10-10T12:00:00.000Z');
  assert.equal(one.lastSeen, '2026-10-10T13:00:00.000Z');
});

test('Never stays when the document is fixed, and an accepted finding becomes applied', async () => {
  const root = shop();
  const smDir = dir('sm');
  const first = await runDocwatch(shopArgs(root, smDir));
  const [a, b] = first.findings.filter((f) => f.rule === 'doc-cites-missing');
  assert.equal(setFindingState(smDir, ID, a.id, 'never').ok, true);
  assert.equal(setFindingState(smDir, ID, b.id, 'accepted').ok, true);
  put(root, { 'README.md': '# Shop\n\nList orders with `GET /purchases`.\n', 'docs/api.md': '# API\n\n- `GET /purchases` lists them\n' });
  const next = await runDocwatch(shopArgs(root, smDir));
  const state = (id) => next.findings.find((f) => f.id === id)?.state;
  assert.equal(state(a.id), 'never');
  assert.equal(state(b.id), 'applied');
});

test('code without a document is a small thing on the first round and important when the code is new', async () => {
  const root = repo({ 'README.md': '# Shop\n', 'apps/api/src/orders.ts': 'x\n', 'apps/api/src/fresh.ts': 'x\n' });
  const smDir = dir('sm');
  const census = censusOf('README.md', 'apps/api/src/orders.ts', 'apps/api/src/fresh.ts');
  const args = (facts) => ({ root, smDir, id: ID, now: NOW, census, facts });
  const first = await runDocwatch(args(factsOf(route('GET', '/orders'))));
  assert.equal(first.findings.find((f) => f.rule === 'code-without-doc').severity, 'detail');
  const second = await runDocwatch(args(factsOf(route('GET', '/orders'), route('POST', '/fresh', 'apps/api/src/fresh.ts'))));
  const fresh = second.findings.find((f) => f.rule === 'code-without-doc' && f.target.file === 'apps/api/src/fresh.ts');
  assert.equal(fresh.severity, 'important');
  const old = second.findings.find((f) => f.rule === 'code-without-doc' && f.target.file === 'apps/api/src/orders.ts');
  assert.equal(old.severity, 'detail');
  assert.ok(readFd(smDir, ID, 'docwatch.json', null).factIds.includes('route:POST /fresh'));
});

test('a screenshot older than the last change of its screen is a finding, one that is newer is not', async () => {
  const root = repo({
    'docs/guide.md': '# Guide\n\n<!-- shows: apps/web/app/page.tsx -->\n![Home](img/home.png)\n',
    'img/home.png': 'png1', 'apps/web/app/page.tsx': 'v1\n',
  }, '2026-01-10T10:00:00Z');
  put(root, { 'apps/web/app/page.tsx': 'v2\n' });
  commit(root, 'screen changed', '2026-04-10T10:00:00Z');
  const smDir = dir('sm');
  const args = { root, smDir, id: ID, now: NOW, census: censusOf('docs/guide.md', 'img/home.png', 'apps/web/app/page.tsx'), facts: factsOf() };
  const stale = await runDocwatch(args);
  const hit = stale.findings.find((f) => f.rule === 'stale-image');
  assert.ok(hit);
  assert.equal(hit.target.file, 'docs/guide.md');
  assert.equal(hit.origin, 'DECLARED');
  put(root, { 'img/home.png': 'png2' });
  commit(root, 'new shot', '2026-05-10T10:00:00Z');
  const fresh = await runDocwatch({ ...args, smDir: dir('sm') });
  assert.equal(fresh.findings.some((f) => f.rule === 'stale-image'), false);
});

test('a document much longer than its limit is a doc-size finding that carries the config limits', async () => {
  const body = Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n');
  const root = repo({ 'README.md': `# Shop\n\n${body}\n` });
  const census = censusOf('README.md');
  const big = await runDocwatch({ root, smDir: dir('sm'), id: ID, now: NOW, census, facts: factsOf() });
  assert.ok(big.findings.some((f) => f.rule === 'doc-size' && f.what.params.lines > 400));
  const lenient = await runDocwatch({ root, smDir: dir('sm'), id: ID, now: NOW, census, facts: factsOf(), config: { docLimits: { readme: { warn: 900, strong: 1000 } } } });
  assert.equal(lenient.findings.some((f) => f.rule === 'doc-size'), false);
});

test('one rule that breaks does not stop the others', async () => {
  const root = shop();
  const smDir = dir('sm');
  const boom = Object.assign(() => { throw new Error('boom'); }, { ruleName: 'boom' });
  const res = await runDocwatch(shopArgs(root, smDir), { extraRules: [boom] });
  assert.equal(res.ok, true);
  assert.ok(res.findings.some((f) => f.rule === 'doc-cites-missing'));
  assert.deepEqual(res.failedRules, ['boom']);
});

test('without a census nothing is written and the old findings stay', async () => {
  const root = shop();
  const smDir = dir('sm');
  await runDocwatch(shopArgs(root, smDir));
  const before = readFileSync(join(smDir, 'brain', ID, 'foundation', 'findings.json'), 'utf8');
  const res = await runDocwatch({ root, smDir, id: ID, now: NOW, census: null, facts: null });
  assert.deepEqual([res.ok, res.error], [false, 'no-census']);
  assert.equal(readFileSync(join(smDir, 'brain', ID, 'foundation', 'findings.json'), 'utf8'), before);
});

test('buildRuleInput hands the rules the documents, images and dates the caller can reuse', async () => {
  const root = shop();
  const input = await buildRuleInput(shopArgs(root, dir('sm')));
  assert.deepEqual(input.docs.map((d) => d.path), ['README.md', 'docs/api.md', 'docs/other.md']);
  assert.ok(input.commitDates instanceof Map);
  assert.deepEqual(input.images, []);
  assert.equal(input.root, root);
});
