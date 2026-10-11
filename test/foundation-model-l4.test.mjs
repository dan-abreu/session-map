import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel, validateJourneys, applyOverrides, markStale } from '../server/foundation/model.mjs';
import { checkAll, vocabularyOf } from '../server/foundation/evidence-check.mjs';
import { refreshFoundation, readStep } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { loadConfig } from '../server/config.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// Block 2, B2-T5: level 4 (functions and the calls between them), journeys checked against the edges, the owner's
// drawing (overrides: DECLARED only where the part is in the .md, the rest a draft) and claims out of date by hash.

const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const fileLines = (root) => (path) => {
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

async function readFixture(name, before = () => {}) {
  const root = copyFixtureRepo(name);
  before(root);
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdl4-'));
  const id = `${name}-0a0b0c`;
  let t = Date.now();
  const read = async () => {
    const out = await refreshFoundation({ id, name, root }, smDir, { steps: [readStep()], now: () => (t += 60_000) });
    assert.ok(out.steps?.[0]?.ok, JSON.stringify(out));
    const arch = await readArch(root, loadConfig(root, smDir), { mainBranch: 'main' });
    return { census: readFd(smDir, id, 'census.json'), facts: readFd(smDir, id, 'facts.json'), arch };
  };
  return { root, name, read, ...(await read()), done: () => { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
}

const build = (fx, over = {}, opts = {}) => buildModel(over.facts ?? fx.facts, over.census ?? fx.census, over.arch ?? fx.arch, over.overrides ?? {},
  { name: fx.name, linesOf: fileLines(fx.root), level4: true, ...opts });

// ---------- level 4 on the fixtures ----------

test('level 4: every function fact of the code is a node under the component of its file, and only the sure calls are arrows', async () => {
  const fx = await readFixture('acme-shop');
  try {
    const model = build(fx);
    const fns = model.nodes.filter((n) => n.level === 4);
    const want = fx.facts.facts.filter((f) => f.kind === 'function').map((f) => f.id).sort();
    assert.deepEqual(fns.map((n) => n.id), want);
    const place = model.nodes.find((n) => n.id === 'fn:apps/api/src/services/orders.ts#placeOrder');
    assert.equal(place.kind, 'function');
    assert.equal(place.parentId, 'cmp:apps/api/src/services');
    assert.equal(place.name, 'placeOrder');
    assert.equal(place.origin, 'EXTRACTED');
    assert.deepEqual(place.evidence.map((e) => `${e.file}:${e.line}:${e.factId}`), ['apps/api/src/services/orders.ts:9:fn:apps/api/src/services/orders.ts#placeOrder']);
    assert.equal(place.attrs.exported, true);
    assert.equal(place.attrs.async, true);
    assert.equal(place.attrs.endLine, 14);
    // the call to "send" has two candidates: not drawn, kept on the caller
    assert.deepEqual(place.attrs.ambiguousCalls, [{ callee: 'send', line: 12, candidates: ['fn:apps/api/src/services/notify.ts#Notifier.send', 'fn:packages/adapters/src/mailer.ts#Mailer.send'] }]);
    const calls = model.edges.filter((e) => e.kind === 'calls');
    const sure = fx.facts.facts.filter((f) => f.kind === 'call' && f.origin !== 'AMBIGUOUS').map((f) => f.id.slice('call:'.length) + ':calls').sort();
    assert.deepEqual(calls.map((e) => e.id), sure);
    assert.ok(!model.edges.some((e) => e.id.includes('->?')), 'an AMBIGUOUS call is never an arrow');
    const one = calls.find((e) => e.id === 'fn:apps/api/src/services/orders.ts#placeOrder->fn:apps/api/src/services/orders.ts#normalize:calls');
    assert.deepEqual(one.label, { msg: 'edge.calls', params: { callee: 'normalize' } });
    assert.equal(one.origin, 'EXTRACTED');
    assert.deepEqual(one.evidence.map((e) => `${e.file}:${e.line}`), ['apps/api/src/services/orders.ts:10']);
    // every function and call still stands on a file of the census, a line it has and its sha of now
    const rows = new Map(fx.census.files.filter((f) => f.included).map((f) => [f.path, f]));
    for (const item of [...fns, ...calls]) {
      assert.ok(item.evidence.length > 0, item.id);
      for (const e of item.evidence) {
        assert.ok(rows.has(e.file), `${item.id}: ${e.file}`);
        assert.ok(e.line >= 1 && e.line <= fileLines(fx.root)(e.file).length, `${item.id}: ${e.file}:${e.line}`);
        assert.equal(e.sha, sha16(readFileSync(join(fx.root, e.file))), `${item.id}: sha`);
      }
    }
    // without the zoom the model is levels 1 to 3, as before
    const flat = build(fx, {}, { level4: false });
    assert.ok(!flat.nodes.some((n) => n.level === 4));
    assert.ok(!flat.edges.some((e) => e.kind === 'calls'));
  } finally { fx.done(); }
});

test('level 4: a function is tested when a test file imports its file, and a function with no test says tested: false', async () => {
  const fx = await readFixture('acme-shop', (root) => {
    mkdirSync(join(root, 'apps/api/test'), { recursive: true });
    writeFileSync(join(root, 'apps/api/test/orders.test.ts'), "import { placeOrder } from '../src/services/orders';\n\ntest('places', () => placeOrder({ item: 'a', email: 'ana@example.com' }));\n");
  });
  try {
    const model = build(fx);
    const node = (id) => model.nodes.find((n) => n.id === id);
    assert.equal(node('fn:apps/api/src/services/orders.ts#placeOrder').attrs.tested, true);
    assert.deepEqual(node('fn:apps/api/src/services/orders.ts#placeOrder').attrs.testedBy, [{ file: 'apps/api/test/orders.test.ts', line: 1 }]);
    assert.equal(node('fn:apps/api/src/services/orders.ts#normalize').attrs.tested, true, 'the test imports the file');
    assert.equal(node('fn:apps/api/src/routes/orders.ts#ordersRoutes').attrs.tested, false);
    assert.equal(node('fn:apps/api/src/routes/orders.ts#ordersRoutes').attrs.testedBy, undefined);
    assert.ok(!model.nodes.some((n) => n.id.startsWith('fn:apps/api/test/')), 'a test is not the running code');
  } finally { fx.done(); }
});

// ---------- stale by hash: the "how to confirm" of fd03 ----------

test('editing a file marks as out of date only the claims whose evidence is in that file (fd03)', async () => {
  const fx = await readFixture('acme-shop');
  try {
    const before = build(fx);
    const items = [...before.nodes.filter((n) => n.id !== 'sys'), ...before.edges];
    // one claim per item, citing its first evidence, as the checker would stamp it
    const own = items.map((item) => {
      const e = item.evidence[0];
      return { id: `claim:${item.id}`, about: item.id, type: 'explain', cites: [{ file: e.file, line: e.line, sha: e.sha, quote: 'x' }], factIds: [], hashAtCheck: item.hash };
    });
    // and the true claims of the planted set, through the real checker
    const planted = JSON.parse(readFileSync(new URL('./fixtures/claims/acme-shop.claims.json', import.meta.url), 'utf8')).claims.map((c) => c.claim);
    const linesOf = (file) => {
      try { return { lines: fileLines(fx.root)(file), sha: sha16(readFileSync(join(fx.root, file))) }; } catch { return null; }
    };
    const { approved } = checkAll(planted, { vocab: vocabularyOf(before, fx.facts), linesOf, facts: fx.facts, model: before, now: '2026-10-10T10:00:00.000Z' });
    assert.ok(approved.length >= 3, 'the true claims pass');
    const claims = [...own, ...approved];
    assert.deepEqual(markStale(before, claims, { census: fx.census, facts: fx.facts }), [], 'nothing changed, nothing is out of date');

    const edited = 'apps/api/src/services/orders.ts';
    const path = join(fx.root, edited);
    writeFileSync(path, `// reviewed by Ana\n${readFileSync(path, 'utf8')}`);
    const next = await fx.read();
    const after = build(fx, next);
    const stale = markStale(after, claims, { census: next.census, facts: next.facts });

    const evFiles = new Map();
    for (const m of [before, after]) for (const it of [...m.nodes, ...m.edges]) for (const e of it.evidence ?? []) {
      if (!evFiles.has(it.id)) evFiles.set(it.id, new Set());
      evFiles.get(it.id).add(e.file);
    }
    const touches = (c) => evFiles.get(c.about)?.has(edited) || c.cites.some((x) => x.file === edited);
    const expected = claims.filter(touches).map((c) => c.id).sort();
    assert.ok(expected.length > 0 && expected.length < claims.length);
    assert.deepEqual(stale, expected);
    assert.ok(stale.includes('claim:cmp:apps/api/src/services'));
    assert.ok(stale.includes('claim:fn:apps/api/src/services/orders.ts#placeOrder'));
    assert.ok(!stale.includes('claim:ctr:apps/api'), 'the container stands on its manifest');
    assert.ok(!stale.includes('claim:01'), 'a claim citing server.ts stays');
    // the model built with the claims carries the same list
    assert.deepEqual(build(fx, next, { claims }).stale, stale);
  } finally { fx.done(); }
});

// ---------- synthetic facts ----------

const SHA = (path) => sha16(Buffer.from(path));
function censusOfRows(rows) {
  return {
    version: 1, rev: 3,
    files: rows.map(([path, total, kind = 'code', type = path.endsWith('.json') ? 'json' : path.endsWith('.md') ? 'md' : 'ts']) => ({
      path, type, kind, included: true, lines: { total, code: total, comment: 0, blank: 0 }, sha: SHA(path), owner: null,
    })),
  };
}
const fact = (id, kind, file, line, attrs = {}, extra = {}) => ({ id, kind, name: id.slice(id.indexOf(':') + 1), file, line, sha: SHA(file), origin: 'EXTRACTED', attrs, refs: [], ...extra });
const factsOf = (list) => ({ version: 1, censusRev: 3, files: {}, facts: list });
const fn = (file, name, line) => fact(`fn:${file}#${name}`, 'function', file, line, { exported: true, async: false, params: [], endLine: line + 2 });

const world = () => {
  const census = censusOfRows([
    ['apps/api/package.json', 5], ['apps/api/src/orders/place.ts', 40], ['apps/api/src/orders/pay.ts', 20],
    ['apps/api/test/place.test.ts', 10, 'test'], ['docs/architecture/orders.md', 12, 'doc'], ['docs/architecture/README.md', 8, 'doc'],
  ]);
  const facts = factsOf([
    fn('apps/api/src/orders/place.ts', 'place', 3), fn('apps/api/src/orders/pay.ts', 'pay', 2), fn('apps/api/src/orders/pay.ts', 'refund', 9),
    fact('call:fn:apps/api/src/orders/place.ts#place->fn:apps/api/src/orders/pay.ts#pay', 'call', 'apps/api/src/orders/place.ts', 5, { callee: 'pay' }),
    fact('import:apps/api/src/orders/place.ts->apps/api/src/orders/pay.ts', 'import', 'apps/api/src/orders/place.ts', 1, { spec: './pay', library: false }),
    fact('import:apps/api/test/place.test.ts->apps/api/src/orders/place.ts', 'import', 'apps/api/test/place.test.ts', 1, { spec: '../src/orders/place', library: false }),
  ]);
  const arch = { layers: [{ id: 'core', name: 'Core', partIds: ['orders'] }], parts: [{ id: 'orders', name: 'Orders', file: 'docs/architecture/orders.md', codePaths: ['apps/api/src/orders'] }] };
  return { census, facts, arch };
};

test('with level 4, the drawing and the journeys, the same input still gives the same model byte for byte', () => {
  const { census, facts, arch } = world();
  const overrides = { added: [{ id: 'dn:b', kind: 'note', name: 'B' }, { id: 'dn:a', kind: 'note', name: 'A' }], hidden: ['fn:apps/api/src/orders/pay.ts#pay'] };
  const real = 'fn:apps/api/src/orders/place.ts#place->fn:apps/api/src/orders/pay.ts#pay:calls';
  const journeys = [{ id: 'j:b', name: 'B', steps: [{ n: 1, edgeId: real }] }, { id: 'j:a', name: 'A', steps: [{ n: 1, edgeId: real }] }];
  const a = JSON.stringify(buildModel(facts, census, arch, overrides, { level4: true, journeys }));
  const rev = { ...facts, facts: [...facts.facts].reverse() };
  const b = JSON.stringify(buildModel(rev, { ...census, files: [...census.files].reverse() }, arch, { ...overrides, added: [...overrides.added].reverse() }, { level4: true, journeys: [...journeys].reverse() }));
  assert.equal(b, a);
});

test('a function with no test file importing its file says tested: false', () => {
  const { census, facts, arch } = world();
  const model = buildModel(facts, census, arch, {}, { level4: true });
  const node = (id) => model.nodes.find((n) => n.id === id);
  assert.equal(node('fn:apps/api/src/orders/place.ts#place').attrs.tested, true);
  assert.equal(node('fn:apps/api/src/orders/pay.ts#pay').attrs.tested, false, 'imported by code, not by a test');
  // an import of a test made on an old version of the test file proves nothing
  const old = { ...facts, facts: facts.facts.map((f) => (f.file.includes('/test/') ? { ...f, sha: 'ffffffffffffffff' } : f)) };
  assert.equal(buildModel(old, census, arch, {}, { level4: true }).nodes.find((n) => n.id === 'fn:apps/api/src/orders/place.ts#place').attrs.tested, false);
});

test('journeys: a journey stands only when every step is an edge of the model; one invented step rejects it whole, with the reason', () => {
  const { census, facts, arch } = world();
  const model = buildModel(facts, census, arch, {}, { level4: true });
  const real = 'fn:apps/api/src/orders/place.ts#place->fn:apps/api/src/orders/pay.ts#pay:calls';
  assert.ok(model.edges.some((e) => e.id === real));
  const good = { id: 'j:checkout', name: 'Checkout', origin: 'INFERRED', steps: [{ n: 1, edgeId: real, note: null }] };
  const bad = { id: 'j:refund', name: 'Refund', origin: 'INFERRED', steps: [{ n: 1, edgeId: real, note: null }, { n: 2, edgeId: 'cmp:apps/api/src/orders->ext:stripe:uses', note: null }] };
  const out = validateJourneys(model, [good, bad]);
  assert.deepEqual(out.journeys.map((j) => j.id), ['j:checkout']);
  assert.deepEqual(out.rejected, [{ id: 'j:refund', reason: 'unknown-edge', step: 2 }]);
  // steps out of order, an empty journey, a journey stamped EXTRACTED and a repeated id are refused too
  const more = validateJourneys(model, [
    { ...good, id: 'j:jump', steps: [{ n: 2, edgeId: real, note: null }] },
    { ...good, id: 'j:empty', steps: [] },
    { ...good, id: 'j:forged', origin: 'EXTRACTED' },
    good, good,
  ]);
  assert.deepEqual(more.rejected.map((r) => [r.id, r.reason]), [['j:jump', 'bad-step'], ['j:empty', 'bad-shape'], ['j:forged', 'bad-origin'], ['j:checkout', 'duplicate-id']]);
  // buildModel keeps only the journeys that stand
  assert.deepEqual(buildModel(facts, census, arch, {}, { level4: true, journeys: [good, bad] }).journeys.map((j) => j.id), ['j:checkout']);
});

test('the owner\'s drawing: a new box and a new arrow are a draft, never nodes; hidden leaves the drawing, not the model', () => {
  const { census, facts, arch } = world();
  const overrides = {
    added: [{ id: 'dn:billing', kind: 'part', name: 'Billing', layerId: 'core' }, { id: 'dn:Bad Id', kind: 'part', name: 'x' }, { id: 'dn:ana-note', kind: 'sticker', name: 'x' }],
    edges: [{ from: 'dn:billing', to: 'cmp:apps/api/src/orders', label: 'charges' }, { from: 'dn:nowhere', to: 'sys', label: 'x' }],
    hidden: ['fn:apps/api/src/orders/pay.ts#refund', 'ghost'],
  };
  const model = buildModel(facts, census, arch, overrides, { level4: true });
  assert.ok(!model.nodes.some((n) => n.id.startsWith('dn:')), 'a drawn box is not a node');
  assert.deepEqual(model.draft.nodes, [{ id: 'dn:billing', kind: 'part', name: 'Billing', layerId: 'core', origin: 'DECLARED' }]);
  assert.deepEqual(model.draft.edges, [{ id: 'de:dn:billing->cmp:apps/api/src/orders', from: 'dn:billing', to: 'cmp:apps/api/src/orders', label: 'charges', origin: 'DECLARED' }]);
  const refund = model.nodes.find((n) => n.id === 'fn:apps/api/src/orders/pay.ts#refund');
  assert.equal(refund.hidden, true, 'still in the model, out of the drawing');
  assert.ok(!model.nodes.some((n) => n.id === 'ghost'));
  // a box once written to the .md (the part now exists) is no longer a draft
  const written = { ...arch, parts: [...arch.parts, { id: 'billing', name: 'Billing', file: 'docs/architecture/billing.md', codePaths: [] }] };
  assert.deepEqual(buildModel(facts, census, written, overrides, { level4: true }).draft.nodes, []);
});

test('the owner\'s drawing: a new name is DECLARED on a node whose part is in the .md, with the .md line as evidence; anything else is a draft', () => {
  const { census, facts, arch } = world();
  const lines = { 'docs/architecture/orders.md': ['', '# Orders', '', 'Takes an order.'] };
  const overrides = { nodes: { 'cmp:apps/api/src/orders': { name: 'Ordering', layerId: 'core' }, 'ctr:apps/api': { name: 'Backend' }, 'cmp:apps/api/src/orders#x': { name: 'x' } } };
  const model = buildModel(facts, census, arch, overrides, { linesOf: (p) => lines[p] ?? null });
  const cmp = model.nodes.find((n) => n.id === 'cmp:apps/api/src/orders');
  assert.equal(cmp.name, 'Ordering');
  assert.equal(cmp.layerId, 'core');
  assert.equal(cmp.origin, 'DECLARED');
  assert.ok(cmp.evidence.some((e) => e.file === 'docs/architecture/orders.md' && e.line === 2 && e.sha === SHA('docs/architecture/orders.md')));
  const hashOf = (ev) => createHash('sha256').update(ev.map((e) => e.sha).join('\n')).digest('hex').slice(0, 16);
  assert.equal(cmp.hash, hashOf(cmp.evidence));
  // the container has no part in the .md: its new name waits in the draft
  assert.equal(model.nodes.find((n) => n.id === 'ctr:apps/api').name, 'api');
  assert.deepEqual(model.draft.nodes, [{ id: 'ctr:apps/api', kind: 'override', name: 'Backend', origin: 'DECLARED' }]);
  // a layer that is not in the README is a draft too
  const newLayer = buildModel(facts, census, arch, { nodes: { 'cmp:apps/api/src/orders': { layerId: 'edge' } } }, {});
  assert.equal(newLayer.nodes.find((n) => n.id === 'cmp:apps/api/src/orders').origin, 'INFERRED');
  assert.deepEqual(newLayer.draft.nodes, [{ id: 'cmp:apps/api/src/orders', kind: 'override', layerId: 'edge', origin: 'DECLARED' }]);
  // applyOverrides is the same step on its own, and never touches the model it gets
  const plain = buildModel(facts, census, arch, {}, {});
  const copy = JSON.stringify(plain);
  const applied = applyOverrides(plain, overrides, arch, { census, linesOf: (p) => lines[p] ?? null });
  assert.equal(JSON.stringify(plain), copy);
  assert.deepEqual(applied.nodes, model.nodes);
});

test('markStale: a changed hash, a cited file with a new sha, a vanished item or fact are out of date; the rest stays', () => {
  const { census, facts, arch } = world();
  const model = buildModel(facts, census, arch, {}, { level4: true });
  const pay = model.nodes.find((n) => n.id === 'fn:apps/api/src/orders/pay.ts#pay');
  const cite = (file, line = 1) => ({ file, line, sha: SHA(file), quote: 'abc' });
  const claims = [
    { id: 'claim:ok', about: pay.id, cites: [cite('apps/api/src/orders/pay.ts', 2)], hashAtCheck: pay.hash },
    { id: 'claim:old-hash', about: pay.id, cites: [cite('apps/api/src/orders/pay.ts', 2)], hashAtCheck: '0000000000000000' },
    { id: 'claim:old-cite', about: pay.id, cites: [{ ...cite('apps/api/src/orders/place.ts'), sha: 'ffffffffffffffff' }], hashAtCheck: pay.hash },
    { id: 'claim:gone', about: 'cmp:apps/api/src/legacy', cites: [cite('apps/api/src/orders/pay.ts')], hashAtCheck: 'abcdabcdabcdabcd' },
    { id: 'claim:fact', about: 'import:apps/api/src/orders/place.ts->apps/api/src/orders/pay.ts', cites: [cite('apps/api/src/orders/place.ts')], hashAtCheck: null },
    { id: 'claim:fact-gone', about: 'route:GET /nowhere', cites: [cite('apps/api/src/orders/place.ts')], hashAtCheck: null },
    { id: 'claim:out-of-census', about: pay.id, cites: [cite('apps/api/src/orders/old.ts')], hashAtCheck: pay.hash },
    { id: 'claim:sys', about: 'sys', cites: [cite('apps/api/package.json')], hashAtCheck: null },
  ];
  assert.deepEqual(markStale(model, claims, { census, facts }), ['claim:fact-gone', 'claim:gone', 'claim:old-cite', 'claim:old-hash', 'claim:out-of-census']);
});
