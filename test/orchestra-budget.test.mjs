import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetOf } from '../server/budget.mjs';
import { TIDY_TEXT, createOrchestra } from '../server/chat/orchestra.mjs';
import { normalizePath } from '../server/paths.mjs';

// The polite pause of a project's monthly budget (orchestration or07): once used up and not continued, the orchestrator
// opens no new activity chat, continues no older conversation, sends no new step and runs no tidy pass; nothing running
// is stopped or closed. Under the limit, the same calls go through.

const PROJECT = 'shop-1';
const ORCH = 'orch-1111';

function setup({ paused, running = true }) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-orch-budget-'));
  const root = join(smDir, 'shop');
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projects: { [normalizePath(root)]: { tidy: true } } }));
  const budget = budgetOf({ limitUSD: 10, claudeUSD: paused ? 10.5 : 4, month: '2026-10' });
  const items = [{ code: 'au01', title: 'Login', status: 'todo' }, { code: 'au02', title: 'Reset', status: 'todo' }];
  const state = {
    projects: [{
      id: PROJECT, name: 'shop', root, budget,
      arch: { parts: [{ id: 'auth', name: 'Auth', groups: [{ name: 'Login', items }] }] },
      conversations: [{ sessionId: 'old-1', title: 'Older work', live: false, archived: false, node: null, parentId: null, updatedAt: '2026-10-01T10:00:00Z' }],
    }],
  };
  const orch = { key: 'k-orch', sessionId: ORCH, projectId: PROJECT, node: { kind: 'orchestrator' }, running: false };
  const working = { key: 'k-run', sessionId: 'run-1', projectId: PROJECT, parentId: ORCH, running, node: { kind: 'item', code: 'au01' } };
  const idle = { key: 'k-idle', sessionId: 'idle-1', projectId: PROJECT, parentId: ORCH, running: false, node: { kind: 'item', code: 'au02' } };
  const chats = [orch, working, idle];
  const pages = {
    [ORCH]: { projectId: PROJECT, node: { kind: 'orchestrator' }, startedAt: '2026-10-01T09:00:00Z' },
    'run-1': { projectId: PROJECT, parentId: ORCH, node: working.node },
    'idle-1': { projectId: PROJECT, parentId: ORCH, node: idle.node },
  };
  const seen = { started: [], sent: [], closed: [], stopped: [] };
  const hub = {
    live: () => chats.filter((c) => !c.ended), byKey: (key) => chats.find((c) => c.key === key) ?? null,
    driven: (id) => chats.find((c) => c.sessionId === id && !c.ended) ?? null,
    start: async (body, _state, internal) => {
      seen.started.push({ body, internal });
      const chat = { key: `k-new${seen.started.length}`, sessionId: `new-${seen.started.length}`, projectId: body.projectId, parentId: internal?.parentId, running: true };
      chats.push(chat);
      return { status: 200, body: { chatKey: chat.key } };
    },
    send: (chat, text) => seen.sent.push({ to: chat.sessionId, text }), say: () => ({ status: 200 }), holding: () => false,
    pageChats: () => pages, closeIdle: async (id) => { seen.closed.push(id); return true; }, emit: () => {}, alert: () => {},
    transcript: () => null, driving: () => new Set(chats.map((c) => c.sessionId)), chatsMax: 20, stop: (key) => seen.stopped.push(key),
  };
  const orchestra = createOrchestra({ smDir, hub, readState: async () => state, every: () => null, namedMs: 200 });
  const call = (name, args) => orchestra.call(orch, { name, arguments: args });
  return { smDir, orchestra, call, seen, chats, working, cleanup: () => rmSync(smDir, { recursive: true, force: true }) };
}

const START = { code: 'au02', instructions: 'Build the reset form.', model: 'sonnet', effort: 'medium' };

test('at 100% the orchestrator opens no new chat, continues no older one and sends no new step; what runs is untouched', async () => {
  const s = setup({ paused: true });
  try {
    for (const [name, args] of [
      ['start_chat', START],
      ['continue_conversation', { sessionId: 'old-1', instructions: 'Finish it.', model: 'haiku', effort: 'low' }],
      ['send_to_chat', { key: 'idle-1', instructions: 'Next step.' }],
      ['send_to_chat', { key: 'run-1', instructions: 'After this, the tests.' }],
    ]) {
      const res = await s.call(name, args);
      assert.equal(res.ok, false, name);
      assert.match(res.error, /^budget: this project used US\$ 10\.50 of its US\$ 10\.00 .*Ask the person.*"ask-reinforce"/, name);
    }
    assert.deepEqual(s.seen.started, [], 'no chat was started or resumed');
    assert.deepEqual(s.seen.sent, [], 'no new step went to any chat');
    assert.deepEqual([s.seen.closed, s.seen.stopped], [[], []], 'nothing was closed or stopped');
    assert.equal(s.working.running, true, 'the chat at work goes on');
    // Reading and listing still work, so it can tell the person what is going on.
    const listed = await s.call('list_chats', {});
    assert.equal(listed.ok, true);
    assert.equal(JSON.parse(listed.text).chats.length, 2);
  } finally { s.cleanup(); }
});

test('under the budget the same calls go through', async () => {
  const s = setup({ paused: false });
  try {
    const opened = await s.call('start_chat', START);
    assert.equal(opened.ok, true, opened.error);
    const sent = await s.call('send_to_chat', { key: 'idle-1', instructions: 'Next step.' });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(s.seen.started.length, 1);
    assert.deepEqual(s.seen.sent.map((x) => x.to), ['idle-1']);
  } finally { s.cleanup(); }
});

test('the tidy pass waits while the project is paused, and goes once it is not', async () => {
  const paused = setup({ paused: true, running: false });
  try {
    await paused.orchestra.tick();
    assert.deepEqual(paused.seen.sent, [], 'no tidy pass while paused');
  } finally { paused.cleanup(); }
  const open = setup({ paused: false, running: false });
  try {
    await open.orchestra.tick();
    assert.deepEqual(open.seen.sent.map((x) => [x.to, x.text]), [[ORCH, TIDY_TEXT]]);
  } finally { open.cleanup(); }
});
