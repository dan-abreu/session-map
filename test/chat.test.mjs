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

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const CLOSED = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const MOTHER = '33333333-3333-4333-8333-333333333333';

function makeState(root) {
  const chat = (sessionId, extra) => ({ sessionId, title: `chat ${sessionId.slice(0, 4)}`, partId: 'auth', chattable: true, live: false, card: null, ...extra });
  const state = {
    projects: [{
      id: 'demo-abc123', name: 'demo', root,
      arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [{ id: 'auth', name: 'Auth', file: 'docs/architecture/auth.md', about: 'Sign in and sessions.', codePaths: [], groups: [] }] },
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
  assert.deepEqual(translate({ type: 'system', subtype: 'init', session_id: CLOSED, permissionMode: 'auto', model: 'claude-opus-5-5' }), [{ type: 'session', data: { sessionId: CLOSED, mode: 'auto', model: 'claude-opus-5-5' } }]);
  assert.equal(translate({ type: 'system', subtype: 'init', session_id: CLOSED, model: 7 })[0].data.model, null);
  assert.deepEqual(translate({ type: 'system', subtype: 'hook_started', session_id: CLOSED }), []);
  assert.deepEqual(translate({ type: 'rate_limit_event' }), []);
  assert.deepEqual(translate({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'O' } } }), [{ type: 'text', data: { text: 'O', partial: true } }]);
  assert.deepEqual(translate({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }] } }), [{ type: 'thinking', data: { text: '' } }, { type: 'text', data: { text: 'OK', partial: false } }], 'thinking shows as "thinking", even with its words hidden');
  const [use] = translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: 'x.txt', content: 'y'.repeat(1000) } }] } });
  assert.equal(use.type, 'tool');
  assert.equal(use.data.phase, 'use');
  assert.equal(use.data.name, 'Write');
  assert.ok(!use.data.input.includes('yyyy'), 'the written text shows as the diff, not twice');
  assert.deepEqual(use.data.step, { kind: 'edit', target: 'x.txt' });
  assert.equal(use.data.diff.hunks[0].after, 'y'.repeat(1000));
  const [todo] = translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'TodoWrite', input: { todos: [{ content: 'Ship', status: 'pending', activeForm: 'Shipping' }] } }] } });
  assert.deepEqual(todo.data.todos, [{ text: 'Ship', status: 'pending', active: 'Shipping' }]);
  const [secret] = translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'export TOKEN=abc123secret' } }] } });
  assert.ok(!secret.data.input.includes('abc123secret'), 'a step never shows a secret');
  assert.deepEqual(translate({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Weighing it.' }] } }), [{ type: 'thinking', data: { text: 'Weighing it.' } }]);
  assert.deepEqual(translate({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'nope', is_error: true }] } }), [{ type: 'tool', data: { phase: 'result', id: 'toolu_1', isError: true, text: 'nope' } }]);
  const [end] = translate({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: CLOSED, stop_reason: null, terminal_reason: 'aborted_streaming', permission_denials: [{ tool_name: 'Write' }], total_cost_usd: 0.25 });
  assert.deepEqual(end, { type: 'turn-end', data: { subtype: 'error_during_execution', isError: true, sessionId: CLOSED, terminalReason: 'aborted_streaming', denials: 1, processCostUSD: 0.25 } });
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

const partSection = (p) => `Part of the architecture: ${p.name} (${p.about})`;

test('firstPrompt: the part, the mother card, the board hint, then what the person wrote', () => {
  const state = makeState('/x');
  const [project] = state.projects;
  const text = firstPrompt({ sections: [partSection(project.arch.parts[0])], mother: project.chats[2], text: 'Add the error message', board: true });
  for (const piece of ['Auth', 'Sign in and sessions.', 'Login form', 'Wiring the submit button', 'Use fetch', '/session-map:board', 'Add the error message']) {
    assert.ok(text.includes(piece), piece);
  }
  assert.ok(text.indexOf('/session-map:board') < text.indexOf('Add the error message'));
  assert.equal(firstPrompt({ text: 'Just this' }).endsWith('Just this'), true);
});

test('firstPrompt without the plugin explains the session-map block inline instead of naming /session-map:board', () => {
  const state = makeState('/x');
  const [project] = state.projects;
  const text = firstPrompt({ sections: [partSection(project.arch.parts[0])], text: 'Add the error message', board: false });
  assert.ok(!text.includes('/session-map:board'));
  assert.match(text, /```session-map/);
  assert.match(text, /"doing"/);
  assert.ok(text.indexOf('```session-map') < text.indexOf('Add the error message'));
});

test('start a new chat: session, text and turn-end arrive in order; the mother is recorded in lineage.json', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', parentId: MOTHER, text: 'Hello there' }, state);
    assert.equal(res.status, 200);
    assert.match(res.body.chatKey, /^[0-9a-f]{32}$/);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.isError, false);
    const types = r.events.map((e) => e.type);
    assert.deepEqual([...new Set(types)], ['user', 'session', 'run', 'text', 'thinking', 'turn-end']);
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
    assert.deepEqual(asked.data.diff, { path: 'x.txt', hunks: [{ before: '', after: 'hi' }] }, 'an edit asks with its before and after');
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

test('refusals: live chat 409, unknown project/chat/part 404, empty text 400; one process per session', async () => {
  await withHub({}, async ({ hub, state }) => {
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: LIVE, text: 'hi' }, state)).status, 409);
    assert.equal((await hub.start({ projectId: 'nope', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: '44444444-4444-4444-8444-444444444444', text: 'hi' }, state)).status, 404);
    assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'ghost', text: 'hi' }, state)).status, 404);
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
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi' }, state);
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
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi' }, state);
      assert.equal(res.body.mode, 'auto');
      assert.equal(res.body.downgraded, true);
      const listed = hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state);
      assert.deepEqual(listed.body.settings, { mode: 'auto', downgraded: true });
      assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', mode: 'bypassPermissions' }, state)).status, 400);
    });
  });
});

test('the header choice beats the settings, and changing it mid-conversation reaches the running claude', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    settingsIn(dir, 'auto');
    await withHub({ dir, env }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', mode: 'default' }, state);
      assert.equal(res.body.mode, 'default');
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      assert.equal(hub.mode(res.body.chatKey, { mode: 'acceptEdits' }).status, 200);
      assert.equal(hub.mode(res.body.chatKey, { mode: 'bypassPermissions' }).status, 400);
      hub.send(res.body.chatKey, { text: 'again' });
      await nthTurnEnd(r, 2);
      assert.equal(r.events.filter((e) => e.type === 'mode').at(-1).data.mode, 'acceptEdits');
      assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats[0].mode, 'acceptEdits', 'the choice is kept per conversation');
    });
  });
});

test('a conversation opened on a part is listed there after the panel closes, and after a restart, newest first', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env }, async ({ hub, state, smDir }) => {
      const ids = [];
      for (const text of ['First question', 'Second question']) {
        const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text }, state);
        const r = recorder();
        hub.subscribe(res.body.chatKey, r.sink);
        ids.push((await r.until((e) => e.type === 'session')).data.sessionId);
        await nthTurnEnd(r, 1);
      }
      const live = hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats;
      assert.deepEqual(live.map((c) => c.sessionId), [ids[1], ids[0]]);
      assert.deepEqual(live.map((c) => c.title), ['Second question', 'First question'], 'the person\'s words, not the context block');
      assert.ok(live.every((c) => /^[0-9a-f]{32}$/.test(c.chatKey)), 'still driven: the page can watch it again');
      assert.deepEqual(hub.list({ projectId: 'demo-abc123', partId: 'other' }, state).body.chats, []);

      const later = createChatHub({ smDir, dir, bin: FAKE, env });
      try {
        const listed = later.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats;
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
      const res = await first.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
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
      const res = await first.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:Write' }, state);
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
    assert.deepEqual([...new Set(all.events.map((e) => e.type))], ['user', 'session', 'run', 'text', 'thinking', 'turn-end']);
    assert.ok(all.events.every((e, i) => i === 0 || e.id > all.events[i - 1].id));
    const tail = await readEvents(chatKey, { cookie: `sm_token=${token}`, 'last-event-id': String(all.events[0].id) });
    assert.deepEqual(tail.events.map((e) => e.id), all.events.slice(1).map((e) => e.id));
    assert.equal((await call('POST', `/api/chat/${chatKey}/send`, { headers: writeHeaders, body: { text: 'again' } })).status, 200);
    assert.equal((await call('POST', `/api/chat/${chatKey}/stop`, { headers: writeHeaders, body: {} })).status, 200);
    assert.equal((await call('POST', `/api/chat/${chatKey}/permission`, { headers: writeHeaders, body: { requestId: 'abc', allow: true } })).status, 404);
    assert.equal((await call('POST', '/api/chat/nothex/send', { headers: writeHeaders, body: { text: 'x' } })).status, 404);
    assert.equal((await call('POST', '/api/chat/start', { headers: writeHeaders, body: { projectId: 'demo-abc123', sessionId: LIVE, text: 'hi' } })).status, 409);

    const fresh = JSON.parse((await call('POST', '/api/chat/start', { headers: writeHeaders, body: { projectId: 'demo-abc123', partId: 'auth', text: 'On the part' } })).text);
    await readEvents(fresh.chatKey, { cookie: `sm_token=${token}` });
    const listPath = '/api/chat/list?projectId=demo-abc123&partId=auth';
    assert.equal((await call('GET', listPath)).status, 401, 'the list of conversations needs the token too');
    const listed = JSON.parse((await call('GET', listPath, { headers: { cookie: `sm_token=${token}` } })).text);
    assert.deepEqual(listed.chats.map((c) => [c.title, c.chatKey]), [['On the part', fresh.chatKey]]);
    assert.equal(listed.settings.mode, 'default');
    const sessionId = listed.chats[0].sessionId;
    assert.equal((await call('GET', `/api/chat/history/${sessionId}`)).status, 401);
    assert.equal((await call('GET', `/api/chat/history/${sessionId}`, { headers: { cookie: `sm_token=${token}` } })).status, 200);
    assert.equal((await call('GET', '/api/chat/history/nope', { headers: { cookie: `sm_token=${token}` } })).status, 400);
    const { version } = JSON.parse((await call('GET', `/api/chat/history/${sessionId}`, { headers: { cookie: `sm_token=${token}` } })).text);
    assert.equal(JSON.parse((await call('GET', `/api/chat/history/${sessionId}?since=${version}`, { headers: { cookie: `sm_token=${token}` } })).text).same, true, 'nothing new: the live mirror gets a short answer');
    assert.equal((await call('GET', `/api/chat/image/${sessionId}/0`)).status, 401, 'images need the token too');
    assert.equal((await call('GET', `/api/chat/image/${sessionId}/0`, { headers: { cookie: `sm_token=${token}` } })).status, 404);
    assert.equal((await call('GET', `/api/chat/image/${sessionId}/x`, { headers: { cookie: `sm_token=${token}` } })).status, 404);
    assert.equal((await call('GET', `/api/chat/helper/${sessionId}/abc`, { headers: { cookie: `sm_token=${token}` } })).status, 404);
    assert.equal((await call('POST', `/api/chat/${fresh.chatKey}/mode`, { headers: writeHeaders, body: { mode: 'acceptEdits' } })).status, 200);
    assert.equal((await call('POST', `/api/chat/${fresh.chatKey}/mode`, { headers: writeHeaders, body: { mode: 'bypassPermissions' } })).status, 400);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await chat.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

// The demo project with a map item, plus a second project that has no map yet.
function withItem(state, root) {
  const [project] = state.projects;
  project.arch.layers = [{ id: 'front', name: 'Front', partIds: ['auth'] }];
  project.arch.parts[0].groups = [{ name: 'Login', items: [{ code: 'au07', title: 'Show the error message', detail: ['Under the password field.'], status: 'todo', who: null, weight: null, milestone: null, line: 9 }] }];
  state.projects.push({ id: 'bare-def456', name: 'bare', root, arch: { source: 'none', dir: null, lang: 'en', layers: [], parts: [] }, workCells: [], chats: [] });
  return state;
}

test('a chat opened on an item reads its place, its text and its code; the page keeps the point it was opened on', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    withItem(state, root);
    const res = await hub.start({ projectId: 'demo-abc123', node: { kind: 'item', partId: 'auth', code: 'au07' }, text: 'Do it' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const final = r.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
    for (const piece of ['demo › Front › Auth › Login', 'Show the error message', 'Under the password field.', '`au07`', 'docs/architecture/auth.md', '- [x]', 'Do it']) assert.ok(final.includes(piece), piece);
    assert.equal(r.events[0].data.text, 'Do it');
    const saved = Object.values(JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8')));
    assert.deepEqual(saved.map((c) => [c.partId, c.node]), [['auth', { kind: 'item', code: 'au07' }]]);
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth', code: 'au07' }, state).body.chats.length, 1);
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth', code: 'au08' }, state).body.chats.length, 0);
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats.length, 1, 'an item chat is a chat of its part too');
  });
});

test('"New idea" opens at the project root with no part; it is listed by its kind', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'sm-chat-log-')), 'fake.json');
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state, root }) => {
    withItem(state, root);
    const res = await hub.start({ projectId: 'demo-abc123', node: { kind: 'idea' }, frontId: 'feature/login', text: 'Sign in with a magic link' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const final = r.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
    assert.match(final, /new idea/);
    assert.match(final, /docs\/architecture\/README\.md/);
    assert.equal(JSON.parse(readFileSync(log, 'utf8')).cwd.replace(/\\/g, '/').toLowerCase(), root.replace(/\\/g, '/').toLowerCase());
    const ideas = hub.list({ projectId: 'demo-abc123', kind: 'idea' }, state).body.chats;
    assert.deepEqual(ideas.map((c) => c.title), ['Sign in with a magic link']);
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats.length, 0);
  });
});

test('point refusals: a bad node is 400, an unknown item 404, creating a map that exists or an idea without one 409', async () => {
  await withHub({}, async ({ hub, state, root }) => {
    withItem(state, root);
    const start = (projectId, node) => hub.start({ projectId, node, text: 'hi' }, state).then((r) => [r.status, r.body.error]);
    assert.deepEqual(await start('demo-abc123', { kind: 'cell' }), [400, 'bad-node']);
    assert.deepEqual(await start('demo-abc123', 'item'), [400, 'bad-node']);
    assert.deepEqual(await start('demo-abc123', { kind: 'item', partId: 'auth', code: 'zz01' }), [404, 'unknown-item']);
    assert.deepEqual(await start('demo-abc123', { kind: 'create-arch' }), [409, 'arch-exists']);
    assert.deepEqual(await start('bare-def456', { kind: 'idea' }), [409, 'no-arch']);
    const plain = await hub.start({ projectId: 'bare-def456', text: 'just talk' }, state);
    assert.equal(plain.status, 200, 'a project without a map still chats');
  });
});

// ---- the flow workshop chat ---------------------------------------------------------------

test('a flow workshop chat saves the last mermaid block of each reply as the draft, and tells the AI about hand edits', async () => {
  const { readDraft, writeDraft } = await import('../server/arch/flow.mjs');
  await withHub({}, async ({ hub, state, smDir, root }) => {
    const res = await hub.start({ projectId: 'demo-abc123', node: { kind: 'flow' }, text: 'Draw it:\n```mermaid\nflowchart LR\n  web --> api\n```' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const draftEvt = await r.until((e) => e.type === 'draft');
    await nthTurnEnd(r, 1);
    assert.equal(draftEvt.data.text, 'flowchart LR\n  web --> api');
    assert.equal(readDraft(smDir, 'demo-abc123'), 'flowchart LR\n  web --> api');
    assert.ok(r.events.findIndex((e) => e.type === 'draft') < r.events.findIndex((e) => e.type === 'turn-end'), 'the draft is saved before the turn ends');
    assert.ok(!existsSync(join(root, 'docs')), 'nothing is written in the project');

    writeDraft(smDir, 'demo-abc123', 'flowchart LR\n  x --> y');
    assert.equal(hub.send(res.body.chatKey, { text: 'next' }).status, 200);
    await nthTurnEnd(r, 2);
    const echoed = r.events.filter((e) => e.type === 'text' && !e.data.partial).at(-1).data.text;
    assert.match(echoed, /changed the draft by hand[\s\S]*```mermaid\nflowchart LR\n {2}x --> y\n```[\s\S]*next$/);
    assert.equal(r.events.filter((e) => e.type === 'user').at(-1).data.text, 'next', 'the page shows only what the person wrote');

    assert.equal(hub.send(res.body.chatKey, { text: 'plain words' }).status, 200);
    await nthTurnEnd(r, 3);
    assert.equal(readDraft(smDir, 'demo-abc123'), 'flowchart LR\n  x --> y', 'a reply without a diagram keeps the draft');
    assert.doesNotMatch(r.events.filter((e) => e.type === 'text' && !e.data.partial).at(-1).data.text, /by hand/, 'the AI saw this version already');
  });
});

test('a chat that is not the workshop never writes the draft, whatever its reply holds', async () => {
  const { readDraft } = await import('../server/arch/flow.mjs');
  await withHub({}, async ({ hub, state, smDir }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: '```mermaid\nflowchart LR\n  a --> b\n```' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(readDraft(smDir, 'demo-abc123'), null);
    assert.equal(r.count((e) => e.type === 'draft'), 0);
  });
});

test('a conversation of the list the page did not start: its history reads read-only, and a closed one resumes with --resume', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const OLD = '55555555-5555-4555-8555-555555555555';
    const OPEN_VS = '66666666-6666-4666-8666-666666666666';
    const folder = join(dir, 'projects', 'demo');
    mkdirSync(folder, { recursive: true });
    const lines = (id, prompt) => [
      { type: 'user', sessionId: id, timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: prompt } },
      { type: 'assistant', sessionId: id, timestamp: '2026-10-01T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n');
    writeFileSync(join(folder, `${OLD}.jsonl`), `${lines(OLD, 'Rename the cart store')}\n`);
    writeFileSync(join(folder, `${OPEN_VS}.jsonl`), `${lines(OPEN_VS, 'Fix the header')}\n`);
    await withHub({ dir, env }, async ({ hub, state, root }) => {
      state.projects[0].conversations = [
        { sessionId: OLD, title: 'Rename the cart store', origin: 'terminal', partId: 'auth', chattable: true, live: false },
        { sessionId: OPEN_VS, title: 'Fix the header', origin: 'vscode', partId: null, chattable: false, live: true },
      ];
      state[INTERNALS].chats.set(OLD, { projectId: 'demo-abc123', root, cwd: root, pid: null });
      const shown = hub.history(OLD, state);
      assert.equal(shown.status, 200);
      assert.equal(shown.body.readOnly, true);
      assert.equal(shown.body.title, 'Rename the cart store');
      assert.deepEqual(shown.body.messages.map((m) => [m.role, m.text]), [['user', 'Rename the cart store'], ['assistant', 'Done.']]);
      assert.equal(hub.history(OPEN_VS, state).body.readOnly, true);
      assert.equal(hub.history(OLD).status, 404, 'without the state only page conversations are known');
      assert.equal(hub.history('77777777-7777-4777-8777-777777777777', state).status, 404);

      assert.equal((await hub.start({ projectId: 'demo-abc123', sessionId: OPEN_VS, text: 'x' }, state)).body.error, 'live-chat', 'open in VS Code: never two drivers');
      const res = await hub.start({ projectId: 'demo-abc123', sessionId: OLD, text: 'And the tests' }, state);
      assert.equal(res.status, 200);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      assert.equal(r.events.find((e) => e.type === 'session').data.sessionId, OLD);
    });
  });
});

// ---- the way a page conversation runs: model, effort, Automatic / Manual (plano-v02 item 12) ----

const argvOf = (log) => JSON.parse(readFileSync(log, 'utf8')).argv;
const flagOf = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const fakeLog = () => join(mkdtempSync(join(tmpdir(), 'sm-chat-log-')), 'fake.json');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a new conversation runs Automatic: Opus at high with the maestro prompt; the run event names the real model and the cost', async () => {
  const log = fakeLog();
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state, smDir }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const argv = argvOf(log);
    assert.equal(flagOf(argv, '--model'), 'opus');
    assert.equal(flagOf(argv, '--effort'), 'high');
    assert.match(flagOf(argv, '--append-system-prompt'), /ask-reinforce/);
    const runs = r.events.filter((e) => e.type === 'run');
    assert.deepEqual(runs[0].data.run, { kind: 'auto', selfReinforce: false });
    assert.equal(runs[0].data.model, 'claude-opus-5-5', 'the model claude reported, not the alias');
    assert.equal(runs[0].data.effort, 'high');
    assert.equal(r.events.find((e) => e.type === 'turn-end').data.costUSD, 0.001);
    assert.equal(runs.at(-1).data.costUSD, 0.001);
    const sessionId = r.events.find((e) => e.type === 'session').data.sessionId;
    const saved = JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8'))[sessionId];
    assert.deepEqual(saved.run, { kind: 'auto', selfReinforce: false });
  });
});

test('Manual: a fixed model and effort, Ultracode through --effort ultracode, Same as my Claude with no flags; junk is refused', async () => {
  const log = fakeLog();
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state }) => {
    const run = async (choice) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', run: choice }, state);
      assert.equal(res.status, 200);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      return { argv: argvOf(log), run: r.events.find((e) => e.type === 'run').data };
    };
    const fixed = await run({ kind: 'fixed', model: 'haiku', effort: 'low' });
    assert.deepEqual([flagOf(fixed.argv, '--model'), flagOf(fixed.argv, '--effort'), flagOf(fixed.argv, '--append-system-prompt')], ['haiku', 'low', undefined]);
    assert.equal(fixed.run.model, 'claude-haiku-5-5');
    const ultra = await run({ kind: 'ultracode' });
    assert.equal(flagOf(ultra.argv, '--effort'), 'ultracode');
    assert.equal(ultra.run.ultracode, true);
    const mine = await run({ kind: 'settings' });
    assert.equal(flagOf(mine.argv, '--model'), undefined);
    assert.equal(flagOf(mine.argv, '--effort'), undefined);
    const bad = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', run: { kind: 'fixed', model: 'opus', effort: '--x' } }, state);
    assert.deepEqual([bad.status, bad.body.error], [400, 'bad-run']);
  });
});

test('a conversation the page did not start resumes the way it ran (no flags), and the cost adds to what it had already spent', async () => {
  const log = fakeLog();
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state }) => {
    state.projects[0].conversations = [{ sessionId: CLOSED, title: 'old', chattable: true, live: false, costUSD: 0.5 }];
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'go on' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(flagOf(argvOf(log), '--model'), undefined);
    assert.deepEqual(r.events.find((e) => e.type === 'run').data.run, { kind: 'settings' });
    assert.ok(r.events.some((e) => e.type === 'text' && e.data.text === 'echo: go on'), 'no note: nothing changed');
    assert.equal(r.events.find((e) => e.type === 'turn-end').data.costUSD, 0.501);
  });
});

test('Automatic asks before reinforcing: the run event carries the reason and estimate, and nothing is sent for the person', async () => {
  await withHub({}, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:4.5' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const last = r.events.filter((e) => e.type === 'run').at(-1).data;
    assert.deepEqual([last.level, last.why, last.estimateUSD], ['ask-reinforce', 'touches sign in', 4.5]);
    await pause(150);
    assert.equal(r.count((e) => e.type === 'user'), 1);
  });
});

test('"may reinforce on its own" answers the ask while the monthly limit holds, counts the reinforced cost, and asks again past it', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const run = { kind: 'auto', selfReinforce: true };
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:0.5', run }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 2);
    const auto = r.events.filter((e) => e.type === 'user')[1];
    assert.equal(auto.data.auto, 'reinforce', 'the page shows it as session-map\'s answer, not the person\'s');
    assert.equal(hub.send(res.body.chatKey, { text: 'Doing it RUN:reinforced' }).status, 200);
    await nthTurnEnd(r, 3);
    const spend = JSON.parse(readFileSync(join(smDir, 'reinforced-spend.json'), 'utf8'));
    assert.ok(Object.values(spend)[0] > 0, 'the reinforced turn counts against the month');
    assert.equal(r.events.filter((e) => e.type === 'run').at(-1).data.level, 'reinforced');

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 0.0001 } }));
    hub.send(res.body.chatKey, { text: 'Next one RUN:ask-reinforce:0.5' });
    await nthTurnEnd(r, 4);
    await pause(150);
    assert.equal(turnEnds(r), 4, 'past the limit it waits for the person');
  });
});

test('a reinforced turn counts against the month whatever level it ends on, and session-map answers once per message of the person', async () => {
  await withHub({ env: { ...process.env, FAKE_RUN: 'ask-reinforce:0.1' } }, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const spent = () => Object.values(JSON.parse(readFileSync(join(smDir, 'reinforced-spend.json'), 'utf8')))[0];
    const run = { kind: 'auto', selfReinforce: true };
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:0.1', run }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 2);
    await pause(150);
    assert.equal(turnEnds(r), 2, 'a second ask in a row waits for the person');
    assert.equal(r.count((e) => e.type === 'user' && e.data.auto), 1);
    assert.equal(spent(), 0.001, 'the turn after the OK counts, though it ended asking again');

    assert.equal(hub.send(res.body.chatKey, { text: 'No, the normal way RUN:direct' }).status, 200);
    await nthTurnEnd(r, 3);
    assert.equal(spent(), 0.001, 'a turn that ends working the normal way does not count');
  });
});

test('changing the way it runs mid-conversation restarts claude with the new flags and tells it in the next message, which the page never shows', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const log = fakeLog();
    await withHub({ dir, env: { ...env, FAKE_LOG: log } }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'first' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      assert.equal(hub.run(res.body.chatKey, { run: { kind: 'turbo' } }).status, 400);
      assert.equal(hub.run(res.body.chatKey, { run: { kind: 'fixed', model: 'sonnet', effort: 'medium' } }).status, 200);
      await r.until((e) => e.type === 'session' && e.data.state === 'ended');
      const again = await hub.start({ projectId: 'demo-abc123', sessionId, text: 'second' }, state);
      assert.equal(again.status, 200);
      const r2 = recorder();
      hub.subscribe(again.body.chatKey, r2.sink);
      await nthTurnEnd(r2, 1);
      assert.deepEqual([flagOf(argvOf(log), '--model'), flagOf(argvOf(log), '--effort')], ['sonnet', 'medium']);
      const echoed = r2.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
      assert.match(echoed, /session-map: the way this conversation runs changed/);
      assert.deepEqual(r2.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['second']);
      const shown = hub.history(sessionId, state).body;
      assert.deepEqual(shown.run, { kind: 'fixed', model: 'sonnet', effort: 'medium' });
      assert.ok(shown.messages.filter((m) => m.role === 'user').every((m) => !m.text.includes('session-map: the way')));
    });
  });
});

test('only "may reinforce on its own" changed: the running claude keeps going, no restart and no note', async () => {
  await withHub({}, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'first' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(hub.run(res.body.chatKey, { run: { kind: 'auto', selfReinforce: true } }).status, 200);
    assert.equal(hub.send(res.body.chatKey, { text: 'second' }).status, 200);
    await nthTurnEnd(r, 2);
    assert.ok(r.events.some((e) => e.type === 'text' && e.data.text === 'echo: second'));
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0);
  });
});

test('the list and the history tell the page what "Same as my Claude" runs and how much reinforcing is left this month', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus[1m]', effortLevel: 'xhigh', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }));
    await withHub({ dir, env }, async ({ hub, state, smDir }) => {
      writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 20 } }));
      const listed = hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body;
      assert.deepEqual(listed.mine, { model: 'opus[1m]', effort: 'high', ultracode: false });
      assert.deepEqual(listed.reinforce, { limitUSD: 20, spentUSD: 0 });
    });
  });
});

test('history gives every step, image and helper of a conversation, and says when nothing changed (mm22)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const VS = '88888888-8888-4888-8888-888888888888';
    const folder = join(dir, 'projects', 'demo');
    mkdirSync(join(folder, VS, 'subagents'), { recursive: true });
    const at = (s) => `2026-10-01T10:00:0${s}.000Z`;
    writeFileSync(join(folder, `${VS}.jsonl`), [
      { type: 'user', timestamp: at(0), message: { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] } },
      { type: 'assistant', timestamp: at(1), message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Scan', subagent_type: 'Explore', prompt: 'Scan it' } }] } },
      { type: 'user', timestamp: at(2), toolUseResult: { status: 'completed', agentId: 'abc1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', timestamp: at(3), message: { id: 'm2', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n'));
    writeFileSync(join(folder, VS, 'subagents', 'agent-abc1.jsonl'), [
      { type: 'user', isSidechain: true, timestamp: at(1), message: { role: 'user', content: 'Scan it' } },
      { type: 'assistant', isSidechain: true, timestamp: at(2), message: { id: 'h1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Scanned.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n'));
    await withHub({ dir, env }, async ({ hub, state, root }) => {
      state.projects[0].conversations = [{ sessionId: VS, title: 'Look', origin: 'vscode', partId: null, chattable: false, live: true, status: 'busy', costUSD: 0.5 }];
      state[INTERNALS].chats.set(VS, { projectId: 'demo-abc123', root, cwd: root, pid: null });
      const shown = hub.history(VS, state);
      assert.equal(shown.status, 200);
      assert.deepEqual(shown.body.items.map((i) => i.type), ['user', 'tool', 'assistant']);
      assert.deepEqual(shown.body.items[0].images, [{ n: 0, media: 'image/png' }]);
      assert.equal(shown.body.items[1].agent.id, 'abc1');
      assert.equal(shown.body.live, true, 'still running in VS Code: the page mirrors it');
      assert.equal(typeof shown.body.version, 'string');
      assert.deepEqual(hub.history(VS, state, { since: shown.body.version }).body, { ok: true, same: true, version: shown.body.version });

      const image = hub.image(VS, 0, state);
      assert.equal(image.media, 'image/png');
      assert.deepEqual(image.data, Buffer.from('iVBORw0KGgo=', 'base64'));
      assert.equal(hub.image(VS, 5, state), null);
      assert.equal(hub.image('77777777-7777-4777-8777-777777777777', 0, state), null, 'only a conversation the page knows');

      const helper = hub.helper(VS, 'abc1', state);
      assert.equal(helper.status, 200);
      assert.deepEqual(helper.body.items.map((i) => [i.type, i.text]), [['user', 'Scan it'], ['assistant', 'Scanned.']]);
      assert.equal(hub.helper(VS, '../x', state).status, 404);
    });
  });
});

test('a message can carry pasted images, which reach claude as image blocks (mm22)', async () => {
  await withHub({}, async ({ hub, state }) => {
    const png = { media: 'image/png', data: 'iVBORw0KGgo=' };
    assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: [{ media: 'text/html', data: 'PGI+' }] }, state)).body.error, 'bad-images');
    assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: Array(5).fill(png) }, state)).body.error, 'bad-images', 'four at most');
    const { body } = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: [png] }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.deepEqual(r.events.find((e) => e.type === 'user').data, { text: 'Look', images: 1 });
    assert.ok(r.events.some((e) => e.type === 'text' && !e.data.partial && e.data.text.endsWith('[images:1]')), 'claude got the image');
    assert.equal(hub.send(body.chatKey, { text: 'And this', images: 'nope' }).body.error, 'bad-images');
    assert.equal(hub.send(body.chatKey, { text: 'And this', images: [png, png] }).status, 200);
    await nthTurnEnd(r, 2);
    assert.ok(r.events.some((e) => e.type === 'text' && !e.data.partial && e.data.text.endsWith('[images:2]')));
  });
});

test('"Resolve with the AI" on a clash opens at the project root and tells the AI to ask the OK before joining anything', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'sm-chat-log-')), 'fake.json');
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state, root }) => {
    const [project] = state.projects;
    const cell = (id, name, ahead) => ({ id, branch: name, path: join(root, name), ahead, status: 'active', owner: { name: 'Ana', email: 'a@x.org' }, lastCommit: { subject: `work on ${name}` }, files: [{ path: 'src/pay.js' }], clashWith: [] });
    project.workCells = [cell('w1', 'feat/pay', 5), cell('w2', 'feat/cart', 1)];
    const res = await hub.start({ projectId: 'demo-abc123', node: { kind: 'clash', workCellIds: ['w1', 'w2'] }, text: 'Resolve this clash.' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const final = r.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
    for (const piece of ['feat/pay', 'feat/cart', 'src/pay.js', 'until the person says OK']) assert.ok(final.includes(piece), piece);
    const norm = (p) => p.replaceAll('\\', '/').toLowerCase();
    assert.equal(norm(JSON.parse(readFileSync(log, 'utf8')).cwd), norm(root), 'the joining happens in the main folder');
    const bad = await hub.start({ projectId: 'demo-abc123', node: { kind: 'clash', workCellIds: ['w1', 'nope'] }, text: 'x' }, state);
    assert.deepEqual([bad.status, bad.body.error], [404, 'unknown-front']);
  });
});
