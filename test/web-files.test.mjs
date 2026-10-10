import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksOpen } from '../server/web/files.js';

const links = (uses, usedBy) => ({ uses: Array(uses).fill({}), usedBy: Array(usedBy).fill({}) });

// On a phone the open list of links left five lines of code on the screen (seen on the real state, 2026-10-10): there it
// starts closed, one tap away; on a computer a short list starts open.
test('linksOpen: a short list of links starts open on a computer and closed on a phone; a long one always closed', () => {
  assert.equal(linksOpen(links(2, 4), { phone: false }), true);
  assert.equal(linksOpen(links(2, 4), { phone: true }), false);
  assert.equal(linksOpen(links(8, 5), { phone: false }), false);
});
