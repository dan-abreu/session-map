import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { providerOf } from './providers.mjs';

// Which AI takes which kind of work (or14, id22): the owner only pastes keys and sets one daily cap; this picks.
// route() orders the candidates for one job, spread() splits a batch over all of them at once. Claude is a candidate
// like the others (provider 'claude', model haiku|sonnet|opus); the caller says who is available right now.
//
// Until the bench (server/bench) measures them, the order is the research of 2026-10-10 (docs/architecture/
// orchestration.md or05). The bench then writes smDir/bench/routing.json, shaped:
//   { "updatedAt": "<ISO date>",
//     "entries": [ { "kind": "bulk|review|code|read|portuguese|reasoning" (or the bench's classify|pt),
//                    "contestant": "<provider>:<model>", e.g. "claude:haiku", "openai:gpt-6-luna",
//                    "accuracy": 0..1, "costPerCorrectUSD": dollars per right answer, "n": answers measured } ] }
// Entries measured fewer than MIN_MEASURED times say too little and are ignored.

export const ROUTE_KINDS = Object.freeze(['bulk', 'review', 'code', 'read', 'portuguese', 'reasoning']);
// public: open-source code, public docs. internal: the owner's own data that is not a client's. client: a client's
// code or any personal data.
export const SENSITIVITIES = Object.freeze(['public', 'internal', 'client']);
const KIND_ALIASES = Object.freeze({ place: 'bulk', classify: 'bulk', pt: 'portuguese' });
const MIN_MEASURED = 20;
// Among measured candidates this close to the best, the cheapest per right answer goes first.
const NEAR_BEST = Object.freeze({ bulk: 0.05 });
const NEAR_BEST_DEFAULT = 0.02;
// spread() leaves out a measured candidate this far below the best: cheap is no use when it is often wrong.
const SPREAD_FLOOR = 0.1;
// Gemini reads long text in pieces of about 128k tokens; at ~3 characters a token.
const GEMINI_PIECE_CHARS = 380_000;

export const routeKindOf = (kind) => {
  const k = Object.hasOwn(KIND_ALIASES, kind) ? KIND_ALIASES[kind] : kind;
  return ROUTE_KINDS.includes(k) ? k : null;
};

const PAID_GEMINI = 'only with a key from a project with billing on: the free tier may train on what is sent';
const row = (provider, model, why, extra = {}) => Object.freeze({ provider, model, why, ...extra });

export const DEFAULT_TABLE = Object.freeze({
  bulk: Object.freeze([
    row('claude', 'haiku', 'research 2026-10-10: best bulk sorter'),
    row('openai', 'gpt-6-luna', 'research 2026-10-10: cheap bulk labels', { note: 'it guesses instead of saying "I do not know": its answers are always checked' }),
    row('gemini', 'gemini-3.1-flash-lite', `research 2026-10-10: cheap and fast; ${PAID_GEMINI}`),
    row('deepseek', 'deepseek-flash', 'research 2026-10-10: cheapest; public data only'),
    row('openrouter', 'deepseek/deepseek-v4.1-flash', 'backup through OpenRouter; public data only while the model is DeepSeek'),
  ]),
  // Claude conducts, so a review is first for what Claude wrote: another family. route() moves Opus to the front
  // when another AI wrote it.
  review: Object.freeze([
    row('openai', 'gpt-6.1-sol', 'research 2026-10-10: second opinion from another family'),
    row('gemini', 'gemini-3.8-flash', `research 2026-10-10: backup reviewer; ${PAID_GEMINI}`),
    row('deepseek', 'deepseek-v4-pro', 'research 2026-10-10: backup reviewer; public code only'),
    row('claude', 'opus', 'research 2026-10-10: reviews what another AI wrote'),
  ]),
  code: Object.freeze([
    row('claude', 'sonnet', 'research 2026-10-10: best code draft'),
    row('openai', 'gpt-6.1-sol', 'research 2026-10-10: second code drafter'),
    row('deepseek', 'deepseek-v4-pro', 'research 2026-10-10: public code only'),
  ]),
  read: Object.freeze([
    row('claude', 'sonnet', 'research 2026-10-10: best long reader'),
    row('openai', 'gpt-6.1-sol', 'research 2026-10-10: second long reader'),
    row('gemini', 'gemini-3.8-flash', `research 2026-10-10: reads in pieces up to ~128k tokens; ${PAID_GEMINI}`, { maxPromptChars: GEMINI_PIECE_CHARS }),
  ]),
  portuguese: Object.freeze([
    row('claude', 'sonnet', 'research 2026-10-10: best Brazilian Portuguese'),
    row('claude', 'opus', 'research 2026-10-10: Brazilian Portuguese for important texts'),
    row('openai', 'gpt-6.1-sol', 'research 2026-10-10: backup for Brazilian Portuguese'),
  ]),
  reasoning: Object.freeze([
    row('claude', 'opus', 'research 2026-10-10: hardest reasoning'),
    row('openai', 'gpt-6-astra', 'research 2026-10-10: independent check of hard reasoning'),
  ]),
});

const FAMILY_OF_PROVIDER = Object.freeze({ claude: 'anthropic', openai: 'openai', gemini: 'google', deepseek: 'deepseek' });

// The company behind the model: a review must come from another one, and DeepSeek's rules follow its models anywhere.
export function familyOf(provider, model) {
  if (Object.hasOwn(FAMILY_OF_PROVIDER, provider)) return FAMILY_OF_PROVIDER[provider];
  if (provider === 'openrouter') {
    const m = String(model ?? '').toLowerCase();
    // Any name that mentions DeepSeek, and OpenRouter's own router (it may pick DeepSeek), follow DeepSeek's rules.
    if (m.includes('deepseek') || m.startsWith('openrouter/')) return 'deepseek';
    return m.split('/')[0] || 'unknown';
  }
  return 'unknown';
}

// author: a provider id ('claude', 'openai'), a contestant ('openrouter:google/x') or a family ('google').
function authorFamily(author) {
  const a = String(author ?? 'claude');
  const at = a.indexOf(':');
  if (at > 0) return familyOf(a.slice(0, at), a.slice(at + 1));
  if (Object.hasOwn(FAMILY_OF_PROVIDER, a)) return FAMILY_OF_PROVIDER[a];
  return a.toLowerCase();
}

// DeepSeek keeps what it is sent in China and may train on it: public data only. A direct Gemini key may be a free-tier
// one, whose data Google may use (nothing here can tell): never client data. An unknown class is the strictest.
function allowedFor(sensitivity, family, provider) {
  const s = SENSITIVITIES.includes(sensitivity) ? sensitivity : 'client';
  if (family === 'deepseek') return s === 'public';
  if (provider === 'gemini') return s !== 'client';
  return true;
}

const knownProvider = (p) => p === 'claude' || Boolean(providerOf(p));

function parseContestant(id) {
  const s = String(id ?? '');
  const at = s.indexOf(':');
  if (at <= 0 || at === s.length - 1) return null;
  const provider = s.slice(0, at);
  return knownProvider(provider) ? { provider, model: s.slice(at + 1) } : null;
}

const pct = (x) => `${Math.round(x * 100)}%`;

// -> {candidates: [{provider, model, family, why, note?, maxPromptChars?, measured?}], skipped: [{provider, model, why}]}
// available: provider ids usable right now (key, switched on, not paused, under the cap), 'claude' included or not.
// stats: loadStats() entries. models: {provider: model} the owner pinned, for bulk work only.
export function explainRoute({ kind, sensitivity, author, available = [], stats = [], models = {} } = {}) {
  const k = routeKindOf(kind);
  if (!k) return { candidates: [], skipped: [] };
  const avail = new Set(available);
  const measured = new Map((Array.isArray(stats) ? stats : [])
    .filter((e) => routeKindOf(e?.kind) === k && parseContestant(e.contestant))
    .map((e) => [e.contestant, e]));
  // A pin is for bulk work only: a review or hard reasoning keeps the model the table chose for it.
  const pin = (provider, model) => (k === 'bulk' && provider !== 'claude' && typeof models?.[provider] === 'string' && models[provider] ? models[provider] : model);

  let rows = [...DEFAULT_TABLE[k]];
  const writer = authorFamily(author);
  if (k === 'review' && writer !== 'anthropic') rows = [...rows.filter((r) => r.provider === 'claude'), ...rows.filter((r) => r.provider !== 'claude')];
  for (const id of measured.keys()) {
    const c = parseContestant(id);
    if (!rows.some((r) => r.provider === c.provider && r.model === c.model)) rows.push(row(c.provider, c.model, 'measured by the bench'));
  }

  const seen = new Set();
  const candidates = [];
  const skipped = [];
  for (const r of rows) {
    const model = pin(r.provider, r.model);
    const id = `${r.provider}:${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const family = familyOf(r.provider, model);
    if (!avail.has(r.provider)) { skipped.push({ provider: r.provider, model, why: 'not-available' }); continue; }
    if (!allowedFor(sensitivity, family, r.provider)) { skipped.push({ provider: r.provider, model, why: 'sensitivity' }); continue; }
    if (k === 'review' && family === writer) { skipped.push({ provider: r.provider, model, why: 'same-family' }); continue; }
    const m = measured.get(id);
    const c = { provider: r.provider, model, family, why: model === r.model ? r.why : `${r.why}; model pinned by the owner` };
    if (r.note) c.note = r.note;
    if (r.maxPromptChars) c.maxPromptChars = r.maxPromptChars;
    if (m) {
      c.measured = { accuracy: m.accuracy, costPerCorrectUSD: m.costPerCorrectUSD, n: m.n };
      c.why = `measured: ${pct(m.accuracy)} right, $${m.costPerCorrectUSD} per right answer (n=${m.n})`;
    }
    candidates.push(c);
  }

  const withData = candidates.filter((c) => c.measured);
  const without = candidates.filter((c) => !c.measured);
  if (!withData.length) return { candidates, skipped };
  const best = Math.max(...withData.map((c) => c.measured.accuracy));
  const near = Object.hasOwn(NEAR_BEST, k) ? NEAR_BEST[k] : NEAR_BEST_DEFAULT;
  const cost = (c) => (Number.isFinite(c.measured.costPerCorrectUSD) ? c.measured.costPerCorrectUSD : Infinity);
  const top = withData.filter((c) => c.measured.accuracy >= best - near).sort((a, b) => cost(a) - cost(b));
  const rest = withData.filter((c) => c.measured.accuracy < best - near).sort((a, b) => b.measured.accuracy - a.measured.accuracy);
  return { candidates: [...top, ...rest, ...without], skipped };
}

export const route = (args) => explainRoute(args).candidates;

// Quality per dollar: right answers per dollar, weighted again by how often it is right. Without data, all equal.
export function laneWeights(candidates) {
  const raw = candidates.map((c) => (c.measured && c.measured.accuracy > 0 && c.measured.costPerCorrectUSD > 0
    ? c.measured.accuracy / c.measured.costPerCorrectUSD : null));
  const known = raw.filter((w) => w !== null);
  const fill = known.length ? known.reduce((a, w) => a + w, 0) / known.length : 1;
  return raw.map((w) => (w === null ? fill : w));
}

// The next job goes where it adds least to that lane's share: (load + 1) / weight, ties to the first in line.
export function pickLane(weights, load) {
  let at = -1;
  let bestScore = Infinity;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    const score = ((load[i] ?? 0) + 1) / w;
    if (score < bestScore) { bestScore = score; at = i; }
  });
  return at;
}

// Splits n bulk jobs over every qualifying candidate at once -> [{provider, model, n}] in route order.
export function spread({ candidates = [], n = 0 } = {}) {
  const best = Math.max(-Infinity, ...candidates.filter((c) => c.measured).map((c) => c.measured.accuracy));
  const qualifying = candidates.filter((c) => !c.measured || c.measured.accuracy >= best - SPREAD_FLOOR);
  if (!qualifying.length) return [];
  const weights = laneWeights(qualifying);
  const counts = qualifying.map(() => 0);
  for (let i = 0; i < n; i++) counts[pickLane(weights, counts)]++;
  return qualifying.map((c, i) => ({ provider: c.provider, model: c.model, n: counts[i] }));
}

export const routingFile = (smDir) => join(smDir, 'bench', 'routing.json');

const statsMemo = new Map();

// The bench's measured results, or [] without them. Re-read only when the file changes (time or size).
export function loadStats(smDir) {
  const path = routingFile(smDir);
  let mtime;
  try { const st = statSync(path); mtime = `${st.mtimeMs}:${st.size}`; } catch { statsMemo.delete(path); return []; }
  const memo = statsMemo.get(path);
  if (memo?.mtime === mtime) return memo.entries;
  let entries = [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    entries = (Array.isArray(data?.entries) ? data.entries : [])
      .filter((e) => routeKindOf(e?.kind) && parseContestant(e.contestant)
        && Number.isFinite(e.accuracy) && e.accuracy >= 0 && e.accuracy <= 1
        && Number.isFinite(e.costPerCorrectUSD) && e.costPerCorrectUSD >= 0
        && Number.isInteger(e.n) && e.n >= MIN_MEASURED)
      .map((e) => ({ kind: routeKindOf(e.kind), contestant: e.contestant, accuracy: e.accuracy, costPerCorrectUSD: e.costPerCorrectUSD, n: e.n }));
  } catch { entries = []; }
  statsMemo.set(path, { mtime, entries });
  return entries;
}

// The model a provider would use for bulk work: what the page shows next to it.
export function bulkModelOf(provider, models = {}) {
  if (typeof models?.[provider] === 'string' && models[provider]) return models[provider];
  return DEFAULT_TABLE.bulk.find((r) => r.provider === provider)?.model ?? providerOf(provider)?.defaultModel ?? null;
}
