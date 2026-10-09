import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyPrefs, setNotifyPrefs } from '../server/alerts/prefs.mjs';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-notify-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('defaults: desktop and browser on, sound and the phone off, every project on', () => {
  assert.deepEqual(notifyPrefs({}), { browser: true, desktop: true, sound: false, ntfy: { enabled: false, topic: null }, perProject: {}, lang: null });
});

test('a hand-written file with wrong types falls back field by field', () => {
  const prefs = notifyPrefs({ notify: { desktop: 'yes', sound: true, ntfy: { enabled: true, topic: 'bad topic!' }, perProject: { 'shop-1': { finished: false, clash: 'no' }, x: 3 }, lang: 'pt-BR' } });
  assert.deepEqual(prefs, { browser: true, desktop: true, sound: true, ntfy: { enabled: false, topic: null }, perProject: { 'shop-1': { finished: false } }, lang: 'pt-BR' });
});

test('saving merges into config.json, keeps the other keys, and the phone gets a random topic of its own', () => withDir((dir) => {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 50 } }));
  const out = setNotifyPrefs(dir, { desktop: false, ntfy: { enabled: true }, perProject: { 'shop-1': { waiting: false } } });
  assert.equal(out.ok, true);
  assert.match(out.notify.ntfy.topic, /^sm-[0-9a-f]{24}$/);
  const saved = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  assert.equal(saved.budget.monthlyUSD, 50);
  assert.equal(saved.notify.desktop, false);
  assert.deepEqual(saved.notify.perProject, { 'shop-1': { waiting: false } });
  const again = setNotifyPrefs(dir, { ntfy: { enabled: false } });
  assert.equal(again.notify.ntfy.topic, out.notify.ntfy.topic, 'turning it off and on keeps the same topic');
  assert.equal(setNotifyPrefs(dir, { perProject: { 'shop-1': { finished: false } } }).notify.perProject['shop-1'].waiting, false, 'one project choice merges with the others');
}));

test('refusals: junk is 400, an unreadable config is left alone', () => withDir((dir) => {
  assert.equal(setNotifyPrefs(dir, null).error, 'bad-notify');
  assert.equal(setNotifyPrefs(dir, { desktop: 'x' }).error, 'bad-notify');
  assert.equal(setNotifyPrefs(dir, { lang: 'xx' }).error, 'bad-notify');
  assert.equal(setNotifyPrefs(dir, { perProject: { '../x': { finished: false } } }).error, 'bad-notify');
  writeFileSync(join(dir, 'config.json'), '{oops');
  assert.equal(setNotifyPrefs(dir, { desktop: true }).error, 'config-unreadable');
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), '{oops');
}));
