import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';
import { writeCare } from '../server/foundation/care.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { healthOf } from '../server/foundation/health.mjs';
import { readFd, writeFd } from '../server/foundation/store.mjs';

const ID = 'acme-shop-8324f1';
const P = `/api/foundation/${ID}`;
const GH_TOKEN = 'ghp_FAKEtokenForAnaOnly0123456789';
const SECRET = 'sk_live_never_read_by_health';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });

// A tiny Node project of Ana's, committed, with a GitHub remote and a .env the routes must never open.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sm-fdhealth-root-'));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'acme-shop', version: '1.2.0', scripts: { test: 'node --test' }, dependencies: { next: '^14.0.0' } }, null, 2)}\n`);
  writeFileSync(join(root, 'README.md'), '# acme-shop\n\nThe shop of Ana.\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export function hello() {\n  return process.env.SHOP_URL;\n}\n');
  writeFileSync(join(root, '.env'), `STRIPE_KEY=${SECRET}\n`);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Ana');
  git(root, 'config', 'user.email', 'ana@acme.example');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', 'package.json', 'README.md', 'src/a.js');
  git(root, 'commit', '-q', '-m', 'feat: first shop');
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/acme-shop.git');
  return root;
}

// Every file under root with its bytes: "byte-identical" means this map is equal.
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(root, abs).split(sep).join('/')] = readFileSync(abs).toString('base64');
    }
  };
  walk(root);
  return out;
}

// What a refresh would leave behind: census.json and a health.json measured on it.
async function readProject(smDir, root) {
  const census = await censusOf(root, null);
  writeFd(smDir, ID, 'census.json', census);
  return healthOf({ root, smDir, id: ID });
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The network seen by POST online: GitHub answers the repository, every other host is a 404. Every call is kept.
function fakeNet() {
  const calls = [];
  const fetchFn = async (href, init = {}) => {
    const u = new URL(href);
    calls.push({ host: u.hostname, path: u.pathname, headers: { ...(init.headers || {}) } });
    if (u.hostname === 'api.github.com' && u.pathname === '/repos/acme/acme-shop') {
      return json({ visibility: 'public', private: false, description: 'Shop for Ana', default_branch: 'main', owner: { login: 'acme', type: 'User' } });
    }
    return json({ message: 'Not Found' }, 404);
  };
  return { calls, fetchFn };
}

async function withApp(fn, { demo = false } = {}) {
  const root = makeRepo();
  const dir = mkdtempSync(join(tmpdir(), 'sm-fdhealth-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdhealth-sm-'));
  const state = { projects: [{ id: ID, name: 'acme-shop', root, arch: null, workCells: [], chats: [] }] };
  const token = demo ? 'f'.repeat(64) : loadToken(smDir);
  const net = fakeNet();
  const realFetch = globalThis.fetch;
  const realToken = process.env.SESSION_MAP_GITHUB_TOKEN;
  globalThis.fetch = net.fetchFn;
  process.env.SESSION_MAP_GITHUB_TOKEN = GH_TOKEN;
  const app = createApp({ dir, smDir, demo, chat: null, token, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const bodies = [];
  const call = (method, path, { body, cookie = true, header = true } = {}) => new Promise((resolve, reject) => {
    const headers = { host };
    if (cookie) headers.cookie = `sm_token=${token}`;
    if (method !== 'GET') Object.assign(headers, { origin: `http://${host}`, 'content-type': 'application/json', ...(header ? { 'x-session-map': '1' } : {}) });
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        bodies.push(text);
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* plain text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, root, smDir, net, token, bodies });
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.SESSION_MAP_GITHUB_TOKEN;
    else process.env.SESSION_MAP_GITHUB_TOKEN = realToken;
    await new Promise((resolve) => app.close(resolve));
    for (const d of [dir, root, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test('reads need the token, writes need the header, the project must exist, and nothing generated yet is 200 null', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('GET', `${P}/health`, { cookie: false })).status, 401);
    assert.equal((await call('GET', `${P}/versions`, { cookie: false })).status, 401);
    assert.equal((await call('POST', `${P}/online`, { body: {}, cookie: false })).status, 401);
    assert.equal((await call('POST', `${P}/online`, { body: {}, header: false })).status, 403);
    assert.equal((await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' }, header: false })).status, 403);
    assert.equal((await call('GET', '/api/foundation/acme-none-000000/health')).status, 404);
    assert.deepEqual(await call('GET', `${P}/health`), { status: 200, body: null });
    assert.deepEqual(await call('GET', `${P}/versions`), { status: 200, body: null });
  });
});

test('--demo refuses every write with 403 and reads nothing from the brain folder', async () => {
  await withApp(async ({ call, root }) => {
    const before = snapshot(root);
    assert.deepEqual(await call('POST', `${P}/online`, { body: {} }), { status: 403, body: { ok: false, error: 'demo' } });
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig', confirm: true } }), { status: 403, body: { ok: false, error: 'demo' } });
    assert.deepEqual(snapshot(root), before);
    assert.equal((await call('GET', `${P}/health`)).status, 200);
  }, { demo: true });
});

test('GET health and GET versions answer the saved files as they are', async () => {
  await withApp(async ({ call, smDir, root }) => {
    const health = await readProject(smDir, root);
    writeFd(smDir, ID, 'versions.json', { version: 1, generatedAt: '2026-10-10T10:00:00.000Z', code: { version: '1.2.0' }, tag: null });
    assert.deepEqual((await call('GET', `${P}/health`)).body, JSON.parse(JSON.stringify(health)));
    assert.equal((await call('GET', `${P}/versions`)).body.code.version, '1.2.0');
  });
});

test('health/fix: an item outside the catalogue is 400, an item with no draft is 409 no-draft', async () => {
  await withApp(async ({ call, smDir, root }) => {
    await readProject(smDir, root);
    writeCare(smDir, ID, 'auto');
    const before = snapshot(root);
    for (const itemId of ['community.nope', '', 42, null, '__proto__', 'constructor']) {
      assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId } }), { status: 400, body: { ok: false, error: 'bad-item' } }, String(itemId));
    }
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: null }), { status: 400, body: { ok: false, error: 'bad-item' } });
    // LICENSE is always manual; the README exists already (no draft only creates).
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId: 'community.license' } }), { status: 409, body: { ok: false, error: 'no-draft' } });
    writeFileSync(join(root, '.editorconfig'), 'root = true\n');
    await readProject(smDir, root);
    const now = snapshot(root);
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } }), { status: 409, body: { ok: false, error: 'no-draft' } });
    assert.deepEqual(snapshot(root), now);
    assert.notDeepEqual(before, now);
  });
});

test('health/fix without a census is 409 no-census and writes nothing', async () => {
  await withApp(async ({ call, smDir, root }) => {
    writeCare(smDir, ID, 'auto');
    const before = snapshot(root);
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } }), { status: 409, body: { ok: false, error: 'no-census' } });
    assert.deepEqual(snapshot(root), before);
  });
});

test('look mode (and a mode never asked) never writes: the repository stays byte for byte the same', async () => {
  await withApp(async ({ call, smDir, root }) => {
    await readProject(smDir, root);
    const before = snapshot(root);
    const ask = { body: { itemId: 'hygiene.editorconfig', confirm: true } };
    assert.deepEqual((await call('POST', `${P}/health/fix`, ask)), { status: 409, body: { ok: false, error: 'look-only' } });
    writeCare(smDir, ID, 'look');
    assert.deepEqual((await call('POST', `${P}/health/fix`, ask)), { status: 409, body: { ok: false, error: 'look-only' } });
    assert.deepEqual(snapshot(root), before);
    assert.equal(readdirSync(join(smDir, 'brain', ID, 'foundation')).includes('undo'), false);
  });
});

test('suggest mode keeps a proposal and leaves the repository alone', async () => {
  await withApp(async ({ call, smDir, root }) => {
    await readProject(smDir, root);
    writeCare(smDir, ID, 'suggest');
    const before = snapshot(root);
    const res = await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'proposed');
    assert.deepEqual(res.body.files, ['.editorconfig']);
    assert.deepEqual(snapshot(root), before);
    const slug = res.body.opId.replace(/^op:/, '');
    const proposal = readFd(smDir, ID, `proposals/${slug}.json`, null);
    assert.equal(proposal.op.kind, 'health-draft');
    assert.match(proposal.diff[0].after, /^root = true/);
  });
});

test('auto mode writes the draft through care, keeps its undo, and the score goes up once the gap closes', async () => {
  await withApp(async ({ call, smDir, root }) => {
    const before = await readProject(smDir, root);
    assert.equal(before.items.find((i) => i.id === 'hygiene.editorconfig').state, 'fail');
    writeCare(smDir, ID, 'auto');
    const res = await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'applied');
    assert.match(readFileSync(join(root, '.editorconfig'), 'utf8'), /^root = true/);
    const slug = res.body.opId.replace(/^op:/, '');
    const undo = readFd(smDir, ID, `undo/${slug}.json`, null);
    assert.equal(undo.kind, 'health-draft');
    assert.deepEqual(undo.files.map((f) => [f.path, f.before]), [['.editorconfig', null]]);
    // fd08 "a nota muda quando uma lacuna fecha": measured again by the program, never declared.
    assert.equal(res.body.health.items.find((i) => i.id === 'hygiene.editorconfig').state, 'pass');
    assert.ok(res.body.health.score > before.score, `${res.body.health.score} > ${before.score}`);
    assert.equal((await call('GET', `${P}/health`)).body.score, res.body.health.score);
    // The same gap a second time: census.json is still the old one, but the file is on disk and is never overwritten.
    assert.deepEqual(await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } }), { status: 409, body: { ok: false, error: 'exists' } });
  });
});

test('a draft never overwrites a file that appeared after the census', async () => {
  await withApp(async ({ call, smDir, root }) => {
    await readProject(smDir, root);
    writeCare(smDir, ID, 'auto');
    writeFileSync(join(root, '.editorconfig'), 'mine = Ana\n');
    const res = await call('POST', `${P}/health/fix`, { body: { itemId: 'hygiene.editorconfig' } });
    assert.deepEqual(res, { status: 409, body: { ok: false, error: 'exists' } });
    assert.equal(readFileSync(join(root, '.editorconfig'), 'utf8'), 'mine = Ana\n');
  });
});

test('POST online fetches, keeps the caches, measures again; twice in a row is 429; the token never shows', async () => {
  await withApp(async ({ call, smDir, root, net, token, bodies }) => {
    await readProject(smDir, root);
    const first = await call('POST', `${P}/online`, { body: {} });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    const api = readFd(smDir, ID, 'health-api.json', null);
    assert.equal(api.mode, 'token');
    assert.equal(api.visibility, 'public');
    assert.equal(first.body.health.visibility, 'public');
    assert.equal(first.body.health.api.mode, 'token');
    const online = readFd(smDir, ID, 'versions-online.json', null);
    assert.equal(online.version, 1);
    assert.ok(online.sources && typeof online.sources === 'object');
    assert.equal(first.body.versions.code.version, '1.2.0');
    assert.deepEqual(readFd(smDir, ID, 'versions.json', null), first.body.versions);
    assert.ok(net.calls.some((c) => c.host === 'api.osv.dev' || c.host === 'registry.npmjs.org'), 'the version sources were asked');
    // The GitHub token goes to api.github.com only, and never into an answer or a saved file.
    for (const c of net.calls) {
      if (c.host !== 'api.github.com') assert.equal(c.headers.authorization, undefined, c.host);
    }
    assert.ok(net.calls.some((c) => c.host === 'api.github.com' && c.headers.authorization === `Bearer ${GH_TOKEN}`));
    const second = await call('POST', `${P}/online`, { body: {} });
    assert.deepEqual(second, { status: 429, body: { ok: false, error: 'too-soon' } });
    await call('GET', `${P}/health`);
    await call('GET', `${P}/versions`);
    for (const text of bodies) {
      assert.equal(text.includes(GH_TOKEN), false);
      assert.equal(text.includes(token), false);
      assert.equal(text.includes(SECRET), false);
    }
    const saved = readdirSync(join(smDir, 'brain', ID, 'foundation')).filter((n) => n.endsWith('.json'));
    for (const name of saved) assert.equal(readFileSync(join(smDir, 'brain', ID, 'foundation', name), 'utf8').includes(GH_TOKEN), false, name);
  });
});

test('POST online with no network still answers: nothing fetched is marked verified', async () => {
  await withApp(async ({ call, smDir, root }) => {
    await readProject(smDir, root);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const res = await call('POST', `${P}/online`, { body: {} });
    assert.equal(res.status, 200);
    assert.equal(readFd(smDir, ID, 'health-api.json', null).error, 'no-network');
    assert.equal(readFd(smDir, ID, 'versions-online.json', null).sources.reason, 'no-network');
    assert.ok(res.body.versions.pieces.every((p) => p.verified === false));
    assert.ok(existsSync(join(root, 'package.json')));
  });
});
