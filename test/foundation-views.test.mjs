import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceOf, mermaidOf, journeyMermaid, mapTreeOf } from '../server/foundation/views.mjs';
import { buildModel } from '../server/foundation/model.mjs';
import { refreshFoundation, readStep } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { loadConfig } from '../server/config.mjs';
import { parseFlow } from '../server/web/flow.js';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// Block 2, B2-T6: the views of the single model. One level at a time under a focus, at most 12 boxes per parent with the
// rest as "+N more", arrows that leave the cut gathered on the parent, the breadcrumb, a search that gives the way to a
// box, Mermaid for export (it must reopen in the Flow tab's parser) and a journey as a numbered sequence diagram.

const ev = (file, line = 1) => ({ file, line, sha: `sha-${file}` });
const mk = (id, level, kind, name, parentId, extra = {}) => ({ id, level, kind, name, parentId, origin: 'EXTRACTED', evidence: [ev(`${id}.ts`)], hash: `h-${id}`, ...extra });
const edge = (from, to, kind, params = {}, extra = {}) => ({
  id: `${from}->${to}:${kind}`, from, to, kind, label: { msg: `edge.${kind}`, params }, origin: 'EXTRACTED', evidence: [ev(`${from}.ts`, 3)], hash: `h-${from}-${to}-${kind}`, ...extra,
});
const ids = (list) => list.map((x) => x.id);
const t = (msg, params = {}) => `${msg}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`;

// sys > api (20 components, some wired), web (2 components); a person and two externals
function synthetic() {
  const nodes = [
    mk('sys', 1, 'system', 'acme', null),
    mk('person:ana', 1, 'person', 'Ana', null),
    mk('ext:stripe', 1, 'external', 'stripe', null),
    mk('ext:db', 1, 'external', 'database', null),
    mk('ctr:api', 2, 'container', 'api', 'sys'),
    mk('ctr:web', 2, 'container', 'web', 'sys'),
    mk('cmp:web/pages', 3, 'component', 'pages', 'ctr:web', { partId: 'web' }),
    mk('cmp:web/lib', 3, 'component', 'lib', 'ctr:web', { partId: 'web' }),
  ];
  for (let i = 1; i <= 20; i++) nodes.push(mk(`cmp:api/c${String(i).padStart(2, '0')}`, 3, 'component', `c${String(i).padStart(2, '0')}`, 'ctr:api', { partId: i <= 10 ? 'orders' : null }));
  nodes.push(mk('fn:api/c01.ts#run', 4, 'function', 'run', 'cmp:api/c01'), mk('fn:api/c02.ts#save', 4, 'function', 'save', 'cmp:api/c02'));
  const edges = [
    edge('person:ana', 'ctr:web', 'uses', { via: 'screens', count: 2 }),
    edge('ctr:api', 'ext:stripe', 'uses', { via: 'sdk', name: 'stripe' }),
    edge('ctr:api', 'ext:db', 'uses', { via: 'db' }),
    edge('cmp:web/pages', 'cmp:api/c01', 'imports', { count: 2 }),
    edge('cmp:web/lib', 'cmp:api/c02', 'imports', { count: 1 }),
    edge('cmp:api/c01', 'cmp:api/c02', 'imports', { count: 4 }),
    edge('cmp:api/c20', 'cmp:api/c01', 'imports', { count: 1 }),
    edge('cmp:api/c19', 'cmp:api/c01', 'imports', { count: 1 }),
    edge('fn:api/c01.ts#run', 'fn:api/c02.ts#save', 'calls', { callee: 'save' }),
  ];
  return { version: 1, nodes, edges, journeys: [], draft: { nodes: [], edges: [] }, stale: [] };
}

test('a part with 20 components shows 12 boxes and says "+8 more", keeping the most connected ones', () => {
  const s = sliceOf(synthetic(), { level: 3, focus: 'ctr:api' });
  const shown = s.nodes.filter((n) => !n.outside).map((n) => n.id);
  assert.equal(shown.length, 12);
  assert.deepEqual(s.more, { 'ctr:api': 8 });
  for (const id of ['cmp:api/c01', 'cmp:api/c02', 'cmp:api/c19', 'cmp:api/c20']) assert.ok(shown.includes(id), id);
  assert.deepEqual(shown, [...shown].sort());
  const all = sliceOf(synthetic(), { level: 3, focus: 'ctr:api', max: 20 });
  assert.equal(all.nodes.filter((n) => !n.outside).length, 20);
  assert.deepEqual(all.more, {});
});

test('the breadcrumb is Project > Part > Component at each level', () => {
  const m = synthetic();
  const crumbs = (o) => sliceOf(m, o).breadcrumb.map((c) => `${c.level}:${c.name}`);
  assert.deepEqual(crumbs({ level: 1 }), ['1:acme']);
  assert.deepEqual(crumbs({ level: 2, focus: 'sys' }), ['1:acme']);
  assert.deepEqual(crumbs({ level: 3, focus: 'ctr:api' }), ['1:acme', '2:api']);
  assert.deepEqual(crumbs({ level: 4, focus: 'cmp:api/c01' }), ['1:acme', '2:api', '3:c01']);
  assert.deepEqual(sliceOf(m, { level: 4, focus: 'cmp:api/c01' }).breadcrumb.map((c) => c.id), ['sys', 'ctr:api', 'cmp:api/c01']);
  // without a level the next one down from the focus is shown
  assert.equal(sliceOf(m, { focus: 'ctr:web' }).level, 3);
  assert.deepEqual(ids(sliceOf(m, { focus: 'ctr:web' }).nodes.filter((n) => !n.outside)), ['cmp:web/lib', 'cmp:web/pages']);
});

test('an arrow that leaves the cut is gathered on the parent of the other end', () => {
  const s = sliceOf(synthetic(), { level: 3, focus: 'ctr:api' });
  // both web components import api components: the arrows start at the container web
  const out = s.edges.filter((e) => e.from === 'ctr:web');
  assert.deepEqual(ids(out), ['ctr:web->cmp:api/c01:imports', 'ctr:web->cmp:api/c02:imports']);
  assert.equal(s.nodes.find((n) => n.id === 'ctr:web').outside, true);
  assert.deepEqual(out[0].members, ['cmp:web/pages->cmp:api/c01:imports']);
  assert.deepEqual(out[0].label, { msg: 'edge.imports', params: { count: 2 } });
  // the container's own arrows (api -> stripe) belong to level 2, not to its components
  assert.ok(!s.edges.some((e) => e.to === 'ext:stripe' || e.to === 'ext:db'));
  // inside arrows stay as they were
  assert.ok(ids(s.edges).includes('cmp:api/c01->cmp:api/c02:imports'));
  // and the two ends of every arrow are boxes of the slice
  const have = new Set(ids(s.nodes));
  for (const e of s.edges) assert.ok(have.has(e.from) && have.has(e.to), e.id);
});

test('arrows lifted onto the same pair and kind are one arrow: the sum of files for imports, a group label for the rest', () => {
  const m = synthetic();
  const s2 = sliceOf(m, { level: 2, focus: 'sys' });
  const imp = s2.edges.find((e) => e.id === 'ctr:web->ctr:api:imports');
  assert.deepEqual(imp.label, { msg: 'edge.imports', params: { count: 3 } });
  assert.deepEqual(imp.members, ['cmp:web/lib->cmp:api/c02:imports', 'cmp:web/pages->cmp:api/c01:imports']);
  assert.equal(imp.lifted, true);
  assert.ok(imp.evidence.length === 2 && imp.hash);
  // within api there is no self-loop
  assert.ok(!s2.edges.some((e) => e.from === e.to));
  // persons and externals are the outside neighbours of the containers
  assert.deepEqual(ids(s2.nodes.filter((n) => n.outside)), ['ext:db', 'ext:stripe', 'person:ana']);
  // two different arrows between the same lifted ends: a group label
  m.edges.push(edge('cmp:api/c03', 'ext:stripe', 'uses', { via: 'url', name: 'stripe' }));
  const grp = sliceOf(m, { level: 1 }).edges.find((e) => e.id === 'sys->ext:stripe:uses');
  assert.deepEqual(grp.label, { msg: 'edge.group', params: { kind: 'uses', count: 2 } });
  assert.equal(grp.origin, 'EXTRACTED');
});

test('level 1 shows the system, the people and the outside; their arrows are gathered on the system', () => {
  const s = sliceOf(synthetic(), { level: 1 });
  assert.deepEqual(ids(s.nodes), ['ext:db', 'ext:stripe', 'person:ana', 'sys']);
  assert.deepEqual(ids(s.edges), ['person:ana->sys:uses', 'sys->ext:db:uses', 'sys->ext:stripe:uses']);
  assert.deepEqual(s.edges[1].label, { msg: 'edge.uses', params: { via: 'db' } });
});

test('a hidden box or arrow is out of the drawing, not out of the model', () => {
  const m = synthetic();
  m.nodes.find((n) => n.id === 'cmp:api/c02').hidden = true;
  m.edges.find((e) => e.id === 'cmp:api/c20->cmp:api/c01:imports').hidden = true;
  const s = sliceOf(m, { level: 3, focus: 'ctr:api', max: 30 });
  assert.ok(!ids(s.nodes).includes('cmp:api/c02'));
  assert.ok(!ids(s.edges).some((id) => id.includes('c02') || id.includes('c20->')));
  assert.ok(m.nodes.some((n) => n.id === 'cmp:api/c02'), 'the model keeps it');
});

test('the search gives the way to a box, to jump straight to it', () => {
  const m = synthetic();
  const s = sliceOf(m, { level: 3, focus: 'ctr:api', search: 'SAVE' });
  assert.deepEqual(s.found.map((f) => f.id), ['fn:api/c02.ts#save']);
  assert.deepEqual(s.found[0].breadcrumb.map((c) => c.name), ['acme', 'api', 'c02']);
  assert.deepEqual(s.found[0].jump, { level: 4, focus: 'cmp:api/c02' });
  // under a focus the search looks only below it; a box cut off by the limit is still found and takes a place among the 12
  const c17 = sliceOf(m, { level: 3, focus: 'ctr:api', search: 'c17' });
  assert.deepEqual(c17.found.map((f) => f.id), ['cmp:api/c17']);
  assert.ok(ids(c17.nodes).includes('cmp:api/c17'));
  assert.deepEqual(sliceOf(m, { level: 3, focus: 'ctr:web', search: 'c17' }).found, []);
  assert.deepEqual(sliceOf(m, { level: 2, focus: 'sys' }).found, []);
});

test('claims of the cut come with the out-of-date ones named, journeys through its arrows, and the draft passes through', () => {
  const m = synthetic();
  m.stale = ['claim:b'];
  m.nodes.find((n) => n.id === 'cmp:api/c19').evidence[0].factId = 'fact:c19';
  m.journeys = [
    { id: 'j:a', name: 'A', origin: 'INFERRED', steps: [{ n: 1, edgeId: 'cmp:api/c01->cmp:api/c02:imports', note: null }] },
    { id: 'j:z', name: 'Z', origin: 'INFERRED', steps: [{ n: 1, edgeId: 'person:ana->ctr:web:uses', note: null }] },
  ];
  m.draft = { nodes: [{ id: 'dn:box', kind: 'note', name: 'Box', origin: 'DECLARED' }], edges: [] };
  const claims = [
    { id: 'claim:a', about: 'cmp:api/c01', type: 'explain' },
    { id: 'claim:b', about: 'cmp:api/c02', type: 'explain' },
    { id: 'claim:c', about: 'cmp:web/lib', type: 'explain' },
    { id: 'claim:d', about: 'cmp:api/c01->cmp:api/c02:imports', type: 'explain' },
    { id: 'claim:e', about: 'fact:c19', type: 'fact' },
  ];
  const s = sliceOf(m, { level: 3, focus: 'ctr:api', claims });
  assert.deepEqual(ids(s.claims), ['claim:a', 'claim:b', 'claim:d', 'claim:e']);
  assert.deepEqual(s.stale, ['claim:b']);
  assert.deepEqual(ids(s.journeys), ['j:a']);
  assert.deepEqual(s.draft, m.draft);
  assert.deepEqual(sliceOf(m, { level: 3, focus: 'ctr:api' }).claims, []);
});

test('the same model gives the same slice, and the model is not touched', () => {
  const m = synthetic();
  const frozen = JSON.stringify(m);
  const a = JSON.stringify(sliceOf(m, { level: 2, focus: 'sys' }));
  assert.equal(JSON.stringify(sliceOf(JSON.parse(frozen), { level: 2, focus: 'sys' })), a);
  sliceOf(m, { level: 3, focus: 'ctr:api', search: 'c0' });
  assert.equal(JSON.stringify(m), frozen);
  // an unknown focus is an empty slice, not an error
  const none = sliceOf(m, { level: 3, focus: 'ctr:nope' });
  assert.deepEqual([none.nodes, none.edges, none.breadcrumb], [[], [], []]);
});

// ---------- Mermaid ----------

test('the Mermaid of a slice reopens in the Flow tab parser without losing a box or an arrow, with labels through t', () => {
  const m = synthetic();
  const odd = 'say "hi" (a) [b] `c`';
  m.nodes.find((n) => n.id === 'cmp:api/c01').name = odd;
  const s = sliceOf(m, { level: 3, focus: 'ctr:api' });
  const text = mermaidOf(s, t);
  assert.match(text, /^flowchart /);
  const flow = parseFlow(text);
  assert.equal(flow.ok, true);
  assert.deepEqual(flow.warnings, []);
  assert.equal(flow.nodes.length, s.nodes.length);
  assert.equal(flow.edges.length, s.edges.length);
  assert.deepEqual(flow.nodes.map((n) => n.label).sort(), s.nodes.map((n) => n.name).sort());
  assert.deepEqual(flow.edges.map((e) => e.label).sort(), s.edges.map((e) => t(e.label.msg, e.label.params)).sort());
  // every arrow joins the boxes of its ends
  const byLabel = new Map(flow.nodes.map((n) => [n.label, n.id]));
  const pair = flow.edges.find((e) => e.label === t('edge.imports', { count: 4 }));
  assert.equal(pair.from, byLabel.get(odd));
  assert.equal(pair.to, byLabel.get('c02'));
  assert.equal(mermaidOf(s, t), text, 'same slice, same text');
});

test('Mermaid keeps working with a bar in a label, and without t falls back to the message key', () => {
  const s = sliceOf(synthetic(), { level: 1 });
  s.edges[0] = { ...s.edges[0], label: { msg: 'a|b', params: {} } };
  const flow = parseFlow(mermaidOf(s, (msg) => msg));
  assert.equal(flow.ok, true);
  assert.equal(flow.edges.length, s.edges.length);
  assert.ok(parseFlow(mermaidOf(s)).edges.every((e) => e.label));
  assert.equal(parseFlow(mermaidOf({ nodes: [], edges: [] })).ok, true);
});

// ---------- journeys ----------

test('a journey becomes a sequence diagram with steps 1 to n in order', () => {
  const m = synthetic();
  m.journeys = [{
    id: 'j:buy', name: 'Buy; "now" #1', origin: 'INFERRED', steps: [
      { n: 1, edgeId: 'person:ana->ctr:web:uses', note: null },
      { n: 2, edgeId: 'cmp:web/pages->cmp:api/c01:imports', note: 'asks; then waits #ok' },
      { n: 3, edgeId: 'ctr:api->ext:stripe:uses', note: null },
    ],
  }];
  const text = journeyMermaid(m, 'j:buy', t);
  const lines = text.split('\n');
  assert.equal(lines[0], 'sequenceDiagram');
  assert.deepEqual(lines.filter((l) => l.trim().startsWith('participant')).map((l) => l.trim().replace(/^participant p\d+ as /, '')), ['Ana', 'web', 'pages', 'c01', 'api', 'stripe']);
  const msgs = lines.filter((l) => /->>/.test(l));
  assert.equal(msgs.length, 3);
  assert.match(msgs[0], /^\s*p1->>p2: 1\. edge\.uses/);
  assert.match(msgs[1], /^\s*p3->>p4: 2\. edge\.imports/);
  assert.match(msgs[2], /^\s*p5->>p6: 3\. edge\.uses/);
  assert.ok(lines.some((l) => /Note right of p4: asks, then waits ok/.test(l)), text);
  assert.ok(!/[;#]/.test(text.replace(/^%%.*$/gm, '')), 'no character that Mermaid reads as syntax');
  assert.equal(journeyMermaid(m, 'j:nope', t), null);
  // an edge that vanished is skipped, the numbering stays the journey's
  m.edges = m.edges.filter((e) => e.kind !== 'imports');
  const gap = journeyMermaid(m, 'j:buy', t);
  assert.ok(!gap.includes('2. '));
  assert.ok(gap.includes('3. '));
});

// ---------- map tree ----------

test('the tree for the map is parts, then their components; a part with no component stays, a component with no part is apart', () => {
  const m = synthetic();
  const tree = mapTreeOf(m, { parts: [{ id: 'orders', name: 'Orders' }, { id: 'web', name: 'Web' }, { id: 'billing', name: 'Billing' }] });
  assert.deepEqual(tree.parts.map((p) => [p.id, p.name, p.components.length]), [['billing', 'Billing', 0], ['orders', 'Orders', 10], ['web', 'Web', 2]]);
  assert.deepEqual(tree.parts.find((p) => p.id === 'web').components.map((c) => c.id), ['cmp:web/lib', 'cmp:web/pages']);
  const c = tree.parts.find((p) => p.id === 'orders').components.find((x) => x.id === 'cmp:api/c01');
  assert.deepEqual(c, { id: 'cmp:api/c01', name: 'c01', containerId: 'ctr:api', containerName: 'api', tech: null, functions: 1 });
  assert.equal(tree.unowned.length, 10);
  // a component shared by two parts (AMBIGUOUS) is under the first and says the other
  m.nodes.find((n) => n.id === 'cmp:web/lib').attrs = { parts: ['orders', 'web'] };
  const shared = mapTreeOf(m).parts.find((p) => p.id === 'web').components.find((x) => x.id === 'cmp:web/lib');
  assert.deepEqual(shared.alsoParts, ['orders']);
});

// ---------- on a real fixture ----------

test('on the acme-shop fixture every level has a slice whose arrows end on its boxes, and the Mermaid reopens', async () => {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdviews-'));
  const id = 'acme-shop-0a0b0c';
  try {
    const out = await refreshFoundation({ id, name: 'acme-shop', root }, smDir, { steps: [readStep()] });
    assert.ok(out.steps?.[0]?.ok, JSON.stringify(out));
    const arch = await readArch(root, loadConfig(root, smDir), { mainBranch: 'main' });
    const lines = (path) => readFileSync(join(root, path), 'utf8').split('\n');
    const model = buildModel(readFd(smDir, id, 'facts.json'), readFd(smDir, id, 'census.json'), arch, {}, { name: 'acme-shop', level4: true, linesOf: lines });
    const slices = [{ level: 1 }, { level: 2, focus: 'sys' }, { level: 3, focus: 'ctr:apps/api' }, { level: 4, focus: 'cmp:apps/api/src/services' }];
    for (const q of slices) {
      const s = sliceOf(model, q);
      assert.ok(s.nodes.length > 0, JSON.stringify(q));
      const have = new Set(ids(s.nodes));
      for (const e of s.edges) assert.ok(have.has(e.from) && have.has(e.to), `${JSON.stringify(q)} ${e.id}`);
      const flow = parseFlow(mermaidOf(s, t));
      assert.equal(flow.nodes.length, s.nodes.length, JSON.stringify(q));
      assert.equal(flow.edges.length, s.edges.length, JSON.stringify(q));
    }
    const s2 = sliceOf(model, { level: 2, focus: 'sys' });
    assert.ok(ids(s2.edges).includes('ctr:packages/adapters->ext:stripe:uses'));
    assert.ok(mapTreeOf(model, arch).parts.length > 0);
  } finally { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); }
});
