import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parentOf, readLineage, recordLineage, specRefsOf, linkUnits } from '../server/brain/lineage.mjs';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

test('recordLineage/readLineage persist child -> parent in smDir/lineage.json; missing file reads as {}', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-lin-'));
  try {
    assert.deepEqual(readLineage(smDir), {});
    recordLineage(smDir, UUID_B, UUID_A);
    assert.deepEqual(readLineage(smDir), { [UUID_B]: UUID_A });
    assert.throws(() => recordLineage(smDir, UUID_A, UUID_A), /itself/);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

const inCell = [
  { sessionId: 'a', startedAt: '2026-10-01T10:00:00Z', editedFiles: ['x.ts', 'y.ts'] },
  { sessionId: 'b', startedAt: '2026-10-02T10:00:00Z', editedFiles: ['z.ts'] },
  { sessionId: 'c', startedAt: '2026-10-03T10:00:00Z', editedFiles: ['y.ts'] },
  { sessionId: 'd', startedAt: '2026-10-04T10:00:00Z', editedFiles: ['x.ts', 'y.ts'] },
];

test('parentOf: the recorded lineage wins', () => {
  assert.equal(parentOf('d', { d: 'elsewhere' }, inCell), 'elsewhere');
});

test('parentOf: otherwise the closest earlier chat of the unit that edited a common file', () => {
  assert.equal(parentOf('d', {}, inCell), 'c');
  assert.equal(parentOf('c', {}, inCell), 'a', 'b shares nothing with c');
});

test('parentOf: null without lineage, shared files, an earlier chat or a known session', () => {
  assert.equal(parentOf('a', {}, inCell), null, 'first chat');
  assert.equal(parentOf('b', {}, inCell), null, 'no common file');
  assert.equal(parentOf('ghost', {}, inCell), null);
  assert.equal(parentOf('d', { d: 'd' }, inCell.slice(0, 3)), null, 'a chat is never its own parent');
});

function specs(root, files) {
  for (const [unit, md] of Object.entries(files)) {
    const dir = join(root, 'openspec', 'specs', unit);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), md);
  }
}

test('specRefsOf finds units named in another unit\'s spec.md, never itself, ignoring very short names', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-spec-'));
  try {
    specs(root, {
      auth: 'Login needs the Pagamentos limits and its own autenticacao rules.',
      payments: 'Charges are blocked by auth when the account is locked.',
      ui: 'The ui of everything.',
      notes: 'mentions only authentic stuff',
    });
    const units = [
      { id: 'auth', name: 'Autenticação', paths: [] },
      { id: 'payments', name: 'Pagamentos', paths: [] },
      { id: 'ui', name: 'ui', paths: [] },
      { id: 'notes', name: 'Notes', paths: [] },
    ];
    const refs = specRefsOf(root, units).map((r) => `${r.from}>${r.to}`).sort();
    assert.deepEqual(refs, ['auth>payments', 'payments>auth']);
    assert.ok(specRefsOf(root, units).every((r) => !Number.isNaN(Date.parse(r.since))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const units = [
  { id: 'auth', name: 'Auth', paths: ['apps/web/login'] },
  { id: 'pay', name: 'Pay', paths: ['packages/pay'] },
  { id: 'ui', name: 'UI', paths: ['apps/web/ui'] },
  { id: 'unsorted', name: 'Unsorted', paths: [] },
];
const chat = (sessionId, unitId, extra = {}) => ({
  sessionId, unitId, title: `Title ${sessionId}`, startedAt: '2026-10-05T10:00:00Z', parentId: null, workCellId: null, editedFiles: [], ...extra,
});

test('linkUnits: a chat that edited files of two units is a shared-chat link, weight 1', () => {
  const links = linkUnits([chat('c1', 'auth', { editedFiles: ['apps/web/login/a.ts', 'packages/pay/b.ts'] })], units, [], []);
  assert.equal(links.length, 1);
  assert.deepEqual([links[0].a, links[0].b, links[0].weight, links[0].since], ['auth', 'pay', 1, '2026-10-05T10:00:00Z']);
  assert.deepEqual(links[0].reasons, [{ kind: 'shared-chat', text: 'Title c1', sessionId: 'c1' }]);
});

test('linkUnits: shared-branch (work cell with chats in two units) and lineage (parent chat in another unit)', () => {
  const chats = [
    chat('c1', 'auth', { workCellId: 'feature/x', startedAt: '2026-10-03T10:00:00Z' }),
    chat('c2', 'pay', { workCellId: 'feature/x', startedAt: '2026-10-04T10:00:00Z', parentId: 'c1' }),
  ];
  const workCells = [{ id: 'feature/x', branch: 'feature/x', chatIds: ['c1', 'c2'], bornAt: '2026-10-02T10:00:00Z' }];
  const [link] = linkUnits(chats, units, workCells, []);
  assert.deepEqual([link.a, link.b, link.weight], ['auth', 'pay', 2]);
  assert.deepEqual(link.reasons.map((r) => r.kind).sort(), ['lineage', 'shared-branch']);
  assert.equal(link.since, '2026-10-02T10:00:00Z', 'the earliest reason dates the link');
  assert.equal(link.reasons.find((r) => r.kind === 'lineage').sessionId, 'c2');
});

test('linkUnits: spec-ref adds a reason; weight is the reason count capped at 4; strongest first', () => {
  const edits = ['apps/web/login/a.ts', 'packages/pay/b.ts'];
  const chats = ['c1', 'c2', 'c3'].map((id) => chat(id, 'auth', { editedFiles: edits }));
  const links = linkUnits(chats, units, [], [{ from: 'pay', to: 'auth', since: '2026-09-01T00:00:00Z' }, { from: 'ui', to: 'pay', since: '2026-09-02T00:00:00Z' }]);
  assert.deepEqual(links.map((l) => [l.a, l.b, l.weight]), [['auth', 'pay', 4], ['pay', 'ui', 1]]);
  assert.equal(links[0].since, '2026-09-01T00:00:00Z');
  assert.deepEqual(links[1].reasons.map((r) => r.kind), ['spec-ref']);
  const many = Array.from({ length: 6 }, (_, i) => chat(`m${i}`, 'auth', { editedFiles: edits }));
  assert.equal(linkUnits(many, units, [], [])[0].weight, 4);
});

test('linkUnits ignores unsorted, unknown units, self links and a chat in the same unit as its parent', () => {
  const chats = [
    chat('c1', 'auth', { editedFiles: ['apps/web/login/a.ts', 'apps/web/login/b.ts'] }),
    chat('c2', 'unsorted', { editedFiles: ['apps/web/login/a.ts'], parentId: 'c1' }),
    chat('c3', 'auth', { parentId: 'c1' }),
  ];
  assert.deepEqual(linkUnits(chats, units, [], [{ from: 'auth', to: 'ghost', since: '2026-10-01T00:00:00Z' }, { from: 'auth', to: 'auth', since: '2026-10-01T00:00:00Z' }]), []);
});

test('linkUnits makes absolute edited files relative to root', () => {
  const links = linkUnits([chat('c1', 'auth', { editedFiles: ['C:\\Dev\\Proj\\apps\\web\\login\\a.ts', 'C:\\Dev\\Proj\\packages\\pay\\b.ts'] })], units, [], [], { root: 'c:/dev/proj' });
  assert.equal(links.length, 1);
});

test('specRefsOf skips units whose id is not a plain slug instead of reading outside openspec/specs', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-spec-'));
  try {
    specs(root, { payments: 'Charges are blocked by auth.' });
    mkdirSync(join(root, 'openspec', 'outside'), { recursive: true });
    writeFileSync(join(root, 'openspec', 'outside', 'spec.md'), 'mentions payments here');
    const units = [
      { id: '../outside', name: 'Outside', paths: [] },
      { id: 'payments', name: 'Payments', paths: [] },
    ];
    assert.deepEqual(specRefsOf(root, units).map((r) => `${r.from}>${r.to}`), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
