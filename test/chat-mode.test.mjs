import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickMode, settingsMode } from '../server/chat/mode.mjs';

function folders() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-mode-dir-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-mode-root-'));
  mkdirSync(join(root, '.claude'));
  const put = (file, mode) => writeFileSync(file, JSON.stringify(mode === undefined ? { model: 'haiku' } : { permissions: { defaultMode: mode } }));
  return {
    dir, root,
    user: (mode) => put(join(dir, 'settings.json'), mode),
    project: (mode) => put(join(root, '.claude', 'settings.json'), mode),
    local: (mode) => put(join(root, '.claude', 'settings.local.json'), mode),
    done: () => { rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); },
  };
}

test('settingsMode: no setting anywhere is Claude\'s own default', () => {
  const f = folders();
  try {
    assert.deepEqual(settingsMode(f.root, f.dir), { mode: 'default', downgraded: false });
    f.user();
    assert.deepEqual(settingsMode(f.root, f.dir), { mode: 'default', downgraded: false });
  } finally { f.done(); }
});

test('settingsMode: user, then project, then local; the more specific file wins, as in Claude', () => {
  const f = folders();
  try {
    f.user('auto');
    assert.equal(settingsMode(f.root, f.dir).mode, 'auto');
    f.project('acceptEdits');
    assert.equal(settingsMode(f.root, f.dir).mode, 'acceptEdits');
    f.local('plan');
    assert.equal(settingsMode(f.root, f.dir).mode, 'plan');
  } finally { f.done(); }
});

test('settingsMode: an unknown value is skipped and the next file down decides', () => {
  const f = folders();
  try {
    f.user('dontAsk');
    f.local('whatever');
    assert.deepEqual(settingsMode(f.root, f.dir), { mode: 'dontAsk', downgraded: false });
  } finally { f.done(); }
});

test('settingsMode: bypassPermissions never reaches the chat; it becomes auto and says so', () => {
  const f = folders();
  try {
    f.user('bypassPermissions');
    assert.deepEqual(settingsMode(f.root, f.dir), { mode: 'auto', downgraded: true });
    f.project('acceptEdits');
    assert.deepEqual(settingsMode(f.root, f.dir), { mode: 'acceptEdits', downgraded: false });
  } finally { f.done(); }
});

test('pickMode: "settings" or nothing follows the settings; a listed mode stands; bypass and junk are refused', () => {
  const fromSettings = { mode: 'auto', downgraded: false };
  assert.equal(pickMode(undefined, fromSettings), 'auto');
  assert.equal(pickMode('settings', fromSettings), 'auto');
  for (const mode of ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']) assert.equal(pickMode(mode, fromSettings), mode);
  assert.equal(pickMode('bypassPermissions', fromSettings), null);
  assert.equal(pickMode('rm -rf', fromSettings), null);
  assert.equal(pickMode(42, fromSettings), null);
});
