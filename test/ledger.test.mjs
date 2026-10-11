import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actOf, chatLedger, fileKey, fileName, ledgerRows, outsideLedger, periodLedger, periodOf } from '../server/ledger.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const T = (h, d = 11) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00`);
const cost = (total, part = {}) => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, webSearch: 0, ...part, total });

function fixture() {
  const rows = [
    { key: 'a', ts: T(9), sessionId: 's1', who: 'conversa principal', model: 'm', cost: cost(1, { cacheRead: 0.6, output: 0.4 }),
      acts: [actOf({ name: 'Write', input: { file_path: 'C:\\dev\\demo\\a.mjs', content: 'x\ny\nz' } }), actOf({ name: 'Read', input: { file_path: 'C:\\dev\\demo\\b.mjs' } })] },
    { key: 'b', ts: T(10), sessionId: 's1', who: 'conversa principal', model: 'm', cost: cost(2, { output: 2 }), acts: [] },
    { key: 'c', ts: T(11), sessionId: 's1', who: 'ajudante: revisar', model: 'm', cost: cost(3, { cacheRead: 3 }),
      acts: [actOf({ name: 'Edit', input: { file_path: 'c:/dev/demo/a.mjs', old_string: 'x', new_string: 'x\nw' } })] },
    { key: 'd', ts: T(12, 9), sessionId: 's2', who: 'conversa principal', model: 'm', cost: cost(4, { output: 4 }), acts: [] },
  ];
  const sessions = new Map([['s1', { title: 'Extrato', project: 'demo', cwd: 'C:\\dev\\demo' }], ['s2', { title: 'Outra', project: 'x', cwd: null }]]);
  const allTime = new Map([['s1', { usd: 20, first: T(9, 1), replies: 40 }]]);
  return { rows, sessions, allTime };
}

test('a tool call becomes a line of the books: its kind, its file and the lines it wrote', () => {
  assert.deepEqual(actOf({ name: 'Write', input: { file_path: 'a.txt', content: 'one\ntwo' } }), { k: 'create', t: 'a.txt', add: 2, del: 0 });
  assert.deepEqual(actOf({ name: 'Edit', input: { file_path: 'a.txt', old_string: 'a\nb\nc', new_string: 'a' } }), { k: 'edit', t: 'a.txt', add: 1, del: 3 });
  assert.deepEqual(actOf({ name: 'MultiEdit', input: { file_path: 'a.txt', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd', new_string: 'e' }] } }), { k: 'edit', t: 'a.txt', add: 3, del: 2 });
  assert.equal(actOf({ name: 'Bash', input: { description: 'Run tests', command: 'npm test' } }).k, 'run');
  assert.equal(actOf({ name: 'Agent', input: { description: 'Review' } }).k, 'helper');
  assert.equal(actOf({ name: 'Grep', input: { pattern: 'x' } }).k, 'search');
  assert.equal(actOf({ name: 'mcp__arsenal__ask_other_ai', input: {} }).k, 'other');
});

test('a file is the same file whatever slashes or drive letter wrote it, and is named from the chat folder', () => {
  assert.equal(fileKey('C:\\dev\\demo\\a.mjs'), fileKey('c:/dev/demo/a.mjs'));
  assert.equal(fileName(fileKey('C:\\dev\\demo\\src\\a.mjs'), 'C:\\dev\\demo'), 'src/a.mjs');
  assert.equal(fileName(fileKey('D:\\other\\a.mjs'), 'C:\\dev\\demo'), 'd:/other/a.mjs');
});

test('the period is any day to any day, the last day included; missing means the last 30 days', () => {
  const p = periodOf({ from: '2026-10-10', to: '2026-10-11' });
  assert.equal(p.from, Date.parse('2026-10-10T00:00:00'));
  assert.equal(p.to, Date.parse('2026-10-12T00:00:00'));
  const now = Date.parse('2026-10-11T12:00:00');
  assert.equal(periodOf({}, now).from, now - 30 * 86_400_000);
});

test('the period: its total split by what it was spent on, one line per chat with its share and its cost since it began', () => {
  const st = fixture();
  const p = periodLedger(st, periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  close(p.total.usd, 6);
  close(p.total.usdRead + p.total.usdWrite, 6);
  assert.equal(p.chats.length, 1);
  assert.equal(p.chats[0].helpers, 1);
  close(p.chats[0].share, 1);
  assert.equal(p.chats[0].allTimeUsd, 20);
  const wider = periodLedger(st, periodOf({ from: '2026-10-01', to: '2026-10-11' }));
  assert.deepEqual(wider.chats.map((c) => c.title), ['Extrato', 'Outra']);
  close(wider.chats[1].share, 0.4);
});

test('a chat opened: who worked, files with lines, kinds of work and days all add up to the same total', () => {
  const st = fixture();
  const b = chatLedger(st, 's1', periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  close(b.check.total, 6);
  close(b.check.who, 6);
  close(b.check.kinds, 6);
  assert.deepEqual(b.who.map((w) => w.who), ['conversa principal', 'ajudante: revisar']);
  assert.equal(b.helpers, 1);
  assert.equal(b.allTime.usd, 20);
  assert.equal(b.files.changed.length, 1);
  const a = b.files.changed[0];
  assert.equal(a.name, 'a.mjs');
  assert.equal(a.created, 1);
  assert.equal(a.edits, 1);
  assert.equal(a.add, 3 + 2);
  assert.equal(a.del, 1);
  close(a.usd, 0.5 + 3);
  assert.equal(b.files.onlyRead.length, 1);
  close(b.files.readUsd, 0.5);
  const kinds = Object.fromEntries(b.kinds.map((k) => [k.kind, k.usd]));
  close(kinds.answer, 2);
  close(kinds.edit, 3);
  close(kinds.create, 0.5);
  close(kinds.read, 0.5);
  assert.equal(chatLedger(st, 'nope', periodOf({})), null);
});

test('a day that does not exist falls back, a command naming a path is not a file, and the cost since it began never shrinks to the period', () => {
  const now = Date.parse('2026-10-11T12:00:00');
  assert.equal(periodOf({ from: '2026-13-01', to: '2026-02-30' }, now).from, now - 30 * 86_400_000);
  const st = fixture();
  st.rows.push({ key: 'e', ts: T(13), sessionId: 's1', who: 'conversa principal', model: 'm', cost: cost(1), acts: [{ k: 'run', t: 'C:/dev/demo/a.mjs' }] });
  assert.ok(!ledgerRows(st, periodOf({ from: '2026-10-11', to: '2026-10-11' }), { file: 'C:/dev/demo/a.mjs' }).some((r) => r.key === 'e'));
  st.allTime = new Map();
  const b = chatLedger(st, 's2', periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  assert.equal(b.total.replies, 0);
  assert.equal(b.allTime.usd, 4);
});

test('the replies behind anything opened: a file, a kind of work, who answered, a day', () => {
  const st = fixture();
  const p = periodOf({ from: '2026-10-01', to: '2026-10-11' });
  assert.deepEqual(ledgerRows(st, p, { chat: 's1', file: 'C:/dev/demo/a.mjs' }).map((r) => r.key), ['a', 'c']);
  assert.deepEqual(ledgerRows(st, p, { kind: 'answer' }).map((r) => r.key), ['b', 'd']);
  assert.deepEqual(ledgerRows(st, p, { who: 'ajudante: revisar' }).map((r) => r.key), ['c']);
  assert.deepEqual(ledgerRows(st, p, { day: '2026-10-09' }).map((r) => r.key), ['d']);
});

test('lines read come from each file read, per file, per chat and per period', () => {
  const st = fixture();
  st.rows[0].acts[1].lines = 120;
  const b = chatLedger(st, 's1', periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  assert.equal(b.files.readLines, 120);
  assert.equal(b.files.readFiles, 1);
  assert.equal(b.files.onlyRead[0].readLines, 120);
  const p = periodLedger(st, periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  assert.deepEqual(p.lines, { read: 120, added: 3 + 2, removed: 1 });
});

test('outside the chats: session-map own work and the second opinions, by AI, by task and call by call', () => {
  const at = (h) => T(h);
  const entries = [
    { at: at(9), source: 'map', provider: 'openai', model: 'gpt-6-luna', kind: 'place', costUSD: 0.001, ok: true },
    { at: at(10), source: 'map', provider: 'claude', model: 'haiku', kind: 'place', costUSD: 0.02, ok: true },
    { at: at(11), source: 'chat', provider: 'openai', model: 'gpt-6.1-sol', kind: 'review', costUSD: 0.015, ok: true, accepted: true },
    { at: at(12), source: 'chat', provider: 'gemini', model: 'flash', kind: 'review', costUSD: 0, ok: false },
    { at: T(9, 1), source: 'chat', provider: 'openai', model: 'x', kind: 'review', costUSD: 5, ok: true },
  ];
  const o = outsideLedger(entries, periodOf({ from: '2026-10-11', to: '2026-10-11' }));
  close(o.usd, 0.036);
  assert.equal(o.count, 4);
  const [auto, asked] = o.groups;
  assert.equal(auto.count, 2);
  close(auto.usd, 0.021);
  assert.deepEqual(auto.byAi.map((x) => x.key), ['claude haiku', 'openai gpt-6-luna']);
  assert.deepEqual(auto.byKind.map((x) => [x.key, x.count]), [['place', 2]]);
  assert.equal(asked.count, 2);
  assert.equal(asked.byAi.find((x) => x.key === 'gemini flash').failed, 1);
  assert.equal(o.calls[0].kind, 'review');
  assert.equal(o.calls.find((c) => c.ai === 'openai gpt-6.1-sol').accepted, true);
});
