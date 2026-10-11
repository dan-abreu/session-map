// The page explains itself (mm11): empty screens with a drawing and a sentence, a five-step welcome tour that can be
// skipped and replayed, a "?" with one sentence in every area, and a "Technical details" switch with a small glossary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { emptyState } from '../server/web/empty.js';
import { TOUR_STEPS, tourWanted, tourTarget } from '../server/web/tour.js';
import { HELP_AREAS, GLOSSARY } from '../server/web/help.js';
import { LANGS, TECH } from '../server/web/i18n.js';
import { AREAS } from '../server/web/nav.js';

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

test('the welcome tour has five steps (home, now, convs, map, help), each on a real place with words in both languages', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ['home', 'now', 'convs', 'map', 'help']);
  const areaIds = new Set(AREAS.map((a) => a.id));
  for (const step of TOUR_STEPS) {
    for (const sel of [step.target, step.phoneTarget].filter(Boolean)) {
      const id = sel.match(/^#([\w-]+)$/)?.[1];
      assert.ok(id, `${sel} is an id`);
      const tab = id.match(/^tab-(\w+)$/)?.[1];
      // A tab target must be an area of the table, or the ⋯ (More) button that holds the help.
      if (tab) assert.ok(areaIds.has(tab) || tab === 'more', `${sel} is an area`);
      else if (!['convsBtn', 'outline'].includes(id)) assert.ok(html.includes(`id="${id}"`), `${sel} is on the page`);
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

test('the last step lights the ⋯ of the bar, where the help lives (on a phone the one of the bottom bar), and its words say so', () => {
  const help = TOUR_STEPS.find((s) => s.id === 'help');
  assert.equal(tourTarget(help, true), '#tab-more', 'the bottom bar\'s Mais on a phone');
  assert.equal(tourTarget(help, false), '#tab-more');
  assert.ok(!html.includes('id="helpBtn"') && !html.includes('id="personBtn"'), 'no "?" and no person button in the bar');
  assert.ok(help.phoneText && has(help.phoneText), 'its own words on a phone, in both languages');
  for (const lang of ['en', 'pt-BR']) assert.notEqual(LANGS[lang][help.phoneText], LANGS[lang]['tour.help.text'], lang);
  const tour = readFileSync(new URL('tour.js', WEB), 'utf8');
  assert.match(tour, /step\.phoneText/, 'the card reads them on a phone');
});

test('the conversations step lights the inbox it describes on a computer, and the Conversations tab that opens it on a phone', () => {
  const convs = TOUR_STEPS.find((s) => s.id === 'convs');
  assert.equal(tourTarget(convs, false), '#convs', 'on a computer the inbox is the column on the left, not the tab of Board and History');
  assert.ok(html.includes('id="convs"'));
  assert.equal(tourTarget(convs, true), '#tab-convs', 'on a phone the bottom bar\'s Conversations opens the inbox');
  // There is no pointer on a phone: its words say to tap, not to point at a row.
  assert.ok(convs.phoneText && has(convs.phoneText), 'its own words on a phone, in both languages');
  for (const lang of ['en', 'pt-BR']) assert.notEqual(LANGS[lang][convs.phoneText], LANGS[lang]['tour.convs.text'], lang);
});

test('every area of the page has a "?" with one sentence in both languages', () => {
  const fresh = ['home', 'route', 'health', 'ideas', 'library']; // their views arrive with B6-T8 and part B, which add data-help
  const required = ['convs', 'map', 'waiting', 'live', 'relations', 'chat', 'panel', 'flow', 'board', 'history', 'costs', 'changes', 'discover', 'alerts', 'cut', ...fresh];
  assert.deepEqual([...HELP_AREAS].sort(), [...required].sort());
  for (const area of required) {
    assert.ok(has(`help.${area}`), `help.${area} words`);
    if (!fresh.includes(area)) assert.ok(sources.includes(`data-help="${area}"`) || sources.includes(`'data-help': '${area}'`), `${area} carries data-help`);
    for (const lang of ['en', 'pt-BR']) assert.ok(!/[.!?].+[.!?]\s*\S/.test(LANGS[lang][`help.${area}`].trim().replace(/\b(e\.g|i\.e)\./g, '')), `${lang} help.${area} is one sentence`);
  }
});

test('the help lives in the ⋯: the tour and the Full switch are its entries, the panel holds a glossary of plain and technical words', () => {
  assert.ok(html.includes('id="helpMenu"') && html.includes('id="helpGlossary"'));
  const app = readFileSync(new URL('app.js', WEB), 'utf8');
  const entries = app.slice(app.indexOf('function moreEntries('), app.indexOf('function wire()'));
  assert.deepEqual([...entries.matchAll(/id: '(\w+)'/g)].map((m) => m[1]), ['tour', 'ai', 'full', 'help', 'settings']);
  assert.ok(entries.includes('onActivate: () => tour.start()'));
  assert.ok(entries.includes("kind: 'switch', checked: tech"));
  // Each glossary word is a plain text whose technical original sits in TECH: the menu shows both side by side.
  assert.ok(GLOSSARY.length >= 8);
  for (const key of GLOSSARY) {
    assert.ok(has(key), key);
    assert.ok(key in TECH.en && key in TECH['pt-BR'], `${key} has its technical word`);
  }
  for (const key of ['help.title', 'help.techLabel', 'help.techHint', 'help.glossary']) assert.ok(has(key), key);
  assert.ok(Object.keys(TECH.en).length > 40);
});

test('the glossary knows the new words side by side, and the help menu names the switch "full mode"', () => {
  for (const key of ['gloss.uptodate', 'gloss.health']) {
    assert.ok(GLOSSARY.includes(key), key);
    for (const lang of ['en', 'pt-BR']) assert.notEqual(LANGS[lang][key], TECH[lang][key], `${lang} ${key}: plain differs from technical`);
  }
  assert.equal(LANGS['pt-BR']['gloss.uptodate'], 'Tudo em dia?');
  assert.equal(LANGS['pt-BR']['gloss.health'], 'Nota de saúde');
  assert.ok(readFileSync(new URL('app.js', WEB), 'utf8').includes("t('more.full')"), 'the ⋯ names the switch "full mode"');
});

test('item codes (ca01) are technical: shown only with the technical words on', () => {
  const css = readFileSync(new URL('style.css', WEB), 'utf8');
  assert.match(css, /body:not\(\.is-tech\) \.bx-code,\s*body:not\(\.is-tech\) \.code-chip\s*\{\s*display:\s*none;/);
  const app = readFileSync(new URL('app.js', WEB), 'utf8');
  assert.match(app, /document\.body\.classList\.toggle\('is-tech', tech\)/);
  assert.doesNotMatch(app, /\[decision\.who, decision\.code\]/, 'the waiting list leaves the code out in plain mode');
});
