import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary, selectFor, sharedKnowledgeDir } from '../server/foundation/library.mjs';
import { loadStandard } from '../server/foundation/standard.mjs';

const dir = sharedKnowledgeDir();
const IDS = ['general-organization', 'general-quality', 'general-security', 'general-operation'];
const HEALTH_ID = /^(community|security|releases|docs|hygiene|product|management|extras)\.[a-z_]+$/;
const lib = loadLibrary({ sharedDir: dir });
const general = IDS.map((id) => lib.packages.find((p) => p.id === id));

test('the four general engineering packages load with no invalid file', () => {
  assert.deepEqual(lib.invalid, []);
  general.forEach((p, i) => assert.ok(p, `${IDS[i]} is missing`));
});

test('general packages have kind general, no applies, and are confirmed', () => {
  for (const p of general) {
    assert.equal(p.kind, 'general');
    assert.equal(p.applies, undefined);
    assert.equal(p.status, 'confirmed');
  }
});

test('every general package covers the N0 and N1 steps of its front', () => {
  for (const p of general) {
    for (const n of ['N0', 'N1']) assert.ok(p.items.some((it) => it.ladder === n), `${p.id} has no ${n} item`);
  }
});

test('together they cover at least 3 fronts and every ladder level up to N4', () => {
  const items = general.flatMap((p) => p.items);
  assert.ok(new Set(items.map((i) => i.front)).size >= 3);
  for (const n of ['N0', 'N1', 'N2', 'N3', 'N4']) assert.ok(items.some((i) => i.ladder === n), `no ${n}`);
});

test('item ids are unique across the four packages', () => {
  const ids = general.flatMap((p) => p.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('health detectors point at ids shaped like the health catalog', () => {
  for (const p of general) for (const it of p.items) {
    if (it.detect.kind === 'health') assert.match(it.detect.id, HEALTH_ID, `${it.id}`);
  }
});

test('every standard id cited exists in docs/standard', () => {
  const known = new Set(loadStandard(join(dir, '..', 'docs', 'standard')).map((s) => s.id));
  for (const p of general) for (const it of p.items) for (const s of it.standard || []) assert.ok(known.has(s), `${it.id}: ${s}`);
});

test('a C source never carries a link and a V source always does', () => {
  for (const p of general) for (const it of p.items) {
    if (it.source.trust === 'C') assert.equal(it.source.url, null, it.id);
    if (it.source.trust === 'V') assert.match(it.source.url, /^https:\/\//, it.id);
  }
});

test('a web profile gets at least 25 general items', () => {
  const picked = selectFor({ types: ['web'] }, lib.packages).filter((p) => IDS.includes(p.id));
  assert.equal(picked.length, 4);
  const count = picked.reduce((n, p) => n + p.items.length, 0);
  assert.ok(count >= 25, `only ${count} items`);
});

test('no general text claims legal or tax compliance, and no file is above 300 lines', () => {
  for (const id of IDS) {
    const raw = readFileSync(join(dir, id + '.json'), 'utf8');
    assert.ok(raw.split('\n').length <= 300, id);
    assert.doesNotMatch(raw, /compliant|em conformidade/i);
  }
});
