import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, existsSync, readFileSync, writeFileSync, utimesSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { archiveTranscript, archiveAll, readIndex, searchIndex, readArchived, deleteArchived } from '../server/archive.mjs';
import { listTranscripts } from '../server/sources/claude.mjs';

const S1 = '11111111-1111-4111-8111-111111111111';
const FIXTURE = new URL('./fixtures/claude/', import.meta.url);

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sm-archive-'));
  const dir = join(root, 'claude');
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir, smDir: join(root, 'sm') };
}

test('archives a transcript as gzip and writes an index line', () => {
  const { dir, smDir } = setup();
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  assert.equal(archiveTranscript(ref, smDir), 'archived');
  const gz = join(smDir, 'archive', ref.projectDir, `${S1}.jsonl.gz`);
  assert.equal(gunzipSync(readFileSync(gz)).toString(), readFileSync(ref.path, 'utf8'));
  const [entry] = readIndex(smDir);
  assert.equal(entry.sessionId, S1);
  assert.equal(entry.title, 'Checkout page work');
  assert.equal(entry.card.area, 'payments');
  assert.deepEqual(entry.editedFiles, ['/work/acme-shop/src/checkout.ts', '/work/acme-shop/src/pay.ts']);
  assert.equal(entry.commits[0].subject, 'feat: checkout page');
  assert.ok(entry.costUSD > 0);
});

test('does not copy again when the transcript did not change', () => {
  const { dir, smDir } = setup();
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  archiveTranscript(ref, smDir);
  const gz = join(smDir, 'archive', ref.projectDir, `${S1}.jsonl.gz`);
  const before = statSync(gz).mtimeMs;
  assert.equal(archiveTranscript(ref, smDir), 'unchanged');
  assert.equal(statSync(gz).mtimeMs, before);
});

test('re-archives a changed transcript and rewrites its index line instead of adding one', () => {
  const { dir, smDir } = setup();
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  archiveTranscript(ref, smDir);
  const later = new Date(Date.now() + 60_000);
  utimesSync(ref.path, later, later);
  const changed = listTranscripts(dir).find((r) => r.sessionId === S1);
  assert.equal(archiveTranscript(changed, smDir), 'archived');
  assert.equal(readIndex(smDir).filter((e) => e.sessionId === S1).length, 1);
});

test('archiveAll copies every transcript and survives a missing file', () => {
  const { dir, smDir } = setup();
  const count = archiveAll(dir, smDir);
  assert.equal(count, 3);
  assert.equal(readIndex(smDir).length, 3);
  assert.equal(archiveAll(dir, smDir), 0);
  assert.equal(archiveTranscript({ sessionId: S1, projectDir: 'x', path: join(dir, 'nope.jsonl'), mtimeMs: 1, size: 0 }, smDir), 'missing');
});

test('searchIndex matches words in title, prompts and card, and filters by project', () => {
  const { dir, smDir } = setup();
  archiveAll(dir, smDir);
  const entries = readIndex(smDir);
  assert.equal(searchIndex(entries, 'checkout')[0].sessionId, S1);
  assert.equal(searchIndex(entries, 'PAYMENTS')[0].sessionId, S1);
  assert.equal(searchIndex(entries, 'checkout page').length >= 1, true);
  assert.deepEqual(searchIndex(entries, 'zzzz-no-match'), []);
  assert.deepEqual(searchIndex(entries, 'checkout', { project: 'other-project' }), []);
  assert.ok(searchIndex(entries, 'checkout', { project: 'acme-shop' }).length >= 1);
  assert.ok(searchIndex(entries, '', { limit: 2 }).length <= 2);
  assert.ok(searchIndex(entries, 'a', { limit: 1 }).length <= 1);
});

test('searchIndex keeps the conversations that were active inside the period (mm06)', () => {
  const entry = (id, startedAt, endedAt) => ({ sessionId: id, title: id, projectDir: 'p', cwd: '/p', userPrompts: [], card: null, lastAssistantText: '', commits: [], startedAt, endedAt });
  const entries = [entry('old', '2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z'), entry('span', '2026-10-01T10:00:00Z', '2026-10-09T10:00:00Z'), entry('new', '2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z')];
  const ids = (opts) => searchIndex(entries, '', { limit: 10, ...opts }).map((e) => e.sessionId).sort();
  assert.deepEqual(ids({}), ['new', 'old', 'span']);
  assert.deepEqual(ids({ from: Date.parse('2026-10-03T00:00:00Z'), to: Date.parse('2026-10-05T00:00:00Z') }), ['span'], 'running through the period counts');
  assert.deepEqual(ids({ from: Date.parse('2026-10-09T00:00:00Z') }), ['new', 'span']);
  assert.deepEqual(ids({ to: Date.parse('2026-09-30T00:00:00Z') }), ['old']);
});

test('readArchived returns user and assistant messages, tools on one line', () => {
  const { dir, smDir } = setup();
  archiveAll(dir, smDir);
  const messages = readArchived(smDir, S1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].text, 'Please add the checkout page');
  assert.ok(messages.some((m) => m.role === 'assistant' && /\[Edit /.test(m.text)));
  assert.deepEqual(readArchived(smDir, '99999999-9999-4999-8999-999999999999'), []);
  assert.deepEqual(readArchived(smDir, '../../etc/passwd'), []);
});

test('deleteArchived removes the copy and the index line, and nothing else', () => {
  const { dir, smDir } = setup();
  archiveAll(dir, smDir);
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  assert.equal(deleteArchived(smDir, S1), true);
  assert.equal(existsSync(join(smDir, 'archive', ref.projectDir, `${S1}.jsonl.gz`)), false);
  assert.equal(readIndex(smDir).length, 2);
  assert.equal(existsSync(ref.path), true);
  assert.equal(deleteArchived(smDir, S1), false);
  assert.equal(deleteArchived(smDir, '../x'), false);
});

test('a deleted conversation stays deleted: the sweep and the hook do not copy it again', () => {
  const { dir, smDir, root } = setup();
  archiveAll(dir, smDir);
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  const gz = join(smDir, 'archive', ref.projectDir, `${S1}.jsonl.gz`);
  assert.equal(deleteArchived(smDir, S1), true);
  assert.equal(archiveAll(dir, smDir), 0);
  assert.equal(archiveTranscript({ ...ref, mtimeMs: ref.mtimeMs + 1 }, smDir), 'deleted');
  assert.equal(readIndex(smDir).some((e) => e.sessionId === S1), false);
  assert.equal(existsSync(gz), false);
  assert.equal(readIndex(smDir).length, 2, 'the other conversations stay archived');

  const hookSm = join(dir, 'session-map');
  archiveAll(dir, hookSm);
  deleteArchived(hookSm, S1);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  execFileSync(process.execPath, [hook], { input: JSON.stringify({ session_id: S1, transcript_path: ref.path }), env, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(readIndex(hookSm).some((e) => e.sessionId === S1), false);
  assert.match(readFileSync(join(hookSm, 'actions.log'), 'utf8'), /"result":"deleted"/);
});

test('a half-written index line is ignored', () => {
  const { dir, smDir } = setup();
  archiveAll(dir, smDir);
  const idx = join(smDir, 'archive', 'index.jsonl');
  writeFileSync(idx, `${readFileSync(idx, 'utf8')}{"sessionId":"cut`);
  assert.equal(readIndex(smDir).length, 3);
});

const hook = fileURLToPath(new URL('../scripts/archive-hook.mjs', import.meta.url));
const search = fileURLToPath(new URL('../scripts/history-search.mjs', import.meta.url));

test('archive hook archives from stdin and exits 0 even on garbage', () => {
  const { dir, smDir, root } = setup();
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const run = (input) => execFileSync(process.execPath, [hook], { input, env, stdio: ['pipe', 'pipe', 'pipe'] });
  run(JSON.stringify({ session_id: S1, transcript_path: ref.path }));
  assert.equal(readIndex(join(dir, 'session-map')).length, 1);
  run('not json');
  run(JSON.stringify({ session_id: S1, transcript_path: join(root, 'nope.jsonl') }));
  assert.match(readFileSync(join(dir, 'session-map', 'actions.log'), 'utf8'), /archive/);
});

test('history-search prints at most 5 results of at most 4 lines', () => {
  const { dir, root } = setup();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  archiveAll(dir, join(dir, 'session-map'));
  const out = execFileSync(process.execPath, [search, 'checkout'], { env }).toString().trim();
  const blocks = out.split('\n\n');
  assert.ok(blocks.length >= 1 && blocks.length <= 5);
  for (const block of blocks) assert.ok(block.split('\n').length <= 4);
  assert.match(out, /Checkout page work/);
  assert.match(execFileSync(process.execPath, [search, 'zzzz-none'], { env }).toString(), /No matches/);
  rmSync(root, { recursive: true, force: true });
});
