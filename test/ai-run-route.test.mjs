import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

// POST /api/ai/run and /api/ai/merge (id151, or63): the specialist role on another AI's official CLI, in an isolated
// copy; the same entry gates hold first, the merge waits for the review and green tests.

const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };
const TASK = 'fix the header, run the tests';

async function withServer(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-run-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-run-sm-'));
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state,
    helpers: { backend },
    runAi: { exec: opts.exec, bin: opts.bin, dshOf: opts.dshOf },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  if (opts.strict || opts.config) writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ...(opts.strict ? { guard: { strict: true } } : {}), ...(opts.config ?? {}) }));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (path, body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'x-session-map-token': token, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  try {
    await fn({ call });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const bin = (n) => n === 'codex' || n === 'claude';
const greenExec = async (cmd, args) => {
  if (cmd === 'node' && (args ?? []).includes('failing')) throw new Error('tests red');
};

test('strict, the same entry gates hold: a vague brief is refused before anything runs; open (id154), it runs', async () => {
  await withServer({ exec: greenExec, bin, strict: true }, async ({ call }) => {
    const r = await call('/api/ai/run', { kind: 'code', provider: 'openai', task: 'fix the header.', sensitivity: 'public', cwd: 'C:/repo' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'gate');
    assert.match(r.json.reason, /brief must name the proof/);
  });
  await withServer({ exec: greenExec, bin }, async ({ call }) => {
    const r = await call('/api/ai/run', { kind: 'code', provider: 'openai', task: 'fix the header.', sensitivity: 'public', cwd: 'C:/repo' });
    assert.notEqual(r.json.error, 'gate');
  });
});

test('a provider without its CLI is refused, and DeepSeek takes private work (only a missing key stops it)', async () => {
  await withServer({ exec: greenExec, bin }, async ({ call }) => {
    const noCli = await call('/api/ai/run', { kind: 'code', provider: 'gemini', task: TASK, sensitivity: 'public', cwd: 'C:/repo' });
    assert.equal(noCli.status, 400);
    assert.equal(noCli.json.error, 'not-installed');
    const privateDs = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, sensitivity: 'internal', cwd: 'C:/repo' });
    assert.equal(privateDs.status, 400);
    assert.equal(privateDs.json.error, 'no-key', 'not refused for the data class');
  });
});

test('DeepSeek runs on the DeepSeek Harness with no key, and the run brings its answer back (id156)', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...(args ?? [])]);
    return { stdout: cmd === 'harness.exe' ? 'feito.' : '' };
  };
  const dshOf = () => ({ command: 'harness.exe', args: ['--expose-internals', 'cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } });
  await withServer({ exec, bin: (n) => n === 'dsh', dshOf }, async ({ call }) => {
    const r = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, sensitivity: 'internal', cwd: 'C:/repo' });
    assert.equal(r.status, 200, 'no key asked: the Harness signs in by itself');
    assert.equal(r.json.committed, true);
    assert.equal(r.json.answer, 'feito.');
    const ran = calls.find((c) => c[0] === 'harness.exe');
    assert.deepEqual(ran.slice(1, 5), ['--expose-internals', 'cli.js', '--profile', 'headless']);
    assert.match(ran[5], /^session-map-role: coder /);
    assert.ok(calls.some((c) => c[0] === 'git' && c[1] === 'add'), 'what it wrote is committed in the copy');
  });
});

test('the model and level the owner chose for this kind of work ride on the DeepSeek run, and a row on another AI lends nothing (id156)', async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...(args ?? [])]); return { stdout: '' }; };
  const dshOf = () => ({ command: 'harness.exe', args: ['--expose-internals', 'cli.js'], env: {} });
  const config = { ai: { others: { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } } } } };
  await withServer({ exec, bin: (n) => n === 'dsh', dshOf, config }, async ({ call }) => {
    const r = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, sensitivity: 'internal', cwd: 'C:/repo' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.applied, { model: 'deepseek-v4-pro', effort: 'high' }, 'the run says what it ran on');
    const ran = calls.find((c) => c[0] === 'harness.exe');
    const at = ran.indexOf('--patch');
    assert.ok(at > 0 && ran[at + 1].endsWith('.yml'), 'the overlay rides on the run');
    assert.match(ran.at(-1), /^session-map-role: coder /, 'the brief stays last');
  });
  calls.length = 0;
  const other = { ai: { others: { functions: { code: { provider: 'gemini', model: 'gemini-3.8-flash' } } } } };
  await withServer({ exec, bin: (n) => n === 'dsh', dshOf, config: other }, async ({ call }) => {
    const r = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, sensitivity: 'internal', cwd: 'C:/repo' });
    assert.equal(r.status, 200);
    assert.equal(r.json.applied, null, 'the row names Gemini: its model and level are never lent to DeepSeek');
    assert.ok(!calls.find((c) => c[0] === 'harness.exe').includes('--patch'));
  });
});

test('a run returns its branch; the merge waits for the review and refuses red tests', async () => {
  await withServer({ exec: greenExec, bin }, async ({ call }) => {
    const base = { kind: 'code', provider: 'openai', task: TASK, sensitivity: 'public', cwd: 'C:/repo' };
    const run = await call('/api/ai/run', { ...base, tests: { command: 'node', args: ['--test'] } });
    assert.equal(run.status, 200);
    assert.match(run.json.branch, /^session-map\/agent-coder-/);
    assert.equal(run.json.tests.passed, true);
    const noReview = await call('/api/ai/merge', { runId: run.json.runId, accepted: false, why: 'not reviewed yet' });
    assert.equal(noReview.status, 400);
    assert.equal(noReview.json.error, 'not-accepted');
    const merged = await call('/api/ai/merge', { runId: run.json.runId, accepted: true, why: 'reviewed by another family' });
    assert.equal(merged.status, 200);
    assert.match(merged.json.merged, /^session-map\/agent-coder-/);
    const gone = await call('/api/ai/merge', { runId: run.json.runId, accepted: true, why: 'again' });
    assert.equal(gone.status, 404);
  });
});

test('a run whose tests are red never merges', async () => {
  await withServer({ exec: greenExec, bin }, async ({ call }) => {
    const run = await call('/api/ai/run', { kind: 'code', provider: 'openai', task: TASK, sensitivity: 'public', cwd: 'C:/repo', tests: { command: 'node', args: ['--test', 'failing'] } });
    assert.equal(run.status, 200);
    assert.equal(run.json.tests.passed, false);
    const merged = await call('/api/ai/merge', { runId: run.json.runId, accepted: true, why: 'reviewed' });
    assert.equal(merged.status, 400);
    assert.equal(merged.json.error, 'tests-failed');
  });
});
