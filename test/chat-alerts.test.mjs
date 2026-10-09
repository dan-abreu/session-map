import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const CLOSED = '11111111-1111-4111-8111-111111111111';

function makeState(root, { liveIds = [] } = {}) {
  const state = {
    projects: [{
      id: 'demo-abc123', name: 'demo', root,
      arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [{ id: 'auth', name: 'Auth', file: 'docs/architecture/auth.md', about: '', codePaths: [], groups: [] }] },
      workCells: [],
      chats: [{ sessionId: CLOSED, title: 'Fix the login', partId: 'auth', chattable: true, live: false, card: null }],
      conversations: liveIds.map((sessionId) => ({ sessionId, live: true })),
    }],
  };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map([[CLOSED, { projectId: 'demo-abc123', root, cwd: root, pid: null }]]) }, enumerable: false });
  return state;
}

function recorder() {
  const events = [];
  const sink = { write: (evt) => events.push(evt), end() {} };
  const until = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`));
      return setTimeout(check, 20);
    };
    check();
  });
  return { sink, events, until };
}

async function withDirs(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-alert-dir-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-alert-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-alert-sm-'));
  const env = { ...process.env, FAKE_TRANSCRIPTS: join(dir, 'projects', 'demo') };
  try {
    await fn({ dir, root, smDir, env });
  } finally {
    for (const d of [dir, root, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function run(hub, state, body) {
  const res = await hub.start({ projectId: 'demo-abc123', ...body }, state);
  const r = recorder();
  hub.subscribe(res.body.chatKey, r.sink);
  return { key: res.body.chatKey, r };
}

test('a page chat tells the watcher the moment it finishes, asks or fails, and is left out of the diff', async () => {
  await withDirs(async ({ dir, root, smDir, env }) => {
    const alerts = [];
    const hub = createChatHub({ smDir, dir, bin: FAKE, env, onAlert: (a) => alerts.push(a) });
    try {
      const state = makeState(root);
      const { key, r } = await run(hub, state, { sessionId: CLOSED, text: 'Show the error' });
      const turns = () => r.events.filter((e) => e.type === 'turn-end').length;
      await r.until(() => turns() === 1);
      assert.deepEqual(alerts, [{ kind: 'finished', reason: 'answer', projectId: 'demo-abc123', projectName: 'demo', sessionId: CLOSED, title: 'Fix the login', origin: 'map', summary: 'echo: Show the error' }]);
      assert.ok(hub.drivenIds().has(CLOSED));

      hub.send(key, { text: 'Which one do you want?' });
      await r.until(() => turns() === 2);
      assert.deepEqual(alerts.slice(1).map((a) => [a.kind, a.reason]), [['waiting', 'asks']]);

      hub.send(key, { text: 'PERM:Write' });
      const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
      assert.deepEqual([alerts[2].kind, alerts[2].reason, alerts[2].tool], ['waiting', 'permission', 'Write']);
      hub.permission(key, { requestId: asked.data.requestId, allow: true });
      await r.until(() => alerts.length === 4);
      assert.equal(alerts[3].kind, 'finished');

      hub.send(key, { text: 'SLOW' });
      await r.until((e) => e.type === 'text' && e.data.partial);
      hub.stop(key);
      await r.until(() => turns() === 4);
      assert.equal(alerts.length, 4, 'the person stopped it: nothing to tell');
    } finally {
      await hub.close();
    }
  });
});

test('a restart in the middle of a turn: the next server knows the chat was cut off, says so once resumed, and clears it', async () => {
  await withDirs(async ({ dir, root, smDir, env }) => {
    const state = makeState(root);
    const first = createChatHub({ smDir, dir, bin: FAKE, env });
    let sessionId;
    try {
      const { r } = await run(first, state, { partId: 'auth', text: 'SLOW' });
      sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await r.until((e) => e.type === 'text' && e.data.partial);
    } finally {
      await first.close();
    }

    const later = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      assert.equal(later.history(sessionId, state).body.interrupted, true);
      assert.equal(later.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats[0].interrupted, true);
      assert.deepEqual(later.interrupted(state), [{ kind: 'error', reason: 'restart', projectId: 'demo-abc123', projectName: 'demo', sessionId, title: 'SLOW', origin: 'map' }]);
      assert.deepEqual(later.interrupted(makeState(root, { liveIds: [sessionId] })), [], 'still running elsewhere: not cut off');

      const { r } = await run(later, state, { sessionId, text: 'Continue' });
      await r.until((e) => e.type === 'turn-end');
      assert.equal(later.history(sessionId, state).body.interrupted, false);
      assert.deepEqual(later.interrupted(state), []);
    } finally {
      await later.close();
    }
  });
});

test('a chat that finished before the restart is not cut off', async () => {
  await withDirs(async ({ dir, root, smDir, env }) => {
    const state = makeState(root);
    const first = createChatHub({ smDir, dir, bin: FAKE, env });
    let sessionId;
    try {
      const { r } = await run(first, state, { partId: 'auth', text: 'hello' });
      sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await r.until((e) => e.type === 'turn-end');
    } finally {
      await first.close();
    }
    const later = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      assert.equal(later.history(sessionId, state).body.interrupted, false);
      assert.deepEqual(later.interrupted(state), []);
    } finally {
      await later.close();
    }
  });
});
