import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';

// POST /api/ai/book (id156): the book's own program asks the server, and the runner that serves the map's work answers on
// the AI the Cérebro's "book" row names; with no other AI to take it, it says so and the caller does its own Claude call.

const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] };

async function withServer(bookQueue, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-bk-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bk-sm-'));
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, askAi: { bookQueue } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (body, headers = { 'x-session-map-token': token }) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ai/book', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
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

test('the book asks the runner on its own row, outside AIs only, and gets the answer and its cost back', async () => {
  const seen = [];
  const queue = { ask: async (o) => { seen.push(o); return { ok: true, value: { title: 'T' }, costUSD: 0.0004 }; } };
  await withServer(queue, async ({ call }) => {
    const r = await call({ prompt: 'titles please', schemaHint: '{"title":"..."}' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.ok, r.json.value, r.json.costUSD], [true, { title: 'T' }, 0.0004]);
    assert.equal(seen[0].functionId, 'book', 'the Cérebro\'s book row rules this call');
    assert.equal(seen[0].outsideOnly, true, 'no Claude fallback here: the caller has its own');
    assert.equal(seen[0].key.kind, 'book');
    assert.equal(seen[0].schemaHint, '{"title":"..."}');
  });
});

test('when no other AI can take it the answer says so, and a bad or unauthorised ask is refused before anything runs', async () => {
  let asked = 0;
  const queue = { ask: async () => { asked += 1; return { ok: false, error: 'no-outside' }; } };
  await withServer(queue, async ({ call }) => {
    const none = await call({ prompt: 'titles please' });
    assert.deepEqual([none.status, none.json.ok, none.json.error], [200, false, 'no-outside']);
    assert.equal((await call({})).status, 400, 'no prompt');
    assert.equal((await call({ prompt: 'x'.repeat(70 * 1024) })).status, 413, 'too big');
    assert.equal(asked, 1, 'only the good ask reached the runner');
    const noToken = await call({ prompt: 'titles please' }, {});
    assert.ok([401, 403].includes(noToken.status), `no token: ${noToken.status}`);
    const wrong = await call({ prompt: 'titles please' }, { 'x-session-map-token': 'f'.repeat(64) });
    assert.ok([401, 403].includes(wrong.status), `wrong token: ${wrong.status}`);
    assert.equal(asked, 1, 'unauthorised asks never reach the runner');
  });
});

test('end to end: the book program, the proof, the route, the runner and another AI — the titles come back from it and cost its price', async () => {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { setKey } = await import('../server/ai/keys.mjs');
  const { tidyBook, askBookOutside } = await import('../server/chat/book-tidy.mjs');
  const backend = { scheme: 'fake', seal: async (plain) => `sealed:${Buffer.from(plain).reverse().toString('base64')}`, open: async (sealed) => Buffer.from(sealed.slice(7), 'base64').reverse().toString() };
  const dir = mkdtempSync(join(tmpdir(), 'sm-bk-e2e-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-bk-e2e-sm-'));
  const work = mkdtempSync(join(tmpdir(), 'sm-bk-e2e-work-'));
  await setKey(smDir, 'deepseek', 'deepseek-fake-key-0000000000000000', { backend });
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: true, functions: { book: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } } } } }));
  const answer = { title: 'Login e cabeçalho', subjectChanged: false, chapters: [{ n: 1, title: 'Corrigir o login', summary: 'login corrigido' }] };
  const asked = [];
  const apiRun = async (prompt, o) => { asked.push(`${o.provider}:${o.model}:${o.effort}`); return { ok: true, value: answer, costUSD: 0.0004 }; };
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, helpers: { backend }, ai: { apiRun, keyOf: async () => 'sk-fake' } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const line = (type, role, text) => JSON.stringify({ type, message: { role, content: text } });
  const transcript = join(work, 't.jsonl');
  const bookDir = join(work, 'book');
  mkdirSync(bookDir);
  writeFileSync(transcript, [line('user', 'user', 'Fix the login'), line('assistant', 'assistant', 'Done.'), line('user', 'user', 'Now the header')].join('\n'));
  const claude = [];
  const before = { dir: process.env.SESSION_MAP_DIR, url: process.env.SM_URL };
  try {
    process.env.SESSION_MAP_DIR = smDir;
    process.env.SM_URL = `http://127.0.0.1:${app.address().port}`;
    await tidyBook({ transcriptPath: transcript, bookDir, outside: askBookOutside, run: async (p, o) => { claude.push(o); return { ok: false, error: 'should-not-run' }; } });
    const tidy = JSON.parse(readFileSync(join(bookDir, 'tidy.json'), 'utf8'));
    assert.deepEqual(asked, ['deepseek:deepseek-flash:low'], 'the other AI the book row names answered, at the level it names');
    assert.equal(claude.length, 0, 'Claude was never called');
    assert.equal(tidy.chapters[1].title, 'Corrigir o login');
    assert.equal(tidy.title, 'Login e cabeçalho');
    assert.equal(tidy.costUSD, 0.0004, 'it cost the other AI\'s price');
  } finally {
    for (const [k, v] of [['SESSION_MAP_DIR', before.dir], ['SM_URL', before.url]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await new Promise((resolve) => app.close(resolve));
    for (const d of [dir, smDir, work]) rmSync(d, { recursive: true, force: true });
  }
});
