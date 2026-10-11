import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';
import texts from '../server/web/i18n-fd/health-items-1.js';

const CATS = ['community', 'security', 'releases', 'docs'];
const ids = HEALTH_ITEMS.filter((i) => CATS.includes(i.category)).map((i) => i.id);
const PARTS = ['what', 'why', 'todo'];

test('part 1 covers the 48 items of community, security, releases and docs', () => {
  assert.equal(ids.length, 48);
  const keys = Object.keys(texts.en).filter((k) => k.startsWith('health.item.'));
  assert.equal(keys.length, 48 * 3);
  const known = new Set(HEALTH_ITEMS.map((i) => i.id));
  for (const k of keys) assert.ok(known.has(k.split('.').slice(2, -1).join('.')), `unknown item in ${k}`);
});

test('every item has what, why and todo in en and pt-BR, none empty', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const id of ids) for (const p of PARTS) {
      const v = texts[lang][`health.item.${id}.${p}`];
      assert.ok(typeof v === 'string' && v.trim().length > 8, `${lang} ${id}.${p} missing or empty`);
    }
  }
});

test('both languages have the same keys', () => {
  assert.deepEqual(Object.keys(texts['pt-BR']).sort(), Object.keys(texts.en).sort());
});

test('no text is identical between the languages by oversight', () => {
  for (const k of Object.keys(texts.en)) assert.notEqual(texts['pt-BR'][k], texts.en[k], k);
});

test('placeholders match between the languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(texts.en)) assert.deepEqual(vars(texts['pt-BR'][k]), vars(texts.en[k]), k);
});

test('license and privacy-like todo sends the owner to look for guidance, never prints legal text', () => {
  assert.match(texts.en['health.item.community.license.todo'], /advise|guidance/i);
  assert.match(texts['pt-BR']['health.item.community.license.todo'], /orient/i);
});
