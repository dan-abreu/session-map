import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscover } from '../server/web/discover.js';

// Just enough DOM for discover.js: elements with children, listeners, and a <select> whose value follows its options.
class El {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.classList = { toggle() {} };
    this.disabled = false;
    this.textContent = '';
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(c) { this.children.push(typeof c === 'string' ? Object.assign(new El('#text'), { textContent: c }) : c); }
  replaceChildren(...cs) { this.children = []; for (const c of cs) this.append(c); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  async fire(type) { for (const fn of this.listeners[type] ?? []) await fn({ target: this }); }
  get value() {
    if (this.tag !== 'select') return this._value ?? '';
    const options = this.children.filter((c) => c.tag === 'option');
    return options.some((o) => o.value === this._value) ? this._value : options[0]?.value ?? '';
  }
  set value(v) { this._value = v; }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
  *all() { yield this; for (const c of this.children) yield* c.all(); }
}

function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

const find = (el, pred) => [...el.all()].find(pred);
const byId = (el, id) => find(el, (e) => e.attrs.id === id);
const button = (el, text) => find(el, (e) => e.tag === 'button' && e.text === text);

test('install with several plugins keeps the project scope on the second step', async () => {
  const nodes = Object.fromEntries(['#installDialog', '#discoverSearch', '#discoverSort', '#discoverType', '#discoverCategory', '#discoverRefresh', '#discoverStatus', '#discoverList']
    .map((sel) => [sel, new El(sel === '#discoverSort' || sel === '#discoverType' || sel === '#discoverCategory' ? 'select' : 'div')]));
  const dialog = Object.assign(nodes['#installDialog'], { open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const item = { repo: 'ana/kit', name: 'kit', owner: 'ana', url: 'https://github.com/ana/kit', description: 'd', stars: 3, type: 'plugin', category: 'other', hasMarketplace: true };
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('/api/catalog')) return { ok: true, status: 200, json: async () => ({ items: [item], total: 1 }) };
    const body = JSON.parse(opts.body);
    posted.push(body);
    return body.plugin
      ? { ok: true, status: 200, json: async () => ({ installed: 'one@kit' }) }
      : { ok: false, status: 409, json: async () => ({ error: 'choose-plugin', plugins: ['one', 'two'] }) };
  };
  try {
    const discover = createDiscover({
      root: { querySelector: (sel) => nodes[sel], hidden: true },
      h, t: () => (key) => key, lang: () => 'en', project: () => ({ id: 'shop-abc123', name: 'shop' }), toast() {},
    });
    discover.show();
    await new Promise((r) => setImmediate(r));
    await button(nodes['#discoverList'], 'discover.install').fire('click');
    byId(dialog, 'installScope').value = 'project';
    await button(dialog, 'discover.confirm.go').fire('click');

    const scope = byId(dialog, 'installScope');
    assert.equal(scope.value, 'project', 'the second step keeps the scope the marketplace was added with');
    assert.equal(scope.disabled, true, 'and does not let it change any more');
    await button(dialog, 'discover.confirm.go').fire('click');
    assert.deepEqual(posted.map((b) => [b.scope, b.projectId, b.plugin]), [['project', 'shop-abc123', undefined], ['project', 'shop-abc123', 'one']]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
