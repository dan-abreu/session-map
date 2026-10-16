import { routeKindOf } from './router.mjs';

// Working groups (owner's request 2026-10-14): the owner picks how the arsenal behaves — who comes first, who never
// sees the work — and the router's order (router.mjs, measured by the bench and real use) is re-shaped by it. Groups
// never drop a provider the router allowed unless the group says so (lgpd drops DeepSeek everywhere): they mostly
// re-order, so the quality rules (same-family review, sensitivity, measured accuracy) keep holding. The credit
// failover lives in quota.mjs: a group orders, the quota state skips the empty ones.
//
// Config: ai.others.groups = {active: 'economia'|'qualidade'|'lgpd'|'sobrevivencia'} (null = the router's order).

export const GROUP_IDS = Object.freeze(['economia', 'qualidade', 'lgpd', 'sobrevivencia']);

// economia: cheapest per right answer first, quality floor kept by the router's measured entries (a candidate the
//   bench found clearly worse stays last or is left out by the caller). Claude conducts and checks at the end.
// qualidade: the router's measured order already puts the best first; the group is the explicit "spend on quality".
// lgpd: opt-in only, the owner picks it: DeepSeek (servers in China, may train) never sees the work; the rest keep
//   the routed order. Without this group no AI is kept from any work.
// sobrevivencia: whoever still has credit — the router's order, and quota.mjs skips the empty providers.
const GROUPS = Object.freeze({
  economia: Object.freeze({
    order: Object.freeze({
      bulk: Object.freeze(['deepseek', 'openrouter', 'openai', 'gemini', 'claude']),
      review: Object.freeze(['openai', 'gemini', 'deepseek', 'claude']),
      code: Object.freeze(['openai', 'deepseek', 'claude']),
      read: Object.freeze(['gemini', 'openai', 'claude']),
      portuguese: Object.freeze(['openai', 'claude']),
      reasoning: Object.freeze(['claude', 'openai']),
    }),
  }),
  qualidade: Object.freeze({ order: Object.freeze({}) }),
  lgpd: Object.freeze({ drop: Object.freeze(['deepseek']), order: Object.freeze({}) }),
  sobrevivencia: Object.freeze({ order: Object.freeze({}) }),
});

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The active group of this config, or null for the router's plain order. Unknown ids and broken shapes mean null:
// a wrong guess here costs money, none is safer.
export function activeGroupOf(ai) {
  const raw = isObject(ai?.others?.groups) ? ai.others.groups.active : null;
  return GROUP_IDS.includes(raw) ? raw : null;
}

// The ai part of config.json with the group choice written: {active} sets it, active: null removes it.
export function mergeGroups(ai, patch = {}) {
  const { others, ...rest } = isObject(ai) ? ai : {};
  const { groups, ...o } = isObject(others) ? others : {};
  const merged = { ...o };
  if (GROUP_IDS.includes(patch.active)) merged.groups = { active: patch.active };
  else if (patch.active !== null && groups) merged.groups = groups;
  return { ...rest, others: merged };
}

// Re-shape the routed candidates by the group -> {candidates, skipped}. Providers not listed keep their routed
// place at the end (never dropped for being new). For a review, the same-family rule stays above the group: the
// other-family bucket goes first, each bucket ordered by the group.
export function applyGroup(candidates, groupId, { kind, authorFamily } = {}) {
  const g = GROUP_IDS.includes(groupId) ? GROUPS[groupId] : null;
  if (!g) return { candidates: Array.isArray(candidates) ? [...candidates] : [], skipped: [] };
  const k = routeKindOf(kind) ?? kind;
  const order = g.order?.[k] ?? [];
  const drop = new Set(g.drop ?? []);
  const kept = [];
  const skipped = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (drop.has(c?.provider)) {
      skipped.push({ provider: c.provider, model: c.model, why: `group-${groupId}` });
      continue;
    }
    kept.push(c);
  }
  if (!order.length) return { candidates: kept, skipped };
  const rank = new Map(order.map((p, i) => [p, i]));
  const idx = (c) => (rank.has(c.provider) ? rank.get(c.provider) : order.length);
  const sortBy = (list) => list.sort((a, b) => idx(a) - idx(b));
  if (k === 'review' && typeof authorFamily === 'string' && authorFamily) {
    const other = kept.filter((c) => c.family !== authorFamily);
    const own = kept.filter((c) => c.family === authorFamily);
    sortBy(other);
    sortBy(own);
    return { candidates: [...other, ...own], skipped };
  }
  sortBy(kept);
  return { candidates: kept, skipped };
}

// What the page may show: the group ids and one line each, for a future selector (the config itself has no secrets).
export const publicGroups = () =>
  GROUP_IDS.map((id) => ({
    id,
    why: id === 'economia' ? 'cheapest per right answer first; Claude checks'
      : id === 'qualidade' ? 'the measured best first, whatever it costs'
      : id === 'lgpd' ? 'DeepSeek never sees the work'
      : 'whoever still has credit',
  }));
