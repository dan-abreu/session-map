import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIVE_MS, alwaysOn, backgroundOf, createCatalogRefresher, isWorking, setBackground, sweepable } from '../server/background.mjs';

const NOW = Date.parse('2026-10-10T20:00:00Z');
const item = (id, msAgo) => ({ summary: { sessionId: id }, ref: { mtimeMs: NOW - msAgo } });

test('a project is worked on while one of its conversations runs, the page drives one, or one moved in the last 30 minutes', () => {
  assert.equal(ACTIVE_MS, 30 * 60_000);
  const old = item('a', 2 * 3_600_000);
  assert.equal(isWorking({ items: [old], liveById: new Map(), nowMs: NOW }), false, 'quiet for two hours');
  assert.equal(isWorking({ items: [item('a', 29 * 60_000)], liveById: new Map(), nowMs: NOW }), true, 'moved 29 minutes ago');
  assert.equal(isWorking({ items: [item('a', 31 * 60_000)], liveById: new Map(), nowMs: NOW }), false, 'moved 31 minutes ago');
  assert.equal(isWorking({ items: [old], liveById: new Map([['a', { status: 'busy' }]]), nowMs: NOW }), true, 'running now');
  assert.equal(isWorking({ items: [old], liveById: new Map([['a', { status: 'idle' }]]), nowMs: NOW }), false, 'open but idle for hours');
  assert.equal(isWorking({ items: [old], liveById: new Map(), driving: new Set(['a']), nowMs: NOW }), true, 'a page chat at work');
  assert.equal(isWorking({ items: [], liveById: new Map(), nowMs: NOW }), false);
});

test('only the person\'s own settings keep a project always up to date, never a file inside the project', () => {
  const user = { projects: { 'c:/dev/shop': { background: 'always' }, 'c:/dev/blog': { background: 'yes' } } };
  assert.equal(alwaysOn(user, 'C:\\dev\\shop'), true);
  assert.equal(alwaysOn(user, 'c:/dev/blog'), false, 'only the exact word');
  assert.equal(alwaysOn(user, 'c:/dev/other'), false);
  assert.equal(alwaysOn({}, 'c:/dev/shop'), false);
  assert.equal(alwaysOn(null, 'c:/dev/shop'), false);
});

test('backgroundOf: the work runs when the project is worked on or always on', () => {
  assert.deepEqual(backgroundOf({ always: false, working: false }), { always: false, working: false, on: false });
  assert.deepEqual(backgroundOf({ always: true, working: false }), { always: true, working: false, on: true });
  assert.deepEqual(backgroundOf({ always: false, working: true }), { always: false, working: true, on: true });
});

test('the sweep takes only the projects whose background is on; one with no answer is left out', () => {
  const projects = [
    { id: 'a', background: { on: true } },
    { id: 'b', background: { on: false } },
    { id: 'c' },
  ];
  assert.deepEqual(sweepable(projects).map((p) => p.id), ['a']);
});

test('setBackground writes the choice in the person\'s config, keeps the rest, and takes it away when turned off', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bg-'));
  try {
    const file = join(smDir, 'config.json');
    writeFileSync(file, JSON.stringify({ ai: { enabled: true }, projects: { 'c:/dev/shop': { roadmap: 'docs/r.md' } } }));
    assert.deepEqual(setBackground(smDir, 'C:\\dev\\shop', true), { ok: true, always: true });
    let saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.projects['c:/dev/shop'], { roadmap: 'docs/r.md', background: 'always' });
    assert.deepEqual(saved.ai, { enabled: true });
    assert.deepEqual(setBackground(smDir, 'c:/dev/shop', false), { ok: true, always: false });
    saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.projects['c:/dev/shop'], { roadmap: 'docs/r.md' });
    assert.deepEqual(setBackground(smDir, 'c:/dev/shop', 'yes'), { ok: false, error: 'bad-background' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('setBackground starts a config when there is none, and refuses one it cannot read', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bg-'));
  try {
    assert.deepEqual(setBackground(smDir, 'c:/dev/shop', true), { ok: true, always: true });
    assert.deepEqual(JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')), { projects: { 'c:/dev/shop': { background: 'always' } } });
    writeFileSync(join(smDir, 'config.json'), '{ broken');
    assert.deepEqual(setBackground(smDir, 'c:/dev/shop', false), { ok: false, error: 'config-unreadable' });
    assert.equal(readFileSync(join(smDir, 'config.json'), 'utf8'), '{ broken', 'a file it cannot read is never overwritten');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// Discover's daily refresh: the sweep asks, the catalog's own 24 h cache decides whether anything is fetched.
test('the catalog refresh asks the loader, never twice at once', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const refresher = createCatalogRefresher({ load: async () => { calls++; await gate; return { stale: false }; }, now: () => NOW });
  const first = refresher.refresh();
  const second = refresher.refresh();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  await refresher.refresh();
  assert.equal(calls, 2);
});

test('the catalog refresh asks for the deep read (the extra pages); only the background does', async () => {
  const asked = [];
  await createCatalogRefresher({ load: async (...args) => { asked.push(args); return { stale: false }; }, now: () => NOW }).refresh();
  assert.deepEqual(asked, [[false, true]]);
});

test('after a limit or an error the refresh waits an hour before it tries again, a good answer does not', async () => {
  let at = NOW;
  const answers = [{ stale: true, limited: true }, { stale: true, error: 'network' }, { stale: false }, { stale: false }];
  let calls = 0;
  const refresher = createCatalogRefresher({ load: async () => answers[calls++], now: () => at });
  await refresher.refresh();
  assert.equal(calls, 1);
  at = NOW + 59 * 60_000;
  assert.deepEqual(await refresher.refresh(), { skipped: 'cooling' });
  assert.equal(calls, 1);
  at = NOW + 61 * 60_000;
  await refresher.refresh();
  assert.equal(calls, 2);
  at += 61 * 60_000;
  await refresher.refresh();
  await refresher.refresh();
  assert.equal(calls, 4);
});

test('a loader that throws is caught and cools down like any other failure', async () => {
  let at = NOW;
  let calls = 0;
  const refresher = createCatalogRefresher({ load: async () => { calls++; throw new Error('boom'); }, now: () => at });
  assert.deepEqual(await refresher.refresh(), { error: 'failed' });
  assert.deepEqual(await refresher.refresh(), { skipped: 'cooling' });
  assert.equal(calls, 1);
});
