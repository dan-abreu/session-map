import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, transitionsOf } from '../server/alerts/watch.mjs';

const chat = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, status: 'busy', archived: false, lastAssistantText: '',
  waiting: { strong: false, weak: false, items: [] }, ...extra,
});
const stateOf = (chats, { decisions = [], conversations = [], id = 'shop-1a2b3c', name = 'shop' } = {}) => ({
  projects: [{ id, name, chats, decisions, conversations }],
});
const diff = (before, after) => transitionsOf(snapshotOf(before), snapshotOf(after));

test('the first look is only a baseline: nothing that was already so becomes an alert', () => {
  assert.deepEqual(transitionsOf(null, snapshotOf(stateOf([chat('a', { status: 'idle' })]))), []);
});

test('busy then idle with an answer is a finished job, with the project, the title, where it runs and a short summary', () => {
  const before = stateOf([chat('a')], { conversations: [{ sessionId: 'a', origin: 'vscode' }] });
  const after = stateOf([chat('a', { status: 'idle', lastAssistantText: 'Done.   The login form now shows the error.\n\n```session-map\n{"doing":"x"}\n```' })], { conversations: [{ sessionId: 'a', origin: 'vscode' }] });
  const [event, ...rest] = diff(before, after);
  assert.deepEqual(rest, []);
  assert.deepEqual(event, {
    kind: 'finished', reason: 'answer', projectId: 'shop-1a2b3c', projectName: 'shop', sessionId: 'a', title: 'chat a', origin: 'vscode',
    summary: 'Done. The login form now shows the error.',
  });
});

test('a question left open is waiting for you, whether it came with the stop or after it', () => {
  const asked = chat('a', { status: 'idle', waiting: { strong: true, weak: false, items: [] } });
  assert.equal(diff(stateOf([chat('a')]), stateOf([asked]))[0].reason, 'question');
  assert.equal(diff(stateOf([chat('a', { status: 'idle' })]), stateOf([asked]))[0].kind, 'waiting', 'a question can show up a poll after the stop');
  const ends = chat('a', { status: 'idle', waiting: { strong: false, weak: true, items: [] } });
  assert.deepEqual(diff(stateOf([chat('a')]), stateOf([ends])).map((e) => [e.kind, e.reason]), [['waiting', 'asks']]);
  assert.deepEqual(diff(stateOf([asked]), stateOf([asked])), [], 'the same wait is told once');
});

test('a process that closes while it still worked stopped in the middle', () => {
  assert.deepEqual(diff(stateOf([chat('a')]), stateOf([chat('a', { status: 'closed' })])).map((e) => [e.kind, e.reason]), [['error', 'stopped']]);
});

test('quiet changes say nothing: idle to closed, a new conversation, an archived one, one that went away', () => {
  assert.deepEqual(diff(stateOf([chat('a', { status: 'idle' })]), stateOf([chat('a', { status: 'closed' })])), []);
  assert.deepEqual(diff(stateOf([]), stateOf([chat('b', { status: 'idle' })])), []);
  assert.deepEqual(diff(stateOf([chat('a', { archived: true })]), stateOf([chat('a', { status: 'idle', archived: true })])), []);
  assert.deepEqual(diff(stateOf([chat('a')]), stateOf([])), []);
});

test('a new clash between branches is told once, with the branches and the files they share', () => {
  const clash = { kind: 'clash', workCellIds: ['b', 'a'], branches: ['feat/b', 'feat/a'], owners: ['Ana', 'Ana'], files: ['src/x.js'], sameOwner: true };
  const [event] = diff(stateOf([]), stateOf([], { decisions: [clash] }));
  assert.deepEqual(event, { kind: 'clash', reason: 'clash', projectId: 'shop-1a2b3c', projectName: 'shop', sessionId: null, branches: ['feat/b', 'feat/a'], files: ['src/x.js'] });
  assert.deepEqual(diff(stateOf([], { decisions: [clash] }), stateOf([], { decisions: [{ ...clash, workCellIds: ['a', 'b'] }] })), []);
});

test('conversations the page itself drives are left to it', () => {
  const before = snapshotOf(stateOf([chat('a'), chat('b')]));
  const after = snapshotOf(stateOf([chat('a', { status: 'idle' }), chat('b', { status: 'idle' })]));
  assert.deepEqual(transitionsOf(before, after, { skip: new Set(['a']) }).map((e) => e.sessionId), ['b']);
});
