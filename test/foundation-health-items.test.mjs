import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_ITEMS, CATEGORIES, WEIGHT } from '../server/foundation/health-items.mjs';

const COUNTS = { community: 13, security: 18, releases: 7, docs: 10, hygiene: 18, product: 9, management: 7, extras: 9 };
const API_ITEMS = [
  'security.sbom', 'security.secret_scanning', 'security.branch_protection', 'security.code_review', 'security.known_vulns',
  'security.private_reporting', 'security.signed_releases', 'security.slsa', 'security.two_factor_webhooks',
  'releases.gh_releases', 'management.labels', 'management.milestones', 'management.projects', 'extras.repo_meta', 'extras.openssf_badge',
];
const DRAFT_IDS = [
  'community.security', 'community.code_of_conduct', 'community.contributing', 'community.support', 'community.issue_templates',
  'community.pr_template', 'community.codeowners', 'security.update_bot', 'hygiene.editorconfig', 'hygiene.gitignore',
  'hygiene.env_example', 'releases.changelog', 'security.gitignore_secrets',
];

test('the catalog has 91 items, frozen', () => {
  assert.equal(HEALTH_ITEMS.length, 91);
  assert.ok(Object.isFrozen(HEALTH_ITEMS));
  assert.ok(Object.isFrozen(HEALTH_ITEMS[0]));
  assert.ok(Object.isFrozen(HEALTH_ITEMS[0].applies));
});

test('items per category are 13/18/7/10/18/9/7/9, in that order', () => {
  assert.deepEqual([...CATEGORIES], Object.keys(COUNTS));
  for (const [cat, n] of Object.entries(COUNTS)) assert.equal(HEALTH_ITEMS.filter((i) => i.category === cat).length, n, cat);
});

test('ids are unique and shaped category.name matching the category field', () => {
  const ids = HEALTH_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, 91);
  for (const i of HEALTH_ITEMS) {
    assert.match(i.id, /^[a-z]+\.[a-z0-9_]+$/);
    assert.equal(i.id.split('.')[0], i.category);
  }
});

test('severity is E/R/A, applies only T P U L C, detect off|api', () => {
  for (const i of HEALTH_ITEMS) {
    assert.ok('ERA'.includes(i.severity) && i.severity.length === 1, i.id);
    assert.ok(i.applies.length > 0 && i.applies.every((a) => 'TPULC'.includes(a)), i.id);
    assert.ok(['off', 'api'].includes(i.detect), i.id);
  }
  assert.deepEqual({ ...WEIGHT }, { E: 3, R: 2, A: 1 });
});

test('detect is api exactly on the items with an API column', () => {
  assert.deepEqual(HEALTH_ITEMS.filter((i) => i.detect === 'api').map((i) => i.id).sort(), [...API_ITEMS].sort());
});

test('every item that has a draft exists in the catalog', () => {
  const ids = new Set(HEALTH_ITEMS.map((i) => i.id));
  for (const d of DRAFT_IDS) assert.ok(ids.has(d), d);
});

test('spot checks against the research table', () => {
  const by = Object.fromEntries(HEALTH_ITEMS.map((i) => [i.id, i]));
  assert.deepEqual([by['community.license'].severity, by['community.license'].applies], ['E', ['P', 'L']]);
  assert.deepEqual([by['security.actions_pinned'].severity, by['security.actions_pinned'].applies], ['R', ['C']]);
  assert.deepEqual([by['product.privacy'].severity, by['product.privacy'].applies], ['E', ['U']]);
  assert.deepEqual([by['extras.spdx_headers'].severity, by['extras.spdx_headers'].applies], ['A', ['L']]);
  assert.deepEqual([by['security.sbom'].severity, by['security.sbom'].applies], ['A', ['L', 'U']]);
});
