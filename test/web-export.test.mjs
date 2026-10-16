// pc23: the conversation as one markdown file, neutral and complete enough to keep or share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationMarkdown } from '../server/web/transcript.js';

const ITEMS = [
  { type: 'user', text: 'Arrume as setas', ts: '2026-10-14T10:00:00.000Z' },
  { type: 'assistant', text: 'Pronto.', ts: '2026-10-14T10:01:00.000Z' },
  { type: 'tool', name: 'Edit', step: { kind: 'edit', target: 'arrows.js' } },
  { type: 'question', questions: [{ question: 'A ou B?' }], answers: { 'A ou B?': 'A' } },
  { type: 'user', text: '[session-map: activity] nota', auto: 'inbox' },
];

test('a conversation becomes one markdown file: you, Claude, steps, questions and session-map notes', () => {
  const md = conversationMarkdown(ITEMS, { time: () => '10:00', day: (key) => `Day ${key}` });
  assert.match(md, /^## You \(10:00\)\n\nArrume as setas/m);
  assert.match(md, /## Claude \(10:00\)\n\nPronto\./);
  assert.match(md, /^- Step: Edit \(arrows\.js\)$/m);
  assert.match(md, /## Question\n\n- A ou B\? → A/);
  assert.match(md, /## session-map\n\n\[session-map: activity\] nota/);
});

test('day lines become headings; empty items and unknown kinds are left out', () => {
  const md = conversationMarkdown([{ type: 'day', day: '2026-10-14' }, { type: 'thinking', text: 'hmm' }, null], { day: (k) => k });
  assert.match(md, /^### 2026-10-14$/m);
  assert.match(md, /^- Thinking$/m);
});
