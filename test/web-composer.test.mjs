// Most of the chat panel is dialogue (mm08): the input starts at one line and grows to about 40% of the panel, the
// menu of the button by Send holds only how the chat runs (pc19), the key hints sit quietly inside the box (pc18), and on
// a phone the input stays above the keyboard.
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

test('both chat sheets start the input at one line; the bar holds the permission mode, the brain\'s line and the cost chip by Send', () => {
  const inputs = [...html.matchAll(/<textarea id="(chatInput|flowChatInput)"[^>]*>/g)];
  assert.equal(inputs.length, 2);
  for (const [tag] of inputs) assert.match(tag, /rows="1"/);
  const bars = [...html.matchAll(/<div class="chat-bar">([\s\S]*?)data-chat="send"/g)];
  assert.equal(bars.length, 2, 'one bar in each sheet');
  for (const [, bar] of bars) {
    assert.match(bar, /data-chat="brain"/, 'the brain\'s line sits by Send (id146)');
    assert.match(bar, /data-chat="modebtn"[^>]*aria-haspopup="menu"/, 'the permission mode is a chip in the footer, like Claude Code (pc39)');
    assert.doesNotMatch(bar, /chat-run|chat-menu|runpanel|data-chat="mode"/, 'the ways menu and the old mode select stay out of the box');
  }
});

test('the key hints sit inside the box and never come and go; a phone keeps the input above the keyboard', () => {
  // A line that came and went with focus moved Send under the pointer mid-click, so the message never went: the hints
  // follow the text in the box, not the focus, and share the input's own row.
  assert.match(html, /class="chat-box"[\s\S]*?class="chat-bar"[\s\S]*?data-chat="hints"[\s\S]*?data-chat="send"/, 'in the box, on its bar');
  assert.doesNotMatch(css, /(focus-within|placeholder-shown)\)[^{]*\.chat-hints/, 'neither focus nor typing adds or removes the hints');
  assert.doesNotMatch(css, /\.chat-keys/, 'no separate line of hints under the box');
  assert.doesNotMatch(html, /class="chat-keys"/);
  assert.match(html, /<meta name="viewport" content="[^"]*interactive-widget=resizes-content/);
});
