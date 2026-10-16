import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesModelOf } from '../server/foundation/modelview.mjs';
import { LINES } from '../server/foundation/uptodate-lines-code.mjs';

// fd25: there is one model, the Flow's. "Tudo em dia?" reads it through this shape: a box per part with its evidence, an arrow
// per pair of parts with the import lines behind it. Here the lines judge a Flow-shaped model made by hand.

const where = (file, line, via = 'readme') => ({ file, line, via });
const part = (id, extra = {}) => ({ id: `part:${id}`, kind: 'part', partId: id, name: id, level: 1, origin: 'declared', declared: [where(`docs/architecture/${id}.md`, 1, 'part-doc')], detected: [], ...extra });
const edge = (from, to, kind, declared, detected) => ({ id: `part:${from}>part:${to}#${kind}`, from: `part:${from}`, to: `part:${to}`, kind, declared, detected });
const imp = (file, line) => where(file, line, 'import');
const file = (path) => ({ path, included: true, sha: `sha-${path}`, owner: null, lines: { total: 50 }, kind: 'code', type: 'js' });

function flowModel() {
  return {
    version: 2,
    nodes: [
      part('web'), part('api'), part('db'),
      { id: 'actor:browser', kind: 'actor', partId: null, name: 'You', level: 1, declared: [], detected: [where('web/app.js', 3, 'listen')] },
      { id: 'svc:stripe', kind: 'service', partId: null, name: 'Stripe', level: 1, declared: [], detected: [where('api/pay.js', 1, 'sdk')] },
    ],
    edges: [
      edge('web', 'api', 'flow', [where('docs/architecture/README.md', 12)], [imp('web/app.js', 1), imp('web/app.js', 2)]),
      edge('api', 'db', 'flow', [where('docs/architecture/README.md', 13)], [imp('api/db.js', 1)]),
      { id: 'actor:browser>part:web#actor', from: 'actor:browser', to: 'part:web', kind: 'actor', declared: [], detected: [where('web/app.js', 3, 'listen')] },
    ],
  };
}
const census = { files: ['web/app.js', 'api/db.js', 'api/pay.js', 'docs/architecture/web.md'].map(file) };
const arch = (mermaid) => ({
  source: 'worktree', dir: 'docs/architecture', lang: 'en', mermaid, layers: [],
  parts: ['web', 'api', 'db'].map((id) => ({ id, name: id, file: `docs/architecture/${id}.md`, codePaths: [`${id}/`], groups: [] })),
});
const MERMAID = 'flowchart LR\n  web[web] --> api[api]\n  api --> db[db]\n';
const ctxOf = (model, mermaid = MERMAID) => ({ project: { id: 'p', arch: arch(mermaid) }, census, facts: { facts: [] }, model: linesModelOf(model, census), docs: [], now: '2026-10-16T10:00:00Z' });
const line = (id, ctx) => LINES.find((l) => l.id === id).run(ctx);

test('the Flow model becomes a box per part and an arrow per pair of parts with its import lines, and nothing else', () => {
  const view = linesModelOf(flowModel(), census);
  assert.deepEqual(view.nodes.map((n) => [n.id, n.partId, n.level, n.kind]), [['part:web', 'web', 3, 'component'], ['part:api', 'api', 3, 'component'], ['part:db', 'db', 3, 'component']]);
  assert.deepEqual(view.nodes[0].evidence, [{ file: 'docs/architecture/web.md', line: 1, sha: 'sha-docs/architecture/web.md' }]);
  assert.deepEqual(view.edges.map((e) => [e.from, e.to, e.kind, e.evidence.length]), [['part:web', 'part:api', 'imports', 2], ['part:api', 'part:db', 'imports', 1]]);
  assert.equal(view.edges[0].evidence[0].sha, 'sha-web/app.js');
  assert.equal(linesModelOf(null), null);
  assert.equal(linesModelOf({ nodes: 'x', edges: [] }), null);
  assert.equal(linesModelOf({ nodes: [part('a')], edges: [{ id: 'e', from: 'part:a', to: 'part:a', kind: 'flow', detected: [{ file: 'x', line: 'no', via: 'import' }] }] }).edges.length, 0, 'evidence with no line is not evidence');
});

test('golden rule: every part has its box in the model; a part the model does not draw breaks it', () => {
  assert.equal(line('g1.golden-rule', ctxOf(flowModel())).state, 'confirmed');
  const model = flowModel();
  model.nodes = model.nodes.filter((n) => n.partId !== 'db');
  assert.equal(line('g1.golden-rule', ctxOf(model)).state, 'warning');
});

test('drawn links against real imports: a drawn arrow with no import and a strong import with no arrow each break the line', () => {
  assert.equal(line('g1.links-imports', ctxOf(flowModel())).state, 'confirmed');
  const noImport = flowModel();
  noImport.edges[1].detected = [];
  assert.equal(line('g1.links-imports', ctxOf(noImport)).state, 'warning', 'api -> db is drawn and nothing imports it');
  const strong = flowModel();
  strong.edges.push(edge('web', 'db', 'uses', [], [imp('web/app.js', 5), imp('web/app.js', 6), imp('web/app.js', 7)]));
  assert.equal(line('g1.links-imports', ctxOf(strong)).state, 'warning', 'web imports db three times and nothing is drawn');
  const weak = flowModel();
  weak.edges.push(edge('web', 'db', 'uses', [], [imp('web/app.js', 5)]));
  assert.equal(line('g1.links-imports', ctxOf(weak)).state, 'confirmed', 'one undrawn import is not a warning');
});

test('with no model yet the lines say there is no data, not that the project is wrong', () => {
  const ctx = ctxOf(flowModel());
  ctx.model = null;
  assert.deepEqual(['g1.golden-rule', 'g1.links-imports'].map((id) => line(id, ctx).reason), ['no-data', 'no-data']);
});
