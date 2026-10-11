import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyHelperState, providerReview } from './review.mjs';
import { othersSettings } from './others.mjs';
import { routeKindOf } from './router.mjs';

// The other AIs measured by REAL USE (or16): sums over smDir/ai-activity.jsonl (activity.mjs), the bench's
// routing.json and the queue's review state in ai-cache.json. Pure reading: a broken line is skipped, and nothing
// here ever holds a prompt, an answer or a key (each field is picked by name).

const ACTIVITY_FILE = 'ai-activity.jsonl';
export const DEFAULT_DAYS = 14;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

function readJson(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

// Entries in file order, each with its latest result {accepted, why}. The same join as activity.mjs, kept here so the
// router (which loads this file) does not depend on the activity writer.
function readEntries(smDir) {
  let text = '';
  try { text = readFileSync(join(smDir, ACTIVITY_FILE), 'utf8'); } catch { return []; }
  const entries = [];
  const byId = new Map();
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    let line;
    try { line = JSON.parse(raw); } catch { continue; }
    if (!isObject(line) || typeof line.id !== 'string') continue;
    if (line.type === 'result') {
      const target = byId.get(line.id);
      if (target) target.accepted = line.accepted === true;
    } else if (typeof line.provider === 'string' && line.provider) {
      const item = {
        id: line.id,
        at: typeof line.at === 'string' ? Date.parse(line.at) : NaN,
        source: line.source === 'map' ? 'map' : 'chat',
        kind: typeof line.kind === 'string' ? line.kind : 'other',
        provider: line.provider,
        model: typeof line.model === 'string' ? line.model : '',
        ms: num(line.ms),
        costUSD: num(line.costUSD),
        ok: line.ok === true,
        accepted: undefined,
      };
      entries.push(item);
      byId.set(item.id, item);
    }
  }
  return entries;
}

const reviewState = (smDir) => emptyHelperState(readJson(join(smDir, 'ai-cache.json'))?.helper);
const ratio = (a, b) => (a + b > 0 ? a / (a + b) : null);

function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lastDays(now, days) {
  const out = [];
  const base = new Date(now);
  for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12).getTime()));
  return out;
}

function benchOf(smDir) {
  const entries = readJson(join(smDir, 'bench', 'routing.json'))?.entries;
  const out = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isObject(e) || typeof e.contestant !== 'string' || !Number.isFinite(e.accuracy) || !Number.isInteger(e.n)) continue;
    const kind = routeKindOf(e.kind) ?? (typeof e.kind === 'string' ? e.kind : null);
    if (!kind) continue;
    if (!out.has(e.contestant)) out.set(e.contestant, []);
    out.get(e.contestant).push({ kind, accuracy: e.accuracy, n: e.n });
  }
  return out;
}

const tally = () => ({ calls: 0, ok: 0, failed: 0, accepted: 0, refused: 0, waiting: 0, costUSD: 0, msSum: 0, msN: 0, lastAt: 0 });
function add(t, e) {
  t.calls++;
  t.costUSD += e.costUSD;
  if (e.at > t.lastAt) t.lastAt = e.at;
  if (!e.ok) { t.failed++; return; }
  t.ok++;
  if (e.ms > 0) { t.msSum += e.ms; t.msN++; }
  if (e.accepted === true) t.accepted++;
  else if (e.accepted === false) t.refused++;
  else if (e.source !== 'map') t.waiting++;
}

export function usageSummary({ smDir, now = Date.now(), days = DEFAULT_DAYS } = {}) {
  const entries = smDir ? readEntries(smDir) : [];
  const config = (smDir && readJson(join(smDir, 'config.json'))) || {};
  const settings = othersSettings(config.ai, []);
  const bench = smDir ? benchOf(smDir) : new Map();
  const review = smDir ? reviewState(smDir) : emptyHelperState();

  const dayList = lastDays(now, Number.isInteger(days) && days > 0 ? days : DEFAULT_DAYS);
  const dayRows = dayList.map((day) => ({ day, byProvider: {} }));
  const dayAt = new Map(dayRows.map((r) => [r.day, r]));
  const today = dayList.at(-1);
  let spentToday = 0;

  const ais = new Map();
  for (const e of entries) {
    const key = `${e.provider}:${e.model}`;
    if (!ais.has(key)) ais.set(key, { provider: e.provider, model: e.model, total: tally(), kinds: new Map() });
    const ai = ais.get(key);
    add(ai.total, e);
    if (!ai.kinds.has(e.kind)) ai.kinds.set(e.kind, tally());
    add(ai.kinds.get(e.kind), e);
    if (Number.isFinite(e.at) && e.costUSD > 0) {
      const day = localDay(e.at);
      const row = dayAt.get(day);
      if (row) row.byProvider[e.provider] = (row.byProvider[e.provider] ?? 0) + e.costUSD;
      if (day === today && e.provider !== 'claude') spentToday += e.costUSD;
    }
  }

  const byAi = [...ais.values()].map((ai) => {
    const t = ai.total;
    const r = providerReview(review, ai.provider);
    return {
      provider: ai.provider,
      model: ai.model,
      calls: t.calls,
      ok: t.ok,
      failed: t.failed,
      accepted: t.accepted,
      refused: t.refused,
      waiting: t.waiting,
      acceptRate: ratio(t.accepted, t.refused),
      costUSD: round6(t.costUSD),
      costPerAcceptedUSD: t.accepted > 0 ? round6(t.costUSD / t.accepted) : null,
      avgMs: t.msN ? Math.round(t.msSum / t.msN) : 0,
      lastAt: t.lastAt ? new Date(t.lastAt).toISOString() : null,
      byKind: [...ai.kinds.entries()].map(([kind, k]) => ({ kind, calls: k.calls, accepted: k.accepted, refused: k.refused, acceptRate: ratio(k.accepted, k.refused), costUSD: round6(k.costUSD) }))
        .sort((a, b) => b.calls - a.calls || a.kind.localeCompare(b.kind)),
      bench: bench.get(`${ai.provider}:${ai.model}`) ?? [],
      mapReview: r.reviewed > 0 ? { reviewed: r.reviewed, agreed: r.agreed } : null,
    };
  }).sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider));

  // Rounded once at the end: rounding per call would lose sub-micro-dollar costs and depend on call order.
  for (const row of dayRows) for (const p of Object.keys(row.byProvider)) row.byProvider[p] = round6(row.byProvider[p]);
  return { cap: { dailyUSD: settings.dailyUSD, spentTodayUSD: round6(spentToday) }, byAi, days: dayRows };
}

// Measurements from real use, in routing.json's shape: a piece is "correct" when Claude accepted it; for the map's bulk
// work, when Claude's re-check agreed. -> [{kind, contestant, accuracy, costPerCorrectUSD, n}]
export function liveStats(smDir) {
  if (!smDir) return [];
  const groups = new Map();
  const bump = (kind, contestant, right, total, cost) => {
    const key = `${kind}|${contestant}`;
    const g = groups.get(key) ?? { kind, contestant, right: 0, total: 0, cost: 0 };
    g.right += right; g.total += total; g.cost += cost;
    groups.set(key, g);
  };
  const entries = readEntries(smDir);
  const chat = new Map();
  const mapCalls = new Map();
  for (const e of entries) {
    if (e.source === 'map') {
      const slot = `${e.provider}:${e.kind}`;
      const m = mapCalls.get(slot) ?? { n: 0, cost: 0, model: '', models: new Set() };
      m.n++; m.cost += e.costUSD; if (e.model) { m.model = e.model; m.models.add(e.model); }
      mapCalls.set(slot, m);
      continue;
    }
    const kind = routeKindOf(e.kind);
    if (!kind || !e.ok || typeof e.accepted !== 'boolean' || !e.model) continue;
    const key = `${kind}|${e.provider}:${e.model}`;
    const c = chat.get(key) ?? { kind, contestant: `${e.provider}:${e.model}`, right: 0, total: 0, cost: 0 };
    c.total++; c.cost += e.costUSD; if (e.accepted) c.right++;
    chat.set(key, c);
  }
  for (const c of chat.values()) bump(c.kind, c.contestant, c.right, c.total, c.cost);
  for (const [slot, r] of Object.entries(reviewState(smDir).reviews)) {
    const m = mapCalls.get(slot);
    const kind = routeKindOf(slot.slice(slot.indexOf(':') + 1));
    // The review state has no model: credit it only while the slot has used one model, never a newer one.
    if (!m || !m.model || m.models.size !== 1 || !kind || !isObject(r) || !(r.reviewed > 0)) continue;
    const provider = slot.slice(0, slot.indexOf(':'));
    bump(kind, `${provider}:${m.model}`, Math.min(r.agreed, r.reviewed), r.reviewed, (m.cost / m.n) * r.reviewed);
  }
  return [...groups.values()].filter((g) => g.total > 0).map((g) => ({
    kind: g.kind,
    contestant: g.contestant,
    accuracy: g.right / g.total,
    // Nothing right: the whole cost stands as the price of one right answer, so the number is never cheaper than reality.
    costPerCorrectUSD: g.right ? g.cost / g.right : g.cost,
    n: g.total,
  }));
}
