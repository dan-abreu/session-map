import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch } from '../server/arch/parse.mjs';
import { assembleModel, declaredModel, hashOfFiles } from '../server/arch/flowmodel.mjs';

const DIR = 'docs/architecture';
const README = [
  '# Shop', // 1
  '', // 2
  '```mermaid', // 3
  'flowchart LR', // 4
  '    subgraph people["Who uses it"]', // 5
  '        CU(["Customers"])', // 6
  '    end', // 7
  '    subgraph core["Core"]', // 8
  '        AP[API]', // 9
  '        WK[Worker]', // 10
  '        WB[Web]', // 11
  '    end', // 12
  '    GH{{GitHub}}', // 13
  '    NF[Invoices]', // 14
  '    CU --> WB', // 15
  '    WB -->|orders| AP', // 16
  '    AP --> WK', // 17
  '    AP -.-> GH', // 18
  '    AP --> NF', // 19
  '```', // 20
  '',
].join('\n');
const part = (name, path) => `# ${name}\n\nThe ${name}.\n\n## Where in the code\n\n- \`${path}\`\n`;
const ARCH = parseArch(DIR, {
  'README.md': README,
  'api.md': part('API', 'src/api/'),
  'worker.md': part('Worker', 'src/worker/'),
  'web.md': part('Web', 'src/web/'),
  'operation.md': '# Operation\n\nNo code.\n',
});

const node = (m, id) => m.nodes.find((n) => n.id === id);
const edge = (m, id) => m.edges.find((e) => e.id === id);
const sig = (type, value, line, extra = {}) => ({ type, value, line, via: type, ...extra });
const owners = (entries) => new Map(Object.entries(entries));
const OWN = owners({
  'src/api/a.mjs': ['api'], 'src/api/b.mjs': ['api'], 'src/api/cli.mjs': ['api'], 'src/api/queue.mjs': ['api'],
  'src/worker/run.mjs': ['worker'], 'src/worker/jobs.mjs': ['worker'], 'src/worker/hook.mjs': ['worker'],
  'src/web/app.mjs': ['web'], 'src/web/server.mjs': ['web'], 'src/web/page.tsx': ['web'], 'src/shared/x.mjs': ['api', 'worker'],
});
const resolve = (from, spec) => ({ '../api/queue.mjs': 'src/api/queue.mjs', '../worker/jobs.mjs': 'src/worker/jobs.mjs' })[spec] ?? null;
const build = (over = {}) => assembleModel({ arch: { ...ARCH, links: [] }, readmeText: README, scans: {}, owners: OWN, resolve, source: 'worktree', projectId: 'shop-1', ...over });

test('declared side: parts without code are left out; README boxes are parts, actors, services or free boxes', () => {
  const m = declaredModel(ARCH, { readmeText: README });
  assert.equal(node(m, 'part:operation'), undefined);
  assert.deepEqual(['api', 'worker', 'web'].map((id) => [node(m, `part:${id}`).drawId, node(m, `part:${id}`).layer]), [['AP', 'l:core'], ['WK', 'l:core'], ['WB', 'l:core']]);
  assert.deepEqual(node(m, 'part:api').declared[0], { file: 'docs/architecture/api.md', line: 1, via: 'part-doc' });
  const gh = node(m, 'svc:github');
  assert.equal(gh.kind, 'service');
  assert.equal(gh.where, 'internet');
  assert.equal(gh.origin, 'declared');
  assert.equal(node(m, 'actor:customer').kind, 'actor');
  assert.equal(node(m, 'actor:customer').layer, 'l:people');
  assert.equal(node(m, 'free:invoices').kind, 'free');
  const orders = edge(m, 'part:web>part:api#flow');
  assert.deepEqual(orders.label, { from: 'readme', text: 'orders', key: null, missing: false });
  assert.equal(orders.origin, 'declared');
  assert.deepEqual(orders.declared, [{ file: 'docs/architecture/README.md', line: 16, via: 'readme' }]);
  assert.equal(orders.drawKind, 'arrow');
  assert.equal(edge(m, 'part:api>svc:github#service').drawKind, 'dotted');
  assert.equal(edge(m, 'actor:customer>part:web#actor').kind, 'actor');
});

test('without the README text the line of an arrow is its line inside the mermaid block', () => {
  const m = declaredModel(ARCH);
  assert.deepEqual(edge(m, 'part:web>part:api#flow').declared, [{ file: 'docs/architecture/README.md', line: null, blockLine: 13, via: 'readme' }]);
});

test('an unlabeled README arrow takes words from what its parts are, and keeps the code names as evidence', () => {
  const m = build({ scans: { 'src/worker/run.mjs': { signals: [], imports: [{ spec: '../api/queue.mjs', line: 1, names: ['enqueue', 'retry'] }] } } });
  const e = edge(m, 'part:api>part:worker#flow');
  assert.equal(e.origin, 'declared');
  assert.deepEqual(e.badges, ['declared', 'detected']);
  assert.deepEqual(e.label, { from: 'role', text: null, key: 'flow.l1.lbl.queue', missing: false }, 'a worker takes background jobs');
  assert.deepEqual(e.names, ['enqueue', 'retry']);
  assert.deepEqual(e.detected, [{ file: 'src/worker/run.mjs', line: 1, via: 'import' }]);
  assert.deepEqual(edge(m, 'part:api>free:invoices#flow').label, { from: 'role', text: null, key: 'flow.l1.lbl.role.server', missing: false });
  assert.equal(m.counts.unlabeled, 0);
});

test('an unlabeled arrow between parts with no known role: code behind it says "code it shares", nothing known stays blank', () => {
  const readme = '# X\n\n```mermaid\nflowchart LR\n  AL[Alpha] --> BE[Beta]\n  BE --> GA[Gamma]\n```\n';
  const arch = { ...parseArch(DIR, { 'README.md': readme, 'alpha.md': part('Alpha', 'src/alpha/'), 'beta.md': part('Beta', 'src/beta/'), 'gamma.md': part('Gamma', 'src/gamma/') }), links: [] };
  const own = owners({ 'src/alpha/a.mjs': ['alpha'], 'src/beta/b.mjs': ['beta'] });
  const m = assembleModel({ arch, readmeText: readme, owners: own, scans: { 'src/beta/b.mjs': { signals: [], imports: [{ spec: '../alpha/a.mjs', line: 2, names: ['a'] }] } }, resolve: (f, spec) => (spec === '../alpha/a.mjs' ? 'src/alpha/a.mjs' : null) });
  assert.deepEqual(edge(m, 'part:alpha>part:beta#flow').label, { from: 'code', text: null, key: 'flow.l1.lbl.uses', missing: false });
  assert.deepEqual(edge(m, 'part:beta>part:gamma#flow').label, { from: 'none', text: null, key: null, missing: true });
  assert.equal(m.counts.unlabeled, 1);
});

test('every arrow has words or is counted as not described yet', () => {
  const m = build();
  for (const e of m.edges) assert.ok(Boolean(e.label.text || e.label.key) !== e.label.missing, e.id);
  assert.equal(m.counts.unlabeled, m.edges.filter((e) => e.label.missing).length);
});

test('an import between parts the README does not join is a hidden "uses" arrow, from the part that provides to the one that uses', () => {
  const m = build({ scans: { 'src/web/app.mjs': { signals: [], imports: [{ spec: '../worker/jobs.mjs', line: 4, names: ['jobs'] }] } } });
  const e = edge(m, 'part:worker>part:web#uses');
  assert.equal(e.kind, 'uses');
  assert.equal(e.origin, 'detected');
  assert.equal(e.hidden, true);
  assert.deepEqual(e.label, { from: 'catalog', text: null, key: 'flow.l1.lbl.uses', missing: false });
  assert.deepEqual(e.names, ['jobs']);
});

test('a relation from chats or branches with no arrow is a hidden "related" line with its proof', () => {
  const links = [{ a: 'web', b: 'worker', weight: 2, reasons: [{ kind: 'shared-chat', text: 'Fix', sessionId: 's1', files: ['src/web/app.mjs'] }, { kind: 'shared-branch', text: 'feat/x', workCellId: 'w1' }] }];
  const m = build({ arch: { ...ARCH, links } });
  const e = edge(m, 'part:web>part:worker#related');
  assert.equal(e.kind, 'related');
  assert.equal(e.hidden, true);
  assert.equal(e.label.key, 'flow.l1.lbl.related');
  assert.deepEqual(e.detected, [{ file: 'src/web/app.mjs', line: null, via: 'chat', ref: 's1' }, { file: null, line: null, via: 'branch', ref: 'feat/x' }]);
});

test('git run from two files of one part is one service box and one arrow of weight 2', () => {
  const m = build({ scans: { 'src/api/a.mjs': { signals: [sig('command', 'git', 3)], imports: [] }, 'src/api/b.mjs': { signals: [sig('command', 'git', 9)], imports: [] } } });
  const git = node(m, 'svc:git');
  assert.equal(git.where, 'this-pc');
  assert.equal(git.layer, 'l:thispc');
  assert.equal(git.origin, 'detected');
  const e = edge(m, 'part:api>svc:git#service');
  assert.equal(e.weight, 2);
  assert.equal(e.detectedCount, 2);
  assert.equal(e.label.key, 'flow.l1.lbl.git');
  assert.equal(e.hidden, false);
});

test('a file shared by two parts gives the arrow to both, marked shared', () => {
  const m = build({ scans: { 'src/shared/x.mjs': { signals: [sig('command', 'git', 2)], imports: [] } } });
  assert.ok(edge(m, 'part:api>svc:git#service'));
  assert.ok(edge(m, 'part:worker>svc:git#service'));
  assert.equal(edge(m, 'part:worker>svc:git#service').detected[0].shared, true);
});

test('GitHub in the README and in the code is both declared and detected', () => {
  const m = build({ scans: { 'src/api/a.mjs': { signals: [sig('host', 'api.github.com', 5, { via: 'url' })], imports: [] } } });
  const gh = node(m, 'svc:github');
  assert.equal(gh.origin, 'declared');
  assert.deepEqual(gh.badges, ['declared', 'detected']);
  const e = edge(m, 'part:api>svc:github#service');
  assert.deepEqual(e.badges, ['declared', 'detected']);
  assert.equal(e.label.key, 'flow.l1.lbl.github', 'the README arrow had no words: the catalog gives them');
  assert.equal(m.edges.filter((x) => x.from === 'part:api' && x.to === 'svc:github').length, 1);
});

test('actors: terminal from bin, Claude Code from hooks, the browser and the phone from a listening page, people from screens', () => {
  const m = build({
    scans: {
      'src/web/server.mjs': { signals: [sig('html', 'page', 2), sig('bind-all', '0.0.0.0', 3), sig('listen', 'listen', 4)], imports: [] },
      'src/web/page.tsx': { signals: [sig('screen', '/dashboard', 1, { app: 'admin', route: '/dashboard' })], imports: [] },
      'tools/x.mjs': { signals: [sig('command', 'git', 1)], imports: [] },
    },
    packageJson: { path: 'package.json', name: 'shop', bin: [{ file: 'src/api/cli.mjs', line: 4 }], deps: [] },
    hooks: { path: 'hooks/hooks.json', scripts: [{ file: 'src/worker/hook.mjs', line: 6 }] },
  });
  assert.deepEqual(edge(m, 'actor:terminal>part:api#actor').detected, [{ file: 'package.json', line: 4, via: 'bin' }]);
  assert.deepEqual(edge(m, 'actor:claude-code>part:worker#actor').detected, [{ file: 'hooks/hooks.json', line: 6, via: 'hooks' }]);
  assert.ok(edge(m, 'actor:browser>part:web#actor'));
  assert.ok(edge(m, 'actor:lan>part:web#actor'));
  assert.equal(node(m, 'actor:lan').layer, 'l:actors');
  assert.equal(edge(m, 'actor:admin>part:web#actor').label.key, 'flow.l1.lbl.screens');
  assert.ok(node(m, 'svc:git'), 'a signal in a file of no part keeps its box');
  assert.equal(m.edges.filter((e) => e.to === 'svc:git').length, 0, 'but draws no arrow');
});

test('the model has no journeys yet, and the same input always gives the same model, with nothing from the AI', () => {
  const input = { scans: { 'src/api/a.mjs': { signals: [sig('command', 'git', 3), sig('sdk', '@anthropic-ai/sdk', 1)], imports: [] } } };
  const a = build(input);
  const b = build(input);
  assert.deepEqual(a, b);
  assert.deepEqual(a.journeys, []);
  for (const x of [...a.nodes, ...a.edges]) {
    assert.notEqual(x.origin, 'ai');
    assert.equal(x.ai, null);
    assert.equal(x.ownerConfirmed, null);
  }
  assert.equal(node(a, 'svc:claude').where, 'internet');
});

test('caps: arrows, evidence per fact and label length', () => {
  const long = README.replace('WB -->|orders| AP', `WB -->|${'x'.repeat(80)}| AP`);
  const arch = { ...parseArch(DIR, { 'README.md': long, 'api.md': part('API', 'src/api/'), 'worker.md': part('Worker', 'src/worker/'), 'web.md': part('Web', 'src/web/') }), links: [] };
  const signals = Array.from({ length: 7 }, (_, i) => sig('command', 'git', i + 1));
  const m = build({ arch, readmeText: long, scans: { 'src/api/a.mjs': { signals, imports: [] } } });
  const e = edge(m, 'part:api>svc:git#service');
  assert.equal(e.detected.length, 5);
  assert.equal(e.detectedCount, 7);
  assert.ok(edge(m, 'part:web>part:api#flow').label.text.length <= 60);
  const few = build({ limits: { edges: 3 } });
  assert.equal(few.edges.length, 3);
  assert.equal(few.counts.cut.edges > 0, true);
});

test('hashOfFiles is the same for the same files in any order and changes with a file', () => {
  const a = hashOfFiles([{ path: 'a', sha: '1' }, { path: 'b', sha: '2' }]);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(hashOfFiles([{ path: 'b', sha: '2' }, { path: 'a', sha: '1' }]), a);
  assert.notEqual(hashOfFiles([{ path: 'a', sha: '1' }, { path: 'b', sha: '3' }]), a);
});

test('a README box of a part the Flow leaves out (requests, operation) is not drawn as a free box', () => {
  const readme = README.replace('    NF[Invoices]', '    NF[Invoices]\n    OP[Operation]').replace('    AP --> NF', '    AP --> NF\n    OP --> AP');
  const arch = parseArch(DIR, { 'README.md': readme, 'api.md': part('API', 'src/api/'), 'operation.md': '# Operation\n\nNo code.\n' });
  const m = declaredModel(arch, { readmeText: readme });
  assert.equal(m.nodes.some((n) => /operation/.test(n.id)), false);
  assert.equal(m.edges.some((e) => /operation/.test(e.id)), false);
});
