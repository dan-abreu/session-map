import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const COOKIE = 'sm_token';
const LOOK_COOKIE = 'sm_look';
const LOOK_FILE = 'look-token';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function readKey(file) {
  try {
    const stored = readFileSync(file, 'utf8').trim();
    if (TOKEN_RE.test(stored)) return stored;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return null;
}

export function loadToken(smDir) {
  const file = join(smDir, 'token');
  return readKey(file) ?? writeKey(smDir, file);
}

// The "look only" key (sv04): a second key, kept like the owner's, that shows the live map and nothing else. Off (null)
// until the owner makes one; a new one replaces the old, and dropping it locks every page that holds it out at once.
export const loadLookKey = (smDir) => readKey(join(smDir, LOOK_FILE));
export const newLookKey = (smDir) => writeKey(smDir, join(smDir, LOOK_FILE));
export const dropLookKey = (smDir) => rmSync(join(smDir, LOOK_FILE), { force: true });

function writeKey(smDir, file) {
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

// A browser sends a host's cookies to all its ports, so the name carries this server's port: the demo or a copy on another
// port, opened with its own ?k=, no longer replaces this one's key. The plain name, from before, is read only when the
// page has no cookie of this port yet.
const portOf = (req) => /:(\d{1,5})$/.exec(String(req.headers.host ?? ''))?.[1] ?? null;
const cookieName = (req, cookie) => (portOf(req) ? `${cookie}_${portOf(req)}` : cookie);

function readCookie(req, wanted) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === wanted) return rest.join('=');
  }
  return null;
}

export const cookieToken = (req, cookie = COOKIE) => readCookie(req, cookieName(req, cookie)) ?? readCookie(req, cookie);

const tokenCookie = (req, token, cookie = COOKIE) => `${cookieName(req, cookie)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;

// What the look-only key may ask for, by name: the page's own files, the state and the Flow's model, GETs only. Anything
// else (writes, chats, files, changes, settings, the other AIs, the catalog, a route added later) is refused.
// The router decodes every piece of the path (%61pi is api to it), so the list judges the path the same way: a page file
// has no % at all and no "api" first, and the reads are exact shapes where only the project and part ids may be encoded.
const LOOK_READS = [['api', 'state'], ['api', 'arch', null, 'model'], ['api', 'arch', null, 'model', 'part', null]];
export function lookAllows(method, path) {
  if (method !== 'GET') return false;
  const raw = path.split('/').slice(1);
  let parts;
  try {
    parts = raw.map((p) => decodeURIComponent(p));
  } catch {
    return false;
  }
  if (!path.includes('%') && parts[0].toLowerCase() !== 'api') return true;
  return LOOK_READS.some((shape) => shape.length === raw.length
    && shape.every((word, i) => (word === null ? parts[i] !== '' : raw[i] === word)));
}

// A browser page on another site can point a name at 127.0.0.1 (DNS rebinding): only a loopback Host counts as local.
export const isLocal = (address, host) => LOOPBACK_ADDRESSES.has(address) && LOOPBACK_HOST_RE.test(String(host ?? ''));

function sameOrigin(req) {
  try {
    return Boolean(req.headers.host) && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// → {status: 200} to go on ({status: 200, look: true} for the look-only key), {status: 302, cookie, location} after ?k=
// or ?look=, or {status: 401|403}. look: the look-only key, null while it is off. The owner's key wins over it.
export function authorize(req, url, { token, look = null, address }) {
  const fromCookie = sameToken(cookieToken(req), token);
  const looking = !fromCookie && look !== null && sameToken(cookieToken(req, LOOK_COOKIE), look);
  if (WRITE_METHODS.has(req.method)) {
    if (looking || req.headers['x-session-map'] !== '1' || !sameOrigin(req)) return { status: 403 };
    return fromCookie ? { status: 200 } : { status: 401 };
  }
  const k = url.searchParams.get('k');
  if (k !== null) {
    if (!sameToken(k, token)) return { status: 401 };
    url.searchParams.delete('k');
    return { status: 302, cookie: tokenCookie(req, token), location: `${url.pathname}${url.search}` };
  }
  const shared = url.searchParams.get('look');
  if (shared !== null) {
    if (look === null || !sameToken(shared, look)) return { status: 401 };
    url.searchParams.delete('look');
    return { status: 302, cookie: tokenCookie(req, look, LOOK_COOKIE), location: `${url.pathname}${url.search}` };
  }
  if (looking) return { status: 200, look: true };
  // Local reads are open, but the cookie only comes from ?k=: any local process could otherwise fetch the token with
  // one GET, including another OS user who cannot read the 0600 token file.
  return fromCookie || isLocal(address, req.headers.host) ? { status: 200 } : { status: 401 };
}
