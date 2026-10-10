// Flutter/Dart reader: screens (widget classes, bound to routes), integrations (literal URLs, known pubspec packages) and
// environment variable names. Patterns run on the text the lex already masked, so a comment or a string that mentions
// `GoRoute(` or `Uri.parse(` never becomes a fact. A screen and its route usually live in different files, so each file
// only reports what it sees and `resolveDartHints` joins them (the index calls it once with every fact and hint).
import { lex, literalAt } from '../lex.mjs';

export const VERSION = 'dart@1';
export const TYPES = ['dart', 'yaml'];

// ---------- text helpers ----------

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
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

// The offset of the bracket that closes the one at `open`, or -1.
function closeOf(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The comma-separated parts that sit directly inside the bracket at `open`: [{ start, end }].
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
  ctx.firstAt = (start, end) => {
    for (let i = start; i < end; i++) if (!/\s/.test(masked[i])) return i;
    return -1;
  };
  // The value of a string literal that fills the whole range; null for anything else (a name, a concatenation, `$x`).
  ctx.literal = (start, end) => {
    const at = ctx.firstAt(start, end);
    if (at < 0 || !/['"]/.test(masked[at])) return null;
    const lit = literalAt(text, at, 'dart');
    return lit && masked.slice(lit.end, end).trim() === '' ? lit.value : null;
  };
  // Top-level `name: value` pairs of the argument list that opens at `open`: name -> { start, end } of the value.
  ctx.props = (open) => {
    const out = new Map();
    for (const part of splitTop(masked, open)) {
      const m = /^\s*(\w+)\s*:\s*/.exec(text.slice(part.start, part.end));
      if (m && !out.has(m[1])) out.set(m[1], { start: part.start + m[0].length, end: part.end });
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

function relativeTo(path, dir) {
  const d = (dir ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  if (!d) return path;
  return path.startsWith(`${d}/`) ? path.slice(d.length + 1) : path;
}

function appNameOf(workspace) {
  const dir = (workspace.dir ?? '').replace(/\/$/, '');
  const base = dir ? dir.split('/').pop() : String(workspace.name ?? '').split('/').pop();
  return base || 'app';
}

// ---------- screens ----------

const CLASS_RE = /^[ \t]*((?:(?:abstract|final|base|interface|sealed)\s+)*)class\s+(\w+)(?:\s*<[^>{]*>)?\s+extends\s+(?:StatelessWidget|StatefulWidget)\b/gm;
const SCREEN_NAME_RE = /(?:Screen|Page|View)$/;
const SCREEN_DIR_RE = /(?:^|\/)(?:screens|pages|views)\//;

function screenFacts(ctx, facts, hints) {
  const rel = relativeTo(ctx.path, ctx.workspace.dir);
  if (!rel.startsWith('lib/')) return;
  const app = appNameOf(ctx.workspace);
  for (const m of ctx.masked.matchAll(CLASS_RE)) {
    const name = m[2];
    if (/\babstract\b/.test(m[1]) || name.startsWith('_')) continue;
    const at = m.index + m[0].indexOf('class');
    if (SCREEN_NAME_RE.test(name) || SCREEN_DIR_RE.test(rel)) {
      facts.push(mk(ctx, 'screen', `screen:${app}:${name}`, at, { framework: 'flutter', route: null, widget: name }, 'INFERRED'));
    } else {
      hints.push({ kind: 'dart-widget', file: ctx.path, line: ctx.lineOf(at), app, name, _at: at });
    }
  }
}

// The widget classes a builder expression builds: every capitalised constructor call, in the order written.
function widgetsIn(masked, start, end) {
  const names = [];
  for (const m of masked.slice(start, end).matchAll(/\b([A-Z]\w*)(?:\s*\.\s*\w+)?\s*(?:<[^>()]*>)?\s*\(/g)) names.push(m[1]);
  return names;
}

function joinPath(parent, child) {
  if (child.startsWith('/')) return child;
  return `${parent.replace(/\/$/, '')}/${child}`;
}

function routeHints(ctx, hints) {
  const { masked } = ctx;
  const app = appNameOf(ctx.workspace);
  const rel = relativeTo(ctx.path, ctx.workspace.dir);
  if (!rel.startsWith('lib/')) return;

  const routes = [];
  for (const m of masked.matchAll(/\bGoRoute\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const props = ctx.props(open);
    const route = { at: m.index, close: closeOf(masked, open), props };
    const child = props.get('routes');
    route.sub = child ? { start: child.start, end: child.end } : null;
    const p = props.get('path');
    route.path = p ? ctx.literal(p.start, p.end) : undefined;
    routes.push(route);
  }
  for (const r of routes) {
    const chain = routes.filter((a) => a !== r && a.sub && r.at >= a.sub.start && r.at < a.sub.end).sort((a, b) => a.at - b.at);
    const builder = r.props.get('builder') ?? r.props.get('pageBuilder');
    if (r.path === undefined || !builder) continue;
    const widgets = widgetsIn(masked, builder.start, builder.end);
    if (!widgets.length) continue;
    let route = r.path;
    let nested = false;
    if (chain.length) {
      nested = true;
      let full = '';
      for (const a of [...chain, r]) {
        if (a.path === null || a.path === undefined || full === null) { full = null; break; }
        full = full === '' ? a.path : joinPath(full, a.path);
      }
      route = full;
    }
    hints.push({ kind: 'dart-route', file: ctx.path, line: ctx.lineOf(r.at), app, route, nested, widgets, _at: r.at });
  }

  // MaterialApp(routes: { '/x': (context) => X() })
  for (const m of masked.matchAll(/\broutes\s*:\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    for (const part of splitTop(masked, open)) {
      const at = ctx.firstAt(part.start, part.end);
      if (at < 0) continue;
      let route = null;
      let valueStart = -1;
      if (/['"]/.test(masked[at])) {
        const lit = literalAt(ctx.text, at, 'dart');
        const colon = lit ? /^\s*:/.exec(masked.slice(lit.end, part.end)) : null;
        if (lit && colon) { route = lit.value; valueStart = lit.end + colon[0].length; }
      }
      if (valueStart < 0) {
        const colon = masked.indexOf(':', at);
        if (colon < 0 || colon >= part.end) continue;
        valueStart = colon + 1;
      }
      const widgets = widgetsIn(masked, valueStart, part.end);
      if (widgets.length) hints.push({ kind: 'dart-route', file: ctx.path, line: ctx.lineOf(at), app, route, nested: false, widgets, _at: at });
    }
  }
}

// Joins the screen facts and the hints of every Dart file. A route that names a widget of the project turns that widget
// into one screen per route (EXTRACTED; INFERRED when the program joined nested paths; AMBIGUOUS when the path is not
// literal or the widget name is defined in more than one file). Screens no route reaches stay as they were; widgets no
// route reaches are not screens. Pure: facts and hints are not changed.
export function resolveDartHints(facts, hints) {
  const widgetHints = hints.filter((h) => h.kind === 'dart-widget');
  const routeHints = hints.filter((h) => h.kind === 'dart-route');
  const isScreen = (f) => f.kind === 'screen' && f.attrs?.framework === 'flutter' && f.extractor === VERSION;
  const items = [];
  for (const f of facts) if (isScreen(f)) items.push({ name: f.attrs.widget, file: f.file, line: f.line, app: f.id.split(':')[1], fact: f });
  for (const h of widgetHints) items.push({ name: h.name, file: h.file, line: h.line, app: h.app, fact: null });
  const byName = new Map();
  for (const it of items) byName.set(it.name, [...(byName.get(it.name) ?? []), it]);
  for (const it of items) it.routes = [];
  for (const r of routeHints) {
    const name = r.widgets.find((w) => byName.has(w));
    if (!name) continue;
    const cands = byName.get(name);
    for (const it of cands) {
      if (it.app !== r.app) continue;
      let origin = r.nested ? 'INFERRED' : 'EXTRACTED';
      if (r.route === null || cands.filter((c) => c.app === r.app).length > 1) origin = 'AMBIGUOUS';
      it.routes.push({ route: r.route, origin });
    }
  }
  const made = new Map();
  for (const it of items) {
    if (!it.routes.length) { made.set(it, it.fact ? [it.fact] : []); continue; }
    const out = [];
    const seen = new Set();
    for (const r of it.routes) {
      const id = `screen:${it.app}:${r.route ?? it.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id, kind: 'screen', name: id.slice(id.indexOf(':') + 1), file: it.file, line: it.line, origin: r.origin,
        extractor: VERSION, attrs: { framework: 'flutter', route: r.route, widget: it.name }, refs: [],
      });
    }
    made.set(it, out);
  }
  const factItem = new Map(items.filter((it) => it.fact).map((it) => [it.fact, it]));
  const out = [];
  for (const f of facts) out.push(...(factItem.has(f) ? made.get(factItem.get(f)) : [f]));
  for (const it of items) if (!it.fact) out.push(...made.get(it));
  return out;
}

// ---------- integrations ----------

const isLocalHost = (host) => {
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.startsWith('[')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// The host of a URL whose beginning is written literally. `complete` = the whole URL is the literal; otherwise the host
// must be closed by a / ? # or : inside the literal part, or it could still be growing ('https://api-$env.x.com').
function hostOf(value, complete) {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)([/?#:]|$)/i.exec(value);
  if (!m || (!m[2] && !complete)) return null;
  const host = m[1].toLowerCase();
  return isLocalHost(host) ? null : host;
}

function urlOf(ctx, part) {
  const { masked, text } = ctx;
  const at = ctx.firstAt(part.start, part.end);
  if (at < 0 || !/['"]/.test(masked[at])) return null;
  const lit = literalAt(text, at, 'dart');
  if (lit) return hostOf(lit.value, masked.slice(lit.end, part.end).trim() === '');
  const end = masked.indexOf(masked[at], at + 1);
  const dollar = text.indexOf('$', at + 1);
  if (end > 0 && dollar > 0 && dollar < end) return hostOf(text.slice(at + 1, dollar), false);
  return null;
}

const URI_PARSE_RE = /\bUri\s*\.\s*parse\s*\(/g;
const URI_AUTH_RE = /\bUri\s*\.\s*(?:https|http)\s*\(/g;
const DIO_CALL_RE = /\.\s*(?:get|post|put|patch|delete|head|request|download|fetch|getUri|postUri)\s*(?:<[^>()]*>)?\s*\(/g;
const BASE_URL_RE = /\bbaseUrl\s*:/g;

function integrationFacts(ctx, facts) {
  const { masked, text } = ctx;
  const push = (host, offset) => facts.push(mk(ctx, 'integration', `integration:${host}`, offset, { via: 'url', host }));
  const firstArg = (m) => splitTop(masked, m.index + m[0].length - 1)[0];
  for (const m of masked.matchAll(URI_PARSE_RE)) {
    const part = firstArg(m);
    const host = part && urlOf(ctx, part);
    if (host) push(host, m.index);
  }
  for (const m of masked.matchAll(URI_AUTH_RE)) {
    const part = firstArg(m);
    const value = part && ctx.literal(part.start, part.end);
    const host = value ? hostOf(`https://${value}/`, true) : null;
    if (host) push(host, m.index);
  }
  if (/package:dio\//.test(text)) {
    for (const m of masked.matchAll(DIO_CALL_RE)) {
      const part = firstArg(m);
      const host = part && urlOf(ctx, part);
      if (host) push(host, m.index);
    }
    for (const m of masked.matchAll(BASE_URL_RE)) {
      const end = masked.indexOf(',', m.index);
      const close = masked.indexOf(')', m.index);
      const stop = [end, close].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? masked.length;
      const host = urlOf(ctx, { start: m.index + m[0].length, end: stop });
      if (host) push(host, m.index);
    }
  }
}

// ---------- environment ----------

const ENV_RE = /\b(?:(?:String|bool|int)\s*\.\s*fromEnvironment|dotenv\s*\.\s*(?:get|maybeGet))\s*\(|\b(?:dotenv\s*\.\s*env|Platform\s*\.\s*environment)\s*\[/g;

function envFacts(ctx, facts) {
  const { masked, text } = ctx;
  for (const m of masked.matchAll(ENV_RE)) {
    const from = m.index + m[0].length;
    const at = ctx.firstAt(from, masked.length);
    if (at < 0 || !/['"]/.test(masked[at])) continue;
    const lit = literalAt(text, at, 'dart');
    if (!lit || !/^[A-Za-z_]\w*$/.test(lit.value) || !/^\s*[,)\]]/.test(masked.slice(lit.end, lit.end + 40))) continue;
    facts.push(mk(ctx, 'env', `env:${lit.value}`, m.index, { source: 'code' }));
  }
}

// ---------- pubspec ----------

const KNOWN_PACKAGE_RE = /^(?:firebase_\w+|google_maps_flutter|sentry_flutter)$/;

function pubspecFacts(ctx, facts) {
  const lines = ctx.masked.split(/\r?\n/);
  let inDeps = false;
  let indent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lead = /^ */.exec(line)[0].length;
    if (lead === 0) { inDeps = /^dependencies\s*:\s*$/.test(line); indent = -1; continue; }
    if (!inDeps) continue;
    if (indent < 0) indent = lead;
    if (lead !== indent) continue;
    const m = /^\s*([A-Za-z_]\w*)\s*:/.exec(line);
    if (!m || !KNOWN_PACKAGE_RE.test(m[1])) continue;
    facts.push({
      id: `integration:${m[1]}`, kind: 'integration', name: m[1], file: ctx.path, line: i + 1, origin: 'EXTRACTED',
      extractor: VERSION, attrs: { via: 'sdk', package: m[1] }, refs: [], _at: i,
    });
  }
}

// ---------- entry ----------

export function extract({ path, type, text, masked, workspace }) {
  const isPubspec = path === 'pubspec.yaml' || path.endsWith('/pubspec.yaml');
  if (type !== 'dart' && !isPubspec) return { facts: [], hints: [] };
  const body = masked ?? lex(text, type).masked;
  const ctx = makeCtx(path, text, body, workspace);
  const facts = [];
  const hints = [];
  if (type === 'dart') {
    screenFacts(ctx, facts, hints);
    routeHints(ctx, hints);
    integrationFacts(ctx, facts);
    envFacts(ctx, facts);
  } else {
    pubspecFacts(ctx, facts);
  }
  facts.sort((a, b) => a._at - b._at);
  const merged = dedupe(facts, new Set(['env', 'integration']));
  for (const f of merged) delete f._at;
  hints.sort((a, b) => a._at - b._at);
  for (const h of hints) delete h._at;
  return { facts: merged, hints };
}
