import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashChanges, changeDetail, changeRows, changesIn, freshOf, readChanges } from '../server/changes.mjs';

const CWD = 'C:/dev/shop';
const TS = '2026-10-09T10:00:00.000Z';
let n = 0;

function step(name, input, result, { model = 'claude-sonnet-4', isError = false } = {}) {
  const id = `t${++n}`;
  return [
    { type: 'assistant', timestamp: TS, cwd: CWD, message: { model, content: [{ type: 'tool_use', id, name, input }] } },
    {
      type: 'user', timestamp: TS, cwd: CWD,
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'denied' : 'ok', ...(isError ? { is_error: true } : {}) }] },
      ...(result ? { toolUseResult: result } : {}),
    },
  ];
}

test('an edit counts the lines its patch added and removed, with the model that wrote it', () => {
  const patch = [{ oldStart: 3, oldLines: 3, newStart: 3, newLines: 4, lines: [' a', '-b', '+B', '+C', ' d'] }];
  const [c] = changesIn(step('Edit', { file_path: 'C:/dev/shop/src/a.js', old_string: 'b', new_string: 'B\nC' }, { filePath: 'C:/dev/shop/src/a.js', structuredPatch: patch }), { cwd: CWD });
  assert.equal(c.kind, 'edit');
  assert.equal(c.path, 'C:/dev/shop/src/a.js');
  assert.deepEqual([c.added, c.removed], [2, 1]);
  assert.equal(c.model, 'claude-sonnet-4');
  assert.equal(c.ts, TS);
});

test('a new file written whole is a creation with every line added; overwriting one is an edit', () => {
  const [made] = changesIn(step('Write', { file_path: 'C:/dev/shop/new.md', content: 'x\ny\nz\n' }, { type: 'create', filePath: 'C:/dev/shop/new.md', content: 'x\ny\nz\n', structuredPatch: [] }));
  assert.deepEqual([made.kind, made.added, made.removed], ['create', 3, 0]);
  const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }];
  const [over] = changesIn(step('Write', { file_path: 'C:/dev/shop/new.md', content: 'new' }, { type: 'update', filePath: 'C:/dev/shop/new.md', content: 'new', structuredPatch: patch }));
  assert.deepEqual([over.kind, over.added, over.removed], ['edit', 1, 1]);
});

test('without a patch an edit is counted by the lines that differ between before and after', () => {
  const [c] = changesIn(step('Edit', { file_path: 'C:/dev/shop/a.js', old_string: 'keep\nold\nkeep2', new_string: 'keep\nnew1\nnew2\nkeep2' }, null));
  assert.deepEqual([c.added, c.removed], [2, 1]);
  const [multi] = changesIn(step('MultiEdit', { file_path: 'C:/dev/shop/a.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd\ne' }] }, null));
  assert.deepEqual([multi.kind, multi.added, multi.removed], ['edit', 3, 2]);
});

test('a refused or failed step, and one still waiting for its result, change nothing', () => {
  assert.deepEqual(changesIn(step('Edit', { file_path: 'C:/dev/shop/a.js', old_string: 'a', new_string: 'b' }, null, { isError: true })), []);
  const [use] = step('Write', { file_path: 'C:/dev/shop/b.js', content: 'b' }, null);
  assert.deepEqual(changesIn([use]), []);
  assert.deepEqual(changesIn(step('Bash', { command: 'rm src/a.js' }, null, { isError: true }), { cwd: CWD }), []);
});

test('removing and renaming from the command line are changes too, resolved from the folder the command ran in', () => {
  assert.deepEqual(bashChanges('rm -f src/a.js src/b.js', CWD), [{ kind: 'delete', path: 'C:/dev/shop/src/a.js' }, { kind: 'delete', path: 'C:/dev/shop/src/b.js' }]);
  assert.deepEqual(bashChanges('cd server && git rm -q old.mjs', CWD), [{ kind: 'delete', path: 'C:/dev/shop/server/old.mjs' }]);
  assert.deepEqual(bashChanges('git mv "src/x y.js" src/z.js', CWD), [{ kind: 'rename', from: 'C:/dev/shop/src/x y.js', path: 'C:/dev/shop/src/z.js' }]);
  assert.deepEqual(bashChanges('mv a.js lib/', CWD), [{ kind: 'rename', from: 'C:/dev/shop/a.js', path: 'C:/dev/shop/lib/a.js' }]);
  assert.deepEqual(bashChanges('Remove-Item -Path C:\\dev\\shop\\tmp.txt -Force', 'C:/elsewhere'), [{ kind: 'delete', path: 'C:/dev/shop/tmp.txt' }]);
  assert.deepEqual(bashChanges('Rename-Item -Path docs/a.md -NewName b.md', CWD), [{ kind: 'rename', from: 'C:/dev/shop/docs/a.md', path: 'C:/dev/shop/docs/b.md' }]);
  assert.deepEqual(bashChanges('rm /c/dev/shop/x.js', 'C:/other'), [{ kind: 'delete', path: 'C:/dev/shop/x.js' }]);
});

test('commands whose files cannot be known for sure are left out', () => {
  assert.deepEqual(bashChanges('rm -rf dist/*.js', CWD), [], 'a glob');
  assert.deepEqual(bashChanges('rm "$FILE"', CWD), [], 'a variable');
  assert.deepEqual(bashChanges('git rm --cached secret.txt', CWD), [], 'only leaves the version history');
  assert.deepEqual(bashChanges('echo rm a.js && grep mv b', CWD), [], 'words inside other commands');
  assert.deepEqual(bashChanges('npm run build', CWD), []);
});

test('a command step that ran well lists what it removed and renamed', () => {
  const out = changesIn(step('Bash', { command: 'git mv a.js b.js && rm c.js' }, { stdout: '', stderr: '' }), { cwd: CWD });
  assert.deepEqual(out.map((c) => [c.kind, c.path, c.from ?? null]), [['rename', 'C:/dev/shop/b.js', 'C:/dev/shop/a.js'], ['delete', 'C:/dev/shop/c.js', null]]);
  assert.deepEqual([out[1].added, out[1].removed], [0, 0]);
});

test('the change log reads only what was appended since the last pass, and finds the before and after of each step again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-changes-'));
  try {
    const file = join(dir, 's.jsonl');
    const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' keep', '-API_KEY=sk-abcdefghijklmnop1234', '+API_KEY=…'] }];
    writeFileSync(file, step('Edit', { file_path: 'C:/dev/shop/a.js', old_string: 'x', new_string: 'y' }, { filePath: 'C:/dev/shop/a.js', structuredPatch: patch }).map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.deepEqual(readChanges(file, { deadline: Date.now() - 1 }), [], 'past its time budget a pass reads nothing and leaves the rest for the next one');
    const first = readChanges(file);
    assert.equal(first.length, 1);
    appendFileSync(file, step('Write', { file_path: 'C:/dev/shop/n.txt', content: 'one\ntwo' }, { type: 'create', filePath: 'C:/dev/shop/n.txt', content: 'one\ntwo', structuredPatch: [] }).map((l) => JSON.stringify(l)).join('\n') + '\n');
    const second = readChanges(file);
    assert.equal(second.length, 2);
    assert.equal(second[0], first[0], 'the first change is kept, not read again');
    const edit = changeDetail(file, second[0]);
    assert.deepEqual(edit.hunks[0].lines.map((l) => l[0]), [' ', '-', '+']);
    assert.doesNotMatch(JSON.stringify(edit), /sk-abcdefghijklmnop1234/, 'secrets stay masked');
    const made = changeDetail(file, second[1]);
    assert.deepEqual(made.hunks[0].lines, ['+one', '+two']);
    assert.equal(changeDetail(file, { ...second[0], at: 3 }), null, 'an offset that does not start that step finds nothing');
    assert.equal(changeDetail(file, { ...second[0], useAt: second[1].useAt }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


const ownersOf = (files) => files.map((f) => (f.startsWith('src/shop/') ? 'shop' : f.startsWith('src/billing/') ? 'billing' : null));
const ev = (over) => ({ id: 'e1', ts: '2026-10-09T10:00:00.000Z', kind: 'edit', path: 'src/shop/cart.js', added: 3, removed: 1, sessionId: 's1', title: 'Cart work', agent: null, model: 'claude-sonnet-4', ...over });

test('a change becomes saved with the first saved change after it that holds the file, and released with its version', () => {
  const commits = [
    { kind: 'commit', hash: 'bbb2222', ts: '2026-10-09T12:00:00.000Z', files: ['src/shop/cart.js'] },
    { kind: 'commit', hash: 'aaa1111', ts: '2026-10-09T11:00:00.000Z', files: ['src/shop/cart.js', 'src/billing/pay.js'] },
    { kind: 'commit', hash: 'old0000', ts: '2026-10-09T09:00:00.000Z', files: ['src/shop/cart.js'] },
  ];
  const rows = changeRows({
    events: [ev(), ev({ id: 'e2', path: 'src/billing/pay.js', ts: '2026-10-09T11:30:00.000Z' }), ev({ id: 'e3', path: 'src/shop/new.js', kind: 'create' })],
    worktree: [], commits, tagOf: new Map([['aaa1111', 'v1.2.0']]), ownersOf, nowIso: '2026-10-09T13:00:00.000Z',
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([byId.e1.state, byId.e1.hash, byId.e1.tag], ['released', 'aaa1111', 'v1.2.0'], 'the oldest saved change after it, not one from before');
  assert.deepEqual([byId.e2.state, byId.e2.hash ?? null], ['pending', null], 'the file was saved before this edit, not after');
  assert.equal(byId.e3.state, 'pending');
  assert.equal(byId.e1.partId, 'shop');
  assert.equal(byId.e2.partId, 'billing');
  assert.deepEqual(rows.map((r) => r.id), ['e2', 'e1', 'e3'], 'newest first; a tie keeps the order the steps happened in');
});

test('the folder adds what no conversation explains, made by hand or by another tool, and marks the conversation edits still there', () => {
  const rows = changeRows({
    events: [ev()],
    worktree: [{ path: 'src/shop/cart.js', kind: 'edit', added: 3, removed: 1 }, { path: 'src/billing/hand.js', kind: 'create', added: 7, removed: 0, ts: '2026-10-09T12:59:00.000Z' }, { path: 'docs/gone.md', kind: 'delete', added: 0, removed: 4 }],
    commits: [], tagOf: new Map(), ownersOf, nowIso: '2026-10-09T13:00:00.000Z',
  });
  assert.equal(rows.length, 3);
  const hand = rows.find((r) => r.path === 'src/billing/hand.js');
  assert.deepEqual([hand.id, hand.sessionId ?? null, hand.state, hand.partId, hand.ts], ['wt:src/billing/hand.js', null, 'pending', 'billing', '2026-10-09T12:59:00.000Z']);
  assert.equal(rows.find((r) => r.path === 'docs/gone.md').ts, '2026-10-09T13:00:00.000Z', 'a removed file has no date on disk: it reads as now');
  assert.equal(rows.find((r) => r.id === 'e1').inFolder, true);
  const removed = changeRows({
    events: [ev({ kind: 'delete', path: 'docs/gone.md', added: 0, removed: 0 })],
    worktree: [{ path: 'docs/gone.md', kind: 'delete', added: 0, removed: 4 }],
    commits: [], tagOf: new Map(), ownersOf, nowIso: '2026-10-09T13:00:00.000Z',
  });
  assert.deepEqual([removed.length, removed[0].removed], [1, 4], 'a file removed from the command line takes its lines from the folder');
});

test('what changed in the last minutes, per part: distinct files and lines, for the boxes that light up', () => {
  const rows = changeRows({
    events: [
      ev({ id: 'a', ts: '2026-10-09T12:58:00.000Z' }),
      ev({ id: 'b', ts: '2026-10-09T12:59:00.000Z', added: 2, removed: 0 }),
      ev({ id: 'c', ts: '2026-10-09T12:57:00.000Z', path: 'src/billing/pay.js', added: 10, removed: 5 }),
      ev({ id: 'old', ts: '2026-10-09T10:00:00.000Z', path: 'src/billing/x.js' }),
      ev({ id: 'nobox', ts: '2026-10-09T12:59:30.000Z', path: 'README.md', added: 1, removed: 0 }),
    ],
    worktree: [], commits: [], tagOf: new Map(), ownersOf, nowIso: '2026-10-09T13:00:00.000Z',
  });
  const fresh = freshOf(rows, Date.parse('2026-10-09T13:00:00.000Z'));
  assert.deepEqual(fresh, { files: 3, lines: 22, parts: { shop: { files: 1, lines: 6 }, billing: { files: 1, lines: 15 } } });
  assert.equal(freshOf(rows, Date.parse('2026-10-10T13:00:00.000Z')), null, 'nothing recent, nothing lit');
});
