import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../server/web/md.js';

test('parseInline: bold, italic, code, strike and safe links', () => {
  assert.deepEqual(parseInline('a **b** _c_ `d` ~~e~~'), ['a ', { t: 'b', c: ['b'] }, ' ', { t: 'i', c: ['c'] }, ' ', { t: 'code', v: 'd' }, ' ', { t: 's', c: ['e'] }]);
  assert.deepEqual(parseInline('see [docs](https://x.dev/a) now'), ['see ', { t: 'a', href: 'https://x.dev/a', c: ['docs'] }, ' now']);
  assert.deepEqual(parseInline('[bad](javascript:alert(1))'), ['bad'], 'only http, https and mailto become links');
  assert.deepEqual(parseInline('go to https://example.com/x.'), ['go to ', { t: 'a', href: 'https://example.com/x', c: ['https://example.com/x'] }, '.']);
  assert.deepEqual(parseInline('`**not bold**`'), [{ t: 'code', v: '**not bold**' }]);
  assert.deepEqual(parseInline('snake_case_name and 2*3*4'), ['snake_case_name and 2*3*4'], 'underscores inside words and lone stars stay text');
});

test('parseMarkdown: headings, paragraphs with line breaks, rules and quotes', () => {
  assert.deepEqual(parseMarkdown('# Title\n\nLine one\nline two\n\n---\n\n> quoted **text**'), [
    { t: 'h', level: 1, c: ['Title'] },
    { t: 'p', c: ['Line one', { t: 'br' }, 'line two'] },
    { t: 'hr' },
    { t: 'quote', c: [{ t: 'p', c: ['quoted ', { t: 'b', c: ['text'] }] }] },
  ]);
});

test('parseMarkdown: fenced code keeps its text and language untouched', () => {
  assert.deepEqual(parseMarkdown('Run:\n```bash\nnpm test **x**\n  indented\n```\nafter'), [
    { t: 'p', c: ['Run:'] },
    { t: 'pre', lang: 'bash', v: 'npm test **x**\n  indented' },
    { t: 'p', c: ['after'] },
  ]);
  assert.deepEqual(parseMarkdown('```\nnever closed'), [{ t: 'pre', lang: '', v: 'never closed' }], 'a reply still streaming');
});

test('parseMarkdown: nested and numbered lists, with task boxes', () => {
  assert.deepEqual(parseMarkdown('- one\n  - inner\n- [x] done\n- [ ] open\n\n3. third\n4. fourth'), [
    { t: 'ul', items: [
      { c: [{ t: 'p', c: ['one'] }, { t: 'ul', items: [{ c: [{ t: 'p', c: ['inner'] }] }] }] },
      { check: true, c: [{ t: 'p', c: ['done'] }] },
      { check: false, c: [{ t: 'p', c: ['open'] }] },
    ] },
    { t: 'ol', start: 3, items: [{ c: [{ t: 'p', c: ['third'] }] }, { c: [{ t: 'p', c: ['fourth'] }] }] },
  ]);
});

test('parseMarkdown: tables with alignment', () => {
  assert.deepEqual(parseMarkdown('| Name | Cost |\n|:--|--:|\n| a | `1` |\n| b | 2 |'), [
    { t: 'table', align: ['left', 'right'], head: [['Name'], ['Cost']], rows: [[['a'], [{ t: 'code', v: '1' }]], [['b'], ['2']]] },
  ]);
});
