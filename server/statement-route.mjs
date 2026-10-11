// The statement on the page (sb09, sb10, from id98): the server reads the transcripts in the background, keeps what each
// file gave (statement-cache.json in the session-map folder, so a restart does not read 4 GB again), and answers the
// bookkeeping, all as private as the chats themselves (the page's token, never the look-only key):
//   GET /api/statement?from=YYYY-MM-DD&to=YYYY-MM-DD   the period: its total, one line per chat, the account, reading
//   GET /api/statement/chat?id=…&from&to                one chat opened: who worked, files, kinds of work, days
//   GET /api/statement/rows?from&to&chat&who&file&kind&day&q&offset&limit   the replies behind any of those
//   GET /api/statement.csv?…                            the same replies for Excel
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountSnapshot, buildStatement, detailCsv, rowOut } from './statement.mjs';
import { chatLedger, ledgerRows, outsideLedger, periodLedger, periodOf } from './ledger.mjs';
import { loadPrices } from './cost.mjs';

const CACHE_FILE = 'statement-cache.json';
const CACHE_VERSION = 3; // 2: each reply keeps what it did (files, lines); 3: and the lines of each file it read
const FRESH_MS = 60_000; // a statement younger than this is served as is
const DAY = 86_400_000;
const WINDOW_DAYS = 90; // read at least this far back, so any period in it is answered at once
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

// The activity file (ai-activity.jsonl): one line per call to another AI and, since sb11, per session-map Claude call,
// plus the owner's verdict lines, joined to their call. A broken line is skipped.
export function readActivity(smDir) {
  let text = '';
  try { text = readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8'); } catch { return []; }
  const calls = new Map();
  for (const raw of text.split('\n')) {
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o || typeof o.id !== 'string') continue;
    if (o.type === 'result') {
      const c = calls.get(o.id);
      if (c) c.accepted = o.accepted === true;
      continue;
    }
    const at = Date.parse(o.at);
    if (!Number.isFinite(at) || typeof o.provider !== 'string') continue;
    calls.set(o.id, { at, source: o.source === 'map' ? 'map' : 'chat', provider: o.provider, model: typeof o.model === 'string' ? o.model : '',
      kind: typeof o.kind === 'string' ? o.kind : 'other', costUSD: Number.isFinite(o.costUSD) && o.costUSD > 0 ? o.costUSD : 0, ok: o.ok === true });
  }
  return [...calls.values()];
}

function writeCache(smDir, cache) {
  const file = join(smDir, CACHE_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files: Object.fromEntries(cache) }));
  renameSync(tmp, file);
}

export function createStatementStore({ projectsDir, smDir, account = () => accountSnapshot(), prices = () => loadPrices(), now = () => Date.now() }) {
  let cache = null;
  let current = null; // { since, builtAt, st, pricesAsOf }
  let building = null; // { since, done, of, promise }
  let failed = null; // { at, error }: a failed build is told to the page and not tried again for a minute

  function build(since) {
    if (building) return building.promise;
    building = { since, done: 0, of: 0, promise: null };
    const run = building;
    run.promise = (async () => {
      cache ??= smDir && existsSync(smDir) ? readCache(smDir) : new Map();
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
      current = { since, builtAt: now(), st, pricesAsOf };
      failed = null;
      return current;
    })().finally(() => { building = null; });
    run.promise.catch((e) => { failed = { at: now(), error: String(e?.code ?? e?.message ?? e).slice(0, 120) }; });
    return run.promise;
  }

  // The window to read for a period: at least the last 90 days, more when the period starts earlier.
  const windowFor = (period) => {
    const d = new Date(Math.min(period.from, now() - WINDOW_DAYS * DAY));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const covers = (period) => current && current.since <= period.from;

  // Starts a build when the period is not covered or the last one is older than a minute; never waits for it.
  function ensure(period) {
    const stale = !covers(period) || now() - current.builtAt > FRESH_MS;
    const resting = failed && now() - failed.at < FRESH_MS;
    if (stale && !building && !resting) build(windowFor(period));
  }

  return {
    build: (period) => build(windowFor(period)),
    status(period) {
      ensure(period);
      const ready = covers(period) ? current : null;
      return {
        reading: building ? { done: building.done, of: building.of } : null,
        failed: failed?.error ?? null,
        builtAt: ready?.builtAt ?? null,
        period: ready ? {
          ...periodLedger(ready.st, period),
          account: account(),
          events: (ready.st.events ?? []).filter((e) => e.at >= period.from && e.at < period.to),
          pricesAsOf: ready.pricesAsOf,
          readSince: ready.since,
          outside: outsideLedger(smDir ? readActivity(smDir) : [], period),
        } : null,
      };
    },
    chat(period, id) {
      return covers(period) ? chatLedger(current.st, id, period) : undefined;
    },
    rows(period, filter = {}, offset = 0, limit = 100) {
      if (!covers(period)) return null;
      // A statement's running balance: what was spent from the period's start up to and including each line.
      const list = ledgerRows(current.st, period, filter).sort((a, b) => a.ts - b.ts);
      let balance = 0;
      const balances = list.map((r) => (balance += r.cost?.total ?? 0));
      const newest = list.map((r, i) => [r, balances[i]]).reverse();
      const to = offset + Math.min(PAGE_MAX, Math.max(1, limit));
      return { total: list.length, offset, sumUsd: Math.round(balance * 1e6) / 1e6,
        rows: newest.slice(offset, to).map(([r, b]) => ({ ...rowOut(current.st, r), balance: Math.round(b * 1e6) / 1e6 })) };
    },
    csv(period, filter = {}) {
      return covers(period) ? detailCsv(current.st, ledgerRows(current.st, period, filter)) : null;
    },
  };
}

const PATHS = new Set(['/api/statement', '/api/statement/chat', '/api/statement/rows', '/api/statement.csv']);
export const isStatementPath = (path) => PATHS.has(path);

const filterOf = (url) => ({
  day: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day') : '',
  project: (url.searchParams.get('project') ?? '').slice(0, 200),
  chat: (url.searchParams.get('chat') ?? '').slice(0, 100),
  who: (url.searchParams.get('who') ?? '').slice(0, 300),
  file: (url.searchParams.get('file') ?? '').slice(0, 1000),
  kind: (url.searchParams.get('kind') ?? '').slice(0, 20),
  q: (url.searchParams.get('q') ?? '').slice(0, 200),
});

// send(res, status, body) and HttpError come from the server; allowed is false for the demo, the look-only key or a
// page without the token.
export function statementRoute({ store, send, HttpError, now = () => Date.now() }, req, res, url, allowed) {
  if (req.method !== 'GET') throw new HttpError(405, 'method');
  if (!allowed.ok) throw new HttpError(allowed.status, allowed.error);
  const period = periodOf({ from: url.searchParams.get('from') ?? '', to: url.searchParams.get('to') ?? '' }, now());
  if (url.pathname === '/api/statement') return send(res, 200, store.status(period));
  if (url.pathname === '/api/statement/chat') {
    const book = store.chat(period, (url.searchParams.get('id') ?? '').slice(0, 100));
    if (book === undefined) return send(res, 409, { error: 'statement-reading' });
    if (!book) throw new HttpError(404, 'unknown-session');
    return send(res, 200, book);
  }
  if (url.pathname === '/api/statement/rows') {
    const int = (name, fallback) => {
      const n = Number(url.searchParams.get(name) ?? fallback);
      if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, `bad-${name}`);
      return n;
    };
    const page = store.rows(period, filterOf(url), int('offset', 0), int('limit', 100));
    if (!page) return send(res, 409, { error: 'statement-reading' });
    return send(res, 200, page);
  }
  const csv = store.csv(period, filterOf(url));
  if (csv === null) return send(res, 409, { error: 'statement-reading' });
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="extrato-claude.csv"',
    'cache-control': 'no-store',
  });
  return res.end(csv);
}
