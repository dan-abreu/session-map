import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { citeRules, codeWithoutDoc, docCitesMissing, ownerMissing, pointerBroken } from '../server/foundation/docwatch-cites.mjs';

const doc = (path, text) => ({ path, text });
const file = (path, extra = {}) => ({
  path, type: path.split('.').pop(), kind: 'code', included: true, reason: null, sha: `sha-${path}`, owner: 'p', lines: { total: 10, code: 10, comment: 0, blank: 0 }, ...extra,
});
const censusOf = (...rows) => ({ version: 1, files: rows.map((r) => (typeof r === 'string' ? file(r) : r)) });
const route = (method, path, extra = {}) => ({
  id: `route:${method} ${path}`, kind: 'route', name: `${method} ${path}`, file: 'apps/api/src/orders.ts', line: 3, sha: 'a1', origin: 'EXTRACTED',
  attrs: { method, path, framework: 'fastify' }, refs: [], ...extra,
});
const envFact = (name) => ({ id: `env:${name}`, kind: 'env', name, file: 'apps/api/src/config.ts', line: 1, sha: 'c1', origin: 'EXTRACTED', attrs: { source: 'code' }, refs: [] });
const factsOf = (list) => ({ version: 1, facts: list });

// ---------- doc-cites-missing: routes ----------

test('renaming GET /orders to GET /purchases points at every document that still says GET /orders, and only those', () => {
  const found = docCitesMissing({
    docs: [
      doc('README.md', '# Shop\n\n| Route | What |\n|---|---|\n| `GET /orders` | lists orders |\n'),
      doc('docs/api.md', '# API\n\n- `GET /orders` lists them\n- `GET /purchases` too\n'),
      doc('docs/architecture/orders.md', '# Orders\n\n## Rules\n\n- `GET /orders/` returns one order.\n'),
      doc('docs/other.md', 'Use `GET /purchases` instead.\n'),
    ],
    facts: factsOf([route('GET', '/purchases')]),
    census: censusOf('README.md', 'docs/api.md', 'docs/architecture/orders.md', 'docs/other.md'),
  });
  assert.deepEqual(found.map((f) => f.target.file).sort(), ['README.md', 'docs/api.md', 'docs/architecture/orders.md']);
  const readme = found.find((f) => f.target.file === 'README.md');
  assert.equal(readme.rule, 'doc-cites-missing');
  assert.equal(readme.target.line, 5);
  assert.deepEqual(readme.what.params, { name: 'GET /orders', kind: 'route', doc: 'README.md' });
  assert.equal(readme.what.msg, 'watch.doc-cites-missing.what');
  assert.equal(readme.why.msg, 'watch.doc-cites-missing.why');
  assert.equal(readme.todo.msg, 'watch.doc-cites-missing.todo');
  assert.match(readme.id, /^f:[0-9a-f]{12}$/);
  assert.equal(readme.severity, 'important');
  assert.deepEqual(readme.evidence, [{ file: 'README.md', line: 5, sha: 'sha-README.md' }]);
  assert.equal(new Set(found.map((f) => f.id)).size, 3);
});

test('the same missing route twice in one document is one finding, at the first line', () => {
  const found = docCitesMissing({
    docs: [doc('docs/api.md', 'a\n\n`GET /orders`\n\nand again `GET /orders`\n')],
    facts: factsOf([route('GET', '/purchases')]),
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].target.line, 3);
});

test('the id does not change when the line moves', () => {
  const input = (text) => ({ docs: [doc('docs/api.md', text)], facts: factsOf([route('GET', '/purchases')]) });
  const [a] = docCitesMissing(input('`GET /orders`\n'));
  const [b] = docCitesMissing(input('intro\n\nmore\n\n`GET /orders`\n'));
  assert.notEqual(a.target.line, b.target.line);
  assert.equal(a.id, b.id);
});

test('route parameters are compared by shape: :id, {id} and [id] are the same', () => {
  const found = docCitesMissing({
    docs: [doc('docs/api.md', '`GET /orders/{id}` `GET /orders/[id]` `GET /orders/<id>` `GET /orders/:orderId/` `GET /orders/:id?full=1`\n')],
    facts: factsOf([route('GET', '/orders/:id')]),
  });
  assert.deepEqual(found, []);
});

test('an ANY route (Next pages api) answers every method', () => {
  const found = docCitesMissing({
    docs: [doc('docs/api.md', '`POST /api/users` and `DELETE /api/users`\n')],
    facts: factsOf([route('ANY', '/api/users'), route('GET', '/x')]),
  });
  assert.deepEqual(found, []);
});

test('a prefix the program resolved (INFERRED) may be left out by the document; an EXTRACTED path may not', () => {
  const facts = factsOf([
    route('GET', '/v1/orders/:id', { origin: 'INFERRED' }),
    route('GET', '/health', { origin: 'EXTRACTED' }),
  ]);
  const found = docCitesMissing({
    docs: [doc('docs/api.md', '`GET /orders/:id` and `GET /v1/orders/:id` and `GET /orders` and `GET /orders/:id/note` and `GET /v2/health`\n')],
    facts,
  });
  assert.deepEqual(found.map((f) => f.what.params.name).sort(), ['GET /orders', 'GET /orders/:id/note', 'GET /v2/health']);
});

test('an AMBIGUOUS route fact (dynamic path) keeps the program quiet for that method; other methods are still checked', () => {
  const facts = factsOf([
    route('GET', null, { id: 'route:GET ?ADMIN_PATH', origin: 'AMBIGUOUS', attrs: { method: 'GET', path: null, framework: 'fastify' } }),
    route('POST', '/purchases'),
  ]);
  const found = docCitesMissing({ docs: [doc('docs/api.md', '`GET /admin` `POST /orders`\n')], facts });
  assert.deepEqual(found.map((f) => f.what.params.name), ['POST /orders']);
});

test('a duplicated route (AMBIGUOUS but with a known path) still counts as present', () => {
  const facts = factsOf([route('GET', '/orders', { origin: 'AMBIGUOUS', refs: [{ file: 'b.ts', line: 1 }] })]);
  assert.deepEqual(docCitesMissing({ docs: [doc('docs/api.md', '`GET /orders`\n')], facts }), []);
});

test('without any route fact (reader may not know this stack) no route is accused; facts null gives nothing', () => {
  assert.deepEqual(docCitesMissing({ docs: [doc('docs/api.md', '`GET /orders`\n')], facts: factsOf([envFact('PORT')]) }), []);
  assert.deepEqual(docCitesMissing({ docs: [doc('docs/api.md', '`GET /orders`\n')], facts: null }), []);
});

test('a route written at the start of a line in a code block counts, with the right line', () => {
  const text = ['# API', '', '```http', 'GET /orders', 'Accept: json', '```', '', '```sh', 'curl -X POST http://localhost/orders', '```'].join('\n');
  const found = docCitesMissing({ docs: [doc('docs/api.md', text)], facts: factsOf([route('GET', '/purchases')]) });
  assert.equal(found.length, 1);
  assert.equal(found[0].target.line, 4);
  assert.equal(found[0].what.params.name, 'GET /orders');
});

test('words that merely look like a route in prose are not routes', () => {
  const found = docCitesMissing({ docs: [doc('docs/api.md', 'Use GET /orders in prose, and `get the /orders` and `POST` alone.\n')], facts: factsOf([route('GET', '/x')]) });
  assert.deepEqual(found, []);
});

// ---------- doc-cites-missing: paths ----------

const PATH_CENSUS = censusOf('src/app.ts', 'apps/web/app/orders/[id]/page.tsx', 'docs/guide.md', 'docs/architecture/web.md', '.env.example', {
  ...file('.env'), kind: 'secret', included: false, reason: 'secret',
});

test('a path in backticks that is not in the census is found; one that is, a folder, and a relative one are not', () => {
  const text = [
    '# Guide',
    '',
    'Look at `src/app.ts`, at `src/` and at `src` and `apps/web/app/orders/[id]/page.tsx`.',
    'Also `../src/app.ts` and `./app.ts` from here, and `src/gone.ts`, and the folder `src/olddir/`.',
  ].join('\n');
  const found = docCitesMissing({ docs: [doc('docs/guide.md', text)], census: PATH_CENSUS });
  assert.deepEqual(found.map((f) => f.what.params.name), ['src/gone.ts', 'src/olddir/']);
  assert.equal(found[0].target.line, 4);
  assert.deepEqual(found[0].what.params, { name: 'src/gone.ts', kind: 'path', doc: 'docs/guide.md' });
  assert.deepEqual(found[0].evidence, [{ file: 'docs/guide.md', line: 4, sha: 'sha-docs/guide.md' }]);
});

test('deleting a file turns the citation into a finding', () => {
  const docs = [doc('docs/guide.md', 'See `src/app.ts`.\n')];
  assert.deepEqual(docCitesMissing({ docs, census: censusOf('src/app.ts', 'docs/guide.md') }), []);
  assert.equal(docCitesMissing({ docs, census: censusOf('docs/guide.md') }).length, 1);
});

test('URLs, ~/, absolute paths, patterns, commands, output blocks and secrets are not paths to check', () => {
  const text = [
    'Open `https://example.org/a/b.html`, `~/notes/a.md`, `/etc/hosts`, `/v1/orders`, `src/*.ts`, `src/<name>.ts`, `src/{a,b}.ts`.',
    'Run `pnpm --filter api dev/x.ts` and `and/or` and `read/write` and `v1.2/foo`.',
    'Values live in `.env`, `.env.local` and `config/.env.production`; build goes to `dist/app.js` and `node_modules/x/index.js`.',
    '',
    '```text',
    'src/from-output.ts',
    '```',
    '',
    '`src/inline-ok-to-find.ts`',
  ].join('\n');
  const found = docCitesMissing({ docs: [doc('docs/guide.md', text)], census: PATH_CENSUS });
  assert.deepEqual(found.map((f) => f.what.params.name), ['src/inline-ok-to-find.ts']);
});

test('names under an "example" heading are not checked, and the exception ends with that section', () => {
  const text = [
    '# Guide', '', '## Example', '', 'Put it in `src/example-only.ts`.', '', '### Deeper', '', '`src/also-example.ts`', '',
    '## Real', '', '`src/real-gone.ts`', '', '## Exemplos', '', '`src/exemplo.ts`',
  ].join('\n');
  const found = docCitesMissing({ docs: [doc('docs/guide.md', text)], census: PATH_CENSUS });
  assert.deepEqual(found.map((f) => f.what.params.name), ['src/real-gone.ts']);
});

test('history documents (changelog, plans) may cite paths that are gone', () => {
  const docs = [doc('CHANGELOG.md', '- removed `src/old.ts`\n'), doc('.dev/plano/x.md', '`src/old.ts`\n'), doc('docs/guide.md', '`src/old.ts`\n')];
  const found = docCitesMissing({ docs, census: censusOf('docs/guide.md') });
  assert.deepEqual(found.map((f) => f.target.file), ['docs/guide.md']);
});

test('a pointer (path#Symbol) is left to pointer-broken, and the anchor of a document path is not part of the path', () => {
  const docs = [doc('docs/guide.md', '`src/gone.ts#start` and `docs/architecture/web.md#intro` and `docs/architecture/missing.md#intro`\n')];
  const found = docCitesMissing({ docs, census: PATH_CENSUS });
  assert.deepEqual(found.map((f) => f.what.params.name), ['docs/architecture/missing.md']);
});

test('a path with a line suffix is checked without it', () => {
  const found = docCitesMissing({ docs: [doc('docs/guide.md', '`src/app.ts:12` and `src/gone.ts:3-9`\n')], census: PATH_CENSUS });
  assert.deepEqual(found.map((f) => f.what.params.name), ['src/gone.ts']);
});

test('no census means no path is checked', () => {
  assert.deepEqual(docCitesMissing({ docs: [doc('docs/guide.md', '`src/gone.ts`\n')], census: null }), []);
  assert.deepEqual(docCitesMissing({ docs: null, census: PATH_CENSUS }), []);
  assert.deepEqual(docCitesMissing(null), []);
});

// ---------- doc-cites-missing: variables ----------

test('an UPPER_CASE name under a configuration heading that is not an env fact is found; known ones and other sections are not', () => {
  const text = [
    '# Shop', '', '## Overview', '', 'It uses `HTTP` and `ORPHAN_NAME` here.', '',
    '## Environment variables', '', '| Name | What |', '|---|---|', '| `PORT` | port |', '| `GONE_URL` | removed |', '| `lower_case` | no |', '| `DB` | short |', '',
    '### Per app', '', '`OTHER_GONE`', '',
    '## Configuração', '', '`GONE_PT`', '',
    '## Testing', '', '`NOT_CONFIG`',
  ].join('\n');
  const found = docCitesMissing({ docs: [doc('README.md', text)], facts: factsOf([envFact('PORT'), route('GET', '/x')]) });
  assert.deepEqual(found.map((f) => [f.what.params.name, f.what.params.kind, f.target.line]), [
    ['GONE_URL', 'env', 12], ['OTHER_GONE', 'env', 18], ['GONE_PT', 'env', 22],
  ]);
});

test('no env facts at all means no variable is accused', () => {
  const text = '## Environment variables\n\n`GONE_URL`\n';
  assert.deepEqual(docCitesMissing({ docs: [doc('README.md', text)], facts: factsOf([route('GET', '/x')]) }), []);
});

// ---------- pointer-broken ----------

const CODE = 'export function start() {}\nexport class Shop { open() {} }\n';
const readCode = (files) => (p) => (p in files ? files[p] : null);

test('a pointer to a symbol that was renamed, and one to a deleted file, are found; a live one is not', () => {
  const docs = [doc('docs/guide.md', 'Ok `src/app.ts#start`, `src/app.ts#Shop.open`.\nRenamed `src/app.ts#boot`.\nGone `src/gone.ts#start`.\nA section `docs/guide.md#intro`.\n')];
  const found = pointerBroken({ docs, census: censusOf('src/app.ts', 'docs/guide.md'), facts: factsOf([]), readCode: readCode({ 'src/app.ts': CODE }) });
  assert.deepEqual(found.map((f) => [f.what.params.pointer, f.what.params.why, f.target.line]), [
    ['src/app.ts#boot', 'symbol-missing', 2], ['src/gone.ts#start', 'path-missing', 3],
  ]);
  assert.equal(found[0].rule, 'pointer-broken');
  assert.equal(found[0].what.msg, 'watch.pointer-broken.what');
  assert.equal(found[0].severity, 'important');
  assert.equal(found[0].evidence[0].file, 'docs/guide.md');
  assert.equal(found[0].evidence[0].sha, 'sha-docs/guide.md');
});

test('the id of a pointer finding keeps when the document line moves, and the pointer is the identity', () => {
  const run = (text) => pointerBroken({ docs: [doc('docs/guide.md', text)], census: censusOf('src/app.ts'), readCode: readCode({ 'src/app.ts': CODE }) });
  const [a] = run('`src/app.ts#boot`');
  const [b] = run('x\n\ny\n\n`src/app.ts#boot`');
  assert.equal(a.id, b.id);
  const [c] = run('`src/app.ts#bootX`');
  assert.notEqual(a.id, c.id);
});

test('without a code reader only the facts are consulted, and a file the readers say nothing about is not accused', () => {
  const facts = factsOf([{ id: 'fn:src/app.ts#start', kind: 'function', name: 'start', file: 'src/app.ts', line: 1, sha: 'x', origin: 'EXTRACTED', attrs: {}, refs: [] }]);
  const census = censusOf('src/app.ts', 'src/routes.ts');
  const docs = [doc('docs/guide.md', '`src/app.ts#start` `src/app.ts#boot` `src/routes.ts#anything` `src/gone.ts#x`\n')];
  const found = pointerBroken({ docs, census, facts });
  assert.deepEqual(found.map((f) => [f.what.params.pointer, f.what.params.why]), [['src/app.ts#boot', 'symbol-missing'], ['src/gone.ts#x', 'path-missing']]);
});

test('the default reader reads from root, never a secret file, and never outside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-cites-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), CODE);
    writeFileSync(join(root, '.env.ts'), 'export const SECRET = 1;\n');
    const docs = [doc('docs/guide.md', '`src/app.ts#start` `src/app.ts#boot` `.env.ts#SECRET` `.env.ts#GONE` `../x/app.ts#start`\n')];
    const found = pointerBroken({ docs, root, census: censusOf('src/app.ts') });
    assert.deepEqual(found.map((f) => f.what.params.pointer), ['src/app.ts#boot']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pointer-broken needs documents; nothing else', () => {
  assert.deepEqual(pointerBroken({ docs: null }), []);
  assert.deepEqual(pointerBroken(null), []);
});

// ---------- code-without-doc ----------

const sfact = (id, kind, file, line, extra = {}) => ({ id, kind, name: id.split(':').slice(1).join(':'), file, line, sha: 'f1', origin: 'EXTRACTED', attrs: {}, refs: [], ...extra });
const GAP_FACTS = factsOf([
  route('GET', '/v1/orders'),
  route('POST', '/v1/orders'),
  route('PUT', '/v1/orders/:id/note', { line: 4 }),
  route('DELETE', '/v1/orders/:id', { line: 5 }),
  route('GET', '/health', { file: 'apps/web/health.ts' }),
  sfact('screen:web:/cart', 'screen', 'apps/web/app/cart/page.tsx', 1, { attrs: { route: '/cart', framework: 'next-app' } }),
  sfact('table:Customer', 'table', 'packages/db/schema.prisma', 3, { attrs: { source: 'prisma' } }),
  sfact('table:Tag', 'table', 'packages/db/schema.prisma', 30, { attrs: { source: 'prisma' } }),
  sfact('queue:emails', 'queue', 'apps/worker/queues.ts', 4, { attrs: { lib: 'bullmq' } }),
  sfact('integration:stripe', 'integration', 'packages/adapters/pay.ts', 1, { attrs: { via: 'sdk', package: 'stripe' } }),
  sfact('integration:api.mailer.example', 'integration', 'packages/adapters/mail.ts', 2, { attrs: { via: 'url', host: 'api.mailer.example' } }),
  sfact('env:PORT', 'env', 'apps/api/config.ts', 1),
  sfact('function:x', 'function', 'apps/api/x.ts', 1),
]);

test('a fact no document names becomes one finding per source file, with the count and three names', () => {
  const docs = [doc('docs/architecture/orders.md', 'Rules: `GET /v1/orders` and `POST /v1/orders`.\n')];
  const found = codeWithoutDoc({ docs, facts: GAP_FACTS, census: censusOf() });
  const orders = found.find((f) => f.target.file === 'apps/api/src/orders.ts');
  assert.ok(orders);
  assert.equal(orders.rule, 'code-without-doc');
  assert.equal(orders.what.params.count, 2);
  assert.deepEqual(orders.what.params.names, ['PUT /v1/orders/:id/note', 'DELETE /v1/orders/:id']);
  assert.equal(orders.what.params.file, 'apps/api/src/orders.ts');
  assert.equal(orders.what.params.kind, 'route');
  assert.deepEqual(orders.evidence.map((e) => e.factId), ['route:PUT /v1/orders/:id/note', 'route:DELETE /v1/orders/:id']);
  assert.equal(orders.severity, 'detail');
  assert.equal(orders.what.msg, 'watch.code-without-doc.what');
  assert.equal(new Set(found.map((f) => f.target.file)).size, found.length);
});

test('a file with more than three undocumented facts lists three names and the full count', () => {
  const facts = factsOf(['a', 'b', 'c', 'd', 'e'].map((x, i) => route('GET', `/${x}`, { file: 'apps/api/many.ts', line: i + 1 })));
  const [f] = codeWithoutDoc({ docs: [doc('README.md', 'nothing\n')], facts });
  assert.equal(f.what.params.count, 5);
  assert.deepEqual(f.what.params.names, ['GET /a', 'GET /b', 'GET /c']);
  assert.equal(f.evidence.length, 3);
});

test('what counts as naming a fact: routes, screens, tables, queues and integrations', () => {
  const docs = [
    doc('README.md', 'The `emails` queue. Pay with Stripe. The `/cart` page. `GET /health` is up.\n'),
    doc('docs/architecture/db.md', 'Tables: `Customer`.\n'),
  ];
  const found = codeWithoutDoc({ docs, facts: GAP_FACTS });
  // Customer, emails, stripe, /cart and GET /health are named. Tag (prose "tags" is not a table name), the mailer host and the orders routes are not.
  const view = Object.fromEntries(found.map((f) => [f.target.file, f.what.params.count]));
  assert.deepEqual(view, { 'apps/api/src/orders.ts': 4, 'packages/db/schema.prisma': 1, 'packages/adapters/mail.ts': 1 });
  assert.deepEqual(found.find((f) => f.target.file === 'packages/db/schema.prisma').what.params.names, ['Tag']);
  assert.equal(found.find((f) => f.target.file === 'packages/adapters/mail.ts').what.params.kind, 'integration');
});

test('a table named only in prose as a lower-case plural is not named; the exact word is', () => {
  const facts = factsOf([sfact('table:Tag', 'table', 'db.prisma', 1), sfact('table:Order', 'table', 'db.prisma', 5)]);
  const none = codeWithoutDoc({ docs: [doc('README.md', 'an order can carry many tags\n')], facts });
  assert.equal(none[0].what.params.count, 2);
  const word = codeWithoutDoc({ docs: [doc('README.md', 'Each Order has Tags in `tag`.\n')], facts });
  assert.deepEqual(word, []);
});

test('AMBIGUOUS facts are not accused', () => {
  const facts = factsOf([
    route('GET', null, { id: 'route:GET ?X', origin: 'AMBIGUOUS', attrs: { method: 'GET', path: null } }),
    route('GET', '/twice', { origin: 'AMBIGUOUS', refs: [{ file: 'b.ts', line: 2 }] }),
    sfact('table:Twice', 'table', 'db.prisma', 1, { origin: 'AMBIGUOUS' }),
  ]);
  assert.deepEqual(codeWithoutDoc({ docs: [doc('README.md', 'x\n')], facts }), []);
});

test('a fact born after the previous round is important; old ones are detail', () => {
  const facts = factsOf([route('GET', '/a', { file: 'a.ts' }), route('GET', '/b', { file: 'b.ts' }), route('GET', '/c', { file: 'c.ts' })]);
  const found = codeWithoutDoc({ docs: [doc('README.md', 'x\n')], facts, prevFactIds: ['route:GET /a', 'route:GET /b'] });
  const by = Object.fromEntries(found.map((f) => [f.target.file, f.severity]));
  assert.deepEqual(by, { 'a.ts': 'detail', 'b.ts': 'detail', 'c.ts': 'important' });
  const first = codeWithoutDoc({ docs: [doc('README.md', 'x\n')], facts });
  assert.ok(first.every((f) => f.severity === 'detail'), 'no previous round known: nothing is new');
  const asSet = codeWithoutDoc({ docs: [doc('README.md', 'x\n')], facts, prevFactIds: new Set(['route:GET /a']) });
  assert.equal(asSet.find((f) => f.target.file === 'b.ts').severity, 'important');
});

test('the id of a code-without-doc finding is the source file, so it survives new facts in the file', () => {
  const docs = [doc('README.md', 'x\n')];
  const [a] = codeWithoutDoc({ docs, facts: factsOf([route('GET', '/a', { file: 'a.ts' })]) });
  const [b] = codeWithoutDoc({ docs, facts: factsOf([route('GET', '/a', { file: 'a.ts' }), route('GET', '/z', { file: 'a.ts' })]) });
  assert.equal(a.id, b.id);
});

test('"/" as a route or screen is named only when written on its own in backticks or with its method', () => {
  const facts = factsOf([sfact('screen:web:/', 'screen', 'app/page.tsx', 1, { attrs: { route: '/', framework: 'next-app' } }), route('GET', '/', { file: 'srv.ts' })]);
  const prose = codeWithoutDoc({ docs: [doc('README.md', 'See the paths a/b and c / d.\n')], facts });
  assert.equal(prose.length, 2);
  const named = codeWithoutDoc({ docs: [doc('README.md', '`/` is the home page and `GET /` answers.\n')], facts });
  assert.deepEqual(named, []);
});

test('facts or documents missing give nothing', () => {
  assert.deepEqual(codeWithoutDoc({ docs: [doc('README.md', 'x')], facts: null }), []);
  assert.deepEqual(codeWithoutDoc({ docs: null, facts: GAP_FACTS }), []);
  assert.deepEqual(codeWithoutDoc(null), []);
});

// ---------- owner-missing ----------

test('files without a part are grouped by first-level folder inside their container', () => {
  const rows = [
    file('package.json', { owner: null, kind: 'code', type: 'json' }),
    file('LICENSE', { owner: null, type: 'other' }),
    file('apps/api/package.json', { owner: 'orders', type: 'json' }),
    file('apps/api/src/a.ts', { owner: 'orders' }),
    file('apps/admin/package.json', { owner: null, type: 'json' }),
    file('apps/admin/pages/dashboard.tsx', { owner: null }),
    file('apps/admin/pages/api/users.ts', { owner: null }),
    file('apps/admin/lib/db.ts', { owner: null }),
    file('apps/admin/docs/x.md', { owner: null, kind: 'doc', type: 'md' }),
    file('apps/admin/dist/x.js', { owner: null, included: false, reason: 'generated', kind: 'generated' }),
    file('apps/api/src/b.ts', { owner: null }),
    file('scripts/tool.mjs', { owner: null }),
    file('tools/sub/a.mjs', { owner: null }),
    file('tools/sub/b.mjs', { owner: null }),
  ];
  const census = censusOf(...rows);
  const found = ownerMissing({ census });
  const view = found.map((f) => [f.what.params.folder, f.what.params.count]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(view, [['apps/admin/lib', 1], ['apps/admin/pages', 2], ['apps/api/src', 1], ['scripts', 1], ['tools', 2]]);
  const pages = found.find((f) => f.what.params.folder === 'apps/admin/pages');
  assert.equal(pages.rule, 'owner-missing');
  assert.equal(pages.what.msg, 'watch.owner-missing.what');
  assert.equal(pages.target.file, 'apps/admin/pages');
  assert.equal(pages.severity, 'important');
  assert.deepEqual(pages.evidence.map((e) => e.file), ['apps/admin/pages/api/users.ts', 'apps/admin/pages/dashboard.tsx']);
  assert.equal(pages.evidence[0].sha, 'sha-apps/admin/pages/api/users.ts');
  assert.match(pages.id, /^f:[0-9a-f]{12}$/);
});

test('the container comes from the model when there is one', () => {
  const model = { nodes: [{ id: 'ctr:services/billing', level: 2, kind: 'container', files: ['services/billing/'] }] };
  const census = censusOf(file('services/billing/api/x.ts', { owner: null }), file('services/billing/api/y.ts', { owner: null }), file('services/billing/jobs/z.ts', { owner: null }));
  const found = ownerMissing({ census, model });
  assert.deepEqual(found.map((f) => [f.what.params.folder, f.what.params.count]).sort(), [['services/billing/api', 2], ['services/billing/jobs', 1]]);
});

test('a project with no container gets the first folder of the path', () => {
  const census = censusOf(file('src/a/x.ts', { owner: null }), file('src/b/y.ts', { owner: null }), file('README.md', { owner: null, kind: 'doc', type: 'md' }));
  const found = ownerMissing({ census });
  assert.deepEqual(found.map((f) => [f.what.params.folder, f.what.params.count]), [['src', 2]]);
});

test('everything owned gives nothing; no census gives nothing', () => {
  assert.deepEqual(ownerMissing({ census: censusOf('a/b.ts') }), []);
  assert.deepEqual(ownerMissing({ census: null }), []);
  assert.deepEqual(ownerMissing(null), []);
});

// ---------- all together, on the fixture ----------

test('citeRules joins the four rules', () => {
  const found = citeRules({
    docs: [doc('docs/guide.md', '`src/gone.ts` and `GET /orders` and `src/app.ts#boot`\n')],
    census: censusOf('src/app.ts', 'docs/guide.md', file('lib/x.ts', { owner: null })),
    facts: factsOf([route('GET', '/purchases', { file: 'src/app.ts' })]),
    readCode: readCode({ 'src/app.ts': CODE }),
  });
  assert.deepEqual([...new Set(found.map((f) => f.rule))].sort(), ['code-without-doc', 'doc-cites-missing', 'owner-missing', 'pointer-broken']);
  assert.deepEqual(citeRules(null), []);
});

test('on the acme-shop fixture: the stale citation, the gaps and the unowned folders match the answer file', () => {
  const dir = new URL('./fixtures/repos/', import.meta.url);
  const answer = JSON.parse(readFileSync(new URL('acme-shop.answer.json', dir), 'utf8'));
  const base = new URL('acme-shop/', dir);
  const mds = ['README.md', 'docs/architecture/README.md', 'docs/architecture/web.md', 'docs/architecture/orders.md', 'docs/architecture/db.md', 'docs/architecture/worker.md'];
  const docs = mds.map((p) => doc(p, readFileSync(new URL(p, base), 'utf8')));
  const facts = factsOf(answer.facts.map((f) => ({ ...f, name: f.name ?? f.id.split(':').slice(1).join(':'), sha: 'f', refs: f.refs ?? [] })));
  const census = censusOf(...Object.entries(answer.owners).map(([path, owner]) => file(path, path.endsWith('.md') ? { owner, kind: 'doc', type: 'md' } : { owner })));

  const cites = docCitesMissing({ docs, facts, census });
  assert.deepEqual(cites.map((f) => [f.target.file, f.what.params.name]), [['docs/architecture/orders.md', 'DELETE /v1/orders/:id']]);

  // The answer file counts a thing as cited only when an architecture document names it, so the README is left out here.
  const gaps = codeWithoutDoc({ docs: docs.filter((d) => d.path.startsWith('docs/architecture/')), facts, census });
  const asked = new Set(['route', 'screen', 'table']);
  const expected = answer.gaps.filter((g) => asked.has(g.kind) && g.reason === 'not-cited' && !/\?/.test(g.id)).map((g) => g.id).sort();
  const got = gaps.flatMap((f) => f.evidence.map((e) => e.factId)).filter((id) => asked.has(id.split(':')[0])).sort();
  assert.deepEqual(got, expected);

  const owners = ownerMissing({ census });
  const expectedFolders = answer.gaps.filter((g) => g.reason === 'no-owner').map((g) => g.file.replace(/\/$/, ''));
  assert.ok(owners.length >= 1);
  assert.ok(owners.every((f) => expectedFolders.some((e) => f.what.params.folder === e || f.what.params.folder.startsWith(`${e}/`))), JSON.stringify(owners.map((f) => f.what.params.folder)));
  assert.equal(owners.reduce((n, f) => n + f.what.params.count, 0), 2, 'the two code files of the admin app; its package.json is a manifest');
});
