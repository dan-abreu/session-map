// The join of the readers (fd02, fd12): runs every extractor on the files the census includes, in the language each one
// reads, and puts what they found in one facts.json (contract section 3). The code is the only source: nothing here asks
// an AI, and nothing here is a guess. What a reader cannot decide stays AMBIGUOUS, with every candidate in refs.
//
//   extractAll(root, census, prevFacts, { readText, now, extractors, log }) -> facts.json
//
// Incremental: a file whose sha, extractors' versions and package (its dependencies decide what is a route) are the same
// as in prevFacts is not read again; its raw output (kept in files[path].raw) is joined again with the rest, because
// the joins cross files (a prefix registered in one file, a dispatch in another, a call to an imported function).
// A file with included: false, or a secrets file, is never read. Synchronous on purpose: callers that care about the
// event loop run it in slices of their own.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { lex } from '../lex.mjs';
import { typeOf } from '../census.mjs';
import { isSecretsFile } from '../../files.mjs';
import { log as defaultLog } from '../../log.mjs';
import { specifiersIn, resolveSpec } from '../../imports.mjs';
import * as js from './js.mjs';
import * as prisma from './prisma.mjs';
import * as dart from './dart.mjs';
import * as php from './php.mjs';
import * as config from './config.mjs';
import * as functions from './functions.mjs';
import { resolveDartHints } from './dart.mjs';
import { importNames, linkCalls } from './functions.mjs';

// Order is the order of the version string kept per file. functions goes last: it only reads what the others leave.
export const EXTRACTORS = [js, prisma, dart, php, config, functions];

export const IMPORTS_VERSION = 'imports@1';
// @2: the manifest also keeps what Dart and PHP names need (pubspec name, composer psr-4), see contextOf.
const WORKSPACE_VERSION = 'workspace@2';
const IMPORT_TYPES = new Set(['js', 'ts', 'tsx', 'jsx', 'dart', 'php']);
// A source file bigger than this is a bundle or a dump, not something a person wrote: skipped, said in the entry.
const MAX_BYTES = 2 * 1024 * 1024;
const MANIFESTS = { 'package.json': 'js', 'pubspec.yaml': 'dart', 'composer.json': 'php' };
const MANIFEST_ORDER = ['js', 'dart', 'php'];
const PREFERRED = { dart: 'dart', yaml: 'dart', php: 'php', blade: 'php' };

const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const idOf = (extractor) => String(extractor.VERSION).split('@')[0];
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

// Which files an extractor opens besides its TYPES: the config reader only wants .env.example files and turbo.json, and
// Dart's yaml is only the pubspec. Without this, every LICENSE and every json in the project would be read for nothing.
function wants(extractor, path, type) {
  if (!extractor.TYPES.includes(type)) return false;
  const base = baseOf(path);
  const id = idOf(extractor);
  if (id === 'config') return base === 'turbo.json' || /^\.env(\..+)?\.example$/i.test(base);
  if (id === 'dart' && type === 'yaml') return base === 'pubspec.yaml';
  return true;
}

// ---------- the package of a file ----------

function psr4Of(json) {
  const out = [];
  for (const map of [json?.autoload?.['psr-4'], json?.['autoload-dev']?.['psr-4']]) {
    if (!map || typeof map !== 'object') continue;
    for (const [prefix, dirs] of Object.entries(map)) {
      for (const dir of [].concat(dirs)) if (typeof dir === 'string') out.push({ prefix, dir: dir.replace(/^\.\//, '').replace(/\/+$/, '') });
    }
  }
  return out;
}

function manifestInfo(kind, path, text, rootName) {
  const dir = dirOf(path);
  let name = null;
  let deps = [];
  let psr4 = [];
  if (kind === 'dart') {
    name = /^name:[ \t]*['"]?([\w.-]+)/m.exec(text)?.[1] ?? null;
  } else {
    try {
      const json = JSON.parse(text);
      if (typeof json?.name === 'string') name = json.name;
      if (kind === 'js') deps = [...new Set([...Object.keys(json?.dependencies ?? {}), ...Object.keys(json?.devDependencies ?? {})])].sort();
      if (kind === 'php') psr4 = psr4Of(json);
    } catch { /* not valid JSON: the package keeps no name and no dependencies */ }
  }
  const info = { kind, dir, name: name ?? (dir ? baseOf(dir) : rootName), deps };
  if (kind === 'dart') info.pubName = name;
  if (kind === 'php') info.psr4 = psr4;
  return info;
}

// What resolveSpec needs for Dart (package: names) and PHP (psr-4), built from the manifests this run already has: a
// kept manifest is not read again, and the injected readText stays the only way to the disk.
function contextOf(manifests) {
  const ctx = { dart: [], php: [] };
  for (const path of [...manifests.keys()].sort(byCodeUnit)) {
    const m = manifests.get(path);
    if (m.kind === 'dart' && m.pubName) ctx.dart.push({ dir: m.dir, name: m.pubName });
    if (m.kind === 'php' && m.psr4?.length) ctx.php.push({ dir: m.dir, psr4: m.psr4 });
  }
  return ctx;
}

// The nearest package for a file: the manifest of its own language first (a Laravel app that also has a package.json for
// its assets is a PHP package for its .php files), else any manifest, else the root of the project.
function workspaceOf(path, type, byDir, rootName) {
  const order = [PREFERRED[type] ?? 'js', ...MANIFEST_ORDER];
  for (const kind of [...new Set(order)]) {
    for (let dir = dirOf(path); ; dir = dirOf(dir)) {
      const info = byDir.get(dir)?.get(kind);
      if (info) return { dir: info.dir, name: info.name, deps: info.deps };
      if (!dir) break;
    }
  }
  return { dir: '', name: rootName, deps: [] };
}

// ---------- joining ----------

const joinPath = (a, b) => (b === '/' ? a || '/' : a.replace(/\/$/, '') + b);
const placeOf = (f) => `${f.file}:${f.line}`;
const nameOfId = (id) => id.slice(id.indexOf(':') + 1);

// Fastify: a file registered with { prefix } from another file runs its routes under that prefix, and the file that
// registers it may itself be registered with a prefix. Returns the prefixes a file runs under: '' (none), a string,
// or null (a prefix the program could not read; a cycle of registrations has no root, so it is one of those).
function effectivePrefixes(file, regsOf, stack = new Set()) {
  const regs = regsOf.get(file);
  if (!regs) return [''];
  // a chain too deep to follow has, like a cycle, an outer prefix the program did not read
  if (stack.has(file) || stack.size > 16) return [null];
  stack.add(file);
  const out = new Set();
  for (const reg of regs) {
    const outer = regsOf.has(reg.from) ? effectivePrefixes(reg.from, regsOf, stack) : [''];
    for (const o of outer) out.add(o === null || reg.prefix === null ? null : joinPath(o, reg.prefix));
  }
  stack.delete(file);
  return out.size ? [...out] : [''];
}

// The text a route id carries for a path the program could not read: written as ${expression}, unless it already is a
// chain written by the reader (it starts with / or ${).
function tailOf(route) {
  if (route.attrs.path !== null) return route.attrs.path;
  const rest = route.id.slice(route.id.indexOf('?') + 1);
  return rest.startsWith('/') || rest.startsWith('${') ? rest : `\${${rest}}`;
}

function prefixedRoutes(route, prefixes) {
  const out = [];
  for (const p of prefixes) {
    if (p === '') { out.push(route); continue; }
    const method = route.attrs.method;
    let id;
    let path = null;
    let origin = 'AMBIGUOUS';
    if (p !== null && route.attrs.path !== null) {
      path = joinPath(p, route.attrs.path);
      id = `route:${method} ${path}`;
      if (route.origin !== 'AMBIGUOUS') origin = 'INFERRED';
    } else {
      id = `route:${method} ?${p === null ? '${prefix}' : p}${tailOf(route)}`;
    }
    out.push({ ...route, id, name: nameOfId(id), origin, attrs: { ...route.attrs, path } });
  }
  return out;
}

function expandFastify(facts, hints, resolve) {
  const regsOf = new Map();
  for (const h of hints) {
    if (h.kind !== 'fastify-register') continue;
    const target = resolve(h.file, h.spec);
    if (!target || target === h.file) continue;
    if (!regsOf.has(target)) regsOf.set(target, []);
    regsOf.get(target).push({ from: h.file, prefix: h.prefix ?? null });
  }
  if (!regsOf.size) return facts;
  const out = [];
  const seen = new Set();
  for (const f of facts) {
    const isRoute = f.kind === 'route' && f.attrs?.framework === 'fastify' && regsOf.has(f.file);
    const made = isRoute ? prefixedRoutes(f, effectivePrefixes(f.file, regsOf)) : [f];
    for (const m of made) {
      const key = isRoute ? `${m.id}|${placeOf(m)}` : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(m);
    }
  }
  return out;
}

function addRef(fact, file, line) {
  if (fact.file === file && fact.line === line) return;
  if (!fact.refs.some((r) => r.file === file && r.line === line)) fact.refs.push({ file, line });
}

// PHP: `X::dispatch(...)` is a place that produces the job; it goes to the refs of the job fact (the class that
// implements ShouldQueue). The class is found by the full name (use + namespace), else by its short name if unique.
function joinDispatches(facts, hints, resolve) {
  const jobs = facts.filter((f) => f.kind === 'job' && f.attrs?.lib === 'laravel');
  for (const h of hints) {
    if (h.kind !== 'job-dispatch') continue;
    const file = resolve(h.file, h.fqcn);
    let hit = file ? jobs.filter((j) => j.file === file) : [];
    if (!hit.length) hit = jobs.filter((j) => j.name.endsWith(`/${h.class}`));
    if (hit.length === 1) addRef(hit[0], h.file, h.line);
  }
}

const ENV_RANK = { example: 0, turbo: 1, config: 2, code: 3 };
const PLACED_ONCE = new Set(['route', 'screen', 'table', 'relation']);

// One fact per id. Where a thing is written in many places by nature (a variable, a host, a producer of a job) the best
// place is the definition and the others are refs. Where it should be defined once (a route, a screen, a table, a queue)
// two different places make it AMBIGUOUS, with every place in refs.
function mergeGroup(kind, list) {
  let def = list[0];
  let rest = list.slice(1);
  let ambiguous = false;
  if (kind === 'env' || kind === 'integration') {
    const ranked = [...list].sort((a, b) => (ENV_RANK[a.attrs?.source] ?? 4) - (ENV_RANK[b.attrs?.source] ?? 4));
    def = ranked[0];
    rest = list.filter((f) => f !== def);
  } else if (kind === 'queue' && def.attrs?.lib !== 'laravel') {
    // a Worker or a QueueScheduler (attrs.use) only uses a queue that a `new Queue` defines
    const defs = list.filter((f) => !f.attrs?.use);
    def = defs[0] ?? list[0];
    rest = list.filter((f) => f !== def);
    ambiguous = defs.some((f) => placeOf(f) !== placeOf(def));
  } else if (kind === 'job') {
    const consumers = list.filter((f) => f.attrs?.role === 'consumer');
    def = consumers[0] ?? list[0];
    rest = list.filter((f) => f !== def);
    ambiguous = consumers.some((f) => placeOf(f) !== placeOf(def));
  } else if (PLACED_ONCE.has(kind)) {
    ambiguous = rest.some((f) => placeOf(f) !== placeOf(def));
  }
  const merged = { ...def, attrs: { ...def.attrs }, refs: [...(def.refs ?? [])] };
  if (kind === 'queue') delete merged.attrs.use;
  for (const f of rest) {
    addRef(merged, f.file, f.line);
    for (const r of f.refs ?? []) addRef(merged, r.file, r.line);
  }
  if (ambiguous) {
    merged.origin = 'AMBIGUOUS';
    // every candidate goes to refs, the definition too (addRef skips the fact's own place)
    if (!merged.refs.some((r) => r.file === def.file && r.line === def.line)) merged.refs.push({ file: def.file, line: def.line });
  }
  merged.refs.sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line);
  return merged;
}

function mergeFacts(facts) {
  const groups = new Map();
  for (const f of facts) {
    if (!groups.has(f.id)) groups.set(f.id, []);
    groups.get(f.id).push(f);
  }
  return [...groups.values()].map((list) => mergeGroup(list[0].kind, list));
}

// ---------- the run ----------

const usable = (prev) => (prev && prev.version === 1 && prev.files && typeof prev.files === 'object' ? prev : null);

export function extractAll(root, census, prevFacts, opts = {}) {
  const { now = new Date(), extractors = EXTRACTORS, log = defaultLog } = opts;
  const readText = opts.readText ?? ((path) => readFileSync(join(root, path), 'utf8'));
  const read = (path) => {
    const text = String(readText(path));
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  };
  const prev = usable(prevFacts)?.files ?? {};
  const rootName = String(root).replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'app';

  // what the census offers; a secrets file is never one of them, whatever the census says
  const rows = (census.files ?? [])
    .filter((f) => f.included && f.sha && !isSecretsFile(f.path))
    .map((f) => ({ ...f, type: f.type ?? typeOf(f.path) }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
  const filesArr = rows.map((r) => r.path);
  const filesSet = new Set(filesArr);
  const shaOf = new Map(rows.map((r) => [r.path, r.sha]));
  const nextDirs = new Set(filesArr.filter((p) => /^next\.config\.(?:js|mjs|cjs|ts)$/.test(baseOf(p))).map(dirOf));

  // pass 1: the manifests, to know the package of every other file
  const texts = new Map();
  const manifests = new Map();
  const byDir = new Map();
  for (const r of rows) {
    const kind = MANIFESTS[baseOf(r.path)];
    if (!kind) continue;
    let info = null;
    const before = prev[r.path];
    const sameVersion = String(before?.extractor ?? '').split(',').includes(WORKSPACE_VERSION);
    if (before?.sha === r.sha && sameVersion && before.raw?.manifest?.kind === kind) {
      info = before.raw.manifest;
    } else {
      try {
        const text = read(r.path);
        texts.set(r.path, text);
        info = manifestInfo(kind, r.path, text, rootName);
      } catch (error) {
        log('warn', 'foundation.manifest.unreadable', { path: r.path, error: String(error?.message ?? error) });
      }
    }
    if (!info) continue;
    manifests.set(r.path, info);
    if (!byDir.has(info.dir)) byDir.set(info.dir, new Map());
    byDir.get(info.dir).set(kind, info);
  }

  // pass 2: the readers
  const entries = new Map(); // path -> { sha, extractor, ws, raw }
  for (const r of rows) {
    const { path, type } = r;
    const exts = extractors.filter((e) => wants(e, path, type));
    const withFunctions = exts.some((e) => idOf(e) === 'functions');
    const withImports = IMPORT_TYPES.has(type);
    const manifest = manifests.get(path) ?? null;
    if (!exts.length && !withImports && !manifest) continue;
    const extractor = [...exts.map((e) => e.VERSION), withImports ? IMPORTS_VERSION : '', manifest ? WORKSPACE_VERSION : ''].filter(Boolean).join(',');
    const workspace = workspaceOf(path, type, byDir, rootName);
    const ws = sha12(`${workspace.dir}|${workspace.name}|${workspace.deps.join(',')}|${nextDirs.has(workspace.dir) ? 1 : 0}`);
    const before = prev[path];
    if (before?.sha === r.sha && before.extractor === extractor && before.ws === ws && before.raw) {
      entries.set(path, { sha: r.sha, extractor, ws, raw: before.raw });
      continue;
    }
    if (Number(r.bytes) > MAX_BYTES) {
      entries.set(path, { sha: r.sha, extractor, ws, raw: { facts: [], hints: [], specs: [], names: [], skipped: 'too-large', ...(manifest ? { manifest } : {}) } });
      continue;
    }
    let text;
    try {
      text = texts.get(path) ?? read(path);
    } catch (error) {
      log('warn', 'foundation.extract.unreadable', { path, error: String(error?.message ?? error) });
      continue; // no entry: the next run tries again
    }
    let masked = text;
    try { masked = lex(text, type).masked; } catch { /* the readers take the plain text */ }
    const raw = { facts: [], hints: [], specs: [], names: [] };
    for (const e of exts) {
      try {
        const out = e.extract({ path, type, text, masked, workspace, files: filesArr });
        for (const f of out.facts ?? []) raw.facts.push({ ...f, sha: r.sha });
        for (const h of out.hints ?? []) raw.hints.push({ ...h, file: h.file ?? path });
      } catch (error) {
        log('warn', 'foundation.extract.failed', { path, extractor: e.VERSION, error: String(error?.message ?? error) });
      }
    }
    if (withFunctions) {
      try { raw.names = importNames({ path, type, text, masked }); } catch { /* no import names for this file */ }
    }
    if (withImports) {
      try { raw.specs = specifiersIn(text, path); } catch { /* no import lines for this file */ }
    }
    if (manifest) raw.manifest = manifest;
    entries.set(path, { sha: r.sha, extractor, ws, raw });
  }

  // the joins
  const ctx = contextOf(manifests);
  const resolve = (from, spec) => resolveSpec(from, spec, filesSet, ctx);
  const paths = [...entries.keys()];
  let facts = [];
  const hints = [];
  for (const path of paths) {
    const { raw } = entries.get(path);
    facts.push(...structuredClone(raw.facts));
    hints.push(...raw.hints);
  }
  facts = expandFastify(facts, hints, resolve);
  facts = resolveDartHints(facts, hints.filter((h) => h.kind === 'dart-widget' || h.kind === 'dart-route'));
  joinDispatches(facts, hints, resolve);

  const imports = {};
  for (const path of paths) {
    const list = [];
    for (const n of entries.get(path).raw.names ?? []) {
      const file = resolve(path, n.spec);
      if (file) list.push({ name: n.name, imported: n.imported, file });
    }
    if (list.length) imports[path] = list;
  }
  const callable = facts.filter((f) => f.kind === 'function' || f.kind === 'export');
  const callHints = hints.filter((h) => h.kind === 'call-site' || h.kind === 'php-namespace' || h.kind === 'php-guarded');
  for (const c of linkCalls(callable, callHints, { imports })) facts.push({ ...c, sha: shaOf.get(c.file) });

  for (const path of paths) {
    const places = new Map();
    for (const { spec, line } of entries.get(path).raw.specs ?? []) {
      const target = resolve(path, spec);
      if (!target || target === path) continue;
      if (!places.has(target)) places.set(target, { spec, lines: [] });
      places.get(target).lines.push(line);
    }
    for (const [target, { spec, lines }] of places) {
      const id = `import:${path}->${target}`;
      facts.push({
        id, kind: 'import', name: nameOfId(id), file: path, line: lines[0], sha: shaOf.get(path), origin: 'EXTRACTED',
        extractor: IMPORTS_VERSION, attrs: { spec, library: false }, refs: [...new Set(lines)].filter((l) => l !== lines[0]).map((line) => ({ file: path, line })),
      });
    }
  }

  const merged = mergeFacts(facts).map((f) => ({ ...f, sha: f.sha ?? shaOf.get(f.file) }));
  merged.sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || byCodeUnit(a.id, b.id));
  const idsOf = new Map();
  for (const f of merged) {
    if (!idsOf.has(f.file)) idsOf.set(f.file, []);
    idsOf.get(f.file).push(f.id);
  }
  const files = {};
  for (const path of [...paths].sort(byCodeUnit)) {
    const e = entries.get(path);
    files[path] = { sha: e.sha, extractor: e.extractor, factIds: idsOf.get(path) ?? [], ws: e.ws, raw: e.raw };
  }
  return { version: 1, generatedAt: now.toISOString(), censusRev: census.rev ?? null, files, facts: merged };
}
