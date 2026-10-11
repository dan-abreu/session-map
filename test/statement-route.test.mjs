import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStatementStore, isStatementPath, statementRoute } from '../server/statement-route.mjs';
import { periodOf } from '../server/ledger.mjs';
import { translator } from '../server/web/i18n.js';
import stmtTexts from '../server/web/i18n-fd/screens-statement.js';

const prices = { 'claude-a': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 } };
const line = (o) => `${JSON.stringify(o)}\n`;
const NOW = Date.parse('2026-10-11T15:00:00.000Z');
const TODAY = periodOf({ from: '2026-10-11', to: '2026-10-11' }, NOW);
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stmt-route-'));
  const projects = join(root, 'projects');
  const sm = join(root, 'session-map');
  mkdirSync(join(projects, 'C--dev-demo', 's1', 'subagents'), { recursive: true });
  mkdirSync(sm);
  const at = (h) => `2026-10-11T${String(h).padStart(2, '0')}:00:00.000Z`;
  const reply = (id, h, out, content = []) => ({ type: 'assistant', sessionId: 's1', timestamp: at(h), requestId: `r${id}`, message: { id: `m${id}`, model: 'claude-a', content, usage: { input_tokens: 10, output_tokens: out } } });
  writeFileSync(join(projects, 'C--dev-demo', 's1.jsonl'), [
    { type: 'user', cwd: 'C:\\dev\\demo', sessionId: 's1', timestamp: at(9), message: { role: 'user', content: 'faça o extrato' } },
    reply(1, 9, 1000), reply(2, 10, 2000, [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'C:\\dev\\demo\\a.mjs', content: 'a\nb' } }]),
    { type: 'assistant', isApiErrorMessage: true, sessionId: 's1', timestamp: at(11), message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your weekly limit · resets Oct 15" }] } },
  ].map(line).join(''));
  writeFileSync(join(projects, 'C--dev-demo', 's1', 'subagents', 'agent-x.jsonl'), line(reply(3, 12, 500)));
  writeFileSync(join(projects, 'C--dev-demo', 's1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Ler o código' }));
  return { projects, sm };
}
const storeOf = ({ projects, sm }, extra = {}) => createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => ({ plan: 'Max 20x' }), now: () => NOW, ...extra });

test('the store reads in the background, then answers the period: its total, one line per chat, the account, the notices', async () => {
  const fx = fixture();
  const store = storeOf(fx);
  const first = store.status(TODAY);
  assert.equal(first.period, null);
  assert.ok(first.reading);
  await store.build(TODAY);
  const s = store.status(TODAY);
  assert.equal(s.reading, null);
  assert.equal(s.period.total.replies, 3);
  assert.equal(s.period.chats.length, 1);
  assert.equal(s.period.chats[0].title, 'faça o extrato');
  assert.equal(s.period.chats[0].helpers, 1);
  assert.equal(s.period.events.length, 1);
  assert.equal(s.period.account.plan, 'Max 20x');
  assert.ok(existsSync(join(fx.sm, 'statement-cache.json')));
});

test('a chat opened through the store: who worked, the file it created with its lines, totals that add up', async () => {
  const store = storeOf(fixture());
  assert.equal(store.chat(TODAY, 's1'), undefined);
  await store.build(TODAY);
  const b = store.chat(TODAY, 's1');
  assert.deepEqual(b.who.map((w) => w.who), ['conversa principal', 'ajudante: Ler o código']);
  assert.equal(b.files.changed[0].name, 'a.mjs');
  assert.equal(b.files.changed[0].add, 2);
  assert.ok(Math.abs(b.check.who - b.check.total) < 1e-6 && Math.abs(b.check.kinds - b.check.total) < 1e-6);
  assert.equal(store.chat(TODAY, 'nope'), null);
});

test('replies come newest first, filtered and paged; the CSV takes the same filters and names the files written', async () => {
  const store = storeOf(fixture());
  assert.equal(store.rows(TODAY), null);
  await store.build(TODAY);
  const all = store.rows(TODAY, {}, 0, 2);
  assert.equal(all.total, 3);
  assert.deepEqual(all.rows.map((r) => r.output), [500, 2000]);
  assert.equal(all.rows[1].acts[0].k, 'create');
  assert.equal(store.rows(TODAY, { chat: 's1', file: 'c:/dev/demo/a.mjs' }).total, 1);
  assert.equal(store.rows(TODAY, { kind: 'answer' }).total, 2);
  const csv = store.csv(TODAY, { who: 'conversa principal' });
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.match(csv, /criou C:\\dev\\demo\\a\.mjs \(\+2\)/);
});

test('a second store reads the saved cache instead of the files; a broken entry is a miss', async () => {
  const fx = fixture();
  writeFileSync(join(fx.sm, 'statement-cache.json'), JSON.stringify({ version: 2, files: { a: null, b: { data: {} } } }));
  await storeOf(fx).build(TODAY);
  const store = storeOf(fx);
  await store.build(TODAY);
  assert.equal(store.status(TODAY).period.total.replies, 3);
});

test('a failed read is told and not tried again at once', async () => {
  let calls = 0;
  const broken = storeOf(fixture(), { prices: () => { calls++; throw new Error('no prices'); } });
  await broken.build(TODAY).catch(() => {});
  await new Promise((r) => setImmediate(r));
  const s = broken.status(TODAY);
  assert.equal(s.failed, 'no prices');
  assert.equal(s.reading, null);
  assert.equal(calls, 1);
});

test('the route: the four reads, a bad page number refused, and nothing for the look-only key, the demo or no token', async () => {
  const store = storeOf(fixture());
  await store.build(TODAY);
  for (const p of ['/api/statement', '/api/statement/chat', '/api/statement/rows', '/api/statement.csv']) assert.ok(isStatementPath(p));
  assert.ok(!isStatementPath('/api/statements'));
  const call = (path, allowed = { ok: true }) => {
    let sent = null;
    const res = { writeHead: (status) => { sent = { status }; }, end: (body) => { sent.body = body; } };
    statementRoute({ store, send: (r, status, body) => { sent = { status, body }; }, HttpError, now: () => NOW }, { method: 'GET' }, res, new URL(`http://x${path}`), allowed);
    return sent;
  };
  assert.throws(() => call('/api/statement', { ok: false, status: 403, error: 'look-only' }), /look-only/);
  assert.equal(call('/api/statement?from=2026-10-11&to=2026-10-11').body.period.total.replies, 3);
  assert.equal(call('/api/statement/chat?id=s1&from=2026-10-11&to=2026-10-11').body.helpers, 1);
  assert.throws(() => call('/api/statement/chat?id=nope&from=2026-10-11&to=2026-10-11'), /unknown-session/);
  assert.equal(call('/api/statement/rows?from=2026-10-11&to=2026-10-11&kind=create').body.total, 1);
  assert.throws(() => call('/api/statement/rows?offset=Infinity'), /bad-offset/);
  assert.match(call('/api/statement.csv?from=2026-10-11&to=2026-10-11').body, /^\uFEFFdata;hora/);
});

test('the statement texts exist in both languages with the same keys', () => {
  assert.deepEqual(Object.keys(stmtTexts.en).sort(), Object.keys(stmtTexts['pt-BR']).sort());
  assert.equal(translator('pt-BR')('stmt.title'), 'Extrato');
  assert.equal(translator('pt-BR')('stmt.kind.helper'), 'Chamar ajudantes');
});

test('the entries carry a running balance, newest first, and filter by project; each chat lists who worked in it', async () => {
  const store = storeOf(fixture());
  await store.build(TODAY);
  const page = store.rows(TODAY, {}, 0, 10);
  assert.equal(page.rows.length, 3);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  close(page.rows[0].balance, page.sumUsd);
  close(page.rows[0].balance - page.rows[0].usd.total, page.rows[1].balance);
  assert.equal(store.rows(TODAY, { project: 'demo' }).total, 3);
  assert.equal(store.rows(TODAY, { project: 'other' }).total, 0);
  const chat = store.status(TODAY).period.chats[0];
  assert.deepEqual(chat.who.map((w) => w.who), ['conversa principal', 'ajudante: Ler o código']);
});
