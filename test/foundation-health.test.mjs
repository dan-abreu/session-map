import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { healthOf, DRAFTABLE } from '../server/foundation/health.mjs';
import { CHECKS } from '../server/foundation/health-checks/index.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { draftFor } from '../server/foundation/health-drafts.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { readFd, writeFd, fdPath } from '../server/foundation/store.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ids = HEALTH_ITEMS.map((i) => i.id);
const everyCheck = (fn) => Object.fromEntries(ids.map((id) => [id, fn]));
const pass = () => ({ state: 'pass', evidence: [], reason: null, detail: {} });
const fail = () => ({ state: 'fail', evidence: [], reason: 'missing', detail: {} });

// log() writes one JSON line per event to stderr: keep the lines of one run so a test can read them.
async function withLog(fn) {
  const lines = [];
  const real = process.stderr.write;
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { return { value: await fn(), lines }; } finally { process.stderr.write = real; }
}
const warnings = (lines) => lines.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((e) => e.level === 'warn');

const ctxOf = (over = {}) => fakeHealthCtx({ files: { 'README.md': '# a\n' }, visibility: 'public', kinds: ['code', 'users'], ...over });
const run = (over = {}) => healthOf({ ctx: ctxOf(), now: NOW, ...over });
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-health-'));

test('every id of the catalog has a check and no check is left over', () => {
  assert.deepEqual(Object.keys(CHECKS).sort(), [...ids].sort());
  for (const [id, fn] of Object.entries(CHECKS)) assert.equal(typeof fn, 'function', id);
});

test('a check that throws becomes unverified error, never fail, and logs a warning', async () => {
  const checks = { ...everyCheck(pass), 'community.readme': () => { throw new Error('boom'); } };
  const { value: h, lines } = await withLog(() => run({ checks }));
  const item = h.items.find((i) => i.id === 'community.readme');
  assert.equal(item.state, 'unverified');
  assert.equal(item.reason, 'error');
  assert.ok(warnings(lines).some((w) => JSON.stringify(w).includes('community.readme')));
});

test('an async check that rejects becomes unverified error with a warning; one that resolves keeps its state', async () => {
  const checks = {
    ...everyCheck(pass),
    'security.no_secrets': async () => { throw new Error('git timed out'); },
    'security.no_binaries': async () => ({ state: 'fail', evidence: [{ file: 'a.exe' }], reason: 'unsafe', detail: { count: 1 } }),
  };
  const { value: h, lines } = await withLog(() => run({ checks }));
  const bad = h.items.find((i) => i.id === 'security.no_secrets');
  assert.equal(bad.state, 'unverified');
  assert.equal(bad.reason, 'error');
  assert.ok(warnings(lines).some((w) => JSON.stringify(w).includes('security.no_secrets')));
  const good = h.items.find((i) => i.id === 'security.no_binaries');
  assert.equal(good.state, 'fail');
  assert.deepEqual(good.evidence, [{ file: 'a.exe' }]);
  for (const it of h.items) {
    assert.ok(['pass', 'fail', 'unverified', 'na'].includes(it.state), `${it.id}: ${String(it.state)}`);
    assert.ok(!(it.state instanceof Promise));
  }
});

test('a check that answers with something that is not a state is unverified error too', async () => {
  const checks = { ...everyCheck(pass), 'community.readme': () => ({ state: 'great' }), 'community.license': () => null };
  const { value: h } = await withLog(() => run({ checks }));
  for (const id of ['community.readme', 'community.license']) {
    const item = h.items.find((i) => i.id === id);
    assert.equal(item.state, 'unverified');
    assert.equal(item.reason, 'error');
  }
});

test('a missing check is unverified error, not a silent pass', async () => {
  const checks = everyCheck(pass);
  delete checks['docs.glossary'];
  const { value: h, lines } = await withLog(() => run({ checks }));
  const item = h.items.find((i) => i.id === 'docs.glossary');
  assert.equal(item.state, 'unverified');
  assert.equal(item.reason, 'error');
  assert.ok(warnings(lines).length >= 1);
});

test('health.json carries the 91 items with category and severity, categories, coverage and api', async () => {
  const api = { version: 1, fetchedAt: '2026-10-10T10:00:00.000Z', mode: 'none', error: 'no-remote', repo: null, secretScanning: null };
  const h = await run({ checks: everyCheck(pass), api });
  assert.equal(h.version, 1);
  assert.equal(h.generatedAt, NOW.toISOString());
  assert.equal(h.items.length, 91);
  for (const it of h.items) {
    const cat = HEALTH_ITEMS.find((c) => c.id === it.id);
    assert.equal(it.category, cat.category);
    assert.equal(it.severity, cat.severity);
    assert.ok(Object.hasOwn(it, 'evidence') && Object.hasOwn(it, 'reason') && Object.hasOwn(it, 'fix'));
  }
  assert.deepEqual(Object.keys(h.categories).sort(), ['community', 'docs', 'extras', 'hygiene', 'management', 'product', 'releases', 'security']);
  const c = h.categories.community;
  assert.equal(c.pass + c.na + c.unverified + c.fail, 13);
  assert.equal(typeof h.coverage.verified, 'number');
  assert.equal(typeof h.coverage.applicable, 'number');
  assert.deepEqual(h.api, { mode: 'none', fetchedAt: '2026-10-10T10:00:00.000Z', error: 'no-remote' });
  assert.equal(h.visibility, 'public');
  assert.equal(h.visibilitySource, 'config');
  assert.equal(h.score, 100);
});

test('without the API answer the api summary says nothing was fetched', async () => {
  const h = await run({ checks: everyCheck(pass), api: null });
  assert.deepEqual(h.api, { mode: 'none', fetchedAt: null, error: null });
});

test('with nothing passed or failed the score is null, never zero', async () => {
  const h = await run({ checks: everyCheck(() => ({ state: 'unverified', evidence: [], reason: 'no-data', detail: {} })) });
  assert.equal(h.score, null);
  assert.equal(h.coverage.verified, 0);
  for (const c of Object.values(h.categories)) assert.equal(c.score, null);
});

test('everything failing is a real zero', async () => {
  const h = await run({ checks: everyCheck(fail) });
  assert.equal(h.score, 0);
});

test('an item the project does not owe is na with a reason and its check never runs', async () => {
  let ran = false;
  const checks = { ...everyCheck(pass), 'community.funding': () => { ran = true; return pass(); } };
  const h = await run({ checks, ctx: ctxOf({ visibility: 'private' }) });
  const item = h.items.find((i) => i.id === 'community.funding');
  assert.equal(item.state, 'na');
  assert.equal(item.reason, 'private');
  assert.equal(ran, false);
});

test('visibility unknown makes the public-only items unverified no-data, not fail', async () => {
  const h = await run({ checks: everyCheck(pass), ctx: ctxOf({ visibility: 'unknown' }) });
  const item = h.items.find((i) => i.id === 'community.funding');
  assert.equal(item.state, 'unverified');
  assert.equal(item.reason, 'no-data');
});

test('the check receives the env facts as ctx.facts', async () => {
  let seen = null;
  const checks = { ...everyCheck(pass), 'hygiene.env_example': (ctx) => { seen = ctx.facts; return pass(); } };
  const facts = { version: 1, facts: [{ id: 'env:DB_URL', kind: 'env', name: 'DB_URL', attrs: { source: 'code' } }, { id: 'route:GET /a', kind: 'route' }] };
  await run({ checks, facts });
  assert.deepEqual(seen.map((f) => f.id), ['env:DB_URL']);
});

test('only items that have a draft carry fix.kind draft, and the list matches health-drafts', async () => {
  const h = await run({ checks: everyCheck(pass) });
  const drafted = h.items.filter((i) => i.fix?.kind === 'draft').map((i) => i.id).sort();
  assert.deepEqual(drafted, [...DRAFTABLE].sort());
  for (const it of h.items) assert.equal(it.fix.opId, null);
  const input = {
    files: ['package.json'], packages: [{ dir: '', kind: 'node', scripts: { test: 'x', lint: 'y' } }],
    envNames: ['DB_URL'], projectName: 'acme', ecosystems: ['npm'], scripts: { test: 'x' },
  };
  for (const id of ids) assert.equal(draftFor(id, input) !== null, DRAFTABLE.includes(id), id);
});

test('detail and packages from the check are copied to the item', async () => {
  const checks = { ...everyCheck(pass), 'hygiene.tests': () => ({ state: 'fail', evidence: [], reason: 'missing', detail: { name: 'api' }, packages: [{ dir: 'apps/api', state: 'fail' }] }) };
  const h = await run({ checks });
  const item = h.items.find((i) => i.id === 'hygiene.tests');
  assert.deepEqual(item.detail, { name: 'api' });
  assert.deepEqual(item.packages, [{ dir: 'apps/api', state: 'fail' }]);
});

// ---------- the disk: only census.json is read, health.json is written ----------

test('writes health.json and a second call without change gives the very same file', async () => {
  const smDir = tmp();
  const root = tmp();
  try {
    const census = await censusOf(root, null, { now: NOW });
    const args = { root, smDir, id: 'acme-shop', census, checks: everyCheck(pass) };
    const first = await healthOf({ ...args, now: new Date('2026-10-10T12:00:00.000Z') });
    const file = fdPath(smDir, 'acme-shop', 'health.json');
    assert.ok(existsSync(file));
    const bytes1 = readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(bytes1), first);
    const second = await healthOf({ ...args, now: new Date('2026-10-10T18:30:00.000Z') });
    assert.equal(readFileSync(file, 'utf8'), bytes1);
    assert.equal(second.generatedAt, first.generatedAt);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

test('a change in a result gives a new generatedAt', async () => {
  const smDir = tmp();
  const root = tmp();
  try {
    const census = await censusOf(root, null, { now: NOW });
    const a = await healthOf({ root, smDir, id: 'acme-shop', census, checks: everyCheck(pass), now: NOW });
    const checks = { ...everyCheck(pass), 'community.readme': fail };
    const b = await healthOf({ root, smDir, id: 'acme-shop', census, checks, now: new Date('2026-10-11T08:00:00.000Z') });
    assert.notEqual(a.generatedAt, b.generatedAt);
    assert.equal(readFd(smDir, 'acme-shop', 'health.json', null).generatedAt, b.generatedAt);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

test('reads census.json from the store and never rebuilds it', async () => {
  const smDir = tmp();
  const root = tmp();
  try {
    const census = await censusOf(root, null, { now: NOW });
    writeFd(smDir, 'acme-shop', 'census.json', census);
    const before = readFileSync(fdPath(smDir, 'acme-shop', 'census.json'), 'utf8');
    const h = await healthOf({ root, smDir, id: 'acme-shop', checks: everyCheck(pass), now: NOW });
    assert.equal(h.items.length, 91);
    assert.equal(readFileSync(fdPath(smDir, 'acme-shop', 'census.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

test('without a census nothing is invented: null and no health.json', async () => {
  const smDir = tmp();
  try {
    const h = await healthOf({ root: tmp(), smDir, id: 'acme-shop', checks: everyCheck(pass), now: NOW });
    assert.equal(h, null);
    assert.equal(existsSync(fdPath(smDir, 'acme-shop', 'health.json')), false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('reads the API cache, versions and facts the other tasks saved', async () => {
  const smDir = tmp();
  const root = tmp();
  try {
    const census = await censusOf(root, null, { now: NOW });
    writeFd(smDir, 'acme-shop', 'census.json', census);
    writeFd(smDir, 'acme-shop', 'health-api.json', { version: 1, fetchedAt: '2026-10-10T11:00:00.000Z', mode: 'public', error: null, repo: { host: 'github.com', owner: 'ana', name: 'acme' }, visibility: 'public' });
    writeFd(smDir, 'acme-shop', 'versions.json', { code: { version: '1.0.0' }, pieces: [] });
    let seen = null;
    const checks = { ...everyCheck(pass), 'releases.tags': (ctx) => { seen = ctx; return pass(); } };
    const h = await healthOf({ root, smDir, id: 'acme-shop', checks, now: NOW });
    assert.equal(h.api.mode, 'public');
    assert.equal(h.api.fetchedAt, '2026-10-10T11:00:00.000Z');
    assert.equal(seen.versions.code.version, '1.0.0');
    assert.equal(seen.api.mode, 'public');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); }
});

test('the real catalog runs on the session-map repository (read only) and gives a plausible score and gaps', async () => {
  const root = resolve(import.meta.dirname, '..');
  const smDir = tmp();
  try {
    const census = await censusOf(root, null, { now: NOW });
    const { value: h } = await withLog(() => healthOf({ root, smDir, id: 'session-map', census, now: NOW }));
    assert.equal(h.items.length, 91);
    assert.ok(h.score === null || (h.score >= 0 && h.score <= 100));
    assert.ok(h.coverage.verified > 20, `verified ${h.coverage.verified}`);
    for (const it of h.items) assert.ok(['pass', 'fail', 'unverified', 'na'].includes(it.state), `${it.id} ${String(it.state)}`);
    assert.equal(JSON.stringify(h).includes('[object Promise]'), false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
