import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { translator, LANGS } from '../server/web/i18n.js';
import { CATEGORY_IDS, REASONS, createHealthView, healthModel, itemWords } from '../server/web/healthview.js';
import healthUi from '../server/web/i18n-fd/health-ui.js';

const WEB = new URL('../server/web/', import.meta.url);

// The page dictionary does not hold this file yet (the block integration merges it), so the test layers it on top.
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));
function tFor(lang) {
  const base = translator(lang);
  const t = (k, v) => (healthUi[lang][k] !== undefined ? fill(healthUi[lang][k], v) : base(k, v));
  t.count = base.count;
  return t;
}

const item = (id, state, over = {}) => ({
  id, category: id.split('.')[0], severity: 'R', state, evidence: [], reason: null, detail: null,
  fix: { kind: 'manual', opId: null }, ...over,
});

// A health.json written by hand, as the server contract (bloco-4b section 2) describes it.
const sample = (over = {}) => ({
  version: 1, generatedAt: '2026-03-01T10:00:00Z', score: 61, visibility: 'public', visibilitySource: 'config',
  coverage: { verified: 7, applicable: 10 }, api: { mode: 'none', fetchedAt: null, error: null },
  categories: {
    community: { score: 40, pass: 1, fail: 3, unverified: 0, na: 0 },
    security: { score: null, pass: 0, fail: 0, unverified: 1, na: 0 },
    hygiene: { score: 100, pass: 1, fail: 0, unverified: 0, na: 1 },
  },
  items: [
    item('hygiene.editorconfig', 'fail', { severity: 'R', reason: 'missing', fix: { kind: 'draft', opId: null } }),
    item('community.security', 'fail', { severity: 'E', reason: 'placeholder', fix: { kind: 'draft', opId: null }, evidence: [{ file: 'SECURITY.md', line: 4 }] }),
    item('community.readme', 'pass', { severity: 'E' }),
    item('community.funding', 'fail', { severity: 'A', reason: 'missing' }),
    item('community.contributing', 'fail', { severity: 'R', reason: 'too-short', evidence: [{ file: 'CONTRIBUTING.md' }] }),
    item('security.secret_scanning', 'unverified', { severity: 'E', reason: 'no-token' }),
    item('hygiene.devcontainer', 'na', { severity: 'A', reason: 'no-code' }),
    item('hygiene.ci', 'pass', { severity: 'E' }),
  ],
  ...over,
});

test('healthModel lists the gaps worst first, then by category and id, and keeps na and unverified out of them', () => {
  const m = healthModel(sample());
  assert.deepEqual(m.gaps.map((g) => g.id), [
    'community.security', 'community.contributing', 'hygiene.editorconfig', 'community.funding',
  ]);
  assert.deepEqual(m.gaps.map((g) => g.severity), ['E', 'R', 'R', 'A']);
  assert.deepEqual(m.unverified.map((g) => [g.id, g.reason]), [['security.secret_scanning', 'no-token']]);
  assert.deepEqual(m.na.map((g) => g.id), ['hygiene.devcontainer']);
  assert.equal(m.passed, 2);
});

test('the score is a number only when something was checked; otherwise it is null, never 0', () => {
  assert.equal(healthModel(sample()).score, 61);
  assert.deepEqual(healthModel(sample()).coverage, { verified: 7, applicable: 10 });
  const none = healthModel(sample({ score: null, coverage: { verified: 0, applicable: 3 }, items: [item('security.sbom', 'unverified', { reason: 'no-data' })] }));
  assert.equal(none.score, null);
  const lying = healthModel(sample({ score: 0, items: [item('security.sbom', 'unverified', { reason: 'no-data' })], coverage: null }));
  assert.equal(lying.score, null, 'a score in the file with nothing checked behind it is not shown');
  assert.deepEqual(lying.coverage, { verified: 0, applicable: 1 });
  assert.equal(healthModel(sample({ score: 'high' })).score, null);
  assert.equal(healthModel(sample({ score: 140 })).score, null);
});

test('categories come in the catalog order with their own score, filled from the items when the file lacks them', () => {
  const m = healthModel(sample());
  assert.deepEqual(m.categories.map((c) => c.id), ['community', 'security', 'hygiene']);
  assert.equal(m.categories[0].score, 40);
  assert.equal(m.categories[1].score, null);
  const own = healthModel(sample({ categories: undefined, coverage: undefined, score: undefined }));
  assert.deepEqual(own.categories.map((c) => [c.id, c.pass, c.fail, c.unverified, c.na]), [
    ['community', 1, 3, 0, 0], ['security', 0, 0, 1, 0], ['hygiene', 1, 1, 0, 1],
  ]);
  // community: pass readme E(3); fail security E(3) + contributing R(2) + funding A(1) -> 3 / 9
  assert.equal(own.categories[0].score, Math.round((100 * 3) / 9));
  assert.deepEqual(CATEGORY_IDS, ['community', 'security', 'releases', 'docs', 'hygiene', 'product', 'management', 'extras']);
});

test('a draft with blanks still counts as missing and says "needs filling in"; only a plain missing item offers a draft', () => {
  const g = Object.fromEntries(healthModel(sample()).gaps.map((x) => [x.id, x]));
  assert.equal(g['community.security'].fill, true);
  assert.equal(g['community.security'].canDraft, false, 'the file already exists: a new draft would be refused');
  assert.equal(g['hygiene.editorconfig'].canDraft, true);
  assert.equal(g['community.funding'].canDraft, false, 'manual items have no draft');
  assert.equal(g['community.contributing'].canDraft, false, 'too short: the file exists');
  assert.deepEqual(g['community.security'].evidence, [{ file: 'SECURITY.md', line: 4 }]);
});

test('anything unknown falls to "not verified": no made-up state becomes pass or missing', () => {
  const m = healthModel(sample({ items: [
    item('docs.folder', 'passed?!'), item('docs.setup', 'unverified', { reason: 'made-up' }),
    item('docs.adrs', 'fail', { reason: 'made-up' }), null, { state: 'fail' },
  ] }));
  assert.deepEqual(m.unverified.map((u) => [u.id, u.reason]), [['docs.folder', 'no-data'], ['docs.setup', 'no-data']]);
  assert.deepEqual(m.gaps.map((x) => [x.id, x.reason]), [['docs.adrs', null]]);
  assert.equal(m.passed, 0);
});

test('no file yet gives an unread model, and bad shapes do not throw', () => {
  for (const bad of [null, undefined, 42, 'x', [], { items: 'no' }]) {
    const m = healthModel(bad);
    assert.equal(m.gaps.length + m.unverified.length + m.na.length, 0);
    assert.equal(m.score, null);
  }
  assert.equal(healthModel(null).read, false);
  assert.equal(healthModel({ items: [] }).read, true);
});

test('itemWords reads the three texts of an item by key and falls back to the id, never to a made-up sentence', () => {
  const dict = { 'health.item.community.readme.what': 'A', 'health.item.community.readme.why': 'B {name}' };
  const t = (k, v) => fill(dict[k] ?? k, v);
  assert.deepEqual(itemWords({ id: 'community.readme', detail: { name: 'x', list: ['a', 'b'] } }, t), { what: 'A', why: 'B x', todo: 'community.readme' });
});

test('the REASONS table holds every reason of the contract', () => {
  assert.deepEqual(REASONS.fail, ['missing', 'placeholder', 'too-short', 'no-contact', 'invalid', 'unsafe', 'stale']);
  assert.deepEqual(REASONS.unverified, ['no-token', 'no-network', 'tool-missing', 'no-data', 'too-big', 'error']);
  assert.deepEqual(REASONS.na, ['private', 'no-users', 'not-library', 'no-code']);
});

test('the texts: same keys in both languages, every state, category, severity and reason has a word', () => {
  const { en, 'pt-BR': pt } = healthUi;
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v.trim() && pt[k].trim(), `${k} is empty`);
    assert.deepEqual(vars(pt[k]), vars(v), `${k} blanks differ`);
    assert.ok(k.startsWith('health.'), `${k} stays in the health namespace`);
    assert.ok(!(k in LANGS.en), `${k} is already in the page dictionary`);
  }
  for (const c of CATEGORY_IDS) assert.ok(en[`health.category.${c}`], c);
  for (const s of ['E', 'R', 'A']) assert.ok(en[`health.sev.${s}`], s);
  for (const r of Object.values(REASONS).flat()) assert.ok(en[`health.reason.${r}`] && pt[`health.reason.${r}`], r);
});

test('every literal key the screen asks for exists in its texts', () => {
  const source = readFileSync(new URL('healthview.js', WEB), 'utf8');
  const asked = [...source.matchAll(/\bt{1,2}(?:\(\))?\(\s*'([a-zA-Z][\w.-]*)'/g)].map((m) => m[1]);
  assert.ok(asked.length > 10);
  for (const k of asked) assert.ok(k in healthUi.en && k in healthUi['pt-BR'], k);
});

test('the health style sheet exists and keeps to the colors of the app', () => {
  const css = new URL('css/fd-health.css', WEB);
  assert.ok(existsSync(css));
  const text = readFileSync(css, 'utf8');
  assert.match(text, /\.fdh-view/);
  assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, 'colors come from the variables of style.css');
  assert.doesNotMatch(text, /border-(left|right):\s*[2-9]/, 'no stripe on a side');
});

// ----- the view, without a browser: a tiny element tree and a fake server -----

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const texts = (n, out = []) => { if (typeof n === 'string') out.push(n); else n.children.forEach((c) => texts(c, out)); return out; };
const button = (root, re) => walk(root).find((n) => n.tag === 'button' && re.test(textOf(n)));

function fakeServer(routes) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: decodeURIComponent(path), body });
    const hit = routes(init.method, decodeURIComponent(path), body);
    return { ok: (hit?.status ?? 200) < 400, status: hit?.status ?? 200, json: async () => (hit ? hit.body : null) };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

function makeView(mode = 'auto', extra = {}) {
  const t = tFor('en');
  const opened = [];
  const view = createHealthView({
    h, t: () => t, project: () => ({ id: 'acme-shop-8324f1' }), careMode: () => mode, errorText: (c) => `error:${c}`,
    openFile: (path, line) => opened.push([path, line]), ...extra,
  });
  const root = h('div');
  return { view, root, opened, screen: () => ({ tag: 'div', attrs: {}, children: root.children }) };
}

test('the screen shows the score, its base, the categories and the gaps in order with their three texts', async () => {
  const server = fakeServer((m, p) => (p.endsWith('/health') ? { body: sample() } : { status: 404, body: null }));
  try {
    const { view, root, screen, opened } = makeView();
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /61/);
    assert.match(text, /7 of 10/, 'the score says over how many items it stands');
    assert.match(text, /Community/);
    assert.match(text, /No score/, 'a category with nothing checked has no score');
    const order = ['community.security', 'community.contributing', 'hygiene.editorconfig', 'community.funding'];
    const shown = walk(screen()).filter((n) => /fdh-gap\b/.test(n.attrs.class ?? '')).map((n) => n.attrs['data-id']);
    assert.deepEqual(shown, order);
    for (const label of ['What it is', 'Why it matters', 'What to do']) assert.ok(text.includes(label), label);
    assert.match(text, /Needs filling in/, 'a draft with blanks says so');
    await button(screen(), /SECURITY\.md:4/).attrs.onclick();
    assert.deepEqual(opened.at(-1), ['SECURITY.md', 4]);
    assert.ok(server.calls.every((c) => c.method === 'GET'), 'opening the screen only reads');
  } finally { server.restore(); }
});

test('"not verified" items sit in their own list with the reason, and "does not apply" is folded away', async () => {
  const server = fakeServer(() => ({ body: sample() }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const unv = walk(screen()).find((n) => /fdh-unverified\b/.test(n.attrs.class ?? ''));
    assert.ok(unv);
    assert.match(textOf(unv), /GitHub token/i);
    const gaps = walk(screen()).filter((n) => /fdh-gap\b/.test(n.attrs.class ?? ''));
    assert.ok(!gaps.some((g) => g.attrs['data-id'] === 'security.secret_scanning'), 'not verified is never a gap');
    const na = walk(screen()).find((n) => n.tag === 'details' && /fdh-na\b/.test(n.attrs.class ?? ''));
    assert.ok(na && !na.attrs.open, 'folded');
  } finally { server.restore(); }
});

test('"Create draft" sends only the item id, once, and says what happened', async () => {
  let created = false;
  const server = fakeServer((m, p) => {
    if (p.endsWith('/health') && m === 'GET') return { body: created ? sample({ items: [item('hygiene.editorconfig', 'pass')] }) : sample() };
    if (p.endsWith('/health/fix')) { created = true; return { body: { ok: true, status: 'applied', opId: 'op:1' } }; }
    return { status: 404, body: null };
  });
  try {
    const { view, root, screen } = makeView('auto');
    await view.render(root);
    const buttons = walk(screen()).filter((n) => n.tag === 'button' && /Create draft/.test(textOf(n)));
    assert.equal(buttons.length, 1, 'only the plainly missing item offers a draft');
    await buttons[0].attrs.onclick();
    const post = server.calls.filter((c) => c.method === 'POST');
    assert.equal(post.length, 1);
    assert.equal(post[0].path, '/api/foundation/acme-shop-8324f1/health/fix');
    assert.deepEqual(post[0].body, { itemId: 'hygiene.editorconfig' }, 'no file text from the client');
    assert.match(textOf(screen()), /Draft created/);
    assert.ok(!button(screen(), /Create draft/), 'the gap is gone after the reload');
  } finally { server.restore(); }
});

test('in "Look only" mode nothing is offered to write, and a refusal from the server is shown', async () => {
  const server = fakeServer(() => ({ body: sample() }));
  try {
    const { view, root, screen } = makeView('look');
    await view.render(root);
    assert.equal(button(screen(), /Create draft/).attrs.disabled, true);
    assert.match(textOf(screen()), /Look only/);
  } finally { server.restore(); }
  const server2 = fakeServer((m, p) => (p.endsWith('/health') ? { body: sample() } : { status: 409, body: { ok: false, error: 'no-draft' } }));
  try {
    const { view, root, screen } = makeView('auto');
    await view.render(root);
    await button(screen(), /Create draft/).attrs.onclick();
    assert.match(textOf(screen()), /error:no-draft/);
  } finally { server2.restore(); }
});

test('"Check online" posts to online, reloads, and says to wait on 429', async () => {
  let answer = { body: { ok: true } };
  const server = fakeServer((m, p) => (p.endsWith('/health') ? { body: sample() } : p.endsWith('/online') ? answer : { status: 404, body: null }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /only when you click/i, 'it is said that the internet is asked only on click');
    await button(screen(), /Check online/).attrs.onclick();
    const posts = server.calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts.map((c) => c.path), ['/api/foundation/acme-shop-8324f1/online']);
    assert.equal(server.calls.filter((c) => c.method === 'GET').length, 2, 'the answer is read again');
    answer = { status: 429, body: { ok: false, error: 'too-soon' } };
    await button(screen(), /Check online/).attrs.onclick();
    assert.match(textOf(screen()), /minute/i);
  } finally { server.restore(); }
});

test('no file yet: "not read yet" and no score; a failed read shows the error', async () => {
  const server = fakeServer(() => ({ body: null }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /not read yet/i);
    assert.doesNotMatch(textOf(screen()), /\b0\b\s*\/\s*100/);
  } finally { server.restore(); }
  const down = fakeServer(() => ({ status: 401, body: 'token required' }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /error:token-required/);
  } finally { down.restore(); }
});

test('with no score yet the screen says "No score yet" instead of a number', async () => {
  const server = fakeServer(() => ({ body: sample({ score: null, coverage: { verified: 0, applicable: 2 }, categories: {}, items: [item('docs.adrs', 'unverified', { reason: 'no-data' })] }) }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /No score yet/);
    assert.ok(!walk(screen()).some((n) => /fdh-score-num/.test(n.attrs.class ?? '')));
  } finally { server.restore(); }
});

test('the screen has no ready-made sentence: with echoing texts every word is a key or data from the file', async () => {
  const server = fakeServer(() => ({ body: sample({ api: { mode: 'token', fetchedAt: '2026-03-01T09:00:00Z', error: null } }) }));
  try {
    const t = (k) => `«${k}»`;
    t.count = t;
    const { view, root, screen } = makeView('auto', { t: () => t });
    await view.render(root);
    const allowed = /^(«[^»]+»|[\d\s.,:;·/%()—–-]*|[\w./\\:#-]+|[\p{Extended_Pictographic}️]+)$/u;
    const bad = texts(screen()).map((s) => s.trim()).filter((s) => s && !allowed.test(s));
    assert.deepEqual(bad, []);
  } finally { server.restore(); }
});
