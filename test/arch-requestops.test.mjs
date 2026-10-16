import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { applyRequestStatus, requestStatusOp, setRequestStatus } from '../server/arch/requestops.mjs';
import { readCare, writeCare } from '../server/foundation/care.mjs';

// mm27: reviewing a request from the page. Later, Discard (with a reason) and Close (when the work is all done) change only
// the request's Status line and tick; the old status stays after "Before"; the write is one care operation.

const REGISTRY = [
  '# Ideas', '', '## Where in the code', '', '- `docs/architecture/ideas.md`', '', "## What's missing", '',
  '- [ ] A flow you draw `id01`',
  '  - Asked: 2026-10-09 16:20 — "tem que ser um power point"',
  '  - What it means: drag boxes.',
  '  - Where it went: `al01`.',
  '  - Status: accepted.',
  '- [ ] Everything built `id02`',
  '  - Asked: 2026-10-10 10:00 — "terminar tudo"',
  '  - Where it went: `al02`, `al03`.',
  '  - Status: in progress.',
  '- [ ] Make money `id03`',
  '  - Asked: 2026-10-10 11:00 — "dinheiro"',
  '  - Status: later (thinking aloud).',
  '- [x] An old one `id04`',
  '  - Asked: 2026-10-01 11:00 — "velho"',
  '  - Status: done.',
  '- [ ] No status line yet `id05`',
  '  - Asked: 2026-10-12 08:00 — "sem status"',
  '',
  '## Next heading',
  '',
].join('\n');
const ALPHA = ['# Alpha', '', '## Where in the code', '', '- `server/alpha/`', '', "## What's missing", '', '- [ ] Open work `al01`', '- [x] Done work `al02`', '- [x] More done work `al03`', ''].join('\n');
const FILES = { 'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Ideas](ideas.md)\n', 'alpha.md': ALPHA, 'ideas.md': REGISTRY };
const arch = (files = FILES) => parseArch('docs/architecture', files, 'worktree');
const set = (code, to, reason, text = REGISTRY, lang = 'en') => setRequestStatus(text, { code, to, reason, day: '2026-10-16', lang });
const lineAfter = (text, code, label) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trimEnd().endsWith(`\`${code}\``));
  return [lines[at], lines.slice(at + 1).find((l) => l.startsWith(`  - ${label}`))];
};

test('Later rewrites only the status line, keeps the old status after Before, and leaves the box open', () => {
  const out = set('id01', 'later', 'the owner asked to wait');
  assert.equal(out.ok, true);
  assert.deepEqual(lineAfter(out.text, 'id01', 'Status'), ['- [ ] A flow you draw `id01`', '  - Status: later (parked in the review of 2026-10-16: the owner asked to wait). Before: accepted.']);
  assert.equal(out.text.split('\n').length, REGISTRY.split('\n').length, 'no line added or removed');
  assert.equal(out.text.replace(/  - Status: later \(parked[^\n]*/, '  - Status: accepted.'), REGISTRY, 'nothing else changed');
});

test('Discard needs a reason, ticks the box and says why; the words of the owner are untouched', () => {
  assert.deepEqual(set('id01', 'discarded', '   '), { ok: false, error: 'reason-needed' });
  const out = set('id01', 'discarded', 'replaced by the mind map');
  assert.deepEqual(lineAfter(out.text, 'id01', 'Status'), ['- [x] A flow you draw `id01`', '  - Status: discarded (replaced by the mind map; review of 2026-10-16). Before: accepted.']);
  assert.ok(out.text.includes('  - Asked: 2026-10-09 16:20 — "tem que ser um power point"'));
});

test('Close ticks the box and writes the day; an old "Before" is not stacked; a request with no status line gets one', () => {
  const out = set('id02', 'done');
  assert.deepEqual(lineAfter(out.text, 'id02', 'Status'), ['- [x] Everything built `id02`', '  - Status: done on 2026-10-16 (every item it became is done; closed in the review). Before: in progress.']);
  const twice = set('id02', 'later', '', out.text);
  assert.match(lineAfter(twice.text, 'id02', 'Status')[1], /Before: done on 2026-10-16 \(every item it became is done; closed in the review\)\.$/);
  const again = set('id03', 'later', 'again', set('id03', 'later', 'first').text);
  assert.equal((lineAfter(again.text, 'id03', 'Status')[1].match(/Before:/g) ?? []).length, 1);
  const bare = set('id05', 'later', '');
  assert.deepEqual(lineAfter(bare.text, 'id05', 'Status'), ['- [ ] No status line yet `id05`', '  - Status: later (parked in the review of 2026-10-16).']);
  assert.ok(bare.text.indexOf('Status: later (parked in the review of 2026-10-16).') < bare.text.indexOf('## Next heading'), 'it stays in the request block');
});

test('a Portuguese registry gets Portuguese words, and the line endings of the file are kept', () => {
  const pt = REGISTRY.replace('  - Status: accepted.', '  - Situação: aceito.').replaceAll('\n', '\r\n');
  const out = set('id01', 'later', 'esperar', pt, 'pt');
  assert.ok(out.text.includes('  - Situação: depois (guardado na revisão de 2026-10-16: esperar). Antes: aceito.\r\n'));
  assert.equal(out.text.replaceAll('\r\n', '').includes('\n'), false, 'no bare line feed was introduced');
});

test('what cannot be done is refused with its reason', () => {
  assert.deepEqual(set('id99', 'later'), { ok: false, error: 'unknown-request' });
  assert.deepEqual(set('id01', 'dropped'), { ok: false, error: 'bad-status' });
  assert.deepEqual(set('al01', 'later'), { ok: false, error: 'unknown-request' }, 'an item of the map is not a request');
});

function withRepo(fn, { age = 60_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-reqops-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-reqops-sm-'));
  try {
    mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
    for (const [name, text] of Object.entries(FILES)) writeFileSync(join(root, 'docs', 'architecture', name), text);
    const old = new Date(Date.now() - age);
    for (const name of Object.keys(FILES)) utimesSync(join(root, 'docs', 'architecture', name), old, old);
    fn({ root, smDir, file: join(root, 'docs', 'architecture', 'ideas.md'), arch: arch() });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

test('the operation follows the state of the work: Close only when every item is done, nothing for a closed request', () => {
  withRepo(({ root, arch: a }) => {
    assert.equal(requestStatusOp({ root, arch: a, code: 'id02', to: 'done' }).op.files[0].path, 'docs/architecture/ideas.md');
    assert.deepEqual(requestStatusOp({ root, arch: a, code: 'id01', to: 'done' }), { ok: false, error: 'not-finished' });
    assert.deepEqual(requestStatusOp({ root, arch: a, code: 'id04', to: 'later' }), { ok: false, error: 'already-closed' });
    assert.deepEqual(requestStatusOp({ root, arch: a, code: 'id03', to: 'later' }), { ok: true, op: null }, 'already parked: nothing to write');
    assert.deepEqual(requestStatusOp({ root, arch: { ...a, source: 'main-branch' }, code: 'id01', to: 'later' }), { ok: false, error: 'arch-not-here' });
  });
});

test('a registry a chat wrote in the last seconds is not written over', () => {
  withRepo(({ root, arch: a }) => {
    assert.deepEqual(requestStatusOp({ root, arch: a, code: 'id01', to: 'later' }), { ok: false, error: 'busy' });
  }, { age: 500 });
});

test('applied through the care mode: auto writes and records an undo, look writes nothing', () => {
  withRepo(({ root, smDir, file, arch: a }) => {
    const care = { id: 'reqops-abc123', smDir };
    writeCare(smDir, care.id, 'look');
    const looked = applyRequestStatus({ root, arch: a, code: 'id01', to: 'later', reason: 'wait', care });
    assert.equal(looked.changed, false);
    assert.equal(readFileSync(file, 'utf8'), REGISTRY, 'look-only wrote nothing');
    writeCare(smDir, care.id, 'auto');
    assert.equal(readCare(smDir, care.id).mode, 'auto');
    const done = applyRequestStatus({ root, arch: a, code: 'id01', to: 'later', reason: 'wait', care });
    assert.equal(done.changed, true, JSON.stringify(done));
    assert.ok(done.opId);
    assert.match(readFileSync(file, 'utf8'), /Status: later \(parked in the review of \d{4}-\d{2}-\d{2}: wait\)\. Before: accepted\./);
    assert.throws(() => applyRequestStatus({ root, arch: a, code: 'id01', to: 'later', care: {} }), TypeError);
  });
});
