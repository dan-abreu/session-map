// Level 2 of the Flow, inside a part (flow.md fl09): the part's pieces from its "Where in the code" paths and the code
// itself, the imports between them, and who it talks to outside, each arrow tied to the piece whose file shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch, partSections } from '../server/arch/parse.mjs';
import { assembleModel } from '../server/arch/flowmodel.mjs';
import { componentsOf, firstSentence, htmlEntries, innerModel, liveOf, partFilesOf, seedsOf } from '../server/arch/flowinner.mjs';

const DIR = 'docs/architecture';
const README = [
  '# Mini map',
  '',
  '```mermaid',
  'flowchart LR',
  '  subgraph core["Core"]',
  '    SV[Server]',
  '    WB[Web page]',
  '    FL[Flow]',
  '    RD[Readers]',
  '  end',
  '  FL -->|the drawing| SV',
  '  SV --> WB',
  '  RD --> SV',
  '```',
  '',
].join('\n');
const SERVER_MD = [
  '# Server', // 1
  '', // 2
  'Serves the page.', // 3
  '', // 4
  '## How it works', // 5
  '', // 6
  'The `server/main.mjs` file answers every request. Everything it does is written by `server/log.mjs` in the log.', // 7
  '', // 8
  '## Where in the code', // 9
  '', // 10
  '- `server/main.mjs`', // 11
  '- `server/log.mjs`', // 12
  '- `server/gone.mjs`', // 13
  '', // 14
  '## Rules that must not break', // 15
  '', // 16
  '- Never `server/other.mjs`.', // 17
  '',
].join('\n');
const part = (name, ...paths) => `# ${name}\n\nThe ${name}.\n\n## Where in the code\n\n${paths.map((p) => `- \`${p}\``).join('\n')}\n`;
const FILES = {
  'README.md': README,
  'server.md': SERVER_MD,
  'web-page.md': part('Web page', 'server/web/', './DESIGN.md'),
  'flow.md': part('Flow', 'server/web/flowview.js', 'server/arch/flow.mjs'),
  'readers.md': part('Readers', 'server/sources/'),
};
const ARCH = { ...parseArch(DIR, FILES), links: [] };
const sig = (type, value, line, extra = {}) => ({ type, value, line, via: type, ...extra });
const imp = (spec, line, names = []) => ({ spec, line, names });
const SCANS = {
  'server/main.mjs': { signals: [sig('html', 'page', 3), sig('listen', 'listen', 40)], imports: [imp('./log.mjs', 1, ['log']), imp('./arch/flow.mjs', 2, ['exportMermaid']), imp('./sources/git.mjs', 4, ['gitLog'])] },
  'server/log.mjs': { signals: [], imports: [] },
  'server/arch/flow.mjs': { signals: [], imports: [imp('../log.mjs', 1, ['log'])] },
  'server/web/app.js': { signals: [], imports: [imp('./api.js', 1, ['api']), imp('./chat.js', 2, ['createChat']), imp('./flowview.js', 3, ['createFlowView']), imp('./i18n.js', 4, ['translator', 'LANGS'])] },
  'server/web/api.js': { signals: [], imports: [imp('./i18n.js', 1, ['translator'])] },
  'server/web/chat.js': { signals: [], imports: [imp('./i18n.js', 1, ['translator'])] },
  'server/web/i18n.js': { signals: [], imports: [] },
  'server/web/flowgrid.js': { signals: [], imports: [] },
  'server/web/flowview.js': { signals: [], imports: [imp('./chat.js', 1, ['createChat']), imp('./flowgrid.js', 2, ['gridLayout'])] },
  'server/web/i18n-fd/model.js': { signals: [], imports: [] },
  'server/sources/git.mjs': { signals: [sig('command', 'git', 5)], imports: [] },
};
const OWN = new Map(Object.entries({
  'server/main.mjs': ['server'], 'server/log.mjs': ['server'], 'server/arch/flow.mjs': ['flow'],
  'server/web/app.js': ['web-page'], 'server/web/api.js': ['web-page'], 'server/web/chat.js': ['web-page'], 'server/web/i18n.js': ['web-page'],
  'server/web/flowgrid.js': ['web-page'], 'server/web/i18n-fd/model.js': ['web-page'], 'server/web/flowview.js': ['flow'],
  'server/sources/git.mjs': ['readers'],
}));
const RESOLVE = {
  'server/main.mjs': { './log.mjs': 'server/log.mjs', './arch/flow.mjs': 'server/arch/flow.mjs', './sources/git.mjs': 'server/sources/git.mjs' },
  'server/arch/flow.mjs': { '../log.mjs': 'server/log.mjs' },
  'server/web/app.js': { './api.js': 'server/web/api.js', './chat.js': 'server/web/chat.js', './flowview.js': 'server/web/flowview.js', './i18n.js': 'server/web/i18n.js' },
  'server/web/api.js': { './i18n.js': 'server/web/i18n.js' },
  'server/web/chat.js': { './i18n.js': 'server/web/i18n.js' },
  'server/web/flowview.js': { './chat.js': 'server/web/chat.js', './flowgrid.js': 'server/web/flowgrid.js' },
};
const resolve = (from, spec) => RESOLVE[from]?.[spec] ?? null;
const trace = new Map();
const MODEL = assembleModel({ arch: ARCH, readmeText: README, scans: SCANS, owners: OWN, resolve, source: 'worktree', projectId: 'mini-1', trace });
const LINKS = new Map(Object.keys(SCANS).map((p) => [p, SCANS[p].imports.map((i) => ({ target: resolve(p, i.spec), line: i.line, names: i.names })).filter((l) => l.target)]));
const partOf = (id) => ARCH.parts.find((p) => p.id === id);
const filesOf = (id, extra = []) => [...Object.keys(SCANS).filter((p) => OWN.get(p).includes(id)).map((path) => ({ path, code: true })), ...extra.map((path) => ({ path, code: false }))];
const view = (id, over = {}) => innerModel({
  part: partOf(id), sections: id === 'server' ? partSections(SERVER_MD) : null, files: filesOf(id), links: LINKS, owners: OWN, trace, model: MODEL, ...over,
});
const node = (v, id) => v.nodes.find((n) => n.id === id);
const edgesTo = (v, id) => v.edges.filter((e) => e.to === id);

test('partSections reads "How it works" and "Where in the code" with their lines, in English and in Portuguese', () => {
  const en = partSections(SERVER_MD);
  assert.equal(en.how.line, 7);
  assert.match(en.how.text, /^The `server\/main\.mjs` file answers every request\./);
  assert.deepEqual(en.where, [{ path: 'server/main.mjs', line: 11 }, { path: 'server/log.mjs', line: 12 }, { path: 'server/gone.mjs', line: 13 }]);
  const pt = partSections('# Servidor\n\nServe.\n\n## Como funciona\n\nPrimeira linha\ncontinua aqui.\n\nSegundo parágrafo.\n\n## Onde está no código\n\n- `server/main.mjs`\n```\n## not a heading\n```\n');
  assert.equal(pt.how.line, 7);
  assert.equal(pt.how.text, 'Primeira linha continua aqui. Segundo parágrafo.');
  assert.deepEqual(pt.where, [{ path: 'server/main.mjs', line: 14 }]);
  assert.deepEqual(partSections('# Nothing\n\nNo sections.\n'), { how: null, where: [] });
});

test('the level-1 model tells which file stands behind each arrow, without changing the model', () => {
  const again = assembleModel({ arch: ARCH, readmeText: README, scans: SCANS, owners: OWN, resolve, source: 'worktree', projectId: 'mini-1' });
  assert.deepEqual(again, MODEL, 'the trace is a side table, not part of the model');
  const flowToServer = trace.get('part:flow>part:server#flow');
  assert.deepEqual(flowToServer.map((x) => [x.file, x.other]).sort(), [['server/arch/flow.mjs', 'server/log.mjs'], ['server/main.mjs', 'server/arch/flow.mjs']]);
  assert.deepEqual(trace.get('actor:browser>part:server#actor').map((x) => x.file), ['server/main.mjs']);
  assert.deepEqual(trace.get('part:readers>svc:git#service').map((x) => x.file), ['server/sources/git.mjs']);
});

test('seeds: "Where in the code" paths and the paths "How it works" names; what is not code the Flow read is a note', () => {
  const files = [{ path: 'server/main.mjs', code: true }, { path: 'server/log.mjs', code: true }];
  const s = seedsOf(partOf('server'), partSections(SERVER_MD), files);
  assert.deepEqual(s.seeds.map((x) => [x.path, x.folder, x.line]), [['server/main.mjs', false, 11], ['server/log.mjs', false, 12]]);
  assert.deepEqual(s.notes, [{ key: 'notCode', paths: ['server/gone.mjs'] }]);
  const web = seedsOf(partOf('web-page'), null, [{ path: 'server/web/app.js', code: true }]);
  assert.deepEqual(web.seeds.map((x) => [x.path, x.folder, x.line]), [['server/web/', true, null]]);
  assert.deepEqual(web.notes, [{ key: 'notCode', paths: ['DESIGN.md'] }]);
});

test('pieces: a file seed is one box; a folder seed opens into its files and its first-level folders; a folder of one file is that file', () => {
  const files = [
    ...['server/web/app.js', 'server/web/api.js', 'server/web/i18n-fd/model.js', 'server/web/deep/one/x.js'].map((path) => ({ path, code: true })),
    ...['server/web/css/a.css', 'server/web/css/b.css', 'server/web/index.html'].map((path) => ({ path, code: false })),
  ];
  const seeds = [{ path: 'server/web/', folder: true, line: 3 }];
  const { boxes } = componentsOf({ seeds, files, links: new Map() });
  assert.deepEqual(boxes.map((b) => [b.id, b.kind, b.fileCount, b.other]), [
    ['c:server/web/api.js', 'component', 1, 0],
    ['c:server/web/app.js', 'component', 1, 0],
    ['c:server/web/css/', 'component', 0, 2],
    ['c:server/web/deep/one/x.js', 'component', 1, 0],
    ['c:server/web/i18n-fd/model.js', 'component', 1, 0],
  ]);
  const solo = componentsOf({ seeds: [{ path: 'server/main.mjs', folder: false, line: 11 }], files: [{ path: 'server/main.mjs', code: true }], links: new Map() });
  assert.deepEqual(solo.boxes.map((b) => [b.id, b.name, b.seedLine]), [['c:server/main.mjs', 'main.mjs', 11]]);
});

test('a big folder keeps the entry and the most linked files; the rest is one box that says how many', () => {
  const paths = Array.from({ length: 40 }, (_, i) => `server/web/m${String(i).padStart(2, '0')}.js`);
  const files = paths.map((path) => ({ path, code: true }));
  const links = new Map([
    ['server/web/m39.js', [{ target: 'server/web/m38.js', line: 1, names: ['a'] }, { target: 'server/web/m37.js', line: 2, names: ['b'] }]],
    ['server/web/m36.js', [{ target: 'server/web/m38.js', line: 1, names: ['a'] }]],
  ]);
  const { boxes, grouped } = componentsOf({ seeds: [{ path: 'server/web/', folder: true, line: 1 }], files, links, entries: ['server/web/m20.js'], max: 6 });
  assert.equal(boxes.length, 6);
  assert.deepEqual(boxes.filter((b) => b.kind === 'component').map((b) => b.path).sort(), ['server/web/m20.js', 'server/web/m36.js', 'server/web/m37.js', 'server/web/m38.js', 'server/web/m39.js']);
  const group = boxes.find((b) => b.kind === 'group');
  assert.equal(group.id, 'c:server/web/*');
  assert.equal(group.fileCount, 35);
  assert.equal(grouped, 35);
  assert.equal(group.dir, 'server/web');
});

test('inside the part: a piece points down to what it uses, with the names it takes; imports to other parts or libraries are not arrows', () => {
  const v = view('web-page');
  const inner = v.edges.filter((e) => e.kind === 'import');
  assert.deepEqual(inner.map((e) => e.id).sort(), [
    'c:server/web/api.js>c:server/web/i18n.js#import', 'c:server/web/app.js>c:server/web/api.js#import', 'c:server/web/app.js>c:server/web/chat.js#import',
    'c:server/web/app.js>c:server/web/i18n.js#import', 'c:server/web/chat.js>c:server/web/i18n.js#import',
  ]);
  const i18n = inner.find((e) => e.id === 'c:server/web/app.js>c:server/web/i18n.js#import');
  assert.equal(i18n.from, 'c:server/web/app.js');
  assert.deepEqual(i18n.names, ['LANGS', 'translator']);
  assert.equal(i18n.label.key, 'flow.l2.lbl.uses');
  assert.deepEqual(i18n.detected, [{ file: 'server/web/app.js', line: 4, via: 'import' }]);
  assert.equal(node(v, 'c:server/web/flowview.js'), undefined, 'a file of a deeper part is not a piece of this one');
});

test('who it talks to outside: callers come in, what it feeds goes out, each arrow to the piece whose file shows it', () => {
  const v = view('server');
  assert.equal(node(v, 'actor:browser').side, 'in');
  assert.equal(node(v, 'part:flow').side, 'in');
  assert.equal(node(v, 'part:web-page').side, 'out');
  assert.equal(node(v, 'part:flow').partId, 'flow', 'a neighbour part can be opened in turn');
  const fromFlow = v.edges.filter((e) => e.l1 === 'part:flow>part:server#flow');
  assert.deepEqual(fromFlow.map((e) => [e.from, e.to]), [['part:flow', 'c:server/main.mjs']], 'flow hands the drawing to main.mjs, which imports it; flow using log.mjs goes the other way and does not count');
  assert.ok(fromFlow.every((e) => e.label.text === 'the drawing'));
  assert.deepEqual(edgesTo(v, 'c:server/main.mjs').filter((e) => e.from === 'actor:browser').map((e) => e.id), ['actor:browser>part:server#actor@c:server/main.mjs']);
  const toPage = v.edges.find((e) => e.l1 === 'part:server>part:web-page#flow');
  assert.equal(toPage.from, 'c:server/main.mjs', 'an arrow only the README draws starts at the entry piece');
  assert.equal(toPage.readme, true);
  const readers = v.edges.filter((e) => e.l1 === 'part:readers>part:server#flow');
  assert.deepEqual(readers.map((e) => e.to), ['c:server/main.mjs']);
});

test('bands: the entry nobody imports, the work in the middle, the pieces it leans on, the pieces only other parts use', () => {
  const server = view('server');
  assert.equal(node(server, 'c:server/main.mjs').band, 'entry');
  assert.equal(node(server, 'c:server/log.mjs').band, 'base', 'main.mjs leans on it');
  const web = view('web-page');
  assert.equal(node(web, 'c:server/web/app.js').band, 'entry');
  assert.equal(node(web, 'c:server/web/api.js').band, 'work');
  assert.equal(node(web, 'c:server/web/i18n.js').band, 'base');
  assert.equal(node(web, 'c:server/web/chat.js').band, 'work', 'used inside and by another part: still part of the work');
  assert.equal(node(web, 'c:server/web/flowgrid.js').band, 'shared', 'only another part imports it');
  assert.equal(node(web, 'c:server/web/i18n-fd/model.js').band, 'work', 'a loose file nobody imports and that imports nothing is not an entry');
});

test('every piece says where it came from: the part file line of its seed and the files it holds', () => {
  const v = view('server');
  const main = node(v, 'c:server/main.mjs');
  assert.deepEqual(main.declared, [{ file: 'docs/architecture/server.md', line: 11, via: 'part-doc' }]);
  assert.deepEqual(main.detected, [{ file: 'server/main.mjs', line: 1, via: 'code' }]);
  assert.deepEqual(main.badges, ['declared', 'detected']);
  assert.match(main.about, /answers every request/);
  assert.deepEqual(v.how, { text: partSections(SERVER_MD).how.text, file: 'docs/architecture/server.md', line: 7 });
  assert.deepEqual(v.notes.find((n) => n.key === 'notCode'), { key: 'notCode', paths: ['server/gone.mjs'] });
});

test('the same input gives the same view, in any order', () => {
  const shuffled = new Map([...LINKS].reverse());
  const a = view('web-page');
  const b = view('web-page', { links: shuffled, files: [...filesOf('web-page')].reverse() });
  assert.deepEqual(a, b);
});

test('which files belong to a part: its code, and the other files under its folders that no deeper part holds', () => {
  const scanned = Object.keys(SCANS);
  const paths = [...scanned, 'server/web/css/a.css', 'server/web/index.html', 'server/web/vendor/d3.min.js', 'server/web/app.test.js', 'DESIGN.md'];
  const ownersOf = (list) => list.map((p) => (p.startsWith('server/web/') ? ['web-page'] : []));
  const files = partFilesOf({ part: partOf('web-page'), owners: OWN, scanned, paths, ownersOf });
  assert.deepEqual(files.filter((f) => f.code).map((f) => f.path), ['server/web/api.js', 'server/web/app.js', 'server/web/chat.js', 'server/web/flowgrid.js', 'server/web/i18n-fd/model.js', 'server/web/i18n.js']);
  assert.deepEqual(files.filter((f) => !f.code).map((f) => f.path), ['server/web/css/a.css', 'server/web/index.html']);
});

test('a page script named in an html file is where the part starts', () => {
  assert.deepEqual(htmlEntries('server/web/index.html', '<script type="module" src="app.js"></script><script src="https://x.example/a.js"></script><script src="./vendor/d3.min.js"></script>'), ['server/web/app.js', 'server/web/vendor/d3.min.js']);
});

test('the first sentence of a file\'s opening comment, without references and capped', () => {
  assert.equal(firstSentence('// The Flow tab (plano-v02 § v0.2.1): the drawing with its boxes.\n// More.\nimport x from "y";\n'), 'The Flow tab: the drawing with its boxes.');
  assert.equal(firstSentence('/**\n * Reads the archive. Then more.\n */\n'), 'Reads the archive.');
  assert.equal(firstSentence('#!/usr/bin/env node\n// Prints the tree as text.\n'), 'Prints the tree as text.');
  assert.equal(firstSentence('import x from "y";\n// late comment\n'), null);
  assert.equal(firstSentence(`// ${'word '.repeat(60)}\n`).length <= 160, true);
  assert.equal(firstSentence('// token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 here.\n').includes('abcdefghijklmnop'), false, 'secrets are masked');
});

test('live colours: a busy chat editing now, a change of the last minutes, an old change that is not saved yet', () => {
  const v = view('web-page');
  const now = Date.parse('2026-10-10T12:00:00Z');
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const rows = [
    { path: 'server/web/app.js', ts: ago(2), sessionId: 's1', state: 'pending' },
    { path: 'server/web/api.js', ts: ago(3), sessionId: null, state: 'pending' },
    { path: 'server/web/chat.js', ts: ago(20), sessionId: 's2', state: 'pending' },
    { path: 'server/web/i18n.js', ts: ago(30), sessionId: 's2', state: 'saved' },
    { path: 'server/main.mjs', ts: ago(1), sessionId: 's1', state: 'pending' },
  ];
  const chats = [{ sessionId: 's1', status: 'busy' }, { sessionId: 's2', status: 'idle' }];
  const live = liveOf(v, rows, chats, now);
  assert.deepEqual(live['c:server/web/app.js'], { tone: 'live', files: 1, unsaved: 1 });
  assert.deepEqual(live['c:server/web/api.js'], { tone: 'changed', files: 1, unsaved: 1 });
  assert.deepEqual(live['c:server/web/chat.js'], { tone: 'quiet', files: 0, unsaved: 1 }, 'an old file not saved yet is a small mark, not the colour');
  assert.equal(live['c:server/web/i18n.js'], undefined);
  assert.equal(Object.keys(live).some((k) => k.includes('main.mjs')), false);
});

test('the files grouped as "+N" get no arrows inside the part: they are counted instead', () => {
  const paths = Array.from({ length: 8 }, (_, i) => `server/web/m${i}.js`);
  const links = new Map([['server/web/m0.js', paths.slice(1).map((target) => ({ target, line: 1, names: ['x'] }))]]);
  const v = innerModel({ part: { id: 'web-page', name: 'Web page', file: 'docs/architecture/web-page.md', codePaths: ['server/web/'] }, files: paths.map((path) => ({ path, code: true })), links, model: { nodes: [], edges: [] }, limits: { boxes: 4 } });
  assert.ok(v.nodes.some((n) => n.kind === 'group'));
  assert.equal(v.edges.some((e) => e.from.endsWith('/*') || e.to.endsWith('/*')), false);
  assert.ok(v.counts.groupLinks > 0);
});

test('each side keeps its busiest neighbours; the ones joined only by code are capped apart and marked', () => {
  const others = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const nodes = [{ id: 'part:x', kind: 'part', partId: 'x', name: 'X' }, ...others.map((id) => ({ id: `part:${id}`, kind: 'part', partId: id, name: id.toUpperCase() }))];
  const edges = others.map((id, i) => ({ id: `part:${id}>part:x#${i < 9 ? 'flow' : 'uses'}`, from: `part:${id}`, to: 'part:x', kind: i < 9 ? 'flow' : 'uses', hidden: i >= 9, weight: 1, label: { key: 'flow.l1.lbl.uses' }, declared: [], detected: [] }));
  const v = innerModel({ part: { id: 'x', name: 'X', file: 'docs/x.md', codePaths: ['src/x.mjs'] }, files: [{ path: 'src/x.mjs', code: true }], model: { nodes, edges }, limits: { neighbours: 8 } });
  const near = v.nodes.filter((n) => n.side === 'in');
  assert.equal(near.filter((n) => !n.hidden).length, 8);
  assert.equal(near.filter((n) => n.hidden).length, 1, 'the code-only one is kept apart, for when the person asks to see it');
  assert.deepEqual(v.notes.find((n) => n.key === 'moreNeighbours').items.map((x) => [x.id, x.hidden]), [['part:p8', false]]);
});
