import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFlow, printFlow, lastMermaidBlock, newId, addBox, connect, addLayer, rename, moveToLayer, removeNode, removeEdge, matchParts,
} from '../server/web/flow.js';

const SHOP = [
  'flowchart LR',
  '  subgraph entry["Where people come in"]',
  '    storefront[Storefront]',
  '    courier(Courier app)',
  '  end',
  '  subgraph engine["What makes it work"]',
  '    orders["Orders and cart"]',
  '    payments[[Payments]]',
  '  end',
  '  storefront --> orders',
  '  orders -->|charges| payments',
  '  courier -.-> orders',
  '  payments --- orders',
].join('\n');

test('parseFlow reads layers, nodes with their layer and shape, and every kind of arrow', () => {
  const m = parseFlow(SHOP);
  assert.equal(m.ok, true);
  assert.equal(m.direction, 'LR');
  assert.deepEqual(m.layers, [{ id: 'entry', name: 'Where people come in' }, { id: 'engine', name: 'What makes it work' }]);
  assert.deepEqual(m.nodes.map((n) => [n.id, n.label, n.layer, n.shape]), [
    ['storefront', 'Storefront', 'entry', 'box'],
    ['courier', 'Courier app', 'entry', 'round'],
    ['orders', 'Orders and cart', 'engine', 'box'],
    ['payments', 'Payments', 'engine', 'sub'],
  ]);
  assert.deepEqual(m.edges, [
    { from: 'storefront', to: 'orders', label: null, kind: 'arrow' },
    { from: 'orders', to: 'payments', label: 'charges', kind: 'arrow' },
    { from: 'courier', to: 'orders', label: null, kind: 'dotted' },
    { from: 'payments', to: 'orders', label: null, kind: 'line' },
  ]);
  assert.deepEqual(m.warnings, []);
});

test('parseFlow takes a fenced block, graph TD, chains, inline nodes and quotes', () => {
  const m = parseFlow('```mermaid\ngraph TD;\n  a["Say #quot;hi#quot;"] --> b(Two) --> c\n  c -- calls --> a\n```');
  assert.equal(m.ok, true);
  assert.equal(m.direction, 'TD');
  assert.deepEqual(m.nodes.map((n) => [n.id, n.label, n.layer]), [['a', 'Say "hi"', null], ['b', 'Two', null], ['c', 'c', null]]);
  assert.deepEqual(m.edges.map((e) => [e.from, e.to, e.label]), [['a', 'b', null], ['b', 'c', null], ['c', 'a', 'calls']]);
});

test('parseFlow ignores what it does not understand, with a warning, and keeps it for printing', () => {
  const m = parseFlow('flowchart LR\n  a --> b & c\n  classDef hot fill:#f00\n  %% a comment\n  a --> b');
  assert.equal(m.ok, true);
  assert.deepEqual(m.warnings.map((w) => w.line), [2, 3]);
  assert.deepEqual(m.extra, ['a --> b & c', 'classDef hot fill:#f00']);
  assert.match(printFlow(m), /classDef hot fill:#f00/);
});

test('parseFlow refuses text that is not a flowchart', () => {
  assert.deepEqual(parseFlow('sequenceDiagram\n  A->>B: hi'), { ok: false, error: 'not-flowchart' });
  assert.deepEqual(parseFlow(''), { ok: false, error: 'not-flowchart' });
});

test('text → drawing → text keeps the drawing: print and parse again give the same model', () => {
  const first = parseFlow(SHOP);
  const again = parseFlow(printFlow(first));
  for (const k of ['direction', 'layers', 'nodes', 'edges', 'extra']) assert.deepEqual(again[k], first[k], k);
});

test('printFlow writes subgraphs with quoted names, quoted labels and edges after the layers', () => {
  const text = printFlow(parseFlow(SHOP));
  assert.match(text, /^flowchart LR\n {2}subgraph entry\["Where people come in"\]\n {4}storefront\["Storefront"\]\n {4}courier\("Courier app"\)\n {2}end\n/);
  assert.match(text, /\n {2}orders -->\|charges\| payments\n/);
  assert.match(text, /\n {2}courier -\.-> orders\n/);
  assert.ok(text.indexOf('storefront --> orders') > text.lastIndexOf('end'));
});

test('lastMermaidBlock returns the last closed mermaid fence of a reply', () => {
  const reply = 'Here:\n```mermaid\nflowchart LR\n a\n```\nand better:\n```mermaid\nflowchart LR\n  b --> c\n```\nDone.';
  assert.equal(lastMermaidBlock(reply), 'flowchart LR\n  b --> c');
  assert.equal(lastMermaidBlock('```mermaid\nflowchart LR\n  a'), null, 'an open fence is still being written');
  assert.equal(lastMermaidBlock('no diagram'), null);
});

test('newId makes a mermaid-safe id that is unique and never a keyword', () => {
  const m = parseFlow('flowchart LR\n  orders[Orders]');
  assert.equal(newId(m, 'Orders'), 'orders_2');
  assert.equal(newId(m, 'Pagamentos & Pix'), 'pagamentos_pix');
  assert.equal(newId(m, 'end'), 'end_box');
  assert.equal(newId(m, '42 things'), 'n_42_things');
  assert.equal(newId(m, '***'), 'box');
});

test('manual tools: add a box, connect, add a layer, rename, move, remove — each gives the right mermaid', () => {
  let m = parseFlow('flowchart LR\n  subgraph app["App"]\n    web[Web]\n  end');
  m = addLayer(m, 'Back end');
  assert.deepEqual(m.layers.at(-1), { id: 'back_end', name: 'Back end' });
  m = addBox(m, 'Billing API', 'back_end');
  assert.deepEqual(m.nodes.at(-1), { id: 'billing_api', label: 'Billing API', layer: 'back_end', shape: 'box' });
  m = connect(m, 'web', 'billing_api', 'pays');
  assert.deepEqual(m.edges, [{ from: 'web', to: 'billing_api', label: 'pays', kind: 'arrow' }]);
  assert.equal(connect(m, 'web', 'billing_api').edges.length, 1, 'the same arrow twice is one arrow');
  m = rename(m, 'web', 'Web shop');
  m = rename(m, 'app', 'Front');
  m = moveToLayer(m, 'web', 'back_end');
  assert.equal(printFlow(m), [
    'flowchart LR',
    '  subgraph app["Front"]',
    '  end',
    '  subgraph back_end["Back end"]',
    '    billing_api["Billing API"]',
    '    web["Web shop"]',
    '  end',
    '  web -->|pays| billing_api',
  ].join('\n'));
  const noArrow = removeEdge(m, 0);
  assert.equal(noArrow.edges.length, 0);
  const noBox = removeNode(m, 'billing_api');
  assert.deepEqual(noBox.nodes.map((n) => n.id), ['web']);
  assert.equal(noBox.edges.length, 0, 'its arrows go with it');
  assert.equal(m.nodes.length, 2, 'the tools never change the model they get');
});

test('matchParts pairs each node with a part by its label, then by its id', () => {
  const m = parseFlow('flowchart LR\n  a["Orders and cart"]\n  payments[Billing]\n  x[Something else]');
  const parts = [{ id: 'orders', name: 'Orders and cart' }, { id: 'payments', name: 'Payments' }];
  assert.deepEqual([...matchParts(m, parts)], [['a', 'orders'], ['payments', 'payments']]);
});
