// "Everything up to date?" lines of group 1 (code <-> map <-> flow) and group 4 (variables). Each line is a pure
// function of the context built by uptodate.mjs and answers { state, evidence, reason, findingIds, detail }.
// Missing input is never a warning: it is unverified/no-data. A confirmed line always says what was checked.
// Variables are NAMES only; no value is ever read or kept.
import { matchParts, parseFlow } from '../web/flow.js';
import { SYSTEM_VARS, isSamplePath } from './health-ctx.mjs';

// ponytail: a line shows at most 5 pieces of evidence so uptodate.json stays small on a big project; the count is in detail.params.
const EVIDENCE_MAX = 5;
// An import between two parts is "strong" from this many pieces of evidence (summed over the model's edges between them).
const STRONG_IMPORTS = 3;
const PENDING = new Set(['open', 'later', 'accepted']);
const NO_ROLE = (p) => p.role !== 'requests' && p.role !== 'operation'; // those parts are not drawn as boxes of the program
const CONFIG_HEADING = /\b(config\w*|environment|env|variables?|vari[aá]veis|settings|ambiente)\b/i;
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const GLOB_CHARS = /[*?[{]/;

const detail = (id, kind, params = {}) => ({ msg: `uptodate.${id}.${kind}`, params });
const confirmed = (id, evidence, params) => ({ state: 'confirmed', evidence: evidence.slice(0, EVIDENCE_MAX), reason: null, findingIds: [], detail: detail(id, 'ok', params) });
const warning = (id, evidence, findingIds, params) => ({ state: 'warning', evidence: evidence.slice(0, EVIDENCE_MAX), reason: null, findingIds, detail: detail(id, 'warn', params) });
const unverified = (id, reason) => ({ state: 'unverified', evidence: [], reason, findingIds: [], detail: detail(id, 'unverified') });

const listOf = (v) => (Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : []);
const findingsBy = (ctx, rules, keep = () => true) => listOf(ctx.findings).filter((f) => rules.includes(f.rule) && PENDING.has(f.state ?? 'open') && keep(f));

const indexes = new WeakMap();
function censusIndex(census) {
  let ix = indexes.get(census);
  if (ix) return ix;
  const files = census.files ?? [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const dirs = new Set();
  for (const f of files) {
    for (let i = f.path.indexOf('/'); i !== -1; i = f.path.indexOf('/', i + 1)) dirs.add(f.path.slice(0, i));
  }
  ix = { byPath, dirs };
  indexes.set(census, ix);
  return ix;
}
const shaOf = (ctx, path) => (ctx.census ? censusIndex(ctx.census).byPath.get(path)?.sha ?? null : null);
const at = (ctx, file, line, extra = {}) => ({ file, line, sha: shaOf(ctx, file), ...extra });
const factEvidence = (f) => ({ file: f.file, line: f.line ?? null, sha: f.sha ?? null, factId: f.id });
const lineOf = (docs, path, needle) => {
  const text = (docs ?? []).find((d) => d.path === path)?.text;
  const i = text && needle ? text.split(/\r?\n/).findIndex((l) => l.includes(needle)) : -1;
  return i === -1 ? 1 : i + 1;
};

// The architecture only counts when it has parts; "none" or absent is no data.
const archOf = (ctx) => (ctx.project?.arch?.parts?.length ? ctx.project.arch : null);
const hasOwner = (f) => f.owner !== null && f.owner !== undefined && f.owner !== '' && f.owner !== '_none';

const censusOwners = (id) => (ctx) => {
  if (!ctx.census) return unverified(id, 'no-data');
  const included = (ctx.census.files ?? []).filter((f) => f.included);
  if (!included.length) return unverified(id, 'not-applicable');
  const lost = included.filter((f) => !hasOwner(f));
  if (!lost.length) return confirmed(id, included.map((f) => at(ctx, f.path, 1)), { files: included.length });
  return warning(id, lost.map((f) => at(ctx, f.path, 1)), findingsBy(ctx, ['owner-missing']).map((f) => f.id), { count: lost.length });
};

const read100 = (id) => (ctx) => {
  const sum = ctx.ledger?.summary;
  if (!sum) return unverified(id, 'no-data');
  const total = Number(sum.totalChars);
  if (!(total > 0)) return unverified(id, 'not-applicable');
  const percent = Math.floor((Number(sum.readChars) * 100) / total); // 99.9 % never becomes 100
  if (percent >= 100) {
    const read = Object.entries(ctx.ledger.files ?? {}).map(([file, e]) => ({ file, line: e.spans?.[0]?.[0] ?? 1, sha: e.sha ?? null }));
    return confirmed(id, read.length ? read : [{ file: null, line: null, sha: null, readChars: sum.readChars, totalChars: total }], { percent });
  }
  const missing = (sum.missing ?? []).map((m) => at(ctx, m.path, m.spans?.[0]?.[0] ?? 1));
  return warning(id, missing, [], { percent, files: missing.length });
};

const goldenRule = (id) => (ctx) => {
  const arch = archOf(ctx);
  if (!ctx.model || !arch) return unverified(id, 'no-data');
  const parts = arch.parts.filter(NO_ROLE);
  if (!parts.length) return unverified(id, 'not-applicable');
  const partIds = new Set(arch.parts.map((p) => p.id));
  const nodes = ctx.model.nodes ?? [];
  const withPart = nodes.filter((n) => n.partId);
  const drawn = new Set(withPart.map((n) => n.partId));
  const noNode = parts.filter((p) => !drawn.has(p.id));
  const orphans = nodes.filter((n) => n.level === 3 && n.kind === 'component' && (!n.partId || !partIds.has(n.partId)));
  if (!noNode.length && !orphans.length) {
    const proof = parts.map((p) => withPart.find((n) => n.partId === p.id)?.evidence?.[0]).filter(Boolean);
    return confirmed(id, proof, { parts: parts.length });
  }
  const proof = [...noNode.map((p) => at(ctx, p.file, 1)), ...orphans.map((n) => n.evidence?.[0]).filter(Boolean)];
  return warning(id, proof, [], { count: noNode.length + orphans.length, parts: noNode.length, nodes: orphans.length });
};

// Facts against the architecture, both ways: every fact lives in a file owned by a part that has a node in the model,
// and every fact the model cites still exists. A queue is a "job" line too.
const COVER_KINDS = { routes: ['route'], screens: ['screen'], tables: ['table'], jobs: ['queue', 'job'], integrations: ['integration'] };
const coverage = (id, kinds) => (ctx) => {
  if (!ctx.census || !ctx.facts || !ctx.model) return unverified(id, 'no-data');
  const { byPath } = censusIndex(ctx.census);
  const drawn = new Set((ctx.model.nodes ?? []).map((n) => n.partId).filter(Boolean));
  const all = ctx.facts.facts ?? [];
  const mine = all.filter((f) => kinds.includes(f.kind));
  const unmapped = mine.filter((f) => {
    const owner = byPath.get(f.file)?.owner;
    return !owner || owner === '_none' || !drawn.has(owner);
  });
  const known = new Set(all.map((f) => f.id));
  const dangling = [];
  for (const item of [...(ctx.model.nodes ?? []), ...(ctx.model.edges ?? [])]) {
    for (const e of item.evidence ?? []) {
      if (e.factId && kinds.includes(e.factId.split(':')[0]) && !known.has(e.factId)) dangling.push(e);
    }
  }
  if (!mine.length && !dangling.length) return unverified(id, 'not-applicable');
  if (!unmapped.length && !dangling.length) return confirmed(id, mine.map(factEvidence), { facts: mine.length });
  return warning(id, [...unmapped.map(factEvidence), ...dangling], [], { count: unmapped.length + dangling.length, unmapped: unmapped.length, dangling: dangling.length });
};

// "Where in the code" -> a path that is a file or a folder of the census; a glob counts by its fixed prefix.
function pathFound(ix, raw) {
  const cut = raw.replace(/^\.\//, '');
  const g = cut.search(GLOB_CHARS);
  const p = (g === -1 ? cut : cut.slice(0, g)).replace(/\/+$/, '');
  return p === '' || ix.byPath.has(p) || ix.dirs.has(p);
}
const archPaths = (id) => (ctx) => {
  const arch = archOf(ctx);
  if (!ctx.census || !arch) return unverified(id, 'no-data');
  const ix = censusIndex(ctx.census);
  const checked = [];
  const broken = [];
  for (const part of arch.parts) {
    for (const raw of part.codePaths ?? []) {
      const e = at(ctx, part.file, lineOf(ctx.docs, part.file, raw));
      (pathFound(ix, raw) ? checked : broken).push(e);
    }
  }
  if (!checked.length && !broken.length) return unverified(id, 'not-applicable');
  if (!broken.length) return confirmed(id, checked, { paths: checked.length });
  const files = new Set(broken.map((e) => e.file));
  const found = findingsBy(ctx, ['pointer-broken', 'doc-cites-missing'], (f) => files.has(f.target?.file));
  return warning(id, broken, found.map((f) => f.id), { count: broken.length });
};

const pairKey = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
const linksImports = (id) => (ctx) => {
  const arch = archOf(ctx);
  if (!ctx.model || !arch) return unverified(id, 'no-data');
  if (!arch.mermaid) return unverified(id, 'not-applicable'); // nothing drawn to compare
  const flow = parseFlow(arch.mermaid);
  if (!flow.ok) return unverified(id, 'no-data');
  const parts = arch.parts.filter(NO_ROLE);
  const boxOf = matchParts(flow, parts);
  const nodePart = new Map((ctx.model.nodes ?? []).filter((n) => n.partId).map((n) => [n.id, n.partId]));
  const drawnParts = new Set(nodePart.values());
  // A box whose part has no node in the model cannot be judged here (golden-rule already says so).
  const drawn = new Set();
  for (const e of flow.edges) {
    const a = boxOf.get(e.from);
    const b = boxOf.get(e.to);
    if (a && b && a !== b && drawnParts.has(a) && drawnParts.has(b)) drawn.add(pairKey(a, b));
  }
  const real = new Map();
  for (const e of ctx.model.edges ?? []) {
    if (e.kind !== 'imports') continue;
    const a = nodePart.get(e.from);
    const b = nodePart.get(e.to);
    if (!a || !b || a === b) continue;
    const k = pairKey(a, b);
    const r = real.get(k) ?? { strength: 0, evidence: [] };
    r.strength += (e.evidence ?? []).length || 1;
    r.evidence.push(...(e.evidence ?? []));
    real.set(k, r);
  }
  if (!drawn.size && !real.size) return unverified(id, 'not-applicable');
  const withoutImport = [...drawn].filter((k) => !real.has(k));
  const withoutLink = [...real].filter(([k, r]) => r.strength >= STRONG_IMPORTS && !drawn.has(k));
  if (!withoutImport.length && !withoutLink.length) {
    return confirmed(id, [...real.values()].flatMap((r) => r.evidence.slice(0, 1)), { links: drawn.size, imports: real.size });
  }
  const readme = `${arch.dir ?? 'docs/architecture'}/README.md`;
  const proof = [
    ...withoutImport.map(() => at(ctx, readme, lineOf(ctx.docs, readme, 'mermaid'))),
    ...withoutLink.flatMap(([, r]) => r.evidence.slice(0, 1)),
  ];
  return warning(id, proof, [], { count: withoutImport.length + withoutLink.length, drawn: withoutImport.length, imports: withoutLink.length });
};

// Variables. Where a name sits decides what it is: an .env.example line documents it, any other file that is not
// turbo.json is code that reads it. A fact is one name with its definition and its other places in `refs`.
const base = (p) => p.split('/').pop();
function placesOf(f) {
  const primary = { file: f.file, line: f.line ?? null, sha: f.sha ?? null };
  return [primary, ...(f.refs ?? []).map((r) => ({ file: r.file, line: r.line ?? null, sha: null }))].map((p, i) => {
    const b = base(p.file);
    const source = i === 0 ? f.attrs?.source : null;
    const kind = /^\.env(\.|$)/.test(b) || source === 'example' ? 'example' : b === 'turbo.json' || source === 'turbo' ? 'other' : 'code';
    return { ...p, kind };
  });
}
const wordIn = (text, name) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(text);

// Names written between backticks under a configuration heading of a document (fences skipped: they may hold values).
function docNames(docs) {
  const out = [];
  for (const d of docs) {
    let fence = false;
    let inConfig = false;
    (d.text ?? '').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
      if (fence) return;
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) { inConfig = CONFIG_HEADING.test(h[1]); return; }
      if (!inConfig) return;
      for (const m of line.matchAll(/`([^`\s]+)`/g)) if (ENV_NAME.test(m[1])) out.push({ name: m[1], file: d.path, line: i + 1 });
    });
  }
  return out;
}

// A variable only a test or a fixture repository reads or lists is the sample's, and the ones the operating system sets are read, not configured.
const envFacts = (ctx) => (ctx.facts.facts ?? []).filter((f) => f.kind === 'env').map((f) => ({ fact: f, places: placesOf(f) }))
  .filter((e) => !SYSTEM_VARS.test(e.fact.id.replace(/^env:/, '')) && !e.places.every((p) => isSamplePath(p.file ?? '')));
const envDocumented = (id) => (ctx) => {
  if (!ctx.facts || !Array.isArray(ctx.docs)) return unverified(id, 'no-data');
  const read = envFacts(ctx).filter((e) => e.places.some((p) => p.kind === 'code'));
  if (!read.length) return unverified(id, 'not-applicable');
  const named = (e) => e.places.some((p) => p.kind === 'example') || ctx.docs.some((d) => wordIn(d.text ?? '', e.fact.id.replace(/^env:/, '')));
  const bare = read.filter((e) => !named(e));
  const proof = (e) => factEvidence(e.fact);
  if (!bare.length) return confirmed(id, read.map(proof), { names: read.length });
  return warning(id, bare.map(proof), [], { count: bare.length });
};

const envUnused = (id) => (ctx) => {
  if (!ctx.facts || !Array.isArray(ctx.docs)) return unverified(id, 'no-data');
  const all = envFacts(ctx);
  const nameOf = (e) => e.fact.id.replace(/^env:/, '');
  const reads = new Set(all.filter((e) => e.places.some((p) => p.kind === 'code')).map(nameOf));
  const listed = all.filter((e) => e.places.some((p) => p.kind === 'example'));
  const fromDocs = docNames(ctx.docs);
  if (!listed.length && !fromDocs.length) return unverified(id, 'not-applicable');
  const stale = listed.filter((e) => !reads.has(nameOf(e))).map((e) => factEvidence(e.fact));
  const seen = new Set(listed.map(nameOf));
  const staleDocs = fromDocs.filter((d) => !reads.has(d.name) && !seen.has(d.name)).map((d) => at(ctx, d.file, d.line));
  if (!stale.length && !staleDocs.length) {
    const proof = [...listed.flatMap((e) => e.places.filter((p) => p.kind === 'example').map((p) => ({ ...p, factId: e.fact.id }))), ...fromDocs.map((d) => at(ctx, d.file, d.line))];
    return confirmed(id, proof, { names: listed.length + fromDocs.length });
  }
  return warning(id, [...stale, ...staleDocs], [], { count: stale.length + staleDocs.length });
};

const LINE_FNS = {
  'g1.census-owners': censusOwners,
  'g1.read-100': read100,
  'g1.golden-rule': goldenRule,
  ...Object.fromEntries(Object.entries(COVER_KINDS).map(([k, kinds]) => [`g1.cov-${k}`, (id) => coverage(id, kinds)])),
  'g1.arch-paths': archPaths,
  'g1.links-imports': linksImports,
  'g4.env-documented': envDocumented,
  'g4.env-unused': envUnused,
};

export const LINES = Object.entries(LINE_FNS).map(([id, make]) => {
  const fn = make(id);
  return { id, group: Number(id[1]), run: (ctx) => fn(ctx ?? {}) };
});
