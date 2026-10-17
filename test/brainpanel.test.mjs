import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_FUNCTIONS, functionById, functionsOf, mergeFunctionChoice, panelModel } from '../server/ai/brainpanel.mjs';

// The Cérebro panel's model (id124, or39): one registry of the AI functions, mechanical resolution of engine and
// level, and the merge that saves the person's choices.

test('the function registry loads complete: every id once, orders in line', () => {
  assert.equal(AI_FUNCTIONS.length, 16);
  assert.deepEqual(AI_FUNCTIONS.map((f) => f.id).sort(), [...new Set(AI_FUNCTIONS.map((f) => f.id))].sort());
  assert.deepEqual(AI_FUNCTIONS.map((f) => f.order), AI_FUNCTIONS.map((_, i) => i + 1));
  for (const f of AI_FUNCTIONS) {
    assert.ok(f.en.label && f.pt.label && f.en.does && f.pt.does, f.id);
    assert.ok(f.kinds?.length || f.engine !== undefined, f.id);
  }
  assert.equal(functionById('code').kinds[0], 'code');
  assert.equal(functionById('agents').kinds[0], 'code', 'an agent runs at the level of the function it executes');
  assert.ok(functionById('agents').note.pt.includes('todo ajudante Claude'), 'the row says it is one rule over every Claude helper (id156)');
  assert.equal(functionById('team').engine, null, 'teams have no call of their own: the cap is the engine\'s (id146)');
  assert.ok(functionById('team').note.pt.includes('não tem chamada própria'), 'the row declares it');
  assert.equal(functionById('nada'), null);
});

test('functionsOf keeps only well-shaped choices', () => {
  assert.deepEqual(functionsOf(null), {});
  assert.deepEqual(functionsOf({ others: { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } } } }),
    { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } });
  // Reading is tolerant: the valid parts stay, a model that does not belong to its provider is dropped.
  assert.deepEqual(functionsOf({ others: { functions: { code: { provider: 'nada' }, x: { provider: 'openai' }, plan: { effort: 'turbo' }, risk: { provider: 'deepseek', model: 'gpt-6-luna' } } } }),
    { risk: { provider: 'deepseek' } });
});

test('mergeFunctionChoice writes, removes and refuses', () => {
  const ai = { others: { enabled: true } };
  const set = mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro' }, plan: { effort: 'low' } } });
  assert.equal(set.ok, true);
  assert.deepEqual(set.ai.others.functions, { code: { provider: 'deepseek', model: 'deepseek-v4-pro' }, plan: { effort: 'low' } });
  const off = mergeFunctionChoice(set.ai, { functions: { code: { provider: 'auto', model: 'auto' } } });
  assert.deepEqual(off.ai.others.functions, { plan: { effort: 'low' } });
  assert.equal(mergeFunctionChoice(ai, { functions: { nada: { provider: 'deepseek' } } }).error, 'unknown-function');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'x' } } }).error, 'unknown-provider');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { effort: 'turbo' } } }).error, 'bad-effort');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { model: 'gpt-6-luna' } } }).error, 'bad-model', 'a model needs its provider');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', model: 'gpt-6-luna' } } }).error, 'bad-model', 'a model must belong to the provider');
  // The level is the engine's own vocabulary (or41): a level the engine does not accept is refused.
  const levels = mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'off' } } });
  assert.equal(levels.ok, true);
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'medium' } } }).error, 'bad-effort');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', effort: 'xhigh' } } }).error, 'bad-effort', 'xhigh is Claude\'s word');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { effort: 'off' } } }).ok, true, 'without a motor the word is kept, and applied only when it fits');
  const ultra = mergeFunctionChoice(ai, { functions: { chat: { provider: 'claude', model: 'fable', effort: 'max' } } });
  assert.equal(ultra.ok, true, 'max is a real Claude level');
  const ucode = mergeFunctionChoice(ai, { functions: { code: { provider: 'claude', model: 'sonnet', effort: 'ultracode' } } });
  assert.equal(ucode.ok, true, 'ultracode is Claude\'s own setting, where xhigh exists');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'claude', model: 'haiku', effort: 'ultracode' } } }).error, 'bad-effort', 'no xhigh, no ultracode');
  assert.equal(mergeFunctionChoice(ai, { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'ultracode' } } }).error, 'bad-effort', 'ultracode is not DeepSeek\'s word');
});

test('panelModel resolves every function mechanically', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-'));
  const m = panelModel({ smDir, ai: {} });
  assert.equal(m.ok, true);
  assert.deepEqual(m.matrix.map((x) => x.id), ['claude', 'openrouter', 'deepseek', 'gemini', 'openai']);
  assert.equal(m.matrix[0].models.length, 4);
  assert.equal(m.functions.length, 16);
  const byId = Object.fromEntries(m.functions.map((f) => [f.id, f]));
  assert.deepEqual([byId.chat.provider, byId.chat.model, byId.chat.effort], ['claude', 'opus', 'high']);
  assert.deepEqual(byId.chat.levelOptions, ['low', 'medium', 'high', 'xhigh', 'max'], 'Opus reaches max');
  assert.equal(byId.chat.topLevel, 'ultracode', 'Opus supports xhigh: its top button is ultracode');
  assert.deepEqual([byId.plan.provider, byId.plan.model, byId.plan.effort], ['claude', 'sonnet', 'medium']);
  assert.deepEqual(byId.plan.levelOptions, ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual([byId.risk.provider, byId.risk.effort], ['claude', 'high']);
  assert.equal(byId.gather.effort, 'low');
  assert.deepEqual(byId.gather.levelOptions, ['low', 'medium', 'high'], 'Haiku has three levels');
  assert.equal(byId.gather.topLevel, null, 'Haiku has no ultracode');
  assert.equal(byId.web.provider, null);
  assert.equal(byId.brain.why, 'auto', 'no key: the preference falls to Claude');
  assert.deepEqual([byId.agents.provider, byId.agents.why], ['claude', 'policy']);
  assert.equal(byId.code.agent, true, 'every policy kind is an agent kind');
  assert.equal(byId.brain.agent, false, 'the entry brain is not an agent');
  assert.deepEqual([byId.team.provider, byId.team.why], [null, 'not-wired'], 'teams have no call of their own: the cap is the engine\'s and each agent follows its kind row (id146)');
  assert.match(byId.team.note, /no call of its own/, 'the row declares it');
  // The fusion (id142): the ponytail intensity married to the efforts, and the measured numbers in the panel.
  assert.deepEqual(m.ponytailLevels, { low: 'lite', medium: 'full', high: 'full', xhigh: 'ultra', max: 'ultra' });
  assert.equal(m.ponytail?.codePct, 53, 'the vendored measurement feeds the panel');
  assert.equal(m.flow, undefined, 'the narrative flow left the model: it was not what runs');
  assert.deepEqual(m.rules.map((r) => r.id), ['climbs', 'checker', 'failover', 'cap'], 'only the rules that hold in every run');
  assert.deepEqual(m.engineOptions, ['auto', 'claude']);
  assert.deepEqual(Object.keys(m.modelCatalog).sort(), ['claude', 'deepseek', 'gemini', 'openai', 'openrouter']);
});

test('an explicit choice replaces the policy for that function only', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-'));
  const ai = { others: { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro' }, plan: { effort: 'low' } } } };
  const m = panelModel({ smDir, ai, bin: () => false });
  const byId = Object.fromEntries(m.functions.map((f) => [f.id, f]));
  assert.deepEqual([byId.code.provider, byId.code.model, byId.code.effort, byId.code.why], ['deepseek', 'deepseek-v4-pro', 'medium', 'handoff-answers'], 'no engine edits files for it: the chat only asks it for answers');
  const harness = panelModel({ smDir, ai, bin: (n) => n === 'dsh' });
  assert.equal(harness.functions.find((f) => f.id === 'code').why, 'handoff-edits', 'the DeepSeek Harness is installed: the chat hands it the work');
  assert.deepEqual([byId.plan.provider, byId.plan.model, byId.plan.effort, byId.plan.why], ['claude', 'sonnet', 'low', 'choice']);
  assert.equal(m.engines.brain, byId.brain.provider, 'the chips on top show the AI the brain row really runs on');
  assert.deepEqual([byId.risk.provider, byId.risk.why], ['claude', 'policy']);
  // The chat honors its model and level choices while the engine stays Claude.
  const chat = panelModel({ smDir, ai: { others: { functions: { chat: { model: 'sonnet', effort: 'low' } } } } });
  const chatRow = chat.functions.find((f) => f.id === 'chat');
  assert.deepEqual([chatRow.provider, chatRow.model, chatRow.effort], ['claude', 'sonnet', 'low']);
  assert.equal(chatRow.why, 'choice', 'chosen here: it says so');
  // Nothing chosen: the policy's default, said as the policy's and not as a choice; the entry brain does not touch it.
  const dflt = panelModel({ smDir, ai: { others: { functions: { brain: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } } } } }).functions.find((f) => f.id === 'chat');
  assert.deepEqual([dflt.model, dflt.effort, dflt.why], ['opus', 'high', 'policy']);
});

test('the panel serves the specialists with their resolved rows (or55)', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-'));
  const m = panelModel({ smDir, ai: {} });
  assert.equal(m.agents.length, 9);
  assert.deepEqual(m.agents.map((a) => a.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const coder = m.agents.find((a) => a.id === 'coder');
  assert.deepEqual(coder.kinds, ['code', 'test']);
  assert.deepEqual(coder.tools, ['Edit', 'Write', 'MultiEdit', 'Bash', 'PowerShell']);
  assert.ok(coder.method.length >= 3 && coder.methodPt.length === coder.method.length, 'the senior method rides the panel (or56)');
  assert.deepEqual([coder.row.provider, coder.row.model, coder.row.effort], ['claude', 'sonnet', 'medium']);
  const guardian = m.agents.find((a) => a.id === 'guardian');
  assert.deepEqual(guardian.kinds, ['security', 'money', 'personal-data']);
  assert.deepEqual([guardian.row.provider, guardian.row.effort], ['claude', 'high']);
  const finder = m.agents.find((a) => a.id === 'finder');
  assert.deepEqual([finder.row.provider, finder.row.model, finder.row.effort], ['claude', 'haiku', 'low']);
  const architect = m.agents.find((a) => a.id === 'architect');
  assert.deepEqual([architect.row.provider, architect.row.effort], ['claude', 'high']);
});

test('the panel serves which engine edits files today, injectable for the tests (or62)', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-'));
  const m = panelModel({ smDir, ai: {}, bin: (n) => n === 'codex' });
  assert.equal(m.agentEngines.claude.edits, 'hooks');
  assert.equal(m.agentEngines.openai.edits, 'worktree');
  assert.equal(m.agentEngines.gemini.edits, 'api');
  assert.equal(m.agentEngines.deepseek.edits, 'api');
});

test('the tab shows the AI each row really runs on (id155): the brain row\'s own choice, Claude alone for the talk, any AI for the book (id156)', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-'));
  const ai = { others: { functions: { brain: { provider: 'deepseek' }, background: { provider: 'gemini', model: 'gemini-3.1-flash-lite' }, chat: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } };
  const byId = Object.fromEntries(panelModel({ smDir, ai, keys: ['deepseek', 'gemini'], cli: () => null }).functions.map((f) => [f.id, f]));
  assert.deepEqual([byId.brain.provider, byId.brain.why], ['deepseek', 'choice']);
  assert.deepEqual([byId.background.provider, byId.background.model], ['gemini', 'gemini-3.1-flash-lite']);
  // The talk runs where Claude Code runs (id170): Claude, or DeepSeek, which speaks its protocol; never Gemini.
  assert.deepEqual([byId.chat.provider, byId.chat.model, byId.chat.effort], ['deepseek', 'deepseek-v4-pro', 'high']);
  assert.deepEqual(byId.chat.providers, ['claude', 'deepseek']);
  assert.deepEqual(byId.chat.levelOptions, ['low', 'high', 'max'], 'DeepSeek\'s own levels, without "off": Claude Code has no word for it');
  const gem = panelModel({ smDir, ai: { others: { functions: { chat: { provider: 'gemini', model: 'gemini-3.8-flash' } } } }, keys: ['gemini'], cli: () => null }).functions.find((f) => f.id === 'chat');
  assert.deepEqual([gem.provider, gem.model, gem.providers], ['claude', 'opus', ['claude']], 'without Gemini CLI, Gemini cannot run the talk: Claude, and its model never shows');
  // With their own programs installed (id171), OpenAI and Gemini run the talk too, in the words those programs take.
  const both = panelModel({ smDir, ai: { others: { functions: { chat: { provider: 'gemini', model: 'gemini-3.8-flash', effort: 'low' } } } }, keys: ['gemini', 'openai'], cli: (p) => `C:/npm/${p}.js` }).functions.find((f) => f.id === 'chat');
  assert.deepEqual([both.provider, both.model, both.effort, both.providers], ['gemini', 'gemini-3.8-flash', 'low', ['claude', 'gemini', 'openai']]);
  assert.deepEqual(both.levelOptions, ['low', 'medium', 'high']);
  const gpt = panelModel({ smDir, ai: { others: { functions: { chat: { provider: 'openai', model: 'gpt-6.1-sol' } } } }, keys: ['openai'], cli: (p) => `C:/npm/${p}.js` }).functions.find((f) => f.id === 'chat');
  assert.deepEqual([gpt.provider, gpt.model, gpt.effort, gpt.levelOptions], ['openai', 'gpt-6.1-sol', 'medium', ['low', 'medium', 'high', 'xhigh']], "Codex's words: no max for Sol");
  assert.equal(mergeFunctionChoice({}, { functions: { chat: { provider: 'openrouter' } } }).error, 'unknown-provider');
  assert.equal(mergeFunctionChoice({}, { functions: { chat: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'off' } } }).error, 'bad-effort');
  assert.equal(mergeFunctionChoice({}, { functions: { chat: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'max' } } }).ok, true);
  assert.equal(byId.book.providers, undefined, 'the book takes any AI with a key too');
  assert.deepEqual([byId.book.provider, byId.book.model, byId.book.why], ['claude', 'haiku', 'policy'], 'nothing chosen: Claude, the cheap default, said as the default');
  const onDeepseek = panelModel({ smDir, ai: { others: { functions: { book: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } } } }, keys: ['deepseek'] }).functions.find((f) => f.id === 'book');
  assert.deepEqual([onDeepseek.provider, onDeepseek.model, onDeepseek.effort, onDeepseek.why], ['deepseek', 'deepseek-flash', 'low', 'choice'], 'the book row can name another AI');
  assert.equal(byId.code.providers, undefined, 'the work rows take any AI with a key');
  const noKey = Object.fromEntries(panelModel({ smDir, ai, keys: [] }).functions.map((f) => [f.id, f]));
  assert.deepEqual([noKey.brain.provider, noKey.brain.why], ['claude', 'choice-unavailable'], 'no key: Claude, and the tab says why');
});
