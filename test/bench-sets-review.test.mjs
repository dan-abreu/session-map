// The review set of the measuring bench (or12): 15 excerpts with one planted bug each and 5 clean controls. These
// checks keep its shape honest; the proof that each bug is real lives outside the repo (see the set's "about").
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreReview } from '../server/bench/score.mjs';

const set = JSON.parse(readFileSync(new URL('../server/bench/sets/review.json', import.meta.url), 'utf8'));
const linesOf = (item) => item.code.split('\n');

test('review set: header and size', () => {
  assert.equal(set.kind, 'review');
  assert.ok(Number.isInteger(set.version) && set.version >= 1);
  assert.equal(typeof set.about, 'string');
  assert.ok(set.about.length > 40);
  assert.equal(set.items.length, 20);
  assert.equal(set.items.filter((i) => i.clean).length, 5);
  assert.equal(set.items.filter((i) => !i.clean).length, 15);
});

test('review set: every item has the agreed shape', () => {
  const ids = new Set();
  for (const item of set.items) {
    assert.deepEqual(Object.keys(item).sort(), ['bug', 'bugLines', 'clean', 'code', 'file', 'id'], item.id);
    assert.match(item.id, /^rv-[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(item.file, /^server\/[a-z0-9/._-]+\.mjs$/, item.id);
    assert.equal(typeof item.clean, 'boolean', item.id);
    assert.equal(typeof item.code, 'string', item.id);
    assert.ok(!item.code.includes('\r'), `${item.id}: line ends must be \\n only, or the numbering shifts`);
    assert.ok(!item.code.endsWith('\n'), `${item.id}: a trailing newline would add an empty numbered line`);
    const n = linesOf(item).length;
    assert.ok(n >= 20 && n <= 60, `${item.id}: ${n} lines`);
    assert.ok(Array.isArray(item.bugLines), item.id);
    if (item.clean) {
      assert.deepEqual(item.bugLines, [], item.id);
      assert.equal(item.bug, null, item.id);
    } else {
      assert.ok(item.bugLines.length >= 1 && item.bugLines.length <= 3, item.id);
      assert.equal(typeof item.bug, 'string', item.id);
      assert.ok(item.bug.length > 20 && !item.bug.includes('\n'), `${item.id}: bug is one line`);
    }
  }
});

test('review set: bugLines point at real, non-blank lines of the code, in order', () => {
  for (const item of set.items.filter((i) => !i.clean)) {
    const lines = linesOf(item);
    const sorted = [...item.bugLines].sort((a, b) => a - b);
    assert.deepEqual(item.bugLines, sorted, `${item.id}: bugLines sorted`);
    assert.equal(new Set(item.bugLines).size, item.bugLines.length, `${item.id}: no repeats`);
    for (const n of item.bugLines) {
      assert.ok(Number.isInteger(n) && n >= 1 && n <= lines.length, `${item.id}: line ${n} outside 1..${lines.length}`);
      const text = lines[n - 1].trim();
      assert.ok(text !== '' && !text.startsWith('//'), `${item.id}: line ${n} is blank or a comment`);
    }
  }
});

test('review set: the code gives nothing away', () => {
  for (const item of set.items) {
    assert.doesNotMatch(item.code, /\b(bug|bugs|buggy|planted|fixme|todo|xxx|hack)\b/i, item.id);
    // No personal data: the set is committed.
    assert.doesNotMatch(item.code, /C:[\\/]Users|\/home\/|@gmail\.|danie/i, item.id);
  }
});

// One child parses them all as modules (nothing is linked or run), so a typo in an excerpt is caught here.
const PARSE_ALL = `
const vm = require('node:vm');
const items = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const bad = [];
for (const { id, code } of items) {
  try { new vm.SourceTextModule(code, { identifier: id }); } catch (err) { bad.push(id + ': ' + err.message); }
}
process.stdout.write(JSON.stringify(bad));
`;

test('review set: each excerpt is a valid ES module', () => {
  const out = execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', PARSE_ALL], {
    input: JSON.stringify(set.items.map(({ id, code }) => ({ id, code }))),
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), []);
});

test('review set: the scorer counts a report on a bug line as a hit and an empty answer as right only when clean', () => {
  for (const item of set.items) {
    const silent = scoreReview(item, { bugs: [] });
    assert.equal(silent.score, item.clean ? 1 : 0, item.id);
    if (item.clean) continue;
    const onBug = scoreReview(item, { bugs: [{ line: item.bugLines[0], why: 'x' }] });
    assert.equal(onBug.score, 1, item.id);
    assert.equal(onBug.falseAlarms, 0, item.id);
  }
});
