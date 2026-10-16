import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch } from '../server/arch/parse.mjs';
import { planImport } from '../server/arch/flow.mjs';
import { assembleModel } from '../server/arch/flowmodel.mjs';
import { parseFlow } from '../server/web/flow.js';
import { HUB_MIN, VIEW_MARKER, edgeLabel, exportTextFor, factRows, innerNotes, isViewText, layerName, layerOrder, level1Flow, level2Flow, neighbourhood, nodeName, originWord, ownName, pageLang, textLang } from '../server/web/flowlevel.js';
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

test('a journey picked in the filter dims the rest: every box stays, the journey knows its boxes and numbered arrows', () => {
  const steps = (pairs) => pairs.map(([from, to, edgeId], i) => ({ n: i + 1, from, to, edgeId, back: false, partId: null, note: null }));
  const journeys = [
    {
      id: 'j:a', kind: 'journey', name: 'A', nodes: ['svc:claude-files', 'part:rd', 'part:sb', 'part:sv', 'part:mm'],
      edges: ['svc:claude-files>part:rd#service', 'part:rd>part:sb#flow', 'part:sb>part:sv#flow', 'part:sv>part:mm#flow'],
      steps: steps([['svc:claude-files', 'part:rd', 'svc:claude-files>part:rd#service'], ['part:rd', 'part:sb', 'part:rd>part:sb#flow'], ['part:sb', 'part:sv', 'part:sb>part:sv#flow'], ['part:sv', 'part:mm', 'part:sv>part:mm#flow']]),
    },
    // Readers' arrow to git is one of three with the same words: on a journey it is drawn on its own.
    { id: 'j:git', kind: 'journey', name: 'Git', nodes: ['part:rd', 'svc:git'], edges: ['part:rd>svc:git#service'], steps: steps([['part:rd', 'svc:git', 'part:rd>svc:git#service']]) },
    { id: 'j:ai', kind: 'journey', name: 'AI', nodes: ['part:sb', 'svc:claude'], edges: ['part:sb>svc:claude#service'], steps: steps([['part:sb', 'svc:claude', 'part:sb>svc:claude#service']]) },
  ];
  const model = { ...STORY, journeys };
  const plain = level1Flow(model, { tt: en });
  const one = level1Flow(model, { tt: en, journey: 'j:a' });
  assert.equal(one.flow.nodes.length, plain.flow.nodes.length, 'no box leaves the drawing');
  assert.equal(plain.meta.journey, null);
  const drawOf = new Map([...one.meta.nodes].map(([draw, info]) => [info.nodeId, draw]));
  assert.deepEqual([...one.meta.journey.nodes].sort(), journeys[0].nodes.map((id) => drawOf.get(id)).sort());
  const onPath = one.meta.edges.filter((m) => one.meta.journey.edges.has(m.index)).map((m) => m.edgeId);
  assert.deepEqual(onPath.sort(), [...journeys[0].edges].sort());
  const label = (v, edgeId) => v.flow.edges[v.meta.edges.find((m) => m.edgeId === edgeId).index].label;
  assert.equal(label(one, 'svc:claude-files>part:rd#service'), '1 · chats, settings and history');
  assert.equal(label(one, 'part:sv>part:mm#flow'), '4 · what the screen shows');
  assert.equal(label(one, 'part:sb>svc:git#service'), label(plain, 'part:sb>svc:git#service'), 'arrows off the journey keep their words');
  const git = level1Flow(model, { tt: en, journey: 'j:git' });
  const rdGit = git.meta.edges.find((m) => m.edgeId === 'part:rd>svc:git#service');
  assert.ok(rdGit && git.meta.journey.edges.has(rdGit.index), 'never bundled under another part');
  assert.equal(label(git, 'part:rd>svc:git#service'), '1 · lines of work, saved changes and what changed');
  assert.ok(!git.meta.edges.find((m) => m.edgeId === 'part:sb>svc:git#service').also.includes('part:rd'));
  const ai = level1Flow(model, { tt: en, journey: 'j:ai', maxOutside: 0 });
  assert.ok([...ai.meta.nodes.values()].some((x) => x.nodeId === 'svc:claude'), 'its service is never cut into "more"');
  const unknown = level1Flow(model, { tt: en, journey: 'nope' });
  assert.equal(unknown.meta.journey, null);
  assert.equal(unknown.flow.edges.length, plain.flow.edges.length);
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

// ---- level 2, inside a part (fl09) ----
const box = (id, band, extra = {}) => ({ id, kind: 'component', name: id.replace(/^c:.*\//, ''), path: id.slice(2), folder: false, files: [id.slice(2)], fileCount: 1, other: 0, band, origin: 'detected', badges: ['detected'], declared: [], detected: [{ file: id.slice(2), line: 1, via: 'code' }], ...extra });
const VIEW = {
  partId: 'server', name: 'Server', file: 'docs/architecture/server.md', key: 'k1', how: { text: 'It serves.', file: 'docs/architecture/server.md', line: 7 },
  nodes: [
    box('c:server/main.mjs', 'entry', { head: 'Serves the page and the api.' }),
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => box(`c:server/${x}.mjs`, 'work')),
    box('c:server/log.mjs', 'base'),
    box('c:server/shared.mjs', 'shared'),
    { id: 'c:server/css/', kind: 'component', name: 'css/', path: 'server/css/', folder: true, files: ['server/css/a.css'], fileCount: 0, other: 13, band: 'base', origin: 'detected', badges: ['detected'], declared: [], detected: [] },
    { id: 'c:server/web/*', kind: 'group', name: null, path: 'server/web/*', dir: 'server/web', folder: false, files: [], fileCount: 38, other: 2, band: 'base', origin: 'detected', badges: ['detected'], declared: [], detected: [] },
    { id: 'actor:browser', kind: 'actor', nameKey: 'flow.l1.actor.browser', name: 'x', side: 'in', band: 'in', origin: 'detected', badges: ['detected'], declared: [], detected: [] },
    { id: 'part:flow', kind: 'part', name: 'Flow', partId: 'flow', side: 'in', band: 'in', origin: 'declared', badges: ['declared'], declared: [], detected: [] },
    { id: 'part:mind-map-page', kind: 'part', name: 'Mind map page', partId: 'mind-map-page', side: 'out', band: 'out', origin: 'declared', badges: ['declared'], declared: [], detected: [] },
    { id: 'svc:git', kind: 'service', where: 'this-pc', nameKey: 'flow.l1.svc.git', side: 'out', band: 'out', origin: 'detected', badges: ['detected'], declared: [], detected: [] },
    { id: 'svc:github', kind: 'service', where: 'internet', nameKey: 'flow.l1.svc.github', side: 'out', band: 'out', origin: 'detected', badges: ['detected'], declared: [], detected: [] },
  ],
  edges: [
    { id: 'c:server/log.mjs>c:server/main.mjs#import', from: 'c:server/log.mjs', to: 'c:server/main.mjs', kind: 'import', label: { from: 'code', key: 'flow.l1.lbl.uses' }, names: ['log'], origin: 'detected', badges: ['detected'], declared: [], detected: [{ file: 'server/main.mjs', line: 3, via: 'import' }] },
    { id: 'actor:browser>part:server#actor@c:server/main.mjs', from: 'actor:browser', to: 'c:server/main.mjs', kind: 'actor', label: { from: 'catalog', key: 'flow.l1.lbl.browser' }, origin: 'detected', badges: ['detected'], declared: [], detected: [] },
    { id: 'part:flow>part:server#flow@c:server/main.mjs', from: 'part:flow', to: 'c:server/main.mjs', kind: 'flow', label: { from: 'readme', text: 'the drawing' }, origin: 'declared', badges: ['declared'], declared: [{ file: 'docs/architecture/README.md', line: 9 }], detected: [] },
    { id: 'part:server>part:mind-map-page#flow@c:server/main.mjs', from: 'c:server/main.mjs', to: 'part:mind-map-page', kind: 'flow', label: { from: 'none', missing: true }, readme: true, origin: 'declared', badges: ['declared'], declared: [{ file: 'docs/architecture/README.md', line: 10 }], detected: [] },
    { id: 'part:server>svc:git#service@c:server/a.mjs', from: 'c:server/a.mjs', to: 'svc:git', kind: 'service', label: { from: 'catalog', key: 'flow.l1.lbl.git' }, origin: 'detected', badges: ['detected'], declared: [], detected: [] },
  ],
  notes: [{ key: 'notCode', paths: ['DESIGN.md'] }],
  counts: { boxes: 13, files: 12, other: 15, grouped: 38, cut: 0, arrowsCut: 0, neighbours: 5, neighboursCut: 0 },
};

test('inside a part: rows from what comes in, through where it starts and the work, to what it hands on; long rows wrap', () => {
  const v = level2Flow(VIEW, { tt: pt });
  const titles = v.scene.rows.map((r) => r.groups.map((g) => g.title));
  assert.deepEqual(titles.map((t) => t[0]), [pt('flow.l2.band.in'), pt('flow.l2.band.entry'), pt('flow.l2.band.shared'), pt('flow.l2.band.work'), '', pt('flow.l2.band.base'), pt('flow.l2.band.out')]);
  const out = v.scene.rows.at(-1).groups.map((g) => g.cls);
  assert.deepEqual(out, ['parts', 'thispc', 'outside'], 'the parts it feeds, this computer and the internet side by side');
  const byGroup = (gid) => v.scene.nodes.filter((n) => n.group === gid).length;
  for (const r of v.scene.rows) for (const g of r.groups) assert.ok(byGroup(g.id) <= 5, `${g.id} holds ${byGroup(g.id)}`);
  // The file's English comment does not go under its name on a Portuguese page: it moves to the hover title, and the
  // box says in Portuguese how it is tied to the other pieces.
  const main = v.scene.nodes.find((n) => n.label === 'main.mjs');
  assert.equal(main.sub, 'usada por 1 peça daqui');
  assert.equal([...v.meta.nodes.values()].find((m) => m.nodeId === 'c:server/main.mjs').quote, 'Serves the page and the api.');
  assert.equal(level2Flow(VIEW, { tt: en }).scene.nodes.find((n) => n.label === 'main.mjs').sub, 'Serves the page and the api.');
  // A band that wraps stays one band: its second row says which band it goes on.
  const work = v.scene.rows.filter((r) => r.groups[0].id.startsWith('work'));
  assert.deepEqual(work.map((r) => r.groups[0].cont ?? null), [null, 'work']);
  const group = v.scene.nodes.find((n) => n.shape === 'group');
  assert.equal(group.label, '+40 arquivos', 'every file it holds, code or not');
  assert.equal(group.sub, 'em server/web');
  assert.equal(v.scene.nodes.find((n) => n.shape === 'folder').sub, '13 arquivos');
  assert.equal(v.scene.edges.length, VIEW.edges.length);
});

test('inside a part: every arrow has words or is counted; the text is a view, never imported as parts', () => {
  const v = level2Flow(VIEW, { tt: en });
  assert.equal(v.meta.missing, 1);
  assert.equal(v.scene.edges.filter((e) => e.label).length, VIEW.edges.length - 1);
  assert.ok(v.text.startsWith('%% session-map:view part server\n'));
  assert.equal(isViewText(v.text), true);
  assert.deepEqual(planImport(ARCH, v.text), { ok: false, error: 'view-not-importable' });
  assert.equal(parseFlow(v.text).ok, true);
  assert.equal(exportTextFor('2', 'parts text', v.text), v.text);
  const rows = factRows(v.model, v.meta, en);
  assert.ok(rows.some((r) => r.type === 'box' && r.text === 'main.mjs' && r.label === en('flow.l1.kind.component')));
  assert.ok(rows.some((r) => r.type === 'arrow' && r.text === 'log.mjs → main.mjs'));
});

test('inside a part: the colours of the pieces come from what changed now; neighbour parts keep theirs', () => {
  const live = { 'c:server/main.mjs': { tone: 'live', files: 1, unsaved: 1 }, 'c:server/a.mjs': { tone: 'quiet', files: 0, unsaved: 2 } };
  const v = level2Flow(VIEW, { tt: en, live });
  const info = (nodeId) => [...v.meta.nodes.values()].find((m) => m.nodeId === nodeId);
  assert.equal(info('c:server/main.mjs').tone, 'live');
  assert.equal(info('c:server/a.mjs').tone, 'quiet');
  assert.equal(info('c:server/a.mjs').unsaved, 2);
  assert.equal(info('c:server/b.mjs').tone, 'quiet');
  assert.equal(info('part:flow').tone, null);
  assert.equal(info('part:flow').partId, 'flow');
  assert.equal(level2Flow(VIEW, { tt: en, live: null }).meta.nodes.get([...v.meta.nodes.keys()][0]).tone, null, 'without the key no piece is coloured');
});

test('inside a part: parts linked only by code wait for the switch; a narrow screen stacks what is around in short rows', () => {
  const hidden = { ...VIEW, nodes: [...VIEW.nodes, { id: 'part:readers', kind: 'part', name: 'Readers', partId: 'readers', side: 'in', band: 'in', hidden: true, origin: 'detected', badges: ['detected'], declared: [], detected: [] }],
    edges: [...VIEW.edges, { id: 'part:readers>part:server#uses@c:server/main.mjs', from: 'part:readers', to: 'c:server/main.mjs', kind: 'uses', hidden: true, label: { from: 'catalog', key: 'flow.l1.lbl.uses' }, origin: 'detected', badges: ['detected'], declared: [], detected: [] }] };
  const off = level2Flow(hidden, { tt: en });
  assert.equal(off.scene.nodes.some((n) => n.label === 'Readers'), false);
  assert.equal(off.meta.hiddenNear, 1);
  assert.equal(off.scene.edges.length, VIEW.edges.length);
  const on = level2Flow(hidden, { tt: en, showHidden: true });
  assert.ok(on.scene.nodes.some((n) => n.label === 'Readers'));
  assert.equal(on.scene.edges.length, VIEW.edges.length + 1);
  const narrow = level2Flow(hidden, { tt: en, showHidden: true, narrow: true, perRow: 2 });
  for (const r of narrow.scene.rows) {
    assert.equal(r.groups.length, 1, 'one group per row');
    assert.ok(narrow.scene.nodes.filter((n) => n.group === r.groups[0].id).length <= 2);
  }
});

test('inside a part: a piece many others use is not reached by a bundle of arrows; its box and the facts say who uses it', () => {
  const users = ['a', 'b', 'c', 'd'];
  const imp = (from, to) => ({ id: `c:server/${from}.mjs>c:server/${to}.mjs#import`, from: `c:server/${from}.mjs`, to: `c:server/${to}.mjs`, kind: 'import', label: { from: 'code', key: 'flow.l2.lbl.uses' }, names: [], origin: 'detected', badges: ['detected'], declared: [], detected: [{ file: `server/${from}.mjs`, line: 2, via: 'import' }] });
  const view = { ...VIEW, edges: [...VIEW.edges, ...users.map((x) => imp(x, 'log')), imp('a', 'b')] };
  const v = level2Flow(view, { tt: en });
  const into = (id) => v.scene.edges.filter((e) => e.to === [...v.meta.nodes].find(([, m]) => m.nodeId === id)[0]);
  assert.equal(into('c:server/log.mjs').length, 0, 'no arrow drawn into the shared piece');
  assert.equal(into('c:server/b.mjs').length, 1, 'an arrow into a piece only one other uses stays');
  assert.equal(v.meta.hubs, 1);
  assert.equal(v.meta.folded.length, 4);
  const log = v.scene.nodes.find((n) => n.label === 'log.mjs');
  assert.equal(log.sub, 'used by 4 pieces here · uses 1 piece here');
  const rows = factRows(v.model, v.meta, en);
  assert.equal(rows.filter((r) => r.type === 'arrow' && r.text.endsWith('→ log.mjs') && r.label.includes(en('flow.l2.folded'))).length, 4, 'every arrow not drawn is still listed');
  assert.ok(innerNotes(view, en, { keyed: true, hubs: v.meta.hubs }).some((s) => s === en.count('flow.l2.note.hubs', 1)));
  // Three users are not enough: the arrows are drawn.
  const three = level2Flow({ ...VIEW, edges: [...VIEW.edges, ...users.slice(0, 3).map((x) => imp(x, 'log'))] }, { tt: en });
  assert.equal(three.meta.hubs, 0);
  assert.equal(three.meta.folded.length, 0);
  assert.ok(HUB_MIN >= 3);
});

test('a README layer with a common name is said in the page language; any other keeps the README words', () => {
  assert.equal(layerName({ id: 'l:surface', drawId: 'surface', name: 'What you touch' }, pt), 'O que você usa');
  assert.equal(layerName({ id: 'l:sources', drawId: 'sources', name: 'What it reads' }, pt), 'O que ele lê');
  assert.equal(layerName({ id: 'l:engine', drawId: 'engine', name: 'What it works out' }, pt), 'O que ele calcula');
  assert.equal(layerName({ id: 'l:x', drawId: 'engine', name: 'Motor' }, pt), 'O que ele calcula', 'by the subgraph id when the name is not known');
  assert.equal(layerName({ id: 'l:surface', drawId: 'surface', name: 'What you touch' }, en), 'What you touch', 'English keeps the README words');
  assert.equal(layerName({ id: 'l:odd', drawId: 'odd', name: 'Os bastidores' }, pt), 'Os bastidores');
  assert.equal(layerName({ id: 'l:actors', name: 'Who uses it', nameKey: 'flow.l1.layer.actors' }, pt), 'Quem usa');
  assert.equal(pageLang(pt), 'pt-BR');
  assert.equal(pageLang(en), 'en');
});

test('the language of a short sentence, by its little words', () => {
  assert.equal(textLang('The Flow tab: the architecture as a mermaid flowchart, with its boxes tied to the parts.'), 'en');
  assert.equal(textLang('Lê os arquivos do Claude Code e monta o estado de cada conversa.'), 'pt');
  assert.equal(textLang('main.mjs'), null);
  assert.equal(textLang(''), null);
  assert.equal(ownName({ id: 'part:x', name: 'Mind map page' }, pt), '“Mind map page”');
  assert.equal(ownName({ id: 'actor:browser', nameKey: 'flow.l1.actor.browser', name: 'x' }, pt), pt('flow.l1.actor.browser'));
});

test('resting on a box lights its own arrows and the boxes at their other ends, and nothing else', () => {
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'D', to: 'A' }, { from: 'C', to: 'D' }];
  const on = neighbourhood(edges, 'A');
  assert.deepEqual([...on.edges].sort(), [0, 2], 'the arrows that start or end at A');
  assert.deepEqual([...on.nodes].sort(), ['A', 'B', 'D'], 'A and the boxes they reach, never C');
  assert.deepEqual([...neighbourhood(edges, 'C').edges].sort(), [1, 3]);
});

test('a box with no arrow lights only itself, and a box that is not there lights its name alone', () => {
  const alone = neighbourhood([{ from: 'A', to: 'B' }], 'Z');
  assert.equal(alone.edges.size, 0);
  assert.deepEqual([...alone.nodes], ['Z']);
  assert.equal(neighbourhood([], 'A').edges.size, 0);
});
