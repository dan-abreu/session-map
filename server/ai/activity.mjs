import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { redact } from './redact.mjs';
import { SENSITIVITIES } from './router.mjs';

// What the other AIs did (or14): one JSON line in smDir/ai-activity.jsonl for every outside call, whether Claude asked
// (/api/ai/ask) or the map's bulk queue did. A line holds who, what kind of work, how private it was, what it cost and
// whether it worked: NEVER the prompt, the answer or a key (every field is picked by name, never copied whole). Claude
// later says whether it accepted the work: that is a second kind of line ({type: 'result'}) appended beside the
// first, and the reader joins them. The file is bounded: when it passes MAX_LINES + SLACK it is cut back to MAX_LINES.

export const FILE = 'ai-activity.jsonl';
export const MAX_LINES = 2000;
const SLACK = 200;
export const DEFAULT_LIMIT = 50;
export const LIMIT_MAX = 200;
export const RESULT_WHY_MAX = 300;
export const ID_RE = /^[0-9a-f]{12}$/;
export const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SOURCES = ['chat', 'map'];
const ERROR_RE = /^[a-z0-9-]{1,30}$/;
const KIND_RE = /^[a-z][a-z-]{0,29}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// Counted once per file and kept in memory, so an append does not have to read the file back.
const counts = new Map();

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return redact(value.replace(/\s+/g, ' ').trim()).slice(0, max);
}

// A name that redact() would change looks like a secret: it is dropped instead of shown in a masked form.
const cleanName = (value) => (typeof value === 'string' && NAME_RE.test(value) && redact(value) === value ? value : '');

function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function append(smDir, line) {
  const file = join(smDir, FILE);
  mkdirSync(smDir, { recursive: true });
  let n = counts.get(file);
  if (n === undefined) n = existsSync(file) ? readLines(file).length : 0;
  appendFileSync(file, `${JSON.stringify(line)}\n`);
  n += 1;
  if (n > MAX_LINES + SLACK) {
    const kept = readLines(file).slice(-MAX_LINES);
    writeAtomic(file, `${kept.join('\n')}\n`);
    n = kept.length;
  }
  counts.set(file, n);
}

// entry: {source, sessionId?, kind, sensitivity, provider, model, ms, costUSD, ok, error?, recommendedBy?}.
// -> the id of the new line, or null when it could not be written (a full disk must not stop the work it describes).
export function recordActivity(smDir, entry) {
  if (!smDir || !isObject(entry)) return null;
  const id = randomBytes(6).toString('hex');
  const line = {
    id,
    at: new Date().toISOString(),
    source: SOURCES.includes(entry.source) ? entry.source : 'chat',
    ...(typeof entry.sessionId === 'string' && SESSION_RE.test(entry.sessionId) ? { sessionId: entry.sessionId } : {}),
    kind: typeof entry.kind === 'string' && KIND_RE.test(entry.kind) ? entry.kind : 'other',
    sensitivity: SENSITIVITIES.includes(entry.sensitivity) ? entry.sensitivity : 'client',
    provider: cleanName(entry.provider),
    model: cleanName(entry.model),
    ms: Number.isFinite(entry.ms) && entry.ms > 0 ? Math.round(entry.ms) : 0,
    costUSD: Number.isFinite(entry.costUSD) && entry.costUSD > 0 ? round6(entry.costUSD) : 0,
    // The tokens the provider already counted (or49): kept only when real, so the old lines keep their shape.
    ...(Number.isFinite(entry.tokensIn) && entry.tokensIn > 0 ? { tokensIn: Math.round(entry.tokensIn) } : {}),
    ...(Number.isFinite(entry.tokensOut) && entry.tokensOut > 0 ? { tokensOut: Math.round(entry.tokensOut) } : {}),
    ...(Number.isFinite(entry.cacheHit) && entry.cacheHit > 0 ? { cacheHit: Math.round(entry.cacheHit) } : {}),
    ok: entry.ok === true,
    ...(typeof entry.error === 'string' && ERROR_RE.test(entry.error) ? { error: entry.error } : {}),
    ...(cleanText(entry.recommendedBy, RESULT_WHY_MAX) ? { recommendedBy: cleanText(entry.recommendedBy, RESULT_WHY_MAX) } : {}),
  };
  try {
    append(smDir, line);
  } catch {
    return null;
  }
  return id;
}

// Everything on disk, joined: entries in file order, each with its latest result.
function readAll(smDir) {
  const entries = [];
  const byId = new Map();
  for (const text of readLines(join(smDir, FILE))) {
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    if (!isObject(line) || typeof line.id !== 'string') continue;
    if (line.type === 'result') {
      const target = byId.get(line.id);
      if (target) target.result = { accepted: line.accepted === true, why: typeof line.why === 'string' ? line.why : '', at: line.at };
    } else {
      const item = { ...line };
      entries.push(item);
      byId.set(item.id, item);
    }
  }
  return entries;
}

// -> newest first, at most `limit` (default 50, never more than 200).
export function readActivity(smDir, limit = DEFAULT_LIMIT) {
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, LIMIT_MAX) : DEFAULT_LIMIT;
  return readAll(smDir).reverse().slice(0, n);
}

// Claude says whether it accepted the work of that call. The last word counts. -> {ok: true} or {ok: false, error}.
export function setResult(smDir, id, result) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'bad-id' };
  if (!isObject(result) || typeof result.accepted !== 'boolean' || typeof result.why !== 'string') return { ok: false, error: 'bad-result' };
  if (!readAll(smDir).some((e) => e.id === id)) return { ok: false, error: 'unknown-activity' };
  try {
    append(smDir, { type: 'result', id, at: new Date().toISOString(), accepted: result.accepted, why: cleanText(result.why, RESULT_WHY_MAX) });
  } catch {
    return { ok: false, error: 'not-saved' };
  }
  return { ok: true };
}
