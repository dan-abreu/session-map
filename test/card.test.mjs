import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard } from '../server/parse/card.mjs';

test('a valid card keeps its known fields', () => {
  const card = parseCard(JSON.stringify({
    title: 'Step 5', area: 'messages', front: 'official-messages', milestone: '5', doing: 'registering templates',
    todo: ['group 4', 'push'], waiting: ['add a card at Meta'], decided: ['use v2'], estimateUSD: 22,
  }));
  assert.deepEqual(card, {
    title: 'Step 5', area: 'messages', front: 'official-messages', milestone: '5', doing: 'registering templates',
    todo: ['group 4', 'push'], waiting: ['add a card at Meta'], decided: ['use v2'], estimateUSD: 22,
  });
});

test('broken JSON, empty input and non-objects give null', () => {
  assert.equal(parseCard('{"title": "x"'), null);
  assert.equal(parseCard(null), null);
  assert.equal(parseCard(''), null);
  assert.equal(parseCard('[1,2]'), null);
  assert.equal(parseCard('42'), null);
});

test('an object with no known field is not a card', () => {
  assert.equal(parseCard('{"foo": 1}'), null);
});

test('wrong types are dropped field by field', () => {
  const card = parseCard(JSON.stringify({ title: 'T', estimateUSD: '22', doing: 5, todo: 'nope', waiting: ['ok', 3, '', null] }));
  assert.deepEqual(card, { title: 'T', waiting: ['ok'] });
});

test('unknown fields are discarded and a numeric milestone becomes a string', () => {
  assert.deepEqual(parseCard('{"title":"T","milestone":7,"secret":"x"}'), { title: 'T', milestone: '7' });
});

test('lists are cut at 10 items of 200 characters', () => {
  const card = parseCard(JSON.stringify({ title: 'T', todo: Array.from({ length: 15 }, (_, i) => `item ${i} ${'x'.repeat(300)}`) }));
  assert.equal(card.todo.length, 10);
  assert.ok(card.todo.every((t) => t.length === 200));
  assert.ok(card.todo[0].startsWith('item 0 '));
});

test('negative or infinite estimates are discarded', () => {
  assert.equal(parseCard('{"title":"T","estimateUSD":-1}').estimateUSD, undefined);
});
