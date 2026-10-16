import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// How a program of session-map that runs on its own (the arsenal tool, the book's tidy) talks to the running server
// (id156): it finds the server, makes the server prove it knows the token BEFORE the token or a prompt leaves, and only
// then calls. When session-map is not running, another program on the free port gets nothing. Shared so there is one
// proof, not two copies of it.

const TOKEN_RE = /^[0-9a-f]{64}$/;
const PROOF_TIMEOUT_MS = 5_000;
const DEFAULT_BASE = 'http://127.0.0.1:4001';

// The token the server keeps in its folder, or null.
export function readTokenFile(smDir) {
  try {
    const token = readFileSync(join(smDir, 'token'), 'utf8').trim();
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

// Where the server is: SM_URL when set, else the address it wrote when it started, else the usual one.
export function serverBase(smDir, env = process.env) {
  const given = String(env.SM_URL ?? '').trim();
  if (given) return given.replace(/\/+$/, '');
  try {
    const written = readFileSync(join(smDir, 'page-origin.txt'), 'utf8').trim();
    if (/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(written)) return written;
  } catch { /* the usual address */ }
  return DEFAULT_BASE;
}

// -> {ok: true}, {impostor: true} or {down: true, timeout?}. The answer is HMAC-SHA256(token, 'session-map-proof:' +
// nonce): only the real server can make it, and a fresh nonce each time makes an old answer useless.
export async function proveServer(base, token) {
  const nonce = randomBytes(32).toString('hex');
  try {
    const res = await fetch(`${base}/api/ai/hello?nonce=${nonce}`, { redirect: 'error', signal: AbortSignal.timeout(PROOF_TIMEOUT_MS) });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON: no proof */ }
    const want = createHmac('sha256', token).update(`session-map-proof:${nonce}`).digest();
    const got = res.status === 200 && typeof json?.proof === 'string' && /^[0-9a-f]{64}$/.test(json.proof) ? Buffer.from(json.proof, 'hex') : null;
    return got && timingSafeEqual(got, want) ? { ok: true } : { impostor: true };
  } catch (err) {
    return { down: true, timeout: err?.name === 'TimeoutError' };
  }
}

// -> {status, json}, {impostor: true} or {down: true}
export async function callServer({ base, method, path, body, timeoutMs, token }) {
  const proof = await proveServer(base, token);
  if (!proof.ok) return proof;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      redirect: 'error',
      headers: { 'x-session-map-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON: the status speaks */ }
    return { status: res.status, json };
  } catch (err) {
    return { down: true, timeout: err?.name === 'TimeoutError' };
  }
}
