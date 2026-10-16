// The Flow's "The program" level (id130, mm57): the census that reads the page's own screens from the code, the route
// that serves it, and the model the level draws. The first version drew every string that looked like a call to the
// translator (tag names, a "\n", storage keys) as a part of the screen, and the level waited forever for a key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AREA_FILES, SHARED, censusOfMarkup, censusOfText, countsOf, uiTree } from '../server/census.mjs';
import { createCensusRoutes } from '../server/censusroute.mjs';
import { roomsOf } from '../server/web/programview.js';
import { LANGS, translator } from '../server/web/i18n.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pt = translator('pt-BR');
// Real keys of the page, so the census accepts them: a title, two buttons, a text, a message.
const [TITLE, SAVE, CANCEL, TEXT, EMPTY] = ['flow.level.journeys', 'flow.copy', 'flow.export.svg', 'flow.fn.lede', 'flow.j.none'];

test('a string that only looks like a call to the translator is never drawn as a part of the screen', () => {
  const code = [
    "el.append(split('x'), text('flow.copy'), createElement('script'), join('\\n'), t('.'), tt('span'), t('not.a.key.at.all'))",
    `h('h2', {}, t('${TITLE}')), h('button', {}, t('${SAVE}'))`,
  ].join('\n');
  const { sections } = censusOfText(code, 'x.js');
  const keys = sections.flatMap((s) => [s.key, ...s.items.map((i) => i.key)]).filter(Boolean);
  assert.deepEqual(keys, [TITLE, SAVE]);
});

test('a part takes its first label only; the next text near it is a text of the screen, not a second name', () => {
  const code = `h('h2', {}, t('${TITLE}')), h('button', {}, t('${SAVE}'), t('${TEXT}'), t('${EMPTY}'))`;
  const { sections } = censusOfText(code, 'x.js');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].key, TITLE);
  assert.deepEqual(sections[0].items, [
    { type: 'button', key: SAVE },
    { type: 'text', key: TEXT },
    { type: 'message', key: EMPTY },
  ]);
});

test('a part with no words of its own is counted as unnamed and never named; a heading without words opens no section', () => {
  const code = `h('h2', {}, data.title), h('button', {}, data.name), h('button', {}, t('${SAVE}')), h('summary', {})`;
  const { sections, unnamed } = censusOfText(code, 'x.js');
  assert.equal(unnamed, 2);
  assert.deepEqual(sections.map((s) => s.key), [null]);
  assert.deepEqual(sections[0].items, [{ type: 'button', key: SAVE }]);
});

test('the same button or text said twice in one section is one piece', () => {
  const code = `h('h3', {}, t('${TITLE}')), h('button', {}, t('${SAVE}')), h('button', {}, t('${SAVE}')), t('${TEXT}'), t('${TEXT}')`;
  const [section] = censusOfText(code, 'x.js').sections;
  assert.equal(section.items.length, 2);
});

test('the markup is read too: a button names itself, by its words, by the words of the tag inside it, or by its aria or title', () => {
  const html = [
    `<h2 data-i18n="${TITLE}"></h2>`,
    `<button type="button" data-i18n="${SAVE}"></button>`,
    `<button type="button" id="b"><svg></svg><span data-i18n="${CANCEL}"></span></button>`,
    `<button type="button" data-i18n-aria="${EMPTY}"></button>`,
    '<button type="button" id="nothing"></button>',
    `<p data-i18n="${TEXT}"></p>`,
  ].join('\n');
  const { sections, unnamed } = censusOfMarkup(html, 'index.html');
  assert.equal(sections[0].key, TITLE);
  assert.deepEqual(sections[0].items.map((i) => `${i.type}:${i.key}`), [`button:${SAVE}`, `button:${CANCEL}`, `button:${EMPTY}`, `text:${TEXT}`]);
  assert.equal(unnamed, 1);
});

test('the counts add up: what is listed is what is counted', () => {
  const { sections, unnamed } = censusOfText(`h('h2', {}, t('${TITLE}')), h('button', {}, t('${SAVE}')), t('${TEXT}'), t('${EMPTY}'), h('button', {})`, 'x.js');
  assert.deepEqual(countsOf(sections, unnamed), { sections: 1, buttons: 1, dialogs: 0, blocks: 0, texts: 1, messages: 1, unnamed: 1 });
});

test('the real census: every area of the page is there, plus the room of what they share, and none is empty', () => {
  const tree = uiTree();
  const nav = [...readFileSync(`${root}server/web/nav.js`, 'utf8').matchAll(/\{ id: '([a-z]+)',/g)].map((m) => m[1]);
  assert.deepEqual(tree.areas.map((a) => a.id), [...nav, SHARED]);
  assert.equal(tree.counts.areas, nav.length + 1);
  for (const a of tree.areas) {
    assert.ok(a.items > 0, `${a.id} draws nothing`);
    assert.equal(a.items, a.counts.buttons + a.counts.dialogs + a.counts.blocks + a.counts.texts + a.counts.messages, a.id);
  }
  assert.equal(tree.counts.sections, tree.areas.reduce((s, a) => s + a.counts.sections, 0));
});

test('the real census: nothing drawn is junk, and every word is a real text of the page', () => {
  for (const a of uiTree().areas) {
    for (const s of a.sections) {
      for (const key of [s.key, ...s.items.map((i) => i.key)].filter(Boolean)) {
        assert.ok(key in LANGS.en || key in LANGS['pt-BR'], `${a.id}: "${key}" is not a text of the page`);
        const words = pt(key);
        assert.match(words, /\p{L}/u, `${a.id}: "${key}" says no word`);
      }
    }
  }
});

test('the real census: the Flow tab shows its own level buttons, which are written in index.html', () => {
  const flow = uiTree().areas.find((a) => a.id === 'flow');
  const buttons = flow.sections.flatMap((s) => s.items.filter((i) => i.type === 'button').map((i) => i.key));
  for (const key of ['flow.level.one', 'flow.level.parts', 'flow.level.journeys', 'flow.level.functions', 'flow.level.program']) assert.ok(buttons.includes(key), key);
  assert.ok(flow.files.includes('server/web/index.html'));
});

test('the real census: every file an area names is there, and the shared room holds what no area claims', () => {
  for (const [id, files] of Object.entries(AREA_FILES)) for (const f of files) assert.ok(existsSync(`${root}${f}`), `${id}: ${f}`);
  const tree = uiTree();
  const claimed = new Set(Object.values(AREA_FILES).flat());
  const shared = tree.areas.find((a) => a.id === SHARED);
  assert.ok(shared.files.length > 0);
  assert.ok(shared.files.includes('server/web/app.js'));
  for (const f of shared.files) assert.ok(!claimed.has(f), f);
});

const tr = (key) => ({ 'tab.a': 'Alpha', 'tab.b': 'Beta', 't.one': 'Open the door', 't.two': 'Close the window', 'b.one': 'Go', 'x.msg': 'Nothing here' })[key] ?? key;
const DATA = {
  areas: [
    { id: 'a', label: 'tab.a', files: ['a.js'], counts: {}, sections: [{ key: 't.one', file: 'a.js', items: [{ type: 'button', key: 'b.one' }, { type: 'text', key: 't.two' }, { type: 'message', key: 'x.msg' }] }, { key: null, file: 'a2.js', items: [{ type: 'text', key: 't.two' }] }] },
    { id: 'b', label: 'tab.b', files: ['b.js'], counts: {}, sections: [] },
  ],
};

test('the level sorts each section into its buttons, its texts and its messages, in the words of the person', () => {
  const [a, b] = roomsOf(DATA, tr);
  assert.equal(a.name, 'Alpha');
  assert.deepEqual(a.sections[0].parts, [{ type: 'button', text: 'Go' }]);
  assert.deepEqual(a.sections[0].texts, [{ type: 'text', text: 'Close the window' }]);
  assert.deepEqual(a.sections[0].messages, [{ type: 'message', text: 'Nothing here' }]);
  assert.equal(a.sections[1].title, null);
  assert.equal(b.sections.length, 0, 'a room still being built stays in the drawing');
});

test('searching keeps the rooms, sections and pieces that say the word, and a section whose title says it keeps all of it', () => {
  assert.deepEqual(roomsOf(DATA, tr, 'window').map((r) => r.id), ['a']);
  const hit = roomsOf(DATA, tr, 'WINDOW')[0];
  assert.equal(hit.sections.length, 2, 'both sections have the text');
  assert.deepEqual(hit.sections[0].parts, [], 'the button does not say it');
  const byTitle = roomsOf(DATA, tr, 'door')[0];
  assert.equal(byTitle.sections.length, 1);
  assert.equal(byTitle.sections[0].parts.length, 1, 'the title says it, so the whole section stays');
  assert.equal(roomsOf(DATA, tr, 'alpha')[0].sections.length, 2, 'the room name says it, so the whole room stays');
  assert.deepEqual(roomsOf(DATA, tr, 'zzz'), []);
});

test('no census, no rooms', () => {
  for (const bad of [null, undefined, {}, { areas: null }]) assert.deepEqual(roomsOf(bad, tr), []);
});

const ask = (path, { method = 'GET', host = '127.0.0.1:4001', address = '127.0.0.1', demo = false } = {}) => {
  const routes = createCensusRoutes({ demo });
  return routes.handle({ method, headers: { host } }, new URL(`http://${host}${path}`), address);
};

test('the census is read on this PC with no key, like the Flow: it used to answer 401 and the level waited forever', async () => {
  const ui = await ask('/api/census/ui');
  assert.equal(ui.status, 200);
  assert.equal(ui.body.ok, true);
  assert.ok(ui.body.areas.length > 10);
  const debt = await ask('/api/census/debt');
  assert.equal(debt.status, 200);
  assert.ok(Array.isArray(debt.body.debts));
});

test('the census is for this PC only: another host, the demo and anything but a read are refused', async () => {
  assert.equal((await ask('/api/census/ui', { host: 'evil.example:4001' })).status, 403);
  assert.equal((await ask('/api/census/ui', { address: '192.168.0.9' })).status, 403);
  assert.equal((await ask('/api/census/ui', { demo: true })).status, 403);
  assert.equal((await ask('/api/census/ui', { method: 'POST' })).status, 404);
  assert.equal((await ask('/api/census/other')).status, 404);
});
