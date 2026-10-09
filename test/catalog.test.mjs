import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_TTL_MS, fetchCatalog, filterCatalog, markInstalled, readCatalogCache, resolveToken } from '../server/sources/catalog.mjs';

const NOW = Date.parse('2026-10-09T12:00:00Z');

const gh = (full, over = {}) => ({
  full_name: full, name: full.split('/')[1], owner: { login: full.split('/')[0] }, stargazers_count: 10,
  description: 'A thing', topics: [], pushed_at: '2026-10-01T00:00:00Z', license: { spdx_id: 'MIT' }, archived: false,
  html_url: `https://github.com/${full}`, ...over,
});

function respond({ status = 200, body = {}, headers = {} } = {}) {
  return { ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body };
}

// routes: [[regex on the url, response or function(url) → response]]; anything else is a 404.
function fakeGithub(routes) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), auth: opts.headers?.authorization ?? null });
    for (const [re, handler] of routes) if (re.test(url)) return respond(typeof handler === 'function' ? handler(url) : handler);
    return respond({ status: 404, body: { message: 'Not Found' } });
  };
  return { fetchFn, calls };
}

function fixture() {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-cat-sm-'));
  const dir = mkdtempSync(join(tmpdir(), 'sm-cat-dir-'));
  return { smDir, dir, cleanup: () => { rmSync(smDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}

const noExec = async () => ({ code: 1, stdout: '', stderr: '' });

test('without a token only the topic searches run, repeats are merged and the result is cached', async () => {
  const f = fixture();
  try {
    const { fetchFn, calls } = fakeGithub([
      [/topic%3Aclaude-code-plugin/, { body: { items: [gh('acme/pixel-polish', { stargazers_count: 40, topics: ['claude-code-plugin'], description: 'Polish UI layouts and color palettes' })] } }],
      [/topic%3Aagent-skills/, { body: { items: [gh('acme/pixel-polish', { stargazers_count: 40 }), gh('zed/plain-writer', { topics: ['claude-skills'], description: 'Write clear docs and READMEs' })] } }],
      [/search\/repositories/, { body: { items: [] } }],
    ]);
    const out = await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    assert.ok(calls.length >= 5 && calls.every((c) => c.url.includes('/search/repositories') && c.auth === null));
    assert.deepEqual(out.items.map((i) => i.repo).sort(), ['acme/pixel-polish', 'zed/plain-writer']);
    const polish = out.items.find((i) => i.repo === 'acme/pixel-polish');
    assert.deepEqual(
      { stars: polish.stars, owner: polish.owner, license: polish.license, archived: polish.archived, category: polish.category, type: polish.type },
      { stars: 40, owner: 'acme', license: 'MIT', archived: false, category: 'design', type: 'plugin' },
    );
    assert.equal(out.limited, false);
    assert.equal(readCatalogCache(f.smDir).items.length, 2);
  } finally { f.cleanup(); }
});

test('a cache younger than 24 h is served without any request, unless forced', async () => {
  const f = fixture();
  try {
    const { fetchFn, calls } = fakeGithub([[/search\/repositories/, { body: { items: [gh('a/b')] } }]]);
    await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    const first = calls.length;
    const again = await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW + CACHE_TTL_MS - 1000 });
    assert.equal(calls.length, first);
    assert.equal(again.items.length, 1);
    await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW + CACHE_TTL_MS + 1000 });
    assert.ok(calls.length > first);
    const forced = calls.length;
    await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW + CACHE_TTL_MS + 2000, force: true });
    assert.ok(calls.length > forced);
  } finally { f.cleanup(); }
});

test('with a token it sends it, finds marketplace repositories and reads the top-level files to classify', async () => {
  const f = fixture();
  try {
    const { fetchFn, calls } = fakeGithub([
      [/search\/code/, { body: { items: [{ repository: { full_name: 'team/toolbox' } }] } }],
      [/repos\/team\/toolbox\/contents\/\.claude-plugin/, { body: [{ name: 'marketplace.json', type: 'file' }] }],
      [/repos\/team\/toolbox\/contents/, { body: [{ name: '.claude-plugin', type: 'dir' }, { name: 'README.md', type: 'file' }] }],
      [/repos\/team\/toolbox$/, { body: gh('team/toolbox', { stargazers_count: 99, description: 'Our team plugins' }) }],
      [/repos\/acme\/review-crew\/contents/, { body: [{ name: 'agents', type: 'dir' }] }],
      [/search\/repositories/, { body: { items: [gh('acme/review-crew', { description: 'Subagents that write unit tests' })] } }],
    ]);
    const out = await fetchCatalog({ token: 'ghp_secret', exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    assert.ok(calls.every((c) => c.auth === 'Bearer ghp_secret'));
    const toolbox = out.items.find((i) => i.repo === 'team/toolbox');
    assert.equal(toolbox.type, 'marketplace');
    assert.equal(toolbox.hasMarketplace, true);
    assert.equal(toolbox.stars, 99);
    const crew = out.items.find((i) => i.repo === 'acme/review-crew');
    assert.deepEqual([crew.type, crew.category, crew.hasMarketplace], ['agent', 'testing', false]);
    assert.ok(!readFileSync(join(f.smDir, 'catalog.json'), 'utf8').includes('ghp_secret'));
  } finally { f.cleanup(); }
});

test('marketplaces the user already added are listed even when no search finds them', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, 'plugins'));
    writeFileSync(join(f.dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({
      mine: { source: { source: 'github', repo: 'me/my-market' } },
      local: { source: { source: 'directory', path: '/x' } },
    }));
    const { fetchFn } = fakeGithub([
      [/repos\/me\/my-market$/, { body: gh('me/my-market', { stargazers_count: 3 }) }],
      [/search\/repositories/, { body: { items: [] } }],
    ]);
    const out = await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    const mine = out.items.find((i) => i.repo === 'me/my-market');
    assert.equal(mine.hasMarketplace, true);
    assert.equal(mine.type, 'marketplace');
  } finally { f.cleanup(); }
});

test('hitting the GitHub limit shows the old cache, says so and keeps the cache file', async () => {
  const f = fixture();
  try {
    const ok = fakeGithub([[/search\/repositories/, { body: { items: [gh('old/one')] } }]]);
    await fetchCatalog({ token: null, exec: noExec, fetchFn: ok.fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    const before = readFileSync(join(f.smDir, 'catalog.json'), 'utf8');
    const limited = fakeGithub([[/search\/repositories/, { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'rate limit exceeded' } }]]);
    const out = await fetchCatalog({ token: null, exec: noExec, fetchFn: limited.fetchFn, smDir: f.smDir, dir: f.dir, now: NOW + CACHE_TTL_MS + 1, force: true });
    assert.equal(out.limited, true);
    assert.equal(out.stale, true);
    assert.deepEqual(out.items.map((i) => i.repo), ['old/one']);
    assert.equal(readFileSync(join(f.smDir, 'catalog.json'), 'utf8'), before);
  } finally { f.cleanup(); }
});

test('hitting the limit with no cache returns what it got, flagged, and writes nothing', async () => {
  const f = fixture();
  try {
    let n = 0;
    const { fetchFn } = fakeGithub([[/search\/repositories/, () => (++n === 1
      ? { body: { items: [gh('got/first')] } }
      : { status: 429, body: { message: 'secondary rate limit' } })]]);
    const out = await fetchCatalog({ token: null, exec: noExec, fetchFn, smDir: f.smDir, dir: f.dir, now: NOW });
    assert.equal(out.limited, true);
    assert.deepEqual(out.items.map((i) => i.repo), ['got/first']);
    assert.equal(existsSync(join(f.smDir, 'catalog.json')), false);
  } finally { f.cleanup(); }
});

test('a network failure with no cache gives an empty list, not an exception', async () => {
  const f = fixture();
  try {
    const out = await fetchCatalog({ token: null, exec: noExec, fetchFn: async () => { throw new Error('offline'); }, smDir: f.smDir, dir: f.dir, now: NOW });
    assert.deepEqual(out.items, []);
    assert.equal(out.limited, false);
    assert.equal(out.error, 'network');
  } finally { f.cleanup(); }
});

test('a damaged cache file is ignored', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.smDir, 'catalog.json'), '{"items": [');
    assert.equal(readCatalogCache(f.smDir), null);
  } finally { f.cleanup(); }
});

test('resolveToken: GITHUB_TOKEN first, then gh auth token, else null', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: 'from-gh\n', stderr: '' }; };
  assert.equal(await resolveToken({ env: { GITHUB_TOKEN: 'from-env' }, exec }), 'from-env');
  assert.equal(calls.length, 0);
  assert.equal(await resolveToken({ env: {}, exec }), 'from-gh');
  assert.deepEqual(calls, [['gh', 'auth', 'token']]);
  assert.equal(await resolveToken({ env: {}, exec: noExec }), null);
  assert.equal(await resolveToken({ env: {}, exec: async () => { throw new Error('ENOENT'); } }), null);
});

const ITEMS = [
  { repo: 'a/zeta', name: 'zeta', owner: 'a', stars: 5, description: 'Deploy things', type: 'skill', category: 'devops', updatedAt: '2026-10-05T00:00:00Z' },
  { repo: 'b/alpha', name: 'alpha', owner: 'b', stars: 50, description: 'Pretty colors', type: 'plugin', category: 'design', updatedAt: '2026-01-01T00:00:00Z' },
  { repo: 'c/mid', name: 'mid', owner: 'c', stars: 20, description: 'Zeta-like', type: 'skill', category: 'design', updatedAt: '2026-09-01T00:00:00Z' },
];

test('filterCatalog sorts by stars by default, then by update or name, and filters', () => {
  const names = (opts) => filterCatalog(ITEMS, opts).map((i) => i.name);
  assert.deepEqual(names({}), ['alpha', 'mid', 'zeta']);
  assert.deepEqual(names({ sort: 'updated' }), ['zeta', 'mid', 'alpha']);
  assert.deepEqual(names({ sort: 'name' }), ['alpha', 'mid', 'zeta']);
  assert.deepEqual(names({ type: 'skill' }), ['mid', 'zeta']);
  assert.deepEqual(names({ category: 'design' }), ['alpha', 'mid']);
  assert.deepEqual(names({ type: 'skill', category: 'design' }), ['mid']);
  assert.deepEqual(names({ q: 'ZETA' }), ['mid', 'zeta']);
  assert.deepEqual(names({ sort: 'bogus', type: 'bogus' }), ['alpha', 'mid', 'zeta']);
});

test('markInstalled flags repositories whose marketplace has an installed plugin on this machine', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, 'plugins'));
    writeFileSync(join(f.dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({
      trail: { source: { source: 'github', repo: 'Trail/Skills' } },
      other: { source: { source: 'github', repo: 'o/other' } },
    }));
    writeFileSync(join(f.dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'audit@trail': [{ installPath: 'x' }] } }));
    const items = [{ repo: 'trail/skills' }, { repo: 'o/other' }, { repo: 'n/none' }];
    assert.deepEqual(markInstalled(items, f.dir).map((i) => i.installed), [true, false, false]);
  } finally { f.cleanup(); }
});
