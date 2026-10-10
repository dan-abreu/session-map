import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { log } from '../log.mjs';

// Optional cross-check tools. Only found on PATH or <root>/node_modules/.bin: never npx, never the network.
// They can only mark a fact AMBIGUOUS; they never replace the program's own count or reading.
const execFileP = promisify(execFile);
const ALLOWED = new Set(['scc', 'depcruise']);
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 20 * 1024 * 1024;

// The real JS behind an npm bin shim: <pkg>/package.json "bin". Kept inside the package folder.
function packageBin(pkgDir, name) {
  try {
    const { bin } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const rel = typeof bin === 'string' ? bin : bin?.[name];
    if (typeof rel !== 'string') return null;
    const script = resolve(pkgDir, rel);
    return script.startsWith(resolve(pkgDir) + sep) && existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

// Since CVE-2024-27980 Node refuses to run .cmd/.bat through execFile without a shell (spawn EINVAL), so on
// Windows only a real .exe is accepted, and depcruise runs as node + its package script, still without a shell.
function defaultWhich(name, dirs, platform = process.platform) {
  for (const dir of dirs) {
    if (platform !== 'win32') {
      const p = join(dir, name);
      if (existsSync(p)) return p;
      continue;
    }
    if (name === 'scc') {
      const p = join(dir, 'scc.exe');
      if (existsSync(p)) return p;
      continue;
    }
    if (!['.cmd', '.ps1', ''].some((ext) => existsSync(join(dir, name + ext)))) continue;
    // node_modules/.bin sits next to the package; the npm global folder on Windows keeps it in node_modules/.
    // Any other PATH folder: its sibling folder has nothing to do with npm, so it is never looked at.
    const inBin = basename(dir).toLowerCase() === '.bin' && basename(dirname(dir)).toLowerCase() === 'node_modules';
    const pkgs = [...(inBin ? [join(dirname(dir), 'dependency-cruiser')] : []), join(dir, 'node_modules', 'dependency-cruiser')];
    for (const pkg of pkgs) {
      const script = packageBin(pkg, name);
      if (script) return { path: process.execPath, pre: [script] };
    }
  }
  return null;
}

// `exec` is accepted (the brief's signature) and never used here: finding a tool runs nothing.
export async function toolOf(name, root, { which, env = process.env, platform = process.platform } = {}) {
  if (!ALLOWED.has(name)) return null;
  try {
    const dirs = [...String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), join(root, 'node_modules', '.bin')];
    const found = which ? await which(name, dirs) : defaultWhich(name, dirs, platform);
    if (!found) return null;
    return typeof found === 'string' ? { name, path: found } : { name, path: found.path, pre: [...(found.pre ?? [])] };
  } catch (e) {
    log('warn', 'optional-which-failed', { name, code: e?.code ?? null });
    return null;
  }
}

export async function runTool(tool, args, root, { exec = execFileP } = {}) {
  try {
    const { stdout } = await exec(tool.path, [...(tool.pre ?? []), ...args], { cwd: root, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true });
    return JSON.parse(stdout);
  } catch (e) {
    // depcruise exits non-zero when the project's own rules find violations, yet still prints the full JSON.
    if (typeof e?.code === 'number' && String(e.stdout ?? '').trim()) {
      try { return JSON.parse(e.stdout); } catch { /* not JSON: a real failure */ }
    }
    // Only the code: e.message carries the full command line (user paths) and the tool's stderr.
    log('warn', 'optional-run-failed', { tool: tool.name, code: e?.code ?? e?.signal ?? null, killed: !!e?.killed });
    return null;
  }
}

// The one flow callers use: find the tool, run it if present; absent → null and nothing is executed.
export async function runOptional(name, root, args, { exec, which, env, platform } = {}) {
  const tool = await toolOf(name, root, { which, env, platform });
  return tool ? runTool(tool, args, root, { exec }) : null;
}

const norm = (p) => String(p).replace(/[\\]/g, '/').replace(/^\.\//, '');
const counts = (f) => ({ total: f.Lines, code: f.Code, comment: f.Comment, blank: f.Blank });

// scc --by-file --format json → Map<path, {total, code, comment, blank}>
export function sccTotals(json) {
  const out = new Map();
  if (!Array.isArray(json)) return out;
  for (const lang of json) for (const f of lang?.Files ?? []) if (f?.Location) out.set(norm(f.Location), counts(f));
  return out;
}

const outside = (d) => d.coreModule || d.couldNotResolve
  || (d.dependencyTypes ?? []).some((t) => t === 'core' || String(t).startsWith('npm'));

// depcruise --output-type json → [{from, to}] between project files only
export function depcruiseLinks(json) {
  const out = [];
  for (const m of json?.modules ?? []) for (const d of m.dependencies ?? []) {
    const to = d.resolved && norm(d.resolved);
    if (!to || to.startsWith('node_modules/') || to.includes('/node_modules/') || outside(d)) continue;
    out.push({ from: norm(m.source), to });
  }
  return out;
}

// Every file depcruise analysed, including the ones where it found no dependency at all.
export function depcruiseSources(json) {
  return new Set((json?.modules ?? []).filter((m) => m?.source && !m.couldNotResolve && !m.coreModule).map((m) => norm(m.source)));
}

// Only total and blank: code = total - comment - blank, and scc classifies comments differently from our lexer.
export function crossCheck(census, scc) {
  const out = [];
  for (const f of census?.files ?? []) {
    if (!f.included || !f.lines) continue;
    const theirs = scc.get(f.path);
    if (!theirs) continue;
    const own = { total: f.lines.total, code: f.lines.code, comment: f.lines.comment, blank: f.lines.blank };
    if (own.total !== theirs.total || own.blank !== theirs.blank) out.push({ path: f.path, own, scc: theirs });
  }
  return out;
}

// `sources` (depcruiseSources) also counts analysed files without links; without it only link origins count.
export function crossCheckImports(facts, links, sources) {
  const key = (l) => `${l.from}->${l.to}`;
  const theirs = new Set(links.map(key));
  const toolFiles = new Set([...links.map((l) => l.from), ...(sources ?? [])]);
  const known = new Set(Object.keys(facts?.files ?? {}));
  // Library imports never show up in depcruise links (npm/core are filtered), so they are not comparable.
  const ours = (facts?.facts ?? []).filter((f) => f.kind === 'import' && typeof f.id === 'string' && !f.attrs?.library)
    .map((f) => { const [from, to] = f.id.slice('import:'.length).split('->'); return { from, to }; })
    .filter((l) => known.has(l.to));
  const oursSet = new Set(ours.map(key));
  return {
    onlyOurs: ours.filter((l) => toolFiles.has(l.from) && !theirs.has(key(l))),
    onlyTool: links.filter((l) => known.has(l.from) && !oursSet.has(key(l))),
  };
}

export function markDivergent(facts, { onlyOurs }) {
  const bad = new Set(onlyOurs.map((l) => `import:${l.from}->${l.to}`));
  return { ...facts, facts: facts.facts.map((f) => (bad.has(f.id) ? { ...f, origin: 'AMBIGUOUS' } : f)) };
}
