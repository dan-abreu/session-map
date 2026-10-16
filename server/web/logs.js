// The Logs tab, the numbers (mm61): the program's own diary read as a person reads it. Pure: no DOM, no clock of its own.
// The lines come from GET /api/logs (sv19) and GET /api/logs/projects/<id> (wa11), newest first, one object per line:
// { v, ts, level: info|warn|error, event, ...fields }. Here they become groups ("the same problem, 10 times"), and the
// words for each group are chosen by key; the texts live in i18n-fd/screens-logs.js.

export const RECENT_MS = 24 * 3600 * 1000;
export const RAW_PER_GROUP = 5;

const SEVERITY = { error: 0, warn: 1 };
const AI_NAME = { claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', openai: 'OpenAI', openrouter: 'OpenRouter' };

// The events a person is helped by a plain sentence for; any other event is shown by its own name.
// takesProvider: the sentence has a {provider} in it.
export const PROBLEM_EVENTS = {
  'ai-prices-failed': { provider: true },
  'ai-api-failed': { provider: true },
  'ai-balance-failed': { provider: true },
  'ai-helper-fallback': { provider: true },
  'ai-versions-failed': { provider: true },
  'ai-job-failed': {},
  'ai-call-failed': {},
  'request-failed': {},
  'foundation-request-failed': {},
  'restart-resume-failed': {},
  'restart-spawn-failed': {},
  'orchestra-deliver-failed': {},
  'orchestra-resume-failed': {},
  'orchestra-drain-failed': {},
  'alert-delivery-failed': {},
  'ntfy-failed': {},
  'toast-failed': {},
  'safety-snapshot-failed': {},
  'github-api-failed': {},
  'versions-online-failed': {},
  'care-rollback-failed': {},
  'care-op-failed': {},
  'care-undo-failed': {},
  'launch-failed': {},
  'action-log-failed': {},
  'log-file-failed': {},
};

export const ROUTINE_EVENTS = ['listening', 'restarting', 'restart-requested', 'action', 'status-marked', 'ai-ask', 'care-mode', 'orchestra-archived'];

// The watcher's kinds in a project's record (watcher-and-alerts.md).
export const PROJECT_KINDS = ['waiting', 'finished', 'error', 'clash', 'budget', 'limit'];

export const providerName = (p) => (typeof p === 'string' && p ? AI_NAME[p] ?? p : '');

const isProblem = (row) => row && (row.level === 'warn' || row.level === 'error');

// Sentence for the reason, as a key and its variables; null when the line has no reason to say.
export function reasonOf(row) {
  const raw = typeof row.error === 'string' ? row.error : typeof row.code === 'string' ? row.code : null;
  if (!raw) return null;
  const http = /^http-(\d{3})$/.exec(raw);
  if (http) {
    const code = Number(http[1]);
    if (code === 401) return { key: 'logs.why.http401', vars: { code } };
    if (code === 403) return { key: 'logs.why.http403', vars: { code } };
    if (code === 429) return { key: 'logs.why.http429', vars: { code } };
    if (code >= 500) return { key: 'logs.why.http5xx', vars: { code } };
    return { key: 'logs.why.http', vars: { code } };
  }
  if (raw === 'answer-cut') return { key: 'logs.why.answer-cut', vars: {} };
  if (raw === 'network') return { key: 'logs.why.network', vars: {} };
  if (raw === 'timeout' || raw === 'ETIMEDOUT') return { key: 'logs.why.timeout', vars: {} };
  if (raw === 'invalid-answer') return { key: 'logs.why.invalid-answer', vars: {} };
  if (raw.startsWith('quota-')) return { key: 'logs.why.quota', vars: {} };
  if (raw === 'EACCES' || raw === 'EPERM') return { key: 'logs.why.denied', vars: {} };
  if (raw === 'ENOSPC') return { key: 'logs.why.disk-full', vars: {} };
  return { key: 'logs.why.other', vars: { error: raw.slice(0, 160) } };
}

// The same problem is one group: same level, event, provider, error and code. Newest group first within a severity
// (errors before warnings). Each group keeps its count, the first and last time and the newest raw lines.
export function groupProblems(rows, { now = Date.now(), recentMs = RECENT_MS } = {}) {
  const groups = new Map();
  for (const row of rows ?? []) {
    if (!isProblem(row) || typeof row.event !== 'string') continue;
    const key = [row.level, row.event, row.provider ?? '', row.error ?? '', row.code ?? ''].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { key, level: row.level, event: row.event, provider: typeof row.provider === 'string' ? row.provider : '', reason: reasonOf(row), count: 0, first: row.ts, last: row.ts, raw: [] };
      groups.set(key, g);
    }
    g.count += 1;
    if (typeof row.ts === 'string') {
      if (!g.first || row.ts < g.first) g.first = row.ts;
      if (!g.last || row.ts > g.last) g.last = row.ts;
    }
    if (g.raw.length < RAW_PER_GROUP) g.raw.push(row); // rows come newest first
  }
  const list = [...groups.values()];
  for (const g of list) g.recent = Boolean(g.last) && now - Date.parse(g.last) <= recentMs;
  return list.sort((a, b) => (SEVERITY[a.level] - SEVERITY[b.level]) || (b.last ?? '').localeCompare(a.last ?? ''));
}

export const routineRows = (rows) => (rows ?? []).filter((r) => r && r.level === 'info');

// The oldest line of the answer: "since" in the header (the files keep 30 days, the route at most 1000 lines).
export function sinceOf(rows) {
  let first = null;
  for (const r of rows ?? []) if (typeof r?.ts === 'string' && (first === null || r.ts < first)) first = r.ts;
  return first;
}

// A project's line, as the person reads it: the watcher's kind and what it said about it.
export function projectLine(row) {
  const kind = typeof row.event === 'string' ? row.event : '';
  const said = [row.title, row.summary, row.reason].find((x) => typeof x === 'string' && x.trim());
  return { kind, known: PROJECT_KINDS.includes(kind), said: said ? said.trim().slice(0, 240) : '', ts: row.ts };
}

// A short fingerprint of an answer, to redraw only when something new arrived.
// No answer yet (null) differs from an empty answer, so the page leaves "reading" even when nothing was written.
export const rowsSignature = (rows) => (Array.isArray(rows) ? `${rows.length}:${rows[0]?.ts ?? ''}` : 'none');
