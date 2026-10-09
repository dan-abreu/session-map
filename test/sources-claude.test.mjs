import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, utimesSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claudeDir, listLiveSessions, listTranscripts, readTranscript,
  readHelperUsage, readWorkflows, readFullTranscript,
} from '../server/sources/claude.mjs';

const FIX = fileURLToPath(new URL('./fixtures/claude', import.meta.url));
const PROJ = join(FIX, 'projects', '-work-acme-shop');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const transcript = (id) => join(PROJ, `${id}.jsonl`);

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-test-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('claudeDir prefers CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
  const old = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = '/somewhere/else';
    assert.equal(claudeDir(), '/somewhere/else');
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.match(claudeDir().replaceAll('\\', '/'), /\/\.claude$/);
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = old;
  }
});

test('listLiveSessions reads valid session files, skips junk, marks dead pids', () => {
  const sessions = listLiveSessions(FIX, { isAlive: (pid) => pid !== 1003 });
  assert.equal(sessions.length, 3);
  const byPid = Object.fromEntries(sessions.map((s) => [s.pid, s]));
  assert.deepEqual(byPid[1001], {
    pid: 1001, sessionId: A, cwd: '/work/acme-shop', name: 'checkout', status: 'busy',
    entrypoint: 'claude-vscode', kind: 'interactive', updatedAt: 1760000300000,
    bridgeSessionId: null, alive: true,
  });
  assert.equal(byPid[1002].status, 'idle');
  assert.equal(byPid[1002].bridgeSessionId, 'session_fake01');
  assert.equal(byPid[1003].alive, false);
});

test('listLiveSessions returns an empty list when the directory does not exist', () => {
  assert.deepEqual(listLiveSessions(join(FIX, 'nope'), { isAlive: () => true }), []);
});

test('listLiveSessions default isAlive sees this process and rejects an impossible pid', () => {
  withTempDir((dir) => {
    cpSync(join(FIX, 'sessions', '1001.json'), join(dir, 'sessions', '1001.json'));
    writeFileSync(join(dir, 'sessions', 'me.json'), JSON.stringify({ pid: process.pid, sessionId: B, cwd: '/x', name: 'me', status: 'idle', updatedAt: 1, kind: 'interactive', entrypoint: 'cli', bridgeSessionId: null }));
    writeFileSync(join(dir, 'sessions', 'ghost.json'), JSON.stringify({ pid: 2147483000, sessionId: C, cwd: '/x', name: 'ghost', status: 'idle', updatedAt: 1, kind: 'interactive', entrypoint: 'cli', bridgeSessionId: null }));
    const byName = Object.fromEntries(listLiveSessions(dir).map((s) => [s.name, s.alive]));
    assert.equal(byName.me, true);
    assert.equal(byName.ghost, false);
  });
});

test('listTranscripts lists refs newest first and filters by mtime', () => {
  withTempDir((dir) => {
    cpSync(join(FIX, 'projects'), join(dir, 'projects'), { recursive: true });
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(join(dir, 'projects', '-work-acme-shop', `${C}.jsonl`), old, old);
    const all = listTranscripts(dir, { sinceMs: 0 });
    assert.equal(all.length, 3);
    assert.equal(all.at(-1).sessionId, C);
    assert.deepEqual(Object.keys(all[0]).sort(), ['mtimeMs', 'path', 'projectDir', 'sessionId', 'size']);
    assert.equal(all[0].projectDir, '-work-acme-shop');
    const recent = listTranscripts(dir, { sinceMs: Date.parse('2021-01-01') });
    assert.deepEqual(recent.map((r) => r.sessionId).sort(), [A, B].sort());
  });
});

test('readTranscript summarises the busy session with card and open question', () => {
  const s = readTranscript(transcript(A));
  assert.equal(s.sessionId, A);
  assert.equal(s.cwd, '/work/acme-shop');
  assert.equal(s.gitBranch, 'feature/checkout');
  assert.equal(s.title, 'Checkout page work');
  assert.equal(s.lastPrompt, 'Please add the checkout page');
  assert.deepEqual(s.userPrompts, ['Please add the checkout page']);
  assert.ok(s.lastAssistantText.startsWith('Status:'));
  assert.equal(s.pendingQuestion, true);
  assert.equal(s.startedAt, '2025-10-09T10:00:00.000Z');
  assert.ok(s.endedAt > s.startedAt);
  assert.deepEqual(JSON.parse(s.lastCardText), { title: 'Checkout', area: 'payments', doing: 'pay form', todo: ['tests'] });
});

test('readTranscript extracts edited files, commits, pushes and mentioned paths', () => {
  const s = readTranscript(transcript(A));
  assert.deepEqual(s.editedFiles, ['/work/acme-shop/src/checkout.ts', '/work/acme-shop/src/pay.ts']);
  assert.deepEqual(s.commits, [{ hash: 'abc1234', subject: 'feat: checkout page' }]);
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].branch, 'feature/checkout');
  assert.match(s.pushes[0].ts, /^2025-10-09T/);
  assert.ok(s.mentionedPaths.includes('/work/acme-shop/package.json'));
  assert.ok(s.mentionedPaths.includes('C:/work/acme-shop/readme.md'));
  assert.ok(s.mentionedPaths.includes('/work/acme-shop/src/checkout.ts'));
  assert.ok(!s.mentionedPaths.some((p) => p.includes('localhost')));
});

test('a commit without tool output falls back to the -m message; a rejected push is not recorded', () => {
  withTempDir((dir) => {
    const line = (o, i) => JSON.stringify({ sessionId: A, cwd: '/x', gitBranch: 'main', timestamp: `2025-10-09T10:00:0${i}.000Z`, ...o });
    const use = (id, command) => ({ type: 'assistant', message: { id: `m_${id}`, model: 'claude-fake-1', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], usage: { input_tokens: 1, output_tokens: 1 } } });
    const p = join(dir, `${A}.jsonl`);
    writeFileSync(p, [
      line(use('c1', 'git add -A && git commit -m "fix: only the message"'), 0),
      line(use('p1', 'git push origin main'), 1),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'p1', content: 'Everything up-to-date' }] } }, 2),
    ].join('\n') + '\n');
    const s = readTranscript(p);
    assert.deepEqual(s.commits, [{ hash: '', subject: 'fix: only the message' }]);
    assert.deepEqual(s.pushes, []);
  });
});

test('readTranscript counts usage once per message id', () => {
  const { usage } = readTranscript(transcript(A));
  assert.equal(usage.length, 11);
  assert.equal(usage.reduce((n, u) => n + u.input, 0), 201);
  const last = usage.find((u) => u.messageId === 'msg_10');
  assert.deepEqual(
    { model: last.model, input: last.input, output: last.output, cacheWrite5m: last.cacheWrite5m, cacheWrite1h: last.cacheWrite1h, cacheRead: last.cacheRead },
    { model: 'claude-fake-1', input: 20, output: 40, cacheWrite5m: 100, cacheWrite1h: 50, cacheRead: 500 },
  );
  assert.equal(typeof last.ts, 'string');
});

test('usage without the cache_creation breakdown counts cache_creation_input_tokens as 5m', () => {
  withTempDir((dir) => {
    const p = join(dir, `${A}.jsonl`);
    writeFileSync(p, JSON.stringify({ type: 'assistant', sessionId: A, timestamp: '2025-10-09T10:00:00.000Z', message: { id: 'm1', model: 'claude-fake-1', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } } }) + '\n');
    const [row] = readTranscript(p).usage;
    assert.deepEqual({ input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite5m: row.cacheWrite5m, cacheWrite1h: row.cacheWrite1h }, { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 0 });
  });
});

test('title falls back to the first human prompt cut at 80; an answered question is not pending', () => {
  const s = readTranscript(transcript(B));
  assert.equal(s.title.length, 80);
  assert.ok(s.userPrompts[0].startsWith(s.title));
  assert.equal(s.pendingQuestion, false);
  assert.equal(s.lastCardText, null);
  assert.ok(s.lastAssistantText.trimEnd().endsWith('?**'));
  assert.deepEqual(s.commits, []);
  assert.deepEqual(s.pushes, []);
});

test('a truncated last line is ignored and the rest is read', () => {
  const s = readTranscript(transcript(C));
  assert.equal(s.lastAssistantText, 'Fixed the typo.');
  assert.equal(s.usage.length, 1);
});

test('a missing transcript yields null instead of throwing', () => {
  assert.equal(readTranscript(join(PROJ, 'nope.jsonl')), null);
});

test('tail read keeps full usage, finds the card in the whole file and the real start', () => {
  const s = readTranscript(transcript(A), { tailBytes: 800 });
  assert.equal(s.usage.length, 11);
  assert.equal(s.startedAt, '2025-10-09T10:00:00.000Z');
  assert.equal(JSON.parse(s.lastCardText).title, 'Checkout');
  assert.equal(s.pendingQuestion, true);
});

test('readHelperUsage sums helpers and workflow agents without double counting', () => {
  const rows = readHelperUsage(join(PROJ, A));
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((n, u) => n + u.input, 0), 42);
  assert.deepEqual(readHelperUsage(join(PROJ, B)), []);
});

test('readWorkflows reports progress, name and last label', () => {
  const [one, two] = readWorkflows(join(PROJ, A)).sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(
    { id: one.id, name: one.name, started: one.started, done: one.done, lastLabel: one.lastLabel },
    { id: 'wf_one', name: 'checkout-build', started: 2, done: 1, lastLabel: 'Review' },
  );
  assert.equal(two.name, 'wf_two');
  assert.equal(two.done, 1);
  assert.match(one.updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(readWorkflows(join(PROJ, B)), []);
});

test('readFullTranscript returns readable messages with tools in one line', () => {
  const msgs = readFullTranscript(transcript(A));
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].text, 'Please add the checkout page');
  assert.equal(msgs[0].ts, '2025-10-09T10:00:00.000Z');
  assert.equal(msgs[1].role, 'assistant');
  assert.match(msgs[1].text, /Starting the checkout work\./);
  assert.match(msgs[1].text, /\[Edit \/work\/acme-shop\/src\/checkout\.ts\]/);
  assert.ok(!msgs.some((m) => m.text.includes('injected block')));
});
