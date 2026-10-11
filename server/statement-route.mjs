// The statement on the page (sb09, from id98): the server builds it in the background from the transcripts, keeps
// what each file gave (statement-cache.json in the session-map folder, so a restart does not read 4 GB again), and
// answers three reads, all as private as the chats themselves (the page's token, never the look-only key):
//   GET /api/statement?days=30            the sums, the chats with their agents, the account, and whether it is reading
//   GET /api/statement/rows?days=30&…     one page of lines, newest first, filtered by day, chat, who or words
//   GET /api/statement.csv?days=30&…      the same lines for Excel
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountSnapshot, buildStatement, detailCsv, filterRows, rowOut, statementSummary } from './statement.mjs';
import { loadPrices } from './cost.mjs';

const CACHE_FILE = 'statement-cache.json';
const CACHE_VERSION = 1;
const FRESH_MS = 60_000; // a statement younger than this is served as is
const DAY = 86_400_000;
export const DAYS_ALLOWED = [1, 7, 30, 90];
const PAGE_MAX = 500;

function readCache(smDir) {
  try {
    const o = JSON.parse(readFileSync(join(smDir, CACHE_FILE), 'utf8'));
    // A broken entry is a miss, never an error: only what has a time, a size and its replies is kept.
    const ok = (e) => Number.isFinite(e?.mtimeMs) && Number.isFinite(e?.size) && Array.isArray(e?.data?.replies);
    if (o?.version === CACHE_VERSION && o.files && typeof o.files === 'object') return new Map(Object.entries(o.files).filter(([, e]) => ok(e)));
  } catch { /* none yet, or broken: start over */ }
  return new Map();
}

function writeCache(smDir, cache) {
  const file = join(smDir, CACHE_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files: Object.fromEntries(cache) }));
  renameSync(tmp, file);
}

export function createStatementStore({ projectsDir, smDir, account = () => accountSnapshot(), prices = () => loadPrices(), now = () => Date.now() }) {
  let cache = null;
  let current = null; // { days, builtAt, st, summary }
  let building = null; // { days, done, of, promise }
  let failed = null; // { at, error }: a failed build is told to the page and not tried again for a minute

  function build(days) {
    if (building) return building.promise;
    building = { days, done: 0, of: 0, promise: null };
    const run = building;
    run.promise = (async () => {
      cache ??= smDir && existsSync(smDir) ? readCache(smDir) : new Map();
      const at = now();
      const since = at - days * DAY;
      const st = await buildStatement({ projectsDir, since, prices: prices(), cache, onProgress: (done, of) => { run.done = done; run.of = of; } });
      // Keep only the files still in use, so the cache does not grow forever.
      for (const [file, entry] of [...cache]) {
        if (!(entry.mtimeMs >= since || entry.data?.replies?.some((r) => r.ts >= since))) {
          cache.delete(file);
          cache.dirty = true;
        }
      }
      // Written only when a file was read again or dropped: the page asks every minute and nothing may have changed.
      if (cache.dirty && smDir && existsSync(smDir)) {
        try { writeCache(smDir, cache); cache.dirty = false; } catch { /* the next build reads again; nothing is lost */ }
      }
      let pricesAsOf = null;
      try { pricesAsOf = JSON.parse(readFileSync(new URL('./prices.json', import.meta.url), 'utf8'))._asOf ?? null; } catch { /* keep null */ }
      current = { days, builtAt: now(), st, summary: statementSummary(st, { account: account(), since, generatedAt: now(), pricesAsOf }) };
      failed = null;
      return current;
    })().finally(() => { building = null; });
    run.promise.catch((e) => { failed = { at: now(), error: String(e?.code ?? e?.message ?? e).slice(0, 120) }; });
    return run.promise;
  }

  // Starts a build when there is none for these days or it is older than a minute; never waits for it.
  function ensure(days) {
    const stale = !current || current.days !== days || now() - current.builtAt > FRESH_MS;
    const resting = failed && now() - failed.at < FRESH_MS;
    if (stale && !building && !resting) build(days);
  }

  return {
    build,
    status(days) {
      ensure(days);
      const ready = current?.days === days ? current : null;
      return {
        days,
        reading: building ? { done: building.done, of: building.of } : null,
        builtAt: ready?.builtAt ?? null,
        summary: ready?.summary ?? null,
        failed: failed?.error ?? null,
      };
    },
    rows(days, filter = {}, offset = 0, limit = 100) {
      if (current?.days !== days) return null;
      const list = filterRows(current.st, filter).sort((a, b) => b.ts - a.ts);
      const from = Math.max(0, offset);
      const to = from + Math.min(PAGE_MAX, Math.max(1, limit));
      return { total: list.length, offset: from, rows: list.slice(from, to).map((r) => rowOut(current.st, r)) };
    },
    csv(days, filter = {}) {
      if (current?.days !== days) return null;
      return detailCsv(current.st, filterRows(current.st, filter));
    },
  };
}

const daysOf = (url) => {
  const n = Number.parseInt(url.searchParams.get('days') ?? '30', 10);
  return DAYS_ALLOWED.includes(n) ? n : 30;
};
const filterOf = (url) => ({
  day: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day') : '',
  chat: (url.searchParams.get('chat') ?? '').slice(0, 100),
  who: (url.searchParams.get('who') ?? '').slice(0, 300),
  q: (url.searchParams.get('q') ?? '').slice(0, 200),
});

export const isStatementPath = (path) => path === '/api/statement' || path === '/api/statement/rows' || path === '/api/statement.csv';

// send(res, status, body) and HttpError come from the server; allowed is false for the demo, the look-only key or a
// page without the token.
export function statementRoute({ store, send, HttpError }, req, res, url, allowed) {
  if (req.method !== 'GET') throw new HttpError(405, 'method');
  if (!allowed.ok) throw new HttpError(allowed.status, allowed.error);
  const days = daysOf(url);
  if (url.pathname === '/api/statement') return send(res, 200, store.status(days));
  if (url.pathname === '/api/statement/rows') {
    const int = (name, fallback) => {
      const n = Number(url.searchParams.get(name) ?? fallback);
      if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, `bad-${name}`);
      return n;
    };
    const page = store.rows(days, filterOf(url), int('offset', 0), int('limit', 100));
    if (!page) return send(res, 409, { error: 'statement-reading' });
    return send(res, 200, page);
  }
  const csv = store.csv(days, filterOf(url));
  if (csv === null) return send(res, 409, { error: 'statement-reading' });
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="extrato-claude-${days}d.csv"`,
    'cache-control': 'no-store',
  });
  return res.end(csv);
}
