// The census screen (fd01, "Census" tab): the pure functions that turn census.json, census-log.jsonl and read-ledger.json
// into table rows, and the view that draws them. The census is made by the real census on the invented acme-shop, so the
// numbers on screen are the numbers of the code, checked by an independent sum written in this test.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { censusOf, diffCensus } from '../server/foundation/census.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';
import { translator } from '../server/web/i18n.js';
import readTexts from '../server/web/i18n-fd/read.js';
import { censusRows, createCensusView, excludedRows, readLine, statementRows } from '../server/web/censusview.js';

const WEB = new URL('../server/web/', import.meta.url);
const answer = JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-shop.answer.json'), 'utf8'));
const owners = new Map(Object.entries(answer.owners));
const t = translator('en');
const tpt = translator('pt-BR');

let root;
let census;
let edited;
before(async () => {
  root = copyFixtureRepo('acme-shop');
  census = await censusOf(root, null, { owners });
  appendFileSync(join(root, 'apps/api/src/server.ts'), '// one\n// two\n// three\n');
  edited = await censusOf(root, census, { owners });
});
after(() => removeFixtureRepo(root));

const counted = () => census.files.filter((f) => f.included);
const sumKeys = (rows) => rows.reduce((a, r) => ({
  files: a.files + r.files, chars: a.chars + r.chars, words: a.words + r.words,
  total: a.total + r.lines.total, code: a.code + r.lines.code, comment: a.comment + r.lines.comment, blank: a.blank + r.lines.blank,
}), { files: 0, chars: 0, words: 0, total: 0, code: 0, comment: 0, blank: 0 });
const independent = (files) => ({
  files: files.length,
  chars: files.reduce((n, f) => n + f.chars, 0), words: files.reduce((n, f) => n + f.words, 0),
  total: files.reduce((n, f) => n + f.lines.total, 0), code: files.reduce((n, f) => n + f.lines.code, 0),
  comment: files.reduce((n, f) => n + f.lines.comment, 0), blank: files.reduce((n, f) => n + f.lines.blank, 0),
});

// ----- the table rows -----

test('the rows by folder add up to the total of the project, to the last character', () => {
  const rows = censusRows(census, { by: 'folder' });
  assert.deepEqual(sumKeys(rows), independent(counted()));
  assert.ok(rows.some((r) => r.kind === 'folder' && r.path === 'apps'), 'the first-level folders are rows');
  assert.ok(rows.some((r) => r.kind === 'folder' && r.path === 'packages'));
});

test('files that sit directly in the folder are one row of their own, so nothing is left out of the sum', () => {
  const rows = censusRows(census, { by: 'folder' });
  const here = rows.find((r) => r.kind === 'here');
  const direct = counted().filter((f) => !f.path.includes('/'));
  assert.ok(direct.length > 0, 'the fixture keeps files at its root');
  assert.deepEqual({ files: here.files, total: here.lines.total, chars: here.chars }, { files: direct.length, total: direct.reduce((n, f) => n + f.lines.total, 0), chars: direct.reduce((n, f) => n + f.chars, 0) });
  assert.equal(here.path, '');
});

test('opening a folder lists its subfolders and its own files, again adding up to that folder', () => {
  const rows = censusRows(census, { by: 'folder', folder: 'apps' });
  assert.deepEqual(sumKeys(rows), independent(counted().filter((f) => f.path.startsWith('apps/'))));
  assert.deepEqual(rows.filter((r) => r.kind === 'folder').map((r) => r.path).sort(), ['apps/admin', 'apps/api', 'apps/web', 'apps/worker']);
  assert.ok(rows.every((r) => r.kind === 'here' || r.path.startsWith('apps/')));
});

test('a folder name is the last piece of its path, and the biggest folder comes first', () => {
  const rows = censusRows(census, { by: 'folder', folder: 'apps' });
  assert.deepEqual(rows.filter((r) => r.kind === 'folder').map((r) => r.name).sort(), ['admin', 'api', 'web', 'worker']);
  const lines = rows.filter((r) => r.kind === 'folder').map((r) => r.lines.total);
  assert.deepEqual(lines, [...lines].sort((a, b) => b - a));
});

test('the rows by part add up to the total and the files nobody owns are marked, never hidden', () => {
  const rows = censusRows(census, { by: 'part' });
  assert.deepEqual(sumKeys(rows), independent(counted()));
  const none = rows.find((r) => r.id === '_none');
  const orphans = counted().filter((f) => !f.owner);
  assert.ok(orphans.length > 0, 'apps/admin belongs to no part');
  assert.equal(none.noOwner, true);
  assert.equal(none.files, orphans.length);
  assert.equal(rows.at(-1).id, '_none', 'the ownerless row closes the table');
  assert.ok(rows.filter((r) => r.id !== '_none').every((r) => r.noOwner === false));
  assert.deepEqual(rows.map((r) => r.id).filter((id) => id !== '_none').sort(), [...new Set(counted().map((f) => f.owner).filter(Boolean))].sort());
});

test('a part with no ownerless file does not show the empty ownerless row', () => {
  const clean = { ...census, sums: { ...census.sums, parts: { ...census.sums.parts, _none: { ...census.sums.parts._none, files: 0, chars: 0, words: 0, bytes: 0, lines: { total: 0, code: 0, comment: 0, blank: 0 } } } } };
  assert.ok(!censusRows(clean, { by: 'part' }).some((r) => r.id === '_none'));
});

test('the share of each row is its part of the lines of the project', () => {
  for (const by of ['folder', 'part']) {
    const rows = censusRows(census, { by });
    for (const r of rows) assert.ok(r.percent >= 0 && r.percent <= 100, `${by} ${r.name}`);
    assert.ok(Math.abs(rows.reduce((n, r) => n + r.percent, 0) - 100) <= rows.length * 0.05 + 0.001, 'the shares add up to 100');
  }
  const only = censusRows(census, { by: 'part' }).find((r) => r.id === 'web');
  assert.equal(only.percent, Math.round((only.lines.total / census.sums.total.lines.total) * 1000) / 10);
});

test('a census that is not there gives no rows at all, not a table of zeros', () => {
  for (const bad of [null, undefined, {}, { sums: null }, 'x']) assert.equal(censusRows(bad, { by: 'folder' }), null);
  assert.equal(excludedRows(null), null);
});

test('a project with nothing counted has no share to show', () => {
  const zero = { files: 0, bytes: 0, chars: 0, words: 0, lines: { total: 0, code: 0, comment: 0, blank: 0 } };
  const rows = censusRows({ files: [], sums: { total: zero, folders: {}, parts: { _none: zero } }, excluded: {} }, { by: 'folder' });
  assert.deepEqual(rows, []);
});

// ----- what was left out -----

test('the left-out files are grouped by reason, with the totals of the census and the files it names', () => {
  const rows = excludedRows(census);
  assert.deepEqual(rows.map((r) => r.reason), ['dep', 'generated', 'binary', 'secret']);
  for (const r of rows) {
    assert.equal(r.count, census.excluded[r.reason], r.reason);
    assert.deepEqual(r.files.map((f) => f.path), census.files.filter((f) => !f.included && f.kind === r.reason).map((f) => f.path));
  }
  assert.equal(rows.find((r) => r.reason === 'dep').count, 1, 'the ignored dependency folder is counted even though it is not listed');
  assert.deepEqual(rows.find((r) => r.reason === 'dep').files, []);
});

test('a secrets file is named but nothing of it is read: only its size is known', () => {
  const secret = excludedRows(census).find((r) => r.reason === 'secret');
  assert.ok(secret.files.some((f) => f.path === '.env'));
  assert.ok(!JSON.stringify(excludedRows(census)).includes('do-not-read-42'));
});

test('a reason with nothing left out and nothing listed is not a row', () => {
  const rows = excludedRows({ ...census, files: census.files.filter((f) => f.included), excluded: { dep: 0, generated: 0, binary: 2, secret: 0 } });
  assert.deepEqual(rows.map((r) => [r.reason, r.count]), [['binary', 2]]);
});

// ----- the statement -----

test('the statement of an edit shows what entered, left and changed and the balance before and after', () => {
  const [row] = statementRows([diffCensus(census, edited)]);
  assert.equal(row.rev, edited.rev);
  assert.deepEqual([row.entered.lines, row.left.lines, row.changed.lines], [0, 0, 3]);
  assert.deepEqual(row.details.map((d) => [d.kind, d.path, d.lines]), [['changed', 'apps/api/src/server.ts', 3]]);
  assert.equal(row.before.lines, census.sums.total.lines.total);
  assert.equal(row.after.lines, edited.sums.total.lines.total);
  assert.equal(row.balanced, true);
});

test('the first statement line brings every file in from an empty balance', () => {
  const [row] = statementRows([diffCensus(null, census)]);
  assert.deepEqual([row.before.files, row.before.lines, row.from], [0, 0, 0]);
  assert.equal(row.entered.files, census.sums.total.files);
  assert.equal(row.entered.lines, census.sums.total.lines.total);
  assert.equal(row.after.lines, census.sums.total.lines.total);
  assert.equal(row.balanced, true);
});

test('files that left and files that entered are told apart, and the newest line comes first', () => {
  const gone = { ...edited, rev: edited.rev + 1, generatedAt: '2026-10-10T11:00:00Z', files: edited.files.filter((f) => f.path !== 'apps/api/src/log.ts') };
  const lost = edited.files.find((f) => f.path === 'apps/api/src/log.ts');
  gone.sums = { ...edited.sums, total: { ...edited.sums.total, files: edited.sums.total.files - 1, lines: { ...edited.sums.total.lines, total: edited.sums.total.lines.total - lost.lines.total } } };
  const rows = statementRows([diffCensus(census, edited), diffCensus(edited, gone), diffCensus(null, census)]);
  assert.deepEqual(rows.map((r) => r.rev), [gone.rev, edited.rev, census.rev], 'newest first');
  assert.deepEqual([rows[0].left.files, rows[0].left.lines, rows[0].entered.files], [1, lost.lines.total, 0]);
  assert.equal(rows[0].details[0].kind, 'removed');
  assert.equal(rows[0].balanced, true);
});

test('a line that moved nothing is left out of the statement, and a broken line does not break the rest', () => {
  const quiet = { rev: 9, from: 8, at: '2026-10-10T11:00:00Z', added: [], removed: [], changed: [], totals: { before: { files: 1, lines: 1, chars: 1 }, after: { files: 1, lines: 1, chars: 1 } } };
  const rows = statementRows([quiet, null, 'x', { rev: 'a' }, diffCensus(census, edited)]);
  assert.deepEqual(rows.map((r) => r.rev), [edited.rev]);
  assert.deepEqual(statementRows(null), []);
});

test('a statement whose totals do not add up says so instead of pretending', () => {
  const line = diffCensus(census, edited);
  line.totals.after.lines += 5;
  assert.equal(statementRows([line])[0].balanced, false);
});

// ----- the line about what was read -----

test('the read line says how much was read, and when it is not all, what is still to read', () => {
  const full = readLine({ readChars: 2101, totalChars: 2101, percent: 100, missing: [] }, t);
  assert.equal(full.text, 'Read 2101 of 2101 characters (100 %)');
  assert.deepEqual([full.complete, full.unread, full.missing], [true, false, []]);
  const part = readLine({ readChars: 900, totalChars: 1000, percent: 90, missing: [{ path: 'src/b.ts', spans: [[120, 200], [300, 300]] }] }, t);
  assert.equal(part.text, 'Read 900 of 1000 characters (90 %)');
  assert.equal(part.complete, false);
  assert.deepEqual(part.missing.map((m) => [m.path, m.label]), [['src/b.ts', 'src/b.ts: lines 120-200, 300']]);
  assert.equal(readLine({ readChars: 900, totalChars: 1000, percent: 90, missing: [] }, tpt).text, 'Lidos 900 de 1000 caracteres (90 %)');
});

test('99.9 percent is never written as complete', () => {
  const almost = readLine({ readChars: 999, totalChars: 1000, percent: 99, missing: [{ path: 'a.ts', spans: [[1, 1]] }] }, t);
  assert.equal(almost.complete, false);
  assert.match(almost.text, /\(99 %\)/);
  assert.equal(readLine({ readChars: 1000, totalChars: 1000, percent: 100, missing: [{ path: 'a.ts', spans: [[1, 1]] }] }, t).complete, false, 'a list of what is missing outweighs a rounded 100');
});

test('nothing read yet is said as such, never as 0 of 0', () => {
  for (const none of [null, undefined, {}, { readChars: 0, totalChars: 0, percent: 0, missing: [] }, { readChars: 'x', totalChars: 5 }]) {
    const line = readLine(none, t);
    assert.deepEqual([line.unread, line.complete, line.missing], [true, false, []]);
    assert.equal(line.text, 'Not read yet');
  }
});

test('numbers on the read line can be written the way the page writes them', () => {
  const line = readLine({ readChars: 1234567, totalChars: 2000000, percent: 61, missing: [] }, t, (n) => n.toLocaleString('en'));
  assert.equal(line.text, 'Read 1,234,567 of 2,000,000 characters (61 %)');
});

// ----- the texts -----

test('the census texts have the same keys and blanks in both languages and repeat no other text', async () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(readTexts['pt-BR']).sort(), Object.keys(readTexts.en).sort());
  assert.ok(Object.keys(readTexts.en).length > 30);
  for (const [k, v] of Object.entries(readTexts.en)) {
    assert.ok(k.startsWith('census.'), `${k} stays in the census namespace`);
    assert.ok(v.trim() && readTexts['pt-BR'][k]?.trim(), `${k} is empty`);
    assert.deepEqual(vars(readTexts['pt-BR'][k]), vars(v), `${k} blanks differ`);
  }
  const source = readFileSync(new URL('i18n.js', WEB), 'utf8');
  const start = source.indexOf('const en = {');
  const base = new Set([...source.slice(start, source.indexOf('\n};', start)).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
  for (const k of Object.keys(readTexts.en)) assert.ok(!base.has(k), `${k} is already in i18n.js`);
});

test('every census text the view asks for exists, in the dictionaries the page really loads', () => {
  const source = readFileSync(new URL('censusview.js', WEB), 'utf8');
  const asked = new Set([...source.matchAll(/\bt{1,2}\(\s*'(census\.[\w.]+)'/g)].map((m) => m[1]));
  const counted = [...source.matchAll(/\bt{1,2}\.count\(\s*'(census\.[\w.]+)'/g)].flatMap((m) => [`${m[1]}.one`, `${m[1]}.other`]);
  assert.ok(asked.size > 10);
  for (const k of [...asked, ...counted]) assert.notEqual(t(k), k, `${k} missing in en`);
  for (const k of [...asked, ...counted]) assert.notEqual(tpt(k), k, `${k} missing in pt-BR`);
  for (const reason of ['dep', 'generated', 'binary', 'secret']) assert.notEqual(t(`census.excluded.${reason}`), `census.excluded.${reason}`);
});

// ----- the view, without a browser: a tiny element tree and a fake server -----

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const button = (node, re) => walk(node).filter((n) => n.tag === 'button').find((b) => re.test(textOf(b)));

function fakeServer(routes) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ method: init.method, path: decodeURIComponent(path) });
    const hit = routes(decodeURIComponent(path));
    return { ok: (hit?.status ?? 200) < 400, status: hit?.status ?? 200, json: async () => (hit ? hit.body : null) };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

function makeView(tr = t) {
  const view = createCensusView({ h, t: () => tr, lang: () => 'en', project: () => ({ id: 'acme-shop-8324f1' }), errorText: (c) => `error:${c}` });
  const root = h('div');
  return { view, root, screen: () => ({ tag: 'div', attrs: {}, children: root.children }) };
}

const LEDGER = { version: 1, files: {}, summary: { readChars: 900, totalChars: 1000, percent: 90, missing: [{ path: 'src/b.ts', spans: [[120, 200]] }] } };
const served = (extra = {}) => (path) => {
  if (path.endsWith('/census/log')) return { body: [diffCensus(census, edited)] };
  if (path.endsWith('/census')) return { body: census };
  if (path.endsWith('/ledger')) return { body: LEDGER };
  return extra[path] ?? { status: 404, body: { error: 'not-found' } };
};

test('the screen shows the table by folder, the read line, the statement and a collapsed left-out section; it only reads', async () => {
  const server = fakeServer(served());
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /apps/);
    assert.match(text, /Read 900 of 1,000 characters \(90 %\)/);
    assert.match(text, /src\/b\.ts: lines 120-200/);
    assert.match(text, /apps\/api\/src\/server\.ts/, 'the statement names the file that changed');
    assert.match(text, /Left out of the count/);
    const sections = walk(screen()).filter((n) => n.tag === 'details' && /fdc-excluded/.test(n.attrs.class ?? ''));
    assert.equal(sections.length, 1);
    assert.ok(!sections[0].attrs.open, 'the left-out section starts closed');
    assert.deepEqual([...new Set(server.calls.map((c) => c.method))], ['GET']);
    assert.deepEqual(server.calls.map((c) => c.path).sort(), ['/api/foundation/acme-shop-8324f1/census', '/api/foundation/acme-shop-8324f1/census/log', '/api/foundation/acme-shop-8324f1/ledger']);
  } finally { server.restore(); }
});

test('the toggle switches the table from folders to parts, and the files nobody owns show in red words and in a note', async () => {
  const server = fakeServer(served());
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const rowsOf = () => walk(screen()).filter((n) => n.tag === 'tr' && n.attrs['data-row']);
    assert.ok(rowsOf().some((r) => r.attrs['data-row'] === 'apps'));
    await button(screen(), /By part/i).attrs.onclick();
    const none = rowsOf().find((r) => r.attrs['data-row'] === '_none');
    assert.ok(none, 'the ownerless row is there');
    assert.match(none.attrs.class, /is-noowner/);
    assert.match(textOf(none), /No owner/);
    assert.ok(rowsOf().some((r) => r.attrs['data-row'] === 'web'));
    assert.ok(!rowsOf().some((r) => r.attrs['data-row'] === 'apps'));
    await button(screen(), /By folder/i).attrs.onclick();
    assert.ok(rowsOf().some((r) => r.attrs['data-row'] === 'apps'));
  } finally { server.restore(); }
});

test('a folder opens on click, with a way back up, and the total row follows the folder', async () => {
  const server = fakeServer(served());
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    await button(screen(), /^apps$/).attrs.onclick();
    const text = textOf(screen());
    assert.match(text, /\bapi\b/);
    assert.ok(!walk(screen()).some((n) => n.tag === 'tr' && n.attrs['data-row'] === 'packages'));
    const total = walk(screen()).find((n) => n.tag === 'tr' && n.attrs['data-row'] === '__total');
    assert.ok(total.children.map(textOf).join(' ').includes(String(census.sums.folders.apps.lines.total)));
    await button(screen(), /Up one folder/i).attrs.onclick();
    assert.ok(walk(screen()).some((n) => n.tag === 'tr' && n.attrs['data-row'] === 'packages'));
  } finally { server.restore(); }
});

test('before the first reading the screen says "not read yet" everywhere, never zero', async () => {
  const server = fakeServer(() => ({ body: null }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /Not read yet/);
    assert.equal(walk(screen()).filter((n) => n.tag === 'table').length, 0, 'no table of zeros');
    assert.doesNotMatch(text, /\b0 of 0\b/);
  } finally { server.restore(); }
});

test('a failed reading shows the error and keeps the screen standing', async () => {
  const server = fakeServer(() => ({ status: 500, body: { error: 'boom' } }));
  try {
    const { view, root, screen } = makeView();
    await view.render(root);
    assert.match(textOf(screen()), /error:boom/);
  } finally { server.restore(); }
});

test('the screen speaks Portuguese when asked', async () => {
  const server = fakeServer(served());
  try {
    const { view, root, screen } = makeView(tpt);
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /Lidos 900 de 1,000 caracteres/);
    assert.match(text, /Fora da contagem/);
  } finally { server.restore(); }
});
