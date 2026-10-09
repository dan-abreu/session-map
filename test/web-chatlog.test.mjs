import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatLog } from '../server/web/views.js';

const fold = (events) => events.reduce((log, evt) => chatLog(log, evt), undefined);
const AT = '2026-10-09T10:00:00.000Z';

test('chatLog: a history with every step keeps them all, in order (mm22)', () => {
  const items = [
    { type: 'user', text: 'Fix it', ts: AT },
    { type: 'thinking', text: '', ms: 3000, ts: AT },
    { type: 'tool', id: 't1', name: 'Read', step: { kind: 'read', target: 'a.ts' }, input: '{}', result: 'x', isError: false, ts: AT },
    { type: 'question', questions: [], answers: {}, ts: AT },
    { type: 'assistant', text: 'Done.', ts: AT, replyCostUSD: 0.1 },
  ];
  const log = chatLog(undefined, { type: 'history', data: { messages: [{ role: 'user', text: 'ignored' }], items, costUSD: 1 } });
  assert.deepEqual(log.items.map((i) => i.type), ['user', 'thinking', 'tool', 'question', 'assistant']);
  assert.equal(log.items[4].streaming, false);
  assert.equal(log.items[4].replyCostUSD, 0.1);
});

test('chatLog: live events carry their time, thinking and the details of each step', () => {
  const log = fold([
    { type: 'local-send', at: AT, data: { text: 'Look', images: ['data:image/png;base64,AA=='] } },
    { type: 'user', at: AT, data: { text: 'Look', images: 1 } },
    { type: 'thinking', at: AT, data: { text: 'Hmm' } },
    { type: 'tool', at: AT, data: { phase: 'use', id: 't1', name: 'Edit', input: '{}', step: { kind: 'edit', target: 'a.ts' }, diff: { path: 'a.ts', hunks: [] } } },
    { type: 'tool', at: AT, data: { phase: 'result', id: 't1', text: 'ok', isError: false } },
    { type: 'text', at: AT, data: { text: 'Done', partial: false } },
  ]);
  assert.deepEqual(log.items.map((i) => [i.type, i.ts]), [['user', AT], ['thinking', AT], ['tool', AT], ['assistant', AT]]);
  assert.deepEqual(log.items[0].localImages, ['data:image/png;base64,AA=='], 'the pasted image stays on the message the server echoed');
  assert.deepEqual(log.items[2].step, { kind: 'edit', target: 'a.ts' });
  assert.deepEqual(log.items[2].diff, { path: 'a.ts', hunks: [] });
  assert.equal(log.items[2].result, 'ok');
});

test('chatLog: a permission keeps the before and after of the edit it asks for', () => {
  const log = fold([{ type: 'permission', at: AT, data: { requestId: 'r1', state: 'asked', toolName: 'Edit', input: '{}', diff: { path: 'a.ts', hunks: [{ before: 'a', after: 'b' }] } } }]);
  assert.deepEqual(log.items[0].diff, { path: 'a.ts', hunks: [{ before: 'a', after: 'b' }] });
});
