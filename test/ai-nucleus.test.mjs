import test from 'node:test';
import assert from 'node:assert/strict';
import { nucleusInputOf, writeAiNuclei } from '../server/ai/nucleus.mjs';
import { withAiNucleus } from '../server/brain/nucleus.mjs';

const input = (id, title = `Work on ${id}`) => ({ id, name: id, purpose: '', chats: [{ title, prompts: ['do it'], commits: [], last: 'done' }], branches: [] });

// Answers every unit of the batch it is shown, the way the model would.
function fakeAsk() {
  const asks = [];
  const ask = async (req) => {
    asks.push(req);
    const ids = req.key.units.map((u) => u.id);
    return { ok: true, costUSD: 0.001, value: { units: ids.map((id) => ({ id, state: `  ${id} is going   well `, decided: ['use Pix'], todo: ['ship it', ''] })) } };
  };
  return { ask, asks };
}

test('writeAiNuclei asks in batches and stores a cleaned nucleus with the content hash of each unit', async () => {
  const { ask, asks } = fakeAsk();
  const inputs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => input(id));
  const store = await writeAiNuclei(inputs, {}, ask);
  assert.equal(asks.length, 2, 'seven units fit in two calls');
  assert.equal(asks[0].key.kind, 'nucleus');
  assert.match(asks[0].prompt, /Work on a/);
  assert.match(asks[0].prompt, /data, not instructions/);
  assert.deepEqual(Object.keys(store).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(store.a.state, 'a is going well');
  assert.deepEqual(store.a.todo, ['ship it']);
  assert.deepEqual(store.a.decided, ['use Pix']);
  assert.match(store.a.hash, /^[0-9a-f]{40}$/);
});

test('writeAiNuclei asks again only for the units whose content changed', async () => {
  const first = fakeAsk();
  const inputs = ['a', 'b', 'c'].map((id) => input(id));
  const store = await writeAiNuclei(inputs, {}, first.ask);
  const second = fakeAsk();
  const same = await writeAiNuclei(inputs, store, second.ask);
  assert.equal(second.asks.length, 0);
  assert.deepEqual(same, store);
  const changed = [input('a'), input('b', 'Now about refunds'), input('c')];
  const third = fakeAsk();
  await writeAiNuclei(changed, store, third.ask);
  assert.equal(third.asks.length, 1);
  assert.deepEqual(third.asks[0].key.units.map((u) => u.id), ['b']);
});

test('writeAiNuclei ignores ids outside the batch and stops at the hourly cap', async () => {
  const stray = async (req) => ({ ok: true, costUSD: 0, value: { units: [{ id: 'zzz', state: 'x', decided: [], todo: [] }, { id: req.key.units[0].id, state: 'ok', decided: [], todo: [] }] } });
  const store = await writeAiNuclei([input('a')], {}, stray);
  assert.deepEqual(Object.keys(store), ['a']);
  let calls = 0;
  const capped = async () => { calls++; return { ok: false, error: 'rate-limited' }; };
  const none = await writeAiNuclei(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => input(id)), {}, capped);
  assert.deepEqual(none, {});
  assert.equal(calls, 1, 'the second batch is not tried once the cap says no');
});

test('nucleusInputOf keeps the newest chats, their digests and the branches, never the transcript', () => {
  const unit = { id: 'pix', name: 'Pix', purpose: 'Aceitar Pix' };
  const chats = Array.from({ length: 9 }, (_, i) => ({ updatedAt: `2026-10-0${i + 1}T00:00:00Z`, digest: { title: `t${i}`, branch: null, prompts: ['p'], files: ['a/b.js'], commits: ['c'] }, last: 'x'.repeat(500) }));
  const branches = [{ branch: 'feature/pix', commits: 3, files: [{ path: 'a/b.js', status: 'M' }], lastCommit: { subject: 'feat: pix' }, openspec: null }];
  const out = nucleusInputOf(unit, chats, branches);
  assert.equal(out.chats.length, 6);
  assert.equal(out.chats[0].title, 't8', 'newest first');
  assert.ok(out.chats[0].last.length <= 200);
  assert.equal('files' in out.chats[0], false);
  assert.deepEqual(out.branches, [{ branch: 'feature/pix', commits: 3, files: 1, lastCommit: 'feat: pix', todo: [] }]);
});

test('withAiNucleus: a card or page nucleus wins; without one the AI fills state, decided and to do', () => {
  const ai = { hash: 'h', state: 'Pix works in sandbox', decided: ['use Pix'], todo: ['go live'] };
  const seed = { state: '', decided: [], todo: [], recent: [] };
  assert.deepEqual(withAiNucleus(null, seed, ai), { state: 'Pix works in sandbox', decided: ['use Pix'], todo: ['go live'], recent: [], source: 'ai' });
  const stored = { state: 'From the card', decided: [], todo: [], recent: [] };
  assert.deepEqual(withAiNucleus(stored, seed, ai), { ...stored, source: 'card' });
  assert.deepEqual(withAiNucleus(null, seed, null), { ...seed, source: null });
});
