import test from 'node:test';
import assert from 'node:assert/strict';
import { costWhyNote } from '../server/web/costwhy.js';

const P = (over) => ({ cost: { d30: 5 }, chats: [], costWhy: { older: 2, removed: 1 }, ...over });

test('costWhyNote: nothing without a count, without cost, or with chats on the map (sb06)', () => {
  assert.equal(costWhyNote(P({ costWhy: undefined })), null);
  assert.equal(costWhyNote(P({ costWhy: { older: 0, removed: 0 } })), null);
  assert.equal(costWhyNote(P({ cost: { d30: 0 } })), null);
  assert.equal(costWhyNote(P({ chats: [{ sessionId: 'x' }] })), null);
});

test('costWhyNote: says the older ones, the removed ones, or both (sb06)', () => {
  assert.deepEqual(costWhyNote(P({ costWhy: { older: 2, removed: 0 } })), [{ key: 'project.costWhy.older', n: 2 }]);
  assert.deepEqual(costWhyNote(P({ costWhy: { older: 0, removed: 3 } })), [{ key: 'project.costWhy.removed', n: 3 }]);
  assert.deepEqual(costWhyNote(P()), [{ key: 'project.costWhy.older', n: 2 }, { key: 'project.costWhy.removed', n: 1 }]);
});
