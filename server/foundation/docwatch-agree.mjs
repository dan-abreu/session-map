// Watcher rules about what documents say among themselves (fd06, fd07 groups 2 and 3, fd13): versions, numbers and diagram
// boxes, screenshots older than their screen, and document size. Every rule is pure: (RuleInput) -> Finding[] in the
// shape of contracts section 6. Input a rule needs and does not have (null) gives [], and the panel line shows no-data.
// Nothing here asks an AI; the only reads are the root manifests, and only when the caller did not pass them.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { findingId } from './findings.mjs';
import { DEFAULT_LIMITS, docAction, docTypeOf, measureDoc, needsSummary, sizeState } from './docsize.mjs';
import { maskCode } from './mdlinks.mjs';
import { flowKey, matchParts, parseFlow } from '../web/flow.js';

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const MANIFESTS = ['package.json', 'pubspec.yaml', 'composer.json', 'VERSION'];
const MANIFEST_MAX = 256 * 1024;
const list = (v) => (Array.isArray(v) ? v : null);
const lineList = (text) => String(text ?? '').split(/\r?\n/);
const baseName = (p) => String(p).split('/').pop();
const isRoot = (p) => !String(p).includes('/');
const bare = (v) => String(v).trim().replace(/^v/i, '').replace(/\+.*$/, '');

function shaLookup(input) {
  const files = list(input?.census?.files);
  const by = files ? new Map(files.map((f) => [f.path, f.sha ?? null])) : new Map();
  return (file) => by.get(file) ?? null;
}

function build(rule, severity, { file, line = null }, evidence, whatParams, idParams, extra = {}) {
  const base = `watch.${rule}${extra.sub ? `.${extra.sub}` : ''}`;
  const out = {
    id: findingId(rule, file, idParams),
    rule,
    severity,
    target: { file, line },
    evidence,
    what: { msg: `${base}.what`, params: whatParams },
    why: { msg: `${base}.why` },
    todo: { msg: `${base}.todo` },
    fix: { kind: extra.fix ?? 'ai-update', opId: null },
  };
  if (extra.origin) out.origin = extra.origin;
  return out;
}

// ---------- version-mismatch ----------

function lineOfPattern(text, re) {
  const at = lineList(text).findIndex((l) => re.test(l));
  return at < 0 ? null : at + 1;
}

function readManifest({ path, text }) {
  const name = baseName(path);
  if (name === 'package.json' || name === 'composer.json') {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (typeof data?.version !== 'string' || !data.version.trim()) return null;
    return { file: path, line: lineOfPattern(text, /^\s*"version"\s*:/), version: bare(data.version) };
  }
  if (name === 'pubspec.yaml') {
    const m = /^version:\s*['"]?([^\s'"#]+)/m.exec(text);
    return m ? { file: path, line: lineOfPattern(text, /^version:/), version: bare(m[1]) } : null;
  }
  if (name === 'VERSION') {
    const at = lineList(text).findIndex((l) => l.trim());
    const v = at < 0 ? null : lineList(text)[at].trim();
    return v && new RegExp(`^v?${SEMVER}$`).test(v) ? { file: path, line: at + 1, version: bare(v) } : null;
  }
  return null;
}

function manifestsOf(input) {
  let given = list(input.manifests);
  if (!given && typeof input.root === 'string') {
    given = [];
    for (const name of MANIFESTS) {
      try {
        const text = readFileSync(join(input.root, name), 'utf8');
        if (text.length <= MANIFEST_MAX) given.push({ path: name, text });
      } catch { /* the project simply does not have this file */ }
    }
  }
  return (given ?? [])
    .filter((m) => isRoot(m.path) && MANIFESTS.includes(baseName(m.path)))
    .sort((a, b) => MANIFESTS.indexOf(baseName(a.path)) - MANIFESTS.indexOf(baseName(b.path)))
    .map(readManifest)
    .filter(Boolean);
}

function changelogTop(doc) {
  const re = new RegExp(`^##\\s+\\[?v?(${SEMVER})\\]?`, 'i');
  const rows = lineList(doc.text);
  for (let i = 0; i < rows.length; i++) {
    if (/^##\s+\[?(unreleased|n[aã]o lan[cç]ado)\b/i.test(rows[i])) continue;
    const m = re.exec(rows[i]);
    if (m) return { file: doc.path, line: i + 1, version: bare(m[1]) };
    if (/^##\s/.test(rows[i])) return null; // the first release heading is not a version: nothing to read
  }
  return null;
}

// Only an explicit statement counts as "the project's version": a marker comment, a "Version:" label, a version badge.
// Prose such as "since version 0.1.0" or "Node version 20.1.0" is history or somebody else's version.
function readmeMention(doc) {
  const marker = new RegExp(String.raw`<!--\s*[\w:.-]*version\s*:?\s*v?(${SEMVER})\s*-->`, 'i');
  const label = new RegExp(String.raw`^\W*(?:current\s+|latest\s+)?(?:version|vers[aã]o)\s*[:：]\s*[*_\x60]*v?(${SEMVER})`, 'i');
  // shields.io separates badge fields with a dash, so the version in a badge is plain x.y.z.
  const badge = /shields\.io\/badge\/(?:version|release|v)-v?(\d+\.\d+\.\d+)(?=-|\b)/i;
  let fenced = false;
  const rows = lineList(doc.text);
  for (let i = 0; i < rows.length; i++) {
    if (/^\s*(```|~~~)/.test(rows[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = marker.exec(rows[i]) ?? label.exec(rows[i]) ?? badge.exec(rows[i]);
    if (m) return { file: doc.path, line: i + 1, version: bare(m[1]) };
  }
  return null;
}

export function versionMismatch(input) {
  const docs = list(input?.docs);
  if (!input || !docs) return [];
  const sha = shaLookup(input);
  const ev = (p) => ({ file: p.file, line: p.line ?? null, sha: sha(p.file) });
  const manifests = manifestsOf(input);
  const changelogs = docs.filter((d) => isRoot(d.path) && /^changelog(\.[\w-]+)?\.md$/i.test(d.path));
  const tops = changelogs.map(changelogTop).filter(Boolean);
  const code = input.versions?.code;
  const fromVersions = code?.version && code.file ? { file: code.file, line: code.line ?? null, version: bare(code.version) } : null;
  const ref = fromVersions ?? manifests[0] ?? tops[0] ?? null;
  if (!ref) return [];
  const others = [
    ...manifests,
    ...tops,
    ...docs.filter((d) => isRoot(d.path) && /^readme(\.[\w-]+)?\.md$/i.test(d.path)).map(readmeMention).filter(Boolean),
  ].filter((o) => o.file !== ref.file);
  const found = [];
  for (const o of others) {
    if (o.version === ref.version) continue;
    found.push(build('version-mismatch', 'important', o, [ev(o), ev(ref)],
      { where: o.file, found: o.version, expected: ref.version }, { where: o.file, found: o.version }));
  }
  const tag = input.versions?.tag;
  if (input.versions?.mismatch === true && typeof tag === 'string' && bare(tag) !== ref.version) {
    found.push(build('version-mismatch', 'detail', ref, [ev(ref), { note: 'tag', tag }],
      { where: tag, found: bare(tag), expected: ref.version }, { where: tag, found: bare(tag) }, { fix: 'manual' }));
  }
  return found;
}

// ---------- docs-disagree ----------

const COUNT_KIND = { route: 'route', rota: 'route', screen: 'screen', tela: 'screen', table: 'table', tabela: 'table', queue: 'queue', fila: 'queue' };
const COUNT_RE = /(?<![\d.,~≈])(\d+)(\+?)\s+(?:(?:API|HTTP|REST|database|banco)\s+)?(routes?|rotas?|screens?|telas?|tables?|tabelas?|queues?|filas?)\b/gi;
const VAGUE_BEFORE = /(?:over|more than|up to|about|around|nearly|almost|at least|mais de|cerca de|até|aproximadamente|quase|pelo menos)\s+$/i;

// The motor's swap for a count finding (fd23): the number of the claim on this line becomes the count the code holds,
// found with the same pattern the rule read the claim with. A line with no such claim returns null (the AI's turn).
export function swapCount(line, { claimed, count, kind }) {
  if (typeof line !== 'string' || typeof claimed !== 'number' || typeof count !== 'number' || typeof kind !== 'string') return null;
  for (const m of line.matchAll(COUNT_RE)) {
    const k = COUNT_KIND[m[3].toLowerCase().replace(/s$/, '')];
    if (k !== kind || Number(m[1]) !== claimed || m[2] === '+') continue;
    return `${line.slice(0, m.index)}${String(count)}${line.slice(m.index + m[1].length)}`;
  }
  return null;
}

function countClaims(doc) {
  const rows = lineList(maskCode(doc.text));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (const m of rows[i].matchAll(COUNT_RE)) {
      if (m[2] === '+' || VAGUE_BEFORE.test(rows[i].slice(0, m.index))) continue;
      const kind = COUNT_KIND[m[3].toLowerCase().replace(/s$/, '')];
      const claimed = Number(m[1]);
      const key = `${kind}:${claimed}`;
      if (!kind || seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, claimed, line: i + 1 });
    }
  }
  return out;
}

function countFindings(input, docs, sha) {
  const facts = list(input.facts?.facts);
  if (!facts) return [];
  const byKind = new Map();
  for (const f of facts) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const out = [];
  for (const doc of docs.filter((d) => isRoot(d.path) && /^readme(\.[\w-]+)?\.md$/i.test(d.path))) {
    for (const c of countClaims(doc)) {
      const of = byKind.get(c.kind) ?? [];
      // Nothing extracted at all means the reader may not know this stack: no number to hold against.
      if (!of.length || of.some((f) => f.origin === 'AMBIGUOUS') || of.length === c.claimed) continue;
      out.push(build('docs-disagree', 'important', { file: doc.path, line: c.line },
        [{ file: doc.path, line: c.line, sha: sha(doc.path) }, ...of.slice(0, 1).map((f) => ({ file: f.file, line: f.line ?? null, sha: f.sha ?? sha(f.file), factId: f.id }))],
        { a: doc.path, b: 'code', what: `${c.kind}s`, claimed: c.claimed, count: of.length, kind: c.kind },
        { kind: c.kind, claimed: c.claimed }, { origin: 'EXTRACTED' }));
    }
  }
  return out;
}

function nodeFindings(input, docs, sha) {
  const arch = input.arch;
  const parts = list(arch?.parts);
  if (!parts?.length || typeof arch.mermaid !== 'string' || !arch.mermaid.trim()) return [];
  const flow = parseFlow(arch.mermaid);
  if (!flow.ok) return [];
  const known = new Set();
  for (const n of list(input.model?.nodes) ?? []) {
    if (n.kind === 'person' || n.kind === 'external') for (const k of [flowKey(n.name), flowKey(String(n.id).replace(/^[a-z]+:/, ''))]) if (k) known.add(k);
  }
  for (const l of list(arch.layers) ?? []) if (l.name) known.add(flowKey(l.name));
  const matched = matchParts(flow, parts);
  const host = docs.find((d) => d.text.includes(arch.mermaid));
  const file = host?.path ?? `${arch.dir ?? 'docs/architecture'}/README.md`;
  const firstLine = host ? host.text.slice(0, host.text.indexOf(arch.mermaid)).split('\n').length : null;
  const mermaidRows = lineList(arch.mermaid);
  const out = [];
  for (const n of flow.nodes) {
    if (matched.has(n.id) || known.has(flowKey(n.label)) || known.has(flowKey(n.id))) continue;
    const idRe = new RegExp(String.raw`(^|[^A-Za-z0-9_])${n.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
    const at = mermaidRows.findIndex((r) => idRe.test(r));
    const line = firstLine && at >= 0 ? firstLine + at : null;
    out.push(build('docs-disagree', 'detail', { file, line }, [{ file, line, sha: sha(file) }],
      { a: file, b: 'parts', what: n.label, node: n.label }, { node: flowKey(n.label) }, { origin: 'INFERRED', sub: 'node' }));
  }
  return out;
}

export function docsDisagree(input) {
  const docs = list(input?.docs);
  if (!input || !docs) return [];
  const sha = shaLookup(input);
  return [...nodeFindings(input, docs, sha), ...countFindings(input, docs, sha)];
}

// ---------- stale-image ----------

const IMAGE_NOISE = /[-_. ]?(?:screenshots?|screen|shot|capture|print|light|dark|mobile|desktop|\d+)$/i;
const SCREEN_SUFFIX = /(?:Screen|Page|View|Widget|Route)$/;

function imageKey(path) {
  let name = baseName(path).replace(/\.[^.]+$/, '');
  for (let prev = null; prev !== name;) { prev = name; name = name.replace(IMAGE_NOISE, ''); }
  return flowKey(name);
}

function screenKeys(fact) {
  const keys = new Set();
  const route = fact.attrs?.route;
  if (typeof route === 'string') {
    const segs = route.split('/').filter((s) => s && !/^\(.*\)$/.test(s));
    if (!segs.length) { keys.add('home'); keys.add('index'); }
    else if (!/^[:[{]/.test(segs.at(-1))) keys.add(flowKey(segs.at(-1)));
  }
  const widget = fact.attrs?.widget ?? (route ? null : String(fact.id).split(':').pop());
  if (typeof widget === 'string' && widget) keys.add(flowKey(widget.replace(SCREEN_SUFFIX, '')));
  keys.delete('');
  return keys;
}

const timeOf = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

// A date for a path; a folder (or a marker ending in "/") takes the newest file under it.
function dateFor(dates, path) {
  const exact = dates.get(path);
  if (exact !== undefined) return timeOf(exact);
  const prefix = `${path.replace(/\/+$/, '')}/`;
  let newest = null;
  for (const [file, iso] of dates) {
    const t = file.startsWith(prefix) ? timeOf(iso) : null;
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

export function staleImage(input) {
  const images = list(input?.images);
  const dates = input?.commitDates instanceof Map ? input.commitDates : null;
  if (!images || !dates) return [];
  const sha = shaLookup(input);
  const screens = (list(input.facts?.facts) ?? []).filter((f) => f.kind === 'screen');
  const seen = new Set();
  const out = [];
  for (const img of images) {
    const asGiven = dateFor(dates, img.image);
    const beside = posix.join(posix.dirname(img.doc), img.image);
    const imageDate = asGiven ?? dateFor(dates, beside);
    if (imageDate === null) continue;
    let screenFile = null;
    let screenFact = null;
    let origin = 'DECLARED';
    if (img.shows) {
      screenFile = img.shows;
    } else {
      origin = 'INFERRED';
      const key = imageKey(img.image);
      const hits = key ? screens.filter((s) => screenKeys(s).has(key)) : [];
      if (new Set(hits.map((s) => s.file)).size !== 1) continue;
      screenFact = hits[0];
      screenFile = screenFact.file;
    }
    const screenDate = dateFor(dates, screenFile);
    if (screenDate === null || imageDate >= screenDate) continue;
    const f = build('stale-image', origin === 'DECLARED' ? 'important' : 'detail', { file: img.doc, line: img.line ?? null },
      [{ file: img.doc, line: img.line ?? null, sha: sha(img.doc) }, { file: screenFile, line: screenFact?.line ?? null, sha: sha(screenFile), ...(screenFact ? { factId: screenFact.id } : {}) }],
      { image: img.image, screen: screenFile }, { image: img.image }, { origin });
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

// ---------- doc-size ----------

export function docSize(input) {
  const docs = list(input?.docs);
  if (!docs) return [];
  const limits = input.config?.docLimits ?? {};
  const out = [];
  for (const doc of docs) {
    const type = docTypeOf(doc.path);
    if (!type) continue;
    const m = measureDoc(doc.text);
    const state = sizeState(type, m, limits);
    const where = { file: doc.path, line: 1 };
    const evidence = [{ file: doc.path, line: 1, sha: shaLookup(input)(doc.path) }];
    if (state !== 'ok') {
      const l = { ...DEFAULT_LIMITS[type], ...limits[type] };
      const limit = m.lines > l.strong ? l.strong : m.lines > l.warn ? l.warn : l.strong;
      out.push(build('doc-size', state === 'strong' ? 'important' : 'detail', where, evidence,
        { doc: doc.path, lines: m.lines, kb: m.kb, limit, type }, { kind: 'size' }, { fix: docAction(type, state) }));
    }
    if (needsSummary(type, doc.text)) {
      out.push(build('doc-size', 'detail', where, evidence,
        { doc: doc.path, lines: m.lines, kb: m.kb, type }, { kind: 'summary' }, { fix: 'summary', sub: 'summary' }));
    }
  }
  return out;
}

export function agreeRules(input) {
  return [...versionMismatch(input), ...docsDisagree(input), ...staleImage(input), ...docSize(input)];
}
