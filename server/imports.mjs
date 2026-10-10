// Which files a file uses and which files use it (mind-map-page mm26), read by session-map itself from the import lines
// of JavaScript, TypeScript, CSS and HTML, with no dependency. A cheap reader: it skips commented-out lines but not every
// trick a bundler knows (path aliases, re-exports through a package); the foundation's extractors (fd series) refine it.
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { countRepo } from './sources/count.mjs';

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
  return SCRIPT_EXT.has(ext) ? 'script' : STYLE_EXT.has(ext) ? 'style' : PAGE_EXT.has(ext) ? 'page' : null;
};

// [{spec, line}] in the order they appear; [] for a language the reader does not know.
export function specifiersIn(text, path) {
  const kind = kindOf(path);
  if (!kind) return [];
  const body = kind === 'page' ? String(text) : String(text).replace(COMMENT_LINE_RE, (line) => ' '.repeat(line.length));
  const found = [];
  for (const re of kind === 'script' ? SCRIPT_RES : kind === 'style' ? STYLE_RES : PAGE_RES) {
    for (const m of body.matchAll(re)) found.push({ at: m.index, spec: m[2] });
  }
  found.sort((a, b) => a.at - b.at);
  const lineAt = (at) => body.slice(0, at).split('\n').length;
  return found.map(({ at, spec }) => ({ spec, line: lineAt(at) }));
}

// The file a name means, or null for a library, a link or a file that does not exist.
export function resolveSpec(from, spec, files) {
  if (!spec || URL_RE.test(spec)) return null;
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
  for (const path of files) {
    if (!kindOf(path)) continue;
    const mine = [];
    const libs = new Set();
    for (const { spec, line } of specsOf(root, path)) {
      const target = resolveSpec(path, spec, files);
      if (target && target !== path) {
        mine.push({ path: target, line });
        if (!usedBy.has(target)) usedBy.set(target, []);
        usedBy.get(target).push({ path, line });
      } else if (!target && kindOf(path) === 'script') {
        const lib = libraryOf(spec);
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
