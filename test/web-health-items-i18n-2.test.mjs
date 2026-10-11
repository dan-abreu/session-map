import { test } from 'node:test';
import assert from 'node:assert/strict';
import texts from '../server/web/i18n-fd/health-items-2.js';
import { HEALTH_ITEMS } from '../server/foundation/health-items.mjs';

const CATS = ['hygiene', 'product', 'management', 'extras'];
const ids = HEALTH_ITEMS.filter((i) => CATS.includes(i.category)).map((i) => i.id);
const PARTS = ['what', 'why', 'todo'];

test('part 2 covers the 43 items of hygiene, product, management and extras', () => {
  assert.equal(ids.length, 43);
});

test('every item has what, why and todo, filled, in both languages', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const id of ids) {
      for (const p of PARTS) {
        const v = texts[lang][`health.item.${id}.${p}`];
        assert.ok(typeof v === 'string' && v.trim().length >= 12, `${lang} ${id}.${p}`);
      }
    }
  }
});

test('no key is outside the 43 items and both languages have the same keys', () => {
  const want = ids.flatMap((id) => PARTS.map((p) => `health.item.${id}.${p}`)).sort();
  assert.deepEqual(Object.keys(texts.en).sort(), want);
  assert.deepEqual(Object.keys(texts['pt-BR']).sort(), want);
});

test('pt-BR is never the same text as en by mistake', () => {
  for (const k of Object.keys(texts.en)) assert.notEqual(texts['pt-BR'][k], texts.en[k], k);
});

test('no text has a stray placeholder or a blank edge', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const [k, v] of Object.entries(texts[lang])) {
      assert.equal(v, v.trim(), k);
      assert.ok(!/TODO|<[A-Z ]+>|\{\w+\}/.test(v), k);
    }
  }
});

test('legal items point the owner to proper guidance, never legal text', () => {
  for (const id of ['product.privacy', 'product.terms']) {
    assert.match(texts.en[`health.item.${id}.todo`], /lawyer|legal|professional|guidance/i);
    assert.match(texts['pt-BR'][`health.item.${id}.todo`], /advogad|jur[ií]dic|profissional|orienta/i);
  }
});
