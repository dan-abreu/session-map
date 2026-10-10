import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, sha256Of, verifyManifest, webpSize } from '../scripts/shots-manifest.mjs';
import { LANGS, SCREENS, findChrome, parseShotsArgs, shotName, shotUrl, todayLocal } from '../scripts/readme-shots.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// A tiny stand-in image set: the manifest only cares about bytes, never about pixels.
const files = new Map([['en-map.webp', Buffer.from('map bytes')], ['pt-map.webp', Buffer.from('mapa bytes')]]);
const images = () => Object.fromEntries([...files].map(([name, buf]) => [name, { sha: sha(buf), width: 1440, height: 900, lang: name.slice(0, 2) === 'pt' ? 'pt-BR' : 'en' }]));
const manifest = () => buildManifest({ version: '0.3.0', date: '2026-10-10', images: images() });
const read = (name) => files.get(name) ?? null;

test('buildManifest writes the documented shape, images sorted by name', () => {
  const m = buildManifest({ version: '0.3.0', date: '2026-10-10', images: { 'pt-map.webp': { sha: 'b', width: 2, height: 3, lang: 'pt-BR' }, 'en-map.webp': { sha: 'a', width: 1, height: 1, lang: 'en' } } });
  assert.deepEqual(Object.keys(m), ['version', 'date', 'tool', 'images']);
  assert.equal(m.version, '0.3.0');
  assert.equal(m.date, '2026-10-10');
  assert.equal(m.tool, 'scripts/readme-shots.mjs');
  assert.deepEqual(Object.keys(m.images), ['en-map.webp', 'pt-map.webp']);
  assert.deepEqual(m.images['en-map.webp'], { sha: 'a', width: 1, height: 1, lang: 'en' });
});

test('buildManifest refuses a version or a date that is not one', () => {
  assert.throws(() => buildManifest({ version: 'next', date: '2026-10-10', images: {} }), /version/);
  assert.throws(() => buildManifest({ version: '0.3.0', date: '10/10/2026', images: {} }), /date/);
});

test('a manifest that matches its images, version and day has no failure', () => {
  assert.deepEqual(verifyManifest(manifest(), { version: '0.3.0', today: '2026-10-10', readImage: read, publish: true }), []);
});

test('an image edited by hand is sha-differs', () => {
  files.set('en-map.webp', Buffer.from('map bytes, retouched'));
  try {
    const m = buildManifest({ version: '0.3.0', date: '2026-10-10', images: { ...images(), 'en-map.webp': { sha: sha(Buffer.from('map bytes')), width: 1, height: 1, lang: 'en' } } });
    const out = verifyManifest(m, { version: '0.3.0', today: '2026-10-10', readImage: read });
    assert.deepEqual(out.map((f) => [f.code, f.image]), [['sha-differs', 'en-map.webp']]);
  } finally {
    files.set('en-map.webp', Buffer.from('map bytes'));
  }
});

test('an image that is not there is image-missing', () => {
  const out = verifyManifest(manifest(), { version: '0.3.0', today: '2026-10-10', readImage: (n) => (n === 'pt-map.webp' ? null : read(n)) });
  assert.deepEqual(out.map((f) => [f.code, f.image]), [['image-missing', 'pt-map.webp']]);
});

test('the manifest of an older version is version-differs', () => {
  const out = verifyManifest(manifest(), { version: '0.3.1', today: '2026-10-10', readImage: read });
  assert.deepEqual(out.map((f) => f.code), ['version-differs']);
  assert.equal(out[0].expected, '0.3.1');
  assert.equal(out[0].found, '0.3.0');
});

test('yesterday only fails when publishing', () => {
  const args = { version: '0.3.0', today: '2026-10-11', readImage: read };
  assert.deepEqual(verifyManifest(manifest(), args), [], 'the cheap check does not look at the day');
  assert.deepEqual(verifyManifest(manifest(), { ...args, publish: true }).map((f) => f.code), ['date-not-today']);
});

test('failures add up: wrong version, old day and a missing image together', () => {
  const out = verifyManifest(manifest(), { version: '0.4.0', today: '2027-01-01', readImage: () => null, publish: true });
  assert.deepEqual(out.map((f) => f.code), ['version-differs', 'date-not-today', 'image-missing', 'image-missing']);
});

test('something that is not a manifest is manifest-invalid, never a crash', () => {
  for (const bad of [null, undefined, 'x', {}, { version: '0.3.0', date: '2026-10-10' }, { version: '0.3.0', date: '2026-10-10', images: [] }]) {
    const out = verifyManifest(bad, { version: '0.3.0', today: '2026-10-10', readImage: read, publish: true });
    assert.deepEqual(out.map((f) => f.code), ['manifest-invalid']);
  }
});

test('sha256Of is the hash of the bytes', () => {
  assert.equal(sha256Of(Buffer.from('abc')), sha(Buffer.from('abc')));
});

// Smallest valid headers of the three WebP flavours, size fields only.
const riff = (fourcc, body) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(fourcc), Buffer.alloc(4), body]);
test('webpSize reads the three WebP flavours', () => {
  const lossy = Buffer.alloc(10); lossy.set([0x9d, 0x01, 0x2a], 3); lossy.writeUInt16LE(1440, 6); lossy.writeUInt16LE(900, 8);
  assert.deepEqual(webpSize(riff('VP8 ', lossy)), { width: 1440, height: 900 });
  const ext = Buffer.alloc(10); ext.writeUIntLE(780 - 1, 4, 3); ext.writeUIntLE(1688 - 1, 7, 3);
  assert.deepEqual(webpSize(riff('VP8X', ext)), { width: 780, height: 1688 });
  const lossless = Buffer.alloc(5); lossless[0] = 0x2f;
  lossless.writeUInt32LE((390 - 1) | ((844 - 1) << 14), 1);
  assert.deepEqual(webpSize(riff('VP8L', lossless)), { width: 390, height: 844 });
  assert.equal(webpSize(Buffer.from('not an image at all, really')), null);
});

test('the script has six screens in two languages: twelve files, the names the README already uses', () => {
  assert.deepEqual(LANGS, ['en', 'pt-BR']);
  assert.deepEqual(SCREENS.map((s) => s.id), ['map', 'tour', 'part', 'waiting', 'help', 'phone']);
  const names = SCREENS.flatMap((s) => LANGS.map((l) => shotName(s, l)));
  assert.equal(new Set(names).size, 12);
  for (const n of ['en-map.webp', 'pt-map.webp', 'en-phone.webp', 'pt-help.webp']) assert.ok(names.includes(n), n);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  for (const n of names.filter((x) => x.startsWith('en-'))) assert.ok(readme.includes(`docs/images/${n}`), `README shows ${n}`);
});

test('every screen is reached by a direct link, never by clicking a tab', () => {
  const demoProject = JSON.parse(readFileSync(join(root, 'demo', 'state.json'), 'utf8')).projects[0].id;
  for (const s of SCREENS) {
    assert.match(s.query, /^\?/, s.id);
    assert.ok(s.width > 0 && s.height > 0, s.id);
    assert.ok(s.query.includes(`project=${demoProject}`), `${s.id} names the demo project`);
    for (const sel of s.clicks ?? []) assert.doesNotMatch(sel, /tab|view/i, `${s.id}: ${sel} is not a tab`);
  }
  assert.ok(SCREENS.find((s) => s.id === 'phone').mobile);
  assert.equal(shotUrl('http://127.0.0.1:4100', SCREENS[0]), `http://127.0.0.1:4100/${SCREENS[0].query}`);
});

test('findChrome: CHROME_PATH first, then the usual places, else null', () => {
  const has = (set) => (p) => set.includes(p);
  assert.equal(findChrome({ CHROME_PATH: 'X:/mine/chrome.exe' }, 'win32', has(['X:/mine/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'])), 'X:/mine/chrome.exe');
  assert.equal(findChrome({}, 'win32', has(['C:/Program Files/Google/Chrome/Application/chrome.exe'])), 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  assert.equal(findChrome({}, 'linux', has(['/usr/bin/google-chrome'])), '/usr/bin/google-chrome');
  assert.equal(findChrome({}, 'darwin', has(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findChrome({}, 'linux', has([])), null);
  assert.equal(findChrome({ CHROME_PATH: 'X:/gone/chrome.exe' }, 'win32', has(['C:/Program Files/Google/Chrome/Application/chrome.exe'])), null, 'a wrong CHROME_PATH is an error, not a silent fallback');
});

test('parseShotsArgs: --out defaults to docs/images, --port is optional', () => {
  assert.equal(parseShotsArgs([]).out, join(root, 'docs', 'images'));
  const a = parseShotsArgs(['--out', 'some/dir', '--port', '4123']);
  assert.ok(a.out.endsWith(join('some', 'dir')));
  assert.equal(a.port, 4123);
});

test('todayLocal is the local calendar day, not UTC', () => {
  assert.equal(todayLocal(new Date(2026, 9, 10, 23, 59)), '2026-10-10');
  assert.equal(todayLocal(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
});

test('without Chrome the script says so and exits 2, before starting anything', () => {
  const out = mkdtempSync(join(tmpdir(), 'sm-shots-nochrome-'));
  try {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'readme-shots.mjs'), '--out', out], { env: { ...process.env, CHROME_PATH: join(out, 'no-chrome.exe') }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Chrome/);
    assert.deepEqual(readdirSync(out), [], 'nothing written');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the pre-push hook hands everything to the gate, and keeps git stdin', () => {
  const hook = readFileSync(join(root, '.githooks', 'pre-push'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh\n/);
  assert.match(hook, /^exec node scripts\/release-gate\.mjs --pre-push "\$@"$/m);
  assert.ok(!hook.includes('\r'), 'LF only: sh chokes on CRLF');
});

test('CONTRIBUTING explains how to publish a version', () => {
  const t = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');
  assert.match(t, /^## Publishing a release$/m);
  for (const needle of ['git config core.hooksPath .githooks', 'npm run gate', 'npm run shots']) assert.ok(t.includes(needle), needle);
});

test('end to end with a real Chrome: twelve images, the manifest matches their hashes', { skip: process.env.SESSION_MAP_SHOTS_E2E === '1' ? false : 'set SESSION_MAP_SHOTS_E2E=1 to open a real browser', timeout: 240_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'sm-shots-e2e-'));
  try {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'readme-shots.mjs'), '--out', out], { encoding: 'utf8', timeout: 220_000 });
    assert.equal(r.status, 0, r.stderr);
    const shots = readdirSync(out).filter((f) => f.endsWith('.webp')).sort();
    assert.equal(shots.length, 12);
    const m = JSON.parse(readFileSync(join(out, 'shots.json'), 'utf8'));
    assert.equal(m.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
    assert.equal(m.date, todayLocal());
    assert.deepEqual(Object.keys(m.images), shots);
    assert.deepEqual(verifyManifest(m, { version: m.version, today: todayLocal(), readImage: (n) => (existsSync(join(out, n)) ? readFileSync(join(out, n)) : null), publish: true }), []);
    for (const n of shots) {
      assert.ok(statSync(join(out, n)).size > 5_000, `${n} is not blank`);
      const size = webpSize(readFileSync(join(out, n)));
      assert.deepEqual({ width: m.images[n].width, height: m.images[n].height }, size, n);
    }
    assert.notEqual(m.images['en-map.webp'].sha, m.images['pt-map.webp'].sha, 'the two languages differ');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
