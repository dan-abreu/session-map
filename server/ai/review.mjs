// How Claude keeps a helper AI honest (sb07): it re-asks one answer in five and pauses a helper that keeps
// disagreeing. Pure functions over the `helper` part of ai-cache.json; the queue in runner.mjs saves it.

// Only bulk classification may leave Claude.
export const HELPER_KINDS = new Set(['place']);
const REVIEW_EVERY = 5;
const REVIEW_WINDOW = 20;
// Too few reviews say nothing: one early miss would read as 100% disagreement.
const REVIEW_MIN = 10;
const DISAGREE_MAX = 0.3;

// The same asks are reviewed every time (by the hash of the ask), so a test, or a restart, sees the same sample.
export const reviewPicks = (hash) => parseInt(String(hash).slice(0, 8), 16) % REVIEW_EVERY === 0;

const canonical = (v) => (Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
// The field each kind's answer is about: a model adding a reason or a confidence still picked the same part.
const ANSWER_OF = { place: (v) => v?.partId ?? null };
export const sameAnswer = (a, b, kind) => {
  const pick = Object.hasOwn(ANSWER_OF, kind) ? ANSWER_OF[kind] : (v) => v;
  return JSON.stringify(canonical(pick(a))) === JSON.stringify(canonical(pick(b)));
};

const slot = (provider, kind) => `${provider}:${kind}`;

// state: the `helper` part of ai-cache.json, {reviews: {slot: {window, reviewed, agreed}}, paused: {slot: why}}.
export function emptyHelperState(stored) {
  const ok = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { reviews: ok(stored?.reviews), paused: ok(stored?.paused) };
}

export const pausedFor = (state, provider, kind) => state.paused[slot(provider, kind)] ?? null;

export function recordReview(state, provider, kind, agreed, at) {
  const r = state.reviews[slot(provider, kind)] ??= { window: [], reviewed: 0, agreed: 0 };
  r.window = [...r.window, agreed].slice(-REVIEW_WINDOW);
  r.reviewed++;
  if (agreed) r.agreed++;
  const disagreed = r.window.filter((x) => !x).length;
  if (r.window.length >= REVIEW_MIN && disagreed / r.window.length > DISAGREE_MAX) {
    state.paused[slot(provider, kind)] = { code: 'disagreed', kind, disagreed, of: r.window.length, at };
  }
}

// The owner turns the helper back on: the pause and the window that caused it go, the totals stay.
export function resumeHelper(state, provider) {
  for (const key of Object.keys(state.paused)) if (key.startsWith(`${provider}:`)) delete state.paused[key];
  for (const [key, r] of Object.entries(state.reviews)) if (key.startsWith(`${provider}:`)) r.window = [];
}

export function helperStatus(state, settings, spentUSDToday) {
  const mine = (obj) => Object.entries(obj).filter(([key]) => settings.provider && key.startsWith(`${settings.provider}:`)).map(([, v]) => v);
  const reviews = mine(state.reviews);
  const pause = mine(state.paused)[0] ?? null;
  return {
    provider: settings.provider,
    model: settings.model,
    enabled: settings.enabled,
    spentUSDToday,
    capUSD: settings.dailyUSD,
    capReached: spentUSDToday >= settings.dailyUSD,
    paused: Boolean(pause),
    pausedWhy: pause,
    reviewed: reviews.reduce((n, r) => n + r.reviewed, 0),
    agreed: reviews.reduce((n, r) => n + r.agreed, 0),
  };
}
