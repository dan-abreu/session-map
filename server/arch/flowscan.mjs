// Reads one file for the Flow's general view (flow.md fl08): which programs it runs, which outside hosts and SDKs it
// reaches, whether it serves a page, which screens it shows and what it imports, each with its line. Pure and exact like
// the foundation's extractors: patterns run on the text with comments and string contents blanked by lex() (once per
// file, handed to the extractor too), values are read back from the real text, and nothing is executed: a command, a URL
// or a package name is only matched as a string. Only file and line leave this module, never a value of the file, so a
// secret written in code cannot travel into the model.
import { lex, lineAt, literalAt } from '../foundation/lex.mjs';
import * as dartX from '../foundation/extract/dart.mjs';
import * as jsX from '../foundation/extract/js.mjs';
import * as phpX from '../foundation/extract/php.mjs';
import { specifiersIn } from '../imports.mjs';
import { SERVICES, serviceOf } from './flowcatalog.mjs';

export const VERSION = 'flowscan@1';
export const EXTRACTORS = { js: jsX.VERSION, dart: dartX.VERSION, php: phpX.VERSION };

const JS_TYPES = new Set(jsX.TYPES);
const EXTRACTOR_OF = { js: jsX, ts: jsX, tsx: jsX, jsx: jsX, dart: dartX, php: phpX, blade: phpX };
const LAUNCHERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'];
const LAUNCHER_ALT = LAUNCHERS.join('|');
const SIGNALS_MAX = 200;
const SCREEN_FRAMEWORKS = new Set(['next-app', 'next-pages', 'flutter']);
const COMMANDS = new Set(SERVICES.flatMap((s) => s.commands));
// Flags no other program takes: a file passing one, with its value, builds a command line for the Claude CLI, whatever
// the path of the program it runs (found at run time, so never a literal). A flag followed by another flag or by the end
// of a list is data about flags, not a command line.
const CLAUDE_CLI_FLAGS = new Set(['--permission-prompt-tool', '--append-system-prompt']);

const esc = (s) => s.replace(/[$]/g, '\\$');

// A program name as a command line writes it: no folder, no .exe/.cmd/.bat, lower case. null for anything else.
function commandName(value) {
  const base = String(value).trim().split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  return /^[a-z0-9][\w.+-]*$/.test(base) ? base : null;
}

// The literal (whole) that starts at the first non-blank offset from `at`, or null.
function literalFrom(text, masked, at) {
  let i = at;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (!/['"`]/.test(masked[i] ?? '')) return null;
  const lit = literalAt(text, i);
  return lit ? { ...lit, at: i } : null;
}

// The program a launcher's first argument names. execFile/spawn take the bare program (its path may hold spaces);
// exec/execSync take a shell line, so 'git rev-parse HEAD' and `git log -1 ${x}` count by their first word. A template
// counts only when its text before the first ${ already holds that whole first word: `${bin} status` and `gh${x}` do not.
function programFrom(text, masked, at) {
  const lit = literalFrom(text, masked, at);
  if (lit) {
    const whole = commandName(lit.value);
    return whole ? { name: whole, at: lit.at } : { name: commandName(lit.value.trim().split(/\s+/)[0] ?? ''), at: lit.at };
  }
  let i = at;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (masked[i] !== '`') return null;
  const dollar = text.indexOf('${', i + 1);
  const close = masked.indexOf('`', i + 1);
  if (dollar < 0 || (close >= 0 && close < dollar)) return null;
  const word = /^\s*(\S+)\s/.exec(text.slice(i + 1, dollar));
  return word ? { name: commandName(word[1]), at: i } : null;
}

// Names bound to a launcher in this file: the launchers themselves, `const run = promisify(execFile)`, `{ spawner = spawn }`
// and `x = execFile` (not a call).
function launcherNames(masked) {
  const names = new Set(LAUNCHERS);
  for (const m of masked.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*(?:promisify\\s*\\(\\s*)?(?:${LAUNCHER_ALT})\\b(?!\\s*\\()`, 'g'))) names.add(m[1]);
  for (const m of masked.matchAll(new RegExp(`\\b(?:${LAUNCHER_ALT})\\s+as\\s+([A-Za-z_$][\\w$]*)`, 'g'))) names.add(m[1]);
  return names;
}

function commandSignals(text, masked, push) {
  const names = launcherNames(masked);
  const alt = [...names].map(esc).join('|');
  // name('git', …) and child_process.execFile('git', …)
  for (const m of masked.matchAll(new RegExp(`(?<![\\w$])(?:${alt})\\s*\\(`, 'g'))) {
    // re.exec('x') is a regular expression, not a program: a member call counts only on child_process itself
    const receiver = /([\w$]+)\s*\.\s*$/.exec(masked.slice(Math.max(0, m.index - 40), m.index));
    if (receiver && !/^(?:child_?process|cp|childProcess|proc)$/i.test(receiver[1])) continue;
    const prog = programFrom(text, masked, m.index + m[0].length);
    if (prog) push('command', prog.name, m.index);
  }
  // helper(spawner, 'powershell.exe', …): a launcher handed on with the program next to it
  for (const m of masked.matchAll(new RegExp(`[(,]\\s*(?:${alt})\\s*,`, 'g'))) {
    const prog = programFrom(text, masked, m.index + m[0].length);
    if (prog) push('command', prog.name, prog.at);
  }
  // { file: 'osascript', args: [...] }: a command spelled as data for execFile
  for (const m of masked.matchAll(/(?<![\w$])file\s*:\s*/g)) {
    const lit = literalFrom(text, masked, m.index + m[0].length);
    if (lit && /^\s*,\s*args\s*:/.test(masked.slice(lit.end, lit.end + 40))) push('command', commandName(lit.value), m.index);
  }
  // ['claude', '--resume', id]: an argv list, its second word a flag
  for (const m of masked.matchAll(/\[\s*(?=['"])/g)) {
    const first = literalFrom(text, masked, m.index + 1);
    if (!first || first.value.startsWith('-')) continue;
    const comma = /^\s*,\s*/.exec(masked.slice(first.end, first.end + 20));
    if (!comma) continue;
    const second = literalFrom(text, masked, first.end + comma[0].length);
    if (second && /^-{1,2}[a-z]/i.test(second.value)) push('command', commandName(first.value), first.at);
  }
}

// Every literal whose opening quote is code (not inside a comment): [{ value, at, end }]; a template is read up to its
// first ${ as a prefix.
function* literalsOf(text, masked) {
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c !== "'" && c !== '"' && c !== '`') continue;
    const lit = literalAt(text, i);
    if (lit) {
      yield { value: lit.value, at: i, end: lit.end, whole: true };
      i = lit.end - 1;
      continue;
    }
    const close = masked.indexOf(c, i + 1);
    if (c === '`') {
      const dollar = text.indexOf('${', i + 1);
      if (dollar > 0 && (close < 0 || dollar < close)) yield { value: text.slice(i + 1, dollar), at: i, end: close < 0 ? masked.length : close + 1, whole: false };
    }
    if (close < 0) break;
    i = close;
  }
}

function hostOf(value) {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

function literalSignals(text, masked, push) {
  for (const lit of literalsOf(text, masked)) {
    const v = lit.value;
    // a link being built has more than the scheme: `vscode://file/${p}`; startsWith('vscode://') only compares
    if (v.startsWith('vscode://') && v.length > 'vscode://'.length) push('literal', 'vscode-url', lit.at);
    if (!lit.whole) continue;
    if (CLAUDE_CLI_FLAGS.has(v)) {
      const next = /^\s*,\s*(\S)/.exec(masked.slice(lit.end, lit.end + 40));
      const value = next ? literalFrom(text, masked, lit.end + next[0].length - 1) : null;
      if (next && !(value && value.value.startsWith('--'))) push('literal', 'claude-cli', lit.at);
    }
    if (v === 'index.html' || /\btext\/html\b/.test(v)) push('html', 'page', lit.at);
    if (v === '0.0.0.0') push('bind-all', '0.0.0.0', lit.at);
    if (/^[\w.-]+\.exe$/i.test(v)) push('command', commandName(v), lit.at);
    if (v === '.claude' && /homedir\s*\(\s*\)\s*,\s*$/.test(masked.slice(Math.max(0, lit.at - 40), lit.at))) {
      const next = /^\s*,\s*/.exec(masked.slice(lit.end, lit.end + 10));
      const after = next ? literalFrom(text, masked, lit.end + next[0].length) : null;
      push('literal', 'claude-home', lit.at, after ? { next: after.value } : {});
    }
  }
  // const API = 'https://api.github.com': a catalog host kept in a constant counts when the constant is used again.
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?=['"`])/g)) {
    const lit = literalFrom(text, masked, m.index + m[0].length);
    const host = lit ? hostOf(lit.value) : null;
    const svc = host ? serviceOf({ type: 'host', value: host }) : null;
    if (!svc || svc.generic) continue;
    const uses = masked.match(new RegExp(`(?<![\\w$.])${esc(m[1])}(?![\\w$])`, 'g'))?.length ?? 0;
    if (uses > 1) push('host', host, lit.at, { via: 'literal' });
  }
}

// The names an import brings, by its line and module: { 'line\0spec': { names, typeOnly } }.
function importNames(text, masked) {
  const out = new Map();
  const add = (at, clause, typeOnly) => {
    const lit = literalAt(text, at);
    if (!lit) return;
    const names = [];
    let rest = clause ?? '';
    const ns = /\*\s*as\s+[\w$]+/.exec(rest);
    if (ns) { names.push('*'); rest = rest.replace(ns[0], ''); }
    const braces = /\{([^}]*)\}/.exec(rest);
    if (braces) {
      for (const item of braces[1].split(',')) {
        const n = /^\s*(type\s+)?([\w$]+)/.exec(item);
        if (n && !n[1]) names.push(n[2]);
      }
      rest = rest.replace(braces[0], '');
    }
    if (/^\s*[\w$]+\s*,?\s*$/.test(rest)) names.unshift('default');
    out.set(`${lineAt(text, at)}\0${lit.value}`, { names, typeOnly });
  };
  for (const m of masked.matchAll(/\bimport\s+(type\s+)?([^'";`()]*?)\s*\bfrom\s*(?=['"])/g)) add(m.index + m[0].length, m[2], Boolean(m[1]));
  for (const m of masked.matchAll(/\bexport\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(?=['"])/g)) add(m.index + m[0].length, m[2], Boolean(m[1]));
  return out;
}

function importsOf(path, type, text, masked) {
  const specs = specifiersIn(text, path);
  if (!JS_TYPES.has(type)) return specs.map(({ spec, line }) => ({ spec, line, names: [] }));
  const named = importNames(text, masked);
  const out = [];
  for (const { spec, line } of specs) {
    const n = named.get(`${line}\0${spec}`);
    if (n?.typeOnly) continue;
    out.push({ spec, line, names: n?.names ?? [] });
  }
  return out;
}

function extractorSignals(path, type, text, masked, workspace, files, push) {
  const x = EXTRACTOR_OF[type];
  if (!x) return;
  let facts = [];
  try {
    ({ facts } = x.extract({ path, type, text, masked, workspace, files }));
  } catch { return; }
  for (const f of facts) {
    if (f.kind === 'integration' && f.attrs?.via === 'sdk') push('sdk', f.attrs.package, null, { line: f.line, via: 'sdk' });
    else if (f.kind === 'integration' && f.attrs?.via === 'url') push('host', f.attrs.host, null, { line: f.line, via: 'url' });
    else if (f.kind === 'env') push('env', f.name, null, { line: f.line, via: 'env' });
    else if (f.kind === 'screen' && SCREEN_FRAMEWORKS.has(f.attrs?.framework)) {
      push('screen', f.attrs.route ?? f.attrs.widget ?? f.name, null, { line: f.line, via: 'screen', app: f.id.split(':')[1] ?? '', route: f.attrs.route ?? null });
    }
  }
}

// Words in the code itself (not in strings or comments) that say what the file's commands are for.
const tagsOf = (masked) => [/toast|notif/i.test(masked) ? 'toast' : null, /terminal/i.test(masked) ? 'terminal' : null].filter(Boolean);

// file: { path, type (census type), text, masked?, workspace?, files? } → { signals: [{ type, value, line, via, … }], imports }.
export function scanFile({ path, type, text, masked, workspace, files }) {
  const body = masked ?? lex(text, type).masked;
  const signals = [];
  const seen = new Set();
  const push = (kind, value, at, extra = {}) => {
    if (!value || signals.length >= SIGNALS_MAX) return;
    // only the programs the catalog knows are kept: `git(root, ['ls-files', '-z'])` is not a program called ls-files
    if (kind === 'command' && !COMMANDS.has(value)) return;
    const line = extra.line ?? lineAt(text, at);
    const k = `${kind}\0${value}\0${line}`;
    if (seen.has(k)) return;
    seen.add(k);
    signals.push({ type: kind, value, line, via: kind, ...extra, line });
  };
  if (JS_TYPES.has(type)) {
    const tags = tagsOf(body);
    commandSignals(text, body, (kind, value, at) => push(kind, value, at, tags.length ? { tags } : {}));
    literalSignals(text, body, (kind, value, at, extra) => push(kind, value, at, kind === 'command' && tags.length ? { tags, ...extra } : extra));
    for (const m of body.matchAll(/\.\s*listen\s*\(/g)) push('listen', 'listen', m.index);
  }
  extractorSignals(path, type, text, body, workspace, files, push);
  signals.sort((a, b) => a.line - b.line || a.type.localeCompare(b.type));
  return { signals, imports: importsOf(path, type, text, body) };
}

// The 1-based line of the first `"key"` from `from` on, or 1.
function jsonLine(text, needle, from = 0) {
  const at = text.indexOf(needle, from);
  return at < 0 ? 1 : lineAt(text, at);
}

const parseJson = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const relFile = (p) => String(p).replaceAll('\\', '/').replace(/^\.\//, '');

// package.json: the package's name, its bin entries and its dependencies, each with a line.
export function scanPackageJson(text) {
  const json = parseJson(text);
  if (!json || typeof json !== 'object') return { name: null, bin: [], deps: [] };
  const binAt = text.indexOf('"bin"');
  const bin = [];
  if (typeof json.bin === 'string') bin.push({ file: relFile(json.bin), line: jsonLine(text, '"bin"') });
  else if (json.bin && typeof json.bin === 'object') {
    for (const [name, file] of Object.entries(json.bin)) if (typeof file === 'string') bin.push({ file: relFile(file), line: jsonLine(text, `"${name}"`, Math.max(0, binAt)) });
  }
  const deps = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const at = text.indexOf(`"${field}"`);
    for (const name of Object.keys(json[field] && typeof json[field] === 'object' ? json[field] : {})) deps.push({ name, line: jsonLine(text, `"${name}"`, Math.max(0, at)) });
  }
  return { name: typeof json.name === 'string' ? json.name : null, bin, deps };
}

// hooks/hooks.json: the scripts its commands run, as paths inside the plugin (${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs → scripts/x.mjs).
export function scanHooks(text) {
  const json = parseJson(text);
  if (!json || typeof json !== 'object') return [];
  const commands = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === 'command' && typeof x === 'string' ? commands.push(x) : walk(x));
  };
  walk(json);
  const out = [];
  for (const cmd of commands) {
    for (const m of cmd.matchAll(/(?:\$\{?CLAUDE_PLUGIN_ROOT\}?[\\/])?([\w./\\-]+\.(?:mjs|cjs|js|ts|sh|py|ps1))/g)) {
      const file = relFile(m[1]);
      if (file.startsWith('/') || file.includes('..')) continue;
      out.push({ file, line: jsonLine(text, m[1]) });
    }
  }
  return out;
}

// pubspec.yaml and composer.json: the dependencies they list, each with its line.
export function scanManifest(path, text) {
  const name = path.split('/').pop().toLowerCase();
  if (name === 'package.json') return scanPackageJson(text);
  if (name === 'composer.json') {
    const json = parseJson(text);
    const deps = [];
    for (const field of ['require', 'require-dev']) {
      const at = text.indexOf(`"${field}"`);
      for (const dep of Object.keys(json?.[field] && typeof json[field] === 'object' ? json[field] : {})) deps.push({ name: dep, line: jsonLine(text, `"${dep}"`, Math.max(0, at)) });
    }
    return { name: typeof json?.name === 'string' ? json.name : null, deps };
  }
  if (name === 'pubspec.yaml') {
    const deps = [];
    let inDeps = false;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\S/.test(line)) inDeps = /^dependencies\s*:/.test(line);
      else if (inDeps) {
        const m = /^ {2}([A-Za-z_][\w]*)\s*:/.exec(line);
        if (m) deps.push({ name: m[1], line: i + 1 });
      }
    });
    return { name: /^name:\s*['"]?([\w.-]+)/m.exec(text)?.[1] ?? null, deps };
  }
  return { name: null, deps: [] };
}
