// Reading code on the page (mind-map-page mm26): the colors of each language, search inside a file and the folder tree of
// a box. Pure functions, no DOM, so node:test loads them. The colors come from a small reader of our own, no dependency:
// comments, text in quotes, numbers, keywords, tags and keys, which is what helps someone find their way in a file.

const STR_SQ = String.raw`'(?:\\.|[^\\'\n])*'`;
const STR_DQ = String.raw`"(?:\\.|[^\\"\n])*"`;
const NUM = String.raw`\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b`;
const HASH_COMMENT = String.raw`(?:^|(?<=\s))#[^\n]*`;
const words = (list) => String.raw`\b(?:${list.split(' ').join('|')})\b`;

const RULES = {
  js: [
    ['com', String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`],
    ['str', String.raw`\x60(?:\\[\s\S]|[^\\\x60])*(?:\x60|(?![\s\S]))|${STR_SQ}|${STR_DQ}`],
    ['num', NUM],
    ['kw', words('const let var function return if else for while do switch case break continue new delete typeof instanceof in of class extends super this import export from default async await yield try catch finally throw null undefined true false void static get set interface type enum implements public private protected readonly as')],
  ],
  json: [
    ['key', String.raw`${STR_DQ}(?=\s*:)`],
    ['str', STR_DQ],
    ['num', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
    ['kw', words('true false null')],
  ],
  css: [
    ['com', String.raw`\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`],
    ['str', `${STR_SQ}|${STR_DQ}`],
    ['kw', String.raw`@[\w-]+`],
    ['key', String.raw`--[\w-]+`],
    ['num', String.raw`-?\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|ms|s|deg|fr|ch)?\b`],
  ],
  markup: [
    ['com', String.raw`<!--[\s\S]*?(?:-->|(?![\s\S]))`],
    ['tag', String.raw`<\/?[A-Za-z][\w:-]*|\/?>`],
    ['attr', String.raw`\b[\w:-]+(?==)`],
    ['str', `"[^"\\n]*"|'[^'\\n]*'`],
  ],
  md: [
    ['head', String.raw`^#{1,6}[ \t][^\n]*`],
    ['kw', String.raw`^\x60\x60\x60[^\n]*`],
    ['str', String.raw`\x60[^\x60\n]+\x60`],
    ['attr', String.raw`\[[^\]\n]+\]\([^)\n]+\)`],
  ],
  py: [
    ['com', HASH_COMMENT],
    ['str', String.raw`"""[\s\S]*?(?:"""|(?![\s\S]))|'''[\s\S]*?(?:'''|(?![\s\S]))|${STR_DQ}|${STR_SQ}`],
    ['num', NUM],
    ['kw', words('def class return if elif else for while in not and or import from as with try except finally raise pass None True False lambda yield global nonlocal async await is del assert break continue')],
  ],
  sh: [
    ['com', HASH_COMMENT],
    ['str', `${STR_DQ}|'[^'\\n]*'`],
    ['key', String.raw`\$\{?[\w@#?*!]+\}?`],
    ['kw', words('if then else elif fi for do done case esac function in while until return export local echo cd')],
  ],
  yaml: [
    ['com', HASH_COMMENT],
    ['key', String.raw`^[ \t-]*[\w.\-"']+(?=:)`],
    ['str', `${STR_DQ}|${STR_SQ}`],
    ['num', NUM],
    ['kw', words('true false null yes no')],
  ],
};

const EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', mts: 'js', cts: 'js', tsx: 'js', vue: 'markup', svelte: 'markup', astro: 'markup',
  json: 'json', jsonc: 'json', css: 'css', scss: 'css', sass: 'css', less: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  md: 'md', mdx: 'md', markdown: 'md', py: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh', yml: 'yaml', yaml: 'yaml', toml: 'yaml',
};

export function langOf(path) {
  const name = String(path).split('/').pop().toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? EXT[name.slice(dot + 1)] ?? null : null;
}

const compiled = new Map();
function patternOf(lang) {
  if (!compiled.has(lang)) compiled.set(lang, new RegExp(RULES[lang].map(([, src]) => `(${src})`).join('|'), 'gm'));
  return compiled.get(lang);
}

// Lines of pieces {c: color class or null, s: text}; joined back they give the text exactly.
export function tokenize(text, lang) {
  const src = String(text ?? '');
  const pieces = [];
  if (RULES[lang]) {
    const re = patternOf(lang);
    re.lastIndex = 0;
    let last = 0;
    for (let m; (m = re.exec(src));) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (m.index > last) pieces.push({ c: null, s: src.slice(last, m.index) });
      const group = m.findIndex((g, i) => i > 0 && g !== undefined);
      pieces.push({ c: RULES[lang][group - 1][0], s: m[0] });
      last = m.index + m[0].length;
    }
    if (last < src.length) pieces.push({ c: null, s: src.slice(last) });
  } else pieces.push({ c: null, s: src });
  const lines = [[]];
  for (const piece of pieces) {
    piece.s.split('\n').forEach((s, i) => {
      if (i > 0) lines.push([]);
      if (s) lines.at(-1).push({ c: piece.c, s });
    });
  }
  return lines;
}

const MATCHES_MAX = 5000;

// Every place the words appear, ignoring case: [{line (from 0), from, to}].
export function findInLines(lines, query) {
  const q = String(query ?? '').toLowerCase();
  if (!q) return [];
  const out = [];
  lines.forEach((line, i) => {
    const low = String(line).toLowerCase();
    for (let at = low.indexOf(q); at !== -1 && out.length < MATCHES_MAX; at = low.indexOf(q, at + q.length)) out.push({ line: i, from: at, to: at + q.length });
  });
  return out;
}

// The pieces of a line cut where the search matches, the matched ones marked hit (with their color kept) and k, the
// index of their range.
export function markTokens(tokens, ranges) {
  if (!ranges.length) return tokens;
  const out = [];
  let offset = 0;
  for (const t of tokens) {
    const end = offset + t.s.length;
    let at = offset;
    for (const [k, r] of ranges.entries()) {
      if (r.to <= at || r.from >= end) continue;
      const from = Math.max(r.from, at);
      const to = Math.min(r.to, end);
      if (from > at) out.push({ c: t.c, s: t.s.slice(at - offset, from - offset) });
      out.push({ c: t.c, s: t.s.slice(from - offset, to - offset), hit: true, k });
      at = to;
    }
    if (at < end) out.push({ c: t.c, s: t.s.slice(at - offset) });
    offset = end;
  }
  return out;
}

// Folders first, then files, both in name order; a folder holding only one folder is shown as one line ("docs/a/b"),
// like the editor's compact folders. Each folder counts the files inside it.
export function fileTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.slice(0, -1).forEach((name, i) => {
      if (!node.dirs.has(name)) node.dirs.set(name, { name, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
      node = node.dirs.get(name);
    });
    node.files.push({ ...f, name: parts.at(-1) });
  }
  const finish = (node) => {
    let dirs = [...node.dirs.values()].map(finish);
    dirs = dirs.map((d) => {
      let cur = d;
      while (!cur.files.length && cur.dirs.length === 1) cur = { ...cur.dirs[0], name: `${cur.name}/${cur.dirs[0].name}` };
      return cur;
    }).sort((a, b) => a.name.localeCompare(b.name));
    const files = node.files.sort((a, b) => a.name.localeCompare(b.name));
    return { name: node.name, path: node.path, dirs, files, count: files.length + dirs.reduce((n, d) => n + d.count, 0) };
  };
  return finish(root);
}
