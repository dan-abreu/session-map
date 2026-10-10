// The bench's "code" set (or12): fifteen small functions in session-map's own style, each with a spec, a signature,
// a node:test file that imports './solution.mjs' and a known-good reference. This checks the file's shape only;
// it never runs the set's code (the bench does that, in its sandbox).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const set = JSON.parse(readFileSync(new URL('../server/bench/sets/code.json', import.meta.url), 'utf8'));
const nameOf = (signature) => /^export function ([A-Za-z_$][\w$]*)\(/.exec(signature)?.[1];

// Direct assert calls, plus every indented call of a top-level helper whose definition asserts (like a check(a, b)).
function assertionCount(src) {
  let n = (src.match(/\bassert\.\w+\(/g) ?? []).length;
  for (const m of src.matchAll(/^(?:const (\w+) = |function (\w+)\()/gm)) {
    const name = m[1] ?? m[2];
    const end = src.indexOf('\n\n', m.index);
    if (!src.slice(m.index, end === -1 ? undefined : end).includes('assert.')) continue;
    n += (src.match(new RegExp(`^\\s+${name}\\(`, 'gm')) ?? []).length;
  }
  return n;
}

test('the set says what it is', () => {
  assert.equal(set.kind, 'code');
  assert.ok(Number.isInteger(set.version) && set.version >= 1);
  assert.equal(typeof set.about, 'string');
  assert.ok(set.about.trim().length > 40);
  assert.ok(Array.isArray(set.items));
});

test('fifteen items with unique ids, five of each level, easy to hard', () => {
  assert.equal(set.items.length, 15);
  const ids = set.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
  const levels = set.items.map((i) => i.level);
  for (const level of ['easy', 'medium', 'hard']) assert.equal(levels.filter((l) => l === level).length, 5, level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a) - ['easy', 'medium', 'hard'].indexOf(b)), 'in order of difficulty');
});

test('every item has the fields the bench needs', () => {
  for (const item of set.items) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'level', 'reference', 'signature', 'spec', 'tests', 'title'], item.id);
    for (const key of ['title', 'spec', 'signature', 'tests', 'reference']) {
      assert.equal(typeof item[key], 'string', `${item.id}.${key}`);
      assert.ok(item[key].trim(), `${item.id}.${key} is empty`);
    }
    assert.ok(item.spec.length >= 150, `${item.id}: the spec is too thin to be fair`);
  }
});

test('signature, reference and tests agree on one exported function', () => {
  for (const item of set.items) {
    const name = nameOf(item.signature);
    assert.ok(name, `${item.id}: the signature starts with "export function name("`);
    assert.match(item.reference, new RegExp(`^export function ${name}\\(`, 'm'), `${item.id}: the reference exports ${name}`);
    assert.match(item.tests, new RegExp(`^import \\{ ${name} \\} from '\\./solution\\.mjs';$`, 'm'), `${item.id}: the tests import ${name} from ./solution.mjs`);
  }
  const names = set.items.map((i) => nameOf(i.signature));
  assert.equal(new Set(names).size, names.length, 'one function per item');
});

test('the tests are real node:test files that fit the sandbox', () => {
  for (const item of set.items) {
    assert.match(item.tests, /^import \{ test \} from 'node:test';$/m, item.id);
    assert.match(item.tests, /^import assert from 'node:assert\/strict';$/m, item.id);
    const imports = [...item.tests.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((m) => !['node:test', 'node:assert/strict', './solution.mjs'].includes(m)), [], `${item.id} imports only node:test, assert and the solution`);
    assert.doesNotMatch(item.tests, /process\.|child_process|node:fs|node:net|fetch\(|setTimeout/, `${item.id}: the tests need no file, process, network or clock`);
    const checks = assertionCount(item.tests);
    assert.ok(checks >= 6, `${item.id}: at least 6 assertions (has ${checks})`);
    assert.ok((item.tests.match(/^test\(/gm) ?? []).length >= 2, `${item.id}: at least 2 test cases`);
  }
});

test('the references are plain modules that need nothing from outside', () => {
  for (const item of set.items) {
    assert.doesNotMatch(item.reference, /^import /m, `${item.id}: the reference imports nothing`);
    assert.doesNotMatch(item.reference, /process\.|require\(|eval\(|Function\(/, item.id);
  }
});

test('no personal data in the committed set', () => {
  const text = JSON.stringify(set);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no e-mail address');
  assert.doesNotMatch(text, /C:\\\\Users\\\\|\/Users\/|\/home\//i, 'no home folder');
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}/, 'no key');
});
