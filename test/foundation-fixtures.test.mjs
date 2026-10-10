import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArch } from '../server/arch/parse.mjs';
import { ownersOf } from '../server/arch/attach.mjs';
import { kindOfFile } from '../server/sources/count.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const answers = readdirSync(FIXTURE_REPOS).filter((f) => f.endsWith('.answer.json'));
const answerOf = (name) => JSON.parse(readFileSync(join(FIXTURE_REPOS, `${name}.answer.json`), 'utf8'));
const FACT_KINDS = new Set(['route', 'screen', 'table', 'relation', 'queue', 'job', 'integration', 'env', 'function', 'call', 'import', 'export']);
const ORIGINS = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'DECLARED']);
const SECRET_MARKER = 'do-not-read-42';
// A shape, not a list of names: a list of real names to keep out would itself put those names in the public repo.
const PERSONAL = /[A-Za-z]:[\\/]+Users|\/Users\/|\/home\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|[\w.+-]+@(?!example\.(?:com|org)\b)[A-Za-z][\w-]*\.[A-Za-z]{2,}/;

// The counter of the fd01 test: written here on purpose, with no lexer, so it cannot share a bug with server/foundation/lex.mjs.
// It knows comment markers by file type (line markers at the start of a line, `/* */` blocks, a block closed with code
// after it = code, a block opened after code), but it does NOT know strings: a `/*`, `#` or `--` inside a string, or a
// block opener inside a string, fools it. Pick the counted files of a fixture without those cases.
const C_LIKE = { line: ['//'], block: true };
const COMMENTS = {
  js: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, jsx: C_LIKE, ts: C_LIKE, tsx: C_LIKE, dart: C_LIKE,
  prisma: { line: ['//'], block: false }, css: { line: [], block: true },
  php: { line: ['//', '#'], block: true }, sql: { line: ['--'], block: true },
  yaml: { line: ['#'], block: false }, yml: { line: ['#'], block: false }, sh: { line: ['#'], block: false },
};
function naiveCount(text, path) {
  const rules = COMMENTS[path.split('.').pop()] ?? { line: [], block: false };
  // PHP 8 attributes start with `#[`: code, not a comment.
  const lineComment = (t) => rules.line.some((m) => t.startsWith(m) && !(m === '#' && t.startsWith('#[')));
  const afterClose = (t, from) => t.slice(t.indexOf('*/', from) + 2).trim();
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let code = 0;
  let comment = 0;
  let blank = 0;
  let inBlock = false;
  for (const raw of lines) {
    const t = raw.trim();
    let isComment;
    if (t === '') { blank++; continue; }
    if (inBlock) {
      if (!t.includes('*/')) isComment = true;
      else { inBlock = false; const rest = afterClose(t, 0); isComment = rest === '' || lineComment(rest); }
    } else if (lineComment(t)) isComment = true;
    else if (rules.block && t.startsWith('/*')) {
      if (!t.includes('*/', 2)) { inBlock = true; isComment = true; }
      else { const rest = afterClose(t, 2); isComment = rest === '' || lineComment(rest); }
    } else {
      isComment = false;
      const open = t.lastIndexOf('/*');
      if (rules.block && open >= 0 && !t.includes('*/', open + 2)) inBlock = true;
    }
    if (isComment) comment++;
    else code++;
  }
  return {
    total: lines.length, code, comment, blank,
    bytes: Buffer.byteLength(text), chars: [...text].length, words: text.split(/\s+/).filter(Boolean).length,
  };
}

const walk = (root, dir = '') => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = dir ? `${dir}/${e.name}` : e.name;
  return e.isDirectory() ? walk(root, rel) : [rel];
});

const linesIn = (repo) => (file) => {
  const path = join(FIXTURE_REPOS, repo, file);
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n') : null;
};

function trapProblems(answer, linesOf) {
  const out = [];
  for (const trap of answer.traps ?? []) {
    if (!linesOf(trap.file)?.[trap.line - 1]?.includes(trap.text)) out.push(`${trap.file}:${trap.line} lost its trap "${trap.text}"`);
    // No id would ever spell the trap text, so the place is what counts: nothing may live on a trap line.
    for (const f of answer.facts) {
      for (const at of [f, ...(f.refs ?? [])]) {
        if (at.file === trap.file && at.line === trap.line) out.push(`${f.id} sits on the trap ${trap.file}:${trap.line}`);
      }
    }
  }
  return out;
}

// The short name must stand as a whole word: `email` inside `'emails'` is a different name.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^\\w$])${escapeRe(word)}($|[^\\w$])`).test(text);
const quoted = (text) => [...text.matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
const segments = (path) => `/${path.replace(/^\/|\/$/g, '')}/`;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.dart', '.php'];

// File-based routing: the path lives in the file name, not in the line.
function pathFromFile(file, framework) {
  if (framework === 'next-app') {
    const m = /(?:^|\/)app\/(.*?)\/?route\.[jt]sx?$/.exec(file);
    return m && `/${m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')}`;
  }
  const m = /(?:^|\/)pages\/(.*)\.[jt]sx?$/.exec(file);
  return m && `/${m[1].replace(/(^|\/)index$/, '')}`;
}

// The `app.route({ method, url })` form: the fact sits on the call, the method and url come a few lines below it.
function routeBlock(lines, line) {
  const block = [];
  for (let i = line - 1; i < lines.length && i < line + 20; i++) {
    block.push(lines[i]);
    if (i > line - 1 && /^\s*}\s*\)/.test(lines[i])) break;
  }
  return block.join('\n');
}

function routeProblem(f, lines) {
  const m = /^route:(\S+) (.+)$/.exec(f.id);
  const { method, path, framework } = f.attrs ?? {};
  if (!m || m[1] !== method) return `method ${method} is not the one in the id`;
  if (path === null) {
    if (f.origin !== 'AMBIGUOUS' || !m[2].startsWith('?')) return 'a null path must be AMBIGUOUS with ?<expression> in the id';
    return hasWord(f.needle, m[2].slice(1)) ? null : `the needle has no "${m[2].slice(1)}"`;
  }
  if (m[2] !== path) return `attrs.path ${path} is not the one in the id`;
  if (framework === 'next-app' || framework === 'next-pages') {
    if (pathFromFile(f.file, framework) !== path) return `the file gives the path ${pathFromFile(f.file, framework)}`;
    if (framework === 'next-app') return f.needle === method ? null : `the needle must be the exported ${method}`;
    return method === 'ANY' && /export\s+default/.test(lines[f.line - 1]) ? null : 'a pages/api handler is the default export, method ANY';
  }
  let literals = quoted(f.needle);
  if (/\.route\($/.test(f.needle)) {
    const block = routeBlock(lines, f.line);
    const said = /\bmethod\s*:\s*['"`](\w+)['"`]/.exec(block)?.[1];
    if (said?.toUpperCase() !== method) return `the route block says method ${said}`;
    literals = [/\burl\s*:\s*['"`]([^'"`]*)['"`]/.exec(block)?.[1]].filter((x) => x !== undefined);
  }
  if (f.origin === 'EXTRACTED') return literals.includes(path) ? null : `no literal "${path}" at the declaration`;
  // INFERRED (a prefix the program applied) or AMBIGUOUS (two definitions): the written literal is whole segments of the path.
  const ok = literals.some((l) => l.replace(/^\/|\/$/g, '') !== '' && segments(path).includes(segments(l)) && (f.origin !== 'INFERRED' || segments(l) !== segments(path)));
  return ok ? null : `no literal at the declaration is a part of "${path}"`;
}

function resolvesTo(from, spec, target) {
  if (spec.startsWith('.')) {
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    return RESOLVE_EXT.some((ext) => base + ext === target || `${base}/index${ext}` === target);
  }
  const pkg = /^package:[^/]+\/(.+)$/.exec(spec);
  if (pkg) return target.endsWith(`lib/${pkg[1]}`);
  return false;
}

// Short name of a fact, taken from its id (and checked against its attrs), that the needle must hold.
function shortName(f) {
  const after = (sep) => f.id.slice(f.id.indexOf(sep) + sep.length);
  switch (f.kind) {
    case 'queue': case 'table': case 'env': return after(':');
    case 'job': return f.id.startsWith(`job:${f.attrs?.queue}/`) ? after('/') : `<queue ${f.attrs?.queue} not in the id>`;
    case 'integration': { const n = after(':'); return [f.attrs?.host, f.attrs?.package].includes(n) ? n : `<${n} is neither host nor package>`; }
    case 'function': return after('#').split('.').pop();
    case 'export': return after('#');
    case 'screen': return f.id.endsWith(`:${f.attrs?.route ?? f.attrs?.widget}`) ? f.attrs?.widget : `<route ${f.attrs?.route} not in the id>`;
    case 'relation': {
      const m = /^relation:([^.]+)\.(.+)->(.+)$/.exec(f.id);
      return m && m[1] === f.attrs?.from && m[2] === f.attrs?.field && m[3] === f.attrs?.to ? m[2] : '<relation id and attrs disagree>';
    }
    case 'call': {
      const target = after('->');
      const ok = target === `?${f.attrs?.callee}` || target.split('#').pop().split('.').pop() === f.attrs?.callee;
      return ok ? f.attrs.callee : `<callee ${f.attrs?.callee} is not ${target}>`;
    }
    default: return null;
  }
}

// Screens of a file-routed framework also carry their route in the file name.
function screenRouteProblem(f) {
  const m = /(?:^|\/)app\/(.*?)\/?page\.[jt]sx?$/.exec(f.file);
  if (f.attrs?.framework === 'next-app' && m) {
    const route = `/${m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')}`;
    return route === f.attrs.route ? null : `the file gives the route ${route}`;
  }
  if (f.attrs?.framework === 'next-pages') {
    const route = pathFromFile(f.file, 'next-pages');
    return route === f.attrs.route ? null : `the file gives the route ${route}`;
  }
  return null;
}

function needleProblems(answer, linesOf, files) {
  const out = [];
  const ids = new Set();
  for (const f of answer.facts) {
    const where = `${f.id} (${f.file}:${f.line})`;
    const bad = (msg) => out.push(`${where}: ${msg}`);
    if (!FACT_KINDS.has(f.kind)) bad(`kind ${f.kind}`);
    if (!ORIGINS.has(f.origin)) bad(`origin ${f.origin}`);
    if (ids.has(f.id)) bad('id repeated');
    ids.add(f.id);
    if (!f.id.startsWith(`${f.kind === 'function' ? 'fn' : f.kind}:`)) bad('id does not start with its kind');
    if (typeof f.needle !== 'string' || f.needle === '') { bad('needle'); continue; }
    const lines = linesOf(f.file);
    if (!lines) { bad('file missing'); continue; }
    if (!(f.line >= 1 && f.line <= lines.length)) { bad('line out of the file'); continue; }
    if (!lines[f.line - 1].includes(f.needle)) bad(`line ${f.line} is "${lines[f.line - 1]}", it has no "${f.needle}"`);
    let name = null;
    if (f.kind === 'route') {
      const p = routeProblem(f, lines);
      if (p) bad(p);
    } else if (f.kind === 'import') {
      const m = /^import:(.+)->(.+)$/.exec(f.id);
      const spec = f.attrs?.spec ?? f.needle;
      if (!m || m[1] !== f.file || !files.has(m[2]) || !resolvesTo(f.file, spec, m[2])) bad(`"${spec}" does not lead to ${m?.[2]}`);
    } else {
      name = shortName(f);
      if (name === null || name === undefined || !hasWord(f.needle, name)) bad(`the needle "${f.needle}" has no short name "${name}"`);
      if (f.kind === 'screen') { const p = screenRouteProblem(f); if (p) bad(p); }
    }
    for (const r of f.refs ?? []) {
      if (!linesOf(r.file)?.[r.line - 1]?.includes(r.needle)) bad(`ref ${r.file}:${r.line} has no "${r.needle}"`);
      else if (name && !hasWord(r.needle, name)) bad(`ref ${r.file}:${r.line}: the needle "${r.needle}" has no "${name}"`);
    }
  }
  return out;
}

// ---- the checks themselves must catch a wrong answer ----

const shopTrap = { file: 'apps/api/src/routes/orders.ts', line: 23, text: "app.delete('/orders/:id')" };

test('trap check: a fact or a ref sitting on a trap line is caught, whatever its id', () => {
  const linesOf = linesIn('acme-shop');
  const onTrap = { id: 'route:DELETE /v1/orders/:id', kind: 'route', origin: 'INFERRED', file: shopTrap.file, line: 23, needle: "'/orders/:id'", attrs: { method: 'DELETE', path: '/v1/orders/:id', framework: 'fastify' }, refs: [] };
  assert.equal(trapProblems({ facts: [onTrap], traps: [shopTrap] }, linesOf).length, 1);
  const refOnTrap = { ...answerOf('acme-shop').facts.find((f) => f.id === 'queue:emails') };
  refOnTrap.refs = [{ file: shopTrap.file, line: 23, needle: 'app' }];
  assert.equal(trapProblems({ facts: [refOnTrap], traps: [shopTrap] }, linesOf).length, 1);
  assert.equal(trapProblems({ facts: [], traps: [{ ...shopTrap, line: 22 }] }, linesOf).length, 1, 'a moved trap is caught');
});

test('needle check: the needle must hold the short name taken from the id itself', () => {
  const shop = answerOf('acme-shop');
  const files = new Set(walk(join(FIXTURE_REPOS, 'acme-shop')));
  const bad = (f) => needleProblems({ facts: [f] }, linesIn('acme-shop'), files).length;
  const real = (id) => shop.facts.find((f) => f.id === id);
  assert.equal(needleProblems(shop, linesIn('acme-shop'), files).length, 0);
  // a typo in the id of a prefixed route
  const get = real('route:GET /v1/orders/:id');
  assert.ok(bad({ ...get, id: 'route:GET /v1/order/:id', attrs: { ...get.attrs, path: '/v1/order/:id' } }) > 0);
  // the id and attrs.path disagree
  assert.ok(bad({ ...get, attrs: { ...get.attrs, path: '/v1/orders/:key' } }) > 0);
  // an extracted route must name its whole path
  const status = real('route:GET /status');
  assert.ok(bad({ ...status, id: 'route:GET /statuses', attrs: { ...status.attrs, path: '/statuses' } }) > 0);
  const dyn = real('route:GET ?ADMIN_PATH');
  assert.ok(bad({ ...dyn, id: 'route:GET ?ADMIN_PATHS' }) > 0);
  // the route object form: method and url are read inside the block
  const put = real('route:PUT /v1/orders/:id/note');
  assert.ok(bad({ ...put, id: 'route:PATCH /v1/orders/:id/note', attrs: { ...put.attrs, method: 'PATCH' } }) > 0);
  assert.ok(bad({ ...put, id: 'route:PUT /v1/orders/:id/notes', attrs: { ...put.attrs, path: '/v1/orders/:id/notes' } }) > 0);
  // file-based routes take their path from the file
  const users = real('route:ANY /api/users');
  assert.ok(bad({ ...users, id: 'route:ANY /api/user', attrs: { ...users.attrs, path: '/api/user' } }) > 0);
  const health = real('route:GET /api/health');
  assert.ok(bad({ ...health, id: 'route:POST /api/health', attrs: { ...health.attrs, method: 'POST' } }) > 0);
  // the other kinds
  assert.ok(bad({ ...real('fn:apps/api/src/services/orders.ts#placeOrder'), id: 'fn:apps/api/src/services/orders.ts#placeOrdr' }) > 0);
  assert.ok(bad({ ...real('fn:apps/api/src/services/notify.ts#Notifier.send'), id: 'fn:apps/api/src/services/notify.ts#Notifier.sent' }) > 0);
  assert.ok(bad({ ...real('table:Order'), id: 'table:Orders' }) > 0);
  assert.ok(bad({ ...real('queue:emails'), id: 'queue:email' }) > 0);
  assert.ok(bad({ ...real('job:emails/welcome'), id: 'job:emails/welcom' }) > 0);
  assert.ok(bad({ ...real('env:PORT'), id: 'env:PORTS' }) > 0);
  assert.ok(bad({ ...real('integration:stripe'), id: 'integration:strip' }) > 0);
  assert.ok(bad({ ...real('relation:Order.tags->Tag'), id: 'relation:Order.tag->Tag' }) > 0);
  const cart = real('screen:web:/cart');
  assert.ok(bad({ ...cart, id: 'screen:web:/carts', attrs: { ...cart.attrs, route: '/carts' } }) > 0);
  assert.ok(bad({ ...real('export:apps/worker/src/queues.ts#emailQueue'), id: 'export:apps/worker/src/queues.ts#emailQueues' }) > 0);
  const call = real('call:fn:apps/api/src/services/orders.ts#placeOrder->fn:apps/api/src/services/orders.ts#normalize');
  assert.ok(bad({ ...call, id: 'call:fn:apps/api/src/services/orders.ts#placeOrder->fn:apps/api/src/services/orders.ts#findOrder' }) > 0);
  const imp = real('import:apps/api/src/server.ts->apps/api/src/log.ts');
  assert.ok(bad({ ...imp, id: 'import:apps/api/src/server.ts->apps/api/src/routes/orders.ts' }) > 0);
  // a ref must hold the short name too
  assert.ok(bad({ ...real('queue:emails'), refs: [{ file: 'apps/worker/src/worker.ts', line: 10, needle: 'Worker' }] }) > 0);
});

test('naive counter: a comment closed on its line with code after it is code; # and -- follow the file type', () => {
  const pick = (text, path) => { const c = naiveCount(text, path); return [c.code, c.comment, c.blank]; };
  assert.deepEqual(pick('/* x */ code();\n', 'a.ts'), [1, 0, 0]);
  assert.deepEqual(pick('a(); /* open\nstill\n*/ b();\n', 'a.ts'), [2, 1, 0]);
  assert.deepEqual(pick('# note\n#[Attr]\n// two\n$a = 1;\n', 'a.php'), [2, 2, 0]);
  assert.deepEqual(pick('-- note\nSELECT 1;\n', 'a.sql'), [1, 1, 0]);
  assert.deepEqual(pick('# note\nkey: 1\n\n', 'a.yaml'), [1, 1, 1]);
  assert.deepEqual(pick('# title\ntext\n', 'a.md'), [2, 0, 0]);
});

test('there is one answer per fixture repository, and the helper knows where they live', () => {
  assert.ok(answers.length >= 1);
  for (const file of answers) assert.ok(existsSync(join(FIXTURE_REPOS, file.replace('.answer.json', ''))), `${file} has no repository next to it`);
});

for (const file of answers) {
  const name = file.replace('.answer.json', '');

  test(`${name}: every expected fact points to a real file and a line that holds its short name`, () => {
    const answer = answerOf(name);
    assert.ok(answer.facts.length > 0);
    assert.deepEqual(needleProblems(answer, linesIn(name), new Set(walk(join(FIXTURE_REPOS, name)))), []);
  });

  test(`${name}: the trap texts are in the files and none of them became a fact`, () => {
    const answer = answerOf(name);
    assert.deepEqual(trapProblems(answer, linesIn(name)), []);
    assert.ok(!answer.facts.some((f) => /ghost|legacy/i.test(f.id)), 'a ghost fact is expected');
  });

  test(`${name}: the counts written in the answer match an independent counter, file by file`, () => {
    const answer = answerOf(name);
    const paths = Object.keys(answer.counts);
    assert.ok(paths.length >= 1);
    for (const path of paths) {
      const text = readFileSync(join(FIXTURE_REPOS, name, path), 'utf8');
      assert.deepEqual(answer.counts[path], naiveCount(text, path), path);
    }
  });

  // An env name written in a second file the key does not list must be explained in the notes, by its path: the
  // first extractor that reads that file would otherwise meet an undecided definition-or-ref question.
  test(`${name}: an env name repeated in a file the key does not list is named in the notes`, () => {
    const answer = answerOf(name);
    const files = walk(join(FIXTURE_REPOS, name)).filter((p) => !/\.(md|png)$/.test(p));
    const notes = (answer.notes ?? []).join('\n');
    const unexplained = [];
    for (const f of answer.facts.filter((x) => x.kind === 'env')) {
      const envName = f.id.slice('env:'.length);
      const listed = new Set([f.file, ...(f.refs ?? []).map((r) => r.file)]);
      const word = new RegExp(`\\b${envName}\\b`);
      for (const p of files) {
        if (listed.has(p) || !word.test(readFileSync(join(FIXTURE_REPOS, name, p), 'utf8'))) continue;
        if (!notes.includes(p)) unexplained.push(`${f.id} in ${p}`);
      }
    }
    assert.deepEqual(unexplained, []);
  });

  test(`${name}: nothing personal in the files`, () => {
    for (const rel of walk(join(FIXTURE_REPOS, name))) {
      if (/\.png$/.test(rel)) continue;
      assert.ok(!PERSONAL.test(readFileSync(join(FIXTURE_REPOS, name, rel), 'utf8')), `${name}/${rel}`);
    }
  });
}

test('the nothing-personal guard is a pattern that names nobody: home folders, IPv4 and real e-mails', () => {
  for (const bad of ['C:\\Users\\someone\\x', 'C:/Users/someone', '/Users/someone/x', '/home/someone/x', 'host 10.0.0.12', 'bob@acme.io']) {
    assert.ok(PERSONAL.test(bad), bad);
  }
  for (const ok of ['Ana <ana@example.com>', 'ops@example.org', '"@acme/db": "workspace:*"', 'v1.2.3', "import x from '@prisma/client'", '"packageManager": "pnpm@9.12.0"']) {
    assert.ok(!PERSONAL.test(ok), ok);
  }
});

test('copyFixtureRepo: a real git repository with Ana as author, an untracked .env that is never committed and an ignored node_modules', () => {
  const root = copyFixtureRepo('acme-shop');
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(git('log', '--format=%an <%ae>').trim(), 'Ana <ana@example.com>');
    const tracked = git('ls-files').split('\n').filter(Boolean).sort();
    const fixture = walk(join(FIXTURE_REPOS, 'acme-shop')).sort();
    assert.deepEqual(tracked, fixture);
    assert.equal(readFileSync(join(root, '.env'), 'utf8').trim(), `SECRET_TOKEN=${SECRET_MARKER}`);
    assert.ok(!tracked.includes('.env'));
    const untracked = git('ls-files', '-o', '--exclude-standard').split('\n').filter(Boolean);
    assert.deepEqual(untracked, ['.env'], 'the .env must show as untracked, not ignored; node_modules must stay ignored');
    assert.ok(existsSync(join(root, 'node_modules/x/index.js')));
    assert.equal(git('status', '--porcelain').trim(), '?? .env');
  } finally {
    removeFixtureRepo(root);
  }
  assert.ok(!existsSync(root));
});

test('copyFixtureRepo: a global gitignore that lists .env does not turn the copy\'s .env into an ignored file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-global-ignore-'));
  writeFileSync(join(dir, 'ignore'), '.env\n');
  writeFileSync(join(dir, 'gitconfig'), `[core]\n\texcludesFile = ${join(dir, 'ignore').replaceAll('\\', '/')}\n`);
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'gitconfig');
  let root;
  try {
    root = copyFixtureRepo('acme-shop');
    // plain git, without the helper's -c flags: what the census will run
    const untracked = execFileSync('git', ['ls-files', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(untracked, ['.env']);
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
    if (root) removeFixtureRepo(root);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copyFixtureRepo with env: false leaves no .env; two copies never share a folder; an unknown fixture is refused', () => {
  const a = copyFixtureRepo('acme-shop', { env: false });
  const b = copyFixtureRepo('acme-shop', { env: false });
  try {
    assert.notEqual(a, b);
    for (const root of [a, b]) {
      assert.ok(!existsSync(join(root, '.env')));
      assert.ok(existsSync(join(root, 'node_modules/x/index.js')));
    }
    assert.throws(() => copyFixtureRepo('no-such-repo'), /unknown fixture/);
    assert.throws(() => copyFixtureRepo('../fixtures'), /unknown fixture/);
  } finally {
    removeFixtureRepo(a);
    removeFixtureRepo(b);
  }
});

// ---- acme-shop only: what the other tasks lean on ----

const SHOP = join(FIXTURE_REPOS, 'acme-shop');
const shopFiles = () => walk(SHOP);

test('acme-shop: the pieces the tasks of block 1 need are there', () => {
  const files = shopFiles();
  for (const p of ['package.json', 'pnpm-workspace.yaml', 'turbo.json', '.env.example', 'pnpm-lock.yaml', '.gitignore', 'apps/web/public/logo.png', 'docs/architecture/README.md']) {
    assert.ok(files.includes(p), p);
  }
  assert.ok(!files.includes('.env'), 'the .env is only ever created in the copy');
  assert.ok(!files.includes('SECURITY.md'));
  assert.ok(!files.some((p) => p.startsWith('.github/')));
  assert.equal(readFileSync(join(SHOP, '.gitignore'), 'utf8').trim(), 'node_modules');
  const turbo = JSON.parse(readFileSync(join(SHOP, 'turbo.json'), 'utf8'));
  assert.equal(turbo.tasks.build.env.length, 2);
  assert.equal(turbo.globalPassThroughEnv.length, 1);
  assert.equal(readFileSync(join(SHOP, '.env.example'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).length, 3);
});

test('acme-shop: the README has exactly 320 lines, and the png is a real binary file', () => {
  assert.equal(readFileSync(join(SHOP, 'README.md'), 'utf8').split('\n').length - 1, 320);
  assert.equal(readFileSync(join(SHOP, 'apps/web/public/logo.png')).subarray(0, 4).toString('hex'), '89504e47');
});

test('acme-shop: the architecture folder reads as 4 parts, and only apps/admin has no owner', () => {
  const answer = answerOf('acme-shop');
  const dir = 'docs/architecture';
  const arch = parseArch(dir, Object.fromEntries(readdirSync(join(SHOP, dir)).map((f) => [f, readFileSync(join(SHOP, dir, f), 'utf8')])));
  assert.deepEqual(arch.parts.map((p) => p.id).sort(), ['db', 'orders', 'web', 'worker']);
  const included = shopFiles().filter((p) => !['dep', 'generated', 'binary'].includes(kindOfFile(p)));
  const owners = ownersOf(included, arch, { topLevel: new Set(included.map((p) => p.split('/')[0])) });
  const byPath = Object.fromEntries(included.map((p, i) => [p, owners[i]]));
  assert.deepEqual(answer.owners, byPath);
  const wanted = included.filter((p) => ['code', 'screen'].includes(kindOfFile(p)));
  const unowned = wanted.filter((p) => byPath[p] === null).sort();
  assert.deepEqual(answer.ownerCheck.files, unowned);
  assert.equal(answer.ownerCheck.ok, false);
  assert.deepEqual(answer.ownerCheck.facts, answer.facts.filter((f) => ['route', 'screen', 'table'].includes(f.kind) && byPath[f.file] === null).map((f) => f.id).sort());
  assert.deepEqual(answer.coverage.owned, { num: wanted.length - unowned.length, den: wanted.length });
  assert.ok(unowned.filter((p) => p.startsWith('apps/')).every((p) => p.startsWith('apps/admin/')));
});

test('acme-shop: coverage and gaps follow the hand count (a fact is cited when an architecture .md names it inside backticks)', () => {
  const answer = answerOf('acme-shop');
  const dir = join(SHOP, 'docs/architecture');
  const spans = readdirSync(dir).flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const tokens = new Set(spans.flatMap((s) => s.split(/\s+/)));
  const cited = (f) => {
    if (f.kind === 'route') return f.attrs.path !== null && tokens.has(f.attrs.path);
    if (f.kind === 'screen') return tokens.has(f.attrs.route);
    return tokens.has(f.id.slice('table:'.length));
  };
  for (const kind of ['route', 'screen', 'table']) {
    const all = answer.facts.filter((f) => f.kind === kind);
    const num = all.filter(cited).length;
    assert.deepEqual(answer.coverage[`${kind}s`], { num, den: all.length }, kind);
  }
  const notCited = answer.facts.filter((f) => ['route', 'screen', 'table'].includes(f.kind) && !cited(f)).map((f) => f.id).sort();
  assert.deepEqual(answer.gaps.filter((g) => g.reason === 'not-cited').map((g) => g.id).sort(), notCited);
  for (const g of answer.gaps) {
    const f = answer.facts.find((x) => x.id === g.id);
    if (f) assert.deepEqual([g.file, g.line], [f.file, f.line], g.id);
  }
  assert.deepEqual(answer.gaps.filter((g) => g.reason === 'no-owner').map((g) => g.id), ['apps/admin']);
});

test('acme-shop: the docs cite one route that no longer exists, and the answer does not expect it', () => {
  const docs = readFileSync(join(SHOP, 'docs/architecture/orders.md'), 'utf8');
  assert.ok(docs.includes('`DELETE /v1/orders/:id`'));
  assert.ok(!answerOf('acme-shop').facts.some((f) => f.id === 'route:DELETE /v1/orders/:id'));
});

test('acme-shop: the facts answer lists exactly what the fixture was built to hold', () => {
  const answer = answerOf('acme-shop');
  const count = (kind) => answer.facts.filter((f) => f.kind === kind).length;
  assert.deepEqual(['route', 'screen', 'table', 'relation', 'queue', 'job', 'integration', 'env'].map(count), [7, 4, 3, 4, 1, 2, 2, 10]);
  const route = (id) => answer.facts.find((f) => f.id === id);
  assert.equal(route('route:GET /v1/orders/:id').origin, 'INFERRED');
  assert.equal(route('route:GET ?ADMIN_PATH').origin, 'AMBIGUOUS');
  assert.equal(route('route:GET ?ADMIN_PATH').attrs.path, null);
  const ambiguous = answer.facts.find((f) => f.kind === 'call' && f.id.endsWith('->?send'));
  assert.equal(ambiguous.origin, 'AMBIGUOUS');
  // contract §3: an AMBIGUOUS fact keeps its candidates in refs [{ file, line }]
  const at = (id) => { const fn = answer.facts.find((f) => f.id === id); return `${fn.file}:${fn.line}`; };
  assert.deepEqual(ambiguous.refs.map((r) => `${r.file}:${r.line}`).sort(), ambiguous.candidates.map(at).sort());
  assert.equal(ambiguous.refs.length, 2);
  assert.ok(answer.facts.filter((f) => f.kind === 'function' && f.attrs.exported).length >= 6);
  assert.deepEqual(answer.excluded, { dep: 1, generated: 1, binary: 1, secret: 1 });
  assert.equal(relative(FIXTURE_REPOS, SHOP), 'acme-shop');
  assert.ok(statSync(SHOP).isDirectory());
});
