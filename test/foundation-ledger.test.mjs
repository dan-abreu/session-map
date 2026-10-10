import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import {
  emptyLedger, recordRead, ledgerSummary, ledgerDocument, planRounds, lineCharsOf, mergeSpans,
} from '../server/foundation/ledger.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const answer = JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-shop.answer.json'), 'utf8'));
const owners = new Map(Object.entries(answer.owners));
const META = { run: 'study-test', model: 'sonnet', at: '2026-10-10T10:00:00.000Z' };
const SHA = 'aaaaaaaaaaaaaaaa';

// The reader the caller would build: the text the program itself sends is the text it counts.
const charsReader = (root) => (path) => lineCharsOf(readFileSync(join(root, path), 'utf8'));
const withShop = (fn) => async () => {
  const root = copyFixtureRepo('acme-shop');
  try { await fn(root, await censusOf(root, null, { owners })); } finally { removeFixtureRepo(root); }
};
const synthetic = (files) => ({
  files: files.map(({ path, text, sha = SHA, included = true }) => ({
    path, included, sha, chars: included ? [...text].length : null, lines: included ? { total: lineCharsOf(text).length } : null,
  })),
});

test('lineCharsOf: one number per line, newline included, the sum is the code points of the text', () => {
  assert.deepEqual(lineCharsOf(''), []);
  assert.deepEqual(lineCharsOf('ab\ncd\n'), [3, 3]);
  assert.deepEqual(lineCharsOf('ab\ncd'), [3, 2]);
  assert.deepEqual(lineCharsOf('\n\n'), [1, 1]);
  assert.deepEqual(lineCharsOf('a\r\nb'), [3, 1]);
  assert.deepEqual(lineCharsOf('x😀\n'), [3]); // one emoji = one code point, like the census
});

test('mergeSpans joins overlapping and touching spans and sorts them', () => {
  assert.deepEqual(mergeSpans([[41, 80], [1, 40]]), [[1, 80]]);
  assert.deepEqual(mergeSpans([[1, 10], [5, 20], [30, 40]]), [[1, 20], [30, 40]]);
  assert.deepEqual(mergeSpans([[3, 3], [1, 1]]), [[1, 1], [3, 3]]);
  assert.deepEqual(mergeSpans([]), []);
});

test('recordRead merges spans, keeps one read per run and model, and does not touch the input ledger', () => {
  const a = recordRead(emptyLedger(), 'src/a.ts', 'sha1', [[1, 40]], META);
  const b = recordRead(a, 'src/a.ts', 'sha1', [[41, 80]], META);
  assert.deepEqual(b.files['src/a.ts'].spans, [[1, 80]]);
  assert.deepEqual(b.files['src/a.ts'].reads, [{ run: 'study-test', model: 'sonnet', at: META.at }]);
  assert.deepEqual(a.files['src/a.ts'].spans, [[1, 40]]); // input untouched
  const c = recordRead(b, 'src/a.ts', 'sha1', [[1, 2]], { ...META, run: 'study-2' });
  assert.equal(c.files['src/a.ts'].reads.length, 2);
  assert.equal(c.version, 1);
});

test('recordRead with a new sha drops what was read of the old content', () => {
  const a = recordRead(emptyLedger(), 'src/a.ts', 'old', [[1, 80]], META);
  const b = recordRead(a, 'src/a.ts', 'new', [[1, 5]], { ...META, run: 'study-2' });
  assert.equal(b.files['src/a.ts'].sha, 'new');
  assert.deepEqual(b.files['src/a.ts'].spans, [[1, 5]]);
  assert.equal(b.files['src/a.ts'].reads.length, 1);
});

test('recordRead refuses spans that are not whole 1-based line ranges', () => {
  for (const bad of [[[0, 3]], [[3, 1]], [[1.5, 2]], [['1', '2']], [[1]], 'x', [[NaN, 2]]]) {
    assert.throws(() => recordRead(emptyLedger(), 'a.ts', 's', bad, META), /spans/, JSON.stringify(bad));
  }
  assert.throws(() => recordRead(emptyLedger(), '', 's', [[1, 2]], META), /path/);
  assert.throws(() => recordRead(emptyLedger(), 'a.ts', '', [[1, 2]], META), /sha/);
});

test('recording every slice of planRounds reads 100 percent of the acme-shop census', withShop((root, census) => {
  const lineChars = charsReader(root);
  const slices = planRounds(emptyLedger(), census, { maxChars: 800, lineChars });
  assert.ok(slices.length > 20);
  let ledger = emptyLedger();
  for (const s of slices) {
    const f = census.files.find((x) => x.path === s.path);
    ledger = recordRead(ledger, s.path, f.sha, [[s.from, s.to]], META);
  }
  const sum = ledgerSummary(ledger, census, { lineChars });
  assert.equal(sum.percent, 100);
  assert.equal(sum.readChars, sum.totalChars);
  assert.equal(sum.totalChars, census.sums.total.chars);
  assert.deepEqual(sum.missing, []);
  assert.deepEqual(planRounds(ledger, census, { maxChars: 800, lineChars }), []);
}));

test('slices fit in maxChars, never cross a file, and tile the unread lines exactly', withShop((root, census) => {
  const lineChars = charsReader(root);
  const slices = planRounds(emptyLedger(), census, { maxChars: 300, lineChars });
  const covered = new Map();
  for (const s of slices) {
    assert.ok(Number.isInteger(s.from) && s.from >= 1 && s.to >= s.from, JSON.stringify(s));
    const chars = lineChars(s.path).slice(s.from - 1, s.to).reduce((a, b) => a + b, 0);
    assert.equal(s.chars, chars);
    if (!s.oversize) assert.ok(chars <= 300, `${s.path} ${s.from}-${s.to} has ${chars}`);
    const rows = covered.get(s.path) ?? [];
    rows.push([s.from, s.to]);
    covered.set(s.path, rows);
  }
  for (const f of census.files.filter((x) => x.included && x.lines.total > 0)) {
    const rows = covered.get(f.path);
    assert.ok(rows, `${f.path} has no slice`);
    assert.deepEqual(mergeSpans(rows), [[1, f.lines.total]], f.path);
    for (let i = 1; i < rows.length; i++) assert.equal(rows[i][0], rows[i - 1][1] + 1, 'consecutive, no overlap');
  }
  for (const p of covered.keys()) assert.ok(census.files.find((x) => x.path === p && x.included));
}));

test('a big file becomes several slices; a skipped stretch shows up as missing with the right lines', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${String(i + 1).padStart(3, '0')}`).join('\n') + '\n'; // 9 chars a line
  const census = synthetic([{ path: 'big.ts', text }]);
  const lineChars = () => lineCharsOf(text);
  const slices = planRounds(emptyLedger(), census, { maxChars: 90, lineChars });
  assert.equal(slices.length, 10);
  assert.deepEqual(slices[0], { path: 'big.ts', from: 1, to: 10, chars: 90 });
  let ledger = emptyLedger();
  slices.forEach((s, i) => { if (i !== 4) ledger = recordRead(ledger, s.path, SHA, [[s.from, s.to]], META); });
  const sum = ledgerSummary(ledger, census, { lineChars });
  assert.deepEqual(sum.missing, [{ path: 'big.ts', spans: [[41, 50]] }]);
  assert.equal(sum.readChars, 810);
  assert.equal(sum.totalChars, 900);
  assert.equal(sum.percent, 90);
  assert.deepEqual(planRounds(ledger, census, { maxChars: 90, lineChars }), [{ path: 'big.ts', from: 41, to: 50, chars: 90 }]);
});

test('a skipped stretch inside the real census also shows as missing', withShop((root, census) => {
  const lineChars = charsReader(root);
  const target = census.files.filter((f) => f.included && f.lines.total >= 6).sort((a, b) => a.path.localeCompare(b.path))[0];
  let ledger = emptyLedger();
  for (const f of census.files.filter((x) => x.included && x.lines.total)) {
    const total = f.lines.total;
    ledger = recordRead(ledger, f.path, f.sha, f.path === target.path ? [[1, 2], [5, total]] : [[1, total]], META);
  }
  const sum = ledgerSummary(ledger, census, { lineChars });
  assert.ok(sum.percent < 100);
  assert.deepEqual(sum.missing, [{ path: target.path, spans: [[3, 4]] }]);
}));

test('999 of 1000 characters is 99 percent, never rounded up to 100', () => {
  const text = 'a'.repeat(998) + '\nb'; // lines of 999 and 1 characters
  const census = synthetic([{ path: 'x.ts', text }]);
  assert.equal(census.files[0].chars, 1000);
  const ledger = recordRead(emptyLedger(), 'x.ts', SHA, [[1, 1]], META);
  const sum = ledgerSummary(ledger, census, { lineChars: () => lineCharsOf(text) });
  assert.equal(sum.readChars, 999);
  assert.equal(sum.totalChars, 1000);
  assert.equal(sum.percent, 99);
});

test('editing a file (new sha) zeroes only that file entry', withShop((root, census) => {
  const lineChars = charsReader(root);
  const readable = census.files.filter((x) => x.included && x.lines.total);
  let ledger = emptyLedger();
  for (const f of readable) ledger = recordRead(ledger, f.path, f.sha, [[1, f.lines.total]], META);
  assert.equal(ledgerSummary(ledger, census, { lineChars }).percent, 100);
  const victim = readable[0];
  const other = readable[1];
  const edited = { ...census, files: census.files.map((f) => (f.path === victim.path ? { ...f, sha: 'bbbbbbbbbbbbbbbb' } : f)) };
  const sum = ledgerSummary(ledger, edited, { lineChars });
  assert.ok(sum.percent < 100);
  assert.deepEqual(sum.missing, [{ path: victim.path, spans: [[1, victim.lines.total]] }]);
  assert.equal(sum.totalChars - sum.readChars, victim.chars);
  const slices = planRounds(ledger, edited, { maxChars: 1e9, lineChars });
  assert.deepEqual(slices.map((s) => [s.path, s.from, s.to]), [[victim.path, 1, victim.lines.total]]);
  const doc = ledgerDocument(ledger, edited, { lineChars, now: new Date(META.at) });
  assert.equal(doc.files[victim.path], undefined, 'the stale entry is dropped from the document');
  assert.ok(doc.files[other.path]);
}));

test('a file outside the census, or left out of it, does not count', () => {
  const census = synthetic([{ path: 'a.ts', text: 'abc\n' }, { path: 'lib.js', text: 'xyz\n', included: false }]);
  let ledger = recordRead(emptyLedger(), 'ghost.ts', SHA, [[1, 99]], META);
  ledger = recordRead(ledger, 'lib.js', SHA, [[1, 1]], META);
  const sum = ledgerSummary(ledger, census, { lineChars: () => [4] });
  assert.deepEqual(sum, { readChars: 0, totalChars: 4, percent: 0, missing: [{ path: 'a.ts', spans: [[1, 1]] }] });
  assert.deepEqual(planRounds(ledger, census, { maxChars: 10, lineChars: () => [4] }), [{ path: 'a.ts', from: 1, to: 1, chars: 4 }]);
});

test('spans past the end of the file are clipped to its lines', () => {
  const census = synthetic([{ path: 'a.ts', text: 'ab\ncd\n' }]);
  const ledger = recordRead(emptyLedger(), 'a.ts', SHA, [[2, 50]], META);
  const sum = ledgerSummary(ledger, census, { lineChars: () => [3, 3] });
  assert.equal(sum.readChars, 3);
  assert.deepEqual(sum.missing, [{ path: 'a.ts', spans: [[1, 1]] }]);
});

test('a whole-file read needs no line reader; a partial one without a reader is refused, not guessed', () => {
  const census = synthetic([{ path: 'a.ts', text: 'ab\ncd\n' }]);
  const whole = recordRead(emptyLedger(), 'a.ts', SHA, [[1, 2]], META);
  assert.equal(ledgerSummary(whole, census).percent, 100);
  const part = recordRead(emptyLedger(), 'a.ts', SHA, [[1, 1]], META);
  assert.throws(() => ledgerSummary(part, census), /lineChars/);
  assert.throws(() => planRounds(emptyLedger(), census, { maxChars: 10 }), /lineChars/);
});

test('line counts that do not add up to the census chars are treated as unread, never as read', () => {
  const census = synthetic([{ path: 'a.ts', text: 'ab\ncd\n' }]);
  const ledger = recordRead(emptyLedger(), 'a.ts', SHA, [[1, 1]], META);
  const sum = ledgerSummary(ledger, census, { lineChars: () => [3, 4] }); // the file changed behind the census
  assert.equal(sum.readChars, 0);
  assert.deepEqual(sum.missing, [{ path: 'a.ts', spans: [[1, 2]] }]);
});

test('a single line longer than maxChars goes alone and is flagged oversize', () => {
  const text = 'a\n' + 'b'.repeat(500) + '\nc\n';
  const census = synthetic([{ path: 'min.js', text }]);
  const slices = planRounds(emptyLedger(), census, { maxChars: 50, lineChars: () => lineCharsOf(text) });
  assert.deepEqual(slices, [
    { path: 'min.js', from: 1, to: 1, chars: 2 },
    { path: 'min.js', from: 2, to: 2, chars: 501, oversize: true },
    { path: 'min.js', from: 3, to: 3, chars: 2 },
  ]);
});

test('planRounds validates maxChars and orders slices by path', () => {
  const census = synthetic([{ path: 'b.ts', text: 'x\n' }, { path: 'a.ts', text: 'y\n' }]);
  const lineChars = () => [2];
  for (const bad of [0, -1, 1.5, NaN, undefined, '10']) assert.throws(() => planRounds(emptyLedger(), census, { maxChars: bad, lineChars }), /maxChars/);
  assert.deepEqual(planRounds(emptyLedger(), census, { maxChars: 10, lineChars }).map((s) => s.path), ['a.ts', 'b.ts']);
});

test('empty files have nothing to read and an empty census is 0 percent, not a crash', () => {
  const census = synthetic([{ path: 'empty.txt', text: '' }]);
  assert.deepEqual(ledgerSummary(emptyLedger(), census), { readChars: 0, totalChars: 0, percent: 0, missing: [] });
  assert.deepEqual(planRounds(emptyLedger(), census, { maxChars: 10, lineChars: () => [] }), []);
  assert.equal(ledgerSummary(null, { files: [] }).percent, 0);
});

test('ledgerDocument has the contract shape and is plain JSON', withShop((root, census) => {
  const lineChars = charsReader(root);
  const f = census.files.find((x) => x.included && x.lines.total);
  const ledger = recordRead(emptyLedger(), f.path, f.sha, [[1, f.lines.total]], META);
  const doc = ledgerDocument(ledger, census, { lineChars, now: new Date(META.at) });
  assert.deepEqual(Object.keys(doc), ['version', 'generatedAt', 'files', 'summary']);
  assert.equal(doc.version, 1);
  assert.equal(doc.generatedAt, META.at);
  assert.deepEqual(doc.files[f.path], { sha: f.sha, spans: [[1, f.lines.total]], reads: [{ run: 'study-test', model: 'sonnet', at: META.at }] });
  assert.deepEqual(Object.keys(doc.summary), ['readChars', 'totalChars', 'percent', 'missing']);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
}));

test('a ledger of another version is ignored and starts over', () => {
  const old = { version: 7, files: { 'a.ts': { sha: 's', spans: [[1, 9]], reads: [] } } };
  const next = recordRead(old, 'b.ts', 's', [[1, 1]], META);
  assert.deepEqual(Object.keys(next.files), ['b.ts']);
  assert.equal(next.version, 1);
});

test('the module is pure: it never touches the disk, the shell or the network', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'server', 'foundation', 'ledger.mjs'), 'utf8');
  assert.doesNotMatch(src, /node:fs|readFile|execFile|node:child_process|fetch\(/);
});
