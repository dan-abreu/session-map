import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skeleton } from '../server/foundation/skeleton.mjs';

// fd17: the skeleton of a file as a tool: imports, exports, signatures with lines, environment variables, no bodies.

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'sm-skeleton-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const JS = [
  "import { readFileSync } from 'node:fs';", // 1
  "import chat, * as util from './chat.js';", // 2
  'const BASE = process.env.SM_URL || "x";', // 3
  "const { A_KEY, B_KEY: other } = process.env;", // 4
  '// process.env.IN_A_COMMENT', // 5
  'export class Hub {', // 6
  '  open(id) {', // 7
  '    const secret = "never shown";', // 8
  "    return process.env['SM_DIR'] + id;", // 9
  '  }', // 10
  '}', // 11
  'export async function run(a, b) {', // 12
  '  function step(n) { return n + 1; }', // 13
  '  const done = () => { return step(1); };', // 14
  '  return done();', // 15
  '}', // 16
].join('\n');

test('skeleton: imports, exports, signatures with lines (nested ones indented), env variables, no bodies', () => {
  const root = project({ 'src/hub.mjs': JS });
  try {
    const text = skeleton({ root, file: 'src/hub.mjs' });
    assert.match(text, /^src\/hub\.mjs: 16 lines/);
    assert.match(text, /imports:\n {2}1: node:fs \{ readFileSync \}\n {2}2: \.\/chat\.js \{ chat, \* as util \}/);
    assert.match(text, /exports:\n {2}6: Hub\n {2}12: run/);
    assert.match(text, /\n {2}6: export class Hub \{\n {4}7: open\(id\) \{\n {2}12: export async function run\(a, b\) \{\n {4}13: function step\(n\) \{ return n \+ 1; \}\n {4}14: const done = \(\) => \{ return step\(1\); \};/);
    assert.match(text, /SM_URL \(line 3\)/);
    assert.match(text, /A_KEY \(line 4\)/);
    assert.match(text, /B_KEY \(line 4\)/);
    assert.match(text, /SM_DIR \(line 9\)/);
    assert.ok(!text.includes('IN_A_COMMENT'));
    assert.ok(!text.includes('never shown'));
    assert.ok(!text.includes('return done()'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skeleton: a long signature line is cut at 160 characters', () => {
  const root = project({ 'a.js': `function long(${'x'.repeat(300)}) {}\n` });
  try {
    const line = skeleton({ root, file: 'a.js' }).split('\n').find((l) => l.includes('function long'));
    assert.equal(line.trim().replace(/^1: /, '').length, 160);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skeleton: Dart and PHP read their functions, classes, imports and environment variables', () => {
  const root = project({
    'lib/a.dart': "import 'package:app/b.dart';\nclass Repo {\n  String url() {\n    return Platform.environment['API_URL'] ?? '';\n  }\n}\nvoid main() {}\n",
    'src/A.php': "<?php\nuse App\\Models\\Order;\nclass Mailer {\n  public function send($to) {\n    return getenv('MAIL_HOST') . $_ENV['MAIL_USER'];\n  }\n}\n",
  });
  try {
    const dart = skeleton({ root, file: 'lib/a.dart' });
    assert.match(dart, /1: package:app\/b\.dart/);
    assert.match(dart, /2: class Repo \{\n {4}3: String url\(\) \{\n {2}7: void main\(\) \{\}/);
    assert.match(dart, /API_URL \(line 4\)/);
    const php = skeleton({ root, file: 'src/A.php' });
    assert.match(php, /2: App\\Models\\Order \{ Order \}/);
    assert.match(php, /3: class Mailer \{\n {4}4: public function send\(\$to\) \{/);
    assert.match(php, /MAIL_HOST \(line 5\)/);
    assert.match(php, /MAIL_USER \(line 5\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skeleton: the refusals are all null', () => {
  const root = project({ '.env': 'process.env.X\n', '.env.local': 'a\n', 'notes.md': '# hi\n', 'src/a.js': 'export const a = 1;\n', 'bin.js': 'a\0b' });
  try {
    assert.equal(skeleton({ root, file: '.env' }), null);
    assert.equal(skeleton({ root, file: '.env.local' }), null);
    assert.equal(skeleton({ root, file: 'notes.md' }), null);
    assert.equal(skeleton({ root, file: '../outside.js' }), null);
    assert.equal(skeleton({ root, file: 'src/../../outside.js' }), null);
    assert.equal(skeleton({ root, file: join(root, 'src', 'a.js') }), null);
    assert.equal(skeleton({ root, file: '.git/config.js' }), null);
    assert.equal(skeleton({ root, file: 'missing.js' }), null);
    assert.equal(skeleton({ root, file: 'src' }), null);
    assert.equal(skeleton({ root, file: 'bin.js' }), null);
    assert.equal(skeleton({ root, file: '' }), null);
    assert.equal(skeleton({ root, file: 42 }), null);
    assert.equal(skeleton({ root: undefined, file: 'src/a.js' }), null);
    assert.ok(skeleton({ root, file: 'src/a.js' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skeleton: a file with nothing to show still answers', () => {
  const root = project({ 'empty.js': '' });
  try {
    const text = skeleton({ root, file: 'empty.js' });
    assert.match(text, /\(no function or class\)/);
    assert.match(text, /environment variables read:\n {2}\(none\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
