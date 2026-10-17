import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProjectPicker } from '../server/web/picker.js';
import { openFolderPicker } from '../server/web/folderpick.js';
import { translator } from '../server/web/i18n.js';

// The folder chooser of the page (id164): walks the PC's folders (or goes to a typed path), picks one, keeps it; picks one
// folder for New project; and the project list's row that opens it.

const flat = (kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
const h = (tag, attrs, ...kids) => ({
  tag, attrs: attrs ?? {}, kids: flat(kids), value: attrs?.value ?? '',
  replaceChildren(...k) { this.kids = flat(k); },
  setAttribute(name, v) { this.attrs[name] = v; },
});
const walk = (node, out = []) => { if (node && typeof node === 'object') { out.push(node); node.kids?.forEach((k) => walk(k, out)); } return out; };
const withClass = (node, cls) => walk(node).filter((n) => new RegExp(`(^| )${cls}( |$)`).test(n.attrs?.class ?? ''));
const textOf = (node) => (typeof node === 'object' && node ? (node.kids ?? []).map(textOf).join('') : String(node ?? ''));
const click = (node) => node.attrs.onclick();

const LISTINGS = {
  '': { ok: true, path: '', parent: null, home: 'C:\\Users\\ana', entries: [{ name: 'C:\\', path: 'C:\\', repo: false }, { name: 'D:\\', path: 'D:\\', repo: false }] },
  'C:\\': { ok: true, path: 'C:\\', parent: '', entries: [{ name: 'dev', path: 'C:\\dev', repo: false }, { name: 'tools', path: 'C:\\tools', repo: true }, { name: 'Dev-old', path: 'C:\\Dev-old', repo: false }] },
  'C:\\dev': { ok: true, path: 'C:\\dev', parent: 'C:\\', entries: [{ name: 'shop', path: 'C:\\dev\\shop', repo: true }] },
  'D:\\': { ok: true, path: 'D:\\', parent: '', entries: [] },
};
const REPOS = { 'C:\\dev': { ok: true, repos: ['C:\\dev\\shop', 'C:\\dev\\api'], truncated: false } };

function setup({ roots = [], listings = LISTINGS, repos = REPOS, save, mode, start } = {}) {
  const calls = { folders: [], repos: [], saved: [], toasts: [], onSaved: 0, closed: 0, picked: [] };
  const dialog = { kids: [], opened: false, replaceChildren(...k) { this.kids = k; }, showModal() { this.opened = true; }, close() { calls.closed++; } };
  const api = {
    folders: async (p) => { calls.folders.push(p); return listings[p] ?? { ok: false, error: 'not-a-folder' }; },
    folderRepos: async (p) => { calls.repos.push(p); return repos[p] ?? { ok: true, repos: [], truncated: false }; },
    setProjectsRoot: async (r) => { calls.saved.push(r); return save ? save(r) : { ok: true, roots: r }; },
  };
  const t = translator('pt-BR');
  const ctx = {
    dialog, h, t: () => t, icon: (n) => ({ tag: 'svg', attrs: { class: n }, kids: [] }), api, toast: (m) => calls.toasts.push(m), errorText: (c) => `erro:${c}`,
    roots: () => roots, onSaved: async () => { calls.onSaved++; }, mode, start, onPick: (p) => calls.picked.push(p),
  };
  const view = () => ({ kids: dialog.kids });
  const input = (cls) => withClass(view(), cls)[0];
  return {
    ctx, dialog, calls, view, rows: () => withClass(view(), 'fp-row'),
    row: (label) => withClass(view(), 'fp-row').find((r) => textOf(r) === label),
    up: () => walk(view()).find((n) => n.attrs?.['aria-label'] === 'Subir um nível'),
    use: () => walk(view()).find((n) => /btn primary/.test(n.attrs?.class ?? '')),
    path: () => input('fp-path-input').value,
    typePath: (text) => { const el = input('fp-path-input'); el.value = text; el.attrs.oninput(); return el.attrs.onkeydown({ key: 'Enter' }); },
    filter: (text) => { const el = input('fp-filter'); el.value = text; el.attrs.oninput(); },
    found: () => textOf({ kids: withClass(view(), 'fp-found') }),
    title: () => textOf(walk(view()).find((n) => n.tag === 'h2')),
  };
}

test('it opens on the drives and the user folder, with nothing to use and nowhere up to go', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  assert.equal(s.dialog.opened, true);
  assert.deepEqual(s.calls.folders, ['']);
  assert.deepEqual(s.rows().map(textOf), ['Pasta do usuário', 'C:\\', 'D:\\']);
  assert.equal(s.up().disabled, true);
  assert.equal(s.use().disabled, true);
  assert.equal(s.path(), '', 'no path yet: the field waits for one');
  assert.match(withClass(s.view(), 'fp-path-input')[0].attrs.placeholder, /Este computador/);
});

test('walking in shows the folders (a repository marked), the way back, and the projects found inside', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  await click(s.row('C:\\'));
  assert.deepEqual(s.rows().map(textOf), ['dev', 'toolsprojeto', 'Dev-old']);
  assert.equal(withClass(s.view(), 'fp-badge').length, 1, 'only the repository wears the project mark');
  await click(s.row('dev'));
  assert.deepEqual(s.calls.folders, ['', 'C:\\', 'C:\\dev']);
  assert.deepEqual(s.calls.repos, ['C:\\', 'C:\\dev'], 'it looks for repositories in every folder it opens, never at the start');
  assert.match(s.found(), /Encontrados 2 projetos nesta pasta:\s+shop, api/);
  assert.equal(s.path(), 'C:\\dev');
  assert.equal(s.up().disabled, false);
  await click(s.up());
  assert.equal(s.calls.folders.at(-1), 'C:\\', 'up goes to the parent the server named');
});

test('a path can be typed or pasted: Enter goes there; a wrong one says why, stays put and keeps what was typed', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  await s.typePath('C:\\dev');
  assert.equal(s.calls.folders.at(-1), 'C:\\dev');
  assert.equal(s.path(), 'C:\\dev');
  assert.deepEqual(s.rows().map(textOf), ['shop' + 'projeto']);
  await s.typePath('  Z:\\nowhere  ');
  assert.equal(s.calls.folders.at(-1), 'Z:\\nowhere', 'spaces around a pasted path do not matter');
  assert.equal(s.calls.toasts.at(-1), 'erro:not-a-folder');
  assert.equal(s.path(), '  Z:\\nowhere  ', 'it keeps the text so it can be fixed');
  assert.deepEqual(s.rows().map(textOf), ['shop' + 'projeto'], 'and stays in the folder it was in');
  await s.typePath('');
  assert.equal(s.calls.folders.at(-1), '', 'an empty path is the start');
  assert.deepEqual(s.rows().map(textOf), ['Pasta do usuário', 'C:\\', 'D:\\']);
});

test('the folders of the open one can be filtered by name; going to another folder clears the filter', async () => {
  const s = setup();
  await openFolderPicker(s.ctx);
  await click(s.row('C:\\'));
  s.filter('DEV');
  assert.deepEqual(s.rows().map(textOf), ['dev', 'Dev-old'], 'no matter the case');
  s.filter('zzz');
  assert.deepEqual(s.rows(), []);
  assert.match(textOf(withClass(s.view(), 'fp-list')[0]), /Nenhuma pasta corresponde ao filtro\./);
  s.filter('tool');
  await click(s.row('toolsprojeto'));
  assert.equal(withClass(s.view(), 'fp-filter')[0].value, '', 'a new folder starts with no filter');
});

test('it says when a folder holds nothing, how many it shows when there are many, and that it stopped looking when it did', async () => {
  const many = Array.from({ length: 12 }, (_, i) => `C:\\dev\\r${i}`);
  const s = setup({ repos: { 'C:\\dev': { ok: true, repos: many, truncated: true } } });
  await openFolderPicker(s.ctx);
  await click(s.row('C:\\'));
  assert.match(s.found(), /Nenhum projeto encontrado nesta pasta\./);
  await click(s.row('dev'));
  assert.match(s.found(), /Encontrados 12 projetos/);
  assert.match(s.found(), /r7, e mais 4/, 'eight names, then how many more');
  assert.match(s.found(), /pode haver mais/);
  await click(s.row('shopprojeto'));
});

test('using a folder keeps it with the ones already picked, tells how many projects came in, and closes', async () => {
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
  assert.equal(s.calls.toasts.at(-1), 'Pasta salva. 2 projetos adicionados à lista.');
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
  const removes = () => withClass(s.view(), 'small-btn').filter((n) => /Remover/.test(textOf(n)));
  assert.equal(removes().length, 2);
  await click(removes()[0]);
  assert.deepEqual(s.calls.saved, [['D:\\']]);
  assert.deepEqual(withClass(s.view(), 'fp-chosen-path').map(textOf), ['D:\\']);
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
  assert.deepEqual(gone.calls.folders, ['E:\\gone', ''], 'it tried and started over from the drives');
  assert.deepEqual(gone.rows().map(textOf), ['Pasta do usuário', 'C:\\', 'D:\\']);
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

test('picking one folder (the Browse… of New project): it opens on the path given, hands the folder back and keeps nothing', async () => {
  const s = setup({ mode: 'pick', start: 'C:\\dev', roots: ['D:\\'] });
  await openFolderPicker(s.ctx);
  assert.equal(s.title(), 'Selecionar pasta');
  assert.deepEqual(s.calls.folders, ['C:\\dev'], 'it opens where the field already points');
  assert.deepEqual(s.calls.repos, [], 'it does not look for projects: a folder to create in is all that is wanted');
  assert.equal(withClass(s.view(), 'fp-chosen').length, 0, 'the folders kept are not shown or touched');
  assert.equal(withClass(s.view(), 'fp-found').length, 0);
  await click(s.use());
  assert.deepEqual(s.calls.picked, ['C:\\dev'], 'the folder it stood in');
  assert.deepEqual(s.calls.saved, []);
  assert.equal(s.calls.onSaved, 0);
  assert.equal(s.calls.closed, 1);
});

test('picking: a path that is not a folder starts from the drives without a complaint, and a typed one still goes', async () => {
  const s = setup({ mode: 'pick', start: 'Q:\\typo' });
  await openFolderPicker(s.ctx);
  assert.deepEqual(s.calls.folders, ['Q:\\typo', '']);
  assert.deepEqual(s.calls.toasts, [], 'the field was typed by hand: no error for a first look');
  await s.typePath('C:\\dev');
  await click(s.use());
  assert.deepEqual(s.calls.picked, ['C:\\dev']);
  const empty = setup({ mode: 'pick' });
  await openFolderPicker(empty.ctx);
  assert.deepEqual(empty.calls.folders, [''], 'nothing typed: the start');
});

test('New project has a Browse… next to the folder field, and it opens the chooser in picking mode', () => {
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /t\('folders\.browse'\)/);
  assert.match(app, /mode: 'pick', start: parentInput\.value\.trim\(\)/);
  assert.match(app, /onPick: \(path\) => \{ parentInput\.value = path; showPath\(\)/);
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
  const keys = ['folders.open', 'folders.title', 'folders.lede', 'folders.chosen', 'folders.none', 'folders.remove', 'folders.removeAria', 'folders.here', 'folders.home', 'folders.up', 'folders.repo', 'folders.repoTitle', 'folders.empty', 'folders.loading', 'folders.foundNone', 'folders.foundMore', 'folders.foundCut', 'folders.use', 'folders.close', 'folders.savedPlain', 'folders.browse', 'folders.pickTitle', 'folders.pickLede', 'folders.pathLabel', 'folders.pathHint', 'folders.filter', 'folders.filterLabel', 'folders.noMatch', 'err.bad-folder', 'err.not-a-folder', 'err.no-access', 'err.bad-roots'];
  for (const lang of ['en', 'pt-BR']) {
    const t = translator(lang);
    for (const key of keys) assert.notEqual(t(key), key, `${lang}: ${key}`);
    for (const key of ['folders.found', 'folders.saved']) {
      assert.match(t.count(key, 3), /3/, `${lang}: ${key}`);
      assert.notEqual(t.count(key, 1).replace('1', '#'), t.count(key, 3).replace('3', '#'), `${lang}: ${key} reads differently for one and many`);
    }
  }
});
