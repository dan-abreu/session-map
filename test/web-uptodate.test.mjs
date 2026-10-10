import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { translator } from '../server/web/i18n.js';
import {
  CATALOG, GROUPS, REASONS, createUptodateView, evidenceRows, groupsOf, lineView, summaryOf, summaryWords,
} from '../server/web/uptodateview.js';
import uptodateTexts from '../server/web/i18n-fd/care-uptodate.js';
import findingsTexts from '../server/web/i18n-fd/care-findings.js';
import { LINES as codeLines } from '../server/foundation/uptodate-lines-code.mjs';
import { LINES as docsLines } from '../server/foundation/uptodate-lines-docs.mjs';
import { LINES as opsLines } from '../server/foundation/uptodate-lines-ops.mjs';

const WEB = new URL('../server/web/', import.meta.url);
const LINES = [...codeLines, ...docsLines, ...opsLines];

// The page dictionary does not hold these files yet (the block integration merges them), so the test layers them on top.
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));
function tFor(lang) {
  const base = translator(lang);
  const own = { ...findingsTexts[lang], ...uptodateTexts[lang] };
  const t = (k, v) => (own[k] !== undefined ? fill(own[k], v) : base(k, v));
  t.count = base.count;
  return t;
}

const line = (id, over = {}) => ({
  id, group: Number(id[1]), state: 'confirmed', evidence: [{ file: 'src/app.ts', line: 3, sha: 'abc' }], reason: null,
  findingIds: [], checkedAt: '2026-01-01T00:00:00Z', ...over,
});
const sample = () => ({
  version: 1, generatedAt: '2026-01-01T00:00:00Z',
  lines: [
    line('g1.census-owners'),
    line('g1.read-100', { state: 'warning', findingIds: ['f1'], evidence: [{ file: 'src/big.ts', line: 1, sha: 'x' }] }),
    line('g6.dep-vulns', { state: 'unverified', evidence: [], reason: 'no-network' }),
  ],
});

// ----- the catalog -----

test('the catalog lists the 35 lines of the code, in the order of the eight groups', () => {
  assert.equal(CATALOG.length, 35);
  assert.deepEqual([...CATALOG.map((c) => c.id)].sort(), LINES.map((l) => l.id).sort(), 'same ids as the three line files');
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, 35);
  for (const c of CATALOG) assert.equal(c.group, LINES.find((l) => l.id === c.id).group, `${c.id} is in its group`);
  assert.deepEqual(CATALOG.map((c) => c.group), [...CATALOG.map((c) => c.group)].sort((a, b) => a - b));
  assert.deepEqual(GROUPS, [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ----- groupsOf -----

test('groupsOf gives the eight groups with the count of each state', () => {
  const groups = groupsOf(sample());
  assert.equal(groups.length, 8);
  assert.deepEqual(groups.map((g) => g.group), GROUPS);
  const g1 = groups[0];
  const g6 = groups[5];
  assert.equal(g1.lines.length, 10);
  assert.deepEqual(g1.counts, { confirmed: 1, warning: 1, unverified: 8 }, 'what the file does not hold counts as not verified');
  assert.deepEqual(g6.counts, { confirmed: 0, warning: 0, unverified: 3 });
  assert.equal(groups.reduce((n, g) => n + g.lines.length, 0), 35);
});

test('groupsOf: nothing disappears when the data is missing, every line says "not read yet"', () => {
  for (const data of [null, undefined, {}, { lines: 'x' }, []]) {
    const all = groupsOf(data).flatMap((g) => g.lines);
    assert.equal(groupsOf(data).length, 8);
    assert.equal(all.length, 35);
    assert.ok(all.every((l) => l.state === 'unverified' && l.reason === 'no-data' && l.missing === true));
  }
});

test('groupsOf never shows confirmed without proof, and fixes the unknown', () => {
  const data = { lines: [
    line('g1.census-owners', { evidence: [] }),
    line('g1.read-100', { state: 'made-up' }),
    line('g2.links', { state: 'unverified', reason: undefined, evidence: [] }),
    line('g2.cites', { state: 'unverified', reason: 'nonsense', evidence: [] }),
  ] };
  const byId = Object.fromEntries(groupsOf(data).flatMap((g) => g.lines).map((l) => [l.id, l]));
  assert.equal(byId['g1.census-owners'].state, 'unverified', 'no proof, no check mark');
  assert.equal(byId['g1.census-owners'].reason, 'no-data');
  assert.equal(byId['g1.read-100'].state, 'unverified');
  assert.equal(byId['g2.links'].reason, 'no-data', 'an unverified line always has a reason');
  assert.equal(byId['g2.cites'].reason, 'no-data', 'an unknown reason falls to the plainest one');
});

test('groupsOf keeps a line the catalog does not know, in its group, after the known ones', () => {
  const groups = groupsOf({ lines: [line('g3.future-thing', { group: 3 })] });
  const g3 = groups.find((g) => g.group === 3);
  assert.equal(g3.lines.at(-1).id, 'g3.future-thing');
  assert.equal(g3.lines.length, 4);
  assert.equal(groupsOf({ lines: [line('g9.nowhere', { group: 9 })] }).flatMap((g) => g.lines).length, 35, 'a group out of 1-8 is ignored');
});

// ----- summaryOf -----

test('summaryOf counts for the Home and the Route, in the simple mode', () => {
  const s = summaryOf(sample());
  assert.deepEqual([s.confirmed, s.warning, s.unverified, s.total], [1, 1, 33, 35]);
  assert.equal(s.read, true);
  assert.equal(s.headline, 'warning');
  assert.deepEqual(s.warningGroups, [1]);
  const none = summaryOf(null);
  assert.deepEqual([none.confirmed, none.warning, none.unverified, none.total], [0, 0, 35, 35]);
  assert.equal(none.read, false);
  assert.equal(none.headline, 'unverified');
  const allOk = summaryOf({ lines: CATALOG.map((c) => line(c.id)) });
  assert.equal(allOk.headline, 'confirmed');
  assert.deepEqual(allOk.warningGroups, []);
  assert.match(summaryWords(s, tFor('en')), /1 .*1 .*33/);
  assert.match(summaryWords(none, tFor('pt-BR')), /ainda não/i);
});

// ----- evidenceRows -----

test('evidenceRows turns each proof into a place to open, or into words when there is no file', () => {
  const t = tFor('en');
  const rows = evidenceRows([
    { file: 'src/app.ts', line: 3, sha: 'a' },
    { file: 'docs/a.md', line: null },
    { file: null, line: null, factId: 'route:GET /x' },
    { file: '.git', line: 0, sha: null, factId: 'git:ahead' },
    { note: 'findings', count: 0 },
    { file: 'docs/api.md', line: 4, note: 'route-not-in-spec', name: 'GET /orders' },
    { file: null, line: null, readChars: 10, totalChars: 20 },
    'garbage', null,
  ], t);
  assert.deepEqual(rows.map((r) => r.label), ['src/app.ts:3', 'docs/a.md', 'route:GET /x', 'git:ahead', 'No pending finding was left', 'docs/api.md:4', '10 of 20 characters read']);
  assert.deepEqual(rows.map((r) => r.open), [
    { file: 'src/app.ts', line: 3 }, { file: 'docs/a.md', line: null }, null, null, null, { file: 'docs/api.md', line: 4 }, null,
  ]);
  assert.match(rows[5].note, /GET \/orders/);
  assert.deepEqual(evidenceRows(undefined, t), []);
});

// ----- lineView -----

test('lineView: a confirmed line shows its proof', () => {
  const t = tFor('en');
  const v = lineView(line('g1.census-owners'), t);
  assert.equal(v.state, 'confirmed');
  assert.equal(v.name, 'Every file belongs to a part');
  assert.match(v.words, /belongs to a part|belong/i);
  assert.equal(v.evidence.length, 1);
  assert.equal(v.reasonText, null);
  assert.equal(v.badge.id, 'confirmed');
});

test('lineView: an unverified line always has its reason in plain words, and "not read yet" for no data', () => {
  const t = tFor('en');
  for (const reason of REASONS) {
    const v = lineView(line('g6.dep-vulns', { state: 'unverified', evidence: [], reason }), t);
    assert.ok(v.reasonText && !v.reasonText.startsWith('uptodate.'), `reason ${reason} has words`);
    assert.equal(v.state, 'unverified');
  }
  const none = lineView(line('g6.dep-vulns', { state: 'unverified', evidence: [], reason: 'no-data' }), t);
  assert.match(none.reasonText, /not read yet/i);
  const gone = lineView(groupsOf(null)[0].lines[0], tFor('pt-BR'));
  assert.match(gone.reasonText, /ainda não lido/i);
});

test('lineView: a warning carries the findings it points to', () => {
  const t = tFor('en');
  const finding = { id: 'f1', rule: 'owner-missing', severity: 'important', state: 'open', target: { file: 'src', line: null }, what: { params: { folder: 'src', count: 3 } } };
  const v = lineView(line('g1.census-owners', { state: 'warning', findingIds: ['f1', 'f-gone'] }), t, [finding, { ...finding, id: 'f2' }]);
  assert.equal(v.state, 'warning');
  assert.deepEqual(v.findings.map((f) => f.id), ['f1'], 'only the findings the line points to, and only the ones that exist');
  assert.match(v.findings[0].what, /src/);
  assert.equal(v.findingIds.length, 2);
  assert.deepEqual(lineView(line('g1.census-owners'), t, null).findings, []);
});

test('lineView: an id the texts do not know still shows, by its id', () => {
  const v = lineView(line('g3.future-thing'), tFor('en'));
  assert.equal(v.name, 'g3.future-thing');
  assert.ok(v.words);
});

// ----- texts -----

test('every line of the catalog has name, ok, warn and unverified in both languages, and every group a title', () => {
  for (const { id } of LINES) {
    for (const part of ['name', 'ok', 'warn', 'unverified']) {
      for (const lang of ['en', 'pt-BR']) {
        const text = uptodateTexts[lang][`uptodate.${id}.${part}`];
        assert.ok(typeof text === 'string' && text.trim(), `uptodate.${id}.${part} in ${lang}`);
      }
    }
  }
  for (const g of GROUPS) for (const lang of ['en', 'pt-BR']) assert.ok(uptodateTexts[lang][`uptodate.group.${g}`]?.trim(), `group ${g} in ${lang}`);
  for (const r of REASONS) for (const lang of ['en', 'pt-BR']) assert.ok(uptodateTexts[lang][`uptodate.reason.${r}`]?.trim(), `reason ${r} in ${lang}`);
});

test('the up-to-date texts have the same keys and blanks in en and pt-BR, and repeat no other text', async () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(uptodateTexts['pt-BR']).sort(), Object.keys(uptodateTexts.en).sort());
  for (const [k, v] of Object.entries(uptodateTexts.en)) {
    assert.ok(uptodateTexts['pt-BR'][k]?.trim() && v.trim(), `${k} is empty`);
    assert.deepEqual(vars(uptodateTexts['pt-BR'][k]), vars(v), `${k} blanks differ`);
    assert.match(k, /^uptodate\./, `${k} stays in the uptodate namespace`);
  }
  for (const k of Object.keys(uptodateTexts.en).filter((x) => /^uptodate\.g\d.*\.(name|ok|warn|unverified)$/.test(x))) {
    assert.deepEqual(vars(uptodateTexts.en[k]), [], `${k} has no blank: a line may leave its detail out`);
  }
  const source = readFileSync(new URL('i18n.js', WEB), 'utf8');
  const start = source.indexOf('const en = {');
  const base = new Set([...source.slice(start, source.indexOf('\n};', start)).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
  const others = new Set();
  for (const file of readdirSync(new URL('i18n-fd/', WEB))) {
    if (['care-uptodate.js', 'care.js'].includes(file)) continue;
    const { default: part } = await import(new URL(`i18n-fd/${file}`, WEB));
    for (const k of Object.keys(part.en ?? {})) others.add(k);
  }
  for (const k of Object.keys(uptodateTexts.en)) {
    assert.ok(!base.has(k), `${k} is already in i18n.js`);
    assert.ok(!others.has(k), `${k} is already in another text file`);
  }
});

test('the up-to-date style sheet exists and keeps to the colors of the app', () => {
  const css = new URL('css/fd-care-uptodate.css', WEB);
  assert.ok(existsSync(css));
  const text = readFileSync(css, 'utf8');
  assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, 'colors come from the variables of style.css');
  assert.doesNotMatch(text, /border-(left|right):\s*[2-9]/, 'no stripe on a side');
});

// ----- the view, without a browser: a tiny element tree and a fake server -----

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const buttons = (root) => walk(root).filter((n) => n.tag === 'button');
const button = (root, re) => buttons(root).find((b) => re.test(textOf(b)));

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
  const view = createUptodateView({
    h, t: () => t, project: () => ({ id: 'acme-shop-8324f1' }), errorText: (c) => `error:${c}`,
    openFile: (path, ln) => opened.push([path, ln]), openFindings: () => opened.push(['findings']), ...extra,
  });
  const root = h('div');
  return { view, root, opened, screen: () => ({ tag: 'div', attrs: {}, children: root.children }) };
}

const FINDING = { id: 'f1', rule: 'owner-missing', severity: 'important', state: 'open', target: { file: 'src', line: null }, what: { msg: 'x', params: { folder: 'src', count: 3 } }, fix: { kind: 'ai-update', opId: null } };

test('the screen shows all 35 lines with state and proof, and a warning leads to its findings', async () => {
  const server = fakeServer((method, path) => {
    if (path.endsWith('/uptodate')) return { body: sample() };
    if (path.endsWith('/findings')) return { body: [FINDING] };
    return { status: 404, body: { error: 'not-found' } };
  });
  try {
    const { view, root, screen, opened } = makeView();
    await view.render(root);
    const text = textOf(screen());
    for (const c of CATALOG) assert.ok(text.includes(uptodateTexts.en[`uptodate.${c.id}.name`]), `${c.id} is on screen`);
    for (const g of GROUPS) assert.ok(text.includes(uptodateTexts.en[`uptodate.group.${g}`]), `group ${g} is on screen`);
    assert.match(text, /src\/app\.ts:3/, 'the proof is listed');
    assert.match(text, /internet/i, 'the reason of the unverified line is said');
    assert.match(text, /not read yet/i, 'a line the file does not hold says so instead of disappearing');
    const warns = walk(screen()).filter((n) => /fdu-line/.test(n.attrs.class ?? '') && /is-warning/.test(n.attrs.class));
    assert.equal(warns.length, 1);
    await button(screen(), /src\/app\.ts:3/).attrs.onclick();
    assert.deepEqual(opened.at(-1), ['src/app.ts', 3]);
    await button(screen(), /findings/i).attrs.onclick();
    assert.deepEqual(opened.at(-1), ['findings']);
    assert.ok(server.calls.every((c) => c.method === 'GET'), 'the screen only reads');
  } finally { server.restore(); }
});

test('the screen says "not read yet" and still lists the lines when nothing was generated', async () => {
  const server = fakeServer(() => ({ body: null }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /not read yet/i);
    for (const c of CATALOG) assert.ok(text.includes(uptodateTexts.en[`uptodate.${c.id}.name`]), `${c.id} stays`);
    assert.equal(walk(screen()).filter((n) => /is-confirmed/.test(n.attrs.class ?? '')).length, 0, 'nothing is shown as confirmed');
  } finally { server.restore(); }
});

test('a server error is said in words and the lines stay', async () => {
  const server = fakeServer(() => ({ status: 404, body: { error: 'unknown-project' } }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /error:unknown-project/);
    assert.ok(textOf(screen()).includes(uptodateTexts.en['uptodate.g1.census-owners.name']));
  } finally { server.restore(); }
});
