import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch } from '../server/arch/parse.mjs';
import { archTree, boardItems } from '../server/web/tree.js';
import { finishItem, startItem } from '../server/arch/clerk.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { translator } from '../server/web/i18n.js';

// The parked state (am06): an item marked "later" is a decision to wait. It is out of every count of open work, it is not
// offered to a chat as work, it is not on the board, and taking the mark off (or ticking the item) brings it back.

const PART = [
  '# Alpha', '', 'Alpha works.', '', '## Where in the code', '', '- `server/alpha/`', '', "## What's missing", '',
  '- [ ] **Claude:** Open work `al01`',
  '- [ ] **later:** Parked work `al02`',
  '  - Parked on 2026-10-16: waits for the release.',
  '- [ ] **later · detail:** Parked detail `al03`',
  '- [ ] **Mais tarde:** Trabalho adiado `al04`',
  '- [ ] **with Ana:** Needs the owner `al05`',
  '- [ ] **later · with Ana:** Parked and with the owner `al06`',
  '- [x] Done work `al07`', '',
].join('\n');
const FILES = { 'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n', 'alpha.md': PART };
const arch = () => parseArch('docs/architecture', FILES, 'worktree');
const items = () => arch().parts[0].groups.flatMap((g) => g.items);

test('"later", "mais tarde" and the weight next to it park an item; the others keep their state', () => {
  const by = Object.fromEntries(items().map((i) => [i.code, i]));
  assert.deepEqual(['al01', 'al02', 'al03', 'al04', 'al05', 'al06', 'al07'].map((c) => by[c].status), ['todo', 'later', 'later', 'later', 'todo', 'later', 'done']);
  assert.equal(by.al03.weight, 'detail', 'the weight beside the mark is kept');
  assert.match(by.al02.title, /^Parked work/, 'the mark is not part of the title');
});

test('a parked item leaves the open counts: not to do, not waiting for the owner, not a blocker', () => {
  assert.deepEqual(arch().parts[0].counts, { todo: 2, doing: 0, done: 1, later: 4, withUser: 1, blocks: 0 });
});

test('the tree counts it as later and not as work: out of total, done, withUser and the board', () => {
  const project = { id: 'p', name: 'p', arch: { ...arch(), layers: [{ id: 'l', name: 'L', partIds: ['alpha'] }] }, chats: [], activity: [] };
  const root = archTree(project);
  assert.deepEqual(root.counts, { total: 3, done: 1, doing: 0, withUser: 1, blocks: 0, later: 4 });
  const board = boardItems(project);
  assert.deepEqual(board.todo.map((x) => x.item.code).sort(), ['al01', 'al05']);
  assert.deepEqual(board.done.map((x) => x.item.code), ['al07']);
  assert.equal(Object.keys(board).sort().join(), 'doing,done,todo', 'no column for the parked');
});

test('the clerk does not start a parked item, and ticking one takes the mark off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-later-'));
  try {
    mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
    const old = new Date(Date.now() - 60_000); // the clerk will not write a file changed a moment ago
    for (const [name, text] of Object.entries(FILES)) { const p = join(root, 'docs', 'architecture', name); writeFileSync(p, text); utimesSync(p, old, old); }
    const start = await startItem({ root, code: 'al02' });
    assert.equal(start.ok, false);
    assert.match(JSON.stringify(start), /parked/);
    const finish = await finishItem({ root, code: 'al02', note: 'built in server/alpha/x.mjs' });
    assert.equal(finish.ok, true);
    const text = readFileSync(join(root, 'docs', 'architecture', 'alpha.md'), 'utf8');
    assert.ok(text.split(/\r?\n/).includes('- [x] Parked work `al02`'), 'ticked, and no "later" mark left on the line');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the page says it in both languages', () => {
  assert.equal(translator('en')('item.status.later'), 'Later');
  assert.equal(translator('pt-BR')('item.status.later'), 'Mais tarde');
  assert.equal(translator('en').count('point.laterItems', 3), '3 for later');
  assert.equal(translator('pt-BR').count('point.laterItems', 1), '1 para depois');
});

test('every place the page turns an item status into a text has a text for the parked state (found by the browser smoke)', () => {
  const en = translator('en');
  const pt = translator('pt-BR');
  for (const key of ['item.status.later', 'requests.act.later', 'point.laterItems.other']) {
    assert.notEqual(en(key), key, `${key} has an English text`);
    assert.notEqual(pt(key), key, `${key} has a Portuguese text`);
  }
  // The Requests tab writes `requests.act.<status>` for each item a request became, whatever its status is.
  for (const status of ['todo', 'doing', 'done', 'later']) assert.notEqual(en(`requests.act.${status}`), `requests.act.${status}`, status);
});
