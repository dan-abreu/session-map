import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { roleLine } from './agents.mjs';
import { entryGate } from '../chat/guard.mjs';

// The executor of the other engines (id93 step 4, id151, or61): the same specialist role running on another AI's
// official agent (Codex CLI, Gemini CLI, DeepSeek through Claude Code's engine), editing files in an isolated git
// worktree. The program holds what the guard cannot see inside those processes: the entry gates before the run (the
// same entryGate the guard uses), the role's fixed brief, and the exit after it (the tests in the copy). The main
// tree is never touched: the work comes back through a merge the caller decides after the review.

const exec = promisify(execFile);

// A run that does not end in 15 minutes is cut; the answer kept is the last 4 KB the engine printed.
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const RUN_MAX_BUFFER = 8 * 1024 * 1024;
const ANSWER_MAX = 4000;

export const WORKTREE_PREFIX = 'session-map/agent-';
const stamp = (now = Date.now()) => new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

// The brief the other engine receives: the same fixed role line the guard writes into every agent, then the domain
// specialist's card when the work belongs to a part of the map (id158, or68), then the task.
export function roleBrief(role, task, card = '') {
  return `${roleLine(role)}\n${card ? `${card}\n\n` : ''}${String(task ?? '')}`;
}

// The plan of one isolated run: the branch, the folder and the brief — pure, nothing executed here.
export function planRun({ cwd, role, task, card = '', now = Date.now() }) {
  const runId = stamp(now);
  const branch = `${WORKTREE_PREFIX}${role.id}-${runId}`;
  const dir = join(cwd, '.session-map-runs', `${role.id}-${runId}`);
  return { ok: true, runId, branch, dir, brief: roleBrief(role, task, card) };
}

// One run, end to end, with every effect injected (exec) so the tests hold it without a real CLI: worktree add → the
// engine's command with the brief → the tests in the copy. The engine descriptor: {command: ({brief, dir, role}) => {command, args, env}, tests?: {command, args}}.
export async function executeRun({ cwd, role, task, card = '', kind = role.kinds[0], engine, choice = null, exec: run = exec, now = Date.now(), open = false }) {
  const plan = planRun({ cwd, role, task, card, now });
  const entry = entryGate(role, task, kind, { open });
  if (!entry.ok) return { ok: false, reason: entry.reason };
  const steps = [];
  try {
    await run('git', ['worktree', 'add', '-b', plan.branch, plan.dir], { cwd });
    steps.push('worktree');
    const call = engine.command({ brief: plan.brief, dir: plan.dir, role, choice });
    const ran = await run(call.command, call.args ?? [], { cwd: plan.dir, env: { ...process.env, ...(call.env ?? {}) }, timeout: RUN_TIMEOUT_MS, maxBuffer: RUN_MAX_BUFFER, windowsHide: true });
    steps.push('run');
    const answer = String(ran?.stdout ?? '').trim().slice(-ANSWER_MAX);
    // What the other AI wrote is committed in the copy, or the merge below would bring nothing back. Nothing changed:
    // the commit says so and the run reports committed false.
    await run('git', ['add', '-A'], { cwd: plan.dir });
    const who = await Promise.resolve(run('git', ['config', 'user.email'], { cwd: plan.dir })).then((r) => String(r?.stdout ?? '').trim(), () => '');
    let committed = true;
    try {
      await run('git', [...(who ? [] : ['-c', 'user.name=session-map', '-c', 'user.email=session-map@localhost']), 'commit', '-m', `session-map: ${role.id} run ${plan.runId}`], { cwd: plan.dir });
    } catch {
      committed = false;
    }
    steps.push('commit');
    let tests = null;
    if (engine.tests) {
      try {
        await run(engine.tests.command, engine.tests.args ?? [], { cwd: plan.dir });
        tests = { passed: true };
      } catch {
        tests = { passed: false };
      }
      steps.push('tests');
    }
    return { ok: true, runId: plan.runId, branch: plan.branch, dir: plan.dir, tests, steps, committed, answer, choice };
  } catch (e) {
    return { ok: false, runId: plan.runId, branch: plan.branch, dir: plan.dir, steps, error: String(e?.message ?? e).slice(0, 200) };
  }
}

// The merge, only for a run that finished and passed its tests: fast-forward the branch into the main tree and drop
// the copy. A run without tests merges on the caller's word (the review came first).
export async function mergeRun({ cwd, run, exec: runExec = exec }) {
  if (!run?.ok) return { ok: false, reason: 'run-failed' };
  if (run.tests && !run.tests.passed) return { ok: false, reason: 'tests-failed' };
  try {
    await runExec('git', ['merge', '--ff-only', run.branch], { cwd });
    await runExec('git', ['worktree', 'remove', run.dir], { cwd });
    return { ok: true, merged: run.branch };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
  }
}
