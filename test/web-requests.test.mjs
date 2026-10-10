import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestsOf, REQUEST_STATES } from '../server/web/requests.js';

// The owner's requests (id74 follow-up, id76): read from the parts whose items carry an "Asked" line, with the state of
// the items each request became, so the page can show what was asked, what is being done, what will be and what is done.
const item = (code, title, detail, status = 'todo') => ({ code, title, detail, status });
const project = (parts) => ({ arch: { parts } });

const registry = {
  id: 'ideas', name: 'Ideas and requests', groups: [{ name: 'The Flow', items: [
    item('id45', 'A Flow you can draw by hand', [
      'Asked: 2026-10-09 16:20 — "tem que ser um power point ali"; 2026-10-10 04:50 — "não dá para mexer"',
      'What it means: drag boxes and arrows, kept in step with the map.',
      'How to confirm it is done: drag a box and the map follows.',
      'Where it went: `fl15`, `fl07`.',
      'Status: accepted.',
    ]),
    item('id46', 'The project chats', [
      'Asked: 2026-10-09 ~23:30 — paraphrased: a general chat about the whole project.',
      'Where it went: `or13`.',
      'Status: done (released in v0.2.4, with the screenshots approved by the owner).',
    ], 'done'),
    item('id47', 'Reading every file', ['Asked: 2026-10-09 18:00 — "tem que ler tudo"', 'Where it went: `fd01`.', 'Status: in progress (census first).']),
    item('id48', 'Make money with it', ['Asked: 2026-10-09 00:35 — "Da pra ganhar um dinheirinho com isso?"', 'Status: later (thinking aloud).']),
    item('id49', 'Cells that merge', ['Asked: 2026-10-08 20:00 — "a celula se unifica"', 'Status: discarded (the cells left the map in v0.2.0).'], 'done'),
    item('id50', 'Merged, not released', ['Asked: 2026-10-10 05:00 — "x"', 'Where it went: `fl07`.', 'Status: done (on main).'], 'done'),
  ] }],
};
const flow = { id: 'flow', name: 'Flow', groups: [{ name: '', items: [
  item('fl15', 'Draw mode', [], 'todo'), item('fl07', 'One model', [], 'todo'), item('or13', 'Project chats', [], 'done'),
] }] };
const plainPart = { id: 'site', name: 'Site', groups: [{ name: '', items: [item('si01', 'A page', ['Some detail'])] }] };

test('only items with an "Asked" line are requests, from any part; the rest of the map is left alone', () => {
  const out = requestsOf(project([registry, flow, plainPart]));
  assert.deepEqual(out.list.map((r) => r.code), ['id45', 'id46', 'id47', 'id48', 'id49', 'id50']);
  assert.equal(requestsOf(project([plainPart])).list.length, 0);
  assert.equal(requestsOf({}).list.length, 0, 'a project with no map has no requests');
});

test('each request keeps every date and the owner\'s words, and what it means and how to confirm it', () => {
  const [flowReq, chats] = requestsOf(project([registry, flow])).list;
  assert.deepEqual(flowReq.asked, [
    { date: '2026-10-09', time: '16:20', words: 'tem que ser um power point ali' },
    { date: '2026-10-10', time: '04:50', words: 'não dá para mexer' },
  ]);
  assert.equal(flowReq.meaning, 'drag boxes and arrows, kept in step with the map.');
  assert.equal(flowReq.confirm, 'drag a box and the map follows.');
  assert.deepEqual(chats.asked, [{ date: '2026-10-09', time: '~23:30', words: 'paraphrased: a general chat about the whole project.' }]);
});

test('the state comes from the Status line: being done, will be done, later, done (with its version) or dropped', () => {
  const byCode = Object.fromEntries(requestsOf(project([registry, flow])).list.map((r) => [r.code, r]));
  assert.equal(byCode.id45.state, 'planned');
  assert.equal(byCode.id47.state, 'doing');
  assert.equal(byCode.id48.state, 'later');
  assert.equal(byCode.id49.state, 'dropped');
  assert.equal(byCode.id46.state, 'done');
  assert.equal(byCode.id46.version, 'v0.2.4');
  assert.equal(byCode.id50.version, null);
  assert.equal(byCode.id50.unreleased, true, '"on main" is done but not published yet');
  assert.equal(byCode.id49.note, 'the cells left the map in v0.2.0', 'the reason in brackets is kept');
  assert.deepEqual(REQUEST_STATES, ['doing', 'planned', 'later', 'done', 'dropped']);
});

test('where it went: each item with its live state, and how many of them are done', () => {
  const req = requestsOf(project([registry, flow])).list[0];
  assert.deepEqual(req.went.map((w) => [w.code, w.status, w.title, w.partId]), [['fl15', 'todo', 'Draw mode', 'flow'], ['fl07', 'todo', 'One model', 'flow']]);
  assert.deepEqual(req.progress, { done: 0, total: 2 });
  const merged = requestsOf(project([registry, flow])).list.find((r) => r.code === 'id47');
  assert.deepEqual(merged.went, [{ code: 'fd01', status: null, title: null, partId: null, who: null }], 'an item not on the map yet still shows its code');
});

test('a request whose items are all moving says it is being done, even if its Status line was not updated', () => {
  const moved = { ...flow, groups: [{ name: '', items: [item('fl15', 'Draw mode', [], 'doing'), item('fl07', 'One model', [], 'done')] }] };
  assert.equal(requestsOf(project([registry, moved])).list[0].state, 'doing');
});

test('the counts per state add up, and the Portuguese labels of a registry written in Portuguese are read too', () => {
  const out = requestsOf(project([registry, flow]));
  assert.deepEqual(out.counts, { doing: 1, planned: 1, later: 1, done: 2, dropped: 1 });
  const pt = { id: 'pedidos', name: 'Pedidos', groups: [{ name: '', items: [item('pe01', 'Painel de pedidos', [
    'Pedido: 2026-10-10 05:10 — "enxergar os meus pedidos"', 'O que significa: uma aba com tudo o que pedi.', 'Como conferir: abrir a aba.', 'Onde foi: `pa03`.', 'Situação: em andamento.',
  ])] }] };
  const [r] = requestsOf(project([pt])).list;
  assert.equal(r.state, 'doing');
  assert.equal(r.meaning, 'uma aba com tudo o que pedi.');
  assert.deepEqual(r.asked, [{ date: '2026-10-10', time: '05:10', words: 'enxergar os meus pedidos' }]);
});

test('a request waits for the owner when one of its open items is his, and one with no item yet is flagged', () => {
  const mine = { ...flow, groups: [{ name: '', items: [{ ...item('fl15', 'Draw mode', [], 'todo'), who: 'Ana' }, item('fl07', 'One model', [], 'todo')] }] };
  const out = requestsOf(project([registry, mine])).list;
  assert.equal(out.find((r) => r.code === 'id45').waiting, true);
  assert.equal(out.find((r) => r.code === 'id47').waiting, false);
  const lone = { id: 'r', name: 'R', groups: [{ name: '', items: [item('id90', 'Nothing yet', ['Asked: 2026-10-10 05:00 — "x"', 'Where it went: not yet an item.', 'Status: accepted.'])] }] };
  const [r] = requestsOf(project([lone])).list;
  assert.equal(r.noActivity, true);
  assert.equal(out.find((x) => x.code === 'id46').noActivity, false, 'a done request is never flagged');
});

test('a request pointing at a code that another request also uses gets the map item, never the request', () => {
  const reg = { id: 'r', name: 'R', groups: [{ name: '', items: [
    item('pe01', 'A request with a clashing code', ['Asked: 2026-10-10 05:00 — "x"', 'Status: accepted.']),
    item('rq02', 'Another', ['Asked: 2026-10-10 05:01 — "y"', 'Where it went: `pe01`.', 'Status: accepted.']),
  ] }] };
  const orders = { id: 'orders', name: 'Orders', groups: [{ name: '', items: [item('pe01', 'Who gets each order', [], 'doing')] }] };
  const r = requestsOf(project([orders, reg])).list.find((x) => x.code === 'rq02');
  assert.deepEqual([r.went[0].title, r.went[0].partId], ['Who gets each order', 'orders']);
});

test('the map leaves out the registry of requests (the Requests tab shows it) but keeps the operation part', async () => {
  const { archTree } = await import('../server/web/tree.js');
  const proj = { name: 'shop', arch: {
    layers: [{ id: 'a', name: 'App', partIds: ['flow'] }, { id: 'local', name: 'Requests and operation', partIds: ['ideas', 'operation'] }],
    parts: [{ ...flow }, { ...registry, role: 'requests' }, { id: 'operation', name: 'Operation', role: 'operation', groups: [{ name: '', items: [item('op01', 'Look at the list', [])] }] }],
  } };
  const tree = archTree(proj);
  assert.deepEqual(tree.children.map((l) => [l.label, l.children.map((p) => p.label)]), [['App', ['Flow']], ['Requests and operation', ['Operation']]]);
});

test('the page has the Requests tab, second after the map, wired to its view', async () => {
  const { readFileSync } = await import('node:fs');
  const web = new URL('../server/web/', import.meta.url);
  const html = readFileSync(new URL('index.html', web), 'utf8');
  const app = readFileSync(new URL('app.js', web), 'utf8');
  assert.ok(html.indexOf('id="tab-map"') < html.indexOf('id="tab-requests"') && html.indexOf('id="tab-requests"') < html.indexOf('id="tab-flow"'));
  assert.ok(html.includes('<section id="view-requests"'));
  assert.match(app, /const VIEWS = \['map', 'requests',/);
  assert.match(app, /requestsView\.render\(\$\('#view-requests'\)\)/);
  assert.match(app, /openItem: openRequestItem/);
});
