import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS } from '../server/foundation/health-checks/extras.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const run = (id, over) => CHECKS[id](fakeHealthCtx(over));
const sr = (r) => [r.state, r.reason];
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
const PUBLIC = { visibility: 'public' };
const code = { 'src/a.js': 'export const a = 1;\n' };
const BIG = 'x'.repeat(210 * 1024);

test('one function per extras item, and no stray ones', () => {
  const ids = HEALTH_ITEMS.filter((i) => i.category === 'extras').map((i) => i.id).sort();
  assert.equal(ids.length, 9);
  assert.deepEqual(Object.keys(CHECKS).sort(), ids);
});

test('AGENTS.md and CLAUDE.md: 5+ lines pass, 2 lines fail, missing fails, no code is na', () => {
  for (const [id, file] of [['extras.agents_md', 'AGENTS.md'], ['extras.claude_md', 'CLAUDE.md']]) {
    assert.equal(run(id, { files: { ...code, [file]: lines(6) } }).state, 'pass');
    assert.deepEqual(sr(run(id, { files: { ...code, [file]: 'one\ntwo' } })), ['fail', 'too-short']);
    assert.equal(run(id, { files: code }).reason, 'missing');
    assert.equal(run(id, { files: { 'README.md': 'x' } }).state, 'na');
    assert.equal(run(id, { files: { ...code, [`docs/${file}`]: lines(8) } }).state, 'fail');
  }
  assert.deepEqual(sr(run('extras.agents_md', { files: { ...code, 'AGENTS.md': BIG } })), ['unverified', 'too-big']);
});

test('ai policy: a section about AI in CONTRIBUTING passes; otherwise fails; private is na', () => {
  const doc = '# Contributing\n\nText\n\n## AI-assisted contributions\n\nDisclose it.';
  assert.equal(run('extras.ai_policy', { ...PUBLIC, files: { 'CONTRIBUTING.md': doc } }).state, 'pass');
  assert.equal(run('extras.ai_policy', { ...PUBLIC, files: { 'CONTRIBUTING.md': '# Contributing\n\nrepair the main street\n' } }).state, 'fail');
  assert.equal(run('extras.ai_policy', { ...PUBLIC, files: { 'docs/AI_POLICY.md': 'x' } }).state, 'pass');
  assert.equal(run('extras.ai_policy', { ...PUBLIC, files: {} }).reason, 'missing');
  assert.equal(run('extras.ai_policy', { visibility: 'private', files: { 'CONTRIBUTING.md': doc } }).state, 'na');
  assert.equal(run('extras.ai_policy', { visibility: 'unknown', files: {} }).state, 'unverified');
  assert.equal(run('extras.ai_policy', { ...PUBLIC, files: { 'CONTRIBUTING.md': '# Contributing\n## Política de IA\nx' } }).state, 'pass');
});

test('llms.txt: root or public/, apps with users only', () => {
  const users = { kinds: ['users'] };
  assert.equal(run('extras.llms_txt', { ...users, files: { 'llms.txt': '# Acme\n> docs' } }).state, 'pass');
  assert.equal(run('extras.llms_txt', { ...users, files: { 'public/LLMS.txt': '# Acme' } }).state, 'pass');
  assert.equal(run('extras.llms_txt', { ...users, files: { 'docs/llms.txt': '# Acme' } }).state, 'fail');
  assert.equal(run('extras.llms_txt', { ...users, files: { 'llms.txt': '' } }).reason, 'too-short');
  assert.equal(run('extras.llms_txt', { kinds: ['code'], files: {} }).state, 'na');
  assert.equal(run('extras.llms_txt', { ...users, files: { 'llms.txt': BIG } }).state, 'unverified');
});

test('repo meta: description, a topic and a homepage; null means unverified', () => {
  const full = { mode: 'token', description: 'A thing', topics: ['cli'], homepage: 'https://acme.example' };
  assert.equal(run('extras.repo_meta', { ...PUBLIC, api: full }).state, 'pass');
  const miss = run('extras.repo_meta', { ...PUBLIC, api: { ...full, topics: [], homepage: '' } });
  assert.deepEqual(sr(miss), ['fail', 'missing']);
  assert.deepEqual(miss.detail.missing, ['topics', 'homepage']);
  const none = run('extras.repo_meta', { ...PUBLIC, api: { mode: 'none', description: null, topics: null, homepage: null } });
  assert.deepEqual(sr(none), ['unverified', 'no-token']);
  assert.equal(run('extras.repo_meta', { ...PUBLIC }).state, 'unverified');
  assert.equal(run('extras.repo_meta', { ...PUBLIC, api: { ...full, homepage: null } }).state, 'unverified');
  assert.equal(run('extras.repo_meta', { ...PUBLIC, api: { ...full, homepage: null, description: '' } }).state, 'fail');
  assert.equal(run('extras.repo_meta', { visibility: 'private', api: full }).state, 'na');
});

test('social image is always unverified no-data (nothing local can say)', () => {
  assert.deepEqual(sr(run('extras.social_image', { ...PUBLIC })), ['unverified', 'no-data']);
  assert.equal(run('extras.social_image', { ...PUBLIC, api: { mode: 'token' } }).state, 'unverified');
  assert.equal(run('extras.social_image', { visibility: 'private' }).state, 'na');
});

test('badges: two or more in the README pass, one fails, none fails', () => {
  const b = (n) => `![b${n}](https://img.shields.io/badge/x-${n}-green)`;
  assert.equal(run('extras.badges', { ...PUBLIC, files: { 'README.md': `# A\n${b(1)} ${b(2)}` } }).state, 'pass');
  const html = '<img src="https://github.com/ana/acme/actions/workflows/ci.yml/badge.svg">';
  assert.equal(run('extras.badges', { ...PUBLIC, files: { 'README.md': `# A\n${b(1)}\n${html}` } }).state, 'pass');
  const one = run('extras.badges', { ...PUBLIC, files: { 'README.md': `# A\n${b(1)}\n![logo](logo.png)` } });
  assert.deepEqual(sr(one), ['fail', 'too-short']);
  assert.equal(one.detail.count, 1);
  assert.equal(run('extras.badges', { ...PUBLIC, files: { 'README.md': '# A' } }).state, 'fail');
  assert.equal(run('extras.badges', { ...PUBLIC, files: {} }).reason, 'missing');
  assert.equal(run('extras.badges', { visibility: 'private', files: {} }).state, 'na');
  assert.equal(run('extras.badges', { ...PUBLIC, files: { 'README.md': BIG } }).reason, 'too-big');
});

test('openssf badge: from the api only', () => {
  for (const level of ['passing', 'silver', 'gold']) assert.equal(run('extras.openssf_badge', { ...PUBLIC, api: { mode: 'token', openssfBadge: level } }).state, 'pass');
  assert.deepEqual(sr(run('extras.openssf_badge', { ...PUBLIC, api: { mode: 'token', openssfBadge: false } })), ['fail', 'missing']);
  assert.deepEqual(sr(run('extras.openssf_badge', { ...PUBLIC, api: { mode: 'none', openssfBadge: null } })), ['unverified', 'no-token']);
  assert.equal(run('extras.openssf_badge', { ...PUBLIC, api: { mode: 'none', error: 'no-network', openssfBadge: null } }).reason, 'no-network');
  assert.equal(run('extras.openssf_badge', { visibility: 'private' }).state, 'na');
});

test('spdx headers: 80% of the code files with an identifier in the first 5 lines', () => {
  const lib = { kinds: ['library'] };
  const withId = (i) => [`src/f${i}.js`, `// SPDX-License-Identifier: MIT\nexport const x${i} = 1;\n`];
  const without = (i) => [`src/g${i}.js`, `export const y${i} = 1;\n`];
  const mk = (a, b) => Object.fromEntries([...Array.from({ length: a }, (_, i) => withId(i)), ...Array.from({ length: b }, (_, i) => without(i))]);
  assert.equal(run('extras.spdx_headers', { ...lib, files: mk(8, 2) }).state, 'pass');
  const r = run('extras.spdx_headers', { ...lib, files: mk(7, 3) });
  assert.deepEqual(sr(r), ['fail', 'missing']);
  assert.deepEqual([r.detail.count, r.detail.total], [7, 10]);
  const late = { 'src/a.js': `${lines(6)}\n// SPDX-License-Identifier: MIT\n` };
  assert.equal(run('extras.spdx_headers', { ...lib, files: late }).state, 'fail');
  assert.equal(run('extras.spdx_headers', { kinds: ['library'], files: { 'README.md': 'x' } }).state, 'na');
  assert.equal(run('extras.spdx_headers', { kinds: ['users'], files: mk(8, 2) }).state, 'na');
});
