import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldReply } from '../server/web/chatfold.js';
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
  let log = chatLog(undefined, { type: 'run', data: { run: { kind: 'talk' }, model: 'claude-opus-5-5', effort: 'high', costUSD: 0 } });
  assert.equal(log.run.model, 'claude-opus-5-5');
  log = chatLog(log, { type: 'turn-end', data: { costUSD: 0.42 } });
  assert.equal(log.costUSD, 0.42);
  log = chatLog(log, { type: 'user', data: { text: 'OK, you may reinforce.', auto: 'reinforce' } });
  assert.equal(log.items.at(-1).auto, 'reinforce');
  log = chatLog(log, { type: 'history', data: { messages: [], costUSD: 1.5 } });
  assert.equal(log.costUSD, 1.5);
});
