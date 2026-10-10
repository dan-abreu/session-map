import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTree, findInLines, langOf, markTokens, tokenize } from '../server/web/code.js';

const kinds = (line) => line.filter((t) => t.c).map((t) => `${t.c}:${t.s}`);

test('each kind of file gets the colors of its language, or none', () => {
  assert.equal(langOf('src/a.ts'), 'js');
  assert.equal(langOf('web/style.css'), 'css');
  assert.equal(langOf('index.html'), 'markup');
  assert.equal(langOf('package.json'), 'json');
  assert.equal(langOf('README.md'), 'md');
  assert.equal(langOf('tool.py'), 'py');
  assert.equal(langOf('run.sh'), 'sh');
  assert.equal(langOf('ci.yml'), 'yaml');
  assert.equal(langOf('LICENSE'), null);
});

test('code is split into colored pieces line by line, keeping every character', () => {
  const text = "const n = 42; // the answer\nconst s = 'hi';\n/* two\nlines */ return n;";
  const lines = tokenize(text, 'js');
  assert.equal(lines.length, 4);
  assert.equal(lines.map((l) => l.map((t) => t.s).join('')).join('\n'), text, 'nothing lost, nothing added');
  assert.deepEqual(kinds(lines[0]), ['kw:const', 'num:42', 'com:// the answer']);
  assert.deepEqual(kinds(lines[1]), ['kw:const', "str:'hi'"]);
  assert.deepEqual(kinds(lines[2]), ['com:/* two'], 'a comment over two lines stays a comment on both');
  assert.deepEqual(kinds(lines[3]), ['com:lines */', 'kw:return']);
});

test('other languages: keys, tags, headings and comments', () => {
  assert.deepEqual(kinds(tokenize('{"name": "x", "n": 1, "ok": true}', 'json')[0]), ['key:"name"', 'str:"x"', 'key:"n"', 'num:1', 'key:"ok"', 'kw:true']);
  assert.deepEqual(kinds(tokenize('<a href="x">hi</a><!-- c -->', 'markup')[0]), ['tag:<a', 'attr:href', 'str:"x"', 'tag:>', 'tag:</a', 'tag:>', 'com:<!-- c -->']);
  assert.deepEqual(kinds(tokenize('# Title\nplain `code` here', 'md')[0]), ['head:# Title']);
  assert.deepEqual(kinds(tokenize('# Title\nplain `code` here', 'md')[1]), ['str:`code`']);
  assert.deepEqual(kinds(tokenize('def f(x):  # note\n    return "y"', 'py')[0]), ['kw:def', 'com:# note']);
  assert.deepEqual(kinds(tokenize('.a { color: red; } /* c */ @media x', 'css')[0]), ['com:/* c */', 'kw:@media']);
  assert.deepEqual(tokenize('just text', null), [[{ c: null, s: 'just text' }]]);
});

test('a search finds every match in the file, ignoring case, and marks it inside the colored pieces', () => {
  const lines = ['const Cart = 1;', 'no', 'cart(cart)'];
  assert.deepEqual(findInLines(lines, 'cart'), [{ line: 0, from: 6, to: 10 }, { line: 2, from: 0, to: 4 }, { line: 2, from: 5, to: 9 }]);
  assert.deepEqual(findInLines(lines, ''), []);
  const toks = tokenize('const Cart = 1;', 'js')[0];
  const marked = markTokens(toks, [{ from: 4, to: 8 }]);
  assert.equal(marked.map((t) => t.s).join(''), 'const Cart = 1;');
  assert.equal(marked.filter((t) => t.hit).map((t) => t.s).join(''), 't Ca', 'the match spans a keyword and plain text');
  assert.ok(marked.some((t) => t.hit && t.c === 'kw'), 'a marked piece keeps its color');
});

test('the files of a box become a folder tree like the editor shows, with single-folder chains joined', () => {
  const tree = fileTree([{ path: 'server/web/app.js' }, { path: 'server/web/style.css' }, { path: 'server/main.mjs' }, { path: 'docs/a/b/c.md' }, { path: 'README.md' }]);
  const show = (node, depth = 0) => [
    ...node.dirs.flatMap((d) => [`${'  '.repeat(depth)}${d.name}/`, ...show(d, depth + 1)]),
    ...node.files.map((f) => `${'  '.repeat(depth)}${f.name}`),
  ];
  assert.deepEqual(show(tree), ['docs/a/b/', '  c.md', 'server/', '  web/', '    app.js', '    style.css', '  main.mjs', 'README.md']);
  assert.equal(tree.dirs[1].count, 3, 'a folder counts the files inside it');
  assert.equal(tree.dirs[1].path, 'server');
  assert.equal(tree.dirs[0].path, 'docs/a/b');
});
