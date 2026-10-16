import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { buildArgs, translate } from '../server/chat/driver.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { firstPrompt, personsWords } from '../server/chat/prompt.mjs';
import { ownWords } from '../server/statement.mjs';
import { STANCE } from '../server/ai/stance.mjs';
import { TAG_LINE } from '../server/ai/cerebro-note.mjs';
import { readConversation } from '../server/sources/claude-conversation.mjs';
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

// Automatic, for the tests about the person's own permission mode and cards: a new chat runs Autonomous otherwise.
const AUTO = { kind: 'talk' }; // the page chat: the brain's Conversa (id146)
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

test('buildArgs allows only the tools it is given, by name, and none by default', () => {
  assert.ok(!buildArgs({ mcpConfigPath: '/tmp/x.json' }).includes('--allowedTools'));
  const args = buildArgs({ mcpConfigPath: '/tmp/x.json', allowedTools: ['mcp__sessionmap__list_chats', 'mcp__sessionmap__start_chat'] });
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__sessionmap__list_chats,mcp__sessionmap__start_chat');
  assert.ok(!args.join(' ').match(/bypass|dangerously/i));
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

// or23: the board is updated once, when the request is done, not after every step (each run opens a skill).
test('firstPrompt asks for the board once at the end, and the person\'s words still come out of old prompts', () => {
  const text = firstPrompt({ sections: ['Point'], text: 'Add the error message', board: true });
  assert.match(text, /When the request is done, run \/session-map:board\./);
  assert.doesNotMatch(text, /finish a step/);
  assert.equal(personsWords(text), 'Add the error message');
  assert.equal(personsWords('Context from session-map (this is all you need from earlier work):\n\nPoint\n\nWhen you finish a step, run /session-map:board.\n\nOld words'), 'Old words');
  assert.equal(ownWords(text), 'Add the error message');
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
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', run: AUTO }, state);
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
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', mode: 'default', run: AUTO }, state);
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
      const talk = shown.body.items.filter((i) => i.type === 'user' || i.type === 'assistant');
      assert.deepEqual(talk.map((i) => i.type), ['user', 'assistant']);
      assert.equal(talk[0].text, 'Add the error message');
      assert.match(talk[1].text, /^echo: Context from session-map/);
      assert.equal(later.history('44444444-4444-4444-8444-444444444444').status, 404, 'only conversations born in the page');

      const res = await later.start({ projectId: 'demo-abc123', sessionId, text: 'And the retry' }, state);
      assert.equal(res.status, 200, 'resumable although the state no longer lists it');
      const r = recorder();
      later.subscribe(res.body.chatKey, r.sink);
      await nthTurnEnd(r, 1);
      assert.equal(r.events.find((e) => e.type === 'session').data.sessionId, sessionId);
      assert.deepEqual(r.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['And the retry']);
      assert.ok(r.events.some((e) => e.type === 'text' && e.data.text === 'echo: And the retry'));
      assert.equal(later.history(sessionId).body.items.filter((i) => i.type === 'user' || i.type === 'assistant').length, 2, 'a live chat\'s own turns come from its events, not twice');
      assert.equal((await later.start({ projectId: 'other', sessionId, text: 'x' }, state)).status, 404);
    } finally {
      await later.close();
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

test('the memory a conversation carries rides on the run event after a turn and on its history (pc37)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
    const root = mkdtempSync(join(tmpdir(), 'sm-chat-root-'));
    const state = makeState(root);
    const hub = createChatHub({ smDir, dir, bin: FAKE, env: { ...env, FAKE_USAGE: '1' } });
    try {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      assert.deepEqual(r.events.filter((e) => e.type === 'run').at(-1).data.context, { tokens: 30100, max: 200000 }, 'input + cache written + cache read of the last reply');
      assert.deepEqual(hub.history(sessionId).body.context, { tokens: 30100, max: 200000 });
    } finally {
      await hub.close();
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

test('a reply that carries no usage gives no memory number: the run event says null and the history omits it (pc37)', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'first' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(r.events.filter((e) => e.type === 'run').at(-1).data.context, null);
  });
});

test('a page that reconnects replays each finished text once, without the pieces it streamed in (pc13)', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'first' }, state);
    const live = recorder();
    hub.subscribe(body.chatKey, live.sink);
    await nthTurnEnd(live, 1);
    assert.ok(live.count((e) => e.type === 'text' && e.data.partial) > 0, 'a page watching live still gets the pieces');
    const later = recorder();
    hub.subscribe(body.chatKey, later.sink);
    assert.equal(later.count((e) => e.type === 'text' && e.data.partial), 0);
    assert.deepEqual(later.events.filter((e) => e.type === 'text').map((e) => e.data.text), ['echo: first']);
    assert.ok(later.events.some((e) => e.type === 'thinking'), 'only the pieces go');
  });
});

test('a long chat whose first turns fell out of the replay still shows them, from the transcript, once (pc13)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env, eventsMax: 8 }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      for (const [n, text] of [[2, 'second'], [3, 'third']]) {
        // A person's next message never leaves in the millisecond the reply was written.
        await pause(20);
        assert.equal(hub.send(res.body.chatKey, { text }).status, 200);
        await nthTurnEnd(r, n);
      }
      const shown = hub.history(sessionId, state).body;
      assert.deepEqual(shown.items.filter((i) => i.type === 'user').map((i) => i.text), ['Add the error message', 'second']);
      assert.equal(shown.chatKey, res.body.chatKey);
      const replay = recorder();
      hub.subscribe(res.body.chatKey, replay.sink, shown.fromEventId);
      assert.deepEqual(replay.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['third'], 'the turns of the history are not replayed');
      assert.deepEqual(replay.events.filter((e) => e.type === 'text').map((e) => e.data.text), ['echo: third']);
    });
  });
});

test('a reply streaming past the limit pushes out its own pieces first, never the message it answers (pc13)', async () => {
  await withHub({ eventsMax: 8 }, async ({ hub, state }) => {
    const { body } = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'first' }, state);
    const r = recorder();
    hub.subscribe(body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    hub.send(body.chatKey, { text: 'SLOW' });
    await r.until(() => r.count((e) => e.type === 'text' && e.data.partial) > 20);
    const later = recorder();
    hub.subscribe(body.chatKey, later.sink);
    assert.ok(later.events.some((e) => e.type === 'user' && e.data.text === 'SLOW'));
    hub.stop(body.chatKey);
    await nthTurnEnd(r, 2);
  });
});

test('a turn longer than the events it keeps: its prompt and the reply before it come from the transcript (pc13)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env, eventsMax: 3 }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      await pause(20);
      hub.send(res.body.chatKey, { text: 'second' });
      await nthTurnEnd(r, 2);
      const shown = hub.history(sessionId, state).body;
      const replay = recorder();
      hub.subscribe(res.body.chatKey, replay.sink, shown.fromEventId);
      assert.deepEqual(shown.items.filter((i) => i.type === 'user').map((i) => i.text), ['Add the error message', 'second'], 'the prompt whose event went is not lost');
      const replies = [...shown.items.filter((i) => i.type === 'assistant').map((i) => i.text), ...replay.events.filter((e) => e.type === 'text').map((e) => e.data.text)];
      assert.ok(replies.some((t) => t.startsWith('echo: Context')) && replies.includes('echo: second'), 'every reply shows');
      assert.equal(shown.running, false);
    });
  });
});

test('the history ends at the message the events start with, whatever time the reply before it carries (pc13)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env, eventsMax: 8 }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      for (const [n, text] of [[2, 'second'], [3, 'third']]) {
        await pause(20);
        hub.send(res.body.chatKey, { text });
        await nthTurnEnd(r, n);
      }
      // A reply written in the millisecond the next message left (an automatic answer), or later still: its time says
      // nothing about which turn it belongs to, its place in the transcript does.
      const file = join(dir, 'projects', 'demo', `${sessionId}.jsonl`);
      const late = new Date(Date.now() + 60_000).toISOString();
      const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      writeFileSync(file, `${lines.map((l, i) => JSON.stringify(i === 1 ? { ...l, timestamp: late } : l)).join('\n')}\n`);
      const shown = hub.history(sessionId, state).body;
      assert.deepEqual(shown.items.filter((i) => i.type === 'assistant').map((i) => i.text.slice(0, 13)), ['echo: Context', 'echo: second']);
      assert.equal(shown.messages, undefined, 'the page reads items only');
    });
  });
});

test('a chat whose events all fit shows only the turns before it from the transcript, and replays the rest (pc13)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env }, async ({ hub, state }) => {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Add the error message' }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      const shown = hub.history(sessionId, state).body;
      assert.deepEqual(shown.items, []);
      assert.equal(shown.fromEventId, 0);
    });
  });
});

test('"always in this conversation" survives the process: a resumed chat does not ask again', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
    const state = makeState(mkdtempSync(join(tmpdir(), 'sm-chat-root-')));
    let sessionId;
    const first = createChatHub({ smDir, dir, bin: FAKE, env });
    try {
      const res = await first.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:Write', run: AUTO }, state);
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
    // The pieces streamed in went away once the whole text arrived (pc13).
    assert.deepEqual(tail.events.map((e) => e.id), all.events.slice(1).filter((e) => !(e.type === 'text' && e.data.partial)).map((e) => e.id));
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
    // The cursors of a page of history (pc15), on a conversation of the list with three turns.
    const VS = '99999999-9999-4999-8999-999999999999';
    mkdirSync(join(root, 'projects', 'demo'), { recursive: true });
    writeFileSync(join(root, 'projects', 'demo', `${VS}.jsonl`), `${[0, 1, 2].flatMap((n) => [
      { type: 'user', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: `ask ${n}` } },
      { type: 'assistant', timestamp: '2026-10-01T10:00:01.000Z', message: { id: `m${n}`, role: 'assistant', content: [{ type: 'text', text: `reply ${n}` }] } },
    ]).map((l) => JSON.stringify(l)).join('\n')}\n`);
    state.projects[0].conversations = [{ sessionId: VS, title: 'Listed', origin: 'vscode', partId: null, chattable: false, live: true }];
    state[INTERNALS].chats.set(VS, { projectId: 'demo-abc123', root, cwd: root, pid: null });
    const page = (query) => call('GET', `/api/chat/history/${VS}${query}`, { headers: { cookie: `sm_token=${token}` } }).then((r) => JSON.parse(r.text));
    assert.deepEqual((await page('?before=2')).items.map((i) => i.text), ['ask 0', 'reply 0'], 'the page before the second turn');
    assert.deepEqual((await page('?from=6')).items.map((i) => i.text), ['ask 2', 'reply 2'], 'again from the last turn the page has');
    assert.equal((await page('?before=x')).items.length, 6, 'a cursor that is not a number is left out');
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
    // The same rule as the project chats: archived, it leaves every list the sheet shows, as it leaves the map.
    state.projects[0].conversations = [{ sessionId: Object.keys(JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8')))[0], archived: true }];
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth', code: 'au07' }, state).body.chats.length, 0, 'archived, it leaves its item');
    assert.equal(hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats.length, 0, 'and its part');
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

test('a project chat opens at the root with the compact project summary; many are listed by their kind and each resumes', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const log = join(dir, 'fake.json');
    const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
    const root = mkdtempSync(join(tmpdir(), 'sm-chat-root-'));
    const branch = mkdtempSync(join(tmpdir(), 'sm-chat-branch-'));
    const state = withItem(makeState(root), root);
    state.projects[0].workCells[0].path = branch;
    const hubs = [];
    const talk = async (body) => {
      const hub = hubs.at(-1);
      const res = await hub.start({ projectId: 'demo-abc123', ...body }, state);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      return { r, sessionId, call: JSON.parse(readFileSync(log, 'utf8')) };
    };
    const sameDir = (a, b) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
    try {
      hubs.push(createChatHub({ smDir, dir, bin: FAKE, env: { ...env, FAKE_LOG: log } }));
      const first = await talk({ node: { kind: 'project' }, frontId: 'feature/login', text: 'What is left before launch?' });
      const prompt = first.r.events.find((e) => e.type === 'text' && !e.data.partial).data.text;
      for (const piece of ['Project: demo', 'Auth: Sign in and sessions. (1 open)', "What's missing", 'flow diagram', 'What is left before launch?']) assert.ok(prompt.includes(piece), piece);
      assert.ok(sameDir(first.call.cwd, root), 'the root folder, whatever branch is picked');
      assert.equal(first.r.events.find((e) => e.type === 'user').data.text, 'What is left before launch?', 'the page shows only the person\'s words');
      const saved = JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8'))[first.sessionId];
      assert.deepEqual([saved.node, saved.partId, saved.title], [{ kind: 'project' }, null, 'What is left before launch?']);

      const second = await talk({ node: { kind: 'project' }, text: 'Plan the next release' });
      const listed = hubs[0].list({ projectId: 'demo-abc123', kind: 'project' }, state).body.chats;
      assert.deepEqual(listed.map((c) => c.sessionId).sort(), [first.sessionId, second.sessionId].sort(), 'many project chats, each its own conversation');
      assert.ok(listed.every((c) => c.costUSD > 0), 'each with what it cost so far');
      state.projects[0].conversations = [{ sessionId: second.sessionId, archived: true }];
      assert.deepEqual(hubs[0].list({ projectId: 'demo-abc123', kind: 'project' }, state).body.chats.map((c) => c.sessionId), [first.sessionId], 'an archived one leaves the panel, as it leaves the list');
      delete state.projects[0].conversations;
      assert.equal(hubs[0].list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats.length, 0, 'not a chat of any part');

      // Closed and reopened later (another server run): it resumes with its history, without the summary again.
      await hubs[0].close();
      hubs.push(createChatHub({ smDir, dir, bin: FAKE, env: { ...env, FAKE_LOG: log } }));
      assert.equal(hubs[1].history(first.sessionId, state).body.items[0].text, 'What is left before launch?');
      const again = await talk({ sessionId: first.sessionId, text: 'And the docs?' });
      assert.equal(again.sessionId, first.sessionId, 'the same conversation');
      assert.equal(again.call.argv[again.call.argv.indexOf('--resume') + 1], first.sessionId);
      assert.ok(sameDir(again.call.cwd, root));
      assert.ok(again.r.events.some((e) => e.type === 'text' && e.data.text === 'echo: And the docs?'), 'no summary on a resumed chat');
    } finally {
      for (const hub of hubs) await hub.close();
      for (const d of [root, smDir, branch]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
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
      assert.deepEqual(shown.body.items.map((i) => [i.type, i.text]), [['user', 'Rename the cart store'], ['assistant', 'Done.']]);
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

// ---- how a page conversation runs (id146): the brain's talk, and the orchestrator's Autonomous (pc16) ----

const argvOf = (log) => JSON.parse(readFileSync(log, 'utf8')).argv;
const flagOf = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const fakeLog = () => join(mkdtempSync(join(tmpdir(), 'sm-chat-log-')), 'fake.json');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a new conversation runs the brain\'s talk: the policy\'s chat level with the stance alone, weighed for its phase', async () => {
  const log = fakeLog();
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state, smDir }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'corrige o bug do pagamento' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const argv = argvOf(log);
    assert.equal(flagOf(argv, '--model'), 'opus');
    assert.equal(flagOf(argv, '--effort'), 'high');
    assert.equal(flagOf(argv, '--append-system-prompt'), `${STANCE}\n${TAG_LINE}`, 'the stance and how to start an agent, never a conductor prompt');
    const runs = r.events.filter((e) => e.type === 'run');
    assert.deepEqual(runs[0].data.run, { kind: 'talk' });
    assert.equal(runs[0].data.model, 'claude-opus-5-5', 'the model claude reported, not the alias');
    assert.equal(runs[0].data.effort, 'high');
    assert.equal(runs[0].data.brain.phase, 'build', 'the entry brain weighed the turn');
    assert.equal(r.events.find((e) => e.type === 'turn-end').data.costUSD, 0.001);
    assert.equal(runs.at(-1).data.costUSD, 0.001);
    const sessionId = r.events.find((e) => e.type === 'session').data.sessionId;
    const saved = JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8'))[sessionId];
    assert.deepEqual(saved.run, { kind: 'talk' });
  });
});

test('the ways the brain replaced are refused: nothing outside talk and the orchestrator\'s Autonomous reaches claude', async () => {
  await withHub({}, async ({ hub, state }) => {
    for (const run of [{ kind: 'fixed', model: 'haiku', effort: 'low' }, { kind: 'ultracode' }, { kind: 'auto', selfReinforce: false }, { kind: 'maestro' }, { kind: 'settings' }, { kind: 'fixed', model: 'opus', effort: '--x' }]) {
      const bad = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', run }, state);
      assert.deepEqual([bad.status, bad.body.error], [400, 'bad-run'], JSON.stringify(run));
    }
  });
});

test('a conversation the page did not start resumes as talk too, and the cost adds to what it had already spent', async () => {
  const log = fakeLog();
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state }) => {
    state.projects[0].conversations = [{ sessionId: CLOSED, title: 'old', chattable: true, live: false, costUSD: 0.5 }];
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'go on' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.equal(flagOf(argvOf(log), '--model'), 'opus', 'the brain\'s level, never no flags');
    assert.deepEqual(r.events.find((e) => e.type === 'run').data.run, { kind: 'talk' });
    assert.ok(r.events.some((e) => e.type === 'text' && e.data.text === 'echo: go on'), 'no note: nothing changed');
    assert.equal(r.events.find((e) => e.type === 'turn-end').data.costUSD, 0.501);
  });
});

test('a legacy saved way (from before the brain) resumes as talk', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [CLOSED]: { projectId: 'demo-abc123', cwd: state.projects[0].root, run: { kind: 'fixed', model: 'haiku', effort: 'low' }, title: 'old' } }));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'go on' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.deepEqual(r.events.find((e) => e.type === 'run').data.run, { kind: 'talk' });
  });
});

test('Autonomous asks before reinforcing: the run event carries the reason and estimate, and past the limit nothing is sent for the person', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:4.5', run: { kind: 'autonomous' } }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const last = r.events.filter((e) => e.type === 'run').at(-1).data;
    assert.deepEqual([last.level, last.why, last.estimateUSD], ['ask-reinforce', 'touches sign in', 4.5]);
    await pause(150);
    assert.equal(r.count((e) => e.type === 'user'), 1);
  });
});

test('Autonomous answers the ask itself while the monthly limit holds, counts the reinforced cost, and asks again past it', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:0.5', run: { kind: 'autonomous' } }, state);
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
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Change the sign in RUN:ask-reinforce:0.1', run: { kind: 'autonomous' } }, state);
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

test('the list and the history tell the page how much reinforcing is left this month', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await withHub({ dir, env }, async ({ hub, state, smDir }) => {
      writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 20 } }));
      const listed = hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body;
      assert.deepEqual(listed.reinforce, { limitUSD: 20, spentUSD: 0 });
    });
  });
});

// ---- the Autonomous way (pc16) ----

const toolResult = (r) => r.events.find((e) => e.type === 'tool' && e.data.phase === 'result').data;

test('the talk chat runs in the mode Configurações picked, kept per conversation, never forced to auto', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    settingsIn(dir, 'default');
    const log = fakeLog();
    await withHub({ dir, env: { ...env, FAKE_LOG: log } }, async ({ hub, state, smDir }) => {
      writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 20 } }));
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'corrige o bug do pagamento', mode: 'acceptEdits' }, state);
      assert.equal(res.status, 200);
      assert.equal(res.body.mode, 'acceptEdits');
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
      await nthTurnEnd(r, 1);
      const argv = argvOf(log);
      assert.deepEqual([flagOf(argv, '--permission-mode'), flagOf(argv, '--model'), flagOf(argv, '--effort')], ['acceptEdits', 'opus', 'high']);
      assert.equal(flagOf(argv, '--append-system-prompt'), `${STANCE}\n${TAG_LINE}`);
      assert.ok(!argv.includes('bypassPermissions'));
      assert.deepEqual(r.events.find((e) => e.type === 'run').data.run, { kind: 'talk' });
      const saved = JSON.parse(readFileSync(join(smDir, 'page-chats.json'), 'utf8'))[sessionId];
      assert.deepEqual([saved.run, saved.mode], [{ kind: 'talk' }, 'acceptEdits']);

      assert.equal(hub.mode(res.body.chatKey, { mode: 'default' }).body.mode, 'default', 'the chat\'s own mode follows Configurações');
    });
  });
});

test('Autonomous: a permission that reaches session-map is denied at once and shown as left for the person; no card, no wait, no alert', async () => {
  const alerts = [];
  await withHub({ onAlert: (a) => alerts.push(a) }, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:Write', run: { kind: 'autonomous' } }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 1);
    const perms = r.events.filter((e) => e.type === 'permission');
    assert.deepEqual(perms.map((e) => e.data.state), ['deferred']);
    assert.equal(perms[0].data.toolName, 'Write');
    assert.match(perms[0].data.input, /x\.txt/);
    const result = toolResult(r);
    assert.equal(result.isError, true);
    assert.match(result.text, /Autonomous way: the person is not asked mid-task\. Do not retry/);
    assert.match(result.text, /Left for you/);
    assert.ok(!alerts.some((a) => a.reason === 'permission'));
  });
});

test('Autonomous: AskUserQuestion is denied with "decide yourself", and the page shows no permission for it', async () => {
  await withHub({}, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:AskUserQuestion', run: { kind: 'autonomous' } }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.match(toolResult(r).text, /Autonomous way: decide yourself, take the option you would recommend, note it under 'Decisions I took' and go on\./);
    assert.equal(r.count((e) => e.type === 'permission'), 0);
  });
});

test('a force push is denied in every way of running, even with the shell allowed for the whole conversation', async () => {
  await withHub({ env: { ...process.env, FAKE_PERM_COMMAND: 'git push --force-with-lease origin main' } }, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [CLOSED]: { projectId: 'demo-abc123', cwd: state.projects[0].root, always: ['Bash'] } }));
    const runs = [{ kind: 'autonomous' }, { kind: 'talk' }];
    for (const run of runs) {
      const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:Bash', run }, state);
      const r = recorder();
      hub.subscribe(res.body.chatKey, r.sink);
      const end = await nthTurnEnd(r, 1);
      assert.equal(end.data.denials, 1, run.kind);
      assert.match(toolResult(r).text, /never lets a force push through/, run.kind);
      assert.equal(r.count((e) => e.type === 'permission' && e.data.state === 'asked'), 0, run.kind);
      // Six chats at once is the cap: each one is closed before the next.
      assert.equal(await hub.closeIdle(r.events.find((e) => e.type === 'session').data.sessionId), true);
    }
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Bash' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.match(toolResult(r).text, /never lets a force push through/, '"always" does not cover a force push');
  });
});

test('the talk chat still shows the Allow / Deny card for a step outside its mode', async () => {
  await withHub({ env: { ...process.env, FAKE_PERM_COMMAND: 'git push origin main' } }, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'PERM:Bash', run: AUTO }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const asked = await r.until((e) => e.type === 'permission' && e.data.state === 'asked');
    hub.permission(res.body.chatKey, { requestId: asked.data.requestId, allow: true });
    assert.equal((await nthTurnEnd(r, 1)).data.denials, 0);
  });
});

test('Autonomous: a snapshot when each turn starts, and before a destructive step the conversation allowed runs', async () => {
  const taken = [];
  const snapshot = async (cwd) => { taken.push(cwd); return { ref: 'refs/session-map/safety/x', commit: 'abc' }; };
  await withHub({ snapshot, env: { ...process.env, FAKE_PERM_COMMAND: 'rm -rf build' } }, async ({ hub, state, smDir, root }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [CLOSED]: { projectId: 'demo-abc123', cwd: root, run: { kind: 'autonomous' }, always: ['Bash'] } }));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Bash' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const end = await nthTurnEnd(r, 1);
    assert.equal(end.data.denials, 0, 'allowed for the whole conversation by the person');
    assert.deepEqual(taken, [root, root], 'the turn start, then the delete');
    hub.send(res.body.chatKey, { text: 'next' });
    await nthTurnEnd(r, 2);
    assert.equal(taken.length, 3);
  });
  const others = [];
  await withHub({ snapshot: async (cwd) => { others.push(cwd); return null; } }, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi', run: AUTO }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.deepEqual(others, [], 'only the Autonomous way snapshots');
  });
});

test('Autonomous: a snapshot that hangs before a destructive step is given up after a short wait, inside the permission tool\'s 30 s', async () => {
  const hang = () => new Promise(() => {});
  await withHub({ snapshot: hang, askSnapshotMs: 100, env: { ...process.env, FAKE_PERM_COMMAND: 'rm -rf build' } }, async ({ hub, state, smDir, root }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [CLOSED]: { projectId: 'demo-abc123', cwd: root, run: { kind: 'autonomous' }, always: ['Bash'] } }));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'PERM:Bash' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    assert.equal((await r.until((e) => e.type === 'turn-end', 3000)).data.denials, 0, 'the step the person allowed still runs');
  });
});

test('Autonomous reinforces on its own while the monthly limit holds, and past it waits for the person with a budget alert', async () => {
  const alerts = [];
  await withHub({ onAlert: (a) => alerts.push(a) }, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 1 } }));
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Rebuild the sign in RUN:ask-reinforce:0.5', run: { kind: 'autonomous' } }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await nthTurnEnd(r, 2);
    assert.equal(r.events.filter((e) => e.type === 'user')[1].data.auto, 'reinforce');
    assert.ok(!alerts.some((a) => a.kind === 'waiting'));

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { reinforcedMonthlyUSD: 0.0001 } }));
    hub.send(res.body.chatKey, { text: 'Next one RUN:ask-reinforce:0.5' });
    await nthTurnEnd(r, 3);
    await pause(150);
    assert.equal(turnEnds(r), 3, 'past the limit it waits');
    assert.deepEqual(alerts.filter((a) => a.kind === 'waiting').map((a) => a.reason), ['budget']);
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

      // The specialist's role line opens the brief (id148, or55): the page gets the role as words, never the raw line.
      writeFileSync(join(folder, VS, 'subagents', 'agent-xyz1.jsonl'), [
        { type: 'user', isSidechain: true, timestamp: at(1), message: { role: 'user', content: 'session-map-role: coder — tools: Edit, Write; method: 1) read the tests; exit: code with its tests passing.\nScan it' } },
      ].map((l) => JSON.stringify(l)).join('\n'));
      const coder = hub.helper(VS, 'xyz1', state);
      assert.equal(coder.status, 200);
      assert.deepEqual(coder.body.role, { id: 'coder', label: 'Developer', labelPt: 'Desenvolvedor' });
      assert.deepEqual(coder.body.items.map((i) => [i.type, i.text]), [['user', 'Scan it']], 'the injected line never reaches the page as text');
    });
  });
});

test('history shows the person\'s words without changing the read it shares with the next ask', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const VS = '88888888-8888-4888-8888-888888888888';
    const folder = join(dir, 'projects', 'demo');
    mkdirSync(folder, { recursive: true });
    const sent = firstPrompt({ sections: ['Part of the architecture: Auth (Sign in.)'], text: 'Look', board: true });
    const file = join(folder, `${VS}.jsonl`);
    writeFileSync(file, `${JSON.stringify({ type: 'user', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: sent } })}\n`);
    await withHub({ dir, env }, async ({ hub, state, root }) => {
      state.projects[0].conversations = [{ sessionId: VS, title: 'Look', origin: 'vscode', partId: null, chattable: false, live: true, status: 'busy', costUSD: 0 }];
      state[INTERNALS].chats.set(VS, { projectId: 'demo-abc123', root, cwd: root, pid: null });
      assert.equal(hub.history(VS, state).body.items[0].text, 'Look');
      assert.equal(readConversation(file, { cwd: root }).items[0].text, sent, 'the shared read keeps the prompt as written');
      assert.equal(hub.history(VS, state).body.items[0].text, 'Look');
    });
  });
});

test('a message can carry pasted images, which reach claude as image blocks (mm22)', async () => {
  await withHub({}, async ({ hub, state }) => {
    const png = { media: 'image/png', data: 'iVBORw0KGgo=' };
    assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: [{ media: 'text/html', data: 'PGI+' }] }, state)).body.error, 'bad-images');
    assert.equal((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: Array(11).fill(png) }, state)).body.error, 'bad-images', 'ten at most');
    assert.notEqual((await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'Look', images: Array(10).fill(png) }, state)).body.error, 'bad-images', 'ten pass');
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

// ---- pc12: a chat that went quiet is not closed while its background helpers still write ----

// The folder claude keeps a conversation's workflow journals and agent transcripts in.
const helperFile = (dir, sessionId) => join(dir, 'projects', 'demo', sessionId, 'subagents', 'workflow', 'journal.jsonl');
const touchHelper = (dir, sessionId) => {
  const file = helperFile(dir, sessionId);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${Date.now()}\n`);
};
async function idleChat(dir, env, fn, idleMs = 400, hubOpts = {}) {
  await withHub({ dir, idleMs, env, ...hubOpts }, async ({ hub, state }) => {
    const res = await hub.start({ projectId: 'demo-abc123', partId: 'auth', text: 'hi' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    const sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
    await nthTurnEnd(r, 1);
    await fn({ r, sessionId, ended: () => r.until((e) => e.type === 'session' && e.data.state === 'ended') });
  });
}

test('an idle chat with no helper activity still closes after idleMs', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, ended }) => {
      const since = Date.now();
      await ended();
      assert.ok(Date.now() - since >= 300, 'not before the idle time');
      assert.equal(r.count((e) => e.type === 'error'), 0);
    });
  });
});

test('an idle chat whose helpers keep writing is not closed, and is checked again', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, sessionId }) => {
      const until = Date.now() + 1800;
      while (Date.now() < until) { touchHelper(dir, sessionId); await pause(100); }
      assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0, 'about 4 idle times went by with fresh helper files');
    });
  });
});

test('once the helpers stop writing, the idle chat closes', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, sessionId, ended }) => {
      const until = Date.now() + 900;
      let lastWrite = 0;
      while (Date.now() < until) { touchHelper(dir, sessionId); lastWrite = Date.now(); await pause(100); }
      assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0);
      await ended();
      assert.ok(Date.now() - lastWrite >= 330, 'it waited for the helpers to be quiet for (nearly) a whole idle time of 400 ms');
    });
  });
});

test('a helper file buried deeper than the walk goes does not keep an idle chat open forever', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, sessionId }) => {
      const deep = join(dir, 'projects', 'demo', sessionId, 'subagents', ...Array.from({ length: 12 }, (_, i) => `d${i}`));
      mkdirSync(deep, { recursive: true });
      const until = Date.now() + 1200;
      while (Date.now() < until) { writeFileSync(join(deep, 'journal.jsonl'), `${Date.now()}\n`); await pause(100); }
      assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 1, 'closed although something kept writing below the depth the walk looks at');
    }, 600);
  });
});

// A walk cut short by the entry cap has not seen every helper file, so it is no proof that they are quiet.
const staleHelpers = (dir, sessionId, count) => {
  const folder = join(dir, 'projects', 'demo', sessionId, 'subagents', 'agents');
  mkdirSync(folder, { recursive: true });
  const old = new Date(Date.now() - 3600_000);
  for (let i = 0; i < count; i++) { const f = join(folder, `a${String(i).padStart(3, '0')}.jsonl`); writeFileSync(f, 'old\n'); utimesSync(f, old, old); }
  return folder;
};

test('a fresh helper file listed after the walk cap keeps the idle chat open', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, sessionId }) => {
      const folder = staleHelpers(dir, sessionId, 12);
      const until = Date.now() + 700;
      while (Date.now() < until) { writeFileSync(join(folder, 'z-fresh.jsonl'), `${Date.now()}\n`); await pause(100); }
      assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0, 'closed at the first idle time although the cut walk never reached the fresh file');
    }, 400, { helperWalkMax: 5 });
  });
});

test('a walk cut short postpones the close only a few times; it still closes', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    await idleChat(dir, env, async ({ r, sessionId, ended }) => {
      staleHelpers(dir, sessionId, 12);
      await pause(550);
      assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0, 'the first idle time ran out, the cut walk proves nothing');
      await ended();
    }, 400, { helperWalkMax: 5 });
  });
});

// ---- Continue on a cut-off conversation (mm43): one process per conversation, whatever the clicks ----------------------

test('two starts of the same conversation in a row spawn one claude; the second is told it is busy', async () => {
  let spawns = 0;
  const spawner = (...args) => { spawns++; return spawn(...args); };
  await withHub({ spawner }, async ({ hub, state }) => {
    const [a, b] = await Promise.all([
      hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state),
      hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state),
    ]);
    assert.equal(a.status, 200);
    assert.deepEqual([b.status, b.body.error], [409, 'busy']);
    assert.equal(spawns, 1);
    const r = recorder();
    hub.subscribe(a.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
  });
});

test('a second Continue of a cut-off conversation after its resumed turn ended is told it is busy, and starts no turn', async () => {
  await withHub({}, async ({ hub, state }) => {
    const a = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue', cut: true }, state);
    assert.equal(a.status, 200);
    const r = recorder();
    hub.subscribe(a.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    const b = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue', cut: true }, state);
    assert.deepEqual([b.status, b.body.error], [409, 'busy']);
    await pause(100);
    assert.equal(r.count((e) => e.type === 'user'), 1, 'no second turn');
  });
});

test('a Continue of a page conversation whose turn is no longer running is told it is busy and spawns nothing', async () => {
  let spawns = 0;
  const spawner = (...args) => { spawns++; return spawn(...args); };
  await withHub({ spawner }, async ({ hub, state, smDir, root }) => {
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [CLOSED]: { projectId: 'demo-abc123', cwd: root, running: false } }));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue', cut: true }, state);
    assert.deepEqual([res.status, res.body.error], [409, 'busy']);
    assert.equal(spawns, 0);
  });
});

test('a conversation whose own claude is still alive (its session file names a live pid) is not resumed', async () => {
  let spawns = 0;
  const spawner = (...args) => { spawns++; return spawn(...args); };
  await withHub({ spawner }, async ({ hub, state, root }) => {
    mkdirSync(join(root, 'sessions'), { recursive: true });
    writeFileSync(join(root, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: CLOSED, cwd: root, status: 'busy', startedAt: Date.now() }));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state);
    assert.deepEqual([res.status, res.body.error], [409, 'live-chat']);
    assert.equal(spawns, 0);
  });
});

test('a conversation removed from session-map cannot be resumed', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([CLOSED]));
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state);
    assert.deepEqual([res.status, res.body.error], [404, 'unknown-session']);
  });
});

test('drivingIds holds a resumed conversation while its claude runs and lets it go once it exits', async () => {
  await withHub({ idleMs: 200 }, async ({ hub, state }) => {
    assert.deepEqual(hub.drivingIds(), new Set());
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state);
    assert.ok(hub.drivingIds().has(CLOSED));
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((e) => e.type === 'session' && e.data.state === 'ended');
    assert.equal(hub.drivingIds().has(CLOSED), false);
  });
});

test('the list of a part and the cut-off alerts leave out a conversation removed from session-map', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-chat-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-chat-sm-'));
  const state = makeState(root);
  const first = createChatHub({ smDir, dir: root, bin: FAKE });
  let sessionId;
  try {
    const res = await first.start({ projectId: 'demo-abc123', partId: 'auth', text: 'SLOW' }, state);
    const r = recorder();
    first.subscribe(res.body.chatKey, r.sink);
    sessionId = (await r.until((e) => e.type === 'session')).data.sessionId;
    await r.until((e) => e.type === 'text' && e.data.partial);
  } finally { await first.close(); }
  const later = createChatHub({ smDir, dir: root, bin: FAKE });
  try {
    assert.equal(later.interrupted(state).length, 1);
    assert.equal(later.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats.length, 1);
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([sessionId]));
    assert.deepEqual(later.interrupted(state), []);
    assert.deepEqual(later.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats, []);
  } finally {
    await later.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('history opens on the newest turns, gives older ones by cursor, and a mirror gets only what is new (pc15)', async () => {
  await withClaudeDir(async ({ dir, env }) => {
    const VS = '99999999-9999-4999-8999-999999999999';
    const folder = join(dir, 'projects', 'demo');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${VS}.jsonl`);
    const turn = (n) => [
      { type: 'user', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: `ask ${n}` } },
      { type: 'assistant', timestamp: '2026-10-01T10:00:01.000Z', message: { id: `m${n}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `reply ${n}` }] } },
    ];
    const lines = (from, to) => Array.from({ length: to - from }, (_, k) => turn(from + k)).flat().map((l) => JSON.stringify(l)).join('\n');
    writeFileSync(file, `${lines(0, 150)}\n`);
    await withHub({ dir, env }, async ({ hub, state, root }) => {
      state.projects[0].conversations = [{ sessionId: VS, title: 'Long', origin: 'vscode', partId: null, chattable: false, live: true, status: 'busy', costUSD: 0 }];
      state[INTERNALS].chats.set(VS, { projectId: 'demo-abc123', root, cwd: root, pid: null });
      const first = hub.history(VS, state).body;
      assert.equal(first.total, 300);
      assert.ok(first.start > 0 && first.items.length < 300, 'only the newest part on open');
      assert.equal(first.items.length, 300 - first.start);
      assert.equal(first.items[0].type, 'user', 'it starts where a turn starts');
      assert.equal(first.items.at(-1).text, 'reply 149');
      assert.equal(first.messages, undefined, 'no second read of the whole transcript');

      const older = hub.history(VS, state, { before: first.start }).body;
      assert.equal(older.start + older.items.length, first.start, 'the older page ends where the open one starts');
      assert.equal(older.items[0].type, 'user');
      assert.equal(first.items[0].text, `ask ${first.start / 2}`);
      assert.equal(older.items.at(-1).text, `reply ${first.start / 2 - 1}`);

      writeFileSync(file, `${lines(0, 151)}\n`);
      const fresh = hub.history(VS, state, { since: first.version, from: first.total }).body;
      assert.equal(fresh.start, 298, 'again from the start of the last turn the page has, which may still grow');
      assert.deepEqual(fresh.items.map((i) => i.text), ['ask 149', 'reply 149', 'ask 150', 'reply 150']);
      assert.equal(fresh.total, 302);
      assert.deepEqual(hub.history(VS, state, { since: fresh.version, from: fresh.total }).body, { ok: true, same: true, version: fresh.version });
    });
  });
});

// ---- mm43 review: the hub's "interrupted" agrees with collect, a removed conversation is read nowhere, an idle one closes ----

const PAGE_ID = '55555555-5555-4555-8555-555555555555';
// A page conversation page-chats.json still calls running, and its transcript under <dir>/projects/demo.
function cutPage(dir, smDir, root, { pageAt, lines }) {
  writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [PAGE_ID]: { projectId: 'demo-abc123', partId: 'auth', root, cwd: root, title: 'cut', running: true, updatedAt: pageAt } }));
  mkdirSync(join(dir, 'projects', 'demo'), { recursive: true });
  writeFileSync(join(dir, 'projects', 'demo', `${PAGE_ID}.jsonl`), lines.map((l) => JSON.stringify({ sessionId: PAGE_ID, cwd: root, ...l })).join('\n') + '\n');
}
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const promptLine = (ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: 'Add the retry' } });
const answerLine = (ts) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } });
const marksOf = (hub, state) => [
  hub.interrupted(state).length > 0,
  hub.list({ projectId: 'demo-abc123', partId: 'auth' }, state).body.chats[0].interrupted,
  hub.history(PAGE_ID, state).body.interrupted,
];

test('a page conversation whose turn closed in its transcript after the page\'s last turn end is not interrupted, as collect says', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    cutPage(root, smDir, root, { pageAt: at(10), lines: [promptLine(at(9)), answerLine(at(5))] });
    assert.deepEqual(marksOf(hub, state), [false, false, false]);
  });
});

test('a page conversation whose transcript stops inside a turn, or closed before the page\'s last turn end, is still interrupted', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    cutPage(root, smDir, root, { pageAt: at(10), lines: [answerLine(at(20)), promptLine(at(5))] });
    assert.deepEqual(marksOf(hub, state), [true, true, true], 'the turn is open');
    cutPage(root, smDir, root, { pageAt: at(10), lines: [promptLine(at(30)), answerLine(at(20))] });
    assert.deepEqual(marksOf(hub, state), [true, true, true], 'it closed before the page last wrote');
  });
});

test('a conversation removed from session-map is not read by the page chat: history, its images and its helpers answer not found', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const withImage = { type: 'user', timestamp: at(9), message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: 'Look' }] } };
    cutPage(root, smDir, root, { pageAt: at(10), lines: [withImage, answerLine(at(5))] });
    const helper = join(root, 'projects', 'demo', PAGE_ID, 'subagents', 'agent-abc.jsonl');
    mkdirSync(join(helper, '..'), { recursive: true });
    writeFileSync(helper, `${JSON.stringify(answerLine(at(6)))}\n`);
    assert.equal(hub.history(PAGE_ID, state).status, 200);
    assert.ok(hub.image(PAGE_ID, 0, state));
    assert.equal(hub.helper(PAGE_ID, 'abc', state).status, 200);
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([PAGE_ID]));
    assert.deepEqual([hub.history(PAGE_ID, state).status, hub.history(PAGE_ID, state).body.error], [404, 'unknown-session']);
    assert.equal(hub.image(PAGE_ID, 0, state), null);
    assert.equal(hub.helper(PAGE_ID, 'abc', state).status, 404);
    // One of the list (VS Code, a terminal) the page did not start, too.
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([CLOSED]));
    state.projects[0].conversations = [{ sessionId: CLOSED, title: 'vs', live: false }];
    assert.equal(hub.history(CLOSED, state).status, 404);
  });
});

test('closeIdle closes the process the hub keeps idle after its turn, and refuses one whose turn runs', async () => {
  await withHub({}, async ({ hub, state }) => {
    assert.equal(await hub.closeIdle(CLOSED), true, 'nothing to close');
    const idle = await hub.start({ projectId: 'demo-abc123', sessionId: CLOSED, text: 'Continue' }, state);
    const r = recorder();
    hub.subscribe(idle.body.chatKey, r.sink);
    await nthTurnEnd(r, 1);
    assert.ok(hub.drivingIds().has(CLOSED));
    assert.equal(await hub.closeIdle(CLOSED), true);
    assert.ok(r.events.some((e) => e.type === 'session' && e.data.state === 'ended'));
    assert.equal(hub.drivingIds().has(CLOSED), false);
    assert.equal(r.count((e) => e.type === 'error'), 0);

    const busy = await hub.start({ projectId: 'demo-abc123', sessionId: MOTHER, text: 'SLOW' }, state);
    const b = recorder();
    hub.subscribe(busy.body.chatKey, b.sink);
    await b.until((e) => e.type === 'text' && e.data.partial);
    assert.equal(await hub.closeIdle(MOTHER), false);
    assert.ok(hub.drivingIds().has(MOTHER), 'its turn still runs');
  });
});
