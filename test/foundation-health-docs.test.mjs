import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCS_CHECKS } from '../server/foundation/health-checks/docs.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const ALL = ['code', 'users', 'library'];
const ctxOf = (files, over = {}) => fakeHealthCtx({ files, kinds: ALL, visibility: 'public', ...over });
const run = (id, files, over) => DOCS_CHECKS[id](ctxOf(files, over));
const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');

test('the docs group has one function for each of the 10 docs items, nothing else', () => {
  const ids = HEALTH_ITEMS.filter((i) => i.category === 'docs').map((i) => i.id);
  assert.equal(ids.length, 10);
  assert.deepEqual(Object.keys(DOCS_CHECKS).sort(), [...ids].sort());
  for (const id of ids) assert.equal(typeof DOCS_CHECKS[id], 'function');
});

test('every check answers with state, evidence, reason and detail, and never throws on an empty repository', () => {
  for (const [id, check] of Object.entries(DOCS_CHECKS)) {
    const out = check(ctxOf({}));
    assert.ok(['pass', 'fail', 'unverified', 'na'].includes(out.state), id);
    assert.ok(Array.isArray(out.evidence), id);
    assert.ok('reason' in out && 'detail' in out, id);
  }
});

test('an item that does not apply is na with its reason, and an unknown visibility is unverified (never fail)', () => {
  const lib = fakeHealthCtx({ files: {}, kinds: ['code', 'library'], visibility: 'public' });
  assert.deepEqual(
    { state: DOCS_CHECKS['docs.runbooks'](lib).state, reason: DOCS_CHECKS['docs.runbooks'](lib).reason },
    { state: 'na', reason: 'no-users' },
  );
  const noCode = fakeHealthCtx({ files: { 'README.md': '# x' }, kinds: [], visibility: 'public' });
  assert.equal(DOCS_CHECKS['docs.architecture'](noCode).reason, 'no-code');
  const priv = fakeHealthCtx({ files: {}, kinds: ALL, visibility: 'private' });
  assert.equal(DOCS_CHECKS['docs.roadmap'](priv).state, 'na');
  assert.equal(DOCS_CHECKS['docs.roadmap'](priv).reason, 'private');
  const unknown = fakeHealthCtx({ files: {}, kinds: ALL, visibility: 'unknown' });
  const u = DOCS_CHECKS['docs.roadmap'](unknown);
  assert.deepEqual([u.state, u.reason], ['unverified', 'no-data']);
});

// ---------- docs.folder ----------

test('docs.folder: 3 or more md files in subfolders pass', () => {
  const out = run('docs.folder', { 'docs/a.md': '# a', 'docs/guide/b.md': '# b', 'docs/guide/c.md': '# c' });
  assert.equal(out.state, 'pass');
});

test('docs.folder: flat files pass when there is an index', () => {
  const out = run('docs.folder', { 'docs/README.md': '# i', 'docs/a.md': '# a', 'docs/b.md': '# b' });
  assert.equal(out.state, 'pass');
});

test('docs.folder: no docs folder is missing, 2 files is too short, 3 flat files without index is invalid', () => {
  assert.deepEqual(pick(run('docs.folder', { 'README.md': '# x' })), ['fail', 'missing']);
  assert.deepEqual(pick(run('docs.folder', { 'docs/a.md': '# a', 'docs/b.md': '# b' })), ['fail', 'too-short']);
  assert.deepEqual(pick(run('docs.folder', { 'docs/a.md': '# a', 'docs/b.md': '# b', 'docs/c.md': '# c' })), ['fail', 'invalid']);
});

function pick(out) { return [out.state, out.reason]; }

// ---------- docs.setup ----------

test('docs.setup: a setup section with a run command passes and points at the heading', () => {
  const readme = '# App\n\nIntro.\n\n## Setup\n\nInstall then run:\n\n```bash\nnpm install\nnpm run dev\n```\n';
  const out = run('docs.setup', { 'README.md': readme });
  assert.equal(out.state, 'pass');
  assert.deepEqual(out.evidence[0], { file: 'README.md', line: 5 });
});

test('docs.setup: the section title alone is not enough (too-short), no section at all is missing', () => {
  const titleOnly = '# App\n\n## Setup\n\nYou will need to install it first and then start it somehow.\n\n## License\n\nMIT\n';
  const out = run('docs.setup', { 'README.md': titleOnly });
  assert.deepEqual(pick(out), ['fail', 'too-short']);
  assert.deepEqual(out.evidence[0], { file: 'README.md', line: 3 });
  assert.deepEqual(pick(run('docs.setup', { 'README.md': '# App\n\nA small app.\n' })), ['fail', 'missing']);
});

test('docs.setup: a command that belongs to another section does not count', () => {
  const readme = '# App\n\n## Setup\n\nSee below.\n\n## Release\n\n```bash\nnpm publish\n```\n';
  assert.equal(run('docs.setup', { 'README.md': readme }).state, 'fail');
});

test('docs.setup: SETUP and CONTRIBUTING files count, a Portuguese heading counts, inline code counts', () => {
  assert.equal(run('docs.setup', { 'docs/SETUP-LOCAL.md': '# Local\n\n```\ndocker compose up\n```\n' }).state, 'pass');
  assert.equal(run('docs.setup', { 'README.md': '# App\n', 'CONTRIBUTING.md': '# Contribuir\n\n## Como rodar\n\nUse `pnpm dev` na raiz.\n' }).state, 'pass');
});

test('docs.setup: a "make sure" in prose is not a command', () => {
  const readme = '# App\n\n## Setup\n\nmake sure you read the notes before you go on.\n';
  assert.equal(run('docs.setup', { 'README.md': readme }).state, 'fail');
});

// ---------- docs.architecture ----------

test('docs.architecture: ARCHITECTURE.md, an architecture folder or a mermaid diagram pass', () => {
  assert.equal(run('docs.architecture', { 'ARCHITECTURE.md': lines(8) }).state, 'pass');
  assert.equal(run('docs.architecture', { 'docs/arquitetura/mapa.md': '# Mapa' }).state, 'pass');
  assert.equal(run('docs.architecture', { 'docs/architecture/flow.md': '# Flow' }).state, 'pass');
  assert.equal(run('docs.architecture', { 'README.md': '# A\n\n```mermaid\nflowchart LR\n  a --> b\n```\n' }).state, 'pass');
});

test('docs.architecture: the mermaid evidence points at the line of the diagram', () => {
  const out = run('docs.architecture', { 'README.md': '# A\n\ntext\n\n```mermaid\nflowchart LR\n```\n' });
  assert.deepEqual(out.evidence[0], { file: 'README.md', line: 5 });
});

test('docs.architecture: a one-line ARCHITECTURE.md is too short, nothing is missing', () => {
  assert.deepEqual(pick(run('docs.architecture', { 'ARCHITECTURE.md': 'TODO' })), ['fail', 'too-short']);
  assert.deepEqual(pick(run('docs.architecture', { 'README.md': '# A' })), ['fail', 'missing']);
});

// ---------- docs.adrs ----------

test('docs.adrs accepts docs/decisions, docs/adr and adr/', () => {
  for (const dir of ['docs/decisions', 'docs/adr', 'adr']) {
    const out = run('docs.adrs', { [`${dir}/0001-use-sqlite.md`]: '# 1' });
    assert.equal(out.state, 'pass', dir);
    assert.equal(out.evidence[0].file, `${dir}/0001-use-sqlite.md`);
  }
});

test('docs.adrs: no folder is missing, a folder with only its README is too short', () => {
  assert.deepEqual(pick(run('docs.adrs', { 'docs/a.md': '# a' })), ['fail', 'missing']);
  assert.deepEqual(pick(run('docs.adrs', { 'docs/adr/README.md': '# ADRs' })), ['fail', 'too-short']);
});

// ---------- docs.runbooks ----------

test('docs.runbooks: a runbooks folder or an OPERACAO/OPERATIONS document passes', () => {
  assert.equal(run('docs.runbooks', { 'runbooks/restore.md': '# r' }).state, 'pass');
  assert.equal(run('docs.runbooks', { 'docs/runbooks/restart.md': '# r' }).state, 'pass');
  assert.equal(run('docs.runbooks', { 'OPERACAO.md': lines(8) }).state, 'pass');
  assert.equal(run('docs.runbooks', { 'docs/OPERATIONS-guide.md': lines(8) }).state, 'pass');
});

test('docs.runbooks: nothing is missing, a stub is too short', () => {
  assert.deepEqual(pick(run('docs.runbooks', { 'README.md': '# a' })), ['fail', 'missing']);
  assert.deepEqual(pick(run('docs.runbooks', { 'OPERATIONS.md': 'todo' })), ['fail', 'too-short']);
});

// ---------- docs.openapi ----------

test('docs.openapi: a spec file or a generator dependency passes', () => {
  assert.equal(run('docs.openapi', { 'api/openapi.yaml': 'openapi: 3.0.0' }).state, 'pass');
  assert.equal(run('docs.openapi', { 'swagger.json': '{}' }).state, 'pass');
  const pkg = (deps) => JSON.stringify({ name: 'api', dependencies: deps });
  assert.equal(run('docs.openapi', { 'package.json': pkg({ '@fastify/swagger': '^8.0.0' }) }).state, 'pass');
  assert.equal(run('docs.openapi', { 'apps/api/package.json': pkg({ '@nestjs/swagger': '^7.0.0' }) }).state, 'pass');
  assert.equal(run('docs.openapi', { 'backend/composer.json': JSON.stringify({ name: 'a/b', require: { 'darkaonline/l5-swagger': '^8' } }) }).state, 'pass');
});

test('docs.openapi: no spec and no generator fails as missing; a spec inside fixtures does not count', () => {
  assert.deepEqual(pick(run('docs.openapi', { 'package.json': JSON.stringify({ name: 'a', dependencies: { fastify: '^4' } }) })), ['fail', 'missing']);
  assert.equal(run('docs.openapi', { 'test/fixtures/openapi.yaml': 'openapi: 3.0.0' }).state, 'fail');
});

// ---------- docs.database ----------

test('docs.database: schema.prisma, migrations, a dbml or a database doc pass', () => {
  assert.equal(run('docs.database', { 'packages/db/prisma/schema.prisma': 'model A {}' }).state, 'pass');
  assert.equal(run('docs.database', { 'backend/database/migrations/2024_create_users.php': '<?php' }).state, 'pass');
  assert.equal(run('docs.database', { 'db/model.dbml': 'Table a {}' }).state, 'pass');
  assert.equal(run('docs.database', { 'docs/database.md': '# DB' }).state, 'pass');
  assert.deepEqual(pick(run('docs.database', { 'README.md': '# a' })), ['fail', 'missing']);
});

// ---------- docs.glossary and docs.roadmap ----------

test('docs.glossary: a GLOSSARIO/GLOSSARY file or a Glossary heading passes; a heading inside a code block does not', () => {
  assert.equal(run('docs.glossary', { 'docs/GLOSSARIO.md': lines(5, 'termo') }).state, 'pass');
  assert.equal(run('docs.glossary', { 'GLOSSARY.md': lines(5, 'term') }).state, 'pass');
  assert.equal(run('docs.glossary', { 'README.md': '# A\n\n## Glossário\n\n- Ana: a pessoa\n' }).state, 'pass');
  assert.deepEqual(pick(run('docs.glossary', { 'README.md': '# A\n\n```md\n## Glossary\n```\n' })), ['fail', 'missing']);
  assert.deepEqual(pick(run('docs.glossary', { 'GLOSSARY.md': 'x' })), ['fail', 'too-short']);
});

test('docs.roadmap: a ROADMAP file or a Roadmap section passes', () => {
  assert.equal(run('docs.roadmap', { 'ROADMAP.md': lines(5) }).state, 'pass');
  assert.equal(run('docs.roadmap', { 'README.md': '# A\n\n## Roadmap\n\n- next thing\n' }).state, 'pass');
  assert.deepEqual(pick(run('docs.roadmap', { 'README.md': '# A' })), ['fail', 'missing']);
});

// ---------- docs.links_valid ----------

test('docs.links_valid: a broken file link and a broken anchor show up with file:line in evidence', () => {
  const files = {
    'README.md': '# Home\n\nSee [guide](docs/guide.md) and [gone](docs/gone.md).\n\n[bad anchor](docs/guide.md#nope)\n',
    'docs/guide.md': '# Guide\n\n## Install it\n',
  };
  const out = run('docs.links_valid', files);
  assert.deepEqual(pick(out), ['fail', 'invalid']);
  assert.deepEqual(out.evidence, [{ file: 'README.md', line: 3 }, { file: 'README.md', line: 5 }]);
  assert.equal(out.detail.count, 2);
});

test('docs.links_valid: valid links, the GitHub slug of a heading, folders and images pass', () => {
  const files = {
    'README.md': '# Home\n\n[a](docs/guide.md#install-it) [b](docs/) ![logo](docs/logo.png) [c](#home)\n',
    'docs/guide.md': '# Guide\n\n## Install it\n',
    'docs/logo.png': 'PNG',
  };
  assert.equal(run('docs.links_valid', files).state, 'pass');
});

test('docs.links_valid: links inside code blocks and http(s) links are ignored', () => {
  const readme = '# A\n\n```md\n[x](missing.md)\n```\n\nUse `[y](also-missing.md)` and [web](https://example.org/nope).\n';
  assert.equal(run('docs.links_valid', { 'README.md': readme }).state, 'pass');
});

test('docs.links_valid lists at most 20 and counts all', () => {
  const body = Array.from({ length: 25 }, (_, i) => `[n${i}](gone${i}.md)`).join('\n\n');
  const out = run('docs.links_valid', { 'README.md': `# A\n\n${body}\n` });
  assert.equal(out.state, 'fail');
  assert.equal(out.evidence.length, 20);
  assert.equal(out.detail.count, 25);
});

test('docs.links_valid: no readable markdown at all is unverified (no-data), not a failure', () => {
  assert.deepEqual(pick(run('docs.links_valid', { 'src/a.js': 'x' })), ['unverified', 'no-data']);
});

test('docs.links_valid: samples under fixtures are not read as the project documents', () => {
  const files = { 'README.md': '# A\n', 'test/fixtures/x/README.md': '[nope](nope.md)' };
  assert.equal(run('docs.links_valid', files).state, 'pass');
});
