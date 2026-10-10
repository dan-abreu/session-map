import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versionMismatch, docsDisagree, staleImage, docSize, agreeRules } from '../server/foundation/docwatch-agree.mjs';

const doc = (path, text) => ({ path, text });
const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n');
const route = (method, path, extra = {}) => ({
  id: `route:${method} ${path}`, kind: 'route', name: `${method} ${path}`, file: 'apps/api/src/orders.ts', line: 3, sha: 'a1', origin: 'EXTRACTED',
  attrs: { method, path, framework: 'fastify' }, refs: [], ...extra,
});
const factsOf = (list) => ({ version: 1, facts: list });
const pkg = (version) => ({ path: 'package.json', text: `{\n  "name": "acme-shop",\n  "version": "${version}"\n}\n` });
const changelog = (top) => doc('CHANGELOG.md', `# Changelog\n\n## Unreleased\n\n- soon\n\n## ${top}\n\n- first\n`);

test('package.json 1.2.0 and CHANGELOG 1.1.0 point at both files', () => {
  const found = versionMismatch({ docs: [changelog('1.1.0')], manifests: [pkg('1.2.0')] });
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.rule, 'version-mismatch');
  assert.equal(f.target.file, 'CHANGELOG.md');
  assert.equal(f.target.line, 7);
  assert.deepEqual(f.what.params, { where: 'CHANGELOG.md', found: '1.1.0', expected: '1.2.0' });
  assert.deepEqual(f.evidence.map((e) => [e.file, e.line]), [['CHANGELOG.md', 7], ['package.json', 3]]);
  assert.match(f.id, /^f:[0-9a-f]{12}$/);
  assert.equal(f.what.msg, 'watch.version-mismatch.what');
  assert.equal(f.fix.kind, 'ai-update');
});

test('a changelog that agrees, with Unreleased on top, finds nothing', () => {
  assert.deepEqual(versionMismatch({ docs: [changelog('1.2.0')], manifests: [pkg('1.2.0')] }), []);
});

test('the README marker, label and badge are checked; prose about other versions is not', () => {
  const readme = doc('README.md', [
    '# Acme',
    '<!-- session-map:version 1.1.0 -->',
    'Needs Node version 20.1.0.',
    'Since version 0.1.0 we log things.',
    'Version: **1.2.0**',
  ].join('\n'));
  const found = versionMismatch({ docs: [readme], manifests: [pkg('1.2.0')] });
  assert.equal(found.length, 1);
  assert.equal(found[0].target.line, 2);
  assert.equal(found[0].what.params.found, '1.1.0');
  const badge = doc('README.md', '![v](https://img.shields.io/badge/version-1.0.0-blue)\n');
  const b = versionMismatch({ docs: [badge], manifests: [pkg('1.2.0')] });
  assert.equal(b.length, 1);
  assert.equal(b[0].what.params.found, '1.0.0');
  assert.deepEqual(versionMismatch({ docs: [doc('README.md', 'Since version 0.1.0 we log things.\nNode version 20.1.0')], manifests: [pkg('1.2.0')] }), []);
});

test('other manifests are compared with the first one; pubspec build number is ignored', () => {
  const pubspec = { path: 'pubspec.yaml', text: 'name: acme\nversion: 1.2.0+7\n' };
  assert.deepEqual(versionMismatch({ docs: [], manifests: [pkg('1.2.0'), pubspec] }), []);
  const other = { path: 'VERSION', text: '1.3.0\n' };
  const found = versionMismatch({ docs: [], manifests: [pkg('1.2.0'), other] });
  assert.equal(found.length, 1);
  assert.equal(found[0].target.file, 'VERSION');
  assert.deepEqual(found[0].evidence.map((e) => e.file), ['VERSION', 'package.json']);
});

test('versions.json code version is the reference when it exists', () => {
  const versions = { code: { version: '2.0.0', source: 'package.json', file: 'package.json', line: 3 }, tag: null, mismatch: false };
  const found = versionMismatch({ docs: [changelog('1.9.0')], manifests: [], versions });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.params.expected, '2.0.0');
  assert.equal(found[0].evidence[1].file, 'package.json');
});

test('a newer tag than the code, or the other way, is a finding only when versions.json says mismatch', () => {
  const versions = { code: { version: '1.2.0', file: 'package.json', line: 3 }, tag: 'v1.1.0', mismatch: true };
  const found = versionMismatch({ docs: [], manifests: [pkg('1.2.0')], versions });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.params.where, 'v1.1.0');
  assert.equal(found[0].what.params.found, '1.1.0');
  assert.equal(found[0].what.params.expected, '1.2.0');
  assert.equal(found[0].fix.kind, 'manual');
  assert.deepEqual(versionMismatch({ docs: [], manifests: [pkg('1.2.0')], versions: { ...versions, mismatch: false } }), []);
});

test('with no manifest the changelog is the reference; with nothing to compare it is empty', () => {
  const readme = doc('README.md', 'Version: 1.0.0\n');
  const found = versionMismatch({ docs: [changelog('1.1.0'), readme], manifests: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].target.file, 'README.md');
  assert.deepEqual(versionMismatch({ docs: [], manifests: [] }), []);
  assert.deepEqual(versionMismatch({ docs: null, manifests: null }), []);
});

test('manifests are read from the root when not given, never an .env', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-agree-'));
  try {
    writeFileSync(join(root, 'package.json'), '{\n "version": "3.0.0"\n}\n');
    writeFileSync(join(root, '.env'), 'VERSION=9.9.9\n');
    const found = versionMismatch({ root, docs: [changelog('2.9.0')] });
    assert.equal(found.length, 1);
    assert.equal(found[0].what.params.expected, '3.0.0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('same finding keeps its id when the line moves', () => {
  const a = versionMismatch({ docs: [changelog('1.1.0')], manifests: [pkg('1.2.0')] })[0];
  const moved = doc('CHANGELOG.md', `# Changelog\n\nIntro\n\nmore\n\nand more\n\n## 1.1.0\n\n- x\n`);
  const b = versionMismatch({ docs: [moved], manifests: [pkg('1.2.0')] })[0];
  assert.notEqual(a.target.line, b.target.line);
  assert.equal(a.id, b.id);
});

test('README says 12 routes and the code has 14', () => {
  const facts = factsOf(Array.from({ length: 14 }, (_, i) => route('GET', `/r${i}`)));
  const found = docsDisagree({ docs: [doc('README.md', '# Acme\n\nThe API has 12 routes.\n')], facts });
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.rule, 'docs-disagree');
  assert.equal(f.target.file, 'README.md');
  assert.equal(f.target.line, 3);
  assert.equal(f.what.params.claimed, 12);
  assert.equal(f.what.params.count, 14);
  assert.equal(f.what.params.kind, 'route');
  assert.equal(f.what.msg, 'watch.docs-disagree.what');
});

test('an AMBIGUOUS route of that kind stops the accusation; other kinds do not', () => {
  const list = Array.from({ length: 14 }, (_, i) => route('GET', `/r${i}`));
  list[3] = route('GET', null, { id: 'route:GET ?', origin: 'AMBIGUOUS' });
  const readme = doc('README.md', 'It has 12 routes and 2 tables.\n');
  assert.deepEqual(docsDisagree({ docs: [readme], facts: factsOf(list) }), []);
  const withTables = factsOf([...list, { id: 'table:A', kind: 'table', file: 'schema.prisma', line: 1, origin: 'EXTRACTED' }, { id: 'table:B', kind: 'table', file: 'schema.prisma', line: 9, origin: 'EXTRACTED' }, { id: 'table:C', kind: 'table', file: 'schema.prisma', line: 19, origin: 'EXTRACTED' }]);
  const found = docsDisagree({ docs: [readme], facts: withTables });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.params.kind, 'table');
});

test('a correct number, vague numbers, code blocks and missing facts say nothing', () => {
  const facts = factsOf(Array.from({ length: 14 }, (_, i) => route('GET', `/r${i}`)));
  assert.deepEqual(docsDisagree({ docs: [doc('README.md', 'We have 14 routes.\n')], facts }), []);
  assert.deepEqual(docsDisagree({ docs: [doc('README.md', 'Over 12 routes, more than 3 tables, 50+ routes, ~9 routes.\n')], facts }), []);
  assert.deepEqual(docsDisagree({ docs: [doc('README.md', '```\n12 routes\n```\nand `7 routes` inline\n')], facts }), []);
  assert.deepEqual(docsDisagree({ docs: [doc('README.md', 'It has 12 routes.\n')], facts: null }), []);
  assert.deepEqual(docsDisagree({ docs: [doc('README.md', 'It has 12 routes.\n')], facts: factsOf([]) }), []);
  assert.deepEqual(docsDisagree({ docs: [doc('apps/api/README.md', 'It has 12 routes.\n')], facts }), []);
});

test('Portuguese words count too', () => {
  const facts = factsOf([{ id: 'queue:a', kind: 'queue', file: 'w.ts', line: 1, origin: 'EXTRACTED' }, { id: 'queue:b', kind: 'queue', file: 'w.ts', line: 2, origin: 'EXTRACTED' }]);
  const found = docsDisagree({ docs: [doc('README.pt-BR.md', 'Tem 5 filas e 1 tela.\n')], facts });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.params.kind, 'queue');
});

const arch = (mermaid, parts) => ({ dir: 'docs/architecture', mermaid, parts, layers: [] });
const archReadme = (mermaid) => doc('docs/architecture/README.md', `# Architecture\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`);

test('a Mermaid box that matches no part is a finding at its line', () => {
  const mermaid = 'flowchart LR\n  orders[Orders] --> ghost[Ghost Town]';
  const input = {
    docs: [archReadme(mermaid)],
    arch: arch(mermaid, [{ id: 'orders', name: 'Orders' }, { id: 'billing', name: 'Billing' }]),
  };
  const found = docsDisagree(input);
  assert.equal(found.length, 1);
  assert.equal(found[0].target.file, 'docs/architecture/README.md');
  assert.equal(found[0].target.line, 5);
  assert.equal(found[0].what.params.what, 'Ghost Town');
  assert.equal(found[0].severity, 'detail');
});

test('a box that is a part, or a person or external of the model, is fine', () => {
  const mermaid = 'flowchart LR\n  customer[Customer] --> orders[Orders]\n  orders --> pay[Stripe]';
  const parts = [{ id: 'orders', name: 'Orders' }];
  const model = { nodes: [{ id: 'person:customer', kind: 'person', name: 'Customer' }, { id: 'ext:stripe', kind: 'external', name: 'Stripe' }] };
  assert.deepEqual(docsDisagree({ docs: [archReadme(mermaid)], arch: arch(mermaid, parts), model }), []);
  assert.equal(docsDisagree({ docs: [archReadme(mermaid)], arch: arch(mermaid, parts), model: null }).length, 2);
  assert.deepEqual(docsDisagree({ docs: [], arch: null }), []);
  assert.deepEqual(docsDisagree({ docs: [], arch: arch(null, parts) }), []);
  assert.deepEqual(docsDisagree({ docs: [], arch: arch('not a flowchart', parts) }), []);
});

const T_OLD = '2026-09-01T10:00:00.000Z';
const T_NEW = '2026-10-01T10:00:00.000Z';
const image = (extra = {}) => ({ doc: 'README.md', line: 12, image: 'docs/img/orders.png', shows: null, ...extra });

test('a screenshot older than its declared screen is stale; a newer one is not', () => {
  const dates = new Map([['docs/img/orders.png', T_OLD], ['apps/web/app/orders/page.tsx', T_NEW]]);
  const found = staleImage({ images: [image({ shows: 'apps/web/app/orders/page.tsx' })], commitDates: dates });
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.rule, 'stale-image');
  assert.equal(f.origin, 'DECLARED');
  assert.equal(f.target.file, 'README.md');
  assert.equal(f.target.line, 12);
  assert.equal(f.what.params.image, 'docs/img/orders.png');
  assert.equal(f.what.params.screen, 'apps/web/app/orders/page.tsx');
  assert.deepEqual(f.evidence.map((e) => e.file), ['README.md', 'apps/web/app/orders/page.tsx']);
  const fresh = new Map([['docs/img/orders.png', T_NEW], ['apps/web/app/orders/page.tsx', T_OLD]]);
  assert.deepEqual(staleImage({ images: [image({ shows: 'apps/web/app/orders/page.tsx' })], commitDates: fresh }), []);
});

test('without a marker the image name is matched to one screen (INFERRED)', () => {
  const facts = factsOf([
    { id: 'screen:web:/orders', kind: 'screen', file: 'apps/web/app/orders/page.tsx', line: 1, origin: 'EXTRACTED', attrs: { route: '/orders', framework: 'next-app' } },
    { id: 'screen:web:/orders/[id]', kind: 'screen', file: 'apps/web/app/orders/[id]/page.tsx', line: 1, origin: 'EXTRACTED', attrs: { route: '/orders/[id]', framework: 'next-app' } },
  ]);
  const dates = new Map([['docs/img/orders.png', T_OLD], ['apps/web/app/orders/page.tsx', T_NEW], ['apps/web/app/orders/[id]/page.tsx', T_NEW]]);
  const found = staleImage({ images: [image()], commitDates: dates, facts });
  assert.equal(found.length, 1);
  assert.equal(found[0].origin, 'INFERRED');
  assert.equal(found[0].what.params.screen, 'apps/web/app/orders/page.tsx');
  assert.equal(found[0].evidence[1].factId, 'screen:web:/orders');
});

test('a Flutter class matches by name without its Screen suffix', () => {
  const facts = factsOf([{ id: 'screen:customer:CartScreen', kind: 'screen', file: 'lib/cart_screen.dart', line: 4, origin: 'EXTRACTED', attrs: { route: null, widget: 'CartScreen', framework: 'flutter' } }]);
  const dates = new Map([['docs/cart.png', T_OLD], ['lib/cart_screen.dart', T_NEW]]);
  const found = staleImage({ images: [image({ image: 'docs/cart.png' })], commitDates: dates, facts });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.params.screen, 'lib/cart_screen.dart');
});

test('two screens with the same name, no match, or a missing date say nothing', () => {
  const two = factsOf([
    { id: 'screen:a:/orders', kind: 'screen', file: 'apps/a/orders.tsx', line: 1, origin: 'EXTRACTED', attrs: { route: '/orders' } },
    { id: 'screen:b:/orders', kind: 'screen', file: 'apps/b/orders.tsx', line: 1, origin: 'EXTRACTED', attrs: { route: '/orders' } },
  ]);
  const dates = new Map([['docs/img/orders.png', T_OLD], ['apps/a/orders.tsx', T_NEW], ['apps/b/orders.tsx', T_NEW]]);
  assert.deepEqual(staleImage({ images: [image()], commitDates: dates, facts: two }), []);
  assert.deepEqual(staleImage({ images: [image({ image: 'docs/logo.png' })], commitDates: dates, facts: two }), []);
  assert.deepEqual(staleImage({ images: [image({ shows: 'apps/a/orders.tsx' })], commitDates: new Map([['apps/a/orders.tsx', T_NEW]]) }), []);
  assert.deepEqual(staleImage({ images: [image({ shows: 'apps/a/orders.tsx' })], commitDates: null }), []);
  assert.deepEqual(staleImage({ images: null, commitDates: dates }), []);
});

test('a marker that points at a folder uses its newest file', () => {
  const dates = new Map([['docs/img/orders.png', T_OLD], ['apps/web/orders/a.tsx', T_OLD], ['apps/web/orders/b.tsx', T_NEW]]);
  const found = staleImage({ images: [image({ shows: 'apps/web/orders/' })], commitDates: dates });
  assert.equal(found.length, 1);
});

test('README of 320 lines gets doc-size with split', () => {
  const found = docSize({ docs: [doc('README.md', lines(320))] });
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.rule, 'doc-size');
  assert.equal(f.fix.kind, 'split');
  assert.equal(f.severity, 'detail');
  assert.equal(f.what.params.doc, 'README.md');
  assert.equal(f.what.params.type, 'readme');
  assert.equal(f.what.params.lines, 320);
  assert.equal(f.what.params.limit, 200);
  const strong = docSize({ docs: [doc('README.md', lines(450))] });
  assert.equal(strong[0].severity, 'important');
  assert.equal(strong[0].what.params.limit, 400);
});

test('a long CHANGELOG is archived, never split', () => {
  const found = docSize({ docs: [doc('CHANGELOG.md', lines(450))] });
  assert.equal(found.length, 1);
  assert.equal(found[0].fix.kind, 'archive');
});

test('an architecture part over 100 lines with no summary is flagged for it', () => {
  const part = doc('docs/architecture/orders.md', `# Orders\n\n## How\n\n${lines(120)}`);
  const found = docSize({ docs: [part] });
  assert.equal(found.length, 1);
  assert.equal(found[0].what.msg, 'watch.doc-size.summary.what');
  assert.equal(found[0].fix.kind, 'summary');
  const withSummary = doc('docs/architecture/orders.md', `# Orders\n\n## Summary\n\n${lines(120)}`);
  assert.deepEqual(docSize({ docs: [withSummary] }), []);
});

test('config.docLimits overrides, short and unknown documents say nothing', () => {
  assert.deepEqual(docSize({ docs: [doc('README.md', lines(320))], config: { docLimits: { readme: { warn: 400, strong: 800 } } } }), []);
  assert.deepEqual(docSize({ docs: [doc('README.md', lines(50)), doc('notes.md', lines(900))] }), []);
  assert.deepEqual(docSize({ docs: null }), []);
});

test('the same findings come out of two rounds with the same ids', () => {
  const input = { docs: [doc('README.md', lines(320)), changelog('1.1.0')], manifests: [pkg('1.2.0')] };
  const a = agreeRules(input).map((f) => f.id);
  const b = agreeRules(input).map((f) => f.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  assert.equal(a.length, 2);
});

test('agreeRules gives every finding the contract shape and survives empty input', () => {
  const input = { docs: [doc('README.md', lines(320)), changelog('1.1.0')], manifests: [pkg('1.2.0')] };
  for (const f of agreeRules(input)) {
    for (const k of ['id', 'rule', 'severity', 'target', 'evidence', 'what', 'why', 'todo', 'fix']) assert.ok(f[k], `${f.rule} lacks ${k}`);
    assert.ok(['grave', 'important', 'detail'].includes(f.severity));
    assert.equal(f.fix.opId, null);
    assert.match(f.why.msg, /^watch\./);
    assert.match(f.todo.msg, /^watch\./);
  }
  assert.deepEqual(agreeRules({}), []);
  assert.deepEqual(agreeRules(null), []);
});
