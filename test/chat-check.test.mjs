import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';

// The OK at the end of a request in the hub (or26): computed at the turn's end, sent with it, kept on the chat.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

async function withHub(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-check-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-check-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: join(smDir, 'argv.json') }, snapshot: async () => null, ...opts });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  try {
    await fn({ hub, state, smDir });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function turn(hub, state, text) {
  const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text }, state);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const events = [];
  let wake;
  const done = new Promise((resolve) => { wake = resolve; });
  hub.subscribe(res.body.chatKey, { write(e) { events.push(e); if (e.type === 'turn-end') wake(); }, end() {} });
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('no turn-end')), 10000))]);
  return events.find((e) => e.type === 'turn-end').data;
}

test('the turn-end carries the check and the chat keeps the last one', async () => {
  const seen = [];
  const inputs = (arg) => {
    seen.push(arg.startedAt);
    return {
      entries: [{ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 1000 }, content: [{ type: 'text', text: 'oi' }] } }],
      gitAfter: { commits: [], plans: {} },
    };
  };
  await withHub({ turnInputs: inputs }, async ({ hub, state, smDir }) => {
    const data = await turn(hub, state, 'oi, tudo bem?');
    assert.equal(seen.length, 1);
    assert.deepEqual(data.check.missing, []);
    assert.equal(data.check.tests, null);
    assert.ok(data.check.costUSD > 0);
    const saved = Object.values(JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8')));
    assert.deepEqual(saved[0].check, data.check);
  });
});

test('a failure in reading the turn gives no check and the turn still ends', async () => {
  await withHub({ turnInputs: () => { throw new Error('boom'); } }, async ({ hub, state }) => {
    const data = await turn(hub, state, 'oi');
    assert.equal(data.check, undefined);
    assert.equal(data.isError, false);
  });
});
