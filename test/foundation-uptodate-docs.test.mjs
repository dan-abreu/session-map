import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../server/foundation/uptodate-lines-docs.mjs';

const byId = Object.fromEntries(LINES.map((l) => [l.id, l]));
const run = (id, ctx) => byId[id].run(ctx);

const route = (method, path, file = 'src/routes.ts') => ({ id: `route:${method} ${path}`, kind: 'route', file, line: 3, origin: 'EXTRACTED', attrs: { method, path } });
const finding = (rule, extra = {}) => ({ id: `f:${rule}${extra.n ?? ''}`, rule, state: 'open', severity: 'important', target: { file: 'README.md', line: 2 }, evidence: [], ...extra });

// A project where everything agrees: every line must come out confirmed.
function good() {
  return {
    project: { arch: { parts: [{ id: 'orders', file: 'docs/architecture/orders.md', groups: [{ name: 'g', items: [{ code: 'o1', title: 'Orders', status: 'done', detail: ['Status: done'], line: 5 }] }] }] } },
    census: { files: [
      { path: 'README.md', included: true, kind: 'doc' },
      { path: 'openapi.yaml', included: true, kind: 'doc' },
      { path: 'package.json', included: true, kind: 'config' },
    ] },
    facts: { facts: [route('GET', '/orders'), { id: 'table:Order', kind: 'table', file: 'schema.prisma', line: 1, attrs: { source: 'prisma' } }] },
    versions: { code: { version: '1.0.0', file: 'package.json', line: 3 }, tag: 'v1.0.0', mismatch: false },
    findings: [],
    docs: [{ path: 'README.md', text: '# Shop\n![shot](docs/shot.png)\n' }],
    brokenLinks: [],
    apiSpecs: [{ path: 'openapi.yaml', routes: [{ method: 'GET', path: '/orders' }] }],
    now: '2026-10-10T10:00:00.000Z',
  };
}

test('catalog has the eight lines, groups 2 and 3, each with run()', () => {
  assert.deepEqual(LINES.map((l) => l.id), ['g2.cites', 'g2.links', 'g2.images', 'g2.api-docs', 'g2.db-docs', 'g3.versions', 'g3.numbers', 'g3.done-ticked']);
  for (const l of LINES) { assert.ok([2, 3].includes(l.group)); assert.equal(typeof l.run, 'function'); }
});

test('everything agreeing: every line is confirmed with evidence', () => {
  for (const l of LINES) {
    const r = l.run(good());
    assert.equal(r.state, 'confirmed', `${l.id}: ${JSON.stringify(r)}`);
    assert.ok(r.evidence.length > 0, l.id);
    assert.deepEqual(r.findingIds, []);
  }
});

const breaks = {
  'g2.cites': (c) => { c.findings = [finding('doc-cites-missing')]; },
  'g2.links': (c) => { c.brokenLinks = [{ file: 'README.md', line: 4, target: 'docs/gone.md', why: 'file-missing' }]; },
  'g2.images': (c) => { c.findings = [finding('stale-image')]; },
  'g2.api-docs': (c) => { c.apiSpecs[0].routes.push({ method: 'POST', path: '/refunds' }); },
  'g2.db-docs': (c) => { c.findings = [finding('code-without-doc', { evidence: [{ file: 'schema.prisma', line: 1, factId: 'table:Order' }] })]; },
  'g3.versions': (c) => { c.findings = [finding('version-mismatch')]; },
  'g3.numbers': (c) => { c.findings = [finding('docs-disagree', { what: { msg: 'watch.disagree.count', params: { claimed: 12, found: 14 } } })]; },
  'g3.done-ticked': (c) => { c.project.arch.parts[0].groups[0].items[0].status = 'todo'; },
};

test('breaking one thing turns exactly that line into a warning', () => {
  for (const [id, brk] of Object.entries(breaks)) {
    const c = good();
    brk(c);
    for (const l of LINES) {
      const r = l.run(c);
      if (l.id === id) {
        assert.equal(r.state, 'warning', `${id}: ${JSON.stringify(r)}`);
        assert.ok(r.evidence.length > 0, id);
      } else assert.equal(r.state, 'confirmed', `${id} broke ${l.id}: ${JSON.stringify(r)}`);
    }
  }
});

test('a warning cites the findings that caused it', () => {
  const c = good();
  c.findings = [finding('doc-cites-missing', { n: 1 }), finding('pointer-broken', { n: 2 }), finding('stale-image', { n: 3 })];
  assert.deepEqual(run('g2.cites', c).findingIds, ['f:doc-cites-missing1', 'f:pointer-broken2']);
  assert.deepEqual(run('g2.images', c).findingIds, ['f:stale-image3']);
});

test('findings the owner said never, or already applied, do not count', () => {
  const c = good();
  c.findings = [finding('doc-cites-missing', { state: 'never' }), finding('doc-cites-missing', { n: 2, state: 'applied' })];
  assert.equal(run('g2.cites', c).state, 'confirmed');
});

test('versions: the mismatch flag alone is enough, and the version file is the evidence', () => {
  const c = good();
  c.versions.mismatch = true;
  const r = run('g3.versions', c);
  assert.equal(r.state, 'warning');
  assert.equal(r.evidence[0].file, 'package.json');
});

test('a count disagreement is not a diagram disagreement', () => {
  const c = good();
  c.findings = [finding('docs-disagree', { what: { msg: 'watch.disagree.node', params: { node: 'Cart' } } })];
  assert.equal(run('g3.numbers', c).state, 'confirmed');
});

test('missing inputs are unverified/no-data, never warning', () => {
  const nulls = {
    'g2.cites': ['findings'], 'g2.links': ['brokenLinks'], 'g2.images': ['findings'], 'g2.api-docs': ['census'],
    'g2.db-docs': ['findings'], 'g3.versions': ['findings', 'versions'], 'g3.numbers': ['findings'], 'g3.done-ticked': ['project'],
  };
  for (const [id, keys] of Object.entries(nulls)) {
    const c = good();
    for (const k of keys) c[k] = null;
    const r = run(id, c);
    assert.equal(r.state, 'unverified', id);
    assert.equal(r.reason, 'no-data', id);
  }
  const c = good();
  c.apiSpecs = null;
  assert.equal(run('g2.api-docs', c).reason, 'no-data');
});

test('not applicable: no api spec, no tables, no images', () => {
  let c = good();
  c.census.files = c.census.files.filter((f) => f.path !== 'openapi.yaml');
  assert.equal(run('g2.api-docs', c).reason, 'not-applicable');
  c = good();
  c.facts.facts = c.facts.facts.filter((f) => f.kind !== 'table');
  assert.equal(run('g2.db-docs', c).reason, 'not-applicable');
  c = good();
  c.docs = [{ path: 'README.md', text: 'No pictures here.' }];
  assert.equal(run('g2.images', c).reason, 'not-applicable');
});

test('route paths compare with :id, {id} and [id] alike; ambiguous routes are skipped', () => {
  const c = good();
  c.facts.facts = [route('GET', '/orders/:id'), { id: 'route:x', kind: 'route', origin: 'AMBIGUOUS', file: 'a.ts', line: 1, attrs: { method: 'GET', path: null } }];
  c.apiSpecs[0].routes = [{ method: 'get', path: '/orders/{id}' }];
  assert.equal(run('g2.api-docs', c).state, 'confirmed');
});

test('done-ticked also catches "released in" and a request marked done but never confirmed', () => {
  const c = good();
  const item = c.project.arch.parts[0].groups[0].items[0];
  item.status = 'todo'; item.detail = ['Released in v1.0.0'];
  assert.equal(run('g3.done-ticked', c).state, 'warning');
  const d = good();
  d.project.arch.parts[0].groups[0].items.push(
    { code: 'r1', title: 'Ask', status: 'todo', detail: ['Asked: more orders', 'Status: planned', 'Where it went: `o1`'], line: 9 },
  );
  const r = run('g3.done-ticked', d);
  assert.equal(r.state, 'warning');
  assert.match(JSON.stringify(r.evidence), /r1/);
});

test('done-ticked leaves alone an item whose own status says it is not finished, even when it names a release', () => {
  const c = good();
  const item = c.project.arch.parts[0].groups[0].items[0];
  item.status = 'todo';
  item.detail = ['Status: in progress (`fl08` was released in v0.3.0; `fl07` is left)'];
  assert.notEqual(run('g3.done-ticked', c).state, 'warning', 'a partial release is not a finished item');
  item.detail = ['Status: done (released in v0.3.0)'];
  assert.equal(run('g3.done-ticked', c).state, 'warning', 'a done status on an unticked item still is');
});
