import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INFO_KINDS, KIND_LOOK, POINT_TABS, TAB_OF, kindWords, pointTabs, projectTabs, openingTab, kindDigest } from '../server/web/kinds.js';
import { translator } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const css = readFileSync(new URL('style.css', WEB), 'utf8');
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const LANGS = { en: translator('en'), pt: translator('pt-BR') };

test('the five kinds of information are tasks, conversations, lines of work, what changed and files', () => {
  assert.deepEqual(INFO_KINDS, ['tasks', 'chats', 'branches', 'changes', 'files']);
  assert.deepEqual(POINT_TABS, ['summary', 'tasks', 'chats', 'changes', 'files']);
  for (const kind of INFO_KINDS) assert.ok(POINT_TABS.includes(TAB_OF[kind]), `${kind} lives in a tab`);
});

test('each kind has a plain title and a "where it comes from" line, in both languages', () => {
  for (const kind of INFO_KINDS) for (const [lang, t] of Object.entries(LANGS)) {
    const w = kindWords(t, kind, { file: 'vitrine.md', n: 2 });
    assert.ok(w.title.trim() && !/^kind\./.test(w.title), `${lang} ${kind} title`);
    assert.ok(/^(Comes from|Vem d)/.test(w.from) && !/[{}]/.test(w.from), `${lang} ${kind} from: ${w.from}`);
  }
  assert.equal(kindWords(LANGS.pt, 'branches').title, 'Linhas de trabalho');
  assert.equal(kindWords(LANGS.pt, 'changes').title, 'O que mudou');
});

test('every tab has a label in both languages', () => {
  for (const tab of POINT_TABS) for (const t of Object.values(LANGS)) assert.ok(!/^ptab\./.test(t(`ptab.${tab}`)), tab);
});

test('one colour and one icon per kind, defined for light and dark, so every screen draws the same thing', () => {
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  for (const kind of INFO_KINDS) {
    for (const suffix of ['', '-ink', '-fill']) {
      assert.ok(css.includes(`--k-${kind}${suffix}:`), `light --k-${kind}${suffix}`);
      assert.ok(dark.includes(`--k-${kind}${suffix}:`), `dark --k-${kind}${suffix}`);
    }
    assert.ok(html.includes(`id="i-${KIND_LOOK[kind].icon}"`), `icon i-${KIND_LOOK[kind].icon} is in the sprite`);
  }
  assert.equal(new Set(INFO_KINDS.map((k) => KIND_LOOK[k].icon)).size, 5, 'no two kinds share an icon');
});

test('pointTabs shows the Summary, only the tabs that have something, and the chat last: the chat never stands alone', () => {
  assert.deepEqual(pointTabs({}), ['summary', 'chat']);
  assert.deepEqual(pointTabs({ files: true, tasks: true }), ['summary', 'tasks', 'files', 'chat']);
  assert.deepEqual(pointTabs({ tasks: true, chats: true, changes: true, files: true }), [...POINT_TABS, 'chat']);
});

test('the root box holds the whole project: its Summary, its own chats always, what changed and its files, then the chat', () => {
  assert.deepEqual(projectTabs({}), ['summary', 'chats', 'chat']);
  assert.deepEqual(projectTabs({ changes: true, files: true }), ['summary', 'chats', 'changes', 'files', 'chat']);
});

test('a click on a box opens its information first; the chat only when it is asked for by name', () => {
  assert.equal(openingTab(), 'summary');
  assert.equal(openingTab('details'), 'summary', 'the old "Details" link lands on the Summary');
  assert.equal(openingTab('nonsense'), 'summary');
  assert.equal(openingTab('files'), 'files');
  assert.equal(openingTab('chat'), 'chat');
});

test('the chat tab and the project chats tab have their words in both languages', () => {
  for (const t of Object.values(LANGS)) for (const key of ['ptab.chat', 'ptab.projectChats']) assert.ok(!/^ptab./.test(t(key)), key);
  assert.equal(LANGS.pt('ptab.chat'), 'Conversar');
  assert.equal(LANGS.pt('ptab.projectChats'), 'Chats do projeto');
});

test('the summary digest of a kind says how many there are, and says so when there are none', () => {
  const en = LANGS.en;
  assert.equal(kindDigest(en, 'tasks', { open: 3, blocks: 1 }), '3 open · 1 blocking');
  assert.equal(kindDigest(en, 'tasks', { open: 0, blocks: 0 }), 'Nothing open');
  assert.equal(kindDigest(en, 'chats', { n: 2, waiting: 1 }), '2 conversations · 1 waiting for you');
  assert.equal(kindDigest(en, 'chats', { n: 0 }), 'No conversations yet');
  assert.equal(kindDigest(en, 'branches', { n: 1, clashing: 0 }), '1 line of work open');
  assert.equal(kindDigest(en, 'changes', { n: 4 }), '4 changes in the period');
  assert.equal(kindDigest(en, 'files', { n: 0 }), 'No files');
  assert.equal(kindDigest(LANGS.pt, 'branches', { n: 2, clashing: 2 }), '2 linhas de trabalho abertas · 2 em choque');
});
