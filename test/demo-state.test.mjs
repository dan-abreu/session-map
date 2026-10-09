import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8');
const state = JSON.parse(raw);
const LEVEL_RANK = { cell: 0, tissue: 1, organ: 2 };
const shop = state.projects[0];

test('demo projects use the body model, not the old cell/front names', () => {
  for (const p of state.projects) {
    for (const key of ['units', 'unitLinks', 'workCells', 'mainBranch', 'fetchedAt', 'ai']) assert.ok(key in p, `${p.name} has ${key}`);
    for (const key of ['cells', 'cellLinks', 'fronts']) assert.ok(!(key in p), `${p.name} still has ${key}`);
  }
});

test('units form a tree where a parent is always a higher level', () => {
  for (const p of state.projects) {
    const byId = new Map(p.units.map((u) => [u.id, u]));
    assert.equal(byId.size, p.units.length, 'unit ids are unique');
    assert.ok(byId.has('unsorted'));
    for (const u of p.units) {
      assert.ok(u.level in LEVEL_RANK, `${u.id} level`);
      assert.ok(['ai', 'seed', 'user'].includes(u.origin), `${u.id} origin`);
      assert.ok(['active', 'waiting', 'idle'].includes(u.status), `${u.id} status`);
      assert.equal(typeof u.pinned, 'boolean');
      assert.equal(typeof u.purpose, 'string');
      assert.ok(Array.isArray(u.tags) && Array.isArray(u.paths) && Array.isArray(u.workCellIds));
      assert.ok(!Number.isNaN(Date.parse(u.bornAt)), `${u.id} bornAt`);
      for (const k of ['state', 'decided', 'todo', 'recent']) assert.ok(k in u.nucleus, `${u.id} nucleus.${k}`);
      if (u.parentId === null) continue;
      const parent = byId.get(u.parentId);
      assert.ok(parent, `${u.id} parent exists`);
      assert.ok(LEVEL_RANK[parent.level] > LEVEL_RANK[u.level], `${u.id} sits inside a higher level`);
    }
  }
});

test('the shop shows small cells inside tissues inside organs', () => {
  const byId = new Map(shop.units.map((u) => [u.id, u]));
  const nested = shop.units.filter((u) => u.level === 'cell' && byId.get(u.parentId)?.level === 'tissue'
    && byId.get(byId.get(u.parentId).parentId)?.level === 'organ');
  assert.ok(nested.length >= 6);
  assert.ok(shop.units.filter((u) => u.level === 'organ').length >= 2);
  assert.ok(shop.units.filter((u) => u.origin === 'ai').length >= 2, 'some units were named by the AI');
  assert.ok(shop.units.some((u) => u.pinned), 'one unit is pinned');
});

test('container work counts its children', () => {
  for (const p of state.projects) {
    const kids = (id) => p.units.filter((u) => u.parentId === id);
    for (const u of p.units.filter((x) => x.level !== 'cell')) {
      for (const k of ['chats', 'commits', 'decisions']) {
        const sum = kids(u.id).reduce((s, c) => s + c.work[k], 0);
        assert.ok(u.work[k] >= sum, `${u.id}.work.${k} includes children`);
      }
    }
  }
});

test('chats point at real units and work cells, and units list their chats', () => {
  for (const p of state.projects) {
    const units = new Map(p.units.map((u) => [u.id, u]));
    const cells = new Set(p.workCells.map((w) => w.id));
    for (const c of p.chats) {
      assert.ok(units.get(c.unitId)?.chatIds.includes(c.sessionId), `${c.title} listed in its unit`);
      assert.ok(['ai', 'card', 'files', 'override', 'none'].includes(c.unitSource));
      assert.ok(['card', 'guess', 'cwd', 'branch'].includes(c.workCellSource));
      assert.ok(c.workCellId === null || cells.has(c.workCellId), `${c.title} work cell`);
      assert.ok(!('cellId' in c) && !('frontId' in c));
    }
    const listed = p.units.flatMap((u) => u.chatIds);
    assert.equal(listed.length, p.chats.length, 'each chat lives in exactly one unit');
  }
});

test('work cells: two owners, one clash, two fusions, births in the activity', () => {
  const units = new Set(shop.units.map((u) => u.id));
  const alive = shop.workCells.filter((w) => w.status !== 'merged');
  assert.ok(new Set(alive.map((w) => w.owner.email)).size >= 2);
  for (const w of shop.workCells) {
    assert.ok(units.has(w.unitId), `${w.id} unit`);
    for (const id of w.touches) assert.ok(units.has(id), `${w.id} touches ${id}`);
    for (const f of w.files) assert.ok(['A', 'M', 'D'].includes(f.status));
    for (const other of w.clashWith) {
      assert.ok(shop.workCells.find((x) => x.id === other)?.clashWith.includes(w.id), 'clash is symmetric');
    }
    assert.ok(shop.activity.some((a) => a.kind === 'born' && a.workCellId === w.id), `${w.id} born event`);
  }
  assert.ok(alive.some((w) => w.clashWith.length > 0));
  const merged = shop.workCells.filter((w) => w.status === 'merged');
  assert.equal(merged.length, 2);
  for (const w of merged) {
    assert.ok(Date.parse(w.mergedAt) > Date.parse(w.bornAt));
    assert.ok(shop.activity.some((a) => a.kind === 'fused' && a.workCellId === w.id && a.ts === w.mergedAt));
  }
  assert.ok(shop.decisions.some((d) => d.kind === 'clash'));
});

test('activity tells how units joined by meaning', () => {
  const kinds = new Set(shop.activity.map((a) => a.kind));
  for (const k of ['fused-by-meaning', 'grouped']) assert.ok(kinds.has(k), k);
  for (const p of state.projects) {
    const units = new Set(p.units.map((u) => u.id));
    for (const a of p.activity) {
      assert.ok(Array.isArray(a.unitIds) && !('cellIds' in a));
      for (const id of a.unitIds) assert.ok(units.has(id), `${a.kind} ${a.ts} unit ${id}`);
    }
  }
});

test('unit links join real units with known reasons', () => {
  for (const p of state.projects) {
    const units = new Set(p.units.map((u) => u.id));
    for (const l of p.unitLinks) {
      assert.ok(units.has(l.a) && units.has(l.b) && l.a !== l.b);
      assert.ok(l.weight >= 1 && l.weight <= 4);
      for (const r of l.reasons) assert.ok(['shared-chat', 'shared-branch', 'lineage', 'spec-ref', 'meaning'].includes(r.kind));
    }
  }
  assert.ok(shop.unitLinks.some((l) => l.reasons.some((r) => r.kind === 'meaning')));
});

test('waiting count matches waiting chats plus decisions', () => {
  const chats = state.projects.flatMap((p) => p.chats)
    .filter((c) => c.waiting.strong || c.waiting.weak || c.waiting.items.length).length;
  const decisions = state.projects.flatMap((p) => p.decisions).length;
  assert.equal(state.waitingCount, chats + decisions);
});

test('demo chats follow the server rules for actions and the in-page chat', () => {
  for (const p of state.projects) {
    assert.ok(p.ai === null || 'bootstrap' in p.ai, `${p.name} ai.bootstrap`);
    for (const c of p.chats) {
      assert.ok(['cli', 'claude-vscode', 'sdk-cli'].includes(c.entrypoint), `${c.title} entrypoint ${c.entrypoint}`);
      assert.equal(c.chattable, !c.live, `${c.title}: only a closed conversation is written from the page`);
      assert.ok(c.bridgeUrl === null || c.bridgeUrl.startsWith('https://claude.ai/code/'));
    }
  }
  assert.ok(shop.chats.some((c) => c.live && c.bridgeUrl), 'one live chat has Remote Control');
  assert.ok(shop.activity.some((a) => a.kind === 'renamed' && / → /.test(a.subject)), 'an AI rename in the server format');
});

test('demo data carries nothing personal', () => {
  assert.doesNotMatch(raw, /[A-Za-z]:[\\/]+Users|\/Users\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
});
