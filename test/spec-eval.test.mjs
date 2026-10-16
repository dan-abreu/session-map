import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { deriveSpecialists } from '../server/ai/specialists.mjs';
import { MIN_PAIRS, mineCases, promptFor, reportMarkdown, runSpecEval, scoreLocate, scrubTask, summarizeSpecEval } from '../server/ai/spec-eval.mjs';

// The A/B that proves a specialist's card (id158, or68): real fix commits as cases, scored against what the real fix did.

const FILES = {
  'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Beta](beta.md)\n',
  'alpha.md': '# Alpha\n\nAlpha works.\n\n## Where in the code\n\n- `server/alpha/`\n\n## What\'s missing\n\n- [ ] x `al01`\n',
  'beta.md': '# Beta\n\nBeta works.\n\n## Where in the code\n\n- `server/beta/`\n\n## What\'s missing\n\n- [ ] y `be01`\n',
};
const arch = parseArch('docs/architecture', FILES, 'worktree');
const specialistsAt = (inventory) => deriveSpecialists({ arch, readPart: (p) => FILES[p.file.split('/').pop()], files: inventory });
const INVENTORY = ['server/alpha/a.mjs', 'server/alpha/b.mjs', 'server/beta/c.mjs', 'test/alpha-a.test.mjs', 'test/beta-c.test.mjs', 'docs/x.md'];

// A fake git: one log with five commits, each told by its subject and the files it changed.
const LOG = [
  ['a1', 'p1', 'fix(alpha): the header lost server/alpha/a.mjs on reload', ['server/alpha/a.mjs', 'test/alpha-a.test.mjs']],
  ['a2', 'p2', 'feat: a new thing', ['server/alpha/a.mjs', 'test/alpha-a.test.mjs']],
  ['a3', 'p3', 'fix: no test came with it', ['server/alpha/b.mjs']],
  ['a4', 'p4', 'fix: touches too much', Array.from({ length: 12 }, (_, i) => `server/alpha/f${i}.mjs`)],
  ['a5', 'p5', 'fix: beta reads wrong', ['server/beta/c.mjs', 'test/beta-c.test.mjs']],
  ['a6', 'p6', 'fix: another alpha', ['server/alpha/b.mjs', 'test/alpha-a.test.mjs']],
].map(([sha, parent, subject, names]) => `\x1e${sha}\x1f${parent}\x1f${subject}\n\n${names.join('\n')}\n`).join('');
const git = async (args) => {
  if (args[0] === 'log') return LOG;
  if (args[0] === 'ls-tree') return INVENTORY.join('\n');
  if (args[0] === 'show') return 'Body of the fix in server/alpha/a.mjs.';
  return '';
};

test('scrubTask takes out the paths and file names that would hand over the answer', () => {
  const t = scrubTask('the header lost server/alpha/a.mjs', 'It was in guard.mjs and config.json too.');
  assert.doesNotMatch(t, /server\/alpha|\.mjs|\.json/);
  assert.match(t, /the header lost <path>/);
});

test('mining keeps the fix commits that touched source and tests in one part, and caps each part', async () => {
  const cases = await mineCases({ git, arch, specialistsAt, max: 10, perSpecialist: 2 });
  assert.deepEqual(cases.map((c) => c.id), ['a1', 'a5', 'a6'], 'a feat, a fix without tests and a 12-file fix are left out');
  const [first] = cases;
  assert.equal(first.specialistId, 'sm-alpha');
  assert.deepEqual(first.truth, { files: ['server/alpha/a.mjs'], tests: ['test/alpha-a.test.mjs'] });
  assert.match(first.card, /You own the "Alpha" part/);
  assert.ok(first.inventory.includes('server/beta/c.mjs') && !first.inventory.includes('docs/x.md'), 'the whole repository minus docs, for both arms');
  assert.doesNotMatch(first.task, /server\/alpha/);
  const capped = await mineCases({ git, arch, specialistsAt, max: 10, perSpecialist: 1 });
  assert.deepEqual(capped.map((c) => c.specialistId), ['sm-alpha', 'sm-beta']);
});

test('the two arms differ only by the card', () => {
  const item = { task: 'T', inventory: ['a', 'b'], card: 'THE CARD' };
  const plain = promptFor(item, 'plain');
  const card = promptFor(item, 'card');
  assert.ok(!plain.includes('THE CARD') && card.includes('THE CARD'));
  assert.equal(card.replace('\nYour standing instructions for this work:\nTHE CARD\n', ''), plain);
});

test('scoring: F1 of files (60 %) and tests (40 %), wrong paths counted, a bad shape is zero', () => {
  const item = { inventory: ['f1', 'f2', 't1'], truth: { files: ['f1'], tests: ['t1'] } };
  assert.deepEqual(scoreLocate(item, { files: ['f1'], tests: ['t1'] }), { score: 1, filesF1: 1, testsF1: 1, invalid: 0 });
  const half = scoreLocate(item, { files: ['f1', 'f2'], tests: ['nope'] });
  assert.equal(half.filesF1, 0.666667);
  assert.equal(half.testsF1, 0);
  assert.equal(half.invalid, 1);
  assert.equal(half.score, 0.4);
  assert.equal(scoreLocate({ ...item, truth: { files: ['f1'], tests: [] } }, { files: ['f1'] }).score, 1, 'without tests in the truth the files are the whole score');
  assert.equal(scoreLocate(item, 'nonsense').badShape, true);
  assert.equal(scoreLocate(item, { files: [] }).score, 0);
});

const CASES = [
  { id: 'c1', partId: 'alpha', task: 'T1', inventory: ['f1', 'f2', 't1'], card: 'CARD', truth: { files: ['f1'], tests: ['t1'] } },
  { id: 'c2', partId: 'beta', task: 'T2', inventory: ['g1', 't2'], card: 'CARD', truth: { files: ['g1'], tests: ['t2'] } },
];

test('a run asks every case in both arms for every AI, resumes without asking twice, and stops at the cap before asking', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-speceval-'));
  try {
    const asked = [];
    const call = async (c, prompt) => {
      asked.push([c.id, prompt.includes('CARD') ? 'card' : 'plain']);
      // The card knows the answer; the plain arm guesses wrong.
      return { ok: true, costUSD: 0.01, value: prompt.includes('CARD') ? { files: [prompt.includes('T1') ? 'f1' : 'g1'], tests: [prompt.includes('T1') ? 't1' : 't2'] } : { files: ['zzz'], tests: [] } };
    };
    const dry = await runSpecEval({ smDir, cases: CASES, only: ['claude:haiku', 'claude:sonnet'], dryRun: true });
    assert.equal(dry.plan.calls, 8);
    const out = await runSpecEval({ smDir, cases: CASES, only: ['claude:haiku', 'claude:sonnet'], maxUSD: 4, runId: 'r1' }, { call });
    assert.equal(out.results.length, 8);
    assert.equal(asked.length, 8);
    const rows = summarizeSpecEval(out.results);
    assert.deepEqual(rows.map((r) => [r.contestant, r.pairs, r.plain, r.card, r.gain]), [['claude:haiku', 2, 0, 1, 1], ['claude:sonnet', 2, 0, 1, 1]]);
    assert.equal(rows[0].verdict, 'unproven', `fewer than ${MIN_PAIRS} cases prove nothing`);
    asked.length = 0;
    await runSpecEval({ smDir, cases: CASES, only: ['claude:haiku'], resume: 'r1', maxUSD: 4 }, { call });
    assert.equal(asked.length, 0, 'the answers already kept are not asked again');
    const capped = await runSpecEval({ smDir, cases: CASES, only: ['claude:haiku'], maxUSD: 0.05, runId: 'r2' }, { call });
    assert.equal(asked.length, 0, 'a worst-case price over the cap is refused before the call');
    assert.equal(capped.results.length, 0);
    assert.match(capped.notes.join(' '), /total cap/);
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the verdict: on when the card gains and wins more than it loses, off when it does not, unproven with few cases', () => {
  const rows = (card, plain, n) => summarizeSpecEval(Array.from({ length: n }, (_, i) => [
    { contestant: 'x:m', arm: 'plain', caseId: `c${i}`, partId: 'alpha', ok: true, score: plain, costUSD: 0.01, invalid: 1 },
    { contestant: 'x:m', arm: 'card', caseId: `c${i}`, partId: 'alpha', ok: true, score: card, costUSD: 0.01, invalid: 0 },
  ]).flat())[0];
  assert.equal(rows(0.7, 0.5, 8).verdict, 'on');
  assert.equal(rows(0.7, 0.5, 5).verdict, 'unproven');
  assert.equal(rows(0.5, 0.5, 8).verdict, 'off');
  assert.equal(rows(0.4, 0.5, 8).verdict, 'off');
  assert.equal(rows(0.7, 0.5, 8).invalidPlain, 8);
  const md = reportMarkdown({ runId: 'r', rows: [rows(0.7, 0.5, 8)], spentUSD: 0.16 });
  assert.match(md, /\| x:m \| 8 \| 0\.50 \| 0\.70 \| \+0\.20 \| 8\/0\/0 \| 8 → 0 \| on \|/);
});
