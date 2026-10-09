import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
