import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../server/foundation/uptodate-lines-ops.mjs';

const NOW = '2026-10-10T12:00:00Z';
const ASKED = 'Asked: 2026-10-10 10:00 — "ship it"';

function ctx(over = {}) {
  const base = {
    now: NOW,
    project: {
      id: 'acme-shop', name: 'acme-shop', root: '/tmp/acme-shop',
      arch: {
        dir: 'docs/architecture',
        parts: [{ id: 'orders', name: 'Orders', file: 'docs/architecture/orders.md', groups: [{ name: 'Core', items: [
          { code: 'ord1', title: 'Orders list', status: 'doing', detail: [] },
          { code: 'req1', title: 'Ana asked for export', status: 'todo', detail: [ASKED, 'Where it went: `ord1`', 'Status: in progress'] },
        ] }] }],
      },
      workCells: [{ id: 'b1', branch: 'feat/x', status: 'active', mergedAt: null, lastCommit: { ts: '2026-10-08T10:00:00Z' }, clashWith: [] }],
      chats: [{ sessionId: 's1', itemCode: 'ord1' }],
      decisions: [],
    },
    census: { files: [
      { path: 'src/orders.ts', kind: 'code', included: true, owner: 'orders', sha: 'aa11' },
      { path: 'test/orders.test.ts', kind: 'test', included: true, owner: 'orders', sha: 'bb22' },
    ] },
    health: { items: [{ id: 'quality.ci-tests', state: 'pass', evidence: [{ file: '.github/workflows/ci.yml', line: 3, sha: 'cc33' }] }] },
    versions: { code: { version: '1.0.0' }, pieces: [{ name: 'next', version: '16.0.1', file: 'package.json', line: 12, sha: 'dd44', warning: null, verified: true, reason: null }] },
    inspection: null, docs: [], localeFiles: [],
    git: { uncommitted: [], ahead: 0 },
  };
  return { ...base, ...over, project: { ...base.project, ...(over.project ?? {}) } };
}
const run = (id, c) => LINES.find((l) => l.id === id).run(c);

test('catalog has the 15 lines of groups 5 to 8 with unique ids', () => {
  assert.equal(LINES.length, 15);
  assert.equal(new Set(LINES.map((l) => l.id)).size, 15);
  for (const l of LINES) { assert.ok([5, 6, 7, 8].includes(l.group)); assert.equal(typeof l.run, 'function'); }
});

test('everything right: each checkable line is confirmed with evidence, the rest unverified with a reason', () => {
  const unverified = { 'g5.inspection': 'no-data', 'g5.i18n': 'not-applicable', 'g6.dep-licenses': 'no-data', 'g6.dep-vulns': 'no-data', 'g7.issues': 'no-token' };
  for (const l of LINES) {
    const r = l.run(ctx());
    if (unverified[l.id]) { assert.equal(r.state, 'unverified', l.id); assert.equal(r.reason, unverified[l.id], l.id); } else {
      assert.equal(r.state, 'confirmed', `${l.id} ${JSON.stringify(r)}`);
      assert.ok(r.evidence.length > 0, l.id);
    }
    assert.ok(Array.isArray(r.findingIds));
  }
});

test('null inputs give unverified/no-data', () => {
  const nul = ctx({ census: null, health: null, versions: null, git: null });
  for (const id of ['g5.tests-exist', 'g5.tests-passing', 'g6.dep-versions', 'g6.dep-vulns', 'g6.dep-licenses', 'g7.uncommitted', 'g7.unpushed']) {
    const r = run(id, nul);
    assert.equal(r.state, 'unverified', id);
    assert.equal(r.reason, 'no-data', id);
  }
});

test('g5.tests-exist warns for a part with code and no test', () => {
  const c = ctx({ census: { files: [{ path: 'src/orders.ts', kind: 'code', included: true, owner: 'orders', sha: 'aa11' }] } });
  const r = run('g5.tests-exist', c);
  assert.equal(r.state, 'warning');
  assert.match(r.detail, /orders/);
  assert.equal(r.evidence[0].file, 'src/orders.ts');
});

test('g5.tests-passing follows the CI state and never guesses', () => {
  const fail = ctx({ health: { items: [{ id: 'quality.ci-tests', state: 'fail', evidence: [{ file: '.github/workflows/ci.yml', line: 3, sha: 'cc33' }] }] } });
  assert.equal(run('g5.tests-passing', fail).state, 'warning');
  const noTok = ctx({ health: { items: [{ id: 'quality.ci-tests', state: 'unverified', reason: 'no-token', evidence: [] }] } });
  const r = run('g5.tests-passing', noTok);
  assert.deepEqual([r.state, r.reason], ['unverified', 'no-token']);
  assert.equal(run('g5.tests-passing', ctx({ health: { items: [] } })).reason, 'no-data');
});

test('g5.i18n warns when languages have different keys', () => {
  const files = (b) => [{ path: 'locales/en.json', text: JSON.stringify({ a: 1, nested: { b: 2 } }) }, { path: 'locales/pt.json', text: JSON.stringify(b) }];
  const census = { files: [{ path: 'locales/en.json', kind: 'code', included: true, sha: 'e1' }, { path: 'locales/pt.json', kind: 'code', included: true, sha: 'e2' }] };
  assert.equal(run('g5.i18n', ctx({ census, localeFiles: files({ a: 1, nested: { b: 2 } }) })).state, 'confirmed');
  const bad = run('g5.i18n', ctx({ census, localeFiles: files({ a: 1 }) }));
  assert.equal(bad.state, 'warning');
  assert.match(bad.detail, /nested\.b/);
});

test('g6 lines warn only from a consulted source', () => {
  const piece = (warning) => ({ name: 'left-pad', version: '1.0.0', file: 'package.json', line: 5, sha: 'dd44', warning, verified: true, reason: null });
  assert.equal(run('g6.dep-versions', ctx({ versions: { pieces: [piece('outdated')] } })).state, 'warning');
  assert.equal(run('g6.dep-vulns', ctx({ versions: { pieces: [piece('vulnerable')] } })).state, 'warning');
  assert.equal(run('g6.dep-licenses', ctx({ versions: { pieces: [piece('license')] } })).state, 'warning');
  const unchecked = { name: 'x', version: '1', file: 'package.json', line: 1, warning: 'outdated', verified: false, reason: 'no-network' };
  const r = run('g6.dep-versions', ctx({ versions: { pieces: [unchecked] } }));
  assert.deepEqual([r.state, r.reason], ['unverified', 'no-network']);
});

test('g7 git lines', () => {
  assert.equal(run('g7.uncommitted', ctx({ git: { uncommitted: [{ path: 'a.js' }], ahead: 0 } })).state, 'warning');
  assert.equal(run('g7.unpushed', ctx({ git: { uncommitted: [], ahead: 2 } })).state, 'warning');
  const merged = { id: 'b2', branch: 'feat/old', status: 'merged', mergedAt: '2026-09-01T00:00:00Z', lastCommit: { ts: '2026-08-30T00:00:00Z' }, clashWith: [] };
  const r = run('g7.branches', ctx({ project: { workCells: [merged] } }));
  assert.equal(r.state, 'warning');
  assert.match(r.detail, /feat\/old/);
  const stale = { id: 'b3', branch: 'feat/idle', status: 'idle', mergedAt: null, lastCommit: { ts: '2026-09-20T00:00:00Z' }, clashWith: [] };
  assert.equal(run('g7.branches', ctx({ project: { workCells: [stale] } })).state, 'warning');
  const clash = { id: 'b4', branch: 'feat/c', status: 'active', mergedAt: null, lastCommit: { ts: NOW }, clashWith: ['b1'] };
  assert.equal(run('g7.clashes', ctx({ project: { workCells: [clash] } })).state, 'warning');
});

test('g7.board-items warns for a conversation pointing at a missing item', () => {
  const r = run('g7.board-items', ctx({ project: { chats: [{ sessionId: 's1', itemCode: 'zz9' }] } }));
  assert.equal(r.state, 'warning');
  assert.match(r.detail, /zz9/);
});

test('g8.decisions-unwritten', () => {
  const dec = [{ kind: 'decision', text: 'Choose the payment provider', projectId: 'acme-shop' }];
  const r = run('g8.decisions-unwritten', ctx({ project: { decisions: dec } }));
  assert.equal(r.state, 'warning');
  const written = ctx({ project: { decisions: dec }, docs: [{ path: 'docs/architecture/decisions.md', text: 'We settled: Choose the payment provider later.' }] });
  assert.equal(run('g8.decisions-unwritten', written).state, 'confirmed');
});

test('g8.requests-no-item lists the codes of a request left without an item', () => {
  const part = { id: 'orders', name: 'Orders', file: 'docs/architecture/orders.md', groups: [{ name: 'Core', items: [
    { code: 'req2', title: 'Ana wants a report', status: 'todo', detail: [ASKED, 'Status: planned'] },
  ] }] };
  const bad = run('g8.requests-no-item', ctx({ project: { arch: { dir: 'docs/architecture', parts: [part] } } }));
  assert.equal(bad.state, 'warning');
  assert.match(bad.detail, /req2/);
  part.groups[0].items.push({ code: 'ord2', title: 'Report', status: 'doing', detail: [] });
  part.groups[0].items[0].detail.push('Where it went: `ord2`');
  assert.equal(run('g8.requests-no-item', ctx({ project: { arch: { dir: 'docs/architecture', parts: [part] } } })).state, 'confirmed');
});
