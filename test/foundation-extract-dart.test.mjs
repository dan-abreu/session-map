import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../server/foundation/lex.mjs';
import { extract, resolveDartHints, VERSION, TYPES } from '../server/foundation/extract/dart.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repos');
const answer = JSON.parse(readFileSync(join(root, 'acme-delivery.answer.json'), 'utf8'));
const WS = { dir: 'apps/customer', name: 'acme_customer' };

function run(path, text, workspace = WS) {
  const type = path.endsWith('.dart') ? 'dart' : 'yaml';
  return extract({ path, type, text, masked: lex(text, type).masked, workspace, files: [] });
}

// Runs several files like the index does and resolves the cross-file hints.
function runAll(files, workspace = WS) {
  const facts = [];
  const hints = [];
  for (const [path, text] of Object.entries(files)) {
    const r = run(path, text, workspace);
    facts.push(...r.facts);
    hints.push(...r.hints);
  }
  return resolveDartHints(facts, hints);
}

const brief = (facts) => facts.map((f) => ({ id: f.id, kind: f.kind, file: f.file, line: f.line, origin: f.origin }));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('declares its version and the dart and yaml types', () => {
  assert.equal(VERSION, 'dart@1');
  assert.deepEqual(TYPES, ['dart', 'yaml']);
});

test('acme-delivery customer app gives exactly the answer-key screens, integrations and variable', () => {
  const app = join(root, 'acme-delivery', 'apps', 'customer');
  const files = {};
  for (const p of walk(app)) {
    const rel = `apps/customer/${p.slice(app.length + 1).replace(/\\/g, '/')}`;
    if (rel.endsWith('.dart') || rel.endsWith('pubspec.yaml')) files[rel] = readFileSync(p, 'utf8');
  }
  const got = runAll(files);
  const want = answer.facts.filter((f) => f.file.startsWith('apps/customer/') && ['screen', 'integration', 'env'].includes(f.kind));
  assert.equal(want.length, 5);
  assert.deepEqual(brief(got).sort(byId), brief(want).sort(byId));
  for (const w of want) {
    const g = got.find((f) => f.id === w.id);
    for (const [k, v] of Object.entries(w.attrs)) assert.equal(g.attrs[k], v, `${w.id} attrs.${k}`);
  }
  assert.ok(!got.some((f) => /price_tag/.test(f.file)), 'a plain widget is not a screen');
  for (const t of answer.traps.filter((x) => x.file.startsWith('apps/customer/'))) {
    assert.ok(!got.some((f) => f.file === t.file && f.line === t.line), `trap at ${t.file}:${t.line} stays out`);
  }
});

test('a widget named like a screen or inside screens/ is an INFERRED screen with no route', () => {
  const got = runAll({
    'apps/customer/lib/a/cart_page.dart': 'class CartPage extends StatelessWidget {}\n',
    'apps/customer/lib/screens/profile.dart': 'import "x";\n\nclass Profile extends StatefulWidget {}\n',
    'apps/customer/lib/b/feed_view.dart': 'class FeedView extends StatelessWidget {}\n',
  });
  assert.deepEqual(brief(got), [
    { id: 'screen:customer:CartPage', kind: 'screen', file: 'apps/customer/lib/a/cart_page.dart', line: 1, origin: 'INFERRED' },
    { id: 'screen:customer:Profile', kind: 'screen', file: 'apps/customer/lib/screens/profile.dart', line: 3, origin: 'INFERRED' },
    { id: 'screen:customer:FeedView', kind: 'screen', file: 'apps/customer/lib/b/feed_view.dart', line: 1, origin: 'INFERRED' },
  ]);
  assert.deepEqual(got[0].attrs, { framework: 'flutter', route: null, widget: 'CartPage' });
});

test('a common widget, a private one, an abstract one, a State and a class outside lib are not screens', () => {
  const got = runAll({
    'apps/customer/lib/widgets/badge.dart': 'class Badge extends StatelessWidget {}\n',
    'apps/customer/lib/x_screen.dart': 'class _HiddenScreen extends StatelessWidget {}\nabstract class BaseScreen extends StatelessWidget {}\n' +
      'class XScreenState extends State<XScreen> {}\n',
    'apps/customer/test/x_screen.dart': 'class TestScreen extends StatelessWidget {}\n',
    'apps/customer/bin/y_page.dart': 'class YPage extends StatelessWidget {}\n',
  });
  assert.deepEqual(got, []);
});

test('a class in a commented-out or quoted text is not read', () => {
  const got = runAll({
    'apps/customer/lib/a.dart': "// class GhostScreen extends StatelessWidget {}\nconst t = '''\nclass FakeScreen extends StatelessWidget {}\n''';\n",
  });
  assert.deepEqual(got, []);
});

test('GoRoute binds its path to the widget a builder names, wherever the widget lives', () => {
  const got = runAll({
    'apps/customer/lib/router.dart': "final r = GoRouter(routes: [\n  GoRoute(path: '/cart', builder: (c, s) => const Basket()),\n  GoRoute(\n    path: '/pay',\n    pageBuilder: (c, s) { return MaterialPage(child: Checkout(total: 1)); },\n  ),\n]);\n",
    'apps/customer/lib/ui/basket.dart': 'class Basket extends StatelessWidget {}\n',
    'apps/customer/lib/ui/checkout.dart': 'class Checkout extends StatefulWidget {}\n',
  });
  assert.deepEqual(brief(got).sort(byId), [
    { id: 'screen:customer:/cart', kind: 'screen', file: 'apps/customer/lib/ui/basket.dart', line: 1, origin: 'EXTRACTED' },
    { id: 'screen:customer:/pay', kind: 'screen', file: 'apps/customer/lib/ui/checkout.dart', line: 1, origin: 'EXTRACTED' },
  ]);
  assert.deepEqual(got.find((f) => f.id === 'screen:customer:/cart').attrs, { framework: 'flutter', route: '/cart', widget: 'Basket' });
});

test('a routed widget with a screen-like name loses its INFERRED twin: one screen per route', () => {
  const got = runAll({
    'apps/customer/lib/r.dart': "final r = GoRouter(routes: [GoRoute(path: '/', builder: (c, s) => HomeScreen())]);\n",
    'apps/customer/lib/home_screen.dart': 'class HomeScreen extends StatelessWidget {}\n',
  });
  assert.deepEqual(brief(got).map((f) => [f.id, f.origin]), [['screen:customer:/', 'EXTRACTED']]);
});

test('nested GoRoute paths are joined by the program (INFERRED); a dynamic path is AMBIGUOUS with route null', () => {
  const got = runAll({
    'apps/customer/lib/r.dart': "final r = GoRouter(routes: [\n  GoRoute(path: '/shop', builder: (c, s) => ShopScreen(), routes: [\n    GoRoute(path: 'item/:id', builder: (c, s) => ItemScreen()),\n  ]),\n  GoRoute(path: base + '/x', builder: (c, s) => OtherScreen()),\n]);\n",
    'apps/customer/lib/s.dart': 'class ShopScreen extends StatelessWidget {}\nclass ItemScreen extends StatelessWidget {}\nclass OtherScreen extends StatelessWidget {}\n',
  });
  const m = new Map(got.map((f) => [f.id, f]));
  assert.equal(m.get('screen:customer:/shop').origin, 'EXTRACTED');
  assert.equal(m.get('screen:customer:/shop/item/:id').origin, 'INFERRED');
  assert.equal(m.get('screen:customer:/shop/item/:id').attrs.widget, 'ItemScreen');
  assert.equal(m.get('screen:customer:OtherScreen').origin, 'AMBIGUOUS');
  assert.equal(m.get('screen:customer:OtherScreen').attrs.route, null);
  assert.equal(got.length, 3);
});

test('a routes map of MaterialApp binds each path to its widget', () => {
  const got = runAll({
    'apps/customer/lib/app.dart': "final app = MaterialApp(routes: {\n  '/': (context) => const Landing(),\n  '/about': (context) { return About(); },\n});\n",
    'apps/customer/lib/p.dart': 'class Landing extends StatelessWidget {}\nclass About extends StatelessWidget {}\n',
  });
  assert.deepEqual(brief(got).map((f) => [f.id, f.line, f.origin]).sort(), [
    ['screen:customer:/', 1, 'EXTRACTED'], ['screen:customer:/about', 2, 'EXTRACTED'],
  ]);
});

test('a route to a widget that is not in the project makes no screen; a name defined twice is AMBIGUOUS', () => {
  const got = runAll({
    'apps/customer/lib/r.dart': "final r = GoRouter(routes: [GoRoute(path: '/lib', builder: (c, s) => LibraryScreen()), GoRoute(path: '/d', builder: (c, s) => Dup())]);\n",
    'apps/customer/lib/a/dup.dart': 'class Dup extends StatelessWidget {}\n',
    'apps/customer/lib/b/dup.dart': 'class Dup extends StatelessWidget {}\n',
  });
  assert.deepEqual(got.map((f) => [f.id, f.file, f.origin]), [
    ['screen:customer:/d', 'apps/customer/lib/a/dup.dart', 'AMBIGUOUS'],
    ['screen:customer:/d', 'apps/customer/lib/b/dup.dart', 'AMBIGUOUS'],
  ]);
  assert.ok(got.every((f) => f.attrs.route === '/d'));
});

test('GoRoute in a comment or in a string makes no route', () => {
  const got = runAll({
    'apps/customer/lib/r.dart': "// GoRoute(path: '/old', builder: (c, s) => Basket())\nconst s = \"GoRoute(path: '/str', builder: (c, s) => Basket())\";\n",
    'apps/customer/lib/basket.dart': 'class Basket extends StatelessWidget {}\n',
  });
  assert.deepEqual(got, []);
});

test('integrations: Uri.parse, Uri.https, Dio calls and baseUrl give the host once, extra places go to refs', () => {
  const src = [
    "import 'package:dio/dio.dart';",
    "final a = Uri.parse('https://api.acme.example/v1/a');",
    "final b = Uri.https('Billing.Acme.Example', '/pay');",
    "final d = Dio(BaseOptions(baseUrl: 'https://cdn.acme.example'));",
    "Future<void> f(Dio dio) async { await dio.get('https://api.acme.example/v1/b'); }",
    "final loc = Uri.parse('http://localhost:3000/x'); final ip = Uri.parse('http://192.168.1.4/x');",
    "final dyn = Uri.parse(base + '/x'); final dyn2 = Uri.parse('https://api-$env.acme.example/x');",
    "final part = Uri.parse('https://store.acme.example/$id');",
    '',
  ].join('\n');
  const { facts } = run('apps/customer/lib/n.dart', src);
  const ints = facts.filter((f) => f.kind === 'integration');
  assert.deepEqual(ints.map((f) => [f.id, f.line]), [
    ['integration:api.acme.example', 2], ['integration:billing.acme.example', 3],
    ['integration:cdn.acme.example', 4], ['integration:store.acme.example', 8],
  ]);
  assert.deepEqual(ints[0].refs, [{ file: 'apps/customer/lib/n.dart', line: 5 }]);
  assert.deepEqual(ints[0].attrs, { via: 'url', host: 'api.acme.example' });
  assert.ok(ints.every((f) => f.origin === 'EXTRACTED'));
});

test('a .get call without dio in the file is not an integration', () => {
  const { facts } = run('apps/customer/lib/n.dart', "void f(Cache c) { c.get('https://x.acme.example/y'); }\n");
  assert.deepEqual(facts, []);
});

test('env: fromEnvironment, dotenv and Platform.environment give only the name; dynamic names give nothing', () => {
  const src = [
    "const a = String.fromEnvironment('API_KEY');",
    "const b = bool.fromEnvironment('FLAG', defaultValue: false);",
    "final c = dotenv.env['SENTRY_DSN'];",
    "final d = dotenv.get('MAPS_KEY'); final e = dotenv.maybeGet('OTHER');",
    "final f = Platform.environment['HOME_DIR']; final g = dotenv.env[name];",
    "final h = String.fromEnvironment('API_KEY');",
    "// String.fromEnvironment('GHOST')",
    '',
  ].join('\n');
  const { facts } = run('apps/customer/lib/e.dart', src);
  const envs = facts.filter((f) => f.kind === 'env');
  assert.deepEqual(envs.map((f) => [f.id, f.line]), [
    ['env:API_KEY', 1], ['env:FLAG', 2], ['env:SENTRY_DSN', 3], ['env:MAPS_KEY', 4], ['env:OTHER', 4], ['env:HOME_DIR', 5],
  ]);
  assert.deepEqual(envs[0].attrs, { source: 'code' });
  assert.deepEqual(envs[0].refs, [{ file: 'apps/customer/lib/e.dart', line: 6 }]);
});

test('pubspec: firebase_*, google_maps_flutter and sentry_flutter under dependencies are SDK integrations', () => {
  const src = [
    'name: acme_customer',
    'dependencies:',
    '  flutter:',
    '    sdk: flutter',
    '  http: ^1.2.0',
    '  firebase_core: ^3.0.0',
    '  firebase_auth: ^5.0.0',
    '  google_maps_flutter: ^2.6.0',
    '  # sentry_flutter: ^8.0.0',
    '  sentry_flutter: ^8.0.0',
    '',
    'dev_dependencies:',
    '  firebase_test: ^1.0.0',
    '',
  ].join('\n');
  const { facts } = run('apps/customer/pubspec.yaml', src);
  assert.deepEqual(facts.map((f) => [f.id, f.line, f.origin]), [
    ['integration:firebase_core', 6, 'EXTRACTED'], ['integration:firebase_auth', 7, 'EXTRACTED'],
    ['integration:google_maps_flutter', 8, 'EXTRACTED'], ['integration:sentry_flutter', 10, 'EXTRACTED'],
  ]);
  assert.deepEqual(facts[0].attrs, { via: 'sdk', package: 'firebase_core' });
  assert.equal(facts[0].file, 'apps/customer/pubspec.yaml');
});

test('any other yaml file gives nothing', () => {
  const { facts, hints } = run('apps/customer/.github/ci.yml', 'dependencies:\n  firebase_core: 1\n');
  assert.deepEqual({ facts, hints }, { facts: [], hints: [] });
});

test('every fact has the shape of the contract and the extractor version', () => {
  const { facts } = run('apps/customer/lib/s_screen.dart', "class SScreen extends StatelessWidget {}\nconst a = String.fromEnvironment('K');\n");
  assert.equal(facts.length, 2);
  for (const f of facts) {
    assert.deepEqual(Object.keys(f).sort(), ['attrs', 'extractor', 'file', 'id', 'kind', 'line', 'name', 'origin', 'refs']);
    assert.equal(f.extractor, 'dart@1');
    assert.equal(f.file, 'apps/customer/lib/s_screen.dart');
  }
});

test('resolveDartHints does not change what it was given', () => {
  const a = run('apps/customer/lib/r.dart', "final r = GoRouter(routes: [GoRoute(path: '/', builder: (c, s) => Basket())]);\n");
  const b = run('apps/customer/lib/basket.dart', 'class Basket extends StatelessWidget {}\n');
  const facts = [...a.facts, ...b.facts];
  const hints = [...a.hints, ...b.hints];
  const before = JSON.stringify({ facts, hints });
  resolveDartHints(facts, hints);
  assert.equal(JSON.stringify({ facts, hints }), before);
});

test('a project with no app folder names the app after the pubspec name', () => {
  const got = runAll({ 'lib/home_screen.dart': 'class HomeScreen extends StatelessWidget {}\n' }, { dir: '', name: 'acme_customer' });
  assert.equal(got[0].id, 'screen:acme_customer:HomeScreen');
});
