import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, NOTE_MAX, TITLE_MAX, cleanDraft, columnsOf, moveInList } from '../server/web/handcards.js';

const card = (id, column) => ({ id, title: id, partId: null, note: '', column });
const ids = (list) => list.map((c) => c.id);

test('cleanDraft trims the title, needs one, and keeps the part and the note optional', () => {
  assert.deepEqual(cleanDraft({ title: '  Call the accountant  ', partId: 'billing', note: ' before Friday ' }),
    { ok: true, card: { title: 'Call the accountant', partId: 'billing', note: 'before Friday' } });
  assert.deepEqual(cleanDraft({ title: 'Only a title' }), { ok: true, card: { title: 'Only a title', partId: null, note: '' } });
  assert.deepEqual(cleanDraft({ title: 'x', partId: '' }).card.partId, null, 'an empty part is "no part"');
  assert.deepEqual(cleanDraft({ title: '   ' }), { ok: false, error: 'title-required' });
  assert.deepEqual(cleanDraft({}), { ok: false, error: 'title-required' });
  assert.deepEqual(cleanDraft(null), { ok: false, error: 'title-required' });
  assert.equal(cleanDraft({ title: 'x', partId: 7 }).error, 'bad-card');
  assert.equal(cleanDraft({ title: 'x', note: 7 }).error, 'bad-card');
});

test('cleanDraft cuts a title and a note that run too long instead of refusing them', () => {
  const long = cleanDraft({ title: 'a'.repeat(TITLE_MAX + 50), note: 'b'.repeat(NOTE_MAX + 50) });
  assert.equal(long.card.title.length, TITLE_MAX);
  assert.equal(long.card.note.length, NOTE_MAX);
});

test('columnsOf splits by column in list order, and an unknown column reads as to do', () => {
  const cols = columnsOf([card('a', 'doing'), card('b', 'todo'), card('c', 'done'), card('d', 'doing'), card('e', 'weird')]);
  assert.deepEqual(COLUMNS, ['todo', 'doing', 'done']);
  assert.deepEqual(ids(cols.todo), ['b', 'e']);
  assert.deepEqual(ids(cols.doing), ['a', 'd']);
  assert.deepEqual(ids(cols.done), ['c']);
});

test('moveInList puts a card at the end of another column when dropped on the column', () => {
  const list = [card('a', 'todo'), card('b', 'todo'), card('c', 'doing')];
  const moved = moveInList(list, 'a', 'doing');
  assert.deepEqual(ids(columnsOf(moved).todo), ['b']);
  assert.deepEqual(ids(columnsOf(moved).doing), ['c', 'a']);
  assert.equal(list[0].column, 'todo', 'the list it was given is not changed');
});

test('moveInList puts a card before the card it is dropped on, in the same column or another', () => {
  const list = [card('a', 'todo'), card('b', 'todo'), card('c', 'todo'), card('d', 'doing'), card('e', 'doing')];
  assert.deepEqual(ids(columnsOf(moveInList(list, 'c', 'todo', 'a')).todo), ['c', 'a', 'b']);
  assert.deepEqual(ids(columnsOf(moveInList(list, 'a', 'todo', 'c')).todo), ['b', 'a', 'c']);
  assert.deepEqual(ids(columnsOf(moveInList(list, 'a', 'doing', 'e')).doing), ['d', 'a', 'e']);
  assert.deepEqual(ids(columnsOf(moveInList(list, 'b', 'doing', 'd')).doing), ['b', 'd', 'e']);
});

test('moveInList: dropping on itself changes nothing, a "before" in another column goes to the end, an unknown card or column is refused', () => {
  const list = [card('a', 'todo'), card('b', 'todo'), card('c', 'doing')];
  assert.deepEqual(moveInList(list, 'a', 'todo', 'a'), list);
  assert.deepEqual(ids(columnsOf(moveInList(list, 'a', 'doing', 'b')).doing), ['c', 'a'], '"before b" but b is not in the doing column');
  assert.equal(moveInList(list, 'zzz', 'doing'), null);
  assert.equal(moveInList(list, 'a', 'archive'), null);
});
