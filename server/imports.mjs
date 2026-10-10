// Which files a file uses and which files use it (mind-map-page mm26), read by session-map itself from the import lines
// of JavaScript, TypeScript, CSS, HTML, Dart and PHP, with no dependency. A cheap reader: it skips commented-out lines but
// not every trick a bundler knows (path aliases, re-exports through a package); the foundation's extractors (fd series)
// refine it. Dart and PHP are read on the lexer's masked text, so a comment or a string never counts as an import.
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { countRepo } from './sources/count.mjs';
import { lex, literalAt, lineAt as lineOf } from './foundation/lex.mjs';

const SCRIPT_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro']);
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less']);
const PAGE_EXT = new Set(['html', 'htm']);
const TRY_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json', '.css', '.scss'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const SCRIPT_RES = [
  /\bimport\s+(?:type\s+)?(?:[\w*$\s{},]+?\s+from\s*)?(['"])([^'"\n]+)\1/g,
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g,
  /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
];
const STYLE_RES = [/@import\s+(?:url\(\s*)?(['"])([^'"\n]+)\1/g];
const PAGE_RES = [/<script\b[^>]*?\bsrc=(["'])([^"'\n]+)\1/gi, /<link\b[^>]*?\bhref=(["'])([^"'\n]+)\1/gi];
const COMMENT_LINE_RE = /^[ \t]*(\/\/|\*|\/\*)[^\n]*$/gm;
const URL_RE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
const FILE_MAX = 1024 * 1024;

const extOf = (path) => {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};
const kindOf = (path) => {
  const ext = extOf(path);
  if (ext === 'dart' || ext === 'php') return ext;
  return SCRIPT_EXT.has(ext) ? 'script' : STYLE_EXT.has(ext) ? 'style' : PAGE_EXT.has(ext) ? 'page' : null;
};

const DART_RE = /^[ \t]*(?:import|export|part)[ \t\r\n]+(?=r?['"])/gm;
const PHP_USE_RE = /^[ \t]*use[ \t\r\n]+(?!function\b|const\b)(?![ \t]*\()/gim;
const PHP_REQUIRE_RE = /(?<![\w$>@:])(?:require|include)(?:_once)?\b[ \t]*\(?[ \t]*(?:(__DIR__|dirname\(\s*__DIR__\s*\))[ \t]*\.[ \t]*)?(?=['"])/g;

// Every string literal inside masked[from, to): the quotes survive masking, so they are found there and read from the real text.
function literalsIn(text, masked, from, to, type) {
  const out = [];
  for (let i = from; i < to; i++) {
    const c = masked[i];
    const raw = type === 'dart' && c === 'r' && (masked[i + 1] === "'" || masked[i + 1] === '"') && !/[\w$]/.test(masked[i - 1] ?? '');
    if (c !== "'" && c !== '"' && !raw) continue;
    const lit = literalAt(text, i, type);
    if (lit) { out.push({ at: i, spec: lit.value }); i = lit.end - 1; continue; }
    i = masked.indexOf(raw ? masked[i + 1] : c, i + (raw ? 2 : 1)); // interpolated: not a plain name, skip it
    if (i < 0) break;
  }
  return out;
}

function dartSpecs(text, masked) {
  const found = [];
  for (const m of masked.matchAll(DART_RE)) {
    const from = m.index + m[0].length;
    const end = masked.indexOf(';', from);
    found.push(...literalsIn(text, masked, from, end < 0 ? masked.length : end, 'dart'));
  }
  return found;
}

const phpName = (raw) => raw.trim().replace(/^\\+/, '').replace(/\\+$/, '');
function phpSpecs(text, masked) {
  const found = [];
  for (const m of masked.matchAll(PHP_USE_RE)) {
    const from = m.index + m[0].length;
    const end = masked.indexOf(';', from);
    const body = masked.slice(from, end < 0 ? masked.length : end);
    const names = [];
    const group = /^([\\\w]+?)\\?\s*\{([^}]*)\}/.exec(body.trim());
    if (group) {
      for (const item of group[2].split(',')) {
        const name = item.trim().replace(/\s+as\s+\w+$/i, '');
        if (name && !/^(?:function|const)\b/i.test(name)) names.push(`${phpName(group[1])}\\${phpName(name)}`);
      }
    } else {
      for (const item of body.split(',')) {
        const name = /^\s*(\\?[A-Za-z_][\w\\]*)/.exec(item)?.[1];
        if (name) names.push(phpName(name));
      }
    }
    // A name without a backslash is a trait or a global class: nothing in the project to link to.
    for (const spec of names) if (spec.includes('\\')) found.push({ at: m.index + m[0].indexOf('use'), spec });
  }
  for (const m of masked.matchAll(PHP_REQUIRE_RE)) {
    const at = m.index + m[0].length;
    const lit = literalAt(text, at, 'php');
    if (!lit || !lit.value) continue;
    const spec = m[1] ? `${m[1] === '__DIR__' ? '.' : '..'}/${lit.value.replace(/^\/+/, '')}` : lit.value;
    found.push({ at, spec });
  }
  return found;
}

// [{spec, line}] in the order they appear; [] for a language the reader does not know.
export function specifiersIn(text, path) {
  const kind = kindOf(path);
  if (!kind) return [];
  if (kind === 'dart' || kind === 'php') {
    const source = String(text);
    const { masked } = lex(source, kind);
    const found = kind === 'dart' ? dartSpecs(source, masked) : phpSpecs(source, masked);
    found.sort((a, b) => a.at - b.at);
    return found.map(({ at, spec }) => ({ spec, line: lineOf(source, at) }));
  }
  const body = kind === 'page' ? String(text) : String(text).replace(COMMENT_LINE_RE, (line) => ' '.repeat(line.length));
  const found = [];
  for (const re of kind === 'script' ? SCRIPT_RES : kind === 'style' ? STYLE_RES : PAGE_RES) {
    for (const m of body.matchAll(re)) found.push({ at: m.index, spec: m[2] });
  }
  found.sort((a, b) => a.at - b.at);
  const lineAt = (at) => body.slice(0, at).split('\n').length;
  return found.map(({ at, spec }) => ({ spec, line: lineAt(at) }));
}

const inside = (path) => (path.startsWith('..') || path.startsWith('/') ? null : path);

// `package:<pubspec name>/x.dart` is that pubspec's lib/x.dart (any pubspec of the repository); other names are relative.
function resolveDart(from, spec, files, ctx) {
  if (spec.startsWith('package:')) {
    const slash = spec.indexOf('/');
    if (slash < 0) return null;
    const pkg = ctx.dart.find((p) => p.name === spec.slice(8, slash));
    if (!pkg) return null;
    const target = inside(posix.normalize(posix.join(pkg.dir, 'lib', spec.slice(slash + 1))));
    return target && files.has(target) ? target : null;
  }
  if (URL_RE.test(spec) || spec.startsWith('/')) return null;
  const target = inside(posix.normalize(posix.join(posix.dirname(from), spec)));
  return target && files.has(target) ? target : null;
}

// The composer.json files that can answer for a file: the nearest folder first, then the rest.
const composersFor = (from, ctx) => {
  const near = (c) => (c.dir === '' ? 0 : from.startsWith(`${c.dir}/`) ? c.dir.length : -1);
  return [...ctx.php].sort((a, b) => near(b) - near(a));
};

// `use App\X\Y` is the file psr-4 maps it to; a string with a slash or a dot (`require`) is relative to the file.
function resolvePhp(from, spec, files, ctx) {
  if (/[/.]/.test(spec)) {
    if (spec.startsWith('/')) return null;
    const target = inside(posix.normalize(posix.join(posix.dirname(from), spec)));
    return target && files.has(target) ? target : null;
  }
  for (const composer of composersFor(from, ctx)) {
    for (const { prefix, dir } of [...composer.psr4].sort((a, b) => b.prefix.length - a.prefix.length)) {
      if (!spec.startsWith(prefix)) continue;
      const target = inside(posix.normalize(posix.join(composer.dir, dir, `${spec.slice(prefix.length).replaceAll('\\', '/')}.php`)));
      if (target && files.has(target)) return target;
    }
  }
  return null;
}

const NO_CTX = { dart: [], php: [] };

// The file a name means, or null for a library, a link or a file that does not exist. `ctx` carries what Dart and PHP
// need from the project's pubspec.yaml and composer.json files (see projectContext).
export function resolveSpec(from, spec, files, ctx = NO_CTX) {
  if (!spec) return null;
  const lang = kindOf(from);
  if (lang === 'dart') return resolveDart(from, spec, files, ctx);
  if (lang === 'php') return resolvePhp(from, spec, files, ctx);
  if (URL_RE.test(spec)) return null;
  const relative = spec.startsWith('./') || spec.startsWith('../');
  const plainRelative = !relative && kindOf(from) !== 'script' && !spec.startsWith('@');
  let base;
  if (relative || plainRelative) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else if (spec.startsWith('/') && kindOf(from) === 'page') base = posix.normalize(spec.slice(1));
  else return null;
  if (base.startsWith('..') || base.startsWith('/')) return null;
  const ext = posix.extname(base);
  const candidates = [base, ...(JS_TO_TS[ext] ?? []).map((e) => base.slice(0, -ext.length) + e), ...TRY_EXT.map((e) => base + e), ...TRY_EXT.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => files.has(c)) ?? null;
}

const libraryOf = (spec) => {
  if (URL_RE.test(spec) || spec.startsWith('.') || spec.startsWith('/')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

// What a Dart or PHP name needs from the project: pubspec names (a line `name:`, no YAML parser) and composer psr-4 maps.
export function projectContext(root, files) {
  const ctx = { dart: [], php: [] };
  const read = (path) => {
    try {
      const abs = join(root, path);
      return statSync(abs).size > FILE_MAX ? '' : readFileSync(abs, 'utf8');
    } catch { return ''; }
  };
  const dirOf = (path) => (posix.dirname(path) === '.' ? '' : posix.dirname(path));
  for (const path of files) {
    const base = path.split('/').pop();
    if (base === 'pubspec.yaml') {
      const name = /^name:[ \t]*['"]?([\w.-]+)/m.exec(read(path))?.[1];
      if (name) ctx.dart.push({ dir: dirOf(path), name });
    } else if (base === 'composer.json') {
      let json = null;
      try { json = JSON.parse(read(path)); } catch { /* not valid JSON: no psr-4 map */ }
      const psr4 = [];
      for (const map of [json?.autoload?.['psr-4'], json?.['autoload-dev']?.['psr-4']]) {
        if (!map || typeof map !== 'object') continue;
        for (const [prefix, dirs] of Object.entries(map)) {
          for (const dir of [].concat(dirs)) if (typeof dir === 'string') psr4.push({ prefix, dir: dir.replace(/^\.\//, '').replace(/\/+$/, '') });
        }
      }
      if (psr4.length) ctx.php.push({ dir: dirOf(path), psr4 });
    }
  }
  return ctx;
}

// The outside package a Dart or PHP name stands for; null for the SDK, a name of this project or a bare class name.
function foreignLibrary(kind, spec, ctx) {
  if (kind === 'dart') {
    if (!spec.startsWith('package:') || !spec.includes('/')) return null;
    const name = spec.slice(8, spec.indexOf('/'));
    return ctx.dart.some((p) => p.name === name) ? null : name;
  }
  if (/[/.]/.test(spec) || !spec.includes('\\')) return null;
  return ctx.php.some((c) => c.psr4.some((m) => m.prefix && spec.startsWith(m.prefix))) ? null : spec.split('\\')[0];
}

// path → {sig, specs}: a file is read again only when its size or time changes.
const parsed = new Map();
function specsOf(root, path) {
  const abs = join(root, path);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isFile() || st.size > FILE_MAX) return [];
  const sig = `${st.mtimeMs}:${st.size}`;
  const hit = parsed.get(abs);
  if (hit?.sig === sig) return hit.specs;
  let specs = [];
  try { specs = specifiersIn(readFileSync(abs, 'utf8'), path); } catch { /* unreadable: no links */ }
  parsed.set(abs, { sig, specs });
  return specs;
}

// One graph per count of the project (recounted at most every 30 s), built when a file is first opened.
const graphs = new WeakMap();
function graphOf(root, counted) {
  if (graphs.has(counted)) return graphs.get(counted);
  const files = new Set(counted.files.map((f) => f.path));
  const uses = new Map();
  const usedBy = new Map();
  const libraries = new Map();
  const ctx = projectContext(root, files);
  for (const path of files) {
    if (!kindOf(path)) continue;
    const mine = [];
    const libs = new Set();
    for (const { spec, line } of specsOf(root, path)) {
      const target = resolveSpec(path, spec, files, ctx);
      if (target && target !== path) {
        mine.push({ path: target, line });
        if (!usedBy.has(target)) usedBy.set(target, []);
        usedBy.get(target).push({ path, line });
      } else if (!target) {
        const kind = kindOf(path);
        const lib = kind === 'script' ? libraryOf(spec) : kind === 'dart' || kind === 'php' ? foreignLibrary(kind, spec, ctx) : null;
        if (lib && !lib.startsWith('node:')) libs.add(lib);
      }
    }
    uses.set(path, mine);
    libraries.set(path, [...libs].sort());
  }
  for (const list of usedBy.values()) list.sort((a, b) => a.path.localeCompare(b.path));
  const graph = { uses, usedBy, libraries };
  graphs.set(counted, graph);
  return graph;
}

// {graph, uses, usedBy, libraries} of a project file; graph is false for a language the reader does not know.
export async function linksOf(root, path) {
  if (!kindOf(path)) return { graph: false, uses: [], usedBy: [], libraries: [] };
  const g = graphOf(root, await countRepo(root));
  return { graph: true, uses: g.uses.get(path) ?? [], usedBy: g.usedBy.get(path) ?? [], libraries: g.libraries.get(path) ?? [] };
}
