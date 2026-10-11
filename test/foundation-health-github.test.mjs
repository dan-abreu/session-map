import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseRemote, githubToken, fetchApiFacts, safeGet, readApiFacts, writeApiFacts,
  API_FIELDS, PROTECTED_FIELDS, TTL_MS, BODY_MAX,
} from '../server/foundation/health-github.mjs';

const TOKEN = 'ghp_FAKEtokenForAnaOnly0123456789';
const REMOTE = 'https://github.com/acme/acme-shop.git';
const NOW = Date.parse('2026-10-10T12:00:00Z');

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// A whole fake GitHub (plus Scorecard and the Best Practices badge), keyed by host + path; every call is recorded.
function fakeNet(overrides = {}) {
  const calls = [];
  const routes = {
    'api.github.com/repos/acme/acme-shop': () => json({
      visibility: 'public', private: false, description: 'Shop for Ana', homepage: 'https://acme.example',
      topics: ['shop', 'acme'], default_branch: 'main', owner: { login: 'acme', type: 'Organization' },
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'disabled' } },
      extra_secret_field: 'LEAKED-EXTRA',
    }),
    'api.github.com/repos/acme/acme-shop/branches/main': () => json({ name: 'main', protected: true }),
    'api.github.com/repos/acme/acme-shop/releases': () => json([
      { tag_name: 'v1.1.0', body: 'Fixes', draft: false, assets: [{ name: 'app.zip' }, { name: 'app.zip.sig' }] },
      { tag_name: 'v1.0.0', body: '  ', draft: false, assets: [] },
      { tag_name: 'v1.2.0', body: 'wip', draft: true, assets: [] },
    ]),
    'api.github.com/repos/acme/acme-shop/labels': () => json([{ name: 'bug', color: 'f00' }, { name: 'good first issue' }]),
    'api.github.com/repos/acme/acme-shop/milestones': () => json([{ number: 1 }, { number: 2 }]),
    'api.github.com/repos/acme/acme-shop/pulls': () => json([
      { number: 7, merged_at: '2026-10-01T00:00:00Z' }, { number: 8, merged_at: null }, { number: 9, merged_at: '2026-10-02T00:00:00Z' },
    ]),
    'api.github.com/repos/acme/acme-shop/pulls/7/reviews': () => json([{ state: 'COMMENTED' }, { state: 'APPROVED' }]),
    'api.github.com/repos/acme/acme-shop/pulls/9/reviews': () => json([{ state: 'CHANGES_REQUESTED' }]),
    'api.github.com/repos/acme/acme-shop/private-vulnerability-reporting': () => json({ enabled: true }),
    'api.github.com/repos/acme/acme-shop/dependabot/alerts': () => json([{ number: 1 }, { number: 2 }, { number: 3 }]),
    'api.github.com/repos/acme/acme-shop/hooks': () => json([
      { config: { url: 'https://hooks.acme.example/x', insecure_ssl: '0', secret: '********' } },
      { config: { url: 'https://hooks.acme.example/y', insecure_ssl: '1' } },
    ]),
    'api.github.com/orgs/acme': () => json({ login: 'acme', two_factor_requirement_enabled: true }),
    'api.securityscorecards.dev/projects/github.com/acme/acme-shop': () => json({
      score: 7.4, checks: [{ name: 'Signed-Releases', score: 8, reason: 'x' }, { name: 'Packaging', score: -1 }],
    }),
    'www.bestpractices.dev/en/projects.json': () => json([
      { id: 1, repo_url: 'https://github.com/acme/acme-shop-old', badge_level: 'gold' },
      { id: 2, repo_url: 'https://github.com/acme/acme-shop', badge_level: 'passing' },
    ]),
    ...overrides,
  };
  const fetchFn = async (href, init = {}) => {
    const u = new URL(href);
    calls.push({ host: u.hostname, path: u.pathname, search: u.search, headers: { ...(init.headers || {}) }, init });
    const route = routes[u.hostname + u.pathname];
    if (!route) return json({ message: 'Not Found' }, 404);
    return route(u, init);
  };
  return { fetchFn, calls };
}

test('parseRemote reads https and ssh GitHub remotes and keeps only host, owner and name', () => {
  const want = { host: 'github.com', owner: 'acme', name: 'acme-shop' };
  assert.deepEqual(parseRemote('https://github.com/acme/acme-shop.git'), want);
  assert.deepEqual(parseRemote('https://github.com/acme/acme-shop'), want);
  assert.deepEqual(parseRemote('https://github.com/acme/acme-shop/'), want);
  assert.deepEqual(parseRemote('git@github.com:acme/acme-shop.git'), want);
  assert.deepEqual(parseRemote('ssh://git@github.com/acme/acme-shop.git'), want);
  // A remote with a credential inside: the credential never survives.
  const withCred = parseRemote(`https://ana:${TOKEN}@github.com/acme/acme-shop.git`);
  assert.deepEqual(withCred, want);
  assert.ok(!JSON.stringify(withCred).includes(TOKEN));
});

test('parseRemote refuses anything that is not a plain GitHub repository', () => {
  for (const bad of [
    'https://gitlab.com/acme/acme-shop.git', 'git@bitbucket.org:acme/acme-shop.git', 'https://github.com.evil.example/acme/x',
    'https://github.com/acme', 'https://github.com/acme/x/y', 'https://github.com/../x', 'https://github.com/acme/..',
    'http://github.com/acme/acme-shop', 'file:///c:/dev/acme', '', null, undefined, 42,
  ]) assert.equal(parseRemote(bad), null, String(bad));
});

test('githubToken reads only SESSION_MAP_GITHUB_TOKEN, trimmed, and nothing else', () => {
  assert.equal(githubToken({ SESSION_MAP_GITHUB_TOKEN: `  ${TOKEN}\n` }), TOKEN);
  assert.equal(githubToken({ GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN }), null);
  assert.equal(githubToken({ SESSION_MAP_GITHUB_TOKEN: '   ' }), null);
});

test('a remote that is not GitHub answers no-remote without touching the network', async () => {
  const { fetchFn, calls } = fakeNet();
  const facts = await fetchApiFacts({ remote: 'https://gitlab.com/acme/acme-shop.git', token: TOKEN, fetchFn, now: NOW });
  assert.equal(facts.error, 'no-remote');
  assert.equal(facts.mode, 'none');
  assert.equal(facts.repo, null);
  assert.equal(calls.length, 0);
  for (const f of ['visibility', 'secretScanning', 'releases', 'scorecard']) assert.equal(facts[f], null);
});

test('without a token: mode public, the protected fields stay null and no call carries authorization', async () => {
  const { fetchFn, calls } = fakeNet();
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  assert.equal(facts.mode, 'public');
  assert.equal(facts.error, null);
  assert.deepEqual(facts.repo, { host: 'github.com', owner: 'acme', name: 'acme-shop' });
  for (const f of PROTECTED_FIELDS) assert.equal(facts[f], null, f);
  assert.ok(PROTECTED_FIELDS.includes('secretScanning') && PROTECTED_FIELDS.includes('webhooks'));
  // The public facts are still read.
  assert.equal(facts.visibility, 'public');
  assert.equal(facts.description, 'Shop for Ana');
  assert.deepEqual(facts.topics, ['shop', 'acme']);
  assert.equal(facts.branchProtection, true);
  assert.deepEqual(facts.labels, ['bug', 'good first issue']);
  assert.equal(facts.milestones, 2);
  assert.equal(facts.projects, null);
  for (const c of calls) assert.equal(c.headers.authorization, undefined, `${c.host}${c.path}`);
  // Admin-only endpoints are not even asked without a token.
  assert.ok(!calls.some((c) => /hooks|dependabot|private-vulnerability|orgs/.test(c.path)));
});

test('with a token: authorization goes only to api.github.com and the protected fields are read', async () => {
  const { fetchFn, calls } = fakeNet();
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.equal(facts.mode, 'token');
  assert.equal(facts.error, null);
  for (const c of calls) {
    if (c.host === 'api.github.com') assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    else assert.equal(c.headers.authorization, undefined, c.host);
    assert.equal(c.init.redirect, 'manual');
    assert.ok(c.init.signal, 'every call has a time limit');
  }
  assert.ok(calls.some((c) => c.host === 'api.securityscorecards.dev'));
  assert.ok(calls.some((c) => c.host === 'www.bestpractices.dev'));
  assert.equal(facts.secretScanning, true);
  assert.equal(facts.pushProtection, false);
  assert.equal(facts.privateReporting, true);
  assert.deepEqual(facts.vulnAlerts, { open: 3 });
  assert.deepEqual(facts.webhooks, [{ secure: true }, { secure: false }]);
  assert.equal(facts.twoFactor, true);
});

test('the facts copy only the contract fields from each answer', async () => {
  const { fetchFn } = fakeNet();
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.deepEqual(Object.keys(facts).sort(), [...API_FIELDS].sort());
  const text = JSON.stringify(facts);
  assert.ok(!text.includes('LEAKED-EXTRA'));
  assert.ok(!text.includes('hooks.acme.example'), 'webhook URLs are not copied');
  assert.ok(!text.includes('********'));
  assert.deepEqual(facts.releases, [
    { tag: 'v1.1.0', hasNotes: true, assets: ['app.zip', 'app.zip.sig'] },
    { tag: 'v1.0.0', hasNotes: false, assets: [] },
  ]);
  assert.equal(facts.reviewRatio, 0.5);
  assert.deepEqual(facts.scorecard, { score: 7.4, checks: { 'Signed-Releases': 8 } });
  assert.equal(facts.openssfBadge, 'passing');
  assert.equal(facts.version, 1);
  assert.equal(facts.fetchedAt, new Date(NOW).toISOString());
});

test('the review ratio reads closed pull requests in small pages until 20 merged ones', async () => {
  // A real pull request weighs about 22 KB: 50 at once passed 1 MB on a live repository.
  const page = (n) => Array.from({ length: 30 }, (_, i) => ({ number: n * 100 + i, merged_at: i % 2 ? null : '2026-10-01T00:00:00Z' }));
  const { fetchFn, calls } = fakeNet({
    'api.github.com/repos/acme/acme-shop/pulls': (u) => json(page(Number(u.searchParams.get('page')))),
  });
  const reviewed = [];
  const wrapped = async (href, init) => {
    const m = /\/pulls\/(\d+)\/reviews/.exec(href);
    if (m) {
      reviewed.push(Number(m[1]));
      return json([{ state: Number(m[1]) % 4 === 0 ? 'APPROVED' : 'COMMENTED' }]);
    }
    return fetchFn(href, init);
  };
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn: wrapped, now: NOW });
  const lists = calls.filter((c) => c.path === '/repos/acme/acme-shop/pulls');
  assert.deepEqual(lists.map((c) => new URLSearchParams(c.search).get('page')), ['1', '2']);
  for (const c of lists) assert.ok(Number(new URLSearchParams(c.search).get('per_page')) <= 30);
  assert.equal(reviewed.length, 20);
  // Approved = number divisible by 4: 8 of the 15 on page 1, 3 of the first 5 on page 2.
  assert.equal(facts.reviewRatio, 11 / 20);
});

test('the token never shows in the facts, in the cache on disk or in the log', async (t) => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-gh-'));
  t.after(() => rmSync(smDir, { recursive: true, force: true }));
  const { fetchFn } = fakeNet({
    'api.github.com/repos/acme/acme-shop/labels': () => json({ message: `boom ${TOKEN}` }, 500),
    'api.github.com/repos/acme/acme-shop/milestones': () => { throw new Error(`socket closed for ${TOKEN}`); },
  });
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { written.push(String(chunk)); return true; };
  let facts;
  try {
    facts = await fetchApiFacts({ remote: `https://ana:${TOKEN}@github.com/acme/acme-shop.git`, token: TOKEN, fetchFn, now: NOW });
  } finally {
    process.stderr.write = original;
  }
  assert.ok(!JSON.stringify(facts).includes(TOKEN));
  assert.ok(written.length > 0, 'the failed call is logged');
  assert.ok(!written.join('').includes(TOKEN));
  writeApiFacts(smDir, 'acme-shop-8324f1', { ...facts, token: TOKEN, extra: TOKEN });
  const onDisk = readFileSync(join(smDir, 'brain', 'acme-shop-8324f1', 'foundation', 'health-api.json'), 'utf8');
  assert.ok(!onDisk.includes(TOKEN));
  assert.deepEqual(readApiFacts(smDir, 'acme-shop-8324f1'), facts);
});

test('readApiFacts answers null when nothing was fetched yet', (t) => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-gh-'));
  t.after(() => rmSync(smDir, { recursive: true, force: true }));
  assert.equal(readApiFacts(smDir, 'acme-shop-8324f1'), null);
});

test('safeGet refuses hosts off the list, plain http, and never calls the network for them', async () => {
  const { fetchFn, calls } = fakeNet();
  for (const url of [
    'https://evil.example/repos/acme/acme-shop', 'http://api.github.com/repos/acme/acme-shop',
    'https://api.github.com.evil.example/x', 'https://ana:pw@api.github.com/x', 'https://api.github.com:8443/x',
  ]) {
    const r = await safeGet(url, { token: TOKEN, fetchFn });
    assert.equal(r.error, 'refused', url);
  }
  assert.equal(calls.length, 0);
});

test('safeGet given a token still sends it only to api.github.com, even across a redirect', async () => {
  const { fetchFn, calls } = fakeNet({
    'api.github.com/repos/acme/moved': () => new Response(null, { status: 302, headers: { location: 'https://api.securityscorecards.dev/projects/github.com/acme/acme-shop' } }),
  });
  await safeGet('https://www.bestpractices.dev/en/projects.json?url=x', { token: TOKEN, fetchFn });
  await safeGet('https://api.github.com/repos/acme/moved', { token: TOKEN, fetchFn });
  assert.deepEqual(calls.map((c) => [c.host, c.headers.authorization ?? null]), [
    ['www.bestpractices.dev', null],
    ['api.github.com', `Bearer ${TOKEN}`],
    ['api.securityscorecards.dev', null],
  ]);
});

test('a redirect off the list is refused and the token never follows it', async () => {
  const { fetchFn, calls } = fakeNet({
    'api.github.com/repos/acme/acme-shop': () => new Response(null, { status: 301, headers: { location: 'https://evil.example/steal' } }),
  });
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.ok(!calls.some((c) => c.host === 'evil.example'));
  assert.equal(facts.visibility, null);
});

test('a redirect inside api.github.com (renamed repository) is followed', async () => {
  const { fetchFn } = fakeNet({
    'api.github.com/repos/acme/old-shop': () => new Response(null, { status: 301, headers: { location: 'https://api.github.com/repos/acme/acme-shop' } }),
  });
  const r = await safeGet('https://api.github.com/repos/acme/old-shop', { token: TOKEN, fetchFn });
  assert.equal(r.status, 200);
  assert.equal(r.data.visibility, 'public');
});

test('403 with the rate limit spent answers rate-limit, stops asking, and never throws', async () => {
  let after = 0;
  const { fetchFn, calls } = fakeNet({
    'api.github.com/repos/acme/acme-shop/branches/main': () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }),
  });
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  const idx = calls.findIndex((c) => c.path.endsWith('/branches/main'));
  after = calls.length - idx - 1;
  assert.equal(facts.error, 'rate-limit');
  assert.equal(after, 0, 'no call after the limit');
  assert.equal(facts.visibility, 'public', 'what came before the limit stays');
  assert.equal(facts.branchProtection, null);
  assert.equal(facts.releases, null);
});

test('429 and a secondary limit (retry-after) are rate-limit too', async () => {
  for (const res of [
    () => json({ message: 'slow down' }, 429),
    () => json({ message: 'You have exceeded a secondary rate limit' }, 403, { 'retry-after': '60' }),
  ]) {
    const { fetchFn } = fakeNet({ 'api.github.com/repos/acme/acme-shop': res });
    const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
    assert.equal(facts.error, 'rate-limit');
    assert.equal(facts.visibility, null);
  }
});

test('a network failure answers no-network with every fact null, without throwing', async () => {
  const fetchFn = async () => { throw new TypeError('fetch failed'); };
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  assert.equal(facts.error, 'no-network');
  assert.equal(facts.mode, 'public');
  for (const f of ['visibility', 'description', 'topics', 'homepage', 'branchProtection', 'releases', 'labels',
    'milestones', 'reviewRatio', 'scorecard', 'openssfBadge', ...PROTECTED_FIELDS]) assert.equal(facts[f], null, f);
});

test('a token GitHub refuses answers unauthorized', async () => {
  const { fetchFn } = fakeNet({ 'api.github.com/repos/acme/acme-shop': () => json({ message: 'Bad credentials' }, 401) });
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.equal(facts.error, 'unauthorized');
  assert.equal(facts.visibility, null);
});

test('a token refused halfway stops the run as unauthorized', async () => {
  const { fetchFn, calls } = fakeNet({ 'api.github.com/repos/acme/acme-shop/labels': () => json({ message: 'Bad credentials' }, 401) });
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.equal(facts.error, 'unauthorized');
  assert.equal(facts.visibility, 'public');
  assert.equal(calls.at(-1).path, '/repos/acme/acme-shop/labels');
});

test('a repository hidden from an anonymous call is not called private: visibility stays unknown', async () => {
  const { fetchFn, calls } = fakeNet({ 'api.github.com/repos/acme/acme-shop': () => json({ message: 'Not Found' }, 404) });
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  assert.equal(facts.visibility, null);
  assert.equal(facts.error, null);
  assert.equal(calls.length, 1);
});

test('a private repository read with a token skips Scorecard and the public badge', async () => {
  const { fetchFn, calls } = fakeNet({
    'api.github.com/repos/acme/acme-shop': () => json({ visibility: 'private', private: true, default_branch: 'main', owner: { login: 'ana', type: 'User' } }),
  });
  const facts = await fetchApiFacts({ remote: REMOTE, token: TOKEN, fetchFn, now: NOW });
  assert.equal(facts.visibility, 'private');
  assert.equal(facts.twoFactor, null, 'a personal account has no organization rule to read');
  assert.ok(!calls.some((c) => c.host !== 'api.github.com'));
  assert.equal(facts.scorecard, null);
  assert.equal(facts.openssfBadge, null);
});

test('a cache younger than one hour is answered without calling the network', async () => {
  const { fetchFn: first } = fakeNet();
  const cached = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn: first, now: NOW });
  const { fetchFn, calls } = fakeNet();
  const again = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, cached, now: NOW + TTL_MS - 1000 });
  assert.equal(calls.length, 0);
  assert.deepEqual(again, cached);
  const late = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, cached, now: NOW + TTL_MS + 1000 });
  assert.ok(calls.length > 0, 'an old cache is fetched again');
  assert.equal(late.fetchedAt, new Date(NOW + TTL_MS + 1000).toISOString());
});

test('the cache is not reused for another repository, another mode or after an error', async () => {
  const { fetchFn: first } = fakeNet();
  const cached = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn: first, now: NOW });
  for (const [label, opts] of [
    ['token now', { remote: REMOTE, token: TOKEN }],
    ['other repo', { remote: 'https://github.com/acme/acme-lib' }],
  ]) {
    const { fetchFn, calls } = fakeNet();
    await fetchApiFacts({ ...opts, fetchFn, cached, now: NOW + 1000 });
    assert.ok(calls.length > 0, label);
  }
  const { fetchFn, calls } = fakeNet();
  await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, cached: { ...cached, error: 'no-network' }, now: NOW + 1000 });
  assert.ok(calls.length > 0, 'after an error');
});

test('a body above 1 MB is refused, by header or while reading', async () => {
  const big = 'x'.repeat(BODY_MAX + 10);
  const { fetchFn } = fakeNet({
    'api.github.com/repos/acme/acme-shop/labels': () => new Response(JSON.stringify([{ name: big }]), { status: 200 }),
    'api.github.com/repos/acme/acme-shop/releases': () => new Response('[]', { status: 200, headers: { 'content-length': String(BODY_MAX + 1) } }),
  });
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  assert.equal(facts.labels, null);
  assert.equal(facts.releases, null);
  assert.equal(facts.error, null);
  assert.equal(facts.visibility, 'public', 'the rest is still read');
  const r = await safeGet('https://api.github.com/repos/acme/acme-shop/labels', { fetchFn });
  assert.equal(r.error, 'too-big');
});

test('without a token and without a network the facts serve the checks as not verified', async () => {
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn: async () => { throw new Error('offline'); }, now: NOW });
  // The rule the checks apply (bloco-4b § 3): null + not token mode = no-token; null + no-network = no-network.
  assert.notEqual(facts.mode, 'token');
  assert.equal(facts.error, 'no-network');
  assert.equal(facts.secretScanning, null);
});

test('unexpected shapes in an answer become null, never a crash', async () => {
  const { fetchFn } = fakeNet({
    'api.github.com/repos/acme/acme-shop': () => json({ visibility: 'internal', topics: 'not-a-list', description: 5, default_branch: 'main' }),
    'api.github.com/repos/acme/acme-shop/releases': () => new Response('not json', { status: 200 }),
    'api.github.com/repos/acme/acme-shop/labels': () => json({ name: 'bug' }),
    'api.github.com/repos/acme/acme-shop/pulls': () => json([]),
  });
  const facts = await fetchApiFacts({ remote: REMOTE, token: null, fetchFn, now: NOW });
  assert.equal(facts.visibility, 'private', 'internal is not public');
  assert.equal(facts.topics, null);
  assert.equal(facts.description, null);
  assert.equal(facts.releases, null);
  assert.equal(facts.labels, null);
  assert.equal(facts.reviewRatio, null, 'no merged pull request = no data');
});
