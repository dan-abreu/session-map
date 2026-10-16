import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { reasonsHash, relationWhyByRules } from '../server/ai/relwhy.mjs';
import { aiRelationWhys, explainRelations, forgetLife, lifeOf, placeChanged, relationWhyFile, setPlanLimits, settleAi, withRelationWhys } from '../server/ai/life.mjs';

const part = (id, name, about) => ({ id, name, file: `docs/architecture/${id}.md`, about, codePaths: [], groups: [], counts: {}, chatIds: [], workCellIds: [] });
const ARCH = { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [part('storefront', 'Storefront', 'The public site.'), part('orders', 'Orders', 'Builds the basket.')] };
const BIG = { ...ARCH, parts: [...ARCH.parts, part('a2', 'A2', 'x'), part('b2', 'B2', 'y')] };
const reason = (text, extra = {}) => ({ kind: 'shared-chat', text, sessionId: 's1', files: ['apps/site/cart.js'], ...extra });
const LINK = { a: 'orders', b: 'storefront', weight: 2, since: null, reasons: [reason('Basket totals'), { kind: 'shared-branch', text: 'feat/basket', commit: 'sum the lines' }] };

test('reasonsHash: the same reasons in any order are the same; a new reason or language is another', () => {
  const h = reasonsHash(LINK, ARCH);
  assert.equal(reasonsHash({ ...LINK, reasons: [...LINK.reasons].reverse() }, ARCH), h);
  assert.equal(reasonsHash({ ...LINK, weight: 3, since: '2026-01-01' }, ARCH), h, 'only the reasons count');
  assert.notEqual(reasonsHash({ ...LINK, reasons: [...LINK.reasons, reason('Taxes')] }, ARCH), h);
  assert.notEqual(reasonsHash(LINK, { ...ARCH, lang: 'pt' }), h);
});

// ---- the sentence motor (sb16) ----

test('relationWhyByRules renders one clause per reason kind, in the language of the map', () => {
  const en = relationWhyByRules(LINK, ARCH);
  assert.ok(en.includes('The conversation "Basket totals" worked on both.'), en);
  assert.ok(en.includes('The line of work "feat/basket" worked on both.'), en);
  const pt = relationWhyByRules(LINK, { ...ARCH, lang: 'pt' });
  assert.ok(pt.includes('A conversa "Basket totals" trabalhou nas duas.'), pt);
  assert.ok(pt.includes('A linha de trabalho "feat/basket" trabalhou nas duas.'), pt);
});

test('relationWhyByRules: one template per reason kind, naming the two parts', () => {
  const of = (kind, extra = {}) => ({ a: 'orders', b: 'storefront', reasons: [{ kind, ...extra }] });
  assert.equal(relationWhyByRules(of('file-ref', { text: 'Orders → Storefront', file: 'docs/architecture/orders.md' }), ARCH), 'The document of Orders points to Storefront.');
  assert.equal(relationWhyByRules(of('lineage', { text: 'Basket work' }), ARCH), 'A conversation continued from Orders into Storefront.');
  assert.equal(relationWhyByRules(of('shared-spec', { text: 'Basket plan' }), ARCH), 'The plan "Basket plan" worked on both.');
  assert.equal(relationWhyByRules(of('file-ref', { text: 'x' }), { ...ARCH, lang: 'pt' }), 'O documento de Orders aponta para Storefront.');
});

test('relationWhyByRules: a long title is cut with an ellipsis; an empty one is left out', () => {
  const long = 'a'.repeat(200);
  const cut = relationWhyByRules({ ...LINK, reasons: [reason(long)] }, ARCH);
  assert.ok(cut.includes(`"${'a'.repeat(89)}…"`), cut);
  assert.ok(cut.length < 130);
  assert.equal(relationWhyByRules({ ...LINK, reasons: [reason('   ')] }, ARCH), null, 'an empty title gives no sentence');
});

test('relationWhyByRules: at most two clauses, and a reason kind without a template gives nothing', () => {
  const three = { ...LINK, reasons: [reason('One'), reason('Two'), reason('Three')] };
  assert.equal((relationWhyByRules(three, ARCH).match(/worked on both/g) ?? []).length, 2);
  assert.equal(relationWhyByRules({ ...LINK, reasons: [{ kind: 'made-up', text: 'x' }] }, ARCH), null);
  assert.equal(relationWhyByRules({ ...LINK, reasons: [] }, ARCH), null);
});

const withSm = async (fn) => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-relwhy-'));
  try {
    await fn(smDir);
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
};
const P = (smDir, arch = ARCH) => ({ smDir, projectId: 'shop-abc123', arch });

test('explainRelations writes the motor sentence once, on disk, and calls no AI — not even after a restart', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const run = async () => { calls.n++; return { ok: true, value: { why: 'unused' }, costUSD: 0.001 }; };
    let life = lifeOf(smDir, {}, { bin: 'fake-claude', run });
    explainRelations(life, P(smDir), [LINK]);
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 0, 'the motor never calls the AI');
    assert.ok(existsSync(relationWhyFile(smDir, 'shop-abc123')));
    const why = withRelationWhys(life, P(smDir), [LINK])[0].why;
    assert.ok(why.includes('Basket totals'), why);
    assert.equal(aiRelationWhys(life, smDir, 'shop-abc123')['orders|storefront'].hash, reasonsHash(LINK, ARCH));

    forgetLife(smDir);
    life = lifeOf(smDir, {}, { bin: 'fake-claude', run });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 0, 'the same reasons are not written again');

    const more = { ...LINK, reasons: [...LINK.reasons, reason('Taxes')] };
    assert.equal(withRelationWhys(life, P(smDir), [more])[0].why, undefined, 'a sentence for older reasons is not shown');
    explainRelations(life, P(smDir), [more]);
    await settleAi(smDir);
    assert.equal(typeof withRelationWhys(life, P(smDir), [more])[0].why, 'string');
  });
});

test('the sentence is a motor: it is written with the AI off, no call and no cap', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, { ai: { enabled: false, maxCallsPerHour: 0 } }, { bin: 'fake-claude', run: async () => { calls.n++; return { ok: true, value: {} }; } });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 0);
    assert.equal(typeof withRelationWhys(life, P(smDir), [LINK])[0].why, 'string');
  });
});

test('a reason kind without a template keeps the relation as it is, and writes no file', async () => {
  await withSm(async (smDir) => {
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => { throw new Error('no AI'); } });
    const link = { ...LINK, reasons: [{ kind: 'made-up', text: 'x' }] };
    explainRelations(life, P(smDir), [link]);
    await settleAi(smDir);
    assert.deepEqual(withRelationWhys(life, P(smDir), [link]), [link]);
    assert.ok(!existsSync(relationWhyFile(smDir, 'shop-abc123')));
  });
});

test('a damaged file of sentences is nothing; a relation that went away is dropped from the file', async () => {
  await withSm(async (smDir) => {
    mkdirSync(dirname(relationWhyFile(smDir, 'shop-abc123')), { recursive: true });
    writeFileSync(relationWhyFile(smDir, 'shop-abc123'), '{not json');
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => { throw new Error('no AI'); } });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(typeof JSON.parse(readFileSync(relationWhyFile(smDir, 'shop-abc123'), 'utf8'))['orders|storefront'].text, 'string');
    explainRelations(life, P(smDir, BIG), [{ ...LINK, a: 'a2', b: 'b2' }]);
    await settleAi(smDir);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(relationWhyFile(smDir, 'shop-abc123'), 'utf8'))), ['a2|b2']);
  });
});

// ---- review fixes: what the hash covers

const BRANCH = { kind: 'shared-branch', text: 'feat/basket', commit: 'sum the lines', files: ['a.js', 'b.js', 'c.js', 'd.js'] };
const SPEC = { kind: 'shared-spec', text: 'Basket plan', spec: { change: 'basket', done: 1, total: 4 }, sessionId: 's1', workCellId: 'w1' };
const SOLID = { ...LINK, reasons: [BRANCH, SPEC] };

test('reasonsHash covers the two parts the sentence names, not only the reasons', () => {
  const fan = [{ kind: 'shared-branch', text: 'feat/basket' }];
  const toStore = { a: 'orders', b: 'storefront', reasons: fan };
  const toB2 = { a: 'orders', b: 'b2', reasons: fan };
  assert.notEqual(reasonsHash(toStore, BIG), reasonsHash(toB2, BIG), 'same reasons, another second part');
  const renamed = { ...BIG, parts: BIG.parts.map((p) => (p.id === 'storefront' ? { ...p, name: 'Shop front' } : p)) };
  assert.notEqual(reasonsHash(toStore, renamed), reasonsHash(toStore, BIG), 'a renamed part');
  const retold = { ...BIG, parts: BIG.parts.map((p) => (p.id === 'storefront' ? { ...p, about: 'Another text.' } : p)) };
  assert.notEqual(reasonsHash(toStore, retold), reasonsHash(toStore, BIG), 'a part with another about');
});

test('reasonsHash holds only what the sentence reads: ticking a task or a fifth file keeps it, a new commit subject or plan changes it', () => {
  const h = reasonsHash(SOLID, ARCH);
  const tick = { ...SOLID, reasons: [BRANCH, { ...SPEC, spec: { ...SPEC.spec, done: 2, total: 5 } }] };
  assert.equal(reasonsHash(tick, ARCH), h, 'spec done/total');
  assert.equal(reasonsHash({ ...SOLID, reasons: [BRANCH, { ...SPEC, sessionId: 's9', workCellId: 'w9' }] }, ARCH), h, 'session and work cell');
  assert.equal(reasonsHash({ ...SOLID, reasons: [{ ...BRANCH, files: [...BRANCH.files, 'e.js'] }, SPEC] }, ARCH), h, 'a fifth file');
  assert.notEqual(reasonsHash({ ...SOLID, reasons: [{ ...BRANCH, commit: 'fix the lines' }, SPEC] }, ARCH), h, 'commit subject');
  assert.notEqual(reasonsHash({ ...SOLID, reasons: [BRANCH, { ...SPEC, spec: { ...SPEC.spec, change: 'taxes' } }] }, ARCH), h, 'spec change');
});

test('with more reasons than the sentence takes, the hash sees the same ones, in any input order', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'shared-chat', text: `Topic ${String(i).padStart(2, '0')}` }));
  const link = { ...LINK, reasons: many };
  const flipped = { ...LINK, reasons: [...many].reverse() };
  assert.equal(reasonsHash(flipped, ARCH), reasonsHash(link, ARCH));
  const en = relationWhyByRules(link, ARCH);
  assert.ok(en.includes('Topic 00'), en);
  assert.ok(!en.includes('Topic 10'), 'at most the first clauses in the canonical order');
});

test('a hit session limit holds placement back, as before', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => { calls.n++; return { ok: true, value: { partId: 'orders' }, costUSD: 0.001 }; } });
    setPlanLimits(life, { weekly: { hit: false, resetsAt: null, resetsText: null }, session: { hit: true, resetsAt: null, resetsText: null } });
    placeChanged(life, P(smDir), [{ sessionId: 's1', digest: { title: 'x', prompts: ['a'], files: [], commits: [] } }]);
    await settleAi(smDir);
    assert.equal(calls.n, 0);
  });
});
