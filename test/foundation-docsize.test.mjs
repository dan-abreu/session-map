import test from 'node:test';
import assert from 'node:assert/strict';
import { docTypeOf, measureDoc, sizeState, needsSummary, docAction } from '../server/foundation/docsize.mjs';

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

test('docTypeOf recognises each document type by name or folder', () => {
  assert.equal(docTypeOf('CLAUDE.md'), 'agent');
  assert.equal(docTypeOf('sub/AGENTS.md'), 'agent');
  assert.equal(docTypeOf('memory/MEMORY.md'), 'memory');
  assert.equal(docTypeOf('.claude/skills/x/SKILL.md'), 'skill');
  assert.equal(docTypeOf('docs/architecture/foundation.md'), 'arch-part');
  assert.equal(docTypeOf('docs/arquitetura/rotas.md'), 'arch-part');
  assert.equal(docTypeOf('README.md'), 'readme');
  assert.equal(docTypeOf('README.pt-BR.md'), 'readme');
  assert.equal(docTypeOf('.dev/plano-v02.md'), 'plan');
  assert.equal(docTypeOf('.dev/brief-x.md'), 'plan');
  assert.equal(docTypeOf('docs/decisions/0001.md'), 'registry');
  assert.equal(docTypeOf('docs/glossario.md'), 'registry');
  assert.equal(docTypeOf('CHANGELOG.md'), 'changelog');
  assert.equal(docTypeOf('src/app.js'), null);
  assert.equal(docTypeOf('notes.md'), null);
});

test('measureDoc counts lines and KB and ignores generated and mermaid blocks', () => {
  assert.deepEqual(measureDoc(lines(10)).lines, 10);
  const text = ['a', '```generated', 'x', 'y', '```', '```mermaid', 'g', '```', 'b'].join('\n');
  const m = measureDoc(text);
  assert.equal(m.lines, 2);
  assert.equal(m.ignored, 7);
  assert.equal(measureDoc('x'.repeat(2048)).kb, 2);
  assert.equal(measureDoc('').lines, 0);
});

test('README of 320 lines is a warning and 401 is strong', () => {
  assert.equal(sizeState('readme', measureDoc(lines(320))), 'warning');
  assert.equal(sizeState('readme', measureDoc(lines(401))), 'strong');
  assert.equal(sizeState('readme', measureDoc(lines(100))), 'ok');
});

test('agent instructions warn at 151 and are strong at 201', () => {
  assert.equal(sizeState('agent', measureDoc(lines(150))), 'ok');
  assert.equal(sizeState('agent', measureDoc(lines(151))), 'warning');
  assert.equal(sizeState('agent', measureDoc(lines(201))), 'strong');
});

test('memory of 25 KB is strong even with 120 lines', () => {
  const text = Array.from({ length: 120 }, () => 'x'.repeat(220)).join('\n');
  const m = measureDoc(text);
  assert.ok(m.kb >= 25);
  assert.equal(sizeState('memory', m), 'strong');
});

test('limits from config override the defaults', () => {
  const m = measureDoc(lines(60));
  assert.equal(sizeState('readme', m), 'ok');
  assert.equal(sizeState('readme', m, { readme: { warn: 50, strong: 100 } }), 'warning');
  assert.equal(sizeState('readme', m, { readme: { warn: 10, strong: 50 } }), 'strong');
});

test('unknown type is ok', () => {
  assert.equal(sizeState(null, measureDoc(lines(9999))), 'ok');
});

test('needsSummary asks for a summary on architecture parts above 100 lines', () => {
  assert.equal(needsSummary('arch-part', lines(101)), true);
  assert.equal(needsSummary('arch-part', '## Summary\n' + lines(150)), false);
  assert.equal(needsSummary('arch-part', '## Sumário\n' + lines(150)), false);
  assert.equal(needsSummary('arch-part', lines(100)), false);
  assert.equal(needsSummary('readme', lines(500)), false);
});

test('changelog and registries are archived, never split', () => {
  assert.equal(docAction('changelog', 'strong'), 'archive');
  assert.equal(docAction('changelog', 'warning'), 'archive');
  assert.equal(docAction('registry', 'strong'), 'archive');
  assert.equal(docAction('readme', 'strong'), 'split');
  assert.equal(docAction('readme', 'ok'), 'none');
  assert.equal(docAction('changelog', 'ok'), 'none');
});
