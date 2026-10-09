import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatLog, chatState } from '../server/web/views.js';

const fold = (events) => events.reduce(chatLog, undefined);
const sent = { type: 'local-send', data: { text: 'Fix the form' } };
const reply = { type: 'text', data: { text: 'Done. The form shows the error now.\n\n```session-map\n{"doing":"x"}\n```' } };

test('working while a turn runs, and waiting for permission while a card asks', () => {
  assert.equal(chatState(fold([sent]), { sessionId: null }).kind, 'working');
  const asking = fold([sent, { type: 'permission', data: { requestId: 'r', state: 'asked', toolName: 'Write', input: '{}' } }, { type: 'tool', data: { phase: 'use', id: 't', name: 'Write', input: '' } }]);
  assert.equal(chatState(asking, { sessionId: 's' }).kind, 'permission');
  const answered = chatLog(asking, { type: 'permission', data: { requestId: 'r', state: 'allowed' } });
  assert.equal(chatState(answered, { sessionId: 's' }).kind, 'working');
});

test('finished, with the reply\'s own words as the summary, never looks stuck once the process ends', () => {
  const done = fold([sent, reply, { type: 'turn-end', data: {} }]);
  assert.deepEqual(chatState(done, { sessionId: 's' }), { kind: 'finished', summary: 'Done. The form shows the error now.' });
  const ended = chatLog(done, { type: 'session', data: { state: 'ended' } });
  assert.equal(chatState(ended, { sessionId: 's' }).kind, 'finished');
});

test('interrupted: cut off by a restart (from the history) or a process that died; continuing clears it', () => {
  const cut = chatLog(undefined, { type: 'history', data: { messages: [{ role: 'user', text: 'Fix the form' }], interrupted: true } });
  assert.deepEqual(chatState(cut, { sessionId: 's' }), { kind: 'interrupted', resumable: true, reason: 'restart' });
  const died = fold([sent, { type: 'error', data: { error: 'exited' } }, { type: 'session', data: { state: 'ended' } }]);
  assert.equal(chatState(died, { sessionId: 's' }).kind, 'interrupted');
  assert.equal(chatState(died, { sessionId: null }).resumable, false);
  assert.equal(chatState(chatLog(cut, sent), { sessionId: 's' }).kind, 'working');
});

test('a refused message is an error, a new sheet is new, and a paused one with no reply says paused', () => {
  assert.equal(chatState(fold([sent, { type: 'error', data: { error: 'too-many-chats' } }]), { sessionId: null }).kind, 'error');
  assert.equal(chatState(undefined, { sessionId: null }).kind, 'new');
  const paused = fold([{ type: 'history', data: { messages: [{ role: 'user', text: 'hi' }] } }, { type: 'session', data: { state: 'ended' } }]);
  assert.equal(chatState(paused, { sessionId: 's' }).kind, 'paused');
});
