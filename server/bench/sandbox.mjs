// Runs model-written code for the bench's "code" kind (or12). The code is untrusted: it runs in a fresh folder under
// the system temp, under Node's permission model (reads and writes only inside that folder; no child processes,
// workers, addons, WASI or inspector), with networking switched off by a preload, a stripped environment (no keys,
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
// model's module loads: sockets (which http, https, tls and fetch all end in), datagrams, name lookups and fetch.
const NET_GUARD = `import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns';
const no = () => { const e = new Error('network is off in the bench sandbox'); e.code = 'ERR_ACCESS_DENIED'; throw e; };
const noAsync = async () => no();
net.Socket.prototype.connect = no;
net.Server.prototype.listen = no;
net.connect = no;
net.createConnection = no;
dgram.Socket.prototype.send = no;
dgram.Socket.prototype.bind = no;
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) { dns[k] = no; dns.promises[k] = noAsync; }
globalThis.fetch = noAsync;
for (const k of ['WebSocket', 'EventSource']) if (k in globalThis) globalThis[k] = class { constructor() { no(); } };
`;

// Windows needs SystemRoot for its own libraries; nothing else of the bench's environment goes in.
export function sandboxEnv(env = process.env) {
  return env.SystemRoot ? { SystemRoot: env.SystemRoot } : {};
}

const tapCount = (out, name) => Number(new RegExp(`^# ${name} (\\d+)`, 'm').exec(out)?.[1] ?? 0);

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
export async function runCodeItem({ code, tests, timeoutMs = TIMEOUT_MS } = {}) {
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
    const ok = !res.error && !res.timedOut && res.code === 0 && total > 0 && failed === 0 && passed === total;
    const error = res.error ? 'spawn-failed' : res.timedOut ? 'timeout' : ok ? null : 'tests-failed';
    return { ok, passed, failed, total, timedOut: Boolean(res.timedOut), error, ms: Date.now() - started, dir, tail: res.out.slice(-1500) };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
