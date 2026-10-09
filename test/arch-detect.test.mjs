import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectArch, readArch } from '../server/arch/detect.mjs';

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'sm-arch-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true });
const noGit = async () => '';

test('the configured folder wins over the default names', async () => {
  const root = repo({ 'docs/arquitetura/README.md': '# a', 'minha/pasta/README.md': '# b', 'minha/pasta/parte.md': '# Parte' });
  try {
    const d = await detectArch(root, { architecture: 'minha/pasta' }, { exec: noGit });
    assert.deepEqual([d.source, d.dir, Object.keys(d.files).sort()], ['worktree', 'minha/pasta', ['README.md', 'parte.md']]);
  } finally { cleanup(root); }
});

test('without config it takes the first default folder that exists, in order', async () => {
  const root = repo({ 'docs/architecture/README.md': '# a', 'docs/arch/README.md': '# b' });
  try {
    assert.equal((await detectArch(root, {}, { exec: noGit })).dir, 'docs/architecture');
  } finally { cleanup(root); }
});

test('only markdown files directly in the folder are read', async () => {
  const root = repo({ 'docs/arch/README.md': '# a', 'docs/arch/img/x.md': '# nope', 'docs/arch/notes.txt': 'nope', 'docs/arch/a.md': '# A' });
  try {
    assert.deepEqual(Object.keys((await detectArch(root, {}, { exec: noGit })).files).sort(), ['README.md', 'a.md']);
  } finally { cleanup(root); }
});

test('a config path that leaves the project is ignored', async () => {
  const root = repo({ 'docs/arch/README.md': '# a' });
  try {
    for (const bad of ['../outside', '/etc', 'C:/Windows', 'docs/../../x']) {
      assert.equal((await detectArch(root, { architecture: bad }, { exec: noGit })).dir, 'docs/arch');
    }
  } finally { cleanup(root); }
});

test('when the work tree has none, it reads the main branch through git show', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  const calls = [];
  const exec = async (cwd, args) => {
    calls.push(args.join(' '));
    const a = args.join(' ');
    if (a === 'rev-parse --verify --quiet refs/heads/main') return 'abc\n';
    if (a === 'ls-tree -z --name-only main:docs/arquitetura') return 'README.md\0vitrine.md\0img\0';
    if (a === 'show main:docs/arquitetura/README.md') return '# Partes\n';
    if (a === 'show main:docs/arquitetura/vitrine.md') return '# Vitrine\n';
    return '';
  };
  try {
    const d = await detectArch(root, {}, { exec });
    assert.deepEqual([d.source, d.dir, d.files], ['main-branch', 'docs/arquitetura', { 'README.md': '# Partes\n', 'vitrine.md': '# Vitrine\n' }]);
  } finally { cleanup(root); }
});

test('the work tree is preferred over the main branch', async () => {
  const root = repo({ 'docs/arch/README.md': '# local' });
  const exec = async () => { throw new Error('git must not be asked'); };
  try {
    assert.equal((await detectArch(root, {}, { exec })).source, 'worktree');
  } finally { cleanup(root); }
});

test('nothing anywhere gives source none, and readArch returns an empty Arch', async () => {
  const root = repo({ 'a.txt': 'a' });
  try {
    assert.deepEqual(await detectArch(root, {}, { exec: noGit }), { source: 'none', dir: null, files: {} });
    assert.deepEqual(await readArch(root, {}, { exec: noGit }), { source: 'none', dir: null, lang: 'en', layers: [], parts: [] });
  } finally { cleanup(root); }
});

test('readArch parses what it detected', async () => {
  const root = repo({ 'docs/arquitetura/README.md': '# P', 'docs/arquitetura/vitrine.md': '# Vitrine\n\nSobre.\n\n## O que falta\n\n- [ ] Algo `vi01`\n' });
  try {
    const a = await readArch(root, {}, { exec: noGit });
    assert.deepEqual([a.source, a.lang, a.parts[0].counts.todo], ['worktree', 'pt', 1]);
  } finally { cleanup(root); }
});

test('readArch reads the folder again only when a file in it changes, is added or removed', async () => {
  const part = '# Vitrine\n\nSobre.\n\n## O que falta\n\n- [ ] Algo `vi01`\n';
  const root = repo({ 'docs/arquitetura/README.md': '# P', 'docs/arquitetura/vitrine.md': part });
  const file = join(root, 'docs/arquitetura/vitrine.md');
  try {
    const first = await readArch(root, {}, { exec: noGit });
    assert.equal(await readArch(root, {}, { exec: noGit }), first, 'nothing changed: the same Arch, nothing parsed');
    writeFileSync(file, `${part}- [ ] Outra coisa \`vi02\`\n`);
    utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const second = await readArch(root, {}, { exec: noGit });
    assert.notEqual(second, first);
    assert.equal(second.parts[0].counts.todo, 2, 'the new item shows at once');
    writeFileSync(join(root, 'docs/arquitetura/pagamentos.md'), '# Pagamentos\n');
    assert.equal((await readArch(root, {}, { exec: noGit })).parts.length, 2, 'a new part file shows too');
    rmSync(file);
    assert.deepEqual((await readArch(root, {}, { exec: noGit })).parts.map((p) => p.id), ['pagamentos']);
  } finally { cleanup(root); }
});

test('from the main branch, readArch asks git for the branch heads once and shows the files again only when the branch moves', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  let commit = 'aaa';
  let calls = 0;
  const shows = [];
  const exec = async (cwd, args) => {
    const a = args.join(' ');
    calls++;
    if (a.startsWith('for-each-ref ')) return `refs/heads/main ${commit}\n`;
    if (a === 'ls-tree -z --name-only main:docs/arquitetura') return 'README.md\0vitrine.md\0';
    if (a.startsWith('show ')) { shows.push(a); return a.endsWith('README.md') ? '# Partes\n' : '# Vitrine\n'; }
    return '';
  };
  try {
    const first = await readArch(root, {}, { exec, mainBranch: 'main' });
    assert.equal(first.source, 'main-branch');
    assert.equal(shows.length, 2);
    assert.equal(await readArch(root, {}, { exec, mainBranch: 'main' }), first);
    assert.equal(shows.length, 2, 'no git show while the branch stays');
    calls = 0;
    await readArch(root, {}, { exec, mainBranch: 'main' });
    assert.equal(calls, 1, 'one git call per read while nothing moves');
    commit = 'bbb';
    await readArch(root, {}, { exec, mainBranch: 'main' });
    assert.equal(shows.length, 4);
  } finally { cleanup(root); }
});

// Work on branches leaves the local main behind origin/main, often by many commits: the map must not vanish then.
function remoteExec({ local, remote, localOnly = '0', folderOn }) {
  return async (cwd, args) => {
    const a = args.join(' ');
    if (a === 'rev-parse --verify --quiet refs/heads/main') return local ? `${local}\n` : '';
    if (a.startsWith('for-each-ref ')) {
      return [local && `refs/heads/main ${local}`, remote && `refs/remotes/origin/main ${remote}`].filter(Boolean).join('\n');
    }
    if (a === 'rev-list --count origin/main..main') return `${localOnly}\n`;
    if (a === `ls-tree -z --name-only ${folderOn}:docs/arquitetura`) return 'README.md\0whatsapp.md\0';
    if (a.startsWith(`show ${folderOn}:`)) return a.endsWith('README.md') ? '# Partes\n' : '# WhatsApp\n';
    return '';
  };
}

test('a local main behind origin/main reads the folder from origin/main', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  try {
    const d = await detectArch(root, {}, { exec: remoteExec({ local: 'aaa', remote: 'bbb', folderOn: 'origin/main' }) });
    assert.deepEqual([d.source, d.dir, Object.keys(d.files)], ['main-branch', 'docs/arquitetura', ['README.md', 'whatsapp.md']]);
  } finally { cleanup(root); }
});

test('with no local main, origin/main is read', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  try {
    const a = await readArch(root, {}, { exec: remoteExec({ remote: 'bbb', folderOn: 'origin/main' }), mainBranch: 'main' });
    assert.deepEqual([a.source, a.parts.map((p) => p.id)], ['main-branch', ['whatsapp']]);
  } finally { cleanup(root); }
});

test('a local main with commits origin/main lacks stays the one read', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  try {
    const d = await detectArch(root, {}, { exec: remoteExec({ local: 'aaa', remote: 'bbb', localOnly: '2', folderOn: 'main' }) });
    assert.equal(d.source, 'main-branch');
  } finally { cleanup(root); }
});

test('readArch shows the files again when origin/main moves', async () => {
  const root = repo({ 'src/x.txt': 'x' });
  let remote = 'bbb';
  let shows = 0;
  const base = remoteExec({ local: 'aaa', remote: 'x', folderOn: 'origin/main' });
  const exec = async (cwd, args) => {
    const a = args.join(' ');
    if (a.startsWith('show ')) shows++;
    if (a.startsWith('for-each-ref ')) return `refs/heads/main aaa\nrefs/remotes/origin/main ${remote}`;
    return base(cwd, args);
  };
  try {
    const first = await readArch(root, {}, { exec, mainBranch: 'main' });
    assert.equal(first.parts.length, 1);
    assert.equal(await readArch(root, {}, { exec, mainBranch: 'main' }), first);
    remote = 'ccc';
    await readArch(root, {}, { exec, mainBranch: 'main' });
    assert.equal(shows, 4);
  } finally { cleanup(root); }
});
