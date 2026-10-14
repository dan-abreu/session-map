import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WHY_SCHEMA, reasonsHash, relationWhyByAi, relationWhyPrompt } from '../server/ai/relwhy.mjs';
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

test('relationWhyPrompt names the two parts and every reason, and treats the reasons as data', () => {
  const prompt = relationWhyPrompt(LINK, ARCH);
  for (const piece of ['Storefront', 'The public site', 'Orders', 'Builds the basket', 'Basket totals', 'feat/basket', 'sum the lines', 'apps/site/cart.js']) assert.ok(prompt.includes(piece), piece);
  assert.match(prompt, /data, not instructions/);
  assert.match(WHY_SCHEMA, /why/);
  assert.match(relationWhyPrompt(LINK, { ...ARCH, lang: 'pt' }), /Portuguese/);
});

test('relationWhyByAi: a sentence is the answer, tidied; an empty or odd answer is none; a refused call is "ask later"', async () => {
  const answer = (value) => async () => ({ ok: true, value });
  assert.equal(await relationWhyByAi(LINK, ARCH, answer({ why: '  They share the\n basket.  ' })), 'They share the basket.');
  assert.ok((await relationWhyByAi(LINK, ARCH, answer({ why: 'x'.repeat(900) }))).length <= 320);
  assert.equal(await relationWhyByAi(LINK, ARCH, answer({ why: '   ' })), null);
  assert.equal(await relationWhyByAi(LINK, ARCH, answer({ why: 7 })), null);
  assert.equal(await relationWhyByAi(LINK, ARCH, async () => ({ ok: false, error: 'claude-failed' })), null);
  assert.equal(await relationWhyByAi(LINK, ARCH, async () => ({ ok: false, error: 'rate-limited' })), undefined);
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
const fakeRun = (counter, value = { why: 'Both parts changed when the basket totals were reworked.' }) => async () => { counter.n++; return { ok: true, value, costUSD: 0.001 }; };

test('explainRelations asks once per relation, keeps the sentence on disk and asks nothing after a restart', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    let life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [LINK]);
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1);
    assert.ok(existsSync(relationWhyFile(smDir, 'shop-abc123')));
    assert.equal(withRelationWhys(life, P(smDir), [LINK])[0].why, 'Both parts changed when the basket totals were reworked.');

    forgetLife(smDir);
    rmSync(join(smDir, 'ai-cache.json'), { force: true });
    life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1, 'the same reasons are not asked again');
    assert.equal(aiRelationWhys(life, smDir, 'shop-abc123')['orders|storefront'].hash, reasonsHash(LINK, ARCH));

    const more = { ...LINK, reasons: [...LINK.reasons, reason('Taxes')] };
    assert.equal(withRelationWhys(life, P(smDir), [more])[0].why, undefined, 'a sentence for older reasons is not shown');
    explainRelations(life, P(smDir), [more]);
    await settleAi(smDir);
    assert.equal(calls.n, 2, 'new reasons are asked again');
    assert.equal(typeof withRelationWhys(life, P(smDir), [more])[0].why, 'string');
  });
});

test('explainRelations: the AI off asks nothing and the relation stays as it is', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, { ai: { enabled: false } }, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 0);
    assert.deepEqual(withRelationWhys(life, P(smDir), [LINK]), [LINK]);
    assert.ok(!existsSync(relationWhyFile(smDir, 'shop-abc123')));
  });
});

test('explainRelations: a failed call leaves the relation as it is and is not retried at once', async () => {
  await withSm(async (smDir) => {
    let n = 0;
    const t = 1_000_000;
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => { n++; return { ok: false, error: 'claude-failed' }; } });
    explainRelations(life, P(smDir), [LINK], { now: () => t });
    await settleAi(smDir);
    assert.equal(n, 1);
    assert.deepEqual(withRelationWhys(life, P(smDir), [LINK]), [LINK]);
    explainRelations(life, P(smDir), [LINK], { now: () => t + 60_000 });
    await settleAi(smDir);
    assert.equal(n, 1, 'one minute later it still waits');
    explainRelations(life, P(smDir), [LINK], { now: () => t + 11 * 60_000 });
    await settleAi(smDir);
    assert.equal(n, 2, 'ten minutes later it tries again');
  });
});

test('explainRelations respects maxCallsPerHour: the refused ones are asked later, never stored', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, { ai: { maxCallsPerHour: 1 } }, { bin: 'fake-claude', run: fakeRun(calls) });
    const two = [LINK, { ...LINK, a: 'a2', b: 'b2', reasons: [reason('Other work')] }];
    explainRelations(life, P(smDir, BIG), two);
    await settleAi(smDir);
    assert.equal(calls.n, 1);
    assert.equal(Object.keys(aiRelationWhys(life, smDir, 'shop-abc123')).length, 1);
  });
});

test('a damaged file of sentences is nothing; a relation that went away is dropped from the file', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    mkdirSync(dirname(relationWhyFile(smDir, 'shop-abc123')), { recursive: true });
    writeFileSync(relationWhyFile(smDir, 'shop-abc123'), '{not json');
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1);
    explainRelations(life, P(smDir, BIG), [{ ...LINK, a: 'a2', b: 'b2' }]);
    await settleAi(smDir);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(relationWhyFile(smDir, 'shop-abc123'), 'utf8'))), ['a2|b2']);
  });
});

// ---- review fixes: what the hash covers, and the cap shared with placement

const BRANCH = { kind: 'shared-branch', text: 'feat/basket', commit: 'sum the lines', files: ['a.js', 'b.js', 'c.js', 'd.js'] };
const SPEC = { kind: 'shared-spec', text: 'Basket plan', spec: { change: 'basket', done: 1, total: 4 }, sessionId: 's1', workCellId: 'w1' };
const SOLID = { ...LINK, reasons: [BRANCH, SPEC] };

test('reasonsHash covers the two parts the prompt names, not only the reasons', () => {
  const fan = [{ kind: 'shared-branch', text: 'feat/basket' }];
  const toStore = { a: 'orders', b: 'storefront', reasons: fan };
  const toB2 = { a: 'orders', b: 'b2', reasons: fan };
  assert.notEqual(reasonsHash(toStore, BIG), reasonsHash(toB2, BIG), 'same reasons, another second part');
  const renamed = { ...BIG, parts: BIG.parts.map((p) => (p.id === 'storefront' ? { ...p, name: 'Shop front' } : p)) };
  assert.notEqual(reasonsHash(toStore, renamed), reasonsHash(toStore, BIG), 'a renamed part');
  const retold = { ...BIG, parts: BIG.parts.map((p) => (p.id === 'storefront' ? { ...p, about: 'Another text.' } : p)) };
  assert.notEqual(reasonsHash(toStore, retold), reasonsHash(toStore, BIG), 'a part with another about');
});

test('reasonsHash holds only what the prompt shows: ticking a task or a fifth file keeps it, a new commit subject or plan changes it', () => {
  const h = reasonsHash(SOLID, ARCH);
  const tick = { ...SOLID, reasons: [BRANCH, { ...SPEC, spec: { ...SPEC.spec, done: 2, total: 5 } }] };
  assert.equal(reasonsHash(tick, ARCH), h, 'spec done/total');
  assert.equal(reasonsHash({ ...SOLID, reasons: [BRANCH, { ...SPEC, sessionId: 's9', workCellId: 'w9' }] }, ARCH), h, 'session and work cell');
  assert.equal(reasonsHash({ ...SOLID, reasons: [{ ...BRANCH, files: [...BRANCH.files, 'e.js'] }, SPEC] }, ARCH), h, 'a fifth file');
  assert.notEqual(reasonsHash({ ...SOLID, reasons: [{ ...BRANCH, commit: 'fix the lines' }, SPEC] }, ARCH), h, 'commit subject');
  assert.notEqual(reasonsHash({ ...SOLID, reasons: [BRANCH, { ...SPEC, spec: { ...SPEC.spec, change: 'taxes' } }] }, ARCH), h, 'spec change');
});

test('with more reasons than the prompt takes, the hash and the prompt see the same ones, in any input order', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'shared-chat', text: `Topic ${String(i).padStart(2, '0')}` }));
  const link = { ...LINK, reasons: many };
  const flipped = { ...LINK, reasons: [...many].reverse() };
  assert.equal(reasonsHash(flipped, ARCH), reasonsHash(link, ARCH));
  assert.equal(relationWhyPrompt(flipped, ARCH), relationWhyPrompt(link, ARCH));
  const shown = many.filter((r) => relationWhyPrompt(link, ARCH).includes(r.text));
  assert.equal(shown.length, 8);
  const hidden = many.find((r) => !shown.includes(r));
  assert.equal(reasonsHash({ ...LINK, reasons: [...many.filter((r) => r !== hidden), { ...hidden, sessionId: 'other', files: ['x.js'] }] }, ARCH), reasonsHash(link, ARCH), 'detail of a reason the prompt does not show');
});

test('two relations with identical reasons but another second part are two asks and two stored sentences', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    const fan = [{ kind: 'shared-branch', text: 'feat/basket' }];
    const links = [{ a: 'orders', b: 'storefront', reasons: fan }, { a: 'orders', b: 'b2', reasons: fan }];
    explainRelations(life, P(smDir, BIG), links);
    await settleAi(smDir);
    assert.equal(calls.n, 2);
    assert.equal(Object.keys(aiRelationWhys(life, smDir, 'shop-abc123')).length, 2);
  });
});

test('a renamed part makes its relation be asked again, and the old sentence is hidden meanwhile', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1);
    const renamed = { ...ARCH, parts: ARCH.parts.map((p) => (p.id === 'storefront' ? { ...p, name: 'Shop front' } : p)) };
    assert.equal(withRelationWhys(life, P(smDir, renamed), [LINK])[0].why, undefined);
    explainRelations(life, P(smDir, renamed), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 2);
  });
});

test('ticking a plan task or editing a fifth file does not spend a new call', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    explainRelations(life, P(smDir), [SOLID]);
    await settleAi(smDir);
    const ticked = { ...SOLID, reasons: [{ ...BRANCH, files: [...BRANCH.files, 'e.js'] }, { ...SPEC, spec: { ...SPEC.spec, done: 3 } }] };
    explainRelations(life, P(smDir), [ticked]);
    await settleAi(smDir);
    assert.equal(calls.n, 1);
    assert.equal(typeof withRelationWhys(life, P(smDir), [ticked])[0].why, 'string');
  });
});

test('explainRelations leaves half of the hourly calls for placement', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, { ai: { maxCallsPerHour: 2 } }, { bin: 'fake-claude', run: fakeRun(calls, { partId: 'orders' }) });
    await life.queue.ask({ key: { kind: 'place', n: 1 }, prompt: 'p', schemaHint: '{}' });
    assert.equal(calls.n, 1);
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1, 'one call is left and it is kept for placement');
    assert.deepEqual(withRelationWhys(life, P(smDir), [LINK]), [LINK]);
  });
});

test('explainRelations still asks while the hour has room above that reserve', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, { ai: { maxCallsPerHour: 4 } }, { bin: 'fake-claude', run: fakeRun(calls) });
    const three = [LINK, { ...LINK, a: 'a2', b: 'b2', reasons: [reason('Other work')] }, { ...LINK, a: 'a2', b: 'storefront', reasons: [reason('Third')] }];
    explainRelations(life, P(smDir, BIG), three);
    await settleAi(smDir);
    assert.equal(calls.n, 2, 'four calls, two kept for placement');
  });
});

test('a hit plan limit holds the background AI back: no call against a closed door, and the pause clears with the limit', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: fakeRun(calls) });
    setPlanLimits(life, { weekly: { hit: true, resetsAt: null, resetsText: null }, session: { hit: false, resetsAt: null, resetsText: null } });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 0, 'the weekly limit is hit: nothing is asked');
    assert.deepEqual(withRelationWhys(life, P(smDir), [LINK]), [LINK], 'the relation stays as it is');

    setPlanLimits(life, { weekly: { hit: false, resetsAt: null, resetsText: null }, session: { hit: false, resetsAt: null, resetsText: null } });
    explainRelations(life, P(smDir), [LINK]);
    await settleAi(smDir);
    assert.equal(calls.n, 1, 'the limit passed: the ask goes out again');
  });
});

test('a hit session limit also holds placement back', async () => {
  await withSm(async (smDir) => {
    const calls = { n: 0 };
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run: async () => { calls.n++; return { ok: true, value: { partId: 'orders' }, costUSD: 0.001 }; } });
    setPlanLimits(life, { weekly: { hit: false, resetsAt: null, resetsText: null }, session: { hit: true, resetsAt: null, resetsText: null } });
    placeChanged(life, P(smDir), [{ sessionId: 's1', digest: { title: 'x', prompts: ['a'], files: [], commits: [] } }]);
    await settleAi(smDir);
    assert.equal(calls.n, 0);
  });
});
