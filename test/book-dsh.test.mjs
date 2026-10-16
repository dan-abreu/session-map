import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookEntriesOf, writeDshBook } from '../server/chat/book-dsh.mjs';

// The book for DeepSeek sessions (id123, item 1): chapters from the DSH log items, with no AI and no hook, in the
// same layout the Claude hook writes.

const items = [
  { type: 'user', text: 'Crie o arquivo A' },
  { type: 'assistant', text: 'Vou criar.' },
  { type: 'tool', name: 'edit', detail: 'src/a.mjs', result: 'ok' },
  { type: 'assistant', text: 'Pronto.' },
  { type: 'user', text: 'Commit e feche' },
  { type: 'tool', name: 'pwsh', detail: 'git commit -m "feat(a): thing"', result: '[main abc1234] feat(a): thing\n' },
  { type: 'assistant', text: 'Feito.' },
];

test('bookEntriesOf adapts the DSH items to the Claude entry shape', () => {
  const entries = bookEntriesOf(items);
  assert.deepEqual(entries[0], { type: 'user', message: { content: [{ type: 'text', text: 'Crie o arquivo A' }] } });
  assert.equal(entries[2].message.content[0].type, 'tool_use');
  assert.equal(entries[2].message.content[0].name, 'Edit');
  assert.equal(entries[2].message.content[0].input.file_path, 'src/a.mjs');
  const result = entries.find((e) => e.message.content[0]?.type === 'tool_result' && String(e.message.content[0].content).includes('[main abc1234]'));
  assert.ok(result, 'the tool result becomes a user entry with a tool_result block');
  assert.ok(result.message.content[0].content.includes('[main abc1234]'));
});

test('a truncated path is never claimed as a file, and questions are skipped', () => {
  const entries = bookEntriesOf([
    { type: 'tool', name: 'edit', detail: 'C:\\very\\long\\path\\that\\was…', result: '' },
    { type: 'question', questions: [] },
  ]);
  assert.equal(entries.length, 0);
});

test('writeDshBook finds the files, the commits and the item codes', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-book-'));
  const res = writeDshBook({ smDir, sessionId: 'session-abc', items: [...items, { type: 'user', text: 'Segundo pedido `or99`' }], now: new Date('2026-10-14T00:00:00Z') });
  assert.equal(res.chapters.length, 3);
  assert.ok(res.chapters[0].files.includes('src/a.mjs'));
  assert.ok(res.chapters[1].commits.some((c) => c.includes('abc1234')));
  assert.equal(res.chapters[0].closed, true, 'closed by the next prompt');
  assert.ok(res.chapters[2].codes.includes('or99'));
});

test('writeDshBook writes cap files and the index once, and is idempotent', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-book-'));
  const sessionId = 'session-abc';
  const first = writeDshBook({ smDir, sessionId, items });
  assert.equal(first.same, false);
  const bookDir = join(smDir, 'book', sessionId);
  assert.ok(existsSync(join(bookDir, 'cap-1.md')), 'the closed chapter is written');
  assert.equal(existsSync(join(bookDir, 'cap-2.md')), false, 'the open chapter is not a file yet');
  const index = JSON.parse(readFileSync(join(bookDir, 'index.json'), 'utf8'));
  assert.equal(index.engine, 'deepseek');
  assert.equal(index.chapters.length, 2);
  const second = writeDshBook({ smDir, sessionId, items });
  assert.equal(second.same, true, 'nothing changed: no rewrite');
  // A new item opens a new chapter: the index is rewritten, the old cap files stay.
  const third = writeDshBook({ smDir, sessionId, items: [...items, { type: 'user', text: 'Novo pedido' }] });
  assert.equal(third.same, false);
  assert.ok(existsSync(join(bookDir, 'cap-1.md')));
});
