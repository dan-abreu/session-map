import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { personsWords } from '../server/chat/prompt.mjs';
import { createTidier, originalOf, wantsTidy, withOriginal } from '../server/chat/tidy-words.mjs';

// The person's message, tidied before the work and the book (id111): the tidied text is the request, the person's own words
// ride at its end between two marks, and any failure sends the message as it is.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const LONG = 'preciso que o chat seja reformulado de maneira organizada porque eu falo cheio de imperfeição e quero tudo em lista bem clara';
const TIDIED = 'Pedido: reformular as mensagens do chat de forma organizada, em lista.';

test('short messages and slash commands are not tidied; long ones are', () => {
  assert.equal(wantsTidy('pode construir'), false);
  assert.equal(wantsTidy(`/clear ${LONG}`), false);
  assert.equal(wantsTidy(LONG), true);
});

test('the person\'s words come back out of a prompt that carries them', () => {
  const prompt = withOriginal(TIDIED, LONG);
  assert.equal(originalOf(prompt), LONG);
  assert.equal(personsWords(prompt), LONG);
  assert.equal(originalOf('plain text'), null);
});

test('the tidier returns the rewrite, distrusts a bad one, and backs off after a failed call', async () => {
  let t = 10_000_000;
  const calls = [];
  const answers = [{ ok: true, value: { text: TIDIED } }, { ok: true, value: { text: 'x' } }, { ok: false }, { ok: true, value: { text: TIDIED } }];
  const tidy = createTidier({ now: () => t, run: async (p) => { calls.push(p); return answers[calls.length - 1]; } });
  assert.equal(await tidy('curto demais'), null);
  assert.equal(calls.length, 0);
  assert.equal(await tidy(LONG), TIDIED);
  assert.equal(await tidy(LONG), null, 'a one-letter rewrite is not trusted');
  assert.equal(await tidy(LONG), null, 'a failed call');
  assert.equal(await tidy(LONG), null, 'in back-off: no new call');
  assert.equal(calls.length, 3);
  t += 31 * 60_000;
  assert.equal(await tidy(LONG), TIDIED);
});

async function withHub(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-tidy-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-tidy-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env }, snapshot: async () => null, ...opts });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  try { await fn({ hub, state, smDir }); } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const run = async (hub, state, text) => {
  const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text }, state);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const events = [];
  hub.subscribe(res.body.chatKey, { write: (e) => events.push(e), end() {} });
  const until = async (pred) => { for (let i = 0; i < 200 && !events.some(pred); i++) await new Promise((r) => setTimeout(r, 50)); return events.find(pred); };
  await until((e) => e.type === 'turn-end');
  const echo = events.find((e) => e.type === 'text' && !e.data.partial)?.data.text ?? '';
  return { echo, shown: events.filter((e) => e.type === 'user').map((e) => e.data.text), key: res.body.chatKey, events, until };
};

test('the working AI gets the tidied request with the person\'s words at the end; the page shows the words', async () => {
  await withHub({ tidyText: async () => TIDIED }, async ({ hub, state }) => {
    const r = await run(hub, state, LONG);
    assert.match(r.echo, /Pedido: reformular as mensagens/);
    assert.ok(r.echo.includes(LONG), 'the original rides along');
    assert.deepEqual(r.shown, [LONG]);
  });
});

test('a tidy that fails sends the message as it is, and the off file turns it off', async () => {
  await withHub({ tidyText: async () => null }, async ({ hub, state }) => {
    const r = await run(hub, state, LONG);
    assert.ok(r.echo.includes(LONG));
    assert.ok(!r.echo.includes('kept as written'));
  });
  let called = 0;
  await withHub({ tidyText: async () => { called++; return TIDIED; } }, async ({ hub, state, smDir }) => {
    writeFileSync(join(smDir, 'tidy-words.off'), '');
    const r = await run(hub, state, LONG);
    assert.equal(called, 0);
    assert.ok(!r.echo.includes('Pedido: reformular'));
  });
});

test('a later message is tidied too', async () => {
  await withHub({ tidyText: async () => TIDIED }, async ({ hub, state }) => {
    const r = await run(hub, state, 'o que acha de usar Ollama?');
    assert.ok(!r.echo.includes('kept as written'), 'a short first message goes as it is');
    let sent;
    for (let i = 0; i < 40; i++) { sent = await hub.send(r.key, { text: LONG }); if (sent.status !== 409) break; await new Promise((x) => setTimeout(x, 50)); }
    assert.equal(sent.status, 200);
    await r.until((e) => e.type === 'turn-end' && r.events.filter((x) => x.type === 'turn-end').length >= 2);
    const echoes = r.events.filter((e) => e.type === 'text' && !e.data.partial).map((e) => e.data.text);
    assert.match(echoes[1], /Pedido: reformular as mensagens/);
    assert.deepEqual(r.events.filter((e) => e.type === 'user').map((e) => e.data.text).at(-1), LONG);
  });
});

test('a marker typed inside the person\'s words does not cut them short', () => {
  const own = `antes\n[session-map: the person's own words, kept as written]\ndepois`;
  assert.equal(originalOf(withOriginal(TIDIED, own)), own);
});
