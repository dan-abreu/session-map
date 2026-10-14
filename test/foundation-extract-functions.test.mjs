import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../server/foundation/lex.mjs';
import { resolveSpec, projectContext } from '../server/imports.mjs';
import { extract, importNames, linkCalls, extractFunctions, VERSION, TYPES } from '../server/foundation/extract/functions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOS = join(HERE, 'fixtures', 'repos');
const KINDS = new Set(['function', 'export', 'call']);
const TYPE_OF = { ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', dart: 'dart', php: 'php' };

function typeOf(path) {
  if (path.endsWith('.blade.php')) return null;
  return TYPE_OF[path.split('.').pop()] ?? null;
}

function walk(root, dir = '') {
  const out = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') out.push(...walk(root, rel)); } else out.push(rel);
  }
  return out;
}

// What the index (B1-T14) hands in: every code file with its text, its masked text and its imports already resolved to
// project files ({ name, imported, file }); names that point at a library are left out.
function fixtureEntries(name) {
  const root = join(REPOS, name);
  const all = walk(root);
  const files = new Set(all);
  const ctx = projectContext(root, files);
  const entries = [];
  for (const path of all) {
    const type = typeOf(path);
    if (!type) continue;
    const text = readFileSync(join(root, path), 'utf8');
    const masked = lex(text, type).masked;
    const imports = [];
    for (const imp of importNames({ path, type, text, masked })) {
      const file = resolveSpec(path, imp.spec, files, ctx);
      if (file) imports.push({ name: imp.name, imported: imp.imported, file });
    }
    entries.push({ path, type, text, masked, imports });
  }
  return entries;
}

const answerOf = (name) => JSON.parse(readFileSync(join(REPOS, `${name}.answer.json`), 'utf8'));
const expected = (answer) => [...answer.facts, ...(answer.extraFacts ?? [])].filter((f) => KINDS.has(f.kind));
const key = (f) => `${f.id} | ${f.kind} | ${f.file}:${f.line} | ${f.origin}`;

function checkFixture(name) {
  const answer = answerOf(name);
  const got = extractFunctions(fixtureEntries(name));
  const want = expected(answer);
  assert.deepEqual(got.map(key).sort(), want.map(key).sort());
  for (const w of want) {
    const g = got.find((f) => f.id === w.id);
    for (const [k, v] of Object.entries(w.attrs ?? {})) assert.deepEqual(g.attrs[k], v, `${w.id} attrs.${k}`);
    if (w.origin === 'AMBIGUOUS') {
      assert.deepEqual([...g.attrs.candidates].sort(), [...w.candidates].sort(), `${w.id} candidates`);
      assert.deepEqual(g.refs.map((r) => `${r.file}:${r.line}`).sort(), w.refs.map((r) => `${r.file}:${r.line}`).sort());
    }
  }
  return got;
}

function run(text, path = 'src/a.ts', type) {
  const t = type ?? typeOf(path);
  return extract({ path, type: t, text, masked: lex(text, t).masked });
}
function project(files) {
  return extractFunctions(files.map(({ path, text, imports = [] }) => {
    const type = typeOf(path);
    return { path, type, text, masked: lex(text, type).masked, imports };
  }));
}
const fnOf = (facts, id) => facts.find((f) => f.id === id);
const idsOf = (facts, kind) => facts.filter((f) => f.kind === kind).map((f) => f.id).sort();

test('declares its version and the code types it reads', () => {
  assert.equal(VERSION, 'functions@1');
  assert.deepEqual(TYPES, ['js', 'ts', 'tsx', 'jsx', 'dart', 'php']);
});

test('acme-shop: functions, exports and calls are exactly the answer key', () => {
  const got = checkFixture('acme-shop');
  const send = got.find((f) => f.id === 'call:fn:apps/api/src/services/orders.ts#placeOrder->?send');
  assert.equal(send.origin, 'AMBIGUOUS');
  assert.equal(send.attrs.callee, 'send');
  assert.equal(send.attrs.candidates.length, 2);
});

test('acme-delivery: Dart and PHP functions and calls are exactly the answer key', () => {
  checkFixture('acme-delivery');
});

test('acme-lib: three exported functions, one private, one call', () => {
  const got = checkFixture('acme-lib');
  const exported = got.filter((f) => f.kind === 'function' && f.attrs.exported);
  assert.deepEqual(exported.map((f) => f.id).sort(), ['fn:src/index.js#isSlug', 'fn:src/index.js#slugify', 'fn:src/index.js#truncate']);
});

test('every fact carries the extractor, a name and no sha', () => {
  for (const f of extractFunctions(fixtureEntries('acme-shop'))) {
    assert.equal(f.extractor, 'functions@1');
    assert.equal(f.name, f.id.slice(f.id.indexOf(':') + 1));
    assert.equal(f.sha, undefined);
    assert.ok(Array.isArray(f.refs));
  }
});

test('a function inside a string or a comment is not a fact', () => {
  const text = [
    '/* export function ghostA() {} */',
    "const s = 'function ghostB() { return 1 }';",
    'const t = `export function ghostC() {} ${"x"}`;',
    '// function ghostD() {}',
    'export function real() { return 1; }',
  ].join('\n');
  const { facts } = run(text, 'src/a.js');
  assert.deepEqual(idsOf(facts, 'function'), ['fn:src/a.js#real']);
  assert.deepEqual(idsOf(facts, 'export'), ['export:src/a.js#real']);
});

test('endLine counts only real braces: a brace inside a string, a template or a comment does not count', () => {
  const text = [
    'function a() {',
    "  const x = '}';",
    '  return x;',
    '}',
    'function b() {',
    '  return `${"}"} {`;',
    '}',
    'function c() {',
    '  // } closes nothing',
    '  const r = /}/;',
    '  return r;',
    '}',
  ].join('\n');
  const { facts } = run(text, 'src/a.js');
  assert.equal(fnOf(facts, 'fn:src/a.js#a').attrs.endLine, 4);
  assert.equal(fnOf(facts, 'fn:src/a.js#b').attrs.endLine, 7);
  assert.equal(fnOf(facts, 'fn:src/a.js#c').attrs.endLine, 12);
});

test('endLine in Dart and PHP skips braces in strings', () => {
  const dart = ["String a() {", "  return '}';", '}', 'String b() {', "  return '''", '}', "''';", '}'].join('\n');
  const d = run(dart, 'lib/a.dart').facts;
  assert.equal(fnOf(d, 'fn:lib/a.dart#a').attrs.endLine, 3);
  assert.equal(fnOf(d, 'fn:lib/a.dart#b').attrs.endLine, 8);
  const php = ['<?php', 'function a() {', "  return '}'; # }", '}', 'function b() {', '  return <<<T', '}', 'T;', '}'].join('\n');
  const p = run(php, 'src/a.php').facts;
  assert.equal(fnOf(p, 'fn:src/a.php#a').attrs.endLine, 4);
  assert.equal(fnOf(p, 'fn:src/a.php#b').attrs.endLine, 9);
});

test('an arrow without braces ends where its expression ends', () => {
  const text = [
    'export const one = (a) => a + 1;',
    'const two = async (a: number): Promise<number> =>',
    '  a * 2;',
    'const obj = {',
    '  three: (x) => x,',
    '  four() { return 4; },',
    '};',
  ].join('\n');
  const { facts } = run(text);
  assert.deepEqual(
    facts.filter((f) => f.kind === 'function').map((f) => [f.id, f.line, f.attrs.endLine, f.attrs.async]),
    [
      ['fn:src/a.ts#one', 1, 1, false],
      ['fn:src/a.ts#two', 2, 3, true],
      ['fn:src/a.ts#obj.three', 5, 5, false],
      ['fn:src/a.ts#obj.four', 6, 6, false],
    ],
  );
});

test('JS/TS: classes, object methods, export clauses and default exports', () => {
  const text = [
    'class Store {',
    '  static create(): Store { return new Store(); }',
    '  async load(id: string) { return this.read(id); }',
    '  private read(id: string): string { return id; }',
    '  handle = async (e) => { await this.load(e); };',
    '  get size() { return 0; }',
    '  constructor() {}',
    '  overload(a: string): void;',
    '  overload(a: any) {}',
    '}',
    'function helper() {}',
    'export { Store, helper as aid };',
    'export default function () {}',
    'export type T = { a: 1 };',
    'export interface I { a(): void }',
  ].join('\n');
  const { facts } = run(text);
  assert.deepEqual(idsOf(facts, 'function'), [
    'fn:src/a.ts#Store.constructor', 'fn:src/a.ts#Store.create', 'fn:src/a.ts#Store.handle', 'fn:src/a.ts#Store.load',
    'fn:src/a.ts#Store.overload', 'fn:src/a.ts#Store.read', 'fn:src/a.ts#default', 'fn:src/a.ts#helper',
  ]);
  assert.equal(fnOf(facts, 'fn:src/a.ts#Store.load').attrs.exported, true);
  assert.equal(fnOf(facts, 'fn:src/a.ts#Store.load').attrs.async, true);
  assert.equal(fnOf(facts, 'fn:src/a.ts#Store.overload').line, 9);
  assert.equal(fnOf(facts, 'fn:src/a.ts#helper').attrs.exported, true);
  assert.deepEqual(idsOf(facts, 'export'), ['export:src/a.ts#Store', 'export:src/a.ts#aid', 'export:src/a.ts#default']);
  assert.equal(fnOf(facts, 'export:src/a.ts#default').attrs.default, true);
  assert.equal(fnOf(facts, 'export:src/a.ts#aid').attrs.default, false);
});

test('params are the written names, without types or defaults', () => {
  const js = run('export function f(a: string, b = 2, { c, d }: P, ...rest) {}').facts;
  assert.deepEqual(fnOf(js, 'fn:src/a.ts#f').attrs.params, ['a', 'b', '{ c, d }', '...rest']);
  const dart = run('Future<void> g(String text, {required int count, this.id}) async {}', 'lib/a.dart').facts;
  assert.deepEqual(fnOf(dart, 'fn:lib/a.dart#g').attrs.params, ['text', 'count', 'id']);
  const php = run('<?php\nfunction h(Order $order, int ...$ids, &$ref) {}', 'a.php').facts;
  assert.deepEqual(fnOf(php, 'fn:a.php#h').attrs.params, ['$order', '...$ids', '&$ref']);
});

test('Dart: named constructors are functions, unnamed ones and getters are not', () => {
  const text = [
    'class Money {',
    '  const Money(this.cents);',
    '  Money.zero() : cents = 0;',
    '  factory Money.parse(String s) {',
    '    return Money(int.parse(s));',
    '  }',
    '  final int cents;',
    '  int get whole => cents ~/ 100;',
    '  set whole(int v) {}',
    '  @override',
    '  String toString() => format();',
    '  String format() => "$cents";',
    '}',
    'class _Hidden { void run() {} }',
  ].join('\n');
  const { facts, hints } = run(text, 'lib/money.dart');
  assert.deepEqual(idsOf(facts, 'function'), [
    'fn:lib/money.dart#Money.format', 'fn:lib/money.dart#Money.parse', 'fn:lib/money.dart#Money.toString',
    'fn:lib/money.dart#Money.zero', 'fn:lib/money.dart#_Hidden.run',
  ]);
  assert.equal(fnOf(facts, 'fn:lib/money.dart#Money.toString').line, 11);
  assert.equal(fnOf(facts, 'fn:lib/money.dart#_Hidden.run').attrs.exported, false);
  assert.deepEqual(idsOf(facts, 'export'), []);
  assert.ok(hints.some((h) => h.from === 'fn:lib/money.dart#Money.toString' && h.target === 'fn:lib/money.dart#Money.format'));
});

test('PHP: methods carry visibility, closures and fn arrows are not functions', () => {
  const text = [
    '<?php',
    'namespace App;',
    'abstract class Box {',
    '    use Helper;',
    '    abstract public function size(): int;',
    '    protected static function make() { return array_map(fn ($x) => $x, []); }',
    '    function open() { return function () { return 1; }; }',
    '}',
    'if (!function_exists("helper")) {',
    '    function helper() { return 1; }',
    '}',
  ].join('\n');
  const { facts } = run(text, 'app/Box.php');
  assert.deepEqual(idsOf(facts, 'function'), ['fn:app/Box.php#Box.make', 'fn:app/Box.php#Box.open', 'fn:app/Box.php#helper']);
  assert.equal(fnOf(facts, 'fn:app/Box.php#Box.make').attrs.exported, false);
  assert.equal(fnOf(facts, 'fn:app/Box.php#Box.open').attrs.exported, true);
});

test('library and global calls never become facts', () => {
  const facts = project([
    { path: 'src/a.js', text: 'export function a() { console.log(1); fetch("x"); JSON.parse("{}"); setTimeout(() => {}, 1); process.exit(0); }' },
    { path: 'src/logger.ts', text: 'export class Logger { log(m) {} parse() {} listen() {} exit() {} get() {} }' },
    { path: 'src/s.ts', text: "import fastify from 'fastify';\nimport * as db from 'pg';\nconst app = fastify();\nexport async function s() {\n  app.listen();\n  fastify.listen();\n  db.get();\n  const cache = new Map();\n  cache.get();\n}" },
    { path: 'lib/b.dart', text: "import 'dart:io';\nvoid b() { print('x'); debugPrint('y'); stdout.log('x'); }" },
    { path: 'lib/logger.dart', text: 'class Logger { void log(m) {} }' },
    { path: 'src/c.php', text: '<?php\nfunction c() { return count(array_map("trim", [])); }' },
  ]);
  assert.deepEqual(idsOf(facts, 'call'), []);
});

test('a receiver that comes from the project is still guessed by name', () => {
  const facts = project([
    { path: 'src/s.ts', text: "import { make } from './m';\nconst app = make();\nexport function s() { app.listen(); }", imports: [{ name: 'make', imported: 'make', file: 'src/m.ts' }] },
    { path: 'src/m.ts', text: 'export class Server { listen() {} }\nexport function make() { return new Server(); }' },
    { path: 'lib/a.dart', text: "import 'log.dart';\nvoid a() { logger.log(); }", imports: [{ name: '*', imported: '*', file: 'lib/log.dart' }] },
    { path: 'lib/log.dart', text: 'final logger = Logger();\nclass Logger { void log() {} }' },
  ]);
  assert.equal(fnOf(facts, 'call:fn:src/s.ts#s->?listen').origin, 'AMBIGUOUS');
  assert.deepEqual(fnOf(facts, 'call:fn:lib/a.dart#a->?log').attrs.candidates, ['fn:lib/log.dart#Logger.log']);
});

test('a call is EXTRACTED only when the target is sure: same file, or an import resolved to a project file', () => {
  const facts = project([
    { path: 'src/a.ts', text: "import { b, c as see } from './b';\nimport * as util from './u';\nexport function a() {\n  b();\n  see();\n  util.u();\n  b();\n}", imports: [
      { name: 'b', imported: 'b', file: 'src/b.ts' }, { name: 'see', imported: 'c', file: 'src/b.ts' }, { name: 'util', imported: '*', file: 'src/u.ts' },
    ] },
    { path: 'src/b.ts', text: 'export function b() {}\nexport const c = () => 1;' },
    { path: 'src/u.ts', text: 'export function u() {}' },
  ]);
  assert.deepEqual(idsOf(facts, 'call'), [
    'call:fn:src/a.ts#a->fn:src/b.ts#b', 'call:fn:src/a.ts#a->fn:src/b.ts#c', 'call:fn:src/a.ts#a->fn:src/u.ts#u',
  ]);
  const twice = fnOf(facts, 'call:fn:src/a.ts#a->fn:src/b.ts#b');
  assert.equal(twice.line, 4);
  assert.deepEqual(twice.refs, [{ file: 'src/a.ts', line: 7 }]);
  assert.equal(fnOf(facts, 'call:fn:src/a.ts#a->fn:src/b.ts#c').attrs.callee, 'see');
});

test('a name declared inside the caller hides the one of the file', () => {
  const facts = project([{ path: 'src/a.js', text: 'function x() {}\nexport function a(cb) {\n  const x = () => 2;\n  x();\n  cb();\n}\nfunction cb() {}' }]);
  assert.deepEqual(idsOf(facts, 'call'), []);
});

test('a parameter of a closure inside the caller hides the function of the file with that name', () => {
  const cases = [
    ['src/a.js', 'function cb() {}\nexport function a(l) { l.forEach(cb => cb()); }'],
    ['src/a.js', 'function cb() {}\nexport function a(l) { l.forEach((x, cb) => cb()); }'],
    ['src/a.js', 'function cb() {}\nexport function a() { return function (cb) { cb(); }; }'],
    ['src/a.js', 'function e() {}\nexport function a() { try { a(); } catch (e) { e(); } }'],
    ['lib/a.dart', 'void cb() {}\nvoid a(List l) { l.forEach((cb) { cb(); }); }'],
    ['lib/a.dart', 'void cb() {}\nvoid a(List l) { l.forEach((cb) => cb()); }'],
  ];
  for (const [path, text] of cases) {
    const calls = idsOf(project([{ path, text }]), 'call').filter((id) => id !== 'call:fn:src/a.js#a->fn:src/a.js#a');
    assert.deepEqual(calls, [], text);
  }
  const still = project([{ path: 'src/a.js', text: 'function cb() {}\nexport function a(x) { if (x === cb) { cb(); } }' }]);
  assert.deepEqual(idsOf(still, 'call'), ['call:fn:src/a.js#a->fn:src/a.js#cb']);
});

test('Dart: a field, getter or setter of the own class hides the top-level function with that name', () => {
  const cases = [
    ['lib/a.dart', 'void cb() {}\nclass A { final Function cb; A(this.cb); void run() { cb(); } }'],
    ['lib/a.dart', 'void cb() {}\nclass A { Function get cb => () {}; void run() { cb(); } }'],
    ['lib/a.dart', 'void cb() {}\nclass A { set cb(Function f) {} void run() { cb(); } }'],
    ['lib/a.dart', 'void cb() {}\nclass A { late Function? cb; void run() { cb!(); cb(); } }'],
    ['lib/a.dart', 'void cb() {}\nclass A { Function x = f, cb = f; void run() => cb(); }'],
    ['lib/a.dart', 'void onTap() {}\nclass W extends StatelessWidget {\n  final VoidCallback onTap;\n  const W({super.key, required this.onTap});\n  Widget build(BuildContext c) { onTap(); return Text(""); }\n}'],
    ['lib/a.dart', 'void cb() {}\nclass A { final String Function(int) cb; A(this.cb); String run() => cb(1); }'],
  ];
  for (const [path, text] of cases) {
    const calls = idsOf(project([{ path, text }]), 'call').filter((id) => !/->(\?|fn:lib\/a\.dart#(W|A)\.)/.test(id));
    assert.deepEqual(calls, [], text);
  }
  const wide = project([
    { path: 'lib/tag.dart', text: "import 'fmt.dart';\nclass Tag {\n  final String Function(int) format;\n  Tag(this.format);\n  String build() => format(1);\n}", imports: [{ name: '*', imported: '*', file: 'lib/fmt.dart' }] },
    { path: 'lib/fmt.dart', text: 'String format(int x) => "";' },
  ]);
  assert.deepEqual(idsOf(wide, 'call'), []);
  // a local of another method, or a field of another class, hides nothing here
  const still = project([{ path: 'lib/a.dart', text: 'void cb() {}\nclass B { Function? cb; }\nclass A { void x() { var cb = 1; } void run() { cb(); } }' }]);
  assert.deepEqual(idsOf(still, 'call'), ['call:fn:lib/a.dart#A.run->fn:lib/a.dart#cb']);
});

test('PHP: a function defined only under a condition (a polyfill) is never a sure target', () => {
  const facts = project([
    { path: 'a.php', text: '<?php\nfunction a() { return str_contains("ab", "a") && pad(); }\nif (!function_exists("pad")) { function pad() {} }' },
    { path: 'poly.php', text: '<?php\nif (!function_exists("str_contains")) {\n  function str_contains($h, $n) { return false; }\n}' },
  ]);
  assert.deepEqual(idsOf(facts, 'call'), ['call:fn:a.php#a->?pad', 'call:fn:a.php#a->?str_contains']);
  assert.ok(facts.filter((f) => f.kind === 'call').every((f) => f.origin === 'AMBIGUOUS'));
  const braced = project([
    { path: 'a.php', text: '<?php\nnamespace App { function a() { return b(); } }' },
    { path: 'b.php', text: '<?php\nnamespace App {\n  function b() {}\n}' },
  ]);
  assert.deepEqual(idsOf(braced, 'call'), ['call:fn:a.php#a->fn:b.php#b']);
  assert.equal(fnOf(braced, 'call:fn:a.php#a->fn:b.php#b').origin, 'EXTRACTED');
});

test('JS: `this` inside a nested function of a method is not the instance', () => {
  const facts = project([{ path: 'src/a.js', text: 'class A {\n  a() { return [1].map(function () { return this.b(); }); }\n  c() { return [1].map(() => this.b()); }\n  b() {}\n}' }]);
  assert.deepEqual(idsOf(facts, 'call'), ['call:fn:src/a.js#A.a->?b', 'call:fn:src/a.js#A.c->fn:src/a.js#A.b']);
  assert.equal(fnOf(facts, 'call:fn:src/a.js#A.a->?b').origin, 'AMBIGUOUS');
});

test('PHP: a plain call reaches a function of another file only when the namespaces agree', () => {
  const other = project([
    { path: 'a.php', text: '<?php\nfunction a() { return count([]); }' },
    { path: 'b.php', text: '<?php\nnamespace App\\Util;\nfunction count($x) {}' },
  ]);
  assert.deepEqual(idsOf(other, 'call'), []);
  const same = project([
    { path: 'a.php', text: '<?php\nnamespace App\\Util;\nfunction a() { return tally([]) + helper(); }' },
    { path: 'b.php', text: '<?php\nnamespace App\\Util;\nfunction tally($x) {}' },
    { path: 'd.php', text: '<?php\nfunction helper() {}' },
  ]);
  assert.deepEqual(idsOf(same, 'call'), ['call:fn:a.php#a->fn:b.php#tally', 'call:fn:a.php#a->fn:d.php#helper']);
});

test('a method on an unknown receiver is AMBIGUOUS among the project methods with that name', () => {
  const facts = project([
    { path: 'src/a.ts', text: 'export function a(m) { m.go(); m.stop(); }' },
    { path: 'src/b.ts', text: 'export class B { go() {} }' },
    { path: 'src/c.ts', text: 'export class C { go() {} stop() {} }' },
  ]);
  const go = fnOf(facts, 'call:fn:src/a.ts#a->?go');
  assert.equal(go.origin, 'AMBIGUOUS');
  assert.deepEqual(go.attrs.candidates, ['fn:src/b.ts#B.go', 'fn:src/c.ts#C.go']);
  assert.deepEqual(go.refs, [{ file: 'src/b.ts', line: 1 }, { file: 'src/c.ts', line: 1 }]);
  const stop = fnOf(facts, 'call:fn:src/a.ts#a->?stop');
  assert.equal(stop.origin, 'AMBIGUOUS');
  assert.deepEqual(stop.attrs.candidates, ['fn:src/c.ts#C.stop']);
});

test('a guess by name never points product code at a test file (a test stub with the same method name)', () => {
  const facts = project([
    { path: 'src/a.js', text: 'export function a(el) { el.setAttribute("x", 1); }' },
    { path: 'test/a.test.js', text: 'const el = { setAttribute() {} };\nexport function t(x) { x.setAttribute(); }' },
  ]);
  assert.equal(fnOf(facts, 'call:fn:src/a.js#a->?setAttribute'), undefined);
  assert.equal(fnOf(facts, 'call:fn:test/a.test.js#t->?setAttribute').origin, 'AMBIGUOUS');
});

test('this, $this and self calls go to the own class; a top-level call outside any function is not a fact', () => {
  const js = project([{ path: 'src/a.js', text: 'class A {\n  a() { return this.b(); }\n  b() {}\n}\nnew A().a();' }]);
  assert.deepEqual(idsOf(js, 'call'), ['call:fn:src/a.js#A.a->fn:src/a.js#A.b']);
  const php = project([{ path: 'a.php', text: '<?php\nclass A {\n  public function a() { return self::b() + $this->c(); }\n  private static function b() {}\n  private function c() {}\n}' }]);
  assert.deepEqual(idsOf(php, 'call'), ['call:fn:a.php#A.a->fn:a.php#A.b', 'call:fn:a.php#A.a->fn:a.php#A.c']);
});

test('several import targets with the same name make the call AMBIGUOUS', () => {
  const facts = project([
    { path: 'lib/a.dart', text: "import 'b.dart';\nimport 'c.dart';\nvoid a() { run(); }", imports: [
      { name: '*', imported: '*', file: 'lib/b.dart' }, { name: '*', imported: '*', file: 'lib/c.dart' },
    ] },
    { path: 'lib/b.dart', text: 'void run() {}' },
    { path: 'lib/c.dart', text: 'void run() {}' },
  ]);
  const call = fnOf(facts, 'call:fn:lib/a.dart#a->?run');
  assert.equal(call.origin, 'AMBIGUOUS');
  assert.deepEqual(call.attrs.candidates, ['fn:lib/b.dart#run', 'fn:lib/c.dart#run']);
});

test('broken or cut code never throws: every fixture file cut at many points still reads', () => {
  for (const name of ['acme-shop', 'acme-delivery', 'acme-lib']) {
    for (const e of fixtureEntries(name)) {
      for (let cut = 0; cut < e.text.length; cut += 7) {
        const text = e.text.slice(0, cut);
        const r = extract({ path: e.path, type: e.type, text, masked: lex(text, e.type).masked });
        for (const f of r.facts) if (f.kind === 'function') assert.ok(f.attrs.endLine >= f.line, `${f.id} at cut ${cut}`);
        importNames({ path: e.path, type: e.type, text, masked: lex(text, e.type).masked });
      }
    }
  }
});

test('importNames reads the names each language brings in', () => {
  const js = "import a, { b, c as d, type T } from './x';\nimport * as ns from './y';\nimport type { U } from './z';\nimport './side';\nconst { e, f: g } = require('./w');\nconst h = require('./v');";
  const jsNames = importNames({ path: 'src/a.ts', type: 'ts', text: js, masked: lex(js, 'ts').masked });
  assert.deepEqual(jsNames.map((n) => [n.name, n.imported, n.spec]), [
    ['a', 'default', './x'], ['b', 'b', './x'], ['d', 'c', './x'], ['ns', '*', './y'], ['e', 'e', './w'], ['g', 'f', './w'], ['h', '*', './v'],
  ]);
  const dart = "import 'package:app/a.dart';\nimport '../b.dart' as b;\nimport 'c.dart' show one, two;\npart 'd.dart';";
  const dartNames = importNames({ path: 'lib/x.dart', type: 'dart', text: dart, masked: lex(dart, 'dart').masked });
  assert.deepEqual(dartNames.map((n) => [n.name, n.imported, n.spec]), [
    ['*', '*', 'package:app/a.dart'], ['b', '*', '../b.dart'], ['one', 'one', 'c.dart'], ['two', 'two', 'c.dart'], ['*', '*', 'd.dart'],
  ]);
  const php = '<?php\nuse App\\Models\\Order;\nuse App\\Jobs\\{SendReceipt, Notify as Ping};\nuse function App\\helper;\nclass A { use Queueable; }';
  const phpNames = importNames({ path: 'a.php', type: 'php', text: php, masked: lex(php, 'php').masked });
  assert.deepEqual(phpNames.map((n) => [n.name, n.imported, n.spec]), [
    ['Order', 'Order', 'App\\Models\\Order'], ['SendReceipt', 'SendReceipt', 'App\\Jobs\\SendReceipt'],
    ['Ping', 'Notify', 'App\\Jobs\\Notify'], ['helper', 'helper', 'App\\helper'],
  ]);
});

test('extract gives call sites as hints; linkCalls turns them into facts', () => {
  const r = run('function a() { b(); }\nfunction b() {}', 'src/a.js');
  assert.ok(r.hints.every((h) => h.kind === 'call-site'));
  const calls = linkCalls(r.facts, r.hints, { imports: {} });
  assert.deepEqual(calls.map((c) => c.id), ['call:fn:src/a.js#a->fn:src/a.js#b']);
});

// fd17: web/chat.js keeps most functions inside one outer function; they are facts too, with their parent's name.
test('functions nested inside another function are facts with their parent and line', () => {
  const text = [
    'export function initChat(box) {', // 1
    '  const state = { open: false };', // 2
    '  function render(items) {', // 3
    '    return items.map((i) => i);', // 4
    '  }', // 5
    '  const onClick = async (e) => {', // 6
    '    function deep() { return 1; }', // 7
    '    return deep();', // 8
    '  };', // 9
    '  const seen = function (x) { return x; };', // 10
    '  let n = 0;', // 11
    '  const value = compute(box);', // 12
    '  return { render, onClick, seen };', // 13
    '}', // 14
    'class Box {', // 15
    '  open() {', // 16
    '    const close = () => { this.x = 1; };', // 17
    '    return close;', // 18
    '  }', // 19
    '}', // 20
    'app.get("/", (req, res) => {', // 21
    '  function lonely() {}', // 22
    '});', // 23
  ].join('\n');
  const { facts } = run(text, 'src/a.js');
  const nested = facts.filter((f) => f.kind === 'function' && f.attrs.parent);
  assert.deepEqual(nested.map((f) => `${f.attrs.parent} > ${f.name.split('>').pop()}:${f.line}`).sort(), [
    'Box.open > close:17', 'initChat > onClick:6', 'initChat > render:3', 'initChat > seen:10', 'initChat>onClick > deep:7',
  ].sort());
  assert.equal(fnOf(facts, 'fn:src/a.js#initChat>render').attrs.endLine, 5);
  assert.equal(fnOf(facts, 'fn:src/a.js#initChat>render').attrs.exported, false);
  // top-level facts are unchanged, and a nested function never becomes the caller or the target of a project call
  assert.deepEqual(idsOf(facts, 'function').filter((id) => !id.includes('>')), ['fn:src/a.js#Box.open', 'fn:src/a.js#initChat']);
  const calls = project([{ path: 'src/a.js', text }]).filter((f) => f.kind === 'call');
  assert.ok(calls.every((c) => !c.id.includes('>')));
});

test('a nested function with the same name twice under one parent gets distinct ids', () => {
  const text = 'function a() {\n  if (x) { function go() {} } else { function go() {} }\n}\n';
  const { facts } = run(text, 'src/a.js');
  const ids = facts.filter((f) => f.attrs?.parent === 'a').map((f) => f.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  // the same name three times on one line: the line alone does not tell them apart
  const crowded = run('function outer() { { const inner = () => {}; } { const inner = () => {}; } { const inner = () => {}; } }', 'src/b.js').facts;
  const crowdedIds = crowded.filter((f) => f.attrs?.parent === 'outer').map((f) => f.id);
  assert.equal(crowdedIds.length, 3);
  assert.equal(new Set(crowdedIds).size, 3);
});
