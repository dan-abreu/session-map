import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nowJobs, jobBadges, pendingCount, nextUnseen, nowLine } from '../server/web/now.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const ago = (min) => new Date(NOW_MS - min * 60_000).toISOString();

const chat = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, partId: null, itemCode: null, status: 'idle', archived: false, live: true, liveSteps: [], workflows: [],
  model: null, turnStartedAt: null, updatedAt: ago(5), waiting: { strong: false, weak: false, items: [] }, ...extra,
});

function two(shopChats, notesChats) {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  state.projects[0].chats = shopChats;
  state.projects[0].conversations = [];
  state.projects[1].chats = notesChats;
  state.projects[1].conversations = [];
  return state;
}

const asks = { strong: true, weak: false, items: [] };

test('nowJobs: one card per job of every project, waiting for you first, then working, then finished and not seen', () => {
  const state = two(
    [
      chat('busy', { status: 'busy', partId: 'orders', updatedAt: ago(1), turnStartedAt: ago(12), model: 'claude-opus-5-5', liveSteps: [{ kind: 'edit', target: 'cart.ts', ts: ago(1) }] }),
      chat('perm', { status: 'busy', waiting: asks, updatedAt: ago(4) }),
      chat('idle'),
      chat('done', { updatedAt: ago(20) }),
      chat('gone', { status: 'busy', archived: true }),
    ],
    [chat('notes', { status: 'busy', updatedAt: ago(2) }), chat('question', { status: 'idle', live: false, waiting: { strong: false, weak: true, items: [] }, updatedAt: ago(30) })],
  );
  state.projects[0].conversations = [{ sessionId: 'busy', origin: 'vscode', node: null }];
  const jobs = nowJobs(state, { unseen: new Set(['done']), nowMs: NOW_MS });
  assert.deepEqual(jobs.cards.map((c) => [c.kind, c.chat.sessionId]), [
    ['waiting', 'perm'], ['waiting', 'question'], ['working', 'busy'], ['working', 'notes'], ['finished', 'done'],
  ]);
  assert.deepEqual(jobs.counts, { working: 2, waiting: 2, finished: 1 });
  const busy = jobs.cards.find((c) => c.chat.sessionId === 'busy');
  assert.equal(busy.project.name, 'acme-shop');
  assert.deepEqual(busy.place.path, ['What makes it work', 'Orders and cart']);
  assert.equal(busy.lastStep.kind, 'edit');
  assert.equal(busy.model, 'claude-opus-5-5');
  assert.equal(busy.since, ago(12), 'working since the person last wrote');
  assert.equal(busy.helpers, null);
  assert.equal(busy.origin, 'vscode', 'where it runs, from the list');
  assert.equal(jobs.cards.find((c) => c.chat.sessionId === 'notes').origin, null);
});

test('nowJobs is the same whichever project the page has open: it takes no project at all', () => {
  const state = two([chat('a', { status: 'busy' })], [chat('b', { status: 'busy' })]);
  const seen = (projectId) => nowJobs(state, { nowMs: NOW_MS, projectId }).cards.map((c) => c.chat.sessionId);
  assert.deepEqual(seen(state.projects[0].id), seen(state.projects[1].id), 'a project handed in changes nothing');
  assert.deepEqual(seen(state.projects[0].id).sort(), ['a', 'b'], 'both projects, always');
});

test('nowJobs counts the helpers still running (n/total) and leaves a closed question from days ago out', () => {
  const workflows = [
    { id: 'w1', name: 'build', started: 4, done: 1, running: [{ label: 'Tests', model: 'sonnet', activeAt: ago(2) }] },
    { id: 'w2', name: 'old', started: 2, done: 2, running: [] },
  ];
  const state = two(
    [chat('team', { status: 'busy', workflows }), chat('stale', { live: false, status: 'closed', waiting: { strong: false, weak: true, items: [] }, updatedAt: ago(60 * 30) })],
    [],
  );
  const jobs = nowJobs(state, { nowMs: NOW_MS });
  assert.deepEqual(jobs.cards.map((c) => c.chat.sessionId), ['team']);
  assert.deepEqual(jobs.cards[0].helpers, { done: 1, total: 4 });
});

test('jobBadges gives each project its working, waiting and finished numbers; pendingCount is what the tab title shows', () => {
  const state = two([chat('a', { status: 'busy' }), chat('b', { waiting: asks }), chat('c')], [chat('d', { status: 'busy' })]);
  const jobs = nowJobs(state, { unseen: new Set(['c']), nowMs: NOW_MS });
  const badges = jobBadges(jobs);
  assert.deepEqual(badges.get(state.projects[0].id), { working: 1, waiting: 1, finished: 1 });
  assert.deepEqual(badges.get(state.projects[1].id), { working: 1, waiting: 0, finished: 0 });
  assert.equal(pendingCount(jobs), 2, 'waiting for you plus finished and not seen');
});

test('nextUnseen marks a conversation that stopped working since the last look, and forgets one that works again', () => {
  const first = nextUnseen(new Map(), two([chat('a', { status: 'busy' }), chat('b')], []), new Set());
  assert.deepEqual([...first.unseen], [], 'the first look marks nothing');
  const second = nextUnseen(first.statuses, two([chat('a', { status: 'idle' }), chat('b')], []), first.unseen);
  assert.deepEqual([...second.unseen], ['a']);
  const third = nextUnseen(second.statuses, two([chat('a', { status: 'busy' }), chat('b')], []), second.unseen);
  assert.deepEqual([...third.unseen], [], 'working again: nothing to see yet');
});

test('nowLine words the strip folded to one line', () => {
  const t = (key, vars) => `${key}:${vars?.n ?? ''}`;
  assert.deepEqual(nowLine(t, { working: 3, waiting: 2, finished: 1 }), ['now.working:3', 'now.waiting:2', 'now.finished:1']);
  assert.deepEqual(nowLine(t, { working: 0, waiting: 0, finished: 0 }), ['now.nothing:']);
  assert.deepEqual(nowLine(t, { working: 1, waiting: 0, finished: 0 }), ['now.working:1']);
});
