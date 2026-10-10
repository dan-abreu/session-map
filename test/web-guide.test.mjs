// The page explains itself (mm11): empty screens with a drawing and a sentence, a five-step welcome tour that can be
// skipped and replayed, a "?" with one sentence in every area, and a "Technical details" switch with a small glossary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { emptyState } from '../server/web/empty.js';
import { TOUR_STEPS, tourWanted, tourTarget } from '../server/web/tour.js';
import { HELP_AREAS, GLOSSARY } from '../server/web/help.js';
import { LANGS, TECH } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const sources = readdirSync(WEB).filter((f) => /\.(js|html)$/.test(f)).map((f) => readFileSync(new URL(f, WEB), 'utf8')).join('\n');
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((c) => c != null && c !== false) });
const walk = (node) => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(walk)] : []);
const has = (key) => key in LANGS.en && key in LANGS['pt-BR'];

test('an empty screen has a drawing, a title, a sentence and, when given, the button that gets out of it', () => {
  let ran = 0;
  const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
  const box = emptyState({ h, icon }, { art: 'chat', title: 'No conversations yet', text: 'Start one from Claude Code.', action: { label: 'New idea', run: () => { ran += 1; } } });
  assert.equal(box.attrs.class, 'empty-state');
  const art = walk(box).find((n) => n.attrs?.class === 'empty-art');
  assert.ok(art, 'a drawing');
  assert.equal(art.attrs['aria-hidden'], 'true');
  assert.ok(walk(art).some((n) => n.attrs?.['data-icon'] === 'chat'));
  assert.deepEqual(walk(box).filter((n) => n.tag === 'h3').map((n) => n.children[0]), ['No conversations yet']);
  assert.deepEqual(walk(box).filter((n) => n.tag === 'p').map((n) => n.children[0]), ['Start one from Claude Code.']);
  const button = walk(box).find((n) => n.tag === 'button');
  button.attrs.onclick();
  assert.equal(ran, 1);
  const quiet = emptyState({ h, icon: null }, { art: 'map', title: 'Nothing', text: 'Nothing here.' });
  assert.equal(walk(quiet).filter((n) => n.tag === 'button').length, 0);
  assert.ok(walk(quiet).some((n) => n.attrs?.class === 'empty-art'), 'the drawing stays without the sprite');
});

test('the empty screens of the page use the shared empty state', () => {
  for (const file of ['tabs.js', 'live.js', 'convlist.js', 'discover.js', 'app.js']) {
    assert.match(readFileSync(new URL(file, WEB), 'utf8'), /emptyState\(/, `${file} draws its empty screen with emptyState`);
  }
});

test('the welcome tour has five steps, each pointing at a real place with words in both languages', () => {
  assert.equal(TOUR_STEPS.length, 5);
  for (const step of TOUR_STEPS) {
    for (const sel of [step.target, step.phoneTarget].filter(Boolean)) {
      const id = sel.match(/^#([\w-]+)$/)?.[1];
      const cls = sel.match(/^\.([\w-]+)$/)?.[1];
      assert.ok(id ? html.includes(`id="${id}"`) : new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `${sel} is on the page`);
    }
    assert.ok(has(`tour.${step.id}.title`) && has(`tour.${step.id}.text`), `tour.${step.id} words`);
  }
  for (const key of ['tour.next', 'tour.back', 'tour.skip', 'tour.done', 'tour.step', 'tour.replay']) assert.ok(has(key), key);
});

test('the tour starts once by itself, and only when it was never seen or skipped', () => {
  assert.equal(tourWanted(null), true);
  assert.equal(tourWanted('done'), false);
  assert.equal(tourWanted('skipped'), false);
  assert.equal(tourTarget(TOUR_STEPS[1], false), TOUR_STEPS[1].target);
  assert.equal(tourTarget(TOUR_STEPS[1], true), TOUR_STEPS[1].phoneTarget ?? TOUR_STEPS[1].target);
});

test('every area of the page has a "?" with one sentence in both languages', () => {
  const required = ['now', 'convs', 'map', 'waiting', 'live', 'relations', 'chat', 'panel', 'flow', 'board', 'history', 'costs', 'changes', 'discover', 'alerts'];
  assert.deepEqual([...HELP_AREAS].sort(), [...required].sort());
  for (const area of required) {
    assert.ok(has(`help.${area}`), `help.${area} words`);
    assert.ok(sources.includes(`data-help="${area}"`) || sources.includes(`'data-help': '${area}'`), `${area} carries data-help`);
    for (const lang of ['en', 'pt-BR']) assert.ok(!/[.!?].+[.!?]\s*\S/.test(LANGS[lang][`help.${area}`].trim().replace(/\b(e\.g|i\.e)\./g, '')), `${lang} help.${area} is one sentence`);
  }
});

test('the help menu holds the tour, the technical details switch and a glossary of plain and technical words', () => {
  for (const id of ['helpBtn', 'helpMenu', 'techToggle', 'tourReplay']) assert.ok(html.includes(`id="${id}"`), id);
  // Each glossary word is a plain text whose technical original sits in TECH: the menu shows both side by side.
  assert.ok(GLOSSARY.length >= 8);
  for (const key of GLOSSARY) {
    assert.ok(has(key), key);
    assert.ok(key in TECH.en && key in TECH['pt-BR'], `${key} has its technical word`);
  }
  for (const key of ['help.title', 'help.techLabel', 'help.techHint', 'help.glossary']) assert.ok(has(key), key);
  assert.ok(Object.keys(TECH.en).length > 40);
});

test('item codes (ca01) are technical: shown only with the technical words on', () => {
  const css = readFileSync(new URL('style.css', WEB), 'utf8');
  assert.match(css, /body:not\(\.is-tech\) \.bx-code,\s*body:not\(\.is-tech\) \.code-chip\s*\{\s*display:\s*none;/);
  const app = readFileSync(new URL('app.js', WEB), 'utf8');
  assert.match(app, /document\.body\.classList\.toggle\('is-tech', tech\)/);
  assert.doesNotMatch(app, /\[decision\.who, decision\.code\]/, 'the waiting list leaves the code out in plain mode');
});
