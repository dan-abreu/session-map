import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { RESUME_FILE, resumeAfterRestart, resumeNote } from '../server/restart.mjs';

// The hub's side of the agreed restart (sv13), with the fake claude: while a restart waits no new turn starts and an
// automatic answer is held; the hub says how many chats are mid-turn and lists the ones it drives; the new process
// resumes them through the hub's own start.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const CLOSED = '11111111-1111-4111-8111-111111111111';
const AUTO = { kind: 'talk' }; // the page chat: the brain's Conversa (id146)

function makeState(root) {
  const state = {
    projects: [{
      id: 'demo-abc123', name: 'demo', root,
      arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [{ id: 'auth', name: 'Auth', file: 'docs/architecture/auth.md', about: 'Sign in.', codePaths: [], groups: [] }] },
      workCells: [],
      chats: [{ sessionId: CLOSED, title: 'Fix the login', partId: 'auth', chattable: true, live: false, card: null }],
    }],
  };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map([[CLOSED, { projectId: 'demo-abc123', root, cwd: root, pid: null }]]) }, enumerable: false });
  return state;
}

function recorder() {
  const events = [];
  const waiters = [];
  const sink = {
    write(evt) {
      events.push(evt);
      for (const w of [...waiters]) if (w.pred(evt)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(evt); }
    },
    end() {},
  };
  const until = (pred, ms = 8000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      waiters.push({ pred, resolve, timer: setTimeout(() => reject(new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)), ms) });
    });
  };
  return { sink, events, until };
}

async function withHub(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-restart-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-restart-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, snapshot: async () => null, ...opts });
  try {
    await fn({ hub, state: makeState(root), smDir, root });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const turnEnds = (r) => r.events.filter((e) => e.type === 'turn-end').length;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('while a restart waits, no new turn starts: a message, a new chat and a resume are told to send again soon', async () => {
  await withHub({}, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Hello', run: AUTO }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((e) => e.type === 'turn-end');

    hub.hold(true);
    assert.deepEqual(hub.send(res.body.chatKey, { text: 'More' }), { status: 409, body: { ok: false, error: 'server-restarting' } });
    assert.deepEqual(await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Another' }, state), { status: 409, body: { ok: false, error: 'server-restarting' } });
    assert.deepEqual(await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Go on' }, state), { status: 409, body: { ok: false, error: 'server-restarting' } });
    assert.equal(turnEnds(r), 1);
    assert.equal(r.events.filter((e) => e.type === 'user').length, 1, 'nothing was sent');

    hub.hold(false);
    assert.equal(hub.send(res.body.chatKey, { text: 'More' }).status, 200);
  });
});

test('the hub counts the chats mid-turn and lists every chat it drives with its key, project, run and turn', async () => {
  await withHub({}, async ({ hub, state }) => {
    assert.equal(hub.turning(), 0);
    assert.deepEqual(hub.restartList(), []);
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Count SLOW', run: AUTO }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const { data } = await r.until((e) => e.type === 'session');
    assert.equal(hub.turning(), 1);
    assert.deepEqual(hub.restartList(), [{ sessionId: data.sessionId, key: res.body.chatKey, projectId: 'demo-abc123', run: AUTO, running: true, held: false }]);

    hub.stop(res.body.chatKey);
    await r.until((e) => e.type === 'turn-end');
    assert.equal(hub.turning(), 0, 'the safe moment');
    assert.equal(hub.restartList()[0].running, false);
  });
});

test('while a restart waits, Autonomous\'s automatic answer to reinforce is held and the chat is listed as held', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Rebuild the sign in RUN:ask-reinforce:0.5', run: { kind: 'autonomous' } }, state);
    hub.hold(true);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((e) => e.type === 'turn-end');
    await pause(200);
    assert.equal(turnEnds(r), 1, 'no automatic answer starts a turn');
    assert.equal(r.events.filter((e) => e.type === 'user').length, 1);
    assert.equal(hub.turning(), 0);
    assert.deepEqual(hub.restartList().map((c) => [c.running, c.held]), [[false, true]]);
  });
});

test('after a restart the hub resumes a chat cut mid-turn with the note, as Continue does', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [CLOSED]: { projectId: 'demo-abc123', partId: 'auth', cwd: root, root, run: AUTO, prompted: 'plain', running: true, title: 'Fix the login', startedAt: new Date().toISOString() },
    }));
    writeFileSync(join(smDir, RESUME_FILE), JSON.stringify({
      version: 1, at: new Date().toISOString(), reasons: ['Reload after editing hub.mjs'],
      chats: [{ sessionId: CLOSED, key: 'a'.repeat(32), projectId: 'demo-abc123', run: AUTO, running: true, held: false, asked: false }],
    }));
    const alerts = [];
    assert.deepEqual(await resumeAfterRestart({ smDir, hub, readState: async () => state, onAlert: (a) => alerts.push(a) }), { resumed: 1, left: 0 });
    const listed = hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats;
    assert.equal(listed[0].sessionId, CLOSED);
    assert.ok(listed[0].chatKey, 'the hub drives it again');
    const r = recorder();
    hub.subscribe(listed[0].chatKey, r.sink);
    const user = await r.until((e) => e.type === 'user');
    assert.equal(user.data.text, resumeNote(['Reload after editing hub.mjs'], { asked: false }));
    await r.until((e) => e.type === 'turn-end');
    assert.equal(alerts[0].reason, 'restarted');
    assert.equal(alerts[0].resumed, 1);
  });
});

test('after a restart a chat that was between turns is driven again without a message, and takes the next one as usual', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [CLOSED]: { projectId: 'demo-abc123', partId: 'auth', cwd: root, root, run: AUTO, prompted: 'plain', running: false, title: 'Fix the login', startedAt: new Date().toISOString() },
    }));
    assert.equal((await hub.start({ projectId: 'demo-abc123', idle: true }, state)).status, 400, 'only a resume may start without a message');
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, run: AUTO, idle: true }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await pause(300);
    assert.equal(r.events.filter((e) => e.type === 'user').length, 0, 'nothing is sent');
    assert.equal(hub.turning(), 0);
    assert.deepEqual(hub.restartList().map((c) => [c.sessionId, c.running]), [[CLOSED, false]]);
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats[0].chatKey, res.body.chatKey, 'driven, not cut off');
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, idle: true }, state)).body.chatKey, res.body.chatKey, 'a second one finds it driven');
    assert.equal(hub.send(res.body.chatKey, { text: 'Go on' }).status, 200);
    const user = await r.until((e) => e.type === 'user');
    assert.equal(user.data.text, 'Go on');
    await r.until((e) => e.type === 'turn-end');
  });
});
