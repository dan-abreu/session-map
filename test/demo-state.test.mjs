import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8');
const state = JSON.parse(raw);
const shop = state.projects[0];
const notes = state.projects[1];
const isPerson = (who) => Boolean(who) && who.toLowerCase() !== 'claude';
const items = (p) => p.arch.parts.flatMap((part) => part.groups.flatMap((g) => g.items.map((item) => ({ part, item }))));

test('demo projects carry the architecture map, not the cell tree', () => {
  for (const p of state.projects) {
    for (const key of ['arch', 'workCells', 'mainBranch', 'fetchedAt', 'ai', 'activity', 'chats', 'decisions', 'skills', 'cost']) assert.ok(key in p, `${p.name} has ${key}`);
    for (const key of ['units', 'unitLinks', 'cells', 'fronts']) assert.ok(!(key in p), `${p.name} still has ${key}`);
    for (const key of ['source', 'dir', 'lang', 'layers', 'parts', 'links']) assert.ok(key in p.arch, `${p.name} arch.${key}`);
  }
  assert.equal(shop.arch.source, 'worktree');
  assert.equal(notes.arch.source, 'none', 'one project has no map, to show the "create it" banner');
});

test('the shop map: three layers holding every part once, items in the convention', () => {
  const ids = new Set(shop.arch.parts.map((p) => p.id));
  assert.equal(shop.arch.layers.length, 3);
  const placed = shop.arch.layers.flatMap((l) => l.partIds);
  assert.deepEqual([...placed].sort(), [...ids].sort());
  const codes = new Set();
  for (const { part, item } of items(shop)) {
    assert.ok(['todo', 'doing', 'done'].includes(item.status), item.title);
    assert.ok(item.weight === null || ['blocks', 'important', 'detail'].includes(item.weight));
    assert.ok(Array.isArray(item.detail) && Number.isInteger(item.line));
    if (item.code) {
      assert.ok(!codes.has(item.code), `${item.code} is unique`);
      codes.add(item.code);
    }
    assert.ok(part.file.startsWith(`${shop.arch.dir}/`));
  }
  for (const p of shop.arch.parts) {
    const own = p.groups.flatMap((g) => g.items);
    const open = own.filter((i) => i.status !== 'done');
    assert.deepEqual(p.counts, {
      todo: own.filter((i) => i.status === 'todo').length, doing: own.filter((i) => i.status === 'doing').length, done: own.length - open.length,
      withUser: open.filter((i) => isPerson(i.who)).length, blocks: open.filter((i) => i.weight === 'blocks').length,
    }, `${p.id} counts`);
    for (const ref of p.refs) assert.ok(ids.has(ref) && ref !== p.id);
  }
  for (const s of ['todo', 'doing', 'done']) assert.ok(items(shop).some(({ item }) => item.status === s), `some item is ${s}`);
  assert.ok(shop.arch.parts.some((p) => p.groups.some((g) => g.name === '')), 'a part with items under no group');
});

test('chats, branches and links point at real parts, and parts list them back', () => {
  const ids = new Set(shop.arch.parts.map((p) => p.id));
  for (const p of state.projects) {
    const cells = new Set(p.workCells.map((w) => w.id));
    for (const c of p.chats) {
      assert.ok(c.partId === null || ids.has(c.partId), `${c.title} part`);
      assert.ok(['code', 'page', 'files', 'ai', 'none'].includes(c.partSource));
      assert.ok(c.workCellId === null || cells.has(c.workCellId));
      assert.ok(!('unitId' in c) && !('unitSource' in c));
    }
  }
  for (const part of shop.arch.parts) {
    assert.deepEqual(part.chatIds, shop.chats.filter((c) => c.partId === part.id).map((c) => c.sessionId));
    assert.deepEqual(part.workCellIds, shop.workCells.filter((w) => w.partId === part.id && w.status !== 'merged').map((w) => w.id));
  }
  for (const w of shop.workCells) {
    assert.ok(ids.has(w.partId));
    for (const id of w.touches) assert.ok(ids.has(id));
    for (const other of w.clashWith) assert.ok(shop.workCells.find((x) => x.id === other)?.clashWith.includes(w.id), 'clash is symmetric');
  }
  for (const l of shop.arch.links) {
    assert.ok(ids.has(l.a) && ids.has(l.b) && l.a < l.b);
    assert.equal(l.weight, Math.min(4, l.reasons.length));
    for (const r of l.reasons) assert.ok(['shared-chat', 'shared-branch', 'lineage', 'file-ref'].includes(r.kind));
  }
  for (const a of shop.activity) for (const id of a.partIds) assert.ok(ids.has(id), `${a.kind} ${a.ts}`);
  assert.ok(shop.chats.some((c) => c.status === 'busy'), 'a chat is working, so a box pulses');
  assert.ok(shop.workCells.some((w) => w.clashWith.length && w.status !== 'merged'), 'a clash shows on a part');
});

test('"Waiting for you" holds the items with a person, the clash and the waiting chats', () => {
  const itemDecisions = shop.decisions.filter((d) => d.kind === 'item');
  const expected = items(shop).filter(({ item }) => item.status !== 'done' && isPerson(item.who));
  assert.deepEqual(itemDecisions.map((d) => d.code), expected.map(({ item }) => item.code));
  const chats = state.projects.flatMap((p) => p.chats).filter((c) => !c.archived)
    .reduce((n, c) => n + (c.waiting.strong ? 1 : 0) + (c.waiting.weak ? 1 : 0) + c.waiting.items.length, 0);
  assert.equal(state.waitingCount, chats + state.projects.flatMap((p) => p.decisions).length);
});

test('demo chats follow the server rules for actions and the in-page chat', () => {
  for (const p of state.projects) {
    for (const c of p.chats) {
      assert.equal(c.chattable, !c.live, `${c.title}: only a closed conversation is written from the page`);
      assert.ok(c.bridgeUrl === null || c.bridgeUrl.startsWith('https://claude.ai/code/'));
    }
  }
});

test('demo data carries nothing personal', () => {
  assert.doesNotMatch(raw, /[A-Za-z]:[\\/]+Users|\/Users\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
});

test('the demo lists its conversations: every chat of the map, an idea, a new map and some older than the map shows', () => {
  const ids = new Set(shop.arch.parts.map((p) => p.id));
  for (const p of state.projects) {
    const listed = new Set(p.conversations.map((r) => r.sessionId));
    for (const c of p.chats) assert.ok(listed.has(c.sessionId), `${c.title} is listed`);
    for (const r of p.conversations) {
      assert.ok(['map', 'vscode', 'terminal', 'sdk'].includes(r.origin), r.title);
      assert.ok(r.partId === null || ids.has(r.partId), `${r.title} part`);
    }
  }
  assert.ok(shop.conversations.some((r) => r.node?.kind === 'idea'));
  assert.ok(shop.conversations.some((r) => !r.onMap && r.costUSD === null), 'a page conversation older than the window');
  assert.ok(notes.conversations.some((r) => r.node?.kind === 'create-arch'));
});

test('the demo shows live work: busy chats carry their item and steps, one runs a workflow, and another project works too', () => {
  const busy = state.projects.flatMap((p) => p.chats.filter((c) => c.status === 'busy').map((c) => ({ p, c })));
  for (const { p, c } of busy) {
    assert.ok(c.liveSteps.length > 0 && c.liveSteps.every((s) => typeof s.kind === 'string' && 'target' in s && s.ts), `${c.title} steps`);
    const row = p.conversations.find((r) => r.sessionId === c.sessionId);
    assert.deepEqual(row.lastStep, c.liveSteps.at(-1), `${c.title}: the list shows the same last step`);
    assert.equal(row.itemCode ?? null, c.itemCode ?? null, `${c.title}: the list and the map agree on the item`);
  }
  assert.ok(shop.chats.some((c) => c.status === 'busy' && c.itemCode), 'a chat works on an item, so the way lights down to it');
  const flows = shop.chats.flatMap((c) => c.workflows);
  assert.ok(flows.some((w) => w.running.length && w.running.some((a) => a.model)), 'a workflow has agents running, with their model');
  assert.ok(notes.chats.some((c) => c.status === 'busy'), 'the live list groups more than one project');
});
