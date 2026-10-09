// What the skills hand back to the person reads in plain words and says what to do, never a raw code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { formatResults } from '../scripts/history-search.mjs';
import { linkLines, notRunningText } from '../scripts/links.mjs';

const SKILLS = new URL('../skills/', import.meta.url);

test('every skill tells Claude to answer the person in plain words, in their language', () => {
  for (const name of readdirSync(SKILLS)) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, SKILLS), 'utf8');
    assert.match(text, /## Talking to the person/, `${name} has no plain-words section`);
    assert.match(text, /plain words/i, name);
    assert.match(text, /language/i, name);
  }
});

test('the map links say where each one opens and that the key is private', () => {
  const lines = linkLines({ local: 'http://127.0.0.1:4001/?k=abc', lan: ['http://10.0.0.5:4001/?k=abc'] });
  assert.equal(lines[0], 'On this computer: http://127.0.0.1:4001/?k=abc');
  assert.equal(lines[1], 'On your phone or another computer on the same Wi-Fi: http://10.0.0.5:4001/?k=abc');
  assert.match(lines.at(-1), /key/i);
  assert.match(lines.at(-1), /do not share/i);
  assert.deepEqual(linkLines({ local: 'http://127.0.0.1:4001/?k=abc', lan: [] }), ['On this computer: http://127.0.0.1:4001/?k=abc', 'Keep this link to yourself: it carries your key. Do not share it.']);
});

test('when the page is not on, the message says what to do', () => {
  const text = notRunningText(4001);
  assert.match(text, /not on/);
  assert.match(text, /\/session-map:map/);
  assert.doesNotMatch(text, /server|port/i);
});

test('history results read as plain labels, with the conversation number last', () => {
  const out = formatResults([{ title: 'Checkout page', endedAt: '2026-10-01T10:00:00Z', projectDir: 'shop', userPrompts: ['Fix the checkout'], lastAssistantText: 'Done.', sessionId: 'abc-123' }]);
  assert.equal(out, 'Checkout page (2026-10-01, shop)\nYou asked: Fix the checkout\nLast answer: Done.\nConversation number: abc-123');
  assert.match(formatResults([]), /Nothing found/);
  assert.match(formatResults([]), /other words/);
});
