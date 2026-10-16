import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { RESUME_FILE, createRestarter, decideRestart, resumeAfterRestart, resumeNote } from '../server/restart.mjs';
import { cutTeams, teamsNote } from '../server/chat/teams.mjs';
import { alertText, groupAlerts } from '../server/web/alerts.js';
import { translator } from '../server/web/i18n.js';

// sv16: a restart waits for the teams working in the background (a Workflow or a background helper writes under the
// conversation's subagents/ folder), up to an hour, and a chat whose team was cut anyway is told which one and how to
// resume it. Fake clocks and fake helper writes: nothing spawns a server or exits the test process.

const MIN = 60_000;
const NOW = Date.parse('2026-10-11T22:00:00.000Z');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const AUTO = { kind: 'talk' }; // the page chat: the brain's Conversa (id146)

const tempDir = () => mkdtempSync(join(tmpdir(), 'sm-teams-'));

function fakeWorld() {
  const calls = [];
  const timers = [];
  const w = {
    calls, timers, clock: NOW,
    now: () => w.clock,
    every: (fn, ms) => {
      const t = { fn, ms, stopped: false, unref() { return t; } };
      timers.push(t);
      return t;
    },
    stopEvery: (t) => { if (t) t.stopped = true; },
    spawn: (cmd) => {
      calls.push(['spawn', cmd]);
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    exit: (code) => calls.push(['exit', code]),
    tick: () => Promise.all(timers.filter((t) => !t.stopped).map((t) => t.fn())),
  };
  return w;
}

// helperAt: when the chat's helpers last wrote. teams() is the hub's look: the live chats whose helpers wrote lately.
function fakeHub(w, chats) {
  const hub = {
    held: false, looks: 0,
    hold(on) { hub.held = on; },
    turning: () => chats.filter((c) => c.running).length,
    teams: ({ now, quietMs }) => {
      hub.looks += 1;
      return chats.filter((c) => now - (c.helperAt ?? -Infinity) < quietMs).map((c) => c.sessionId);
    },
    restartList: () => chats.map(({ helperAt, ...c }) => ({ ...c })),
    close: async () => { w.calls.push(['hub-close']); },
  };
  return hub;
}

const restarterFor = (w, hub, smDir, extra = {}) => createRestarter({
  hub, smDir, now: w.now, every: w.every, stopEvery: w.stopEvery, spawn: w.spawn, exit: w.exit,
  execPath: '/node', argv: ['/sm/server/main.mjs'], env: {}, closeServer: async () => { w.calls.push(['close-server']); },
  ...extra,
});

const spawned = (w) => w.calls.some((c) => c[0] === 'spawn');

test('decideRestart waits while a team writes, then as before for the turns; past the teams\' limit it goes', () => {
  const pending = { reasons: ['x'], keys: [], at: 0, deadline: 10 * MIN, teamsUntil: 60 * MIN };
  assert.equal(decideRestart({ pending, turning: 0, teams: 1, now: MIN }), 'wait', 'a team still writes');
  assert.equal(decideRestart({ pending, turning: 0, teams: 0, now: MIN }), 'now');
  assert.equal(decideRestart({ pending, turning: 1, teams: 1, now: 30 * MIN }), 'wait', 'the turn deadline alone does not cut a writing team');
  assert.equal(decideRestart({ pending, turning: 0, teams: 2, now: 60 * MIN }), 'now', 'at the teams\' limit it goes');
  assert.equal(decideRestart({ pending, turning: 1, now: 10 * MIN }), 'now', 'no team: the sv13 rule stays');
});

test('a restart waits for a team writing in the background without holding the chats, tells the page and the asker why, and goes once the team is quiet', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [
      { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTO, running: false, held: false, helperAt: NOW - MIN },
      { sessionId: B, key: KEY_B, projectId: 'shop', run: AUTO, running: false, held: false },
    ];
    const hub = fakeHub(w, chats);
    const alerts = [];
    const r = restarterFor(w, hub, smDir, { onAlert: (a) => alerts.push(a) });
    const answer = r.request({ reason: 'Reload after editing hub.mjs', chatKey: KEY_B });
    assert.deepEqual(answer, {
      scheduled: true, waitingFor: 0, teams: 1, teamsUntil: new Date(NOW + 60 * MIN).toISOString(), deadline: new Date(NOW + 70 * MIN).toISOString(),
    });
    assert.equal(hub.held, false, 'the chats keep working while the team does');
    assert.deepEqual(alerts, [{
      kind: 'finished', reason: 'restart-waits', projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '', origin: 'map', teams: 1, because: 'Reload after editing hub.mjs',
    }]);
    assert.deepEqual(r.request({ reason: 'again' }), { scheduled: true, already: true, teams: 1, teamsUntil: new Date(NOW + 60 * MIN).toISOString() }, 'a later request learns why it waits');

    for (let i = 0; i < 10; i++) {
      w.clock += 30_000;
      chats[0].helperAt = w.clock - 1000;
      await w.tick();
    }
    assert.ok(!spawned(w), 'the team still writes: it waits');
    assert.ok(!existsSync(join(smDir, RESUME_FILE)));

    // The team ends: 5 quiet minutes later the restart holds the turns and goes.
    w.clock += 5 * MIN + 30_000;
    await w.tick();
    assert.equal(hub.held, true);
    assert.ok(spawned(w));
    assert.equal(alerts.length, 1, 'told once');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the look at the helpers\' files is taken at most every 15 s, not on every 2 s check', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [{ sessionId: A, key: KEY_A, projectId: 'shop', run: AUTO, running: false, held: false, helperAt: NOW }];
    const hub = fakeHub(w, chats);
    const r = restarterFor(w, hub, smDir);
    r.request({ reason: 'x' });
    const first = hub.looks;
    for (let i = 0; i < 7; i++) { w.clock += 2000; await w.tick(); }
    assert.ok(hub.looks - first <= 1, `looked ${hub.looks - first} times in 14 s`);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a team that never goes quiet is waited for an hour; then the turns are held and the chat mid-turn gets its 10 minutes', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [
      { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTO, running: false, held: false, helperAt: NOW },
      { sessionId: B, key: KEY_B, projectId: 'shop', run: AUTO, running: true, held: false },
    ];
    const hub = fakeHub(w, chats);
    const r = restarterFor(w, hub, smDir);
    r.request({ reason: 'x' });
    const writing = async (to) => { while (w.clock < to) { w.clock = Math.min(to, w.clock + MIN); chats[0].helperAt = w.clock; await w.tick(); } };
    await writing(NOW + 60 * MIN - 1);
    assert.equal(hub.held, false);
    assert.ok(!spawned(w));
    await writing(NOW + 60 * MIN);
    assert.equal(hub.held, true, 'past the hour no new turn starts');
    assert.ok(!spawned(w), 'a chat is mid-turn: it gets the usual 10 minutes');
    await writing(NOW + 70 * MIN);
    assert.ok(spawned(w));
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('with no team writing the restart holds at once, as before', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [{ sessionId: A, key: KEY_A, projectId: 'shop', run: AUTO, running: true, held: false, helperAt: NOW - 6 * MIN }];
    const hub = fakeHub(w, chats);
    const alerts = [];
    const r = restarterFor(w, hub, smDir, { onAlert: (a) => alerts.push(a) });
    assert.deepEqual(r.request({ reason: 'x' }), { scheduled: true, waitingFor: 1, deadline: new Date(NOW + 10 * MIN).toISOString() });
    assert.equal(hub.held, true);
    assert.deepEqual(alerts, [], 'nothing to tell');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

// A conversation's transcript as Claude Code writes it: the launch of a Workflow or a background helper, and the
// <task-notification> line once it ends (as a queue line, a user message or an attachment).
const at = (min) => new Date(NOW + min * MIN).toISOString();
const launchWf = (min, { taskId, runId, scriptPath, name }) => ({
  type: 'user', timestamp: at(min),
  toolUseResult: { status: 'async_launched', taskId, taskType: 'local_workflow', workflowName: name, runId, summary: `${name} summary`, transcriptDir: 'x', scriptPath },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${taskId}`, content: [{ type: 'text', text: 'launched' }] }] },
});
const launchAgent = (min, agentId, description) => ({
  type: 'user', timestamp: at(min),
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description, prompt: 'p', outputFile: 'o' },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${agentId}`, content: [{ type: 'text', text: 'launched' }] }] },
});
const notice = (id) => `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
const queued = (min, id) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(min), content: notice(id) });
const userNotice = (min, id) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content: notice(id) } });
const attached = (min, id) => ({ type: 'attachment', timestamp: at(min), attachment: { type: 'queued_command', prompt: notice(id) } });
const said = (min, text) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content: text } });

function writeSession(dir, sessionId, lines, metas = {}) {
  const folder = join(dir, 'projects', 'C--work-shop');
  mkdirSync(join(folder, sessionId, 'workflows'), { recursive: true });
  const file = join(folder, `${sessionId}.jsonl`);
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{"type":"user","trunc`);
  for (const [runId, meta] of Object.entries(metas)) writeFileSync(join(folder, sessionId, 'workflows', `${runId}.json`), JSON.stringify(meta));
  return file;
}

test('cutTeams names the workflows and background helpers that never finished, and nothing else', () => {
  const dir = tempDir();
  try {
    const script = (id) => `C:\\Users\\me\\.claude\\projects\\C--work-shop\\${A}\\workflows\\scripts\\plan-${id}.js`;
    const file = writeSession(dir, A, [
      launchWf(-30 * 60, { taskId: 'old1', runId: 'wf_00000000-old', scriptPath: script('wf_00000000-old'), name: 'ancient' }),
      launchWf(-50, { taskId: 't1', runId: 'wf_11111111-aaa', scriptPath: script('wf_11111111-aaa'), name: 'done-by-notice' }),
      launchWf(-45, { taskId: 't2', runId: 'wf_22222222-bbb', scriptPath: script('wf_22222222-bbb'), name: 'cut' }),
      launchWf(-44, { taskId: 't3', runId: 'wf_33333333-ccc', scriptPath: script('wf_33333333-ccc'), name: 'done-by-meta' }),
      launchWf(-43, { taskId: 't4', runId: 'wf_44444444-ddd', scriptPath: script('wf_44444444-ddd'), name: 'resumed' }),
      launchWf(-20, { taskId: 't5', runId: 'wf_44444444-ddd', scriptPath: script('wf_44444444-ddd'), name: 'resumed' }),
      launchAgent(-40, 'acut1', 'Check the tax table'),
      launchAgent(-39, 'adone2', 'List polish'),
      launchAgent(-38, 'adone3', 'Read the docs'),
      launchAgent(-37, 'adone4', 'Count the files'),
      queued(-30, 't1'), userNotice(-29, 'adone2'), attached(-28, 'adone3'), queued(-27, 'adone4'), queued(-26, 't4'),
      said(-10, `Why did it stop? ${notice('t2')} was what I saw`),
    ], { 'wf_33333333-ccc': { runId: 'wf_33333333-ccc', taskId: 't3', status: 'completed' }, 'wf_44444444-ddd': { runId: 'wf_44444444-ddd', taskId: 't4', status: 'completed' } });
    const teams = cutTeams(file, { since: NOW - 24 * 60 * MIN });
    assert.deepEqual(teams.workflows, [
      { runId: 'wf_22222222-bbb', taskId: 't2', name: 'cut', scriptPath: script('wf_22222222-bbb') },
      { runId: 'wf_44444444-ddd', taskId: 't5', name: 'resumed', scriptPath: script('wf_44444444-ddd') },
    ], 'a meta file of an earlier attempt does not close the resumed one; a quoted notice is no notice');
    assert.deepEqual(teams.agents, [{ agentId: 'acut1', taskId: 'acut1', description: 'Check the tax table' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the "stopped" Claude Code writes on a resume after its process died is a cut, and a run\'s file still running is no end', () => {
  const dir = tempDir();
  try {
    const died = (min, id) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(min), content: `<task-notification>\n<task-id>${id}</task-id>\n<status>stopped</status>\n<summary>Background workflow "plan" (run wf_11111111-aaa) didn't finish before the previous session ended</summary>\n</task-notification>` });
    const stopped = (min, id) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(min), content: `<task-notification>\n<task-id>${id}</task-id>\n<status>stopped</status>\n<summary>Stopped by the person</summary>\n</task-notification>` });
    const file = writeSession(dir, A, [
      launchWf(-50, { taskId: 't1', runId: 'wf_11111111-aaa', scriptPath: 's1.js', name: 'died' }),
      launchWf(-40, { taskId: 't2', runId: 'wf_22222222-bbb', scriptPath: 's2.js', name: 'still running' }),
      launchWf(-30, { taskId: 't3', runId: 'wf_33333333-ccc', scriptPath: 's3.js', name: 'stopped by the person' }),
      died(-20, 't1'), stopped(-10, 't3'),
    ], { 'wf_22222222-bbb': { runId: 'wf_22222222-bbb', taskId: 't2', status: 'running' } });
    assert.deepEqual(cutTeams(file, { since: 0 }).workflows.map((w) => w.runId), ['wf_11111111-aaa', 'wf_22222222-bbb']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cutTeams finds nothing in a conversation whose teams all ended, or one with no transcript', () => {
  const dir = tempDir();
  try {
    const file = writeSession(dir, A, [launchWf(-5, { taskId: 't1', runId: 'wf_11111111-aaa', scriptPath: 's.js', name: 'n' }), queued(-1, 't1')]);
    assert.deepEqual(cutTeams(file, { since: 0 }), { workflows: [], agents: [] });
    assert.deepEqual(cutTeams(join(dir, 'missing.jsonl'), { since: 0 }), { workflows: [], agents: [] });
    assert.equal(teamsNote({ workflows: [], agents: [] }), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the note for a cut team gives the run id, the script and the resume call, names the cut helpers, and asks to tell the person', () => {
  const scriptPath = 'C:\\Users\\me\\.claude\\projects\\x\\s\\workflows\\scripts\\plan-wf_22222222-bbb.js';
  const note = teamsNote({ workflows: [{ runId: 'wf_22222222-bbb', taskId: 't2', name: 'plan', scriptPath }], agents: [{ agentId: 'acut1', taskId: 'acut1', description: 'Check the tax table' }] });
  assert.match(note, /wf_22222222-bbb/);
  assert.ok(note.includes(`Workflow({scriptPath: ${JSON.stringify(scriptPath)}, resumeFromRunId: "wf_22222222-bbb"})`), note);
  assert.match(note, /cache/);
  assert.match(note, /acut1 \("Check the tax table"\)/);
  assert.match(note, /tell the person/i);
  assert.match(note, /ask the person before/i, 'costly or outside effects are not repeated blindly');
});

test('after the restart a chat that was between turns but had a team cut is resumed with a note, not idle; the others stay idle', async () => {
  const smDir = tempDir();
  try {
    writeFileSync(join(smDir, RESUME_FILE), JSON.stringify({
      version: 1, at: new Date(NOW - MIN).toISOString(), reasons: ['Reload after editing hub.mjs'],
      chats: [
        { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTO, running: false, held: false, asked: false },
        { sessionId: B, key: KEY_B, projectId: 'shop', run: AUTO, running: false, held: false, asked: false },
      ],
    }));
    const cut = { workflows: [{ runId: 'wf_22222222-bbb', taskId: 't2', name: 'plan', scriptPath: 's.js' }], agents: [] };
    const started = [];
    const hub = {
      cutTeams: (sessionId) => (sessionId === B ? cut : { workflows: [], agents: [] }),
      start: async (body, state, internal) => { started.push({ body, internal }); return { status: 200, body: { ok: true } }; },
    };
    await resumeAfterRestart({ smDir, hub, readState: async () => ({ projects: [] }), now: () => NOW });
    assert.deepEqual(started.map((s) => s.body), [
      { projectId: 'shop', sessionId: B, run: AUTO, text: resumeNote(['Reload after editing hub.mjs'], { asked: false }) },
      { projectId: 'shop', sessionId: A, run: AUTO, idle: true },
    ]);
    assert.deepEqual(started[0].internal, { restart: true, teams: cut }, 'the hub gets the teams it adds to the note');
    assert.deepEqual(started[1].internal, { restart: true });
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the page tells in plain words that a restart waits for the teams, in both languages', () => {
  const alert = { id: 1, kind: 'finished', reason: 'restart-waits', projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '', origin: 'map', teams: 2, because: 'reload the hub' };
  for (const lang of ['en', 'pt-BR']) {
    const w = alertText(translator(lang), groupAlerts([alert])[0]);
    for (const field of ['what', 'why', 'todo']) assert.ok(w[field] && !/[{}]|^alert\./.test(w[field]), `${lang} ${field}: ${w[field]}`);
    assert.match(w.why, /reload the hub/);
    assert.match(w.why, /2/);
  }
});

// The hub's side, with the fake claude (it echoes what it is sent): a conversation resumed in a new process hears which
// of its teams were cut, once.
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

test('the hub adds the cut teams to the message that resumes a conversation, once, and the person\'s own words show as they were', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-teams-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-teams-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, snapshot: async () => null });
  try {
    writeSession(root, A, [
      launchWf(-5, { taskId: 't2', runId: 'wf_22222222-bbb', scriptPath: 'C:\\x\\plan-wf_22222222-bbb.js', name: 'plan' }),
      launchAgent(-4, 'acut1', 'Check the tax table'),
    ].map((l) => ({ ...l, timestamp: new Date(Date.now() - 5 * MIN).toISOString() })));
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [A]: { projectId: 'demo-abc123', partId: 'auth', cwd: root, root, run: AUTO, prompted: 'auto', running: false, title: 'Fix the login', startedAt: new Date().toISOString() },
    }));
    const state = {
      projects: [{ id: 'demo-abc123', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [{ sessionId: A, title: 'Fix the login', chattable: true, live: false, card: null }] }],
    };
    Object.defineProperty(state, INTERNALS, { value: { chats: new Map([[A, { projectId: 'demo-abc123', root, cwd: root, pid: null }]]) }, enumerable: false });

    const replyTo = async (text) => {
      const res = await hub.start({ projectId: 'demo-abc123', sessionId: A, run: AUTO, text }, state);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const events = [];
      let done;
      const ended = new Promise((resolve) => { done = resolve; });
      hub.subscribe(res.body.chatKey, { write: (e) => { events.push(e); if (e.type === 'turn-end') done(); }, end() {} });
      await ended;
      await hub.closeIdle(A);
      return { shown: events.find((e) => e.type === 'user').data.text, reply: events.filter((e) => e.type === 'text').map((e) => e.data.text).join('\n') };
    };
    const first = await replyTo('Go on');
    assert.equal(first.shown, 'Go on', 'the page shows the person\'s words');
    assert.ok(first.reply.includes('wf_22222222-bbb') && first.reply.includes('resumeFromRunId') && first.reply.includes('acut1'), first.reply);
    const second = await replyTo('And now?');
    assert.ok(!second.reply.includes('wf_22222222-bbb'), 'told once');
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('the hub counts a live chat\'s team at work while its helpers write, or while a launch of its process has not ended', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-teams-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-teams-sm-'));
  let wrote = 0;
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, snapshot: async () => null, helperWrite: () => wrote });
  try {
    const launched = { ...launchWf(0, { taskId: 't9', runId: 'wf_99999999-zzz', scriptPath: 's.js', name: 'long tests' }), timestamp: new Date(Date.now() + MIN).toISOString() };
    writeSession(root, A, []);
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [A]: { projectId: 'demo-abc123', partId: 'auth', cwd: root, root, run: AUTO, prompted: 'auto', running: false, title: 'Fix the login', startedAt: new Date().toISOString() },
    }));
    const state = {
      projects: [{ id: 'demo-abc123', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [{ sessionId: A, title: 'Fix the login', chattable: true, live: false, card: null }] }],
    };
    Object.defineProperty(state, INTERNALS, { value: { chats: new Map([[A, { projectId: 'demo-abc123', root, cwd: root, pid: null }]]) }, enumerable: false });
    const res = await hub.start({ projectId: 'demo-abc123', sessionId: A, run: AUTO, text: 'Go on' }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await new Promise((resolve) => hub.subscribe(res.body.chatKey, { write: (e) => { if (e.type === 'turn-end') resolve(); }, end() {} }));
    const look = () => hub.teams({ now: Date.now(), quietMs: 5 * MIN });
    assert.deepEqual(look(), [], 'nothing launched, nothing written');
    wrote = Date.now() - MIN;
    assert.deepEqual(look(), [A], 'its helpers wrote a minute ago');
    wrote = Date.now() - 10 * MIN;
    writeSession(root, A, [launched]);
    assert.deepEqual(look(), [A], 'quiet, but its workflow never ended');
    writeSession(root, A, [launched, { ...queued(0, 't9'), timestamp: new Date(Date.now() + 2 * MIN).toISOString() }]);
    assert.deepEqual(look(), [], 'the workflow ended');
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('a run whose file says stopped but whose notice says it died with its process is still a cut one', () => {
  const dir = tempDir();
  try {
    const died = { type: 'queue-operation', operation: 'enqueue', timestamp: at(-5), content: '<task-notification>\n<task-id>t1</task-id>\n<status>stopped</status>\n<summary>Background workflow "plan" (run wf_11111111-aaa) didn\'t finish before the previous session ended</summary>\n</task-notification>' };
    const file = writeSession(dir, A, [launchWf(-50, { taskId: 't1', runId: 'wf_11111111-aaa', scriptPath: 's1.js', name: 'plan' }), died],
      { 'wf_11111111-aaa': { runId: 'wf_11111111-aaa', taskId: 't1', status: 'stopped' } });
    assert.deepEqual(cutTeams(file, { since: 0 }).workflows.map((w) => w.runId), ['wf_11111111-aaa']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a note with many cut helpers still names every one of them: it is told only once', () => {
  const dir = tempDir();
  try {
    const ids = Array.from({ length: 12 }, (_, i) => `acut${i}`);
    const file = writeSession(dir, A, ids.map((id, i) => launchAgent(-30 + i, id, `job ${i}`)));
    const teams = cutTeams(file, { since: 0 });
    assert.equal(teams.agents.length, 12);
    const note = teamsNote(teams);
    for (const id of ids) assert.ok(note.includes(id), id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
