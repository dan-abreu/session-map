// Every health check of the catalog in one map: item id -> check(ctx). The groups live in their own files; this one
// only joins them, so the orchestrator (health.mjs) and the tests ask a single place. A check is pure over the context
// and may be async (the three that ask git are); the orchestrator awaits all of them.
import { COMMUNITY_CHECKS } from './community.mjs';
import { CHECKS as SECURITY_FILES } from './security-files.mjs';
import { SECURITY_CI_CHECKS } from './security-ci.mjs';
import { CHECKS as SECURITY_API } from './security-api.mjs';
import { CHECKS as RELEASES } from './releases.mjs';
import { DOCS_CHECKS } from './docs.mjs';
import { CHECKS as HYGIENE_TOOLS } from './hygiene-tools.mjs';
import { CHECKS as HYGIENE_FILES } from './hygiene-files.mjs';
import { PRODUCT_CHECKS } from './product.mjs';
import { CHECKS as MANAGEMENT } from './management.mjs';
import { CHECKS as EXTRAS } from './extras.mjs';

export const CHECKS = Object.freeze({
  ...COMMUNITY_CHECKS, ...SECURITY_FILES, ...SECURITY_CI_CHECKS, ...SECURITY_API, ...RELEASES, ...DOCS_CHECKS,
  ...HYGIENE_TOOLS, ...HYGIENE_FILES, ...PRODUCT_CHECKS, ...MANAGEMENT, ...EXTRAS,
});
