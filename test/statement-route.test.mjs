import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStatementStore, isStatementPath, statementRoute } from '../server/statement-route.mjs';
import { translator } from '../server/web/i18n.js';
import stmtTexts from '../server/web/i18n-fd/screens-statement.js';

const prices = { 'claude-a': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 } };
const line = (o) => `${JSON.stringify(o)}\n`;
const NOW = Date.parse('2026-10-11T15:00:00.000Z');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stmt-route-'));
  const projects = join(root, 'projects');
  const sm = join(root, 'session-map');
  mkdirSync(join(projects, 'C--dev-demo', 's1', 'subagents'), { recursive: true });
  mkdirSync(sm);
  const at = (h) => `2026-10-11T${String(h).padStart(2, '0')}:00:00.000Z`;
  const reply = (id, h, out) => ({ type: 'assistant', sessionId: 's1', timestamp: at(h), requestId: `r${id}`, message: { id: `m${id}`, model: 'claude-a', content: [], usage: { input_tokens: 10, output_tokens: out } } });
  writeFileSync(join(projects, 'C--dev-demo', 's1.jsonl'), [
    { type: 'user', cwd: 'C:\\dev\\demo', sessionId: 's1', timestamp: at(9), message: { role: 'user', content: 'faça o extrato' } },
    reply(1, 9, 1000), reply(2, 10, 2000),
    { type: 'assistant', isApiErrorMessage: true, sessionId: 's1', timestamp: at(11), message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your weekly limit · resets Oct 15" }] } },
  ].map(line).join(''));
  writeFileSync(join(projects, 'C--dev-demo', 's1', 'subagents', 'agent-x.jsonl'), line(reply(3, 12, 500)));
  writeFileSync(join(projects, 'C--dev-demo', 's1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Ler o código' }));
  return { projects, sm };
}

test('the store builds in the background, then serves the sums, the chats with their agents and the notices', async () => {
  const { projects, sm } = fixture();
  const store = createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => ({ plan: 'max' }), now: () => NOW });
  const first = store.status(30);
  assert.equal(first.summary, null);
  assert.ok(first.reading);
  await store.build(30);
  const s = store.status(30);
  assert.equal(s.reading, null);
  assert.equal(s.summary.total.replies, 3);
  assert.equal(s.summary.chats.length, 1);
  assert.deepEqual(s.summary.chats[0].agents.map((a) => a.who).sort(), ['agente: Ler o código', 'conversa principal']);
  assert.equal(s.summary.events.length, 1);
  assert.match(s.summary.events[0].text, /weekly limit/);
  assert.equal(s.summary.account.plan, 'max');
  assert.ok(existsSync(join(sm, 'statement-cache.json')));
});

test('lines come newest first, filtered and paged; the CSV takes the same filters', async () => {
  const { projects, sm } = fixture();
  const store = createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => null, now: () => NOW });
  assert.equal(store.rows(30), null);
  await store.build(30);
  const all = store.rows(30, {}, 0, 2);
  assert.equal(all.total, 3);
  assert.deepEqual(all.rows.map((r) => r.output), [500, 2000]);
  assert.equal(all.rows[0].who, 'agente: Ler o código');
  assert.equal(all.rows[1].usd.total, (10 * 4 + 2000 * 20) / 1e6);
  const mine = store.rows(30, { chat: 's1', who: 'conversa principal' });
  assert.equal(mine.total, 2);
  assert.equal(store.rows(30, { day: '2026-01-01' }).total, 0);
  const csv = store.csv(30, { who: 'conversa principal' });
  assert.equal(csv.trim().split('\r\n').length, 3);
});

test('a second store reads the saved cache instead of the files', async () => {
  const { projects, sm } = fixture();
  await createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => null, now: () => NOW }).build(30);
  const store = createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => null, now: () => NOW });
  await store.build(30);
  assert.equal(store.status(30).summary.total.replies, 3);
});

test('the route refuses the look-only key, the demo and a page without the token', () => {
  class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
  const store = { status: () => ({}) };
  const url = new URL('http://x/api/statement?days=30');
  assert.ok(isStatementPath('/api/statement') && isStatementPath('/api/statement/rows') && isStatementPath('/api/statement.csv'));
  assert.ok(!isStatementPath('/api/statements'));
  assert.throws(() => statementRoute({ store, send: () => {}, HttpError }, { method: 'GET' }, {}, url, { ok: false, status: 403, error: 'look-only' }), /look-only/);
  let sent = null;
  statementRoute({ store, send: (res, status, body) => { sent = { status, body }; }, HttpError }, { method: 'GET' }, {}, url, { ok: true });
  assert.equal(sent.status, 200);
});

test('the statement texts exist in both languages with the same keys', () => {
  assert.deepEqual(Object.keys(stmtTexts.en).sort(), Object.keys(stmtTexts['pt-BR']).sort());
  assert.equal(translator('pt-BR')('stmt.title'), 'Extrato detalhado');
});

test('a broken cache entry is a miss, a failed build is told and not retried at once, a bad page number is refused', async () => {
  const { projects, sm } = fixture();
  writeFileSync(join(sm, 'statement-cache.json'), JSON.stringify({ version: 1, files: { a: null, b: { data: {} } } }));
  const store = createStatementStore({ projectsDir: projects, smDir: sm, prices: () => prices, account: () => null, now: () => NOW });
  await store.build(30);
  assert.equal(store.status(30).summary.total.replies, 3);

  let calls = 0;
  const broken = createStatementStore({ projectsDir: projects, smDir: sm, prices: () => { calls++; throw new Error('no prices'); }, account: () => null, now: () => NOW });
  await broken.build(30).catch(() => {});
  await new Promise((r) => setImmediate(r));
  const s = broken.status(30);
  assert.equal(s.failed, 'no prices');
  assert.equal(s.reading, null);
  assert.equal(calls, 1);

  class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
  const url = new URL('http://x/api/statement/rows?days=30&offset=Infinity');
  assert.throws(() => statementRoute({ store, send: () => {}, HttpError }, { method: 'GET' }, {}, url, { ok: true }), /bad-offset/);
});
