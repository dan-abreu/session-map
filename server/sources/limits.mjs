// The plan's limits (watcher-and-alerts wa09): when Claude Code runs into the weekly or the 5-hour limit it writes a
// synthetic reply into the history ("You've hit your weekly limit · resets Oct 1, 6pm"), with the reset time beside it.
// Pure: one history line in, the hit out; the hits of every history in, the two flags out.

const HOUR = 3_600_000;
// How long a limit can hold at most: used only when a message names no reset time.
const WINDOW_MS = { weekly: 7 * 24 * HOUR, session: 5 * HOUR };
const RESETS_RE = /resets\s+([^·\n]+?)\s*$/i;

// The kind from the words first (a monthly spend limit is not the plan's limit, whatever the quota data says), then from the
// structured quota data (seven_day, five_hour), then from the words again.
function kindOf(entry, text) {
  if (/spend limit/i.test(text)) return null;
  const type = String(entry.quotaLimits?.rateLimitType ?? '');
  if (type.startsWith('seven_day')) return 'weekly';
  if (type === 'five_hour') return 'session';
  if (/weekly limit/i.test(text)) return 'weekly';
  if (/(?:5|five)[- ]hour limit|session limit/i.test(text)) return 'session';
  return null;
}

// One history line → {kind: 'weekly'|'session', resetsAt: ISO or null, resetsText, at} when it is a limit message.
export function limitHitOf(entry) {
  if (entry?.type !== 'assistant' || (entry.error !== 'rate_limit' && entry.isApiErrorMessage !== true)) return null;
  const content = entry.message?.content;
  const text = (Array.isArray(content) ? content : []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  const kind = kindOf(entry, text);
  if (!kind) return null;
  const seconds = Number(entry.quotaLimits?.resetsAt);
  const resets = new Date(Number.isFinite(seconds) && seconds > 1e9 ? seconds * 1000 : NaN);
  return {
    kind,
    resetsAt: Number.isFinite(resets.getTime()) ? resets.toISOString() : null,
    resetsText: text.match(RESETS_RE)?.[1] ?? null,
    at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
  };
}

const none = { hit: false, resetsAt: null, resetsText: null };

// The hits read from every history → {weekly, session}: {hit, resetsAt, resetsText}. The newest hit of a kind decides, and
// it holds until its reset time (or, with none written, until the longest the limit can last).
export function planLimits(hits, nowMs) {
  const out = { weekly: none, session: none };
  for (const kind of Object.keys(out)) {
    const newest = hits.filter((h) => h?.kind === kind).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || 0)[0];
    if (!newest) continue;
    const until = newest.resetsAt ? Date.parse(newest.resetsAt) : Date.parse(newest.at) + WINDOW_MS[kind];
    if (until > nowMs) out[kind] = { hit: true, resetsAt: newest.resetsAt, resetsText: newest.resetsText };
  }
  return out;
}
