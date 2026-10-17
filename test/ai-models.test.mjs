import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  askClaudeModels, canonicalModel, claudeEntries, cleanEntry, createModelWatch, deepseekEntries, geminiEntries, humanName, loadModels,
  modelFits, modelIdsOf, modelNameOf, modelsFile, modelsOf, modelsView, openaiEntries, openrouterEntries, pageModels,
} from '../server/ai/models.mjs';
import { clearListed, listedOf } from '../server/ai/model-registry.mjs';
import { CLAUDE_FALLBACK } from '../server/ai/claude-models.mjs';
import { levelsOf } from '../server/ai/efforts.mjs';
import { functionsOf, mergeFunctionChoice, panelModel } from '../server/ai/brainpanel.mjs';

// The model list of every AI (id168, or72): Claude Code's own list (the VS Code picker's), each maker's list read with the
// owner's key, the real names, and the choice that reaches the call as the exact id the maker lists.

const dir = () => mkdtempSync(join(tmpdir(), 'sm-models-'));

// What Claude Code 2.1.301 answered to "initialize" (trimmed to the fields the program reads).
const CLI_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Most efficient for simpler tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: 'Fastest for quick answers', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' },
  { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Best for everyday, complex tasks', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'not a model!', displayName: 'Junk' },
];
const initLine = (models, requestId = 'sm-models', subtype = 'success') => JSON.stringify({ type: 'control_response', response: { subtype, request_id: requestId, response: { models } } });

const DEEPSEEK_BODY = { object: 'list', data: [
  { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, output_modalities: ['text'], effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', context_window: 1048576, output_modalities: ['text'], effort: { supported_levels: ['low', 'high', 'max'] } },
] };
const OPENAI_BODY = { data: ['gpt-6.1-sol', 'gpt-5.5', 'gpt-5.5-2026-04-23', 'gpt-5.5-pro', 'gpt-5.1-codex', 'gpt-4o', 'gpt-4o-mini-tts', 'gpt-image-2', 'text-embedding-3-small', 'whisper-1', 'o4-mini', 'o3-mini-2025-01-31', 'chat-latest', 'omni-moderation-latest', 'gpt-realtime-2', 'sora-2', 'gpt-4-0613', 'tts-1'].map((id) => ({ id })) };
const GEMINI_BODY = { models: [
  { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemma-4-31b-it', displayName: 'Gemma 4 31B IT', inputTokenLimit: 262144, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-tts-preview', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-2', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-3.5-flash-native-audio-latest', displayName: 'Audio', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/veo-3.1-generate-preview', displayName: 'Veo', supportedGenerationMethods: ['predictLongRunning'] },
  { name: 'models/gemini-pro-latest', displayName: 'Pro latest', supportedGenerationMethods: ['generateContent'] },
] };
const OPENROUTER_BODY = { data: [
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: DeepSeek V4.1 Flash', context_length: 1048576, pricing: { prompt: '0.0000003', completion: '0.0000012' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/imagen-9', name: 'Google: Imagen 9', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
  { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', context_length: 200000, pricing: { prompt: '0.0000001', completion: '0.0000005' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
] };

test('claudeEntries reads Claude Code\'s list: the real names, the maker\'s notes in both languages, the levels and the price', () => {
  const list = claudeEntries(CLI_MODELS);
  assert.deepEqual(list.map((e) => e.id), ['opus', 'sonnet', 'haiku', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'], '"default" repeats Opus and junk is dropped');
  const opus = list[0];
  assert.deepEqual([opus.name, opus.resolved, opus.noteEn, opus.notePt], ['Opus 5.5', 'claude-opus-5-5', 'For complex work and everyday tasks', 'Para trabalho complexo e tarefas do dia a dia']);
  assert.deepEqual(opus.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(opus.levelsFrom, 'maker');
  assert.deepEqual([opus.priceIn, opus.priceOut], [4, 20], 'the price of the model the alias resolves to');
  assert.deepEqual(list[3].levels, [], 'a model that lists no level takes none');
  assert.deepEqual(list[4].levels, ['low', 'medium', 'high', 'max'], 'Opus 4.6 has no extra high');
  assert.deepEqual([list[3].priceIn, list[3].priceOut], [1, 5], 'a dated id is priced by its model');
  assert.deepEqual(claudeEntries(null), []);
});

test('askClaudeModels asks the CLI the way its own picker does and reads the answer, with short codes for every failure', async () => {
  const sm = dir();
  let seen = null;
  const exec = async (bin, args, o) => { seen = { bin, args, ...o }; return { code: 0, stdout: `{"type":"system"}\nnot json\n${initLine(CLI_MODELS)}\n` }; };
  const ok = await askClaudeModels({ smDir: sm, bin: 'claude', exec, env: { CLAUDE_CODE_X: '1', PATH: 'p' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.models.length, 5);
  assert.deepEqual(seen.args, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']);
  assert.deepEqual(JSON.parse(seen.input), { type: 'control_request', request_id: 'sm-models', request: { subtype: 'initialize' } }, 'one question, no message: no model is called, nothing is spent');
  assert.ok(seen.cwd.includes('ai-runner'), 'it runs in the folder of the map\'s own calls, which the map hides');
  assert.equal(seen.env.CLAUDE_CODE_X, undefined, 'the CLAUDE variables of the parent are not inherited');
  const fail = (out, bin = 'claude') => askClaudeModels({ smDir: sm, bin, exec: async () => out });
  assert.deepEqual(await fail({}, null), { ok: false, error: 'claude-not-found' });
  assert.deepEqual(await fail({ error: 'ENOENT' }), { ok: false, error: 'spawn-failed' });
  assert.deepEqual(await fail({ code: 0, stdout: 'garbage' }), { ok: false, error: 'bad-output' });
  assert.deepEqual(await fail({ code: null, stdout: '', timedOut: true }), { ok: false, error: 'timeout' });
  assert.deepEqual(await fail({ code: 0, stdout: initLine(CLI_MODELS, 'other-request') }), { ok: false, error: 'bad-output' }, 'only the answer to this question counts');
  assert.deepEqual(await fail({ code: 0, stdout: initLine(CLI_MODELS, 'sm-models', 'error') }), { ok: false, error: 'refused' });
  assert.deepEqual(await fail({ code: 0, stdout: initLine([]) }), { ok: false, error: 'bad-output' }, 'an empty list is no list');
});

test('each maker\'s list is read into real names, leaving out what does not answer a chat message', () => {
  const openai = openaiEntries(OPENAI_BODY);
  assert.deepEqual(openai.map((e) => e.id), ['gpt-6.1-sol', 'gpt-5.5', 'gpt-4o', 'o4-mini'], 'snapshots, -pro and codex (Responses only), audio, image, speech, search, embeddings, aliases out; the newest first, the o series last');
  assert.deepEqual(openai.map((e) => e.name), ['GPT-6.1 Sol', 'GPT-5.5', 'GPT-4o', 'o4-mini']);
  assert.deepEqual(openai.map((e) => e.levels), [['low', 'medium', 'high'], ['low', 'medium', 'high'], [], ['low', 'medium', 'high']], 'a reasoning model takes the three levels all of them accept; an older one none');
  assert.ok(openai.every((e) => e.levelsFrom === 'guess'));

  const gemini = geminiEntries(GEMINI_BODY);
  assert.deepEqual(gemini.map((e) => [e.id, e.name, e.context]), [['gemini-3.8-flash', 'Gemini 3.8 Flash', 1048576], ['gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576]], 'speech, embeddings, audio, video, the moving "latest" aliases and Gemma (it failed the real test: its thinking came back as the answer) out; Google\'s own display name kept');
  assert.deepEqual(gemini.map((e) => e.levels), [['low', 'medium', 'high'], ['low', 'medium', 'high']]);

  const deepseek = deepseekEntries(DEEPSEEK_BODY);
  assert.deepEqual(deepseek.map((e) => [e.id, e.name]), [['deepseek-flash', 'DeepSeek V4.1 Flash'], ['deepseek-v4-pro', 'DeepSeek V4 Pro']]);
  assert.deepEqual(deepseek[0].levels, ['off', 'low', 'high', 'max'], 'the levels DeepSeek itself lists, and thinking off');
  assert.equal(deepseek[0].levelsFrom, 'maker');
  assert.equal(deepseek[0].context, 1048576);

  const router = openrouterEntries(OPENROUTER_BODY);
  assert.deepEqual(router.map((e) => [e.id, e.name, e.maker]), [['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5', 'Anthropic'], ['deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'DeepSeek']], 'only what answers in text, grouped by maker');
  assert.deepEqual([router[1].priceIn, router[1].priceOut, router[1].context], [0.3, 1.2, 1048576], 'OpenRouter prices per token become per million');
  for (const f of [openaiEntries, geminiEntries, deepseekEntries, openrouterEntries]) assert.deepEqual(f(null), []);
});

test('humanName writes a model the maker named only by id the way people say it', () => {
  assert.equal(humanName('gpt-6.1-sol'), 'GPT-6.1 Sol');
  assert.equal(humanName('gpt-4o-mini'), 'GPT-4o Mini');
  assert.equal(humanName('o4-mini'), 'o4-mini');
  assert.equal(humanName('deepseek-v4-pro'), 'DeepSeek V4 Pro');
  assert.equal(humanName('gemini-3.8-flash'), 'Gemini 3.8 Flash');
  assert.equal(humanName('anthropic/claude-haiku-5.5'), 'Claude Haiku 5.5');
});

test('cleanEntry keeps only the plain shape and drops what is not a model', () => {
  assert.equal(cleanEntry({ id: 'x y', name: 'Bad' }, 'openai'), null);
  assert.equal(cleanEntry({ id: 'gpt-1', name: '' }, 'openai'), null);
  assert.equal(cleanEntry('gpt-1', 'openai'), null);
  assert.equal(cleanEntry({ id: 'gpt-7', name: 'GPT 7' }, 'claude'), null, 'a Claude id is an alias or claude-…');
  const e = cleanEntry({ id: 'gpt-7', name: 'GPT-7', context: -3, priceIn: 'x', evil: '<script>', levels: ['low', 'warp', 'ultracode'], levelsFrom: 'guess' }, 'openai');
  assert.deepEqual(e, { id: 'gpt-7', name: 'GPT-7', levels: ['low'], levelsFrom: 'guess' });
});

test('with no list read, the built-in one stands: Claude Code\'s twelve models and the models providers.mjs knows', () => {
  clearListed();
  const claude = modelsOf('claude');
  assert.equal(claude.length, CLAUDE_FALLBACK.length);
  assert.deepEqual(claude.slice(0, 4).map((e) => [e.id, e.name, e.group, e.agent]), [['opus', 'Opus 5.5', 'current', true], ['fable', 'Fable 5.1', 'current', true], ['sonnet', 'Sonnet 5.5', 'current', true], ['haiku', 'Haiku 5.5', 'current', true]]);
  assert.ok(claude.slice(4).every((e) => e.group === 'other' && e.agent === false), 'the older ids are not for helpers');
  assert.deepEqual(modelsOf('deepseek').map((e) => e.id), ['deepseek-flash', 'deepseek-v4-pro'], 'deepseek-v4-flash is another name of deepseek-flash: offered once');
  assert.equal(modelNameOf('deepseek', 'deepseek-v4-pro'), 'DeepSeek V4 Pro');
  assert.equal(modelNameOf('claude', 'sonnet'), 'Sonnet 5.5');
  assert.equal(modelNameOf('openai', 'gpt-9-x'), 'GPT-9 X', 'a model nobody lists is still named like a person');
  assert.equal(modelNameOf('claude', ''), null);
  assert.deepEqual(modelsOf('nada'), []);
});

test('the lists read from the makers join the models the program knows: known ones first with their price, the rest checked as basic requests', async () => {
  clearListed();
  const sm = dir();
  const fetchFn = async (url) => {
    const body = url.includes('deepseek') ? DEEPSEEK_BODY : url.includes('openai') ? OPENAI_BODY : null;
    return body ? { ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Map() } : { ok: false, status: 404, text: async () => '' };
  };
  const watch = createModelWatch({ smDir: sm, keyOf: async (p) => (p === 'deepseek' || p === 'openai' ? 'sk-test-key-1234' : null), fetchFn, askClaude: async () => ({ ok: true, models: claudeEntries(CLI_MODELS) }), now: () => Date.parse('2026-10-16T12:00:00Z') });
  const out = await watch.run();
  assert.deepEqual(out.checked.sort(), ['claude', 'deepseek', 'openai']);
  assert.deepEqual(out.skipped.filter((s) => s.why === 'no-key').map((s) => s.provider).sort(), ['gemini', 'openrouter']);

  const openai = modelsOf('openai');
  assert.deepEqual(openai.slice(0, 3).map((e) => [e.id, e.group, e.verified]), [['gpt-6-luna', 'current', true], ['gpt-6.1-sol', 'current', true], ['gpt-6-astra', 'current', true]]);
  assert.equal(openai[0].gone, true, 'the maker\'s list has no gpt-6-luna here: it stays, marked');
  assert.equal(openai[1].gone, undefined);
  assert.deepEqual(openai.slice(3).map((e) => [e.id, e.group, e.verified]), [['gpt-5.5', 'other', false], ['gpt-4o', 'other', false], ['o4-mini', 'other', false]]);
  const deepseek = modelsOf('deepseek');
  assert.equal(deepseek.find((e) => e.id === 'deepseek-flash').name, 'DeepSeek V4.1 Flash', 'the maker\'s own name wins');
  assert.equal(deepseek.find((e) => e.id === 'deepseek-v4-flash'), undefined, 'the other name of Flash is never offered twice');
  assert.equal(canonicalModel('deepseek', 'deepseek-v4-flash'), 'deepseek-flash');
  assert.equal(canonicalModel('deepseek', 'deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(canonicalModel('claude', 'opus'), 'opus');
  // A saved choice under the other name reads, and saves, as the name DeepSeek lists.
  assert.deepEqual(functionsOf({ others: { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' } } } }), { code: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } });
  assert.deepEqual(mergeFunctionChoice({}, { functions: { docs: { provider: 'deepseek', model: 'deepseek-v4-flash' } } }).ai.others.functions, { docs: { provider: 'deepseek', model: 'deepseek-flash' } });
  assert.equal(modelNameOf('claude', 'haiku'), 'Haiku 5.5');
  assert.deepEqual(modelsOf('claude').map((e) => e.id), ['opus', 'sonnet', 'haiku', 'claude-haiku-4-5-20251001', 'claude-opus-4-6']);

  // The page gets the fields it draws and none of the program's own.
  const page = pageModels('claude').find((e) => e.id === 'opus');
  assert.deepEqual(page, { id: 'opus', name: 'Opus 5.5', group: 'current', verified: true, agent: true, resolved: 'claude-opus-5-5', noteEn: 'For complex work and everyday tasks', notePt: 'Para trabalho complexo e tarefas do dia a dia', priceIn: 4, priceOut: 20 });
  assert.equal(pageModels('openai').find((e) => e.id === 'gpt-5.5').verified, false);
  assert.equal('levels' in pageModels('deepseek')[0], false);

  // The file holds the lists; a restart reads them back.
  const file = JSON.parse(readFileSync(modelsFile(sm), 'utf8'));
  assert.deepEqual(Object.keys(file.providers).sort(), ['claude', 'deepseek', 'openai']);
  clearListed();
  assert.equal(listedOf('openai'), null);
  loadModels(sm);
  assert.equal(listedOf('openai').length, 4);
  assert.deepEqual(modelsView(sm).openai, { source: 'maker', count: 4, checkedAt: '2026-10-16T12:00:00.000Z', ok: true });
  assert.equal(modelsView(sm).gemini.source, 'built-in');
  assert.equal(modelsView(sm).claude.source, 'claude-code');
});

test('a model choice must be one its AI lists; a helper of Claude takes only what the helper tool accepts', () => {
  clearListed();
  assert.equal(modelFits('claude', 'opus'), true);
  assert.equal(modelFits('claude', 'claude-opus-4-8'), true, 'Claude Code lists it');
  assert.equal(modelFits('claude', 'claude-opus-4-8', { agent: true }), false, 'the helper tool takes the four aliases only');
  assert.equal(modelFits('claude', 'sonnet', { agent: true }), true);
  assert.equal(modelFits('deepseek', 'gpt-6-luna'), false);
  assert.equal(modelFits('nada', 'x'), false);
  assert.ok(modelIdsOf('openai').has('gpt-6-luna'));

  // The same rule on the saved choices.
  const ai = { others: {} };
  assert.equal(mergeFunctionChoice(ai, { functions: { chat: { provider: 'claude', model: 'claude-opus-4-8', effort: 'high' } } }).ok, true, 'the talk runs through the CLI: any model Claude Code lists');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'claude', model: 'claude-opus-4-8' } } }).error, 'bad-model', 'a row run by helpers would silently run on another model');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'claude', model: 'opus' } } }).ok, true);
  // The page sends the model alone for a row on Claude (no AI stored): it is Claude's model, as the page draws it.
  assert.equal(mergeFunctionChoice(ai, { functions: { chat: { model: 'claude-opus-4-8' } } }).ok, true);
  assert.deepEqual(mergeFunctionChoice(ai, { functions: { plan: { model: 'sonnet' } } }).ai.others.functions, { plan: { model: 'sonnet' } });
  assert.equal(mergeFunctionChoice(ai, { functions: { plan: { model: 'claude-opus-4-8' } } }).error, 'bad-model');
  assert.equal(mergeFunctionChoice(ai, { functions: { chat: { model: 'gpt-6-luna' } } }).error, 'bad-model', "another AI's model needs its AI named");
  assert.deepEqual(functionsOf({ others: { functions: { code: { provider: 'claude', model: 'claude-opus-4-8' }, chat: { model: 'claude-opus-4-8' }, book: { model: 'deepseek-flash' } } } }), { chat: { model: 'claude-opus-4-8' }, code: { provider: 'claude' } }, 'the model a helper cannot run is dropped and the AI stays; a model with no AI is Claude\'s');
});

test('a model read from the maker can be chosen, and its level words are the maker\'s or the cautious set', () => {
  clearListed();
  const sm = dir();
  writeFileSync(modelsFile(sm), JSON.stringify({ version: 1, providers: {
    claude: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: claudeEntries(CLI_MODELS) },
    openai: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: openaiEntries(OPENAI_BODY) },
    deepseek: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: deepseekEntries(DEEPSEEK_BODY) },
  } }));
  const ai = { others: {} };
  const picks = (c) => mergeFunctionChoice(ai, { functions: { code: c } });
  // Without the file loaded the maker's model is unknown, with it the choice is saved.
  assert.equal(picks({ provider: 'openai', model: 'gpt-5.5' }).error, 'bad-model');
  loadModels(sm);
  assert.equal(picks({ provider: 'openai', model: 'gpt-5.5', effort: 'high' }).ok, true);
  assert.equal(picks({ provider: 'openai', model: 'gpt-5.5', effort: 'xhigh' }).error, 'bad-effort', 'a new model takes only the three levels every reasoning model accepts');
  assert.equal(picks({ provider: 'openai', model: 'gpt-4o', effort: 'low' }).error, 'bad-effort', 'an older model takes no level at all');
  assert.equal(picks({ provider: 'openai', model: 'gpt-4o' }).ok, true);
  assert.deepEqual(levelsOf('openai', 'gpt-6-luna'), ['none'], 'a model the program measured keeps its measured levels over the cautious set');
  assert.deepEqual(levelsOf('deepseek', 'deepseek-flash'), ['off', 'low', 'high', 'max'], 'what DeepSeek lists today wins over the older table');
  assert.deepEqual(levelsOf('claude', 'haiku'), ['low', 'medium', 'high', 'xhigh', 'max'], 'and so does what Claude Code lists');
  assert.deepEqual(levelsOf('claude', 'claude-haiku-4-5-20251001'), ['auto'], 'a model that lists no level has none to offer');
  assert.deepEqual(levelsOf('claude', 'claude-opus-4-6'), ['low', 'medium', 'high', 'max']);

  // The panel draws it all: the list of each AI, the real name of every row's model, where the lists came from.
  const m = panelModel({ smDir: sm, ai: { others: { functions: { chat: { provider: 'claude', model: 'claude-opus-4-6' }, code: { provider: 'openai', model: 'gpt-5.5', effort: 'high' } } } }, keys: ['openai', 'deepseek'] });
  const row = (id) => m.functions.find((f) => f.id === id);
  assert.deepEqual([row('chat').model, row('chat').modelName], ['claude-opus-4-6', 'Opus 4.6']);
  assert.deepEqual([row('code').model, row('code').modelName], ['gpt-5.5', 'GPT-5.5']);
  assert.equal(row('plan').modelName, 'Sonnet 5.5', 'the policy\'s alias is said with its version');
  assert.deepEqual(Object.keys(m.modelList).sort(), ['claude', 'deepseek', 'openai']);
  assert.equal(m.modelList.openai.find((e) => e.id === 'gpt-5.5').verified, false);
  assert.equal(m.modelsInfo.openai.source, 'maker');
  assert.ok(m.modelCatalog.openai.includes('gpt-5.5'));
});

test('the watch reads a day apart, six hours after a failure, never twice inside a minute, and keeps the last good list', async () => {
  clearListed();
  const sm = dir();
  let clock = Date.parse('2026-10-16T12:00:00Z');
  const calls = { claude: 0, fetch: 0 };
  let claudeOk = true;
  const fetchFn = async () => { calls.fetch += 1; return { ok: true, status: 200, text: async () => JSON.stringify(DEEPSEEK_BODY), headers: new Map() }; };
  const askClaude = async () => { calls.claude += 1; return claudeOk ? { ok: true, models: claudeEntries(CLI_MODELS) } : { ok: false, error: 'timeout' }; };
  const watch = createModelWatch({ smDir: sm, keyOf: async (p) => (p === 'deepseek' ? 'sk-test-key-1234' : null), fetchFn, askClaude, now: () => clock });
  await watch.run();
  assert.deepEqual(calls, { claude: 1, fetch: 1 });
  clock += 3600_000;
  assert.deepEqual((await watch.run()).skipped.filter((s) => s.why === 'fresh').map((s) => s.provider).sort(), ['claude', 'deepseek'], 'inside the day nothing is asked');
  assert.deepEqual(calls, { claude: 1, fetch: 1 });
  await watch.run({ force: true });
  assert.deepEqual(calls, { claude: 2, fetch: 2 }, '"read now" skips the day');
  await watch.run({ force: true });
  assert.deepEqual(calls, { claude: 2, fetch: 2 }, 'but never twice inside a minute');
  clock += 25 * 3600_000;
  claudeOk = false;
  const failed = await watch.run();
  assert.deepEqual(failed.checked.sort(), ['claude', 'deepseek']);
  const file = JSON.parse(readFileSync(modelsFile(sm), 'utf8'));
  assert.equal(file.providers.claude.ok, false);
  assert.equal(file.providers.claude.error, 'timeout');
  assert.equal(file.providers.claude.models.length, 5, 'the last good list is kept');
  assert.equal(modelsOf('claude').length, 5);
  clock += 3 * 3600_000;
  await watch.run();
  assert.equal(calls.claude, 3, 'a failed look is not repeated for six hours');
  clock += 4 * 3600_000;
  claudeOk = true;
  await watch.run();
  assert.equal(calls.claude, 4);
  assert.equal(JSON.parse(readFileSync(modelsFile(sm), 'utf8')).providers.claude.ok, true);
});

test('a maker that answers badly changes nothing and costs no secret: short codes, never a key', async () => {
  clearListed();
  const sm = dir();
  const answers = [
    async () => ({ ok: false, status: 401, text: async () => 'bad key sk-test-key-1234' }),
    async () => { throw Object.assign(new Error('boom sk-test-key-1234'), { name: 'TimeoutError' }); },
    async () => ({ ok: true, status: 200, text: async () => '{"unexpected":1}', headers: new Map() }),
    async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-4o-mini-tts' }] }), headers: new Map() }),
  ];
  const errors = [];
  for (const fetchFn of answers) {
    const watch = createModelWatch({ smDir: dir(), keyOf: async (p) => (p === 'openai' ? 'sk-test-key-1234' : null), fetchFn, askClaude: async () => ({ ok: false, error: 'claude-not-found' }) });
    await watch.run();
  }
  const watch = createModelWatch({ smDir: sm, keyOf: async (p) => (p === 'openai' ? 'sk-test-key-1234' : null), fetchFn: answers[0], askClaude: async () => ({ ok: false, error: 'claude-not-found' }) });
  await watch.run();
  const text = readFileSync(modelsFile(sm), 'utf8');
  assert.ok(!text.includes('sk-test-key'), 'no key in the file');
  const file = JSON.parse(text);
  errors.push(file.providers.openai.error, file.providers.claude.error);
  assert.deepEqual(errors, ['http-401', 'claude-not-found']);
  assert.equal(modelsOf('openai').length, 3, 'the built-in models stand');
});

test('the real test of every model at every level rides the panel: how many answered, and a failed level is not offered', () => {
  clearListed();
  const sm = dir();
  mkdirSync(join(sm, 'bench'), { recursive: true });
  writeFileSync(join(sm, 'bench', 'levels.json'), JSON.stringify({ updatedAt: '2026-10-17T04:00:00Z', entries: [
    { provider: 'deepseek', model: 'deepseek-v4-pro', level: 'auto', ok: true, costUSD: 0 },
    { provider: 'deepseek', model: 'deepseek-v4-pro', level: 'high', ok: true, costUSD: 0 },
    { provider: 'deepseek', model: 'deepseek-v4-pro', level: 'max', ok: false, error: 'http-400', costUSD: 0 },
    { provider: 'deepseek', model: 'deepseek-v4-flash', level: 'low', ok: true, costUSD: 0 },
  ] }));
  const m = panelModel({ smDir: sm, ai: { others: { functions: { plan: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } }, keys: ['deepseek'] });
  const plan = m.functions.find((f) => f.id === 'plan');
  assert.ok(!plan.levelOptions.includes('max'), 'the level the test saw fail is not offered');
  assert.ok(plan.levelOptions.includes('high'));
  assert.ok(!m.agents.find((a) => a.id === 'planner').row.levelOptions.includes('max'), 'nor on the helper\'s row');
  const pro = m.modelList.deepseek.find((e) => e.id === 'deepseek-v4-pro');
  assert.deepEqual(pro.tested, { n: 3, ok: 2, at: '2026-10-17T04:00:00Z' });
  assert.deepEqual(m.modelList.deepseek.find((e) => e.id === 'deepseek-flash').tested, { n: 1, ok: 1, at: '2026-10-17T04:00:00Z' }, 'a test under the other name counts for the model');
});
