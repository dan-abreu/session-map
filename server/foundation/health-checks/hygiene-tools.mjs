// Health (fd08), hygiene of the tooling: the 9 `hygiene.*` items about CI, tests, lint, format, types, build, coverage,
// hooks and commit rules. One pure function per item over a health context; the answer is
// { state, evidence, reason, detail, packages? }. Whether the item applies (code at all) is also guarded here, because a
// check must never invent a failure for a repository without code.
//
// "Per package" items (tests, lint, formatter, typecheck, build) follow the rule of the catalog: pass when the root
// orchestrates (a root script of that name) or when EVERY package that has code passes; otherwise fail listing the
// packages that lack it. Everything is read from the census files and the manifests, never from .env, never by running a
// tool.

const NA = () => ({ state: 'na', evidence: [], reason: 'no-code', detail: {} });
const pass = (evidence = [], detail = {}) => ({ state: 'pass', evidence, reason: null, detail });
const fail = (evidence = [], detail = {}, reason = 'missing') => ({ state: 'fail', evidence, reason, detail });

const CODE_OTHER_EXT = new Set(['py', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'lua', 'ex', 'exs', 'scala', 'vue', 'svelte', 'astro']);
const NOT_CODE_TYPES = new Set(['json', 'yaml', 'md']);
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const under = (path, dir) => dir === '' || path.startsWith(`${dir}/`);

const isCodeRow = (r) => {
  if (!r.included || (r.kind !== 'code' && r.kind !== 'screen')) return false;
  if (NOT_CODE_TYPES.has(r.type)) return false;
  if (r.type === 'other' || r.type == null) return CODE_OTHER_EXT.has(baseOf(r.path).split('.').pop().toLowerCase());
  return true;
};

// ---------- small readers (cached per context) ----------

const memos = new WeakMap();
function memo(ctx, key, make) {
  let m = memos.get(ctx);
  if (!m) memos.set(ctx, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

// JSON with comments and trailing commas (tsconfig style). A value that does not parse is null.
function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; i--; }
    else if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; }
    else out += c;
  }
  try {
    const v = JSON.parse(out.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

const jsonOf = (ctx, path) => memo(ctx, `json:${path}`, () => {
  const text = path ? ctx.read(path) : null;
  return typeof text === 'string' ? parseJsonc(text) : null;
});

const depsOf = (json) => new Set(['dependencies', 'devDependencies', 'require', 'require-dev']
  .flatMap((k) => (json?.[k] && typeof json[k] === 'object' ? Object.keys(json[k]) : [])));

// First line (1-based) where `"name":` shows up, after `after` when given (so "test" is found inside "scripts").
function lineOfKey(text, name, after) {
  if (typeof text !== 'string') return undefined;
  const rows = text.split(/\r?\n/);
  let from = 0;
  if (after) {
    const a = rows.findIndex((r) => r.includes(`"${after}"`));
    if (a >= 0) from = a;
  }
  const i = rows.findIndex((r, n) => n >= from && r.includes(`"${name}"`) && /"\s*:/.test(r));
  return i < 0 ? undefined : i + 1;
}

const at = (file, line) => (line ? { file, line } : { file });
const scriptEvidence = (ctx, u, key) => at(u.manifest, lineOfKey(ctx.read(u.manifest), key, 'scripts'));
const fieldEvidence = (ctx, manifest, field) => at(manifest, lineOfKey(ctx.read(manifest), field));

// ---------- packages with code ----------

function unitsOf(ctx) {
  return memo(ctx, 'units', () => {
    const dirs = ctx.packages.map((p) => p.dir);
    const owned = new Map(dirs.map((d) => [d, []]));
    const loose = [];
    for (const r of ctx.files) {
      if (!r.included || r.kind === 'dep') continue;
      let best = null;
      for (const d of dirs) if (under(r.path, d) && (best === null || d.length > best.length)) best = d;
      if (best === null) loose.push(r); else owned.get(best).push(r);
    }
    const others = dirs.some((d) => d !== '');
    const units = ctx.packages
      .map((p) => ({ ...p, rows: owned.get(p.dir), code: owned.get(p.dir).filter(isCodeRow) }))
      // The root of a monorepo only holds the tooling of the whole; its own folders are not a package.
      .filter((u) => u.code.length && !(u.dir === '' && others));
    if (units.length) return units;
    const rows = ctx.files.filter((r) => r.included && r.kind !== 'dep');
    return [{ dir: '', manifest: null, kind: null, scripts: {}, rows, code: rows.filter(isCodeRow), pseudo: true }];
  });
}

const rootPackage = (ctx) => ctx.packages.find((p) => p.dir === '') ?? null;

// A file by name in the package folder, then at the root (a root config covers the packages below it).
function configFor(ctx, u, names) {
  for (const dir of u.dir ? [u.dir, ''] : ['']) {
    for (const n of names) if (ctx.has(join(dir, n))) return join(dir, n);
  }
  return null;
}

// A table keyed by manifest kind; a unit without a manifest (no package at all) tries them all.
const forKind = (table, u) => (u.kind ? (table[u.kind] ?? []) : Object.values(table).flat());

function scriptHit(scripts, keyRe, valueRe) {
  for (const [k, v] of Object.entries(scripts ?? {})) {
    if ((keyRe && keyRe.test(k)) || (valueRe && valueRe.test(v))) {
      if (/no test specified/i.test(v)) continue;
      return k;
    }
  }
  return null;
}

// The manifest field (eslintConfig, prettier...) of the package or of the root.
function fieldHit(ctx, u, field) {
  for (const m of [u.manifest, rootPackage(ctx)?.manifest]) {
    if (m && jsonOf(ctx, m)?.[field] != null) return fieldEvidence(ctx, m, field);
  }
  return null;
}

// ---------- CI files and their commands ----------

const CI_NAMES = new Set(['.gitlab-ci.yml', '.gitlab-ci.yaml', 'codemagic.yaml', 'codemagic.yml', 'bitrise.yml', 'azure-pipelines.yml',
  '.travis.yml', 'appveyor.yml', '.drone.yml', 'jenkinsfile', 'bitbucket-pipelines.yml', 'cloudbuild.yaml', 'cloudbuild.yml', 'buildspec.yml']);

const ciFilesOf = (ctx) => memo(ctx, 'ci', () => ctx.list('').filter((p) => {
  const lower = p.toLowerCase();
  if (!p.includes('/')) return CI_NAMES.has(lower);
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower) || /^\.circleci\/config\.yml$/.test(lower) || /^\.woodpecker\/[^/]+\.ya?ml$/.test(lower);
}));

const KEY_LINE = /^(\s*)(-\s+)?(run|script|scripts|before_script|after_script|command|commands)\s*:\s*(.*)$/;
const USES_LINE = /^\s*(?:-\s+)?uses\s*:\s*(\S+)/;
const MAPPING_ITEM = /^[\w.-]+:(\s|$)/;

// The commands a CI file runs, with their lines: inline `run: x`, `run: |` blocks, and `- x` lists under `script:`.
// Names, job titles and `needs:` are not commands. Reading by lines, no YAML library.
export function commandLines(text, file) {
  const rows = String(text ?? '').split(/\r?\n/);
  const out = [];
  const indentOf = (s) => s.length - s.trimStart().length;
  for (let i = 0; i < rows.length; i++) {
    const uses = USES_LINE.exec(rows[i]);
    if (uses) out.push({ file, line: i + 1, cmd: `uses ${uses[1]}` });
    const m = KEY_LINE.exec(rows[i]);
    if (!m) continue;
    const col = m[1].length + (m[2] ? m[2].length : 0);
    const value = m[4].trim();
    if (value && !/^[|>][+-]?\s*(#.*)?$/.test(value)) {
      if (!value.startsWith('#')) out.push({ file, line: i + 1, cmd: value.replace(/^["']|["']$/g, '') });
      continue;
    }
    const block = value !== '';
    for (let j = i + 1; j < rows.length; j++) {
      const raw = rows[j];
      if (!raw.trim()) continue;
      const ind = indentOf(raw);
      const item = /^\s*-\s+(.*)$/.exec(raw);
      if (block ? ind <= col : (ind < col || (ind === col && !item))) break;
      let cmd = block ? raw.trim() : (item ? item[1].trim() : raw.trim());
      if (cmd.startsWith('#')) continue;
      if (!block && MAPPING_ITEM.test(cmd)) continue;
      cmd = cmd.replace(/^["']|["']$/g, '');
      out.push({ file, line: j + 1, cmd });
    }
  }
  return out;
}

const ciCommands = (ctx) => memo(ctx, 'cmds', () => ciFilesOf(ctx).flatMap((f) => {
  const text = ctx.read(f);
  return typeof text === 'string' ? commandLines(text, f) : [];
}));

const ciHit = (ctx, re) => {
  const c = ciCommands(ctx).find((x) => !/^(echo|printf)\b/.test(x.cmd) && re.test(x.cmd));
  return c ? { file: c.file, line: c.line } : null;
};

// ---------- the per-package rule ----------

// spec.root: how a root script shows up; spec.unit(u, ctx) -> { state: 'pass'|'fail'|'unknown', evidence, reason?, detail? }.
function perPackage(ctx, spec) {
  if (!ctx.hasCode) return NA();
  const root = rootPackage(ctx);
  if (root) {
    const key = scriptHit(root.scripts, spec.keyRe, spec.valueRe);
    if (key) return pass([scriptEvidence(ctx, root, key)]);
  }
  const results = unitsOf(ctx).map((u) => ({ u, ...spec.unit(u, ctx) }));
  const fails = results.filter((r) => r.state === 'fail');
  if (fails.length) {
    return {
      state: 'fail',
      evidence: fails.flatMap((f) => f.evidence?.length ? f.evidence : (f.u.manifest ? [{ file: f.u.manifest }] : [])),
      reason: fails[0].reason ?? 'missing',
      detail: { ...(fails[0].detail ?? {}), count: fails.length },
      packages: fails.map((f) => ({ dir: f.u.dir, state: 'fail' })),
    };
  }
  if (results.some((r) => r.state === 'unknown')) {
    return { state: 'unverified', evidence: results.flatMap((r) => r.evidence ?? []).slice(0, 5), reason: 'no-data', detail: {} };
  }
  return pass(results.flatMap((r) => r.evidence ?? []).slice(0, 5));
}

const ok = (evidence) => ({ state: 'pass', evidence: evidence ? [evidence] : [] });
const no = (extra = {}) => ({ state: 'fail', ...extra });

// ---------- hygiene.tests ----------

const RUNNERS = ['vitest', 'jest', 'mocha', 'ava', 'tap', 'uvu', 'jasmine', 'playwright', '@playwright/test', 'cypress', '@web/test-runner', 'karma'];
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/.+|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(dart|go|py)$|(^|\/)test_.+\.py$|Test\.php$/;
const PHPUNIT = ['phpunit.xml', 'phpunit.xml.dist', 'phpunit.dist.xml'];

function testsUnit(u, ctx) {
  const key = scriptHit(u.scripts, /^tests?(:.+)?$/);
  if (key) return ok(scriptEvidence(ctx, u, key));
  const testRows = u.rows.filter((r) => r.kind === 'test' || TEST_FILE.test(r.path.slice(u.dir ? u.dir.length + 1 : 0)));
  const json = u.kind === 'dart' ? null : jsonOf(ctx, u.manifest);
  if (u.kind === 'dart') {
    const dart = testRows.find((r) => r.path.endsWith('.dart'));
    return dart ? ok({ file: dart.path }) : no();
  }
  if (u.kind === 'php') {
    const cfg = configFor(ctx, u, PHPUNIT);
    if (cfg) return ok({ file: cfg });
    const pest = ['phpunit/phpunit', 'pestphp/pest'].some((d) => depsOf(json).has(d));
    return pest && testRows.length ? ok({ file: testRows[0].path }) : no();
  }
  if (u.kind === 'node') {
    const dep = RUNNERS.find((r) => depsOf(json).has(r));
    return dep && testRows.length ? ok({ file: testRows[0].path }) : no();
  }
  return testRows.length ? ok({ file: testRows[0].path }) : no();
}

// ---------- hygiene.lint ----------

const LINT_CONFIG = {
  node: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
    '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.mjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml',
    'biome.json', 'biome.jsonc', '.oxlintrc.json', 'oxlint.json'],
  dart: ['analysis_options.yaml'],
  php: ['phpcs.xml', 'phpcs.xml.dist', '.phpcs.xml', '.phpcs.xml.dist', 'phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon', 'psalm.xml', 'psalm.xml.dist', 'phpmd.xml'],
  other: ['ruff.toml', '.ruff.toml', '.flake8', '.pylintrc', 'pylintrc', '.golangci.yml', '.golangci.yaml', 'clippy.toml'],
};
const LINT_DEPS = ['phpstan/phpstan', 'larastan/larastan', 'nunomaduro/larastan', 'squizlabs/php_codesniffer', 'vimeo/psalm', 'phpmd/phpmd'];

function lintUnit(u, ctx) {
  const key = scriptHit(u.scripts, /^lint(:(?!fix\b).+)?$/, /\b(eslint|biome (check|lint)|oxlint|ruff|phpcs|phpstan|golangci-lint)\b/);
  if (key) return ok(scriptEvidence(ctx, u, key));
  const cfg = configFor(ctx, u, forKind({ ...LINT_CONFIG, other: u.pseudo ? LINT_CONFIG.other : [] }, u));
  if (cfg) return ok({ file: cfg });
  if (u.kind === 'node' || u.pseudo) {
    const f = fieldHit(ctx, u, 'eslintConfig');
    if (f) return ok(f);
  }
  if (u.kind === 'php') {
    const dep = LINT_DEPS.find((d) => depsOf(jsonOf(ctx, u.manifest)).has(d));
    if (dep) return ok(fieldEvidence(ctx, u.manifest, dep));
  }
  return no();
}

// ---------- hygiene.formatter ----------

const FORMAT_CONFIG = {
  node: ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.json5', '.prettierrc.js', '.prettierrc.cjs',
    '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts',
    'biome.json', 'biome.jsonc', 'dprint.json', '.dprint.json'],
  php: ['pint.json', '.php-cs-fixer.php', '.php-cs-fixer.dist.php'],
  other: ['.clang-format', 'rustfmt.toml', '.rustfmt.toml'],
};
const FORMAT_DEPS = ['laravel/pint', 'friendsofphp/php-cs-fixer'];
const FORMAT_VALUE = /\b(prettier|biome (format|check)|dprint|pint|php-cs-fixer|dart format|black|ruff format|gofmt|rustfmt|cargo fmt)\b/;

function formatterUnit(u, ctx) {
  const key = scriptHit(u.scripts, /^(format|fmt)(:.+)?$/, FORMAT_VALUE);
  if (key) return ok(scriptEvidence(ctx, u, key));
  const cfg = configFor(ctx, u, forKind(FORMAT_CONFIG, u));
  if (cfg) return ok({ file: cfg });
  if (u.kind === 'node' || u.pseudo) {
    const f = fieldHit(ctx, u, 'prettier');
    if (f) return ok(f);
  }
  if (u.kind === 'php') {
    const dep = FORMAT_DEPS.find((d) => depsOf(jsonOf(ctx, u.manifest)).has(d));
    if (dep) return ok(fieldEvidence(ctx, u.manifest, dep));
  }
  if (u.kind === 'dart' || u.pseudo) {
    // `dart format` ships with the SDK: the setting is the formatter section, or CI enforcing it.
    const opts = configFor(ctx, u, ['analysis_options.yaml']);
    if (opts && /^formatter\s*:/m.test(ctx.read(opts) ?? '')) return ok({ file: opts });
    const ci = ciHit(ctx, /\b(dart format|cargo fmt|gofmt|black|ruff format)\b/);
    if (ci) return ok(ci);
  }
  return no();
}

// ---------- hygiene.typecheck ----------

const TS_CONFIGS = ['tsconfig.json'];
const TYPE_KEY = /^(typecheck|type-check|check-types|types|tsc)(:.+)?$/;
const TYPE_VALUE = /\b(tsc|vue-tsc|svelte-check|pyright|mypy)\b/;
const PHP_TYPES = ['phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon', 'psalm.xml', 'psalm.xml.dist'];
const PHP_TYPE_DEPS = ['phpstan/phpstan', 'larastan/larastan', 'nunomaduro/larastan', 'vimeo/psalm'];

// true / false, or null when the census cannot tell (an extends that lives in node_modules, a file too big to read).
function tsStrict(ctx, path, depth = 0) {
  if (depth > 6) return null;
  const json = jsonOf(ctx, path);
  if (!json) return null;
  const own = json.compilerOptions?.strict;
  if (typeof own === 'boolean') return own;
  const chain = [];
  const list = Array.isArray(json.extends) ? json.extends : (typeof json.extends === 'string' ? [json.extends] : []);
  for (const spec of list) chain.push(extendsStrict(ctx, path, spec, depth));
  // The later entry wins in TypeScript; an unknown one leaves the answer open unless a later one is known.
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i] !== undefined) return chain[i];
  if (Array.isArray(json.references) && json.references.length) {
    const refs = json.references.map((r) => (typeof r?.path === 'string' ? tsStrict(ctx, refPath(ctx, path, r.path), depth + 1) : null));
    if (refs.includes(true)) return true;
    return refs.includes(null) ? null : false;
  }
  return false;
}

function refPath(ctx, from, ref) {
  const target = resolveRel(dirOf(from), ref);
  return /\.json$/.test(target) ? target : join(target, 'tsconfig.json');
}

function resolveRel(dir, rel) {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function extendsStrict(ctx, from, spec, depth) {
  if (spec.startsWith('.')) {
    let target = resolveRel(dirOf(from), spec);
    if (!/\.json$/.test(target)) target += '.json';
    return ctx.has(target) ? tsStrict(ctx, target, depth + 1) : null;
  }
  if (/^@tsconfig\//.test(spec) || /strict/i.test(spec)) return true;
  const name = /^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/.exec(spec);
  const ws = name && ctx.packages.find((p) => p.name === name[1]);
  if (!ws) return null;
  let target = join(ws.dir, (name[2] ?? '/tsconfig.json').slice(1) || 'tsconfig.json');
  if (!/\.json$/.test(target)) target += '.json';
  return ctx.has(target) ? tsStrict(ctx, target, depth + 1) : null;
}

function typecheckUnit(u, ctx) {
  if (u.kind === 'dart') {
    const cfg = configFor(ctx, u, ['analysis_options.yaml']);
    return cfg ? ok({ file: cfg }) : no();
  }
  if (u.kind === 'php') {
    const cfg = configFor(ctx, u, PHP_TYPES);
    if (cfg) return ok({ file: cfg });
    const dep = PHP_TYPE_DEPS.find((d) => depsOf(jsonOf(ctx, u.manifest)).has(d));
    return dep ? ok(fieldEvidence(ctx, u.manifest, dep)) : no();
  }
  const key = scriptHit(u.scripts, TYPE_KEY, TYPE_VALUE);
  if (key) return ok(scriptEvidence(ctx, u, key));
  const ts = configFor(ctx, u, TS_CONFIGS);
  if (ts) {
    const strict = tsStrict(ctx, ts);
    if (strict === true) return ok({ file: ts });
    const text = ctx.read(ts);
    const evidence = [at(ts, lineOfKey(text, 'strict') ?? lineOfKey(text, 'compilerOptions'))];
    return strict === null ? { state: 'unknown', evidence } : no({ evidence, detail: { what: 'strict' } });
  }
  const js = configFor(ctx, u, ['jsconfig.json']);
  if (js && jsonOf(ctx, js)?.compilerOptions?.checkJs === true) return ok({ file: js });
  const other = u.pseudo ? configFor(ctx, u, ['mypy.ini', '.mypy.ini', 'pyrightconfig.json']) : null;
  return other ? ok({ file: other }) : no();
}

// ---------- hygiene.build ----------

const BUILD_CMD = /\b(build|compile|assemble|bundle)\b|\btsc\b(?!.*--noEmit)/i;

function buildUnit(u, ctx) {
  // Only Node packages carry a build script of their own; Dart and PHP are built (or not) by CI, which is judged below.
  if (u.kind !== 'node') return { state: 'pass' };
  const key = scriptHit(u.scripts, /^(build|compile)(:.+)?$/);
  return key ? ok(scriptEvidence(ctx, u, key)) : no();
}

function buildCheck(ctx) {
  const pk = perPackage(ctx, { keyRe: /^(build|compile)(:.+)?$/, unit: buildUnit });
  if (pk.state === 'na') return pk;
  const ci = ciHit(ctx, BUILD_CMD);
  if (pk.state === 'pass' && ci) return pass([...pk.evidence, ci]);
  if (pk.state === 'unverified') return pk;
  const files = ciFilesOf(ctx).map((file) => ({ file }));
  return {
    state: 'fail',
    evidence: pk.state === 'fail' ? pk.evidence : files,
    reason: 'missing',
    detail: { ...(pk.detail ?? {}), ci: Boolean(ci) },
    ...(pk.packages ? { packages: pk.packages } : {}),
  };
}

// ---------- the repo-wide items ----------

function ciCheck(ctx) {
  if (!ctx.hasCode) return NA();
  const files = ciFilesOf(ctx);
  return files.length ? pass([{ file: files[0] }], { count: files.length }) : fail();
}

const COVERAGE_RE = /--coverage|--experimental-test-coverage|\b(c8|nyc|istanbul|lcov|codecov|coveralls)\b|\bcoverage\b/i;
const COVERAGE_FILES = new Set(['.nycrc', '.nycrc.json', '.nycrc.yml', '.nycrc.yaml', '.c8rc', '.c8rc.json', 'codecov.yml', '.codecov.yml', '.coveragerc', 'lcov.info']);
const COVERAGE_IN_CONFIG = /^(vitest|vite|jest)\.config\.[cm]?[jt]s$/;
const PHPUNIT_COVERAGE = /<(coverage|source)\b/;

function coverageCheck(ctx) {
  if (!ctx.hasCode) return NA();
  for (const p of ctx.packages) {
    const key = Object.keys(p.scripts).find((k) => COVERAGE_RE.test(p.scripts[k]));
    if (key) return pass([scriptEvidence(ctx, p, key)]);
    if (p.kind !== 'dart') {
      const json = jsonOf(ctx, p.manifest);
      const field = ['nyc', 'c8'].find((f) => json?.[f] != null) ?? (json?.jest?.collectCoverage ? 'jest' : null);
      if (field) return pass([fieldEvidence(ctx, p.manifest, field)]);
    }
  }
  const ci = ciHit(ctx, COVERAGE_RE);
  if (ci) return pass([ci]);
  for (const path of ctx.list('')) {
    const name = baseOf(path);
    if (COVERAGE_FILES.has(name)) return pass([{ file: path }]);
    if (COVERAGE_IN_CONFIG.test(name) && /\bcoverage\b/.test(ctx.read(path) ?? '')) return pass([{ file: path }]);
    if (PHPUNIT.includes(name) && PHPUNIT_COVERAGE.test(ctx.read(path) ?? '')) return pass([{ file: path }]);
  }
  return fail();
}

const HOOK_FILES = new Set(['lefthook.yml', '.lefthook.yml', 'lefthook.yaml', 'lefthook.json', '.pre-commit-config.yaml', '.simple-git-hooks.json',
  'simple-git-hooks.js', '.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yml', '.lintstagedrc.yaml', '.lintstagedrc.js', '.lintstagedrc.cjs',
  '.lintstagedrc.mjs', 'lint-staged.config.js', 'lint-staged.config.cjs', 'lint-staged.config.mjs']);
const HOOK_FIELDS = ['lint-staged', 'simple-git-hooks', 'husky'];
const HOOK_SCRIPT = /core\.hooksPath|\bhusky\b|lefthook install|simple-git-hooks/;

function hooksCheck(ctx) {
  if (!ctx.hasCode) return NA();
  for (const path of ctx.list('')) {
    if (/(^|\/)\.husky\/[^/]+/.test(path) || HOOK_FILES.has(baseOf(path))) return pass([{ file: path }]);
  }
  for (const p of ctx.packages) {
    if (p.kind === 'dart') continue;
    const json = jsonOf(ctx, p.manifest);
    const field = HOOK_FIELDS.find((f) => json?.[f] != null);
    if (field) return pass([fieldEvidence(ctx, p.manifest, field)]);
    const key = Object.keys(p.scripts).find((k) => HOOK_SCRIPT.test(p.scripts[k]));
    if (key) return pass([scriptEvidence(ctx, p, key)]);
  }
  return fail();
}

const COMMITLINT_FILE = /^(commitlint\.config\.[cm]?[jt]s|\.commitlintrc(\.(json|ya?ml|[cm]?[jt]s))?)$/;

function commitlintCheck(ctx) {
  if (!ctx.hasCode) return NA();
  const file = ctx.list('').find((p) => COMMITLINT_FILE.test(baseOf(p)));
  if (file) return pass([{ file }]);
  for (const p of ctx.packages) {
    if (p.kind !== 'dart' && jsonOf(ctx, p.manifest)?.commitlint != null) return pass([fieldEvidence(ctx, p.manifest, 'commitlint')]);
  }
  return fail();
}

// ---------- the nine ----------

export const CHECKS = Object.freeze({
  'hygiene.ci': ciCheck,
  'hygiene.tests': (ctx) => perPackage(ctx, { keyRe: /^tests?(:.+)?$/, unit: testsUnit }),
  'hygiene.lint': (ctx) => perPackage(ctx, { keyRe: /^lint(:(?!fix\b).+)?$/, unit: lintUnit }),
  'hygiene.formatter': (ctx) => perPackage(ctx, { keyRe: /^(format|fmt)(:.+)?$/, valueRe: FORMAT_VALUE, unit: formatterUnit }),
  'hygiene.typecheck': (ctx) => perPackage(ctx, { keyRe: TYPE_KEY, valueRe: TYPE_VALUE, unit: typecheckUnit }),
  'hygiene.build': buildCheck,
  'hygiene.coverage': coverageCheck,
  'hygiene.hooks': hooksCheck,
  'hygiene.commitlint': commitlintCheck,
});
