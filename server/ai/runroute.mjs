import { roleOf } from './agents.mjs';
import { OBEY_ROWS, entryGate, readGuardOpen } from '../chat/guard.mjs';
import { executeRun, mergeRun } from './agents-run.mjs';
import { engineCommands, enginesStatus, findDsh } from './agent-engines.mjs';
import { getKey } from './keys.mjs';
import { AI_FUNCTIONS, effectiveFunctionsOf, obeyOf } from './brainpanel.mjs';
import { levelFor } from './policy.mjs';
import { aiRunnerDir, runClaudeJSON } from './runner.mjs';
import { runApiJSON } from './providers.mjs';
import { recordActivity } from './activity.mjs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headerAuth } from './askroute.mjs';
import { specialistCard, specialistForFiles } from './specialists.mjs';
import { loadSpecialists } from './specialists-load.mjs';

// The other engines' trigger (id151, or63): POST /api/ai/run runs one specialist role on another AI's official CLI in
// an isolated copy; POST /api/ai/merge brings the copy back, only after the conductor's review said yes and the tests
// in the copy are green. The same entry gates the guard holds run first (entryGate); a provider whose CLI is not installed is refused before anything runs. The runs live in memory: a restart leaves the
// branch in git, never merged. Loopback and the same token as the arsenal; never in the demo.

const PROVIDERS = new Set(['openai', 'gemini', 'deepseek']);
const execGit = promisify(execFile);

// The Cérebro obeyed (id176): with the owner's switch on, a run goes to the AI the row of its kind names, and the program
// itself reviews the delivery with the Review row's AI before it merges: the caller's "accepted" is not enough. A refused
// review sends the findings back to the author; after REVIEW_ROUNDS refusals on one task the work stops for the owner.
const REVIEW_ROUNDS = 2;
const DIFF_MAX = 60 * 1024;
const REVIEW_SCHEMA = '{"accept": true, "defects": ["file:line — what is wrong and why"]}';
export function reviewPrompt({ kind, task, diff, tests }) {
  return [
    "You review a delivery before it is merged into the owner's project. Another AI wrote it in an isolated copy.",
    `Kind of work: ${kind}. The task it was given:`,
    String(task ?? '').slice(0, 4000),
    tests ? `Tests in the copy: ${tests.passed ? 'passed' : 'FAILED'}.` : 'No tests were named for this run.',
    'The diff (git diff of the copy against the project):',
    diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n[diff cut at ${DIFF_MAX} bytes]` : diff,
    'Accept only when the change does what the task asks, is correct and breaks nothing visible here. List each real defect with its file and line; style alone is not a defect.',
  ].join('\n\n');
}

// The reviewer of a run: the Review row's AI, model and level; another family than the author (a delivery by the AI the
// row names goes to Claude). Claude answers through its CLI with no tools, the others through their API.
export function reviewerFor(ai, author) {
  const row = effectiveFunctionsOf(ai).review ?? {};
  const named = typeof row.provider === 'string' && row.provider !== 'auto' ? row.provider : 'claude';
  const provider = named === author ? 'claude' : named;
  const set = (v) => typeof v === 'string' && v && v !== 'auto';
  if (provider === 'claude') {
    const base = levelFor('review');
    const mine = named === 'claude';
    return { provider, model: mine && set(row.model) ? row.model : base.model, effort: mine && set(row.effort) ? row.effort : base.effort };
  }
  return { provider, ...(set(row.model) ? { model: row.model } : {}), ...(set(row.effort) ? { effort: row.effort } : {}) };
}
const PROVIDER_NOTE = { openai: 'Codex', gemini: 'Gemini', deepseek: 'DeepSeek' };

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

// open (id154): the brief gates hold only in the strict mode of config.json, read at each run.
export function createRunRoutes({ smDir, demo = false, token = '', backend = null, keyOf = null, exec = null, bin = null, dshOf = () => findDsh(), now = () => Date.now(), open = () => readGuardOpen(smDir), review = null, diffOf = null, specialistsOf = (root) => loadSpecialists({ root }) } = {}) {
  const runs = new Map();
  const status = () => enginesStatus({ bin: bin ?? undefined });
  const keyFor = keyOf ?? (backend ? (provider) => getKey(smDir, provider, { backend }) : () => null);
  const configAi = () => { try { return JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'))?.ai; } catch { return undefined; } };

  async function run(body) {
    const role = roleOf(String(body?.kind ?? ''));
    if (!role) return { status: 400, body: { ok: false, error: 'unknown-kind' } };
    const provider = String(body.provider ?? '');
    if (!PROVIDERS.has(provider)) return { status: 400, body: { ok: false, error: 'unknown-provider' } };
    // The Cérebro obeyed (id176): the work goes to the AI its row names, no other.
    if (obeyOf(configAi())) {
      const rowId = AI_FUNCTIONS.find((f) => (f.kinds ?? []).includes(role.kinds[0]))?.id;
      const named = rowId ? effectiveFunctionsOf(configAi())[rowId]?.provider : null;
      const on = typeof named === 'string' && named !== 'auto' ? named : 'claude';
      // The rows the guard holds (code, screen, debug); the others stay free to hand to any AI.
      if (OBEY_ROWS.has(rowId) && on !== provider) {
        const note = on === 'claude' ? `the Cérebro gives ${role.kinds[0]} work to Claude: hand it to an agent whose description starts with [${role.kinds[0]}]` : `the Cérebro gives ${role.kinds[0]} work to ${on}: run it with provider ${on}`;
        return { status: 400, body: { ok: false, error: 'not-the-row', note } };
      }
    }
    const task = String(body.task ?? '');
    const entry = entryGate(role, task, role.kinds[0], { open: open() });
    if (!entry.ok) return { status: 400, body: { ok: false, error: 'gate', reason: entry.reason } };
    const st = status();
    if (st[provider]?.edits === 'api') return { status: 400, body: { ok: false, error: 'not-installed', note: st[provider]?.note ?? '' } };
    if (typeof body.cwd !== 'string' || !body.cwd) return { status: 400, body: { ok: false, error: 'no-cwd' } };
    // The DeepSeek Harness signs in by itself (id156): its run asks for no key. Claude Code pointed at DeepSeek needs one.
    const dsh = provider === 'deepseek' && st.deepseek?.edits === 'worktree' ? dshOf() : null;
    let token = '';
    if (provider === 'deepseek' && !dsh) {
      token = (await keyFor('deepseek').catch(() => null)) ?? '';
      if (!token) return { status: 400, body: { ok: false, error: 'no-key', note: 'no DeepSeek key saved' } };
    }
    // The domain specialist (id158, or68): named by id, or found from the files the work touches; its card rides the
    // brief. Work with neither runs as before, with the role alone.
    let specialist = null;
    // `specialist` wins over `files`; files that are not a list of paths are refused, not ignored.
    if (body.specialist === undefined && body.files !== undefined && !(Array.isArray(body.files) && body.files.every((f) => typeof f === 'string'))) {
      return { status: 400, body: { ok: false, error: 'bad-files', note: 'files is a list of project paths' } };
    }
    if (body.specialist !== undefined || body.files !== undefined) {
      const loaded = await specialistsOf(body.cwd);
      if (!loaded?.ok) return { status: 400, body: { ok: false, error: 'no-specialists', note: 'the project has no architecture map in its working tree' } };
      specialist = body.specialist !== undefined
        ? loaded.specialists.find((s) => s.id === String(body.specialist)) ?? null
        : specialistForFiles(body.files.map(String), loaded.arch, loaded.specialists);
      if (body.specialist !== undefined && !specialist) return { status: 400, body: { ok: false, error: 'unknown-specialist' } };
    }
    // OpenAI and Gemini run on their own programs with the owner's key for this run (id171): no key, no run.
    const keys = {};
    if (provider === 'openai' || provider === 'gemini') {
      keys[provider] = (await keyFor(provider).catch(() => null)) ?? '';
      if (!keys[provider]) return { status: 400, body: { ok: false, error: 'no-key', note: `no ${provider} key saved` } };
    }
    const commands = engineCommands({ deepseekToken: token, dsh, keys, smDir })[provider];
    const engine = { command: commands.command };
    if (body.tests && typeof body.tests === 'object' && typeof body.tests.command === 'string') {
      engine.tests = { command: body.tests.command, args: Array.isArray(body.tests.args) ? body.tests.args : [] };
    }
    // The model and level the owner chose in the Cérebro for this kind of work ride on the run, when that row names this AI.
    const row = AI_FUNCTIONS.find((f) => (f.kinds ?? []).includes(role.kinds[0]));
    const picked = row ? effectiveFunctionsOf(configAi())[row.id] : null;
    const choice = picked && picked.provider === provider ? { model: picked.model, effort: picked.effort } : null;
    const out = await executeRun({ cwd: body.cwd, role, task, card: specialist ? specialistCard(specialist) : '', kind: role.kinds[0], engine, choice, open: open(), ...(exec ? { exec } : {}), now: now() });
    if (out.ok) runs.set(out.runId, { run: out, cwd: body.cwd, provider, task, kind: role.kinds[0], at: now() });
    if (!out.ok) return { status: 500, body: { ok: false, error: out.error ?? 'run-failed', reason: out.reason ?? '' } };
    return { status: 200, body: { ok: true, provider, runId: out.runId, branch: out.branch, tests: out.tests, steps: out.steps, committed: out.committed, answer: out.answer, specialist: specialist?.id ?? null, applied: choice && (choice.model || choice.effort) ? choice : null } };
  }

  // Rounds per project and kind of work (id176): the retry carries the defects, so its task text is never the same; an
  // accepted review starts the count again.
  const refusals = new Map();
  const reviewing = new Set(); // runs under review: a second merge call waits for the first, never pays twice
  const taskKey = (kept) => createHash('sha256').update(`${kept.cwd}\n${kept.kind}`).digest('hex').slice(0, 16);
  const gitDiff = diffOf ?? (async (kept) => (await execGit('git', ['diff', `HEAD...${kept.run.branch}`], { cwd: kept.cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout);
  const askReviewer = review ?? (async (who, prompt) => {
    if (who.provider === 'claude') return runClaudeJSON(prompt, { model: who.model, effort: who.effort, cwd: aiRunnerDir(smDir), schemaHint: REVIEW_SCHEMA, ...(bin ? { bin } : {}) });
    const key = await Promise.resolve(keyFor(who.provider)).catch(() => null);
    if (!key) return { ok: false, error: 'no-key' };
    return runApiJSON(prompt, { provider: who.provider, model: who.model, key, schemaHint: REVIEW_SCHEMA, maxTokens: 8192, ...(who.effort ? { effort: who.effort } : {}) });
  });

  // The program's own review (id176): the Review row's AI reads the diff, and its verdict is the merge's gate.
  async function programReview(kept) {
    let diff = '';
    try { diff = String((await gitDiff(kept)) ?? ''); } catch { return { ok: false, error: 'no-diff' }; }
    if (!diff.trim()) return { ok: true, accept: false, defects: ['the run changed nothing'], reviewer: null };
    // A delivery cut to fit would be reviewed on its first part and merged whole: too big is a refusal, split the task.
    if (Buffer.byteLength(diff) > DIFF_MAX) return { ok: true, accept: false, tooBig: true, defects: [`the diff is ${Math.round(Buffer.byteLength(diff) / 1024)} KB, over the ${DIFF_MAX / 1024} KB a review reads: split the task into smaller runs`], reviewer: null };
    const who = reviewerFor(configAi(), kept.provider);
    const t0 = now();
    const res = await askReviewer(who, reviewPrompt({ kind: kept.kind, task: kept.task, diff, tests: kept.run.tests }));
    recordActivity(smDir, { source: 'chat', kind: 'review', sensitivity: 'internal', provider: who.provider, model: who.model ?? res?.model ?? '', ms: now() - t0, costUSD: Number(res?.costUSD) || 0, tokensIn: res?.tokensIn, tokensOut: res?.tokensOut, ok: Boolean(res?.ok), ...(res?.ok ? {} : { error: String(res?.error ?? 'failed') }) });
    if (!res?.ok || typeof res.value?.accept !== 'boolean') return { ok: false, error: res?.error ?? 'bad-review' };
    const defects = Array.isArray(res.value.defects) ? res.value.defects.map((d) => String(d).slice(0, 400)).slice(0, 20) : [];
    return { ok: true, accept: res.value.accept === true, defects, reviewer: who };
  }

  async function merge(body) {
    const kept = runs.get(String(body?.runId ?? ''));
    if (!kept) return { status: 404, body: { ok: false, error: 'unknown-run' } };
    let reviewed = null;
    if (obeyOf(configAi())) {
      if (!kept.run?.ok || (kept.run.tests && !kept.run.tests.passed)) return { status: 400, body: { ok: false, error: kept.run?.ok ? 'tests-failed' : 'run-failed' } };
      const id = String(body.runId);
      if (reviewing.has(id)) return { status: 409, body: { ok: false, error: 'review-running', note: 'this run is already under review' } };
      reviewing.add(id);
      let verdict;
      try { verdict = await programReview(kept); } finally { reviewing.delete(id); }
      if (!verdict.ok) return { status: 502, body: { ok: false, error: 'review-failed', note: `the program's review did not answer (${verdict.error}); nothing merged, call merge_other_ai again` } };
      reviewed = verdict.reviewer;
      if (!verdict.accept) {
        const key = taskKey(kept);
        const round = (refusals.get(key) ?? 0) + (verdict.tooBig ? 0 : 1);
        if (!verdict.tooBig) refusals.set(key, round);
        const stop = round >= REVIEW_ROUNDS;
        const note = stop ? `refused ${round} times: stop and tell the owner, with the defects` : 'send the defects back to the same AI: run_other_ai again on the same row, the defects in the task';
        return { status: 409, body: { ok: false, error: 'review-refused', round, stop, defects: verdict.defects, reviewer: verdict.reviewer, note } };
      }
      refusals.delete(taskKey(kept));
    } else if (body?.accepted !== true) return { status: 400, body: { ok: false, error: 'not-accepted', note: 'the review must accept it first' } };
    return mergeRun({ cwd: kept.cwd, run: kept.run, ...(exec ? { exec } : {}) }).then((out) => {
      if (!out.ok) return { status: 400, body: { ok: false, error: out.reason } };
      runs.delete(String(body.runId));
      return { status: 200, body: { ok: true, merged: out.merged, why: String(body.why ?? '').slice(0, 200), ...(reviewed ? { reviewedBy: reviewed } : {}) } };
    });
  }

  async function handle(req, url) {
    if (demo) return { status: 403, body: { ok: false, error: 'demo' } };
    if (req.method !== 'POST') return { status: 405, body: { ok: false, error: 'method' } };
    const body = await readBody(req);
    if (body === null) return { status: 400, body: { ok: false, error: 'bad-json' } };
    if (url.pathname === '/api/ai/run') return run(body);
    if (url.pathname === '/api/ai/merge') return merge(body);
    return { status: 404, body: { ok: false, error: 'not-found' } };
  }

  return {
    handles: (path) => path === '/api/ai/run' || path === '/api/ai/merge',
    authorizeHeader: (req, url, address) => ((url.pathname === '/api/ai/run' || url.pathname === '/api/ai/merge') ? headerAuth(req, address, token) : null),
    handle,
    PROVIDER_NOTE,
  };
}
