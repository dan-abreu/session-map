import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

// The proof script lives in .dev/ (ignored by git), so a fresh clone or CI does not have it: skip its tests there.
const script = new URL('../.dev/prova/aprovar/aprovar6a.mjs', import.meta.url);
const skip = existsSync(script) ? false : '.dev/prova/aprovar/aprovar6a.mjs is not in this checkout';
const { judge, contrast } = skip ? {} : await import(script);

const clean = { console: [], emptyTabs: [], smallTargets: [], lowContrast: [], noFocus: [], unreachable: [] };

test('judge: a clean run has no failures', { skip }, () => {
  assert.deepEqual(judge({ 'home-1280-light-simple': clean }), []);
});

test('judge: console errors, empty tabs and small phone targets fail the run', { skip }, () => {
  const facts = {
    'home-390-light-simple': { ...clean, console: ['error: x'], emptyTabs: ['tab-map'], smallTargets: ['tab-ideas 30x30'] },
  };
  const out = judge(facts);
  assert.equal(out.length, 3);
  assert.ok(out.some((l) => /console/.test(l)) && out.some((l) => /tab/.test(l)) && out.some((l) => /44/.test(l)));
});

test('judge: small targets on desktop are not a failure', { skip }, () => {
  assert.deepEqual(judge({ 'home-1280-light-simple': { ...clean, smallTargets: ['a 20x20'] } }), []);
});

test('contrast: black on white is 21, same colors is 1', { skip }, () => {
  assert.ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
  assert.equal(contrast([9, 9, 9], [9, 9, 9]), 1);
});

test('fd-nav.css lifts the Conversations sub-tabs to 44 px on the phone', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/web/css/fd-nav.css', import.meta.url), 'utf8');
  const block = css.match(/@media \(max-width: [^)]+\)\s*\{[^@]*?\.sub-tab[^}]*min-height:\s*44px/s);
  assert.ok(block, 'a phone rule gives .sub-tab min-height: 44px');
});
