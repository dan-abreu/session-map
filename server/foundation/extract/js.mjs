// JavaScript / TypeScript reader (fd02): Fastify routes, Next.js screens and routes (App and Pages Router), BullMQ queues
// and jobs, environment variable names and the integrations a file reaches (known SDK imports, literal https hosts).
// It is exact, not clever: the patterns run on the text with comments and string contents blanked by lex(), the literal
// values come back from the real text at the same offsets, and whatever cannot be known for sure (a path in a variable,
// a queue named by an expression) is kept as AMBIGUOUS with the written expression, never guessed. Pure: the index hands
// the text in; nothing here touches the disk, a process or the network.
import { lex, literalAt } from '../lex.mjs';

export const VERSION = 'js@1';
export const TYPES = ['js', 'ts', 'tsx', 'jsx'];

const VERB_RE = /(?<![\w$.])(app|fastify|server|router)\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(/g;
const ROUTE_RE = /(?<![\w$.])(app|fastify|server|router)\s*\.\s*route\s*\(\s*\{/g;
const REGISTER_RE = /(?<![\w$.])(app|fastify|server|router)\s*\.\s*register\s*\(/g;
const QUEUE_NEW_RE = /(?<![\w$.])new\s+(Queue|Worker|QueueScheduler)\s*(?:<[^()]*?>\s*)?\(/g;
const ADD_RE = /(?<![\w$])([\w$]+)\s*\.\s*add\s*\(/g;
const ENV_RE = /\bprocess\s*\.\s*env\s*(?:\??\.\s*([A-Za-z_$][\w$]*)|(?:\?\.\s*)?\[\s*(['"]))/g;
const ENV_DESTRUCT_RE = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*(?::[^=]*)?=\s*process\s*\.\s*env\b(?!\s*\??[.[])/g;
const URL_CALL_RE = /(?<![\w$.])(?:fetch|axios|got)\s*\(|(?<![\w$.])(?:axios|got)\s*\.\s*(?:get|post|put|patch|delete|head|request)\s*\(|(?<![\w$.])new\s+URL\s*\(/g;
const AXIOS_CREATE_RE = /(?<![\w$.])axios\s*\.\s*create\s*\(\s*\{/g;
const IMPORT_RE = /\bimport\s+(?:(type)\s+)?(?:([^'";`()]*?)\s*\bfrom\s*)?(['"])/g;
const EXPORT_FROM_RE = /\bexport\s+(?:(type)\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])/g;
const REQUIRE_RE = /(?<![\w$.])require\s*\(\s*(['"])/g;
const DYN_IMPORT_RE = /(?<![\w$.])import\s*\(\s*(['"])/g;

const SDKS = new Set(['stripe', 'twilio', 'openai', '@anthropic-ai/sdk', 'resend', 'nodemailer', '@sendgrid/mail', 'firebase-admin', 'ioredis']);
const SDK_SCOPES = ['@aws-sdk/', '@sentry/'];
const NEXT_VERBS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];
const NEXT_VERB_PAT = NEXT_VERBS.join('|');
const NOT_A_NAME = new Set(['async', 'function', 'class', 'new', 'await', 'typeof', 'void', 'null', 'undefined', 'true', 'false', 'this']);

// ---------- text helpers ----------

function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Index of the bracket that closes the one at `open` (masked text: brackets in strings and comments are gone), or -1.
function closeOf(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The pieces between the commas at the top level of the bracket at `open`: [{ start, end }] (offsets into the text).
function splitTop(masked, open) {
  const close = closeOf(masked, open);
  if (close < 0) return [];
  const parts = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push({ start, end: i }); start = i + 1; }
  }
  parts.push({ start, end: close });
  return parts.filter((p) => masked.slice(p.start, p.end).trim() !== '');
}

function makeCtx(path, text, masked, workspace) {
  const ctx = { path, text, masked, lineOf: lineIndex(text), workspace: workspace ?? { dir: '', name: '' } };
  // The first non-blank offset of a range, or -1.
  ctx.firstAt = (start, end) => {
    for (let i = start; i < end; i++) if (!/\s/.test(masked[i])) return i;
    return -1;
  };
  // The value of a string literal that fills the whole range; null when the range is anything else (a name, a
  // concatenation, a template with ${}).
  ctx.literal = (start, end) => {
    const at = ctx.firstAt(start, end);
    if (at < 0 || !/['"`]/.test(masked[at])) return null;
    const lit = literalAt(text, at);
    return lit && masked.slice(lit.end, end).trim() === '' ? lit.value : null;
  };
  ctx.expr = (start, end) => text.slice(start, end).trim().replace(/\s+/g, ' ');
  // Top-level `key: value` pairs of the object literal that opens at `open`: key -> { start, end } of the value.
  ctx.props = (open) => {
    const out = new Map();
    for (const part of splitTop(masked, open)) {
      const m = /^\s*(?:['"]([^'"]+)['"]|([\w$]+))\s*:\s*/.exec(text.slice(part.start, part.end));
      if (m) out.set(m[1] ?? m[2], { start: part.start + m[0].length, end: part.end });
    }
    return out;
  };
  return ctx;
}

function mk(ctx, kind, id, offset, attrs, origin = 'EXTRACTED') {
  return {
    id, kind, name: id.slice(id.indexOf(':') + 1), file: ctx.path, line: ctx.lineOf(offset), origin,
    extractor: VERSION, attrs, refs: [], _at: offset,
  };
}

// One fact per id for the kinds where the same name in many places is still one thing; the later places go to refs.
function dedupe(facts, kinds) {
  const first = new Map();
  const out = [];
  for (const f of facts) {
    if (!kinds.has(f.kind)) { out.push(f); continue; }
    const prev = first.get(f.id);
    if (!prev) { first.set(f.id, f); out.push(f); } else if (f.line !== prev.line) prev.refs.push({ file: f.file, line: f.line });
  }
  return out;
}

// ---------- imports ----------

// Every module name the file imports or requires: [{ spec, at }] (at = offset of its opening quote), and the local names
// those imports bind: local -> spec.
function importsOf(ctx) {
  const { masked, text } = ctx;
  const specs = [];
  const bindings = new Map();
  const spec = (quoteAt) => literalAt(text, quoteAt)?.value;

  for (const m of masked.matchAll(IMPORT_RE)) {
    const at = m.index + m[0].length - 1;
    const s = spec(at);
    if (typeof s !== 'string') continue;
    specs.push({ spec: s, at, typeOnly: Boolean(m[1]) });
    if (m[2]) bindClause(m[2], s, bindings);
  }
  for (const m of masked.matchAll(EXPORT_FROM_RE)) {
    const at = m.index + m[0].length - 1;
    const s = spec(at);
    if (typeof s === 'string') specs.push({ spec: s, at, typeOnly: Boolean(m[1]) });
  }
  for (const m of masked.matchAll(DYN_IMPORT_RE)) {
    const at = m.index + m[0].length - 1;
    const s = spec(at);
    if (typeof s === 'string') specs.push({ spec: s, at });
  }
  for (const m of masked.matchAll(REQUIRE_RE)) {
    const at = m.index + m[0].length - 1;
    const s = spec(at);
    if (typeof s !== 'string') continue;
    specs.push({ spec: s, at });
    const before = masked.slice(Math.max(0, m.index - 200), m.index);
    const b = /(?:const|let|var)\s+(?:([\w$]+)|\{([^{}]*)\})\s*=\s*(?:await\s+)?$/.exec(before);
    if (b?.[1]) bindings.set(b[1], s);
    else if (b?.[2]) bindClause(`{${b[2]}}`, s, bindings);
  }
  specs.sort((a, b) => a.at - b.at);
  return { specs, bindings };
}

function bindClause(clause, spec, bindings) {
  let rest = clause.trim();
  const ns = /\*\s*as\s+([\w$]+)/.exec(rest);
  if (ns) { bindings.set(ns[1], spec); rest = rest.replace(ns[0], ''); }
  const braces = /\{([^}]*)\}/.exec(rest);
  if (braces) {
    for (const item of braces[1].split(',')) {
      const m = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(item);
      if (m) bindings.set(m[2] ?? m[1], spec);
    }
    rest = rest.replace(braces[0], '');
  }
  const def = /^\s*([\w$]+)\s*,?\s*$/.exec(rest);
  if (def) bindings.set(def[1], spec);
}

function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const isSdk = (pkg) => pkg && (SDKS.has(pkg) || SDK_SCOPES.some((s) => pkg.startsWith(s) && pkg.length > s.length));

// ---------- Fastify ----------

// Does a function expression start at `at`? (`function`, `async function`, `x =>`, `(a, b) =>`, `async (a): T =>`)
function fnAt(masked, at) {
  const head = /^(?:async\s+)?/.exec(masked.slice(at, at + 20))[0].length;
  const rest = masked.slice(at + head, at + head + 200);
  if (/^function\b/.test(rest) || /^[A-Za-z_$][\w$]*\s*=>/.test(rest)) return true;
  if (masked[at + head] !== '(') return false;
  const close = closeOf(masked, at + head);
  return close > 0 && /^\s*(?::[^=;{}()]+)?=>/.test(masked.slice(close + 1, close + 200));
}

// End of the expression that starts at `from`: a ; or , at its level, a bracket that closes an outer one, or a line end
// that cannot continue the expression.
function exprEnd(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth < 0) return i; }
    else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && c === '\n' && !/[=>(,+\-*/?:&|]\s*$/.test(masked.slice(from, i))) return i;
  }
  return masked.length;
}

// The range of the function this file defines for the first argument of register(): written in the call, or a
// function / const declared here by that name. null when the plugin comes from elsewhere (or is built by a call, like
// fastify-plugin's fp(), which drops the prefix anyway).
function localPlugin(ctx, part) {
  const { masked } = ctx;
  const at = ctx.firstAt(part.start, part.end);
  if (at < 0) return null;
  if (fnAt(masked, at)) return { start: part.start, end: part.end };
  const name = /^([A-Za-z_$][\w$]*)\s*$/.exec(masked.slice(at, part.end));
  if (!name) return null;
  const n = name[1].replace(/\$/g, '\\$');
  const fn = new RegExp(`(?<![\\w$.])function\\s*\\*?\\s*${n}\\s*\\(`).exec(masked);
  if (fn) {
    const params = closeOf(masked, fn.index + fn[0].length - 1);
    const open = params < 0 ? -1 : masked.indexOf('{', params);
    const close = open < 0 ? -1 : closeOf(masked, open);
    return close < 0 ? null : { start: open, end: close };
  }
  const v = new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+${n}\\s*(?::[^=;]+?)?(?<![=!<>])=(?!=)\\s*`).exec(masked);
  if (!v) return null;
  const valueAt = v.index + v[0].length;
  return fnAt(masked, valueAt) ? { start: valueAt, end: exprEnd(masked, valueAt) } : null;
}

// Fastify joins a prefix and a path; the path '/' under a prefix is the prefix itself.
const joinPath = (a, b) => (b === '/' ? a || '/' : a.replace(/\/$/, '') + b);

// A chain of prefixes (outermost first, each { value, expr }): the joined value when all are literal, else null; and
// the text for an AMBIGUOUS id, with the parts that are not literal written as ${expression}.
function prefixOf(chain) {
  const literal = chain.every((p) => p.value !== null);
  return {
    value: literal ? chain.reduce((acc, p) => joinPath(acc, p.value), '') : null,
    text: chain.map((p) => (p.value !== null ? p.value : `\${${p.expr}}`)).join(''),
  };
}

function fastifyFacts(ctx, imports, facts, hints) {
  const { masked, workspace } = ctx;
  // Express writes app.get('/x', fn) too: a file counts as Fastify when the package lists fastify or the code itself names
  // it (an import of fastify or @fastify/*, a type like FastifyInstance). Each proof only adds: in a monorepo the app's
  // package.json may not list what the root installs. Comments, strings and a variable called fastify do not count.
  const isFastify = (Array.isArray(workspace.deps) && workspace.deps.includes('fastify'))
    || imports.specs.some((s) => /^(?:fastify(?:\/|$)|@fastify\/)/.test(s.spec)) || /(?<![\w$])Fastify[A-Z][\w$]*/.test(masked);
  if (!isFastify) return;
  const pathLike = (p) => p.startsWith('/') || p.startsWith('*');

  // register(fn, { prefix }) with a function of this file runs the routes written inside it under the prefix: that is a
  // scope. A plugin from another file leaves a hint for the index instead.
  const scopes = []; // { start, end, at, prefix: { value, expr } | null }
  const plugins = []; // { at, part, prefix }
  for (const m of masked.matchAll(REGISTER_RE)) {
    const parts = splitTop(masked, m.index + m[0].length - 1);
    if (!parts.length) continue;
    let prefix = null;
    const optionsAt = parts[1] ? ctx.firstAt(parts[1].start, parts[1].end) : -1;
    if (optionsAt >= 0 && masked[optionsAt] === '{') {
      const p = ctx.props(optionsAt).get('prefix');
      if (p) prefix = { value: ctx.literal(p.start, p.end), expr: ctx.expr(p.start, p.end) };
    }
    const range = localPlugin(ctx, parts[0]);
    if (range) scopes.push({ ...range, at: m.index, prefix });
    else plugins.push({ at: m.index, part: parts[0], prefix });
  }
  // Every chain of prefixes that reaches an offset (a function registered twice runs under both); [[]] for none. Only the
  // innermost functions around the offset count: the outer ones come in through the inner register() call itself.
  const chainsAt = (offset, depth = 0) => {
    const out = [];
    const around = depth < 8 ? scopes.filter((s) => offset > s.start && offset < s.end) : [];
    const size = (s) => s.end - s.start;
    for (const s of around) {
      if (around.some((t) => t.start >= s.start && t.end <= s.end && size(t) < size(s))) continue;
      for (const c of chainsAt(s.at, depth + 1)) out.push(s.prefix ? [...c, s.prefix] : c);
    }
    return out.length ? out : [[]];
  };

  const push = (method, pathValue, expr, offset, ambiguousMethod) => {
    const attrs = (path) => ({ method, path, framework: 'fastify' });
    for (const chain of chainsAt(offset)) {
      if (!chain.length) {
        const resolved = pathValue !== null;
        facts.push(mk(ctx, 'route', `route:${method} ${resolved ? pathValue : `?${expr}`}`, offset, attrs(pathValue),
          resolved && !ambiguousMethod ? 'EXTRACTED' : 'AMBIGUOUS'));
        continue;
      }
      // the prefix is written in another call: the joined path is the program's inference, not a text read whole
      const pre = prefixOf(chain);
      if (pre.value !== null && pathValue !== null) {
        const path = joinPath(pre.value, pathValue);
        facts.push(mk(ctx, 'route', `route:${method} ${path}`, offset, attrs(path), ambiguousMethod ? 'AMBIGUOUS' : 'INFERRED'));
      } else {
        const tail = pathValue !== null ? pathValue : `\${${expr}}`;
        facts.push(mk(ctx, 'route', `route:${method} ?${pre.text}${tail}`, offset, attrs(null), 'AMBIGUOUS'));
      }
    }
  };

  for (const m of masked.matchAll(VERB_RE)) {
    const parts = splitTop(masked, m.index + m[0].length - 1);
    if (!parts.length) continue;
    const method = m[2] === 'all' ? 'ANY' : m[2].toUpperCase();
    // a route always has a handler or options after the path; one argument alone is a getter, not a route
    if (parts.length < 2) continue;
    const lit = ctx.literal(parts[0].start, parts[0].end);
    if (lit !== null) {
      if (pathLike(lit)) push(method, lit, null, m.index);
    } else {
      push(method, null, ctx.expr(parts[0].start, parts[0].end), m.index);
    }
  }

  for (const m of masked.matchAll(ROUTE_RE)) {
    const open = m.index + m[0].length - 1;
    const props = ctx.props(open);
    const url = props.get('url') ?? props.get('path');
    if (!url) continue;
    let pathValue = ctx.literal(url.start, url.end);
    if (pathValue !== null && !pathLike(pathValue)) continue;
    const urlExpr = pathValue === null ? ctx.expr(url.start, url.end) : null;
    let methods = ['ANY'];
    let ambiguousMethod = true;
    const mv = props.get('method');
    if (mv) {
      const at = ctx.firstAt(mv.start, mv.end);
      const lits = masked[at] === '['
        ? splitTop(masked, at).map((p) => ctx.literal(p.start, p.end))
        : [ctx.literal(mv.start, mv.end)];
      if (lits.length && lits.every((l) => l !== null && /^[A-Za-z]+$/.test(l))) {
        methods = lits.map((l) => l.toUpperCase());
        ambiguousMethod = false;
      }
    }
    for (const method of methods) push(method, pathValue, urlExpr, m.index, ambiguousMethod);
  }

  // a plugin inside a prefixed function of this file carries that prefix too (Fastify nests them)
  for (const { at, part, prefix } of plugins) {
    const spec = pluginSpec(ctx, imports, part);
    if (!spec) continue;
    for (const chain of chainsAt(at)) {
      const full = prefix ? [...chain, prefix] : chain;
      if (full.length) hints.push({ kind: 'fastify-register', spec, prefix: prefixOf(full).value, line: ctx.lineOf(at) });
    }
  }
}

// The module the first argument of register() comes from, or null (a function defined in the same file, anything built).
function pluginSpec(ctx, imports, part) {
  const { masked, text } = ctx;
  const at = ctx.firstAt(part.start, part.end);
  const arg = masked.slice(at, part.end).trim();
  const name = /^([\w$]+)(?:\s*\.\s*[\w$]+)?$/.exec(arg);
  if (name) return imports.bindings.get(name[1]) ?? null;
  const call = /^(?:import|require)\s*\(\s*(['"])/.exec(arg);
  if (call) {
    const lit = literalAt(text, at + call[0].length - 1);
    return lit ? lit.value : null;
  }
  return null;
}

// ---------- Next.js ----------

function relativeTo(path, dir) {
  const d = (dir ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  if (!d) return path;
  return path.startsWith(`${d}/`) ? path.slice(d.length + 1) : path;
}

function appNameOf(workspace) {
  const dir = (workspace.dir ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  const base = dir ? dir.split('/').pop() : String(workspace.name ?? '').split('/').pop();
  return base || 'app';
}

// `export default ...`: { widget, line (where the component is declared), exportLine } or null when there is none.
function defaultExport(ctx) {
  const { masked } = ctx;
  const decl = (name) => {
    const d = new RegExp(`(?<![\\w$.])(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var)\\s+${name.replace(/\$/g, '\\$')}(?![\\w$])`).exec(masked);
    return d ? ctx.lineOf(d.index) : null;
  };
  const inline = /\bexport\s+default\s+(?:async\s+)?(?:function\b\s*\*?\s*([\w$]+)?|class\b\s*(?!extends\b)([\w$]+)?)/.exec(masked);
  if (inline) {
    const line = ctx.lineOf(inline.index);
    return { widget: inline[1] ?? inline[2] ?? null, line, exportLine: line };
  }
  const ident = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|\r?\n|$)/.exec(masked);
  if (ident && !NOT_A_NAME.has(ident[1])) {
    const exportLine = ctx.lineOf(ident.index);
    return { widget: ident[1], line: decl(ident[1]) ?? exportLine, exportLine };
  }
  for (const m of masked.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const item of m[1].split(',')) {
      const a = /^\s*([\w$]+)\s+as\s+default\s*$/.exec(item);
      if (a) {
        const exportLine = ctx.lineOf(m.index);
        return { widget: a[1], line: decl(a[1]) ?? exportLine, exportLine };
      }
    }
  }
  const any = /\bexport\s+default\b/.exec(masked);
  if (any) {
    const line = ctx.lineOf(any.index);
    return { widget: null, line, exportLine: line };
  }
  return null;
}

// A Vite or React app has pages/ and app/ folders too. Next is proven by the package list, an import of next in the
// file or a next.config in the package folder; any one is enough (the list may live in a monorepo root instead).
function isNext(ctx, imports, files) {
  const { workspace } = ctx;
  if (Array.isArray(workspace.deps) && workspace.deps.includes('next')) return true;
  if (imports.specs.some((s) => s.spec === 'next' || s.spec.startsWith('next/'))) return true;
  const dir = (workspace.dir ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  const prefix = dir ? `${dir}/` : '';
  return (files ?? []).some((f) => f.startsWith(prefix) && /^next\.config\.(?:js|mjs|cjs|ts)$/.test(f.slice(prefix.length)));
}

function nextFacts(ctx, imports, files, facts) {
  const { workspace, masked } = ctx;
  if (!isNext(ctx, imports, files)) return;
  const rel = relativeTo(ctx.path, workspace.dir);
  const app = appNameOf(workspace);

  const appMatch = /^(?:src\/)?app\/(.+)$/.exec(rel);
  if (appMatch) {
    const segs = appMatch[1].split('/');
    const file = segs.pop();
    const dirs = segs;
    // @slots, _private folders and (.) intercepts are not places of their own
    if (dirs.some((s) => s.startsWith('@') || s.startsWith('_') || /^\(\.{1,3}\)/.test(s))) return;
    const route = `/${dirs.filter((s) => !/^\([^)]*\)$/.test(s)).join('/')}`;
    if (/^page\.(?:jsx?|tsx?)$/.test(file)) {
      const def = defaultExport(ctx);
      if (def) {
        facts.push(mk(ctx, 'screen', `screen:${app}:${route}`, offsetOfLine(ctx, def.line),
          { framework: 'next-app', route, widget: def.widget }));
      }
    } else if (/^route\.(?:jsx?|tsx?)$/.test(file)) {
      const seen = new Set();
      const add = (verb, offset) => {
        if (seen.has(verb)) return;
        seen.add(verb);
        facts.push(mk(ctx, 'route', `route:${verb} ${route}`, offset, { method: verb, path: route, framework: 'next-app' }));
      };
      for (const m of masked.matchAll(new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s*\\*?\\s*(${NEXT_VERB_PAT})\\b`, 'g'))) add(m[1], m.index);
      for (const m of masked.matchAll(new RegExp(`\\bexport\\s+(?:const|let|var)\\s+(${NEXT_VERB_PAT})\\b`, 'g'))) add(m[1], m.index);
      for (const m of masked.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
        for (const item of m[1].split(',')) {
          const s = /^\s*(?:[\w$]+\s+as\s+)?([\w$]+)\s*$/.exec(item);
          if (s && NEXT_VERBS.includes(s[1])) add(s[1], m.index);
        }
      }
    }
    return;
  }

  const pagesMatch = /^(?:src\/)?pages\/(.+)\.(?:jsx?|tsx?)$/.exec(rel);
  if (pagesMatch) {
    const segs = pagesMatch[1].split('/');
    const base = segs[segs.length - 1];
    if (base.startsWith('_') || /\.(?:test|spec|d)$/.test(base)) return;
    if (base === 'index') segs.pop();
    const route = `/${segs.join('/')}`;
    const def = defaultExport(ctx);
    if (!def) return;
    if (segs[0] === 'api') {
      facts.push(mk(ctx, 'route', `route:ANY ${route}`, offsetOfLine(ctx, def.exportLine),
        { method: 'ANY', path: route, framework: 'next-pages' }));
    } else {
      facts.push(mk(ctx, 'screen', `screen:${app}:${route}`, offsetOfLine(ctx, def.line),
        { framework: 'next-pages', route, widget: def.widget }));
    }
  }
}

// An offset that falls on a 1-based line (its start); facts only keep the line, so any offset of the line does.
function offsetOfLine(ctx, line) {
  let at = 0;
  for (let l = 1; l < line; l++) at = ctx.text.indexOf('\n', at) + 1;
  return at;
}

// ---------- BullMQ ----------

function bullmqFacts(ctx, imports, facts) {
  const { masked, workspace } = ctx;
  const fromBull = imports.specs.some((s) => s.spec === 'bullmq' || s.spec === 'bull' || s.spec.startsWith('bullmq/'));
  // p-queue and async have queue.add() too: a queue imported from another file is taken for a BullMQ one only when the
  // package lists bullmq or bull, or this file imports it.
  const usesBull = fromBull || (Array.isArray(workspace.deps) && (workspace.deps.includes('bullmq') || workspace.deps.includes('bull')));
  // bull (v3) is not bullmq: the lib is the package the file imports, else the one the package lists
  const imported = (p) => imports.specs.some((s) => s.spec === p || s.spec.startsWith(`${p}/`));
  const listed = (p) => Array.isArray(workspace.deps) && workspace.deps.includes(p);
  const lib = imported('bullmq') ? 'bullmq' : imported('bull') ? 'bull' : listed('bullmq') || !listed('bull') ? 'bullmq' : 'bull';
  const queues = new Map(); // variable -> queue key ('emails', or '?expression' when the name is not a literal)

  if (fromBull) {
    for (const m of masked.matchAll(QUEUE_NEW_RE)) {
      const parts = splitTop(masked, m.index + m[0].length - 1);
      if (!parts.length) continue;
      const name = ctx.literal(parts[0].start, parts[0].end);
      const key = name ?? `?${ctx.expr(parts[0].start, parts[0].end)}`;
      const attrs = { lib };
      if (name === null) attrs.name = null;
      if (m[1] === 'Worker') attrs.use = 'worker';
      if (m[1] === 'QueueScheduler') attrs.use = 'scheduler';
      facts.push(mk(ctx, 'queue', `queue:${key}`, m.index, attrs, name === null ? 'AMBIGUOUS' : 'EXTRACTED'));
      if (m[1] === 'Queue') {
        const before = masked.slice(Math.max(0, m.index - 200), m.index);
        const b = /([\w$]+)\s*(?::[^=;(){}]+?)?(?<![=!<>])=\s*(?:await\s+)?$/.exec(before);
        if (b) queues.set(b[1], key);
      }
    }
  }

  for (const m of masked.matchAll(ADD_RE)) {
    const receiver = m[1];
    let key = queues.get(receiver);
    if (key === undefined && usesBull && /queue/i.test(receiver) && imports.bindings.has(receiver)) key = `?${receiver}`;
    if (key === undefined) continue;
    const parts = splitTop(masked, m.index + m[0].length - 1);
    // BullMQ's add is (name, data, opts): the name is a string or a plain name, never a function or a built expression
    if (parts.length < 2) continue;
    const first = masked.slice(parts[0].start, parts[0].end).trim();
    if (!/^['"`]/.test(first) && !/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(first)) continue;
    const jobName = ctx.literal(parts[0].start, parts[0].end);
    const jobKey = jobName ?? `?${ctx.expr(parts[0].start, parts[0].end)}`;
    let role = 'producer';
    if (parts[2]) {
      const at = ctx.firstAt(parts[2].start, parts[2].end);
      if (masked[at] === '{' && ctx.props(at).has('repeat')) role = 'cron';
    }
    const dynamicQueue = key.startsWith('?');
    const attrs = { queue: dynamicQueue ? null : key, lib, role };
    if (jobName === null) attrs.name = null;
    facts.push(mk(ctx, 'job', `job:${key}/${jobKey}`, m.index, attrs, dynamicQueue || jobName === null ? 'AMBIGUOUS' : 'EXTRACTED'));
  }
}

// ---------- environment variables ----------

function envFacts(ctx, facts) {
  const { masked, text } = ctx;
  const push = (name, offset) => facts.push(mk(ctx, 'env', `env:${name}`, offset, { source: 'code' }));
  for (const m of masked.matchAll(ENV_RE)) {
    if (m[1]) { push(m[1], m.index); continue; }
    const quoteAt = m.index + m[0].length - 1;
    const lit = literalAt(text, quoteAt);
    if (lit && /^[A-Za-z_][A-Za-z0-9_]*$/.test(lit.value) && /^\s*\]/.test(masked.slice(lit.end, lit.end + 20))) push(lit.value, m.index);
  }
  for (const m of masked.matchAll(ENV_DESTRUCT_RE)) {
    const base = m.index + m[0].indexOf('{') + 1;
    let at = 0;
    for (const piece of m[1].split(',')) {
      const id = /^(\s*)([A-Za-z_$][\w$]*)/.exec(piece);
      if (id) push(id[2], base + at + id[1].length);
      at += piece.length + 1;
    }
  }
}

// ---------- integrations ----------

const isLocalHost = (host) => {
  // IPv6: loopback, unique-local (fc00::/7) and link-local (fe80::/10) are this machine or its network; the rest is public
  if (host.startsWith('[')) return host === '[::1]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host);
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// The host of a URL whose beginning is written literally. `complete` = the whole URL is the literal; otherwise the host must
// be closed by a / ? # or : inside the literal part, or it could still be growing (`'https://api-' + env + '.x.com'`).
function hostOf(value, complete) {
  const m = /^https?:\/\/(?:[^/?#@]*@)?(\[[0-9a-f:.]*\]|[^/?#:[]+)([/?#:]|$)/i.exec(value);
  if (!m || (!m[2] && !complete)) return null;
  const host = m[1].toLowerCase();
  return isLocalHost(host) ? null : host;
}

function urlOf(ctx, part) {
  const { masked, text } = ctx;
  const at = ctx.firstAt(part.start, part.end);
  if (at < 0 || !/['"`]/.test(masked[at])) return null;
  const lit = literalAt(text, at);
  if (lit) return hostOf(lit.value, masked.slice(lit.end, part.end).trim() === '');
  if (masked[at] === '`') {
    const dollar = text.indexOf('${', at + 1);
    if (dollar > 0 && dollar < part.end) return hostOf(text.slice(at + 1, dollar), false);
  }
  return null;
}

function integrationFacts(ctx, imports, facts) {
  const { masked } = ctx;
  for (const { spec, at, typeOnly } of imports.specs) {
    // a type-only import is erased at build time: the file never reaches the service through it
    if (typeOnly) continue;
    const pkg = packageOf(spec);
    if (isSdk(pkg)) facts.push(mk(ctx, 'integration', `integration:${pkg}`, at, { via: 'sdk', package: pkg }));
  }
  const push = (host, offset) => facts.push(mk(ctx, 'integration', `integration:${host}`, offset, { via: 'url', host }));
  for (const m of masked.matchAll(URL_CALL_RE)) {
    const parts = splitTop(masked, m.index + m[0].length - 1);
    const args = /new\s+URL/.test(m[0]) ? parts.slice(0, 2) : parts.slice(0, 1);
    for (const part of args) {
      const host = urlOf(ctx, part);
      if (host) { push(host, m.index); break; }
    }
  }
  for (const m of masked.matchAll(AXIOS_CREATE_RE)) {
    const base = ctx.props(m.index + m[0].length - 1).get('baseURL');
    if (!base) continue;
    const host = urlOf(ctx, base);
    if (host) push(host, m.index);
  }
}

// ---------- entry ----------

export function extract({ path, type, text, masked, workspace, files }) {
  const body = masked ?? lex(text, type).masked;
  const ctx = makeCtx(path, text, body, workspace);
  const imports = importsOf(ctx);
  const facts = [];
  const hints = [];
  fastifyFacts(ctx, imports, facts, hints);
  nextFacts(ctx, imports, files, facts);
  bullmqFacts(ctx, imports, facts);
  envFacts(ctx, facts);
  integrationFacts(ctx, imports, facts);
  facts.sort((a, b) => a._at - b._at);
  const merged = dedupe(facts, new Set(['env', 'integration']));
  for (const f of merged) delete f._at;
  hints.sort((a, b) => a.line - b.line);
  return { facts: merged, hints };
}
