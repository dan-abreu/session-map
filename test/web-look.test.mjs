// The "look only" link on the page (server.md sv04): the state answer says when the page was opened with it, the page then
// hides the chat and the buttons, and the owner makes, copies and turns off the link from the help menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api } from '../server/web/api.js';
import { LANGS } from '../server/web/i18n.js';
import { applyLook, createLookShare } from '../server/web/lookshare.js';

async function withFetch(answers, fn) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    const a = answers.shift();
    const headers = new Map(Object.entries(a.headers ?? {}));
    return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, json: async () => a.body ?? {} };
  };
  try { await fn(calls); } finally { globalThis.fetch = saved; }
}

test('api.state says look-only when the server marks the answer, and says nothing otherwise', async () => {
  await withFetch([
    { status: 200, body: { projects: [] }, headers: { etag: '"a"', 'x-look-only': '1' } },
    { status: 304, headers: { etag: '"a"', 'x-look-only': '1' } },
    { status: 200, body: { projects: [] }, headers: { etag: '"b"' } },
  ], async () => {
    assert.equal((await api.state()).look, true);
    assert.equal((await api.state()).look, true);
    assert.equal('look' in (await api.state()), false);
  });
});

test('the owner\'s link calls: read, make, turn off', async () => {
  await withFetch([{ status: 200 }, { status: 200 }, { status: 200 }], async (calls) => {
    await api.lookKey();
    await api.makeLookKey();
    await api.dropLookKey();
    assert.deepEqual(calls.map((c) => [c.init.method, c.path]), [['GET', '/api/settings/look-key'], ['POST', '/api/settings/look-key'], ['DELETE', '/api/settings/look-key']]);
    assert.equal(calls[1].init.headers['x-session-map'], '1');
  });
});

test('applyLook marks the page so the chat and the buttons hide; the style hides them', () => {
  const classes = new Set();
  const body = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  applyLook(body, true);
  assert.equal(classes.has('is-look'), true);
  applyLook(body, false);
  assert.equal(classes.has('is-look'), false);
  const css = readFileSync(new URL('../server/web/css/look.css', import.meta.url), 'utf8');
  for (const sel of ['#chat', '.btn', '#newChat', '#newBtn', '#viewBtn', '#lookShareOpen']) assert.match(css, new RegExp(`\\.is-look ${sel.replace(/[.#]/g, '\\$&')}\\b`), sel);
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="css\/look\.css"/);
  assert.match(html, /id="lookShareOpen"/);
  assert.match(html, /id="lookShareBox"/);
  assert.match(html, /id="lookBanner"/);
});

// ---- the owner's box, on a tiny fake page ----------------------------------------------------------------------------
const el = (tag, props = {}, ...kids) => ({ tag, props, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) });
const textOf = (n) => (typeof n === 'string' ? n : (n.kids ?? []).map(textOf).join(' '));
const walk = (n, fn) => { if (typeof n === 'string') return; fn(n); for (const k of n.kids) walk(k, fn); };
const find = (root, pred) => { const hits = []; for (const c of root.kids) walk(c, (n) => { if (pred(n)) hits.push(n); }); return hits; };
const t = (key, vars = {}) => LANGS.en[key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const LINK = `http://192.168.0.9:4001/?look=${'a'.repeat(64)}`;

function setup(first) {
  const box = { kids: [], hidden: true, replaceChildren(...k) { box.kids = k; } };
  const sent = [];
  const toasts = [];
  const copied = [];
  let now = first;
  const api = {
    lookKey: async () => ({ ok: true, ...now }),
    makeLookKey: async () => { sent.push('make'); now = { on: true, link: LINK }; return { ok: true, ...now }; },
    dropLookKey: async () => { sent.push('drop'); now = { on: false, link: null }; return { ok: true, ...now }; },
  };
  const share = createLookShare({ box, h: el, t: () => t, api, toast: (m) => toasts.push(m), copy: async (text) => copied.push(text) });
  return { box, share, sent, toasts, copied };
}

test('with no link yet the box explains it and offers to make one', async () => {
  const { box, share, sent } = setup({ on: false, link: null });
  await share.open();
  assert.equal(box.hidden, false);
  assert.match(textOf(box), /sees the map as it changes, and nothing else/);
  assert.equal(find(box, (n) => n.props.readonly).length, 0);
  await find(box, (n) => n.props['data-look'] === 'make')[0].props.onclick();
  assert.deepEqual(sent, ['make']);
  assert.equal(find(box, (n) => n.props.readonly)[0].props.value, LINK);
});

test('with a link on, the box shows it to copy, can make a new one or turn it off', async () => {
  const { box, share, sent, copied, toasts } = setup({ on: true, link: LINK });
  await share.open();
  assert.equal(find(box, (n) => n.props.readonly)[0].props.value, LINK);
  await find(box, (n) => n.props['data-look'] === 'copy')[0].props.onclick();
  assert.deepEqual(copied, [LINK]);
  assert.equal(toasts.at(-1), t('look.copied'));
  await find(box, (n) => n.props['data-look'] === 'drop')[0].props.onclick();
  assert.deepEqual(sent, ['drop']);
  assert.equal(toasts.at(-1), t('look.dropped'));
  assert.equal(find(box, (n) => n.props.readonly).length, 0);
  assert.equal(find(box, (n) => n.props['data-look'] === 'make').length, 1);
  await share.open();
  assert.equal(box.hidden, true, 'a second click folds the box');
});

test('a failed ask says so in plain words', async () => {
  const box = { kids: [], hidden: true, replaceChildren(...k) { box.kids = k; } };
  const toasts = [];
  const share = createLookShare({ box, h: el, t: () => t, api: { lookKey: async () => ({ ok: false, error: 'token-required' }) }, toast: (m) => toasts.push(m), copy: async () => {} });
  await share.open();
  assert.match(textOf(box), new RegExp(t('look.failed').slice(0, 20)));
});

test('the look-only texts exist in both languages', () => {
  for (const key of ['look.open', 'look.banner', 'look.lede', 'look.make', 'look.new', 'look.copy', 'look.copied', 'look.drop', 'look.dropped', 'look.linkLabel', 'look.failed']) {
    for (const lang of Object.values(LANGS)) assert.ok(lang[key]?.trim(), key);
  }
});
