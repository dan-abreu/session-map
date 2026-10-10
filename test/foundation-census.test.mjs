import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusOf, diffCensus, sumsOf, trimLog } from '../server/foundation/census.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS, ENV_FILE } from './fixtures/repo-copy.mjs';

const answer = JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-shop.answer.json'), 'utf8'));
const owners = new Map(Object.entries(answer.owners));
const byPath = (census) => new Map(census.files.map((f) => [f.path, f]));

// The independent counter of this test: no lexer, no shared code. Text facts only (comments come from the answer file).
function naive(text) {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return {
    total: text === '' ? 0 : lines.length,
    blank: lines.filter((l) => l.trim() === '').length,
    bytes: Buffer.byteLength(text),
    chars: [...text].length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

const ZERO = () => ({ files: 0, bytes: 0, chars: 0, words: 0, lines: { total: 0, code: 0, comment: 0, blank: 0 } });
function add(acc, f) {
  acc.files += 1;
  for (const k of ['bytes', 'chars', 'words']) acc[k] += f[k];
  for (const k of ['total', 'code', 'comment', 'blank']) acc.lines[k] += f.lines[k];
  return acc;
}
const sumOf = (files) => files.reduce(add, ZERO());

function withFixture(fn, opts) {
  return async () => {
    const root = copyFixtureRepo('acme-shop', opts);
    try { await fn(root); } finally { removeFixtureRepo(root); }
  };
}

test('every figure matches the independent counter, file by file', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const included = census.files.filter((f) => f.included);
  assert.ok(included.length > 25);
  for (const f of included) {
    const n = naive(readFileSync(join(root, f.path), 'utf8'));
    assert.deepEqual({ bytes: f.bytes, chars: f.chars, words: f.words, total: f.lines.total, blank: f.lines.blank }, n, f.path);
    assert.ok(f.lines.code >= 0 && f.lines.comment >= 0, f.path);
  }
  // The five files counted by hand (comment and code too).
  for (const [path, want] of Object.entries(answer.counts)) {
    const f = byPath(census).get(path);
    assert.deepEqual({ ...f.lines, bytes: f.bytes, chars: f.chars, words: f.words }, want, path);
  }
}));

test('the contract shape: version, rev, head, tool, type and kind per file, sha of 16 hex', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  assert.equal(census.version, 1);
  assert.equal(census.rev, 1);
  assert.equal(census.tool, 'own');
  assert.match(census.head, /^[0-9a-f]{40}$/);
  assert.match(census.generatedAt, /^\d{4}-\d\d-\d\dT/);
  const files = byPath(census);
  const orders = files.get('apps/api/src/routes/orders.ts');
  assert.equal(orders.type, 'ts');
  assert.equal(orders.kind, 'code');
  assert.equal(orders.included, true);
  assert.equal(orders.reason, null);
  assert.match(orders.sha, /^[0-9a-f]{16}$/);
  assert.match(orders.mtime, /^\d{4}-\d\d-\d\dT/);
  assert.equal(orders.owner, 'orders');
  assert.equal(files.get('packages/db/prisma/schema.prisma').type, 'prisma');
  assert.equal(files.get('apps/web/app/page.tsx').type, 'tsx');
  assert.equal(files.get('pnpm-workspace.yaml').type, 'yaml');
  assert.equal(files.get('README.md').type, 'md');
  assert.equal(files.get('package.json').type, 'json');
  assert.equal(files.get('LICENSE').type, 'other');
  assert.equal(files.get('docs/architecture/web.md').kind, 'doc');
}));

test('the sha is the first 16 hex of the sha256 of the bytes', withFixture(async (root) => {
  const { createHash } = await import('node:crypto');
  const census = await censusOf(root, null, { owners });
  const f = byPath(census).get('apps/api/src/server.ts');
  assert.equal(f.sha, createHash('sha256').update(readFileSync(join(root, f.path))).digest('hex').slice(0, 16));
}));

test('sums: a folder equals its files (subfolders included), the total equals the first-level folders plus the root files', withFixture(async (root) => {
  const { files, sums } = await censusOf(root, null, { owners });
  const included = files.filter((f) => f.included);
  assert.deepEqual(sums.total, sumOf(included));
  assert.ok(Object.keys(sums.folders).includes('apps/api/src/routes'));
  assert.ok(Object.keys(sums.folders).includes('apps'));
  for (const [folder, sum] of Object.entries(sums.folders)) {
    assert.deepEqual(sum, sumOf(included.filter((f) => f.path.startsWith(`${folder}/`))), folder);
  }
  const first = Object.entries(sums.folders).filter(([k]) => !k.includes('/')).map(([, v]) => v);
  const rootFiles = included.filter((f) => !f.path.includes('/'));
  const merged = ZERO();
  for (const s of first) {
    merged.files += s.files;
    for (const k of ['bytes', 'chars', 'words']) merged[k] += s[k];
    for (const k of ['total', 'code', 'comment', 'blank']) merged.lines[k] += s.lines[k];
  }
  for (const f of rootFiles) add(merged, f);
  assert.deepEqual(sums.total, merged);
}));

test('sums: the parts add up to the total, with one owner per file and the ownerless ones apart in _none', withFixture(async (root) => {
  const { files, sums } = await censusOf(root, null, { owners });
  const parts = Object.values(sums.parts);
  const merged = ZERO();
  for (const s of parts) {
    merged.files += s.files;
    for (const k of ['bytes', 'chars', 'words']) merged[k] += s[k];
    for (const k of ['total', 'code', 'comment', 'blank']) merged.lines[k] += s.lines[k];
  }
  assert.deepEqual(merged, sums.total);
  const included = files.filter((f) => f.included);
  assert.equal(sums.parts._none.files, included.filter((f) => answer.owners[f.path] === null).length);
  assert.ok(sums.parts._none.files > 0);
  assert.deepEqual(sums.parts.orders, sumOf(included.filter((f) => answer.owners[f.path] === 'orders')));
  assert.equal(files.find((f) => f.path === 'apps/admin/pages/dashboard.tsx').owner, null);
}));

test('sumsOf works on its own, on the rows of a census', async () => {
  const rows = [
    { path: 'a/x.js', included: true, owner: 'p', bytes: 3, chars: 3, words: 1, lines: { total: 2, code: 1, comment: 0, blank: 1 } },
    { path: 'a/b/y.js', included: true, owner: null, bytes: 5, chars: 5, words: 2, lines: { total: 1, code: 1, comment: 0, blank: 0 } },
    { path: 'z.md', included: true, owner: 'p', bytes: 1, chars: 1, words: 1, lines: { total: 1, code: 0, comment: 0, blank: 1 } },
    { path: 'lock.yaml', included: false, owner: null, bytes: 900, chars: null, words: null, lines: null },
  ];
  const sums = sumsOf(rows);
  assert.equal(sums.total.files, 3);
  assert.equal(sums.total.bytes, 9);
  assert.equal(sums.folders.a.files, 2);
  assert.equal(sums.folders['a/b'].bytes, 5);
  assert.equal(sums.folders.z, undefined);
  assert.equal(sums.parts.p.files, 2);
  assert.equal(sums.parts._none.files, 1);
});

test('what is left out: counted by reason, listed with included false, and the secret is never opened', withFixture(async (root) => {
  const reads = [];
  const readFile = (p, ...rest) => { reads.push(String(p)); return readFileSync(p, ...rest); };
  const census = await censusOf(root, null, { owners, readFile });
  assert.deepEqual(census.excluded, answer.excluded);
  const files = byPath(census);

  const env = files.get('.env');
  assert.equal(env.included, false);
  assert.equal(env.kind, 'secret');
  assert.equal(env.reason, 'secret');
  assert.equal(env.bytes, Buffer.byteLength(ENV_FILE));
  assert.ok(env.mtime);
  for (const k of ['chars', 'words', 'lines', 'sha', 'owner']) assert.equal(env[k], null, k);
  assert.ok(!reads.some((p) => /[\\/]\.env$/.test(p)), 'the .env was opened');
  assert.ok(!JSON.stringify(census).includes('do-not-read-42'));

  const lock = files.get('pnpm-lock.yaml');
  assert.deepEqual([lock.included, lock.kind, lock.reason, lock.sha, lock.lines], [false, 'generated', 'generated', null, null]);
  assert.ok(lock.bytes > 0);
  assert.ok(!reads.some((p) => p.endsWith('pnpm-lock.yaml')));

  const logo = files.get('apps/web/public/logo.png');
  assert.deepEqual([logo.included, logo.kind, logo.reason], [false, 'binary', 'binary']);
  assert.ok(!files.has('node_modules/x/index.js'), 'ignored libraries are counted, not listed');
  assert.equal(census.sums.total.files, census.files.filter((f) => f.included).length);
}));

test('a NUL byte in the first 8 KB makes the file binary, even with a text name', withFixture(async (root) => {
  writeFileSync(join(root, 'notes.txt'), Buffer.from([104, 105, 0, 106]));
  const census = await censusOf(root, null, { owners });
  const f = byPath(census).get('notes.txt');
  assert.deepEqual([f.included, f.kind, f.reason, f.sha, f.lines, f.chars], [false, 'binary', 'binary', null, null, null]);
  assert.equal(census.excluded.binary, answer.excluded.binary + 1);
}));

test('a NUL byte late in the first 8 KB (byte 8100 of 8192) still makes the file binary', withFixture(async (root) => {
  const buf = Buffer.alloc(9000, 0x61);
  buf[8100] = 0;
  writeFileSync(join(root, 'late.txt'), buf);
  const f = byPath(await censusOf(root, null, { owners })).get('late.txt');
  assert.deepEqual([f.included, f.reason], [false, 'binary']);
}));

test('a text file with no trailing newline, CRLF and non-BMP characters is counted the same way', withFixture(async (root) => {
  const text = 'a b\r\n\r\n  \r\nsmile \u{1F600} é\r\nlast';
  writeFileSync(join(root, 'odd.txt'), text);
  const f = byPath(await censusOf(root, null, { owners })).get('odd.txt');
  const want = naive(text);
  assert.deepEqual({ bytes: f.bytes, chars: f.chars, words: f.words, total: f.lines.total, blank: f.lines.blank }, { ...want, total: 5, blank: 2 });
  assert.equal(f.chars, text.length - 1, 'one code point outside the BMP counts once');
  assert.equal(f.lines.comment, 0);
}));

test('running again with nothing changed keeps the rev and reads nothing', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  let reads = 0;
  const readFile = (...a) => { reads++; return readFileSync(...a); };
  const second = await censusOf(root, first, { owners, readFile });
  assert.equal(reads, 0);
  assert.equal(second.rev, first.rev);
  assert.deepEqual(second.files, first.files);
  assert.deepEqual(second.sums, first.sums);
  assert.deepEqual(second.excluded, first.excluded);
}));

test('editing one file changes only its row, and the extract shows before and after', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  const path = 'apps/api/src/server.ts';
  writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}// one more line\n`);
  const reads = [];
  const readFile = (p, ...a) => { reads.push(String(p)); return readFileSync(p, ...a); };
  const second = await censusOf(root, first, { owners, readFile });
  assert.equal(reads.length, 1);
  assert.ok(reads[0].endsWith('server.ts'));
  assert.equal(second.rev, first.rev + 1);
  const was = byPath(first);
  const now = byPath(second);
  const differing = second.files.filter((f) => f.sha !== was.get(f.path)?.sha).map((f) => f.path);
  assert.deepEqual(differing, [path]);
  assert.equal(now.get(path).lines.total, was.get(path).lines.total + 1);
  assert.equal(now.get(path).lines.comment, was.get(path).lines.comment + 1);

  const diff = diffCensus(first, second);
  assert.equal(diff.rev, second.rev);
  assert.equal(diff.from, first.rev);
  assert.equal(diff.at, second.generatedAt);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.changed.length, 1);
  const c = diff.changed[0];
  assert.equal(c.path, path);
  assert.deepEqual(c.before, { lines: was.get(path).lines.total, chars: was.get(path).chars, sha: was.get(path).sha });
  assert.deepEqual(c.after, { lines: now.get(path).lines.total, chars: now.get(path).chars, sha: now.get(path).sha });
  assert.equal(diff.totals.before.files, first.sums.total.files);
  assert.equal(diff.totals.after.lines, second.sums.total.lines.total);
  assert.equal(diff.totals.after.chars, second.sums.total.chars);
}));

test('a file created and then deleted shows up in added and then in removed', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  writeFileSync(join(root, 'apps/api/src/new.ts'), 'export const x = 1;\n');
  const second = await censusOf(root, first, { owners });
  const added = diffCensus(first, second);
  assert.equal(second.rev, first.rev + 1);
  assert.deepEqual(added.added, [{ path: 'apps/api/src/new.ts', lines: 1, chars: 20 }]);
  assert.deepEqual([added.removed, added.changed], [[], []]);
  assert.equal(added.totals.after.files, added.totals.before.files + 1);
  assert.equal(second.sums.folders['apps/api/src'].files, first.sums.folders['apps/api/src'].files + 1);

  unlinkSync(join(root, 'apps/api/src/new.ts'));
  unlinkSync(join(root, 'apps/api/src/log.ts'));
  const third = await censusOf(root, second, { owners });
  const removed = diffCensus(second, third);
  assert.equal(third.rev, second.rev + 1);
  assert.deepEqual(removed.removed.map((r) => r.path), ['apps/api/src/log.ts', 'apps/api/src/new.ts']);
  assert.equal(removed.removed[0].lines, byPath(second).get('apps/api/src/log.ts').lines.total);
  assert.equal(removed.added.length, 0);
}));

test('only the time of a file changing (same bytes) rereads it but keeps the rev', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(root, 'README.md'), later, later);
  const reads = [];
  const readFile = (p, ...a) => { reads.push(String(p)); return readFileSync(p, ...a); };
  const second = await censusOf(root, first, { owners, readFile });
  assert.deepEqual(reads.map((p) => p.split(/[\\/]/).pop()), ['README.md']);
  assert.equal(second.rev, first.rev);
  assert.notEqual(byPath(second).get('README.md').mtime, byPath(first).get('README.md').mtime);
  assert.equal(byPath(second).get('README.md').sha, byPath(first).get('README.md').sha);
  const diff = diffCensus(first, second);
  assert.deepEqual([diff.added, diff.removed, diff.changed], [[], [], []]);
}));

test('a new owner for a file moves it between parts and raises the rev, with no row read', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  const moved = new Map(owners).set('apps/web/lib/api.ts', 'orders');
  let reads = 0;
  const second = await censusOf(root, first, { owners: moved, readFile: (...a) => { reads++; return readFileSync(...a); } });
  assert.equal(reads, 0);
  assert.equal(byPath(second).get('apps/web/lib/api.ts').owner, 'orders');
  assert.equal(second.sums.parts.orders.files, first.sums.parts.orders.files + 1);
  assert.equal(second.sums.parts.web.files, first.sums.parts.web.files - 1);
  assert.equal(second.rev, first.rev + 1);
}));

// A spy on the folder listing: which folders under node_modules were opened.
function depSpy() {
  const opened = [];
  const readDir = (dir, ...a) => {
    if (/[\\/]node_modules([\\/]|$)/.test(String(dir))) opened.push(String(dir));
    return readdir(dir, ...a);
  };
  return { opened, readDir };
}

test('a library folder that did not change is not walked again on the next round', withFixture(async (root) => {
  const one = depSpy();
  const first = await censusOf(root, null, { owners, readDir: one.readDir });
  assert.ok(one.opened.length > 0, 'the first round counts the library folder');
  const two = depSpy();
  const second = await censusOf(root, first, { owners, readDir: two.readDir });
  assert.deepEqual(two.opened, []);
  assert.equal(second.excluded.dep, first.excluded.dep);
  assert.equal(second.rev, first.rev);
}));

test('a reinstall (the package manager rewrote its marker) counts the library folder again', withFixture(async (root) => {
  const marker = join(root, 'node_modules', '.package-lock.json');
  writeFileSync(marker, '{}\n');
  const first = await censusOf(root, null, { owners });
  writeFileSync(join(root, 'node_modules', 'x', 'extra.js'), 'module.exports = 2;\n');
  writeFileSync(marker, '{ "v": 2 }\n');
  const later = new Date(Date.now() + 60_000);
  utimesSync(marker, later, later);
  const two = depSpy();
  const second = await censusOf(root, first, { owners, readDir: two.readDir });
  assert.ok(two.opened.length > 0);
  assert.equal(second.excluded.dep, first.excluded.dep + 1);
  assert.equal(second.rev, first.rev + 1);
}));

test('a file that cannot be read is left out with a warning, not dropped in silence', withFixture(async (root) => {
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...a) => { lines.push(String(chunk)); return true; };
  let census;
  try {
    const readFile = (p, ...a) => {
      if (String(p).endsWith('LICENSE')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return readFileSync(p, ...a);
    };
    census = await censusOf(root, null, { owners, readFile });
  } finally { process.stderr.write = write; }
  assert.ok(!byPath(census).has('LICENSE'));
  const warn = lines.map((l) => JSON.parse(l)).find((l) => l.event === 'census-unreadable');
  assert.deepEqual([warn?.level, warn?.path, warn?.code], ['warn', 'LICENSE', 'EBUSY']);
}));

test('without owners every file lands in _none', withFixture(async (root) => {
  const census = await censusOf(root, null);
  assert.deepEqual(Object.keys(census.sums.parts), ['_none']);
  assert.deepEqual(census.sums.parts._none, census.sums.total);
}));

test('a previous census of another version is ignored and the work starts over', withFixture(async (root) => {
  const first = await censusOf(root, null, { owners });
  const second = await censusOf(root, { ...first, version: 9, rev: 40 }, { owners });
  assert.equal(second.rev, 1);
  assert.deepEqual(second.files, first.files);
}));

test('a folder that is not a git repository is walked, skipping .git and library folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-census-plain-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.js'), '// hi\nconst a = 1;\n');
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(root, 'node_modules', 'lib', 'i.js'), 'x\n');
    writeFileSync(join(root, '.env'), 'TOKEN=do-not-read-42\n');
    const census = await censusOf(root, null, {});
    assert.equal(census.head, null);
    assert.deepEqual(census.files.map((f) => f.path).sort(), ['.env', 'src/a.js']);
    assert.deepEqual(byPath(census).get('src/a.js').lines, { total: 2, code: 1, comment: 1, blank: 0 });
    assert.deepEqual(census.excluded, { dep: 1, generated: 0, binary: 0, secret: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('diffCensus from nothing lists every counted file as added', withFixture(async (root) => {
  const census = await censusOf(root, null, { owners });
  const diff = diffCensus(null, census);
  assert.equal(diff.from, 0);
  assert.equal(diff.rev, 1);
  assert.equal(diff.added.length, census.files.filter((f) => f.included).length);
  assert.deepEqual(diff.totals.before, { files: 0, lines: 0, chars: 0 });
  assert.deepEqual(Object.keys(diff).sort(), ['added', 'at', 'changed', 'from', 'removed', 'rev', 'totals']);
}));

test('trimLog keeps the newest 500 lines', () => {
  const lines = Array.from({ length: 620 }, (_, i) => ({ rev: i + 1 }));
  const kept = trimLog(lines, 500);
  assert.equal(kept.length, 500);
  assert.equal(kept[0].rev, 121);
  assert.equal(kept.at(-1).rev, 620);
  assert.equal(trimLog(lines.slice(0, 3)).length, 3);
});

// Timing on a shared machine is noisy: the best of three runs is what the limits are held against.
async function best(times, fn) {
  let fastest = Infinity;
  let last;
  for (let i = 0; i < times; i++) {
    const t = Date.now();
    last = await fn();
    fastest = Math.min(fastest, Date.now() - t);
  }
  return { ms: fastest, last };
}

test('the census of session-map itself: under 5 s the first time and under 1 s the second', async () => {
  const root = join(import.meta.dirname, '..');
  const cold = await best(3, () => censusOf(root, null, { owners: new Map() }));
  const first = cold.last;
  const warm = await best(3, () => censusOf(root, first, { owners: new Map() }));
  assert.ok(first.sums.total.files > 100);
  assert.ok(cold.ms < 5000, `first run took ${cold.ms} ms`);
  assert.ok(warm.ms < 1000, `second run took ${warm.ms} ms`);
});

test('a big count lets the server breathe: other work runs between the files, not only after the last one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-census-breathe-'));
  try {
    for (let i = 0; i < 1200; i++) writeFileSync(join(root, `f${i}.md`), `line ${i}\n`);
    let reads = 0;
    const seenMidway = [];
    let ticking = true;
    const tick = () => { if (!ticking) return; if (reads > 0) seenMidway.push(reads); setImmediate(tick); };
    setImmediate(tick);
    const census = await censusOf(root, null, { readFile: (p) => { reads++; return readFileSync(p); } });
    ticking = false;
    assert.equal(census.files.length, 1200);
    assert.ok(seenMidway.some((n) => n < 1200), `the event loop only turned after all ${reads} reads`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
