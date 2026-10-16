import { roleOf } from './agents.mjs';
import { entryGate, readGuardOpen } from '../chat/guard.mjs';
import { executeRun, mergeRun } from './agents-run.mjs';
import { engineCommands, enginesStatus, findDsh } from './agent-engines.mjs';
import { getKey } from './keys.mjs';
import { AI_FUNCTIONS, functionsOf } from './brainpanel.mjs';
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
const PROVIDER_NOTE = { openai: 'Codex', gemini: 'Gemini', deepseek: 'DeepSeek' };

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

// open (id154): the brief gates hold only in the strict mode of config.json, read at each run.
export function createRunRoutes({ smDir, demo = false, token = '', backend = null, keyOf = null, exec = null, bin = null, dshOf = () => findDsh(), now = () => Date.now(), open = () => readGuardOpen(smDir), specialistsOf = (root) => loadSpecialists({ root }) } = {}) {
  const runs = new Map();
  const status = () => enginesStatus({ bin: bin ?? undefined });
  const keyFor = keyOf ?? (backend ? (provider) => getKey(smDir, provider, { backend }) : () => null);
  const configAi = () => { try { return JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'))?.ai; } catch { return undefined; } };

  async function run(body) {
    const role = roleOf(String(body?.kind ?? ''));
    if (!role) return { status: 400, body: { ok: false, error: 'unknown-kind' } };
    const provider = String(body.provider ?? '');
    if (!PROVIDERS.has(provider)) return { status: 400, body: { ok: false, error: 'unknown-provider' } };
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
    const commands = engineCommands({ deepseekToken: token, dsh })[provider];
    const engine = { command: commands.command };
    if (body.tests && typeof body.tests === 'object' && typeof body.tests.command === 'string') {
      engine.tests = { command: body.tests.command, args: Array.isArray(body.tests.args) ? body.tests.args : [] };
    }
    // The model and level the owner chose in the Cérebro for this kind of work ride on the run, when that row names this AI.
    const row = AI_FUNCTIONS.find((f) => (f.kinds ?? []).includes(role.kinds[0]));
    const picked = row ? functionsOf(configAi())[row.id] : null;
    const choice = picked && picked.provider === provider ? { model: picked.model, effort: picked.effort } : null;
    const out = await executeRun({ cwd: body.cwd, role, task, card: specialist ? specialistCard(specialist) : '', kind: role.kinds[0], engine, choice, open: open(), ...(exec ? { exec } : {}), now: now() });
    if (out.ok) runs.set(out.runId, { run: out, cwd: body.cwd, provider, at: now() });
    if (!out.ok) return { status: 500, body: { ok: false, error: out.error ?? 'run-failed', reason: out.reason ?? '' } };
    return { status: 200, body: { ok: true, provider, runId: out.runId, branch: out.branch, tests: out.tests, steps: out.steps, committed: out.committed, answer: out.answer, specialist: specialist?.id ?? null, applied: choice && (choice.model || choice.effort) ? choice : null } };
  }

  function merge(body) {
    const kept = runs.get(String(body?.runId ?? ''));
    if (!kept) return { status: 404, body: { ok: false, error: 'unknown-run' } };
    if (body?.accepted !== true) return { status: 400, body: { ok: false, error: 'not-accepted', note: 'the review must accept it first' } };
    return mergeRun({ cwd: kept.cwd, run: kept.run, ...(exec ? { exec } : {}) }).then((out) => {
      if (!out.ok) return { status: 400, body: { ok: false, error: out.reason } };
      runs.delete(String(body.runId));
      return { status: 200, body: { ok: true, merged: out.merged, why: String(body.why ?? '').slice(0, 200) } };
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
