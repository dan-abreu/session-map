// Watcher rules about what documents cite and what the code has (fd06, fd07 groups 1 and 2): a path, route or variable a
// document names that is gone, a pointer that leads nowhere, code no document explains, files no part of the map owns.
// Every rule is pure: (RuleInput) -> Finding[] in the shape of contracts section 6. Input a rule needs and does not have
// (null) gives [], and the panel line shows no-data. Nothing here asks an AI. The only disk read is the code behind a
// pointer, and only when the caller passed no `readCode` (never a secrets file, never outside the root).
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { isSecretsFile } from '../files.mjs';
import { findingId } from './findings.mjs';
import { docTypeOf } from './docsize.mjs';
import { codeSpansOf, headingsOf, maskCode } from './mdlinks.mjs';
import { pointersIn, resolvePointer } from './pointers.mjs';

const list = (v) => (Array.isArray(v) ? v : null);
const lineList = (text) => String(text ?? '').split(/\r?\n/);
const CODE_FILE_MAX = 1024 * 1024;

// History documents cite files that are gone on purpose; plans and the owner's own notes are not the project's map.
const isHistoryDoc = (path) => {
  const type = docTypeOf(path);
  return type === 'changelog' || type === 'plan' || type === 'registry' || /(^|\/)\.dev\//.test(path);
};

function shaLookup(input) {
  const files = list(input?.census?.files);
  const by = files ? new Map(files.map((f) => [f.path, f.sha ?? null])) : new Map();
  return (file) => by.get(file) ?? null;
}

function build(rule, severity, target, evidence, whatParams, idParams, extra = {}) {
  const base = `watch.${rule}`;
  return {
    id: findingId(rule, target.file, idParams),
    rule,
    severity,
    target: { file: target.file, line: target.line ?? null },
    evidence,
    what: { msg: `${base}.what`, params: whatParams },
    why: { msg: `${base}.why` },
    todo: { msg: `${base}.todo` },
    fix: { kind: extra.fix ?? 'ai-update', opId: null },
  };
}

// ---------- reading a document ----------

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;

// Lines inside fenced code blocks: [{ line, text, lang }].
function fencedLines(text) {
  const out = [];
  let open = null;
  lineList(text).forEach((raw, i) => {
    const m = FENCE.exec(raw);
    if (open) {
      if (m && m[1][0] === open.mark && m[1].length >= open.len && raw.trim() === m[1]) open = null;
      else out.push({ line: i + 1, text: raw, lang: open.lang });
    } else if (m) {
      open = { mark: m[1][0], len: m[1].length, lang: m[2].toLowerCase() };
    }
  });
  return out;
}

const EXAMPLE_HEADING = /(?<!\p{L})(examples?|samples?|exemplos?)(?!\p{L})/iu;
const CONFIG_HEADING = /(?<!\p{L})(environment|env|config(?:uration)?|settings|variables?|secrets?|vari[aá]veis|configura[cç][aã]o|ambiente|\.env)(?!\p{L})/iu;

// For a line: the titles of the sections it sits in, from the outermost to the closest.
function sectionsOf(text) {
  const heads = headingsOf(text);
  return (line) => {
    const chain = [];
    for (const h of heads) {
      if (h.line > line) break;
      while (chain.length && chain.at(-1).level >= h.level) chain.pop();
      chain.push(h);
    }
    return chain.map((h) => h.text);
  };
}

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const ROUTE_SPAN = new RegExp(`^(?:(${METHODS})\\s+)?(/[^\\s]*)$`);
const ROUTE_LINE = new RegExp(`^\\s*(?:\\$\\s+)?(${METHODS})\\s+(/[^\\s]*)(?:\\s+HTTP/[\\d.]+)?\\s*$`);

const PARAM_SEG = /^(?::[^/]+|\{[^}]*\}|\[[^\]]*\]|<[^>]*>)$/;
const cleanRoutePath = (p) => {
  const bare = p.split(/[?#]/)[0].replace(/\/+$/, '');
  return bare === '' ? '/' : bare;
};
// Routes are compared by shape: :id, {id}, [id] and <id> are the same segment.
const routeShape = (p) => cleanRoutePath(p).split('/').map((s) => (PARAM_SEG.test(s) ? ':p' : s)).join('/');

// Routes a document writes: inside backticks (with or without a method) and at the start of a line in a code block (with one).
function routesOf(doc) {
  const out = [];
  for (const s of codeSpansOf(doc.text)) {
    const m = ROUTE_SPAN.exec(s.text.trim());
    if (m && !/[*…]|\.\.\./.test(m[2])) out.push({ line: s.line, method: m[1] ?? null, path: cleanRoutePath(m[2]), shape: routeShape(m[2]) });
  }
  for (const l of fencedLines(doc.text)) {
    const m = ROUTE_LINE.exec(l.text);
    if (m && !/[*…]|\.\.\./.test(m[2])) out.push({ line: l.line, method: m[1], path: cleanRoutePath(m[2]), shape: routeShape(m[2]) });
  }
  return out;
}

// ---------- doc-cites-missing ----------

const KNOWN_EXT = new Set(('js mjs cjs ts tsx jsx mts cts dart php blade prisma json yaml yml md mdx css scss html sql sh toml lock py rb go rs java kt swift vue svelte txt xml png jpg jpeg svg gif webp ico pdf env').split(' '));
const UNTRACKED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.git', 'vendor', 'target', 'out', '.dart_tool', '.gradle', '.cache', '.turbo', '.venv', '__pycache__', 'tmp']);
const PATH_NOISE = /[\s*<>{}|?$=,;"'\\]|:\/\//;

// What a document can mean by a file in this repository, or null when the text is not a path to check.
// -> { path: relative to the root (a document-relative guess is made later), dir: bool, bare: bool }
function pathCandidate(raw) {
  let t = raw.trim().replace(/:\d+(?:-\d+)?$/, '');
  const hash = t.indexOf('#');
  if (hash >= 0) {
    const ext = /\.([A-Za-z0-9]+)$/.exec(t.slice(0, hash))?.[1]?.toLowerCase();
    if (ext !== 'md' && ext !== 'mdx') return null; // `path#Symbol` is a pointer: pointer-broken judges it
    t = t.slice(0, hash);
  }
  if (!t || PATH_NOISE.test(t) || /^[~/$@]/.test(t) || /^[A-Za-z]:/.test(t)) return null;
  t = t.replace(/^(\.\/)+/, '');
  if (!t.includes('/')) return null;
  const dir = t.endsWith('/');
  const segs = t.replace(/\/+$/, '').split('/');
  if (segs.some((s) => s === '' || s === '.')) return null;
  if (isSecretsFile(segs.at(-1)) || segs.some((s) => /^\.env/i.test(s))) return null;
  if (UNTRACKED_DIRS.has(segs[0])) return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(segs.at(-1))?.[1]?.toLowerCase();
  const isFile = !dir && ext !== undefined && KNOWN_EXT.has(ext);
  return { path: segs.join('/'), dir, bare: !dir && !isFile };
}

function pathIndex(census) {
  const files = list(census?.files);
  if (!files) return null;
  const all = new Set();
  const dirs = new Set(['']);
  for (const f of files) {
    all.add(f.path);
    for (let at = f.path.indexOf('/'); at >= 0; at = f.path.indexOf('/', at + 1)) dirs.add(f.path.slice(0, at));
  }
  return { has: (p) => all.has(p) || dirs.has(p), hasDir: (p) => dirs.has(p) };
}

function pathFindings(doc, ix, sha, sections, out) {
  const seen = new Set();
  for (const span of codeSpansOf(doc.text)) {
    const c = pathCandidate(span.text);
    if (!c || sections(span.line).some((t) => EXAMPLE_HEADING.test(t))) continue;
    const here = posix.join(posix.dirname(doc.path), c.path);
    const guesses = [c.path, here].filter((p) => !p.startsWith('..'));
    if (!guesses.length || guesses.some((p) => ix.has(p))) continue;
    // `read/write` is not a path: a name with no extension only counts when the folder it sits in is real.
    if (c.bare && !guesses.some((p) => ix.hasDir(posix.dirname(p)) && posix.dirname(p) !== '.')) continue;
    const name = c.dir ? `${c.path}/` : c.path;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(build('doc-cites-missing', 'important', { file: doc.path, line: span.line },
      [{ file: doc.path, line: span.line, sha: sha(doc.path) }], { name, kind: 'path', doc: doc.path }, { name }));
  }
}

function routeIndex(facts) {
  const routes = facts.filter((f) => f.kind === 'route');
  if (!routes.length) return null;
  const dynamic = routes.filter((f) => f.origin === 'AMBIGUOUS' && typeof f.attrs?.path !== 'string');
  const known = routes
    .filter((f) => typeof f.attrs?.path === 'string')
    .map((f) => ({ method: String(f.attrs.method ?? 'ANY').toUpperCase(), shape: routeShape(f.attrs.path), inferred: f.origin === 'INFERRED' }));
  const methodOk = (a, b) => a === b || a === 'ANY' || b === 'ANY';
  return {
    // A route that is dynamic (path in a variable) may be anything: that method stays unchecked.
    unknown: (method) => dynamic.some((f) => methodOk(String(f.attrs?.method ?? 'ANY').toUpperCase(), method)),
    has: (method, shape) => known.some((k) => methodOk(k.method, method) && (k.shape === shape || (k.inferred && shape !== '/' && k.shape.endsWith(shape)))),
  };
}

function routeFindings(doc, rx, sha, sections, out) {
  const seen = new Set();
  for (const r of routesOf(doc)) {
    if (!r.method || sections(r.line).some((t) => EXAMPLE_HEADING.test(t))) continue;
    if (rx.has(r.method, r.shape) || rx.unknown(r.method)) continue;
    const name = `${r.method} ${r.path}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(build('doc-cites-missing', 'important', { file: doc.path, line: r.line },
      [{ file: doc.path, line: r.line, sha: sha(doc.path) }], { name, kind: 'route', doc: doc.path }, { name }));
  }
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

function envFindings(doc, names, sha, sections, out) {
  const seen = new Set();
  for (const span of codeSpansOf(doc.text)) {
    const name = span.text.trim();
    if (!ENV_NAME.test(name) || names.has(name) || seen.has(name)) continue;
    const chain = sections(span.line);
    if (!chain.some((t) => CONFIG_HEADING.test(t)) || chain.some((t) => EXAMPLE_HEADING.test(t))) continue;
    seen.add(name);
    out.push(build('doc-cites-missing', 'important', { file: doc.path, line: span.line },
      [{ file: doc.path, line: span.line, sha: sha(doc.path) }], { name, kind: 'env', doc: doc.path }, { name }));
  }
}

export function docCitesMissing(input) {
  const docs = list(input?.docs);
  if (!input || !docs) return [];
  const sha = shaLookup(input);
  const ix = pathIndex(input.census);
  const facts = list(input.facts?.facts);
  const rx = facts ? routeIndex(facts) : null;
  const envNames = facts ? new Set(facts.filter((f) => f.kind === 'env').map((f) => f.name ?? String(f.id).slice(4))) : new Set();
  const out = [];
  for (const doc of docs) {
    if (isHistoryDoc(doc.path)) continue;
    const sections = sectionsOf(doc.text);
    if (ix) pathFindings(doc, ix, sha, sections, out);
    if (rx) routeFindings(doc, rx, sha, sections, out);
    if (envNames.size) envFindings(doc, envNames, sha, sections, out);
  }
  return out;
}

// ---------- pointer-broken ----------

// Reads code for a pointer from disk: inside the root, no secrets, not too big, null when it is not there.
function diskReader(root) {
  let base;
  try { base = realpathSync(root); } catch { return () => null; }
  return (rel) => {
    if (isSecretsFile(rel)) return null;
    try {
      const real = realpathSync(join(base, rel));
      if (real !== base && !real.startsWith(base + sep)) return null;
      const st = statSync(real);
      return st.isFile() && st.size <= CODE_FILE_MAX ? readFileSync(real, 'utf8') : null;
    } catch { return null; }
  };
}

export function pointerBroken(input) {
  const docs = list(input?.docs);
  if (!input || !docs) return [];
  const sha = shaLookup(input);
  const files = list(input.census?.files);
  const inCensus = files ? new Set(files.map((f) => f.path)) : null;
  const facts = list(input.facts?.facts) ?? [];
  const readCode = typeof input.readCode === 'function' ? input.readCode : typeof input.root === 'string' ? diskReader(input.root) : null;
  // Without code to read, the census and the facts have to carry the verdict; with neither, nothing can be said.
  if (!readCode && !inCensus) return [];
  const out = [];
  for (const doc of docs) {
    if (isHistoryDoc(doc.path)) continue;
    const seen = new Set();
    for (const p of pointersIn(doc.text)) {
      if (seen.has(p.ptr) || isSecretsFile(p.path)) continue;
      seen.add(p.ptr);
      let why;
      if (readCode) {
        const r = resolvePointer(p.ptr, { facts, readCode });
        if (!r.ok) why = r.why;
      } else if (!inCensus.has(p.path)) {
        why = 'path-missing';
      } else {
        const r = resolvePointer(p.ptr, { facts });
        // A file the readers know no function or export of cannot prove a symbol gone.
        if (!r.ok && facts.some((f) => f.file === p.path && (f.kind === 'function' || f.kind === 'export'))) why = r.why;
      }
      if (!why) continue;
      out.push(build('pointer-broken', 'important', { file: doc.path, line: p.line },
        [{ file: doc.path, line: p.line, sha: sha(doc.path) }], { pointer: p.ptr, why }, { pointer: p.ptr }));
    }
  }
  return out;
}

// ---------- code-without-doc ----------

const DOC_KINDS = ['route', 'screen', 'table', 'queue', 'integration'];
const NAME_RE = /[\p{L}\p{N}_$]+(?:[.-][\p{L}\p{N}_$]+)*/gu;

// What every document says, ready to be asked "do you name this?": routes, code spans that are one name, prose words, text.
function corpusOf(docs) {
  const routes = [];
  const spanNames = new Set();
  const prose = new Set();
  let lower = '';
  for (const doc of docs) {
    routes.push(...routesOf(doc));
    for (const s of codeSpansOf(doc.text)) {
      const t = s.text.trim().toLowerCase();
      if (!t || /\s/.test(t)) continue;
      spanNames.add(t);
      const head = /^[^.([]+/.exec(t)?.[0];
      if (head) spanNames.add(head);
    }
    for (const m of maskCode(doc.text).matchAll(NAME_RE)) prose.add(m[0]);
    lower += `${doc.text.toLowerCase()}\n`;
  }
  const named = (name) => {
    const n = String(name);
    return prose.has(n) || [n, `${n}s`].some((v) => spanNames.has(v.toLowerCase()));
  };
  return { routes, named, mentions: (name) => lower.includes(String(name).toLowerCase()) };
}

function isNamed(fact, corpus) {
  const tail = String(fact.id).slice(String(fact.id).indexOf(':') + 1);
  const a = fact.attrs ?? {};
  if (fact.kind === 'route') {
    if (typeof a.path !== 'string') return true; // nothing exact to look for
    const method = String(a.method ?? 'ANY').toUpperCase();
    const shape = routeShape(a.path);
    return corpus.routes.some((r) => (!r.method || method === 'ANY' || r.method === method)
      && (r.shape === shape || (fact.origin === 'INFERRED' && r.shape !== '/' && shape.endsWith(r.shape))));
  }
  if (fact.kind === 'screen') {
    const route = typeof a.route === 'string' ? routeShape(a.route) : null;
    if (route && corpus.routes.some((r) => !r.method && r.shape === route)) return true;
    const widget = a.widget ?? (route ? null : tail.split(':').pop());
    return Boolean(widget) && corpus.named(widget);
  }
  if (fact.kind === 'integration') return [a.package, a.host, tail].filter(Boolean).some((n) => corpus.mentions(n));
  return corpus.named(a.name ?? fact.name ?? tail); // table, queue
}

function displayName(fact) {
  const tail = String(fact.id).slice(String(fact.id).indexOf(':') + 1);
  const a = fact.attrs ?? {};
  if (fact.kind === 'route') return typeof a.path === 'string' ? `${String(a.method ?? 'ANY').toUpperCase()} ${a.path}` : tail;
  if (fact.kind === 'screen') return a.route ?? a.widget ?? tail.split(':').slice(1).join(':');
  return tail;
}

export function codeWithoutDoc(input) {
  const docs = list(input?.docs);
  const facts = list(input?.facts?.facts);
  if (!input || !docs || !facts) return [];
  const sha = shaLookup(input);
  const corpus = corpusOf(docs.filter((d) => !isHistoryDoc(d.path)));
  const prev = input.prevFactIds ? new Set(input.prevFactIds) : null;
  const byFile = new Map();
  for (const f of facts) {
    if (!DOC_KINDS.includes(f.kind) || f.origin === 'AMBIGUOUS' || isNamed(f, corpus)) continue;
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  }
  const out = [];
  for (const file of [...byFile.keys()].sort()) {
    const gone = byFile.get(file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || String(a.id).localeCompare(String(b.id)));
    const votes = new Map();
    for (const f of gone) votes.set(f.kind, (votes.get(f.kind) ?? 0) + 1);
    const kind = [...votes].sort((a, b) => b[1] - a[1] || DOC_KINDS.indexOf(a[0]) - DOC_KINDS.indexOf(b[0]))[0][0];
    const fresh = Boolean(prev) && gone.some((f) => !prev.has(f.id));
    const head = gone.slice(0, 3);
    out.push(build('code-without-doc', fresh ? 'important' : 'detail', { file, line: gone[0].line ?? null },
      head.map((f) => ({ file, line: f.line ?? null, sha: sha(file) ?? f.sha ?? null, factId: f.id })),
      { file, count: gone.length, names: head.map(displayName), kind }, {}));
  }
  return out;
}

// ---------- owner-missing ----------

const MANIFESTS = new Set(['package.json', 'pubspec.yaml', 'composer.json']);
const CONFIG_TYPES = new Set(['json', 'yaml', 'yml', 'toml', 'other']);

function containersOf(input, files) {
  const set = new Set(['']);
  const nodes = list(input.model?.nodes);
  const fromModel = (nodes ?? []).filter((n) => n.kind === 'container');
  if (fromModel.length) {
    for (const n of fromModel) for (const f of n.files ?? []) set.add(String(f).replace(/\/+$/, ''));
  } else {
    for (const f of files) {
      const at = f.path.lastIndexOf('/');
      if (MANIFESTS.has(f.path.slice(at + 1))) set.add(at < 0 ? '' : f.path.slice(0, at));
    }
  }
  return [...set].sort((a, b) => b.length - a.length);
}

export function ownerMissing(input) {
  const files = list(input?.census?.files);
  if (!input || !files) return [];
  const containers = containersOf(input, files);
  const groups = new Map();
  for (const f of files) {
    if (f.included === false || f.owner != null || f.kind === 'doc') continue;
    const c = containers.find((x) => x === '' || f.path.startsWith(`${x}/`));
    const rest = f.path.slice(c ? c.length + 1 : 0).split('/');
    let folder;
    if (rest.length > 1) folder = c ? `${c}/${rest[0]}` : rest[0];
    else if (c && !CONFIG_TYPES.has(f.type)) folder = c; // a source file straight in an app; the repository root has no folder
    else continue;
    groups.set(folder, [...(groups.get(folder) ?? []), f]);
  }
  return [...groups.keys()].sort().map((folder) => {
    const rows = groups.get(folder).sort((a, b) => a.path.localeCompare(b.path));
    return build('owner-missing', 'important', { file: folder, line: null },
      rows.slice(0, 3).map((f) => ({ file: f.path, line: null, sha: f.sha ?? null })),
      { folder, count: rows.length }, {}, { fix: 'owner' });
  });
}

export function citeRules(input) {
  return [...docCitesMissing(input), ...pointerBroken(input), ...codeWithoutDoc(input), ...ownerMissing(input)];
}
