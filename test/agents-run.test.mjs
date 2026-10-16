import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRun, mergeRun, planRun, roleBrief } from '../server/ai/agents-run.mjs';
import { roleOf } from '../server/ai/agents.mjs';

// The executor of the other engines (id93 step 4, or61): the same role, the same entry gates, an isolated copy.
const coder = roleOf('code');
const money = roleOf('money');

test('the brief is the role line plus the task, and the plan names the branch and the copy', () => {
  const brief = roleBrief(coder, 'fix the header, run the tests');
  assert.match(brief, /^session-map-role: coder /);
  assert.match(brief, /fix the header, run the tests/);
  const plan = planRun({ cwd: 'C:/repo', role: coder, task: 'fix it, run the tests', now: Date.parse('2026-10-15T15:00:00Z') });
  assert.equal(plan.ok, true);
  assert.match(plan.branch, /^session-map\/agent-coder-/);
  assert.match(plan.dir, /\.session-map-runs[\\/]coder-/);
});

test('the same entry gates hold before the other engine runs', async () => {
  const noop = async () => {};
  const vague = await executeRun({ cwd: 'C:/repo', role: coder, task: 'fix the header.', engine: { command: () => ({ command: 'codex', args: [] }) }, exec: noop });
  assert.equal(vague.ok, false);
  assert.match(vague.reason, /brief must name the proof/);
  const pay = await executeRun({ cwd: 'C:/repo', role: money, kind: 'money', task: 'pay the invoice.', engine: { command: () => ({ command: 'claude', args: [] }) }, exec: noop });
  assert.equal(pay.ok, false);
  assert.match(pay.reason, /money belongs to the owner/);
});

test('a run walks the worktree, the engine, the tests — and merges only when they pass', async () => {
  const log = [];
  const exec = async (cmd, args) => {
    log.push([cmd, ...(args ?? [])].join(' '));
    if (cmd === 'node' && (args ?? []).includes('failing')) throw new Error('tests red');
  };
  const engine = {
    command: ({ brief }) => ({ command: 'codex', args: ['exec', brief] }),
    tests: { command: 'node', args: ['--test', 'failing'] },
  };
  const red = await executeRun({ cwd: 'C:/repo', role: coder, task: 'fix the header and run the tests', engine, exec });
  assert.equal(red.ok, true);
  assert.deepEqual(red.steps, ['worktree', 'run', 'commit', 'tests']);
  assert.equal(red.tests.passed, false);
  const refused = await mergeRun({ cwd: 'C:/repo', run: red, exec });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'tests-failed', 'red tests never merge');

  const green = await executeRun({ cwd: 'C:/repo', role: coder, task: 'fix the header and run the tests', engine: { command: engine.command, tests: { command: 'node', args: ['--test'] } }, exec });
  assert.equal(green.tests.passed, true);
  const merged = await mergeRun({ cwd: 'C:/repo', run: green, exec });
  assert.equal(merged.ok, true);
  assert.match(merged.merged, /^session-map\/agent-coder-/);
  assert.ok(log.some((l) => l.startsWith('git worktree add')), 'the copy was created');
  assert.ok(log.some((l) => l.startsWith('git merge --ff-only')), 'the green branch merged');
});

test('what the other AI wrote is committed in the copy, its answer comes back, and a run that changed nothing says so (id156)', async () => {
  const log = [];
  const exec = async (cmd, args) => {
    log.push([cmd, ...(args ?? [])].join(' '));
    if (cmd === 'codex') return { stdout: 'did it' };
    if (cmd === 'git' && args[0] === 'config') throw new Error('no identity');
    return { stdout: '' };
  };
  const engine = { command: ({ brief }) => ({ command: 'codex', args: ['exec', brief] }) };
  const done = await executeRun({ cwd: 'C:/repo', role: coder, task: 'fix the header and run the tests', engine, exec });
  assert.equal(done.committed, true);
  assert.equal(done.answer, 'did it');
  assert.ok(log.some((l) => l.startsWith('git add -A')), 'all of it is added');
  assert.ok(log.some((l) => /^git -c user.name=session-map -c user.email=session-map@localhost commit -m session-map: coder run /.test(l)), 'no identity in the repo: the commit carries one');
  const none = async (cmd, args) => {
    if (cmd === 'git' && args.includes('commit')) throw new Error('nothing to commit');
    return { stdout: '' };
  };
  const idle = await executeRun({ cwd: 'C:/repo', role: coder, task: 'fix the header and run the tests', engine, exec: none });
  assert.equal(idle.ok, true);
  assert.equal(idle.committed, false, 'nothing changed: said so, not hidden');
});
