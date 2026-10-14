import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBook, readChapter } from '../server/chat/book-view.mjs';

const dir = mkdtempSync(join(tmpdir(), 'bv-'));
mkdirSync(join(dir, 'book', 'abc-1'), { recursive: true });
writeFileSync(join(dir, 'book', 'abc-1', 'index.json'), JSON.stringify({ chapters: [{ n: 1, words: 5, closed: true, files: ['a'], commits: [] }, { n: 2, words: 1, closed: false }] }));
writeFileSync(join(dir, 'book', 'abc-1', 'tidy.json'), JSON.stringify({ title: 'T', chapters: { 1: { title: 'Um', summary: 'S' } } }));
writeFileSync(join(dir, 'book', 'abc-1', 'cap-1.md'), 'texto');

test('book lists chapters with tidy titles', () => {
  const b = readBook(dir, 'abc-1');
  assert.equal(b.title, 'T');
  assert.equal(b.chapters[0].title, 'Um');
  assert.equal(b.chapters[0].files, 1);
  assert.equal(b.chapters[1].title, null);
});
test('chapter text only for a valid id and number', () => {
  assert.equal(readChapter(dir, 'abc-1', 1), 'texto');
  assert.equal(readChapter(dir, 'abc-1', 2), null);
  assert.equal(readChapter(dir, '../x', 1), null);
  assert.equal(readChapter(dir, 'abc-1', '1/../1'), null);
  assert.deepEqual(readBook(dir, '../x').chapters, []);
});
