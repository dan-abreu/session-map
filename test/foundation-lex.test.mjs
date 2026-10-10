import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex, literalAt, lineAt } from '../server/foundation/lex.mjs';
import { lineCount } from '../server/sources/count.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Expected masked text: the given pieces (found in order) are replaced by spaces, everything else is kept.
function masks(text, pieces) {
  let out = '';
  let at = 0;
  for (const piece of pieces) {
    const i = text.indexOf(piece, at);
    assert.notEqual(i, -1, `test bug: "${piece}" not found after offset ${at}`);
    out += text.slice(at, i) + piece.replace(/[^\r\n]/g, ' ');
    at = i + piece.length;
  }
  return out + text.slice(at);
}
const expectMasked = (text, type, pieces) => assert.equal(lex(text, type).masked, masks(text, pieces));
const commentFlags = (text, type) => lex(text, type).lines.map((l) => l.comment);

// ---------- JS / TS ----------

test('js: a line comment is masked and the code before it stays', () => {
  expectMasked('const a = 1; // app.get("/x")\nfoo();', 'js', ['// app.get("/x")']);
  assert.deepEqual(commentFlags('const a = 1; // x\n// only\nfoo();', 'js'), [false, true, false]);
});

test('js: // inside a string (a URL) is not a comment', () => {
  const t = "const u = 'http://acme.example/a'; // real";
  expectMasked(t, 'js', ['http://acme.example/a', '// real']);
  assert.equal(lex(t, 'js').lines[0].comment, false);
});

test('js: comment markers inside a string do not open a comment', () => {
  const t = 'const s = "/* nope */"; foo();\nbar();';
  expectMasked(t, 'js', ['/* nope */']);
  assert.deepEqual(commentFlags(t, 'js'), [false, false]);
});

test('js: quotes inside a comment do not open a string', () => {
  const t = "// it's \"quoted\nconst ok = 'v';\n/* don't */ run();";
  expectMasked(t, 'js', ['// it\'s "quoted', 'v', "/* don't */"]);
  assert.deepEqual(commentFlags(t, 'js'), [true, false, false]);
});

test('js: a block comment over many lines marks only the lines fully inside it', () => {
  const t = 'a();\n/* one\n\n   two */\nb(); /* tail */\n/* x */ c();';
  const f = lex(t, 'js').lines;
  assert.deepEqual(f.map((l) => l.comment), [false, true, false, true, false, false]);
  assert.deepEqual(f.map((l) => l.blank), [false, false, true, false, false, false]);
  expectMasked(t, 'js', ['/* one\n\n   two */', '/* tail */', '/* x */']);
});

test('js: escaped quotes keep the string open', () => {
  const t = "const s = 'it\\'s // still string'; // c";
  expectMasked(t, 'js', ["it\\'s // still string", '// c']);
});

test('js: template literal with nested ${} and a template inside it', () => {
  const t = 'const s = `a ${ fn(\'x\') + `c ${d} //` } e // z`; g();';
  expectMasked(t, 'js', ['a ', 'x', 'c ', ' //', ' e // z']);
});

test('js: text inside a template is masked, code inside ${} is kept', () => {
  const t = 'const q = `app.get("/x") ${ app.get("/y") }`;';
  const m = lex(t, 'js').masked;
  assert.ok(!m.includes('/x'));
  assert.ok(m.includes('app.get("  ")'), 'code in ${} keeps its call, only the string is masked');
});

test('js: braces in a template expression do not end it early', () => {
  const t = 'const s = `a ${ {k: 1}.k } b ${ ({}).x }`; // end\nnext();';
  expectMasked(t, 'js', ['a ', ' b ', '// end']);
});

test('js: regex literal is masked where a regex can start, division is not', () => {
  const t = 'const r = /\\/\\/ app.get\\(\'/g; const x = a / b / c;';
  expectMasked(t, 'js', ["\\/\\/ app.get\\('"]);
});

test('js: regex after return and after an open paren, with a slash in a class', () => {
  const t = 'function f(s) { return /[/"\']+/.test(s) && g(/x\\/y/); }';
  expectMasked(t, 'js', ['[/"\']+', 'x\\/y']);
});

test('js: a slash with no closing slash on the line is a division, never a runaway regex', () => {
  const t = 'const x = (a) / 2;\nconst y = i++ / 2; // note';
  expectMasked(t, 'js', ['// note']);
});

test('js: JSX closing tags are not regexes', () => {
  const t = 'const v = <a>x</a>;\nconst w = <b>y</b>; // c';
  expectMasked(t, 'tsx', ['// c']);
});

test('js: an apostrophe in JSX text only hurts its own line', () => {
  const t = "const a = <p>don't</p>;\nconst b = 'x'; // c\n";
  const m = lex(t, 'tsx').masked.split('\n');
  assert.equal(m[1], "const b = ' '; " + ' '.repeat('// c'.length));
});

test('js: .mjs .cjs and .ts share the same rules', () => {
  for (const type of ['mjs', 'cjs', 'ts', 'jsx', 'tsx', 'js']) expectMasked('a(); // c', type, ['// c']);
});

test('js: CRLF files keep their \\r and the line list matches lineCount', () => {
  const t = 'a();\r\n// c\r\n\r\nb();\r\n';
  const r = lex(t, 'js');
  assert.equal(r.masked.length, t.length);
  assert.equal(r.masked, 'a();\r\n    \r\n\r\nb();\r\n');
  assert.equal(r.lines.length, lineCount(Buffer.from(t)));
  assert.deepEqual(r.lines.map((l) => l.comment), [false, true, false, false]);
  assert.deepEqual(r.lines.map((l) => l.blank), [false, false, true, false]);
});

test('lines: empty text has no lines, a missing final newline still counts the last line', () => {
  assert.deepEqual(lex('', 'js').lines, []);
  assert.equal(lex('a\nb', 'js').lines.length, 2);
  assert.equal(lex('a\nb\n', 'js').lines.length, 2);
  assert.equal(lex('a\n\n', 'js').lines.length, 2);
});

test('other types: nothing masked and no comment lines', () => {
  const t = '// not a comment here\n{"a": "b"}\n<!-- x -->';
  for (const type of ['json', 'md', 'html', 'blade', 'other', 'weird']) {
    const r = lex(t, type);
    assert.equal(r.masked, t);
    assert.deepEqual(r.lines.map((l) => l.comment), [false, false, false]);
  }
  assert.deepEqual(lex('a\n\nb', 'json').lines.map((l) => l.blank), [false, true, false]);
});

// ---------- Dart ----------

test('dart: // and /// are comments, URLs in strings are not', () => {
  const t = "/// docs\nfinal u = Uri.parse('https://api.acme.example/x'); // c";
  expectMasked(t, 'dart', ['/// docs', 'https://api.acme.example/x', '// c']);
  assert.deepEqual(commentFlags(t, 'dart'), [true, false]);
});

test('dart: block comments nest', () => {
  const t = 'a(); /* outer /* inner */ still outer */ b();';
  expectMasked(t, 'dart', ['/* outer /* inner */ still outer */']);
});

test("dart: ''' strings span lines and hold comment markers and quotes", () => {
  const t = "final s = '''\n// not a comment\nit's \"fine\"\n'''; // real\nfoo();";
  expectMasked(t, 'dart', ["\n// not a comment\nit's \"fine\"\n", '// real']);
  assert.deepEqual(commentFlags(t, 'dart'), [false, false, false, false, false]);
});

test('dart: """ strings work the same', () => {
  const t = 'final s = """\n// x\n"""; // c';
  expectMasked(t, 'dart', ['\n// x\n', '// c']);
});

test("dart: r'...' is raw, a backslash does not escape the quote", () => {
  const t = "final p = r'C:\\dir\\'; // c\nfoo();";
  expectMasked(t, 'dart', ['C:\\dir\\', '// c']);
});

test('dart: ${} interpolation keeps its code and may hold strings', () => {
  const t = "final s = 'a ${b + 'c'} d // e'; // z";
  expectMasked(t, 'dart', ['a ', 'c', ' d // e', '// z']);
});

test('dart: a single-quoted string ends at the line break, not later', () => {
  const t = "final s = 'oops;\nfoo(); // c";
  expectMasked(t, 'dart', ['oops;', '// c']);
});

// ---------- PHP ----------

test('php: //, # and /* */ are comments, #[Attr] is code', () => {
  const t = "<?php\n#[Route('/x')]\n// a\n# b\n/* c */\n$x = 1; # tail\n";
  expectMasked(t, 'php', ['/x', '// a', '# b', '/* c */', '# tail']);
  assert.deepEqual(commentFlags(t, 'php'), [false, false, true, true, true, false]);
});

test('php: heredoc and nowdoc bodies are masked, the closing id stays', () => {
  const t = "<?php\n$a = <<<EOT\n  Route::get('/x'); // no\n  # nor this\nEOT;\n$b = <<<'RAW'\nRoute::post('/y');\nRAW;\nreal(); // c\n";
  expectMasked(t, 'php', ["  Route::get('/x'); // no\n  # nor this\n", "Route::post('/y');\n", '// c']);
  const f = lex(t, 'php').lines.map((l) => l.comment);
  assert.equal(f.filter(Boolean).length, 0, 'no heredoc line counts as a comment line');
});

test('php: quoted heredoc id and an indented closing id', () => {
  const t = '<?php\n$a = <<<"X"\n  text // x\n  X;\nok();\n';
  expectMasked(t, 'php', ['  text // x\n']);
});

test('php: single and double quoted strings, escapes, and {$ } interpolation', () => {
  const t = "<?php\n$a = 'it\\'s // x'; $b = \"say \\\"hi\\\" # y {$c['k']} z\"; // c\n";
  expectMasked(t, 'php', ["it\\'s // x", 'say \\"hi\\" # y ', 'k', ' z', '// c']);
});

test('php: ?> returns to html, which is left as is, and ends a // comment', () => {
  const t = '<html>// not php\n<?php foo(); // c ?>\n<b>x # y</b>\n<?php bar(); ?>';
  expectMasked(t, 'php', ['// c ']);
});

test('php: a file with no <? at all is read as php', () => {
  expectMasked("Route::get('/x'); // c", 'php', ['/x', '// c']);
});

// ---------- Prisma, CSS, SQL, shell, YAML ----------

test('prisma: // and /// are comments, a commented model stays commented', () => {
  const t = '/// doc\n// model Fake {\nmodel User {\n  id Int @id\n  url String @default("http://x//y") // c\n}\n';
  expectMasked(t, 'prisma', ['/// doc', '// model Fake {', 'http://x//y', '// c']);
  assert.deepEqual(commentFlags(t, 'prisma'), [true, true, false, false, false, false]);
});

test('css: block comments and quoted urls', () => {
  const t = '/* a\n b */\na { background: url("http://x/y.png"); /* c */ color: red }\n';
  expectMasked(t, 'css', ['/* a\n b */', 'http://x/y.png', '/* c */']);
  assert.deepEqual(commentFlags(t, 'css'), [true, true, false]);
});

test('css: // is not a comment', () => {
  expectMasked('a { background: url(//cdn.example/x.png) }', 'css', []);
});

test("sql: -- and /* */ are comments, '--' in a string and doubled quotes are not", () => {
  const t = "-- head\nSELECT 'a -- b', 'it''s /* x */' FROM t; -- c\n/* m\n*/\nSELECT \"col--name\" FROM u;";
  expectMasked(t, 'sql', ['-- head', 'a -- b', "it''s /* x */", '-- c', '/* m\n*/']);
  assert.deepEqual(commentFlags(t, 'sql'), [true, false, true, true, false]);
});

test('sh: # starts a comment at the line start or after a space only', () => {
  const t = '#!/bin/sh\necho $# ${#a} a#b "x # y" \'z # w\' # real\nls # c\n';
  expectMasked(t, 'sh', ['#!/bin/sh', 'x # y', 'z # w', '# real', '# c']);
  assert.deepEqual(commentFlags(t, 'sh'), [true, false, false]);
});

test('sh: heredoc bodies are masked', () => {
  const t = "cat <<EOF\n# not a comment, don't worry\nEOF\n# real\n";
  expectMasked(t, 'sh', ["# not a comment, don't worry\n", '# real']);
});

test('sh: an unterminated quote is literal and does not swallow the file', () => {
  const t = "echo don't\n# real\n";
  expectMasked(t, 'sh', ['# real']);
});

test('yaml: comments need a space before the #, quoted values hide their #', () => {
  const t = '# top\nkey: "v # not"  # real\nurl: http://x/#frag\nname: it\'s fine\nlist:\n  - \'a # b\'\n';
  expectMasked(t, 'yaml', ['# top', 'v # not', '# real', 'a # b']);
  assert.deepEqual(commentFlags(t, 'yaml'), [true, false, false, false, false, false]);
});

// ---------- literalAt / lineAt ----------

test('literalAt: pure literals give the value and where they end', () => {
  const t = 'app.get("/orders/:id", h)';
  const at = t.indexOf('"');
  assert.deepEqual(literalAt(t, at), { value: '/orders/:id', end: at + '"/orders/:id"'.length });
  assert.deepEqual(literalAt("x('a\\'b\\n')", 2), { value: "a'b\n", end: 10 });
});

test('literalAt: template with ${}, newline and unterminated give null', () => {
  assert.equal(literalAt('f(`/a/${id}`)', 2), null);
  assert.deepEqual(literalAt('f(`/a/b`)', 2), { value: '/a/b', end: 8 });
  assert.equal(literalAt("f('abc\nd')", 2), null);
  assert.equal(literalAt("f('abc", 2), null);
  assert.equal(literalAt('f(x)', 2), null);
  assert.equal(literalAt('f("a")', 99), null);
});

test('literalAt: with a type it knows dart and php interpolation', () => {
  assert.equal(literalAt("f('a/$id')", 2, 'dart'), null);
  assert.equal(literalAt("f('a/${id}')", 2, 'dart'), null);
  assert.deepEqual(literalAt("f('cost: $5')", 2, 'dart'), { value: 'cost: $5', end: 12 });
  assert.deepEqual(literalAt("f(r'a/$id')", 2, 'dart'), { value: 'a/$id', end: 10 });
  assert.deepEqual(literalAt("f('''a\nb''')", 2, 'dart'), { value: 'a\nb', end: 11 });
  assert.equal(literalAt('f("a/$id")', 2, 'php'), null);
  assert.equal(literalAt('f("a/{$id}")', 2, 'php'), null);
  assert.deepEqual(literalAt("f('a/$id')", 2, 'php'), { value: 'a/$id', end: 9 });
  assert.deepEqual(literalAt("f('a/$id')", 2), { value: 'a/$id', end: 9 });
});

test('lineAt: 1-based line of an offset', () => {
  const t = 'a\nbb\r\nccc';
  assert.equal(lineAt(t, 0), 1);
  assert.equal(lineAt(t, 1), 1);
  assert.equal(lineAt(t, 2), 2);
  assert.equal(lineAt(t, t.indexOf('c')), 3);
  assert.equal(lineAt(t, t.length), 3);
});

// ---------- properties on real code ----------

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}
const TYPE_OF = { '.mjs': 'js', '.js': 'js', '.css': 'css', '.yml': 'yaml', '.json': 'json', '.md': 'md', '.html': 'html' };
const nlPositions = (s) => { const r = []; for (let i = 0; i < s.length; i++) if (s[i] === '\n' || s[i] === '\r') r.push(i); return r; };

test('every file of this repository keeps its length and its line breaks', () => {
  const files = ['server', 'test', 'scripts', 'hooks', '.github']
    .map((d) => join(ROOT, d)).filter(existsSync)
    .flatMap((d) => walk(d, Object.keys(TYPE_OF)));
  assert.ok(files.length > 100);
  const texts = files.map((f) => [f, readFileSync(f, 'utf8')]);
  const start = Date.now();
  for (const [f, text] of texts) {
    const r = lex(text, TYPE_OF[extname(f)]);
    assert.equal(r.masked.length, text.length, f);
    assert.deepEqual(nlPositions(r.masked), nlPositions(text), f);
    assert.equal(r.lines.length, lineCount(Buffer.from(text)), f);
  }
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`);
});

test('after masking, the braces of this repository code balance (strings, regexes and comments are really gone)', () => {
  const files = ['server', 'scripts', 'hooks'].map((d) => join(ROOT, d)).filter(existsSync).flatMap((d) => walk(d, ['.mjs', '.js']));
  assert.ok(files.length > 50);
  const bad = [];
  for (const f of files) {
    const m = lex(readFileSync(f, 'utf8'), 'js').masked;
    const count = (re) => (m.match(re) ?? []).length;
    for (const [o, c] of [[/\{/g, /\}/g], [/\(/g, /\)/g], [/\[/g, /\]/g]]) {
      if (count(o) !== count(c)) bad.push(`${f}: ${o} ${count(o)} vs ${count(c)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a hand-written tricky snippet of each language never throws and keeps its length', () => {
  const samples = {
    js: "`${`${`${1}`}`}` /a/ '\\\n' \"\\", dart: "'''${'''", php: '<?php <<<A\nA', sh: "<<'X'\n\"", yaml: '"\'', sql: "'", css: '/*', prisma: '"', ts: '`${',
  };
  for (const [type, text] of Object.entries(samples)) {
    const r = lex(text, type);
    assert.equal(r.masked.length, text.length, type);
  }
});

// ---------- fixtures (once the fixture repositories exist) ----------

const FIX = join(ROOT, 'test', 'fixtures', 'repos');
test('fixture repositories: every readable file lexes with its length and line breaks intact', { skip: !existsSync(FIX) && 'fixture repositories not created yet' }, () => {
  const types = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.dart': 'dart', '.php': 'php', '.prisma': 'prisma', '.css': 'css', '.sql': 'sql', '.sh': 'sh', '.yml': 'yaml', '.yaml': 'yaml' };
  const files = walk(FIX, Object.keys(types));
  const start = Date.now();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const r = lex(text, types[extname(f)]);
    assert.equal(r.masked.length, text.length, f);
    assert.deepEqual(nlPositions(r.masked), nlPositions(text), f);
  }
  assert.ok(Date.now() - start < 1000);
});

test('fixture answers: the comment and blank lines counted by hand match the lexer', { skip: !existsSync(FIX) && 'fixture repositories not created yet' }, () => {
  const types = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.dart': 'dart', '.php': 'php', '.prisma': 'prisma', '.css': 'css', '.sql': 'sql', '.sh': 'sh', '.yml': 'yaml', '.yaml': 'yaml' };
  let checked = 0;
  for (const name of readdirSync(FIX).filter((f) => f.endsWith('.answer.json'))) {
    const repo = name.replace(/\.answer\.json$/, '');
    const answer = JSON.parse(readFileSync(join(FIX, name), 'utf8'));
    const entries = Array.isArray(answer.counts)
      ? answer.counts.map((c) => [c.path ?? c.file, c])
      : Object.entries(answer.counts ?? {});
    for (const [path, c] of entries) {
      const type = types[extname(String(path))];
      if (!type || typeof c?.comment !== 'number') continue;
      const lines = lex(readFileSync(join(FIX, repo, path), 'utf8'), type).lines;
      assert.equal(lines.filter((l) => l.comment).length, c.comment, `${repo}/${path}: comment lines`);
      if (typeof c.blank === 'number') assert.equal(lines.filter((l) => l.blank).length, c.blank, `${repo}/${path}: blank lines`);
      checked++;
    }
  }
  if (!checked) assert.ok(true, 'no hand counts to compare yet');
});
