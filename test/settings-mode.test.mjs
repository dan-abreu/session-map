import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setUserMode, undoUserMode, userModeState } from '../server/chat/mode.mjs';

function claudeFolder(text) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-settings-'));
  if (text !== undefined) writeFileSync(join(dir, 'settings.json'), text);
  return {
    dir,
    text: () => readFileSync(join(dir, 'settings.json'), 'utf8'),
    json: () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')),
    backup: join(dir, 'settings.json.session-map-bak'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const SETTINGS = {
  model: 'opus',
  permissions: { allow: ['Bash(git status)'], deny: ['Read(./.env)'], defaultMode: 'default' },
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.mjs' }] }] },
  enabledPlugins: { 'session-map@session-map': true },
};

test('the mode for every Claude on this PC goes into permissions.defaultMode; every other key stays as it was', () => {
  const original = `${JSON.stringify(SETTINGS, null, 4)}\n`;
  const f = claudeFolder(original);
  try {
    assert.deepEqual(setUserMode(f.dir, 'acceptEdits'), { ok: true, mode: 'acceptEdits', previous: 'default' });
    const after = f.json();
    assert.deepEqual(after, { ...SETTINGS, permissions: { ...SETTINGS.permissions, defaultMode: 'acceptEdits' } });
    assert.equal(f.text(), `${JSON.stringify(after, null, 4)}\n`, 'same indentation and final newline');
    assert.equal(readFileSync(f.backup, 'utf8'), original, 'a byte copy is kept before the first write');
  } finally { f.done(); }
});

test('only default, acceptEdits and auto are accepted; a bypass or anything else writes nothing', () => {
  const original = JSON.stringify(SETTINGS);
  const f = claudeFolder(original);
  try {
    for (const mode of ['bypassPermissions', 'plan', 'dontAsk', 'Auto', '', 42, null, undefined, { mode: 'auto' }]) {
      assert.deepEqual(setUserMode(f.dir, mode), { ok: false, error: 'bad-mode' }, String(mode));
    }
    assert.equal(f.text(), original);
    assert.equal(existsSync(f.backup), false);
  } finally { f.done(); }
});

test('settings with comments, broken JSON or odd shapes are refused and left untouched', () => {
  for (const text of ['{\n  // my notes\n  "model": "opus"\n}\n', '{"model": ', '[1, 2]', '"auto"', '{"permissions": "all"}', '{"permissions": ["x"]}']) {
    const f = claudeFolder(text);
    try {
      assert.deepEqual(setUserMode(f.dir, 'auto'), { ok: false, error: 'settings-unreadable' }, text);
      assert.equal(f.text(), text);
      assert.equal(existsSync(f.backup), false);
    } finally { f.done(); }
  }
});

test('undo puts back the value from before the first change, keeps what changed since, and drops the copy', () => {
  const f = claudeFolder(JSON.stringify(SETTINGS, null, 2));
  try {
    setUserMode(f.dir, 'auto');
    setUserMode(f.dir, 'acceptEdits');
    assert.equal(JSON.parse(readFileSync(f.backup, 'utf8')).permissions.defaultMode, 'default', 'the copy is of the settings before session-map touched them');
    writeFileSync(join(f.dir, 'settings.json'), JSON.stringify({ ...f.json(), theme: 'dark' }, null, 2));
    assert.deepEqual(userModeState(f.dir), { mode: 'acceptEdits', previous: 'default', undo: true });
    assert.deepEqual(undoUserMode(f.dir), { ok: true, mode: 'default' });
    assert.deepEqual(f.json(), { ...SETTINGS, theme: 'dark' });
    assert.equal(existsSync(f.backup), false);
    assert.deepEqual(undoUserMode(f.dir), { ok: false, error: 'nothing-to-undo' });
    assert.deepEqual(userModeState(f.dir), { mode: 'default', previous: null, undo: false });
  } finally { f.done(); }
});

test('with no settings file the mode is written alone, and undo leaves no mode behind', () => {
  const f = claudeFolder();
  try {
    assert.deepEqual(userModeState(f.dir), { mode: null, previous: null, undo: false });
    assert.deepEqual(setUserMode(f.dir, 'auto'), { ok: true, mode: 'auto', previous: null });
    assert.deepEqual(f.json(), { permissions: { defaultMode: 'auto' } });
    assert.deepEqual(undoUserMode(f.dir), { ok: true, mode: null });
    assert.deepEqual(f.json(), {});
  } finally { f.done(); }
});

test('undo refuses settings that became unreadable, and keeps the copy for later', () => {
  const f = claudeFolder(JSON.stringify(SETTINGS));
  try {
    setUserMode(f.dir, 'auto');
    writeFileSync(join(f.dir, 'settings.json'), '{ // broken\n');
    assert.deepEqual(undoUserMode(f.dir), { ok: false, error: 'settings-unreadable' });
    assert.equal(f.text(), '{ // broken\n');
    assert.equal(existsSync(f.backup), true);
  } finally { f.done(); }
});
