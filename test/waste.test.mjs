import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wasteSignals, medianOf } from '../server/waste.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-13T12:00:00Z');
let n = 0;
// A priced reply: main chat when no agentId is given.
const row = (o = {}) => ({
  key: `k${n++}`, ts: NOW - DAY, model: 'claude-sonnet-5-5', effort: 'medium', sessionId: 'c1', project: 'p1', who: 'conversa principal',
  agentId: null, runId: null, skills: [], input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, cost: { total: 1 }, ...o,
});
const agent = (id, o = {}) => row({ agentId: id, who: `ajudante: ${id}`, ...o });

test('the median of a list, empty as zero', () => {
  assert.equal(medianOf([]), 0);
  assert.equal(medianOf([5, 1, 3]), 3);
  assert.equal(medianOf([1, 2, 3, 4]), 2.5);
});

test('agents are counted by model and effort, with their cost and the Opus or Fable share', () => {
  const lines = [
    agent('a1', { model: 'claude-opus-5-1', effort: 'high', cost: { total: 6 } }), agent('a1', { model: 'claude-opus-5-1', effort: 'high', cost: { total: 2 } }),
    agent('a2', { model: 'claude-sonnet-5-5', effort: 'medium', cost: { total: 1 } }),
    agent('a3', { model: 'claude-haiku-5-5', effort: 'low', cost: { total: 1 } }),
    row({ cost: { total: 10 } }),
  ];
  const w = wasteSignals(lines, { from: NOW - 7 * DAY, to: NOW }).total;
  assert.equal(w.agents.count, 3);
  assert.equal(w.agents.usd, 10);
  const opus = w.agents.byModel.find((m) => m.model === 'opus-5-1');
  assert.deepEqual([opus.effort, opus.count, opus.usd], ['high', 1, 8]);
  assert.equal(w.agents.heavyCount, 1);
  assert.equal(w.agents.heavyUsdShare, 0.4);
  assert.equal(w.chats.share, 0.5); // the chat itself: 10 of 20
});

test('lines outside the period are left out, and by default the period is the last 7 days', () => {
  const lines = [row({ ts: NOW - 8 * DAY }), row({ ts: NOW - DAY })];
  assert.equal(wasteSignals(lines, { from: NOW - 7 * DAY, to: NOW }).total.usd, 1);
  assert.equal(wasteSignals(lines, { now: NOW }).total.usd, 1);
});

test('a workflow run past 10 agents warns, naming the run; the biggest runs come first', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(agent(`w${i}`, { runId: 'wf_big', cost: { total: 2 } }));
  lines.push(agent('x1', { runId: 'wf_small' }));
  const w = wasteSignals(lines, { now: NOW });
  assert.equal(w.total.runs.count, 2);
  assert.equal(w.total.runs.over10, 1);
  assert.deepEqual([w.total.runs.top[0].runId, w.total.runs.top[0].agents, w.total.runs.top[0].usd], ['wf_big', 12, 24]);
  const warn = w.warnings.find((x) => x.kind === 'run');
  assert.equal(warn.run, 'wf_big');
  assert.equal(warn.agents, 12);
});

test('a chat that reached over 200k of context warns, and the longest chats are listed', () => {
  const lines = [row({ cacheRead: 250_000 }), row({ cacheRead: 100_000 }), row({ sessionId: 'c2', cacheRead: 50_000 })];
  const w = wasteSignals(lines, { now: NOW, titleOf: (id) => `title ${id}` });
  assert.deepEqual(w.total.chats.longest.map((c) => [c.sessionId, c.replies, c.maxContext]), [['c1', 2, 250_010], ['c2', 1, 50_010]]);
  const warn = w.warnings.find((x) => x.kind === 'context');
  assert.deepEqual([warn.chat, warn.title, warn.tokens], ['c1', 'title c1', 250_010]);
  assert.equal(w.warnings.filter((x) => x.kind === 'context').length, 1);
});

test('a skill opened by 3 agents of one chat is a snowball and warns; skills per agent are averaged', () => {
  const lines = [
    agent('a1', { skills: ['tdd'] }), agent('a2', { skills: ['tdd', 'x'] }), agent('a3', { skills: ['tdd'] }), agent('a4'),
    agent('b1', { sessionId: 'c2', skills: ['tdd'] }),
  ];
  const w = wasteSignals(lines, { now: NOW });
  assert.equal(w.total.skills.opened, 5);
  assert.equal(w.total.skills.perAgent, 1);
  assert.deepEqual(w.total.skills.snowball.map((s) => [s.chat, s.name, s.agents]), [['c1', 'tdd', 3]]);
  assert.equal(w.warnings.filter((x) => x.kind === 'skill').length, 1);
});

test('Opus or Fable agents over a third of the agents warn; exactly a third does not', () => {
  const mk = (heavy, light) => [
    ...Array.from({ length: heavy }, (_, i) => agent(`h${i}`, { model: 'claude-opus-5-1' })),
    ...Array.from({ length: light }, (_, i) => agent(`l${i}`)),
  ];
  assert.ok(wasteSignals(mk(2, 3), { now: NOW }).warnings.some((x) => x.kind === 'heavy'));
  assert.ok(!wasteSignals(mk(1, 2), { now: NOW }).warnings.some((x) => x.kind === 'heavy'));
});

test('the first turn of each agent: median and largest context, and how much was paid as cache read', () => {
  const lines = [
    agent('a1', { ts: NOW - 3000, input: 0, cacheRead: 8000, cacheWrite5m: 2000 }), agent('a1', { ts: NOW - 1000, cacheRead: 99_999 }),
    agent('a2', { ts: NOW - 2000, input: 0, cacheRead: 0, cacheWrite5m: 4000 }),
    agent('a3', { ts: NOW - 2500, input: 0, cacheRead: 6000, cacheWrite1h: 0 }),
  ];
  const f = wasteSignals(lines, { now: NOW }).total.firstTurn;
  assert.deepEqual([f.median, f.max], [6000, 10_000]);
  assert.deepEqual([f.readTokens, f.writeTokens], [14_000, 6000]);
  assert.equal(f.readShare, 0.7);
});

test('each project has its own figures', () => {
  const w = wasteSignals([row({ project: 'a' }), row({ project: 'b', cost: { total: 3 } })], { now: NOW });
  assert.deepEqual(Object.keys(w.byProject).sort(), ['a', 'b']);
  assert.equal(w.byProject.b.usd, 3);
});
