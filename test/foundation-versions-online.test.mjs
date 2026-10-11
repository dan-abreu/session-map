import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSources, fetchJson, liveUrlProblem, repoOfPackage, ONLINE_HOSTS, VERSIONS_TTL_MS,
} from '../server/foundation/versions-online.mjs';
import { warningOf, pieceKey } from '../server/foundation/versions-core.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

// A fake network: answers by URL, records every call. Unknown URL = 404.
function fakeNet(routes = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [prefix, answer] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return typeof answer === 'function' ? answer(String(url), init) : answer.clone();
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchFn, calls };
}

const OSV = 'https://api.osv.dev/v1/querybatch';
const NEXT = { name: 'next', ecosystem: 'npm', version: '^16.0.1', file: 'apps/web/package.json', line: 12, range: '^16.0.1' };
const NODE_EOL = [{ cycle: '20', releaseDate: '2023-04-18', eol: '2026-04-30', latest: '20.19.0', lts: '2023-10-24' },
  { cycle: '22', releaseDate: '2024-04-24', eol: '2027-04-30', latest: '22.20.0' }];

// ---------- OSV (fd09: a framework with a known advisory shows the warning) ----------
test('an OSV answer with an advisory marks the piece vulnerable', async () => {
  const { fetchFn } = fakeNet({ [OSV]: json({ results: [{ vulns: [{ id: 'GHSA-aaaa-bbbb-cccc', modified: 'x' }] }] }) });
  const sources = await fetchSources({ pieces: [NEXT], fetchFn, now: NOW });
  assert.deepEqual(sources.vulns[pieceKey({ ...NEXT, version: '16.0.1' })], ['GHSA-aaaa-bbbb-cccc']);
  const w = warningOf(NEXT, { ...sources, now: NOW });
  assert.equal(w.verified, true);
  assert.equal(w.warning.kind, 'vulnerable');
  assert.deepEqual(w.warning.ids, ['GHSA-aaaa-bbbb-cccc']);
});

test('an empty OSV result still counts as an answer: verified, no warning', async () => {
  const { fetchFn } = fakeNet({ [OSV]: json({ results: [{}] }) });
  const sources = await fetchSources({ pieces: [NEXT], fetchFn, now: NOW });
  assert.deepEqual(sources.vulns['npm:next@16.0.1'], []);
  const w = warningOf(NEXT, { ...sources, now: NOW });
  assert.equal(w.verified, true);
  assert.equal(w.warning, null);
});

test('only the name, the ecosystem and the version of each package go to OSV', async () => {
  const { fetchFn, calls } = fakeNet({ [OSV]: json({ results: [{}, {}, {}] }) });
  await fetchSources({
    pieces: [NEXT, { name: 'laravel/framework', ecosystem: 'packagist', version: '^11.2', file: 'backend/composer.json', line: 9 },
      { name: 'dio', ecosystem: 'pub', version: '5.4.0', file: 'apps/customer/pubspec.yaml', line: 20 },
      { name: 'node', ecosystem: 'runtime', version: '>=20', file: 'package.json', line: 10 }],
    fetchFn, now: NOW,
  });
  const osv = calls.filter((c) => c.url === OSV);
  assert.equal(osv.length, 1);
  assert.equal(osv[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(osv[0].init.body), { queries: [
    { package: { name: 'next', ecosystem: 'npm' }, version: '16.0.1' },
    { package: { name: 'laravel/framework', ecosystem: 'Packagist' }, version: '11.2.0' },
    { package: { name: 'dio', ecosystem: 'Pub' }, version: '5.4.0' },
  ] });
  assert.doesNotMatch(osv[0].init.body, /apps\/|package\.json|composer|line/);
});

test('an OSV answer with the wrong number of results is not trusted', async () => {
  const { fetchFn } = fakeNet({ [OSV]: json({ results: [] }) });
  const sources = await fetchSources({ pieces: [NEXT], fetchFn, now: NOW });
  assert.equal(Object.hasOwn(sources.vulns, 'npm:next@16.0.1'), false);
  assert.equal(warningOf(NEXT, sources).verified, false);
});

// ---------- registries, end of life, session-map's own tags ----------
test('registries give the latest version: npm dist-tags, Packagist p2 (highest stable), pub.dev', async () => {
  const { fetchFn, calls } = fakeNet({
    'https://registry.npmjs.org/-/package/next/dist-tags': json({ latest: '18.2.0', canary: '18.3.0-canary.1' }),
    'https://registry.npmjs.org/-/package/@nestjs/core/dist-tags': json({ latest: '12.1.2' }),
    'https://repo.packagist.org/p2/laravel/framework.json': json({ packages: { 'laravel/framework': [
      { version: 'v12.9.0' }, { version: 'v13.1.0' }, { version: 'v13.2.0-beta1' }, { version: '13.0.0' }] } }),
    'https://pub.dev/api/packages/dio': json({ name: 'dio', latest: { version: '5.11.1' } }),
  });
  const sources = await fetchSources({
    pieces: [NEXT, { name: '@nestjs/core', ecosystem: 'npm', version: '11.0.0' },
      { name: 'laravel/framework', ecosystem: 'packagist', version: '^11.2' }, { name: 'dio', ecosystem: 'pub', version: '5.4.0' }],
    fetchFn, now: NOW,
  });
  assert.equal(sources.latest['npm:next'], '18.2.0');
  assert.equal(sources.latest['npm:@nestjs/core'], '12.1.2');
  assert.equal(sources.latest['packagist:laravel/framework'], '13.1.0');
  assert.equal(sources.latest['pub:dio'], '5.11.1');
  assert.equal(warningOf(NEXT, { ...sources, vulns: {} }).warning.kind, 'behind');
  assert.ok(calls.every((c) => ONLINE_HOSTS.includes(new URL(c.url).hostname)), 'only listed hosts');
});

test('a package name that is not a valid registry name never reaches a URL', async () => {
  const { fetchFn, calls } = fakeNet({ [OSV]: json({ results: [] }) });
  await fetchSources({ pieces: [{ name: '../../evil?x=1', ecosystem: 'npm', version: '1.0.0' },
    { name: 'a/../b', ecosystem: 'packagist', version: '1.0.0' }, { name: 'Bad-Name', ecosystem: 'pub', version: '1.0.0' }], fetchFn, now: NOW });
  assert.equal(calls.length, 0);
});

test('endoflife.date answers Node: an ended cycle becomes the eol warning, only cycle and eol are kept', async () => {
  const { fetchFn, calls } = fakeNet({ 'https://endoflife.date/api/nodejs.json': json(NODE_EOL) });
  const sources = await fetchSources({ pieces: [], node: { running: '20.11.0', required: '>=20' }, fetchFn, now: NOW });
  assert.deepEqual(calls.map((c) => c.url), ['https://endoflife.date/api/nodejs.json']);
  assert.deepEqual(sources.eol.node, [{ cycle: '20', eol: '2026-04-30' }, { cycle: '22', eol: '2027-04-30' }]);
  const w = warningOf({ name: 'node', ecosystem: 'runtime', version: '20.11.0' }, { ...sources, now: NOW });
  assert.equal(w.warning.kind, 'eol');
});

test("session-map's own version: the highest semver tag on GitHub, anonymous, says when a newer one exists", async () => {
  const { fetchFn, calls } = fakeNet({
    'https://api.github.com/repos/acme/session-map/tags': json([{ name: 'v0.2.5' }, { name: 'v0.3.0' }, { name: 'v0.10.1k' }, { name: 'v0.4.0-rc.1' }]),
  });
  const sources = await fetchSources({ pieces: [], selfVersion: '0.2.5', selfRepo: 'acme/session-map', fetchFn, now: NOW });
  assert.deepEqual(sources.self, { current: '0.2.5', latest: '0.3.0', newer: true, verified: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers?.authorization ?? calls[0].init.headers?.Authorization, undefined);
});

test('the repository of session-map comes from its package.json', () => {
  assert.equal(repoOfPackage({ repository: { url: 'git+https://github.com/acme/session-map.git' } }), 'acme/session-map');
  assert.equal(repoOfPackage({ repository: 'github:acme/tool' }), 'acme/tool');
  assert.equal(repoOfPackage({ repository: { url: 'https://gitlab.com/acme/x.git' } }), null);
  assert.equal(repoOfPackage({}), null);
});

// ---------- network rules ----------
test('a host outside the fixed list is refused before any request', async () => {
  const { fetchFn, calls } = fakeNet();
  for (const url of ['https://evil.example/x', 'http://registry.npmjs.org/-/package/next/dist-tags',
    'https://registry.npmjs.org.evil.example/x', 'https://user:pw@api.osv.dev/v1/querybatch', 'https://api.osv.dev:8443/v1']) {
    assert.equal(await fetchJson(url, { fetchFn }), null, url);
  }
  assert.equal(calls.length, 0);
});

test('requests never follow a redirect, carry a time limit and refuse a body over 1 MB', async () => {
  const big = 'x'.repeat(1024 * 1024 + 10);
  const { fetchFn, calls } = fakeNet({
    'https://pub.dev/api/packages/moved': new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    'https://pub.dev/api/packages/big': new Response(`{"latest":{"version":"1.0.0"},"pad":"${big}"}`, { status: 200 }),
    'https://pub.dev/api/packages/ok': json({ latest: { version: '1.0.0' } }),
  });
  assert.equal(await fetchJson('https://pub.dev/api/packages/moved', { fetchFn }), null);
  assert.equal(await fetchJson('https://pub.dev/api/packages/big', { fetchFn }), null);
  assert.deepEqual(await fetchJson('https://pub.dev/api/packages/ok', { fetchFn }), { latest: { version: '1.0.0' } });
  for (const c of calls) {
    assert.equal(c.init.redirect, 'manual');
    assert.ok(c.init.signal instanceof AbortSignal);
  }
});

test('a request that answered from another host (followed redirect) is refused', async () => {
  const fetchFn = async () => {
    const res = json({ latest: { version: '9.9.9' } });
    Object.defineProperty(res, 'url', { value: 'https://evil.example/dio' });
    Object.defineProperty(res, 'redirected', { value: true });
    return res;
  };
  assert.equal(await fetchJson('https://pub.dev/api/packages/dio', { fetchFn }), null);
});

test('a request past the time limit gives null, not an exception', async () => {
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  assert.equal(await fetchJson('https://pub.dev/api/packages/dio', { fetchFn, timeoutMs: 20 }), null);
});

// ---------- the live endpoint ----------
test('the live endpoint with a version different from the code gives match:false', async () => {
  const { fetchFn } = fakeNet({ 'https://app.acme.example/version': json({ version: '1.1.0' }) });
  const sources = await fetchSources({ pieces: [], liveUrl: 'https://app.acme.example/version', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.deepEqual(sources.live, { url: 'https://app.acme.example/version', version: '1.1.0', match: false, checkedAt: NOW.toISOString() });
});

test('the live endpoint may answer plain text; same version gives match:true; loopback http is allowed', async () => {
  const { fetchFn } = fakeNet({ 'http://127.0.0.1:4100/version': new Response('v1.2.0\n', { status: 200 }) });
  const sources = await fetchSources({ pieces: [], liveUrl: 'http://127.0.0.1:4100/version', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.equal(sources.live.version, '1.2.0');
  assert.equal(sources.live.match, true);
});

test('live: http outside loopback, a redirect and a body over 4 KB are refused', async () => {
  assert.equal(liveUrlProblem('http://app.acme.example/version'), 'insecure');
  assert.equal(liveUrlProblem('http://localhost:3000/v'), null);
  assert.equal(liveUrlProblem('http://[::1]:3000/v'), null);
  assert.equal(liveUrlProblem('https://ana:pw@app.acme.example/v'), 'credentials');
  assert.equal(liveUrlProblem('file:///etc/passwd'), 'insecure');
  assert.equal(liveUrlProblem('not a url'), 'invalid');

  const { fetchFn, calls } = fakeNet({
    'https://moved.acme.example/': new Response(null, { status: 301, headers: { location: 'http://10.0.0.1/' } }),
    'https://big.acme.example/': new Response(`{"version":"1.2.0","pad":"${'x'.repeat(5000)}"}`, { status: 200 }),
  });
  const insecure = await fetchSources({ pieces: [], liveUrl: 'http://app.acme.example/version', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.equal(calls.length, 0, 'never asked');
  assert.equal(insecure.live.version, null);
  assert.equal(insecure.live.match, null);
  assert.equal(insecure.live.error, 'insecure');

  const moved = await fetchSources({ pieces: [], liveUrl: 'https://moved.acme.example/', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.equal(moved.live.version, null);
  const big = await fetchSources({ pieces: [], liveUrl: 'https://big.acme.example/', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.equal(big.live.version, null);
  assert.equal(calls.every((c) => c.init.redirect === 'manual'), true);
});

test('no live URL configured = live null', async () => {
  const { fetchFn } = fakeNet();
  assert.equal((await fetchSources({ pieces: [], fetchFn, now: NOW })).live, null);
});

// ---------- failure and cache ----------
test('without network nothing throws and every piece stays verified:false', async () => {
  const fetchFn = async () => { throw new TypeError('fetch failed'); };
  const pieces = [NEXT, { name: 'node', ecosystem: 'runtime', version: '20.11.0' }];
  const sources = await fetchSources({ pieces, node: { running: '20.11.0', required: '>=20' }, selfVersion: '0.2.5',
    selfRepo: 'acme/session-map', liveUrl: 'https://app.acme.example/version', codeVersion: '1.2.0', fetchFn, now: NOW });
  assert.deepEqual(sources.vulns, {});
  assert.deepEqual(sources.eol, {});
  assert.deepEqual(sources.latest, {});
  assert.equal(sources.reason, 'no-network');
  assert.equal(sources.self.verified, false);
  assert.equal(sources.live.version, null);
  for (const p of pieces) {
    const w = warningOf(p, sources);
    assert.equal(w.verified, false);
    assert.equal(w.reason, 'no-network');
  }
});

test('a fetchFn that is missing or answers garbage still gives an empty result', async () => {
  const garbage = async () => new Response('<html>oops</html>', { status: 200 });
  const a = await fetchSources({ pieces: [NEXT], fetchFn: garbage, now: NOW });
  assert.deepEqual(a.vulns, {});
  assert.deepEqual(a.latest, {});
  const b = await fetchSources({ pieces: [NEXT], fetchFn: null, now: NOW });
  assert.equal(b.reason, 'no-network');
});

test('a cache younger than 24 h answers without the network; an older one is asked again', async () => {
  const routes = {
    [OSV]: json({ results: [{ vulns: [{ id: 'GHSA-1111-2222-3333' }] }] }),
    'https://registry.npmjs.org/-/package/next/dist-tags': json({ latest: '18.2.0' }),
  };
  const first = fakeNet(routes);
  const cached = await fetchSources({ pieces: [NEXT], fetchFn: first.fetchFn, now: NOW });
  assert.equal(cached.fetchedAt, NOW.toISOString());
  assert.equal(first.calls.length, 2);

  const second = fakeNet(routes);
  const fresh = await fetchSources({ pieces: [NEXT], fetchFn: second.fetchFn, cached, now: new Date(NOW.getTime() + VERSIONS_TTL_MS - 1000) });
  assert.equal(second.calls.length, 0);
  assert.deepEqual(fresh.vulns, cached.vulns);
  assert.equal(fresh.fetchedAt, cached.fetchedAt);

  const third = fakeNet(routes);
  const later = new Date(NOW.getTime() + VERSIONS_TTL_MS + 1000);
  const stale = await fetchSources({ pieces: [NEXT], fetchFn: third.fetchFn, cached, now: later });
  assert.equal(third.calls.length, 2);
  assert.equal(stale.fetchedAt, later.toISOString());
});

test('a fresh cache only asks for what it does not have yet', async () => {
  const { fetchFn: f1 } = fakeNet({ [OSV]: json({ results: [{}] }), 'https://registry.npmjs.org/-/package/next/dist-tags': json({ latest: '18.2.0' }) });
  const cached = await fetchSources({ pieces: [NEXT], fetchFn: f1, now: NOW });
  const { fetchFn, calls } = fakeNet({ [OSV]: json({ results: [{}] }), 'https://registry.npmjs.org/-/package/react/dist-tags': json({ latest: '20.0.0' }) });
  const react = { name: 'react', ecosystem: 'npm', version: '19.1.0' };
  const out = await fetchSources({ pieces: [NEXT, react], fetchFn, cached, now: new Date(NOW.getTime() + 60_000) });
  assert.deepEqual(JSON.parse(calls.find((c) => c.url === OSV).init.body).queries.map((q) => q.package.name), ['react']);
  assert.equal(calls.some((c) => c.url.includes('/next/')), false);
  assert.equal(out.latest['npm:next'], '18.2.0');
  assert.equal(out.latest['npm:react'], '20.0.0');
  assert.equal(out.fetchedAt, NOW.toISOString(), 'the age of the oldest answer kept');
});

test('a stale cache with no network is dropped, never shown as verified', async () => {
  const { fetchFn: f1 } = fakeNet({ [OSV]: json({ results: [{ vulns: [{ id: 'GHSA-1111-2222-3333' }] }] }) });
  const cached = await fetchSources({ pieces: [NEXT], fetchFn: f1, now: NOW });
  const offline = async () => { throw new TypeError('fetch failed'); };
  const out = await fetchSources({ pieces: [NEXT], fetchFn: offline, cached, now: new Date(NOW.getTime() + VERSIONS_TTL_MS + 1) });
  assert.deepEqual(out.vulns, {});
  assert.equal(warningOf(NEXT, out).verified, false);
});
