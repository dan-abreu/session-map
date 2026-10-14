import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBook, parseRef, subChapters } from '../server/chat/book-open.mjs';

test('parseRef reads the index, a chapter and a chapter.sub in several spellings', () => {
  assert.deepEqual(parseRef('índice'), { kind: 'index' });
  assert.deepEqual(parseRef('capítulo 3'), { kind: 'chapter', n: 3 });
  assert.deepEqual(parseRef('todo o capitulo 3'), { kind: 'chapter', n: 3 });
  assert.deepEqual(parseRef('acessa pra mim 2,2'), { kind: 'sub', n: 2, sub: 2 });
  assert.deepEqual(parseRef('2.2'), { kind: 'sub', n: 2, sub: 2 });
  assert.equal(parseRef('olá'), null);
});

const MD = '# Cap. 2\n\n## Pedido\n\nfaz isso\n\n→ Read: a.mjs\n\n  ← ok\n\nAchei o erro.\n\n→ Edit: a.mjs\n\nPronto.';

test('a chapter splits at each new passage of the AI\'s own words after tool work', () => {
  const subs = subChapters(MD);
  assert.equal(subs.length, 3);
  assert.match(subs[0].text, /faz isso/);
  assert.match(subs[1].text, /Achei o erro/);
  assert.match(subs[2].text, /Pronto/);
});

test('openBook returns the index, a whole chapter with its table, and one sub-chapter', () => {
  const sm = mkdtempSync(join(tmpdir(), 'bk-'));
  const dir = join(sm, 'book', 's1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ chapters: [{ n: 2, words: 'faz isso', closed: true, files: [], commits: [] }] }));
  writeFileSync(join(dir, 'tidy.json'), JSON.stringify({ title: 'Livro', chapters: { 2: { title: 'Erro corrigido', summary: 'x' } } }));
  writeFileSync(join(dir, 'cap-2.md'), MD);
  assert.match(openBook(sm, 's1', 'índice'), /2\. Erro corrigido/);
  assert.match(openBook(sm, 's1', 'cap 2'), /Subcapítulos:\n {2}2\.1 /);
  assert.match(openBook(sm, 's1', '2,2'), /Achei o erro/);
  assert.match(openBook(sm, 's1', '2,9'), /tem 3/);
  assert.match(openBook(sm, 's1', 'cap 7'), /não existe/);
});
