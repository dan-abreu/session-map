import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapsOf, loadLibrary, selectFor, statusOf, validatePackage } from '../server/foundation/library.mjs';
import { loadStandard, unknownStandardRefs } from '../server/foundation/standard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'knowledge');
const STACKS = ['stack-next', 'stack-fastify', 'stack-prisma'];
const IDS = [...STACKS, 'type-web-api'];
const today = new Date().toISOString().slice(0, 10);

const read = (id) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
const lib = () => loadLibrary({ sharedDir: DIR });
const pkgs = () => IDS.map(read);

test('the four part-A guides exist, are valid, named by id and within 300 lines', () => {
  for (const id of IDS) {
    const file = join(DIR, `${id}.json`);
    assert.ok(existsSync(file), `${id}.json is missing`);
    const pkg = read(id);
    assert.equal(pkg.id, id);
    assert.deepEqual(validatePackage(pkg), { ok: true, errors: [] }, id);
    assert.ok(readFileSync(file, 'utf8').split('\n').length <= 300, `${id} has more than 300 lines`);
  }
  const found = lib();
  assert.deepEqual(found.invalid, []);
  for (const id of IDS) assert.ok(found.packages.some((p) => p.id === id));
});

test('each stack guide has 4 to 6 items; the web/API guide covers its five topics', () => {
  for (const id of STACKS) {
    const n = read(id).items.length;
    assert.ok(n >= 4 && n <= 6, `${id} has ${n} items`);
  }
  const ids = read('type-web-api').items.map((i) => i.id).join(' ');
  for (const topic of ['accessibility', 'performance', 'auth', 'rate-limit', 'webhook']) {
    assert.ok(ids.includes(topic), `type-web-api has no ${topic} item`);
  }
});

test('every guide is confirmed today, with an opened (V or F) https source on every item', () => {
  for (const pkg of pkgs()) {
    assert.equal(statusOf(pkg, today), 'confirmed', pkg.id);
    assert.ok(pkg.checkedAt <= today);
    for (const it of pkg.items) {
      assert.ok(['V', 'F'].includes(it.source.trust), `${it.id} must cite an opened source`);
      assert.ok(it.source.url.startsWith('https://'), `${it.id} url`);
    }
  }
});

test('lifecycle: every cycle source is https and next and fastify list their supported cycles', () => {
  for (const pkg of pkgs()) for (const c of pkg.lifecycle?.cycles ?? []) assert.ok(c.source.startsWith('https://'), pkg.id);
  assert.ok(read('stack-next').lifecycle.cycles.some((c) => c.cycle === '16'));
  assert.ok(read('stack-fastify').lifecycle.cycles.some((c) => c.cycle === '5'));
  for (const id of ['stack-next', 'stack-fastify']) {
    assert.ok(read(id).items.some((i) => i.detect.kind === 'supported-version'), `${id} checks the supported version`);
  }
});

test('a profile with next 16 and fastify 5 receives both stack guides, plus the web/API one', () => {
  const profile = { types: ['web', 'api'], stacks: [{ name: 'next', version: '16.0.1' }, { name: 'fastify', version: '5.1.0' }] };
  const got = selectFor(profile, lib().packages).map((p) => p.id);
  for (const id of ['stack-next', 'stack-fastify', 'type-web-api']) assert.ok(got.includes(id), `${id} not selected`);
  assert.ok(!got.includes('stack-prisma'));
});

test('stack and type guides do not leak into projects of another stack or type', () => {
  const got = selectFor({ types: ['mobile'], stacks: ['flutter'] }, lib().packages).map((p) => p.id);
  for (const id of IDS) assert.ok(!got.includes(id), `${id} should not apply to a Flutter app`);
});

test('no library gap is left for next, fastify, prisma, web or api', () => {
  const gaps = gapsOf({ types: ['web', 'api'], stacks: ['next', 'fastify', 'prisma'] }, lib().packages);
  assert.deepEqual(gaps, []);
});

test('examples use only project facts: {route}, {table} and {app}', () => {
  const marker = /\{([^}]*)\}/g;
  for (const pkg of pkgs()) for (const it of pkg.items) {
    for (const lang of ['en', 'pt-BR']) {
      for (const m of (it.example?.[lang] ?? '').matchAll(marker)) assert.ok(['route', 'table', 'app'].includes(m[1]), `${it.id}: {${m[1]}}`);
    }
  }
  assert.ok(pkgs().some((p) => p.items.some((i) => i.example)), 'at least one example is given');
});

test('item ids are unique across the guides and start with the guide prefix', () => {
  const seen = new Set();
  for (const pkg of pkgs()) {
    for (const it of pkg.items) {
      assert.ok(!seen.has(it.id), `duplicate ${it.id}`);
      seen.add(it.id);
    }
  }
  assert.ok(read('stack-next').items.every((i) => i.id.startsWith('next.')));
  assert.ok(read('stack-fastify').items.every((i) => i.id.startsWith('fastify.')));
  assert.ok(read('stack-prisma').items.every((i) => i.id.startsWith('prisma.')));
  assert.ok(read('type-web-api').items.every((i) => i.id.startsWith('webapi.')));
});

test('the standard ids the guides point at exist in docs/standard', () => {
  const bad = unknownStandardRefs(pkgs(), loadStandard(join(ROOT, 'docs', 'standard')));
  assert.deepEqual(bad, []);
});

test('guides never claim a project is compliant and carry no personal data', () => {
  for (const id of IDS) {
    const text = readFileSync(join(DIR, `${id}.json`), 'utf8');
    assert.doesNotMatch(text, /em conformidade|compliant/i, id);
    assert.doesNotMatch(text, /@[a-z0-9-]+\.(com|dev)\b|C:[\/]/i, id);
  }
});
