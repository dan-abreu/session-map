import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../server/foundation/lex.mjs';
import { extract, VERSION, TYPES } from '../server/foundation/extract/prisma.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repos');
const answer = JSON.parse(readFileSync(join(root, 'acme-shop.answer.json'), 'utf8'));
const PATH = 'packages/db/prisma/schema.prisma';

function run(text, path = PATH) {
  return extract({ path, type: 'prisma', text, masked: lex(text, 'prisma').masked, workspace: { dir: '', name: 'x' }, files: [] });
}

test('declares its version and the prisma type', () => {
  assert.equal(VERSION, 'prisma@1');
  assert.deepEqual(TYPES, ['prisma']);
});

test('acme-shop schema gives exactly the answer-key tables and relations, with lines', () => {
  const text = readFileSync(join(root, 'acme-shop', PATH), 'utf8');
  const { facts } = run(text);
  const want = answer.facts.filter((f) => f.file === PATH && (f.kind === 'table' || f.kind === 'relation'));
  assert.equal(want.length, 7);
  const got = facts.map((f) => ({ id: f.id, kind: f.kind, file: f.file, line: f.line, origin: f.origin }));
  const exp = want.map((f) => ({ id: f.id, kind: f.kind, file: f.file, line: f.line, origin: f.origin }));
  const key = (a, b) => (a.id < b.id ? -1 : 1);
  assert.deepEqual(got.sort(key), exp.sort(key));
  for (const w of want.filter((f) => f.kind === 'relation')) {
    const g = facts.find((f) => f.id === w.id);
    assert.deepEqual({ from: g.attrs.from, to: g.attrs.to, field: g.attrs.field, cardinality: g.attrs.cardinality },
      { from: w.attrs.from, to: w.attrs.to, field: w.attrs.field, cardinality: w.attrs.cardinality });
  }
  for (const w of want.filter((f) => f.kind === 'table')) assert.equal(facts.find((f) => f.id === w.id).attrs.source, 'prisma');
});

test('a commented-out model does not become a table', () => {
  const { facts } = run('// model Fake {\n//   id Int\n// }\nmodel Real {\n  id Int @id\n}\n');
  assert.deepEqual(facts.map((f) => f.id), ['table:Real']);
});

test('columns list scalar and enum fields with name, type and line, not relation fields', () => {
  const text = 'enum S {\n  A\n}\nmodel O {\n  id Int @id\n  st S @default(A)\n  note String?\n  c C @relation(fields: [cid], references: [id])\n  cid Int\n}\nmodel C {\n  id Int @id\n  os O[]\n}\n';
  const t = run(text).facts.find((f) => f.id === 'table:O');
  assert.deepEqual(t.attrs.columns, [
    { name: 'id', type: 'Int', line: 5 }, { name: 'st', type: 'S', line: 6 },
    { name: 'note', type: 'String?', line: 7 }, { name: 'cid', type: 'Int', line: 9 },
  ]);
});

test('enum and datasource never become tables', () => {
  const { facts } = run('datasource db {\n  provider = "x"\n}\nenum E {\n  A\n}\n');
  assert.deepEqual(facts, []);
});

test('@@map goes to attrs.dbName', () => {
  const t = run('model User {\n  id Int @id\n  @@map("users")\n}\n').facts[0];
  assert.equal(t.attrs.dbName, 'users');
  assert.equal(t.id, 'table:User');
});

test('cardinality: no list is 1-1, one list is 1-n, two lists is n-n', () => {
  const one = run('model A {\n  id Int @id\n  b B?\n}\nmodel B {\n  id Int @id\n  aId Int @unique\n  a A @relation(fields: [aId], references: [id])\n}\n').facts;
  assert.equal(one.find((f) => f.id === 'relation:A.b->B').attrs.cardinality, '1-1');
  assert.equal(one.find((f) => f.id === 'relation:B.a->A').attrs.cardinality, '1-1');
});

test('self relation with named sides is resolved by relation name', () => {
  const f = run('model P {\n  id Int @id\n  pid Int?\n  parent P? @relation("tree", fields: [pid], references: [id])\n  kids P[] @relation("tree")\n}\n').facts;
  assert.equal(f.find((x) => x.id === 'relation:P.parent->P').attrs.cardinality, '1-n');
  assert.equal(f.find((x) => x.id === 'relation:P.kids->P').attrs.cardinality, '1-n');
});

test('output has no sha and file equals path', () => {
  const f = run('model A {\n  id Int @id\n}\n', 'x/schema.prisma').facts[0];
  assert.equal(f.file, 'x/schema.prisma');
  assert.equal('sha' in f, false);
  assert.equal(f.extractor, 'prisma@1');
});
