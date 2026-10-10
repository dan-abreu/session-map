import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translator } from '../server/web/i18n.js';

// The sheet a click on a box opens (mm07): its information in tabs by kind, with the chat as one more tab of the same
// sheet. The chat once took the whole sheet and the root box opened only a new project chat; these guard against that.
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

test('a box opens on its information: the Summary by default, never the chat alone', () => {
  const open = body('openPoint');
  assert.match(open, /openingTab\(tab\)/, 'the first tab comes from openingTab (the Summary unless the chat is asked for)');
  assert.doesNotMatch(open, /tab = 'chat'/);
  assert.doesNotMatch(open, /openProjectChat|plainPoint/, 'the root box opens its project sheet with tabs, not a bare chat');
  assert.match(open, /showPoint\(/);
  assert.match(body('showPoint'), /\$\('#pointTabs'\)\.hidden = false/);
});

test('the root box shows the whole project and its chats, with "New project chat"', () => {
  const root = body('projectDetails');
  for (const piece of ['programFiles', 'waitingEntries', 'liveEntries', 'activitySection(', 'projectChatRows', 'projchat.newLong']) assert.ok(root.includes(piece), piece);
  assert.match(body('detailsOf'), /node\.kind === 'project'\) return projectDetails/);
});

test('"New chat", a project chat from the list and a conversation from the list keep the box tabs, on the Chat tab', () => {
  assert.match(body('openProjectChat'), /openPoint\(tree, \{ tab: 'chat' \}\)/);
  const conv = body('openConversation');
  assert.doesNotMatch(conv, /plainPoint/);
  assert.match(conv, /showPoint\(node, 'chat'\)/);
});

test('one sheet holds the strip, the information and the chat; the old "Conversation | Details" pair is gone', () => {
  const sheet = html.slice(html.indexOf('<aside id="chat"'), html.indexOf('</aside>', html.indexOf('<aside id="chat"')));
  for (const id of ['pointTabs', 'pointDetails', 'chatPane']) assert.ok(sheet.includes(`id="${id}"`), id);
  assert.ok(sheet.indexOf('id="pointTabs"') < sheet.indexOf('id="chatPane"'), 'the strip sits above both panes');
  assert.ok(!html.includes('id="ptab-details"'), 'no second level of tabs');
});

test('an empty box says no file is linked yet, with a "?" that explains, in both languages', () => {
  for (const t of Object.values(LANGS)) for (const key of ['size.none.part', 'size.none.layer', 'help.nofiles']) assert.ok(t(key) !== key, key);
  assert.equal(LANGS.pt('size.none.part'), 'nenhum arquivo ligado a esta parte ainda');
  assert.match(body('sizeLine'), /noFiles\(/);
});

test('every page script parses (app.js is never imported by the tests, so a typo there would only show in the browser)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  for (const f of readdirSync(WEB).filter((x) => x.endsWith('.js'))) {
    const run = spawnSync(process.execPath, ['--check', new URL(f, WEB).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${f}: ${run.stderr}`);
  }
});
