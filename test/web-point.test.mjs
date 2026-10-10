import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translator } from '../server/web/i18n.js';

// The sheet a click on a box opens (mm07): its information on top in tabs by kind, folding to one line while the person
// talks, and the chat about the box always under it. The chat once took the whole sheet, then hid as the last tab; these
// guard against both.
const WEB = new URL('../server/web/', import.meta.url);
const app = readFileSync(new URL('app.js', WEB), 'utf8');
const html = readFileSync(new URL('index.html', WEB), 'utf8');
const LANGS = { en: translator('en'), pt: translator('pt-BR') };

// The body of a top-level function of app.js, from its line to the closing brace at the start of a line.
function body(name) {
  const at = app.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `app.js has ${name}()`);
  return app.slice(at, app.indexOf('\n}\n', at) + 2);
}

test('a click on a box, in the map or the outline, opens its point', () => {
  assert.match(app, /onPick: \(node\) => openPoint\(node\)/);
});

test('a box opens on its information with the chat under it; tab=chat folds the information and puts the chat first', () => {
  const open = body('openPoint');
  assert.match(open, /openingTab\(tab\)/, 'the tab of the information comes from openingTab');
  assert.match(open, /chatFirst = tab === CHAT_TAB/);
  assert.match(open, /folded: chatFirst \|\| Boolean\(last\)/, 'asked for the chat, or back on a conversation, the information folds');
  assert.doesNotMatch(open, /openProjectChat|plainPoint/, 'the root box opens its project sheet with tabs, not a bare chat');
  const show = body('showPoint');
  assert.match(show, /\$\('#pointInfo'\)\.hidden = false/);
  assert.match(show, /\$\('#pointSplit'\)\.hidden = false/);
});

test('back on a box, its last conversation on the page comes back; New chat and the project chat start fresh', () => {
  const open = body('openPoint');
  assert.match(open, /keepBoxChat\(\)/, 'the conversation of the box being left is kept');
  assert.match(open, /title: last\.title \|\| own\.title, start: \{ sessionId: last\.sessionId \}/, 'with its own title');
  assert.match(open, /newChat: \(\) => openPoint\(node, \{ tab: CHAT_TAB, fresh: true \}\)/, 'every box has New chat');
  assert.match(body('openProjectChat'), /openPoint\(tree, \{ tab: CHAT_TAB, fresh: true \}\)/);
  assert.ok(app.includes('const boxKey = (nodeId) => `${project.id}|${nodeId}`'), 'kept per project: two projects can have a box with the same id');
});

test('the root box shows the whole project and its chats, with "New project chat"', () => {
  const root = body('projectDetails');
  for (const piece of ['programFiles', 'waitingEntries', 'liveEntries', 'activitySection(', 'projectChatRows', 'projchat.newLong']) assert.ok(root.includes(piece), piece);
  assert.match(body('detailsOf'), /node\.kind === 'project'\) return projectDetails/);
});

test('a conversation from the list opens under its box, with the information folded to one line', () => {
  const conv = body('openConversation');
  assert.doesNotMatch(conv, /plainPoint/);
  assert.match(conv, /showPoint\(node, 'summary', \{ folded: true \}\)/);
  assert.match(conv, /keepBoxChat\(\)/);
});

test('sending folds the information, unless the person folded or unfolded it by hand', () => {
  assert.match(app, /beforeSend: foldForTalk/);
  assert.match(body('foldForTalk'), /!foldByHand/);
  assert.match(app, /\$\('#pointFold'\)\.addEventListener\('click', \(\) => setFolded\(!infoFolded, \{ byHand: true \}\)\)/);
  assert.match(body('renderFold'), /aria-expanded/);
});

test('one sheet: the information (fold line, strip, details), the split line naming the chat, then the chat; no Chat tab', () => {
  const sheet = html.slice(html.indexOf('<aside id="chat"'), html.indexOf('</aside>', html.indexOf('<aside id="chat"')));
  const at = (id) => sheet.indexOf(`id="${id}"`);
  for (const id of ['pointInfo', 'pointFold', 'pointTabs', 'pointDetails', 'pointSplit', 'chatPane', 'chatForm']) assert.ok(at(id) >= 0, id);
  assert.ok(at('pointFold') < at('pointTabs') && at('pointTabs') < at('pointDetails'), 'the fold line, then the strip, then the details');
  assert.ok(at('pointDetails') < at('pointSplit') && at('pointSplit') < at('chatPane'), 'the information above the chat, the split between');
  assert.match(sheet, /id="pointSplit" role="separator" aria-orientation="horizontal" tabindex="0"/);
  assert.ok(!html.includes('ptab-chat') && !html.includes('id="ptab-details"'), 'no Chat tab, no second level of tabs');
});

test('an empty box says no file is linked yet, with a "?" that explains, in both languages', () => {
  for (const t of Object.values(LANGS)) for (const key of ['size.none.part', 'size.none.layer', 'help.nofiles']) assert.ok(t(key) !== key, key);
  assert.equal(LANGS.pt('size.none.part'), 'nenhum arquivo ligado a esta parte ainda');
  assert.match(body('sizeLine'), /noFiles\(/);
});

test('every page script parses (app.js is never imported by the tests, so a typo there would only show in the browser)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(WEB).filter((x) => x.endsWith('.js'))) {
    const run = spawnSync(process.execPath, ['--check', new URL(f, WEB).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${f}: ${run.stderr}`);
  }
});

test('the project Files tab opens any file: the whole program as a tree, and the files with no box as rows that open', () => {
  const files = readFileSync(new URL('files.js', WEB), 'utf8');
  const root = body('programFiles');
  assert.match(root, /files\.tree\(\{ all: true \}\)/, 'the whole program as a folder tree');
  assert.match(app, /openable \? files\.pathRow\(path\)/, 'the listed paths open the viewer');
  assert.match(root, /openable: k !== 'binary'/, 'a binary file stays plain text');
  assert.match(files, /scope\.all \? \{ all: '1' \}/);
  assert.match(files, /onclick: \(e\) => busy\(e\.currentTarget, \(\) => onOpen\(f\)\)/, 'a file row says it is opening while it loads');
  for (const t of Object.values(LANGS)) assert.notEqual(t('files.opening'), 'files.opening');
});
