// The "under construction" notice and the navigation texts: every area has a label and a sentence about what it will hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS } from '../server/web/nav.js';
import { buildingState } from '../server/web/empty.js';
import { LANGS } from '../server/web/i18n.js';

const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((c) => c != null && c !== false) });
const walk = (node) => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(walk)] : []);
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const KEYS = ['nav.more', 'nav.label', 'nav.soon', 'mode.simple', 'mode.full', 'mode.hint', 'convs.sub.board', 'convs.sub.history'];

test('every area has a label and a "what it will hold" sentence, in both languages', () => {
  for (const lang of Object.keys(LANGS)) {
    for (const a of AREAS) {
      assert.ok(LANGS[lang][`tab.${a.id}`], `${lang} tab.${a.id}`);
      assert.ok(LANGS[lang][`soon.${a.id}.what`], `${lang} soon.${a.id}.what`);
    }
    for (const k of KEYS) assert.ok(LANGS[lang][k], `${lang} ${k}`);
  }
});

test('the navigation texts use the same blanks in both languages', () => {
  const keys = [...KEYS, ...AREAS.flatMap((a) => [`tab.${a.id}`, `soon.${a.id}.what`])];
  for (const k of keys) assert.deepEqual(vars(LANGS['pt-BR'][k]), vars(LANGS.en[k]), k);
});

test('buildingState draws an icon, the area name, what it will hold and when it arrives', () => {
  const t = (k) => LANGS.en[k];
  const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
  for (const a of AREAS) {
    const box = buildingState({ h, icon, t }, { area: a.id });
    assert.ok(walk(box).some((n) => n.attrs?.['data-icon'] === a.icon), `${a.id} icon`);
    assert.equal(walk(box).find((n) => n.tag === 'h3').children[0], LANGS.en[`tab.${a.id}`]);
    const text = walk(box).find((n) => n.tag === 'p').children[0];
    assert.ok(text.includes(LANGS.en[`soon.${a.id}.what`]));
    assert.ok(text.includes(LANGS.en['nav.soon']));
  }
});
