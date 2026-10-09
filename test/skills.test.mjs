import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSkills } from '../server/sources/skills.mjs';

function skill(base, name, fm) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${fm}\n---\nbody\n`);
}

function fixture() {
  const claude = mkdtempSync(join(tmpdir(), 'sm-sk-c-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-sk-r-'));
  skill(join(claude, 'skills'), 'u-skill', 'name: u-skill\ndescription: "User skill"');
  skill(join(root, '.claude', 'skills'), 'p-skill', 'name: p-skill\ndescription: >\n  Folded\n  text\nother: 1');
  const on = join(claude, 'plugins', 'cache', 'on');
  const off = join(claude, 'plugins', 'cache', 'off');
  skill(join(on, 'skills'), 'alpha', `name: alpha\ndescription: ${'x'.repeat(300)}`);
  skill(join(off, 'skills'), 'beta', 'name: beta\ndescription: Beta');
  mkdirSync(join(claude, 'plugins'), { recursive: true });
  writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'on-plugin@mk': [{ scope: 'user', installPath: on }], 'off-plugin@mk': [{ scope: 'user', installPath: off }],
  } }));
  return { claude, root, on, off };
}

const byName = (list) => Object.fromEntries(list.map((s) => [s.name, s]));
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

test('listSkills reads user, project and plugin skills from settings when pluginList is absent', () => {
  const { claude, root } = fixture();
  try {
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'on-plugin@mk': true, 'off-plugin@mk': true } }));
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'off-plugin@mk': false } }));
    const s = byName(listSkills(root, claude, {}));
    assert.deepEqual([s['u-skill'].origin, s['u-skill'].command, s['u-skill'].plugin, s['u-skill'].enabled], ['user', '/u-skill', null, true]);
    assert.equal(s['u-skill'].description, 'User skill');
    assert.equal(s['p-skill'].origin, 'project');
    assert.equal(s['p-skill'].description, 'Folded text');
    assert.equal(s.alpha.origin, 'plugin');
    assert.equal(s.alpha.plugin, 'on-plugin');
    assert.equal(s.alpha.command, '/on-plugin:alpha');
    assert.equal(s.alpha.enabled, true);
    assert.equal(s.alpha.description.length, 200);
    assert.equal(s.beta.enabled, false);
  } finally { cleanup(claude, root); }
});

test('listSkills uses pluginList from claude plugin list --json when given', () => {
  const { claude, root, on, off } = fixture();
  try {
    const pluginList = [
      { id: 'on-plugin@mk', scope: 'user', enabled: true, installPath: on },
      { id: 'off-plugin@mk', scope: 'user', enabled: false, installPath: off },
    ];
    const s = byName(listSkills(root, claude, { pluginList }));
    assert.equal(s.alpha.enabled, true);
    assert.equal(s.beta.enabled, false);
    assert.equal(s.beta.command, '/off-plugin:beta');
  } finally { cleanup(claude, root); }
});

test('listSkills is empty for a bare setup', () => {
  const claude = mkdtempSync(join(tmpdir(), 'sm-sk-c-'));
  try { assert.deepEqual(listSkills(claude, claude, {}), []); } finally { cleanup(claude); }
});
