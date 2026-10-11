// The purple project box opens on both sides (id77): the architecture to the right, the repository to the left. The words of
// that side, the refusal of a secrets file, the "new" file that blinks once, the phone's repository section and the
// selection that comes from outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import model from '../server/web/i18n-fd/model.js';
import { LANGS } from '../server/web/i18n.js';
import { createFiles, isSecretPath } from '../server/web/files.js';
import { createOutline } from '../server/web/outline.js';
import { createMindmap, newFiles } from '../server/web/mindmap.js';

// ---- a very small page, enough for the code that draws boxes ----
class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this.style = { setProperty() {} };
    this.parent = null;
    this.hidden = false;
    this.open = false;
    this.textContent = '';
    this.offsetWidth = 100;
    this.offsetHeight = 30;
    const own = new Set();
    this.classList = {
      add: (c) => own.add(c),
      remove: (c) => own.delete(c),
      toggle: (c, on) => { if (on === undefined ? !own.has(c) : on) own.add(c); else own.delete(c); },
      contains: (c) => own.has(c),
    };
    Object.defineProperty(this, 'className', { get: () => [...own].join(' '), set: (v) => { own.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) own.add(c); } });
  }
  append(...kids) { for (const k of kids) { if (k && typeof k === 'object') k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ target: this, ...ev }); }
  set innerHTML(_) { this.children = []; }
  focus() {}
  closest() { return null; }
  get firstChild() { return this.children[0]; }
  find(pred) { return pred(this) ? this : this.children.flatMap((c) => (c instanceof El ? [c.find(pred)] : [])).find(Boolean) ?? null; }
  all(pred) { return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => (c instanceof El ? c.all(pred) : []))]; }
  querySelector(sel) { return this.find(matcher(sel)); }
}
const matcher = (sel) => {
  const id = sel.match(/data-id="([^"]+)"/)?.[1];
  const cls = sel.match(/\.([\w-]+)$/)?.[1];
  return (n) => (id ? n.dataset?.id === id && (!cls || n.classList.contains(cls)) : cls ? n.classList.contains(cls) : false);
};
const withPage = (run) => {
  const saved = { document: globalThis.document, window: globalThis.window, CSS: globalThis.CSS, d3: globalThis.d3, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  const chain = new Proxy(function chainable() { return chain; }, { get: (_, key) => (key === 'then' ? undefined : chain), apply: () => chain });
  globalThis.document = { createElement: (tag) => new El(tag), createElementNS: (_, tag) => new El(tag), activeElement: null };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.CSS = { escape: (s) => s };
  globalThis.d3 = { zoom: () => chain, select: () => chain, zoomIdentity: chain, easeCubicOut: chain };
  globalThis.requestAnimationFrame = (fn) => { fn(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    return run();
  } finally {
    Object.assign(globalThis, { document: saved.document, window: saved.window, CSS: saved.CSS, d3: saved.d3, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
  }
};

const file = (name, status = null, extra = {}) => ({ id: `rf:${name}`, kind: 'file', side: 'left', label: name, path: name, status, children: [], ...extra });
const folder = (name, children) => ({ id: `rd:${name}`, kind: 'folder', side: 'left', label: name, path: name, children });

// ---- the words ----
test('every word of the repository side is in English and in Portuguese, none empty', () => {
  assert.deepEqual(Object.keys(model['pt-BR']).sort(), Object.keys(model.en).sort());
  assert.ok(Object.keys(model.en).length > 0, 'the side has words of its own');
  for (const lang of ['en', 'pt-BR']) {
    for (const [k, v] of Object.entries(model[lang])) {
      assert.ok(typeof v === 'string' && v.trim(), `${lang} ${k} is empty`);
      assert.equal(LANGS[lang][k], v, `${lang} ${k} reaches the page dictionary`);
    }
  }
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(model.en)) assert.deepEqual(vars(model['pt-BR'][k]), vars(model.en[k]), k);
});

test('the phone section of the repository has a name in both languages', () => {
  assert.ok(model.en['repo.section'] && model['pt-BR']['repo.section']);
});

// ---- a secrets file is never asked for ----
test('files.open refuses a secrets file without asking the server, and shows the notice instead of the file', async () => {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: false, status: 404, json: async () => ({ error: 'not-found' }), headers: { get: () => null } }; };
  try {
    const toasts = [];
    const dialog = { replaceChildren() {}, classList: { remove() {} }, open: false, showModal() {} };
    const files = createFiles({ dialog, h: () => null, t: () => (k) => k, toast: (m) => toasts.push(m), errorText: (c) => `err:${c}`, project: () => ({ id: 'acme-shop-1' }) });
    for (const path of ['.env', 'apps/api/.env.local', 'apps/web/.ENV']) await files.openPath(path);
    assert.deepEqual(calls, [], 'the server was not even asked');
    assert.deepEqual(toasts, Array(3).fill('err:sensitive'));
    await files.open('.env');
    assert.equal(calls.length, 0, 'open is the same door');
    await files.openPath('.env.example');
    assert.equal(calls.length, 1, 'a template is a normal file');
    assert.match(calls[0], /\.env\.example/);
  } finally {
    globalThis.fetch = saved;
  }
});

test('isSecretPath follows the server rule: .env and its variants, not the templates', () => {
  for (const p of ['.env', '.env.local', 'a/b/.env.production']) assert.equal(isSecretPath(p), true, p);
  for (const p of ['.env.example', 'x/.env.sample', '.env.template', '.env.dist', 'src/env.js', 'environment.ts']) assert.equal(isSecretPath(p), false, p);
});

// ---- the new file blinks once ----
test('newFiles: after the first look, a file that is new and was not there before is the one that blinks', () => {
  const tree = (...kids) => ({ id: 'files', children: kids });
  const first = newFiles(tree(folder('apps', [file('apps/a.ts', 'A')]), file('b.ts', 'M')), null);
  assert.deepEqual(first.fresh, [], 'the first look blinks nothing');
  assert.deepEqual([...first.seen], ['rf:apps/a.ts']);
  const second = newFiles(tree(folder('apps', [file('apps/a.ts', 'A'), file('apps/c.ts', 'A')]), file('b.ts', 'M')), first.seen);
  assert.deepEqual(second.fresh, ['rf:apps/c.ts'], 'only the one that arrived');
  const third = newFiles(tree(folder('apps', [file('apps/a.ts', 'A'), file('apps/c.ts', 'A')])), second.seen);
  assert.deepEqual(third.fresh, [], 'nothing arrived: nothing blinks again');
  const closed = newFiles(tree(folder('deep', [folder('deep/in', [file('deep/in/z.ts', 'A')])])), third.seen);
  assert.deepEqual(closed.fresh, ['rf:deep/in/z.ts'], 'a file in a closed folder counts as arrived (it is not shown yet, so it just does not blink)');
  assert.deepEqual(newFiles(null, third.seen), { fresh: [], seen: null }, 'side turned off: forgets');
});

const mapView = (left, extra = {}) => ({ open: new Set(['p']), selected: null, live: new Set(), left, ...extra });
const root = () => ({ id: 'p', kind: 'project', label: 'acme', children: [], isRoot: true });
const leftCtx = (log = []) => ({
  content: (n) => [{ tag: 'span', text: n.label }], signature: (n) => n.label, toggleLabel: (n) => `toggle ${n.label}`,
  onPick: (n) => log.push(['pick', n.id]), onToggle: (n) => log.push(['toggle', n.id]), classes: (n) => ({ 'is-excluded': Boolean(n.excluded) }),
});
const mapCtx = () => ({ content: () => [], signature: (n) => n.id, toggleLabel: () => '', onPick() {}, onToggle() {}, freeArea: () => ({ left: 0, top: 0, width: 800, height: 600 }) });

test('the map: a file that arrives new blinks once; the first drawing blinks nothing; leaving and coming back forgets', () => withPage(() => {
  const el = new El('div');
  const map = createMindmap(el, mapCtx());
  const side = (kids) => ({ tree: { id: 'files', children: kids }, open: new Set(['rd:apps']), ctx: leftCtx(), lit: null, live: new Set() });
  const boxOf = (id) => el.find((n) => n.dataset?.id === id);
  map.render(root(), mapView(side([folder('apps', [file('apps/a.ts', 'A')])])));
  assert.equal(boxOf('rf:apps/a.ts').classList.contains('is-pulse'), false, 'the first look is calm');
  map.render(root(), mapView(side([folder('apps', [file('apps/a.ts', 'A'), file('apps/new.ts', 'A')])])));
  assert.equal(boxOf('rf:apps/new.ts').classList.contains('is-pulse'), true, 'the new file blinks');
  assert.equal(boxOf('rf:apps/a.ts').classList.contains('is-pulse'), false, 'the old one does not');
  map.render(root(), mapView(null));
  map.render(root(), mapView(side([folder('apps', [file('apps/a.ts', 'A'), file('apps/new.ts', 'A')])])));
  assert.equal(boxOf('rf:apps/new.ts').classList.contains('is-pulse'), false, 'a side turned on again is a first look');
}));

test('the map: select(id) from outside marks that box and only that one, and says whether it found it', () => withPage(() => {
  const el = new El('div');
  const map = createMindmap(el, mapCtx());
  const part = (id) => ({ id, kind: 'part', label: id, children: [] });
  const tree = { ...root(), children: [part('pt:a'), part('pt:b')] };
  map.render(tree, mapView(null));
  const boxOf = (id) => el.find((n) => n.dataset?.id === id);
  assert.equal(map.select('pt:a'), true);
  assert.equal(boxOf('pt:a').classList.contains('is-selected'), true);
  assert.equal(boxOf('pt:a').children[0].getAttribute('aria-current'), 'true');
  assert.equal(map.select('pt:b'), true);
  assert.equal(boxOf('pt:a').classList.contains('is-selected'), false);
  assert.equal(boxOf('pt:b').classList.contains('is-selected'), true);
  assert.equal(map.select('pt:gone'), false);
  assert.equal(boxOf('pt:b').classList.contains('is-selected'), true, 'a box that is not there keeps the selection as it was');
  assert.equal(map.select(null), true, 'null clears');
  assert.equal(boxOf('pt:b').classList.contains('is-selected'), false);
}));

// ---- the phone ----
const part = (id) => ({ id, kind: 'part', label: id, children: [] });
test('the phone: the repository is a folded section under the project, opened by the person and kept across redraws', () => withPage(() => {
  const el = new El('div');
  const log = [];
  const outline = createOutline(el, mapCtx());
  const tree = { ...root(), children: [part('pt:a')] };
  const left = { tree: { id: 'files', children: [folder('apps', [file('apps/a.ts', 'A')]), file('README.md')] }, open: new Set(['rd:apps']), ctx: leftCtx(log), lit: null, live: new Set(), label: 'Project files' };
  outline.render(tree, mapView(left));
  const section = el.find((n) => n.tag === 'details' && n.classList.contains('ol-repo'));
  assert.ok(section, 'a section for the repository');
  assert.equal(section.open, false, 'folded at first');
  const summary = section.children[0];
  assert.equal(summary.tag, 'summary');
  assert.equal(summary.textContent, 'Project files');
  // After the project's own rows, never before them.
  const rows = el.all((n) => n.classList?.contains('ol-item')).map((n) => n.dataset.id);
  assert.ok(rows.indexOf('p') < rows.indexOf('rd:apps'));
  assert.ok(rows.includes('rf:apps/a.ts') && rows.includes('rf:README.md'), 'the open folder shows its file');
  section.open = true;
  section.fire('toggle');
  outline.render(tree, mapView(left));
  assert.equal(el.find((n) => n.classList?.contains('ol-repo')).open, true, 'a redraw keeps it open');
  // A row of the repository speaks to the files side, not to the architecture.
  el.find((n) => n.dataset?.id === 'rf:README.md').find((n) => n.classList?.contains('ol-box')).fire('click');
  assert.deepEqual(log, [['pick', 'rf:README.md']]);
  assert.equal(el.find((n) => n.dataset?.id === 'rf:README.md').find((n) => n.classList?.contains('ol-row')).classList.contains('is-excluded'), false);
}));

test('the phone: without a files side there is no section; a new file blinks, an excluded one is grey', () => withPage(() => {
  const el = new El('div');
  const outline = createOutline(el, mapCtx());
  const tree = { ...root(), children: [part('pt:a')] };
  outline.render(tree, mapView(null));
  assert.equal(el.find((n) => n.classList?.contains('ol-repo')), null);
  const base = [file('a.ts', 'A'), file('lib.js', null, { excluded: 'dep' })];
  const left = (kids) => ({ tree: { id: 'files', children: kids }, open: new Set(), ctx: leftCtx(), lit: null, live: new Set(), label: 'Project files' });
  outline.render(tree, mapView(left(base)));
  const rowOf = (id) => el.find((n) => n.dataset?.id === id).find((n) => n.classList?.contains('ol-row'));
  assert.equal(rowOf('rf:a.ts').classList.contains('is-pulse'), false);
  assert.equal(rowOf('rf:lib.js').classList.contains('is-excluded'), true);
  outline.render(tree, mapView(left([...base, file('b.ts', 'A')])));
  assert.equal(rowOf('rf:b.ts').classList.contains('is-pulse'), true);
  assert.equal(rowOf('rf:a.ts').classList.contains('is-pulse'), false);
}));

// ---- the style ----
test('the style that the census view needed is in fd-model.css, with colours only from the page tokens', () => {
  const css = readFileSync(new URL('../server/web/css/fd-model.css', import.meta.url), 'utf8');
  for (const cls of ['.is-noowner', '.fdc-tag', '.fdc-folder', '.fdc-controls', '.fdc-crumb', '.fdc-cell', '.fdc-rev', '.fdc-kind--added', '.fdc-kind--removed', '.fdc-kind--changed', '.fdc-files', '.fdc-line.is-off', '.fdc-read.is-complete', '.fdc-read.is-unread', '.fdc-excluded summary', '.ol-repo']) {
    assert.ok(css.includes(cls), `${cls} has a rule`);
  }
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no fixed colour');
});

test('files.census mounts the census view in a place of the page, asks only for reading, and opens a file through the same door', async () => {
  const urls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => { urls.push([String(url), init?.method ?? 'GET']); return { ok: true, status: 200, json: async () => null, headers: { get: () => null } }; };
  try {
    const dialog = { replaceChildren() {}, classList: { remove() {} }, open: false, showModal() {} };
    const h = (tag, attrs = {}, ...children) => {
      const el = new El(tag);
      for (const [k, v] of Object.entries(attrs)) if (!k.startsWith('on')) el.setAttribute(k, v);
      el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
      return el;
    };
    const files = createFiles({ dialog, h, t: () => Object.assign((k) => k, { count: (k) => k }), toast() {}, errorText: (c) => c, project: () => ({ id: 'acme-shop-1' }), lang: () => 'en' });
    const place = new El('div');
    await files.census(place);
    assert.ok(place.children.length, 'the view was drawn in the place');
    assert.deepEqual(urls.map(([, m]) => m), ['GET', 'GET', 'GET']);
    assert.ok(urls.every(([u]) => u.includes('/api/foundation/acme-shop-1/')));
  } finally {
    globalThis.fetch = saved;
  }
});
