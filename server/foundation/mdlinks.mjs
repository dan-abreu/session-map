// Markdown links, headings and anchors (fd13, fd05, fd06). Pure: it gets text and lists, never touches the disk.
// Code is never read as prose: fenced blocks, inline code, HTML comments and front matter are masked first, so a link or
// a heading shown as an example can neither count nor break. Indented (4 spaces) code blocks are not masked: inside
// lists they cannot be told from continuation text without a full parser.

import { posix } from 'node:path';

const blank = (s) => s.replace(/[^\r\n]/g, ' ');

// ---------- code masking ----------

const FENCE_OPEN = /^[ \t>]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;

function fencedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!open) {
      const m = FENCE_OPEN.exec(line);
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = { ch: m[1][0], len: m[1].length }; out[i] = true; }
      continue;
    }
    out[i] = true;
    const m = FENCE_CLOSE.exec(line);
    if (m && m[1][0] === open.ch && m[1].length >= open.len) open = null;
  }
  return out;
}

// Index of the closing `---` of a YAML front matter block at the top, or -1. The block must look like YAML so a
// horizontal rule at the top of a document is not taken for it.
function frontMatterEnd(lines) {
  if (lines[0]?.replace(/\r$/, '') !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (l === '---' || l === '...') return i;
    if (!/^(\s*$|\s*#|\s*-(\s|$)|\s+\S|[\w.-]+\s*:)/.test(l)) return -1;
  }
  return -1;
}

// Replaces fenced code and front matter with blank lines (same line count).
function blankBlocks(text) {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  const fm = frontMatterEnd(lines);
  return lines.map((l, i) => (fenced[i] || (fm >= 0 && i <= fm) ? blank(l) : l)).join('\n');
}

// Spans of inline code in text whose fences are already blanked: [{ start, contentStart, contentEnd, end }].
function inlineSpans(text) {
  const n = text.length;
  const spans = [];
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c !== '`') { i++; continue; }
    let j = i;
    while (text[j] === '`') j++;
    const len = j - i;
    const gap = /\n[ \t\r]*\n/g;
    gap.lastIndex = j;
    const para = gap.exec(text);
    const paraEnd = para ? para.index : n;
    let k = j;
    let found = -1;
    while (k < paraEnd) {
      const at = text.indexOf('`', k);
      if (at < 0 || at >= paraEnd) break;
      let e = at;
      while (text[e] === '`') e++;
      if (e - at === len) { found = at; break; }
      k = e;
    }
    if (found < 0) { i = j; continue; }
    spans.push({ start: i, contentStart: j, contentEnd: found, end: found + len });
    i = found + len;
  }
  return spans;
}

function applyBlank(text, ranges) {
  let out = '';
  let at = 0;
  for (const [s, e] of ranges) { out += text.slice(at, s) + blank(text.slice(s, e)); at = e; }
  return out + text.slice(at);
}

// Same length and same line breaks as `text`, with fenced code, front matter, inline code and HTML comments as spaces.
export function maskCode(text) {
  const src = String(text ?? '');
  const base = blankBlocks(src);
  const noCode = applyBlank(base, inlineSpans(base).map((s) => [s.start, s.end]));
  const comments = [];
  const re = /<!--[\s\S]*?(?:-->|$)/g;
  for (let m = re.exec(noCode); m; m = re.exec(noCode)) comments.push([m.index, m.index + m[0].length]);
  return applyBlank(noCode, comments);
}

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

// Inline code in the text (outside fenced blocks): [{ line, text }] with the span's own text, one surrounding space
// removed the way Markdown does.
export function codeSpansOf(text) {
  const src = String(text ?? '');
  const base = blankBlocks(src);
  const lineOf = lineIndex(src);
  return inlineSpans(base).map((s) => {
    let t = src.slice(s.contentStart, s.contentEnd).replace(/\r?\n/g, ' ');
    if (t.length > 2 && t.startsWith(' ') && t.endsWith(' ') && t.trim() !== '') t = t.slice(1, -1);
    return { line: lineOf(s.contentStart), text: t };
  });
}

// ---------- headings and anchors ----------

// GitHub's anchor for a heading. `seen` (a Map, shared by all headings of one document) numbers repeats: foo, foo-1, foo-2.
export function ghSlug(heading, seen) {
  let t = String(heading ?? '');
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  t = t.replace(/<[^>]*>/g, '').replace(/`/g, '').replace(/\*+/g, '').replace(/~~/g, '');
  t = t.replace(/(^|[^\p{L}\p{N}])_+([^\s_](?:[^_]*[^\s_])?)_+(?=$|[^\p{L}\p{N}])/gu, '$1$2');
  const base = t.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
  if (!seen) return base;
  if (!seen.has(base)) { seen.set(base, 0); return base; }
  let n = seen.get(base);
  let slug;
  do { n++; slug = `${base}-${n}`; } while (seen.has(slug));
  seen.set(base, n);
  seen.set(slug, 0);
  return slug;
}

// Headings outside code, in order: [{ line, level, text, slug }] (ATX and one-line setext).
export function headingsOf(text) {
  const src = String(text ?? '');
  const lines = blankBlocks(src).split('\n').map((l) => l.replace(/\r$/, ''));
  const seen = new Map();
  const out = [];
  const push = (line, level, raw) => out.push({ line, level, text: raw, slug: ghSlug(raw, seen) });
  for (let i = 0; i < lines.length; i++) {
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(lines[i]);
    if (atx) { push(i + 1, atx[1].length, (atx[2] ?? '').replace(/(^|[ \t]+)#+[ \t]*$/, '').trim()); continue; }
    const under = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[i + 1] ?? '');
    if (under && /^ {0,3}\S/.test(lines[i]) && !/^ {0,3}([#>|]|[-*+][ \t]|\d+[.)][ \t]|(=+|-+)[ \t]*$)/.test(lines[i])) {
      push(i + 1, under[1][0] === '=' ? 1 : 2, lines[i].trim());
      i++;
    }
  }
  return out;
}

// Every anchor a link can reach in this document: heading slugs plus HTML id/name attributes (lower case).
export function anchorsOf(text) {
  const out = new Set();
  for (const h of headingsOf(text)) if (h.slug) out.add(h.slug);
  const masked = maskCode(text);
  const re = /<[a-z][a-z0-9]*\b[^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (let m = re.exec(masked); m; m = re.exec(masked)) out.add((m[1] ?? m[2]).toLowerCase());
  return out;
}

// ---------- links ----------

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function describe(raw) {
  const target = raw.trim();
  if (target === '') return null;
  if (SCHEME.test(target) || target.startsWith('//')) return { target, path: null, anchor: null, external: true };
  const hash = target.indexOf('#');
  const before = hash < 0 ? target : target.slice(0, hash);
  const anchor = hash < 0 ? '' : target.slice(hash + 1);
  const path = safeDecode(before.replace(/\?.*$/, ''));
  return { target, path, anchor: anchor === '' ? null : safeDecode(anchor), external: false };
}

// Reads a link destination just after "](" : returns { dest, end } where end is after the closing ")", or null.
function parseDest(s, from) {
  const n = s.length;
  let i = from;
  while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  let dest = '';
  if (s[i] === '<') {
    const close = s.indexOf('>', i);
    const nl = s.indexOf('\n', i);
    if (close < 0 || (nl >= 0 && nl < close)) return null;
    dest = s.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    while (i < n) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < n) { dest += s[i + 1]; i += 2; continue; }
      if (/\s/.test(ch)) break;
      if (ch === '(') depth++;
      if (ch === ')') { if (depth === 0) break; depth--; }
      dest += ch;
      i++;
    }
  }
  while (i < n && /\s/.test(s[i])) i++;
  const q = s[i];
  if (q === '"' || q === "'" || q === '(') {
    const closeQ = q === '(' ? ')' : q;
    let k = i + 1;
    while (k < n && s[k] !== closeQ) k += s[k] === '\\' ? 2 : 1;
    if (k >= n) return null;
    i = k + 1;
    while (i < n && /\s/.test(s[i])) i++;
  }
  return s[i] === ')' ? { dest, end: i + 1 } : null;
}

// Opening "[" of the link text that closes at `close` (the "]"), or -1. Stops at the end of the paragraph.
function openBracket(s, close) {
  let depth = 0;
  for (let i = close - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === '\n' && /^[ \t\r]*\n/.test(s.slice(i + 1, i + 40)) ) return -1;
    if (ch !== '[' && ch !== ']') continue;
    let bs = 0;
    for (let k = i - 1; k >= 0 && s[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    if (ch === ']') depth++;
    else if (depth === 0) return i;
    else depth--;
  }
  return -1;
}

// Links outside code, in document order: [{ line, kind, target, path, anchor, external }].
// kind: inline | image | reference | html. `path` is decoded, without ?query; '' means the same file.
export function linksOf(text) {
  const src = String(text ?? '');
  const masked = maskCode(src);
  const lineOf = lineIndex(src);
  const found = [];
  const add = (offset, kind, raw) => {
    const d = describe(raw);
    if (d) found.push({ offset, line: lineOf(offset), kind, ...d });
  };

  for (let at = masked.indexOf(']('); at >= 0; at = masked.indexOf('](', at + 1)) {
    let bs = 0;
    for (let k = at - 1; k >= 0 && masked[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    const open = openBracket(masked, at);
    if (open < 0) continue;
    if (masked[open - 1] === '\\' && masked[open - 2] !== '\\') continue;
    const parsed = parseDest(masked, at + 2);
    if (!parsed) continue;
    add(at + 2, masked[open - 1] === '!' ? 'image' : 'inline', parsed.dest);
  }

  const ref = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)/gm;
  for (let m = ref.exec(masked); m; m = ref.exec(masked)) {
    if (m[1].startsWith('^')) continue;
    add(m.index, 'reference', m[2].replace(/^<|>$/g, ''));
  }

  const html = /<(?:a|img|source|link|video|audio|iframe)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (let m = html.exec(masked); m; m = html.exec(masked)) add(m.index, 'html', m[1] ?? m[2]);

  found.sort((a, b) => a.offset - b.offset);
  return found.map(({ offset, ...rest }) => rest);
}

// Where a link written in `fromPath` points: { path, anchor } with "/" separators and no "./" or "../".
// path is null when the link leaves the repository; the whole result is null for an external target.
export function resolveLink(fromPath, target) {
  const d = describe(String(target ?? ''));
  if (!d || d.external) return null;
  const from = String(fromPath ?? '').replaceAll('\\', '/');
  let path;
  if (d.path === '') path = posix.normalize(from);
  else if (d.path.startsWith('/')) path = posix.normalize(d.path.slice(1));
  else path = posix.normalize(posix.join(posix.dirname(from), d.path.replaceAll('\\', '/')));
  path = path.replace(/\/+$/, '');
  if (path === '..' || path.startsWith('../') || path === '' ) path = null;
  return { path, anchor: d.anchor };
}

// The links that lead nowhere. files: { path -> text } of the Markdown files to check; existsOnDisk: a function or a Set
// that says whether any other path (file or folder) exists. A link into a Markdown file in `files` is also checked for
// its anchor; anchors into other files (code lines, files not given) are not checked.
export function brokenLinks(files, existsOnDisk) {
  const exists = typeof existsOnDisk === 'function' ? existsOnDisk : (p) => Boolean(existsOnDisk?.has?.(p));
  const known = new Map(Object.entries(files ?? {}).map(([p, t]) => [p.replaceAll('\\', '/'), t]));
  const folders = new Set();
  for (const p of known.keys()) for (let d = posix.dirname(p); d !== '.' && d !== '/' && !folders.has(d); d = posix.dirname(d)) folders.add(d);
  const anchors = new Map();
  const anchorsFor = (p) => {
    if (!anchors.has(p)) anchors.set(p, anchorsOf(known.get(p)));
    return anchors.get(p);
  };
  const out = [];
  for (const [file, text] of known) {
    for (const link of linksOf(text)) {
      if (link.external) continue;
      const r = resolveLink(file, link.target);
      if (!r) continue;
      const bad = (why) => out.push({ file, line: link.line, target: link.target, why });
      if (r.path === null) { bad('file-missing'); continue; }
      if (known.has(r.path)) {
        if (r.anchor && !anchorsFor(r.path).has(r.anchor.replace(/^user-content-/i, '').toLowerCase())) bad('anchor-missing');
        continue;
      }
      if (folders.has(r.path) || exists(r.path)) continue;
      bad('file-missing');
    }
  }
  return out;
}
