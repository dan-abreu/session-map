import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFor } from '../server/foundation/health-drafts.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';

const DRAFT_IDS = [
  'community.security', 'community.code_of_conduct', 'community.contributing', 'community.support', 'community.issue_templates',
  'community.pr_template', 'community.codeowners', 'security.update_bot', 'hygiene.editorconfig', 'hygiene.gitignore',
  'hygiene.env_example', 'releases.changelog', 'security.gitignore_secrets',
];

function input(over = {}) {
  return {
    files: ['package.json', 'src/main.js', 'pnpm-lock.yaml'],
    packages: [{ dir: '', manifest: 'package.json', kind: 'node', name: 'acme-shop', scripts: { test: 'node --test', lint: 'eslint .', build: 'tsc' }, private: false }],
    scripts: { test: 'node --test', lint: 'eslint .', build: 'tsc', dev: 'node watch.js' },
    envNames: ['STRIPE_KEY', 'DATABASE_URL', 'STRIPE_KEY'],
    projectName: 'acme-shop',
    license: 'MIT',
    ecosystems: ['npm', 'github-actions'],
    ...over,
  };
}
const draft = (id, over) => draftFor(id, input(over));
const allOutputs = (over) => DRAFT_IDS.map((id) => [id, draft(id, over)]).filter(([, d]) => d);

test('every draft item produces a draft with files, a why and its placeholders', () => {
  for (const id of DRAFT_IDS) {
    const d = draft(id);
    assert.ok(d, id);
    assert.ok(d.files.length >= 1, id);
    for (const f of d.files) assert.ok(typeof f.path === 'string' && f.path && typeof f.after === 'string' && f.after.endsWith('\n'), id);
    assert.equal(typeof d.why.msg, 'string');
    assert.ok(Array.isArray(d.placeholders));
  }
});

test('SECURITY.md has the contact marker and no real e-mail', () => {
  const d = draft('community.security');
  assert.equal(d.files.length, 1);
  assert.equal(d.files[0].path, 'SECURITY.md');
  assert.ok(d.files[0].after.includes('<CONTACT EMAIL>'));
  assert.deepEqual(d.placeholders, ['<CONTACT EMAIL>']);
  assert.ok(d.files[0].after.split('\n').filter((l) => l.trim()).length >= 6);
  assert.doesNotMatch(d.files[0].after, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
});

test('CONTRIBUTING uses the real scripts from the input and the package manager of the lockfile', () => {
  const d = draft('community.contributing');
  const text = d.files[0].after;
  assert.equal(d.files[0].path, 'CONTRIBUTING.md');
  assert.match(text, /pnpm (run )?test/);
  assert.match(text, /pnpm (run )?lint/);
  assert.doesNotMatch(text, /(^|[^p])npm run|yarn /);
  assert.match(text, /pull request/i);
  assert.ok(text.split('\n').filter((l) => l.trim()).length >= 8);
  assert.deepEqual(d.placeholders, []);
});

test('CONTRIBUTING without a test script asks the owner with a marker, and ignores unsafe script names', () => {
  const d = draft('community.contributing', { files: ['package.json'], scripts: { 'x; rm -rf /': 'y', lint: 'eslint' } });
  const text = d.files[0].after;
  assert.ok(text.includes('<TEST COMMAND>'));
  assert.deepEqual(d.placeholders, ['<TEST COMMAND>']);
  assert.doesNotMatch(text, /rm -rf/);
  assert.match(text, /npm run lint/);
});

test('dependabot.yml lists only the detected ecosystems, weekly', () => {
  const d = draft('security.update_bot', { packages: [{ dir: '', kind: 'node', scripts: {} }, { dir: 'backend', kind: 'php', scripts: {} }], ecosystems: ['github-actions', 'cobol'] });
  const f = d.files[0];
  assert.equal(f.path, '.github/dependabot.yml');
  assert.match(f.after, /package-ecosystem: "npm"/);
  assert.match(f.after, /package-ecosystem: "composer"/);
  assert.match(f.after, /directory: "\/backend"/);
  assert.match(f.after, /package-ecosystem: "github-actions"/);
  assert.doesNotMatch(f.after, /cobol|pub"|pip/);
  assert.equal((f.after.match(/interval: "weekly"/g) || []).length, 3);
  assert.deepEqual(d.placeholders, []);
});

test('CONTRIBUTING of a PHP root uses composer run, never npm', () => {
  const d = draft('community.contributing', { files: ['composer.json', 'composer.lock'], packages: [{ dir: '', kind: 'php', scripts: { test: 'phpunit', lint: 'pint' } }], scripts: undefined });
  const text = d.files[0].after;
  assert.match(text, /composer run test/);
  assert.match(text, /composer run lint/);
  assert.doesNotMatch(text, /(npm|pnpm|yarn)/);
  assert.deepEqual(d.placeholders, []);
});

test('CONTRIBUTING of a Dart root (no known runner) gives no command, only the test marker', () => {
  const d = draft('community.contributing', { files: ['pubspec.yaml'], packages: [{ dir: '', kind: 'dart', scripts: { test: 'x' } }], scripts: undefined });
  const text = d.files[0].after;
  assert.ok(text.includes('<TEST COMMAND>'));
  assert.deepEqual(d.placeholders, ['<TEST COMMAND>']);
  assert.doesNotMatch(text, /(npm|pnpm|yarn|composer)/);
});

test('loose scripts with no package use npm only when package.json is at the root', () => {
  const loose = { packages: [], scripts: { test: 'run-tests' } };
  assert.match(draft('community.contributing', { ...loose, files: ['package.json'] }).files[0].after, /npm run test/);
  const none = draft('community.contributing', { ...loose, files: ['web/package.json', 'main.py'] });
  assert.doesNotMatch(none.files[0].after, /(npm|pnpm|yarn|composer)/);
  assert.deepEqual(none.placeholders, ['<TEST COMMAND>']);
});

test('a package dir that looks like an e-mail never reaches dependabot.yml; a scoped dir does', () => {
  const d = draft('security.update_bot', { packages: [{ dir: 'a@b.com', kind: 'node' }, { dir: 'packages/@acme/ui', kind: 'node' }], ecosystems: [] });
  assert.doesNotMatch(d.files[0].after, /a@b\.com/);
  assert.match(d.files[0].after, /directory: "\/packages\/@acme\/ui"/);
});

test('dependabot.yml needs at least one detected ecosystem, or no draft', () => {
  assert.equal(draft('security.update_bot', { packages: [], ecosystems: [] }), null);
});

test('.env.example has only names, deduplicated, no values', () => {
  const d = draft('hygiene.env_example', { envNames: ['STRIPE_KEY', 'DATABASE_URL', 'STRIPE_KEY', 'BAD=secretvalue', 'has space', ''] });
  assert.equal(d.files[0].path, '.env.example');
  const lines = d.files[0].after.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.deepEqual(lines, ['DATABASE_URL=', 'STRIPE_KEY=']);
  assert.equal(draft('hygiene.env_example', { envNames: [] }), null);
});

test('.gitignore follows the stack and covers secrets; the secrets item reuses it', () => {
  const node = draft('hygiene.gitignore');
  assert.equal(node.files[0].path, '.gitignore');
  for (const p of ['.env', '*.pem', '*.key', 'node_modules/']) assert.ok(node.files[0].after.split('\n').includes(p), p);
  const php = draft('hygiene.gitignore', { files: ['composer.json'], packages: [{ dir: '', kind: 'php' }] });
  assert.ok(php.files[0].after.split('\n').includes('vendor/'));
  assert.ok(!php.files[0].after.split('\n').includes('node_modules/'));
  const secrets = draft('security.gitignore_secrets');
  assert.deepEqual(secrets.files, node.files);
  assert.deepEqual(secrets.placeholders, node.placeholders);
  assert.equal(secrets.why.params.item, 'security.gitignore_secrets');
  assert.deepEqual(secrets.why.params.paths, ['.gitignore']);
});

test('.gitignore with no known stack has only the secrets and editor blocks, no invented stack', () => {
  const d = draft('hygiene.gitignore', { files: ['main.py', 'requirements.txt'], packages: [], scripts: {} });
  const lines = d.files[0].after.split('\n');
  for (const p of ['.env', '*.pem', '*.key', '.DS_Store']) assert.ok(lines.includes(p), p);
  for (const p of ['# Node', 'node_modules/', 'dist/', 'vendor/', '.dart_tool/']) assert.ok(!lines.includes(p), p);
});

test('changelog has Unreleased, 10+ lines and a version section left as markers (never an invented version)', () => {
  const d = draft('releases.changelog');
  const text = d.files[0].after;
  assert.equal(d.files[0].path, 'CHANGELOG.md');
  assert.match(text, /## \[?Unreleased\]?/);
  assert.ok(text.split('\n').filter((l) => l.trim()).length >= 10);
  assert.match(text, /^## \[?<VERSION>\]? - <DATE>$/m);
  assert.ok(d.placeholders.includes('<VERSION>') && d.placeholders.includes('<DATE>'));
  assert.doesNotMatch(text, /\d+\.\d+\.\d+|\d{4}-\d{2}-\d{2}/);
});

test('templates and CODEOWNERS land in .github, CODEOWNERS only commented', () => {
  assert.deepEqual(draft('community.issue_templates').files.map((f) => f.path), ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml']);
  for (const f of draft('community.issue_templates').files) assert.match(f.after, /^name: .+\ndescription: .+/);
  assert.equal(draft('community.pr_template').files[0].path, '.github/pull_request_template.md');
  const co = draft('community.codeowners');
  assert.equal(co.files[0].path, '.github/CODEOWNERS');
  assert.ok(co.files[0].after.includes('<GITHUB USER OR TEAM>'));
  assert.deepEqual(co.placeholders, ['<GITHUB USER OR TEAM>']);
  assert.ok(co.files[0].after.split('\n').every((l) => !l.trim() || l.startsWith('#')));
  assert.equal(draft('community.editorconfig'), null);
  assert.match(draft('hygiene.editorconfig').files[0].after, /^root = true$/m);
});

test('a file that already exists (any case, root, .github or docs) means no draft', () => {
  assert.equal(draft('community.security', { files: ['security.MD'] }), null);
  assert.equal(draft('community.security', { files: ['.github/SECURITY.md'] }), null);
  assert.equal(draft('community.support', { files: ['docs/support.txt'] }), null);
  assert.equal(draft('community.contributing', { files: ['CONTRIBUTING.md'] }), null);
  assert.equal(draft('community.code_of_conduct', { files: ['CODE_OF_CONDUCT.md'] }), null);
  assert.equal(draft('hygiene.gitignore', { files: ['.gitignore'] }), null);
  assert.equal(draft('security.gitignore_secrets', { files: ['.gitignore'] }), null);
  assert.equal(draft('hygiene.editorconfig', { files: ['.editorconfig'] }), null);
  assert.equal(draft('releases.changelog', { files: ['changelog.md'] }), null);
  assert.equal(draft('security.update_bot', { files: ['.github/dependabot.yml'] }), null);
  assert.equal(draft('security.update_bot', { files: ['renovate.json'] }), null);
  assert.equal(draft('hygiene.env_example', { files: ['.env.sample'] }), null);
  assert.equal(draft('community.pr_template', { files: ['.github/pull_request_template.md'] }), null);
  assert.equal(draft('community.codeowners', { files: ['CODEOWNERS'] }), null);
  assert.equal(draft('community.issue_templates', { files: ['.github/ISSUE_TEMPLATE/bug.yml'] }), null);
});

test('manual items and unknown ids never get a draft', () => {
  const drafts = new Set(DRAFT_IDS);
  for (const it of HEALTH_ITEMS) {
    if (!drafts.has(it.id)) assert.equal(draft(it.id), null, it.id);
  }
  assert.equal(draft('community.license'), null);
  assert.equal(draft('product.privacy'), null);
  assert.equal(draft('product.terms'), null);
  assert.equal(draft('nope.nothing'), null);
  assert.equal(draftFor('community.security', null)?.files[0].path, 'SECURITY.md');
});

test('sweep: no output has a real e-mail, an invented link, a person name or legal phrases', () => {
  const outs = allOutputs();
  assert.equal(outs.length, DRAFT_IDS.length);
  for (const [id, d] of outs) {
    for (const f of d.files) {
      const t = f.after;
      assert.doesNotMatch(t, /@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, `${id} ${f.path} e-mail`);
      assert.doesNotMatch(t, /https?:\/\//i, `${id} ${f.path} link`);
      assert.doesNotMatch(t, /\bwww\./i, `${id} ${f.path} www`);
      assert.doesNotMatch(t, /indeniza|foro\b|liabilit|warrant|jurisdiction|governed by|lawsuit|hereby|indemn|copyright|\(c\)/i, `${id} ${f.path} legal`);
      assert.doesNotMatch(t, /\b\d+\s*(hours|days|business days|horas|dias)\b/i, `${id} ${f.path} promised deadline`);
      assert.doesNotMatch(t, /\b(Ana|John|Maria|Jane)\b/, `${id} ${f.path} person`);
      const marks = [...new Set(t.match(/<[A-Z][A-Z ]+>/g) || [])].sort();
      assert.deepEqual(marks, [...d.placeholders].sort(), `${id} ${f.path} placeholders`);
    }
  }
});

test('hostile project name and values cannot leak a link, an e-mail or a new line into the files', () => {
  const evil = 'x\n# pwn @evil.com https://evil.example <script>';
  for (const [id, d] of allOutputs({ projectName: evil })) {
    for (const f of d.files) {
      assert.doesNotMatch(f.after, /evil\.com|https?:|pwn|<script>/, `${id} ${f.path}`);
    }
  }
});

test('the draft is a fresh object every call and the input is not changed', () => {
  const inp = input();
  const copy = JSON.parse(JSON.stringify(inp));
  const a = draftFor('community.security', inp);
  a.files[0].after = 'changed';
  a.placeholders.push('x');
  assert.deepEqual(inp, copy);
  assert.ok(draftFor('community.security', inp).files[0].after.includes('<CONTACT EMAIL>'));
  assert.deepEqual(draftFor('community.security', inp).placeholders, ['<CONTACT EMAIL>']);
});
