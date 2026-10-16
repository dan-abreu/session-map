import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { readJsonFile, writeAtomic } from '../store.mjs';
import { PROVIDERS } from './providers.mjs';

// The price pages watch (or51): every provider's official price page is fetched at most once a day, and a change in
// the page's text goes out as one alert — the owner re-checks the numbers by hand. Nothing is parsed into the tables:
// a wrong price written by a robot is worse than a stale one whose date is shown. No key is needed: these are public
// pages, so a look costs no tokens.

export const PRICE_FILE = 'ai-prices.json';
export const DAY_MS = 24 * 60 * 60 * 1000;
const FORCE_GAP_MS = 60_000;
const TIMEOUT_MS = 60_000;
const BODY_MAX_BYTES = 2 * 1024 * 1024;

// The official page each price table was checked against by hand (prices.json and providers.mjs).
export const PRICE_SOURCES = Object.freeze([
  { id: 'anthropic', url: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  ...Object.values(PROVIDERS).map((p) => ({ id: p.id, url: p.priceSource })),
]);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const sha1 = (text) => createHash('sha1').update(text).digest('hex');

// The clean state: {checks: {id: {hash, checkedAt, changedAt?, failedAt?}}}. Anything that does not fit is dropped, so a broken
// file degrades to "no knowledge", never to a wrong alert.
export function pricesWatchState(raw) {
  const checks = {};
  const entries = isObject(raw?.checks) ? raw.checks : {};
  for (const s of PRICE_SOURCES) {
    const e = isObject(entries[s.id]) ? entries[s.id] : {};
    const entry = {};
    if (typeof e.hash === 'string' && /^[0-9a-f]{40}$/.test(e.hash)) entry.hash = e.hash;
    if (Number.isFinite(Date.parse(e.checkedAt))) entry.checkedAt = e.checkedAt;
    if (Number.isFinite(Date.parse(e.changedAt))) entry.changedAt = e.changedAt;
    if (Number.isFinite(Date.parse(e.failedAt))) entry.failedAt = e.failedAt;
    if (Object.keys(entry).length) checks[s.id] = entry;
  }
  return { checks };
}

export const pricesFile = (smDir) => join(smDir, PRICE_FILE);

// What the page shows: per source, when it was last checked and when it last changed.
export function pricesView(smDir) {
  if (!smDir) return {};
  const { checks } = pricesWatchState(readJsonFile(pricesFile(smDir), null));
  return checks;
}

// One bounded GET, like versions.mjs: the page's text or a short error code. Never a key, never a body in an error.
async function fetchPage(source, fetchFn) {
  let res;
  try {
    res = await fetchFn(source.url, { method: 'GET', headers: { Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!res?.ok) {
    if (typeof res?.body?.cancel === 'function') await res.body.cancel().catch(() => {});
    else await res?.text?.().catch(() => {});
    return { ok: false, error: `http-${Number(res?.status) || 0}` };
  }
  try {
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = await res.text();
      return text.length > BODY_MAX_BYTES ? { ok: false, error: 'bad-output' } : { ok: true, text };
    }
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: 'bad-output' };
      }
      chunks.push(value);
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
  } catch {
    return { ok: false, error: 'bad-output' };
  }
}

// -> {run({force}) : Promise<{alerts, checked, skipped, forced}>}. fetchFn and now are the tests' doubles.
export function createPricesWatch({ smDir, fetchFn = globalThis.fetch, now = Date.now, onAlerts = () => {} } = {}) {
  let running = null;
  let lastRunAt = -Infinity;
  const readState = () => pricesWatchState(readJsonFile(pricesFile(smDir), null));

  async function look(force) {
    const at = now();
    const before = readState();
    const checks = { ...before.checks };
    const checked = [];
    const skipped = [];
    const alerts = [];
    for (const s of PRICE_SOURCES) {
      const prev = checks[s.id];
      // A page that answered is not asked again for a day; a page that failed is not asked again for a day either (a page
      // that refuses us would otherwise be asked, and logged, at every look).
      const last = Math.max(prev?.checkedAt ? Date.parse(prev.checkedAt) : -Infinity, prev?.failedAt ? Date.parse(prev.failedAt) : -Infinity);
      if (!force && at - last < DAY_MS) { skipped.push({ id: s.id, why: prev?.failedAt && Date.parse(prev.failedAt) === last ? 'failed' : 'fresh' }); continue; }
      checked.push(s.id);
      const got = await fetchPage(s, fetchFn);
      if (!got.ok) {
        log('warn', 'ai-prices-failed', { provider: s.id, error: got.error });
        checks[s.id] = { ...(prev ?? {}), failedAt: new Date(at).toISOString() };
        continue;
      }
      const hash = sha1(got.text);
      const stamp = new Date(at).toISOString();
      checks[s.id] = {
        hash, checkedAt: stamp,
        ...(prev?.hash && prev.hash !== hash ? { changedAt: stamp } : {}),
        ...(!(prev?.hash && prev.hash !== hash) && prev?.changedAt ? { changedAt: prev.changedAt } : {}),
      };
      // A change is one alert, never repeated while the page stays on its new shape; the first look only baselines.
      if (prev?.hash && prev.hash !== hash) alerts.push({ kind: 'aiprice', reason: 'aip-changed', projectId: null, projectName: '', sessionId: null, provider: s.id, checkedAt: stamp });
    }
    if (checked.length) {
      lastRunAt = at;
      try { writeAtomic(pricesFile(smDir), `${JSON.stringify({ version: 1, updatedAt: new Date(at).toISOString(), checks }, null, 1)}\n`); } catch (err) { log('warn', 'ai-prices-save-failed', { error: err.message }); }
    }
    if (alerts.length) {
      try { onAlerts(alerts); } catch (err) { log('warn', 'ai-prices-alert-failed', { error: err.message }); }
    }
    return { alerts, checked, skipped, forced: force };
  }

  // A run asked while one is going shares it. "Check now" skips the wait of a day, never the minute between two looks.
  const run = (options = {}) => {
    if (running) return running;
    const gap = Number.isFinite(options.minForceMs) ? options.minForceMs : FORCE_GAP_MS;
    const force = options.force === true && now() - lastRunAt >= gap;
    running = look(force).finally(() => { running = null; });
    return running;
  };
  return { run };
}
