import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPicker } from '../server/web/picker.js';
import { openFolderPicker } from '../server/web/folderpick.js';
import { translator } from '../server/web/i18n.js';

// The folder chooser of the page (id164): walks the PC's folders, picks one, keeps it; and the project list's row that opens it.

const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs ?? {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) });
const walk = (node, out = []) => { if (node && typeof node === 'object') { out.push(node); node.kids?.forEach((k) => walk(k, out)); } return out; };
const withClass = (node, cls) => walk(node).filter((n) => new RegExp(`(^| )${cls}( |$)`).test(n.attrs?.class ?? ''));
const textOf = (node) => (typeof node === 'object' && node ? (node.kids ?? []).map(textOf).join('') : String(node ?? ''));
const click = (node) => node.attrs.onclick();

const LISTINGS = {
  '': { ok: true, path: '', parent: null, home: 'C:\\Users\\ana', entries: [{ name: 'C:\\', path: 'C:\\', repo: false }, { name: 'D:\\', path: 'D:\\', repo: false }] },
  'C:\\': { ok: true, path: 'C:\\', parent: '', entries: [{ name: 'dev', path: 'C:\\dev', repo: false }, { name: 'tools', path: 'C:\\tools', repo: true }] },
  'C:\\dev': { ok: true, path: 'C:\\dev', parent: 'C:\\', entries: [{ name: 'shop', path: 'C:\\dev\\shop', repo: true }] },
  'D:\\': { ok: true, path: 'D:\\', parent: '', entries: [] },
};
const REPOS = { 'C:\\dev': { ok: true, repos: ['C:\\dev\\shop', 'C:\\dev\\api'], truncated: false } };

function setup({ roots = [], listings = LISTINGS, repos = REPOS, save } = {}) {
  const calls = { folders: [], repos: [], saved: [], toasts: [], onSaved: 0, closed: 0 };
  const dialog = { kids: [], opened: false, replaceChildren(...k) { this.kids = k; }, showModal() { this.opened = true; }, close() { calls.closed++; } };
  const api = {
    folders: async (p) => { calls.folders.push(p); return listings[p] ?? { ok: false, error: 'not-a-folder' }; },
    folderRepos: async (p) => { calls.repos.push(p); return repos[p] ?? { ok: true, repos: [], truncated: false }; },
    setProjectsRoot: async (r) => { calls.saved.push(r); return save ? save(r) : { ok: true, roots: r }; },
  };
  const t = translator('pt-BR');
  const ctx = { dialog, h, t: () => t, icon: (n) => ({ tag: 'svg', attrs: { class: n }, kids: [] }), api, toast: (m) => calls.toasts.push(m), errorText: (c) => `erro:${c}`, roots: () => roots, onSaved: async () => { calls.onSaved++; } };
  const view = () => ({ kids: dialog.kids });
  return {
    ctx, dialog, calls, rows: () => withClass(view(), 'fp-row'),
    row: (label) => withClass(view(), 'fp-row').find((r) => textOf(r) === label),
    up: () => walk(view()).find((n) => n.attrs?.['aria-label'] === 'Subir uma pasta'),
    use: () => walk(view()).find((n) => /btn primary/.test(n.attrs?.class ?? '')),
    path: () => withClass(view(), 'fp-path').map(textOf)[0],
    found: () => textOf({ kids: withClass(view(), 'fp-found') }),
  };
}

test('it opens on the drives and the home folder, with nothing to use and nowhere up to go', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  assert.equal(s.dialog.opened, true);
  assert.deepEqual(s.calls.folders, ['']);
  assert.deepEqual(s.rows().map(textOf), ['Sua pasta pessoal', 'C:\\', 'D:\\']);
  assert.equal(s.up().attrs.disabled, true);
  assert.equal(s.use().attrs.disabled, true);
  assert.equal(s.path(), 'Este computador');
});

test('walking in shows the folders (a repository marked), the way back, and the repositories found inside', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  await click(s.row('C:\\'));
  assert.deepEqual(s.rows().map(textOf), ['dev', 'toolsprojeto']);
  assert.equal(withClass({ kids: s.dialog.kids }, 'fp-badge').length, 1, 'only the repository wears the project mark');
  await click(s.row('dev'));
  assert.deepEqual(s.calls.folders, ['', 'C:\\', 'C:\\dev']);
  assert.deepEqual(s.calls.repos, ['C:\\', 'C:\\dev'], 'it looks for repositories in every folder it opens, never at the start');
  assert.match(s.found(), /Achei 2 projetos aqui dentro:\s+shop, api/);
  assert.equal(s.path(), 'C:\\dev');
  await click(s.up());
  assert.equal(s.calls.folders.at(-1), 'C:\\', 'up goes to the parent the server named');
});

test('it says when a folder holds nothing, how many it shows when there are many, and that it stopped looking when it did', async () => {
  const many = Array.from({ length: 12 }, (_, i) => `C:\\dev\\r${i}`);
  const s = setup({ repos: { 'C:\\dev': { ok: true, repos: many, truncated: true } } });
  await openFolderPicker(s.ctx);
  await click(s.row('C:\\'));
  assert.match(s.found(), /Nenhum projeto aqui dentro\./);
  await click(s.row('dev'));
  assert.match(s.found(), /Achei 12 projetos/);
  assert.match(s.found(), /r7, e mais 4/, 'eight names, then how many more');
  assert.match(s.found(), /pode haver mais/);
});

test('using a folder keeps it with the ones already picked, tells how many repositories came in, and closes', async () => {
  const s = setup({ roots: ['D:\\'] });
  await openFolderPicker(s.ctx);
  assert.equal(s.calls.folders[0], 'D:\\', 'it opens where the last pick is');
  await click(s.up());
  await click(s.row('C:\\'));
  await click(s.row('dev'));
  await click(s.use());
  assert.deepEqual(s.calls.saved, [['D:\\', 'C:\\dev']]);
  assert.equal(s.calls.onSaved, 1, 'the page reads its projects again');
  assert.equal(s.calls.closed, 1);
  assert.equal(s.calls.toasts.at(-1), 'Pasta guardada. 2 projetos entram na lista.');
});

test('a folder already picked is not added twice', async () => {
  const s = setup({ roots: ['C:\\dev'] });
  await openFolderPicker(s.ctx);
  await click(s.use());
  assert.deepEqual(s.calls.saved, []);
  assert.equal(s.calls.closed, 1);
});

test('taking a folder out keeps the rest; a refusal from the server shows its reason, keeps nothing and leaves the chooser open', async () => {
  const s = setup({ roots: ['D:\\a', 'D:\\'] });
  await openFolderPicker(s.ctx);
  const removes = () => withClass({ kids: s.dialog.kids }, 'small-btn').filter((n) => /Tirar/.test(textOf(n)));
  assert.equal(removes().length, 2);
  await click(removes()[0]);
  assert.deepEqual(s.calls.saved, [['D:\\']]);
  assert.deepEqual(withClass({ kids: s.dialog.kids }, 'fp-chosen-path').map(textOf), ['D:\\']);
  const refuse = setup({ save: () => ({ ok: false, error: 'config-unreadable' }) });
  await openFolderPicker(refuse.ctx);
  await click(refuse.row('C:\\'));
  await click(refuse.row('dev'));
  await click(refuse.use());
  assert.equal(refuse.calls.toasts.at(-1), 'erro:config-unreadable');
  assert.equal(refuse.calls.closed, 0);
  assert.equal(refuse.calls.onSaved, 0);
});

test('a folder that went away since the last pick sends it back to the drives, and a late answer never replaces a newer one', async () => {
  const gone = setup({ roots: ['E:\\gone'] });
  await openFolderPicker(gone.ctx);
  assert.deepEqual(gone.calls.folders, ['E:\\gone', ''], 'it tried, said why, and started over');
  assert.equal(gone.calls.toasts.at(-1), 'erro:not-a-folder');
  assert.deepEqual(gone.rows().map(textOf), ['Sua pasta pessoal', 'C:\\', 'D:\\']);
  // Two clicks in a row: the answer of the first arrives last and is dropped.
  let release;
  const slow = new Promise((r) => { release = r; });
  const s = setup();
  const real = s.ctx.api.folders;
  s.ctx.api.folders = async (p) => (p === 'C:\\' ? slow.then(() => LISTINGS['C:\\']) : real(p));
  await openFolderPicker(s.ctx);
  const first = click(s.row('C:\\'));
  const second = click(s.row('D:\\'));
  await second;
  release();
  await first;
  assert.equal(s.path(), 'D:\\', 'the late C:\\ did not replace the folder asked for last');
});

test('the project list has a row that opens the chooser, before "New project", and not for the look-only link', () => {
  const make = (extra = {}) => {
    const list = { kids: [], hidden: true, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], contains: () => false, replaceChildren(...k) { this.kids = k; } };
    const el = () => ({ attrs: {}, style: { setProperty() {} }, textContent: '', setAttribute() {}, addEventListener() {}, contains: () => false });
    const real = globalThis.document;
    globalThis.document = { activeElement: null, addEventListener() {} };
    const opened = [];
    const t = Object.assign((k) => k, { count: (k, n) => `${k}:${n}` });
    try {
      const picker = createProjectPicker({ root: el(), button: el(), list, name: el(), h, t: () => t, icon: () => null, onPick() {}, onNew: () => opened.push('new'), onFolders: () => opened.push('folders'), ...extra });
      picker.update([{ id: 'a', name: 'shop', hue: 1 }], 'a', new Map());
    } finally { globalThis.document = real; }
    return { list, opened };
  };
  const { list, opened } = make();
  assert.deepEqual(list.kids.map((k) => k.attrs['data-id']), ['a', ':folders', ':new']);
  assert.equal(textOf(list.kids[1]), 'folders.open');
  assert.deepEqual(make({ canNew: () => false }).list.kids.map((k) => k.attrs['data-id']), ['a'], 'a look-only visitor cannot reach it');
  assert.deepEqual(make({ onFolders: undefined }).list.kids.map((k) => k.attrs['data-id']), ['a', ':new']);
  assert.equal(opened.length, 0);
});

test('every text of the chooser is written in both languages, one and many reading differently', () => {
  const keys = ['folders.open', 'folders.title', 'folders.lede', 'folders.chosen', 'folders.none', 'folders.remove', 'folders.removeAria', 'folders.here', 'folders.home', 'folders.up', 'folders.repo', 'folders.repoTitle', 'folders.empty', 'folders.loading', 'folders.foundNone', 'folders.foundMore', 'folders.foundCut', 'folders.use', 'folders.close', 'folders.savedPlain', 'err.bad-folder', 'err.not-a-folder', 'err.no-access', 'err.bad-roots'];
  for (const lang of ['en', 'pt-BR']) {
    const t = translator(lang);
    for (const key of keys) assert.notEqual(t(key), key, `${lang}: ${key}`);
    for (const key of ['folders.found', 'folders.saved']) {
      assert.match(t.count(key, 3), /3/, `${lang}: ${key}`);
      assert.notEqual(t.count(key, 1).replace('1', '#'), t.count(key, 3).replace('3', '#'), `${lang}: ${key} reads differently for one and many`);
    }
  }
});
