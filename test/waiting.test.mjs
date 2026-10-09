import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingFor } from '../server/parse/waiting.mjs';

const summary = (over = {}) => ({ pendingQuestion: false, lastAssistantText: 'All done.', ...over });
const idle = { status: 'idle' };
const busy = { status: 'busy' };

test('strong: stopped with an open AskUserQuestion', () => {
  assert.deepEqual(waitingFor(summary({ pendingQuestion: true }), idle, null), { strong: true, weak: false, items: [] });
});

test('strong also applies to a chat with no live session (closed)', () => {
  assert.equal(waitingFor(summary({ pendingQuestion: true }), null, null).strong, true);
});

test('weak: stopped and the last 300 characters end with a question mark, markdown ignored', () => {
  const text = `${'blah '.repeat(100)}Do you want me to continue?**  \n`;
  assert.deepEqual(waitingFor(summary({ lastAssistantText: text }), idle, null), { strong: false, weak: true, items: [] });
});

test('a question mark earlier in the text is not enough', () => {
  assert.equal(waitingFor(summary({ lastAssistantText: 'Why? Because it works.' }), idle, null).weak, false);
});

test('strong wins over weak', () => {
  const r = waitingFor(summary({ pendingQuestion: true, lastAssistantText: 'Ok?' }), idle, null);
  assert.deepEqual([r.strong, r.weak], [true, false]);
});

test('busy chat is neither strong nor weak', () => {
  const r = waitingFor(summary({ pendingQuestion: true, lastAssistantText: 'Ok?' }), busy, null);
  assert.deepEqual([r.strong, r.weak], [false, false]);
});

test('items come from card.waiting even when the chat is busy', () => {
  const r = waitingFor(summary(), busy, { title: 'T', waiting: ['pay the invoice'] });
  assert.deepEqual(r, { strong: false, weak: false, items: ['pay the invoice'] });
});

test('missing assistant text is not a question', () => {
  assert.equal(waitingFor(summary({ lastAssistantText: null }), idle, null).weak, false);
});
