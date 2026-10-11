import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { translator, LANGS } from '../server/web/i18n.js';
import { PIECE_REASONS, createVersionsView, versionsModel } from '../server/web/versionsview.js';
import versionsUi from '../server/web/i18n-fd/versions-ui.js';

const WEB = new URL('../server/web/', import.meta.url);

// The page dictionary does not hold this file yet (the block integration merges it), so the test layers it on top.
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));
function tFor(lang) {
  const base = translator(lang);
  const t = (k, v) => (versionsUi[lang][k] !== undefined ? fill(versionsUi[lang][k], v) : base(k, v));
  t.count = base.count;
  return t;
}

const piece = (name, over = {}) => ({
  name, ecosystem: 'npm', version: '16.0.1', range: '^16.0.1', file: 'apps/web/package.json', line: 12,
  warning: null, verified: false, reason: 'no-source', latest: null, ...over,
});

// A versions.json written by hand, as the server contract (bloco-4b section 5) describes it.
const sample = (over = {}) => ({
  version: 1, generatedAt: '2026-03-01T10:00:00Z',
  code: { version: '1.2.0', source: 'package.json', file: 'package.json', line: 3, others: [{ source: 'pubspec.yaml', version: '1.1.0', file: 'app/pubspec.yaml', line: 4 }] },
  tag: 'v1.1.0', relation: 'ahead', mismatch: true, live: null,
  pieces: [
    piece('next', { verified: true, reason: null, warning: { kind: 'behind', ids: [], detail: 'latest 17.0.0' }, latest: '17.0.0' }),
    piece('react', { verified: true, reason: null }),
    piece('prisma', { verified: true, reason: null, warning: { kind: 'vulnerable', ids: ['GHSA-aaaa-bbbb-cccc'], detail: '1 advisory' } }),
    piece('vite'),
    piece('astro', { reason: 'no-version', version: null, range: null }),
  ],
  node: { running: '22.4.0', required: '>=20', source: 'package.json', eol: false, verified: true },
  selfVersion: { current: '0.2.5', latest: '0.3.0', newer: true, verified: true },
  next: { version: '1.3.0', because: 'feat', commits: ['a1b2c3'], alreadyInCode: false, nonSemver: false },
  ...over,
});

test('the seal of code against tag follows equal, ahead and behind, and unknown is never a check mark', () => {
  assert.equal(versionsModel(sample({ relation: 'equal', mismatch: false })).seal, 'confirmed');
  const ahead = versionsModel(sample({ relation: 'ahead' }));
  assert.deepEqual([ahead.seal, ahead.relation], ['warning', 'ahead']);
  const behind = versionsModel(sample({ relation: 'behind' }));
  assert.deepEqual([behind.seal, behind.relation], ['warning', 'behind']);
  assert.equal(versionsModel(sample({ relation: 'unknown', mismatch: false })).seal, 'unverified');
  assert.equal(versionsModel(sample({ relation: 'made-up' })).seal, 'unverified');
  assert.equal(versionsModel(sample({ tag: null, relation: 'unknown', next: null })).seal, 'unverified');
});

test('the code version, its file and line, the tag and the other declared versions come through', () => {
  const m = versionsModel(sample());
  assert.deepEqual(m.code, {
    version: '1.2.0', source: 'package.json', file: 'package.json', line: 3,
    others: [{ source: 'pubspec.yaml', version: '1.1.0', file: 'app/pubspec.yaml', line: 4 }],
  });
  assert.equal(m.tag, 'v1.1.0');
  assert.equal(versionsModel(sample({ code: null })).code, null);
});

test('nothing unverified ever becomes a check mark: pieces, Node, live and the app version', () => {
  const m = versionsModel(sample({
    node: { running: '22.4.0', required: null, source: null, eol: false, verified: false },
    selfVersion: { current: '0.2.5', latest: null, newer: false, verified: false },
    live: { url: 'https://example.invalid/v', version: '1.2.0', match: null, checkedAt: null },
  }));
  assert.equal(m.node.seal, 'unverified', 'eol:false without a source is not "supported"');
  assert.equal(m.self.seal, 'unverified');
  assert.equal(m.live.seal, 'unverified');
  assert.deepEqual(m.pieces.unverified.map((p) => p.name), ['astro', 'vite']);
  assert.ok(m.pieces.unverified.every((p) => p.seal === 'unverified'));
  // a piece the file calls clean but that no source answered about stays "not verified"
  const lying = versionsModel(sample({ pieces: [piece('react', { verified: false, reason: null })] }));
  assert.deepEqual(lying.pieces.unverified.map((p) => [p.name, p.reason]), [['react', 'no-source']]);
  assert.equal(lying.pieces.ok, 0);
});

test('pieces with a warning come worst first (vulnerable, end of life, behind), the clean verified ones are only counted', () => {
  const m = versionsModel(sample({ pieces: [
    piece('a-behind', { verified: true, reason: null, warning: { kind: 'behind', ids: [], detail: '' }, latest: '9.0.0' }),
    piece('b-eol', { verified: true, reason: null, warning: { kind: 'eol', ids: [], detail: 'ended' } }),
    piece('c-vuln', { verified: true, reason: null, warning: { kind: 'vulnerable', ids: ['X-1', 'X-2'], detail: '2 advisories' } }),
    piece('d-vuln', { verified: true, reason: null, warning: { kind: 'vulnerable', ids: ['X-3'], detail: '' } }),
    piece('e-ok', { verified: true, reason: null }),
    piece('f-ok', { verified: true, reason: null }),
    piece('g-odd', { verified: true, reason: null, warning: { kind: 'invented', ids: [] } }),
  ] }));
  assert.deepEqual(m.pieces.warned.map((p) => [p.name, p.kind]), [
    ['c-vuln', 'vulnerable'], ['d-vuln', 'vulnerable'], ['b-eol', 'eol'], ['a-behind', 'behind'],
  ]);
  assert.deepEqual(m.pieces.warned[0].ids, ['X-1', 'X-2']);
  assert.equal(m.pieces.warned.at(-1).latest, '9.0.0');
  assert.equal(m.pieces.ok, 2);
  assert.ok(m.pieces.warned.every((p) => p.seal === 'warning'));
  assert.deepEqual(m.pieces.unverified.map((p) => p.name), ['g-odd'], 'a warning kind the program does not know is not shown as a finding');
});

test('Node: end of life warns, a supported verified Node is confirmed', () => {
  assert.equal(versionsModel(sample({ node: { running: '18.0.0', required: '>=18', source: '.nvmrc', eol: true, verified: true } })).node.seal, 'warning');
  const ok = versionsModel(sample()).node;
  assert.deepEqual([ok.seal, ok.running, ok.required, ok.source], ['confirmed', '22.4.0', '>=20', 'package.json']);
  assert.equal(versionsModel(sample({ node: null })).node, null);
});

test('without a live address the live line is gone; with one, match decides the seal', () => {
  assert.equal(versionsModel(sample()).live, null);
  const same = versionsModel(sample({ live: { url: 'https://example.invalid/v', version: '1.2.0', match: true, checkedAt: '2026-03-01T09:00:00Z' } })).live;
  assert.deepEqual([same.seal, same.version], ['confirmed', '1.2.0']);
  const diff = versionsModel(sample({ live: { url: 'https://example.invalid/v', version: '1.1.0', match: false, checkedAt: null } })).live;
  assert.equal(diff.seal, 'warning');
});

test('the app version warns only when a newer one is known', () => {
  assert.equal(versionsModel(sample()).self.seal, 'warning');
  assert.equal(versionsModel(sample()).self.newer, true);
  const same = versionsModel(sample({ selfVersion: { current: '0.3.0', latest: '0.3.0', newer: false, verified: true } })).self;
  assert.deepEqual([same.seal, same.newer], ['confirmed', false]);
  assert.equal(versionsModel(sample({ selfVersion: { current: '0.3.0', latest: '0.3.0', newer: true, verified: false } })).self.seal, 'unverified');
  assert.equal(versionsModel(sample({ selfVersion: null })).self, null);
});

test('the next number: a version, only the kind for a tag that is not semver, nothing to publish, or no tag to count from', () => {
  const n = versionsModel(sample()).next;
  assert.deepEqual([n.kind, n.version, n.because, n.count, n.alreadyInCode], ['version', '1.3.0', 'feat', 1, false]);
  const odd = versionsModel(sample({ tag: 'v0.10.1k', next: { version: null, because: 'fix', commits: ['aa', 'bb'], alreadyInCode: false, nonSemver: true } })).next;
  assert.deepEqual([odd.kind, odd.version, odd.because, odd.count], ['type', null, 'fix', 2]);
  const lying = versionsModel(sample({ next: { version: '9.9.9', because: 'fix', commits: [], alreadyInCode: false, nonSemver: true } })).next;
  assert.deepEqual([lying.kind, lying.version], ['type', null], 'a non-semver base never shows a number');
  assert.equal(versionsModel(sample({ next: null })).next.kind, 'none');
  assert.equal(versionsModel(sample({ tag: null, relation: 'unknown', next: null })).next.kind, 'noTag');
  assert.equal(versionsModel(sample({ next: { version: '1.2.0', because: 'fix', commits: ['x'], alreadyInCode: true, nonSemver: false } })).next.alreadyInCode, true);
  assert.equal(versionsModel(sample({ next: { version: '1.3.0', because: 'unheard', commits: [], alreadyInCode: false, nonSemver: false } })).next.because, 'fix', 'an unknown kind falls to the smallest');
});

test('no file yet gives an unread model, and bad shapes do not throw', () => {
  for (const bad of [null, undefined, 42, 'x', [], { pieces: 'no' }, { pieces: [null, 3, {}] }]) {
    const m = versionsModel(bad);
    assert.equal(m.pieces.warned.length + m.pieces.unverified.length + m.pieces.ok, 0);
    assert.equal(m.code, null);
    assert.equal(m.live, null);
  }
  assert.equal(versionsModel(null).read, false);
  assert.equal(versionsModel({}).read, true);
  assert.deepEqual(PIECE_REASONS, ['no-version', 'no-source', 'no-network', 'error']);
});

test('the texts: same keys in both languages, same blanks, own namespace, every reason and kind has a word', () => {
  const { en, 'pt-BR': pt } = versionsUi;
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v.trim() && pt[k].trim(), `${k} is empty`);
    assert.deepEqual(vars(pt[k]), vars(v), `${k} blanks differ`);
    assert.ok(k.startsWith('versions.'), `${k} stays in the versions namespace`);
    assert.ok(!(k in LANGS.en), `${k} is already in the page dictionary`);
  }
  for (const r of PIECE_REASONS) assert.ok(en[`versions.reason.${r}`] && pt[`versions.reason.${r}`], r);
  for (const k of ['vulnerable', 'eol', 'behind']) assert.ok(en[`versions.warn.${k}`] && pt[`versions.warn.${k}`], k);
  for (const k of ['feat', 'fix', 'breaking']) assert.ok(en[`versions.because.${k}`] && pt[`versions.because.${k}`], k);
});

test('every key the screen builds from a state exists too (relation, seal, next)', () => {
  const { en, 'pt-BR': pt } = versionsUi;
  const wanted = [
    ...['equal', 'ahead', 'behind', 'unknown'].map((k) => `versions.relation.${k}`),
    ...['confirmed', 'warning', 'unverified'].flatMap((k) => [`versions.live.${k}`, `versions.node.${k}`]),
    'versions.self.confirmed', 'versions.self.unverified', 'versions.next.none', 'versions.next.noTag',
  ];
  for (const k of wanted) assert.ok(en[k] && pt[k], k);
});

test('every literal key the screen asks for exists in its texts', () => {
  const source = readFileSync(new URL('versionsview.js', WEB), 'utf8');
  const asked = [...source.matchAll(/\btt?(?:\(\))?\(\s*'([a-zA-Z][\w.-]*)'/g)].map((m) => m[1]);
  assert.ok(asked.length > 8);
  for (const k of asked) assert.ok(k in versionsUi.en && k in versionsUi['pt-BR'], k);
});

test('the versions block of the health style sheet keeps to the colors and the scales of the app', () => {
  const css = new URL('css/fd-health.css', WEB);
  assert.ok(existsSync(css));
  const text = readFileSync(css, 'utf8');
  assert.match(text, /\.fdv-view/);
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(plain, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, 'colors come from the variables of style.css');
  assert.doesNotMatch(plain, /border-(left|right):\s*[2-9]/, 'no stripe on a side');
});

// ----- the view, without a browser: a tiny element tree and a fake server -----

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const texts = (n, out = []) => { if (typeof n === 'string') out.push(n); else n.children.forEach((c) => texts(c, out)); return out; };
const byClass = (root, re) => walk(root).filter((n) => re.test(n.attrs.class ?? ''));

function fakeServer(routes) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ method: init.method, path: decodeURIComponent(path) });
    const hit = routes(init.method, decodeURIComponent(path));
    return { ok: (hit?.status ?? 200) < 400, status: hit?.status ?? 200, json: async () => (hit ? hit.body : null) };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

function makeView(extra = {}) {
  const t = tFor('en');
  const opened = [];
  const view = createVersionsView({
    h, t: () => t, project: () => ({ id: 'acme-shop-8324f1' }), errorText: (c) => `error:${c}`,
    openFile: (path, line) => opened.push([path, line]), ...extra,
  });
  const root = h('div');
  return { view, root, opened, screen: () => ({ tag: 'div', attrs: {}, children: root.children }) };
}

test('the screen shows the code version, the tag, the divergence, the pieces with a warning, Node, the app and the next number', async () => {
  const server = fakeServer((m, p) => (p.endsWith('/versions') ? { body: sample() } : { status: 404, body: null }));
  try {
    const { view, root, screen, opened } = makeView();
    await view.render(root);
    const text = textOf(screen());
    for (const want of [/1\.2\.0/, /v1\.1\.0/, /ahead/i, /prisma/, /GHSA-aaaa-bbbb-cccc/, /next/, /17\.0\.0/, /22\.4\.0/, /0\.3\.0/, /1\.3\.0/, /2 pieces? not verified|not verified/i]) {
      assert.match(text, want);
    }
    const warned = byClass(screen(), /fdv-piece\b/).filter((n) => n.tag === 'li').map((n) => n.attrs['data-name']);
    assert.deepEqual(warned, ['prisma', 'next'], 'worst first');
    const codeBtn = walk(screen()).find((n) => n.tag === 'button' && /package\.json:3/.test(textOf(n)));
    await codeBtn.attrs.onclick();
    assert.deepEqual(opened.at(-1), ['package.json', 3]);
    assert.ok(server.calls.every((c) => c.method === 'GET'), 'opening the screen only reads');
    assert.equal(server.calls[0].path, '/api/foundation/acme-shop-8324f1/versions');
  } finally { server.restore(); }
});

test('equal shows a check mark; ahead shows a warning mark; the unverified pieces sit apart with their reason', async () => {
  const server = fakeServer(() => ({ body: sample({ relation: 'equal', mismatch: false, tag: 'v1.2.0' }) }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const seal = byClass(screen(), /fdv-relation\b/)[0];
    assert.match(textOf(seal), /✅/);
    assert.doesNotMatch(textOf(seal), /⚠️/);
    const unv = byClass(screen(), /fdv-unverified\b/)[0];
    assert.ok(unv);
    assert.match(textOf(unv), /vite/);
    assert.match(textOf(unv), /no version/i, 'a piece without a readable version says why');
  } finally { server.restore(); }
  const server2 = fakeServer(() => ({ body: sample() }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(byClass(screen(), /fdv-relation\b/)[0]), /⚠️/);
  } finally { server2.restore(); }
});

test('without a live address there is no live line; with one there is', async () => {
  const server = fakeServer(() => ({ body: sample() }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.equal(byClass(screen(), /fdv-live\b/).length, 0);
  } finally { server.restore(); }
  const server2 = fakeServer(() => ({ body: sample({ live: { url: 'https://example.invalid/v', version: '1.1.0', match: false, checkedAt: null } }) }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const live = byClass(screen(), /fdv-live\b/);
    assert.equal(live.length, 1);
    assert.match(textOf(live[0]), /1\.1\.0/);
  } finally { server2.restore(); }
});

test('a tag that is not semver shows the kind of change and no number', async () => {
  const server = fakeServer(() => ({ body: sample({ tag: 'v0.10.1k', relation: 'unknown', mismatch: false, next: { version: null, because: 'fix', commits: ['aa'], alreadyInCode: false, nonSemver: true } }) }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const next = byClass(screen(), /fdv-next\b/)[0];
    assert.match(textOf(next), /fix/i);
    assert.doesNotMatch(textOf(next), /\d+\.\d+\.\d+/);
  } finally { server.restore(); }
});

test('no versions file yet says "not read yet" and nothing else; a failed read shows the error', async () => {
  const server = fakeServer(() => ({ body: null }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /not read yet/i);
    assert.equal(byClass(screen(), /fdv-relation\b/).length, 0);
  } finally { server.restore(); }
  const down = fakeServer(() => ({ status: 401, body: 'token required' }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /error:token-required/);
  } finally { down.restore(); }
});

test('the screen has no ready-made sentence: with echoing texts every word is a key or data from the file', async () => {
  const server = fakeServer(() => ({ body: sample({ live: { url: 'https://example.invalid/v', version: '1.1.0', match: false, checkedAt: '2026-03-01T09:00:00Z' } }) }));
  try {
    const t = (k) => `«${k}»`;
    t.count = t;
    const { view, root, screen } = makeView({ t: () => t });
    await view.render(root);
    const allowed = /^(«[^»]+»|[\d\s.,:;·/%()—–-]*|[\w./\\:#>=<^~@-]+|https?:\/\/\S+|[\p{Extended_Pictographic}️]+)$/u;
    const bad = texts(screen()).map((s) => s.trim()).filter((s) => s && !allowed.test(s));
    assert.deepEqual(bad, []);
  } finally { server.restore(); }
});

test('refresh on the same root reads again; on another root it draws from scratch', async () => {
  const server = fakeServer(() => ({ body: sample() }));
  try {
    const { view, root } = makeView();
    await view.render(root);
    await view.refresh(root);
    assert.equal(server.calls.length, 2);
    await view.refresh(h('div'));
    assert.equal(server.calls.length, 3);
  } finally { server.restore(); }
});
