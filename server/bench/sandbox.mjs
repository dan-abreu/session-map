// Runs model-written code for the bench's "code" kind (or12). The code is untrusted: it runs in a fresh folder under
// the system temp, under Node's permission model (reads and writes only inside that folder; no child processes,
// workers, addons, WASI or inspector), with networking and self-grading switched off by a preload, a stripped environment (no keys,
// no CLAUDE* variables), a memory ceiling and a hard time limit. The folder is deleted afterwards.
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 20_000;
const OUTPUT_MAX = 200_000;
const MEMORY_MB = 256;

// The permission model of Node 24 has no switch for the network, so the preload cuts every way out before the
// model's module loads: sockets (which http, https, http2, tls and fetch all end in), datagrams, every DNS call and
// resolver (a DNS query alone can carry data out), fetch and WebSocket. The named ESM exports are synced after, so
// `import { resolveTxt } from 'node:dns'` gets the cut one too.
// The same preload keeps the code under test from grading itself: the assert and test modules are frozen (a module
// that rewrites assert.equal fails to load), and it cannot end the process early or rewrite what the test runner
// prints. One layer of defense against a careless or cheating answer, not a proof against a determined attacker.
const NET_GUARD = `import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns');
const no = () => { const e = new Error('network is off in the bench sandbox'); e.code = 'ERR_ACCESS_DENIED'; throw e; };
const noAsync = async () => no();
const NoClass = class { constructor() { no(); } };
net.Socket.prototype.connect = no;
net.Server.prototype.listen = no;
net.connect = no;
net.createConnection = no;
dgram.Socket.prototype.send = no;
dgram.Socket.prototype.bind = no;
for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
  for (let proto = Resolver.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const k of Object.getOwnPropertyNames(proto)) if (k !== 'constructor' && typeof proto[k] === 'function') proto[k] = no;
  }
}
for (const [mod, stub] of [[dns, no], [dns.promises, noAsync]]) {
  for (const k of Object.keys(mod)) if (typeof mod[k] === 'function') mod[k] = stub;
  mod.Resolver = NoClass;
}
globalThis.fetch = noAsync;
for (const k of ['WebSocket', 'EventSource']) if (k in globalThis) globalThis[k] = NoClass;
syncBuiltinESMExports();
for (const m of ['node:assert', 'node:assert/strict', 'node:test']) Object.freeze(require(m));
const noExit = () => { throw new Error('ending the process is off in the bench sandbox'); };
for (const k of ['exit', 'reallyExit', 'abort']) Object.defineProperty(process, k, { value: noExit, writable: false, configurable: false });
for (const stream of [process.stdout, process.stderr]) {
  for (const k of ['write', '_write', '_writev']) {
    if (typeof stream[k] === 'function') Object.defineProperty(stream, k, { value: stream[k], writable: false, configurable: false });
  }
}
`;

// Windows needs SystemRoot for its own libraries; nothing else of the bench's environment goes in.
export function sandboxEnv(env = process.env) {
  return env.SystemRoot ? { SystemRoot: env.SystemRoot } : {};
}

// The test runner prints one summary at the end. The LAST one is read, and a run that printed more than one (the code
// under test printing a fake summary of its own) is not trusted.
const tapCounts = (out, name) => [...out.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))].map((m) => Number(m[1]));
const tapCount = (out, name) => tapCounts(out, name).at(-1) ?? 0;

function runNode(args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ error: err.code ?? 'spawn', out: '' });
      return;
    }
    let out = '';
    let timedOut = false;
    const keep = (chunk) => { if (out.length < OUTPUT_MAX) out += chunk; };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    child.on('error', (err) => { clearTimeout(timer); resolve({ error: err.code ?? 'spawn', out, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

// code: the model's module, saved as solution.mjs. tests: the set's node:test file, which imports './solution.mjs'.
// expectedTests: how many tests the file holds (learned by running the set's reference); a run that reports another
// number is not trusted. Errors: 'tests-failed', 'tests-timeout' (the code ran too long: the answer's fault),
// 'tests-miscounted' (a second summary, or not the tests the file holds), 'sandbox-spawn-failed' (this machine's fault).
export async function runCodeItem({ code, tests, timeoutMs = TIMEOUT_MS, expectedTests = null } = {}) {
  const started = Date.now();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sm-bench-')));
  try {
    writeFileSync(join(dir, 'solution.mjs'), String(code ?? ''));
    writeFileSync(join(dir, 'solution.test.mjs'), String(tests ?? ''));
    writeFileSync(join(dir, 'guard.mjs'), NET_GUARD);
    const args = [
      '--permission', `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`,
      `--max-old-space-size=${MEMORY_MB}`,
      '--import', pathToFileURL(join(dir, 'guard.mjs')).href,
      // In-process: the default runner starts a child per file, which the permission model rightly refuses.
      '--test', '--test-isolation=none', '--test-reporter=tap',
      'solution.test.mjs',
    ];
    const res = await runNode(args, { cwd: dir, env: sandboxEnv(), timeoutMs });
    const passed = tapCount(res.out, 'pass');
    const failed = tapCount(res.out, 'fail') + tapCount(res.out, 'cancelled');
    const total = tapCount(res.out, 'tests');
    const summaries = tapCounts(res.out, 'tests').length;
    const miscounted = summaries > 1 || (expectedTests !== null && summaries === 1 && total !== expectedTests);
    const green = !res.error && !res.timedOut && res.code === 0 && total > 0 && failed === 0 && passed === total;
    const ok = green && !miscounted;
    const error = res.error ? 'sandbox-spawn-failed' : res.timedOut ? 'tests-timeout' : ok ? null : miscounted ? 'tests-miscounted' : 'tests-failed';
    return { ok, passed, failed, total, timedOut: Boolean(res.timedOut), error, ms: Date.now() - started, dir, tail: res.out.slice(-1500) };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
