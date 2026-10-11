// B4-T23 - acceptance of block 4 (fd08 repository health, fd09 versions). It reads the "how to confirm it is done" lines
// of docs/architecture/foundation.md one by one and proves each on the invented repositories of test/fixtures/repos,
// copied to a temp folder (the originals are never touched; the last test proves it).
//
// The answer key is test/fixtures/repos/acme-shop.health.json, written by hand from the table of the plan (bloco-4b), not
// from what the checks answer. When a check disagrees with it, the fix belongs to the check, not to the key.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';
import { normalizePath } from '../server/paths.mjs';
import { writeCare } from '../server/foundation/care.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { healthOf } from '../server/foundation/health.mjs';
import { readFd, writeFd } from '../server/foundation/store.mjs';
import { versionsOf } from '../server/foundation/versions.mjs';
import { versionsModel } from '../server/web/versionsview.js';

const FIXTURES = new URL('./fixtures/repos/', import.meta.url);
const fixturePath = (name) => new URL(`${name}/`, FIXTURES).pathname.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('%20', ' ');
const KEY = JSON.parse(readFileSync(new URL('acme-shop.health.json', FIXTURES), 'utf8'));
const ID = 'acme-shop-8324f1';
const P = `/api/foundation/${ID}`;
const SECRET = 'sk_live_ana_test_only_9f8e7d6c5b4a';
const WEIGHT = { E: 3, R: 2, A: 1 };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
const made = [];

// Every file under dir with its bytes: "untouched" means two snapshots are equal.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === '.git') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(dir, abs).split(sep).join('/')] = readFileSync(abs).toString('base64');
    }
  };
  walk(dir);
  return out;
}
const ORIGINALS = { 'acme-shop': snapshot(fixturePath('acme-shop')), 'acme-lib': snapshot(fixturePath('acme-lib')) };

// A fixture copied to a temp folder. withGit: `git init` plus one commit by Ana (no remote), so tracked files exist.
function copyFixture(name, { withGit = true, remote = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), `sm-fdaccept-${name}-`));
  made.push(root);
  cpSync(fixturePath(name), root, { recursive: true });
  if (withGit) {
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Ana');
    git(root, 'config', 'user.email', 'ana@acme.example');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'feat: first version');
    if (remote) git(root, 'remote', 'add', 'origin', remote);
  }
  return root;
}
const commit = (root, subject, file = 'CHANGES.txt') => {
  writeFileSync(join(root, file), `${subject}\n`, { flag: 'a' });
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', subject);
};

const tempDir = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `sm-fdaccept-${label}-`));
  made.push(dir);
  return dir;
};

// Records every path the process opens for reading while it is on, so a test can say ".env was never opened".
function spyOnReads() {
  const opened = [];
  const note = (p) => { if (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) opened.push(String(p)); };
  const real = {
    readFileSync: fs.readFileSync, openSync: fs.openSync, createReadStream: fs.createReadStream,
    readFile: fs.promises.readFile, open: fs.promises.open,
  };
  fs.readFileSync = (p, ...a) => { note(p); return real.readFileSync(p, ...a); };
  fs.openSync = (p, ...a) => { note(p); return real.openSync(p, ...a); };
  fs.createReadStream = (p, ...a) => { note(p); return real.createReadStream(p, ...a); };
  fs.promises.readFile = (p, ...a) => { note(p); return real.readFile(p, ...a); };
  fs.promises.open = (p, ...a) => { note(p); return real.open(p, ...a); };
  syncBuiltinESMExports();
  return {
    opened,
    stop() {
      Object.assign(fs, { readFileSync: real.readFileSync, openSync: real.openSync, createReadStream: real.createReadStream });
      Object.assign(fs.promises, { readFile: real.readFile, open: real.open });
      syncBuiltinESMExports();
    },
  };
}
const dotEnvOpens = (opened) => opened.filter((p) => /(^|[\\/])\.env$/.test(p));

// What a refresh leaves behind: census.json, then a health.json measured on it.
async function measure(root, smDir, extra = {}) {
  const census = await censusOf(root, null);
  writeFd(smDir, ID, 'census.json', census);
  return { census, health: await healthOf({ root, smDir, id: ID, ...extra }) };
}
const byId = (health) => new Map(health.items.map((i) => [i.id, i]));
const idsOf = (rows) => rows.map((r) => r.id).sort();
const scoreByHand = (items) => {
  let pass = 0;
  let all = 0;
  for (const i of items) {
    if (i.state !== 'pass' && i.state !== 'fail') continue;
    all += WEIGHT[i.severity];
    if (i.state === 'pass') pass += WEIGHT[i.severity];
  }
  return all === 0 ? null : Math.round((100 * pass) / all);
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The network the server sees: GitHub answers the repository (anonymous too), OSV flags `next`, every other host is a 404.
function fakeNet({ advisoryFor = null } = {}) {
  const calls = [];
  const fetchFn = async (href, init = {}) => {
    const u = new URL(href);
    calls.push({ host: u.hostname, path: u.pathname, headers: { ...(init.headers || {}) } });
    if (u.hostname === 'api.github.com' && u.pathname === '/repos/acme/acme-shop') {
      return json({ visibility: 'public', private: false, description: 'Shop for Ana', default_branch: 'main', owner: { login: 'acme', type: 'User' } });
    }
    if (u.hostname === 'api.osv.dev' && u.pathname === '/v1/querybatch') {
      const { queries } = JSON.parse(init.body);
      return json({ results: queries.map((q) => (q.package.name === advisoryFor ? { vulns: [{ id: 'GHSA-ana1-test-only', modified: '2026-01-01T00:00:00Z' }] } : {})) });
    }
    return json({ message: 'Not Found' }, 404);
  };
  return { calls, fetchFn };
}

// The real server on an ephemeral port over a copy of acme-shop that has a GitHub remote and a planted .env.
async function withApp(fn, { token = null, advisoryFor = null } = {}) {
  const root = copyFixture('acme-shop', { remote: 'https://github.com/acme/acme-shop.git' });
  writeFileSync(join(root, '.env'), `STRIPE_KEY=${SECRET}\nSESSION_SECRET=${SECRET}\n`); // after the commit: never tracked
  const dir = tempDir('dir');
  const smDir = tempDir('sm');
  const state = { projects: [{ id: ID, name: 'acme-shop', root, arch: null, workCells: [], chats: [] }] };
  const sessionToken = loadToken(smDir);
  const net = fakeNet({ advisoryFor });
  const realFetch = globalThis.fetch;
  const realToken = process.env.SESSION_MAP_GITHUB_TOKEN;
  globalThis.fetch = net.fetchFn;
  if (token) process.env.SESSION_MAP_GITHUB_TOKEN = token;
  else delete process.env.SESSION_MAP_GITHUB_TOKEN;
  const spy = spyOnReads();
  const app = createApp({ dir, smDir, demo: false, chat: null, token: sessionToken, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const bodies = [];
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const headers = { host, cookie: `sm_token=${sessionToken}` };
    if (method !== 'GET') Object.assign(headers, { origin: `http://${host}`, 'content-type': 'application/json', 'x-session-map': '1' });
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
    await fn({ call, root, smDir, net, bodies, opened: spy.opened });
  } finally {
    spy.stop();
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.SESSION_MAP_GITHUB_TOKEN;
    else process.env.SESSION_MAP_GITHUB_TOKEN = realToken;
    await new Promise((resolve) => app.close(resolve));
  }
}

// Nothing the program said or saved carries the planted secret, and no .env was ever opened.
function assertSecretNeverSeen({ bodies, smDir, opened }) {
  for (const text of bodies) assert.equal(text.includes(SECRET), false, 'an answer carries the planted secret');
  const brain = join(smDir, 'brain', ID, 'foundation');
  for (const name of readdirSync(brain)) {
    const abs = join(brain, name);
    if (statSync(abs).isFile()) assert.equal(readFileSync(abs, 'utf8').includes(SECRET), false, `${name} carries the planted secret`);
  }
  assert.deepEqual(dotEnvOpens(opened), [], 'a .env was opened');
  assert.ok(opened.some((p) => p.endsWith('.env.example')), 'the spy works: it saw .env.example being read');
}

after(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

// ---------- the answer key itself ----------

test('the answer key states an outcome for each of the 91 catalogue items, once, with the category and severity of the plan', () => {
  const rows = [...KEY.fail, ...KEY.unsettled, ...KEY.pass, ...KEY.na, ...KEY.unverifiedNoToken];
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'an id is stated twice');
  assert.deepEqual([...ids].sort(), HEALTH_ITEMS.map((i) => i.id).sort());
  for (const r of [...rows, ...KEY.lib.na, ...KEY.lib.charged]) {
    const item = HEALTH_ITEMS.find((i) => i.id === r.id);
    assert.ok(item, r.id);
    assert.equal(r.category, item.category, `${r.id} category`);
    assert.equal(r.severity, item.severity, `${r.id} severity`);
  }
});

// ---------- fd08 ----------

test('fd08: each known gap of acme-shop appears once, with its category and severity; nothing else is a gap', async () => {
  const root = copyFixture('acme-shop');
  const smDir = tempDir('sm');
  const { health } = await measure(root, smDir);
  assert.equal(health.items.length, 91);
  const seen = byId(health);
  assert.equal(seen.size, 91, 'an item appears twice');

  assert.deepEqual(health.items.filter((i) => i.state === 'fail' && !KEY.unsettled.some((u) => u.id === i.id)).map((i) => i.id).sort(), idsOf(KEY.fail),
    'the failing items are exactly the known gaps');
  for (const gap of KEY.fail) {
    const got = seen.get(gap.id);
    assert.equal(got.state, 'fail', gap.id);
    assert.equal(got.category, gap.category, `${gap.id} category`);
    assert.equal(got.severity, gap.severity, `${gap.id} severity`);
    assert.ok(typeof got.reason === 'string' && got.reason, `${gap.id} says why it fails`);
  }
  // The two gaps the plan names for this fixture, read by their words.
  assert.equal(seen.get('community.security').reason, 'missing', 'no SECURITY.md');
  assert.equal(seen.get('hygiene.ci').reason, 'missing', 'no CI');
  assert.equal(seen.get('hygiene.ci').severity, 'E');

  for (const ok of KEY.pass) assert.equal(seen.get(ok.id).state, 'pass', ok.id);
  for (const u of KEY.unsettled) assert.ok(['pass', 'fail', 'unverified', 'na'].includes(seen.get(u.id).state), u.id);

  // Per category, the counts the screen shows add up to the items of that category.
  for (const [cat, c] of Object.entries(health.categories)) {
    assert.equal(c.pass + c.fail + c.unverified + c.na, health.items.filter((i) => i.category === cat).length, cat);
  }
});

test('fd08: the score is the weighted share of passed over passed plus failed (E 3, R 2, A 1), worked out by hand', async () => {
  const root = copyFixture('acme-shop');
  const { health } = await measure(root, tempDir('sm'));
  assert.equal(health.score, scoreByHand(health.items));
  assert.ok(health.score > 0 && health.score < 100);
  assert.equal(health.coverage.verified, health.items.filter((i) => i.state === 'pass' || i.state === 'fail').length);
});

test('fd08: a private repository is not charged for what is only for public ones, and a library is not charged for app items', async () => {
  const root = copyFixture('acme-shop');
  const { health } = await measure(root, tempDir('sm'));
  assert.equal(health.visibility, 'private');
  const seen = byId(health);
  for (const row of KEY.na) {
    assert.equal(seen.get(row.id).state, 'na', row.id);
    assert.equal(seen.get(row.id).reason, row.reason, `${row.id} reason`);
  }
  // Public-only items of a private repository are in no sum.
  assert.ok(KEY.na.filter((r) => r.reason === 'private').length >= 15);
});

test('fd08: the same repository told "public" in the user config is charged for the public-only items', async () => {
  const root = copyFixture('acme-shop');
  const smDir = tempDir('sm');
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projects: { [normalizePath(root)]: { visibility: 'public' } } }));
  const { health } = await measure(root, smDir);
  assert.equal(health.visibility, 'public');
  assert.equal(health.visibilitySource, 'config');
  const seen = byId(health);
  for (const row of KEY.na.filter((r) => r.reason === 'private')) {
    assert.notEqual(seen.get(row.id).state, 'na', `${row.id} now owed`);
  }
  assert.equal(seen.get('community.license').state, 'pass');
  assert.equal(seen.get('community.code_of_conduct').state, 'fail');
  // A file inside the repository cannot claim to be private (only the user's own config decides).
  const lie = copyFixture('acme-shop');
  writeFileSync(join(lie, '.session-map.json'), JSON.stringify({ visibility: 'private' }));
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projects: { [normalizePath(lie)]: { visibility: 'public' } } }));
  assert.equal((await measure(lie, smDir)).health.visibility, 'public');
});

test('fd08: an item that needs the API reads "not verified" without a token, never "failed"', async () => {
  const root = copyFixture('acme-shop');
  const { health } = await measure(root, tempDir('sm'));
  const seen = byId(health);
  for (const row of KEY.unverifiedNoToken) {
    assert.equal(seen.get(row.id).state, 'unverified', row.id);
    assert.equal(seen.get(row.id).reason, 'no-token', `${row.id} reason`);
  }
  assert.equal(health.api.mode, 'none');
  // Not in the score: the unverified ones change nothing in it.
  assert.equal(health.score, scoreByHand(health.items.filter((i) => i.state !== 'unverified')));
});

test('fd08: online without a token the API items stay "not verified" and not one request carries an authorization', async () => {
  await withApp(async (h) => {
    await measure(h.root, h.smDir);
    const res = await h.call('POST', `${P}/online`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.health.api.mode, 'public');
    const seen = byId(res.body.health);
    // known_vulns is the one that has a second source: OSV answered "nothing" for every piece, so it is a verified pass.
    for (const row of KEY.unverifiedNoToken.filter((r) => r.id !== 'security.known_vulns')) {
      assert.equal(seen.get(row.id).state, 'unverified', row.id);
      assert.equal(seen.get(row.id).reason, 'no-token', `${row.id} reason`);
    }
    assert.equal(seen.get('security.known_vulns').state, 'pass');
    assert.ok(h.net.calls.some((c) => c.host === 'api.github.com'), 'GitHub was asked');
    for (const c of h.net.calls) assert.equal(c.headers.authorization, undefined, c.host);
    // The answer of the public API made the repository public: the public-only items are owed now.
    assert.equal(res.body.health.visibility, 'public');
    assertSecretNeverSeen(h);
  });
});

test('fd08: the score goes up when a gap is closed, and only that item changes; a draft with a placeholder stays a gap', async () => {
  await withApp(async (h) => {
    const { health: before } = await measure(h.root, h.smDir);
    assert.equal(byId(before).get('security.no_secrets').state, 'pass', 'a .env that git does not track is neither opened nor charged');
    writeCare(h.smDir, ID, 'auto');

    const fix = await h.call('POST', `${P}/health/fix`, { itemId: 'hygiene.editorconfig' });
    assert.equal(fix.status, 200);
    assert.equal(fix.body.status, 'applied');
    const after = fix.body.health;
    const changed = after.items.filter((i) => i.state !== byId(before).get(i.id).state);
    assert.deepEqual(changed.map((i) => [i.id, byId(before).get(i.id).state, i.state]), [['hygiene.editorconfig', 'fail', 'pass']]);
    assert.ok(after.score > before.score, `${after.score} > ${before.score}`);
    assert.equal(after.score, scoreByHand(after.items));

    // A draft with a marker is not a fix: the program does not pretend the gap closed.
    const sec = await h.call('POST', `${P}/health/fix`, { itemId: 'community.security' });
    assert.equal(sec.status, 200);
    assert.equal(sec.body.status, 'applied');
    assert.deepEqual(sec.body.placeholders, ['<CONTACT EMAIL>']);
    assert.match(readFileSync(join(h.root, 'SECURITY.md'), 'utf8'), /<CONTACT EMAIL>/);
    const item = byId(sec.body.health).get('community.security');
    assert.equal(item.state, 'fail');
    assert.equal(item.reason, 'placeholder');
    assert.equal(item.category, 'community');
    assert.equal(item.severity, 'E');
    assert.deepEqual((await h.call('GET', `${P}/health`)).body, JSON.parse(JSON.stringify(sec.body.health)));
    assertSecretNeverSeen(h);
  });
});

test('fd08: a .env made only for the test is never opened and the planted secret shows in no output or saved file', async () => {
  const root = copyFixture('acme-shop');
  writeFileSync(join(root, '.env'), `STRIPE_KEY=${SECRET}\n`);
  const smDir = tempDir('sm');
  const spy = spyOnReads();
  let health;
  let versions;
  try {
    ({ health } = await measure(root, smDir));
    versions = await versionsOf({ root, census: readFd(smDir, ID, 'census.json', null), smDir, id: ID });
  } finally {
    spy.stop();
  }
  assert.deepEqual(dotEnvOpens(spy.opened), []);
  assert.ok(spy.opened.some((p) => p.endsWith('.env.example')), 'the spy works');
  const census = readFd(smDir, ID, 'census.json', null);
  assert.equal(JSON.stringify({ health, versions, census }).includes(SECRET), false);
  assert.equal(census.files.find((f) => f.path === '.env').kind, 'secret');
  assert.equal(census.files.find((f) => f.path === '.env').included, false);
});

test('fd08: a tracked .env is a gap with the file named, never the value', async () => {
  const root = copyFixture('acme-shop');
  writeFileSync(join(root, '.env'), `STRIPE_KEY=${SECRET}\n`);
  git(root, 'add', '-f', '.env');
  git(root, 'commit', '-q', '-m', 'chore: oops');
  const spy = spyOnReads();
  let health;
  try {
    ({ health } = await measure(root, tempDir('sm')));
  } finally {
    spy.stop();
  }
  const item = byId(health).get('security.no_secrets');
  assert.equal(item.state, 'fail');
  assert.ok(item.evidence.some((e) => e.file === '.env'), JSON.stringify(item.evidence));
  assert.equal(JSON.stringify(health).includes(SECRET), false);
  assert.deepEqual(dotEnvOpens(spy.opened), []);
});

test('fd08: in a copy with no git, "no secrets" and "no binaries" are not verified, never failed; with git a tracked .exe is a gap', async () => {
  const bare = copyFixture('acme-shop', { withGit: false });
  writeFileSync(join(bare, '.env'), `STRIPE_KEY=${SECRET}\n`);
  writeFileSync(join(bare, 'tool.exe'), 'MZ not a real program');
  const { health } = await measure(bare, tempDir('sm'));
  const seen = byId(health);
  for (const id of ['security.no_secrets', 'security.no_binaries']) assert.equal(seen.get(id).state, 'unverified', id);
  assert.equal(JSON.stringify(health).includes(SECRET), false);

  const tracked = copyFixture('acme-shop');
  writeFileSync(join(tracked, 'tool.exe'), 'MZ not a real program');
  git(tracked, 'add', 'tool.exe');
  git(tracked, 'commit', '-q', '-m', 'chore: add a tool');
  const item = byId((await measure(tracked, tempDir('sm'))).health).get('security.no_binaries');
  assert.equal(item.state, 'fail');
  assert.deepEqual(item.evidence, [{ file: 'tool.exe' }]);
});

test('fd08: acme-lib, a library, owes no app item and no public-only item; what it is owed it is charged', async () => {
  const root = copyFixture('acme-lib');
  const { health } = await measure(root, tempDir('sm'));
  const seen = byId(health);
  assert.deepEqual(health.items.filter((i) => i.state === 'na').map((i) => i.id).sort(), idsOf(KEY.lib.na));
  for (const row of KEY.lib.na) assert.equal(seen.get(row.id).reason, row.reason, `${row.id} reason`);
  for (const row of KEY.lib.charged) {
    assert.equal(seen.get(row.id).state, row.state, row.id);
    assert.equal(seen.get(row.id).category, row.category);
    assert.equal(seen.get(row.id).severity, row.severity);
  }
  assert.equal(health.score, scoreByHand(health.items));
});

// ---------- fd09 ----------

test('fd09: package.json at 1.2.0 with a tag v1.1.0 shows both and the mismatch', async () => {
  const root = copyFixture('acme-lib');
  git(root, 'tag', 'v1.1.0');
  const census = await censusOf(root, null);
  const v = await versionsOf({ root, census });
  assert.equal(v.code.version, '1.2.0');
  assert.equal(v.code.source, 'package.json');
  assert.equal(v.tag, 'v1.1.0');
  assert.equal(v.relation, 'ahead');
  assert.equal(v.mismatch, true);
  // What the panel draws from it.
  const model = versionsModel(v);
  assert.equal(model.code.version, '1.2.0');
  assert.equal(model.tag, 'v1.1.0');
  assert.equal(model.seal, 'warning');
  // And the contrast: the same code with a matching tag is confirmed, not a mismatch.
  git(root, 'tag', 'v1.2.0');
  const same = await versionsOf({ root, census });
  assert.equal(same.tag, 'v1.2.0');
  assert.equal(same.mismatch, false);
  assert.equal(versionsModel(same).seal, 'confirmed');
});

test('fd09: a framework with a known advisory shows the warning, and the health item reads it', async () => {
  await withApp(async (h) => {
    await measure(h.root, h.smDir);
    const res = await h.call('POST', `${P}/online`, {});
    assert.equal(res.status, 200);
    const pieces = res.body.versions.pieces;
    const next = pieces.find((p) => p.name === 'next');
    assert.equal(next.warning.kind, 'vulnerable');
    assert.ok(next.warning.ids.includes('GHSA-ana1-test-only'));
    assert.equal(next.verified, true);
    const react = pieces.find((p) => p.name === 'react');
    assert.equal(react.warning, null);
    assert.equal(react.verified, true);
    // apps/web and apps/admin both use next: each declaration is a warned piece; nothing else is.
    const warned = versionsModel(res.body.versions).pieces.warned;
    assert.deepEqual(warned.map((w) => [w.name, w.kind, w.file]), [['next', 'vulnerable', 'apps/admin/package.json'], ['next', 'vulnerable', 'apps/web/package.json']]);
    assert.equal(byId(res.body.health).get('security.known_vulns').state, 'fail');
    assertSecretNeverSeen(h);
  }, { advisoryFor: 'next' });
});

test('fd09: with no source consulted nothing is marked verified', async () => {
  const root = copyFixture('acme-shop');
  const census = await censusOf(root, null);
  const v = await versionsOf({ root, census });
  assert.ok(v.pieces.length >= 2);
  assert.ok(v.pieces.every((p) => p.verified === false && p.warning === null));
  const pieces = versionsModel(v).pieces;
  assert.equal(pieces.ok, 0);
  assert.deepEqual(pieces.warned, []);
  assert.equal(pieces.unverified.length, v.pieces.length);
});

test('fd09: after a feat commit the suggested next version is a minor bump; a chore alone suggests nothing', async () => {
  const root = copyFixture('acme-lib');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ ...manifest, version: '1.1.0' }, null, 2)}\n`);
  git(root, 'add', 'package.json');
  git(root, 'commit', '-q', '-m', 'chore: release 1.1.0');
  git(root, 'tag', 'v1.1.0');
  commit(root, 'chore: tidy');
  const read = async () => versionsOf({ root, census: await censusOf(root, null) });
  assert.equal((await read()).next, null);
  commit(root, 'feat: slugify accepts a separator');
  const v = await read();
  assert.equal(v.next.because, 'feat');
  assert.equal(v.next.version, '1.2.0');
  assert.equal(v.next.alreadyInCode, false);
  assert.equal(v.next.nonSemver, false);
  assert.equal(v.next.commits.length, 1);
  assert.equal(versionsModel(v).next.version, '1.2.0');
  commit(root, 'feat!: drop the old default');
  assert.equal((await read()).next.version, '2.0.0');
});

// ---------- the originals ----------

test('the fixtures themselves were never touched by any of the above', () => {
  assert.deepEqual(snapshot(fixturePath('acme-shop')), ORIGINALS['acme-shop']);
  assert.deepEqual(snapshot(fixturePath('acme-lib')), ORIGINALS['acme-lib']);
});
