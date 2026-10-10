import test from 'node:test';
import assert from 'node:assert/strict';
import { detectItem, globRe, matchPaths, REASONS } from '../server/foundation/practices-detect.mjs';

// The detectors of the best-practices engine (B5-T9). Rule that decides every case: what could not be verified is
// `unverified` with a reason, never `fail`.

const NOW = '2026-10-10T12:00:00.000Z';
const file = (path, over = {}) => ({ path, type: 'other', kind: 'code', included: true, reason: null, bytes: 10, ...over });
const census = (paths, over = {}) => ({ version: 1, head: 'a'.repeat(40), files: paths.map((p) => (typeof p === 'string' ? file(p) : p)), ...over });
const reader = (texts) => (rel) => (Object.hasOwn(texts, rel) ? texts[rel] : null);
const ctx = (over = {}) => ({ census: census([]), readText: reader({}), now: NOW, ...over });
const item = (detect, extra = {}) => ({ id: 'x.item', detect, ...extra });

test('a pattern with no slash matches the root, .github and docs, and nothing deeper', () => {
  const re = globRe('SECURITY.md');
  for (const p of ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md', 'security.md']) assert.ok(re.test(p), p);
  for (const p of ['packages/a/SECURITY.md', 'src/docs/SECURITY.md', 'SECURITY.md.bak']) assert.ok(!re.test(p), p);
});

test('globs: ** crosses folders (and may be empty), * stays inside one, a folder name matches its files', () => {
  assert.ok(globRe('**/terms*').test('terms.md'));
  assert.ok(globRe('**/terms*').test('apps/web/terms-of-use.md'));
  assert.ok(globRe('docs/**/incident*').test('docs/incident-plan.md'));
  assert.ok(globRe('docs/**/incident*').test('docs/ops/incident-plan.md'));
  assert.ok(!globRe('docs/**/incident*').test('src/incident-plan.md'));
  assert.ok(globRe('app/layout.*').test('app/layout.tsx'));
  assert.ok(!globRe('app/layout.*').test('app/x/layout.tsx'));
  assert.ok(globRe('prisma/migrations').test('prisma/migrations/001/migration.sql'));
  assert.ok(!globRe('prisma/migrations').test('prisma/migrations-old/x.sql'));
  assert.ok(globRe('next.config.*').test('next.config.mjs'));
  assert.ok(!globRe('a+b.md').test('aab.md'), 'regex characters in a pattern are plain text');
});

test('matchPaths lists census paths sorted, ignoring none', () => {
  const c = census(['docs/b.md', 'docs/a.md', 'src/x.js']);
  assert.deepEqual(matchPaths(['docs/*.md'], c.files), ['docs/a.md', 'docs/b.md']);
});

test('file: pass with the path as evidence, fail when no pattern matches, unverified/no-data without a census', () => {
  const c = ctx({ census: census(['README.md', 'docs/SECURITY.md']) });
  const hit = detectItem(item({ kind: 'file', anyOf: ['SECURITY.md', 'LICENSE'] }), c);
  assert.equal(hit.state, 'pass');
  assert.deepEqual(hit.evidence, [{ file: 'docs/SECURITY.md', line: 1 }]);
  const miss = detectItem(item({ kind: 'file', anyOf: ['LICENSE', 'LICENSE.md'] }), c);
  assert.deepEqual([miss.state, miss.reason, miss.evidence], ['fail', null, []]);
  const none = detectItem(item({ kind: 'file', anyOf: ['LICENSE'] }), ctx({ census: null }));
  assert.deepEqual([none.state, none.reason], ['unverified', 'no-data']);
});

test('file: a file the census lists as excluded (generated lockfile) still exists; .git is the census head', () => {
  const c = ctx({ census: census([file('pnpm-lock.yaml', { included: false, kind: 'generated' })]) });
  assert.equal(detectItem(item({ kind: 'file', anyOf: ['pnpm-lock.yaml'] }), c).state, 'pass');
  assert.equal(detectItem(item({ kind: 'file', anyOf: ['.git'] }), c).state, 'pass');
});

test('file: .git without a head is unverified/tool-missing unless the caller proves the folder has no .git', () => {
  const git = item({ kind: 'file', anyOf: ['.git'] });
  // A census with no head may only mean git was missing or timed out: that is no proof the project has no history.
  const unknown = detectItem(git, ctx({ census: census(['a.js'], { head: null }) }));
  assert.deepEqual([unknown.state, unknown.reason, unknown.evidence], ['unverified', 'tool-missing', []]);
  const folderButNoHead = detectItem(git, ctx({ census: census(['a.js'], { head: null }), gitDir: true }));
  assert.deepEqual([folderButNoHead.state, folderButNoHead.reason], ['unverified', 'tool-missing']);
  const noFolder = detectItem(git, ctx({ census: census(['a.js'], { head: null }), gitDir: false }));
  assert.deepEqual([noFolder.state, noFolder.reason], ['fail', null]);
  const either = detectItem(item({ kind: 'file', anyOf: ['.git', 'a.js'] }), ctx({ census: census(['a.js'], { head: null }) }));
  assert.equal(either.state, 'pass', 'another pattern that matches still passes');
});

test('content: contains found = pass with the line; an empty file is fail; a file without it is fail', () => {
  const texts = { 'SECURITY.md': '# Security\n\nWrite to the maintainer\n', 'EMPTY.md': '  \n\n', 'OTHER.md': 'nothing here\n' };
  const c = ctx({ census: census(Object.keys(texts)), readText: reader(texts) });
  const pass = detectItem(item({ kind: 'content', files: ['SECURITY.md'], contains: ['maintainer'] }), c);
  assert.deepEqual([pass.state, pass.evidence], ['pass', [{ file: 'SECURITY.md', line: 3 }]]);
  const empty = detectItem(item({ kind: 'content', files: ['EMPTY.md'], contains: ['x'] }), c);
  assert.deepEqual([empty.state, empty.reason, empty.evidence], ['fail', null, [{ file: 'EMPTY.md', line: 1 }]]);
  const miss = detectItem(item({ kind: 'content', files: ['OTHER.md'], contains: ['maintainer'] }), c);
  assert.equal(miss.state, 'fail');
});

test('content: a file that exists but is blank fails even when the file list also matches nothing else', () => {
  const c = ctx({ census: census(['SECURITY.md']), readText: reader({ 'SECURITY.md': '\n\n' }) });
  assert.equal(detectItem(item({ kind: 'content', files: ['SECURITY.md'], matches: ['.'] }), c).state, 'fail');
});

test('content: no file matching the list is fail (the census is exact), contains is any-of', () => {
  const c = ctx({ census: census(['a.md']), readText: reader({ 'a.md': 'beta\n' }) });
  assert.equal(detectItem(item({ kind: 'content', files: ['nope.md'], contains: ['beta'] }), c).state, 'fail');
  assert.equal(detectItem(item({ kind: 'content', files: ['a.md'], contains: ['alpha', 'beta'] }), c).state, 'pass');
});

test('content: matches is a regex over the text, case-sensitive, reports the line of the first hit', () => {
  const texts = { 'README.md': '# acme\n\nRun it:\n\n    pnpm install\n' };
  const c = ctx({ census: census(['README.md']), readText: reader(texts) });
  const r = detectItem(item({ kind: 'content', files: ['README.md'], matches: ['(npm|pnpm)\\s+\\w+'] }), c);
  assert.deepEqual([r.state, r.evidence], ['pass', [{ file: 'README.md', line: 5 }]]);
  assert.equal(detectItem(item({ kind: 'content', files: ['README.md'], matches: ['PNPM'] }), c).state, 'fail');
});

test('content: minLines counts non-blank lines; fewer lines is fail', () => {
  const c = ctx({ census: census(['SECURITY.md']), readText: reader({ 'SECURITY.md': 'security\n\nreport\n' }) });
  const base = { kind: 'content', files: ['SECURITY.md'], contains: ['security'] };
  assert.equal(detectItem(item({ ...base, minLines: 2 }), c).state, 'pass');
  assert.equal(detectItem(item({ ...base, minLines: 3 }), c).state, 'fail');
});

test('content: a file that cannot be read is unverified/no-data, never fail; a hit elsewhere still passes', () => {
  const c = ctx({ census: census(['a.md', 'b.md']), readText: reader({ 'b.md': 'secret word' }) });
  const unread = detectItem(item({ kind: 'content', files: ['a.md'], contains: ['x'] }), c);
  assert.deepEqual([unread.state, unread.reason], ['unverified', 'no-data']);
  assert.equal(detectItem(item({ kind: 'content', files: ['*.md'], contains: ['secret'] }), c).state, 'pass');
  const noReader = detectItem(item({ kind: 'content', files: ['a.md'], contains: ['x'] }), ctx({ census: census(['a.md']), readText: null }));
  assert.deepEqual([noReader.state, noReader.reason], ['unverified', 'no-data']);
  const noCensus = detectItem(item({ kind: 'content', files: ['a.md'], contains: ['x'] }), ctx({ census: null }));
  assert.equal(noCensus.state, 'unverified');
});

test('content: reads only included files and never a secrets file', () => {
  const asked = [];
  const readText = (rel) => { asked.push(rel); return 'KEY=1'; };
  const c = ctx({
    census: census([file('.env', { included: false, kind: 'secret' }), file('.env.example'), file('dist/a.js', { included: false, kind: 'generated' })]),
    readText,
  });
  detectItem(item({ kind: 'content', files: ['.env*', 'dist/*.js', '.env.example'], contains: ['KEY'] }), c);
  assert.deepEqual(asked, ['.env.example']);
});

test('content: a matching file the census left out as binary (README saved as UTF-16) is unverified/no-data, not fail', () => {
  const asked = [];
  const readText = (rel) => { asked.push(rel); return null; };
  const utf16 = () => file('README.md', { included: false, reason: 'binary', kind: 'binary' });
  const r = detectItem(item({ kind: 'content', files: ['README.md'], contains: ['npm install'] }), ctx({ census: census([utf16()]), readText }));
  assert.deepEqual([r.state, r.reason, r.evidence], ['unverified', 'no-data', []]);
  assert.deepEqual(asked, [], 'a binary row is never opened');
  const rule = item({ kind: 'content', files: ['README.md'], contains: ['npm install'] });
  const hit = ctx({ census: census([utf16(), 'docs/README.md']), readText: reader({ 'docs/README.md': 'run npm install\n' }) });
  assert.equal(detectItem(rule, hit).state, 'pass', 'a hit elsewhere still passes');
  const miss = ctx({ census: census([utf16(), 'docs/README.md']), readText: reader({ 'docs/README.md': 'nothing\n' }) });
  assert.equal(detectItem(rule, miss).state, 'unverified', 'the unread binary could still hold it');
});

test('content: a match that is only generated, a library or a secret is not the project text: fail, and never read', () => {
  const asked = [];
  const readText = (rel) => { asked.push(rel); return 'KEY=1'; };
  const c = ctx({
    census: census([
      file('.env', { included: false, kind: 'secret', reason: 'secret' }),
      file('dist/a.js', { included: false, kind: 'generated', reason: 'generated' }),
      file('node_modules/x/a.js', { included: false, kind: 'dep', reason: 'dep' }),
    ]),
    readText,
  });
  assert.equal(detectItem(item({ kind: 'content', files: ['.env', 'dist/*.js', 'node_modules/**/*.js'], contains: ['KEY'] }), c).state, 'fail');
  assert.deepEqual(asked, []);
});

test('content: stops at the read budget and says unverified instead of guessing', () => {
  const paths = Array.from({ length: 450 }, (_, i) => `src/f${i}.js`);
  const c = ctx({ census: census(paths), readText: () => 'nothing\n' });
  const r = detectItem(item({ kind: 'content', files: ['src/*.js'], contains: ['needle'] }), c);
  assert.deepEqual([r.state, r.reason], ['unverified', 'no-data']);
});

test('health: mirrors the state of the health item and its evidence; without health.json it is unverified/no-data', () => {
  const health = { items: [
    { id: 'community.security', state: 'fail', evidence: [{ file: 'SECURITY.md', line: 1, sha: 'x' }], reason: null },
    { id: 'security.branch_protection', state: 'unverified', evidence: [], reason: 'no-token' },
    { id: 'hygiene.ci', state: 'unverified', evidence: [], reason: 'something-new' },
    { id: 'releases.tags', state: 'na', evidence: [], reason: 'whatever' },
    { id: 'hygiene.tests', state: 'pass', evidence: [{ file: 'package.json', line: 7 }], reason: null },
  ] };
  const c = ctx({ health });
  const at = (id) => detectItem(item({ kind: 'health', id }), c);
  assert.deepEqual(at('community.security'), { state: 'fail', reason: null, evidence: [{ file: 'SECURITY.md', line: 1 }] });
  assert.deepEqual([at('security.branch_protection').state, at('security.branch_protection').reason], ['unverified', 'no-token']);
  assert.equal(at('hygiene.ci').reason, 'no-data', 'a reason outside the contract list becomes no-data');
  assert.deepEqual([at('releases.tags').state, at('releases.tags').reason], ['na', 'not-applicable']);
  assert.equal(at('hygiene.tests').state, 'pass');
  assert.deepEqual([at('missing.id').state, at('missing.id').reason], ['unverified', 'no-data']);
  for (const h of [undefined, null, {}]) {
    const r = detectItem(item({ kind: 'health', id: 'hygiene.ci' }), ctx({ health: h }));
    assert.deepEqual([r.state, r.reason], ['unverified', 'no-data']);
  }
  assert.ok(REASONS.includes('no-token'));
});

test('health: accepts the list of items directly', () => {
  const r = detectItem(item({ kind: 'health', id: 'a' }), ctx({ health: [{ id: 'a', state: 'pass', evidence: [] }] }));
  assert.equal(r.state, 'pass');
});

test('dep: found = pass with the manifest line; manifests read but dependency absent = fail; nothing read = unverified', () => {
  const deps = [{ name: 'fastify', file: 'package.json', line: 9 }, { name: '@fastify/helmet', file: 'apps/api/package.json', line: 12 }];
  const c = ctx({ deps });
  const pass = detectItem(item({ kind: 'dep', name: '@Fastify/Helmet' }), c);
  assert.deepEqual([pass.state, pass.evidence], ['pass', [{ file: 'apps/api/package.json', line: 12 }]]);
  assert.equal(detectItem(item({ kind: 'dep', name: '@fastify/rate-limit' }), c).state, 'fail');
  for (const d of [undefined, []]) {
    const r = detectItem(item({ kind: 'dep', name: '@fastify/rate-limit' }), ctx({ deps: d }));
    assert.deepEqual([r.state, r.reason], ['unverified', 'no-data']);
  }
});

test('dep: an integration fact that names the package also counts', () => {
  const facts = [{ id: 'integration:stripe', kind: 'integration', file: 'packages/adapters/pay.ts', line: 2, attrs: { package: 'stripe', via: 'sdk' } }];
  const r = detectItem(item({ kind: 'dep', name: 'stripe' }), ctx({ facts, deps: [{ name: 'zod', file: 'package.json', line: 3 }] }));
  assert.deepEqual([r.state, r.evidence], ['pass', [{ file: 'packages/adapters/pay.ts', line: 2 }]]);
});

const life = (cycles) => ({ product: 'next', cycles: cycles.map(([cycle, supportUntil, securityUntil]) => ({ cycle, supportUntil, securityUntil, source: 'https://example.com/x' })) });
const stackCtx = (version, over = {}) => ctx({
  stacks: [{ name: 'next', version, file: 'apps/web/package.json', line: 12 }],
  pkg: { id: 'stack-next', kind: 'stack', status: 'confirmed', checkedAt: '2026-09-01', lifecycle: life([['16', null, null], ['15', '2025-10-21', '2026-10-21'], ['14', '2024-10-26', '2025-10-26']]) },
  ...over,
});
const sv = { kind: 'supported-version', stack: 'next' };

test('supported-version: open-ended and in-date cycles pass, an ended cycle fails, with the manifest line', () => {
  const open = detectItem(item(sv), stackCtx('16.0.1'));
  assert.deepEqual([open.state, open.evidence], ['pass', [{ file: 'apps/web/package.json', line: 12 }]]);
  assert.equal(detectItem(item(sv), stackCtx('15.2.0')).state, 'pass', 'security support until 2026-10-21');
  assert.equal(detectItem(item(sv), stackCtx('15.2.0', { now: '2026-10-21T23:00:00Z' })).state, 'pass', 'the last day still counts');
  assert.equal(detectItem(item(sv), stackCtx('15.2.0', { now: '2026-10-22T00:00:00Z' })).state, 'fail');
  assert.equal(detectItem(item(sv), stackCtx('14.1.0')).state, 'fail');
});

test('supported-version: unknown version or cycle, or an old source, is unverified and never fail', () => {
  const noVersion = detectItem(item(sv), stackCtx(null));
  assert.deepEqual([noVersion.state, noVersion.reason], ['unverified', 'no-data']);
  const unknownCycle = detectItem(item(sv), stackCtx('17.0.0'));
  assert.deepEqual([unknownCycle.state, unknownCycle.reason], ['unverified', 'no-data']);
  const old = stackCtx('14.1.0', { now: '2028-01-01T00:00:00Z' });
  assert.deepEqual([detectItem(item(sv), old).state, detectItem(item(sv), old).reason], ['unverified', 'stale-source']);
  const recheck = stackCtx('16.0.0', { pkg: { id: 'stack-next', kind: 'stack', status: 'recheck', checkedAt: '2026-09-01', lifecycle: life([['16', null, null]]) } });
  assert.equal(detectItem(item(sv), recheck).reason, 'stale-source');
  const noLife = stackCtx('16.0.0', { pkg: { id: 'stack-next', kind: 'stack', status: 'confirmed', checkedAt: '2026-09-01' } });
  assert.equal(detectItem(item(sv), noLife).reason, 'no-data');
});

test('supported-version: the most specific cycle wins, and a stack the project does not use is na', () => {
  const c = stackCtx('5.1.0', { pkg: { id: 's', kind: 'stack', status: 'confirmed', checkedAt: '2026-09-01', lifecycle: life([['5', null, null], ['5.1', null, '2026-01-01']]) } });
  assert.equal(detectItem(item(sv), c).state, 'fail');
  const none = detectItem(item(sv), ctx({ stacks: [] }));
  assert.deepEqual([none.state, none.reason], ['na', 'not-applicable']);
});

test('manual: always unverified/needs-human (an attest is applied by the engine, not here)', () => {
  const r = detectItem(item({ kind: 'manual' }), ctx());
  assert.deepEqual(r, { state: 'unverified', reason: 'needs-human', evidence: [] });
});

test('an unknown detector kind or a missing detect is unverified/no-data', () => {
  assert.equal(detectItem(item({ kind: 'telepathy' }), ctx()).reason, 'no-data');
  assert.equal(detectItem({ id: 'x' }, ctx()).state, 'unverified');
});
