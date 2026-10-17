import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrainView } from '../server/web/brainview.js';
import { translator } from '../server/web/i18n.js';
import { panelModel } from '../server/ai/brainpanel.mjs';
import { clearListed } from '../server/ai/model-registry.mjs';
import { claudeEntries, deepseekEntries, modelsFile, openaiEntries } from '../server/ai/models.mjs';

// The Cérebro tab's model selectors (id168): every model of the chosen AI with its real name, in groups, and under the row
// what is known about the chosen one. Drawn from the server's own panel model, in a fake page.

const fakeH = (tag, attrs = {}, ...children) => ({
  tag, attrs: attrs ?? {}, children: children.flat(Infinity).filter((c) => c != null && c !== false),
  get text() { return this.children.map((c) => (typeof c === 'string' ? c : c.text)).join(' '); },
});
const all = (el) => (typeof el === 'string' ? [] : [el, ...el.children.flatMap(all)]);
const byAttr = (root, k, v) => all(root).find((e) => e.attrs?.[k] === v);

function setup({ lang = 'pt-BR', ai = {}, keys = ['openai', 'deepseek'], lists = true, cli = () => null } = {}) {
  clearListed();
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brainview-'));
  if (lists) {
    writeFileSync(modelsFile(smDir), JSON.stringify({ version: 1, providers: {
      claude: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: claudeEntries([
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Most efficient for simpler tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Best for everyday, complex tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      ]) },
      openai: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: openaiEntries({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-5.5' }, { id: 'gpt-4o' }] }) },
      deepseek: { checkedAt: '2026-10-16T12:00:00Z', ok: true, models: deepseekEntries({ data: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, effort: { supported_levels: ['low', 'high', 'max'] } }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', context_window: 1048576 }] }) },
    } }));
  }
  const panel = panelModel({ smDir, ai, keys, cli });
  const saved = [];
  const t = translator(lang);
  const api = { brain: async () => panel, setBrain: async (b) => { saved.push(b); return panel; }, refreshModels: async () => { saved.push('refresh'); return panel; }, brainConfig: async () => ({ ok: false }) };
  globalThis.document = { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } };
  const view = createBrainView({ h: fakeH, t, api, toast() {}, lang: () => lang });
  const root = { children: [], replaceChildren(...c) { this.children = c; }, querySelector: () => null };
  return { view, root, saved, panel };
}

const rowBody = (root, id) => byAttr(root.children[0], 'data-brain-row', id);

test('the model selector of the talk lists every model Claude Code lists, by real name, in two groups', async () => {
  const { view, root } = setup();
  await view.render(root);
  const select = byAttr(rowBody(root, 'chat'), 'data-brain', 'chat:model');
  const groups = select.children.filter((c) => c.tag === 'optgroup');
  assert.deepEqual(groups.map((g) => g.attrs.label), ['Atuais', 'Outras versões']);
  const names = (g) => g.children.map((o) => o.text.trim());
  assert.deepEqual(names(groups[0]), ['Opus 5.5', 'Sonnet 5.5']);
  assert.deepEqual(names(groups[1]), ['Opus 4.8']);
  assert.equal(select.children[0].text, 'Padrão da IA', 'the first option is "automatic"');
  const chosen = all(select).filter((e) => e.tag === 'option' && e.attrs.selected);
  assert.deepEqual(chosen.map((o) => o.text.trim()), ['Opus 5.5'], 'the policy default shows with its version, not as "opus"');
});

test('under the row, the chosen model\'s note, context, price and the exact id of the call, in the person\'s language', async () => {
  const { view, root } = setup();
  await view.render(root);
  const note = byAttr(rowBody(root, 'chat'), 'data-brain-note', 'chat');
  assert.match(note.text, /Para trabalho complexo e tarefas do dia a dia/);
  assert.match(note.text, /US\$ 4,00 entrada \/ 20,00 saída, por 1 mi/);
  assert.match(note.text, /chamada: claude-opus-5-5/);
  const en = setup({ lang: 'en' });
  await en.view.render(en.root);
  assert.match(byAttr(rowBody(en.root, 'chat'), 'data-brain-note', 'chat').text, /For complex work and everyday tasks · US\$ 4\.00 in \/ 20\.00 out, per 1M · call: claude-opus-5-5/);
});

test('a row run by helpers offers only the models the helper tool accepts, and says so', async () => {
  const { view, root } = setup();
  await view.render(root);
  const body = rowBody(root, 'role-coder');
  const select = byAttr(body, 'data-brain', 'code:model');
  const options = all(select).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(options, ['Padrão da IA', 'Opus 5.5', 'Sonnet 5.5'], 'Opus 4.8 is not offered where a helper would silently run on another model');
  assert.match(byAttr(body, 'data-brain-note', 'code').text, /só aparecem estes modelos/);
});

test('another AI lists its whole list: the ones the program checked first, then the rest, with the honest word for them', async () => {
  const ai = { others: { functions: { code: { provider: 'openai', model: 'gpt-5.5', effort: 'high' }, plan: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } } } };
  const { view, root } = setup({ ai });
  await view.render(root);
  const code = rowBody(root, 'role-coder');
  const select = byAttr(code, 'data-brain', 'code:model');
  const groups = select.children.filter((c) => c.tag === 'optgroup');
  assert.deepEqual(groups.map((g) => g.attrs.label), ['Verificados pelo programa', 'Mais da lista do provedor']);
  assert.deepEqual(groups[0].children.map((o) => o.text.trim()), ['GPT-6 Luna (fora da lista)', 'GPT-6.1 Sol', 'GPT-6 Astra (fora da lista)']);
  assert.deepEqual(groups[1].children.map((o) => o.text.trim()), ['GPT-5.5', 'GPT-4o']);
  const note = byAttr(code, 'data-brain-note', 'code').text;
  assert.match(note, /preço fora da lista do provedor/);
  assert.match(note, /o programa envia uma chamada básica e ainda não o mediu/);
  // The row's summary says the real name and does not say the AI twice.
  const summary = (id) => rowBody(root, id).children[0].text;
  assert.match(summary('role-coder'), /OpenAI · GPT-5\.5 · alto/);
  assert.match(summary('role-planner'), /DeepSeek V4 Pro · alto/);
  assert.doesNotMatch(summary('role-planner'), /DeepSeek · DeepSeek/);
  // The DeepSeek list is the maker's: its own name, the context window and no "not measured" word for a model the program prices.
  const plan = byAttr(rowBody(root, 'role-planner'), 'data-brain-note', 'plan').text;
  assert.match(plan, /contexto de 1M/);
  assert.match(plan, /US\$ 1,32 entrada \/ 3,96 saída/);
  assert.doesNotMatch(plan, /ainda não o mediu/);
});

test('choosing a model saves exactly that id', async () => {
  const { view, root, saved } = setup();
  await view.render(root);
  const select = byAttr(rowBody(root, 'chat'), 'data-brain', 'chat:model');
  await select.attrs.onchange({ target: { value: 'claude-opus-4-8' } });
  assert.deepEqual(saved[0], { functions: { chat: { model: 'claude-opus-4-8' } } });
});

test('the lists fold says where each list came from and has the button that reads them now', async () => {
  const { view, root, saved } = setup();
  await view.render(root);
  const fold = all(root.children[0]).find((e) => e.attrs?.class === 'br-more' && /Listas de modelos/.test(e.text));
  assert.ok(fold);
  assert.match(fold.text, /Claude: 3 modelos, do Claude Code · lida em/);
  assert.match(fold.text, /OpenAI: 3 modelos, da lista do provedor/);
  const button = byAttr(fold, 'data-brain-refresh', '1');
  const el = { disabled: false, textContent: '' };
  await button.attrs.onclick({ currentTarget: el });
  assert.deepEqual(saved, ['refresh']);
});

test('without any list read the page still draws the built-in models with their real names', async () => {
  const { view, root } = setup({ lists: false });
  await view.render(root);
  const select = byAttr(rowBody(root, 'chat'), 'data-brain', 'chat:model');
  const all12 = all(select).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.equal(all12.length, 13, 'automatic and the twelve of Claude Code');
  assert.ok(all12.includes('Fable 5.1') && all12.includes('Haiku 4.5') && all12.includes('Opus 4.6'));
});

test('DeepSeek: each model once, the maximum inside the list of levels and no button beside it; the talk says its one AI', async () => {
  const ai = { others: { functions: { plan: { provider: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' } } } };
  const { view, root } = setup({ ai });
  await view.render(root);
  const body = rowBody(root, 'role-planner');
  const models = all(byAttr(body, 'data-brain', 'plan:model')).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(models, ['Padrão da IA', 'DeepSeek V4.1 Flash', 'DeepSeek V4 Pro'], 'the other name of Flash (deepseek-v4-flash) is the same model, shown once and chosen');
  const levels = all(byAttr(body, 'data-brain', 'plan:effort')).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(levels, ['Padrão', 'desligado', 'baixo', 'alto', 'máximo'], 'the maximum is one more level of the list');
  assert.equal(all(body).filter((e) => e.tag === 'button').length, 0, 'no Max button beside the list');
  const chat = rowBody(root, 'chat');
  const ais = all(byAttr(chat, 'data-brain', 'chat:provider')).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(ais, ['Claude', 'DeepSeek'], 'the talk runs on Claude or on DeepSeek, which speaks Claude Code\'s protocol (id170); OpenAI cannot');
  assert.ok(all(chat).some((e) => e.tag === 'button' && /Ultracode/.test(e.text)), 'Claude keeps its Ultracode switch, which is not a level');
});

test('the talk on DeepSeek: its models and levels, and the note that says what changes (id170)', async () => {
  const { view, root } = setup({ ai: { others: { functions: { chat: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } } } } });
  await view.render(root);
  const chat = rowBody(root, 'chat');
  assert.match(chat.children[0].text, /DeepSeek V4 Pro · alto/);
  const models = all(byAttr(chat, 'data-brain', 'chat:model')).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(models, ['Padrão da IA', 'DeepSeek V4.1 Flash', 'DeepSeek V4 Pro']);
  const levels = all(byAttr(chat, 'data-brain', 'chat:effort')).filter((e) => e.tag === 'option').map((o) => o.text.trim());
  assert.deepEqual(levels, ['Padrão', 'baixo', 'alto', 'máximo'], 'no "off": Claude Code cannot switch thinking off');
  assert.match(chat.text, /As conversas novas começam no DeepSeek; as que já existem continuam na IA em que começaram/);
  assert.equal(all(chat).some((e) => e.tag === 'button'), false, 'no Ultracode: it is Claude\'s');
  const none = setup({ keys: ['openai'] });
  await none.view.render(none.root);
  const fixed = byAttr(rowBody(none.root, 'chat'), 'data-brain', 'chat:provider');
  assert.deepEqual([fixed.tag, fixed.text], ['div', 'Claude'], 'with no AI that can run the talk, its one AI is said, not offered in a list');
});
