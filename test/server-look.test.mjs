// The "look only" link (server.md sv04): a second key that shows the live map to another person and nothing else. Every
// route outside the short list of map reads answers 403 to it; the owner's key keeps working as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { dropLookKey, loadLookKey, loadToken, lookAllows, newLookKey } from '../server/auth.mjs';
import { writeDraft } from '../server/arch/flow.mjs';

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-look-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-look-sm-'));
  if (opts.before) opts.before(smDir);
  const app = createApp({ dir, smDir, ai: { bin: null }, ...opts, before: undefined });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const write = { 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  try {
    await fn({ call, token, port, smDir, write });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const REMOTE = { addressOf: () => '10.0.0.50' };
const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Every write the server has, by method and path: none may pass with the look-only key.
const WRITES = [
  ['POST', '/api/action'], ['POST', '/api/chat/start'],
  ...['send', 'permission', 'mode', 'run', 'stop'].map((v) => ['POST', `/api/chat/x/${v}`]),
  ['POST', `/api/conversation/${UUID}/place`], ['DELETE', `/api/conversation/${UUID}`],
  ['POST', '/api/arch/p/mermaid/preview'], ['POST', '/api/arch/p/mermaid/apply'], ['PUT', '/api/arch/p/draft'], ['DELETE', '/api/arch/p/draft'],
  ['POST', '/api/settings/permission-mode'], ['DELETE', '/api/settings/permission-mode'], ['POST', '/api/settings/reinforced-limit'],
  ['POST', '/api/settings/project-background'], ['POST', '/api/settings/notify'], ['POST', '/api/settings/notify/test'],
  ['POST', '/api/settings/ai-helpers'], ['DELETE', '/api/settings/ai-helpers?provider=x'], ['POST', '/api/settings/ai-helpers/test'],
  ['POST', '/api/settings/look-key'], ['DELETE', '/api/settings/look-key'],
  ['POST', '/api/ai/ask'], ['POST', '/api/ai/recommend'], ['POST', '/api/ai/activity/x'],
  ['POST', '/api/foundation/p/census'], ['PUT', '/api/foundation/p/compass'], ['POST', '/api/library'], ['PATCH', '/api/state'], ['POST', '/'],
];

// Reads that are not the map: conversations, files, changes, settings, AI keys and spending, the catalog, everything else.
const OTHER_READS = [
  '/api/alerts', '/api/history?q=x', `/api/conversation/${UUID}`, `/api/conversation/${UUID}/image/0`, '/api/catalog', '/api/catalog?refresh=1',
  '/api/files/p?all=1', '/api/file/p?path=a.js', '/api/changes/*', '/api/change/p?id=1',
  '/api/chat/list', '/api/chat/history/x', '/api/chat/x/events', '/api/chat/image/x/0', '/api/chat/helper/x/y',
  '/api/arch/p/mermaid', '/api/arch/p/draft', '/api/foundation/p/census', '/api/library',
  '/api/settings/permission-mode', '/api/settings/reinforced-limit', '/api/settings/notify', '/api/settings/ai-helpers', '/api/settings/look-key',
  '/api/ai/hello?nonce=abc', '/api/ai/others', '/api/ai/activity', '/api/ai/usage', '/api/ai/recommend', '/api/whatever', '/api/cards',
  // The router reads each piece of the path decoded: a letter written as %61 must not slip past the list as a page file.
  '/%61pi/cards', '/%61pi/arch/p/draft', '/%61pi/arch/p/mermaid', '/%61%70%69/chat/list', '/%61pi/state', '/%41PI/cards', '/api%2Fcards',
  '/api/arch/p/%6Dodel', '/api/%61rch/p/model', '/api/st%61te', '/api/arch/p/model/part', '/api/arch/p/model/%70art/x', '/%E0%A4%A/x',
];

test('the look-only key is stored apart from the owner key, made new on demand and dropped for good', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-look-key-'));
  try {
    assert.equal(loadLookKey(smDir), null, 'off until the owner makes one');
    const owner = loadToken(smDir);
    const key = newLookKey(smDir);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, owner);
    assert.equal(readFileSync(join(smDir, 'token'), 'utf8').trim(), owner, 'the owner key is never touched');
    if (process.platform !== 'win32') assert.equal(statSync(join(smDir, 'look-token')).mode & 0o077, 0);
    assert.equal(loadLookKey(smDir), key);
    const again = newLookKey(smDir);
    assert.notEqual(again, key, 'a new link makes the old one useless');
    dropLookKey(smDir);
    assert.equal(existsSync(join(smDir, 'look-token')), false);
    assert.equal(loadLookKey(smDir), null);
    dropLookKey(smDir);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('lookAllows lets through only the page and the reads that draw the map', () => {
  for (const path of ['/', '/app.js', '/css/look.css', '/api/state', '/api/arch/p/model', '/api/arch/p/model/part/x']) assert.equal(lookAllows('GET', path), true, path);
  for (const path of OTHER_READS) assert.equal(lookAllows('GET', path.split('?')[0]), false, path);
  for (const [method, path] of WRITES) assert.equal(lookAllows(method, path.split('?')[0]), false, `${method} ${path}`);
  assert.equal(lookAllows('HEAD', '/api/state'), false);
  assert.equal(lookAllows('OPTIONS', '/'), false);
});

test('the owner makes, shows and turns off the look-only link; nobody else can', async () => {
  await withServer({}, async ({ call, token, write }) => {
    const owner = { ...write, cookie: `sm_token=${token}` };
    assert.equal((await call('GET', '/api/settings/look-key')).status, 401, 'even a local read needs the owner key');
    assert.equal((await call('POST', '/api/settings/look-key', { headers: write, body: {} })).status, 401);
    const off = await call('GET', '/api/settings/look-key', { headers: { cookie: `sm_token=${token}` } });
    assert.deepEqual(JSON.parse(off.text), { ok: true, on: false, link: null });
    const made = await call('POST', '/api/settings/look-key', { headers: owner, body: {} });
    assert.equal(made.status, 200);
    const { on, link } = JSON.parse(made.text);
    assert.equal(on, true);
    const key = new URL(link).searchParams.get('look');
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, token);
    assert.equal(JSON.parse((await call('GET', '/api/settings/look-key', { headers: { cookie: `sm_token=${token}` } })).text).link, link);
    const dropped = await call('DELETE', '/api/settings/look-key', { headers: owner });
    assert.deepEqual(JSON.parse(dropped.text), { ok: true, on: false, link: null });
  });
});

test('the link carries the network address when the page is shared on the network', async () => {
  await withServer({ lanUrl: 'http://192.168.0.9:4001' }, async ({ call, token, write }) => {
    const made = await call('POST', '/api/settings/look-key', { headers: { ...write, cookie: `sm_token=${token}` }, body: {} });
    assert.match(JSON.parse(made.text).link, /^http:\/\/192\.168\.0\.9:4001\/\?look=[0-9a-f]{64}$/);
  });
});

test('?look= hands out the look-only cookie, never the owner one, and only while the link is on', async () => {
  let key;
  await withServer({ ...REMOTE, before: (smDir) => { key = newLookKey(smDir); } }, async ({ call, token }) => {
    assert.equal((await call('GET', '/?look=wrong')).status, 401);
    assert.equal((await call('GET', `/?look=${token}`)).status, 401, 'the owner key is not a look-only key');
    const link = await call('GET', `/?look=${key}&select=x`);
    assert.equal(link.status, 302);
    assert.equal(link.headers.location, '/?select=x');
    assert.equal(link.headers['set-cookie'].length, 1);
    assert.match(link.headers['set-cookie'][0], new RegExp(`^sm_look_\\d+=${key};.*HttpOnly.*SameSite=Strict`));
    assert.doesNotMatch(link.headers['set-cookie'][0], new RegExp(token));
  });
});

test('with the look-only key the page and the map read, and come marked as look-only', async () => {
  let key;
  await withServer({ ...REMOTE, before: (smDir) => { key = newLookKey(smDir); } }, async ({ call }) => {
    const look = { cookie: `sm_look=${key}` };
    for (const path of ['/', '/app.js', '/api/state']) {
      const res = await call('GET', path, { headers: look });
      assert.equal(res.status, 200, path);
      assert.equal(res.headers['x-look-only'], '1', path);
    }
    assert.deepEqual(JSON.parse((await call('GET', '/api/state', { headers: look })).text).projects, []);
    // Past the gate: the project is unknown, not forbidden.
    assert.equal((await call('GET', '/api/arch/p/model', { headers: look })).status, 404);
    assert.equal((await call('GET', '/api/arch/p/model/part/x', { headers: look })).status, 404);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: 'sm_look=nope' } })).status, 401);
  });
});

test('every read that is not the map answers 403 to the look-only key, even on this PC', async () => {
  for (const opts of [REMOTE, {}]) {
    let key;
    await withServer({ ...opts, before: (smDir) => { key = newLookKey(smDir); } }, async ({ call }) => {
      for (const path of OTHER_READS) {
        const res = await call('GET', path, { headers: { cookie: `sm_look=${key}` } });
        assert.equal(res.status, 403, `GET ${path}`);
        assert.doesNotMatch(res.text, /projects|sessionId|key/, path);
      }
    });
  }
});

test('every write answers 403 to the look-only key, with or without the page\'s write headers', async () => {
  let key;
  await withServer({ before: (smDir) => { key = newLookKey(smDir); } }, async ({ call, write }) => {
    // No body: the server answers before reading one, and a body still on its way could reset the connection.
    for (const [method, path] of WRITES) {
      assert.equal((await call(method, path, { headers: { ...write, cookie: `sm_look=${key}` } })).status, 403, `${method} ${path}`);
      assert.equal((await call(method, path, { headers: { cookie: `sm_look=${key}` } })).status, 403, `${method} ${path} bare`);
      assert.equal((await call(method, path, { headers: { ...write, cookie: `sm_look=${key}; sm_token=bad` } })).status, 403, `${method} ${path} bad owner`);
    }
    // Nothing was written: the link is still on.
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}` } })).status, 200);
  });
});

test('the owner key still works as before, alone or next to a look-only cookie', async () => {
  let key;
  await withServer({ ...REMOTE, before: (smDir) => { key = newLookKey(smDir); } }, async ({ call, token }) => {
    for (const cookie of [`sm_token=${token}`, `sm_look=${key}; sm_token=${token}`]) {
      const state = await call('GET', '/api/state', { headers: { cookie } });
      assert.equal(state.status, 200);
      assert.equal(state.headers['x-look-only'], undefined, 'the owner page is never marked look-only');
      assert.equal((await call('GET', '/api/history?q=x', { headers: { cookie } })).status, 200);
      assert.equal((await call('GET', '/api/settings/look-key', { headers: { cookie } })).status, 200);
    }
  });
  await withServer({ before: (smDir) => { key = newLookKey(smDir); } }, async ({ call, token, write }) => {
    const body = { action: 'open', sessionId: UUID };
    const res = await call('POST', '/api/action', { headers: { ...write, cookie: `sm_look=${key}; sm_token=${token}` }, body });
    assert.equal(res.status, 404, 'passes the guard; the session is not in the state');
    // On this PC without any key, reads stay open as before.
    assert.equal((await call('GET', '/api/history?q=x')).status, 200);
  });
});

test('turning the link off locks the look-only key out at once; a new link does not bring the old one back', async () => {
  await withServer(REMOTE, async ({ call, token, port }) => {
    const owner = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
    const key = new URL(JSON.parse((await call('POST', '/api/settings/look-key', { headers: owner, body: {} })).text).link).searchParams.get('look');
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}` } })).status, 200);
    await call('DELETE', '/api/settings/look-key', { headers: owner });
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}` } })).status, 401);
    assert.equal((await call('GET', `/?look=${key}`)).status, 401);
    const next = new URL(JSON.parse((await call('POST', '/api/settings/look-key', { headers: owner, body: {} })).text).link).searchParams.get('look');
    assert.notEqual(next, key);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}` } })).status, 401);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${next}` } })).status, 200);
  });
});

test('the demo has no look-only link', async () => {
  await withServer({ demo: true, token: 'f'.repeat(64) }, async ({ call }) => {
    assert.equal((await call('GET', '/api/settings/look-key', { headers: { cookie: `sm_token=${'f'.repeat(64)}` } })).status, 403);
  });
});

// A real project with a saved Flow draft: without the decoded check, /%61pi/... reached the draft and the cards with 200.
test('an encoded path does not reach the owner\'s draft, cards or chats through the look-only key', async () => {
  let key;
  const collectFn = () => ({
    generatedAt: '', waitingCount: 0, projects: [{
      id: 'shop-abc123', name: 'shop', root: tmpdir(), workCells: [], arch: { source: 'none', dir: null, lang: 'en', layers: [], parts: [] }, chats: [],
    }],
  });
  const before = (smDir) => { key = newLookKey(smDir); writeDraft(smDir, 'shop-abc123', 'flowchart LR\n  secret --> draft'); };
  await withServer({ ...REMOTE, collectFn, before }, async ({ call, token }) => {
    const paths = ['/%61pi/arch/shop-abc123/draft', '/%61pi/arch/shop-abc123/mermaid', '/%61pi/cards', '/api/arch/shop-abc123/%64raft'];
    // The owner sees that these paths really lead to the private reads...
    for (const path of paths.slice(0, 3)) assert.equal((await call('GET', path, { headers: { cookie: `sm_token=${token}` } })).status, 200, `owner ${path}`);
    // ...and the look-only key is stopped before them.
    for (const path of paths) {
      const res = await call('GET', path, { headers: { cookie: `sm_look=${key}` } });
      assert.equal(res.status, 403, path);
      assert.doesNotMatch(res.text, /secret/, path);
    }
    assert.equal((await call('GET', '/api/arch/shop-abc123/model', { headers: { cookie: `sm_look=${key}` } })).status, 200, 'the map itself still reads');
  });
});

// Every private thing the state carries, each marked "secret" or with a figure that must not leave.
const SECRET = 'secret';
const fullState = (root) => ({
  generatedAt: '2026-10-10T10:00:00.000Z', waitingCount: 2, currency: { code: 'BRL', rate: 5 },
  totals: { today: 11.5, d7: 22.5, d30: 33.5 }, budget: { monthlyUSD: 400, used: 123.25 }, limits: { weekly: { at: SECRET } },
  projects: [{
    id: 'shop-abc123', name: 'shop', root, mainBranch: 'main', fetchedAt: '2026-10-10T09:00:00.000Z', tunnelUrl: `https://${SECRET}.example`,
    arch: { source: 'docs', dir: 'docs/architecture', lang: 'en', layers: [{ id: 'web', name: 'Web' }], parts: [{ id: 'cart', name: 'Cart', layer: 'web', groups: [], chatIds: [UUID], workCellIds: ['feat-x'] }], links: [], sizes: {} },
    workCells: [{
      id: 'feat-x', branch: 'feat/x', remote: false, path: `C:/${SECRET}/worktree`, owner: `${SECRET} owner`, authors: [`${SECRET} author`], partId: 'cart', touches: ['cart'],
      ahead: 2, commits: 2, files: [`${SECRET}.js`], nucleus: { doing: `${SECRET} doing`, todo: [`${SECRET} todo`] }, openspec: null, chatIds: [UUID],
      estimateUSD: 77.5, costUSD: 66.5, lastCommit: { hash: 'abc', subject: `${SECRET} commit`, ts: '2026-10-10T08:00:00.000Z' }, status: 'active',
      bornAt: '2026-10-09T08:00:00.000Z', mergedAt: null, clashWith: [],
    }],
    requestWords: null, foundation: { summary: SECRET }, ai: { model: 'haiku', spentUSDToday: 55.5 }, background: { on: true, always: false, working: true },
    activity: [{ kind: 'commit', ts: '2026-10-10T08:00:00.000Z', hash: 'abc', subject: `${SECRET} commit`, author: `${SECRET} author`, files: [`${SECRET}.js`], partIds: ['cart'], sessionId: UUID, workCellId: 'feat-x', branch: 'feat/x' }],
    chats: [{
      sessionId: UUID, title: 'Fix the cart', partId: 'cart', partSource: 'files', partWhy: { files: [`${SECRET}.js`] }, itemCode: null,
      workCellId: 'feat-x', workCellSource: 'branch', workCellWhy: { branch: SECRET }, parentId: null, status: 'waiting', entrypoint: 'claude-vscode',
      model: 'opus', turnStartedAt: null, live: true, bridgeUrl: `https://claude.ai/code/${SECRET}`,
      lastPrompt: `${SECRET} prompt`, lastAssistantText: `${SECRET} answer`, waiting: { strong: true, weak: false, items: [`${SECRET} question`] },
      card: { doing: `${SECRET} card` }, costUSD: 44.5, advice: { tip: SECRET }, workflows: [{ name: SECRET }], liveSteps: [{ text: `${SECRET} step` }],
      footprint: { places: [{ root: SECRET }] }, stepPartId: 'cart', startedAt: '2026-10-10T07:00:00.000Z', updatedAt: '2026-10-10T09:30:00.000Z', archived: false, chattable: false,
    }],
    conversations: [{
      sessionId: UUID, title: 'Fix the cart', origin: 'vscode', partId: 'cart', partSource: 'files', partWhy: { files: [`${SECRET}.js`] }, itemCode: null, node: null,
      status: 'waiting', waiting: true, lastStep: { text: `${SECRET} step` }, costUSD: 44.5, startedAt: '2026-10-10T07:00:00.000Z', updatedAt: '2026-10-10T09:30:00.000Z',
      archived: false, live: true, chattable: false, onMap: true, cutOff: false, footprint: { places: [{ root: SECRET }] },
    }],
    visitors: [{ sessionId: UUID, title: SECRET }], roadmap: null,
    decisions: [{ kind: 'item', text: `${SECRET} decision` }], skills: [{ name: `${SECRET}-skill`, command: '/x' }],
    cost: { today: 1.25, d7: 2.25, d30: 3.25 }, costByDay: [{ day: '2026-10-10', usd: 3.25 }], costByModel: { opus: 3.25 }, costWhy: { older: 4, removed: 1 },
  }],
});

test('the look-only key gets the map\'s state without chat words, links, folders or money', async () => {
  let key;
  const root = join(tmpdir(), `${SECRET}-folder`);
  await withServer({ ...REMOTE, collectFn: () => fullState(root), before: (smDir) => { key = newLookKey(smDir); } }, async ({ call, token }) => {
    const owner = await call('GET', '/api/state', { headers: { cookie: `sm_token=${token}` } });
    assert.match(owner.text, /secret prompt/, 'the owner keeps the whole state');
    const res = await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}` } });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /secret/i);
    for (const money of ['11.5', '22.5', '33.5', '123.25', '400', '66.5', '77.5', '55.5', '44.5', '1.25', '2.25', '3.25']) assert.ok(!res.text.includes(money), money);
    const s = JSON.parse(res.text);
    assert.equal(s.budget, null);
    assert.equal(s.limits, null);
    assert.deepEqual(s.totals, { today: 0, d7: 0, d30: 0 });
    const [p] = s.projects;
    assert.equal(p.id, 'shop-abc123');
    assert.equal(p.root, undefined);
    assert.equal(p.tunnelUrl, undefined);
    assert.equal(p.arch.parts[0].name, 'Cart', 'the map is drawn as it is');
    assert.deepEqual(p.arch.parts[0].chatIds, [UUID]);
    assert.deepEqual(p.cost, { today: 0, d7: 0, d30: 0 });
    assert.deepEqual([p.costByDay, p.costByModel, p.skills, p.decisions, p.visitors], [[], {}, [], [], []]);
    assert.equal(p.ai, null);
    assert.equal(p.foundation, null);
    const [c] = p.chats;
    assert.deepEqual({ id: c.sessionId, title: c.title, status: c.status, partId: c.partId, workCellId: c.workCellId }, { id: UUID, title: 'Fix the cart', status: 'waiting', partId: 'cart', workCellId: 'feat-x' });
    assert.deepEqual(c.waiting, { strong: true, weak: false, items: [] });
    for (const gone of ['lastPrompt', 'lastAssistantText', 'bridgeUrl', 'advice', 'card', 'costUSD']) assert.ok(!c[gone], gone);
    const [row] = p.conversations;
    assert.equal(row.title, 'Fix the cart');
    assert.ok(!row.costUSD);
    assert.equal(p.workCells[0].branch, 'feat/x');
    assert.deepEqual(p.activity.map((a) => [a.kind, a.partIds, a.subject]), [['commit', ['cart'], undefined]]);
    // Its own tag: a poll never mixes the two answers.
    assert.notEqual(res.headers.etag, owner.headers.etag);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}`, 'if-none-match': res.headers.etag } })).status, 304);
    assert.equal((await call('GET', '/api/state', { headers: { cookie: `sm_look=${key}`, 'if-none-match': owner.headers.etag } })).status, 200);
  });
});
