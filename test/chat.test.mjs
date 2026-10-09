import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { buildArgs, translate } from '../server/chat/driver.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { firstPrompt } from '../server/chat/prompt.mjs';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { readLineage } from '../server/brain/lineage.mjs';
import { readOverrides } from '../server/brain/cells.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const CLOSED = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const MOTHER = '33333333-3333-4333-8333-333333333333';

function makeState(root) {
  const nucleus = { state: 'Login works with email.', decided: ['Sessions live 30 days'], todo: ['Rate limit the form'], recent: [] };
  const chat = (sessionId, extra) => ({ sessionId, title: `chat ${sessionId.slice(0, 4)}`, unitId: 'auth', chattable: true, live: false, card: null, ...extra });
  const state = {
    projects: [{
      id: 'demo-abc123', name: 'demo', root,
      units: [{ id: 'auth', name: 'Auth', purpose: 'Sign in and sessions', nucleus }],
      workCells: [{ id: 'feature/login', branch: 'feature/login', path: null }],
      chats: [
        chat(CLOSED),
        chat(LIVE, { chattable: false, live: true, status: 'busy' }),
        chat(MOTHER, { card: { title: 'Login form', doing: 'Wiring the submit button', todo: ['Error message'], decided: ['Use fetch'] } }),
      ],
    }],
  };
  const internals = new Map([CLOSED, LIVE, MOTHER].map((id) => [id, { projectId: 'demo-abc123', root, cwd: root, pid: null }]));
  Object.defineProperty(state, INTERNALS, { value: { chats: internals }, enumerable: false });
  return state;
}

// A sink that records SSE events and lets a test wait for the one it needs.
function recorder() {
  const events = [];
  const waiters = [];
  const sink = {
    write(evt) {
      events.push(evt);
      for (const w of [...waiters]) if (w.pred(evt)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(evt); }
    },
    end() { sink.ended = true; },
  };
  const until = (pred, ms = 8000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: setTimeout(() => reject(new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)), ms) };
      waiters.push(w);
    });
  };
  const count = (pred) => events.filter(pred).length;
  return { sink, events, until, count };
}

async function withHub(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-chat-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, ...opts });
  try {
    await fn({ hub, state: makeState(root), smDir, root });
  } finally {
    await hub.close();
    // On Windows the permission relay a killed fake claude started keeps the folder open for a moment; only the async rm retries EBUSY.
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const turnEnds = (r) => r.count((e) => e.type === 'turn-end');
const nthTurnEnd = (r, n) => r.until(() => turnEnds(r) >= n).then(() => r.events.filter((e) => e.type === 'turn-end')[n - 1]);

test('translate maps the stream-json lines of the spike to page events and ignores the rest', () => {
  assert.deepEqual(translate({ type: 'system', subtype: 'init', session_id: CLOSED, permissionMode: 'auto' }), [{ type: 'session', data: { sessionId: CLOSED, mode: 'auto' } }]);
  assert.deepEqual(translate({ type: 'system', subtype: 'hook_started', session_id: CLOSED }), []);
  assert.deepEqual(translate({ type: 'rate_limit_event' }), []);
  assert.deepEqual(translate({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'O' } } }), [{ type: 'text', data: { text: 'O', partial: true } }]);
  assert.deepEqual(translate({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }] } }), [{ type: 'text', data: { text: 'OK', partial: false } }]);
  const [use] = translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: 'x.txt', content: 'y'.repeat(1000) } }] } });
  assert.equal(use.type, 'tool');
  assert.equal(use.data.phase, 'use');
  assert.equal(use.data.name, 'Write');
  assert.ok(use.data.input.length <= 280);
  assert.deepEqual(translate({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'nope', is_error: true }] } }), [{ type: 'tool', data: { phase: 'result', id: 'toolu_1', isError: true, text: 'nope' } }]);
  const [end] = translate({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: CLOSED, stop_reason: null, terminal_reason: 'aborted_streaming', permission_denials: [{ tool_name: 'Write' }] });
  assert.deepEqual(end, { type: 'turn-end', data: { subtype: 'error_during_execution', isError: true, sessionId: CLOSED, terminalReason: 'aborted_streaming', denials: 1 } });
});

test('buildArgs: stream-json both ways, partial messages, our MCP only, default permission mode, never a bypass', () => {
  const args = buildArgs({ mcpConfigPath: '/tmp/x.json' });
  for (const flag of ['-p', '--verbose', '--include-partial-messages', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
  assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'mcp__sessionmap__approve');
  assert.equal(args[args.indexOf('--mcp-config') + 1], '/tmp/x.json');
  assert.ok(!args.join(' ').match(/bypass|dangerously/i));
  assert.ok(!args.includes('--resume'));
  const resumed = buildArgs({ mcpConfigPath: '/tmp/x.json', resume: CLOSED });
  assert.equal(resumed[resumed.indexOf('--resume') + 1], CLOSED);
});

test('buildArgs passes the chosen permission mode and turns a bypass (or junk) into default', () => {
  const at = (args) => args[args.indexOf('--permission-mode') + 1];
  assert.equal(at(buildArgs({ mcpConfigPath: '/tmp/x.json', mode: 'auto' })), 'auto');
  assert.equal(at(buildArgs({ mcpConfigPath: '/tmp/x.json', mode: 'acceptEdits' })), 'acceptEdits');
  assert.equal(at(buildArgs({ mcpConfigPath: '/tmp/x.json', mode: 'bypassPermissions' })), 'default');
  assert.equal(at(buildArgs({ mcpConfigPath: '/tmp/x.json', mode: '--dangerously-skip-permissions' })), 'default');
});

test('firstPrompt: the unit nucleus, the mother card, the board hint, then what the person wrote', () => {
  const state = makeState('/x');
  const [project] = state.projects;
  const text = firstPrompt({ unit: project.units[0], nucleus: project.units[0].nucleus, mother: project.chats[2], text: 'Add the error message', board: true });
  for (const piece of ['Auth', 'Login works with email.', 'Sessions live 30 days', 'Rate limit the form', 'Login form', 'Wiring the submit button', 'Use fetch', '/session-map:board', 'Add the error message']) {
    assert.ok(text.includes(piece), piece);
  }
  assert.ok(text.indexOf('/session-map:board') < text.indexOf('Add the error message'));
  assert.equal(firstPrompt({ text: 'Just this' }).endsWith('Just this'), true);
});

test('firstPrompt without the plugin explains the session-map block inline instead of naming /session-map:board', () => {
  const state = makeState('/x');
  const [project] = state.projects;
  const text = firstPrompt({ unit: project.units[0], nucleus: project.units[0].nucleus, text: 'Add the error message', board: false });
  assert.ok(!text.includes('/session-map:board'));
  assert.match(text, /```session-map/);
  assert.match(text, /"doing"/);
  assert.ok(text.indexOf('```session-map') < text.indexOf('Add the error message'));
});

test('start a new chat: session, text and turn-end arrive in order; the mother is recorded in lineage.json', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const res = await hub.start({ projectId: 'demo-abc123', cellId: 'auth', parentId: MOTHER, text: 'Hello there' }, state);
    assert.equal(res.status, 200);
    assert.match(res.body.chatKey, /^[0-9a-f]{32}$/);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.isError, false);
    const types = r.events.map((e) => e.type);
    assert.deepEqual([...new Set(types)], ['user', 'session', 'text', 'turn-end']);
    assert.equal(r.events[0].data.text, 'Hello there', 'the page sees what the person wrote, not the context block');
    assert.ok(r.events.every((e, i) => i === 0 || e.id > r.events[i - 1].id));
    const final = r.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
    assert.ok(final.includes('Wiring the submit button') && final.includes('```session-map') && final.includes('Hello there'));
    const sessionId = r.events.find((e) => e.type === 'session').data.sessionId;
    assert.equal(readLineage(smDir)[sessionId], MOTHER);
  });
});

test('a second message goes to the same process; a message during a turn is refused', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'first' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(r.events.find((e) => e.type === 'session').data.sessionId, CLOSED, 'resumed the same conversation');
    const busy = hub.send(body.chatKey, { text: 'SLOW' });
    assert.equal(busy.status, 200);
    assert.equal(hub.send(body.chatKey, { text: 'meanwhile' }).status, 409);
    hub.stop(body.chatKey);
    await nthTurnEnd(r, 2);
    assert.equal(hub.send(body.chatKey, { text: 'second' }).status, 200);
    await nthTurnEnd(r, 3);
    assert.ok(r.events.some((e) => e.type === 'text' && !e.data.partial && e.data.text === 'echo: second'));
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'started'), 1, 'the repeated init of each turn is not a new session');
  });
});

test('permission allowed: the card reaches the page, the answer reaches the tool', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Write' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
    assert.equal(asked.data.toolName, 'Write');
    assert.match(asked.data.input, /x\.txt/);
    assert.equal(hub.permission(body.chatKey, { requestId: asked.data.requestId, allow: true, always: false }).status, 200);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 0);
    assert.equal(r.events.find((e) => e.type === 'tool' && e.data.phase === 'result').data.isError, false);
    assert.ok(r.events.some((e) => e.type === 'permission' && e.data.state === 'allowed'));
    assert.equal(hub.permission(body.chatKey, { requestId: asked.data.requestId, allow: true }).status, 404, 'an answered request is gone');
  });
});

test('permission denied: the tool fails and the turn lists the denial', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Bash' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
    hub.permission(body.chatKey, { requestId: asked.data.requestId, allow: false });
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 1);
    const result = r.events.find((e) => e.type === 'tool' && e.data.phase === 'result');
    assert.equal(result.data.isError, true);
    assert.match(result.data.text, /denied/i);
  });
});

test('a permission nobody answers is denied after the timeout', async () => {
  await withHub({ permissionTimeoutMs: 150 }, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Write' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await r.until((e) => e.type === 'permission' && e.data.state === 'timeout');
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 1);
  });
});

test('"always" allows the same tool again in this chat without asking', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Write PERM:Write' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
    hub.permission(body.chatKey, { requestId: asked.data.requestId, allow: true, always: true });
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 0);
    assert.equal(r.count((e) => e.type === 'permission' && e.data.state === 'asked'), 1);
    assert.equal(r.count((e) => e.type === 'tool' && e.data.phase === 'result' && !e.data.isError), 2);
  });
});

test('stop interrupts the turn through stdin and the process takes the next message', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'SLOW' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await r.until((e) => e.type === 'text' && e.data.partial);
    assert.equal(hub.stop(body.chatKey).status, 200);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.isError, true);
    assert.equal(end.data.subtype, 'error_during_execution');
    hub.send(body.chatKey, { text: 'still here?' });
    const next = await nthTurnEnd(r, 2);
    assert.equal(next.data.isError, false);
  });
});

test('refusals: live chat 409, unknown project/chat/unit 404, empty text 400; one process per session', async () => {
  await withHub({}, async ({ hub, state }) => {
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: LIVE, text: 'hi' }, state)).status, 409);
    assert.equal((await hub.start({ projectId: 'nope', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: '44444444-4444-4444-8444-444444444444', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', cellId: 'ghost', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', frontId: 'ghost', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: 'not-a-uuid', text: 'hi' }, state)).status, 400);
    assert.equal((await hub.start({ projectId: 'demo-abc123', text: '' }, state)).status, 400);
    assert.equal(hub.send('f'.repeat(32), { text: 'x' }).status, 404);

    const a = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'one' }, state);
    const r = recorder();
    hub.subscribe(a.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const b = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'two' }, state);
    assert.equal(b.status, 200);
    assert.equal(b.body.chatKey, a.body.chatKey, 'same process, same chat');
    await nthTurnEnd(r, 2);
  });
});

test('the child gets a clean env, the MCP config by file (secret out of argv), and the file goes away', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'sm-chat-log-')), 'fake.json');
  const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', CLAUDECODE: '1', MCP_CONNECTION_NONBLOCKING: '1', FAKE_LOG: log };
  await withHub({ env }, async ({ hub, state, smDir }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'hi' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const seen = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(seen.envKeys.filter((k) => /^(CLAUDE|MCP_CONNECTION_NONBLOCKING)/i.test(k)), []);
    const config = seen.argv[seen.argv.indexOf('--mcp-config') + 1];
    assert.ok(existsSync(config) && !config.trim().startsWith('{'));
    assert.ok(!seen.argv.join(' ').includes(JSON.parse(readFileSync(config, 'utf8')).mcpServers.sessionmap.env.SM_PERMISSION_SECRET));
    await hub.close();
    assert.deepEqual(readdirSync(join(smDir, 'chat')), []);
  });
});

// A Claude folder of its own (settings.json, projects/) and a fake claude that writes its transcripts there.
async function withClaudeDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-chat-dir-'));
  const env = { ...process.env, FAKE_TRANSCRIPTS: join(dir, 'projects', 'demo') };
  try {
    await fn({ dir, env });
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
const settingsIn = (folder, mode) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'settings.json'), JSON.stringify({ permissions: { defaultMode: mode } }));
};

test('the chat runs in the permission mode of the user\'s Claude settings, and says which one', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    settingsIn(dir, 'auto');
    await withHub({ dir, env }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'hi' }, state);
      assert.equal(res.body.mode, 'auto');
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const started = await r.until((e) => e.type === 'session' && e.data.state === 'started');
      assert.equal(started.data.mode, 'auto', 'claude itself reported the mode');
    });
  });
});

test('a bypassPermissions setting runs the chat in auto and the reply says it was lowered', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    settingsIn(dir, 'bypassPermissions');
    await withHub({ dir, env }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'hi' }, state);
      assert.equal(res.body.mode, 'auto');
      assert.equal(res.body.downgraded, true);
      const listed = hub.list({ projectId: 'demo-abc123', unitId: 'auth' }, state);
      assert.deepEqual(listed.body.settings, { mode: 'auto', downgraded: true });
      assert.equal((await hub.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'hi', mode: 'bypassPermissions' }, state)).status, 400);
    });
  });
});

test('the header choice beats the settings, and changing it mid-conversation reaches the running claude', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    settingsIn(dir, 'auto');
    await withHub({ dir, env }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'hi', mode: 'default' }, state);
      assert.equal(res.body.mode, 'default');
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      assert.equal(hub.mode(res.body.chatKey, { mode: 'acceptEdits' }).status, 200);
      assert.equal(hub.mode(res.body.chatKey, { mode: 'bypassPermissions' }).status, 400);
      hub.send(res.body.chatKey, { text: 'again' });
      await nthTurnEnd(r, 2);
      assert.equal(r.events.filter((e) => e.type === 'mode').at(-1).data.mode, 'acceptEdits');
      assert.equal(hub.list({ projectId: 'demo-abc123', unitId: 'auth' }, state).body.chats[0].mode, 'acceptEdits', 'the choice is kept per conversation');
    });
  });
});

test('a conversation opened on a unit is listed there after the panel closes, and after a restart, newest first', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env }, async ({ hub, state, smDir }) => {
      const ids = [];
      for (const text of ['First question', 'Second question']) {
        const res = await hub.start({ projectId: 'demo-abc123', cellId: 'auth', text }, state);
        const r = recorder();
        hub.subscribe(res.body.chatKey, r.sink);
        ids.push((await r.until((e) => e.type === 'session')).data.sessionId);
        await nthTurnEnd(r, 1);
      }
      const live = hub.list({ projectId: 'demo-abc123', unitId: 'auth' }, state).body.chats;
      assert.deepEqual(live.map((c) => c.sessionId), [ids[1], ids[0]]);
      assert.deepEqual(live.map((c) => c.title), ['Second question', 'First question'], 'the person\'s words, not the context block');
      assert.ok(live.every((c) => /^[0-9a-f]{32}$/.test(c.chatKey)), 'still driven: the page can watch it again');
      assert.deepEqual(hub.list({ projectId: 'demo-abc123', unitId: 'other' }, state).body.chats, []);
      assert.equal(readOverrides(smDir, 'demo-abc123')[ids[0]], 'auth', 'the brain shows it in the unit it was opened on');

      const later = createChatHub({ smDir, dir, bin: FAKE, env });
      try {
        const listed = later.list({ projectId: 'demo-abc123', unitId: 'auth' }, state).body.chats;
        assert.deepEqual(listed.map((c) => [c.sessionId, c.chatKey]), [[ids[1], null], [ids[0], null]]);
      } finally { await later.close(); }
    });
  });
});

test('reopening an ended conversation shows its history without the context block and continues it with --resume', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
    const root = mkdtempSync(join(tmpdir(), 'sm-chat-root-'));
    const state = makeState(root);
    let sessionId;
    const first = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      const res = await first.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      first.subscribe(res.body.chatKey, r.sink);
      sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
    } finally { await first.close(); }

    const later = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      const shown = later.history(sessionId);
      assert.equal(shown.status, 200);
      assert.equal(shown.body.chatKey, null);
      assert.deepEqual(shown.body.messages.map((m) => m.role), ['user', 'assistant']);
      assert.equal(shown.body.messages[0].text, 'Add the error message');
      assert.match(shown.body.messages[1].text, /^echo: Context from session-map/);
      assert.equal(later.history('44444444-4444-4444-8444-444444444444').status, 404, 'only conversations born in the page');

      const res = await later.start({ projectId: 'demo-abc123', sessionId, text: 'And the retry' }, state);
      assert.equal(res.status, 200, 'resumable although the state no longer lists it');
      const r = recorder();
      later.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      assert.equal(r.events.find((e) => e.type === 'session').data.sessionId, sessionId);
      assert.deepEqual(r.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['And the retry']);
      assert.ok(r.events.some((e) => e.type === 'text' && e.data.text === 'echo: And the retry'));
      assert.equal(later.history(sessionId).body.messages.length, 2, 'a live chat\'s own turns come from its events, not twice');
      assert.equal((await later.start({ projectId: 'other', sessionId, text: 'x' }, state)).status, 404);
    } finally {
      await later.close();
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

test('"always in this conversation" survives the process: a resumed chat does not ask again', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
    const state = makeState(mkdtempSync(join(tmpdir(), 'sm-chat-root-')));
    let sessionId;
    const first = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      const res = await first.start({ projectId: 'demo-abc123', cellId: 'auth', text: 'PERM:Write' }, state);
      const r = recorder();
      first.subscribe(res.body.chatKey, r.sink);
      sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
      first.permission(res.body.chatKey, { requestId: asked.data.requestId, allow: true, always: true });
      await nthTurnEnd(r, 1);
    } finally { await first.close(); }
    const later = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      const res = await later.start({ projectId: 'demo-abc123', sessionId, text: 'PERM:Write' }, state);
      const r = recorder();
      later.subscribe(res.body.chatKey, r.sink);
      const end = await nthTurnEnd(r, 1);
      assert.equal(end.data.denials, 0);
      assert.equal(r.count((e) => e.type === 'permission'), 0);
    } finally {
      await later.close();
      await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

test('no claude found → 503 without spawning', async () => {
  await withHub({ bin: null }, async ({ hub, state }) => {
    assert.equal((await hub.start({ projectId: 'demo-abc123', text: 'hi' }, state)).status, 503);
  });
});

test('http: chat routes need the token, and SSE delivers events in order with replay by Last-Event-ID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-chat-http-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-http-sm-'));
  const state = makeState(root);
  const chat = createChatHub({ smDir, dir: root, bin: FAKE });
  const app = createApp({ dir: root, smDir, chat, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const host = `127.0.0.1:${port}`;
  const writeHeaders = { origin: `http://${host}`, 'x-session-map': '1', cookie: `sm_token=${token}`, 'content-type': 'application/json' };
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  // Reads the stream until the first turn-end, then hangs up.
  const readEvents = (chatKey, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: `/api/chat/${chatKey}/events`, headers: { host, ...headers } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ status: res.statusCode, events: [] }); return; }
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        if (/event: turn-end/.test(buf)) { req.destroy(); }
      });
      res.on('close', () => {
        const events = buf.split('\n\n').filter((b) => b.includes('event:')).map((b) => ({
          id: Number(/^id: (\d+)/m.exec(b)?.[1]), type: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]),
        }));
        resolve({ status: 200, events });
      });
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' ? null : reject(err)));
    req.end();
  });
  try {
    assert.equal((await call('POST', '/api/chat/start', { body: { projectId: 'demo-abc123', text: 'hi' } })).status, 403, 'no header/origin');
    assert.equal((await call('POST', '/api/chat/start', { headers: { ...writeHeaders, cookie: '' }, body: { projectId: 'demo-abc123', text: 'hi' } })).status, 401);
    const started = await call('POST', '/api/chat/start', { headers: writeHeaders, body: { projectId: 'demo-abc123', sessionId: CLOSED, text: 'hi' } });
    assert.equal(started.status, 200);
    const { chatKey } = JSON.parse(started.text);
    assert.equal((await readEvents(chatKey)).status, 401, 'local GET of a chat still needs the token');
    const all = await readEvents(chatKey, { cookie: `sm_token=${token}` });
    assert.deepEqual([...new Set(all.events.map((e) => e.type))], ['user', 'session', 'text', 'turn-end']);
    assert.ok(all.events.every((e, i) => i === 0 || e.id > all.events[i - 1].id));
    const tail = await readEvents(chatKey, { cookie: `sm_token=${token}`, 'last-event-id': String(all.events[0].id) });
    assert.deepEqual(tail.events.map((e) => e.id), all.events.slice(1).map((e) => e.id));
    assert.equal((await call('POST', `/api/chat/${chatKey}/send`, { headers: writeHeaders, body: { text: 'again' } })).status, 200);
    assert.equal((await call('POST', `/api/chat/${chatKey}/stop`, { headers: writeHeaders, body: {} })).status, 200);
    assert.equal((await call('POST', `/api/chat/${chatKey}/permission`, { headers: writeHeaders, body: { requestId: 'abc', allow: true } })).status, 404);
    assert.equal((await call('POST', '/api/chat/nothex/send', { headers: writeHeaders, body: { text: 'x' } })).status, 404);
    assert.equal((await call('POST', '/api/chat/start', { headers: writeHeaders, body: { projectId: 'demo-abc123', sessionId: LIVE, text: 'hi' } })).status, 409);

    const fresh = JSON.parse((await call('POST', '/api/chat/start', { headers: writeHeaders, body: { projectId: 'demo-abc123', cellId: 'auth', text: 'On the unit' } })).text);
    await readEvents(fresh.chatKey, { cookie: `sm_token=${token}` });
    const listPath = '/api/chat/list?projectId=demo-abc123&unitId=auth';
    assert.equal((await call('GET', listPath)).status, 401, 'the list of conversations needs the token too');
    const listed = JSON.parse((await call('GET', listPath, { headers: { cookie: `sm_token=${token}` } })).text);
    assert.deepEqual(listed.chats.map((c) => [c.title, c.chatKey]), [['On the unit', fresh.chatKey]]);
    assert.equal(listed.settings.mode, 'default');
    const sessionId = listed.chats[0].sessionId;
    assert.equal((await call('GET', `/api/chat/history/${sessionId}`)).status, 401);
    assert.equal((await call('GET', `/api/chat/history/${sessionId}`, { headers: { cookie: `sm_token=${token}` } })).status, 200);
    assert.equal((await call('GET', '/api/chat/history/nope', { headers: { cookie: `sm_token=${token}` } })).status, 400);
    assert.equal((await call('POST', `/api/chat/${fresh.chatKey}/mode`, { headers: writeHeaders, body: { mode: 'acceptEdits' } })).status, 200);
    assert.equal((await call('POST', `/api/chat/${fresh.chatKey}/mode`, { headers: writeHeaders, body: { mode: 'bypassPermissions' } })).status, 400);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await chat.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});
