import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const COOKIE = 'sm_token';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function loadToken(smDir) {
  const file = join(smDir, 'token');
  try {
    const stored = readFileSync(file, 'utf8').trim();
    if (TOKEN_RE.test(stored)) return stored;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(smDir, { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  // mode only applies on creation; a file left by an older run gets narrowed too (no effect on Windows).
  try { chmodSync(file, 0o600); } catch { /* filesystem without permissions */ }
  return token;
}

export function sameToken(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieToken(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export const tokenCookie = (token) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;

// A browser page on another site can point a name at 127.0.0.1 (DNS rebinding): only a loopback Host counts as local.
export const isLocal = (address, host) => LOOPBACK_ADDRESSES.has(address) && LOOPBACK_HOST_RE.test(String(host ?? ''));

function sameOrigin(req) {
  try {
    return Boolean(req.headers.host) && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// → {status: 200} to go on, {status: 302, cookie, location} after ?k=, or {status: 401|403}.
export function authorize(req, url, { token, address }) {
  const fromCookie = sameToken(cookieToken(req), token);
  if (WRITE_METHODS.has(req.method)) {
    if (req.headers['x-session-map'] !== '1' || !sameOrigin(req)) return { status: 403 };
    return fromCookie ? { status: 200 } : { status: 401 };
  }
  const k = url.searchParams.get('k');
  if (k !== null) {
    if (!sameToken(k, token)) return { status: 401 };
    url.searchParams.delete('k');
    return { status: 302, cookie: tokenCookie(token), location: `${url.pathname}${url.search}` };
  }
  // Local reads are open, but the cookie only comes from ?k=: any local process could otherwise fetch the token with
  // one GET, including another OS user who cannot read the 0600 token file.
  return fromCookie || isLocal(address, req.headers.host) ? { status: 200 } : { status: 401 };
}
