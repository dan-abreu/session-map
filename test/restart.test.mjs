import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RESUME_FILE, createRestarter, decideRestart, joinRequest, listenWithRetry, resumeAfterRestart, resumeNote,
} from '../server/restart.mjs';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { alertText, groupAlerts } from '../server/web/alerts.js';
import { translator } from '../server/web/i18n.js';

// The agreed restart (sv13): a conversation asks session-map for a fresh start instead of killing it; the restart waits
// until no page chat is mid-turn (or the deadline), writes down the chats, closes, starts a detached copy and exits; the
// copy resumes the chats. Everything here runs on fakes: nothing spawns a server or exits the test process.

const MIN = 60_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const KEY_C = 'c'.repeat(32);
const KEY_D = 'd'.repeat(32);
const AUTONOMOUS = { kind: 'autonomous' };
const NOW = Date.parse('2026-10-11T12:00:00.000Z');

const tempDir = () => mkdtempSync(join(tmpdir(), 'sm-restart-'));

// The clock, the 2 s check, spawn and exit as fakes; calls keeps the order of what the restart did.
function fakeWorld() {
  const calls = [];
  const timers = [];
  const w = {
    calls, timers, clock: NOW,
    now: () => w.clock,
    every: (fn, ms) => {
      const t = { fn, ms, stopped: false, unref() { t.unrefd = true; return t; } };
      timers.push(t);
      return t;
    },
    stopEvery: (t) => { if (t) t.stopped = true; },
    // As a real child: 'spawn' comes a moment after spawn() returns.
    spawn: (cmd, args, opts) => {
      calls.push(['spawn', cmd, args, opts]);
      const child = new EventEmitter();
      child.unref = () => calls.push(['unref']);
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    exit: (code) => calls.push(['exit', code]),
    // Every live check, as the interval would run it; the restart it fires is awaited.
    tick: () => Promise.all(timers.filter((t) => !t.stopped).map((t) => t.fn())),
  };
  return w;
}

// The part of the chat hub the restart talks to.
function fakeHub(w, chats = []) {
  const hub = {
    chats, held: false,
    hold(on) { hub.held = on; },
    turning: () => chats.filter((c) => c.running).length,
    restartList: () => chats.map((c) => ({ ...c })),
    close: async () => { w.calls.push(['hub-close']); },
  };
  return hub;
}

const restarterFor = (w, hub, smDir, extra = {}) => createRestarter({
  hub, smDir, now: w.now, every: w.every, stopEvery: w.stopEvery, spawn: w.spawn, exit: w.exit,
  execPath: '/node', argv: ['/sm/server/main.mjs', '--lan'], env: { PATH: '/bin' },
  closeServer: async () => { w.calls.push(['close-server', existsSync(join(smDir, RESUME_FILE))]); },
  ...extra,
});

test('decideRestart waits while a page chat is mid-turn and fires when all are idle or at the deadline', () => {
  const pending = { reasons: ['x'], keys: [], at: 0, deadline: 10 * MIN };
  assert.equal(decideRestart({ pending: null, turning: 0, now: 0 }), 'none');
  assert.equal(decideRestart({ pending, turning: 2, now: MIN }), 'wait');
  assert.equal(decideRestart({ pending, turning: 0, now: MIN }), 'now');
  assert.equal(decideRestart({ pending, turning: 1, now: 10 * MIN }), 'now', 'at the deadline it goes even mid-turn');
});

test('joinRequest: the first request sets a deadline 10 minutes ahead, a later one joins it', () => {
  const first = joinRequest(null, { reason: 'reload the hub', chatKey: KEY_A, now: 1000 });
  assert.equal(first.already, false);
  assert.deepEqual(first.pending, { reasons: ['reload the hub'], keys: [KEY_A], at: 1000, deadline: 1000 + 10 * MIN });
  const second = joinRequest(first.pending, { reason: 'a new route', chatKey: null, now: 5000 });
  assert.equal(second.already, true);
  assert.deepEqual(second.pending, { reasons: ['reload the hub', 'a new route'], keys: [KEY_A], at: 1000, deadline: 1000 + 10 * MIN });
});

test('the note a resumed chat gets says why, and whose request it was', () => {
  assert.equal(resumeNote(['reload the hub'], { asked: false }),
    '[session-map restarted at the request of another conversation (reload the hub). Continue where you left off; if you were in the middle of a step, check its result first.]');
  assert.equal(resumeNote(['reload the hub', 'a new route'], { asked: true }),
    '[session-map restarted at your request (reload the hub; a new route). Continue where you left off; if you were in the middle of a step, check its result first.]');
});

test('a request holds new turns and waits for the chat mid-turn; then it writes the chats down, closes, starts a detached copy and exits', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [
      { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: true, held: false },
      { sessionId: B, key: KEY_B, projectId: 'shop', run: { kind: 'auto', selfReinforce: false }, running: false, held: true },
    ];
    const hub = fakeHub(w, chats);
    const r = restarterFor(w, hub, smDir);
    const answer = r.request({ reason: 'Reload after editing hub.mjs', chatKey: KEY_B });
    assert.deepEqual(answer, { scheduled: true, waitingFor: 1, deadline: new Date(NOW + 10 * MIN).toISOString() });
    assert.equal(hub.held, true, 'no new turn starts while it waits');
    assert.equal(w.timers.length, 1);
    assert.equal(w.timers[0].ms, 2000, 'checked every 2 s');
    assert.ok(w.timers[0].unrefd, 'the check never keeps the process alive');

    w.clock += 4000;
    await w.tick();
    assert.deepEqual(w.calls, [], 'a chat is mid-turn: it waits');
    assert.ok(!existsSync(join(smDir, RESUME_FILE)));

    chats[0].running = false;
    w.clock += 2000;
    await w.tick();
    assert.deepEqual(w.calls.map((c) => c[0]), ['close-server', 'hub-close', 'spawn', 'unref', 'exit']);
    assert.equal(w.calls[0][1], true, 'the resume file is on disk before anything closes');
    const [, cmd, args, opts] = w.calls[2];
    assert.equal(cmd, '/node');
    assert.deepEqual(args, ['/sm/server/main.mjs', '--lan'], 'the same arguments as this process');
    assert.deepEqual(opts, { detached: true, stdio: 'ignore', windowsHide: true, env: { PATH: '/bin', SM_RESTARTED: '1' } });
    assert.deepEqual(w.calls[4], ['exit', 0]);
    assert.ok(w.timers[0].stopped);

    const saved = JSON.parse(readFileSync(join(smDir, RESUME_FILE), 'utf8'));
    assert.deepEqual(saved, {
      version: 1, at: new Date(w.clock).toISOString(), reasons: ['Reload after editing hub.mjs'],
      chats: [
        { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: false, held: false, asked: false },
        { sessionId: B, key: KEY_B, projectId: 'shop', run: { kind: 'auto', selfReinforce: false }, running: false, held: true, asked: true },
      ],
    });

    assert.deepEqual(r.request({ reason: 'again' }), { scheduled: true, already: true }, 'once it goes, a request only joins');
    await w.tick();
    assert.equal(w.calls.filter((c) => c[0] === 'spawn').length, 1, 'one restart, never two');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('several requests join the one waiting; at the deadline it goes with the chat still mid-turn', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const chats = [{ sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: true, held: false }];
    const r = restarterFor(w, fakeHub(w, chats), smDir);
    r.request({ reason: 'first' });
    w.clock += MIN;
    assert.deepEqual(r.request({ reason: 'second', chatKey: KEY_A }), { scheduled: true, already: true });
    assert.equal(w.timers.length, 1, 'one check for the restart they share');

    w.clock = NOW + 10 * MIN - 1;
    await w.tick();
    assert.deepEqual(w.calls, []);
    w.clock = NOW + 10 * MIN;
    await w.tick();
    assert.ok(w.calls.some((c) => c[0] === 'spawn'));
    const saved = JSON.parse(readFileSync(join(smDir, RESUME_FILE), 'utf8'));
    assert.deepEqual(saved.reasons, ['first', 'second']);
    assert.deepEqual(saved.chats.map((c) => [c.running, c.asked]), [[true, true]], 'cut off mid-turn, and it was one of those who asked');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the reason is trimmed, cut short and masked: the resume file never holds a secret', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const r = restarterFor(w, fakeHub(w), smDir);
    r.request({ reason: `  deploy with OPENAI_API_KEY=sk-proj-ABCDEFGH12345678 now\n${'x'.repeat(500)}`, chatKey: '../../etc' });
    await w.tick();
    const text = readFileSync(join(smDir, RESUME_FILE), 'utf8');
    assert.ok(!text.includes('ABCDEFGH12345678'), text);
    const saved = JSON.parse(text);
    assert.ok(saved.reasons[0].startsWith('deploy with OPENAI_API_KEY='));
    assert.ok(saved.reasons[0].length <= 300);
    assert.ok(!/\n/.test(saved.reasons[0]));
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a failed spawn is logged and the process still exits, so the plugin can start it again', async () => {
  const smDir = tempDir();
  try {
    const w = fakeWorld();
    const r = restarterFor(w, fakeHub(w), smDir, { spawn: () => { throw new Error('EPERM'); } });
    r.request({ reason: 'x' });
    await w.tick();
    assert.deepEqual(w.calls.map((c) => c[0]), ['close-server', 'hub-close', 'exit']);
    assert.deepEqual(w.calls.at(-1), ['exit', 1]);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the old process exits only once the copy has started; a spawn that fails later (EPERM, ENOENT) is logged and exits 1', async () => {
  const smDir = tempDir();
  try {
    for (const [event, code] of [['spawn', 0], ['error', 1]]) {
      const w = fakeWorld();
      const spawn = (cmd) => {
        w.calls.push(['spawn', cmd]);
        const child = new EventEmitter();
        child.unref = () => w.calls.push(['unref']);
        setTimeout(() => { w.calls.push([`child-${event}`]); child.emit(event, event === 'error' ? Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }) : undefined); }, 10);
        return child;
      };
      const r = restarterFor(w, fakeHub(w), smDir, { spawn });
      r.request({ reason: 'x' });
      await w.tick();
      assert.deepEqual(w.calls.map((c) => c[0]).filter((c) => c !== 'unref'), ['close-server', 'hub-close', 'spawn', `child-${event}`, 'exit'], event);
      assert.deepEqual(w.calls.at(-1), ['exit', code], event);
    }
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

const savedFile = (smDir, extra = {}) => writeFileSync(join(smDir, RESUME_FILE), JSON.stringify({
  version: 1, at: new Date(NOW - MIN).toISOString(), reasons: ['Reload after editing hub.mjs'],
  chats: [
    { sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: true, held: false, asked: false },
    { sessionId: B, key: KEY_B, projectId: 'shop', run: AUTONOMOUS, running: false, held: false, asked: true },
    { sessionId: C, key: KEY_C, projectId: 'shop', run: { kind: 'auto', selfReinforce: false }, running: false, held: false, asked: false },
    { sessionId: D, key: KEY_D, projectId: 'blog', run: AUTONOMOUS, running: false, held: true, asked: false },
  ],
  ...extra,
}));

const STATE = { projects: [{ id: 'shop', name: 'shop', conversations: [{ sessionId: B, title: 'Fix the login' }] }, { id: 'blog', name: 'blog', conversations: [] }] };

test('the new process resumes the chats cut mid-turn, held or asking with the note, then the idle ones without a message, and tells the owner', async () => {
  const smDir = tempDir();
  try {
    savedFile(smDir);
    const started = [];
    const hub = { start: async (body, state) => { started.push({ body, state }); return { status: 200, body: { ok: true, chatKey: 'k' } }; } };
    const alerts = [];
    const resuming = new Set();
    const done = resumeAfterRestart({ smDir, hub, readState: async () => STATE, onAlert: (a) => alerts.push(a), now: () => NOW, resuming });
    assert.deepEqual([...resuming].sort(), [A, B, C, D], 'known at once, so the watcher\'s first look does not call them cut off');
    assert.ok(!existsSync(join(smDir, RESUME_FILE)), 'read once, then deleted');
    assert.deepEqual(await done, { resumed: 4, left: 0 });
    const note = resumeNote(['Reload after editing hub.mjs'], { asked: false });
    assert.deepEqual(started.map((s) => s.body), [
      { projectId: 'shop', sessionId: A, cut: true, run: AUTONOMOUS, text: note },
      { projectId: 'shop', sessionId: B, run: AUTONOMOUS, text: resumeNote(['Reload after editing hub.mjs'], { asked: true }) },
      { projectId: 'blog', sessionId: D, run: AUTONOMOUS, text: note },
      { projectId: 'shop', sessionId: C, run: { kind: 'auto', selfReinforce: false }, idle: true },
    ], 'the idle one last, driven again without a message');
    assert.ok(started.every((s) => s.state === STATE));
    assert.deepEqual(alerts, [{
      kind: 'finished', reason: 'restarted', projectId: 'shop', projectName: 'shop', sessionId: B, title: 'Fix the login', origin: 'map',
      resumed: 4, because: 'Reload after editing hub.mjs',
    }]);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('resuming goes one chat at a time and stops at the hub\'s limit of chats', async () => {
  const smDir = tempDir();
  try {
    savedFile(smDir);
    let active = 0;
    let most = 0;
    const tried = [];
    const hub = {
      start: async (body) => {
        tried.push(body.sessionId);
        active += 1;
        most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return tried.length === 2 ? { status: 429, body: { ok: false, error: 'too-many-chats' } } : { status: 200, body: { ok: true } };
      },
    };
    const alerts = [];
    assert.deepEqual(await resumeAfterRestart({ smDir, hub, readState: async () => STATE, onAlert: (a) => alerts.push(a), now: () => NOW }), { resumed: 1, left: 3 });
    assert.equal(most, 1, 'one at a time');
    assert.deepEqual(tried, [A, B], 'past the limit no more are tried');
    assert.equal(alerts[0].resumed, 1);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('it waits for the port before resuming, and a request from outside the page is told as such', async () => {
  const smDir = tempDir();
  try {
    savedFile(smDir, { chats: [{ sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: true, held: false, asked: false }] });
    const started = [];
    const hub = { start: async (body) => { started.push(body.sessionId); return { status: 200, body: { ok: true } }; } };
    let open;
    const after = new Promise((resolve) => { open = resolve; });
    const alerts = [];
    const done = resumeAfterRestart({ smDir, hub, readState: async () => STATE, onAlert: (a) => alerts.push(a), now: () => NOW, after });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(started, [], 'nothing starts before the new server listens');
    open();
    await done;
    assert.deepEqual(started, [A]);
    assert.deepEqual(alerts, [{ kind: 'finished', reason: 'restarted', projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '', resumed: 1, because: 'Reload after editing hub.mjs' }]);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('an old, broken or missing resume file resumes nothing and is removed', async () => {
  const smDir = tempDir();
  try {
    const hub = { start: async () => assert.fail('nothing is resumed') };
    const alerts = [];
    const opts = { smDir, hub, readState: async () => STATE, onAlert: (a) => alerts.push(a), now: () => NOW };
    assert.equal(await resumeAfterRestart(opts), null, 'no file: a plain start');
    savedFile(smDir, { at: new Date(NOW - 16 * MIN).toISOString() });
    assert.equal(await resumeAfterRestart(opts), null, 'older than 15 minutes');
    assert.ok(!existsSync(join(smDir, RESUME_FILE)));
    writeFileSync(join(smDir, RESUME_FILE), '{"version":1,"at":');
    assert.equal(await resumeAfterRestart(opts), null);
    assert.ok(!existsSync(join(smDir, RESUME_FILE)));
    savedFile(smDir, { chats: [{ sessionId: '../x', projectId: 'shop', running: true }, { sessionId: B, projectId: 7, running: true }] });
    assert.deepEqual(await resumeAfterRestart(opts), { resumed: 0, left: 0 }, 'entries that are not chats are left out');
    assert.deepEqual(alerts.map((a) => a.resumed), [0], 'the restart itself is still told');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the restart alert says who asked, why and how many went back to work, in both languages', () => {
  const alert = { id: 1, kind: 'finished', reason: 'restarted', projectId: 'shop', projectName: 'shop', sessionId: B, title: 'Fix the login', origin: 'map', resumed: 2, because: 'reload the hub' };
  for (const lang of ['en', 'pt-BR']) {
    const w = alertText(translator(lang), groupAlerts([alert])[0]);
    for (const field of ['what', 'why', 'todo']) assert.ok(w[field] && !/[{}]|^alert\./.test(w[field]), `${lang} ${field}: ${w[field]}`);
    assert.match(w.why, /reload the hub/);
    assert.match(w.why, /2/);
    assert.match(w.body, /Fix the login/);
  }
});

class FakeListener extends EventEmitter {
  constructor(busyTries) {
    super();
    this.busyTries = busyTries;
    this.tries = 0;
  }

  listen() {
    this.tries += 1;
    const busy = this.tries <= this.busyTries;
    setImmediate(() => (busy ? this.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' })) : this.emit('listening')));
    return this;
  }
}

test('a restarted server tries the port again while the old one frees it, within a window', async () => {
  let clock = 0;
  const later = (fn, ms) => { clock += ms; setImmediate(fn); };
  const freed = new FakeListener(2);
  const listening = new Promise((resolve) => freed.once('listening', resolve));
  listenWithRetry(freed, { port: 4001, host: '127.0.0.1', retryMs: 10_000, now: () => clock, later });
  await listening;
  assert.equal(freed.tries, 3);
  assert.equal(freed.listenerCount('error'), 0, 'once it listens, an error is the server\'s own again');

  clock = 0;
  const failed = [];
  const stuck = new FakeListener(Infinity);
  listenWithRetry(stuck, { port: 4001, host: '127.0.0.1', retryMs: 2000, now: () => clock, later, fail: (err) => failed.push(err.code) });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(failed, ['EADDRINUSE'], 'past the window it gives up');
  assert.equal(stuck.tries, 5, 'every half second for 2 s');

  const plain = new FakeListener(1);
  const once = [];
  listenWithRetry(plain, { port: 4001, host: '127.0.0.1', now: () => clock, later, fail: (err) => once.push(err.code) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([once, plain.tries], [['EADDRINUSE'], 1], 'a plain start never retries');
});

// POST /api/restart: the arsenal's lock (the header token or the page's cookie, loopback only, never in the demo).
async function withApp(opts, fn) {
  const dir = tempDir();
  const smDir = tempDir();
  const w = fakeWorld();
  const chats = [];
  const hub = {
    ...fakeHub(w, chats), drivingIds: () => new Set(), drivenIds: () => new Set(), interrupted: () => [],
  };
  hub.hold = (on) => { hub.held = on; };
  const app = createApp({
    dir, smDir, stateTtlMs: 0, collectFn: () => ({ generatedAt: new Date().toISOString(), projects: [] }),
    restart: { now: w.now, every: w.every, stopEvery: w.stopEvery, spawn: w.spawn, exit: w.exit, execPath: '/node', argv: ['/sm/server/main.mjs'] },
    ...(opts.demo ? { demo: true, token: 'x'.repeat(64) } : { chat: hub }),
    ...(opts.address ? { addressOf: () => opts.address } : {}),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = opts.demo ? 'x'.repeat(64) : loadToken(smDir);
  const call = (method, path, { auth, body } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, 'content-type': 'application/json' };
    if (auth === 'header') headers['x-session-map-token'] = token;
    if (typeof auth === 'object') headers['x-session-map-token'] = auth.header;
    if (auth === 'cookie') Object.assign(headers, { cookie: `sm_token=${token}`, origin: `http://127.0.0.1:${port}`, 'x-session-map': '1' });
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, hub, w, smDir, app, chats });
  } finally {
    if (app.listening) await new Promise((resolve) => { app.closeAllConnections?.(); app.close(resolve); });
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('POST /api/restart takes the stdio tool\'s header token or the page\'s cookie, and then restarts on fakes', async () => {
  await withApp({}, async ({ call, hub, w, smDir, app, chats }) => {
    chats.push({ sessionId: A, key: KEY_A, projectId: 'shop', run: AUTONOMOUS, running: true, held: false });
    const first = await call('POST', '/api/restart', { auth: 'header', body: { reason: 'Reload after editing hub.mjs', chatKey: KEY_A } });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { ok: true, scheduled: true, waitingFor: 1, deadline: new Date(NOW + 10 * MIN).toISOString() });
    assert.equal(hub.held, true);
    const second = await call('POST', '/api/restart', { auth: 'cookie', body: { reason: 'me too' } });
    assert.deepEqual([second.status, second.json], [200, { ok: true, scheduled: true, already: true }]);
    assert.match(readFileSync(join(smDir, 'actions.log'), 'utf8'), /"action":"restart"/);

    chats[0].running = false;
    await w.tick();
    assert.deepEqual(w.calls.map((c) => c[0]), ['hub-close', 'spawn', 'unref', 'exit']);
    assert.equal(app.listening, false, 'the port is free for the copy');
    const saved = JSON.parse(readFileSync(join(smDir, RESUME_FILE), 'utf8'));
    assert.deepEqual(saved.reasons, ['Reload after editing hub.mjs', 'me too']);
    assert.deepEqual(saved.chats.map((c) => [c.sessionId, c.asked]), [[A, true]]);
  });
});

test('POST /api/restart refuses a wrong key, another machine, a missing reason, other methods and the demo', async () => {
  await withApp({}, async ({ call, hub }) => {
    assert.equal((await call('POST', '/api/restart', { auth: { header: 'f'.repeat(64) }, body: { reason: 'x' } })).status, 401);
    assert.equal((await call('POST', '/api/restart', { body: { reason: 'x' } })).status, 403, 'no key, no page: refused');
    assert.equal((await call('POST', '/api/restart', { auth: 'header', body: { reason: '   ' } })).status, 400);
    assert.equal((await call('POST', '/api/restart', { auth: 'header', body: {} })).status, 400);
    assert.equal((await call('GET', '/api/restart', { auth: 'header' })).status, 404);
    assert.equal(hub.held, false, 'nothing was scheduled');
  });
  await withApp({ address: '192.168.0.9' }, async ({ call, hub }) => {
    assert.equal((await call('POST', '/api/restart', { auth: 'header', body: { reason: 'x' } })).status, 403);
    assert.equal(hub.held, false);
  });
  await withApp({ demo: true }, async ({ call, w }) => {
    assert.equal((await call('POST', '/api/restart', { auth: 'header', body: { reason: 'x' } })).status, 403);
    assert.equal((await call('POST', '/api/restart', { auth: 'cookie', body: { reason: 'x' } })).status, 403);
    assert.deepEqual(w.timers, [], 'never in the demo');
  });
});

test('a resume file that cannot be read or removed never stops the start', async () => {
  const smDir = tempDir();
  try {
    mkdirSync(join(smDir, RESUME_FILE));
    const hub = { start: async () => assert.fail('nothing is resumed') };
    assert.equal(await resumeAfterRestart({ smDir, hub, readState: async () => STATE, now: () => NOW }), null);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});
