import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTurnOf, summarizeFirstTurns } from '../server/ai/cache-share.mjs';

// sv17: how much of an agent's first turn is read from the prompt cache, and why the rest is written.

const line = (role, at, usage, model = 'claude-sonnet-5-5') => JSON.stringify({ timestamp: new Date(at).toISOString(), message: { role, model, usage } });
const T0 = Date.parse('2026-10-16T10:00:00Z');
const MIN = 60_000;

test('the first assistant turn gives the model, the moment and what it read and wrote; the rest of the transcript is ignored', () => {
  const text = [
    JSON.stringify({ message: { role: 'user', content: 'hi' } }),
    line('assistant', T0, { cache_read_input_tokens: 100, cache_creation_input_tokens: 27_000 }),
    line('assistant', T0 + 1000, { cache_read_input_tokens: 27_000, cache_creation_input_tokens: 300 }),
  ].join('\n');
  assert.deepEqual(firstTurnOf(text), { model: 'claude-sonnet-5-5', at: T0, read: 100, write: 27_000 });
  assert.equal(firstTurnOf(''), null);
  assert.equal(firstTurnOf('not json "usage"\n'), null);
  assert.equal(firstTurnOf(line('user', T0, { cache_read_input_tokens: 1 })), null);
});

test('an agent that starts within five minutes of another of its model is warm; one that finds nothing warm is cold', () => {
  const turns = [
    { model: 'opus', at: T0, read: 0, write: 27_000 }, // cold, wrote
    { model: 'opus', at: T0 + 2 * MIN, read: 26_000, write: 1_000 }, // warm, hit
    { model: 'opus', at: T0 + 3 * MIN, read: 0, write: 27_000 }, // warm, missed (another start of the prompt)
    { model: 'sonnet', at: T0 + 4 * MIN, read: 0, write: 15_000 }, // cold: no sonnet before it
    { model: 'opus', at: T0 + 30 * MIN, read: 0, write: 27_000 }, // cold: the cache expired
  ];
  const s = summarizeFirstTurns(turns);
  assert.equal(s.agents, 5);
  assert.deepEqual(s.warm, { agents: 2, hits: 1, hitPct: 50 });
  assert.deepEqual(s.cold, { agents: 3, hits: 0, hitPct: 0 });
  assert.equal(s.readSharePct, Math.round((100 * 26_000) / (26_000 + 27_000 * 3 + 1_000 + 15_000)));
  assert.deepEqual(s.byModel.sonnet, { agents: 1, readSharePct: 0 });
});

test('nothing in, nothing invented; a synthetic model is left out; the order of the list does not matter', () => {
  assert.deepEqual(summarizeFirstTurns([]).warm, { agents: 0, hits: 0, hitPct: 0 });
  assert.equal(summarizeFirstTurns(undefined).agents, 0);
  const shuffled = [
    { model: 'opus', at: T0 + MIN, read: 20_000, write: 0 },
    { model: '<synthetic>', at: T0, read: 0, write: 0 },
    { model: 'opus', at: T0, read: 0, write: 20_000 },
  ];
  const s = summarizeFirstTurns(shuffled);
  assert.equal(s.agents, 2);
  assert.deepEqual(s.warm, { agents: 1, hits: 1, hitPct: 100 });
});
