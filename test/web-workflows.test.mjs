// The page side of the traceable workflows (mind-map-page mm31): one colour per workflow, a dot per helper at work on the
// box it touches (in any project), and the words of its state and phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archTree } from '../server/web/tree.js';
import { agentDots, agentTone, dotsAt, phaseNow, teamHues, useTeamHues, workflowHue, workflowTone } from '../server/web/workflows.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

const agent = (id, extra = {}) => ({ id, label: `agent ${id}`, phase: 'Build', state: 'running', model: 'sonnet', activeAt: ago(2), step: { kind: 'edit', target: 'src/x.js', ts: ago(2) }, place: null, files: [], fileCount: 0, commits: [], ...extra });
const flow = (id, agents, extra = {}) => ({ id, name: `flow ${id}`, status: 'running', started: agents.length, done: 0, failed: 0, total: agents.length, phases: [], agents, running: [], request: null, places: [], updatedAt: ago(1), ...extra });

function twoProjects() {
  const state = clone(DEMO);
  state.generatedAt = NOW;
  const [shop, notes] = state.projects;
  const at = (projectId, partId) => ({ projectId, name: projectId === shop.id ? 'acme-shop' : 'notes-app', partId, path: 'x' });
  shop.chats = [{ ...shop.chats[0], sessionId: 's1', title: 'Checkout', status: 'busy', archived: false, workflows: [
    flow('wf_a', [agent('a1', { place: at(shop.id, 'orders') }), agent('a2', { place: at(shop.id, 'payments') }), agent('a3', { place: at(notes.id, null) }), agent('a4', { state: 'done', place: at(shop.id, 'orders') })]),
  ] }];
  notes.chats = [{ ...notes.chats[0], sessionId: 'n1', title: 'Sync', status: 'busy', archived: false, workflows: [
    flow('wf_b', [agent('b1', { place: at(shop.id, 'orders') }), agent('b2', { place: at(shop.id, 'orders'), activeAt: ago(45) })]),
  ] }];
  shop.visitors = [{ ...notes.chats[0], workflows: notes.chats[0].workflows }];
  return state;
}

test('workflowHue gives each workflow its own colour, the same every time', () => {
  assert.equal(workflowHue('wf_a'), workflowHue('wf_a'));
  assert.ok(workflowHue('wf_a') >= 0 && workflowHue('wf_a') < 360);
  for (const id of ['wf_a', 'wf_b', 'wf_1a2b3c4d-5e6', 'wf_9f8e7d6c-5b4', 'wf_e3a0b1c2-d3e', 'wf_c3d4e5f6-a7b']) {
    const hue = workflowHue(id);
    assert.ok(hue < 20 || hue > 100, `${id}: ${hue} would read as waiting (amber) or blocked (red)`);
  }
});

test('teams seen together never share a colour: the newest keeps its own, the others move to a free one', () => {
  const same = ['wf_1a2b3c4d-5e6', 'wf_9f8e7d6c-5b4'];
  assert.equal(workflowHue(same[0]), workflowHue(same[1]), 'these two land on the same colour by themselves');
  const hues = teamHues(same);
  assert.equal(hues.get(same[0]), workflowHue(same[0]));
  assert.notEqual(hues.get(same[1]), hues.get(same[0]));
  const state = { projects: [{ chats: [{ workflows: [{ id: same[1], updatedAt: ago(5) }, { id: same[0], updatedAt: ago(1) }] }] }] };
  try {
    useTeamHues(state);
    assert.notEqual(workflowHue(same[0]), workflowHue(same[1]), 'the page draws them apart everywhere');
  } finally {
    useTeamHues({ projects: [] });
  }
});

test('agentDots puts a dot for every helper at work on the box of this project it touches, from workflows of any project', () => {
  const state = twoProjects();
  const [shop, notes] = state.projects;
  const dots = agentDots(state, shop, archTree(shop), Date.parse(NOW));
  const at = (id) => (dots.get(id) ?? []).map((d) => d.agentId).sort();
  assert.deepEqual(at('pt:orders'), ['a1', 'b1'], 'a finished helper and one silent for 45 minutes leave no dot; another project\'s workflow does');
  assert.deepEqual(at('pt:payments'), ['a2']);
  const b1 = dots.get('pt:orders').find((d) => d.agentId === 'b1');
  assert.deepEqual([b1.workflowId, b1.workflowName, b1.hue, b1.chatTitle, b1.projectId], ['wf_b', 'flow wf_b', workflowHue('wf_b'), 'Sync', notes.id]);
  assert.equal(b1.step.kind, 'edit');
  const inNotes = agentDots(state, notes, archTree(notes), Date.parse(NOW));
  assert.deepEqual([...inNotes.keys()], [archTree(notes).id], 'a file with no box on that map puts the dot on the project');
});

test('dotsAt moves the dots of a box hidden under a closed one onto the deepest box the map shows', () => {
  const state = twoProjects();
  const shop = state.projects[0];
  const tree = archTree(shop);
  const dots = agentDots(state, shop, tree, Date.parse(NOW));
  const all = dotsAt(() => true, dots, tree);
  assert.deepEqual([...all.keys()].sort(), ['pt:orders', 'pt:payments']);
  const closed = dotsAt((id) => id === tree.id, dots, tree);
  const layer = [...closed.keys()];
  assert.equal(layer.length, 1, 'both parts sit in the same layer, closed');
  assert.match(layer[0], /^l:/);
  assert.equal(closed.get(layer[0]).length, 3);
});

test('workflowTone and agentTone: working, stopped without finishing, finished or failed', () => {
  const nowMs = Date.parse(NOW);
  assert.equal(agentTone(agent('x'), nowMs), 'running');
  assert.equal(agentTone(agent('x', { activeAt: ago(45) }), nowMs), 'stopped');
  assert.equal(agentTone(agent('x', { state: 'done' }), nowMs), 'done');
  assert.equal(agentTone(agent('x', { state: 'failed' }), nowMs), 'failed');
  assert.equal(workflowTone(flow('w', [agent('x')]), nowMs), 'running');
  assert.equal(workflowTone(flow('w', [agent('x', { activeAt: ago(45) })]), nowMs), 'stopped');
  assert.equal(workflowTone(flow('w', [agent('x', { state: 'done' })], { status: 'completed' }), nowMs), 'done');
  assert.equal(workflowTone(flow('w', [agent('x', { state: 'failed' })], { status: 'failed' }), nowMs), 'failed');
});

test('phaseNow names the phase at work, its place among all, or the last one when it ended', () => {
  const phases = [{ title: 'Look', total: 1, done: 1, failed: 0, running: 0 }, { title: 'Build', total: 2, done: 0, failed: 0, running: 2 }, { title: 'Review', total: 0, done: 0, failed: 0, running: 0 }];
  assert.deepEqual(phaseNow({ phases }), { index: 2, count: 3, title: 'Build' });
  assert.deepEqual(phaseNow({ phases: phases.map((p) => ({ ...p, running: 0 })) }), { index: 2, count: 3, title: 'Build' }, 'none at work: the last phase that had helpers');
  assert.equal(phaseNow({ phases: [] }), null);
});

// Just enough of h for workflowView: elements with attributes, children and their text.
const fakeH = (tag, attrs = {}, ...children) => ({
  tag, attrs: attrs ?? {}, children: children.flat(Infinity).filter((c) => c != null && c !== false),
  get text() { return this.children.map((c) => (typeof c === 'string' ? c : c.text)).join(' '); },
});
const find = (el, cls) => (typeof el === 'string' ? [] : [...(new RegExp(`(^| )${cls}( |$)`).test(el.attrs.class ?? '') ? [el] : []), ...el.children.flatMap((c) => find(c, cls))]);
const tFake = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n, vars) => `${key}:${n}${vars ? `:${Object.values(vars).join('|')}` : ''}` });
const viewCtx = {
  h: fakeH, t: tFake, icon: (name) => fakeH('svg', { 'data-icon': name }), relative: () => '5 min', modelName: (m) => m, stepWords: (s) => `step ${s.target}`,
  placeWords: (p) => `${p.projectId}${p.partId ? ` › ${p.partId}` : ''}`, list: (xs) => xs.join(', '), nowMs: Date.parse(NOW),
};

test('workflowView draws the tree: the request, the team with its phase, each helper with its state in a word and where it works', async () => {
  const { workflowView } = await import('../server/web/workflows.js');
  const w = flow('wf_a', [
    agent('a1', { place: { projectId: 'shop', name: 'shop', partId: 'orders', path: 'src/cart.ts' } }),
    agent('a2', { state: 'done', files: [{ projectId: 'shop', name: 'shop', partId: 'orders', path: 'src/cart.ts' }], fileCount: 1, commits: [{ hash: 'abc1234', subject: 'feat: cart', projectId: 'shop', tag: 'v1.1.0' }] }),
  ], { done: 1, request: { text: 'Build the cart, or03', ts: ago(30), item: { projectId: 'shop', partId: 'orders', code: 'or03' } }, phases: [{ title: 'Build', total: 2, done: 1, failed: 0, running: 1 }], places: [{ projectId: 'shop', name: 'shop', files: 1, partIds: ['orders'] }] });
  const el = workflowView(viewCtx, w);
  assert.match(find(el, 'wf-ask-text')[0].text, /Build the cart, or03/);
  assert.match(find(el, 'wf-item')[0].text, /wf\.item:shop › orders\|or03/, 'the map item the request names');
  assert.match(find(el, 'wf-phase-now')[0].text, /wf\.phaseNow:1\|1\|Build/);
  const states = find(el, 'wf-state').map((s) => s.text.trim());
  assert.deepEqual(states, ['wf.agent.running', 'wf.agent.done'], 'every helper says its state in a word');
  assert.match(find(el, 'wf-agent-place')[0].text, /shop › orders › src\/cart\.ts/);
  assert.match(find(el, 'wf-agent-step')[0].text, /step src\/x\.js/);
  assert.match(find(el, 'wf-release')[0].text, /wf\.releasedIn:v1\.1\.0/, 'request → commit → version');
  assert.equal(find(el, 'wf-file-path')[0].text, 'src/cart.ts');
  assert.equal(el.attrs.style, `--wf-h:${workflowHue('wf_a')}`);
  const compact = workflowView(viewCtx, w, { compact: true });
  assert.equal(find(compact, 'wf-commit').length, 0, 'Live keeps only the helpers at work');
  assert.match(find(compact, 'wf-rest')[0].text, /wf\.finished:1/);
  let opened = 0;
  const withDetails = workflowView(viewCtx, w, { compact: true, onDetails: () => { opened += 1; } });
  const more = find(withDetails, 'wf-details')[0];
  assert.match(more.text, /wf\.details/, 'Live leads to the whole trace: request, files, saved changes and versions');
  more.attrs.onclick();
  assert.equal(opened, 1);
});

// .plain lists are grids with an "auto" track: a long file path grew the track past the panel and the place beside it
// was cut at the panel's edge (seen on the real state, 2026-10-10). The team's file and commit lists clamp it.
test('the team tree file and commit lists clamp their column, so a long path ellipsizes inside the panel', () => {
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  for (const sel of ['.wf-files ul', '.wf-commits']) {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === sel));
    assert.ok(rules.some(([, , body]) => /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(body)), `${sel} has grid-template-columns: minmax(0, 1fr)`);
  }
});
