import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatcher } from '../server/alerts/watcher.mjs';

const chat = (sessionId, status, extra = {}) => ({ sessionId, title: `chat ${sessionId}`, status, archived: false, lastAssistantText: 'ok', waiting: { strong: false, weak: false, items: [] }, ...extra });
const stateOf = (...chats) => ({ projects: [{ id: 'shop-1', name: 'shop', chats, decisions: [], conversations: [] }] });

function setup({ prefs = { perProject: {} }, skip = new Set(), startup } = {}) {
  const states = [];
  const delivered = [];
  const watcher = createWatcher({
    readState: async () => states.shift(),
    deliver: async (alerts) => { delivered.push(alerts); },
    prefs: () => prefs,
    skip: () => skip,
    startup,
  });
  return { watcher, states, delivered };
}

test('each look is compared with the last; the changes get an id and a time, reach delivery and the page\'s feed', async () => {
  const { watcher, states, delivered } = setup();
  states.push(stateOf(chat('a', 'busy')), stateOf(chat('a', 'idle')), stateOf(chat('a', 'idle')));
  await watcher.tick();
  assert.deepEqual(delivered, [], 'the first look is the baseline');
  await watcher.tick();
  await watcher.tick();
  assert.equal(delivered.length, 1);
  const [alert] = delivered[0];
  assert.equal(alert.kind, 'finished');
  assert.equal(alert.id, 1);
  assert.ok(Date.parse(alert.ts));
  const feed = watcher.since(0);
  assert.equal(feed.lastId, 1);
  assert.match(feed.boot, /^[0-9a-f]{8,}$/);
  assert.deepEqual(feed.alerts.map((a) => a.sessionId), ['a']);
  assert.deepEqual(watcher.since(1).alerts, []);
});

test('pushed alerts (the page\'s own chats) skip the diff and the feed hides what a project turned off', async () => {
  const { watcher, delivered } = setup({ prefs: { perProject: { 'shop-1': { waiting: false } } } });
  watcher.push([{ kind: 'finished', reason: 'answer', projectId: 'shop-1', projectName: 'shop', sessionId: 'p', title: 'mine' }]);
  watcher.push([{ kind: 'waiting', reason: 'permission', projectId: 'shop-1', projectName: 'shop', sessionId: 'p', title: 'mine' }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(delivered.length, 2);
  assert.deepEqual(watcher.since(0).alerts.map((a) => a.kind), ['finished']);
  assert.equal(watcher.since(0).lastId, 2, 'the page still moves past a muted one');
});

test('what the page drives is skipped in the diff; startup alerts come with the first look', async () => {
  const { watcher, states, delivered } = setup({
    skip: new Set(['a']),
    startup: () => [{ kind: 'error', reason: 'restart', projectId: 'shop-1', projectName: 'shop', sessionId: 'r', title: 'cut' }],
  });
  states.push(stateOf(chat('a', 'busy')), stateOf(chat('a', 'idle')));
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(delivered.flat().map((a) => a.reason), ['restart']);
});

test('a look that fails keeps the last good one, and two looks never run at once', async () => {
  let calls = 0;
  let release;
  const watcher = createWatcher({
    readState: () => { calls++; return calls === 1 ? new Promise((r) => { release = r; }) : Promise.reject(new Error('disk')); },
    deliver: async () => {}, prefs: () => ({}), skip: () => new Set(),
  });
  const first = watcher.tick();
  const second = watcher.tick();
  assert.equal(calls, 1);
  release(stateOf(chat('a', 'busy')));
  await Promise.all([first, second]);
  await watcher.tick();
  assert.equal(calls, 2);
});

test('the feed keeps the newest 100', () => {
  const { watcher } = setup();
  for (let i = 0; i < 120; i++) watcher.push([{ kind: 'finished', reason: 'answer', projectId: 'shop-1', projectName: 'shop', sessionId: `s${i}`, title: '' }]);
  const feed = watcher.since(0);
  assert.equal(feed.alerts.length, 100);
  assert.equal(feed.alerts[0].id, 21);
});
