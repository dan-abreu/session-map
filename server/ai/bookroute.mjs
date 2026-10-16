import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lifeOf } from './life.mjs';
import { headerAuth } from './askroute.mjs';

// The book's titles and summaries on the AI the Cérebro's "book" row names (id156). The book is written by a small
// program a hook starts on its own (chat/book-tidy.mjs), outside this server, so it cannot hold the other AIs' keys, the
// daily cap or the credit pause. It asks here instead, and the same runner that serves the map's own work answers: the
// key, the cap, the quota pause, the balance and the activity log stay in one place. POST /api/ai/book {prompt,
// schemaHint?} -> {ok, value, costUSD} or {ok: false, error}. When no other AI can take it ('no-outside': the row names
// Claude, or no key, or the cap) the caller does its own Claude call. Loopback and the same header token as the arsenal.

const BOOK_PATH = '/api/ai/book';
const PROMPT_MAX = 64 * 1024;
const HINT_MAX = 2 * 1024;

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > PROMPT_MAX * 2) return null;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

function readConfig(smDir) {
  try { return JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')) ?? {}; } catch { return {}; }
}

export function createBookRoutes({ smDir, demo = false, token = '', queue = null, ai = {} } = {}) {
  const queueOf = () => queue ?? lifeOf(smDir, readConfig(smDir), ai).queue;

  async function ask(body) {
    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    if (!prompt) return { status: 400, body: { ok: false, error: 'no-prompt' } };
    if (prompt.length > PROMPT_MAX) return { status: 413, body: { ok: false, error: 'prompt-too-big' } };
    const schemaHint = typeof body.schemaHint === 'string' && body.schemaHint.length <= HINT_MAX ? body.schemaHint : undefined;
    // Asked again with the same words, the answer is the cached one: nothing is billed twice.
    const sha = createHash('sha1').update(prompt).digest('hex');
    const res = await queueOf().ask({ key: { kind: 'book', sha }, prompt, schemaHint, functionId: 'book', outsideOnly: true, uncapped: true, sensitivity: 'internal' });
    if (res?.ok) return { status: 200, body: { ok: true, value: res.value, costUSD: Number(res.costUSD) || 0, cached: res.cached === true } };
    return { status: 200, body: { ok: false, error: String(res?.error ?? 'failed').slice(0, 40) } };
  }

  async function handle(req, url) {
    if (demo) return { status: 403, body: { ok: false, error: 'demo' } };
    if (req.method !== 'POST') return { status: 405, body: { ok: false, error: 'method' } };
    const body = await readBody(req);
    if (body === null) return { status: 400, body: { ok: false, error: 'bad-json' } };
    return url.pathname === BOOK_PATH ? ask(body) : { status: 404, body: { ok: false, error: 'not-found' } };
  }

  return {
    handles: (path) => path === BOOK_PATH,
    authorizeHeader: (req, url, address) => (url.pathname === BOOK_PATH ? headerAuth(req, address, token) : null),
    handle,
  };
}
