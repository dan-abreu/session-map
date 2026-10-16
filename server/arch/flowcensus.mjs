// The functions census (fl16): a mechanical walk over a project's own modules that says, for every
// function, which part of the architecture owns it, what it is for (its opening comment), and who is
// responsible: a script (plain code), a bot (runs on its own: loops, timers, watchers, robots) or the AI
// (it calls the model or spawns a chat). No AI reads a line: facts only, cached per file version.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { log } from '../log.mjs';

const IMPORT_RE = /(?:import|export\s+\{)[^'"]*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.claude', '.dsh', 'demo']);
const KNOWN_BOTS = new Set(['alerts/watcher.mjs', 'background.mjs', 'restart.mjs', 'arch/clerk.mjs', 'arch/livemark.mjs']);
const PURPOSE_MAX = 240;

const norm = (root, p) => relative(root, p).replaceAll('\\', '/');

// One file, read once per version: path, its imports, the first comment's words and who is responsible.
function readModule(root, file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'census-read-failed', { path: file, code: err.code });
    return null;
  }
  const imports = new Set();
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec?.startsWith('.')) continue;
    for (const c of [resolve(dirname(file), spec), `${resolve(dirname(file), spec)}.mjs`, `${resolve(dirname(file), spec)}.js`, join(resolve(dirname(file), spec), 'index.mjs'), join(resolve(dirname(file), spec), 'index.js')]) {
      const n = norm(root, c);
      if (n.startsWith('..')) continue;
      try { if (statSync(join(root, n), { throwIfNoEntry: false })?.isFile()) { imports.add(n); break; } } catch { /* not there */ }
    }
  }
  for (const m of text.matchAll(DYNAMIC_RE)) {
    if (!m[1]?.startsWith('.')) continue;
    const n = norm(root, resolve(dirname(file), m[1]));
    if (!n.startsWith('..')) imports.add(n);
  }
  const head = text.slice(0, 8000);
  const owner = (() => {
    const n = norm(root, file);
    if (KNOWN_BOTS.has(n)) return 'bot';
    // AI: calls the model (the ai/ helpers) or drives the claude process that talks to it.
    const importsAi = [...imports].some((t) => t.startsWith('server/ai/'));
    if (importsAi || n === 'server/chat/driver.mjs' || n === 'server/chat/hub.mjs') return 'ai';
    if (/setInterval|setTimeout|watchFile|\.watch\(/.test(head) || /(^|\/)(watcher|background|orchestra|clerk|sweep|restart|livemark)(\.|\/)/.test(n)) return 'bot';
    return 'script';
  })();
  return { path: norm(root, file), imports: [...imports], owner, purpose: purposeOf(text) };
}

// The first sentence(s) of the file's opening comment: what the function is for, in its own words.
function purposeOf(text) {
  const line = /^(?:\/\/|#)\s*(.+)$/m.exec(text.slice(0, 2000));
  if (line) return cut(line[1]);
  const block = /^\/\*\*?\s*\n?\s*\*?\s*([\s\S]*?)\*\//.exec(text.slice(0, 2000));
  if (block) {
    const words = block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
    return cut(words);
  }
  return '';
}

const cut = (s) => {
  const first = String(s).split(/(?<=[.!?])\s+/)[0] ?? String(s);
  return first.length > PURPOSE_MAX ? `${first.slice(0, PURPOSE_MAX - 1)}…` : first;
};

// Every module of the project (its own code only), below the given folders.
function walkModules(root) {
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|cjs)$/.test(e.name) && !e.name.includes('.test.')) files.push(p);
    }
  };
  for (const top of ['server', 'scripts', 'skills', 'hooks']) walk(join(root, top));
  return files;
}

// Each part's "Where in the code" list, as {file|folder} claims; docs/architecture/<part>.md.
function partClaims(archDir, parts) {
  const claims = new Map(); // prefix -> partId
  for (const part of parts) {
    let text = '';
    try { text = readFileSync(join(archDir, part), 'utf8'); } catch { continue; }
    const m = /^## Where in the code\s*\n([\s\S]*?)(?=^## |\Z)/m.exec(text);
    if (!m) continue;
    for (const line of m[1].split('\n')) {
      const b = /^\s*[-*]\s+`?([^`\n]+)`?(?:\s+\(|$)/.exec(line);
      if (!b) continue;
      const key = b[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (key.startsWith('http') || !key) continue;
      if (!claims.has(key) || claims.get(key).length < part.length) claims.set(key, part.replace(/\.md$/, ''));
    }
  }
  return claims;
}

// The parts of the project: the architecture files, from the folder the config says (or the known names).
function archParts(root, archDir) {
  let entries = [];
  try { entries = readdirSync(archDir); } catch { return []; }
  return entries.filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
}

const partOf = (claims, path) => {
  let best = null;
  let bestLen = -1;
  for (const [prefix, part] of claims) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      if (prefix.length > bestLen) { bestLen = prefix.length; best = part; }
    }
  }
  return best;
};

// Cached per file version, because the model builds again on every state change.
const memo = new Map();
function moduleOf(root, file) {
  try {
    const st = statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = memo.get(file);
    if (hit?.key === key) return hit.value;
    const value = readModule(root, file);
    memo.set(file, { key, value });
    return value;
  } catch {
    return null;
  }
}

// → { functions: [{path, part, owner, purpose, imports}], orphans: [{path, owner, purpose}], byPart: Map }
export function censusOf(root, archDir) {
  const parts = archParts(root, archDir);
  const claims = partClaims(archDir, parts);
  const functions = [];
  const orphans = [];
  for (const file of walkModules(root)) {
    const mod = moduleOf(root, file);
    if (!mod) continue;
    const part = partOf(claims, mod.path);
    const fn = { path: mod.path, part, owner: mod.owner, purpose: mod.purpose, imports: mod.imports };
    functions.push(fn);
    if (!part) orphans.push(fn);
  }
  const byPart = new Map();
  for (const fn of functions) {
    if (!fn.part) continue;
    if (!byPart.has(fn.part)) byPart.set(fn.part, []);
    byPart.get(fn.part).push(fn);
  }
  return { functions: functions.sort((a, b) => a.path.localeCompare(b.path)), orphans, byPart, parts };
}
