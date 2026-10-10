import test from 'node:test';
import assert from 'node:assert/strict';
import { planSplit, verifySplit } from '../server/foundation/split.mjs';
import { brokenLinks, linksOf } from '../server/foundation/mdlinks.mjs';

const filler = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1} of plain text.`);

// A 320-line guide: preamble, 5 H2 sections; section 2 has a fenced "## falso", section 4 has a table.
function guide({ eol = '\n' } = {}) {
  const lines = [
    '# Guide', '', 'Intro text with a link to [other](other.md) and to [code](../src/a.js).', '',
    '![shot](img/shot.png)', '',
    '## Section one', '', ...filler(55, 'one'), 'See [section three](#section-three) and [two](guide.md#section-two).', '',
    '## Section two', '', '```md', '## falso', '[x](nowhere.md)', '```', '', ...filler(55, 'two'), '',
    '## Section three', '', ...filler(55, 'three'), '',
    '## Section four', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', ...filler(55, 'four'), 'Back to [other part](other.md#top) and [one](#section-one).', '',
    '## Section five', '', ...filler(50, 'five'), '',
  ];
  return lines.join(eol);
}
const OTHER = '# Other\n\n<a id="top"></a>\n\nSee [three](guide.md#section-three), [whole](./guide.md), [two](guide.md#section-two) and [self](#top).\n';

const ctx = (extra = {}) => {
  const text = guide();
  return { path: 'docs/guide.md', text, files: { 'docs/guide.md': text, 'docs/other.md': OTHER }, ...extra };
};
const afterOf = (plan, before) => {
  const out = { ...before };
  for (const f of plan.op.files) out[f.path] = f.after;
  return out;
};
const fileOf = (plan, path) => plan.op.files.find((f) => f.path === path)?.after;

test('a 320-line guide with 5 H2 becomes an index plus 5 pieces, cut only at real H2', () => {
  const p = ctx();
  assert.equal(p.text.split('\n').length >= 300, true);
  const plan = planSplit(p);
  assert.equal(plan.ok, true);
  assert.equal(plan.op.kind, 'doc-split');
  const paths = plan.op.files.map((f) => f.path);
  assert.equal(paths[0], 'docs/guide.md');
  for (const s of ['one', 'two', 'three', 'four', 'five']) assert.ok(paths.includes(`docs/guide/section-${s}.md`), s);
  assert.equal(plan.pieces.length, 5);
  // The fenced "## falso" stayed in piece two, and the table in piece four.
  assert.match(fileOf(plan, 'docs/guide/section-two.md'), /^## Section two\n[\s\S]*## falso/);
  assert.match(fileOf(plan, 'docs/guide/section-four.md'), /\| a \| b \|\n\|---\|---\|/);
  assert.equal(paths.some((x) => /falso/.test(x)), false);
});

test('pieces keep their lines byte for byte: the pieces rebuild the original sections', () => {
  const p = ctx();
  const plan = planSplit(p);
  const idx = fileOf(plan, 'docs/guide.md');
  assert.equal(idx.startsWith('# Guide\n\nIntro text'), true);
  const rebuilt = ['one', 'two', 'three', 'four', 'five'].map((s) => fileOf(plan, `docs/guide/section-${s}.md`)).join('');
  const originalSections = p.text.slice(p.text.indexOf('## Section one'));
  // Only link targets may differ.
  const neutral = (t) => t.replace(/\]\([^)]*\)/g, '](_)');
  assert.equal(neutral(rebuilt), neutral(originalSections));
});

test('every non-empty line before is still there after (links aside), and no link is newly broken', () => {
  const p = ctx();
  const plan = planSplit(p);
  const after = afterOf(plan, p.files);
  const v = verifySplit(p.files, after);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.lostLines, []);
  assert.deepEqual(v.newBroken, []);
  assert.deepEqual(brokenLinks(after, () => true), []);
});

test('the index lists every piece with a link and keeps the preamble', () => {
  const plan = planSplit(ctx());
  const idx = fileOf(plan, 'docs/guide.md');
  assert.match(idx, /- \[Section one\]\(guide\/section-one\.md\)/);
  assert.match(idx, /- \[Section five\]\(guide\/section-five\.md\)/);
  assert.equal(idx.includes('## Section'), false);
  const targets = linksOf(idx).map((l) => l.target);
  assert.ok(targets.includes('other.md'), 'the preamble links stay as written (same folder as the original)');
  assert.ok(targets.includes('../src/a.js'));
});

test('links from other files follow the heading to its piece, anchor and all', () => {
  const plan = planSplit(ctx());
  const other = fileOf(plan, 'docs/other.md');
  assert.match(other, /\[three\]\(guide\/section-three\.md#section-three\)/);
  assert.match(other, /\[two\]\(guide\/section-two\.md#section-two\)/);
  assert.match(other, /\[whole\]\(\.\/guide\.md\)/);
  assert.match(other, /\[self\]\(#top\)/);
});

test('links in a file in another folder are rewritten relative to that file', () => {
  const p = ctx();
  p.files['README.md'] = 'Read [the guide](docs/guide.md#section-four) or [all](docs/guide.md).\n';
  const plan = planSplit(p);
  assert.equal(fileOf(plan, 'README.md'), 'Read [the guide](docs/guide/section-four.md#section-four) or [all](docs/guide.md).\n');
});

test('links inside pieces: one level deeper for paths, sibling pieces for anchors', () => {
  const plan = planSplit(ctx());
  const one = fileOf(plan, 'docs/guide/section-one.md');
  assert.match(one, /\[section three\]\(section-three\.md#section-three\)/);
  assert.match(one, /\[two\]\(section-two\.md#section-two\)/);
  const four = fileOf(plan, 'docs/guide/section-four.md');
  assert.match(four, /\[other part\]\(\.\.\/other\.md#top\)/);
  assert.match(four, /\[one\]\(section-one\.md#section-one\)/);
  // A link written in the preamble keeps its target in the index (same folder as the original).
  assert.match(fileOf(plan, 'docs/guide.md'), /\(img\/shot\.png\)/);
});

test('a same-piece anchor stays a plain #anchor', () => {
  const text = ['# T', '', '## A', '', 'go [down](#b-sub) and [up](#a)', '', '### B sub', '', '## C', 'x'].join('\n');
  const plan = planSplit({ path: 'd.md', text, files: { 'd.md': text } });
  assert.equal(plan.ok, true);
  assert.match(fileOf(plan, 'd/a.md'), /\[down\]\(#b-sub\) and \[up\]\(#a\)/);
});

test('images and relative paths inside pieces get the extra level; code samples are untouched', () => {
  const text = ['# T', '', '## A', '', '![i](img/a.png) and [c](../src/a.js)', '`[x](img/a.png)`', '', '## B', '', 'b'].join('\n');
  const plan = planSplit({ path: 'docs/d.md', text, files: { 'docs/d.md': text } });
  assert.match(fileOf(plan, 'docs/d/a.md'), /!\[i\]\(\.\.\/img\/a\.png\) and \[c\]\(\.\.\/\.\.\/src\/a\.js\)\n`\[x\]\(img\/a\.png\)`/);
});

test('repeated titles get -2 in the file name and the anchor is renumbered', () => {
  const text = ['# T', '', '## Setup', 'one', '', '## Setup', 'two', '', '## Setup', 'three'].join('\n');
  const files = { 'a.md': text, 'b.md': 'x [first](a.md#setup) [second](a.md#setup-1) [third](a.md#setup-2)\n' };
  const plan = planSplit({ path: 'a.md', text, files });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.op.files.map((f) => f.path).slice(1, 4), ['a/setup.md', 'a/setup-2.md', 'a/setup-3.md']);
  assert.equal(fileOf(plan, 'b.md'), 'x [first](a/setup.md#setup) [second](a/setup-2.md#setup) [third](a/setup-3.md#setup)\n');
});

test('front matter and the preamble stay in the index', () => {
  const text = ['---', 'title: Doc', '---', '', '# Doc', 'intro', '', '## A', 'a', '', '## B', 'b'].join('\n');
  const plan = planSplit({ path: 'doc.md', text, files: { 'doc.md': text } });
  const idx = fileOf(plan, 'doc.md');
  assert.equal(idx.startsWith('---\ntitle: Doc\n---\n\n# Doc\nintro\n'), true);
  assert.equal(fileOf(plan, 'doc/a.md').startsWith('## A\n'), true);
});

test('CRLF is preserved in every file and the added list', () => {
  const text = guide({ eol: '\r\n' });
  const plan = planSplit({ path: 'docs/guide.md', text, files: { 'docs/guide.md': text } });
  assert.equal(plan.ok, true);
  for (const f of plan.op.files) assert.equal(/[^\r]\n/.test(f.after), false, f.path);
  assert.match(fileOf(plan, 'docs/guide.md'), /\(guide\/section-one\.md\)\r\n/);
});

test('setext H2 headings cut too and keep their underline', () => {
  const text = ['# T', '', 'Alpha part', '----------', 'a', '', 'Beta part', '---', 'b'].join('\n');
  const plan = planSplit({ path: 't.md', text, files: { 't.md': text } });
  assert.equal(plan.ok, true);
  assert.equal(fileOf(plan, 't/alpha-part.md'), 'Alpha part\n----------\na\n\n');
  assert.equal(fileOf(plan, 't/beta-part.md'), 'Beta part\n---\nb');
});

test('a link that was already broken does not stop the split and stays as broken as before', () => {
  const text = ['# T', '', '## A', '[gone](gone.md) and [bad](#nope)', '', '## B', 'b'].join('\n');
  const files = { 't.md': text };
  const plan = planSplit({ path: 't.md', text, files });
  assert.equal(plan.ok, true);
  assert.match(fileOf(plan, 't/a.md'), /\[gone\]\(\.\.\/gone\.md\) and \[bad\]\(#nope\)/);
  const v = verifySplit(files, afterOf(plan, files));
  assert.equal(v.ok, true);
});

test('a reference definition used from another piece would break: nothing is generated', () => {
  const text = ['# T', '', '## A', 'see [site][s]', '', '## B', 'b', '', '[s]: https://example.com'].join('\n');
  const plan = planSplit({ path: 't.md', text, files: { 't.md': text } });
  assert.deepEqual([plan.ok, plan.why], [false, 'link-would-break']);
  assert.equal(plan.op, undefined);
});

test('a reference definition used in its own piece is rewritten with the piece', () => {
  const text = ['# T', '', '## A', 'see [x][r]', '', '[r]: img/a.md "t"', '', '## B', 'b'].join('\n');
  const plan = planSplit({ path: 'd/t.md', text, files: { 'd/t.md': text } });
  assert.equal(plan.ok, true);
  assert.match(fileOf(plan, 'd/t/a.md'), /\[r\]: \.\.\/img\/a\.md "t"/);
});

test('a footnote defined in another piece also refuses', () => {
  const text = ['# T', '', '## A', 'word[^1]', '', '## B', '[^1]: the note'].join('\n');
  const plan = planSplit({ path: 't.md', text, files: { 't.md': text } });
  assert.equal(plan.why, 'link-would-break');
});

test('changelogs and registries are append-only: archive, never split', () => {
  const text = ['# Changelog', '', '## 1.1', 'x', '', '## 1.0', 'y'].join('\n');
  assert.deepEqual(planSplit({ path: 'CHANGELOG.md', text, files: {} }), { ok: false, why: 'append-only' });
  assert.equal(planSplit({ path: 'docs/decisions/log.md', text, files: {} }).why, 'append-only');
});

test('fewer than two H2 sections is not worth splitting', () => {
  const text = ['# T', '', '## Only', 'x', '```', '## fake', '```'].join('\n');
  assert.equal(planSplit({ path: 't.md', text, files: {} }).why, 'too-few-sections');
  assert.equal(planSplit({ path: 't.md', text: '', files: {} }).why, 'too-few-sections');
});

test('a piece that would land on an existing file is a name clash (any letter case)', () => {
  const p = ctx();
  p.files['docs/guide/Section-Three.md'] = '# mine\n';
  assert.equal(planSplit(p).why, 'name-clash');
  const q = ctx();
  assert.equal(planSplit({ ...q, existsOnDisk: (x) => x === 'docs/guide/section-one.md' }).why, 'name-clash');
});

test('titles that cannot be a file name still get a safe unique one', () => {
  const text = ['# T', '', '## \u{1F680}', 'a', '', '## CON', 'b', '', '## \u{1F680}', 'c'].join('\n');
  const plan = planSplit({ path: 't.md', text, files: {} });
  assert.equal(plan.ok, true);
  const names = plan.op.files.slice(1).map((f) => f.path);
  assert.equal(new Set(names).size, 3);
  for (const n of names) assert.match(n, /^t\/[\p{L}\p{N}_-]+\.md$/u);
  assert.equal(names.some((n) => /\/con\.md$/.test(n)), false);
});

test('files with no relation to the original are not in the operation', () => {
  const p = ctx();
  p.files['docs/unrelated.md'] = '# U\n[o](other.md)\n';
  const plan = planSplit(p);
  assert.equal(plan.op.files.some((f) => f.path === 'docs/unrelated.md'), false);
  assert.deepEqual(plan.updated, ['docs/other.md']);
});

test('the plan is only a plan: inputs are not changed and the same input gives the same plan', () => {
  const p = ctx();
  const snapshot = JSON.stringify(p);
  const a = planSplit(p);
  assert.equal(JSON.stringify(p), snapshot);
  assert.deepEqual(planSplit(ctx()), a);
});

test('verifySplit reports a lost line and a new broken link', () => {
  const before = { 'a.md': '# A\nkeep this line\n[x](b.md)\n', 'b.md': '# B\n' };
  const lost = verifySplit(before, { 'a.md': '# A\n[x](b.md)\n', 'b.md': '# B\n' });
  assert.equal(lost.ok, false);
  assert.deepEqual(lost.lostLines, ['keep this line']);
  const broke = verifySplit(before, { 'a.md': '# A\nkeep this line\n[x](c.md)\n', 'b.md': '# B\n' });
  assert.equal(broke.ok, false);
  assert.equal(broke.newBroken.length >= 1, true);
  const moved = verifySplit(before, { 'a.md': '# A\nkeep this line\n[x](sub/b.md)\n', 'b.md': '# B\n', 'sub/b.md': '# B\n' });
  assert.equal(moved.ok, true);
});

test('verifySplit ignores the link target when comparing lines, but not the words around it', () => {
  const before = { 'a.md': 'see [x](old.md#a) now\n', 'old.md': '# a\n' };
  assert.equal(verifySplit(before, { 'a.md': 'see [x](old.md#a) now\n', 'old.md': '# a\n' }).ok, true);
  assert.equal(verifySplit(before, { 'a.md': 'see [x](old.md#a) later\n', 'old.md': '# a\n' }).ok, false);
  assert.equal(verifySplit(before, { 'a.md': 'see [y](old.md#a) now\n', 'old.md': '# a\n' }).ok, false);
});

test('a heading-looking line inside an HTML comment is not a cut point', () => {
  const text = ['# T', '', '<!--', '## hidden', '-->', '', '## A', 'a', '', '## B', 'b'].join('\n');
  const plan = planSplit({ path: 't.md', text, files: {} });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.pieces.map((x) => x.title), ['A', 'B']);
  assert.match(fileOf(plan, 't.md'), /<!--\n## hidden\n-->/);
});

test('applying the plan keeps every non-empty line and Undo restores the original (real files)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { applyOp, undoOp } = await import('../server/foundation/care.mjs');
  const root = mkdtempSync(join(tmpdir(), 'sm-split-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-split-sm-'));
  try {
    const p = ctx();
    mkdirSync(join(root, 'docs'), { recursive: true });
    for (const [rel, text] of Object.entries(p.files)) writeFileSync(join(root, rel), text);
    const plan = planSplit(p);
    const project = { id: 'acme-docs-1', root };
    const done = applyOp(project, { ...plan.op, id: 'op:split-1' }, { smDir, mode: 'auto' });
    assert.equal(done.ok, true, JSON.stringify(done));
    const now = {};
    for (const f of ['docs/guide.md', 'docs/other.md', ...plan.pieces.map((x) => x.path)]) now[f] = readFileSync(join(root, f), 'utf8');
    const v = verifySplit(p.files, now);
    assert.deepEqual([v.lostLines, v.newBroken], [[], []]);
    const undone = undoOp(project, 'op:split-1', { smDir, confirm: true });
    assert.equal(undone.ok, true, JSON.stringify(undone));
    assert.equal(readFileSync(join(root, 'docs/guide.md'), 'utf8'), p.text);
    assert.equal(readFileSync(join(root, 'docs/other.md'), 'utf8'), OTHER);
    assert.equal(existsSync(join(root, 'docs/guide')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});
