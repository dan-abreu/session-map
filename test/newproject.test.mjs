import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createdRoots, createProject, githubStatus, nameError, newProject, repoNameOf, suggestParent } from '../server/newproject.mjs';
import { normalizePath } from '../server/paths.mjs';

function dirs() {
  return [mkdtempSync(join(tmpdir(), 'sm-new-p-')), mkdtempSync(join(tmpdir(), 'sm-new-s-'))];
}
const clean = (...ds) => { for (const d of ds) rmSync(d, { recursive: true, force: true }); };
const config = (sm) => JSON.parse(readFileSync(join(sm, 'config.json'), 'utf8'));

test('createProject makes the folder and remembers it in config.json', () => {
  const [parent, sm] = dirs();
  try {
    const out = createProject(sm, { parent, name: '  Meu Projeto  ' }, { now: new Date('2026-10-11T12:00:00Z') });
    assert.equal(out.ok, true);
    assert.equal(out.root, join(parent, 'Meu Projeto'));
    assert.ok(statSync(out.root).isDirectory());
    const entry = config(sm).projects[normalizePath(out.root)];
    assert.deepEqual(entry, { created: { at: '2026-10-11T12:00:00.000Z', root: out.root } });
    assert.deepEqual(createdRoots(config(sm)), [out.root]);
  } finally { clean(parent, sm); }
});

test('createProject keeps what config.json already holds', () => {
  const [parent, sm] = dirs();
  try {
    writeFileSync(join(sm, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 9 }, projects: { 'c:/x': { tidy: true } } }));
    const out = createProject(sm, { parent, name: 'novo' });
    assert.equal(out.ok, true);
    const cfg = config(sm);
    assert.deepEqual(cfg.budget, { monthlyUSD: 9 });
    assert.deepEqual(cfg.projects['c:/x'], { tidy: true });
  } finally { clean(parent, sm); }
});

test('createProject never writes over a folder that exists', () => {
  const [parent, sm] = dirs();
  try {
    mkdirSync(join(parent, 'ja-existe'));
    assert.deepEqual(createProject(sm, { parent, name: 'ja-existe' }), { ok: false, error: 'folder-exists' });
  } finally { clean(parent, sm); }
});

test('createProject refuses a place that is not a folder on this computer', () => {
  const [parent, sm] = dirs();
  try {
    assert.equal(createProject(sm, { parent: join(parent, 'nao-ha'), name: 'a' }).error, 'bad-parent');
    assert.equal(createProject(sm, { parent: 'relativo/pasta', name: 'a' }).error, 'bad-parent');
    assert.equal(createProject(sm, { parent: 42, name: 'a' }).error, 'bad-parent');
    writeFileSync(join(parent, 'arquivo.txt'), 'x');
    assert.equal(createProject(sm, { parent: join(parent, 'arquivo.txt'), name: 'a' }).error, 'bad-parent');
  } finally { clean(parent, sm); }
});

test('nameError accepts a plain folder name and refuses paths and names Windows cannot hold', () => {
  for (const ok of ['site', 'Meu Projeto', 'app-2026', 'loja_da_maria', 'açaí']) assert.equal(nameError(ok), null, ok);
  for (const bad of ['COM¹', 'lpt³', '', '   ', '.', '..', 'a/b', 'a\\b', '../fora', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'fim.', 'CON', 'nul', 'com1', 'LPT9.txt', 'a\u0001b', 'x'.repeat(81), 42, null]) {
    assert.equal(nameError(bad), 'bad-name', String(bad));
  }
});

test('createProject never writes over a config.json whose projects it cannot read', () => {
  const [parent, sm] = dirs();
  try {
    writeFileSync(join(sm, 'config.json'), JSON.stringify({ projects: [{ important: 'data' }] }));
    assert.deepEqual(createProject(sm, { parent, name: 'novo' }), { ok: false, error: 'config-unreadable' });
    assert.deepEqual(config(sm), { projects: [{ important: 'data' }] });
    assert.throws(() => statSync(join(parent, 'novo')));
  } finally { clean(parent, sm); }
});

test('createProject takes the folder back when config.json cannot be written', () => {
  const [parent, sm] = dirs();
  try {
    // A folder where writeAtomic puts its temporary file: the write fails after the project folder was made.
    mkdirSync(join(sm, `config.json.${process.pid}.tmp`));
    assert.deepEqual(createProject(sm, { parent, name: 'novo' }), { ok: false, error: 'config-unreadable' });
    assert.throws(() => statSync(join(parent, 'novo')));
  } finally { clean(parent, sm); }
});

test('createProject refuses a bad name before touching the disk', () => {
  const [parent, sm] = dirs();
  try {
    assert.deepEqual(createProject(sm, { parent, name: '../fora' }), { ok: false, error: 'bad-name' });
    assert.throws(() => statSync(join(sm, 'config.json')));
  } finally { clean(parent, sm); }
});

test('suggestParent picks the folder most projects live in, or the home folder', () => {
  const dev = join(tmpdir(), 'dev');
  assert.equal(suggestParent([join(dev, 'a'), join(dev, 'b'), join(tmpdir(), 'x', 'c')], { home: 'casa' }), dev);
  assert.equal(suggestParent([], { home: 'casa' }), 'casa');
});

test('createdRoots lists only the folders session-map created', () => {
  assert.deepEqual(createdRoots({ projects: { a: { tidy: true }, b: { created: { root: 'C:\\dev\\b', at: 'x' } }, c: { created: 'bad' } } }), ['C:\\dev\\b']);
  assert.deepEqual(createdRoots(null), []);
});

// ---- GitHub (sv15): a fake exec answers as gh and git would; nothing reaches GitHub ----

function fakeExec({ login = 'ana', loggedIn = true, taken = [], fail = null, offline = false } = {}) {
  const calls = [];
  const exec = async (file, args, opts = {}) => {
    calls.push({ file, args, cwd: opts.cwd });
    const cmd = `${file} ${args.join(' ')}`;
    if (fail && cmd.startsWith(fail)) return { code: 1, stdout: '', stderr: 'boom' };
    if (cmd === 'gh api user --jq .login') return loggedIn ? { code: 0, stdout: `${login}\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'not logged in' };
    if (file === 'gh' && args[0] === 'repo' && args[1] === 'view') return taken.includes(args[2]) ? { code: 0, stdout: '{}', stderr: '' } : { code: 1, stdout: '', stderr: offline ? 'error connecting to api.github.com' : 'GraphQL: Could not resolve to a Repository with the name' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

test('repoNameOf turns a folder name into a GitHub repository name', () => {
  assert.equal(repoNameOf('Meu Projeto'), 'Meu-Projeto');
  assert.equal(repoNameOf('Açaí da Maria'), 'Acai-da-Maria');
  assert.equal(repoNameOf('loja_2026.v2'), 'loja_2026.v2');
  assert.equal(repoNameOf('  --!!--  '), null);
});

test('githubStatus says who is logged in, or that gh is not ready', async () => {
  assert.deepEqual(await githubStatus({ exec: fakeExec().exec, fresh: true }), { ready: true, user: 'ana' });
  assert.deepEqual(await githubStatus({ exec: fakeExec({ loggedIn: false }).exec, fresh: true }), { ready: false, user: null });
  assert.deepEqual(await githubStatus({ exec: async () => ({ code: null, stdout: '', stderr: '' }), fresh: true }), { ready: false, user: null });
});

test('only on the computer: newProject never calls gh nor git', async () => {
  const [parent, sm] = dirs();
  try {
    const { exec, calls } = fakeExec();
    const out = await newProject(sm, { parent, name: 'local' }, { exec });
    assert.equal(out.ok, true);
    assert.equal(out.github, undefined);
    assert.deepEqual(calls, []);
  } finally { clean(parent, sm); }
});

test('also on GitHub: a private repository with a README and a first save, pushed', async () => {
  const [parent, sm] = dirs();
  try {
    const { exec, calls } = fakeExec();
    const out = await newProject(sm, { parent, name: 'Meu Site', github: 'private' }, { exec, fresh: true });
    assert.equal(out.ok, true);
    assert.deepEqual(out.github, { ok: true, url: 'https://github.com/ana/Meu-Site', private: true });
    assert.equal(readFileSync(join(out.root, 'README.md'), 'utf8'), '# Meu Site\n');
    const cmds = calls.map((c) => `${c.file} ${c.args.join(' ')}`);
    assert.deepEqual(cmds, [
      'gh api user --jq .login',
      'gh repo view ana/Meu-Site --json name',
      'git init -b main',
      'git add README.md',
      'git commit -m Primeiro commit',
      'gh repo create ana/Meu-Site --private --source . --remote origin --push',
    ]);
    for (const c of calls.slice(2)) assert.equal(c.cwd, out.root);
  } finally { clean(parent, sm); }
});

test('public only when asked', async () => {
  const [parent, sm] = dirs();
  try {
    const { exec, calls } = fakeExec();
    const out = await newProject(sm, { parent, name: 'aberto', github: 'public' }, { exec, fresh: true });
    assert.equal(out.github.private, false);
    assert.ok(calls.at(-1).args.includes('--public'));
  } finally { clean(parent, sm); }
});

test('GitHub is checked before the folder is made: not logged in, or the name taken', async () => {
  const [parent, sm] = dirs();
  try {
    assert.deepEqual(await newProject(sm, { parent, name: 'x', github: 'private' }, { exec: fakeExec({ loggedIn: false }).exec, fresh: true }), { ok: false, error: 'github-not-ready' });
    assert.deepEqual(await newProject(sm, { parent, name: 'x', github: 'private' }, { exec: fakeExec({ taken: ['ana/x'] }).exec, fresh: true }), { ok: false, error: 'repo-exists' });
    assert.deepEqual(await newProject(sm, { parent, name: 'x', github: 'yes' }, { exec: fakeExec().exec, fresh: true }), { ok: false, error: 'bad-github' });
    assert.deepEqual(await newProject(sm, { parent, name: '¿¿', github: 'private' }, { exec: fakeExec().exec, fresh: true }), { ok: false, error: 'bad-repo-name' });
    assert.deepEqual(await newProject(sm, { parent, name: 'x', github: 'private', githubUser: 'bob' }, { exec: fakeExec().exec, fresh: true }), { ok: false, error: 'github-user-changed' });
    const offline = await newProject(sm, { parent, name: 'x', github: 'private' }, { exec: fakeExec({ offline: true }).exec, fresh: true });
    assert.equal(offline.error, 'github-unreachable');
    assert.throws(() => statSync(join(parent, 'x')));
  } finally { clean(parent, sm); }
});

test('a GitHub step that fails keeps the folder and says which step', async () => {
  const [parent, sm] = dirs();
  try {
    const out = await newProject(sm, { parent, name: 'meio', github: 'private' }, { exec: fakeExec({ fail: 'gh repo create' }).exec, fresh: true });
    assert.equal(out.ok, true);
    assert.ok(statSync(out.root).isDirectory());
    assert.deepEqual(out.github, { ok: false, error: 'github-failed', detail: 'boom' });
    const commit = await newProject(sm, { parent, name: 'meio2', github: 'private' }, { exec: fakeExec({ fail: 'git commit' }).exec, fresh: true });
    assert.deepEqual(commit.github, { ok: false, error: 'git-failed', detail: 'boom' });
  } finally { clean(parent, sm); }
});
