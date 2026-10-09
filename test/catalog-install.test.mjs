import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../server/actions.mjs';

const CLAUDE = 'C:/tools/claude.exe';

const item = (repo, hasMarketplace = true) => ({ repo, name: repo.split('/')[1], owner: repo.split('/')[0], stars: 1, hasMarketplace, type: 'marketplace', category: 'other' });

// The fake `claude`: "marketplace add" writes what the real one leaves on disk, "install" just succeeds.
function fixture({ plugins = ['audit'], addFails = false, preKnown = false, listed = [item('trail/skills'), item('plain/skill-only', false)] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-ins-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-ins-sm-'));
  writeFileSync(join(smDir, 'catalog.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), items: listed }));
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  const location = join(dir, 'plugins', 'marketplaces', 'trail');
  const register = () => {
    mkdirSync(join(location, '.claude-plugin'), { recursive: true });
    writeFileSync(join(location, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'trail', plugins: plugins.map((name) => ({ name })) }));
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ trail: { source: { source: 'github', repo: 'trail/skills' }, installLocation: location } }));
  };
  if (preKnown) register();
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, cwd: opts?.cwd });
    if (args[2] === 'add') {
      if (addFails) return { code: 1, stdout: '', stderr: 'fatal: could not read from remote' };
      register();
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const state = { projects: [{ id: 'shop-abc123', name: 'shop', root: '/work/shop' }] };
  const deps = { state, dir, smDir, exec, bin: CLAUDE };
  const log = () => readFileSync(join(smDir, 'actions.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { deps, calls, log, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); } };
}

test('install adds the marketplace and installs its only plugin, with the arguments as an array and nothing else', async () => {
  const f = fixture();
  try {
    const res = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, f.deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.installed, 'audit@trail');
    assert.deepEqual(f.calls.map((c) => [c.file, ...c.args]), [
      [CLAUDE, 'plugin', 'marketplace', 'add', 'trail/skills', '--scope', 'user'],
      [CLAUDE, 'plugin', 'install', 'audit@trail', '--scope', 'user'],
    ]);
    assert.deepEqual(f.log().map((l) => [l.action, l.repo, l.scope, l.status]), [['install', 'trail/skills', 'user', 200]]);
  } finally { f.cleanup(); }
});

test('repository names are matched case-insensitively against the cache', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'install', repo: 'Trail/Skills', scope: 'user' }, f.deps)).status, 200);
  } finally { f.cleanup(); }
});

test('project scope runs in that project folder and needs a project the server knows', async () => {
  const f = fixture();
  try {
    const res = await runAction({ action: 'install', repo: 'trail/skills', scope: 'project', projectId: 'shop-abc123' }, f.deps);
    assert.equal(res.status, 200);
    assert.deepEqual(f.calls.map((c) => [c.cwd, c.args.at(-1)]), [['/work/shop', 'project'], ['/work/shop', 'project']]);
    f.calls.length = 0;
    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'project', projectId: 'nope' }, f.deps)).status, 404);
    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'project' }, f.deps)).status, 400);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test('nothing runs for a repository outside the cache, a malformed name, a bad scope or one without a marketplace', async () => {
  const f = fixture();
  try {
    const cases = [
      [{ repo: 'evil/not-listed', scope: 'user' }, 404],
      [{ repo: '--help/x', scope: 'user' }, 400],
      [{ repo: '../x', scope: 'user' }, 400],
      [{ repo: 'a b/c', scope: 'user' }, 400],
      [{ repo: 'trail/skills;calc', scope: 'user' }, 400],
      [{ repo: 42, scope: 'user' }, 400],
      [{ repo: 'trail/skills', scope: 'local' }, 400],
      [{ repo: 'trail/skills' }, 400],
      [{ repo: 'plain/skill-only', scope: 'user' }, 409],
    ];
    for (const [body, status] of cases) assert.equal((await runAction({ action: 'install', ...body }, f.deps)).status, status, JSON.stringify(body));
    assert.equal(f.calls.length, 0);
    assert.equal(f.log().length, cases.length, 'every refusal is logged too');
  } finally { f.cleanup(); }
});

test('with no cache at all nothing can be installed', async () => {
  const f = fixture({ listed: [] });
  try {
    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, f.deps)).status, 404);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test('a marketplace with several plugins asks which one; the answer must be one of them', async () => {
  const f = fixture({ plugins: ['audit', 'review'] });
  try {
    const ask = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, f.deps);
    assert.equal(ask.status, 409);
    assert.equal(ask.body.error, 'choose-plugin');
    assert.deepEqual(ask.body.plugins, ['audit', 'review']);
    assert.equal(f.calls.some((c) => c.args[1] === 'install'), false);

    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'user', plugin: 'evil' }, f.deps)).status, 400);
    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'user', plugin: '--yes' }, f.deps)).status, 400);
    assert.equal(f.calls.some((c) => c.args[1] === 'install'), false);

    const ok = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user', plugin: 'review' }, f.deps);
    assert.equal(ok.status, 200);
    assert.deepEqual(f.calls.at(-1).args, ['plugin', 'install', 'review@trail', '--scope', 'user']);
  } finally { f.cleanup(); }
});

test('when adding the marketplace fails the plugin is not installed; an already-known marketplace is fine', async () => {
  const failing = fixture({ addFails: true });
  try {
    const res = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, failing.deps);
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'add-failed');
    assert.equal(failing.calls.length, 1);
  } finally { failing.cleanup(); }
  const known = fixture({ addFails: true, preKnown: true });
  try {
    assert.equal((await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, known.deps)).status, 200);
    assert.equal(known.calls.length, 2);
  } finally { known.cleanup(); }
});

test('a failing install reports it', async () => {
  const f = fixture();
  try {
    const exec = async (file, args) => (args[1] === 'install' ? { code: 1, stdout: '', stderr: 'plugin not found' } : f.deps.exec(file, args));
    const res = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, { ...f.deps, exec });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'install-failed');
  } finally { f.cleanup(); }
});

test('without a claude binary it says so; a script binary runs under node', async () => {
  const f = fixture();
  try {
    const none = await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, { ...f.deps, bin: null });
    assert.equal(none.status, 409);
    assert.equal(none.body.error, 'no-claude');
    assert.equal(f.calls.length, 0);
    await runAction({ action: 'install', repo: 'trail/skills', scope: 'user' }, { ...f.deps, bin: 'C:/npm/claude-code/cli.js' });
    assert.deepEqual([f.calls[0].file, f.calls[0].args[0]], [process.execPath, 'C:/npm/claude-code/cli.js']);
  } finally { f.cleanup(); }
});
