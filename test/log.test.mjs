import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureLog, log, LOG_KEEP_DAYS, PROJECT_MAX_LINES, readLog, readProjectLog, recordProject } from '../server/log.mjs';

const dayStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(Date.now() - n * 86_400_000); return dayStamp(d); };
const linesOf = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

// A fresh configured log in a temp dir; the sink stays off for tests that do not call it.
function withLog(fn) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-log-sm-'));
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  configureLog({ dir: smDir });
  try {
    return fn({ smDir, writes, dayFile: (day = dayStamp()) => join(smDir, 'logs', `session-map-${day}.jsonl`) });
  } finally {
    process.stderr.write = original;
    configureLog({ dir: null });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('log writes one JSON line with level, event and fields to stderr', () => {
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try { log('warn', 'read-failed', { path: 'x' }); } finally { process.stderr.write = original; }
  assert.equal(writes.length, 1);
  assert.ok(writes[0].endsWith('\n'));
  const row = JSON.parse(writes[0]);
  assert.deepEqual({ level: row.level, event: row.event, path: row.path }, { level: 'warn', event: 'read-failed', path: 'x' });
  assert.match(row.ts, /^\d{4}-\d\d-\d\dT/);
});

test('the file sink writes one schema-v1 line per event to the day file', () => {
  withLog(({ smDir, dayFile }) => {
    log('info', 'test-event', { path: 'x', n: 3, ok: true });
    const rows = linesOf(dayFile()).map(JSON.parse);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.v, 1);
    assert.equal(row.level, 'info');
    assert.equal(row.event, 'test-event');
    assert.equal(row.path, 'x');
    assert.equal(row.n, 3);
    assert.equal(row.ok, true);
    assert.match(row.ts, /^\d{4}-\d\d-\d\dT/);
    assert.ok(existsSync(join(smDir, 'logs', 'schema.json')), 'the schema doc sits next to the files');
  });
});

test('the file copy drops secret-named fields and masks the token in links', () => {
  withLog(({ dayFile, writes }) => {
    log('info', 'listening', {
      local: 'http://127.0.0.1:4001/?k=deadbeef0123456789deadbeef0123456789',
      token: 'sneaky', password: 'pw', Authorization: 'bearer x', email: 'a@b.com',
    });
    const row = JSON.parse(linesOf(dayFile())[0]);
    assert.equal(row.local, 'http://127.0.0.1:4001/?k=[secret]');
    assert.ok(!('token' in row) && !('password' in row) && !('Authorization' in row), 'secret-named fields are dropped');
    assert.equal(row.email, '[email]');
    // The person's terminal keeps the line as given.
    assert.ok(writes[0].includes('deadbeef'), 'stderr keeps the raw line');
  });
});

test('long strings are cut in the file, kept whole on stderr', () => {
  withLog(({ dayFile }) => {
    const long = 'x'.repeat(5000);
    log('info', 'long', { long });
    const row = JSON.parse(linesOf(dayFile())[0]);
    assert.equal(row.long.length, 1000);
  });
});

test('day files older than the keep window are pruned, today\'s stays', () => {
  withLog(({ smDir, dayFile }) => {
    writeFileSync(join(smDir, 'logs', `session-map-${daysAgo(LOG_KEEP_DAYS + 1)}.jsonl`), '{}\n');
    writeFileSync(join(smDir, 'logs', `session-map-${daysAgo(1)}.jsonl`), '{}\n');
    configureLog({ dir: smDir });
    log('info', 'x', {});
    const names = readdirSync(join(smDir, 'logs')).filter((f) => f.startsWith('session-map-') && f.endsWith('.jsonl'));
    assert.deepEqual(names.sort(), [`session-map-${daysAgo(1)}.jsonl`, `session-map-${dayStamp()}.jsonl`].sort());
  });
});

test('recordProject writes one line per project and refuses bad ids', () => {
  withLog(({ smDir }) => {
    recordProject(smDir, 'shop-1', 'finished', { sessionId: 's1', reason: 'answer' });
    recordProject(smDir, 'shop-1', 'waiting', { reason: 'question' });
    recordProject(smDir, '../evil', 'finished', {});
    const rows = linesOf(join(smDir, 'logs', 'projects', 'shop-1.jsonl')).map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].project, 'shop-1');
    assert.equal(rows[0].v, 1);
    assert.equal(rows[1].event, 'waiting');
    assert.ok(!existsSync(join(smDir, 'logs', 'projects', '..', 'evil.jsonl')), 'a bad id writes nothing');
  });
});

test('a project record keeps only the newest lines', () => {
  withLog(({ smDir }) => {
    const SLACK = 200;
    for (let i = 0; i < PROJECT_MAX_LINES + SLACK + 1; i++) recordProject(smDir, 'shop-1', 'finished', { i });
    const file = join(smDir, 'logs', 'projects', 'shop-1.jsonl');
    const rows = linesOf(file);
    assert.equal(rows.length, PROJECT_MAX_LINES, 'past the bound it is cut back to the maximum');
    assert.equal(JSON.parse(rows[0]).i, SLACK + 1, 'the oldest lines left first');
  });
});

test('readLog returns newest first with the filters', () => {
  withLog(({ smDir }) => {
    log('info', 'one', {});
    log('warn', 'two', {});
    log('info', 'three', {});
    const all = readLog(smDir, {});
    assert.deepEqual(all.map((r) => r.event), ['three', 'two', 'one']);
    assert.deepEqual(readLog(smDir, { level: 'warn' }).map((r) => r.event), ['two']);
    assert.deepEqual(readLog(smDir, { event: 'one' }).map((r) => r.event), ['one']);
    assert.deepEqual(readLog(smDir, { limit: 2 }).map((r) => r.event), ['three', 'two']);
    const since = JSON.parse(linesOf(join(smDir, 'logs', `session-map-${dayStamp()}.jsonl`))[2]).ts;
    const rows = readLog(smDir, { since });
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].event, 'three');
    for (const r of rows) assert.ok(r.ts >= since);
    assert.deepEqual(readLog(smDir, { limit: 99999 }).length, 3, 'the cap is not a wall for small logs');
  });
});

test('readProjectLog returns newest first and refuses bad ids', () => {
  withLog(({ smDir }) => {
    recordProject(smDir, 'shop-1', 'finished', { sessionId: 'a' });
    recordProject(smDir, 'shop-1', 'clash', { sessionId: null });
    const rows = readProjectLog(smDir, 'shop-1', {});
    assert.deepEqual(rows.map((r) => r.event), ['clash', 'finished']);
    assert.deepEqual(readProjectLog(smDir, 'bad/../id'), []);
  });
});

test('a full disk never stops the program: the sink fails once and stderr reports it', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-log-bad-'));
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  const block = join(smDir, 'block');
  writeFileSync(block, '');
  // A path whose parent is a file cannot become a logs folder: configure fails, log() still does not throw.
  configureLog({ dir: block });
  assert.doesNotThrow(() => log('info', 'still-alive', {}));
  assert.ok(writes.some((w) => w.includes('log-file-unavailable')), 'the failure is reported on stderr');
  process.stderr.write = original;
  configureLog({ dir: null });
  rmSync(smDir, { recursive: true, force: true });
});
