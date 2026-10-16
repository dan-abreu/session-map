import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptTidy, chapterText, chaptersOf, indexText, promptText } from '../server/chat/book.mjs';

const user = (text, extra = {}) => ({ type: 'user', message: { role: 'user', content: text }, ...extra });
const asst = (...blocks) => ({ type: 'assistant', message: { role: 'assistant', content: blocks } });
const say = (text) => ({ type: 'text', text });
const result = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: text }] } });

test('a system-reminder is stripped from a prompt', () => {
  assert.equal(promptText(user('hello <system-reminder>secret</system-reminder> there')), 'hello  there');
});

test('other injected blocks are stripped too, even when never closed', () => {
  assert.equal(promptText(user('<browser_instruction>use the tab</browser_instruction>\nfix the login')), 'fix the login');
  assert.equal(promptText(user('fix it\n<browser_instruction>cut off')), 'fix it');
  assert.equal(promptText(user('<browser_instruction>only this</browser_instruction>')), '');
});

test('tool results and the compact summary do not start chapters', () => {
  const list = [user('one'), asst(say('ok')), result('x'), user('summary', { isCompactSummary: true }), user('two')];
  const chs = chaptersOf(list);
  assert.deepEqual(chs.map((c) => [c.n, c.closed]), [[1, true], [2, false]]);
});

test('a page chat first message keeps only its last paragraph as words', () => {
  const [c] = chaptersOf([user('Context from session-map\n\nlots of facts\n\nfix the login')]);
  assert.equal(c.words, 'fix the login');
});

test('facts: files relative to cwd, commits, codes and decisions', () => {
  const list = [
    user('do `pc28` now', { cwd: 'C:\\dev\\proj' }),
    asst({ type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: 'C:\\dev\\proj\\server\\a.mjs' } }),
    result('[main e935628] docs: x\n 1 file changed'),
    asst(say('Feito `id111`, `foo`.\n\n**Decisões que tomei**\n- usar A\n- evitar B\n')),
    user('next'),
  ];
  const [c] = chaptersOf(list, { cwd: 'C:\\dev\\proj' });
  assert.deepEqual(c.files, ['server/a.mjs']);
  assert.deepEqual(c.commits, ['e935628 docs: x']);
  assert.deepEqual(c.codes, ['pc28', 'id111']);
  assert.deepEqual(c.decisions, ['usar A', 'evitar B']);
});

const mk = (n, closed) => ({ n, words: `request ${n} ${'w'.repeat(150)}`, start: 0, end: 0, closed, files: ['a.mjs'], commits: [], codes: [], decisions: [] });

test('indexText folds the oldest closed chapters first and keeps the open and newest closed whole', () => {
  const chs = [mk(1, true), mk(2, true), mk(3, true), mk(4, false)];
  const text = indexText(chs, { chapterPath: (n) => `/b/cap-${n}.md`, maxChars: 900 });
  assert.match(text, /# Índice desta conversa/);
  assert.ok(!text.includes('- pedido: request 1'), 'oldest folded');
  assert.match(text, /## Cap\. 1 .* · texto inteiro: \/b\/cap-1\.md/);
  assert.match(text, /- pedido: request 3/);
  assert.match(text, /- pedido: request 4/);
  assert.match(text, /\(em andamento\)/);
});

test('chapterText marks the cut middle', () => {
  const list = [user('go'), asst(say('x'.repeat(5000))), asst(say('y'.repeat(5000)))];
  const [c] = chaptersOf(list);
  const text = chapterText(list, c, { maxChars: 1000 });
  assert.match(text, /meio do capítulo cortado/);
  assert.ok(text.length < 1100);
});

test('acceptTidy keeps a clean title and drops one naming an unknown file, code or sha', () => {
  const chs = [{ ...mk(1, true), files: ['server/a.mjs'], commits: ['e935628 docs: x'], codes: ['pc28'] }, mk(2, false)];
  const one = (title) => acceptTidy({ chapters: [{ n: 1, title, summary: 'ok' }] }, chs).chapters[1].title;
  assert.equal(one('Ajuste em a.mjs fecha o pc28 no commit e935628'), 'Ajuste em a.mjs fecha o pc28 no commit e935628');
  assert.equal(acceptTidy({ title: 'Livro da conversa' }, chs).title, 'Livro da conversa');
  assert.equal(acceptTidy({ title: 'Mexeu em server/zzz.mjs' }, chs).title, null);
  assert.equal(one('Mexeu em b.mjs'), null);
  assert.equal(one('Fecha pc99'), null);
  assert.equal(one('Commit abc1234f'), null);
});
