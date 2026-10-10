import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch } from '../server/arch/parse.mjs';
import { planImport } from '../server/arch/flow.mjs';
import { assembleModel } from '../server/arch/flowmodel.mjs';
import { parseFlow } from '../server/web/flow.js';
import { VIEW_MARKER, edgeLabel, exportTextFor, factRows, isViewText, layerOrder, level1Flow, nodeName, originWord } from '../server/web/flowlevel.js';
import { translator } from '../server/web/i18n.js';

const DIR = 'docs/architecture';
const README = '# Shop\n\n```mermaid\nflowchart LR\n  subgraph core["Core"]\n    AP[(API)]\n    WB[Web]\n  end\n  WB -->|orders| AP\n  WB ==> AP\n```\n';
const part = (name, path) => `# ${name}\n\nThe ${name}.\n\n## Where in the code\n\n- \`${path}\`\n`;
const ARCH = { ...parseArch(DIR, { 'README.md': README, 'api.md': part('API', 'src/api/'), 'web.md': part('Web', 'src/web/'), 'worker.md': part('Worker', 'src/worker/') }), links: [{ a: 'web', b: 'worker', weight: 1, reasons: [{ kind: 'shared-branch', text: 'feat/x' }] }] };
const sig = (type, value, line, extra = {}) => ({ type, value, line, via: type, ...extra });
const OWN = new Map(Object.entries({ 'src/api/a.mjs': ['api'], 'src/web/server.mjs': ['web'], 'src/worker/w.mjs': ['worker'] }));
const MODEL = assembleModel({
  arch: ARCH, readmeText: README, owners: OWN, source: 'worktree', projectId: 'shop-1',
  scans: {
    'src/api/a.mjs': { signals: [sig('command', 'git', 2), sig('host', 'api.github.com', 3, { via: 'url' })], imports: [] },
    'src/web/server.mjs': { signals: [sig('html', 'page', 1), sig('listen', 'listen', 2)], imports: [] },
    'src/worker/w.mjs': { signals: [], imports: [{ spec: '../api/a.mjs', line: 1, names: ['run'] }] },
  },
  resolve: (from, spec) => (spec === '../api/a.mjs' ? 'src/api/a.mjs' : null),
});
const en = translator('en');
const pt = translator('pt-BR');

test('the general view prints a drawing the Flow can read back, with a shape for each kind of box', () => {
  const { flow, text } = level1Flow(MODEL, { tt: en });
  assert.ok(text.startsWith(`${VIEW_MARKER}\n`));
  const back = parseFlow(text);
  assert.equal(back.ok, true);
  const shape = (label) => back.nodes.find((n) => n.label === label)?.shape;
  assert.equal(shape('You, in the browser'), 'stadium');
  assert.equal(shape('GitHub'), 'hex');
  assert.equal(shape('Version history'), 'db');
  assert.equal(shape('Web'), 'box');
  assert.equal(shape('API'), 'db', 'a part keeps the shape the README gave it');
  assert.deepEqual(back.layers.map((l) => l.id), flow.layers.map((l) => l.id));
  assert.ok(back.layers.every((l) => /^[A-Za-z0-9_]+$/.test(l.id)), 'subgraph ids mermaid accepts');
});

test('no arrow ever prints a placeholder: words from the README, the catalog or the parts, or no words at all', () => {
  const { text, meta } = level1Flow(MODEL, { tt: en, showHidden: true });
  const arrows = text.split('\n').filter((l) => /-->|==>|-\.->|-\.-|---/.test(l));
  assert.ok(arrows.length > 0);
  for (const line of arrows) assert.match(line, /\|[^|]+\|/, line);
  assert.doesNotMatch(text, /not described yet/);
  assert.equal(meta.missing, 0);
  const blank = { ...MODEL, edges: MODEL.edges.map((e) => (e.id === 'part:web>part:api#flow~2' ? { ...e, label: { from: 'none', text: null, key: null, missing: true } } : e)) };
  const drawn = level1Flow(blank, { tt: pt });
  assert.match(drawn.text, /^ {2}WB ==> AP$/m, 'an arrow nobody described is drawn without words');
  assert.doesNotMatch(drawn.text, /ainda sem descrição/);
  assert.equal(drawn.meta.missing, 1);
  assert.equal(edgeLabel({ label: { from: 'none', missing: true } }, pt), '');
  assert.equal(edgeLabel({ label: { from: 'ai', text: 'pedidos pagos', key: null, missing: false } }, pt), 'pedidos pagos', 'words the AI gave later are drawn as written');
});

test('README arrows keep their own kind; arrows found in the code are dashed; hidden ones show only on request', () => {
  const plainView = level1Flow(MODEL, { tt: en }).text;
  assert.match(plainView, / WB -->\|orders\| AP/);
  assert.match(plainView, / WB ==>\|requests from the screen\| AP/);
  assert.match(plainView, /-\.->\|lines of work, saved changes and what changed\|/);
  assert.doesNotMatch(plainView, /code it shares|related/);
  const all = level1Flow(MODEL, { tt: en, showHidden: true }).text;
  assert.match(all, /-\.->\|code it shares\|/);
  assert.match(all, /-\.-\|related \(same chats or lines of work\)\|/);
});

// A hand-made model in the shape assembleModel gives: the README's layers in data order (what it reads first), the
// layers session-map adds, and three parts reaching git with the same words.
const fact = (x) => ({ origin: 'detected', badges: ['detected'], declared: [], detected: [], declaredCount: 0, detectedCount: 1, ...x });
const STORY = {
  layers: ['actors', 'sources', 'engine', 'surface', 'outside', 'thispc'].map((id) => ({ id: `l:${id}`, drawId: id, name: id })),
  nodes: [
    fact({ id: 'actor:browser', kind: 'actor', layer: 'l:actors', nameKey: 'flow.l1.actor.browser', name: 'You, in the browser' }),
    fact({ id: 'part:rd', kind: 'part', layer: 'l:sources', name: 'Readers', drawId: 'RD', partId: 'rd' }),
    fact({ id: 'part:sb', kind: 'part', layer: 'l:engine', name: 'State builder', drawId: 'SB', partId: 'sb' }),
    fact({ id: 'part:sv', kind: 'part', layer: 'l:surface', name: 'Server', drawId: 'SV', partId: 'sv' }),
    fact({ id: 'part:mm', kind: 'part', layer: 'l:surface', name: 'Mind map page', drawId: 'MM', partId: 'mm' }),
    fact({ id: 'svc:git', kind: 'service', where: 'this-pc', layer: 'l:thispc', nameKey: 'flow.l1.svc.git', name: 'Version history' }),
    fact({ id: 'svc:claude-files', kind: 'service', where: 'this-pc', layer: 'l:thispc', nameKey: 'flow.l1.svc.claudeFiles', name: 'Claude files' }),
    fact({ id: 'svc:claude', kind: 'service', where: 'internet', layer: 'l:outside', nameKey: 'flow.l1.svc.claude', name: 'Claude (AI)' }),
  ],
  edges: [
    fact({ id: 'actor:browser>part:sv#actor', from: 'actor:browser', to: 'part:sv', kind: 'actor', label: { from: 'catalog', key: 'flow.l1.lbl.browser' } }),
    fact({ id: 'part:rd>part:sb#flow', from: 'part:rd', to: 'part:sb', kind: 'flow', drawKind: 'arrow', label: { from: 'role', key: 'flow.l1.lbl.role.reader' }, declaredCount: 1 }),
    fact({ id: 'part:sb>part:sv#flow', from: 'part:sb', to: 'part:sv', kind: 'flow', drawKind: 'arrow', label: { from: 'role', key: 'flow.l1.lbl.role.state' }, declaredCount: 1 }),
    fact({ id: 'part:sv>part:mm#flow', from: 'part:sv', to: 'part:mm', kind: 'flow', drawKind: 'arrow', label: { from: 'role', key: 'flow.l1.lbl.role.toPage' }, declaredCount: 1 }),
    fact({ id: 'part:rd>svc:git#service', from: 'part:rd', to: 'svc:git', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.git' }, detectedCount: 1 }),
    fact({ id: 'part:sb>svc:git#service', from: 'part:sb', to: 'svc:git', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.git' }, detectedCount: 3 }),
    fact({ id: 'part:sv>svc:git#service', from: 'part:sv', to: 'svc:git', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.git' }, detectedCount: 2 }),
    fact({ id: 'part:sv>svc:claude#service', from: 'part:sv', to: 'svc:claude', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.ai' }, detectedCount: 1 }),
    fact({ id: 'part:sb>svc:claude#service', from: 'part:sb', to: 'svc:claude', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.ai' }, detectedCount: 1 }),
    fact({ id: 'part:mm>svc:git#service', from: 'part:mm', to: 'svc:git', kind: 'service', label: { from: 'readme', text: 'shows the history', key: null }, detectedCount: 1 }),
    fact({ id: 'svc:claude-files>part:rd#service', from: 'svc:claude-files', to: 'part:rd', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.claudeFiles' } }),
    fact({ id: 'part:rd>part:sv#uses', from: 'part:rd', to: 'part:sv', kind: 'uses', hidden: true, label: { from: 'catalog', key: 'flow.l1.lbl.uses' } }),
  ],
  journeys: [],
};
const arrowLines = (text) => text.split('\n').filter((l) => /-->|==>|-\.->|-\.-|---/.test(l)).map((l) => l.trim());

test('layerOrder tells the story left to right: who uses it, what they touch, then deeper, then this computer and the internet', () => {
  assert.deepEqual(layerOrder(STORY), ['l:actors', 'l:surface', 'l:engine', 'l:sources', 'l:thispc', 'l:outside']);
  const { flow } = level1Flow(STORY, { tt: en });
  assert.deepEqual(flow.layers.map((l) => l.id), ['actors', 'surface', 'engine', 'sources', 'thispc', 'outside']);
  const reversed = { ...STORY, layers: [...STORY.layers].reverse() };
  assert.deepEqual(layerOrder(reversed), layerOrder(STORY), 'the order does not depend on how the README wrote its layers');
  assert.deepEqual(layerOrder({ ...STORY, edges: STORY.edges.filter((e) => e.kind !== 'actor') }).slice(-2), ['l:thispc', 'l:outside']);
});

test('arrows to one service with the same words are one arrow, from the part with the most evidence; the others are listed', () => {
  const { text, meta } = level1Flow(STORY, { tt: en });
  const git = arrowLines(text).filter((l) => l.endsWith(' version_history'));
  assert.deepEqual(git, ['SB -.->|lines of work, saved changes and what changed| version_history', 'MM -.->|shows the history| version_history']);
  const m = meta.edges.find((e) => e.edgeId === 'part:sb>svc:git#service');
  assert.deepEqual(m.also, ['part:sv', 'part:rd'], 'most evidence first');
  assert.equal(arrowLines(text).filter((l) => l.endsWith(' claude_ai')).length, 1);
  const rows = factRows(STORY, meta, en).filter((r) => r.type === 'arrow' && r.text.startsWith('State builder → Version history'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].also, ['Server', 'Readers']);
});

test('the drawing keeps each arrow where the facts say; only the layout copy turns backward arrows round, and says which', () => {
  const { text, drawText, meta } = level1Flow(STORY, { tt: en, showHidden: true });
  const plainLines = arrowLines(text);
  assert.ok(plainLines.includes('RD -->|what it read| SB'), 'the copied text keeps the true direction');
  const drawn = arrowLines(drawText);
  assert.ok(drawn.includes('SB -->|what it read| RD'), 'drawn from the left side so the layout reads left to right');
  assert.ok(drawn.includes('SV -->|what the screen shows| MM'), 'inside one layer nothing turns');
  assert.ok(drawn.includes('RD -.->|chats, settings and history| claude_code_s_files_claude'));
  assert.ok(drawn.includes('SV -.->|code it shares| RD'), 'a hidden arrow shown obeys the same order');
  const flipped = meta.edges.filter((e) => e.reversed).map((e) => e.edgeId).sort();
  assert.deepEqual(flipped, ['part:rd>part:sb#flow', 'part:rd>part:sv#uses', 'part:sb>part:sv#flow', 'svc:claude-files>part:rd#service']);
  assert.equal(text.split('\n')[0], VIEW_MARKER);
  assert.equal(drawText.split('\n')[0], VIEW_MARKER);
});

test('meta ties each drawn box to its node: parts by their README id, actors and services with no part', () => {
  const { meta } = level1Flow(MODEL, { tt: en });
  assert.deepEqual([meta.nodes.get('AP').partId, meta.nodes.get('AP').nodeId], ['api', 'part:api']);
  const browser = [...meta.nodes.values()].find((x) => x.nodeId === 'actor:browser');
  assert.equal(browser.partId, null);
  assert.equal(browser.kind, 'actor');
  const git = [...meta.nodes.values()].find((x) => x.nodeId === 'svc:git');
  assert.equal(git.where, 'this-pc');
  assert.equal(git.origin, 'detected');
  assert.ok(meta.edges.every((e, i) => e.index === i));
});

test('a journey keeps only its boxes and arrows; an unknown journey draws everything', () => {
  const model = { ...MODEL, journeys: [{ id: 'j1', kind: 'journey', name: 'Order', nodes: ['actor:browser', 'part:web'], edges: ['actor:browser>part:web#actor'] }] };
  const only = level1Flow(model, { tt: en, journey: 'j1' });
  assert.deepEqual([...only.meta.nodes.values()].map((x) => x.nodeId).sort(), ['actor:browser', 'part:web']);
  assert.equal(only.flow.edges.length, 1);
  const all = level1Flow(model, { tt: en, journey: 'nope' });
  assert.equal(all.flow.nodes.length, level1Flow(model, { tt: en }).flow.nodes.length);
});

test('too many outside boxes: the busiest stay, the rest are listed apart', () => {
  const scans = {};
  const owners = new Map();
  for (let i = 0; i < 15; i++) {
    scans[`src/api/h${i}.mjs`] = { signals: Array.from({ length: i + 1 }, (_, k) => sig('host', `api${i}.example.com`, k + 1, { via: 'url' })), imports: [] };
    owners.set(`src/api/h${i}.mjs`, ['api']);
  }
  const model = assembleModel({ arch: ARCH, readmeText: README, owners, scans });
  const { meta, flow } = level1Flow(model, { tt: en, maxOutside: 12 });
  assert.equal(flow.nodes.filter((n) => n.shape === 'hex').length, 12);
  assert.deepEqual(meta.more.map((x) => x.nodeId), ['svc:host:api0.example.com', 'svc:host:api1.example.com', 'svc:host:api2.example.com']);
});

test('names and badges are in the page language, with the README words kept as written', () => {
  const browser = MODEL.nodes.find((n) => n.id === 'actor:browser');
  assert.equal(nodeName(browser, pt), 'Você, no navegador');
  assert.equal(nodeName(MODEL.nodes.find((n) => n.id === 'part:web'), pt), 'Web');
  assert.equal(originWord('detected', pt), 'visto no código');
  assert.equal(edgeLabel(MODEL.edges.find((e) => e.id === 'part:web>part:api#flow'), pt), 'orders');
});

test('exports: the parts level gives the README drawing, the general view its own text; a general view is never imported as parts', () => {
  const l1 = level1Flow(MODEL, { tt: en }).text;
  assert.equal(exportTextFor('parts', 'flowchart LR\n  A --> B', l1), 'flowchart LR\n  A --> B');
  assert.equal(exportTextFor('1', 'flowchart LR\n  A --> B', l1), l1);
  assert.equal(isViewText(l1), true);
  assert.equal(isViewText('flowchart LR\n  A --> B'), false);
  assert.deepEqual(planImport(ARCH, l1), { ok: false, error: 'view-not-importable' });
  assert.deepEqual(planImport(ARCH, `\`\`\`mermaid\n${l1}\n\`\`\``), { ok: false, error: 'view-not-importable' });
});

test('the layout copy ties each layer to the next with invisible links, so the layers stand as columns in story order', () => {
  const { text, drawText } = level1Flow(STORY, { tt: en });
  const ties = drawText.split('\n').filter((l) => l.includes('~~~')).map((l) => l.trim());
  assert.deepEqual(ties, [
    'you_in_the_browser ~~~ SV',
    'MM ~~~ SB',
    'SB ~~~ RD',
    'RD ~~~ claude_code_s_files_claude',
    'RD ~~~ version_history',
    'RD ~~~ claude_ai',
  ], 'from the last boxes of a layer to the first of the next; both service layers stand right of the deepest layer');
  assert.doesNotMatch(text, /~~~/, 'the copied text has no layout help in it');
});

test('a layer whose arrows go round in a circle is tied by all its boxes, so it still stands as a column', () => {
  const loop = { ...STORY, edges: [...STORY.edges, fact({ id: 'part:mm>part:sv#uses', from: 'part:mm', to: 'part:sv', kind: 'uses', hidden: true, label: { from: 'catalog', key: 'flow.l1.lbl.uses' } })] };
  const ties = level1Flow(loop, { tt: en, showHidden: true }).drawText.split('\n').filter((l) => l.includes('~~~')).map((l) => l.trim());
  assert.ok(ties.includes('you_in_the_browser ~~~ SV') && ties.includes('you_in_the_browser ~~~ MM'), ties.join(' | '));
  assert.ok(ties.includes('SV ~~~ SB') && ties.includes('MM ~~~ SB'), ties.join(' | '));
});
