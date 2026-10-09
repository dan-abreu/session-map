import test from 'node:test';
import assert from 'node:assert/strict';
import { attachToParts, linkParts, partByCodes, partOfFiles, partsTouched, waitingItems } from '../server/arch/attach.mjs';

const item = (code, extra = {}) => ({ code, title: `Item ${code}`, detail: [], status: 'todo', who: null, weight: null, milestone: null, line: 1, ...extra });
const part = (id, codePaths, items = []) => ({
  id, name: id[0].toUpperCase() + id.slice(1), file: `docs/architecture/${id}.md`, about: '', codePaths,
  groups: items.length ? [{ name: '', items }] : [], counts: { todo: 0, doing: 0, done: 0, withUser: 0, blocks: 0 }, chatIds: [], workCellIds: [],
});
const archOf = (...parts) => ({ source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [{ id: 'all', name: 'All', partIds: parts.map((p) => p.id) }], parts });

const SHOP = archOf(
  part('web', ['apps/web']),
  part('checkout', ['apps/web/src/checkout/']),
  part('billing', ['apps/api/src/billing']),
  part('api', ['apps/api']),
);

test('partOfFiles: each file goes to the deepest code path, and a specific path outvotes a broad app folder', () => {
  const files = ['apps/web/src/checkout/pay.ts', 'apps/web/src/home.ts', 'apps/web/src/menu.ts', 'apps/web/src/footer.ts'];
  assert.deepEqual(partOfFiles(files, SHOP), { partId: 'checkout', touches: ['web'] });
});

test('partOfFiles: a tie between specific parts places nothing and touches both; no match places nothing', () => {
  assert.deepEqual(partOfFiles(['apps/web/src/checkout/pay.ts', 'apps/api/src/billing/tax.ts'], SHOP), { partId: null, touches: ['checkout', 'billing'] });
  assert.deepEqual(partOfFiles(['README.md'], SHOP), { partId: null, touches: [] });
  assert.deepEqual(partOfFiles(['apps/api/package.json'], SHOP), { partId: 'api', touches: [] });
});

test('partOfFiles: a path written relative to an app is read under the part\'s own app folder; one with no app matches anywhere', () => {
  const arch = archOf(part('panel', ['apps/admin', 'src/proxy.ts']), part('portal', ['apps/portal', 'src/proxy.ts']), part('security', ['plugins/auth.ts']));
  const topLevel = new Set(['apps', 'packages', 'docs']);
  assert.equal(partOfFiles(['apps/admin/src/proxy.ts'], arch, { topLevel }).partId, 'panel');
  assert.equal(partOfFiles(['apps/portal/src/proxy.ts'], arch, { topLevel }).partId, 'portal');
  assert.equal(partOfFiles(['apps/api/src/plugins/auth.ts'], arch, { topLevel }).partId, 'security');
});

test('partOfFiles ignores page routes and cuts globs at the folder before them', () => {
  const arch = archOf(part('cards', ['/panel/*', '/', 'packages/core/src/cards/*.ts']), part('routes', ['/api/*']));
  assert.equal(partOfFiles(['packages/core/src/cards/plumber.ts'], arch).partId, 'cards');
  assert.deepEqual(partOfFiles(['panel/index.ts', 'api/x.ts'], arch), { partId: null, touches: [] });
});

test('partOfFiles: editing the part\'s own architecture file places the work there', () => {
  assert.equal(partOfFiles(['docs/architecture/billing.md'], SHOP).partId, 'billing');
  assert.equal(partOfFiles(['Docs/Architecture/Billing.md'], SHOP).partId, 'billing', 'Windows spells folders in any case');
});

test('partsTouched lists every part that wins a file, ties included', () => {
  assert.deepEqual(partsTouched(['apps/web/src/checkout/pay.ts', 'apps/api/x.ts', 'README.md'], SHOP), ['checkout', 'api']);
  assert.deepEqual(partsTouched([], SHOP), []);
});

test('partByCodes: the part whose item codes the conversation cites most, ignoring case and unknown codes', () => {
  const arch = archOf(part('orders', [], [item('or01'), item('or02')]), part('pay', [], [item('pa01')]));
  assert.equal(partByCodes([{ code: 'PA01', n: 1 }, { code: 'or01', n: 1 }, { code: 'or02', n: 2 }], arch), 'orders');
  assert.equal(partByCodes([{ code: 'zz99', n: 5 }], arch), null);
  assert.equal(partByCodes([], arch), null);
});

test('partByCodes: on a tie the part of the latest mention wins', () => {
  const arch = archOf(part('orders', [], [item('or01')]), part('pay', [], [item('pa01')]));
  assert.equal(partByCodes([{ code: 'or01', n: 2 }, { code: 'pa01', n: 2 }], arch), 'pay');
  assert.equal(partByCodes([{ code: 'pa01', n: 2 }, { code: 'or01', n: 2 }], arch), 'orders');
});

test('attachToParts hangs chats and open branches on their parts without touching the input', () => {
  const chats = [{ sessionId: 'a', partId: 'web' }, { sessionId: 'b', partId: null }, { sessionId: 'c', partId: 'web' }];
  const workCells = [{ id: 'feat/x', partId: 'web', status: 'active' }, { id: 'feat/old', partId: 'web', status: 'merged' }, { id: 'feat/y', partId: 'api', status: 'idle' }];
  const out = attachToParts(SHOP, chats, workCells);
  const byId = Object.fromEntries(out.parts.map((p) => [p.id, p]));
  assert.deepEqual(byId.web.chatIds, ['a', 'c']);
  assert.deepEqual(byId.web.workCellIds, ['feat/x']);
  assert.deepEqual(byId.api.workCellIds, ['feat/y']);
  assert.deepEqual(SHOP.parts[0].chatIds, []);
});

test('waitingItems: open items that wait on a person, never done ones or Claude\'s own', () => {
  const arch = archOf(part('orders', [], [
    item('or01', { who: 'with Marcos', weight: 'blocks' }),
    item('or02', { who: 'Ana and Claude', status: 'doing', milestone: '5' }),
    item('or03', { who: 'Claude' }),
    item('or04', { who: 'with Marcos', status: 'done' }),
    item(null, { title: 'No code yet', who: 'with Ana' }),
  ]));
  const items = waitingItems(arch, 'p1');
  assert.deepEqual(items.map((i) => i.code), ['or01', 'or02', null]);
  assert.deepEqual(items[0], { kind: 'item', text: 'Item or01', projectId: 'p1', sessionId: null, partId: 'orders', code: 'or01', status: 'todo', who: 'with Marcos', weight: 'blocks', milestone: null });
  assert.deepEqual(waitingItems(archOf(), 'p1'), []);
});

test('partOfFiles: an app\'s own src folder is as broad as the app itself', () => {
  const arch = archOf(part('comms', ['apps/backend-api/src']), part('providers', ['apps/backend-api/src/routes/admin']));
  const many = Array.from({ length: 20 }, (_, i) => `apps/backend-api/src/services/s${i}.ts`);
  assert.equal(partOfFiles([...many, 'apps/backend-api/src/routes/admin/a.ts'], arch).partId, 'providers');
});

const chatOn = (sessionId, partId, extra = {}) => ({ sessionId, partId, parentId: null, title: `Chat ${sessionId}`, startedAt: '2026-10-01T10:00:00Z', files: [], ...extra });
const cellOn = (id, partId, extra = {}) => ({ id, branch: id, partId, touches: [], chatIds: [], bornAt: '2026-10-02T10:00:00Z', status: 'active', ...extra });

test('linkParts: a chat that edited the files of another part links its own part to it', () => {
  const chats = [chatOn('c1', 'checkout', { files: ['apps/web/src/checkout/pay.ts', 'apps/api/src/billing/tax.ts', 'apps/api/src/billing/vat.ts'] })];
  assert.deepEqual(linkParts(SHOP, chats, []), [{
    a: 'billing', b: 'checkout', weight: 1, since: '2026-10-01T10:00:00Z',
    reasons: [{ kind: 'shared-chat', text: 'Chat c1', sessionId: 'c1' }],
  }]);
});

test('linkParts: a chat placed nowhere links the parts it touched to each other', () => {
  const chats = [chatOn('c1', null, { files: ['apps/web/src/checkout/pay.ts', 'apps/api/src/billing/tax.ts'] })];
  assert.deepEqual(linkParts(SHOP, chats, []).map((l) => [l.a, l.b]), [['billing', 'checkout']]);
});

test('linkParts: branches, lineage and file links add reasons; weight is the count capped at 4, strongest first', () => {
  const arch = { ...SHOP, parts: SHOP.parts.map((p) => (p.id === 'web' ? { ...p, refs: ['api'] } : { ...p, refs: [] })) };
  const chats = [
    chatOn('p1', 'billing'),
    chatOn('c2', 'checkout', { parentId: 'p1', startedAt: '2026-10-03T10:00:00Z' }),
  ];
  const cells = [cellOn('feat/pay', 'checkout', { touches: ['billing'] }), cellOn('feat/tax', 'billing', { chatIds: ['c2'] })];
  const links = linkParts(arch, chats, cells);
  const pay = links.find((l) => l.a === 'billing' && l.b === 'checkout');
  assert.deepEqual(pay.reasons.map((r) => r.kind).sort(), ['lineage', 'shared-branch', 'shared-branch']);
  assert.equal(pay.weight, 3);
  assert.equal(pay.since, '2026-10-02T10:00:00Z');
  assert.equal(links[0], pay, 'the strongest link comes first');
  const ref = links.find((l) => l.a === 'api' && l.b === 'web');
  assert.deepEqual(ref, { a: 'api', b: 'web', weight: 1, since: null, reasons: [{ kind: 'file-ref', text: 'Web → Api' }] });
  const many = Array.from({ length: 6 }, (_, i) => chatOn(`m${i}`, 'checkout', { files: ['apps/api/src/billing/tax.ts'] }));
  assert.equal(linkParts(SHOP, many, [])[0].weight, 4);
});

test('linkParts ignores unknown parts, self links and a chat in the same part as its parent', () => {
  const chats = [chatOn('p1', 'checkout'), chatOn('c2', 'checkout', { parentId: 'p1' }), chatOn('c3', 'ghost', { files: ['apps/api/src/billing/tax.ts'] })];
  const cells = [cellOn('feat/x', 'checkout', { touches: ['checkout', 'nowhere'] })];
  assert.deepEqual(linkParts(SHOP, chats, cells), []);
});
