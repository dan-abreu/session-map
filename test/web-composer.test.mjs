// Most of the chat panel is dialogue (mm08): the input starts at one line and grows to about 40% of the panel, the
// permission row folds away when not in use, the key hints show only while typing, and on a phone the input stays
// above the keyboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composerSize } from '../server/web/views.js';

const WEB = new URL('../server/web/', import.meta.url);
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const css = readFileSync(new URL('style.css', WEB), 'utf8');

test('the input is one line high empty, grows with the text and scrolls past 40% of the panel', () => {
  assert.deepEqual(composerSize({ scrollHeight: 20, paneHeight: 800, minHeight: 38 }), { height: 38, scroll: false });
  assert.deepEqual(composerSize({ scrollHeight: 120, paneHeight: 800, minHeight: 38 }), { height: 120, scroll: false });
  assert.deepEqual(composerSize({ scrollHeight: 500, paneHeight: 800, minHeight: 38 }), { height: 320, scroll: true });
  assert.deepEqual(composerSize({ scrollHeight: 500, paneHeight: 0, minHeight: 38 }), { height: 38, scroll: true }, 'a hidden panel never collapses the input below one line');
});

test('both chat sheets start the input at one line and fold the permission row', () => {
  const inputs = [...html.matchAll(/<textarea id="(chatInput|flowChatInput)"[^>]*>/g)];
  assert.equal(inputs.length, 2);
  for (const [tag] of inputs) assert.match(tag, /rows="1"/);
  const folds = [...html.matchAll(/<details class="chat-mode"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)];
  assert.equal(folds.length, 2, 'a folded permission row in each sheet');
  for (const [, summary] of folds) assert.match(summary, /data-chat="modename"/, 'the folded row still says which permissions apply');
});

test('the key hints show only while typing, and a phone keeps the input above the keyboard', () => {
  assert.match(css, /\.chat-form:not\(:focus-within\) \.chat-keys\s*\{\s*display:\s*none;/);
  assert.match(html, /<meta name="viewport" content="[^"]*interactive-widget=resizes-content/);
});
