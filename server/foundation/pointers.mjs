// Code pointers in documents (fd13): `path/to/file.ext#Symbol` between backticks. A pointer names a file and a symbol,
// never a line: the line is worked out from the code every time it is asked for, so a document cannot go stale by
// having the code move. Pure: the caller passes the facts and a function that reads code (no disk access here).

import { createHash } from 'node:crypto';
import { lex, lineAt } from './lex.mjs';
import { codeSpansOf } from './mdlinks.mjs';

const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'mts', 'cts', 'dart', 'php', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'vue', 'svelte']);
const LEX_AS = { py: 'sh', rb: 'sh', dart: 'dart', php: 'php' };
const IDENT = '[\\p{L}_$][\\p{L}\\p{N}_$]*';
const SYMBOL = new RegExp(`^${IDENT}(?:\\.${IDENT})?$`, 'u');
const PATH_CH = '[\\p{L}\\p{N}_.@+~()\\[\\]-]';
const POINTER = new RegExp(`^((?:${PATH_CH}+/)*${PATH_CH}+\\.([A-Za-z0-9]+))#(${IDENT}(?:\\.${IDENT})?)$`, 'u');

function cleanPath(raw) {
  const p = String(raw ?? '').replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  if (p === '' || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  return p;
}

// Pointers written in inline code, outside fenced blocks: [{ line, ptr, path, symbol }].
// `.md#anchor`, URLs, pages (`.html`) and data files are not pointers: only code files are.
export function pointersIn(text) {
  const out = [];
  for (const span of codeSpansOf(text)) {
    const m = POINTER.exec(span.text);
    if (!m || !CODE_EXT.has(m[2].toLowerCase())) continue;
    const path = cleanPath(m[1]);
    if (path) out.push({ line: span.line, ptr: `${path}#${m[3]}`, path, symbol: m[3] });
  }
  return out;
}

const escapeRe = (s) => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');
const DECL_KEYWORDS = 'function(?:\\s*\\*\\s*|\\s+)|class\\s+|const\\s+|let\\s+|var\\s+|def\\s+|fn\\s+|type\\s+|interface\\s+|enum\\s+';
const declRegex = (name) => new RegExp(`(?<![\\p{L}\\p{N}_$.])(?:${DECL_KEYWORDS})${escapeRe(name)}(?![\\p{L}\\p{N}_$])`, 'u');
const memberRegex = (name) => new RegExp(`^[ \\t]*(?:[\\w$<>\\[\\],?.*&@ \\t]*[ \\t])?${escapeRe(name)}(?![\\w$])[ \\t]*[(=:;<]`);

// Line of `Class.member` where the member is declared directly in the class body (not in a method inside it).
function findMember(masked, cls, member) {
  const decl = declRegex(cls).exec(masked);
  if (!decl) return null;
  const after = decl.index + decl[0].length;
  const lineStart = masked.lastIndexOf('\n', decl.index) + 1;
  let lineEnd = masked.indexOf('\n', after);
  if (lineEnd < 0) lineEnd = masked.length;
  const head = masked.slice(lineStart, lineEnd).replace(/\r$/, '');
  const want = memberRegex(member);

  if (!head.includes('{') && /:\s*$/.test(head)) { // indentation based (Python)
    const indentOf = (l) => /^[ \t]*/.exec(l)[0].replace(/\t/g, '    ').length;
    const base = indentOf(head);
    let bodyIndent = -1;
    for (let pos = lineEnd + 1; pos < masked.length;) {
      let e = masked.indexOf('\n', pos);
      if (e < 0) e = masked.length;
      const l = masked.slice(pos, e).replace(/\r$/, '');
      if (l.trim() !== '') {
        const ind = indentOf(l);
        if (ind <= base) break;
        if (bodyIndent < 0) bodyIndent = ind;
        if (ind === bodyIndent && want.test(l)) return lineAt(masked, pos);
      }
      pos = e + 1;
    }
    return null;
  }

  const open = masked.indexOf('{', after);
  if (open < 0) return null;
  let depth = 1; // braces
  let nest = 0; // parentheses and brackets, so a signature spread over lines is read as one member
  for (let pos = open + 1; pos < masked.length;) {
    let e = masked.indexOf('\n', pos);
    if (e < 0) e = masked.length;
    const l = masked.slice(pos, e);
    if (depth === 1 && nest === 0 && want.test(l)) return lineAt(masked, pos);
    for (const ch of l) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '(' || ch === '[') nest++;
      else if (ch === ')' || ch === ']') nest = Math.max(0, nest - 1);
    }
    if (depth <= 0) break;
    pos = e + 1;
  }
  return null;
}

function findDeclaration(code, symbol, ext) {
  const type = LEX_AS[ext] ?? (CODE_EXT.has(ext) ? 'js' : ext);
  const masked = lex(code, type).masked;
  const dot = symbol.indexOf('.');
  if (dot > 0) return findMember(masked, symbol.slice(0, dot), symbol.slice(dot + 1));
  const m = declRegex(symbol).exec(masked);
  return m ? lineAt(masked, m.index) : null;
}

const shaOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// Is the symbol still in the file, and on which line now?
//   ptr: 'path#Symbol' or { path, symbol }.
//   facts: the facts list (or the facts.json object); `function` and `export` facts name the symbols the readers saw.
//   readCode(path): the file's text, or null when it does not exist. Without it only the facts are consulted.
// -> { ok: true, line } | { ok: false, why: 'path-missing' | 'symbol-missing' }
// A fact's line is used only when the file still has the sha the fact was read from; otherwise the line comes from the
// declaration found in the text now (comments and strings masked by the lex), so a renamed symbol is never "found".
export function resolvePointer(ptr, { facts, readCode } = {}) {
  let rawPath;
  let symbol;
  if (typeof ptr === 'string') {
    const at = ptr.indexOf('#');
    rawPath = at < 0 ? ptr : ptr.slice(0, at);
    symbol = at < 0 ? '' : ptr.slice(at + 1);
  } else {
    rawPath = ptr?.path;
    symbol = ptr?.symbol ?? '';
  }
  const path = cleanPath(rawPath);
  if (!path) return { ok: false, why: 'path-missing' };

  const list = Array.isArray(facts) ? facts : facts?.facts ?? [];
  const inFile = list.filter((f) => f.file === path);
  const validSymbol = SYMBOL.test(symbol);
  const fact = validSymbol
    ? inFile.find((f) => (f.kind === 'function' || f.kind === 'export') && (f.id === `fn:${path}#${symbol}` || f.id === `export:${path}#${symbol}` || f.name === symbol))
    : null;

  if (typeof readCode !== 'function') {
    if (fact && Number.isInteger(fact.line) && fact.line >= 1) return { ok: true, line: fact.line };
    return { ok: false, why: inFile.length ? 'symbol-missing' : 'path-missing' };
  }
  const code = readCode(path);
  if (typeof code !== 'string') return { ok: false, why: 'path-missing' };
  if (!validSymbol) return { ok: false, why: 'symbol-missing' };

  if (fact && fact.sha === shaOf(code) && Number.isInteger(fact.line) && fact.line >= 1 && fact.line <= code.split('\n').length) return { ok: true, line: fact.line };
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const line = findDeclaration(code, symbol, ext);
  return line ? { ok: true, line } : { ok: false, why: 'symbol-missing' };
}
