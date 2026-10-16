import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatSkillSettings, guardSettings } from '../server/chat/guard.mjs';
import { setUserPlugin } from '../server/chat/mode.mjs';
import { weekByPlugin } from '../server/sources/skill-use.mjs';

const skill = (name, description, extra = {}) => ({ name, description, origin: 'user', plugin: null, enabled: true, command: `/${name}`, ...extra });
const SKILLS = [
  skill('grilling', 'Grill the user about a plan or decision'),
  skill('brag-slim', 'Turn a project into a launch video'),
  skill('dataviz', 'Chart and graph colors', { origin: 'project' }),
  skill('brainstorming', 'Explore the design before building', { origin: 'plugin', plugin: 'superpowers', command: '/superpowers:brainstorming' }),
];
const plugin = (name, month, extra = {}) => ({ id: `${name}@m`, name, enabled: true, month: { count: month }, ...extra });

test('chatSkillSettings: every on user and project skill is on automatically — no call needed (id140)', () => {
  const s = chatSkillSettings({ skills: SKILLS, plugins: [], text: 'grill me about this plan' });
  assert.equal(s.skillOverrides.grilling, 'on');
  assert.equal(s.skillOverrides['brag-slim'], 'on', 'on means automatic, not picked');
  assert.equal(s.skillOverrides.dataviz, 'on');
  assert.equal(s.skillOverrides.brainstorming, undefined, 'a plugin skill is not a user skill');
});

test('chatSkillSettings: even with nothing fitting, the on skills still run', () => {
  const s = chatSkillSettings({ skills: SKILLS, plugins: [], text: 'zzz' });
  assert.deepEqual(Object.values(s.skillOverrides), ['on', 'on', 'on']);
});

test('chatSkillSettings: the owner\'s switch is the only thing that turns a plugin off', () => {
  const plugins = [
    plugin('unused', 0), plugin('used', 2), plugin('session-map', 0), plugin('named-one', 0), plugin('superpowers', 0),
    plugin('already-off', 0, { enabled: false }),
  ];
  const s = chatSkillSettings({ skills: SKILLS, plugins, text: 'use named-one and brainstorming for the design' });
  assert.deepEqual(s.enabledPlugins, {}, 'the engine no longer guesses; the switch decides');
});

test('chatSkillSettings: no plugin data means no plugin is turned off', () => {
  assert.deepEqual(chatSkillSettings({ skills: SKILLS, plugins: [{ id: 'x@m', name: 'x', enabled: true }], text: '' }).enabledPlugins, {});
});

test('guardSettings carries the focus next to the guard, and stays as before without it', () => {
  const focus = chatSkillSettings({ skills: SKILLS, plugins: [plugin('unused', 0)], text: 'grill me about this plan' });
  const s = JSON.parse(guardSettings({ snapshot: false, focus }));
  assert.equal(s.skillOverrides.grilling, 'on');
  assert.equal(s.enabledPlugins, undefined, 'nothing to disable: the key stays out');
  assert.ok(s.hooks.PreToolUse);
  const plain = JSON.parse(guardSettings({ snapshot: false }));
  assert.equal(plain.skillOverrides, undefined);
  assert.equal(plain.enabledPlugins, undefined);
});

test('the plugin switch asks the server with a POST of the id and the new state', async () => {
  const { api } = await import('../server/web/api.js');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, init) => { seen.push([path, init.method, init.headers['x-session-map'], JSON.parse(init.body)]); return { status: 200, ok: true, json: async () => ({ ok: true }) }; };
  try {
    assert.equal((await api.setPlugin('a@m', false)).ok, true);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(seen, [['/api/settings/plugin', 'POST', '1', { id: 'a@m', enabled: false }]]);
});

test('weekByPlugin counts a longer window when asked', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const calls = [{ name: 'a:x', ts: '2026-10-01T00:00:00Z' }, { name: 'a:x', ts: '2026-10-12T00:00:00Z' }];
  assert.equal(weekByPlugin(calls, new Map(), now).get('a').count, 1);
  assert.equal(weekByPlugin(calls, new Map(), now, 30 * 24 * 3600 * 1000).get('a').count, 2);
});

test('setUserPlugin writes only enabledPlugins and keeps every other key and the layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-plug-'));
  try {
    const original = '{\n    "model": "opus",\n    "enabledPlugins": {\n        "a@m": true,\n        "b@m": true\n    },\n    "hooks": {"x": 1}\n}\n';
    writeFileSync(join(dir, 'settings.json'), original);
    assert.deepEqual(setUserPlugin(dir, 'a@m', false), { ok: true, id: 'a@m', enabled: false });
    const data = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.deepEqual(data, { model: 'opus', enabledPlugins: { 'a@m': false, 'b@m': true }, hooks: { x: 1 } });
    assert.match(readFileSync(join(dir, 'settings.json'), 'utf8'), /^\{\n {4}"model"/);
    assert.equal(setUserPlugin(dir, '', true).error, 'bad-plugin');
    assert.equal(setUserPlugin(dir, 'a@m', 'yes').error, 'bad-plugin');
    writeFileSync(join(dir, 'settings.json'), '{ // comment\n}');
    assert.equal(setUserPlugin(dir, 'a@m', true).error, 'settings-unreadable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
