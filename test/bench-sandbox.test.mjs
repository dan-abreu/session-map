// The bench's sandbox (or12): model-written code runs under Node's permission model in a throwaway folder.
// These tests prove it is actually shut in, not just that good code passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodeItem, sandboxEnv } from '../server/bench/sandbox.mjs';

const TESTS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './solution.mjs';
test('adds', () => { assert.equal(add(2, 3), 5); });
test('adds negatives', () => { assert.equal(add(-2, -3), -5); });
`;

test('a correct module passes every test, and the temp folder is gone after', async () => {
  const r = await runCodeItem({ code: 'export function add(a, b) { return a + b; }', tests: TESTS });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.passed, r.failed, r.total], [2, 0, 2]);
  assert.equal(existsSync(r.dir), false);
});

test('a wrong module fails, with the count of what passed', async () => {
  const r = await runCodeItem({ code: 'export function add(a, b) { return a > 0 ? a + b : 0; }', tests: TESTS });
  assert.equal(r.ok, false);
  assert.deepEqual([r.passed, r.failed, r.total], [1, 1, 2]);
});

test('a module that does not even load fails cleanly', async () => {
  const r = await runCodeItem({ code: 'export function add(a, b) { return a + ; }', tests: TESTS });
  assert.equal(r.ok, false);
  assert.equal(r.passed, 0);
});

test('reading a file outside the temp folder is refused', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'sm-bench-outside-'));
  const secret = join(outside, 'secret.txt');
  writeFileSync(secret, 'the owner secret');
  try {
    const code = `import { readFileSync } from 'node:fs';
export function attempt() { try { return readFileSync(${JSON.stringify(secret)}, 'utf8'); } catch (e) { return e.code; } }`;
    const tests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attempt } from './solution.mjs';
test('blocked', () => { assert.equal(attempt(), 'ERR_ACCESS_DENIED'); });
`;
    const r = await runCodeItem({ code, tests });
    assert.equal(r.ok, true, `the read was not refused: ${JSON.stringify(r)}`);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('starting another program is refused', async () => {
  const code = `import { execFileSync } from 'node:child_process';
export function attempt() { try { execFileSync(process.execPath, ['-v']); return 'ran'; } catch (e) { return e.code; } }`;
  const tests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attempt } from './solution.mjs';
test('blocked', () => { assert.equal(attempt(), 'ERR_ACCESS_DENIED'); });
`;
  const r = await runCodeItem({ code, tests });
  assert.equal(r.ok, true, `the child process was not refused: ${JSON.stringify(r)}`);
});

test('a network call is refused', async () => {
  let reached = false;
  const server = createServer((req, res) => { reached = true; res.end('hi'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const code = `export async function attempt() { try { await fetch('http://127.0.0.1:${port}/'); return 'reached'; } catch (e) { return 'blocked'; } }`;
    const tests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attempt } from './solution.mjs';
test('blocked', async () => { assert.equal(await attempt(), 'blocked'); });
`;
    const r = await runCodeItem({ code, tests });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(reached, false);
  } finally {
    server.close();
  }
});

test('a raw http request is refused too, not only fetch', async () => {
  let reached = false;
  const server = createServer((req, res) => { reached = true; res.end('hi'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const code = `import http from 'node:http';
export function attempt() {
  return new Promise((resolve) => {
    try {
      const req = http.get('http://127.0.0.1:${port}/', () => resolve('reached'));
      req.on('error', () => resolve('blocked'));
    } catch { resolve('blocked'); }
  });
}`;
    const tests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attempt } from './solution.mjs';
test('blocked', async () => { assert.equal(await attempt(), 'blocked'); });
`;
    const r = await runCodeItem({ code, tests });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(reached, false);
  } finally {
    server.close();
  }
});

test('code that runs forever is stopped at the time limit', async () => {
  const started = Date.now();
  const r = await runCodeItem({ code: 'export function add() { for (;;) {} }', tests: TESTS, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 10_000, 'it was not stopped in time');
  assert.equal(existsSync(r.dir), false);
});

test('the sandbox environment carries no keys and no Claude variables', () => {
  const env = sandboxEnv({ OPENAI_API_KEY: 'sk-x', CLAUDE_CODE_SSE_PORT: '1', ANTHROPIC_API_KEY: 'a', HOME: '/h', SystemRoot: 'C:\\Windows', PATH: '/bin' });
  assert.deepEqual(Object.keys(env).sort(), ['SystemRoot']);
});

test('the code cannot read the environment of the bench', async () => {
  process.env.SM_BENCH_PROBE = 'leak';
  try {
    const code = 'export const probe = () => String(process.env.SM_BENCH_PROBE);';
    const tests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from './solution.mjs';
test('no leak', () => { assert.equal(probe(), 'undefined'); });
`;
    const r = await runCodeItem({ code, tests });
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally {
    delete process.env.SM_BENCH_PROBE;
  }
});
