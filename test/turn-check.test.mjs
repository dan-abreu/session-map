import test from 'node:test';
import assert from 'node:assert/strict';
import { contextTokens, turnCheck } from '../server/chat/turn-check.mjs';
import { loadPrices } from '../server/cost.mjs';

// The OK at the end of a request (or26): read from the turn's transcript and git, no AI.

const prices = loadPrices();
const START = Date.parse('2026-10-13T10:00:00Z');
const at = (s) => new Date(START + s * 1000).toISOString();
const usage = { input_tokens: 1000, output_tokens: 1000 };

let n = 0;
const reply = (s, content, id = `m${++n}`) => ({ type: 'assistant', timestamp: at(s), message: { id, model: 'claude-sonnet-5-5', usage, content } });
const call = (s, name, input, id = `t${++n}`) => ({ entry: reply(s, [{ type: 'tool_use', id, name, input }]), id });
const result = (s, id, text, isError = false) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } });
const edit = (s, file) => call(s, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' }).entry;
const run = (s, command, text, isError = false) => {
  const c = call(s, 'Bash', { command });
  return [c.entry, result(s + 1, c.id, text, isError)];
};
const NODE_OK = 'ℹ tests 12\nℹ pass 12\nℹ fail 0\nℹ cancelled 0';
const NODE_BAD = 'ℹ tests 12\nℹ pass 10\nℹ fail 2\nℹ cancelled 0';
const base = { startedAt: START, gitBefore: { plans: {} }, gitAfter: { commits: [], plans: {} }, prices };

test('tests that passed, an item ticked and the work saved make an OK with the cost', () => {
  const plan = (box) => ({ 'docs/architecture/orchestration.md': `- [${box}] An OK at the end of each request \`or26\`\n- [ ] Other \`or27\`\n` });
  const check = turnCheck({
    ...base,
    entries: [edit(1, 'C:/p/server/a.mjs'), ...run(3, 'npm test', NODE_OK), reply(9, [{ type: 'text', text: 'done' }])],
    gitBefore: { plans: plan(' ') },
    gitAfter: { commits: [{ hash: 'a1b2c3d4e5f', at: START + 8000, subject: 'feat(chat): ok (or26)' }], plans: plan('x') },
  });
  assert.deepEqual(check.tests, { ran: 12, passed: 12, failed: 0, command: 'npm test' });
  assert.deepEqual(check.ticked, ['or26']);
  assert.deepEqual(check.saved, ['a1b2c3d']);
  assert.deepEqual(check.missing, []);
  assert.ok(check.costUSD > 0);
});

test('tests that failed are reported and the last run of the turn counts', () => {
  const check = turnCheck({ ...base, entries: [edit(1, 'a.mjs'), ...run(2, 'npm test', NODE_OK), ...run(5, 'node --test test/a.test.mjs', NODE_BAD)] });
  assert.equal(check.tests.failed, 2);
  assert.equal(check.tests.command, 'node --test test/a.test.mjs');
  assert.ok(check.missing.includes('tests-failed'));
  const later = turnCheck({ ...base, entries: [...run(2, 'npm test', NODE_BAD), ...run(5, 'npm test', NODE_OK)] });
  assert.equal(later.tests.failed, 0);
  assert.ok(!later.missing.includes('tests-failed'));
});

test('a tool error or a FAIL line is a failed run', () => {
  assert.equal(turnCheck({ ...base, entries: run(2, 'pytest -q', '1 failed, 3 passed') }).tests.failed, 1);
  assert.ok(turnCheck({ ...base, entries: run(2, 'npx vitest run', 'boom', true) }).tests.failed > 0);
  assert.equal(turnCheck({ ...base, entries: run(2, 'go test ./...', 'ok  pkg 0.1s') }).tests.failed, 0);
});

test('code changed and no tests ran, nothing saved', () => {
  const check = turnCheck({ ...base, entries: [edit(1, 'C:/p/server/a.mjs'), reply(3, [{ type: 'text', text: 'done' }])] });
  assert.equal(check.tests, null);
  assert.deepEqual(check.missing, ['no-tests', 'not-saved']);
});

test('an item worked on in a commit but left unticked', () => {
  const plan = { 'docs/architecture/orchestration.md': '- [ ] An OK `or26`\n' };
  const check = turnCheck({
    ...base,
    entries: [edit(1, 'a.mjs'), ...run(2, 'npm test', NODE_OK)],
    gitBefore: { plans: plan },
    gitAfter: { commits: [{ hash: 'abcdef123', at: START + 5000, subject: 'feat(x): y (or26)' }], plans: plan },
  });
  assert.deepEqual(check.missing, ['not-ticked']);
});

test('a plan edit in the turn ticks without git plan texts', () => {
  const e = call(1, 'Edit', { file_path: 'C:/p/docs/architecture/orchestration.md', old_string: '- [ ] An OK `or26`', new_string: '- [x] An OK `or26`' }).entry;
  assert.deepEqual(turnCheck({ ...base, entries: [e] }).ticked, ['or26']);
});

test('a turn that only talked has nothing missing, only a cost', () => {
  const check = turnCheck({ ...base, entries: [reply(1, [{ type: 'text', text: 'oi' }])] });
  assert.deepEqual(check, { tests: null, roles: [], ticked: [], saved: [], costUSD: check.costUSD, missing: [] });
  assert.ok(check.costUSD > 0);
});

test('replies before the turn started do not count, and a repeated message counts once', () => {
  const old = reply(-100, [{ type: 'text', text: 'old' }], 'old');
  const a = reply(1, [{ type: 'text', text: 'x' }], 'same');
  const b = reply(2, [{ type: 'text', text: 'x' }], 'same');
  const one = turnCheck({ ...base, entries: [a] }).costUSD;
  assert.equal(turnCheck({ ...base, entries: [old, a, b] }).costUSD, one);
});

test('jest counts tests not suites, a skipped test named "failed" is no failure, and a failed edit is no change', () => {
  const jest = turnCheck({ ...base, entries: run(2, 'npx jest', 'Test Suites: 1 failed, 1 total\nTests:       3 failed, 7 passed, 10 total') });
  assert.deepEqual([jest.tests.failed, jest.tests.passed, jest.tests.ran], [3, 7, 10]);
  const skipped = turnCheck({ ...base, entries: run(2, 'npx jest', 'handles failed requests\nTests: 7 passed, 7 total') });
  assert.equal(skipped.tests.failed, 0);
  const bad = call(1, 'Edit', { file_path: 'a.mjs', old_string: 'x', new_string: 'y' });
  assert.deepEqual(turnCheck({ ...base, entries: [bad.entry, result(2, bad.id, 'not found', true)] }).missing, []);
});

test('markdown edits are no code change', () => {
  assert.deepEqual(turnCheck({ ...base, entries: [edit(1, 'README.md')] }).missing, []);
});

// The roles that worked (or58): each agent's kind maps to the catalog's role, and each one is charged its proof.
const agentCall = (s, description, id = `a${++n}`) => call(s, 'Agent', { description, prompt: 'p' }, id);

test('the roles that worked are read from the agent calls, mapped to the catalog', () => {
  const check = turnCheck({
    ...base,
    entries: [agentCall(1, '[code] fix the header').entry, agentCall(2, '[review] check the diff').entry, reply(9, [{ type: 'text', text: 'done' }])],
  });
  assert.deepEqual(check.roles, ['coder', 'reviewer']);
});

test('a planner that worked without a plan on paper leaves role-plan', () => {
  const withPlan = turnCheck({ ...base, entries: [agentCall(1, '[plan] the build').entry, edit(2, 'docs/superpowers/plans/2026-10-15-x.md'), reply(9, [{ type: 'text', text: 'done' }])] });
  assert.ok(!withPlan.missing.includes('role-plan'), 'the plan doc was edited');
  assert.deepEqual(withPlan.roles, ['planner']);
  const without = turnCheck({ ...base, entries: [agentCall(1, '[plan] the build').entry, reply(9, [{ type: 'text', text: 'done' }])] });
  assert.ok(without.missing.includes('role-plan'), 'no plan doc, no exit');
});

test('a coder that worked and changed code still owes its tests: the roles do not soften the old gates', () => {
  const check = turnCheck({ ...base, entries: [agentCall(1, '[code] fix the header').entry, edit(2, 'C:/p/server/a.mjs'), reply(9, [{ type: 'text', text: 'done' }])] });
  assert.deepEqual(check.roles, ['coder']);
  assert.ok(check.missing.includes('no-tests'));
});

test('the memory a conversation carries is the prompt side of its last reply, none when no reply reported any (pc37)', () => {
  const sized = (s, u, extra = {}) => ({ ...reply(s, [{ type: 'text', text: 'x' }]), ...extra, message: { id: `s${s}`, model: 'claude-sonnet-5-5', usage: u, content: [] } });
  const entries = [
    sized(1, { input_tokens: 10, cache_creation_input_tokens: 4000, cache_read_input_tokens: 30000, output_tokens: 5 }),
    sized(2, { input_tokens: 20, cache_creation_input_tokens: 1000, cache_read_input_tokens: 41000, output_tokens: 5 }),
    sized(3, { input_tokens: 999999, output_tokens: 1 }, { isSidechain: true }),
    result(4, 'x', 'ok'),
  ];
  assert.equal(contextTokens(entries), 42020);
  assert.equal(contextTokens([]), null);
  assert.equal(contextTokens([result(1, 'x', 'ok')]), null);
  assert.equal(contextTokens(undefined), null);
});
