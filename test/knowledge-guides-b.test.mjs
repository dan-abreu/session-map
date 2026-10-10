import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, selectFor, statusOf, validatePackage } from '../server/foundation/library.mjs';
import { loadStandard, unknownStandardRefs } from '../server/foundation/standard.mjs';

// B5-T6: the second half of the technology guides (Laravel, Flutter, mobile apps, libraries).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'knowledge');
const IDS = ['stack-laravel', 'stack-flutter', 'type-mobile', 'type-library'];
const TODAY = '2026-10-10';

const lib = loadLibrary({ sharedDir: DIR });
const mine = (id) => lib.packages.find((p) => p.id === id);
const texts = (o) => JSON.stringify(o);

// Official hosts only: a page opened by hand is the only way a V source gets in.
const OFFICIAL_HOSTS = new Set([
  'laravel.com', 'docs.flutter.dev', 'dart.dev', 'developer.android.com', 'developer.apple.com',
  'support.google.com', 'semver.org', 'keepachangelog.com', 'docs.github.com', 'docs.npmjs.com',
  'spdx.org', 'nodejs.org',
]);

test('the four guides exist, are valid, and are named by their id', () => {
  for (const id of IDS) {
    assert.ok(existsSync(join(DIR, `${id}.json`)), `${id}.json is missing`);
    assert.ok(mine(id), `${id} did not load: ${JSON.stringify(lib.invalid.filter((i) => i.file === `${id}.json`))}`);
  }
  assert.deepEqual(lib.invalid.filter((i) => IDS.includes(i.file.replace(/\.json$/, ''))), []);
});

test('each guide has 4 to 6 items, unique ids prefixed by the guide topic, within 300 lines', () => {
  for (const id of IDS) {
    const pkg = mine(id);
    assert.ok(pkg.items.length >= 4 && pkg.items.length <= 6, `${id} has ${pkg.items.length} items`);
    const lines = readFileSync(join(DIR, `${id}.json`), 'utf8').split('\n').length;
    assert.ok(lines <= 300, `${id}.json has ${lines} lines`);
    assert.ok(validatePackage(pkg).ok);
  }
});

test('kind and applicability: stacks by stack name, types by type name', () => {
  assert.equal(mine('stack-laravel').kind, 'stack');
  assert.deepEqual(mine('stack-laravel').applies.stacks, ['laravel']);
  assert.equal(mine('stack-flutter').kind, 'stack');
  assert.deepEqual(mine('stack-flutter').applies.stacks, ['flutter']);
  assert.equal(mine('type-mobile').kind, 'type');
  assert.deepEqual(mine('type-mobile').applies.types, ['mobile']);
  assert.equal(mine('type-library').kind, 'type');
  assert.deepEqual(mine('type-library').applies.types, ['library']);
});

test('a mobile Flutter project receives stack-flutter and type-mobile, and nothing else of this task', () => {
  const got = selectFor({ types: ['mobile'], stacks: ['flutter'] }, lib.packages).map((p) => p.id);
  assert.ok(got.includes('stack-flutter') && got.includes('type-mobile'));
  assert.ok(!got.includes('stack-laravel') && !got.includes('type-library'));
});

test('a Laravel API receives stack-laravel; a library receives type-library only', () => {
  const api = selectFor({ types: ['api'], stacks: ['laravel'] }, lib.packages).map((p) => p.id);
  assert.ok(api.includes('stack-laravel'));
  assert.ok(!api.includes('type-mobile') && !api.includes('type-library') && !api.includes('stack-flutter'));
  const lb = selectFor({ types: ['library'] }, lib.packages).map((p) => p.id);
  assert.ok(lb.includes('type-library'));
  assert.ok(!lb.includes('type-mobile') && !lb.includes('stack-laravel'));
});

test('every source opens on an official https host and carries a trust mark; a confirmed guide has no NV item', () => {
  for (const id of IDS) {
    const pkg = mine(id);
    for (const item of pkg.items) {
      const { url, trust, name } = item.source;
      assert.ok(name, `${item.id} has no source name`);
      if (trust === 'V') {
        const host = new URL(url).hostname;
        assert.ok(OFFICIAL_HOSTS.has(host), `${item.id} cites an unlisted host ${host}`);
      }
      if (pkg.status === 'confirmed') assert.notEqual(trust, 'NV', `${item.id} is NV in a confirmed package`);
    }
  }
});

test('statusOf is confirmed on the checking date and turns stale-source after 180 days', () => {
  for (const id of IDS) {
    const pkg = mine(id);
    assert.equal(pkg.status, 'confirmed', `${id} should be confirmed (every source was opened)`);
    assert.equal(pkg.checkedAt, TODAY);
    assert.equal(statusOf(pkg, TODAY), 'confirmed');
    assert.equal(statusOf(pkg, '2027-04-08'), 'confirmed'); // day 180
    assert.equal(statusOf(pkg, '2027-04-09'), pkg.kind === 'stack' ? 'stale-source' : 'confirmed');
  }
});

test('Laravel lifecycle lists versions 10 to 13 with https sources and the dates of the official table', () => {
  const life = mine('stack-laravel').lifecycle;
  assert.equal(life.product, 'laravel');
  const by = Object.fromEntries(life.cycles.map((c) => [c.cycle, c]));
  for (const v of ['10', '11', '12', '13']) assert.ok(by[v], `cycle ${v} missing`);
  assert.equal(by['11'].securityUntil, '2026-03-12');
  assert.equal(by['12'].securityUntil, '2027-02-24');
  assert.equal(by['12'].supportUntil, '2026-08-13');
  assert.equal(by['13'].securityUntil, '2028-03-17');
  for (const c of life.cycles) assert.match(c.source, /^https:\/\/laravel\.com\//);
  assert.ok(mine('stack-laravel').items.some((i) => i.detect.kind === 'supported-version' && i.detect.stack === 'laravel'));
});

test('Flutter has no official end-of-life table, so it carries no invented lifecycle', () => {
  assert.ok(!mine('stack-flutter').lifecycle);
});

const SUFFIXES = {
  'stack-laravel': ['supported-version', 'debug-off', 'mass-assignment', 'rate-limit', 'deploy-steps', 'health-route'],
  'stack-flutter': ['signing-keys', 'version-in-pubspec', 'error-handlers', 'obfuscate-symbols', 'stable-channel', 'platform-support'],
  'type-mobile': ['privacy-policy', 'data-declarations', 'account-deletion', 'signing', 'permissions', 'forced-update'],
  'type-library': ['license', 'semver', 'changelog', 'packaging', 'security-policy', 'version-matrix'],
};
for (const [id, suffixes] of Object.entries(SUFFIXES)) {
  test(`${id} covers the topics the brief asks for`, () => {
    const have = mine(id).items.map((i) => i.id);
    for (const s of suffixes) assert.ok(have.some((h) => h.endsWith(`.${s}`)), `${id} has no item ".${s}" (has ${have.join(', ')})`);
  });
}

test('legal and finance fronts bring the fixed "guidance, not advice" notice', () => {
  for (const id of IDS) {
    const pkg = mine(id);
    if (pkg.items.some((i) => i.front === 'legal')) {
      assert.match(pkg.disclaimer.en, /not (legal )?advice/i);
      assert.match(pkg.disclaimer['pt-BR'], /não (é )?parecer|não substitui/i);
    }
  }
  assert.ok(mine('type-mobile').items.some((i) => i.front === 'legal'));
  assert.ok(mine('type-library').items.some((i) => i.front === 'legal'));
});

test('no text claims compliance and no text is a copy of English in the pt-BR slot', () => {
  for (const id of IDS) {
    const pkg = mine(id);
    assert.doesNotMatch(texts(pkg), /compliant|em conformidade|certified|certificado de conformidade/i);
    for (const item of pkg.items) {
      for (const f of ['title', 'what', 'why', 'how', 'doneWhen']) {
        assert.notEqual(item[f].en, item[f]['pt-BR'], `${item.id}.${f} is not translated`);
      }
    }
  }
});

test('nothing personal or real: no e-mail, no home path, no secret-looking value', () => {
  for (const id of IDS) {
    const raw = readFileSync(join(DIR, `${id}.json`), 'utf8');
    assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.\w+/, `${id} has an e-mail`);
    assert.doesNotMatch(raw, /C:\\\\Users|\/home\/|\/Users\//i);
    assert.doesNotMatch(raw, /AKIA[0-9A-Z]{12}|sk_live_|ghp_[A-Za-z0-9]{20}/);
  }
});

test('every `standard` id used by these guides exists in docs/standard', () => {
  const std = loadStandard(join(ROOT, 'docs', 'standard'));
  assert.deepEqual(unknownStandardRefs(IDS.map(mine), std), []);
});

test('items that can be seen in files point at the right files, never at .env', () => {
  for (const id of IDS) {
    for (const item of mine(id).items) {
      const d = item.detect;
      const globs = d.kind === 'file' ? d.anyOf : d.kind === 'content' ? d.files : [];
      for (const g of globs) assert.doesNotMatch(g.split('/').pop(), /^\.env(?!\.example)/, `${item.id} targets ${g}`);
    }
  }
  const flutter = Object.fromEntries(mine('stack-flutter').items.map((i) => [i.id.split('.').pop(), i]));
  assert.equal(flutter['version-in-pubspec'].detect.files[0], 'pubspec.yaml');
  const laravel = Object.fromEntries(mine('stack-laravel').items.map((i) => [i.id.split('.').pop(), i]));
  assert.ok(laravel['mass-assignment'].detect.files.some((f) => f.startsWith('app/Models')));
});
