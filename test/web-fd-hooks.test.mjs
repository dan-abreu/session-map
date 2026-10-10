import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { api } from '../server/web/api.js';
import { badgeNode, claimBadge, stateBadge } from '../server/web/badges.js';
import { LANGS, TECH, translator } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const FD_TEXTS = ['badges', 'read', 'model', 'care', 'health', 'guide', 'screens'];
const FD_CSS = ['model', 'care', 'health', 'guide', 'screens'];

async function withFetch(answer, fn) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    if (answer === 'network') throw new TypeError('failed');
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  try { await fn(calls); } finally { globalThis.fetch = saved; }
}

test('api.fd reads one foundation answer, keeping null and arrays as data', async () => {
  await withFetch({ status: 200, body: null }, async (calls) => {
    assert.deepEqual(await api.fd('acme-shop-8324f1', 'census'), { ok: true, status: 200, data: null });
    assert.equal(calls[0].path, '/api/foundation/acme-shop-8324f1/census');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers['x-session-map'], undefined, 'a read carries no write header');
  });
  await withFetch({ status: 200, body: [{ rev: 2 }] }, async (calls) => {
    assert.deepEqual((await api.fd('acme-shop-8324f1', 'census/log', { since: 1, part: undefined })).data, [{ rev: 2 }]);
    assert.equal(calls[0].path, '/api/foundation/acme-shop-8324f1/census/log?since=1');
  });
  await withFetch({ status: 200, body: {} }, async (calls) => {
    await api.fd('acme shop', 'findings/f:3b');
    assert.equal(calls[0].path, '/api/foundation/acme%20shop/findings/f%3A3b');
    await api.fd(null, 'library', { project: 'acme-shop-8324f1' });
    assert.equal(calls[1].path, '/api/library?project=acme-shop-8324f1', 'the Library route lives outside any project');
  });
});

test('api.fd and api.fdWrite turn failures into one error word', async () => {
  await withFetch({ status: 401, body: 'token required' }, async () => {
    assert.deepEqual(await api.fd('acme-shop-8324f1', 'census'), { ok: false, status: 401, data: null, error: 'token-required' });
  });
  await withFetch({ status: 404, body: { ok: false, error: 'unknown-project' } }, async () => {
    assert.deepEqual(await api.fd('x', 'census'), { ok: false, status: 404, data: null, error: 'unknown-project' });
  });
  await withFetch('network', async () => {
    assert.deepEqual(await api.fdWrite('x', 'refresh'), { ok: false, status: 0, data: null, error: 'network' });
  });
});

test('api.fdWrite sends JSON with the write header, POST unless told otherwise', async () => {
  await withFetch({ status: 200, body: { started: true } }, async (calls) => {
    assert.deepEqual(await api.fdWrite('acme-shop-8324f1', 'refresh'), { ok: true, status: 200, data: { started: true } });
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['x-session-map'], '1');
    assert.equal(calls[0].init.body, '{}');
    await api.fdWrite('acme-shop-8324f1', 'care', { mode: 'look' }, 'PUT');
    assert.equal(calls[1].init.method, 'PUT');
    assert.equal(calls[1].init.body, '{"mode":"look"}');
  });
  await withFetch({ status: 403, body: { ok: false, error: 'demo' } }, async () => {
    assert.equal((await api.fdWrite('acme-shop-8324f1', 'refresh')).error, 'demo');
  });
});

test('the three seals of a claim and the stale mark', () => {
  assert.deepEqual(claimBadge({ badge: 'confirmed' }), { id: 'confirmed', mark: '✅', key: 'badge.confirmed', hint: 'badge.confirmed.hint', stale: false });
  assert.equal(claimBadge({ badge: 'interpretation' }).mark, '🔍');
  assert.equal(claimBadge({ badge: 'not-found' }).mark, '❓');
  assert.equal(claimBadge({ badge: 'made-up' }).id, 'not-found', 'anything unknown is never shown as confirmed');
  assert.equal(claimBadge(null).id, 'not-found');
  assert.equal(claimBadge({ badge: 'toString' }).id, 'not-found', 'a word inherited by every object is not a seal');
  assert.equal(stateBadge('constructor').id, 'unverified');
  assert.equal(claimBadge({ id: 'claim:1', badge: 'confirmed' }, { stale: ['claim:1'] }).stale, true);
  assert.equal(claimBadge('interpretation').id, 'interpretation', 'the badge word alone works too');
});

test('the four states of a checked line', () => {
  const marks = Object.fromEntries(['confirmed', 'pass', 'warning', 'fail', 'unverified', 'na', 'odd'].map((s) => [s, stateBadge(s).mark]));
  assert.deepEqual(marks, { confirmed: '✅', pass: '✅', warning: '⚠️', fail: '⚠️', unverified: '❓', na: '➖', odd: '❓' });
  assert.equal(stateBadge('fail').key, 'mark.fail');
  assert.equal(stateBadge('odd').key, 'mark.unverified');
});

test('badgeNode draws the mark hidden from screen readers and the word in the page language', () => {
  const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat() });
  const t = translator('pt-BR');
  const node = badgeNode(h, t, claimBadge({ badge: 'confirmed' }));
  assert.equal(node.tag, 'span');
  assert.equal(node.attrs.class, 'fd-badge fd-badge--confirmed');
  assert.equal(node.attrs.title, t('badge.confirmed.hint'));
  assert.deepEqual(node.children[0], { tag: 'span', attrs: { 'aria-hidden': 'true' }, children: ['✅'] });
  assert.ok(node.children.includes(t('badge.confirmed')));
  const old = badgeNode(h, t, claimBadge({ id: 'c', badge: 'interpretation' }, { stale: ['c'] }));
  assert.match(old.attrs.class, /fd-badge--stale/);
  assert.ok(old.children.includes(t('badge.stale')));
});

test('every foundation text file has the same keys in en and pt-BR, with the same blanks', async () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const name of FD_TEXTS) {
    const { default: part } = await import(new URL(`i18n-fd/${name}.js`, WEB));
    for (const group of [part, part.tech ?? { en: {}, 'pt-BR': {} }]) {
      assert.deepEqual(Object.keys(group['pt-BR']).sort(), Object.keys(group.en).sort(), name);
      for (const [k, v] of Object.entries(group.en)) {
        assert.ok(typeof v === 'string' && v.trim() && group['pt-BR'][k].trim(), `${name} ${k} is empty`);
        assert.deepEqual(vars(group['pt-BR'][k]), vars(v), `${name} ${k} blanks differ`);
      }
    }
  }
});

test('the foundation texts are merged into the dictionaries, and none replaces another text', async () => {
  const source = readFileSync(new URL('i18n.js', WEB), 'utf8');
  const base = (name) => {
    const start = source.indexOf(`const ${name} = {`);
    return new Set([...source.slice(start, source.indexOf('\n};', start)).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
  };
  const owner = new Map([...base('en')].map((k) => [k, 'i18n.js']));
  for (const name of FD_TEXTS) {
    const { default: part } = await import(new URL(`i18n-fd/${name}.js`, WEB));
    for (const [k, v] of Object.entries(part.en)) {
      assert.ok(!owner.has(k), `${name} ${k} is already in ${owner.get(k)}`);
      owner.set(k, name);
      assert.equal(LANGS.en[k], v, `${name} ${k} reaches the English dictionary`);
      assert.equal(LANGS['pt-BR'][k], part['pt-BR'][k], `${name} ${k} reaches the Portuguese dictionary`);
    }
    for (const lang of ['en', 'pt-BR']) for (const [k, v] of Object.entries(part.tech?.[lang] ?? {})) assert.equal(TECH[lang][k], v);
  }
  assert.equal(translator('pt-BR')('badge.notFound'), 'Não encontrado');
  assert.equal(translator('en')('mark.na'), 'Does not apply');
});

test('the empty style sheets of each block exist, one per block', () => {
  for (const name of FD_CSS) assert.ok(existsSync(new URL(`css/fd-${name}.css`, WEB)), name);
});
