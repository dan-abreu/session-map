import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../server/foundation/lex.mjs';
import { extract, VERSION, TYPES } from '../server/foundation/extract/php.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOS = join(HERE, 'fixtures', 'repos');
const DELIVERY = join(REPOS, 'acme-delivery');
const answer = JSON.parse(readFileSync(join(REPOS, 'acme-delivery.answer.json'), 'utf8'));
const WS = { dir: 'backend', name: 'acme/delivery-backend' };

function run(text, path = 'backend/app/Thing.php', workspace = WS, type) {
  const t = type ?? (path.endsWith('.blade.php') ? 'blade' : 'php');
  return extract({ path, type: t, text, masked: lex(text, t).masked, workspace, files: [] });
}
const ids = (r) => r.facts.map((f) => f.id).sort();
const one = (r, id) => r.facts.find((f) => f.id === id);
const routes = (text, path = 'backend/routes/web.php') => ids(run(text, path)).filter((i) => i.startsWith('route:'));

const PHP_FILES = [
  'backend/routes/api.php', 'backend/routes/web.php', 'backend/app/Http/Controllers/OrderController.php',
  'backend/app/Jobs/SendReceipt.php', 'backend/app/Models/Order.php', 'backend/app/Models/OrderItem.php',
  'backend/config/services.php', 'backend/database/migrations/2024_01_01_000000_create_orders_table.php',
  'backend/database/migrations/2024_01_02_000000_create_order_items_table.php',
  'backend/resources/views/receipt.blade.php',
];
const KINDS = new Set(['route', 'screen', 'table', 'relation', 'queue', 'job', 'integration', 'env']);

function fixtureRun(path) {
  const text = readFileSync(join(DELIVERY, path), 'utf8');
  const type = path.endsWith('.blade.php') ? 'blade' : 'php';
  return extract({ path, type, text, masked: lex(text, type).masked, workspace: WS, files: PHP_FILES });
}
const nameOf = (id) => id.slice(id.indexOf(':') + 1);
// refs to other files are the index's join; columns are checked on their own
const shape = (f) => {
  const attrs = { ...f.attrs };
  if (f.kind === 'table') delete attrs.columns;
  return {
    id: f.id, kind: f.kind, name: f.name ?? nameOf(f.id), file: f.file, line: f.line, origin: f.origin, attrs,
    refs: (f.refs ?? []).filter((r) => r.file === f.file).map((r) => ({ file: r.file, line: r.line })),
  };
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function expectedFor(path) {
  return answer.facts.filter((f) => KINDS.has(f.kind) && f.file === path).map((f) => shape({ ...f, refs: f.refs ?? [] }));
}

test('declares its version and the php and blade types', () => {
  assert.equal(VERSION, 'php@1');
  assert.deepEqual(TYPES, ['php', 'blade']);
});

for (const path of PHP_FILES) {
  test(`acme-delivery ${path} gives exactly what the answer key lists for it`, () => {
    const { facts } = fixtureRun(path);
    assert.deepEqual(facts.map(shape).sort(byId), expectedFor(path).sort(byId));
  });
}

test('acme-delivery: every php fact of the key is found, in some file, and nothing else is invented', () => {
  // .env.example is the config extractor's file, and functions, calls and imports belong to other readers
  const want = answer.facts.filter((f) => KINDS.has(f.kind) && f.file.startsWith('backend/') && !f.file.endsWith('.env.example'));
  assert.ok(want.length >= 18);
  const got = PHP_FILES.flatMap((p) => fixtureRun(p).facts);
  for (const w of want) assert.ok(got.some((g) => g.id === w.id && g.line === w.line && g.file === w.file), `${w.id} not found`);
  assert.equal(got.length, want.length);
});

test('acme-delivery: no trap becomes a fact or a hint', () => {
  const traps = answer.traps.filter((t) => t.file.startsWith('backend/'));
  assert.equal(traps.length, 3);
  for (const trap of traps) {
    const { facts, hints } = fixtureRun(trap.file);
    for (const f of facts) {
      assert.notEqual(f.line, trap.line, `${f.id} sits on the trap ${trap.file}:${trap.line}`);
      for (const r of f.refs ?? []) assert.notEqual(r.line, trap.line);
    }
    for (const h of hints) assert.notEqual(h.line, trap.line);
  }
});

test('acme-delivery: the dispatch call leaves a hint for the index, the job file does not', () => {
  const { hints } = fixtureRun('backend/app/Http/Controllers/OrderController.php');
  assert.deepEqual(hints, [{ kind: 'job-dispatch', class: 'SendReceipt', fqcn: 'App\\Jobs\\SendReceipt', line: 18 }]);
  assert.deepEqual(fixtureRun('backend/app/Jobs/SendReceipt.php').hints, []);
});

test('acme-delivery: tables carry their columns with name, type and line', () => {
  const orders = fixtureRun('backend/database/migrations/2024_01_01_000000_create_orders_table.php').facts[0];
  assert.deepEqual(orders.attrs.columns, [
    { name: 'id', type: 'id', line: 12 }, { name: 'total_cents', type: 'unsignedInteger', line: 13 },
    { name: 'created_at', type: 'timestamps', line: 14 }, { name: 'updated_at', type: 'timestamps', line: 14 },
  ]);
  const items = fixtureRun('backend/database/migrations/2024_01_02_000000_create_order_items_table.php').facts[0];
  assert.deepEqual(items.attrs.columns.map((c) => c.name), ['id', 'order_id', 'name']);
});

// ---------- routes ----------

test('verbs, any, match and view; the file decides the /api prefix', () => {
  const src = "<?php\nRoute::get('/a', fn () => 1);\nRoute::any('/b', fn () => 1);\nRoute::match(['get', 'post'], '/c', fn () => 1);\nRoute::view('/d', 'welcome');\nRoute::delete('e', fn () => 1);\n";
  assert.deepEqual(routes(src), ['route:ANY /b', 'route:DELETE /e', 'route:GET /a', 'route:GET /c', 'route:GET /d', 'route:POST /c']);
  assert.equal(one(run(src, 'backend/routes/web.php'), 'route:GET /a').origin, 'EXTRACTED');
  const api = run(src, 'backend/routes/api.php');
  assert.ok(one(api, 'route:ANY /api/b'));
  assert.equal(one(api, 'route:GET /api/a').origin, 'INFERRED');
});

test('only routes/*.php files are read for routes', () => {
  assert.deepEqual(routes("<?php\nRoute::get('/a', fn () => 1);\n", 'backend/app/Http/Kernel.php'), []);
  assert.deepEqual(routes("<?php\nRoute::get('/a', fn () => 1);\n", 'backend/routes/console.php'), ['route:GET /a']);
});

test('prefix groups nest, in the chain and in the array form', () => {
  const src = [
    '<?php',
    "Route::prefix('v1')->group(function () {",
    "    Route::get('/a', fn () => 1);",
    "    Route::middleware('auth')->prefix('admin')->group(function () {",
    "        Route::post('/b', fn () => 1);",
    '    });',
    '});',
    "Route::group(['prefix' => 'old', 'middleware' => 'x'], function () {",
    "    Route::get('/c', fn () => 1);",
    '});',
    "Route::prefix('solo')->get('/d', fn () => 1);",
    "Route::get('/outside', fn () => 1);",
  ].join('\n');
  const r = run(src, 'backend/routes/web.php');
  assert.deepEqual(ids(r), ['route:GET /old/c', 'route:GET /outside', 'route:GET /solo/d', 'route:GET /v1/a', 'route:POST /v1/admin/b']);
  assert.equal(one(r, 'route:GET /v1/a').origin, 'INFERRED');
  assert.equal(one(r, 'route:GET /outside').origin, 'EXTRACTED');
  assert.equal(one(r, 'route:GET /v1/a').line, 3);
});

test('a route with a multi-line chain sits on the line where Route:: starts', () => {
  const r = run("<?php\n\nRoute::prefix('x')\n    ->middleware('auth')\n    ->get('/y', fn () => 1);\n", 'backend/routes/web.php');
  assert.equal(one(r, 'route:GET /x/y').line, 3);
});

test('a dynamic path or prefix is AMBIGUOUS with path null, never a guess', () => {
  const r = run("<?php\nRoute::get($path, fn () => 1);\n$p = 'v1';\nRoute::prefix($p)->group(function () {\n    Route::get('/in', fn () => 1);\n});\n", 'backend/routes/web.php');
  const amb = r.facts.filter((f) => f.origin === 'AMBIGUOUS');
  assert.equal(amb.length, 2);
  for (const f of amb) assert.equal(f.attrs.path, null);
  assert.ok(amb.every((f) => f.id.startsWith('route:GET ?')));
});

test('apiResource gives 5 routes, resource 7, with the singular parameter; only and except trim them', () => {
  const r = run("<?php\nRoute::apiResource('orders', OrderController::class);\nRoute::resource('categories', C::class)->only(['index', 'show']);\nRoute::apiResource('addresses', A::class)->except('destroy');\n", 'backend/routes/web.php');
  assert.deepEqual(ids(r), [
    'route:DELETE /orders/{order}', 'route:GET /addresses', 'route:GET /addresses/{address}', 'route:GET /categories',
    'route:GET /categories/{category}', 'route:GET /orders', 'route:GET /orders/{order}', 'route:POST /addresses',
    'route:POST /orders', 'route:PUT /addresses/{address}', 'route:PUT /orders/{order}',
  ]);
  assert.equal(one(r, 'route:PUT /orders/{order}').attrs.action, 'update');
  assert.equal(one(r, 'route:PUT /orders/{order}').origin, 'INFERRED');
  const full = run("<?php\nRoute::resource('photos', P::class);\n", 'backend/routes/web.php');
  assert.deepEqual(full.facts.map((f) => f.attrs.action).sort(), ['create', 'destroy', 'edit', 'index', 'show', 'store', 'update']);
  assert.ok(one(full, 'route:GET /photos/create') && one(full, 'route:GET /photos/{photo}/edit'));
});

test('nested resources and irregular plurals', () => {
  const r = run("<?php\nRoute::apiResource('orders.items', I::class);\nRoute::apiResource('people', P::class)->only('show');\nRoute::apiResource('order-lines', L::class)->only('show');\n", 'backend/routes/web.php');
  assert.ok(one(r, 'route:GET /orders/{order}/items'));
  assert.ok(one(r, 'route:GET /orders/{order}/items/{item}'));
  assert.ok(one(r, 'route:GET /people/{person}'));
  assert.ok(one(r, 'route:GET /order-lines/{order_line}'));
});

test('the resource parameter is the singular Laravel (Str::singular) gives, never a cut word', () => {
  const cases = {
    warehouses: 'warehouse', houses: 'house', causes: 'cause', heroes: 'hero', potatoes: 'potato', leaves: 'leaf',
    wolves: 'wolf', knives: 'knife', quizzes: 'quiz', statuses: 'status', buses: 'bus', analyses: 'analysis',
    crises: 'crisis', aliases: 'alias', matrices: 'matrix', indices: 'index', addresses: 'address', boxes: 'box',
    categories: 'category', taxes: 'tax', shoes: 'shoe', news: 'news', data: 'data', orders: 'order',
  };
  for (const [plural, single] of Object.entries(cases)) {
    const r = run(`<?php\nRoute::apiResource('${plural}', X::class)->only('show');\n`, 'backend/routes/web.php');
    assert.deepEqual(ids(r), [`route:GET /${plural}/{${single}}`], plural);
  }
});

test('apiResources and resources expand a literal array; any other argument is AMBIGUOUS', () => {
  const r = run("<?php\nRoute::apiResources(['orders' => O::class, 'users' => U::class]);\nRoute::resources(['photos' => P::class]);\n", 'backend/routes/web.php');
  const got = ids(r);
  assert.equal(got.length, 5 + 5 + 7);
  assert.ok(got.includes('route:DELETE /orders/{order}') && got.includes('route:GET /users/{user}') && got.includes('route:GET /photos/{photo}/edit'));
  assert.ok(r.facts.every((f) => f.origin === 'INFERRED' && f.line === (f.id.includes('photo') ? 3 : 2)));
  const dyn = run("<?php\nRoute::apiResources($map);\n", 'backend/routes/web.php');
  assert.ok(dyn.facts.length > 0);
  assert.ok(dyn.facts.every((f) => f.origin === 'AMBIGUOUS' && f.attrs.path === null));
});

test('the options array of resource / apiResource trims or blurs the routes like the chain does', () => {
  const only = run("<?php\nRoute::resource('photos', P::class, ['only' => ['index']]);\n", 'backend/routes/web.php');
  assert.deepEqual(ids(only), ['route:GET /photos']);
  const except = run("<?php\nRoute::resource('photos', P::class, ['except' => ['create', 'edit']]);\n", 'backend/routes/web.php');
  assert.deepEqual(ids(except), [
    'route:DELETE /photos/{photo}', 'route:GET /photos', 'route:GET /photos/{photo}', 'route:POST /photos', 'route:PUT /photos/{photo}',
  ]);
  assert.ok(except.facts.every((f) => f.origin === 'INFERRED'));
  const api = run("<?php\nRoute::apiResource('orders', O::class, array('except' => 'destroy', 'names' => 'o'));\n", 'backend/routes/web.php');
  assert.deepEqual(ids(api), ['route:GET /orders', 'route:GET /orders/{order}', 'route:POST /orders', 'route:PUT /orders/{order}']);
  for (const src of [
    "Route::resource('photos', P::class, ['parameters' => ['photos' => 'pic']]);",
    "Route::resource('photos', P::class, $options);",
    "Route::resource('photos', P::class, ['only' => $keep]);",
    "Route::resource('photos', P::class, [...$base, 'only' => ['index']]);",
    "Route::resource('photos', P::class)->scoped(['photo' => 'slug']);",
  ]) {
    const r = run(`<?php\n${src}\n`, 'backend/routes/web.php');
    assert.ok(r.facts.length > 0, src);
    assert.ok(r.facts.every((f) => f.origin === 'AMBIGUOUS' && f.attrs.path === null), src);
  }
});

test('only and except take the names as separate arguments too; only on apiResource can bring back create', () => {
  assert.deepEqual(routes("<?php\nRoute::resource('photos', P::class)->only('index', 'show');\n"), ['route:GET /photos', 'route:GET /photos/{photo}']);
  // PendingResourceRegistration::only replaces the apiResource list, so Laravel registers create here
  assert.deepEqual(routes("<?php\nRoute::apiResource('photos', P::class)->only(['create', 'index']);\n"), ['route:GET /photos', 'route:GET /photos/create']);
});

test('the resource parameter follows the full Doctrine Inflector English lists Laravel uses', () => {
  const cases = {
    curves: 'curve', caches: 'cache', caves: 'cave', graves: 'grave', saves: 'save', avalanches: 'avalanche',
    abuses: 'abuse', foes: 'foe', hoaxes: 'hoax', nurseries: 'nursery', oases: 'oasis', stadiums: 'stadium',
    media: 'medium', monies: 'money', regattas: 'regatta', campus: 'campus', chassis: 'chassis', multimedia: 'multimedia',
    tights: 'tights', movies: 'movie', axes: 'axe', Orders: 'Order',
  };
  for (const [plural, single] of Object.entries(cases)) {
    const r = run(`<?php\nRoute::apiResource('${plural}', X::class)->only('show');\n`, 'backend/routes/web.php');
    assert.deepEqual(ids(r), [`route:GET /${plural}/{${single}}`], plural);
  }
});

test('redirect and permanentRedirect are routes on any verb', () => {
  assert.deepEqual(routes("<?php\nRoute::redirect('/here', '/there');\nRoute::permanentRedirect('/old', '/new');\n"), ['route:ANY /here', 'route:ANY /old']);
});

test('a resource whose parameter name is renamed is AMBIGUOUS, not guessed', () => {
  const r = run("<?php\nRoute::apiResource('orders', O::class)->parameters(['orders' => 'o']);\n", 'backend/routes/web.php');
  assert.equal(r.facts.length, 5);
  assert.ok(r.facts.every((f) => f.origin === 'AMBIGUOUS' && f.attrs.path === null));
  assert.equal(new Set(r.facts.map((f) => f.id)).size, 5);
});

test('routes in comments, strings and heredocs are not facts', () => {
  const src = "<?php\n// Route::get('/a', 1);\n# Route::get('/b', 1);\n/* Route::get('/c', 1); */\n$x = \"Route::get('/d', 1)\";\n$y = <<<T\nRoute::get('/e', 1);\nT;\nRoute::get('/real', 1);\n";
  assert.deepEqual(routes(src), ['route:GET /real']);
});

// ---------- migrations ----------

test('Schema::create gives a table with its columns; Schema::table and indexes do not', () => {
  const src = [
    '<?php', 'return new class extends Migration {', '    public function up() {',
    "        Schema::create('posts', function (Blueprint $t) {", '            $t->id();', "            $t->string('title')->nullable();",
    "            $t->foreignId('user_id')->constrained();", "            $t->index('title');", "            $t->unique(['title', 'user_id']);",
    "            $t->morphs('owner');", '            $t->softDeletes();', '            $t->rememberToken();', '        });',
    "        Schema::table('posts', function (Blueprint $t) {", "            $t->string('extra');", '        });', '    }', '};',
  ].join('\n');
  const r = run(src, 'backend/database/migrations/2024_01_01_000000_posts.php');
  assert.deepEqual(ids(r), ['table:posts']);
  assert.equal(r.facts[0].line, 4);
  assert.equal(r.facts[0].attrs.source, 'laravel-migration');
  assert.deepEqual(r.facts[0].attrs.columns.map((c) => c.name), ['id', 'title', 'user_id', 'owner_id', 'owner_type', 'deleted_at', 'remember_token']);
  assert.equal(r.facts[0].attrs.columns[1].type, 'string');
});

test('table options are not columns; foreignUuid and foreignUlid are', () => {
  const src = [
    '<?php', "Schema::create('posts', function (Blueprint $table) {", "    $table->engine('InnoDB');", "    $table->charset('utf8mb4');",
    "    $table->collation('utf8mb4_unicode_ci');", '    $table->temporary();', "    $table->foreignUuid('user_id')->constrained();",
    "    $table->foreignUlid('team_id');", '    $table->foreignIdFor(User::class);', '});',
  ].join('\n');
  const r = run(src, 'backend/database/migrations/2024_01_01_000000_posts.php');
  assert.deepEqual(r.facts[0].attrs.columns.map((c) => [c.name, c.type]), [['user_id', 'foreignUuid'], ['team_id', 'foreignUlid']]);
});

test('a table named by a variable is AMBIGUOUS', () => {
  const r = run("<?php\nSchema::create($name, function ($table) {\n    $table->id();\n});\n", 'backend/database/migrations/x.php');
  assert.equal(r.facts[0].origin, 'AMBIGUOUS');
  assert.equal(r.facts[0].id, 'table:?$name');
});

// ---------- models ----------

test('Eloquent relations become relation facts with the cardinality of the call', () => {
  const src = [
    '<?php', 'namespace App\\Models;', 'class Post extends \\Illuminate\\Database\\Eloquent\\Model', '{',
    '    public function author() { return $this->belongsTo(User::class); }',
    '    public function comments()', '    {', "        return $this->hasMany(\\App\\Models\\Comment::class, 'post_id');", '    }',
    "    public function meta() { return $this->hasOne('App\\\\Models\\\\Meta'); }",
    '    public function tags() { return $this->belongsToMany(Tag::class); }',
    "    public function pictures() { return $this->morphMany(Picture::class, 'imageable'); }",
    '    public function weird() { return $this->hasMany($this->kind); }',
    "    public function scopeLive($q) { return $q->where('live', 1); }",
    '}',
  ].join('\n');
  const r = run(src, 'backend/app/Models/Post.php');
  const card = (id) => one(r, id)?.attrs.cardinality;
  assert.equal(card('relation:Post.author->User'), '1-n');
  assert.equal(card('relation:Post.comments->Comment'), '1-n');
  assert.equal(card('relation:Post.meta->Meta'), '1-1');
  assert.equal(card('relation:Post.tags->Tag'), 'n-n');
  assert.equal(card('relation:Post.pictures->Picture'), '1-n');
  assert.equal(one(r, 'relation:Post.comments->Comment').line, 6);
  assert.equal(one(r, 'relation:Post.comments->Comment').attrs.source, 'eloquent');
  const weird = r.facts.find((f) => f.attrs.field === 'weird');
  assert.equal(weird.origin, 'AMBIGUOUS');
  assert.equal(weird.attrs.to, null);
  assert.equal(r.facts.length, 6);
});

test('a class that is not a model gives no relation', () => {
  assert.deepEqual(run('<?php\nclass Report\n{\n    public function x() { return $this->hasMany(Y::class); }\n}\n').facts, []);
});

// ---------- jobs ----------

test('a queued job takes its queue from the $queue property when onQueue is absent', () => {
  const src = "<?php\nnamespace App\\Jobs;\nclass Resize implements ShouldQueue\n{\n    public $queue = 'images';\n}\n";
  const r = run(src, 'backend/app/Jobs/Resize.php');
  assert.deepEqual(ids(r), ['job:images/Resize', 'queue:images']);
  assert.equal(one(r, 'queue:images').line, 5);
  assert.equal(one(r, 'job:images/Resize').line, 3);
  assert.deepEqual(one(r, 'job:images/Resize').attrs, { queue: 'images', lib: 'laravel', role: 'consumer' });
});

test('a queued job with no queue name uses the default queue, marked INFERRED', () => {
  const r = run('<?php\nclass Tidy implements ShouldQueue, ShouldBeUnique\n{\n}\n', 'backend/app/Jobs/Tidy.php');
  assert.deepEqual(ids(r), ['job:default/Tidy', 'queue:default']);
  assert.ok(r.facts.every((f) => f.origin === 'INFERRED'));
});

test('a queue named by an expression is AMBIGUOUS; a class without ShouldQueue is not a job', () => {
  const amb = run("<?php\nclass J implements ShouldQueue\n{\n    public function __construct() { $this->onQueue(config('q.mail')); }\n}\n", 'backend/app/Jobs/J.php');
  assert.ok(amb.facts.every((f) => f.origin === 'AMBIGUOUS'));
  assert.equal(amb.facts.find((f) => f.kind === 'job').attrs.queue, null);
  assert.deepEqual(run("<?php\nclass Plain\n{\n    use Queueable;\n    public function __construct() { $this->onQueue('x'); }\n}\n", 'backend/app/Jobs/P.php').facts, []);
});

test('dispatch calls become hints with the resolved class name', () => {
  const src = [
    '<?php', 'namespace App\\Http;', 'use App\\Jobs\\SendReceipt;', 'use App\\Jobs\\{Resize, Tidy as Cleanup};', 'use App\\Other\\Thing as Alias;',
    'class C', '{', '    public function go()', '    {',
    '        SendReceipt::dispatch($o);', '        Resize::dispatchSync($o);', '        Cleanup::dispatchIf(true);', '        dispatch(new Alias($o));',
    '        Bus::dispatch(new \\App\\Full\\Name($o));', '        Local::dispatch();', '        Event::dispatch($e);', '        self::dispatch();',
    '        // Ghost::dispatch();', '        $this->dispatch(new Mine($o));', '        $events->dispatch(new Shipped($o));', '    }', '}',
  ].join('\n');
  const { hints } = run(src, 'backend/app/Http/C.php');
  // $this->dispatch is the DispatchesJobs trait; another object's dispatch may be an event bus, so it is left out
  assert.deepEqual(hints.map((h) => [h.class, h.fqcn, h.line]), [
    ['SendReceipt', 'App\\Jobs\\SendReceipt', 10], ['Resize', 'App\\Jobs\\Resize', 11], ['Tidy', 'App\\Jobs\\Tidy', 12],
    ['Thing', 'App\\Other\\Thing', 13], ['Name', 'App\\Full\\Name', 14], ['Local', 'App\\Http\\Local', 15],
    ['Mine', 'App\\Http\\Mine', 19],
  ]);
  assert.ok(hints.every((h) => h.kind === 'job-dispatch'));
});

// ---------- env and integrations ----------

test('env() gives names only, with the source from the folder', () => {
  const src = "<?php\nreturn [\n    'a' => env('APP_NAME', 'secret-default-9'),\n    'b' => env(\"DB_HOST\"),\n    'c' => env($dyn),\n    'd' => $this->env('NOT_THIS'),\n    'e' => env('APP_NAME'),\n];\n";
  const cfg = run(src, 'backend/config/app.php');
  assert.deepEqual(ids(cfg), ['env:APP_NAME', 'env:DB_HOST']);
  assert.equal(one(cfg, 'env:APP_NAME').attrs.source, 'config');
  assert.equal(one(cfg, 'env:APP_NAME').line, 3);
  assert.deepEqual(one(cfg, 'env:APP_NAME').refs, [{ file: 'backend/config/app.php', line: 7 }]);
  assert.equal(run(src, 'backend/app/Foo.php').facts[0].attrs.source, 'code');
  assert.equal(JSON.stringify(cfg).includes('secret-default-9'), false);
});

test('Http:: calls give the host; chains, baseUrl and interpolation work; local and dynamic hosts do not', () => {
  const src = [
    '<?php',
    "Http::get('https://one.example/x');",
    "Http::withToken($t)->acceptJson()->post('https://two.example:8443/y', $d);",
    "Http::baseUrl('https://three.example/api')->get('/z');",
    'Http::get("https://four.example/$id");',
    "Http::get('http://localhost:3000/a');",
    "Http::get('http://10.0.0.5/a');",
    'Http::get($url);',
    "Http::get('https://one.example/again');",
    "$s = 'Http::get(\"https://ghost.example\")';",
  ].join('\n');
  const r = run(src, 'backend/app/Svc.php');
  assert.deepEqual(ids(r), ['integration:four.example', 'integration:one.example', 'integration:three.example', 'integration:two.example']);
  assert.deepEqual(one(r, 'integration:one.example').attrs, { via: 'url', host: 'one.example' });
  assert.deepEqual(one(r, 'integration:one.example').refs, [{ file: 'backend/app/Svc.php', line: 9 }]);
  assert.equal(one(r, 'integration:two.example').line, 3);
});

// ---------- blade ----------

test('a blade view is a screen named like the view, dots for folders', () => {
  const a = run('<h1>Hi</h1>\n', 'backend/resources/views/emails/order.blade.php');
  assert.deepEqual(a.facts.map((f) => [f.id, f.line, f.origin, f.attrs]), [
    ['screen:backend:emails.order', 1, 'EXTRACTED', { framework: 'blade', route: 'emails.order', widget: 'emails.order' }],
  ]);
  assert.deepEqual(run('<x/>', 'backend/resources/views/components/button.blade.php').facts, []);
  assert.deepEqual(run('<x/>', 'backend/storage/framework/other.blade.php').facts, []);
  assert.equal(run('<x/>', 'resources/views/home.blade.php', { dir: '', name: 'acme/shop' }).facts[0].id, 'screen:shop:home');
});

test('blade text with env or Route in it gives no other fact', () => {
  assert.equal(run("{{ env('X') }} Route::get('/a', 1)\n", 'backend/resources/views/v.blade.php').facts.length, 1);
});

// ---------- shape ----------

test('output has no sha, file equals path, extractor is the version, and the module never touches the world', () => {
  const f = run("<?php\nenv('A_B');\n", 'backend/config/x.php').facts[0];
  assert.equal(f.file, 'backend/config/x.php');
  assert.equal('sha' in f, false);
  assert.equal(f.extractor, 'php@1');
  assert.deepEqual(f.refs, []);
  assert.equal('_at' in f, false);
  const code = readFileSync(join(HERE, '..', 'server', 'foundation', 'extract', 'php.mjs'), 'utf8');
  assert.equal(/node:fs|node:child_process|execFile|\bfetch\(|node:http/.test(code), false);
});

test('an empty or broken text gives nothing and does not throw', () => {
  assert.deepEqual(run('', 'backend/routes/web.php'), { facts: [], hints: [] });
  assert.deepEqual(run('<?php\n', 'backend/routes/web.php'), { facts: [], hints: [] });
  assert.doesNotThrow(() => run("<?php\nRoute::get(\nclass X extends Model {\n", 'backend/routes/web.php'));
});
