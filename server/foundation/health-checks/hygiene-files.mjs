// Health (fd08), the nine "hygiene - files" checks. Each is a pure function of the health context:
//   check(ctx) -> { state, evidence, reason, detail, packages? }
// Nothing is written and no value of an environment variable ever leaves: only names, files and line numbers.
// The real .env is never opened (ctx.read refuses it); only the example/sample/dist templates are read.
// `ctx.facts` (optional, the `env` facts of fd02) lists the variables read by the code; without it the check
// only looks at the example file.

const out = (state, { evidence = [], reason = null, detail = {}, packages } = {}) => {
  const r = { state, evidence, reason, detail };
  if (packages) r.packages = packages;
  return r;
};
const pass = (evidence, detail) => out('pass', { evidence, detail });
const fail = (reason, evidence = [], detail = {}, packages) => out('fail', { evidence, reason, detail, packages });

const NAMES_MAX = 20;
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const show = (dir) => dir || '.';
const listNames = (names) => [...new Set(names)].sort().slice(0, NAMES_MAX);

// A file in the repository root, any case. Returns { path, text } or null; text is null when it cannot be read.
function rootFile(ctx, names) {
  const path = ctx.find(names, { dirs: [''], exts: [''] });
  return path ? { path, text: ctx.read(path) } : null;
}

const noData = (path) => out('unverified', { evidence: [{ file: path }], reason: 'no-data' });

// ---------- editorconfig, gitignore, gitattributes ----------

function editorconfig(ctx) {
  const f = rootFile(ctx, ['.editorconfig']);
  if (!f) return fail('missing');
  if (f.text == null) return noData(f.path);
  if (!/^\s*root\s*=\s*true\s*$/im.test(f.text)) return fail('invalid', [{ file: f.path }]);
  return pass([{ file: f.path }]);
}

const GITIGNORE_MIN = 3;

function gitignore(ctx) {
  const f = rootFile(ctx, ['.gitignore']);
  if (!f) return fail('missing');
  if (f.text == null) return noData(f.path);
  const patterns = f.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (patterns.length < GITIGNORE_MIN) return fail('too-short', [{ file: f.path }], { count: patterns.length });
  return pass([{ file: f.path }], { count: patterns.length });
}

function gitattributes(ctx) {
  const f = rootFile(ctx, ['.gitattributes']);
  if (!f) return fail('missing');
  if (f.text == null) return noData(f.path);
  if (!/\btext\s*=\s*auto\b|\beol\s*=/.test(f.text)) return fail('invalid', [{ file: f.path }]);
  return pass([{ file: f.path }]);
}

// ---------- .env.example and its documentation ----------

const EXAMPLE_RE = /^(\.env\.(example|sample|dist|template)|env\.example|example\.env)$/i;
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const PLACEHOLDER_RE = /your|change|replace|example|placeholder|todo|dummy|fake|insert|redacted|xxx|\.\.\.|^\$\{?[\w:-]*\}?$|^<.*>$|^\[.*\]$|^(null|none|true|false)$/i;
const KNOWN_TOKEN_RE = /^(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.|sk-[A-Za-z0-9_-]{16,}|-----BEGIN)/;
const SECRET_NAME_RE = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL/i;
const SECRET_MIN = 8;

function cleanValue(raw) {
  let v = raw.trim();
  const quote = /^(["'])(.*?)\1/.exec(v);
  if (quote) return quote[2];
  v = v.replace(/\s+#.*$/, '');
  return v.trim();
}

function looksReal(name, value) {
  if (!value || PLACEHOLDER_RE.test(value) || /^(.)\1*$/.test(value)) return false;
  if (KNOWN_TOKEN_RE.test(value)) return true;
  return SECRET_NAME_RE.test(name) && value.length >= SECRET_MIN;
}

// The template files with their variable names and the lines that carry a real-looking value (line numbers only).
function examplesOf(ctx) {
  const files = ctx.list('').filter((p) => EXAMPLE_RE.test(baseOf(p)));
  const found = [];
  for (const path of files) {
    const text = ctx.read(path);
    if (text == null) continue;
    const names = [];
    const unsafe = [];
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const m = LINE_RE.exec(line);
      if (!m) return;
      names.push(m[1]);
      if (looksReal(m[1], cleanValue(m[2]))) unsafe.push({ file: path, line: i + 1 });
    });
    found.push({ path, names, unsafe });
  }
  return { files, found };
}

const factNames = (ctx) => {
  const names = [];
  for (const f of Array.isArray(ctx.facts) ? ctx.facts : []) {
    if (f?.kind !== 'env' || f.attrs?.source === 'example') continue;
    const name = f.name ?? String(f.id ?? '').replace(/^env:/, '');
    if (name) names.push(name);
  }
  return names;
};

function envExample(ctx) {
  const { files, found } = examplesOf(ctx);
  if (!files.length) return fail('missing');
  if (!found.length) return noData(files[0]);
  const unsafe = found.flatMap((f) => f.unsafe);
  if (unsafe.length) return fail('unsafe', unsafe, { count: unsafe.length });
  const have = new Set(found.flatMap((f) => f.names));
  const missing = [...new Set(factNames(ctx))].filter((n) => !have.has(n));
  const evidence = found.map((f) => ({ file: f.path }));
  if (missing.length) return fail('missing', evidence, { names: listNames(missing), count: missing.length });
  return pass(evidence, { count: have.size });
}

const DOC_EXT_RE = /\.(md|mdx|txt|rst)$/i;
const DOCS_MAX = 60;

function configDoc(ctx) {
  const { found } = examplesOf(ctx);
  const names = [...new Set(found.flatMap((f) => f.names))];
  if (!names.length) return out('unverified', { evidence: found.map((f) => ({ file: f.path })), reason: 'no-data' });
  const exampleFiles = new Set(found.map((f) => f.path));
  const docs = ctx.list('').filter((p) => (!p.includes('/') || p.startsWith('docs/')) && DOC_EXT_RE.test(p) && !exampleFiles.has(p)).slice(0, DOCS_MAX);
  const texts = docs.map((p) => [p, ctx.read(p)]).filter(([, t]) => t != null);
  const mentioned = (name) => {
    const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
    return texts.find(([, t]) => re.test(t))?.[0] ?? null;
  };
  const hits = new Set();
  const lacking = [];
  for (const n of names) {
    const where = mentioned(n);
    if (where) hits.add(where);
    else lacking.push(n);
  }
  if (lacking.length) return fail('missing', [...hits].map((file) => ({ file })), { names: listNames(lacking), count: lacking.length });
  return pass([...hits].sort().map((file) => ({ file })), { count: names.length });
}

// ---------- lockfile and runtime pin ----------

const LOCKS = {
  node: ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'],
  php: ['composer.lock'],
  dart: ['pubspec.lock'],
};

const lowerPaths = (ctx) => new Map(ctx.list('').map((p) => [p.toLowerCase(), p]));

function lockfile(ctx) {
  if (!ctx.packages.length) return out('na', { reason: 'no-code' });
  const paths = lowerPaths(ctx);
  const lockIn = (dir, kind) => {
    for (const name of LOCKS[kind] ?? []) {
      const hit = paths.get(dir ? `${dir.toLowerCase()}/${name}` : name);
      if (hit) return hit;
    }
    return null;
  };
  const evidence = [];
  const lacking = [];
  for (const pkg of ctx.packages) {
    const own = lockIn(pkg.dir, pkg.kind);
    const root = pkg.dir ? lockIn('', pkg.kind) : null;
    const hit = own ?? root;
    if (hit) {
      if (!evidence.some((e) => e.file === hit)) evidence.push({ file: hit });
    } else lacking.push(show(pkg.dir));
  }
  if (lacking.length) return fail('missing', evidence, { names: listNames(lacking), count: lacking.length });
  return pass(evidence);
}

const PIN_FILES = ['.nvmrc', '.node-version', '.tool-versions', '.python-version', '.ruby-version', '.php-version', '.java-version', '.sdkmanrc', 'mise.toml', '.mise.toml'];
const PIN_SET = new Set(PIN_FILES);

function manifestPins(ctx, pkg) {
  const text = ctx.read(pkg.manifest);
  if (text == null) return false;
  if (pkg.kind === 'dart') return /^\s+sdk:\s*\S/m.test(text);
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return false; }
  if (pkg.kind === 'php') return Boolean(data?.require?.php || data?.config?.platform?.php);
  const engines = data?.engines;
  return Boolean(engines && typeof engines === 'object' && Object.keys(engines).length);
}

function runtimePin(ctx) {
  const rootPin = ctx.list('').find((p) => !p.includes('/') && PIN_SET.has(p.toLowerCase()));
  if (!ctx.packages.length) return rootPin ? pass([{ file: rootPin }]) : out('na', { reason: 'no-code' });
  if (rootPin) return pass([{ file: rootPin }]);
  const states = ctx.packages.map((pkg) => {
    const own = ctx.list(pkg.dir ? `${pkg.dir}/` : '').find((p) => dirOf(p) === pkg.dir && PIN_SET.has(baseOf(p).toLowerCase()));
    if (own) return { dir: pkg.dir, state: 'pass', file: own };
    return manifestPins(ctx, pkg) ? { dir: pkg.dir, state: 'pass', file: pkg.manifest } : { dir: pkg.dir, state: 'fail', file: null };
  }).sort((a, b) => a.dir.localeCompare(b.dir));
  const packages = states.map(({ dir, state }) => ({ dir, state }));
  const evidence = states.filter((s) => s.file).map((s) => ({ file: s.file }));
  const lacking = states.filter((s) => s.state === 'fail').map((s) => show(s.dir));
  if (lacking.length) return fail('missing', evidence, { names: listNames(lacking), count: lacking.length }, states.length > 1 ? packages : undefined);
  return states.length > 1 ? { ...pass(evidence), packages } : pass(evidence);
}

// ---------- devcontainer and license check ----------

function devcontainer(ctx) {
  const hit = ctx.list('').find((p) => p === '.devcontainer.json' || (p.startsWith('.devcontainer/') && baseOf(p) === 'devcontainer.json'));
  return hit ? pass([{ file: hit }]) : fail('missing');
}

const LICENSE_TOOL_RE = /license-checker|licensee|license-report|license-compliance|license-webpack-plugin|composer-?license|pub[-_]?licenses?|cargo[- ]deny|\bfossa\b|scancode|pip-licenses|go-licenses/i;
const LICENSE_DOC_RE = /^(third[-_ ]?party([-_ ](notices?|licenses?))?|notices?|licenses|dependencies[-_]licenses?|licenses[-_]summary)(\.(md|txt|json|csv))?$/i;
const LICENSE_CONFIG_RE = /^(\.licensed\.ya?ml|\.licenserc(\..+)?|\.licensee)$/i;

function licenseCheck(ctx) {
  const evidence = [];
  for (const pkg of ctx.packages) {
    const text = ctx.read(pkg.manifest);
    if (text != null && LICENSE_TOOL_RE.test(text)) evidence.push({ file: pkg.manifest });
  }
  for (const p of ctx.list('')) {
    const top = !p.includes('/') || p.startsWith('docs/');
    if (top && (LICENSE_DOC_RE.test(baseOf(p)) || (!p.includes('/') && LICENSE_CONFIG_RE.test(p)))) evidence.push({ file: p });
  }
  const ci = ctx.list('').filter((p) => p.startsWith('.github/workflows/') || p === '.gitlab-ci.yml');
  for (const p of ci) {
    const text = ctx.read(p);
    if (text != null && LICENSE_TOOL_RE.test(text)) evidence.push({ file: p });
  }
  return evidence.length ? pass(evidence) : fail('missing');
}

export const CHECKS = Object.freeze({
  'hygiene.editorconfig': editorconfig,
  'hygiene.gitignore': gitignore,
  'hygiene.gitattributes': gitattributes,
  'hygiene.env_example': envExample,
  'hygiene.config_doc': configDoc,
  'hygiene.lockfile': lockfile,
  'hygiene.runtime_pin': runtimePin,
  'hygiene.devcontainer': devcontainer,
  'hygiene.license_check': licenseCheck,
});
