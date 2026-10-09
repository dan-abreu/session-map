import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPerception, perceive, tidyUnits } from '../server/ai/perceive.mjs';
import { cleanUnitName } from '../server/brain/names.mjs';
import { applyChanges, consolidate, shouldConsolidate } from '../server/ai/consolidate.mjs';
import { consolidatePrompt, perceivePrompt } from '../server/ai/prompts.mjs';

const NOW = '2026-10-09T12:00:00.000Z';
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const unit = (id, over = {}) => ({ id, level: 'cell', parentId: null, name: id, purpose: '', tags: [], origin: 'ai', pinned: false, paths: [], chatIds: [], bornAt: NOW, ...over });
const seedUnits = () => [
  unit('checkout', { name: 'Checkout', tags: ['cart', 'payment'], chatIds: [S2] }),
  unit('coupons', { name: 'Coupons', tags: ['cart', 'discount'] }),
  unit('login', { name: 'Login', pinned: true, origin: 'user' }),
  { id: 'unsorted', name: 'Unsorted', paths: [] },
];
const digest = { title: 'Pagamento com Pix', branch: null, prompts: ['quero aceitar Pix no checkout'], files: ['src/pay.js'], commits: [] };
const answering = (value) => {
  const asks = [];
  const ask = async (req) => { asks.push(req); return { ok: true, value, costUSD: 0.001 }; };
  return { ask, asks };
};

test('prompts carry the digest and the tree, ask for the user\'s language and leave unsorted out', () => {
  const p = perceivePrompt(digest, seedUnits());
  assert.match(p, /quero aceitar Pix no checkout/);
  assert.match(p, /"checkout"/);
  assert.doesNotMatch(p, /"unsorted"/);
  assert.match(p, /same language as the user's prompts/i);
  const c = consolidatePrompt(seedUnits(), [{ kind: 'born', ts: NOW, unitIds: ['coupons'] }]);
  assert.match(c, /"coupons"/);
  assert.match(c, /pinned/i);
  assert.doesNotMatch(c, /"unsorted"/);
});

test('perceive returns a cleaned perception for a new unit and asks with a cache key built from the digest', async () => {
  const { ask, asks } = answering({ unitId: null, name: '  Pagamento Pix ', purpose: 'Aceitar Pix no checkout', tags: ['Pix', 'pagamento', 'checkout', 'pix', 'brasil', 'extra', 'more'] });
  const p = await perceive(digest, seedUnits(), ask);
  assert.deepEqual(p, { unitId: null, name: 'Pagamento Pix', purpose: 'Aceitar Pix no checkout', tags: ['pix', 'pagamento', 'checkout', 'brasil', 'extra'] });
  assert.deepEqual(asks[0].key, { kind: 'perceive', digest });
  assert.ok(asks[0].schemaHint);
});

test('perceive keeps an existing unit id and drops one the AI made up', async () => {
  const fits = await perceive(digest, seedUnits(), answering({ unitId: 'checkout', name: 'Checkout', purpose: 'x', tags: ['cart'] }).ask);
  assert.equal(fits.unitId, 'checkout');
  const madeUp = await perceive(digest, seedUnits(), answering({ unitId: 'payments-v2', name: 'Payments', purpose: 'x', tags: [] }).ask);
  assert.equal(madeUp.unitId, null);
  const toUnsorted = await perceive(digest, seedUnits(), answering({ unitId: 'unsorted', name: 'X', purpose: 'x', tags: [] }).ask);
  assert.equal(toUnsorted.unitId, null);
});

test('perceive gives null when the AI is off or answers without a name', async () => {
  assert.equal(await perceive(digest, seedUnits(), async () => ({ ok: false, error: 'ai-off' })), null);
  assert.equal(await perceive(digest, seedUnits(), answering({ unitId: null, name: '', tags: [] }).ask), null);
});

test('applyPerception creates a new cell for the chat with a stable slug id and moves the chat out of its old unit', () => {
  const units = seedUnits();
  const before = JSON.stringify(units);
  const next = applyPerception(units, { sessionId: S2 }, { unitId: null, name: 'Pagamento Pix', purpose: 'Aceitar Pix', tags: ['pix'] }, NOW);
  assert.equal(JSON.stringify(units), before, 'input untouched');
  const born = next.find((u) => u.id === 'pagamento-pix');
  assert.deepEqual(born, {
    id: 'pagamento-pix', level: 'cell', parentId: null, name: 'Pagamento Pix', purpose: 'Aceitar Pix', tags: ['pix'],
    origin: 'ai', pinned: false, paths: [], chatIds: [S2], bornAt: NOW,
  });
  assert.deepEqual(next.find((u) => u.id === 'checkout').chatIds, []);
  const twin = applyPerception(next, { sessionId: S1 }, { unitId: null, name: 'Pagamento  Pix!', purpose: '', tags: [] }, NOW);
  assert.ok(twin.some((u) => u.id === 'pagamento-pix-2'));
});

test('applyPerception fits the chat into an existing unit, and a pinned unit keeps its chat', () => {
  const fitted = applyPerception(seedUnits(), { sessionId: S1 }, { unitId: 'coupons', name: 'Cupons', purpose: '', tags: [] }, NOW);
  assert.deepEqual(fitted.find((u) => u.id === 'coupons').chatIds, [S1]);
  assert.equal(fitted.find((u) => u.id === 'coupons').name, 'Coupons', 'perceiving a chat does not rename its unit');
  const pinned = seedUnits().map((u) => (u.id === 'login' ? { ...u, chatIds: [S1] } : u));
  const kept = applyPerception(pinned, { sessionId: S1 }, { unitId: 'coupons', name: 'Cupons', purpose: '', tags: [] }, NOW);
  assert.deepEqual(kept.find((u) => u.id === 'login').chatIds, [S1]);
  assert.deepEqual(kept.find((u) => u.id === 'coupons').chatIds, []);
});

test('consolidation groups two similar cells into a tissue and records a grouped event', async () => {
  const { ask, asks } = answering({ changes: [{ kind: 'group', ids: ['checkout', 'coupons'], name: 'Carrinho', purpose: 'Comprar', tags: ['cart'] }] });
  const { changes } = await consolidate(seedUnits(), [], ask);
  assert.equal(asks[0].key.kind, 'consolidate');
  const { units, events } = applyChanges(seedUnits(), changes, NOW);
  const tissue = units.find((u) => u.id === 'carrinho');
  assert.equal(tissue.level, 'tissue');
  assert.equal(tissue.origin, 'ai');
  assert.equal(units.find((u) => u.id === 'checkout').parentId, 'carrinho');
  assert.equal(units.find((u) => u.id === 'coupons').parentId, 'carrinho');
  assert.deepEqual(events, [{ kind: 'grouped', ts: NOW, branch: null, author: { name: 'AI', email: '' }, unitIds: ['carrinho', 'checkout', 'coupons'], subject: 'Carrinho' }]);
});

test('consolidation fuses a look-alike unit into another, keeping its chats, tags and children', () => {
  const units = [
    ...seedUnits().map((u) => (u.id === 'checkout' ? { ...u, parentId: 'cart' } : u.id === 'coupons' ? { ...u, parentId: 'carrinho' } : u)),
    unit('cart', { level: 'tissue', tags: ['cart'] }),
    unit('carrinho', { level: 'tissue', chatIds: [S1], tags: ['promo'] }),
  ];
  const { units: next, events } = applyChanges(units, [{ kind: 'fuse', ids: ['carrinho'], into: 'cart' }], NOW);
  assert.ok(!next.some((u) => u.id === 'carrinho'));
  const cart = next.find((u) => u.id === 'cart');
  assert.deepEqual(cart.chatIds, [S1]);
  assert.deepEqual(cart.tags, ['cart', 'promo']);
  assert.equal(next.find((u) => u.id === 'coupons').parentId, 'cart');
  assert.deepEqual(events, [{ kind: 'fused-by-meaning', ts: NOW, branch: null, author: { name: 'AI', email: '' }, unitIds: ['cart', 'carrinho'], subject: 'cart' }]);
  assert.deepEqual(applyChanges(units, [{ kind: 'fuse', ids: ['coupons'], into: 'cart' }], NOW).events, [], 'a cell does not fuse into a tissue');
});

test('consolidation never touches pinned units or unsorted, and ignores ids the AI invented', async () => {
  const { ask } = answering({
    changes: [
      { kind: 'rename', id: 'login', name: 'Auth' },
      { kind: 'fuse', ids: ['coupons'], into: 'login' },
      { kind: 'group', ids: ['checkout', 'ghost'], name: 'X' },
      { kind: 'move', id: 'unsorted', parentId: 'checkout' },
      { kind: 'rename', id: 'coupons', name: 'Cupons' },
      { kind: 'explode', id: 'checkout' },
      'nonsense',
    ],
  });
  const { changes } = await consolidate(seedUnits(), [], ask);
  assert.deepEqual(changes, [{ kind: 'rename', id: 'coupons', name: 'Cupons', purpose: null }]);
  const { units, events } = applyChanges(seedUnits(), changes, NOW);
  assert.equal(units.find((u) => u.id === 'coupons').name, 'Cupons');
  assert.equal(units.find((u) => u.id === 'login').name, 'Login');
  assert.equal(events[0].kind, 'renamed');
  assert.equal(events[0].subject, 'Coupons → Cupons');
});

test('applyChanges re-checks each change against the tree the earlier ones left, and moves only upward', () => {
  const units = [...seedUnits(), unit('shop', { level: 'organ' })];
  const { units: next, events } = applyChanges(units, [
    { kind: 'fuse', ids: ['coupons'], into: 'checkout' },
    { kind: 'rename', id: 'coupons', name: 'Gone' },
    { kind: 'move', id: 'shop', parentId: 'checkout' },
    { kind: 'move', id: 'checkout', parentId: 'shop' },
  ], NOW);
  assert.deepEqual(events.map((e) => e.kind), ['fused-by-meaning', 'grouped']);
  assert.equal(next.find((u) => u.id === 'checkout').parentId, 'shop');
  assert.equal(next.find((u) => u.id === 'shop').parentId, null);
});

test('consolidate gives no changes when the AI is off', async () => {
  assert.deepEqual((await consolidate(seedUnits(), [], async () => ({ ok: false, error: 'ai-off' }))).changes, []);
});

test('shouldConsolidate after 5 new perceptions or a day since the last pass', () => {
  const now = Date.parse(NOW);
  assert.equal(shouldConsolidate(4, now - 1000, now), false);
  assert.equal(shouldConsolidate(5, now - 1000, now), true);
  assert.equal(shouldConsolidate(1, now - 24 * 60 * 60 * 1000, now), true);
  assert.equal(shouldConsolidate(0, now - 48 * 60 * 60 * 1000, now), false);
  assert.equal(shouldConsolidate(1, null, now), true);
});

test('group keeps the shared parent only when it sits above the new level', () => {
  const underTissue = [unit('t', { level: 'tissue' }), unit('a', { parentId: 't' }), unit('b', { parentId: 't' })];
  const { units: next } = applyChanges(underTissue, [{ kind: 'group', ids: ['a', 'b'], name: 'New' }], NOW);
  const born = next.find((u) => u.id !== 't' && u.level === 'tissue');
  assert.equal(born.parentId, null, 'a tissue never sits under a tissue');

  const underOrgan = [unit('o', { level: 'organ' }), unit('a', { parentId: 'o' }), unit('b', { parentId: 'o' })];
  const kept = applyChanges(underOrgan, [{ kind: 'group', ids: ['a', 'b'], name: 'New' }], NOW).units;
  assert.equal(kept.find((u) => u.level === 'tissue').parentId, 'o');
});

test('fuse never makes a unit its own parent, even on a tree that already breaks the levels', () => {
  const broken = [unit('t', { level: 'tissue' }), unit('n', { level: 'tissue', parentId: 't' }), unit('a', { parentId: 'n' })];
  const { units: next, events } = applyChanges(broken, [{ kind: 'fuse', ids: ['t'], into: 'n' }], NOW);
  assert.deepEqual(events, []);
  assert.ok(next.every((u) => u.parentId !== u.id));
  assert.equal(next.find((u) => u.id === 'n').parentId, 't');
});

test('applyPerception learns the folders of the chat files as path hints, so branches and commits find the unit', () => {
  // Top-level folders and whole apps (docs, apps/api) are true of almost any work: they are not learned.
  const files = ['src/cart/total.ts', 'src/cart/total.test.ts', 'docs/cart.md', 'README.md', 'apps/api/package.json', 'apps/api/src/cart/x.ts'];
  const fitted = applyPerception(seedUnits(), { sessionId: S1, files }, { unitId: 'coupons', name: 'Cupons', purpose: '', tags: [] }, NOW);
  assert.deepEqual(fitted.find((u) => u.id === 'coupons').paths, ['src/cart', 'apps/api/src/cart']);
  const born = applyPerception(seedUnits(), { sessionId: S1, files }, { unitId: null, name: 'Frete', purpose: '', tags: [] }, NOW);
  assert.deepEqual(born.find((u) => u.name === 'Frete').paths, ['src/cart', 'apps/api/src/cart']);
  const many = Array.from({ length: 40 }, (_, i) => `src/pkg${i}/a.ts`);
  assert.equal(applyPerception(seedUnits(), { sessionId: S1, files: many }, { unitId: 'coupons', name: 'Cupons', purpose: '', tags: [] }, NOW)
    .find((u) => u.id === 'coupons').paths.length, 20);
});

test('applyChanges drops groups the AI made that hold nothing, keeping pinned and hand-made ones', () => {
  const units = [
    ...seedUnits(),
    unit('empty-ai', { level: 'tissue', name: 'Vazio' }),
    unit('empty-pinned', { level: 'tissue', name: 'Fixado', pinned: true }),
    unit('empty-user', { level: 'organ', name: 'Meu', origin: 'user' }),
    unit('holder', { level: 'tissue', name: 'Com filho' }),
  ];
  units.find((u) => u.id === 'coupons').parentId = 'holder';
  const ids = applyChanges(units, [], NOW).units.map((u) => u.id);
  assert.ok(!ids.includes('empty-ai'));
  for (const id of ['empty-pinned', 'empty-user', 'holder', 'checkout', 'unsorted']) assert.ok(ids.includes(id), id);
});

test('group into a name that already names a free unit of that level reuses it instead of making a twin', () => {
  const units = [...seedUnits(), unit('carrinho', { level: 'tissue', name: 'Carrinho' }), unit('extra', { name: 'Extra' })];
  units.find((u) => u.id === 'checkout').parentId = 'carrinho';
  const { units: next } = applyChanges(units, [{ kind: 'group', ids: ['coupons', 'extra'], name: 'carrinho', purpose: '', tags: [] }], NOW);
  assert.equal(next.filter((u) => u.level === 'tissue').length, 1);
  assert.equal(next.find((u) => u.id === 'coupons').parentId, 'carrinho');
  assert.equal(next.find((u) => u.id === 'extra').parentId, 'carrinho');
});

// Seen after a restart: the AI answered "new unit" with the exact name of one it made before, and a "-2" twin was born.
test('applyPerception puts the chat in the unit that already has that name instead of making a twin', () => {
  const next = applyPerception(seedUnits(), { sessionId: S1 }, { unitId: null, name: 'coupons', purpose: '', tags: [] }, NOW);
  assert.equal(next.length, seedUnits().length);
  assert.ok(next.find((u) => u.id === 'coupons').chatIds.includes(S1));
});

test('cleanUnitName collapses repeated words, keeps 40 characters cut at a word and drops trailing punctuation', () => {
  assert.equal(cleanUnitName('Roteiro de automação do automação do Chrome'), 'Roteiro de automação do Chrome');
  assert.equal(cleanUnitName('Pix Pix pagamento'), 'Pix pagamento');
  assert.equal(cleanUnitName('Fluxo do negócio.'), 'Fluxo do negócio');
  assert.equal(cleanUnitName('Integração com o gateway de pagamentos internacionais'), 'Integração com o gateway de pagamentos');
  assert.ok(cleanUnitName('x'.repeat(60)).length <= 40);
});

test('perceive and consolidation clean the names the AI gives', async () => {
  const p = await perceive(digest, seedUnits(), answering({ unitId: null, name: 'Pix do Pix do checkout:', purpose: '', tags: [] }).ask);
  assert.equal(p.name, 'Pix do checkout');
  const { changes } = await consolidate([unit('a'), unit('b')], [], answering({ changes: [{ kind: 'group', ids: ['a', 'b'], name: 'Tema tema', purpose: '', tags: [] }] }).ask);
  assert.equal(changes[0].name, 'Tema');
});

test('applyPerception joins the unit with the same name whatever the accents or case, seeded ones too', () => {
  const units = [unit('comunicacao', { name: 'comunicacao', origin: 'seed' }), unit('unsorted', { name: 'Unsorted' })];
  const next = applyPerception(units, { sessionId: S1 }, { unitId: null, name: 'Comunicação', purpose: '', tags: [] }, NOW);
  assert.equal(next.length, 2);
  assert.deepEqual(next[0].chatIds, [S1]);
});

test('consolidation never renames a unit to a name another unit of its level already has, and group reuses one despite spacing', () => {
  const units = [unit('a', { name: 'Pix' }), unit('b', { name: 'Boleto' }), unit('c'), unit('d'), unit('redes', { level: 'tissue', name: 'Redes sociais' })];
  const { units: renamed } = applyChanges(units, [{ kind: 'rename', id: 'b', name: 'pix', purpose: null }], NOW);
  assert.equal(renamed.find((u) => u.id === 'b').name, 'Boleto');
  const { units: grouped } = applyChanges(units, [{ kind: 'group', ids: ['c', 'd'], name: 'Redes  Sociais', purpose: '', tags: [] }], NOW);
  assert.equal(grouped.filter((u) => u.level === 'tissue').length, 1);
  assert.equal(grouped.find((u) => u.id === 'c').parentId, 'redes');
});

test('tidyUnits merges units of one level that share a name, keeping the pinned one, and makes old names readable', () => {
  const units = [
    unit('comunicacao', { name: 'comunicacao', origin: 'seed', paths: ['apps/a'] }),
    unit('mapa', { name: 'Mapa visual', chatIds: [S1], tags: ['mapa'] }),
    unit('mapa-2', { name: 'mapa  visual', chatIds: [S2], pinned: true, tags: ['ui'] }),
    unit('child', { name: 'Child', parentId: 'mapa-tissue' }),
    unit('mapa-tissue', { name: 'Telas', level: 'tissue' }),
    unit('mapa-tissue-2', { name: 'Telas', level: 'tissue' }),
    unit('kid2', { name: 'Kid two', parentId: 'mapa-tissue-2' }),
    unit('roteiro', { name: 'Roteiro do roteiro do Chrome' }),
    unit('pinned-seed', { name: 'pedidos', origin: 'seed', pinned: true }),
    unit('unsorted', { name: 'Unsorted', origin: 'seed' }),
  ];
  const next = tidyUnits(units);
  assert.equal(next.find((u) => u.id === 'comunicacao').name, 'Comunicação');
  assert.equal(next.find((u) => u.id === 'pinned-seed').name, 'pedidos', 'a pinned name is the person\'s');
  assert.equal(next.some((u) => u.id === 'mapa'), false);
  const kept = next.find((u) => u.id === 'mapa-2');
  assert.deepEqual(kept.chatIds.sort(), [S1, S2].sort());
  assert.deepEqual(kept.tags.sort(), ['mapa', 'ui']);
  assert.equal(next.filter((u) => u.level === 'tissue').length, 1);
  assert.equal(next.find((u) => u.id === 'kid2').parentId, 'mapa-tissue');
  assert.equal(next.find((u) => u.id === 'roteiro').name, 'Roteiro do Chrome');
  assert.equal(next.find((u) => u.id === 'unsorted').name, 'Unsorted');
  assert.deepEqual(tidyUnits(next), next, 'running it again changes nothing');
});

test('consolidation also returns the related pairs the AI noticed, with a short reason, only between units it may see', async () => {
  const { ask } = answering({
    changes: [],
    related: [
      { a: 'checkout', b: 'coupons', why: '  coupons change the checkout total  ' },
      { a: 'coupons', b: 'checkout', why: 'twice' },
      { a: 'checkout', b: 'ghost', why: 'invented' },
      { a: 'login', b: 'unsorted', why: 'unsorted is not a unit' },
      { a: 'login', b: 'login', why: 'itself' },
      { a: 'login', b: 'checkout', why: 'x'.repeat(200) },
      'nonsense',
    ],
  });
  const { changes, related } = await consolidate(seedUnits(), [], ask);
  assert.deepEqual(changes, []);
  assert.deepEqual(related.map((r) => [r.a, r.b]), [['checkout', 'coupons'], ['checkout', 'login']]);
  assert.equal(related[0].text, 'coupons change the checkout total');
  assert.ok(related[1].text.length <= 80);
  assert.match(consolidatePrompt(seedUnits(), []), /related/);
  assert.equal((await consolidate(seedUnits(), [], async () => ({ ok: false, error: 'ai-off' }))).related, null, 'no answer, nothing to replace');
});
