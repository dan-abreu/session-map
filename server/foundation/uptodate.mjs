// The "Everything up to date?" panel (fd07): buildCtx reads what the lines need (the only part that touches disk and git),
// buildUptodate runs the 35 lines on it (pure) and answers the document of contract 7. Nothing here asks an AI and
// nothing is written in the project: the panel only goes to brain/<id>/foundation/uptodate.json.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readModelCache } from '../arch/flowmodel.mjs';
import { FILE_MAX, isSecretsFile, safeResolve } from '../files.mjs';
import { log } from '../log.mjs';
import { runGit } from '../sources/gitqueue.mjs';
import { workingTree } from '../sources/git.mjs';
import { readCare } from './care.mjs';
import { readDocs } from './docwatch.mjs';
import { isFixturePath } from './health-ctx.mjs';
import { brokenLinks } from './mdlinks.mjs';
import { linesModelOf } from './modelview.mjs';
import { readFd, writeFd } from './store.mjs';
import { LINES, runLine } from './uptodate-lines.mjs';

const FILE = 'uptodate.json';
const GIT_TIMEOUT_MS = 10_000;
// ponytail: a spec or a translation file over this size is not read; the line then says "no data" instead of stalling a round.
const SPEC_MAX = 512 * 1024;
const LOCALE_RE = /(^|\/)(locales|messages)\/[^/]+\.json$/;
const SPEC_RE = /^(openapi|swagger)[^/]*\.(json|ya?ml)$/i;
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const iso = (now) => (typeof now === 'string' ? now : new Date(typeof now === 'function' ? now() : (now ?? Date.now())).toISOString());

function readText(root, path, max = FILE_MAX) {
  if (isSecretsFile(path)) return null;
  const abs = safeResolve(root, path);
  if (!abs || isSecretsFile(abs)) return null;
  try {
    return statSync(abs).size <= max ? readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
}

// [{ method, path }] of an OpenAPI/Swagger file: JSON by parsing, YAML by the two indents the format fixes for `paths:`.
export function specRoutes(text, name) {
  const out = [];
  if (/\.json$/i.test(name)) {
    let doc;
    try { doc = JSON.parse(text); } catch { return null; }
    for (const [path, item] of Object.entries(doc?.paths ?? {})) {
      for (const method of Object.keys(item ?? {})) if (METHODS.has(method.toLowerCase())) out.push({ method: method.toUpperCase(), path });
    }
    return out;
  }
  let inPaths = false;
  let path = null;
  let found = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) { inPaths = /^paths\s*:/.test(line); found ||= inPaths; path = null; continue; }
    if (!inPaths) continue;
    const key = /^["']?([^"':]+)["']?\s*:/.exec(line)?.[1];
    if (!key) continue;
    if (key.startsWith('/')) path = key;
    else if (path && METHODS.has(key.toLowerCase()) && indent > 2) out.push({ method: key.toUpperCase(), path });
  }
  return found ? out : null;
}

async function gitState(root) {
  const run = (args) => runGit(root, args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  const inside = await run(['rev-parse', '--is-inside-work-tree']);
  if (inside.err || inside.stdout.trim() !== 'true') return null;
  const ahead = await run(['rev-list', '--count', '@{upstream}..HEAD']);
  const n = Number.parseInt(ahead.stdout, 10);
  return { uncommitted: await workingTree(root), ahead: ahead.err || Number.isNaN(n) ? null : n };
}

// Which of the project's own files exist, for the links of the documents. The census knows every tracked file.
function existsIn(root, census) {
  const files = new Set((census?.files ?? []).map((f) => f.path));
  const dirs = new Set();
  for (const p of files) for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i));
  return (p) => files.has(p) || dirs.has(p) || (() => {
    const abs = safeResolve(root, p);
    return abs ? existsSync(abs) : false;
  })();
}

// The context of contract "UptodateCtx" (bloco-3c). A file not written yet is null; the lines turn null into unverified.
export async function buildCtx(root, smDir, id, project, { now } = {}) {
  const read = (name) => readFd(smDir, id, name, null);
  const census = read('census.json');
  const findings = read('findings.json');
  const ctx = {
    project, census,
    ledger: read('read-ledger.json'), facts: read('facts.json'), model: linesModelOf(readModelCache(smDir, id)?.model, census),
    versions: read('versions.json'), health: read('health.json'), inspection: read('inspection.json'),
    findings: Array.isArray(findings?.findings) ? findings.findings.filter((f) => ['open', 'later', 'accepted'].includes(f.state ?? 'open')) : null,
    docs: null, brokenLinks: null, git: null, care: readCare(smDir, id), now: iso(now),
    apiSpecs: null, localeFiles: null,
  };
  if (!Array.isArray(census?.files) || typeof root !== 'string') return ctx;
  // The documents of a fixture repository describe a made-up project: its broken links and its variables are not ours.
  const docs = readDocs(root, census).docs.filter((d) => !isFixturePath(d.path));
  ctx.docs = docs;
  ctx.brokenLinks = brokenLinks(Object.fromEntries(docs.map((d) => [d.path, d.text])), existsIn(root, census));
  ctx.git = await gitState(root);
  const included = census.files.filter((f) => f.included !== false);
  ctx.localeFiles = included.filter((f) => LOCALE_RE.test(f.path)).map((f) => ({ path: f.path, text: readText(root, f.path, SPEC_MAX) })).filter((f) => f.text !== null);
  const specs = [];
  for (const f of included.filter((x) => SPEC_RE.test(x.path.split('/').pop()))) {
    const text = readText(root, f.path, SPEC_MAX);
    const routes = text === null ? null : specRoutes(text, f.path);
    if (routes) specs.push({ path: f.path, routes });
  }
  ctx.apiSpecs = specs.length ? specs : null;
  return ctx;
}

// ctx -> the document of contract 7. `lines` is only for the tests that prove a broken line does not stop the others.
export function buildUptodate(ctx, { lines = LINES } = {}) {
  const at = iso(ctx?.now);
  return {
    version: 1,
    generatedAt: at,
    lines: lines.map((line) => {
      const out = runLine(line, ctx ?? {});
      return { id: line.id, group: line.group, state: out.state, evidence: out.evidence, reason: out.reason, findingIds: out.findingIds, detail: out.detail, checkedAt: at };
    }),
  };
}

export function readUptodate(smDir, id) {
  const doc = readFd(smDir, id, FILE, null);
  return doc && Array.isArray(doc.lines) ? doc : null;
}

// One round of the panel: read, judge, store. A failure to read leaves the last panel as it was.
export async function runUptodate(project, smDir, { now } = {}) {
  try {
    const ctx = await buildCtx(project.root, smDir, project.id, project, { now });
    const doc = buildUptodate(ctx);
    writeFd(smDir, project.id, FILE, doc);
    return doc;
  } catch (err) {
    log('warn', 'uptodate-failed', { projectId: project?.id, error: err.message });
    return null;
  }
}
