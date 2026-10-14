import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBookSummary, SUMMARY_MAX } from '../server/chat/book-summary.mjs';

const dir = mkdtempSync(join(tmpdir(), 'bs-'));
mkdirSync(join(dir, 'book', 'abc-1'), { recursive: true });
mkdirSync(join(dir, 'book', 'big'), { recursive: true });
writeFileSync(join(dir, 'book', 'abc-1', 'resumo.md'), '## Em uma frase\n- item');
writeFileSync(join(dir, 'book', 'big', 'resumo.md'), 'x'.repeat(SUMMARY_MAX + 500));
writeFileSync(join(dir, 'resumo.md'), 'fora do livro');

test('summary is read from the chat book folder', () => {
  assert.equal(readBookSummary(dir, 'abc-1'), '## Em uma frase\n- item');
});

test('no summary file, unsafe id or no smDir gives null', () => {
  assert.equal(readBookSummary(dir, 'nope'), null);
  assert.equal(readBookSummary(dir, '..'), null);
  assert.equal(readBookSummary(dir, '../book/abc-1'), null);
  assert.equal(readBookSummary(dir, 'a/b'), null);
  assert.equal(readBookSummary(null, 'abc-1'), null);
});

test('a big summary is cut at the limit', () => {
  assert.equal(readBookSummary(dir, 'big').length, SUMMARY_MAX);
});
