import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitHitOf, planLimits } from '../server/sources/limits.mjs';

// The shapes Claude Code really writes when the plan says no (read from ~/.claude/projects histories).
const hit = (text, quota, extra = {}) => ({
  type: 'assistant', timestamp: '2026-09-29T22:50:22.414Z', error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429,
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
  ...(quota ? { quotaLimits: { status: 'rejected', ...quota } } : {}), ...extra,
});

test('limitHitOf: the weekly limit, with the reset time Claude Code wrote down', () => {
  const found = limitHitOf(hit("You've hit your weekly limit · resets Oct 1, 6pm (America/Fortaleza)", { resetsAt: 1790888400, rateLimitType: 'seven_day' }));
  assert.deepEqual(found, { kind: 'weekly', resetsAt: '2026-10-01T21:00:00.000Z', resetsText: 'Oct 1, 6pm (America/Fortaleza)', at: '2026-09-29T22:50:22.414Z' });
});

test('limitHitOf: the 5-hour session limit is its own kind', () => {
  const found = limitHitOf(hit("You've hit your session limit · resets 3:10am (America/Fortaleza)", { resetsAt: 1788502200, rateLimitType: 'five_hour' }));
  assert.equal(found.kind, 'session');
  assert.equal(found.resetsAt, '2026-09-04T06:10:00.000Z');
  assert.equal(found.resetsText, '3:10am (America/Fortaleza)');
});

test('limitHitOf: a monthly spend limit is not the plan weekly limit, even with seven_day type and a weekly reset in the words (real message)', () => {
  const spend = hit("You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message · your weekly limit resets Oct 8, 6pm (America/Fortaleza)", { resetsAt: 1791493200, rateLimitType: 'seven_day' });
  assert.equal(limitHitOf(spend), null);
});

test('limitHitOf: a reset time out of range does not throw, it is just unknown', () => {
  let found;
  assert.doesNotThrow(() => { found = limitHitOf(hit("You've hit your weekly limit · resets Oct 1, 6pm", { resetsAt: 1e20, rateLimitType: 'seven_day' })); });
  assert.equal(found.kind, 'weekly');
  assert.equal(found.resetsAt, null);
  assert.equal(found.resetsText, 'Oct 1, 6pm');
});

test('limitHitOf: with no structured data the words alone are enough, and the reset stays as written', () => {
  const found = limitHitOf(hit('Weekly limit reached ∙ resets Oct 9 at 3pm'));
  assert.deepEqual([found.kind, found.resetsAt, found.resetsText], ['weekly', null, 'Oct 9 at 3pm']);
  assert.equal(limitHitOf(hit('5-hour limit reached ∙ resets 3pm')).kind, 'session');
  const old = limitHitOf(hit('Claude AI usage limit reached|1790888400'));
  assert.equal(old, null, 'a limit with no weekly or 5-hour name is not told apart');
});

test('limitHitOf: a person or a tool talking about limits is not a limit hit', () => {
  const said = { type: 'assistant', timestamp: '2026-09-29T22:50:22.414Z', message: { role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets 6pm" }] } };
  assert.equal(limitHitOf(said), null, 'a normal reply that quotes the words');
  assert.equal(limitHitOf({ type: 'user', message: { role: 'user', content: "You've hit your weekly limit" } }), null);
  assert.equal(limitHitOf(hit('Request failed', { rateLimitType: 'overage' })), null);
  assert.equal(limitHitOf(null), null);
});

const NOW = Date.parse('2026-10-10T12:00:00Z');
const weekly = (resetsAt, at = '2026-10-09T12:00:00.000Z') => ({ kind: 'weekly', resetsAt, resetsText: 'x', at });

test('planLimits: a hit whose reset is still ahead is on, with the time to come back', () => {
  const out = planLimits([weekly('2026-10-12T21:00:00.000Z')], NOW);
  assert.deepEqual(out.weekly, { hit: true, resetsAt: '2026-10-12T21:00:00.000Z', resetsText: 'x' });
  assert.deepEqual(out.session, { hit: false, resetsAt: null, resetsText: null });
});

test('planLimits: a reset that has passed is off again', () => {
  assert.equal(planLimits([weekly('2026-10-08T21:00:00.000Z')], NOW).weekly.hit, false);
});

test('planLimits: the newest hit of a kind wins', () => {
  const out = planLimits([weekly('2026-10-08T21:00:00.000Z', '2026-10-01T00:00:00.000Z'), weekly('2026-10-15T21:00:00.000Z', '2026-10-09T00:00:00.000Z')], NOW);
  assert.equal(out.weekly.resetsAt, '2026-10-15T21:00:00.000Z');
});

test('planLimits: a hit with no known reset time holds for the whole window of its kind, no longer', () => {
  const noTime = (kind, at) => ({ kind, resetsAt: null, resetsText: 'Oct 9 at 3pm', at });
  assert.equal(planLimits([noTime('weekly', '2026-10-05T00:00:00.000Z')], NOW).weekly.hit, true, '5 days ago is still inside the week');
  assert.equal(planLimits([noTime('weekly', '2026-10-01T00:00:00.000Z')], NOW).weekly.hit, false, '9 days ago is past it');
  assert.equal(planLimits([noTime('session', '2026-10-10T09:00:00.000Z')], NOW).session.hit, true);
  assert.equal(planLimits([noTime('session', '2026-10-10T05:00:00.000Z')], NOW).session.hit, false, '7 hours ago is past 5 hours');
});

test('planLimits: nothing read means nothing hit', () => {
  assert.equal(planLimits([], NOW).weekly.hit, false);
});
