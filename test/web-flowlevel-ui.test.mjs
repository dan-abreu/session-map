import test from 'node:test';
import assert from 'node:assert/strict';
import { boxTitle, factRows, journeyChoices, legendKeys, levelNote } from '../server/web/flowlevel.js';
import { LANGS, translator } from '../server/web/i18n.js';

const en = translator('en');
const pt = translator('pt-BR');
const MODEL = {
  nodes: [
    { id: 'part:web', kind: 'part', name: 'Web', origin: 'declared', badges: ['declared'], declared: [{ file: 'docs/architecture/web.md', line: 1 }] },
    { id: 'actor:browser', kind: 'actor', nameKey: 'flow.l1.actor.browser', name: 'x', origin: 'detected', badges: ['detected'], detected: [{ file: 'server/main.mjs', line: 585 }] },
    { id: 'svc:git', kind: 'service', where: 'this-pc', nameKey: 'flow.l1.svc.git', origin: 'detected', badges: ['detected'], detected: [{ file: 'a.mjs', line: 3 }, { file: 'b.mjs', line: 4 }] },
  ],
  edges: [
    { id: 'e1', from: 'actor:browser', to: 'part:web', kind: 'actor', label: { key: 'flow.l1.lbl.browser' }, origin: 'detected', badges: ['detected'], detected: [{ file: 'server/main.mjs', line: 585 }] },
    { id: 'e2', from: 'part:web', to: 'svc:git', kind: 'service', label: { key: 'flow.l1.lbl.git' }, origin: 'declared', badges: ['declared', 'detected'], declared: [{ file: 'docs/architecture/README.md', line: 9 }], detected: [{ file: 'a.mjs', line: 3 }] },
    { id: 'e3', from: 'part:web', to: 'svc:git', kind: 'uses', label: { key: 'flow.l1.lbl.uses' }, hidden: true },
  ],
  journeys: [{ id: 'j1', nameKey: 'flow.l1.journey.from', args: { node: 'actor:browser' } }, { id: 'j2', name: 'Order' }],
};
const META = {
  nodes: new Map([
    ['WB', { nodeId: 'part:web', kind: 'part', origin: 'declared', badges: ['declared'], evidence: [{ file: 'docs/architecture/web.md', line: 1 }] }],
    ['B', { nodeId: 'actor:browser', kind: 'actor', origin: 'detected', badges: ['detected'], evidence: [{ file: 'server/main.mjs', line: 585 }] }],
    ['G', { nodeId: 'svc:git', kind: 'service', where: 'this-pc', origin: 'detected', badges: ['detected'], evidence: [{ file: 'a.mjs', line: 3 }] }],
  ]),
  edges: [{ edgeId: 'e1' }, { edgeId: 'e2' }],
};

test('the general view legend is fixed: always the same items, parts level keeps its own', () => {
  const one = legendKeys('1');
  assert.deepEqual(one, legendKeys('1'));
  for (const k of ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'actor', 'svc', 'local', 'declared', 'detected']) assert.ok(one.includes(k), k);
  assert.deepEqual(legendKeys('parts'), ['live', 'doing', 'todo', 'done', 'blocks', 'waiting', 'free']);
  for (const lang of ['en', 'pt-BR']) for (const k of new Set([...one, ...legendKeys('parts')])) {
    const key = ['blocks', 'waiting'].includes(k) ? `flow.flag.${k}` : ['declared', 'detected'].includes(k) ? `flow.arrow.${k}` : `flow.tone.${k}`;
    assert.ok(LANGS[lang][key], `${lang} ${key}`);
  }
});

test('journey choices come from the model; none gives an empty list', () => {
  assert.deepEqual(journeyChoices(MODEL, en), [{ id: 'j1', label: 'From You, in the browser' }, { id: 'j2', label: 'Order' }]);
  assert.match(journeyChoices(MODEL, pt)[0].label, /Você, no navegador/);
  assert.deepEqual(journeyChoices({ ...MODEL, journeys: [] }, en), []);
  assert.deepEqual(journeyChoices({}, en), []);
});

test('facts list: every drawn box and arrow with words, origin and file:line; hidden arrows only when drawn', () => {
  const rows = factRows(MODEL, META, en);
  assert.equal(rows.length, 5);
  const git = rows.find((r) => r.text === 'Version history');
  assert.deepEqual(git.badges, ['seen in the code']);
  assert.deepEqual(git.evidence, ['a.mjs:3']);
  const arrow = rows.find((r) => r.type === 'arrow' && r.text.startsWith('Web'));
  assert.equal(arrow.text, 'Web → Version history');
  assert.equal(arrow.label, 'lines of work, saved changes and what changed');
  assert.deepEqual(arrow.badges, ['on the map’s main page', 'seen in the code']);
  assert.deepEqual(arrow.evidence, ['docs/architecture/README.md:9', 'a.mjs:3']);
});

test('box hover title says what it is, where it came from and one place in the code', () => {
  const info = META.nodes.get('G');
  assert.equal(boxTitle(info, 'Version history', en), 'Version history · on this computer · seen in the code · a.mjs:3');
  assert.match(boxTitle(META.nodes.get('B'), 'Você', pt), /^Você · quem usa · visto no código · server\/main\.mjs:585$/);
  assert.equal(boxTitle(META.nodes.get('WB'), 'Web', en), 'Web · part of the map · on the map’s main page · docs/architecture/web.md:1');
});

test('level note: arrows not described yet are counted in plain words', () => {
  assert.equal(levelNote({ missing: 0 }, en), '');
  assert.match(levelNote({ missing: 3 }, en), /3/);
  assert.match(levelNote({ missing: 1 }, pt), /1/);
});
