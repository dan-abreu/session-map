import { log } from '../log.mjs';
import { HEALTH_ITEMS } from './health-items.mjs';
import { buildHealthCtx } from './health-ctx.mjs';
import { appliesTo, categoriesOf, coverageOf, scoreOf } from './health-score.mjs';
import { CHECKS } from './health-checks/index.mjs';
import { readApiFacts } from './health-github.mjs';
import { readFd, writeFd } from './store.mjs';

// fd08 orchestrator: runs the 91 checks over one context and writes health.json. Every state comes from a check
// (a program), never from a model. What cannot be decided is `unverified`, never `fail`; a check that throws or rejects
// is `unverified error` plus a warning, because a broken check says nothing about the repository.

const STATES = new Set(['pass', 'fail', 'unverified', 'na']);

// The items health-drafts.mjs knows how to draft (health.test.mjs checks this list against draftFor, so they cannot drift).
export const DRAFTABLE = Object.freeze([
  'community.security', 'community.code_of_conduct', 'community.contributing', 'community.support',
  'community.issue_templates', 'community.pr_template', 'community.codeowners', 'security.update_bot',
  'hygiene.editorconfig', 'hygiene.gitignore', 'security.gitignore_secrets', 'hygiene.env_example', 'releases.changelog',
]);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function broken(id, why) {
  log('warn', 'health-check-failed', { id, why: String(why).slice(0, 200) });
  return { state: 'unverified', reason: 'error', evidence: [], detail: {} };
}

// One item: applicability first (not owing something is never a failure), then the check, awaited.
async function judge(item, check, ctx) {
  const owes = appliesTo(item, ctx);
  if (!owes.applies) return { state: owes.state, reason: owes.reason, evidence: [], detail: {} };
  if (typeof check !== 'function') return broken(item.id, 'no check for this item');
  let res;
  try {
    res = await check(ctx);
  } catch (err) {
    return broken(item.id, err?.message ?? err);
  }
  if (!isObj(res) || !STATES.has(res.state)) return broken(item.id, 'the check did not answer with a state');
  const out = {
    state: res.state,
    reason: res.state === 'pass' ? null : (typeof res.reason === 'string' ? res.reason : null),
    evidence: Array.isArray(res.evidence) ? res.evidence : [],
    detail: isObj(res.detail) ? res.detail : {},
  };
  if (Array.isArray(res.packages)) out.packages = res.packages;
  return out;
}

const envFacts = (facts) => (Array.isArray(facts?.facts) ? facts.facts : []).filter((f) => f?.kind === 'env');
const withoutStamp = ({ generatedAt, ...rest }) => JSON.stringify(rest);

// root: the project folder. smDir + id: where the saved files live (census.json is read; health.json is written).
// census, api, versions, profile, facts, ctx: handed in by a caller that already has them (tests); otherwise read from the
// saved files. Without a census nothing is known about the files, so the answer is null (the screen says "not read yet").
export async function healthOf({
  root, smDir = null, id = null, census, api, versions, profile, facts, ctx, checks = CHECKS, now = new Date(), write = true,
} = {}) {
  const saved = (name, given) => (given !== undefined ? given : smDir && id ? readFd(smDir, id, name, null) : null);
  const cen = saved('census.json', census);
  if (!ctx && !(cen && Array.isArray(cen.files))) return null;

  const apiFacts = api !== undefined ? api : smDir && id ? readApiFacts(smDir, id) : null;
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const context = ctx ?? await buildHealthCtx({
    root, census: cen, smDir, id, api: apiFacts, versions: saved('versions.json', versions), profile: saved('profile.json', profile), now: at,
  });
  const factsFile = saved('facts.json', facts);
  if (factsFile) context.facts = envFacts(factsFile);

  const items = [];
  for (const item of HEALTH_ITEMS) {
    const r = await judge(item, checks[item.id], context);
    items.push({
      id: item.id, category: item.category, severity: item.severity, state: r.state, reason: r.reason,
      evidence: r.evidence, detail: r.detail, ...(r.packages ? { packages: r.packages } : {}),
      fix: { kind: DRAFTABLE.includes(item.id) ? 'draft' : 'manual', opId: null },
    });
  }

  const health = {
    version: 1, generatedAt: at, score: scoreOf(items), visibility: context.visibility ?? 'unknown',
    visibilitySource: context.visibilitySource ?? null, items, categories: categoriesOf(items), coverage: coverageOf(items),
    api: { mode: apiFacts?.mode ?? 'none', fetchedAt: apiFacts?.fetchedAt ?? null, error: apiFacts?.error ?? null },
  };

  if (write && smDir && id) {
    // A run that found nothing new keeps the old stamp, so the file is byte for byte the same.
    const before = readFd(smDir, id, 'health.json', null);
    if (isObj(before) && typeof before.generatedAt === 'string' && withoutStamp(before) === withoutStamp(health)) {
      health.generatedAt = before.generatedAt;
      return health;
    }
    writeFd(smDir, id, 'health.json', health);
  }
  return health;
}
