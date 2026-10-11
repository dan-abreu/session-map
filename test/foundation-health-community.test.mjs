import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_CHECKS } from '../server/foundation/health-checks/community.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const STATES = ['pass', 'fail', 'unverified', 'na'];
const run = (id, files, over = {}) => COMMUNITY_CHECKS[id](fakeHealthCtx({ files, ...over }));
const lines = (n, text = 'a real line of text') => Array.from({ length: n }, (_, i) => `${text} ${i}`).join('\n');

test('every community.* item of the catalog has one check, and none extra', () => {
  const ids = HEALTH_ITEMS.filter((i) => i.category === 'community').map((i) => i.id).sort();
  assert.deepEqual(Object.keys(COMMUNITY_CHECKS).sort(), ids);
  assert.equal(ids.length, 13);
});

test('every check answers with one of the 4 states and an evidence list; an empty repo is fail/missing', () => {
  for (const [id, fn] of Object.entries(COMMUNITY_CHECKS)) {
    const r = fn(fakeHealthCtx({ files: {} }));
    assert.ok(STATES.includes(r.state), id);
    assert.ok(Array.isArray(r.evidence), id);
    assert.equal(r.state, 'fail', id);
    assert.equal(r.reason, 'missing', id);
  }
});

test('readme: 3 lines is too short, 12 lines with 2 titles passes', () => {
  const short = run('community.readme', { 'README.md': '# A\nline\nline' });
  assert.equal(short.state, 'fail');
  assert.equal(short.reason, 'too-short');
  assert.deepEqual(short.evidence, [{ file: 'README.md' }]);
  const ok = run('community.readme', { 'README.md': `# Title\n## Use\n${lines(10)}` });
  assert.equal(ok.state, 'pass');
  assert.equal(ok.evidence[0].file, 'README.md');
});

test('readme: 12 lines but one title is still too short', () => {
  assert.equal(run('community.readme', { 'README.md': `# Title\n${lines(11)}` }).state, 'fail');
});

test('security: template with your-email@example.com is a placeholder, a real address passes', () => {
  const body = (mail) => `# Security\n${lines(5)}\nReport to ${mail}`;
  const bad = run('community.security', { 'SECURITY.md': body('your-email@example.com') });
  assert.equal(bad.state, 'fail');
  assert.equal(bad.reason, 'placeholder');
  assert.equal(bad.evidence[0].line, 7);
  assert.equal(run('community.security', { 'SECURITY.md': body('ana@acme.dev') }).state, 'pass');
  assert.equal(run('community.security', { '.github/security.txt': body('ana@acme.dev') }).state, 'pass');
});

test('security: long enough but no channel is no-contact; a short one is too-short', () => {
  assert.equal(run('community.security', { 'SECURITY.md': `# S\n${lines(8)}` }).reason, 'no-contact');
  assert.equal(run('community.security', { 'SECURITY.md': '# S\nmail ana@acme.dev' }).reason, 'too-short');
});

test('license: 2 lines fails, a full MIT text passes and names the SPDX id', () => {
  const tiny = run('community.license', { LICENSE: 'MIT\nDo what you want' });
  assert.equal(tiny.state, 'fail');
  assert.equal(tiny.reason, 'too-short');
  const mit = run('community.license', { LICENSE: 'MIT License\n\nCopyright (c) 2026 Ana\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software\nand so on' });
  assert.equal(mit.state, 'pass');
  assert.equal(mit.detail.spdx, 'MIT');
  const apache = run('community.license', { LICENSE: `Apache License\nVersion 2.0, January 2004\n${lines(5)}` });
  assert.equal(apache.detail.spdx, 'Apache-2.0');
});

test('license: a license field in package.json counts when there is no file', () => {
  const r = run('community.license', { 'package.json': '{"name":"x","license":"ISC"}' });
  assert.equal(r.state, 'pass');
  assert.equal(r.detail.spdx, 'ISC');
  assert.equal(run('community.license', { 'docs/LICENSE': lines(10) }).state, 'fail');
});

test('code of conduct, contributing and support check length and content', () => {
  assert.equal(run('community.code_of_conduct', { 'CODE_OF_CONDUCT.md': `# C\n${lines(5)}\nwrite ana@acme.dev` }).state, 'pass');
  assert.equal(run('community.code_of_conduct', { 'CODE_OF_CONDUCT.md': `# C\n${lines(5)}\nwrite <CONTACT EMAIL>` }).reason, 'placeholder');
  assert.equal(run('community.code_of_conduct', { 'CODE_OF_CONDUCT.md': `# C\n${lines(6)}` }).reason, 'no-contact');
  assert.equal(run('community.contributing', { 'CONTRIBUTING.md': `# C\n${lines(6)}\nrun the test first\nopen a pull request` }).state, 'pass');
  assert.equal(run('community.contributing', { 'CONTRIBUTING.md': `# C\n${lines(9)}` }).reason, 'invalid');
  assert.equal(run('community.contributing', { 'CONTRIBUTING.md': '# C\nshort' }).reason, 'too-short');
  assert.equal(run('community.support', { 'SUPPORT.md': '# Help\nask at https://acme.dev/help\nthanks' }).state, 'pass');
  assert.equal(run('community.support', { 'SUPPORT.md': '# Help\nask\nthanks' }).reason, 'no-contact');
});

test('funding is only read from .github/', () => {
  assert.equal(run('community.funding', { 'FUNDING.yml': 'github: ana' }).state, 'fail');
  assert.equal(run('community.funding', { '.github/FUNDING.yml': 'github: ana' }).state, 'pass');
  assert.equal(run('community.funding', { '.github/FUNDING.yml': 'nothing: here' }).reason, 'invalid');
});

test('issue templates: .yml needs name and description, .md needs name and about', () => {
  const noDesc = run('community.issue_templates', { '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nbody: []' });
  assert.equal(noDesc.state, 'fail');
  assert.equal(noDesc.reason, 'invalid');
  assert.equal(run('community.issue_templates', { '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\ndescription: Report a bug\nbody: []' }).state, 'pass');
  assert.equal(run('community.issue_templates', { '.github/ISSUE_TEMPLATE/bug.md': '---\nname: Bug\nabout: Report\n---\nText' }).state, 'pass');
  assert.equal(run('community.issue_templates', { '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false' }).state, 'fail');
});

test('pr template, discussion templates, codeowners, citation, governance', () => {
  assert.equal(run('community.pr_template', { '.github/pull_request_template.md': '## What\n## Why\n## Test' }).state, 'pass');
  assert.equal(run('community.pr_template', { 'docs/PULL_REQUEST_TEMPLATE.md': 'x' }).reason, 'too-short');
  assert.equal(run('community.discussion_templates', { '.github/DISCUSSION_TEMPLATE/ideas.yml': 'title: x' }).state, 'pass');
  assert.equal(run('community.codeowners', { '.github/CODEOWNERS': '* @ana' }).state, 'pass');
  assert.equal(run('community.codeowners', { CODEOWNERS: '# * @<GITHUB USER OR TEAM>' }).reason, 'placeholder');
  assert.equal(run('community.codeowners', { CODEOWNERS: 'src/ nobody' }).reason, 'invalid');
  assert.equal(run('community.citation', { 'CITATION.cff': 'cff-version: 1.2.0\ntitle: X\nauthors:\n  - name: Ana' }).state, 'pass');
  assert.equal(run('community.citation', { 'CITATION.cff': 'cff-version: 1.2.0' }).reason, 'invalid');
  assert.equal(run('community.governance', { 'GOVERNANCE.md': `# G\n${lines(5)}` }).state, 'pass');
  assert.equal(run('community.governance', { 'GOVERNANCE.md': '# G' }).reason, 'too-short');
});
