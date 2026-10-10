import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../server/collect.mjs';
import { projectIdOf } from '../server/paths.mjs';
import { PIECES } from '../server/foundation/summary.mjs';
import { writeFd } from '../server/foundation/store.mjs';

const NOW = new Date('2026-10-10T12:00:00Z');
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sm-fdcollect-')));
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

function setup() {
  const dir = tmp();
  const smDir = tmp();
  const root = join(tmp(), 'acme-shop');
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'src', 'cart.ts'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ts = new Date(NOW.getTime() - 3_600_000).toISOString();
  const base = { sessionId: id, cwd: root, gitBranch: 'main', timestamp: ts };
  const lines = [
    { ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'add the cart' }] } },
    { ...base, type: 'assistant', message: { id: 'm1', model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text: 'done.' }], usage: { input_tokens: 10, output_tokens: 10 } } },
  ];
  const projDir = join(dir, 'projects', root.replace(/[^a-z0-9]/gi, '-'));
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const t = (NOW.getTime() - 3_600_000) / 1000;
  utimesSync(file, t, t);
  return { dir, smDir, root, cleanup: () => { for (const d of [dir, smDir, join(root, '..')]) rmSync(d, { recursive: true, force: true }); } };
}

test('every project carries project.foundation: null until something was read, then the summary of its files', async () => {
  const { dir, smDir, root, cleanup } = setup();
  const piece = (read) => ({ census: read('census.json') && { rev: read('census.json').rev, files: 1, lines: 1, noOwner: 0 } });
  try {
    const [first] = (await collect({ dir, smDir, now: NOW, isAlive: () => false, ai: { bin: null } })).projects;
    assert.equal(first.id, projectIdOf(root));
    assert.ok('foundation' in first);
    assert.equal(first.foundation, null);
    writeFd(smDir, first.id, 'census.json', { version: 1, generatedAt: '2026-10-10T11:00:00.000Z', rev: 5 });
    PIECES.push(piece);
    const [again] = (await collect({ dir, smDir, now: NOW, isAlive: () => false, ai: { bin: null } })).projects;
    assert.deepEqual(again.foundation.census, { rev: 5, files: 1, lines: 1, noOwner: 0 });
    assert.equal(again.foundation.updatedAt, '2026-10-10T11:00:00.000Z');
  } finally {
    if (PIECES.includes(piece)) PIECES.splice(PIECES.indexOf(piece), 1);
    cleanup();
  }
});
