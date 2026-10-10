// What the code holds, written down for the architecture documents (fd01, fd02, fd12): per part of the map the routes,
// screens, tables, integrations, jobs and variables the readers found; the block of Markdown a document can carry between
// two markers; the check that every code file and every route, screen and table has a part that owns it; and how much of
// all that the documents already name. Everything here is pure: it receives the census, the facts and the documents'
// text, and the AI never takes part (exact is the program's).
import { codeSpansOf } from './mdlinks.mjs';

export const GENERATED_START = '<!-- session-map:generated:start -->';
export const GENERATED_END = '<!-- session-map:generated:end -->';

const NONE = '_none';
// Lists of one part, in the order the block writes them. `jobs` holds queues and jobs; `configs` the variables (names only).
const LISTS = [
  ['routes', ['route']],
  ['screens', ['screen']],
  ['tables', ['table']],
  ['integrations', ['integration']],
  ['jobs', ['queue', 'job']],
  ['configs', ['env']],
];
const CITED_KINDS = [['routes', 'route'], ['screens', 'screen'], ['tables', 'table']];
const OWNED_KINDS = new Set(['code', 'screen']);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const factsOf = (facts) => (Array.isArray(facts) ? facts : Array.isArray(facts?.facts) ? facts.facts : []);
const filesOf = (census) => (Array.isArray(census?.files) ? census.files : []);
const hasOwner = (owner) => typeof owner === 'string' && owner !== '' && owner !== NONE;
const isoOf = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

// ---------- the owner check ----------

const ownerIndex = (census) => new Map(filesOf(census).map((f) => [f.path, f.owner]));
const needsOwner = (f) => f.included !== false && OWNED_KINDS.has(f.kind);

// ok is false when a code or screen file, or a route, screen or table fact, has no part that owns it.
export function ownerCheck(census, facts) {
  const owners = ownerIndex(census);
  const files = filesOf(census).filter((f) => needsOwner(f) && !hasOwner(f.owner)).map((f) => f.path).sort(byCodeUnit);
  const lost = factsOf(facts)
    .filter((f) => CITED_KINDS.some(([, kind]) => kind === f.kind) && !hasOwner(owners.get(f.file)))
    .map((f) => f.id);
  return { ok: files.length === 0 && lost.length === 0, files, facts: lost };
}

// The shallowest folder with code in it and no owned code at all, one gap per folder. Files straight in the root are
// expected to have no part and make no folder gap.
function unownedFolders(census) {
  const code = filesOf(census).filter(needsOwner);
  const ownedDirs = new Set();
  for (const f of code) {
    if (!hasOwner(f.owner)) continue;
    const parts = f.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) ownedDirs.add(parts.slice(0, i).join('/'));
  }
  const out = new Set();
  for (const f of code) {
    if (hasOwner(f.owner)) continue;
    const parts = f.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!ownedDirs.has(dir)) { out.add(dir); break; }
    }
  }
  return [...out].sort(byCodeUnit);
}

// ---------- what the documents cite ----------

// A term is "cited" when a code span holds it as a whole: not glued to a word, a path piece or a dash on either side
// (so /orders is not cited by /v2/orders or by /orders/:id, nor Order by OrderItem). Spans are joined by line breaks, which
// are boundaries, so a term never matches across two spans.
const WORD = /[\p{L}\p{N}_]/u;
const before = (c) => c !== undefined && (WORD.test(c) || c === '/' || c === '-' || c === '.');
const after = (c) => c !== undefined && (WORD.test(c) || c === '/' || c === '-' || c === ':' || c === '{' || c === '[');

function citedIn(haystack, term) {
  if (typeof term !== 'string' || term === '') return false;
  for (let i = haystack.indexOf(term); i !== -1; i = haystack.indexOf(term, i + 1)) {
    if (!before(haystack[i - 1]) && !after(haystack[i + term.length])) return true;
  }
  return false;
}

function spansText(docs, dir) {
  if (!dir) return '';
  const prefix = `${String(dir).replace(/\/+$/, '')}/`;
  const spans = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (typeof d?.path !== 'string' || !d.path.startsWith(prefix) || !/\.md$/i.test(d.path)) continue;
    for (const s of codeSpansOf(d.text)) spans.push(s.text);
  }
  return spans.join('\n');
}

const tailOf = (id) => String(id ?? '').slice(String(id ?? '').indexOf(':') + 1);

// The words a document can use to name a fact; none for a route whose path the program could not read.
function termsOf(f) {
  const a = f.attrs ?? {};
  if (f.kind === 'route') return typeof a.path === 'string' ? [a.path] : [];
  if (f.kind === 'screen') return [a.route, a.widget];
  return [typeof a.name === 'string' ? a.name : typeof f.name === 'string' ? f.name : tailOf(f.id)];
}

function nameOf(f) {
  if (typeof f.name === 'string' && f.name !== '') return f.name;
  const a = f.attrs ?? {};
  if (f.kind === 'route' && typeof a.path === 'string') return `${String(a.method ?? 'ANY').toUpperCase()} ${a.path}`;
  if (f.kind === 'screen') return a.route ?? a.widget ?? tailOf(f.id).split(':').slice(1).join(':');
  return tailOf(f.id);
}

// ---------- sections.json ----------

const itemOf = (f) => ({ id: f.id, name: nameOf(f), file: f.file, line: f.line ?? null, at: `${f.file}:${f.line ?? ''}`, origin: f.origin ?? null });
const byPlace = (a, b) => byCodeUnit(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.id, b.id);
const emptyPart = () => Object.fromEntries(LISTS.map(([key]) => [key, []]));

// `docs` = [{ path, text }]: the Markdown of the project (only the architecture folder counts). `coverage` values are
// fractions of 0 to 1, null when the kind does not exist; `counts` keeps the whole numbers behind them.
export function sectionsOf(facts, census, arch, { docs = [], now } = {}) {
  const all = factsOf(facts);
  const owners = ownerIndex(census);
  const parts = {};
  for (const p of Array.isArray(arch?.parts) ? arch.parts : []) if (p?.id) parts[p.id] = emptyPart();
  const partOf = (file) => {
    const owner = owners.get(file);
    const key = hasOwner(owner) ? owner : NONE;
    return (parts[key] ??= emptyPart());
  };
  for (const f of all) {
    const list = LISTS.find(([, kinds]) => kinds.includes(f.kind));
    if (list) partOf(f.file)[list[0]].push(itemOf(f));
  }
  for (const part of Object.values(parts)) for (const [key] of LISTS) part[key].sort(byPlace);

  const text = spansText(docs, arch?.dir);
  const counts = {};
  const gaps = [];
  for (const [key, kind] of CITED_KINDS) {
    const mine = all.filter((f) => f.kind === kind);
    const missing = mine.filter((f) => !termsOf(f).some((t) => citedIn(text, t)));
    counts[key] = mine.length ? { num: mine.length - missing.length, den: mine.length } : null;
    for (const f of missing.map((m) => ({ f: m, item: itemOf(m) })).sort((a, b) => byPlace(a.item, b.item))) {
      gaps.push({ kind, id: f.f.id, file: f.f.file, line: f.f.line ?? null, reason: 'not-cited' });
    }
  }
  const code = filesOf(census).filter(needsOwner);
  counts.owned = code.length ? { num: code.filter((f) => hasOwner(f.owner)).length, den: code.length } : null;
  for (const dir of unownedFolders(census)) gaps.push({ kind: 'folder', id: dir, file: `${dir}/`, line: null, reason: 'no-owner' });

  const coverage = Object.fromEntries(['owned', 'routes', 'screens', 'tables'].map((k) => [k, counts[k] ? counts[k].num / counts[k].den : null]));
  return {
    version: 1,
    generatedAt: isoOf(now),
    censusRev: census?.rev ?? null,
    parts,
    gaps,
    ownerCheck: ownerCheck(census, all),
    coverage,
    counts: { owned: counts.owned, routes: counts.routes, screens: counts.screens, tables: counts.tables },
  };
}

// ---------- the generated block ----------

const TEXT = {
  en: {
    written: 'Written from the code by session-map', rev: 'census rev', empty: 'Nothing found in the code yet.', unsure: 'not sure',
    titles: { routes: 'Routes', screens: 'Screens', tables: 'Tables', integrations: 'Integrations', jobs: 'Jobs', configs: 'Config' },
  },
  pt: {
    written: 'Escrito a partir do código pelo session-map', rev: 'censo rev', empty: 'Nada encontrado no código ainda.', unsure: 'incerto',
    titles: { routes: 'Rotas', screens: 'Telas', tables: 'Tabelas', integrations: 'Integrações', jobs: 'Robôs', configs: 'Configs' },
  },
};

// A Markdown code span that survives backticks inside the text.
function code(raw) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  let longest = 0;
  for (const run of t.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

// `part` = one entry of sections.parts (it may carry `rev`, the census rev); `lang` = arch.lang, `en` when unknown.
export function generatedBlock(part, lang, rev = part?.rev) {
  const t = TEXT[lang] ?? TEXT.en;
  const lines = [GENERATED_START, `${t.written}${Number.isInteger(rev) ? ` (${t.rev} ${rev})` : ''}`];
  let any = false;
  for (const [key] of LISTS) {
    const items = Array.isArray(part?.[key]) ? part[key] : [];
    if (!items.length) continue;
    any = true;
    lines.push('', `**${t.titles[key]}**`, '');
    for (const i of items) lines.push(`- ${code(i.name ?? i.id)}${i.origin === 'AMBIGUOUS' ? ` (${t.unsure})` : ''} — ${code(i.at ?? `${i.file}:${i.line}`)}`);
  }
  if (!any) lines.push('', t.empty);
  lines.push(GENERATED_END);
  return lines.join('\n');
}

// The markers count only alone on their line, so a document that quotes one in a sentence is not touched.
const markerRe = (marker) => new RegExp(`^[ \\t]*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\r?$`, 'gm');
const matchesOf = (md, marker) => [...md.matchAll(markerRe(marker))];

function locate(md) {
  const starts = matchesOf(md, GENERATED_START);
  const ends = matchesOf(md, GENERATED_END);
  if (!starts.length && !ends.length) return { state: 'none' };
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) return { state: 'broken' };
  return { state: 'ok', from: starts[0].index, to: ends[0].index + ends[0][0].replace(/\r$/, '').length };
}

// 'none' (no block yet), 'ok' (one start before one end) or 'broken' (anything else: nothing is guessed at).
export const generatedState = (md) => locate(String(md ?? '')).state;

// Swaps the block between the markers and nothing else; a document with no block gets it at the end; a broken pair is
// returned as it came. Applying the same block twice gives the same text. Keeps the line breaks of the document.
export function replaceGenerated(md, block) {
  const text = String(md ?? '');
  const b = String(block ?? '').replace(/\r\n/g, '\n');
  if (!b.startsWith(GENERATED_START) || !b.endsWith(GENERATED_END)) throw new TypeError('block-without-markers');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = eol === '\n' ? b : b.replaceAll('\n', eol);
  const at = locate(text);
  if (at.state === 'broken') return text;
  if (at.state === 'ok') return text.slice(0, at.from) + next + text.slice(at.to);
  if (text === '') return next + eol;
  return text + (text.endsWith('\n') ? '' : eol) + eol + next + eol;
}
