import test from 'node:test';
import assert from 'node:assert/strict';
import { ghSlug, headingsOf, anchorsOf, linksOf, resolveLink, brokenLinks, maskCode, codeSpansOf } from '../server/foundation/mdlinks.mjs';

test('ghSlug follows the GitHub rule: lower case, drop punctuation, spaces become hyphens', () => {
  assert.equal(ghSlug('Hello World'), 'hello-world');
  assert.equal(ghSlug('What is `lex`?'), 'what-is-lex');
  assert.equal(ghSlug('Visão geral:ação & notas'), 'visão-geralação--notas');
  assert.equal(ghSlug('snake_case and kebab-case'), 'snake_case-and-kebab-case');
  assert.equal(ghSlug('A **bold** [link](http://x.y) and <b>tag</b>'), 'a-bold-link-and-tag');
  assert.equal(ghSlug('Version 1.2.3'), 'version-123');
  assert.equal(ghSlug('🚀 Launch'), '-launch');
});

test('ghSlug numbers repeated headings with -1, -2 and never reuses a taken slug', () => {
  const seen = new Map();
  assert.equal(ghSlug('Setup', seen), 'setup');
  assert.equal(ghSlug('Setup', seen), 'setup-1');
  assert.equal(ghSlug('Setup', seen), 'setup-2');
  assert.equal(ghSlug('Setup 1', seen), 'setup-1-1');
  const clash = new Map();
  assert.equal(ghSlug('Foo', clash), 'foo');
  assert.equal(ghSlug('Foo-1', clash), 'foo-1');
  assert.equal(ghSlug('Foo', clash), 'foo-2');
});

test('headingsOf reads ATX and setext headings with their line, level and slug', () => {
  const text = ['# Title', '', '## Part one ##', 'text', '', 'Setext head', '-----', '', 'Big', '===', '', '#nospace', '    # indented code', '### Part one'].join('\n');
  const hs = headingsOf(text);
  assert.deepEqual(hs.map((h) => [h.line, h.level, h.text, h.slug]), [
    [1, 1, 'Title', 'title'],
    [3, 2, 'Part one', 'part-one'],
    [6, 2, 'Setext head', 'setext-head'],
    [9, 1, 'Big', 'big'],
    [14, 3, 'Part one', 'part-one-1'],
  ]);
});

test('headingsOf ignores headings inside backtick and tilde fences', () => {
  const text = ['# Real', '```md', '# Fake', '```', '~~~', '## Also fake', '~~~', '````', '```', '## still fake', '````', '## After'].join('\n');
  assert.deepEqual(headingsOf(text).map((h) => h.text), ['Real', 'After']);
});

test('headingsOf does not read the closing line of front matter as a setext heading', () => {
  const text = ['---', 'title: Page', 'tags: [a, b]', '---', '', '# Body'].join('\n');
  assert.deepEqual(headingsOf(text).map((h) => h.text), ['Body']);
});

test('headingsOf reads CRLF files the same way', () => {
  const hs = headingsOf('# One\r\n\r\n## Two words\r\n');
  assert.deepEqual(hs.map((h) => [h.text, h.slug]), [['One', 'one'], ['Two words', 'two-words']]);
});

test('anchorsOf adds the id and name attributes written as HTML', () => {
  const a = anchorsOf('# Intro\n\n<a id="custom-spot"></a>\n<h2 id=\'other\'>x</h2>\n<a name="old-style"></a>\n');
  assert.ok(a.has('intro') && a.has('custom-spot') && a.has('other') && a.has('old-style'));
});

test('linksOf finds inline links, images, references and HTML links with their lines', () => {
  const text = [
    'See [the guide](docs/guide.md#setup "Guide") now.',
    '![logo](img/logo.png)',
    '[ref]: ../other.md#top',
    '<a href="pages/x.html">x</a> <img src=\'img/y.png\'>',
  ].join('\n');
  const ls = linksOf(text);
  assert.deepEqual(ls.map((l) => [l.line, l.kind, l.target, l.path, l.anchor, l.external]), [
    [1, 'inline', 'docs/guide.md#setup', 'docs/guide.md', 'setup', false],
    [2, 'image', 'img/logo.png', 'img/logo.png', null, false],
    [3, 'reference', '../other.md#top', '../other.md', 'top', false],
    [4, 'html', 'pages/x.html', 'pages/x.html', null, false],
    [4, 'html', 'img/y.png', 'img/y.png', null, false],
  ]);
});

test('linksOf marks http, https, mailto and protocol-relative targets as external', () => {
  const ls = linksOf('[a](https://x.example/p#q) [b](http://x.example) [c](mailto:ana@acme.example) [d](//cdn.example/x.js) [e](tel:123)');
  assert.equal(ls.length, 5);
  for (const l of ls) { assert.equal(l.external, true); assert.equal(l.path, null); assert.equal(l.anchor, null); }
});

test('linksOf ignores links inside fenced code, inline code and HTML comments', () => {
  const text = [
    '```md', '[in fence](gone.md)', '```',
    'text `[in span](gone2.md)` and ``[double `tick` span](gone3.md)``',
    '<!-- [commented](gone4.md) -->',
    '<!--', '[multi](gone5.md)', '-->',
    '[real](here.md)',
  ].join('\n');
  assert.deepEqual(linksOf(text).map((l) => l.target), ['here.md']);
});

test('linksOf handles an image inside a link, parentheses in the target, angle brackets and escapes', () => {
  const ls = linksOf([
    '[![badge](img/b.svg)](docs/index.md)',
    '[paren](docs/a_(b).md)',
    '[spaced](<docs/my file.md> "t")',
    '\\[escaped](nope.md)',
    '[query](page.md?plain=1#frag)',
    '[enc](docs/caf%C3%A9.md#se%C3%A7%C3%A3o)',
    '[same](#local-part)',
    '[empty]()',
  ].join('\n'));
  assert.deepEqual(ls.map((l) => [l.kind, l.path, l.anchor]), [
    ['image', 'img/b.svg', null],
    ['inline', 'docs/index.md', null],
    ['inline', 'docs/a_(b).md', null],
    ['inline', 'docs/my file.md', null],
    ['inline', 'page.md', 'frag'],
    ['inline', 'docs/café.md', 'seção'],
    ['inline', '', 'local-part'],
  ]);
});

test('linksOf does not read footnote definitions as reference links', () => {
  assert.deepEqual(linksOf('Text[^1]\n\n[^1]: A note.\n[lbl]: other.md').map((l) => l.target), ['other.md']);
});

test('maskCode keeps the length and the line breaks; codeSpansOf lists inline code with its line', () => {
  const text = 'a `x` b\n```\nfence\n```\n<!-- c -->\nz ``y ` w``';
  const masked = maskCode(text);
  assert.equal(masked.length, text.length);
  assert.equal(masked.split('\n').length, text.split('\n').length);
  assert.ok(!/[xyfwc]/.test(masked.replace(/[ab z]/g, '')));
  assert.deepEqual(codeSpansOf(text).map((s) => [s.line, s.text]), [[1, 'x'], [6, 'y ` w']]);
});

test('resolveLink normalises relative, parent, root and same-file targets', () => {
  assert.deepEqual(resolveLink('docs/a/b.md', '../c.md#x'), { path: 'docs/c.md', anchor: 'x' });
  assert.deepEqual(resolveLink('docs/a/b.md', './d/e.png'), { path: 'docs/a/d/e.png', anchor: null });
  assert.deepEqual(resolveLink('docs/a/b.md', '/README.md'), { path: 'README.md', anchor: null });
  assert.deepEqual(resolveLink('docs/a/b.md', '#top'), { path: 'docs/a/b.md', anchor: 'top' });
  assert.deepEqual(resolveLink('README.md', 'docs/'), { path: 'docs', anchor: null });
  assert.deepEqual(resolveLink('docs\\a.md', 'b.md'), { path: 'docs/b.md', anchor: null });
  assert.equal(resolveLink('README.md', '../../etc/passwd').path, null);
  assert.equal(resolveLink('README.md', 'https://x.example/a'), null);
});

const docs = {
  'README.md': ['# Acme Shop', '', '## Café & more', '## Setup', '## Setup', '', '[ok](docs/guide.md#install) [bad-file](docs/gone.md) [bad-anchor](docs/guide.md#nope)',
    '[self](#café--more) [self-bad](#café--more-x) [dup](#setup-1) [dup-bad](#setup-2) [up](#user-content-setup) [case](#SETUP)',
    '![img](img/logo.png) ![gone](img/none.png) [dir](docs/) [ext](https://x.example/none.md) [html](docs/guide.md#custom)'].join('\n'),
  'docs/guide.md': ['# Guide', '', '## Install', '<a id="custom"></a>', '', '[back](../README.md#acme-shop) [nested](sub/deep.md) [bad](../missing.md#x)'].join('\n'),
  'docs/sub/deep.md': '# Deep\n\n[up](../../README.md) [code](../../src/app.js#L10)\n',
};
const onDisk = new Set(['img/logo.png', 'src/app.js']);

test('brokenLinks reports missing files and missing anchors with file, line, target and why', () => {
  const out = brokenLinks(docs, (p) => onDisk.has(p));
  assert.deepEqual(out.map((b) => [b.file, b.line, b.target, b.why]), [
    ['README.md', 7, 'docs/gone.md', 'file-missing'],
    ['README.md', 7, 'docs/guide.md#nope', 'anchor-missing'],
    ['README.md', 8, '#café--more-x', 'anchor-missing'],
    ['README.md', 8, '#setup-2', 'anchor-missing'],
    ['README.md', 9, 'img/none.png', 'file-missing'],
    ['docs/guide.md', 6, '../missing.md#x', 'file-missing'],
  ]);
});

test('brokenLinks accepts a Set for existsOnDisk, directories of known files and links that leave the root', () => {
  const out = brokenLinks({ 'a.md': '[d](docs/) [o](../outside.md)', 'docs/x.md': '# X' }, onDisk);
  assert.deepEqual(out.map((b) => [b.target, b.why]), [['../outside.md', 'file-missing']]);
});

test('brokenLinks does not check anchors in files it was not given the text of', () => {
  const out = brokenLinks({ 'a.md': '[x](other.md#anything)' }, new Set(['other.md']));
  assert.deepEqual(out, []);
});

test('brokenLinks: a link to a heading that was renamed is reported', () => {
  const before = brokenLinks({ 'a.md': '[x](b.md#old-name)', 'b.md': '## Old name' }, () => false);
  const after = brokenLinks({ 'a.md': '[x](b.md#old-name)', 'b.md': '## New name' }, () => false);
  assert.equal(before.length, 0);
  assert.deepEqual(after.map((b) => b.why), ['anchor-missing']);
});

test('odd input never throws: unclosed fence, lone brackets, empty and non-string values', () => {
  for (const t of ['```\n[x](y.md)', '[[[[](', ']](', '<!-- open', '`', '``` ``', '', null, undefined, '[a](<b', '[a](b "t']) {
    assert.doesNotThrow(() => { linksOf(t); headingsOf(t); anchorsOf(t); maskCode(t); codeSpansOf(t); });
  }
  assert.deepEqual(linksOf('```\n[x](y.md)'), []);
  assert.deepEqual(brokenLinks({}, () => false), []);
});

test('a long document is read quickly and the repository\'s own Markdown has no unreadable link', () => {
  const big = Array.from({ length: 6000 }, (_, i) => `## Head ${i % 50}\n[l${i}](docs/p${i % 40}.md#head-${i % 50}) and \`code ${i}\``).join('\n');
  const t0 = Date.now();
  const hs = headingsOf(big);
  const ls = linksOf(big);
  assert.equal(hs.length, 6000);
  assert.equal(ls.length, 6000);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
});
