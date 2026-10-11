import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { CHECKS as SEC } from '../server/foundation/health-checks/security-api.mjs';
import { CHECKS as MAN } from '../server/foundation/health-checks/management.mjs';

const ALL = { ...SEC, ...MAN };
const STATES = new Set(['pass', 'fail', 'unverified', 'na']);
const API_IDS = Object.keys(SEC).concat(['management.labels', 'management.milestones', 'management.projects']);
const facts = (over = {}) => ({ version: 1, mode: 'token', error: null, repo: { host: 'github.com', owner: 'ana', name: 'acme' },
  visibility: 'public', secretScanning: true, pushProtection: true, branchProtection: true, privateReporting: true,
  vulnAlerts: { open: 0 }, reviewRatio: 0.8, releases: [], labels: ['bug', 'good first issue'], milestones: 2, projects: 1,
  webhooks: [], twoFactor: true, scorecard: null, ...over });
const pub = (over = {}) => fakeHealthCtx({ kinds: ['code', 'library'], visibility: 'public', ...over });

test('15 items: 8 security, 7 management, all present in the catalog', () => {
  assert.equal(Object.keys(SEC).length, 8);
  assert.equal(Object.keys(MAN).length, 7);
  for (const id of Object.keys(ALL)) assert.ok(HEALTH_ITEMS.some((i) => i.id === id), id);
  for (const id of Object.keys(SEC)) assert.ok(id.startsWith('security.'), id);
  for (const id of Object.keys(MAN)) assert.ok(id.startsWith('management.'), id);
});

test('every API item reads "not verified, no token" without a token', () => {
  for (const id of API_IDS) {
    for (const api of [null, { mode: 'none', error: null }]) {
      const r = ALL[id](pub({ api }));
      assert.equal(r.state, 'unverified', id);
      assert.equal(r.reason, 'no-token', id);
    }
  }
});

test('no-network error and null field with a token', () => {
  for (const id of API_IDS) {
    assert.equal(ALL[id](pub({ api: { mode: 'none', error: 'no-network' } })).reason, 'no-network', id);
  }
  const r = SEC['security.branch_protection'](pub({ api: facts({ branchProtection: null }) }));
  assert.deepEqual([r.state, r.reason], ['unverified', 'no-data']);
});

test('every item always answers one of the four states', () => {
  for (const [id, fn] of Object.entries(ALL)) {
    for (const ctx of [pub(), pub({ api: facts() }), fakeHealthCtx({ visibility: 'private' })]) {
      const r = fn(ctx);
      assert.ok(STATES.has(r.state), id);
      assert.ok(Array.isArray(r.evidence), id);
    }
  }
});

test('branch protection and code review', () => {
  assert.equal(SEC['security.branch_protection'](pub({ api: facts({ branchProtection: false }) })).state, 'fail');
  assert.equal(SEC['security.branch_protection'](pub({ api: facts() })).state, 'pass');
  assert.equal(SEC['security.code_review'](pub({ api: facts({ reviewRatio: 0.2 }) })).state, 'fail');
  assert.equal(SEC['security.code_review'](pub({ api: facts({ reviewRatio: 0.5 }) })).state, 'pass');
});

test('secret scanning needs both switches', () => {
  assert.equal(SEC['security.secret_scanning'](pub({ api: facts({ pushProtection: false }) })).state, 'fail');
  assert.equal(SEC['security.secret_scanning'](pub({ api: facts({ secretScanning: false, pushProtection: null }) })).state, 'fail');
  assert.equal(SEC['security.secret_scanning'](pub({ api: facts({ pushProtection: null }) })).state, 'unverified');
  assert.equal(SEC['security.secret_scanning'](pub({ api: facts() })).state, 'pass');
});

test('known_vulns reads versions.json before the API', () => {
  const versions = { pieces: [{ name: 'next', verified: true, warning: { kind: 'vulnerable', ids: ['GHSA-1'], detail: 'x' } }] };
  const r = SEC['security.known_vulns'](pub({ versions, api: facts({ vulnAlerts: { open: 0 } }) }));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.detail.ids, ['GHSA-1']);
  const viaApi = SEC['security.known_vulns'](pub({ api: facts({ vulnAlerts: { open: 3 } }) }));
  assert.equal(viaApi.state, 'fail');
  assert.equal(viaApi.detail.count, 3);
  assert.equal(SEC['security.known_vulns'](pub({ api: facts() })).state, 'pass');
  const clean = { pieces: [{ name: 'next', verified: true, warning: null }] };
  assert.equal(SEC['security.known_vulns'](pub({ versions: clean, api: null })).state, 'pass');
});

test('private reporting, signed releases, slsa, webhooks', () => {
  assert.equal(SEC['security.private_reporting'](pub({ api: facts({ privateReporting: false }) })).state, 'fail');
  const rel = (assets) => facts({ releases: [{ tag: 'v1.0.0', hasNotes: true, assets }] });
  assert.equal(SEC['security.signed_releases'](pub({ api: rel(['app.zip']) })).state, 'fail');
  assert.equal(SEC['security.signed_releases'](pub({ api: rel(['app.zip', 'app.zip.sig']) })).state, 'pass');
  assert.equal(SEC['security.signed_releases'](pub({ api: rel(['a.asc']) })).state, 'pass');
  assert.equal(SEC['security.signed_releases'](pub({ api: facts({ releases: [] }) })).state, 'unverified');
  assert.equal(SEC['security.slsa'](pub({ api: facts({ scorecard: { score: 5, checks: { 'Signed-Releases': 8 } } }) })).state, 'pass');
  assert.equal(SEC['security.slsa'](pub({ api: facts({ scorecard: { score: 5, checks: { 'Signed-Releases': 0, Packaging: 0 } } }) })).state, 'fail');
  assert.equal(SEC['security.slsa'](pub({ api: facts({ scorecard: null }) })).state, 'unverified');
  assert.equal(SEC['security.two_factor_webhooks'](pub({ api: facts({ webhooks: [{ secure: false }] }) })).state, 'fail');
  assert.equal(SEC['security.two_factor_webhooks'](pub({ api: facts({ twoFactor: false }) })).state, 'fail');
  assert.equal(SEC['security.two_factor_webhooks'](pub({ api: facts({ twoFactor: null }) })).state, 'unverified');
  assert.equal(SEC['security.two_factor_webhooks'](pub({ api: facts({ webhooks: [{ secure: true }] }) })).state, 'pass');
});

test('private repository: public-only items are na, never a failure', () => {
  const ctx = fakeHealthCtx({ kinds: ['code'], visibility: 'private', api: facts() });
  for (const id of ['security.private_reporting', 'management.labels', 'management.milestones', 'management.projects',
    'management.triage', 'management.response_time', 'management.maintainers', 'management.stale_policy']) {
    const r = ALL[id](ctx);
    assert.deepEqual([r.state, r.reason], ['na', 'private'], id);
  }
});

test('labels need bug and good first issue; milestones and projects need one', () => {
  assert.equal(MAN['management.labels'](pub({ api: facts({ labels: ['bug', 'docs'] }) })).state, 'fail');
  const miss = MAN['management.labels'](pub({ api: facts({ labels: ['Bug'] }) }));
  assert.deepEqual(miss.detail.missing, ['good first issue']);
  assert.equal(MAN['management.labels'](pub({ api: facts({ labels: ['Bug', 'Good First Issue'] }) })).state, 'pass');
  assert.equal(MAN['management.milestones'](pub({ api: facts({ milestones: 0 }) })).state, 'fail');
  assert.equal(MAN['management.milestones'](pub({ api: facts() })).state, 'pass');
  assert.equal(MAN['management.projects'](pub({ api: facts({ projects: 0 }) })).state, 'fail');
  assert.equal(MAN['management.projects'](pub({ api: facts({ projects: null }) })).state, 'unverified');
});

test('triage and response time come from the docs', () => {
  assert.equal(MAN['management.triage'](pub()).state, 'fail');
  const t = MAN['management.triage'](pub({ files: { 'CONTRIBUTING.md': '# C\nWe triage new issues weekly.\n' } }));
  assert.equal(t.state, 'pass');
  assert.deepEqual(t.evidence.map((e) => e.file), ['CONTRIBUTING.md']);
  assert.equal(MAN['management.triage'](pub({ files: { 'SUPPORT.md': '# S\nAsk anything.\n' } })).state, 'fail');
  assert.equal(MAN['management.response_time'](pub({ files: { 'SECURITY.md': '# S\nWe answer within 3 days.\n' } })).state, 'pass');
  assert.equal(MAN['management.response_time'](pub({ files: { 'SUPPORT.md': 'Respondemos em 48 horas.\n' } })).state, 'pass');
  assert.equal(MAN['management.response_time'](pub({ files: { 'SECURITY.md': '# S\nMail us.\n' } })).state, 'fail');
});

test('maintainers: file or CODEOWNERS with owners; two people is a bonus', () => {
  assert.equal(MAN['management.maintainers'](pub()).state, 'fail');
  assert.equal(MAN['management.maintainers'](pub({ files: { '.github/CODEOWNERS': '# owners\n* @ana\n' } })).state, 'pass');
  assert.equal(MAN['management.maintainers'](pub({ files: { '.github/CODEOWNERS': '# owners\n' } })).state, 'fail');
  const two = MAN['management.maintainers'](pub({ files: { 'MAINTAINERS.md': '# Maintainers\n- @ana\n- @bia\n' } }));
  assert.equal(two.state, 'pass');
  assert.equal(two.detail.count, 2);
});

test('stale policy: workflow or doc', () => {
  assert.equal(MAN['management.stale_policy'](pub()).state, 'fail');
  const wf = MAN['management.stale_policy'](pub({ files: { '.github/workflows/stale.yml': 'steps:\n  - uses: actions/stale@v9\n' } }));
  assert.equal(wf.state, 'pass');
  assert.equal(wf.evidence[0].file, '.github/workflows/stale.yml');
  assert.equal(MAN['management.stale_policy'](pub({ files: { 'CONTRIBUTING.md': 'Stale issues are closed after 60 days.' } })).state, 'pass');
});

test('a secrets file is never read for evidence', () => {
  const r = MAN['management.maintainers'](pub({ files: { '.env': 'CODEOWNERS=@ana' } }));
  assert.equal(r.state, 'fail');
});
