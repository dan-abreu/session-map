import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cookieToken, isLocal, sameToken } from '../auth.mjs';
import { logAction } from '../actions.mjs';
import { log } from '../log.mjs';
import { getKey } from './keys.mjs';
import { runApiJSON } from './providers.mjs';
import { levelsOf } from './efforts.mjs';
import { runClaudeJSON } from './runner.mjs';
import { withStance } from './stance.mjs';
import { mergeFunctionChoice, panelModel } from './brainpanel.mjs';
import { refreshBalances } from './balance-watch.mjs';
import { modelsFile } from './models.mjs';

// The Cérebro tab's route (id124, or39): GET /api/ai/brain -> the panel's model (matrix, functions, flow, rules);
// PATCH /api/ai/brain {functions: {id: {provider?, model?, effort?}}} saves the choices into config.json, whole or
// nothing. POST /api/ai/brain/configure asks the brain's own engine to propose a configuration from the person's
// words: the proposal comes back validated by the same script that saves, and nothing is written until the person
// applies it. POST /api/ai/brain/models reads the model list of every AI again, now (id168): the lists are read once a day by
// themselves, this is the button. Same loopback and token rules as the arsenal routes (askroute.mjs). Nothing here holds a key or a prompt.

const BRAIN_PATH = '/api/ai/brain';
const CONFIGURE_PATH = '/api/ai/brain/configure';
const MODELS_PATH = '/api/ai/brain/models';
// The first time the tab is opened there is no list yet: it waits this long for the makers to answer (Claude Code takes a few
// seconds), then draws with what is built in. Later openings never wait for it.
const FIRST_LIST_WAIT_MS = 9000;
const BODY_MAX = 64 * 1024;
const CONFIGURE_MAX = 2000;
const PROPOSAL_SCHEMA = '{"changes": [{"function": "<id>", "provider": "claude|openai|gemini|deepseek|auto"?, "model": "<a model of that provider>"?, "effort": "low|medium|high|xhigh|auto"?}], "why": "<two plain lines>"}';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The model ids the proposal may use: for each AI the page can offer, the ones the program knows and checks, then a few of the
// rest. OpenRouter alone lists hundreds, and the brain's prompt is no place for them.
const PROMPT_OTHER_MAX = 12;
function catalogForPrompt(panel) {
  const out = {};
  for (const [provider, list] of Object.entries(panel.modelList ?? {})) {
    out[provider] = [...list.filter((m) => m.verified), ...list.filter((m) => !m.verified).slice(0, PROMPT_OTHER_MAX)].map((m) => m.id);
  }
  return Object.keys(out).length ? out : panel.modelCatalog;
}

function readConfig(smDir) {
  try {
    const config = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    return isObject(config) ? config : {};
  } catch {
    return {};
  }
}

export function createBrainRoutes({ smDir, demo = false, token, balances = refreshBalances, apiRun = runApiJSON, keyOf = (provider) => getKey(smDir, provider), modelWatch = null }) {
  // The model lists' watch (models.mjs) is the program's (main.mjs makes it); without one the tab draws the lists on file.
  const watch = modelWatch;

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > BODY_MAX) return { error: 'too-large' };
      chunks.push(chunk);
    }
    try {
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
    } catch {
      return { error: 'bad-json' };
    }
  }

  async function patch(req) {
    const read = await readJson(req);
    if (read.error) return { status: 400, body: { ok: false, error: read.error } };
    const config = readConfig(smDir);
    const merged = mergeFunctionChoice(config.ai, read.value ?? {});
    if (!merged.ok) return { status: 400, body: { ok: false, error: merged.error } };
    try {
      writeFileSync(join(smDir, 'config.json'), `${JSON.stringify({ ...config, ai: merged.ai }, null, 2)}\n`);
    } catch {
      return { status: 500, body: { ok: false, error: 'not-saved' } };
    }
    logAction(smDir, { action: 'ai-brain-functions', mode: 'patch' }, 200);
    return { status: 200, body: panelModel({ smDir, ai: merged.ai }) };
  }

  // The person asks the brain's own engine to configure the routing (or40): the proposal is validated here, nothing
  // is saved. The engine is the Cérebro's own "brain" row — the same choice the person made for it, mechanical.
  async function configure(req) {
    const read = await readJson(req);
    if (read.error) return { status: 400, body: { ok: false, error: read.error } };
    const text = typeof read.value?.text === 'string' ? read.value.text.trim() : '';
    if (!text || text.length > CONFIGURE_MAX) return { status: 400, body: { ok: false, error: text ? 'too-long' : 'no-text' } };
    const config = readConfig(smDir);
    const panel = panelModel({ smDir, ai: config.ai });
    const brain = panel.functions.find((f) => f.id === 'brain') ?? { provider: 'claude', model: 'haiku', effort: 'low' };
    const prompt = [
      'Você configura o roteamento de modelos do session-map (a aba Cérebro). A pessoa pede:',
      `"${text}"`,
      '',
      'O que vale hoje:',
      `- funções: ${panel.functions.map((f) => `${f.id}=${f.provider}/${f.model}/${f.effort}`).join('; ')}`,
      `- motores de função: cérebro ${panel.engines.brain}, fundo ${panel.engines.background}`,
      `- catálogo de modelos por provedor: ${JSON.stringify(catalogForPrompt(panel))}`,
      '',
      'Regras que não podem quebrar: dinheiro, segurança e dados pessoais ficam na faixa mais alta; o modelo precisa pertencer ao provedor; no máximo 2 subidas por tarefa; níveis: low, medium, high, xhigh ou auto.',
      `Responda SOMENTE um JSON com a forma: ${PROPOSAL_SCHEMA}. Se o pedido não for sobre o roteamento, devolva changes vazio.`,
    ].join('\n');
    const sent = withStance('review', prompt);
    let res = null;
    if (brain.provider === 'claude') {
      res = await runClaudeJSON(sent, { model: brain.model, effort: brain.effort, schemaHint: PROPOSAL_SCHEMA });
    } else {
      const key = await keyOf(brain.provider);
      if (!key) return { status: 409, body: { ok: false, error: 'no-key' } };
      // The brain row's level rides on the call too, when the AI accepts it (efforts.mjs), as the entry brain's own call does.
      const effort = typeof brain.effort === 'string' && levelsOf(brain.provider, brain.model).includes(brain.effort) ? brain.effort : null;
      res = await apiRun(sent, { provider: brain.provider, model: brain.model, key, schemaHint: PROPOSAL_SCHEMA, ...(effort ? { effort } : {}) });
    }
    if (!res?.ok) return { status: 502, body: { ok: false, error: typeof res?.error === 'string' ? res.error.slice(0, 30) : 'failed' } };
    // The same validator that saves checks every change; a rejected one says why. Nothing is written here.
    const changes = [];
    const rejected = [];
    for (const c of Array.isArray(res.value?.changes) ? res.value.changes : []) {
      if (!isObject(c) || typeof c.function !== 'string') continue;
      const pick = { provider: c.provider, model: c.model, effort: c.effort };
      const checked = mergeFunctionChoice({}, { functions: { [c.function]: pick } });
      if (checked.ok && Object.keys(checked.ai.others.functions).length) changes.push({ function: c.function, ...checked.ai.others.functions[c.function] });
      else rejected.push({ function: c.function, why: checked.error ?? 'bad-change' });
    }
    const why = typeof res.value?.why === 'string' ? res.value.why.slice(0, 600) : '';
    log('info', 'ai-brain-configure', { provider: brain.provider, model: brain.model, costUSD: Number(res.costUSD) || 0, changes: changes.length, rejected: rejected.length });
    return { status: 200, body: { ok: true, changes, rejected, why, provider: brain.provider, model: brain.model, costUSD: Number(res.costUSD) || 0 } };
  }

  async function handle(req, url, address) {
    if (url.pathname !== BRAIN_PATH && url.pathname !== CONFIGURE_PATH && url.pathname !== MODELS_PATH) return { status: 404, body: { ok: false, error: 'not-found' } };
    if (demo) return { status: 403, body: { ok: false, error: 'demo' } };
    if (!isLocal(address, req.headers.host)) return { status: 403, body: { ok: false, error: 'loopback-only' } };
    if (!sameToken(cookieToken(req), token) && !sameToken(String(req.headers['x-session-map-token'] ?? ''), token)) {
      return { status: 401, body: { ok: false, error: 'token-required' } };
    }
    if (url.pathname === CONFIGURE_PATH) {
      return req.method === 'POST' ? configure(req) : { status: 404, body: { ok: false, error: 'not-found' } };
    }
    if (url.pathname === MODELS_PATH) {
      if (req.method !== 'POST') return { status: 404, body: { ok: false, error: 'not-found' } };
      await Promise.resolve(watch?.run({ force: true })).catch(() => null);
      return { status: 200, body: panelModel({ smDir, ai: readConfig(smDir).ai }) };
    }
    // The balance on the page is real (id156): looked up when the tab opens, at most once in five minutes, never a failure of the page.
    if (req.method === 'GET') {
      // The model lists are read by themselves once a day; only the very first opening waits for them.
      const first = !existsSync(modelsFile(smDir));
      const looks = [Promise.resolve(balances({ smDir })).catch(() => null)];
      const lists = Promise.resolve(watch?.run()).catch(() => null);
      if (first && watch) looks.push(lists);
      await Promise.race([Promise.all(looks), new Promise((r) => setTimeout(r, first ? FIRST_LIST_WAIT_MS : 4000).unref())]);
      return { status: 200, body: panelModel({ smDir, ai: readConfig(smDir).ai }) };
    }
    if (req.method === 'PATCH') return patch(req);
    return { status: 404, body: { ok: false, error: 'not-found' } };
  }

  return { handles: (path) => path === BRAIN_PATH || path === CONFIGURE_PATH || path === MODELS_PATH, handle, lookModels: (options) => watch?.run(options) };
}
