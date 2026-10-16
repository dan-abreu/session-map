import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPricesWatch, pricesFile, pricesWatchState, pricesView, PRICE_SOURCES } from '../server/ai/prices-watch.mjs';

// The price pages watch (or51): each official price page is fetched at most once a day, a change goes out as one
// alert, and nothing is parsed into the tables — the owner re-checks the numbers by hand.

const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const PAGE_A = '<html>prices alpha</html>';
const PAGE_B = '<html>prices beta</html>';
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-prices-'));

// fetchFn answers with PAGE_A for every source unless overridden; each call is recorded.
function fetches(override = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const text = override[url] ?? PAGE_A;
    return { ok: true, status: 200, text: async () => text };
  };
  return { fetchFn, calls };
}

test('the state keeps only sources the program knows, with clean fields', () => {
  const s = pricesWatchState({ checks: { anthropic: { hash: 'a'.repeat(40), checkedAt: 'bad' }, deepseek: { hash: 'b'.repeat(40), checkedAt: '2026-10-15T12:00:00.000Z', changedAt: '2026-10-15T13:00:00.000Z', junk: 1 }, 'not-a-source': { hash: 'c'.repeat(40), checkedAt: '2026-10-15T12:00:00.000Z' } } });
  assert.deepEqual(s.checks.anthropic, { hash: 'a'.repeat(40) }, 'a bad date drops only the date');
  assert.deepEqual(s.checks.deepseek, { hash: 'b'.repeat(40), checkedAt: '2026-10-15T12:00:00.000Z', changedAt: '2026-10-15T13:00:00.000Z' });
  assert.equal('not-a-source' in s.checks, false);
});

test('the first look baselines every page with no alert; a changed page alerts once and keeps its changedAt', async () => {
  const smDir = tmp();
  try {
    const alerts = [];
    const { fetchFn } = fetches();
    const watch = createPricesWatch({ smDir, fetchFn, now: () => NOW, onAlerts: (a) => alerts.push(...a) });
    const first = await watch.run();
    assert.equal(first.alerts.length, 0, 'the first look only baselines');
    assert.equal(first.checked.length, PRICE_SOURCES.length);
    const view = pricesView(smDir);
    for (const s of PRICE_SOURCES) {
      assert.equal(view[s.id].checkedAt, new Date(NOW).toISOString());
      assert.equal('changedAt' in view[s.id], false);
    }
    // The page changes: one alert per changed source, and the second run does not repeat it.
    const secondFetches = fetches({ [PRICE_SOURCES[0].url]: PAGE_B });
    const later = createPricesWatch({ smDir, fetchFn: secondFetches.fetchFn, now: () => NOW + DAY, onAlerts: (a) => alerts.push(...a) });
    const out = await later.run();
    assert.equal(out.alerts.length, 1);
    assert.equal(out.alerts[0].provider, PRICE_SOURCES[0].id);
    assert.equal(pricesView(smDir)[PRICE_SOURCES[0].id].changedAt, new Date(NOW + DAY).toISOString());
    const thirdFetches = fetches({ [PRICE_SOURCES[0].url]: PAGE_B });
    const third = createPricesWatch({ smDir, fetchFn: thirdFetches.fetchFn, now: () => NOW + 2 * DAY, onAlerts: (a) => alerts.push(...a) });
    assert.equal((await third.run()).alerts.length, 0, 'the same new shape alerts once');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a look inside the day skips every page; two looks inside the minute share, even forced', async () => {
  const smDir = tmp();
  try {
    const { fetchFn } = fetches();
    const watch = createPricesWatch({ smDir, fetchFn, now: () => NOW });
    const first = await watch.run();
    assert.equal(first.checked.length, PRICE_SOURCES.length);
    const forced = await watch.run({ force: true });
    assert.equal(forced.forced, false, 'two looks inside the minute share, even forced');
    assert.equal(forced.checked.length, 0);
    assert.equal(forced.skipped.length, PRICE_SOURCES.length, 'and inside the day nothing is due anyway');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('a failed page is logged as a short error and kept out for a day, with no price saved for it; the rest go on', async () => {
  const smDir = tmp();
  try {
    const fetchFn = async (url) => {
      if (url === PRICE_SOURCES[0].url) return { ok: false, status: 503, text: async () => 'down' };
      return { ok: true, status: 200, text: async () => PAGE_A };
    };
    const watch = createPricesWatch({ smDir, fetchFn, now: () => NOW });
    const out = await watch.run();
    assert.equal(out.alerts.length, 0);
    const view = pricesView(smDir);
    assert.deepEqual(Object.keys(view[PRICE_SOURCES[0].id]), ['failedAt'], 'only the day of the failure is kept for the failed one');
    assert.ok(view[PRICE_SOURCES[1].id].checkedAt);
    let asked = 0;
    const counting = createPricesWatch({ smDir, fetchFn: async (url) => { if (url === PRICE_SOURCES[0].url) asked++; return { ok: false, status: 503, text: async () => 'down' }; }, now: () => NOW + 60 * 60 * 1000 });
    const again = await counting.run();
    assert.equal(asked, 0, 'an hour later the failed page is not asked again');
    assert.ok(again.skipped.some((s) => s.id === PRICE_SOURCES[0].id && s.why === 'failed'));
    const nextDay = createPricesWatch({ smDir, fetchFn: async (url) => { if (url === PRICE_SOURCES[0].url) asked++; return { ok: true, status: 200, text: async () => PAGE_A }; }, now: () => NOW + 25 * 60 * 60 * 1000 });
    await nextDay.run();
    assert.equal(asked, 1, 'a day later it is');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('the state file is written through pricesFile and read back by pricesView', () => {
  const smDir = tmp();
  try {
    writeFileSync(pricesFile(smDir), JSON.stringify({ version: 1, updatedAt: 'x', checks: { openai: { hash: 'd'.repeat(40), checkedAt: '2026-10-15T12:00:00.000Z' } } }));
    assert.deepEqual(pricesView(smDir), { openai: { hash: 'd'.repeat(40), checkedAt: '2026-10-15T12:00:00.000Z' } });
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});
