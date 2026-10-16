import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format, measureProject } from '../scripts/measure-project.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// fd29: the coverage numbers of the Foundation on a real folder, read only.

test('a fixture repository gives its coverage: code understood, facts by kind, a sample checked against the source', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-measure-'));
  try {
    const m = await measureProject(root, { smDir, now: new Date('2026-10-16T12:00:00Z') });
    assert.ok(m.files > 10 && m.codeFiles > 5);
    assert.ok(m.codeUnderstoodPct >= 50, `the readers understood ${m.codeUnderstoodPct}% of the code`);
    assert.ok(m.facts > 20 && m.kinds.route > 0 && m.kinds.function > 0);
    for (const [kind, e] of Object.entries(m.evidence)) assert.ok(e.sampled > 0 && e.found <= e.sampled, kind);
    const text = format(m);
    assert.match(text, /^== /);
    assert.match(text, /code files \d+; understood/);
    assert.ok(!existsSync(join(root, '.claude', 'session-map.json')), 'nothing was written into the project');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
    removeFixtureRepo(root);
  }
});

test('a folder with no code is measured as such, without dividing by zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-measure-docs-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-measure-sm-'));
  try {
    writeFileSync(join(root, 'GDD.md'), '# A game design document\n');
    const m = await measureProject(root, { smDir });
    assert.deepEqual([m.codeFiles, m.codeUnderstoodPct, m.facts], [0, null, 0]);
    assert.match(format(m), /nothing to sample/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});
