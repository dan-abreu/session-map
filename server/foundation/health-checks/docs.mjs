// Health checks, documentation group (fd08): the 10 `docs.*` items. Each check is a pure function of the health context
// (`ctx`, see health-ctx.mjs): it reads files through `ctx.read` only and writes nothing.
// Result: { state: 'pass'|'fail'|'unverified'|'na', evidence: [{file, line?}], reason, detail }.
import { HEALTH_ITEMS } from '../health-items.mjs';
import { docStats } from '../health-find.mjs';
import { appliesTo } from '../health-score.mjs';
import { brokenLinks, headingsOf } from '../mdlinks.mjs';

const LINKS_SHOWN = 20;
const MD_READ_MAX = 400;
const DOC_DIRS = ['', '.github', 'docs'];
const DOC_EXT = /\.(md|markdown|txt|rst)$/i;
const MD_EXT = /\.(md|markdown)$/i;
// A folder with one of these names holds samples and test cases, not the project's own documents.
const SAMPLE_SEGMENTS = new Set(['fixtures', '__fixtures__', 'testdata', 'test', 'tests', 'example', 'examples', 'templates', 'node_modules', 'vendor']);

const lower = (s) => String(s).toLowerCase();
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stemOf = (p) => baseOf(p).replace(/\.[^.]*$/, '');
const isSample = (p) => p.split('/').slice(0, -1).some((s) => SAMPLE_SEGMENTS.has(lower(s)));

const outcome = (state, { evidence = [], reason = null, detail = {} } = {}) => ({ state, evidence, reason, detail });
const pass = (evidence = [], detail = {}) => outcome('pass', { evidence, detail });
const fail = (reason, evidence = [], detail = {}) => outcome('fail', { evidence, reason, detail });

// Paths of the project that are in the census and readable as documents.
const includedPaths = (ctx) => ctx.files.filter((r) => r.included).map((r) => r.path);
const markdownOf = (ctx) => includedPaths(ctx).filter((p) => MD_EXT.test(p) && !isSample(p)).sort();

// Documents in the root, .github and docs (never deeper) whose name starts with one of the prefixes, in that order.
function docsByPrefix(ctx, prefixes) {
  const want = prefixes.map(lower);
  const out = [];
  for (const dir of DOC_DIRS) {
    for (const p of includedPaths(ctx).sort()) {
      if (lower(dirOf(p)) !== dir || !(DOC_EXT.test(p) || !baseOf(p).includes('.'))) continue;
      if (want.some((w) => lower(stemOf(p)).startsWith(w) || lower(baseOf(p)).startsWith(w))) out.push(p);
    }
  }
  return out;
}

// The readable markdown a heading or a diagram can live in: the root documents and everything under docs/.
function proseDocs(ctx) {
  return markdownOf(ctx)
    .filter((p) => !p.includes('/') || lower(p).startsWith('docs/'))
    .slice(0, MD_READ_MAX)
    .map((path) => ({ path, text: ctx.read(path) }))
    .filter((d) => typeof d.text === 'string');
}

// A document with a body worth the name: under `min` non-empty lines it is a stub, not a pass.
function documentCheck(ctx, prefixes, min) {
  const found = docsByPrefix(ctx, prefixes);
  if (!found.length) return null;
  for (const file of found) {
    const text = ctx.read(file);
    if (typeof text === 'string' && docStats(text).lines >= min) return pass([{ file }]);
  }
  return fail('too-short', [{ file: found[0] }]);
}

function headingHit(ctx, re) {
  for (const d of proseDocs(ctx)) {
    const h = headingsOf(d.text).find((x) => re.test(x.text));
    if (h) return { file: d.path, line: h.line };
  }
  return null;
}

function foldersWithFiles(ctx, folders, { minFiles = 1, ignore = () => false } = {}) {
  const want = folders.map(lower);
  const hits = includedPaths(ctx).filter((p) => {
    const d = lower(dirOf(p));
    return want.some((w) => d === w || d.startsWith(`${w}/`)) && !ignore(p);
  }).sort();
  return hits.length >= minFiles ? hits : null;
}

// ---------- the 10 checks ----------

function folder(ctx) {
  const md = includedPaths(ctx).filter((p) => lower(p).startsWith('docs/') && MD_EXT.test(p)).sort();
  if (!md.length) return fail('missing');
  if (md.length < 3) return fail('too-short', [], { count: md.length });
  const nested = md.some((p) => p.slice(5).includes('/'));
  const index = md.some((p) => /^docs\/(readme|index)\.md$/i.test(p));
  if (!nested && !index) return fail('invalid', [], { count: md.length });
  return pass(md.slice(0, 3).map((file) => ({ file })), { count: md.length });
}

const SETUP_HEADING = /install|setup|set up|getting started|quick ?start|running|usage|development|how to run|\brun\b|instala|configura|como (rodar|executar|usar|iniciar)|rodando|executando|primeiros passos|come[cç]ando|desenvolvimento|\buso\b/i;
const COMMAND = /^(?:\$\s*|>\s*|PS>\s*)?(?:npm|npx|pnpm|yarn|bun|node|deno|flutter|dart|php|composer|artisan|docker|docker-compose|make|python3?|pip3?|cargo|go|bundle|rails|dotnet|mvn|gradle|sh|bash|\.\/\S+)\s+\S/;
const FENCE = /^\s*(```|~~~)/;

// Commands only count where code is shown: inside a fence or between backticks, so "make sure ..." in prose is not one.
function hasCommand(lines) {
  let fenced = false;
  for (const raw of lines) {
    if (FENCE.test(raw)) { fenced = !fenced; continue; }
    if (fenced) {
      if (COMMAND.test(raw.trim())) return true;
      continue;
    }
    for (const m of raw.matchAll(/`([^`\n]+)`/g)) if (COMMAND.test(m[1].trim())) return true;
  }
  return false;
}

// A setup section: from its heading to the next one of the same or a higher level.
function setupVerdict(text, wholeDoc) {
  const rows = text.split(/\r?\n/);
  if (wholeDoc) return hasCommand(rows) ? { ok: true, line: null } : { ok: false, line: null, found: false };
  const heads = headingsOf(text);
  let titled = null;
  for (let i = 0; i < heads.length; i++) {
    if (!SETUP_HEADING.test(heads[i].text)) continue;
    const end = heads.slice(i + 1).find((h) => h.level <= heads[i].level)?.line ?? rows.length + 1;
    if (hasCommand(rows.slice(heads[i].line, end - 1))) return { ok: true, line: heads[i].line };
    titled ??= heads[i].line;
  }
  return { ok: false, line: titled, found: titled != null };
}

function setup(ctx) {
  const wholeDoc = docsByPrefix(ctx, ['setup', 'install']);
  const others = docsByPrefix(ctx, ['contributing', 'readme', 'getting_started', 'getting-started']);
  let titled = null;
  for (const [files, whole] of [[wholeDoc, true], [others, false]]) {
    for (const file of files) {
      const text = ctx.read(file);
      if (typeof text !== 'string') continue;
      const v = setupVerdict(text, whole);
      if (v.ok) return pass([v.line ? { file, line: v.line } : { file }]);
      if (v.found && !titled) titled = { file, line: v.line };
      else if (whole && !titled) titled = { file };
    }
  }
  return titled ? fail('too-short', [titled]) : fail('missing');
}

function architecture(ctx) {
  const doc = documentCheck(ctx, ['architecture', 'arquitetura'], 5);
  if (doc?.state === 'pass') return doc;
  const dir = foldersWithFiles(ctx, ['docs/architecture', 'docs/arquitetura', 'docs/arch'], { ignore: (p) => !MD_EXT.test(p) });
  if (dir) return pass([{ file: dir[0] }]);
  for (const d of proseDocs(ctx)) {
    const m = /^[ \t]*(?:```|~~~)[ \t]*mermaid\b/im.exec(d.text);
    if (m) return pass([{ file: d.path, line: d.text.slice(0, m.index).split('\n').length }]);
  }
  return doc ?? fail('missing');
}

const ADR_DIRS = ['docs/decisions', 'docs/adr', 'docs/adrs', 'docs/architecture/decisions', 'docs/architecture/adr', 'doc/adr', 'adr', 'adrs'];

function adrs(ctx) {
  const any = foldersWithFiles(ctx, ADR_DIRS);
  if (!any) return fail('missing');
  const real = any.find((p) => !/^(readme|index|template)\b/i.test(stemOf(p)));
  return real ? pass([{ file: real }]) : fail('too-short', [{ file: any[0] }]);
}

function runbooks(ctx) {
  const dir = foldersWithFiles(ctx, ['runbooks', 'docs/runbooks', 'docs/operacao', 'docs/operations']);
  if (dir) return pass([{ file: dir[0] }]);
  return documentCheck(ctx, ['operacao', 'operações', 'operations', 'runbook'], 5) ?? fail('missing');
}

const SPEC_FILE = /^(openapi|swagger)([._-].*)?\.(json|ya?ml)$/i;
const API_GENERATORS = new Set([
  'fastify-swagger', '@fastify/swagger', '@nestjs/swagger', 'swagger-jsdoc', 'swagger-ui-express', 'express-openapi',
  'tsoa', '@asteasolutions/zod-to-openapi', 'zod-to-openapi', 'fastify-zod-openapi', 'openapi-backend',
  'darkaonline/l5-swagger', 'dedoc/scramble', 'zircote/swagger-php', 'nelmio/api-doc-bundle',
]);

function dependencyNames(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!data || typeof data !== 'object') return [];
  return ['dependencies', 'devDependencies', 'peerDependencies', 'require', 'require-dev']
    .flatMap((k) => (data[k] && typeof data[k] === 'object' ? Object.keys(data[k]) : []));
}

function openapi(ctx) {
  const spec = includedPaths(ctx).sort().find((p) => SPEC_FILE.test(baseOf(p)) && !isSample(p));
  if (spec) return pass([{ file: spec }]);
  for (const pkg of ctx.packages) {
    if (pkg.kind === 'dart') continue;
    const text = ctx.read(pkg.manifest);
    if (typeof text !== 'string') continue;
    const name = dependencyNames(text).find((n) => API_GENERATORS.has(n));
    if (name) return pass([{ file: pkg.manifest }], { name });
  }
  return fail('missing');
}

const DB_DOC = /database|banco|\berd\b|er-diagram|data-model|modelo-de-dados/i;

function database(ctx) {
  const all = includedPaths(ctx).sort();
  const prisma = all.find((p) => lower(baseOf(p)) === 'schema.prisma' && !isSample(p));
  if (prisma) return pass([{ file: prisma }]);
  const migrations = all.find((p) => dirOf(p).split('/').some((s) => lower(s) === 'migrations') && !isSample(p));
  if (migrations) return pass([{ file: migrations }]);
  const doc = all.find((p) => /\.dbml$/i.test(p) || (lower(p).startsWith('docs/') && DOC_EXT.test(p) && DB_DOC.test(baseOf(p))));
  return doc ? pass([{ file: doc }]) : fail('missing');
}

const GLOSSARY_HEADING = /gloss[aá]r(io|y|ies)/i;
const ROADMAP_HEADING = /road\s?map/i;

function glossary(ctx) {
  const file = documentCheck(ctx, ['glossario', 'glossário', 'glossary'], 3);
  if (file?.state === 'pass') return file;
  const head = headingHit(ctx, GLOSSARY_HEADING);
  return head ? pass([head]) : file ?? fail('missing');
}

function roadmap(ctx) {
  const file = documentCheck(ctx, ['roadmap'], 3);
  if (file?.state === 'pass') return file;
  const head = headingHit(ctx, ROADMAP_HEADING);
  return head ? pass([head]) : file ?? fail('missing');
}

function linksValid(ctx) {
  const all = markdownOf(ctx);
  const files = {};
  for (const path of all.slice(0, MD_READ_MAX)) {
    const text = ctx.read(path);
    if (typeof text === 'string') files[path] = text;
  }
  if (!Object.keys(files).length) return outcome('unverified', { reason: all.length ? 'too-big' : 'no-data' });
  const exists = (p) => ctx.has(p) || ctx.list(`${p}/`).length > 0;
  const broken = brokenLinks(files, exists).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  if (broken.length) {
    return fail('invalid', broken.slice(0, LINKS_SHOWN).map((b) => ({ file: b.file, line: b.line })), {
      count: broken.length, shown: Math.min(broken.length, LINKS_SHOWN), target: broken[0].target,
    });
  }
  // Documents beyond the cap were never looked at, so an all-clear would be a guess.
  return all.length > MD_READ_MAX ? outcome('unverified', { reason: 'too-big' }) : pass([], { count: Object.keys(files).length });
}

// ---------- the door ----------

const CHECKS = {
  'docs.folder': folder, 'docs.setup': setup, 'docs.architecture': architecture, 'docs.adrs': adrs,
  'docs.runbooks': runbooks, 'docs.openapi': openapi, 'docs.database': database, 'docs.glossary': glossary,
  'docs.roadmap': roadmap, 'docs.links_valid': linksValid,
};

// An item that does not apply is never charged (the same rule the orchestrator applies): `na` with its reason, or
// `unverified` when only the repository's visibility is unknown.
function guarded(id, check) {
  const item = HEALTH_ITEMS.find((i) => i.id === id);
  return (ctx) => {
    const a = appliesTo(item, ctx);
    return a.applies ? check(ctx) : outcome(a.state, { reason: a.reason });
  };
}

export const DOCS_CHECKS = Object.freeze(Object.fromEntries(Object.entries(CHECKS).map(([id, fn]) => [id, guarded(id, fn)])));
