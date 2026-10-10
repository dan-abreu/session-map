// The rows of the Home (fd10): one per project with its seven values and at most two heads-ups. Pure: no page and no network,
// so node:test loads it. The page draws them (homeview.js). Everything here is read from /api/state, nothing computed
// by a model; the foundation summary (project.foundation) is null while a project has not been read yet, and then the
// numbers stay null so the page says "not read yet" and never shows a zero.
import { costInRange, resolveRange } from './range.js';
import { budgetTone, waitingEntries } from './views.js';

export const HEALTH_LOW = 60;
const HEALTH_GOOD = 80;
const MAX_ATTENTION = 2;

export const healthTone = (score) => (score < HEALTH_LOW ? 'low' : score < HEALTH_GOOD ? 'ok' : 'good');

// Where each heads-up sends the person to solve it: an area of nav.js and, when it has one, a sub-part of it.
const GOES = {
  unread: { area: 'map' },
  'version-mismatch': { area: 'health', sub: 'versions' },
  'uptodate-warning': { area: 'health', sub: 'uptodate' },
  'health-low': { area: 'health' },
  'no-owner': { area: 'map' },
  'care-unset': { area: 'health', sub: 'care' },
  budget: { area: 'costs' },
};

const item = (kind, params = {}) => ({ kind, params, goes: { ...GOES[kind] } });

// The heads-ups of one project, most serious first, no more than two. Fixed rules, no model.
// budget: {pct, tone} only for the project that carries the monthly budget warning (see homeRows).
export function attentionOf(project, { budget = null } = {}) {
  const found = [];
  const add = (rank, kind, params) => found.push({ rank, ...item(kind, params) });
  const f = project?.foundation ?? null;
  if (budget && budget.tone !== 'ok') add(budget.tone === 'over' ? 0 : 5, 'budget', { pct: budget.pct });
  if (!f) add(6, 'unread');
  else {
    if (Number.isFinite(f.health?.score) && f.health.score < HEALTH_LOW) add(1, 'health-low', { score: f.health.score });
    if (f.uptodate?.warning > 0) add(2, 'uptodate-warning', { n: f.uptodate.warning });
    if (f.version?.mismatch) add(3, 'version-mismatch', { code: f.version.code });
    if (f.census?.noOwner > 0) add(4, 'no-owner', { n: f.census.noOwner });
    if (f.care === null || f.care === undefined) add(4.5, 'care-unset');
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, MAX_ATTENTION).map(({ rank, ...rest }) => rest);
}

// The newest moment of the project: its latest activity or its most recent conversation, as the ISO text it came in.
function lastActivityOf(project) {
  const stamps = [project.activity?.[0]?.ts, ...(project.chats ?? []).map((c) => c.updatedAt)].filter((s) => Number.isFinite(Date.parse(s)));
  return stamps.reduce((best, s) => (best === null || Date.parse(s) > Date.parse(best) ? s : best), null);
}

// nowMs: the moment that decides which month is "this month". ignored: clashes the person chose to stop seeing.
export function homeRows(state, { nowMs = Date.now(), ignored = new Set() } = {}) {
  const month = resolveRange({ preset: 'month' }, nowMs);
  const rows = state.projects.map((p) => {
    const f = p.foundation ?? null;
    return {
      id: p.id,
      name: p.name,
      read: f !== null,
      version: f?.version ? { code: f.version.code ?? null, mismatch: Boolean(f.version.mismatch) } : null,
      health: Number.isFinite(f?.health?.score) ? { score: f.health.score, tone: healthTone(f.health.score) } : null,
      uptodate: f?.uptodate ? { confirmed: f.uptodate.confirmed, warning: f.uptodate.warning, unverified: f.uptodate.unverified } : null,
      working: (p.chats ?? []).filter((c) => c.status === 'busy' && !c.archived).length,
      waiting: waitingEntries(state, p.id, ignored).length,
      monthCost: { usd: costInRange(p.costByDay, month) },
      lastActivity: lastActivityOf(p),
    };
  });
  // The monthly budget belongs to the whole page, so its warning goes on the one project that spends most.
  const monthly = state.budget?.monthlyUSD;
  const tone = monthly > 0 ? budgetTone(state.budget.used, monthly) : 'ok';
  const top = tone === 'ok' ? null : rows.reduce((a, b) => (b.monthCost.usd > a.monthCost.usd ? b : a), rows[0]);
  const budget = { pct: monthly > 0 ? Math.round((100 * state.budget.used) / monthly) : 0, tone };
  const byId = new Map(state.projects.map((p) => [p.id, p]));
  for (const r of rows) r.attention = attentionOf(byId.get(r.id), { budget: r === top ? budget : null });
  const stamp = (r) => (r.lastActivity === null ? 0 : Date.parse(r.lastActivity));
  return rows.sort((a, b) =>
    (b.waiting > 0) - (a.waiting > 0) || (b.working > 0) - (a.working > 0) || stamp(b) - stamp(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function homeTotals(rows) {
  return {
    projects: rows.length,
    working: rows.reduce((s, r) => s + r.working, 0),
    waiting: rows.reduce((s, r) => s + r.waiting, 0),
    monthUsd: rows.reduce((s, r) => s + r.monthCost.usd, 0),
    unread: rows.filter((r) => !r.read).length,
  };
}
