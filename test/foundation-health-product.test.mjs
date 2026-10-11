import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_CHECKS } from '../server/foundation/health-checks/product.mjs';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import { fakeHealthCtx } from './support/health-ctx-fake.mjs';

const STATES = ['pass', 'fail', 'unverified', 'na'];
const lines = (n, word = 'text') => Array.from({ length: n }, (_, i) => `${word} line ${i + 1}`).join('\n');
const APP = { 'app/page.tsx': 'export default function Page() { return null; }', 'package.json': '{"name":"acme-app","private":true}' };
const app = (files = {}, over = {}) => fakeHealthCtx({ files: { ...APP, ...files }, ...over });
const run = (id, ctx) => PRODUCT_CHECKS[id](ctx);
const ids = HEALTH_ITEMS.filter((i) => i.category === 'product').map((i) => i.id);

test('there is one check for each of the 9 product items and no other', () => {
  assert.equal(ids.length, 9);
  assert.deepEqual(Object.keys(PRODUCT_CHECKS).sort(), [...ids].sort());
  for (const id of ids) assert.equal(typeof PRODUCT_CHECKS[id], 'function');
});

test('every check answers with a known state, the evidence list and the reason', () => {
  for (const id of ids) {
    const r = run(id, app());
    assert.ok(STATES.includes(r.state), id);
    assert.ok(Array.isArray(r.evidence), id);
    assert.ok('reason' in r && 'detail' in r, id);
    if (r.state === 'pass') assert.equal(r.reason, null, id);
  }
});

test('a library with no users owes none of the 9: all na/no-users, not even a failure', () => {
  const ctx = fakeHealthCtx({ files: {
    'package.json': '{"name":"acme-lib","main":"src/index.js","version":"1.0.0"}',
    'src/index.js': 'export const x = 1;\n',
    'README.md': lines(12),
  } });
  assert.ok(ctx.kinds.has('library') && !ctx.kinds.has('users'));
  for (const id of ids) {
    const r = run(id, ctx);
    assert.equal(r.state, 'na', id);
    assert.equal(r.reason, 'no-users', id);
    assert.deepEqual(r.evidence, [], id);
  }
});

test('an app with screens and no privacy page fails the essential item: missing', () => {
  const r = run('product.privacy', app());
  assert.equal(r.state, 'fail');
  assert.equal(r.reason, 'missing');
});

test('privacy: a document of ten lines passes, with the file as evidence, in any letter case', () => {
  const r = run('product.privacy', app({ 'docs/PRIVACY.md': lines(12) }));
  assert.equal(r.state, 'pass');
  assert.deepEqual(r.evidence, [{ file: 'docs/PRIVACY.md' }]);
  assert.equal(run('product.privacy', app({ 'privacidade.md': lines(10) })).state, 'pass');
  assert.equal(run('product.privacy', app({ 'LGPD.md': lines(10) })).state, 'pass');
});

test('privacy: a short document fails too-short, and one left as a template fails placeholder', () => {
  const short = run('product.privacy', app({ 'PRIVACY.md': lines(4) }));
  assert.equal(short.state, 'fail');
  assert.equal(short.reason, 'too-short');
  const tpl = run('product.privacy', app({ 'PRIVACY.md': `${lines(12)}\nContact: <CONTACT EMAIL>\n` }));
  assert.equal(tpl.state, 'fail');
  assert.equal(tpl.reason, 'placeholder');
  assert.deepEqual(tpl.evidence, [{ file: 'PRIVACY.md', line: 13 }]);
});

test('privacy: a page or route called privacy counts, a source module that only has the word does not', () => {
  assert.equal(run('product.privacy', app({ 'app/privacy/page.tsx': 'export default () => null;' })).state, 'pass');
  assert.equal(run('product.privacy', app({ 'resources/views/privacidade.blade.php': '<h1>x</h1>' })).state, 'pass');
  assert.equal(run('product.privacy', app({ 'lib/screens/privacy_screen.dart': 'class P {}' })).state, 'pass');
  assert.equal(run('product.privacy', app({ 'server/privacy/redact.mjs': 'export const x = 1;' })).state, 'fail');
  assert.equal(run('product.privacy', app({ 'test/fixtures/privacy.md': lines(20) })).state, 'fail');
});

test('terms: terms of service or termos de uso, ten lines', () => {
  assert.equal(run('product.terms', app()).state, 'fail');
  assert.equal(run('product.terms', app({ 'docs/terms.md': lines(10) })).state, 'pass');
  assert.equal(run('product.terms', app({ 'TERMOS-DE-USO.md': lines(10) })).state, 'pass');
  assert.equal(run('product.terms', app({ 'terms-of-service.md': lines(10) })).state, 'pass');
  assert.equal(run('product.terms', app({ 'terms.md': lines(3) })).reason, 'too-short');
});

test('accessibility: a file, or WCAG/axe/aria in the README, docs or tests; the line is the evidence', () => {
  assert.equal(run('product.accessibility', app()).state, 'fail');
  assert.equal(run('product.accessibility', app({ 'ACCESSIBILITY.md': lines(5) })).state, 'pass');
  const readme = run('product.accessibility', app({ 'README.md': '# App\n\nWe follow WCAG 2.2 AA.\n' }));
  assert.equal(readme.state, 'pass');
  assert.deepEqual(readme.evidence, [{ file: 'README.md', line: 3 }]);
  assert.equal(run('product.accessibility', app({ 'docs/ui.md': 'Run axe on every page.' })).state, 'pass');
  assert.equal(run('product.accessibility', app({ 'test/a11y.test.mjs': "import axe from 'axe-core';" })).state, 'pass');
  assert.equal(run('product.accessibility', app({ 'README.md': '# App\nnothing here\n' })).state, 'fail');
});

test('i18n: locale folders, Flutter ARB, Laravel lang/; a fixture folder does not count', () => {
  assert.equal(run('product.i18n', app()).state, 'fail');
  assert.equal(run('product.i18n', app({ 'locales/en.json': '{}' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'lib/l10n/app_en.arb': '{}' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'resources/lang/en/messages.php': '<?php return [];' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'messages/pt.json': '{}' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'web/i18n-fd/read.js': 'export default {};' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'web/i18n.js': 'export const t = () => 1;' })).state, 'pass');
  assert.equal(run('product.i18n', app({ 'src/messages/index.ts': 'export {};' })).state, 'fail');
  assert.equal(run('product.i18n', app({ 'test/fixtures/locales/en.json': '{}' })).state, 'fail');
});

test('observability: a logger, metric or error-report package in a manifest', () => {
  assert.equal(run('product.observability', app()).state, 'fail');
  const pino = run('product.observability', app({ 'package.json': '{"name":"a","dependencies":{"pino":"^9.0.0"}}' }));
  assert.equal(pino.state, 'pass');
  assert.equal(pino.detail.name, 'pino');
  assert.equal(pino.evidence[0].file, 'package.json');
  assert.equal(run('product.observability', app({ 'package.json': '{"name":"a","devDependencies":{"@sentry/node":"1"}}' })).state, 'pass');
  assert.equal(run('product.observability', app({ 'backend/composer.json': '{"require":{"monolog/monolog":"^3"}}' })).state, 'pass');
  assert.equal(run('product.observability', app({ 'pubspec.yaml': 'name: x\ndependencies:\n  flutter:\n    sdk: flutter\n  firebase_crashlytics: ^4.0.0\n' })).state, 'pass');
});

test('observability: the word in a README or in a script is not a dependency', () => {
  const ctx = app({ 'README.md': 'we may add pino later', 'package.json': '{"name":"a","scripts":{"log":"pino-pretty"},"dependencies":{"left-pad":"1"}}' });
  assert.equal(run('product.observability', ctx).state, 'fail');
});

test('incident response: a document about incidents, in the root, docs or runbooks', () => {
  assert.equal(run('product.incident_response', app()).state, 'fail');
  assert.equal(run('product.incident_response', app({ 'docs/INCIDENT_RESPONSE.md': lines(8) })).state, 'pass');
  assert.equal(run('product.incident_response', app({ 'runbooks/incident-response.md': lines(8) })).state, 'pass');
  assert.equal(run('product.incident_response', app({ 'INCIDENTS.md': lines(8) })).state, 'pass');
  assert.equal(run('product.incident_response', app({ 'docs/incidente.md': lines(1) })).reason, 'too-short');
});

test('backup: no document is a fail; a document or a section about backup and restore passes', () => {
  const none = run('product.backup', app({ 'README.md': 'we back up nightly, trust us' }));
  assert.equal(none.state, 'fail');
  assert.equal(none.reason, 'missing');
  assert.equal(run('product.backup', app({ 'docs/backup.md': lines(6) })).state, 'pass');
  assert.equal(run('product.backup', app({ 'runbooks/restore.md': lines(6) })).state, 'pass');
  const section = run('product.backup', app({ 'docs/OPERATIONS.md': '# Ops\n\n## Backup and restore\nDaily dump.\nTest the restore monthly.\n\n## Deploy\nx\n' }));
  assert.equal(section.state, 'pass');
  assert.deepEqual(section.evidence, [{ file: 'docs/OPERATIONS.md', line: 3 }]);
  assert.equal(run('product.backup', app({ 'docs/OPERATIONS.md': '# Ops\n\n## Backup\n\n## Deploy\nx\ny\nz\n' })).state, 'fail');
});

test('status page: a status link in the README, or a STATUS file', () => {
  assert.equal(run('product.status_page', app()).state, 'fail');
  assert.equal(run('product.status_page', app({ 'STATUS.md': lines(2) })).state, 'pass');
  const link = run('product.status_page', app({ 'README.md': '# App\n[Status](https://status.acme.dev)\n' }));
  assert.equal(link.state, 'pass');
  assert.deepEqual(link.evidence, [{ file: 'README.md', line: 2 }]);
  assert.equal(run('product.status_page', app({ 'README.md': 'See https://acme.statuspage.io for uptime' })).state, 'pass');
  assert.equal(run('product.status_page', app({ 'README.md': 'The status of this project is alpha.' })).state, 'fail');
});

test('support channel: SUPPORT.md with a way to reach someone, or a contact section in the README', () => {
  assert.equal(run('product.support_channel', app()).state, 'fail');
  assert.equal(run('product.support_channel', app({ 'SUPPORT.md': 'Need help?\nWrite to ana@acme.dev\nWe answer in two days.\n' })).state, 'pass');
  assert.equal(run('product.support_channel', app({ '.github/SUPPORT.md': 'Need help?\nOpen a thread at https://acme.dev/help\nThanks.\n' })).state, 'pass');
  assert.equal(run('product.support_channel', app({ 'README.md': '# App\n\n## Contact\nWrite to ana@acme.dev\n\n## License\nMIT\n' })).state, 'pass');
  assert.equal(run('product.support_channel', app({ 'README.md': '# App\n\nContact: ana@acme.dev\n' })).state, 'fail');
});

test('support channel: a template left as is fails placeholder, a channel-less file fails no-contact', () => {
  const tpl = run('product.support_channel', app({ 'SUPPORT.md': 'Need help?\nWrite to your-email@example.com\nThanks.\n' }));
  assert.equal(tpl.state, 'fail');
  assert.equal(tpl.reason, 'placeholder');
  const bare = run('product.support_channel', app({ 'SUPPORT.md': 'Need help?\nWe will think about it.\nThanks.\n' }));
  assert.equal(bare.state, 'fail');
  assert.equal(bare.reason, 'no-contact');
  assert.equal(run('product.support_channel', app({ 'SUPPORT.md': 'Help' })).reason, 'too-short');
});

test('a secrets file is never opened by any of the checks', () => {
  const reads = [];
  const ctx = app({ '.env': 'pino=1\nWCAG\nPRIVACY', 'PRIVACY.md': lines(12) });
  const real = ctx.read;
  ctx.read = (p) => { reads.push(p); return real(p); };
  for (const id of ids) run(id, ctx);
  assert.ok(!reads.some((p) => p === '.env' || p.endsWith('/.env')));
});

test('a check never throws on an empty context', () => {
  const ctx = fakeHealthCtx({ files: {}, kinds: ['users'] });
  for (const id of ids) assert.equal(run(id, ctx).state, 'fail', id);
});
