import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOpenSpec } from '../server/sources/openspec.mjs';

function change(root, name, md) {
  const dir = join(root, 'openspec', 'changes', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tasks.md'), md);
}

test('readOpenSpec counts done and open tasks, lists the first 8 open, ignores archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  try {
    const open = Array.from({ length: 10 }, (_, i) => `- [ ] open ${i + 1}`).join('\n');
    change(root, 'add-thing', `# Tasks\n- [x] one\n- [X] two\n${open}\n`);
    change(root, 'archive/old', '- [ ] stale\n');
    const out = readOpenSpec(root);
    assert.equal(out.length, 1);
    assert.equal(out[0].change, 'add-thing');
    assert.equal(out[0].done, 2);
    assert.equal(out[0].total, 12);
    assert.equal(out[0].todo.length, 8);
    assert.equal(out[0].todo[0], 'open 1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readOpenSpec returns [] without an openspec folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  try { assert.deepEqual(readOpenSpec(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

// The same kind of open work, kept by other spec-driven tools in their own markdown task files.
const SPEC_TOOLS = join(import.meta.dirname, 'fixtures', 'spec-tools');

test('readOpenSpec names OpenSpec on its changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  try {
    change(root, 'add-thing', '- [ ] one\n');
    assert.equal(readOpenSpec(root)[0].tool, 'OpenSpec');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readOpenSpec reads Spec Kit specs/<feature>/tasks.md and skips a feature with no task file', () => {
  const out = readOpenSpec(join(SPEC_TOOLS, 'speckit'));
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, 'Spec Kit');
  assert.equal(out[0].change, '001-photo-albums');
  assert.equal(out[0].done, 2);
  assert.equal(out[0].total, 6);
  assert.equal(out[0].todo[0], 'T003 [US1] Write the failing test for creating an album');
  assert.equal(out[0].todo.length, 4);
});

test('readOpenSpec reads Kiro .kiro/specs/<feature>/tasks.md, counting in-progress and optional tasks as open', () => {
  const out = readOpenSpec(join(SPEC_TOOLS, 'kiro'));
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, 'Kiro');
  assert.equal(out[0].change, 'user-login');
  assert.equal(out[0].done, 2);
  assert.equal(out[0].total, 7);
  assert.deepEqual(out[0].todo, [
    '2. Build the sign-in form', '2.2 Connect the form to the server', '3. Handle wrong passwords',
    '3.1 Show a clear message', '3.2 Write extra tests for the message',
  ]);
});

test('readOpenSpec reads Agent OS agent-os/specs/<spec>/tasks.md', () => {
  const out = readOpenSpec(join(SPEC_TOOLS, 'agentos'));
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, 'Agent OS');
  assert.equal(out[0].change, '2026-02-10-checkout');
  assert.equal(out[0].done, 3);
  assert.equal(out[0].total, 6);
});

test('readOpenSpec returns every tool in one project, same shape, OpenSpec first', () => {
  const out = readOpenSpec(join(SPEC_TOOLS, 'all'));
  assert.deepEqual(out.map((o) => [o.tool, o.change]), [['OpenSpec', 'add-search'], ['Spec Kit', '003-export'], ['Kiro', 'export-csv']]);
  for (const o of out) assert.deepEqual(Object.keys(o).sort(), ['change', 'done', 'todo', 'tool', 'total']);
});

test('readOpenSpec ignores loose files, sorts features by name, and skips archive only under OpenSpec', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-os-'));
  const feature = (parts, name) => {
    mkdirSync(join(root, ...parts, name), { recursive: true });
    writeFileSync(join(root, ...parts, name, 'tasks.md'), '- [ ] one\n');
  };
  try {
    // A plain file straight under specs/ and .kiro/specs/ is not a feature.
    mkdirSync(join(root, 'specs'), { recursive: true });
    mkdirSync(join(root, '.kiro', 'specs'), { recursive: true });
    writeFileSync(join(root, 'specs', 'tasks.md'), '- [ ] not a feature\n');
    writeFileSync(join(root, '.kiro', 'specs', 'tasks.md'), '- [ ] not a feature\n');
    // Created in reverse order: b first, then a.
    feature(['specs'], 'b');
    feature(['specs'], 'a');
    feature(['specs'], 'archive');
    feature(['openspec', 'changes'], 'archive');
    feature(['openspec', 'changes'], 'live');
    assert.deepEqual(readOpenSpec(root).map((o) => [o.tool, o.change]), [['OpenSpec', 'live'], ['Spec Kit', 'a'], ['Spec Kit', 'archive'], ['Spec Kit', 'b']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
