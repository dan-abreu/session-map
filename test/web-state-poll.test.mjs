import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../server/web/api.js';
import { stateSigs } from '../server/web/statesig.js';
import { alertsDue } from '../server/web/alerts.js';

// Each answer: { status, body, headers }; the calls keep what the page sent.
async function withFetch(answers, fn) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    const a = answers.shift();
    const headers = new Map(Object.entries(a.headers ?? {}));
    return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, json: async () => { if (a.body === undefined) throw new SyntaxError('empty'); return a.body; } };
  };
  try { await fn(calls); } finally { globalThis.fetch = saved; }
}

test('api.state remembers the ETag, sends it back, and a 304 comes back as "same" with the fresh time (sv09)', async () => {
  await withFetch([
    { status: 200, body: { projects: [] }, headers: { etag: '"v1"' } },
    { status: 304, headers: { etag: '"v1"', 'x-generated-at': '2026-10-10T10:00:00.000Z' } },
    { status: 200, body: { projects: [], refreshing: true } },
    { status: 200, body: { projects: [] }, headers: { etag: '"v2"' } },
  ], async (calls) => {
    const first = await api.state();
    assert.equal(first.ok, true);
    assert.equal(first.same, undefined);
    assert.equal(calls[0].init.headers['if-none-match'], undefined, 'the first ask has nothing to compare');
    const same = await api.state();
    assert.equal(calls[1].init.headers['if-none-match'], '"v1"');
    assert.deepEqual(same, { ok: true, status: 304, same: true, generatedAt: '2026-10-10T10:00:00.000Z' });
    const copy = await api.state();
    assert.equal(copy.refreshing, true);
    await api.state();
    assert.equal(calls[3].init.headers['if-none-match'], undefined, 'an answer with no tag (the disk copy) is never kept as current');
  });
});

test('api.state keeps its tag across a failed ask', async () => {
  await withFetch([
    { status: 200, body: { projects: [] }, headers: { etag: '"v9"' } },
    { status: 500, body: { error: 'boom' } },
    { status: 304, headers: { etag: '"v9"' } },
  ], async (calls) => {
    await api.state();
    assert.equal((await api.state()).ok, false);
    assert.equal((await api.state()).same, true);
    assert.equal(calls[2].init.headers['if-none-match'], '"v9"');
  });
});

const project = (id, extra = {}) => ({ id, name: id, chats: [], ...extra });
const stateOf = (projects, extra = {}) => ({ generatedAt: '2026-10-10T10:00:05.000Z', waitingCount: 0, projects, ...extra });

test('stateSigs: a change in another project leaves the open project\'s signature alone (mm44)', () => {
  const a = stateSigs(stateOf([project('a'), project('b')]), 'a');
  const otherMoved = stateSigs(stateOf([project('a'), project('b', { chats: [{ sessionId: 'x' }] })]), 'a');
  assert.equal(otherMoved.project, a.project);
  assert.notEqual(otherMoved.global, a.global);
  const openMoved = stateSigs(stateOf([project('a', { chats: [{ sessionId: 'y' }] }), project('b')]), 'a');
  assert.notEqual(openMoved.project, a.project);
});

test('stateSigs: seconds alone change nothing; a new minute or the refreshing mark redraw', () => {
  const a = stateSigs(stateOf([project('a')]), 'a');
  const later = stateSigs(stateOf([project('a')], { generatedAt: '2026-10-10T10:00:50.000Z' }), 'a');
  assert.deepEqual(later, a);
  const minute = stateSigs(stateOf([project('a')], { generatedAt: '2026-10-10T10:01:01.000Z' }), 'a');
  assert.notEqual(minute.project, a.project, 'relative times and working marks age by the minute');
  assert.notEqual(minute.global, a.global);
  const refreshing = stateSigs(stateOf([project('a')], { refreshing: true }), 'a');
  assert.notEqual(refreshing.project, a.project);
  assert.notEqual(refreshing.global, a.global);
});

test('alertsDue: a hidden page asks only when a browser alert could fire, and otherwise every sixth tick', () => {
  assert.equal(alertsDue({ hidden: false, notifying: false, tick: 1 }), true);
  assert.equal(alertsDue({ hidden: true, notifying: true, tick: 1 }), true);
  assert.equal(alertsDue({ hidden: true, notifying: false, tick: 1 }), false);
  assert.equal(alertsDue({ hidden: true, notifying: false, tick: 6 }), true, 'the tab title still counts what finished');
});

test('api.state never keeps the tag of a body it could not read: the next ask gets the whole state again', async () => {
  await withFetch([
    { status: 200, body: { projects: [] }, headers: { etag: '"good"' } },
    { status: 200, headers: { etag: '"cut"' } },
    { status: 200, body: { projects: [] }, headers: { etag: '"cut"' } },
  ], async (calls) => {
    await api.state();
    const cut = await api.state();
    assert.equal(cut.ok, false, 'a cut body is a failed ask, never an empty state');
    await api.state();
    assert.equal(calls[2].init.headers['if-none-match'], undefined, 'no tag is sent after a body that could not be read');
  });
});

test('alertsDue: a hidden page with the sound on asks every tick, since its beep plays even while hidden', () => {
  assert.equal(alertsDue({ hidden: true, notifying: false, sound: true, tick: 1 }), true);
  assert.equal(alertsDue({ hidden: true, notifying: false, sound: false, tick: 1 }), false);
});

test('alerts.js passes the sound preference to alertsDue', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server/web/alerts.js', import.meta.url), 'utf8');
  assert.match(src, /alertsDue\(\{[^}]*sound: current\(\)\.sound/);
});

test('app.js draws the "finished and not seen" marks itself when alerts add them: a 304 poll would redraw nothing', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('onAlerts: (fresh) =>'), src.indexOf('pending: () =>', src.indexOf('onAlerts: (fresh) =>')));
  assert.match(body, /renderNow\(\)/);
  assert.match(body, /convs\??\.render\(\)/);
});

// Rolling 7- and 30-day costs drop by themselves as old messages leave the window: alone they are not news.
const costly = (d7, d30) => ({
  generatedAt: '2026-10-10T10:00:05.000Z', totals: { today: 1, d7, d30 },
  projects: [{ id: 'a', cost: { today: 1, d7, d30 } }, { id: 'b', cost: { today: 0, d7: d7 / 2, d30: d30 / 2 } }],
});

test('stateSigs: rolling 7- and 30-day costs moving alone redraw nothing; today\'s cost does', () => {
  const before = stateSigs(costly(10, 30), 'a');
  assert.deepEqual(stateSigs(costly(9.9, 29.7), 'a'), before);
  const spent = costly(10, 30);
  spent.projects[0].cost.today = 2;
  assert.notEqual(stateSigs(spent, 'a').project, before.project);
});

test('stateSigs: a time that moved only its seconds redraws nothing; a new minute in it does (the open project churns every collect)', () => {
  const at = (activeAt) => ({ generatedAt: '2026-10-10T10:00:50.000Z', projects: [{ id: 'a', workflows: [{ running: [{ label: 'x', activeAt }] }] }] });
  const before = stateSigs(at('2026-10-10T10:00:05.000Z'), 'a');
  assert.equal(stateSigs(at('2026-10-10T10:00:45.120Z'), 'a').project, before.project);
  assert.notEqual(stateSigs(at('2026-10-10T10:01:02.000Z'), 'a').project, before.project);
});
