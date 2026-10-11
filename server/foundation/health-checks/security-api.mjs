// Health checks (fd08) for the security items that need the GitHub API. Each check is a pure function of the context:
// no network here. A field the API did not give (`null`) is never a failure, it is "not verified" with the honest reason.
import { HEALTH_ITEMS } from '../health-items.mjs';
import { appliesTo } from '../health-score.mjs';

const ITEM = new Map(HEALTH_ITEMS.map((i) => [i.id, i]));

const result = (state, extra = {}) => ({ state, evidence: [], reason: null, detail: {}, ...extra });

// Why a null API field cannot be answered: no-network when the fetch failed that way, no-token when there was no token
// (or no facts at all), otherwise the API simply did not say.
export function unverifiedFor(ctx) {
  const api = ctx?.api;
  if (api?.error === 'no-network') return result('unverified', { reason: 'no-network' });
  if (!api || api.mode !== 'token') return result('unverified', { reason: 'no-token' });
  return result('unverified', { reason: 'no-data' });
}

// Wraps a check: answers `na` (or `unverified`) when the item does not apply to this repository.
export function guarded(id, fn) {
  return (ctx) => {
    const applies = appliesTo(ITEM.get(id), ctx);
    if (!applies.applies) return result(applies.state, { reason: applies.reason });
    return fn(ctx);
  };
}

const failMissing = (detail = {}) => result('fail', { reason: 'missing', detail });
const ok = (detail = {}) => result('pass', { detail });

const SIGNATURE = /\.(sig|asc|sigstore|sigstore\.json|intoto\.jsonl|minisig)$/i;

export const CHECKS = {
  'security.secret_scanning': guarded('security.secret_scanning', (ctx) => {
    const a = ctx.api;
    if (a?.secretScanning === false || a?.pushProtection === false) return failMissing();
    if (a?.secretScanning == null || a?.pushProtection == null) return unverifiedFor(ctx);
    return ok();
  }),

  'security.branch_protection': guarded('security.branch_protection', (ctx) => {
    const v = ctx.api?.branchProtection;
    if (v == null) return unverifiedFor(ctx);
    return v ? ok() : failMissing();
  }),

  'security.code_review': guarded('security.code_review', (ctx) => {
    const ratio = ctx.api?.reviewRatio;
    if (typeof ratio !== 'number') return unverifiedFor(ctx);
    return ratio >= 0.5 ? ok({ ratio }) : failMissing({ ratio });
  }),

  // versions.json (OSV) answers first because it needs no token; the API alerts come second.
  'security.known_vulns': guarded('security.known_vulns', (ctx) => {
    const pieces = Array.isArray(ctx.versions?.pieces) ? ctx.versions.pieces : [];
    const bad = pieces.filter((p) => p?.warning?.kind === 'vulnerable');
    if (bad.length) {
      const ids = [...new Set(bad.flatMap((p) => p.warning.ids ?? []))];
      return result('fail', { reason: 'unsafe', detail: { ids, count: ids.length, pieces: bad.map((p) => p.name).filter(Boolean) } });
    }
    const open = ctx.api?.vulnAlerts?.open;
    if (typeof open === 'number') return open > 0 ? result('fail', { reason: 'unsafe', detail: { count: open } }) : ok({ count: 0 });
    if (pieces.some((p) => p?.verified)) return ok({ count: 0 });
    return unverifiedFor(ctx);
  }),

  'security.private_reporting': guarded('security.private_reporting', (ctx) => {
    const v = ctx.api?.privateReporting;
    if (v == null) return unverifiedFor(ctx);
    return v ? ok() : failMissing();
  }),

  'security.signed_releases': guarded('security.signed_releases', (ctx) => {
    const releases = ctx.api?.releases;
    if (!Array.isArray(releases)) return unverifiedFor(ctx);
    if (releases.length === 0) return result('unverified', { reason: 'no-data' });
    const unsigned = releases.filter((r) => !(r.assets ?? []).some((n) => SIGNATURE.test(n))).map((r) => r.tag);
    return unsigned.length ? failMissing({ tags: unsigned, count: unsigned.length }) : ok({ count: releases.length });
  }),

  // SLSA proxy: the Scorecard "Signed-Releases" or "Packaging" check scoring at least 5 (-1 means "not applicable").
  'security.slsa': guarded('security.slsa', (ctx) => {
    const checks = ctx.api?.scorecard?.checks;
    if (!checks || typeof checks !== 'object') return unverifiedFor(ctx);
    const scores = ['Signed-Releases', 'Packaging'].map((n) => checks[n]).filter((n) => typeof n === 'number' && n >= 0);
    if (!scores.length) return result('unverified', { reason: 'no-data' });
    return Math.max(...scores) >= 5 ? ok() : failMissing();
  }),

  'security.two_factor_webhooks': guarded('security.two_factor_webhooks', (ctx) => {
    const { webhooks, twoFactor } = ctx.api ?? {};
    const hooks = Array.isArray(webhooks) ? webhooks : null;
    const insecure = hooks ? hooks.filter((h) => h && h.secure === false).length : 0;
    if (twoFactor === false || insecure > 0) return result('fail', { reason: 'unsafe', detail: { insecure, twoFactor: twoFactor ?? null } });
    if (!hooks || twoFactor == null) return unverifiedFor(ctx);
    return ok({ count: hooks.length });
  }),
};
