import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFileName, markdownOf, pngSize, isAutoDraft, svgDocument } from '../server/web/flowexport.js';

test('exportFileName: the project name in plain letters, then -flow and the extension', () => {
  assert.equal(exportFileName('Feira Livre', 'svg'), 'feira-livre-flow.svg');
  assert.equal(exportFileName('São Luís', 'png'), 'sao-luis-flow.png');
  assert.equal(exportFileName('', 'md'), 'flow.md');
  assert.equal(exportFileName('???', 'mmd'), 'flow.mmd');
});

test('markdownOf: a title and the mermaid block, ready to paste in a README', () => {
  const md = markdownOf('Feira', 'flowchart LR\n  a --> b', 'Flow');
  assert.equal(md, '# Feira · Flow\n\n```mermaid\nflowchart LR\n  a --> b\n```\n');
  assert.ok(!markdownOf('X', 'flowchart LR\n```\nbad', 'Flow').includes('```\nbad'), 'a fence inside the drawing never closes the block');
});

test('pngSize: twice the drawing, kept inside what a canvas holds', () => {
  assert.deepEqual(pngSize(800, 400), { width: 1600, height: 800, scale: 2 });
  const big = pngSize(9000, 6000);
  assert.ok(big.width <= 8192 && big.height <= 8192, 'inside the canvas limit');
  assert.ok(Math.abs(big.width / big.height - 1.5) < 0.01, 'same proportion');
  assert.deepEqual(pngSize(0, 0), { width: 2, height: 2, scale: 2 });
});

test('isAutoDraft: a map with parts and no diagram in its README is drawn by session-map', () => {
  const arch = (o) => ({ source: 'worktree', mermaid: null, parts: [{ id: 'a' }], ...o });
  assert.equal(isAutoDraft(arch({})), true);
  assert.equal(isAutoDraft(arch({ mermaid: 'flowchart LR\n a-->b' })), false);
  assert.equal(isAutoDraft(arch({ source: 'none', parts: [] })), false);
  assert.equal(isAutoDraft(arch({ parts: [] })), false, 'nothing to draw');
  assert.equal(isAutoDraft(arch({ source: 'main-branch' })), true);
});

test('svgDocument: a stand-alone file with the size, the namespace and a background', () => {
  const doc = svgDocument('<svg viewBox="0 0 300 120" width="100%" style="max-width: 480px; min-width: 240px" class="x"><g/></svg>', { width: 300, height: 120, background: '#fff' });
  assert.match(doc, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg /);
  assert.match(doc, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(doc, /width="300" height="120"/);
  assert.match(doc, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.ok(!/max-width|min-width|width="100%" /.test(doc.replace('<rect width="100%"', '')), 'the screen sizing is dropped');
  assert.match(doc, /viewBox="0 0 300 120"/);
});

// ---- fl13: draw.io and PlantUML, from the same diagram the mermaid export holds ------------------------------

import { drawioOf, plantumlOf, plantumlDeploymentOf } from '../server/web/flowexport.js';
import { parseFlow } from '../server/web/flow.js';

const SMALL = [
  'flowchart LR',
  '  subgraph front["Pages & <Tools>"]',
  '    ui["The \\"page\\" & co"]',
  '    who(["Maria"])',
  '  end',
  '  subgraph back["Server"]',
  '    api["API"]',
  '    store[("Files")]',
  '  end',
  '  cloud{{"Mail"}}',
  '  who --> ui',
  '  ui -->|asks| api',
  '  api -.-> store',
  '  api --- cloud',
].join('\n').replace(/\\"/g, '#quot;');

const cells = (xml) => [...xml.matchAll(/<mxCell\b([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));

test('drawioOf: a draw.io file with one container per layer, one cell per box and one per arrow', () => {
  const xml = drawioOf(SMALL, 'Feira');
  assert.match(xml, /^<mxfile\b/);
  assert.match(xml, /<\/mxfile>\s*$/);
  const all = cells(xml);
  const vertices = all.filter((c) => c.vertex === '1');
  const edges = all.filter((c) => c.edge === '1');
  const model = parseFlow(SMALL);
  assert.equal(vertices.length, model.layers.length + model.nodes.length);
  assert.equal(edges.length, model.edges.length);
  const ids = new Set(all.map((c) => c.id));
  assert.equal(ids.size, all.length, 'every id is unique');
  for (const e of edges) {
    assert.ok(ids.has(e.source) && ids.has(e.target), 'arrows end on cells that exist');
    assert.ok(vertices.some((v) => v.id === e.source) && vertices.some((v) => v.id === e.target));
  }
  assert.ok(edges.some((e) => e.value === 'asks'), 'an arrow keeps its label');
  assert.ok(edges.some((e) => /dashed=1/.test(e.style)), 'a dotted arrow stays dotted');
  assert.ok(edges.some((e) => /endArrow=none/.test(e.style)), 'a plain line has no head');
});

test('drawioOf: a box sits inside its layer, and a box with no layer sits on the page', () => {
  const all = cells(drawioOf(SMALL, 'Feira'));
  const by = (value) => all.find((c) => c.value === value);
  const front = by('Pages &amp; &lt;Tools&gt;');
  assert.ok(front, 'the layer name is escaped');
  assert.equal(by('Maria').parent, front.id);
  assert.equal(by('API').parent, by('Server').id);
  assert.equal(by('Mail').parent, '1');
  assert.match(by('Files').style, /cylinder/);
  assert.match(by('Mail').style, /hexagon/);
});

test('drawioOf: names with & < > and quotes never break the XML', () => {
  const xml = drawioOf(SMALL, 'A & "B" <c>');
  assert.ok(xml.includes('value="The &quot;page&quot; &amp; co"'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), 'no bare ampersand');
  assert.ok(!/value="[^"]*[<>]/.test(xml), 'no bare angle bracket inside an attribute');
  assert.ok(xml.includes('name="A &amp; &quot;B&quot; &lt;c&gt;"'), 'the page name is escaped too');
});

test('drawioOf: every cell has a place, and the layout is the same every time', () => {
  const xml = drawioOf(SMALL, 'Feira');
  assert.equal(xml, drawioOf(SMALL, 'Feira'));
  const geo = [...xml.matchAll(/<mxGeometry\b([^>]*)\/?>/g)].map((m) => m[1]);
  assert.equal(geo.length, cells(xml).filter((c) => c.vertex === '1' || c.edge === '1').length);
  assert.ok(geo.filter((g) => /width=/.test(g)).every((g) => /x="-?\d+"/.test(g) && /y="-?\d+"/.test(g)));
});

test('drawioOf: text that is not a flowchart gives nothing', () => {
  assert.equal(drawioOf('hello', 'X'), null);
  assert.equal(drawioOf('', 'X'), null);
  assert.equal(drawioOf(null, 'X'), null);
});

test('plantumlOf: a component diagram with a package per layer and the same arrows', () => {
  const uml = plantumlOf(SMALL, 'Feira');
  assert.match(uml, /^@startuml\n/);
  assert.match(uml, /@enduml\n$/);
  assert.match(uml, /left to right direction/);
  assert.match(uml, /title Feira/);
  assert.equal([...uml.matchAll(/^\s*package /gm)].length, 2);
  assert.match(uml, /actor "Maria" as \w+/);
  assert.match(uml, /database "Files" as \w+/);
  assert.match(uml, /cloud "Mail" as \w+/);
  assert.match(uml, /component "API" as \w+/);
  const arrows = uml.split('\n').filter((l) => /^\w+ (-->|--|\.\.>|\.\.|==>|-\[bold\]->) \w+/.test(l.trim()));
  assert.equal(arrows.length, 4);
  assert.ok(arrows.some((l) => /-->.*: asks$/.test(l)), 'a label follows the colon');
  assert.ok(arrows.some((l) => /\.\.>/.test(l)), 'dotted stays dotted');
});

test('plantumlOf: aliases are safe words, names are escaped, and every arrow ends on a declared name', () => {
  const nasty = 'flowchart TB\n  a-1["Say #quot;hi#quot; \ <b>x</b> %date() ~"]\n  node["Node"]\n  a-1 --> node';
  const uml = plantumlOf(nasty, 'T "1"');
  assert.ok(!/title .*"/.test(uml), 'no quote inside the title');
  const label = /component "([^"\n]*)" as/.exec(uml)[1].replace(/<U\+[0-9A-F]{4}>/g, '');
  assert.ok(!/[<\~]|%date/.test(label), `nothing PlantUML would read as markup: ${label}`);
  assert.ok(label.includes('hi') && label.includes('x'), 'the words stay');
  const aliases = [...uml.matchAll(/ as (\w+)/g)].map((m) => m[1]);
  assert.equal(new Set(aliases).size, aliases.length);
  assert.ok(!aliases.includes('node') && !aliases.includes('a-1'));
  const arrow = /^\s*(\w+) --> (\w+)/m.exec(uml);
  assert.ok(arrow && aliases.includes(arrow[1]) && aliases.includes(arrow[2]));
  assert.ok(!/left to right/.test(uml), 'top to bottom is the default');
  assert.equal(plantumlOf('nope', 'x'), null);
});

test('plantumlDeploymentOf: layers become nodes, outside services clouds; nothing without a computer or outside service', () => {
  const uml = plantumlDeploymentOf(SMALL, 'Feira');
  assert.match(uml, /^@startuml\n/);
  assert.equal([...uml.matchAll(/^\s*node /gm)].length, 2);
  assert.match(uml, /database "Files"/);
  assert.match(uml, /cloud "Mail"/);
  assert.equal(plantumlDeploymentOf('flowchart LR\n  a["A"] --> b["B"]', 'x'), null, 'no data about where things run');
  assert.equal(plantumlDeploymentOf('nope', 'x'), null);
});

test('plantumlOf and plantumlDeploymentOf: a box with an empty or blank label falls back to its id, no empty quoted name', () => {
  const text = 'flowchart TB\n a[""]\n b["  "]\n a --> b';
  const uml = plantumlOf(text, 'x');
  assert.ok(!/""/.test(uml), `no empty quoted name: ${uml}`);
  assert.match(uml, /component "a" as c_a/);
  assert.match(uml, /component "b" as c_b/);
  const dep = plantumlDeploymentOf('flowchart TB\n a[""]\n b[("  ")]\n a --> b', 'x');
  assert.ok(!/""/.test(dep), `no empty quoted name in the deployment: ${dep}`);
});

test('drawioOf: a box with an empty or blank label shows its id', () => {
  const out = drawioOf('flowchart TB\n a[""]\n b["  "]\n a --> b', 'x');
  assert.match(out, /id="box-1" value="a"/);
  assert.match(out, /id="box-2" value="b"/);
});

test('drawioOf: characters XML cannot carry (U+FFFE, U+FFFF, control codes) never reach the file', () => {
  const out = drawioOf('flowchart TB\n a["x￾y￿z\u0001w"]', 'x');
  assert.ok(!out.includes('￾') && !out.includes('￿') && !out.includes('\u0001'));
  assert.match(out, /value="xyzw"/);
});
