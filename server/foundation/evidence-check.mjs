// The checker of the AI claims (fd04, contract section 5). The AI only names and explains; every sentence it sends
// comes back here with ids and citations, and the PROGRAM opens the cited lines and compares. The first failure, in the
// order of the contract, rejects the claim. Pure: the caller gives `linesOf(file) -> { lines, sha } | null`, which
// answers null for a file that is not an included file of the census today, so this module never touches the disk.
import { createHash } from 'node:crypto';
import { isSecretsFile } from '../files.mjs';

export const TYPES = ['fact', 'explain', 'not-found'];
// bad-shape and bad-origin come before the contract's list: a claim that is not a claim, or the AI stamping its own
// origin, is refused before any id is looked up or any file is opened.
export const REASONS = ['bad-shape', 'bad-origin', 'unknown-id', 'no-cite', 'file-missing', 'line-out', 'stale-sha', 'quote-mismatch', 'fact-mismatch'];
const BADGE = { fact: 'confirmed', explain: 'interpretation', 'not-found': 'not-found' };
// The origin only a deterministic reader (EXTRACTED) or a person (DECLARED) may carry.
const FORGED_ORIGINS = new Set(['EXTRACTED', 'DECLARED']);
// Fields the checker writes; whatever the AI put there is dropped, never trusted.
const OUTPUT_FIELDS = ['badge', 'hashAtCheck', 'checkedAt', 'run', 'origin', 'reason', 'readings'];
const NEAR = 2;
// A quote of one or two letters is found almost anywhere, so it proves nothing.
const MIN_QUOTE = 3;
const DISAGREE = Object.freeze({ ok: false, badge: 'not-found', reason: 'disagreement' });

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const reject = (reason) => ({ ok: false, reason });

/** The closed vocabulary (fd04 rule 2): every id of the model (nodes, edges, journeys) and every fact id. */
export function vocabularyOf(model, facts) {
  const ids = new Set();
  for (const key of ['nodes', 'edges', 'journeys']) for (const x of model?.[key] ?? []) if (typeof x?.id === 'string') ids.add(x.id);
  for (const f of factListOf(facts)) if (typeof f?.id === 'string') ids.add(f.id);
  return ids;
}

function factListOf(facts) {
  if (facts instanceof Map) return [...facts.values()];
  if (Array.isArray(facts)) return facts;
  return Array.isArray(facts?.facts) ? facts.facts : [];
}

function factMapOf(facts) {
  if (facts instanceof Map) return facts;
  return new Map(factListOf(facts).filter((f) => typeof f?.id === 'string').map((f) => [f.id, f]));
}

const isText = (v) => typeof v === 'string';
const filled = (v) => isText(v) && v.trim() !== '';
const textOk = (t) => !!t && typeof t === 'object' && !Array.isArray(t) && filled(t.en) && filled(t['pt-BR']);

// What is inside a cite (file, line, sha, quote) is judged by the later reasons, which say more than bad-shape.
const citeOk = (c) => !!c && typeof c === 'object' && !Array.isArray(c);

function shapeOk(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return false;
  if (!isText(claim.id) || !textOk(claim.text) || (claim.important !== undefined && typeof claim.important !== 'boolean')) return false;
  if (!TYPES.includes(claim.type) || !Array.isArray(claim.cites) || !Array.isArray(claim.factIds)) return false;
  // Array.from visits the holes of a sparse list, which every() would skip.
  if (!Array.from(claim.factIds).every((id) => typeof id === 'string')) return false;
  return Array.from(claim.cites).every(citeOk);
}

// A path relative to the project root, with `/`, that cannot climb out of it and is not a secrets file. Anything else
// is answered as a missing file without asking the caller to open it.
function safePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0')) return false;
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)) return false;
  if (file.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  return !isSecretsFile(file);
}

function opener(linesOf) {
  const seen = new Map();
  return (file) => {
    if (!seen.has(file)) {
      let got = null;
      try { got = linesOf(file); } catch { got = null; }
      seen.set(file, got && Array.isArray(got.lines) ? got : null);
    }
    return seen.get(file);
  };
}

function quoteNear(lines, line, quote) {
  if (typeof quote !== 'string') return false;
  const want = norm(quote);
  if (want.length < MIN_QUOTE) return false;
  const near = lines.slice(Math.max(0, line - 1 - NEAR), line + NEAR).join(' ');
  return norm(near).includes(want);
}

// Every number said as a line is a line, so none of them can pass as a count (the "1" of "how many places" would
// otherwise confirm any "line 1"). In any case: "line"/"linha"/"ln"/"l." with an optional mark ("line #1", "line: 1",
// "line-1", "linha n\u00ba 1", "line number 1", "linha n\u00famero 1") and a list or range after it ("lines 13 and 1",
// "linhas 13, 14 e 1", "lines 23-25"); "L13" and "#L13"; and ":13" or "(13)" right after a file name with an extension.
const LINE_NUMBER = String.raw`\s*(?:#|:|-|n[\u00ba\u00b0o]\.?|numbers?|n[\u00fau]meros?)?\s*\d+`;
const LINE_JOIN = String.raw`\s*(?:,|&|-|\u2013|\band\b|\bor\b|\bto\b|\bthrough\b|\be\b|\bou\b|\ba\b|\bat\u00e9)\s*`;
const LINE_SAID = new RegExp(String.raw`(?:\blines?|\blinhas?|\bln|\bl\.)${LINE_NUMBER}(?:${LINE_JOIN}L?${LINE_NUMBER})*|\bL\d+\b|(?<=[\w./-]\.[A-Za-z]\w*)[:(]\d+`, 'gi');
// line, startLine, col, cols, column, endColumn are positions; colorCount is not.
const POSITION_KEY = /line|^cols?$|column/i;
const asNumber = (m) => String(Number(m));

// The numbers of a fact, kept apart by what they mean. lines: where it and its refs are. counts: the length of its lists
// (columns), its numeric attributes that are not positions, and how many places it has. names: its own id, name, paths
// and text attributes holding digits ("/v1/orders"), which free their digits only where the exact name is written.
function numbersOfFact(fact, out) {
  const refs = Array.isArray(fact.refs) ? fact.refs : [];
  for (const l of [fact.line, ...refs.map((r) => r?.line)]) if (Number.isInteger(l)) out.lines.add(String(l));
  out.counts.add(String(1 + refs.length));
  const walk = (v, key) => {
    if (typeof v === 'number' && Number.isFinite(v)) { if (!POSITION_KEY.test(key)) out.counts.add(String(v)); }
    else if (typeof v === 'string' && /^\d+$/.test(v)) { if (!POSITION_KEY.test(key)) out.counts.add(asNumber(v)); }
    else if (typeof v === 'string') out.names.add(v);
    else if (Array.isArray(v)) { out.counts.add(String(v.length)); v.forEach((x) => walk(x, '')); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(fact.attrs, '');
  const id = String(fact.id ?? '');
  for (const n of [id, id.slice(id.indexOf(':') + 1), fact.name, fact.file, ...refs.map((r) => r?.file)]) if (typeof n === 'string') out.names.add(n);
}

function numbersAgree(written, allowed) {
  // Fullwidth digits become plain ones; digits of any other script that are left are numbers nobody can check.
  const text = written.normalize('NFKC');
  if (/[^\P{Nd}0-9]/u.test(text)) return false;
  // Lines first, on the text as written: erasing a name with digits first would cut "apps/v2/x.ts" off its ":2".
  for (const [said] of text.matchAll(LINE_SAID)) {
    if (!(said.match(/\d+/g) ?? []).every((l) => allowed.lines.has(asNumber(l)))) return false;
  }
  let t = text.replace(LINE_SAID, ' ');
  // Longest first, and only as a whole word: "v1" is not cut out of "v12", nor "2" out of "12".
  const names = [...allowed.names].filter((n) => /\d/.test(n) && !/^\d+$/.test(n)).sort((a, b) => b.length - a.length);
  for (const n of names) t = t.replace(new RegExp(`(?<!\\w)${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?!\\w)`, 'g'), ' ');
  // "1.1" or "1,1" is one number, not two ones that each pass as a count.
  return (t.match(/\d+(?:[.,]\d+)*/g) ?? []).every((m) => allowed.counts.has(asNumber(m)));
}

// fd04 rule 1: a `fact` claim repeats facts of the reader. It must name at least one real fact, cite the file where one
// of them is, and every number in its text, in both languages, must be a number those facts have, of the same kind.
// Only the facts give numbers: the `about` is chosen by the AI and frees none.
function factMatches(claim, facts) {
  if (claim.factIds.length === 0) return false;
  const found = claim.factIds.map((id) => facts.get(id));
  if (found.some((f) => !f)) return false;
  const files = new Set(found.flatMap((f) => [f.file, ...(Array.isArray(f.refs) ? f.refs.map((r) => r?.file) : [])]));
  if (!claim.cites.some((c) => files.has(c.file))) return false;
  const allowed = { lines: new Set(), counts: new Set(), names: new Set() };
  found.forEach((f) => numbersOfFact(f, allowed));
  return [claim.text.en, claim.text['pt-BR']].every((t) => numbersAgree(t, allowed));
}

/**
 * One claim against the vocabulary and the code. `linesOf(file)` gives `{ lines, sha }` of the file today (null when it
 * is not an included file of the census); `facts` (list, facts.json or Map) is needed to confirm a `fact` claim.
 * Returns `{ ok: true, badge }` or `{ ok: false, reason }`; the first failure in the order of REASONS wins.
 */
export function checkClaim(claim, vocab, linesOf, facts) {
  if (!shapeOk(claim)) return reject('bad-shape');
  if (FORGED_ORIGINS.has(claim.origin)) return reject('bad-origin');
  const known = vocab instanceof Set ? vocab : new Set();
  if (typeof claim.about !== 'string' || !known.has(claim.about) || claim.factIds.some((id) => !known.has(id))) return reject('unknown-id');
  if (claim.type !== 'not-found' && claim.cites.length === 0) return reject('no-cite');
  const open = typeof linesOf === 'function' ? opener(linesOf) : () => null;
  if (claim.cites.some((c) => !safePath(c.file) || !open(c.file))) return reject('file-missing');
  const cited = claim.cites.map((c) => ({ c, file: open(c.file) }));
  if (cited.some(({ c, file }) => !Number.isInteger(c.line) || c.line < 1 || c.line > file.lines.length)) return reject('line-out');
  if (cited.some(({ c, file }) => typeof c.sha !== 'string' || !c.sha || c.sha !== file.sha)) return reject('stale-sha');
  if (cited.some(({ c, file }) => !quoteNear(file.lines, c.line, c.quote))) return reject('quote-mismatch');
  if (claim.type === 'fact' && !factMatches(claim, factMapOf(facts))) return reject('fact-mismatch');
  return { ok: true, badge: BADGE[claim.type] };
}

const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * fd04 rule 5: an important point is read by two independent readers plus an adversary. It stands only when both
 * readers say the same `about` and the same facts (and, when the claim is given, the same as the claim) and the
 * adversary knocks down no citation; anything else, a missing reading included, is "not confirmed".
 */
export function settleImportant(readings, claim) {
  if (!Array.isArray(readings)) return DISAGREE;
  const readers = readings.filter((r) => r?.role === 'reader');
  const adversaries = readings.filter((r) => r?.role === 'adversary');
  if (readers.length !== 2 || adversaries.length !== 1) return DISAGREE;
  const [a, b] = readers;
  if (typeof a.about !== 'string' || a.about !== b.about || !sameIds(a.factIds, b.factIds)) return DISAGREE;
  if (claim && (a.about !== claim.about || !sameIds(a.factIds, claim.factIds))) return DISAGREE;
  const rejects = adversaries[0].rejects;
  if (!Array.isArray(rejects) || rejects.length > 0) return DISAGREE;
  return { ok: true };
}

function hashIndex(model) {
  const out = new Map();
  for (const key of ['nodes', 'edges']) for (const x of model?.[key] ?? []) if (typeof x?.id === 'string') out.set(x.id, x.hash ?? null);
  return out;
}

// A claim about a fact has no node hash to compare later, so it keeps the hash of what it cites, with the
// recipe of the model's node hash (sha256 of the shas sorted by file and line, 16 hex): a new sha in a cited file makes
// it out of date. Nothing cited, nothing to hash.
function citesHash(cites) {
  const seen = new Map();
  for (const c of cites) seen.set(`${c.file}\n${c.line}`, c);
  const list = [...seen.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line);
  if (!list.length) return null;
  return createHash('sha256').update(list.map((c) => c.sha).join('\n')).digest('hex').slice(0, 16);
}

function cleaned(claim) {
  const out = { ...claim };
  for (const k of OUTPUT_FIELDS) delete out[k];
  return out;
}

/**
 * Every claim of a run. `{ vocab, linesOf, facts, model, now, run, readingsOf }`: `model` gives the hash at check of the
 * node or edge the claim is about; `readingsOf(claim)` gives the readings of an important claim, from the runs of the
 * program (never from the claim, which is the AI's own text): without it an important claim is not confirmed.
 * Returns `{ approved, rejected }`; an important claim whose readings disagree stays, as not-found.
 */
export function checkAll(claims, { vocab, linesOf, facts, model, now, run = null, readingsOf = () => undefined } = {}) {
  const approved = [];
  const rejected = [];
  if (!Array.isArray(claims)) return { approved, rejected };
  const open = typeof linesOf === 'function' ? opener(linesOf) : () => null;
  const factMap = factMapOf(facts);
  const hashes = hashIndex(model);
  const checkedAt = now ?? new Date().toISOString();
  for (const claim of claims) {
    const verdict = checkClaim(claim, vocab, open, factMap);
    if (!verdict.ok) {
      const base = claim && typeof claim === 'object' && !Array.isArray(claim) ? cleaned(claim) : { value: claim };
      rejected.push({ ...base, reason: verdict.reason, checkedAt, run });
      continue;
    }
    const out = { ...cleaned(claim), badge: verdict.badge, hashAtCheck: hashes.get(claim.about) ?? (factMap.has(claim.about) ? citesHash(claim.cites) : null), checkedAt, run };
    if (claim.important) {
      const settled = settleImportant(typeof readingsOf === 'function' ? readingsOf(claim) : undefined, claim);
      if (!settled.ok) Object.assign(out, { badge: settled.badge, reason: settled.reason });
    }
    approved.push(out);
  }
  return { approved, rejected };
}
