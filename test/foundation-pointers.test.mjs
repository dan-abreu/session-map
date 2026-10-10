import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pointersIn, resolvePointer } from '../server/foundation/pointers.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const reader = (files) => (p) => (Object.hasOwn(files, p) ? files[p] : null);

test('pointersIn finds `path/file.ext#Symbol` in inline code with its line', () => {
  const text = 'Intro\nSee `server/main.mjs#startServer` and `src/api.ts#Orders.getOne`, also `lib/ça.dart#Tela`.\n';
  assert.deepEqual(pointersIn(text).map((p) => [p.line, p.path, p.symbol]), [
    [2, 'server/main.mjs', 'startServer'],
    [2, 'src/api.ts', 'Orders.getOne'],
    [2, 'lib/ça.dart', 'Tela'],
  ]);
});

test('pointersIn ignores Markdown anchors, URLs, HTML pages, fenced code and plain text', () => {
  const text = [
    '`docs/guide.md#install` `README.md#top` `https://x.example/a.js#b` `index.html#intro` `file.json#key`',
    '`src/a.js#` `src/a.js` `../up/a.js#x` `/abs/a.js#x` `C:/a.js#x` `two words/a.js#x`',
    'src/plain.js#NotInCode',
    '```', '`src/in-fence.js#X`', '```',
  ].join('\n');
  assert.deepEqual(pointersIn(text), []);
});

test('resolvePointer finds a declaration and computes the line at call time', () => {
  const v1 = 'const a = 1;\n\nexport function startServer() {}\n';
  const v2 = '// header\n// header\n' + v1;
  const ptr = { path: 'server/main.mjs', symbol: 'startServer' };
  assert.deepEqual(resolvePointer(ptr, { readCode: reader({ 'server/main.mjs': v1 }) }), { ok: true, line: 3 });
  assert.deepEqual(resolvePointer(ptr, { readCode: reader({ 'server/main.mjs': v2 }) }), { ok: true, line: 5 });
  assert.deepEqual(resolvePointer('server/main.mjs#startServer', { readCode: reader({ 'server/main.mjs': v1 }) }), { ok: true, line: 3 });
});

test('resolvePointer: a renamed symbol is symbol-missing and a deleted file is path-missing', () => {
  const files = { 'a.js': 'export function renamedNow() {}\n' };
  assert.deepEqual(resolvePointer('a.js#oldName', { readCode: reader(files) }), { ok: false, why: 'symbol-missing' });
  assert.deepEqual(resolvePointer('gone.js#x', { readCode: reader(files) }), { ok: false, why: 'path-missing' });
  assert.deepEqual(resolvePointer('../secret.js#x', { readCode: () => 'function x(){}' }), { ok: false, why: 'path-missing' });
});

test('resolvePointer reads declarations only from code: comments and strings do not count', () => {
  const files = { 'a.js': '// function ghost() {}\nconst s = "function ghost2() {}";\n/* class Ghost3 {} */\nfunction real() {}\n' };
  const r = reader(files);
  assert.equal(resolvePointer('a.js#ghost', { readCode: r }).why, 'symbol-missing');
  assert.equal(resolvePointer('a.js#ghost2', { readCode: r }).why, 'symbol-missing');
  assert.equal(resolvePointer('a.js#Ghost3', { readCode: r }).why, 'symbol-missing');
  assert.deepEqual(resolvePointer('a.js#real', { readCode: r }), { ok: true, line: 4 });
});

test('resolvePointer accepts the declaration keywords of several languages and does not match longer names', () => {
  const files = {
    'a.ts': 'export const handler = () => {};\nlet counter = 0;\nexport type Order = {};\nexport interface Shape {}\nclass Box {}\nexport async function* stream() {}\nenum Mode {}\n',
    'b.py': 'def run():\n    pass\nclass Job:\n    pass\n',
    'c.rs': 'pub fn go() {}\n',
    'd.php': '<?php\nfunction helper() {}\nclass Svc {}\n',
  };
  const r = reader(files);
  const line = (p) => resolvePointer(p, { readCode: r });
  assert.deepEqual(line('a.ts#handler'), { ok: true, line: 1 });
  assert.deepEqual(line('a.ts#counter'), { ok: true, line: 2 });
  assert.deepEqual(line('a.ts#Order'), { ok: true, line: 3 });
  assert.deepEqual(line('a.ts#Shape'), { ok: true, line: 4 });
  assert.deepEqual(line('a.ts#Box'), { ok: true, line: 5 });
  assert.deepEqual(line('a.ts#stream'), { ok: true, line: 6 });
  assert.deepEqual(line('a.ts#Mode'), { ok: true, line: 7 });
  assert.deepEqual(line('b.py#run'), { ok: true, line: 1 });
  assert.deepEqual(line('b.py#Job'), { ok: true, line: 3 });
  assert.deepEqual(line('c.rs#go'), { ok: true, line: 1 });
  assert.deepEqual(line('d.php#helper'), { ok: true, line: 2 });
  assert.equal(line('a.ts#hand').why, 'symbol-missing');
  assert.equal(line('a.ts#handlerX').why, 'symbol-missing');
});

test('resolvePointer resolves Class.method inside the class body only', () => {
  const js = ['function other() {}', 'class Orders {', '  constructor() { this.x = 1; }', '  async getOne(id) {', '    return this.helper(id);', '  }', '  static make() {}', '  count = 3;', '}', 'function helper() {}', 'function getOne() {}'].join('\n');
  const r = reader({ 'o.ts': js });
  assert.deepEqual(resolvePointer('o.ts#Orders.getOne', { readCode: r }), { ok: true, line: 4 });
  assert.deepEqual(resolvePointer('o.ts#Orders.make', { readCode: r }), { ok: true, line: 7 });
  assert.deepEqual(resolvePointer('o.ts#Orders.count', { readCode: r }), { ok: true, line: 8 });
  assert.equal(resolvePointer('o.ts#Orders.helper', { readCode: r }).why, 'symbol-missing');
  assert.equal(resolvePointer('o.ts#Orders.other', { readCode: r }).why, 'symbol-missing');
  assert.equal(resolvePointer('o.ts#Nope.getOne', { readCode: r }).why, 'symbol-missing');
  const py = 'class Job:\n    def run(self):\n        self.go()\n    def go(self):\n        pass\n\ndef run():\n    pass\n';
  assert.deepEqual(resolvePointer('j.py#Job.go', { readCode: reader({ 'j.py': py }) }), { ok: true, line: 4 });
  assert.equal(resolvePointer('j.py#Job.pass', { readCode: reader({ 'j.py': py }) }).why, 'symbol-missing');
});

test('resolvePointer uses a function fact when the file still has the sha the fact was read from', () => {
  const code = 'export const a = 1;\nexport function named() {}\n';
  const facts = [{ id: 'fn:s/a.js#named', kind: 'function', name: 'named', file: 's/a.js', line: 2, sha: sha(code) }];
  assert.deepEqual(resolvePointer('s/a.js#named', { facts, readCode: reader({ 's/a.js': code }) }), { ok: true, line: 2 });
  // fact from an older read of the file: the line is worked out from the text now, and a renamed symbol is flagged
  const stale = [{ id: 'fn:s/a.js#named', kind: 'function', name: 'named', file: 's/a.js', line: 1, sha: 'deadbeefdeadbeef' }];
  assert.deepEqual(resolvePointer('s/a.js#named', { facts: stale, readCode: reader({ 's/a.js': code }) }), { ok: true, line: 2 });
  const renamed = 'export const a = 1;\nexport function newName() {}\n';
  assert.deepEqual(resolvePointer('s/a.js#named', { facts: stale, readCode: reader({ 's/a.js': renamed }) }), { ok: false, why: 'symbol-missing' });
});

test('resolvePointer works from facts alone when no reader is given, and takes the facts file shape too', () => {
  const facts = { facts: [{ id: 'export:lib/x.js#thing', kind: 'export', name: 'thing', file: 'lib/x.js', line: 7, sha: 'x' }, { id: 'fn:lib/x.js#Box.open', kind: 'function', file: 'lib/x.js', line: 12, sha: 'x' }] };
  assert.deepEqual(resolvePointer('lib/x.js#thing', { facts }), { ok: true, line: 7 });
  assert.deepEqual(resolvePointer('lib/x.js#Box.open', { facts }), { ok: true, line: 12 });
  assert.deepEqual(resolvePointer('lib/x.js#gone', { facts }), { ok: false, why: 'symbol-missing' });
  assert.deepEqual(resolvePointer('lib/none.js#thing', { facts }), { ok: false, why: 'path-missing' });
});

test('resolvePointer never returns a line outside the file and never throws on odd input', () => {
  assert.deepEqual(resolvePointer('', { readCode: () => '' }), { ok: false, why: 'path-missing' });
  assert.deepEqual(resolvePointer('a.js', { readCode: () => 'x' }), { ok: false, why: 'symbol-missing' });
  assert.deepEqual(resolvePointer('a.js#x', { readCode: () => '' }), { ok: false, why: 'symbol-missing' });
  assert.deepEqual(resolvePointer({ path: 'a.js', symbol: '$weird' }, { readCode: () => 'const $weird = 1;' }), { ok: true, line: 1 });
});

test('pointersIn and resolvePointer run on the real repository documents without throwing', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const text = readFileSync(new URL('../docs/architecture/foundation.md', import.meta.url), 'utf8');
  const root = new URL('../', import.meta.url);
  const readCode = (p) => { try { return readFileSync(new URL(p, root), 'utf8'); } catch { return null; } };
  for (const p of pointersIn(text)) {
    const r = resolvePointer(p, { readCode });
    assert.ok(r.ok === true ? Number.isInteger(r.line) : ['path-missing', 'symbol-missing'].includes(r.why));
  }
  assert.ok(readdirSync(new URL('server/foundation/', root)).includes('pointers.mjs'));
  // this very module is found by its own pointer
  assert.equal(resolvePointer('server/foundation/pointers.mjs#resolvePointer', { readCode }).ok, true);
  assert.equal(resolvePointer('server/foundation/pointers.mjs#pointersIn', { readCode }).ok, true);
});
