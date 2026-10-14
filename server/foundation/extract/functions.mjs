// Level 4 reader (fd02, "who calls whom"): the functions and methods of JS/TS, Dart and PHP files, the names a JS file
// exports, and the calls between functions of the project. Exact, not clever: every pattern runs on the text with
// comments and string contents blanked by lex(), a body ends at its balanced closing brace, and a call becomes a fact
// only when its target is sure (same file, the own class, or a name imported from a resolved project file). When more
// than one project function could be meant the call is AMBIGUOUS with the candidates; a library or global call
// (console.log, fetch, print) is never a fact. Pure: the index hands the text and the resolved imports in.
// A JS function written inside another named function (fd17) is a function fact too, id `fn:path#outer>inner`, with
// attrs.parent = the outer's name; it is for the skeleton of a file only: not a map node, not a call target or caller.
//
//   extract({ path, type, text, masked })  -> { facts: function + export facts, hints: call sites (kind 'call-site') }
//   importNames({ path, type, text, masked }) -> [{ name, imported, spec, line }]  (the index resolves spec -> file)
//   linkCalls(facts, hints, { imports })  -> call facts; imports = { [path]: [{ name, imported, file }] }
//   extractFunctions(entries)              -> every fact of a set of files ({ path, type, text, masked?, imports? })
//
// Import entries: name = the local name; imported = the name in the target file ('default' for a default import,
// '*' for a whole module: a namespace `ns`, or name '*' too for a Dart import that brings every name in).
import { lex, literalAt } from '../lex.mjs';
import { kindOfFile } from '../../sources/count.mjs';

export const VERSION = 'functions@1';
export const TYPES = ['js', 'ts', 'tsx', 'jsx', 'dart', 'php'];

const LANG = { js: 'js', ts: 'js', tsx: 'js', jsx: 'js', dart: 'dart', php: 'php' };
const EXT_LANG = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', mts: 'js', cts: 'js', tsx: 'js', dart: 'dart', php: 'php' };
const words = (s) => new Set(s.split(' '));
const KEYWORDS = {
  js: words('if for while switch catch return typeof function async await yield new delete void in of instanceof do else try finally throw case super import export class extends with constructor require'),
  dart: words('if for while switch catch return assert super this new const rethrow throw await yield factory get set operator late required var final else in is as on async sync'),
  php: words('if elseif else for foreach while switch catch match return array list isset unset empty echo print include include_once require require_once function fn new clone die exit eval declare use static self parent and or xor instanceof'),
};
const JS_MODIFIERS = words('static async public private protected readonly override abstract declare accessor');
const DART_MODIFIERS = words('static external abstract covariant');
const DART_NOT_TYPE = words('return await new const throw else yield case in is as get set operator assert if while for switch catch on var final late');
const CONSTRUCTORS = new Set(['constructor', '__construct']);

const isId = (c) => c !== undefined && /[\w$]/.test(c);
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

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

// Bracket depth before each offset (strings and comments are already blanks, so every bracket left is code).
function depths(m) {
  const d = new Int32Array(m.length + 1);
  let k = 0;
  for (let i = 0; i < m.length; i++) {
    d[i] = k;
    const c = m[i];
    if (c === '(' || c === '[' || c === '{') k++;
    else if ((c === ')' || c === ']' || c === '}') && k > 0) k--;
  }
  d[m.length] = k;
  return d;
}

function closeOf(m, open) {
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    const c = m[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function skipWs(m, i) {
  while (i < m.length && isWs(m[i])) i++;
  return i;
}
function prevNonWs(m, i) {
  while (i >= 0 && isWs(m[i])) i--;
  return i;
}
// The identifier that ends at `end` (inclusive): { word, start }.
function wordEndingAt(m, end) {
  let s = end;
  while (s >= 0 && isId(m[s])) s--;
  return { word: m.slice(s + 1, end + 1), start: s + 1 };
}
function wordAt(m, i) {
  let e = i;
  while (e < m.length && isId(m[e])) e++;
  return m.slice(i, e);
}
// Past a generic list `<...>` that starts at `i` (angle brackets counted, nothing else); -1 when it does not close.
function skipAngles(m, i) {
  let depth = 0;
  for (let k = i; k < m.length; k++) {
    if (m[k] === '<') depth++;
    else if (m[k] === '>' && m[k - 1] !== '=') { depth--; if (depth === 0) return k + 1; }
    else if (m[k] === ';' || m[k] === '{' || m[k] === '}') return -1;
  }
  return -1;
}

// After a parameter list (or anything before a body), the first thing that decides: { open } (a `{` body),
// { arrow } (offset after `=>`), { semi } (no body) or null. Return types (TS `: T`, PHP `: ?T`) and Dart initializer
// lists are walked over; a `{` right after `:`, `|`, `&`, `,`, `(`, `=`, `<` or `=>` belongs to a type or an expression.
function scanBody(m, from, arrowWanted) {
  let depth = 0;
  let angle = 0;
  for (let i = from; i < m.length; i++) {
    const c = m[i];
    if (c === '=' && m[i + 1] === '>') {
      if (depth === 0 && angle === 0 && arrowWanted) return { arrow: i + 2 };
      i++;
      continue;
    }
    if (depth === 0 && c === '<') { angle++; continue; }
    if (depth === 0 && c === '>') { if (angle > 0) angle--; continue; }
    if (c === '(' || c === '[') { depth++; continue; }
    if (c === ')' || c === ']') { if (depth === 0) return null; depth--; continue; }
    if (c === '{') {
      if (depth === 0 && angle === 0 && !arrowWanted) {
        const p = prevNonWs(m, i - 1);
        const typeStart = ':|&,(=<'.includes(m[p]) || (m[p] === '>' && m[p - 1] === '=');
        if (!typeStart) return { open: i };
      }
      const close = closeOf(m, i);
      if (close < 0) return null;
      i = close;
      continue;
    }
    if (c === '}') return null;
    if (c === ';' && depth === 0) return { semi: i };
  }
  return null;
}

// The last code offset of an arrow's expression body that starts at `from`.
function exprEnd(m, from, lang) {
  let depth = 0;
  let last = from - 1;
  for (let i = skipWs(m, from); i < m.length; i++) {
    const c = m[i];
    if (c === '`') {
      for (let k = i + 1; k < m.length; k++) {
        if (m[k] === '`') { i = k; break; }
        if (m[k] === '$' && m[k + 1] === '{') { const close = closeOf(m, k + 1); if (close < 0) return last; k = close; }
      }
      last = i;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return last; depth--; }
    else if (depth === 0 && c === ';') return last;
    else if (depth === 0 && c === ',' && lang === 'js') return last;
    else if (depth === 0 && c === '\n' && lang === 'js' && last >= from) {
      const prev = m[last];
      const next = m[skipWs(m, i)];
      const goesOn = '=+-*/%&|^!?:,<>(.'.includes(prev) || (next !== undefined && '.?:+-*/%&|^=<>'.includes(next));
      if (!goesOn) return last;
    }
    if (!isWs(c)) last = i;
  }
  return last;
}

// The pieces between the top-level commas of the brackets at `open`..`close`: [string].
function splitTop(m, open, close) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = m[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && m[i - 1] !== '=')) depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { out.push(m.slice(start, i)); start = i + 1; }
  }
  out.push(m.slice(start, close));
  return out.map((s) => s.trim()).filter(Boolean);
}

function stripBrackets(s) {
  let out = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(' || c === '<' || c === '[') depth++;
    else if ((c === ')' || c === '>' || c === ']') && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

function paramsOf(m, open, close, lang) {
  if (close < 0) return [];
  const out = [];
  for (const piece of splitTop(m, open, close)) {
    if (lang === 'php') {
      const hit = /(&)?\s*(\.\.\.)?\s*(&)?\s*(\$[A-Za-z_]\w*)/.exec(piece);
      if (hit) out.push(`${hit[1] || hit[3] ? '&' : ''}${hit[2] ? '...' : ''}${hit[4]}`);
    } else if (lang === 'dart') {
      if (piece[0] === '{' || piece[0] === '[') {
        const end = closeOf(piece, 0);
        out.push(...paramsOf(piece, 0, end < 0 ? piece.length : end, 'dart'));
        continue;
      }
      let p = piece.replace(/@\w+(?:\([^)]*\))?/g, ' ');
      const eq = p.search(/=|:(?!:)/);
      if (eq >= 0) p = p.slice(0, eq);
      const names = stripBrackets(p).match(/[A-Za-z_$][\w$]*/g) ?? [];
      const name = names.filter((n) => n !== 'required' && n !== 'covariant').pop();
      if (name) out.push(name);
    } else {
      const p = piece.replace(/^@[\w$.]+(?:\([^)]*\))?\s*/, '').replace(/^(?:(?:public|private|protected|readonly|override)\s+)+/, '');
      if (p[0] === '{' || p[0] === '[') {
        const end = closeOf(p, 0);
        out.push(p.slice(0, end < 0 ? p.length : end + 1).replace(/\s+/g, ' '));
        continue;
      }
      const hit = /^(\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(p);
      if (hit && hit[2] !== 'this') out.push(`${hit[1] ?? ''}${hit[2]}`);
    }
  }
  return out;
}

// Names a parameter list or a body declares, for the "a local name hides the file's" rule.
const namesIn = (params) => new Set(params.flatMap((p) => p.match(/[A-Za-z_$][\w$]*/g) ?? []));

// A function value written at `i` (after `=` or `:`): { async, open, close, body } or null.
function fnValue(m, i) {
  let k = skipWs(m, i);
  let async = false;
  if (wordAt(m, k) === 'async') {
    const after = skipWs(m, k + 5);
    if (m[after] !== '=' && m[after] !== ';' && m[after] !== ',') { async = true; k = after; }
  }
  if (wordAt(m, k) === 'function') {
    k = skipWs(m, k + 8);
    if (m[k] === '*') k = skipWs(m, k + 1);
    if (isId(m[k])) k = skipWs(m, k + wordAt(m, k).length);
    if (m[k] === '<') { k = skipAngles(m, k); if (k < 0) return null; k = skipWs(m, k); }
    if (m[k] !== '(') return null;
    const close = closeOf(m, k);
    if (close < 0) return null;
    const body = scanBody(m, close + 1, false);
    return body?.open !== undefined ? { async, open: k, close, body } : null;
  }
  if (m[k] === '<') { k = skipAngles(m, k); if (k < 0) return null; k = skipWs(m, k); }
  if (m[k] === '(') {
    const close = closeOf(m, k);
    if (close < 0) return null;
    const j = skipWs(m, close + 1);
    let arrow = null;
    if (m.startsWith('=>', j)) arrow = j + 2;
    else if (m[j] === ':') arrow = scanBody(m, j + 1, true)?.arrow ?? null;
    if (arrow === null) return null;
    return { async, open: k, close, body: arrowBody(m, arrow) };
  }
  if (isId(m[k]) && !/\d/.test(m[k])) {
    const w = wordAt(m, k);
    const j = skipWs(m, k + w.length);
    if (m.startsWith('=>', j)) return { async, open: k - 1, close: k + w.length, single: w, body: arrowBody(m, j + 2) };
  }
  return null;
}
function arrowBody(m, after) {
  const k = skipWs(m, after);
  return m[k] === '{' ? { open: k } : { arrow: after };
}

// ---------- declarations ----------

function makeFn(ctx, { name, scope, nameAt, async, open, close, single, body }) {
  const { m, lang, lineOf } = ctx;
  let bodyStart;
  let bodyEnd;
  if (body.open !== undefined) {
    bodyStart = body.open;
    bodyEnd = closeOf(m, body.open);
    if (bodyEnd < 0) bodyEnd = m.length - 1;
  } else if (body.arrow !== undefined) {
    bodyStart = body.arrow;
    bodyEnd = exprEnd(m, body.arrow, lang);
  } else {
    bodyStart = body.semi;
    bodyEnd = body.semi;
  }
  const params = single ? [single] : paramsOf(m, open, close, lang);
  return {
    name, scope, nameAt, async: !!async, params, bodyStart, bodyEnd,
    line: lineOf(nameAt), endLine: lineOf(bodyEnd), visibility: null, locals: null,
  };
}

// Is `i` (an identifier inside a class or object body) where a member starts? Returns { async, accessor, mods }.
function memberStart(m, i, lang) {
  const mods = [];
  let p = prevNonWs(m, i - 1);
  for (;;) {
    if (m[p] === '*' && lang === 'js') { p = prevNonWs(m, p - 1); continue; }
    if (!isId(m[p])) break;
    const { word, start } = wordEndingAt(m, p);
    const mod = lang === 'js' ? JS_MODIFIERS.has(word) : DART_MODIFIERS.has(word);
    if (!mod && word !== 'get' && word !== 'set') break;
    mods.push(word);
    p = prevNonWs(m, start - 1);
  }
  const accessor = mods.includes('get') || mods.includes('set');
  const at = { async: mods.includes('async'), accessor, mods };
  if (p < 0 || '{};'.includes(m[p])) return at;
  if (lang === 'js') {
    const newline = /\n/.test(m.slice(p + 1, i));
    if (m[p] === ')' || (newline && (isId(m[p]) || m[p] === ']'))) return at;
    return null;
  }
  // Dart: a return type, an annotation's `)` or the end of the previous member
  if (m[p] === ')' || m[p] === ']' || m[p] === '?') return at;
  if (m[p] === '>') return m[p - 1] === '=' ? null : at;
  if (isId(m[p])) {
    const { word, start } = wordEndingAt(m, p);
    if (DART_NOT_TYPE.has(word) || m[prevNonWs(m, start - 1)] === '.') return null;
    return at;
  }
  return null;
}

function jsDeclarations(ctx) {
  const { m, d } = ctx;
  const fns = [];
  const exports = [];
  const scopes = [];
  const exportNames = new Map();
  const markExported = (local, isDefault) => exportNames.set(local, (exportNames.get(local) ?? false) || isDefault);
  const addExport = (name, at, isDefault) => exports.push({ name, at, default: isDefault });

  const membersOf = (scope) => {
    const depth = d[scope.open] + 1;
    const inner = m.slice(0, scope.close);
    if (scope.kind === 'class') {
      const METHOD_RE = /(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(?:<[^(){};=]*>\s*)?\(/g;
      METHOD_RE.lastIndex = scope.open + 1;
      for (let hit; (hit = METHOD_RE.exec(inner));) {
        if (d[hit.index] !== depth || isId(m[hit.index - 1]) || m[hit.index - 1] === '.') continue;
        const at = memberStart(m, hit.index, 'js');
        if (!at || at.accessor) continue;
        const open = hit.index + hit[0].length - 1;
        const close = closeOf(m, open);
        if (close < 0) continue;
        const body = scanBody(m, close + 1, false);
        if (body?.open === undefined) continue;
        fns.push(makeFn(ctx, { name: hit[1], scope, nameAt: hit.index, async: at.async, open, close, body }));
      }
      const PROP_RE = /(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(?::[^=;{}()]*)?=(?![=>])/g;
      PROP_RE.lastIndex = scope.open + 1;
      for (let hit; (hit = PROP_RE.exec(inner));) {
        if (d[hit.index] !== depth || isId(m[hit.index - 1]) || m[hit.index - 1] === '.') continue;
        const at = memberStart(m, hit.index, 'js');
        if (!at) continue;
        const value = fnValue(m, hit.index + hit[0].length);
        if (value) fns.push(makeFn(ctx, { name: hit[1], scope, nameAt: hit.index, ...value }));
      }
    } else {
      const SHORT_RE = /(?:(async)\s+)?(\*\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
      SHORT_RE.lastIndex = scope.open + 1;
      for (let hit; (hit = SHORT_RE.exec(inner));) {
        if (d[hit.index] !== depth || isId(m[hit.index - 1]) || m[hit.index - 1] === '.') continue;
        const p = prevNonWs(m, hit.index - 1);
        if (m[p] !== '{' && m[p] !== ',') continue;
        if (hit[3] === 'get' || hit[3] === 'set' || hit[3] === 'async' || hit[3] === 'function') continue;
        const open = hit.index + hit[0].length - 1;
        const close = closeOf(m, open);
        if (close < 0) continue;
        const body = scanBody(m, close + 1, false);
        if (body?.open === undefined) continue;
        fns.push(makeFn(ctx, { name: hit[3], scope, nameAt: hit.index + hit[0].lastIndexOf(hit[3]), async: !!hit[1], open, close, body }));
      }
      const PROP_RE = /([A-Za-z_$][\w$]*)\s*:/g;
      PROP_RE.lastIndex = scope.open + 1;
      for (let hit; (hit = PROP_RE.exec(inner));) {
        if (d[hit.index] !== depth || isId(m[hit.index - 1]) || m[hit.index - 1] === '.' || m[hit.index + hit[0].length] === ':') continue;
        const p = prevNonWs(m, hit.index - 1);
        if (m[p] !== '{' && m[p] !== ',') continue;
        const value = fnValue(m, hit.index + hit[0].length);
        if (value) fns.push(makeFn(ctx, { name: hit[1], scope, nameAt: hit.index, ...value }));
      }
    }
  };

  const FUNC_RE = /(?<![\w$.])(?:(export)\s+(?:(default)\s+)?)?(?:(async)\s+)?function\b\s*(\*)?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^(){};]*>\s*)?\(/g;
  for (let hit; (hit = FUNC_RE.exec(m));) {
    if (d[hit.index] !== 0) continue;
    const name = hit[5] ?? (hit[2] ? 'default' : null);
    if (!name) continue;
    const open = hit.index + hit[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const body = scanBody(m, close + 1, false);
    if (body?.open === undefined) continue;
    const nameAt = hit[5] ? m.lastIndexOf(hit[5], open) : m.indexOf('function', hit.index);
    fns.push(makeFn(ctx, { name, scope: null, nameAt, async: !!hit[3], open, close, body }));
    if (hit[1]) { markExported(name, !!hit[2]); addExport(name, nameAt, !!hit[2]); }
  }

  const VAR_RE = /(?<![\w$.])(?:(export)\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*!?/g;
  for (let hit; (hit = VAR_RE.exec(m));) {
    if (d[hit.index] !== 0) continue;
    const name = hit[2];
    const nameAt = m.indexOf(name, hit.index + (hit[1] ? 6 : 0) + 3);
    if (hit[1]) { markExported(name, false); addExport(name, nameAt, false); }
    let k = skipWs(m, hit.index + hit[0].length);
    if (m[k] === ':') {
      let depth = 0;
      for (k = k + 1; k < m.length; k++) {
        const c = m[k];
        if ('([{<'.includes(c)) depth++;
        else if (')]}'.includes(c) || (c === '>' && m[k - 1] !== '=')) depth--;
        else if (depth === 0 && (c === ';' || c === ',')) { k = -1; break; }
        else if (depth === 0 && c === '=' && m[k + 1] !== '>' && m[k + 1] !== '=') break;
      }
      if (k < 0 || k >= m.length) continue;
    }
    if (m[k] !== '=' || m[k + 1] === '=' || m[k + 1] === '>') continue;
    const v = skipWs(m, k + 1);
    if (m[v] === '{') {
      const close = closeOf(m, v);
      if (close > 0) scopes.push({ kind: 'object', name, open: v, close, parent: null, exported: false });
      continue;
    }
    const value = fnValue(m, v);
    if (value) fns.push(makeFn(ctx, { name, scope: null, nameAt, ...value }));
  }

  const CLASS_RE = /(?<![\w$.])(?:(export)\s+(?:(default)\s+)?)?(?:(?:abstract|declare)\s+)*class\b\s*([A-Za-z_$][\w$]*)?/g;
  for (let hit; (hit = CLASS_RE.exec(m));) {
    if (d[hit.index] !== 0) continue;
    const name = hit[3] && hit[3] !== 'extends' && hit[3] !== 'implements' ? hit[3] : hit[2] ? 'default' : null;
    if (!name) continue;
    let open = -1;
    for (let k = hit.index + hit[0].length; k < m.length; k++) {
      if (m[k] === '{' && d[k] === 0) { open = k; break; }
      if (m[k] === ';' && d[k] === 0) break;
    }
    if (open < 0) continue;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const parent = /\bextends\s+([A-Za-z_$][\w$]*)/.exec(m.slice(hit.index + hit[0].length, open))?.[1] ?? null;
    scopes.push({ kind: 'class', name, open, close, parent, exported: false });
    const nameAt = hit[3] === name ? m.indexOf(name, hit.index + hit[0].length - name.length) : hit.index;
    if (hit[1]) { markExported(name, !!hit[2]); addExport(name, nameAt, !!hit[2]); }
  }

  const ENUM_RE = /(?<![\w$.])export\s+(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g;
  for (let hit; (hit = ENUM_RE.exec(m));) {
    if (d[hit.index] === 0) addExport(hit[1], hit.index + hit[0].length - hit[1].length, false);
  }

  const CLAUSE_RE = /(?<![\w$.])export\s+(type\s+)?\{([^{}]*)\}(\s*from\b)?/g;
  for (let hit; (hit = CLAUSE_RE.exec(m));) {
    if (d[hit.index] !== 0 || hit[1]) continue;
    let at = hit.index + hit[0].indexOf('{') + 1;
    for (const raw of hit[2].split(',')) {
      const offset = at + (raw.length - raw.trimStart().length);
      at += raw.length + 1;
      const part = raw.trim();
      if (!part || /^type\s/.test(part)) continue;
      const pair = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (!pair) continue;
      const exported = pair[2] ?? pair[1];
      const isDefault = exported === 'default';
      addExport(exported, pair[2] ? offset + part.lastIndexOf(pair[2]) : offset, isDefault);
      if (!hit[3]) markExported(pair[1], isDefault);
    }
  }

  const STAR_RE = /(?<![\w$.])export\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g;
  for (let hit; (hit = STAR_RE.exec(m));) if (d[hit.index] === 0) addExport(hit[1], hit.index + hit[0].length - hit[1].length, false);

  const DEFAULT_RE = /(?<![\w$.])export\s+default\s+/g;
  for (let hit; (hit = DEFAULT_RE.exec(m));) {
    if (d[hit.index] !== 0) continue;
    const v = hit.index + hit[0].length;
    const w = wordAt(m, v);
    if (['function', 'class', 'abstract', 'interface', 'type', 'enum', 'declare'].includes(w)) continue;
    if (w === 'async' && wordAt(m, skipWs(m, v + 5)) === 'function') continue;
    const value = fnValue(m, v);
    if (value) {
      fns.push(makeFn(ctx, { name: 'default', scope: null, nameAt: hit.index, ...value }));
      markExported('default', true);
      addExport('default', hit.index, true);
      continue;
    }
    if (m[v] === '{') {
      const close = closeOf(m, v);
      if (close > 0) scopes.push({ kind: 'object', name: 'default', open: v, close, parent: null, exported: true });
      addExport('default', hit.index, true);
      continue;
    }
    const after = skipWs(m, v + w.length);
    if (w && !/\d/.test(w[0]) && (after >= m.length || m[after] === ';' || m[after] === '}' || m.slice(v + w.length, after).includes('\n'))) {
      markExported(w, true);
      addExport(w, v, true);
    } else addExport('default', hit.index, true);
  }

  for (const scope of scopes) {
    if (exportNames.has(scope.name)) scope.exported = true;
    membersOf(scope);
  }
  for (const fn of fns) fn.exported = fn.scope ? fn.scope.exported : exportNames.has(fn.name);
  return { fns, exports, scopes };
}

// Functions written inside another named function's body (fd17): a `function name() {}` statement, or a const/let/var
// assigned an arrow or a function expression. They are facts only (the skeleton of a file shows them under their
// parent); they never join `fns`, so the call graph is the one it always was. The parent is the innermost named
// function around them ("initChat", "Box.open", or "initChat>onClick" for a second level). One inside only an
// anonymous callback or an IIFE has no named parent and is left out.
function jsNested(ctx, fns) {
  const { m, d } = ctx;
  const found = [];
  const FUNC_RE = /(?<![\w$.])(?:(async)\s+)?function\b\s*(\*)?\s*([A-Za-z_$][\w$]*)\s*(?:<[^(){};]*>\s*)?\(/g;
  for (let hit; (hit = FUNC_RE.exec(m));) {
    if (d[hit.index] === 0) continue;
    // a statement, not a named function expression (`x = function name() {}`)
    const p = prevNonWs(m, hit.index - 1);
    if (p >= 0 && !'{};'.includes(m[p]) && !(/\n/.test(m.slice(p + 1, hit.index)) && !'=(,:?&|+-*/<>!['.includes(m[p]))) continue;
    const open = hit.index + hit[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const body = scanBody(m, close + 1, false);
    if (body?.open === undefined) continue;
    found.push({ name: hit[3], nameAt: m.lastIndexOf(hit[3], open), async: !!hit[1], open, close, body });
  }
  const VAR_RE = /(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
  for (let hit; (hit = VAR_RE.exec(m));) {
    if (d[hit.index] === 0) continue;
    const value = fnValue(m, hit.index + hit[0].length);
    if (value) found.push({ name: hit[1], nameAt: hit.index + hit[0].indexOf(hit[1], 3), ...value });
  }
  if (!found.length) return [];
  found.sort((a, b) => a.nameAt - b.nameAt);
  const made = found.map((f) => makeFn(ctx, { scope: null, ...f }));
  const label = (f) => (f.scope ? `${f.scope.name}.${f.name}` : f.name);
  const all = [...fns, ...made];
  // innermost first: the smallest body around the position
  const around = (at, self) => all
    .filter((f) => f !== self && f.bodyStart < at && at <= f.bodyEnd)
    .sort((a, b) => (a.bodyEnd - a.bodyStart) - (b.bodyEnd - b.bodyStart))[0] ?? null;
  const labels = new Map();
  const out = [];
  const taken = new Set();
  // outer ones first, so a parent has its label before its children ask for it
  for (const fn of made.sort((a, b) => a.bodyStart - b.bodyStart || b.bodyEnd - a.bodyEnd)) {
    const parent = around(fn.nameAt, fn);
    if (!parent) continue;
    const parentLabel = labels.get(parent) ?? label(parent);
    const base = `${parentLabel}>${fn.name}`;
    // the same name twice under one parent: the line tells them apart, and a counter when they share a line too
    let key = base;
    for (let n = 2; taken.has(key); n++) key = n === 2 ? `${base}@${fn.line}` : `${base}@${fn.line}.${n - 1}`;
    taken.add(key);
    labels.set(fn, key);
    out.push({ ...fn, parentLabel, key });
  }
  return out;
}

function dartDeclarations(ctx) {
  const { m, d } = ctx;
  const fns = [];
  const scopes = [];
  const CLASS_RE = /(?<![\w$.])(?:(?:abstract|base|final|sealed|interface|mixin)\s+)*(class|mixin|extension|enum)\b\s*([A-Za-z_$][\w$]*)?/g;
  for (let hit; (hit = CLASS_RE.exec(m));) {
    if (d[hit.index] !== 0) continue;
    const name = hit[2] && hit[2] !== 'on' ? hit[2] : null;
    let open = -1;
    for (let k = hit.index + hit[0].length; k < m.length; k++) {
      if (m[k] === '{' && d[k] === 0) { open = k; break; }
      if (m[k] === ';' && d[k] === 0) break;
    }
    if (open < 0) continue;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const parent = /\bextends\s+([A-Za-z_$][\w$]*)/.exec(m.slice(hit.index, open))?.[1] ?? null;
    scopes.push({ kind: 'class', name, open, close, parent, exported: !name?.startsWith('_') });
  }
  const scopeAt = (i) => scopes.find((s) => i > s.open && i < s.close && d[i] === d[s.open] + 1) ?? null;

  const FN_RE = /([A-Za-z_$][\w$]*)\s*(?:<[^(){};=]*>\s*)?\(/g;
  for (let hit; (hit = FN_RE.exec(m));) {
    const i = hit.index;
    if (isId(m[i - 1])) continue;
    const scope = d[i] === 0 ? null : scopeAt(i);
    if (d[i] !== 0 && !scope) continue;
    const word = hit[1];
    if (KEYWORDS.dart.has(word)) continue;
    const open = i + hit[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) continue;
    let name = word;
    let nameAt = i;
    let ctor = false;
    const p = prevNonWs(m, i - 1);
    if (m[p] === '.') {
      // a named constructor: Class.name(...)
      const owner = wordEndingAt(m, prevNonWs(m, p - 1));
      if (!scope || owner.word !== scope.name) continue;
      const before = prevNonWs(m, owner.start - 1);
      const lead = isId(m[before]) ? wordEndingAt(m, before) : null;
      if (lead && !['const', 'factory', 'external'].includes(lead.word) && !memberStart(m, owner.start, 'dart')) continue;
      if (!lead && !memberStart(m, owner.start, 'dart')) continue;
      ctor = true;
    } else {
      if (scope && word === scope.name) continue; // unnamed constructor
      if (m[p] === '@') continue;
      const at = memberStart(m, i, 'dart');
      if (!at || at.accessor) continue;
      if (isId(m[p]) && wordEndingAt(m, p).word === 'factory') continue;
    }
    let k = skipWs(m, close + 1);
    let async = false;
    const mark = /^(async\*?|sync\*)/.exec(m.slice(k, k + 6));
    if (mark) { async = mark[1].startsWith('async'); k = skipWs(m, k + mark[0].length); }
    let body = null;
    if (m[k] === '{') body = { open: k };
    else if (m.startsWith('=>', k)) body = { arrow: k + 2 };
    else if (ctor && (m[k] === ':' || m[k] === ';')) body = m[k] === ';' ? { semi: k } : scanBody(m, k + 1, true);
    if (!body) continue;
    if (body.arrow !== undefined && m[skipWs(m, body.arrow)] === '{' && ctor) body = { open: skipWs(m, body.arrow) };
    nameAt = i;
    name = word;
    const fn = makeFn(ctx, { name, scope, nameAt, async, open, close, body });
    fn.exported = !name.startsWith('_') && !(scope?.name ?? '').startsWith('_');
    fns.push(fn);
  }
  return { fns, exports: [], scopes };
}

// Is the PHP code at `i` inside a block other than a `namespace X { }` (an `if (!function_exists(...))` polyfill)?
// Such a function may never be defined: the built-in one with that name runs instead.
function underCondition(m, d, i) {
  for (let k = i; d[k] > 0;) {
    let j = k - 1;
    while (j >= 0 && !(d[j] === d[k] - 1 && '([{'.includes(m[j]))) j--;
    if (j < 0) return false;
    if (m[j] !== '{' || !/(?<![\w$\\])namespace(?:\s+\\?[A-Za-z_][\w\\]*)?\s*$/.test(m.slice(Math.max(0, j - 200), j))) return true;
    k = j;
  }
  return false;
}

function phpDeclarations(ctx) {
  const { m, d } = ctx;
  const fns = [];
  const scopes = [];
  const CLASS_RE = /(?<![\w$\\:>])(?:(?:abstract|final|readonly)\s+)*(?:class|trait|interface|enum)\s+([A-Za-z_]\w*)|(?<![\w$])new\s+class\b/g;
  for (let hit; (hit = CLASS_RE.exec(m));) {
    let open = -1;
    for (let k = hit.index + hit[0].length; k < m.length; k++) {
      if (m[k] === '{' && d[k] === d[hit.index]) { open = k; break; }
      if (m[k] === ';' && d[k] === d[hit.index]) break;
    }
    if (open < 0) continue;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const parent = /\bextends\s+\\?([A-Za-z_][\w\\]*)/.exec(m.slice(hit.index, open))?.[1]?.split('\\').pop() ?? null;
    scopes.push({ kind: 'class', name: hit[1] ?? null, open, close, parent, exported: true });
  }
  const FN_RE = /(?<![\w$])function\s*&?\s*([A-Za-z_]\w*)\s*\(/g;
  for (let hit; (hit = FN_RE.exec(m));) {
    const i = hit.index;
    if (fns.some((f) => i > f.bodyStart && i < f.bodyEnd)) continue;
    const scope = scopes.find((s) => i > s.open && i < s.close) ?? null;
    if (scope && d[i] !== d[scope.open] + 1) continue;
    const open = i + hit[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const body = scanBody(m, close + 1, false);
    if (body?.open === undefined) continue;
    const mods = [];
    for (let p = prevNonWs(m, i - 1); isId(m[p]);) {
      const { word, start } = wordEndingAt(m, p);
      if (!['public', 'protected', 'private', 'static', 'abstract', 'final'].includes(word)) break;
      mods.push(word);
      p = prevNonWs(m, start - 1);
    }
    const fn = makeFn(ctx, { name: hit[1], scope, nameAt: i + hit[0].lastIndexOf(hit[1]), async: false, open, close, body });
    fn.exported = !mods.includes('private') && !mods.includes('protected');
    if (!scope && underCondition(m, d, i)) fn.guarded = true;
    fns.push(fn);
  }
  return { fns, exports: [], scopes };
}

// ---------- calls ----------

function esc(s) { return s.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&'); }

// Words that put a parenthesis before a block without making it a parameter list.
const NOT_PARAMS = new Set(['if', 'for', 'while', 'switch', 'with', 'return', 'await', 'typeof', 'in', 'of', 'else']);

// Where each name is bound in the file, worked out once: `params` = name -> positions where it is a parameter of some
// function (an arrow, a function, a method, a catch, a Dart closure); for JS also `decls` = name -> positions of its
// `function/const/let/var/class` declarations (destructuring too) and `inits` = name -> the first word of the value of
// each `const name = ...` (`fastify` in `const app = fastify()`, `Map` in `new Map()`).
const ID_RE = /(?<![\w$.])[A-Za-z_$][\w$]*/g;
function bindings(ctx) {
  if (ctx.bindings) return ctx.bindings;
  const { m, lang } = ctx;
  const params = new Map();
  const decls = new Map();
  const inits = new Map();
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (let open = m.indexOf('('); open >= 0; open = m.indexOf('(', open + 1)) {
    const close = closeOf(m, open);
    if (close < 0) break;
    const after = skipWs(m, close + 1);
    const opens = m[after] === '{' || m.startsWith('=>', after) || (lang === 'js' && m[after] === ':')
      || (lang === 'dart' && /^(async|sync)\b/.test(m.slice(after, after + 6)));
    if (!opens) continue;
    const p = prevNonWs(m, open - 1);
    if (isId(m[p]) && NOT_PARAMS.has(wordEndingAt(m, p).word)) continue;
    for (const hit of m.slice(open + 1, close).matchAll(ID_RE)) push(params, hit[0], open);
  }
  if (lang === 'js') {
    for (const hit of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) push(params, hit[1], hit.index);
    for (const hit of m.matchAll(/\b(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) push(decls, hit[1], hit.index + hit[0].length - hit[1].length);
    for (const hit of m.matchAll(/\b(?:const|let|var)\s*([{[][^=;]*)/g)) {
      for (const id of hit[1].matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) push(decls, id[0], hit.index + hit[0].length - hit[1].length + id.index);
    }
    for (const hit of m.matchAll(/(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$]*)/g)) push(inits, hit[1], hit[2]);
  }
  ctx.bindings = { params, decls, inits };
  return ctx.bindings;
}
const within = (list, from, to) => (list ?? []).some((p) => p >= from && p < to);

// Is `name` a parameter of some function written between `from` and `to`? Over-hiding only costs a fact; missing one
// invents a call to the function of the file with the same name.
function paramSomewhere(ctx, name, from = 0, to = ctx.m.length) {
  return within(bindings(ctx).params.get(name), from, to);
}

// Does the Dart text declare `name` as a variable or a local function?
function dartDeclares(body, name) {
  const re = new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`, 'g');
  for (let hit; (hit = re.exec(body));) {
    const p = prevNonWs(body, hit.index - 1);
    if (!(isId(body[p]) || body[p] === '?' || (body[p] === '>' && body[p - 1] !== '='))) continue;
    if (isId(body[p]) && DART_NOT_TYPE.has(wordEndingAt(body, p).word) && !['var', 'final', 'late'].includes(wordEndingAt(body, p).word)) continue;
    const n = skipWs(body, hit.index + name.length);
    if (body[n] === ';' || (body[n] === '=' && body[n + 1] !== '=' && body[n + 1] !== '>') || wordAt(body, n) === 'in') return true;
    if (body[n] === '(') {
      const close = closeOf(body, n);
      const after = close < 0 ? -1 : skipWs(body, close + 1);
      if (after >= 0 && (body[after] === '{' || body.startsWith('=>', after) || wordAt(body, after) === 'async')) return true;
    }
  }
  return false;
}

// Does the caller itself declare `name` (a parameter, a parameter of a closure inside it, a local variable or a local
// function)?
function declaresLocally(ctx, fn, name) {
  if (!fn.locals) fn.locals = new Map();
  if (fn.locals.has(name)) return fn.locals.get(name);
  let hidden = namesIn(fn.params).has(name) || namesIn(fn.params).has(`$${name}`);
  if (!hidden && ctx.lang === 'js') hidden = within(bindings(ctx).decls.get(name), fn.bodyStart, fn.bodyEnd + 1);
  if (!hidden && ctx.lang === 'dart') hidden = dartDeclares(ctx.m.slice(fn.bodyStart, fn.bodyEnd + 1), name);
  if (!hidden && ctx.lang !== 'php') hidden = paramSomewhere(ctx, name, fn.bodyStart, fn.bodyEnd + 1);
  fn.locals.set(name, hidden);
  return hidden;
}

// Does a Dart class declare `name` as one of its own members (a field, a getter or a setter)? Inside a method a plain
// `name()` then calls that member, not the top-level function with the same name.
function dartMemberDeclares(ctx, scope, name) {
  if (!scope.members) scope.members = new Map();
  if (scope.members.has(name)) return scope.members.get(name);
  const { m, d } = ctx;
  const level = d[scope.open] + 1;
  const re = new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`, 'g');
  re.lastIndex = scope.open + 1;
  let found = false;
  for (let hit; !found && (hit = re.exec(m)) && hit.index < scope.close;) {
    if (d[hit.index] !== level) continue;
    const p = prevNonWs(m, hit.index - 1);
    const word = isId(m[p]) ? wordEndingAt(m, p).word : null;
    if (word === 'get' || word === 'set') { found = true; continue; }
    const typed = (word && (!DART_NOT_TYPE.has(word) || ['var', 'final', 'late'].includes(word)))
      || m[p] === '?' || m[p] === ')' || m[p] === ',' || (m[p] === '>' && m[p - 1] !== '=');
    if (!typed) continue;
    const n = skipWs(m, hit.index + name.length);
    found = m[n] === ';' || m[n] === ',' || (m[n] === '=' && m[n + 1] !== '=' && m[n + 1] !== '>');
  }
  scope.members.set(name, found);
  return found;
}

// Where the value behind a plain receiver (`console.log`, `app.listen`) comes from, for JS and Dart:
// - null: the file makes it (a class, a function, a parameter, a variable built by project code): guess by name;
// - { drop: true }: a global or something built only from globals (`console`, `JSON`, `new Map()`): never a fact;
// - { via: [names] }: an import, or a variable built from one (`const app = fastify()`); linkCalls keeps the guess
//   only when one of these names is imported from a project file (Dart: '*' = any project file imported whole).
function receiverSource(ctx, name) {
  if (!ctx.receivers) ctx.receivers = new Map();
  if (ctx.receivers.has(name)) return ctx.receivers.get(name);
  const { m, lang, bound, scopes, fns } = ctx;
  const { params, decls, inits } = bindings(ctx);
  const ownDecl = (n) => scopes.some((s) => s.name === n) || fns.some((f) => !f.scope && f.name === n) || params.has(n);
  const written = (n) => (lang === 'js' ? decls.has(n) : dartDeclares(m, n));
  const declared = (n) => ownDecl(n) || written(n);
  const free = (n) => !bound.has(n) && !declared(n) && n !== 'this' && n !== 'super';
  let out = null;
  if (bound.has(name) && !declared(name)) out = { via: [name] };
  else if (free(name)) out = lang === 'js' ? { drop: true } : { via: ['*'] };
  else if (lang === 'js' && !ownDecl(name)) {
    const all = decls.get(name)?.length ?? 0;
    const heads = inits.get(name) ?? [];
    if (heads.length && heads.length === all) {
      // `const x = require('...')`: importNames already binds x itself to that module.
      const imported = (h) => (h === 'require' ? bound.has(name) : bound.has(h) && !declared(h));
      const via = heads.filter(imported).map((h) => (h === 'require' ? name : h));
      if (heads.every((h) => imported(h) || free(h))) out = via.length ? { via } : { drop: true };
    }
  }
  ctx.receivers.set(name, out);
  return out;
}

function callSites(ctx, fns, scopes, declared) {
  const { m, lang, lineOf } = ctx;
  const hints = [];
  const keywords = KEYWORDS[lang];
  const CALL_RE = lang === 'php' ? /(?<![\w$])([A-Za-z_]\w*)\s*\(/g : /(?<![\w$])(#?[A-Za-z_$][\w$]*)\s*\(/g;
  const methodOf = (scope, name) => (scope ? fns.find((f) => f.scope === scope && f.name === name && !CONSTRUCTORS.has(name)) : null);
  const scopeNamed = (name) => scopes.find((s) => s.name === name) ?? null;
  const topNamed = (name) => fns.filter((f) => !f.scope && f.name === name);
  for (let hit; (hit = CALL_RE.exec(m));) {
    const i = hit.index;
    const callee = hit[1].replace(/^#/, '');
    if (keywords.has(hit[1]) || declared.has(i)) continue;
    const open = i + hit[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) continue;
    const after = skipWs(m, close + 1);
    if (lang === 'dart' && /^(async|sync)/.test(m.slice(after, after + 5))) continue;
    if (m[after] === '{' || (lang === 'dart' && m.startsWith('=>', after))) continue;
    let caller = null;
    for (const f of fns) {
      if (i > f.bodyStart && i <= f.bodyEnd && (!caller || f.bodyEnd - f.bodyStart < caller.bodyEnd - caller.bodyStart)) caller = f;
    }
    if (!caller) continue;
    const p = prevNonWs(m, i - 1);
    if (m[p] === '@') continue;
    if (isId(m[p])) {
      const w = wordEndingAt(m, p).word;
      if (w === 'new' || w === 'function' || w === 'fn' || w === 'class' || w === 'const' && lang === 'dart') continue;
    }
    let recv = null;
    if (lang === 'php') {
      if (m[p] === '>' && m[p - 1] === '-') recv = phpReceiver(m, p - 2, '->');
      else if (m[p] === ':' && m[p - 1] === ':') recv = phpReceiver(m, p - 2, '::');
    } else if (m[p] === '.' && !(m[p - 1] === '.' && m[p - 2] === '.')) {
      if (m[p - 1] === '.') recv = '?';
      else {
        let q = prevNonWs(m, p - 1);
        if (m[q] === '?' || m[q] === '!') q = prevNonWs(m, q - 1);
        if (isId(m[q])) {
          const { word, start } = wordEndingAt(m, q);
          const before = prevNonWs(m, start - 1);
          recv = m[before] === '.' && m[before - 1] !== '.' ? '?' : word === 'this' ? 'this' : word === 'super' ? 'super' : word;
        } else recv = '?';
      }
    }
    const site = { kind: 'call-site', from: null, caller, callee, line: lineOf(i), lang };
    const own = caller.scope;
    if (lang !== 'php' && recv !== null && recv !== '?' && recv !== 'this' && recv !== 'super') {
      const source = receiverSource(ctx, recv);
      if (source?.drop) continue;
      if (source?.via) site.recvImported = source.via;
    }
    if (recv === null) {
      if (lang !== 'php' && declaresLocally(ctx, caller, callee)) continue;
      if (lang === 'dart' && own) {
        const method = methodOf(own, callee);
        if (method) { hints.push({ ...site, target: method }); continue; }
        if (dartMemberDeclares(ctx, own, callee)) continue;
      }
      const local = topNamed(callee);
      if (local.length === 1) hints.push({ ...site, target: local[0] });
      else if (local.length > 1) hints.push({ ...site, targets: local });
      else hints.push({ ...site, recv: null, parent: lang === 'dart' ? own?.parent ?? null : null });
      continue;
    }
    // In JS a `function` written inside the caller has its own `this`: not the instance, so the receiver is unknown.
    if (lang === 'js' && recv === 'this' && insideNestedFunction(m, caller, i)) recv = '?';
    if (recv === 'this' || recv === 'super') {
      const method = recv === 'this' ? methodOf(own, callee) : null;
      if (method) { hints.push({ ...site, target: method }); continue; }
      if (own?.parent) hints.push({ ...site, recv: own.parent, strict: true });
      continue;
    }
    if (recv !== '?') {
      if (lang !== 'php' && declaresLocally(ctx, caller, recv)) recv = '?';
      else {
        const scope = scopeNamed(recv);
        if (scope) {
          const method = methodOf(scope, callee);
          if (method) { hints.push({ ...site, target: method }); continue; }
          hints.push({ ...site, recv, strict: true });
          continue;
        }
      }
    }
    const strict = recv !== '?' && /^[A-Z]/.test(recv);
    hints.push({ ...site, recv, strict });
  }
  return hints;
}

function insideNestedFunction(m, caller, i) {
  const re = /(?<![\w$.])function\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g;
  re.lastIndex = caller.bodyStart + 1;
  for (let hit; (hit = re.exec(m)) && hit.index < i;) {
    const close = closeOf(m, hit.index + hit[0].length - 1);
    if (close < 0) continue;
    const open = skipWs(m, close + 1);
    if (m[open] !== '{') continue;
    const end = closeOf(m, open);
    if (i > open && (end < 0 || i < end)) return true;
  }
  return false;
}

// The receiver of a PHP `->` or `::` call whose operator ends at `end`.
function phpReceiver(m, end, op) {
  let q = end;
  if (op === '->' && m[q] === '?') q--;
  q = prevNonWs(m, q);
  if (!isId(m[q])) return '?';
  const { word, start } = wordEndingAt(m, q);
  if (word[0] === '$') {
    if (word !== '$this') return '?';
    const chain = prevNonWs(m, start - 1);
    return (m[chain] === '>' && m[chain - 1] === '-') || (m[chain] === ':' && m[chain - 1] === ':') ? '?' : 'this';
  }
  if (op === '->') return '?';
  if (word === 'self' || word === 'static') return 'this';
  if (word === 'parent') return 'super';
  return word;
}

// ---------- the reader ----------

function idOf(path, fn) {
  const owner = fn.scope?.name;
  return `fn:${path}#${owner ? `${owner}.` : ''}${fn.name}`;
}

export function extract({ path, type, text, masked }) {
  const lang = LANG[type];
  if (!lang) return { facts: [], hints: [] };
  const m = masked ?? lex(text, type).masked;
  const ctx = { path, lang, m, d: depths(m), lineOf: lineIndex(text) };
  const { fns, exports, scopes } = lang === 'js' ? jsDeclarations(ctx) : lang === 'dart' ? dartDeclarations(ctx) : phpDeclarations(ctx);
  fns.sort((a, b) => a.nameAt - b.nameAt);
  Object.assign(ctx, { fns, scopes, bound: new Set(lang === 'php' ? [] : importNames({ path, type, text, masked: m }).map((e) => e.name)) });
  const declared = new Set(fns.map((f) => f.nameAt));
  if (lang === 'js') for (const hit of m.matchAll(/(?<![\w$.])function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(hit.index + hit[0].indexOf(hit[1], 8));
  const facts = [];
  for (const fn of fns) {
    const id = idOf(path, fn);
    facts.push({
      id, kind: 'function', name: id.slice(3), file: path, line: fn.line, origin: 'EXTRACTED', extractor: VERSION,
      attrs: { exported: !!fn.exported, async: fn.async, params: fn.params, endLine: fn.endLine }, refs: [],
    });
  }
  if (lang === 'js') {
    for (const fn of jsNested(ctx, fns)) {
      const id = `fn:${path}#${fn.key}`;
      facts.push({
        id, kind: 'function', name: id.slice(3), file: path, line: fn.line, origin: 'EXTRACTED', extractor: VERSION,
        attrs: { exported: false, async: fn.async, params: fn.params, endLine: fn.endLine, parent: fn.parentLabel }, refs: [],
      });
    }
  }
  const seen = new Set();
  for (const e of exports.sort((a, b) => a.at - b.at)) {
    const id = `export:${path}#${e.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    facts.push({ id, kind: 'export', name: id.slice(7), file: path, line: ctx.lineOf(e.at), origin: 'EXTRACTED', extractor: VERSION, attrs: { default: e.default }, refs: [] });
  }
  const hints = callSites(ctx, fns, scopes, declared).map(({ caller, target, targets, ...rest }) => ({
    ...rest,
    from: idOf(path, caller),
    file: path,
    ...(target ? { target: idOf(path, target) } : {}),
    ...(targets ? { targets: targets.map((t) => idOf(path, t)) } : {}),
  }));
  // linkCalls needs the namespace of every PHP file, also of files with no call, to pick a function of another file.
  const ns = lang === 'php' ? /(?<![\w$\\])namespace\s+\\?([A-Za-z_][\w\\]*)\s*[;{]/.exec(m)?.[1] : null;
  if (ns) hints.push({ kind: 'php-namespace', file: path, ns });
  const guarded = fns.filter((f) => f.guarded).map((f) => idOf(path, f));
  if (guarded.length) hints.push({ kind: 'php-guarded', file: path, fns: guarded });
  return { facts, hints };
}

// ---------- imports ----------

export function importNames({ path, type, text, masked }) {
  const lang = LANG[type];
  if (!lang) return [];
  const m = masked ?? lex(text, type).masked;
  const d = depths(m);
  const lineOf = lineIndex(text);
  const out = [];
  const add = (name, imported, spec, at) => out.push({ name, imported, spec, line: lineOf(at) });
  if (lang === 'js') {
    const IMPORT_RE = /(?<![\w$.])import\s+(type\s+)?([^'"`;()]*?)\s*\bfrom\s*(['"])/g;
    for (let hit; (hit = IMPORT_RE.exec(m));) {
      if (hit[1]) continue;
      const spec = literalAt(text, hit.index + hit[0].length - 1)?.value;
      if (!spec) continue;
      let clause = hit[2].trim();
      const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      const braces = /\{([^}]*)\}/.exec(clause);
      clause = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '');
      const def = /^([A-Za-z_$][\w$]*)/.exec(clause.trim());
      if (def) add(def[1], 'default', spec, hit.index);
      if (braces) {
        for (const raw of braces[1].split(',')) {
          const part = raw.trim();
          if (!part || /^type\s/.test(part)) continue;
          const pair = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
          if (pair) add(pair[2] ?? pair[1], pair[1], spec, hit.index);
        }
      }
      if (ns) add(ns[1], '*', spec, hit.index);
    }
    const REQUIRE_RE = /(?<![\w$.])(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])/g;
    for (let hit; (hit = REQUIRE_RE.exec(m));) {
      const spec = literalAt(text, hit.index + hit[0].length - 1)?.value;
      if (!spec) continue;
      if (hit[1][0] !== '{') { add(hit[1], '*', spec, hit.index); continue; }
      for (const raw of hit[1].slice(1, -1).split(',')) {
        const pair = /^\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(raw);
        if (pair) add(pair[2] ?? pair[1], pair[1], spec, hit.index);
      }
    }
  } else if (lang === 'dart') {
    const DART_RE = /(?<![\w$.])(import|part)\s+(['"])/g;
    for (let hit; (hit = DART_RE.exec(m));) {
      if (d[hit.index] !== 0 || /^\s*of\b/.test(m.slice(hit.index + 4))) continue;
      const lit = literalAt(text, hit.index + hit[0].length - 1, 'dart');
      if (!lit) continue;
      const end = m.indexOf(';', lit.end);
      const rest = m.slice(lit.end, end < 0 ? m.length : end);
      const prefix = /\bas\s+([A-Za-z_$][\w$]*)/.exec(rest);
      const show = /\bshow\s+([\w$\s,]+)/.exec(rest);
      if (prefix) add(prefix[1], '*', lit.value, hit.index);
      else if (show) for (const n of show[1].split(',').map((s) => s.trim()).filter(Boolean)) add(n, n, lit.value, hit.index);
      else add('*', '*', lit.value, hit.index);
    }
  } else {
    const USE_RE = /(?<![\w$\\])use\s+(function\s+|const\s+)?\\?([A-Za-z_][\w\\]*)\s*(?:\{([^}]*)\}|(?:\s+as\s+([A-Za-z_]\w*))?)\s*;/g;
    for (let hit; (hit = USE_RE.exec(m));) {
      if (d[hit.index] !== 0) continue;
      if (hit[3] !== undefined) {
        const base = hit[2].replace(/\\$/, '');
        for (const raw of hit[3].split(',')) {
          const pair = /^\s*\\?([A-Za-z_][\w\\]*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(raw);
          if (!pair) continue;
          const short = pair[1].split('\\').pop();
          add(pair[2] ?? short, short, `${base}\\${pair[1]}`, hit.index);
        }
        continue;
      }
      const short = hit[2].split('\\').pop();
      add(hit[4] ?? short, short, hit[2], hit.index);
    }
  }
  return out;
}

// ---------- linking ----------

const langOfFile = (file) => EXT_LANG[file.split('.').pop()] ?? null;

export function linkCalls(facts, hints, { imports = {} } = {}) {
  // a function nested in another (fd17) is not a call target: its id would read like a method
  const fns = facts.filter((f) => f.kind === 'function' && !f.attrs?.parent);
  const top = new Map();
  const member = new Map();
  const byMethod = new Map();
  const byClassMethod = new Map();
  const defaults = new Map();
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (const f of fns) {
    const rest = f.id.slice(4 + f.file.length);
    const dot = rest.indexOf('.');
    const lang = langOfFile(f.file);
    if (dot < 0) push(top, `${f.file}\0${rest}`, f);
    else {
      const cls = rest.slice(0, dot);
      const short = rest.slice(dot + 1);
      member.set(`${f.file}\0${cls}\0${short}`, f);
      if (!CONSTRUCTORS.has(short)) push(byMethod, `${lang}\0${short}`, f);
      push(byClassMethod, `${lang}\0${cls}\0${short}`, f);
    }
  }
  for (const f of facts) if (f.kind === 'export' && f.attrs?.default) defaults.set(f.file, f.id.slice(8 + f.file.length));
  const importsOf = (file) => (imports instanceof Map ? imports.get(file) : imports[file]) ?? [];
  const nameIn = (e) => (e.imported === 'default' ? defaults.get(e.file) : e.imported);

  // A guess by name only (no import says where the name lives) never sends product code into a test file: product
  // code does not call test stubs, even when one has the same method name.
  const isTest = (file) => kindOfFile(file) === 'test';
  const guess = (h, list) => (isTest(h.file) ? list : list.filter((f) => !isTest(f.file)));
  const pick = (list) => {
    const uniq = [...new Map(list.map((f) => [f.id, f])).values()];
    if (uniq.length === 1) return { to: uniq[0] };
    return uniq.length ? { cands: uniq } : null;
  };
  // PHP calls a plain name in its own namespace or, failing that, the global one: a function of a file in another
  // namespace is never reached without a `use function`.
  const nsOf = new Map(hints.filter((h) => h.kind === 'php-namespace').map((h) => [h.file, h.ns]));
  const sameNs = (h, file) => !nsOf.get(file) || nsOf.get(file) === nsOf.get(h.file);
  // A function defined only under a condition (a polyfill) may not be the one that runs: never a sure target.
  const guarded = new Set(hints.filter((h) => h.kind === 'php-guarded').flatMap((h) => h.fns));
  const resolve = (h) => {
    if (h.target) return { to: fns.find((f) => f.id === h.target) };
    if (h.targets) return pick(fns.filter((f) => h.targets.includes(f.id)));
    const imps = importsOf(h.file);
    // A receiver that is an import (or built from one) that does not lead to a project file is a library.
    if (h.recvImported && !imps.some((e) => h.recvImported.includes(e.name))) return null;
    if (h.recv === null || h.recv === undefined) {
      let found = [];
      for (const e of imps) if (e.name === h.callee && e.name !== '*') found.push(...(top.get(`${e.file}\0${nameIn(e)}`) ?? []));
      if (!found.length) for (const e of imps) if (e.name === '*') found.push(...(top.get(`${e.file}\0${h.callee}`) ?? []));
      if (!found.length && h.lang === 'php') found = guess(h, [...top.entries()].filter(([k]) => k.endsWith(`\0${h.callee}`) && langOfFile(k.split('\0')[0]) === 'php').flatMap(([, v]) => v)).filter((f) => sameNs(h, f.file));
      const done = pick(found);
      if (done || !h.parent) return done;
      return resolveMember({ ...h, recv: h.parent, strict: true }, imps);
    }
    return resolveMember(h, imps);
  };
  const resolveMember = (h, imps) => {
    if (h.recv !== '?') {
      for (const e of imps) {
        if (e.name !== h.recv) continue;
        if (e.imported === '*') return pick(top.get(`${e.file}\0${h.callee}`) ?? []);
        const hit = member.get(`${e.file}\0${nameIn(e)}\0${h.callee}`);
        if (hit) return { to: hit };
      }
      const wild = imps.filter((e) => e.name === '*').map((e) => member.get(`${e.file}\0${h.recv}\0${h.callee}`)).filter(Boolean);
      if (wild.length) return pick(wild);
      if (h.strict) {
        const same = guess(h, byClassMethod.get(`${h.lang}\0${h.recv}\0${h.callee}`) ?? []);
        return same.length ? { cands: same } : null;
      }
    }
    const cands = guess(h, byMethod.get(`${h.lang}\0${h.callee}`) ?? []);
    return cands.length ? { cands } : null;
  };

  const out = new Map();
  for (const h of hints) {
    if (h.kind !== 'call-site') continue;
    let r = resolve(h);
    if (!r) continue;
    if (r.to && guarded.has(r.to.id)) r = { cands: [r.to] };
    if (r.to) {
      const id = `call:${h.from}->${r.to.id}`;
      const prev = out.get(id);
      if (prev) { if (prev.line !== h.line && !prev.refs.some((x) => x.line === h.line)) prev.refs.push({ file: h.file, line: h.line }); continue; }
      out.set(id, { id, kind: 'call', name: id.slice(5), file: h.file, line: h.line, origin: 'EXTRACTED', extractor: VERSION, attrs: { callee: h.callee }, refs: [] });
    } else {
      const id = `call:${h.from}->?${h.callee}`;
      if (out.has(id)) continue;
      const cands = [...r.cands].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      out.set(id, {
        id, kind: 'call', name: id.slice(5), file: h.file, line: h.line, origin: 'AMBIGUOUS', extractor: VERSION,
        attrs: { callee: h.callee, candidates: cands.map((c) => c.id) }, refs: cands.map((c) => ({ file: c.file, line: c.line })),
      });
    }
  }
  return [...out.values()];
}

export function extractFunctions(entries) {
  const facts = [];
  const hints = [];
  const imports = {};
  for (const e of entries) {
    const r = extract(e);
    facts.push(...r.facts);
    hints.push(...r.hints);
    imports[e.path] = e.imports ?? [];
  }
  return [...facts, ...linkCalls(facts, hints, { imports })];
}
