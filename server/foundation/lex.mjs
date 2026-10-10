// Reads source text just enough to tell code from comments and strings. Pure and dependency free: every census count and
// every extractor pattern runs on its output, so a "route" in a comment or a string can never become a fact.
//
//   lex(text, type) -> { masked, lines: [{ blank, comment }] }
//     masked  same length and same line breaks as `text`; comments become spaces and the inside of strings becomes
//             spaces (the quotes stay), so a pattern run on `masked` points at the same offset in `text`.
//     lines   one entry per line (as lineCount counts them); `comment` = the line has text and all of it is comment.
//
// A tolerant reader, not a parser: when the text is not valid code it still answers and never throws, and damage stays
// on the line it started (an apostrophe in JSX text spoils that line only).

const CODE = 0;
const COMMENT = 1;
const STR = 2;

const isIdent = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

function lineEnd(text, i) {
  const n = text.length;
  let j = i;
  while (j < n && text.charCodeAt(j) !== 10 && text.charCodeAt(j) !== 13) j++;
  return j;
}

// Reads a quoted string starting at the opening quote `i`; returns the offset after the closing quote.
// Without `multiline` an unclosed string stops at the line break (which is not consumed).
function quoted(text, mark, i, q, multiline) {
  const n = text.length;
  let p = i + 1;
  while (p < n) {
    const ch = text[p];
    if (ch === '\\') { p += text[p + 1] === '\r' && text[p + 2] === '\n' ? 3 : 2; continue; }
    if (ch === q) break;
    if (!multiline && (ch === '\n' || ch === '\r')) break;
    p++;
  }
  const end = Math.min(p, n);
  mark.fill(STR, i + 1, end);
  return end < n && text[end] === q ? end + 1 : end;
}

// ---------- JavaScript and TypeScript ----------

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'throw', 'new', 'yield', 'await', 'instanceof']);

function scanJs(text, mark) {
  const n = text.length;
  const tpl = []; // brace depth inside each open `${ }`
  let last = ''; // previous token: a punctuation char, a word, or 'v' for a finished value
  let entered = false;
  let i = 0;

  const template = (from) => {
    let p = from;
    entered = false;
    while (p < n) {
      const ch = text[p];
      if (ch === '\\') { p += 2; continue; }
      if (ch === '`') { mark.fill(STR, from, p); return p + 1; }
      if (ch === '$' && text[p + 1] === '{') { mark.fill(STR, from, p); tpl.push(0); entered = true; return p + 2; }
      p++;
    }
    mark.fill(STR, from, Math.min(p, n));
    return n;
  };

  // A regex has to close on its own line; otherwise the slash was a division.
  const regex = (from) => {
    let q = from + 1;
    let inClass = false;
    while (q < n) {
      const ch = text[q];
      if (ch === '\n' || ch === '\r') return -1;
      if (ch === '\\') { q += 2; continue; }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) { mark.fill(STR, from + 1, q); return q + 1; }
      q++;
    }
    return -1;
  };

  while (i < n) {
    const c = text[i];
    if (isSpace(c)) { i++; continue; }
    const d = text[i + 1];
    if (c === '/') {
      if (d === '/') { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
      if (d === '*') {
        const j = text.indexOf('*/', i + 2);
        const end = j < 0 ? n : j + 2;
        mark.fill(COMMENT, i, end);
        i = end;
        continue;
      }
      if (d !== '>' && (REGEX_AFTER.has(last) || REGEX_KEYWORDS.has(last))) {
        const end = regex(i);
        if (end > 0) { i = end; last = 'v'; continue; }
      }
      last = '/';
      i++;
      continue;
    }
    if (c === '"' || c === "'") { i = quoted(text, mark, i, c, false); last = 'v'; continue; }
    if (c === '`') { i = template(i + 1); last = entered ? '{' : 'v'; continue; }
    if (isIdent(text.charCodeAt(i))) {
      let j = i + 1;
      while (j < n && isIdent(text.charCodeAt(j))) j++;
      last = text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '{') { if (tpl.length) tpl[tpl.length - 1]++; last = '{'; i++; continue; }
    if (c === '}') {
      if (tpl.length) {
        if (tpl[tpl.length - 1] === 0) { tpl.pop(); i = template(i + 1); last = entered ? '{' : 'v'; continue; }
        tpl[tpl.length - 1]--;
      }
      last = '}';
      i++;
      continue;
    }
    if ((c === '+' || c === '-') && d === c) { last = 'v'; i += 2; continue; }
    last = c === '>' && text[i - 1] === '=' ? '=' : c;
    i++;
  }
}

// ---------- Dart ----------

function scanDart(text, mark) {
  const n = text.length;
  const stack = []; // open `${ }` inside a string: { q, triple, depth }
  let i = 0;

  const body = (from, q, triple, raw) => {
    let p = from;
    while (p < n) {
      const ch = text[p];
      if (ch === '\\' && !raw) { p += 2; continue; }
      if (!triple && (ch === '\n' || ch === '\r')) { mark.fill(STR, from, p); return p; }
      if (ch === q && (!triple || (text[p + 1] === q && text[p + 2] === q))) { mark.fill(STR, from, p); return p + (triple ? 3 : 1); }
      if (ch === '$' && text[p + 1] === '{' && !raw) { mark.fill(STR, from, p); stack.push({ q, triple, depth: 0 }); return p + 2; }
      p++;
    }
    mark.fill(STR, from, Math.min(p, n));
    return n;
  };

  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
    if (c === '/' && d === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; }
        else if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      const end = Math.min(j, n);
      mark.fill(COMMENT, i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      const triple = text[i + 1] === c && text[i + 2] === c;
      const raw = text[i - 1] === 'r' && !(i >= 2 && isIdent(text.charCodeAt(i - 2)));
      i = body(i + (triple ? 3 : 1), c, triple, raw);
      continue;
    }
    if (c === '{') { if (stack.length) stack[stack.length - 1].depth++; i++; continue; }
    if (c === '}') {
      if (stack.length) {
        const top = stack[stack.length - 1];
        if (top.depth === 0) { stack.pop(); i = body(i + 1, top.q, top.triple, false); continue; }
        top.depth--;
      }
      i++;
      continue;
    }
    i++;
  }
}

// ---------- PHP ----------

function scanPhp(text, mark) {
  const n = text.length;
  const stack = []; // open `{$ }` inside a double-quoted string: { q, depth }
  // Without any `<?` the whole text is taken as PHP (a snippet); otherwise HTML is left alone until `<?php` or `<?=`.
  let php = !text.includes('<?');
  let i = 0;

  const body = (from, q) => {
    let p = from;
    while (p < n) {
      const ch = text[p];
      if (ch === '\\') { p += 2; continue; }
      if (ch === q) { mark.fill(STR, from, p); return p + 1; }
      if (ch === '{' && text[p + 1] === '$') { mark.fill(STR, from, p); stack.push({ q, depth: 0 }); return p + 1; }
      p++;
    }
    mark.fill(STR, from, Math.min(p, n));
    return n;
  };

  while (i < n) {
    if (!php) {
      const re = /<\?(?:php\b|=)/g;
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) break;
      i = m.index + m[0].length;
      php = true;
      continue;
    }
    const c = text[i];
    const d = text[i + 1];
    if (c === '?' && d === '>') { php = false; i += 2; continue; }
    if ((c === '/' && d === '/') || (c === '#' && d !== '[')) {
      let j = i + (c === '/' ? 2 : 1);
      while (j < n && text[j] !== '\n' && !(text[j] === '?' && text[j + 1] === '>')) j++;
      mark.fill(COMMENT, i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      mark.fill(COMMENT, i, end);
      i = end;
      continue;
    }
    if (c === "'") { i = quoted(text, mark, i, "'", true); continue; }
    if (c === '"' || c === '`') { i = body(i + 1, c); continue; }
    if (c === '<' && d === '<' && text[i + 2] === '<') {
      const re = /<<<[ \t]*(?:"([A-Za-z_]\w*)"|'([A-Za-z_]\w*)'|([A-Za-z_]\w*))[ \t]*\r?\n/y;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        const id = m[1] ?? m[2] ?? m[3];
        const from = re.lastIndex;
        const close = new RegExp(`^[ \\t]*${id}(?![A-Za-z0-9_])`, 'gm');
        close.lastIndex = from;
        const found = close.exec(text);
        const to = found ? found.index : n;
        mark.fill(STR, from, to);
        i = to;
        continue;
      }
    }
    if (c === '{' && stack.length) { stack[stack.length - 1].depth++; i++; continue; }
    if (c === '}' && stack.length) {
      const top = stack[stack.length - 1];
      if (top.depth === 0) { stack.pop(); i = body(i + 1, top.q); continue; }
      top.depth--;
    }
    i++;
  }
}

// ---------- Prisma, CSS, SQL ----------

function scanPrisma(text, mark) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
    if (c === '"') { i = quoted(text, mark, i, '"', false); continue; }
    i++;
  }
}

function scanCss(text, mark) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      mark.fill(COMMENT, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") { i = quoted(text, mark, i, c, false); continue; }
    i++;
  }
}

function scanSql(text, mark) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      mark.fill(COMMENT, i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      let p = i + 1;
      while (p < n) {
        if (text[p] === "'") { if (text[p + 1] === "'") { p += 2; continue; } break; }
        p++;
      }
      const end = Math.min(p, n);
      mark.fill(STR, i + 1, end);
      i = end + 1;
      continue;
    }
    // Quoted names are skipped unmasked: they matter to readers, but a `--` inside one must not open a comment.
    if (c === '"' || c === '`') {
      let p = i + 1;
      while (p < n && text[p] !== c && text[p] !== '\n') p++;
      i = p < n && text[p] === c ? p + 1 : p;
      continue;
    }
    i++;
  }
}

// ---------- shell and YAML ----------

function scanShell(text, mark) {
  const n = text.length;
  const pending = []; // heredocs opened on the current line: { id, dash }
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '#' && (i === 0 || isSpace(text[i - 1]))) { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      if (j < 0) { i++; continue; }
      mark.fill(STR, i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let p = i + 1;
      while (p < n && text[p] !== '"') p += text[p] === '\\' ? 2 : 1;
      if (p >= n) { i++; continue; }
      mark.fill(STR, i + 1, p);
      i = p + 1;
      continue;
    }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      const re = /<<(-?)[ \t]*(?:"([^"\n]+)"|'([^'\n]+)'|\\?([A-Za-z_]\w*))/y;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) { pending.push({ id: m[2] ?? m[3] ?? m[4], dash: m[1] === '-' }); i = re.lastIndex; continue; }
    }
    if (c === '\n' && pending.length) {
      let at = i + 1;
      for (const { id, dash } of pending) {
        let p = at;
        let found = false;
        while (p < n) {
          const e = text.indexOf('\n', p);
          let line = text.slice(p, e < 0 ? n : e);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if ((dash ? line.replace(/^\t+/, '') : line) === id) { found = true; break; }
          if (e < 0) { p = n; break; }
          p = e + 1;
        }
        mark.fill(STR, at, p);
        at = p;
        if (!found) break;
      }
      pending.length = 0;
      i = at;
      continue;
    }
    i++;
  }
}

// A quote opens a YAML string only where a value can start; `it's` in plain text is just text.
function scanYaml(text, mark) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '#' && (i === 0 || isSpace(text[i - 1]))) { const j = lineEnd(text, i); mark.fill(COMMENT, i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      let b = i - 1;
      while (b >= 0 && (text[b] === ' ' || text[b] === '\t')) b--;
      if (b < 0 || text[b] === '\n' || text[b] === '\r' || ':-,[{?!'.includes(text[b])) {
        const end = c === '"' ? yamlDouble(text, i) : yamlSingle(text, i);
        if (end > 0) { mark.fill(STR, i + 1, end); i = end + 1; continue; }
      }
    }
    i++;
  }
}

function yamlDouble(text, i) {
  for (let p = i + 1; p < text.length; p++) {
    if (text[p] === '\\') { p++; continue; }
    if (text[p] === '\n' || text[p] === '\r') return -1;
    if (text[p] === '"') return p;
  }
  return -1;
}

function yamlSingle(text, i) {
  for (let p = i + 1; p < text.length; p++) {
    if (text[p] === '\n' || text[p] === '\r') return -1;
    if (text[p] === "'") { if (text[p + 1] === "'") { p++; continue; } return p; }
  }
  return -1;
}

// ---------- public API ----------

const SCANNERS = {
  js: scanJs, ts: scanJs, tsx: scanJs, jsx: scanJs, mjs: scanJs, cjs: scanJs, mts: scanJs, cts: scanJs,
  dart: scanDart, php: scanPhp, prisma: scanPrisma, css: scanCss, sql: scanSql,
  sh: scanShell, bash: scanShell, zsh: scanShell, yaml: scanYaml, yml: scanYaml,
};

const isBlankChar = (c) => c === 32 || c === 9 || c === 13 || c === 11 || c === 12 || c === 160 || c === 0xfeff;

export function lex(text, type) {
  const n = text.length;
  const mark = new Uint8Array(n);
  const scan = Object.hasOwn(SCANNERS, type) ? SCANNERS[type] : null;
  if (scan) scan(text, mark);

  let masked = text;
  if (scan) {
    const chars = text.split('');
    for (let i = 0; i < n; i++) if (mark[i] !== CODE && chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    masked = chars.join('');
  }

  const lines = [];
  let s = 0;
  while (s < n) {
    let e = text.indexOf('\n', s);
    if (e < 0) e = n;
    let blank = true;
    let comment = true;
    for (let k = s; k < e; k++) {
      const c = text.charCodeAt(k);
      if (isBlankChar(c) || (c > 127 && text[k].trim() === '')) continue;
      blank = false;
      if (mark[k] !== COMMENT) { comment = false; break; }
    }
    lines.push({ blank, comment: !blank && comment });
    s = e + 1;
  }
  return { masked, lines };
}

// ---------- literals ----------

const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
const identStart = (ch) => ch !== undefined && /[A-Za-z_]/.test(ch);

// The value of the string literal that starts at `offset` (its opening quote, or the `r` of a Dart raw string), only
// when it is pure: no interpolation. `type` tells which interpolation to look for (`${}` in JS templates always;
// `$x` and `${}` in Dart; `$x` and `{$` in PHP double quotes). Returns { value, end } (end = offset after the closing
// quote) or null.
export function literalAt(text, offset, type) {
  const n = text.length;
  let p = offset;
  let raw = false;
  if (type === 'dart' && text[p] === 'r' && (text[p + 1] === "'" || text[p + 1] === '"')) { raw = true; p++; }
  const q = text[p];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  const triple = type === 'dart' && q !== '`' && text[p + 1] === q && text[p + 2] === q;
  const phpSingle = type === 'php' && q === "'";
  const phpDouble = type === 'php' && q === '"';
  let k = p + (triple ? 3 : 1);
  let value = '';
  while (k < n) {
    const ch = text[k];
    if (triple ? ch === q && text[k + 1] === q && text[k + 2] === q : ch === q) return { value, end: k + (triple ? 3 : 1) };
    if (!triple && q !== '`' && (ch === '\n' || ch === '\r')) return null;
    if (q === '`' && ch === '$' && text[k + 1] === '{') return null;
    if (type === 'dart' && !raw && ch === '$' && (text[k + 1] === '{' || identStart(text[k + 1]))) return null;
    if (phpDouble && ((ch === '$' && identStart(text[k + 1])) || (ch === '{' && text[k + 1] === '$'))) return null;
    if (ch === '\\' && !raw) {
      const next = text[k + 1];
      if (next === undefined) return null;
      if (phpSingle) {
        if (next === '\\' || next === "'") { value += next; k += 2; } else { value += ch; k++; }
        continue;
      }
      if (next === '\n') { k += 2; continue; }
      if (next === '\r') { k += text[k + 2] === '\n' ? 3 : 2; continue; }
      if (next === 'x' && /^[0-9a-fA-F]{2}/.test(text.slice(k + 2, k + 4))) { value += String.fromCharCode(parseInt(text.slice(k + 2, k + 4), 16)); k += 4; continue; }
      if (next === 'u') {
        const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(text.slice(k + 2, k + 10));
        const plain = /^[0-9a-fA-F]{4}/.exec(text.slice(k + 2, k + 6));
        if (braced && parseInt(braced[1], 16) <= 0x10ffff) { value += String.fromCodePoint(parseInt(braced[1], 16)); k += 2 + braced[0].length; continue; }
        if (plain) { value += String.fromCharCode(parseInt(plain[0], 16)); k += 6; continue; }
      }
      if (Object.hasOwn(SIMPLE_ESCAPES, next)) { value += SIMPLE_ESCAPES[next]; k += 2; continue; }
      value += phpDouble && next !== '"' && next !== '$' && next !== '\\' ? ch + next : next;
      k += 2;
      continue;
    }
    value += ch;
    k++;
  }
  return null;
}

// 1-based line of an offset.
export function lineAt(text, offset) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) line++;
  return line;
}
