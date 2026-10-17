import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { isLocal, sameToken } from '../auth.mjs';

// The DeepSeek relay (id180, pc42): a talk on DeepSeek runs on Claude Code, which speaks to DeepSeek's Anthropic address
// but cannot ask it for DeepSeek's own non-thinking mode (it drops its thinking field; DeepSeek then thinks by default).
// Claude Code is pointed here instead: each request of the conversation passes through, and when the person turned
// DeepSeek's thinking off, the body carries {thinking: {type: "disabled"}} (proved on 2026-10-17: no thinking block, one
// output token, even with an effort or an earlier thinking turn in the history). The answer streams back untouched.
// Each conversation gets its own secret as the key Claude Code sends; the real DeepSeek key stays in this process and
// never reaches Claude Code's environment. Loopback only.

export const RELAY_PATH = '/api/ds-relay';
const UPSTREAM = 'https://api.deepseek.com/anthropic';
const BODY_MAX = 32 * 1024 * 1024;
// The headers DeepSeek reads; the rest (Claude Code's own client headers, the hop-by-hop ones) stay here.
const PASS_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta'];
// What goes back to Claude Code: the stream's own type and nothing that would describe a body we re-chunk.
const BACK_HEADERS = ['content-type', 'cache-control', 'request-id', 'x-request-id'];
// The calls a conversation makes: the message, and the count Claude Code asks before a long one.
const CALLS = new Set(['/v1/messages', '/v1/messages/count_tokens']);
const fail = (res, status, error) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'relay_error', message: error } }));
};

// -> the body as DeepSeek gets it: unchanged unless thinking is off, then thinking disabled and no effort (it has no
// meaning without thinking).
export function relayBody(body, { thinkingOff = false } = {}) {
  if (!thinkingOff || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...body, thinking: { type: 'disabled' } };
  if (out.output_config && typeof out.output_config === 'object') {
    const { effort, ...rest } = out.output_config;
    if (Object.keys(rest).length) out.output_config = rest; else delete out.output_config;
  }
  return out;
}

const secretOf = (req) => {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
  return bearer ?? (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : null);
};

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// keyOf(): the DeepSeek key (from the owner's saved keys). fetchFn: replaceable for the tests.
export function createDeepseekRelay({ keyOf, fetchFn = fetch, upstream = UPSTREAM, log = () => {} } = {}) {
  // secret -> () => {thinkingOff}: read at each request, so a switch takes effect on the next call with no restart.
  const chats = new Map();

  function register(optionsOf) {
    const secret = `smr-${randomBytes(24).toString('hex')}`;
    chats.set(secret, optionsOf);
    return secret;
  }
  const unregister = (secret) => { chats.delete(secret); };
  const known = (given) => {
    for (const [secret, optionsOf] of chats) if (sameToken(given, secret)) return optionsOf;
    return null;
  };

  const handles = (path) => path === RELAY_PATH || path.startsWith(`${RELAY_PATH}/`);

  // Never throws: a request cut in the middle (Claude Code stopped or ended) must not take the server down with it.
  async function handle(req, res, url, address) {
    try {
      return await relay(req, res, url, address);
    } catch (err) {
      log('warn', 'ds-relay-failed', { error: err.message });
      if (!res.headersSent) fail(res, 502, 'relay-failed'); else res.destroy();
      return undefined;
    }
  }

  async function relay(req, res, url, address) {
    if (!isLocal(address, req.headers.host)) return fail(res, 403, 'loopback-only');
    const optionsOf = known(secretOf(req));
    if (!optionsOf) return fail(res, 401, 'unknown-conversation');
    // The secret opens the two calls a conversation makes and nothing else of DeepSeek's.
    const path = url.pathname.slice(RELAY_PATH.length);
    if (req.method !== 'POST' || !CALLS.has(path)) return fail(res, 404, 'not-a-conversation-call');
    // Claude Code hung up (a stop, an end): the call to DeepSeek is let go too, even before its first byte.
    const gone = new AbortController();
    res.on('close', () => { if (!res.writableFinished) gone.abort(); });
    let key;
    try { key = await keyOf(); } catch { key = null; }
    if (typeof key !== 'string' || !key) return fail(res, 503, 'no-deepseek-key');
    const raw = await readRaw(req);
    if (raw === null) return fail(res, 413, 'too-large');
    let body = raw;
    if (raw.length && path === '/v1/messages' && String(req.headers['content-type'] ?? '').includes('json')) {
      try {
        body = Buffer.from(JSON.stringify(relayBody(JSON.parse(raw.toString('utf8')), optionsOf() ?? {})));
      } catch { body = raw; }
    }
    const headers = { 'x-api-key': key, authorization: `Bearer ${key}` };
    for (const h of PASS_HEADERS) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h];
    let up;
    try {
      // No redirect is followed: a 3xx elsewhere would carry the key's own header with it.
      up = await fetchFn(`${upstream}${path}${url.search}`, { method: 'POST', headers, redirect: 'manual', signal: gone.signal, ...(body.length ? { body } : {}) });
    } catch (err) {
      if (gone.signal.aborted) return undefined;
      log('warn', 'ds-relay-failed', { error: err.message });
      return fail(res, 502, 'upstream-unreachable');
    }
    const back = {};
    for (const h of BACK_HEADERS) { const v = up.headers?.get?.(h); if (v) back[h] = v; }
    res.writeHead(up.status, back);
    if (!up.body) return res.end();
    const stream = Readable.fromWeb(up.body);
    res.on('close', () => { if (!res.writableFinished) stream.destroy(); });
    stream.on('error', () => res.end());
    stream.pipe(res);
    return undefined;
  }

  return { register, unregister, handles, handle, size: () => chats.size };
}
