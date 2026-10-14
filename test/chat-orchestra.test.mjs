import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { OPENING_TEXT, ORCH_PROMPT, TIDY_TEXT, createOrchestra, noteOf, outcomeOf, readTidy, setTidy, tidyDue } from '../server/chat/orchestra.mjs';
import { ORCH_TOOL_NAMES } from '../server/chat/orch-tools.mjs';
import { readQueue } from '../server/chat/priority.mjs';
import { budgetLine, runArgs } from '../server/chat/run.mjs';
import { RESUME_FILE, resumeAfterRestart } from '../server/restart.mjs';
import { conductorTail } from '../server/ai/conductor.mjs';
import { LANGS } from '../server/web/i18n.js';
import { loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';

// The orchestrator (id90 → or01, or02, or06, or17, or18): one chat per project that opens, drives and follows the
// others through the tools of its own sessionmap MCP, with the fake claude standing in for the CLI.

const PERMISSION_MCP = fileURLToPath(new URL('../server/chat/permission-mcp.mjs', import.meta.url));

// The permission MCP as claude starts it: one JSON-RPC line per message both ways.
function mcpClient(env) {
  const child = spawn(process.execPath, [PERMISSION_MCP], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  let next = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { rpc, close: () => child.kill() };
}

test('the sessionmap MCP lists the orchestration tools only to the orchestrator and hands a call to the relay with its secret', async () => {
  const seen = [];
  const relay = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, secret: req.headers['x-session-map-secret'], body: JSON.parse(body) });
      const args = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(args.name === 'list_chats' ? { ok: true, text: '{"chats":[]}' } : { ok: false, error: 'only the orchestrator opens and drives chats' }));
    });
  });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${relay.address().port}/permission`;
  const plain = mcpClient({ SM_PERMISSION_URL: url, SM_PERMISSION_SECRET: 's1' });
  const orch = mcpClient({ SM_PERMISSION_URL: url, SM_PERMISSION_SECRET: 's2', SM_ORCHESTRATOR: '1' });
  try {
    const names = async (c) => (await c.rpc('tools/list', {})).result.tools.map((t) => t.name);
    assert.deepEqual(await names(plain), ['approve']);
    assert.deepEqual(await names(orch), ['approve', 'list_chats', 'start_chat', 'send_to_chat', 'read_chat', 'list_conversations',
      'continue_conversation', 'archive_conversation', 'rename_conversation']);
    const start = (await orch.rpc('tools/list', {})).result.tools.find((t) => t.name === 'start_chat');
    assert.deepEqual(start.inputSchema.required, ['code', 'instructions']);
    assert.deepEqual(start.inputSchema.properties.model.enum, ['haiku', 'sonnet', 'opus', 'fable']);

    const listed = await orch.rpc('tools/call', { name: 'list_chats', arguments: {} });
    assert.deepEqual(listed.result, { content: [{ type: 'text', text: '{"chats":[]}' }] });
    assert.deepEqual(seen.at(-1), { url: '/tool', secret: 's2', body: { name: 'list_chats', arguments: {} } });
    // A chat that is not the orchestrator can still name a tool: the hub refuses it.
    const refused = await plain.rpc('tools/call', { name: 'start_chat', arguments: { code: 'au01', instructions: 'x' } });
    assert.equal(refused.result.isError, true);
    assert.equal(refused.result.content[0].text, 'only the orchestrator opens and drives chats');
    assert.equal(seen.at(-1).secret, 's1');
  } finally {
    plain.close();
    orch.close();
    await new Promise((resolve) => relay.close(resolve));
  }
});

// ---- the hub with the fake claude ----

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const PROJECT = 'demo-abc123';
const OLD = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const DONE = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

const row = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId.slice(0, 4)}`, origin: 'vscode', partId: 'auth', itemCode: null, node: null, parentId: null, status: 'closed',
  waiting: false, lastStep: null, costUSD: 0.5, startedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T11:00:00.000Z',
  archived: false, live: false, chattable: true, onMap: true, cutOff: false, ...extra,
});

function makeState(root) {
  const items = [
    { code: 'au01', title: 'Login form', status: 'todo', detail: [], line: 7 },
    { code: 'au02', title: 'Password reset', status: 'todo', detail: [], line: 8 },
    { code: 'au03', title: 'Sign out', status: 'doing', detail: [], line: 9 },
    { code: 'au04', title: 'Remember me', status: 'todo', detail: [], line: 10 },
  ];
  const state = {
    projects: [{
      id: PROJECT, name: 'demo', root,
      arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [{ id: 'auth', name: 'Auth', file: 'docs/architecture/auth.md', about: 'Sign in.', codePaths: [], groups: [{ name: 'Login', items }] }] },
      workCells: [],
      chats: [{ sessionId: OLD, title: 'Old login work', partId: 'auth', chattable: true, live: false, card: { title: 'Login', doing: 'Half the form', todo: ['Submit button'] } }],
      conversations: [
        row(OLD, { title: 'Old login work', itemCode: 'au01', cutOff: true }),
        row(LIVE, { live: true, chattable: false, status: 'busy' }),
        row(DONE, { title: 'Finished reset' }),
        row(GONE, { archived: true }),
      ],
    }],
  };
  const internals = new Map([OLD, LIVE, DONE, GONE].map((id) => [id, { projectId: PROJECT, root, cwd: root, pid: null }]));
  Object.defineProperty(state, INTERNALS, { value: { chats: internals }, enumerable: false });
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
  const until = (pred, ms = 15_000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      waiters.push({ pred, resolve, timer: setTimeout(() => reject(new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)), ms) });
    });
  };
  return { sink, events, until };
}

async function withHub(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-orch-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-orch-sm-'));
  const state = makeState(root);
  const alerts = [];
  const hub = createChatHub({
    smDir, dir: root, bin: FAKE, snapshot: async () => null, readState: async () => state, onAlert: (a) => alerts.push(a),
    env: { ...process.env, FAKE_TRANSCRIPTS: join(root, 'projects', 'demo') }, ...opts,
  });
  try {
    await fn({ hub, state, smDir, root, alerts });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const inbox = (smDir) => {
  try { return { notes: {}, queued: {}, ...readJson(join(smDir, 'orch-inbox.json')) }; } catch { return { notes: {}, queued: {} }; }
};
const pageChats = (smDir) => readJson(join(smDir, 'page-chats.json'));
const users = (r) => r.events.filter((e) => e.type === 'user');
const replies = (r) => r.events.filter((e) => e.type === 'text' && !e.data.partial).map((e) => e.data.text);
const turnEnds = (r) => r.events.filter((e) => e.type === 'turn-end').length;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Opens the project's orchestrator with a first message and waits for its session.
async function openOrchestrator(hub, state, text = 'Hello') {
  const res = await hub.orchestra.open({ projectId: PROJECT, text }, state);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = recorder();
  hub.subscribe(res.body.chatKey, r.sink);
  const { data } = await r.until((e) => e.type === 'session');
  return { key: res.body.chatKey, sessionId: data.sessionId, r };
}

// A chat the hub drives, by its session id: its key, and a recorder from its first event.
function follow(hub, sessionId) {
  const { key } = hub.restartList().find((c) => c.sessionId === sessionId);
  const r = recorder();
  hub.subscribe(key, r.sink);
  return { key, r };
}

test('a chat that is not the orchestrator is refused when it calls an orchestration tool', async () => {
  await withHub({}, async ({ hub, state }) => {
    const res = await hub.start({ projectId: PROJECT, partId: 'auth', text: 'TOOL:start_chat {"code":"au01","instructions":"Build it"}' }, state);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((e) => e.type === 'turn-end');
    assert.deepEqual(replies(r), ['tool start_chat (error): only the orchestrator opens and drives chats']);
    assert.equal(hub.restartList().length, 1, 'no chat was opened');
  });
});

test('the project\'s orchestrator: one chat at the root with the orchestrator\'s prompt and tools, opened again as the same one', async () => {
  const log = join(tmpdir(), `sm-orch-log-${process.pid}.json`);
  await withHub({ env: { ...process.env, FAKE_LOG: log } }, async ({ hub, state, smDir, root }) => {
    const { key, sessionId, r } = await openOrchestrator(hub, state);
    const { argv, cwd } = readJson(log);
    const flag = (name) => argv[argv.indexOf(name) + 1];
    assert.equal(cwd, root);
    assert.deepEqual([flag('--model'), flag('--effort'), flag('--permission-mode')], ['opus', 'high', 'auto']);
    assert.match(flag('--append-system-prompt'), /Autonomous mode/);
    assert.match(flag('--append-system-prompt'), /orchestrator/);
    assert.match(flag('--append-system-prompt'), /start_chat/);
    assert.ok(Buffer.byteLength(flag('--append-system-prompt'), 'utf8') < 5 * 1024, 'prompt and tail stay under 5 KB');
    assert.equal(readJson(flag('--mcp-config')).mcpServers.sessionmap.env.SM_ORCHESTRATOR, '1');
    // Its own tools are allowed up front, by name, so the auto mode never sends them to the relay (which would refuse).
    assert.deepEqual(flag('--allowedTools').split(',').sort(), [...ORCH_TOOL_NAMES].map((n) => `mcp__sessionmap__${n}`).sort());
    assert.deepEqual(pageChats(smDir)[sessionId].node, { kind: 'orchestrator' });
    assert.match(users(r)[0].data.text, /Hello$/);
    await r.until((e) => e.type === 'turn-end');

    const again = await hub.orchestra.open({ projectId: PROJECT }, state);
    assert.deepEqual([again.status, again.body.chatKey, again.body.sessionId], [200, key, sessionId], 'the same chat, still driven');
    assert.equal(users(r).length, 1, 'opening it sends nothing');
    assert.equal(await hub.closeIdle(sessionId), true);
    const resumed = await hub.orchestra.open({ projectId: PROJECT }, state);
    assert.equal(resumed.status, 200);
    assert.notEqual(resumed.body.chatKey, key);
    assert.equal(resumed.body.sessionId, sessionId, 'resumed, never a second orchestrator');
    assert.equal(hub.restartList().find((c) => c.key === resumed.body.chatKey).sessionId, sessionId);
    assert.deepEqual(hub.orchestra.info(PROJECT, state), { projectId: PROJECT, sessionId, chatKey: resumed.body.chatKey, running: false, working: 0, tidy: false, lastTidyAt: null });
  });
  rmSync(log, { force: true });
});

test('start_chat opens an item chat with only that item, the model and effort asked and the orchestrator as its mother; its end comes back to the inbox', async () => {
  await withHub({}, async ({ hub, state, smDir, alerts }) => {
    const { sessionId: orchId, r } = await openOrchestrator(hub, state, 'TOOL:start_chat {"code":"au01","instructions":"Build the login form","model":"sonnet","effort":"medium"}');
    await r.until((e) => e.type === 'turn-end');
    const answer = replies(r)[0];
    assert.match(answer, /^tool start_chat: /);
    const started = JSON.parse(answer.slice('tool start_chat: '.length));
    assert.deepEqual([started.code, started.model, started.effort, started.state], ['au01', 'sonnet', 'medium', 'working']);
    const child = pageChats(smDir)[started.key];
    assert.ok(child, 'the key is the activity chat\'s session id');
    assert.deepEqual(child.node, { kind: 'item', code: 'au01' });
    assert.deepEqual(child.run, { kind: 'autonomous', model: 'sonnet', effort: 'medium' });
    assert.equal(child.parentId, orchId);
    assert.equal(readJson(join(smDir, 'lineage.json'))[started.key], orchId);
    assert.equal(child.title, 'Build the login form');

    // The note arrives as the orchestrator's next message, from session-map.
    const note = await r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
    assert.match(note.data.text, /^\[session-map: activity au01 \(sonnet\) ended — finished, cost US\$ 0\.00\. Summary: echo: Context from session-map.+\]$/s);
    assert.ok(note.data.text.length < 400, 'the summary the alerts use, not the whole reply');
    await r.until(() => turnEnds(r) >= 2);
    assert.deepEqual(inbox(smDir).notes[orchId] ?? [], [], 'delivered notes leave the disk');
    // The owner asked for no "finished" notice per activity chat: the orchestrator's own summary tells it.
    assert.deepEqual(alerts.filter((a) => a.sessionId === started.key && a.kind === 'finished'), []);
    assert.ok(alerts.some((a) => a.sessionId === orchId && a.kind === 'finished'), 'the orchestrator still tells its end');
  });
});

// Polls until fn() is true.
async function waitFor(fn, ms = 15_000) {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error('timed out');
    await pause(50);
  }
}
const parsed = (answer) => {
  assert.equal(answer.ok, true, answer.error);
  return JSON.parse(answer.text);
};
const LIMIT = { ok: false, error: 'limit: wait for one to finish (your inbox tells you)' };

test('limits: at most 3 activity chats working at once per orchestrator, however many places are free', async () => {
  await withHub({ chatsMax: 20 }, async ({ hub, state, smDir }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const start = (code) => hub.orchestra.call(orch, 'start_chat', { code, instructions: `SLOW work on ${code}` });
    const first = parsed(await start('au01'));
    for (const code of ['au02', 'au03']) parsed(await start(code));
    // Three are working: the fourth waits in the priority line (or08) instead of being refused.
    const waits = parsed(await start('au04'));
    assert.deepEqual([waits.state, waits.key, waits.code, waits.priority, waits.ahead], ['waiting', null, 'au04', 'normal', 0], 'three are working');
    assert.match(waits.why, /^waiting: no free place now/);
    const child = follow(hub, first.key);
    hub.stop(child.key);
    await child.r.until((e) => e.type === 'turn-end');
    // One finished: a place, and the line starts the waiting one on its own.
    await waitFor(() => hub.restartList().length === 5);
    assert.deepEqual(readQueue(smDir, PROJECT).waiting, [], 'it left the line');
    assert.equal(hub.restartList().length, 5, 'the idle one stays open while there is room');
  });
});

test('limits: when the places run short, an idle activity chat of its own gives its place to the new one', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const start = (code) => hub.orchestra.call(orch, 'start_chat', { code, instructions: `SLOW work on ${code}` });
    const first = parsed(await start('au01'));
    for (const code of ['au02', 'au03']) parsed(await start(code));
    const child = follow(hub, first.key);
    hub.stop(child.key);
    await child.r.until((e) => e.type === 'turn-end');
    // 4 open of CHATS_MAX 6: the orchestrators leave the last 2 to the person, so the idle one is closed for the new one.
    const fourth = parsed(await start('au04'));
    assert.equal(fourth.code, 'au04');
    assert.equal(hub.restartList().some((c) => c.sessionId === first.key), false, 'the idle one gave its place');
    assert.equal(hub.restartList().length, 4);
  });
});

test('limits: the orchestrators never take the last 2 places of CHATS_MAX, and open or continue at most 30 a day', async () => {
  let clock = new Date(2026, 9, 11, 12).getTime();
  await withHub({ orchestra: { now: () => clock } }, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    for (const text of ['SLOW one', 'SLOW two']) assert.equal((await hub.start({ projectId: PROJECT, partId: 'auth', text, run: { kind: 'auto' } }, state)).status, 200);
    parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'SLOW login' }));
    assert.equal(parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au02', instructions: 'Reset' })).state, 'waiting', '4 open: 2 are the person\'s: it waits in the line');
    // restartList names a chat once its claude has told its session id, which a slow machine may not have done yet.
    await waitFor(() => hub.restartList().length >= 4, 5_000);
    assert.equal(hub.restartList().length, 4);

    writeFileSync(join(smDir, 'orchestra.json'), JSON.stringify({ day: { [orchId]: { date: '2026-10-11', count: 30 } } }));
    const DAY = { ok: false, error: 'limit: 30 activity chats opened or continued today; go on tomorrow' };
    for (const c of hub.restartList().filter((x) => x.key !== orch)) hub.stop(c.key);
    await waitFor(() => hub.turning() === 0 || hub.restartList().filter((x) => x.running).every((x) => x.key === orch));
    assert.deepEqual(await hub.orchestra.call(orch, 'continue_conversation', { sessionId: OLD, instructions: 'Finish it' }), DAY);
    clock += 24 * 3600_000;
    assert.notDeepEqual(await hub.orchestra.call(orch, 'continue_conversation', { sessionId: OLD, instructions: 'Finish it' }), DAY, 'a new day');
  });
});

test('start_chat refuses an unknown code, empty instructions and a model or effort off the lists', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    assert.match((await hub.orchestra.call(orch, 'start_chat', { code: 'zz99', instructions: 'x' })).error, /^unknown code/);
    assert.match((await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: ' ' })).error, /^instructions/);
    assert.match((await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'x', model: 'gpt' })).error, /^model is haiku/);
    assert.match((await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'x', effort: 'ultracode' })).error, /^model is haiku/);
    assert.equal(hub.restartList().length, 1);
    // The code is matched whatever its case, and kept as the map writes it.
    assert.equal(parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'AU02', instructions: 'Reset' })).code, 'au02');
  });
});

test('send_to_chat: mid-turn the instructions wait for the turn end; a stop by the person keeps them waiting; to an idle chat they go at once', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'SLOW start' }));
    assert.deepEqual(parsed(await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: 'Now the error message' })), { key, state: 'queued' });
    assert.deepEqual(inbox(smDir).queued[key].map((q) => q.text), ['Now the error message']);
    const child = follow(hub, key);
    hub.stop(child.key);
    await child.r.until((e) => e.type === 'turn-end');
    const note = await r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
    assert.match(note.data.text, /ended — waiting \(stopped by the person\)/);
    // The person stopped it: what waited does not start it again, not even from the scheduler.
    await hub.orchestra.tick();
    await pause(200);
    assert.equal(users(child.r).length, 1, 'nothing sent after the stop');
    assert.deepEqual((inbox(smDir).queued[key] ?? []).map((q) => q.text), ['Now the error message'], 'still waiting');

    // The orchestrator, told of the stop, decides: its next step goes at once, with what waited before it.
    assert.deepEqual(parsed(await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: 'And the tests' })), { key, state: 'working' });
    const next = await child.r.until((e) => e.type === 'user' && e.data.text.includes('And the tests'));
    assert.deepEqual([next.data.text, next.data.auto], ['Now the error message\n\nAnd the tests', 'orchestrator']);
    assert.equal(inbox(smDir).queued[key], undefined);
    assert.match((await hub.orchestra.call(orch, 'send_to_chat', { key: OLD, instructions: 'x' })).error, /^unknown key/, 'only its own chats');
  });
});

test('read_chat gives the last replies of one of its chats as plain text, at most 5, each at most 4 KB', async () => {
  await withHub({}, async ({ hub, state }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: `Long ${'é'.repeat(5000)}` }));
    const child = follow(hub, key);
    await child.r.until((e) => e.type === 'turn-end');
    const one = parsed(await hub.orchestra.call(orch, 'read_chat', { key, last: 9 }));
    assert.equal(one.replies.length, 1);
    assert.ok(Buffer.byteLength(one.replies[0], 'utf8') <= 4096, `${Buffer.byteLength(one.replies[0], 'utf8')} bytes`);
    assert.match(one.replies[0], /^echo: /);

    parsed(await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: 'Short one' }));
    await child.r.until(() => turnEnds(child.r) >= 2);
    assert.deepEqual(parsed(await hub.orchestra.call(orch, 'read_chat', { key })).replies, ['echo: Short one']);
    assert.equal(parsed(await hub.orchestra.call(orch, 'read_chat', { key, last: 2 })).replies.length, 2);
    assert.match((await hub.orchestra.call(orch, 'read_chat', { key: OLD })).error, /^unknown key/);
  });
});

test('the inbox: notes that arrive while the orchestrator works go out together as its next message, counted as an automatic turn', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state, 'SLOW thinking');
    parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'First' }));
    parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au02', instructions: 'Second' }));
    await waitFor(() => (inbox(smDir).notes[orchId] ?? []).length === 2);
    assert.equal(users(r).length, 1, 'nothing reaches it mid-turn');
    const note = await r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
    assert.match(note.data.text, /^\[session-map: activity au0[12] .*\]\n\[session-map: activity au0[12] .*\]$/s);
    assert.ok(note.data.text.includes('activity au01') && note.data.text.includes('activity au02'));
    assert.equal(users(r).length, 2, 'one message for both');
    assert.equal(readJson(join(smDir, 'orchestra.json')).chain[orchId].n, 1);
  });
});

// An orchestrator on disk, closed, as after a restart.
const ORCH = '55555555-5555-4555-8555-555555555555';
function orchestratorOnDisk(smDir, root, extra = {}) {
  writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
    [ORCH]: { projectId: PROJECT, root, cwd: root, node: { kind: 'orchestrator' }, run: { kind: 'autonomous' }, prompted: 'autonomous', running: false, title: 'Orchestrator', startedAt: '2026-10-01T09:00:00.000Z', ...extra },
  }));
  writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ notes: { [ORCH]: [{ at: '2026-10-11T10:00:00.000Z', text: '[session-map: activity au01 (sonnet) ended — finished, cost US$ 0.10. Summary: done]' }] } }));
}

test('the inbox is kept on disk: a new hub delivers it, resuming the closed orchestrator', async () => {
  await withHub({}, async ({ hub, smDir, root }) => {
    orchestratorOnDisk(smDir, root);
    await hub.orchestra.tick();
    const { r } = follow(hub, ORCH);
    const note = await r.until((e) => e.type === 'user');
    assert.deepEqual([note.data.auto, note.data.text], ['inbox', '[session-map: activity au01 (sonnet) ended — finished, cost US$ 0.10. Summary: done]']);
    assert.equal(inbox(smDir).notes[ORCH], undefined);
    await r.until((e) => e.type === 'turn-end');
  });
});

test('while a restart waits the inbox stays on disk and the orchestrator is marked held, so the restart resumes it', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'SLOW start' }));
    hub.hold(true);
    const child = follow(hub, key);
    hub.stop(child.key);
    await waitFor(() => (inbox(smDir).notes[orchId] ?? []).length === 1);
    await pause(200);
    assert.equal(users(r).length, 1, 'nothing sent');
    assert.equal(hub.restartList().find((c) => c.key === orch).held, true);
  });
});

test('a stop of the orchestrator by the person holds its inbox until the person writes again', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state, 'SLOW thinking');
    parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'Quick one' }));
    await waitFor(() => (inbox(smDir).notes[orchId] ?? []).length === 1);
    hub.stop(orch);
    await r.until((e) => e.type === 'turn-end');
    await hub.orchestra.tick();
    await pause(300);
    assert.equal(users(r).length, 1, 'the note waits, also past a pass of the scheduler');
    assert.equal(hub.send(orch, { text: 'Go on' }).status, 200);
    const note = await r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
    assert.match(note.data.text, /activity au01/);
  });
});

test('instructions left for an activity chat whose process closed are sent by the scheduler, resuming it', async () => {
  const CHILD = '77777777-7777-4777-8777-777777777777';
  await withHub({}, async ({ hub, smDir, root }) => {
    orchestratorOnDisk(smDir, root);
    const pages = pageChats(smDir);
    pages[CHILD] = { projectId: PROJECT, root, cwd: root, node: { kind: 'item', code: 'au01' }, parentId: ORCH, run: { kind: 'autonomous', model: 'sonnet' }, prompted: 'autonomous', running: false, title: 'Login form', startedAt: '2026-10-02T09:00:00.000Z' };
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify(pages));
    writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ queued: { [CHILD]: [{ at: '2026-10-11T10:00:00.000Z', text: 'Now the tests' }] } }));
    await hub.orchestra.tick();
    const { r } = follow(hub, CHILD);
    const sent = await r.until((e) => e.type === 'user');
    assert.deepEqual([sent.data.text, sent.data.auto], ['Now the tests', 'orchestrator']);
    assert.equal(inbox(smDir).queued[CHILD], undefined);
    assert.deepEqual(hub.restartList().find((c) => c.sessionId === CHILD).run, { kind: 'autonomous', model: 'sonnet' });
  });
});

test('opening a closed orchestrator delivers what waits in its inbox', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    orchestratorOnDisk(smDir, root);
    const res = await hub.orchestra.open({ projectId: PROJECT }, state);
    assert.deepEqual([res.status, res.body.sessionId, res.body.started], [200, ORCH, false]);
    const { r } = follow(hub, ORCH);
    const note = await r.until((e) => e.type === 'user');
    assert.equal(note.data.auto, 'inbox');
  });
});

test('20 automatic turns in a row: the orchestrator stops, says so once, and the person\'s next message starts it again', async () => {
  await withHub({}, async ({ hub, state, smDir, root, alerts }) => {
    orchestratorOnDisk(smDir, root);
    writeFileSync(join(smDir, 'orchestra.json'), JSON.stringify({ chain: { [ORCH]: { n: 20 } } }));
    await hub.orchestra.tick();
    await hub.orchestra.tick();
    assert.equal(hub.restartList().length, 0, 'not resumed');
    assert.deepEqual(alerts.map((a) => [a.kind, a.reason, a.sessionId, a.projectId]), [['waiting', 'chain', ORCH, PROJECT]], 'said once');
    assert.equal(inbox(smDir).notes[ORCH].length, 1, 'the note waits');

    const res = await hub.orchestra.open({ projectId: PROJECT, text: 'Go on' }, state);
    assert.equal(res.status, 200);
    const { r } = follow(hub, ORCH);
    assert.equal((await r.until((e) => e.type === 'user')).data.text, 'Go on');
    const note = await r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
    assert.match(note.data.text, /activity au01/);
    assert.equal(readJson(join(smDir, 'orchestra.json')).chain[ORCH].n, 1);
  });
});

test('an activity chat whose claude closed by itself mid-turn is news for its orchestrator', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId } = await openOrchestrator(hub, state, 'SLOW thinking');
    // The fake claude dies mid-turn: session-map did not close it.
    parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'CRASH while working' }));
    await waitFor(() => (inbox(smDir).notes[orchId] ?? []).length === 1);
    assert.match(inbox(smDir).notes[orchId][0].text, /activity au01 \(opus\) ended — error \(claude closed by itself\)/);
  });
});

test('limits: an idle activity chat sent its next step counts among the 3 working, from send_to_chat and from the scheduler', async () => {
  await withHub({ chatsMax: 20 }, async ({ hub, state, smDir }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const keys = [];
    for (const code of ['au01', 'au02', 'au03', 'au04']) {
      const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code, instructions: `Quick ${code}` }));
      await follow(hub, key).r.until((e) => e.type === 'turn-end');
      keys.push(key);
    }
    // Four idle and still open: three go back to work, the fourth waits.
    for (const key of keys.slice(0, 3)) assert.equal(parsed(await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: 'SLOW next step' })).state, 'working');
    assert.deepEqual(await hub.orchestra.call(orch, 'send_to_chat', { key: keys[3], instructions: 'SLOW next step' }), LIMIT);
    const fourth = follow(hub, keys[3]);
    assert.equal(users(fourth.r).length, 1, 'nothing sent');

    writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ queued: { [keys[3]]: [{ at: '2026-10-11T10:00:00.000Z', text: 'Later' }] } }));
    await hub.orchestra.tick();
    await pause(200);
    assert.equal(users(fourth.r).length, 1, 'the scheduler keeps the limit too');
    assert.equal(inbox(smDir).queued[keys[3]].length, 1, 'the instructions wait');
    const first = follow(hub, keys[0]);
    hub.stop(first.key);
    await first.r.until(() => turnEnds(first.r) >= 2);
    await hub.orchestra.tick();
    assert.equal((await fourth.r.until((e) => e.type === 'user' && e.data.text === 'Later')).data.auto, 'orchestrator');
  });
});

test('send_to_chat: past 20 instructions waiting for one chat it answers with a limit instead of dropping the oldest', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'SLOW start' }));
    for (let i = 1; i <= 20; i++) assert.equal(parsed(await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: `Step ${i}` })).state, 'queued');
    const full = await hub.orchestra.call(orch, 'send_to_chat', { key, instructions: 'Step 21' });
    assert.equal(full.ok, false);
    assert.match(full.error, /^limit: /);
    assert.deepEqual(inbox(smDir).queued[key].map((q) => q.text), Array.from({ length: 20 }, (_, i) => `Step ${i + 1}`), 'none lost');
  });
});

test('past 50 notes waiting, the oldest are folded into one without their summaries: none is lost', async () => {
  const CHILD = '77777777-7777-4777-8777-777777777777';
  await withHub({}, async ({ hub, state, smDir, root }) => {
    orchestratorOnDisk(smDir, root);
    const pages = pageChats(smDir);
    pages[CHILD] = { projectId: PROJECT, root, cwd: root, node: { kind: 'item', code: 'au02' }, parentId: ORCH, run: { kind: 'autonomous', model: 'sonnet' }, prompted: 'autonomous', running: false, title: 'Reset', startedAt: '2026-10-02T09:00:00.000Z' };
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify(pages));
    const old = Array.from({ length: 50 }, (_, i) => ({ at: '2026-10-11T10:00:00.000Z', text: `[session-map: activity "n${i}" (sonnet) ended — finished, cost US$ 0.10. Summary: done ${i}]` }));
    writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ notes: { [ORCH]: old } }));
    // Stopped by the person: the notes wait.
    writeFileSync(join(smDir, 'orchestra.json'), JSON.stringify({ chain: { [ORCH]: { n: 0, paused: true } } }));
    const res = await hub.start({ projectId: PROJECT, sessionId: CHILD, text: 'Quick look' }, state);
    assert.equal(res.status, 200);
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((e) => e.type === 'turn-end');
    await waitFor(() => (inbox(smDir).notes[ORCH] ?? []).some((n) => n.text.includes('activity au02')));
    const notes = inbox(smDir).notes[ORCH];
    assert.equal(notes.length, 50);
    assert.equal(notes[0].text, `${old[0].text.replace(/\. Summary: .*\]$/, ']')}\n${old[1].text.replace(/\. Summary: .*\]$/, ']')}`);
    assert.deepEqual(notes.slice(1, 49).map((n) => n.text), old.slice(2).map((n) => n.text));
    assert.match(notes[49].text, /activity au02/);
  });
});

test('a note that arrives while a delivery is resuming the closed orchestrator is not folded away with the ones being sent', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-orch-fold-'));
  try {
    const CHILD = '77777777-7777-4777-8777-777777777777';
    const pages = {
      [ORCH]: { projectId: PROJECT, node: { kind: 'orchestrator' }, run: { kind: 'autonomous' }, title: 'Orchestrator', startedAt: '2026-10-01T09:00:00.000Z' },
      [CHILD]: { projectId: PROJECT, node: { kind: 'item', code: 'au02' }, parentId: ORCH, run: { kind: 'autonomous', model: 'sonnet' }, title: 'Reset' },
    };
    const old = Array.from({ length: 50 }, (_, i) => ({ at: '2026-10-11T10:00:00.000Z', text: `[session-map: activity "n${i}" (sonnet) ended — finished, cost US$ 0.10. Summary: done ${i}]` }));
    writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ notes: { [ORCH]: old } }));
    let finish;
    const started = new Promise((resolve) => { finish = resolve; });
    // A hub whose start (the resume of the orchestrator) waits until the test says so.
    const hub = {
      live: () => [], byKey: () => null, driven: () => null, holding: () => false, pageChats: () => pages, chatsMax: 6, start: () => started,
      send: () => {}, say: () => {}, closeIdle: async () => true, emit: () => {}, alert: () => {}, transcript: () => null, driving: () => new Set(),
    };
    const orchestra = createOrchestra({ smDir, hub, readState: async () => ({ projects: [] }) });
    const tick = orchestra.tick();
    await pause(50);
    // While the 50 notes are on their way, an activity chat ends its turn: the 51st note.
    const child = { sessionId: CHILD, parentId: ORCH, node: { kind: 'item', code: 'au02' }, title: 'Reset', run: { kind: 'autonomous', model: 'sonnet' }, costUSD: 0.2 };
    orchestra.turnEnded(child, { isError: false, reply: 'Reset done.', auto: false, stopped: false });
    finish({ status: 200, body: { chatKey: 'k' } });
    await tick;
    const left = inbox(smDir).notes[ORCH] ?? [];
    assert.equal(left.length, 1, 'the one that came during the delivery still waits');
    assert.match(left[0].text, /activity au02/);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('an orchestrator waiting for the person\'s OK to spend is not woken by its inbox, not even once closed; the person\'s message wakes it', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    // Past the default monthly limit: the Autonomous way stops to ask before the big step.
    const { sessionId: orchId, r } = await openOrchestrator(hub, state, 'Big step RUN:ask-reinforce:50');
    await r.until((e) => e.type === 'turn-end');
    assert.equal(await hub.closeIdle(orchId), true);
    writeFileSync(join(smDir, 'orch-inbox.json'), JSON.stringify({ notes: { [orchId]: [{ at: '2026-10-11T10:00:00.000Z', text: '[session-map: activity au01 (sonnet) ended — finished, cost US$ 0.10. Summary: done]' }] } }));
    await hub.orchestra.tick();
    await pause(200);
    assert.equal(hub.restartList().length, 0, 'not resumed: it waits for the person');
    assert.equal(inbox(smDir).notes[orchId].length, 1, 'the note waits');
    const res = await hub.orchestra.open({ projectId: PROJECT, text: 'Yes, go on' }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const again = follow(hub, orchId);
    assert.equal((await again.r.until((e) => e.type === 'user')).data.text, 'Yes, go on');
    await again.r.until((e) => e.type === 'user' && e.data.auto === 'inbox');
  });
});

test('an archived orchestrator is no longer the project\'s: the inbox does not resume it and opening starts a new one', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    orchestratorOnDisk(smDir, root);
    writeFileSync(join(smDir, 'archived.json'), JSON.stringify([ORCH]));
    await hub.orchestra.tick();
    await pause(200);
    assert.equal(hub.restartList().length, 0, 'not resumed');
    assert.equal(inbox(smDir).notes[ORCH].length, 1, 'its notes wait on disk');
    assert.equal(hub.orchestra.info(PROJECT, state).sessionId, null);
    const res = await hub.orchestra.open({ projectId: PROJECT }, state);
    assert.deepEqual([res.status, res.body.started], [200, true], 'a new one');
    assert.equal(hub.restartList().some((c) => c.sessionId === ORCH), false);
  });
});

test('the agreed restart\'s note to an orchestrator is session-map\'s, not the person\'s: its chain does not start again', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    orchestratorOnDisk(smDir, root, { running: true });
    writeFileSync(join(smDir, 'orch-inbox.json'), '{}');
    const chain = { n: 20, said: true, paused: false };
    writeFileSync(join(smDir, 'orchestra.json'), JSON.stringify({ chain: { [ORCH]: chain } }));
    writeFileSync(join(smDir, RESUME_FILE), JSON.stringify({
      version: 1, at: new Date().toISOString(), reasons: ['Reload'],
      chats: [{ sessionId: ORCH, key: 'a'.repeat(32), projectId: PROJECT, run: { kind: 'autonomous' }, running: true, held: false, asked: false }],
    }));
    assert.deepEqual(await resumeAfterRestart({ smDir, hub, readState: async () => state }), { resumed: 1, left: 0 });
    const { r } = follow(hub, ORCH);
    await r.until((e) => e.type === 'turn-end');
    assert.deepEqual(readJson(join(smDir, 'orchestra.json')).chain[ORCH], chain);
  });
});

test('while a restart waits, an orchestrator stopped by the person is not marked held: the restart leaves it idle', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state, 'SLOW thinking');
    const { key } = parsed(await hub.orchestra.call(orch, 'start_chat', { code: 'au01', instructions: 'SLOW work' }));
    hub.stop(orch);
    await r.until((e) => e.type === 'turn-end');
    hub.hold(true);
    const child = follow(hub, key);
    hub.stop(child.key);
    await waitFor(() => (inbox(smDir).notes[orchId] ?? []).length === 1);
    await pause(200);
    assert.equal(hub.restartList().find((c) => c.key === orch).held, false);
  });
});

test('the first message of a new orchestrator carries the images the person attached', async () => {
  await withHub({}, async ({ hub, state }) => {
    const images = [{ media: 'image/png', data: 'iVBORw0KGgo=' }];
    const res = await hub.orchestra.open({ projectId: PROJECT, text: 'See this', images }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    assert.equal((await r.until((e) => e.type === 'user')).data.images, 1);
    await r.until((e) => e.type === 'turn-end');
    assert.match(replies(r)[0], /\[images:1\]$/);
    const again = await hub.orchestra.open({ projectId: PROJECT, text: 'And this', images }, state);
    assert.equal(again.status, 200);
    assert.equal((await r.until((e) => e.type === 'user' && e.data.text === 'And this')).data.images, 1, 'also to a driven one');
    await r.until(() => turnEnds(r) >= 2);
    assert.equal((await hub.orchestra.open({ projectId: PROJECT, text: 'Bad', images: [{ media: 'text/html', data: 'x' }] }, state)).status, 400);
  });
});

// ---- the project's older conversations (or17) ----

test('list_conversations leaves out the live, the driven, the archived and its own; continue_conversation adopts one and records it', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, sessionId: orchId, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    // The person has DONE open in session-map now.
    const mine = await hub.start({ projectId: PROJECT, sessionId: DONE, text: 'Looking again', run: { kind: 'auto' } }, state);
    assert.equal(mine.status, 200);
    const { conversations } = parsed(await hub.orchestra.call(orch, 'list_conversations', {}));
    assert.deepEqual(conversations, [{
      sessionId: OLD, title: 'Old login work', origin: 'vscode', itemCode: 'au01', state: 'cut off', lastStep: null,
      card: { title: 'Login', doing: 'Half the form', todo: ['Submit button'], waiting: [] }, updatedAt: '2026-10-01T11:00:00.000Z', costUSD: 0.5,
    }]);

    assert.deepEqual(await hub.orchestra.call(orch, 'continue_conversation', { sessionId: LIVE, instructions: 'x' }), { ok: false, error: 'live in another window: leave it to the person' });
    assert.deepEqual(await hub.orchestra.call(orch, 'continue_conversation', { sessionId: DONE, instructions: 'x' }), { ok: false, error: 'open in session-map now: leave it to the person' });
    assert.match((await hub.orchestra.call(orch, 'continue_conversation', { sessionId: orchId, instructions: 'x' })).error, /^unknown conversation/);
    const went = parsed(await hub.orchestra.call(orch, 'continue_conversation', { sessionId: OLD, instructions: 'Finish the form', model: 'haiku' }));
    assert.deepEqual(went, { key: OLD, model: 'haiku', effort: 'high', state: 'working' });
    const { r: old } = follow(hub, OLD);
    const first = await old.until((e) => e.type === 'user');
    assert.deepEqual([first.data.text, first.data.auto], ['Finish the form', 'orchestrator']);
    await old.until((e) => e.type === 'session');
    assert.equal(pageChats(smDir)[OLD].parentId, orchId);
    assert.deepEqual(pageChats(smDir)[OLD].run, { kind: 'autonomous', model: 'haiku' });
    assert.equal(readJson(join(smDir, 'lineage.json'))[OLD], orchId);
    const { chats } = parsed(await hub.orchestra.call(orch, 'list_chats', {}));
    assert.deepEqual(chats.map((c) => [c.key, c.code, c.model]), [[OLD, 'au01', 'haiku']]);
  });
});

test('archive_conversation archives a finished one with its reason; rename_conversation gives it a clear title', async () => {
  await withHub({}, async ({ hub, state, smDir }) => {
    const { key: orch, r } = await openOrchestrator(hub, state);
    await r.until((e) => e.type === 'turn-end');
    assert.match((await hub.orchestra.call(orch, 'archive_conversation', { sessionId: DONE, reason: ' ' })).error, /^reason/);
    assert.equal((await hub.orchestra.call(orch, 'archive_conversation', { sessionId: LIVE, reason: 'done' })).ok, false, 'not a live one');
    assert.deepEqual(parsed(await hub.orchestra.call(orch, 'archive_conversation', { sessionId: DONE, reason: 'The reset shipped' })), { sessionId: DONE, archived: true });
    assert.deepEqual(readJson(join(smDir, 'archived.json')), [DONE]);

    assert.match((await hub.orchestra.call(orch, 'rename_conversation', { sessionId: OLD, title: '' })).error, /^title/);
    assert.match((await hub.orchestra.call(orch, 'rename_conversation', { sessionId: OLD, title: 'x'.repeat(201) })).error, /^title/);
    assert.deepEqual(parsed(await hub.orchestra.call(orch, 'rename_conversation', { sessionId: OLD, title: 'Login form,\n first half' })), { sessionId: OLD, title: 'Login form, first half' });
    assert.equal(readJson(join(smDir, 'placements.json'))[OLD].title, 'Login form, first half');
  });
});

// ---- organizing on its own (or18) ----

const HOUR = 3600_000;
const at = (ms) => new Date(ms).toISOString();

test('tidyDue: the switch on, the project quiet, a change since the last pass, and a day gone or five new conversations', () => {
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  const last = at(now - 2 * HOUR);
  const old = { startedAt: at(now - 50 * HOUR), updatedAt: at(now - 50 * HOUR) };
  const touched = { startedAt: at(now - 50 * HOUR), updatedAt: at(now - HOUR) };
  const born = { startedAt: at(now - HOUR), updatedAt: at(now - HOUR) };
  assert.equal(tidyDue({ on: true, working: false, rows: [old], lastAt: null, now }), true, 'the first pass');
  assert.equal(tidyDue({ on: true, working: false, rows: [], lastAt: null, now }), false, 'nothing to tidy');
  assert.equal(tidyDue({ on: false, working: false, rows: [old], lastAt: null, now }), false, 'switched off');
  assert.equal(tidyDue({ on: true, working: true, rows: [old], lastAt: null, now }), false, 'something works');
  assert.equal(tidyDue({ on: true, working: false, rows: [touched], lastAt: last, now }), false, 'a change, but within the day');
  assert.equal(tidyDue({ on: true, working: false, rows: [touched], lastAt: at(now - 25 * HOUR), now }), true, 'a change and a day gone');
  assert.equal(tidyDue({ on: true, working: false, rows: [old], lastAt: at(now - 25 * HOUR), now }), false, 'never twice on the same picture');
  assert.equal(tidyDue({ on: true, working: false, rows: [old, born, born, born, born], lastAt: last, now }), false, 'four new');
  assert.equal(tidyDue({ on: true, working: false, rows: [born, born, born, born, born], lastAt: last, now }), true, 'five new');
});

test('the switch "Organizar sozinho" lives in session-map\'s config by the project\'s folder, off until the owner turns it on', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-orch-tidy-'));
  try {
    const root = join(tmpdir(), 'Shop');
    assert.equal(readTidy(smDir, root), false);
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 10 }, projects: { other: { background: 'always' } } }));
    assert.deepEqual(setTidy(smDir, root, false), { ok: true, tidy: false });
    assert.equal(readTidy(smDir, root), false);
    const saved = readJson(join(smDir, 'config.json'));
    assert.deepEqual(saved.budget, { monthlyUSD: 10 });
    assert.deepEqual(saved.projects.other, { background: 'always' });
    assert.equal(Object.values(saved.projects).filter((p) => p.tidy === false).length, 1);
    assert.deepEqual(setTidy(smDir, root, true), { ok: true, tidy: true });
    assert.equal(readTidy(smDir, root), true);
    assert.deepEqual(setTidy(smDir, root, 'yes'), { ok: false, error: 'bad-tidy' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the tidy scheduler: a quiet project with the switch on gets a pass, the first one starting its orchestrator; never twice without a change', async () => {
  let clock = Date.parse('2026-10-02T12:00:00.000Z');
  await withHub({ orchestra: { now: () => clock } }, async ({ hub, state, smDir, root }) => {
    const [project] = state.projects;
    project.conversations = project.conversations.filter((r) => !r.live);
    const tidyTurns = (r) => users(r).filter((e) => e.data.auto === 'tidy').length;

    setTidy(smDir, root, false);
    await hub.orchestra.tick();
    assert.equal(hub.restartList().length, 0, 'switched off');
    setTidy(smDir, root, true);
    project.conversations[0].status = 'busy';
    await hub.orchestra.tick();
    assert.equal(hub.restartList().length, 0, 'the project is at work');
    project.conversations[0].status = 'closed';

    await hub.orchestra.tick();
    const { chatKey } = hub.orchestra.info(PROJECT, state);
    assert.ok(chatKey, 'the pass started the orchestrator');
    const r = recorder();
    hub.subscribe(chatKey, r.sink);
    const pass = await r.until((e) => e.type === 'user');
    assert.equal(pass.data.auto, 'tidy');
    assert.match(pass.data.text, /^\[session-map: tidy pass\] .*archive the finished ones.*"Organized: \.\.\."/s);
    await r.until((e) => e.type === 'turn-end');
    const { sessionId: orchId } = hub.orchestra.info(PROJECT, state);
    assert.deepEqual(pageChats(smDir)[orchId].node, { kind: 'orchestrator' });
    assert.equal(hub.orchestra.info(PROJECT, state).lastTidyAt, at(clock));

    clock += 25 * HOUR;
    await hub.orchestra.tick();
    await pause(200);
    assert.equal(tidyTurns(r), 1, 'nothing changed since: no second pass');

    project.conversations[0].updatedAt = at(clock - 1000);
    await hub.orchestra.tick();
    await r.until(() => tidyTurns(r) === 2);
    await r.until(() => turnEnds(r) >= 2);

    clock += HOUR;
    for (let i = 0; i < 5; i++) project.conversations.push(row(`6666666${i}-6666-4666-8666-666666666666`, { startedAt: at(clock - 1000), updatedAt: at(clock - 1000) }));
    await hub.orchestra.tick();
    await r.until(() => tidyTurns(r) === 3);
    await r.until(() => turnEnds(r) >= 3);
    assert.equal(readJson(join(smDir, 'orchestra.json')).chain[orchId].n, 3, 'the passes count in the chain');
  });
});

// ---- the words ----

test('the orchestrator\'s prompt section stays compact: with the Autonomous prompt and a day\'s tail it is under 5 KB', () => {
  const tail = [ORCH_PROMPT, conductorTail({ others: null, stats: [] }), budgetLine({ limitUSD: 1234.5, spentUSD: 999.25 })].join('\n');
  const args = runArgs({ kind: 'autonomous' }, tail);
  const sent = args[args.indexOf('--append-system-prompt') + 1];
  assert.ok(Buffer.byteLength(sent, 'utf8') < 5 * 1024, `${Buffer.byteLength(sent, 'utf8')} bytes`);
  for (const tool of ['start_chat', 'send_to_chat', 'read_chat', 'list_chats', 'list_conversations', 'continue_conversation', 'archive_conversation', 'rename_conversation']) {
    assert.ok(ORCH_PROMPT.includes(tool), tool);
  }
  assert.doesNotMatch(`${ORCH_PROMPT}\n${TIDY_TEXT}\n${OPENING_TEXT}`, /\b[a-z]{2,3}\d{2,3}\b/i, 'no code-shaped token the transcript reader would count');
});

test('outcomeOf words an activity chat\'s end the way the alerts do; the note carries code, model, cost and summary', () => {
  assert.equal(outcomeOf({ isError: false, reply: 'Done: the form submits.' }), 'finished');
  assert.equal(outcomeOf({ isError: false, reply: 'Should I push it now?' }), 'waiting');
  assert.equal(outcomeOf({ isError: false, reply: 'Big.\n```session-map-run\n{"level":"ask-reinforce","why":"x","estimateUSD":3}\n```' }), 'waiting');
  assert.equal(outcomeOf({ isError: true, reply: '' }), 'error');
  assert.equal(outcomeOf({ isError: true, reply: '', stopped: true }), 'waiting');
  assert.equal(noteOf({ code: 'au01', model: 'haiku', outcome: 'finished', costUSD: 0.126, summary: 'Form done' }), '[session-map: activity au01 (haiku) ended — finished, cost US$ 0.13. Summary: Form done]');
  assert.equal(noteOf({ code: null, title: 'Old login work', model: 'opus', outcome: 'waiting', stopped: true, costUSD: 0, summary: '' }), '[session-map: activity "Old login work" (opus) ended — waiting (stopped by the person), cost US$ 0.00. Summary: (no words)]');
});

test('the pause after 20 automatic turns has its alert words in every language, in plain words', () => {
  for (const [lang, words] of Object.entries(LANGS)) {
    for (const key of ['alert.what.chain', 'alert.why.chain', 'alert.do.chain']) assert.equal(typeof words[key], 'string', `${lang} ${key}`);
  }
  assert.equal(LANGS['pt-BR']['alert.what.chain'], 'O orquestrador pausou');
});

// ---- the page's routes ----

test('http: the page opens the project\'s orchestrator and reads it; the "Organizar sozinho" switch is read and set', async () => {
  await withHub({}, async ({ hub, state, smDir, root }) => {
    const app = createApp({ dir: root, smDir, chat: hub, collectFn: () => state, stateTtlMs: 0 });
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
    const { port } = app.address();
    const host = `127.0.0.1:${port}`;
    const token = loadToken(smDir);
    const call = (method, path, { body, auth = true } = {}) => new Promise((resolve, reject) => {
      const headers = { host, ...(auth ? { cookie: `sm_token=${token}` } : {}), ...(method !== 'GET' ? { origin: `http://${host}`, 'x-session-map': '1', 'content-type': 'application/json' } : {}) };
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    try {
      assert.equal((await call('POST', '/api/chat/orchestrator', { body: { projectId: PROJECT }, auth: false })).status, 401);
      assert.equal((await call('GET', `/api/chat/orchestrator?projectId=${PROJECT}`, { auth: false })).status, 401);
      assert.equal((await call('POST', '/api/chat/orchestrator', { body: { projectId: 'nope' } })).status, 404);
      const none = await call('GET', `/api/chat/orchestrator?projectId=${PROJECT}`);
      assert.deepEqual(none.json, { ok: true, projectId: PROJECT, sessionId: null, chatKey: null, running: false, working: 0, tidy: false, lastTidyAt: null });

      const opened = await call('POST', '/api/chat/orchestrator', { body: { projectId: PROJECT, text: 'Hello' } });
      assert.equal(opened.status, 200);
      assert.equal(opened.json.started, true);
      const r = recorder();
      hub.subscribe(opened.json.chatKey, r.sink);
      const { data } = await r.until((e) => e.type === 'session');
      const one = await call('GET', `/api/chat/orchestrator?projectId=${PROJECT}`);
      assert.deepEqual([one.json.sessionId, one.json.chatKey], [data.sessionId, opened.json.chatKey]);
      const all = await call('GET', '/api/chat/orchestrator');
      assert.deepEqual(all.json.orchestrators.map((o) => [o.projectId, o.sessionId]), [[PROJECT, data.sessionId]]);
      await r.until((e) => e.type === 'turn-end');
      const again = await call('POST', '/api/chat/orchestrator', { body: { projectId: PROJECT } });
      assert.deepEqual([again.status, again.json.chatKey, again.json.started], [200, opened.json.chatKey, false]);

      const TIDY = '/api/settings/project-tidy';
      assert.equal((await call('GET', `${TIDY}?projectId=${PROJECT}`, { auth: false })).status, 401);
      assert.equal((await call('POST', TIDY, { body: { projectId: PROJECT, tidy: 'no' } })).status, 400);
      assert.equal((await call('POST', TIDY, { body: { projectId: 'nope', tidy: false } })).status, 404);
      assert.deepEqual((await call('GET', `${TIDY}?projectId=${PROJECT}`)).json, { ok: true, tidy: false });
      assert.deepEqual((await call('POST', TIDY, { body: { projectId: PROJECT, tidy: true } })).json, { ok: true, tidy: true });
      assert.deepEqual((await call('GET', `${TIDY}?projectId=${PROJECT}`)).json, { ok: true, tidy: true });
      assert.deepEqual((await call('POST', TIDY, { body: { projectId: PROJECT, tidy: false } })).json, { ok: true, tidy: false });
      assert.deepEqual((await call('GET', `${TIDY}?projectId=${PROJECT}`)).json, { ok: true, tidy: false });
      assert.equal(readTidy(smDir, root), false);
    } finally {
      await new Promise((resolve) => app.close(resolve));
    }
  });
});
