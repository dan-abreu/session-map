// Health (fd08), finding a document and weighing its content. Pure: a list of paths or a text in, facts out.

export const DOC_DIRS = Object.freeze(['', '.github', 'docs']);
export const DOC_EXTS = Object.freeze(['', '.md', '.txt', '.rst']);

const dirOf = (p) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

// A document by name, without caring about case: root first, then .github, then docs (each place in the order given),
// never a subfolder. The first name of `names` wins inside a place, then the first extension.
export function findDoc(paths, names, { dirs = DOC_DIRS, exts = DOC_EXTS } = {}) {
  const wanted = (Array.isArray(names) ? names : [names]).map((n) => String(n).toLowerCase());
  const index = new Map();
  for (const p of paths) {
    const key = `${dirOf(p).toLowerCase()}\0${baseOf(p).toLowerCase()}`;
    if (!index.has(key)) index.set(key, p);
  }
  for (const dir of dirs) {
    for (const name of wanted) {
      for (const ext of exts) {
        const hit = index.get(`${dir.toLowerCase()}\0${name}${ext.toLowerCase()}`);
        if (hit) return hit;
      }
    }
  }
  return null;
}

// What a template leaves behind when nobody filled it in. Real html tags (<br>, <img ...>) do not match: the angle form
// needs a name in capitals or a "your/insert/add..." word.
const MARKER_RES = [
  /<\s*[A-Z][A-Z0-9 _-]{2,}\s*>/g,
  /<\s*(?:your|insert|add|enter|put|replace)[a-z0-9 _@.-]*>/gi,
  /\[\s*(?:INSERT|YOUR|TODO|REPLACE)[^\]\n]*\]/g,
  /\byour[-_.]?(?:email|name|company|address)[\w.@-]*/gi,
  /\bexample\.(?:com|org|net)\b/gi,
];

const FENCE = /^\s*(```|~~~)/;
const ATX = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT = /^ {0,3}(=+|-{2,})\s*$/;
const HTML_COMMENT_LINE = /^\s*<!--.*-->\s*$/;

// lines = non-empty lines that are not a lone html comment; titles = '#' headings outside code fences plus underlined ones;
// markers = every template leftover with its line (text is the marker only, never a neighbouring value).
export function docStats(text) {
  if (typeof text !== 'string' || !text) return { lines: 0, titles: 0, markers: [] };
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  let lines = 0;
  let titles = 0;
  let fenced = false;
  const markers = [];
  rows.forEach((row, i) => {
    if (FENCE.test(row)) fenced = !fenced;
    else if (!fenced && ATX.test(row)) titles++;
    else if (!fenced && SETEXT.test(row) && i > 0 && rows[i - 1].trim() && !SETEXT.test(rows[i - 1]) && !ATX.test(rows[i - 1])) titles++;
    if (row.trim() && !HTML_COMMENT_LINE.test(row)) lines++;
    for (const re of MARKER_RES) {
      for (const m of row.matchAll(re)) markers.push({ line: i + 1, text: m[0], at: m.index });
    }
  });
  markers.sort((a, b) => a.line - b.line || a.at - b.at);
  return { lines, titles, markers: dedupeLine(markers) };
}

// your-email@example.com is one finding, not two: a match that starts inside the previous one is dropped.
function dedupeLine(list) {
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.line === m.line && m.at < last.at + last.text.length) continue;
    out.push(m);
  }
  return out.map(({ line, text }) => ({ line, text }));
}
