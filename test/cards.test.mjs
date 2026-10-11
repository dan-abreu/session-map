import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PER_PROJECT, addCard, moveCard, readCards, removeCard } from '../server/cards.mjs';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sm-cards-')));
const titles = (list, column) => list.filter((c) => c.column === column).map((c) => c.title);

test('addCard keeps a card in session-map\'s own folder, in "to do", and readCards gives it back', () => {
  const smDir = tmp();
  try {
    const made = addCard(smDir, 'acme-shop', { title: ' Call the accountant ', partId: 'billing', note: 'before Friday' }, { now: 1000 });
    assert.equal(made.ok, true);
    assert.match(made.card.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...made.card, id: undefined }, { id: undefined, title: 'Call the accountant', partId: 'billing', note: 'before Friday', column: 'todo', createdAt: 1000 });
    assert.deepEqual(readCards(smDir)['acme-shop'], [made.card]);
    assert.equal(JSON.parse(readFileSync(join(smDir, 'cards.json'), 'utf8'))['acme-shop'].length, 1);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('addCard refuses a card with no title, a bad project and a project that already holds the most', () => {
  const smDir = tmp();
  try {
    assert.deepEqual(addCard(smDir, 'acme-shop', { title: '  ' }), { ok: false, error: 'title-required' });
    assert.equal(addCard(smDir, '', { title: 'x' }).error, 'bad-project');
    assert.equal(addCard(smDir, 7, { title: 'x' }).error, 'bad-project');
    assert.deepEqual(readCards(smDir), {}, 'nothing was written');
    for (let i = 0; i < MAX_PER_PROJECT; i += 1) addCard(smDir, 'p', { title: `c${i}` });
    assert.equal(addCard(smDir, 'p', { title: 'one more' }).error, 'too-many');
    assert.equal(addCard(smDir, 'other', { title: 'fine here' }).ok, true, 'the limit is per project');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('moveCard changes the column and the place, and the new order is what readCards says next time', () => {
  const smDir = tmp();
  try {
    const [a, b, c] = ['a', 'b', 'c'].map((title) => addCard(smDir, 'p', { title }).card);
    assert.equal(moveCard(smDir, a.id, { column: 'doing' }).card.column, 'doing');
    assert.deepEqual(titles(readCards(smDir).p, 'doing'), ['a']);
    moveCard(smDir, c.id, { column: 'todo', before: b.id });
    assert.deepEqual(titles(readCards(smDir).p, 'todo'), ['c', 'b']);
    moveCard(smDir, b.id, { column: 'doing', before: a.id });
    assert.deepEqual(titles(readCards(smDir).p, 'doing'), ['b', 'a']);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('moveCard says so for a card that is not there or a column that does not exist, and changes nothing', () => {
  const smDir = tmp();
  try {
    const { card } = addCard(smDir, 'p', { title: 'a' });
    assert.deepEqual(moveCard(smDir, 'nope', { column: 'doing' }), { ok: false, error: 'unknown-card' });
    assert.deepEqual(moveCard(smDir, card.id, { column: 'archive' }), { ok: false, error: 'bad-column' });
    assert.deepEqual(moveCard(smDir, card.id, { column: 'doing', before: 7 }), { ok: false, error: 'bad-column' });
    assert.equal(readCards(smDir).p[0].column, 'todo');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('removeCard deletes one card and leaves the others, a project with none left disappears', () => {
  const smDir = tmp();
  try {
    const a = addCard(smDir, 'p', { title: 'a' }).card;
    const b = addCard(smDir, 'p', { title: 'b' }).card;
    assert.equal(removeCard(smDir, a.id), true);
    assert.deepEqual(readCards(smDir).p.map((c) => c.title), ['b']);
    assert.equal(removeCard(smDir, a.id), false, 'already gone');
    assert.equal(removeCard(smDir, b.id), true);
    assert.deepEqual(readCards(smDir), {});
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('readCards ignores junk on disk: a broken file, a card with no title, a wrong column', () => {
  const smDir = tmp();
  try {
    assert.deepEqual(readCards(smDir), {}, 'no file yet');
    writeFileSync(join(smDir, 'cards.json'), '{not json');
    assert.deepEqual(readCards(smDir), {});
    writeFileSync(join(smDir, 'cards.json'), JSON.stringify({
      p: [{ id: 'x1', title: 'ok', column: 'weird', partId: 5, note: 9 }, { id: 'x2', title: '' }, 'junk', { title: 'no id' }],
      q: 'not a list',
    }));
    assert.deepEqual(readCards(smDir), { p: [{ id: 'x1', title: 'ok', partId: null, note: '', column: 'todo', createdAt: 0 }] });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
