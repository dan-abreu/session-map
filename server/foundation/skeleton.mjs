// The skeleton of a file as a tool (fd17): what an agent reads before it reads any line of the file. Exact and free, no
// AI: the imports, the exports, every class and function signature with its line (a function written inside another is
// indented under its parent) and the environment variables the file reads. No bodies. A 60 KB file comes out near 4 KB.
//
//   skeleton({ root, file }) -> text, or null when the answer is no: a path outside root (or one that reaches .git, or a
//   link that leaves root), a secrets file (.env and its variants, never the templates), a file that is not JS/TS/Dart/PHP,
//   missing, binary or over 1 MB.
//
// Pure of the network and of the index: it reads the one file and runs the same readers the census uses.
import { readFileSync, statSync } from 'node:fs';
import { FILE_MAX, isSecretsFile, safeResolve } from '../files.mjs';
import { lex, literalAt } from './lex.mjs';
import { extract, importNames } from './extract/functions.mjs';

const TYPE_OF = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', dart: 'dart', php: 'php' };
const SIGNATURE_MAX = 160;
const ENV_MAX = 60;

// Where a variable name is read: the pattern runs on the masked text and ends just before the quote of the name, which
// literalAt then reads from the real text. `process.env.X` and `const { X } = process.env` carry the name unquoted.
const ENV_QUOTED = [
  /process\.env\s*\??\.?\s*\[\s*(?=['"`])/g,
  /(?<![\w$.])Platform\.environment\s*\[\s*(?=['"`])/g,
  /(?<![\w$.])String\.(?:fromEnvironment|hasEnvironment)\s*\(\s*(?=['"`])/g,
  /(?<![\w$>.])(?:getenv|env)\s*\(\s*(?=['"`])/g,
  /(?<![\w$>.])\$_(?:ENV|SERVER)\s*\[\s*(?=['"`])/g,
  /(?<![\w$.])os\.(?:getenv\s*\(|environ(?:\.get\s*\(|\s*\[))\s*(?=['"`])/g,
];
const ENV_DOT_RE = /process\.env\s*\??\.\s*([A-Za-z_]\w*)/g;
const ENV_DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b/g;
const NAME_RE = /^[A-Za-z_]\w*$/;
const CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:(?:abstract|final|sealed|base|interface|mixin|declare|readonly)\s+)*(?:class|interface|enum|trait|mixin|extension)\s+[A-Za-z_$]/;

const clip = (s) => s.trim().slice(0, SIGNATURE_MAX);

function envOf(text, masked, type, lineOf) {
  const seen = new Map();
  const add = (name, at) => {
    if (!NAME_RE.test(name)) return;
    const line = lineOf(at);
    if (!seen.has(name)) seen.set(name, []);
    if (!seen.get(name).includes(line)) seen.get(name).push(line);
  };
  for (const hit of masked.matchAll(ENV_DOT_RE)) add(hit[1], hit.index);
  for (const hit of masked.matchAll(ENV_DESTRUCTURE_RE)) {
    for (const part of hit[1].split(',')) {
      const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
      if (name) add(name, hit.index);
    }
  }
  for (const re of ENV_QUOTED) {
    for (const hit of masked.matchAll(re)) {
      const lit = literalAt(text, hit.index + hit[0].length, type);
      if (lit) add(lit.value, hit.index);
    }
  }
  return [...seen].sort((a, b) => a[1][0] - b[1][0] || (a[0] < b[0] ? -1 : 1)).slice(0, ENV_MAX);
}

// Indent of a function by its place: 0 at the top of the file, 1 for a method (or a member of an object), one more for
// each function it sits inside.
function depthOf(id, path) {
  const rest = id.slice(`fn:${path}#`.length);
  const chain = rest.split('>');
  return chain.length - 1 + (chain[0].includes('.') ? 1 : 0);
}

export function skeleton({ root, file }) {
  if (typeof root !== 'string' || typeof file !== 'string' || isSecretsFile(file)) return null;
  const type = TYPE_OF[file.split('.').pop().toLowerCase()];
  if (!type) return null;
  const abs = safeResolve(root, file);
  if (!abs || isSecretsFile(abs)) return null;
  let text;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > FILE_MAX) return null;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return null;
    text = buf.toString('utf8');
  } catch {
    return null;
  }
  const path = file.replaceAll('\\', '/').replace(/^\.\//, '');
  const masked = lex(text, type).masked;
  const rows = text.split('\n');
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const { facts } = extract({ path, type, text, masked });
  const lines = [`${path}: ${rows.length} lines, ${Buffer.byteLength(text)} bytes. Signatures only, no bodies: read the lines you need.`];

  // imports: one row per module, with the names it brings in
  const modules = new Map();
  for (const imp of importNames({ path, type, text, masked })) {
    if (!modules.has(imp.spec)) modules.set(imp.spec, { line: imp.line, names: [] });
    const label = imp.imported === '*' ? (imp.name === '*' ? '*' : `* as ${imp.name}`) : imp.imported === 'default' ? imp.name : imp.name === imp.imported ? imp.name : `${imp.imported} as ${imp.name}`;
    modules.get(imp.spec).names.push(label);
  }
  lines.push('', 'imports:');
  if (!modules.size) lines.push('  (none)');
  for (const [spec, m] of [...modules].sort((a, b) => a[1].line - b[1].line)) {
    lines.push(`  ${m.line}: ${spec}${m.names.length ? ` { ${[...new Set(m.names)].join(', ')} }` : ''}`.slice(0, SIGNATURE_MAX));
  }

  const exported = facts.filter((f) => f.kind === 'export').sort((a, b) => a.line - b.line);
  lines.push('', 'exports:');
  if (!exported.length) lines.push(type === 'dart' || type === 'php' ? '  (this language has no export list)' : '  (none)');
  for (const e of exported) lines.push(`  ${e.line}: ${e.name.slice(e.file.length + 1)}${e.attrs?.default ? ' (default)' : ''}`);

  // classes and functions together, in the order of the file
  const entries = [];
  const maskedRows = masked.split('\n');
  rows.forEach((row, i) => {
    if (CLASS_RE.test(maskedRows[i] ?? '')) entries.push({ line: i + 1, depth: 0, order: 0, sig: clip(row) });
  });
  for (const f of facts) {
    if (f.kind !== 'function') continue;
    entries.push({ line: f.line, depth: depthOf(f.id, path), order: 1, sig: clip(rows[f.line - 1] ?? '') });
  }
  entries.sort((a, b) => a.line - b.line || a.order - b.order);
  lines.push('', 'code:');
  if (!entries.length) lines.push('  (no function or class)');
  for (const e of entries) lines.push(`${'  '.repeat(e.depth + 1)}${e.line}: ${e.sig}`);

  const env = envOf(text, masked, type, lineOf);
  lines.push('', 'environment variables read:');
  if (!env.length) lines.push('  (none)');
  for (const [name, at] of env) lines.push(`  ${name} (line ${at.slice(0, 5).join(', ')}${at.length > 5 ? ', ...' : ''})`);
  return lines.join('\n');
}
