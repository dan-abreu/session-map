import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyNucleus, mergeNucleus, renderNucleus, parseNucleus, readNucleus, writeNucleus, seedNucleus, NUCLEUS_MAX_BYTES } from '../server/brain/nucleus.mjs';

const chat = (n, extra = {}) => ({
  sessionId: `s${n}`,
  title: `Chat ${n}`,
  updatedAt: `2026-10-${String(n % 28 + 1).padStart(2, '0')}T10:00:00.000Z`,
  lastAssistantText: `last words ${n}`,
  ...extra,
});

test('mergeNucleus: state is the latest doing, todo the latest card todo, decided new-first without repeats', () => {
  let n = mergeNucleus(emptyNucleus(), { doing: 'wiring login', todo: ['a', 'b'], decided: ['use cookies'] }, chat(1));
  n = mergeNucleus(n, { doing: 'testing login', todo: ['c'], decided: ['use JWT', 'use cookies'] }, chat(2));
  assert.equal(n.state, 'testing login');
  assert.deepEqual(n.todo, ['c']);
  assert.deepEqual(n.decided, ['use JWT', 'use cookies']);
});

test('mergeNucleus keeps what the card does not mention', () => {
  const start = { state: 'old', decided: ['x'], todo: ['t'], recent: [] };
  const n = mergeNucleus(start, { title: 'only a title' }, chat(1));
  assert.equal(n.state, 'old');
  assert.deepEqual(n.decided, ['x']);
  assert.deepEqual(n.todo, ['t']);
  assert.equal(mergeNucleus(start, { todo: [] }, chat(1)).todo.length, 0, 'an empty card todo means nothing left');
  assert.equal(mergeNucleus(start, null, chat(1)).recent.length, 1, 'no card: still records the chat');
});

test('mergeNucleus recent: newest first, one entry per chat, at most 8, line from doing or last answer', () => {
  let n = emptyNucleus();
  for (let i = 1; i <= 10; i++) n = mergeNucleus(n, i === 10 ? { doing: 'the doing' } : null, chat(i));
  assert.equal(n.recent.length, 8);
  assert.deepEqual(n.recent.map((r) => r.sessionId), ['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3']);
  assert.equal(n.recent[0].line, 'the doing');
  assert.equal(n.recent[1].line, 'last words 9');
  assert.equal(n.recent[1].date, '2026-10-10');
  n = mergeNucleus(n, null, chat(5, { title: 'Chat 5 renamed' }));
  assert.equal(n.recent.filter((r) => r.sessionId === 's5').length, 1);
  assert.equal(n.recent[0].title, 'Chat 5 renamed');
});

test('mergeNucleus stays under 4 KB by dropping the oldest decided and recent entries', () => {
  let n = emptyNucleus();
  for (let i = 1; i <= 60; i++) {
    const decided = Array.from({ length: 5 }, (_, k) => `decision ${i}.${k} ${'x'.repeat(120)}`);
    n = mergeNucleus(n, { doing: 'busy', decided }, chat(i, { title: 'T'.repeat(100) }));
  }
  assert.ok(Buffer.byteLength(renderNucleus(n)) <= NUCLEUS_MAX_BYTES);
  assert.ok(n.decided[0].startsWith('decision 60.'), 'the newest decisions survive');
  assert.ok(!n.decided.some((d) => d.startsWith('decision 1.')), 'the oldest were cut');
  assert.equal(n.recent[0].sessionId, 's60');
  assert.equal(n.state, 'busy');
});

test('mergeNucleus flattens newlines so the markdown stays parseable', () => {
  const n = mergeNucleus(emptyNucleus(), { doing: 'line one\nline two', decided: ['a\n## Recent\nb'] }, chat(1, { title: 'x — y\nz' }));
  assert.equal(n.state, 'line one line two');
  assert.deepEqual(parseNucleus(renderNucleus(n)), n);
});

test('renderNucleus and parseNucleus round-trip, including empty sections and a missing line', () => {
  const full = mergeNucleus(mergeNucleus(emptyNucleus(), { doing: 'S', todo: ['t1', 't2'], decided: ['d1', 'd2'] }, chat(1)), { decided: ['d3'] }, chat(2, { lastAssistantText: '' }));
  const text = renderNucleus(full);
  for (const h of ['## State', '## Decided', '## To do', '## Recent']) assert.ok(text.includes(h), h);
  assert.deepEqual(parseNucleus(text), full);
  assert.deepEqual(parseNucleus(renderNucleus(emptyNucleus())), emptyNucleus());
  const undated = mergeNucleus(emptyNucleus(), null, { sessionId: 's9', title: 'No date' });
  assert.equal(undated.recent[0].date, '');
  assert.deepEqual(parseNucleus(renderNucleus(undated)), undated);
});

test('parseNucleus survives a hand-edited file (extra blank lines, unknown text, missing sections)', () => {
  const n = parseNucleus('intro\n\n## Decided\n\n- one\n- two\n\n## State\n\nworking\n');
  assert.equal(n.state, 'working');
  assert.deepEqual(n.decided, ['one', 'two']);
  assert.deepEqual(n.todo, []);
  assert.deepEqual(n.recent, []);
});

test('writeNucleus/readNucleus use brain/<projectId>/<unitId>.md; a missing file reads as null; bad ids throw', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-nuc-'));
  try {
    assert.equal(readNucleus(smDir, 'proj-abc123', 'auth'), null);
    const n = mergeNucleus(emptyNucleus(), { doing: 'D', decided: ['x'] }, chat(1));
    writeNucleus(smDir, 'proj-abc123', 'auth', n);
    const file = join(smDir, 'brain', 'proj-abc123', 'auth.md');
    assert.ok(existsSync(file));
    assert.match(readFileSync(file, 'utf8'), /^## State/);
    assert.deepEqual(readNucleus(smDir, 'proj-abc123', 'auth'), n);
    assert.throws(() => writeNucleus(smDir, 'proj-abc123', '../x', n));
    assert.throws(() => readNucleus(smDir, 'proj-abc123', 'a/b'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('seedNucleus takes todo and progress from the unit\'s OpenSpec changes and open roadmap items', () => {
  const unit = { id: 'auth', name: 'Autenticação', paths: [] };
  const openspec = [
    { change: 'add-auth-lockout', done: 2, total: 5, todo: ['write lockout', 'test lockout'] },
    { change: 'billing-invoices', done: 0, total: 3, todo: ['unrelated'] },
  ];
  const milestones = [
    { id: '1', title: 'Autenticacao com Google', branch: 'Fase 1', status: 'open', workCellId: null },
    { id: '2', title: 'Autenticação por e-mail', branch: 'Fase 1', status: 'done', workCellId: null },
    { id: '3', title: 'Pagamentos', branch: 'Fase 2', status: 'open', workCellId: null },
  ];
  const n = seedNucleus(unit, { openspec, milestones });
  assert.equal(n.state, 'add-auth-lockout: 2/5 tasks done');
  assert.deepEqual(n.todo, ['write lockout', 'test lockout', 'Autenticacao com Google']);
  assert.deepEqual(n.decided, []);
  assert.deepEqual(n.recent, []);
  assert.deepEqual(seedNucleus({ id: 'zzz', name: 'Zzz', paths: [] }, { openspec, milestones }), emptyNucleus());
  assert.ok(Buffer.byteLength(renderNucleus(seedNucleus(unit, { openspec: [{ change: 'auth', done: 0, total: 99, todo: Array(8).fill('y'.repeat(500)) }], milestones: [] }))) <= NUCLEUS_MAX_BYTES);
});
