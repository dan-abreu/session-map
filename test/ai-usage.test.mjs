import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { usageSummary, liveStats } from '../server/ai/usage.mjs';
import { loadStats } from '../server/ai/router.mjs';

// The panel of the other AIs measured by real use (or16): sums over smDir/ai-activity.jsonl, never a prompt or a key.
const NOW = new Date(2026, 9, 10, 15, 0, 0).getTime();
const at = (dayOffset, hour = 10) => new Date(2026, 9, 10 + dayOffset, hour, 0, 0).toISOString();
let n = 0;
const id = () => String(++n).padStart(12, '0');
const line = (o) => JSON.stringify({ id: o.id ?? id(), at: at(0), source: 'chat', kind: 'review', sensitivity: 'internal', provider: 'openai', model: 'gpt-6.1-sol', ms: 1000, costUSD: 0.01, ok: true, ...o });
const verdict = (target, accepted) => JSON.stringify({ type: 'result', id: target, at: at(0), accepted, why: 'because' });
function dir(lines, extra = {}) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-usage-'));
  writeFileSync(join(smDir, 'ai-activity.jsonl'), `${lines.join('\n')}\n`);
  for (const [name, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(smDir, name)), { recursive: true });
    writeFileSync(join(smDir, name), text);
  }
  return smDir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('counts accepted, refused, waiting and failed; cost per accepted piece; broken lines are skipped; no prompt text', () => {
  const a = id(); const b = id(); const c = id();
  const smDir = dir([
    line({ id: a, costUSD: 0.02, ms: 1000 }), verdict(a, true),
    line({ id: b, costUSD: 0.04, ms: 3000 }), verdict(b, false),
    line({ id: c, costUSD: 0.01 }),
    line({ ok: false, error: 'http-429', costUSD: 0, ms: 0 }),
    '{not json', JSON.stringify({ nonsense: 1 }),
    line({ provider: 'deepseek', model: 'deepseek-flash', kind: 'code', prompt: 'SECRET PROMPT TEXT', apiKey: 'sk-abc' }),
  ]);
  try {
    const u = usageSummary({ smDir, now: NOW });
    const o = u.byAi.find((x) => x.provider === 'openai');
    assert.equal(o.calls, 4);
    assert.equal(o.ok, 3);
    assert.equal(o.failed, 1);
    assert.equal(o.accepted, 1);
    assert.equal(o.refused, 1);
    assert.equal(o.waiting, 1);
    assert.equal(o.acceptRate, 0.5);
    assert.equal(o.costUSD, 0.07);
    assert.equal(o.costPerAcceptedUSD, 0.07);
    assert.equal(o.avgMs, 1667);
    assert.deepEqual(o.byKind.map((k) => [k.kind, k.calls, k.accepted, k.refused, k.acceptRate]), [['review', 4, 1, 1, 0.5]]);
    const d = u.byAi.find((x) => x.provider === 'deepseek');
    assert.equal(d.acceptRate, null);
    assert.equal(d.costPerAcceptedUSD, null);
    assert.equal(u.cap.spentTodayUSD, 0.08);
    assert.equal(u.days.length, 14);
    assert.equal(u.days.at(-1).byProvider.openai, 0.07);
    assert.ok(!/SECRET|sk-abc/.test(JSON.stringify(u)));
  } finally { clean(smDir); }
});

test('days: the last 14 local days, oldest first; the bench score and the map review come along', () => {
  const smDir = dir([line({ at: at(-3), costUSD: 0.5 }), line({ at: at(-30), costUSD: 9 }), line({ source: 'map', kind: 'place', provider: 'gemini', model: 'g' })], {
    'bench/routing.json': JSON.stringify({ updatedAt: 'x', entries: [{ kind: 'review', contestant: 'openai:gpt-6.1-sol', accuracy: 0.9, costPerCorrectUSD: 0.01, n: 30 }] }),
    'ai-cache.json': JSON.stringify({ helper: { reviews: { 'gemini:place': { window: [], reviewed: 12, agreed: 10 } }, paused: {} } }),
    'config.json': JSON.stringify({ ai: { others: { enabled: true, dailyUSD: 5, off: [] } } }),
  });
  try {
    const u = usageSummary({ smDir, now: NOW });
    assert.equal(u.cap.dailyUSD, 5);
    assert.equal(u.days[10].byProvider.openai, 0.5);
    assert.equal(u.days[0].byProvider.openai, undefined);
    assert.deepEqual(u.byAi.find((x) => x.provider === 'openai').bench, [{ kind: 'review', accuracy: 0.9, n: 30 }]);
    assert.deepEqual(u.byAi.find((x) => x.provider === 'gemini').mapReview, { reviewed: 12, agreed: 10 });
  } finally { clean(smDir); }
});

test('nothing on disk -> an empty summary', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-usage-'));
  try {
    const u = usageSummary({ smDir, now: NOW });
    assert.deepEqual(u.byAi, []);
    assert.equal(u.cap.spentTodayUSD, 0);
    assert.equal(u.days.length, 14);
  } finally { clean(smDir); }
});

function manyReviews(count, acceptedCount, extra = {}) {
  const out = [];
  for (let i = 0; i < count; i++) { const x = id(); out.push(line({ id: x, costUSD: 0.01, ...extra }), verdict(x, i < acceptedCount)); }
  return out;
}

test('liveStats: accepted = correct; accuracy, cost per correct, n', () => {
  const smDir = dir(manyReviews(20, 15));
  try {
    const [e] = liveStats(smDir);
    assert.equal(e.kind, 'review');
    assert.equal(e.contestant, 'openai:gpt-6.1-sol');
    assert.equal(e.accuracy, 0.75);
    assert.equal(e.n, 20);
    assert.ok(Math.abs(e.costPerCorrectUSD - 0.2 / 15) < 1e-9);
  } finally { clean(smDir); }
});

test('liveStats: map bulk work uses the review agreement', () => {
  const lines = Array.from({ length: 40 }, () => line({ source: 'map', kind: 'place', provider: 'gemini', model: 'g-flash', costUSD: 0.001 }));
  const smDir = dir(lines, { 'ai-cache.json': JSON.stringify({ helper: { reviews: { 'gemini:place': { window: [], reviewed: 8, agreed: 6 } } } }) });
  try {
    const [e] = liveStats(smDir);
    assert.equal(e.kind, 'bulk');
    assert.equal(e.contestant, 'gemini:g-flash');
    assert.equal(e.accuracy, 0.75);
    assert.equal(e.n, 8);
    assert.ok(Math.abs(e.costPerCorrectUSD - 0.001 / 0.75) < 1e-9);
  } finally { clean(smDir); }
});

// Found by GPT-6.1 Sol's review of this file (or16), each checked before fixing.
test('liveStats: map reviews have no model, so a slot that changed model credits nobody', () => {
  const lines = [
    ...Array.from({ length: 30 }, () => line({ source: 'map', kind: 'place', provider: 'gemini', model: 'g-old', costUSD: 0.001 })),
    line({ source: 'map', kind: 'place', provider: 'gemini', model: 'g-new', costUSD: 0.001 }),
  ];
  const smDir = dir(lines, { 'ai-cache.json': JSON.stringify({ helper: { reviews: { 'gemini:place': { window: [], reviewed: 25, agreed: 24 } } } }) });
  try {
    assert.deepEqual(liveStats(smDir), []);
  } finally { clean(smDir); }
});

test('liveStats: nothing accepted -> cost per correct is the whole cost, never a per-try price', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) { const x = id(); lines.push(line({ id: x, costUSD: 0.1 }), verdict(x, false)); }
  const smDir = dir(lines);
  try {
    const [e] = liveStats(smDir);
    assert.equal(e.accuracy, 0);
    assert.ok(Math.abs(e.costPerCorrectUSD - 2) < 1e-9);
  } finally { clean(smDir); }
});

test('usageSummary: an odd "at" does not break the log; tiny costs add up before rounding', () => {
  const smDir = dir([
    JSON.stringify({ id: id(), at: { toString: null, valueOf: null }, source: 'chat', kind: 'review', provider: 'openai', model: 'm', ms: 1, costUSD: 0.01, ok: true }),
    line({ costUSD: 0.0000004 }), line({ costUSD: 0.0000004 }), line({ costUSD: 0.0000004 }),
  ]);
  try {
    const u = usageSummary({ smDir, now: NOW });
    assert.equal(u.days.at(-1).byProvider.openai, 0.000001);
    assert.ok(u.byAi.some((x) => x.model === 'm'));
  } finally { clean(smDir); }
});

test('loadStats: live wins over the bench only from 20 decided pieces, and follows the file', () => {
  const bench = { 'bench/routing.json': JSON.stringify({ updatedAt: 'x', entries: [
    { kind: 'review', contestant: 'openai:gpt-6.1-sol', accuracy: 0.9, costPerCorrectUSD: 0.01, n: 50 },
    { kind: 'code', contestant: 'deepseek:deepseek-v4-pro', accuracy: 0.8, costPerCorrectUSD: 0.02, n: 50 }] }) };
  const smDir = dir(manyReviews(20, 10), bench);
  try {
    const s = loadStats(smDir);
    assert.equal(s.find((e) => e.kind === 'review').accuracy, 0.5, 'real use beats the bench');
    assert.equal(s.find((e) => e.kind === 'code').accuracy, 0.8, 'no live data: the bench stays');
  } finally { clean(smDir); }
  const few = dir(manyReviews(19, 0), bench);
  try {
    assert.equal(loadStats(few).find((e) => e.kind === 'review').accuracy, 0.9, 'below 20 the bench stays');
    writeFileSync(join(few, 'ai-activity.jsonl'), `${manyReviews(25, 5).join('\n')}\n`);
    assert.equal(loadStats(few).find((e) => e.kind === 'review').accuracy, 0.2, 'the cache sees the new file');
  } finally { clean(few); }
});

test('loadStats: live data alone (no bench file) still counts', () => {
  const smDir = dir(manyReviews(20, 20));
  try { assert.equal(loadStats(smDir)[0].accuracy, 1); } finally { clean(smDir); }
});
