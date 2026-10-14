// Interpreter (AI agent): authored this file; pending human review
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillsFocus } from '../server/foundation/skills-focus.mjs';

const skills = [
  { name: 'audit-xls', description: 'Audit a spreadsheet for formula errors and mistakes', command: '/audit-xls', enabled: true },
  { name: 'transcribe', description: 'Transcribe audio files locally', command: '/transcribe', enabled: true },
  { name: 'browser-control', description: 'Control a running browser session', command: '/browser-control', enabled: true },
  { name: 'roll-forward', description: 'Build a roll-forward schedule for a balance-sheet account', command: '/roll-forward', enabled: true },
  { name: 'off-skill', description: 'Whatever', command: '/off-skill', enabled: false },
];

test('skillsFocus picks only the skills whose words overlap the request, never the whole list', () => {
  const out = skillsFocus({ skills, part: { name: 'Costs' }, text: 'audite a planilha e ache o erro de formula', lang: 'en' });
  assert.ok(out.includes('audit-xls'), out);
  assert.ok(!out.includes('transcribe'), out);
  assert.ok(!out.includes('browser-control'), out);
  assert.ok(!out.includes('roll-forward'), out);
});

test('skillsFocus ranks by overlap and caps the count', () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ name: 'tool-' + i, description: 'spreadsheet audit helper', command: '/tool-' + i, enabled: true });
  const out = skillsFocus({ skills: many, part: { name: 'Costs' }, text: 'spreadsheet audit', lang: 'en', limit: 3 });
  const listed = (out.match(/^ - /gm) ?? []).length;
  assert.ok(listed <= 3, 'got ' + listed);
});

test('skillsFocus drops disabled skills and returns nothing when nothing matches', () => {
  assert.equal(skillsFocus({ skills: [{ name: 'x', command: '/x', enabled: false }], text: 'hello', lang: 'en' }), '');
  assert.equal(skillsFocus({ skills: [{ name: 'off-skill', description: 'Whatever', command: '/off-skill', enabled: true }], text: 'quantum physics', lang: 'en' }), '');
});

test('skillsFocus keeps item-code-shaped tokens out of the lines', () => {
  const out = skillsFocus({ skills: [{ name: 'x99', description: 'has a code', command: '/x99', enabled: true }], text: 'x99', lang: 'en' });
  assert.ok(!out.includes('x99'), out);
});

test('skillsFocus ignores the words every description repeats and names the skill by its command', () => {
  const list = [
    { name: 'pdf', description: 'Use when the user wants to do anything with PDF files', command: '/pdf', enabled: true },
    { name: 'tdd', plugin: 'superpowers', description: 'Use when implementing any feature, before writing code', command: '/superpowers:tdd', enabled: true },
  ];
  assert.equal(skillsFocus({ skills: list, part: { name: 'Servidor' }, text: 'when the user clicks the button, fix the layout', lang: 'en' }), '');
  assert.ok(skillsFocus({ skills: list, text: 'implementing a feature with tdd', lang: 'en' }).includes('/superpowers:tdd'));
});
