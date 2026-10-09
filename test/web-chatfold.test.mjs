import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldReply } from '../server/web/chatfold.js';
import { runWords } from '../server/web/views.js';
import { chatLog } from '../server/web/views.js';
import { modelName } from '../server/web/live.js';

const FENCE = '```';
const card = `${FENCE}session-map\n{"title": "Login form", "doing": "Wiring the button", "todo": ["Error message"]}\n${FENCE}`;
const run = (body) => `${FENCE}session-map-run\n${body}\n${FENCE}`;

test('foldReply: a plain reply passes as it is', () => {
  assert.deepEqual(foldReply('Just text.\nTwo lines.'), { text: 'Just text.\nTwo lines.', plan: null, card: null, run: null });
});

test('foldReply takes the leading "Skills: … · Agents: …" line out of the text, in either language, with or without bold', () => {
  const pt = foldReply('**Skills:** brainstorming · **Agentes:** nenhum · **Por quê:** pequena\n\nFeito: troquei o título.');
  assert.equal(pt.text, 'Feito: troquei o título.');
  assert.equal(pt.plan, 'Skills: brainstorming · Agentes: nenhum · Por quê: pequena');
  const en = foldReply('> **Skills:** none apply · **Agents:** none\nDone.');
  assert.equal(en.text, 'Done.');
  assert.match(en.plan, /^Skills: none apply/);
  assert.equal(foldReply('Skills are useful.\nAnd more.').plan, null, 'a sentence about skills is not the status line');
  assert.equal(foldReply('First line.\n**Skills:** x · **Agentes:** y').plan, null, 'only a leading line folds');
});

test('foldReply takes the session-map card and the run block out of the text and reads them', () => {
  const folded = foldReply(`Done with the form.\n\n${card}\n\n${run('{"level":"helpers","why":"three files"}')}`);
  assert.equal(folded.text, 'Done with the form.');
  assert.deepEqual(folded.card, { title: 'Login form', doing: 'Wiring the button', todo: ['Error message'] });
  assert.deepEqual(folded.run, { level: 'helpers', why: 'three files' });
});

test('foldReply hides a block still being written, and keeps a broken card folded without reading it', () => {
  assert.equal(foldReply(`Almost.\n\n${FENCE}session-map\n{"title": "Lo`).text, 'Almost.');
  assert.equal(foldReply(`Almost.\n\n${FENCE}session-map-run\n{"lev`).text, 'Almost.');
  const broken = foldReply(`Ok.\n${FENCE}session-map\nnot json\n${FENCE}`);
  assert.equal(broken.text, 'Ok.');
  assert.deepEqual(broken.card, {});
  assert.equal(foldReply(`${FENCE}js\nconst a = 1;\n${FENCE}`).text, `${FENCE}js\nconst a = 1;\n${FENCE}`, 'other code blocks stay');
});

test('modelName: aliases and full ids read as a person would say them', () => {
  assert.equal(modelName('sonnet'), 'Sonnet');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('opus[1m]'), 'Opus 1M');
  assert.equal(modelName('claude-sonnet-4-6[1m]'), 'Sonnet 4.6 1M');
  assert.equal(modelName('my-custom-model'), 'my-custom-model');
  assert.equal(modelName(null), null);
});

test('chatLog keeps the latest run info and cost, takes the cost of a turn, and marks the answer session-map gave for the person', () => {
  let log = chatLog(undefined, { type: 'run', data: { run: { kind: 'auto', selfReinforce: false }, model: 'claude-opus-5-5', effort: 'high', costUSD: 0 } });
  assert.equal(log.run.model, 'claude-opus-5-5');
  log = chatLog(log, { type: 'turn-end', data: { costUSD: 0.42 } });
  assert.equal(log.costUSD, 0.42);
  log = chatLog(log, { type: 'user', data: { text: 'OK, you may reinforce.', auto: 'reinforce' } });
  assert.equal(log.items.at(-1).auto, 'reinforce');
  log = chatLog(log, { type: 'history', data: { messages: [], costUSD: 1.5 } });
  assert.equal(log.costUSD, 1.5);
});

const tt = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

test('runWords: what runs, at which level, why and how much it cost, for each way of running', () => {
  const mine = { model: 'opus[1m]', effort: 'xhigh', ultracode: false };
  assert.deepEqual(runWords(tt, { choice: { kind: 'auto', selfReinforce: false }, info: null, mine }), {
    way: 'run.way.auto', model: 'Opus', effort: 'run.effort.high', why: 'run.why.auto', tone: 'auto', cost: null,
  });
  const live = runWords(tt, { choice: { kind: 'auto', selfReinforce: false }, info: { model: 'claude-opus-5-5', effort: 'high', level: 'reinforced', why: 'mexe no login', costUSD: 0.3 }, mine });
  assert.deepEqual([live.model, live.why, live.tone, live.cost], ['Opus 5.5', 'run.level.reinforced(mexe no login)', 'reinforced', 0.3]);
  assert.equal(runWords(tt, { choice: { kind: 'auto', selfReinforce: false }, info: { level: 'ask-reinforce', why: 'x', estimateUSD: 4 }, mine }).tone, 'ask');
  const ultra = runWords(tt, { choice: { kind: 'ultracode' }, info: null, mine });
  assert.deepEqual([ultra.way, ultra.effort, ultra.tone], ['run.way.ultracode', 'run.effort.xhigh', 'ultracode']);
  const fixed = runWords(tt, { choice: { kind: 'fixed', model: 'haiku', effort: 'low' }, info: null, mine });
  assert.deepEqual([fixed.model, fixed.effort, fixed.why], ['Haiku', 'run.effort.low', 'run.why.fixed']);
  const same = runWords(tt, { choice: { kind: 'settings' }, info: null, mine });
  assert.deepEqual([same.model, same.effort], ['Opus 1M', 'run.effort.xhigh']);
  const unknown = runWords(tt, { choice: { kind: 'settings' }, info: null, mine: { model: null, effort: null, ultracode: false } });
  assert.deepEqual([unknown.model, unknown.effort], ['run.modelDefault', null]);
});

test('runWords: a run event of the way it ran before does not speak for a new choice, but its cost still counts', () => {
  const info = { run: { kind: 'auto', selfReinforce: false }, model: 'claude-opus-5-5', effort: 'high', level: 'helpers', why: 'x', costUSD: 0.7 };
  const words = runWords(tt, { choice: { kind: 'fixed', model: 'haiku', effort: 'low' }, info, mine: null });
  assert.deepEqual([words.model, words.effort, words.why, words.cost], ['Haiku', 'run.effort.low', 'run.why.fixed', 0.7]);
  const same = runWords(tt, { choice: { kind: 'auto', selfReinforce: true }, info, mine: null });
  assert.equal(same.model, 'Opus 5.5', 'only the permission to reinforce changed: the same claude still runs');
});
