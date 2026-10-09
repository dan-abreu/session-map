import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRoadmap } from '../server/sources/roadmap.mjs';

const MD = `# Roadmap

## Launch track

| # | Step | Owner | Status |
|---|------|-------|--------|
| 1 | Set up servers | A | ✅ |
| 2 | Open beta | B | ⬜ |

### Security

- [x] 3. Rotate keys
- [ ] 4. Pen test

## Decisions

| # | Decision | Status |
|---|----------|--------|
| 9 | Pick a payment provider | to confirm |
| 10 | Logo | settled |
`;

const DECISIONS = { heading: 'Decisions', pendingWhen: 'to confirm' };

function withFile(md, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-rm-'));
  try { const f = join(dir, 'R.md'); writeFileSync(f, md); return fn(f); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('readRoadmap turns table rows and checklists into milestones under their heading', () => {
  withFile(MD, (f) => {
    const { milestones } = readRoadmap(f, { decisions: DECISIONS });
    assert.deepEqual(milestones.map((m) => [m.id, m.title, m.branch, m.status]), [
      ['1', 'Set up servers', 'Launch track', 'done'],
      ['2', 'Open beta', 'Launch track', 'open'],
      ['3', 'Rotate keys', 'Security', 'done'],
      ['4', 'Pen test', 'Security', 'open'],
    ]);
    assert.equal(milestones[0].workCellId, null);
  });
});

test('readRoadmap collects pending decisions only from the decisions section', () => {
  withFile(MD, (f) => {
    const { decisions } = readRoadmap(f, { decisions: DECISIONS });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].kind, 'decision');
    assert.match(decisions[0].text, /payment provider/);
    assert.equal(decisions[0].sessionId, null);
  });
});

test('readRoadmap without decisions config or with a missing file is empty, not an error', () => {
  withFile(MD, (f) => assert.deepEqual(readRoadmap(f).decisions, []));
  assert.deepEqual(readRoadmap(join(tmpdir(), 'nope-sm.md'), {}), { milestones: [], decisions: [] });
});
