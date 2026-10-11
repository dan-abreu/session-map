// Why a chat sits where it does (sb03): the rule the server kept with the placement, said in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, translator } from '../server/web/i18n.js';
import { branchWhy, placedWhy } from '../server/web/placedwhy.js';

const join = (names) => names.join(' and ');
const en = translator('en');
const pt = translator('pt-BR');

test('placedWhy: an item code, a file, the map, the AI and the owner each give their own plain sentence', () => {
  const why = (partWhy) => placedWhy({ partWhy }, en, join);
  assert.equal(why({ rule: 'code', codes: ['mm27', 'mm01'] }), 'Here because it named mm27 and mm01');
  assert.equal(why({ rule: 'files', files: ['server/chat/hub.mjs'] }), 'Here because it edited server/chat/hub.mjs');
  assert.equal(why({ rule: 'page' }), 'Here because it was opened from this part of the map');
  assert.equal(why({ rule: 'ai' }), 'Here because the AI read the chat and picked this part');
  assert.equal(why({ rule: 'owner' }), 'Here because you put it here');
  assert.equal(why({ rule: 'owner', none: true }), 'You took it off the parts', 'moved to no part: not "you put it here"');
  assert.equal(why({ rule: 'project' }), 'It belongs to the whole project, not to one part');
  assert.equal(why({ rule: 'none' }), 'Not on a part yet');
});

test('placedWhy: a reason without its evidence, or an old server without a reason, still says something true', () => {
  assert.equal(placedWhy({ partWhy: { rule: 'code', codes: [] } }, en, join), 'Here because it named an item of this part');
  assert.equal(placedWhy({ partWhy: { rule: 'files' } }, en, join), 'Here because of the files it edited');
  assert.equal(placedWhy({ partSource: 'ai' }, en, join), 'Here because the AI read the chat and picked this part');
  assert.equal(placedWhy({}, en, join), 'Not on a part yet');
});

test('placedWhy speaks Brazilian Portuguese too', () => {
  assert.equal(placedWhy({ partWhy: { rule: 'code', codes: ['mm27'] } }, pt, join), 'Está aqui porque citou mm27');
  assert.equal(placedWhy({ partWhy: { rule: 'files', files: ['a.js'] } }, pt, join), 'Está aqui porque editou a.js');
  assert.equal(placedWhy({ partWhy: { rule: 'owner', none: true } }, pt, join), 'Você tirou esta conversa das partes');
});

test('branchWhy: the line of work is named by the card, the branch the chat ran on, or the folder it worked in', () => {
  const why = (workCellWhy) => branchWhy({ workCellWhy }, en);
  assert.equal(why({ rule: 'card', front: 'feature/cart' }), 'Its card says it works on feature/cart');
  assert.equal(why({ rule: 'branch', branch: 'feature/cart' }), 'The chat ran on feature/cart');
  assert.equal(why({ rule: 'cwd' }), 'The chat worked in the folder of this line of work');
  assert.equal(why({ rule: 'guess' }), 'The chat looked at files in the folder of this line of work');
  assert.equal(branchWhy({ workCellSource: 'branch' }, en), 'The chat ran on this line of work');
});

test('every sentence exists in both languages with the same blanks', () => {
  const keys = Object.keys(LANGS.en).filter((k) => /^chat\.(why|branchWhy)\./.test(k));
  assert.ok(keys.length >= 10);
  for (const k of keys) assert.ok(LANGS['pt-BR'][k], k);
});
