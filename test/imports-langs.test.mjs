import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linksOf, resolveSpec, specifiersIn } from '../server/imports.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const lineSpecs = (text, path) => specifiersIn(text, path).map((s) => `${s.line}:${s.spec}`);

test('Dart: import, export and part with package: or relative names; comments and strings are not imports', () => {
  const text = [
    "import 'dart:async';",
    "import 'package:acme_customer/screens/home_screen.dart';",
    "import 'package:http/http.dart' as http;",
    "import '../api.dart' show fetchOrders;",
    "export 'src/all.dart' hide Secret;",
    "part 'order.g.dart';",
    "import 'cond_stub.dart'",
    "    if (dart.library.io) 'cond_io.dart';",
    "// import 'package:nope/commented.dart';",
    "/* import 'package:nope/block.dart'; */",
    'const doc = "import \'package:nope/string.dart\';";',
  ].join('\n');
  assert.deepEqual(lineSpecs(text, 'lib/a.dart'), [
    '1:dart:async', '2:package:acme_customer/screens/home_screen.dart', '3:package:http/http.dart', '4:../api.dart',
    '5:src/all.dart', '6:order.g.dart', '7:cond_stub.dart', '8:cond_io.dart',
  ]);
});

test('PHP: use (plain, aliased, grouped, several), require and include; closures, traits (no namespace), comments and heredocs are not imports', () => {
  const text = [
    '<?php',
    'namespace App\\Http;',
    'use App\\Models\\Order;',
    'use \\Illuminate\\Support\\Facades\\Route as R;',
    'use App\\Jobs\\{SendReceipt, Mail\\Receipt as Rc};',
    'use function App\\helpers\\money;',
    'use const App\\LIMIT;',
    '# use App\\Models\\Hidden;',
    '// use App\\Models\\Hidden2;',
    "require __DIR__ . '/auth.php';",
    "require_once('vendor/autoload.php');",
    "include dirname(__DIR__) . '/up.php';",
    '$x = <<<TXT',
    'use App\\Models\\InHeredoc;',
    'TXT;',
    'class A {',
    '    use HasFactory, Notifiable;',
    '    public function f() { return function () use ($x) { return $x; }; }',
    '}',
  ].join('\n');
  assert.deepEqual(lineSpecs(text, 'app/Http/A.php'), [
    '3:App\\Models\\Order', '4:Illuminate\\Support\\Facades\\Route', '5:App\\Jobs\\SendReceipt', '5:App\\Jobs\\Mail\\Receipt',
    '10:./auth.php', '11:vendor/autoload.php', '12:../up.php',
  ]);
});

test('Dart names resolve: package:<pubspec name>/ to that pubspec lib/, a relative path to its file, dart: and outside packages to nothing', () => {
  const files = new Set(['apps/customer/lib/main.dart', 'apps/customer/lib/screens/home_screen.dart', 'apps/customer/lib/api.dart', 'packages/core/lib/core.dart']);
  const ctx = { dart: [{ dir: 'apps/customer', name: 'acme_customer' }, { dir: 'packages/core', name: 'core' }], php: [] };
  const from = 'apps/customer/lib/main.dart';
  assert.equal(resolveSpec(from, 'package:acme_customer/screens/home_screen.dart', files, ctx), 'apps/customer/lib/screens/home_screen.dart');
  assert.equal(resolveSpec(from, 'package:core/core.dart', files, ctx), 'packages/core/lib/core.dart', 'a sibling package of the repository');
  assert.equal(resolveSpec(from, 'api.dart', files, ctx), 'apps/customer/lib/api.dart', 'relative without ./');
  assert.equal(resolveSpec('apps/customer/lib/screens/home_screen.dart', '../api.dart', files, ctx), 'apps/customer/lib/api.dart');
  assert.equal(resolveSpec(from, 'package:http/http.dart', files, ctx), null);
  assert.equal(resolveSpec(from, 'dart:async', files, ctx), null);
  assert.equal(resolveSpec(from, 'package:acme_customer/missing.dart', files, ctx), null);
});

test('PHP names resolve by the nearest composer.json psr-4; a vendor namespace resolves to nothing; require paths are relative', () => {
  const files = new Set(['backend/app/Models/Order.php', 'backend/routes/api.php', 'backend/routes/auth.php', 'backend/tests/Unit/OrderTest.php']);
  const ctx = { dart: [], php: [{ dir: 'backend', psr4: [{ prefix: 'App\\', dir: 'app' }, { prefix: 'Tests\\', dir: 'tests' }] }] };
  assert.equal(resolveSpec('backend/routes/api.php', 'App\\Models\\Order', files, ctx), 'backend/app/Models/Order.php');
  assert.equal(resolveSpec('backend/routes/api.php', 'Tests\\Unit\\OrderTest', files, ctx), 'backend/tests/Unit/OrderTest.php');
  assert.equal(resolveSpec('backend/routes/api.php', 'Illuminate\\Support\\Facades\\Route', files, ctx), null);
  assert.equal(resolveSpec('backend/routes/api.php', 'App\\Models\\Missing', files, ctx), null);
  assert.equal(resolveSpec('backend/routes/api.php', 'HasFactory', files, ctx), null);
  assert.equal(resolveSpec('backend/routes/api.php', './auth.php', files, ctx), 'backend/routes/auth.php');
});

test('acme-delivery: every Dart and PHP import in the answer sheet is a link, on its line, and the outside packages are libraries', async () => {
  const answer = JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-delivery.answer.json'), 'utf8'));
  const imports = [...answer.facts, ...(answer.extraFacts ?? [])].filter((f) => f.kind === 'import');
  assert.ok(imports.length >= 10, 'the answer sheet has the imports');
  const root = copyFixtureRepo('acme-delivery');
  try {
    for (const f of imports) {
      const to = f.id.split('->')[1];
      const { graph, uses } = await linksOf(root, f.file);
      assert.equal(graph, true, f.file);
      assert.ok(uses.some((u) => u.path === to && u.line === f.line), `${f.id} at line ${f.line}`);
    }
    const main = await linksOf(root, 'apps/customer/lib/main.dart');
    assert.deepEqual(main.uses.map((u) => u.path), ['apps/customer/lib/screens/home_screen.dart', 'apps/customer/lib/screens/order_screen.dart']);
    assert.deepEqual(main.libraries, ['flutter', 'go_router']);
    assert.deepEqual((await linksOf(root, 'apps/customer/lib/api.dart')).libraries, ['dio', 'http']);
    const order = await linksOf(root, 'backend/app/Models/Order.php');
    assert.deepEqual(order.usedBy.map((u) => u.path), ['backend/app/Http/Controllers/OrderController.php', 'backend/app/Jobs/SendReceipt.php', 'backend/routes/api.php']);
    assert.deepEqual((await linksOf(root, 'backend/routes/api.php')).libraries, ['Illuminate']);
    const price = await linksOf(root, 'apps/customer/lib/widgets/price_tag.dart');
    assert.deepEqual(price.usedBy.map((u) => u.path), ['apps/customer/lib/screens/home_screen.dart', 'apps/customer/lib/screens/order_screen.dart']);
  } finally {
    removeFixtureRepo(root);
  }
});

test('JavaScript links keep working and a language still unknown has no graph', async () => {
  assert.deepEqual(lineSpecs("import a from './a.js';", 'x.js'), ['1:./a.js']);
  const root = copyFixtureRepo('acme-delivery');
  try {
    assert.deepEqual(await linksOf(root, 'README.md'), { graph: false, uses: [], usedBy: [], libraries: [] });
    assert.equal((await linksOf(root, 'backend/routes/web.php')).graph, true);
  } finally {
    removeFixtureRepo(root);
  }
});
