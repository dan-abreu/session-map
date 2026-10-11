// The journeys of the Flow (flow.md fl10): numbered end-to-end paths over the general view's labeled arrows, found in
// the model with no AI (origin "detected"), named from a small catalog, the same whatever order the model lists things.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArch } from '../server/arch/detect.mjs';
import { detectJourneys } from '../server/arch/flowjourneys.mjs';
import { JOURNEYS } from '../server/arch/flowcatalog.mjs';
import { assembleModel, buildFlowModel } from '../server/arch/flowmodel.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

const lbl = (key) => ({ from: 'catalog', text: null, key: `flow.l1.lbl.${key}`, missing: false });
const N = {
  actor: (id, name) => ({ id: `actor:${id}`, kind: 'actor', name, partId: null, where: null }),
  part: (id, name) => ({ id: `part:${id}`, kind: 'part', name, partId: id, where: null }),
  svc: (id, name, where = 'internet') => ({ id: `svc:${id}`, kind: 'service', name, partId: null, where }),
};
const E = (from, to, kind, label, { weight = 1, hidden = false } = {}) => ({ id: `${from}>${to}#${kind}`, from, to, kind, label: lbl(label), weight, hidden });

// The general view of session-map itself as the model holds it (only what the journeys need).
const SM_NODES = [
  N.actor('browser', 'You, in the browser'), N.actor('claude-code', 'Claude Code (its automatic steps and plugin)'),
  N.actor('lan', 'Your phone, when sharing on the network is on'), N.actor('terminal', 'You, in the terminal'),
  N.part('architecture-map', 'Architecture map'), N.part('bootstrap-and-inspection', 'Bootstrap and inspection'), N.part('flow', 'Flow'),
  N.part('foundation', 'Foundation'), N.part('mind-map-page', 'Mind map page'), N.part('orchestration', 'Orchestration'),
  N.part('page-chat', 'Page chat'), N.part('plugin-and-terminal', 'Plugin and terminal'), N.part('readers', 'Readers'),
  N.part('server', 'Server'), N.part('state-builder', 'State builder'), N.part('watcher-and-alerts', 'Watcher and alerts'),
  N.svc('claude', 'Claude (AI)'), N.svc('claude-files', 'Claude Code\'s files (~/.claude)', 'this-pc'), N.svc('git', 'Version history', 'this-pc'),
  N.svc('github', 'GitHub'), N.svc('ntfy', 'ntfy (phone alerts)'), N.svc('terminal', 'Terminal windows', 'this-pc'),
  N.svc('toast', 'Desktop notifications', 'this-pc'), N.svc('vscode', 'VS Code', 'this-pc'),
];
const P = (id) => `part:${id}`;
const SM_EDGES = [
  E('actor:browser', P('server'), 'actor', 'browser'),
  E('actor:claude-code', P('plugin-and-terminal'), 'actor', 'claudeCode'),
  E('actor:lan', P('server'), 'actor', 'lan'),
  E('actor:terminal', P('plugin-and-terminal'), 'actor', 'cli'),
  E(P('architecture-map'), P('flow'), 'flow', 'role.archmap', { weight: 6 }),
  E(P('architecture-map'), P('state-builder'), 'flow', 'role.archmap', { weight: 6 }),
  E(P('bootstrap-and-inspection'), P('flow'), 'flow', 'role.bootstrap', { weight: 8 }),
  E(P('bootstrap-and-inspection'), P('page-chat'), 'flow', 'role.bootstrap'),
  E(P('bootstrap-and-inspection'), 'svc:claude', 'service', 'ai', { weight: 2 }),
  E(P('flow'), P('server'), 'flow', 'role.diagram', { weight: 7 }),
  E(P('flow'), 'svc:git', 'service', 'git'),
  E(P('foundation'), P('flow'), 'flow', 'role.foundation', { weight: 9 }),
  E(P('orchestration'), P('page-chat'), 'flow', 'role.orchestration'),
  E(P('orchestration'), 'svc:claude', 'service', 'ai', { weight: 2 }),
  E(P('page-chat'), P('server'), 'flow', 'role.chat', { weight: 7 }),
  E(P('page-chat'), 'svc:claude', 'service', 'ai', { weight: 2 }),
  E(P('plugin-and-terminal'), P('server'), 'flow', 'role.plugin'),
  E(P('readers'), P('state-builder'), 'flow', 'role.reader', { weight: 9 }),
  E(P('readers'), P('watcher-and-alerts'), 'flow', 'role.reader', { weight: 9 }),
  E(P('readers'), 'svc:github', 'service', 'github', { weight: 2 }),
  E(P('server'), P('mind-map-page'), 'flow', 'role.toPage'),
  E(P('server'), 'svc:claude', 'service', 'ai', { weight: 2 }),
  E(P('server'), 'svc:terminal', 'service', 'terminal', { weight: 6 }),
  E(P('server'), 'svc:vscode', 'service', 'vscode', { weight: 2 }),
  E(P('state-builder'), P('flow'), 'flow', 'role.state', { weight: 3 }),
  E(P('state-builder'), P('orchestration'), 'flow', 'role.state', { weight: 9 }),
  E(P('state-builder'), P('server'), 'flow', 'role.state', { weight: 9 }),
  E(P('state-builder'), P('watcher-and-alerts'), 'flow', 'role.state', { weight: 2 }),
  E(P('watcher-and-alerts'), P('server'), 'flow', 'role.alerts', { weight: 9 }),
  E(P('watcher-and-alerts'), 'svc:ntfy', 'service', 'ntfy'),
  E(P('watcher-and-alerts'), 'svc:toast', 'service', 'toast', { weight: 3 }),
  E('svc:claude-files', P('readers'), 'service', 'claudeFiles', { weight: 2 }),
  E('svc:claude-files', P('state-builder'), 'service', 'claudeFiles', { weight: 2 }),
  // Seen only in the code: never part of a journey.
  E(P('server'), P('page-chat'), 'uses', 'uses', { hidden: true, weight: 9 }),
  E(P('mind-map-page'), P('page-chat'), 'uses', 'uses', { hidden: true }),
];
const SM = { nodes: SM_NODES, edges: SM_EDGES };
const edgeIds = new Set(SM_EDGES.filter((e) => !e.hidden).map((e) => e.id));
const byId = (list, id) => list.find((j) => j.id === id);
const walk = (j) => [j.steps[0].from, ...j.steps.map((s) => s.to)];

test('session-map: six journeys in the catalog order, numbered, continuous, over visible arrows, found with no AI', () => {
  const js = detectJourneys(SM);
  assert.deepEqual(js.map((j) => j.id), ['j:open-map', 'j:chat-appears', 'j:chat-ai', 'j:alert-phone', 'j:command', 'j:alert-screen']);
  for (const j of js) {
    assert.equal(j.kind, 'journey');
    assert.equal(j.origin, 'detected');
    assert.deepEqual(j.badges, ['detected']);
    assert.equal(j.ai, null);
    assert.equal(j.ownerConfirmed, null);
    assert.ok(j.steps.length >= 2 && j.steps.length <= 6, j.id);
    j.steps.forEach((s, i) => {
      assert.equal(s.n, i + 1);
      assert.ok(edgeIds.has(s.edgeId), `${j.id} step ${s.n} is a visible arrow`);
      if (i) assert.equal(s.from, j.steps[i - 1].to, `${j.id} is continuous`);
      assert.equal(s.note, null);
    });
    assert.deepEqual(j.nodes, walk(j));
    assert.deepEqual(j.edges, j.steps.map((s) => s.edgeId));
    assert.equal(new Set(j.nodes).size, j.nodes.length, 'no box twice');
  }
  assert.deepEqual(walk(byId(js, 'j:open-map')), ['actor:browser', P('server'), P('mind-map-page')]);
  assert.deepEqual(walk(byId(js, 'j:chat-appears')), ['svc:claude-files', P('readers'), P('state-builder'), P('server'), P('mind-map-page')]);
  assert.deepEqual(walk(byId(js, 'j:command')), ['actor:terminal', P('plugin-and-terminal'), P('server')]);
  assert.deepEqual(walk(byId(js, 'j:alert-screen')), ['svc:claude-files', P('readers'), P('watcher-and-alerts'), 'svc:toast']);
});

test('a step can go once against an arrow: in the page chat the server hands the question on and the chat answers', () => {
  const j = byId(detectJourneys(SM), 'j:chat-ai');
  assert.deepEqual(walk(j), ['actor:browser', P('server'), P('page-chat'), 'svc:claude']);
  assert.deepEqual(j.steps.map((s) => s.back), [false, true, false]);
  assert.equal(j.steps[1].edgeId, 'part:page-chat>part:server#flow');
  assert.equal(j.steps[1].partId, 'page-chat', 'a step belongs to the part it reaches');
  assert.equal(j.steps[2].partId, 'page-chat', 'a step that reaches a service belongs to the part it leaves');
  for (const x of detectJourneys(SM)) assert.ok(x.steps.filter((s) => s.back).length <= 1, x.id);
});

test('a journey starts where the catalog says, not in the middle: the phone alert starts at Claude Code\'s files', () => {
  const j = byId(detectJourneys(SM), 'j:alert-phone');
  // Readers and State builder both reach the alerts in two steps; the tie goes to the ids in order.
  assert.deepEqual(walk(j), ['svc:claude-files', P('readers'), P('watcher-and-alerts'), 'svc:ntfy']);
});

test('names: an i18n key with the boxes of the path, and an English name for whoever reads the model raw', () => {
  const js = detectJourneys(SM);
  const open = byId(js, 'j:open-map');
  assert.equal(open.nameKey, 'flow.j.name.open');
  assert.deepEqual(open.args, { start: 'actor:browser', end: P('mind-map-page') });
  assert.equal(open.name, 'You open Mind map page');
  const ai = byId(js, 'j:chat-ai');
  assert.deepEqual(ai.args, { start: 'actor:browser', end: 'svc:claude', via: P('page-chat') });
  assert.equal(ai.name, 'You ask in Page chat and the AI answers');
  assert.equal(byId(js, 'j:alert-phone').name, 'An alert reaches your phone');
  for (const t of JOURNEYS) assert.ok(t.nameKey.startsWith('flow.j.name.') && t.name, t.key);
});

test('the same model in any order gives the same journeys', () => {
  const a = detectJourneys(SM);
  const rev = { nodes: [...SM_NODES].reverse(), edges: [...SM_EDGES].reverse() };
  const mixed = { nodes: SM_NODES.filter((_, i) => i % 2).concat(SM_NODES.filter((_, i) => !(i % 2))), edges: SM_EDGES.filter((_, i) => i % 3).concat(SM_EDGES.filter((_, i) => !(i % 3))) };
  assert.deepEqual(detectJourneys(rev), a);
  assert.deepEqual(detectJourneys(mixed), a);
});

test('hidden arrows are never walked, a service or a person is never in the middle, and no journey is longer than six steps', () => {
  // Without the README's arrow from the page chat to the server, the hidden "uses" one would be the short way: the
  // journey takes the long way round over arrows on screen instead.
  const noChat = { nodes: SM_NODES, edges: SM_EDGES.filter((e) => e.id !== 'part:page-chat>part:server#flow') };
  const longWay = byId(detectJourneys(noChat), 'j:chat-ai');
  assert.ok(!longWay.edges.includes('part:server>part:page-chat#uses'));
  assert.deepEqual(walk(longWay), ['actor:browser', P('server'), P('state-builder'), P('orchestration'), P('page-chat'), 'svc:claude']);
  // With no visible way at all, no journey.
  const cut = { nodes: SM_NODES, edges: SM_EDGES.filter((e) => e.to !== P('page-chat') || e.hidden).filter((e) => e.id !== 'part:page-chat>part:server#flow') };
  assert.equal(byId(detectJourneys(cut), 'j:chat-ai'), undefined);
  for (const j of detectJourneys(SM)) {
    for (const id of j.nodes.slice(1, -1)) assert.ok(id.startsWith('part:'), `${j.id}: ${id} in the middle`);
  }
  // A long chain: the path to the page is seven steps, past the cap.
  const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const long = {
    nodes: [N.actor('browser', 'You'), ...chain.map((c) => N.part(c, c.toUpperCase())), N.part('web-page', 'Web page')],
    edges: [E('actor:browser', P('a'), 'actor', 'browser'), ...chain.slice(1).map((c, i) => E(P(chain[i]), P(c), 'flow', 'uses')), E(P('g'), P('web-page'), 'flow', 'role.toPage')],
  };
  assert.equal(byId(detectJourneys(long), 'j:open-map'), undefined);
  for (const j of detectJourneys(long)) assert.ok(j.steps.length <= 6, j.id);
});

test('at most six journeys; the seventh that matches (the phone opening the map) waits for a larger cap', () => {
  assert.equal(detectJourneys(SM).length, 6);
  const seven = detectJourneys(SM, { max: 7 });
  assert.equal(seven.length, 7);
  assert.deepEqual(walk(byId(seven, 'j:open-phone')), ['actor:lan', P('server'), P('mind-map-page')]);
});

test('few matches: plain "From … to …" journeys fill up to three, forward only, two steps at least; nobody, nothing', () => {
  // acme-delivery's shape: the customers' screens call two hosts on the internet.
  const delivery = {
    nodes: [N.actor('customer', 'Customers'), N.part('backend', 'Backend'), N.part('customer', 'Customer app'),
      { id: 'svc:host:feedback.acme.example', kind: 'service', name: 'feedback.acme.example', where: 'internet', partId: null },
      { id: 'svc:host:api.acme.example', kind: 'service', name: 'api.acme.example', where: 'internet', partId: null }],
    edges: [E('actor:customer', P('customer'), 'actor', 'screens'), E(P('customer'), 'svc:host:feedback.acme.example', 'service', 'http'), E(P('customer'), 'svc:host:api.acme.example', 'service', 'http')],
  };
  const js = detectJourneys(delivery);
  assert.equal(js.length, 1);
  assert.equal(js[0].id, 'j:from:actor:customer');
  assert.equal(js[0].nameKey, 'flow.j.name.path');
  assert.deepEqual(js[0].args, { start: 'actor:customer', end: 'svc:host:api.acme.example' });
  assert.equal(js[0].name, 'From Customers to api.acme.example');
  assert.deepEqual(walk(js[0]), ['actor:customer', P('customer'), 'svc:host:api.acme.example']);
  // One step is not a journey.
  const shop = { nodes: [N.actor('user', 'People using the app'), N.part('web', 'Web')], edges: [E('actor:user', P('web'), 'actor', 'screens')] };
  assert.deepEqual(detectJourneys(shop), []);
  // No people and no service that sends something in: nothing to start from.
  const lib = { nodes: [N.part('a', 'A'), N.part('b', 'B'), N.svc('github', 'GitHub')], edges: [E(P('a'), P('b'), 'flow', 'uses'), E(P('b'), 'svc:github', 'service', 'github')] };
  assert.deepEqual(detectJourneys(lib), []);
  // A filler never repeats a journey already found, and a service that sends things in can start one.
  const one = detectJourneys({ nodes: SM_NODES, edges: SM_EDGES.filter((e) => !['actor:browser', 'actor:terminal', 'actor:lan'].includes(e.from) && !e.to.startsWith('svc:ntfy') && !e.to.startsWith('svc:toast')) });
  assert.ok(one.length >= 1 && one.length <= 3);
  assert.equal(new Set(one.map((j) => j.edges.join())).size, one.length);
});

test('the model carries its journeys: assembleModel finds them on the arrows it drew', () => {
  const README = ['```mermaid', 'flowchart LR', '  U(["You, in the browser"])', '  W[Web page] ', '  A[API]', '  U --> A', '  A --> W', '```', ''].join('\n');
  const part = (name, path) => `# ${name}\n\n## Where in the code\n\n- \`${path}\`\n`;
  const arch = { ...parseArch('docs/architecture', { 'README.md': README, 'web.md': part('Web page', 'web/'), 'api.md': part('API', 'api/') }), links: [] };
  const m = assembleModel({ arch, readmeText: README, source: 'worktree' });
  assert.deepEqual(m.journeys.map((j) => j.id), ['j:open-map']);
  assert.deepEqual(m.journeys, detectJourneys(m));
  assert.deepEqual(m.journeys[0].edges, ['actor:browser>part:api#actor', 'part:api>part:web#flow']);
});

test('the invented repositories: the shop and the library have no journey, the delivery app one plain path', async () => {
  const got = {};
  for (const name of ['acme-shop', 'acme-delivery', 'acme-lib']) {
    const root = copyFixtureRepo(name);
    try {
      const arch = { ...(await readArch(root, {})), links: [] };
      got[name] = (await buildFlowModel({ root, arch, source: arch.source })).journeys;
    } finally {
      removeFixtureRepo(root);
    }
  }
  assert.deepEqual(got['acme-shop'], []);
  assert.deepEqual(got['acme-lib'], []);
  assert.deepEqual(got['acme-delivery'].map((j) => [j.id, j.nodes]), [['j:from:actor:customer', ['actor:customer', 'part:customer', 'svc:host:api.acme-delivery.example']]]);
});
