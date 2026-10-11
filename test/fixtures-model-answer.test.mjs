import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The answer keys of the model (fd03) and the planted false claims (fd04). Nothing here runs the model or the checker:
// the model (B2-T3) and the checker (B2-T4) are written by other hands and measured against these files. This test only
// proves the files tell the truth about the fixtures: every evidence is a real file, a real line and the text on it, every
// fact id is one of the reading answer key, and every planted claim fails for the one reason it says and no other.
const REPOS = join(import.meta.dirname, 'fixtures', 'repos');
const CLAIMS = join(import.meta.dirname, 'fixtures', 'claims');
const NAMES = ['acme-shop', 'acme-delivery'];
const ORIGINS = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'DECLARED']);
const NODE_KINDS = { system: 1, person: 1, external: 1, container: 2, component: 3 };
const EDGE_KINDS = new Set(['imports', 'calls', 'http', 'reads', 'writes', 'enqueues', 'consumes', 'uses']);
const MANIFESTS = new Set(['package.json', 'pubspec.yaml', 'composer.json']);
const ROOT_DIRS = new Set(['src', 'lib', 'app', 'routes']);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|dart|php|prisma)$/;
const REASONS = ['unknown-id', 'no-cite', 'file-missing', 'line-out', 'stale-sha', 'quote-mismatch', 'fact-mismatch'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const factsOf = (name) => readJson(join(REPOS, `${name}.answer.json`));
const modelOf = (name) => readJson(join(REPOS, `${name}.model-answer.json`));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const sha16 = (name, file) => createHash('sha256').update(readFileSync(join(REPOS, name, file))).digest('hex').slice(0, 16);
function linesOf(name, file) {
  const path = join(REPOS, name, file);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
function factIndex(answer) {
  const byId = new Map();
  for (const f of [...answer.facts, ...(answer.extraFacts ?? [])]) byId.set(f.id, f);
  return byId;
}
// Where a fact may be cited: its definition and every place listed in refs.
const placesOf = (fact) => [{ file: fact.file, line: fact.line }, ...(fact.refs ?? [])];

// What is wrong with an evidence list, as text. The empty list is the pass.
function evidenceProblems(name, owner, evidence, facts) {
  const out = [];
  if (!Array.isArray(evidence) || evidence.length === 0) return [`${owner}: no evidence`];
  for (const e of evidence) {
    const where = `${owner} -> ${e.file}:${e.line}`;
    const lines = linesOf(name, e.file);
    if (!lines) { out.push(`${where}: file does not exist`); continue; }
    if (!Number.isInteger(e.line) || e.line < 1 || e.line > lines.length) { out.push(`${where}: line is outside the file`); continue; }
    if (!e.needle || !lines[e.line - 1].includes(e.needle)) out.push(`${where}: line does not hold ${JSON.stringify(e.needle)}`);
    if (e.factId !== undefined) {
      const fact = facts.get(e.factId);
      if (!fact) out.push(`${where}: unknown fact ${e.factId}`);
      else if (!placesOf(fact).some((p) => p.file === e.file && p.line === e.line)) out.push(`${where}: ${e.factId} is not at this place`);
    }
  }
  return out;
}

const containerDirs = (answer) => [...new Set(Object.keys(answer.owners).filter((p) => p.includes('/') && MANIFESTS.has(p.split('/').at(-1))).map((p) => p.slice(0, p.lastIndexOf('/'))))].sort();
const containerOf = (dirs, file) => dirs.filter((d) => file.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
// The fixed-depth rule of the decision 6, written again here so the key is checked against its own words.
function componentOf(dir, file) {
  const rel = file.slice(dir.length + 1).split('/');
  let base = '';
  if (rel.length > 1 && ROOT_DIRS.has(rel[0])) base = `${rel.shift()}/`;
  return rel.length === 1 ? `cmp:${dir}#root` : `cmp:${dir}/${base}${rel[0]}`;
}
const sourceFiles = (answer) => Object.keys(answer.owners).filter((p) => SOURCE.test(p) && !p.startsWith('docs/'));

for (const name of NAMES) {
  const facts = factsOf(name);
  const byId = factIndex(facts);
  const model = modelOf(name);
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const dirs = containerDirs(facts);

  test(`${name}: nodes and edges have the shape of the contract`, () => {
    assert.equal(nodes.size, model.nodes.length, 'node ids are unique');
    assert.equal(new Set(model.edges.map((e) => e.id)).size, model.edges.length, 'edge ids are unique');
    assert.deepEqual(model.nodes.filter((n) => n.id === 'sys').map((n) => [n.level, n.kind, n.parentId]), [[1, 'system', null]]);
    for (const n of model.nodes) {
      assert.equal(NODE_KINDS[n.kind], n.level, `${n.id}: level of a ${n.kind}`);
      if (n.id === 'sys') continue;
      assert.ok(ORIGINS.has(n.origin), `${n.id}: origin`);
      assert.ok(n.name, `${n.id}: name`);
      if (n.kind === 'container') assert.equal(n.parentId, 'sys', n.id);
      else if (n.kind === 'component') assert.equal(nodes.get(n.parentId)?.kind, 'container', n.id);
      else assert.equal(n.parentId, null, n.id);
    }
    for (const e of model.edges) {
      assert.equal(e.id, `${e.from}->${e.to}:${e.kind}`);
      assert.ok(nodes.has(e.from) && nodes.has(e.to), `${e.id}: both ends exist`);
      assert.notEqual(e.from, e.to, `${e.id}: no loop`);
      assert.ok(EDGE_KINDS.has(e.kind), e.id);
      assert.equal(e.label.msg, `edge.${e.kind}`, e.id);
      assert.ok(ORIGINS.has(e.origin), `${e.id}: origin`);
    }
  });

  test(`${name}: every node but the system and every edge has evidence that is a real file, line and text`, () => {
    const problems = [];
    for (const n of model.nodes) if (n.id !== 'sys') problems.push(...evidenceProblems(name, n.id, n.evidence, byId));
    for (const e of model.edges) problems.push(...evidenceProblems(name, e.id, e.evidence, byId));
    assert.deepEqual(problems, []);
  });

  test(`${name}: the checker of evidence is not blind (a moved line, a missing file and an unknown fact are caught)`, () => {
    const good = model.nodes.find((n) => n.kind === 'container').evidence[0];
    assert.deepEqual(evidenceProblems(name, 'x', [good], byId), []);
    assert.equal(evidenceProblems(name, 'x', [{ ...good, line: 9999 }], byId).length, 1);
    assert.equal(evidenceProblems(name, 'x', [{ ...good, file: 'nope/missing.ts' }], byId).length, 1);
    assert.equal(evidenceProblems(name, 'x', [{ ...good, needle: 'text that is not there' }], byId).length, 1);
    assert.equal(evidenceProblems(name, 'x', [{ ...good, factId: 'route:GET /nothing' }], byId).length, 1);
    assert.equal(evidenceProblems(name, 'x', [], byId).length, 1);
  });

  test(`${name}: the containers are the manifests below the root, each shown by its own manifest`, () => {
    const found = model.nodes.filter((n) => n.kind === 'container');
    assert.deepEqual(found.map((n) => n.id).sort(), dirs.map((d) => `ctr:${d}`));
    for (const n of found) {
      const dir = n.id.slice(4);
      assert.deepEqual(n.files, [`${dir}/`]);
      assert.equal(n.name, dir.split('/').at(-1));
      assert.equal(n.origin, 'EXTRACTED');
      assert.ok(MANIFESTS.has(n.evidence[0].file.split('/').at(-1)) && n.evidence[0].file.startsWith(`${dir}/`), `${n.id}: evidence is its manifest`);
    }
  });

  test(`${name}: the components are exactly the folders the fixed-depth rule gives, with every source file as evidence`, () => {
    const want = new Map();
    for (const file of sourceFiles(facts)) {
      const dir = containerOf(dirs, file);
      if (!dir) continue;
      const id = componentOf(dir, file);
      want.set(id, [...(want.get(id) ?? []), file]);
    }
    const found = model.nodes.filter((n) => n.kind === 'component');
    assert.deepEqual(found.map((n) => n.id).sort(), [...want.keys()].sort());
    for (const n of found) {
      assert.deepEqual(n.evidence.map((e) => e.file).sort(), want.get(n.id).sort(), n.id);
      assert.equal(n.parentId, `ctr:${containerOf(dirs, n.evidence[0].file)}`, n.id);
      assert.equal(n.origin, 'INFERRED', n.id);
      const owners = new Set(n.evidence.map((e) => facts.owners[e.file] ?? null));
      assert.equal(owners.size, 1, `${n.id}: one owner in the fixtures, so no AMBIGUOUS component`);
      assert.equal(n.partId ?? null, [...owners][0], `${n.id}: partId is the owner of its files`);
    }
  });

  test(`${name}: the golden rule lists are what the key says and follow from the owners`, () => {
    const comps = model.nodes.filter((n) => n.kind === 'component');
    const withPart = new Set(comps.map((n) => n.partId).filter(Boolean));
    const parts = new Set(Object.values(facts.owners).filter(Boolean));
    assert.deepEqual(model.goldenRule.partsWithoutNode, [...parts].filter((p) => !withPart.has(p)).sort());
    assert.deepEqual(model.goldenRule.nodesWithoutPart, comps.filter((n) => !n.partId).map((n) => n.id).sort());
  });

  test(`${name}: the import edges are the project import facts grouped by component, with the count`, () => {
    const comp = (file) => { const dir = containerOf(dirs, file); return dir && SOURCE.test(file) ? componentOf(dir, file) : null; };
    const want = new Map();
    for (const f of byId.values()) {
      if (f.kind !== 'import') continue;
      const [from, to] = [comp(f.file), comp(f.id.split('->')[1])];
      if (!from || !to || from === to) continue;
      const id = `${from}->${to}:imports`;
      const hit = want.get(id) ?? { count: 0, places: [] };
      hit.count++;
      hit.places.push(`${f.file}:${f.line}`);
      want.set(id, hit);
    }
    const got = model.edges.filter((e) => e.kind === 'imports');
    assert.deepEqual(got.map((e) => e.id).sort(), [...want.keys()].sort());
    for (const e of got) {
      assert.equal(e.origin, 'EXTRACTED', e.id);
      assert.deepEqual(e.label.params, { count: want.get(e.id).count }, e.id);
      assert.deepEqual(e.evidence.map((v) => `${v.file}:${v.line}`).sort(), want.get(e.id).places.sort(), e.id);
    }
  });

  test(`${name}: the outside world is the integrations, the queues and the database the facts show, and nothing else`, () => {
    const externals = model.nodes.filter((n) => n.kind === 'external').map((n) => n.id).sort();
    const want = new Set();
    for (const f of byId.values()) {
      if (f.kind === 'integration') want.add(`ext:${f.attrs.package ?? f.attrs.host}`);
      if (f.kind === 'queue') want.add(`ext:queue:${f.id.slice(6)}`);
      if (f.kind === 'table') want.add('ext:db');
    }
    assert.deepEqual(externals, [...want].sort());
    const toExternal = model.edges.filter((e) => e.to.startsWith('ext:'));
    assert.ok(toExternal.every((e) => e.from.startsWith('ctr:')), 'the outside is reached from a container');
    for (const f of byId.values()) {
      if (f.kind !== 'integration') continue;
      const id = `${containerOf(dirs, f.file) && `ctr:${containerOf(dirs, f.file)}`}->ext:${f.attrs.package ?? f.attrs.host}:uses`;
      assert.ok(model.edges.some((e) => e.id === id), `${f.id} gives ${id}`);
    }
  });

  test(`${name}: a person exists for each container with an app someone opens (a server view is not one) and has no other edge`, () => {
    const withScreens = new Set();
    for (const f of byId.values()) if (f.kind === 'screen' && f.attrs.framework !== 'blade') withScreens.add(containerOf(dirs, f.file));
    const persons = model.nodes.filter((n) => n.kind === 'person');
    assert.deepEqual(persons.map((n) => n.id).sort(), [...withScreens].map((d) => `person:${d.split('/').at(-1)}`).sort());
    for (const p of persons) {
      assert.equal(p.origin, 'INFERRED');
      assert.ok(p.evidence.every((e) => byId.get(e.factId)?.kind === 'screen'), `${p.id}: evidence is screens`);
      const edges = model.edges.filter((e) => e.from === p.id || e.to === p.id);
      assert.deepEqual(edges.map((e) => e.id), [`${p.id}->ctr:${containerOf(dirs, p.evidence[0].file)}:uses`]);
      assert.equal(edges[0].label.params.count, p.evidence.length);
    }
  });

  test(`${name}: what must not be drawn is not drawn`, () => {
    assert.ok(Array.isArray(model.forbidden) && model.forbidden.length >= 1);
    const ids = new Set([...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id)]);
    for (const id of model.forbidden) assert.ok(!ids.has(id), `${id} is a made-up thing`);
    assert.ok(!model.edges.some((e) => e.kind === 'http'), 'no URL of the project matches a route of another container in this fixture');
    assert.ok(model.notes.length >= 3);
  });
}

test('acme-shop: the one component with no part is the admin app, which the architecture does not own', () => {
  const m = modelOf('acme-shop');
  assert.deepEqual(m.goldenRule, { partsWithoutNode: [], nodesWithoutPart: ['cmp:apps/admin/pages'] });
  assert.deepEqual(modelOf('acme-delivery').goldenRule, { partsWithoutNode: [], nodesWithoutPart: [] });
});

test('acme-shop: the key keeps the shapes the model builder was told, in a few spot checks', () => {
  const m = modelOf('acme-shop');
  const edge = (id) => m.edges.find((e) => e.id === id);
  assert.deepEqual(edge('ctr:packages/adapters->ext:stripe:uses').label, { msg: 'edge.uses', params: { via: 'sdk', name: 'stripe' } });
  assert.deepEqual(edge('ctr:apps/worker->ext:queue:emails:enqueues').label, { msg: 'edge.enqueues', params: { queue: 'emails' } });
  assert.deepEqual(edge('ctr:packages/db->ext:db:uses').label, { msg: 'edge.uses', params: { via: 'db' } });
  assert.equal(m.nodes.find((n) => n.id === 'ctr:apps/web').tech, 'next-app');
  assert.equal(m.nodes.find((n) => n.id === 'ctr:packages/adapters').tech, null);
});

// ---- planted claims ----

const claimsFile = readJson(join(CLAIMS, 'acme-shop.claims.json'));
const vocabulary = () => {
  const ids = new Set([...modelOf('acme-shop').nodes.map((n) => n.id), ...modelOf('acme-shop').edges.map((e) => e.id)]);
  for (const id of factIndex(factsOf('acme-shop')).keys()) ids.add(id);
  return ids;
};
const entry = (reason) => claimsFile.claims.find((c) => c.expect.reason === reason && c.expect.verdict === 'rejected');
const shaNow = (file) => (linesOf('acme-shop', file) ? sha16('acme-shop', file) : null);
const quoteFound = (cite) => {
  const lines = linesOf('acme-shop', cite.file);
  if (!lines) return false;
  const near = lines.slice(Math.max(0, cite.line - 3), cite.line + 2).join(' ');
  return norm(near).includes(norm(cite.quote));
};

test('claims: twelve, four true and eight planted, every planted one for a different reason', () => {
  const list = claimsFile.claims;
  assert.equal(list.length, 12);
  assert.deepEqual(list.filter((c) => !c.planted).map((c) => c.expect.verdict), ['approved', 'approved', 'approved', 'approved']);
  assert.equal(list.filter((c) => c.planted).length, 8);
  assert.ok(list.filter((c) => c.planted).every((c) => c.expect.verdict !== 'approved'));
  const reasons = list.filter((c) => c.planted).map((c) => c.expect.reason).sort();
  assert.deepEqual(reasons, [...REASONS, 'disagreement'].sort());
  assert.equal(new Set(list.map((c) => c.claim.id)).size, 12);
  assert.deepEqual([...new Set(list.filter((c) => !c.planted).map((c) => c.expect.badge))].sort(), ['confirmed', 'interpretation', 'not-found']);
});

test('claims: each claim has the fields of the contract, texts in two languages, and no output field of the checker', () => {
  for (const { claim } of claimsFile.claims) {
    assert.match(claim.id, /^claim:/);
    assert.ok(['fact', 'explain', 'not-found'].includes(claim.type), claim.id);
    assert.ok(claim.text.en && claim.text['pt-BR'], claim.id);
    assert.ok(Array.isArray(claim.cites) && Array.isArray(claim.factIds) && typeof claim.important === 'boolean', claim.id);
    for (const field of ['badge', 'hashAtCheck', 'checkedAt', 'run', 'origin']) assert.ok(!(field in claim), `${claim.id}: ${field} belongs to the checker`);
    for (const c of claim.cites) assert.ok(c.file && Number.isInteger(c.line) && c.quote && c.sha, `${claim.id}: a cite carries file, line, quote and the sha the program recorded`);
  }
});

test('claims: the true ones cite a real file, a line that is there, the quote near it, the sha of today, and known ids', () => {
  const known = vocabulary();
  for (const { claim, planted } of claimsFile.claims.filter((c) => !c.planted)) {
    assert.ok(!planted);
    assert.ok(known.has(claim.about), `${claim.id}: about`);
    for (const id of claim.factIds) assert.ok(known.has(id), `${claim.id}: ${id}`);
    if (claim.type !== 'not-found') assert.ok(claim.cites.length >= 1, `${claim.id}: cites`);
    for (const c of claim.cites) {
      const lines = linesOf('acme-shop', c.file);
      assert.ok(lines && c.line >= 1 && c.line <= lines.length, `${claim.id}: ${c.file}:${c.line}`);
      assert.ok(quoteFound(c), `${claim.id}: quote`);
      assert.equal(c.sha, shaNow(c.file), `${claim.id}: sha`);
    }
  }
});

test('claims: a true fact claim repeats the line of its fact, a true not-found claim is really not found', () => {
  const facts = factIndex(factsOf('acme-shop'));
  const fact = claimsFile.claims.find((c) => !c.planted && c.claim.type === 'fact').claim;
  const numbers = (fact.text.en.match(/\d+/g) ?? []).map(Number);
  assert.deepEqual(numbers, [facts.get(fact.factIds[0]).line]);
  const none = claimsFile.claims.find((c) => !c.planted && c.expect.badge === 'not-found').claim;
  assert.equal(none.type, 'not-found');
  assert.ok(!facts.has('route:DELETE /v1/orders/:id'), 'the route the claim says is missing is not a fact');
});

test('claims: unknown-id names an id nobody has', () => {
  const { claim } = entry('unknown-id');
  const known = vocabulary();
  assert.ok(!known.has(claim.about) || claim.factIds.some((id) => !known.has(id)));
});

test('claims: no-cite is a fact or explain without any citation', () => {
  const { claim } = entry('no-cite');
  assert.ok(claim.type !== 'not-found' && claim.cites.length === 0);
});

test('claims: file-missing cites a file that is not in the fixture', () => {
  const { claim } = entry('file-missing');
  assert.ok(claim.cites.some((c) => linesOf('acme-shop', c.file) === null));
});

test('claims: line-out cites a real file at a line past its end, with the sha of today', () => {
  const { claim } = entry('line-out');
  for (const c of claim.cites) {
    const lines = linesOf('acme-shop', c.file);
    assert.ok(lines && c.line > lines.length);
    assert.equal(c.sha, shaNow(c.file));
  }
});

test('claims: stale-sha is right in every way but the sha, which is not the one of today', () => {
  const { claim } = entry('stale-sha');
  for (const c of claim.cites) {
    const lines = linesOf('acme-shop', c.file);
    assert.ok(lines && c.line <= lines.length && quoteFound(c));
  }
  assert.ok(claim.cites.some((c) => c.sha !== shaNow(c.file)));
});

test('claims: quote-mismatch cites a real line with the sha of today, but the quote is not within two lines of it', () => {
  const { claim } = entry('quote-mismatch');
  for (const c of claim.cites) {
    const lines = linesOf('acme-shop', c.file);
    assert.ok(lines && c.line <= lines.length);
    assert.equal(c.sha, shaNow(c.file));
  }
  assert.ok(claim.cites.some((c) => !quoteFound(c)));
});

test('claims: fact-mismatch passes every check of the citation and only the number in the text is wrong', () => {
  const { claim } = entry('fact-mismatch');
  const facts = factIndex(factsOf('acme-shop'));
  const known = vocabulary();
  assert.equal(claim.type, 'fact');
  assert.ok(known.has(claim.about) && claim.factIds.length === 1 && facts.has(claim.factIds[0]));
  for (const c of claim.cites) assert.ok(quoteFound(c) && c.sha === shaNow(c.file));
  const numbers = (claim.text.en.match(/\d+/g) ?? []).map(Number);
  assert.ok(numbers.length >= 1 && !numbers.includes(facts.get(claim.factIds[0]).line));
});

test('claims: the important ones carry the readings; the true one agrees, the planted one has two readers who disagree', () => {
  const important = claimsFile.claims.filter((c) => c.claim.important);
  assert.equal(important.length, 2);
  for (const c of important) {
    assert.equal(c.readings.filter((r) => r.role === 'reader').length, 2, c.claim.id);
    assert.equal(c.readings.filter((r) => r.role === 'adversary').length, 1, c.claim.id);
    assert.ok(c.readings.every((r) => (r.role === 'reader' ? r.about && Array.isArray(r.factIds) : Array.isArray(r.rejects))), c.claim.id);
  }
  const [a, b] = important.find((c) => c.planted).readings.filter((r) => r.role === 'reader');
  assert.notDeepEqual([a.about, a.factIds], [b.about, b.factIds]);
  const [x, y] = important.find((c) => !c.planted).readings.filter((r) => r.role === 'reader');
  assert.deepEqual([x.about, x.factIds], [y.about, y.factIds]);
  assert.deepEqual(important.find((c) => !c.planted).readings.find((r) => r.role === 'adversary').rejects, []);
  const planted = important.find((c) => c.planted);
  assert.deepEqual(planted.expect, { verdict: 'downgraded', badge: 'not-found', reason: 'disagreement' });
  const known = vocabulary();
  assert.ok(known.has(planted.claim.about) && planted.claim.factIds.every((id) => known.has(id)) && planted.claim.cites.every(quoteFound), 'it fails only by disagreement');
});

test('claims: the file has no personal data and says how the checker must read it', () => {
  const text = readFileSync(join(CLAIMS, 'acme-shop.claims.json'), 'utf8');
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]+Users|\/Users\/|\/home\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  assert.ok(claimsFile.notes.length >= 3);
});

test('limits: the model and the planted claims have their limits next to the readers', () => {
  const limits = readJson(join(REPOS, 'limits.json'));
  assert.deepEqual(limits.model, { accuracy: 1, invention: 0 });
  assert.deepEqual(limits.claims, { plantedRemoved: 1 });
  assert.deepEqual(limits.extractors, { accuracy: 1, invention: 0 });
  assert.equal(limits.ai.invention, 0.02);
});

test('the answer keys of the model sit beside the repositories without being taken for a reading answer key', () => {
  const files = readdirSync(REPOS);
  for (const name of NAMES) assert.ok(files.includes(`${name}.model-answer.json`));
  assert.ok(files.filter((f) => f.endsWith('.answer.json')).every((f) => !f.includes('.model.')), 'foundation-fixtures.test.mjs takes every *.answer.json for a reading key');
});
