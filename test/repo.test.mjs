import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readArch } from '../server/arch/detect.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (p) => existsSync(join(root, p));

test('community files exist and say the essentials', () => {
  for (const f of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.github/pull_request_template.md']) assert.ok(has(f), f);
  assert.match(read('CODE_OF_CONDUCT.md'), /Contributor Covenant/);
  assert.match(read('CODE_OF_CONDUCT.md'), /version 2\.1/i);
  assert.match(read('SECURITY.md'), /security\/advisories|private vulnerability/i);
  assert.match(read('SECURITY.md'), /127\.0\.0\.1/);
  assert.match(read('CONTRIBUTING.md'), /node --test/);
});

test('issue forms ask for a bug and a feature, and blank issues are off', () => {
  for (const f of ['bug', 'feature']) {
    const t = read(`.github/ISSUE_TEMPLATE/${f}.yml`);
    assert.match(t, /^name: .+/m, f);
    assert.match(t, /^body:/m, f);
    assert.match(t, /type: textarea/, f);
  }
  assert.match(read('.github/ISSUE_TEMPLATE/config.yml'), /blank_issues_enabled: false/);
});

test('dependabot watches the GitHub actions, and the workflow uses current action versions', () => {
  assert.match(read('.github/dependabot.yml'), /package-ecosystem: "?github-actions"?/);
  const ci = read('.github/workflows/test.yml');
  assert.doesNotMatch(ci, /@v[1-4]\b/, 'actions on the Node 20 runtime are deprecated');
  assert.match(ci, /actions\/checkout@v5/);
  assert.match(ci, /actions\/setup-node@v5/);
});

test('package.json carries the repository metadata', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'session-map');
  assert.equal(pkg.repository.url, 'git+https://github.com/dan-abreu/session-map.git');
  assert.equal(pkg.homepage, 'https://github.com/dan-abreu/session-map#readme');
  assert.equal(pkg.bugs.url, 'https://github.com/dan-abreu/session-map/issues');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.keywords.length >= 5);
  assert.ok(pkg.description);
});

test('both READMEs show the mind map and teach the architecture convention, not cells', () => {
  for (const f of ['README.md', 'README.pt-BR.md']) {
    const t = read(f);
    const images = [...t.matchAll(/(?:\]\(|src=")(docs\/images\/[^)"]+\.(?:png|webp))/g)].map((m) => m[1]);
    assert.ok(images.length >= 5, `${f}: a screenshot for each step`);
    for (const img of images) assert.ok(has(img), `${f}: ${img} exists`);
    assert.doesNotMatch(t, /\b(organs?|tissues?|neurons?|nucleus|órgãos?|tecidos?|neurônios?|núcleo)\b/i, f);
    assert.match(t, /actions\/workflows\/test\.yml\/badge\.svg/, `${f}: CI badge`);
    assert.match(t, /img\.shields\.io\/github\/v\/release/, `${f}: release badge`);
    assert.match(t, /docs\/architecture/, `${f}: points at the convention`);
  }
});

test('both READMEs start with a lay step-by-step: install, open, tour, a box, waiting for you, help', () => {
  const guides = [
    ['README.md', '## Start in 6 steps', ['Install it', 'Open the map', 'welcome tour', 'Click a box', 'Waiting for you', 'Ask the page']],
    ['README.pt-BR.md', '## Comece em 6 passos', ['Instale', 'Abra o mapa', 'passeio de boas-vindas', 'Clique numa caixa', 'Esperando você', 'Pergunte à página']],
  ];
  for (const [f, title, steps] of guides) {
    const t = read(f);
    const start = t.indexOf(title);
    assert.ok(start > 0 && start < t.indexOf('docs/architecture'), `${f}: the steps come before the technical part`);
    for (const step of steps) assert.ok(t.slice(start).includes(step), `${f}: ${step}`);
  }
});

test('the old brain screenshots are gone', () => {
  assert.ok(!has('docs/screenshot-brain.png'));
  assert.ok(!has('docs/screenshot-board.png'));
});

test('plugin and marketplace descriptions talk about the architecture map', () => {
  for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const t = read(f);
    assert.match(t, /architecture/i, f);
    assert.doesNotMatch(t, /brain/i, f);
  }
});

test('session-map documents its own architecture in the convention it teaches', async () => {
  const arch = await readArch(root, {}, { exec: async () => '' });
  assert.equal(arch.source, 'worktree');
  assert.equal(arch.lang, 'en');
  assert.ok(arch.layers.length >= 3);
  assert.ok(arch.parts.length >= 6);
  const placed = new Set(arch.layers.flatMap((l) => l.partIds));
  for (const part of arch.parts) {
    assert.ok(placed.has(part.id), `${part.id} sits in a layer`);
    assert.ok(part.about.length > 20, `${part.id} has an opening paragraph`);
    assert.ok(part.codePaths.length > 0, `${part.id} says where it is in the code`);
    for (const p of part.codePaths) assert.ok(has(p), `${part.id}: ${p} exists`);
  }
  const items = arch.parts.flatMap((p) => p.groups.flatMap((g) => g.items));
  assert.ok(items.length >= 8);
  assert.ok(items.every((i) => i.code), 'every item has a code');
  assert.equal(new Set(items.map((i) => i.code)).size, items.length, 'codes are unique');
  assert.ok(items.some((i) => i.status === 'done') && items.some((i) => i.status === 'todo'));
});

test('docs index links every architecture part and the screenshots', () => {
  const index = read('docs/README.md');
  assert.match(index, /architecture\/README\.md/);
  assert.match(index, /images\//);
});
