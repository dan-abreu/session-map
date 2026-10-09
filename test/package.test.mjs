import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLinks, privateAddresses } from '../scripts/links.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function frontmatter(path) {
  const m = read(path).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${path} has frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

test('plugin manifest names the plugin and its license', () => {
  const m = json('.claude-plugin/plugin.json');
  assert.equal(m.name, 'session-map');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.license, 'MIT');
  assert.ok(m.description);
});

test('marketplace lists the plugin from the repository root', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'session-map');
  assert.ok(m.owner.name);
  assert.deepEqual(m.plugins.map((p) => [p.name, p.source]), [['session-map', './']]);
});

for (const name of ['map', 'board', 'history']) {
  test(`skill ${name} has matching name and a "Use when" description`, () => {
    const fm = frontmatter(`skills/${name}/SKILL.md`);
    assert.equal(fm.name, name);
    assert.match(fm.description, /^Use when/);
    assert.ok(fm.description.length <= 500);
  });
}

test('board skill documents every card field the parser reads', () => {
  const body = read('skills/board/SKILL.md');
  for (const f of ['title', 'area', 'front', 'milestone', 'doing', 'todo', 'waiting', 'decided', 'estimateUSD']) {
    assert.ok(body.includes(`"${f}"`), f);
  }
  assert.ok(body.includes('```session-map'));
});

test('history skill runs the search script and map skill the server', () => {
  assert.ok(read('skills/history/SKILL.md').includes('${CLAUDE_PLUGIN_ROOT}/scripts/history-search.mjs'));
  const map = read('skills/map/SKILL.md');
  assert.ok(map.includes('${CLAUDE_PLUGIN_ROOT}/server/main.mjs'));
  assert.ok(map.includes('--lan'));
});

test('CI runs the suite on both systems and both Node versions', () => {
  const ci = read('.github/workflows/test.yml');
  for (const s of ['ubuntu-latest', 'windows-latest', '20', '24', 'node --test test/*.test.mjs', 'shell: bash']) assert.ok(ci.includes(s), s);
});

test('both READMEs teach install, with the same section count', () => {
  for (const f of ['README.md', 'README.pt-BR.md']) {
    const t = read(f);
    assert.ok(t.includes('/plugin marketplace add dan-abreu/session-map'));
    assert.ok(t.includes('/plugin install session-map@session-map'));
    assert.ok(t.includes('/session-map:map'));
  }
  const count = (f) => (read(f).match(/^## /gm) ?? []).length;
  assert.equal(count('README.md'), count('README.pt-BR.md'));
  assert.ok(existsSync(join(root, 'CHANGELOG.md')));
});

test('privateAddresses keeps only private IPv4, Tailscale range included', () => {
  const nic = (address, family = 'IPv4', internal = false) => ({ address, family, internal });
  const got = privateAddresses({
    eth: [nic('192.168.1.20'), nic('fe80::1', 'IPv6'), nic('8.8.8.8')],
    lo: [nic('127.0.0.1', 'IPv4', true)],
    ts: [nic('100.101.2.3'), nic('172.20.0.5'), nic('172.32.0.5'), nic('10.0.0.7')],
  });
  assert.deepEqual(got, ['192.168.1.20', '100.101.2.3', '172.20.0.5', '10.0.0.7']);
});

test('buildLinks carries the token, and --local drops the network links', () => {
  const addrs = ['192.168.1.20'];
  assert.deepEqual(buildLinks({ token: 'abc', port: 4001, addresses: addrs }), {
    local: 'http://127.0.0.1:4001/?k=abc',
    lan: ['http://192.168.1.20:4001/?k=abc'],
  });
  assert.deepEqual(buildLinks({ token: 'abc', port: 4001, addresses: addrs, local: true }).lan, []);
});

test('links script exits non-zero when no server answers', () => {
  assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts/links.mjs'), '--port', '1'], { stdio: 'pipe' }));
});

test('both READMEs say the AI is on by default, how to turn it off, what it needs and how to configure it', () => {
  for (const f of ['README.md', 'README.pt-BR.md']) {
    const t = read(f);
    for (const s of ['"ai": { "enabled": false }', '~/.claude/session-map/config.json', 'Node.js 20', 'monthlyUSD', '"currency"', '"roadmap"', 'autoFetchMinutes', 'maxCallsPerHour', 'bootstrapLimit', 'gh auth token', 'GITHUB_TOKEN']) {
      assert.ok(t.includes(s), `${f}: ${s}`);
    }
  }
});

test('package.json exposes the session-map command and the test script finds the files', () => {
  const pkg = json('package.json');
  assert.deepEqual(pkg.bin, { 'session-map': 'server/cli.mjs' });
  assert.ok(existsSync(join(root, pkg.bin['session-map'])));
  assert.match(read(pkg.bin['session-map']), /^#!\/usr\/bin\/env node\n/);
  assert.equal(pkg.scripts.test, 'node --test "test/*.test.mjs"');
});
