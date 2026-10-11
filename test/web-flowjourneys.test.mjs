// The Journeys view of the Flow (flow.md fl10) on the page: the names in the page language, each step in plain words,
// and the drawing of one journey alone, its boxes top to bottom in the order they are walked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectJourneys } from '../server/arch/flowjourneys.mjs';
import { planImport } from '../server/arch/flow.mjs';
import { exportTextFor, isViewText, journeyChoices, journeyFlow, journeyName, journeySteps, legendKeys, legendWords } from '../server/web/flowlevel.js';
import { crumbsOf, levelOf, usesModel } from '../server/web/flowview.js';
import { LANGS, translator } from '../server/web/i18n.js';

const en = translator('en');
const pt = translator('pt-BR');
const lbl = (key) => ({ from: 'catalog', text: null, key: `flow.l1.lbl.${key}`, missing: false });
const fact = (x) => ({ origin: 'detected', badges: ['detected'], declared: [], detected: [], declaredCount: 0, detectedCount: 1, ...x });
const part = (id, name, layer) => fact({ id: `part:${id}`, kind: 'part', name, partId: id, layer, drawId: id.toUpperCase().replace(/-/g, '_') });
const edge = (from, to, kind, key) => fact({ id: `${from}>${to}#${kind}`, from, to, kind, label: lbl(key) });
const BASE = {
  layers: [{ id: 'l:actors', name: 'Who uses it', nameKey: 'flow.l1.layer.actors' }, { id: 'l:core', name: 'Core' }, { id: 'l:outside', name: 'Outside services', nameKey: 'flow.l1.layer.outside' }],
  nodes: [
    fact({ id: 'actor:browser', kind: 'actor', layer: 'l:actors', nameKey: 'flow.l1.actor.browser', name: 'You, in the browser' }),
    part('server', 'Server', 'l:core'), part('page-chat', 'Page chat', 'l:core'), part('mind-map-page', 'Mind map page', 'l:core'),
    fact({ id: 'svc:claude', kind: 'service', where: 'internet', layer: 'l:outside', nameKey: 'flow.l1.svc.claude', name: 'Claude (AI)' }),
  ],
  edges: [
    edge('actor:browser', 'part:server', 'actor', 'browser'),
    edge('part:server', 'part:mind-map-page', 'flow', 'role.toPage'),
    edge('part:page-chat', 'part:server', 'flow', 'role.chat'),
    edge('part:page-chat', 'svc:claude', 'service', 'ai'),
  ],
};
const MODEL = { ...BASE, journeys: detectJourneys(BASE) };

test('journey names are in the page language, filled with the boxes the path took', () => {
  assert.deepEqual(MODEL.journeys.map((j) => j.id), ['j:open-map', 'j:chat-ai']);
  assert.equal(journeyName(MODEL, MODEL.journeys[0], en), 'You open “Mind map page”');
  assert.equal(journeyName(MODEL, MODEL.journeys[0], pt), 'Você abre “Mind map page”');
  assert.equal(journeyName(MODEL, MODEL.journeys[1], pt), 'Você pergunta em “Page chat” e a IA responde');
  assert.deepEqual(journeyChoices(MODEL, pt).map((c) => c.label), ['Você abre “Mind map page”', 'Você pergunta em “Page chat” e a IA responde']);
  const filler = { id: 'j:from:actor:browser', nameKey: 'flow.j.name.path', name: 'x', args: { start: 'actor:browser', end: 'svc:claude' } };
  assert.equal(journeyName(MODEL, filler, pt), 'De Você, no navegador até Claude (IA)');
  for (const key of ['open', 'chatAppears', 'chatAi', 'pay', 'alertPhone', 'command', 'alertScreen', 'openPhone', 'path']) {
    for (const lang of ['en', 'pt-BR']) assert.ok(LANGS[lang][`flow.j.name.${key}`], `${lang} ${key}`);
  }
});

test('each step in plain words: who → who, and what goes along; a step against the arrow says who is asked and what comes back', () => {
  const steps = journeySteps(MODEL, 'j:chat-ai', pt);
  assert.deepEqual(steps.map((s) => [s.n, s.from, s.to, s.words, s.back]), [
    [1, 'Você, no navegador', 'Server', 'páginas e cliques', false],
    [2, 'Server', 'Page chat', 'pede a “Page chat”, que devolve: conversas e respostas', true],
    [3, 'Page chat', 'Claude (IA)', 'pergunta com fatos → resposta', false],
  ]);
  assert.deepEqual(steps.map((s) => s.partId), ['server', 'page-chat', 'page-chat']);
  assert.equal(journeySteps(MODEL, 'j:chat-ai', en)[1].words, 'asks “Page chat”, which answers with: chats and replies');
  assert.deepEqual(journeySteps(MODEL, 'nope', en), []);
});

test('a journey drawn alone: its boxes top to bottom in walking order, one numbered arrow per step, never importable', () => {
  const v = journeyFlow(MODEL, 'j:chat-ai', { tt: en });
  assert.equal(v.scene.rows.length, 4);
  const rowOf = (id) => v.scene.rows.findIndex((r) => r.groups[0].id === v.scene.nodes.find((n) => n.id === id).group);
  const order = [...v.scene.nodes].sort((a, b) => rowOf(a.id) - rowOf(b.id)).map((n) => n.label);
  assert.deepEqual(order, ['You, in the browser', 'Server', 'Page chat', 'Claude (AI)']);
  // No band titles to cross: the layer each box belongs to is the small line under its name.
  assert.ok(v.scene.rows.every((r) => r.groups[0].title === ''));
  assert.deepEqual(v.scene.nodes.map((n) => n.sub), ['Who uses it', 'Core', 'Core', 'Outside services']);
  assert.deepEqual(v.scene.edges.map((e) => e.label), ['1 · pages and clicks', '2 · asks “Page chat”, which answers with: chats and replies', '3 · question with facts → answer']);
  // Every arrow goes down the page, in the order walked; the facts keep the real arrows.
  for (const e of v.scene.edges) assert.equal(rowOf(e.to), rowOf(e.from) + 1);
  assert.deepEqual(v.meta.edges.map((m) => m.edgeId), MODEL.journeys[1].edges);
  assert.equal(v.meta.nodes.size, 4);
  assert.equal([...v.meta.nodes.values()].find((x) => x.nodeId === 'part:page-chat').partId, 'page-chat');
  assert.ok(v.text.startsWith('%% session-map:view journey chat-ai\n'));
  assert.ok(isViewText(v.text));
  assert.equal(exportTextFor('journeys', 'flowchart LR\n  A --> B', v.text), v.text);
  assert.equal(journeyFlow(MODEL, 'nope', { tt: en }), null);
});

test('the Journeys level is kept like the others, reads the model, and has its legend', () => {
  assert.equal(levelOf('journeys'), 'journeys');
  assert.equal(levelOf('weird'), '1');
  assert.equal(usesModel('1'), true);
  assert.equal(usesModel('journeys'), true);
  assert.equal(usesModel('parts'), false);
  assert.ok(legendKeys('1', { journey: true }).includes('dim'));
  assert.ok(!legendKeys('1').includes('dim'));
  assert.ok(legendKeys('journeys').includes('step'));
  for (const lang of ['en', 'pt-BR']) {
    const tt = translator(lang);
    for (const k of ['dim', 'step']) assert.notEqual(legendWords(k, tt), `flow.tone.${k}`, `${lang} ${k}`);
    for (const key of ['flow.level.journeys', 'flow.j.list', 'flow.j.steps', 'flow.j.none', 'flow.j.back', 'flow.j.openPart']) assert.ok(LANGS[lang][key], `${lang} ${key}`);
  }
  assert.equal(pt('flow.level.journeys'), 'Percursos');
  // A part opened from the Journeys level goes back there.
  assert.deepEqual(crumbsOf({ partId: 'server', from: 'journeys' }, 'Server', pt), [{ label: 'Percursos', level: 'journeys' }, { label: 'Server', level: null }]);
});

test('a journey view pasted back as parts is refused', () => {
  const v = journeyFlow(MODEL, 'j:open-map', { tt: en });
  const plan = planImport({ parts: [], layers: [], links: [], source: 'worktree', dir: 'docs/architecture', lang: 'en' }, v.text);
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'view-not-importable');
});

test('a journey picked on the general view opens on the journey, near life size, never at the whole map\'s blot size', async () => {
  const { journeyFrame, openScale, INNER_READ_MIN, READ_MIN } = await import('../server/web/flowview.js');
  // A wide map (2000 × 1400) in a 1200 × 600 area: whole it would be 0.43; the journey covers 300 × 400 of it.
  const size = { w: 2000, h: 1400, roomW: 1200, roomH: 600, vx: -10, vy: -10 };
  const f = journeyFrame({ x: 1490, y: 590, w: 300, h: 400 }, size);
  assert.ok(f.scale >= 0.95 && f.scale <= 1.25, `scale ${f.scale}`);
  assert.equal(f.cx, (1490 + 150 + 10) * f.scale, 'the middle of the journey across');
  // 400 + padding at that scale is taller than 600? then it shows from its top; else its middle.
  const tall = (400 + 72) * f.scale > 600;
  assert.equal(f.cy, tall ? (590 - 36 + 10) * f.scale + 300 : (590 + 200 + 10) * f.scale);
  // A small journey on a small map is not blown up past 1.25.
  assert.equal(journeyFrame({ x: 0, y: 0, w: 100, h: 60 }, { w: 400, h: 300, roomW: 1200, roomH: 800 }).scale, 1.25);
  // Inside a part the drawing opens whole down to a smaller size than the general view.
  const inner = { w: 1200, h: 900, roomW: 1300, roomH: 600 };
  assert.ok(openScale(inner) >= 1 - 1e-9, 'general rule: too small whole, so as wide as the area');
  assert.equal(openScale(inner, { readMin: INNER_READ_MIN }), 600 / 900);
  assert.ok(INNER_READ_MIN < READ_MIN);
});

test('the journey frame tells how far across the journey reaches, so the page scrolls across only as far as it must', async () => {
  const { journeyFrame } = await import('../server/web/flowview.js');
  const f = journeyFrame({ x: 1490, y: 590, w: 300, h: 400 }, { w: 2000, h: 1400, roomW: 1200, roomH: 600, vx: -10, vy: -10 });
  assert.equal(f.x0, (1490 - 36 + 10) * f.scale);
  assert.equal(f.x1, (1490 + 300 + 36 + 10) * f.scale);
});
