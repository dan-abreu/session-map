import { log } from '../log.mjs';

// The foundation's reading round for one project (index § 1): census -> facts -> model -> health, versions, profile ->
// up to date. Each block appends its step here, in that order: { name, run(ctx) }. What a step returns lands in
// ctx.results[name] for the steps after it. The shell itself writes nothing.
export const STEPS = [];
export const MIN_GAP_MS = 30_000;

// smDir|projectId -> { running: Promise | null, startedAt }
const rounds = new Map();

function refusal(key, nowMs) {
  const round = rounds.get(key);
  if (round?.running) return 'running';
  if (round && nowMs - round.startedAt < MIN_GAP_MS) return 'too-soon';
  return null;
}

async function runSteps(project, smDir, steps, careMode) {
  const ctx = { project, smDir, careMode, results: {} };
  const report = [];
  for (const step of steps) {
    const started = Date.now();
    try {
      ctx.results[step.name] = await step.run(ctx);
      report.push({ name: step.name, ok: true, ms: Date.now() - started });
    } catch (err) {
      // One broken step must not leave the others unread.
      log('warn', 'foundation-step-failed', { projectId: project.id, step: step.name, error: err.message });
      report.push({ name: step.name, ok: false, ms: Date.now() - started, error: err.message });
    }
  }
  return { ran: true, steps: report };
}

// careMode: the care mode to use in memory for this round, without writing care.json (the B7 proof runs this way).
export function refreshFoundation(project, smDir, { steps = STEPS, careMode, now = Date.now } = {}) {
  const key = `${smDir}|${project.id}`;
  const reason = refusal(key, now());
  if (reason) return Promise.resolve({ ran: false, reason });
  const round = { startedAt: now(), running: null };
  rounds.set(key, round);
  round.running = runSteps(project, smDir, steps, careMode).finally(() => { round.running = null; });
  return round.running;
}

// For POST refresh: answers at once whether a round started; the round goes on in the background.
export function startRefresh(project, smDir, opts = {}) {
  const reason = refusal(`${smDir}|${project.id}`, (opts.now ?? Date.now)());
  if (reason) return { started: false, reason };
  refreshFoundation(project, smDir, opts).catch((err) => log('warn', 'foundation-refresh-failed', { projectId: project.id, error: err.message }));
  return { started: true };
}
