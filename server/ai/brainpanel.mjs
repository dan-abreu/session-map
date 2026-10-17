import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY, chatLevel } from './policy.mjs';
import { PROVIDERS, publicCatalog, providerOf } from './providers.mjs';
import { canonicalModel, loadModels, modelFits, modelNameOf, modelsOf, modelsView, pageModels } from './models.mjs';
import { LEVEL_UNION, levelsOf, topLevelOf } from './efforts.mjs';
import { bulkModelOf, loadStats } from './router.mjs';
import { othersSettings } from './others.mjs';
import { balanceOf, quotaState, readQuota } from './quota.mjs';
import { BACKGROUND_PREFERENCE, BRAIN_PREFERENCE, enginesOf, resolveEngine } from './engine.mjs';
import { listKeys } from './keys.mjs';
import { PONYTAIL_BY_EFFORT } from './ponytail-levels.mjs';
import { ponytailMeasure } from '../bench/ponytail.mjs';
import { AGENTS } from './agents.mjs';
import { enginesStatus } from './agent-engines.mjs';

// The Cérebro panel's model (id124, or39): one mechanical place that turns the config, the policy (policy.json), the
// function registry (functions.json), the measured results and the credit state into what the tab draws. No prompt
// anywhere: the AI never picks its own place here.

const FUNCTIONS = JSON.parse(readFileSync(new URL('./functions.json', import.meta.url), 'utf8')).functions;
export const AI_FUNCTIONS = Object.freeze(FUNCTIONS.map((f) => Object.freeze(f)));
export const functionById = (id) => AI_FUNCTIONS.find((f) => f.id === id) ?? null;

// The Claude family's display prices (per million tokens, in/out), the ones the research of 2026-10 checked. The
// outside AIs' prices come from providers.mjs, checked on its own date.
const CLAUDE_MODELS = Object.freeze([
  { name: 'Haiku 5.5', in: 0.1, out: 0.5, tier: 'N1', id: 'haiku' },
  { name: 'Sonnet 5.5', in: 2, out: 10, tier: 'N2', id: 'sonnet' },
  { name: 'Opus 5.5', in: 4, out: 20, tier: 'N3', id: 'opus' },
  { name: 'Fable 5.1', in: 10, out: 50, tier: 'N3', id: 'fable' },
]);

// The models each provider serves, as ids: the list the maker gave (models.mjs: Claude Code's own for Claude, the maker's
// API for the others), else what the program knows by name and price.
export function modelCatalog() {
  const out = {};
  for (const p of ['claude', ...Object.keys(PROVIDERS)]) out[p] = modelsOf(p).map((e) => e.id);
  return out;
}
// A model belongs to its AI when that AI lists it. A row run by Claude agents (it has task kinds) takes only the models the
// Agent tool accepts, so the page never shows a choice the engine would silently replace.
const validModel = (provider, model, rowId) => modelFits(provider, model, { agent: Boolean(functionById(rowId)?.kinds?.length) });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const validProvider = (v) => v === 'claude' || Boolean(providerOf(v));
// Each engine names its levels differently (efforts.mjs): any known word reads, the chosen engine's list validates.
const validEffort = (v) => LEVEL_UNION.includes(v);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// The real level validation (.dev/execucao/validate-levels.mjs writes smDir/bench/levels.json): what the tab shows
// as "verified in practice", with the date and the cost of each call. A broken or missing file means nothing yet.
function readLevels(smDir) {
  try {
    const d = JSON.parse(readFileSync(join(smDir, 'bench', 'levels.json'), 'utf8'));
    const entries = (Array.isArray(d?.entries) ? d.entries : []).filter((e) => e && typeof e.provider === 'string'
      && typeof e.model === 'string' && typeof e.level === 'string' && typeof e.ok === 'boolean');
    return { updatedAt: typeof d?.updatedAt === 'string' ? d.updatedAt : null, entries };
  } catch {
    return { updatedAt: null, entries: [] };
  }
}

// The per-function choices of the config: ai.others.functions = { id: {provider?, model?, effort?} }. The model must
// belong to the chosen provider's catalog; broken values are dropped: the default of the function stays.
export function functionsOf(ai) {
  const raw = isObject(ai?.others?.functions) ? ai.others.functions : {};
  const out = {};
  for (const [id, c] of Object.entries(raw)) {
    if (!functionById(id) || !isObject(c)) continue;
    const one = {};
    if (c.provider === 'auto' || validProvider(c.provider)) one.provider = c.provider;
    // A model named with no AI is Claude's, the AI every row starts on. Another name of a model reads as the one it lists.
    const prov = one.provider && one.provider !== 'auto' ? one.provider : 'claude';
    const model = canonicalModel(prov, c.model);
    if (model === 'auto' || (typeof model === 'string' && validModel(prov, model, id))) one.model = model;
    if (c.effort === 'auto' || validEffort(c.effort)) one.effort = c.effort;
    if (Object.keys(one).length) out[id] = one;
  }
  return out;
}

// Merge the page's patch into the ai part of config.json: {functions: {id: {provider?, effort?}}}. 'auto' removes the
// line (the default needs none). Unknown functions, providers or efforts refuse the whole patch.
export function mergeFunctionChoice(ai, patch = {}) {
  const { others, ...rest } = isObject(ai) ? ai : {};
  const { functions, ...o } = isObject(others) ? others : {};
  const next = { ...functionsOf(ai) };
  const given = patch.functions;
  if (given !== undefined) {
    if (!isObject(given)) return { ok: false, error: 'bad-functions' };
    for (const [id, sent] of Object.entries(given)) {
      if (!isObject(sent)) return { ok: false, error: 'bad-functions' };
      // Another name of a model is saved as the name its AI lists (deepseek-v4-flash is deepseek-flash).
      const named0 = sent.provider ?? next[id]?.provider;
      const c = typeof sent.model === 'string' ? { ...sent, model: canonicalModel(!named0 || named0 === 'auto' ? 'claude' : named0, sent.model) } : sent;
      if (id !== 'auto' && !functionById(id)) return { ok: false, error: 'unknown-function' };
      if (c.provider !== undefined && c.provider !== 'auto' && !validProvider(c.provider)) return { ok: false, error: 'unknown-provider' };
      // The talk runs where Claude Code runs: on Claude, or on an AI that speaks its protocol (id170).
      if (id === 'chat' && c.provider !== undefined && !['auto', 'claude'].includes(c.provider) && !providerOf(c.provider)?.talkEndpoint) return { ok: false, error: 'unknown-provider' };
      if (id === 'chat' && c.effort === 'off') return { ok: false, error: 'bad-effort' };
      if (c.effort !== undefined && c.effort !== 'auto') {
        const prov = c.provider ?? next[id]?.provider;
        const mdl = c.model ?? next[id]?.model;
        if (c.effort === 'ultracode') {
          // Ultracode is Claude Code's own setting (not max): only for a Claude model that reaches xhigh.
          if (prov !== 'claude' || !levelsOf(prov, typeof mdl === 'string' ? mdl : null).includes('xhigh')) return { ok: false, error: 'bad-effort' };
        } else if (validProvider(prov)) {
          if (!levelsOf(prov, typeof mdl === 'string' ? mdl : null).includes(c.effort)) return { ok: false, error: 'bad-effort' };
        } else if (!validEffort(c.effort)) return { ok: false, error: 'bad-effort' };
      }
      if (c.model !== undefined && c.model !== 'auto') {
        // A row with no AI named is on Claude, as the page draws it: choosing its model sends the model alone.
        const named = c.provider ?? next[id]?.provider;
        const prov = !named || named === 'auto' ? 'claude' : named;
        if (!validProvider(prov) || !validModel(prov, c.model, id)) return { ok: false, error: 'bad-model' };
      }
      if (c.provider !== undefined || c.model !== undefined || c.effort !== undefined) next[id] = { ...next[id] };
      if (c.provider !== undefined) next[id].provider = c.provider;
      if (c.model !== undefined) next[id].model = c.model;
      if (c.effort !== undefined) next[id].effort = c.effort;
      for (const k of ['provider', 'model', 'effort']) if (next[id][k] === 'auto') delete next[id][k];
      if (!Object.keys(next[id]).length) delete next[id];
    }
  }
  if (Object.keys(next).length) return { ok: true, ai: { ...rest, others: { ...o, functions: next } } };
  return { ok: true, ai: { ...rest, others: { ...o } } };
}

// The measured best of one contestant family, for the matrix: {accuracy, costPerCorrectUSD, n} or null.
function measuredOf(stats, provider) {
  const rows = (Array.isArray(stats) ? stats : []).filter((e) => String(e?.contestant ?? '').startsWith(`${provider}:`));
  if (!rows.length) return null;
  const best = rows.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));
  return { accuracy: best.accuracy, costPerCorrectUSD: round6(best.costPerCorrectUSD), n: best.n };
}

// One row of the routing table: the function with the engine and level the scripts resolved for it.
function resolveRow(fn, { settings, engines, choices, available, stats, models, status }) {
  const choice = choices[fn.id] ?? {};
  const row = { id: fn.id, order: fn.order, label: fn.en.label, labelPt: fn.pt.label, does: fn.en.does, doesPt: fn.pt.does };
  if (fn.note) { row.note = fn.note.en; row.notePt = fn.note.pt; }
  // Every policy kind is work an agent executes: the guard holds its model and level (or42), and the tab marks it.
  row.agent = Boolean(fn.kinds?.length);
  // The AIs a row can really run on (id155): the talk is Claude Code, so it offers Claude alone; every other row takes
  // any AI with a key, the book's titles and summaries included (id156: its own program asks the server, which holds the key).
  if (fn.engine === 'chat') {
    // The level the chat starts on is this row's, else the policy's chat row (the default, never the entry brain's): the
    // tab says which of the two it is, so a default never looks like a choice.
    const fallback = chatLevel();
    // Claude, and every AI with a key that speaks Claude Code's protocol (id170: DeepSeek).
    const talkers = ['claude', ...available.filter((p) => p !== 'claude' && providerOf(p)?.talkEndpoint)];
    const other = choice.provider && choice.provider !== 'claude' && choice.provider !== 'auto' ? choice.provider : null;
    if (other && talkers.includes(other)) {
      const model = choice.model ?? providerOf(other).talkModel;
      // Its levels are the maker's, without "off": Claude Code has no word for thinking switched off.
      const levels = levelsOf(other, model).filter((l) => l !== 'off' && l !== 'auto');
      return { ...row, provider: other, providers: talkers, model, effort: levels.includes(choice.effort) ? choice.effort : levels.includes('high') ? 'high' : levels[0] ?? null, levelOptions: levels, topLevel: null, why: 'choice' };
    }
    const model = other ? fallback.model : choice.model ?? fallback.model;
    return { ...row, provider: 'claude', providers: talkers, model, effort: choice.effort ?? fallback.effort, levelOptions: levelsOf('claude', model), topLevel: topLevelOf('claude', model), why: choice.model || choice.effort ? 'choice' : 'policy' };
  }
  if (fn.engine === null) {
    return { ...row, provider: null, model: null, effort: null, levelOptions: [], topLevel: null, why: 'not-wired' };
  }
  if (fn.engine === 'brain' || fn.engine === 'background') {
    const pref = fn.engine === 'brain' ? BRAIN_PREFERENCE : BACKGROUND_PREFERENCE;
    // The row's own choice names the AI (id155), as the hub and the runner read it; the older engine switch is the
    // fallback. The book has no older switch: with nothing chosen (or Claude chosen) it is Claude, the cheap default.
    if (fn.id === 'book' && (!choice.provider || choice.provider === 'auto' || choice.provider === 'claude')) {
      const model = choice.model ?? 'haiku';
      return { ...row, provider: 'claude', model, effort: choice.effort ?? 'low', levelOptions: levelsOf('claude', model), topLevel: topLevelOf('claude', model), why: choice.model || choice.effort ? 'choice' : 'policy' };
    }
    const wanted = choice.provider && choice.provider !== 'auto' ? choice.provider : engines[fn.engine];
    const eng = resolveEngine(wanted, { available, preference: pref, fallback: 'claude' });
    const provider = eng.id ?? 'claude';
    const sameAi = eng.why === 'choice' || !choice.provider || choice.provider === 'auto';
    const model = (sameAi ? choice.model : null) ?? (provider === 'claude' ? 'haiku' : bulkModelOf(provider, models) ?? providerOf(provider)?.defaultModel ?? '');
    return { ...row, provider, model, effort: choice.effort ?? 'low', levelOptions: levelsOf(provider, model), topLevel: topLevelOf(provider, model), why: eng.why };
  }
  // The policy kinds: the row's default is the policy's own; an explicit choice replaces provider, model or effort.
  const kind = (fn.kinds ?? [])[0];
  const base = POLICY.tasks[kind] ?? { model: 'sonnet', effort: 'medium' };
  const provider = choice.provider ?? 'claude';
  const model = choice.model ?? (provider === 'claude' ? base.model : bulkModelOf(provider, models) ?? providerOf(provider)?.defaultModel ?? '');
  const measured = measuredOf(stats, provider);
  // A row on another AI is a handoff (id156): the chat gives it the work, and the tab says whether that AI edits files in an
  // isolated copy or only answers, so no row looks wired when it is not.
  const handoff = provider !== 'claude' && provider !== 'auto' ? (['worktree', 'claude-base'].includes(status?.[provider]?.edits) ? 'handoff-edits' : 'handoff-answers') : null;
  return { ...row, provider, model, effort: choice.effort ?? base.effort, levelOptions: levelsOf(provider, model), topLevel: topLevelOf(provider, model), why: handoff ?? (choice.provider || choice.model || choice.effort ? 'choice' : 'policy'), kind, measured };
}

// The whole model the tab draws. smDir: the map's storage (stats, quota, keys read from it); every input injectable
// for tests. now: unused today, kept for the balance freshness the page will show.
export function panelModel({
  smDir, ai = {}, keys = null, stats = null, quota = null, bin = null,
}) {
  // The lists the makers gave are read from their file before anything is drawn or checked (a no-op without the file).
  if (smDir) loadModels(smDir);
  const keyProviders = keys ?? (smDir ? listKeys(smDir).map((k) => k.provider) : []);
  const settings = othersSettings(ai, keyProviders);
  const engines = enginesOf(ai);
  const choices = functionsOf(ai);
  const measured = stats ?? (smDir ? loadStats(smDir) : []);
  const qstate = quota ?? (smDir ? readQuota(smDir) : { providers: {} });
  const available = [...keyProviders, 'claude'];

  const matrix = [{
    id: 'claude', name: 'Claude', family: 'Anthropic', tiers: 'N1–N3', models: CLAUDE_MODELS,
    hasKey: true, balanceUSD: null, measured: measuredOf(measured, 'claude'),
    apt: {
      en: ['The brain, the talk and the planning', 'Best measured code and review', 'Best Brazilian Portuguese'],
      pt: ['O cérebro, a conversa e o planejamento', 'Melhor código e revisão medidos', 'Melhor português do Brasil'],
    },
  }];
  for (const p of publicCatalog()) {
    matrix.push({
      id: p.id, name: p.name, family: p.id === 'openai' ? 'OpenAI' : p.id === 'gemini' ? 'Google' : p.id === 'deepseek' ? 'DeepSeek' : 'OpenRouter',
      tiers: p.id === 'openrouter' ? 'N1' : 'N1–N2',
      models: Object.entries(p.pricesUSDPerMTok ?? {}).map(([name, v]) => ({ name, in: v.in, out: v.out, tier: name.includes('pro') || name.includes('sol') || name.includes('astra') ? 'N2' : 'N1' })),
      hasKey: keyProviders.includes(p.id),
      balanceUSD: balanceOf(qstate, p.id),
      measured: measuredOf(measured, p.id),
      apt: { en: [p.goodFor], pt: [p.goodFor] },
    });
  }

  const agentEngines = enginesStatus({ bin: bin ?? undefined });
  // Each row says the real name of its model (id168): "Opus 5.5", "DeepSeek V4 Pro", never the alias or the raw id.
  const functions = AI_FUNCTIONS.map((fn) => resolveRow(fn, { settings, engines, choices, available, stats: measured, models: settings.models, status: agentEngines }))
    .map((f) => ({ ...f, modelName: f.provider && f.model ? modelNameOf(f.provider, f.model) : null }));

  const rowOf = (id) => functions.find((f) => f.id === id) ?? null;
  // The chips on top show the AI each engine row really runs on (the row's own choice), not the older switch behind it.
  const effectiveEngines = { brain: rowOf('brain')?.provider ?? engines.brain, background: rowOf('background')?.provider ?? engines.background };
  // The specialist agents (id148, or55): each role rides the row of its first kind, so the owner's choice for that row
  // is the role's engine, model and level. The profile itself (tools, skills, exit) comes straight from the catalog.
  const kindRow = new Map();
  for (const f of AI_FUNCTIONS) for (const k of f.kinds ?? []) if (!kindRow.has(k)) kindRow.set(k, f.id);
  const agents = AGENTS.agents.map((role, i) => ({
    order: i + 1,
    id: role.id,
    label: role.label,
    labelPt: role.labelPt,
    deliver: role.deliver,
    deliverPt: role.deliverPt,
    kinds: [...role.kinds],
    tools: [...role.tools],
    skills: [...role.skills],
    method: [...role.method],
    methodPt: [...role.methodPt],
    row: rowOf(kindRow.get(role.kinds[0])) ?? null,
  }));

  // Only what holds in every run today (id156): the ladder, the privacy group, the 10-agent cap and the skills rule are
  // the strict mode or a choice of the owner, so the tab does not claim them.
  const rules = [
    { id: 'climbs', warn: true, en: 'At most 2 tries with a stronger AI per task, then it stops and tells you', pt: 'No máximo 2 tentativas com uma IA mais forte por tarefa; depois para e avisa você' },
    { id: 'checker', warn: false, en: 'A dubious bulk answer is checked by an AI of another family', pt: 'Uma resposta em lote duvidosa é conferida por uma IA de outra família' },
    { id: 'failover', warn: true, en: 'An AI out of credit is swapped for the next one by itself, at the same level', pt: 'Uma IA sem crédito é trocada pela próxima sozinha, no mesmo nível' },
    { id: 'cap', warn: false, en: `Daily cap: US$ ${settings.dailyUSD} for all the other AIs together`, pt: `Teto diário: US$ ${settings.dailyUSD} para todas as outras IAs juntas` },
  ];

  // The model list the selectors draw, for the AIs the page can offer (Claude, the ones with a key and the ones a row already
  // names): the full list of each, with the real names, the notes of the maker, the price and the context.
  // The real test of every model at every level (bench/levels.json): each model says how many of its levels answered, and a
  // level that failed is not offered on any row, so the page never shows a choice whose call the test saw fail.
  const levels = smDir ? readLevels(smDir) : { updatedAt: null, entries: [] };
  const testKey = (provider, model) => `${provider}|${model}`;
  const tests = new Map();
  for (const e of levels.entries) {
    const k = testKey(e.provider, canonicalModel(e.provider, e.model));
    const t = tests.get(k) ?? { n: 0, ok: 0, failed: new Set() };
    t.n += 1;
    if (e.ok) t.ok += 1; else t.failed.add(e.level);
    tests.set(k, t);
  }
  const modelList = {};
  for (const id of new Set(['claude', ...keyProviders, ...functions.map((f) => f.provider).filter((p) => p && p !== 'auto')])) {
    modelList[id] = pageModels(id).map((m) => {
      const t = tests.get(testKey(id, m.id));
      return t ? { ...m, tested: { n: t.n, ok: t.ok, at: levels.updatedAt } } : m;
    });
  }
  const withTested = (f) => {
    const failed = f.provider && f.model ? tests.get(testKey(f.provider, f.model))?.failed : null;
    return failed?.size && Array.isArray(f.levelOptions) ? { ...f, levelOptions: f.levelOptions.filter((l) => !failed.has(l)) } : f;
  };

  return { ok: true, matrix, functions: functions.map(withTested), agents: agents.map((a) => (a.row ? { ...a, row: withTested(a.row) } : a)), agentEngines, rules, engines: effectiveEngines, engineOptions: ['auto', 'claude', ...keyProviders], modelCatalog: modelCatalog(), modelList, modelsInfo: smDir ? modelsView(smDir) : {}, levels, ponytailLevels: PONYTAIL_BY_EFFORT, ponytail: ponytailMeasure() };
}
